Option Explicit

Dim shell, fso, projectDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' 取本脚本所在目录的上一级（deploy 的父目录），换电脑后不用改路径。
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & projectDir & "\deploy\ensure-local-service.ps1"""

shell.CurrentDirectory = projectDir
shell.Run command, 0, False
