import { useState } from 'react'
import EstadoConsulta from '../components/EstadoConsulta'
import { avaliarConfiguracao } from '../services/configuracaoStatus'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import { API_URL, apiFetch } from '../services/api'
import { timeJaVinculado, pessoaVinculada } from '../services/cadastroJira'

type Projeto = { id: number; chave: string; nome: string }
type Time = { id: number; nome: string; projetosIds: number[]; jira_id?: string | null }
type Pessoa = { id: number; nome: string; cargo: string; timesIds: number[]; account_id?: string | null }
type Configuracao = { projetos: Projeto[]; times: Time[]; pessoas: Pessoa[] }
type TimeJira = { id: string; name: string }
type PessoaJira = { accountId: string; displayName: string }
const API = API_URL

async function requisitar<T>(url: string, dados?: object, metodo?: string): Promise<T> {
  const resposta = await apiFetch(`${API}${url}`, dados ? {
    method: metodo ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
  } : metodo ? { method: metodo } : undefined)
  const corpo = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(typeof corpo.detail === 'string' ? corpo.detail : `Erro HTTP ${resposta.status}`)
  return corpo as T
}

async function consultarConfiguracao() {
  return requisitar<Configuracao>('/configuration')
}

export default function GerenciarProjetos({ secao = 'projetos' }: { secao?: 'projetos' | 'times' | 'pessoas' }) {
  const [configAtualizada, setConfigAtualizada] = useState<Configuracao | null>(null)
  const [chave, setChave] = useState('')
  const [projetoId, setProjetoId] = useState('')
  const [timeId, setTimeId] = useState('')
  const [dataInicio, setDataInicio] = useState('2026-01-01')
  const [timesJira, setTimesJira] = useState<TimeJira[]>([])
  const [pessoasJira, setPessoasJira] = useState<PessoaJira[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [secaoMensagem, setSecaoMensagem] = useState(secao)
  const [idsTimes, setIdsTimes] = useState<Record<number, string>>({})
  const [idsPessoas, setIdsPessoas] = useState<Record<number, string>>({})
  const [cargos, setCargos] = useState<Record<string, string>>({})

  const consultaConfiguracao = useConsultaRecurso('configuracao', consultarConfiguracao)
  const config = configAtualizada ?? consultaConfiguracao.dados
  const projeto = config?.projetos.find(p => String(p.id) === projetoId)
  const timesProjeto = config?.times.filter(t => t.projetosIds.includes(Number(projetoId))) ?? []
  const time = timesProjeto.find(t => String(t.id) === timeId)
  const configuracao = config ? avaliarConfiguracao(config) : null

  async function executar(operacao: () => Promise<void>) {
    setOcupado(true); setErro(''); setMensagem(''); setSecaoMensagem(secao)
    try { await operacao() } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setOcupado(false) }
  }
  async function cadastrarProjeto() {
    await executar(async () => {
      const dados = await requisitar<Configuracao>('/configuration/projects', { chave: chave.trim().toUpperCase() })
      setConfigAtualizada(dados)
      const novo = dados.projetos.find(p => p.chave.toUpperCase() === chave.trim().toUpperCase())
      if (novo) setProjetoId(String(novo.id))
      setChave(''); setTimesJira([]); setPessoasJira([]); setTimeId('')
      setMensagem('Projeto validado no Jira e cadastrado sem alterar os anteriores.')
    })
  }
  async function consultarTimes() {
    if (!projeto) return
    await executar(async () => {
      const dados = await requisitar<{ teams: TimeJira[] }>('/jira/team', { project_key: projeto.chave, start_date: dataInicio })
      setTimesJira(dados.teams ?? []); setPessoasJira([])
      setMensagem(`${dados.teams?.length ?? 0} time(s) encontrado(s) nas demandas acessíveis.`)
    })
  }
  async function cadastrarTime(t: TimeJira) {
    if (!projetoId || timeJaVinculado(config?.times ?? [], t, Number(projetoId))) return
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>('/configuration/teams', { projeto_id: Number(projetoId), nome: t.name, jira_id: t.id }))
      setMensagem(`Time ${t.name} vinculado ao projeto.`)
    })
  }
  async function consultarPessoas() {
    if (!projeto || !time) return
    await executar(async () => {
      const dados = await requisitar<{ people: PessoaJira[] }>('/jira/people', { project_key: projeto.chave, team_name: time.nome, team_id: time.jira_id ?? undefined })
      setPessoasJira(dados.people ?? [])
      setMensagem(`${dados.people?.length ?? 0} pessoa(s) encontrada(s) nas demandas do time.`)
    })
  }
  async function cadastrarPessoa(p: PessoaJira) {
    if (!timeId || pessoaVinculada(config?.pessoas ?? [], p, Number(timeId))) return
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>('/configuration/people', { time_id: Number(timeId), nome: p.displayName, account_id: p.accountId, cargo: 'QA' }))
      setMensagem(`${p.displayName} vinculado(a) ao time.`)
    })
  }
  async function removerPessoa(pessoa: Pessoa) {
    if (!timeId) return
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/teams/${encodeURIComponent(timeId)}/people/${encodeURIComponent(pessoa.id)}`, undefined, 'DELETE'))
      setMensagem(`${pessoa.nome} removido(a) deste time. Cadastro e histórico preservados.`)
    })
  }
  async function atualizarCargo(pessoa: Pessoa) {
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/people/${encodeURIComponent(pessoa.id)}/role`, {
        cargo: (cargos[pessoa.id] ?? pessoa.cargo).trim(),
      }, 'PATCH'))
      setMensagem(`Função de ${pessoa.nome} atualizada.`)
    })
  }
  async function removerProjeto(p: Projeto) {
    if (!window.confirm(`Remover o projeto ${p.chave}? Os cadastros de times e pessoas serão preservados. Projetos com histórico não podem ser excluídos.`)) return
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/projects/${encodeURIComponent(p.id)}`, undefined, 'DELETE'))
      if (String(p.id) === projetoId) { setProjetoId(''); setTimeId(''); setTimesJira([]); setPessoasJira([]) }
      setMensagem('Projeto removido. Cadastros de times e pessoas preservados.')
    })
  }
  async function removerTime(t: Time) {
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/projects/${encodeURIComponent(projetoId)}/teams/${encodeURIComponent(t.id)}`, undefined, 'DELETE'))
      if (String(t.id) === timeId) { setTimeId(''); setPessoasJira([]) }
      setMensagem(`Time ${t.nome} desvinculado deste projeto. Cadastros e históricos preservados.`)
    })
  }
  async function identificarTime(local: Time, jira: TimeJira) {
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/teams/${encodeURIComponent(local.id)}/jira`, { projeto_id: Number(projetoId), jira_id: jira.id, desde: dataInicio }, 'PATCH'))
      setMensagem(`ID Jira associado a ${local.nome}. Cadastro original preservado.`)
    })
  }
  async function identificarPessoa(local: Pessoa, jira: PessoaJira) {
    await executar(async () => {
      setConfigAtualizada(await requisitar<Configuracao>(`/configuration/people/${encodeURIComponent(local.id)}/jira`, { projeto_id: Number(projetoId), time_id: Number(timeId), account_id: jira.accountId }, 'PATCH'))
      setMensagem(`ID Jira associado a ${local.nome}. Função e vínculos preservados.`)
    })
  }
  const mesmoNome = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR') === b.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
  const titulos = { projetos: 'Projetos', times: 'Times / Squads', pessoas: 'Pessoas e funções' }
  const pessoasTime = config?.pessoas.filter(p => p.timesIds.includes(Number(timeId))) ?? []
  const descricoes = { projetos: 'Cadastre projetos com acesso validado no Jira.', times: 'Vincule times aos projetos cadastrados.', pessoas: 'Vincule as pessoas do Jira aos seus times.' }
  return <div className="qh-settings-registry">
    <header className="qh-settings-content-heading"><h2>{titulos[secao]}</h2><p>{descricoes[secao]}</p></header>
    {!config && <EstadoConsulta
      consulta={consultaConfiguracao}
      titulo="configuração de projetos"
      orientacao={/fetch|network|load failed/i.test(consultaConfiguracao.erro ?? '')
        ? 'Verifique se o backend está em execução e tente novamente.'
        : consultaConfiguracao.erro ?? 'Tente novamente em instantes.'}
    />}
    {configuracao?.estado === 'parcial' && <p role="status" className="qh-settings-warning">
      Configuração incompleta: {configuracao.faltantes.join('; ')}. Complete os passos abaixo; os dados já salvos serão mantidos.
    </p>}
    {secaoMensagem === secao && erro && <p role="alert">{erro}</p>}
    {secaoMensagem === secao && mensagem && <p role="status">{mensagem}</p>}
    {secao !== 'projetos' && <div className="qh-settings-scope is-context"><label>Projeto: <select value={projetoId} onChange={e => { setProjetoId(e.target.value); setTimeId(''); setTimesJira([]); setPessoasJira([]) }}>
          <option value="">Selecione</option>{config?.projetos.map(p => <option key={p.id} value={p.id}>{p.chave} — {p.nome}</option>)}
        </select></label>{secao === 'times' && <><label>Demandas desde<input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} /></label><button type="button" disabled={ocupado || !projetoId || !dataInicio} onClick={() => void consultarTimes()}>Buscar times no Jira</button></>}{secao === 'pessoas' && <><label>Time / Squad<select value={timeId} disabled={!projetoId} onChange={e => { setTimeId(e.target.value); setPessoasJira([]) }}><option value="">Selecione</option>{timesProjeto.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></label><button type="button" disabled={ocupado || !timeId} onClick={() => void consultarPessoas()}>Buscar pessoas no Jira</button></>}</div>}
    <section className="qh-settings-block" hidden={secao !== 'projetos'}>
      <div className="qh-settings-block-heading"><h3>Projetos cadastrados</h3><span>{config?.projetos.length ?? 0} projetos</span></div>
      <div className="qh-settings-project-add"><label>Chave do projeto<input aria-label="Chave Jira" placeholder="Ex.: TECNA" value={chave} onChange={e => setChave(e.target.value.toUpperCase())} /></label><button type="button" disabled={ocupado || !chave.trim()} onClick={() => void cadastrarProjeto()}>Consultar Jira e cadastrar</button></div>
      {!config ? <p>Consultando projetos...</p> : config.projetos.length === 0 ? <p>Nenhum projeto cadastrado.</p> : <div className="qh-settings-results qh-settings-projects"><table><thead><tr><th>Chave</th><th>Projeto</th><th>Ação</th></tr></thead><tbody>{config.projetos.map(p => <tr key={p.id}><td><strong>{p.chave}</strong></td><td>{p.nome}</td><td><button type="button" disabled={ocupado} onClick={() => void removerProjeto(p)}>Remover</button></td></tr>)}</tbody></table></div>}



    </section>
    <section className="qh-settings-block" hidden={secao !== 'times'}>
      <div className="qh-settings-block-heading"><h3>Times vinculados</h3><span>{timesProjeto.length} times</span></div>
      {timesProjeto.length > 0 ? <div className="qh-settings-results qh-settings-linked-teams"><table><thead><tr><th>Time / Squad</th><th>Vínculo</th><th>Ação</th></tr></thead><tbody>{timesProjeto.map(t => <tr key={t.id}><td>{t.nome}{!t.jira_id && <small className="qh-settings-id-pending">ID Jira pendente</small>}{!t.jira_id && timesJira.length > 0 && <div className="qh-settings-reconcile"><select aria-label={`Identidade Jira de ${t.nome}`} value={idsTimes[t.id] ?? ''} onChange={event => setIdsTimes(atual => ({ ...atual, [t.id]: event.target.value }))}><option value="">Selecione o time do Jira</option>{timesJira.map(jira => <option key={jira.id} value={jira.id}>{jira.name}</option>)}</select><button type="button" disabled={ocupado || !timesJira.some(jira => jira.id === idsTimes[t.id])} onClick={() => { const jira = timesJira.find(item => item.id === idsTimes[t.id]); if (jira) void identificarTime(t, jira) }}>Vincular ID</button></div>}</td><td><span className="qh-settings-link-state is-linked">Vinculado</span></td><td><button type="button" disabled={ocupado} onClick={() => void removerTime(t)}>Desvincular</button></td></tr>)}</tbody></table></div> : <p>{projetoId ? 'Nenhum time vinculado. Busque no Jira para adicionar.' : 'Selecione um projeto para consultar os times.'}</p>}
      {timesJira.length > 0 && <h4 className="qh-settings-results-title">Resultados do Jira <span>{timesJira.length} times</span></h4>}
      {timesJira.length > 0 && <div className="qh-settings-results"><table><thead><tr><th>Time / Squad</th><th>Vínculo</th><th>Ação</th></tr></thead><tbody>{timesJira.map(t => {
        const legados = timesProjeto.filter(x => !x.jira_id && mesmoNome(x.nome, t.name))
        const legado = legados.length === 1 ? legados[0] : undefined
        const vinculado = timeJaVinculado(config?.times ?? [], t, Number(projetoId))
        return <tr key={t.id}><td>{t.name}</td><td><span className={`qh-settings-link-state${vinculado ? ' is-linked' : ''}`}>{vinculado ? 'Vinculado' : 'Disponível'}</span></td><td>{legado ? <button type="button" disabled={ocupado} onClick={() => void identificarTime(legado, t)}>Vincular ID Jira</button> : !vinculado && <button type="button" disabled={ocupado} onClick={() => void cadastrarTime(t)}>Adicionar time</button>}</td></tr>
      })}</tbody></table></div>}

    </section>
    <section className="qh-settings-block" hidden={secao !== 'pessoas'}>
      <div className="qh-settings-block-heading"><h3>Pessoas do time</h3><span>{pessoasTime.length} vinculadas</span></div>
      {pessoasTime.length > 0 ? <div className="qh-settings-results qh-settings-members"><table><thead><tr><th>Pessoa</th><th>Cargo / função</th><th>Ações</th></tr></thead><tbody>{pessoasTime.map(p => <tr key={p.id}><td><strong>{p.nome}</strong>{!p.account_id && <small className="qh-settings-id-pending">ID Jira pendente</small>}{!p.account_id && pessoasJira.length > 0 && <div className="qh-settings-reconcile"><select aria-label={`Identidade Jira de ${p.nome}`} value={idsPessoas[p.id] ?? ''} onChange={event => setIdsPessoas(atual => ({ ...atual, [p.id]: event.target.value }))}><option value="">Selecione a pessoa do Jira</option>{pessoasJira.map(jira => <option key={jira.accountId} value={jira.accountId}>{jira.displayName}</option>)}</select><button type="button" disabled={ocupado || !pessoasJira.some(jira => jira.accountId === idsPessoas[p.id])} onClick={() => { const jira = pessoasJira.find(item => item.accountId === idsPessoas[p.id]); if (jira) void identificarPessoa(p, jira) }}>Vincular ID</button></div>}</td><td><input aria-label={`Cargo ou função de ${p.nome}`} placeholder="Sem função definida" maxLength={100} value={cargos[p.id] ?? p.cargo} onChange={event => setCargos(atual => ({ ...atual, [p.id]: event.target.value }))} /></td><td><div className="qh-settings-member-actions"><button type="button" disabled={ocupado} onClick={() => void atualizarCargo(p)}>Salvar função</button><button type="button" disabled={ocupado} onClick={() => void removerPessoa(p)}>Remover</button></div></td></tr>)}</tbody></table></div> : <p>{timeId ? 'Nenhuma pessoa vinculada. Busque no Jira para adicionar.' : 'Selecione o projeto e o time para consultar as pessoas.'}</p>}
      {pessoasJira.length > 0 && <h4 className="qh-settings-results-title">Resultados do Jira <span>{pessoasJira.length} pessoas</span></h4>}
      {pessoasJira.length > 0 && <div className="qh-settings-results"><table><thead><tr><th>Pessoa</th><th>Vínculo</th><th>Ação</th></tr></thead><tbody>{pessoasJira.map(p => {
        const vinculado = pessoaVinculada(config?.pessoas ?? [], p, Number(timeId))
        return <tr key={p.accountId}><td>{p.displayName}</td><td><span className={`qh-settings-link-state${vinculado ? ' is-linked' : ''}`}>{vinculado ? 'Vinculado' : 'Disponível'}</span></td><td>{vinculado ? <div className="qh-settings-member-actions">{!vinculado.account_id && <button type="button" disabled={ocupado} onClick={() => void identificarPessoa(vinculado, p)}>Vincular ID Jira</button>}<button type="button" disabled={ocupado} onClick={() => void removerPessoa(vinculado)}>Remover</button></div> : <button type="button" disabled={ocupado} onClick={() => void cadastrarPessoa(p)}>Adicionar pessoa</button>}</td></tr>
      })}</tbody></table></div>}

    </section>

  </div>
}
