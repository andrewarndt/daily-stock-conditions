#!/usr/bin/env node
/**
 * Refreshes data/yields.json (full Treasury curve: 1M/3M/6M/1Y/2Y/5Y/10Y/30Y)
 * for the Treasury Yields cards, 2s10s spread, and Yield Curve chart on
 * bonds.html.
 *
 * Source: FRED (St. Louis Fed) -> DGS1MO/DGS3MO/DGS6MO/DGS1/DGS2/DGS5/
 * DGS10/DGS30 (daily Treasury constant maturity rate, percent, not
 * seasonally adjusted). These are official Treasury figures freely
 * mirrored by FRED with no licensing restriction.
 *
 * Each series carries both a day-over-day "prior" value (for the metric
 * card arrows and the 2s10s spread trend) and a "monthAgo" value (the
 * observation closest to ~30 calendar days back, for the "1M ago" line on
 * the Yield Curve chart).
 *
 * Requires env var FRED_API_KEY (see .github/workflows/refresh-yields.yml).
 * On any single-series failure, falls back to the previous value already in
 * data/yields.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "yields.json");

const FRED_API_KEY = process.env.FRED_API_KEY;

// Order doubles as the Yield Curve chart's x-axis order.
const SERIES_DEFS = [
  { id: "1mo", seriesId: "DGS1MO", name: "1-Month", label: "1M" },
  { id: "3mo", seriesId: "DGS3MO", name: "3-Month", label: "3M" },
  { id: "6mo", seriesId: "DGS6MO", name: "6-Month", label: "6M" },
  { id: "1y", seriesId: "DGS1", name: "1-Year", label: "1Y" },
  { id: "2y", seriesId: "DGS2", name: "2-Year", label: "2Y" },
  { id: "5y", seriesId: "DGS5", name: "5-Year", label: "5Y" },
  { id: "10y", seriesId: "DGS10", name: "10-Year", label: "10Y" },
  { id: "30y", seriesId: "DGS30", name: "30-Year", label: "30Y" }
];
const SERIES_ORDER = SERIES_DEFS.map((d) => d.id);

// Trading-day observations needed to safely reach ~30 calendar days back
// (accounting for weekends + holidays) while looking up the "1M ago" value.
const MONTH_AGO_TARGET_DAYS = 30;
const OBSERVATION_LIMIT = 45;

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of json.series || []) byId[item.id] = item;
    return byId;
  } catch {
    return {};
  }
}

function findMonthAgo(obs, latestDate) {
  const target = new Date(latestDate + "T00:00:00Z");
  target.setUTCDate(target.getUTCDate() - MONTH_AGO_TARGET_DAYS);
  // obs is sorted desc (newest first); first entry at or before the target
  // date is the closest available trading day to "30 days ago".
  const hit = obs.find((o) => new Date(o.date + "T00:00:00Z") <= target);
  return hit ? Number(hit.value) : undefined;
}

async function fetchFredYield(def, previous) {
  const prev = previous[def.id];
  if (!FRED_API_KEY) {
    console.warn(`[fred] no API key set, keeping previous value for ${def.id}`);
    return prev ? { ...prev, live: false } : null;
  }
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${OBSERVATION_LIMIT}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${def.seriesId}`);
    const obs = (json.observations || []).filter((o) => o.value !== ".");
    if (obs.length < 2) throw new Error(`not enough observations for ${def.seriesId}`);

    const value = Number(obs[0].value);
    const prior = Number(obs[1].value);
    if (!Number.isFinite(value) || !Number.isFinite(prior)) throw new Error(`bad values for ${def.seriesId}`);

    const monthAgo = findMonthAgo(obs, obs[0].date);

    return {
      id: def.id,
      name: def.name,
      label: def.label,
      value,
      prior,
      monthAgo: Number.isFinite(monthAgo) ? monthAgo : (prev ? prev.monthAgo : undefined),
      asof: obs[0].date,
      live: true
    };
  } catch (err) {
    console.warn(`[fred] failed for ${def.id} (${def.seriesId}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();

  const results = await Promise.all(SERIES_DEFS.map((def) => fetchFredYield(def, previous)));
  const series = sortByOrder(results, SERIES_ORDER);

  const anyLive = series.some((s) => s.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    series
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = series.filter((s) => s.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${series.length} series live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
