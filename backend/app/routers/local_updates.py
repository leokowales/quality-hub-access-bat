"""Authenticated bridge to the fixed BAT distribution updater."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix='/local-updates', tags=['local-updates'])
ROOT = Path(__file__).resolve().parents[3]
REMOTE = 'https://github.com/leokowales/quality-hub-access-bat.git'
_lock = threading.Lock()
_process = None


def available():
    if os.name != 'nt' or getattr(sys, 'frozen', False) or os.getenv('QUALITYHUB_WEB_HOMOLOGATION') == '1':
        return False
    git = shutil.which('git.exe')
    if not git or not (ROOT / '.git').is_dir():
        return False
    from tools import qualityhub_local as local
    try:
        state = local.read_state()
        if not local.recognized(local.Win32(), state):
            return False
        result = subprocess.run([git, 'remote', 'get-url', 'origin'], cwd=ROOT,
                                capture_output=True, text=True, timeout=10,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        return result.returncode == 0 and result.stdout.strip() == REMOTE
    except (OSError, subprocess.TimeoutExpired):
        return False


@router.get('/status')
def status():
    code = _process.poll() if _process is not None else None
    return {'enabled': available(), 'applying': _process is not None and code is None,
            'result': code}


@router.post('/apply', status_code=202)
def apply_update():
    global _process
    with _lock:
        if _process is not None and _process.poll() is None:
            raise HTTPException(409, 'Já existe uma atualização em andamento.')
        if not available():
            raise HTTPException(409, 'Atualização pela tela disponível somente na distribuição BAT gerenciada.')
        logs = ROOT / 'logs/local'
        logs.mkdir(parents=True, exist_ok=True)
        try:
            with (logs / 'update-launch.log').open('ab') as output:
                # Escape the launcher's job explicitly so closing the app cannot kill the updater.
                _process = subprocess.Popen(
                    [str(ROOT / '.venv/Scripts/python.exe'), str(ROOT / 'backend/tools/qualityhub_update.py')],
                    cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                    env={**os.environ, 'PYTHONUTF8': '1'},
                    creationflags=0x01000000 | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                    close_fds=True)
        except OSError as error:
            raise HTTPException(503, 'Não foi possível iniciar o atualizador. Use Atualizar QualityHub.bat.') from error
        return {'started': True}
