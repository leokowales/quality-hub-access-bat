import { nivelSeveridade, normalizarDefeito } from './rotDefectAnalysis'
import type { OcorrenciaAtencao } from './sprintAtivaService'

type BugAtencao = {
    issue_key?: string | null; resumo?: string | null; status?: string | null; url?: string | null
    prioridade?: string | null; causa_raiz?: string | null; origem?: string | null
    encerrado: boolean; situacao: string; tempoRestante: number | null
}
export type ItemAtencaoRot = { chave: string; titulo: string; status: string; motivo: string; url?: string | null }
export type GrupoAtencaoRot = { id: string; titulo: string; descricao: string; acao: string; tom: 'warning' | 'danger' | 'info'; itens: ItemAtencaoRot[] }
export function montarAtencoesRot(bugs: BugAtencao[], ocorrencias: OcorrenciaAtencao[]): GrupoAtencaoRot[] {
    // One Jira per group; the same issue may legitimately require different actions.
    bugs = bugs.filter((bug, indice, itens) => !bug.issue_key || itens.findIndex(item => item.issue_key === bug.issue_key) === indice)
    ocorrencias = ocorrencias.filter((item, indice, itens) => itens.findIndex(outro => outro.tipo === item.tipo && outro.issue_key === item.issue_key) === indice)
    const itemBug = (bug: BugAtencao, motivo: string): ItemAtencaoRot => ({ chave: bug.issue_key || '\u2014', titulo: bug.resumo || '', status: bug.status || '\u2014', motivo, url: bug.url })
    const pendentes = bugs.filter(bug => !bug.encerrado)
    const graves = pendentes.filter(bug => nivelSeveridade(bug.prioridade || '') >= 3).sort((a, b) =>
        Number(b.situacao === 'estourado') - Number(a.situacao === 'estourado') || (a.tempoRestante ?? Infinity) - (b.tempoRestante ?? Infinity))
    const gravesForaPrazo = graves.filter(bug => bug.situacao === 'estourado').length
    const outrosForaPrazo = pendentes.filter(bug => bug.situacao === 'estourado' && nivelSeveridade(bug.prioridade || '') < 3)
    const semCausa = bugs.filter(bug => normalizarDefeito(bug.causa_raiz || '') === 'sem causa raiz')
    // Optional metadata may be absent in an older response; absence is not evidence.
    const semOrigem = bugs.filter(bug => bug.origem === null)
    const grupos: GrupoAtencaoRot[] = []
    const adicionar = (grupo: GrupoAtencaoRot) => { if (grupo.itens.length) grupos.push(grupo) }
    adicionar({ id: 'alta-severidade', titulo: 'Bugs pendentes de maior severidade', descricao: `${graves.length} em Alta ou acima; ${gravesForaPrazo} com SLA estourado.`, acao: `Revisar ${graves.length} ${graves.length === 1 ? 'bug' : 'bugs'}`, tom: gravesForaPrazo ? 'danger' : 'warning', itens: graves.map(bug => itemBug(bug, `${bug.prioridade}: ${bug.situacao === 'estourado' ? 'SLA estourado; priorizar acompanhamento.' : 'Defeito ainda pendente; acompanhar resolu\u00e7\u00e3o.'}`)) })
    adicionar({ id: 'sla-estourado', titulo: 'Outros bugs com SLA estourado', descricao: `${outrosForaPrazo.length} defeitos pendentes fora do prazo.`, acao: `Revisar ${outrosForaPrazo.length} ${outrosForaPrazo.length === 1 ? 'bug' : 'bugs'}`, tom: 'danger', itens: outrosForaPrazo.map(bug => itemBug(bug, 'SLA estourado e defeito ainda pendente.')) })
    const grupoOcorrencias = (tipo: OcorrenciaAtencao['tipo'], id: string, titulo: string, descricao: string, acao: string, tom: GrupoAtencaoRot['tom']) => {
        const itens = ocorrencias.filter(item => item.tipo === tipo).map(item => ({ chave: item.issue_key, titulo: item.titulo, status: item.status, motivo: item.motivo, url: item.url }))
        adicionar({ id, titulo, descricao: `${itens.length} ${descricao}`, acao: `${acao} (${itens.length})`, tom, itens })
    }
    grupoOcorrencias('plano_sem_dados', 'tp-sem-dados', 'Test Plans sem dados', 'TPs sem indicadores de execu\u00e7\u00e3o dispon\u00edveis.', 'Conferir Test Plans', 'warning')
    grupoOcorrencias('historia_sem_plano', 'historias-sem-plano', 'Hist\u00f3rias sem Test Plan', 'hist\u00f3rias sem v\u00ednculo de cobertura; conferir o contexto.', 'Conferir hist\u00f3rias', 'info')
    grupoOcorrencias('testes_falhados', 'planos-com-falhas', 'Test Plans com testes falhados', 'TPs com falhas registradas para revis\u00e3o.', 'Revisar execu\u00e7\u00f5es', 'warning')
    adicionar({ id: 'sem-causa', titulo: 'Defeitos sem causa raiz', descricao: `${semCausa.length} defeitos precisam de classifica\u00e7\u00e3o da causa.`, acao: `Conferir ${semCausa.length} defeitos`, tom: 'info', itens: semCausa.map(bug => itemBug(bug, 'Causa raiz n\u00e3o informada; completar classifica\u00e7\u00e3o.')) })
    adicionar({ id: 'sem-origem', titulo: 'Defeitos sem origem classificada', descricao: `${semOrigem.length} defeitos sem defini\u00e7\u00e3o entre originado e herdado.`, acao: `Conferir ${semOrigem.length} origens`, tom: 'info', itens: semOrigem.map(bug => itemBug(bug, 'Origem n\u00e3o classificada; revisar em Rastreabilidade.')) })
    const ordem = { danger: 0, warning: 1, info: 2 }
    return grupos.sort((a, b) => ordem[a.tom] - ordem[b.tom])
}
