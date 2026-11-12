
import json
import sqlite3
from uuid import uuid4

from fastapi import HTTPException

from app.core.database import conectar_banco
from app.services.issue_types import filtrar_snapshot
from app.services.review_governance import decisao_automatica
from app.services.iteration_storage import agora_iso, obter_iteracao
from app.services.snapshot_validation import validar_snapshot


def salvar_sincronizacao(
    iteracao_id: str,
    demandas: list[dict],
    contexto: dict | None = None,
    rastreabilidade: dict | None = None,
    demandas_excluidas: list[str] | None = None,
):
    iteracao = obter_iteracao(iteracao_id)

    if iteracao["status"] == "consolidada":
        raise HTTPException(
            status_code=409,
            detail="Não é possível sincronizar uma iteração consolidada.",
        )

    agora = agora_iso()
    sincronizacao_id = str(uuid4())

    dados_brutos = {
        "demandas": demandas,
        "contexto": contexto if contexto is not None else {},
        "rastreabilidade": rastreabilidade if rastreabilidade is not None else {},
        "demandas_excluidas": demandas_excluidas if demandas_excluidas is not None else [],
    }
    validar_snapshot(dados_brutos)
    dados = filtrar_snapshot(dados_brutos)
    validar_snapshot(dados)

    with conectar_banco() as conexao:
        registro = conexao.execute(
            """
            SELECT COALESCE(MAX(versao), 0) + 1
            FROM sincronizacoes
            WHERE iteracao_id = ?
            """,
            (iteracao_id,),
        ).fetchone()

        versao = registro[0]

        try:
            conexao.execute(
                """
                INSERT INTO sincronizacoes (
                    id,
                    iteracao_id,
                    versao,
                    dados_json,
                    criada_em
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    sincronizacao_id,
                    iteracao_id,
                    versao,
                    json.dumps(dados, ensure_ascii=False),
                    agora,
                ),
            )

            conexao.execute(
                """
                UPDATE iteracoes
                SET status = ?,
                    atualizada_em = ?
                WHERE id = ?
                """,
                ("em_revisao", agora, iteracao_id),
            )

        except sqlite3.IntegrityError as erro:
            raise HTTPException(
                status_code=409,
                detail="Conflito ao salvar a sincronização.",
            ) from erro

    return {
        "id": sincronizacao_id,
        "iteracao_id": iteracao_id,
        "versao": versao,
        "criada_em": agora,
    }


def obter_ultima_sincronizacao(iteracao_id: str):
    obter_iteracao(iteracao_id)

    with conectar_banco() as conexao:
        registro = conexao.execute(
            """
            SELECT *
            FROM sincronizacoes
            WHERE iteracao_id = ?
            ORDER BY versao DESC
            LIMIT 1
            """,
            (iteracao_id,),
        ).fetchone()

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma sincronização encontrada.",
        )

    dados = filtrar_snapshot(json.loads(registro['dados_json']))
    # Calculado na leitura, inclusive para snapshots antigos, sem regravar a baseline.
    for demanda in dados['demandas']:
        demanda['review'] = {**(demanda.get('review') or {}), 'automatic_decision': decisao_automatica(demanda)}

    return {
        "id": registro["id"],
        "iteracao_id": registro["iteracao_id"],
        "versao": registro["versao"],
        "criada_em": registro["criada_em"],
        "dados": dados,
    }
