from pydantic import BaseModel, Field, ConfigDict, StringConstraints

from typing import TypeAlias, Annotated

IdCadastro: TypeAlias = int | float
IdJira: TypeAlias = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ProjetoConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdCadastro
    chave: str = Field(min_length=1)
    nome: str = Field(min_length=1)


class TimeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdCadastro
    nome: str = Field(min_length=1)
    jira_id: IdJira | None = None
    projetosIds: list[IdCadastro] = Field(default_factory=list)


class PessoaConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdCadastro
    nome: str = Field(min_length=1)
    account_id: IdJira | None = None
    cargo: str = Field(default="", max_length=100)
    timesIds: list[IdCadastro] = Field(default_factory=list)


class ConfiguracaoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projetos: list[ProjetoConfig]
    times: list[TimeConfig]
    pessoas: list[PessoaConfig]


class ConfiguracaoResponse(ConfiguracaoRequest):
    pass
