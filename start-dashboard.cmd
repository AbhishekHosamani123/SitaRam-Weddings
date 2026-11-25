@echo off
rem Wedding Dashboard launcher — starts the local server (port 8080)
rem and opens the dashboard in your browser.
cd /d "%~dp0"
start "" http://127.0.0.1:8080/admin
node server.js
pause
