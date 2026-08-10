#!/usr/bin/env node
/**
 * Refreshes data/yields.json (2-Year / 10-Year Treasury) for the Treasury
 * Yields cards and 2s10s spread on fed-economic.html.
 *
 * Scoped to just 2Y/10Y for now, per team decision -- the 30-Year card and
 * the full multi-maturity yield-curve chart on that page stay hardcoded/
 * static until they get the same treatment.
 *
 * Source: FRED (St. Louis Fed) -> DGS2 / DGS10 (daily Treasury constant
 * maturity rate, percent, not seasonally adjusted). Unlike PMI/ISM in
 * fetch-economic.mjs, these are official Treasury figures freely mirrored
 * by FRED with no licensing restriction.
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

const SERIES_ORDER = ["2y", "10y"];

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

async function fetchFredYield(id, def, previous) {
  const prev = previous[id];
  if (!FRED_API_KEY) {
    console.warn(`[fred] no API key set, keeping previous value for ${id}`);
    return prev ? { ...prev, live: false } : null;
  }
  // limit=10 (not 2) so a couple of missing/holiday days don't starve us of
  // a usable prior observation.
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${def.seriesId}`);
    const obs = (json.observations || []).filter((o) => o.value !== ".");
    if (obs.length < 2) throw new Error(`not enough observations for ${def.seriesId}`);

    const value = Number(obs[0].value);
    const prior = Number(obs[1].value);
    if (!Number.isFinite(value) || !Number.isFinite(prior)) throw new Error(`bad values for ${def.seriesId}`);

    return { id, name: def.name, value, prior, asof: obs[0].date, live: true };
  } catch (err) {
    console.warn(`[fred] failed for ${id} (${def.seriesId}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();

  const [twoYear, tenYear] = await Promise.all([
    fetchFredYield("2y", { seriesId: "DGS2", name: "2-Year" }, previous),
    fetchFredYield("10y", { seriesId: "DGS10", name: "10-Year" }, previous)
  ]);

  const series = sortByOrder([twoYear, tenYear], SERIES_ORDER);

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
