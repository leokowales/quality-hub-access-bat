import { useState } from 'react'
import { UserRound, Monitor, Sun, Moon, Plug, FolderKanban, Users, Settings2, Check, Home, ChevronRight, DatabaseBackup, Download, Upload, RefreshCw, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react'
import type { Tema } from '../App'
import { API_URL, apiFetch } from '../services/api'
import { iniciaisPerfil, salvarPerfil, usePerfilLocal } from '../services/perfilLocal'
import type { PerfilLocal } from '../services/perfilLocal'
import GerenciarProjetos from './GerenciarProjetos'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import { consultarConexaoJira, desconectarJira } from '../services/conexaoJira'
import { useAtualizacoes, VERSAO_ATUAL } from '../services/useAtualizacoes'
import '../styles/pages/Configuracoes.css'
import InstalarAtualizacao from '../components/InstalarAtualizacao'

export type SecaoConfiguracoes = 'perfil' | 'aparencia' | 'integracoes' | 'backup' | 'atualizacoes' | 'projetos' | 'times' | 'pessoas'
type Props = { tema: Tema; onAlterarTema: (tema: Tema) => void; onInicio: () => void; secao: SecaoConfiguracoes; onMudarSecao: (secao: SecaoConfiguracoes) => void }
const secoes = [
  { grupo: 'Pessoal', itens: [{ id: 'perfil', nome: 'Meu perfil', icone: UserRound }, { id: 'aparencia', nome: 'Aparência', icone: Monitor }] },
  { grupo: 'Operacional', itens: [{ id: 'integracoes', nome: 'Integrações', icone: Plug }, { id: 'backup', nome: 'Backup', icone: DatabaseBackup }, { id: 'atualizacoes', nome: 'Atualizações', icone: RefreshCw }] },
  { grupo: 'Administração', itens: [{ id: 'projetos', nome: 'Projetos', icone: FolderKanban }, { id: 'times', nome: 'Times / Squads', icone: Users }, { id: 'pessoas', nome: 'Pessoas e funções', icone: UserRound }] },
] as const

function Perfil() {
  const { perfil, erro: erroConsulta } = usePerfilLocal()
  const [rascunho, setRascunho] = useState<PerfilLocal | null>(null)
  const atual = rascunho ?? perfil
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [salvando, setSalvando] = useState(false)
  const mudar = (campo: keyof PerfilLocal, valor: string | null) => { if (atual) { setRascunho({ ...atual, [campo]: valor }); setMensagem('') } }
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!atual || salvando) return
    setSalvando(true); setErro(''); setMensagem('')
    try { const valor = await salvarPerfil(atual); setRascunho(valor); setMensagem('Perfil atualizado.') }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha ao salvar.') }
    finally { setSalvando(false) }
  }
  return <><header className="qh-settings-content-heading"><h2>Meu perfil</h2><p>Suas informações de identificação no QualityHub.</p></header>
    {erroConsulta ? <p role="alert">{erroConsulta}</p> : !atual ? <p role="status">Consultando perfil...</p> : <form onSubmit={event => void salvar(event)}>
      <fieldset disabled={salvando} className="qh-settings-profile-fields is-profile"><div className="qh-settings-photo"><div className="qh-settings-avatar">{iniciaisPerfil(atual.nome)}</div><div><strong>Identificação do perfil</strong><p>As iniciais acompanham o nome informado.</p></div></div>
      <label>Nome *<input required maxLength={160} autoComplete="name" value={atual.nome} onChange={event => mudar('nome', event.target.value)} /></label>
      <label>E-mail<input type="email" value={atual.email} readOnly /><small>Vinculado à autorização de acesso.</small></label>
      <label>Cargo / função<input maxLength={100} autoComplete="organization-title" placeholder="Ex.: QA Engineer" value={atual.cargo} onChange={event => mudar('cargo', event.target.value)} /></label></fieldset>
      {erro && <p role="alert">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}<footer className="qh-settings-form-footer"><button className="qh-settings-save" type="submit" disabled={salvando || !atual.nome.trim()}><Check size={15} />{salvando ? 'Salvando...' : 'Salvar alterações'}</button></footer>
    </form>}</>
}

function Integracoes() {
  const consulta = useConsultaRecurso('jira-connection', consultarConexaoJira)
  const [url, setUrl] = useState<string | null>(null), [email, setEmail] = useState<string | null>(null), [token, setToken] = useState('')
  const urlAtual = url ?? consulta.dados?.url ?? ''
  const emailAtual = email ?? consulta.dados?.email ?? ''
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(''), [mensagem, setMensagem] = useState('')
  const desconectar = async () => {
    if (!window.confirm('Desconectar o Jira desta instalação? Os dados já sincronizados e os históricos serão preservados.')) return
    setOcupado(true); setErro(''); setMensagem('')
    try { await desconectarJira(); setUrl(''); setEmail(''); setToken(''); consulta.tentarNovamente(); setMensagem('Jira desconectado. Os dados locais foram preservados.') }
    catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha ao desconectar.') }
    finally { setOcupado(false) }
  }
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault(); setOcupado(true); setErro(''); setMensagem('')
    try {
      const resposta = await apiFetch(`${API_URL}/jira/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlAtual.trim(), email: emailAtual.trim(), token }) })
      const dados = await resposta.json()
      if (!resposta.ok) throw new Error(typeof dados.detail === 'string' ? dados.detail : 'Não foi possível validar a conexão.')
      setToken(''); consulta.tentarNovamente(); setMensagem(`Conexão validada e salva${dados.user ? ` para ${dados.user}` : ''}.`)
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na conexão.') }
    finally { setOcupado(false) }
  }
  return <><header className="qh-settings-content-heading"><h2>Integrações</h2><p>Gerencie a conexão usada para consultar e sincronizar o Jira.</p></header><div className="qh-settings-connection"><div><strong>{consulta.status === 'carregando' ? 'Consultando conexão...' : consulta.status === 'erro' ? 'Conexão indisponível para consulta' : consulta.dados?.configurada ? 'Conexão salva' : 'Jira não configurado'}</strong><p>{consulta.dados?.configurada ? `${consulta.dados.url} · ${consulta.dados.email}` : 'Configure a conexão para consultar o Jira.'}</p></div>{consulta.dados?.configurada && <button type="button" disabled={ocupado} onClick={() => void desconectar()}>Desconectar</button>}{consulta.status === 'erro' && <button type="button" onClick={consulta.tentarNovamente}>Tentar novamente</button>}</div><form onSubmit={event => void salvar(event)}><fieldset disabled={ocupado} className="qh-settings-profile-fields is-integration"><label>Instância Jira<input required type="url" placeholder="https://suaempresa.atlassian.net" value={urlAtual} onChange={event => setUrl(event.target.value)} /></label><label>E-mail do Jira<input required type="email" autoComplete="username" value={emailAtual} onChange={event => setEmail(event.target.value)} /></label><label>Token de acesso<input required type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} /><small>Informe os dados apenas para atualizar a conexão existente.</small></label></fieldset>{erro && <p role="alert">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}<footer className="qh-settings-form-footer"><button className="qh-settings-save" disabled={ocupado} type="submit"><Plug size={14} />{ocupado ? 'Validando...' : 'Validar e salvar conexão'}</button></footer></form></>
}

function Atualizacoes() {
  const consulta = useAtualizacoes()
  const consultando = consulta.status === 'consultando'
  const titulo = consultando ? 'Buscando atualizações...' : consulta.status === 'sem_canal' ? 'Canal de atualizações em preparação' : consulta.status === 'erro' ? 'Não foi possível verificar agora' : consulta.disponivel ? `Nova versão disponível: v${consulta.ultimaVersao?.versao}` : consulta.status === 'atual' ? 'Nenhuma nova versão disponível' : 'Verificar novas versões'
  const Icone = consultando ? RefreshCw : consulta.status === 'erro' ? AlertCircle : consulta.disponivel ? Download : consulta.status === 'atual' ? CheckCircle2 : Clock3
  return <><header className="qh-settings-content-heading"><h2>Atualizações</h2><p>Consulte as versões disponíveis para o QualityHub.</p></header>
    <div className={`qh-settings-update-status is-${consulta.status}`} role="status" aria-live="polite"><Icone size={22} className={consultando ? 'is-spinning' : undefined} /><div><strong>{titulo}</strong><p>{consulta.erro ?? (consulta.status === 'sem_canal' ? 'A primeira versão ainda não foi publicada para distribuição. O aviso de novas versões será ativado quando o canal estiver disponível.' : consultando ? 'Você pode continuar usando o QualityHub durante a consulta.' : consulta.disponivel ? 'Consulte as novidades antes de atualizar.' : 'A consulta automática ocorre ao abrir o QualityHub.')}</p></div></div>
    <dl className="qh-settings-update-details"><div><dt>Versão atual</dt><dd>v{VERSAO_ATUAL}</dd></div><div><dt>Canal</dt><dd>{VERSAO_ATUAL.includes('-rc.') ? 'Homologação' : 'Estável'}</dd></div><div><dt>Última consulta concluída</dt><dd>{consulta.verificadaEm ? new Date(consulta.verificadaEm).toLocaleString('pt-BR') : 'Ainda não realizada'}</dd></div></dl>
    <div className="qh-settings-update-actions"><button type="button" className="qh-settings-save" disabled={consultando || !consulta.canalConfigurado} title={!consulta.canalConfigurado ? 'Disponível após a publicação do canal de atualizações.' : undefined} onClick={() => void consulta.verificar()}><RefreshCw size={14} />{consultando ? 'Verificando...' : 'Verificar atualizações'}</button></div>
    {consulta.disponivel && consulta.ultimaVersao && <section className="qh-settings-block qh-settings-update-notes"><h3>Novidades da v{consulta.ultimaVersao.versao}</h3>{consulta.ultimaVersao.publicadaEm && <small>Publicada em {new Date(consulta.ultimaVersao.publicadaEm).toLocaleDateString('pt-BR')}</small>}<p>{consulta.ultimaVersao.notas || 'Não foram publicadas notas para esta versão.'}</p></section>}
    <InstalarAtualizacao disponivel={consulta.disponivel} />
  </>
}

export default function Configuracoes({ tema, onAlterarTema, onInicio, secao, onMudarSecao }: Props) {
  const atualizacoes = useAtualizacoes()
  const cadastro = ['projetos', 'times', 'pessoas'].includes(secao)
  return <div className="qh-settings"><nav className="qh-settings-breadcrumb" aria-label="Localização"><button type="button" onClick={onInicio} aria-label="Voltar ao Meu Quality Hub"><Home size={15} /></button><ChevronRight size={13} /><span>Configurações</span></nav>
    <div className="qh-settings-heading"><span><Settings2 size={25} strokeWidth={1.7} /></span><div><h1>Configurações</h1><p>Gerencie seu perfil, preferências e cadastros do QualityHub.</p></div></div>
    <div className="qh-settings-layout"><nav className="qh-settings-nav" aria-label="Categorias de configurações">{secoes.map(grupo => <section key={grupo.grupo}><h2>{grupo.grupo}</h2>{grupo.itens.map(item => <button key={item.id} type="button" aria-current={secao === item.id ? 'page' : undefined} onClick={() => onMudarSecao(item.id)}><item.icone size={17} strokeWidth={1.8} />{item.nome}{item.id === 'atualizacoes' && atualizacoes.disponivel && <span className="qh-settings-update-badge" aria-label="Nova versão disponível">1</span>}</button>)}</section>)}</nav>
    <section className="qh-settings-content" aria-label={secoes.map(grupo => grupo.itens.find(item => item.id === secao)?.nome).find(Boolean)}>
      {secao === 'perfil' && <Perfil />}
      {secao === 'aparencia' && <><header className="qh-settings-content-heading"><h2>Aparência</h2><p>Escolha o tema da interface. A preferência é aplicada automaticamente.</p></header><div className="qh-settings-themes">{([{ id: 'claro', nome: 'Claro', descricao: 'Superfícies claras', icone: Sun }, { id: 'escuro', nome: 'Escuro', descricao: 'Superfícies escuras', icone: Moon }, { id: 'automatico', nome: 'Sistema', descricao: 'Acompanha o dispositivo', icone: Monitor }] as const).map(item => <button key={item.id} type="button" className={`qh-settings-theme-option is-${item.id}`} aria-pressed={tema === item.id} onClick={() => onAlterarTema(item.id)}><span className="qh-settings-theme-preview" aria-hidden="true"><i /><span><b /><b /><b /></span></span><span className="qh-settings-theme-label"><item.icone size={16} /><strong>{item.nome}</strong>{tema === item.id && <Check size={14} />}</span><small>{item.descricao}</small></button>)}</div></>}
      {secao === 'integracoes' && <Integracoes />}
      {secao === 'atualizacoes' && <Atualizacoes />}
      {secao === 'backup' && <><header className="qh-settings-content-heading"><h2>Backup</h2><p>Cópias dos dados locais e recuperação de uma instalação anterior.</p></header><div className="qh-settings-backup-options"><section className="qh-settings-block"><h3><Download size={16} />Exportar backup</h3><p>Preserve projetos, times, pessoas, sprints e históricos em uma cópia local.</p></section><section className="qh-settings-block"><h3><Upload size={16} />Restaurar backup</h3><p>Recupere uma cópia vinculada ao mesmo e-mail e perfil de acesso.</p></section></div><p className="qh-settings-backup-pending" role="status">Exportação e restauração ainda não estão disponíveis.</p></>}
      <div hidden={!cadastro}><GerenciarProjetos secao={cadastro ? secao as 'projetos' | 'times' | 'pessoas' : 'projetos'} /></div>
    </section></div>
  </div>
}
