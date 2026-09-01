param([string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')))

$ErrorActionPreference = 'Stop'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$targets = @(
  (Join-Path $ProjectRoot '.env'),
  (Join-Path $ProjectRoot 'data.db'),
  (Join-Path $ProjectRoot 'data.db-shm'),
  (Join-Path $ProjectRoot 'data.db-wal'),
  (Join-Path $ProjectRoot 'uploads'),
  (Join-Path $ProjectRoot 'backups'),
  (Join-Path $ProjectRoot 'logs')
) | Where-Object { Test-Path -LiteralPath $_ }

foreach ($target in $targets) {
  $item = Get-Item -LiteralPath $target
  $permission = if ($item.PSIsContainer) { '(OI)(CI)F' } else { 'F' }
  & icacls.exe $target '/inheritance:r' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to disable ACL inheritance: $target" }
  & icacls.exe $target '/grant:r' "*$currentSid`:$permission" "*S-1-5-32-544`:$permission" "*S-1-5-18`:$permission" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply ACL: $target" }

  if ($item.PSIsContainer) {
    # /inheritance:r only changes the folder. Existing files keep their old ACL,
    # so explicitly grant the service account access to them as well.
    & icacls.exe (Join-Path $target '*') '/grant' '*S-1-5-18:F' '/T' '/C' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to repair child ACLs: $target" }
  }
  Write-Host "Secured: $target"
}
