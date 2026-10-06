@echo off
title Attendance Marker System
echo ============================================================
echo   Starting SmartAttendance Marker System...
echo ============================================================

cd /d "%~dp0"

:: Try running with Python first
python --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Detected Python! Starting server via Python...
    echo.
    echo Server URL: http://localhost:5000
    echo Press Ctrl+C in this window to stop the server.
    echo.
    start "" http://localhost:5000
    python server.py
    goto end
)

:: Fallback to Node.js
node -v >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Detected Node.js! Starting server via Node.js...
    echo.
    echo Server URL: http://localhost:5000
    echo Press Ctrl+C in this window to stop the server.
    echo.
    start "" http://localhost:5000
    node server.js
    goto end
)

echo [ERROR] Neither Python nor Node.js was found on your system PATH!
echo Please install Python (https://www.python.org) or Node.js (https://nodejs.org).
echo.
pause

:end
