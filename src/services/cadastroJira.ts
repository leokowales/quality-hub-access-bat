type Time = { id: number; nome: string; jira_id?: string | null; projetosIds: number[] }
type Pessoa = { id: number; nome: string; account_id?: string | null; cargo: string; timesIds: number[] }
const proximoId = (items: { id: number }[]) => Math.max(Date.now(), ...items.map(i => Math.ceil(i.id))) + 1

export function timeJaVinculado(times: Time[], time: { id: string; name: string }, projetoId: number): boolean {
  const nome = (valor: string) => valor.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
  return times.some(item => item.projetosIds.includes(projetoId) && (
    item.jira_id ? String(item.jira_id) === String(time.id) : nome(item.nome) === nome(time.name)
  ))
}

export function pessoaVinculada(pessoas: Pessoa[], pessoa: { accountId: string; displayName: string }, timeId: number): Pessoa | undefined {
  const nome = (valor: string) => valor.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
  const doTime = pessoas.filter(item => item.timesIds.includes(timeId))
  const identificada = doTime.find(item => item.account_id === pessoa.accountId)
  if (identificada) return identificada
  const legadas = doTime.filter(item => !item.account_id && nome(item.nome) === nome(pessoa.displayName))
  return legadas.length === 1 ? legadas[0] : undefined
}

export function vincularTimeJira(times: Time[], time: { id: string; nome: string }, projetoId: number): Time[] {
  const existente = times.find(t => t.jira_id === time.id)
  if (!existente) return [...times, { id: proximoId(times), nome: time.nome, jira_id: time.id, projetosIds: [projetoId] }]
  return times.map(t => t.id === existente.id ? { ...t, nome: time.nome, projetosIds: [...new Set([...t.projetosIds, projetoId])] } : t)
}

export function vincularPessoaJira(pessoas: Pessoa[], pessoa: { accountId: string; displayName: string }, timeId: number, cargo: string): Pessoa[] {
  const existente = pessoas.find(p => p.account_id === pessoa.accountId)
  if (!existente) return [...pessoas, { id: proximoId(pessoas), nome: pessoa.displayName, account_id: pessoa.accountId, cargo, timesIds: [timeId] }]
  return pessoas.map(p => p.id === existente.id ? { ...p, nome: pessoa.displayName, timesIds: [...new Set([...p.timesIds, timeId])] } : p)
}
