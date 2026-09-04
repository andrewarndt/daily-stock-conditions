#!/usr/bin/env node
/**
 * Refreshes data/fed-dashboard.json for bonds.html -- the pre-market
 * "Fed Dashboard" checklist (Tier 1 Policy & Rate Path / Tier 2 Liquidity
 * Plumbing / Tier 3 Financial Conditions & Credit), part of the Bonds page.
 * Built up line by line against market_report/fed_dashboard_checklist.txt
 * rather than all at once.
 *
 * Source: FRED (St. Louis Fed), same series-observations endpoint as
 * fetch-economic.mjs and fetch-yields.mjs. Every entry here is a free,
 * unrestricted FRED series -- unlike PMI/ISM, nothing on this checklist
 * needed a paid vendor or a static placeholder.
 *
 * Derived metrics (Net Liquidity, SOFR-IORB spread, 10Y-3M spread) are
 * intentionally NOT computed here -- they're arithmetic on other live
 * values already in this file (or, for 10Y-3M, already in yields.json), so
 * the page computes them client-side rather than duplicating the number.
 *
 * A SERIES_DEFS entry can also carry a `trendRule`: { window, label }.
 * Produces a plain expanding/contracting/flat direction over the trailing
 * `window` observations -- e.g. WALCL/WRESBAL move by tens of billions
 * every week as a matter of course, so the raw level on its own doesn't
 * tell a reader anything; the sign of the multi-observation change does.
 * No dead zone/noise band: direction is the literal sign of the change,
 * since this is a pre-market glance for a human, not an automated trigger.
 *
 * A SERIES_DEFS entry can also carry a `bandRule`: { bands: [{ max, label,
 * cls }] }, bands ascending by `max`, for a series where the raw number
 * isn't self-explanatory on its own (NFCI's z-score, a credit spread's
 * bps level). Produces `condition`/`conditionClass` from the first band
 * whose `max` the value is <= to; the page shows it as a badge above the
 * raw value. `cls` ("up"/"down"/"flat") is set explicitly per band rather
 * than inferred from the label text -- the same word can mean opposite
 * things across series (NFCI's "Tight" = restrictive = red; HY OAS's
 * "Tight" = spread compressed = green), so color can't be derived from
 * the label alone.
 *
 * A SERIES_DEFS entry can also carry a `stressRule` (currently just RRP):
 *   { changeWindow, changeThreshold, levelThreshold, unitLabel }
 * `stressed` trips if EITHER the change over the trailing `changeWindow`
 * business-day observations exceeds `changeThreshold` in absolute value, OR
 * the latest level exceeds `levelThreshold`. Computed here (not client-side)
 * because it needs the raw multi-day observation history, which this file
 * doesn't otherwise store -- only the derived flag + reason string do. The
 * bonds.html page reads `stressed`/`stressReason` off any series
 * generically, so a future line item just needs its own `stressRule` to
 * show up in the page's warning banner -- no page change required.
 *
 * Requires env var FRED_API_KEY (see .github/workflows/refresh-fed-dashboard.yml).
 * On any single-series failure, falls back to the previous value already in
 * data/fed-dashboard.json rather than failing the whole run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "fed-dashboard.json");

const FRED_API_KEY = process.env.FRED_API_KEY;

// Each entry: { id, tier, seriesId, name, unit, units? }. `units` maps to
// FRED's own `units` query param (e.g. "pc1" for YoY %) when a series needs
// transforming; omit for the raw reported value. Added to one at a time as
// each checklist line gets confirmed.
const SERIES_DEFS = [
  // Tier 1 -- Policy & Rate Path
  { id: "dfedtaru", tier: 1, seriesId: "DFEDTARU", name: "Fed Funds Target (Upper)", unit: "%" },
  { id: "dfedtarl", tier: 1, seriesId: "DFEDTARL", name: "Fed Funds Target (Lower)", unit: "%" },
  { id: "effr", tier: 1, seriesId: "EFFR", name: "Effective Fed Funds Rate", unit: "%" },
  { id: "sofr", tier: 1, seriesId: "SOFR", name: "SOFR", unit: "%" },
  { id: "iorb", tier: 1, seriesId: "IORB", name: "Interest on Reserve Balances", unit: "%" },
  // Tier 2 -- Liquidity Plumbing
  {
    id: "walcl", tier: 2, seriesId: "WALCL", name: "Fed Balance Sheet (Total Assets)", unit: "$M",
    trendRule: { window: 4, label: "4-wk" } // weekly series -> 4 observations = ~4 weeks
  },
  { id: "wtregen", tier: 2, seriesId: "WTREGEN", name: "Treasury General Account", unit: "$M" },
  {
    id: "wresbal", tier: 2, seriesId: "WRESBAL", name: "Bank Reserves", unit: "$M",
    trendRule: { window: 4, label: "4-wk" } // weekly series -> 4 observations = ~4 weeks
  },
  {
    id: "rrp", tier: 2, seriesId: "RRPONTSYD", name: "Overnight Reverse Repo", unit: "$B",
    // Facility's been drawn down near zero, so day-to-day % swings are just
    // noise there -- flag on absolute terms instead: a fast $25B+ move over
    // 5 sessions, or the level itself climbing back above $50B, either one
    // being well outside the recent sub-$2B daily baseline.
    stressRule: { changeWindow: 5, changeThreshold: 25, levelThreshold: 50, unitLabel: "B" }
  },
  // Tier 3 -- Financial Conditions & Credit
  {
    id: "nfci", tier: 3, seriesId: "NFCI", name: "Chicago Fed NFCI", unit: "",
    // NFCI is constructed as a z-score: mean 0, unit std dev, over the full
    // history back to 1971. Positive = tighter than average financial
    // conditions, negative = looser. Bands are roughly in std-dev terms --
    // within a quarter std dev of 0 counts as "Normal", beyond a full std
    // dev either way is the historically unusual end.
    bandRule: {
      bands: [
        { max: -1.0, label: "Very Loose", cls: "up" },
        { max: -0.25, label: "Loose", cls: "up" },
        { max: 0.25, label: "Normal", cls: "flat" },
        { max: 1.0, label: "Tight", cls: "down" },
        { max: Infinity, label: "Very Tight", cls: "down" }
      ]
    }
  },
  {
    id: "hyoas", tier: 3, seriesId: "BAMLH0A0HYM2", name: "High Yield OAS", unit: "bps",
    scale: 100, // FRED reports this in percent (2.75 = 275 bps); credit spreads are conventionally quoted in bps
    trendRule: { window: 5, label: "5-day", kind: "spread" },
    // FRED's own free history for this series only covers ~3 years back
    // (no 2008/2020 extremes to compute percentiles from here), so these
    // bands are set from well-established market convention instead:
    // long-run average OAS is roughly 400-500 bps; sub-300 has historically
    // meant cycle-peak complacency (2007, 2018, 2021); 800+ is where
    // recession/credit-event pricing starts; 1000+ is GFC/COVID territory.
    bandRule: {
      bands: [
        { max: 300, label: "Very Tight", cls: "up" },
        { max: 400, label: "Tight", cls: "up" },
        { max: 550, label: "Normal", cls: "flat" },
        { max: 800, label: "Wide", cls: "down" },
        { max: Infinity, label: "Stressed", cls: "down" }
      ]
    }
  },
  {
    id: "igoas", tier: 3, seriesId: "BAMLC0A0CM", name: "Investment Grade OAS", unit: "bps",
    scale: 100, // same percent-in-FRED, bps-on-page treatment as HY OAS
    trendRule: { window: 5, label: "5-day", kind: "spread" },
    // IG runs much tighter than HY (different risk profile, not just a
    // scaled-down version of it) -- long-run average OAS is roughly
    // 120-150 bps vs. HY's 400-500. Bands rescaled accordingly: sub-90 has
    // historically meant cycle-peak complacency (2018, 2021 lows ran
    // ~80-90); 250+ is where 2011/2015-16-style credit stress starts;
    // 2020 COVID and 2008 GFC both cleared that by a wide margin.
    bandRule: {
      bands: [
        { max: 90, label: "Very Tight", cls: "up" },
        { max: 120, label: "Tight", cls: "up" },
        { max: 160, label: "Normal", cls: "flat" },
        { max: 250, label: "Wide", cls: "down" },
        { max: Infinity, label: "Stressed", cls: "down" }
      ]
    }
  }
];

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const json = JSON.parse(raw);
    const byId = {};
    for (const item of json.series || []) byId[item.id] = item;
    return byId;
  } catch {
    return {};
  }
}

/** obs is FRED's own desc-sorted (newest-first) observations array. `kind`
 * picks the word pair the page renders: "level" (default) -> expanding/
 * contracting, for balance-sheet-scale series; "spread" -> up/down, which
 * reads more naturally for a spread like HY OAS or SOFR-IORB. Both map to
 * the same green/red coloring either way. */
function evaluateTrend(def, obs) {
  const rule = def.trendRule;
  if (!rule) return {};
  const anchorObs = obs[rule.window];
  if (!anchorObs) return {};
  const change = Number(obs[0].value) - Number(anchorObs.value);
  const words = rule.kind === "spread" ? ["up", "down"] : ["expanding", "contracting"];
  const trend = change > 0 ? words[0] : change < 0 ? words[1] : "flat";
  return { trend, trendChange: change, trendLabel: rule.label };
}

function evaluateBand(def, value) {
  const rule = def.bandRule;
  if (!rule) return {};
  const hit = rule.bands.find((b) => value <= b.max);
  return { condition: hit ? hit.label : undefined, conditionClass: hit ? hit.cls : undefined };
}

/** obs is FRED's own desc-sorted (newest-first) observations array. */
function evaluateStress(def, obs) {
  const rule = def.stressRule;
  if (!rule) return {};
  const latest = Number(obs[0].value);
  const anchorObs = obs[rule.changeWindow];
  const change = anchorObs ? latest - Number(anchorObs.value) : null;
  const u = rule.unitLabel || "";

  const overChange = change !== null && rule.changeThreshold !== undefined && Math.abs(change) > rule.changeThreshold;
  const overLevel = rule.levelThreshold !== undefined && latest > rule.levelThreshold;
  const stressed = overChange || overLevel;

  let stressReason = null;
  if (stressed) {
    const parts = [];
    if (overChange) parts.push(`moved ${change >= 0 ? "+" : ""}${change.toFixed(2)}${u} over the trailing ${rule.changeWindow} sessions`);
    if (overLevel) parts.push(`level ${latest.toFixed(2)}${u} is above the ${rule.levelThreshold}${u} threshold`);
    stressReason = parts.join("; ");
  }

  return { change5d: change !== null ? change : undefined, stressed, stressReason: stressReason || undefined };
}

async function fetchFredSeries(def, previous) {
  const prev = previous[def.id];
  if (!FRED_API_KEY) {
    console.warn(`[fred] no API key set, keeping previous value for ${def.id}`);
    return prev ? { ...prev, live: false } : null;
  }
  const unitsParam = def.units ? `&units=${def.units}` : "";
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=8${unitsParam}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error_code) throw new Error(json.error_message || `FRED error for ${def.seriesId}`);
    let obs = (json.observations || []).filter((o) => o.value !== ".");
    if (!obs.length) throw new Error(`no observations for ${def.seriesId}`);
    // Some FRED series (credit spreads) report in percent where this
    // dashboard displays bps -- `scale` rescales every observation up
    // front so every downstream calc (trend/stress/band) just sees
    // already-display-unit numbers.
    if (def.scale) obs = obs.map((o) => ({ date: o.date, value: String(Number(o.value) * def.scale) }));

    const value = Number(obs[0].value);
    const prior = obs.length > 1 ? Number(obs[1].value) : undefined;
    if (!Number.isFinite(value)) throw new Error(`bad value for ${def.seriesId}`);

    return {
      id: def.id, tier: def.tier, seriesId: def.seriesId, name: def.name, unit: def.unit,
      value, prior: Number.isFinite(prior) ? prior : undefined,
      asof: obs[0].date, live: true,
      ...evaluateTrend(def, obs),
      ...evaluateStress(def, obs),
      ...evaluateBand(def, value)
    };
  } catch (err) {
    console.warn(`[fred] failed for ${def.id} (${def.seriesId}): ${err.message}. Keeping previous value.`);
    return prev ? { ...prev, live: false } : null;
  }
}

async function main() {
  const previous = await loadPrevious();

  const results = await Promise.all(SERIES_DEFS.map((def) => fetchFredSeries(def, previous)));
  const series = results.filter(Boolean);

  const anyLive = series.some((s) => s.live);
  const out = {
    updated: new Date().toISOString(),
    source: anyLive ? "live" : "seed",
    series
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const liveCount = series.filter((s) => s.live).length;
  console.log(`Wrote ${OUT_PATH}: ${liveCount}/${SERIES_DEFS.length} series live this run.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
