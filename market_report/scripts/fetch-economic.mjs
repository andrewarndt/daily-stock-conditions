#!/usr/bin/env node
/**
 * Refreshes data/economic.json (GDP / CPI / PPI / Leading Index /
 * Unemployment / Housing Starts / Existing Home Sales / Industrial
 * Production) for the Economic Snapshot table (index.html) and Economic
 * Indicators table (fed-economic.html). Stores raw values -- formatting
 * into display strings happens client-side, same split as
 * fetch-overview.mjs/data/overview.json.
 *
 * Expanded per Dark_Pool_Access_and_Full_Gap_Checklist.txt item 6 target
 * spec (GDP, CPI, PPI, Leading Economic Index, Unemployment, Housing
 * Starts, Existing Home Sales, [Manufacturing/Services PMI -- see below],
 * Industrial Production, each with a 12-month rate-of-change overlay).
 * To keep the table reading as one consistent unit rather than mixing
 * raw levels with percentages, every series here except Unemployment,
 * Leading Indicator, and Existing Home Sales (levels/indexes -- see each
 * below for why) and GDP (already rate-of-change by construction) is
 * pulled as a year-over-year % change via FRED's units=pc1 transform --
 * that IS the "12-month rate-of-change overlay" the checklist asks for,
 * computed server-side rather than client-side.
 *
 * Sources (all FRED, St. Louis Fed):
 *   - CPIAUCSL (CPI, all urban consumers, YoY via units=pc1)
 *   - PPIACO ("Producer Price Index by Commodity: All Commodities", YoY
 *     via units=pc1). FRED's long-running headline-adjacent PPI series,
 *     NOT the newer "PPI Final Demand" figure financial media often
 *     quotes -- that series isn't freely mirrored on FRED under a stable
 *     ID. Values will track directionally but may differ somewhat in
 *     magnitude from "PPI Final Demand" headlines. Flagged here the same
 *     way other proxy substitutions are flagged elsewhere in this repo.
 *   - UNRATE (unemployment rate, seasonally adjusted, level %)
 *   - A191RL1Q225SBEA (Real GDP, % change from preceding period, SAAR,
 *     quarterly) -- already a rate of change, no pc1 transform applied.
 *   - USALOLITOAASTSAM (OECD Composite Leading Indicator, US, amplitude-
 *     adjusted, 100 = long-term trend), read as a raw index level, not
 *     YoY. Substitute for the Conference Board's Leading Economic Index
 *     the checklist names -- that series isn't freely mirrored on FRED.
 *     Tried FRED's own USSLIND ("Leading Index for the United States",
 *     Philadelphia Fed) first since it's an even closer conceptual
 *     match, but confirmed it was discontinued in April 2020 (frozen at
 *     Feb 2020 data, verified against a live pull before ruling it out)
 *     -- the OECD CLI is the closest still-live free alternative.
 *     Flagged as a substitute the same way the PPI proxy above is.
 *   - HOUST (Housing Starts, thousands of units, SAAR, YoY via pc1)
 *   - EXHOSLUSM495S (Existing Home Sales, National Association of
 *     Realtors via FRED), read as a raw level (millions of units, SAAR),
 *     NOT YoY. NAR discontinued their old long-running FRED series and
 *     relaunched this one starting July 2025 -- confirmed against a live
 *     pull, not assumed -- so there isn't yet a full trailing year to
 *     pc1-transform (one YoY point is barely computable now, with no
 *     prior point for a delta or any trend history at all). Revisit
 *     switching this to YoY once enough monthly history has accumulated.
 *   - INDPRO (Industrial Production Index, YoY via pc1)
 *
 * PMI (S&P Global Composite) and ISM Manufacturing/Services remain
 * deliberately excluded: both are proprietary/subscription-gated with no
 * free live-data source (S&P Global's PMI isn't published anywhere free;
 * FRED discontinued mirroring ISM's PMI in 2016 over licensing), and this
 * project doesn't ship static/illustrative stand-ins for indicators it
 * can't source live -- per team decision (unchanged from before this
 * expansion).
 *
 * Each indicator also carries a `nextRelease` date (YYYY-MM-DD), used by the
 * "Next up" strip on fed-economic.html so that line never needs hand-editing:
 * the actual next scheduled date from FRED's own release calendar
 * (fred/release/dates), looked up via fred/series/release to map the series
 * to its release_id. Genuinely live, same as the values.
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

// Order doubles as display order in both tables. Roughly: growth/prices
// headline pair first, then the forward-looking Leading Index, then
// labor, then the housing/production detail.
const INDICATOR_ORDER = ["gdp", "cpi", "ppi", "lei", "unemployment", "housing_starts", "existing_home_sales", "industrial_production"];

const SERIES_DEFS = {
  gdp: { seriesId: "A191RL1Q225SBEA", unit: "%", name: "Real GDP, QoQ Annualized", desc: "Bureau of Economic Analysis" },
  cpi: { seriesId: "CPIAUCSL", units: "pc1", unit: "%", name: "CPI, Year-over-Year", desc: "Bureau of Labor Statistics" },
  ppi: { seriesId: "PPIACO", units: "pc1", unit: "%", name: "PPI, Year-over-Year", desc: "Bureau of Labor Statistics" },
  lei: { seriesId: "USALOLITOAASTSAM", unit: "idx", name: "OECD Leading Indicator (US)", desc: "OECD, amplitude-adjusted, 100 = trend" },
  unemployment: { seriesId: "UNRATE", unit: "%", name: "Unemployment Rate", desc: "Bureau of Labor Statistics" },
  housing_starts: { seriesId: "HOUST", units: "pc1", unit: "%", name: "Housing Starts, Year-over-Year", desc: "US Census Bureau" },
  // Raw level (millions, SAAR), not YoY -- see header comment for why.
  existing_home_sales: { seriesId: "EXHOSLUSM495S", divisor: 1e6, unit: "M", name: "Existing Home Sales", desc: "National Association of Realtors" },
  industrial_production: { seriesId: "INDPRO", units: "pc1", unit: "%", name: "Industrial Production, Year-over-Year", desc: "Federal Reserve Board" }
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

    const divisor = def.divisor || 1;
    const value = Number(obs[0].value) / divisor;
    const prior = Number(obs[1].value) / divisor;
    if (!Number.isFinite(value) || !Number.isFinite(prior)) throw new Error(`bad values for ${def.seriesId}`);

    const trend = obs.slice(0, 6).reverse().map((o) => Number(o.value) / divisor);

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

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function main() {
  const previous = await loadPrevious();

  const results = await Promise.all(
    INDICATOR_ORDER.map(async (id) => {
      const def = SERIES_DEFS[id];
      const [series, nextRelease] = await Promise.all([
        fetchFredSeries(id, def, previous),
        fetchNextReleaseDate(def.seriesId, previous[id] && previous[id].nextRelease)
      ]);
      if (series) series.nextRelease = nextRelease;
      return series;
    })
  );

  const indicators = sortByOrder(results, INDICATOR_ORDER);

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
