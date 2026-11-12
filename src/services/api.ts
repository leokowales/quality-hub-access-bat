import { criarClienteLocal } from './sessaoLocal'

export const API_URL = (import.meta.env.VITE_QUALITYHUB_DESKTOP === '1'
  ? window.location.origin
  : import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8010').replace(/\/+$/, '')

const cliente = criarClienteLocal({
  apiUrl: API_URL,
  armazenamento: {
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: key => window.sessionStorage.removeItem(key),
  },
  buscar: window.fetch.bind(window),
  aoInvalidar: () => window.dispatchEvent(new Event('quality-hub-sessao-invalidada')),
})

export const { apiFetch, salvarSessao, encerrarSessao, limparSessao, possuiSessao } = cliente
