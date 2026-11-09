#!/usr/bin/env node
/**
 * Refreshes data/consumer-sentiment.json (Consumer Sentiment section on
 * sentiment.html) from FRED's UMCSENT series -- the University of Michigan
 * Consumer Sentiment Index, preliminary + final prints blended into one
 * monthly series the way FRED publishes it.
 *
 * Source: FRED (St. Louis Fed), same series-observations endpoint as
 * fetch-economic.mjs / fetch-yields.mjs / fetch-fed-dashboard.mjs. Monthly
 * series, so most daily runs are no-ops -- the workflow's git diff --quiet
 * guard handles that, same as every other FRED-backed refresh here.
 *
 * Stores raw values plus a 12-point trailing trend (oldest -> newest) for
 * the "Index level, last 12 months" chart; formatting into display strings
 * happens client-side, same split as fetch-economic.mjs/data/economic.json.
 *
 * Requires env var FRED_API_KEY (see .github/workflows/refresh-consumer-sentiment.yml).
 * On failure, falls back to the previous value already in
 * data/consumer-sentiment.json rather than failing the run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "consumer-sentiment.json");

const FRED_API_KEY = process.env.FRED_API_KEY;
const SERIES_ID = "UMCSENT";
const TREND_MONTHS = 12;

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Primary source: the University of Michigan's own monthly table. FRED's
// UMCSENT runs a month behind it (UMich's licensing delays FRED's copy): on
// 2026-11-09 FRED's latest was September while UMich already had October.
// FRED stays as the fallback below.
const UMICH_CSV = "https://www.sca.isr.umich.edu/files/tbmics.csv";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function fromUmich() {
  const res = await fetch(UMICH_CSV, { headers: { "User-Agent": "Mozilla/5.0 (Market Desk)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.text()).split(/\r?\n/)
    .map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")))
    .filter((r) => r.length >= 3 && MONTHS.includes(r[0]) && /^\d{4}$/.test(r[1]) && r[2] !== "" && Number.isFinite(Number(r[2])))
    .map((r) => ({ month: MONTHS.indexOf(r[0]) + 1, year: Number(r[1]), value: Number(r[2]) }));
  if (rows.length < 2) throw new Error("not enough rows in UMich table");
  rows.sort((x, y) => x.year - y.year || x.month - y.month);
  const last = rows.slice(-TREND_MONTHS);
  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  return {
    updated: new Date().toISOString(),
    source: "live",
    live: true,
    value: latest.value,
    prior: prior.value,
    asof: `${latest.year}-${String(latest.month).padStart(2, "0")}-01`,
    trend: last.map((r) => r.value),
    trendLabels: last.map((r) => MONTHS[r.month - 1].slice(0, 3))
  };
}

async function main() {
  const previous = await loadPrevious();

  try {
    const out = await fromUmich();
    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: value=${out.value} as of ${out.asof} (UMich), live.`);
    return;
  } catch (err) {
    console.warn(`[umich] ${err.message}; falling back to FRED ${SERIES_ID}`);
  }

  if (!FRED_API_KEY) {
    console.warn("[fred] no API key set, keeping previous value");
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          value: 68.4,
          prior: 66.9,
          asof: null,
          trend: [],
          trendLabels: []
        };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: no API key, kept previous/seed value, marked not live.`);
    return;
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${SERIES_ID}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${TREND_MONTHS + 1}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${SERIES_ID}`);
    const obs = (json.observations || []).filter((o) => o.value !== ".");
    if (obs.length < 2) throw new Error(`not enough observations for ${SERIES_ID}`);

    const value = Number(obs[0].value);
    const prior = Number(obs[1].value);
    if (!Number.isFinite(value) || !Number.isFinite(prior)) throw new Error(`bad values for ${SERIES_ID}`);

    const chronological = obs.slice(0, TREND_MONTHS).reverse();
    const trend = chronological.map((o) => Number(o.value));
    const trendLabels = chronological.map((o) =>
      new Date(o.date + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    );

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      value,
      prior,
      asof: obs[0].date,
      trend,
      trendLabels
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: value=${value} as of ${obs[0].date}, live.`);
  } catch (err) {
    console.warn(`[fred] failed for ${SERIES_ID}: ${err.message}. Keeping previous value.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          value: 68.4,
          prior: 66.9,
          asof: null,
          trend: [],
          trendLabels: []
        };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: kept previous/seed value, marked not live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
