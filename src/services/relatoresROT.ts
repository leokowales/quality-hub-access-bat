import { API_URL, apiFetch } from './api'

export type ConfiguracaoRelatores = {
  projetos: { id: number; chave: string }[]
  times: { id: number; nome: string; projetosIds: number[] }[]
  pessoas: { id: number; nome: string; cargo: string; account_id?: string | null; timesIds: number[] }[]
}
type Relator = { relator?: string | null; relator_account_id?: string | null }
const normalizar = (valor: string) => valor.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
export async function consultarConfiguracaoRelatores(): Promise<ConfiguracaoRelatores> {
  const resposta = await apiFetch(`${API_URL}/configuration`)
  if (!resposta.ok) throw new Error('Não foi possível consultar as funções dos relatores. Os nomes foram preservados.')
  return resposta.json()
}

export function agruparRelatores(bugs: Relator[], config: ConfiguracaoRelatores | null, projeto: string, time: string): [string, number][] {
  const projetos = config?.projetos.filter(item => normalizar(item.chave) === normalizar(projeto)).map(item => item.id) ?? []
  const times = config?.times.filter(item => normalizar(item.nome) === normalizar(time) && item.projetosIds.some(id => projetos.includes(id))).map(item => item.id) ?? []
  const pessoas = config?.pessoas.filter(item => item.timesIds.some(id => times.includes(id))) ?? []
  const contagem = new Map<string, { nome: string; quantidade: number }>()
  for (const bug of bugs) {
    const nome = bug.relator?.trim() || 'Sem relator'
    // Prefer Jira identity; old snapshots only contain display names.
    let candidatas = bug.relator_account_id
      ? pessoas.filter(pessoa => pessoa.account_id === bug.relator_account_id)
      : pessoas.filter(pessoa => normalizar(pessoa.nome) === normalizar(nome))
    if (bug.relator_account_id && !candidatas.length) {
      candidatas = pessoas.filter(pessoa => !pessoa.account_id && normalizar(pessoa.nome) === normalizar(nome))
    }
    const identificada = candidatas.length === 1 ? candidatas[0] : undefined
    const rotulo = identificada?.cargo.trim() || nome
    const chave = normalizar(rotulo)
    const atual = contagem.get(chave)
    contagem.set(chave, { nome: atual?.nome ?? rotulo, quantidade: (atual?.quantidade ?? 0) + 1 })
  }
  return [...contagem.values()].map(({ nome, quantidade }): [string, number] => [nome, quantidade]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
}
