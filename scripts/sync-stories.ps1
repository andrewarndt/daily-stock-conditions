# Rebuilds the wildlife story pages from the Word documents and pushes any change
# to main (GitHub Pages then publishes it). Run by the "4A Story Pages Sync"
# scheduled task every 10 minutes; safe to run by hand too.
# Only wildlife/stories/ is ever committed, so other work in the repo is untouched.

$ErrorActionPreference = "Stop"
$repo   = Split-Path -Parent $PSScriptRoot
$source = "D:\GitHub\Stories for the Print"
$python = "C:\Python314\python.exe"
$log    = Join-Path $source "story-sync.log"

function Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $log -Encoding utf8
}

try {
  Set-Location $repo
  $build = & $python (Join-Path $repo "scripts\build-stories.py") $source 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "build failed: $build" }

  $changes = git status --porcelain -- wildlife/stories
  if (-not $changes) { exit 0 }

  git add -A -- wildlife/stories
  git commit -q -m "Update wildlife story pages from the Word documents" -- wildlife/stories
  if ($LASTEXITCODE -ne 0) { throw "commit failed" }

  for ($try = 1; $try -le 3; $try++) {
    git pull -q --rebase --autostash origin main
    git push -q origin main
    if ($LASTEXITCODE -eq 0) { Log "Published: $($build.Trim() -replace '\r?\n', '; ')"; exit 0 }
    Start-Sleep -Seconds 15
  }
  throw "push failed after 3 tries"
}
catch {
  Log "ERROR: $_"
  exit 1
}
