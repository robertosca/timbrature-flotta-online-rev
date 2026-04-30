@echo off
cd /d "%~dp0frontend"
npm install --legacy-peer-deps --registry=https://registry.npmjs.org
npm run dev
pause
