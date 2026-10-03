@echo off
REM Lance TV Monde (Windows) puis ouvre le navigateur.
cd /d "%~dp0"
python server.py %*
if errorlevel 1 py server.py %*
pause
