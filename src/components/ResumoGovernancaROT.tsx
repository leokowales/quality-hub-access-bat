import { useEffect, useRef, useState } from 'react'
import { ChevronUp } from 'lucide-react'
import type { RegistroGovernanca } from '../services/rotGovernance'
import { STATUS_REGISTRO, TIPOS_REGISTRO } from '../services/rotGovernance'
import type { NotaSprint } from '../services/sprintAtivaService'

type Props = { registros: RegistroGovernanca[]; notas: NotaSprint[]; status: string; abrir: (event: React.MouseEvent<HTMLAnchorElement>) => void }
export default function ResumoGovernancaROT({ registros, notas, status, abrir }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const conteudo = useRef<HTMLDivElement>(null)
  const [excede, setExcede] = useState(false)
  useEffect(() => {
    const medir = () => {
      const painel = area.current
      if (!painel) return
      const limite = painel.getBoundingClientRect().bottom
      painel.querySelectorAll<HTMLElement>('.rot-governance-mini tbody tr, .rot-note').forEach(linha => {
        linha.style.visibility = linha.getBoundingClientRect().bottom <= limite + 1 ? '' : 'hidden'
      })
      setExcede(painel.scrollHeight > painel.clientHeight + 1)
    }
    medir()
    const observer = new ResizeObserver(medir)
    if (area.current) observer.observe(area.current)
    if (conteudo.current) observer.observe(conteudo.current)
    return () => observer.disconnect()
  }, [registros, notas, status])
  const total = registros.length + notas.length
  return <>
    <div className={`rot-governance-preview${excede ? ' has-overflow' : ''}`} ref={area}><div ref={conteudo}>
      {registros.length > 0 && <table className="rot-governance-mini"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>Tipo</th><th>Título / Descrição</th><th>Status</th><th>Sprint(s)</th><th>Abertura</th><th>Conclusão</th></tr></thead><tbody>{registros.map(registro => <tr key={registro.id}>
        <td><span className={`rot-governance-type is-${registro.tipo}`}>{TIPOS_REGISTRO[registro.tipo]}</span></td>
        <td><strong title={registro.titulo}>#{registro.id} · {registro.titulo}</strong>{registro.descricao && registro.status !== 'bloqueado' && <span className="rot-governance-mini-description" title={registro.descricao}>{registro.descricao}</span>}{registro.status === 'bloqueado' && <span className="rot-governance-mini-description" title={[registro.descricao, `Bloqueio: ${registro.motivo_bloqueio}`].filter(Boolean).join(" | ")}>Bloqueio: {registro.motivo_bloqueio}</span>}</td>
        <td><span className={`rot-governance-status is-${registro.status}`}>{STATUS_REGISTRO[registro.status]}</span></td>
        <td title={`Origem: ${registro.sprint_origem?.sprint_name ?? 'Sprint atual'}; Atual: ${registro.sprint_atual?.sprint_name ?? 'Sprint atual'}`}><span>{registro.herdado ? 'Herdado' : 'Atual'} · {registro.quantidade_sprints ?? 1}</span></td>
        <td><time dateTime={registro.abertura}>{registro.abertura.split('-').reverse().join('/')}</time></td>
        <td>{registro.fechamento ? <time dateTime={registro.fechamento}>{registro.fechamento.split('-').reverse().join('/')}</time> : '—'}</td>
      </tr>)}</tbody></table>}
      {notas.map(nota => <p className="rot-note" key={`nota-${nota.id}`}>{nota.issue_key && <strong>{nota.issue_key} · </strong>}{nota.texto}</p>)}
      {total === 0 && <p className="rot-note">{status === 'carregando' ? 'Consultando registros\u2026' : status === 'erro' ? 'N\u00e3o foi poss\u00edvel consultar os registros de governan\u00e7a.' : 'Nenhum registro de governan\u00e7a cadastrado para esta sprint.'}</p>}
    </div></div>
    <a hidden={!excede} className="rot-governance-more" href="#rot-governance-detalhes" data-rot-governance-trigger onClick={abrir}>Ver registros ({total})<ChevronUp size={13} strokeWidth={1.8} aria-hidden="true" /></a>
  </>
}
