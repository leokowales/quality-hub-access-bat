"""Decisão automática canônica da revisão; alertas informativos não bloqueiam inclusão."""
import math

from app.services.issue_types import tipo_ignorado


def vazio(value):
    return value is None or (isinstance(value, str) and not value.strip()) or (
        isinstance(value, (list, dict)) and not value
    )


def contagem(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or vazio(value):
        return None
    try:
        text = str(value).strip()
        number = float(int(text, 0)) if text.lower().startswith(('0x', '0b', '0o')) else float(text)
        return int(number) if math.isfinite(number) and number.is_integer() and 0 <= number <= 9007199254740991 else None
    except (ValueError, OverflowError):
        return None


def alertas_intervencao(demanda):
    tipo = str(demanda.get('issue_type') or '').strip().lower()
    status = str(demanda.get('status') or '').strip().lower()
    if tipo_ignorado(tipo) or status in {'cancelado', 'cancelada', 'cancelled', 'canceled'}:
        return []
    historia = tipo in {'história', 'historia', 'story', 'user story'}
    tp = tipo in {'assertthat test plan', 'test plan', 'testplan', 'tp'}
    bug = tipo in {'bug', 'sub-bug', 'sub bug', 'subbug'}
    inicial = historia and status in {'aberto', 'business refinement', 'ux refinement', 'awaiting technical refinement', 'technical refinement', 'backlog'}
    concluido = status in {'done', 'closed', 'resolved', 'concluído', 'concluido', 'fechado', 'resolvido'}
    campos = demanda.get('jira_fields') or {}
    relacoes = demanda.get('qa_relationships') or []
    alertas = []
    if historia and not inicial and not any(r.get('relationship') == 'test_plan' for r in relacoes):
        alertas.append('qa:historia_sem_tp')
    if tp:
        if not any(r.get('relationship') == 'tests_story' for r in relacoes):
            alertas.append('qa:tp_sem_historia')
        dados = demanda.get('assertthat')
        total = contagem(dados.get('total')) if isinstance(dados, dict) else None
        if total is None:
            total = contagem(campos.get('test_scenarios_count'))
        if total == 0:
            alertas.append('jira:zero_cenarios')
    if (tp or bug) and 'categories' in demanda and vazio(demanda['categories']):
        alertas.append('campo:categories')
    for campo, aplicavel in (
        ('root_cause', bug and concluido),
        ('developer', bug and status == 'concluído'),
        ('mapping_status', tp),
        ('test_case_mapping_owner', tp),
    ):
        if aplicavel and campo in campos and vazio(campos[campo]):
            alertas.append('jira:' + campo)
    for codigo in (demanda.get('review') or {}).get('alerts') or []:
        if codigo in {'sem_vinculo_com_escopo', 'periodo_explicito_fora_do_escopo'}:
            alertas.append('backend:' + codigo)
    return sorted(set(alertas))


def decisao_automatica(demanda):
    return 'pending' if alertas_intervencao(demanda) else 'include'
