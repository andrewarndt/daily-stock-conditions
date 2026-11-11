/*
 * Market Desk — shared top-bar furniture for every tab:
 *   - a US equity session clock (pre-market / open / after-hours / closed,
 *     New York time, NYSE holidays and early closes included), and
 *   - a scrolling quote tape built from data/overview.json.
 * Load with `defer` after the topbar markup.
 */
(function () {
  "use strict";

  // NYSE full-day holidays and 1:00 PM early closes. Extend each year.
  var HOLIDAYS = {
    "2026-01-01": 1, "2026-01-19": 1, "2026-02-16": 1, "2026-04-03": 1, "2026-05-25": 1,
    "2026-06-19": 1, "2026-07-03": 1, "2026-09-07": 1, "2026-11-26": 1, "2026-12-25": 1,
    "2027-01-01": 1, "2027-01-18": 1, "2027-02-15": 1, "2027-03-26": 1, "2027-05-31": 1,
    "2027-06-18": 1, "2027-07-05": 1, "2027-09-06": 1, "2027-11-25": 1, "2027-12-24": 1
  };
  var EARLY_CLOSE = { "2026-11-27": 1, "2026-12-24": 1, "2027-11-26": 1 };

  var nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
  });

  function nyNow() {
    var p = {};
    nyParts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return {
      date: p.year + "-" + p.month + "-" + p.day,
      weekday: p.weekday,
      mins: (+p.hour) * 60 + (+p.minute),
      time: p.hour + ":" + p.minute + ":" + p.second
    };
  }

  function session(ny) {
    if (ny.weekday === "Sat" || ny.weekday === "Sun") return { label: "Closed", cls: "closed" };
    if (HOLIDAYS[ny.date]) return { label: "Holiday", cls: "closed" };
    var close = EARLY_CLOSE[ny.date] ? 13 * 60 : 16 * 60;
    if (ny.mins >= 9 * 60 + 30 && ny.mins < close) return { label: "Open", cls: "open" };
    if (ny.mins >= 4 * 60 && ny.mins < 9 * 60 + 30) return { label: "Pre-mkt", cls: "ext" };
    if (ny.mins >= close && ny.mins < 20 * 60) return { label: "After-hrs", cls: "ext" };
    return { label: "Closed", cls: "closed" };
  }

  var meta = document.querySelector(".top-meta");
  if (meta) {
    var clock = document.createElement("span");
    clock.className = "mkt-clock";
    clock.innerHTML = '<span class="mkt-state"></span><span>NY <span class="mkt-time"></span></span>';
    meta.insertBefore(clock, meta.firstChild);
    var stateEl = clock.querySelector(".mkt-state");
    var timeEl = clock.querySelector(".mkt-time");
    var tick = function () {
      var ny = nyNow();
      var s = session(ny);
      stateEl.textContent = s.label;
      stateEl.className = "mkt-state " + s.cls;
      timeEl.textContent = ny.time;
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- light / dark switch ----------
  // The choice is remembered per browser; with no choice the page follows
  // the system setting (an inline script in each page's <head> applies a
  // saved choice before first paint, so there is no flash).

  if (meta) {
    var root = document.documentElement;
    var lightQuery = window.matchMedia("(prefers-color-scheme: light)");
    var current = function () {
      return root.getAttribute("data-theme") || (lightQuery.matches ? "light" : "dark");
    };
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    var label = function () {
      var next = current() === "light" ? "dark" : "light";
      btn.textContent = next === "light" ? "Light" : "Dark";
      btn.setAttribute("aria-label", "Switch to " + next + " theme");
    };
    btn.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      if (window.MC && MC.setTheme) MC.setTheme(next); else root.setAttribute("data-theme", next);
      try { localStorage.setItem("md-theme", next); } catch (e) { /* private mode: not remembered */ }
      label();
    });
    label();
    meta.appendChild(btn);
  }

  // ---------- feedback panel ----------
  // A short form above each tab's footer. The site is static, so
  // submissions go through FormSubmit, which emails them to FEEDBACK_TO
  // (the first one ever sent triggers a one-time activation email there).

  var FEEDBACK_TO = "4aholdingscompany@gmail.com";
  var footer = document.querySelector(".page > footer");
  if (footer) {
    var tabName = (document.querySelector(".tab.active") || {}).textContent || document.title;
    var fb = document.createElement("section");
    fb.className = "feedback";
    fb.innerHTML =
      '<div class="section-head"><h2>Feedback</h2><span class="section-note">Ideas welcome</span></div>' +
      '<p>What would you like to see on the desk, or what could work better? Every note gets read.</p>' +
      '<form class="feedback-form" novalidate>' +
        '<label class="fb-field"><span>Topic</span>' +
          '<select name="topic">' +
            '<option>Something I\'d like to see</option>' +
            '<option>Improve an existing section</option>' +
            '<option>Something looks wrong</option>' +
            '<option>Other</option>' +
          '</select></label>' +
        '<label class="fb-field"><span>Name <span class="fb-opt">optional</span></span><input name="name" autocomplete="name" maxlength="100"></label>' +
        '<label class="fb-field"><span>Email <span class="fb-opt">optional, if you want a reply</span></span><input name="email" type="email" autocomplete="email" maxlength="200"></label>' +
        '<label class="fb-field fb-wide"><span>Your feedback</span><textarea name="message" rows="4" maxlength="4000" required></textarea></label>' +
        // Honeypot: hidden from people, filled in by bots; FormSubmit drops those.
        '<input type="text" name="_honey" class="fb-honey" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<div class="fb-actions fb-wide"><button type="submit" class="fb-send">Send feedback</button>' +
          '<span class="fb-status" role="status" aria-live="polite"></span></div>' +
      '</form>';
    footer.parentNode.insertBefore(fb, footer);

    var form = fb.querySelector("form");
    var status = fb.querySelector(".fb-status");
    var send = fb.querySelector(".fb-send");
    var setStatus = function (text, cls) {
      status.textContent = text;
      status.className = "fb-status" + (cls ? " " + cls : "");
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = form.elements;
      if (!f.message.value.trim()) { setStatus("Add a note before sending.", "err"); f.message.focus(); return; }
      if (f.email.value && !f.email.checkValidity()) { setStatus("That email doesn't look right.", "err"); f.email.focus(); return; }
      send.disabled = true;
      setStatus("Sending…");
      var payload = {
        topic: f.topic.value,
        name: f.name.value.trim(),
        email: f.email.value.trim(),
        message: f.message.value.trim(),
        page: tabName.trim(),
        _honey: f._honey.value,
        _subject: "Market Desk feedback: " + f.topic.value,
        _template: "table"
      };
      fetch("https://formsubmit.co/ajax/" + FEEDBACK_TO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json().then(function (j) { if (!res.ok || String(j.success) !== "true") throw new Error(j.message || "HTTP " + res.status); }); })
        .then(function () {
          form.reset();
          setStatus("Thanks, got it.", "ok");
        })
        .catch(function (err) {
          console.warn("Feedback: send failed", err);
          setStatus("Couldn't send just now. You can email " + FEEDBACK_TO + " instead.", "err");
        })
        .then(function () { send.disabled = false; });
    });
  }

  // ---------- data freshness check ----------
  // Every tab re-reads the feeds it shows and checks each against the time it
  // should have been refreshed by. Anything late, partly failed, or missing
  // raises a red banner at the top of the page and turns the "Last refresh"
  // dot red, so stale numbers are never shown as current without a warning.
  // (2026-11-09: GitHub's scheduler skipped a whole Monday and the Overview
  // showed Friday's prices as "live" with nothing on the page saying so.)
  //
  // Policies (all times New York):
  //   intraday  quotes within 50 min while the market is open; otherwise from
  //             the last session's close (field quotesAsOf, else updated)
  //   morning   run since 10:30 on the latest trading day
  //   eod       run since the last session's close, checked from 21:00 on
  //             (the after-close jobs run 16:15-17:00, crons as late as ~20:00)
  //   session   the feed's session date >= the last session, checked from 18:30
  //   weekly    run within 8 days
  var FEEDS = {
    "overview.json": { label: "Index & commodity quotes", policy: "intraday" },
    "economic.json": { label: "Economic snapshot", policy: "morning" },
    "breadth.json": { label: "Market breadth", policy: "session", dateField: "asof" },
    "aaii.json": { label: "AAII survey", policy: "weekly" },
    "consumer-sentiment.json": { label: "Consumer sentiment", policy: "morning" },
    "cot.json": { label: "COT positioning", policy: "weekly" },
    "fear-greed.json": { label: "Fear & Greed", policy: "morning" },
    "putcall.json": { label: "Put/call ratio", policy: "morning" },
    "sentiment-report.json": { label: "Daily sentiment read", policy: "morning" },
    "earnings.json": { label: "FactSet earnings scorecard", policy: "weekly", dateField: "asof" },
    "sector-ratios.json": { label: "Sector ratios", policy: "eod" },
    "volatility.json": { label: "Volatility indices", policy: "eod" },
    "skew.json": { label: "SPX skew", policy: "eod" },
    "fed-watch.json": { label: "Fed Watch odds", policy: "morning" },
    "fed-dashboard.json": { label: "Fed dashboard", policy: "morning" },
    "yields.json": { label: "Treasury yields", policy: "eod" },
    "credit.json": { label: "Credit (HYG)", policy: "eod" },
    "gex/index.json": { label: "GEX levels", policy: "session", dateField: "session" },
    "gex-spot.json": { label: "GEX live prices", policy: "intraday", maxAge: 20, every: "5 minutes" }
  };
  var PAGE_FEEDS = {
    "index.html": ["overview.json", "economic.json", "breadth.json"],
    "sentiment.html": ["fear-greed.json", "putcall.json", "consumer-sentiment.json", "aaii.json", "cot.json", "sentiment-report.json"],
    "earnings.html": ["earnings.json"],
    "sector-ratios.html": ["sector-ratios.json", "volatility.json", "skew.json"],
    "gex.html": ["gex/index.json", "gex-spot.json"],
    "fed-economic.html": ["economic.json", "fed-watch.json"],
    "bonds.html": ["yields.json", "credit.json", "fed-dashboard.json", "overview.json"]
  };

  function isTradingDay(d) { // d = "YYYY-MM-DD"
    var wd = new Date(d + "T12:00:00Z").getUTCDay();
    return wd !== 0 && wd !== 6 && !HOLIDAYS[d];
  }
  function prevDay(d) {
    var t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  }
  function closeMins(d) { return EARLY_CLOSE[d] ? 13 * 60 : 16 * 60; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  // latest trading day whose (close + afterMins, or fixed time atMins) has passed
  function latestDay(ny, atFn) {
    var d = ny.date;
    for (var i = 0; i < 15; i++, d = prevDay(d)) {
      if (!isTradingDay(d)) continue;
      if (d < ny.date || ny.mins >= atFn(d)) return d;
    }
    return d;
  }
  // ISO timestamp -> "YYYY-MM-DD HH:MM" New York time, comparable as a string
  function etStamp(iso) {
    var t = new Date(iso);
    if (isNaN(t)) return null;
    var p = {};
    nyParts.formatToParts(t).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
  }
  function fmtStamp(iso) {
    var t = new Date(iso);
    if (isNaN(t)) return "unknown";
    return t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  }
  function fmtDay(d) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }

  function checkFeed(name, data) {
    var f = FEEDS[name], ny = nyNow(), problems = [];
    if (!data) return [f.label + ": could not be loaded, so that section is left empty until it does."];
    if (data.source === "seed") { // what every fetch script writes when a run got nothing live
      problems.push(f.label + ": the last refresh got no live data. Figures shown are previous or placeholder values.");
    }
    else {
      var stuck = [];
      (function walk(o, depth) {
        if (!o || typeof o !== "object" || depth > 4) return;
        if (o.live === false && (o.name || o.id || o.ticker)) stuck.push(o.ticker || o.name || o.id);
        for (var k in o) if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1);
      })(data, 0);
      if (stuck.length) problems.push(f.label + ": " + stuck.slice(0, 6).join(", ") + (stuck.length > 6 ? " and " + (stuck.length - 6) + " more" : "") +
        " did not update in the last refresh (marked “delayed” or “static”).");
    }
    var stamp = etStamp(data.updated), when = data.updated;
    if (f.policy === "intraday") {
      when = data.quotesAsOf || data.updated;
      stamp = etStamp(when);
      // through 40 min after the close, until the post-close refresh lands
      var open = isTradingDay(ny.date) && ny.mins >= 9 * 60 + 30 && ny.mins < closeMins(ny.date) + 40;
      if (open) {
        var age = (Date.now() - new Date(when).getTime()) / 60000;
        if (!(age <= (f.maxAge || 50))) problems.push(f.label + ": last quote " + fmtStamp(when) + ". These refresh every " + (f.every || "15 minutes") + " while the market is open, so the prices shown are out of date.");
      } else {
        var last = latestDay(ny, function (d) { return closeMins(d); });
        if (!stamp || stamp < last + " " + hhmm(closeMins(last) - 5)) {
          problems.push(f.label + ": last quote " + fmtStamp(when) + ", before the " + fmtDay(last) + " close. The prices shown are out of date.");
        }
      }
    } else if (f.policy === "morning") {
      var dm = latestDay(ny, function () { return 10 * 60 + 30; });
      if (!stamp || stamp < dm + " 06:00") problems.push(f.label + ": last refreshed " + fmtStamp(data.updated) + "; expected by 10:30 AM ET on " + fmtDay(dm) + ".");
    } else if (f.policy === "eod") {
      var de = latestDay(ny, function () { return 21 * 60; });
      if (!stamp || stamp < de + " " + hhmm(closeMins(de))) problems.push(f.label + ": last refreshed " + fmtStamp(data.updated) + "; should include the " + fmtDay(de) + " close.");
    } else if (f.policy === "session") {
      var ds = latestDay(ny, function () { return 18 * 60 + 30; });
      var have = String(data[f.dateField] || "").slice(0, 10);
      if (!have || have < ds) problems.push(f.label + ": data is from " + (have ? fmtDay(have) : "an unknown date") + "; the " + fmtDay(ds) + " close should be in by now.");
    } else if (f.policy === "weekly") {
      var ref = f.dateField && data[f.dateField] ? data[f.dateField] + "T20:00:00Z" : data.updated;
      if (!(Date.now() - new Date(ref).getTime() <= 8 * 86400000)) problems.push(f.label + ": last updated " + fmtStamp(ref) + ", more than a week ago.");
    }
    return problems;
  }

  var pageName = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var pageFeeds = PAGE_FEEDS[pageName] || [];
  var healthBanner = null;
  function showHealth(problems) {
    var stampEl = document.querySelector(".refresh-stamp");
    if (stampEl) stampEl.classList.toggle("stale", problems.length > 0);
    if (!problems.length) { if (healthBanner) healthBanner.hidden = true; return; }
    if (!healthBanner) {
      healthBanner = document.createElement("div");
      healthBanner.className = "stress-banner data-health";
      healthBanner.setAttribute("role", "alert");
      var page = document.querySelector(".page");
      if (page) page.insertBefore(healthBanner, page.firstChild);
    }
    healthBanner.hidden = false;
    healthBanner.innerHTML = '<span class="stress-banner-label">Data delayed</span><div class="stress-banner-body">' +
      problems.map(function (p) { return "<div>" + esc(p) + "</div>"; }).join("") + "</div>";
  }
  function checkHealth() {
    if (!pageFeeds.length) return;
    Promise.all(pageFeeds.map(function (name) {
      return fetch("data/" + name + "?h=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (d) { return checkFeed(name, d); }, function () { return checkFeed(name, null); });
    })).then(function (lists) { showHealth([].concat.apply([], lists)); });
  }
  checkHealth();
  setInterval(function () { if (document.visibilityState === "visible") checkHealth(); }, 5 * 60000);
  window.MDHealth = { check: checkFeed, run: checkHealth };

  // ---------- quote tape ----------

  var topbar = document.querySelector(".topbar");
  if (!topbar) return;
  var tape = document.createElement("div");
  tape.className = "tape";
  tape.setAttribute("aria-label", "Quote tape");
  tape.hidden = true;
  topbar.appendChild(tape);

  function fmtPx(q) {
    if (q.unit === "%") return q.value.toFixed(2) + "%";
    var digits = q.value >= 10000 ? 0 : 2;
    return q.value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtChg(q) {
    var sign = q.change >= 0 ? "+" : "-";
    var abs = Math.abs(q.change).toFixed(2);
    return sign + abs + (q.changeType === "pct" ? "%" : "");
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  var lastUpdated = null;
  function renderTape(data) {
    if (data.updated === lastUpdated) return;
    lastUpdated = data.updated;
    var quotes = (data.indices || []).concat(data.commodities || []).filter(function (q) {
      return typeof q.value === "number" && typeof q.change === "number";
    });
    if (!quotes.length) return;
    var items = quotes.map(function (q) {
      var cls = q.change >= 0 ? "up" : "down";
      return '<span class="tape-item"><span class="tape-sym">' + esc(q.ticker || q.name) + '</span>' +
        '<span class="tape-px">' + fmtPx(q) + '</span>' +
        '<span class="tape-chg ' + cls + '">' + (q.change >= 0 ? "▲" : "▼") + " " + fmtChg(q) + '</span></span>';
    }).join("");
    // Two copies side by side so the -50% scroll loops without a seam; the
    // set repeats until one copy is wider than any likely screen.
    var reps = Math.max(1, Math.ceil(24 / quotes.length));
    var copy = new Array(reps + 1).join(items);
    tape.innerHTML = '<div class="tape-track">' + copy + copy + '</div>';
    tape.hidden = false;
  }

  function loadTape() {
    fetch("data/overview.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(renderTape)
      .catch(function (err) { console.warn("Quote tape: could not load data/overview.json", err); });
  }

  loadTape();
  setInterval(function () { if (document.visibilityState === "visible") loadTape(); }, 60000);
})();
