' Start WordDrill in background; the browser opens automatically.
' Run "stop.bat" to stop the server.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder
sh.Run "node server.js", 0, False
