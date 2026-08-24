#!/usr/bin/env node
/**
 * Refreshes data/overview.json (Major Indices + Dollar & Commodities) from
 * live sources.
 *
 * Sources:
 *   - Alpaca Market Data (free tier) -> equity indices via ETF proxies
 *     (SPY/DIA/QQQ snapshot, one batched call, replacing Twelve Data --
 *     free tier is 200 req/min vs. Twelve Data's 8 req/min).
 *   - Yahoo Finance's unofficial chart endpoint -> real VIX (^VIX, the
 *     actual CBOE Volatility Index, confirmed live), the true US Dollar
 *     Index level (DX-Y.NYB, ICE's own index -- NOT the UUP ETF, which
 *     trades at a different scale), and the front-month WTI crude futures
 *     price (CL=F). No key needed. Same endpoint already used for
 *     sector-ratio history in fetch-sector-ratios.mjs.
 *     (VIX was tried via Alpaca's new Indices Data API first, but that
 *     endpoint 403s on the free tier -- real-time index data needs the
 *     paid Algo Trader Plus plan. Yahoo was already in use for DXY/Oil, so
 *     reusing it for VIX avoids adding a 5th data provider.)
 *   - Yahoo Finance (same endpoint) -> TLT (iShares 20+ Year Treasury Bond
 *     ETF, the bond proxy) and DBC (Invesco DB Commodity Index Tracking
 *     Fund, a broad multi-commodity basket) for the Dollar & Commodities
 *     section's intermarket framing (Dark_Pool_Access_and_Full_Gap_
 *     Checklist.txt item 7 -- stocks/bonds/commodities/currencies
 *     together, not equities in isolation). Both are ETF prices, not a
 *     "real index level" the way DXY/oil futures are -- flagged with a
 *     ticker the same way SPY/DIA/QQQ already are elsewhere in this file.
 *   - Twelve Data (free tier) -> Bitcoin/Gold (real spot quotes) and Silver
 *     (ETF proxy -- XAG/USD is paid-plan-gated on the free tier).
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
 *
 * Also writes `gammaDayRange`: today's session high/low/last for SPY, IWM,
 * and QQQ (Alpaca's dailyBar.h/.l and latestTrade.p), piggybacked onto the
 * same snapshot call as the SPY/DIA/QQQ index quotes above (IWM added to
 * that one request) so it costs nothing extra. index.html's Gamma Levels
 * cards use high/low to flag a level as "touched" today (touched if it
 * falls within [low, high], which holds for any level actually crossed
 * intraday since price moves continuously), and `last` vs. that ticker's
 * HVL to label the card's gamma regime (positive above HVL, negative
 * below).
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

// Not shown as its own "Major Indices" card -- fetched only so its dailyBar
// high/low is available for the Gamma Levels "touched" check below.
const GAMMA_RANGE_SYMBOLS = ["SPY", "IWM", "QQQ"];

const COMMODITY_SYMBOLS = {
  btc: { name: "Bitcoin", symbol: "BTC/USD", changeType: "pct", unit: "$" },
  gold: { name: "Gold", symbol: "XAU/USD", changeType: "pct", unit: "$" },
  silver: { name: "Silver", symbol: "SLV", changeType: "pct", unit: "$", ticker: "SLV" }
};

const YAHOO_SYMBOLS = {
  vix: { name: "VIX", symbol: "^VIX", changeType: "abs" }, // real CBOE Volatility Index level
  dxy: { name: "US Dollar Index", symbol: "DX-Y.NYB", ticker: "$DXY" }, // real index level, unitless
  oil: { name: "Crude Oil", symbol: "CL=F", ticker: "/CL", unit: "$" }, // real front-month futures price
  bonds: { name: "20+ Yr Treasury", symbol: "TLT", ticker: "TLT", unit: "$" },
  commodity_basket: { name: "Broad Commodities", symbol: "DBC", ticker: "DBC", unit: "$" }
};

const INDEX_ORDER = ["sp500", "dow", "nasdaq", "ust10y", "vix"];
const COMMODITY_ORDER = ["dxy", "btc", "gold", "silver", "oil", "bonds", "commodity_basket"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of [...(json.indices || []), ...(json.commodities || [])]) byId[item.id] = item;
    return { byId, gammaDayRange: json.gammaDayRange || {} };
  } catch {
    return { byId: {}, gammaDayRange: {} };
  }
}

function fallbackDayRange(previousRange) {
  const out = {};
  for (const sym of GAMMA_RANGE_SYMBOLS) {
    out[sym] = previousRange[sym] ? { ...previousRange[sym], live: false } : null;
  }
  return out;
}

async function fetchAlpacaStocks(defsById, previous, previousRange) {
  const out = {};
  const ids = Object.keys(defsById);
  if (!ALPACA_API_KEY_ID || !ALPACA_API_SECRET_KEY) {
    console.warn("[alpaca] no API credentials set, keeping previous values for", ids.join(", "));
    for (const id of ids) out[id] = previous[id] ? { ...previous[id], live: false } : null;
    return { indices: out, gammaDayRange: fallbackDayRange(previousRange) };
  }
  // GAMMA_RANGE_SYMBOLS (SPY/IWM/QQQ) piggyback onto this same request --
  // SPY and QQQ are fetched here anyway, IWM is the only added symbol.
  const symbols = Array.from(new Set([...ids.map((id) => defsById[id].symbol), ...GAMMA_RANGE_SYMBOLS])).join(",");
  const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols)}&feed=iex`;
  let json = null;
  try {
    const res = await fetch(url, { headers: ALPACA_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
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

  const gammaDayRange = {};
  for (const sym of GAMMA_RANGE_SYMBOLS) {
    try {
      const snap = json?.[sym];
      const bar = snap?.dailyBar;
      const high = bar?.h, low = bar?.l;
      const last = snap?.latestTrade?.p ?? bar?.c;
      if (!Number.isFinite(high) || !Number.isFinite(low)) throw new Error(`missing dailyBar high/low for ${sym}`);
      if (!Number.isFinite(last)) throw new Error(`missing last price for ${sym}`);
      gammaDayRange[sym] = { high, low, last, live: true };
    } catch (err) {
      console.warn(`[alpaca] day-range failed for ${sym}: ${err.message}. Keeping previous value.`);
      gammaDayRange[sym] = previousRange[sym] ? { ...previousRange[sym], live: false } : null;
    }
  }

  return { indices: out, gammaDayRange };
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
    const changeType = def.changeType || "pct";
    const item = {
      id, name: def.name, ticker: def.ticker, live: true,
      value: price,
      change: changeType === "abs" ? price - prevClose : ((price - prevClose) / prevClose) * 100,
      changeType
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
  const { byId: previous, gammaDayRange: previousRange } = await loadPrevious();

  const [stockResults, vix, treasury, dxy, oil, bonds, commodityBasket] = await Promise.all([
    fetchAlpacaStocks(ALPACA_STOCK_SYMBOLS, previous, previousRange),
    fetchYahooCommodity("vix", YAHOO_SYMBOLS.vix, previous),
    fetchTreasuryYield(previous),
    fetchYahooCommodity("dxy", YAHOO_SYMBOLS.dxy, previous),
    fetchYahooCommodity("oil", YAHOO_SYMBOLS.oil, previous),
    fetchYahooCommodity("bonds", YAHOO_SYMBOLS.bonds, previous),
    fetchYahooCommodity("commodity_basket", YAHOO_SYMBOLS.commodity_basket, previous)
  ]);
  const commodityResults = await fetchTwelveDataSequential(COMMODITY_SYMBOLS, previous);

  const indices = sortByOrder(
    [stockResults.indices.sp500, stockResults.indices.dow, stockResults.indices.nasdaq, treasury, vix],
    INDEX_ORDER
  );
  const commodities = sortByOrder(
    [dxy, commodityResults.btc, commodityResults.gold, commodityResults.silver, oil, bonds, commodityBasket],
    COMMODITY_ORDER
  );

  const anyLive = [...indices, ...commodities].some((i) => i.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    indices,
    commodities,
    gammaDayRange: stockResults.gammaDayRange
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = [...indices, ...commodities].filter((i) => i.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${indices.length + commodities.length} items live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
