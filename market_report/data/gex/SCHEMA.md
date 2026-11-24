# Universe Moves site feed (schema 1)

Written by `site_export.py` after each weekday 16:45 run. Static JSON, made to sit under the website's
`market_report/data/gex/` and be fetched client-side like the other cards. Derived figures only (no raw quotes).

## index.json
Top level: `schema`, `session` (ET trading day of the close), `built`, `frozen{week, month}` (the closes the current frozen moves belong to), `count`, `filter`, `universe`, `method{}`, `source`,
`disclaimer`, `tickers[]`. Each ticker:

| field | meaning |
|---|---|
| `symbol`, `sp500`, `ndx`, `etf`, `name` | ticker, index membership; `etf` = one of the index ETFs SPY/QQQ/IWM/DIA (always included, `name` = the index it tracks, else null) |
| `avgContracts` | mean option contracts/day cleared at OCC, last 20 sessions |
| `spot` | session close |
| `day`, `week`, `month` | `{target, sdPct, sdUsd, bands{1,2,3:[lo,hi]}, flags[]}`; week/month also `anchor, anchorSpot, late` (see Frozen moves). Day = next session's close (live); week = next week's last expiry; month = the next standard monthly |
| `gex` | whole book `{callWall, putWall, flip, netGex, regime}`; regime = spot vs flip |

## tickers/&lt;SYMBOL&gt;.json
`symbol, name, session, spot, membership{sp500, ndx, etf}, optionVolume, moves{period_day, period_week, period_month, rolling_week, rolling_month},
expiries{nearest, monthly, count}, levels{all, nearest, monthly}, profiles{all, nearest}, quality`.

- `moves.*`: `{target, days, atmIv, sdPct, sdUsd, bands{1,2,3:[lo,hi]}, flags}`. Flags: `scaled` (no expiry listed by the horizon: nearest expiry's IV x sqrt(T); most single names on `period_day`),
  `wide` (ATM straddle spread > 20% of mid; after-close quotes run wide), `next-monthly`.
- `levels.*`: `{callWall, putWall, flip, netGex, regime}` or null; `nearest` = next expiry only, `monthly` = standard monthly only.
- `profiles.*`: parallel arrays `strike, callGex, putGex, netGex, callOi, putOi`, strikes within spot ± 25%.
  GEX is US$ per 1% move in the underlying (calls positive, puts negative).
- `quality.oiWithIvPct`: share of open interest that had a Cboe IV (gamma is 0 without one).

Class shares use a dot: `BRK.B.json`, `BF.B.json`.

## Frozen moves (2026-11-23)
`period_week` / `period_month` (and index `week` / `month`) are frozen, not live: week is set at the close of the week's last
session (Friday, or Thursday before a Friday holiday) to the next week's last expiry; month at the close of the month's last
session to the next standard monthly. Each is republished unchanged until the next such close. Extra fields: `frozen: true`,
`anchor` (session it was set at), `anchorSpot` (that close; bands centred on it), `late` (that close was missed, e.g. no run
or a name new to the filter, so the first later close was used). A month move shows a `target` before `session` after the
third Friday until the month-end close replaces it. `frozen.json` holds the current frozen blocks per symbol
(`{week: {anchor, moves{SYM: block}}, month: {...}}`); site_export.py reads it back from the site so runs continue the freeze.
