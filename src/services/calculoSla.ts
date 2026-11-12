
export type SituacaoSla =
    | 'dentro'
    | 'limite'
    | 'estourado'
    | 'sem_dados'

export type ResultadoSla = {
    situacao: SituacaoSla
    rotulo: string
    percentual: number | null
    minutosConsumidos: number | null
    minutosPrevistos: number | null
    encerrado: boolean
}

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

// Horário de Brasília (UTC-3), válido para o período
// atual, sem horário de verão no Brasil.
const OFFSET_BRASILIA = 3 * HORA

const feriadosNacionais = new Set([
    '01-01', '04-21', '05-01', '09-07',
    '10-12', '11-02', '11-15', '11-20',
    '12-25',
])

function normalizar(valor: unknown): string {
    if (typeof valor === 'string') {
        return valor.trim().toLocaleLowerCase('pt-BR')
    }

    if (valor && typeof valor === 'object') {
        const objeto = valor as { name?: unknown }

        if (typeof objeto.name === 'string') {
            return objeto.name.trim().toLocaleLowerCase('pt-BR')
        }
    }

    return ''
}

export function minutosSla(prioridade: unknown): number | null {
    switch (normalizar(prioridade)) {
        case 'very critical':
        case 'muito crítica':
        case 'altíssima':
            return 8 * 60
        case 'high':
        case 'alta':
            return 2 * 8 * 60
        case 'medium':
        case 'média':
        case 'media':
            return 4 * 8 * 60
        case 'low':
        case 'baixa':
        case 'baixíssima':
            return 7 * 8 * 60
        default:
            return null
    }
}

function diaUtil(diaLocalUtc: number): boolean {
    const data = new Date(diaLocalUtc)
    const semana = data.getUTCDay()

    if (semana === 0 || semana === 6) return false

    const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
    const dia = String(data.getUTCDate()).padStart(2, '0')

    return !feriadosNacionais.has(`${mes}-${dia}`)
}

export function minutosUteisEntre(
    inicio: Date,
    fim: Date,
): number {
    const inicioMs = inicio.getTime()
    const fimMs = fim.getTime()

    if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs)) {
        return 0
    }

    if (fimMs <= inicioMs) return 0

    // Converte o intervalo para a referência civil de Brasília.
    const inicioLocal = inicioMs - OFFSET_BRASILIA
    const fimLocal = fimMs - OFFSET_BRASILIA

    const primeiroDia = Math.floor(inicioLocal / DIA) * DIA
    const ultimoDia = Math.floor(fimLocal / DIA) * DIA

    let minutos = 0

    for (let dia = primeiroDia; dia <= ultimoDia; dia += DIA) {
        if (!diaUtil(dia)) continue

        // Expediente: 09h-12h e 13h-18h.
        const periodos = [
            [9, 12],
            [13, 18],
        ]

        for (const [horaInicio, horaFim] of periodos) {
            const comeco = Math.max(inicioLocal, dia + horaInicio * HORA)
            const termino = Math.min(fimLocal, dia + horaFim * HORA)

            if (termino > comeco) {
                minutos += (termino - comeco) / MINUTO
            }
        }
    }

    return minutos
}

export function calcularSla(
    prioridade: unknown,
    criacao?: string | null,
    resolucao?: string | null,
    agora: Date = new Date(),
): ResultadoSla {
    const vazio: ResultadoSla = {
        situacao: 'sem_dados',
        rotulo: '—',
        percentual: null,
        minutosConsumidos: null,
        minutosPrevistos: null,
        encerrado: false,
    }

    const previsto = minutosSla(prioridade)
    if (!previsto || !criacao) return vazio

    const inicio = new Date(criacao)
    const temResolucao = Boolean(resolucao)
    const fim = temResolucao ? new Date(resolucao!) : agora

    if (
        !Number.isFinite(inicio.getTime()) ||
        !Number.isFinite(fim.getTime()) ||
        fim.getTime() < inicio.getTime()
    ) {
        return vazio
    }

    const consumido = minutosUteisEntre(inicio, fim)
    const percentual = (consumido / previsto) * 100

    const situacao: SituacaoSla =
        percentual > 100
            ? 'estourado'
            : percentual >= 80
                ? 'limite'
                : 'dentro'

    return {
        situacao,
        rotulo:
            situacao === 'estourado'
                ? 'Estourado'
                : situacao === 'limite'
                    ? 'No limite'
                    : 'Dentro do prazo',
        percentual,
        minutosConsumidos: consumido,
        minutosPrevistos: previsto,
        encerrado: temResolucao,
    }
}

export function formatarTempoUtil(
    minutos: number | null,
): string {
    if (minutos === null || !Number.isFinite(minutos)) {
        return '—'
    }

    const total = Math.max(0, Math.floor(minutos))
    const dias = Math.floor(total / 480)
    const horas = Math.floor((total % 480) / 60)
    const restantes = total % 60

    const partes: string[] = []

    if (dias > 0) {
        partes.push(`${dias} ${dias === 1 ? 'dia' : 'dias'}`)
    }

    if (horas > 0) {
        partes.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`)
    }

    if (restantes > 0 || partes.length === 0) {
        partes.push(`${restantes} min`)
    }

    return `${partes.join(' e ')} úteis`
}


export function rotuloSituacaoSla(
    status: string | null | undefined,
    situacao: SituacaoSla,
    rotuloOriginal: string,
): string {
    const statusNormalizado = (status ?? '')
        .trim()
        .toLocaleLowerCase('pt-BR')

    if (statusNormalizado === 'cancelado') {
        return '—'
    }

    if (
        statusNormalizado === 'concluído' ||
        statusNormalizado === 'concluido'
    ) {
        switch (situacao) {
            case 'estourado':
                return 'Concluído fora do prazo'
            case 'limite':
                return 'Concluído no limite do prazo'
            case 'dentro':
                return 'Concluído dentro do prazo'
            default:
                return '—'
        }
    }

    return rotuloOriginal
}

// Compact display uses the same eight-hour working day as the SLA calculation.
export function formatarTempoUtilCompacto(minutos: number | null): string {
    if (minutos === null || !Number.isFinite(minutos)) return '—'
    const total = Math.max(0, Math.floor(minutos))
    const dias = Math.floor(total / 480)
    const horas = Math.floor((total % 480) / 60)
    const restantes = total % 60
    return [dias > 0 ? `${dias}d` : '', horas > 0 ? `${horas}h` : '', restantes > 0 || total === 0 ? `${restantes}min` : ''].filter(Boolean).join(' ')
}
