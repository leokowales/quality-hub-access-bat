import { useFecharMenuAoRolar } from '../services/useFecharMenuAoRolar'
import { useConsultaRecurso } from '../services/useConsultaRecurso'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  House,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  ShieldCheck,
  CheckCircle2,
  MoreHorizontal,
  Check,
  AlertTriangle,
  X,
  ChartNoAxesColumn,
  Info,
  CircleX,
  RefreshCw,
  Clock3,
  Eye,
  LoaderCircle,
} from 'lucide-react'
import type { Demanda } from './NovaIteracao'
import CoberturaTestes from './CoberturaTestes'
import AnaliseBugs from './AnaliseBugs'
import { obterAlertasGovernanca, formatarValorJira, NOMES_CAMPOS_JIRA, ALERTAS_INTERVENCAO as alertasRevisao } from '../services/alertasGovernanca'
import type { DemandaGovernanca } from '../services/alertasGovernanca'
import '../styles/pages/NovaIteracao.css'
import '../styles/pages/RevisaoDados.css'
import '../styles/patterns/QualityHubNavigation.css'
import '../styles/patterns/QualityHubFilters.css'
import '../styles/patterns/QualityHubBadges.css'
import { classeTipoDemanda, classeStatusDemanda, classePrioridadeDemanda } from '../services/qualityHubBadges'
import {
  calcularSla,
  rotuloSituacaoSla,
} from '../services/calculoSla'
import {
  listarDecisoesRevisao,
  salvarDecisaoRevisao,
  atualizarTodasDemandas,
  atualizarDemandasPendentes,
  obterPreviaFinalizacao,
  finalizarRevisao,
} from '../services/iterationService'
import type {
  ContextoIteracao,
  IteracaoSalva,
  DecisaoRevisao,
  RegistroDecisaoRevisao,
  PreviaFinalizacao,
} from '../services/iterationService'


type CampoJiraVisualProps = {
  rotulo: string
  valor: unknown
  slaCalculado?: boolean
}

function CampoJiraVisual({ rotulo, valor, slaCalculado = false, }: CampoJiraVisualProps) {
  const texto = formatarValorJira(valor)
  const naoInformado =
    !texto.trim() ||
    ['Não informado', 'Não informada', 'N/A', '—', '-'].includes(texto.trim())

  const ehSla = rotulo.toLowerCase() === 'sla'
  const slaNormalizado = texto.trim().toLocaleLowerCase('pt-BR')

  const slaDentro = ehSla && (
    slaNormalizado === 'dentro' ||
    slaNormalizado === 'dentro do prazo' ||
    slaNormalizado === 'concluído dentro do prazo'
  )

  const slaFora = ehSla && (
    [
      'fora',
      'violado',
      'estourado',
      'concluído fora do prazo',
    ].includes(slaNormalizado)
  )

  return (
    <div className="revisao-jira-campo">
      <span className="revisao-jira-campo-rotulo">{rotulo}</span>
      {ehSla && !naoInformado ? (
        <strong
          title={
            slaCalculado
              ? 'SLA calculado pelo QualityHub com base nas regras de dias e horas úteis.'
              : 'SLA informado pelo Jira.'
          }
          className={`revisao-jira-sla ${slaDentro
            ? 'revisao-jira-sla-dentro'
            : slaFora
              ? 'revisao-jira-sla-fora'
              : 'revisao-jira-sla-neutro'
            }`}
        >
          {texto}
        </strong>
      ) : (
        <strong className={naoInformado ? 'revisao-jira-valor-ausente' : ''}>
          {texto}
        </strong>
      )}
    </div>
  )
}


function CampoSprintsCompacto({ sprints }: { sprints?: DemandaTabela['sprints'] }) {
  const nomes = (sprints ?? [])
    .map(sprint => sprint.name || String(sprint.id))
    .filter(Boolean)

  return (
    <div className="revisao-jira-campo revisao-jira-sprints-campo">
      <span className="revisao-jira-campo-rotulo">Sprint</span>
      {nomes.length === 0 ? (
        <strong className="revisao-jira-valor-ausente">Não informado</strong>
      ) : (
        <div className="revisao-jira-sprints-linha">
          <strong className="revisao-jira-sprint-principal">{nomes[0]}</strong>
          {nomes.length > 1 && (
            <span className="revisao-jira-sprints-mais">
              <button
                type="button"
                className="revisao-jira-sprints-gatilho"
                aria-label={`Mostrar mais ${nomes.length - 1} sprints`}
                aria-describedby="revisao-jira-sprints-ajuda"
              >
                <ChevronRight size={13} aria-hidden="true" />
                +{nomes.length - 1}
              </button>
              <span className="revisao-jira-sprints-tooltip" role="tooltip" id="revisao-jira-sprints-ajuda">
                <span className="revisao-jira-sprints-tooltip-titulo">Outras sprints</span>
                {nomes.slice(1).map((nome, indice) => (
                  <span key={`${indice}-${nome}`} className="revisao-jira-sprints-tooltip-item">{nome}</span>
                ))}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}


function obterSlaRevisao(
  demanda: Demanda,
  valorJira: unknown,
): string {
  const tipo = (demanda.issue_type ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')

  const ehBugOuSubBug = [
    'bug',
    'sub-bug',
    'sub bug',
    'subbug',
  ].includes(tipo)

  // Outros tipos: preservar o valor original do Jira.
  if (!ehBugOuSubBug) {
    return formatarValorJira(valorJira)
  }

  // Bugs cancelados não recebem classificação de SLA.
  if (
    (demanda.status ?? '')
      .trim()
      .toLocaleLowerCase('pt-BR') === 'cancelado'
  ) {
    return 'Não informado'
  }

  // Mesmo cálculo utilizado pela Análise de Bugs.
  const resultado = calcularSla(
    demanda.priority,
    demanda.created,
    demanda.resolved,
  )

  if (resultado.situacao === 'sem_dados') {
    return 'Não informado'
  }

  const rotulo = rotuloSituacaoSla(
    demanda.status,
    resultado.situacao,
    resultado.rotulo,
  )

  return rotulo === '—' ? 'Não informado' : rotulo
}



type RevisaoDadosProps = {
  demandas: Demanda[]
  iteracao: IteracaoSalva
  contexto: ContextoIteracao | null
  onAtualizarDados: () => Promise<Demanda[]>
  onRevisaoFinalizada: () => void
  onVoltar: () => void
}

function nomeEscopo(scope: Demanda['scope']) {
  if (scope === 'direct') return 'Direta'
  if (scope === 'manual_lookup') return 'Manual'
  return 'Rastreabilidade'
}

type DemandaDetalhada = Demanda & DemandaGovernanca

type DemandaTabela = Demanda & {
  quarters?: string[]
  sprints?: {
    id: string | number
    name?: string
  }[]
}

function formatarQuarter(quarter: string) {
  return quarter.includes(':')
    ? quarter.split(':').slice(1).join(':')
    : quarter
}

function formatarPeriodo(data?: string | null) {
  if (!data) return 'Não informado'

  const partes = data.slice(0, 10).split('-')

  if (partes.length !== 3) return data

  return `${partes[2]}/${partes[1]}/${partes[0]}`
}

function formatarDataJira(valor?: string | null) {
  if (!valor) return 'Não informado'
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!partes) return valor
  const [, ano, mes, dia, hora, minuto] = partes
  return `${dia}/${mes}/${ano}${hora && minuto ? ` às ${hora}:${minuto}` : ''}`
}

function obterSelecao(
  valores?: string[],
  json?: string | null
): string[] {
  if (valores?.length) return valores

  if (!json) return []

  try {
    const dados: unknown = JSON.parse(json)

    return Array.isArray(dados)
      ? dados.filter(
        (valor): valor is string =>
          typeof valor === 'string'
      )
      : []
  } catch {
    return []
  }
}

function RevisaoDados({
  demandas,
  iteracao,
  contexto,
  onAtualizarDados,
  onRevisaoFinalizada,
  onVoltar,
}: RevisaoDadosProps) {
  const [abaValidacao, setAbaValidacao] = useState<'demandas' | 'cobertura' | 'bugs'>('demandas')
  const [feedbackAba, setFeedbackAba] = useState<{ aba: 'cobertura' | 'bugs'; tipo: 'sucesso' | 'erro'; mensagem: string } | null>(null)

  useEffect(() => {
    if (!feedbackAba) return
    const temporizador = window.setTimeout(() => setFeedbackAba(null), 5000)
    return () => window.clearTimeout(temporizador)
  }, [feedbackAba])
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos')
  const [status, setStatus] = useState('todos')
  const [somenteAlertas, setSomenteAlertas] = useState(false)
  const [mostrarTodasCategorias, setMostrarTodasCategorias] = useState(false)
  const [categoriaAlerta, setCategoriaAlerta] = useState<string | null>(null)
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [menuAberto, setMenuAberto] = useState<string | null>(null)
  useFecharMenuAoRolar(menuAberto !== null, setMenuAberto)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [posicaoMenu, setPosicaoMenu] = useState({
    top: 0,
    left: 0,
  })
  const [tooltipAlerta, setTooltipAlerta] = useState<{
    key: string
    top: number
    left: number
  } | null>(null)

  const [filtroDecisao, setFiltroDecisao] = useState('todos')
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina, setItensPorPagina] = useState(10)

  const [mostrarDetalhesIteracao, setMostrarDetalhesIteracao] = useState(false)
  const [mostrarIndicadoresCobertura, setMostrarIndicadoresCobertura] = useState(false)
  const [mostrarDistribuicaoBugs, setMostrarDistribuicaoBugs] = useState(false)

  const [decisoesAtualizadas, setDecisoesAtualizadas] = useState<
    Record<string, RegistroDecisaoRevisao> | null
  >(null)
  const consultaDecisoes = useConsultaRecurso(iteracao.id, listarDecisoesRevisao)
  const decisoes = decisoesAtualizadas ?? Object.fromEntries(
    (consultaDecisoes.dados ?? []).map(registro => [registro.issue_key, registro]),
  )
  const carregandoDecisoes = consultaDecisoes.status === 'carregando'
  const [salvandoDecisao, setSalvandoDecisao] = useState(false)
  const [erroRevisaoManual, setErroRevisaoManual] = useState<string | null>(null)
  const erroRevisao = erroRevisaoManual ?? (
    consultaDecisoes.status === 'erro'
      ? consultaDecisoes.erro ?? 'Não foi possível carregar as decisões.'
      : null
  )
  const [sucessoRevisao, setSucessoRevisao] = useState<string | null>(null)

  const [atualizando, setAtualizando] = useState<
    'all' | 'pending' | null
  >(null)

  const [erroAtualizacao, setErroAtualizacao] =
    useState<string | null>(null)

  const [sucessoAtualizacao, setSucessoAtualizacao] =
    useState<string | null>(null)

  // Destaques restritos à sessão atual de revisão.
  const [novasNaoReconhecidas, setNovasNaoReconhecidas] = useState<string[]>([])
  const [novasUltimaAtualizacao, setNovasUltimaAtualizacao] = useState<string[]>([])

  function marcarDemandasAtualizadas(chavesAntes: Set<string>, novasDemandas: Demanda[]) {
    const novas = [...new Set(novasDemandas.map(demanda => demanda.key))]
      .filter(chave => !chavesAntes.has(chave))
    setNovasUltimaAtualizacao(novas)
    setNovasNaoReconhecidas(anteriores => [...new Set([...anteriores, ...novas])])
    if (novas.length) setPaginaAtual(1)
  }

  function reconhecerDemandas(chaves: string[]) {
    setNovasNaoReconhecidas(anteriores =>
      anteriores.filter(chave => !chaves.includes(chave))
    )
  }

  function abrirDemanda(chave: string) {
    if (selecionada && selecionada !== chave) {
      reconhecerDemandas([selecionada])
    }

    setSelecionada(chave)
  }

  function fecharDemanda() {
    if (selecionada) {
      reconhecerDemandas([selecionada])
    }

    setSelecionada(null)
  }

  function alterarAbaValidacao(aba: 'demandas' | 'cobertura' | 'bugs') {
    if (aba !== abaValidacao) {
      if (abaValidacao === 'demandas') {
        fecharDemanda()
      }

      setAbaValidacao(aba)
    }
  }

  const [, setRevalidacaoPendente] = useState(false)

  const [previaFinalizacao, setPreviaFinalizacao] =
    useState<PreviaFinalizacao | null>(null)

  const [consultandoFinalizacao, setConsultandoFinalizacao] =
    useState(false)

  const [finalizandoRevisao, setFinalizandoRevisao] =
    useState(false)

  const [confirmacaoRessalvas, setConfirmacaoRessalvas] =
    useState(false)

  const [erroFinalizacao, setErroFinalizacao] =
    useState<string | null>(null)

  useEffect(() => {
    if (!sucessoRevisao) return

    const temporizador = window.setTimeout(() => {
      setSucessoRevisao(null)
    }, 10000)

    return () => window.clearTimeout(temporizador)
  }, [sucessoRevisao])

  useEffect(() => {
    if (!sucessoAtualizacao) return

    const temporizador = window.setTimeout(() => {
      setSucessoAtualizacao(null)
      setNovasUltimaAtualizacao([])
    }, 5000)

    return () => window.clearTimeout(temporizador)
  }, [sucessoAtualizacao])

  useEffect(() => {
    if (novasUltimaAtualizacao.length === 0) return

    const temporizador = window.setTimeout(() => {
      setNovasUltimaAtualizacao([])
    }, 5000)

    return () => window.clearTimeout(temporizador)
  }, [novasUltimaAtualizacao])

  useEffect(() => {
    if (!menuAberto) return

    function fecharMenuAoClicarFora(event: PointerEvent) {
      const alvo = event.target

      if (!(alvo instanceof Node)) return

      if (menuRef.current?.contains(alvo)) return

      if (
        alvo instanceof Element &&
        alvo.closest('.revisao-menu-botao')
      ) return

      setMenuAberto(null)
    }

    function fecharMenuComEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuAberto(null)
      }
    }

    document.addEventListener('pointerdown', fecharMenuAoClicarFora)
    document.addEventListener('keydown', fecharMenuComEscape)

    return () => {
      document.removeEventListener('pointerdown', fecharMenuAoClicarFora)
      document.removeEventListener('keydown', fecharMenuComEscape)
    }
  }, [menuAberto])

  const quarters = obterSelecao(contexto?.quarters, iteracao.quarters_json)

  const sprints = obterSelecao(contexto?.sprints, iteracao.sprints_json)

  const dataInicial = contexto?.data_inicio || iteracao.data_inicio

  const dataFinal = contexto?.data_fim || iteracao.data_fim

  const mapaDemandas = useMemo(
    () => new Map(demandas.map(demanda => [demanda.key, demanda])), [demandas])

  const tipos = useMemo(
    () => [...new Set(demandas.map(d => d.issue_type))].sort(), [demandas])

  const statusDisponiveis = useMemo(
    () => [...new Set(demandas.map(d => d.status ?? ''))].filter(Boolean).sort(), [demandas])

  const alertas = useMemo(
    () => new Map(demandas.map(demanda => [
      demanda.key,
      obterAlertasGovernanca(demanda as DemandaDetalhada),
    ])),
    [demandas]
  )

  const totalAlertas = demandas.filter(
    demanda => (alertas.get(demanda.key)?.length ?? 0) > 0
  ).length

  const resumoCategorias = useMemo(() => {
    const categorias = new Map<string, { id: string; titulo: string; cor: string; quantidade: number; ocorrencias: number }>()
    for (const demanda of demandas) {
      for (const alerta of alertas.get(demanda.key) ?? []) {
        const atual = categorias.get(alerta.id)
        if (atual) {
          atual.quantidade++
          atual.ocorrencias++
        } else {
          categorias.set(alerta.id, {
            id: alerta.id,
            titulo: alerta.titulo,
            cor: [
              'qa:historia_sem_tp',
              'jira:root_cause',
            ].includes(alerta.id)
              ? 'vermelho'
              : [
                'jira:developer',
                'jira:mapping_status',
                'jira:test_case_mapping_owner',
                'backend:sem_vinculo_com_escopo',
                'backend:periodo_explicito_fora_do_escopo',
                'jira:zero_cenarios',
                'qa:tp_sem_historia',
              ].includes(alerta.id)
                ? 'amarelo'
                : 'azul',
            quantidade: 1,
            ocorrencias: 1,
          })
        }
      }
    }
    const prioridade = { vermelho: 0, amarelo: 1, azul: 2 }

    return [...categorias.values()].sort(
      (a, b) =>
        (prioridade[a.cor as keyof typeof prioridade] ?? 3) -
        (prioridade[b.cor as keyof typeof prioridade] ?? 3) ||
        b.quantidade - a.quantidade ||
        a.titulo.localeCompare(b.titulo)
    )
  }, [demandas, alertas])

  const obterDecisao = (demanda: Demanda): DecisaoRevisao => {
    const salva = decisoes[demanda.key]?.decisao
    if (salva) return salva
    return (demanda as DemandaDetalhada).review?.automatic_decision ?? 'pending'
  }

  const chavesPendentes = demandas
    .filter(demanda => obterDecisao(demanda) === 'pending')
    .map(demanda => demanda.key)

  const filtradas = demandas.filter(demanda => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')

    if (tipo !== 'todos' && demanda.issue_type !== tipo) {
      return false
    }

    if (status === 'sem_status') {
      if (demanda.status) return false
    } else if (status !== 'todos' && demanda.status !== status) {
      return false
    }

    if (
      filtroDecisao !== 'todos' &&
      obterDecisao(demanda) !== filtroDecisao
    ) return false

    if (
      somenteAlertas &&
      !(alertas.get(demanda.key)?.length ?? 0)
    ) return false

    if (
      categoriaAlerta &&
      !(alertas.get(demanda.key) ?? []).some(
        alerta => alerta.id === categoriaAlerta
      )
    ) return false

    return (
      !termo ||
      demanda.key.toLocaleLowerCase('pt-BR').includes(termo) ||
      demanda.summary.toLocaleLowerCase('pt-BR').includes(termo)
    )
  })

  const demandasOrdenadas = [...filtradas].sort((a, b) => {
    const aNova = novasNaoReconhecidas.includes(a.key)
    const bNova = novasNaoReconhecidas.includes(b.key)
    if (aNova !== bNova) return aNova ? -1 : 1

    function prioridade(demanda: Demanda) {
      const decisao = obterDecisao(demanda)

      if (decisao === 'pending') return 0

      if (decisao === 'include') {
        const origemManual = decisoes[demanda.key] !== undefined

        return origemManual ? 2 : 1
      }

      return 3
    }

    const diferencaPrioridade = prioridade(a) - prioridade(b)

    if (diferencaPrioridade !== 0) {
      return diferencaPrioridade
    }

    const alertasA = alertas.get(a.key)?.length ?? 0
    const alertasB = alertas.get(b.key)?.length ?? 0

    if (alertasA !== alertasB) {
      return alertasB - alertasA
    }

    return a.key.localeCompare(b.key, 'pt-BR', {
      numeric: true,
    })
  })

  const totalPaginas = Math.max(
    1,
    Math.ceil(filtradas.length / itensPorPagina)
  )

  const paginaVisivel = Math.min(paginaAtual, totalPaginas)

  const demandasPaginadas = demandasOrdenadas.slice(
    (paginaVisivel - 1) * itensPorPagina,
    paginaVisivel * itensPorPagina
  )

  const inicioExibicao = filtradas.length === 0
    ? 0
    : (paginaVisivel - 1) * itensPorPagina + 1

  const fimExibicao = Math.min(
    paginaVisivel * itensPorPagina,
    filtradas.length
  )

  const chavesFiltradas = demandasPaginadas.map(demanda => demanda.key)

  const todasSelecionadas =
    chavesFiltradas.length > 0 &&
    chavesFiltradas.every(key => selecionadas.includes(key))

  function alternarTodas() {
    setSelecionadas(anteriores =>
      todasSelecionadas
        ? anteriores.filter(key => !chavesFiltradas.includes(key))
        : [...new Set([...anteriores, ...chavesFiltradas])]
    )
  }

  async function executarAtualizacao(
    modalidade: 'all' | 'pending',
  ) {
    if (
      atualizando ||
      carregandoDecisoes ||
      salvandoDecisao ||
      iteracao.status === 'consolidada'
    ) return

    if (modalidade === 'pending' && !chavesPendentes.length) {
      setErroAtualizacao('Não existem demandas pendentes.')
      return
    }

    setNovasNaoReconhecidas([])
    setAtualizando(modalidade)
    setErroAtualizacao(null)
    setSucessoAtualizacao(null)
    setNovasUltimaAtualizacao([])
    setMenuAberto(null)
    setTooltipAlerta(null)

    let sincronizacaoSalva = false

    try {
      const resultado = modalidade === 'all'
        ? await atualizarTodasDemandas(iteracao.id)
        : await atualizarDemandasPendentes(
          iteracao.id,
          chavesPendentes,
        )

      sincronizacaoSalva = true

      // Compara o snapshot anterior com o resultado recarregado, sem consultar
      // nem modificar dados de nenhuma sprint no Jira.
      const chavesAntes = modalidade === 'all'
        ? new Set(demandas.map(demanda => demanda.key))
        : null
      const novasDemandas = await onAtualizarDados()
      if (chavesAntes) {
        marcarDemandasAtualizadas(chavesAntes, novasDemandas)
      }

      const registros = await listarDecisoesRevisao(iteracao.id)

      setDecisoesAtualizadas(
        Object.fromEntries(
          registros.map(registro => [
            registro.issue_key,
            registro,
          ]),
        ),
      )

      setSelecionadas([])
      setSelecionada(null)

      const exigeRevalidacao =
        resultado.revalidacao_governanca_pendente === true

      setRevalidacaoPendente(exigeRevalidacao)

      if (modalidade === 'all') {
        setSucessoAtualizacao(
          `Atualização completa concluída. ` +
          `Versão ${resultado.versao} registrada. ` +
          `${resultado.total_demandas ?? 0} demandas no snapshot.`,
        )
      } else {
        setSucessoAtualizacao(
          `${resultado.total_atualizadas ?? 0} demanda(s) ` +
          `atualizada(s). Versão ${resultado.versao} registrada. ` +
          `Alertas recalculados na interface; ` +
          `rastreabilidade de QA ainda requer revalidação.`,
        )
      }
    } catch (erro) {
      const mensagem = erro instanceof Error
        ? erro.message
        : 'Não foi possível concluir a atualização.'

      setErroAtualizacao(
        sincronizacaoSalva
          ? `A sincronização foi salva no backend, mas houve ` +
          `falha ao recarregar a revisão: ${mensagem}`
          : mensagem,
      )
    } finally {
      setAtualizando(null)
    }
  }

  async function atualizarChavesDaAba(chaves: string[]): Promise<void> {
    if (atualizando || carregandoDecisoes || salvandoDecisao) {
      throw new Error('Aguarde a operação atual terminar.')
    }

    if (iteracao.status === 'consolidada') {
      throw new Error('Não é possível atualizar uma iteração consolidada.')
    }

    const unicas = [...new Set(chaves.filter(Boolean))]

    if (!unicas.length) {
      throw new Error('Nenhuma demanda selecionada para atualização.')
    }

    setAtualizando('pending')
    setErroAtualizacao(null)
    setSucessoAtualizacao(null)

    let sincronizacaoSalva = false

    try {
      const resultado = await atualizarDemandasPendentes(iteracao.id, unicas)
      sincronizacaoSalva = true

      await onAtualizarDados()

      const registros = await listarDecisoesRevisao(iteracao.id)

      setDecisoesAtualizadas(
        Object.fromEntries(
          registros.map(registro => [registro.issue_key, registro])
        )
      )

      setRevalidacaoPendente(
        resultado.revalidacao_governanca_pendente === true
      )
    } catch (erro) {
      const mensagem = erro instanceof Error
        ? erro.message
        : 'Falha na atualização do Jira.'

      throw new Error(
        sincronizacaoSalva
          ? `Sincronização salva, mas houve falha ao recarregar os dados: ${mensagem}`
          : mensagem,
        { cause: erro },
      )
    } finally {
      setAtualizando(null)
    }
  }

  async function atualizarDemandaIndividual(issueKey: string) {
    if (
      atualizando !== null ||
      carregandoDecisoes ||
      salvandoDecisao ||
      iteracao.status === 'consolidada'
    ) return

    setAtualizando('pending')
    setErroAtualizacao(null)
    setSucessoAtualizacao(null)
    setMenuAberto(null)
    setTooltipAlerta(null)

    let sincronizacaoSalva = false

    try {
      const resultado = await atualizarDemandasPendentes(
        iteracao.id,
        [issueKey],
      )

      sincronizacaoSalva = true

      await onAtualizarDados()

      const registros = await listarDecisoesRevisao(iteracao.id)

      setDecisoesAtualizadas(
        Object.fromEntries(
          registros.map(registro => [
            registro.issue_key,
            registro,
          ]),
        ),
      )

      setRevalidacaoPendente(
        resultado.revalidacao_governanca_pendente === true,
      )

      setSucessoAtualizacao(
        `Demanda ${issueKey} atualizada com sucesso. ` +
        `Versão ${resultado.versao} registrada. ` +
        `A decisão manual foi preservada.`,
      )
    } catch (erro) {
      const mensagem = erro instanceof Error
        ? erro.message
        : 'Não foi possível atualizar a demanda.'

      setErroAtualizacao(
        sincronizacaoSalva
          ? `A atualização de ${issueKey} foi salva, mas houve ` +
          `falha ao recarregar os dados: ${mensagem}`
          : `Erro ao atualizar ${issueKey}: ${mensagem}`,
      )
    } finally {
      setAtualizando(null)
    }
  }

  async function aplicarDecisao(
    chaves: string[],
    decisao: DecisaoRevisao,
  ) {
    if (
      !chaves.length ||
      carregandoDecisoes ||
      salvandoDecisao ||
      atualizando !== null ||
      iteracao.status === 'consolidada'
    ) return

    setSalvandoDecisao(true)
    setErroRevisaoManual(null)
    setSucessoRevisao(null)
    setMenuAberto(null)

    const resultados = await Promise.allSettled(
      chaves.map(chave =>
        salvarDecisaoRevisao(iteracao.id, chave, decisao)
      )
    )

    const registrosSalvos: RegistroDecisaoRevisao[] = []
    const falhas: string[] = []

    resultados.forEach((resultado, indice) => {
      if (resultado.status === 'fulfilled') {
        registrosSalvos.push(resultado.value)
      } else {
        falhas.push(chaves[indice])
      }
    })

    if (registrosSalvos.length) {
      setDecisoesAtualizadas(anteriores => ({
        ...(anteriores ?? {}),
        ...Object.fromEntries(
          registrosSalvos.map(registro => [
            registro.issue_key,
            registro,
          ])
        ),
      }))
    }

    setSelecionadas(falhas)

    if (falhas.length) {
      setErroRevisaoManual(
        `${falhas.length} decisão(ões) não foram salvas: ${falhas.join(', ')}.`
      )
    }

    if (registrosSalvos.length) {
      setSucessoRevisao(
        registrosSalvos.length === 1
          ? '1 decisão salva com sucesso.'
          : `${registrosSalvos.length} decisões salvas com sucesso.`,
      )
    }

    setSalvandoDecisao(false)
  }

  const demandaSelecionada = (selecionada
    ? mapaDemandas.get(selecionada)
    : undefined) as DemandaDetalhada | undefined

  // Na revisão, todas as demandas extraídas compõem o escopo preliminar.
  // As decisões do QA serão consideradas na consolidação definitiva.
  const demandasElegiveis = demandas.filter(d => {
    const tipoDemanda = d.issue_type?.trim().toLocaleLowerCase('pt-BR')

    return !['subtarefa', 'sub-task', 'subtask', 'spike'].includes(tipoDemanda)
  })

  const totalAnalisadas = demandasElegiveis.filter(d => {
    const tipo = d.issue_type?.trim().toLocaleLowerCase('pt-BR')
    return [
      'epic', 'épico',
      'história', 'historia', 'story', 'user story',
      'assertthat test plan', 'test plan', 'testplan', 'tp',
      'bug', 'sub-bug', 'sub bug', 'subbug',
    ].includes(tipo)
  }).length

  const indicadores = [
    ['Demandas analisadas', totalAnalisadas],
    ['Épicos', demandasElegiveis.filter(d =>
      ['epic', 'épico'].includes(d.issue_type?.trim().toLocaleLowerCase('pt-BR'))
    ).length],
    ['Histórias', demandasElegiveis.filter(d =>
      ['história', 'historia', 'story', 'user story'].includes(d.issue_type?.trim().toLocaleLowerCase('pt-BR'))
    ).length],
    ['Test Plans', demandasElegiveis.filter(d =>
      ['assertthat test plan', 'test plan', 'testplan', 'tp'].includes(d.issue_type?.trim().toLocaleLowerCase('pt-BR'))
    ).length],
    ['Defeitos', demandasElegiveis.filter(d =>
      ['bug', 'sub-bug', 'sub bug', 'subbug'].includes(d.issue_type?.trim().toLocaleLowerCase('pt-BR'))
    ).length],
  ] as const

  const resumoBugs = useMemo(() => {
    const normalizarTipo = (valor?: string | null) =>
      (valor ?? '').trim().toLocaleLowerCase('pt-BR')

    const defeitos = demandas.filter(d =>
      ['bug', 'sub-bug', 'sub bug', 'subbug'].includes(normalizarTipo(d.issue_type))
    )

    const subBugs = defeitos.filter(d =>
      ['sub-bug', 'sub bug', 'subbug'].includes(normalizarTipo(d.issue_type))
    )

    const comParent = defeitos.filter(d => Boolean(d.parent_key))
    const chaves = new Set(demandas.map(d => d.key))
    const parentNaExtracao = comParent.filter(d => chaves.has(d.parent_key!)).length

    const percentual = (quantidade: number) =>
      defeitos.length
        ? `${(quantidade / defeitos.length * 100).toFixed(1).replace('.', ',')}%`
        : '—'

    const distribuicao = [...new Set(defeitos.map(d => d.status?.trim() || ''))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map(status => {
        const quantidade = defeitos.filter(d => d.status === status).length
        return {
          status,
          quantidade,
          percentual: defeitos.length ? quantidade / defeitos.length * 100 : 0,
        }
      })

    const semStatus = defeitos.filter(d => !d.status?.trim()).length

    return {
      principais: [
        ['Defeitos', String(defeitos.length), 'Bugs e Sub-Bugs'],
        ['Bugs', String(defeitos.length - subBugs.length),
          `${percentual(defeitos.length - subBugs.length)} dos defeitos`],
        ['Sub-Bugs', String(subBugs.length), `${percentual(subBugs.length)} dos defeitos`],
        ['Com parent', String(comParent.length),
          `${parentNaExtracao} com parent na extração`],
        ['Sem parent', String(defeitos.length - comParent.length),
          'Sem referência de parent'],
      ],
      distribuicao,
      semStatus,
    }
  }, [demandas])

  const resumoCobertura = useMemo(() => {
    const normalizarTipo = (tipo: string) =>
      tipo.trim().toLocaleLowerCase('pt-BR')

    const historias = demandas.filter(d =>
      ['história', 'historia', 'story', 'user story'].includes(
        normalizarTipo(d.issue_type)
      )
    )

    const planos = demandas.filter(d =>
      ['assertthat test plan', 'test plan', 'testplan', 'tp'].includes(
        normalizarTipo(d.issue_type)
      )
    )

    const numero = (valor: unknown) =>
      typeof valor === 'number' && Number.isFinite(valor)
        ? Math.max(0, valor)
        : 0

    const comDados = planos.filter(p => {
      const assertthat = (p as Demanda & {
        assertthat?: { total?: number } | null
      }).assertthat

      return typeof assertthat?.total === 'number'
    })

    const somar = (campo: string) =>
      comDados.reduce((total, plano) => {
        const assertthat = (plano as Demanda & {
          assertthat?: Record<string, number> | null
        }).assertthat

        return total + numero(assertthat?.[campo])
      }, 0)

    const total = somar('total')
    const passed = somar('passed')
    const failed = somar('failed')
    const notRun = somar('not_run')
    const inProgress = somar('in_progress')
    const automated = somar('automated')
    const manual = somar('manual')

    const historiasComPlano = historias.filter(historia =>
      planos.some(plano =>
        (historia.qa_relationships ?? []).some(
          relacao =>
            relacao.relationship === 'test_plan' &&
            relacao.key === plano.key
        ) ||
        (plano.qa_relationships ?? []).some(
          relacao =>
            relacao.relationship === 'tests_story' &&
            relacao.key === historia.key
        )
      )
    ).length

    const percentual = (parte: number, total: number) =>
      total > 0
        ? `${(parte / total * 100).toFixed(1).replace('.', ',')}%`
        : '—'

    return {
      principais: [
        ['Histórias com TP', `${historiasComPlano} / ${historias.length}`,
          percentual(historiasComPlano, historias.length)],
        ['Cenários', String(total), 'Cenários identificados'],
        ['Execução', percentual(Math.max(0, total - notRun - inProgress), total),
          `${Math.max(0, total - notRun - inProgress)} concluídos`],
        ['Automação', percentual(automated, total),
          `${automated} automatizados · ${manual} manuais`],
      ],
      complementares: [
        ['Test Plans', String(planos.length),
          `${comDados.length} com dados AssertThat`],
        ['Aprovados', String(passed),
          `${percentual(passed, passed + failed)} dos concluídos`],
        ['Reprovados', String(failed), ''],
        ['Não executados', String(notRun), ''],
        ['Em andamento', String(inProgress), ''],
      ],
    }
  }, [demandas])

  async function registrarDecisao(decisao: DecisaoRevisao) {
    if (!demandaSelecionada) return

    await aplicarDecisao([demandaSelecionada.key], decisao)
  }

  async function prepararFinalizacao() {
    if (
      consultandoFinalizacao ||
      finalizandoRevisao ||
      atualizando !== null ||
      salvandoDecisao ||
      carregandoDecisoes ||
      iteracao.status === 'consolidada'
    ) {
      return
    }

    setConsultandoFinalizacao(true)
    setErroFinalizacao(null)
    setConfirmacaoRessalvas(false)

    try {
      const previa = await obterPreviaFinalizacao(
        iteracao.id,
      )
      setPreviaFinalizacao(previa)
    } catch (erro) {
      setErroFinalizacao(
        erro instanceof Error
          ? erro.message
          : 'Não foi possível verificar a revisão.'
      )
    } finally {
      setConsultandoFinalizacao(false)
    }
  }

  async function confirmarFinalizacao() {
    if (!previaFinalizacao || finalizandoRevisao) return

    if (
      previaFinalizacao.ressalvas.length > 0 &&
      !confirmacaoRessalvas
    ) {
      setErroFinalizacao(
        'Confirme que está ciente das ressalvas antes de continuar.'
      )
      return
    }

    setFinalizandoRevisao(true)
    setErroFinalizacao(null)

    try {
      await finalizarRevisao(
        iteracao.id,
        previaFinalizacao.assinatura,
        confirmacaoRessalvas,
      )

      setPreviaFinalizacao(null)
      onRevisaoFinalizada()
    } catch (erro) {
      setErroFinalizacao(
        erro instanceof Error
          ? erro.message
          : 'Não foi possível finalizar a revisão.'
      )
    } finally {
      setFinalizandoRevisao(false)
    }
  }

  function mostrarCategoriaAlerta(categoria: string) {
    setBusca('')
    setTipo('todos')
    setStatus('todos')
    setSomenteAlertas(true)
    setCategoriaAlerta(categoria)
    setSelecionada(null)

    document.getElementById('revisao-validacao')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="iteracao-page revisao-dados-page">
      <header className="iteracao-header revisao-dados-header">
        <nav
          className="revisao-dados-breadcrumb"
          aria-label="Localização"
        >
          <button type="button" className="qh-breadcrumb-link" onClick={onVoltar} title="Voltar à Central de Revisão">
            <House size={15} aria-hidden="true" />
            Central de Revisão
          </button>
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">Revisão dos Dados</span>
        </nav>

        <div className="revisao-dados-header-linha">
          <div className="revisao-dados-header-texto">
            <h1>Revisão dos Dados</h1>
            <p>
              Visão geral, qualidade, cobertura e rastreabilidade
              da iteração analisada.
            </p>
          </div>

          {iteracao.status !== 'consolidada' && (
            <button
              type="button"
              className="revisao-dados-voltar"
              disabled={
                consultandoFinalizacao ||
                finalizandoRevisao ||
                atualizando !== null ||
                salvandoDecisao ||
                carregandoDecisoes
              }
              onClick={() => void prepararFinalizacao()}
            >
              <CheckCircle2 size={16} />
              {consultandoFinalizacao
                ? 'Verificando revisão...'
                : 'Finalizar revisão'}
            </button>
          )}

          <button
            type="button"
            className="revisao-dados-voltar"
            onClick={onVoltar}
          >
            <ArrowLeft size={16} />
            Voltar à lista
          </button>
        </div>
      </header>

      <div className="iteracao-content">
        {erroFinalizacao && !previaFinalizacao && (
          <p role="alert" style={{ color: '#f87171' }}>
            {erroFinalizacao}
          </p>
        )}

        {previaFinalizacao && (
          <div
            className="revisao-finalizacao-overlay"
            onMouseDown={evento => {
              if (
                evento.target === evento.currentTarget &&
                !finalizandoRevisao
              ) {
                setPreviaFinalizacao(null)
                setErroFinalizacao(null)
              }
            }}
          >
            <section
              className="revisao-finalizacao-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="revisao-finalizacao-titulo"
            >
              <div className="revisao-finalizacao-header">
                <div>
                  <h2 id="revisao-finalizacao-titulo">
                    Finalizar revisão
                  </h2>
                  <small className="revisao-finalizacao-versao">
                    Versão dos dados: {previaFinalizacao.versao}
                  </small>
                </div>

                <button
                  type="button"
                  className="revisao-finalizacao-fechar"
                  aria-label="Fechar"
                  disabled={finalizandoRevisao}
                  onClick={() => {
                    setPreviaFinalizacao(null)
                    setErroFinalizacao(null)
                  }}
                >
                  ×
                </button>
              </div>

              <div className="revisao-finalizacao-body">
                <p className="revisao-finalizacao-introducao">
                  Confira o resumo da revisão antes de concluir a consolidação.
                </p>

                <div className="revisao-finalizacao-resumo">
                  <div>
                    <span>Demandas no escopo</span>
                    <strong>{previaFinalizacao.total_demandas}</strong>
                  </div>

                  <div>
                    <span>Demandas aprovadas</span>
                    <strong>{previaFinalizacao.total_aprovadas}</strong>
                  </div>

                  <div>
                    <span>Demandas excluídas</span>
                    <strong>{previaFinalizacao.total_excluidas}</strong>
                  </div>
                </div>

                {previaFinalizacao.ressalvas.length > 0 ? (
                  <>
                    <p>Foram identificadas as seguintes ressalvas:</p>

                    <div className="revisao-finalizacao-ressalvas">
                      {previaFinalizacao.ressalvas.map(ressalva => (
                        <div
                          key={ressalva.tipo}
                          className="revisao-finalizacao-ressalva"
                        >
                          <strong>
                            {ressalva.titulo}
                          </strong>

                          <span>
                            {ressalva.quantidade}{' '}
                            {ressalva.tipo === 'decisoes_pendentes'
                              ? ressalva.quantidade === 1 ? 'demanda' : 'demandas'
                              : ressalva.quantidade === 1 ? 'ocorrência' : 'ocorrências'}
                          </span>
                        </div>
                      ))}
                    </div>

                    <label className="revisao-finalizacao-confirmacao">
                      <input
                        type="checkbox"
                        checked={confirmacaoRessalvas}
                        onChange={evento =>
                          setConfirmacaoRessalvas(evento.target.checked)
                        }
                        disabled={finalizandoRevisao}
                      />

                      <span>
                        Estou ciente das pendências apresentadas e confirmo
                        que desejo prosseguir com a finalização da revisão.
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="revisao-finalizacao-sem-ressalvas">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Nenhuma ressalva identificada</strong>
                      <span>
                        A pré-validação não identificou pendências
                        que exijam confirmação adicional.
                      </span>
                    </div>
                  </div>
                )}

                <p className="revisao-finalizacao-observacao">
                  A conclusão encerra a revisão inicial. Os dados poderão
                  continuar sendo atualizados no relatório diário.
                </p>

                {erroFinalizacao && (
                  <p role="alert" className="revisao-finalizacao-erro">
                    {erroFinalizacao}
                  </p>
                )}
              </div>

              <div className="revisao-finalizacao-footer">
                <button
                  type="button"
                  className="revisao-dados-voltar"
                  disabled={finalizandoRevisao}
                  onClick={() => {
                    setPreviaFinalizacao(null)
                    setErroFinalizacao(null)
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  className="revisao-finalizacao-confirmar"
                  disabled={
                    finalizandoRevisao ||
                    !previaFinalizacao.pode_finalizar ||
                    (
                      previaFinalizacao.ressalvas.length > 0 &&
                      !confirmacaoRessalvas
                    )
                  }
                  onClick={() => void confirmarFinalizacao()}
                >
                  <CheckCircle2 size={16} />
                  {finalizandoRevisao
                    ? 'Finalizando...'
                    : 'Confirmar finalização'}
                </button>
              </div>
            </section>
          </div>
        )}
        <section className="revisao-contexto-card">
          <div className="revisao-contexto-titulo">
            <h2>Iteração analisada</h2>
            <button
              type="button"
              className="revisao-contexto-botao"
              aria-expanded={mostrarDetalhesIteracao}
              onClick={() => setMostrarDetalhesIteracao(valor => !valor)}
            >
              <Info size={16} />
              {mostrarDetalhesIteracao ? 'Ocultar detalhes' : 'Ver detalhes da iteração'}
            </button>
          </div>

          <div className="revisao-contexto-corpo">
            <div className="revisao-contexto-informacoes">
              <div>
                <span>Projeto</span>
                <strong>{iteracao.project_key}</strong>
              </div>

              <div>
                <span>Time</span>
                <strong>{iteracao.team_name}</strong>
              </div>

              <div>
                <span>Período</span>
                <strong>
                  {formatarPeriodo(dataInicial)}
                  {' – '}
                  {formatarPeriodo(dataFinal)}
                </strong>
              </div>

              <div>
                <span>Quarter</span>
                <strong>
                  {quarters.length
                    ? quarters.map(formatarQuarter).join(', ')
                    : '-'}
                </strong>
              </div>

              <div>
                <span>Sprints</span>
                <strong>
                  {sprints.length === 1
                    ? iteracao.sprint_name &&
                      iteracao.sprint_name !== iteracao.sprint_id
                      ? iteracao.sprint_name
                      : sprints[0]
                    : sprints.length > 1
                      ? `${sprints.length} selecionadas`
                      : '-'}
                </strong>
              </div>
            </div>
          </div>

          {mostrarDetalhesIteracao && (
            <div className="revisao-contexto-detalhes">
              <div>
                <span>Sprints selecionadas</span>
                <strong>
                  {sprints.length
                    ? sprints.length === 1 && iteracao.sprint_name &&
                      iteracao.sprint_name !== iteracao.sprint_id
                      ? iteracao.sprint_name
                      : sprints.join(', ')
                    : '-'}
                </strong>
              </div>

              <div>
                <span>Quarters selecionados</span>
                <strong>
                  {quarters.length
                    ? quarters.map(formatarQuarter).join(', ')
                    : '-'}
                </strong>
              </div>

              <div>
                <span>Identificador da iteração</span>
                <strong>{iteracao.id}</strong>
              </div>

              <div>
                <span>Status</span>
                <strong>
                  {iteracao.status === 'em_revisao'
                    ? 'Em revisão'
                    : iteracao.status === 'consolidada'
                      ? 'Consolidada'
                      : 'Pendente'}
                </strong>
              </div>
            </div>
          )}
        </section>
        {totalAlertas > 0 && (
          <section className="revisao-alertas-painel">
            <div className="revisao-alertas-cabecalho">
              <div className="revisao-alertas-identificacao">
                <div className="revisao-alertas-icone-principal">
                  <AlertTriangle size={22} />
                </div>

                <div>
                  <h2>Atenção</h2>
                  <p>
                    Foram identificadas {totalAlertas}{' '}
                    {totalAlertas === 1
                      ? 'demanda com alerta'
                      : 'demandas com alertas'}.
                    {' '}Revise para garantir uma análise completa.
                  </p>
                </div>
              </div>
            </div>

            <div className="revisao-alertas-categorias">
              {(mostrarTodasCategorias ? resumoCategorias : resumoCategorias.slice(0, 3)).map(categoria => (
                <button
                  key={categoria.id}
                  type="button"
                  className={`revisao-alertas-categoria revisao-alertas-${categoria.cor}`}
                  onClick={() => mostrarCategoriaAlerta(categoria.id)}
                >
                  <span className="revisao-alertas-categoria-icone">
                    {categoria.cor === 'vermelho' ? (
                      <CircleX size={18} />
                    ) : categoria.cor === 'amarelo' ? (
                      <AlertTriangle size={18} />
                    ) : (
                      <Info size={18} />
                    )}
                  </span>

                  <span className="revisao-alertas-categoria-texto">
                    <strong>
                      {categoria.quantidade}{' '}
                      {categoria.quantidade === 1
                        ? 'demanda'
                        : 'demandas'}
                    </strong>

                    <small>{categoria.titulo}</small>
                  </span>

                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
            {resumoCategorias.length > 3 && (
              <button
                type="button"
                className="revisao-alertas-ver-todos"
                onClick={() => setMostrarTodasCategorias(valor => !valor)}
                aria-expanded={mostrarTodasCategorias}
              >
                {mostrarTodasCategorias
                  ? 'Mostrar menos categorias'
                  : `Mostrar todas as ${resumoCategorias.length} categorias`}
                {mostrarTodasCategorias ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            )}
          </section>
        )}
        <section className="iteracao-card revisao-resumo-card">
          <div className="iteracao-card-heading">
            <div className="iteracao-card-icon">
              <ChartNoAxesColumn size={21} />
            </div>
            <div className="iteracao-card-title">
              <h2>Resumo da análise</h2>
              <p>Demandas encaminhadas para revisão.</p>
            </div>
          </div>

          <div className="iteracao-qa-indicators">
            {indicadores.map(([titulo, valor], indice) => (
              <div className="iteracao-qa-indicator" key={titulo}>
                <span>{titulo}</span>
                <strong>{valor}</strong>
                <small>
                  {indice === 0
                    ? '100% do escopo preliminar'
                    : `${totalAnalisadas > 0
                      ? ((valor / totalAnalisadas) * 100).toFixed(1).replace('.', ',')
                      : '0,0'}% das demandas`}
                </small>
              </div>
            ))}
          </div>

          <div className="revisao-cobertura-resumo">
            <div className="revisao-cobertura-cabecalho">
              <div>
                <h3>Cobertura e execução dos testes</h3>
                <p>Indicadores dos Test Plans da iteração.</p>
              </div>

              <button
                type="button"
                onClick={() => setMostrarIndicadoresCobertura(valor => !valor)}
                aria-expanded={mostrarIndicadoresCobertura}
              >
                {mostrarIndicadoresCobertura
                  ? 'Ocultar detalhes'
                  : 'Ver todos os indicadores'}
                <ChevronDown size={15} />
              </button>
            </div>

            <div className="revisao-cobertura-indicadores">
              {resumoCobertura.principais.map(([titulo, valor, detalhe]) => (
                <div className="revisao-cobertura-indicador" key={titulo}>
                  <span>{titulo}</span>
                  <strong>{valor}</strong>
                  <small>{detalhe}</small>
                </div>
              ))}
            </div>

            {mostrarIndicadoresCobertura && (
              <div className="revisao-cobertura-complementares">
                {resumoCobertura.complementares.map(([titulo, valor, detalhe]) => (
                  <div className="revisao-cobertura-indicador" key={titulo}>
                    <span>{titulo}</span>
                    <strong>{valor}</strong>
                    {detalhe && <small>{detalhe}</small>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="revisao-cobertura-resumo revisao-bugs-resumo">
            <div className="revisao-cobertura-cabecalho">
              <div>
                <h3>Panorama dos defeitos</h3>
                <p>Indicadores de Bugs e Sub-Bugs da iteração.</p>
              </div>

              <button
                type="button"
                onClick={() => setMostrarDistribuicaoBugs(valor => !valor)}
                aria-expanded={mostrarDistribuicaoBugs}
              >
                {mostrarDistribuicaoBugs
                  ? 'Ocultar distribuição'
                  : 'Ver distribuição por status'}
                <ChevronDown size={15} />
              </button>
            </div>

            <div className="revisao-cobertura-indicadores revisao-bugs-indicadores">
              {resumoBugs.principais.map(([titulo, valor, detalhe]) => (
                <div className="revisao-cobertura-indicador" key={titulo}>
                  <span>{titulo}</span>
                  <strong>{valor}</strong>
                  <small>{detalhe}</small>
                </div>
              ))}
            </div>

            {mostrarDistribuicaoBugs && (
              <div className="revisao-bugs-distribuicao">
                <h4>Distribuição por status</h4>
                <div className="analise-bugs-status-lista">
                  {resumoBugs.distribuicao.map(item => (
                    <div className="analise-bugs-status" key={item.status}>
                      <span title={item.status}>{item.status}</span>
                      <strong>{item.quantidade}</strong>
                      <div className="analise-bugs-barra" aria-hidden="true">
                        <div style={{ width: `${item.percentual}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {!resumoBugs.distribuicao.length && (
                  <p>Nenhum status disponível.</p>
                )}

                {resumoBugs.semStatus > 0 && (
                  <p>{resumoBugs.semStatus} defeito(s) sem status informado.</p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="iteracao-card" id="revisao-validacao">
          <div className="revisao-validacao-cabecalho">
            <div className="iteracao-card-heading">
              <div className="iteracao-card-icon">
                <ShieldCheck size={21} />
              </div>
              <div className="iteracao-card-title">
                <h2>Validação dos dados</h2>
                <p>
                  Consulte as demandas e os alertas identificados.
                </p>
              </div>
            </div>

            {abaValidacao === 'demandas' && (
              <div className="revisao-validacao-acoes">
                <button
                  type="button"
                  className="revisao-atualizacao-botao"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    width: 'auto',
                    height: 'auto',
                  }}
                  disabled={
                    atualizando !== null ||
                    carregandoDecisoes ||
                    salvandoDecisao ||
                    iteracao.status === 'consolidada'
                  }
                  onClick={() => void executarAtualizacao('all')}
                >
                  <RefreshCw size={15} />
                  {atualizando === 'all'
                    ? 'Atualizando tudo...'
                    : 'Atualizar tudo'}
                </button>

                <button
                  type="button"
                  className="revisao-filtro-limpar"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    width: 'auto',
                    height: 'auto',
                  }}
                  disabled={
                    atualizando !== null ||
                    carregandoDecisoes ||
                    salvandoDecisao ||
                    iteracao.status === 'consolidada' ||
                    chavesPendentes.length === 0
                  }
                  onClick={() => void executarAtualizacao('pending')}
                >
                  <RefreshCw size={15} />
                  {atualizando === 'pending'
                    ? 'Atualizando pendentes...'
                    : `Atualizar pendentes (${chavesPendentes.length})`}
                </button>
              </div>
            )}
          </div>

          {atualizando && (
            <div
              className="revisao-feedback-atualizando"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle
                size={17}
                strokeWidth={2.5}
                className="revisao-feedback-atualizando-icone"
                aria-hidden="true"
              />

              <div className="revisao-feedback-atualizando-texto">
                <strong>Atualização em andamento</strong>

                <span>
                  {abaValidacao === 'cobertura'
                    ? 'Consultando os dados de cobertura e atualizando os vínculos de testes. Esta operação pode demorar.'
                    : abaValidacao === 'bugs'
                      ? 'Consultando os bugs e atualizando os dados da análise. Esta operação pode demorar.'
                      : atualizando === 'all'
                        ? 'Consultando o Jira e reconstruindo o snapshot. Esta operação pode demorar.'
                        : 'Consultando as demandas pendentes no Jira. Aguarde a conclusão.'}
                </span>
              </div>
            </div>
          )}

          {abaValidacao === 'demandas' && erroAtualizacao && (
            <p
              className="iteracao-note"
              role="alert"
              style={{ color: '#f87171' }}
            >
              {erroAtualizacao}
            </p>
          )}

          {abaValidacao === 'demandas' && sucessoAtualizacao && (
            <div
              className="revisao-feedback-sincronizacao revisao-feedback-sincronizacao--sucesso"
              role="status"
            >
              <Check size={15} />

              <span>
                {sucessoAtualizacao}

                {novasUltimaAtualizacao.length > 0 && (
                  <>
                    {' '}
                    {novasUltimaAtualizacao.length === 1
                      ? '1 nova demanda incorporada.'
                      : `${novasUltimaAtualizacao.length} novas demandas incorporadas.`}
                  </>
                )}
              </span>
            </div>
          )}

          {feedbackAba && feedbackAba.aba === abaValidacao && !atualizando && (
            <div
              className={`revisao-feedback-sincronizacao revisao-feedback-sincronizacao--${feedbackAba.tipo}`}
              role={feedbackAba.tipo === 'erro' ? 'alert' : 'status'}
            >
              {feedbackAba.tipo === 'sucesso'
                ? <Check size={15} aria-hidden="true" />
                : <AlertTriangle size={15} aria-hidden="true" />}
              <span>{feedbackAba.mensagem}</span>
            </div>
          )}

          <div className="revisao-tabela-tabs" role="tablist" aria-label="Áreas de validação">
            <button type="button" role="tab" aria-selected={abaValidacao === 'demandas'} className={abaValidacao === 'demandas' ? 'ativo' : ''} onClick={() => alterarAbaValidacao('demandas')}>Lista de demandas</button>
            <button type="button" role="tab" aria-selected={abaValidacao === 'cobertura'} className={abaValidacao === 'cobertura' ? 'ativo' : ''} onClick={() => alterarAbaValidacao('cobertura')}>Cobertura de testes</button>
            <button
              type="button"
              role="tab"
              aria-selected={abaValidacao === 'bugs'}
              className={abaValidacao === 'bugs' ? 'ativo' : ''}
              onClick={() => alterarAbaValidacao('bugs')}
            >
              Análise de bugs
            </button>
          </div>

          {abaValidacao === 'cobertura' ? (
            <CoberturaTestes
              onFeedback={(tipo, mensagem) => setFeedbackAba(tipo && mensagem ? { aba: 'cobertura', tipo, mensagem } : null)}
              demandas={demandas}
              onAtualizar={atualizarChavesDaAba}
              atualizando={atualizando !== null}
              bloqueado={iteracao.status === 'consolidada'}
            />
          ) : abaValidacao === 'bugs' ? (
            <AnaliseBugs
              onFeedback={(tipo, mensagem) => setFeedbackAba(tipo && mensagem ? { aba: 'bugs', tipo, mensagem } : null)}
              demandas={demandas}
              onAtualizar={atualizarChavesDaAba}
              atualizando={atualizando !== null}
              bloqueado={iteracao.status === 'consolidada'}
            />
          ) : (
            <>
              <div className="qh-tabela-layout">
                <div className="revisao-tabela-filtros qh-filtros">
                  <label className="revisao-filtro-busca qh-filtro-busca">
                    <span>Buscar demanda</span>
                    <span className="qh-campo-busca">
                      <Search size={14} />
                      <input
                        type="search"
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por chave, resumo..."
                      />
                    </span>
                  </label>

                  <label>
                    <span>Tipo</span>
                    <select
                      value={tipo}
                      onChange={e => setTipo(e.target.value)}
                    >
                      <option value="todos">Todos</option>
                      {tipos.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Status</span>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value)}
                    >
                      <option value="todos">Todos</option>
                      {statusDisponiveis.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value="sem_status">Sem status</option>
                    </select>
                  </label>

                  <label>
                    <span>Decisão</span>
                    <select
                      value={filtroDecisao}
                      onChange={e => setFiltroDecisao(e.target.value)}
                    >
                      <option value="todos">Todas</option>
                      <option value="include">Incluir</option>
                      <option value="exclude">Excluir</option>
                      <option value="pending">Pendente</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="revisao-filtro-limpar"
                    title="Limpar filtros"
                    aria-label="Limpar filtros"
                    onClick={() => {
                      setBusca('')
                      setTipo('todos')
                      setStatus('todos')
                      setFiltroDecisao('todos')
                      setSomenteAlertas(false)
                      setCategoriaAlerta(null)
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {categoriaAlerta && (
                  <div className="revisao-alertas-filtro-ativo">
                    <span>
                      Filtrando por:{' '}
                      <strong>
                        {resumoCategorias.find(
                          categoria => categoria.id === categoriaAlerta
                        )?.titulo}
                      </strong>
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        setCategoriaAlerta(null)
                        setSomenteAlertas(false)
                      }}
                    >
                      <X size={14} />
                      Limpar filtro
                    </button>
                  </div>
                )}

                {!demandaSelecionada && erroRevisao && (
                  <p role="alert" className="iteracao-note" style={{ color: '#f87171' }}>
                    {erroRevisao}
                  </p>
                )}

                {!demandaSelecionada && sucessoRevisao && (
                  <div className="revisao-feedback-sucesso" role="status">
                    <Check size={15} />
                    <span>{sucessoRevisao}</span>
                  </div>
                )}

                {selecionadas.length > 0 && (
                  <div className="revisao-acoes-lote">
                    <strong>
                      {selecionadas.length === 1
                        ? '1 demanda selecionada'
                        : `${selecionadas.length} demandas selecionadas`}
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao(selecionadas, 'include')
                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        atualizando !== null ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      <Check size={14} />
                      Incluir
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao(selecionadas, 'exclude')
                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      Excluir
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao(selecionadas, 'pending')

                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      Pendente
                    </button>

                    <button
                      type="button"
                      className="revisao-lote-limpar"
                      onClick={() => setSelecionadas([])}
                    >
                      Limpar seleção
                    </button>
                  </div>
                )}

                <div className="revisao-tabela-scroll qh-tabela-scroll">
                  <table className="revisao-tabela qh-tabela">
                    <thead>
                      <tr>
                        <th className="revisao-col-checkbox">
                          <input
                            type="checkbox"
                            aria-label="Selecionar todas as demandas filtradas"
                            checked={todasSelecionadas}
                            onChange={alternarTodas}
                          />
                        </th>
                        <th>Chave</th>
                        <th>Resumo</th>
                        <th>Tipo</th>
                        <th>Status</th>
                        <th>Quarter</th>
                        <th>Sprint</th>
                        <th>Decisão</th>
                        <th>Alertas</th>
                        <th>Ações</th>
                      </tr>
                    </thead>

                    <tbody>
                      {demandasPaginadas.map(demanda => {
                        const decisao = obterDecisao(demanda)
                        const quantidadeAlertas =
                          alertas.get(demanda.key)?.length ?? 0

                        return (
                          <tr
                            key={demanda.key}
                            className={[
                              selecionada === demanda.key ? 'revisao-linha-ativa' : '',
                              novasNaoReconhecidas.includes(demanda.key) ? 'revisao-linha-nova' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Selecionar ${demanda.key}`}
                                checked={selecionadas.includes(demanda.key)}
                                onChange={e =>
                                  setSelecionadas(anteriores =>
                                    e.target.checked
                                      ? [...new Set([...anteriores, demanda.key])]
                                      : anteriores.filter(
                                        key => key !== demanda.key
                                      )
                                  )
                                }
                              />
                            </td>

                            <td>
                              <button
                                type="button"
                                className="revisao-chave"
                                onClick={() => abrirDemanda(demanda.key)}
                              >
                                {demanda.key}
                              </button>
                            </td>

                            <td>
                              <button
                                type="button"
                                className="revisao-resumo"
                                title={demanda.summary}
                                onClick={() => abrirDemanda(demanda.key)}
                              >
                                {demanda.summary}
                              </button>
                            </td>

                            <td>
                              <span className={`revisao-badge revisao-badge-tipo ${classeTipoDemanda(demanda.issue_type)}`}>
                                {demanda.issue_type}
                              </span>
                            </td>

                            <td>
                              <span className={`revisao-badge revisao-badge-status ${classeStatusDemanda(demanda.status)}`}>
                                {demanda.status || '—'}
                              </span>
                            </td>

                            <td>
                              {(demanda as DemandaTabela).quarters
                                ?.map(formatarQuarter)
                                .join(', ') || '—'}
                            </td>

                            <td>
                              {(demanda as DemandaTabela).sprints
                                ?.map(sprint =>
                                  sprint.name || String(sprint.id)
                                )
                                .join(', ') || '—'}
                            </td>

                            <td>
                              <span
                                className={`revisao-badge revisao-decisao-${decisao}`}
                              >
                                {decisao === 'include'
                                  ? 'Incluir'
                                  : decisao === 'exclude'
                                    ? 'Excluir'
                                    : 'Revisar'}
                              </span>
                            </td>

                            <td>
                              {quantidadeAlertas > 0 ? (
                                <span
                                  className="revisao-alerta-contagem"
                                  tabIndex={0}
                                  onMouseEnter={e => {
                                    const rect = e.currentTarget.getBoundingClientRect()

                                    setTooltipAlerta({
                                      key: demanda.key,
                                      top: rect.bottom + 8,
                                      left: Math.min(rect.left, window.innerWidth - 360),
                                    })
                                  }}
                                  onMouseLeave={() => setTooltipAlerta(null)}
                                  onFocus={e => {
                                    const rect = e.currentTarget.getBoundingClientRect()

                                    setTooltipAlerta({
                                      key: demanda.key,
                                      top: rect.bottom + 8,
                                      left: Math.min(rect.left, window.innerWidth - 360),
                                    })
                                  }}
                                  onBlur={() => setTooltipAlerta(null)}
                                >
                                  <AlertTriangle size={13} />
                                  {quantidadeAlertas}
                                </span>
                              ) : '—'}
                            </td>

                            <td className="revisao-col-acoes">
                              <button
                                type="button"
                                className="revisao-menu-botao"
                                aria-label={`Ações para ${demanda.key}`}
                                aria-expanded={menuAberto === demanda.key}
                                onClick={e => {
                                  if (menuAberto === demanda.key) {
                                    setMenuAberto(null)
                                    return
                                  }

                                  const rect = e.currentTarget.getBoundingClientRect()

                                  const alturaMenu = 210
                                  const larguraMenu = 150

                                  const abrirAcima =
                                    window.innerHeight - rect.bottom < alturaMenu + 12

                                  setPosicaoMenu({
                                    top: abrirAcima
                                      ? rect.top - alturaMenu - 6
                                      : rect.bottom + 6,
                                    left: Math.max(
                                      8,
                                      Math.min(
                                        rect.right - larguraMenu,
                                        window.innerWidth - larguraMenu - 8
                                      )
                                    ),
                                  })

                                  setMenuAberto(demanda.key)
                                }}
                              >
                                <MoreHorizontal size={17} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}

                      {filtradas.length === 0 && (
                        <tr>
                          <td colSpan={10} className="revisao-vazio">
                            Nenhuma demanda encontrada.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {tooltipAlerta && createPortal(
                  <div
                    className="revisao-alerta-tooltip-flutuante"
                    role="tooltip"
                    style={{
                      top: tooltipAlerta.top,
                      left: tooltipAlerta.left,
                    }}
                  >
                    <strong>
                      Alertas identificados (
                      {alertas.get(tooltipAlerta.key)?.length ?? 0})
                    </strong>

                    <ul>
                      {(alertas.get(tooltipAlerta.key) ?? []).map(
                        (alerta, indice) => (
                          <li key={`${alerta.id}-${indice}`}>
                            <AlertTriangle size={12} />
                            <span>{alerta.titulo}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>,
                  document.body
                )}

                {menuAberto && createPortal(
                  <div
                    ref={menuRef}
                    className="revisao-menu-flutuante"
                    style={{
                      top: posicaoMenu.top,
                      left: posicaoMenu.left,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao([menuAberto], 'include')
                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        atualizando !== null ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      <Check size={14} /> Incluir
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao([menuAberto], 'exclude')
                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        atualizando !== null ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      <X size={14} /> Exclui
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        aplicarDecisao([menuAberto], 'pending')
                      }
                      disabled={
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        atualizando !== null ||
                        iteracao.status === 'consolidada'
                      }
                    >
                      <Clock3 size={14} /> Pendente
                    </button>

                    <button
                      className="revisao-menu-separador"
                      type="button"
                      disabled={
                        atualizando !== null ||
                        carregandoDecisoes ||
                        salvandoDecisao ||
                        iteracao.status === 'consolidada'
                      }
                      onClick={() => {
                        if (menuAberto) {
                          void atualizarDemandaIndividual(menuAberto)
                        }
                      }}
                    >
                      <RefreshCw size={14} />
                      Atualizar do Jira
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        abrirDemanda(menuAberto)
                        setMenuAberto(null)
                      }}
                    >
                      <Eye size={14} /> Ver detalhes
                    </button>
                  </div>,
                  document.body
                )}

                <div className="revisao-tabela-rodape qh-tabela-rodape">
                  <span>
                    Exibindo {inicioExibicao}–{fimExibicao} de{' '}
                    {filtradas.length} demandas
                  </span>

                  <div className="revisao-paginacao qh-paginacao">
                    <label>
                      Por página
                      <select
                        value={itensPorPagina}
                        onChange={e => {
                          setItensPorPagina(Number(e.target.value))
                          setPaginaAtual(1)
                        }}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </label>

                    <button
                      type="button"
                      disabled={paginaVisivel === 1}
                      onClick={() => setPaginaAtual(1)}
                      title="Primeira página"
                    >
                      «
                    </button>

                    <button
                      type="button"
                      disabled={paginaVisivel === 1}
                      onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
                      title="Página anterior"
                    >
                      ‹
                    </button>

                    <span>
                      {paginaVisivel} de {totalPaginas}
                    </span>

                    <button
                      type="button"
                      disabled={paginaVisivel === totalPaginas}
                      onClick={() =>
                        setPaginaAtual(p => Math.min(totalPaginas, p + 1))
                      }
                      title="Próxima página"
                    >
                      ›
                    </button>

                    <button
                      type="button"
                      disabled={paginaVisivel === totalPaginas}
                      onClick={() => setPaginaAtual(totalPaginas)}
                      title="Última página"
                    >
                      »
                    </button>
                  </div>
                </div>

              </div>

              {demandaSelecionada && (
                <div className="iteracao-detail-panel">
                  <div className="iteracao-detail-header">
                    <div className="iteracao-detail-heading">
                      <div className="iteracao-detail-title">
                        <h3>{demandaSelecionada.key}</h3>
                        <span className={`revisao-badge revisao-badge-tipo ${classeTipoDemanda(demandaSelecionada.issue_type)}`}>
                          {demandaSelecionada.issue_type}
                        </span>
                      </div>
                      <p>{demandaSelecionada.summary}</p>
                    </div>

                    <button
                      type="button"
                      className="qh-detalhes-fechar"
                      onClick={fecharDemanda}
                      title="Fechar detalhes"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="revisao-detalhe-resumo">
                    <div>
                      <span>Status</span>
                      <strong>
                        <span className={`revisao-badge revisao-badge-status ${classeStatusDemanda(demandaSelecionada.status)}`}>
                          {demandaSelecionada.status || 'Não informado'}
                        </span>
                      </strong>
                    </div>
                    <div>
                      <span>Prioridade</span>
                      <strong>
                        <span className={`revisao-detalhe-badge ${classePrioridadeDemanda(formatarValorJira(demandaSelecionada.priority))}`}>
                          {formatarValorJira(demandaSelecionada.priority)}
                        </span>
                      </strong>
                    </div>
                    <div>
                      <span>Parent</span>
                      <strong>{demandaSelecionada.parent_key || 'Não informado'}</strong>
                    </div>
                    <div>
                      <span>Escopo</span>
                      <strong>
                        <span
                          className={`revisao-detalhe-badge revisao-detalhe-badge-escopo ${nomeEscopo(demandaSelecionada.scope)
                            .trim()
                            .toLowerCase() === "direta"
                            ? "qh-escopo--direta"
                            : ""
                            }`}
                        >
                          {nomeEscopo(demandaSelecionada.scope)}
                        </span>
                      </strong>
                    </div>
                  </div>

                  <div className="revisao-governanca-painel">
                    <details className="iteracao-detail-section revisao-detalhe-pendencias" key={`pendencias-${demandaSelecionada.key}`}>
                      <summary className="revisao-pendencias-resumo">
                        <span className="revisao-pendencias-titulo">
                          <AlertTriangle size={15} aria-hidden="true" />
                          Pendências identificadas
                          <span className="revisao-pendencias-contagem">{(alertas.get(demandaSelecionada.key) ?? []).length}</span>
                          {(() => {
                            const quantidade = (alertas.get(demandaSelecionada.key) ?? []).filter(alerta => alertasRevisao.has(alerta.id)).length
                            return quantidade > 0 ? <span className="revisao-pendencias-revisao">{quantidade} exigem revisão</span> : null
                          })()}
                        </span>
                        <span className="revisao-pendencias-alternar">
                          <span className="revisao-pendencias-expandir">Expandir</span>
                          <span className="revisao-pendencias-ocultar">Ocultar</span>
                          <ChevronDown size={16} aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="revisao-pendencias-conteudo">
                        {(alertas.get(demandaSelecionada.key) ?? []).length ? (
                          (['vermelho', 'amarelo', 'azul'] as const).map(cor => {
                            const alertasGrupo = (alertas.get(demandaSelecionada.key) ?? []).filter(alerta => {
                              const categoria = resumoCategorias.find(item => item.id === alerta.id)
                              return (categoria?.cor ?? 'azul') === cor
                            })
                            if (!alertasGrupo.length) return null
                            const rotulo = cor === 'vermelho' ? 'Críticos' : cor === 'amarelo' ? 'Atenção' : 'Informativos'
                            return (
                              <div className={`revisao-pendencias-grupo revisao-pendencias-${cor}`} key={cor}>
                                <div className="revisao-pendencias-grupo-titulo">
                                  <span className="revisao-pendencias-icone" aria-hidden="true">
                                    {cor === 'azul'
                                      ? <Info size={18} />
                                      : <AlertTriangle size={18} />}
                                  </span>
                                  <strong>{rotulo}</strong>
                                  <span className="revisao-pendencias-grupo-contagem">
                                    {alertasGrupo.length}
                                  </span>
                                </div>
                                <div className="revisao-pendencias-lista">
                                  {alertasGrupo.map(alerta => (
                                    <div className="revisao-pendencias-item" key={alerta.id} title={alerta.detalhe}>
                                      <span className="revisao-pendencias-ponto" aria-hidden="true" />
                                      <span>{alerta.titulo}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <p className="iteracao-note">Nenhuma pendência identificada.</p>
                        )}
                      </div>
                    </details>

                    <div className="iteracao-detail-section revisao-decisao revisao-decisao-compacta">
                      <div className="revisao-decisao-cabecalho">
                        <h4>Decisão da revisão</h4>
                        <span className={`revisao-decisao-recomendacao ${(alertas.get(demandaSelecionada.key) ?? []).some(alerta => alertasRevisao.has(alerta.id)) ? 'revisao-decisao-recomendacao-revisar' : 'revisao-decisao-recomendacao-incluir'}`}>
                          {(alertas.get(demandaSelecionada.key) ?? []).some(alerta => alertasRevisao.has(alerta.id)) ? 'Revisão recomendada' : 'Inclusão recomendada'}
                        </span>
                      </div>

                      <div className="revisao-decisao-corpo">
                        <div className="revisao-decisao-informacoes">
                          <p className="revisao-decisao-registrada">
                            Decisão registrada:{' '}
                            <strong>
                              {decisoes[demandaSelecionada.key]?.decisao === 'include'
                                ? 'Incluir'
                                : decisoes[demandaSelecionada.key]?.decisao === 'exclude'
                                  ? 'Excluir'
                                  : decisoes[demandaSelecionada.key]?.decisao === 'pending'
                                    ? 'Pendente'
                                    : 'Sem decisão manual'}
                            </strong>
                          </p>

                          {carregandoDecisoes && (
                            <p className="iteracao-note">Carregando decisões...</p>
                          )}
                          {salvandoDecisao && (
                            <p className="iteracao-note">Salvando decisão...</p>
                          )}
                          {erroRevisao && (
                            <p role="alert" className="iteracao-note revisao-decisao-feedback-erro">
                              {erroRevisao}
                            </p>
                          )}
                          {sucessoRevisao && (
                            <p role="status" className="iteracao-note revisao-decisao-feedback-sucesso">
                              {sucessoRevisao}
                            </p>
                          )}
                        </div>

                        <div className="revisao-decisao-acoes">
                          {([
                            ['include', 'Incluir'],
                            ['exclude', 'Excluir'],
                            ['pending', 'Pendente'],
                          ] as const).map(([valor, rotulo]) => (
                            <button
                              key={valor}
                              type="button"
                              className={`revisao-decisao-botao-${valor}${decisoes[demandaSelecionada.key]?.decisao === valor ? ' revisao-decisao-ativo' : ''}`}
                              disabled={
                                carregandoDecisoes ||
                                salvandoDecisao ||
                                atualizando !== null ||
                                iteracao.status === 'consolidada'
                              }
                              aria-pressed={decisoes[demandaSelecionada.key]?.decisao === valor}
                              onClick={() => registrarDecisao(valor)}
                            >
                              {rotulo}
                            </button>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>


                  <div className="iteracao-detail-section revisao-detalhe-jira">
                    <h4>Informações do Jira</h4>

                    <div className="revisao-detalhe-grid">
                      {([
                        ['Responsável', demandaSelecionada.assignee],
                        ['Reportante', demandaSelecionada.reporter],
                        ['Labels/categorias', demandaSelecionada.categories],
                        ['Quarter', demandaSelecionada.quarters?.map(formatarQuarter)],
                      ] as [string, unknown][]).map(([rotulo, valor]) => (
                        <CampoJiraVisual key={rotulo} rotulo={rotulo} valor={valor} />
                      ))}
                      <CampoSprintsCompacto sprints={(demandaSelecionada as DemandaTabela).sprints} />
                    </div>

                    <details className="revisao-detalhe-adicionais">
                      <summary className="revisao-adicionais-resumo">
                        <span>Dados adicionais e campos técnicos do Jira</span>

                        <span className="revisao-adicionais-alternar">
                          <span className="revisao-adicionais-expandir">Expandir</span>
                          <span className="revisao-adicionais-ocultar">Ocultar</span>
                          <ChevronDown size={15} aria-hidden="true" />
                        </span>
                      </summary>

                      {(() => {

                        const camposJira = Object.entries(
                          demandaSelecionada.jira_fields ?? {}
                        )
                          .map(([campo, valor]) => ({
                            campo,
                            rotulo: NOMES_CAMPOS_JIRA[campo] ?? campo,
                            valor,
                          }))
                          .filter(({ rotulo }) =>
                            !['Quarter', 'Sprint', 'Sprint (campo Jira)'].includes(rotulo)
                          )

                        const campoSlaJira = camposJira.find(
                          ({ rotulo }) => rotulo.trim().toLowerCase() === 'sla'
                        )

                        const valorSla = obterSlaRevisao(
                          demandaSelecionada,
                          campoSlaJira?.valor,
                        )

                        const campos = [
                          ...camposJira.filter(
                            ({ rotulo }) => rotulo.trim().toLowerCase() !== 'sla'
                          ),
                          {
                            campo: campoSlaJira?.campo ?? 'qualityhub_sla',
                            rotulo: 'SLA',
                            valor: valorSla,
                          },
                        ]


                        const planejamento = [
                          'Story Points',
                          'Quantidade de cenários',
                          'Baseline Quarter',
                          'Time',
                          'T-Shirt do Epic',
                        ]

                        const governanca = [
                          'SLA',
                          'Desenvolvedor',
                          'Causa raiz',
                          'Status do mapeamento',
                          'Responsável pelo mapeamento',
                        ]

                        const grupos = [
                          {
                            titulo: 'Planejamento e execução',
                            campos: campos.filter(({ rotulo }) => planejamento.includes(rotulo)),
                          },
                          {
                            titulo: 'Qualidade e governança',
                            campos: governanca.flatMap(rotulo =>
                              campos.filter(campo => campo.rotulo === rotulo)
                            ),
                          },
                          {
                            titulo: 'Outros campos técnicos',
                            campos: campos.filter(({ rotulo }) =>
                              !planejamento.includes(rotulo) && !governanca.includes(rotulo)
                            ),
                          },
                        ]

                        return (
                          <div className="revisao-jira-grupos">
                            <div className="revisao-jira-grupo">
                              <h5>Histórico</h5>
                              <div className="revisao-detalhe-grid">
                                {([
                                  ['Criada em', formatarDataJira(demandaSelecionada.created)],
                                  ['Atualizada em', formatarDataJira(demandaSelecionada.updated)],
                                  ['Resolvida em', formatarDataJira(demandaSelecionada.resolved)],
                                ] as [string, unknown][]).map(([rotulo, valor]) => (
                                  <CampoJiraVisual key={rotulo} rotulo={rotulo} valor={valor} />
                                ))}
                              </div>
                            </div>

                            {grupos.filter(grupo => grupo.campos.length > 0).map(grupo => (
                              <div className="revisao-jira-grupo" key={grupo.titulo}>
                                <h5>{grupo.titulo}</h5>
                                <div className="revisao-detalhe-grid">
                                  {grupo.campos.map(({ campo, rotulo, valor }) => (
                                    <CampoJiraVisual
                                      key={campo}
                                      rotulo={rotulo}
                                      valor={valor}
                                      slaCalculado={
                                        rotulo === 'SLA' &&
                                        ['bug', 'sub-bug', 'sub bug', 'subbug'].includes(
                                          (demandaSelecionada.issue_type ?? '')
                                            .trim()
                                            .toLocaleLowerCase('pt-BR')
                                        )
                                      }
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </details>
                  </div>


                  <div className="iteracao-detail-section">
                    <h4>Vínculos de QA</h4>
                    {(demandaSelecionada.qa_relationships ?? []).length ? (
                      <div className="iteracao-detail-relations">
                        {demandaSelecionada.qa_relationships!.map(relacao => (
                          <div
                            className="iteracao-detail-relation"
                            key={`${relacao.key}-${relacao.relationship}`}
                          >
                            <button
                              type="button"
                              disabled={!mapaDemandas.has(relacao.key)}
                              onClick={() => setSelecionada(relacao.key)}
                            >
                              {relacao.key}
                            </button>
                            <span>
                              {relacao.relationship === 'tests_story'
                                ? 'Testa a História'
                                : relacao.relationship === 'test_plan'
                                  ? 'Test Plan associado'
                                  : relacao.relationship}
                              {' · '}
                              Origem: {relacao.sources.join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="revisao-jira-estado-vazio">
                        <Info size={15} aria-hidden="true" />
                        <span>Nenhum vínculo de QA identificado para esta demanda.</span>
                      </div>
                    )}
                  </div>

                  <div className="iteracao-detail-section">
                    <h4>Relacionamentos Jira</h4>
                    {demandaSelecionada.relationships.length ? (
                      <div className="iteracao-detail-relations">
                        {demandaSelecionada.relationships.map((relacao, indice) => (
                          <div
                            className="iteracao-detail-relation"
                            key={`${relacao.origem}-${relacao.destino}-${indice}`}
                          >
                            <div className="revisao-jira-relacionamento">
                              <span className="revisao-jira-chave">{relacao.origem}</span>
                              <span className="revisao-jira-seta" aria-label="relacionado a">→</span>
                              <span className="revisao-jira-chave">{relacao.destino}</span>
                              <span className="revisao-jira-relacionamento-tipo">
                                {relacao.tipo?.toLocaleLowerCase('pt-BR') === 'parent' &&
                                relacao.direcao?.toLocaleLowerCase('pt-BR') === 'ancestral'
                                  ? 'Demanda ancestral'
                                  : `${relacao.tipo} · ${relacao.direcao}`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="iteracao-note">
                        Nenhum relacionamento informado.
                      </p>
                    )}
                  </div>

                  {demandaSelecionada.url && (
                    <div className="iteracao-detail-footer">
                      <a
                        href={demandaSelecionada.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir demanda no Jira <ExternalLink size={14} />
                      </a>
                    </div>
                  )}
                </div>

              )}
              <p className="iteracao-note" style={{ marginTop: 18 }}>
                As decisões individuais são salvas no QualityHub e
                preservadas no registro da consolidação.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

export default RevisaoDados
