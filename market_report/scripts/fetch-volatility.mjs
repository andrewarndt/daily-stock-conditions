#!/usr/bin/env node
/**
 * Refreshes data/volatility.json for sector-ratios.html:
 *   - Constituent Volatility / Core 3M / Dispersion Index charts (6-month
 *     monthly trend, downsampled from daily closes here -- same split as
 *     fetch-economic.mjs's `trend` arrays)
 *   - SPX Volatility Term Structure chart (curve across tenors, today vs.
 *     ~1 month ago -- same shape as the Yield Curve chart on
 *     fed-economic.html/fetch-yields.mjs)
 *
 * Source: Cboe's own public historical-data CDN
 * (cdn.cboe.com/api/global/us_indices/daily_prices/{SYMBOL}_History.csv) --
 * free, no API key, no rate limiting observed, and it's the index
 * publisher itself rather than a third-party mirror. Each file is the full
 * daily history back to inception (2014 for VIXEQ/DSPX, 2009-2011 for the
 * VIX-family tenors), so unlike sector-ratios.json this script never needs
 * incremental merging -- it just re-downsamples from the full CSV every run.
 *
 * Series fetched (one CSV per symbol, shared across both charts below):
 *   - VIX9D  -> Cboe 9-Day Volatility Index               = term structure only
 *   - VIX    -> Cboe Volatility Index (30-day)             = "Index (SPX) IV" + term structure
 *   - VIX3M  -> Cboe S&P 500 3-Month Volatility Index      = "Core 3M" + term structure
 *   - VIX6M  -> Cboe 6-Month Volatility Index              = term structure only
 *   - VIX1Y  -> Cboe 1-Year Volatility Index               = term structure only
 *   - VIXEQ  -> Cboe S&P 500 Constituent Volatility Index  = "Avg constituent IV"
 *   - DSPX   -> Cboe S&P 500 Dispersion Index              = "Dispersion Index"
 * (DSPX is derived by Cboe from VIX and VIXEQ, and the term structure tenors
 * are all the same VIX methodology at different expiries, so every panel on
 * the page is really a different view into the same underlying options data.)
 *
 * On any single-symbol fetch failure, that symbol falls back to the
 * previous entry already in data/volatility.json (flagged `live: false`)
 * rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "volatility.json");

// Trend-chart series (6-month monthly downsample). id -> Cboe symbol/name.
const TREND_DEFS = [
  { id: "vix", symbol: "VIX", name: "Index (SPX) IV" },
  { id: "vix3m", symbol: "VIX3M", name: "3M ATM IV" },
  { id: "vixeq", symbol: "VIXEQ", name: "Avg constituent IV" },
  { id: "dspx", symbol: "DSPX", name: "Dispersion Index" }
];

// Term-structure curve, front tenor to back tenor.
const TERM_STRUCTURE_DEFS = [
  { id: "vix9d", symbol: "VIX9D", tenorLabel: "9D", name: "9-Day" },
  { id: "vix", symbol: "VIX", tenorLabel: "30D", name: "30-Day" },
  { id: "vix3m", symbol: "VIX3M", tenorLabel: "3M", name: "3-Month" },
  { id: "vix6m", symbol: "VIX6M", tenorLabel: "6M", name: "6-Month" },
  { id: "vix1y", symbol: "VIX1Y", tenorLabel: "1Y", name: "1-Year" }
];

const SYMBOLS = [...new Set([...TREND_DEFS, ...TERM_STRUCTURE_DEFS].map((d) => d.symbol))];

const MONTHS_BACK = 6; // trailing months shown on the trend charts, current month included
const AVG12MO_DAYS = 365; // calendar-day window backing the Dispersion "12-mo avg" reference line
const MONTH_AGO_TARGET_DAYS = 30; // calendar-day lookback for the term structure's "1 month ago" line

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const termById = {};
    for (const t of json.termStructure || []) termById[t.id] = t;
    return { labels: json.labels || [], series: json.series || {}, termStructure: termById };
  } catch {
    return { labels: [], series: {}, termStructure: {} };
  }
}

/** Cboe's CSV is DATE,VALUE for single-value indices (VIXEQ, DSPX) and
 * DATE,OPEN,HIGH,LOW,CLOSE for the VIX-family ones -- the last column is
 * the close/value either way, so one parser handles both shapes. */
async function fetchCboeSeries(symbol) {
  const url = `https://cdn.cboe.com/api/global/us_indices/daily_prices/${symbol}_History.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  const obs = [];
  for (let i = 1; i < lines.length; i++) { // skip header row
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const [m, d, y] = cols[0].split("/").map(Number);
    const value = Number(cols[cols.length - 1]);
    if (!m || !d || !y || !Number.isFinite(value)) continue;
    obs.push({ date: new Date(Date.UTC(y, m - 1, d)), value });
  }
  if (!obs.length) throw new Error("no rows parsed from CSV");
  obs.sort((a, b) => a.date - b.date);
  return obs;
}

function monthKey(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

/** Downsamples daily observations to one point per trailing calendar month
 * (last available close on or before that month's end), anchored on
 * `refDate` so every series in the same run lines up on the same 6 months
 * even if one symbol's data lags another's by a day or two. */
function monthlySample(obs, refDate) {
  const buckets = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    buckets.push(new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() - i, 1)));
  }
  const labels = buckets.map((b) => b.toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  const values = buckets.map((b) => {
    const key = monthKey(b);
    const endOfMonth = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0));
    let inMonth = null, upToMonth = null;
    for (const o of obs) {
      if (o.date > endOfMonth) break;
      upToMonth = o.value;
      if (monthKey(o.date) === key) inMonth = o.value;
    }
    return inMonth !== null ? inMonth : upToMonth; // sparse month (e.g. holiday-shortened) falls back to latest prior value
  });
  return { labels, values };
}

function trailing12moAvg(obs, refDate) {
  const cutoff = new Date(refDate);
  cutoff.setUTCDate(cutoff.getUTCDate() - AVG12MO_DAYS);
  const inWindow = obs.filter((o) => o.date >= cutoff && o.date <= refDate);
  if (!inWindow.length) return null;
  const sum = inWindow.reduce((s, o) => s + o.value, 0);
  return sum / inWindow.length;
}

/** Nearest observation on or before ~30 calendar days behind `latestDate`,
 * for the term structure's "1 month ago" comparison line. Same approach as
 * fetch-yields.mjs's findMonthAgo. */
function findMonthAgo(obs, latestDate) {
  const target = new Date(latestDate);
  target.setUTCDate(target.getUTCDate() - MONTH_AGO_TARGET_DAYS);
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].date <= target) return obs[i].value;
  }
  return undefined;
}

async function main() {
  const previous = await loadPrevious();

  const fetched = {};
  await Promise.all(SYMBOLS.map(async (symbol) => {
    try {
      fetched[symbol] = await fetchCboeSeries(symbol);
    } catch (err) {
      console.warn(`[cboe] failed for ${symbol}: ${err.message}. Keeping previous value(s) for it.`);
      fetched[symbol] = null;
    }
  }));

  // Anchor the trend charts' monthly buckets on the most recent date any
  // symbol actually returned, so a same-day partial outage on one symbol
  // doesn't shift its bucketing relative to the others once it recovers.
  const refDate = Object.values(fetched).reduce((latest, obs) => {
    if (!obs) return latest;
    const last = obs[obs.length - 1].date;
    return !latest || last > latest ? last : latest;
  }, null);

  const series = {};
  let labels = previous.labels;
  for (const def of TREND_DEFS) {
    const obs = fetched[def.symbol];
    if (obs && refDate) {
      const { labels: l, values } = monthlySample(obs, refDate);
      labels = l;
      const asof = obs[obs.length - 1].date.toISOString().slice(0, 10);
      series[def.id] = { name: def.name, values, live: true, asof };
      if (def.id === "dspx") series[def.id].avg12mo = trailing12moAvg(obs, refDate);
    } else {
      const prev = previous.series[def.id];
      series[def.id] = prev ? { ...prev, live: false } : null;
    }
  }

  const termStructure = TERM_STRUCTURE_DEFS.map((def) => {
    const obs = fetched[def.symbol];
    if (obs) {
      const last = obs[obs.length - 1];
      return {
        id: def.id, tenorLabel: def.tenorLabel, name: def.name,
        value: last.value,
        monthAgo: findMonthAgo(obs, last.date),
        asof: last.date.toISOString().slice(0, 10),
        live: true
      };
    }
    const prev = previous.termStructure[def.id];
    return prev ? { ...prev, live: false } : { id: def.id, tenorLabel: def.tenorLabel, name: def.name, live: false };
  });

  const anyLive = Object.values(series).some((s) => s && s.live) || termStructure.some((t) => t.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    labels,
    series,
    termStructure
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = Object.values(series).filter((s) => s && s.live).length + termStructure.filter((t) => t.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${TREND_DEFS.length + TERM_STRUCTURE_DEFS.length} series live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
