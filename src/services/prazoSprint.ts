import type { CicloSprintAtiva, PeriodoPlanejado } from '../services/sprintAtivaService'

/** Mesma regra temporal utilizada pelo Cockpit e pelo ROT. */
export function calcularPrazoSprint(periodo: PeriodoPlanejado | null, agora = new Date()) {
  const hojeCivil = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime()
  const dataCivil = (iso: string) => {
    const [ano, mes, dia] = iso.split('-').map(Number)
    return new Date(ano, mes - 1, dia).getTime()
  }
  const diasEmMs = 86400000
  const inicioCivil = periodo?.inicio ? dataCivil(periodo.inicio) : null
  const fimCivil = periodo?.fim ? dataCivil(periodo.fim) : null
  const periodoValido = inicioCivil !== null && fimCivil !== null && Number.isFinite(inicioCivil) && Number.isFinite(fimCivil) && fimCivil >= inicioCivil
  const duracaoDias = periodoValido ? Math.round((fimCivil! - inicioCivil!) / diasEmMs) + 1 : 0
  const diasDecorridos = periodoValido ? Math.max(0, Math.min(duracaoDias, Math.round((hojeCivil - inicioCivil!) / diasEmMs) + 1)) : 0
  const percentualTempo = duracaoDias ? Math.round(diasDecorridos / duracaoDias * 100) : 0
  const diasRestantes = periodoValido ? Math.round((fimCivil! - hojeCivil) / diasEmMs) : 0
  const diasAteInicio = periodoValido ? Math.round((inicioCivil! - hojeCivil) / diasEmMs) : 0
  const estadoPrazo = !periodoValido ? 'indefinido'
    : hojeCivil < inicioCivil! ? 'agendada'
    : hojeCivil > fimCivil! ? 'atraso'
    : percentualTempo >= 80 ? 'critico'
    : percentualTempo >= 60 ? 'atencao' : 'confortavel'
  const statusPrazo = estadoPrazo === 'indefinido' ? 'Sem período' : estadoPrazo === 'agendada' ? 'Agendada' : estadoPrazo === 'atraso' ? 'Em atraso' : 'Em andamento'
  const textoPrazo = !periodoValido ? 'Período não definido'
    : estadoPrazo === 'agendada' ? diasAteInicio === 1 ? 'Inicia amanhã' : `Inicia em ${diasAteInicio} dias`
    : estadoPrazo === 'atraso' ? `${Math.abs(diasRestantes)} ${Math.abs(diasRestantes) === 1 ? 'dia' : 'dias'}`
    : diasRestantes === 0 ? 'Último dia'
    : `${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`
  return { estadoPrazo, statusPrazo, textoPrazo, percentualTempo, diasRestantes, periodoValido }
}

export function statusExibidoSprint(sprint: CicloSprintAtiva, periodo: PeriodoPlanejado | null) {
  if (sprint.status === 'concluida') return { estado: 'concluida', titulo: 'Sprint concluída', detalhe: 'Ciclo encerrado' }
  const prazo = calcularPrazoSprint(periodo)
  return { estado: prazo.estadoPrazo, titulo: prazo.statusPrazo, detalhe: prazo.textoPrazo }
}
