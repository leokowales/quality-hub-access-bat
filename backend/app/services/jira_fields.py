"""Mapeamento dos campos Jira utilizados pelo QualityHub.

Os IDs foram confirmados no catálogo /rest/api/3/field da instância.
"""

CUSTOM_FIELDS = {
    "story_points": "customfield_10105",
    "developer": "customfield_29043",
    "root_cause": "customfield_24405",
    "test_scenarios_count": "customfield_24805",
    "quarter": "customfield_33165",
    "baseline_quarter": "customfield_35321",
    "sprint": "customfield_10700",
    "team": "customfield_17900",
    "epic_tshirt": "customfield_28693",
    "sla": "customfield_21800",
    "mapping_status": "customfield_33113",
    "test_case_mapping_owner": "customfield_33112",
}

STANDARD_FIELDS = ("reporter", "resolutiondate", "labels")


def campos_adicionais(catalogo):
    """Solicita somente campos que realmente existem no catálogo Jira."""
    disponiveis = {campo.get("id") for campo in catalogo}
    return [
        campo for campo in (*STANDARD_FIELDS, *CUSTOM_FIELDS.values())
        if campo in disponiveis
    ]


def _normalizar(valor):
    if valor is None:
        return None
    if isinstance(valor, list):
        return [_normalizar(item) for item in valor]
    if isinstance(valor, dict):
        if "displayName" in valor or "accountId" in valor:
            return {
                "name": valor.get("displayName"),
                "account_id": valor.get("accountId"),
            }
        if "value" in valor:
            return valor["value"]
        return valor
    return valor


def detalhes_jira(issue):
    """Retorna metadados adicionais, sem inferir obrigatoriedade ou completude."""
    fields = issue.get("fields") or {}
    return {
        "reporter": (fields.get("reporter") or {}).get("displayName"),
        "reporter_account_id": (fields.get("reporter") or {}).get("accountId"),
        "resolved": fields.get("resolutiondate"),
        "categories": fields.get("labels") or [],
        "jira_fields": {
            nome: _normalizar(fields.get(campo_id))
            for nome, campo_id in CUSTOM_FIELDS.items()
        },
    }
