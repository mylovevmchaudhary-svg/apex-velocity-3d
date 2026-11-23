@echo off
title Push Apex Velocity 3D to GitHub
cd /d "%~dp0"

echo ==========================================================
echo    GITHUB PAR PUSH KARNE KE LIYE:
echo ==========================================================
echo.
echo 1. GitHub.com par jakar ek New Repository banayein (e.g. racing-game).
echo 2. Banane ke baad uska link copy karein (jaise: https://github.com/Username/racing-game.git).
echo.
set /p REPO_URL="Aapna GitHub Repo Link yahan Paste karke ENTER dabayein: "

if "%REPO_URL%"=="" (
    echo Koi link enter nahi kiya gaya! Exiting...
    pause
    exit /b
)

echo.
echo Connecting to GitHub...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git branch -M main

echo.
echo Uploading project to GitHub...
git push -u origin main

echo.
echo ==========================================================
echo    PROJECT GITHUB PAR PUSH HO GAYA HAI!
echo ==========================================================
echo Ab apne GitHub repo me "Actions" tab par jaiye:
echo Wahan APK aur AAB Bundle automatically build ho rahe hain!
echo.
pause
