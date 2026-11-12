import type { MudancaHistoricaSprint } from './sprintAtivaService'

export type CategoriaMudanca = 'aprovados' | 'falhados' | 'mistos' | 'outros'

// A comparação agrega campos da mesma issue. Classificar pela descrição preserva
// um único evento no histórico, inclusive quando aprovados e falhados mudam juntos.
export function categoriaMudanca(m: MudancaHistoricaSprint): CategoriaMudanca {
  if (m.tipo !== 'execucao' && m.tipo !== 'multipla') return 'outros'
  const descricao = m.descricao ?? ''
  const aprovados = /(?:^|[·\s])Aprovados:\s*\d+\s*→\s*\d+/i.test(descricao)
  const falhados = /(?:^|[·\s])Falhados:\s*\d+\s*→\s*\d+/i.test(descricao)
  if (aprovados && falhados) return 'mistos'
  if (falhados) return 'falhados'
  if (aprovados) return 'aprovados'
  return 'outros'
}

// atualizado_em é o instante do snapshot que detectou a diferença; não
// representa necessariamente a hora exata da alteração no Jira.
export function horarioDeteccao(m: MudancaHistoricaSprint): string {
  const data = new Date(m.atualizado_em)
  if (Number.isNaN(data.getTime())) return 'Horário indisponível'
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
