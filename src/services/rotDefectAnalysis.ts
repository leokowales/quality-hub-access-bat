type Distribuicao = Record<string, number> | undefined
export type DestaqueDefeitos = { tom: 'danger' | 'warning' | 'info'; titulo: string; valor: string; detalhe: string }
export const normalizarDefeito = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const SEVERIDADES = [
    { nomes: ['baixissima', 'lowest'], cor: 'var(--qh-severity-lowest)' },
    { nomes: ['baixa', 'low'], cor: 'var(--qh-severity-low)' },
    { nomes: ['media', 'medium'], cor: 'var(--qh-severity-medium)' },
    { nomes: ['alta', 'high'], cor: 'var(--qh-severity-high)' },
    { nomes: ['altissima', 'highest'], cor: 'var(--qh-severity-highest)' },
    { nomes: ['very critical', 'muito critica'], cor: 'var(--qh-severity-critical)' },
]
// Status colors express workflow meaning and remain stable when ranking changes.
export function corStatusDefeito(nome: string): string {
    const status = normalizarDefeito(nome)
    if (['concluido', 'concluida', 'done', 'closed', 'resolved'].includes(status)) return 'var(--qh-defect-status-complete)'
    if (['cancelado', 'cancelada', 'cancelados', 'canceladas', 'canceled', 'cancelled'].includes(status)) return 'var(--qh-defect-status-canceled)'
    if (['em andamento', 'in progress', 'in development'].includes(status)) return 'var(--qh-defect-status-progress)'
    if (['internal review', 'in review', 'em revisao', 'review'].includes(status)) return 'var(--qh-defect-status-review)'
    if (['aberto', 'aberta', 'open', 'reopened', 'reaberto'].includes(status)) return 'var(--qh-defect-status-open)'
    return 'var(--qh-defect-status-other)'
}
export const nivelSeveridade = (nome: string) => SEVERIDADES.findIndex(item => item.nomes.includes(normalizarDefeito(nome)))
export const corSeveridade = (nome: string) => SEVERIDADES[nivelSeveridade(nome)]?.cor ?? 'var(--qh-severity-unknown)'
export const ordenarSeveridades = (dados: Distribuicao) => Object.entries(dados ?? {}).filter(([, qtd]) => qtd > 0).sort((a, b) => {
    const nivel = (nome: string) => nivelSeveridade(nome) < 0 ? 6 : nivelSeveridade(nome)
    return nivel(a[0]) - nivel(b[0]) || a[0].localeCompare(b[0], 'pt-BR')
})
export function destaqueDefeitos(tipo: string, dados: Distribuicao): DestaqueDefeitos | null {
    const itens = Object.entries(dados ?? {}).filter(([, qtd]) => qtd > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    const total = itens.reduce((soma, [, qtd]) => soma + qtd, 0)
    if (!total) return null
    const numero = (qtd: number) => qtd.toLocaleString('pt-BR')
    const percentual = (qtd: number) => `${(qtd / total * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    const quantidade = (qtd: number) => `${numero(qtd)} ${qtd === 1 ? 'bug' : 'bugs'}`
    if (tipo === 'status') {
        const cancelados = itens.filter(([nome]) => ['cancelado', 'cancelada', 'cancelados', 'canceladas', 'canceled', 'cancelled'].includes(normalizarDefeito(nome))).reduce((soma, [, qtd]) => soma + qtd, 0)
        if (cancelados) return { tom: 'danger', titulo: 'Bugs cancelados', valor: quantidade(cancelados), detalhe: `${percentual(cancelados)} dos defeitos` }
        const pendentes = itens.filter(([nome]) => !['concluido', 'concluida', 'done', 'closed', 'resolved'].includes(normalizarDefeito(nome))).reduce((soma, [, qtd]) => soma + qtd, 0)
        return pendentes ? { tom: 'warning', titulo: 'Bugs pendentes', valor: quantidade(pendentes), detalhe: `${percentual(pendentes)} ainda n\u00e3o conclu\u00eddos` } : null
    }
    if (tipo === 'causa') {
        const ausentes = itens.filter(([nome]) => normalizarDefeito(nome) === 'sem causa raiz').reduce((soma, [, qtd]) => soma + qtd, 0)
        if (ausentes) return { tom: 'warning', titulo: 'Sem causa raiz', valor: quantidade(ausentes), detalhe: `${percentual(ausentes)} sem causa raiz informada` }
        return { tom: 'info', titulo: 'Causa raiz mais frequente', valor: itens[0][0], detalhe: `${percentual(itens[0][1])} dos defeitos (${numero(itens[0][1])})` }
    }
    if (tipo === 'severidade') {
        const criticos = itens.filter(([nome]) => nivelSeveridade(nome) >= 3).reduce((soma, [, qtd]) => soma + qtd, 0)
        const menores = itens.filter(([nome]) => nivelSeveridade(nome) >= 0 && nivelSeveridade(nome) < 3).reduce((soma, [, qtd]) => soma + qtd, 0)
        if (criticos <= menores) return {
            tom: 'info',
            titulo: 'Severidade mais frequente',
            valor: itens[0][0],
            detalhe: `${percentual(itens[0][1])} dos bugs apresentam severidade ${itens[0][0]} (${numero(itens[0][1])})`,
        }
        return { tom: 'danger', titulo: 'Predomínio de alta severidade', valor: `${percentual(criticos)} em Alta ou acima`, detalhe: `${quantidade(criticos)} de maior severidade, contra ${numero(menores)} em Baixíssima, Baixa e Média` }
    }
    return { tom: 'info', titulo: 'Maior participa\u00e7\u00e3o na identifica\u00e7\u00e3o', valor: itens[0][0], detalhe: `${percentual(itens[0][1])} dos bugs identificados (${numero(itens[0][1])})` }
}
