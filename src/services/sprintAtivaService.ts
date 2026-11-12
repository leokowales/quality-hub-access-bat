
import { API_URL, apiFetch } from './api'

export type SprintDisponivel = {
  congelada_em?: string | null
  id: string
  project_key: string
  team_name: string
  sprint_name: string
  atualizada_em?: string
  concluida_em?: string
  total_ciclos?: number
}

export type CicloSprintAtiva = {
  id: string
  iteracao_id: string
  numero_ciclo: number
  status: 'ativa' | 'concluida'
  ativada_em: string
  concluida_em: string | null
  project_key: string
  team_name: string
  sprint_name: string
}

export type PanoramaSprintAtiva = {
  ativa: CicloSprintAtiva | null
  disponiveis: SprintDisponivel[]
  concluidas: SprintDisponivel[]
}

async function solicitar<T>(
  rota: string,
  metodo = 'GET'
): Promise<T> {
  const resposta = await apiFetch(`${API_URL}${rota}`, {
    method: metodo,
  })

  const dados = await resposta.json()

  if (!resposta.ok) {
    throw new Error(
      typeof dados.detail === 'string'
        ? dados.detail
        : 'Erro ao consultar Sprint Ativa.'
    )
  }

  return dados as T
}

export const consultarSprintAtiva = () =>
  solicitar<PanoramaSprintAtiva>('/sprint-ativa')

export const ativarSprintAtiva = (iteracaoId: string) =>
  solicitar(
    `/sprint-ativa/iterations/${encodeURIComponent(iteracaoId)}/activate`,
    'POST'
  )

export const congelarSprintAtiva = (cicloId: string) =>
  solicitar(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/freeze`, 'POST')

export const concluirSprintAtiva = (cicloId: string, confirmacaoPendencias = false, versao?: number) =>
  enviarEscopo(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/complete`, { confirmacao_pendencias: confirmacaoPendencias, versao })

export const reativarSprintAtiva = (iteracaoId: string) =>
  solicitar(
    `/sprint-ativa/iterations/${encodeURIComponent(iteracaoId)}/return-to-available`,
    'POST'
  )


export type ItemRollover = {
  issue_key: string | null
  tipo: 'Bug' | 'Sub-bug' | 'TP'
  status: string | null
  url: string | null
  resumo: string | null
  vezes_carregado: number | null
  sprint_origem: string
  sprint_atual: string
  sprint_atual_id: string
}

export type IndicadoresSprintAtiva = {
  ciclo: { ciclo_id: string; numero_ciclo: number; ciclo_status: string; ativada_em: string; concluida_em: string | null }
  contexto: { project_key: string; team_name: string; sprint_name: string; data_inicio: string | null; data_fim: string | null; consolidada_em: string | null; sincronizacao_versao: number | null; atualizado_em?: string | null }
  escopo: { demandas: number; excluidas: number; epicos: number; historias: number; test_plans: number; bugs: number }
  cobertura: { historias_com_plano: number; historias_sem_plano: number; planos_com_dados: number; planos_sem_dados: number }
  execucao: { total: number; passed: number; failed: number; not_run: number; in_progress: number; automated: number; manual: number; concluidos: number; percentual_execucao: number | null }
  defeitos: {
    total: number
    originados: number
    herdados: number
    origem_indeterminada: number
    resolvidos: number
    por_status: Record<string, number>
    por_categoria?: Record<string, number>
    // Defect counts by the identifier's role, for example QA or PO.
    // Optional until the backend persists and exposes this information.
    por_funcao_identificador?: Record<string, number>
    por_causa_raiz?: Record<string, number>
    por_prioridade?: Record<string, number>
    dados_sla?: { issue_key?: string | null; resumo?: string | null; responsavel?: string | null; relator?: string | null; relator_account_id?: string | null; causa_raiz?: string | null; origem?: 'desta_sprint' | 'herdado' | null; url?: string | null; prioridade: string | null; criacao: string | null; resolucao: string | null; status: string | null }[]
  }
  rollover?: { itens: ItemRollover[]; sem_historico: number; total: number; inconsistentes?: number }
  ressalvas: unknown[]
  origem: string
}

export const consultarIndicadoresSprintAtiva = (cicloId: string) =>
  solicitar<IndicadoresSprintAtiva>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/indicators`)

export type OcorrenciaAtencao = {
  url?: string | null
  id: string
  tipo: 'historia_sem_plano' | 'testes_falhados' | 'plano_sem_dados' | 'bug_a_verificar'
  gravidade: 'acao' | 'verificar' | 'informativo'
  issue_key: string
  titulo: string
  status: string
  motivo: string
  quantidade: number | null
  orientacao: string
  relacionamentos: { chave: string; relacao: string }[]
}
export type AtencoesSprintAtiva = {
  origem: string
  consolidada_em: string | null
  atualizado_em?: string | null
  total: number
  por_tipo: Record<string, number>
  por_gravidade: Record<string, number>
  ocorrencias: OcorrenciaAtencao[]
  nota: string
}
export const consultarAtencoesSprintAtiva = (cicloId: string) =>
  solicitar<AtencoesSprintAtiva>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/attention`)

export type NotaSprint = { id: number; issue_key: string; finalidade: 'pessoal' | 'relatorio'; texto: string; criado_em: string }
export const consultarNotasSprint = (cicloId: string) =>
  solicitar<{ notas: NotaSprint[] }>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/notes`)


export const sincronizarSprintAtiva = (cicloId: string) =>
  solicitar<{ status: string; atualizado_em: string; total_demandas: number; pendentes: number; versao: number }>(
    `/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/sync`, 'POST'
  )

export type EvolucaoSprint = {
  estado: 'sem_referencia' | 'aguardando_comparacao' | 'comparado'
  mensagem?: string
  atualizado_em?: string
  anterior_em?: string
  total?: number
  por_impacto?: { melhoria: number; regressao: number; neutro: number }
  mudancas: { issue_key: string; tipo: 'status' | 'execucao' | 'rastreabilidade' | 'governanca' | 'multipla'; impacto?: 'melhoria' | 'regressao' | 'neutro'; titulo: string; descricao: string }[]
}
export const consultarEvolucaoSprint = (cicloId: string) =>
  solicitar<EvolucaoSprint>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/evolution`)

export type MudancaHistoricaSprint = EvolucaoSprint['mudancas'][number] & { atualizado_em: string; anterior_em: string; snapshot_id: number }
export const consultarHistoricoMudancasSprint = (cicloId: string) =>
  solicitar<{ ciclo_id: string; total: number; mudancas: MudancaHistoricaSprint[] }>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/change-history`)

export type EscopoHistoricoDiario = {
  demandas: number
  historias: number
  test_plans: number
  bugs: number
  bugs_originados?: number | null
}
export type PontoEvolucaoDiaria = {
  data: string
  atualizado_em: string
  total: number
  aprovados: number
  falhados: number
  restantes: number
  executados?: number
  escopo?: EscopoHistoricoDiario | null
}
export type EvolucaoDiariaSprint = {
  ciclo_id: string
  fuso_horario: string
  pontos: PontoEvolucaoDiaria[]
}
export const consultarEvolucaoDiariaSprint = (cicloId: string) =>
  solicitar<EvolucaoDiariaSprint>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/daily-evolution`)

export type PeriodoPlanejado = {
  iteracao_id: string
  inicio: string | null
  fim: string | null
  atualizado_em: string | null
  conflitos?: { id: string; sprint_name: string }[]
}
export const consultarPeriodoSprint = (iteracaoId: string) =>
  solicitar<PeriodoPlanejado>(`/sprint-ativa/iterations/${encodeURIComponent(iteracaoId)}/period`)
export async function salvarPeriodoSprint(iteracaoId: string, inicio: string, fim: string): Promise<PeriodoPlanejado> {
  const resposta = await apiFetch(`${API_URL}/sprint-ativa/iterations/${encodeURIComponent(iteracaoId)}/period`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inicio, fim })
  })
  const dados = await resposta.json()
  if (!resposta.ok) throw new Error(typeof dados.detail === 'string' ? dados.detail : 'Falha ao salvar período.')
  return dados as PeriodoPlanejado
}

export type ItemRastreabilidade = {
  demanda: { key: string; summary: string; issue_type: string; status?: string | null; url?: string | null; parent_key?: string | null }
  estado: string
  manual: boolean
  contextual: boolean
  pendencia: 'nova' | 'ausencia' | 'classificar_origem' | null
  origem_bug: 'desta_sprint' | 'herdado' | null
  motivo: string
  requerida_por: string[]
}
export type EventoRastreabilidade = { id: number; versao: number; issue_key: string | null; acao: string; antes: string | null; depois: string | null; motivo: string; criado_em: string }
export type RastreabilidadeSprint = { ciclo_id: string; versao: number; pendentes: number; editavel: boolean; itens: ItemRastreabilidade[]; historico: EventoRastreabilidade[] }
export type EscolhaEscopo = { issue_key: string; acao: 'incluir' | 'excluir' | 'manter' | 'desta_sprint' | 'herdado'; motivo: string }
async function enviarEscopo<T>(rota: string, body: object): Promise<T> {
  const resposta = await apiFetch(`${API_URL}${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const dados = await resposta.json()
  if (!resposta.ok) throw new Error(typeof dados.detail === 'string' ? dados.detail : 'Não foi possível aplicar a alteração.')
  return dados as T
}
export const consultarRastreabilidade = (cicloId: string) => solicitar<RastreabilidadeSprint>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/traceability`)
export const decidirRastreabilidade = (cicloId: string, versao: number, decisoes: EscolhaEscopo[]) =>
  enviarEscopo<RastreabilidadeSprint>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/traceability/decisions`, { versao, decisoes })
export const adicionarRastreabilidade = (cicloId: string, versao: number, issue_key: string, motivo: string) =>
  enviarEscopo<RastreabilidadeSprint>(`/sprint-ativa/cycles/${encodeURIComponent(cicloId)}/traceability/manual`, { versao, issue_key, motivo })
