
import { useEffect, useState } from 'react'
import { API_URL, apiFetch, salvarSessao, encerrarSessao, limparSessao, possuiSessao } from './services/api'
import Login from './pages/Login'
import MeuQualityHub from './components/MeuQualityHub'
import NovaIteracao from './pages/NovaIteracao'
import CentralRevisao from './pages/CentralRevisao'
import Configuracoes from './pages/Configuracoes'
import type { SecaoConfiguracoes } from './pages/Configuracoes'
import { useAtualizacoes } from './services/useAtualizacoes'
import { consultarSituacaoAcesso } from './services/situacaoAcesso'

type Tela =
  | 'login'
  | 'inicio'
  | 'nova-iteracao'

type Secao = 'inicio' | 'central-revisao' | 'projetos' | 'rastreabilidade'

export type Tema = 'claro' | 'escuro' | 'automatico'

const CHAVE_TELA = 'quality-hub-tela'
const CHAVE_SECAO = 'quality-hub-secao'

function obterTemaInicial(): Tema {
  const tema = localStorage.getItem('quality-hub-tema')

  return tema === 'claro' ||
    tema === 'escuro' ||
    tema === 'automatico'
    ? tema
    : 'automatico'
}

function obterTelaInicial(): Tela {
  if (!possuiSessao()) {
    return 'login'
  }

  const tela = localStorage.getItem(CHAVE_TELA)

  if (
    tela === 'inicio' ||
    tela === 'nova-iteracao'
  ) {
    return tela
  }

  return 'inicio'
}

function obterSecaoInicial(): Secao {
  if (!possuiSessao()) {
    return 'inicio'
  }

  const secao = localStorage.getItem(CHAVE_SECAO)
  return secao === 'central-revisao' || secao === 'projetos' || secao === 'rastreabilidade' ? secao : 'inicio'
}

function App() {
  useAtualizacoes()
  const [secaoConfiguracoes, setSecaoConfiguracoes] = useState<SecaoConfiguracoes>('perfil')
  const [tela, setTela] = useState<Tela>(obterTelaInicial)
  const [secao, setSecao] = useState<Secao>(obterSecaoInicial)
  const [chaveCentralRevisao, setChaveCentralRevisao] = useState(0)
  const [tema, setTema] = useState<Tema>(obterTemaInicial)
  const [verificandoSessao, setVerificandoSessao] = useState(possuiSessao)
  const [saindo, setSaindo] = useState(false)
  const [erroSaida, setErroSaida] = useState<string | null>(null)
  const [mensagemAutorizacao, setMensagemAutorizacao] = useState<string | null>(null)

  useEffect(() => {
    localStorage.removeItem('quality-hub-sessao-provisoria')
    let cancelado = false
    function invalidar() {
      setTela('login')
      setSecao('inicio')
      setMensagemAutorizacao('Sua sessão foi encerrada. Entre novamente para continuar.')
    }
    window.addEventListener('quality-hub-sessao-invalidada', invalidar)
    if (possuiSessao()) {
      apiFetch(`${API_URL}/authorization/session`)
        .then(response => { if (!response.ok && !cancelado) setTela('login') })
        .catch(() => { if (!cancelado) setTela('login') })
        .finally(() => { if (!cancelado) setVerificandoSessao(false) })
    }
    return () => {
      cancelado = true
      window.removeEventListener('quality-hub-sessao-invalidada', invalidar)
    }
  }, [])

  function abrirAtualizacoes() {
    setSecaoConfiguracoes('atualizacoes')
    setSecao('projetos')
    setTela('inicio')
    localStorage.setItem(CHAVE_TELA, 'inicio')
    localStorage.setItem(CHAVE_SECAO, 'projetos')
  }

  const [verificandoConfiguracao, setVerificandoConfiguracao] =
    useState(false)

  const [erroConfiguracao, setErroConfiguracao] =
    useState<string | null>(null)
  const [autorizacaoValida, setAutorizacaoValida] = useState(false)
  const [primeiroAcesso, setPrimeiroAcesso] = useState(false)
  const [emailAutorizado, setEmailAutorizado] = useState('')

  useEffect(() => {
    if (tema === 'automatico') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.dataset.theme =
        tema === 'claro' ? 'light' : 'dark'
    }

    localStorage.setItem('quality-hub-tema', tema)
  }, [tema])

  useEffect(() => {
    let diaVerificado = ''
    let cancelado = false
    function verificar() {
      const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
      if (diaVerificado === dia || document.visibilityState === 'hidden') return
      diaVerificado = dia
      consultarSituacaoAcesso()
      .then(data => {
        if (cancelado) return
        setAutorizacaoValida(Boolean(data.valid))
        setPrimeiroAcesso(Boolean(data.valid) && !data.has_local_user)
        setEmailAutorizado(data.valid ? data.email ?? '' : '')
        setMensagemAutorizacao(
          data.valid
            ? null
            : data.detail === 'Not Found'
              ? 'O backend em execucao ainda nao possui a atualizacao de autorizacao. Reinicie-o e tente novamente.'
              : data.detail || 'Autorizacao indisponivel.'
        )
        if (!data.valid) {
          limparSessao()
          setTela('login')
        }
      })
      .catch(() => {
        if (cancelado) return
        diaVerificado = ''
        setAutorizacaoValida(false)
        setMensagemAutorizacao('Nao foi possivel verificar a autorizacao. Verifique se o backend esta em execucao.')
        setTela('login')
      })
    }
    verificar()
    const timer = window.setInterval(verificar, 60_000)
    window.addEventListener('focus', verificar)
    document.addEventListener('visibilitychange', verificar)
    return () => {
      cancelado = true
      window.clearInterval(timer)
      window.removeEventListener('focus', verificar)
      document.removeEventListener('visibilitychange', verificar)
    }
  }, [])

  useEffect(() => {
    if (!possuiSessao()) return

    if (
      tela === 'inicio' ||
      tela === 'nova-iteracao'
    ) {
      localStorage.setItem(CHAVE_TELA, tela)
    }
  }, [tela])

  useEffect(() => {
    if (!possuiSessao()) return

    localStorage.setItem(CHAVE_SECAO, secao)
  }, [secao])

  function navegarPara(destino: Tela) {
    setTela(destino)
  }

  async function sairDoQualityHub() {
    if (saindo) return
    setSaindo(true)
    setErroSaida(null)
    try {
      await encerrarSessao()
    } catch {
      setErroSaida('Não foi possível confirmar a saída do QualityHub. Tente novamente.')
      return
    } finally {
      setSaindo(false)
    }
    localStorage.removeItem(CHAVE_TELA)
    localStorage.removeItem(CHAVE_SECAO)

    setSecao('inicio')
    setErroConfiguracao(null)
    navegarPara('login')
  }

  async function entrarNoQualityHub(email: string, senha: string) {
    if (verificandoConfiguracao) return

    setVerificandoConfiguracao(true)
    setErroConfiguracao(null)

    try {
      const endpoint = primeiroAcesso ? 'setup' : 'login'
      const acesso = await apiFetch(`${API_URL}/authorization/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: senha }),
      })
      if (!acesso.ok) {
        const erroAcesso = await acesso.json().catch(() => null)
        const detalhe = erroAcesso?.detail
        throw new Error(
          typeof detalhe === 'string'
            ? detalhe
            : 'A senha deve ter pelo menos 8 caracteres.'
        )
      }
      const sessao = await acesso.json()
      salvarSessao(sessao.access_token)
      const situacao = await consultarSituacaoAcesso()
      if (!situacao.valid) throw new Error(situacao.detail || 'A autorização não está válida.')
      setEmailAutorizado(situacao.email ?? '')
      setPrimeiroAcesso(false)
      localStorage.setItem(CHAVE_TELA, 'inicio')
      localStorage.setItem(CHAVE_SECAO, 'inicio')
      setSecao('inicio')
      navegarPara('inicio')
    } catch (erro) {
      console.error(erro)

      setErroConfiguracao(
        'Não foi possível acessar os cadastros do QualityHub. ' +
        'Verifique se o backend está funcionando.'
      )
      throw erro
    } finally {
      setVerificandoConfiguracao(false)
    }
  }

  if (verificandoSessao) return <p role="status">Validando acesso local...</p>

  if (erroSaida) return <main><p role="alert">{erroSaida}</p><button type="button" disabled={saindo} onClick={() => void sairDoQualityHub()}>Tentar sair novamente</button><button type="button" onClick={() => setErroSaida(null)}>Voltar ao QualityHub</button></main>

  if (tela === 'nova-iteracao') {
    return (
      <MeuQualityHub
        onAbrirAtualizacoes={abrirAtualizacoes}
        exibindoAtualizacoes={secao === 'projetos' && secaoConfiguracoes === 'atualizacoes'}
        onSair={sairDoQualityHub}
        tema={tema}
        onAlterarTema={setTema}
        secao="central-revisao"
        tituloPagina="Central de Revisão"
        onMudarSecao={novaSecao => {
          if (novaSecao === 'projetos') setSecaoConfiguracoes('perfil')
          if (novaSecao === 'central-revisao') {
            sessionStorage.removeItem('quality-hub-revisao-iteracao-aberta')
            setChaveCentralRevisao(chave => chave + 1)
          }
          setSecao(novaSecao)
          navegarPara('inicio')
        }}
      >
        <NovaIteracao
          onVoltar={() => {
            setSecao('central-revisao')
            navegarPara('inicio')
          }}
          onAbrirRevisaoDados={() => {
            setSecao('central-revisao')
            setChaveCentralRevisao(chave => chave + 1)
            navegarPara('inicio')
          }}
        />
      </MeuQualityHub>
    )
  }

  if (tela === 'inicio') {
    return (
      <MeuQualityHub
        onAbrirAtualizacoes={abrirAtualizacoes}
        exibindoAtualizacoes={secao === 'projetos' && secaoConfiguracoes === 'atualizacoes'}
        onSair={sairDoQualityHub}
        tema={tema}
        onAlterarTema={setTema}
        secao={secao}
        onMudarSecao={novaSecao => {
          if (novaSecao === 'projetos') setSecaoConfiguracoes('perfil')
          if (novaSecao === 'central-revisao') {
            sessionStorage.removeItem('quality-hub-revisao-iteracao-aberta')
            setChaveCentralRevisao(chave => chave + 1)
          }

          setSecao(novaSecao)
        }}
      >
        {secao === 'projetos' && <Configuracoes tema={tema} onAlterarTema={setTema} onInicio={() => setSecao('inicio')} secao={secaoConfiguracoes} onMudarSecao={setSecaoConfiguracoes} />}
        {secao === 'central-revisao' && (
          <CentralRevisao key={chaveCentralRevisao} onNovaIteracao={() => navegarPara('nova-iteracao')} />
        )}
      </MeuQualityHub>
    )
  }

  return (
    <>
      <Login
        visualWeb
        onEntrar={entrarNoQualityHub}
        primeiroAcesso={primeiroAcesso}
        autorizacaoValida={autorizacaoValida}
        emailAutorizado={emailAutorizado}
        mensagemAutorizacao={erroConfiguracao ?? mensagemAutorizacao}
        tema={tema}
        onAlterarTema={setTema}
      />

    </>
  )
}

export default App
