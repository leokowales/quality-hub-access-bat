from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from datetime import date
from app.core.database import conectar_banco
from app.services.project import consultar_projeto_jira_service
from app.services.configuration_storage import resolver_id_local
from app.services.team import discovery_times_jira_service
from app.services.people import consultar_pessoas_jira_service

from app.schemas.configuration import (
    IdJira,
    ConfiguracaoRequest,
    ConfiguracaoResponse,
)
from app.services.configuration_storage import (
    obter_configuracao,
    salvar_configuracao,
)


router = APIRouter(
    prefix="/configuration",
    tags=["Configuração"],
)


@router.get(
    "",
    response_model=ConfiguracaoResponse,
)
def consultar():
    return obter_configuracao()


@router.put(
    "",
    response_model=ConfiguracaoResponse,
)
def atualizar(payload: ConfiguracaoRequest):
    configuracao_atual = obter_configuracao()

    if any(configuracao_atual.values()):
        raise HTTPException(
            status_code=409,
            detail=(
                "Já existem configurações salvas no SQLite. "
                "A importação inicial não pode sobrescrevê-las."
            ),
        )

    return salvar_configuracao(
        projetos=[projeto.model_dump() for projeto in payload.projetos],
        times=[time.model_dump() for time in payload.times],
        pessoas=[pessoa.model_dump() for pessoa in payload.pessoas],
    )

class NovoProjeto(BaseModel):
    chave: str = Field(min_length=1, max_length=50)


class NovoTime(BaseModel):
    projeto_id: int | float
    nome: str = Field(min_length=1, max_length=200)
    jira_id: IdJira


class NovaPessoa(BaseModel):
    time_id: int | float
    nome: str = Field(min_length=1, max_length=200)
    cargo: str = Field(default="QA", min_length=1, max_length=100)
    account_id: IdJira


class CargoPessoa(BaseModel):
    cargo: str = Field(default='', max_length=100)


class VinculoTimeJira(BaseModel):
    projeto_id: int | float
    jira_id: IdJira
    desde: date


class VinculoPessoaJira(BaseModel):
    time_id: int | float
    projeto_id: int | float
    account_id: IdJira


@router.delete('/projects/{projeto_id}', response_model=ConfiguracaoResponse)
def remover_projeto(projeto_id: int | float):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        local = resolver_id_local(db, 'projetos', projeto_id)
        projeto = db.execute('SELECT chave FROM projetos WHERE id=?', (local,)).fetchone()
        if not projeto:
            raise HTTPException(404, 'Projeto não cadastrado.')
        if db.execute('SELECT 1 FROM iteracoes WHERE UPPER(project_key)=UPPER(?) LIMIT 1', (projeto['chave'],)).fetchone():
            raise HTTPException(409, 'Este projeto possui iterações ou histórico e não pode ser excluído. Os dados foram preservados.')
        db.execute('DELETE FROM projetos WHERE id=?', (local,))
    return obter_configuracao()


@router.delete('/projects/{projeto_id}/teams/{time_id}', response_model=ConfiguracaoResponse)
def desvincular_time(projeto_id: int | float, time_id: int | float):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        projeto = resolver_id_local(db, 'projetos', projeto_id)
        time = resolver_id_local(db, 'times', time_id)
        if not db.execute('SELECT 1 FROM projetos WHERE id=?', (projeto,)).fetchone() or not db.execute('SELECT 1 FROM times WHERE id=?', (time,)).fetchone():
            raise HTTPException(404, 'Projeto ou time não cadastrado.')
        db.execute('DELETE FROM time_projetos WHERE projeto_id=? AND time_id=?', (projeto, time))
    return obter_configuracao()


@router.patch('/teams/{time_id}/jira', response_model=ConfiguracaoResponse)
async def identificar_time_jira(time_id: int | float, payload: VinculoTimeJira):
    with conectar_banco() as db:
        local = resolver_id_local(db, 'times', time_id)
        projeto = resolver_id_local(db, 'projetos', payload.projeto_id)
        contexto = db.execute('''SELECT p.chave FROM projetos p JOIN time_projetos tp ON tp.projeto_id=p.id
            WHERE tp.time_id=? AND p.id=?''', (local, projeto)).fetchone()
        if not contexto:
            raise HTTPException(404, 'Time não vinculado ao projeto informado.')
    dados = await discovery_times_jira_service(contexto['chave'], payload.desde)
    if not any(str(item.get('id')) == payload.jira_id for item in dados.get('teams', [])):
        raise HTTPException(422, 'O ID selecionado não foi encontrado neste projeto no Jira.')
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        registro = db.execute('SELECT jira_id FROM times WHERE id=?', (local,)).fetchone()
        if not registro or not db.execute('SELECT 1 FROM time_projetos WHERE time_id=? AND projeto_id=?', (local, projeto)).fetchone():
            raise HTTPException(409, 'O vínculo foi alterado. Atualize os cadastros.')
        if registro['jira_id'] and registro['jira_id'] != payload.jira_id:
            raise HTTPException(409, 'Este time já possui outro ID Jira. O cadastro foi preservado.')
        if db.execute('SELECT 1 FROM times WHERE jira_id=? AND id<>?', (payload.jira_id, local)).fetchone():
            raise HTTPException(409, 'Este ID Jira já está associado a outro time.')
        db.execute('UPDATE times SET jira_id=? WHERE id=?', (payload.jira_id, local))
    return obter_configuracao()


@router.patch('/people/{pessoa_id}/jira', response_model=ConfiguracaoResponse)
async def identificar_pessoa_jira(pessoa_id: int | float, payload: VinculoPessoaJira):
    with conectar_banco() as db:
        local = resolver_id_local(db, 'pessoas', pessoa_id)
        time = resolver_id_local(db, 'times', payload.time_id)
        projeto = resolver_id_local(db, 'projetos', payload.projeto_id)
        contexto = db.execute('''SELECT p.chave,t.nome,t.jira_id FROM projetos p
            JOIN time_projetos tp ON tp.projeto_id=p.id JOIN times t ON t.id=tp.time_id
            JOIN pessoa_times pt ON pt.time_id=t.id WHERE pt.pessoa_id=? AND t.id=? AND p.id=?''',
            (local, time, projeto)).fetchone()
        if not contexto:
            raise HTTPException(404, 'Pessoa não vinculada ao time e projeto informados.')
    dados = await consultar_pessoas_jira_service(contexto['chave'], contexto['nome'], contexto['jira_id'])
    if not any(item.get('accountId') == payload.account_id for item in dados.get('people', [])):
        raise HTTPException(422, 'A pessoa selecionada não foi encontrada neste time no Jira.')
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        registro = db.execute('SELECT account_id FROM pessoas WHERE id=?', (local,)).fetchone()
        if not registro or not db.execute('''SELECT 1 FROM pessoa_times pt JOIN time_projetos tp ON tp.time_id=pt.time_id
            WHERE pt.pessoa_id=? AND pt.time_id=? AND tp.projeto_id=?''', (local, time, projeto)).fetchone():
            raise HTTPException(409, 'O vínculo foi alterado. Atualize os cadastros.')
        if registro['account_id'] and registro['account_id'] != payload.account_id:
            raise HTTPException(409, 'Esta pessoa já possui outro ID Jira. O cadastro foi preservado.')
        if db.execute('SELECT 1 FROM pessoas WHERE account_id=? AND id<>?', (payload.account_id, local)).fetchone():
            raise HTTPException(409, 'Este ID Jira já está associado a outra pessoa.')
        db.execute('UPDATE pessoas SET account_id=? WHERE id=?', (payload.account_id, local))
    return obter_configuracao()


@router.patch('/people/{pessoa_id}/role', response_model=ConfiguracaoResponse)
def atualizar_cargo_pessoa(pessoa_id: int | float, payload: CargoPessoa):
    with conectar_banco() as db:
        pessoa_local = resolver_id_local(db, 'pessoas', pessoa_id)
        if not db.execute('SELECT 1 FROM pessoas WHERE id=?', (pessoa_local,)).fetchone():
            raise HTTPException(404, 'Pessoa não cadastrada.')
        db.execute('UPDATE pessoas SET cargo=? WHERE id=?', (payload.cargo.strip(), pessoa_local))
    return obter_configuracao()


@router.post("/projects", response_model=ConfiguracaoResponse, status_code=201)
async def adicionar_projeto(payload: NovoProjeto):
    # Valida acesso e usa ID/nome oficiais do Jira. Nunca substitui cadastros.
    resultado = await consultar_projeto_jira_service(payload.chave)
    projeto = resultado["project"]
    if not projeto.get("id") or not projeto.get("key") or not projeto.get("name"):
        raise HTTPException(502, "O Jira retornou dados incompletos do projeto.")
    with conectar_banco() as conexao:
        existente = conexao.execute(
            "SELECT id FROM projetos WHERE UPPER(chave) = UPPER(?) OR id = ?",
            (projeto["key"], str(projeto["id"])),
        ).fetchone()
        if existente:
            raise HTTPException(409, "Este projeto já está cadastrado.")
        conexao.execute(
            "INSERT INTO projetos (id, chave, nome) VALUES (?, ?, ?)",
            (str(projeto["id"]), projeto["key"], projeto["name"]),
        )
    return obter_configuracao()


@router.post("/teams", response_model=ConfiguracaoResponse, status_code=201)
def adicionar_time(payload: NovoTime):
    nome = payload.nome.strip()
    if not nome or not payload.jira_id.strip():
        raise HTTPException(422, "Informe o nome do time.")
    with conectar_banco() as conexao:
        conexao.execute('BEGIN IMMEDIATE')
        projeto_id = resolver_id_local(conexao, 'projetos', payload.projeto_id)
        if not conexao.execute("SELECT 1 FROM projetos WHERE id = ?", (projeto_id,)).fetchone():
            raise HTTPException(404, "Projeto não cadastrado.")
        existente = conexao.execute("SELECT id FROM times WHERE jira_id = ?", (payload.jira_id.strip(),)).fetchone()
        if existente:
            time_id = existente["id"]
            conexao.execute('UPDATE times SET nome=? WHERE id=?', (nome, time_id))
        else:
            time_id = str(conexao.execute("SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 FROM times").fetchone()[0])
            conexao.execute("INSERT INTO times (id, nome, jira_id) VALUES (?, ?, ?)", (time_id, nome, payload.jira_id.strip()))
        vinculo = conexao.execute("SELECT 1 FROM time_projetos WHERE time_id=? AND projeto_id=?", (time_id, projeto_id)).fetchone()
        if not vinculo:
            conexao.execute("INSERT INTO time_projetos (time_id, projeto_id) VALUES (?, ?)", (time_id, projeto_id))
    return obter_configuracao()


@router.post("/people", response_model=ConfiguracaoResponse, status_code=201)
def adicionar_pessoa(payload: NovaPessoa):
    nome = payload.nome.strip()
    if not nome or not payload.account_id.strip():
        raise HTTPException(422, "Informe o nome da pessoa.")
    with conectar_banco() as conexao:
        conexao.execute('BEGIN IMMEDIATE')
        time_id = resolver_id_local(conexao, 'times', payload.time_id)
        if not conexao.execute("SELECT 1 FROM times WHERE id=?", (time_id,)).fetchone():
            raise HTTPException(404, "Time não cadastrado.")
        existente = conexao.execute("SELECT id FROM pessoas WHERE account_id = ?", (payload.account_id.strip(),)).fetchone()
        if existente:
            pessoa_id = existente["id"]
            conexao.execute('UPDATE pessoas SET nome=? WHERE id=?', (nome, pessoa_id))
        else:
            pessoa_id = str(conexao.execute("SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 FROM pessoas").fetchone()[0])
            conexao.execute("INSERT INTO pessoas (id, nome, cargo, account_id) VALUES (?, ?, ?, ?)", (pessoa_id, nome, payload.cargo, payload.account_id.strip()))
        if not conexao.execute("SELECT 1 FROM pessoa_times WHERE pessoa_id=? AND time_id=?", (pessoa_id, time_id)).fetchone():
            conexao.execute("INSERT INTO pessoa_times (pessoa_id, time_id) VALUES (?, ?)", (pessoa_id, time_id))
    return obter_configuracao()


@router.delete('/teams/{time_id}/people/{pessoa_id}', response_model=ConfiguracaoResponse)
def remover_pessoa_do_time(time_id: int | float, pessoa_id: int | float):
    with conectar_banco() as db:
        db.execute('BEGIN IMMEDIATE')
        time_local = resolver_id_local(db, 'times', time_id)
        pessoa_local = resolver_id_local(db, 'pessoas', pessoa_id)
        if not db.execute('SELECT 1 FROM times WHERE id=?', (time_local,)).fetchone():
            raise HTTPException(404, 'Time não cadastrado.')
        if not db.execute('SELECT 1 FROM pessoas WHERE id=?', (pessoa_local,)).fetchone():
            raise HTTPException(404, 'Pessoa não cadastrada.')
        db.execute('DELETE FROM pessoa_times WHERE pessoa_id=? AND time_id=?', (pessoa_local, time_local))
    return obter_configuracao()
