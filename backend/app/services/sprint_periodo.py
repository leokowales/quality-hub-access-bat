"""Período planejado por iteração, independente dos ciclos operacionais."""
from datetime import date, datetime, timezone
from fastapi import HTTPException
from app.core.database import conectar_banco

def _tabelas(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS sprint_periodos (
      iteracao_id TEXT PRIMARY KEY REFERENCES iteracoes(id),
      inicio TEXT NOT NULL,
      fim TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sprint_periodos_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iteracao_id TEXT NOT NULL REFERENCES iteracoes(id),
      inicio_anterior TEXT,
      fim_anterior TEXT,
      inicio_novo TEXT NOT NULL,
      fim_novo TEXT NOT NULL,
      alterado_em TEXT NOT NULL
    );
    """)

def consultar(iteracao_id: str):
    with conectar_banco() as db:
        _tabelas(db)
        if not db.execute("SELECT 1 FROM iteracoes WHERE id=?", (iteracao_id,)).fetchone():
            raise HTTPException(404, "Sprint não encontrada.")
        row = db.execute("SELECT * FROM sprint_periodos WHERE iteracao_id=?", (iteracao_id,)).fetchone()
        return dict(row) if row else {"iteracao_id": iteracao_id, "inicio": None, "fim": None, "atualizado_em": None}

def salvar(iteracao_id: str, inicio: date, fim: date):
    if fim < inicio:
        raise HTTPException(422, "O término não pode anteceder o início.")
    with conectar_banco() as db:
        _tabelas(db)
        iteracao = db.execute("SELECT team_name FROM iteracoes WHERE id=?", (iteracao_id,)).fetchone()
        if not iteracao:
            raise HTTPException(404, "Sprint não encontrada.")
        # A sobreposição não bloqueia o QA; fica explícita na resposta.
        conflitos = db.execute("""
            SELECT i.id, i.sprint_name FROM sprint_periodos p
            JOIN iteracoes i ON i.id=p.iteracao_id
            WHERE i.team_name=? AND i.id<>? AND p.inicio<=? AND p.fim>=?
        """, (iteracao["team_name"], iteracao_id, fim.isoformat(), inicio.isoformat())).fetchall()
        anterior = db.execute("SELECT * FROM sprint_periodos WHERE iteracao_id=?", (iteracao_id,)).fetchone()
        if anterior and anterior["inicio"] == inicio.isoformat() and anterior["fim"] == fim.isoformat():
            return {**dict(anterior), "conflitos": [dict(c) for c in conflitos]}
        agora = datetime.now(timezone.utc).isoformat()
        db.execute("""
            INSERT INTO sprint_periodos_historico
            (iteracao_id,inicio_anterior,fim_anterior,inicio_novo,fim_novo,alterado_em)
            VALUES (?,?,?,?,?,?)
        """, (iteracao_id, anterior["inicio"] if anterior else None,
              anterior["fim"] if anterior else None, inicio.isoformat(), fim.isoformat(), agora))
        db.execute("""
            INSERT INTO sprint_periodos(iteracao_id,inicio,fim,atualizado_em)
            VALUES (?,?,?,?)
            ON CONFLICT(iteracao_id) DO UPDATE SET inicio=excluded.inicio,
            fim=excluded.fim,atualizado_em=excluded.atualizado_em
        """, (iteracao_id, inicio.isoformat(), fim.isoformat(), agora))
        return {"iteracao_id":iteracao_id,"inicio":inicio.isoformat(),
                "fim":fim.isoformat(),"atualizado_em":agora,
                "conflitos":[dict(c) for c in conflitos]}
