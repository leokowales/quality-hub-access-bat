
import type { Demanda } from '../pages/NovaIteracao'

import { API_URL, apiFetch } from './api'

export type ContextoIteracao = {
  project_key: string
  team_name: string
  data_inicio: string
  data_fim: string
  sprints: string[]
  quarters: string[]
  sprint_name: string
  total_original: number
  total_direct: number
  total_traceability: number
  qa_links_total: number
  demandas_originais?: Demanda[]
}

export type RastreabilidadeIteracao = {
  complete: boolean
  limit_reached: boolean
  unresolved_keys: string[]
  incomplete_queries?: string[]
}

export type SalvarIteracaoPayload = {
  demandas: Demanda[]
  demandas_excluidas: string[]
  contexto: ContextoIteracao
  rastreabilidade: RastreabilidadeIteracao
}

export type IteracaoSalva = {
  id: string
  project_key: string
  team_name: string
  sprint_id: string
  sprint_name: string
  status: 'pendente' | 'em_revisao' | 'consolidada'
  criada_em: string
  atualizada_em: string
  data_inicio: string | null
  data_fim: string | null
  sprints_json: string | null
  quarters_json: string | null
}

type SincronizacaoSalva = {
  id: string
  iteracao_id: string
  versao: number
  criada_em: string
  dados: SalvarIteracaoPayload
}

async function requisitar<T>(
  caminho: string,
  opcoes?: RequestInit,
): Promise<T> {
  const resposta = await apiFetch(`${API_URL}${caminho}`, opcoes)

  const dados: unknown = await resposta.json()

  if (!resposta.ok) {
    const detalhe =
      dados !== null &&
      typeof dados === 'object' &&
      'detail' in dados &&
      typeof dados.detail === 'string'
        ? dados.detail
        : `Erro na comunicação com o QualityHub (${resposta.status}).`

    throw new Error(detalhe)
  }

  return dados as T
}

export async function criarIteracao(
  contexto: ContextoIteracao,
  snapshotInicial: SalvarIteracaoPayload,
): Promise<IteracaoSalva> {
  return requisitar<IteracaoSalva>('/iterations/with-snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_key: contexto.project_key,
      team_name: contexto.team_name,
      sprint_id: contexto.sprints[0] ?? '',
      sprint_name: contexto.sprint_name,
      data_inicio: contexto.data_inicio,
      data_fim: contexto.data_fim,
      sprints: contexto.sprints,
      quarters: contexto.quarters,
      sincronizacao_inicial: snapshotInicial,
    }),
  })
}

export async function obterUltimaSincronizacao(
  iteracaoId: string,
): Promise<SincronizacaoSalva> {
  return requisitar<SincronizacaoSalva>(
    `/iterations/${encodeURIComponent(iteracaoId)}/synchronizations/latest`,
  )
}

export type FiltrosCentralRevisao = {
  status: 'pendentes' | 'historico'
  busca?: string
  projeto?: string
  time?: string
  data_inicio?: string
  data_fim?: string
  pagina?: number
  limite?: number
}

export type PaginaIteracoes = {
  itens: IteracaoSalva[]
  total: number
  pagina: number
  limite: number
  total_paginas: number
}

export function listarIteracoesPaginadas(
  filtros: FiltrosCentralRevisao,
): Promise<PaginaIteracoes> {
  const parametros = new URLSearchParams()

  parametros.set('status', filtros.status)
  parametros.set('pagina', String(filtros.pagina ?? 1))
  parametros.set('limite', String(filtros.limite ?? 10))

  if (filtros.busca) {
    parametros.set('busca', filtros.busca)
  }

  if (filtros.projeto) {
    parametros.set('projeto', filtros.projeto)
  }

  if (filtros.time) {
    parametros.set('time', filtros.time)
  }

  if (filtros.data_inicio) {
    parametros.set('data_inicio', filtros.data_inicio)
  }

  if (filtros.data_fim) {
    parametros.set('data_fim', filtros.data_fim)
  }

  return requisitar<PaginaIteracoes>(
    `/iterations/paginated?${parametros.toString()}`,
  )
}

export type OpcoesFiltrosRevisao = {
  projetos: string[]
  times: string[]
}

export function obterOpcoesFiltrosRevisao(
  projeto = '',
): Promise<OpcoesFiltrosRevisao> {
  const parametros = new URLSearchParams()

  if (projeto) {
    parametros.set('projeto', projeto)
  }

  const query = parametros.toString()

  return requisitar<OpcoesFiltrosRevisao>(
    `/iterations/filter-options${query ? `?${query}` : ''}`,
  )
}

export type DecisaoRevisao = 'include' | 'exclude' | 'pending'

export type RegistroDecisaoRevisao = {
  id: string
  iteracao_id: string
  issue_key: string
  decisao: DecisaoRevisao
  justificativa: string | null
  origem: string
  criada_em: string
  atualizada_em: string | null
}

export function listarDecisoesRevisao(
  iteracaoId: string,
): Promise<RegistroDecisaoRevisao[]> {
  return requisitar<RegistroDecisaoRevisao[]>(
    `/iterations/${encodeURIComponent(iteracaoId)}/reviews`,
  )
}

export function salvarDecisaoRevisao(
  iteracaoId: string,
  issueKey: string,
  decisao: DecisaoRevisao,
  justificativa: string | null = null,
): Promise<RegistroDecisaoRevisao> {
  return requisitar<RegistroDecisaoRevisao>(
    `/iterations/${encodeURIComponent(iteracaoId)}/reviews/${encodeURIComponent(issueKey)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisao, justificativa }),
    },
  )
}

export type ResultadoAtualizacaoIteracao = {
  id: string
  iteracao_id: string
  versao: number
  criada_em: string
  modalidade: 'all' | 'pending'
  total_demandas?: number
  total_diretas?: number
  total_rastreabilidade?: number
  rastreabilidade_completa?: boolean
  total_atualizadas?: number
  total_snapshot?: number
  chaves_atualizadas?: string[]
  revalidacao_governanca_pendente?: boolean
}

export function atualizarTodasDemandas(
  iteracaoId: string,
): Promise<ResultadoAtualizacaoIteracao> {
  return requisitar<ResultadoAtualizacaoIteracao>(
    `/iterations/${encodeURIComponent(iteracaoId)}/refresh`,
    { method: 'POST' },
  )
}

export function atualizarDemandasPendentes(
  iteracaoId: string,
  issueKeys: string[],
): Promise<ResultadoAtualizacaoIteracao> {
  return requisitar<ResultadoAtualizacaoIteracao>(
    `/iterations/${encodeURIComponent(iteracaoId)}/refresh/pending`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_keys: issueKeys }),
    },
  )
}

export type RessalvaFinalizacao = {
  tipo: string
  titulo: string
  quantidade: number
  chaves: string[]
}

export type PreviaFinalizacao = {
  iteracao_id: string
  sincronizacao_id: string
  versao: number
  total_demandas: number
  total_aprovadas: number
  total_excluidas: number
  total_decisoes_pendentes: number
  ressalvas: RessalvaFinalizacao[]
  pode_finalizar: boolean
  assinatura: string
}

export type ResultadoFinalizacao = {
  id: string
  iteracao_id: string
  status: 'consolidada'
  sincronizacao_versao: number
  consolidada_em: string
  ressalvas: unknown[]
}

export function obterPreviaFinalizacao(
  iteracaoId: string,
): Promise<PreviaFinalizacao> {
  return requisitar<PreviaFinalizacao>(
    `/iterations/${encodeURIComponent(iteracaoId)}/finalization/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export function finalizarRevisao(
  iteracaoId: string,
  assinatura: string,
  confirmacaoRessalvas: boolean,
): Promise<ResultadoFinalizacao> {
  return requisitar<ResultadoFinalizacao>(
    `/iterations/${encodeURIComponent(iteracaoId)}/finalization`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assinatura,
        confirmacao_ressalvas: confirmacaoRessalvas,
      }),
    },
  )
}
