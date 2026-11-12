import { useEffect, useMemo, useRef, useState } from 'react'
import { API_URL, apiFetch } from '../services/api'
import {
  ArrowLeft,
  House,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  GitBranch,
  Search,
  ShieldCheck,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import '../styles/patterns/QualityHubNavigation.css'
import {
  criarIteracao,
} from '../services/iterationService'

type NovaIteracaoProps = {
  onVoltar: () => void
  onAbrirRevisaoDados: () => void
}

type Projeto = {
  id: number
  chave: string
  nome: string
}

type Time = {
  id: number
  nome: string
  projetosIds: number[]
}

type Sprint = {
  id: string | number
  name: string
  state?: string
}

type Quarter = {
  field_id: string
  name: string
}

type Filtros = {
  issues_analyzed: number
  sprints: Sprint[]
  quarters: Quarter[]
  discovery: {
    quarter_note: string
    scope: string
  }
  sprint_quarters?: Record<string, string[]>
}

type Relacao = {
  origem: string
  destino: string
  tipo: string
  direcao: string
}

type RelacaoQA = {
  key: string
  relationship: string
  sources: string[]
}


export type IndicadoresAssertThat = {
  total: number
  passed: number
  failed: number
  not_run: number
  in_progress: number
  manual: number
  automated: number
  passed_manual: number
  passed_auto: number
  failed_manual: number
  failed_auto: number
  not_run_manual: number
  not_run_auto: number
  in_progress_manual: number
  in_progress_auto: number
  avg_times_passed?: number
  avg_times_failed?: number
  avg_times_passed_manual?: number
  avg_times_passed_auto?: number
  avg_times_failed_manual?: number
  avg_times_failed_auto?: number
  tags?: string
  status?: string
  status_ind?: number
}


export type Demanda = {
  id: string
  key: string
  summary: string
  issue_type: string
  status: string | null
  parent_key: string | null
  scope: 'direct' | 'traceability' | 'manual_lookup'
  included_in_metrics: boolean
  relationships: Relacao[]
  qa_relationships?: RelacaoQA[]
  assertthat?: IndicadoresAssertThat | null
  priority?: string | { name?: string } | null
  assignee?: string | { displayName?: string; name?: string } | null
  reporter?: string | { displayName?: string; name?: string } | null
  created?: string | null
  resolved?: string | null
  inclusion_reasons?: string[]
  url: string | null
}

type Extracao = {
  status: string
  project_key: string
  team_name: string
  total: number
  total_direct: number
  total_traceability: number
  qa_links_total?: number
  issues: Demanda[]
  traceability: {
    complete: boolean
    limit_reached: boolean
    unresolved_keys: string[]
    incomplete_queries?: string[]
  }
  review_required: boolean
}

function identificadorQuarter(quarter: Quarter): string {
  return `${quarter.field_id}:${quarter.name}`
}

type MultiselecaoProps = {
  titulo: string
  opcoes: { valor: string; nome: string }[]
  selecionados: string[]
  onChange: (valores: string[]) => void
  vazio: string
  disabled?: boolean
}

function Multiselecao({
  titulo,
  opcoes,
  selecionados,
  onChange,
  vazio,
  disabled = false,
}: MultiselecaoProps) {
  const [aberto, setAberto] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return

    function fecharAoClicarFora(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setAberto(false)
      }
    }

    function fecharComEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAberto(false)
    }

    document.addEventListener('pointerdown', fecharAoClicarFora)
    document.addEventListener('keydown', fecharComEscape)

    return () => {
      document.removeEventListener('pointerdown', fecharAoClicarFora)
      document.removeEventListener('keydown', fecharComEscape)
    }
  }, [aberto])

  function alternar(valor: string) {
    onChange(
      selecionados.includes(valor)
        ? selecionados.filter(item => item !== valor)
        : [...selecionados, valor]
    )
  }

  return (
    <div className="iteracao-multiselect" ref={containerRef}>
      <span className="iteracao-multiselect-label">{titulo}</span>
      <div className="iteracao-multiselect-details">
        <button
          type="button"
          className="iteracao-multiselect-trigger"
          aria-expanded={aberto}
          disabled={disabled}
          onClick={() => setAberto(valor => !valor)}
        >
          <span>
            {selecionados.length
              ? `${selecionados.length} selecionado(s)`
              : vazio}
          </span>
          <ChevronDown size={16} />
        </button>

        {aberto && (
          <div className="iteracao-multiselect-dropdown">
            <div className="iteracao-multiselect-options">
              {opcoes.length ? opcoes.map(opcao => (
                <button
                  key={opcao.valor}
                  type="button"
                  className="iteracao-multiselect-option"
                  role="checkbox"
                  aria-checked={selecionados.includes(opcao.valor)}
                  onClick={() => alternar(opcao.valor)}
                >
                  <input
                    type="checkbox"
                    checked={selecionados.includes(opcao.valor)}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ pointerEvents: 'none' }}
                  />
                  <span>{opcao.nome}</span>
                </button>
              )) : (
                <p className="iteracao-note">
                  Nenhuma opção disponível.
                </p>
              )}
            </div>

            {selecionados.length > 0 && (
              <div className="iteracao-multiselect-footer">
                <span>{selecionados.length} selecionado(s)</span>
                <button
                  type="button"
                  className="iteracao-multiselect-clear"
                  onClick={() => onChange([])}
                >
                  Limpar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function tipoNormalizado(tipo: string) {
  return (tipo || '').trim().toLocaleLowerCase('pt-BR')
}

function ehHistoria(tipo: string) {
  return ['história', 'historia', 'story', 'user story']
    .includes(tipoNormalizado(tipo))
}

function ehTP(tipo: string) {
  return ['assertthat test plan', 'test plan', 'testplan', 'tp']
    .includes(tipoNormalizado(tipo))
}

type ConsultaJira = {
  status: string
  query_key: string
  total: number
  issues: Demanda[]
  traceability: Extracao['traceability']
}

type DemandaManual = Demanda & {
  review?: {
    decision?: string
    inclusion_type?: 'explicit' | 'ancestor'
  }
}

function ConsultaManualJira({
  extracao,
  adicionadas,
  setAdicionadas,
  onRemover,
}: {
  extracao: Extracao
  adicionadas: Record<string, DemandaManual>
  setAdicionadas: React.Dispatch<
    React.SetStateAction<Record<string, DemandaManual>>
  >
  onRemover: (key: string) => void
}) {
  const [chave, setChave] = useState('')
  const [consultando, setConsultando] = useState(false)
  const consultaManualRef = useRef<AbortController | null>(null)
  const [erroConsulta, setErroConsulta] = useState('')
  const [resultado, setResultado] = useState<ConsultaJira | null>(null)
  const [selecionadas, setSelecionadas] = useState<string[]>([])

  const existentes = useMemo(
    () => new Set(extracao.issues.map(i => i.key)),
    [extracao]
  )

  const demandasManuaisOrdenadas = useMemo(() => {
    const issues = Object.values(adicionadas)
    const mapa = new Map(issues.map(issue => [issue.key, issue]))
    const filhos = new Map<string, DemandaManual[]>()

    for (const issue of issues) {
      if (issue.parent_key && mapa.has(issue.parent_key)) {
        const lista = filhos.get(issue.parent_key) ?? []
        lista.push(issue)
        filhos.set(issue.parent_key, lista)
      }
    }

    const ordenar = (a: DemandaManual, b: DemandaManual) =>
      a.key.localeCompare(b.key)

    for (const lista of filhos.values()) {
      lista.sort(ordenar)
    }

    const raizes = issues
      .filter(issue => !issue.parent_key || !mapa.has(issue.parent_key))
      .sort((a, b) => {
        const aEpic = tipoNormalizado(a.issue_type) === 'epic'
        const bEpic = tipoNormalizado(b.issue_type) === 'epic'

        if (aEpic !== bEpic) return aEpic ? -1 : 1
        return ordenar(a, b)
      })

    const resultado: { issue: DemandaManual; nivel: number }[] = []
    const visitados = new Set<string>()

    function percorrer(issue: DemandaManual, nivel: number) {
      if (visitados.has(issue.key)) return
      visitados.add(issue.key)

      resultado.push({ issue, nivel })

      for (const filho of filhos.get(issue.key) ?? []) {
        percorrer(filho, nivel + 1)
      }
    }

    for (const raiz of raizes) {
      percorrer(raiz, 0)
    }

    // Proteção contra vínculos circulares ou dados inconsistentes.
    for (const issue of [...issues].sort(ordenar)) {
      percorrer(issue, 0)
    }

    return resultado
  }, [adicionadas])

  const [nosAlternadosConsulta, setNosAlternadosConsulta] = useState<string[]>([])

  const hierarquiaConsulta = useMemo(() => {
    const issues = resultado?.issues ?? []
    const mapa = new Map(issues.map(issue => [issue.key, issue]))
    const filhos = new Map<string, Demanda[]>()

    for (const issue of issues) {
      if (
        issue.parent_key &&
        issue.parent_key !== issue.key &&
        mapa.has(issue.parent_key)
      ) {
        const lista = filhos.get(issue.parent_key) ?? []
        lista.push(issue)
        filhos.set(issue.parent_key, lista)
      }
    }

    for (const lista of filhos.values()) {
      lista.sort((a, b) => a.key.localeCompare(b.key))
    }

    const chaveConsultada = resultado?.query_key?.toUpperCase()
    const demandaConsultada = chaveConsultada
      ? mapa.get(chaveConsultada)
      : undefined

    const raizes: Demanda[] = []

    if (demandaConsultada) {
      let atual = demandaConsultada
      const visitados = new Set<string>()

      while (!visitados.has(atual.key)) {
        visitados.add(atual.key)

        const pai = atual.parent_key
          ? mapa.get(atual.parent_key)
          : undefined

        if (!pai || visitados.has(pai.key)) break

        const tipoPai = pai.issue_type.trim().toLocaleLowerCase('pt-BR')

        if (['iniciativa', 'initiative'].includes(tipoPai)) break

        atual = pai
      }

      raizes.push(atual)
    } else {
      raizes.push(
        ...issues
          .filter(issue =>
            !issue.parent_key || !mapa.has(issue.parent_key)
          )
          .sort((a, b) => a.key.localeCompare(b.key))
      )
    }

    const visitadas = new Set<string>()

    function contarDemanda(issue: Demanda) {
      if (visitadas.has(issue.key)) return

      visitadas.add(issue.key)

      for (const filho of filhos.get(issue.key) ?? []) {
        contarDemanda(filho)
      }
    }

    raizes.forEach(contarDemanda)

    return {
      raizes,
      filhos,
      totalExibivel: visitadas.size,
    }
  }, [resultado])

  const ancestraisConsulta = useMemo(() => {
    const issues = resultado?.issues ?? []
    const mapa = new Map(issues.map(issue => [issue.key, issue]))
    const chaveConsultada = resultado?.query_key?.toUpperCase()

    if (!chaveConsultada) return []

    const ancestrais: string[] = []
    const visitados = new Set<string>()
    let atual = mapa.get(chaveConsultada)

    while (
      atual?.parent_key &&
      !visitados.has(atual.parent_key)
    ) {
      const pai = mapa.get(atual.parent_key)
      if (!pai) break

      visitados.add(pai.key)
      ancestrais.push(pai.key)
      atual = pai
    }

    return ancestrais
  }, [resultado])

  const paisSelecionados = useMemo(() => {
    const pais = new Set<string>()
    const mapa = new Map(
      (resultado?.issues ?? []).map(issue => [issue.key, issue])
    )

    for (const key of selecionadas) {
      const visitados = new Set<string>()
      let parentKey = mapa.get(key)?.parent_key

      while (parentKey && !visitados.has(parentKey)) {
        visitados.add(parentKey)

        const pai = mapa.get(parentKey)
        if (!pai) break

        const tipo = pai.issue_type.trim().toLocaleLowerCase('pt-BR')

        if (['iniciativa', 'initiative'].includes(tipo)) break

        pais.add(parentKey)

        if (tipo === 'epic') break

        parentKey = pai.parent_key
      }
    }

    return pais
  }, [resultado, selecionadas])

  const chavesVisiveisConsulta = useMemo(() => {
    const chaves = new Set<string>()

    function percorrer(issue: Demanda) {
      if (chaves.has(issue.key)) return
      chaves.add(issue.key)
      for (const filho of hierarquiaConsulta.filhos.get(issue.key) ?? []) {
        percorrer(filho)
      }
    }

    hierarquiaConsulta.raizes.forEach(percorrer)
    return chaves
  }, [hierarquiaConsulta])

  const chavesSelecionaveis = (resultado?.issues ?? [])
    .filter(issue =>
      chavesVisiveisConsulta.has(issue.key) &&
      !existentes.has(issue.key) &&
      !adicionadas[issue.key]
    )
    .map(issue => issue.key)

  const todosSelecionados = chavesSelecionaveis.length > 0 &&
    chavesSelecionaveis.every(key => selecionadas.includes(key))

  function alternarTodosConsulta() {
    setSelecionadas(todosSelecionados ? [] : chavesSelecionaveis)
  }

  function alternarConsulta(key: string) {
    setNosAlternadosConsulta(anteriores =>
      anteriores.includes(key)
        ? anteriores.filter(item => item !== key)
        : [...anteriores, key]
    )
  }

  function renderizarConsulta(
      issue: Demanda,
      nivel = 0,
      caminho: string[] = []
    ): React.ReactNode {
      if (caminho.includes(issue.key)) return null

      const descendentes = hierarquiaConsulta.filhos.get(issue.key) ?? []
      const abertoAutomaticamente = ancestraisConsulta.includes(issue.key)
      const aberto = nosAlternadosConsulta.includes(issue.key)
        ? !abertoAutomaticamente
        : abertoAutomaticamente
      const jaExtraida = existentes.has(issue.key)
      const jaAdicionada = Boolean(adicionadas[issue.key])
      const paiAutomatico = paisSelecionados.has(issue.key)
      const indisponivel = jaExtraida || jaAdicionada
      const destaque = issue.key === resultado?.query_key?.toUpperCase()

      const situacao = jaExtraida
        ? 'Já extraída'
        : jaAdicionada
          ? adicionadas[issue.key].review?.inclusion_type === 'ancestor'
            ? 'Contexto automático'
            : 'Inclusão manual'
          : paiAutomatico
            ? 'Contexto automático'
            : 'Pendente'

      return (
        <div
          key={issue.key}
          className={`iteracao-tree-node ${
            nivel > 0 ? 'iteracao-tree-node-child' : ''
          }`}
          style={{
            '--tree-connector-left': `${nivel * 24}px`,
          } as React.CSSProperties}
        >
          <div
            className={`iteracao-tree-row iteracao-lookup-row ${
              destaque ? 'iteracao-tree-row-selected' : ''
            }`}
            style={{ paddingLeft: 12 + nivel * 24 }}
          >
            <button
              type="button"
              className="iteracao-tree-expand"
              onClick={() => alternarConsulta(issue.key)}
              disabled={!descendentes.length}
              aria-label={aberto ? `Recolher ${issue.key}` : `Expandir ${issue.key}`}
              aria-expanded={descendentes.length ? aberto : undefined}
            >
              {descendentes.length > 0 && (
                aberto
                  ? <ChevronDown size={16} />
                  : <ChevronRight size={16} />
              )}
            </button>

            <input
              type="checkbox"
              aria-label={`Selecionar ${issue.key}`}
              disabled={indisponivel}
              checked={
                jaAdicionada ||
                selecionadas.includes(issue.key) ||
                paiAutomatico
              }
              onChange={e => {
                setSelecionadas(anteriores =>
                  e.target.checked
                    ? [...new Set([...anteriores, issue.key])]
                    : anteriores.filter(key => key !== issue.key)
                )
              }}
            />

            <div className="iteracao-lookup-content">
              <div className="iteracao-tree-heading">
                <strong>{issue.key}</strong>
                <span className="iteracao-tree-type">{issue.issue_type}</span>
                <span className="iteracao-lookup-status">
                  {issue.status || 'Sem status'}
                </span>
              </div>

              <span className="iteracao-tree-summary" title={issue.summary}>
                {issue.summary}
              </span>

              {(issue.parent_key || issue.url) && (
                <div className="iteracao-lookup-meta">
                  {issue.parent_key && (
                    <span>Parent: {issue.parent_key}</span>
                  )}
                  {issue.url && (
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir no Jira ↗
                    </a>
                  )}
                </div>
              )}
            </div>

            <span className={`iteracao-lookup-tag ${
              situacao === 'Pendente'
                ? 'iteracao-lookup-tag-pending'
                : ''
            }`}>
              {situacao}
            </span>
          </div>

          {aberto && descendentes.map(filho =>
            renderizarConsulta(filho, nivel + 1, [...caminho, issue.key])
          )}
        </div>
      )
    }

  function cancelarConsultaManual() {
    consultaManualRef.current?.abort()
    consultaManualRef.current = null
    setConsultando(false)
  }

  async function consultar() {
    const key = chave.trim().toUpperCase()

    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
      setErroConsulta('Informe uma chave válida, como TECNA-6231.')
      return
    }

    if (consultando || consultaManualRef.current) return

    const controller = new AbortController()
    consultaManualRef.current = controller
    setConsultando(true)
    setErroConsulta('')
    setResultado(null)
    setSelecionadas([])
    setNosAlternadosConsulta([])

    try {
      const resposta = await apiFetch(
        `${API_URL}/jira/issue/lookup`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue_key: key }),
        }
      )

      const dados = await resposta.json()
      if (controller.signal.aborted) return

      if (!resposta.ok) {
        throw new Error(
          typeof dados.detail === 'string'
            ? dados.detail
            : 'Erro na consulta ao Jira.'
        )
      }

      setResultado(dados as ConsultaJira)
    } catch (e) {
      if (!controller.signal.aborted) {
        setErroConsulta(
          e instanceof Error ? e.message : 'Falha ao consultar o Jira.'
        )
      }
    } finally {
      if (consultaManualRef.current === controller) {
        consultaManualRef.current = null
        setConsultando(false)
      }
    }
  }

  function adicionarSelecionadas() {
    if (!resultado) return

    const mapaConsulta = new Map(
      resultado.issues.map(issue => [issue.key, issue])
    )

    const aprovadas = resultado.issues.filter(
      issue =>
        selecionadas.includes(issue.key) &&
        !existentes.has(issue.key)
    )

    setAdicionadas(anteriores => {
      const novos = { ...anteriores }

      function incluirAncestrais(issue: Demanda) {
        const visitados = new Set<string>()
        let parentKey = issue.parent_key

        while (parentKey && !visitados.has(parentKey)) {
          visitados.add(parentKey)

          // Se já existe na extração, não duplicamos.
          if (existentes.has(parentKey)) break

          const pai = mapaConsulta.get(parentKey)

          // Não inventamos dados de um ancestral ausente.
          if (!pai) break

          // A Epic é o limite superior da hierarquia manual.
          const ehEpic =
            pai.issue_type.trim().toLocaleLowerCase('pt-BR') === 'epic'

          // Não incluir Iniciativas ou níveis acima da Epic.
          if (
            ['iniciativa', 'initiative'].includes(
              pai.issue_type.trim().toLocaleLowerCase('pt-BR')
            )
          ) {
            break
          }

          if (!novos[parentKey]) {
            novos[parentKey] = {
              ...pai,
              scope: 'manual_lookup',
              included_in_metrics: false,
              review: {
                decision: 'include',
                inclusion_type: 'ancestor',
              },
              inclusion_reasons: [
                ...(pai.inclusion_reasons || []),
                'manual_lookup_ancestor',
              ],
            }
          }

          if (ehEpic) break

          parentKey = pai.parent_key
        }
      }

      for (const issue of aprovadas) {
        const anterior = novos[issue.key]

        novos[issue.key] = {
          ...issue,
          scope: 'manual_lookup',
          included_in_metrics: false,
          review: {
            decision: 'include',
            inclusion_type: 'explicit',
          },
          inclusion_reasons: [
            ...(issue.inclusion_reasons || []),
            'manual_lookup',
          ],
        }

        // Mesmo se já era contexto automático, passa a ser explícita.
        if (anterior?.review?.inclusion_type === 'ancestor') {
          novos[issue.key].review = {
            decision: 'include',
            inclusion_type: 'explicit',
          }
        }

        incluirAncestrais(issue)
      }

      return novos
    })

    setSelecionadas([])
  }

  return (
    <div
      className="iteracao-manual-lookup"
      style={{
        marginTop: 20,
        padding: 18,
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: 10,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Consultar demanda no Jira</h3>

      <p className="iteracao-note">
        Consulte uma demanda independentemente dos filtros da extração.
        Selecione quais itens deseja adicionar à revisão.
      </p>

      <form
        onSubmit={e => {
          e.preventDefault()
          void consultar()
        }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
      >
        <input
          className="iteracao-lookup-input"
          aria-label="Chave Jira"
          placeholder="Ex.: TECNA-6231"
          value={chave}
          onChange={e => setChave(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />

        <button
          type="submit"
          className="iteracao-search-button"
          disabled={consultando}
          >
          <Search size={16} />
          {consultando ? 'Consultando...' : 'Consultar Jira'}
        </button>
        {consultando && (
          <button
            type="button"
            className="iteracao-cancel-button"
            onClick={cancelarConsultaManual}
          >
            Cancelar consulta
          </button>
        )}
      </form>

      {erroConsulta && (
        <p className="iteracao-error" role="alert">
          {erroConsulta}
        </p>
      )}

      {resultado && (
        <div style={{ marginTop: 16 }}>
          <div className="iteracao-lookup-result-header">
            <strong>Resultado da consulta</strong>
            <span>
              {hierarquiaConsulta.totalExibivel}{' '}
              {hierarquiaConsulta.totalExibivel === 1 ? 'demanda' : 'demandas'}
              {' · '}
              {resultado.query_key}
            </span>
          </div>

          {!resultado.traceability.complete && (
            <p className="iteracao-error" role="alert">
              Consulta parcial: alguns vínculos podem não ter sido recuperados.
            </p>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', cursor: 'pointer', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={todosSelecionados}
              disabled={!chavesSelecionaveis.length}
              onChange={alternarTodosConsulta}
            />
            Selecionar todos ({chavesSelecionaveis.length})
          </label>

          <div className="iteracao-tree-scroll iteracao-lookup-tree">
            {hierarquiaConsulta.raizes.length ? (
              hierarquiaConsulta.raizes.map(issue => renderizarConsulta(issue))
            ) : (
              <p className="iteracao-note">
                Nenhuma demanda encontrada.
              </p>
            )}
          </div>

          <button
            type="button"
            className="iteracao-next-button"
            onClick={adicionarSelecionadas}
            disabled={!selecionadas.length}
            style={{ marginTop: 12 }}
            >
            <CheckCircle2 size={16} />
            Adicionar {selecionadas.length} à revisão
          </button>
        </div>
      )}

      {Object.keys(adicionadas).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4>
            Demandas adicionadas manualmente
            {' '}({Object.keys(adicionadas).length})
          </h4>

          <p className="iteracao-note">
            Demandas incluídas manualmente na revisão da extração.
          </p>

          <div className="iteracao-manual-items">
            {demandasManuaisOrdenadas.map(({ issue, nivel }) => (
              <div className="iteracao-manual-item" key={issue.key}>
                <div
                  className="iteracao-manual-item-content"
                  style={{ paddingLeft: nivel * 22 }}>
                  <div className="iteracao-manual-item-header">
                    <strong>{issue.key}</strong>
                    <span
                      className={
                        issue.review?.inclusion_type === 'ancestor'
                          ? 'iteracao-manual-tag iteracao-manual-tag-context'
                          : 'iteracao-manual-tag'
                      }
                    >
                      {issue.review?.inclusion_type === 'ancestor'
                        ? 'Contexto automático'
                        : 'Inclusão manual'}
                    </span>
                  </div>

                  <span className="iteracao-manual-item-summary">
                    {issue.summary}
                  </span>
                </div>

                <button
                  type="button"
                  className="iteracao-manual-remove"
                  onClick={() => onRemover(issue.key)}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RevisaoExtracao({
  extracao,
  onFinalizar,
  salvando = false,
}: {
  extracao: Extracao
  onFinalizar: (
    demandas: Demanda[],
    demandasExcluidas: string[],
  ) => void
  salvando?: boolean
}) {
  const [busca, setBusca] = useState('')
  const [escopo, setEscopo] = useState('todos')
  const [tipo, setTipo] = useState('todos')
  const [expandidos, setExpandidos] = useState<string[]>([])
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [adicionadas, setAdicionadas] = useState<Record<string, DemandaManual>>({})
  const [excluidas, setExcluidas] = useState<string[]>([])
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  function finalizarRevisao() {
    onFinalizar(demandasAtivas, excluidas)
  }
  const demandasRevisao = useMemo(
    () => [
      ...extracao.issues,
      ...Object.values(adicionadas).filter(
        issue => !extracao.issues.some(original => original.key === issue.key)
      ),
    ],
    [extracao, adicionadas]
  )

  const mapaCompleto = useMemo(
    () => new Map(demandasRevisao.map(issue => [issue.key, issue])),
    [demandasRevisao]
  )

  // A exclusão usa a hierarquia completa, nunca a árvore filtrada.
  function chavesAfetadas(key: string): string[] {
    const afetadas = new Set<string>([key])
    let mudou = true
    while (mudou) {
      mudou = false
      for (const issue of demandasRevisao) {
        if (issue.parent_key && afetadas.has(issue.parent_key) && !afetadas.has(issue.key)) {
          afetadas.add(issue.key)
          mudou = true
        }
      }
    }
    return [...afetadas].filter(chave => mapaCompleto.has(chave))
  }

  const excluidasOriginais = extracao.issues.filter(issue =>
    excluidas.includes(issue.key)
  )

  const demandasAtivas = demandasRevisao.filter(issue => !excluidas.includes(issue.key))

  const mapa = new Map(demandasAtivas.map(issue => [issue.key, issue]))

  const tipos = [...new Set(demandasAtivas.map(i => i.issue_type))].sort()

  const filtradas = (() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return demandasAtivas.filter(issue => {
      if (escopo !== 'todos' && issue.scope !== escopo) return false
      if (tipo !== 'todos' && issue.issue_type !== tipo) return false
      return !termo ||
        issue.key.toLocaleLowerCase('pt-BR').includes(termo) ||
        issue.summary.toLocaleLowerCase('pt-BR').includes(termo)
    })
  })()

  // Hierarquia apenas de apresentação: mantém parent_key e vínculos originais.
  // Um TP vinculado a uma única História visível aparece sob essa História.
  // Se houver várias Histórias vinculadas, preservamos o pai Jira para não
  // duplicar o TP na árvore nem sugerir uma relação exclusiva inexistente.
  const paisVisuais = (() => {
    const pais = new Map<string, string>()
    const porChave = new Map(filtradas.map(issue => [issue.key, issue]))
    const todasPorChave = new Map(demandasAtivas.map(issue => [issue.key, issue]))

    for (const issue of filtradas) {
      const paiJira = issue.parent_key
      if (paiJira && paiJira !== issue.key && porChave.has(paiJira)) {
        pais.set(issue.key, paiJira)
      }
    }

    for (const tp of filtradas) {
      if (!ehTP(tp.issue_type)) continue

      const historias = new Set<string>()
      const registrarHistoria = (chave: string) => {
        const candidata = todasPorChave.get(chave)
        if (candidata && ehHistoria(candidata.issue_type)) {
          historias.add(candidata.key)
        }
      }

      // Lê ambos os lados da relação para suportar vínculos unidirecionais.
      for (const relacao of tp.qa_relationships ?? []) {
        if (relacao.relationship === 'tests_story') registrarHistoria(relacao.key)
      }
      for (const historia of demandasAtivas) {
        if (!ehHistoria(historia.issue_type)) continue
        if ((historia.qa_relationships ?? []).some(
          relacao => relacao.relationship === 'test_plan' && relacao.key === tp.key
        )) registrarHistoria(historia.key)
      }

      if (historias.size !== 1) continue
      const [historiaKey] = [...historias]
      if (!porChave.has(historiaKey)) continue

      // Protege a árvore contra relações circulares ou dados inconsistentes.
      const visitados = new Set<string>([tp.key])
      let atual: string | undefined = historiaKey
      let circular = false
      while (atual) {
        if (visitados.has(atual)) {
          circular = true
          break
        }
        visitados.add(atual)
        atual = pais.get(atual)
      }
      if (!circular) pais.set(tp.key, historiaKey)
    }

    return pais
  })()

  const filhos = (() => {
    const resultado = new Map<string, Demanda[]>()
    for (const issue of filtradas) {
      const parent = paisVisuais.get(issue.key)
      if (!parent) continue
      const lista = resultado.get(parent) ?? []
      lista.push(issue)
      resultado.set(parent, lista)
    }
    for (const lista of resultado.values()) {
      lista.sort((a, b) => a.key.localeCompare(b.key))
    }
    return resultado
  })()

  const raizes = filtradas.filter(issue => !paisVisuais.has(issue.key))

  const demandaSelecionada = selecionada
    ? mapa.get(selecionada)
    : undefined

  const tpsSemHistoria = demandasAtivas.filter(
    issue => ehTP(issue.issue_type) &&
      !(issue.qa_relationships || []).some(
        r => r.relationship === 'tests_story'
      )
  )

  const historiasSemTP = demandasAtivas.filter(
    issue => ehHistoria(issue.issue_type) &&
      !(issue.qa_relationships || []).some(
        r => r.relationship === 'test_plan'
      )
  )

  function alternar(key: string) {
    setExpandidos(anteriores =>
      anteriores.includes(key)
        ? anteriores.filter(k => k !== key)
        : [...anteriores, key]
    )
  }

  function renderizarIssue(
    issue: Demanda,
    nivel = 0,
    caminho: string[] = []
  ): React.ReactNode {
    if (caminho.includes(issue.key)) return null

    const descendentes = filhos.get(issue.key) || []
    const aberto = expandidos.includes(issue.key)

    const vinculos = [
      ...(issue.qa_relationships || []).map(relacao => ({
        key: relacao.key,
        tipo: relacao.relationship,
      })),
      ...(issue.relationships || [])
        .filter(relacao => relacao.origem === issue.key)
        .map(relacao => ({
          key: relacao.destino,
          tipo: relacao.tipo,
        })),
      ...(issue.relationships || [])
        .filter(relacao => relacao.destino === issue.key)
        .map(relacao => ({
          key: relacao.origem,
          tipo: relacao.tipo,
        })),
    ].filter((vinculo, indice, lista) =>
      vinculo.key !== issue.key &&
      lista.findIndex(item =>
        item.key === vinculo.key && item.tipo === vinculo.tipo
      ) === indice
    )

    return (
      <div key={issue.key}
           className={`iteracao-tree-node ${nivel > 0 ? 'iteracao-tree-node-child' : ''}`}
           style={{
              '--tree-connector-left': `${12 + nivel * 24 - 12}px`,
            } as React.CSSProperties}
        >
        <div
          className={`iteracao-tree-row ${
            selecionada === issue.key ? 'iteracao-tree-row-selected' : ''
          }`}
          style={{ paddingLeft: 12 + nivel * 24 }}
        >
          <button
            type="button"
            className="iteracao-tree-expand"
            onClick={() => alternar(issue.key)}
            disabled={!descendentes.length}
            aria-label={aberto ? 'Recolher' : 'Expandir'}
            aria-expanded={descendentes.length ? aberto : undefined}
          >
            {descendentes.length > 0 ? (
              aberto ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            ) : null}
          </button>

          <button
            type="button"
            className="iteracao-tree-content"
            onClick={() => setSelecionada(issue.key)}
          >
            <div className="iteracao-tree-heading">
              <strong>{issue.key}</strong>
              <span className="iteracao-tree-type">{issue.issue_type}</span>
            </div>

            <span className="iteracao-tree-summary">
              {issue.summary}
            </span>
            {vinculos.length > 0 && (
              <div className="iteracao-tree-links">
                <GitBranch size={12} aria-hidden="true" />

                <span>
                  {vinculos.slice(0, 2).map((vinculo, indice) => (
                    <span key={`${vinculo.key}-${vinculo.tipo}`}>
                      {indice > 0 && ' · '}
                      {vinculo.tipo || 'Vinculado a'}{' '}
                      <strong>{vinculo.key}</strong>
                    </span>
                  ))}

                  {vinculos.length > 2 && (
                    <span> · +{vinculos.length - 2} vínculos</span>
                  )}
                </span>
              </div>
            )}

          </button>

          <button
            type="button"
            className="iteracao-tree-remove"
            onClick={() => setConfirmacao(issue.key)}
            title={`Remover ${issue.key} da análise`}
            aria-label={`Remover ${issue.key} da análise`}
          >
            <Trash2 size={16} />
          </button>

          <span
            className={`iteracao-tree-scope ${
              issue.scope === 'direct'
                ? 'iteracao-tree-scope-direct'
                : issue.scope === 'manual_lookup'
                  ? 'iteracao-tree-scope-manual'
                  : 'iteracao-tree-scope-traceability'
            }`}
          >
            {issue.scope === 'direct'
              ? 'Direta'
              : issue.scope === 'manual_lookup'
                ? 'Manual'
                : 'Rastreabilidade'}
          </span>
        </div>

        {aberto && descendentes.map(filho =>
          renderizarIssue(filho, nivel + 1, [...caminho, issue.key])
        )}
      </div>
    )
  }

  return (
    <section className="iteracao-card">
      <div className="iteracao-card-heading">
        <div className="iteracao-card-icon">
          <GitBranch size={21} />
        </div>
        <div className="iteracao-card-title">
          <h2>Revisão da extração</h2>
          <p>
            Confira as demandas e seus relacionamentos antes da consolidação.
          </p>
        </div>
      </div>

      <div className="iteracao-result">
        <CheckCircle2 size={17} />
        <span>
          {extracao.total} extraídas originalmente ·{' '}
          {extracao.total_direct} diretas ·{' '}
          {extracao.total_traceability} de rastreabilidade ·{' '}
          {extracao.qa_links_total ?? 0} vínculos História–TP ·{' '}
          {demandasAtivas.length} selecionadas para análise
        </span>
      </div>

      {!extracao.traceability.complete && (
        <p className="iteracao-error" role="alert">
          A rastreabilidade não está completa.
          {extracao.traceability.limit_reached && ' Limite de expansão atingido.'}
          {extracao.traceability.unresolved_keys.length > 0 &&
            ` ${extracao.traceability.unresolved_keys.length} chave(s) não resolvida(s).`}
        </p>
      )}

      <div className="iteracao-qa-indicators-container">
        <div className="iteracao-qa-indicators">
          <div className="iteracao-qa-indicator">
            <span>TPs sem História</span>
            <strong>{tpsSemHistoria.length}</strong>
          </div>

          <div className="iteracao-qa-indicator">
            <span>Histórias sem TP</span>
            <strong>{historiasSemTP.length}</strong>
          </div>
        </div>
      </div>

      <div className="iteracao-fields iteracao-review-filters">
        <label>
          Buscar demanda
          <div className="iteracao-review-search">
            <Search size={16} />
            <input
              type="search"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Chave ou descrição"
            />
          </div>
        </label>

        <label>
          Escopo
          <div className="iteracao-review-select">
            <select
              value={escopo}
              onChange={e => setEscopo(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="direct">Diretas</option>
              <option value="traceability">Rastreabilidade</option>
              <option value="manual_lookup">Inclusão manual</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </label>

        <label>
          Tipo
          <div className="iteracao-review-select">
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
            >
              <option value="todos">Todos os tipos</option>
              {tipos.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </label>
      </div>

      <div style={{
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div className="iteracao-tree-header">
          <h3>Hierarquia Jira</h3>
          <span className="iteracao-tree-count">
            {filtradas.length} demandas exibidas · {demandasAtivas.length} no escopo
          </span>
        </div>

        <div className="iteracao-tree-scroll">
          {raizes.length
            ? raizes.map(issue => renderizarIssue(issue))
            : <p className="iteracao-note" style={{ padding: 16 }}>
                Nenhuma demanda encontrada.
              </p>}
        </div>
      </div>

      {demandaSelecionada && (
        <div className="iteracao-detail-panel">
          <div className="iteracao-detail-header">
            <div className="iteracao-detail-heading">
              <div className="iteracao-detail-title">
                <h3>{demandaSelecionada.key}</h3>
                <span className="iteracao-detail-type">
                  {demandaSelecionada.issue_type}
                </span>
              </div>
              <p>{demandaSelecionada.summary}</p>
            </div>

            <button
              type="button"
              className="iteracao-detail-close"
              onClick={() => setSelecionada(null)}
            >
              Fechar
            </button>
          </div>

          <div className="iteracao-detail-fields">
            <div>
              <span>Status</span>
              <strong>{demandaSelecionada.status || 'Não informado'}</strong>
            </div>

            <div>
              <span>Parent</span>
              <strong>{demandaSelecionada.parent_key || 'Não informado'}</strong>
            </div>

            <div>
              <span>Escopo</span>
              <strong>
                {demandaSelecionada.scope === 'direct'
                  ? 'Direta'
                  : demandaSelecionada.scope === 'manual_lookup'
                    ? 'Inclusão manual'
                    : 'Rastreabilidade'}
              </strong>
            </div>
          </div>

          <div className="iteracao-detail-section">
            <h4>Vínculos de QA</h4>

            {(demandaSelecionada.qa_relationships || []).length ? (
              <div className="iteracao-detail-relations">
                {demandaSelecionada.qa_relationships!.map(relacao => (
                  <div
                    className="iteracao-detail-relation"
                    key={`${relacao.key}-${relacao.relationship}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelecionada(relacao.key)}
                      disabled={!mapa.has(relacao.key)}
                    >
                      {relacao.key}
                    </button>

                    <span>
                      {relacao.relationship === 'tests_story'
                        ? 'Testa a História'
                        : 'Test Plan associado'}
                      {' · '}
                      Origem: {relacao.sources.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="iteracao-note">Nenhum vínculo QA identificado.</p>
            )}
          </div>

          <div className="iteracao-detail-section">
            <h4>Relacionamentos Jira</h4>

            {demandaSelecionada.relationships.length ? (
              <div className="iteracao-detail-relations">
                {demandaSelecionada.relationships.map((r, indice) => (
                  <div
                    className="iteracao-detail-relation"
                    key={`${r.destino}-${indice}`}
                  >
                    <strong>{r.destino}</strong>
                    <span>{r.tipo} · {r.direcao}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="iteracao-note">Nenhum relacionamento informado.</p>
            )}
          </div>

          {demandaSelecionada.url && (
            <div className="iteracao-detail-footer">
              <a
                href={demandaSelecionada.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir demanda no Jira ↗
              </a>
            </div>
          )}
        </div>
      )}

      {excluidasOriginais.length > 0 && (
        <div className="iteracao-excluded">
          <h4>Demandas removidas da análise ({excluidasOriginais.length})</h4>
          <p className="iteracao-note">Os dados foram preservados. É possível reincluir as demandas sem consultar o Jira.</p>
          {excluidasOriginais.map(issue => (
            <div className="iteracao-excluded-row" key={issue.key}>
              <span><strong>{issue.key}</strong> — {issue.summary}</span>
              <button type="button" onClick={() => {
                // Ao reincluir um filho, reativamos também seus ancestrais disponíveis.
                const restaurar = new Set<string>([issue.key])
                let atual = issue
                const visitados = new Set<string>()
                while (atual.parent_key && !visitados.has(atual.parent_key)) {
                  visitados.add(atual.parent_key)
                  const pai = mapaCompleto.get(atual.parent_key)
                  if (!pai) break
                  restaurar.add(pai.key)
                  atual = pai
                }
                setExcluidas(anteriores => anteriores.filter(key => !restaurar.has(key)))
              }}><RotateCcw size={14} /> Reincluir</button>
            </div>
          ))}
        </div>
      )}

      <ConsultaManualJira
        extracao={extracao}
        adicionadas={adicionadas}
        setAdicionadas={setAdicionadas}
        onRemover={setConfirmacao}
      />

      {confirmacao && (
        <div className="iteracao-modal-backdrop" onClick={() => setConfirmacao(null)}>
          <div className="iteracao-modal" role="dialog" aria-modal="true"
            aria-labelledby="iteracao-modal-title" onClick={e => e.stopPropagation()}>
            <h3 id="iteracao-modal-title">Remover demanda da análise?</h3>
            <p>Você está removendo <strong>{confirmacao}</strong>.</p>
            <p>{chavesAfetadas(confirmacao).length > 1
              ? `Esta ação removerá também todos os descendentes: ${chavesAfetadas(confirmacao).length} demandas no total.`
              : 'Somente esta demanda será removida. Seus pais e irmãos permanecerão na análise.'}</p>
            <p className="iteracao-note">Nenhum dado será apagado do Jira. Você poderá reincluir as demandas.</p>
            <div className="iteracao-modal-actions">
              <button type="button" onClick={() => setConfirmacao(null)}>Cancelar</button>
              <button type="button" className="iteracao-modal-confirm" onClick={() => {
                const afetadas = chavesAfetadas(confirmacao)
                const originais = new Set(extracao.issues.map(issue => issue.key))
                setExcluidas(anteriores => [
                  ...new Set([
                    ...anteriores,
                    ...afetadas.filter(key => originais.has(key)),
                  ]),
                ])
                setAdicionadas(anteriores => {
                  const atualizadas = { ...anteriores }
                  afetadas.forEach(key => delete atualizadas[key])
                  return atualizadas
                })
                if (selecionada && afetadas.includes(selecionada)) setSelecionada(null)
                setConfirmacao(null)
              }}>Confirmar remoção</button>
            </div>
          </div>
        </div>
      )}

      <div className="iteracao-card-footer">
        <div className="iteracao-review-info">
          <ShieldCheck size={17} />
          <span>Revisão obrigatória antes da consolidação</span>
        </div>
        <button
          type="button"
          className="iteracao-next-button"
          disabled={salvando}
          onClick={finalizarRevisao}
        >
          {salvando ? 'Salvando iteração...' : 'Finalizar iteração'}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  )
}

function calcularInicio(fim: string): string {
  if (!fim) return ''
  const [ano, mes, dia] = fim.split('-').map(Number)
  const ultimoDia = new Date(ano, mes - 3, 0).getDate()
  const data = new Date(ano, mes - 4, Math.min(dia, ultimoDia))
  data.setMonth(data.getMonth() + 1)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

function NovaIteracao({onVoltar, onAbrirRevisaoDados}: NovaIteracaoProps) {
  const [salvandoIteracao, setSalvandoIteracao] = useState(false)
  const salvandoRef = useRef(false)

  async function finalizarIteracao(
    demandas: Demanda[],
    demandasExcluidas: string[],
  ) {
    if (salvandoRef.current) return

    if (!projeto || !time || !extracao) {
      alert('Dados da iteração incompletos.')
      return
    }

    salvandoRef.current = true
    setSalvandoIteracao(true)

    try {
      const sprintPrincipal = filtros?.sprints.find(
        sprint => String(sprint.id) === sprintsSelecionadas[0]
      )

      const contexto = {
        project_key: projeto.chave,
        team_name: time.nome,
        data_inicio: inicio,
        data_fim: fim,
        sprints: sprintsSelecionadas,
        quarters: quartersSelecionados,
        sprint_name: sprintPrincipal?.name ?? '',
        total_original: extracao.total,
        total_direct: extracao.total_direct,
        total_traceability: extracao.total_traceability,
        qa_links_total: extracao.qa_links_total ?? 0,
        demandas_originais: extracao.issues,
      }

      await criarIteracao(contexto, {
        demandas,
        demandas_excluidas: demandasExcluidas,
        contexto,
        rastreabilidade: extracao.traceability,
      })

      onAbrirRevisaoDados()
    } catch (erro) {
      console.error('Erro ao salvar iteração:', erro)
      alert(
        erro instanceof Error
          ? erro.message
          : 'Não foi possível salvar a iteração.'
      )
    } finally {
      salvandoRef.current = false
      setSalvandoIteracao(false)
    }
  }

  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [times, setTimes] = useState<Time[]>([])
  const [projetoId, setProjetoId] = useState(0)
  const [carregandoCadastros, setCarregandoCadastros] = useState(true)
  const [erroCadastros, setErroCadastros] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function carregarCadastros() {
      try {
        const resposta = await apiFetch(
          `${API_URL}/configuration`,
          { signal: controller.signal }
        )

        if (!resposta.ok) {
          throw new Error('Não foi possível carregar os cadastros.')
        }

        const dados = await resposta.json()

        if (
          !Array.isArray(dados.projetos) ||
          !Array.isArray(dados.times)
        ) {
          throw new Error('Dados de configuração inválidos.')
        }

        if (controller.signal.aborted) return

        setProjetos(dados.projetos)
        setTimes(dados.times)
        setProjetoId(dados.projetos[0]?.id ?? 0)
      } catch (erro) {
        if (controller.signal.aborted) return

        setErroCadastros(
          erro instanceof Error
            ? erro.message
            : 'Falha ao carregar os cadastros.'
        )
      } finally {
        if (!controller.signal.aborted) {
          setCarregandoCadastros(false)
        }
      }
    }

    void carregarCadastros()

    return () => controller.abort()
  }, [])

  const [timeId, setTimeId] = useState(0)
  const [fim, setFim] = useState(() => {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
})
const [inicio, setInicio] = useState(() => calcularInicio(fim))

  const [filtros, setFiltros] = useState<Filtros | null>(null)
  const [carregando, setCarregando] = useState(false)
  const consultaFiltrosRef = useRef<AbortController | null>(null)
  const [extraindo, setExtraindo] = useState(false)
  const extracaoControllerRef = useRef<AbortController | null>(null)
  const [erro, setErro] = useState('')
  const [extracao, setExtracao] = useState<Extracao | null>(null)

  const [sprintsSelecionadas, setSprintsSelecionadas] =
    useState<string[]>([])
  const [quartersSelecionados, setQuartersSelecionados] =
    useState<string[]>([])

  const projeto = projetos.find(p => p.id === projetoId)

  const timesDoProjeto = useMemo(
    () => times.filter(t => t.projetosIds.includes(projetoId)),
    [times, projetoId]
  )

  const timeIdEfetivo = timesDoProjeto.some(t => t.id === timeId)
    ? timeId
    : timesDoProjeto[0]?.id ?? 0
  const time = timesDoProjeto.find(t => t.id === timeIdEfetivo)

  function limparConsulta() {
    setFiltros(null)
    setExtracao(null)
    setErro('')
    setSprintsSelecionadas([])
    setQuartersSelecionados([])
  }

  function cancelarConsultaFiltros() {
    consultaFiltrosRef.current?.abort()
    consultaFiltrosRef.current = null
    setCarregando(false)
  }

  async function carregarFiltros() {
    if (carregando || consultaFiltrosRef.current || !projeto || !time || !inicio || !fim) return
    if (inicio > fim) {
      setErro('A data inicial não pode ser posterior à data final.')
      return
    }

    const controller = new AbortController()
    consultaFiltrosRef.current = controller
    setCarregando(true)
    limparConsulta()

    try {
      const resposta = await apiFetch(
        `${API_URL}/jira/iteration/filters`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_key: projeto.chave,
            team_name: time.nome,
            start_date: inicio,
            end_date: fim,
          }),
        }
      )

      const dados = await resposta.json()
      if (controller.signal.aborted) return

      if (!resposta.ok) {
        throw new Error(
          typeof dados.detail === 'string'
            ? dados.detail
            : 'Erro ao consultar filtros no Jira.'
        )
      }

      setFiltros(dados as Filtros)
    } catch (e) {
      if (!controller.signal.aborted) {
        setErro(e instanceof Error ? e.message : 'Falha na consulta ao Jira.')
      }
    } finally {
      if (consultaFiltrosRef.current === controller) {
        consultaFiltrosRef.current = null
        setCarregando(false)
      }
    }
  }

  function cancelarExtracao() {
    extracaoControllerRef.current?.abort()
    extracaoControllerRef.current = null
    setExtraindo(false)
  }

  async function iniciarExtracao() {
    if (!projeto || !time || !filtros || extraindo || extracaoControllerRef.current) return


    const controller = new AbortController()
    extracaoControllerRef.current = controller
    setExtraindo(true)
    setExtracao(null)
    setErro('')

    try {
      const resposta = await apiFetch(
        `${API_URL}/jira/iteration/extract`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_key: projeto.chave,
            team_name: time.nome,
            start_date: inicio,
            end_date: fim,
            quarters: quartersSelecionados,
            sprint_ids: sprintsSelecionadas,
          }),
        }
      )

      const dados = await resposta.json()
      if (controller.signal.aborted) return

      if (!resposta.ok) {
        throw new Error(
          typeof dados.detail === 'string'
            ? dados.detail
            : 'Erro ao extrair demandas do Jira.'
        )
      }

      setExtracao(dados as Extracao)
    } catch (e) {
      if (!controller.signal.aborted) {
        setErro(
          e instanceof Error ? e.message : 'Falha na extração do Jira.'
        )
      }
    } finally {
      if (extracaoControllerRef.current === controller) {
        extracaoControllerRef.current = null
        setExtraindo(false)
      }
    }
  }

  const opcoesQuarter = useMemo(
    () => (filtros?.quarters ?? []).map(q => ({
      valor: identificadorQuarter(q),
      nome: q.name,
    })),
    [filtros]
  )

  const sprintsDisponiveis = useMemo(() => {
    if (!filtros) return []
    if (!quartersSelecionados.length || !filtros.sprint_quarters) {
      return filtros.sprints
    }
    return filtros.sprints.filter(s => {
      const quartersDaSprint =
        filtros.sprint_quarters?.[String(s.id)] ?? []
      return quartersDaSprint.some(q => quartersSelecionados.includes(q))
    })
  }, [filtros, quartersSelecionados])

  const opcoesSprint = useMemo(
    () => sprintsDisponiveis.map(s => ({
      valor: String(s.id),
      nome: s.state ? `${s.name} (${s.state})` : s.name,
    })),
    [sprintsDisponiveis]
  )

  function alterarQuarters(valores: string[]) {
    setQuartersSelecionados(valores)
    setExtracao(null)

    if (!filtros?.sprint_quarters || !valores.length) return

    const validas = filtros.sprints
      .filter(s => {
        const quartersDaSprint =
          filtros.sprint_quarters?.[String(s.id)] ?? []
        return quartersDaSprint.some(q => valores.includes(q))
      })
      .map(s => String(s.id))

    setSprintsSelecionadas(anteriores =>
      anteriores.filter(id => validas.includes(id))
    )
  }

  return (
    <main className="iteracao-page">
      <div className="iteracao-content">
        <header className="qh-internal-header">
          <nav className="qh-internal-breadcrumb" aria-label="Localização">
            <button type="button" onClick={onVoltar} title="Voltar à Central de Revisão">
              <House size={15} aria-hidden="true" />
              Central de Revisão
            </button>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">Nova Iteração</span>
          </nav>
          <div className="qh-internal-header-row">
            <div>
              <h1>Nova Iteração</h1>
              <p>Configure os filtros da análise. A extração será seguida de revisão obrigatória antes da consolidação.</p>
            </div>
            <button type="button" className="qh-internal-back" onClick={onVoltar}>
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar à lista
            </button>
          </div>
        </header>
        {carregandoCadastros && (
          <p className="iteracao-note" role="status">
            Carregando projetos e times...
          </p>
        )}

        {erroCadastros && (
          <p className="iteracao-error" role="alert">
            {erroCadastros}
          </p>
        )}
        <section className="iteracao-card">
          <div className="iteracao-card-heading">
            <div className="iteracao-card-icon">
              <FolderKanban size={21} />
            </div>
            <div className="iteracao-card-title">
              <h2>Contexto da análise</h2>
              <p>Projeto e time associados à iteração.</p>
            </div>
            {projeto && time && (
              <CheckCircle2 className="iteracao-check" size={20} />
            )}
          </div>

          <div className="iteracao-fields">
            <label>
              Projeto
              {projetos.length > 1 ? (
                <select
                  value={projetoId}
                  disabled={carregando || extraindo}
                  onChange={e => {
                    setProjetoId(Number(e.target.value))
                    limparConsulta()
                  }}
                >
                  {projetos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome} ({p.chave})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="iteracao-readonly">
                  {projeto
                    ? `${projeto.nome} (${projeto.chave})`
                    : 'Nenhum projeto cadastrado'}
                </div>
              )}
            </label>

            <label>
              Time
              {timesDoProjeto.length > 1 ? (
                <select
                  value={timeIdEfetivo}
                  disabled={carregando || extraindo}
                  onChange={e => {
                    setTimeId(Number(e.target.value))
                    limparConsulta()
                  }}
                >
                  {timesDoProjeto.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="iteracao-readonly">
                  {time?.nome || 'Nenhum time associado'}
                </div>
              )}
            </label>
          </div>
        </section>

        <section className="iteracao-card">
          <div className="iteracao-card-heading">
            <div className="iteracao-card-icon">
              <CalendarRange size={21} />
            </div>
            <div className="iteracao-card-title">
              <h2>Período da análise</h2>
              <p>Intervalo utilizado para consultar os dados do Jira.</p>
            </div>
          </div>

          <div className="iteracao-fields">
            <label>
              Data inicial
              <input
                type="date"
                value={inicio}
                disabled={carregando || extraindo}
                onChange={e => {
                  setInicio(e.target.value)
                  limparConsulta()
                }}
              />
            </label>

            <label>
              Data final
              <input
                type="date"
                value={fim}
                min={inicio || undefined}
                disabled={carregando || extraindo}
                onChange={e => {
                  const novaData = e.target.value
                  setFim(novaData)
                  setInicio(calcularInicio(novaData))
                  limparConsulta()
                }}
              />
            </label>
          </div>
          <div className="iteracao-actions">
            <button
              type="button"
              className="iteracao-search-button"
              onClick={() => void carregarFiltros()}
              disabled={
                !projeto || !time || !inicio || !fim ||
                carregando || extraindo
              }
            >
              {carregando ? 'Consultando Jira...' : 'Buscar filtros no Jira'}
              {!carregando && <ArrowRight size={16} />}
            </button>
            {carregando && (
              <button
                type="button"
                className="iteracao-cancel-button"
                onClick={cancelarConsultaFiltros}
                style={{ background: 'transparent', color: 'inherit' }}
              >
                Cancelar consulta
              </button>
            )}
          </div>
        </section>

        {(carregando || filtros || erro || extraindo) && (
          <section className="iteracao-card">
            <div className="iteracao-card-heading">
              <div className="iteracao-card-icon">
                <SlidersHorizontal size={21} />
              </div>
              <div className="iteracao-card-title">
                <h2>Filtros da extração</h2>
                <p>Selecione quarters, sprints ou ambos.</p>
              </div>
            </div>

            {(carregando || extraindo) && (
              <div className="iteracao-loading" role="status">
                <div className="iteracao-spinner" aria-hidden="true" />
                <div>
                  <strong>
                    {extraindo
                      ? 'Extraindo demandas do Jira'
                      : 'Buscando informações do Jira'}
                  </strong>
                  <p>
                    {extraindo
                      ? 'Reconstruindo a hierarquia e os vínculos de QA...'
                      : 'Identificando sprints e quarters disponíveis...'}
                  </p>
                  <span>Essa consulta pode levar alguns instantes.</span>
                </div>
              </div>
            )}

            {erro && (
              <p className="iteracao-error" role="alert">{erro}</p>
            )}

            {filtros && (
              <>
                <div className="iteracao-result">
                  <CheckCircle2 size={17} />
                  <span>
                    {filtros.issues_analyzed} demandas identificadas no período.
                  </span>
                </div>

                <div className="iteracao-fields">
                  <Multiselecao
                    titulo="Quarter"
                    opcoes={opcoesQuarter}
                    selecionados={quartersSelecionados}
                    onChange={alterarQuarters}
                    vazio="Selecionar quarters"
                    disabled={extraindo}
                  />
                  <Multiselecao
                    titulo="Sprint"
                    opcoes={opcoesSprint}
                    selecionados={sprintsSelecionadas}
                    onChange={valores => {
                      setSprintsSelecionadas(valores)
                      setExtracao(null)
                    }}
                    vazio="Selecionar sprints"
                    disabled={extraindo}
                  />
                </div>

                {!filtros.quarters.length && (
                  <p className="iteracao-note">
                    Nenhum quarter identificado nas demandas consultadas.
                  </p>
                )}

                <div className="iteracao-card-footer">
                  <div className="iteracao-review-info">
                    <ShieldCheck size={17} />
                    <span>Revisão obrigatória antes da consolidação</span>
                  </div>
                  <div className="iteracao-extraction-actions">
                    <button
                      type="button"
                      className="iteracao-next-button"
                      onClick={() => void iniciarExtracao()}
                      disabled={extraindo || carregando}
                    >
                      {extraindo ? 'Extraindo...' : 'Iniciar extração'}
                      {!extraindo && <ArrowRight size={16} />}
                    </button>
                    {extraindo && (
                      <button
                        type="button"
                        className="iteracao-cancel-button"
                        onClick={cancelarExtracao}
                      >
                        Cancelar extração
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
        {salvandoIteracao && (
          <p className="iteracao-note" role="status">
            Salvando iteração no QualityHub...
          </p>
        )}
        {extracao && (
          <RevisaoExtracao
            extracao={extracao}
            onFinalizar={finalizarIteracao}
            salvando={salvandoIteracao}
          />
        )}
      </div>
    </main>
  )
}

export default NovaIteracao
