
import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from app.core.database import conectar_banco
from app.services.issue_types import filtrar_snapshot
from app.services.review_governance import decisao_automatica
from app.services.snapshot_validation import validar_snapshot

# Configuração para testes em ambiente de desenvolvimento.
# False = protege revisões consolidadas.
# True = permite excluir revisões consolidadas pela API.
PERMITIR_EXCLUSAO_CONSOLIDADAS = False


def agora_iso():
    return datetime.now(timezone.utc).isoformat()


def criar_iteracao(
    project_key: str,
    team_name: str,
    sprint_id: str = "",
    sprint_name: str = "",
    data_inicio: str | None = None,
    data_fim: str | None = None,
    sprints: list[str] | None = None,
    quarters: list[str] | None = None,
    sincronizacao_inicial: dict | None = None,
):
    project_key = project_key.strip().upper()
    team_name = team_name.strip()
    sprint_id = str(sprint_id).strip()
    sprint_name = sprint_name.strip()

    sprints = [
        str(sprint).strip()
        for sprint in (sprints or [])
        if str(sprint).strip()
    ]

    quarters = [
        str(quarter).strip()
        for quarter in (quarters or [])
        if str(quarter).strip()
    ]

    if not project_key or not team_name:
        raise HTTPException(
            status_code=422,
            detail="Projeto e time são obrigatórios.",
        )

    if not sprints and not sprint_id and not quarters:
        raise HTTPException(
            status_code=422,
            detail="Selecione pelo menos uma sprint ou quarter.",
        )

    if sprint_id and sprint_id not in sprints:
        sprints.insert(0, sprint_id)

    if not sprint_id and sprints:
        sprint_id = sprints[0]

    if not sprint_name:
        sprint_name = sprint_id

    if data_inicio and data_fim and data_inicio > data_fim:
        raise HTTPException(
            status_code=422,
            detail="A data inicial não pode ser posterior à data final.",
        )

    iteracao_id = str(uuid4())
    agora = agora_iso()

    if sincronizacao_inicial is not None:
        validar_snapshot(sincronizacao_inicial)
        sincronizacao_inicial = filtrar_snapshot(sincronizacao_inicial)
        validar_snapshot(sincronizacao_inicial, exigir_demandas=True)
        demandas = sincronizacao_inicial.get('demandas') or []
        chaves = [d.get('key') for d in demandas]
        if not chaves or any(not isinstance(k, str) or not k.strip() for k in chaves) or len(set(chaves)) != len(chaves):
            raise HTTPException(422, 'O primeiro snapshot deve conter demandas com chaves válidas e únicas.')
        dados_iniciais = json.dumps(sincronizacao_inicial, ensure_ascii=False)

    try:
        with conectar_banco() as conexao:
            conexao.execute(
                """
                INSERT INTO iteracoes (
                    id,
                    project_key,
                    team_name,
                    sprint_id,
                    sprint_name,
                    data_inicio,
                    data_fim,
                    sprints_json,
                    quarters_json,
                    status,
                    criada_em,
                    atualizada_em
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    iteracao_id,
                    project_key,
                    team_name,
                    sprint_id,
                    sprint_name,
                    data_inicio,
                    data_fim,
                    json.dumps(sprints, ensure_ascii=False),
                    json.dumps(quarters, ensure_ascii=False),
                    "em_revisao" if sincronizacao_inicial is not None else "pendente",
                    agora,
                    agora,
                ),
            )
            if sincronizacao_inicial is not None:
                conexao.execute(
                    '''INSERT INTO sincronizacoes (id, iteracao_id, versao, dados_json, criada_em)
                       VALUES (?, ?, 1, ?, ?)''',
                    (str(uuid4()), iteracao_id, dados_iniciais, agora),
                )

    except sqlite3.IntegrityError as erro:
        raise HTTPException(
            status_code=409,
            detail="Não foi possível criar a iteração devido a um conflito de integridade no banco de dados.",
        ) from erro

    return obter_iteracao(iteracao_id)


def listar_iteracoes():
    with conectar_banco() as conexao:
        registros = conexao.execute(
            """
            SELECT *
            FROM iteracoes
            ORDER BY criada_em DESC, id DESC
            """
        ).fetchall()

    return [dict(registro) for registro in registros]


def obter_iteracao(iteracao_id: str):
    with conectar_banco() as conexao:
        registro = conexao.execute(
            """
            SELECT *
            FROM iteracoes
            WHERE id = ?
            """,
            (iteracao_id,),
        ).fetchone()

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail="Iteração não encontrada.",
        )

    return dict(registro)


DECISOES_VALIDAS = {"include", "exclude", "pending"}


def listar_decisoes_revisao(iteracao_id: str):
    obter_iteracao(iteracao_id)

    with conectar_banco() as conexao:
        registros = conexao.execute(
            """
            SELECT *
            FROM decisoes_revisao
            WHERE iteracao_id = ?
            ORDER BY criada_em DESC, rowid DESC
            """,
            (iteracao_id,),
        ).fetchall()

    # Preserva a decisão mais recente caso existam registros antigos duplicados.
    decisoes = {}

    for registro in registros:
        chave = registro["issue_key"]
        if chave not in decisoes:
            decisoes[chave] = dict(registro)

    return list(decisoes.values())


def salvar_decisao_revisao(
    iteracao_id: str,
    issue_key: str,
    decisao: str,
    justificativa: str | None = None,
):
    iteracao = obter_iteracao(iteracao_id)

    if iteracao["status"] == "consolidada":
        raise HTTPException(
            status_code=409,
            detail=(
                "Não é possível alterar decisões "
                "de uma iteração consolidada."
            ),
        )

    issue_key = issue_key.strip().upper()
    decisao = decisao.strip().lower()
    justificativa = (justificativa or "").strip() or None

    if not issue_key:
        raise HTTPException(
            status_code=422,
            detail="A chave da demanda é obrigatória.",
        )

    if decisao not in DECISOES_VALIDAS:
        raise HTTPException(
            status_code=422,
            detail="Decisão inválida.",
        )

    agora = agora_iso()

    with conectar_banco() as conexao:
        registro = conexao.execute(
            """
            SELECT id
            FROM decisoes_revisao
            WHERE iteracao_id = ? AND issue_key = ?
            ORDER BY criada_em DESC, rowid DESC
            LIMIT 1
            """,
            (iteracao_id, issue_key),
        ).fetchone()

        if registro:
            decisao_id = registro["id"]

            conexao.execute(
                """
                UPDATE decisoes_revisao
                SET decisao = ?,
                    justificativa = ?,
                    origem = 'manual',
                    atualizada_em = ?
                WHERE id = ?
                """,
                (decisao, justificativa, agora, decisao_id),
            )
        else:
            decisao_id = str(uuid4())

            conexao.execute(
                """
                INSERT INTO decisoes_revisao (
                    id, iteracao_id, issue_key,
                    decisao, justificativa,
                    origem, criada_em, atualizada_em
                )
                VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
                """,
                (
                    decisao_id,
                    iteracao_id,
                    issue_key,
                    decisao,
                    justificativa,
                    agora,
                    agora,
                ),
            )

        conexao.execute(
            """
            UPDATE iteracoes
            SET atualizada_em = ?,
                status = CASE
                    WHEN status = 'pendente' THEN 'em_revisao'
                    ELSE status
                END
            WHERE id = ?
            """,
            (agora, iteracao_id),
        )

        resultado = conexao.execute(
            """
            SELECT *
            FROM decisoes_revisao
            WHERE id = ?
            """,
            (decisao_id,),
        ).fetchone()

    return dict(resultado)


def listar_iteracoes_paginadas(
    status: str,
    busca: str = "",
    projeto: str = "",
    time: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    pagina: int = 1,
    limite: int = 10,
):
    condicoes = []
    parametros = []

    if status == "pendentes":
        condicoes.append(
            "status IN ('pendente', 'em_revisao')"
        )
    elif status == "historico":
        condicoes.append("status = 'consolidada'")
    else:
        raise HTTPException(
            status_code=422,
            detail="Categoria de revisão inválida.",
        )

    if busca.strip():
        condicoes.append("""
            instr(
                lower(project_key || ' ' || team_name || ' ' || sprint_name),
                lower(?)
            ) > 0
        """)
        parametros.append(busca.strip())

    if projeto.strip():
        condicoes.append("project_key = ?")
        parametros.append(projeto.strip().upper())

    if time.strip():
        condicoes.append("team_name = ? COLLATE NOCASE")
        parametros.append(time.strip())

    if data_inicio:
        condicoes.append("substr(criada_em, 1, 10) >= ?")
        parametros.append(data_inicio)

    if data_fim:
        condicoes.append("substr(criada_em, 1, 10) <= ?")
        parametros.append(data_fim)

    where = " AND ".join(condicoes)
    offset = (pagina - 1) * limite

    with conectar_banco() as conexao:
        total = conexao.execute(
            f"SELECT COUNT(*) FROM iteracoes WHERE {where}",
            parametros,
        ).fetchone()[0]

        registros = conexao.execute(
            f"""
            SELECT *
            FROM iteracoes
            WHERE {where}
            ORDER BY atualizada_em DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*parametros, limite, offset],
        ).fetchall()

    return {
        "itens": [dict(registro) for registro in registros],
        "total": total,
        "pagina": pagina,
        "limite": limite,
        "total_paginas": max(
            1, (total + limite - 1) // limite
        ),
    }

def assinatura_finalizacao(sincronizacao, decisoes, pendentes):
    import hashlib
    assinatura_dados = {
        "sincronizacao_id": sincronizacao["id"],
        "versao": sincronizacao["versao"],
        "pendentes": pendentes,
        "decisoes": sorted(
            [
                {
                    "issue_key": d["issue_key"],
                    "decisao": d["decisao"],
                    "justificativa": d["justificativa"],
                    "atualizada_em": d["atualizada_em"],
                }
                for d in decisoes
            ],
            key=lambda item: item["issue_key"],
        ),
    }

    assinatura = hashlib.sha256(
        json.dumps(
            assinatura_dados,
            sort_keys=True,
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()
    return assinatura


def _estado_finalizacao(conexao, iteracao_id, chaves_pendentes):
    iteracao = conexao.execute('SELECT status FROM iteracoes WHERE id = ?', (iteracao_id,)).fetchone()
    if iteracao is None:
        raise HTTPException(404, 'Iteração não encontrada.')
    if iteracao['status'] == 'consolidada':
        raise HTTPException(409, 'Esta revisão já foi finalizada.')
    sincronizacao = conexao.execute(
        'SELECT id, versao, dados_json FROM sincronizacoes WHERE iteracao_id = ? ORDER BY versao DESC LIMIT 1',
        (iteracao_id,),
    ).fetchone()
    if sincronizacao is None:
        raise HTTPException(409, 'Não existe uma sincronização para consolidar.')
    dados = filtrar_snapshot(json.loads(sincronizacao['dados_json']))
    demandas = dados.get('demandas', [])
    if not demandas:
        raise HTTPException(409, 'A iteração não possui demandas válidas.')
    chaves = set()
    for demanda in demandas:
        chave = demanda.get('key')
        if not isinstance(chave, str) or not chave.strip():
            raise HTTPException(409, 'Existem demandas sem chave válida.')
        if chave in chaves:
            raise HTTPException(409, f'Demanda duplicada na sincronização: {chave}.')
        chaves.add(chave)
    # Campo legado é validado, mas não determina as decisões do servidor.
    if not set(chaves_pendentes).issubset(chaves):
        raise HTTPException(422, 'Existem pendências fora do escopo da iteração.')
    registros = conexao.execute(
        'SELECT * FROM decisoes_revisao WHERE iteracao_id = ? ORDER BY criada_em DESC, rowid DESC',
        (iteracao_id,),
    ).fetchall()
    mapa = {}
    for registro in registros:
        mapa.setdefault(registro['issue_key'], dict(registro))
    pendentes = sorted(d['key'] for d in demandas if (
        mapa[d['key']]['decisao'] if d['key'] in mapa else decisao_automatica(d)
    ) == 'pending')
    ressalvas = []
    if pendentes:
        ressalvas.append({'tipo': 'decisoes_pendentes', 'titulo': 'Decisões ainda pendentes',
                         'quantidade': len(pendentes), 'chaves': pendentes})
    rastreabilidade = dados.get('rastreabilidade') or {}
    nao_resolvidas = sorted(set(rastreabilidade.get('unresolved_keys') or []))
    if nao_resolvidas:
        ressalvas.append({'tipo': 'rastreabilidade', 'titulo': 'Vínculos não resolvidos',
                         'quantidade': len(nao_resolvidas), 'chaves': nao_resolvidas})
    consultas = rastreabilidade.get('incomplete_queries') or []
    if rastreabilidade.get('complete') is False or consultas or rastreabilidade.get('limit_reached'):
        ressalvas.append({'tipo': 'extracao_incompleta', 'titulo': 'Extração ou rastreabilidade incompleta',
                         'quantidade': max(1, len(consultas)), 'chaves': [], 'consultas': consultas})
    assinatura = assinatura_finalizacao(sincronizacao, list(mapa.values()), pendentes)
    return sincronizacao, demandas, mapa, pendentes, ressalvas, assinatura


def preparar_finalizacao_revisao(
    iteracao_id: str,
    chaves_pendentes: list[str],
):
    with conectar_banco() as conexao:
        conexao.execute("BEGIN")
        sincronizacao, demandas, mapa_decisoes, pendentes, ressalvas, assinatura = _estado_finalizacao(
            conexao, iteracao_id, chaves_pendentes,
        )
        total_excluidas = sum(mapa_decisoes.get(d['key'], {}).get('decisao') == 'exclude' for d in demandas)
        total_aprovadas = len(demandas) - len(pendentes) - total_excluidas

        return {
            "iteracao_id": iteracao_id,
            "sincronizacao_id": sincronizacao["id"],
            "versao": sincronizacao["versao"],
            "total_demandas": len(demandas),
            "total_aprovadas": total_aprovadas,
            "total_excluidas": total_excluidas,
            "total_decisoes_pendentes": len(pendentes),
            "ressalvas": ressalvas,
            "pode_finalizar": True,
            "assinatura": assinatura,
        }



def finalizar_revisao(
    iteracao_id: str,
    assinatura: str,
    confirmacao_ressalvas: bool,
    chaves_pendentes: list[str],
):
    with conectar_banco() as conexao:
        conexao.execute("BEGIN IMMEDIATE")

        sincronizacao, demandas, mapa_decisoes, pendentes, ressalvas, assinatura_atual = _estado_finalizacao(
            conexao, iteracao_id, chaves_pendentes,
        )
        import hmac
        if not assinatura.isascii() or not hmac.compare_digest(assinatura, assinatura_atual):
            raise HTTPException(409, 'A revisão mudou desde a prévia. Consulte uma nova prévia antes de finalizar.')
        pendentes_calculadas = set(pendentes)

        decisoes_consolidadas = []
        pendentes_aceitas = []
        total_incluidas = 0
        total_excluidas = 0

        for demanda in demandas:
            chave = demanda["key"]
            registro = mapa_decisoes.get(chave)
            decisao_anterior = (
                registro["decisao"] if registro else None
            )

            if decisao_anterior == "exclude":
                decisao_final = "exclude"
                total_excluidas += 1
            else:
                decisao_final = "include"
                total_incluidas += 1

            era_pendente = chave in pendentes_calculadas

            if era_pendente:
                pendentes_aceitas.append(chave)

            decisoes_consolidadas.append({
                "issue_key": chave,
                "decisao": decisao_final,
                "decisao_anterior": (
                    decisao_anterior
                    or (
                        "pending"
                        if era_pendente
                        else "include"
                    )
                ),
                "origem": (
                    "pendencia_aceita_na_finalizacao"
                    if era_pendente
                    else (
                        registro["origem"]
                        if registro
                        else "automatica"
                    )
                ),
                "justificativa": (
                    registro["justificativa"]
                    if registro
                    else None
                ),
            })

        if ressalvas and not confirmacao_ressalvas:
            raise HTTPException(
                422,
                "Confirme ciência das ressalvas para finalizar.",
            )

        agora = agora_iso()
        consolidacao_id = str(uuid4())

        conexao.execute(
            """
            INSERT INTO consolidacoes_revisao (
                id, iteracao_id, sincronizacao_id,
                sincronizacao_versao, justificativa,
                ressalvas_json, decisoes_json, consolidada_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                consolidacao_id,
                iteracao_id,
                sincronizacao["id"],
                sincronizacao["versao"],
                (
                    "QA confirmou a finalização. "
                    "Demandas pendentes foram incluídas "
                    "com ressalvas preservadas."
                ),
                json.dumps(ressalvas, ensure_ascii=False),
                json.dumps(
                    decisoes_consolidadas,
                    ensure_ascii=False,
                ),
                agora,
            ),
        )

        conexao.execute(
            """
            UPDATE iteracoes
            SET status = 'consolidada',
                atualizada_em = ?
            WHERE id = ?
            """,
            (agora, iteracao_id),
        )

    return {
        "id": consolidacao_id,
        "iteracao_id": iteracao_id,
        "status": "consolidada",
        "sincronizacao_versao": sincronizacao["versao"],
        "consolidada_em": agora,
        "total_incluidas": total_incluidas,
        "total_excluidas": total_excluidas,
        "total_pendencias_aceitas": len(pendentes_aceitas),
        "ressalvas": ressalvas,
    }

def excluir_iteracao(iteracao_id: str):
    with conectar_banco() as conexao:
        conexao.execute("BEGIN IMMEDIATE")

        iteracao = conexao.execute(
            """
            SELECT id, status
            FROM iteracoes
            WHERE id = ?
            """,
            (iteracao_id,),
        ).fetchone()

        if iteracao is None:
            raise HTTPException(
                status_code=404,
                detail="Revisão não encontrada.",
            )

        status = iteracao["status"]

        # Consolidadas só podem ser excluídas quando
        # a configuração de teste estiver habilitada.
        if status == "consolidada" and not PERMITIR_EXCLUSAO_CONSOLIDADAS:
            raise HTTPException(
                status_code=409,
                detail="Revisões consolidadas não podem ser excluídas.",
            )

        if status not in ("pendente", "em_revisao", "consolidada"):
            raise HTTPException(
                status_code=409,
                detail="Status não permite exclusão.",
            )

        consolidacao = conexao.execute(
            """
            SELECT id
            FROM consolidacoes_revisao
            WHERE iteracao_id = ?
            LIMIT 1
            """,
            (iteracao_id,),
        ).fetchone()

        # Protege qualquer revisão que possua uma consolidação,
        # mesmo que seu status esteja inconsistente.
        if consolidacao is not None and not PERMITIR_EXCLUSAO_CONSOLIDADAS:
            raise HTTPException(
                status_code=409,
                detail="Esta revisão possui uma consolidação e não pode ser excluída.",
            )

        # Remove a consolidação associada somente quando
        # a exclusão de consolidadas estiver habilitada.
        if PERMITIR_EXCLUSAO_CONSOLIDADAS:
            conexao.execute(
                """
                DELETE FROM consolidacoes_revisao
                WHERE iteracao_id = ?
                """,
                (iteracao_id,),
            )

        conexao.execute(
            "DELETE FROM decisoes_revisao WHERE iteracao_id = ?",
            (iteracao_id,),
        )

        conexao.execute(
            "DELETE FROM sincronizacoes WHERE iteracao_id = ?",
            (iteracao_id,),
        )

        conexao.execute(
            """
            DELETE FROM iteracoes
            WHERE id = ?
            """,
            (iteracao_id,),
        )

    return {
        "sucesso": True,
        "mensagem": "Revisão excluída com sucesso.",
        "iteracao_id": iteracao_id,
    }
