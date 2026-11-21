#!/usr/bin/env node
/**
 * Refreshes data/skew.json (Skew Structure chart on sector-ratios.html) --
 * SPX implied volatility by strike, today vs. ~1 month ago.
 *
 * Source: Tradier's market-data API (api.tradier.com, TRADIER_TOKEN), since
 * 2026-11-21. Until 2026-11-19 this read Cboe's delayed-quotes chain
 * (cdn.cboe.com/.../_SPX.json), which has answered a Cloudflare 403 since
 * 2026-11-20. Tradier's default expiration list for SPX is the standard
 * monthly (AM-settled, root "SPX") set, the same set the Cboe regex kept.
 * IV is solved here, not taken from the feed: Black-76 on each quote's
 * bid/ask mid, with the forward implied from put-call parity at the strike
 * where call and put mids are closest (this absorbs SPX's dividend carry).
 * Tradier's own ORATS IVs are 0 on many SPX contracts and ran ~2 vol pts
 * above a mid solve on SPY (F:\Stock Market\BUGS\TRAPS.md #93). Spot is the
 * quote's `last` (Tradier leaves `close` empty for indexes). No historical
 * chain snapshots are available (it's a live quote, not a time series), so
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
 * Needs TRADIER_TOKEN. On any failure, falls back to the previous value
 * already in data/skew.json rather than failing the run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "skew.json");

const TRADIER = "https://api.tradier.com/v1";
const RATE = 0.04; // discount rate for Black-76; the forward comes from parity, so this barely moves the IV

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

async function tradier(pathname, params) {
  const token = process.env.TRADIER_TOKEN;
  if (!token) throw new Error("TRADIER_TOKEN not set");
  const url = `${TRADIER}${pathname}?${new URLSearchParams(params)}`;
  let last;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.ok) return res.json();
    last = new Error(`HTTP ${res.status} ${pathname}`);
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw last;
}

const asList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const ncdf = (x) => {
  // Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};
function black76(F, K, T, vol, type) {
  const sd = vol * Math.sqrt(T), d1 = (Math.log(F / K) + sd * sd / 2) / sd, d2 = d1 - sd, df = Math.exp(-RATE * T);
  return type === "call" ? df * (F * ncdf(d1) - K * ncdf(d2)) : df * (K * ncdf(-d2) - F * ncdf(-d1));
}
/** IV from a two-sided quote's mid, or null (no bid, crossed, or mid at/below intrinsic + half the spread). */
function solveIv(F, K, T, bid, ask, type) {
  if (!(bid > 0 && ask >= bid && T > 0)) return null;
  const mid = (bid + ask) / 2, df = Math.exp(-RATE * T);
  const intrinsic = df * Math.max(0, type === "call" ? F - K : K - F);
  if (mid - intrinsic <= Math.max(0.05, (ask - bid) / 2)) return null;
  let lo = 0.005, hi = 5;
  if (black76(F, K, T, hi, type) < mid) return null;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (black76(F, K, T, m, type) < mid) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
/** Year fraction from `fromMs` to the AM settlement (09:30 ET) of `expiry`. */
function yearsToAmSettle(expiry, fromMs) {
  const noonUtc = new Date(expiry + "T12:00:00Z");
  const etHour = Number(noonUtc.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const offset = 12 - etHour; // 4 (EDT) or 5 (EST)
  const settle = Date.UTC(+expiry.slice(0, 4), +expiry.slice(5, 7) - 1, +expiry.slice(8, 10), 9 + offset, 30);
  return (settle - fromMs) / (365 * 86400000);
}
/** 16:00 ET on the New York date of `ms` if that is already past, else `ms` itself (quotes are the close's). */
function quoteTime(ms) {
  const day = new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const noonUtc = new Date(day + "T12:00:00Z");
  const etHour = Number(noonUtc.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const close = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 16 + 12 - etHour, 0);
  return Math.min(ms, close);
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
    const quote = asList((await tradier("/markets/quotes", { symbols: "SPX" }))?.quotes?.quote)[0];
    const spot = quote?.close ?? quote?.last;
    if (!Number.isFinite(spot) || spot <= 0) throw new Error("no SPX last price");
    const tradeMs = Number(quote.trade_date) || Date.now();
    const expiries = asList((await tradier("/markets/options/expirations", { symbol: "SPX" }))?.expirations?.date);
    if (!expiries.length) throw new Error("no SPX expirations");
    const today = new Date();
    const expiry = pickExpiry(expiries, today);
    if (!expiry) throw new Error("no expiry found past MIN_DTE");

    const raw = asList((await tradier("/markets/options/chains", { symbol: "SPX", expiration: expiry, greeks: "false" }))?.options?.option)
      .filter((o) => o.root_symbol === "SPX" && parseOption(o.symbol));
    if (!raw.length) throw new Error(`no SPX-root contracts for ${expiry}`);
    const T = yearsToAmSettle(expiry, quoteTime(tradeMs));
    // Forward from put-call parity at the two-sided strike where |call mid - put mid| is smallest.
    const byStrike = new Map();
    for (const o of raw) {
      if (!(o.bid > 0 && o.ask >= o.bid)) continue;
      const k = byStrike.get(o.strike) || {};
      k[o.option_type] = (o.bid + o.ask) / 2;
      byStrike.set(o.strike, k);
    }
    let fwd = null, best = Infinity;
    for (const [K, m] of byStrike) {
      if (m.call == null || m.put == null || Math.abs(K / spot - 1) > 0.05) continue;
      if (Math.abs(m.call - m.put) < best) { best = Math.abs(m.call - m.put); fwd = K + Math.exp(RATE * T) * (m.call - m.put); }
    }
    if (!fwd) throw new Error("no two-sided near-the-money strike for the parity forward");
    const chain = raw.map((o) => ({ ...parseOption(o.symbol), iv: solveIv(fwd, o.strike, T, o.bid, o.ask, o.option_type), oi: o.open_interest }))
      .filter((c) => c.iv != null);

    const curve = buildCurve(chain, spot);
    if (curve.length < BUCKET_PCTS.length) throw new Error(`only resolved ${curve.length}/${BUCKET_PCTS.length} strike buckets`);

    // The session the quotes belong to: the New York date of SPX's last print (a Saturday run is Friday's close).
    const asof = new Date(tradeMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
      forward: Math.round(fwd * 100) / 100,
      method: "Black-76 IV from Tradier bid/ask mids, forward from put-call parity",
      buckets,
      history
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: expiry=${expiry} spot=${spot.toFixed(2)}, ${history.length} pts in history, live.`);
  } catch (err) {
    console.warn(`[tradier] failed to fetch SPX skew: ${err.message}.`);
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
