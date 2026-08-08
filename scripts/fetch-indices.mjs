#!/usr/bin/env node
/**
 * Refreshes data/indices.json from live sources.
 *
 * Sources:
 *   - Twelve Data (free tier) -> S&P 500, Dow, Nasdaq, via ETF proxies.
 *       The raw index symbols (SPX/DJI/IXIC) are gated to paid plans on
 *       Twelve Data's free tier (confirmed against the live API, not just
 *       docs) and don't even appear in the free /indices reference catalog.
 *       ETF share price is NOT the same scale as the index (SPY ~$770 vs.
 *       S&P 500 ~5,600 points) -- daily % change tracks closely, but the
 *       raw value does not, so each entry carries a `proxy` field and the
 *       UI labels the card with the ticker rather than presenting it as
 *       the literal index level.
 *   - FRED (St. Louis Fed) -> 10-Yr Treasury constant maturity yield (DGS10).
 *
 * VIX is intentionally NOT fetched here: there's no free source for the
 * real spot VIX level, and the closest free proxy (VIXY, a futures ETF)
 * decays over time and can diverge meaningfully from actual VIX moves, not
 * just in scale. Per team decision, VIX stays a static/illustrative entry
 * until we add a provider with the real index. Its previous value is
 * carried forward untouched on every run.
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

// id -> { name, symbol (ETF proxy), changeType }
const SYMBOLS = {
  sp500: { name: "S&P 500", symbol: "SPY", changeType: "pct" },
  dow: { name: "Dow Jones", symbol: "DIA", changeType: "pct" },
  nasdaq: { name: "Nasdaq-100", symbol: "QQQ", changeType: "pct" }
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
    return {
      id,
      name: def.name,
      proxy: def.symbol,
      value,
      change: changePct,
      changeType: def.changeType,
      live: true
    };
  } catch (err) {
    console.warn(`[twelvedata] failed for ${id} (${def.symbol}): ${err.message}. Keeping previous value.`);
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

function carryForwardVix(previous) {
  const prev = previous.vix;
  if (prev) return { ...prev, live: false };
  // First-ever run with no prior data.json entry to carry forward from.
  return { id: "vix", name: "VIX", value: 14.62, change: -1.10, changeType: "abs", live: false };
}

async function main() {
  const previous = await loadPrevious();

  const results = await Promise.all([
    fetchTwelveData("sp500", SYMBOLS.sp500, previous),
    fetchTwelveData("dow", SYMBOLS.dow, previous),
    fetchTwelveData("nasdaq", SYMBOLS.nasdaq, previous),
    fetchTreasuryYield(previous)
  ]);
  results.push(carryForwardVix(previous));

  const indices = results.filter(Boolean);
  const order = ["sp500", "dow", "nasdaq", "ust10y", "vix"];
  indices.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const anyLive = indices.some((i) => i.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    indices
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH}: ${indices.filter((i) => i.live).length}/${indices.length} indices live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
