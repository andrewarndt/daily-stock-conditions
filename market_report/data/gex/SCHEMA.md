# Universe Moves site feed (schema 1)

Written by `site_export.py` after each weekday 16:45 run. Static JSON, made to sit under the website's
`market_report/data/gex/` and be fetched client-side like the other cards. Derived figures only (no raw quotes).

## index.json
Top level: `schema`, `session` (ET trading day of the close), `built`, `count`, `filter`, `universe`, `method{}`, `source`,
`disclaimer`, `tickers[]`. Each ticker:

| field | meaning |
|---|---|
| `symbol`, `sp500`, `ndx`, `etf`, `name` | ticker, index membership; `etf` = one of the index ETFs SPY/QQQ/IWM/DIA (always included, `name` = the index it tracks, else null) |
| `avgContracts` | mean option contracts/day cleared at OCC, last 20 sessions |
| `spot` | session close |
| `day`, `week`, `month` | `{target, sdPct, bands{1,2,3:[lo,hi]}, flags[]}`: next session's close, this week's last expiry, the standard monthly |
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
