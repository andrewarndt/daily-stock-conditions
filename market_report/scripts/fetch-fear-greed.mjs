#!/usr/bin/env node
/**
 * Refreshes data/fear-greed.json (Market Sentiment gauge on sentiment.html)
 * from CNN's actual Fear & Greed Index -- the real 0-100 composite (market
 * momentum, price strength/breadth, put/call, junk bond demand, volatility,
 * safe haven demand), not a homegrown proxy.
 *
 * Source: CNN's own dataviz endpoint (production.dataviz.cnn.io), the same
 * one cnn.com/markets/fear-and-greed calls client-side. No key/auth needed,
 * but it 403s ("I'm a teapot. You're a bot.") without a browser-like
 * User-Agent + a Referer pointing at the CNN page that embeds it -- both
 * set below. Unofficial/undocumented, so treat as best-effort: on any
 * failure this falls back to the previous value already in the file rather
 * than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "fear-greed.json");

const URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "Referer": "https://www.cnn.com/markets/fear-and-greed",
  "Accept": "application/json"
};

// CNN's own rating strings, mapped to this site's zone labels (gauge.js
// uses the same five bands: 0-20/20-40/40-60/60-80/80-100).
const RATING_LABELS = {
  "extreme fear": "Extreme Fear",
  "fear": "Fear",
  "neutral": "Neutral",
  "greed": "Greed",
  "extreme greed": "Extreme Greed"
};

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function zoneFor(score) {
  if (score < 20) return "Extreme Fear";
  if (score < 40) return "Fear";
  if (score < 60) return "Neutral";
  if (score < 80) return "Greed";
  return "Extreme Greed";
}

async function main() {
  const previous = await loadPrevious();

  try {
    const res = await fetch(URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const fg = json.fear_and_greed;
    const score = Number(fg?.score);
    if (!Number.isFinite(score)) throw new Error("missing/bad score in response");

    const rating = RATING_LABELS[String(fg.rating || "").toLowerCase()] || zoneFor(score);

    const out = {
      updated: new Date().toISOString(),
      source: "live",
      live: true,
      score: Math.round(score * 10) / 10,
      rating,
      previousClose: Number.isFinite(Number(fg.previous_close)) ? Number(fg.previous_close) : null,
      previousWeek: Number.isFinite(Number(fg.previous_1_week)) ? Number(fg.previous_1_week) : null,
      previousMonth: Number.isFinite(Number(fg.previous_1_month)) ? Number(fg.previous_1_month) : null,
      previousYear: Number.isFinite(Number(fg.previous_1_year)) ? Number(fg.previous_1_year) : null
    };

    await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: score=${out.score} (${out.rating}), live.`);
  } catch (err) {
    console.warn(`[cnn] failed to fetch fear & greed index: ${err.message}.`);
    const fallback = previous
      ? { ...previous, source: "seed", live: false, updated: new Date().toISOString() }
      : {
          updated: new Date().toISOString(),
          source: "seed",
          live: false,
          score: 62,
          rating: "Greed",
          previousClose: null,
          previousWeek: null,
          previousMonth: null,
          previousYear: null
        };
    await writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT_PATH}: kept previous/seed value, marked not live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
