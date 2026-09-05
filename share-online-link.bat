@echo off
title LeadHarvest Pro - Online Public Link Generator
cd /d "%~dp0"

echo ========================================================
echo  Generating Live Public Link for Lead Scraper
echo ========================================================
echo.

:: Check if server is running on port 3000, if not, start it in background
netstat -ano | findstr :3000 >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Starting scraper server in background...
    start /b node server.js
    timeout /t 2 >nul
)

echo [INFO] Connecting secure public tunnel...
echo [INFO] A public HTTPS link will appear below in 3 seconds.
echo [INFO] Copy the https:// link and send it to your friend or client!
echo.
echo --------------------------------------------------------
echo KEEP THIS WINDOW OPEN while sharing the link!
echo --------------------------------------------------------
echo.

ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 nokey@localhost.run

pause
