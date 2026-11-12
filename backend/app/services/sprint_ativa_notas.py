"""Notas opcionais vinculadas à demanda, independentes de alertas e do Jira."""
from datetime import datetime, timezone
from fastapi import HTTPException
from app.core.database import conectar_banco


def _validar_ciclo(db, ciclo_id):
    if not db.execute('SELECT id FROM sprint_ativa_ciclos WHERE id = ?', (ciclo_id,)).fetchone():
        raise HTTPException(404, 'Ciclo de sprint não encontrado.')


def _tabela(db):
    db.execute('''CREATE TABLE IF NOT EXISTS sprint_atencao_notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ciclo_id TEXT NOT NULL, issue_key TEXT NOT NULL,
      finalidade TEXT NOT NULL CHECK(finalidade IN ('pessoal', 'relatorio')),
      texto TEXT NOT NULL, criado_em TEXT NOT NULL,
      FOREIGN KEY(ciclo_id) REFERENCES sprint_ativa_ciclos(id))''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_sprint_notas_ciclo ON sprint_atencao_notas(ciclo_id, issue_key)')


def listar_notas(ciclo_id):
    with conectar_banco() as db:
        _validar_ciclo(db, ciclo_id)
        _tabela(db)
        linhas = db.execute('''SELECT id, issue_key, finalidade, texto, criado_em
            FROM sprint_atencao_notas WHERE ciclo_id = ? ORDER BY id DESC''', (ciclo_id,)).fetchall()
    return {'notas': [dict(linha) for linha in linhas]}


def criar_nota(ciclo_id, issue_key, finalidade, texto):
    issue_key = issue_key.strip() if isinstance(issue_key, str) else ''
    texto = texto.strip() if isinstance(texto, str) else ''
    if not issue_key or len(issue_key) > 100 or not all(c.isalnum() or c in '-_' for c in issue_key):
        raise HTTPException(422, 'Chave da demanda inválida.')
    if finalidade not in ('pessoal', 'relatorio'):
        raise HTTPException(422, 'Finalidade inválida.')
    if not texto or len(texto) > 4000:
        raise HTTPException(422, 'Informe uma nota com até 4000 caracteres.')
    # Notas são da demanda, não da ocorrência: continuam válidas após o alerta sumir.
    import json
    with conectar_banco() as db:
        _validar_ciclo(db, ciclo_id)
        _tabela(db)
        linha = db.execute("""SELECT s.dados_json FROM sprint_ativa_ciclos c
            JOIN consolidacoes_revisao cr ON cr.iteracao_id = c.iteracao_id
            JOIN sincronizacoes s ON s.id = cr.sincronizacao_id
            WHERE c.id = ?""", (ciclo_id,)).fetchone()
        if not linha or not linha['dados_json']:
            raise HTTPException(409, 'A sprint não possui consolidação.')
        chaves = {d.get('key') for d in json.loads(linha['dados_json']).get('demandas', []) if isinstance(d, dict)}
        if issue_key not in chaves:
            raise HTTPException(404, 'Demanda não pertence à consolidação da sprint.')
    agora = datetime.now(timezone.utc).isoformat(timespec='seconds')
    with conectar_banco() as db:
        _validar_ciclo(db, ciclo_id)
        _tabela(db)
        cursor = db.execute('INSERT INTO sprint_atencao_notas(ciclo_id, issue_key, finalidade, texto, criado_em) VALUES (?, ?, ?, ?, ?)', (ciclo_id, issue_key, finalidade, texto, agora))
        nota_id = cursor.lastrowid
    return {'id': nota_id, 'issue_key': issue_key, 'finalidade': finalidade, 'texto': texto, 'criado_em': agora}
