"""Open scoped items whose origin is outside the current sprint or unknown."""
from datetime import datetime
import unicodedata


def _tipo(valor):
    texto = unicodedata.normalize('NFKD', str(valor or '').strip().lower())
    return ''.join(c for c in texto if not unicodedata.combining(c))


def _data(valor):
    try:
        return datetime.fromisoformat(str(valor).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, OverflowError):
        return None


def resumir_rollover(demandas, sprint_ids, sprint_nome):
    itens = []
    sem_historico = 0
    inconsistentes = 0
    tipos = {'bug': 'Bug', 'sub-bug': 'Sub-bug', 'sub bug': 'Sub-bug', 'subbug': 'Sub-bug',
             'assertthat test plan': 'TP', 'test plan': 'TP', 'testplan': 'TP', 'tp': 'TP'}
    for demanda in demandas:
        tipo = tipos.get(_tipo(demanda.get('issue_type')))
        if not tipo:
            continue
        if _tipo(demanda.get('status')) in {'concluido', 'concluida', 'done', 'closed', 'resolved',
                                                 'cancelado', 'cancelada', 'canceled', 'cancelled'}:
            continue
        ciclo = demanda.get('rollover_lifecycle') or demanda.get('bug_lifecycle') or {}
        origem = ciclo.get('origin_sprint_id')
        if origem is not None and str(origem) in sprint_ids:
            continue
        metadados = {}
        extras = (demanda.get('jira_fields') or {}).get('sprint') or []
        for sprint in [*(demanda.get('sprints') or []), *(extras if isinstance(extras, list) else [])]:
            if isinstance(sprint, dict) and sprint.get('id') is not None:
                sid = str(sprint['id'])
                metadados[sid] = {**metadados.get(sid, {}), **sprint}
        destinos = set(metadados).intersection(sprint_ids)
        if not metadados and demanda.get('scope') == 'direct':
            destinos = set(sprint_ids)
        if not destinos:
            continue
        # One item per cycle, even when the cycle has several selected sprints.
        destino_atual = max(destinos, key=lambda sid: (_data(metadados.get(sid, {}).get('startDate')) or 0, sid))
        carregadas = {str(sid) for sid in ciclo.get('carried_sprint_ids', [])}
        # Count only carries up to the current target; future associations are excluded.
        for destino in [destino_atual]:
            inicio = _data(metadados.get(destino, {}).get('startDate'))
            inicio_origem = _data(metadados.get(str(origem), {}).get('startDate'))
            encerramento = _data(metadados.get(destino, {}).get('completeDate'))
            criacao = _data(demanda.get('created'))
            # An association with an older sprint cannot transport an item backwards.
            origem_posterior = inicio is not None and inicio_origem is not None and inicio_origem > inicio
            criado_apos_encerramento = encerramento is not None and criacao is not None and criacao > encerramento
            if origem_posterior or criado_apos_encerramento:
                inconsistentes += 1
                continue

            datas = {sid: _data(metadados.get(sid, {}).get('startDate')) for sid in carregadas}
            quantidade = sum(data <= inicio for data in datas.values()) if ciclo.get('history_complete') is True and destino in carregadas and inicio is not None and all(data is not None for data in datas.values()) else None
            nome_origem = (metadados.get(str(origem), {}).get('name') or f'Sprint {origem}') if origem is not None else 'N\u00e3o informada'
            if origem is None or quantidade is None:
                sem_historico += 1
            nome_destino = metadados.get(destino, {}).get('name') or sprint_nome
            itens.append({'issue_key': demanda.get('key'), 'tipo': tipo, 'status': demanda.get('status'),
                          'url': demanda.get('url'), 'resumo': demanda.get('summary'),
                          'vezes_carregado': quantidade, 'sprint_origem': nome_origem,
                          'sprint_atual': nome_destino, 'sprint_atual_id': destino})
    itens.sort(key=lambda item: (0 if item['tipo'] != 'TP' else 1, -(item['vezes_carregado'] or 0), item['issue_key'] or '', item['sprint_atual_id']))
    return {'itens': itens, 'sem_historico': sem_historico, 'total': len(itens), 'inconsistentes': inconsistentes}
