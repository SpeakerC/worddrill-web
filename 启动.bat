@echo off
chcp 65001 >nul
title WordDrill
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

node server.js
if errorlevel 1 (
    echo.
    echo The server exited with an error. Please check the message above.
    pause
)
