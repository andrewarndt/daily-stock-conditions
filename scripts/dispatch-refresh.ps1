# Local backup trigger for the Market Desk data refresh.
#
# The data is kept current by one long-running GitHub Actions job,
# .github/workflows/market-session.yml (market_report/scripts/session-loop.mjs),
# which GitHub starts several times a day. GitHub's scheduled triggers are
# best-effort (on 2026-11-09 none fired by mid-afternoon), so this script,
# run by the Windows task "Market Desk Refresh Dispatch" every 30 minutes on
# weekdays 07:00-17:30, starts the loop whenever no run is active or queued.
# The loop decides what to fetch from the data itself, so an extra start is
# harmless. Log: scripts/dispatch-refresh.log (not committed).

$ErrorActionPreference = "Continue"
$repo = "andrewarndt/daily-stock-conditions"
$log = Join-Path $PSScriptRoot "dispatch-refresh.log"
$now = Get-Date

function Log([string]$msg) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm} {1}" -f $now, $msg) }

try {
  $runs = & gh run list --repo $repo --workflow market-session.yml --limit 5 --json status,databaseId 2>$null | ConvertFrom-Json
  $active = @($runs | Where-Object { $_.status -in @("in_progress", "queued", "pending", "waiting", "requested") })
  if ($active.Count -eq 0) {
    $out = & gh workflow run market-session.yml --repo $repo 2>&1
    Log ("started market-session loop exit={0} {1}" -f $LASTEXITCODE, ($out -join " "))
  }
} catch {
  Log ("check failed: {0}; starting loop anyway" -f $_.Exception.Message)
  & gh workflow run market-session.yml --repo $repo 2>&1 | Out-Null
}

# Record any Market Desk workflow that failed in the last 2 hours.
try {
  $failed = & gh run list --repo $repo --limit 30 --json workflowName,conclusion,createdAt,url 2>$null | ConvertFrom-Json |
    Where-Object { $_.conclusion -eq "failure" -and ([datetime]$_.createdAt) -gt (Get-Date).ToUniversalTime().AddHours(-2) }
  foreach ($f in $failed) { Log ("FAILED {0} {1}" -f $f.workflowName, $f.url) }
} catch { }
