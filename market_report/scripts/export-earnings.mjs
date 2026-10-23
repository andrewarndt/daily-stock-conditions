#!/usr/bin/env node
/**
 * Builds data/earnings.json (the Earnings tab) from the local FactSet
 * Earnings Insight scraper's CSVs -- like Market Breadth, this feed comes
 * from the Stock Market research tree on the F: drive, not a GitHub
 * Actions fetch, so it is run by hand after the scraper picks up a new
 * Friday report:
 *
 *   node market_report/scripts/export-earnings.mjs [data-dir]
 *
 * data-dir defaults to EARNINGS_DATA_DIR, then to the scraper's own data
 * folder. Reads only:
 *   earnings_insight.csv   one row per weekly report -> the "latest" block
 *   quarterly_trends.csv   one row per quarter       -> the history charts
 * Nothing in the scraper's folder is written. FactSet's quoted sentences
 * (earnings_call_terms.csv) are deliberately not published.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "earnings.json");
const DATA_DIR = process.argv[2] || process.env.EARNINGS_DATA_DIR ||
  "F:/Stock Market/Market Tools/FactSet Earnings Insight/data";

// A season counts as finished once nearly every company has reported.
const SEASON_DONE_PCT = 95;

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((f) => f !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function loadCsv(name) {
  return parseCsv(await readFile(path.join(DATA_DIR, name), "utf8"));
}

const num = (v) => (v === "" || v == null || !isFinite(+v) ? null : +v);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// "Q3 2026" -> sortable index; null if the label isn't a quarter.
function quarterIndex(label) {
  const m = /^Q([1-4]) (\d{4})$/.exec(label || "");
  return m ? +m[2] * 4 + (+m[1] - 1) : null;
}

const weekly = (await loadCsv("earnings_insight.csv"))
  .filter((r) => r.report_date)
  .sort((a, b) => a.report_date.localeCompare(b.report_date));
const trends = await loadCsv("quarterly_trends.csv");
if (!weekly.length || !trends.length) throw new Error("No rows found in " + DATA_DIR);

const last = weekly[weekly.length - 1];
// The latest report that carries an earnings-season scorecard (the weeks
// between seasons only carry guidance and estimates).
const lastScored = [...weekly].reverse().find((r) => num(r.eps_beat_pct) != null) || last;

const seasonQuarter = lastScored.quarter;
const seasonInProgress = num(lastScored.pct_reported) != null && num(lastScored.pct_reported) < SEASON_DONE_PCT;
const guideQuarter = last.guide_quarter;

const latest = {
  report_date: last.report_date,
  season: {
    quarter: seasonQuarter,
    report_date: lastScored.report_date,
    in_progress: seasonInProgress,
    pct_reported: num(lastScored.pct_reported),
    eps_beat_pct: num(lastScored.eps_beat_pct),
    eps_beat_5y_avg: num(lastScored.eps_beat_5y_avg),
    eps_beat_10y_avg: num(lastScored.eps_beat_10y_avg),
    eps_surprise_pct: num(lastScored.eps_surprise_pct),
    eps_surprise_5y_avg: num(lastScored.eps_surprise_5y_avg),
    rev_beat_pct: num(lastScored.rev_beat_pct),
    rev_beat_5y_avg: num(lastScored.rev_beat_5y_avg),
    rev_surprise_pct: num(lastScored.rev_surprise_pct),
    rev_surprise_5y_avg: num(lastScored.rev_surprise_5y_avg)
  },
  growth: {
    quarter: last.growth_quarter,
    kind: last.growth_kind,
    eps_growth: num(last.eps_growth_blended),
    rev_growth: num(last.rev_growth_blended),
    next_q_label: last.next_q_label,
    next_q_growth_est: num(last.next_q_growth_est),
    cy_label: last.cy_label,
    cy_growth_est: num(last.cy_growth_est)
  },
  margin: {
    quarter: last.margin_quarter,
    net_margin: num(last.net_margin),
    year_ago: num(last.net_margin_year_ago),
    avg_5y: num(last.net_margin_5y_avg)
  },
  fwd_pe: num(last.fwd_pe),
  guidance: {
    quarter: guideQuarter,
    issued: num(last.guide_issued),
    negative: num(last.guide_negative),
    positive: num(last.guide_positive),
    negative_pct: num(last.guide_negative_pct),
    negative_5y_avg: num(last.guide_negative_5y_avg),
    negative_10y_avg: num(last.guide_negative_10y_avg),
    fy_issued: num(last.fy_guide_issued),
    fy_negative: num(last.fy_guide_negative),
    fy_positive: num(last.fy_guide_positive)
  }
};

// One row per quarter, oldest first. A quarter's guidance tally is still
// running while it is the quarter the latest report is counting, and its
// scorecard is still running while its season is in progress; the page
// leaves those out of the history charts and shows them as "so far".
const quarters = trends
  .map((r) => ({ r, qi: quarterIndex(r.quarter) }))
  .filter((x) => x.qi != null)
  .sort((a, b) => a.qi - b.qi)
  .map(({ r, qi }) => {
    const neg = num(r.guide_negative), pos = num(r.guide_positive);
    const negPct = neg != null && pos != null && neg + pos > 0 ? (neg / (neg + pos)) * 100 : num(r.guide_negative_pct);
    return {
      quarter: r.quarter,
      qi,
      season_final: !(r.quarter === seasonQuarter && seasonInProgress),
      guide_final: r.quarter !== guideQuarter,
      eps_beat_pct: num(r.eps_beat_pct),
      eps_beat_5y_avg: num(r.eps_beat_5y_avg),
      rev_beat_pct: num(r.rev_beat_pct),
      eps_surprise_pct: num(r.eps_surprise_pct),
      rev_surprise_pct: num(r.rev_surprise_pct),
      eps_growth: num(r.eps_growth),
      eps_growth_kind: r.eps_growth_kind || null,
      eps_growth_start_est: num(r.eps_growth_start_est),
      rev_growth: num(r.rev_growth),
      net_margin: num(r.net_margin),
      fwd_pe: num(r.fwd_pe),
      guide_negative: neg,
      guide_positive: pos,
      guide_negative_pct: round1(negPct),
      guide_negative_10y_avg: num(r.guide_negative_10y_avg)
    };
  });

// Quarter-over-quarter change in the negative-guidance share, between
// back-to-back quarters whose tallies are both final.
quarters.forEach((q, i) => {
  const prev = quarters[i - 1];
  q.guide_jump = prev && prev.qi === q.qi - 1 && q.guide_final && prev.guide_final &&
    q.guide_negative_pct != null && prev.guide_negative_pct != null
    ? round1(q.guide_negative_pct - prev.guide_negative_pct)
    : null;
});
quarters.forEach((q) => delete q.qi);

const out = {
  updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  source: "live",
  provider: "FactSet Earnings Insight",
  asof: last.report_date,
  latest,
  quarters
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${quarters.length} quarters, latest report ${last.report_date} (season ${seasonQuarter}${seasonInProgress ? ", in progress" : ""}; guidance ${guideQuarter}) to ${OUT_PATH}`);
