@echo off
rem One-click launcher for the Nomad offline map viewer (Windows).
rem Serves app/assets/city.mbtiles on http://127.0.0.1:8123/ and opens your browser.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22+ is required ^(node:sqlite^). Install it from https://nodejs.org/ and retry.
  pause
  exit /b 1
)
node server.mjs %*
pause
