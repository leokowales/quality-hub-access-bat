import { API_URL, apiFetch } from './api'

export type SituacaoAcesso = {
  valid: boolean
  has_local_user: boolean
  onboarding_pending: boolean
  email?: string | null
  detail?: string | null
}

// Consultar de novo após autenticar: criar a senha muda o estado de primeiro
// acesso no backend, mesmo que a tela de login continue montada depois de sair.
export async function consultarSituacaoAcesso(signal?: AbortSignal): Promise<SituacaoAcesso> {
  const resposta = await apiFetch(`${API_URL}/authorization/status`, { signal })
  if (!resposta.ok) throw new Error('Não foi possível consultar a autorização.')
  const dados = await resposta.json() as SituacaoAcesso
  if (typeof dados.valid !== 'boolean' || typeof dados.has_local_user !== 'boolean' || typeof dados.onboarding_pending !== 'boolean') {
    throw new Error('O serviço retornou uma situação de acesso inválida.')
  }
  return dados
}
