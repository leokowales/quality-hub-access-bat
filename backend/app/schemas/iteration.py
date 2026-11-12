from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CriarIteracaoRequest(BaseModel):
    project_key: str = Field(min_length=1, max_length=50)
    team_name: str = Field(min_length=1, max_length=200)
    sprint_id: str = Field(default="", max_length=100)
    sprint_name: str = Field(default="", max_length=200)

    data_inicio: str | None = None
    data_fim: str | None = None

    sprints: list[str] = Field(default_factory=list)
    quarters: list[str] = Field(default_factory=list)


class IteracaoResponse(BaseModel):
    id: str
    project_key: str
    team_name: str
    sprint_id: str
    sprint_name: str

    data_inicio: str | None = None
    data_fim: str | None = None
    sprints_json: str | None = None
    quarters_json: str | None = None

    status: Literal[
        "pendente",
        "em_revisao",
        "consolidada",
    ]

    criada_em: datetime
    atualizada_em: datetime



class SalvarSincronizacaoRequest(BaseModel):
    demandas: list[dict[str, Any]] = Field(
        default_factory=list
    )
    contexto: dict[str, Any] = Field(
        default_factory=dict
    )
    rastreabilidade: dict[str, Any] = Field(
        default_factory=dict
    )
    demandas_excluidas: list[str] = Field(
        default_factory=list
    )


class SincronizacaoResponse(BaseModel):
    id: str
    iteracao_id: str
    versao: int
    criada_em: datetime


class CriarIteracaoComSnapshotRequest(CriarIteracaoRequest):
    sincronizacao_inicial: SalvarSincronizacaoRequest
