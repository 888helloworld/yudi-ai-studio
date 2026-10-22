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

# Node 24 默认不读 HTTP_PROXY/HTTPS_PROXY，必须显式打开这个开关，fetch 才会走本机的 Clash 代理。
# 实测：直连 api.xi-xu.me 下载 3MB 图片数据只有约 11KB/s（要 5 分钟），走代理约 1.5MB/s（1~2 秒）。
$env:NODE_USE_ENV_PROXY = '1'

Start-Process `
  -FilePath $nodePath `
  -ArgumentList 'server.js' `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog
