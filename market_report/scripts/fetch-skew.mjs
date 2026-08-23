#!/usr/bin/env node
/**
 * Refreshes data/skew.json (Skew Structure chart on sector-ratios.html) --
 * SPX implied volatility by strike, today vs. ~1 month ago.
 *
 * Source: Cboe's own public delayed-quotes options-chain feed
 * (cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json) -- free, no
 * API key, same cdn.cboe.com host fetch-volatility.mjs already pulls VIX
 * family CSVs from. Returns the full live SPX chain (every strike, every
 * standard monthly expiry) with a Cboe-computed `iv` per contract, plus the
 * underlying's `current_price` as spot. No historical chain snapshots are
 * available from this endpoint (it's a live quote, not a time series), so
 * -- same convention as fetch-putcall.mjs and fetch-aaii.mjs -- this script
 * builds its own rolling daily history by appending each run's curve, and
 * the "1 month ago" comparison line fills in from that once ~a month of
 * history has accumulated (empty/thin at first, same as those charts).
 *
 * Target expiry: the standard monthly (3rd-Friday) contract with days-to-
 * expiry closest to TARGET_DTE, among expiries at least MIN_DTE out --
 * a ~30-45 day tenor is the conventional "front month" skew read, similar
 * spirit to VIX's own 30-day constant-maturity construction.
 *
 * Strike buckets are read off the OTM side only (puts below spot, calls
 * above spot), which is the standard skew convention -- OTM quotes are the
 * liquid, actively-quoted side; the matching ITM contract on the other side
 * of the same strike is usually thin/stale. At-the-money (100%) averages
 * the nearest put and call since neither side is more OTM than the other
 * there.
 *
 * Requires no API key. On any failure, falls back to the previous value
 * already in data/skew.json rather than failing the run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "skew.json");

const URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
};

const OPTION_RE = /^SPX(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const BUCKET_PCTS = [80, 85, 90, 95, 100, 105, 110, 115, 120];
const TARGET_DTE = 32; // ~monthly, biased slightly past 30 so it's never same-week as an already-close expiry
const MIN_DTE = 15; // skip an expiry too close to avoid pin/gamma noise dominating the read
const HISTORY_LIMIT = 90; // ~4 months of trading days, comfortably covers the 1-month-ago lookback
const MONTH_AGO_TARGET_DAYS = 30;

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseOption(symbol) {
  const m = OPTION_RE.exec(symbol);
  if (!m) return null;
  const [, yy, mm, dd, cp, strikeRaw] = m;
  return {
    expiry: `20${yy}-${mm}-${dd}`,
    type: cp === "C" ? "call" : "put",
    strike: Number(strikeRaw) / 1000
  };
}

function pickExpiry(expiries, today) {
  let best = null, bestDiff = Infinity;
  for (const expiry of expiries) {
    const dte = Math.round((new Date(expiry + "T00:00:00Z") - today) / 86400000);
    if (dte < MIN_DTE) continue;
    const diff = Math.abs(dte - TARGET_DTE);
    if (diff < bestDiff) { bestDiff = diff; best = expiry; }
  }
  return best;
}

/** Nearest strike (by absolute distance) in `list` to `target`, requiring a
 * finite, sane IV (Cboe's theo model can return noisy values for
 * zero-interest deep-ITM/deep-OTM strikes, but everything in our 80-120%
 * bucket range trades actively enough that this is mostly a safety net). */
function nearestByStrike(list, target) {
  let best = null, bestDiff = Infinity;
  for (const c of list) {
    if (!Number.isFinite(c.iv) || c.iv <= 0 || c.iv > 5) continue;
    const diff = Math.abs(c.strike - target);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best;
}

function buildCurve(chain, spot) {
  const puts = chain.filter((c) => c.type === "put");
  const calls = chain.filter((c) => c.type === "call");

  return BUCKET_PCTS.map((pct) => {
    const target = spot * (pct / 100);
    if (pct === 100) {
      const p = nearestByStrike(puts, target), c = nearestByStrike(calls, target);
      const ivs = [p, c].filter(Boolean).map((x) => x.iv);
      if (!ivs.length) return null;
      const strike = (p || c).strike;
      return { pct, strike, iv: (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 };
    }
    const side = pct < 100 ? puts : calls;
    const hit = nearestByStrike(side, target);
    if (!hit) return null;
    return { pct, strike: hit.strike, iv: hit.iv * 100 };
  }).filter(Boolean);
}

function mergeHistory(previousHistory, point) {
  const history = Array.isArray(previousHistory) ? previousHistory.slice() : [];
  const existingIdx = history.findIndex((h) => h.date === point.date);
  if (existingIdx >= 0) history[existingIdx] = point;
  else history.push(point);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return history.slice(-HISTORY_LIMIT);
}

/** Nearest history entry on or before ~30 calendar days behind `latestDate`,
 * same approach as fetch-volatility.mjs's findMonthAgo. */
function findMonthAgo(history, latestDate) {
  const target = new Date(latestDate);
  target.setUTCDate(target.getUTCDate() - MONTH_AGO_TARGET_DAYS);
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].date + "T00:00:00Z") <= target) return history[i];
  }
  return null;
}

async function main() {
  const previous = await loadPrevious();

  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const options = json?.data?.options;
    const spot = json?.data?.current_price;
    if (!Array.isArray(options) || !options.length) throw new Error("no options in response");
    if (!Number.isFinite(spot)) throw new Error("no current_price in response");

    const today = new Date();
    const expiries = new Set();
    const chainByExpiry = new Map();
    for (const o of options) {
      const parsed = parseOption(o.option);
      if (!parsed) continue;
      expiries.add(parsed.expiry);
      if (!chainByExpiry.has(parsed.expiry)) chainByExpiry.set(parsed.expiry, []);
      chainByExpiry.get(parsed.expiry).push({ ...parsed, iv: o.iv, oi: o.open_interest });
    }
    if (!expiries.size) throw new Error("no parsable SPX option symbols in response");

    const expiry = pickExpiry(expiries, today);
    if (!expiry) throw new Error("no expiry found past MIN_DTE");

    const curve = buildCurve(chainByExpiry.get(expiry), spot);
    if (curve.length < BUCKET_PCTS.length) throw new Error(`only resolved ${curve.length}/${BUCKET_PCTS.length} strike buckets`);

    const asof = String(json.timestamp || "").slice(0, 10) || today.toISOString().slice(0, 10);
    const point = { date: asof, expiry, spot, buckets: curve };
    const history = mergeHistory(previous?.history, point);

    const monthAgoEntry = findMonthAgo(history.slice(0, -1), asof);
    const monthAgoByPct = {};
    if (monthAgoEntry) for (const b of monthAgoEntry.buckets) monthAgoByPct[b.pct] = b.iv;

    const buckets = curve.map((b) => ({
      pct: b.pct,
      strike: b.strike,
      iv: b.iv,
      monthAgo: monthAgoByPct[b.pct]
    }));

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      asof,
      expiry,
      spot,
      buckets,
      history
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: expiry=${expiry} spot=${spot.toFixed(2)}, ${history.length} pts in history, live.`);
  } catch (err) {
    console.warn(`[cboe] failed to fetch SPX skew: ${err.message}.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          asof: null,
          expiry: null,
          spot: null,
          buckets: [],
          history: []
        };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: kept previous/seed value, marked not live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
