import { iniciaisPerfil, usePerfilLocal } from '../services/perfilLocal'
import GovernancaCockpit from './GovernancaCockpit'
import QualityHubMark from './QualityHubMark'
import { useAtualizacoes, VERSAO_ATUAL } from '../services/useAtualizacoes'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import EstadoConsulta from './EstadoConsulta'
import ToastSincronizacao from './ToastSincronizacao'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Snowflake,
  Tag,
  Download,
  ArrowRight,
  AlertCircle,
  Bug,
  CalendarRange,
  ChartNoAxesCombined,
  ClipboardCheck,
  Network,
  LogOut,
  SunMoon,
  CheckCircle2,
  RotateCcw,
  Settings2,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { Tema } from '../App'
import {
  consultarSprintAtiva,
  ativarSprintAtiva,
  concluirSprintAtiva,
  congelarSprintAtiva,
  reativarSprintAtiva,
  consultarIndicadoresSprintAtiva,
  consultarAtencoesSprintAtiva,
  consultarEvolucaoSprint,
  consultarHistoricoMudancasSprint,
  sincronizarSprintAtiva,
} from '../services/sprintAtivaService'

import type {
} from '../services/sprintAtivaService'
import '../styles/base/MeuQualityHub.css'
import '../styles/base/MeuQualityHubHome.css'
import Cockpit from '../pages/Cockpit'
import Rastreabilidade from '../pages/Rastreabilidade'
import ResultadoAtualizacao from '../pages/ResultadoAtualizacao'
import { consultarRastreabilidade } from '../services/sprintAtivaService'
import type { RastreabilidadeSprint } from '../services/sprintAtivaService'
import RelatorioROT from '../pages/RelatorioROT'
import '../styles/pages/Cockpit.css'
import '../styles/base/QualityHubSidebar.css'

type MeuQualityHubProps = {
  onSair: () => void
  tema: Tema
  onAlterarTema: (tema: Tema) => void
  secao?: 'inicio' | 'central-revisao' | 'projetos' | 'rastreabilidade'
  onMudarSecao?: (
    secao: 'inicio' | 'central-revisao' | 'projetos' | 'rastreabilidade'
  ) => void
  tituloPagina?: string
  descricaoPagina?: string
  children?: React.ReactNode
  onAbrirAtualizacoes?: () => void
  exibindoAtualizacoes?: boolean
}

const modulos = [
  { nome: 'Meu Quality Hub', icone: ChartNoAxesCombined, ativo: true },
  { nome: 'Central de Revisão', icone: ClipboardCheck, ativo: true },
  { nome: 'Análise de Defeitos', icone: Bug, ativo: false },
  { nome: 'Rastreabilidade', icone: Network, ativo: true },
  { nome: 'Planejamento', icone: CalendarRange, ativo: false },
]

function MeuQualityHub({
  onSair,
  tema,
  onAlterarTema,
  secao = 'inicio',
  onMudarSecao,
  descricaoPagina,
  children,
  onAbrirAtualizacoes,
  exibindoAtualizacoes = false,
}: MeuQualityHubProps) {
  const atualizacoes = useAtualizacoes()
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [erroOperacaoResumo, setErroOperacaoResumo] = useState<string | null>(null)
  const [recarregarResumo, setRecarregarResumo] = useState(0)
  // O shell continua montado ao navegar: revisões podem ter sido consolidadas
  // na Central desde a última visita à home.
  const consultaResumo = useConsultaRecurso('resumo', consultarSprintAtiva, JSON.stringify([secao, recarregarResumo]))
  const panorama = consultaResumo.dados
  const carregandoResumo = consultaResumo.status === 'carregando'
  const erroResumo = erroOperacaoResumo ?? consultaResumo.erro
  const [recarregarIndicadores, setRecarregarIndicadores] = useState(0)
  const [sincronizandoSprint, setSincronizandoSprint] = useState(false)
  const [erroSincronizacao, setErroSincronizacao] = useState<{ cicloId: string; texto: string } | null>(null)
  const [mensagemSincronizacao, setMensagemSincronizacao] = useState<{ cicloId: string; texto: string } | null>(null)
  const avisoSincronizacao = useRef(0)
  const fecharMensagemSincronizacao = useCallback(() => {
    avisoSincronizacao.current++
    setMensagemSincronizacao(null)
  }, [])
  function mudarSecao(destino: Parameters<NonNullable<typeof onMudarSecao>>[0]) {
    fecharMensagemSincronizacao()
    onMudarSecao?.(destino)
  }
  const { perfil: perfilLocal } = usePerfilLocal()
  const nomePerfil = perfilLocal?.nome || perfilLocal?.email || 'Meu perfil'
  const avatarPerfil = iniciaisPerfil(perfilLocal?.nome || '')
  const cicloConsulta = secao === 'inicio' ? panorama?.ativa?.id ?? null : null
  const consultaIndicadores = useConsultaRecurso(cicloConsulta, consultarIndicadoresSprintAtiva, recarregarIndicadores)
  const indicadores = consultaIndicadores.dados
  const carregandoIndicadores = consultaIndicadores.status === 'carregando'

  const consultaAtencoes = useConsultaRecurso(cicloConsulta, consultarAtencoesSprintAtiva, recarregarIndicadores)
  const consultaEvolucao = useConsultaRecurso(cicloConsulta, consultarEvolucaoSprint, recarregarIndicadores)
  const consultaMudancas = useConsultaRecurso(cicloConsulta, consultarHistoricoMudancasSprint, recarregarIndicadores)
  const atencoes = consultaAtencoes.dados

  const [rastro, setRastro] = useState<RastreabilidadeSprint | null>(null)
  const [erroRastro, setErroRastro] = useState<string | null>(null)
  const [versaoRastro, setVersaoRastro] = useState(0)
  const [popupRastro, setPopupRastro] = useState<string | null>(null)
  const cicloAtivo = panorama?.ativa?.id
  const rastroAtual = rastro?.ciclo_id === cicloAtivo ? rastro : null
  useEffect(() => {
    if (!cicloAtivo) return
    let atual = true
    consultarRastreabilidade(cicloAtivo)
      .then(dados => { if (atual) { setRastro(dados); setErroRastro(null) } })
      .catch(e => { if (atual) setErroRastro(e instanceof Error ? e.message : 'Falha ao carregar decisões.') })
    return () => { atual = false }
  }, [cicloAtivo, versaoRastro])
  const atualizarRastro = (dados: RastreabilidadeSprint) => {
    setRastro(dados)
    setRecarregarIndicadores(v => v + 1)
  }
  const sincronizarDados = async () => {
    const cicloId = panorama?.ativa?.id
    if (!cicloId || sincronizandoSprint) return
    setSincronizandoSprint(true)
    setErroSincronizacao(null)
    setMensagemSincronizacao(null)
    const avisoAtual = avisoSincronizacao.current
    try {
      const resultado = await sincronizarSprintAtiva(cicloId)
      if (avisoAtual === avisoSincronizacao.current) {
        setMensagemSincronizacao({ cicloId, texto: `Jira atualizado: ${resultado.total_demandas} demandas · ${new Date(resultado.atualizado_em).toLocaleString('pt-BR')}` })
        setPopupRastro(resultado.pendentes > 0 ? cicloId : null)
      }
      setRecarregarIndicadores(valor => valor + 1)
      setVersaoRastro(v => v + 1)
    } catch (erro) {
      setErroSincronizacao({ cicloId, texto: erro instanceof Error ? erro.message : 'Não foi possível sincronizar.' })
    } finally {
      setSincronizandoSprint(false)
    }
  }
  const [cienciaPendencias, setCienciaPendencias] = useState(false)
  const [operando, setOperando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<{ tipo: 'ativar' | 'reativar' | 'concluir' | 'congelar' | 'retomar'; id: string; nome: string } | null>(null)

  async function confirmarOperacao() {
    if (!confirmacao || operando) return
    setOperando(true)
    setErroOperacaoResumo(null)
    try {
      if (confirmacao.tipo === 'concluir') {
        if (rastroAtual?.pendentes && !cienciaPendencias) throw new Error('Confirme ciência das pendências para concluir.')
        await concluirSprintAtiva(confirmacao.id, cienciaPendencias, rastroAtual?.versao)
        setCienciaPendencias(false)
      }
      else if (confirmacao.tipo === 'congelar') await congelarSprintAtiva(confirmacao.id)
      else if (confirmacao.tipo === 'reativar') await reativarSprintAtiva(confirmacao.id)
      else await ativarSprintAtiva(confirmacao.id)
      setErroSincronizacao(null)
      setMensagemSincronizacao(null)
      setConfirmacao(null)
      setRecarregarResumo(valor => valor + 1)
    } catch (erro) {
      setErroOperacaoResumo(erro instanceof Error ? erro.message : 'Não foi possível realizar a operação.')
      setConfirmacao(null)
    } finally { setOperando(false) }
  }

  const [sidebarRecolhida, setSidebarRecolhida] = useState(() => {
    return localStorage.getItem('qualityhub-sidebar-recolhida') === 'true'
  })

  function alternarSidebar() {
    setSidebarRecolhida(atual => {
      const novoEstado = !atual

      localStorage.setItem(
        'qualityhub-sidebar-recolhida',
        String(novoEstado),
      )

      return novoEstado
    })
  }

  useEffect(() => {
    if (!menuAberto) return

    function tratarCliqueFora(evento: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(evento.target as Node)
      ) {
        setMenuAberto(false)
      }
    }

    function tratarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setMenuAberto(false)
      }
    }

    document.addEventListener('mousedown', tratarCliqueFora)
    document.addEventListener('keydown', tratarTecla)

    return () => {
      document.removeEventListener('mousedown', tratarCliqueFora)
      document.removeEventListener('keydown', tratarTecla)
    }
  }, [menuAberto])

  const [rotAberto, setRotAberto] = useState(false)

  return (
    <div
      className={`hub-layout ${sidebarRecolhida ? 'hub-layout-collapsed' : ''
        }`}
    >
      <aside className="hub-sidebar">
        <div className="hub-brand">
          <div className="hub-brand-identity">
            <QualityHubMark size={29} />

            {!sidebarRecolhida && (
              <div className="hub-brand-text">
                <strong>
                  Quality <span className="hub-brand-highlight">Hub</span>
                </strong>
                <span>QUALITY INTELLIGENCE</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="hub-sidebar-toggle"
            onClick={alternarSidebar}
            aria-label={
              sidebarRecolhida
                ? 'Expandir menu lateral'
                : 'Recolher menu lateral'
            }
            aria-expanded={!sidebarRecolhida}
            title={
              sidebarRecolhida
                ? 'Expandir menu'
                : 'Recolher menu'
            }
          >
            {sidebarRecolhida ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
        </div>

        <div className="hub-nav-label">ESPAÇO DE TRABALHO</div>

        <nav className="hub-nav" aria-label="Navegação principal">
          {modulos.map(({ nome, icone: Icone, ativo }) => (
            <button
              key={nome}
              type="button"
              className={`hub-nav-item ${(
                (nome === 'Meu Quality Hub' && secao === 'inicio') || (nome === 'Rastreabilidade' && secao === 'rastreabilidade') ||
                (nome === 'Central de Revisão' &&
                  secao === 'central-revisao')
              ) ? 'active' : ''
                }`}
              disabled={!ativo || (nome === 'Rastreabilidade' && !panorama?.ativa)}
              aria-current={((nome === 'Meu Quality Hub' && secao === 'inicio') || (nome === 'Rastreabilidade' && secao === 'rastreabilidade') || (nome === 'Central de Revisão' && secao === 'central-revisao')) ? 'page' : undefined}
              onClick={() => {
                if (nome === 'Rastreabilidade') {
                  mudarSecao('rastreabilidade')
                } else if (nome === 'Meu Quality Hub') {
                  mudarSecao('inicio')
                } else if (nome === 'Central de Revisão') {
                  mudarSecao('central-revisao')
                }
              }}
              title={
                nome === 'Rastreabilidade' && !panorama?.ativa
                  ? 'Ative uma sprint para acessar a Rastreabilidade'
                  : !ativo
                  ? `${nome} — Disponível nas próximas etapas`
                  : sidebarRecolhida
                    ? nome
                    : undefined
              }
              aria-label={nome === 'Rastreabilidade' && rastroAtual?.pendentes ? `${nome}: ${rastroAtual.pendentes} decisões pendentes` : nome}
            >
              <Icone size={19} />
              <span>{nome}</span>{nome === 'Rastreabilidade' && !!rastroAtual?.pendentes && <i className="qh-rastro-badge" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <div className="hub-sidebar-footer">
          <button type="button" className="hub-sidebar-appearance"
            onClick={() => onAlterarTema((tema === 'escuro' || (tema === 'automatico' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? 'claro' : 'escuro')}
            aria-label="Alternar aparência entre tema claro e escuro"
            title="Alternar aparência: Claro / Escuro">
            <SunMoon size={18} /><span>Aparência</span><small>Claro / Escuro</small>
          </button>

            <div className="hub-profile-container hub-sidebar-profile" ref={menuRef}>
              <button
                type="button"
                className={`hub-user hub-profile-trigger ${menuAberto ? 'menu-open' : ''
                  }`}
                onClick={() => setMenuAberto((aberto) => !aberto)}
                aria-expanded={menuAberto}
                aria-haspopup="true"
                aria-label="Abrir menu do perfil"
                title={sidebarRecolhida ? "Perfil e preferências" : undefined}
              >
                <div className="hub-avatar">{avatarPerfil}</div>

                {!sidebarRecolhida && <div className="hub-user-info">
                  <strong>{nomePerfil}</strong>
                  <span>{perfilLocal?.cargo || 'Quality Hub'}</span>
                </div>}

                {!sidebarRecolhida && <ChevronsUpDown
                  className="hub-profile-chevron"
                  size={16}
                />}
              </button>

              {menuAberto && (
                <div className="hub-profile-menu">
                  <div className="hub-profile-menu-header">
                    <div className="hub-avatar">{avatarPerfil}</div>
                    <div className="hub-user-info">
                      <strong>{nomePerfil}</strong>
                      <span>{perfilLocal?.cargo || 'Quality Hub'}</span>
                    </div>
                  </div>

                  <div className="hub-menu-divider" />

                  <button
                    type="button"
                    className="hub-profile-menu-item"
                    onClick={() => { setMenuAberto(false); mudarSecao('projetos') }}
                  >
                    <Settings2 size={17} />
                    <span>Configurações</span>
                    </button>

                  <button
                    type="button"
                    className="hub-profile-menu-item hub-profile-logout"
                    onClick={onSair}
                  >
                    <LogOut size={17} />
                    <span>Sair do Quality Hub</span>
                  </button>
                </div>
              )}
            </div>
          <button type="button" className={`hub-environment hub-version${atualizacoes.disponivel ? ' has-update' : ''}`} title={`QualityHub v${VERSAO_ATUAL}${atualizacoes.disponivel ? ' · Nova versão disponível' : ''}`} aria-label={`Versão ${VERSAO_ATUAL}. ${atualizacoes.disponivel ? 'Nova versão disponível. ' : ''}Abrir atualizações`} onClick={() => { fecharMensagemSincronizacao(); onAbrirAtualizacoes?.() }}>
            <Tag size={14} /><span>v{VERSAO_ATUAL}</span>{atualizacoes.disponivel && <i className="hub-update-dot" aria-hidden="true" />}
          </button>
        </div>
      </aside>

      <main className={`hub-main${secao === 'rastreabilidade' ? ' hub-main-trace' : ''}`}>
        {atualizacoes.disponivel && !exibindoAtualizacoes && <div className="hub-update-notice" role="status"><Download size={17} /><div><strong>Nova versão disponível: v{atualizacoes.ultimaVersao?.versao}</strong><span>Confira as novidades do QualityHub.</span></div><button type="button" onClick={() => { fecharMensagemSincronizacao(); onAbrirAtualizacoes?.() }}>Ver atualização <ArrowRight size={13} /></button></div>}
        {secao !== 'rastreabilidade' && secao !== 'projetos' && <header className="hub-header">
          <div>
            <h1>
              {secao === 'central-revisao'
                ? 'Central de Revisão'
                : 'Meu Quality Hub'}
            </h1>
            <p>
              {descricaoPagina ?? 'Gerencie suas análises de qualidade e acompanhe suas entregas.'}
            </p>
          </div>

        </header>}


        {secao === 'rastreabilidade' ? panorama?.ativa ? <Rastreabilidade
          key={panorama.ativa.id} cicloId={panorama.ativa.id} nome={`${panorama.ativa.project_key} / ${panorama.ativa.team_name} · ${panorama.ativa.sprint_name}`}
          dados={rastroAtual} erro={erroRastro} ocupado={sincronizandoSprint}
          recarregar={() => setVersaoRastro(v => v + 1)} sincronizar={() => void sincronizarDados()}
          atualizado={atualizarRastro} fechar={() => mudarSecao('inicio')} />
          : carregandoResumo || erroResumo ? <EstadoConsulta titulo="Rastreabilidade" consulta={{ ...consultaResumo, tentarNovamente: () => setRecarregarResumo(v => v + 1) }} />
          : <section className="hub-home-feedback"><h2>Rastreabilidade</h2><p>Ative uma sprint para acompanhar demandas, testes e defeitos.</p><button type="button" onClick={() => mudarSecao('inicio')}>Ir para Meu Quality Hub</button></section>
          : secao === 'central-revisao' || secao === 'projetos' ? children : (
          <div className="hub-home">
            {carregandoResumo && !panorama ? (
              <div className="hub-home-feedback" role="status">
                Consultando sprints...
              </div>
            ) : erroResumo ? (
              <div className="hub-home-feedback hub-home-feedback--consulta">
                <AlertCircle size={22} />
                <EstadoConsulta titulo="Meu Quality Hub"
                  orientacao={/fetch|network|load failed/i.test(erroResumo)
                    ? 'Verifique se o backend está em execução e se as requisições não estão bloqueadas. Depois, tente novamente.'
                    : erroResumo}
                  consulta={{ status: 'erro', dados: null, erro: erroResumo, tentarNovamente: () => { setErroOperacaoResumo(null); consultaResumo.tentarNovamente() } }} />
              </div>
            ) : panorama?.ativa ? (
              <section className="hub-home-dashboard">
                {rotAberto && indicadores && <RelatorioROT sprint={panorama.ativa} indicadores={indicadores} atencoes={atencoes} fechar={() => setRotAberto(false)} />}
                <Cockpit
                  key={panorama.ativa.id}
                  abrirRot={() => setRotAberto(true)}
                  sprint={panorama.ativa}
                  consultaIndicadores={consultaIndicadores}
                  consultaAtencoes={consultaAtencoes}
                  consultaEvolucao={consultaEvolucao}
                  consultaMudancas={consultaMudancas}
                  referenciaConsulta={recarregarIndicadores}
                  falhaRastreabilidade={erroRastro ? { repetir: () => { setErroRastro(null); setVersaoRastro(v => v + 1) } } : undefined}
                  carregando={carregandoIndicadores || sincronizandoSprint}
                  sincronizar={sincronizarDados}

                />
                {sincronizandoSprint && <p className="hub-home-indicators-message" role="status">Sincronizando dados do Jira...</p>}
                {erroSincronizacao?.cicloId === panorama.ativa.id && <p className="hub-home-indicators-message" role="alert">Sincronização não aplicada: {erroSincronizacao.texto}</p>}
                <GovernancaCockpit key={`governanca-${panorama.ativa.id}`} cicloId={panorama.ativa.id} referencia={recarregarIndicadores} />
                <div className="hub-home-actions">
                  <button
                    type="button"
                    className="hub-primary-button"
                    onClick={() =>
                      setConfirmacao({
                        tipo: 'concluir',
                        id: panorama.ativa!.id,
                        nome: panorama.ativa!.sprint_name,
                      })
                    }
                  >
                    Concluir sprint
                    <CheckCircle2 size={17} />
                  </button>

                  <button
                    type="button"
                    className="hub-home-secondary"
                    onClick={() => setConfirmacao({ tipo: 'congelar', id: panorama.ativa!.id, nome: panorama.ativa!.sprint_name })}
                  >
                    Congelar sprint
                    <Snowflake size={17} />
                  </button>
                </div>
              </section>

            ) : panorama ? (
              <section className="hub-home-dashboard hub-home-selecao">
                <div className="hub-home-heading">
                  <div>
                    <span className="hub-section-label">
                      ACOMPANHAMENTO DE QUALIDADE
                    </span>
                    <h2>Acompanhamento de sprints</h2>
                    <p>
                      Selecione uma sprint para iniciar ou retomar
                      o acompanhamento operacional.
                    </p>
                  </div>
                </div>

                <div className="hub-home-sprints-panel">
                  <div className="hub-home-list">
                    <div className="hub-home-list-heading">
                      <div>
                        <h3>Disponíveis para ativação</h3>
                        <p>
                          Revisões consolidadas disponíveis para acompanhamento.
                        </p>
                      </div>

                      <span className="hub-home-count">
                        {panorama.disponiveis.length}
                      </span>
                    </div>

                    {panorama.disponiveis.length === 0 && (
                      <p className="hub-home-empty">
                        Nenhuma sprint consolidada aguardando ativação.
                      </p>
                    )}

                    {panorama.disponiveis.map(item => (
                      <div key={item.id} className="hub-home-iteration">
                        <ClipboardCheck size={19} />

                        <span>
                          <strong>{item.sprint_name}{item.congelada_em && <span className="hub-frozen-badge"><Snowflake size={12} />Congelada</span>}</strong>
                          <small>
                            {item.project_key} · {item.team_name}
                          </small>
                          {item.congelada_em && <small>
                            Congelada em <time dateTime={item.congelada_em}>{new Date(item.congelada_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                          </small>}
                        </span>

                        <button
                          type="button"
                          className="hub-home-secondary"
                          disabled={operando}
                          onClick={() =>
                            setConfirmacao({
                              tipo: item.congelada_em ? 'retomar' : 'ativar',
                              id: item.id,
                              nome: item.sprint_name,
                            })
                          }
                        >
                          {item.congelada_em ? 'Retomar' : 'Ativar'}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="hub-home-list hub-home-list-concluidas">
                    <div className="hub-home-list-heading">
                      <div>
                        <h3>Sprints concluídas</h3>
                        <p>
                          Acompanhamentos encerrados que podem ser retomados.
                        </p>
                      </div>

                      <span className="hub-home-count">
                        {panorama.concluidas.length}
                      </span>
                    </div>

                    {panorama.concluidas.length === 0 && (
                      <p className="hub-home-empty">
                        Nenhum acompanhamento operacional concluído.
                      </p>
                    )}

                    {panorama.concluidas.map(item => (
                      <div key={item.id} className="hub-home-iteration">
                        <CheckCircle2 size={19} />

                        <span>
                          <strong>{item.sprint_name}</strong>
                          <small>
                            {item.project_key} · {item.team_name} ·{' '}
                            {item.total_ciclos} ciclo(s) concluído(s)
                          </small>
                        </span>

                        <button
                          type="button"
                          className="hub-home-secondary"
                          disabled={operando}
                          onClick={() =>
                            setConfirmacao({
                              tipo: 'reativar',
                              id: item.id,
                              nome: item.sprint_name,
                            })
                          }
                        >
                          <RotateCcw size={15} />
                          Reativar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="hub-home-callout hub-home-review-link">
                  <div>
                    <ClipboardCheck size={21} />

                    <div>
                      <h3>Precisa preparar outra sprint?</h3>
                      <p>
                        Acesse a Central de Revisão para preparar
                        uma nova sprint ou consultar suas revisões.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="hub-home-secondary"
                    onClick={() => mudarSecao('central-revisao')}
                  >
                    Ir para Central de Revisão
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {confirmacao && (
              <div
                className="hub-home-modal-overlay"
                role="presentation"
                onMouseDown={evento => {
                  if (evento.target === evento.currentTarget && !operando) {
                    setConfirmacao(null)
                  }
                }}
              >
                <div
                  className="hub-home-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="hub-home-modal-title"
                >
                  <h3 id="hub-home-modal-title">
                    {confirmacao.tipo === 'congelar' ? 'Congelar sprint?' : confirmacao.tipo === 'retomar' ? 'Retomar sprint congelada?' : confirmacao.tipo === 'concluir'
                      ? 'Concluir sprint ativa?'
                      : confirmacao.tipo === 'reativar'
                        ? 'Reativar sprint?'
                        : 'Ativar sprint?'}
                  </h3>

                  <p>
                    <strong>{confirmacao.nome}</strong>
                  </p>

                  <p>
                    {confirmacao.tipo === 'congelar' ? 'A sprint voltará para Disponíveis para ativação como congelada. Você poderá ativar outra e retomar este mesmo ciclo depois, preservando dados, notas e histórico. O calendário e os prazos de SLA continuam correndo.' : confirmacao.tipo === 'retomar' ? 'O mesmo ciclo será retomado com os dados e o histórico preservados, sem nova extração automática.' : confirmacao.tipo === 'concluir'
                      ? 'O ciclo atual será encerrado e preservado no histórico. A sprint poderá ser reativada depois.'
                      : confirmacao.tipo === 'reativar'
                        ? 'A sprint voltará para Disponíveis para ativação, sem iniciar um novo ciclo. O histórico anterior será preservado.'
                        : 'O acompanhamento operacional será iniciado a partir da revisão consolidada, sem nova extração automática.'}
                  </p>

                  {confirmacao.tipo === 'concluir' && !!rastroAtual?.pendentes && <label>
                    <input type="checkbox" checked={cienciaPendencias} onChange={e => setCienciaPendencias(e.target.checked)} />
                    Estou ciente das {rastroAtual.pendentes} pendências. Concluir preservando decisões e ressalvas, sem aprovar candidatas.
                  </label>}
                  <div className="hub-home-modal-actions">
                    <button
                      type="button"
                      className="hub-home-secondary"
                      disabled={operando}
                      onClick={() => setConfirmacao(null)}
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      className="hub-primary-button"
                      disabled={operando}
                      onClick={() => void confirmarOperacao()}
                    >
                      {operando ? 'Processando...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {popupRastro && popupRastro === panorama?.ativa?.id && <dialog className="qh-rastro-modal qh-update-dialog" aria-labelledby="qh-update-title"
          ref={node => { if (node && !node.open) node.showModal() }} onCancel={() => setPopupRastro(null)}>
          <ResultadoAtualizacao key={`${popupRastro}-popup`} cicloId={popupRastro} nome={panorama.ativa.sprint_name}
            dados={rastroAtual} erro={erroRastro} ocupado={sincronizandoSprint}
            recarregar={() => setVersaoRastro(v => v + 1)} sincronizar={() => void sincronizarDados()}
            atualizado={atualizarRastro} fechar={() => setPopupRastro(null)} />
        </dialog>}
        {secao === 'inicio' && mensagemSincronizacao && mensagemSincronizacao.cicloId === panorama?.ativa?.id && !popupRastro && (
          <ToastSincronizacao texto={mensagemSincronizacao.texto} onFechar={fecharMensagemSincronizacao} />
        )}
        <footer className="hub-page-footer">
          <span>Quality Hub</span>
          <span>Plataforma integrada de qualidade de software</span>
        </footer>
      </main>
    </div>
  )
}

export default MeuQualityHub
