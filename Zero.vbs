' ═══════════════════════════════════════════════
'  ZERO — Silent Launcher (no console window)
'  Double-click this to start Zero invisibly
' ═══════════════════════════════════════════════
Dim shell, fso, zeroDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

zeroDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Start Ollama silently if not running
shell.Run "cmd /c tasklist /FI ""IMAGENAME eq ollama.exe"" | find ""ollama.exe"" >NUL 2>&1 || start /B ollama serve", 0, False
WScript.Sleep 2000

' Start Electron (Zero) silently — no console window at all
shell.Run "cmd /c cd /d """ & zeroDir & """ && npx electron .", 0, False
