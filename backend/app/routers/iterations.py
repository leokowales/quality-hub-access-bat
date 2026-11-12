
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.schemas.iteration import (
    CriarIteracaoComSnapshotRequest,
    CriarIteracaoRequest,
    IteracaoResponse,
    SalvarSincronizacaoRequest,
    SincronizacaoResponse,
)
from app.services.iteration_storage import (
    criar_iteracao,
    listar_iteracoes,
    obter_iteracao,
    listar_decisoes_revisao,
    salvar_decisao_revisao,
    preparar_finalizacao_revisao,
    finalizar_revisao,
    excluir_iteracao,
)

from app.services.synchronization_storage import (
    salvar_sincronizacao,
    obter_ultima_sincronizacao,
)

from app.services.iteration_refresh import (
    atualizar_todas_demandas_service,
    atualizar_pendentes_service,
)

from fastapi import Query
from app.services.iteration_storage import (
    listar_iteracoes_paginadas,
)

router = APIRouter(
    prefix="/iterations",
    tags=["Iterações"],
)

@router.get("/paginated")
def listar_paginadas(
    status: str = Query(
        default="pendentes",
        pattern="^(pendentes|historico)$",
    ),
    busca: str = "",
    projeto: str = "",
    time: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    pagina: int = Query(default=1, ge=1),
    limite: int = Query(default=10, ge=1, le=100),
):
    return listar_iteracoes_paginadas(
        status=status,
        busca=busca,
        projeto=projeto,
        time=time,
        data_inicio=data_inicio,
        data_fim=data_fim,
        pagina=pagina,
        limite=limite,
    )


class UltimaSincronizacaoResponse(BaseModel):
    id: str
    iteracao_id: str
    versao: int
    criada_em: str
    dados: dict[str, Any]


@router.post(
    "",
    response_model=IteracaoResponse,
    status_code=201,
)
def criar(payload: CriarIteracaoRequest):
    return criar_iteracao(
        project_key=payload.project_key,
        team_name=payload.team_name,
        sprint_id=payload.sprint_id,
        sprint_name=payload.sprint_name,
        data_inicio=payload.data_inicio,
        data_fim=payload.data_fim,
        sprints=payload.sprints,
        quarters=payload.quarters,
    )


@router.post('/with-snapshot', response_model=IteracaoResponse, status_code=201)
def criar_com_snapshot(payload: CriarIteracaoComSnapshotRequest):
    return criar_iteracao(**payload.model_dump())


@router.get(
    "",
    response_model=list[IteracaoResponse],
)
def listar():
    return listar_iteracoes()


@router.get("/filter-options")
def obter_opcoes_filtros(projeto: str = ""):
    from app.core.database import conectar_banco

    with conectar_banco() as conexao:
        projetos = conexao.execute("""
            SELECT DISTINCT project_key
            FROM iteracoes
            WHERE project_key IS NOT NULL
              AND TRIM(project_key) != ''
            ORDER BY project_key COLLATE NOCASE
        """).fetchall()

        if projeto.strip():
            times = conexao.execute("""
                SELECT DISTINCT team_name
                FROM iteracoes
                WHERE team_name IS NOT NULL
                  AND TRIM(team_name) != ''
                  AND project_key = ?
                ORDER BY team_name COLLATE NOCASE
            """, (projeto.strip(),)).fetchall()
        else:
            times = conexao.execute("""
                SELECT DISTINCT team_name
                FROM iteracoes
                WHERE team_name IS NOT NULL
                  AND TRIM(team_name) != ''
                ORDER BY team_name COLLATE NOCASE
            """).fetchall()

    return {
        "projetos": [linha[0] for linha in projetos],
        "times": [linha[0] for linha in times],
    }


@router.get(
    "/{iteracao_id}",
    response_model=IteracaoResponse,
)
def consultar(iteracao_id: str):
    return obter_iteracao(iteracao_id)


@router.post(
    "/{iteracao_id}/synchronizations",
    response_model=SincronizacaoResponse,
    status_code=201,
)
def criar_sincronizacao(
    iteracao_id: str,
    payload: SalvarSincronizacaoRequest,
):
    return salvar_sincronizacao(
        iteracao_id=iteracao_id,
        demandas=payload.demandas,
        contexto=payload.contexto,
        rastreabilidade=payload.rastreabilidade,
        demandas_excluidas=payload.demandas_excluidas,
    )


@router.get(
    "/{iteracao_id}/synchronizations/latest",
    response_model=UltimaSincronizacaoResponse,
)
def consultar_ultima_sincronizacao(iteracao_id: str):
    return obter_ultima_sincronizacao(iteracao_id)


class DecisaoRevisaoRequest(BaseModel):
    decisao: Literal["include", "exclude", "pending"]
    justificativa: str | None = None


@router.get("/{iteracao_id}/reviews")
def consultar_decisoes(iteracao_id: str):
    return listar_decisoes_revisao(iteracao_id)


@router.put("/{iteracao_id}/reviews/{issue_key}")
def atualizar_decisao(
    iteracao_id: str,
    issue_key: str,
    payload: DecisaoRevisaoRequest,
):
    return salvar_decisao_revisao(
        iteracao_id=iteracao_id,
        issue_key=issue_key,
        decisao=payload.decisao,
        justificativa=payload.justificativa,
    )

@router.post("/{iteracao_id}/refresh")
async def atualizar_demandas_iteracao(iteracao_id: str):
    return await atualizar_todas_demandas_service(
        iteracao_id
    )


class AtualizarPendentesRequest(BaseModel):
    issue_keys: list[str]


@router.post("/{iteracao_id}/refresh/pending")
async def atualizar_pendentes_iteracao(
    iteracao_id: str,
    payload: AtualizarPendentesRequest,
):
    return await atualizar_pendentes_service(
        iteracao_id=iteracao_id,
        issue_keys=payload.issue_keys,
    )


class PreviaFinalizacaoRequest(BaseModel):
    chaves_pendentes: list[str] = Field(default_factory=list)


class FinalizarRevisaoRequest(BaseModel):
    assinatura: str
    confirmacao_ressalvas: bool = False
    chaves_pendentes: list[str] = Field(default_factory=list)


@router.post("/{iteracao_id}/finalization/preview")
def consultar_previa_finalizacao(
    iteracao_id: str,
    payload: PreviaFinalizacaoRequest,
):
    return preparar_finalizacao_revisao(
        iteracao_id=iteracao_id,
        chaves_pendentes=payload.chaves_pendentes,
    )


@router.post("/{iteracao_id}/finalization")
def concluir_revisao(
    iteracao_id: str,
    payload: FinalizarRevisaoRequest,
):
    return finalizar_revisao(
        iteracao_id=iteracao_id,
        assinatura=payload.assinatura,
        confirmacao_ressalvas=payload.confirmacao_ressalvas,
        chaves_pendentes=payload.chaves_pendentes,
    )

@router.delete("/{iteracao_id}")
def excluir_revisao(iteracao_id: str):
    return excluir_iteracao(iteracao_id)
