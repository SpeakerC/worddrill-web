@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "data\server.pid" (
    echo WordDrill is not running.
    exit /b 0
)

set /p PID=<data\server.pid
taskkill /PID %PID% /F >nul 2>nul
del "data\server.pid" >nul 2>nul
echo Stopped ^(pid %PID%^).
