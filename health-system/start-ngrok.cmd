@echo off
setlocal
cd /d "%~dp0"
where ngrok >nul 2>nul
if errorlevel 1 (
  echo Install ngrok from Microsoft Store, then reopen this terminal.
  exit /b 1
)
echo Firmware endpoint: append /v1/telemetry to the HTTPS URL below.
echo Keep the medical backend on port 8000 and this window running.
ngrok http http://127.0.0.1:8000 --url https://taliyah-unfalsifiable-overcredulously.ngrok-free.dev --inspect=false --traffic-policy-file "%~dp0ngrok-telemetry.yml"
