import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import '../styles/base/ToastSincronizacao.css'

type Props = { texto: string; onFechar: () => void }

export default function ToastSincronizacao({ texto, onFechar }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onFechar, 5000)
    return () => window.clearTimeout(timer)
  }, [texto, onFechar])

  return <div className="hub-sync-toast" role="status" aria-live="polite" aria-atomic="true">
    <CheckCircle2 className="hub-sync-toast-icon" size={20} aria-hidden="true" />
    <div className="hub-sync-toast-content">
      <strong>Atualização concluída</strong>
      <span>{texto}</span>
    </div>
    <button type="button" aria-label="Fechar mensagem de atualização" onClick={onFechar}><X size={18} /></button>
  </div>
}
