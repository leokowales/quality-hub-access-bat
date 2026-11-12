
import json

import keyring
from fastapi import HTTPException


JIRA_CREDENTIALS_SERVICE = "QualityHub"
JIRA_CREDENTIALS_KEY = "jira_connection"


def salvar_credenciais_jira(url: str, email: str, token: str):
    credenciais = {
        "url": url.strip().rstrip("/"),
        "email": email.strip(),
        "token": token.strip(),
    }

    keyring.set_password(
        JIRA_CREDENTIALS_SERVICE,
        JIRA_CREDENTIALS_KEY,
        json.dumps(credenciais),
    )


def obter_credenciais_jira():
    salvo = keyring.get_password(
        JIRA_CREDENTIALS_SERVICE,
        JIRA_CREDENTIALS_KEY,
    )

    if not salvo:
        raise HTTPException(
            status_code=409,
            detail="Conecte-se ao Jira pela tela de configuração inicial.",
        )

    try:
        credenciais = json.loads(salvo)
        return (
            credenciais["url"],
            credenciais["email"],
            credenciais["token"],
        )
    except (ValueError, KeyError, TypeError):
        raise HTTPException(
            status_code=500,
            detail="A conexão salva com o Jira está inválida.",
        )


def resumo_conexao_jira():
    try:
        url, email, _ = obter_credenciais_jira()
        return {"configurada": True, "url": url, "email": email}
    except HTTPException as erro:
        if erro.status_code == 409:
            return {"configurada": False, "url": None, "email": None}
        raise
    except Exception:
        raise HTTPException(503, 'Não foi possível acessar a conexão salva no cofre local.')


def desconectar_jira():
    try:
        if keyring.get_password(JIRA_CREDENTIALS_SERVICE, JIRA_CREDENTIALS_KEY) is not None:
            keyring.delete_password(JIRA_CREDENTIALS_SERVICE, JIRA_CREDENTIALS_KEY)
    except Exception:
        raise HTTPException(503, 'Não foi possível remover a conexão do cofre local.')
    return {"configurada": False, "url": None, "email": None}
