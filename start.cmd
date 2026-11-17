@echo off
rem Launch the cloned Ram Mandir wedding site locally.
cd /d "%~dp0"
start "" http://127.0.0.1:8080/
node _tools/server.js 8080
