#!/usr/bin/env node
/**
 * Refreshes data/sector-ratios.json: ~6 months of daily closes for SPY,
 * RSP (its equal-weight counterpart), and all 11 GICS sectors in both
 * cap-weight (SPDR "XL*" ETFs) and equal-weight (Invesco "RSP*" ETFs)
 * form, stored as a rolling array rather than re-fetched from scratch
 * every run.
 *
 * Equal-weight side added per Dark_Pool_Access_and_Full_Gap_Checklist.txt
 * item 5: the existing Sector/SPY Ratio panel is effectively cap-weighted
 * (a sector ETF's own price is cap-weighted by construction), which can't
 * tell you whether a sector's strength is broad or concentrated in one or
 * two mega-caps. Equal-weight tickers confirmed against the live endpoint
 * before wiring in, not assumed -- Invesco renamed this whole ETF family
 * in 2023 (e.g. RYT -> RSPT), so an older ticker list would be stale.
 * The page renders a toggle between the two rather than a second row of
 * cards -- see sector-ratios.html.
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
 * covers 6 months with a small buffer, and the whole file stays under a
 * couple hundred KB even at 24 symbols.
 *
 * The ratio itself (sector close / SPY close, either weighting) is NOT
 * computed here -- the page computes it client-side from the aligned
 * close arrays, so nothing needs recomputing if the ratio definition
 * ever changes.
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
  xlk: { name: "Technology", ticker: "XLK", equalTicker: "RSPT" },
  xlf: { name: "Financials", ticker: "XLF", equalTicker: "RSPF" },
  xlv: { name: "Health Care", ticker: "XLV", equalTicker: "RSPH" },
  xly: { name: "Consumer Disc.", ticker: "XLY", equalTicker: "RSPD" },
  xlp: { name: "Consumer Staples", ticker: "XLP", equalTicker: "RSPS" },
  xle: { name: "Energy", ticker: "XLE", equalTicker: "RSPG" },
  xli: { name: "Industrials", ticker: "XLI", equalTicker: "RSPN" },
  xlb: { name: "Materials", ticker: "XLB", equalTicker: "RSPM" },
  xlu: { name: "Utilities", ticker: "XLU", equalTicker: "RSPU" },
  xlre: { name: "Real Estate", ticker: "XLRE", equalTicker: "RSPR" },
  xlc: { name: "Communication Svcs.", ticker: "XLC", equalTicker: "RSPC" }
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
    const spyEqualMap = toMap(json.spyEqualWeight);
    const sectorMaps = {};
    const sectorEqualMaps = {};
    for (const id of Object.keys(SECTORS)) {
      sectorMaps[id] = toMap(json.sectors?.[id]?.close);
      sectorEqualMaps[id] = toMap(json.sectors?.[id]?.closeEqualWeight);
    }
    return { hasPrevious: dates.length > 0, spyMap, spyEqualMap, sectorMaps, sectorEqualMaps };
  } catch {
    return {
      hasPrevious: false, spyMap: {}, spyEqualMap: {},
      sectorMaps: Object.fromEntries(Object.keys(SECTORS).map((id) => [id, {}])),
      sectorEqualMaps: Object.fromEntries(Object.keys(SECTORS).map((id) => [id, {}]))
    };
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
  const { hasPrevious, spyMap, spyEqualMap, sectorMaps, sectorEqualMaps } = await loadPrevious();
  const range = hasPrevious ? RANGE_INCREMENTAL : RANGE_BACKFILL;

  const spyResult = await fetchAndMerge("SPY", spyMap, range);
  const spyEqualResult = await fetchAndMerge("RSP", spyEqualMap, range);
  const mergedSpyMap = spyResult.map;

  const sectorResults = {};
  const sectorEqualResults = {};
  for (const [id, def] of Object.entries(SECTORS)) {
    sectorResults[id] = await fetchAndMerge(def.ticker, sectorMaps[id], range);
    sectorEqualResults[id] = await fetchAndMerge(def.equalTicker, sectorEqualMaps[id], range);
  }

  if (Object.keys(mergedSpyMap).length === 0) {
    throw new Error("No SPY data available (fresh fetch failed and no previous data exists) -- aborting without writing a broken file.");
  }

  const dates = Object.keys(mergedSpyMap).sort().slice(-MAX_DAYS);
  const spy = alignToDates(mergedSpyMap, dates);
  const spyEqualWeight = alignToDates(spyEqualResult.map, dates);

  const sectors = {};
  for (const [id, def] of Object.entries(SECTORS)) {
    sectors[id] = {
      name: def.name,
      ticker: def.ticker,
      close: alignToDates(sectorResults[id].map, dates),
      live: sectorResults[id].live,
      equalTicker: def.equalTicker,
      closeEqualWeight: alignToDates(sectorEqualResults[id].map, dates),
      equalWeightLive: sectorEqualResults[id].live
    };
  }

  const out = {
    updated: new Date().toISOString(),
    source: spyResult.live ? "live" : "seed",
    spyLive: spyResult.live, // every cap-weight ratio depends on SPY as the denominator; the page ANDs this with each sector's own live flag
    spyEqualWeightLive: spyEqualResult.live, // same, for RSP and the equal-weight ratios
    dates,
    spy,
    spyEqualWeight,
    sectors
  };

  await writeFile(OUT_PATH, JSON.stringify(out) + "\n", "utf8");
  const allResults = [spyResult, spyEqualResult, ...Object.values(sectorResults), ...Object.values(sectorEqualResults)];
  const liveCount = allResults.filter((r) => r.live).length;
  console.log(`Wrote ${OUT_PATH}: ${dates.length} trading days, ${liveCount}/${allResults.length} symbols live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
