"""Histórico incremental de bugs observados pelo QualityHub."""
from datetime import datetime, timezone
from app.core.database import conectar_banco


def aplicar_memoria(project_key, team_name, sprint_ids, demandas):
    """Preserva origem conhecida sem confundir primeira observação com criação."""
    selecionadas = {str(s) for s in sprint_ids or []}
    if not selecionadas:
        return
    agora = datetime.now(timezone.utc).isoformat()
    with conectar_banco() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS bug_historico (
            project_key TEXT NOT NULL, team_name TEXT NOT NULL,
            issue_key TEXT NOT NULL, origin_sprint_id TEXT,
            first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
            created_at TEXT, last_status TEXT,
            PRIMARY KEY(project_key, team_name, issue_key))''')
        db.execute('''CREATE TABLE IF NOT EXISTS bug_observacoes (
            project_key TEXT NOT NULL, team_name TEXT NOT NULL,
            issue_key TEXT NOT NULL, sprint_id TEXT NOT NULL,
            first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
            last_status TEXT,
            PRIMARY KEY(project_key, team_name, issue_key, sprint_id))''')
        for demanda in demandas:
            ciclo = demanda.get('bug_lifecycle')
            if demanda.get('scope') != 'direct' or not isinstance(ciclo, dict):
                continue
            chave = demanda.get('key')
            if not chave:
                continue
            anterior = db.execute('''SELECT origin_sprint_id FROM bug_historico
                WHERE project_key=? AND team_name=? AND issue_key=?''',
                (project_key, team_name, chave)).fetchone()
            origem_antiga = anterior['origin_sprint_id'] if anterior else None
            origem_jira = ciclo.get('origin_sprint_id')
            origem_confirmada = (str(origem_jira) if origem_jira is not None
                                else None)
            origem = origem_antiga or origem_confirmada
            if origem_antiga:
                ciclo['origin_sprint_id'] = origem_antiga
                ciclo['origin_confidence'] = 'qualityhub_history'
            ciclo['origin_source'] = ('qualityhub_history' if origem_antiga else
                                      'jira_sprint_dates' if origem_confirmada else 'unknown')
            ciclo['classification'] = ('originated' if origem in selecionadas else
                                       'inherited_known' if origem else 'inherited_unknown')
            db.execute('''INSERT INTO bug_historico
                (project_key,team_name,issue_key,origin_sprint_id,first_seen_at,last_seen_at,created_at,last_status)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(project_key,team_name,issue_key) DO UPDATE SET
                origin_sprint_id=COALESCE(bug_historico.origin_sprint_id,excluded.origin_sprint_id),
                last_seen_at=excluded.last_seen_at,last_status=excluded.last_status''',
                (project_key,team_name,chave,origem,agora,agora,demanda.get('created'),demanda.get('status')))
            associadas = {str(s.get('id')) for s in demanda.get('sprints') or []
                          if isinstance(s,dict) and s.get('id') is not None}
            for sid in sorted(selecionadas & associadas):
                db.execute('''INSERT INTO bug_observacoes
                    (project_key,team_name,issue_key,sprint_id,first_seen_at,last_seen_at,last_status)
                    VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(project_key,team_name,issue_key,sprint_id)
                    DO UPDATE SET last_seen_at=excluded.last_seen_at,last_status=excluded.last_status''',
                    (project_key,team_name,chave,sid,agora,agora,demanda.get('status')))
