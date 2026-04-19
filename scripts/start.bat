@echo off
:: ===============================================
::  ZERO — Launch Script
::  Run this to start Zero in the background
:: ===============================================
title Zero

:: We delegate to the VBS script to safely detach from the console window
:: This prevents the Electron GUI from crashing when the batch script exits
wscript "%~dp0Zero.vbs"
