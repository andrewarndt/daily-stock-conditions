#!/usr/bin/env node
/**
 * Live spot prices for every GEX ticker during the cash session.
 *
 * The GEX levels (data/gex/index.json, tickers/*.json) come from the PC's
 * after-close run, so their `spot` is the prior session's close. This feed
 * adds the current price for all of those symbols so the GEX tab can show
 * where each name trades now relative to its walls and gamma flip. Run by
 * session-loop.mjs every 5 minutes from the open to just after the close.
 *
 * Sources:
 *   - Alpaca Market Data snapshots (free IEX feed), 100 symbols per request.
 *     Price = latest IEX trade; if the IEX quote is newer, tight, and more
 *     than 0.5% away from that trade (a stale or odd print), the quote mid.
 *   - Yahoo Finance chart endpoint as the second source: every run checks
 *     SPY/QQQ/IWM/DIA plus 8 rotating names, and fills symbols Alpaca missed
 *     (up to 40). Where the two disagree by more than 0.5%, Yahoo's price is used.
 *
 * Output: data/gex-spot.json
 *   { updated, quotesAsOf, session, source: "live"|"seed", feed, count, priced,
 *     yahooChecked, yahooOverrides, prices: { SYM: [price, epochSeconds] } }
 * A run that gets no prices at all keeps the previous prices and writes
 * source "seed", which raises the site's "Data delayed" banner.
 *
 * Requires env vars ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.join(__dirname, "..", "data", "gex");
// Not inside data/gex/: the PC's GEX publisher (site_export.py --publish) replaces that whole folder every evening.
const OUT = path.join(__dirname, "..", "data", "gex-spot.json");

const ALPACA_HEADERS = {
  "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID || "",
  "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY || ""
};
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MarketDeskBot/1.0; +https://andrewarndt.github.io/daily-stock-conditions/)" };
const ETFS = ["SPY", "QQQ", "IWM", "DIA"];
const CHUNK = 100;
const GAP = 0.005;          // 0.5% Alpaca vs Yahoo / trade vs quote
const MAX_MOVE = 0.4;       // a price 40% from the close is a bad print unless Yahoo agrees
const YAHOO_FILL_MAX = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const sec = (iso) => Math.round(new Date(iso).getTime() / 1000);
const nyDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function readJSON(p) { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } }

function pickAlpaca(snap) {
  const tr = snap?.latestTrade, q = snap?.latestQuote, bar = snap?.minuteBar;
  let p = tr?.p, t = tr?.t;
  if (num(bar?.c) && bar?.t && (!t || new Date(bar.t) > new Date(t))) { p = bar.c; t = bar.t; }
  if (num(q?.ap) && num(q?.bp) && q.ap >= q.bp && q.t) {
    const mid = (q.ap + q.bp) / 2;
    if ((q.ap - q.bp) / mid < GAP && num(p) && Math.abs(p / mid - 1) > GAP && new Date(q.t) > new Date(t)) { p = mid; t = q.t; }
  }
  return num(p) && t ? [Math.round(p * 10000) / 10000, sec(t)] : null;
}

async function alpaca(symbols) {
  const out = {};
  if (!ALPACA_HEADERS["APCA-API-KEY-ID"] || !ALPACA_HEADERS["APCA-API-SECRET-KEY"]) {
    console.warn("[alpaca] no API credentials set");
    return out;
  }
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const part = symbols.slice(i, i + CHUNK);
    const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(part.join(","))}&feed=iex`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { headers: ALPACA_HEADERS });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        for (const s of part) { const v = pickAlpaca(json[s]); if (v) out[s] = v; }
        break;
      } catch (err) {
        console.warn(`[alpaca] chunk ${i / CHUNK + 1} attempt ${attempt} failed: ${err.message}`);
        await sleep(1500);
      }
    }
  }
  return out;
}

async function yahoo(sym) {
  const y = sym.replace(/\./g, "-"); // BRK.B -> BRK-B
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=5m`, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    return num(meta?.regularMarketPrice) && Number.isFinite(meta?.regularMarketTime) ? [meta.regularMarketPrice, meta.regularMarketTime] : null;
  } catch (err) {
    console.warn(`[yahoo] ${sym}: ${err.message}`);
    return null;
  }
}

async function main() {
  const index = await readJSON(path.join(GEX, "index.json"));
  const prev = (await readJSON(OUT)) || {};
  if (!index?.tickers?.length) throw new Error("data/gex/index.json missing or empty");
  const close = Object.fromEntries(index.tickers.map((t) => [t.symbol, t.spot]));
  const symbols = index.tickers.map((t) => t.symbol);

  const prices = await alpaca(symbols);

  // second source: index ETFs + 8 names rotating through the list each run (5-min slots), plus anything Alpaca missed
  const slot = Math.floor(Date.now() / 300000);
  const stocks = symbols.filter((s) => !ETFS.includes(s));
  const sample = new Set(ETFS.filter((s) => close[s] != null));
  for (let k = 0; k < 8 && stocks.length; k++) sample.add(stocks[(slot * 8 + k) % stocks.length]);
  const missing = symbols.filter((s) => !prices[s]).slice(0, YAHOO_FILL_MAX);
  let checked = 0, overrides = 0;
  for (const s of new Set([...sample, ...missing])) {
    const y = await yahoo(s);
    await sleep(120);
    if (!y) continue;
    const a = prices[s];
    if (!a) { prices[s] = y; continue; }
    checked++;
    // newer by > 5 min, or a real disagreement: trust Yahoo (consolidated tape) over the thin IEX print
    if (Math.abs(a[0] / y[0] - 1) > GAP || y[1] - a[1] > 300) {
      console.warn(`[gex-spot] ${s}: Alpaca ${a[0]} @${new Date(a[1] * 1000).toISOString()} vs Yahoo ${y[0]} @${new Date(y[1] * 1000).toISOString()}, using Yahoo`);
      prices[s] = y; overrides++;
    }
  }

  // drop impossible prints (40% from the close) unless Yahoo says so too
  for (const s of Object.keys(prices)) {
    const c = close[s];
    if (num(c) && Math.abs(prices[s][0] / c - 1) > MAX_MOVE) {
      const y = await yahoo(s);
      if (y && Math.abs(y[0] / c - 1) > MAX_MOVE && Math.abs(y[0] / prices[s][0] - 1) < 0.02) continue;
      console.warn(`[gex-spot] ${s}: ${prices[s][0]} is ${((prices[s][0] / c - 1) * 100).toFixed(1)}% from the ${c} close; dropped`);
      delete prices[s];
    }
  }

  const priced = Object.keys(prices).length;
  const now = new Date().toISOString();
  let out;
  if (!priced) {
    out = { ...prev, updated: now, source: "seed" };
    console.log(`Wrote ${OUT}: no prices this run, kept the previous ones (source seed).`);
  } else {
    const ordered = {};
    for (const s of symbols) if (prices[s]) ordered[s] = prices[s];
    out = {
      updated: now, quotesAsOf: now, session: nyDate(), source: "live",
      feed: "Alpaca IEX last trade, Yahoo Finance cross-check", gexSession: index.session,
      count: symbols.length, priced, yahooChecked: checked, yahooOverrides: overrides, prices: ordered
    };
  }
  await writeFile(OUT, JSON.stringify(out) + "\n");
  if (priced) console.log(`Wrote ${OUT}: ${priced}/${symbols.length} priced, ${checked} cross-checked, ${overrides} from Yahoo, live.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
