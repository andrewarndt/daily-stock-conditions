#!/usr/bin/env node
/**
 * Refreshes data/indices.json from live sources.
 *
 * Sources:
 *   - Twelve Data (free tier)  -> S&P 500, Dow, Nasdaq, VIX
 *       If the account's plan doesn't return index data for SPX/DJI/IXIC/VIX
 *       (some plans gate raw index symbols), swap SYMBOLS below for the ETF
 *       proxies SPY / DIA / QQQ — daily % change tracks the index closely
 *       enough for this purpose. VIX has no clean ETF proxy; if it's gated,
 *       drop it from SYMBOLS and leave the last-known value in place.
 *   - FRED (St. Louis Fed)     -> 10-Yr Treasury constant maturity yield (DGS10)
 *
 * Requires env vars TWELVEDATA_API_KEY and FRED_API_KEY (see .github/workflows).
 * On any single-symbol failure, falls back to the previous value already in
 * data/indices.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "indices.json");

const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY;

// id -> { name, symbol, unit?, changeType }
const SYMBOLS = {
  sp500: { name: "S&P 500", symbol: "SPX", changeType: "pct" },
  dow: { name: "Dow Jones", symbol: "DJI", changeType: "pct" },
  nasdaq: { name: "Nasdaq Composite", symbol: "IXIC", changeType: "pct" },
  vix: { name: "VIX", symbol: "VIX", changeType: "abs" }
};

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of json.indices || []) byId[item.id] = item;
    return byId;
  } catch {
    return {};
  }
}

async function fetchTwelveData(id, def, previous) {
  if (!TWELVEDATA_API_KEY) {
    console.warn(`[twelvedata] no API key set, keeping previous value for ${id}`);
    return previous[id] || null;
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
    const changeAbs = Number(json.change);
    if (!Number.isFinite(value)) throw new Error(`Bad value for ${def.symbol}`);
    return {
      id,
      name: def.name,
      value,
      change: def.changeType === "pct" ? changePct : changeAbs,
      changeType: def.changeType
    };
  } catch (err) {
    console.warn(`[twelvedata] failed for ${id} (${def.symbol}): ${err.message}. Keeping previous value.`);
    return previous[id] || null;
  }
}

async function fetchTreasuryYield(previous) {
  if (!FRED_API_KEY) {
    console.warn("[fred] no API key set, keeping previous value for ust10y");
    return previous.ust10y || null;
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
      unit: "%"
    };
  } catch (err) {
    console.warn(`[fred] failed for DGS10: ${err.message}. Keeping previous value.`);
    return previous.ust10y || null;
  }
}

async function main() {
  const previous = await loadPrevious();

  const results = await Promise.all([
    fetchTwelveData("sp500", SYMBOLS.sp500, previous),
    fetchTwelveData("dow", SYMBOLS.dow, previous),
    fetchTwelveData("nasdaq", SYMBOLS.nasdaq, previous),
    fetchTwelveData("vix", SYMBOLS.vix, previous),
    fetchTreasuryYield(previous)
  ]);

  const indices = results.filter(Boolean);
  const order = ["sp500", "dow", "nasdaq", "ust10y", "vix"];
  indices.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const out = {
    updated: new Date().toISOString(),
    source: "live",
    indices
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH} with ${indices.length}/${order.length} indices refreshed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
