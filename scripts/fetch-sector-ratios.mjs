#!/usr/bin/env node
/**
 * Refreshes data/sector-ratios.json: ~6 months of daily closes for SPY and
 * all 11 sector SPDR ETFs, stored as a rolling array rather than
 * re-fetched from scratch every run.
 *
 * Source: Yahoo Finance's unofficial chart endpoint
 * (query1.finance.yahoo.com/v8/finance/chart/{symbol}) -- free, no API
 * key, confirmed working against the live endpoint. It's unofficial and
 * undocumented, so treat it as best-effort: on any symbol failure this
 * run, that symbol's previously stored series is carried forward
 * untouched and flagged `live: false`.
 *
 * Update strategy: first run ever backfills a full year per symbol (only
 * needs to happen once); every run after that only asks for the last
 * month (`RANGE_INCREMENTAL`), which comfortably covers any gap even if a
 * few scheduled runs were missed, and merges those points into the
 * existing stored series by date (new values overwrite, e.g. if today's
 * bar was still settling last time). The merged series is then trimmed to
 * the trailing MAX_DAYS trading days -- at ~21 trading days/month, 130
 * covers 6 months with a small buffer, and the whole file stays a few
 * hundred KB at most for 12 symbols.
 *
 * The ratio itself (sector close / SPY close) is NOT computed here -- the
 * page computes it client-side from the two aligned close arrays, so nothing
 * needs recomputing if the ratio definition ever changes.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "sector-ratios.json");

const MAX_DAYS = 130;
const RANGE_BACKFILL = "1y";
const RANGE_INCREMENTAL = "1mo";

const SECTORS = {
  xlk: { name: "Technology", ticker: "XLK" },
  xlf: { name: "Financials", ticker: "XLF" },
  xlv: { name: "Health Care", ticker: "XLV" },
  xly: { name: "Consumer Disc.", ticker: "XLY" },
  xlp: { name: "Consumer Staples", ticker: "XLP" },
  xle: { name: "Energy", ticker: "XLE" },
  xli: { name: "Industrials", ticker: "XLI" },
  xlb: { name: "Materials", ticker: "XLB" },
  xlu: { name: "Utilities", ticker: "XLU" },
  xlre: { name: "Real Estate", ticker: "XLRE" },
  xlc: { name: "Communication Svcs.", ticker: "XLC" }
};

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const dates = json.dates || [];
    const toMap = (arr) => {
      const map = {};
      (arr || []).forEach((v, i) => { if (v != null) map[dates[i]] = v; });
      return map;
    };
    const spyMap = toMap(json.spy);
    const sectorMaps = {};
    for (const id of Object.keys(SECTORS)) {
      sectorMaps[id] = toMap(json.sectors?.[id]?.close);
    }
    return { hasPrevious: dates.length > 0, spyMap, sectorMaps };
  } catch {
    return { hasPrevious: false, spyMap: {}, sectorMaps: Object.fromEntries(Object.keys(SECTORS).map((id) => [id, {}])) };
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
 * symbol has a value for every date in `dates` -- keeps chart code simple,
 * never has to handle a hole mid-series. */
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

async function fetchAndMerge(symbol, prevMap, range) {
  try {
    const fresh = await fetchYahooDaily(symbol, range);
    return { map: { ...prevMap, ...fresh }, live: true };
  } catch (err) {
    console.warn(`[yahoo] failed for ${symbol}: ${err.message}. Keeping previously stored series.`);
    return { map: prevMap, live: false };
  }
}

async function main() {
  const { hasPrevious, spyMap, sectorMaps } = await loadPrevious();
  const range = hasPrevious ? RANGE_INCREMENTAL : RANGE_BACKFILL;

  const spyResult = await fetchAndMerge("SPY", spyMap, range);
  const mergedSpyMap = spyResult.map;

  const sectorResults = {};
  for (const [id, def] of Object.entries(SECTORS)) {
    sectorResults[id] = await fetchAndMerge(def.ticker, sectorMaps[id], range);
  }

  if (Object.keys(mergedSpyMap).length === 0) {
    throw new Error("No SPY data available (fresh fetch failed and no previous data exists) -- aborting without writing a broken file.");
  }

  const dates = Object.keys(mergedSpyMap).sort().slice(-MAX_DAYS);
  const spy = alignToDates(mergedSpyMap, dates);

  const sectors = {};
  for (const [id, def] of Object.entries(SECTORS)) {
    sectors[id] = {
      name: def.name,
      ticker: def.ticker,
      close: alignToDates(sectorResults[id].map, dates),
      live: sectorResults[id].live
    };
  }

  const out = {
    updated: new Date().toISOString(),
    source: spyResult.live ? "live" : "seed",
    spyLive: spyResult.live, // every ratio depends on SPY as the denominator; the page ANDs this with each sector's own live flag
    dates,
    spy,
    sectors
  };

  await writeFile(OUT_PATH, JSON.stringify(out) + "\n", "utf8");
  const liveCount = [spyResult, ...Object.values(sectorResults)].filter((r) => r.live).length;
  console.log(`Wrote ${OUT_PATH}: ${dates.length} trading days, ${liveCount}/12 symbols live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
