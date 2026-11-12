export type ConsultaRecurso<T> = {
  status: 'inativo' | 'carregando' | 'sucesso' | 'erro'
  dados: T | null
  erro: string | null
}
export type RecursoConsultado<T> = ConsultaRecurso<T> & { tentarNovamente: () => void }

export function iniciarConsulta<T>(carregar: () => Promise<T>, publicar: (estado: ConsultaRecurso<T>) => void) {
  let ativa = true
  void Promise.resolve().then(async () => {
    if (!ativa) return
    publicar({ status: 'carregando', dados: null, erro: null })
    try {
      const dados = await carregar()
      if (ativa) publicar({ status: 'sucesso', dados, erro: null })
    } catch (erro) {
      if (ativa) publicar({ status: 'erro', dados: null, erro: erro instanceof Error ? erro.message : 'Falha na consulta.' })
    }
  })
  return () => { ativa = false }
}
