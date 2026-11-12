import { API_URL, apiFetch } from './api'
export type TipoRegistro = 'informativo' | 'ponto_atencao' | 'evolucao_futura' | 'governanca'
export type StatusRegistro = 'pendente' | 'em_andamento' | 'bloqueado' | 'concluido'
export type SprintGovernanca = { id: string; sprint_name: string; project_key: string; team_name: string; associada_em?: string }
export type EventoGovernanca = { id: number; registro_id: number; tipo: string; ocorrida_em: string; motivo: string; antes: Partial<RegistroGovernanca> | null; depois: Partial<RegistroGovernanca> | null; sprint_origem: SprintGovernanca | null; sprint_destino: SprintGovernanca | null }
export type RegistroGovernanca = {
  id: number; iteracao_id: string; tipo: TipoRegistro; titulo: string; descricao: string
  status: StatusRegistro; abertura: string; fechamento: string | null; versao: number
  criado_em: string; atualizado_em: string
  motivo_bloqueio?: string; herdado?: boolean; editavel?: boolean; excluido_em?: string | null
  dias_em_aberto?: number; quantidade_sprints?: number; sprint_origem?: SprintGovernanca; sprint_atual?: SprintGovernanca
  sprints_acompanhadas?: SprintGovernanca[]; historico?: EventoGovernanca[]
}
export type DadosRegistroGovernanca = Pick<RegistroGovernanca, 'tipo' | 'titulo' | 'descricao' | 'status' | 'abertura' | 'fechamento'> & { versao?: number; motivo_bloqueio?: string }
export type RegistrosGovernanca = { registros: RegistroGovernanca[]; editavel: boolean; projeto?: string; time?: string; sprint?: string; continuidade?: { migrados: number; pendentes: number | null; ambiguo: boolean; motivo: string } | null }
export const TIPOS_REGISTRO: Record<TipoRegistro, string> = { informativo: 'Informativo', ponto_atencao: 'Ponto de aten\u00e7\u00e3o', evolucao_futura: 'Evolu\u00e7\u00e3o futura', governanca: 'Governan\u00e7a' }
export const STATUS_REGISTRO: Record<StatusRegistro, string> = { pendente: 'Pendente', em_andamento: 'Em andamento', bloqueado: 'Bloqueado', concluido: 'Conclu\u00eddo' }
async function requisicao<T>(ciclo: string, sufixo = '', metodo = 'GET', dados?: DadosRegistroGovernanca): Promise<T> {
  const resposta = await apiFetch(`${API_URL}/sprint-ativa/cycles/${encodeURIComponent(ciclo)}/governance${sufixo}`, { method: metodo, ...(dados ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) } : {}) })
  const corpo = await resposta.json()
  if (!resposta.ok) throw new Error(typeof corpo.detail === 'string' ? corpo.detail : 'N\u00e3o foi poss\u00edvel salvar ou consultar os registros.')
  return corpo as T
}
export const consultarRegistrosGovernanca = (ciclo: string) => requisicao<RegistrosGovernanca>(ciclo)
export const consultarHistoricoGovernanca = (ciclo: string) => requisicao<{ eventos: EventoGovernanca[] }>(ciclo, '/history')
export const salvarRegistroGovernanca = (ciclo: string, dados: DadosRegistroGovernanca, id?: number) => requisicao<RegistroGovernanca>(ciclo, id === undefined ? '' : `/${id}`, id === undefined ? 'POST' : 'PUT', dados)
export const removerRegistroGovernanca = (ciclo: string, registro: RegistroGovernanca) => requisicao<{ removido: boolean }>(ciclo, `/${registro.id}?versao=${registro.versao}`, 'DELETE')
export function hojeGovernanca(): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const campo = (nome: string) => partes.find(parte => parte.type === nome)?.value
  return `${campo('year')}-${campo('month')}-${campo('day')}`
}
export const normalizarBuscaRegistro = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export type FiltrosGovernanca = { tipo: string; status: string; periodo: string; busca: string }
export function filtrarRegistrosGovernanca(registros: RegistroGovernanca[], filtros: FiltrosGovernanca, hoje: string): RegistroGovernanca[] {
  const dias = Number(filtros.periodo)
  const inicio = dias > 0 ? new Date(Date.parse(`${hoje}T12:00:00Z`) - (dias - 1) * 86400000).toISOString().slice(0, 10) : null
  const busca = normalizarBuscaRegistro(filtros.busca)
  return registros.filter(registro => (!filtros.tipo || filtros.tipo === registro.tipo) && (!filtros.status || filtros.status === registro.status)
    && (!inicio || (registro.abertura >= inicio && registro.abertura <= hoje))
    && (!busca || normalizarBuscaRegistro(`${registro.titulo} ${registro.descricao}`).includes(busca)))
}

export const EVENTOS_GOVERNANCA: Record<string, string> = { criacao: 'Registro criado', importado: 'Registro anterior preservado', migracao: 'Continuidade entre sprints', categoria_alterada: 'Categoria alterada', titulo_alterado: 'T\u00edtulo alterado', descricao_alterada: 'Descri\u00e7\u00e3o alterada', status_alterado: 'Status alterado', bloqueio: 'Bloqueio registrado', bloqueio_atualizado: 'Motivo do bloqueio alterado', desbloqueio: 'Registro desbloqueado', conclusao: 'Registro conclu\u00eddo', reabertura: 'Registro reaberto', conclusao_corrigida: 'Data de conclus\u00e3o corrigida', exclusao: 'Registro exclu\u00eddo da lista operacional' }
