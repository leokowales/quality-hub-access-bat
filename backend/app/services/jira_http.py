"""Chamadas HTTP ao Jira com tratamento limitado de rate limit."""

import asyncio

from fastapi import HTTPException


MAX_TENTATIVAS_APOS_429 = 2
MAX_ESPERA_429_SEGUNDOS = 5


def _espera_indicada(resposta) -> int:
    valor = resposta.headers.get("Retry-After") if resposta.headers else None
    try:
        espera = int(valor)
    except (TypeError, ValueError):
        return 1
    return max(1, espera)


async def get_jira_com_retry(client, url: str, **kwargs):
    """Executa GET e respeita `Retry-After` em tentativas curtas."""
    for tentativa in range(MAX_TENTATIVAS_APOS_429 + 1):
        resposta = await client.get(url, **kwargs)
        if resposta.status_code != 429:
            return resposta

        espera = _espera_indicada(resposta)
        if espera > MAX_ESPERA_429_SEGUNDOS:
            raise HTTPException(
                status_code=429,
                detail=f"O Jira limitou as consultas. Aguarde {espera} segundos e tente novamente.",
            )
        if tentativa == MAX_TENTATIVAS_APOS_429:
            raise HTTPException(
                status_code=429,
                detail="O Jira limitou as consultas. Tente novamente em instantes.",
            )
        await asyncio.sleep(espera)

    raise AssertionError("Laço de tentativas Jira inesperadamente encerrado.")
