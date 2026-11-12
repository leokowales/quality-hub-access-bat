/** Alertas informativos: não alteram decisões nem elegibilidade da demanda. */
export type AlertaGovernanca = {
  id: string
  titulo: string
  grupo: 'Preenchimento' | 'Planejamento' | 'Testes' | 'Rastreabilidade' | 'Consistência'
  detalhe: string
}

type RelacaoQA = { relationship: string }
type Sprint = { id?: string | number; name?: string }

export type DemandaGovernanca = {
  key: string
  summary: string
  issue_type: string
  status: string | null
  parent_key?: string | null
  priority?: string | null
  assignee?: string | null
  reporter?: string | null
  created?: string | null
  updated?: string | null
  resolved?: string | null
  categories?: string[] | null
  sprints?: Sprint[] | null
  quarters?: string[] | null
  jira_fields?: Record<string, unknown> | null
  assertthat?: unknown
  qa_relationships?: RelacaoQA[]
  review?: { alerts?: string[] | null; automatic_decision?: 'include' | 'pending' }
}

const HISTORIAS = new Set(['história', 'historia', 'story', 'user story'])
const TEST_PLANS = new Set(['assertthat test plan', 'test plan', 'testplan', 'tp'])
const DEFEITOS = new Set(['bug', 'sub-bug', 'sub bug', 'subbug'])
const EPICS = new Set(['epic', 'épico'])

// Somente para apresentar/destacar alertas. A decisão automática vem da API.
export const ALERTAS_INTERVENCAO = new Set([
  'qa:historia_sem_tp', 'jira:root_cause', 'jira:developer',
  'jira:mapping_status', 'jira:test_case_mapping_owner',
  'backend:sem_vinculo_com_escopo', 'backend:periodo_explicito_fora_do_escopo',
  'jira:zero_cenarios', 'qa:tp_sem_historia', 'campo:categories',
])

// Antes de Selected for Development, Histórias ainda não exigem planejamento.
const STATUS_HISTORIA_PRE_DESENVOLVIMENTO = new Set([
  'aberto',
  'business refinement',
  'ux refinement',
  'awaiting technical refinement',
  'technical refinement',
  'backlog',
])

export const NOMES_CAMPOS_JIRA: Record<string, string> = {
  story_points: 'Story Points',
  developer: 'Desenvolvedor',
  root_cause: 'Causa raiz',
  test_scenarios_count: 'Quantidade de cenários',
  quarter: 'Quarter',
  baseline_quarter: 'Baseline Quarter',
  sprint: 'Sprint (campo Jira)',
  team: 'Time',
  epic_tshirt: 'T-Shirt do Epic',
  sla: 'SLA',
  mapping_status: 'Status do mapeamento',
  test_case_mapping_owner: 'Responsável pelo mapeamento',
}

const ALERTAS_BACKEND: Record<string, [string, AlertaGovernanca['grupo']]> = {
  sprint_ausente: ['Sprint não informada', 'Planejamento'],
  quarter_ausente_ou_backlog: ['Quarter ausente ou backlog', 'Planejamento'],
  sem_vinculo_com_escopo: ['Sem vínculo com o escopo', 'Rastreabilidade'],
  periodo_explicito_fora_do_escopo: ['Período fora do escopo', 'Planejamento'],
}

function vazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true
  if (typeof valor === 'string') return !valor.trim()
  if (Array.isArray(valor)) return valor.length === 0
  if (typeof valor === 'object') return Object.keys(valor).length === 0
  return false // 0 e false são valores válidos.
}

/** Só aceita contagens inteiras não negativas; valores inválidos não são tratados como zero. */
function normalizarContagem(valor: unknown): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null
  if (typeof valor === 'string' && !valor.trim()) return null
  const numero = Number(valor)
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null
}

/** O total do AssertThat é a fonte principal; o campo Jira é apenas alternativa. */
function obterContagemCenarios(demanda: DemandaGovernanca): number | null {
  const assertthat = demanda.assertthat
  if (assertthat !== null && typeof assertthat === 'object' && !Array.isArray(assertthat)) {
    const total = normalizarContagem((assertthat as Record<string, unknown>).total)
    if (total !== null) return total
  }
  return normalizarContagem(demanda.jira_fields?.test_scenarios_count)
}

export function obterAlertasGovernanca(demanda: DemandaGovernanca): AlertaGovernanca[] {
  const resultado: AlertaGovernanca[] = []
  const vistos = new Set<string>()
  const tipo = (demanda.issue_type || '').trim().toLocaleLowerCase('pt-BR')
  const status = (demanda.status || '').trim().toLocaleLowerCase('pt-BR')
  // Subtarefas permanecem disponíveis para análise, mas ainda não possuem regras de alerta.
  if (['subtarefa', 'sub-task', 'subtask'].includes(tipo)) {
    return []
  }

  // Demandas canceladas não geram alertas, inclusive os recebidos do backend.
  if (['cancelado', 'cancelada', 'cancelled', 'canceled'].includes(status)) {
    return []
  }

  const historia = HISTORIAS.has(tipo)
  const tp = TEST_PLANS.has(tipo)
  const defeito = DEFEITOS.has(tipo)
  const epic = EPICS.has(tipo)
  const historiaPreDesenvolvimento = historia && STATUS_HISTORIA_PRE_DESENVOLVIMENTO.has(status)
  const concluido = ['done', 'closed', 'resolved', 'concluído', 'concluido', 'fechado', 'resolvido'].includes(status)

  const adicionar = (id: string, titulo: string, grupo: AlertaGovernanca['grupo'], detalhe: string) => {
    if (vistos.has(id)) return
    vistos.add(id)
    resultado.push({ id, titulo, grupo, detalhe })
  }
  const checar = (id: string, titulo: string, grupo: AlertaGovernanca['grupo'], valor: unknown) => {
    if (vazio(valor)) adicionar(id, titulo, grupo, 'Informação não preenchida no Jira.')
  }

  checar('summary', 'Resumo não informado', 'Preenchimento', demanda.summary)
  checar('issue_type', 'Tipo não informado', 'Preenchimento', demanda.issue_type)
  checar('status', 'Status não informado', 'Preenchimento', demanda.status)

  // Campos opcionais só são verificados quando estão presentes no payload.
  const opcionais: Array<[keyof DemandaGovernanca, string, AlertaGovernanca['grupo']]> = [
    ['priority', 'Prioridade não informada', 'Preenchimento'],
    ['assignee', 'Responsável não informado', 'Preenchimento'],
    ['reporter', 'Reportante não informado', 'Preenchimento'],
    ['created', 'Data de criação não informada', 'Consistência'],
    ['updated', 'Data de atualização não informada', 'Consistência'],
    ['categories', 'Labels/ categorias não informadas', 'Preenchimento'],
  ]
  for (const [campo, titulo, grupo] of opcionais) {
    if (campo === 'categories' && !(tp || defeito)) continue
    if (campo === 'assignee' && status === 'aberto' && (defeito || tp)) continue
    if (Object.prototype.hasOwnProperty.call(demanda, campo)) {
      checar(`campo:${campo}`, titulo, grupo, demanda[campo])
    }
  }

  if (defeito && concluido && Object.prototype.hasOwnProperty.call(demanda, 'resolved')) {
    checar('resolved', 'Defeito concluído sem data de resolução', 'Consistência', demanda.resolved)
  }

  const personalizados = demanda.jira_fields
  // Quarter e Baseline Quarter são alternativas para fins de alerta de ausência.
  // Backlog não representa um Quarter definido.
  const possuiValorPlanejamento = (valor: unknown): boolean => {
    if (Array.isArray(valor)) return valor.some(possuiValorPlanejamento)
    if (typeof valor === 'string') {
      const texto = valor.trim().split(':').pop()?.trim().toLocaleLowerCase('pt-BR')
      return Boolean(texto && texto !== 'backlog')
    }
    return !vazio(valor)
  }
  const possuiQuarter =
    possuiValorPlanejamento(demanda.quarters) ||
    possuiValorPlanejamento(personalizados?.quarter)
  const possuiBaseline = possuiValorPlanejamento(personalizados?.baseline_quarter)
  const possuiPeriodoPlanejado = possuiQuarter || possuiBaseline
  if (personalizados && typeof personalizados === 'object') {
    for (const [campo, nome] of Object.entries(NOMES_CAMPOS_JIRA)) {
      if (!Object.prototype.hasOwnProperty.call(personalizados, campo)) continue
      if (campo === 'developer' && !(defeito && status === 'concluído')) continue
      if ((campo === 'mapping_status' || campo === 'test_case_mapping_owner') && !tp) continue
      if (campo === 'baseline_quarter' && !(historia || epic)) continue
      if (campo === 'baseline_quarter') continue // Validado em conjunto com Quarter abaixo.
      if (campo === 'root_cause' && !(defeito && concluido)) continue
      // A quantidade de cenários é validada abaixo, priorizando as informações do AssertThat.
      if (campo === 'test_scenarios_count') continue
      if (campo === 'story_points' && (!historia || historiaPreDesenvolvimento)) continue
      if (campo === 'epic_tshirt') continue
      // Campos estruturados de Sprint/Quarter são a fonte canônica; não duplicar.
      if (campo === 'sprint' || campo === 'quarter') continue

      const valor = personalizados[campo]
      if (vazio(valor)) {
        adicionar(
          `jira:${campo}`,
          `${nome} não informado(a)`,
          ['quarter', 'baseline_quarter', 'sprint', 'team', 'epic_tshirt', 'story_points'].includes(campo)
            ? 'Planejamento'
            : ['mapping_status', 'test_case_mapping_owner'].includes(campo)
              ? 'Testes'
              : 'Preenchimento',
          `Campo personalizado ${nome} sem valor.`,
        )
      }
    }
  }

  if ((historia || epic) && !historiaPreDesenvolvimento && personalizados &&
      Object.prototype.hasOwnProperty.call(personalizados, 'baseline_quarter') &&
      !possuiPeriodoPlanejado) {
    adicionar('jira:baseline_quarter', 'Quarter não informado', 'Planejamento',
      'Nenhum dos dois campos apresenta um período de planejamento válido.')
  }

  if (tp) {
    const totalCenarios = obterContagemCenarios(demanda)
    if (totalCenarios === 0) {
      adicionar('jira:zero_cenarios', 'Test Plan com zero cenários', 'Testes', 'A quantidade de cenários informada é zero.')
    } else if (totalCenarios === null) {
      adicionar(
        'jira:test_scenarios_count',
        'Quantidade de cenários não verificável',
        'Testes',
        'Não foi possível obter a quantidade de cenários pelo AssertThat nem pelo campo personalizado do Jira.',
      )
    }
  }

  if (historia && !historiaPreDesenvolvimento && !demanda.qa_relationships?.some(r => r.relationship === 'test_plan')) {
    adicionar('qa:historia_sem_tp', 'História sem vínculo de Test Plan identificado', 'Rastreabilidade', 'Nenhum Test Plan relacionado foi identificado.')
  }
  if (tp && !demanda.qa_relationships?.some(r => r.relationship === 'tests_story')) {
    adicionar('qa:tp_sem_historia', 'Test Plan sem vínculo de História identificado', 'Rastreabilidade', 'Nenhuma História relacionada foi identificada.')
  }
  if (tp && Object.prototype.hasOwnProperty.call(demanda, 'assertthat') && vazio(demanda.assertthat)) {
    adicionar(
      'assertthat:sem_dados',
      'Cenários AssertThat não disponíveis',
      'Testes',
      'A propriedade de cenários não retornou dados; isso não comprova ausência de cenários.',
    )
  }

  // Sprint e Quarter: um único alerta por dimensão, com prioridade para o backend.
  const codigosBackend = demanda.review?.alerts ?? []
  const ignorarSprint = (defeito && status === 'aberto') || historiaPreDesenvolvimento

  if (
    !ignorarSprint &&
    !codigosBackend.includes('sprint_ausente') &&
    Object.prototype.hasOwnProperty.call(demanda, 'sprints') &&
    vazio(demanda.sprints)
  ) {
    adicionar('backend:sprint_ausente', 'Sprint não informada', 'Planejamento', 'Nenhuma Sprint foi identificada.')
  }

  if (
    !historiaPreDesenvolvimento &&
    !possuiPeriodoPlanejado &&
    !codigosBackend.includes('quarter_ausente_ou_backlog') &&
    Object.prototype.hasOwnProperty.call(demanda, 'quarters') &&
    vazio(demanda.quarters)
  ) {
    adicionar('backend:quarter_ausente_ou_backlog', 'Quarter não informado', 'Planejamento', 'Nenhum Quarter foi identificado.')
  }

  for (const codigo of codigosBackend) {
    if (ignorarSprint && codigo === 'sprint_ausente') continue
    if ((possuiPeriodoPlanejado || historiaPreDesenvolvimento) && codigo === 'quarter_ausente_ou_backlog') continue
    if ((historia || epic) && !possuiPeriodoPlanejado &&
        codigo === 'quarter_ausente_ou_backlog' &&
        personalizados && Object.prototype.hasOwnProperty.call(personalizados, 'baseline_quarter')) continue
    const [titulo, grupo] = ALERTAS_BACKEND[codigo] ?? [`Alerta Jira: ${codigo}`, 'Consistência' as const]
    adicionar(`backend:${codigo}`, titulo, grupo, 'Alerta produzido pela classificação de escopo do backend.')
  }

  return resultado
}

export function formatarValorJira(valor: unknown): string {
  if (vazio(valor)) return 'Não informado'
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  if (Array.isArray(valor)) return valor.map(formatarValorJira).join(', ')
  if (typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>
    if (typeof objeto.name === 'string') return objeto.name
    if (typeof objeto.value === 'string') return objeto.value
    return JSON.stringify(valor)
  }
  return String(valor)
}
