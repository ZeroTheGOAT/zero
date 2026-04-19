@echo off
:: ═══════════════════════════════════════════════
::  ZERO — Launch Script
::  Run this to start Zero in the background
:: ═══════════════════════════════════════════════
title Zero AI Secretary
cd /d "%~dp0"

:: Start Ollama if not running
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I "ollama.exe" >NUL
if errorlevel 1 (
    start /B "" ollama serve >NUL 2>&1
    timeout /t 2 /nobreak >NUL
)

:: Start Zero (Electron)
start "" /B npx electron . >NUL 2>&1
