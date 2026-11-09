#!/usr/bin/env node
/**
 * Market Desk session loop: keeps every GitHub-fed data file current through
 * the trading day from one long-running Actions job (.github/workflows/
 * market-session.yml), instead of relying on per-feed cron triggers.
 *
 * Why: GitHub's scheduled triggers are best-effort. In Oct-Nov 2026 the
 * "every 30 min" overview cron really fired about twice a day, and on Monday
 * 2026-11-09 no scheduled run fired at all by mid-afternoon, so the site
 * showed Friday's prices. One run of this loop covers ~5.75 hours; the
 * workflow is triggered several times a day (and by the local dispatcher) so
 * a missed trigger is picked up by the next one.
 *
 * How: every minute, each task decides from the DATA (its file's own dates)
 * and the New York clock whether it is due -- not from when it last ran --
 * so duplicate or late triggers are harmless and a failed fetch is retried
 * until the expected data shows up. Each run's changed file is committed and
 * pushed on its own.
 *
 * Usage: node market_report/scripts/session-loop.mjs [--once] [--dry-run]
 */

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const DATA = path.join(__dirname, "..", "data");
const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry-run");
const MAX_MINUTES = 345; // Actions jobs stop at 6 h; leave room to push
const END_ET = 23 * 60 + 30; // nothing left to fetch after 11:30 PM ET

// NYSE full-day holidays and 1:00 PM early closes (same list as assets/desk.js). Extend each year.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"
]);
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

// ---------- New York clock ----------
const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short"
});
function ny(t = new Date()) {
  const p = {};
  for (const x of nyFmt.formatToParts(t)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}
const isTradingDay = (d) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w > 0 && w < 6 && !HOLIDAYS.has(d); };
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const closeMins = (d) => (EARLY_CLOSE.has(d) ? 13 * 60 : 16 * 60);
// latest trading day D (today or earlier) for which minute-of-day `at(D)` has passed
function lastSession(now, at) {
  let d = now.date;
  for (let i = 0; i < 15; i++, d = addDays(d, -1)) {
    if (isTradingDay(d) && (d < now.date || now.mins >= at(d))) return d;
  }
  return d;
}
// "YYYY-MM-DD HH:MM" New York of an ISO timestamp, comparable as a string
function stamp(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const n = ny(t);
  return `${n.date} ${String(Math.floor(n.mins / 60)).padStart(2, "0")}:${String(n.mins % 60).padStart(2, "0")}`;
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const ageMin = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

// ---------- tasks ----------
// due(now, data) -> reason string when the feed should be fetched, else null.
// retry: minimum minutes between attempts while still due.
const lastNYDate = (arr) => (Array.isArray(arr) && arr.length ? String(arr[arr.length - 1]).slice(0, 10) : "");
// ran since today's slot (minutes ET), on trading days
const slots = (...list) => (now, d) => {
  if (!isTradingDay(now.date)) return null;
  const passed = list.filter((m) => now.mins >= m);
  if (!passed.length) return null;
  const slot = Math.max(...passed);
  return stamp(d.updated) < `${now.date} ${hm(slot)}` ? `not run since ${hm(slot)} ET` : null;
};
// refreshed at least every `every` minutes between from..to on trading days
const intraday = (from, to, every) => (now, d) =>
  isTradingDay(now.date) && now.mins >= from && now.mins <= to && !(ageMin(d.updated) < every) ? `older than ${every} min` : null;
// the data's own session date must reach the last session once `after` (min after close) has passed
const sessionData = (getDate, after) => (now, d) => {
  const want = lastSession(now, (day) => closeMins(day) + after);
  const have = getDate(d) || "";
  return have < want ? `data ends ${have || "?"}, want ${want}` : null;
};
const any = (...fns) => (now, d) => { for (const f of fns) { const r = f(now, d); if (r) return r; } return null; };

const TASKS = [
  {
    id: "overview", file: "overview.json", script: "fetch-overview.mjs", retry: 4,
    due: (now, d) => {
      const q = d.quotesAsOf || d.updated;
      if (isTradingDay(now.date) && now.mins >= 9 * 60 + 25 && now.mins <= closeMins(now.date) + 10) {
        return ageMin(d.updated) >= 25 ? "intraday quotes older than 25 min" : null;
      }
      const last = lastSession(now, (day) => closeMins(day) + 5);
      return stamp(q) < `${last} ${hm(closeMins(last) - 5)}` ? `missing the ${last} close` : null;
    }
  },
  { id: "fear-greed", file: "fear-greed.json", script: "fetch-fear-greed.mjs", retry: 20, due: any(intraday(8 * 60, 17 * 60, 60), slots(16 * 60 + 20)) },
  { id: "fed-watch", file: "fed-watch.json", script: "fetch-fed-watch.mjs", retry: 20, due: any(intraday(7 * 60, 17 * 60, 60), slots(7 * 60)) },
  { id: "putcall", file: "putcall.json", script: "fetch-putcall.mjs", retry: 45, due: any(slots(8 * 60 + 20, 16 * 60 + 20), sessionData((d) => d.asof, 6 * 60)) },
  { id: "economic", file: "economic.json", script: "fetch-economic.mjs", retry: 30, due: slots(8 * 60 + 45, 10 * 60 + 15, 14 * 60 + 15) },
  { id: "consumer-sentiment", file: "consumer-sentiment.json", script: "fetch-consumer-sentiment.mjs", retry: 30, due: slots(10 * 60 + 15) },
  { id: "fed-dashboard", file: "fed-dashboard.json", script: "fetch-fed-dashboard.mjs", retry: 30, due: slots(9 * 60 + 30, 16 * 60 + 45) },
  { id: "aaii", file: "aaii.json", script: "fetch-aaii.mjs", retry: 60, due: slots(9 * 60, 13 * 60) },
  {
    id: "cot", file: "cot.json", script: "fetch-cot.mjs", retry: 60,
    // CFTC posts Tuesday's positions Friday ~3:30 PM ET (Monday after a Friday holiday)
    due: (now, d) => {
      const last = (d.history || []).slice(-1)[0]?.date || "";
      let fri = now.date;
      while (new Date(fri + "T12:00:00Z").getUTCDay() !== 5) fri = addDays(fri, -1);
      const released = now.date > fri || now.mins >= 15 * 60 + 45;
      const tue = addDays(fri, released ? -3 : -10);
      return last < tue ? `positions end ${last || "?"}, want ${tue}` : null;
    }
  },
  { id: "sector-ratios", file: "sector-ratios.json", script: "fetch-sector-ratios.mjs", retry: 20, due: sessionData((d) => lastNYDate(d.dates), 15) },
  { id: "credit", file: "credit.json", script: "fetch-credit.mjs", retry: 20, due: sessionData((d) => lastNYDate(d.dates), 15) },
  {
    id: "volatility", file: "volatility.json", script: "fetch-volatility.mjs", retry: 30,
    due: sessionData((d) => (d.termStructure || []).map((t) => t.asof || "").sort()[0], 25)
  },
  { id: "skew", file: "skew.json", script: "fetch-skew.mjs", retry: 30, due: sessionData((d) => d.asof, 30) },
  {
    id: "yields", file: "yields.json", script: "fetch-yields.mjs", retry: 45,
    // Treasury posts the day's par curve in the late afternoon / evening
    due: any(slots(7 * 60), sessionData((d) => (d.series || []).map((s) => s.asof || "").sort()[0], 60))
  }
];

// ---------- run ----------
const lastTry = {};
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}
async function readData(file) {
  try { return JSON.parse(await readFile(path.join(DATA, file), "utf8")); } catch { return {}; }
}
function commitAndPush(task, reason) {
  const rel = `market_report/data/${task.file}`;
  sh("git", ["add", "--", rel]);
  try { sh("git", ["diff", "--cached", "--quiet", "--", rel]); console.log(`  ${task.id}: no change`); return; } catch { /* changed */ }
  sh("git", ["commit", "-q", "-m", `Refresh ${task.id} (${reason})`, "--", rel]);
  for (let i = 1; i <= 5; i++) {
    try { sh("git", ["push", "-q", "origin", "HEAD:main"]); console.log(`  ${task.id}: pushed`); return; }
    catch (err) {
      console.warn(`  push rejected (attempt ${i}), rebasing`);
      try { sh("git", ["pull", "-q", "--rebase", "origin", "main"]); } catch (e) { console.warn("  rebase failed:", e.message.split("\n")[0]); sh("git", ["rebase", "--abort"], { stdio: "ignore" }); }
    }
  }
  console.error(`  ${task.id}: push failed after 5 attempts`);
}

async function tick() {
  const now = ny();
  try { sh("git", ["pull", "-q", "--rebase", "origin", "main"]); } catch (e) { console.warn("pull failed:", e.message.split("\n")[0]); }
  for (const task of TASKS) {
    const data = await readData(task.file);
    const reason = task.due(now, data);
    if (!reason) continue;
    if (lastTry[task.id] && (Date.now() - lastTry[task.id]) / 60000 < task.retry) continue;
    lastTry[task.id] = Date.now();
    console.log(`${now.date} ${hm(now.mins)} ET  ${task.id}: ${reason}`);
    if (DRY) continue;
    try {
      const out = sh("node", [path.join("market_report", "scripts", task.script)], { timeout: 5 * 60000 });
      console.log("  " + out.trim().split("\n").slice(-1)[0]);
      commitAndPush(task, reason);
    } catch (err) {
      console.error(`  ${task.id} failed: ${(err.stderr || err.message || "").toString().trim().split("\n").slice(-1)[0]}`);
    }
  }
}

const started = Date.now();
for (;;) {
  await tick();
  if (ONCE) break;
  const now = ny();
  if ((Date.now() - started) / 60000 > MAX_MINUTES || now.mins > END_ET) break;
  await new Promise((r) => setTimeout(r, 60000));
}
console.log("session loop done");
