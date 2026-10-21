/*
 * Market Desk — shared inline-SVG chart helpers.
 * No external dependencies. Reads colors from CSS custom properties so
 * charts stay correct in light/dark mode automatically.
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  // Every chart drawn, so a resize or theme switch can redraw them all.
  var allCharts = [];
  function track(svg) { if (allCharts.indexOf(svg) < 0) allCharts.push(svg); }

  function redraw(svg) {
    if (svg._mcSpark) { var a = svg._mcSpark; sparkline(svg, a.data, a.color, a.opts); }
    else if (svg._mcGauge !== undefined) gauge(svg, svg._mcGauge);
    else if (svg._mcOpts) lineChart(svg, svg._mcOpts);
  }

  var resizeTimer = null;
  global.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      allCharts.forEach(function (svg) { if (svg.isConnected) redraw(svg); });
    }, 150);
  });

  /**
   * Chart size factor. style.css grows the root font with the window past
   * 1600px wide (see the html rule there); charts grow by the same ratio so
   * their heights, padding and line weights keep pace with the text.
   */
  function sizeFactor() {
    var px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Math.max(1, px / 16);
  }

  /** The svg's own width/height attributes, read once, before any scaling. */
  function baseSize(svg) {
    if (!svg._mcBase) svg._mcBase = { w: +svg.getAttribute("width"), h: +svg.getAttribute("height") };
    return svg._mcBase;
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function scale(domain, range) {
    var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
    return function (v) { return r0 + (v - d0) / ((d1 - d0) || 1) * (r1 - r0); };
  }

  /**
   * General-purpose line/area chart with gridlines, axis labels, an
   * optional threshold reference line, per-point hover tooltips (native
   * <title>), and direct end-of-line labels. One y-axis only — pass
   * multiple `series` to compare values on the same scale. Set a series'
   * own `endLabel: false` to suppress just that one's label (e.g. a
   * moving-average overlay that converges with its source line near the
   * end and would otherwise collide with it) without losing labels on
   * the rest via the chart-wide `opts.endLabels`.
   *
   * A series' data may hold `null` for points it has no value at (e.g. a
   * series that starts later than the x-axis); the line breaks there.
   * `opts.bands` ([{ from, to, title }], x indexes, inclusive) shades
   * vertical spans behind the lines, e.g. recessions.
   */
  function lineChart(svg, opts) {
    svg.innerHTML = "";
    // Draw at the width the card actually gives the chart (CSS sets the svg
    // to 100% of its card), so text stays the same size at every screen
    // width; the width attribute is only the fallback when it isn't laid out.
    // Height and spacing follow the window's size factor.
    var k = sizeFactor();
    var base = baseSize(svg);
    svg.style.display = "block";
    svg.style.width = "100%";
    var laidOut = Math.round(svg.getBoundingClientRect().width);
    var width = laidOut > 0 ? laidOut : Math.round(base.w * k);
    var height = Math.round(base.h * k);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg._mcOpts = opts;
    track(svg);
    var padL = (opts.padL || 42) * k, padR = (opts.padR || 14) * k, padT = (opts.padT || 16) * k, padB = (opts.padB || 26) * k;
    var innerW = width - padL - padR, innerH = height - padT - padB;
    var series = opts.series;
    var xLabels = opts.xLabels;
    var allY = [];
    function has(v) { return v !== null && v !== undefined && isFinite(v); }
    series.forEach(function (s) { allY = allY.concat(s.data.filter(has)); });
    var yLo = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, allY);
    var yHi = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, allY);
    // Fit an auto-scaled axis to its reference lines too, so a threshold the
    // data hasn't reached (e.g. put/call 0.7 and 1.0 bands) still shows on
    // the plot instead of being drawn over the axis labels.
    [opts.referenceLine, opts.referenceLine2].forEach(function (ref) {
      if (!ref || !isFinite(ref.value)) return;
      if (opts.yMin === undefined) yLo = Math.min(yLo, ref.value);
      if (opts.yMax === undefined) yHi = Math.max(yHi, ref.value);
    });
    if (yLo === yHi) { yLo -= 1; yHi += 1; }
    // opts.exactRange keeps a fixed scale such as 0-100% instead of padding it.
    var pad = opts.exactRange ? 0 : (yHi - yLo) * 0.12;
    yLo -= pad; yHi += pad;
    var x = scale([0, xLabels.length - 1], [padL, padL + innerW]);
    var y = scale([yLo, yHi], [padT + innerH, padT]);
    var yTicks = opts.yTicks || 4;
    var yFmt = opts.yFmt || function (v) { return v.toFixed(1); };

    for (var i = 0; i <= yTicks; i++) {
      var v = yLo + (yHi - yLo) * i / yTicks;
      var gy = y(v);
      el("line", { x1: padL, x2: padL + innerW, y1: gy, y2: gy, class: "gridline" }, svg);
      el("text", { x: padL - 8 * k, y: gy + 3 * k, class: "axis-label", "text-anchor": "end" }, svg).textContent = yFmt(v);
    }

    var halfStep = innerW / Math.max(1, xLabels.length - 1) / 2;
    (opts.bands || []).forEach(function (b) {
      var bx0 = Math.max(padL, x(b.from) - halfStep), bx1 = Math.min(padL + innerW, x(b.to) + halfStep);
      var band = el("rect", { x: bx0, y: padT, width: Math.max(1, bx1 - bx0), height: innerH, class: "band" }, svg);
      if (b.title) el("title", {}, band).textContent = b.title;
    });

    [opts.referenceLine, opts.referenceLine2].forEach(function (ref) {
      if (!ref) return;
      var ry = y(ref.value);
      el("line", { x1: padL, x2: padL + innerW, y1: ry, y2: ry, class: "ref-line" }, svg);
      el("text", { x: padL + innerW, y: ry - 4 * k, class: "ref-label", "text-anchor": "end" }, svg).textContent = ref.label;
    });

    // Fewer x labels on narrow charts so they never run together; the last
    // one is right-aligned so it stays inside the plot.
    var maxX = Math.max(2, Math.min(opts.maxXLabels || 7, Math.floor(innerW / (85 * k))));
    var step = Math.max(1, Math.ceil(xLabels.length / maxX));
    var lastX = xLabels.length - 1;
    // opts.xTickFmt shortens the axis text only; hover titles keep xLabels.
    var xTick = opts.xTickFmt || function (lab) { return lab; };
    xLabels.forEach(function (lab, i) {
      if (i === lastX) {
        el("text", { x: x(i), y: height - 8 * k, class: "axis-label", "text-anchor": "end" }, svg).textContent = xTick(lab, i);
        return;
      }
      if (i % step !== 0 || x(lastX) - x(i) < 70 * k) return;
      el("text", { x: x(i), y: height - 8 * k, class: "axis-label", "text-anchor": i === 0 ? "start" : "middle" }, svg).textContent = xTick(lab, i);
    });

    var endLabels = [];
    series.forEach(function (s) {
      // One polyline per unbroken run of values.
      var runs = [], run = null;
      s.data.forEach(function (v, i) {
        if (!has(v)) { run = null; return; }
        if (!run) { run = []; runs.push(run); }
        run.push(i);
      });
      runs.forEach(function (idx) {
        var pts = idx.map(function (i) { return x(i) + "," + y(s.data[i]); }).join(" ");
        if (s.area) {
          var areaPts = x(idx[0]) + "," + y(yLo) + " " + pts + " " + x(idx[idx.length - 1]) + "," + y(yLo);
          el("polygon", { points: areaPts, fill: s.color, opacity: 0.1, stroke: "none" }, svg);
        }
        el("polyline", {
          points: pts, fill: "none", stroke: s.color, "stroke-width": (s.width || 2) * k,
          "stroke-linejoin": "round", "stroke-linecap": "round",
          "stroke-dasharray": s.dashed ? (5 * k) + "," + (4 * k) : "none"
        }, svg);
      });

      s.data.forEach(function (v, i) {
        if (!has(v)) return;
        var hit = el("circle", { cx: x(i), cy: y(v), r: 6 * k, fill: "transparent" }, svg);
        el("title", {}, hit).textContent = xLabels[i] + " — " + s.name + ": " + yFmt(v);
      });

      var lastI = s.data.length - 1;
      while (lastI > 0 && !has(s.data[lastI])) lastI--;
      if (!has(s.data[lastI])) return;
      var cx = x(lastI), cy = y(s.data[lastI]);
      el("circle", { cx: cx, cy: cy, r: 4 * k, fill: s.color, stroke: css("--paper-raised"), "stroke-width": 2 * k }, svg);
      if (opts.endLabels !== false && s.endLabel !== false) {
        var anchor = (cx > padL + innerW - 60 * k) ? "end" : "start";
        var lx = anchor === "end" ? cx - 8 * k : cx + 8 * k;
        endLabels.push({ x: lx, y: cy - 8 * k, anchor: anchor, text: s.name + " " + yFmt(s.data[lastI]) });
      }
    });

    // Push end labels apart when lines finish close together, so two
    // labels never print on top of each other.
    endLabels.sort(function (a, b) { return a.y - b.y; });
    for (var j = 1; j < endLabels.length; j++) {
      if (endLabels[j].y - endLabels[j - 1].y < 13 * k) endLabels[j].y = endLabels[j - 1].y + 13 * k;
    }
    endLabels.forEach(function (l) {
      el("text", { x: l.x, y: Math.max(11 * k, l.y), class: "end-label", "text-anchor": l.anchor }, svg).textContent = l.text;
    });
  }

  /**
   * Tiny axis-free line+area sparkline for stat tiles / small multiples.
   * Pass `opts.ma` (same length as `data`, with leading `null`s for the
   * warm-up window) to overlay a muted dashed moving-average line on the
   * same scale — e.g. a 5-day MA over a daily series.
   */
  function sparkline(svg, data, color, opts) {
    opts = opts || {};
    svg.innerHTML = "";
    var k = sizeFactor();
    var base = baseSize(svg);
    var width = Math.round(base.w * k), height = Math.round(base.h * k);
    svg._mcSpark = { data: data, color: color, opts: opts };
    track(svg);
    // opts.fluid draws at the tile's laid-out width (like lineChart); leave
    // it off inside table cells, which size to content.
    if (opts.fluid) {
      svg.style.display = "block";
      svg.style.width = "100%";
      var laidOut = Math.round(svg.getBoundingClientRect().width);
      if (laidOut > 0) width = laidOut;
    }
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    var padY = 4 * k;
    var allVals = data.slice();
    if (opts.ma) allVals = allVals.concat(opts.ma.filter(function (v) { return v != null; }));
    var lo = Math.min.apply(null, allVals), hi = Math.max.apply(null, allVals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var x = scale([0, data.length - 1], [2 * k, width - 2 * k]);
    var y = scale([lo, hi], [height - padY, padY]);
    var pts = data.map(function (v, i) { return x(i) + "," + y(v); }).join(" ");
    var areaPts = x(0) + "," + (height - padY) + " " + pts + " " + x(data.length - 1) + "," + (height - padY);
    el("polygon", { points: areaPts, fill: color, opacity: 0.12, stroke: "none" }, svg);
    el("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 2 * k, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    if (opts.ma) {
      var maPts = [];
      opts.ma.forEach(function (v, i) { if (v != null) maPts.push(x(i) + "," + y(v)); });
      if (maPts.length > 1) {
        el("polyline", {
          points: maPts.join(" "), fill: "none", stroke: opts.maColor || css("--ink-soft"),
          "stroke-width": 1.5 * k, "stroke-dasharray": (3 * k) + "," + (2 * k), "stroke-linejoin": "round", "stroke-linecap": "round"
        }, svg);
      }
    }

    var lastI = data.length - 1;
    el("circle", { cx: x(lastI), cy: y(data[lastI]), r: 3.5 * k, fill: color, stroke: css("--paper-raised"), "stroke-width": 1.5 * k }, svg);
  }

  /** Simple moving average; returns an array the same length as `data`, with `null` for the warm-up window. */
  function movingAverage(data, window) {
    return data.map(function (_, i) {
      if (i < window - 1) return null;
      var sum = 0;
      for (var k = i - window + 1; k <= i; k++) sum += data[k];
      return sum / window;
    });
  }

  /** Fear/greed style semicircular gauge, value 0-100. */
  function gauge(svg, value) {
    svg.innerHTML = "";
    svg._mcGauge = value;
    track(svg);
    // Wider than the dial so the "Extreme Fear/Greed" labels are not clipped.
    // The viewBox scales the whole dial with the window, so its labels use a
    // fixed size in dial units instead of the page's growing rem.
    var k = sizeFactor();
    svg.setAttribute("width", Math.round(420 * k));
    svg.setAttribute("height", Math.round(190 * k));
    svg.setAttribute("viewBox", "-50 0 420 190");
    var cx = 160, cy = 160, r = 120, thickness = 22;
    function pt(radius, angleDeg) {
      var a = angleDeg * Math.PI / 180;
      return [cx + radius * Math.cos(a), cy - radius * Math.sin(a)];
    }
    function angleFor(v) { return 180 - v * 1.8; }
    var zones = [
      { from: 0, to: 20, color: css("--down"), opacity: 1 },
      { from: 20, to: 40, color: css("--down"), opacity: 0.55 },
      { from: 40, to: 60, color: css("--ink-soft"), opacity: 1 },
      { from: 60, to: 80, color: css("--up"), opacity: 0.55 },
      { from: 80, to: 100, color: css("--up"), opacity: 1 }
    ];
    zones.forEach(function (z) {
      var a0 = angleFor(z.from) - 1, a1 = angleFor(z.to) + 1;
      var steps = 16, path = "";
      for (var i = 0; i <= steps; i++) {
        var a = a0 + (a1 - a0) * i / steps;
        var p = pt(r, a);
        path += (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1) + " ";
      }
      el("path", { d: path, fill: "none", stroke: z.color, "stroke-width": thickness, "stroke-linecap": "butt", opacity: z.opacity }, svg);
    });
    [["Extreme Fear", 10], ["Fear", 30], ["Neutral", 50], ["Greed", 70], ["Extreme Greed", 90]].forEach(function (zl) {
      // Labels sit outside the dial and read away from it, so the long
      // "Extreme" ones never print over the colored arc.
      var p = pt(r + 18, angleFor(zl[1]));
      var anchor = zl[1] < 50 ? "end" : zl[1] > 50 ? "start" : "middle";
      el("text", { x: p[0], y: p[1] + 3, class: "axis-label", "text-anchor": anchor, style: "font-size:10px" }, svg).textContent = zl[0];
    });
    var na = angleFor(value);
    var tip = pt(r - 30, na);
    el("line", { x1: cx, y1: cy, x2: tip[0], y2: tip[1], stroke: css("--ink"), "stroke-width": 3, "stroke-linecap": "round" }, svg);
    el("circle", { cx: cx, cy: cy, r: 7, fill: css("--ink") }, svg);
  }

  var THEME_TOKENS = ["--ink", "--ink-soft", "--paper-raised", "--line", "--accent", "--up", "--down", "--blue"];

  function tokenValues() {
    var out = {};
    THEME_TOKENS.forEach(function (t) { out[t] = css(t).toLowerCase(); });
    return out;
  }

  /**
   * Switch the page to "light" or "dark" and redraw every chart. Page
   * scripts pass resolved colors (MC.css("--blue")), so each stored color
   * is mapped from its old theme value to the same token's new value.
   */
  function setTheme(theme) {
    var before = tokenValues();
    document.documentElement.setAttribute("data-theme", theme);
    var after = tokenValues();
    var map = {};
    THEME_TOKENS.forEach(function (t) { map[before[t]] = after[t]; });
    function swap(c) { return (typeof c === "string" && map[c.toLowerCase()]) || c; }
    allCharts.forEach(function (svg) {
      if (!svg.isConnected) return;
      if (svg._mcSpark) {
        var a = svg._mcSpark;
        a.color = swap(a.color);
        if (a.opts && a.opts.maColor) a.opts.maColor = swap(a.opts.maColor);
      } else if (svg._mcOpts) {
        svg._mcOpts.series.forEach(function (s) { s.color = swap(s.color); });
      }
      redraw(svg);
    });
  }

  global.MC = {
    setTheme: setTheme,
    css: css, el: el, scale: scale, lineChart: lineChart, sparkline: sparkline, gauge: gauge,
    movingAverage: movingAverage
  };
})(window);
