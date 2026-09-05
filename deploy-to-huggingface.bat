@echo off
title Auto Deploy to Hugging Face Spaces
cd /d "%~dp0"

echo ========================================================
echo  Auto Deploy Scraper to Hugging Face (100%% FREE)
echo ========================================================
echo.
echo Space: https://huggingface.co/spaces/AhmadAli123/scrappingemail
echo.
echo To push automatically, you need a free Hugging Face Write Token:
echo 1. Open: https://huggingface.co/settings/tokens
echo 2. Click "Create new token" -> Select "Write" -> Copy the token.
echo.
set /p HF_TOKEN="Paste your Hugging Face Token here and press Enter: "

if "%HF_TOKEN%"=="" (
    echo [ERROR] No token provided!
    pause
    exit /b
)

echo.
echo [INFO] Pushing project code to Hugging Face Space...
git push https://AhmadAli123:%HF_TOKEN%@huggingface.co/spaces/AhmadAli123/scrappingemail main --force

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  SUCCESS! Your app is now building on Hugging Face!
    echo ========================================================
    echo.
    echo Open your Space in browser:
    echo https://huggingface.co/spaces/AhmadAli123/scrappingemail
    echo.
    start "" "https://huggingface.co/spaces/AhmadAli123/scrappingemail"
) else (
    echo.
    echo [ERROR] Push failed. Please make sure the token has "Write" permission.
)

pause
