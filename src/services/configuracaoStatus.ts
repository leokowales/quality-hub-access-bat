type Configuracao = {
  projetos: { id: string | number }[]
  times: { id: string | number; projetosIds: (string | number)[] }[]
  pessoas: { id: string | number; timesIds: (string | number)[] }[]
}

export function avaliarConfiguracao(config: Configuracao) {
  const vazia = !config.projetos.length && !config.times.length && !config.pessoas.length
  const projetos = new Set(config.projetos.map(p => String(p.id)))
  const times = new Set(config.times.map(t => String(t.id)))
  const faltantes: string[] = []
  if (!config.projetos.length) faltantes.push('cadastre ao menos um projeto')
  if (!config.times.length) faltantes.push('cadastre ao menos um time')
  if (!config.pessoas.length) faltantes.push('cadastre ao menos uma pessoa')
  if (config.times.some(t => !t.projetosIds?.some(id => projetos.has(String(id))))) {
    faltantes.push('vincule cada time a um projeto existente')
  }
  if (config.pessoas.some(p => !p.timesIds?.some(id => times.has(String(id))))) {
    faltantes.push('vincule cada pessoa a um time existente')
  }
  return { estado: vazia ? 'vazia' : faltantes.length ? 'parcial' : 'completa', faltantes } as const
}
