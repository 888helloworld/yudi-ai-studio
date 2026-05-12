Option Explicit

Dim shell, projectDir, command
Set shell = CreateObject("WScript.Shell")
projectDir = "C:\Users\Administrator\xiaohongshu-image-tool"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & projectDir & "\deploy\ensure-local-service.ps1"""

shell.CurrentDirectory = projectDir
shell.Run command, 0, False
