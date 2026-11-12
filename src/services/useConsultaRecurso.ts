import { useEffect, useState } from 'react'
import { iniciarConsulta } from './consultaRecurso'
import type { ConsultaRecurso } from './consultaRecurso'

export function useConsultaRecurso<T>(id: string | null, carregar: (id: string) => Promise<T>, referencia: string | number = 0) {
  const [tentativa, setTentativa] = useState(0)
  const chave = JSON.stringify([id, referencia, tentativa])
  const [resultado, setResultado] = useState<{ chave: string; estado: ConsultaRecurso<T> } | null>(null)
  useEffect(() => {
    if (!id) return
    return iniciarConsulta(() => carregar(id), estado => setResultado({ chave, estado }))
  }, [id, carregar, chave])
  const estado: ConsultaRecurso<T> = !id ? { status: 'inativo', dados: null, erro: null }
    : resultado?.chave === chave ? resultado.estado : { status: 'carregando', dados: null, erro: null }
  return { ...estado, tentarNovamente: () => setTentativa(valor => valor + 1) }
}
