@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul 2>nul

set "POCKETDEX_NODE="

if defined POCKETDEX_NODE_EXE if exist "%POCKETDEX_NODE_EXE%" set "POCKETDEX_NODE=%POCKETDEX_NODE_EXE%"

if not defined POCKETDEX_NODE (
  for %%I in (node.exe) do set "POCKETDEX_NODE=%%~$PATH:I"
)

if not defined POCKETDEX_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "POCKETDEX_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined POCKETDEX_NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "POCKETDEX_NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined POCKETDEX_NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "POCKETDEX_NODE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined POCKETDEX_NODE (
  echo.
  echo PocketDex needs Node.js 18 or newer.
  echo Install it from https://nodejs.org and run start.bat again.
  echo.
  echo Tip: the standard Node.js installer includes npm automatically.
  echo.
  pause
  exit /b 1
)

"%POCKETDEX_NODE%" scripts\bootstrap.js
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  pause
)
exit /b %EXIT_CODE%
