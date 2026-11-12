import { useEffect, useState } from 'react'
import { API_URL, apiFetch } from './api'

export type PerfilLocal = { email: string; nome: string; cargo: string }
const eventoPerfil = 'qualityhub-perfil-atualizado'
export const iniciaisPerfil = (nome: string) => nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(parte => parte[0]).join('').toUpperCase() || 'QH'
export async function consultarPerfil(): Promise<PerfilLocal> {
  const resposta = await apiFetch(`${API_URL}/authorization/profile`)
  if (!resposta.ok) throw new Error('Não foi possível consultar seu perfil.')
  return resposta.json()
}
export async function salvarPerfil(perfil: PerfilLocal): Promise<PerfilLocal> {
  const resposta = await apiFetch(`${API_URL}/authorization/profile`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: perfil.nome, cargo: perfil.cargo }),
  })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(typeof dados.detail === 'string' ? dados.detail : 'Não foi possível salvar seu perfil.')
  window.dispatchEvent(new CustomEvent(eventoPerfil, { detail: dados }))
  return dados
}
export function usePerfilLocal() {
  const [perfil, setPerfil] = useState<PerfilLocal | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let ativo = true
    consultarPerfil().then(valor => { if (ativo) setPerfil(valor) }).catch(falha => { if (ativo) setErro(falha.message) })
    const atualizar = (evento: Event) => { setPerfil((evento as CustomEvent<PerfilLocal>).detail); setErro('') }
    window.addEventListener(eventoPerfil, atualizar)
    return () => { ativo = false; window.removeEventListener(eventoPerfil, atualizar) }
  }, [])
  return { perfil, erro }
}
