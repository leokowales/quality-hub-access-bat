import { useState } from 'react'
import { AlertCircle, Plus, X } from 'lucide-react'
import { adicionarRastreabilidade } from '../services/sprintAtivaService'
import type { RastreabilidadeSprint } from '../services/sprintAtivaService'
import ResultadoAtualizacao from './ResultadoAtualizacao'
import '../styles/pages/Rastreabilidade.css'

export type RastreabilidadeProps = {
  cicloId: string
  nome: string
  dados: RastreabilidadeSprint | null
  erro: string | null
  ocupado: boolean
  recarregar: () => void
  sincronizar: () => void
  atualizado: (dados: RastreabilidadeSprint) => void
  fechar?: () => void
}

export default function Rastreabilidade(props: RastreabilidadeProps) {
  const [adicionando, setAdicionando] = useState(false)
  const [chave, setChave] = useState('')
  const [motivo, setMotivo] = useState('')
  const [falha, setFalha] = useState('')
  const [salvando, setSalvando] = useState(false)
  async function adicionar(event: React.FormEvent) {
    event.preventDefault()
    if (!props.dados?.editavel || props.ocupado || salvando) return
    setSalvando(true); setFalha('')
    try {
      const resposta = await adicionarRastreabilidade(props.cicloId, props.dados.versao, chave.trim().toUpperCase(), motivo.trim())
      props.atualizado(resposta)
      setAdicionando(false); setChave(''); setMotivo('')
    } catch (e) {
      setFalha(e instanceof Error ? e.message : 'Não foi possível incluir a demanda.')
      props.recarregar()
    } finally { setSalvando(false) }
  }
  return <>
    <ResultadoAtualizacao {...props} paginaCompleta adicionarDemanda={() => { setFalha(''); setAdicionando(true) }} />
    {adicionando && <dialog className="qh-trace-add-dialog" aria-labelledby="qh-trace-add-title" ref={node => { if (node && !node.open) node.showModal() }} onCancel={event => { if (salvando) event.preventDefault(); else setAdicionando(false) }}>
      <form onSubmit={adicionar}>
        <header><h2 id="qh-trace-add-title"><Plus size={20} />Adicionar demanda</h2><button type="button" aria-label="Fechar inclusão" disabled={salvando} onClick={() => setAdicionando(false)}><X size={19} /></button></header>
        <p>Consulte a chave no Jira. A inclusão será preservada nas próximas atualizações da sprint.</p>
        <label>Chave Jira<input autoFocus required pattern="[A-Za-z][A-Za-z0-9_]*-[0-9]+" value={chave} onChange={e => setChave(e.target.value)} placeholder="TECNA-1234" disabled={salvando} /></label>
        <label>Justificativa<textarea required maxLength={4000} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Informe o motivo da inclusão…" disabled={salvando} /></label>
        {falha && <p role="alert"><AlertCircle size={16} />{falha}</p>}
        <footer><button type="button" disabled={salvando} onClick={() => setAdicionando(false)}>Cancelar</button><button type="submit" disabled={salvando || props.ocupado || !motivo.trim() || !props.dados?.editavel}>{salvando ? 'Consultando…' : 'Consultar e incluir'}</button></footer>
      </form>
    </dialog>}
  </>
}
