# Local backup trigger for the Market Desk refresh workflows.
#
# GitHub's scheduled (cron) runs are best-effort: on 2026-11-09 not one of
# them fired by mid-afternoon, and refresh-overview ("every 30 min") was
# really running about twice a day, so the site showed Friday's prices on
# Monday. This script runs from the Windows task "Market Desk Refresh
# Dispatch" every 30 minutes on weekdays, 07:00-17:30 local (Eastern) time,
# and starts the same workflows with `gh workflow run`. The GitHub crons
# stay in place as a second trigger; an extra run only commits if the data
# changed.
#
# Slots below are Eastern time, matching each workflow's cron in .github/workflows.
# Log: scripts/dispatch-refresh.log (not committed).

$ErrorActionPreference = "Continue"
$repo = "andrewarndt/daily-stock-conditions"
$log = Join-Path $PSScriptRoot "dispatch-refresh.log"
$now = Get-Date
$mins = $now.Hour * 60 + $now.Minute
$dow = $now.DayOfWeek

function In-Slot([int]$h, [int]$m) {
  # true when now falls in the 30-minute window starting at h:m (task fires on :00 / :30, possibly a little late)
  $start = $h * 60 + $m
  return ($mins -ge $start -and $mins -lt $start + 30)
}

$runs = @()
# Overview (quote tape, index tiles): every half hour through the session and just after the close.
if ($mins -ge 9 * 60 -and $mins -le 17 * 60) { $runs += "refresh-overview.yml" }
# Morning releases
if (In-Slot 7 0)  {
  $runs += "refresh-fed-watch.yml"; $runs += "refresh-aaii.yml"
  # Cboe posts some index history files hours after the close; re-run so last night's gaps fill in
  $runs += "refresh-volatility.yml"; $runs += "refresh-skew.yml"; $runs += "refresh-yields.yml"
}
if (In-Slot 8 0)  { $runs += "refresh-fear-greed.yml"; $runs += "refresh-putcall.yml" }
if (In-Slot 9 0)  { $runs += "refresh-economic.yml"; $runs += "refresh-consumer-sentiment.yml" }
if (In-Slot 9 30) { $runs += "refresh-fed-dashboard.yml" }
# After the close
if (In-Slot 16 30) {
  $runs += "refresh-fear-greed.yml"; $runs += "refresh-putcall.yml"; $runs += "refresh-sector-ratios.yml"
  $runs += "refresh-credit.yml"; $runs += "refresh-volatility.yml"
  if ($dow -eq "Friday") { $runs += "refresh-cot.yml" }
}
if (In-Slot 17 0) { $runs += "refresh-skew.yml"; $runs += "refresh-yields.yml" }

foreach ($w in ($runs | Select-Object -Unique)) {
  $out = & gh workflow run $w --repo $repo 2>&1
  Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm} {1} exit={2} {3}" -f $now, $w, $LASTEXITCODE, ($out -join " "))
}

# Record any refresh workflow that failed in the last 2 hours (the site's own
# "Data delayed" banner covers what visitors see; this is for the owner).
try {
  $failed = & gh run list --repo $repo --limit 30 --json workflowName,conclusion,createdAt,url 2>$null | ConvertFrom-Json |
    Where-Object { $_.conclusion -eq "failure" -and ([datetime]$_.createdAt) -gt (Get-Date).ToUniversalTime().AddHours(-2) }
  foreach ($f in $failed) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm} FAILED {1} {2}" -f $now, $f.workflowName, $f.url) }
} catch { }

