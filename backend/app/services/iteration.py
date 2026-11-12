from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.core.credentials import obter_credenciais_jira
from app.services.jira_pagination import proximo_token_seguro
from app.services.jira_http import get_jira_com_retry

from datetime import timedelta

def _valores(valor):
    return valor if isinstance(valor, list) else ([valor] if valor is not None else [])


def _rotulo(valor):
    if isinstance(valor, dict):
        return str(valor.get("value") or valor.get("name") or "").strip()
    return str(valor).strip() if isinstance(valor, (str, int)) else ""


async def consultar_filtros_iteracao_service(project_key: str, team_name: str, start_date, end_date):
    url, email, token = obter_credenciais_jira()
    project_key = project_key.strip().upper()
    team_name = team_name.strip()
    parsed = urlparse(url)
    
    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="A data inicial não pode ser posterior à data final.",
        )
    
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise HTTPException(status_code=500, detail="URL Jira Cloud salva inválida.")

    async def get(client, path, params=None):
        response = await get_jira_com_retry(
            client,
            f"{url}{path}", params=params, auth=(email, token),
            headers={"Accept": "application/json"},
        )
        if response.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="Sem autenticação ou permissão no Jira.")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Recurso Jira não encontrado ou sem acesso.")
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Erro Jira HTTP {response.status_code}: {response.text[:300]}")
        return response.json()

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            projeto = await get(client, f"/rest/api/3/project/{project_key}")
            campos = await get(client, "/rest/api/3/field")
            campo_team = next((c for c in campos if c.get("name", "").strip().casefold() == "team"
                               and c.get("schema", {}).get("type") == "team"), None)
            if not campo_team:
                raise HTTPException(status_code=404, detail="Campo Team não encontrado no Jira.")
            sprint_fields = [c for c in campos if c.get("name", "").strip().casefold() == "sprint"]
            quarter_fields = [c for c in campos if c.get("name", "").strip().casefold() in ("quarter", "trimestre")]
            requested = [campo_team["id"]] + [c["id"] for c in sprint_fields + quarter_fields]
            sprint_map, quarter_map, team_ids = {}, {}, set()
            sprint_quarters = {}
            total = 0
            token_pagina = None
            tokens_vistos = set()
            while True:
                params = {
                    "jql": (
                        f'project = "{project_key}" '
                        f'AND created >= "{start_date.isoformat()}" '
                        f'AND created < "{(end_date + timedelta(days=1)).isoformat()}" '
                        "ORDER BY key ASC"
                    ),
                    "fields": ",".join(dict.fromkeys(requested)),
                    "maxResults": 100,
                }
                if token_pagina:
                    params["nextPageToken"] = token_pagina
                pagina = await get(client, "/rest/api/3/search/jql", params)
                for issue in pagina.get("issues", []):
                    fields = issue.get("fields") or {}
                    teams = [t for t in _valores(fields.get(campo_team["id"])) if isinstance(t, dict)]
                    matches = [t for t in teams if str(t.get("name", "")).strip().casefold() == team_name.casefold()]
                    if not matches:
                        continue
                    total += 1
                    team_ids.update(str(t["id"]) for t in matches if t.get("id") is not None)
                    sprints_issue = set()
                    quarters_issue = set()

                    for campo in sprint_fields:
                        for sprint in _valores(fields.get(campo["id"])):
                            if not isinstance(sprint, dict):
                                continue

                            sprint_id = sprint.get("id")
                            if sprint_id is None:
                                continue

                            sprint_id = str(sprint_id)
                            sprints_issue.add(sprint_id)

                            sprint_map[sprint_id] = {
                                "id": sprint["id"],
                                "name": sprint.get("name") or sprint_id,
                                "state": sprint.get("state"),
                            }

                    for campo in quarter_fields:
                        for quarter in _valores(fields.get(campo["id"])):
                            nome = _rotulo(quarter)

                            if not nome:
                                continue

                            quarter_id = f'{campo["id"]}:{nome}'
                            quarters_issue.add(quarter_id)

                            quarter_map[(campo["id"], nome)] = {
                                "field_id": campo["id"],
                                "name": nome,
                            }

                    for sprint_id in sprints_issue:
                        sprint_quarters.setdefault(
                            sprint_id, set()
                        ).update(quarters_issue)
                if pagina.get("isLast", False):
                    break
                token_pagina = proximo_token_seguro(
                    pagina.get("nextPageToken"), tokens_vistos
                )
                if not token_pagina:
                    break
            return {
                "status": "ok",
                "project": {"id": projeto.get("id"), "key": projeto.get("key"), "name": projeto.get("name")},
                "team": {"name": team_name, "jira_ids": sorted(team_ids)},
                "issues_analyzed": total,
                "sprints": sorted(sprint_map.values(), key=lambda x: x["name"].casefold()),
                "quarters": sorted(quarter_map.values(), key=lambda x: (x["field_id"], x["name"].casefold())),
                "sprint_quarters": {
                    sprint_id: sorted(quarters)
                    for sprint_id, quarters in sprint_quarters.items()
                },
                "discovery": {
                    "sprint_fields": [c["id"] for c in sprint_fields],
                    "quarter_fields": [c["id"] for c in quarter_fields],
                    "quarter_note": "Quarter é um campo customizado; valores só aparecem se encontrados nas issues do time.",
                    "scope": "Valores observados nas issues acessíveis do projeto/time, não necessariamente todas as opções configuradas.",
                },
            }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="O Jira demorou demais para responder.")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Não foi possível acessar o Jira.")
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status_code=502, detail="O Jira retornou dados inesperados.")
