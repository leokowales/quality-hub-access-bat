import { useFecharMenuAoRolar } from '../services/useFecharMenuAoRolar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, MoreHorizontal, RefreshCw, Eye } from 'lucide-react'
import type { Demanda } from './NovaIteracao'
import '../styles/pages/AnaliseBugs.css'
import '../styles/patterns/QualityHubBadges.css'
import { classeTipoDemanda, classeStatusDemanda, classePrioridadeDemanda } from '../services/qualityHubBadges'
import {
    calcularSla,
    formatarTempoUtil,
    rotuloSituacaoSla,
} from '../services/calculoSla'

type Defeito = Demanda

type MenuBug = { key: string; top: number; left: number }

const normalizar = (valor?: string | null) =>
    (valor ?? '').trim().toLocaleLowerCase('pt-BR')

const ehBug = (tipo?: string | null) =>
    ['bug', 'sub-bug', 'sub bug', 'subbug'].includes(normalizar(tipo))

const ehSubBug = (tipo?: string | null) =>
    ['sub-bug', 'sub bug', 'subbug'].includes(normalizar(tipo))

const texto = (valor: unknown): string => {
    if (typeof valor === 'string') return valor.trim() || '—'
    if (typeof valor === 'number') return String(valor)

    if (valor && typeof valor === 'object') {
        const dados = valor as {
            displayName?: unknown
            name?: unknown
        }

        if (typeof dados.displayName === 'string' && dados.displayName.trim()) {
            return dados.displayName.trim()
        }

        if (typeof dados.name === 'string' && dados.name.trim()) {
            return dados.name.trim()
        }
    }

    return '—'
}

const slaPorPrioridade = (prioridade: unknown): string => {
    switch (texto(prioridade).toLowerCase()) {
        case 'very critical':
        case 'muito crítica':
        case 'altíssima':
            return '4 a 8 horas úteis'

        case 'high':
        case 'alta':
            return '2 dias úteis'

        case 'medium':
        case 'média':
        case 'media':
            return '4 dias úteis'

        case 'low':
        case 'baixa':
        case 'baixíssima':
            return '7 dias úteis'

        default:
            return '—'
    }
}

const formatarData = (valor?: string | null): string => {
    if (!valor) return '—'

    const data = new Date(valor)
    if (Number.isNaN(data.getTime())) return '—'

    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(data)
}

type AtualizacaoProps = {
    demandas: Demanda[]
    onAtualizar: (chaves: string[]) => Promise<void>
    atualizando: boolean
    bloqueado: boolean
    onFeedback: (tipo: 'sucesso' | 'erro' | null, mensagem?: string) => void
}

export default function AnaliseBugs({
    demandas,
    onAtualizar,
    atualizando,
    bloqueado,
    onFeedback,
}: AtualizacaoProps) {
    const [busca, setBusca] = useState('')
    const [tipo, setTipo] = useState('todos')
    const [status, setStatus] = useState('todos')
    const [pagina, setPagina] = useState(1)
    const [porPagina, setPorPagina] = useState(10)
    const [detalhe, setDetalhe] = useState<string | null>(null)
    const [selecionadas, setSelecionadas] = useState<string[]>([])
    const [sincronizandoLocal, setSincronizandoLocal] = useState(false)
    const [menuAberto, setMenuAberto] = useState<MenuBug | null>(null)
    useFecharMenuAoRolar(menuAberto !== null, setMenuAberto)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const botaoMenuRef = useRef<HTMLButtonElement | null>(null)

    function calcularPosicaoMenu(botao: HTMLButtonElement) {
        const rect = botao.getBoundingClientRect()
        const largura = 190
        const altura = 100
        const margem = 8
        const top = window.innerHeight - rect.bottom >= altura + margem
            ? rect.bottom + 5
            : Math.max(margem, rect.top - altura - 5)
        const left = Math.max(margem, Math.min(rect.right - largura, window.innerWidth - largura - margem))
        return { top, left }
    }

    function alternarMenu(key: string, botao: HTMLButtonElement) {
        if (menuAberto?.key === key) {
            setMenuAberto(null)
            return
        }
        botaoMenuRef.current = botao
        setMenuAberto({ key, ...calcularPosicaoMenu(botao) })
    }

    useEffect(() => {
        if (!menuAberto) return
        const fecharAoClicarFora = (evento: PointerEvent) => {
            const alvo = evento.target as Node
            if (menuRef.current?.contains(alvo) || botaoMenuRef.current?.contains(alvo)) return
            setMenuAberto(null)
        }
        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === 'Escape') setMenuAberto(null)
        }
        const atualizarPosicaoMenu = () => {
            const botao = botaoMenuRef.current
            if (!botao || !botao.isConnected) {
                setMenuAberto(null)
                return
            }
            const posicao = calcularPosicaoMenu(botao)
            setMenuAberto(atual => atual && (atual.top !== posicao.top || atual.left !== posicao.left)
                ? { ...atual, ...posicao }
                : atual)
        }
        document.addEventListener('pointerdown', fecharAoClicarFora)
        document.addEventListener('keydown', fecharComEscape)
        window.addEventListener('resize', atualizarPosicaoMenu)
        return () => {
            document.removeEventListener('pointerdown', fecharAoClicarFora)
            document.removeEventListener('keydown', fecharComEscape)
            window.removeEventListener('resize', atualizarPosicaoMenu)
        }
    }, [menuAberto])

    const dados = useMemo(() => {
        const defeitos = demandas.filter(d => ehBug(d.issue_type)) as Defeito[]

        const statuses = [...new Set(
            defeitos.map(d => d.status?.trim() || '')
        )]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))

        return {
            defeitos,
            statuses,
        }
    }, [demandas])

    const filtrados = dados.defeitos.filter(defeito => {
        const termo = normalizar(busca)
        if (termo && !normalizar(`${defeito.key} ${defeito.summary} ${defeito.parent_key ?? ''}`).includes(termo)) return false
        if (tipo === 'bug' && ehSubBug(defeito.issue_type)) return false
        if (tipo === 'subbug' && !ehSubBug(defeito.issue_type)) return false
        if (status === '__sem_status__') return !defeito.status?.trim()
        if (status !== 'todos' && defeito.status !== status) return false
        return true
    })

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina))
    const paginaAtual = Math.min(pagina, totalPaginas)
    const inicio = (paginaAtual - 1) * porPagina
    const paginados = filtrados.slice(inicio, inicio + porPagina)
    const primeiro = filtrados.length ? inicio + 1 : 0
    const ultimo = Math.min(inicio + porPagina, filtrados.length)
    const chavesPagina = paginados.map(d => d.key)
    const chavesFiltradas = filtrados.map(d => d.key)
    const paginaTodaSelecionada = chavesPagina.length > 0 && chavesPagina.every(key => selecionadas.includes(key))

    function alternarSelecao(key: string) {
        setSelecionadas(atuais => atuais.includes(key) ? atuais.filter(item => item !== key) : [...atuais, key])
    }
    function alternarPagina() {
        setSelecionadas(atuais => paginaTodaSelecionada
            ? atuais.filter(key => !chavesPagina.includes(key))
            : [...new Set([...atuais, ...chavesPagina])])
    }
    function selecionarTodasFiltradas() {
        setSelecionadas(atuais => [...new Set([...atuais, ...chavesFiltradas])])
    }

    const selecionado = dados.defeitos.find(d => d.key === detalhe)
    const slaSelecionado = selecionado
        ? calcularSla(
            selecionado.priority,
            selecionado.created,
            selecionado.resolved,
        )
        : null
    const mapa = useMemo(() => new Map(demandas.map(d => [d.key, d])), [demandas])

    const limparDetalhe = () => setDetalhe(null)

    async function sincronizarBugs(chaves: string[]) {
        if (atualizando || sincronizandoLocal || bloqueado || !chaves.length) {
            return
        }

        setSincronizandoLocal(true)
        onFeedback(null)
        setMenuAberto(null)

        try {
            await onAtualizar([...new Set(chaves)])

            setSelecionadas([])
            onFeedback('sucesso',
                `${new Set(chaves).size} defeito(s) sincronizado(s) com o Jira.`
            )
        } catch (erro) {
            onFeedback('erro',
                erro instanceof Error
                    ? erro.message
                    : 'Falha ao sincronizar bugs.'
            )
        } finally {
            setSincronizandoLocal(false)
        }
    }

    return (
        <div className="analise-bugs">
            <div className="qh-tabela-layout">
                <div className="analise-bugs-filtros qh-tabela-filtros qh-filtros">
                    <label className="analise-bugs-filtro-busca">
                        <span>Buscar defeito</span>
                        <div className="analise-bugs-campo-busca qh-campo-busca">
                            <Search size={14} />
                            <input type="search" value={busca} placeholder="Buscar por chave, resumo ou parent..."
                                onChange={e => { setBusca(e.target.value); setPagina(1); limparDetalhe() }} />
                        </div>
                    </label>
                    <label>
                        <span>Tipo</span>
                        <select value={tipo} onChange={e => { setTipo(e.target.value); setPagina(1); limparDetalhe() }}>
                            <option value="todos">Todos</option>
                            <option value="bug">Bug</option>
                            <option value="subbug">Sub-Bug</option>
                        </select>
                    </label>
                    <label>
                        <span>Status</span>
                        <select value={status} onChange={e => { setStatus(e.target.value); setPagina(1); limparDetalhe() }}>
                            <option value="todos">Todos</option>
                            {dados.statuses.map(item => <option value={item} key={item}>{item}</option>)}
                            <option value="__sem_status__">Sem status</option>
                        </select>
                    </label>
                </div>

                {bloqueado && (
                    <p role="status" style={{ margin: 0 }}>
                        Iteração consolidada: atualização desabilitada.
                    </p>
                )}

                {selecionadas.length > 0 && (
                    <div className="analise-bugs-selecao-acoes">
                        <span>{selecionadas.length} defeito(s) selecionado(s)</span>
                        <button type="button" onClick={selecionarTodasFiltradas}>
                            Selecionar todos os {filtrados.length} filtrados
                        </button>
                        <button type="button" onClick={() => setSelecionadas([])}>Limpar seleção</button>
                        <button
                            type="button"
                            disabled={atualizando || sincronizandoLocal || bloqueado}
                            onClick={() => void sincronizarBugs(selecionadas)}
                        >
                            <RefreshCw size={15} /> Atualizar selecionados
                        </button>
                    </div>
                )}

                <div className="revisao-tabela-scroll analise-bugs-tabela qh-tabela-scroll qh-tabela-scroll">
                    <table className="analise-bugs-tabela qh-tabela">
                        <thead>
                            <tr>
                                <th><input type="checkbox" aria-label="Selecionar defeitos desta página"
                                    checked={paginaTodaSelecionada} onChange={alternarPagina} /></th>
                                <th>Chave</th>
                                <th>Resumo</th>
                                <th>Tipo</th>
                                <th>Status</th>
                                <th>Prioridade</th>
                                <th>Situação do SLA</th>
                                <th>Parent</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginados.map(defeito => {
                                const sla = calcularSla(
                                    defeito.priority,
                                    defeito.created,
                                    defeito.resolved
                                )

                                return (
                                    <tr key={defeito.key}>
                                        <td><input type="checkbox" aria-label={`Selecionar ${defeito.key}`}
                                            checked={selecionadas.includes(defeito.key)}
                                            onChange={() => alternarSelecao(defeito.key)} /></td>
                                        <td>
                                            {defeito.url ? (
                                                <a
                                                    href={defeito.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="revisao-chave"
                                                >
                                                    {defeito.key}
                                                </a>
                                            ) : (
                                                defeito.key
                                            )}
                                        </td>
                                        <td className="analise-bugs-resumo">
                                            <button
                                                type="button"
                                                className="revisao-resumo"
                                                title={defeito.summary}
                                                aria-expanded={detalhe === defeito.key}
                                                onClick={() =>
                                                    setDetalhe(atual =>
                                                        atual === defeito.key ? null : defeito.key
                                                    )
                                                }
                                            >
                                                {defeito.summary}
                                            </button>
                                        </td>
                                        <td>
                                            <span className={`revisao-badge revisao-badge-tipo ${classeTipoDemanda(defeito.issue_type)}`}>
                                                {defeito.issue_type}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`revisao-badge revisao-badge-status ${classeStatusDemanda(defeito.status)}`}>
                                                {defeito.status || '—'}
                                            </span>
                                        </td>
                                        <td title={texto(defeito.priority)}>
                                            <span className={`analise-bugs-prioridade-badge ${classePrioridadeDemanda(texto(defeito.priority))}`}>
                                                {texto(defeito.priority)}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={
                                                    normalizar(defeito.status) === 'cancelado'
                                                        ? 'analise-bugs-sla analise-bugs-sla--sem_dados'
                                                        : `analise-bugs-sla analise-bugs-sla--${sla.situacao}`
                                                }
                                                title={
                                                    sla.percentual === null
                                                        ? 'Dados insuficientes para calcular o SLA'
                                                        : `${sla.percentual.toFixed(1).replace('.', ',')}% do SLA consumido${sla.encerrado ? ' · encerrado' : ' · em andamento'}`
                                                }
                                            >
                                                {rotuloSituacaoSla(
                                                    defeito.status,
                                                    sla.situacao,
                                                    sla.rotulo
                                                )}
                                            </span>
                                        </td>
                                        <td title={defeito.parent_key || ''}>{defeito.parent_key || '—'}</td>
                                        <td><button type="button" aria-label={`Ações de ${defeito.key}`}
                                            aria-expanded={menuAberto?.key === defeito.key} aria-haspopup="menu"
                                            onClick={e => alternarMenu(defeito.key, e.currentTarget)}>
                                            <MoreHorizontal size={18} />
                                        </button></td>
                                    </tr>
                                )
                            })}
                            {!filtrados.length && <tr><td className="analise-bugs-vazio" colSpan={9}>Nenhum defeito encontrado.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {menuAberto && createPortal(
                    <div ref={menuRef} className="analise-bugs-menu-acoes" role="menu"
                        style={{ position: 'fixed', top: menuAberto.top, left: menuAberto.left, zIndex: 9999 }}>
                        <button
                            type="button"
                            role="menuitem"
                            disabled={atualizando || sincronizandoLocal || bloqueado}
                            onClick={() => void sincronizarBugs([menuAberto.key])}
                        >
                            <RefreshCw size={15} /> Atualizar do Jira
                        </button>
                        <button type="button" role="menuitem" onClick={() => {
                            const key = menuAberto.key
                            setDetalhe(atual => atual === key ? null : key)
                            setMenuAberto(null)
                        }}>
                            <Eye size={15} /> {detalhe === menuAberto.key ? 'Ocultar detalhes' : 'Ver detalhes'}
                        </button>
                    </div>, document.body
                )}

                <div className="analise-bugs-rodape qh-tabela-rodape">
                    <span>Exibindo {primeiro}–{ultimo} de {filtrados.length} defeitos</span>
                    <div className="analise-bugs-paginacao qh-paginacao">
                        <label>Por página
                            <select value={porPagina} onChange={e => { setPorPagina(Number(e.target.value)); setPagina(1); limparDetalhe() }}>
                                {[10, 20, 50, 100].map(n => <option value={n} key={n}>{n}</option>)}
                            </select>
                        </label>
                        <button type="button" aria-label="Primeira página" disabled={paginaAtual === 1} onClick={() => { setPagina(1); limparDetalhe() }}>«</button>
                        <button type="button" aria-label="Página anterior" disabled={paginaAtual === 1} onClick={() => { setPagina(paginaAtual - 1); limparDetalhe() }}>‹</button>
                        <span>{paginaAtual} de {totalPaginas}</span>
                        <button type="button" aria-label="Próxima página" disabled={paginaAtual === totalPaginas} onClick={() => { setPagina(paginaAtual + 1); limparDetalhe() }}>›</button>
                        <button type="button" aria-label="Última página" disabled={paginaAtual === totalPaginas} onClick={() => { setPagina(totalPaginas); limparDetalhe() }}>»</button>
                    </div>
                </div>

            </div>

            {selecionado && (
                <section className="analise-bugs-painel">
                    <div className="analise-bugs-painel-cabecalho">
                        <div><strong>Defeito — {selecionado.key}</strong><p>{selecionado.summary}</p></div>
                        <button
                            type="button"
                            className="qh-detalhes-fechar"
                            onClick={limparDetalhe}
                        >
                            Fechar
                        </button>
                    </div>
                    <div className="analise-bugs-painel-grid">
                        <div>
                            <span>Tipo</span>
                            <span className={`analise-bugs-painel-badge ${classeTipoDemanda(selecionado.issue_type)}`}>{texto(selecionado.issue_type)}</span>
                        </div>

                        <div>
                            <span>Status</span>
                            <span className={`analise-bugs-painel-badge ${classeStatusDemanda(selecionado.status)}`}>{texto(selecionado.status)}</span>
                        </div>

                        <div>
                            <span>Prioridade</span>
                            <span className={`analise-bugs-painel-badge ${classePrioridadeDemanda(texto(selecionado.priority))}`}>{texto(selecionado.priority)}</span>
                        </div>

                        <div>
                            <span>Situação do SLA</span>
                            <strong>
                                <span
                                    className={
                                        normalizar(selecionado.status) === 'cancelado'
                                            ? 'analise-bugs-sla analise-bugs-sla--sem_dados'
                                            : `analise-bugs-sla analise-bugs-sla--${slaSelecionado?.situacao ?? 'sem_dados'}`
                                    }
                                >
                                    {rotuloSituacaoSla(
                                        selecionado.status,
                                        slaSelecionado?.situacao ?? 'sem_dados',
                                        slaSelecionado?.rotulo ?? '—'
                                    )}
                                </span>
                            </strong>
                        </div>

                        <div>
                            <span>SLA previsto</span>
                            <strong>{slaPorPrioridade(selecionado.priority)}</strong>
                        </div>

                        <div>
                            <span>Tempo decorrido</span>
                            <strong>
                                {formatarTempoUtil(
                                    slaSelecionado?.minutosConsumidos ?? null
                                )}
                            </strong>
                        </div>

                        <div>
                            <span>Responsável</span>
                            <strong>{texto(selecionado.assignee)}</strong>
                        </div>

                        <div>
                            <span>Relator</span>
                            <strong>{texto(selecionado.reporter)}</strong>
                        </div>

                        <div>
                            <span>Data de criação</span>
                            <strong>{formatarData(selecionado.created)}</strong>
                        </div>

                        <div>
                            <span>Data de resolução</span>
                            <strong>{formatarData(selecionado.resolved)}</strong>
                        </div>

                        <div>
                            <span>Parent</span>
                            <strong>{texto(selecionado.parent_key)}</strong>
                        </div>

                        <div>
                            <span>Parent na extração</span>
                            <strong>
                                {selecionado.parent_key
                                    ? mapa.has(selecionado.parent_key) ? 'Sim' : 'Não'
                                    : '—'}
                            </strong>
                        </div>
                    </div>
                    {selecionado.parent_key && mapa.has(selecionado.parent_key) && (
                        <p className="analise-bugs-parent-resumo">Parent: {mapa.get(selecionado.parent_key)?.summary}</p>
                    )}
                    {selecionado.url && <a className="analise-bugs-link" href={selecionado.url} target="_blank" rel="noopener noreferrer">Abrir defeito no Jira ↗</a>}
                </section>
            )}
        </div>
    )
}
