@echo off
setlocal
chcp 65001 >nul
title Atualizar QualityHub
if not exist "%~dp0.venv\Scripts\python.exe" (
  echo Ambiente Python nao encontrado. Confira a preparacao inicial no README.md.
  pause
  exit /b 1
)
"%~dp0.venv\Scripts\python.exe" "%~dp0backend\tools\qualityhub_update.py"
set "QUALITYHUB_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %QUALITYHUB_EXIT%
