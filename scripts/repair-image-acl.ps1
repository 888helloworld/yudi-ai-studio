$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$uploadDirectory = (Resolve-Path -LiteralPath (Join-Path $projectDirectory 'uploads')).Path
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$repaired = @()
foreach ($imageFile in Get-ChildItem -LiteralPath $uploadDirectory -File) {
  if (($imageFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
  if ([IO.Path]::GetDirectoryName($imageFile.FullName) -ne $uploadDirectory) { throw 'Unexpected image path' }
  $imageAcl = Get-Acl -LiteralPath $imageFile.FullName
  if (@($imageAcl.Access).Count -ne 0) { continue }
  # 旧文件存在空 DACL，所有普通读取均被拒绝。仅修复这些文件。
  $repaired += [pscustomobject]@{ Name=$imageFile.Name; PreviousSddl=$imageAcl.Sddl }
  $auditPath = Join-Path $projectDirectory 'logs/image-acl-repair.json'
  New-Item -ItemType Directory -Path (Join-Path $projectDirectory 'logs') -Force | Out-Null
  $repaired | ConvertTo-Json | Set-Content -LiteralPath $auditPath -Encoding UTF8
  & takeown.exe /F $imageFile.FullName /A | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot take ownership: $($imageFile.Name)" }
  & icacls.exe $imageFile.FullName '/grant' "*$currentSid`:F" '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot repair ACL: $($imageFile.Name)" }
}
Write-Output "Repaired empty image ACLs: $($repaired.Count)"
