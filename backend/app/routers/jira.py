import asyncio
from fastapi import APIRouter, Request
from app.schemas.jira import JiraCredentials, JiraTeamRequest, JiraProjectRequest, JiraPeopleRequest, JiraIterationFiltersRequest, JiraIterationExtractRequest
from app.services.connection import validar_conexao_jira_service
from app.services.project import consultar_projeto_jira_service
from app.services.team import discovery_times_jira_service
from app.services.people import consultar_pessoas_jira_service
from app.services.iteration import consultar_filtros_iteracao_service
from app.services.extraction import extrair_demandas_iteracao_service
from app.schemas.jira import JiraIssueLookupRequest
from app.services.issue_lookup import consultar_demanda_jira_service
from app.core.credentials import resumo_conexao_jira, desconectar_jira

router = APIRouter()


@router.get('/jira/connection')
def consultar_conexao():
    return resumo_conexao_jira()


@router.delete('/jira/connection')
def remover_conexao():
    return desconectar_jira()


async def executar_com_cancelamento(request: Request, operacao):
    tarefa = asyncio.create_task(operacao)
    try:
        while not tarefa.done():
            if await request.is_disconnected():
                tarefa.cancel()
                await asyncio.gather(tarefa, return_exceptions=True)
                return None
            await asyncio.sleep(0.2)
        return await tarefa
    except asyncio.CancelledError:
        tarefa.cancel()
        await asyncio.gather(tarefa, return_exceptions=True)
        raise


@router.post("/jira/validate")
async def validate_jira(credentials: JiraCredentials):
    return await validar_conexao_jira_service(credentials)


@router.post("/jira/team")
async def discovery_times_jira(request: JiraTeamRequest):
    return await discovery_times_jira_service(request.project_key, request.start_date)


@router.post("/jira/project")
async def consultar_projeto_jira(request: JiraProjectRequest):
    return await consultar_projeto_jira_service(request.project_key)


@router.post("/jira/people")
async def consultar_pessoas_jira(request: JiraPeopleRequest):
    return await consultar_pessoas_jira_service(request.project_key, request.team_name, request.team_id)


@router.post("/jira/iteration/filters")
async def consultar_filtros_iteracao(
    dados: JiraIterationFiltersRequest,
    request: Request,
):
    return await executar_com_cancelamento(
        request,
        consultar_filtros_iteracao_service(
            dados.project_key,
            dados.team_name,
            dados.start_date,
            dados.end_date,
        ),
    )


@router.post("/jira/iteration/extract")
async def extrair_demandas_iteracao(
    dados: JiraIterationExtractRequest,
    request: Request,
):
    return await executar_com_cancelamento(
        request,
        extrair_demandas_iteracao_service(
            dados.project_key,
            dados.team_name,
            dados.start_date,
            dados.end_date,
            dados.quarters,
            dados.sprint_ids,
        ),
    )


@router.post("/jira/issue/lookup")
async def consultar_demanda_jira(
    dados: JiraIssueLookupRequest,
    request: Request,
):
    return await executar_com_cancelamento(
        request,
        consultar_demanda_jira_service(dados.issue_key),
    )
