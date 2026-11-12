from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import Literal
from app.services import sprint_rastreabilidade as rastreabilidade
from app.services.sprint_ativa_atencao import obter_atencoes
from app.services.sprint_ativa_notas import listar_notas, criar_nota
from app.services.sprint_ativa_storage import panorama, ativar, concluir, reativar, congelar, sincronizar_sprint_operacional, consultar_evolucao, consultar_evolucao_diaria, consultar_historico_mudancas

from app.services.sprint_ativa_indicadores import obter_indicadores

from datetime import date
from app.services.sprint_periodo import consultar as consultar_periodo, salvar as salvar_periodo

router = APIRouter(prefix='/sprint-ativa', tags=['Sprint Ativa'])

class PeriodoSprint(BaseModel):
    inicio: date
    fim: date

@router.get('')
def consultar_panorama():
    return panorama()

@router.post('/iterations/{iteracao_id}/activate', status_code=201)
def ativar_sprint(iteracao_id: str):
    return ativar(iteracao_id)

class ConclusaoSprint(BaseModel):
    confirmacao_pendencias: bool = False
    versao: int | None = Field(default=None, ge=0)

@router.post('/cycles/{ciclo_id}/complete')
def concluir_sprint(ciclo_id: str, dados: ConclusaoSprint | None = None):
    return concluir(ciclo_id, dados.confirmacao_pendencias if dados else False, dados.versao if dados else None)


class DecisaoEscopo(BaseModel):
    issue_key: str = Field(min_length=3, max_length=100)
    acao: Literal['incluir', 'excluir', 'manter', 'desta_sprint', 'herdado']
    motivo: str = Field(default="", max_length=4000)

class DecisoesEscopo(BaseModel):
    versao: int = Field(ge=0)
    decisoes: list[DecisaoEscopo] = Field(min_length=1, max_length=200)

class InclusaoManual(BaseModel):
    versao: int = Field(ge=0)
    issue_key: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9_]*-\d+$')
    motivo: str = Field(min_length=1, max_length=4000)

@router.get('/cycles/{ciclo_id}/traceability')
def consultar_rastreabilidade(ciclo_id: str):
    return rastreabilidade.consultar(ciclo_id)

@router.post('/cycles/{ciclo_id}/traceability/decisions')
def decidir_escopo(ciclo_id: str, dados: DecisoesEscopo):
    return rastreabilidade.decidir(ciclo_id, dados.versao, [d.model_dump() for d in dados.decisoes])

@router.post('/cycles/{ciclo_id}/traceability/manual')
async def incluir_manualmente(ciclo_id: str, dados: InclusaoManual):
    return await rastreabilidade.adicionar(ciclo_id, dados.versao, dados.issue_key.upper(), dados.motivo)

@router.post('/cycles/{ciclo_id}/freeze')
def congelar_sprint(ciclo_id: str):
    return congelar(ciclo_id)

@router.post('/iterations/{iteracao_id}/return-to-available')
def devolver_sprint_para_disponiveis(iteracao_id: str):
    return reativar(iteracao_id)

@router.get('/cycles/{ciclo_id}/indicators')
def indicadores_sprint(ciclo_id: str):
    return obter_indicadores(ciclo_id)


@router.get('/cycles/{ciclo_id}/attention')
def consultar_atencoes(ciclo_id: str):
    return obter_atencoes(ciclo_id)

@router.get('/cycles/{ciclo_id}/notes')
def consultar_notas(ciclo_id: str):
    return listar_notas(ciclo_id)

class NovaNota(BaseModel):
    issue_key: str = Field(min_length=1, max_length=100)
    finalidade: str
    texto: str = Field(min_length=1, max_length=4000)

@router.post('/cycles/{ciclo_id}/notes', status_code=201)
def adicionar_nota(ciclo_id: str, dados: NovaNota):
    return criar_nota(ciclo_id, dados.issue_key, dados.finalidade, dados.texto)


@router.post('/cycles/{ciclo_id}/sync')
async def sincronizar_sprint(ciclo_id: str):
    return await sincronizar_sprint_operacional(ciclo_id)

@router.get('/cycles/{ciclo_id}/evolution')
def evolucao_sprint(ciclo_id: str):
    return consultar_evolucao(ciclo_id)

@router.get('/cycles/{ciclo_id}/change-history')
def historico_mudancas_sprint(ciclo_id: str):
    return consultar_historico_mudancas(ciclo_id)

@router.get('/cycles/{ciclo_id}/daily-evolution')
def evolucao_diaria_sprint(ciclo_id: str):
    return consultar_evolucao_diaria(ciclo_id)

@router.get('/iterations/{iteracao_id}/period')
def obter_periodo(iteracao_id: str):
    return consultar_periodo(iteracao_id)

@router.put('/iterations/{iteracao_id}/period')
def atualizar_periodo(iteracao_id: str, dados: PeriodoSprint):
    return salvar_periodo(iteracao_id, dados.inicio, dados.fim)


class RegistroGovernanca(BaseModel):
    tipo: Literal['informativo', 'ponto_atencao', 'evolucao_futura', 'governanca']
    titulo: str = Field(min_length=1, max_length=160)
    descricao: str = Field(default='', max_length=4000)
    status: Literal['pendente', 'em_andamento', 'bloqueado', 'concluido']
    abertura: date
    fechamento: date | None = None
    motivo_bloqueio: str = Field(default='', max_length=2000)
    versao: int | None = Field(default=None, ge=1)


@router.get('/cycles/{ciclo_id}/governance')
def consultar_governanca(ciclo_id: str):
    from app.services.sprint_governanca import listar
    return listar(ciclo_id)


@router.post('/cycles/{ciclo_id}/governance', status_code=201)
def adicionar_registro_governanca(ciclo_id: str, dados: RegistroGovernanca):
    from app.services.sprint_governanca import salvar
    return salvar(ciclo_id, dados.model_dump(mode='json'))


@router.put('/cycles/{ciclo_id}/governance/{registro_id}')
def editar_registro_governanca(ciclo_id: str, registro_id: int, dados: RegistroGovernanca):
    from app.services.sprint_governanca import salvar
    return salvar(ciclo_id, dados.model_dump(mode='json'), registro_id)


@router.delete('/cycles/{ciclo_id}/governance/{registro_id}')
def remover_registro_governanca(ciclo_id: str, registro_id: int, versao: int = Query(ge=1)):
    from app.services.sprint_governanca import remover
    return remover(ciclo_id, registro_id, versao)


@router.get('/cycles/{ciclo_id}/governance/history')
def consultar_historico_governanca(ciclo_id: str):
    from app.services.sprint_governanca import historico
    return historico(ciclo_id)
