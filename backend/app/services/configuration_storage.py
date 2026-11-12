from fastapi import HTTPException
from decimal import Decimal
import sqlite3

from app.core.database import conectar_banco

def id_para_banco(valor):
    numero = Decimal(str(valor))
    return str(int(numero)) if numero == numero.to_integral_value() else str(numero.normalize())


def id_para_frontend(valor):
    numero = float(valor)
    return int(numero) if numero.is_integer() else numero


def resolver_id_local(conexao, tabela, valor):
    # Conserva chaves legadas como "1.0" sem regravar relações existentes.
    canonico = id_para_banco(valor)
    encontrados = [r['id'] for r in conexao.execute(f'SELECT id FROM {tabela}') if id_para_banco(r['id']) == canonico]
    if len(encontrados) > 1:
        raise HTTPException(409, 'IDs locais ambíguos no cadastro legado. Revise os cadastros antes de vincular.')
    return encontrados[0] if encontrados else canonico


def salvar_configuracao(projetos, times, pessoas):
    try:
        with conectar_banco() as conexao:
            # Atualiza os cadastros e vínculos na mesma transação.
            # A operação só é concluída se todos os dados forem válidos.

            conexao.execute("DELETE FROM pessoa_times")
            conexao.execute("DELETE FROM time_projetos")
            conexao.execute("DELETE FROM pessoas")
            conexao.execute("DELETE FROM times")
            conexao.execute("DELETE FROM projetos")

            for projeto in projetos:
                conexao.execute(
                    """
                    INSERT INTO projetos (id, chave, nome)
                    VALUES (?, ?, ?)
                    """,
                    (
                        id_para_banco(projeto["id"]),
                        projeto["chave"],
                        projeto["nome"],
                    ),
                )

            for time in times:
                conexao.execute(
                    """
                    INSERT INTO times (id, nome, jira_id)
                    VALUES (?, ?, ?)
                    """,
                    (
                        id_para_banco(time["id"]),
                        time["nome"],
                        time.get('jira_id'),
                    ),
                )

                for projeto_id in time.get("projetosIds", []):
                    conexao.execute(
                        """
                        INSERT INTO time_projetos (time_id, projeto_id)
                        VALUES (?, ?)
                        """,
                        (id_para_banco(time["id"]), id_para_banco(projeto_id)),
                    )

            for pessoa in pessoas:
                conexao.execute(
                    """
                    INSERT INTO pessoas (id, nome, cargo, account_id)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        id_para_banco(pessoa["id"]),
                        pessoa["nome"],
                        pessoa["cargo"],
                        pessoa.get('account_id'),
                    ),
                )

                for time_id in pessoa.get("timesIds", []):
                    conexao.execute(
                        """
                        INSERT INTO pessoa_times (pessoa_id, time_id)
                        VALUES (?, ?)
                        """,
                        (id_para_banco(pessoa["id"]), id_para_banco(time_id)),
                    )

    except (KeyError, TypeError, ValueError, sqlite3.IntegrityError) as erro:
        raise HTTPException(
            status_code=422,
            detail=f"Dados de configuração inválidos: {erro}",
        )

    return obter_configuracao()


def obter_configuracao():
    with conectar_banco() as conexao:
        projetos = [
            {**dict(registro), "id": id_para_frontend(registro["id"])}
            for registro in conexao.execute(
                "SELECT id, chave, nome FROM projetos ORDER BY id"
            ).fetchall()
        ]

        times = []
        for registro in conexao.execute(
                "SELECT id, nome, jira_id FROM times ORDER BY id"
        ).fetchall():
            time = dict(registro)
            time_id_banco = time["id"]
            time["id"] = id_para_frontend(time_id_banco)

            time["projetosIds"] = [
                id_para_frontend(vinculo["projeto_id"])
                for vinculo in conexao.execute(
                    """
                    SELECT projeto_id
                    FROM time_projetos
                    WHERE time_id = ?
                    """,
                    (time_id_banco,),
                ).fetchall()
            ]

            times.append(time)

        pessoas = []
        for registro in conexao.execute(
            "SELECT id, nome, account_id, cargo FROM pessoas ORDER BY id"
        ).fetchall():
            pessoa = dict(registro)
            pessoa_id_banco = pessoa["id"]
            pessoa["id"] = id_para_frontend(pessoa_id_banco)

            pessoa["timesIds"] = [
                id_para_frontend(vinculo["time_id"])
                for vinculo in conexao.execute(
                    """
                    SELECT time_id
                    FROM pessoa_times
                    WHERE pessoa_id = ?
                    """,
                    (pessoa_id_banco,),
                ).fetchall()
            ]

            pessoas.append(pessoa)

    return {
        "projetos": projetos,
        "times": times,
        "pessoas": pessoas,
    }
