@echo off
setlocal
chcp 65001 >nul
title QualityHub
if not exist "%~dp0.venv\Scripts\python.exe" (
  echo Ambiente Python nao encontrado em .venv.
  echo Siga a preparacao inicial descrita no README.md e tente novamente.
  pause
  exit /b 1
)
"%~dp0.venv\Scripts\python.exe" "%~dp0backend\tools\qualityhub_local.py" iniciar %*
set "QUALITYHUB_EXIT=%ERRORLEVEL%"
if not "%QUALITYHUB_EXIT%"=="0" (
  pause
)
exit /b %QUALITYHUB_EXIT%
