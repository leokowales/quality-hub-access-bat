import { useEffect, useState } from 'react'
import { API_URL, apiFetch } from '../services/api'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  History,
  Plus,
  Search,
  Trash2
} from 'lucide-react'

import {
  listarIteracoesPaginadas,
  obterOpcoesFiltrosRevisao,
  obterUltimaSincronizacao,
  type IteracaoSalva,
  type PaginaIteracoes,
  type ContextoIteracao,
} from '../services/iterationService'

import RevisaoDados from './RevisaoDados'
import type { Demanda } from './NovaIteracao'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import '../styles/pages/CentralRevisao.css'
import '../styles/pages/CentralRevisaoNovaIteracao.css'

type Aba = 'pendentes' | 'historico'

function carregarOpcoesFiltrosRevisao(chaveProjeto: string) {
  return obterOpcoesFiltrosRevisao(chaveProjeto === '__todos__' ? '' : chaveProjeto)
}

const LIMITE = 10
const CHAVE_ITERACAO_ABERTA = 'quality-hub-revisao-iteracao-aberta'

function obterIteracaoSalva(): IteracaoSalva | null {
  try {
    const valor = sessionStorage.getItem(CHAVE_ITERACAO_ABERTA)
    if (!valor) return null
    const iteracao: unknown = JSON.parse(valor)
    if (iteracao && typeof iteracao === 'object' && 'id' in iteracao &&
      (typeof iteracao.id === 'number' || typeof iteracao.id === 'string')) {
      return iteracao as IteracaoSalva
    }
  } catch {
    sessionStorage.removeItem(CHAVE_ITERACAO_ABERTA)
  }
  return null
}


function formatarData(valor: string) {
  const data = new Date(valor)
  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString('pt-BR')
}

function nomeStatus(status: IteracaoSalva['status']) {
  if (status === 'pendente') return 'Pendente'
  if (status === 'em_revisao') return 'Em revisão'
  return 'Consolidada'
}

type CentralRevisaoProps = {
  onNovaIteracao: () => void
}

export default function CentralRevisao({ onNovaIteracao }: CentralRevisaoProps) {
  const [aba, setAba] = useState<Aba>('pendentes')
  const [busca, setBusca] = useState('')
  const [projeto, setProjeto] = useState('')
  const [time, setTime] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [pagina, setPagina] = useState(1)

  const consultaFiltros = useConsultaRecurso(
    projeto || '__todos__',
    carregarOpcoesFiltrosRevisao,
  )
  const projetos = consultaFiltros.dados?.projetos ?? []
  const times = consultaFiltros.dados?.times ?? []
  const carregandoFiltros = consultaFiltros.status === 'carregando'
  const erroFiltros = consultaFiltros.status === 'erro'
    ? 'Não foi possível carregar os projetos e times.'
    : ''

  const [resultado, setResultado] =
    useState<PaginaIteracoes | null>(null)

  const [selecionada, setSelecionada] =
    useState<IteracaoSalva | null>(obterIteracaoSalva)
  const [restaurandoIteracao, setRestaurandoIteracao] = useState(
    () => Boolean(obterIteracaoSalva()),
  )

  const [demandas, setDemandas] = useState<Demanda[]>([])
  const [contextoIteracao, setContextoIteracao] = useState<ContextoIteracao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState('')
  const [revisaoParaExcluir, setRevisaoParaExcluir] =
    useState<IteracaoSalva | null>(null)

  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const [versaoLista, setVersaoLista] = useState(0)


  // Ao recarregar a página, recupera os dados atuais da iteração aberta.
  useEffect(() => {
    if (!restaurandoIteracao || !selecionada) return

    let ativo = true
    obterUltimaSincronizacao(selecionada.id)
      .then(sincronizacao => {
        if (!ativo) return
        if (!Array.isArray(sincronizacao.dados.demandas)) {
          throw new Error('Dados da iteração inválidos.')
        }
        setDemandas(sincronizacao.dados.demandas)
        setContextoIteracao(sincronizacao.dados.contexto ?? null)
      })
      .catch(e => {
        if (!ativo) return
        sessionStorage.removeItem(CHAVE_ITERACAO_ABERTA)
        setSelecionada(null)
        setErro(e instanceof Error ? e.message : 'Não foi possível restaurar a revisão.')
      })
      .finally(() => {
        if (ativo) setRestaurandoIteracao(false)
      })

    return () => { ativo = false }
  }, [restaurandoIteracao, selecionada])

  // A listagem continua paginada no backend.
  useEffect(() => {
    if (selecionada || restaurandoIteracao) return

    let ativo = true

    async function carregar() {
      setCarregando(true)
      setErro('')

      try {
        const dados = await listarIteracoesPaginadas({
          status: aba,
          busca,
          projeto,
          time,
          data_inicio: dataInicio,
          data_fim: dataFim,
          pagina,
          limite: LIMITE,
        })

        if (ativo) {
          setResultado(dados)
        }
      } catch (e) {
        if (ativo) {
          setErro(
            e instanceof Error
              ? e.message
              : 'Não foi possível carregar as revisões.',
          )
          setResultado(null)
        }
      } finally {
        if (ativo) {
          setCarregando(false)
        }
      }
    }

    void carregar()

    return () => {
      ativo = false
    }
  }, [
    aba,
    busca,
    projeto,
    time,
    dataInicio,
    dataFim,
    pagina,
    selecionada,
    restaurandoIteracao,
    versaoLista,
  ])

  function mudarAba(novaAba: Aba) {
    if (novaAba === aba) return

    setAba(novaAba)
    setPagina(1)
    setBusca('')
    setProjeto('')
    setTime('')
    setDataInicio('')
    setDataFim('')
  }

  function mudarProjeto(valor: string) {
    setProjeto(valor)
    setTime('')
    setPagina(1)
  }

  async function confirmarExclusao() {
    if (!revisaoParaExcluir || excluindo) return

    setExcluindo(true)
    setErroExclusao('')

    try {
      const resposta = await apiFetch(
        `${API_URL}/iterations/${encodeURIComponent(revisaoParaExcluir.id)}`,
        { method: 'DELETE' },
      )

      if (!resposta.ok) {
        const dados = await resposta.json().catch(() => null)

        throw new Error(
          typeof dados?.detail === 'string'
            ? dados.detail
            : 'Não foi possível excluir a revisão.',
        )
      }

      setRevisaoParaExcluir(null)
      setResultado(null)

      if (resultado?.itens.length === 1 && pagina > 1) {
        setPagina(pagina - 1)
      } else {
        setVersaoLista(versao => versao + 1)
      }
    } catch (e) {
      setErroExclusao(
        e instanceof Error
          ? e.message
          : 'Erro ao excluir a revisão.',
      )
    } finally {
      setExcluindo(false)
    }
  }

  async function abrirIteracao(iteracao: IteracaoSalva) {
    if (abrindo || iteracao.status === 'pendente') return

    setAbrindo(true)
    setErro('')

    try {
      const sincronizacao =
        await obterUltimaSincronizacao(iteracao.id)

      setDemandas(sincronizacao.dados.demandas)
      setContextoIteracao(sincronizacao.dados.contexto)
      sessionStorage.setItem(CHAVE_ITERACAO_ABERTA, JSON.stringify(iteracao))
      setSelecionada(iteracao)
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : 'Não foi possível abrir a revisão.',
      )
    } finally {
      setAbrindo(false)
    }
  }

  async function recarregarDadosIteracao(): Promise<Demanda[]> {
    if (!selecionada) {
      throw new Error('Nenhuma iteração selecionada.')
    }

    const sincronizacao = await obterUltimaSincronizacao(
      selecionada.id,
    )

    const novasDemandas = sincronizacao.dados.demandas

    if (!Array.isArray(novasDemandas)) {
      throw new Error(
        'A sincronização não retornou uma lista válida de demandas.',
      )
    }

    setDemandas(novasDemandas)
    setContextoIteracao(sincronizacao.dados.contexto ?? null)
    return novasDemandas
  }

  if (selecionada && restaurandoIteracao) {
    return <p role="status">Restaurando revisão...</p>
  }

  if (selecionada) {
    return (
      <div className="central-revisao-detalhe">
        <RevisaoDados
          key={selecionada.id}
          demandas={demandas}
          iteracao={selecionada}
          contexto={contextoIteracao}
          onAtualizarDados={recarregarDadosIteracao}
          onRevisaoFinalizada={() => {
            sessionStorage.removeItem(CHAVE_ITERACAO_ABERTA)
            setSelecionada(null)
            setAba('historico')
            setPagina(1)
          }}
          onVoltar={() => {
            sessionStorage.removeItem(CHAVE_ITERACAO_ABERTA)
            setSelecionada(null)
          }}
        />
      </div>
    )
  }

  const itens = resultado?.itens ?? []
  const total = resultado?.total ?? 0
  const totalPaginas = resultado?.total_paginas ?? 1
  const primeiro = total ? (pagina - 1) * LIMITE + 1 : 0
  const ultimo = Math.min(pagina * LIMITE, total)

  return (
    <section className="central-revisao">
      <div
        className="central-revisao-abas"
        role="tablist"
        aria-label="Tipo de revisão"
      >
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'pendentes'}
          className={aba === 'pendentes' ? 'ativa' : ''}
          onClick={() => mudarAba('pendentes')}
        >
          <ClipboardList size={17} />
          Pendentes
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={aba === 'historico'}
          className={aba === 'historico' ? 'ativa' : ''}
          onClick={() => mudarAba('historico')}
        >
          <History size={17} />
          Histórico
        </button>
      </div>

      <div className="central-revisao-topo">
        <div>
          <h2>
            {aba === 'pendentes'
              ? 'Revisões em aberto'
              : 'Histórico de revisões'}
          </h2>

          <p>
            {aba === 'pendentes'
              ? 'Iterações aguardando análise ou consolidação.'
              : 'Consulte as iterações já consolidadas.'}
          </p>
        </div>

        <div className="central-revisao-acoes-topo">
          <button
            type="button"
            className="central-revisao-nova-iteracao"
            onClick={onNovaIteracao}
          >
            <Plus size={14} strokeWidth={2} />
            <span>Nova Iteração</span>
          </button>

          <span className="central-revisao-contagem">
            {total} {total === 1 ? 'registro' : 'registros'}
          </span>
        </div>
      </div>

      <div className="central-revisao-filtros">
        <label className="central-revisao-busca">
          <span>Buscar revisão</span>

          <div className="central-revisao-campo-busca">
            <Search size={17} />

            <input
              type="search"
              value={busca}
              placeholder="Projeto, time ou sprint..."
              onChange={e => {
                setBusca(e.target.value)
                setPagina(1)
              }}
            />
          </div>
        </label>

        <label>
          <span>Projeto</span>

          <select
            value={projeto}
            onChange={e => mudarProjeto(e.target.value)}
          >
            <option value="">Todos os projetos</option>

            {projetos.map(valor => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Time</span>

          <select
            value={time}
            disabled={carregandoFiltros}
            onChange={e => {
              setTime(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">
              {carregandoFiltros
                ? 'Carregando times...'
                : 'Todos os times'}
            </option>

            {times.map(valor => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Data inicial</span>

          <input
            type="date"
            value={dataInicio}
            max={dataFim || undefined}
            onChange={e => {
              setDataInicio(e.target.value)
              setPagina(1)
            }}
          />
        </label>

        <label>
          <span>Data final</span>

          <input
            type="date"
            value={dataFim}
            min={dataInicio || undefined}
            onChange={e => {
              setDataFim(e.target.value)
              setPagina(1)
            }}
          />
        </label>
      </div>

      {erroFiltros && (
        <p className="central-revisao-erro" role="alert">
          {erroFiltros}
        </p>
      )}

      {erro && (
        <p className="central-revisao-erro" role="alert">
          {erro}
        </p>
      )}

      {carregando && (
        <p
          className="central-revisao-mensagem"
          role="status"
        >
          Carregando revisões...
        </p>
      )}

      {!carregando && !erro && itens.length === 0 && (
        <div className="central-revisao-vazio">
          <ClipboardList size={28} />

          <strong>Nenhuma revisão encontrada</strong>

          <p>
            {aba === 'pendentes'
              ? 'Não há revisões em aberto para os filtros selecionados.'
              : 'Não há revisões consolidadas para os filtros selecionados.'}
          </p>
        </div>
      )}

      {!carregando && !erro && itens.length > 0 && (
        <div className="central-revisao-lista">
          {itens.map(iteracao => (
            <div
              key={iteracao.id}
              className="central-revisao-linha"
            >
              <button
                type="button"
                className="central-revisao-item"
                disabled={abrindo || iteracao.status === 'pendente'}
                onClick={() => void abrirIteracao(iteracao)}
              >
                <div className="central-revisao-item-info">
                  <strong>
                    {iteracao.project_key}
                    {' · '}
                    {iteracao.team_name}
                  </strong>

                  <span>
                    {iteracao.sprint_name || 'Seleção por quarter'}
                    {' · '}
                    {formatarData(iteracao.atualizada_em)}
                  </span>
                </div>

                <span
                  className={`central-revisao-status status-${iteracao.status}`}
                >
                  {nomeStatus(iteracao.status)}
                </span>

                {iteracao.status !== 'pendente' && (
                  <ChevronRight size={18} />
                )}
              </button>

              {aba === 'pendentes' &&
                iteracao.status !== 'consolidada' && (
                  <button
                    type="button"
                    className="central-revisao-excluir"
                    title="Excluir revisão"
                    aria-label={`Excluir revisão ${iteracao.project_key} - ${iteracao.team_name}`}
                    onClick={() => {
                      setErroExclusao('')
                      setRevisaoParaExcluir(iteracao)
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
            </div>
          ))}
        </div>
      )}

      {!carregando && !erro && total > 0 && (
        <div className="central-revisao-paginacao">
          <span>
            Exibindo {primeiro}–{ultimo} de {total}
          </span>

          <div>
            <button
              type="button"
              aria-label="Página anterior"
              disabled={pagina === 1}
              onClick={() => setPagina(p => p - 1)}
            >
              <ChevronLeft size={17} />
            </button>

            <span>
              {pagina} / {totalPaginas}
            </span>

            <button
              type="button"
              aria-label="Próxima página"
              disabled={pagina >= totalPaginas}
              onClick={() => setPagina(p => p + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      )}

      {aba === 'pendentes' && (
        <button
          type="button"
          className="central-revisao-historico-link"
          onClick={() => mudarAba('historico')}
        >
          <History size={16} />
          Ver histórico de revisões
          <ArrowRight size={15} />
        </button>
      )}

      {revisaoParaExcluir && (
        <div
          className="central-exclusao-overlay"
          role="presentation"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !excluindo) {
              setRevisaoParaExcluir(null)
            }
          }}
        >
          <div
            className="central-exclusao-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-exclusao"
            aria-describedby="descricao-exclusao"
          >
            <div className="central-exclusao-icone">
              <Trash2 size={23} />
            </div>

            <h3 id="titulo-exclusao">Excluir revisão?</h3>

            <p id="descricao-exclusao">
              Você está prestes a excluir permanentemente esta revisão
              e todos os dados associados.
            </p>

            <div className="central-exclusao-detalhes">
              <strong>
                {revisaoParaExcluir.project_key}
                {' · '}
                {revisaoParaExcluir.team_name}
              </strong>

              <span>
                {revisaoParaExcluir.sprint_name || 'Seleção por quarter'}
              </span>
            </div>

            <p className="central-exclusao-aviso">
              Esta ação não poderá ser desfeita.
            </p>

            {erroExclusao && (
              <p className="central-exclusao-erro" role="alert">
                {erroExclusao}
              </p>
            )}

            <div className="central-exclusao-acoes">
              <button
                type="button"
                className="central-exclusao-cancelar"
                disabled={excluindo}
                onClick={() => setRevisaoParaExcluir(null)}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="central-exclusao-confirmar"
                disabled={excluindo}
                onClick={() => void confirmarExclusao()}
              >
                <Trash2 size={16} />
                {excluindo ? 'Excluindo...' : 'Excluir revisão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
