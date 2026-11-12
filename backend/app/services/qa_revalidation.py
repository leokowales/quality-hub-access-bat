"""Revalidação seletiva de QA: impactos, descoberta Jira e recomposição do snapshot.

A descoberta cobre os projetos das Histórias conhecidas, não todos os projetos Jira.
A integridade global da rastreabilidade não é certificada por este módulo.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.core.credentials import obter_credenciais_jira
from app.services.extraction import (
    TIPOS_HISTORIA, TIPOS_TP, _classificar_revisao,
    _formatar_issue, _referencias_resumo,
)
from app.services.issue_lookup import consultar_demanda_jira_service
from app.services.jira_fields import campos_adicionais
from app.services.jira_http import get_jira_com_retry


def _identificadores_relacoes(demanda: dict[str, Any]) -> set[tuple[str, str, str]]:
    resultado = set()
    for relacao in demanda.get("relationships") or []:
        if not isinstance(relacao, dict):
            continue
        destino = relacao.get("destino")
        tipo = relacao.get("tipo")
        direcao = relacao.get("direcao")
        if destino and tipo:
            resultado.add((str(destino), str(tipo), str(direcao or "")))
    return resultado

def identificar_impactos_qa(
    anteriores: dict[str, dict],
    atualizadas: dict[str, dict],
    chaves_atualizadas: list[str],
) -> dict[str, Any]:
    """Compara relações diretas e identifica issues afetadas no snapshot.

    Não remove qa_relationships e não muda decisões manuais.
    """
    alteracoes = []
    afetadas = set(chaves_atualizadas)
    for chave in chaves_atualizadas:
        antes = anteriores[chave]
        depois = atualizadas[chave]
        pai_antes = antes.get("parent_key")
        pai_depois = depois.get("parent_key")
        rel_antes = _identificadores_relacoes(antes)
        rel_depois = _identificadores_relacoes(depois)
        removidas = sorted(rel_antes - rel_depois)
        adicionadas = sorted(rel_depois - rel_antes)
        mudou = (
            pai_antes != pai_depois
            or bool(removidas or adicionadas)
            or antes.get("summary") != depois.get("summary")
            or antes.get("issue_type") != depois.get("issue_type")
        )
        if mudou:
            afetadas.update(
                key for key in (pai_antes, pai_depois) if key in anteriores
            )
            afetadas.update(
                key for key, _, _ in (rel_antes | rel_depois)
                if key in anteriores
            )
            alteracoes.append({
                "issue_key": chave,
                "parent_anterior": pai_antes,
                "parent_atual": pai_depois,
                "relacoes_adicionadas": [
                    {"destino": k, "tipo": t, "direcao": d}
                    for k, t, d in adicionadas
                ],
                "relacoes_removidas": [
                    {"destino": k, "tipo": t, "direcao": d}
                    for k, t, d in removidas
                ],
            })
    # Fecha transitivamente o conjunto de pontas QA conhecidas.
    while True:
        tamanho = len(afetadas)
        for chave, demanda in anteriores.items():
            for vinculo in demanda.get("qa_relationships") or []:
                if not isinstance(vinculo, dict):
                    continue
                destino = vinculo.get("key")
                if chave in afetadas or destino in afetadas:
                    afetadas.add(chave)
                    if destino in anteriores:
                        afetadas.add(destino)
        if len(afetadas) == tamanho:
            break
    return {
        "alteracoes": alteracoes,
        "chaves_afetadas": sorted(afetadas),
        "vinculos_alterados": bool(alteracoes),
        "revalidacao_integral_concluida": False,
    }

def reconstruir_vinculos_snapshot(demandas: list[dict]) -> dict[str, list[dict]]:
    por_chave = {item['key']: item for item in demandas}
    if len(por_chave) != len(demandas):
        raise ValueError('Snapshot com chaves duplicadas.')

    historias = {
        chave for chave, item in por_chave.items()
        if str(item.get('issue_type') or '').strip().casefold() in TIPOS_HISTORIA
    }
    tps = {
        chave for chave, item in por_chave.items()
        if str(item.get('issue_type') or '').strip().casefold() in TIPOS_TP
    }
    fontes = defaultdict(set)

    def registrar(historia: str, tp: str, origem: str) -> None:
        if historia in historias and tp in tps:
            fontes[(historia, tp)].add(origem)

    for tp in tps:
        item = por_chave[tp]
        registrar(item.get('parent_key'), tp, 'parent')
        for historia in _referencias_resumo(item.get('summary') or ''):
            registrar(historia, tp, 'summary')
        for relacao in item.get('relationships') or []:
            if isinstance(relacao, dict) and relacao.get('tipo') != 'parent':
                registrar(relacao.get('destino'), tp, 'issuelinks')

    for historia in historias:
        for relacao in por_chave[historia].get('relationships') or []:
            if isinstance(relacao, dict) and relacao.get('tipo') != 'parent':
                registrar(historia, relacao.get('destino'), 'issuelinks')

    resultado = {chave: [] for chave in por_chave}
    for (historia, tp), origens in sorted(fontes.items()):
        resultado[historia].append({
            'key': tp, 'relationship': 'test_plan', 'sources': sorted(origens)
        })
        resultado[tp].append({
            'key': historia, 'relationship': 'tests_story', 'sources': sorted(origens)
        })
    return resultado

def _referencia_historia(tp: dict, historias: set[str]) -> bool:
    if tp.get('parent_key') in historias:
        return True
    if _referencias_resumo(tp.get('summary') or '') & historias:
        return True
    return any(
        isinstance(r, dict) and r.get('tipo') != 'parent'
        and r.get('destino') in historias
        for r in tp.get('relationships') or []
    )

async def descobrir_tps_externos(demandas_por_chave: dict[str, dict]) -> dict:
    """Retorna TPs formatados relevantes, inclusive já existentes no snapshot.

    Pesquisa TPs em todos os projetos das Histórias conhecidas, como faz a
    extração original para um projeto. Não modifica o snapshot.
    """
    historias = {
        chave for chave, item in demandas_por_chave.items()
        if str(item.get('issue_type') or '').strip().casefold() in TIPOS_HISTORIA
    }
    if not historias:
        return {'test_plans': {}, 'projetos_consultados': [], 'total_examinados': 0}
    projetos = sorted({chave.split('-', 1)[0] for chave in historias})
    url, email, token = obter_credenciais_jira()
    url = url.rstrip('/')
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise HTTPException(status_code=500, detail='URL Jira Cloud salva inválida.')

    async def get(client, path, params=None):
        resposta = await get_jira_com_retry(
            client,
            f'{url}{path}', params=params, auth=(email, token),
            headers={'Accept': 'application/json'},
        )
        if resposta.status_code in (401, 403):
            raise HTTPException(status_code=403, detail='Sem autenticação ou permissão no Jira.')
        if resposta.status_code != 200:
            raise HTTPException(status_code=502, detail=f'Erro Jira HTTP {resposta.status_code}: {resposta.text[:200]}')
        return resposta.json()

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            campos = await get(client, '/rest/api/3/field')
            sprint_fields = [c for c in campos if c.get('name', '').strip().casefold() == 'sprint']
            quarter_fields = [c for c in campos if c.get('name', '').strip().casefold() in ('quarter', 'trimestre')]
            solicitados = list(dict.fromkeys([
                'summary', 'status', 'issuetype', 'priority', 'assignee',
                'created', 'updated', 'parent', 'issuelinks',
                *campos_adicionais(campos),
                *(c['id'] for c in sprint_fields + quarter_fields),
            ]))
            encontrados = {}
            examinados = 0
            for projeto in projetos:
                pagina_token = None
                tokens_vistos = set()
                while True:
                    params = {
                        'jql': f'project = "{projeto}" AND issuetype = "AssertThat Test Plan" ORDER BY key ASC',
                        'fields': ','.join(solicitados),
                        'properties': 'assertthat-scenarios',
                        'maxResults': 100,
                    }
                    if pagina_token:
                        params['nextPageToken'] = pagina_token
                    pagina = await get(client, '/rest/api/3/search/jql', params)
                    issues = pagina.get('issues')
                    if not isinstance(issues, list):
                        raise HTTPException(status_code=502, detail='Jira retornou página de Test Plans inválida.')
                    for issue in issues:
                        examinados += 1
                        tipo = str(((issue.get('fields') or {}).get('issuetype') or {}).get('name') or '').strip().casefold()
                        if tipo not in TIPOS_TP:
                            continue
                        tp = _formatar_issue(issue, url, sprint_fields, quarter_fields)
                        if tp.get('key') and _referencia_historia(tp, historias):
                            encontrados[tp['key']] = tp
                    if pagina.get('isLast') is True:
                        break
                    proximo = pagina.get('nextPageToken')
                    if not proximo or proximo == pagina_token or proximo in tokens_vistos:
                        raise HTTPException(status_code=502, detail='Paginação de Test Plans incompleta; snapshot preservado.')
                    tokens_vistos.add(proximo)
                    pagina_token = proximo
            return {
                'test_plans': encontrados,
                'projetos_consultados': projetos,
                'total_examinados': examinados,
            }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail='Consulta de Test Plans excedeu o tempo limite; snapshot preservado.')
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail='Falha de conexão ao consultar Test Plans; snapshot preservado.')
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(status_code=502, detail='Resposta inesperada na consulta de Test Plans; snapshot preservado.')

async def revalidar_qa_snapshot(
    demandas_por_chave: dict[str, dict],
    chaves_afetadas: list[str],
    sprints: list[str],
    quarters: list[str],
    chaves_ja_consultadas: list[str] | None = None,
) -> dict:
    """Reconsulta as pontas conhecidas e recalcula vínculos e recomendações.

    Atualiza o dicionário em memória. O chamador só deve persistir ao concluir.
    """
    ja_consultadas = set(chaves_ja_consultadas or [])
    afetadas = set(chaves_afetadas) & set(demandas_por_chave)

    for chave in sorted(afetadas - ja_consultadas):
        resultado = await consultar_demanda_jira_service(chave, apenas_demanda=True)
        if (resultado.get('traceability') or {}).get('complete') is not True:
            raise HTTPException(409, f'Consulta QA incompleta para {chave}. Snapshot preservado.')
        item = next((i for i in resultado.get('issues', []) if i.get('key') == chave), None)
        if item is None:
            raise HTTPException(502, f'Jira não retornou {chave} durante a revalidação.')
        anterior = demandas_por_chave[chave]
        for campo, valor in item.items():
            if campo not in {'key', 'scope', 'inclusion_reasons', 'inclusion_sources',
                             'qa_relationships', 'review', 'included_in_metrics'}:
                anterior[campo] = valor

    # Descobre TPs ainda ausentes do snapshot (inclusive por resumo e links inversos).
    # Consulta completa e paginada: falhas interrompem antes da persistência.
    descoberta = await descobrir_tps_externos(demandas_por_chave)
    novos_tps = []
    tps_atualizados = set()
    for chave, tp in descoberta['test_plans'].items():
        if chave not in demandas_por_chave:
            novo = dict(tp)
            novo['scope'] = 'traceability'
            novo['inclusion_reasons'] = ['qa_test_plan']
            novo['inclusion_sources'] = []
            novo['qa_relationships'] = []
            novo['review'] = {
                'eligible': None, 'recommendation': 'review', 'alerts': [],
                'decision': 'pending', 'decision_source': None,
            }
            novo['included_in_metrics'] = False
            demandas_por_chave[chave] = novo
            novos_tps.append(chave)
        else:
            tps_atualizados.add(chave)
            atual = demandas_por_chave[chave]
            for campo, valor in tp.items():
                if campo not in {'key', 'scope', 'inclusion_reasons', 'inclusion_sources',
                                 'qa_relationships', 'review', 'included_in_metrics'}:
                    atual[campo] = valor

    # Reconstrói a relação em ambas as pontas, usando todas as issues conhecidas.
    vinculos = reconstruir_vinculos_snapshot(list(demandas_por_chave.values()))
    alteradas = set(afetadas) | set(novos_tps) | tps_atualizados
    for chave, demanda in demandas_por_chave.items():
        if demanda.get('qa_relationships', []) != vinculos[chave]:
            alteradas.add(chave)
        demanda['qa_relationships'] = vinculos[chave]

    # Mesma regra da extração completa: raízes diretas + descendentes estruturais.
    vinculadas = {
        chave for chave, demanda in demandas_por_chave.items()
        if demanda.get('scope') == 'direct'
    }
    while True:
        novos = {
            chave for chave, demanda in demandas_por_chave.items()
            if demanda.get('parent_key') in vinculadas
        } - vinculadas
        if not novos:
            break
        vinculadas.update(novos)

    for chave in alteradas:
        demanda = demandas_por_chave[chave]
        classificacao = _classificar_revisao(
            demanda, quarters, sprints, chave in vinculadas
        )
        revisao = dict(demanda.get('review') or {})
        revisao.update(classificacao)
        # decision e decision_source não são sobrescritos.
        demanda['review'] = revisao

    return {
        'revalidacao_escopo_consultado_concluida': True,
        'chaves_reconsultadas_qa': sorted(afetadas - ja_consultadas),
        'chaves_reclassificadas': sorted(alteradas),
        'vinculos_snapshot_reconstruidos': True,
        'test_plans_descobertos': sorted(novos_tps),
        'test_plans_examinados': descoberta['total_examinados'],
        'projetos_consultados': descoberta['projetos_consultados'],
        'revalidacao_integral_concluida': False,
        'limitacao': 'Test Plans dos projetos das Histórias foram examinados; outras formas de rastreabilidade e projetos externos não foram certificados.',
    }
