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
 * It also writes "monthlyHistory": monthly averages back as far as the data
 * goes -- the 2Y/10Y/30Y yields (for the long-run charts in the Treasury
 * Yields cards), the 10Y-3M and 10Y-2Y spreads (for the Yield Curve Spread
 * chart and inversion table), and the NBER recession flag. Monthly inputs:
 *   - 10Y: GS10 (monthly average of DGS10), from Apr 1953.
 *   - 2Y:  GS2, from Jun 1976 (the 2-year CMT does not exist earlier).
 *   - 30Y: GS30, from Feb 1977, with a gap Mar 2002 - Jan 2006 while
 *          Treasury stopped issuing the 30-year bond.
 *   - 3M:  GS3M (bond-equivalent CMT, from Sep 1981); before that TB3MS
 *          (secondary-market bill, quoted on a bank-discount basis),
 *          converted to bond-equivalent yield so it is comparable with the
 *          10Y. Same splice the NY Fed uses for its yield-curve recession
 *          model. On the 1981+ overlap the converted TB3MS sits within
 *          ~1bp of GS3M on average; unconverted it would be ~12bp off.
 *   - USREC: NBER-based recession indicator (1 = in recession that month).
 * Spreads are in percentage points, 10-year minus the shorter maturity, so
 * a negative value is an inverted curve.
 *
 * And "dailyHistory": the last DAILY_HISTORY_YEARS of daily 2Y/10Y/30Y
 * closes (DGS2/DGS10/DGS30) for the 1Y/5Y/10Y views of those charts.
 * { dates: [...], "2y": [...], "10y": [...], "30y": [...] }, null on a day
 * a series has no print.
 *
 * Uses env var FRED_API_KEY when set (see .github/workflows/refresh-yields.yml);
 * without one it reads FRED's public fredgraph.csv download of the same
 * series. On any failure, falls back to the previous values already in
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
  { id: "2y", seriesId: "DGS2", name: "2-Year", label: "2Y", history: true },
  { id: "5y", seriesId: "DGS5", name: "5-Year", label: "5Y" },
  { id: "10y", seriesId: "DGS10", name: "10-Year", label: "10Y", history: true },
  { id: "30y", seriesId: "DGS30", name: "30-Year", label: "30Y", history: true }
];
const SERIES_ORDER = SERIES_DEFS.map((d) => d.id);

const MONTH_AGO_TARGET_DAYS = 30;
// Enough daily observations to reach ~30 calendar days back.
const DAILY_LOOKBACK_DAYS = 60;
// Series flagged `history` above keep this many years of daily closes.
const DAILY_HISTORY_YEARS = 10;
const HISTORY_IDS = SERIES_DEFS.filter((d) => d.history).map((d) => d.id);

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of json.series || []) byId[item.id] = item;
    return { byId, monthlyHistory: json.monthlyHistory, dailyHistory: json.dailyHistory };
  } catch {
    return { byId: {} };
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Returns [{ date, value }] sorted oldest first, with FRED's missing values
// (".") dropped. `start` is an ISO date, or undefined for the full series.
async function fetchObservations(seriesId, start) {
  if (FRED_API_KEY) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json` +
      (start ? `&observation_start=${start}` : "");
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${seriesId}`);
    return (json.observations || [])
      .filter((o) => o.value !== ".")
      .map((o) => ({ date: o.date, value: Number(o.value) }));
  }
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}` + (start ? `&cosd=${start}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${seriesId} CSV`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  // FRED's maintenance page comes back as HTML with a 200, not an error.
  if (!/^observation_date,/.test(lines[0])) throw new Error(`${seriesId} CSV download did not return CSV`);
  const rows = lines.slice(1);
  return rows
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => ({ date, value: Number(v) }));
}

function findMonthAgo(obs, latestDate) {
  const target = new Date(latestDate + "T00:00:00Z");
  target.setUTCDate(target.getUTCDate() - MONTH_AGO_TARGET_DAYS);
  // obs is sorted desc (newest first); first entry at or before the target
  // date is the closest available trading day to "30 days ago".
  const hit = obs.find((o) => new Date(o.date + "T00:00:00Z") <= target);
  return hit ? hit.value : undefined;
}

async function fetchFredYield(def, previous) {
  const prev = previous.byId[def.id];
  try {
    const lookback = def.history ? DAILY_HISTORY_YEARS * 366 : DAILY_LOOKBACK_DAYS;
    const obs = (await fetchObservations(def.seriesId, isoDaysAgo(lookback))).reverse();
    if (obs.length < 2) throw new Error(`not enough observations for ${def.seriesId}`);

    const value = obs[0].value;
    const prior = obs[1].value;
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
      live: true,
      // Daily closes for dailyHistory; stripped before writing the series.
      obs: def.history ? obs : undefined
    };
  } catch (err) {
    console.warn(`[fred] failed for ${def.id} (${def.seriesId}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

// 3-month bill: bank-discount rate (percent) -> bond-equivalent yield
// (percent), for a 91-day bill.
function discountToBondEquivalent(d) {
  const r = d / 100;
  return (100 * 365 * r) / (360 - 91 * r);
}

const round2 = (v) => Math.round(v * 100) / 100;

// Monthly history: { months: ["1953-04", ...], "2y": [...], "10y": [...],
// "30y": [...], "10y3m": [...], "10y2y": [...], recession: [0|1, ...] },
// with null wherever a series has no value that month (2Y before Jun 1976,
// 30Y before Feb 1977 and during its 2002-2006 gap). Runs from the first
// month with both a 10Y and a 3M value to the last month with both.
async function buildMonthlyHistory(previousHistory) {
  try {
    const [gs10, gs2, gs30, gs3m, tb3ms, usrec] = await Promise.all(
      ["GS10", "GS2", "GS30", "GS3M", "TB3MS", "USREC"].map((id) => fetchObservations(id))
    );
    const byMonth = (obs) => new Map(obs.map((o) => [o.date.slice(0, 7), o.value]));
    const ten = byMonth(gs10), two = byMonth(gs2), thirty = byMonth(gs30), cmt3m = byMonth(gs3m), bill = byMonth(tb3ms), rec = byMonth(usrec);
    const at = (map, month) => (map.has(month) ? map.get(month) : null);

    const history = { months: [], "2y": [], "10y": [], "30y": [], "10y3m": [], "10y2y": [], recession: [] };
    for (const month of [...ten.keys()].sort()) {
      const three = cmt3m.has(month) ? cmt3m.get(month)
        : bill.has(month) ? discountToBondEquivalent(bill.get(month)) : undefined;
      if (three === undefined) continue;
      history.months.push(month);
      history["2y"].push(at(two, month));
      history["10y"].push(ten.get(month));
      history["30y"].push(at(thirty, month));
      history["10y3m"].push(round2(ten.get(month) - three));
      history["10y2y"].push(two.has(month) ? round2(ten.get(month) - two.get(month)) : null);
      // USREC can lag GS10 by a month; an unpublished month counts as no
      // recession rather than dropping the spread.
      history.recession.push(rec.get(month) === 1 ? 1 : 0);
    }
    if (history.months.length < 12) throw new Error("monthly history came back nearly empty");
    return history;
  } catch (err) {
    console.warn(`[fred] monthly history failed: ${err.message}. Keeping previous history.`);
    return previousHistory;
  }
}

// Daily 2Y/10Y/30Y closes over the last DAILY_HISTORY_YEARS. All or
// nothing: if any of the three failed this run, keep the previous block so
// the charts never mix fresh and stale series.
function buildDailyHistory(results, previousHistory) {
  const byId = {};
  for (const r of results) if (r && r.obs) byId[r.id] = new Map(r.obs.map((o) => [o.date, o.value]));
  if (!HISTORY_IDS.every((id) => byId[id])) {
    console.warn("[fred] daily history incomplete this run, keeping previous history.");
    return previousHistory;
  }
  const start = isoDaysAgo(DAILY_HISTORY_YEARS * 366);
  const dates = [...new Set(HISTORY_IDS.flatMap((id) => [...byId[id].keys()]))].filter((d) => d >= start).sort();
  const history = { dates };
  HISTORY_IDS.forEach((id) => {
    history[id] = dates.map((d) => (byId[id].has(d) ? byId[id].get(d) : null));
  });
  return history;
}

function sortByOrder(items, order) {
  return items.filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// Pretty-print like JSON.stringify(_, null, 2), but keep each history array
// on one line so the file stays a readable size.
const HISTORY_BLOCKS = ["monthlyHistory", "dailyHistory"];
function formatJson(out) {
  const rest = { ...out };
  HISTORY_BLOCKS.forEach((key) => delete rest[key]);
  let json = JSON.stringify(rest, null, 2);
  for (const key of HISTORY_BLOCKS) {
    const block = out[key];
    if (!block) continue;
    const lines = Object.keys(block).map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(block[k])}`);
    json = json.replace(/\n}$/, `,\n  ${JSON.stringify(key)}: {\n${lines.join(",\n")}\n  }\n}`);
  }
  return json;
}

async function main() {
  const previous = await loadPrevious();

  const [results, monthlyHistory] = await Promise.all([
    Promise.all(SERIES_DEFS.map((def) => fetchFredYield(def, previous))),
    buildMonthlyHistory(previous.monthlyHistory)
  ]);
  const dailyHistory = buildDailyHistory(results, previous.dailyHistory);
  const series = sortByOrder(results, SERIES_ORDER).map(({ obs, ...rest }) => rest);

  const anyLive = series.some((s) => s.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    series,
    monthlyHistory,
    dailyHistory
  };

  await writeFile(OUT_PATH, formatJson(out) + "\n", "utf8");
  const liveCount = series.filter((s) => s.live).length;
  const months = monthlyHistory ? monthlyHistory.months.length : 0;
  const days = dailyHistory ? dailyHistory.dates.length : 0;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${series.length} series live this run, ${months} months + ${days} days of history.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
