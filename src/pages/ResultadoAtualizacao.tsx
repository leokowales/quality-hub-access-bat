import { useState } from 'react'
import { RefreshCw, X, Info, PlusCircle, Search, Bug, CircleAlert, ChevronLeft, ChevronRight, BookOpenText, ClipboardCheck, ClipboardList, Layers, Clock3, MinusCircle, Plus } from 'lucide-react'
import { decidirRastreabilidade } from '../services/sprintAtivaService'
import type { EscolhaEscopo, ItemRastreabilidade } from '../services/sprintAtivaService'
import type { RastreabilidadeProps } from './Rastreabilidade'
import { contextoAutomatico, decisaoDeOrigem, exigeJustificativa, decisoesProntas, normalizarTipo, opcoesDecisao, opcoesDoLote, prepararLote, tipoMetrificavel } from '../services/resultadoAtualizacaoRegras'
import '../styles/pages/ResultadoAtualizacao.css'

type Aba = 'pendentes' | 'anteriores' | 'automaticas'
type Acao = EscolhaEscopo['acao'] | ''
const normalizar = normalizarTipo
const tipoVisual = (tipo: string) => {
  const t = normalizar(tipo)
  if (['historia', 'story', 'user story'].includes(t)) return { nome: 'História', classe: 'story', icone: BookOpenText }
  if (['assertthat test plan', 'test plan', 'testplan', 'tp'].includes(t)) return { nome: 'Test Plan', classe: 'plan', icone: ClipboardCheck }
  if (['bug', 'sub-bug', 'sub bug', 'subbug'].includes(t)) return { nome: t === 'bug' ? 'Bug' : 'Sub-Bug', classe: 'bug', icone: Bug }
  if (['epic', 'epico'].includes(t)) return { nome: 'Épico', classe: 'epic', icone: Layers }
  return { nome: tipo || 'Demanda', classe: 'other', icone: ClipboardList }
}
function situacao(item: ItemRastreabilidade) {
  if (contextoAutomatico(item)) return { titulo: 'Contexto automático', detalhe: `Mantida por ${item.requerida_por.join(', ')}`, classe: 'previous', icone: Layers }
  if (item.pendencia === 'nova') return { titulo: 'Nova demanda', detalhe: 'Aguardando sua decisão', classe: 'new', icone: PlusCircle }
  if (item.pendencia === 'ausencia') return { titulo: 'Não encontrada', detalhe: 'Último dado válido preservado', classe: 'missing', icone: Search }
  if (item.pendencia === 'classificar_origem') return { titulo: 'Origem a classificar', detalhe: 'Não foi possível identificar', classe: 'origin', icone: CircleAlert }
  return { titulo: item.estado === 'excluida' ? 'Exclusão preservada' : item.estado === 'incluida' ? 'Inclusão preservada' : 'Contexto preservado', detalhe: item.motivo === 'Encontrada na atualização Jira' ? 'Encontrada na atualização' : item.motivo, classe: 'previous', icone: ClipboardCheck }
}
export default function ResultadoAtualizacao({ cicloId, nome, dados, erro, ocupado, recarregar, sincronizar, atualizado, fechar, paginaCompleta = false, adicionarDemanda }: RastreabilidadeProps & { paginaCompleta?: boolean; adicionarDemanda?: () => void }) {
  const tituloId = paginaCompleta ? 'qh-trace-title' : 'qh-update-title'
  const [aba, setAba] = useState<Aba>('pendentes')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(10)
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroSituacao, setFiltroSituacao] = useState('todas')
  const [acaoLote, setAcaoLote] = useState<Acao>('')
  const [motivoLote, setMotivoLote] = useState('')
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [escolhas, setEscolhas] = useState<Record<string, { acao: Acao; motivo: string }>>({})
  const [versaoEscolhas, setVersaoEscolhas] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [falha, setFalha] = useState('')
  const [feedback, setFeedback] = useState('')
  const bloqueado = ocupado || salvando || !dados?.editavel
  const itens = (dados?.itens ?? []).filter(i => tipoMetrificavel(i.demanda.issue_type))
  const pendentes = itens.filter(i => i.pendencia && !contextoAutomatico(i))
  const anteriores = paginaCompleta ? itens : itens.filter(i => !i.pendencia && !contextoAutomatico(i))
  const novas = pendentes.filter(i => i.pendencia === 'nova')
  const ausentes = pendentes.filter(i => i.pendencia === 'ausencia')
  const origens = pendentes.filter(i => i.pendencia === 'classificar_origem')
  const ultimaSync = dados?.historico.find(e => e.acao === 'sincronizacao')
  const automaticasRegistradas = (dados?.historico ?? []).filter(e => (e.versao === ultimaSync?.versao || (e.acao === 'contexto_automatico' && e.versao > (ultimaSync?.versao ?? -1))) && ['dados_atualizados', 'entrada_automatica', 'contexto', 'contexto_automatico', 'reencontrada', 'origem_direta', 'candidata_ausente'].includes(e.acao))
  const automaticas = [...automaticasRegistradas, ...itens.filter(i => contextoAutomatico(i) && !automaticasRegistradas.some(e => e.issue_key === i.demanda.key && ['contexto', 'contexto_automatico'].includes(e.acao))).map((i, index) => ({
    id: -index - 1, versao: dados?.versao ?? 0, issue_key: i.demanda.key, acao: 'contexto_automatico', antes: 'Contexto de rastreabilidade', depois: `Mantida por ${i.requerida_por.join(', ')}`, motivo: 'Manutenção automática do contexto necessário às demandas incluídas.', criado_em: ultimaSync?.criado_em ?? '',
  }))]
  const tiposDisponiveis = [...new Set(itens.map(i => tipoVisual(i.demanda.issue_type).nome))].sort()
  const filtradas = (aba === 'pendentes' ? pendentes : anteriores).filter(i => (filtroTipo === 'todos' || tipoVisual(i.demanda.issue_type).nome === filtroTipo) && (filtroSituacao === 'todas' || i.pendencia === filtroSituacao) && `${i.demanda.key} ${i.demanda.summary} ${tipoVisual(i.demanda.issue_type).nome}`.toLocaleLowerCase('pt-BR').includes(busca.trim().toLocaleLowerCase('pt-BR')))
  const eventos = (paginaCompleta ? dados?.historico ?? [] : automaticas).filter(e => (filtroTipo === 'todos' || itens.some(i => i.demanda.key === e.issue_key && tipoVisual(i.demanda.issue_type).nome === filtroTipo)) && `${e.issue_key ?? ''} ${e.acao} ${e.motivo} ${e.antes ?? ''} ${e.depois ?? ''}`.toLocaleLowerCase('pt-BR').includes(busca.trim().toLocaleLowerCase('pt-BR')))
  const total = aba === 'automaticas' ? eventos.length : filtradas.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const atual = Math.min(pagina, paginas)
  const inicio = (atual - 1) * porPagina
  const visiveis = filtradas.slice(inicio, inicio + porPagina)
  const alvoCheckbox = (filtradas.length <= 200 ? filtradas : visiveis).filter(i => opcoesDecisao(i).length)
  const todasMarcadas = alvoCheckbox.length > 0 && alvoCheckbox.every(i => selecionadas.includes(i.demanda.key))
  const prontas = decisoesProntas(selecionadas, escolhas)
  const itensSelecionados = itens.filter(i => selecionadas.includes(i.demanda.key))
  const opcoesLote = opcoesDoLote(itensSelecionados)
  const origemLote = decisaoDeOrigem(acaoLote) || (!!opcoesLote.length && opcoesLote.every(([acao]) => decisaoDeOrigem(acao)))
  function preencherLote() {
    try {
      const lote = prepararLote(itensSelecionados, acaoLote, origemLote ? '' : motivoLote)
      if (versaoEscolhas === null && dados) setVersaoEscolhas(dados.versao)
      setEscolhas(prev => ({ ...prev, ...Object.fromEntries(lote.map(d => [d.issue_key, { acao: d.acao, motivo: d.motivo }])) }))
      setFalha('')
    } catch (e) { setFalha(e instanceof Error ? e.message : 'Revise a seleção do lote.') }
  }
  function marcar(key: string, checked: boolean) {
    if (versaoEscolhas === null && dados) setVersaoEscolhas(dados.versao)
    setSelecionadas(prev => checked ? [...new Set([...prev, key])] : prev.filter(k => k !== key))
  }
  function escolher(key: string, acao: Acao) {
    if (versaoEscolhas === null && dados) setVersaoEscolhas(dados.versao)
    setEscolhas(prev => ({ ...prev, [key]: { acao, motivo: decisaoDeOrigem(acao) ? '' : prev[key]?.motivo ?? '' } }))
    marcar(key, !!acao)
  }
  async function aplicar() {
    if (!dados || bloqueado || !prontas.length || prontas.length > 200) return
    setSalvando(true); setFalha('')
    try {
      const resposta = await decidirRastreabilidade(cicloId, versaoEscolhas ?? dados.versao, prontas)
      const aplicadas = new Set(prontas.map(d => d.issue_key))
      setSelecionadas(prev => prev.filter(key => !aplicadas.has(key)))
      setEscolhas(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !aplicadas.has(key))))
      setVersaoEscolhas(resposta.versao)
      setAcaoLote(''); setMotivoLote('')
      setFeedback(`${prontas.length} decisão(ões) aplicada(s). ${resposta.pendentes} pendência(s) restante(s).`)
      atualizado(resposta)
      if (!paginaCompleta && resposta.pendentes === 0) fechar?.()
    } catch (e) {
      setFalha(e instanceof Error ? e.message : 'Não foi possível aplicar as decisões.')
      setSelecionadas([]); setEscolhas({}); setVersaoEscolhas(null); recarregar()
    } finally { setSalvando(false) }
  }
  const incluidos = itens.filter(i => i.estado === 'incluida')
  const diretos = incluidos.filter(i => !i.contextual).length
  const cards = paginaCompleta ? [
    { titulo: 'Demandas no escopo', valor: incluidos.length, detalhe: `${diretos} de escopo independente · ${incluidos.length - diretos} por rastreabilidade`, icone: ClipboardList, classe: 'auto' },
    { titulo: 'Decisões pendentes', valor: pendentes.length, detalhe: `${novas.length} novas · ${ausentes.length} não encontradas · ${origens.length} origens`, icone: Clock3, classe: 'missing' },
    { titulo: 'Demandas excluídas', valor: itens.filter(i => i.estado === 'excluida').length, detalhe: 'Decisão manual preservada', icone: MinusCircle, classe: 'missing' },
    { titulo: 'Bugs com origem a classificar', valor: origens.length, detalhe: 'Não entram na densidade', icone: Bug, classe: 'origin' },
  ] : [
    { titulo: 'Novas demandas', valor: novas.length, detalhe: `${novas.filter(i => tipoVisual(i.demanda.issue_type).classe === 'story').length} histórias · ${novas.filter(i => tipoVisual(i.demanda.issue_type).classe === 'plan').length} test plans`, icone: PlusCircle, classe: 'new' },
    { titulo: 'Demandas não encontradas', valor: ausentes.length, detalhe: 'Não retornaram no escopo consultado', icone: Search, classe: 'missing' },
    { titulo: 'Bugs com origem a classificar', valor: origens.length, detalhe: 'Definir se é desta sprint ou herdado', icone: Bug, classe: 'origin' },
    { titulo: 'Atualizações automáticas', valor: automaticas.length, detalhe: 'Status, testes e cenários', icone: RefreshCw, classe: 'auto' },
  ]
  return <section className={`qh-update${paginaCompleta ? ' qh-trace-page' : ''}`} aria-labelledby={tituloId} aria-busy={salvando || ocupado}>
    {paginaCompleta ? <header className="qh-trace-heading">
      <div><small>QUALIDADE / SPRINT ATIVA</small><div className="qh-trace-title-line"><h2 id={tituloId}>Rastreabilidade</h2><span className="qh-trace-version" title="Versão do acompanhamento">{dados ? `v${dados.versao}` : '—'}</span><span className="qh-trace-active">● Ativa</span></div><p title={nome}>{nome}</p></div>
      <div className="qh-trace-tools"><div className="qh-trace-sync-panel"><div className="qh-trace-sync-info"><span className="qh-trace-sync-icon"><RefreshCw size={15} /></span><span><small>Última sincronização</small><strong>{ultimaSync ? new Date(ultimaSync.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Ainda não realizada'}</strong></span></div><button type="button" onClick={sincronizar} disabled={bloqueado}><RefreshCw size={15} />{ocupado ? 'Sincronizando…' : 'Sincronizar agora'}</button></div><button type="button" className="qh-trace-add" onClick={adicionarDemanda} disabled={bloqueado}><Plus size={17} />Adicionar demanda</button></div>
    </header> : <>
    <header className="qh-update-header"><span className="qh-update-main-icon"><RefreshCw size={27} /></span><div><h2 id={tituloId}>Resultado da atualização</h2><strong>{nome}</strong><p>{ultimaSync ? `Sincronizada em ${new Date(ultimaSync.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Carregando o resultado da sincronização…'}</p></div><button className="qh-update-close" type="button" onClick={fechar} disabled={salvando} aria-label="Decidir depois e fechar"><X size={20} /></button></header>
    <div className="qh-update-notice"><Info size={18} /><p>Os dados das demandas incluídas já foram atualizados. Revise abaixo as mudanças que precisam da sua decisão.</p></div>
    </>}
    {(erro || falha) && <div className="qh-update-error" role="alert"><CircleAlert size={17} /><span>{falha || erro}</span><button type="button" onClick={recarregar} disabled={salvando}>Recarregar</button></div>}
    <div className="qh-update-summary">{cards.map(({ titulo, valor, detalhe, icone: Icon, classe }) => <div className={`qh-update-stat is-${classe}`} key={titulo}><span className="qh-update-stat-icon"><Icon size={21} /></span><div><strong>{dados ? valor : '—'}</strong><span>{titulo}</span><small>{detalhe}</small></div></div>)}</div>
    <div className="qh-update-workspace">
      <nav className="qh-update-tabs" aria-label="Visões do resultado da atualização">{([
        ['pendentes', paginaCompleta ? 'Pendências' : 'Precisam de decisão', pendentes.length], ['anteriores', paginaCompleta ? 'Escopo e rastreabilidade' : 'Decisões anteriores', paginaCompleta ? incluidos.length : anteriores.length], ['automaticas', paginaCompleta ? 'Histórico' : 'Atualizações automáticas', paginaCompleta ? dados?.historico.length ?? 0 : automaticas.length],
      ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={aba === value} aria-label={paginaCompleta && value === 'pendentes' && pendentes.length > 0 ? `${label}: há decisões pendentes` : undefined} onClick={() => { setAba(value); setPagina(1); setFiltroSituacao('todas'); setSelecionadas([]); setAcaoLote('') }}>{label}{paginaCompleta ? value === 'pendentes' && pendentes.length > 0 && <i className="qh-trace-pending-dot" aria-hidden="true" /> : <span>{dados ? count : '—'}</span>}</button>)}</nav>
      <div className="qh-update-table-panel">{paginaCompleta && <div className="qh-trace-panel-heading"><div><h3>{aba === 'pendentes' ? 'Itens que precisam da sua decisão' : aba === 'anteriores' ? 'Escopo e rastreabilidade' : 'Histórico do acompanhamento'}</h3><p>{aba === 'pendentes' ? 'Novas demandas, demandas não encontradas e bugs que precisam de classificação de origem.' : aba === 'anteriores' ? 'Demandas incluídas, contextos necessários e decisões anteriores preservadas.' : 'Atualizações e decisões registradas durante esta sprint.'}</p></div><label className="qh-trace-search"><Search size={16} /><input type="search" aria-label="Buscar na rastreabilidade" placeholder="Buscar por chave, resumo ou tipo…" value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); setSelecionadas([]); setAcaoLote('') }} /></label></div>}<div className="qh-update-table-toolbar">
        <select aria-label="Filtrar por tipo" value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setPagina(1); setSelecionadas([]); setAcaoLote('') }}><option value="todos">Todos os tipos</option>{tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}</select>
        {aba === 'pendentes' && <select aria-label="Filtrar por situação" value={filtroSituacao} onChange={e => { setFiltroSituacao(e.target.value); setPagina(1); setSelecionadas([]); setAcaoLote('') }}><option value="todas">Todas as situações</option><option value="nova">Novas demandas</option><option value="ausencia">Não encontradas</option><option value="classificar_origem">Origem a classificar</option></select>}
        {aba !== 'automaticas' && !!selecionadas.length && <div className="qh-update-bulk">
          <select aria-label="Decisão em lote" value={opcoesLote.some(([a]) => a === acaoLote) ? acaoLote : ''} onChange={e => setAcaoLote(e.target.value as Acao)} disabled={bloqueado || !opcoesLote.length}><option value="">Ação em lote</option>{opcoesLote.map(([a, label]) => <option key={a} value={a}>{label}</option>)}</select>
          <input type="text" aria-label="Justificativa do lote" placeholder={origemLote ? 'Origem dispensa justificativa' : 'Justificativa para todas as selecionadas…'} maxLength={4000} value={origemLote ? '' : motivoLote} onChange={e => setMotivoLote(e.target.value)} disabled={bloqueado || origemLote} />
          <button type="button" disabled={bloqueado || (exigeJustificativa(acaoLote) && !motivoLote.trim()) || !opcoesLote.some(([a]) => a === acaoLote)} onClick={preencherLote}>Preencher selecionadas</button>
          <button className="qh-update-clear-selection" type="button" aria-label="Limpar seleção" title="Limpar seleção" disabled={bloqueado} onClick={() => { setSelecionadas([]); setAcaoLote('') }}><X size={15} /></button>

        </div>}
        </div>
        {aba !== 'automaticas' && !!selecionadas.length && !opcoesLote.length && <p className="qh-update-selection-note" role="status">As situações selecionadas não têm uma ação comum. Preencha as decisões individualmente ou refine a seleção.</p>}
        <div className="qh-update-table-scroll"><table className="qh-update-table">
          {aba === 'automaticas' ? <><colgroup><col style={{ width: paginaCompleta ? '12%' : '13%' }} /><col style={{ width: paginaCompleta ? '34%' : '22%' }} /><col style={{ width: paginaCompleta ? '18%' : '25%' }} /><col style={{ width: paginaCompleta ? '18%' : '25%' }} /><col style={{ width: paginaCompleta ? '18%' : '15%' }} /></colgroup><thead><tr><th>Chave</th><th>{paginaCompleta ? 'Evento / Decisão' : 'Alteração automática'}</th><th>Antes</th><th>Depois</th><th>Detectada em</th></tr></thead><tbody>{eventos.slice(inicio, inicio + porPagina).map(e => <tr key={e.id}><td>{e.issue_key ?? 'Contexto'}</td><td>{paginaCompleta && <strong className="qh-trace-event-action">{e.acao.replaceAll('_', ' ')}</strong>}{e.motivo}</td><td>{e.antes ?? '—'}</td><td>{e.depois ?? '—'}</td><td>{e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR', paginaCompleta ? { dateStyle: 'short', timeStyle: 'short' } : { hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>)}</tbody></> : <>
            <colgroup><col className="qh-update-col-check" /><col className="qh-update-col-key" /><col className="qh-update-col-type" /><col className="qh-update-col-summary" /><col className="qh-update-col-status" /><col className="qh-update-col-action" /><col className="qh-update-col-reason" /></colgroup>
            <thead><tr><th><input type="checkbox" aria-label={filtradas.length <= 200 ? 'Selecionar todas as demandas filtradas' : 'Selecionar demandas desta página'} title={filtradas.length <= 200 ? 'Selecionar todas as demandas filtradas' : 'Selecionar esta página (até 200 decisões por aplicação)'} checked={todasMarcadas} disabled={bloqueado || !alvoCheckbox.length} ref={node => { if (node) node.indeterminate = !todasMarcadas && alvoCheckbox.some(i => selecionadas.includes(i.demanda.key)) }} onChange={e => { if (versaoEscolhas === null && dados) setVersaoEscolhas(dados.versao); const keys = alvoCheckbox.map(i => i.demanda.key); setSelecionadas(prev => e.target.checked ? [...new Set([...prev, ...keys])] : prev.filter(k => !keys.includes(k))) }} /></th><th>Chave</th><th>Tipo</th><th>Resumo</th><th>Situação detectada</th><th>Ação / Decisão</th><th>Justificativa</th></tr></thead>
            <tbody>{visiveis.map(item => {
              const key = item.demanda.key
              const visual = tipoVisual(item.demanda.issue_type)
              const TipoIcon = visual.icone
              const estado = situacao(item)
              const SituacaoIcon = estado.icone
              return <tr key={key} className={!item.pendencia ? 'is-previous' : undefined}>
                <td><input type="checkbox" aria-label={`Selecionar ${key}`} checked={selecionadas.includes(key)} disabled={bloqueado || !opcoesDecisao(item).length} onChange={e => marcar(key, e.target.checked)} /></td>
                <td>{item.demanda.url ? <a href={item.demanda.url} target="_blank" rel="noreferrer">{key}</a> : key}</td>
                <td><span className={`qh-update-issue-type is-${visual.classe}`}><i><TipoIcon size={13} /></i>{visual.nome}</span></td>
                <td><span className="qh-update-summary-text" title={item.demanda.summary}>{item.demanda.summary}</span>{!!item.requerida_por?.length && !contextoAutomatico(item) && <small className="qh-update-dependency">Necessária por: {item.requerida_por.join(', ')}</small>}</td>
                <td><span className={`qh-update-situation is-${estado.classe}`} title={estado.detalhe}><SituacaoIcon size={18} /><span><strong>{estado.titulo}</strong><small>{contextoAutomatico(item) ? `Necessária por ${item.requerida_por.length} ${item.requerida_por.length === 1 ? 'demanda' : 'demandas'}` : estado.detalhe}</small></span></span></td>
                <td><select aria-label={`Decisão para ${key}`} disabled={bloqueado || !opcoesDecisao(item).length} value={escolhas[key]?.acao ?? ''} onChange={e => escolher(key, e.target.value as Acao)}><option value="">{contextoAutomatico(item) ? 'Contexto automático' : !item.pendencia ? 'Manter decisão anterior' : 'Selecione uma decisão'}</option>{opcoesDecisao(item).map(([acao, label]) => <option value={acao} key={acao}>{label}</option>)}</select></td>
                <td><input aria-label={`Justificativa para ${key}`} type="text" maxLength={4000} placeholder={decisaoDeOrigem(escolhas[key]?.acao ?? '') || (item.pendencia === 'classificar_origem' && !escolhas[key]?.acao) ? 'Não necessária para origem' : 'Descreva o motivo…'} disabled={bloqueado || contextoAutomatico(item) || decisaoDeOrigem(escolhas[key]?.acao ?? '') || (item.pendencia === 'classificar_origem' && !escolhas[key]?.acao)} value={escolhas[key]?.motivo ?? ''} onChange={e => { if (versaoEscolhas === null && dados) setVersaoEscolhas(dados.versao); setEscolhas(prev => ({ ...prev, [key]: { acao: prev[key]?.acao ?? '', motivo: e.target.value } })) }} /></td>
              </tr>
            })}</tbody></>}
        </table>{total === 0 && <p className="qh-update-empty" role="status">{!dados ? 'Carregando mudanças…' : aba === 'pendentes' ? pendentes.length ? 'Nenhuma pendência corresponde aos filtros selecionados.' : 'Nenhuma decisão pendente. Você pode consultar as outras abas.' : 'Nenhum registro nesta visão.'}</p>}</div>
        <div className="qh-update-pagination"><span aria-live="polite">{selecionadas.length} {selecionadas.length === 1 ? 'item selecionado' : 'itens selecionados'}</span><label>Itens por página: <select aria-label="Itens por página" value={porPagina} onChange={e => { setPorPagina(Number(e.target.value)); setPagina(1) }}>{[10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}</select></label><span>{total ? inicio + 1 : 0}–{Math.min(inicio + porPagina, total)} de {total}</span><div><button type="button" aria-label="Página anterior" disabled={atual === 1} onClick={() => setPagina(atual - 1)}><ChevronLeft size={18} /></button><button type="button" aria-label="Próxima página" disabled={atual === paginas} onClick={() => setPagina(atual + 1)}><ChevronRight size={18} /></button></div></div>
      </div>
    </div>
    <footer className="qh-update-footer"><p role="status"><Info size={16} />{feedback || (selecionadas.length > prontas.length ? `${prontas.length} prontas para aplicar; ${selecionadas.length - prontas.length} selecionadas ainda sem ação ou justificativa.` : paginaCompleta ? 'Você pode aplicar apenas parte das decisões. As pendências e a indicação no menu serão mantidas até que todas sejam resolvidas.' : 'Aplique as decisões prontas. O popup fecha automaticamente ao resolver a última pendência.')}</p><div>{!paginaCompleta && <button className="qh-update-later" type="button" onClick={fechar} disabled={salvando}>Decidir depois</button>}<button className="qh-update-apply" type="button" onClick={() => void aplicar()} disabled={bloqueado || !prontas.length || prontas.length > 200}>{salvando ? 'Aplicando…' : `Aplicar ${prontas.length} ${prontas.length === 1 ? 'decisão' : 'decisões'}`}</button></div></footer>
  </section>
}
