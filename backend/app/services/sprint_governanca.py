"""Permanent QA records, sprint memberships and append-only audit events."""
import json
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from app.core.database import conectar_banco

TIPOS = {'informativo', 'ponto_atencao', 'evolucao_futura', 'governanca'}
STATUS = {'pendente', 'em_andamento', 'bloqueado', 'concluido'}


def _agora():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def _json(valor):
    return json.dumps(valor, ensure_ascii=False)


def _ciclo(db, ciclo_id, escrita=False):
    ciclo = db.execute("""SELECT c.*, i.project_key, i.team_name, i.sprint_name, i.data_inicio
        FROM sprint_ativa_ciclos c JOIN iteracoes i ON i.id=c.iteracao_id WHERE c.id=?""", (ciclo_id,)).fetchone()
    if not ciclo:
        raise HTTPException(404, 'Ciclo de sprint n\u00e3o encontrado.')
    if escrita and (ciclo['status'] != 'ativa' or ciclo['congelada_em']):
        raise HTTPException(409, 'A sprint precisa estar ativa e desbloqueada para alterar registros.')
    return ciclo


def _evento(db, registro_id, tipo, antes, depois, origem, destino, motivo='', instante=None):
    db.execute("""INSERT INTO sprint_governanca_eventos
        (registro_id,tipo,ocorrida_em,origem_iteracao_id,destino_iteracao_id,antes_json,depois_json,motivo)
        VALUES (?,?,?,?,?,?,?,?)""", (registro_id, tipo, instante or _agora(), origem, destino,
                                      _json(antes) if antes is not None else None,
                                      _json(depois) if depois is not None else None, motivo))


def _estado(db, registro_id):
    return dict(db.execute('SELECT * FROM sprint_governanca_registros WHERE id=?', (registro_id,)).fetchone())


def _tabela(db):
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_registros (
        id INTEGER PRIMARY KEY AUTOINCREMENT, iteracao_id TEXT NOT NULL REFERENCES iteracoes(id),
        tipo TEXT NOT NULL, titulo TEXT NOT NULL, descricao TEXT NOT NULL, status TEXT NOT NULL,
        abertura TEXT NOT NULL, fechamento TEXT, versao INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL)""")
    colunas = {item['name'] for item in db.execute('PRAGMA table_info(sprint_governanca_registros)')}
    for coluna, definicao in {'project_key': 'TEXT', 'team_name': 'TEXT', 'iteracao_atual_id': 'TEXT',
                              'motivo_bloqueio': "TEXT NOT NULL DEFAULT ''", 'excluido_em': 'TEXT'}.items():
        if coluna not in colunas:
            db.execute(f'ALTER TABLE sprint_governanca_registros ADD COLUMN {coluna} {definicao}')
    db.execute('CREATE INDEX IF NOT EXISTS idx_governanca_iteracao ON sprint_governanca_registros(iteracao_id)')
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_vinculos (
        registro_id INTEGER NOT NULL REFERENCES sprint_governanca_registros(id),
        iteracao_id TEXT NOT NULL REFERENCES iteracoes(id), snapshot_json TEXT NOT NULL,
        associada_em TEXT NOT NULL, encerrada_em TEXT, herdado_de_id TEXT,
        PRIMARY KEY(registro_id,iteracao_id))""")
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, registro_id INTEGER NOT NULL REFERENCES sprint_governanca_registros(id),
        tipo TEXT NOT NULL, ocorrida_em TEXT NOT NULL, origem_iteracao_id TEXT,
        destino_iteracao_id TEXT, antes_json TEXT, depois_json TEXT, motivo TEXT NOT NULL DEFAULT '')""")
    db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_governanca_migracao_unica
        ON sprint_governanca_eventos(registro_id,destino_iteracao_id) WHERE tipo='migracao'""")
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_snapshots_ciclo (
        registro_id INTEGER NOT NULL REFERENCES sprint_governanca_registros(id),
        ciclo_id TEXT NOT NULL REFERENCES sprint_ativa_ciclos(id), snapshot_json TEXT NOT NULL,
        capturado_em TEXT NOT NULL, PRIMARY KEY(registro_id,ciclo_id))""")
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_continuidade (
        ciclo_id TEXT PRIMARY KEY REFERENCES sprint_ativa_ciclos(id), resultado_json TEXT NOT NULL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_governanca_fechamentos (
        ciclo_id TEXT PRIMARY KEY REFERENCES sprint_ativa_ciclos(id), capturado_em TEXT NOT NULL)""")
    # Upgrade existing IDs in place. This runs only once per legacy record.
    legados = db.execute('SELECT id,iteracao_id,criado_em FROM sprint_governanca_registros WHERE iteracao_atual_id IS NULL').fetchall()
    for legado in legados:
        sprint = db.execute('SELECT project_key,team_name FROM iteracoes WHERE id=?', (legado['iteracao_id'],)).fetchone()
        db.execute('UPDATE sprint_governanca_registros SET project_key=?,team_name=?,iteracao_atual_id=iteracao_id WHERE id=?', (sprint['project_key'], sprint['team_name'], legado['id']))
        estado = _estado(db, legado['id'])
        db.execute('INSERT OR IGNORE INTO sprint_governanca_vinculos(registro_id,iteracao_id,snapshot_json,associada_em) VALUES (?,?,?,?)', (legado['id'], legado['iteracao_id'], _json(estado), legado['criado_em']))
        _evento(db, legado['id'], 'importado', None, estado, None, legado['iteracao_id'], 'Registro anterior preservado; hist\u00f3rico passa a ser acompanhado a partir desta atualiza\u00e7\u00e3o.')


def _sprint(db, iteracao_id):
    linha = db.execute('SELECT id,sprint_name,project_key,team_name FROM iteracoes WHERE id=?', (iteracao_id,)).fetchone()
    return dict(linha) if linha else None


def _historico(db, registro_id, limite=None):
    linhas = db.execute('SELECT * FROM sprint_governanca_eventos WHERE registro_id=? AND (? IS NULL OR ocorrida_em<=?) ORDER BY id', (registro_id, limite, limite)).fetchall()
    return [{**{chave: item[chave] for chave in item.keys() if chave not in {'antes_json', 'depois_json'}}, 'antes': json.loads(item['antes_json']) if item['antes_json'] else None,
             'depois': json.loads(item['depois_json']) if item['depois_json'] else None,
             'sprint_origem': _sprint(db, item['origem_iteracao_id']),
             'sprint_destino': _sprint(db, item['destino_iteracao_id'])}
            for item in linhas]


def _serializar(db, estado, iteracao_id, limite=None, editavel=False):
    acompanhadas = db.execute('SELECT iteracao_id,associada_em,herdado_de_id FROM sprint_governanca_vinculos WHERE registro_id=? AND (? IS NULL OR associada_em<=?) ORDER BY associada_em,iteracao_id', (estado['id'], limite, limite)).fetchall()
    fim = date.fromisoformat(estado['fechamento']) if estado['status'] == 'concluido' and estado['fechamento'] else (datetime.fromisoformat(limite.replace('Z', '+00:00')).astimezone(ZoneInfo('America/Sao_Paulo')).date() if limite else datetime.now(ZoneInfo('America/Sao_Paulo')).date())
    return {**estado, 'editavel': editavel, 'herdado': estado['iteracao_id'] != iteracao_id,
            'sprint_origem': _sprint(db, estado['iteracao_id']),
            'sprint_atual': _sprint(db, estado['iteracao_atual_id']),
            'sprints_acompanhadas': [{**(_sprint(db, item['iteracao_id']) or {}), 'associada_em': item['associada_em']} for item in acompanhadas],
            'quantidade_sprints': len(acompanhadas),
            'dias_em_aberto': max(0, (fim - date.fromisoformat(estado['abertura'])).days),
            'historico': _historico(db, estado['id'], limite)}


def _atualizar_vinculo(db, registro_id):
    estado = _estado(db, registro_id)
    db.execute('UPDATE sprint_governanca_vinculos SET snapshot_json=? WHERE registro_id=? AND iteracao_id=?', (_json(estado), registro_id, estado['iteracao_atual_id']))


def _listar(db, ciclo):
    editavel = ciclo['status'] == 'ativa' and not ciclo['congelada_em']
    registros = []
    if not editavel and db.execute('SELECT 1 FROM sprint_governanca_fechamentos WHERE ciclo_id=?', (ciclo['id'],)).fetchone():
        snapshots = db.execute('SELECT snapshot_json FROM sprint_governanca_snapshots_ciclo WHERE ciclo_id=?', (ciclo['id'],)).fetchall()
        for item in snapshots:
            estado = json.loads(item['snapshot_json'])
            estado['editavel'] = False
            if not estado.get('excluido_em'):
                registros.append(estado)
        return sorted(registros, key=lambda item: (item['abertura'], item['id']), reverse=True)
    linhas = db.execute('SELECT v.*,r.iteracao_atual_id AS atual FROM sprint_governanca_vinculos v JOIN sprint_governanca_registros r ON r.id=v.registro_id WHERE v.iteracao_id=? ORDER BY v.registro_id DESC', (ciclo['iteracao_id'],)).fetchall()
    for linha in linhas:
        congelado = db.execute('SELECT snapshot_json FROM sprint_governanca_snapshots_ciclo WHERE ciclo_id=? AND registro_id=?', (ciclo['id'], linha['registro_id'])).fetchone()
        if not editavel and congelado:
            registro = json.loads(congelado['snapshot_json'])
            registro['editavel'] = False
        else:
            estado = json.loads(linha['snapshot_json'])
            limite = linha['encerrada_em'] if linha['atual'] != ciclo['iteracao_id'] else (None if editavel else ciclo['concluida_em'] or ciclo['congelada_em'])
            registro = _serializar(db, estado, ciclo['iteracao_id'], limite, editavel and linha['atual'] == ciclo['iteracao_id'] and not estado.get('excluido_em'))
        if not registro.get('excluido_em'):
            registros.append(registro)
    return sorted(registros, key=lambda item: (item['abertura'], item['id']), reverse=True)


def listar(ciclo_id):
    with conectar_banco() as db:
        db.execute('BEGIN')
        ciclo = _ciclo(db, ciclo_id)
        _tabela(db)
        registros = _listar(db, ciclo)
        resultado = db.execute('SELECT resultado_json FROM sprint_governanca_continuidade WHERE ciclo_id=?', (ciclo_id,)).fetchone()
    return {'registros': registros, 'editavel': ciclo['status'] == 'ativa' and not ciclo['congelada_em'],
            'projeto': ciclo['project_key'], 'time': ciclo['team_name'], 'sprint': ciclo['sprint_name'],
            'continuidade': json.loads(resultado['resultado_json']) if resultado else None}


def historico(ciclo_id):
    with conectar_banco() as db:
        db.execute('BEGIN')
        ciclo = _ciclo(db, ciclo_id)
        _tabela(db)
        limite = (ciclo['concluida_em'] or ciclo['congelada_em']) if ciclo['status'] != 'ativa' or ciclo['congelada_em'] else None
        ids = db.execute('SELECT registro_id FROM sprint_governanca_vinculos WHERE iteracao_id=?', (ciclo['iteracao_id'],)).fetchall()
        eventos = [evento for item in ids for evento in _historico(db, item['registro_id'], limite)]
    return {'eventos': sorted(eventos, key=lambda item: (item['ocorrida_em'], item['id']), reverse=True)}


def _validar(dados):
    tipo, status = dados.get('tipo'), dados.get('status')
    titulo, descricao = str(dados.get('titulo') or '').strip(), str(dados.get('descricao') or '').strip()
    bloqueio = str(dados.get('motivo_bloqueio') or '').strip()
    if tipo not in TIPOS or status not in STATUS:
        raise HTTPException(422, 'Tipo ou status inv\u00e1lido.')
    if not titulo or len(titulo) > 160 or len(descricao) > 4000 or len(bloqueio) > 2000:
        raise HTTPException(422, 'Confira os limites de t\u00edtulo (160), descri\u00e7\u00e3o (4000) e bloqueio (2000).')
    if status == 'bloqueado' and not bloqueio:
        raise HTTPException(422, 'Informe o motivo do bloqueio.')
    if status != 'bloqueado':
        bloqueio = ''
    try:
        abertura = date.fromisoformat(str(dados.get('abertura')))
        fechamento = date.fromisoformat(str(dados['fechamento'])) if dados.get('fechamento') else None
    except (ValueError, TypeError):
        raise HTTPException(422, 'Informe datas v\u00e1lidas.')
    if status == 'concluido' and fechamento is None:
        fechamento = datetime.now(ZoneInfo('America/Sao_Paulo')).date()
    if status != 'concluido' and fechamento is not None:
        raise HTTPException(422, 'Data de conclus\u00e3o \u00e9 permitida apenas para registros conclu\u00eddos.')
    if fechamento is not None and fechamento < abertura:
        raise HTTPException(422, 'Conclus\u00e3o n\u00e3o pode ser anterior \u00e0 abertura.')
    return {'tipo': tipo, 'titulo': titulo, 'descricao': descricao, 'status': status, 'abertura': abertura.isoformat(), 'fechamento': fechamento.isoformat() if fechamento else None, 'motivo_bloqueio': bloqueio}


def salvar(ciclo_id, dados, registro_id=None):
    valores = _validar(dados)
    agora = _agora()
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        ciclo = _ciclo(db, ciclo_id, escrita=True)
        _tabela(db)
        if registro_id is None:
            cursor = db.execute('INSERT INTO sprint_governanca_registros(iteracao_id,project_key,team_name,iteracao_atual_id,tipo,titulo,descricao,status,abertura,fechamento,motivo_bloqueio,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (ciclo['iteracao_id'], ciclo['project_key'], ciclo['team_name'], ciclo['iteracao_id'], *valores.values(), agora, agora))
            registro_id = cursor.lastrowid
            estado = _estado(db, registro_id)
            db.execute('INSERT INTO sprint_governanca_vinculos(registro_id,iteracao_id,snapshot_json,associada_em) VALUES (?,?,?,?)', (registro_id, ciclo['iteracao_id'], _json(estado), agora))
            _evento(db, registro_id, 'criacao', None, estado, None, ciclo['iteracao_id'], instante=agora)
            if estado['status'] == 'bloqueado':
                _evento(db, registro_id, 'bloqueio', None, estado, None, ciclo['iteracao_id'], estado['motivo_bloqueio'], agora)
            elif estado['status'] == 'concluido':
                _evento(db, registro_id, 'conclusao', None, estado, None, ciclo['iteracao_id'], instante=agora)

        else:
            atual = db.execute('SELECT * FROM sprint_governanca_registros WHERE id=? AND iteracao_atual_id=? AND excluido_em IS NULL', (registro_id, ciclo['iteracao_id'])).fetchone()
            if not atual:
                raise HTTPException(404, 'Registro n\u00e3o pode ser editado nesta sprint.')
            if dados.get('versao') != atual['versao']:
                raise HTTPException(409, 'O registro mudou. Atualize a lista antes de editar novamente.')
            if valores['abertura'] != atual['abertura']:
                raise HTTPException(422, 'A data de abertura original deve ser preservada.')
            db.execute('UPDATE sprint_governanca_registros SET tipo=?,titulo=?,descricao=?,status=?,abertura=?,fechamento=?,motivo_bloqueio=?,versao=versao+1,atualizado_em=? WHERE id=?', (*valores.values(), agora, registro_id))
            depois = _estado(db, registro_id)
            antes = dict(atual)
            for campo, evento in {'tipo': 'categoria_alterada', 'titulo': 'titulo_alterado', 'descricao': 'descricao_alterada'}.items():
                if antes[campo] != depois[campo]:
                    _evento(db, registro_id, evento, antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
            if antes['status'] != depois['status']:
                _evento(db, registro_id, 'status_alterado', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
                if antes['status'] == 'bloqueado':
                    _evento(db, registro_id, 'desbloqueio', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], antes['motivo_bloqueio'], agora)
                if depois['status'] == 'bloqueado':
                    _evento(db, registro_id, 'bloqueio', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], depois['motivo_bloqueio'], agora)
                if depois['status'] == 'concluido':
                    _evento(db, registro_id, 'conclusao', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
                if antes['status'] == 'concluido':
                    _evento(db, registro_id, 'reabertura', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
            elif antes['motivo_bloqueio'] != depois['motivo_bloqueio']:
                _evento(db, registro_id, 'bloqueio_atualizado', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], depois['motivo_bloqueio'], agora)
            elif antes['fechamento'] != depois['fechamento']:
                _evento(db, registro_id, 'conclusao_corrigida', antes, depois, ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
            _atualizar_vinculo(db, registro_id)
        registro = _serializar(db, _estado(db, registro_id), ciclo['iteracao_id'], editavel=True)
    return registro


def remover(ciclo_id, registro_id, versao):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        ciclo = _ciclo(db, ciclo_id, escrita=True)
        _tabela(db)
        atual = db.execute('SELECT * FROM sprint_governanca_registros WHERE id=? AND iteracao_atual_id=? AND excluido_em IS NULL', (registro_id, ciclo['iteracao_id'])).fetchone()
        if not atual:
            raise HTTPException(404, 'Registro n\u00e3o encontrado nesta sprint.')
        if atual['versao'] != versao:
            raise HTTPException(409, 'O registro mudou. Atualize a lista antes de remover.')
        agora = _agora()
        db.execute('UPDATE sprint_governanca_registros SET excluido_em=?,atualizado_em=?,versao=versao+1 WHERE id=?', (agora, agora, registro_id))
        _evento(db, registro_id, 'exclusao', dict(atual), _estado(db, registro_id), ciclo['iteracao_id'], ciclo['iteracao_id'], instante=agora)
        _atualizar_vinculo(db, registro_id)
    return {'removido': True}


def encerrar_acompanhamento(db, ciclo_id, instante=None):
    """Capture immutable historical cycle views without completing the QA records."""
    _tabela(db)
    ciclo = _ciclo(db, ciclo_id)
    instante = instante or _agora()
    capturados = _listar(db, ciclo)
    db.execute('DELETE FROM sprint_governanca_snapshots_ciclo WHERE ciclo_id=?', (ciclo_id,))
    for registro in capturados:
        registro['editavel'] = False
        db.execute('INSERT INTO sprint_governanca_snapshots_ciclo(registro_id,ciclo_id,snapshot_json,capturado_em) VALUES (?,?,?,?) ON CONFLICT(registro_id,ciclo_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,capturado_em=excluded.capturado_em', (registro['id'], ciclo_id, _json(registro), instante))
    db.execute('INSERT INTO sprint_governanca_fechamentos(ciclo_id,capturado_em) VALUES (?,?) ON CONFLICT(ciclo_id) DO UPDATE SET capturado_em=excluded.capturado_em', (ciclo_id, instante))
    db.execute('UPDATE sprint_governanca_vinculos SET encerrada_em=? WHERE iteracao_id=? AND registro_id IN (SELECT id FROM sprint_governanca_registros WHERE iteracao_atual_id=?)', (instante, ciclo['iteracao_id'], ciclo['iteracao_id']))


def _resultado_continuidade(db, ciclo_id, resultado):
    db.execute('INSERT INTO sprint_governanca_continuidade(ciclo_id,resultado_json) VALUES (?,?) ON CONFLICT(ciclo_id) DO UPDATE SET resultado_json=excluded.resultado_json', (ciclo_id, _json(resultado)))
    return resultado


def continuar_na_ativacao(db, ciclo_id):
    """Only move forward in the explicitly agreed project + squad flow."""
    _tabela(db)
    destino = _ciclo(db, ciclo_id)
    concorrentes = db.execute("""SELECT c.id FROM sprint_ativa_ciclos c JOIN iteracoes i ON i.id=c.iteracao_id
        WHERE c.status='ativa' AND c.congelada_em IS NULL AND c.iteracao_id<>?
        AND lower(trim(i.project_key))=lower(trim(?)) AND lower(trim(i.team_name))=lower(trim(?))""", (destino['iteracao_id'], destino['project_key'], destino['team_name'])).fetchall()
    if concorrentes:
        return _resultado_continuidade(db, ciclo_id, {'migrados': 0, 'pendentes': None, 'ambiguo': True, 'motivo': 'Fluxo com sprints simult\u00e2neas; continuidade n\u00e3o aplicada automaticamente.'})
    registros = db.execute("""SELECT r.*,i.data_inicio AS inicio_atual FROM sprint_governanca_registros r
        JOIN iteracoes i ON i.id=r.iteracao_atual_id WHERE r.status IN ('pendente','em_andamento','bloqueado')
        AND r.excluido_em IS NULL AND r.iteracao_atual_id<>?
        AND lower(trim(r.project_key))=lower(trim(?)) AND lower(trim(r.team_name))=lower(trim(?))""", (destino['iteracao_id'], destino['project_key'], destino['team_name'])).fetchall()
    migrados = pendentes = 0
    instante = _agora()
    for item in registros:
        # Revisiting a sprint never overwrites its previous membership or moves records backwards.
        if db.execute('SELECT 1 FROM sprint_governanca_vinculos WHERE registro_id=? AND iteracao_id=?', (item['id'], destino['iteracao_id'])).fetchone():
            continue
        if item['inicio_atual'] and destino['data_inicio'] and destino['data_inicio'] < item['inicio_atual']:
            pendentes += 1
            continue
        antes = _estado(db, item['id'])
        db.execute('UPDATE sprint_governanca_vinculos SET encerrada_em=COALESCE(encerrada_em,?) WHERE registro_id=? AND iteracao_id=?', (instante, item['id'], item['iteracao_atual_id']))
        db.execute('UPDATE sprint_governanca_registros SET iteracao_atual_id=?,versao=versao+1,atualizado_em=? WHERE id=?', (destino['iteracao_id'], instante, item['id']))
        depois = _estado(db, item['id'])
        db.execute('INSERT INTO sprint_governanca_vinculos(registro_id,iteracao_id,snapshot_json,associada_em,herdado_de_id) VALUES (?,?,?,?,?)', (item['id'], destino['iteracao_id'], _json(depois), instante, item['iteracao_atual_id']))
        _evento(db, item['id'], 'migracao', antes, depois, item['iteracao_atual_id'], destino['iteracao_id'], instante=instante)
        migrados += 1
    return _resultado_continuidade(db, ciclo_id, {'migrados': migrados, 'pendentes': pendentes, 'ambiguo': False, 'motivo': 'Continuidade por projeto e time/squad.'})
