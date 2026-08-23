#!/usr/bin/env node
/**
 * Refreshes data/fed-watch.json (Fed Watch section on fed-economic.html)
 * with real implied FOMC rate-path odds -- replacing the old hardcoded
 * illustrative percentages (see Market_Desk_Sprint_Checklist.txt item 2).
 *
 * Source: Kalshi's public market-data API (api.elections.kalshi.com), no
 * API key required. Kalshi is a CFTC-regulated exchange; its
 * "KXFEDDECISION-<yy><mon>" event for each FOMC meeting is a set of
 * mutually-exclusive binary markets (Cut >25bps / Cut 25bps / Hold /
 * Hike 25bps / Hike >25bps) that settle directly on the Fed's official
 * decision (see settlement_sources on the event). This is not CME
 * FedWatch (that requires a paid API, starting at $25/mo) -- it's a
 * different, independently real market measuring the same thing:
 * money-weighted probability of each outcome.
 *
 * Each market's own yes_bid/yes_ask midpoint is used as that bucket's
 * probability (falls back to last_price if the book is empty), then the
 * whole meeting's buckets are normalized to sum to 100% -- they're
 * separate order books, not one multi-outcome book, so they don't sum
 * to exactly 1 on their own.
 *
 * On any failure (network, no open events, bad data), falls back to the
 * previous data/fed-watch.json contents with live:false rather than
 * failing the whole run, same convention as this repo's other fetch
 * scripts.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "fed-watch.json");

const API_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES_TICKER = "KXFEDDECISION";
const MEETINGS_TO_SHOW = 2;

// Bucket display order + labels, keyed by the market's own custom_strike
// shape ({"Cut": ">25"} / {"Cut": "25"} / {"Hike": "0"} / {"Hike": "25"} /
// {"Hike": ">25"}) rather than the ticker suffix, which isn't semantic.
const BUCKET_ORDER = [
  { match: (s) => s.Cut === ">25", key: "cut50", label: "Cut 50+ bp" },
  { match: (s) => s.Cut === "25", key: "cut25", label: "Cut 25 bp" },
  { match: (s) => s.Hike === "0", key: "hold", label: "Hold" },
  { match: (s) => s.Hike === "25", key: "hike25", label: "Hike 25 bp" },
  { match: (s) => s.Hike === ">25", key: "hike50", label: "Hike 50+ bp" }
];

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function fmtMeetingLabel(strikeDate) {
  const d = new Date(strikeDate);
  if (isNaN(d)) return strikeDate;
  return "FOMC — " + d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Midpoint of the live book when there's one, else the last trade -- both
// already denominated in dollars, i.e. directly a 0..1 probability.
function marketProbability(m) {
  const bid = Number(m.yes_bid_dollars);
  const ask = Number(m.yes_ask_dollars);
  if (Number.isFinite(bid) && Number.isFinite(ask) && (bid > 0 || ask > 0)) {
    return (bid + ask) / 2;
  }
  const last = Number(m.last_price_dollars);
  return Number.isFinite(last) ? last : 0;
}

async function fetchMeeting(event) {
  const data = await getJson(`${API_BASE}/markets?event_ticker=${event.event_ticker}`);
  const markets = data.markets || [];

  const buckets = BUCKET_ORDER.map((def) => {
    const m = markets.find((mkt) => mkt.custom_strike && def.match(mkt.custom_strike));
    return m ? { key: def.key, label: def.label, prob: marketProbability(m) } : null;
  }).filter(Boolean);

  if (!buckets.length) throw new Error(`no recognized buckets for ${event.event_ticker}`);

  // Separate order books don't sum to exactly 100% -- normalize so the
  // bars on the page always add up cleanly.
  const total = buckets.reduce((sum, b) => sum + b.prob, 0);
  const normalized = total > 0
    ? buckets.map((b) => ({ key: b.key, label: b.label, pct: Math.round((b.prob / total) * 1000) / 10 }))
    : buckets.map((b) => ({ key: b.key, label: b.label, pct: 0 }));

  return {
    date: event.strike_date,
    label: fmtMeetingLabel(event.strike_date),
    buckets: normalized
  };
}

async function main() {
  const previous = await loadPrevious();

  try {
    const eventsData = await getJson(`${API_BASE}/events?series_ticker=${SERIES_TICKER}&status=open`);
    const events = (eventsData.events || [])
      .filter((e) => e.strike_date)
      .sort((a, b) => new Date(a.strike_date) - new Date(b.strike_date))
      .slice(0, MEETINGS_TO_SHOW);

    if (!events.length) throw new Error("no open KXFEDDECISION events returned");

    const meetings = await Promise.all(events.map(fetchMeeting));

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      provider: "Kalshi (KXFEDDECISION)",
      meetings
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: ${meetings.length} meeting(s), live.`);
  } catch (err) {
    console.warn(`[kalshi] failed to fetch Fed Watch odds: ${err.message}.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          provider: "Kalshi (KXFEDDECISION)",
          meetings: []
        };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: kept previous/seed value, marked not live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
