"""Validação comum dos tokens de paginação retornados pelo Jira."""

from fastapi import HTTPException


def proximo_token_seguro(
    token: object,
    tokens_vistos: set[str],
    *,
    exigir_token: bool = False,
) -> str | None:
    """Retorna o próximo token ou interrompe uma paginação inconsistente.

    O Jira pode encerrar uma consulta sem token. Nos fluxos em que `isLast`
    não é suficiente, `exigir_token` mantém a validação já existente.
    """
    if not isinstance(token, str) or not token.strip():
        if exigir_token:
            raise HTTPException(
                status_code=502,
                detail="Paginação Jira incompleta: próxima página não informada.",
            )
        return None

    token = token.strip()
    if token in tokens_vistos:
        raise HTTPException(
            status_code=502,
            detail="Paginação Jira cíclica: token repetido. Tente novamente.",
        )

    tokens_vistos.add(token)
    return token
