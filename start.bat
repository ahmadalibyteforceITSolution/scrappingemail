@echo off
title Google Business Email Scraper & Lead Generator
cd /d "%~dp0"

echo ========================================================
echo  Google Business Email Scraper & Lead Generator
echo ========================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b
)

:: Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] Installing project dependencies (first run)...
    call npm install
)

:: Ensure exports directory exists
if not exist "exports\" (
    mkdir "exports"
)

echo [INFO] Starting scraper web dashboard...
echo [INFO] Dashboard URL: http://localhost:3000
echo.

:: Open default browser
start "" "http://localhost:3000"

:: Start Node.js server
node server.js

pause
