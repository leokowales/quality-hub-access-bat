import re
from collections import deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from app.core.credentials import obter_credenciais_jira
from app.services.iteration import _rotulo, _valores
from app.services.jira_fields import campos_adicionais, detalhes_jira
from app.services.bug_history import aplicar_memoria
from app.services.issue_types import tipo_ignorado
from app.services.jira_pagination import proximo_token_seguro
from app.services.jira_http import get_jira_com_retry
TIPOS_HISTORIA = {"história", "historia", "story", "user story"}
TIPOS_TP = {"assertthat test plan", "test plan", "testplan", "tp"}
TIPOS_DEFEITO = {"bug", "sub-bug", "sub bug", "subbug"}
TIPOS_EPIC = {"epic", "épico"}
TIPOS_QA = TIPOS_HISTORIA | TIPOS_TP | TIPOS_DEFEITO | TIPOS_EPIC
PADRAO_KEY = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
PADRAO_QA = re.compile(
    r"(?:\[\s*QA\s*[- ]*\s*([A-Z][A-Z0-9_]*)\s*[- ]\s*(\d+)\s*\]"
    r"|\bQA\s*\[?\s*([A-Z][A-Z0-9_]*)\s*[- ]\s*(\d+)\s*\]?)",
    re.I,
)


def _data_jira(valor):
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _ciclo_defeito(demanda, historico):
    """Reconstrói ciclos de abertura/resolução sem inferir atividade de updated.

    A janela de uma sprint vai até completeDate, quando disponível. A
    associação temporal é inferida; um changelog Sprint explícito é evidência
    mais forte, mas listas históricas do campo Sprint não são prova de posse.
    """
    criado = _data_jira(demanda.get("created"))
    resolvido_atual = _data_jira(demanda.get("resolved"))
    eventos = []
    for item in historico:
        quando = _data_jira(item.get("created"))
        if not quando:
            continue
        for alteracao in item.get("items") or []:
            campo = str(alteracao.get("field") or "").casefold()
            if campo in ("status", "resolution", "sprint"):
                eventos.append({"at": quando, "field": campo,
                                "from": alteracao.get("fromString"),
                                "to": alteracao.get("toString")})
    eventos.sort(key=lambda e: e["at"])
    fechados = {"concluído", "concluido", "done", "resolved", "closed", "fechado", "resolvido"}
    # Agrupar eventos no mesmo instante: Jira frequentemente altera status e
    # resolution na mesma transição; isso não representa duas resoluções.
    grupos = {}
    for evento in eventos:
        grupos.setdefault(evento["at"], []).append(evento)
    resolucoes, reaberturas = [], []
    for instante, grupo in sorted(grupos.items()):
        fecha = abre = False
        for evento in grupo:
            antes = str(evento["from"] or "").strip().casefold()
            depois = str(evento["to"] or "").strip().casefold()
            if evento["field"] == "status":
                fecha |= depois in fechados and antes not in fechados
                abre |= antes in fechados and depois not in fechados
            elif evento["field"] == "resolution":
                fecha |= bool(depois and not antes)
                abre |= bool(antes and not depois)
        if fecha and not abre:
            resolucoes.append(instante)
        elif abre and not fecha:
            reaberturas.append(instante)
    # A resolução vigente vem de fields.resolutiondate. Um evento antigo de
    # resolução não pode tornar concluído um bug atualmente reaberto.
    fechamento = resolvido_atual
    if fechamento and not resolucoes:
        resolucoes = [fechamento]
    sprints = []
    for sprint in (demanda.get("jira_fields") or {}).get("sprint") or []:
        if not isinstance(sprint, dict) or sprint.get("id") is None:
            continue
        inicio = _data_jira(sprint.get("startDate"))
        fim_planejado = _data_jira(sprint.get("endDate"))
        fim_real = _data_jira(sprint.get("completeDate"))
        fim = fim_real or fim_planejado
        if inicio and fim and inicio <= fim:
            sprints.append((str(sprint["id"]), inicio, fim, fim_planejado))
    # Changelog pode registrar IDs ou nomes; só usamos identificação exata.
    def ids_historicos(valor):
        texto = str(valor or "")
        return {sid for sid, _, _, _ in sprints if
                re.search(r"(?<!\d)" + re.escape(sid) + r"(?!\d)", texto)}
    movimentos = [e for e in eventos if e["field"] == "sprint"]
    def associado(sid, instante):
        if not movimentos:
            return None
        # Retroceder a partir da associação atual, usando somente mudanças
        # identificáveis; se os dados não permitem reconstrução, inconclusivo.
        atual = {str(s["id"]) for s in demanda.get("sprints") or [] if isinstance(s, dict) and s.get("id") is not None}
        for e in reversed(movimentos):
            if e["at"] <= instante:
                break
            antes, depois = ids_historicos(e["from"]), ids_historicos(e["to"])
            if not antes and not depois:
                return None
            atual = (atual - depois) | antes
        return sid in atual
    def localizar(instante):
        if instante is None:
            return None, "unknown"
        candidatas = [(sid, associado(sid, instante)) for sid, ini, fim, planejado in sprints if ini <= instante <= fim and (planejado is None or instante <= planejado or associado(sid, instante) is True)]
        confirmadas = [sid for sid, pertence in candidatas if pertence is True]
        if len(confirmadas) == 1:
            return confirmadas[0], "changelog_and_date" if movimentos else "inferred_by_date"
        possiveis = [sid for sid, pertence in candidatas if pertence is not False]
        if len(possiveis) == 1:
            return possiveis[0], "inferred_by_date"
        return None, "ambiguous" if possiveis else "not_found"
    origem, confianca_origem = localizar(criado)
    resolucao, confianca_resolucao = localizar(fechamento)
    # Períodos em aberto: somente após a criação e antes de cada resolução;
    # reaberturas iniciam um novo período. O último período permanece aberto
    # se resolutiondate estiver vazio.
    transicoes = sorted([(d, "close") for d in resolucoes] + [(d, "open") for d in reaberturas])
    janelas = []
    cursor = criado
    for instante, tipo in transicoes:
        if cursor is None and tipo == "open":
            cursor = instante
        elif cursor is not None and tipo == "close" and instante >= cursor:
            janelas.append((cursor, instante))
            cursor = None
    if cursor is not None:
        janelas.append((cursor, fechamento if fechamento and fechamento >= cursor else None))
    carregadas = []
    for sid, inicio, fim, _ in sprints:
        if origem is None or sid == origem:
            continue  # Não inventar carregamento sem conhecer a origem.
        origem_inicio = next((ini for chave, ini, _, _ in sprints if chave == origem), None)
        if origem_inicio is None or inicio <= origem_inicio:
            continue
        if associado(sid, inicio) is not True:
            continue
        # Estar aberto no início da sprint posterior caracteriza carregamento.
        if any(a <= inicio and (b is None or inicio < b) for a, b in janelas):
            carregadas.append(sid)
    return {
        "origin_sprint_id": origem,
        "origin_confidence": confianca_origem,
        "resolution_sprint_id": resolucao,
        "resolution_confidence": confianca_resolucao,
        "first_resolved_at": min(resolucoes).isoformat() if resolucoes else None,
        "last_resolved_at": fechamento.isoformat() if fechamento else None,
        "reopened_count": len(reaberturas),
        "reopened_at": [r.isoformat() for r in reaberturas],
        "carried_sprint_ids": sorted(set(carregadas)),
        "sprint_membership_history": [{"at": e["at"].isoformat(), "from": e["from"], "to": e["to"]} for e in movimentos],
        "history_complete": True,
        "attribution_method": "jira_changelog_and_effective_sprint_dates",
    }


def _nome(campo):
    return campo.get("name") if isinstance(campo, dict) else None
def _chave(referencia):
    return referencia.get("key") if isinstance(referencia, dict) else None
def _tipo(issue):
    fields = issue.get("fields") or {}
    return (_nome(fields.get("issuetype")) or "").strip().casefold()
def _referencias_resumo(resumo):
    return {
        f"{(m.group(1) or m.group(3)).upper()}-{m.group(2) or m.group(4)}"
        for m in PADRAO_QA.finditer(resumo or "")
    }
def _relacoes(issue):
    fields = issue.get("fields") or {}
    key = issue.get("key")
    if not key:
        return []
    resultado = []
    parent = _chave(fields.get("parent"))
    if parent and parent != key:
        resultado.append({
            "origem": key,
            "destino": parent,
            "tipo": "parent",
            "direcao": "ancestral",
        })
    for link in fields.get("issuelinks") or []:
        if not isinstance(link, dict):
            continue
        tipo = (link.get("type") or {}).get("name") or "issue_link"
        for campo, direcao in (
            ("outwardIssue", "outward"),
            ("inwardIssue", "inward"),
        ):
            destino = _chave(link.get(campo))
            if destino and destino != key:
                resultado.append({
                    "origem": key,
                    "destino": destino,
                    "tipo": tipo,
                    "direcao": direcao,
                })
    return resultado
def _formatar_issue(issue, url, sprint_fields, quarter_fields):
    fields = issue.get("fields") or {}
    sprints = {}
    quarters = set()
    for campo in sprint_fields:
        for sprint in _valores(fields.get(campo["id"])):
            if not isinstance(sprint, dict):
                continue
            sprint_id = sprint.get("id")
            if sprint_id is None:
                continue
            sprint_id = str(sprint_id)
            sprints[sprint_id] = {
                "id": sprint["id"],
                "name": sprint.get("name") or sprint_id,
                "state": sprint.get("state"),
            }
    for campo in quarter_fields:
        for quarter in _valores(fields.get(campo["id"])):
            nome = _rotulo(quarter)
            if nome:
                quarters.add(f'{campo["id"]}:{nome}')
    key = issue.get("key")
    return {
        "id": issue.get("id"),
        "key": key,
        "summary": fields.get("summary") or "",
        "status": _nome(fields.get("status")),
        "issue_type": _nome(fields.get("issuetype")),
        "priority": _nome(fields.get("priority")),
        "assignee": (
            (fields.get("assignee") or {}).get("displayName")
        ),
        "created": fields.get("created"),
        "updated": fields.get("updated"),
        "sprints": list(sprints.values()),
        "quarters": sorted(quarters),
        "parent_key": _chave(fields.get("parent")),
        "relationships": _relacoes(issue),
        "assertthat": (issue.get("properties") or {}).get("assertthat-scenarios"),
        **detalhes_jira(issue),
        "url": f"{url}/browse/{key}" if key else None,
    }
def _quarter_corresponde(valores, selecionados):
    if not selecionados:
        return True
    def normalizar(valor):
        valor = str(valor).strip().casefold()
        if valor.startswith("customfield_") and ":" in valor:
            return valor.split(":", 1)[-1]
        return valor
    return bool(
        {normalizar(v) for v in valores}
        & {normalizar(v) for v in selecionados}
    )
def _classificar_revisao(demanda, quarters, sprint_ids, vinculo_valido):
    """
    Classifica a issue para a revisão.
    Uma classificação explícita em período diferente
    prevalece sobre a ausência de outros metadados.
    """
    sprints_issue = {
        str(s["id"]) for s in demanda["sprints"]
    }
    quarters_issue = {
        str(q).split(":", 1)[-1].strip()
        for q in demanda["quarters"]
    }
    quarters_reais = {
        q for q in quarters_issue
        if q.casefold() != "backlog"
    }
    sprint_ok = bool(
        sprint_ids and sprints_issue.intersection(sprint_ids)
    )
    quarter_ok = bool(
        quarters
        and _quarter_corresponde(quarters_reais, quarters)
    )
    sprint_fora = bool(
        sprint_ids and sprints_issue and not sprint_ok
    )
    quarter_fora = bool(
        quarters and quarters_reais and not quarter_ok
    )
    if sprint_fora or quarter_fora:
        return {
            "eligible": False,
            "recommendation": "exclude",
            "alerts": ["periodo_explicito_fora_do_escopo"],
        }
    if not (sprint_ok or quarter_ok or vinculo_valido):
        return {
            "eligible": False,
            "recommendation": "exclude",
            "alerts": ["sem_vinculo_com_escopo"],
        }
    alertas = []
    if sprint_ids and not sprints_issue:
        alertas.append("sprint_ausente")
    if quarters and not quarters_reais:
        alertas.append("quarter_ausente_ou_backlog")
    return {
        "eligible": True,
        "recommendation": "review" if alertas else "include",
        "alerts": alertas,
    }
def _vinculo_tp_historia(tp, historias):
    fields = tp.get("fields") or {}
    referencias = set()
    parent = _chave(fields.get("parent"))
    if parent in historias:
        referencias.add(parent)
    referencias.update(
        _referencias_resumo(fields.get("summary")) & historias
    )
    for relacao in _relacoes(tp):
        if (
            relacao["tipo"] != "parent"
            and relacao["destino"] in historias
        ):
            referencias.add(relacao["destino"])
    return referencias
def _construir_vinculos_qa(todas):
    historias = {
        key for key, issue in todas.items()
        if _tipo(issue) in TIPOS_HISTORIA
    }
    tps = {
        key for key, issue in todas.items()
        if _tipo(issue) in TIPOS_TP
    }
    vinculos = {}
    def registrar(historia, tp, origem):
        if historia not in historias or tp not in tps:
            return
        vinculos.setdefault((historia, tp), set()).add(origem)
    for tp_key in sorted(tps):
        tp = todas[tp_key]
        fields = tp.get("fields") or {}
        registrar(
            _chave(fields.get("parent")),
            tp_key,
            "parent",
        )
        for referencia in _referencias_resumo(fields.get("summary")):
            registrar(referencia, tp_key, "summary")
        for relacao in _relacoes(tp):
            if relacao["tipo"] != "parent":
                registrar(
                    relacao["destino"],
                    tp_key,
                    "issuelinks",
                )
    # Considera também links registrados no lado da História.
    for historia_key in sorted(historias):
        historia = todas[historia_key]
        for relacao in _relacoes(historia):
            if relacao["tipo"] != "parent":
                registrar(
                    historia_key,
                    relacao["destino"],
                    "issuelinks",
                )
    resultado = {key: [] for key in todas}
    for (historia, tp), origens in sorted(vinculos.items()):
        fontes = sorted(origens)
        resultado[historia].append({
            "key": tp,
            "relationship": "test_plan",
            "sources": fontes,
        })
        resultado[tp].append({
            "key": historia,
            "relationship": "tests_story",
            "sources": fontes,
        })
    return resultado, len(vinculos)
async def extrair_demandas_iteracao_service(
    project_key,
    team_name,
    start_date,
    end_date,
    quarters,
    sprint_ids,
):
    url, email, token = obter_credenciais_jira()
    url = url.rstrip("/")
    project_key = project_key.strip().upper()
    team_name = team_name.strip()
    quarters = list(quarters or [])
    sprint_ids = [str(s) for s in (sprint_ids or [])]
    parsed = urlparse(url)
    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="A data inicial não pode ser posterior à data final.",
        )
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise HTTPException(
            status_code=500,
            detail="URL Jira Cloud salva inválida.",
        )
    if any(not s.isdigit() for s in sprint_ids):
        raise HTTPException(
            status_code=422,
            detail="IDs de Sprint inválidos.",
        )
    async def get(client, path, params=None, permitir_ausente=False):
        response = await get_jira_com_retry(
            client,
            f"{url}{path}",
            params=params,
            auth=(email, token),
            headers={"Accept": "application/json"},
        )
        if response.status_code == 404 and permitir_ausente:
            return None
        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=403,
                detail="Sem autenticação ou permissão no Jira.",
            )
        if response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail="Recurso Jira não encontrado ou sem acesso.",
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Erro Jira HTTP {response.status_code}: "
                    f"{response.text[:300]}"
                ),
            )
        return response.json()
    async def buscar_jql(client, jql, campos):
        resultados = []
        pagina_token = None
        tokens_vistos = set()
        while True:
            params = {
                "jql": jql,
                "fields": campos,
                "properties": "assertthat-scenarios",
                "maxResults": 100,
            }
            if pagina_token:
                params["nextPageToken"] = pagina_token
            pagina = await get(client, "/rest/api/3/search/jql", params)
            resultados.extend(pagina.get("issues") or [])
            if pagina.get("isLast") is True:
                break
            pagina_token = proximo_token_seguro(
                pagina.get("nextPageToken"), tokens_vistos, exigir_token=True
            )
        return resultados
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=False,
        ) as client:
            campos = await get(
                client,
                "/rest/api/3/field",
            )
            campo_team = next(
                (
                    campo
                    for campo in campos
                    if campo.get("name", "").strip().casefold() == "team"
                    and (campo.get("schema") or {}).get("type") == "team"
                ),
                None,
            )
            if not campo_team:
                raise HTTPException(
                    status_code=404,
                    detail="Campo Team não encontrado no Jira.",
                )
            sprint_fields = [
                campo
                for campo in campos
                if campo.get("name", "").strip().casefold() == "sprint"
            ]
            quarter_fields = [
                campo
                for campo in campos
                if campo.get("name", "").strip().casefold()
                in ("quarter", "trimestre")
            ]
            campos_solicitados = list(dict.fromkeys([
                "summary",
                "status",
                "issuetype",
                "priority",
                "assignee",
                "created",
                "updated",
                "parent",
                "issuelinks",
                *campos_adicionais(campos),
                campo_team["id"],
                *[
                    campo["id"]
                    for campo in sprint_fields + quarter_fields
                ],
            ]))
            campos_param = ",".join(campos_solicitados)
            # Demandas diretas da iteração.
            jql = (
                f'project = "{project_key}" '
                'AND issuetype in ("Epic", "História", "AssertThat Test Plan", "Bug", "Sub-Bug") '
            )
            if sprint_ids:
                jql += (
                    "AND Sprint in ("
                    + ",".join(sprint_ids)
                    + ") "
                )
            else:
                jql += (
                    f'AND created >= "{start_date.isoformat()}" '
                    f'AND created < '
                    f'"{(end_date + timedelta(days=1)).isoformat()}" '
                )
            iniciais = await buscar_jql(
                client,
                jql + "ORDER BY key ASC",
                campos_param,
            )
            diretas = {}
            for issue in iniciais:
                fields = issue.get("fields") or {}
                teams = [
                    team
                    for team in _valores(fields.get(campo_team["id"]))
                    if isinstance(team, dict)
                ]
                if not any(
                    str(team.get("name", "")).strip().casefold()
                    == team_name.casefold()
                    for team in teams
                ):
                    continue
                demanda = _formatar_issue(
                    issue,
                    url,
                    sprint_fields,
                    quarter_fields,
                )
                quarters_informados = {
                    str(q).split(":", 1)[-1].strip()
                    for q in demanda["quarters"]
                }
                quarters_reais = {
                    q for q in quarters_informados
                    if q.casefold() != "backlog"
                }
                if (
                    quarters
                    and not sprint_ids
                    and quarters_reais
                    and not _quarter_corresponde(quarters_reais, quarters)
                ):
                    continue
                if sprint_ids and not (
                    {str(s["id"]) for s in demanda["sprints"]}
                    & set(sprint_ids)
                ):
                    continue
                if issue.get("key"):
                    diretas[issue["key"]] = issue
            todas = dict(diretas)
            motivos = {
                key: {"direct"}
                for key in diretas
            }
            pendentes = set()
            fontes_inclusao = {}

            def registrar_origem(destino, origem, motivo):
                if not destino or not origem or destino == origem:
                    return
                fontes_inclusao.setdefault(destino, set()).add((origem, motivo))

            def incorporar(issue, motivo):
                key = issue.get("key")
                if not key:
                    return False
                if key in todas:
                    motivos.setdefault(key, set()).add(motivo)
                    return False
                todas[key] = issue
                motivos[key] = {motivo}
                return True
            async def recuperar(key, motivo):
                if not key or not PADRAO_KEY.fullmatch(key):
                    if key:
                        pendentes.add(key)
                    return False
                if key in todas:
                    motivos.setdefault(key, set()).add(motivo)
                    return False
                issue = await get(
                    client,
                    f"/rest/api/3/issue/{key}",
                    {"fields": campos_param, "properties": "assertthat-scenarios"},
                    permitir_ausente=True,
                )
                if issue is None:
                    pendentes.add(key)
                    return False
                return incorporar(issue, motivo)
            # Escopo fechado: somente demandas diretas e contexto comprovado.
            # Nunca expandir descendentes de Epic ou de História apenas por parent.
            async def recuperar_ancestrais(chaves):
                fila = deque(chaves)
                visitados_ancestrais = set()
                while fila:
                    key = fila.popleft()
                    if key in visitados_ancestrais or key not in todas:
                        continue
                    visitados_ancestrais.add(key)
                    issue = todas[key]
                    if _tipo(issue) in TIPOS_EPIC:
                        continue
                    parent = _chave((issue.get("fields") or {}).get("parent"))
                    if not parent or parent == key:
                        continue
                    registrar_origem(parent, key, "ancestor")
                    if parent not in todas:
                        await recuperar(parent, "ancestor")
                    if parent in todas and _tipo(todas[parent]) in TIPOS_QA:
                        fila.append(parent)

            # Relações laterais permitidas: História <-> TP e vínculos
            # explícitos com defeitos. Um item de rastreabilidade NÃO se
            # torna uma nova raiz para varrer todos os seus irmãos/filhos.
            async def recuperar_vinculo(origem, destino, tipos_permitidos):
                if not destino or not PADRAO_KEY.fullmatch(destino):
                    return
                if not destino.startswith(project_key + "-"):
                    return
                if destino not in todas:
                    await recuperar(destino, "qa_link")
                if destino in todas and _tipo(todas[destino]) in tipos_permitidos:
                    registrar_origem(destino, origem, "qa_link")
                elif destino in todas and destino not in diretas:
                    # Não manter um ticket recuperado que não representa
                    # um relacionamento elegível.
                    if motivos.get(destino) == {"qa_link"}:
                        todas.pop(destino, None)
                        motivos.pop(destino, None)

            for key, issue in list(diretas.items()):
                tipo_origem = _tipo(issue)
                if tipo_origem not in (TIPOS_HISTORIA | TIPOS_TP | TIPOS_DEFEITO):
                    continue
                for relacao in _relacoes(issue):
                    if relacao["tipo"] == "parent":
                        continue
                    destino = relacao["destino"]
                    if tipo_origem in TIPOS_TP:
                        permitidos = TIPOS_HISTORIA | TIPOS_DEFEITO
                    elif tipo_origem in TIPOS_HISTORIA:
                        permitidos = TIPOS_TP | TIPOS_DEFEITO
                    else:
                        permitidos = TIPOS_HISTORIA | TIPOS_TP
                    await recuperar_vinculo(key, destino, permitidos)

            # TP pode conter referência à US no parent ou no summary,
            # mesmo quando o Jira não apresenta um issue link explícito.
            # Examinar TPs do projeto não implica importá-los todos.
            historias_diretas = {
                key for key, issue in diretas.items()
                if _tipo(issue) in TIPOS_HISTORIA
            }
            if historias_diretas:
                jql_tp = (
                    f'project = "{project_key}" '
                    'AND issuetype = "AssertThat Test Plan" ORDER BY key ASC'
                )
                for tp in await buscar_jql(client, jql_tp, campos_param):
                    if _tipo(tp) not in TIPOS_TP:
                        continue
                    correspondencias = _vinculo_tp_historia(tp, historias_diretas)
                    if not correspondencias:
                        continue
                    incorporar(tp, "qa_test_plan")
                    for historia in correspondencias:
                        registrar_origem(tp["key"], historia, "qa_test_plan")

            # TPs diretos também podem referenciar a US no summary/parent,
            # mesmo que a US esteja fora da sprint.
            for key, issue in list(diretas.items()):
                if _tipo(issue) not in TIPOS_TP:
                    continue
                fields = issue.get("fields") or {}
                candidatas = set(_referencias_resumo(fields.get("summary")))
                parent = _chave(fields.get("parent"))
                if parent:
                    candidatas.add(parent)
                for candidata in candidatas:
                    await recuperar_vinculo(key, candidata, TIPOS_HISTORIA)

            # Somente agora recuperamos ancestrais dos itens realmente
            # relacionados a uma demanda direta; sem buscar descendentes.
            await recuperar_ancestrais(list(todas))
            # Consultar changelog de defeitos e TPs, sem usar updated
            # como evidência de reabertura. A falha de acesso não inventa fatos.
            ciclos_defeitos = {}
            for chave, issue in todas.items():
                if _tipo(issue) not in (TIPOS_DEFEITO | TIPOS_TP):
                    continue
                historico = []
                inicio_hist = 0
                completo = True
                while True:
                    try:
                        pagina = await get(
                            client, f"/rest/api/3/issue/{chave}/changelog",
                            {"startAt": inicio_hist, "maxResults": 100},
                            permitir_ausente=True,
                        )
                    except HTTPException as exc:
                        if exc.status_code in (403, 404):
                            pagina = None
                        else:
                            raise
                    if pagina is None:
                        completo = False
                        break
                    itens = pagina.get("values") or []
                    historico.extend(itens)
                    inicio_hist += len(itens)
                    total_hist = pagina.get("total")
                    if pagina.get("isLast") is True or (isinstance(total_hist, int) and inicio_hist >= total_hist):
                        break
                    if not itens:
                        completo = False
                        break
                formatado = _formatar_issue(issue, url, sprint_fields, quarter_fields)
                ciclo = _ciclo_defeito(formatado, historico)
                ciclo["history_complete"] = completo
                if not completo:
                    ciclo["reopened_count"] = None
                    ciclo["reopened_at"] = []
                    ciclo["carried_sprint_ids"] = []
                    ciclo["attribution_method"] = "dates_only_history_unavailable"
                ciclos_defeitos[chave] = ciclo

            # Reconstrução lógica História <-> Test Plan.
            todas = {key: issue for key, issue in todas.items()
                     if not tipo_ignorado(((issue.get('fields') or {}).get('issuetype') or {}).get('name'))}
            diretas = {key: issue for key, issue in diretas.items() if key in todas}
            qa_por_issue, total_vinculos_qa = (
                _construir_vinculos_qa(todas)
            )
            demandas = []
            formatadas = {
                key: _formatar_issue(
                    issue,
                    url,
                    sprint_fields,
                    quarter_fields,
                )
                for key, issue in todas.items()
            }
            # Toda issue em 'todas' foi incluída por sprint direta,
            # vínculo QA explícito ou por ser ancestral de uma delas.
            for key, demanda in formatadas.items():
                direta = key in diretas
                # A origem da extração não depende da sprint do ancestral.
                # Sprint da demanda -> direta; contexto sem sprint -> rastreabilidade.
                demanda["scope"] = "direct" if direta else "traceability"
                demanda["inclusion_reasons"] = sorted(
                    motivos.get(key, set())
                )
                demanda["inclusion_sources"] = [
                    {"key": origem, "reason": motivo}
                    for origem, motivo in sorted(fontes_inclusao.get(key, set()))
                ]

                demanda["qa_relationships"] = (
                    qa_por_issue.get(key, [])
                )
                if key in ciclos_defeitos:
                    if _tipo(todas[key]) in TIPOS_DEFEITO:
                        demanda["bug_lifecycle"] = ciclos_defeitos[key]
                    else:
                        demanda["rollover_lifecycle"] = ciclos_defeitos[key]
                demanda["review"] = {
                    "eligible": True,
                    "recommendation": "include",
                    "alerts": [],
                    "decision": "pending",
                    "decision_source": None,
                }
                # A inclusão definitiva será definida na revisão.
                demanda["included_in_metrics"] = False
                demandas.append(demanda)
            aplicar_memoria(project_key, team_name, sprint_ids, demandas)
            return {
                "status": "ok",
                "project_key": project_key,
                "team_name": team_name,
                "period": {
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                },
                "filters": {
                    "quarters": quarters,
                    "sprint_ids": sprint_ids,
                },
                "total": len(demandas),
                "total_direct": len(diretas),
                "total_traceability": (
                    len(demandas) - len(diretas)
                ),
                "qa_links_total": total_vinculos_qa,
                "issues": demandas,
                "traceability": {
                    "complete": not pendentes,
                    "limit_reached": False,
                    "unresolved_keys": sorted(pendentes),
                    "incomplete_queries": [],
                },
                "review_required": True,
            }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="O Jira demorou demais para responder.",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível acessar o Jira.",
        )
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(
            status_code=502,
            detail="O Jira retornou dados inesperados.",
        )
