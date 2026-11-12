"""Dados por usuário, independentes dos arquivos substituíveis do programa."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[2]
LEGACY_DATA = BACKEND / 'data'


def data_directory():
    override = os.getenv('QUALITYHUB_DATA_DIR')
    if override:
        return Path(override).expanduser().resolve()
    if os.name == 'nt':
        local = os.getenv('LOCALAPPDATA')
        if not local:
            raise RuntimeError('LOCALAPPDATA não definido; configure QUALITYHUB_DATA_DIR.')
        return Path(local) / 'QualityHub' / 'data'
    return Path.home() / '.local' / 'share' / 'QualityHub' / 'data'


def load_environment():
    from dotenv import load_dotenv
    load_dotenv(data_directory() / '.env')
    load_dotenv(BACKEND / '.env')


def _empty_destination(destination):
    if destination.is_symlink() or (destination / 'access/installation.bin').exists() or (destination / '.env').exists():
        raise RuntimeError('O destino tem ativação/configuração própria; recuperação manual necessária.')
    path = destination / 'qualityhub.db'
    if not path.is_file():
        raise RuntimeError('O destino existente não tem um banco reconhecido; nenhum arquivo foi substituído.')
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('O banco de destino não passou na verificação de integridade.')
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            if name in ('acesso_local', 'perfil_local', 'sqlite_sequence'):
                continue
            quoted = '"' + name.replace('"', '""') + '"'
            if db.execute('SELECT 1 FROM ' + quoted + ' LIMIT 1').fetchone():
                raise RuntimeError('O destino já contém dados de trabalho. Migração interrompida sem mesclar ou substituir bancos.')
    finally:
        db.close()


def prepare_data(*, allow_migration=False, adopt_empty=False):
    """Publica uma cópia completa; nunca mistura nem remove os dados antigos.

    Executar com os serviços anteriores fechados. Um destino parcial ou já
    existente é recusado, evitando abrir um banco vazio após uma falha.
    """
    # Caminhos explícitos de desenvolvimento continuam isolados.
    if os.getenv('QUALITYHUB_DATABASE_PATH'):
        return
    destination = data_directory()
    source = LEGACY_DATA
    if source.resolve() == destination.resolve():
        return
    marker = destination / 'storage-migration.json'
    if marker.exists():
        record = json.loads(marker.read_text(encoding='utf-8'))
        if record.get('version') != 1 or not isinstance(record.get('required_files'), list):
            raise RuntimeError('Registro de migração inválido. Preserve os dados e solicite recuperação.')
        for name in ('qualityhub.db', 'authorization.lic', 'access/installation.bin'):
            if name in record['required_files'] and not (destination / name).is_file():
                raise RuntimeError(f'Arquivo migrado ausente: {name}. Restaure a cópia antes de abrir o QH.')
        if record.get('source') != str(source.resolve()) and source.exists() and any(source.iterdir()):
            raise RuntimeError('Dados de outra instalação encontrados. Configure QUALITYHUB_DATA_DIR para isolar esta instalação.')
        return
    has_legacy = source.exists() and any(source.iterdir())
    if not has_legacy:
        return
    if not allow_migration:
        raise RuntimeError('Dados antigos encontrados. Feche o QH e os serviços antigos e execute, na pasta backend: ..\\.venv\\Scripts\\python.exe -m tools.migrate_storage. Os dados originais serão preservados.')
    backup = None
    if destination.exists() and adopt_empty:
        _empty_destination(destination)
        backup = destination.with_name(destination.name + '-before-migration-' + uuid4().hex)
    elif destination.exists():
        raise RuntimeError('Destino de dados já existe sem registro de migração. Preserve as duas pastas e solicite recuperação; nenhum dado foi substituído.')
    from app.core.database import criar_backup_banco
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = destination.with_name('data-migration-' + uuid4().hex)
    stage.mkdir()
    # A pasta temporária fica preservada em caso de erro para diagnóstico.
    for path in source.rglob('*'):
        if path.is_symlink():
            raise RuntimeError('Links na pasta antiga de dados impedem a migração segura.')
        relative = path.relative_to(source)
        target = stage / relative
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif not path.name.endswith(('-wal', '-shm', '-journal')):
            target.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix == '.db':
                criar_backup_banco(path, target)
            else:
                shutil.copy2(path, target)
    legacy_config = BACKEND / '.env'
    if legacy_config.is_file():
        shutil.copy2(legacy_config, stage / '.env')
    (stage / 'storage-migration.json').write_text(json.dumps({
        'version': 1, 'source': str(source.resolve()),
        'originals_preserved': True,
        'previous_destination': str(backup) if backup else None,
        'required_files': [name for name in ('qualityhub.db', 'authorization.lic', 'access/installation.bin')
                           if (stage / name).is_file()],
    }, indent=2), encoding='utf-8')
    # Windows recusa destino existente: duas partidas não sobrescrevem dados.
    if backup:
        _empty_destination(destination)
        # Validar os caminhos absolutos antes de mover uma árvore no Windows.
        parent = destination.parent.resolve()
        if (destination.is_symlink() or destination.resolve().parent != parent
                or backup.resolve().parent != parent or stage.resolve().parent != parent or backup.exists()):
            raise RuntimeError('Caminhos de recuperação inválidos; nenhuma pasta foi movida.')
        destination.rename(backup)
        try:
            stage.rename(destination)
        except Exception:
            backup.rename(destination)
            raise
    else:
        stage.rename(destination)
