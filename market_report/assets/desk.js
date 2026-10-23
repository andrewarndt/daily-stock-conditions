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
