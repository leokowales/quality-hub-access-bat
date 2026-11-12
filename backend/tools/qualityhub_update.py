"""Atualização local por avanço direto, sem reset/stash nem substituição de dados."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / 'backend') not in sys.path:
    sys.path.insert(0, str(ROOT / 'backend'))

from app.core.database import criar_backup_banco
from tools import qualityhub_local as local


class UpdateError(Exception):
    pass


def protected(path: str) -> bool:
    parts = PurePosixPath(path.replace('\\', '/').casefold()).parts
    if not parts:
        return False
    return (parts[0] in ('.venv', 'node_modules', 'logs') or
            parts[:2] in (('backend', 'data'), ('backend', 'private')) or
            any(p == '.env' or (p.startswith('.env.') and p != '.env.example') for p in parts))


def digest(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def write_json(path: Path, value):
    temporary = path.with_name(path.name + '-' + uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


class Updater:
    def __init__(self, root: Path = ROOT, python: Path | None = None):
        self.root = root.resolve()
        self.python = python or self.root / '.venv/Scripts/python.exe'
        self.git = shutil.which('git.exe' if os.name == 'nt' else 'git')
        self.logs = self.root / 'logs/local'
        self.snapshot = None
        self.retry = False

    def journal(self):
        path = self.logs / 'update-state.json'
        if not path.exists():
            return {}
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, OSError) as error:
            raise UpdateError('O registro da atualização anterior está inválido. Consulte logs/local antes de continuar.') from error

    def command(self, args, label, *, capture=False, timeout=180):
        self.logs.mkdir(parents=True, exist_ok=True)
        environment = {**os.environ, 'PYTHONUTF8': '1', 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never',
                       'PYTHONPATH': os.pathsep.join(filter(None, (str(self.root / 'backend'), os.environ.get('PYTHONPATH'))))}
        try:
            result = subprocess.run([str(arg) for arg in args], cwd=self.root, env=environment,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                    encoding='utf-8', errors='replace', timeout=timeout,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise UpdateError(f'{label}: não foi possível concluir. Consulte logs/local/update.log.') from error
        # Nunca registrar variáveis de ambiente nem credenciais embutidas em URLs.
        if not capture or result.returncode:
            output = re.sub(r'(https?://)[^\s/@]+@', r'\1[oculto]@', result.stdout + result.stderr)
            with (self.logs / 'update.log').open('a', encoding='utf-8') as log:
                log.write(f'\n--- {label}: código {result.returncode} ---\n{output}')
        if result.returncode:
            raise UpdateError(f'{label} falhou. Nenhum dado local deve ser apagado; consulte logs/local/update.log. Verifique também a conexão e o acesso ao GitHub, se for uma operação Git.')
        return result.stdout.strip()

    def git_command(self, *args):
        return self.command([self.git, *args], 'Git ' + args[0], capture=True)

    def preflight(self):
        if not self.git:
            raise UpdateError('Git não encontrado. Instale/configure o Git conforme o README antes de atualizar.')
        if not self.python.is_file():
            raise UpdateError('Ambiente .venv não encontrado. Confira a preparação inicial do README.')
        top = self.git_command('rev-parse', '--show-toplevel')
        if os.path.normcase(str(Path(top).resolve())) != os.path.normcase(str(self.root)):
            raise UpdateError('Execute o atualizador dentro da instalação clonada do QualityHub.')
        if self.git_command('status', '--porcelain', '--untracked-files=normal'):
            raise UpdateError('Há alterações locais ou arquivos novos não publicados nesta pasta. O atualizador não irá sobrescrevê-los. Preserve/publique as alterações antes de atualizar; não é necessário apagar o banco.')
        branch = self.git_command('symbolic-ref', '--quiet', '--short', 'HEAD')
        remote = self.git_command('config', '--get', f'branch.{branch}.remote')
        if not remote or remote == '.':
            raise UpdateError('A branch atual precisa acompanhar uma branch remota configurada.')
        self.git_command('rev-parse', '--verify', '@{upstream}')
        print('Consultando a versão publicada...', flush=True)
        self.git_command('fetch', '--prune', remote)
        before = self.git_command('rev-parse', 'HEAD')
        target = self.git_command('rev-parse', '@{upstream}')
        if before == target:
            pending = self.journal()
            if pending.get('target') == target and pending.get('status') in ('pending', 'failed'):
                self.retry = True
            else:
                return None
        # Falha também quando existem commits locais: não mesclar nem descartar.
        result = subprocess.run([self.git, 'merge-base', '--is-ancestor', before, target], cwd=self.root,
                                capture_output=True, timeout=30,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise UpdateError('A versão local tem commits próprios ou divergiu da publicada. A atualização automática foi interrompida sem mesclar nem descartar commits.')
        files = self.git_command('diff', '--name-only', '-z', '--no-renames', before, target).split('\0')
        if any(protected(path) for path in files):
            raise UpdateError('A versão publicada tenta modificar dados locais, ambiente ou arquivos privados. Atualização bloqueada para preservar a instalação.')
        for name in ('node', 'npm.cmd' if os.name == 'nt' else 'npm'):
            if not shutil.which(name):
                raise UpdateError('Node.js/npm não encontrados. Confira a preparação inicial do README.')
        return before, target

    def database_path(self):
        value = self.command([self.python, '-c',
            'import json;from app.core.database import DATABASE_PATH;print(json.dumps(str(DATABASE_PATH.resolve())))'],
            'Localizar banco', capture=True)
        return Path(json.loads(value))

    def ports(self, state):
        # Não exigir dependências da interface antes de poder repará-las.
        from dotenv import dotenv_values
        environment = {}
        for name in ('.env', '.env.local', '.env.development', '.env.development.local'):
            environment.update(dotenv_values(self.root / name))
        source = (self.root / 'src/services/api.ts').read_text(encoding='utf-8')
        match = re.search(r"\?\?\s*['\"](http://[^'\"]+)['\"]", source)
        url = os.environ.get('VITE_API_URL') or environment.get('VITE_API_URL') or (match[1] if match else None)
        try:
            parsed = urlsplit(url or '')
            if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or not parsed.port:
                raise ValueError()
            ports = {parsed.port, 5173}
            for previous in (state.get('api'), state.get('frontend')):
                if previous and urlsplit(previous).hostname in ('localhost', '127.0.0.1'):
                    ports.add(urlsplit(previous).port)
            return ports - {None}
        except ValueError as error:
            raise UpdateError('Não foi possível confirmar a porta local da API. Confira VITE_API_URL antes de atualizar.') from error

    def make_snapshot(self, before: str, target: str):
        active = self.database_path()
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        folder = active.parent / 'backups' / f'update-{stamp}-{uuid4().hex[:8]}'
        folder.mkdir(parents=True, exist_ok=False)
        self.snapshot = folder
        files = set()
        data = self.root / 'backend/data'
        if data.exists():
            files.update(p.resolve() for p in data.rglob('*.db') if 'backups' not in p.relative_to(data).parts)
        if active.parent != data and active.parent.exists():
            files.update(p.resolve() for p in active.parent.rglob('*.db') if 'backups' not in p.relative_to(active.parent).parts)
        if active.is_file():
            files.add(active.resolve())
        manifest = {'version': 1, 'created': datetime.now(timezone.utc).isoformat(),
                    'before': before, 'target': target, 'status': 'backing_up', 'databases': []}
        for number, database in enumerate(sorted(files)):
            backup = folder / f'database-{number + 1}.db'
            criar_backup_banco(database, backup)
            manifest['databases'].append({'original': str(database), 'backup': backup.name, 'sha256': digest(backup)})
        manifest['status'] = 'ready'
        write_json(folder / 'manifest.json', manifest)
        return manifest

    def finish(self, old_hashes):
        requirements = self.root / 'backend/requirements.txt'
        if digest(requirements) != old_hashes['requirements']:
            print('Atualizando dependências Python...', flush=True)
            self.command([self.python, '-m', 'pip', 'install', '-r', requirements], 'Dependências Python', timeout=1200)
        self.command([self.python, '-m', 'pip', 'check'], 'Verificar dependências Python')
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if (digest(self.root / 'package-lock.json') != old_hashes['lock'] or
                digest(self.root / 'package.json') != old_hashes['package'] or
                not (self.root / 'node_modules/vite/bin/vite.js').is_file()):
            print('Atualizando dependências da interface...', flush=True)
            self.command([npm, 'ci'], 'Dependências da interface', timeout=1200)
        print('Validando a interface...', flush=True)
        self.command([npm, 'run', 'build'], 'Build da interface', timeout=300)
        print('Atualizando o banco e conferindo a integridade...', flush=True)
        # Novo processo importa o código recém-baixado, não o módulo antigo em memória.
        self.command([self.python, '-c', 'from app.core.database import inicializar_banco;inicializar_banco()'],
                     'Migração do banco', timeout=300)

    def apply(self, services=local):
        reopen = False
        with services.ControllerLock():
            version = self.preflight()
            if version is None:
                print('QualityHub já está na versão publicada. A sessão atual foi preservada.', flush=True)
                return False
            before, target = version
            state = services.read_state()
            native = services.Win32()
            reopen = services.recognized(native, state)
            ports = self.ports(state)
            if reopen:
                print('Fechando o QualityHub para atualizar...', flush=True)
                services.stop_managed(native)
            if not all(services.port_free(port) for port in ports):
                raise UpdateError('Há serviços manuais ou externos ativos. Encerre-os antes de atualizar; nenhum processo externo foi encerrado.')
            print('Criando e validando a cópia de segurança...', flush=True)
            manifest = self.make_snapshot(before, target)
            print(f'Cópia de segurança: {self.snapshot}', flush=True)
            hashes = {'requirements': digest(self.root / 'backend/requirements.txt'),
                      'lock': digest(self.root / 'package-lock.json'), 'package': digest(self.root / 'package.json')}
            if self.retry:
                hashes = dict.fromkeys(hashes)
            pending = {'before': before, 'target': target, 'snapshot': str(self.snapshot), 'status': 'pending'}
            self.logs.mkdir(parents=True, exist_ok=True)
            journal_path = self.logs / 'update-state.json'
            write_json(journal_path, pending)
            try:
                if self.git_command('rev-parse', 'HEAD') != before or self.git_command('status', '--porcelain', '--untracked-files=normal'):
                    raise UpdateError('A pasta mudou durante a preparação; atualização interrompida.')
                print('Baixando/aplicando a atualização...', flush=True)
                # Fetch remoto já validado. Pull do SHA local fixa exatamente esse alvo,
                # evitando baixar outro commit entre a checagem e a aplicação.
                self.git_command('pull', '--ff-only', '--no-rebase', '--no-autostash', '.', target)
                self.finish(hashes)
                manifest['status'] = 'completed'
                pending['status'] = 'completed'
            except Exception:
                manifest['status'] = 'failed'
                pending['status'] = 'failed'
                raise
            finally:
                write_json(self.snapshot / 'manifest.json', manifest)
                write_json(journal_path, pending)
        print('QualityHub atualizado. Dados locais e autorização preservados.', flush=True)
        if reopen:
            print('Reabrindo o QualityHub...', flush=True)
            services.start()
        else:
            print('Para abrir, use QualityHub.bat.', flush=True)
        return True


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    updater = Updater()
    try:
        updater.logs.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(filename=updater.logs / 'update.log', encoding='utf-8', level=logging.INFO,
                            format='%(asctime)s %(levelname)s %(message)s')
        updater.apply()
        return 0
    except Exception as error:
        logging.exception('Atualização interrompida')
        print(f'ATUALIZAÇÃO INTERROMPIDA: {error}', flush=True)
        if updater.snapshot:
            print(f'Arquivos desta tentativa de atualização: {updater.snapshot}', flush=True)
        print('Não apague o banco nem tente um git reset. Consulte o README e logs/local/update.log.', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
