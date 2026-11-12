import httpx
from fastapi import HTTPException
from app.core.credentials import obter_credenciais_jira
from app.services.jira_pagination import proximo_token_seguro
from app.services.jira_http import get_jira_com_retry


async def consultar_pessoas_jira_service(project_key: str, team_name: str, team_id: str | None = None):
    url, email, token = obter_credenciais_jira()
    project_key = project_key.strip().upper()
    team_name = team_name.strip()
    if not url or not email or not token:
        raise HTTPException(
            status_code=500,
            detail="Configure JIRA_BASE_URL, JIRA_EMAIL e JIRA_API_TOKEN no .env.",
        )
    headers = {"Accept": "application/json"}
    auth = (email, token)
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=False,
        ) as client:
            # Localiza o campo Team na instância Jira.
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
            campo_team = next(
                (
                    campo
                    for campo in fields_response.json()
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
            team_field_id = campo_team["id"]
            pessoas = {}
            next_page_token = None
            tokens_vistos = set()
            # Consulta as demandas do projeto, incluindo time e responsável.
            while True:
                params = {
                    "jql": f'project = "{project_key}" ORDER BY key ASC',
                    "maxResults": 100,
                    "fields": f"{team_field_id},assignee",
                }
                if next_page_token:
                    params["nextPageToken"] = next_page_token
                response = await get_jira_com_retry(
                    client,
                    f"{url}/rest/api/3/search/jql",
                    params=params,
                    auth=auth,
                    headers=headers,
                )
                if response.status_code in (401, 403):
                    raise HTTPException(
                        status_code=401,
                        detail="Sem permissão para consultar as demandas do projeto.",
                    )
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "Erro ao consultar demandas do projeto. "
                            f"HTTP {response.status_code}: {response.text[:300]}"
                        ),
                    )
                resultado = response.json()
                for issue in resultado.get("issues", []):
                    fields = issue.get("fields", {})
                    valor_team = fields.get(team_field_id)
                    if not valor_team:
                        continue
                    equipes_issue = (
                        valor_team if isinstance(valor_team, list)
                        else [valor_team]
                    )
                    pertence_ao_time = any(
                        isinstance(equipe, dict)
                        and (str(equipe.get('id', '')) == team_id if team_id else
                             equipe.get("name", "").strip().casefold() == team_name.casefold())
                        for equipe in equipes_issue
                    )
                    if not pertence_ao_time:
                        continue
                    assignee = fields.get("assignee")
                    if not assignee:
                        continue
                    account_id = assignee.get("accountId")
                    display_name = assignee.get("displayName", "").strip()
                    if account_id and display_name:
                        pessoas[account_id] = {
                            "accountId": account_id,
                            "displayName": display_name,
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
        "people": sorted(
            pessoas.values(),
            key=lambda pessoa: pessoa["displayName"].casefold(),
        ),
        "message": (
            "Pessoas encontradas entre os responsáveis das demandas "
            "associadas ao time selecionado."
        ),
    }
