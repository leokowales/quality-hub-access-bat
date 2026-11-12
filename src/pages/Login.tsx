import { useEffect, useState } from 'react'
import { API_URL, apiFetch } from '../services/api'
import { ArrowRight, ChartNoAxesCombined, ClipboardCheck, Eye, EyeOff, Info, Layers, LockKeyhole, LogIn, Mail, Monitor, Moon, Network, ShieldCheck, Sun } from 'lucide-react'
import type { Tema } from '../App'
import Brand from '../components/Brand'
import QualityHubMark from '../components/QualityHubMark'
import '../styles/pages/Login.css'
import '../styles/pages/LoginWeb.css'

type LoginProps = {
  visualWeb?: boolean
  primeiroAcesso: boolean
  autorizacaoValida: boolean
  emailAutorizado?: string
  mensagemAutorizacao: string | null
  onEntrar: (email: string, senha: string) => Promise<void>
  tema: Tema
  onAlterarTema: (tema: Tema) => void
}

const opcoesTema = [
  { valor: 'claro', nome: 'Claro', icone: Sun },
  { valor: 'escuro', nome: 'Escuro', icone: Moon },
  { valor: 'automatico', nome: 'Automático', icone: Monitor },
] as const

function Login({
  visualWeb = false,
  primeiroAcesso,
  autorizacaoValida,
  emailAutorizado = '',
  mensagemAutorizacao,
  onEntrar,
  tema,
  onAlterarTema,
}: LoginProps) {
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [email, setEmail] = useState('')
  const emailAtual = emailAutorizado || email
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [ativacao, setAtivacao] = useState(false)
  const [codigo, setCodigo] = useState('')

  useEffect(() => {
    if (autorizacaoValida) return
    const controller = new AbortController()
    apiFetch(`${API_URL}/authorization/activation`, { signal: controller.signal })
      .then(response => response.json()).then(data => setAtivacao(Boolean(data.enabled)))
      .catch(() => {})
    return () => controller.abort()
  }, [autorizacaoValida])

  async function ativar(verificar = false) {
    setMensagem('')
    setEnviando(true)
    try {
      const response = await apiFetch(`${API_URL}/authorization/activation/${verificar ? 'check' : 'request'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: verificar ? undefined : JSON.stringify({ email: emailAtual }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Confira o e-mail informado.')
      if (verificar) window.location.reload()
      else setCodigo(data.code)
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Não foi possível consultar a liberação.')
    } finally { setEnviando(false) }
  }

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMensagem('')
    if (!autorizacaoValida && ativacao) { await ativar(); return }
    if (primeiroAcesso && senha !== confirmacao) {
      setMensagem('As senhas precisam ser iguais.')
      return
    }
    setEnviando(true)
    try {
      await onEntrar(emailAtual, senha)
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Nao foi possivel validar o acesso.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className={`login-page${visualWeb ? ' login-web' : ''}`}>
      {visualWeb && <header className="login-web-header"><Brand variant="dark" /></header>}
      <section className="brand-panel">
        {!visualWeb && <Brand variant="light" />}

        {visualWeb ? <div className="login-web-story">
          <span className="eyebrow">QUALIDADE COM CONTEXTO</span>
          <h1>Mais clareza.<br />Melhores decisões.<br /><em>Mais qualidade.</em></h1>
          <p>Da execução à rastreabilidade, conecte o que<br className="login-web-break" /> importa para evoluir seu produto.</p>
          <div className="login-web-features">
            <div><span><ClipboardCheck size={19} /></span><strong>Execução</strong><small>Cada teste conta.</small></div>
            <div><span><Network size={19} /></span><strong>Rastreabilidade</strong><small>Tudo conectado.</small></div>
            <div><span><ChartNoAxesCombined size={19} /></span><strong>Indicadores</strong><small>Contexto para agir.</small></div>
          </div>
          <div className="login-web-summary"><Layers size={17} />Uma visão integrada da qualidade.</div>
        </div> : <>
        <div className="brand-content">
          <span className="eyebrow">QUALIDADE COM CONTEXTO</span>

          <h1>
            Enxergue a
            <br />
            qualidade além
            <br />
            dos números.
          </h1>

          <p>
            Conecte execução, rastreabilidade e indicadores
            para tomar decisões melhores sobre a qualidade
            do seu produto.
          </p>

          <div className="feature">
            <span className="feature-number">01</span>
            <p>
              Indicadores operacionais
              <br />
              e gerenciais.
            </p>
          </div>

          <div className="feature">
            <span className="feature-number">02</span>
            <p>
              Rastreabilidade de testes
              <br />
              e defeitos.
            </p>
          </div>

          <div className="feature">
            <span className="feature-number">03</span>
            <p>
              Informações para decisões
              <br />
              mais confiáveis.
            </p>
          </div>
        </div>

        <footer>Quality Hub · Plataforma integrada de qualidade</footer>
        </>}
      </section>

      <section className="form-panel">
        <div
          className="login-theme-control"
          role="group"
          aria-label="Tema da interface"
        >
          {opcoesTema.map(({ valor, nome, icone: Icone }) => (
            <button
              key={valor}
              type="button"
              className={`theme-option ${tema === valor ? 'active' : ''}`}
              onClick={() => onAlterarTema(valor)}
              aria-label={`Tema ${nome.toLowerCase()}`}
              aria-pressed={tema === valor}
              title={nome}
            >
              <Icone size={18} />
            </button>
          ))}
        </div>

        <div className="login-form">
          <div className="mobile-brand">
            <div className="brand-logo"><QualityHubMark size={30} /></div>
            <span>Quality Hub</span>
          </div>

          <span className="eyebrow form-eyebrow">
            {primeiroAcesso ? 'PRIMEIRO ACESSO' : 'BEM-VINDO DE VOLTA'}
          </span>

          <h2>{!autorizacaoValida && ativacao ? 'Libere esta instalação' : primeiroAcesso ? 'Crie seu acesso local' : visualWeb ? <>Seu próximo passo<br />começa aqui.</> : 'Acesse sua conta'}</h2>

          <p className="description">
            {!autorizacaoValida && ativacao
              ? 'Informe seu e-mail corporativo para solicitar a aprovação deste computador.'
              : primeiroAcesso
              ? 'Informe o e-mail autorizado e crie uma senha para esta instalacao.'
              : visualWeb ? 'Entre na sua conta do QualityHub.' : 'Entre com suas credenciais para continuar na plataforma.'}
          </p>

          <form onSubmit={enviar}>
            <label htmlFor="email">E-mail corporativo</label>

            <div className="login-email-input">
            {visualWeb && <Mail size={17} aria-hidden="true" />}
            <input
              id="email"
              type="email"
              placeholder="pessoa@empresa.com"
              autoComplete="username"
              value={emailAtual}
              readOnly={Boolean(emailAutorizado)}
              onChange={event => setEmail(event.target.value)}
              required
            disabled={(!autorizacaoValida && !ativacao) || enviando || Boolean(codigo)}
            />
            </div>

            {autorizacaoValida && <div className="password-field">
              <label htmlFor="password">{primeiroAcesso ? 'Crie uma senha' : 'Senha'}</label>

              <div className="password-input-wrapper" onKeyDown={event => {
                if (event.altKey && event.key.toLowerCase() === 'v') {
                  event.preventDefault()
                  setMostrarSenha(atual => !atual)
                }
              }}>
                {visualWeb && <LockKeyhole className="login-web-lock" size={17} aria-hidden="true" />}
                <input
                  id="password"
                  type={mostrarSenha ? 'text' : 'password'}
                  placeholder={primeiroAcesso ? 'Minimo de 8 caracteres' : 'Digite sua senha'}
                  autoComplete={primeiroAcesso ? 'new-password' : 'current-password'}
                  value={senha}
                  onChange={event => setSenha(event.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={!autorizacaoValida || enviando}
                />

                <button
                  type="button"
                  className="toggle-password"
                  tabIndex={-1}
                  onClick={() => setMostrarSenha((atual) => !atual)}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={mostrarSenha}
                  aria-keyshortcuts="Alt+V"
                  title={mostrarSenha ? 'Ocultar senha (Alt+V)' : 'Mostrar senha (Alt+V)'}
                >
                  {mostrarSenha ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>

            </div>}

            {autorizacaoValida && primeiroAcesso && <div className="password-field">
              <label htmlFor="confirm-password">Confirme sua senha</label>
              <input id="confirm-password" type="password" autoComplete="new-password"
                value={confirmacao} onChange={event => setConfirmacao(event.target.value)} required
                minLength={8} maxLength={128} disabled={enviando} />
            </div>}

            {!autorizacaoValida && ativacao && codigo && <div className="activation-code">
              <p>Envie este código ao responsável pelo seu canal corporativo. Após a aprovação, verifique a liberação para criar sua senha.</p>
              <label htmlFor="activation-code">Código desta instalação</label>
              <textarea id="activation-code" readOnly value={codigo} rows={3} />
              <button type="button" onClick={() => {
                navigator.clipboard.writeText(codigo).then(() => setMensagem('Código copiado.'))
                  .catch(() => setMensagem('Selecione o código acima e copie manualmente.'))
              }}>Copiar código</button>
              <button type="button" disabled={enviando} onClick={() => void ativar(true)}>Verificar liberação</button>
            </div>}

            {!(ativacao && codigo && !autorizacaoValida) && <button className="login-button" type="submit" disabled={(!autorizacaoValida && !ativacao) || enviando}>
              {!visualWeb && <LogIn size={18} strokeWidth={2} />}
              <span>{enviando ? 'Validando...' : !autorizacaoValida && ativacao ? 'Gerar código de liberação' : primeiroAcesso ? 'Criar acesso e continuar' : visualWeb ? 'Entrar no QualityHub' : 'Entrar na plataforma'}</span>
              {visualWeb && <ArrowRight size={18} aria-hidden="true" />}
            </button>}

            {mensagem && (
              <p className="form-message" role="alert">
                {mensagem}
              </p>
            )}
            {mensagemAutorizacao && !codigo && <p className="form-message" role="alert">{mensagemAutorizacao}</p>}
          </form>

          <div className="access-notice">
            <Info
              className="notice-icon"
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
            />

            <p>
              O acesso é liberado por convite ou pela administração
              do Quality Hub.
            </p>
          </div>

          <footer className="form-footer">
            {visualWeb && <ShieldCheck size={16} aria-hidden="true" />}
            Acesso restrito a usuários autorizados.
          </footer>
        </div>
      </section>
      {visualWeb && <footer className="login-web-footer"><span>QualityHub <b>·</b> Quality Intelligence</span><span>Qualidade em cada entrega.</span></footer>}
    </main>
  )
}

export default Login
