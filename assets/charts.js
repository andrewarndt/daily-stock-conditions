/*
 * Market Desk — shared inline-SVG chart helpers.
 * No external dependencies. Reads colors from CSS custom properties so
 * charts stay correct in light/dark mode automatically.
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

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
   * multiple `series` to compare values on the same scale.
   */
  function lineChart(svg, opts) {
    svg.innerHTML = "";
    var width = +svg.getAttribute("width");
    var height = +svg.getAttribute("height");
    var padL = opts.padL || 42, padR = opts.padR || 14, padT = opts.padT || 16, padB = opts.padB || 26;
    var innerW = width - padL - padR, innerH = height - padT - padB;
    var series = opts.series;
    var xLabels = opts.xLabels;
    var allY = [];
    series.forEach(function (s) { allY = allY.concat(s.data); });
    var yLo = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, allY);
    var yHi = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, allY);
    if (yLo === yHi) { yLo -= 1; yHi += 1; }
    var pad = (yHi - yLo) * 0.12;
    yLo -= pad; yHi += pad;
    var x = scale([0, xLabels.length - 1], [padL, padL + innerW]);
    var y = scale([yLo, yHi], [padT + innerH, padT]);
    var yTicks = opts.yTicks || 4;
    var yFmt = opts.yFmt || function (v) { return v.toFixed(1); };

    for (var i = 0; i <= yTicks; i++) {
      var v = yLo + (yHi - yLo) * i / yTicks;
      var gy = y(v);
      el("line", { x1: padL, x2: padL + innerW, y1: gy, y2: gy, class: "gridline" }, svg);
      el("text", { x: padL - 8, y: gy + 3, class: "axis-label", "text-anchor": "end" }, svg).textContent = yFmt(v);
    }

    if (opts.referenceLine) {
      var ry = y(opts.referenceLine.value);
      el("line", { x1: padL, x2: padL + innerW, y1: ry, y2: ry, class: "ref-line" }, svg);
      el("text", { x: padL + innerW, y: ry - 4, class: "ref-label", "text-anchor": "end" }, svg).textContent = opts.referenceLine.label;
    }
    if (opts.referenceLine2) {
      var ry2 = y(opts.referenceLine2.value);
      el("line", { x1: padL, x2: padL + innerW, y1: ry2, y2: ry2, class: "ref-line" }, svg);
      el("text", { x: padL + innerW, y: ry2 - 4, class: "ref-label", "text-anchor": "end" }, svg).textContent = opts.referenceLine2.label;
    }

    var step = Math.max(1, Math.ceil(xLabels.length / (opts.maxXLabels || 7)));
    xLabels.forEach(function (lab, i) {
      if (i % step !== 0 && i !== xLabels.length - 1) return;
      el("text", { x: x(i), y: height - 8, class: "axis-label", "text-anchor": "middle" }, svg).textContent = lab;
    });

    series.forEach(function (s) {
      var pts = s.data.map(function (v, i) { return x(i) + "," + y(v); }).join(" ");
      if (s.area) {
        var areaPts = x(0) + "," + y(yLo) + " " + pts + " " + x(s.data.length - 1) + "," + y(yLo);
        el("polygon", { points: areaPts, fill: s.color, opacity: 0.1, stroke: "none" }, svg);
      }
      el("polyline", {
        points: pts, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dashed ? "5,4" : "none"
      }, svg);

      s.data.forEach(function (v, i) {
        var hit = el("circle", { cx: x(i), cy: y(v), r: 6, fill: "transparent" }, svg);
        el("title", {}, hit).textContent = xLabels[i] + " — " + s.name + ": " + yFmt(v);
      });

      var lastI = s.data.length - 1;
      var cx = x(lastI), cy = y(s.data[lastI]);
      el("circle", { cx: cx, cy: cy, r: 4, fill: s.color, stroke: css("--paper-raised"), "stroke-width": 2 }, svg);
      if (opts.endLabels !== false) {
        var anchor = (cx > padL + innerW - 60) ? "end" : "start";
        var lx = anchor === "end" ? cx - 8 : cx + 8;
        el("text", { x: lx, y: cy - 8, class: "end-label", "text-anchor": anchor }, svg).textContent = s.name + " " + yFmt(s.data[lastI]);
      }
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
    var width = +svg.getAttribute("width"), height = +svg.getAttribute("height");
    var padY = 4;
    var allVals = data.slice();
    if (opts.ma) allVals = allVals.concat(opts.ma.filter(function (v) { return v != null; }));
    var lo = Math.min.apply(null, allVals), hi = Math.max.apply(null, allVals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var x = scale([0, data.length - 1], [2, width - 2]);
    var y = scale([lo, hi], [height - padY, padY]);
    var pts = data.map(function (v, i) { return x(i) + "," + y(v); }).join(" ");
    var areaPts = x(0) + "," + (height - padY) + " " + pts + " " + x(data.length - 1) + "," + (height - padY);
    el("polygon", { points: areaPts, fill: color, opacity: 0.12, stroke: "none" }, svg);
    el("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    if (opts.ma) {
      var maPts = [];
      opts.ma.forEach(function (v, i) { if (v != null) maPts.push(x(i) + "," + y(v)); });
      if (maPts.length > 1) {
        el("polyline", {
          points: maPts.join(" "), fill: "none", stroke: opts.maColor || css("--ink-soft"),
          "stroke-width": 1.5, "stroke-dasharray": "3,2", "stroke-linejoin": "round", "stroke-linecap": "round"
        }, svg);
      }
    }

    var lastI = data.length - 1;
    el("circle", { cx: x(lastI), cy: y(data[lastI]), r: 3.5, fill: color, stroke: css("--paper-raised"), "stroke-width": 1.5 }, svg);
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
      var p = pt(r + 26, angleFor(zl[1]));
      el("text", { x: p[0], y: p[1] + 3, class: "axis-label", "text-anchor": "middle" }, svg).textContent = zl[0];
    });
    var na = angleFor(value);
    var tip = pt(r - 30, na);
    el("line", { x1: cx, y1: cy, x2: tip[0], y2: tip[1], stroke: css("--ink"), "stroke-width": 3, "stroke-linecap": "round" }, svg);
    el("circle", { cx: cx, cy: cy, r: 7, fill: css("--ink") }, svg);
  }

  global.MC = {
    css: css, el: el, scale: scale, lineChart: lineChart, sparkline: sparkline, gauge: gauge,
    movingAverage: movingAverage
  };
})(window);
