"""Ocorrências objetivas derivadas da consolidação, sem alterar decisões do QA."""
import json
from fastapi import HTTPException
from app.core.database import conectar_banco
from app.services.sprint_ativa_storage import obter_dados_operacionais
from app.services.sprint_ativa_indicadores import _tipo, _numero


def obter_atencoes(ciclo_id: str):
    with conectar_banco() as db:
        r = db.execute("""SELECT cr.decisoes_json, s.dados_json, cr.consolidada_em
          FROM sprint_ativa_ciclos c
          JOIN consolidacoes_revisao cr ON cr.iteracao_id = c.iteracao_id
          JOIN sincronizacoes s ON s.id = cr.sincronizacao_id
          WHERE c.id = ?""", (ciclo_id,)).fetchone()
    if r is None or not r['dados_json'] or not r['decisoes_json']:
        raise HTTPException(409, 'A sprint não possui dados consolidados para análise.')
    with conectar_banco() as db:
        dados, atualizado_em, origem = obter_dados_operacionais(db, ciclo_id, r['dados_json'])
    excluidas = {d.get('issue_key') for d in json.loads(r['decisoes_json']) if d.get('decisao') == 'exclude'}
    if dados.get('_qualityhub_escopo'):
        excluidas = set()
    demandas = [d for d in dados.get('demandas', []) if isinstance(d, dict) and d.get('key') not in excluidas]
    historias = [d for d in demandas if _tipo(d.get('issue_type')) in ('historia', 'story', 'user story')]
    planos = [d for d in demandas if _tipo(d.get('issue_type')) in ('assertthat test plan', 'test plan', 'testplan', 'tp')]
    bugs = [d for d in demandas if _tipo(d.get('issue_type')) in ('bug', 'sub-bug', 'sub bug', 'subbug')]
    def relacoes(d):
        return d.get('qa_relationships') or []
    def relacionado(d, tipo, chave):
        return any(isinstance(v, dict) and v.get('relationship') == tipo and v.get('key') == chave for v in relacoes(d))
    ocorrencias = []
    encerrados = {'closed', 'done', 'resolved', 'cancelled', 'canceled', 'fechado', 'concluido', 'resolvido', 'cancelado', 'encerrado'}
    cancelados = {'cancelled', 'canceled', 'cancelado'}
    def contexto(d):
        resultado = []
        for rel in relacoes(d):
            if isinstance(rel, dict) and rel.get('key'):
                resultado.append({'chave': str(rel['key']), 'relacao': str(rel.get('relationship') or 'relacionado')})
        return resultado[:30]

    def adicionar(tipo, gravidade, demanda, motivo, quantidade=None):
        chave = str(demanda.get('key') or '')
        if not chave:
            return
        ocorrencias.append({'id': f'{tipo}:{chave}', 'tipo': tipo, 'gravidade': gravidade,
                            'issue_key': chave, 'url': demanda.get('url'), 'titulo': str(demanda.get('summary') or demanda.get('title') or chave),
                            'status': str(demanda.get('status') or 'Sem status'), 'motivo': motivo,
                            'quantidade': quantidade, 'relacionamentos': contexto(demanda),
                            'orientacao': {'acao': 'Investigar e acompanhar', 'verificar': 'Conferir contexto e vínculos', 'informativo': 'Somente contexto; sem ação imediata'}.get(gravidade, 'Conferir dados')})
    for h in historias:
        if not any(relacionado(h, 'test_plan', p.get('key')) or relacionado(p, 'tests_story', h.get('key')) for p in planos):
            status = _tipo(h.get('status'))
            gravidade = 'informativo' if status in encerrados else 'verificar'
            motivo = ('História encerrada/cancelada sem vínculo explícito com Test Plan; registro de rastreabilidade, sem pendência operacional automática.'
                      if status in encerrados else 'Sem vínculo explícito com Test Plan no escopo consolidado; verificar necessidade de cobertura.')
            adicionar('historia_sem_plano', gravidade, h, motivo)
    for p in planos:
        a = p.get('assertthat')
        if not isinstance(a, dict) or not isinstance(a.get('total'), (int, float)):
            adicionar('plano_sem_dados', 'verificar', p, 'Indicadores de execução do AssertThat indisponíveis.')
        elif _numero(a.get('failed')) > 0:
            n = _numero(a.get('failed'))
            adicionar('testes_falhados', 'informativo' if _tipo(p.get('status')) in cancelados else 'acao', p, f'{n:g} teste(s) falhado(s) no Test Plan; verificar execução e contexto.', n)
    # Status não encerrado requer confirmação, não implica bug ativo automaticamente.
    for b in bugs:
        status = _tipo(b.get('status'))
        if status and status not in encerrados:
            adicionar('bug_a_verificar', 'verificar', b, 'Status não classificado como encerrado; confirmar se requer acompanhamento.')
    ordem = {'acao': 0, 'verificar': 1, 'informativo': 2}
    ocorrencias.sort(key=lambda x: (ordem[x['gravidade']], x['tipo'], x['issue_key']))
    tipos = ('historia_sem_plano', 'testes_falhados', 'plano_sem_dados', 'bug_a_verificar')
    return {'origem': origem, 'atualizado_em': atualizado_em, 'consolidada_em': r['consolidada_em'],
            'total': len(ocorrencias), 'por_tipo': {t: sum(o['tipo'] == t for o in ocorrencias) for t in tipos},
            'por_gravidade': {g: sum(o['gravidade'] == g for o in ocorrencias) for g in ordem},
            'ocorrencias': ocorrencias,
            'nota': 'Ocorrências para investigação; não são confirmações automáticas de falha de qualidade ou bug aberto.'}
