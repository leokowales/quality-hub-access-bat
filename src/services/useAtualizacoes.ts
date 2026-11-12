import { useEffect, useSyncExternalStore } from 'react'
import { version } from '../../package.json'
import { compararVersoes, criarGerenciadorAtualizacoes } from './atualizacoes'

export const VERSAO_ATUAL = import.meta.env.VITE_QUALITYHUB_VERSION || version
const canal = import.meta.env.VITE_QUALITYHUB_UPDATE_URL?.trim() ?? ''
const gerenciador = criarGerenciadorAtualizacoes({ canal, versaoAtual: VERSAO_ATUAL, permitirPreRelease: import.meta.env.VITE_QUALITYHUB_TEST_CHANNEL === '1' })
const verificar = () => gerenciador.verificar()

export function useAtualizacoes() {
  const estado = useSyncExternalStore(gerenciador.assinar, gerenciador.obter, gerenciador.obter)
  useEffect(() => { void gerenciador.verificar(true) }, [])
  return { ...estado, verificar, canalConfigurado: Boolean(canal),
    disponivel: Boolean(estado.ultimaVersao && compararVersoes(estado.ultimaVersao.versao, VERSAO_ATUAL) > 0) }
}
