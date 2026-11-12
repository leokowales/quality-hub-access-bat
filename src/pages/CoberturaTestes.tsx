import { useFecharMenuAoRolar } from '../services/useFecharMenuAoRolar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Demanda } from './NovaIteracao'
import { MoreHorizontal, RefreshCw, Search, Eye } from 'lucide-react'
import '../styles/pages/CoberturaTestes.css'

type Indicadores = {
  total?: number; passed?: number; failed?: number; not_run?: number
  in_progress?: number; automated?: number; manual?: number
}
type DemandaComAssertThat = Demanda & { assertthat?: Indicadores | null }
type Linha = { historia: Demanda; planos: DemandaComAssertThat[] }
type MenuCobertura = {
  key: string
  top: number
  left: number
}

const normalizar = (valor: string) => valor.trim().toLocaleLowerCase('pt-BR')
const ehHistoria = (tipo: string) => ['história', 'historia', 'story', 'user story'].includes(normalizar(tipo))
const ehPlano = (tipo: string) => ['assertthat test plan', 'test plan', 'testplan', 'tp'].includes(normalizar(tipo))
const numero = (valor: number | undefined) => typeof valor === 'number' && Number.isFinite(valor) ? Math.max(0, valor) : 0
const percentual = (parte: number, total: number) => total > 0 ? `${(parte / total * 100).toFixed(1).replace('.', ',')}%` : '—'

type AtualizacaoProps = {
  demandas: Demanda[]
  onAtualizar: (chaves: string[]) => Promise<void>
  atualizando: boolean
  bloqueado: boolean
  onFeedback: (tipo: 'sucesso' | 'erro' | null, mensagem?: string) => void
}

export default function CoberturaTestes({
  demandas,
  onAtualizar,
  atualizando,
  bloqueado,
  onFeedback,
}: AtualizacaoProps) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [expandida, setExpandida] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(10)
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [sincronizandoLocal, setSincronizandoLocal] = useState(false)
  const [menuAberto, setMenuAberto] = useState<MenuCobertura | null>(null)
  useFecharMenuAoRolar(menuAberto !== null, setMenuAberto)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const botaoMenuRef = useRef<HTMLButtonElement | null>(null)

  function calcularPosicaoMenu(botao: HTMLButtonElement) {
    const rect = botao.getBoundingClientRect()

    const largura = 190
    const altura = 100
    const margem = 8

    const espacoAbaixo = window.innerHeight - rect.bottom

    const top =
      espacoAbaixo >= altura + margem
        ? rect.bottom + 5
        : Math.max(margem, rect.top - altura - 5)

    const left = Math.max(
      margem,
      Math.min(
        rect.right - largura,
        window.innerWidth - largura - margem
      )
    )

    return { top, left }
  }

  function alternarMenu(
    key: string,
    botao: HTMLButtonElement
  ) {
    if (menuAberto?.key === key) {
      setMenuAberto(null)
      return
    }

    botaoMenuRef.current = botao

    setMenuAberto({
      key,
      ...calcularPosicaoMenu(botao),
    })
  }

  useEffect(() => {
    if (!menuAberto) return

    function fecharAoClicarFora(evento: PointerEvent) {
      const alvo = evento.target as Node

      if (menuRef.current?.contains(alvo)) return
      if (botaoMenuRef.current?.contains(alvo)) return

      setMenuAberto(null)
    }

    function fecharComEscape(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setMenuAberto(null)
      }
    }

    function atualizarPosicaoMenu() {
      const botao = botaoMenuRef.current

      if (!botao || !botao.isConnected) {
        setMenuAberto(null)
        return
      }

      const posicao = calcularPosicaoMenu(botao)

      setMenuAberto(atual => {
        if (!atual) return null

        if (
          atual.top === posicao.top &&
          atual.left === posicao.left
        ) {
          return atual
        }

        return {
          ...atual,
          ...posicao,
        }
      })
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
    const mapa = new Map(demandas.map(d => [d.key, d as DemandaComAssertThat]))
    const historias = demandas.filter(d => ehHistoria(d.issue_type))
    const planos = demandas.filter(d => ehPlano(d.issue_type)) as DemandaComAssertThat[]
    const linhas: Linha[] = historias.map(historia => {
      const chaves = new Set(
        (historia.qa_relationships ?? [])
          .filter(r => r.relationship === 'test_plan')
          .map(r => r.key)
      )
      // O vínculo reverso também é aceito quando apenas o TP o informa.
      for (const plano of planos) {
        if ((plano.qa_relationships ?? []).some(r => r.relationship === 'tests_story' && r.key === historia.key)) {
          chaves.add(plano.key)
        }
      }
      return { historia, planos: [...chaves].map(key => mapa.get(key)).filter((d): d is DemandaComAssertThat => !!d && ehPlano(d.issue_type)) }
    })
    const comDados = planos.filter(p => p.assertthat && typeof p.assertthat.total === 'number')
    const somar = (campo: keyof Indicadores) => comDados.reduce((s, p) => s + numero(p.assertthat?.[campo]), 0)
    const total = somar('total')
    const passed = somar('passed')
    const failed = somar('failed')
    const notRun = somar('not_run')
    const inProgress = somar('in_progress')
    const executados = Math.max(0, total - notRun - inProgress)
    return {
      linhas, planos, comDados, total, passed, failed, notRun, inProgress,
      executados, automated: somar('automated'), manual: somar('manual'),
      historiasComPlano: linhas.filter(l => l.planos.length > 0).length,
      planosSemHistoria: planos.filter(p => !linhas.some(l => l.planos.some(lp => lp.key === p.key))).length,
    }
  }, [demandas])

  const linhasVisiveis = dados.linhas.filter(linha => {
    const termo = normalizar(busca)

    if (
      termo &&
      !normalizar(`${linha.historia.key} ${linha.historia.summary}`).includes(termo)
    ) return false

    if (filtro === 'sem_tp') return linha.planos.length === 0
    if (filtro === 'com_tp') return linha.planos.length > 0
    if (filtro === 'sem_dados') {
      return linha.planos.some(
        p => !p.assertthat || typeof p.assertthat.total !== 'number'
      )
    }

    return true
  })

  const totalRegistros = linhasVisiveis.length
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / porPagina))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * porPagina

  const linhasPaginadas = linhasVisiveis.slice(
    inicio,
    inicio + porPagina
  )

  const primeiroRegistro = totalRegistros === 0 ? 0 : inicio + 1
  const ultimoRegistro = Math.min(inicio + porPagina, totalRegistros)

  async function sincronizarHistorias(chaves: string[]) {
    if (atualizando || sincronizandoLocal || bloqueado) return

    const selecionadasParaAtualizar = dados.linhas.filter(
      linha => chaves.includes(linha.historia.key)
    )

    const todasChaves = [
      ...new Set(
        selecionadasParaAtualizar.flatMap(linha => [
          linha.historia.key,
          ...linha.planos.map(plano => plano.key),
        ])
      ),
    ]

    if (!todasChaves.length) return

    setSincronizandoLocal(true)
    onFeedback(null)
    setMenuAberto(null)

    try {
      await onAtualizar(todasChaves)

      setSelecionadas([])
      onFeedback('sucesso',
        `${todasChaves.length} demanda(s) sincronizada(s) com o Jira.`
      )
    } catch (erro) {
      onFeedback('erro',
        erro instanceof Error
          ? erro.message
          : 'Falha ao sincronizar cobertura.'
      )
    } finally {
      setSincronizandoLocal(false)
    }
  }

  const chavesPagina = linhasPaginadas.map(l => l.historia.key)
  const chavesFiltradas = linhasVisiveis.map(l => l.historia.key)

  const paginaTodaSelecionada =
    chavesPagina.length > 0 &&
    chavesPagina.every(key => selecionadas.includes(key))

  function alternarSelecao(key: string) {
    setSelecionadas(atuais =>
      atuais.includes(key)
        ? atuais.filter(item => item !== key)
        : [...atuais, key]
    )
  }

  function alternarPagina() {
    setSelecionadas(atuais =>
      paginaTodaSelecionada
        ? atuais.filter(key => !chavesPagina.includes(key))
        : [...new Set([...atuais, ...chavesPagina])]
    )
  }

  function selecionarTodasFiltradas() {
    setSelecionadas(atuais => [
      ...new Set([...atuais, ...chavesFiltradas]),
    ])
  }

  return (
    <div className="cobertura-testes">
      {dados.comDados.length < dados.planos.length && (
        <p className="cobertura-aviso">{dados.planos.length - dados.comDados.length} Test Plan(s) sem indicadores AssertThat. Os totais de cenários refletem apenas os planos com dados disponíveis.</p>
      )}
      <div className="qh-tabela-layout">
        <div className="cobertura-filtros qh-tabela-filtros qh-filtros">
          <label className="cobertura-filtro-busca">
            <span>Buscar história</span>
            <div className="cobertura-campo-busca qh-campo-busca">
              <Search size={14} />
              <input
                type="search"
                value={busca}
                onChange={e => {
                  setBusca(e.target.value)
                  setPagina(1)
                  setExpandida(null)
                }}
                placeholder="Buscar por chave, resumo..."
              />
            </div>
          </label>

          <label className="cobertura-filtro-situacao">
            <span>Situação da cobertura</span>
            <select
              value={filtro}
              onChange={e => {
                setFiltro(e.target.value)
                setPagina(1)
                setExpandida(null)
              }}
            >
              <option value="todos">Todas as histórias</option>
              <option value="com_tp">Com Test Plan</option>
              <option value="sem_tp">Sem Test Plan</option>
            </select>
          </label>
        </div>

        {bloqueado && (
          <p role="status" style={{ margin: 0 }}>
            Iteração consolidada: atualização desabilitada.
          </p>
        )}

        {selecionadas.length > 0 && (
          <div className="cobertura-selecao-acoes">
            <span>{selecionadas.length} história(s) selecionada(s)</span>

            <button
              type="button"
              onClick={selecionarTodasFiltradas}
            >
              Selecionar todas as {totalRegistros} filtradas
            </button>

            <button
              type="button"
              onClick={() => setSelecionadas([])}
            >
              Limpar seleção
            </button>

            <button
              type="button"
              disabled={atualizando || sincronizandoLocal || bloqueado}
              onClick={() => void sincronizarHistorias(selecionadas)}
            >
              <RefreshCw size={15} />
              Atualizar selecionadas
            </button>
          </div>
        )}

        <div className="revisao-tabela-scroll cobertura-tabela qh-tabela-scroll qh-tabela-scroll">
          <table className="cobertura-tabela qh-tabela">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Selecionar histórias desta página"
                    checked={paginaTodaSelecionada}
                    onChange={alternarPagina}
                  />
                </th>
                <th>História</th>
                <th>Resumo</th>
                <th>TPs</th>
                <th>Cenários</th>
                <th>Concluídos</th>
                <th>Execução</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {linhasPaginadas.map(linha => {
                const planosComDados = linha.planos.filter(p => p.assertthat && typeof p.assertthat.total === 'number')
                const total = planosComDados.reduce((s, p) => s + numero(p.assertthat?.total), 0)
                const concluidos = planosComDados.reduce((s, p) => s + Math.max(0, numero(p.assertthat?.total) - numero(p.assertthat?.not_run) - numero(p.assertthat?.in_progress)), 0)
                const semDados = planosComDados.length < linha.planos.length
                const situacao = !linha.planos.length ? 'Sem Test Plan' : semDados ? 'Dados incompletos' : total === 0 ? 'Sem cenários' : concluidos === total ? 'Executada' : 'Parcial'
                return (
                  <tr key={linha.historia.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${linha.historia.key}`}
                        checked={selecionadas.includes(linha.historia.key)}
                        onChange={() => alternarSelecao(linha.historia.key)}
                      />
                    </td>
                    <td>{linha.historia.url ? <a href={linha.historia.url} target="_blank" rel="noopener noreferrer">{linha.historia.key}</a> : linha.historia.key}</td>
                    <td className="cobertura-resumo">
                      <button
                        type="button"
                        className="revisao-resumo"
                        title={linha.historia.summary}
                        aria-expanded={expandida === linha.historia.key}
                        onClick={() => setExpandida(atual => atual === linha.historia.key ? null : linha.historia.key)}
                      >
                        {linha.historia.summary}
                      </button>
                    </td>
                    <td>{linha.planos.length}</td><td>{total}</td><td>{concluidos}</td>
                    <td>{semDados || !total ? '—' : percentual(concluidos, total)}</td>
                    <td>{situacao}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Ações de ${linha.historia.key}`}
                        aria-expanded={menuAberto?.key === linha.historia.key}
                        aria-haspopup="menu"
                        onClick={e =>
                          alternarMenu(linha.historia.key, e.currentTarget)
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!linhasVisiveis.length && <tr><td colSpan={9} className="cobertura-vazio">Nenhuma história encontrada.</td></tr>}
            </tbody>
          </table>
        </div>

        {menuAberto &&
          createPortal(
            <div
              ref={menuRef}
              className="cobertura-menu-acoes"
              role="menu"
              style={{
                position: 'fixed',
                top: menuAberto.top,
                left: menuAberto.left,
                right: 'auto',
                zIndex: 9999,
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={atualizando || sincronizandoLocal || bloqueado}
                onClick={() => void sincronizarHistorias([menuAberto.key])}
              >
                <RefreshCw size={15} />
                Atualizar do Jira
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={
                  !dados.linhas.some(
                    linha =>
                      linha.historia.key === menuAberto.key &&
                      linha.planos.length > 0
                  )
                }
                onClick={() => {
                  const key = menuAberto.key

                  setExpandida(atual =>
                    atual === key ? null : key
                  )

                  setMenuAberto(null)
                }}
              >
                <Eye size={15} />
                {expandida === menuAberto.key
                  ? 'Ocultar detalhes'
                  : 'Ver detalhes'}
              </button>
            </div>,
            document.body
          )}

        <div className="cobertura-rodape qh-tabela-rodape">
          <span>
            Exibindo {primeiroRegistro}–{ultimoRegistro} de {totalRegistros} histórias
          </span>

          <div className="cobertura-paginacao qh-paginacao">
            <label>
              <span className="cobertura-paginacao qh-paginacao-texto">Por página</span>
              <select
                value={porPagina}
                onChange={e => {
                  setPorPagina(Number(e.target.value))
                  setPagina(1)
                  setExpandida(null)
                }}
              >
                {[10, 20, 50, 100].map(quantidade => (
                  <option key={quantidade} value={quantidade}>
                    {quantidade}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" disabled={paginaAtual === 1}
              onClick={() => { setPagina(1); setExpandida(null) }}>
              «
            </button>

            <button type="button" disabled={paginaAtual === 1}
              onClick={() => { setPagina(paginaAtual - 1); setExpandida(null) }}>
              ‹
            </button>

            <span>{paginaAtual} de {totalPaginas}</span>

            <button type="button" disabled={paginaAtual === totalPaginas}
              onClick={() => { setPagina(paginaAtual + 1); setExpandida(null) }}>
              ›
            </button>

            <button type="button" disabled={paginaAtual === totalPaginas}
              onClick={() => { setPagina(totalPaginas); setExpandida(null) }}>
              »
            </button>
          </div>
        </div>

      </div>

      {dados.linhas
        .filter(linha => linha.historia.key === expandida)
        .map(linha => (
          <section className="cobertura-painel" key={linha.historia.key}>
            <div className="cobertura-painel-cabecalho">
              <div>
                <strong>História — {linha.historia.key}</strong>
                <p>{linha.historia.summary}</p>
              </div>

              <button
                type="button"
                className="qh-detalhes-fechar"
                onClick={() => setExpandida(null)}
              >
                Fechar
              </button>
            </div>

            <div className="cobertura-painel-lista">
              {linha.planos.map(plano => (
                <div className="cobertura-painel-item" key={plano.key}>
                  <strong>
                    {plano.url ? (
                      <a
                        href={plano.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {plano.key}
                      </a>
                    ) : plano.key}
                  </strong>

                  <span>
                    {plano.assertthat &&
                      typeof plano.assertthat.total === 'number'
                      ? `${numero(plano.assertthat.total)} cenários · ${numero(plano.assertthat.passed)} aprovados · ${numero(plano.assertthat.failed)} reprovados · ${numero(plano.assertthat.not_run)} não executados · ${numero(plano.assertthat.in_progress)} em andamento`
                      : 'Sem dados AssertThat'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}