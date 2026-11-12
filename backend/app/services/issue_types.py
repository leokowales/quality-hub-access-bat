"""Tipos sem participação no produto, inclusive ao ler snapshots antigos."""
import unicodedata


def tipo_ignorado(valor):
    texto = ''.join(c for c in unicodedata.normalize('NFKD', str(valor or '').casefold()) if not unicodedata.combining(c))
    return ''.join(c for c in texto if c.isalnum()) in {'subtarefa', 'subtask', 'spike'}


def demanda_util(demanda):
    return isinstance(demanda, dict) and not tipo_ignorado(demanda.get('issue_type'))


def filtrar_snapshot(dados):
    resultado = dict(dados)
    originais = (dados.get('contexto') or {}).get('demandas_originais') or []
    ignoradas = {d.get('key') for d in dados.get('demandas', []) + originais if isinstance(d, dict) and not demanda_util(d)}
    resultado['demandas'] = [d for d in dados.get('demandas', []) if demanda_util(d)]
    if 'demandas_excluidas' in dados:
        resultado['demandas_excluidas'] = [key for key in dados['demandas_excluidas'] if key not in ignoradas]
    if isinstance(dados.get('contexto'), dict):
        contexto = dict(dados['contexto'])
        if isinstance(contexto.get('demandas_originais'), list):
            contexto['demandas_originais'] = [d for d in contexto['demandas_originais'] if demanda_util(d)]
        resultado['contexto'] = contexto
    return resultado
