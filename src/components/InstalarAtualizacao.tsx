import { useEffect, useState } from 'react'
import { API_URL, apiFetch } from '../services/api'
import InstalarAtualizacaoLocal from './InstalarAtualizacaoLocal'

type Resultado = { status: string; version: string }
const mensagens: Record<string, string> = {
  backup_failed: 'A cópia de segurança falhou antes da instalação. O programa e os dados originais foram mantidos. Confira espaço em disco e permissões antes de tentar novamente.',
  installed: 'Atualização instalada. A versão atual aparece acima.',
  installed_reopen_failed: 'Atualização instalada, mas a reabertura automática falhou.',
  failed_restored: 'A atualização falhou. O programa e os dados anteriores foram recuperados.',
  failed_recovery_required: 'A atualização falhou e precisa de suporte para recuperação. Preserve as cópias locais.',
  backing_up: 'A atualização anterior foi interrompida durante a cópia. Procure o suporte antes de tentar novamente.',
  installing: 'A atualização anterior não registrou conclusão. Procure o suporte antes de tentar novamente.',
  recovering: 'A recuperação anterior não registrou conclusão. Procure o suporte antes de tentar novamente.',
}

export default function InstalarAtualizacao({ disponivel }: { disponivel: boolean }) {
  const desktop = import.meta.env.VITE_QUALITYHUB_DESKTOP === '1'
  const [habilitado, setHabilitado] = useState(false)
  const [fase, setFase] = useState<'inicio' | 'baixando' | 'pronto' | 'encerrando'>('inicio')
  const [versao, setVersao] = useState('')
  const [erro, setErro] = useState('')
  const [anterior, setAnterior] = useState<Resultado | null>(null)
  useEffect(() => {
    if (!desktop) return
    let ativo = true
    void apiFetch(`${API_URL}/desktop-updates/status`).then(async resposta => {
      if (!resposta.ok) return
      const dados = await resposta.json() as { enabled: boolean; previous: Resultado | null }
      if (ativo) { setHabilitado(dados.enabled); setAnterior(dados.previous) }
    }).catch(() => { /* Pacotes anteriores não expõem a atualização nativa. */ })
    return () => { ativo = false }
  }, [desktop])
  useEffect(() => {
    if (fase !== 'encerrando') return
    const timer = window.setInterval(() => {
      void apiFetch(`${API_URL}/desktop-updates/status`).then(async resposta => {
        if (!resposta.ok) return
        const dados = await resposta.json() as { applying: boolean }
        if (!dados.applying) { setFase('inicio'); setErro('A instalação não iniciou. O QualityHub continua aberto; tente novamente após conferir a mensagem do aplicativo.') }
      }).catch(() => { /* O encerramento do backend é esperado nesta etapa. */ })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [fase])
  const acao = async (instalar: boolean) => {
    setErro('')
    setFase(instalar ? 'encerrando' : 'baixando')
    try {
      const resposta = await apiFetch(`${API_URL}/desktop-updates/${instalar ? 'apply' : 'prepare'}`, { method: 'POST' })
      const dados = await resposta.json() as { detail?: string; version?: string }
      if (!resposta.ok) throw new Error(dados.detail ?? 'Não foi possível concluir a atualização.')
      if (!instalar) { setVersao(dados.version ?? ''); setFase('pronto') }
    } catch (falha) { setErro(falha instanceof Error ? falha.message : 'Falha na atualização.'); setFase('inicio') }
  }
  const interrompida = anterior && ['failed_recovery_required', 'backing_up', 'installing', 'recovering'].includes(anterior.status)
  return <div className="qh-settings-block qh-settings-update-installation">
    {anterior && <p role="status">{mensagens[anterior.status] ?? 'Confira com o suporte o resultado da atualização anterior.'}</p>}
    {!desktop ? <InstalarAtualizacaoLocal /> : !habilitado ? <small>A instalação pelo aplicativo não está habilitada neste pacote.</small> : <>
      {disponivel && fase === 'inicio' && <button className="qh-settings-save" type="button" disabled={Boolean(interrompida)} onClick={() => void acao(false)}>Baixar e verificar atualização</button>}
      {fase === 'baixando' && <p role="status">Baixando e verificando o pacote. Você pode continuar usando o QualityHub.</p>}
      {fase === 'pronto' && <><p>Versão {versao} verificada. Salve seu trabalho antes de continuar. O QualityHub será fechado, fará cópias de segurança e reabrirá após a instalação.</p><button className="qh-settings-save" type="button" onClick={() => void acao(true)}>Instalar e reiniciar</button> <button type="button" onClick={() => setFase('inicio')}>Agora não</button></>}
      {fase === 'encerrando' && <p role="status">Encerrando para atualizar. Aguarde a reabertura do QualityHub.</p>}
    </>}
    {erro && <p role="alert">{erro}</p>}
  </div>
}
