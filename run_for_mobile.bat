@echo off
title Apex Velocity 3D - Mobile Server
cd /d "%~dp0"
echo Starting Mobile Server...
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
