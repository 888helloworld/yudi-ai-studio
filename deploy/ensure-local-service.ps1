param(
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$NodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $NodeExe)) {
  $NodeExe = (Get-Command node -ErrorAction Stop).Source
}

$LogDir = Join-Path $ProjectDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-Listener {
  Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Test-AppHttp {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 "http://127.0.0.1:$Port/xi-image.html"
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

$listener = Get-Listener
if ($listener) {
  if (Test-AppHttp) {
    exit 0
  }

  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -like '*server.js*') {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  } else {
    exit 0
  }
}

Start-Process `
  -FilePath $NodeExe `
  -ArgumentList 'server.js' `
  -WorkingDirectory $ProjectDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $LogDir 'local-server.out.log') `
  -RedirectStandardError (Join-Path $LogDir 'local-server.err.log')

for ($i = 0; $i -lt 20; $i += 1) {
  Start-Sleep -Seconds 1
  if (Test-AppHttp) {
    exit 0
  }
}

exit 1
