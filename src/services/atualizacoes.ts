export type VersaoPublicada = { versao: string; notas: string; publicadaEm: string | null }
export type EstadoAtualizacao = {
  status: 'inativo' | 'consultando' | 'sem_canal' | 'atual' | 'disponivel' | 'erro'
  ultimaVersao: VersaoPublicada | null
  verificadaEm: string | null
  erro: string | null
}

function partesVersao(valor: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(valor)
  if (!match || valor.length > 128) throw new Error('Número de versão inválido.')
  const pre = match[4]?.split('.') ?? []
  if (pre.some(parte => /^\d+$/.test(parte) && parte.length > 1 && parte.startsWith('0'))) throw new Error('Número de versão inválido.')
  return { numeros: match.slice(1, 4).map(BigInt), pre }
}

export function compararVersoes(a: string, b: string): number {
  const esquerda = partesVersao(a), direita = partesVersao(b)
  for (let i = 0; i < 3; i++) {
    if (esquerda.numeros[i] !== direita.numeros[i]) return esquerda.numeros[i] > direita.numeros[i] ? 1 : -1
  }
  if (!esquerda.pre.length || !direita.pre.length) return esquerda.pre.length ? -1 : direita.pre.length ? 1 : 0
  for (let i = 0; i < Math.max(esquerda.pre.length, direita.pre.length); i++) {
    const x = esquerda.pre[i], y = direita.pre[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

function urlPublica(valor: unknown) {
  if (typeof valor !== 'string') throw new Error('Endereço de atualização inválido.')
  let url: URL
  try { url = new URL(valor) } catch { throw new Error('Endereço de atualização inválido.') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('O canal de atualizações precisa usar HTTPS, sem credenciais no endereço.')
  return url.href
}

export function consultaCanal(canal: string) {
  const original = urlPublica(canal)
  const url = new URL(original)
  const partes = url.pathname.split('/').filter(Boolean)
  if (url.hostname !== 'raw.githubusercontent.com' || url.port || url.search || url.hash || partes.length < 4) {
    return { url: original, headers: { Accept: 'application/json' } }
  }
  const [owner, repo, ref, ...arquivo] = partes.map(decodeURIComponent)
  const endpoint = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${arquivo.map(encodeURIComponent).join('/')}`)
  endpoint.searchParams.set('ref', ref)
  endpoint.searchParams.set('qh', crypto.randomUUID())
  return { url: endpoint.href, headers: { Accept: 'application/vnd.github.raw+json' } }
}

export function lerManifesto(valor: unknown, plataforma = 'windows-x86_64', permitirPreRelease = false): VersaoPublicada {
  if (!valor || typeof valor !== 'object') throw new Error('Informações da atualização inválidas.')
  const dados = valor as Record<string, unknown>
  if (typeof dados.version !== 'string' || (partesVersao(dados.version).pre.length && !(permitirPreRelease && /^\d+\.\d+\.\d+-rc\.[1-9]\d*$/.test(dados.version)))) throw new Error('O canal precisa publicar uma versão válida para este aplicativo.')
  const plataformas = dados.platforms as Record<string, unknown> | undefined
  const pacote = plataformas?.[plataforma] as Record<string, unknown> | undefined
  if (!pacote || typeof pacote.signature !== 'string' || !pacote.signature.trim()) throw new Error('As informações do pacote de atualização estão incompletas.')
  urlPublica(pacote.url)
  if (dados.notes !== undefined && (typeof dados.notes !== 'string' || dados.notes.length > 20000)) throw new Error('Descrição de atualização inválida.')
  if (dados.pub_date !== undefined && (typeof dados.pub_date !== 'string' || !Number.isFinite(Date.parse(dados.pub_date)))) throw new Error('Data de publicação inválida.')
  // A presença da assinatura é metadado. Sua verificação criptográfica cabe ao
  // instalador nativo, que ainda não está integrado ao aplicativo de desenvolvimento.
  return { versao: dados.version.replace(/^v/, ''), notas: typeof dados.notes === 'string' ? dados.notes : '', publicadaEm: typeof dados.pub_date === 'string' ? dados.pub_date : null }
}

export function criarGerenciadorAtualizacoes({ canal, versaoAtual, plataforma = 'windows-x86_64', buscar = fetch, agora = () => new Date(), timeout = 8000, permitirPreRelease = false }: {
  canal: string; versaoAtual: string; plataforma?: string; buscar?: typeof fetch; agora?: () => Date; timeout?: number; permitirPreRelease?: boolean
}) {
  let estado: EstadoAtualizacao = { status: 'inativo', ultimaVersao: null, verificadaEm: null, erro: null }
  let iniciada = false
  let pendente: Promise<void> | null = null
  const ouvintes = new Set<() => void>()
  const publicar = (novo: EstadoAtualizacao) => { estado = novo; ouvintes.forEach(ouvinte => ouvinte()) }
  const verificar = (automatica = false): Promise<void> => {
    if (pendente) return pendente
    if (automatica && iniciada) return Promise.resolve()
    iniciada = true
    if (!canal.trim()) { publicar({ ...estado, status: 'sem_canal', erro: null }); return Promise.resolve() }
    const anterior = estado
    publicar({ ...estado, status: 'consultando', erro: null })
    const controller = new AbortController()
    const limite = setTimeout(() => controller.abort(), timeout)
    pendente = Promise.resolve().then(async () => {
      try {
        const consulta = consultaCanal(canal.trim())
        const resposta = await buscar(consulta.url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: consulta.headers })
        if (!resposta.ok) throw new Error('O serviço de atualizações está indisponível. Tente novamente mais tarde.')
        if (resposta.url) urlPublica(resposta.url)
        const texto = await resposta.text()
        if (texto.length > 256000) throw new Error('As informações da atualização são inválidas.')
        const ultimaVersao = lerManifesto(JSON.parse(texto), plataforma, permitirPreRelease)
        const disponivel = compararVersoes(ultimaVersao.versao, versaoAtual) > 0
        publicar({ status: disponivel ? 'disponivel' : 'atual', ultimaVersao, verificadaEm: agora().toISOString(), erro: null })
      } catch (erro) {
        const mensagem = controller.signal.aborted ? 'A consulta demorou mais que o esperado. Tente novamente.' : erro instanceof TypeError ? 'Não foi possível consultar as atualizações. Confira sua conexão e tente novamente.' : erro instanceof SyntaxError ? 'O canal não retornou informações de atualização válidas.' : erro instanceof Error ? erro.message : 'Não foi possível verificar as atualizações.'
        publicar({ ...anterior, status: 'erro', erro: mensagem })
      } finally { clearTimeout(limite); pendente = null }
    })
    return pendente
  }
  return {
    obter: () => estado,
    assinar: (ouvinte: () => void) => { ouvintes.add(ouvinte); return () => { ouvintes.delete(ouvinte) } },
    verificar,
  }
}
