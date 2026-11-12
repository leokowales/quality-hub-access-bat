import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Info, TriangleAlert, ChartNoAxesColumnIncreasing, ShieldCheck, Clock3, RefreshCw, CheckCircle2, Search, X, LockKeyhole, History } from 'lucide-react'
import type { RecursoConsultado } from '../services/consultaRecurso'
import type { DadosRegistroGovernanca, RegistroGovernanca, RegistrosGovernanca, TipoRegistro, StatusRegistro, FiltrosGovernanca, EventoGovernanca } from '../services/rotGovernance'
import { TIPOS_REGISTRO, STATUS_REGISTRO, salvarRegistroGovernanca, removerRegistroGovernanca, hojeGovernanca, filtrarRegistrosGovernanca, consultarHistoricoGovernanca, EVENTOS_GOVERNANCA } from '../services/rotGovernance'

const ICONES_TIPO = { informativo: Info, ponto_atencao: TriangleAlert, evolucao_futura: ChartNoAxesColumnIncreasing, governanca: ShieldCheck }
const ICONES_STATUS = { pendente: Clock3, em_andamento: RefreshCw, bloqueado: LockKeyhole, concluido: CheckCircle2 }
const dataRegistro = (valor: string | null) => valor ? valor.split('-').reverse().join('/') : '—'
type Edicao = DadosRegistroGovernanca & { id?: number }
type Props = { cicloId: string; consulta: RecursoConsultado<RegistrosGovernanca>; somenteLeitura?: boolean; compacto?: boolean }

function HistoricoRegistros({ eventos }: { eventos: EventoGovernanca[] }) {
  return <ol className="rot-governance-timeline">{eventos.map(evento => <li key={evento.id}>
    <strong>#{evento.registro_id} · {EVENTOS_GOVERNANCA[evento.tipo] ?? evento.tipo}</strong>
    <time>{new Date(evento.ocorrida_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>
    <span>{evento.depois?.titulo ?? evento.antes?.titulo ?? ''}</span>
    {evento.tipo === 'migracao' && <span>{evento.sprint_origem?.sprint_name} → {evento.sprint_destino?.sprint_name}</span>}
    {evento.tipo === 'status_alterado' && <span>{evento.antes?.status ? STATUS_REGISTRO[evento.antes.status] : '—'} → {evento.depois?.status ? STATUS_REGISTRO[evento.depois.status] : '—'}</span>}
    {evento.tipo === 'conclusao' && <span>Conclusão: {dataRegistro(evento.depois?.fechamento ?? null)}</span>}
    {evento.tipo === 'reabertura' && <span>Conclusão anterior preservada: {dataRegistro(evento.antes?.fechamento ?? null)}</span>}
    {evento.motivo && <span>{evento.motivo}</span>}
    {evento.tipo === 'descricao_alterada' && <details><summary>Consultar alteração</summary><p>Antes: {evento.antes?.descricao || '—'}</p><p>Depois: {evento.depois?.descricao || '—'}</p></details>}
  </li>)}</ol>
}

export default function GovernancaROT({ cicloId, consulta, somenteLeitura = false, compacto = false }: Props) {
  const registros = consulta.dados?.registros ?? []
  const editavel = !somenteLeitura && consulta.status === 'sucesso' && consulta.dados?.editavel === true
  const [filtros, setFiltros] = useState<FiltrosGovernanca>({ tipo: '', status: '', periodo: '', busca: '' })
  const [pagina, setPagina] = useState(1)
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [removendo, setRemovendo] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [erroEditor, setErroEditor] = useState<string | null>(null)
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const [eventos, setEventos] = useState<EventoGovernanca[]>([])
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [erroHistorico, setErroHistorico] = useState<string | null>(null)
  const dialogHistorico = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (historicoAberto && !dialogHistorico.current?.open) dialogHistorico.current?.showModal()
    if (!historicoAberto && dialogHistorico.current?.open) dialogHistorico.current.close()
  }, [historicoAberto])
  const abrirHistorico = async () => {
    setHistoricoAberto(true); setCarregandoHistorico(true); setErroHistorico(null)
    try { setEventos((await consultarHistoricoGovernanca(cicloId)).eventos) }
    catch (falha) { setErroHistorico(falha instanceof Error ? falha.message : 'Falha ao consultar histórico.') }
    finally { setCarregandoHistorico(false) }
  }
  const dialog = useRef<HTMLDialogElement>(null)
  const editorAberto = edicao !== null
  useEffect(() => {
    if (editorAberto && !dialog.current?.open) dialog.current?.showModal()
    if (!editorAberto && dialog.current?.open) dialog.current.close()
  }, [editorAberto])
  const hoje = hojeGovernanca()
  const filtrados = filtrarRegistrosGovernanca(registros, filtros, hoje)
  const tamanhoPagina = compacto ? 5 : 10
  const paginas = Math.max(1, Math.ceil(filtrados.length / tamanhoPagina))
  const atual = Math.min(pagina, paginas)
  const ids = new Set(filtrados.slice((atual - 1) * tamanhoPagina, atual * tamanhoPagina).map(item => item.id))
  const mudarFiltro = (campo: keyof FiltrosGovernanca, valor: string) => { setFiltros(anterior => ({ ...anterior, [campo]: valor })); setPagina(1) }
  const abrir = (registro?: RegistroGovernanca) => {
    setErroEditor(null)
    setEdicao(registro ? { ...registro } : { tipo: 'informativo', titulo: '', descricao: '', status: 'pendente', abertura: hoje, fechamento: null, motivo_bloqueio: '' })
  }
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!edicao || salvando) return
    setSalvando(true); setErroEditor(null)
    try {
      await salvarRegistroGovernanca(cicloId, edicao, edicao.id)
      setEdicao(null); consulta.tentarNovamente()
    } catch (falha) { setErroEditor(falha instanceof Error ? falha.message : 'Falha ao salvar registro.') }
    finally { setSalvando(false) }
  }
  const remover = async (registro: RegistroGovernanca) => {
    if (!window.confirm(`Remover o registro "${registro.titulo}"?`)) return
    setRemovendo(registro.id); setErro(null)
    try { await removerRegistroGovernanca(cicloId, registro); consulta.tentarNovamente() }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha ao remover registro.') }
    finally { setRemovendo(null) }
  }
  return <div className={`rot-governance-panel${compacto ? ' is-compact' : ''}`} data-rot-governance data-hoje={hoje} data-page={atual} data-page-size={tamanhoPagina}>
    <div className="rot-governance-heading">{!compacto && <p>{somenteLeitura ? 'Registros cadastrados no cockpit para esta sprint.' : 'Registre comunicados, pontos de atenção, melhorias e ações de QA.'}</p>}{!somenteLeitura && <div className="rot-governance-header-actions"><button type="button" data-rot-governance-edit disabled={carregandoHistorico} onClick={() => void abrirHistorico()}><History size={14} strokeWidth={1.8} />Histórico</button><button className="rot-governance-add" type="button" data-rot-governance-edit disabled={!editavel || salvando || removendo !== null} onClick={() => abrir()}><Plus size={15} strokeWidth={1.8} />Adicionar registro</button></div>}</div>
    {consulta.dados?.sprint && <p className="rot-governance-context">{consulta.dados.projeto} · {consulta.dados.time} · {consulta.dados.sprint}{!compacto && '. Continuidade pelo mesmo projeto e time/squad.'}</p>}
    {(consulta.dados?.continuidade?.ambiguo || (consulta.dados?.continuidade?.pendentes ?? 0) > 0) && <p role="alert">Continuidade não aplicada a todos os registros. Há sprints simultâneas no fluxo ou sprints fora de ordem; os registros anteriores foram preservados.</p>}
    {consulta.status === 'carregando' && <p role="status">Consultando registros…</p>}
    {consulta.status === 'erro' && <p role="alert">{consulta.erro}<button type="button" data-rot-governance-edit onClick={consulta.tentarNovamente}>Tentar novamente</button></p>}
    {!somenteLeitura && consulta.status === 'sucesso' && !editavel && <p className="rot-governance-readonly">Sprint encerrada ou bloqueada: registros disponíveis para consulta.</p>}
    {erro && <p role="alert">{erro}</p>}
    {!somenteLeitura && registros.length > 0 && <div className="rot-governance-filters">
      <label>Tipo<select aria-label="Filtrar registros por tipo" data-rot-governance-filter="tipo" value={filtros.tipo} onChange={event => mudarFiltro('tipo', event.target.value)}><option value="">Todos</option>{Object.entries(TIPOS_REGISTRO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
      <label>Status<select aria-label="Filtrar registros por status" data-rot-governance-filter="status" value={filtros.status} onChange={event => mudarFiltro('status', event.target.value)}><option value="">Todos</option>{Object.entries(STATUS_REGISTRO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
      <label>Período<select aria-label="Filtrar registros por data de abertura" data-rot-governance-filter="periodo" value={filtros.periodo} onChange={event => mudarFiltro('periodo', event.target.value)}><option value="">Todo o período</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label>
      <label className="rot-governance-search"><span>Buscar</span><span><Search size={14} strokeWidth={1.8} aria-hidden="true" /><input type="search" aria-label="Buscar registros por título ou descrição" data-rot-governance-search placeholder="Buscar por título ou descrição..." value={filtros.busca} onChange={event => mudarFiltro('busca', event.target.value)} /></span></label>
    </div>}
    {registros.length > 0 && <div className="rot-governance-table-wrap"><table className="rot-governance-table"><thead><tr><th>Tipo</th><th>Título / Descrição</th><th>Status</th><th>Sprint(s)</th><th>Abertura original</th><th>Conclusão</th>{!somenteLeitura && <th data-rot-governance-edit>Ações</th>}</tr></thead><tbody>{registros.map(registro => {
      const IconeTipo = ICONES_TIPO[registro.tipo]
      const IconeStatus = ICONES_STATUS[registro.status]
      return <tr key={registro.id} hidden={!ids.has(registro.id)} data-rot-governance-row data-tipo={registro.tipo} data-status={registro.status} data-abertura={registro.abertura} data-titulo={registro.titulo} data-descricao={registro.descricao}>
        <td><span className={`rot-governance-type is-${registro.tipo}`}><IconeTipo size={14} strokeWidth={1.8} aria-hidden="true" />{TIPOS_REGISTRO[registro.tipo]}</span></td>
        <td><strong>#{registro.id} · {registro.titulo}</strong>{registro.descricao && <p>{registro.descricao}</p>}{registro.status === 'bloqueado' && <p className="rot-governance-block-reason" title={registro.motivo_bloqueio}><LockKeyhole size={12} aria-hidden="true" />{registro.motivo_bloqueio}</p>}</td>
        <td><span className={`rot-governance-status is-${registro.status}`}><IconeStatus size={13} strokeWidth={1.8} aria-hidden="true" />{STATUS_REGISTRO[registro.status]}</span></td>
        <td><details className="rot-governance-provenance"><summary>{registro.herdado ? 'Herdado' : 'Criado nesta sprint'} · {registro.quantidade_sprints ?? 1} sprint(s)</summary>
          <p>Origem: {registro.sprint_origem?.sprint_name ?? '—'}</p><p>Atual: {registro.sprint_atual?.sprint_name ?? '—'}</p>
          <ul>{registro.sprints_acompanhadas?.map(sprint => <li key={sprint.id}>{sprint.sprint_name}</li>)}</ul>
          {registro.historico && <HistoricoRegistros eventos={registro.historico} />}
        </details></td><td>{dataRegistro(registro.abertura)}{registro.dias_em_aberto !== undefined && <small className="rot-governance-age">{registro.dias_em_aberto} dias {registro.status === 'concluido' ? 'até concluir' : 'em aberto'}</small>}</td><td>{dataRegistro(registro.fechamento)}</td>
        {!somenteLeitura && <td data-rot-governance-edit><div className="rot-governance-actions"><button type="button" aria-label={`Editar ${registro.titulo}`} title="Editar registro" disabled={!editavel || registro.editavel === false || removendo !== null} onClick={() => abrir(registro)}><Pencil size={15} strokeWidth={1.8} /></button><button type="button" aria-label={`Remover ${registro.titulo}`} title="Remover registro" disabled={!editavel || registro.editavel === false || removendo !== null} onClick={() => void remover(registro)}><Trash2 size={15} strokeWidth={1.8} /></button></div></td>}
      </tr>
    })}</tbody></table></div>}
    <p className="rot-governance-empty" data-rot-governance-empty hidden={filtrados.length > 0 || consulta.status !== 'sucesso'}>{registros.length ? 'Nenhum registro corresponde aos filtros.' : 'Nenhum registro de governança cadastrado para esta sprint.'}</p>
    {registros.length > 0 && <nav className="rot-sla-pagination rot-governance-pagination" aria-label="Paginar registros de governança"><span data-rot-governance-range>{filtrados.length ? (atual - 1) * tamanhoPagina + 1 : 0}–{Math.min(atual * tamanhoPagina, filtrados.length)} de {filtrados.length} registros</span><div hidden={paginas === 1}><button type="button" data-rot-governance-page="first" aria-label="Primeira página de registros" disabled={atual === 1} onClick={() => setPagina(1)}>«</button><button type="button" data-rot-governance-page="prev" disabled={atual === 1} onClick={() => setPagina(atual - 1)}>Anterior</button><span data-rot-governance-label>Página {atual} de {paginas}</span><button type="button" data-rot-governance-page="next" disabled={atual === paginas} onClick={() => setPagina(atual + 1)}>Próxima</button><button type="button" data-rot-governance-page="last" aria-label="Última página de registros" disabled={atual === paginas} onClick={() => setPagina(paginas)}>»</button></div></nav>}
    {!somenteLeitura && <dialog ref={dialog} className="rot-governance-dialog" data-rot-editor onCancel={event => { if (salvando) event.preventDefault(); else setEdicao(null) }} onClose={() => setEdicao(null)} aria-labelledby="rot-governance-editor-title">
      {edicao && <form onSubmit={event => void salvar(event)}>
        <header><h3 id="rot-governance-editor-title">{edicao.id ? 'Editar registro' : 'Adicionar registro'}</h3><button type="button" aria-label="Fechar formulário" disabled={salvando} onClick={() => setEdicao(null)}><X size={18} /></button></header>
        {erroEditor && <p role="alert">{erroEditor}</p>}
        <fieldset disabled={salvando}>
          <label>Tipo<select value={edicao.tipo} onChange={event => setEdicao({ ...edicao, tipo: event.target.value as TipoRegistro })}>{Object.entries(TIPOS_REGISTRO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
          <label>Status<select value={edicao.status} onChange={event => setEdicao({ ...edicao, status: event.target.value as StatusRegistro, fechamento: event.target.value === 'concluido' ? edicao.fechamento || hoje : null, motivo_bloqueio: event.target.value === 'bloqueado' ? edicao.motivo_bloqueio || '' : '' })}>{Object.entries(STATUS_REGISTRO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
          <label className="is-wide">Título<input autoFocus required maxLength={160} value={edicao.titulo} onChange={event => setEdicao({ ...edicao, titulo: event.target.value })} /></label>
          {edicao.status === 'bloqueado' && <label className="is-wide">Motivo do bloqueio<textarea required rows={2} maxLength={2000} value={edicao.motivo_bloqueio || ''} onChange={event => setEdicao({ ...edicao, motivo_bloqueio: event.target.value })} /></label>}
          <label className="is-wide">Descrição<textarea rows={4} maxLength={4000} value={edicao.descricao} onChange={event => setEdicao({ ...edicao, descricao: event.target.value })} /></label>
          <label>Abertura original<input type="date" required disabled={edicao.id !== undefined} value={edicao.abertura} onChange={event => setEdicao({ ...edicao, abertura: event.target.value })} /></label>
          <label>Data de fechamento<input type="date" min={edicao.abertura} disabled={edicao.status !== 'concluido'} required={edicao.status === 'concluido'} value={edicao.fechamento || ''} onChange={event => setEdicao({ ...edicao, fechamento: event.target.value || null })} /></label>
        </fieldset>
        <footer><button type="button" disabled={salvando} onClick={() => setEdicao(null)}>Cancelar</button><button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar registro'}</button></footer>
      </form>}
    </dialog>}
    {!somenteLeitura && <dialog ref={dialogHistorico} className="rot-governance-dialog rot-governance-audit" data-rot-editor onCancel={() => setHistoricoAberto(false)} onClose={() => setHistoricoAberto(false)} aria-labelledby="rot-governance-audit-title"><header><h3 id="rot-governance-audit-title">Histórico dos registros</h3><button type="button" aria-label="Fechar histórico" onClick={() => setHistoricoAberto(false)}><X size={18} /></button></header>
      {carregandoHistorico ? <p role="status">Consultando histórico…</p> : erroHistorico ? <p role="alert">{erroHistorico}</p> : eventos.length ? <HistoricoRegistros eventos={eventos} /> : <p>Nenhum evento registrado para esta sprint.</p>}
    </dialog>}
  </div>
}
