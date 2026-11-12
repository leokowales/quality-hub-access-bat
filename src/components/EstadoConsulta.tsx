import type { ConsultaRecurso } from '../services/consultaRecurso'

export default function EstadoConsulta({ consulta, titulo, orientacao = 'Tente novamente em instantes.', semAcao = false }: {
  consulta: ConsultaRecurso<unknown> & { tentarNovamente: () => void }
  titulo: string
  orientacao?: string
  semAcao?: boolean
}) {
  if (consulta.status === 'carregando') return <p className="qh-v3-note" role="status">Carregando {titulo.toLocaleLowerCase('pt-BR')}…</p>
  if (consulta.status !== 'erro') return null
  if (semAcao) return <p className="qh-v3-note" role="status" aria-label={`${titulo}: dados indisponíveis`}>Dados indisponíveis.</p>
  return <div className="qh-v3-query-error" role="alert" aria-label={titulo}>
    <div className="qh-v3-query-copy"><strong>Não foi possível carregar os dados.</strong><span>{orientacao}</span></div>
    <button type="button" onClick={consulta.tentarNovamente} aria-label={`Tentar novamente: ${titulo}`}>Tentar novamente</button>
  </div>
}
