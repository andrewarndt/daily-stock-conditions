#!/usr/bin/env node
/**
 * Refreshes data/aaii.json (AAII Investor Sentiment Survey -- weekly
 * Bullish/Neutral/Bearish %, for the Sentiment tab's Positioning group).
 *
 * Closes gap checklist item 3 (Dark_Pool_Access_and_Full_Gap_Checklist.txt):
 * free retail sentiment survey, dates to 1987. AAII's full historical
 * dataset is members-only, but the public results page
 * (aaii.com/sentimentsurvey) plainly server-renders the current week
 * plus the prior 3 weeks with no login required -- confirmed against a
 * live pull, not assumed. No public JSON API is exposed, so this
 * regexes the "Recent weekly results" block straight out of the HTML,
 * same approach as fetch-putcall.mjs uses for Cboe. Fragile in two
 * ways: an AAII site redesign could break the regex, and the site also
 * sits behind bot-protection that occasionally serves a challenge page
 * instead of the real one even with a normal browser User-Agent
 * (observed directly while building this -- same request succeeded on
 * a retry with no other change). On any failure -- parse miss or
 * challenge page alike -- keeps the previous value and marks it
 * not-live, same fallback convention as the rest of this repo's fetch
 * scripts, so a bad run just skips a week rather than breaking the page.
 *
 * Builds a rolling history (like fetch-putcall.mjs) by merging each
 * scrape's ~4 weeks into a stored series de-duped by date, so the
 * chart fills in with real history over time even though each
 * individual pull only ever offers a few weeks.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "aaii.json");

const URL = "https://www.aaii.com/sentimentsurvey";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
};

const HISTORY_LIMIT = 104; // ~2 years of weekly points

// Matches one "weekending" card: MM/D/YYYY date, then bullish/neutral/
// bearish bars in that fixed order (confirmed against a live pull).
const WEEK_RE = /<div class="weekending">\s*<div class="datebars">\s*<div class="date">(\d{1,2}\/\d{1,2}\/\d{4})<\/div>\s*<div class="bars">\s*<div class="bar bullish" style="width:([\d.]+)%">[\d.]+%<\/div>\s*<div class="bar neutral" style="width:([\d.]+)%">[\d.]+%<\/div>\s*<div class="bar bearish" style="width:([\d.]+)%">[\d.]+%<\/div>/g;

function toIsoDate(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeHistory(previousHistory, points) {
  const history = Array.isArray(previousHistory) ? previousHistory.slice() : [];
  for (const point of points) {
    const existingIdx = history.findIndex((h) => h.date === point.date);
    if (existingIdx >= 0) history[existingIdx] = point;
    else history.push(point);
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return history.slice(-HISTORY_LIMIT);
}

async function main() {
  const previous = await loadPrevious();

  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const points = [];
    let m;
    WEEK_RE.lastIndex = 0;
    while ((m = WEEK_RE.exec(html)) !== null) {
      const bullish = Number(m[2]), neutral = Number(m[3]), bearish = Number(m[4]);
      if (![bullish, neutral, bearish].every(Number.isFinite)) continue;
      // Sanity check -- these three should always sum to ~100%; skip a
      // week that doesn't rather than trust a mis-parsed block.
      if (Math.abs(bullish + neutral + bearish - 100) > 1.5) continue;
      points.push({ date: toIsoDate(m[1]), bullish, neutral, bearish });
    }
    if (!points.length) throw new Error('could not find any "weekending" blocks in the page');

    const history = mergeHistory(previous?.history, points);
    const latest = history[history.length - 1];

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      asof: latest.date,
      bullish: latest.bullish,
      neutral: latest.neutral,
      bearish: latest.bearish,
      spread: Math.round((latest.bullish - latest.bearish) * 10) / 10,
      history
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: ${points.length} week(s) scraped, ${history.length} pts in history, latest ${latest.date} bull=${latest.bullish} bear=${latest.bearish}.`);
  } catch (err) {
    console.warn(`[aaii] failed to fetch sentiment survey: ${err.message}.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          asof: null,
          bullish: 37.5,
          neutral: 31.0,
          bearish: 31.5,
          spread: 6.0,
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
