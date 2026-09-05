$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe).Source
$backupProcess = Start-Process -FilePath $nodeExecutable -ArgumentList 'scripts/backup-full.js' -WorkingDirectory $projectDirectory -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $projectDirectory 'logs/backup-full.out.log') -RedirectStandardError (Join-Path $projectDirectory 'logs/backup-full.err.log')
if ($backupProcess.ExitCode -ne 0) { exit $backupProcess.ExitCode }
$retentionProcess = Start-Process -FilePath $nodeExecutable -ArgumentList 'scripts/retain-data.js' -WorkingDirectory $projectDirectory -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $projectDirectory 'logs/retention.out.log') -RedirectStandardError (Join-Path $projectDirectory 'logs/retention.err.log')
exit $retentionProcess.ExitCode
