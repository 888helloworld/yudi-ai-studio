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
$SshOptions = @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes")

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

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
  "--exclude=./.playwright-cli",
  "--exclude=./.env",
  "--exclude=./backups",
  "--exclude=./logs",
  "--exclude=./output",
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
Invoke-NativeChecked scp @SshOptions $Archive $Remote`:$RemoteArchive

$RemoteScript = @'
set -e
umask 077
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
chmod 700 "$REMOTE_DIR"
if [ ! -f .env ]; then
  echo "ERROR: remote .env is missing at $REMOTE_DIR/.env" >&2
  exit 1
fi
sudo -n chmod 600 .env
mkdir -p uploads backups logs
chmod 700 uploads backups logs
find . -maxdepth 1 -type f \( -name 'data.db' -o -name 'data.db-*' \) -exec chmod 600 {} +
find backups -maxdepth 1 -type f -exec chmod 600 {} +
sudo -n chown "__USER__:__USER__" uploads backups logs
sudo -n find uploads backups logs -type f -exec chown "__USER__:__USER__" {} +
sudo -n find . -maxdepth 1 -type f \( -name 'data.db' -o -name 'data.db-*' \) -exec chown "__USER__:__USER__" {} +

env PATH="$PATH" npm ci --omit=dev
env PATH="$PATH" npm run check
if [ -f data.db ]; then
  env PATH="$PATH" npm run backup
fi

if sudo -n env PATH="$PATH" pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  sudo -n env PATH="$PATH" pm2 delete "$APP_NAME"
  sudo -n env PATH="$PATH" pm2 save
fi
if env PATH="$PATH" pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  env PATH="$PATH" pm2 restart "$APP_NAME" --update-env
else
  env PATH="$PATH" pm2 start server.js --name "$APP_NAME" --cwd "$REMOTE_DIR"
fi
env PATH="$PATH" pm2 save

healthy=0
for attempt in 1 2 3 4 5; do
  if curl --fail --silent --show-error http://127.0.0.1:3001/api/public/stats >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  env PATH="$PATH" pm2 logs "$APP_NAME" --lines 80 --nostream || true
  echo "ERROR: application health check failed" >&2
  exit 1
fi

BACKUP_CRON="17 3 * * * cd $REMOTE_DIR && PATH=$PATH npm run backup >> logs/backup.log 2>&1"
MAINTENANCE_CRON="47 3 * * * cd $REMOTE_DIR && PATH=$PATH npm run maintenance >> logs/maintenance.log 2>&1"
(crontab -l 2>/dev/null | grep -v "npm run backup" | grep -v "npm run maintenance"; echo "$BACKUP_CRON"; echo "$MAINTENANCE_CRON") | crontab -

find . -maxdepth 1 -type f \( -name 'data.db' -o -name 'data.db-*' \) -exec chmod 600 {} +
find uploads backups logs -type f -exec chmod 600 {} +

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
$RemoteScript | ssh @SshOptions $Remote "bash -s"
if ($LASTEXITCODE -ne 0) {
  throw "ssh failed with exit code $LASTEXITCODE"
}

Write-Host "Done. Deployment URL: https://$HostName/"
