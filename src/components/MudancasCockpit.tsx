import { useEffect, useRef, useState } from 'react'
import { History, Eye, X, ArrowRight, CheckCircle2, XCircle, ArrowLeftRight, FileClock, Sparkles, TrendingDown } from 'lucide-react'
import EstadoConsulta from './EstadoConsulta'
import type { RecursoConsultado } from '../services/consultaRecurso'
import type { MudancaHistoricaSprint } from '../services/sprintAtivaService'
import { horarioDeteccao, categoriaMudanca } from '../services/classificarMudancaSprint'

type Props = { consulta: RecursoConsultado<{ mudancas: MudancaHistoricaSprint[] }> }
function IconeMudanca({ item }: { item: MudancaHistoricaSprint }) {
  const categoria = categoriaMudanca(item)
  const Icone = categoria === 'aprovados' ? CheckCircle2 : categoria === 'falhados' ? XCircle : categoria === 'mistos' ? ArrowLeftRight : FileClock
  return <span className={`qh-v3-change-icon ${categoria}`}><Icone size={13} strokeWidth={1.9} aria-hidden="true" /></span>
}
const tipos: Record<string, string> = { status: 'Status', execucao: 'Execução', rastreabilidade: 'Rastreabilidade', governanca: 'Governança', multipla: 'Múltiplas alterações' }
export default function MudancasCockpit({ consulta }: Props) {
  const [filtro, setFiltro] = useState('todos')
  const [aberto, setAberto] = useState<'historico' | MudancaHistoricaSprint | null>(null)
  const [pagina, setPagina] = useState(1)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (aberto && !dialog.current?.open) dialog.current?.showModal()
    if (!aberto && dialog.current?.open) dialog.current.close()
  }, [aberto])
  const chave = (item: MudancaHistoricaSprint) => JSON.stringify([item.snapshot_id, item.issue_key, item.tipo, item.descricao])
  const registros = [...new Map((consulta.dados?.mudancas ?? []).map(item => [chave(item), item])).values()].sort((a, b) => (Date.parse(b.atualizado_em) || 0) - (Date.parse(a.atualizado_em) || 0))
  const filtrados = registros.filter(item => filtro === 'todos' || item.impacto === filtro)
  const paginas = Math.max(1, Math.ceil(filtrados.length / 10))
  const atual = Math.min(pagina, paginas)
  const detalhes = aberto === 'historico' ? filtrados.slice((atual - 1) * 10, atual * 10) : aberto ? [aberto] : []
  const impacto = (item: MudancaHistoricaSprint) => item.impacto === 'melhoria' ? 'Melhoria' : item.impacto === 'regressao' ? 'Regressão' : item.impacto === 'neutro' ? 'Neutra' : 'Sem classificação'
  return <section className="qh-v3-card qh-v3-changes-card" aria-label="Últimas mudanças">
    <div className="qh-v3-sectiontitle"><strong><History size={15} className="qh-v3-changes-heading-icon" />Últimas mudanças</strong><span>{consulta.status === 'sucesso' ? `${registros.length} alterações` : '—'}</span></div>
    <div className="qh-v3-tabs qh-v3-changes-tabs" role="group" aria-label="Filtrar mudanças">{[['todos', 'Todas'], ['melhoria', 'Melhorias'], ['regressao', 'Regressões'], ['neutro', 'Neutras']].map(([id, nome]) => <button key={id} type="button" className={`${filtro === id ? 'active ' : ''}${id}`} aria-pressed={filtro === id} onClick={() => { setFiltro(id); setPagina(1) }}>{id === 'melhoria' && <Sparkles size={12} aria-hidden="true" />}{id === 'regressao' && <TrendingDown size={12} aria-hidden="true" />}{nome}</button>)}</div>
    <EstadoConsulta semAcao consulta={consulta} titulo="Histórico de mudanças" />
    <div className="qh-v3-changes-list">{filtrados.slice(0, 4).map(item => <div className="qh-v3-change-compact" key={chave(item)}>
      <IconeMudanca item={item} />
      <div className="qh-v3-change-text"><strong>{item.issue_key}<span>{tipos[item.tipo] ?? item.tipo}</span></strong><p title={item.descricao}>{item.descricao || item.titulo || 'Alteração identificada'}</p><time dateTime={item.atualizado_em} title="Detectado na sincronização; não necessariamente o horário da alteração no Jira">{horarioDeteccao(item)} · {impacto(item)}</time></div>
      <button type="button" className="qh-v3-attention-view" title="Ver alteração" aria-label={`Ver alteração de ${item.issue_key}`} onClick={() => setAberto(item)}><Eye size={14} strokeWidth={1.8} /></button>
    </div>)}{!filtrados.length && consulta.status === 'sucesso' && <p className="qh-v3-note">{registros.length ? 'Nenhuma alteração neste filtro.' : 'Nenhuma mudança detectada entre as sincronizações disponíveis.'}</p>}</div>
    <button type="button" className="qh-v3-card-footer" disabled={!filtrados.length} onClick={() => { setPagina(1); setAberto('historico') }}>Ver histórico ({filtrados.length})<ArrowRight size={14} /></button>
    <dialog ref={dialog} className="qh-v3-attention-dialog qh-v3-history-dialog" aria-labelledby="qh-history-title" onCancel={() => setAberto(null)} onClose={() => setAberto(null)}><header><strong id="qh-history-title">{aberto === 'historico' ? 'Histórico de mudanças' : 'Detalhes da alteração'}</strong><button type="button" aria-label="Fechar histórico" onClick={() => setAberto(null)}><X size={17} /></button></header>
      <p>Horários indicam a sincronização que detectou a mudança.</p>
      <div className="qh-v3-attention-table-wrap"><table><thead><tr><th>Jira</th><th>Tipo / impacto</th><th>Alteração</th><th>Detectada em</th></tr></thead><tbody>{detalhes.map(item => <tr key={chave(item)}><td>{item.issue_key}</td><td>{tipos[item.tipo] ?? item.tipo}<small className={`qh-v3-history-impact is-${item.impacto ?? 'unknown'}`}>{impacto(item)}</small></td><td className="qh-v3-history-description">{item.descricao || item.titulo || '—'}</td><td>{horarioDeteccao(item)}</td></tr>)}</tbody></table></div>
      {aberto === 'historico' && <nav className="qh-v3-history-pagination" aria-label="Paginar histórico"><span>{filtrados.length ? (atual - 1) * 10 + 1 : 0}–{Math.min(atual * 10, filtrados.length)} de {filtrados.length}</span>{paginas > 1 && <div><button type="button" disabled={atual === 1} onClick={() => setPagina(atual - 1)}>Anterior</button><span>{atual} / {paginas}</span><button type="button" disabled={atual === paginas} onClick={() => setPagina(atual + 1)}>Próxima</button></div>}</nav>}
    </dialog>
  </section>
}
