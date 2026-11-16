@echo off
REM Builds the Windows installer: dist\BOP-VMS-SLA-Personal-Setup-<version>.exe
REM Keep this file in the bop-vms-sla folder (next to package.json) and double-click it.
REM Requires Node.js 20 or newer (https://nodejs.org) and internet access to npm and GitHub.
setlocal
cd /d "%~dp0"
echo Project folder: %CD%
echo.

if not exist "package.json" goto :wrongfolder
if not exist "main\main.js" goto :wrongfolder

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 LTS or newer from https://nodejs.org, then run this file again.
  goto :stop
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 20 or newer is required. You have:
  node --version
  goto :stop
)
node -e "process.exit(require('./package.json').name === 'bop-vms-sla-personal' ? 0 : 1)"
if errorlevel 1 goto :wrongfolder

echo [1/3] Installing build tools...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fail
echo.
echo [2/3] Running tests...
call npm test
if errorlevel 1 goto :fail
echo.
echo [3/3] Building installer...
call npm run dist
if errorlevel 1 goto :fail
echo.
echo Done. Installer: %CD%\dist
explorer "%CD%\dist"
exit /b 0

:wrongfolder
echo This is not the BOP VMS-SLA Personal project folder.
echo build-installer.cmd must stay inside the bop-vms-sla-personal folder from the source zip,
echo next to package.json and the main, renderer and scripts folders.
echo Extract the zip again, open the bop-vms-sla-personal folder and double-click build-installer.cmd there.
goto :stop

:fail
echo.
echo Build failed. See the messages above.
:stop
pause
exit /b 1
