"""Escopo operacional versionado; nunca altera a revisão consolidada."""
import copy
import json
import unicodedata
from datetime import date, datetime, timezone

from fastapi import HTTPException
from app.core.database import conectar_banco
from app.services.issue_types import demanda_util


def tipo(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '').strip().casefold()) if not unicodedata.combining(c))


def bug(item):
    return tipo(item.get('issue_type')) in {'bug', 'sub-bug', 'sub bug', 'subbug'}


def tabelas(db):
    # execute, não executescript: preservar a transação de quem chamou.
    db.execute('''CREATE TABLE IF NOT EXISTS sprint_escopo_estado (
        iteracao_id TEXT PRIMARY KEY REFERENCES iteracoes(id), versao INTEGER NOT NULL,
        dados_json TEXT NOT NULL, atualizado_em TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS sprint_escopo_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, iteracao_id TEXT NOT NULL REFERENCES iteracoes(id),
        ciclo_id TEXT NOT NULL REFERENCES sprint_ativa_ciclos(id), versao INTEGER NOT NULL,
        issue_key TEXT, acao TEXT NOT NULL, antes TEXT, depois TEXT, motivo TEXT NOT NULL,
        criado_em TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS sprint_bug_origem_manual (
        issue_key TEXT NOT NULL, iteracao_id TEXT NOT NULL, classificacao TEXT NOT NULL,
        sprints_json TEXT NOT NULL, motivo TEXT NOT NULL, atualizada_em TEXT NOT NULL,
        PRIMARY KEY(issue_key, iteracao_id))''')
    # Bancos anteriores identificavam a origem somente pela chave do defeito.
    # Migrar dentro da transação atual, preservando a classificação existente.
    colunas = db.execute('PRAGMA table_info(sprint_bug_origem_manual)').fetchall()
    chave = [c['name'] for c in sorted(colunas, key=lambda c: c['pk']) if c['pk']]
    if chave == ['issue_key']:
        db.execute('ALTER TABLE sprint_bug_origem_manual RENAME TO sprint_bug_origem_manual_legado')
        db.execute('''CREATE TABLE sprint_bug_origem_manual (
            issue_key TEXT NOT NULL, iteracao_id TEXT NOT NULL, classificacao TEXT NOT NULL,
            sprints_json TEXT NOT NULL, motivo TEXT NOT NULL, atualizada_em TEXT NOT NULL,
            PRIMARY KEY(issue_key, iteracao_id))''')
        db.execute('''INSERT INTO sprint_bug_origem_manual
            (issue_key, iteracao_id, classificacao, sprints_json, motivo, atualizada_em)
            SELECT issue_key, iteracao_id, classificacao, sprints_json, motivo, atualizada_em
            FROM sprint_bug_origem_manual_legado''')
        db.execute('DROP TABLE sprint_bug_origem_manual_legado')


def registro(db, ciclo_id, escrita=False):
    r = db.execute('''SELECT c.*, i.project_key, i.team_name, i.data_inicio, i.data_fim,
        i.sprints_json, i.quarters_json, i.sprint_id, cr.decisoes_json, s.dados_json
        FROM sprint_ativa_ciclos c JOIN iteracoes i ON i.id=c.iteracao_id
        JOIN consolidacoes_revisao cr ON cr.iteracao_id=i.id
        JOIN sincronizacoes s ON s.id=cr.sincronizacao_id WHERE c.id=?''', (ciclo_id,)).fetchone()
    if not r:
        raise HTTPException(404, 'Ciclo com revisão consolidada não encontrado.')
    if escrita and (r['status'] != 'ativa' or r['congelada_em']):
        raise HTTPException(409, 'Somente a sprint ativa pode receber alterações.')
    return r


def sprints(r):
    return {str(s) for s in (json.loads(r['sprints_json'] or '[]') or ([r['sprint_id']] if r['sprint_id'] else []))}


def classificacao(db, demanda, r):
    manual = db.execute('''SELECT * FROM sprint_bug_origem_manual
        WHERE issue_key=? AND (iteracao_id=? OR atualizada_em<=?)
        ORDER BY (iteracao_id=?) DESC, atualizada_em DESC LIMIT 1''',
        (demanda['key'], r['iteracao_id'], r['ativada_em'], r['iteracao_id'])).fetchone()
    if manual:
        return manual['classificacao'] if manual['iteracao_id'] == r['iteracao_id'] else 'herdado'
    ciclo = demanda.get('bug_lifecycle') or {}
    sid = ciclo.get('origin_sprint_id')
    if sid and str(sid) in sprints(r):
        return 'desta_sprint'
    associadas = {str(s['id']) for s in demanda.get('sprints', []) if isinstance(s, dict) and s.get('id') is not None}
    if sid and demanda.get('scope') == 'direct' and sprints(r).intersection(associadas):
        # Origem anterior conhecida + participação direta atual também cobre transporte após o início.
        return 'herdado'
    if ciclo.get('history_complete') is True and sprints(r).intersection(str(s) for s in ciclo.get('carried_sprint_ids', [])):
        return 'herdado'
    return None


def contextual(d):
    return (d.get('scope') != 'direct'
            and tipo(d.get('issue_type')) in {'epic', 'epico', 'historia', 'story', 'user story'}
            and (d.get('scope') != 'manual_lookup' or 'ancestor' in (d.get('inclusion_reasons') or [])))


def carregar(db, r):
    tabelas(db)
    row = db.execute('SELECT * FROM sprint_escopo_estado WHERE iteracao_id=?', (r['iteracao_id'],)).fetchone()
    if row:
        estado = json.loads(row['dados_json'])
        reconciliar(estado)
        return estado, row['versao']
    baseline = json.loads(r['dados_json'])
    # Migração preguiçosa preserva a leitura operacional válida já existente.
    from app.services.sprint_ativa_storage import obter_dados_operacionais
    atual, _, _ = obter_dados_operacionais(db, r['id'], r['dados_json'])
    decisoes = {d['issue_key']: d['decisao'] for d in json.loads(r['decisoes_json'])}
    demandas = {d['key']: d for d in (baseline.get('contexto', {}).get('demandas_originais') or [])}
    demandas.update({d['key']: d for d in atual.get('demandas', [])})
    excluidas = set(baseline.get('demandas_excluidas') or [])
    itens = {}
    for key, d in demandas.items():
        if not demanda_util(d):
            continue
        excluida = decisoes.get(key) == 'exclude' or key in excluidas
        itens[key] = {'demanda': d, 'estado': 'excluida' if excluida else 'incluida',
                      'manual': excluida or (d.get('scope') == 'manual_lookup' and not contextual(d)),
                      'contextual': contextual(d), 'pendencia': None, 'ausente_aceita': False,
                      'motivo': 'Decisão da revisão aprovada', 'origem_bug': classificacao(db, d, r) if bug(d) else None}
    estado = {'itens': itens, 'base': baseline}
    reconciliar(estado)
    return estado, 0


def referencias_contexto(itens, key):
    d = itens[key]['demanda']
    deps = {d.get('parent_key')}
    deps.update(rel.get('key') for rel in d.get('qa_relationships', []) if rel.get('relationship') == 'tests_story')
    # Aceitar também vínculo informado apenas pela História.
    deps.update(k for k, item in itens.items() if any(rel.get('relationship') == 'test_plan' and rel.get('key') == key for rel in item['demanda'].get('qa_relationships', [])))
    if bug(d) or tipo(d.get('issue_type')) in {'assertthat test plan', 'test plan', 'testplan', 'tp'}:
        # Links Jira podem existir sem a projeção QA (por exemplo, Squad em Bug).
        deps.update(rel.get('destino') for rel in d.get('relationships', []))
        deps.update(k for k, item in itens.items() if any(rel.get('destino') == key for rel in item['demanda'].get('relationships', [])))
    return {k for k in deps if k and k != key and k in itens and tipo(itens[k]['demanda'].get('issue_type')) in {'historia', 'story', 'user story', 'epic', 'epico'}}


def dependencias(itens, key):
    deps = referencias_contexto(itens, key)
    return {k for k in deps if k and k != key and k in itens and itens[k]['contextual']}


def reconciliar(estado):
    estado['_itens_ignorados'] = sorted(set(estado.get('_itens_ignorados', [])) | {k for k, i in estado['itens'].items() if not demanda_util(i['demanda'])})
    estado['itens'] = {k: i for k, i in estado['itens'].items() if demanda_util(i['demanda'])}
    itens = estado['itens']
    fila = [k for k, i in itens.items() if i['estado'] == 'incluida' and not i['contextual']]
    vistos = set(fila)
    while fila:
        for key in referencias_contexto(itens, fila.pop()):
            item = itens[key]
            if item['estado'] == 'excluida':
                continue
            if not item['manual'] and (item['pendencia'] == 'ausencia' or contextual(item['demanda'])):
                item['contextual'] = True
                item['pendencia'] = None
                item['demanda']['_qualityhub_rastreamento'] = 'contexto_preservado'
            if key not in vistos:
                vistos.add(key)
                fila.append(key)
    requeridos = {k: set() for k in itens}
    for root, item in itens.items():
        if item['estado'] != 'incluida' or item['contextual']:
            continue
        fila, vistos = [root], {root}
        while fila:
            key = fila.pop()
            for dep in dependencias(itens, key):
                requeridos[dep].add(root)
                if dep not in vistos:
                    vistos.add(dep)
                    fila.append(dep)
    for key, item in itens.items():
        item['requerida_por'] = sorted(requeridos[key])
        if item['contextual'] and not item['manual']:
            item['estado'] = 'incluida' if requeridos[key] else 'contexto_inativo'
            item['pendencia'] = None
        if bug(item['demanda']) and item['estado'] == 'incluida' and not item.get('origem_bug') and not item['pendencia']:
            item['pendencia'] = 'classificar_origem'
        if item['estado'] == 'excluida':
            item['pendencia'] = None


def pendencias(estado):
    return sum(bool(i.get('pendencia')) for i in estado['itens'].values())


def comparar_dados(antes, depois):
    campos = [('status', 'Status'), ('summary', 'Resumo'), ('priority', 'Prioridade'),
              ('assignee', 'Responsável'), ('parent_key', 'Pai'), ('qa_relationships', 'Vínculos QA'),
              ('jira_fields', 'Campos Jira')]
    anterior, atual = [], []
    def texto(v):
        return json.dumps(v, ensure_ascii=False, sort_keys=True) if isinstance(v, (dict, list)) else str(v if v is not None else 'Não informado')
    for campo, nome in campos:
        if antes.get(campo) != depois.get(campo):
            anterior.append(f'{nome}: {texto(antes.get(campo))}')
            atual.append(f'{nome}: {texto(depois.get(campo))}')
    for campo, nome in [('total', 'Cenários'), ('passed', 'Aprovados'), ('failed', 'Falhados'), ('not_run', 'Não executados'), ('in_progress', 'Em andamento')]:
        a, b = (antes.get('assertthat') or {}).get(campo), (depois.get('assertthat') or {}).get(campo)
        if a != b:
            anterior.append(f'{nome}: {texto(a)}')
            atual.append(f'{nome}: {texto(b)}')
    return ' · '.join(anterior), ' · '.join(atual)


def evento(db, r, versao, key, acao, antes, depois, motivo):
    db.execute('''INSERT INTO sprint_escopo_eventos
        (iteracao_id,ciclo_id,versao,issue_key,acao,antes,depois,motivo,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)''', (r['iteracao_id'], r['id'], versao, key, acao,
                                     antes, depois, motivo, datetime.now(timezone.utc).isoformat()))


def salvar(db, r, estado, versao):
    from app.services.sprint_ativa_storage import _tabela_evolucao, _tabela_snapshot_operacional, _resumo_operacional
    atualizado = datetime.now(timezone.utc).isoformat()
    snapshot = copy.deepcopy(estado['base'])
    snapshot['_qualityhub_escopo'] = True
    snapshot['demandas'] = []
    for item in estado['itens'].values():
        if item['estado'] == 'incluida':
            d = copy.deepcopy(item['demanda'])
            d['_qualityhub_origem_bug'] = item.get('origem_bug')
            snapshot['demandas'].append(d)
    for key, item in estado['itens'].items():
        anterior = item.pop('_estado_antes', item['estado'])
        if anterior != item['estado'] and item['contextual']:
            evento(db, r, versao, key, 'contexto', anterior, item['estado'],
                   'Recalculado pelos vínculos de rastreabilidade das demandas incluídas.')
    db.execute('''INSERT INTO sprint_escopo_estado VALUES (?,?,?,?)
        ON CONFLICT(iteracao_id) DO UPDATE SET versao=excluded.versao,
        dados_json=excluded.dados_json,atualizado_em=excluded.atualizado_em''',
        (r['iteracao_id'], versao, json.dumps(estado, ensure_ascii=False), atualizado))
    _tabela_snapshot_operacional(db)
    _tabela_evolucao(db)
    db.execute('''INSERT INTO sprint_ativa_snapshots_operacionais VALUES (?,?,?)
        ON CONFLICT(ciclo_id) DO UPDATE SET dados_json=excluded.dados_json, atualizado_em=excluded.atualizado_em''',
        (r['id'], json.dumps(snapshot, ensure_ascii=False), atualizado))
    db.execute('INSERT INTO sprint_ativa_evolucao(ciclo_id,atualizado_em,resumo_json) VALUES (?,?,?)',
               (r['id'], atualizado, json.dumps(_resumo_operacional(snapshot), ensure_ascii=False)))
    return atualizado


def resposta(db, r, estado, versao):
    historico = db.execute('''SELECT * FROM sprint_escopo_eventos WHERE iteracao_id=?
        ORDER BY id DESC''', (r['iteracao_id'],)).fetchall()
    baseline = json.loads(r['dados_json'])
    originais = baseline.get('demandas', []) + (baseline.get('contexto', {}).get('demandas_originais') or [])
    ignoradas = {d.get('key') for d in originais if isinstance(d, dict) and not demanda_util(d)} | set(estado.get('_itens_ignorados', []))
    return {'ciclo_id': r['id'], 'versao': versao, 'pendentes': pendencias(estado),
            'editavel': r['status'] == 'ativa' and not r['congelada_em'],
            'itens': list(estado['itens'].values()), 'historico': [dict(e) for e in historico if e['issue_key'] not in ignoradas]}


def consultar(ciclo_id):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        r = registro(db, ciclo_id)
        estado, versao = carregar(db, r)
        armazenado = db.execute('SELECT dados_json FROM sprint_escopo_estado WHERE iteracao_id=?', (r['iteracao_id'],)).fetchone()
        if armazenado and r['status'] == 'ativa' and not r['congelada_em']:
            anterior = json.loads(armazenado['dados_json'])
            if anterior != estado:
                for key, item in estado['itens'].items():
                    antigo = anterior['itens'].get(key, {})
                    if antigo.get('pendencia') == 'ausencia' and item['contextual'] and not item['pendencia']:
                        evento(db, r, versao + 1, key, 'contexto_automatico', 'ausencia', 'incluida', 'História mantida automaticamente pelos vínculos das demandas incluídas.')
                versao += 1
                salvar(db, r, estado, versao)
        return resposta(db, r, estado, versao)


def conferir(versao, esperada):
    if versao != esperada:
        raise HTTPException(409, 'Os dados mudaram. Recarregue a Rastreabilidade e reveja suas decisões.')


def decidir(ciclo_id, esperada, decisoes):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        r = registro(db, ciclo_id, True)
        estado, versao = carregar(db, r)
        conferir(versao, esperada)
        itens = estado['itens']
        if not decisoes or len({d['issue_key'] for d in decisoes}) != len(decisoes):
            raise HTTPException(422, 'Informe decisões sem chaves repetidas.')
        for d in decisoes:
            key, acao = d['issue_key'], d['acao']
            motivo = d.get('motivo', '').strip()
            if key not in itens or (acao not in ('desta_sprint', 'herdado') and not motivo) or len(motivo) > 4000:
                raise HTTPException(422, 'Demanda e justificativa válida são obrigatórias.')
            item = itens[key]
            if acao in ('desta_sprint', 'herdado'):
                if not bug(item['demanda']):
                    raise HTTPException(422, 'Classificação de origem é exclusiva de defeitos.')
                antes = item.get('origem_bug')
                item['origem_bug'] = acao
                db.execute('''INSERT INTO sprint_bug_origem_manual
                    (issue_key,iteracao_id,classificacao,sprints_json,motivo,atualizada_em) VALUES (?,?,?,?,?,?)
                    ON CONFLICT(issue_key,iteracao_id) DO UPDATE SET
                    classificacao=excluded.classificacao,sprints_json=excluded.sprints_json,
                    motivo=excluded.motivo,atualizada_em=excluded.atualizada_em''',
                    (key, r['iteracao_id'], acao, json.dumps(sorted(sprints(r))), motivo, datetime.now(timezone.utc).isoformat()))
                if item['pendencia'] == 'classificar_origem':
                    item['pendencia'] = None
            elif acao in ('incluir', 'excluir', 'manter'):
                antes = item['estado']
                item['estado'] = 'excluida' if acao == 'excluir' else 'incluida'
                item['manual'] = True
                item['contextual'] = False if acao in ('incluir', 'manter') else item['contextual']
                item['ausente_aceita'] = acao == 'manter'
                item['pendencia'] = None
            else:
                raise HTTPException(422, 'Ação inválida.')
            item['motivo'] = motivo
            evento(db, r, versao + 1, key, acao, antes, item.get('origem_bug') if acao in ('desta_sprint', 'herdado') else item['estado'], motivo)
        # Validar exclusões após todas as escolhas; nunca excluir descendentes implicitamente.
        for item in itens.values():
            item['_estado_antes'] = item['estado']
        reconciliar(estado)
        for item in itens.values():
            if item['estado'] == 'excluida' and item.get('requerida_por'):
                raise HTTPException(409, 'Ancestral necessário por ' + ', '.join(item['requerida_por']) + '. Retire primeiro as demandas que justificam esse contexto.')
        salvar(db, r, estado, versao + 1)
        return resposta(db, r, estado, versao + 1)


async def adicionar(ciclo_id, esperada, key, motivo):
    from app.services.issue_lookup import consultar_demanda_jira_service
    if not motivo.strip():
        raise HTTPException(422, 'Informe o motivo da inclusão manual.')
    with conectar_banco() as db:
        r = registro(db, ciclo_id, True)
        _, versao = carregar(db, r)
        conferir(versao, esperada)
    resultado = await consultar_demanda_jira_service(key)
    if resultado.get('traceability', {}).get('complete') is not True:
        raise HTTPException(409, 'Consulta manual incompleta. Nenhum dado foi alterado.')
    raiz = next((d for d in resultado['issues'] if d.get('key') == resultado['root_key']), None)
    if not raiz or not demanda_util(raiz):
        raise HTTPException(422, 'Subtarefas e Spikes não fazem parte do acompanhamento.')
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        r = registro(db, ciclo_id, True)
        estado, versao = carregar(db, r)
        conferir(versao, esperada)
        root = resultado['root_key']
        for d in resultado['issues']:
            if not demanda_util(d):
                continue
            if d['key'] == root or d['key'] not in estado['itens']:
                estado['itens'][d['key']] = {'demanda': d, 'estado': 'incluida', 'manual': d['key'] == root,
                    'contextual': d['key'] != root, 'pendencia': None, 'ausente_aceita': False,
                    'motivo': motivo.strip(), 'origem_bug': classificacao(db, d, r) if bug(d) else None}
        for item in estado['itens'].values():
            item['_estado_antes'] = item['estado']
        reconciliar(estado)
        evento(db, r, versao + 1, root, 'inclusao_manual', None, 'incluida', motivo.strip())
        salvar(db, r, estado, versao + 1)
        return resposta(db, r, estado, versao + 1)


async def sincronizar(ciclo_id):
    from app.services.extraction import extrair_demandas_iteracao_service
    from app.services.issue_lookup import consultar_demanda_jira_service
    with conectar_banco() as db:
        r = registro(db, ciclo_id, True)
        estado, versao = carregar(db, r)
    try:
        inicio, fim = date.fromisoformat(r['data_inicio']), date.fromisoformat(r['data_fim'])
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, 'Período de extração inválido.') from exc
    resultado = await extrair_demandas_iteracao_service(r['project_key'], r['team_name'], inicio, fim,
                                                      json.loads(r['quarters_json'] or '[]'), sorted(sprints(r)))
    if resultado.get('traceability', {}).get('complete') is not True:
        raise HTTPException(409, 'Extração incompleta. Últimos dados válidos preservados.')
    recebidas = resultado.get('issues')
    if not isinstance(recebidas, list) or any(not isinstance(d, dict) or not d.get('key') for d in recebidas):
        raise HTTPException(502, 'Resposta de demandas inválida; dados preservados.')
    if len({d['key'] for d in recebidas}) != len(recebidas):
        raise HTTPException(502, 'Demandas duplicadas; dados preservados.')
    por_chave = {d['key']: d for d in recebidas if demanda_util(d)}
    # Consultar inclusões manuais fora da busca normal, sem apagar ausência/permissão.
    for key, item in estado['itens'].items():
        if item['manual'] and item['estado'] == 'incluida' and key not in por_chave:
            try:
                manual = await consultar_demanda_jira_service(key)
            except HTTPException as exc:
                if exc.status_code not in (403, 404):
                    raise
                continue
            if manual.get('traceability', {}).get('complete') is not True:
                raise HTTPException(409, 'Consulta de inclusão manual incompleta; dados preservados.')
            for d in manual['issues']:
                if demanda_util(d):
                    por_chave.setdefault(d['key'], d)
    eventos = []
    for key, item in estado['itens'].items():
        item['_estado_antes'] = item['estado']
        atual = por_chave.get(key)
        # Ainda encontrada como contexto não significa que permaneceu diretamente na sprint.
        if atual and not item['manual'] and not item['contextual'] and item['demanda'].get('scope') == 'direct' and atual.get('scope') != 'direct':
            if not item.get('ausente_aceita') and item['pendencia'] != 'ausencia':
                item['pendencia'] = 'ausencia'
                eventos.append((key, 'fora_da_sprint', 'direct', atual.get('scope'), 'Retornou apenas por rastreabilidade; último dado aceito preservado até decisão.'))
            continue
        if atual:
            anterior = item['demanda']
            if item['contextual'] and atual.get('scope') == 'direct' and not item['manual']:
                item['contextual'] = False
                if item['estado'] == 'contexto_inativo':
                    item['estado'], item['pendencia'] = 'candidata', 'nova'
                eventos.append((key, 'origem_direta', 'contexto', item['estado'], 'Agora encontrada diretamente na sprint; presença independente dos antigos vínculos.'))
            a = anterior.get('assertthat')
            if isinstance(a, dict) and isinstance(a.get('total'), (int, float)) and item['estado'] == 'incluida':
                if not isinstance(atual.get('assertthat'), dict) or not isinstance(atual['assertthat'].get('total'), (int, float)):
                    raise HTTPException(409, f'AssertThat indisponível para {key}; dados preservados.')
            if item['pendencia'] == 'ausencia':
                item['pendencia'] = None
                eventos.append((key, 'reencontrada', None, None, 'Demanda voltou a ser encontrada.'))
            item['ausente_aceita'] = False
            item['demanda'] = {**anterior, **atual, '_qualityhub_rastreamento': 'rastreada'}
            antes_texto, depois_texto = comparar_dados(anterior, item['demanda'])
            if antes_texto:
                eventos.append((key, 'dados_atualizados', antes_texto, depois_texto, 'Dados Jira e execução atualizados, sem exigir decisão de escopo.'))
        elif item['estado'] == 'incluida' and not item['contextual']:
            item['demanda']['_qualityhub_rastreamento'] = 'nao_encontrada'
            if not item.get('ausente_aceita') and item['pendencia'] != 'ausencia':
                item['pendencia'] = 'ausencia'
                eventos.append((key, 'ausencia', None, None, 'Não retornou na consulta; último snapshot válido preservado.'))
        elif item['estado'] == 'candidata':
            item['estado'], item['pendencia'] = 'retirada_candidata', None
            eventos.append((key, 'candidata_ausente', 'candidata', 'retirada_candidata', 'Candidata deixou de ser encontrada antes da aprovação.'))
    for key, d in por_chave.items():
        if key in estado['itens'] and estado['itens'][key]['estado'] != 'retirada_candidata':
            continue
        contexto = contextual(d)
        automatica = bug(d) or contexto
        estado['itens'][key] = {'demanda': d, 'estado': 'incluida' if automatica else 'candidata',
                               'manual': False, 'contextual': contexto, 'pendencia': None if automatica else 'nova',
                               'ausente_aceita': False, 'motivo': 'Encontrada na atualização', 'origem_bug': None}
        eventos.append((key, 'entrada_automatica' if automatica else 'nova_candidata', None,
                        estado['itens'][key]['estado'], 'Atualização da sprint; escopo sujeito às decisões registradas.'))
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        atual_r = registro(db, ciclo_id, True)
        _, atual_v = carregar(db, atual_r)
        conferir(atual_v, versao)
        for item in estado['itens'].values():
            if bug(item['demanda']):
                item['origem_bug'] = classificacao(db, item['demanda'], atual_r)
        reconciliar(estado)
        # Ausência de associação direta não é pendência de escopo se a US é contexto necessário.
        resolvidas = {k for k, i in estado['itens'].items() if i['contextual'] and i['estado'] == 'incluida' and i['requerida_por']}
        eventos = [(k, 'contexto_automatico', antes, 'incluida', 'História mantida automaticamente pelas demandas incluídas.') if k in resolvidas and acao in {'ausencia', 'fora_da_sprint'} else (k, acao, antes, depois, motivo) for k, acao, antes, depois, motivo in eventos]
        for e in eventos:
            evento(db, atual_r, versao + 1, *e)
        evento(db, atual_r, versao + 1, None, 'sincronizacao', None, None, 'Atualização concluída; decisões anteriores preservadas.')
        atualizado = salvar(db, atual_r, estado, versao + 1)
        return {'status': 'atualizado', 'atualizado_em': atualizado,
                'total_demandas': sum(i['estado'] == 'incluida' for i in estado['itens'].values()),
                'pendentes': pendencias(estado), 'versao': versao + 1}
