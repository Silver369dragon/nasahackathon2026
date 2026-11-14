@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" goto setup_needed
if not exist "web\dist\index.html" goto setup_needed
if not defined HEALTH_BIND_HOST set "HEALTH_BIND_HOST=127.0.0.1"
if not defined HEALTH_PORT set "HEALTH_PORT=8000"
if not defined HEALTH_BODY_SCAN_DEMO set "HEALTH_BODY_SCAN_DEMO=1"
set "HEALTH_SCHEME=http"
if defined HEALTH_TLS_CERT goto tls
if defined HEALTH_TLS_KEY goto missing_tls
goto serve
:tls
if not defined HEALTH_TLS_KEY goto missing_tls
set "HEALTH_SCHEME=https"
:serve
echo Crew: %HEALTH_SCHEME%://%HEALTH_BIND_HOST%:%HEALTH_PORT%/app
echo Monitoring: %HEALTH_SCHEME%://%HEALTH_BIND_HOST%:%HEALTH_PORT%/system
if defined HEALTH_TLS_CERT (
  ".venv\Scripts\python.exe" -m uvicorn backend.main:app --host "%HEALTH_BIND_HOST%" --port "%HEALTH_PORT%" --workers 1 --ssl-certfile "%HEALTH_TLS_CERT%" --ssl-keyfile "%HEALTH_TLS_KEY%"
) else (
  ".venv\Scripts\python.exe" -m uvicorn backend.main:app --host "%HEALTH_BIND_HOST%" --port "%HEALTH_PORT%" --workers 1
)
exit /b %errorlevel%
:missing_tls
echo Set both HEALTH_TLS_CERT and HEALTH_TLS_KEY to serve HTTPS.
exit /b 1

:setup_needed
echo Missing Python environment or web build. Run setup.cmd first.
exit /b 1
