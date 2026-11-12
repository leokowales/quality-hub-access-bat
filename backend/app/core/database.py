import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from app.core.storage import data_directory, prepare_data, load_environment


load_environment()

DATABASE_PATH = Path(
    os.getenv(
        "QUALITYHUB_DATABASE_PATH",
        str(data_directory() / "qualityhub.db"),
    )
)


class ConexaoFechadaAoSair(sqlite3.Connection):
    """Contexto SQLite confirma/desfaz e também libera o arquivo no Windows."""
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def conectar_banco():
    DATABASE_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    conexao = sqlite3.connect(DATABASE_PATH, factory=ConexaoFechadaAoSair)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")

    return conexao


def criar_backup_banco(origem: Path, destino: Path):
    """Copia um snapshot SQLite consistente, incluindo transações no WAL."""
    origem, destino = origem.resolve(), destino.resolve()
    if origem == destino:
        raise ValueError('O backup precisa ter um destino diferente do banco original.')
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Exclusivo: nunca substituir uma cópia anterior.
    with destino.open('xb'):
        pass
    try:
        with sqlite3.connect(origem.as_uri() + '?mode=ro', uri=True) as leitura:
            if leitura.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('O banco não passou na verificação de integridade; atualização interrompida.')
            copia = sqlite3.connect(destino)
            try:
                leitura.backup(copia)
                if copia.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Não foi possível validar a cópia de segurança.')
            finally:
                copia.close()
    except Exception:
        destino.unlink(missing_ok=True)
        raise
    finally:
        # Connection.__exit__ não fecha o handle no Windows.
        if 'leitura' in locals():
            leitura.close()


def _executar_script(conexao, script):
    """Executa DDL sem o COMMIT implícito de sqlite3.executescript."""
    statement = ''
    for line in script.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            conexao.execute(statement)
            statement = ''
    if statement.strip():
        conexao.execute(statement)


def _migracao_1(conexao):
    """Baseline do esquema existente; futuras vers?es adicionam novas migra??es."""
    _executar_script(conexao,
        """
        CREATE TABLE IF NOT EXISTS iteracoes (
            id TEXT PRIMARY KEY,
            project_key TEXT NOT NULL,
            team_name TEXT NOT NULL,
            sprint_id TEXT NOT NULL,
            sprint_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pendente',
            criada_em TEXT NOT NULL,
            atualizada_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sincronizacoes (
            id TEXT PRIMARY KEY,
            iteracao_id TEXT NOT NULL,
            versao INTEGER NOT NULL,
            dados_json TEXT NOT NULL,
            criada_em TEXT NOT NULL,

            FOREIGN KEY (iteracao_id)
                REFERENCES iteracoes(id),

            UNIQUE (iteracao_id, versao)
        );

        CREATE TABLE IF NOT EXISTS decisoes_revisao (
            id TEXT PRIMARY KEY,
            iteracao_id TEXT NOT NULL,
            issue_key TEXT NOT NULL,
            decisao TEXT NOT NULL,
            justificativa TEXT,
            criada_em TEXT NOT NULL,

            FOREIGN KEY (iteracao_id)
                REFERENCES iteracoes(id)
        );

        CREATE TABLE IF NOT EXISTS projetos (
            id TEXT PRIMARY KEY,
            chave TEXT NOT NULL,
            nome TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS times (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS time_projetos (
            time_id TEXT NOT NULL,
            projeto_id TEXT NOT NULL,

            PRIMARY KEY (time_id, projeto_id),

            FOREIGN KEY (time_id)
                REFERENCES times(id)
                ON DELETE CASCADE,

            FOREIGN KEY (projeto_id)
                REFERENCES projetos(id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pessoas (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            cargo TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS acesso_local (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            email TEXT NOT NULL,
            profile TEXT NOT NULL CHECK (profile IN ('qa', 'gestor')),
            password_hash BLOB NOT NULL,
            password_salt BLOB NOT NULL,
            onboarding_concluido INTEGER NOT NULL DEFAULT 0,
            criada_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pessoa_times (
            pessoa_id TEXT NOT NULL,
            time_id TEXT NOT NULL,

            PRIMARY KEY (pessoa_id, time_id),

            FOREIGN KEY (pessoa_id)
                REFERENCES pessoas(id)
                ON DELETE CASCADE,

            FOREIGN KEY (time_id)
                REFERENCES times(id)
                ON DELETE CASCADE
        );
        """
    )

    colunas = {
        coluna["name"]
        for coluna in conexao.execute(
            "PRAGMA table_info(iteracoes)"
        ).fetchall()
    }

    novas_colunas = {
        "data_inicio": "TEXT",
        "data_fim": "TEXT",
        "sprints_json": "TEXT",
        "quarters_json": "TEXT",
    }

    for nome, tipo in novas_colunas.items():
        if nome not in colunas:
            conexao.execute(
                f"ALTER TABLE iteracoes ADD COLUMN {nome} {tipo}"
            )

    conexao.execute("""
        CREATE TABLE IF NOT EXISTS consolidacoes_revisao (
            id TEXT PRIMARY KEY,
            iteracao_id TEXT NOT NULL UNIQUE,
            sincronizacao_id TEXT NOT NULL,
            sincronizacao_versao INTEGER NOT NULL,
            justificativa TEXT,
            ressalvas_json TEXT NOT NULL,
            decisoes_json TEXT NOT NULL,
            consolidada_em TEXT NOT NULL,
            FOREIGN KEY (iteracao_id)
                REFERENCES iteracoes(id),
            FOREIGN KEY (sincronizacao_id)
                REFERENCES sincronizacoes(id)
        )
    """)

    _executar_script(conexao, """
        CREATE TRIGGER IF NOT EXISTS
            bloquear_sincronizacao_consolidada
        BEFORE INSERT ON sincronizacoes
        WHEN (
            SELECT status
            FROM iteracoes
            WHERE id = NEW.iteracao_id
        ) = 'consolidada'
        BEGIN
            SELECT RAISE(
                ABORT,
                'Iteração consolidada não permite sincronização.'
            );
        END;

        CREATE TRIGGER IF NOT EXISTS
            bloquear_decisao_consolidada_insert
        BEFORE INSERT ON decisoes_revisao
        WHEN (
            SELECT status
            FROM iteracoes
            WHERE id = NEW.iteracao_id
        ) = 'consolidada'
        BEGIN
            SELECT RAISE(
                ABORT,
                'Iteração consolidada não permite novas decisões.'
            );
        END;

        CREATE TRIGGER IF NOT EXISTS
            bloquear_decisao_consolidada_update
        BEFORE UPDATE ON decisoes_revisao
        WHEN (
            SELECT status
            FROM iteracoes
            WHERE id = OLD.iteracao_id
        ) = 'consolidada'
        BEGIN
            SELECT RAISE(
                ABORT,
                'Iteração consolidada não permite alterar decisões.'
            );
        END;
    """)

    colunas_acesso = {coluna['name'] for coluna in conexao.execute("PRAGMA table_info(acesso_local)")}
    if 'onboarding_concluido' not in colunas_acesso:
        conexao.execute("ALTER TABLE acesso_local ADD COLUMN onboarding_concluido INTEGER NOT NULL DEFAULT 0")

    # Identidade Jira é separada da chave local; não inferir por nome no legado.
    for tabela, coluna in (('times', 'jira_id'), ('pessoas', 'account_id')):
        colunas = {c['name'] for c in conexao.execute(f'PRAGMA table_info({tabela})')}
        if coluna not in colunas:
            conexao.execute(f'ALTER TABLE {tabela} ADD COLUMN {coluna} TEXT')
        conexao.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS idx_{tabela}_{coluna} ON {tabela}({coluna}) WHERE {coluna} IS NOT NULL')

    # Evolução da tabela de decisões de revisão.
    colunas_decisoes = {
        coluna["name"]
        for coluna in conexao.execute(
            "PRAGMA table_info(decisoes_revisao)"
        ).fetchall()
    }

    novas_colunas_decisoes = {
        "origem": "TEXT NOT NULL DEFAULT 'manual'",
        "atualizada_em": "TEXT",
    }

    for nome, tipo in novas_colunas_decisoes.items():
        if nome not in colunas_decisoes:
            conexao.execute(
                f"ALTER TABLE decisoes_revisao ADD COLUMN {nome} {tipo}"
            )

    # Cada demanda possui uma decisão vigente por iteração.
    # Mantemos a tabela existente, sem recriá-la.

    # Remove a restrição antiga baseada na sprint principal.
    # A identificação de cada iteração passa a ser seu UUID.
    conexao.execute(
        "DROP INDEX IF EXISTS idx_iteracoes_projeto_time_sprint"
    )

    # Índice para agilizar consultas por projeto e time.
    # Permite múltiplas iterações com filtros diferentes.
    conexao.execute(
        """
        CREATE INDEX IF NOT EXISTS
            idx_iteracoes_projeto_time
        ON iteracoes (
            project_key,
            team_name COLLATE NOCASE
        )
        """
    )

    # Ciclos operacionais independentes das revisões consolidadas.
    _executar_script(conexao, """
        DROP INDEX IF EXISTS idx_sprint_viva_unica_ativa;
        DROP INDEX IF EXISTS idx_sprint_viva_iteracao;
        CREATE TABLE IF NOT EXISTS sprint_ativa_ciclos (
            id TEXT PRIMARY KEY,
            iteracao_id TEXT NOT NULL,
            numero_ciclo INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('ativa','concluida')),
            ativada_em TEXT NOT NULL,
            concluida_em TEXT,
            FOREIGN KEY(iteracao_id) REFERENCES iteracoes(id),
            UNIQUE(iteracao_id, numero_ciclo)
        );
        CREATE INDEX IF NOT EXISTS idx_sprint_ativa_iteracao
            ON sprint_ativa_ciclos(iteracao_id);
    """)

    # Freeze preserves the original cycle and frees the single active slot.
    colunas_ciclo = {coluna['name'] for coluna in conexao.execute('PRAGMA table_info(sprint_ativa_ciclos)')}
    if 'congelada_em' not in colunas_ciclo:
        conexao.execute('ALTER TABLE sprint_ativa_ciclos ADD COLUMN congelada_em TEXT')
    indice = conexao.execute("SELECT sql FROM sqlite_master WHERE name = 'idx_sprint_ativa_unica_ativa'").fetchone()
    if indice and 'congelada_em' not in indice['sql']:
        conexao.execute('DROP INDEX idx_sprint_ativa_unica_ativa')
    conexao.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_ativa_unica_ativa
        ON sprint_ativa_ciclos(status) WHERE status = 'ativa' AND congelada_em IS NULL""")


# Não alterar migrações publicadas: acrescentar a próxima versão nesta sequência.
MIGRACOES = (_migracao_1,)
VERSAO_ESQUEMA = len(MIGRACOES)


def inicializar_banco():
    if DATABASE_PATH.resolve() == (data_directory() / 'qualityhub.db').resolve():
        prepare_data()
    with conectar_banco() as conexao:
        versao = conexao.execute('PRAGMA user_version').fetchone()[0]
        if versao > VERSAO_ESQUEMA:
            raise RuntimeError('Este banco pertence a uma versão mais nova do QualityHub. Atualize o aplicativo; não recrie o banco.')
        if versao == VERSAO_ESQUEMA:
            return
        existente = conexao.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").fetchone()
        if existente:
            instante = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            backup = DATABASE_PATH.parent / 'backups' / f'schema-{versao}-{instante}-{uuid4().hex[:8]}.db'
            criar_backup_banco(DATABASE_PATH, backup)
        # Inclui DDL e a versão na mesma transação: falha desfaz ambos.
        conexao.execute('BEGIN IMMEDIATE')
        versao = conexao.execute('PRAGMA user_version').fetchone()[0]
        if versao > VERSAO_ESQUEMA:
            raise RuntimeError('Banco atualizado por outra versão; operação interrompida.')
        for numero in range(versao + 1, VERSAO_ESQUEMA + 1):
            MIGRACOES[numero - 1](conexao)
            conexao.execute(f'PRAGMA user_version = {numero}')
        if conexao.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('O banco não passou na verificação após a migração; alterações desfeitas.')
