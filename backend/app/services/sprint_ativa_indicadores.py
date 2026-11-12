"""Indicadores baseados exclusivamente na revisão consolidada de uma sprint."""
import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import unicodedata
from fastapi import HTTPException
from app.core.database import conectar_banco
from app.services.sprint_ativa_storage import obter_dados_operacionais
from app.services.sprint_rollover import resumir_rollover


def _tipo(valor):
    texto = unicodedata.normalize('NFKD', str(valor or '').strip().lower())
    return ''.join(c for c in texto if not unicodedata.combining(c))


def _numero(valor):
    return max(0, valor) if isinstance(valor, (int, float)) and not isinstance(valor, bool) else 0


def obter_indicadores(ciclo_id: str):
    with conectar_banco() as db:
        registro = db.execute('''
            SELECT c.id AS ciclo_id, c.iteracao_id, c.numero_ciclo, c.status AS ciclo_status,
                   c.ativada_em, c.concluida_em, i.project_key, i.team_name,
                   i.sprint_name, i.data_inicio, i.data_fim, i.sprints_json, i.sprint_id,
                   cr.consolidada_em, cr.decisoes_json, cr.ressalvas_json,
                   s.dados_json, s.versao AS sincronizacao_versao
            FROM sprint_ativa_ciclos c
            JOIN iteracoes i ON i.id = c.iteracao_id
            LEFT JOIN consolidacoes_revisao cr ON cr.iteracao_id = i.id
            LEFT JOIN sincronizacoes s ON s.id = cr.sincronizacao_id
            WHERE c.id = ?
        ''', (ciclo_id,)).fetchone()
    if registro is None:
        raise HTTPException(404, 'Ciclo não encontrado.')
    if registro['dados_json'] is None or registro['decisoes_json'] is None:
        raise HTTPException(409, 'A sprint não possui dados consolidados para indicadores.')

    with conectar_banco() as db:
        dados, atualizado_em, origem = obter_dados_operacionais(db, ciclo_id, registro['dados_json'])
    decisoes = json.loads(registro['decisoes_json'])
    excluidas = {d['issue_key'] for d in decisoes if d.get('decisao') == 'exclude'}
    if dados.get('_qualityhub_escopo'):
        excluidas = set()  # Escopo operacional já incorpora decisões posteriores.
    demandas = [d for d in dados.get('demandas', []) if isinstance(d, dict) and d.get('key') not in excluidas]
    historias = [d for d in demandas if _tipo(d.get('issue_type')) in ('historia', 'story', 'user story')]
    planos = [d for d in demandas if _tipo(d.get('issue_type')) in ('assertthat test plan', 'test plan', 'testplan', 'tp')]
    bugs = [d for d in demandas if _tipo(d.get('issue_type')) in ('bug', 'sub-bug', 'sub bug', 'subbug')]
    epicos = [d for d in demandas if _tipo(d.get('issue_type')) in ('epic', 'epico')]
    # Métricas de origem: o campo sprints é histórico, não representa
    # necessariamente defeitos criados ou carregados nesta sprint.
    sprint_ids = {str(s) for s in (json.loads(registro['sprints_json'] or '[]') or ([registro['sprint_id']] if registro['sprint_id'] else []))}
    def _data(valor):
        if not valor:
            return None
        try:
            instante = datetime.fromisoformat(str(valor).replace('Z', '+00:00'))
            if instante.tzinfo is None:
                instante = instante.replace(tzinfo=ZoneInfo('America/Sao_Paulo'))
            return instante.astimezone(timezone.utc)
        except (ValueError, TypeError):
            return None
    inicio = _data(registro['data_inicio'])
    fim = _data(registro['data_fim'])
    fim = fim + timedelta(days=1) if fim else None
    def _no_periodo(valor):
        instante = _data(valor)
        return bool(instante and inicio and fim and inicio <= instante < fim)
    def _ciclo(b):
        return b.get('bug_lifecycle') if isinstance(b.get('bug_lifecycle'), dict) else {}
    from app.services.sprint_rastreabilidade import registro as ler_registro, classificacao, tabelas
    with conectar_banco() as db:
        tabelas(db)
        contexto = ler_registro(db, ciclo_id)
        classes = {b['key']: b.get('_qualityhub_origem_bug') or classificacao(db, b, contexto) for b in bugs}
    bugs_associados = bugs
    bugs_originados = [b for b in bugs if classes[b['key']] == 'desta_sprint']
    bugs_carregados = [b for b in bugs if classes[b['key']] == 'herdado']
    bugs_origem_indeterminada = [b for b in bugs if not classes[b['key']]]
    def _resolvido(b):
        if _tipo(b.get('status')) != 'concluido':
            return False
        c = _ciclo(b)
        sid = c.get('resolution_sprint_id')
        return bool(str(sid) in sprint_ids) if sprint_ids and sid else _no_periodo(c.get('last_resolved_at') or b.get('resolved'))
    bugs_resolvidos = [b for b in bugs if _resolvido(b)]
    com_dados = [p for p in planos if isinstance(p.get('assertthat'), dict) and isinstance(p['assertthat'].get('total'), (int, float))]
    campos = ('total', 'passed', 'failed', 'not_run', 'in_progress', 'automated', 'manual')
    execucao = {campo: sum(_numero(p['assertthat'].get(campo)) for p in com_dados) for campo in campos}

    def relacoes(demanda):
        return demanda.get('qa_relationships') or []

    historias_com_plano = sum(any(
        any(isinstance(r, dict) and r.get('relationship') == 'test_plan' and r.get('key') == plano.get('key') for r in relacoes(historia))
        or any(isinstance(r, dict) and r.get('relationship') == 'tests_story' and r.get('key') == historia.get('key') for r in relacoes(plano))
        for plano in planos
    ) for historia in historias)
    por_status = {}
    for bug in bugs:
        status = str(bug.get('status') or '').strip() or 'Sem status'
        por_status[status] = por_status.get(status, 0) + 1

    # Distribuições da qualidade calculadas somente sobre os bugs incluídos no escopo.
    por_categoria = {}
    por_causa = {}
    por_prioridade = {}
    dados_sla = []
    for bug in bugs:
        categorias = bug.get('categories') or []
        if isinstance(categorias, str):
            categorias = [categorias]
        categorias = sorted({str(c).strip() for c in categorias if isinstance(c, str) and c.strip()}) if isinstance(categorias, list) else []
        for categoria in categorias or ['Sem categoria']:
            por_categoria[categoria] = por_categoria.get(categoria, 0) + 1
        campos_jira = bug.get('jira_fields') if isinstance(bug.get('jira_fields'), dict) else {}
        causa = campos_jira.get('root_cause')
        if isinstance(causa, dict):
            causa = causa.get('value') or causa.get('name')
        if isinstance(causa, list):
            causa = ', '.join(str(v) for v in causa if v)
        causa = str(causa).strip() if causa is not None else ''
        causa = causa or 'Sem causa raiz'
        por_causa[causa] = por_causa.get(causa, 0) + 1
        prioridade = str(bug.get('priority') or '').strip() or 'Sem prioridade'
        por_prioridade[prioridade] = por_prioridade.get(prioridade, 0) + 1
        dados_sla.append({
            'issue_key': bug.get('key'),
            'resumo': bug.get('summary'),
            'responsavel': bug.get('assignee'),
            'relator': bug.get('reporter'),
            'relator_account_id': bug.get('reporter_account_id'),
            'causa_raiz': causa,
            'origem': classes.get(bug.get('key')),
            'url': bug.get('url'),
            'prioridade': bug.get('priority'),
            'criacao': bug.get('created'),
            'resolucao': bug.get('resolved'),
            'status': bug.get('status'),
        })

    total = execucao['total']
    concluidos = max(0, total - execucao['not_run'] - execucao['in_progress'])
    return {
        'ciclo': {campo: registro[campo] for campo in ('ciclo_id', 'iteracao_id', 'numero_ciclo', 'ciclo_status', 'ativada_em', 'concluida_em')},
        'contexto': {**{campo: registro[campo] for campo in ('project_key', 'team_name', 'sprint_name', 'data_inicio', 'data_fim', 'consolidada_em', 'sincronizacao_versao')}, 'atualizado_em': atualizado_em},
        'escopo': {'demandas': len(demandas), 'excluidas': len(excluidas), 'epicos': len(epicos), 'historias': len(historias), 'test_plans': len(planos), 'bugs': len(bugs), 'bugs_associados': len(bugs_associados)},
        'cobertura': {'historias_com_plano': historias_com_plano, 'historias_sem_plano': len(historias) - historias_com_plano, 'planos_com_dados': len(com_dados), 'planos_sem_dados': len(planos) - len(com_dados)},
        'execucao': {**execucao, 'concluidos': concluidos, 'percentual_execucao': round(concluidos / total * 100, 1) if total else None},
        'defeitos': {'total': len(bugs), 'originados': len(bugs_originados), 'resolvidos': len(bugs_resolvidos), 'carregados': len(bugs_carregados), 'herdados': len(bugs_carregados), 'associados': len(bugs_associados), 'origem_indeterminada': len(bugs_origem_indeterminada), 'por_status': dict(sorted(por_status.items())),
                     'por_categoria': dict(sorted(por_categoria.items())),
                     'por_causa_raiz': dict(sorted(por_causa.items())),
                     'por_prioridade': dict(sorted(por_prioridade.items())),
                     'dados_sla': dados_sla},
        'rollover': resumir_rollover(demandas, sprint_ids, registro['sprint_name']),
        'ressalvas': json.loads(registro['ressalvas_json'] or '[]'),
        'origem': origem,
    }
