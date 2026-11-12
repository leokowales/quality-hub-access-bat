from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from app.schemas.jira import JiraCredentials
from app.core.credentials import salvar_credenciais_jira
from app.services.jira_http import get_jira_com_retry


async def validar_conexao_jira_service(credentials: JiraCredentials):
    url = credentials.url.strip().rstrip("/")
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
            status_code=400,
            detail="Informe a URL HTTPS válida da instância Jira Cloud.",
        )
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=False,
        ) as client:
            response = await get_jira_com_retry(
                client,
                f"{url}/rest/api/3/myself",
                auth=(
                    credentials.email.strip(),
                    credentials.token,
                ),
                headers={"Accept": "application/json"},
            )
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
    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=401,
            detail="Não foi possível autenticar. Confira o e-mail, o token e as permissões.",
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"O Jira retornou o status HTTP {response.status_code}.",
        )
    try:
        usuario = response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou uma resposta inválida.",
        )
    try:
        usuario = response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou uma resposta inválida.",
        )
    # NOVO: salva as credenciais após a validação bem-sucedida
    try:
        salvar_credenciais_jira(
            url=url,
            email=credentials.email,
            token=credentials.token,
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "A conexão foi validada, mas não foi possível "
                "salvar as credenciais localmente."
            ),
        )
    return {
        "status": "ok",
        "message": "Conexão com o Jira validada.",
        "user": usuario.get("displayName", "Usuário autenticado"),
    }
