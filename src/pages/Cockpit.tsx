import MudancasCockpit from '../components/MudancasCockpit'
import AtencoesCockpit from '../components/AtencoesCockpit'
import EstadoConsulta from '../components/EstadoConsulta'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import type { RecursoConsultado } from '../services/consultaRecurso'
import { calcularPrazoSprint } from '../services/prazoSprint'
import { calcularSla } from '../services/calculoSla'
import { useEffect, useRef, useState } from 'react'
import { Eye, X, ArrowRight, Activity, CalendarDays, Bug, CheckCircle2, ClipboardList, BookOpenText, RefreshCw, ShieldAlert, TrendingUp, Clock3, ClipboardCheck, TrendingDown, Minus, AlertTriangle, Info } from 'lucide-react'
import { consultarEvolucaoDiariaSprint, consultarPeriodoSprint, salvarPeriodoSprint } from '../services/sprintAtivaService'
import type { MudancaHistoricaSprint, PeriodoPlanejado, AtencoesSprintAtiva, CicloSprintAtiva, EvolucaoSprint, IndicadoresSprintAtiva } from '../services/sprintAtivaService'

type Props = {
    sprint: CicloSprintAtiva
    consultaIndicadores: RecursoConsultado<IndicadoresSprintAtiva>
    consultaAtencoes: RecursoConsultado<AtencoesSprintAtiva>
    consultaEvolucao: RecursoConsultado<EvolucaoSprint>
    consultaMudancas: RecursoConsultado<{ mudancas: MudancaHistoricaSprint[] }>
    referenciaConsulta: number
    falhaRastreabilidade?: { repetir: () => void }
    carregando: boolean
    sincronizar: () => void
    abrirRot: () => void
}
const consultarPontosDiarios = async (id: string) => (await consultarEvolucaoDiariaSprint(id)).pontos
const formato = (n: number) => n.toLocaleString('pt-BR')
const porcento = (n: number, total: number) => total ? Math.min(100, Math.max(0, n / total * 100)) : 0
export default function Cockpit({ sprint, consultaIndicadores, consultaAtencoes, consultaEvolucao, consultaMudancas, referenciaConsulta, falhaRastreabilidade, carregando, sincronizar, abrirRot }: Props) {
    const d = consultaIndicadores.dados
    const consultaPeriodo = useConsultaRecurso(sprint.iteracao_id, consultarPeriodoSprint, referenciaConsulta)
    const [periodoSalvo, setPeriodoSalvo] = useState<{ iteracao: string; referencia: number; valor: PeriodoPlanejado } | null>(null)
    const periodo = periodoSalvo?.iteracao === sprint.iteracao_id && periodoSalvo.referencia === referenciaConsulta ? periodoSalvo.valor : consultaPeriodo.dados
    const [editarPeriodo, setEditarPeriodo] = useState(false)
    const periodoRef = useRef<HTMLDivElement>(null)
    const [inicioPlanejado, setInicioPlanejado] = useState('')
    const [fimPlanejado, setFimPlanejado] = useState('')
    const [erroPeriodo, setErroPeriodo] = useState('')
    const [salvandoPeriodo, setSalvandoPeriodo] = useState(false)
    useEffect(() => {
        if (!editarPeriodo) return
        const fecharFora = (evento: PointerEvent) => {
            if (periodoRef.current && !periodoRef.current.contains(evento.target as Node)) {
                setEditarPeriodo(false)
            }
        }
        const fecharEscape = (evento: KeyboardEvent) => {
            if (evento.key === 'Escape') setEditarPeriodo(false)
        }
        document.addEventListener('pointerdown', fecharFora)
        document.addEventListener('keydown', fecharEscape)
        return () => {
            document.removeEventListener('pointerdown', fecharFora)
            document.removeEventListener('keydown', fecharEscape)
        }
    }, [editarPeriodo])
    const gravarPeriodo = async () => {
        setErroPeriodo('')
        if (!inicioPlanejado || !fimPlanejado || fimPlanejado < inicioPlanejado) {
            setErroPeriodo('Informe um período válido.')
            return
        }
        setSalvandoPeriodo(true)
        try {
            const salvo = await salvarPeriodoSprint(sprint.iteracao_id, inicioPlanejado, fimPlanejado)
            setPeriodoSalvo({ iteracao: sprint.iteracao_id, referencia: referenciaConsulta, valor: salvo })
            setEditarPeriodo(false)
            if (salvo.conflitos?.length) setErroPeriodo(`Atenção: período sobreposto a ${salvo.conflitos.map(c => c.sprint_name).join(', ')}.`)
        } catch (erro) {
            setErroPeriodo(erro instanceof Error ? erro.message : 'Não foi possível salvar.')
        } finally { setSalvandoPeriodo(false) }
    }
    const consultaDiaria = useConsultaRecurso(sprint.id, consultarPontosDiarios, referenciaConsulta)
    const historicoDiario = consultaDiaria.dados ?? []
    const consultas = [
        { nome: 'Indicadores', consulta: consultaIndicadores },
        ...(!periodo ? [{ nome: 'Período', consulta: consultaPeriodo }] : []),
        { nome: 'Pontos de atenção', consulta: consultaAtencoes },
        { nome: 'Evolução da sprint', consulta: consultaEvolucao },
        { nome: 'Histórico de mudanças', consulta: consultaMudancas },
        { nome: 'Evolução diária', consulta: consultaDiaria },
        ...(falhaRastreabilidade ? [{ nome: 'Rastreabilidade', consulta: { status: 'erro', tentarNovamente: falhaRastreabilidade.repetir } }] : []),
    ]
    const falhas = consultas.filter(item => item.consulta.status === 'erro')
    const consultando = consultas.some(item => item.consulta.status === 'carregando')
    const [ancoraDiaria, setAncoraDiaria] = useState({ x: 0, y: 0 })
    const [ancoraSaude, setAncoraSaude] = useState({ x: 0, y: 0 })
    const ancoraDoAlvo = (alvo: SVGRectElement, seletor: string) => {
        const container = alvo.closest(seletor)!.getBoundingClientRect()
        const referencia = alvo.getBoundingClientRect()
        const grafico = alvo.ownerSVGElement!.getBoundingClientRect()
        return { x: referencia.left + referencia.width / 2 - container.left, y: grafico.top - container.top + grafico.height / 2 }
    }
    const [diaEmFoco, setDiaEmFoco] = useState<number | null>(null)
    const [diaSaudeEmFoco, setDiaSaudeEmFoco] = useState<number | null>(null)
    const [aba, setAba] = useState<'categorias' | 'causa' | 'prioridade' | 'status' | 'sla'>('status')
    const [foco, setFoco] = useState<'todos' | 'passed' | 'failed' | 'restantes'>('todos')
    const [visaoDashboard, setVisaoDashboard] = useState<'diaria' | 'saude' | 'comparativo'>('diaria')
    // Compara fechamentos diários distintos; nunca interpreta múltiplas sincronizações do mesmo dia como dias diferentes.
    const ultimoDia = historicoDiario.length >= 2 ? historicoDiario[historicoDiario.length - 1] : null
    const diaAnterior = historicoDiario.length >= 2 ? historicoDiario[historicoDiario.length - 2] : null
    const deltaDiario = ultimoDia && diaAnterior ? {
        aprovados: ultimoDia.aprovados - diaAnterior.aprovados,
        falhados: ultimoDia.falhados - diaAnterior.falhados,
        restantes: ultimoDia.restantes - diaAnterior.restantes,
        total: ultimoDia.total - diaAnterior.total,
    } : null
    const tendenciaDiaria = !deltaDiario ? null
        : deltaDiario.aprovados < 0 || deltaDiario.falhados > 0 ? 'Atenção'
            : deltaDiario.aprovados > 0 && deltaDiario.falhados <= 0 ? 'Avanço'
                : 'Estável'
    const tendenciaEscopo = !deltaDiario ? null
        : deltaDiario.total > 0 ? 'Aumento'
            : deltaDiario.total < 0 ? 'Redução'
                : 'Estável'
    const exibirDelta = (valor: number) => `${valor > 0 ? '+' : ''}${formato(valor)}`
    const maiorValorDiario = Math.max(0, ...historicoDiario.map(p => Math.max(p.aprovados, p.falhados, p.restantes)))
    const passoBruto = Math.max(1, maiorValorDiario / 3)
    const magnitude = 10 ** Math.floor(Math.log10(passoBruto))
    const passoNormalizado = passoBruto / magnitude
    const passoEscala = (passoNormalizado <= 1 ? 1 : passoNormalizado <= 2 ? 2 : passoNormalizado <= 5 ? 5 : 10) * magnitude
    const maximoEscala = passoEscala * 3
    const xInicio = 55
    const xFim = 865
    const total = d?.execucao.total ?? 0
    const aprovados = d?.execucao.passed ?? 0
    const falhados = d?.execucao.failed ?? 0
    const restantes = Math.max(0, total - aprovados - falhados)
    const executados = d?.execucao.concluidos ?? 0
    const pct = d?.execucao.percentual_execucao ?? porcento(executados, total)
    const distribuicao = (valores?: Record<string, number>) => Object.entries(valores ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, 6)
    const status = distribuicao(d?.defeitos.por_status)
    const slaDistribuicao = (() => {
        if (!d?.defeitos.dados_sla) return null
        const contagem: Record<string, number> = { 'Dentro do prazo': 0, 'No limite': 0, 'Estourado': 0, 'Sem dados': 0 }
        for (const bug of d.defeitos.dados_sla) {
            if ((bug.status ?? '').trim().toLocaleLowerCase('pt-BR') === 'cancelado') {
                contagem['Sem dados']++
                continue
            }
            const resultado = calcularSla(bug.prioridade, bug.criacao, bug.resolucao)
            const rotulo = resultado.situacao === 'dentro' ? 'Dentro do prazo' : resultado.situacao === 'limite' ? 'No limite' : resultado.situacao === 'estourado' ? 'Estourado' : 'Sem dados'
            contagem[rotulo]++
        }
        return distribuicao(contagem)
    })()
    const dadosQualidade = aba === 'status' ? status
        : aba === 'categorias' ? distribuicao(d?.defeitos.por_categoria)
            : aba === 'causa' ? distribuicao(d?.defeitos.por_causa_raiz)
                : aba === 'prioridade' ? distribuicao(d?.defeitos.por_prioridade)
                    : aba === 'sla' ? slaDistribuicao
                        : null
    const itens = [
        { titulo: 'Demandas', valor: d?.escopo.demandas, icone: ClipboardList, campo: 'demandas' },
        { titulo: 'Histórias', valor: d?.escopo.historias, icone: BookOpenText, campo: 'historias' },
        { titulo: 'Test Plans', valor: d?.escopo.test_plans, icone: CheckCircle2, campo: 'test_plans' },
        { titulo: 'Defeitos', valor: d?.escopo.bugs, icone: Bug, campo: 'bugs' },
    ] as const
    const { estadoPrazo, statusPrazo, textoPrazo, percentualTempo } = calcularPrazoSprint(periodo)
    const taxaAprovacao = aprovados + falhados > 0 ? aprovados / (aprovados + falhados) * 100 : null
    // Densidade: bugs identificados / cenários executados; não usar percentual de execução como denominador.
    const densidade = executados > 0 && d ? d.defeitos.originados / executados * 100 : null
    const percentualFormatado = (valor: number | null) => valor === null ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    // Faixas operacionais do QualityHub (não representam um padrão universal de mercado).
    const estadoDensidade = densidade === null ? 'indisponivel'
        : densidade <= 15 ? 'saudavel'
            : densidade <= 30 ? 'atencao' : 'critico'
    const rotuloDensidade = estadoDensidade === 'saudavel' ? 'Densidade saudável'
        : estadoDensidade === 'atencao' ? 'Atenção à densidade'
            : estadoDensidade === 'critico' ? 'Densidade crítica' : 'Densidade indisponível'
    const mensagemDensidade = estadoDensidade === 'saudavel'
        ? 'A densidade está dentro da faixa de referência adotada pelo QualityHub. Continue acompanhando a evolução e a criticidade dos defeitos.'
        : estadoDensidade === 'atencao'
            ? 'A densidade está acima da faixa de referência de 15%. Avalie a criticidade dos defeitos, possíveis concentrações por funcionalidade e a evolução nos próximos dias.'
            : estadoDensidade === 'critico'
                ? 'A densidade ultrapassou 30% e requer investigação prioritária. Analise a severidade, os agrupamentos de defeitos e os impactos sobre a execução.'
                : 'Ainda não há cenários executados suficientes para calcular a densidade de defeitos.'

    const atualizado = d?.contexto.atualizado_em ?? d?.contexto.consolidada_em
    return <div className="qh-v3">
        <header className="qh-v3-titlebar">
            <div className="qh-v3-heading">
                <div className="qh-v3-eyebrow">QUALIDADE / SPRINT ATIVA</div>
                <div className="qh-v3-heading-line">
                    <div className="qh-v3-title"><h2>{sprint.sprint_name}</h2>{d && <button type="button" className="qh-v3-rot-preview" onClick={abrirRot}><Eye size={14} strokeWidth={1.8} />Pré-visualizar ROT</button>}</div>
                </div>
                <p>{sprint.project_key} / {sprint.team_name} · Ciclo {sprint.numero_ciclo}</p>

            </div>
            <div className="qh-v3-header-actions">
                <div className={`qh-v3-prazo-grupo is-${estadoPrazo}`}>
                    <span className={`qh-v3-active qh-v3-prazo-status is-${estadoPrazo}`}>{!periodo && consultaPeriodo.status !== 'sucesso' ? consultaPeriodo.status === 'erro' ? 'Período indisponível' : 'Consultando período' : statusPrazo}</span>
                    {estadoPrazo === 'agendada' ? (
                        <span className="qh-v3-prazo-agendado">{textoPrazo}</span>
                    ) : estadoPrazo !== 'indefinido' ? (
                        <div className={`qh-v3-sprint-progress is-${estadoPrazo}`} aria-label="Progresso temporal da sprint">
                            <div className="qh-v3-progress-track" role="progressbar" aria-label="Tempo planejado transcorrido" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentualTempo}><span style={{ width: `${percentualTempo}%` }} /></div>
                            <span>{textoPrazo}</span>
                        </div>
                    ) : null}
                </div>
                <div className="qh-v3-periodo" ref={periodoRef}>
                    <button type="button" className="qh-v3-periodo-trigger" title="Consultar ou editar período da sprint" aria-label="Consultar ou editar período da sprint" disabled={!periodo && consultaPeriodo.status !== 'sucesso'} onClick={() => { setInicioPlanejado(periodo?.inicio ?? ''); setFimPlanejado(periodo?.fim ?? ''); setEditarPeriodo(v => !v); setErroPeriodo('') }} aria-expanded={editarPeriodo}>
                        <CalendarDays size={17} />
                    </button>
                    {editarPeriodo && <div className="qh-v3-periodo-editor">
                        <div className="qh-v3-periodo-editor-title"><strong>Período da sprint</strong><span>{periodo?.inicio && periodo.fim ? `${periodo.inicio.split('-').reverse().join('/')} a ${periodo.fim.split('-').reverse().join('/')}` : 'Ainda não definido'}</span></div>
                        <label>Início planejado<input type="date" value={inicioPlanejado} onChange={ev => setInicioPlanejado(ev.target.value)} /></label>
                        <label>Fim previsto<input type="date" value={fimPlanejado} onChange={ev => setFimPlanejado(ev.target.value)} /></label>
                        <button type="button" onClick={gravarPeriodo} disabled={salvandoPeriodo}>{salvandoPeriodo ? 'Salvando…' : 'Salvar período'}</button>
                        <button type="button" onClick={() => setEditarPeriodo(false)}>Cancelar</button>
                    </div>}
                </div>
                <div className="qh-v3-sync-panel">
                <div className="qh-v3-sync-info"><span className="qh-v3-sync-icon"><RefreshCw size={15} /></span><span><small>Última sincronização</small><strong>{atualizado ? new Date(atualizado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : consultaIndicadores.status !== 'sucesso' ? '—' : 'Ainda não realizada'}</strong></span></div>
                <button type="button" onClick={sincronizar} disabled={carregando}><RefreshCw size={15} className={carregando ? 'qh-v3-spin' : ''} />{carregando ? 'Sincronizando' : 'Sincronizar agora'}</button>
                </div>
            </div>
        </header>
        {erroPeriodo && <div className="qh-v3-periodo-aviso" role="status"><AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" /><span>{erroPeriodo}</span><button type="button" aria-label="Fechar aviso do período" onClick={() => setErroPeriodo('')}><X size={14} strokeWidth={1.8} aria-hidden="true" /></button></div>}

        {falhas.length > 0 ? <div className="qh-v3-query-strip" role="alert" aria-label="Consultas da sprint">
            <Info size={15} aria-hidden="true" />
            <span>Não foi possível carregar: {new Intl.ListFormat('pt-BR').format(falhas.map(item => item.nome.toLocaleLowerCase('pt-BR')))}.</span>
            <button type="button" onClick={() => falhas.forEach(item => item.consulta.tentarNovamente())}
                aria-label="Tentar novamente os dados indisponíveis">Tentar novamente</button>
        </div> : consultando ? <p className="qh-v3-note" role="status">Consultando dados da sprint…</p> : null}
        <div className="qh-v3-top">
            <div className="qh-v3-kpis">
                {itens.map(({ titulo, valor, icone: Icon, campo }) => (
                    <div className={`qh-v3-kpi${campo === 'bugs' ? ' qh-v3-kpi-defects' : ''}`} key={titulo}>
                        <div className="qh-v3-kpi-icon">
                            <Icon size={17} />
                        </div>

                        <div className="qh-v3-kpi-content">
                            <span className="qh-v3-kpi-title">{titulo}</span>

                            <div className="qh-v3-kpi-value-row">
                                <strong className="qh-v3-kpi-value">
                                    {valor === undefined ? '—' : formato(valor)}
                                </strong>

                                {diaAnterior?.escopo && ultimoDia?.escopo && (
                                    <span className={`qh-v3-kpi-delta ${ultimoDia.escopo[campo] === diaAnterior.escopo[campo] ? 'stable' : (ultimoDia.escopo[campo] > diaAnterior.escopo[campo]) !== (campo === 'bugs') ? 'up' : 'down'}`}
                                        title={`Comparação ${diaAnterior.data} → ${ultimoDia.data}: ${formato(diaAnterior.escopo[campo])} → ${formato(ultimoDia.escopo[campo])}`}>
                                        {exibirDelta(ultimoDia.escopo[campo] - diaAnterior.escopo[campo])}
                                        {ultimoDia.escopo[campo] > diaAnterior.escopo[campo] ? <TrendingUp size={11} /> : ultimoDia.escopo[campo] < diaAnterior.escopo[campo] ? <TrendingDown size={11} /> : <Minus size={11} />}
                                    </span>
                                )}
                            </div>

                            {campo === 'bugs' ? <>
                                <small className="qh-v3-kpi-description">Total da sprint</small>
                                <dl className="qh-v3-defects-breakdown" aria-label="Composição dos defeitos da sprint">
                                    {[
                                        ['Desta sprint', d?.defeitos.originados, 'Defeitos originados nesta sprint; usados no cálculo da densidade.'],
                                        ['Herdados', d?.defeitos.herdados, 'Defeitos transportados de sprints anteriores.'],
                                        ['Sem classificação', d?.defeitos.origem_indeterminada, 'Origem ainda não classificada; a decisão está disponível em Rastreabilidade.'],
                                    ].map(([nome, quantidade, descricao]) => <div key={nome} title={String(descricao)}>
                                        <dt>{nome}</dt><dd>{quantidade === undefined ? '—' : formato(Number(quantidade))}</dd>
                                    </div>)}
                                </dl>
                            </> : <small className="qh-v3-kpi-description">
                                {titulo === 'Demandas'
                                    ? 'Escopo consolidado'
                                    : 'No escopo da sprint'}
                            </small>}
                        </div>
                    </div>
                ))}
            </div>
            <div className="qh-v3-card qh-v3-execution"><div className="qh-v3-sectiontitle"><strong>Execução geral</strong><Activity size={15} /></div><div className="qh-v3-execution-body"><div className="qh-v3-ring" style={{ '--progress': `${Math.min(100, pct)}%` } as React.CSSProperties}><div><strong>{d ? `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</strong><span>{d ? `${formato(executados)} / ${formato(total)}` : '—'}</span></div></div><div className="qh-v3-legend">{[['Aprovados', aprovados, 'passed'], ['Falhados', falhados, 'failed'], ['Restantes', restantes, 'restantes']].map(([nome, valor, tipo]) => <button type="button" key={tipo} onClick={() => setFoco(foco === tipo ? 'todos' : tipo as typeof foco)} aria-pressed={foco === tipo} title={`Destacar ${nome}`} className={foco === tipo ? 'selected' : ''}><i className={`qh-v3-dot ${tipo}`} /><span>{d ? formato(Number(valor)) : '—'} {nome}</span></button>)}</div></div></div>
        </div>
        <div className="qh-v3-dashboard-tabs" role="tablist" aria-label="Visão do dashboard">
            <button type="button" role="tab" aria-selected={visaoDashboard === 'diaria'} className={visaoDashboard === 'diaria' ? 'active' : ''} onClick={() => setVisaoDashboard('diaria')}>Evolução diária</button>
            <button type="button" role="tab" aria-selected={visaoDashboard === 'saude'} className={visaoDashboard === 'saude' ? 'active' : ''} onClick={() => setVisaoDashboard('saude')}>Saúde da execução</button>
            <button type="button" role="tab" aria-selected={visaoDashboard === 'comparativo'} className={visaoDashboard === 'comparativo' ? 'active' : ''} onClick={() => setVisaoDashboard('comparativo')}>Comparativo de sprints</button>
        </div>
        {consultaDiaria.status !== 'sucesso' && visaoDashboard !== 'comparativo' ? <section className="qh-v3-card" role="tabpanel"><div className="qh-v3-sectiontitle"><strong>Evolução diária</strong></div><EstadoConsulta semAcao consulta={consultaDiaria} titulo="Evolução diária" /></section> : visaoDashboard === 'diaria' ? <div className="qh-v3-dashboard-panel" role="tabpanel">
            <section className="qh-v3-card qh-v3-daily"><div className="qh-v3-sectiontitle"><strong><TrendingUp size={16} /> Evolução diária da execução</strong><span>Histórico por dia</span></div>
                {historicoDiario.length > 0 ? <div className="qh-v3-daily-chart" style={{ position: 'relative' }}>
                    <svg viewBox="0 0 900 150" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolução diária de testes aprovados, falhados e restantes" onMouseLeave={() => setDiaEmFoco(null)}>
                        {[0, 1, 2, 3].map(i => <g key={i}>
                            <line x1={xInicio} x2={xFim} y1={12 + i * 40} y2={12 + i * 40} stroke="currentColor" strokeOpacity=".12" />
                            <text x={xInicio - 12} y={12 + i * 40} textAnchor="end" dominantBaseline="middle" fill="currentColor" opacity=".8" fontSize="10" fontFamily="inherit" fontWeight="400">{formato(maximoEscala - i * passoEscala)}</text>
                        </g>)}
                        {(['aprovados', 'falhados', 'restantes'] as const).map((chave, indice) => {
                            const pontos = historicoDiario.map((p, i) => `${historicoDiario.length === 1 ? (xInicio + xFim) / 2 : xInicio + i * (xFim - xInicio) / (historicoDiario.length - 1)},${132 - p[chave] / maximoEscala * 120}`).join(' ')
                            const cor = ['var(--qh-cockpit-success)', 'var(--qh-cockpit-warning)', 'var(--qh-cockpit-muted)'][indice]
                            return <g key={chave}><polyline points={pontos} fill="none" stroke={cor} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{historicoDiario.map((p, i) => <circle key={p.data} cx={historicoDiario.length === 1 ? (xInicio + xFim) / 2 : xInicio + i * (xFim - xInicio) / (historicoDiario.length - 1)} cy={132 - p[chave] / maximoEscala * 120} r="3" fill={cor}><title>{`${p.data}: ${p[chave]} ${chave}`}</title></circle>)}</g>
                        })}
                        {historicoDiario.flatMap((p, i) => {
                            const x = historicoDiario.length === 1 ? (xInicio + xFim) / 2 : xInicio + i * (xFim - xInicio) / (historicoDiario.length - 1)
                            return (['aprovados', 'falhados', 'restantes'] as const).map(chave => <rect key={`hover-${p.data}-${chave}`} x={x - 8} y={132 - p[chave] / maximoEscala * 120 - 8} width="16" height="16" fill="transparent" onMouseEnter={event => { setAncoraDiaria(ancoraDoAlvo(event.currentTarget, '.qh-v3-daily-chart')); setDiaEmFoco(i) }} onMouseLeave={() => setDiaEmFoco(null)} />)
                        })}
                    </svg>
                    {diaEmFoco !== null && historicoDiario[diaEmFoco] && (() => {
                        const ponto = historicoDiario[diaEmFoco]
                        return <div role="status" style={{ position: 'absolute', top: ancoraDiaria.y, left: `clamp(80px, ${ancoraDiaria.x}px, calc(100% - 80px))`, transform: 'translate(-50%, -50%)', zIndex: 5, pointerEvents: 'none', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border, var(--qh-cockpit-hover-border))', background: 'var(--surface, var(--qh-cockpit-tabs-surface))', color: 'var(--text-primary, inherit)', boxShadow: '0 8px 24px rgba(0,0,0,.18)', minWidth: 142, fontSize: 11 }}>
                            <strong style={{ display: 'block', marginBottom: 5 }}>{ponto.data.split('-').reverse().join('/')}</strong>
                            {([['Aprovados', ponto.aprovados, 'var(--qh-cockpit-success)'], ['Falhados', ponto.falhados, 'var(--qh-cockpit-warning)'], ['Restantes', ponto.restantes, 'var(--qh-cockpit-muted)']] as const).map(([nome, valor, cor]) => <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 11, marginTop: 3 }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: cor }} />{nome}</span><strong>{formato(valor)}</strong></div>)}
                        </div>
                    })()}
                    <div className="qh-v3-daily-dates" style={{ position: 'relative', display: 'block', height: 18, fontFamily: 'inherit' }}>
                        {historicoDiario.map((ponto, indice) => {
                            const x = historicoDiario.length === 1 ? (xInicio + xFim) / 2 : xInicio + indice * (xFim - xInicio) / (historicoDiario.length - 1)
                            return <span key={ponto.data} style={{ position: 'absolute', left: `${x / 900 * 100}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{ponto.data.split('-').reverse().slice(0, 2).join('/')}</span>
                        })}
                    </div>
                    <div className="qh-v3-daily-legend"><span><i className="qh-v3-dot passed" /> Aprovados</span><span><i className="qh-v3-dot failed" /> Falhados</span><span><i className="qh-v3-dot restantes" /> Restantes</span></div>

                </div> : <div className="qh-v3-empty-chart"><svg viewBox="0 0 640 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 25H640 M0 62H640 M0 99H640 M0 136H640" stroke="currentColor" strokeOpacity=".09" fill="none" /></svg><div><TrendingUp size={22} /><strong>Seu histórico começa aqui</strong><span>O gráfico será preenchido com os snapshots reais de cada dia.</span></div></div>}</section>
        </div> : visaoDashboard === 'saude' ? <div className="qh-v3-dashboard-panel" role="tabpanel">
            <section className="qh-v3-card qh-v3-health" aria-label="Saúde da execução">
                <div className="qh-v3-health-heading">
                    <div className="qh-v3-health-heading-main"><span className="qh-v3-health-heading-icon"><Activity size={17} /></span><div><strong>Saúde da execução</strong><small>Qualidade dos testes e densidade de defeitos na sprint</small></div></div>
                    <span className={`qh-v3-health-alert is-${estadoDensidade}`}>
                        {estadoDensidade === 'saudavel' ? <CheckCircle2 size={13} /> : estadoDensidade === 'atencao' ? <AlertTriangle size={13} /> : estadoDensidade === 'critico' ? <ShieldAlert size={13} /> : <Info size={13} />}
                        {rotuloDensidade}
                        <span className="qh-v3-health-alert-info" tabIndex={0} aria-label="Entenda a densidade de defeitos">
                            <Info size={13} aria-hidden="true" />
                            <div className="qh-v3-health-alert-explanation" role="note">
                                <strong>Densidade de defeitos — {estadoDensidade === 'indisponivel' ? 'sem dados' : estadoDensidade === 'saudavel' ? 'Saudável' : estadoDensidade === 'atencao' ? 'Atenção' : 'Crítico'}</strong>
                                <p>{densidade === null ? 'Não calculada' : percentualFormatado(densidade)}{densidade !== null && ` · ${formato(d?.defeitos.originados ?? 0)} defeitos / ${formato(executados)} cenários executados`}</p>
                                <p>{mensagemDensidade}</p>
                                <p><b>Como é calculada:</b> defeitos identificados ÷ cenários executados × 100.</p>
                                <p><b>Faixas do QualityHub:</b> até 15% — saudável; acima de 15% até 30% — atenção; acima de 30% — crítico.</p>
                                <p>Essas faixas são referências operacionais e não determinam, isoladamente, a qualidade do produto.</p>
                            </div>
                        </span>
                    </span>
                </div>
                <div className="qh-v3-health-grid">
                    <div className="qh-v3-health-metric"><div className="qh-v3-health-metric-head"><span className="qh-v3-health-icon is-success"><CheckCircle2 size={16} /></span><span>Taxa de aprovação</span></div><div className="qh-v3-health-metric-main"><strong>{percentualFormatado(taxaAprovacao)}</strong><span className="qh-v3-health-ring is-success" style={{ '--health-progress': `${Math.min(100, taxaAprovacao ?? 0)}%` } as React.CSSProperties} aria-hidden="true" /></div><small>{formato(aprovados)} aprovados<br />{formato(falhados)} falhados</small></div>
                    <div className="qh-v3-health-metric"><div className="qh-v3-health-metric-head"><span className="qh-v3-health-icon is-danger"><Bug size={16} /></span><span>Densidade de defeitos</span></div><div className="qh-v3-health-metric-main"><strong>{percentualFormatado(densidade)}</strong><span className="qh-v3-health-ring is-danger" style={{ '--health-progress': `${Math.min(100, densidade ?? 0)}%` } as React.CSSProperties} aria-hidden="true" /></div><small>{d ? formato(d.defeitos.originados) : '—'} defeitos / {formato(executados)} executados</small></div>
                    <div className="qh-v3-health-metric"><div className="qh-v3-health-metric-head"><span className="qh-v3-health-icon is-info"><ClipboardCheck size={16} /></span><span>Cenários executados</span></div><div className="qh-v3-health-metric-main"><strong>{d ? formato(executados) : '—'}</strong></div><small>{d ? percentualFormatado(pct) : '—'} do total</small></div>
                    <div className="qh-v3-health-metric"><div className="qh-v3-health-metric-head"><span className="qh-v3-health-icon is-warning"><ClipboardList size={16} /></span><span>Cenários criados</span></div><div className="qh-v3-health-metric-main"><strong>{d ? formato(total) : '—'}</strong></div><small>No escopo da sprint</small></div>
                </div>
                <div className="qh-v3-health-trend">
                    <div className="qh-v3-health-trend-title"><strong>Evolução da densidade de defeitos <span>(dias corridos)</span></strong><small>Densidade</small></div>
                    {historicoDiario.length > 0 ? (() => {
                        const pontos = historicoDiario.map(p => {
                            const executadosDia = p.executados ?? Math.max(0, p.total - p.restantes)
                            const originados = p.escopo?.bugs_originados
                            return { data: p.data, criados: p.total, executados: executadosDia, bugs: p.escopo?.bugs ?? 0, originados, densidade: executadosDia > 0 && originados != null ? originados / executadosDia * 100 : null }
                        })
                        const maxContagem = Math.max(1, ...pontos.map(p => Math.max(p.criados, p.executados, p.bugs)))
                        const maxY = Math.max(10, Math.ceil(maxContagem / 50) * 50)
                        const maxDensidade = Math.max(10, Math.ceil(Math.max(...pontos.map(p => p.densidade ?? 0)) / 5) * 5)
                        const x0 = 42, x1 = 680, y0 = 14, y1 = 154
                        const passo = (x1 - x0) / pontos.length
                        const escalaY = (v: number) => y1 - v / maxY * (y1 - y0)
                        const escalaD = (v: number) => y1 - v / maxDensidade * (y1 - y0)
                        const linha = pontos.map((p, i) => p.densidade === null ? null : `${x0 + passo * (i + .5)},${escalaD(p.densidade)}`).filter((v): v is string => v !== null).join(' ')
                        return <div className="qh-v3-health-chart-wrap" onMouseLeave={() => setDiaSaudeEmFoco(null)}><svg className="qh-v3-health-chart" viewBox="0 0 720 190" role="img" aria-label="Comparativo diário de cenários criados, executados, defeitos e densidade percentual">
                            {[0, 1, 2, 3, 4].map(i => { const y = y1 - i * (y1 - y0) / 4; return <g key={i}><line x1={x0} x2={x1} y1={y} y2={y} stroke="currentColor" strokeOpacity=".11" /><text x={x0 - 9} y={y + 3} textAnchor="end" fill="currentColor" opacity=".7" fontSize="10">{formato(Math.round(maxY * i / 4))}</text><text x={x1 + 9} y={y + 3} fill="currentColor" opacity=".7" fontSize="10">{Math.round(maxDensidade * i / 4)}%</text></g> })}
                            {pontos.map((p, i) => { const centro = x0 + passo * (i + .5), largura = Math.min(15, passo * .2); return <g key={p.data}>
                                <rect x={centro - largura * 1.5} y={escalaY(p.criados)} width={largura} height={y1 - escalaY(p.criados)} rx="1" className="qh-v3-health-bar-created"><title>{p.data}: {p.criados} criados</title></rect>
                                <rect x={centro - largura * .5} y={escalaY(p.executados)} width={largura} height={y1 - escalaY(p.executados)} rx="1" className="qh-v3-health-bar-executed"><title>{p.data}: {p.executados} executados</title></rect>
                                <rect x={centro + largura * .5} y={escalaY(p.bugs)} width={largura} height={y1 - escalaY(p.bugs)} rx="1" className="qh-v3-health-bar-bugs"><title>{p.data}: {p.bugs} defeitos</title></rect>
                                <text x={centro} y="174" textAnchor="middle" fill="currentColor" opacity=".8" fontSize="10">{p.data.split('-').reverse().slice(0, 2).join('/')}</text>
                            </g> })}
                            {pontos.length > 1 && <polyline points={linha} fill="none" stroke="#f5b544" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
                            {pontos.map((p, i) => p.densidade === null ? null : <g key={`density-${p.data}`}><circle cx={x0 + passo * (i + .5)} cy={escalaD(p.densidade)} r="3.5" fill="#f5b544"><title>{p.data}: {percentualFormatado(p.densidade)} de densidade</title></circle><text x={x0 + passo * (i + .5)} y={Math.max(9, escalaD(p.densidade) - 9)} textAnchor="middle" fill="currentColor" fontSize="10">{percentualFormatado(p.densidade)}</text></g>)}
                            {pontos.map((p, i) => {
                                const centro = x0 + passo * (i + .5)
                                const largura = Math.min(15, passo * .2)
                                return <g key={`health-hover-${p.data}`}>
                                    {([p.criados, p.executados, p.bugs]).map((valor, serie) => <rect key={serie} x={centro + (serie - 1.5) * largura - 3} y={escalaY(valor) - 3} width={largura + 6} height={Math.max(6, y1 - escalaY(valor) + 6)} fill="transparent" onMouseEnter={event => { setAncoraSaude(ancoraDoAlvo(event.currentTarget, '.qh-v3-health-chart-wrap')); setDiaSaudeEmFoco(i) }} onMouseLeave={() => setDiaSaudeEmFoco(null)} />)}
                                    {p.densidade !== null && <rect x={centro - 8} y={escalaD(p.densidade) - 8} width="16" height="16" fill="transparent" onMouseEnter={event => { setAncoraSaude(ancoraDoAlvo(event.currentTarget, '.qh-v3-health-chart-wrap')); setDiaSaudeEmFoco(i) }} onMouseLeave={() => setDiaSaudeEmFoco(null)} />}
                                </g>
                            })}
                        </svg>{diaSaudeEmFoco !== null && pontos[diaSaudeEmFoco] && (() => {
                            const ponto = pontos[diaSaudeEmFoco]
                            return <div className="qh-v3-health-day-tooltip" role="status" style={{ top: ancoraSaude.y, left: `clamp(90px, ${ancoraSaude.x}px, calc(100% - 90px))`, transform: 'translate(-50%, -50%)' }}>
                                <strong className="qh-v3-health-day-tooltip-date">{ponto.data.split('-').reverse().join('/')}</strong>
                                {([['Criados', formato(ponto.criados), '#64748b'], ['Executados', formato(ponto.executados), '#3b82f6'], ['Defeitos', formato(ponto.bugs), '#ef5b68'], ['Densidade', ponto.densidade === null ? 'Não calculada' : percentualFormatado(ponto.densidade), '#f5b544']] as const).map(([nome, valor, cor]) => <div className="qh-v3-health-day-tooltip-row" key={nome}><span><i style={{ background: cor }} />{nome}</span><strong>{valor}</strong></div>)}
                                <small>{ponto.densidade === null ? 'Sem execução ou defeitos disponíveis para calcular.' : `${formato(ponto.originados ?? 0)} defeitos ÷ ${formato(ponto.executados)} executados × 100`}</small>
                            </div>
                        })()}<div className="qh-v3-health-chart-legend"><span><i className="created" />Criados</span><span><i className="executed" />Executados</span><span><i className="bugs" />Defeitos</span><span><i className="density" />Densidade</span></div></div>
                    })() : <p className="qh-v3-note">A evolução ficará disponível após os registros diários.</p>}
                </div>
            </section>        </div> : <section className="qh-v3-card qh-v3-comparison" role="tabpanel">
            <div className="qh-v3-sectiontitle"><strong><TrendingUp size={16} /> Comparativo de sprints</strong></div>
            <div className="qh-v3-comparison-empty"><strong>Histórico comparativo ainda não disponível</strong><span>Para comparar sprints diferentes, precisamos consultar os fechamentos de cada iteração. Os snapshots diários da sprint atual não serão apresentados como se fossem outras sprints.</span></div>
        </section>}
        {consultaDiaria.status === 'sucesso' && (
            <section className="qh-v3-card qh-v3-evolution-strip" aria-label="Evolução em relação ao dia anterior">
                <div className="qh-v3-evolution-heading">
                    <strong>Evolução em relação ao dia anterior</strong>
                    <span>{diaAnterior && ultimoDia ? `${diaAnterior.data.split('-').reverse().slice(0, 2).join('/')} → ${ultimoDia.data.split('-').reverse().slice(0, 2).join('/')}` : 'Primeira referência'}</span>
                </div>
                <div className="qh-v3-evolution-grid">
                    {!deltaDiario ? (
                        <>
                            {([
                                ['Aprovados', aprovados],
                                ['Falhados', falhados],
                                ['Restantes', restantes],
                                ['Total de testes', total],
                            ] as const).map(([nome, valor]) => (
                                <div className="qh-v3-evolution-metric" key={nome}>
                                    <span>{nome}</span>
                                    <div className="qh-v3-evolution-value neutral">
                                        <strong>{d ? formato(valor) : '—'}</strong>
                                    </div>
                                    <small>
                                        Referência inicial
                                    </small>
                                </div>
                            ))}
                            <div className="qh-v3-evolution-metric qh-v3-evolution-diagnosis">
                                <span>Tendência da qualidade</span>
                                <div className="qh-v3-evolution-value neutral"><Clock3 size={17} /><strong>Aguardando dados</strong></div>
                                <small>Disponível após novo registro.</small>
                            </div>
                            <div className="qh-v3-evolution-metric qh-v3-evolution-diagnosis">
                                <span>Variação de escopo</span>
                                <div className="qh-v3-evolution-value neutral"><Minus size={17} /><strong>Aguardando dados</strong></div>
                                <small>Disponível após novo registro.</small>
                            </div>
                        </>
                    ) : diaAnterior && ultimoDia ? (
                        <>
                            {([
                                ['Aprovados', deltaDiario.aprovados, diaAnterior.aprovados, ultimoDia.aprovados, 'passed'],
                                ['Falhados', deltaDiario.falhados, diaAnterior.falhados, ultimoDia.falhados, 'failed'],
                                ['Restantes', deltaDiario.restantes, diaAnterior.restantes, ultimoDia.restantes, 'restantes'],
                                ['Total de testes', deltaDiario.total, diaAnterior.total, ultimoDia.total, 'total'],
                            ] as const).map(([nome, delta, anterior, atual, classe]) => {
                                const percentual = anterior === 0 ? null : delta / anterior * 100
                                const Icone = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
                                const tom = classe === 'passed' ? (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral')
                                    : classe === 'failed' ? (delta > 0 ? 'negative' : delta < 0 ? 'positive' : 'neutral')
                                        : classe === 'restantes' ? (delta < 0 ? 'positive' : delta > 0 ? 'negative' : 'neutral') : 'neutral'
                                return <div className="qh-v3-evolution-metric" key={nome}>
                                    <span>{nome}</span>
                                    <div className={`qh-v3-evolution-value ${tom}`}>
                                        <strong>{exibirDelta(delta)}</strong>
                                        <span className="qh-v3-evolution-icon"><Icone size={13} strokeWidth={2} /></span>
                                    </div>
                                    <small>De {formato(anterior)} para {formato(atual)}</small>
                                    <small className={`qh-v3-evolution-percent ${tom}`}>{percentual === null ? 'Base anterior zero' : `${delta > 0 ? '+' : ''}${percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</small>
                                </div>
                            })}
                            <div className="qh-v3-evolution-metric qh-v3-evolution-diagnosis">
                                <span>Tendência da qualidade</span>
                                <div className={`qh-v3-evolution-value ${tendenciaDiaria === 'Atenção' ? 'warning' : tendenciaDiaria === 'Avanço' ? 'positive' : 'neutral'}`}>
                                    <span className={`qh-v3-evolution-status-icon ${tendenciaDiaria === 'Atenção' ? 'is-warning' : 'is-filled'}`}>{tendenciaDiaria === 'Atenção' ? <AlertTriangle size={17} /> : tendenciaDiaria === 'Avanço' ? <TrendingUp size={17} /> : <Minus size={17} />}</span>
                                    <strong>{tendenciaDiaria}</strong>
                                </div>
                                <small>{tendenciaDiaria === 'Atenção' ? 'Houve aumento de falhas ou queda nas aprovações.' : tendenciaDiaria === 'Avanço' ? 'Mais aprovações, sem aumento de falhas.' : 'Sem avanço ou alerta identificado.'}</small>
                            </div>
                            <div className="qh-v3-evolution-metric qh-v3-evolution-diagnosis">
                                <span>Variação de escopo</span>
                                <div className={`qh-v3-evolution-value ${tendenciaEscopo === 'Aumento' ? 'positive' : tendenciaEscopo === 'Redução' ? 'negative' : 'neutral'}`}>
                                    <span className="qh-v3-evolution-status-icon is-filled">{tendenciaEscopo === 'Aumento' ? <TrendingUp size={17} /> : tendenciaEscopo === 'Redução' ? <TrendingDown size={17} /> : <Minus size={17} />}</span>
                                    <strong>{tendenciaEscopo}</strong>
                                </div>
                                <small>{tendenciaEscopo === 'Estável' ? 'O total de testes não teve alteração.' : `${exibirDelta(deltaDiario.total)} testes no escopo.`}</small>
                            </div>
                        </>
                    ) : null}
                </div>
            </section>
        )}
        <div className="qh-v3-lower">
            <section className="qh-v3-card qh-v3-quality" aria-label="Qualidade em foco">
                <div className="qh-v3-sectiontitle"><strong><ShieldAlert size={15} className="qh-v3-quality-heading-icon" />Qualidade em foco</strong></div>
                <div className="qh-v3-tabs qh-v3-quality-tabs" role="tablist" aria-label="Visões de qualidade">
                    {([['categorias', 'Categorias'], ['causa', 'Causa raiz'], ['prioridade', 'Prioridade'], ['status', 'Status'], ['sla', 'SLA']] as const).map(([id, nome]) => <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'active' : ''} onClick={() => setAba(id)}>{nome}</button>)}
                </div>
                <div className="qh-v3-quality-content" role="tabpanel">
                    {!d ? <p className="qh-v3-note">{consultaIndicadores.status === 'carregando' ? 'Carregando indicadores...' : 'Dados indisponíveis.'}</p> : dadosQualidade ? <div className="qh-v3-bars">{dadosQualidade.length ? dadosQualidade.map(([nome, n]) => <div className="qh-v3-bar-row" key={nome}><span title={nome}>{nome}</span><div><i style={{ width: `${porcento(n, Math.max(...dadosQualidade.map(([, quantidade]) => quantidade), 1))}%` }} /></div><b>{n}</b></div>) : <p className="qh-v3-note">Sem distribuição disponível.</p>}</div> : <div className="qh-v3-unavailable"><ShieldAlert size={18} /><span>Distribuição ainda não disponível nos indicadores da sprint.</span></div>}
                </div>
                <button className="qh-v3-card-footer" type="button" disabled title="Nova visualização a implementar">Ver análise completa <span className="qh-v3-coming-soon">Em breve</span><ArrowRight size={14} /></button>
            </section>
            <AtencoesCockpit indicadores={consultaIndicadores} atencoes={consultaAtencoes} />
            <MudancasCockpit consulta={consultaMudancas} />
        </div>
    </div>
}
