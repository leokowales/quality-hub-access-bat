import re
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.core.credentials import obter_credenciais_jira
from app.services.extraction import _chave, _formatar_issue
from app.services.jira_fields import campos_adicionais
from app.services.issue_types import demanda_util, tipo_ignorado
from app.services.jira_http import get_jira_com_retry

KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*-[0-9]+$")


def _validar_url(url):
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise HTTPException(status_code=500, detail="URL Jira Cloud salva inválida.")


async def consultar_demanda_jira_service(
    issue_key: str,
    apenas_demanda: bool = False,
):
    key = issue_key.strip().upper()
    if not KEY_PATTERN.fullmatch(key):
        raise HTTPException(status_code=422, detail="Chave Jira inválida.")

    url, email, token = obter_credenciais_jira()
    url = url.rstrip("/")
    _validar_url(url)

    async def get(client, path, params=None, permitir_ausente=False):
        response = await get_jira_com_retry(
            client,
            f"{url}{path}", params=params, auth=(email, token),
            headers={"Accept": "application/json"},
        )
        if response.status_code == 404 and permitir_ausente:
            return None
        if response.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="Sem autenticação ou permissão no Jira.")
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Demanda Jira não encontrada ou sem acesso.")
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Erro Jira HTTP {response.status_code}.")
        return response.json()

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            fields = await get(client, "/rest/api/3/field")
            sprint_fields = [f for f in fields if f.get("name", "").strip().casefold() == "sprint"]
            quarter_fields = [f for f in fields if f.get("name", "").strip().casefold() in ("quarter", "trimestre")]
            requested = list(dict.fromkeys([
                "summary", "status", "issuetype", "priority", "assignee",
                "created", "updated", "parent", "issuelinks",
                *campos_adicionais(fields),
                *[f["id"] for f in sprint_fields + quarter_fields],
            ]))
            params = {"fields": ",".join(requested), "properties": "assertthat-scenarios"}
            root = await get(client, f"/rest/api/3/issue/{key}", params)
            if tipo_ignorado(((root.get('fields') or {}).get('issuetype') or {}).get('name')):
                raise HTTPException(422, 'Subtarefas e Spikes não fazem parte do acompanhamento.')
            actual_key = root.get("key") or key
            if apenas_demanda:
                item = _formatar_issue(
                    root,
                    url,
                    sprint_fields,
                    quarter_fields,
                )

                item["scope"] = "manual_lookup"
                item["inclusion_reasons"] = ["manual_lookup"]
                item["qa_relationships"] = []
                item["review"] = {
                    "eligible": None,
                    "recommendation": "review",
                    "alerts": ["consulta_manual_sem_validacao_de_escopo"],
                    "decision": "pending",
                    "decision_source": None,
                }
                item["included_in_metrics"] = False

                return {
                    "status": "ok",
                    "query_key": key,
                    "root_key": actual_key,
                    "total": 1,
                    "issues": [item],
                    "relationships": [],
                    "traceability": {
                        "complete": True,
                        "limit_reached": False,
                        "unresolved_keys": [],
                        "incomplete_queries": [],
                    },
                    "review_required": True,
                }
            # Lookup manual: somente a cadeia de ancestrais, até o primeiro Epic.
            issues = {actual_key: root}
            reasons = {actual_key: {"manual_lookup"}}
            relationships = []
            unresolved = []
            visited = set()
            current_key = actual_key

            while current_key not in visited:
                visited.add(current_key)
                current = issues[current_key]
                issue_type = ((current.get("fields") or {}).get("issuetype") or {}).get("name", "")
                if issue_type.strip().casefold() in ("epic", "épico", "epico"):
                    break

                parent_key = _chave((current.get("fields") or {}).get("parent"))
                if not parent_key:
                    break
                relationships.append({
                    "origem": current_key,
                    "destino": parent_key,
                    "tipo": "parent",
                    "direcao": "ancestral",
                })
                if parent_key in visited:
                    unresolved.append(parent_key)
                    break
                if parent_key not in issues:
                    parent = await get(client, f"/rest/api/3/issue/{parent_key}", params, True)
                    if parent is None:
                        unresolved.append(parent_key)
                        break
                    canonical = parent.get("key") or parent_key
                    issues[canonical] = parent
                    reasons[canonical] = {"ancestor"}
                    if canonical in visited:
                        unresolved.append(canonical)
                        break
                    current_key = canonical
                else:
                    reasons[parent_key].add("ancestor")
                    current_key = parent_key

            formatted = []
            for issue_key_found, issue in issues.items():
                item = _formatar_issue(issue, url, sprint_fields, quarter_fields)
                if not demanda_util(item):
                    continue
                item["scope"] = "manual_lookup"
                item["inclusion_reasons"] = sorted(reasons[issue_key_found])
                item["qa_relationships"] = []
                item["review"] = {
                    "eligible": None,
                    "recommendation": "review",
                    "alerts": ["consulta_manual_sem_validacao_de_escopo"],
                    "decision": "pending",
                    "decision_source": None,
                }
                item["included_in_metrics"] = False
                formatted.append(item)

            return {
                "status": "ok",
                "query_key": key,
                "root_key": actual_key,
                "total": len(formatted),
                "issues": formatted,
                "relationships": list({(r["origem"], r["destino"], r["tipo"], r["direcao"]): r for r in relationships}.values()),
                "traceability": {
                    "complete": not unresolved,
                    "limit_reached": False,
                    "unresolved_keys": sorted(unresolved),
                    "incomplete_queries": [],
                },
                "review_required": True,
            }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="O Jira demorou demais para responder.")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Não foi possível acessar o Jira.")
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(status_code=502, detail="O Jira retornou dados inesperados.")
