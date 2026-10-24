@echo off
setlocal
cd /d "%~dp0app"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.6 or later is required. Install Node.js and run this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\tsx.cmd" (
  echo Installing Translator dependencies...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
node scripts\launch.mjs
if errorlevel 1 pause
endlocal
