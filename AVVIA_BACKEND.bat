@echo off
cd /d "%~dp0backend"
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause
