@echo off
rem Double-click to start Friends Feuuud: installs what it needs the first
rem time, starts the game server and opens the big screen in your browser.
rem Close this window to end the game (scores are saved).

title Friends Feuuud
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Get the LTS version from https://nodejs.org, install it, then double-click this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo   First run: installing the game's parts. This takes a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   The install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Keep this window open while you play. Close it to end the game.
node server.js --open
if errorlevel 1 pause
