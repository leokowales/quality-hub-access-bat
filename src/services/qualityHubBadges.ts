/** Classificação semântica compartilhada de badges do Jira. */
function normalizarBadge(valor?: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

export function classeTipoDemanda(valor?: string | null): string {
  const tipo = normalizarBadge(valor)
  if (['historia', 'story', 'user story'].includes(tipo)) return 'qh-badge--verde'
  if (['bug', 'sub-bug', 'sub bug', 'subbug'].includes(tipo)) return 'qh-badge--vermelho'
  if (['epic', 'epico'].includes(tipo)) return 'qh-badge--roxo'
  return 'qh-badge--azul'
}

export function classeStatusDemanda(valor?: string | null): string {
  const status = normalizarBadge(valor)
  if (['concluido', 'concluida'].includes(status)) return 'qh-badge--verde'
  if (['aberto', 'aberta'].includes(status)) return 'qh-badge--cinza'
  if (['cancelado', 'cancelada'].includes(status)) return 'qh-badge--vermelho'
  return 'qh-badge--azul'
}

export function classePrioridadeDemanda(valor?: string | null): string {
  const prioridade = normalizarBadge(valor)

  if (prioridade === 'very critical') return 'qh-prioridade--critica'
  if (prioridade === 'altissima') return 'qh-prioridade--altissima'
  if (prioridade === 'alta') return 'qh-prioridade--alta'
  if (prioridade === 'media') return 'qh-prioridade--media'
  if (prioridade === 'baixa') return 'qh-prioridade--baixa'
  if (prioridade === 'baixissima') return 'qh-prioridade--baixissima'

  return 'qh-prioridade--indefinida'
}
