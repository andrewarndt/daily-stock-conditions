#!/usr/bin/env node
/**
 * Refreshes data/putcall.json (Put/Call Ratio section on sentiment.html)
 * from Cboe's own daily market statistics page -- the real Total Put/Call
 * Ratio (all products: index + equity + ETP), not a proxy.
 *
 * Source: https://www.cboe.com/markets/us/options/market-statistics/daily/
 * This is server-rendered (Next.js) with the day's stats embedded directly
 * in the HTML as an escaped JSON blob -- no public JSON API is exposed for
 * it, so this pulls the page and regexes the "TOTAL PUT/CALL RATIO" value
 * and its "selectedDate" straight out of that blob. Fragile in the sense
 * that a Cboe site redesign could break the pattern, but the same
 * best-effort/fallback approach as the rest of this repo's fetch scripts
 * applies: on any failure, keep the previous value and mark it not-live.
 *
 * Cboe's stats are end-of-day (finalized once, after that day's options
 * close) -- unlike the Fear & Greed gauge this isn't something that moves
 * within a session, so a morning run mostly just re-confirms the prior
 * night's close; the evening run after that day's close is what actually
 * moves the number.
 *
 * Builds a small rolling history (last 20 trading days) by appending each
 * new `asof` date once and de-duping if a run re-fetches the same day, so
 * the sentiment.html trend chart fills in with real data day by day.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "putcall.json");

const URL = "https://www.cboe.com/markets/us/options/market-statistics/daily/";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
};

const HISTORY_LIMIT = 20;

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeHistory(previousHistory, point) {
  const history = Array.isArray(previousHistory) ? previousHistory.slice() : [];
  const existingIdx = history.findIndex((h) => h.date === point.date);
  if (existingIdx >= 0) history[existingIdx] = point;
  else history.push(point);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return history.slice(-HISTORY_LIMIT);
}

async function main() {
  const previous = await loadPrevious();

  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const ratioMatch = html.match(/TOTAL PUT\/CALL RATIO\\",\\"value\\":\\"([\d.]+)\\"/);
    const dateMatch = html.match(/\\"selectedDate\\":\\"(\d{4}-\d{2}-\d{2})\\"/);
    if (!ratioMatch || !dateMatch) throw new Error("could not find TOTAL PUT/CALL RATIO or selectedDate in page");

    const ratio = Number(ratioMatch[1]);
    const asof = dateMatch[1];
    if (!Number.isFinite(ratio)) throw new Error(`bad ratio value: ${ratioMatch[1]}`);

    const history = mergeHistory(previous?.history, { date: asof, ratio });
    const prior = history.length > 1 ? history[history.length - 2].ratio : null;

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      asof,
      ratio,
      prior,
      history
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: ratio=${ratio} as of ${asof} (${history.length} pts in history), live.`);
  } catch (err) {
    console.warn(`[cboe] failed to fetch put/call ratio: ${err.message}.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          asof: null,
          ratio: 0.61,
          prior: 0.68,
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
