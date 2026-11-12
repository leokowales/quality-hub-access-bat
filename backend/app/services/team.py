from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from app.core.credentials import obter_credenciais_jira
from app.services.jira_pagination import proximo_token_seguro
from app.services.jira_http import get_jira_com_retry

async def discovery_times_jira_service(project_key: str, start_date):
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
    headers = {"Accept": "application/json"}
    auth = (email, token)
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=False,
        ) as client:
            # 1. Consulta o projeto pela chave informada.
            project_response = await get_jira_com_retry(
                client,
                f"{url}/rest/api/3/project/{project_key}",
                auth=auth,
                headers=headers,
            )
            if project_response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail=f"Projeto '{project_key}' não encontrado ou sem acesso.",
                )
            if project_response.status_code in (401, 403):
                raise HTTPException(
                    status_code=401,
                    detail="Falha de autenticação ou falta de permissão no Jira.",
                )
            if project_response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Erro ao consultar o projeto no Jira. "
                        f"HTTP {project_response.status_code}."
                    ),
                )
            projeto = project_response.json()
            # 2. Descobre o campo Team configurado na instância.
            fields_response = await get_jira_com_retry(
                client,
                f"{url}/rest/api/3/field",
                auth=auth,
                headers=headers,
            )
            if fields_response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Não foi possível consultar os campos do Jira.",
                )
            campos = fields_response.json()
            campo_team = next(
                (
                    campo
                    for campo in campos
                    if campo.get("name", "").strip().casefold() == "team"
                    and campo.get("schema", {}).get("type") == "team"
                ),
                None,
            )
            if not campo_team:
                raise HTTPException(
                    status_code=404,
                    detail="O campo Team não foi encontrado na instância Jira.",
                )
            ids_team = {campo_team["id"]}
            # 3. Busca as demandas do projeto, com paginação.
            equipes = {}
            next_page_token = None
            tokens_vistos = set()
            max_results = 100
            while True:
                params = {
                    "jql": (
                        f'project = "{project_key}" '
                        f'AND created >= "{start_date.isoformat()}" '
                        "ORDER BY key ASC"
                    ),
                    "maxResults": max_results,
                    "fields": ",".join(sorted(ids_team)),
                }
                if next_page_token:
                    params["nextPageToken"] = next_page_token
                search_response = await get_jira_com_retry(
                    client,
                    f"{url}/rest/api/3/search/jql",
                    params=params,
                    auth=auth,
                    headers=headers,
                )
                if search_response.status_code in (401, 403):
                    raise HTTPException(
                        status_code=401,
                        detail="Sem permissão para consultar as demandas do projeto.",
                    )
                if search_response.status_code != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "Erro ao consultar demandas do projeto. "
                            f"HTTP {search_response.status_code}: "
                            f"{search_response.text[:500]}"
                        ),
                    )
                resultado = search_response.json()
                issues = resultado.get("issues", [])
                for issue in issues:
                    fields = issue.get("fields", {})
                    for field_id in ids_team:
                        valor = fields.get(field_id)
                        if not valor:
                            continue
                        valores = valor if isinstance(valor, list) else [valor]
                        for equipe in valores:
                            if not isinstance(equipe, dict):
                                continue
                            equipe_id = equipe.get("id")
                            equipe_nome = equipe.get("name")
                            if equipe_id and equipe_nome and equipe_nome.strip():
                                identificador = str(equipe_id)
                                equipes[identificador] = {
                                    "id": identificador,
                                    "name": equipe_nome.strip(),
                                }
                if resultado.get("isLast", False):
                    break
                next_page_token = proximo_token_seguro(
                    resultado.get("nextPageToken"), tokens_vistos
                )
                if not next_page_token:
                    break
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
    return {
        "status": "ok",
        "project": {
            "id": projeto.get("id"),
            "key": projeto.get("key"),
            "name": projeto.get("name"),
        },
        "teams": sorted(
            equipes.values(),
            key=lambda equipe: equipe["name"].casefold(),
        ),
        "message": (
            "Projeto consultado. Os times retornados são os encontrados "
            "nos campos Team das demandas acessíveis."
        ),
    }
