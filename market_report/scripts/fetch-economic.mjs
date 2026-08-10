#!/usr/bin/env node
/**
 * Refreshes data/economic.json (CPI / PPI / Unemployment / PMI / ISM) for
 * the Economic Snapshot table (index.html) and Economic Indicators table
 * (fed-economic.html). Stores raw values -- formatting into display strings
 * happens client-side, same split as fetch-overview.mjs/data/overview.json.
 *
 * Sources:
 *   - FRED (St. Louis Fed) -> CPIAUCSL (CPI, all urban consumers, YoY via
 *     units=pc1) and UNRATE (unemployment rate, seasonally adjusted).
 *   - FRED -> PPIACO ("Producer Price Index by Commodity: All Commodities",
 *     YoY via units=pc1). This is FRED's long-running headline-adjacent PPI
 *     series, NOT the newer "PPI Final Demand" figure financial media often
 *     quotes -- that series isn't freely mirrored on FRED under a stable ID.
 *     Values will track directionally but may differ somewhat in magnitude
 *     from "PPI Final Demand" headlines. Flagged here the same way other
 *     proxy substitutions are flagged elsewhere in this repo.
 *
 * PMI (S&P Global Composite) and ISM Manufacturing are intentionally NOT
 * fetched: both are proprietary/subscription-gated with no free live-data
 * source (S&P Global's PMI isn't published anywhere free; FRED discontinued
 * mirroring ISM's PMI in 2016 over licensing). Same treatment as VIX in
 * fetch-overview.mjs -- stays a static/illustrative entry, carried forward
 * untouched, per team decision.
 *
 * Each indicator also carries a `nextRelease` date (YYYY-MM-DD), used by the
 * "Next up" strip on fed-economic.html so that line never needs hand-editing:
 *   - cpi/ppi/unemployment: the actual next scheduled date from FRED's own
 *     release calendar (fred/release/dates), looked up via fred/series/release
 *     to map the series to its release_id. Genuinely live, same as the values.
 *   - pmi/ism: no free calendar API exists for either, but both publishers'
 *     release-day conventions are fixed and public, so the date is computed
 *     from a rule (see nextIsmReleaseDate/nextPmiReleaseDate below) instead
 *     of being hand-maintained. It advances on its own every run.
 * FOMC dates are deliberately NOT included here -- fed-economic.html reads
 * those straight off the Fed Watch section already on the page, so there's
 * one source of truth instead of two hardcoded copies.
 *
 * Requires env var FRED_API_KEY (see .github/workflows/refresh-economic.yml).
 * On any single-series failure, falls back to the previous value already in
 * data/economic.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "economic.json");

const FRED_API_KEY = process.env.FRED_API_KEY;

const INDICATOR_ORDER = ["cpi", "pmi", "ppi", "unemployment", "ism"];

const STATIC_SEED = {
  pmi: {
    id: "pmi", name: "PMI, Composite", desc: "S&P Global, flash",
    value: 51.8, prior: 52.4, asof: "2026-07-01", unit: "",
    trend: [53.1, 52.9, 52.6, 52.7, 52.4, 51.8], live: false
  },
  ism: {
    id: "ism", name: "ISM Manufacturing", desc: "Institute for Supply Management",
    value: 48.6, prior: 47.9, asof: "2026-07-01", unit: "",
    trend: [46.8, 47.1, 47.5, 47.6, 47.9, 48.6], live: false
  }
};

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of json.indicators || []) byId[item.id] = item;
    return byId;
  } catch {
    return {};
  }
}

async function fetchFredSeries(id, def, previous) {
  const prev = previous[id];
  if (!FRED_API_KEY) {
    console.warn(`[fred] no API key set, keeping previous value for ${id}`);
    return prev ? { ...prev, live: false } : null;
  }
  const unitsParam = def.units ? `&units=${def.units}` : "";
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=8${unitsParam}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${def.seriesId}`);
    const obs = (json.observations || []).filter((o) => o.value !== ".");
    if (obs.length < 2) throw new Error(`not enough observations for ${def.seriesId}`);

    const value = Number(obs[0].value);
    const prior = Number(obs[1].value);
    if (!Number.isFinite(value) || !Number.isFinite(prior)) throw new Error(`bad values for ${def.seriesId}`);

    const trend = obs.slice(0, 6).reverse().map((o) => Number(o.value));

    return {
      id, name: def.name, desc: def.desc,
      value, prior, asof: obs[0].date, unit: def.unit, trend,
      live: true
    };
  } catch (err) {
    console.warn(`[fred] failed for ${id} (${def.seriesId}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

async function fetchNextReleaseDate(seriesId, previous) {
  if (!FRED_API_KEY) {
    console.warn(`[fred] no API key set, keeping previous next-release date for ${seriesId}`);
    return previous || null;
  }
  try {
    const relRes = await fetch(`https://api.stlouisfed.org/fred/series/release?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json`);
    const relJson = await relRes.json();
    if (relJson.error_code) throw new Error(relJson.error_message || `FRED error looking up release for ${seriesId}`);
    const releaseId = relJson.releases && relJson.releases[0] && relJson.releases[0].id;
    if (!releaseId) throw new Error(`no release found for ${seriesId}`);

    // realtime_start/end filter release/dates by the date value itself (not
    // vintage, as on most other FRED endpoints), so this returns just the
    // next scheduled date on or after today.
    const today = new Date().toISOString().slice(0, 10);
    const datesUrl = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&realtime_start=${today}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&limit=1&include_release_dates_with_no_data=true`;
    const datesRes = await fetch(datesUrl);
    const datesJson = await datesRes.json();
    if (datesJson.error_code) throw new Error(datesJson.error_message || `FRED error fetching release dates for release ${releaseId}`);
    const next = (datesJson.release_dates || [])[0];
    if (!next || !next.date) throw new Error(`no upcoming release date for release ${releaseId}`);
    return next.date;
  } catch (err) {
    console.warn(`[fred] failed to fetch next release date for ${seriesId}: ${err.message}. Keeping previous value.`);
    return previous || null;
  }
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function nextBusinessDayOnOrAfter(d) {
  const c = new Date(d);
  while (isWeekend(c)) c.setUTCDate(c.getUTCDate() + 1);
  return c;
}

// ISM publishes Manufacturing PMI on the first business day of each month
// (for the prior month). Doesn't account for federal holidays, so it can be
// off by a day around e.g. New Year's/Labor Day -- close enough for a
// "coming up" indicator.
function nextIsmReleaseDate(today) {
  let d = nextBusinessDayOnOrAfter(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  if (d <= today) d = nextBusinessDayOnOrAfter(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));
  return d.toISOString().slice(0, 10);
}

// S&P Global's flash Composite PMI comes out around the 22nd-24th of each
// month; unlike BLS/ISM, S&P doesn't publish a precise schedule far ahead
// and offers no free calendar API. Approximated as the 22nd, nudged off a
// weekend -- treat as "roughly this week", not exact to the day.
function nextPmiReleaseDate(today) {
  let d = nextBusinessDayOnOrAfter(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 22)));
  if (d <= today) d = nextBusinessDayOnOrAfter(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 22)));
  return d.toISOString().slice(0, 10);
}

function carryForwardStatic(id, previous) {
  const prev = previous[id];
  if (prev) return { ...prev, live: false };
  return { ...STATIC_SEED[id] };
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();
  const today = new Date();

  const [cpi, ppi, unemployment, cpiNextRelease, ppiNextRelease, unemploymentNextRelease] = await Promise.all([
    fetchFredSeries("cpi", { seriesId: "CPIAUCSL", units: "pc1", unit: "%", name: "CPI, Year-over-Year", desc: "Bureau of Labor Statistics" }, previous),
    fetchFredSeries("ppi", { seriesId: "PPIACO", units: "pc1", unit: "%", name: "PPI, Year-over-Year", desc: "Bureau of Labor Statistics" }, previous),
    fetchFredSeries("unemployment", { seriesId: "UNRATE", unit: "%", name: "Unemployment Rate", desc: "Bureau of Labor Statistics" }, previous),
    fetchNextReleaseDate("CPIAUCSL", previous.cpi && previous.cpi.nextRelease),
    fetchNextReleaseDate("PPIACO", previous.ppi && previous.ppi.nextRelease),
    fetchNextReleaseDate("UNRATE", previous.unemployment && previous.unemployment.nextRelease)
  ]);
  if (cpi) cpi.nextRelease = cpiNextRelease;
  if (ppi) ppi.nextRelease = ppiNextRelease;
  if (unemployment) unemployment.nextRelease = unemploymentNextRelease;

  const pmi = carryForwardStatic("pmi", previous);
  pmi.nextRelease = nextPmiReleaseDate(today);
  const ism = carryForwardStatic("ism", previous);
  ism.nextRelease = nextIsmReleaseDate(today);

  const indicators = sortByOrder([cpi, pmi, ppi, unemployment, ism], INDICATOR_ORDER);

  const anyLive = indicators.some((i) => i.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    indicators
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = indicators.filter((i) => i.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${indicators.length} indicators live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
