#!/usr/bin/env node
/**
 * Market Desk session loop: keeps every GitHub-fed data file current through
 * the trading day from one long-running Actions job (.github/workflows/
 * market-session.yml), instead of relying on per-feed cron triggers.
 *
 * Why: GitHub's scheduled triggers are best-effort. In Oct-Nov 2026 the
 * "every 30 min" overview cron really fired about twice a day, and on Monday
 * 2026-11-09 no scheduled run fired at all by mid-afternoon, so the site
 * showed Friday's prices. One run of this loop covers ~5.75 hours and starts
 * its own successor before it exits, around the clock (nights and weekends
 * too: the due rules leave idle hours idle). On 2026-11-11 the old
 * "stop at 11:30 PM, let the 6 AM cron restart it" design left the site with
 * no loop until 11:20 AM, because GitHub dropped every morning cron. Crons,
 * the hourly health check and the local dispatcher only restart a broken chain.
 *
 * How: every minute, each task decides from the DATA (its file's own dates)
 * and the New York clock whether it is due -- not from when it last ran --
 * so duplicate or late triggers are harmless and a failed fetch is retried
 * until the expected data shows up. Each run's changed file is committed and
 * pushed on its own.
 *
 * Usage: node market_report/scripts/session-loop.mjs [--once] [--dry-run] [--only=<task id>] [--health-only]
 * Outside GitHub Actions it refuses to publish unless the feed API keys are set (a keyless local run once
 * pushed FRED panels as "not live"); start real runs with `gh workflow run market-session.yml`.
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
// --only=<task id>: used by the per-feed backup workflows (refresh-*.yml) so a backup run goes through the same
// due check, validation and cross-checks as the loop instead of publishing a raw fetch.
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const MAX_MINUTES = 345; // Actions jobs stop at 6 h; leave room to push

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("usage: node market_report/scripts/session-loop.mjs [--once] [--dry-run] [--only=<task id>] [--health-only]\n" +
    "Publishes (commits + pushes) unless --dry-run. Real runs: gh workflow run market-session.yml");
  process.exit(0);
}
const KEYS = ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "TWELVEDATA_API_KEY", "FRED_API_KEY"];
const missingKeys = KEYS.filter((k) => !process.env[k]);
// Local runs only: in Actions a missing secret degrades just its feeds (alerted), and must not break the chain.
if (!process.env.GITHUB_ACTIONS && !DRY && !process.argv.includes("--health-only") && missingKeys.length) {
  console.error(`refusing to publish without ${missingKeys.join(", ")}: feeds would go out as "not live".\n` +
    "Use --dry-run locally, or start a real run with: gh workflow run market-session.yml");
  process.exit(1);
}

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
        // The 09:25 run only has pre-market prints (11-10: last trade 08:20), so pull again as soon as the bell rings
        // instead of waiting out the cadence; then every 15 min.
        if (now.mins >= 9 * 60 + 32 && stamp(q) < `${now.date} 09:30`) return "first quotes after the open";
        return ageMin(d.updated) >= 15 ? "intraday quotes older than 15 min" : null;
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

// ---------- validation: never publish an implausible update ----------
// Each check returns a problem string or null. A failed range check rolls the
// file back to the last good version (the page keeps showing that, flagged by
// age if it goes stale); a failed cross-source check is published but alerted.
const num = (v) => typeof v === "number" && Number.isFinite(v);
const inRange = (label, v, lo, hi) => (!num(v) || v < lo || v > hi ? `${label} = ${v} (expected ${lo}..${hi})` : null);
const VALIDATE = {
  overview: (d) => {
    const items = [...(d.indices || []), ...(d.commodities || [])];
    if (items.length < 10) return `only ${items.length} quotes`;
    for (const i of items) {
      if (!num(i.value) || !num(i.change)) return `${i.id}: missing value`;
      if (i.changeType === "pct" && Math.abs(i.change) > (i.id === "btc" ? 30 : 15)) return `${i.id} day change ${i.change.toFixed(1)}%`;
    }
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    return inRange("VIX", by.vix?.value, 5, 150) || inRange("10-yr yield", by.ust10y?.value, 0, 20);
  },
  yields: (d) => {
    for (const s of d.series || []) {
      const r = inRange(`${s.id} yield`, s.value, 0, 25);
      if (r) return r;
      if (Math.abs(s.value - s.prior) > 0.6) return `${s.id} moved ${(s.value - s.prior).toFixed(2)} pt in a day`;
    }
    return null;
  },
  putcall: (d) => inRange("put/call", d.ratio, 0.2, 3.5),
  "fear-greed": (d) => inRange("fear & greed", d.score, 0, 100),
  "consumer-sentiment": (d) => inRange("UMich sentiment", d.value, 20, 150),
  aaii: (d) => {
    const sum = (d.bullish || 0) + (d.neutral || 0) + (d.bearish || 0);
    return Math.abs(sum - 100) > 2 ? `AAII shares sum to ${sum}` : null;
  },
  volatility: (d) => {
    for (const t of d.termStructure || []) { const r = inRange(`${t.id}`, t.value, 5, 150); if (r) return r; }
    return null;
  },
  skew: (d) => {
    for (const b of d.buckets || []) { const r = inRange(`skew ${b.pct}% IV`, b.iv, 1, 250); if (r) return r; }
    return null;
  },
  "sector-ratios": (d) => {
    const s = d.spy || [];
    return s.length > 1 && Math.abs(s[s.length - 1] / s[s.length - 2] - 1) > 0.15 ? `SPY close jumped ${(100 * (s[s.length - 1] / s[s.length - 2] - 1)).toFixed(1)}%` : null;
  },
  credit: (d) => {
    const c = d.close || [];
    return c.length > 1 && Math.abs(c[c.length - 1] / c[c.length - 2] - 1) > 0.1 ? `HYG close jumped ${(100 * (c[c.length - 1] / c[c.length - 2] - 1)).toFixed(1)}%` : null;
  }
};

// Second source: daily closes from Yahoo for the same session.
async function yahooClose(symbol, date) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0 (Market Desk check)" } });
    const r = (await res.json())?.chart?.result?.[0];
    const off = Number(r?.meta?.gmtoffset) || 0;
    const i = (r?.timestamp || []).findIndex((t) => new Date((t + off) * 1000).toISOString().slice(0, 10) === date);
    const v = i >= 0 ? r.indicators.quote[0].close[i] : null;
    return num(v) ? v : null;
  } catch { return null; }
}
const CROSS = {
  volatility: async (d) => {
    const t = (d.termStructure || []).find((x) => x.id === "vix");
    const y = t && await yahooClose("^VIX", t.asof);
    return y && Math.abs(t.value / y - 1) > 0.03 ? `VIX ${t.asof}: Cboe ${t.value} vs Yahoo ${y.toFixed(2)}` : null;
  },
  yields: async (d) => {
    const s = (d.series || []).find((x) => x.id === "10y");
    const y = s && await yahooClose("^TNX", s.asof);
    return y && Math.abs(s.value - y) > 0.1 ? `10-yr ${s.asof}: Treasury ${s.value} vs ^TNX ${y.toFixed(3)}` : null;
  },
  "sector-ratios": async (d) => {
    const date = lastNYDate(d.dates), v = (d.spy || []).slice(-1)[0];
    const y = date && await yahooClose("SPY", date);
    return y && Math.abs(v / y - 1) > 0.005 ? `SPY ${date}: ${v.toFixed(2)} vs Yahoo ${y.toFixed(2)}` : null;
  }
};

// ---------- health: what a visitor would see as late (mirrors assets/desk.js) ----------
const HEALTH = [
  ["overview.json", "Index & commodity quotes", (now, d) => {
    const q = d.quotesAsOf || d.updated;
    if (isTradingDay(now.date) && now.mins >= 9 * 60 + 45 && now.mins <= closeMins(now.date) + 45) {
      return ageMin(q) > 60 ? `last quote ${stamp(q)} ET, market open` : null;
    }
    const last = lastSession(now, (day) => closeMins(day) + 45);
    return stamp(q) < `${last} ${hm(closeMins(last) - 5)}` ? `last quote ${stamp(q)} ET, missing the ${last} close` : null;
  }],
  ["sector-ratios.json", "Sector ratios", sessionData((d) => lastNYDate(d.dates), 5 * 60)],
  ["credit.json", "Credit (HYG)", sessionData((d) => lastNYDate(d.dates), 5 * 60)],
  ["volatility.json", "Volatility indices", sessionData((d) => (d.termStructure || []).map((t) => t.asof || "").sort()[0], 15 * 60)],
  ["skew.json", "SPX skew", sessionData((d) => d.asof, 15 * 60)],
  ["yields.json", "Treasury yields", sessionData((d) => (d.series || []).map((s) => s.asof || "").sort()[0], 15 * 60)],
  ["putcall.json", "Put/call ratio", sessionData((d) => d.asof, 18 * 60)],
  ["fear-greed.json", "Fear & Greed", (now, d) => (isTradingDay(now.date) && now.mins > 11 * 60 && now.mins < 17 * 60 && ageMin(d.updated) > 150 ? `last run ${stamp(d.updated)} ET` : null)],
  ["economic.json", "Economic snapshot", (now, d) => (isTradingDay(now.date) && now.mins > 11 * 60 && stamp(d.updated) < `${now.date} 08:00` ? `last run ${stamp(d.updated)} ET` : null)],
  ["gex/index.json", "GEX levels (local job)", sessionData((d) => d.session, 3 * 60)],
  ["breadth.json", "Market breadth (local job)", sessionData((d) => d.asof, 3 * 60)],
  ["earnings.json", "FactSet earnings (local job)", (now, d) => ((Date.now() - Date.parse(d.asof + "T20:00:00Z")) / 86400000 > 8.5 ? `latest report ${d.asof}` : null)]
];
async function healthCheck() {
  const now = ny(), found = [];
  for (const [file, label, check] of HEALTH) {
    const d = await readData(file);
    if (!d || !Object.keys(d).length) { found.push(`${label}: file missing or unreadable`); continue; }
    try { const r = check(now, d); if (r) found.push(`${label}: ${r}`); } catch (e) { found.push(`${label}: check failed (${e.message})`); }
  }
  return found;
}

// One open issue titled ALERT_TITLE holds the current problems; GitHub emails
// the mention. Commented when the set changes, closed when everything is fine.
const ALERT_TITLE = "Market Desk data alert";
const OWNER = (process.env.GITHUB_REPOSITORY || "andrewarndt/").split("/")[0];
let lastAlertKey = null;
function syncAlert(problems) {
  if (DRY || !process.env.GITHUB_ACTIONS) { if (problems.length) console.log("ALERT (not filed locally):\n  " + problems.join("\n  ")); return; }
  const key = problems.slice().sort().join("|");
  if (key === lastAlertKey) return;
  try {
    const open = JSON.parse(sh("gh", ["issue", "list", "--state", "open", "--search", `"${ALERT_TITLE}" in:title`, "--json", "number"]) || "[]");
    const body = problems.map((p) => `- ${p}`).join("\n");
    if (problems.length && !open.length) {
      sh("gh", ["issue", "create", "--title", ALERT_TITLE, "--body",
        `@${OWNER} the Market Desk refresh found data that is late, failed validation, or disagrees with a second source:\n\n${body}\n\n` +
        "The site shows a \"Data delayed\" banner for anything a visitor would see as late. This issue updates while the problems last and closes itself when they clear."]);
    } else if (problems.length) {
      sh("gh", ["issue", "comment", String(open[0].number), "--body", `Still open, current problems:\n\n${body}`]);
    } else if (open.length) {
      sh("gh", ["issue", "close", String(open[0].number), "--comment", "All Market Desk feeds are current again."]);
    }
    lastAlertKey = key;
  } catch (err) {
    console.error("alert update failed:", (err.stderr || err.message || "").toString().split("\n")[0]);
  }
}
// Only problems that have lasted ALERT_AFTER_MIN reach the issue (and the
// owner's inbox): a blip the loop fixes on its next pass never emails. The
// site's "Data delayed" banner still shows right away. Keyed by feed label,
// since the message text carries changing timestamps.
const ALERT_AFTER_MIN = 30;
const firstSeen = new Map();
async function healthAndAlert(extra, persist = true) {
  const all = [...(await healthCheck()), ...extra], now = Date.now(), keep = [];
  const labels = new Set(all.map((p) => p.split(":")[0]));
  for (const k of [...firstSeen.keys()]) if (!labels.has(k)) firstSeen.delete(k);
  for (const p of all) {
    const k = p.split(":")[0];
    if (!firstSeen.has(k)) firstSeen.set(k, now);
    if (!persist || (now - firstSeen.get(k)) / 60000 >= ALERT_AFTER_MIN) keep.push(p);
    else console.log(`(not alerting yet, first seen ${Math.round((now - firstSeen.get(k)) / 60000)} min ago) ${p}`);
  }
  // Only close the issue when nothing is wrong at all. A fresh run hasn't watched any problem for 30 min yet, so
  // closing on an empty `keep` would close a still-valid alert and reopen it (a second email) half an hour later.
  if (!keep.length && all.length) return;
  syncAlert(keep);
}
function loopRunning() {
  try {
    const runs = JSON.parse(sh("gh", ["run", "list", "--workflow", "market-session.yml", "--limit", "5", "--json", "status"]) || "[]");
    return runs.some((r) => ["in_progress", "queued", "pending", "waiting", "requested"].includes(r.status));
  } catch { return false; }
}

// ---------- run ----------
const lastTry = {};
const validationProblems = new Map(); // task id -> problem
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
    if (ONLY && task.id !== ONLY) continue;
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
      const fresh = await readData(task.file);
      const bad = VALIDATE[task.id] ? VALIDATE[task.id](fresh) : null;
      if (bad) {
        sh("git", ["checkout", "--", `market_report/data/${task.file}`]);
        validationProblems.set(task.id, `${task.id}: update rejected, ${bad}`);
        console.error(`  ${task.id}: REJECTED (${bad}); kept the previous file`);
        continue;
      }
      validationProblems.delete(task.id);
      const cross = CROSS[task.id] ? await CROSS[task.id](fresh) : null;
      if (cross) validationProblems.set(task.id + ":x", `${task.id}: sources disagree, ${cross}`);
      else validationProblems.delete(task.id + ":x");
      commitAndPush(task, reason);
    } catch (err) {
      console.error(`  ${task.id} failed: ${(err.stderr || err.message || "").toString().trim().split("\n").slice(-1)[0]}`);
    }
  }
}

const HEALTH_ONLY = process.argv.includes("--health-only");
if (HEALTH_ONLY) {
  // used by market-health.yml: restart the loop if it isn't running. While a
  // loop run is live it owns the alert (with its 30-min persistence), so this
  // hourly check only alerts when the loop itself is down.
  if (!process.env.GITHUB_ACTIONS || !loopRunning()) await healthAndAlert([], false);
  else console.log("loop is running; it handles alerts");
  ensureSuccessor(true);
  process.exit(0);
}

// Start the next loop run before this one ends (GITHUB_TOKEN may trigger
// workflow_dispatch); with concurrency the new run waits until this one exits.
// Always, at any hour: the chain must never depend on a cron to restart it.
function ensureSuccessor(onlyIfIdle) {
  if (DRY || !process.env.GITHUB_ACTIONS) return;
  try {
    if (onlyIfIdle) {
      const runs = JSON.parse(sh("gh", ["run", "list", "--workflow", "market-session.yml", "--limit", "5", "--json", "status"]) || "[]");
      if (runs.some((r) => ["in_progress", "queued", "pending", "waiting", "requested"].includes(r.status))) return;
    }
    sh("gh", ["workflow", "run", "market-session.yml"]);
    console.log("started the next session-loop run");
  } catch (err) {
    console.error("could not start the next run:", (err.stderr || err.message || "").toString().split("\n")[0]);
  }
}

if (ONLY && !TASKS.some((t) => t.id === ONLY)) { console.error(`unknown task --only=${ONLY}`); process.exit(1); }
if (ONLY) {
  // Backup run for one feed: fetch it if due (validated, committed), then make sure a loop run exists.
  // Alerts stay with the loop and market-health.yml, which track how long a problem has lasted.
  await tick();
  for (const p of validationProblems.values()) console.error(p);
  ensureSuccessor(true);
  process.exit(0);
}
const started = Date.now();
let ticks = 0;
for (;;) {
  await tick();
  if (ticks++ % 5 === 0 || validationProblems.size) await healthAndAlert([...validationProblems.values()]);
  if (ONCE) break;
  if ((Date.now() - started) / 60000 > MAX_MINUTES) break;
  await new Promise((r) => setTimeout(r, 60000));
}
await healthAndAlert([...validationProblems.values()]);
ensureSuccessor(ONCE);
console.log("session loop done");
