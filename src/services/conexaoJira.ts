import { API_URL, apiFetch } from './api'
export type ConexaoJira = { configurada: boolean; url: string | null; email: string | null }
async function requisitarConexao(method: 'GET' | 'DELETE'): Promise<ConexaoJira> {
  const response = await apiFetch(`${API_URL}/jira/connection`, { method })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível acessar a conexão Jira.')
  return body
}
export const consultarConexaoJira = () => requisitarConexao('GET')
export const desconectarJira = () => requisitarConexao('DELETE')
