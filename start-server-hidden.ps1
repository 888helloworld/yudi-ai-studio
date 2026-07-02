$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3001

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  exit 0
}

$logDir = Join-Path $projectRoot 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$stdoutLog = Join-Path $logDir 'server-autostart.out.log'
$stderrLog = Join-Path $logDir 'server-autostart.err.log'
$nodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source

Start-Process `
  -FilePath $nodePath `
  -ArgumentList 'server.js' `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog
