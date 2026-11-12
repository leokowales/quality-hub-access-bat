from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from app.core.credentials import obter_credenciais_jira
from app.services.jira_http import get_jira_com_retry


async def consultar_projeto_jira_service(project_key: str):
    url, email, token = obter_credenciais_jira()
    project_key = project_key.strip().upper()

    if not url or not email or not token:
        raise HTTPException(
            status_code=500,
            detail="Configure JIRA_BASE_URL, JIRA_EMAIL e JIRA_API_TOKEN no .env.",
        )

    parsed_url = urlparse(url)

    if (
        parsed_url.scheme != "https"
        or not parsed_url.hostname
        or parsed_url.username
        or parsed_url.password
        or parsed_url.query
        or parsed_url.fragment
        or parsed_url.path not in ("", "/")
    ):
        raise HTTPException(
            status_code=500,
            detail="A variável JIRA_BASE_URL não contém uma URL Jira Cloud válida.",
        )

    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=False,
        ) as client:
            response = await get_jira_com_retry(
                client,
                f"{url}/rest/api/3/project/{project_key}",
                auth=(email, token),
                headers={"Accept": "application/json"},
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail=f"Projeto '{project_key}' não encontrado ou sem acesso.",
            )

        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=401,
                detail="Falha de autenticação ou falta de permissão no Jira.",
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Erro ao consultar o projeto no Jira. HTTP {response.status_code}.",
            )

        projeto = response.json()

        return {
            "status": "ok",
            "project": {
                "id": projeto.get("id"),
                "key": projeto.get("key"),
                "name": projeto.get("name"),
            },
            "message": "Projeto consultado com sucesso.",
        }

    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="O Jira demorou demais para responder.",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível acessar o Jira. Verifique a URL e a rede.",
        )
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou uma resposta inválida.",
        )
