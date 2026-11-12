@echo off
setlocal
chcp 65001 >nul
title Preparar QualityHub
set "QH_TARGET=%USERPROFILE%\QualityHubBAT"
where git.exe >nul 2>nul
if errorlevel 1 goto missing
where python.exe >nul 2>nul
if errorlevel 1 goto missing
where node.exe >nul 2>nul
if errorlevel 1 goto missing
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing
if exist "%QH_TARGET%" (
  echo A pasta %QH_TARGET% ja existe. Nenhum arquivo foi alterado.
  echo Se ja foi preparada, abra QualityHub.bat ou Atualizar QualityHub.bat nessa pasta.
  goto failed
)
git clone --branch main --single-branch https://github.com/leokowales/quality-hub-access-bat.git "%QH_TARGET%"
if errorlevel 1 goto failed
cd /d "%QH_TARGET%"
python -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip check
if errorlevel 1 goto failed
call npm.cmd ci
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
call QualityHub.bat --atalhos
if errorlevel 1 goto failed
echo Preparacao concluida. Abra QualityHub.bat em %QH_TARGET%.
echo Banco e autorizacao permanecem em LOCALAPPDATA\QualityHub\data.
pause
exit /b 0
:missing
echo Requer Git, Python 3.14, Node.js 24 com npm e Google Chrome preparados.
:failed
echo Preparacao interrompida. Preserve a pasta e os dados; nao repita apagando arquivos.
pause
exit /b 1
