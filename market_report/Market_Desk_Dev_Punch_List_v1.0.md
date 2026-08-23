# Market Desk — Developer Punch List
**Site:** 4aholdingscompany.com/market_report
**Audit date:** Aug 23, 2026
**Prepared for:** Developer handoff
**Scope:** Incomplete items and defects found across all five tabs (Overview, Fed & Economic, Fed Dashboard, Sentiment, Sector Ratios). Dark pool module is intentionally not yet built and is out of scope for this list.

---

## How to read this

Each task is numbered and independent. Every task states: **where** the problem is, **what is wrong**, **the exact change**, and a **Done when** acceptance test. Do them in the numbered order — it is sorted by priority (data-integrity and "actively wrong" issues first, cosmetic last). Do not mark a task complete until its Done-when test passes on the live site, not just locally.

---

## TASK 1 — Confirm the data refresh job is actually running
**Priority:** BLOCKER — do this before anything else.
**Where:** Backend scheduler / cron, plus the "Last refresh" timestamp rendered in the header include on all five pages.

**What is wrong:** Every page header reads `Last refresh: Aug 7, 2026, 4:15 PM ET`. As of the audit that is 16 days stale. If the scheduled job that pulls FRED / Cboe / Yahoo / CNN data has died, then every section currently labeled "live" is serving frozen data, and no amount of label fixing below matters until the pipe is flowing again.

**Exact change:**
1. Check the scheduler (cron, GitHub Action, or whatever runs the pull) for the last successful run and its exit status.
2. If it is failing, capture the error and fix the job. Do not silently swallow failures.
3. Add a hard rule: the "Last refresh" timestamp must be written by the data job on success only, so a dead job produces a visibly old timestamp instead of a fake-fresh one.

**Done when:** The live site shows a "Last refresh" timestamp within the last trading day, and you can point to a log line proving the job ran successfully that day.

---

## TASK 2 — Fix the Put/Call widget that contradicts itself on the same page
**Priority:** P0
**Where:** Sentiment tab (`sentiment.html`), "Put/Call Ratio" section AND the page footer note.

**What is wrong:** The Put/Call widget shows `0.61` with the caption directly beneath it: *"Illustrative sample value — not a live feed."* The footer of the **same page** says: *"...the Put/Call Ratio above are real live feeds (CNN's Fear & Greed Index; Cboe's Total Put/Call Ratio), refreshed morning and evening on weekdays."* One page, two labels, opposite claims, a few inches apart.

**Exact change:** Determine the true state of this widget — is it wired to Cboe's Total Put/Call feed or not?
- If it **is** live: delete the "Illustrative sample value — not a live feed" caption under the 0.61 reading.
- If it is **not** live: remove "Put/Call Ratio" from the footer's list of real live feeds, and leave the illustrative caption.

There is no third option — the two statements cannot both stay.

**Done when:** Every mention of the Put/Call widget on `sentiment.html` agrees on whether it is live or placeholder. Same test for the Market Sentiment (Fear & Greed) gauge in the same footer sentence — verify it too matches its own widget caption.

---

## TASK 3 — Replace or remove the fabricated Fed Watch odds
**Priority:** P0
**Where:** Fed & Economic tab (`fed-economic.html`), "Fed Watch" section.

**What is wrong:** The page displays specific FOMC probability breakdowns —
- Sep 16–17, 2026: Hold 58% / Cut 25bp 37% / Cut 50bp 5%
- Oct 28–29, 2026: Hold 31% / Cut 25bp 52% / Cut 50bp 17%

— and then admits in the footnote: *"Fed Watch odds are illustrative and do not reflect actual fed funds futures pricing."* These are invented numbers presented with two-significant-figure precision that reads as real market data. Fabricated-but-confident is worse than empty.

**Exact change:** Two acceptable paths:
- **Preferred:** Wire this to real implied-probability data derived from fed funds futures (CME FedWatch methodology, or compute from the 30-Day Fed Funds futures series). Replace the hardcoded percentages with the computed values, and delete the "illustrative" footnote.
- **Acceptable interim:** If real odds cannot be sourced this sprint, replace the numeric percentages with an explicit "Not yet wired — placeholder" empty state (like the Fed Dashboard tiers use), so no fake precision is shown. Keep the section header, drop the invented numbers.

Do NOT leave real-looking percentages sitting above a disclaimer that they are fake.

**Done when:** The Fed Watch section either shows real futures-derived odds with no "illustrative" disclaimer, or shows an honest empty/placeholder state with no numeric percentages.

---

## TASK 4 — Reconcile the Fed Dashboard tab against the existing 13-series pipeline
**Priority:** P0 — largest gap on the site.
**Where:** Fed Dashboard tab (`fed-dashboard.html`), all three tiers.

**What is wrong:** All three tiers — Tier 1 Policy & Rate Path, Tier 2 Liquidity Plumbing, Tier 3 Financial Conditions & Credit — render a single row reading "Not yet added." Meanwhile a backend script (`fed_dashboard.py`) already exists that pulls 13 FRED series and computes Net Liquidity, the SOFR–IORB spread, the 10Y–3M spread, and percentile ranks. The working pipeline and this empty page are not connected.

**Exact change:**
1. First establish which is true: does `fed_dashboard.py` output feed anything, and is this HTML page a stale shell, or was the output never plumbed into any page? Report back before building.
2. Wire the 13-series output into the three tier tables. Expected series to place by tier (confirm against the script's actual output):
   - **Tier 1 (Policy & Rate Path):** EFFR, SOFR, IORB, SOFR–IORB spread.
   - **Tier 2 (Liquidity Plumbing):** WALCL, WTREGEN, RRPONTSYD, WRESBAL, Net Liquidity (derived).
   - **Tier 3 (Financial Conditions & Credit):** NFCI, HY OAS, IG OAS, yield-curve 10Y–3M spread.
3. Each row needs the four columns the table already defines: Indicator, Value, Trend, As of. Populate Trend from the percentile rank / direction the script already computes.
4. Remove the "Being built out line by line — check back soon" caption from any tier once it is populated.

**Done when:** All three tiers show live FRED-sourced values with per-row "As of" dates matching the source series' latest release, derived metrics (Net Liquidity, SOFR–IORB, 10Y–3M) compute client-side from those series, and no tier still says "Not yet added."

---

## TASK 5 — Fix the global "not live" banner that lies on four of five tabs
**Priority:** P0
**Where:** Shared header include, rendered on all five pages: *"Illustrative sample data — not live market feeds."*

**What is wrong:** This banner is a global include, but it is false on most of the site. Confirmed live data per each page's own footer: FRED Treasury yields (Fed & Economic), CNN Fear & Greed + Cboe Put/Call (Sentiment), Sector/SPY ratios via Yahoo + the full VIX family VIX9D/VIX/VIX3M/VIX6M/VIX1Y/VIXEQ/DSPX (Sector Ratios). The banner tells every visitor none of this is real.

**Exact change:** Kill the single global banner and move disclosure to the section level, which is already the pattern Sector Ratios uses correctly. Two options:
- **Preferred:** Remove the global banner entirely. Rely on per-widget captions (e.g. "Illustrative sample value") only on the sections that are genuinely placeholder. This matches how Sector Ratios already flags only Skew Structure as illustrative.
- **Acceptable:** Make the banner conditional/per-page and reword it to reflect mixed state, e.g. "Some sections are live; placeholder sections are labeled individually." A blanket "not live" claim is not acceptable on any page containing a live feed.

**Done when:** No page that contains at least one live feed displays a blanket "not live market feeds" banner. Remaining placeholder sections are each labeled at the widget level.

---

## TASK 6 — Populate the three empty tables on the Overview tab
**Priority:** P1
**Where:** Overview tab (`index.html`), sections "Major Indices," "Dollar & Commodities," "Economic Snapshot."

**What is wrong:** All three render their headers and subtitles ("As of market close," "Spot, as of last print," "CPI · PPI · Unemployment") but contain zero data rows. The Economic Snapshot table renders an empty header row (`Indicator | Latest | Prior | As of`) with no body. The page footnote correctly says these are placeholders, but the intent is for Overview to be the one-glance summary tab.

**Exact change:**
1. **Major Indices:** populate with index levels (at minimum SPX, NDX/QQQ, DJIA, RUT) — value and daily change, as of market close.
2. **Dollar & Commodities:** populate DXY plus key commodities (gold, WTI crude at minimum) — spot and change.
3. **Economic Snapshot:** populate the CPI / PPI / Unemployment rows with Latest, Prior, and As-of. This can reuse the same FRED pull that already feeds the Economic Indicators table on the Fed & Economic tab — do not build a second independent pull; share the source.
4. Remove the "Figures on this page are placeholder values" footnote once populated.

**Done when:** All three Overview sections show real values with change/as-of fields, sourced from the existing feeds (no new data vendor), and the placeholder footnote is gone.

---

## TASK 7 — Wire the "Next up" release-calendar field on Fed & Economic
**Priority:** P1
**Where:** Fed & Economic tab (`fed-economic.html`), top of page: `Next up  Loading…`

**What is wrong:** The "Next up" field is stuck on "Loading…". Per the page's own footnote it is supposed to read the next CPI/PPI/Jobs date from FRED's release calendar and the next FOMC date from the Fed Watch section.

**Exact change:** Implement the fetch that resolves "Loading…" into the actual next release. If it depends on the Fed Watch section (Task 3), sequence accordingly — but the CPI/PPI/Jobs portion comes from FRED's release calendar and can be wired independently of the FOMC piece.

**Done when:** "Next up" shows a real upcoming release name and date on load, with no persistent "Loading…" state. Verify it advances correctly after a release date passes.

---

## TASK 8 — Replace the static Consumer Sentiment placeholder
**Priority:** P2
**Where:** Sentiment tab (`sentiment.html`), "Consumer Sentiment" section (carries a `static` marker).

**What is wrong:** The University of Michigan Consumer Sentiment reading (68.4, ▲1.5 vs prior 66.9) is flagged in the footer as "still an illustrative placeholder." The surrounding commentary in the Claude Report references this number as if real.

**Exact change:** Wire to the UMich Consumer Sentiment series (available via FRED: `UMCSENT`). Replace the hardcoded 68.4 / 66.9 with live latest + prior, and drive the "▲ x.x pts vs prior" delta from the data. Remove the `static` marker and the placeholder note in the footer.

**Done when:** Consumer Sentiment shows the live UMICH/FRED value and computed delta, `static` marker removed, footer no longer calls it a placeholder.

---

## TASK 9 — Resolve the CNN Fear & Greed gauge live/placeholder ambiguity
**Priority:** P2
**Where:** Sentiment tab (`sentiment.html`), "Market Sentiment" gauge (shows 62 / "Greed").

**What is wrong:** The gauge caption reads "Illustrative sample value — not a live feed," but the footer lists the Market Sentiment gauge among the "real live feeds." Same class of contradiction as Task 2 but for the Fear & Greed gauge specifically. (Bundled separately because it is a different data source — CNN vs Cboe — and may have a different true status.)

**Exact change:** Confirm whether the Fear & Greed gauge is actually pulling live from CNN. Align the widget caption and the footer claim to the true state, same rule as Task 2.

**Done when:** The Market Sentiment gauge's caption and the footer agree on its live/placeholder status.

---

## TASK 10 — Wire the Skew Structure chart on Sector Ratios
**Priority:** P2
**Where:** Sector Ratios tab (`sector-ratios.html`), "Skew Structure" section (carries a `static` marker).

**What is wrong:** This is the one placeholder on the site that is currently labeled **correctly** — the footer honestly states Skew Structure is still illustrative. It is not a defect; it is unfinished. Listed here only so it is not forgotten. The "Implied volatility by strike / today vs 1 month ago" chart is placeholder.

**Exact change:** Source SPX implied volatility by strike (skew) data and populate the chart. Remove the `static` marker and update the footer once live.

**Done when:** Skew Structure renders real IV-by-strike data for today vs one month ago, `static` marker removed, footer updated to list it among live sections.

---

## TASK 11 — Standardize the disclosure pattern across all tabs
**Priority:** P2 — cleanup, do last, after Tasks 2–10 settle the individual widgets.
**Where:** All five pages.

**What is wrong:** The site mixes three disclosure styles: a global "not live" banner (Task 5), per-widget "illustrative" captions, and per-section `static` markers. Sector Ratios has the cleanest model: live sections unmarked, placeholder sections individually marked, one honest footer summarizing which is which.

**Exact change:** Adopt the Sector Ratios pattern site-wide:
1. No global banner (handled in Task 5).
2. Every placeholder widget carries a single consistent caption string — pick one exact wording and reuse it verbatim.
3. Each page footer carries one summary sentence listing which sections are live and which are placeholder, matching reality.

**Done when:** All five pages use identical placeholder-caption wording, no page has conflicting live/placeholder claims, and each footer accurately lists live vs placeholder sections.

---

## Summary checklist

| # | Task | Tab | Priority |
|---|------|-----|----------|
| 1 | Confirm refresh job is alive | All | BLOCKER |
| 2 | Put/Call self-contradiction | Sentiment | P0 |
| 3 | Fabricated Fed Watch odds | Fed & Economic | P0 |
| 4 | Fed Dashboard vs 13-series pipeline | Fed Dashboard | P0 |
| 5 | Global "not live" banner | All | P0 |
| 6 | Empty Overview tables | Overview | P1 |
| 7 | "Next up" stuck on Loading | Fed & Economic | P1 |
| 8 | Static Consumer Sentiment | Sentiment | P2 |
| 9 | Fear & Greed gauge ambiguity | Sentiment | P2 |
| 10 | Skew Structure placeholder | Sector Ratios | P2 |
| 11 | Standardize disclosure pattern | All | P2 |

**Out of scope for this list:** Dark pool / DIX module (not yet built, intentional). GEX and order-flow (explicitly out of scope for this sprint).
