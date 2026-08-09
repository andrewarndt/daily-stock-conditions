#!/usr/bin/env node
/**
 * Refreshes data/overview.json (Major Indices + Dollar & Commodities) from
 * live sources.
 *
 * Sources:
 *   - Alpaca Market Data (free tier) -> equity indices via ETF proxies
 *     (SPY/DIA/QQQ snapshot, one batched call) and VIX via Alpaca's new
 *     Indices Data API (GET /v1beta1/indices/latest/values, shipped June
 *     2026). That indices endpoint is brand new -- not yet in Alpaca's main
 *     docs index, only its changelog -- so the exact response shape wasn't
 *     confirmable ahead of time. fetchAlpacaVix() tries several plausible
 *     shapes and logs the raw response if none match, so a real run's logs
 *     can be used to correct the parsing if needed.
 *   - Twelve Data (free tier) -> Bitcoin/Gold (real spot quotes) and Silver
 *     (ETF proxy -- XAG/USD is paid-plan-gated on the free tier).
 *   - Yahoo Finance's unofficial chart endpoint -> the true US Dollar Index
 *     level (DX-Y.NYB, ICE's own index -- NOT the UUP ETF, which trades at
 *     a different scale) and the front-month WTI crude futures price
 *     (CL=F), confirmed working live, no key needed. Same endpoint already
 *     used for sector-ratio history in fetch-sector-ratios.mjs.
 *   - FRED (St. Louis Fed) -> 10-Yr Treasury constant maturity yield (DGS10).
 *
 * Every non-real-index/spot entry carries a `ticker` field so the UI can
 * label the card unambiguously (e.g. "S&P 500 (SPY)" is an ETF price, not
 * the index level; "US Dollar Index ($DXY)" and "Crude Oil (/CL)" ARE the
 * real index/futures values -- the ticker there is just how traders refer
 * to those instruments, $ for a cash index and / for a futures contract).
 *
 * Requires env vars ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY,
 * TWELVEDATA_API_KEY, and FRED_API_KEY (see .github/workflows). On any
 * single-symbol failure, falls back to the previous value already in
 * data/overview.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "overview.json");

const ALPACA_API_KEY_ID = process.env.ALPACA_API_KEY_ID;
const ALPACA_API_SECRET_KEY = process.env.ALPACA_API_SECRET_KEY;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY;

const ALPACA_HEADERS = {
  "APCA-API-KEY-ID": ALPACA_API_KEY_ID || "",
  "APCA-API-SECRET-KEY": ALPACA_API_SECRET_KEY || ""
};

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MarketDeskBot/1.0; +https://andrewarndt.github.io/daily-stock-conditions/)" };

const ALPACA_STOCK_SYMBOLS = {
  sp500: { name: "S&P 500", symbol: "SPY", unit: "$", ticker: "SPY" },
  dow: { name: "Dow Jones", symbol: "DIA", unit: "$", ticker: "DIA" },
  nasdaq: { name: "Nasdaq-100", symbol: "QQQ", unit: "$", ticker: "QQQ" }
};

const COMMODITY_SYMBOLS = {
  btc: { name: "Bitcoin", symbol: "BTC/USD", changeType: "pct", unit: "$" },
  gold: { name: "Gold", symbol: "XAU/USD", changeType: "pct", unit: "$" },
  silver: { name: "Silver", symbol: "SLV", changeType: "pct", unit: "$", ticker: "SLV" }
};

const YAHOO_SYMBOLS = {
  dxy: { name: "US Dollar Index", symbol: "DX-Y.NYB", ticker: "$DXY" }, // real index level, unitless
  oil: { name: "Crude Oil", symbol: "CL=F", ticker: "/CL", unit: "$" } // real front-month futures price
};

const INDEX_ORDER = ["sp500", "dow", "nasdaq", "ust10y", "vix"];
const COMMODITY_ORDER = ["dxy", "btc", "gold", "silver", "oil"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of [...(json.indices || []), ...(json.commodities || [])]) byId[item.id] = item;
    return byId;
  } catch {
    return {};
  }
}

async function fetchAlpacaStocks(defsById, previous) {
  const out = {};
  const ids = Object.keys(defsById);
  if (!ALPACA_API_KEY_ID || !ALPACA_API_SECRET_KEY) {
    console.warn("[alpaca] no API credentials set, keeping previous values for", ids.join(", "));
    for (const id of ids) out[id] = previous[id] ? { ...previous[id], live: false } : null;
    return out;
  }
  const symbols = ids.map((id) => defsById[id].symbol).join(",");
  const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols)}&feed=iex`;
  try {
    const res = await fetch(url, { headers: ALPACA_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    for (const id of ids) {
      const def = defsById[id];
      const snap = json[def.symbol];
      try {
        const price = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
        const prevClose = snap?.prevDailyBar?.c;
        if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) {
          throw new Error(`missing price/prevClose for ${def.symbol}`);
        }
        out[id] = {
          id, name: def.name, value: price, change: ((price - prevClose) / prevClose) * 100,
          changeType: "pct", unit: def.unit, ticker: def.ticker, live: true
        };
      } catch (err) {
        console.warn(`[alpaca] failed for ${id} (${def.symbol}): ${err.message}. Keeping previous value.`);
        out[id] = previous[id] ? { ...previous[id], live: false } : null;
      }
    }
  } catch (err) {
    console.warn(`[alpaca] snapshot request failed: ${err.message}. Keeping previous values for`, ids.join(", "));
    for (const id of ids) out[id] = previous[id] ? { ...previous[id], live: false } : null;
  }
  return out;
}

async function fetchAlpacaVix(previous) {
  const prev = previous.vix;
  if (!ALPACA_API_KEY_ID || !ALPACA_API_SECRET_KEY) {
    console.warn("[alpaca] no API credentials set, keeping previous value for vix");
    return prev ? { ...prev, live: false } : { id: "vix", name: "VIX", value: 14.62, change: -1.10, changeType: "abs", live: false };
  }
  const url = "https://data.alpaca.markets/v1beta1/indices/latest/values?index_symbols=VIX";
  try {
    const res = await fetch(url, { headers: ALPACA_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Response shape for this endpoint isn't confirmed against live docs
    // (see file header) -- try the plausible shapes, log the raw payload
    // if none match so it can be fixed from real output.
    const entry =
      json?.values?.VIX ?? json?.indices?.VIX ?? json?.VIX ??
      (Array.isArray(json?.values) ? json.values.find((v) => v.symbol === "VIX" || v.S === "VIX") : null);

    const value = Number(entry?.value ?? entry?.v ?? entry?.close ?? entry?.c);
    if (!Number.isFinite(value)) {
      console.warn("[alpaca] unrecognized VIX response shape, raw payload:", JSON.stringify(json));
      throw new Error("could not parse VIX value from response");
    }

    // No prior-close field confirmed available from this endpoint yet;
    // compute change against our own last-stored value as a same-day proxy
    // until the real response shape (and any prevClose field) is confirmed.
    const priorValue = prev && Number.isFinite(prev.value) ? prev.value : value;
    return { id: "vix", name: "VIX", value, change: value - priorValue, changeType: "abs", live: true };
  } catch (err) {
    console.warn(`[alpaca] failed for vix: ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : { id: "vix", name: "VIX", value: 14.62, change: -1.10, changeType: "abs", live: false };
  }
}

async function fetchTwelveData(id, def, previous) {
  const prev = previous[id];
  if (!TWELVEDATA_API_KEY) {
    console.warn(`[twelvedata] no API key set, keeping previous value for ${id}`);
    return prev ? { ...prev, live: false } : null;
  }
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(def.symbol)}&apikey=${TWELVEDATA_API_KEY}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === "error" || json.code) {
      throw new Error(json.message || `Twelve Data error for ${def.symbol}`);
    }
    const value = Number(json.close);
    const changePct = Number(json.percent_change);
    if (!Number.isFinite(value)) throw new Error(`Bad value for ${def.symbol}`);
    const item = { id, name: def.name, value, change: changePct, changeType: def.changeType, live: true };
    if (def.unit) item.unit = def.unit;
    if (def.ticker) item.ticker = def.ticker;
    return item;
  } catch (err) {
    console.warn(`[twelvedata] failed for ${id} (${def.symbol}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

async function fetchTwelveDataSequential(defsById, previous) {
  const out = {};
  for (const [id, def] of Object.entries(defsById)) {
    out[id] = await fetchTwelveData(id, def, previous);
    await sleep(300); // stay well clear of the 8 req/min free-tier ceiling
  }
  return out;
}

async function fetchYahooCommodity(id, def, previous) {
  const prev = previous[id];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose;
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) {
      throw new Error("missing regularMarketPrice/chartPreviousClose");
    }
    const item = {
      id, name: def.name, value: price, change: ((price - prevClose) / prevClose) * 100,
      changeType: "pct", ticker: def.ticker, live: true
    };
    if (def.unit) item.unit = def.unit;
    return item;
  } catch (err) {
    console.warn(`[yahoo] failed for ${id} (${def.symbol}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

async function fetchTreasuryYield(previous) {
  const prev = previous.ust10y;
  if (!FRED_API_KEY) {
    console.warn("[fred] no API key set, keeping previous value for ust10y");
    return prev ? { ...prev, live: false } : null;
  }
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const obs = (json.observations || []).filter((o) => o.value !== ".");
    if (obs.length < 2) throw new Error("not enough observations");
    const latest = Number(obs[0].value);
    const prior = Number(obs[1].value);
    return {
      id: "ust10y",
      name: "10-Yr Treasury",
      value: latest,
      change: Number((latest - prior).toFixed(2)),
      changeType: "pt",
      unit: "%",
      live: true
    };
  } catch (err) {
    console.warn(`[fred] failed for DGS10: ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();

  const [stockResults, vix, treasury, dxy, oil] = await Promise.all([
    fetchAlpacaStocks(ALPACA_STOCK_SYMBOLS, previous),
    fetchAlpacaVix(previous),
    fetchTreasuryYield(previous),
    fetchYahooCommodity("dxy", YAHOO_SYMBOLS.dxy, previous),
    fetchYahooCommodity("oil", YAHOO_SYMBOLS.oil, previous)
  ]);
  const commodityResults = await fetchTwelveDataSequential(COMMODITY_SYMBOLS, previous);

  const indices = sortByOrder(
    [stockResults.sp500, stockResults.dow, stockResults.nasdaq, treasury, vix],
    INDEX_ORDER
  );
  const commodities = sortByOrder(
    [dxy, commodityResults.btc, commodityResults.gold, commodityResults.silver, oil],
    COMMODITY_ORDER
  );

  const anyLive = [...indices, ...commodities].some((i) => i.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    indices,
    commodities
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = [...indices, ...commodities].filter((i) => i.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${indices.length + commodities.length} items live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
