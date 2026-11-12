import { useEffect, useState } from 'react'
import { API_URL, apiFetch } from '../services/api'

export default function InstalarAtualizacaoLocal() {
  const [habilitado, setHabilitado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  useEffect(() => {
    let ativo = true
    void apiFetch(`${API_URL}/local-updates/status`).then(async resposta => {
      if (!resposta.ok) return
      const dados = await resposta.json() as { enabled: boolean }
      if (ativo) setHabilitado(dados.enabled)
    }).catch(() => { /* Older or unmanaged backends use the BAT fallback. */ })
    return () => { ativo = false }
  }, [])
  useEffect(() => {
    if (!iniciando) return
    const timer = window.setInterval(() => {
      void apiFetch(`${API_URL}/local-updates/status`).then(async resposta => {
        if (!resposta.ok) return
        const dados = await resposta.json() as { applying: boolean; result: number | null }
        if (!dados.applying && dados.result !== null) {
          setIniciando(false)
          setConfirmando(false)
          setMensagem(dados.result === 0
            ? 'Consulta concluída. O sistema está na versão publicada.'
            : 'A atualização foi interrompida. Preserve os dados e consulte o suporte ou execute Atualizar QualityHub.bat para conferir o resultado.')
        }
      }).catch(() => { /* The backend closes while updating. */ })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [iniciando])
  async function atualizar() {
    setIniciando(true)
    setMensagem('')
    try {
      const resposta = await apiFetch(`${API_URL}/local-updates/apply`, { method: 'POST' })
      const dados = await resposta.json() as { detail?: string }
      if (!resposta.ok) throw new Error(dados.detail ?? 'Não foi possível iniciar a atualização.')
      setMensagem('Atualizador iniciado. Ele consultará a versão publicada e fechará o QualityHub somente se houver atualização. Aguarde a reabertura. Se a janela permanecer aberta, consulte o resultado pelo Atualizar QualityHub.bat.')
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : 'Falha ao iniciar a atualização.')
      setIniciando(false)
    }
  }
  if (!habilitado) return <small>Para atualizar este ambiente local, use Atualizar QualityHub.bat.</small>
  return <>
    {!confirmando ? <button className="qh-settings-save" type="button" onClick={() => setConfirmando(true)}>Atualizar agora</button> : <>
      <p>Salve seu trabalho. Se houver uma nova versão, o QualityHub será fechado, fará uma cópia de segurança e reabrirá após a atualização.</p>
      <button className="qh-settings-save" type="button" disabled={iniciando} onClick={() => void atualizar()}>Confirmar atualização</button>{' '}
      <button type="button" disabled={iniciando} onClick={() => setConfirmando(false)}>Agora não</button>
    </>}
    {mensagem && <p role="status">{mensagem}</p>}
  </>
}
