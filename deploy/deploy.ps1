param(
  [Parameter(Mandatory=$true)]
  [string]$HostName,
  [Parameter(Mandatory=$true)]
  [string]$User,
  [Parameter(Mandatory=$true)]
  [string]$KeyPath,
  [Parameter(Mandatory=$true)]
  [string]$RemoteDir,
  [string]$AppName = "xiaohongshu-image-tool",
  [string]$NodePath = "/root/.nvm/versions/node/v22.22.2/bin",
  [switch]$IncludeRuntimeData
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Archive = Join-Path $env:TEMP "$AppName-deploy.tgz"
$RemoteArchive = "/tmp/$AppName-deploy.tgz"
$Remote = "$User@$HostName"

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "SSH key not found: $KeyPath"
}

if (Test-Path -LiteralPath $Archive) {
  Remove-Item -LiteralPath $Archive -Force
}

$Excludes = @(
  "--exclude=./node_modules",
  "--exclude=./.git",
  "--exclude=./.claude",
  "--exclude=./.vscode",
  "--exclude=./.workbuddy",
  "--exclude=./.env",
  "--exclude=./*.log",
  "--exclude=./err.txt",
  "--exclude=./err2.txt",
  "--exclude=./node_err.txt",
  "--exclude=./node_out.txt",
  "--exclude=./out.txt",
  "--exclude=./out2.txt"
)

if (-not $IncludeRuntimeData) {
  $Excludes += @(
    "--exclude=./data.db",
    "--exclude=./uploads"
  )
}

Write-Host "Packaging $RepoRoot"
Push-Location $RepoRoot
try {
  tar -czf $Archive @Excludes .
} finally {
  Pop-Location
}

$ArchiveInfo = Get-Item -LiteralPath $Archive
Write-Host ("Archive: {0:N1} MB" -f ($ArchiveInfo.Length / 1MB))

Write-Host "Uploading to ${Remote}:$RemoteArchive"
scp -i $KeyPath -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes $Archive $Remote`:$RemoteArchive

$RemoteScript = @'
set -e
NODE_PATH="__NODE_PATH__"
APP_NAME="__APP_NAME__"
REMOTE_DIR="__REMOTE_DIR__"
ARCHIVE="__REMOTE_ARCHIVE__"
PATH="$NODE_PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

sudo -n mkdir -p "$REMOTE_DIR"
sudo -n chown "__USER__:__USER__" "$REMOTE_DIR"
tar -xzf "$ARCHIVE" -C "$REMOTE_DIR"
rm -f "$ARCHIVE"

cd "$REMOTE_DIR"
if [ ! -f .env ]; then
  echo "ERROR: remote .env is missing at $REMOTE_DIR/.env" >&2
  exit 1
fi
sudo -n chmod 600 .env

sudo -n env PATH="$PATH" npm ci --omit=dev

if sudo -n env PATH="$PATH" pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  sudo -n env PATH="$PATH" pm2 restart "$APP_NAME" --update-env
else
  sudo -n env PATH="$PATH" pm2 start server.js --name "$APP_NAME" --cwd "$REMOTE_DIR"
fi

echo "Remote deploy finished"
'@

$RemoteScript = $RemoteScript.
  Replace("__NODE_PATH__", $NodePath).
  Replace("__APP_NAME__", $AppName).
  Replace("__REMOTE_DIR__", $RemoteDir).
  Replace("__REMOTE_ARCHIVE__", $RemoteArchive).
  Replace("__USER__", $User)
$RemoteScript = $RemoteScript -replace "`r`n", "`n"

Write-Host "Deploying on remote host"
$RemoteScript | ssh -i $KeyPath -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes $Remote "bash -s"

Write-Host "Done. Deployment URL: http://$HostName/"
