#!/usr/bin/env node
/**
 * Refreshes data/credit.json: ~6 months of daily closes for HYG (iShares
 * High Yield Corporate Bond ETF), for the Credit section on
 * sector-ratios.html.
 *
 * Closes the P1 gap flagged in Market_Desk_Sprint_Checklist.txt item 5:
 * the existing Daily Pre-Market Checklist's "Check Credit: HYG trending"
 * line had no equivalent on this site. Deliberately the plain HYG price
 * trend the checklist actually asks for -- not a HYG/IEF or HYG/TLT
 * spread proxy -- since that's the cheapest build that closes the real
 * gap, matching every other line item already covered here.
 *
 * Source: same Yahoo Finance unofficial chart endpoint already used by
 * fetch-sector-ratios.mjs (query1.finance.yahoo.com/v8/finance/chart) --
 * free, no API key. Same best-effort convention: on fetch failure, the
 * previously stored series is kept and flagged `live: false` rather than
 * failing the run.
 *
 * Update strategy mirrors fetch-sector-ratios.mjs: full-year backfill on
 * the very first run, incremental 1-month pulls merged by date after
 * that, trimmed to the trailing MAX_DAYS trading days.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "credit.json");

const SYMBOL = "HYG";
const NAME = "iShares iBoxx High Yield Corp Bond";
const MAX_DAYS = 130;
const RANGE_BACKFILL = "1y";
const RANGE_INCREMENTAL = "1mo";

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const dates = json.dates || [];
    const map = {};
    (json.close || []).forEach((v, i) => { if (v != null) map[dates[i]] = v; });
    return { hasPrevious: dates.length > 0, map };
  } catch {
    return { hasPrevious: false, map: {} };
  }
}

async function fetchYahooDaily(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketDeskBot/1.0; +https://andrewarndt.github.io/daily-stock-conditions/)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "no result in response");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const map = {};
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    // Daily bars land at the US market open (~13:30-14:30 UTC), comfortably
    // clear of UTC-date rollover either side, so a plain slice is safe.
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    map[date] = c;
  }
  return map;
}

/** Forward-fill (then back-fill, for a gap right at the start) so every
 * date in `dates` has a value -- keeps chart code simple. */
function alignToDates(map, dates) {
  const out = [];
  let last = null;
  for (const d of dates) {
    if (map[d] != null) last = map[d];
    out.push(last);
  }
  for (let i = 0; i < out.length && out[i] == null; i++) {
    const nextReal = out.find((v) => v != null);
    out[i] = nextReal ?? null;
  }
  return out;
}

async function main() {
  const { hasPrevious, map: prevMap } = await loadPrevious();
  const range = hasPrevious ? RANGE_INCREMENTAL : RANGE_BACKFILL;

  let mergedMap = prevMap;
  let live = true;
  try {
    const fresh = await fetchYahooDaily(SYMBOL, range);
    mergedMap = { ...prevMap, ...fresh };
  } catch (err) {
    console.warn(`[yahoo] failed for ${SYMBOL}: ${err.message}. Keeping previously stored series.`);
    live = false;
  }

  if (Object.keys(mergedMap).length === 0) {
    throw new Error("No HYG data available (fresh fetch failed and no previous data exists) -- aborting without writing a broken file.");
  }

  const dates = Object.keys(mergedMap).sort().slice(-MAX_DAYS);
  const close = alignToDates(mergedMap, dates);

  const out = {
    updated: new Date().toISOString(),
    source: live ? "live" : "seed",
    live,
    symbol: SYMBOL,
    name: NAME,
    dates,
    close
  };

  await writeFile(OUT_PATH, JSON.stringify(out) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH}: ${dates.length} trading days, live=${live}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
