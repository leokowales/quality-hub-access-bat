"""Contrato estrutural mínimo dos snapshots antes da persistência."""

from fastapi import HTTPException


def _erro(campo: str) -> None:
    raise HTTPException(status_code=422, detail=f"Snapshot inválido: {campo}.")


def _lista_chaves(valor: object, campo: str) -> None:
    if not isinstance(valor, list) or any(
        not isinstance(chave, str) or not chave.strip() for chave in valor
    ):
        _erro(campo)


def _demandas(valor: object, campo: str) -> None:
    if not isinstance(valor, list):
        _erro(campo)
    chaves = set()
    for demanda in valor:
        if not isinstance(demanda, dict):
            _erro(campo)
        chave = demanda.get("key")
        if not isinstance(chave, str) or not chave.strip():
            _erro(f"{campo}.key")
        chave = chave.strip()
        if chave in chaves:
            _erro(f"{campo}.key duplicada")
        chaves.add(chave)


def validar_snapshot(dados: object, *, exigir_demandas: bool = False) -> None:
    """Rejeita estruturas que não podem ser interpretadas com segurança.

    Campos Jira opcionais dentro de cada demanda não são exigidos: o contrato
    só valida os contêineres e chaves necessários para preservar o snapshot.
    """
    if not isinstance(dados, dict):
        _erro("corpo")

    demandas = dados.get("demandas", [])
    _demandas(demandas, "demandas")
    if exigir_demandas and not demandas:
        _erro("demandas")

    contexto = dados.get("contexto", {})
    if not isinstance(contexto, dict):
        _erro("contexto")
    if "demandas_originais" in contexto:
        _demandas(contexto["demandas_originais"], "contexto.demandas_originais")

    rastreabilidade = dados.get("rastreabilidade", {})
    if not isinstance(rastreabilidade, dict):
        _erro("rastreabilidade")
    for campo in ("complete", "limit_reached"):
        if campo in rastreabilidade and not isinstance(rastreabilidade[campo], bool):
            _erro(f"rastreabilidade.{campo}")
    for campo in ("unresolved_keys", "incomplete_queries"):
        if campo in rastreabilidade:
            _lista_chaves(rastreabilidade[campo], f"rastreabilidade.{campo}")

    if "demandas_excluidas" in dados:
        _lista_chaves(dados["demandas_excluidas"], "demandas_excluidas")
