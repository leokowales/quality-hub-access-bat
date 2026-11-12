import type { EscolhaEscopo, ItemRastreabilidade } from './sprintAtivaService'

export type AcaoAtualizacao = EscolhaEscopo['acao'] | ''
export const normalizarTipo = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export const tipoMetrificavel = (v: string) => !['subtarefa', 'subtask', 'spike'].includes(normalizarTipo(v).replace(/[^a-z0-9]/g, ''))
export const contextoAutomatico = (item: ItemRastreabilidade) => item.contextual && item.estado === 'incluida' && !!item.requerida_por?.length

export function opcoesDecisao(item: ItemRastreabilidade): [AcaoAtualizacao, string][] {
  if (contextoAutomatico(item)) return []
  if (item.pendencia === 'classificar_origem') return [['desta_sprint', 'Desta sprint'], ['herdado', 'Herdado'], ...(!item.requerida_por?.length ? [['excluir', 'Retirar do acompanhamento'] as [AcaoAtualizacao, string]] : [])]
  if (item.pendencia === 'nova') return [['incluir', 'Considerar'], ['excluir', 'Não considerar']]
  if (item.pendencia === 'ausencia') return [['manter', 'Manter último dado válido'], ...(!item.requerida_por?.length ? [['excluir', 'Retirar do acompanhamento'] as [AcaoAtualizacao, string]] : [])]
  const opts: [AcaoAtualizacao, string][] = []
  if (item.estado !== 'incluida') opts.push(['incluir', 'Incluir no acompanhamento'])
  if (!item.requerida_por?.length) opts.push(['excluir', 'Retirar do acompanhamento'])
  if (['bug', 'sub-bug', 'sub bug', 'subbug'].includes(normalizarTipo(item.demanda.issue_type))) opts.push(['desta_sprint', 'Origem: desta sprint'], ['herdado', 'Origem: herdado'])
  return opts
}

export function opcoesDoLote(itens: ItemRastreabilidade[]): [AcaoAtualizacao, string][] {
  if (!itens.length) return []
  return opcoesDecisao(itens[0]).filter(([acao]) => itens.every(i => opcoesDecisao(i).some(([a]) => a === acao)))
}

export const decisaoDeOrigem = (acao: AcaoAtualizacao) => acao === 'desta_sprint' || acao === 'herdado'
export const exigeJustificativa = (acao: AcaoAtualizacao) => !!acao && !decisaoDeOrigem(acao)

export function prepararLote(itens: ItemRastreabilidade[], acao: AcaoAtualizacao, motivo: string): EscolhaEscopo[] {
  if (exigeJustificativa(acao) && !motivo.trim()) throw new Error('Informe uma justificativa para o lote.')
  if (!acao || !opcoesDoLote(itens).some(([a]) => a === acao)) throw new Error('Essa ação não é válida para todas as demandas selecionadas.')
  return itens.map(i => ({ issue_key: i.demanda.key, acao, motivo: motivo.trim() }))
}

export function decisoesProntas(selecionadas: string[], escolhas: Record<string, { acao: AcaoAtualizacao; motivo: string }>): EscolhaEscopo[] {
  return selecionadas.flatMap(issue_key => {
    const escolha = escolhas[issue_key]
    return escolha?.acao && (!exigeJustificativa(escolha.acao) || escolha.motivo.trim()) ? [{ issue_key, acao: escolha.acao, motivo: escolha.motivo.trim() }] : []
  })
}
