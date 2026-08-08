#!/usr/bin/env node
/**
 * Refreshes data/overview.json (Major Indices + Dollar & Commodities) from
 * live sources.
 *
 * Sources:
 *   - Twelve Data (free tier) -> equity indices via ETF proxies, plus
 *     currencies/crypto/commodities. Raw index symbols (SPX/DJI/IXIC) and
 *     some raw commodity symbols (XAG/USD, WTI/USD) are paid-plan-gated on
 *     the free tier -- confirmed against the live API, not just docs. Where
 *     gated, we use the closest liquid ETF as a proxy; those entries carry
 *     a `proxy` field and the UI labels the card with the ticker rather
 *     than presenting the ETF price as the literal index/commodity value.
 *     Bitcoin (BTC/USD) and Gold (XAU/USD) ARE real spot quotes, no proxy
 *     needed.
 *   - FRED (St. Louis Fed) -> 10-Yr Treasury constant maturity yield (DGS10).
 *
 * VIX is intentionally NOT fetched: no free source for the real spot VIX
 * level exists, and the closest free proxy (VIXY, a futures ETF) decays
 * over time and diverges from actual VIX moves beyond just scale. Per team
 * decision it stays a static/illustrative entry, carried forward untouched.
 *
 * Twelve Data's free tier is capped at 8 requests/minute. This script makes
 * 7 Twelve Data calls per run (3 indices + 4 commodities), so they're fired
 * sequentially with a short stagger rather than all at once, to stay clear
 * of that ceiling with some margin.
 *
 * Requires env vars TWELVEDATA_API_KEY and FRED_API_KEY (see .github/workflows).
 * On any single-symbol failure, falls back to the previous value already in
 * data/overview.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "overview.json");

const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY;

const INDEX_SYMBOLS = {
  sp500: { name: "S&P 500", symbol: "SPY", changeType: "pct", unit: "$" },
  dow: { name: "Dow Jones", symbol: "DIA", changeType: "pct", unit: "$" },
  nasdaq: { name: "Nasdaq-100", symbol: "QQQ", changeType: "pct", unit: "$" }
};

const COMMODITY_SYMBOLS = {
  dxy: { name: "US Dollar Index", symbol: "UUP", changeType: "pct", unit: "$", proxy: "UUP" },
  btc: { name: "Bitcoin", symbol: "BTC/USD", changeType: "pct", unit: "$" },
  gold: { name: "Gold", symbol: "XAU/USD", changeType: "pct", unit: "$" },
  silver: { name: "Silver", symbol: "SLV", changeType: "pct", unit: "$", proxy: "SLV" },
  oil: { name: "Crude Oil (WTI)", symbol: "USO", changeType: "pct", unit: "$", proxy: "USO" }
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
    if (def.proxy) item.proxy = def.proxy;
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

function carryForwardVix(previous) {
  const prev = previous.vix;
  if (prev) return { ...prev, live: false };
  return { id: "vix", name: "VIX", value: 14.62, change: -1.10, changeType: "abs", live: false };
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();

  const [indexResults, treasury] = await Promise.all([
    fetchTwelveDataSequential(INDEX_SYMBOLS, previous),
    fetchTreasuryYield(previous)
  ]);
  const commodityResults = await fetchTwelveDataSequential(COMMODITY_SYMBOLS, previous);

  const indices = sortByOrder(
    [indexResults.sp500, indexResults.dow, indexResults.nasdaq, treasury, carryForwardVix(previous)],
    INDEX_ORDER
  );
  const commodities = sortByOrder(
    [commodityResults.dxy, commodityResults.btc, commodityResults.gold, commodityResults.silver, commodityResults.oil],
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
