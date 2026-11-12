type Opcoes = {
  apiUrl: string
  armazenamento: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  buscar: typeof fetch
  aoInvalidar: () => void
}

const CHAVE = 'quality-hub-sessao-local'

export function criarClienteLocal({ apiUrl, armazenamento, buscar, aoInvalidar }: Opcoes) {
  let token: string | null = null
  try {
    const salvo = armazenamento.getItem(CHAVE)
    if (salvo && /^[\w-]{43}$/.test(salvo)) token = salvo
  } catch { /* Memória funciona sem armazenamento. */ }
  const base = new URL(apiUrl)

  function salvarSessao(novoToken: string) {
    if (!/^[\w-]{43}$/.test(novoToken)) throw new Error('Resposta de login inválida.')
    token = novoToken
    try { armazenamento.setItem(CHAVE, token) } catch { /* Sessão restrita a esta abertura. */ }
  }

  function limparSessao() {
    token = null
    try { armazenamento.removeItem(CHAVE) } catch { /* Limpeza em memória já concluída. */ }
  }

  const apiFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base)
    if (url.origin !== base.origin || !(url.pathname === base.pathname.replace(/\/$/, '') ||
      url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'))) {
      throw new Error('A sessão local só pode ser usada na API do QualityHub.')
    }
    const usado = token
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.delete('Authorization')
    if (usado) headers.set('Authorization', `Bearer ${usado}`)
    const resposta = await buscar(input instanceof Request ? input : url.href, { ...init, headers, redirect: 'error', cache: 'no-store', credentials: 'omit' })
    if (resposta.headers.get('X-QualityHub-Session') === 'invalid' && usado === token) {
      limparSessao()
      aoInvalidar()
    }
    return resposta
  }

  async function encerrarSessao() {
    const usado = token
    if (usado) {
      const resposta = await apiFetch(`${apiUrl.replace(/\/$/, '')}/authorization/logout`, { method: 'POST' })
      if (!resposta.ok) throw new Error('Não foi possível confirmar a saída. Tente novamente.')
    }
    if (token === usado) limparSessao()
  }

  return { apiFetch, salvarSessao, encerrarSessao, limparSessao, possuiSessao: () => Boolean(token) }
}
