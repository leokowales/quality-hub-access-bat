
from datetime import datetime, timezone
from uuid import uuid4
import sqlite3

from fastapi import HTTPException

from app.core.database import conectar_banco
from app.services.issue_types import demanda_util, filtrar_snapshot, tipo_ignorado


def agora():
    return datetime.now(timezone.utc).isoformat()


def _ciclo(row):
    return dict(row)


def _garantir_retorno_pendente(db):
    """Registra sprints devolvidas à fila sem alterar o histórico de ciclos."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS sprint_ativa_retorno_pendente (
            iteracao_id TEXT PRIMARY KEY,
            retornada_em TEXT NOT NULL
        )
    """)


def reativar(iteracao_id: str):
    with conectar_banco() as db:
        try:
            db.execute('BEGIN IMMEDIATE')
            _garantir_retorno_pendente(db)

            iteracao = db.execute("""
                SELECT id FROM iteracoes
                WHERE id = ? AND status = 'consolidada'
            """, (iteracao_id,)).fetchone()
            if not iteracao:
                raise HTTPException(404, 'Revisão consolidada não encontrada.')

            ativa = db.execute("""
                SELECT 1 FROM sprint_ativa_ciclos
                WHERE iteracao_id = ? AND status = 'ativa'
            """, (iteracao_id,)).fetchone()
            if ativa:
                raise HTTPException(409, 'A sprint já está ativa.')

            concluida = db.execute("""
                SELECT 1 FROM sprint_ativa_ciclos
                WHERE iteracao_id = ? AND status = 'concluida'
                LIMIT 1
            """, (iteracao_id,)).fetchone()
            if not concluida:
                raise HTTPException(409, 'Esta sprint não possui ciclos concluídos.')

            pendente = db.execute("""
                SELECT 1 FROM sprint_ativa_retorno_pendente
                WHERE iteracao_id = ?
            """, (iteracao_id,)).fetchone()
            if pendente:
                raise HTTPException(409, 'A sprint já está disponível para ativação.')

            db.execute("""
                INSERT INTO sprint_ativa_retorno_pendente (iteracao_id, retornada_em)
                VALUES (?, ?)
            """, (iteracao_id, agora()))
            db.commit()
            return {'iteracao_id': iteracao_id, 'status': 'disponivel'}
        except Exception:
            db.rollback()
            raise


def panorama():
    with conectar_banco() as db:
        _garantir_retorno_pendente(db)
        ativa = db.execute("""
            SELECT
                c.*,
                i.project_key,
                i.team_name,
                i.sprint_name
            FROM sprint_ativa_ciclos c
            JOIN iteracoes i
                ON i.id = c.iteracao_id
            WHERE c.status = 'ativa' AND c.congelada_em IS NULL
            LIMIT 1
        """).fetchone()

        disponiveis = db.execute("""
            SELECT
                i.id,
                i.project_key,
                i.team_name,
                i.sprint_name,
                i.atualizada_em,
                (SELECT c.congelada_em FROM sprint_ativa_ciclos c WHERE c.iteracao_id = i.id
                 AND c.status = 'ativa' AND c.congelada_em IS NOT NULL LIMIT 1) AS congelada_em
            FROM iteracoes i
            WHERE
                i.status = 'consolidada'
                AND (
                    NOT EXISTS (
                        SELECT 1 FROM sprint_ativa_ciclos c
                        WHERE c.iteracao_id = i.id
                    )
                    OR EXISTS (
                        SELECT 1 FROM sprint_ativa_ciclos c WHERE c.iteracao_id = i.id
                        AND c.status = 'ativa' AND c.congelada_em IS NOT NULL
                    )
                    OR EXISTS (
                        SELECT 1 FROM sprint_ativa_retorno_pendente p
                        WHERE p.iteracao_id = i.id
                    )
                )
            ORDER BY i.atualizada_em DESC
        """).fetchall()

        concluidas = db.execute("""
            SELECT
                i.id,
                i.project_key,
                i.team_name,
                i.sprint_name,
                MAX(c.concluida_em) AS concluida_em,
                COUNT(c.id) AS total_ciclos
            FROM iteracoes i
            JOIN sprint_ativa_ciclos c
                ON c.iteracao_id = i.id
            WHERE
                i.status = 'consolidada'
                AND c.status = 'concluida'
                AND NOT EXISTS (
                    SELECT 1 FROM sprint_ativa_retorno_pendente p
                    WHERE p.iteracao_id = i.id
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM sprint_ativa_ciclos a
                    WHERE
                        a.iteracao_id = i.id
                        AND a.status = 'ativa'
                )
            GROUP BY i.id
            ORDER BY concluida_em DESC
        """).fetchall()

        return {
            'ativa': _ciclo(ativa) if ativa else None,
            'disponiveis': [dict(item) for item in disponiveis],
            'concluidas': [dict(item) for item in concluidas],
        }


def ativar(iteracao_id: str):
    with conectar_banco() as db:
        try:
            db.execute('BEGIN IMMEDIATE')
            _garantir_retorno_pendente(db)

            iteracao = db.execute("""
                SELECT id, status
                FROM iteracoes
                WHERE id = ?
            """, (iteracao_id,)).fetchone()

            if not iteracao:
                raise HTTPException(
                    status_code=404,
                    detail='Revisão não encontrada.'
                )

            if iteracao['status'] != 'consolidada':
                raise HTTPException(
                    status_code=409,
                    detail='Somente revisões consolidadas podem ser ativadas.'
                )

            sprint_ativa = db.execute("""
                SELECT 1
                FROM sprint_ativa_ciclos
                WHERE status = 'ativa' AND congelada_em IS NULL
                LIMIT 1
            """).fetchone()

            if sprint_ativa:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        'Já existe uma sprint ativa. '
                        'Conclua ou congele a sprint antes de ativar outra.'
                    )
                )

            congelada = db.execute("""SELECT id, numero_ciclo FROM sprint_ativa_ciclos
                WHERE iteracao_id = ? AND status = 'ativa' AND congelada_em IS NOT NULL
                LIMIT 1""", (iteracao_id,)).fetchone()
            if congelada:
                db.execute('UPDATE sprint_ativa_ciclos SET congelada_em = NULL WHERE id = ?', (congelada['id'],))
                from app.services.sprint_governanca import continuar_na_ativacao
                continuidade = continuar_na_ativacao(db, congelada['id'])
                db.commit()
                return {'id': congelada['id'], 'iteracao_id': iteracao_id,
                        'numero_ciclo': congelada['numero_ciclo'], 'status': 'ativa', 'retomada': True, 'continuidade_governanca': continuidade}

            ultimo = db.execute("""
                SELECT MAX(numero_ciclo)
                FROM sprint_ativa_ciclos
                WHERE iteracao_id = ?
            """, (iteracao_id,)).fetchone()[0]

            numero = (ultimo or 0) + 1
            identificador = str(uuid4())

            db.execute("""
                INSERT INTO sprint_ativa_ciclos (
                    id,
                    iteracao_id,
                    numero_ciclo,
                    status,
                    ativada_em
                )
                VALUES (?, ?, ?, 'ativa', ?)
            """, (
                identificador,
                iteracao_id,
                numero,
                agora(),
            ))

            from app.services.sprint_governanca import continuar_na_ativacao
            continuidade = continuar_na_ativacao(db, identificador)

            db.execute("""
                DELETE FROM sprint_ativa_retorno_pendente
                WHERE iteracao_id = ?
            """, (iteracao_id,))
            db.commit()

            return {
                'id': identificador,
                'iteracao_id': iteracao_id,
                'numero_ciclo': numero,
                'status': 'ativa',
                'continuidade_governanca': continuidade,
            }

        except sqlite3.IntegrityError as erro:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail='Já existe uma sprint ativa.'
            ) from erro

        except Exception:
            db.rollback()
            raise


def concluir(ciclo_id: str, confirmacao_pendencias: bool = False, versao_esperada: int | None = None):
    with conectar_banco() as db:
        try:
            db.execute('BEGIN IMMEDIATE')

            ciclo = db.execute("""
                SELECT *
                FROM sprint_ativa_ciclos
                WHERE id = ?
            """, (ciclo_id,)).fetchone()

            if not ciclo:
                raise HTTPException(
                    status_code=404,
                    detail='Ciclo não encontrado.'
                )

            if ciclo['status'] != 'ativa' or ciclo['congelada_em']:
                raise HTTPException(
                    status_code=409,
                    detail='Este ciclo já está concluído.'
                )

            from app.services.sprint_rastreabilidade import registro, carregar, pendencias, evento
            r = registro(db, ciclo_id)
            estado, versao = carregar(db, r)
            if versao_esperada is not None and versao_esperada != versao:
                raise HTTPException(409, 'As decisões mudaram. Recarregue as pendências antes de concluir.')
            total_pendencias = pendencias(estado)
            if total_pendencias and not confirmacao_pendencias:
                raise HTTPException(422, f'Existem {total_pendencias} pendências. Confirme ciência para concluir com ressalvas.')
            evento(db, r, versao, None, 'conclusao', None, 'concluida',
                   f'Ciclo encerrado com {total_pendencias} pendências preservadas.')

            from app.services.sprint_governanca import encerrar_acompanhamento
            encerrar_acompanhamento(db, ciclo_id)

            db.execute("""
                UPDATE sprint_ativa_ciclos
                SET
                    status = 'concluida',
                    concluida_em = ?
                WHERE id = ?
            """, (
                agora(),
                ciclo_id,
            ))

            db.commit()

            return {
                'id': ciclo_id,
                'status': 'concluida',
            }

        except Exception:
            db.rollback()
            raise


# Snapshot operacional isolado: não altera sincronizações nem a revisão consolidada.
def _tabela_snapshot_operacional(db):
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_ativa_snapshots_operacionais (
        ciclo_id TEXT PRIMARY KEY, dados_json TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        FOREIGN KEY(ciclo_id) REFERENCES sprint_ativa_ciclos(id)
    )""")


def _tabela_evolucao(db):
    db.execute("""CREATE TABLE IF NOT EXISTS sprint_ativa_evolucao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ciclo_id TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        resumo_json TEXT NOT NULL,
        FOREIGN KEY(ciclo_id) REFERENCES sprint_ativa_ciclos(id)
    )""")
    db.execute("""CREATE INDEX IF NOT EXISTS idx_sprint_ativa_evolucao_ciclo
        ON sprint_ativa_evolucao(ciclo_id, id DESC)""")


def _valor_governanca(valor):
    """Representação estável e curta de campos monitorados; ausência é string vazia."""
    import json
    if valor is None:
        return ''
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, list):
        itens = sorted({_valor_governanca(item) for item in valor} - {''})
        return ', '.join(itens)
    if isinstance(valor, dict):
        for chave in ('name', 'value', 'displayName'):
            if isinstance(valor.get(chave), str):
                return valor[chave].strip()
        return json.dumps(valor, ensure_ascii=False, sort_keys=True)
    return str(valor)


def _resumo_operacional(snapshot, excluidas=None):
    # Snapshot normalizado: somente campos necessários à comparação.
    from app.services.sprint_ativa_indicadores import _tipo, _numero
    resumo = {}
    excluidas = set(excluidas or ())
    for d in snapshot.get('demandas', []):
        if not demanda_util(d) or not d.get('key') or d['key'] in excluidas:
            continue
        tp = _tipo(d.get('issue_type')) in ('assertthat test plan', 'test plan', 'testplan', 'tp')
        metricas = d.get('assertthat') if tp and isinstance(d.get('assertthat'), dict) else None
        relacoes = sorted({(r.get('relationship'), r.get('key')) for r in (d.get('qa_relationships') or [])
                            if isinstance(r, dict) and isinstance(r.get('relationship'), str) and isinstance(r.get('key'), str)})
        # Campos selecionados a partir dos alertas da Central de Revisão.
        # Guardar apenas valores presentes: campo ausente no payload não é pendência.
        campos_jira = d.get('jira_fields') if isinstance(d.get('jira_fields'), dict) else {}
        tipo_normalizado = _tipo(d.get('issue_type'))
        defeito = tipo_normalizado in ('bug', 'sub-bug', 'sub bug', 'subbug')
        concluido = str(d.get('status') or '').strip().casefold() in (
            'done', 'closed', 'resolved', 'concluído', 'concluido', 'fechado', 'resolvido')
        campos_governanca = {}
        monitorados = (
            ('root_cause', 'Causa raiz', defeito),
            ('developer', 'Desenvolvedor', defeito),
            ('mapping_status', 'Status do mapeamento', tp),
            ('test_case_mapping_owner', 'Responsável pelo mapeamento', tp),
        )
        for campo, rotulo, aplicavel in monitorados:
            if aplicavel and campo in campos_jira:
                campos_governanca[campo] = {'rotulo': rotulo, 'valor': _valor_governanca(campos_jira[campo])}
        if (defeito or tp) and 'categories' in d:
            campos_governanca['categories'] = {'rotulo': 'Categorias', 'valor': _valor_governanca(d['categories'])}
        resumo[d['key']] = {
            'tipo': d.get('issue_type') or '', 'titulo': d.get('summary') or d.get('title') or '',
            'status': d.get('status') or '',
            'testes': {campo: _numero(metricas.get(campo)) for campo in ('total', 'passed', 'failed', 'not_run', 'in_progress')} if metricas else None,
            'relacoes': [list(r) for r in relacoes],
            'governanca': campos_governanca,
            'rastreamento': d.get('_qualityhub_rastreamento', 'rastreada'),
            'origem_bug': d.get('_qualityhub_origem_bug'),
        }
    return resumo



def consultar_evolucao_diaria(ciclo_id: str):
    """Último snapshot válido por dia local, sem modificar o histórico técnico."""
    import json
    from zoneinfo import ZoneInfo
    from app.services.sprint_ativa_indicadores import _numero

    with conectar_banco() as db:
        ciclo = db.execute('''SELECT c.iteracao_id, cr.decisoes_json
            FROM sprint_ativa_ciclos c
            LEFT JOIN consolidacoes_revisao cr ON cr.iteracao_id = c.iteracao_id
            WHERE c.id = ?''', (ciclo_id,)).fetchone()
        if ciclo is None:
            raise HTTPException(404, 'Ciclo não encontrado.')
        _tabela_evolucao(db)
        registros = db.execute("""SELECT e.atualizado_em, e.resumo_json FROM sprint_ativa_evolucao e
            JOIN sprint_ativa_ciclos c ON c.id = e.ciclo_id
            WHERE c.iteracao_id = ? ORDER BY e.atualizado_em ASC, e.id ASC""",
            (ciclo['iteracao_id'],)).fetchall()

    dias = {}
    fuso = ZoneInfo('America/Sao_Paulo')
    for registro in registros:
        try:
            instante = datetime.fromisoformat(registro['atualizado_em'].replace('Z', '+00:00'))
            if instante.tzinfo is None:
                instante = instante.replace(tzinfo=timezone.utc)
            data = instante.astimezone(fuso).date().isoformat()
            resumo = json.loads(registro['resumo_json'])
            if not isinstance(resumo, dict):
                continue
            resumo = {k: i for k, i in resumo.items() if isinstance(i, dict) and not tipo_ignorado(i.get('tipo'))}
            # Cada resumo já registra o escopo aceito naquele instante; não reaplicar exclusões da baseline.
            metricas = [item['testes'] for item in resumo.values()
                        if isinstance(item, dict) and isinstance(item.get('testes'), dict)]
            total = sum(_numero(m.get('total')) for m in metricas)
            aprovados = sum(_numero(m.get('passed')) for m in metricas)
            falhados = sum(_numero(m.get('failed')) for m in metricas)
            executados = sum(max(0, _numero(m.get('total')) - _numero(m.get('not_run')) - _numero(m.get('in_progress'))) for m in metricas)
            # Contagens históricas calculadas do mesmo resumo persistido na sincronização.
            # Não inferir valores ausentes a partir de snapshots incompletos.
            from app.services.sprint_ativa_indicadores import _tipo
            itens_escopo = [item for item in resumo.values() if isinstance(item, dict) and 'tipo' in item]
            tipos = [_tipo(item.get('tipo')) for item in itens_escopo]
            escopo = {
                'demandas': len(itens_escopo),
                'historias': sum(t in ('historia', 'story', 'user story') for t in tipos),
                'test_plans': sum(t in ('assertthat test plan', 'test plan', 'testplan', 'tp') for t in tipos),
                'bugs': sum(t in ('bug', 'sub-bug', 'sub bug', 'subbug') for t in tipos),
                'bugs_originados': sum(item.get('origem_bug') == 'desta_sprint' for item in itens_escopo) if all('origem_bug' in item for item in itens_escopo) else None,
            } if itens_escopo else None
            dias[data] = {'data': data, 'atualizado_em': registro['atualizado_em'],
                          'total': total, 'aprovados': aprovados, 'falhados': falhados, 'executados': executados,
                          'restantes': max(0, total - aprovados - falhados),
                          'escopo': escopo}
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            continue
    return {'ciclo_id': ciclo_id, 'fuso_horario': 'America/Sao_Paulo',
            'pontos': [dias[d] for d in sorted(dias)]}


def consultar_evolucao(ciclo_id: str):
    import json
    with conectar_banco() as db:
        if not db.execute('SELECT 1 FROM sprint_ativa_ciclos WHERE id = ?', (ciclo_id,)).fetchone():
            raise HTTPException(404, 'Ciclo não encontrado.')
        _tabela_evolucao(db)
        linhas = db.execute('''SELECT e.atualizado_em, e.resumo_json FROM sprint_ativa_evolucao e
            JOIN sprint_ativa_ciclos c ON c.id = e.ciclo_id
            WHERE c.iteracao_id = (SELECT iteracao_id FROM sprint_ativa_ciclos WHERE id = ?)
            ORDER BY e.atualizado_em DESC, e.id DESC LIMIT 2''', (ciclo_id,)).fetchall()
    if not linhas:
        return {'estado': 'sem_referencia', 'mensagem': 'Sincronize a sprint para criar a referência de comparação.', 'mudancas': []}
    if len(linhas) == 1:
        return {'estado': 'aguardando_comparacao', 'atualizado_em': linhas[0]['atualizado_em'],
                'mensagem': 'Referência registrada. As mudanças aparecerão após a próxima sincronização.', 'mudancas': []}
    return _comparar_snapshots(linhas)


def _comparar_snapshots(linhas):
    import json
    atual, anterior = json.loads(linhas[0]['resumo_json']), json.loads(linhas[1]['resumo_json'])
    atual = {k: d for k, d in atual.items() if not tipo_ignorado(d.get('tipo'))}
    anterior = {k: d for k, d in anterior.items() if not tipo_ignorado(d.get('tipo'))}
    mudancas = []
    for chave in sorted(atual.keys() & anterior.keys()):
        a, b = atual[chave], anterior[chave]
        if a.get('rastreamento', 'rastreada') != b.get('rastreamento', 'rastreada'):
            ausente = a.get('rastreamento') == 'nao_encontrada'
            mudancas.append({'issue_key': chave, 'tipo': 'escopo', 'impacto': 'neutro',
                             'titulo': a['titulo'],
                             'descricao': ('Demanda não retornou na consulta do Jira; último estado válido preservado. '
                                           'Remoção ou perda de rastreabilidade ainda não confirmada.' if ausente
                                           else 'Demanda voltou a ser encontrada na consulta do Jira.')})
        if a['status'] != b['status']:
            mudancas.append({'issue_key': chave, 'tipo': 'status', 'impacto': 'neutro',
                             'titulo': a['titulo'],
                             'descricao': f"Status: {b['status'] or 'Sem status'} → {a['status'] or 'Sem status'}"})
        if a['testes'] is not None and b['testes'] is not None:
            campos = (('total', 'Total'), ('passed', 'Aprovados'), ('failed', 'Falhados'),
                      ('not_run', 'Não executados'), ('in_progress', 'Em andamento'))
            # Each metric retains its own impact; a status or another result
            # must not neutralize an independent improvement/regression.
            for campo, rotulo in campos:
                antes, depois = b['testes'][campo], a['testes'][campo]
                if antes == depois:
                    continue
                impacto = 'neutro'
                if a['testes']['total'] == b['testes']['total']:
                    if campo == 'passed':
                        impacto = 'melhoria' if depois > antes else 'regressao'
                    elif campo == 'failed':
                        impacto = 'regressao' if depois > antes else 'melhoria'
                mudancas.append({'issue_key': chave, 'tipo': 'execucao', 'campo': campo,
                                 'impacto': impacto, 'titulo': a['titulo'],
                                 'descricao': f'{rotulo}: {antes} → {depois}'})
        # Comparar apenas campos presentes nas duas leituras. Um snapshot antigo,
        # sem governança, não produz falsas mudanças na primeira sincronização.
        anterior_gov, atual_gov = b.get('governanca') or {}, a.get('governanca') or {}
        alteracoes_gov = []
        impactos_gov = []
        for campo in sorted(anterior_gov.keys() & atual_gov.keys()):
            antes, depois = anterior_gov[campo]['valor'], atual_gov[campo]['valor']
            if antes == depois:
                continue
            rotulo = atual_gov[campo]['rotulo']
            obrigatorio = campo not in ('root_cause', 'developer') or str(a.get('status') or '').strip().casefold() in (
                'done', 'closed', 'resolved', 'concluído', 'concluido', 'fechado', 'resolvido')
            if not antes and depois:
                impactos_gov.append('melhoria' if obrigatorio else 'neutro')
                detalhe = f'{rotulo} preenchido'
            elif antes and not depois:
                impactos_gov.append('regressao' if obrigatorio else 'neutro')
                detalhe = f'{rotulo} ficou sem preenchimento'
            else:
                impactos_gov.append('neutro')
                detalhe = f'{rotulo} alterado'
            alteracoes_gov.append(detalhe)
        if alteracoes_gov:
            impacto_gov = ('regressao' if 'regressao' in impactos_gov else
                            'neutro' if 'neutro' in impactos_gov else 'melhoria')
            mudancas.append({'issue_key': chave, 'tipo': 'governanca',
                             'impacto': impacto_gov, 'titulo': a['titulo'],
                             'descricao': ' · '.join(alteracoes_gov)})
        if a['relacoes'] != b['relacoes']:
            mudancas.append({'issue_key': chave, 'tipo': 'rastreabilidade', 'impacto': 'neutro',
                             'titulo': a['titulo'],
                             'descricao': 'Vínculos de rastreabilidade alterados; conferir relacionamentos atuais.'})
    # Preserve separate events for status, execution, governance and links.
    # Itens fora do escopo consolidado não são inferidos como novos bugs.
    contagem = {impacto: sum(m['impacto'] == impacto for m in mudancas)
                for impacto in ('melhoria', 'regressao', 'neutro')}
    return {'estado': 'comparado', 'atualizado_em': linhas[0]['atualizado_em'],
            'anterior_em': linhas[1]['atualizado_em'], 'total': len(mudancas),
            'por_impacto': contagem, 'mudancas': mudancas}


def consultar_historico_mudancas(ciclo_id: str):
    """Histórico de comparações entre snapshots consecutivos da mesma iteração."""
    import json
    with conectar_banco() as db:
        ciclo = db.execute("SELECT iteracao_id FROM sprint_ativa_ciclos WHERE id = ?", (ciclo_id,)).fetchone()
        if ciclo is None:
            raise HTTPException(404, "Ciclo não encontrado.")
        _tabela_evolucao(db)
        linhas = db.execute("""SELECT e.id, e.atualizado_em, e.resumo_json
            FROM sprint_ativa_evolucao e
            JOIN sprint_ativa_ciclos c ON c.id = e.ciclo_id
            WHERE c.iteracao_id = ?
            ORDER BY e.atualizado_em DESC, e.id DESC""", (ciclo["iteracao_id"],)).fetchall()
    mudancas = []
    for indice in range(len(linhas) - 1):
        try:
            comparacao = _comparar_snapshots(linhas[indice:indice + 2])
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            continue
        for mudanca in comparacao["mudancas"]:
            mudancas.append({**mudanca, "atualizado_em": comparacao["atualizado_em"],
                             "anterior_em": comparacao["anterior_em"],
                             "snapshot_id": linhas[indice]["id"]})
    return {"ciclo_id": ciclo_id, "total": len(mudancas), "mudancas": mudancas}


def obter_dados_operacionais(db, ciclo_id, dados_consolidados):
    import json
    _tabela_snapshot_operacional(db)
    linha = db.execute('SELECT dados_json, atualizado_em FROM sprint_ativa_snapshots_operacionais WHERE ciclo_id = ?', (ciclo_id,)).fetchone()
    if not linha:
        linha = db.execute('''SELECT o.dados_json, o.atualizado_em
            FROM sprint_ativa_snapshots_operacionais o JOIN sprint_ativa_ciclos c ON c.id=o.ciclo_id
            WHERE c.iteracao_id=(SELECT iteracao_id FROM sprint_ativa_ciclos WHERE id=?)
            ORDER BY c.numero_ciclo DESC LIMIT 1''', (ciclo_id,)).fetchone()
    if linha:
        return filtrar_snapshot(json.loads(linha['dados_json'])), linha['atualizado_em'], 'jira_atualizado'
    return filtrar_snapshot(json.loads(dados_consolidados)), None, 'revisao_consolidada'


async def sincronizar_sprint_operacional(ciclo_id: str):
    from app.services.sprint_rastreabilidade import sincronizar
    return await sincronizar(ciclo_id)


def congelar(ciclo_id: str):
    """Suspend a cycle without closing it or changing its operational records."""
    with conectar_banco() as db:
        try:
            db.execute('BEGIN IMMEDIATE')
            ciclo = db.execute('SELECT * FROM sprint_ativa_ciclos WHERE id = ?', (ciclo_id,)).fetchone()
            if not ciclo:
                raise HTTPException(404, 'Ciclo não encontrado.')
            if ciclo['status'] != 'ativa' or ciclo['congelada_em']:
                raise HTTPException(409, 'Somente uma sprint ativa pode ser congelada.')
            instante = agora()
            from app.services.sprint_governanca import encerrar_acompanhamento
            encerrar_acompanhamento(db, ciclo_id, instante)
            db.execute('UPDATE sprint_ativa_ciclos SET congelada_em = ? WHERE id = ?', (instante, ciclo_id))
            db.commit()
            return {'id': ciclo_id, 'status': 'congelada', 'congelada_em': instante}
        except Exception:
            db.rollback()
            raise
