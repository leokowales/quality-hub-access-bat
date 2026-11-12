import { MessageSquareText } from 'lucide-react'
import GovernancaROT from './GovernancaROT'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import { consultarRegistrosGovernanca } from '../services/rotGovernance'
import '../styles/pages/RelatorioROT.css'

type Props = { cicloId: string; referencia: number }
export default function GovernancaCockpit({ cicloId, referencia }: Props) {
  const consulta = useConsultaRecurso(cicloId, consultarRegistrosGovernanca, referencia)
  return <section className="rot-report hub-governance" aria-labelledby="hub-governance-title">
    <div className="rot-panel rot-governance-workspace">
      <h3 id="hub-governance-title"><MessageSquareText size={17} strokeWidth={1.8} aria-hidden="true" />Comentários / Governança do QA</h3>
      <GovernancaROT cicloId={cicloId} consulta={consulta} compacto />
    </div>
  </section>
}
