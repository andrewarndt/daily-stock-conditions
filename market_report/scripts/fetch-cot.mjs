#!/usr/bin/env node
/**
 * Refreshes data/cot.json: a weekly "COT Index" (0-100) for the Sentiment
 * tab's Positioning group, substituting for NAAIM (which moved behind a
 * paid subscription Aug 1, 2026 -- see Dark_Pool_Access_and_Full_Gap_
 * Checklist.txt item 2 discussion). Not the same survey -- NAAIM asks
 * active managers their equity exposure directly; this derives a
 * comparable "how aggressively is leveraged/institutional money
 * positioned" read from CFTC futures positioning instead. Genuinely
 * free and public, unlike NAAIM now.
 *
 * Source: CFTC Public Reporting Environment (Socrata API), no auth/key
 * required. Traders in Financial Futures (TFF) report, futures-only,
 * E-mini S&P 500 (cftc_contract_market_code 13874A).
 * https://publicreporting.cftc.gov/resource/gpe5-46if.json
 *
 * Field names confirmed against a live pull rather than assumed --
 * they're `lev_money_positions_long` / `lev_money_positions_short`
 * (Leveraged Funds long/short open interest), NOT the `_all`-suffixed
 * names used elsewhere in this same dataset for other trader
 * categories. Socrata field names can drift across dataset revisions;
 * re-confirm with a small unfiltered pull if this ever starts failing.
 *
 * Method: lev_funds_net = long - short per week. The published "COT
 * Index" is the percentile rank of the latest net reading within its
 * own trailing 156-week (~3-year) window -- 0 = most bearish
 * positioning in-window, 100 = most bullish. Raw net-contract counts
 * are NEVER written to data/cot.json or displayed: open interest has
 * grown structurally over the years, so raw figures aren't comparable
 * year over year on their own -- only the percentile rank is. Each run
 * re-pulls the full window fresh and recomputes every week's rank
 * in-memory; only the resulting 0-100 series is persisted.
 *
 * Cadence: CFTC publishes Fridays, covering the prior Tuesday's
 * positions -- weekly, not something to poll more often (see
 * .github/workflows/refresh-cot.yml).
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "cot.json");

const API_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
const CONTRACT_CODE = "13874A"; // CME E-mini S&P 500
const WINDOW_WEEKS = 156; // ~3 years
const FETCH_ROWS = 200; // pad past WINDOW_WEEKS for gaps/holidays

function percentileRank(value, window) {
  let below = 0, equal = 0;
  for (const v of window) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + 0.5 * equal) / window.length) * 100;
}

async function fetchRows() {
  const params = new URLSearchParams({
    cftc_contract_market_code: CONTRACT_CODE,
    $select: "report_date_as_yyyy_mm_dd,lev_money_positions_long,lev_money_positions_short",
    $order: "report_date_as_yyyy_mm_dd DESC",
    $limit: String(FETCH_ROWS)
  });
  const res = await fetch(`${API_URL}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("unexpected response shape (not an array)");
  return json;
}

async function main() {
  try {
    const rows = await fetchRows();
    if (rows.length < 2) throw new Error(`too few rows returned (${rows.length})`);

    // Ascending by date so index i's trailing window is rows[0..i].
    const series = rows
      .map((r) => ({
        date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
        net: Number(r.lev_money_positions_long) - Number(r.lev_money_positions_short)
      }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (!series.length) throw new Error("no usable rows after parsing");

    // Percentile rank for every week we have at least a full trailing
    // window for, so the page can chart a history, not just today's dot.
    // If fewer than WINDOW_WEEKS total weeks exist yet (early on), fall
    // back to whatever window is available rather than producing nothing.
    const history = [];
    for (let i = 0; i < series.length; i++) {
      const windowStart = Math.max(0, i - WINDOW_WEEKS + 1);
      const window = series.slice(windowStart, i + 1).map((r) => r.net);
      if (window.length < 8) continue; // too few points for a meaningful rank
      history.push({ date: series[i].date, index: Math.round(percentileRank(series[i].net, window) * 10) / 10 });
    }

    if (!history.length) throw new Error("could not compute any percentile-rank points");

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      windowWeeks: WINDOW_WEEKS,
      history: history.slice(-52) // ~1 year of weekly points is plenty for the chart
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: ${out.history.length} weekly points, latest COT Index = ${out.history[out.history.length - 1].index}.`);
  } catch (err) {
    console.warn(`[cftc] failed to fetch/compute COT Index: ${err.message}.`);
    const fallback = {
      updated: new Date().toISOString(),
      source: "seed",
      live: false,
      windowWeeks: WINDOW_WEEKS,
      history: []
    };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: kept empty/seed value, marked not live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
