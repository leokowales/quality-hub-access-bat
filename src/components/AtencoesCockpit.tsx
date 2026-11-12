import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, ListFilter, Eye, X, ArrowRight } from 'lucide-react'
import EstadoConsulta from './EstadoConsulta'
import type { RecursoConsultado } from '../services/consultaRecurso'
import type { AtencoesSprintAtiva, IndicadoresSprintAtiva } from '../services/sprintAtivaService'
import { montarAtencoesRot } from '../services/rotAttention'
import { normalizarDefeito } from '../services/rotDefectAnalysis'
import { calcularSla } from '../services/calculoSla'

type Props = { indicadores: RecursoConsultado<IndicadoresSprintAtiva>; atencoes: RecursoConsultado<AtencoesSprintAtiva> }
export default function AtencoesCockpit({ indicadores, atencoes }: Props) {
  const [filtro, setFiltro] = useState('todos')
  const [aberto, setAberto] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (aberto && !dialog.current?.open) dialog.current?.showModal()
    if (!aberto && dialog.current?.open) dialog.current.close()
  }, [aberto])
  const bugs = (indicadores.dados?.defeitos.dados_sla ?? []).map(bug => {
    const sla = calcularSla(bug.prioridade, bug.criacao, bug.resolucao)
    const status = normalizarDefeito(bug.status ?? '')
    const cancelado = ['cancelado', 'cancelada', 'canceled', 'cancelled'].includes(status)
    return { ...bug, situacao: cancelado ? 'sem_dados' : sla.situacao,
      encerrado: cancelado || sla.encerrado || ['concluido', 'concluida', 'done', 'closed', 'resolved', 'resolvido', 'fechado'].includes(status),
      tempoRestante: sla.minutosPrevistos !== null && sla.minutosConsumidos !== null ? sla.minutosPrevistos - sla.minutosConsumidos : null }
  })
  const grupos = montarAtencoesRot(bugs, atencoes.dados?.ocorrencias ?? [])
  const categoria = (id: string) => ['tp-sem-dados', 'planos-com-falhas'].includes(id) ? 'planos' : id === 'historias-sem-plano' ? 'historias' : 'bugs'
  const filtrados = grupos.filter(grupo => filtro === 'todos' || categoria(grupo.id) === filtro)
  const detalhes = aberto === 'todos' ? filtrados : grupos.filter(grupo => grupo.id === aberto)
  return <section className="qh-v3-card qh-v3-attention-card" aria-label="Pontos de atenção">
    <div className="qh-v3-sectiontitle"><strong><AlertCircle size={15} className="qh-v3-attention-heading-icon" />Pontos de atenção</strong><label className="qh-v3-attention-filter"><ListFilter size={13} strokeWidth={1.8} /><select aria-label="Filtrar pontos de atenção" value={filtro} onChange={event => setFiltro(event.target.value)}><option value="todos">Todos</option><option value="bugs">Bugs</option><option value="planos">Test Plans</option><option value="historias">Histórias</option></select></label></div>
    <EstadoConsulta semAcao consulta={atencoes} titulo="Pontos de atenção" />
    <div className="qh-v3-attention-summary">{filtrados.map(grupo => {
      const Icone = grupo.tom === 'info' ? Info : AlertTriangle
      const tom = grupo.tom === 'danger' ? 'acao' : grupo.tom === 'warning' ? 'verificar' : 'informativo'
      return <div className="qh-v3-attention-summary-item" key={grupo.id}><span className={`qh-v3-att-icon ${tom}`}><Icone size={16} strokeWidth={1.8} /></span><span className="qh-v3-attention-summary-copy"><strong>{grupo.titulo}</strong><small>{grupo.descricao}</small></span><button type="button" className="qh-v3-attention-view" aria-label={`${grupo.acao}: ${grupo.titulo}`} title={grupo.acao} onClick={() => setAberto(grupo.id)}><Eye size={14} strokeWidth={1.8} /></button></div>
    })}{!filtrados.length && atencoes.status === 'sucesso' && indicadores.status === 'sucesso' && <p className="qh-v3-note">Nenhuma pendência neste filtro.</p>}</div>
    <button className="qh-v3-card-footer" type="button" disabled={!filtrados.length} onClick={() => setAberto('todos')}>Ver todas as pendências ({filtrados.length} grupos)<ArrowRight size={14} /></button>
    <dialog ref={dialog} className="qh-v3-attention-dialog" aria-labelledby="qh-attention-dialog-title" onCancel={() => setAberto(null)} onClose={() => setAberto(null)}>
      <header><strong id="qh-attention-dialog-title">Pontos de atenção</strong><button type="button" aria-label="Fechar pontos de atenção" onClick={() => setAberto(null)}><X size={17} /></button></header>
      {detalhes.map(grupo => <section key={grupo.id}><h3>{grupo.titulo} <small>{grupo.itens.length} itens</small></h3><p>{grupo.descricao}</p><div className="qh-v3-attention-table-wrap"><table><thead><tr><th>ID</th><th>Resumo</th><th>Status</th><th>Motivo / ação</th></tr></thead><tbody>{grupo.itens.map((item, i) => <tr key={`${item.chave}-${i}`}><td>{item.url && /^https?:\/\//i.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.chave}</a> : item.chave}</td><td>{item.titulo || '—'}</td><td>{item.status}</td><td>{item.motivo}</td></tr>)}</tbody></table></div></section>)}
    </dialog>
  </section>
}
