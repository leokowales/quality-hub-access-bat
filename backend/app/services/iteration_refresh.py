
import json
from datetime import date

from fastapi import HTTPException

from app.services.extraction import extrair_demandas_iteracao_service
from app.services.iteration_storage import obter_iteracao
from app.services.synchronization_storage import (
    obter_ultima_sincronizacao,
    salvar_sincronizacao,
)
from app.services.issue_lookup import consultar_demanda_jira_service
from app.services.qa_revalidation import (
    identificar_impactos_qa,
    revalidar_qa_snapshot,
)


def _ler_lista_json(valor, nome):
    if not valor:
        return []

    try:
        resultado = json.loads(valor)
    except (TypeError, ValueError) as erro:
        raise HTTPException(
            status_code=422,
            detail=f"Configuração inválida: {nome}.",
        ) from erro

    if not isinstance(resultado, list):
        raise HTTPException(
            status_code=422,
            detail=f"Configuração inválida: {nome}.",
        )

    return resultado


async def atualizar_todas_demandas_service(iteracao_id: str):
    iteracao = obter_iteracao(iteracao_id)

    if iteracao["status"] == "consolidada":
        raise HTTPException(
            status_code=409,
            detail="Não é possível atualizar uma iteração consolidada.",
        )

    # A atualização exige um snapshot inicial existente.
    anterior = obter_ultima_sincronizacao(iteracao_id)
    dados_anteriores = anterior["dados"]

    if not iteracao["data_inicio"] or not iteracao["data_fim"]:
        raise HTTPException(
            status_code=422,
            detail="A iteração não possui período configurado.",
        )

    try:
        inicio = date.fromisoformat(iteracao["data_inicio"])
        fim = date.fromisoformat(iteracao["data_fim"])
    except (TypeError, ValueError) as erro:
        raise HTTPException(
            status_code=422,
            detail="O período da iteração é inválido.",
        ) from erro

    sprints = _ler_lista_json(
        iteracao["sprints_json"],
        "sprints",
    )
    quarters = _ler_lista_json(
        iteracao["quarters_json"],
        "quarters",
    )

    if not sprints and iteracao["sprint_id"]:
        sprints = [iteracao["sprint_id"]]

    # Reutiliza a extração completa existente.
    resultado = await extrair_demandas_iteracao_service(
        project_key=iteracao["project_key"],
        team_name=iteracao["team_name"],
        start_date=inicio,
        end_date=fim,
        quarters=quarters,
        sprint_ids=sprints,
    )

    demandas = resultado["issues"]

    # Uma resposta sem demandas não substitui silenciosamente
    # um snapshot que anteriormente possuía dados.
    if not demandas and dados_anteriores.get("demandas"):
        raise HTTPException(
            status_code=409,
            detail=(
                "A extração retornou zero demandas. "
                "A sincronização anterior foi preservada."
            ),
        )

    chaves = [
        demanda.get("key")
        for demanda in demandas
    ]

    if any(not chave for chave in chaves):
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou demandas sem chave.",
        )

    if len(chaves) != len(set(chaves)):
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou demandas duplicadas.",
        )

    # As decisões manuais ficam em tabela independente.
    # Não são regravadas pela sincronização.
    sincronizacao = salvar_sincronizacao(
        iteracao_id=iteracao_id,
        demandas=demandas,
        contexto=dados_anteriores.get("contexto") or {},
        rastreabilidade=resultado.get("traceability") or {},
        demandas_excluidas=dados_anteriores.get(
            "demandas_excluidas"
        ) or [],
    )

    return {
        **sincronizacao,
        "modalidade": "all",
        "total_demandas": len(demandas),
        "total_diretas": resultado.get("total_direct", 0),
        "total_rastreabilidade": resultado.get(
            "total_traceability", 0
        ),
        "rastreabilidade_completa": (
            resultado.get("traceability") or {}
        ).get("complete", False),
    }

async def atualizar_pendentes_service(
    iteracao_id: str,
    issue_keys: list[str],
):
    iteracao = obter_iteracao(iteracao_id)

    if iteracao["status"] == "consolidada":
        raise HTTPException(
            status_code=409,
            detail="Não é possível atualizar uma iteração consolidada.",
        )

    chaves = list(dict.fromkeys(
        chave.strip().upper()
        for chave in issue_keys
        if isinstance(chave, str) and chave.strip()
    ))

    if not chaves:
        raise HTTPException(
            status_code=422,
            detail="Nenhuma demanda pendente informada.",
        )

    anterior = obter_ultima_sincronizacao(iteracao_id)
    dados_anteriores = anterior["dados"]

    demandas_anteriores = dados_anteriores.get("demandas") or []

    demandas_por_chave = {
        demanda["key"]: demanda.copy()
        for demanda in demandas_anteriores
    }

    desconhecidas = [
        chave for chave in chaves
        if chave not in demandas_por_chave
    ]

    if desconhecidas:
        raise HTTPException(
            status_code=422,
            detail={
                "mensagem": "Demandas não pertencem ao snapshot.",
                "chaves": desconhecidas,
            },
        )

    demandas_originais_por_chave = {
        chave: demanda.copy()
        for chave, demanda in demandas_por_chave.items()
    }

    campos_preservados = {
        "key",
        "scope",
        "inclusion_reasons",
        "inclusion_sources",
        "qa_relationships",
        "review",
        "included_in_metrics",
    }

    for chave in chaves:
        resultado = await consultar_demanda_jira_service(
            chave,
            apenas_demanda=True,
        )

        rastreabilidade = resultado.get("traceability") or {}

        if rastreabilidade.get("complete") is not True:
            raise HTTPException(
                status_code=409,
                detail=f"Consulta incompleta para {chave}. Snapshot preservado.",
            )

        atualizada = next(
            (
                demanda
                for demanda in resultado.get("issues", [])
                if demanda.get("key") == chave
            ),
            None,
        )

        if atualizada is None:
            raise HTTPException(
                status_code=502,
                detail=f"Jira não retornou a demanda {chave}.",
            )

        anterior_demanda = demandas_por_chave[chave]

        nova_demanda = anterior_demanda.copy()

        for campo, valor in atualizada.items():
            if campo not in campos_preservados:
                nova_demanda[campo] = valor

        demandas_por_chave[chave] = nova_demanda

    impactos_qa = identificar_impactos_qa(
        anteriores=demandas_originais_por_chave,
        atualizadas=demandas_por_chave,
        chaves_atualizadas=chaves,
    )

    sprints = _ler_lista_json(
        iteracao["sprints_json"],
        "sprints",
    )

    quarters = _ler_lista_json(
        iteracao["quarters_json"],
        "quarters",
    )

    if not sprints and iteracao["sprint_id"]:
        sprints = [str(iteracao["sprint_id"])]

    resultado_qa = await revalidar_qa_snapshot(
        demandas_por_chave=demandas_por_chave,
        chaves_afetadas=impactos_qa["chaves_afetadas"],
        sprints=[str(sprint) for sprint in sprints],
        quarters=quarters,
        chaves_ja_consultadas=chaves,
    )

    chaves_anteriores = {
        demanda["key"] for demanda in demandas_anteriores
    }

    demandas_atualizadas = [
        demandas_por_chave[demanda["key"]]
        for demanda in demandas_anteriores
    ]

    demandas_atualizadas.extend(
        demanda
        for chave, demanda in demandas_por_chave.items()
        if chave not in chaves_anteriores
    )

    sincronizacao = salvar_sincronizacao(
        iteracao_id=iteracao_id,
        demandas=demandas_atualizadas,
        contexto=dados_anteriores.get("contexto") or {},
        rastreabilidade=dados_anteriores.get("rastreabilidade") or {},
        demandas_excluidas=dados_anteriores.get("demandas_excluidas") or [],
    )

    return {
        **sincronizacao,
        "modalidade": "pending",
        "total_atualizadas": len(chaves),
        "total_snapshot": len(demandas_atualizadas),
        "chaves_atualizadas": chaves,
        "impactos_qa": impactos_qa,
        "resultado_qa": resultado_qa,
        "revalidacao_governanca_pendente": True,
    }