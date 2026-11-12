"""Windows local launcher. Standard library only; never manages services by port/PID alone."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes as w
from dataclasses import dataclass
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import build_opener, ProxyHandler
import uuid

ROOT = Path(__file__).resolve().parents[2]
WEB_HOMOLOGATION = os.getenv('QUALITYHUB_WEB_HOMOLOGATION') == '1'
RUNTIME = ROOT / 'logs' / ('web-homologation' if WEB_HOMOLOGATION else 'local')
SCRIPT = Path(__file__).resolve()
HTTP = build_opener(ProxyHandler({}))  # Loopback checks must not use corporate proxies.
TIMEOUT = 60


class LauncherError(Exception):
    pass


def canonical(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def root_id(root: Path) -> str:
    identity = canonical(root) + ('|web-homologation' if WEB_HOMOLOGATION else '')
    return hashlib.sha256(identity.encode()).hexdigest()[:16]


def event_names(root: Path, token: str) -> tuple[str, str, str]:
    if not re.fullmatch(r'[a-f0-9]{32}', token):
        raise LauncherError('Registro de execução inválido; nenhum processo foi alterado.')
    prefix = f'Local\\QualityHub-{root_id(root)}-{token}'
    return prefix + '-job', prefix + '-stop', prefix + '-open'


def read_state(runtime: Path = RUNTIME) -> dict:
    try:
        value = json.loads((runtime / 'state.json').read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state: dict, runtime: Path = RUNTIME):
    runtime.mkdir(parents=True, exist_ok=True)
    temporary = runtime / f'state-{uuid.uuid4().hex}.tmp'
    temporary.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
    temporary.replace(runtime / 'state.json')


class ControllerLock:
    def __enter__(self):
        import msvcrt
        RUNTIME.mkdir(parents=True, exist_ok=True)
        self.file = (RUNTIME / 'controller.lock').open('a+b')
        if not self.file.seek(0, os.SEEK_END):
            self.file.write(b'0')
            self.file.flush()
        limit = time.monotonic() + 90
        while True:
            try:
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
                return self
            except OSError:
                if time.monotonic() >= limit:
                    self.file.close()
                    raise LauncherError('Outra operação do inicializador está em andamento. Aguarde e tente novamente.')
                time.sleep(.15)

    def __exit__(self, *_):
        import msvcrt
        self.file.seek(0)
        msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
        self.file.close()


class Win32:
    """A private Job Object contains only the processes created by this supervisor."""
    def __init__(self):
        if os.name != 'nt':
            raise LauncherError('Este inicializador é exclusivo para Windows.')
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.u = ctypes.WinDLL('user32', use_last_error=True)
        signatures = {
            'CreateJobObjectW': ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
            'OpenJobObjectW': ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
            'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
            'QueryInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
            'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
            'IsProcessInJob': ([w.HANDLE, w.HANDLE, ctypes.POINTER(w.BOOL)], w.BOOL),
            'TerminateJobObject': ([w.HANDLE, w.UINT], w.BOOL),
            'CreateEventW': ([ctypes.c_void_p, w.BOOL, w.BOOL, w.LPCWSTR], w.HANDLE),
            'OpenEventW': ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
            'SetEvent': ([w.HANDLE], w.BOOL),
            'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD),
            'CloseHandle': ([w.HANDLE], w.BOOL),
            'OpenProcess': ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            'GetProcessTimes': ([w.HANDLE] + [ctypes.POINTER(w.FILETIME)] * 4, w.BOOL),
            'ResumeThread': ([w.HANDLE], w.DWORD),
            'TerminateProcess': ([w.HANDLE, w.UINT], w.BOOL),
            'AttachConsole': ([w.DWORD], w.BOOL),
            'FreeConsole': ([], w.BOOL),
            'GenerateConsoleCtrlEvent': ([w.DWORD, w.DWORD], w.BOOL),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.k, name)
            function.argtypes, function.restype = args, result
        self.u.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
        self.u.GetWindowThreadProcessId.restype = w.DWORD
        self.u.IsWindowVisible.argtypes = [w.HWND]
        self.u.IsWindowVisible.restype = w.BOOL
        self.u.IsWindow.argtypes = [w.HWND]
        self.u.IsWindow.restype = w.BOOL
        self.u.PostMessageW.argtypes = [w.HWND, w.UINT, ctypes.c_size_t, ctypes.c_ssize_t]
        self.u.PostMessageW.restype = w.BOOL
        self.u.LoadImageW.argtypes = [w.HINSTANCE, w.LPCWSTR, w.UINT, ctypes.c_int, ctypes.c_int, w.UINT]
        self.u.LoadImageW.restype = w.HANDLE
        self.u.DestroyIcon.argtypes = [w.HANDLE]
        self.u.DestroyIcon.restype = w.BOOL
        self.u.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, ctypes.c_size_t, ctypes.c_ssize_t,
                                              w.UINT, w.UINT, ctypes.POINTER(ctypes.c_size_t)]
        self.u.SendMessageTimeoutW.restype = ctypes.c_ssize_t

    def checked(self, value):
        if not value:
            raise ctypes.WinError(ctypes.get_last_error())
        return value

    def close(self, handle):
        if handle:
            self.k.CloseHandle(handle)

    def creation(self, pid: int) -> int | None:
        handle = self.k.OpenProcess(0x1000 | 0x100000, False, pid)
        if not handle:
            return None
        try:
            if self.k.WaitForSingleObject(handle, 0) != 258:
                return None
            values = [w.FILETIME() for _ in range(4)]
            if not self.k.GetProcessTimes(handle, *[ctypes.byref(item) for item in values]):
                return None
            return values[0].dwHighDateTime << 32 | values[0].dwLowDateTime
        finally:
            self.close(handle)

    def create_job(self, name: str):
        class Basic(ctypes.Structure):
            _fields_ = [('user', ctypes.c_int64), ('job_user', ctypes.c_int64), ('flags', w.DWORD),
                        ('min_work', ctypes.c_size_t), ('max_work', ctypes.c_size_t), ('active', w.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class Limits(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', ctypes.c_uint64 * 6), ('process_memory', ctypes.c_size_t),
                        ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
        handle = self.checked(self.k.CreateJobObjectW(None, name))
        limits = Limits()
        # Only a child explicitly requesting CREATE_BREAKAWAY_FROM_JOB may escape
        # (the updater). Ordinary API/frontend/browser children remain managed.
        limits.basic.flags = 0x2000 | 0x0800  # KILL_ON_JOB_CLOSE | BREAKAWAY_OK
        try:
            self.checked(self.k.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        except Exception:
            self.close(handle)
            raise
        return handle

    def active(self, job) -> int:
        class Accounting(ctypes.Structure):
            _fields_ = [('times', ctypes.c_int64 * 4), ('faults', w.DWORD), ('total', w.DWORD),
                        ('active', w.DWORD), ('terminated', w.DWORD)]
        info = Accounting()
        self.checked(self.k.QueryInformationJobObject(job, 1, ctypes.byref(info), ctypes.sizeof(info), None))
        return info.active

    def spawn(self, command: list[str], cwd: Path, job, logfile: Path, console=True):
        import msvcrt
        class Startup(ctypes.Structure):
            _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR), ('title', w.LPWSTR),
                        ('x', w.DWORD), ('y', w.DWORD), ('xsize', w.DWORD), ('ysize', w.DWORD),
                        ('xchars', w.DWORD), ('ychars', w.DWORD), ('fill', w.DWORD), ('flags', w.DWORD),
                        ('show', w.WORD), ('reserved_size', w.WORD), ('reserved_data', ctypes.c_void_p),
                        ('stdin', w.HANDLE), ('stdout', w.HANDLE), ('stderr', w.HANDLE)]
        class ProcessInfo(ctypes.Structure):
            _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE), ('pid', w.DWORD), ('tid', w.DWORD)]
        self.k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL,
                                         w.DWORD, ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(Startup), ctypes.POINTER(ProcessInfo)]
        self.k.CreateProcessW.restype = w.BOOL
        info, startup = ProcessInfo(), Startup()
        startup.cb, startup.flags, startup.show = ctypes.sizeof(startup), 0x101, 0 if console else 1
        with logfile.open('ab', buffering=0) as output, open(os.devnull, 'rb') as null:
            handles = [msvcrt.get_osfhandle(file.fileno()) for file in (null, output)]
            for handle in handles:
                os.set_handle_inheritable(handle, True)
            startup.stdin, startup.stdout, startup.stderr = handles[0], handles[1], handles[1]
            try:
                # Suspended creation prevents a child from escaping before assignment to our Job.
                self.checked(self.k.CreateProcessW(command[0], ctypes.create_unicode_buffer(subprocess.list2cmdline(command)),
                    None, None, True, 4 | (0x10 if console else 0), None, str(cwd), ctypes.byref(startup), ctypes.byref(info)))
                try:
                    self.checked(self.k.AssignProcessToJobObject(job, info.process))
                    if self.k.ResumeThread(info.thread) == 0xFFFFFFFF:
                        raise ctypes.WinError(ctypes.get_last_error())
                except Exception:
                    self.k.TerminateProcess(info.process, 1)  # Only the suspended process just created here.
                    self.close(info.process)
                    raise
                finally:
                    self.close(info.thread)
            finally:
                for handle in handles:
                    os.set_handle_inheritable(handle, False)
        return Managed(info.pid, info.process, console)

    def windows(self, job):
        found = []
        callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, ctypes.c_ssize_t)
        def callback(window, _):
            pid = w.DWORD()
            self.u.GetWindowThreadProcessId(window, ctypes.byref(pid))
            process = self.k.OpenProcess(0x1000, False, pid.value)
            if process:
                try:
                    belongs = w.BOOL()
                    if self.k.IsProcessInJob(process, job, ctypes.byref(belongs)) and belongs.value and self.u.IsWindowVisible(window):
                        found.append(window)
                finally:
                    self.close(process)
            return True
        self.u.EnumWindows.argtypes = [callback_type, ctypes.c_ssize_t]
        self.u.EnumWindows.restype = w.BOOL
        self.u.EnumWindows(callback_type(callback), 0)
        return found

    def interrupt(self, pid: int):
        # Each service has its own hidden console. No signal reaches the user's terminals.
        if not self.k.AttachConsole(pid):
            return
        callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.DWORD)
        ignore = callback_type(lambda _: True)
        self.k.SetConsoleCtrlHandler.argtypes = [callback_type, w.BOOL]
        self.k.SetConsoleCtrlHandler.restype = w.BOOL
        try:
            self.k.SetConsoleCtrlHandler(ignore, True)
            self.k.GenerateConsoleCtrlEvent(1, 0)  # CTRL_BREAK: uvicorn handles SIGBREAK.
            time.sleep(.05)
        finally:
            self.k.FreeConsole()

    def set_window_icon(self, window, path: Path):
        """Keep icon handles alive for the lifetime of our owned app window."""
        icons = []
        if not path.is_file():
            return icons
        for kind, size in ((0, 16), (1, 32)):
            icon = self.u.LoadImageW(None, str(path), 1, size, size, 0x10)
            if not icon:
                logging.warning('Não foi possível carregar o ícone QH de %spx.', size)
                continue
            result = ctypes.c_size_t()
            if not self.u.SendMessageTimeoutW(window, 0x80, kind, icon, 2, 1000, ctypes.byref(result)):
                self.u.DestroyIcon(icon)
                logging.warning('Não foi possível aplicar o ícone QH à janela.')
                continue
            icons.append(icon)
        return icons


@dataclass
class Managed:
    pid: int
    handle: int
    console: bool

    def alive(self, native: Win32) -> bool:
        return native.k.WaitForSingleObject(self.handle, 0) == 258


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        if os.name == 'nt':
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def ready(url: str, backend=False) -> bool:
    try:
        with HTTP.open(url + ('/health' if backend else '/'), timeout=1) as response:
            body = response.read(128_000).decode('utf-8')
            if backend:
                data = json.loads(body)
                return response.status == 200 and isinstance(data, dict) and data.get('status') == 'ok' and data.get('service') == 'quality-hub-api'
            return response.status == 200 and '/src/main.tsx' in body and bool(re.search(r'<title>\s*Quality-?Hub\s*</title>', body, re.I))
    except (OSError, ValueError):
        return False


def find_chrome() -> Path:
    import winreg
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, r'Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 0, winreg.KEY_READ | view) as key:
                    path = Path(winreg.QueryValueEx(key, None)[0].strip('"'))
                    if path.is_file():
                        return path
            except OSError:
                pass
    for variable in ('LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)'):
        folder = os.environ.get(variable)
        if folder:
            path = Path(folder) / 'Google/Chrome/Application/chrome.exe'
            if path.is_file():
                return path
    raise LauncherError('Google Chrome não encontrado. Instale o Chrome e execute o inicializador novamente.')


@dataclass
class Config:
    root: Path
    python: Path
    node: Path
    chrome: Path
    api_port: int
    frontend_port: int = 5173

    @property
    def api(self):
        return f'http://127.0.0.1:{self.api_port}'

    @property
    def frontend(self):
        return f'http://127.0.0.1:{self.frontend_port}'

    @property
    def backend_command(self):
        command = [str(self.python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(self.api_port)]
        if WEB_HOMOLOGATION:
            command += ['--reload', '--reload-dir', str(self.root / 'backend/app')]
        return command

    @property
    def frontend_command(self):
        command = [str(self.node), str(self.root / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(self.frontend_port), '--strictPort']
        if WEB_HOMOLOGATION:
            command += ['--config', 'vite.homologation.config.ts']
        return command

    @property
    def chrome_command(self):
        local = os.environ.get('LOCALAPPDATA')
        if not local:
            raise LauncherError('Não foi possível localizar a pasta de dados locais do Windows.')
        profile = Path(local) / 'QualityHub/Chrome' / root_id(self.root)
        return [str(self.chrome), f'--app={self.frontend}', f'--user-data-dir={profile}',
                '--no-first-run', '--no-default-browser-check', '--disable-background-mode']


def configure() -> Config:
    if os.name != 'nt':
        raise LauncherError('Use os arquivos .bat em um computador Windows.')
    expected = ROOT / '.venv/Scripts/python.exe'
    if not expected.is_file() or canonical(Path(sys.prefix)) != canonical(ROOT / '.venv'):
        raise LauncherError('Ambiente Python inválido. Crie .venv na raiz conforme a preparação inicial do README.md.')
    missing = []
    for line in (ROOT / 'backend/requirements.txt').read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name = re.split(r'[=<>!~\[]', line.strip())[0]
        try:
            importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            missing.append(name)
    if missing:
        raise LauncherError('Dependências Python ausentes: ' + ', '.join(missing) + '. Execute .venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt na raiz.')
    node, npm = shutil.which('node.exe'), shutil.which('npm.cmd')
    if not node or not npm:
        raise LauncherError('Node.js/npm não encontrados. Instale o Node.js conforme o README.md e abra o inicializador novamente.')
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    if package.get('scripts', {}).get('dev') != 'vite':
        raise LauncherError('O comando dev do projeto mudou. Revise o inicializador antes de continuar.')
    if not (ROOT / 'node_modules/vite/bin/vite.js').is_file():
        raise LauncherError('Dependências frontend ausentes. Execute npm.cmd ci na raiz do projeto.')
    # Vite resolves its own environment precedence; no .env is written or logged.
    javascript = """const v=process.versions.node.split('.').map(Number);if(!(v[0]===20&&v[1]>=19||v[0]===22&&v[1]>=12||v[0]>22))throw Error('Node incompativel');
await Promise.all(['vite','react','react-dom','lucide-react','@vitejs/plugin-react'].map(p=>import(p)));
const {loadEnv}=await import('vite');console.log(JSON.stringify({api:process.env.VITE_API_URL??loadEnv('development',process.cwd(),'VITE_').VITE_API_URL??null}));"""
    result = subprocess.run([node, '--input-type=module', '-e', javascript], cwd=ROOT, capture_output=True, text=True,
                            encoding='utf-8', timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise LauncherError('Node ou dependências frontend incompatíveis. Use Node 20.19+, 22.12+ ou 24 e execute npm.cmd ci. Consulte o README.md.')
    api = json.loads(result.stdout.strip().splitlines()[-1])['api']
    if api is None:
        source = (ROOT / 'src/services/api.ts').read_text(encoding='utf-8')
        match = re.search(r"\?\?\s*['\"](http://[^'\"]+)['\"]", source)
        if not match:
            raise LauncherError('O endereço padrão da API mudou; revise o inicializador.')
        api = match[1]
    try:
        parsed = urlsplit(api)
        port = parsed.port
        if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or not port or port == 5173:
            raise ValueError()
    except ValueError:
        raise LauncherError('VITE_API_URL deve apontar para uma API HTTP local com porta explícita, diferente de 5173. Nenhuma configuração foi alterada.')
    return Config(ROOT, expected, Path(node), find_chrome(), port, 5174 if WEB_HOMOLOGATION else 5173)


def recognized(native: Win32, state: dict) -> bool:
    if state.get('root') != canonical(ROOT) or state.get('version') != 1 or not isinstance(state.get('pid'), int):
        return False
    if not isinstance(state.get('created'), int) or native.creation(state['pid']) != state['created']:
        return False  # Stale/reused PID is never treated as ownership.
    try:
        job_name, stop_name, _ = event_names(ROOT, state.get('token', ''))
    except (LauncherError, TypeError):
        return False
    job = native.k.OpenJobObjectW(4, False, job_name)
    event = native.k.OpenEventW(2, False, stop_name)
    valid = bool(job and event)
    native.close(job)
    native.close(event)
    return valid


def wait_running(token: str, child=None) -> dict:
    limit = time.monotonic() + TIMEOUT + 30
    while time.monotonic() < limit:
        state = read_state()
        if state.get('token') == token:
            if state.get('status') == 'running':
                return state
            if state.get('status') in ('error', 'stopped'):
                raise LauncherError(state.get('error') or 'A inicialização foi interrompida. Consulte os logs.')
        if child and child.poll() is not None:
            raise LauncherError('O gerenciador encerrou antes de concluir. Consulte logs\\local\\supervisor.log.')
        time.sleep(.15)
    raise LauncherError('O ambiente não iniciou dentro do prazo. Os serviços gerenciados serão encerrados; consulte logs\\local.')


def signal_event(native: Win32, name: str):
    handle = native.checked(native.k.OpenEventW(2, False, name))
    try:
        native.checked(native.k.SetEvent(handle))
    finally:
        native.close(handle)


def start():
    config, native = configure(), Win32()
    with ControllerLock():
        state = read_state()
        if recognized(native, state) and (state.get('status') == 'stopping' or
                (state.get('window') and not native.u.IsWindow(state['window']))):
            print('Finalizando a sessão anterior antes de abrir novamente...')
            limit = time.monotonic() + 25
            while recognized(native, state):
                if time.monotonic() >= limit:
                    raise LauncherError('A sessão anterior ainda está encerrando. Aguarde e tente novamente; consulte logs\\local se persistir.')
                time.sleep(.15)
            state = read_state()
        if recognized(native, state):
            if state.get('status') == 'starting':
                state = wait_running(state['token'])
            if state.get('status') != 'running':
                raise LauncherError('O ambiente gerenciado está encerrando. Aguarde e tente novamente.')
            if state.get('api') != config.api or state.get('frontend') != config.frontend:
                raise LauncherError('A configuração mudou. Feche a janela do QualityHub e inicie novamente.')
            if not ready(config.api, True) or not ready(config.frontend):
                raise LauncherError('Os serviços gerenciados não estão disponíveis. Feche a janela do QualityHub antes de tentar novamente.')
            _, _, open_name = event_names(ROOT, state['token'])
            sequence = state.get('open_sequence', 0)
            signal_event(native, open_name)
            limit = time.monotonic() + 20
            while time.monotonic() < limit:
                latest = read_state()
                if latest.get('token') == state['token'] and latest.get('open_sequence', 0) > sequence:
                    if latest.get('browser_error'):
                        raise LauncherError(latest['browser_error'])
                    print('QualityHub já está aberto. A janela e os serviços existentes foram preservados.')
                    return
                time.sleep(.15)
            raise LauncherError('Não foi possível confirmar a janela do Chrome. Consulte os logs.')
        occupied = [port for port in (config.api_port, config.frontend_port) if not port_free(port)]
        if occupied:
            raise LauncherError('Porta(s) ' + ', '.join(map(str, occupied)) + ' ocupada(s) por serviços não gerenciados. Encerre os serviços manuais primeiro. Nenhum processo foi encerrado.')
        token = uuid.uuid4().hex
        with (RUNTIME / 'supervisor.log').open('ab') as output:
            child = subprocess.Popen([str(config.python), str(SCRIPT), '--supervise', token], cwd=ROOT,
                stdin=subprocess.DEVNULL, stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
        print('Iniciando QualityHub. Aguardando API, interface e Chrome...')
        try:
            wait_running(token, child)
        except Exception:
            latest = read_state()
            if latest.get('token') == token and recognized(native, latest):
                signal_event(native, event_names(ROOT, token)[1])
            raise
        print(f'QualityHub iniciado: {config.frontend}')


def stop():
    native = Win32()
    with ControllerLock():
        stop_managed(native)


def stop_managed(native: Win32):
    state = read_state()
    if not recognized(native, state):
        print('Nenhum processo gerenciado ativo. Serviços manuais e outros aplicativos foram preservados.')
        return
    _, stop_name, _ = event_names(ROOT, state['token'])
    signal_event(native, stop_name)
    print('Encerrando somente os processos gerenciados pelo QualityHub...')
    limit = time.monotonic() + 25
    while time.monotonic() < limit:
        latest = read_state()
        if latest.get('token') == state['token'] and latest.get('status') == 'stopped':
            print('QualityHub encerrado. Os serviços gerenciados foram finalizados.')
            return
        if not recognized(native, state):
            # The Job's kill-on-close also covers an unexpected supervisor exit.
            print('O gerenciador terminou. Nenhum serviço externo foi alterado.')
            return
        time.sleep(.15)
    raise LauncherError('O encerramento não foi confirmado. Consulte logs\\local; nenhum processo externo será encerrado à força.')


def supervise(token: str):
    native = Win32()
    job_name, stop_name, open_name = event_names(ROOT, token)
    job = native.create_job(job_name)
    stop_handle = native.checked(native.k.CreateEventW(None, True, False, stop_name))
    open_handle = native.checked(native.k.CreateEventW(None, False, False, open_name))
    processes: list[Managed] = []
    window_icons = []
    state = {'version': 1, 'root': canonical(ROOT), 'token': token, 'pid': os.getpid(),
             'created': native.creation(os.getpid()), 'status': 'starting', 'open_sequence': 0}
    write_state(state)
    error = None
    try:
        config = configure()
        state.update(api=config.api, frontend=config.frontend)
        for port in (config.api_port, config.frontend_port):
            if not port_free(port):
                raise LauncherError(f'A porta {port} foi ocupada durante a inicialização. O serviço externo foi preservado.')
        processes.append(native.spawn(config.backend_command, ROOT / 'backend', job, RUNTIME / 'backend.log'))
        processes.append(native.spawn(config.frontend_command, ROOT, job, RUNTIME / 'frontend.log'))
        state['services'] = [item.pid for item in processes]
        write_state(state)
        limit = time.monotonic() + TIMEOUT
        while not (ready(config.api, True) and ready(config.frontend)):
            if native.k.WaitForSingleObject(stop_handle, 0) == 0:
                raise LauncherError('Inicialização interrompida; os processos gerenciados foram encerrados.')
            if not all(item.alive(native) for item in processes):
                raise LauncherError('Backend ou frontend encerrou na inicialização. Consulte backend.log e frontend.log em logs\\local.')
            if time.monotonic() >= limit:
                raise LauncherError('Backend ou frontend não ficou disponível em 60 segundos. Consulte logs\\local.')
            time.sleep(.2)

        def browser():
            windows = native.windows(job)
            if windows:
                return windows[0]  # Track the app window, not Chrome background processes.
            processes.append(native.spawn(config.chrome_command, ROOT, job, RUNTIME / 'chrome.log', console=False))
            limit = time.monotonic() + 15
            while True:
                windows = native.windows(job)
                if windows:
                    return windows[0]
                if native.k.WaitForSingleObject(stop_handle, 0) == 0:
                    raise LauncherError('Abertura do Chrome interrompida.')
                if not processes[-1].alive(native) or time.monotonic() >= limit:
                    raise LauncherError('O Chrome não abriu a janela do QualityHub. Consulte logs\\local\\chrome.log.')
                time.sleep(.2)

        app_window = browser()
        window_icons = native.set_window_icon(app_window, ROOT / 'public/qualityhub.ico')
        state.update(status='running', open_sequence=1, close_behavior='stop', window=app_window)
        write_state(state)
        logging.info('Ambiente disponível; serviços gerenciados: %s', state['services'])
        while native.k.WaitForSingleObject(stop_handle, 300) != 0:
            if not native.u.IsWindow(app_window):
                logging.info('Janela do QualityHub fechada; encerrando os serviços gerenciados.')
                break
            if not all(item.alive(native) for item in processes[:2]):
                raise LauncherError('Um serviço gerenciado encerrou inesperadamente. O ambiente foi fechado; consulte os logs e inicie novamente.')
            if native.k.WaitForSingleObject(open_handle, 0) == 0:
                state['open_sequence'] += 1
                write_state(state)
    except Exception as failure:
        error = str(failure)
        logging.exception('Falha no ambiente gerenciado')
    finally:
        state['status'] = 'stopping'
        write_state(state)
        try:
            for window in native.windows(job):
                native.u.PostMessageW(window, 0x10, 0, 0)  # WM_CLOSE, only owned windows.
            for item in reversed(processes[:2]):
                if item.console and item.alive(native):
                    native.interrupt(item.pid)
            limit = time.monotonic() + 8
            while native.active(job) and time.monotonic() < limit:
                time.sleep(.1)
            if native.active(job):
                logging.warning('Prazo de encerramento excedido; finalizando somente o Job privado do QualityHub.')
                native.checked(native.k.TerminateJobObject(job, 0))
            limit = time.monotonic() + 3
            while native.active(job) and time.monotonic() < limit:
                time.sleep(.1)
            if native.active(job):
                error = error or 'Não foi possível confirmar a finalização de todos os processos gerenciados.'
        except Exception:
            logging.exception('Falha ao finalizar o Job privado')
            native.k.TerminateJobObject(job, 1)
            error = error or 'Erro no encerramento. Consulte os logs.'
        finally:
            for icon in window_icons:
                native.u.DestroyIcon(icon)
            for item in processes:
                native.close(item.handle)
            native.close(job)
            native.close(stop_handle)
            native.close(open_handle)
            state.update(status='error' if error else 'stopped', error=error)
            write_state(state)


def shortcuts():
    # Constant PowerShell code; the project path is passed as data, never interpolated as code.
    code = r"""$ErrorActionPreference='Stop';$s=New-Object -ComObject WScript.Shell;$d=[Environment]::GetFolderPath('Desktop');
$p=$s.CreateShortcut((Join-Path $d 'QualityHub.lnk'));$p.TargetPath=Join-Path $env:QUALITYHUB_SHORTCUT_ROOT 'QualityHub.bat';$p.WorkingDirectory=$env:QUALITYHUB_SHORTCUT_ROOT;$p.IconLocation=(Join-Path $env:QUALITYHUB_SHORTCUT_ROOT 'public\qualityhub.ico')+',0';$p.Description='QualityHub';$p.Save();
foreach($name in @('Iniciar QualityHub','Encerrar QualityHub')){$old=Join-Path $d ($name+'.lnk');if(Test-Path -LiteralPath $old){$previous=$s.CreateShortcut($old);if($previous.TargetPath -eq (Join-Path $env:QUALITYHUB_SHORTCUT_ROOT ($name+'.bat'))){Remove-Item -LiteralPath $old}}};Write-Output 'Atalho criado na area de trabalho.'"""
    shell = shutil.which('powershell.exe')
    if not shell:
        raise LauncherError('Windows PowerShell não encontrado para criar os atalhos.')
    result = subprocess.run([shell, '-NoProfile', '-NonInteractive', '-Command', code],
        env={**os.environ, 'QUALITYHUB_SHORTCUT_ROOT': str(ROOT)}, capture_output=True, timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise LauncherError('Não foi possível criar o atalho na área de trabalho. QualityHub.bat continua disponível na raiz.')
    print('Atalho QualityHub criado na área de trabalho com ícone QH. Fechar a janela encerra o aplicativo e os serviços.')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description='Inicia/encerra apenas o ambiente local gerenciado do QualityHub.')
    parser.add_argument('acao', nargs='?', choices=('iniciar', 'encerrar'))
    parser.add_argument('--atalhos', action='store_true')
    parser.add_argument('--supervise', help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(filename=RUNTIME / 'launcher.log', encoding='utf-8', level=logging.INFO,
                            format='%(asctime)s %(levelname)s %(message)s')
        if args.supervise:
            supervise(args.supervise)
        elif args.atalhos:
            shortcuts()
        elif args.acao == 'iniciar':
            start()
        elif args.acao == 'encerrar':
            stop()
        else:
            parser.error('Informe iniciar ou encerrar.')
        return 0
    except Exception as failure:
        logging.exception('Operação não concluída')
        message = str(failure) if isinstance(failure, LauncherError) else 'Não foi possível concluir a operação. Consulte os logs para diagnosticar.'
        print(f'ERRO: {message}\nLogs: {RUNTIME}', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
