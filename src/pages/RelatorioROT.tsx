import ResumoGovernancaROT from '../components/ResumoGovernancaROT'
import { agruparRelatores, consultarConfiguracaoRelatores } from '../services/relatoresROT'
import GovernancaROT from '../components/GovernancaROT'
import { consultarRegistrosGovernanca } from '../services/rotGovernance'
import { montarAtencoesRot } from '../services/rotAttention'
import { destaqueDefeitos, ordenarSeveridades, corSeveridade, nivelSeveridade, corStatusDefeito, normalizarDefeito } from '../services/rotDefectAnalysis'
import { Info, Download, ArrowLeft, Eye, ClipboardCheck, ClipboardList, CheckCircle2, XCircle, Clock3, Bug, ChartNoAxesColumnIncreasing, ShieldCheck, TriangleAlert, Tags, MessageSquareText, FileText, Target, Lightbulb, History, Sun, Moon, TrendingUp, TrendingDown, Minus, ChevronUp, RotateCcw } from 'lucide-react'
import { calcularPrazoSprint, statusExibidoSprint } from '../services/prazoSprint'
import { useEffect, useRef, useState } from 'react'
import { calcularSla, formatarTempoUtil, formatarTempoUtilCompacto, minutosSla, rotuloSituacaoSla } from '../services/calculoSla'
import { consultarEvolucaoDiariaSprint, consultarPeriodoSprint, consultarNotasSprint, consultarAtencoesSprintAtiva } from '../services/sprintAtivaService'
import type { IndicadoresSprintAtiva, AtencoesSprintAtiva, CicloSprintAtiva, PontoEvolucaoDiaria } from '../services/sprintAtivaService'
import { useConsultaRecurso } from '../services/useConsultaRecurso'
import themeCss from '../styles/patterns/QualityHubTheme.css?raw'
import css from '../styles/pages/RelatorioROT.css?raw'
import imagemMontanhas from '../assets/rot-montanhas.jpg?url'
import logoNtt from '../assets/ntt-data.png?url'
import '../styles/pages/RelatorioROT.css'

// Converte recursos locais em data URI para que o HTML funcione sem servidor.
async function imagemEmDataUri(url: string): Promise<string> {
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`Não foi possível incorporar a imagem (${resposta.status}).`)
  const blob = await resposta.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Falha ao incorporar a imagem.'))
    reader.readAsDataURL(blob)
  })
}

// Captura as cores globais efetivas usadas pelos status do Cockpit.
function variaveisDeStatusParaExportacao(): string {
  const nomes = [
    '--qh-cockpit-success', '--qh-cockpit-warning', '--qh-cockpit-overdue',
    '--qh-cockpit-danger-bg', '--qh-cockpit-info-text', '--qh-cockpit-info-bg',
  ]
  const estilos = getComputedStyle(document.querySelector('.rot-overlay') ?? document.documentElement)
  const valoresPadrao: Record<string, string> = {
    '--qh-cockpit-success': '#28d6a2',
    '--qh-cockpit-warning': '#f4bd56',
    '--qh-cockpit-overdue': '#ef9995',
    '--qh-cockpit-danger-bg': 'rgba(244, 110, 102, .12)',
    '--qh-cockpit-info-text': '#a6d5ff',
    '--qh-cockpit-info-bg': '#203b5e',
  }
  return `:root { ${nomes.map(nome => `${nome}: ${estilos.getPropertyValue(nome).trim() || valoresPadrao[nome]};`).join(' ')} }`
}

// Incorpora os logos ao HTML exportado, sem depender do servidor do QualityHub.
async function incorporarImagens(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>('img[data-rot-logo]'))) {
    if (!img.getAttribute('src')) continue
    img.setAttribute('src', await imagemEmDataUri(img.src))
  }
  for (const link of Array.from(doc.querySelectorAll('[data-rot-sla-trigger]'))) {
    link.setAttribute('onclick', "event.preventDefault();const painel=document.getElementById('rot-sla-detalhes');painel.open=true;painel.scrollIntoView({block:'start'});")
  }
  for (const link of Array.from(doc.querySelectorAll('[data-rot-attention-trigger]'))) {
    link.setAttribute('onclick', "event.preventDefault();const painel=document.getElementById('rot-attention-detalhes');painel.querySelectorAll('[data-rot-attention-group]').forEach(grupo=>grupo.hidden=grupo.dataset.rotAttentionGroup!==this.dataset.rotAttentionTrigger);painel.open=true;painel.scrollIntoView({block:'start'});")
  }
  for (const link of Array.from(doc.querySelectorAll('[data-rot-rollover-trigger]'))) {
    link.setAttribute('onclick', "event.preventDefault();const painel=document.getElementById('rot-rollover-detalhes');painel.open=true;painel.scrollIntoView({block:'start'});")
  }
  for (const botao of Array.from(doc.querySelectorAll('[data-rot-defect-tab]'))) {
    botao.setAttribute('onclick', "const bloco=this.closest('[data-rot-defect-analysis]');bloco.querySelectorAll('[data-rot-defect-tab]').forEach(b=>{const ativo=b===this;b.setAttribute('aria-selected',String(ativo));b.tabIndex=ativo?0:-1;});bloco.querySelectorAll('[data-rot-defect-panel]').forEach(p=>p.hidden=p.dataset.rotDefectPanel!==this.dataset.rotDefectTab);")
    botao.setAttribute('onkeydown', "const teclas=['ArrowLeft','ArrowRight','Home','End'];if(teclas.includes(event.key)){event.preventDefault();const botoes=Array.from(this.parentElement.querySelectorAll('[role=tab]'));const i=botoes.indexOf(this);const n=event.key==='Home'?0:event.key==='End'?botoes.length-1:(i+(event.key==='ArrowRight'?1:-1)+botoes.length)%botoes.length;botoes[n].click();botoes[n].focus();}")
  }
  for (const botao of Array.from(doc.querySelectorAll('[data-rot-insight-tab]'))) {
    botao.setAttribute('onclick', "const bloco=this.closest('[data-rot-insights]');bloco.querySelectorAll('[data-rot-insight-tab]').forEach(b=>{const ativo=b===this;b.setAttribute('aria-selected',String(ativo));b.tabIndex=ativo?0:-1;});bloco.querySelectorAll('[data-rot-insight-panel]').forEach(p=>p.hidden=p.dataset.rotInsightPanel!==this.dataset.rotInsightTab);")
    botao.setAttribute('onkeydown', "if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const botoes=Array.from(this.parentElement.querySelectorAll('[role=tab]'));const i=botoes.indexOf(this);const n=event.key==='Home'?0:event.key==='End'?botoes.length-1:(i+(event.key==='ArrowRight'?1:-1)+botoes.length)%botoes.length;botoes[n].click();botoes[n].focus();}")
  }
  for (const elemento of Array.from(doc.querySelectorAll('[data-rot-editor], [data-rot-governance-edit]'))) elemento.remove()
  for (const link of Array.from(doc.querySelectorAll('[data-rot-governance-trigger]'))) link.setAttribute('onclick', "event.preventDefault();const painel=document.getElementById('rot-governance-detalhes');painel.open=true;painel.scrollIntoView({block:'start'});")
  const atualizarGovernanca = `
    const painel=this.closest('[data-rot-governance]');
    const filtros=Object.fromEntries(Array.from(painel.querySelectorAll('[data-rot-governance-filter]')).map(f=>[f.dataset.rotGovernanceFilter,f.value]));
    const normalizar=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();
    const busca=normalizar(painel.querySelector('[data-rot-governance-search]').value);
    const dias=Number(filtros.periodo);const hoje=painel.dataset.hoje;
    const inicio=dias>0?new Date(Date.parse(hoje+'T12:00:00Z')-(dias-1)*86400000).toISOString().slice(0,10):null;
    const linhas=Array.from(painel.querySelectorAll('[data-rot-governance-row]'));
    const filtradas=linhas.filter(l=>(!filtros.tipo||l.dataset.tipo===filtros.tipo)&&(!filtros.status||l.dataset.status===filtros.status)&&(!inicio||(l.dataset.abertura>=inicio&&l.dataset.abertura<=hoje))&&(!busca||normalizar(l.dataset.titulo+' '+l.dataset.descricao).includes(busca)));
    const limite=Number(painel.dataset.pageSize)||10;const total=Math.max(1,Math.ceil(filtradas.length/limite));const atual=Number(painel.dataset.page)||1;
    const acao=this.dataset.rotGovernancePage||'first';const pagina=Math.max(1,Math.min(total,acao==='first'?1:acao==='last'?total:atual+(acao==='prev'?-1:1)));
    painel.dataset.page=pagina;linhas.forEach(l=>l.hidden=true);filtradas.slice((pagina-1)*limite,pagina*limite).forEach(l=>l.hidden=false);
    painel.querySelector('[data-rot-governance-empty]').hidden=filtradas.length>0;
    painel.querySelector('[data-rot-governance-range]').textContent=(filtradas.length?(pagina-1)*limite+1:0)+'–'+Math.min(pagina*limite,filtradas.length)+' de '+filtradas.length+' registros';
    painel.querySelector('[data-rot-governance-label]').textContent='Página '+pagina+' de '+total;
    painel.querySelector('.rot-governance-pagination > div').hidden=total===1;
    painel.querySelectorAll('[data-rot-governance-page]').forEach(b=>b.disabled=((b.dataset.rotGovernancePage==='first'||b.dataset.rotGovernancePage==='prev')&&pagina===1)||((b.dataset.rotGovernancePage==='next'||b.dataset.rotGovernancePage==='last')&&pagina===total));
  `
  for (const select of Array.from(doc.querySelectorAll<HTMLSelectElement>('[data-rot-governance-filter]'))) {
    const original=document.querySelector<HTMLSelectElement>(`[data-rot-governance-filter="${select.dataset.rotGovernanceFilter}"]`)
    for (const option of Array.from(select.options)) option.toggleAttribute('selected', option.value === original?.value)
    select.setAttribute('onchange', atualizarGovernanca)
  }
  const buscaGovernanca=doc.querySelector('[data-rot-governance-search]')
  buscaGovernanca?.setAttribute('value', document.querySelector<HTMLInputElement>('[data-rot-governance-search]')?.value ?? '')
  buscaGovernanca?.setAttribute('oninput', atualizarGovernanca)
  for (const botao of Array.from(doc.querySelectorAll('[data-rot-governance-page]'))) botao.setAttribute('onclick', atualizarGovernanca)
  const atualizarTabelaExportada = `
    const painel=this.closest('details');
    const filtros=Array.from(painel.querySelectorAll('[data-rot-sla-filter]'));
    const linhas=Array.from(painel.querySelectorAll('tbody tr'));
    const filtradas=linhas.filter(linha=>filtros.every(f=>!f.value||linha.dataset[f.dataset.rotSlaFilter]===f.value));
    const total=Math.max(1,Math.ceil(filtradas.length/10));
    const atual=Number(painel.dataset.page)||1;
    const acao=this.dataset.rotPage||'first';
    const pagina=Math.max(1,Math.min(total,acao==='first'?1:acao==='last'?total:atual+(acao==='prev'?-1:1)));
    painel.dataset.page=pagina;
    linhas.forEach(linha=>linha.hidden=true);
    filtradas.slice((pagina-1)*10,pagina*10).forEach(linha=>linha.hidden=false);
    painel.querySelector('[data-rot-empty]').hidden=filtradas.length>0;
    painel.querySelector('[data-rot-page-range]').textContent=(filtradas.length?(pagina-1)*10+1:0)+'–'+Math.min(pagina*10,filtradas.length)+' de '+filtradas.length+' defeitos';
    painel.querySelector('[data-rot-page-label]').textContent='Página '+pagina+' de '+total;
    painel.querySelectorAll('[data-rot-page]').forEach(b=>b.disabled=((b.dataset.rotPage==='first'||b.dataset.rotPage==='prev')&&pagina===1)||((b.dataset.rotPage==='next'||b.dataset.rotPage==='last')&&pagina===total));
  `
  for (const select of Array.from(doc.querySelectorAll<HTMLSelectElement>('[data-rot-sla-filter]'))) {
    const original = document.querySelector<HTMLSelectElement>(`[data-rot-sla-filter="${select.dataset.rotSlaFilter}"]`)
    for (const option of Array.from(select.options)) {
      option.toggleAttribute('selected', option.value === original?.value)
    }
    select.setAttribute('onchange', atualizarTabelaExportada)
  }
  for (const botao of Array.from(doc.querySelectorAll('[data-rot-page]'))) botao.setAttribute('onclick', atualizarTabelaExportada)
  doc.querySelector('[data-rot-clear]')?.setAttribute('onclick', "this.closest('details').querySelectorAll('select').forEach(s=>s.value='');" + atualizarTabelaExportada)
  const ajusteGrafico = doc.createElement('script')
  ajusteGrafico.textContent = `
    document.querySelectorAll('.rot-governance-preview').forEach(area=>{
      const link=area.parentElement.querySelector('[data-rot-governance-trigger]');
      const medir=()=>{const limite=area.getBoundingClientRect().bottom;area.querySelectorAll('.rot-governance-mini tbody tr, .rot-note').forEach(linha=>{linha.style.visibility=linha.getBoundingClientRect().bottom<=limite+1?'':'hidden';});const excede=area.scrollHeight>area.clientHeight+1;area.classList.toggle('has-overflow',excede);if(link)link.hidden=!excede;};
      const observer=new ResizeObserver(medir);observer.observe(area);if(area.firstElementChild)observer.observe(area.firstElementChild);medir();
    });
    document.querySelectorAll('.rot-dash-evolucao > svg').forEach(svg => {
      const larguraOriginal=svg.viewBox.baseVal.width;
      const atributos=Array.from(svg.querySelectorAll('circle,polyline,path[d],line,text,rect,foreignObject')).map(el=>({el,
        cx:el.getAttribute('cx'), x:el.getAttribute('x'), x1:el.getAttribute('x1'), x2:el.getAttribute('x2'),
        points:el.getAttribute('points'), d:el.getAttribute('d')
      }));
      const ajustar=()=>{
        const tamanho=svg.getBoundingClientRect();
        if(!tamanho.width||!tamanho.height)return;
        const largura=tamanho.width/tamanho.height*228;
        const x=valor=>40+(Number(valor)-40)*(largura-64)/(larguraOriginal-64);
        svg.setAttribute('viewBox','0 0 '+largura+' 228');
        atributos.forEach(a=>{
          for(const nome of ['cx','x','x1','x2'])if(a[nome]!==null){if(nome==='x'&&a.el.hasAttribute('data-rot-tooltip'))a.el.setAttribute(nome,Math.max(2,Math.min(largura-282,x(Number(a[nome])+140)-140)));else if(Number(a[nome])>=40||a.el.tagName==='rect')a.el.setAttribute(nome,x(a[nome]));}
          if(a.points)a.el.setAttribute('points',a.points.trim().split(/\\s+/).map(p=>{const v=p.split(',');return x(v[0])+','+v[1]}).join(' '));
          if(a.d)a.el.setAttribute('d',a.d.replace(/([ML])\\s*([\\d.]+)\\s+([\\d.]+)/g,(_,comando,xx,yy)=>comando+' '+x(xx)+' '+yy));
        });
      };
      new ResizeObserver(ajustar).observe(svg);
      ajustar();
    });
  `
  doc.body.appendChild(ajusteGrafico)
  return doc.body.innerHTML
}

type IconeRotNome =
  | 'cenario'
  | 'aprovados'
  | 'falhados'
  | 'restantes'
  | 'defeitos'
  | 'densidade'
  | 'sla'
  | 'risco'
  | 'categorias'
  | 'comentarios'
  | 'resumo'
  | 'atencao'
  | 'insights'
  | 'rollover'
  | 'severidade'
  | 'identificadores'

function IconeRotOriginal({ nome }: { nome: Exclude<IconeRotNome, 'categorias' | 'comentarios' | 'resumo' | 'atencao' | 'insights' | 'rollover' | 'severidade' | 'identificadores'> }) {
  const caminhos: Record<Exclude<IconeRotNome, 'categorias' | 'comentarios' | 'resumo' | 'atencao' | 'insights' | 'rollover' | 'severidade' | 'identificadores'>, React.ReactNode> = {
    cenario: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4.5h6M9 9h6M9 13h6M9 17h4" />
      </>
    ),
    aprovados: <path d="m5 12 4 4L19 6" />,
    falhados: <path d="M18 6 6 18M6 6l12 12" />,
    restantes: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    defeitos: (
      <>
        <rect x="8" y="8" width="8" height="11" rx="4" />
        <path d="M9 8 7 5M15 8l2-3M4 11h4M16 11h4M4 16h4M16 16h4M12 8v11" />
      </>
    ),
    densidade: (
      <>
        <rect x="4" y="12" width="3" height="8" rx="1" />
        <rect x="10" y="8" width="3" height="12" rx="1" />
        <rect x="16" y="4" width="3" height="16" rx="1" />
      </>
    ),
    sla: (
      <>
        <path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    risco: (
      <>
        <path d="m12 3 10 18H2z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  }

  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {caminhos[nome]}
    </svg>
  )
}

function IconeRot({ nome }: { nome: IconeRotNome }) {
  if (nome === 'defeitos') return <Bug size={18} strokeWidth={1.8} aria-hidden="true" />
  if (nome === 'cenario' || nome === 'aprovados' || nome === 'falhados' || nome === 'restantes' || nome === 'densidade' || nome === 'sla' || nome === 'risco') {
    return <IconeRotOriginal nome={nome} />
  }
  const icones = {
    cenario: ClipboardList,
    aprovados: CheckCircle2,
    falhados: XCircle,
    restantes: Clock3,
    defeitos: Bug,
    densidade: ChartNoAxesColumnIncreasing,
    sla: ShieldCheck,
    risco: TriangleAlert,
    identificadores: ClipboardCheck,
    severidade: Bug,
    categorias: Tags,
    comentarios: MessageSquareText,
    resumo: FileText,
    atencao: Target,
    insights: Lightbulb,
    rollover: History,
  }
  const Icone = icones[nome]
  return <Icone size={18} strokeWidth={1.8} aria-hidden="true" />
}

type Props = { sprint: CicloSprintAtiva; indicadores: IndicadoresSprintAtiva; atencoes: AtencoesSprintAtiva | null; fechar: () => void }
const fmt = (n: number) => n.toLocaleString('pt-BR')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
const data = (s?: string | null) => s
  ? new Date(s).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '')
  : 'Não informada'
const dataCurta = (s?: string | null) => { if (!s) return 'Não informado'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s }
const lista = (v?: Record<string, number>) => Object.entries(v ?? {}).sort((a, b) => b[1] - a[1])
const CORES_CAUSA = ['#2f86f6', '#f7ad36', '#f04e63', '#9864df', '#35c98c', '#94a3b8', '#0ea5e9', '#e879f9']

// Demonstração isolada: não altera histórico, KPIs ou dados persistidos.
// Mude para false para utilizar exclusivamente as referências reais.
const MOCK_EVOLUCAO_ROT = false
const MOCK_PONTOS_EVOLUCAO: PontoEvolucaoDiaria[] = Array.from({ length: 14 }, (_, i) => {
  const aprovados = [48, 55, 67, 74, 83, 91, 107, 119, 135, 145, 165, 180, 198, 214][i]
  const falhados = [1, 2, 3, 2, 4, 5, 4, 6, 5, 7, 6, 5, 6, 6][i]
  return {
    data: `2026-10-${String(i + 1).padStart(2, '0')}`,
    aprovados,
    falhados,
    restantes: 246 - aprovados - falhados,
    total: 246,
    atualizado_em: `2026-10-${String(i + 1).padStart(2, '0')}T18:00:00`,
  }
})


function IconeDashboard({ tipo }: { tipo: 'status' | 'evolucao' | 'causas' }) {
  const Icone = { status: ChartNoAxesColumnIncreasing, evolucao: TrendingUp, causas: Bug }[tipo]
  return <span className="rot-dash-simbolo" aria-hidden="true"><Icone size={20} strokeWidth={1.8} /></span>
}

function VariacaoKpi({ valor, inverter = false, comparacao }: { valor: number | null; inverter?: boolean; comparacao?: string }) {
  if (valor === null) return null
  const Icone = valor > 0 ? TrendingUp : valor < 0 ? TrendingDown : Minus
  const estado = valor === 0 ? 'stable' : (inverter ? valor < 0 : valor > 0) ? 'up' : 'down'
  const texto = `${valor > 0 ? '+' : ''}${fmt(valor)}`
  return <span className={`rot-kpi-delta ${estado}`} title={comparacao} aria-label={`Variação: ${texto}`}>
    {texto}<Icone size={11} strokeWidth={1.8} aria-hidden="true" />
  </span>
}

function GraficoEvolucao({ pontos }: { pontos: PontoEvolucaoDiaria[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [larguraDesenho, setLarguraDesenho] = useState(800)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const ajustar = () => {
      const { width, height } = svg.getBoundingClientRect()
      if (width > 0 && height > 0) setLarguraDesenho(width / height * 228)
    }
    ajustar()
    const observer = new ResizeObserver(ajustar)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [pontos.length])
  const ordenados = [...pontos].sort((a, b) => a.data.localeCompare(b.data))
  if (!ordenados.length) return <p className="rot-dash-vazio">Aguardando referências diárias da sprint.</p>
  const maximo = Math.max(1, ...ordenados.flatMap(p => [p.aprovados, p.falhados, p.restantes]))
  const teto = Math.ceil(maximo / 4) * 4
  const esquerda = 40
  const direita = larguraDesenho - 24
  const x = (i: number) => esquerda + (ordenados.length === 1
    ? (direita - esquerda) / 2
    : i * (direita - esquerda) / (ordenados.length - 1))
  const y = (v: number) => 190 - (v / teto) * 160
  const series = [
    { nome: 'Aprovados', campo: 'aprovados' as const, cor: '#17c784' },
    { nome: 'Restantes', campo: 'restantes' as const, cor: '#3288f6' },
    { nome: 'Falhados', campo: 'falhados' as const, cor: '#f04455' },
  ]
  const areaSerie = (campo: 'aprovados' | 'restantes' | 'falhados') => ordenados.length > 1
    ? `M ${x(0)} 190 L ${ordenados.map((p, i) => `${x(i)} ${y(p[campo])}`).join(' L ')} L ${x(ordenados.length - 1)} 190 Z`
    : null
  return <div className="rot-dash-evolucao">
    <div className="rot-dash-legenda">{series.map(serie => <span key={serie.campo}><i style={{ background: serie.cor }} />{serie.nome}</span>)}</div>
    <svg ref={svgRef} viewBox={`0 0 ${larguraDesenho} 228`} role="img" aria-label="Evolução diária de aprovados, restantes e falhados" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="rot-gradiente-aprovados" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#17c784" stopOpacity="0.24" /><stop offset="100%" stopColor="#17c784" stopOpacity="0" /></linearGradient>
        <linearGradient id="rot-gradiente-restantes" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3288f6" stopOpacity="0.13" /><stop offset="100%" stopColor="#3288f6" stopOpacity="0" /></linearGradient>
        <linearGradient id="rot-gradiente-falhados" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f04455" stopOpacity="0.11" /><stop offset="100%" stopColor="#f04455" stopOpacity="0" /></linearGradient>
      </defs>
      {(['aprovados', 'restantes', 'falhados'] as const).map(campo => {
        const area = areaSerie(campo)
        return area ? <path key={campo} d={area} fill={`url(#rot-gradiente-${campo})`} /> : null
      })}
      {[0, 1, 2, 3, 4].map(i => { const valor = teto * i / 4; const yy = y(valor); return <g key={i}><line x1={esquerda} x2={direita} y1={yy} y2={yy} stroke="#e2eaf4" /><text x="32" y={yy + 4} textAnchor="end" fontSize="16" fill="#70849f">{fmt(valor)}</text></g> })}
      {series.map(serie => <g key={serie.campo}>
        {ordenados.length > 1 && <polyline points={ordenados.map((p, i) => `${x(i)},${y(p[serie.campo])}`).join(' ')} fill="none" stroke={serie.cor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {ordenados.map((p, i) => <circle key={p.data} cx={x(i)} cy={y(p[serie.campo])} r="3.3" fill={serie.cor} stroke="#fff" strokeWidth="1" />)}
      </g>)}
      {ordenados.map((p, i) => {
        // Mantém todos os pontos; limita somente os rótulos para evitar colisões.
        const intervalo = Math.max(1, Math.ceil((ordenados.length - 1) / 6))
        const exibir = ordenados.length <= 7 || i === 0 || i === ordenados.length - 1 || (i % intervalo === 0 && ordenados.length - 1 - i >= intervalo)
        return exibir ? <text key={p.data} x={x(i)} y="214" textAnchor={i === 0 ? 'start' : i === ordenados.length - 1 ? 'end' : 'middle'} fontSize="16" fill="#617b9d">{dataCurta(p.data).slice(0, 5)}</text> : null
      })}
      {ordenados.map((p, i) => <g className="rot-chart-hover" key={`tooltip-${p.data}`} tabIndex={0} aria-label={`${dataCurta(p.data)}: ${p.aprovados} aprovados, ${p.restantes} restantes, ${p.falhados} falhados`}>
        {series.map(serie => <rect key={serie.campo} x={x(i) - 14} y={y(p[serie.campo]) - 14} width="28" height="28" fill="transparent" />)}
        <foreignObject className="rot-chart-tooltip-box" data-rot-tooltip x={Math.max(2, Math.min(larguraDesenho - 282, x(i) - 140))} y="38" width="280" height="155" pointerEvents="none">
          <div className="rot-chart-tooltip"><strong>{dataCurta(p.data)}</strong>{series.map(serie => <div key={serie.campo}><span><i style={{ background: serie.cor }} />{serie.nome}</span><b>{fmt(p[serie.campo])}</b></div>)}</div>
        </foreignObject>
      </g>)}
    </svg>
    <span className="rot-dash-nota">{ordenados.length === 1 ? 'Uma referência disponível; ainda não há evolução comparativa.' : `${ordenados.length} referências registradas, sem interpolação de datas ausentes.`}</span>
  </div>
}

function GraficoCausas({ causas, rotulo = 'Defeitos', cores = CORES_CAUSA, titulo, severidade = false, status = false }: { causas: Record<string, number> | undefined; rotulo?: string; cores?: string[]; titulo?: string; severidade?: boolean; status?: boolean }) {
  const itens = severidade ? ordenarSeveridades(causas) : lista(causas).filter(([, valor]) => valor > 0)
  const total = itens.reduce((soma, [, valor]) => soma + valor, 0)
  if (!total) return <p className="rot-dash-vazio">Nenhum dado disponível para esta visão.</p>
  return <div className={`rot-root-causes${titulo ? ' rot-root-causes-table' : ''}`}>
    {!titulo && <div className="rot-reporters-total"><strong>{fmt(total)}</strong><span>{rotulo}</span></div>}
    <div className="rot-root-causes-list" role="list" aria-label="Distribuição dos defeitos">
      {titulo && <div className="rot-root-causes-columns" aria-hidden="true"><span>{titulo}</span><span>Quantidade</span><span>Participação</span></div>}
      {itens.map(([nome, quantidade], indice) => {
        const percentual = quantidade / total * 100
        const cor = severidade ? corSeveridade(nome) : status ? corStatusDefeito(nome) : cores[indice % cores.length]
        const inicioCriticos = severidade && nivelSeveridade(nome) >= 3 && (indice === 0 || nivelSeveridade(itens[indice - 1][0]) < 3)
        return <div className={`rot-root-cause-row${inicioCriticos ? ' rot-severity-critical-start' : ''}`} role="listitem" key={nome}>
          <i className="rot-root-cause-dot" style={{ background: cor }} aria-hidden="true" />
          <span title={nome}>{nome}</span>
          <div className="rot-root-cause-track" aria-hidden="true"><i style={{ width: `${percentual}%`, background: cor }} /></div>
          <b>{fmt(quantidade)}</b>
          <small>{percentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</small>
        </div>
      })}
    </div>
  </div>
}

export default function RelatorioROT({ sprint, indicadores: d, atencoes, fechar }: Props) {
  const [temaRot, setTemaRot] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
  useEffect(() => {
    // Only the preview scrolls while open; restore each host container on close.
    const elementos = new Set<HTMLElement>([document.documentElement, document.body])
    let ancestral = document.querySelector('.rot-overlay')?.parentElement
    while (ancestral) {
      if (/(auto|scroll)/.test(getComputedStyle(ancestral).overflowY)) elementos.add(ancestral)
      ancestral = ancestral.parentElement
    }
    const anteriores = [...elementos].map(elemento => ({
      elemento,
      valor: elemento.style.getPropertyValue('overflow'),
      prioridade: elemento.style.getPropertyPriority('overflow'),
    }))
    anteriores.forEach(({ elemento }) => elemento.style.setProperty('overflow', 'hidden'))
    return () => anteriores.forEach(({ elemento, valor, prioridade }) => {
      if (valor) elemento.style.setProperty('overflow', valor, prioridade)
      else elemento.style.removeProperty('overflow')
    })
  }, [])
  const [abaDefeitos, setAbaDefeitos] = useState('status')
  const [abaInsights, setAbaInsights] = useState('insights')
  const [atencaoAberta, setAtencaoAberta] = useState<string | null>(null)
  const itensRollover = d.rollover?.itens ?? []
  const abrirRollover = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const painel = document.getElementById('rot-rollover-detalhes') as HTMLDetailsElement | null
    if (painel) { painel.open = true; painel.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
  }

  const abrirAtencao = (event: React.MouseEvent<HTMLAnchorElement>, grupo: string) => {
    event.preventDefault()
    setAtencaoAberta(grupo)
    const painel = document.getElementById('rot-attention-detalhes') as HTMLDetailsElement | null
    if (painel) {
      painel.open = true
      painel.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }
  const abrirGovernanca = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const painel = document.getElementById('rot-governance-detalhes') as HTMLDetailsElement | null
    if (painel) { painel.open = true; painel.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
  }
  const [paginaSla, setPaginaSla] = useState(1)
  const [filtrosSla, setFiltrosSla] = useState({ prioridade: '', status: '', situacao: '' })
  const filtrarSla = (campo: keyof typeof filtrosSla, valor: string) => {
    setPaginaSla(1)
    setFiltrosSla(atual => ({ ...atual, [campo]: valor }))
  }
  const consultaFuncoesRelatores = useConsultaRecurso(sprint.id, consultarConfiguracaoRelatores)
  const relatoresOrdenados = agruparRelatores(d.defeitos.dados_sla ?? [], consultaFuncoesRelatores.dados, d.contexto.project_key, d.contexto.team_name)
  const linhasSla = (d.defeitos.dados_sla ?? []).map((bug, indice) => {
    const resultado = calcularSla(bug.prioridade, bug.criacao, bug.resolucao)
    const cancelado = ['cancelado', 'cancelada', 'canceled', 'cancelled'].includes(normalizarDefeito(bug.status ?? ''))
    const situacao = cancelado ? 'sem_dados' : resultado.situacao
    const statusNormalizado = (bug.status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    const encerrado = cancelado || resultado.encerrado || ['concluido', 'concluida', 'done', 'closed', 'resolved', 'resolvido', 'fechado'].includes(statusNormalizado)
    const restante = resultado.minutosPrevistos !== null && resultado.minutosConsumidos !== null
      ? resultado.minutosPrevistos - resultado.minutosConsumidos
      : null
    return {
      ...bug, indice, resultado, situacao, encerrado,
      grupoAcao: cancelado ? 3 : situacao === 'sem_dados' ? 4 : encerrado ? 2 : 0,
      tempoRestante: restante,
      rotulo: cancelado ? 'Não se aplica' : situacao === 'sem_dados' ? 'Sem dados' : rotuloSituacaoSla(bug.status, resultado.situacao, resultado.rotulo),
      ordemSituacao: { estourado: 0, limite: 1, dentro: 2, sem_dados: 3 }[situacao],
    }
    }).sort((a, b) => {
    const grupo = a.grupoAcao - b.grupoAcao
    if (grupo) return grupo
    // Negative remaining time means overdue; the most overdue comes first.
    if (a.grupoAcao === 0) return (a.tempoRestante ?? 0) - (b.tempoRestante ?? 0) || a.indice - b.indice
    return a.ordemSituacao - b.ordemSituacao || a.indice - b.indice
  })
  const linhasFiltradasSla = linhasSla.filter(bug =>
    (!filtrosSla.prioridade || (bug.prioridade || '—') === filtrosSla.prioridade) &&
    (!filtrosSla.status || (bug.status || '—') === filtrosSla.status) &&
    (!filtrosSla.situacao || bug.rotulo === filtrosSla.situacao))
  const paginasSla = Math.max(1, Math.ceil(linhasFiltradasSla.length / 10))
  const paginaAtualSla = Math.min(paginaSla, paginasSla)
  const visiveisSla = new Set(linhasFiltradasSla.slice((paginaAtualSla - 1) * 10, paginaAtualSla * 10).map(bug => bug.indice))
  const opcoesFiltroSla = {
    prioridade: [...new Set(linhasSla.map(bug => bug.prioridade || '—'))],
    status: [...new Set(linhasSla.map(bug => bug.status || '—'))],
    situacao: [...new Set(linhasSla.map(bug => bug.rotulo))],
  }
  const consultaPeriodo = useConsultaRecurso(sprint.iteracao_id, consultarPeriodoSprint)
  const consultaEvolucao = useConsultaRecurso(sprint.id, consultarEvolucaoDiariaSprint)
  const consultaNotas = useConsultaRecurso(sprint.id, consultarNotasSprint)
  const consultaGovernanca = useConsultaRecurso(sprint.id, consultarRegistrosGovernanca)
  const consultaAtencoesRot = useConsultaRecurso(atencoes ? null : sprint.id, consultarAtencoesSprintAtiva)
  const fonteAtencoes = atencoes ?? consultaAtencoesRot.dados
  const gruposAtencao = montarAtencoesRot(linhasSla, fonteAtencoes?.ocorrencias ?? [])

  const periodo = consultaPeriodo.dados
  const periodoCarregando = consultaPeriodo.status === 'carregando'
  const dias = consultaEvolucao.dados?.pontos ?? []
  const notas = (consultaNotas.dados?.notas ?? []).filter(n => n.finalidade === 'relatorio')
  const avisos = [
    ...(consultaFuncoesRelatores.status === 'erro' ? ['Funções dos relatores indisponíveis; os nomes originais foram mantidos.'] : []),
    ...(consultaPeriodo.status === 'erro' ? ['Período planejado indisponível para consulta.'] : []),
    ...(consultaEvolucao.status === 'erro' ? ['Histórico diário indisponível.'] : []),
    ...(consultaNotas.status === 'erro' ? ['Comentários do relatório indisponíveis.'] : []),
  ]
  const sla: Record<string, number> = { 'Dentro do prazo': 0, 'No limite': 0, 'Estourado': 0, 'Sem dados': 0 }
  for (const bug of d.defeitos.dados_sla ?? []) {
    if ((bug.status ?? '').trim().toLocaleLowerCase('pt-BR') === 'cancelado') { sla['Sem dados']++; continue }
    const resultado = calcularSla(bug.prioridade, bug.criacao, bug.resolucao)
    const nome = resultado.situacao === 'dentro' ? 'Dentro do prazo' : resultado.situacao === 'limite' ? 'No limite' : resultado.situacao === 'estourado' ? 'Estourado' : 'Sem dados'
    sla[nome]++
  }
  const exportar = async () => {
    const conteudoOriginal = document.getElementById('rot-relatorio-conteudo')?.outerHTML
    if (!conteudoOriginal) return
    try {
      const [conteudo, fundoMontanhas] = await Promise.all([
        incorporarImagens(conteudoOriginal),
        imagemEmDataUri(imagemMontanhas),
      ])
      // O caminho relativo do CSS não existe no arquivo HTML aberto localmente.
      const cssExportacao = css.replace(
        /url\(["']?\.\.\/\.\.\/assets\/rot-montanhas\.jpg["']?\)/g,
        `url("${fundoMontanhas}")`,
      )
      const html = `<!doctype html><html lang="pt-BR" data-theme="${temaRot}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ROT - ${esc(sprint.sprint_name)}</title><style>${themeCss}\n${variaveisDeStatusParaExportacao()}\n${cssExportacao}</style></head><body class="rot-export" data-theme="${temaRot}">${conteudo}</body></html>`
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = `ROT_${sprint.project_key}_${new Date().toISOString().slice(0, 10)}.html`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (erro) {
      window.alert(`Não foi possível exportar o ROT com todos os recursos incorporados. ${erro instanceof Error ? erro.message : String(erro)}`)
    }
  }

  const statusRot = statusExibidoSprint(sprint, periodo)
  const prazoRot = calcularPrazoSprint(periodo)
  const detalheRot = sprint.status === 'concluida' ? 'Ciclo encerrado' : periodoCarregando ? 'Consultando período…' : prazoRot.estadoPrazo === 'atraso' ? `${prazoRot.textoPrazo} de atraso` : statusRot.detalhe
  const tituloRot = sprint.status === 'concluida' ? statusRot.titulo : periodoCarregando ? 'Consultando status…' : statusRot.titulo
  const executadosDensidade = d.execucao.concluidos
  const densidadeRot = executadosDensidade > 0 ? d.defeitos.originados / executadosDensidade * 100 : null
  const estadoDensidadeRot = densidadeRot === null ? 'indisponivel' : densidadeRot <= 15 ? 'saudavel' : densidadeRot <= 30 ? 'atencao' : 'critico'
  const percentualExecucao = Math.max(0, Math.min(100, d.execucao.percentual_execucao ?? 0))
  const totalSlaClassificado = sla['Dentro do prazo'] + sla['No limite'] + sla['Estourado']
  const percentualSla = totalSlaClassificado > 0
    ? (sla['Dentro do prazo'] / totalSlaClassificado) * 100
    : null
  const pontosGrafico = MOCK_EVOLUCAO_ROT ? MOCK_PONTOS_EVOLUCAO : dias
  const referenciasGrafico = [...pontosGrafico].sort((a, b) => a.data.localeCompare(b.data))
  const referencias = [...dias]
    .sort((a, b) => a.data.localeCompare(b.data))

  const atual = referencias.at(-1)
  const anterior = referencias.at(-2)
  const atualGrafico = referenciasGrafico.at(-1)
  const anteriorGrafico = referenciasGrafico.at(-2)
  const deltaAprovados = atualGrafico && anteriorGrafico ? atualGrafico.aprovados - anteriorGrafico.aprovados : null

  const variacao = (
    campo: 'aprovados' | 'falhados' | 'restantes' | 'total'
  ): number | null => {
    if (!atual || !anterior) return null

    return atual[campo] - anterior[campo]
  }

  const comparacaoKpi = atual && anterior ? `Comparação ${dataCurta(anterior.data)} → ${dataCurta(atual.data)}` : undefined
  const indicadoresExecutivos = [
    {
      nome: 'Aprovados',
      valor: fmt(d.execucao.passed),
      tipo: 'aprovados',
      detalhe: 'Testes aprovados',
      delta: variacao('aprovados'),
    },
    {
      nome: 'Falhados',
      valor: fmt(d.execucao.failed),
      tipo: 'falhados',
      detalhe: 'Testes falhados',
      delta: variacao('falhados'),
    },
    {
      nome: 'Restantes',
      valor: fmt(Math.max(0, d.execucao.total - d.execucao.passed - d.execucao.failed)),
      tipo: 'restantes',
      detalhe: 'Não executados',
      delta: variacao('restantes'),
    },
    {
      nome: 'Defeitos',
      valor: fmt(d.defeitos.total),
      tipo: 'defeitos',
      detalhe: 'Defeitos identificados',
      delta: atual?.escopo && anterior?.escopo ? atual.escopo.bugs - anterior.escopo.bugs : null,
    },
  ] as const
  const participacaoInsight = (quantidade: number, total: number) => total > 0
    ? (quantidade / total * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : null
  const sucessoInsight = participacaoInsight(d.execucao.passed, d.execucao.total)
  const pendenciasInsight = participacaoInsight(d.execucao.failed + d.execucao.not_run, d.execucao.total)
  const coberturaInsight = participacaoInsight(d.cobertura.historias_sem_plano, d.escopo.historias)
  const causasDisponiveis = Object.keys(d.defeitos.por_causa_raiz ?? {}).length > 0 || d.defeitos.total === 0
  const defeitosSemCausa = Object.entries(d.defeitos.por_causa_raiz ?? {}).reduce((total, [nome, quantidade]) =>
    total + (nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'sem causa raiz' ? quantidade : 0), 0)
  const semCausaInsight = participacaoInsight(defeitosSemCausa, d.defeitos.total)
  const deltaFormatado = (valor: number) => `${valor > 0 ? '+' : ''}${fmt(valor)}`
  const evolucaoInsight = atual && anterior
    ? `Desde ${dataCurta(anterior.data)}: ${deltaFormatado(atual.aprovados - anterior.aprovados)} aprovados, ${deltaFormatado(atual.falhados - anterior.falhados)} falhados e ${deltaFormatado(atual.restantes - anterior.restantes)} restantes.`
    : consultaEvolucao.status === 'erro' ? 'Histórico de execução indisponível.' : 'Aguardando duas referências para comparar a execução.'
  const primeiraReferencia = referencias[0]
  const variacaoEscopoInsight = atual && primeiraReferencia && referencias.length >= 2
    ? `De ${dataCurta(primeiraReferencia.data)} a ${dataCurta(atual.data)}: ${fmt(primeiraReferencia.total)} para ${fmt(atual.total)} testes (${deltaFormatado(atual.total - primeiraReferencia.total)} no escopo).`
    : consultaEvolucao.status === 'erro' ? 'Histórico de escopo indisponível.' : 'Aguardando duas referências para comparar o escopo.'
  const analisesDefeitos = [
    { id: 'status', titulo: 'Status', icone: ClipboardCheck, dados: d.defeitos.por_status, cores: CORES_CAUSA, destaque: 'Defeitos cancelados' },
    { id: 'causa', titulo: 'Causa raiz', icone: Bug, dados: d.defeitos.por_causa_raiz, cores: CORES_CAUSA, destaque: 'Causa raiz mais frequente' },
    { id: 'severidade', titulo: 'Severidade', icone: ChartNoAxesColumnIncreasing, dados: d.defeitos.por_prioridade, cores: ['#f04455', '#ffae32', '#4c8cf5', '#80b8ff', '#b6c3d3'], destaque: 'Severidade mais frequente' },
    { id: 'relator', titulo: 'Relator', icone: ClipboardCheck, dados: Object.fromEntries(relatoresOrdenados), cores: CORES_CAUSA, destaque: 'Relator com mais defeitos' },
  ]
  return <div className="rot-overlay" data-theme={temaRot}><div className="rot-toolbar"><strong><FileText size={18} strokeWidth={1.8} aria-hidden="true" />Pré-visualização <span>ROT</span></strong><div><button className="rot-theme-button" type="button" onClick={() => { const next = temaRot === 'dark' ? 'light' : 'dark'; setTemaRot(next) }} aria-label={temaRot === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} title={temaRot === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}>{temaRot === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button><button type="button" onClick={exportar} disabled={consultaFuncoesRelatores.status === 'carregando'}><Download size={15} strokeWidth={1.8} aria-hidden="true" />Exportar HTML</button><button type="button" onClick={fechar}><ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />Voltar à sprint</button></div></div>
    <main className="rot-report" id="rot-relatorio-conteudo">
      <header className="rot-hero rot-hero-horizontal">
        <div className="rot-hero-identidades">
          <div className="rot-logo-slot rot-logo-ntt">{logoNtt ? <img data-rot-logo="ntt" src={logoNtt} alt="NTT DATA" /> : <span className="rot-logo-fallback">NTT DATA</span>}</div>
        </div>
        <div className="rot-hero-informacoes">
          <div className="rot-hero-eyebrow">ROT · RELATÓRIO OPERACIONAL DE TESTES DE QA</div>
          <h1>{d.contexto.project_key} — {d.contexto.team_name}</h1>
          <div className="rot-hero-subtitulo">{d.contexto.sprint_name} <span className="rot-hero-separador">|</span> Squad: {d.contexto.team_name} <span className="rot-hero-separador">|</span> Período: {periodo?.inicio && periodo.fim ? `${dataCurta(periodo.inicio)} – ${dataCurta(periodo.fim)}` : periodoCarregando ? 'Consultando...' : consultaPeriodo.status === 'erro' ? 'Indisponível' : 'Não definido'}</div>
          <div className="rot-hero-frase"><i aria-hidden="true" />“Qualidade não é um ato. É um hábito.”</div>
        </div>
        <div className="rot-hero-status">
          <div className="rot-hero-atualizacao"><span className="rot-hero-calendar" aria-hidden="true">▦</span><div><small>Última atualização</small><strong>{data(d.contexto.atualizado_em ?? d.contexto.consolidada_em)}</strong></div></div>
          <span className={`rot-hero-status-pill rot-hero-status-${statusRot.estado}`}><span aria-hidden="true">●</span>{tituloRot}</span>
          <small className="rot-hero-restante">{detalheRot}</small>
        </div>
      </header>

      <div className="rot-executive-panel">
        <section className="rot-kpis" aria-label="Indicadores executivos da sprint">
          <article className="rot-kpi rot-kpi-cenario">
            <div className="rot-kpi-icon" aria-hidden="true"><IconeRot nome="cenario" /></div>
            <div className="rot-kpi-conteudo"><small>Cenário de testes</small><div className="rot-kpi-value-row"><strong>{fmt(d.execucao.total)}</strong><VariacaoKpi valor={variacao('total')} comparacao={comparacaoKpi} /></div><span className="rot-kpi-detalhe">Total de testes</span></div>
            <div className="rot-kpi-execucao">
              <div className="rot-kpi-anel" style={{ background: `conic-gradient(#18b78a ${percentualExecucao}%, #dce8f5 0)` }} role="img" aria-label={`Execução: ${percentualExecucao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}>
                <span>{percentualExecucao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
              </div>
              <span>Execução</span>
            </div>
          </article>
          {indicadoresExecutivos.map(item => (
            <article
              className={`rot-kpi rot-kpi-${item.tipo}`}
              key={item.tipo}
            >
              <div className="rot-kpi-icon" aria-hidden="true">
                <IconeRot nome={item.tipo} />
              </div>

              <div className="rot-kpi-conteudo">
                <small>{item.nome}</small>
                <div className="rot-kpi-value-row"><strong>{item.valor}</strong><VariacaoKpi valor={item.delta} inverter={item.tipo === 'falhados' || item.tipo === 'restantes' || item.tipo === 'defeitos'} comparacao={comparacaoKpi} /></div>
                {item.tipo === 'defeitos' && <span className="rot-kpi-total-label">Total da sprint</span>}

                {item.tipo === 'defeitos' ? (
                  <div className="rot-defeitos-resumo-metricas"><span><b>{fmt(d.defeitos.originados)}</b><em>Desta sprint</em></span><span><b>{fmt(d.defeitos.herdados)}</b><em>Herdados</em></span><span><b>{fmt(d.defeitos.origem_indeterminada)}</b><em>Sem classificação</em></span></div>
                ) : item.delta === null ? <span className="rot-kpi-variacao-indisponivel">Sem comparativo</span> : null}

                <span className="rot-kpi-detalhe">
                  {item.tipo === 'defeitos' ? null : item.delta === 0
                    ? 'Sem alteração'
                    : item.detalhe}
                </span>
              </div>
            </article>
          ))}
          <article className={`rot-kpi rot-kpi-densidade rot-densidade-${estadoDensidadeRot}`}>
            <div className="rot-kpi-icon" aria-hidden="true"><IconeRot nome="densidade" /></div>
            <div className="rot-kpi-conteudo"><small>Densidade</small><strong>{densidadeRot === null ? '—' : `${densidadeRot.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</strong><span className="rot-kpi-detalhe">{densidadeRot === null ? 'Sem cenários executados' : `${fmt(d.defeitos.originados)} defeitos / ${fmt(executadosDensidade)} executados`}</span></div>
            <span className="rot-density-info" tabIndex={0} role="button" aria-label="Entenda o cálculo e as faixas de densidade" aria-describedby="rot-density-tooltip"><Info size={13} strokeWidth={1.8} aria-hidden="true" />
              <span className="rot-density-tooltip" id="rot-density-tooltip" role="tooltip">
                <strong>Densidade de defeitos — {estadoDensidadeRot === 'saudavel' ? 'Saudável' : estadoDensidadeRot === 'atencao' ? 'Atenção' : estadoDensidadeRot === 'critico' ? 'Crítico' : 'Sem dados'}</strong>
                <span>{densidadeRot === null ? 'Sem cenários executados suficientes para calcular.' : estadoDensidadeRot === 'saudavel' ? 'Dentro da faixa de referência. Acompanhe a evolução e a criticidade dos defeitos.' : estadoDensidadeRot === 'atencao' ? 'Acima da referência de 15%. Avalie a criticidade, concentrações por funcionalidade e a evolução nos próximos dias.' : 'Acima de 30%. Investigue prioritariamente a severidade, os agrupamentos e os impactos na execução.'}</span>
                <span><b>Como é calculada:</b> defeitos identificados ÷ cenários executados × 100.</span>
                <span><b>Faixas do QualityHub:</b> até 15% — saudável; acima de 15% até 30% — atenção; acima de 30% — crítico.</span>
                <span>São referências operacionais e não determinam, isoladamente, a qualidade do produto.</span>
              </span>
            </span>
          </article>
          <article className="rot-kpi rot-kpi-sla">
            <div className="rot-kpi-icon" aria-hidden="true"><IconeRot nome="sla" /></div>
            <div className="rot-kpi-conteudo"><small>SLA dos defeitos</small><strong>{percentualSla === null ? '—' : `${percentualSla.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</strong><span className="rot-kpi-detalhe">{percentualSla === null ? 'Sem dados classificados' : `${sla['Dentro do prazo']} de ${totalSlaClassificado} dentro do prazo`}</span></div>
            <a className="rot-sla-eye" href="#rot-sla-detalhes" data-rot-sla-trigger aria-label="Ver detalhes do SLA dos defeitos" title="Ver defeitos e SLA" onClick={event => {
              event.preventDefault()
              const painel = document.getElementById('rot-sla-detalhes') as HTMLDetailsElement | null
              if (painel) { painel.open = true; painel.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
            }}><Eye size={16} strokeWidth={1.8} aria-hidden="true" /></a>
          </article>

        </section>
        <div className="rot-main-layout">
        <section className="rot-dash-grid" aria-label="Dashboards de análise operacional">
          <article className="rot-panel rot-dash-card rot-status-panel">
            <div className="rot-dash-cabecalho"><IconeDashboard tipo="status" /><div><h3>Execução de testes por status</h3><p>Distribuição dos testes por resultado</p></div><div className="rot-dash-total"><small>Total de testes</small><b>{fmt(d.execucao.total)}</b></div></div>
            <div className="rot-dash-status"><div className="rot-status-columns" aria-hidden="true"><span>Status</span><span>Quantidade</span><span>Participação</span></div>{([
              ['Aprovados', d.execucao.passed, '#18c987'],
              ['Não executados', d.execucao.not_run, '#94a3b8'],
              ['Em andamento', d.execucao.in_progress, '#3b82f6'],
              ['Falhados', d.execucao.failed, '#f04455'],
            ] as const).map(([nome, valor, cor]) => <div className="rot-dash-status-linha" key={nome}><span className="rot-status-label"><i style={{ background: cor }} aria-hidden="true" />{nome}</span><div className="rot-dash-trilho"><i style={{ width: `${d.execucao.total ? valor / d.execucao.total * 100 : 0}%`, background: cor }} /></div><b>{fmt(valor)}</b><small>{d.execucao.total ? (valor / d.execucao.total * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0'}%</small></div>)}</div>
          </article>
          <article className="rot-panel rot-dash-card">
            <div className="rot-dash-cabecalho rot-dash-cabecalho-evolucao"><IconeDashboard tipo="evolucao" /><div><h3>Evolução diária da execução {MOCK_EVOLUCAO_ROT && <span className="rot-dash-demo">DEMONSTRAÇÃO</span>}</h3><p>Progresso dos testes ao longo da sprint</p></div><div className={`rot-dash-delta ${deltaAprovados === null ? "indisponivel" : deltaAprovados > 0 ? "positivo" : deltaAprovados < 0 ? "negativo" : "neutro"}`}><strong className="rot-chart-delta-value">{deltaAprovados === null ? '—' : deltaAprovados === 0 ? 'Sem alteração' : <>{`${deltaAprovados > 0 ? '+' : ''}${fmt(deltaAprovados)}`}{deltaAprovados > 0 ? <TrendingUp size={13} strokeWidth={1.8} aria-hidden="true" /> : <TrendingDown size={13} strokeWidth={1.8} aria-hidden="true" />}</>}</strong><small>{deltaAprovados === null ? "Sem comparação disponível" : "Aprovados desde o registro anterior"}</small></div></div>
            <GraficoEvolucao pontos={pontosGrafico} />
          </article>

        </section>
        <section className="rot-panel rot-defect-analysis" data-rot-defect-analysis aria-labelledby="rot-defect-title">
          <div className="rot-defect-header">
            <div className="rot-defect-heading"><Bug size={20} strokeWidth={1.8} aria-hidden="true" /><div><h3 id="rot-defect-title">Análise de defeitos</h3><p>Total e distribuição dos defeitos em diferentes visões.</p></div></div>
            <div className="rot-defect-tabs" role="tablist" aria-label="Visões dos defeitos">
              {analisesDefeitos.map((aba, indice) => <button key={aba.id} type="button" role="tab" id={`rot-defect-tab-${aba.id}`} aria-controls={`rot-defect-panel-${aba.id}`} aria-selected={abaDefeitos === aba.id} tabIndex={abaDefeitos === aba.id ? 0 : -1} data-rot-defect-tab={aba.id} onClick={() => setAbaDefeitos(aba.id)} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const destino = event.key === 'Home' ? 0 : event.key === 'End' ? analisesDefeitos.length - 1 : (indice + (event.key === 'ArrowRight' ? 1 : -1) + analisesDefeitos.length) % analisesDefeitos.length
                setAbaDefeitos(analisesDefeitos[destino].id)
                document.getElementById(`rot-defect-tab-${analisesDefeitos[destino].id}`)?.focus()
              }}>{aba.titulo}</button>)}
            </div>
          </div>
          {analisesDefeitos.map(aba => {
            const itens = lista(aba.dados).filter(([, quantidade]) => quantidade > 0)
            const total = itens.reduce((soma, [, quantidade]) => soma + quantidade, 0)
            const destaque = destaqueDefeitos(aba.id, aba.dados)
            const IconeDestaque = destaque?.tom === 'info' ? Info : TriangleAlert
            return <div key={aba.id} className="rot-defect-view" id={`rot-defect-panel-${aba.id}`} role="tabpanel" aria-labelledby={`rot-defect-tab-${aba.id}`} data-rot-defect-panel={aba.id} hidden={abaDefeitos !== aba.id}>
              <div className="rot-defect-overview"><div className="rot-reporters-total"><strong>{fmt(total)}</strong><span>Defeitos</span></div>
              {destaque && <aside className={`rot-defect-highlight is-${destaque.tom}`}><IconeDestaque size={20} strokeWidth={1.8} aria-hidden="true" /><div><span>{destaque.titulo}</span><strong>{destaque.valor}</strong><p>{destaque.detalhe}</p></div></aside>}</div>
              <GraficoCausas causas={aba.dados} rotulo="Defeitos" cores={aba.cores} titulo={aba.titulo} severidade={aba.id === 'severidade'} status={aba.id === 'status'} />
            </div>
          })}
        </section>
          <article className="rot-panel rot-insights rot-insights-sidebar" data-rot-insights aria-labelledby="rot-insights-title"><h3 id="rot-insights-title"><IconeRot nome="insights" /> Insights e pontos de atenção</h3>
            <div className="rot-defect-tabs rot-insight-tabs" role="tablist" aria-label="Insights e pontos de atenção">
              {([{ id: 'insights', titulo: 'Insights (6)', icone: Lightbulb }, { id: 'atencao', titulo: `Pontos de atenção (${gruposAtencao.length})`, icone: Target }]).map((aba, indice, abas) => <button key={aba.id} type="button" role="tab" id={`rot-insight-tab-${aba.id}`} aria-controls={`rot-insight-panel-${aba.id}`} aria-selected={abaInsights === aba.id} tabIndex={abaInsights === aba.id ? 0 : -1} data-rot-insight-tab={aba.id} onClick={() => setAbaInsights(aba.id)} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const destino = event.key === 'Home' ? 0 : event.key === 'End' ? abas.length - 1 : (indice + (event.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length
                setAbaInsights(abas[destino].id)
                document.getElementById(`rot-insight-tab-${abas[destino].id}`)?.focus()
              }}>{aba.titulo}</button>)}
            </div>
            <div role="tabpanel" id="rot-insight-panel-insights" aria-labelledby="rot-insight-tab-insights" data-rot-insight-panel="insights" hidden={abaInsights !== 'insights'}>
            <div className="rot-insight rot-insight-success"><CheckCircle2 className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>Execução dos testes</b><span>{fmt(d.execucao.passed)} aprovados de {fmt(d.execucao.total)} testes no escopo{sucessoInsight !== null ? ` (${sucessoInsight}% de sucesso).` : '.'}</span></div>
            <div className="rot-insight rot-insight-warning"><TriangleAlert className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>{d.execucao.failed ? 'Falhas em análise' : 'Resultado dos testes'}</b><span>{fmt(d.execucao.failed)} testes falhados e {fmt(d.execucao.not_run)} não executados{pendenciasInsight !== null ? ` (${pendenciasInsight}% do total).` : '.'}</span></div>
            <div className="rot-insight rot-insight-info"><ClipboardList className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>Cobertura das histórias</b><span>{fmt(d.cobertura.historias_sem_plano)} histórias sem Test Plan vinculado{coberturaInsight !== null ? ` (${coberturaInsight}% do escopo).` : '.'}</span></div>
            <div className="rot-insight rot-insight-info"><Info className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>Defeitos sem causa raiz</b><span>{causasDisponiveis ? `${fmt(defeitosSemCausa)} defeitos sem causa raiz informada${semCausaInsight !== null ? ` (${semCausaInsight}% do total de ${fmt(d.defeitos.total)}).` : '.'}` : 'Dados de causa raiz indisponíveis.'}</span></div>
            <div className="rot-insight rot-insight-info"><History className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>Evolução da execução</b><span>{evolucaoInsight}</span></div>
            <div className="rot-insight rot-insight-info"><ClipboardList className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>Variação do escopo de testes</b><span>{variacaoEscopoInsight}</span></div>
          </div>
            <div role="tabpanel" id="rot-insight-panel-atencao" aria-labelledby="rot-insight-tab-atencao" data-rot-insight-panel="atencao" hidden={abaInsights !== 'atencao'}>
              {gruposAtencao.map(grupo => {
                const Icone = grupo.tom === 'info' ? Info : TriangleAlert
                return <div className={`rot-insight rot-attention-card rot-insight-${grupo.tom}`} key={grupo.id}><Icone className="rot-insight-icon" size={17} strokeWidth={1.8} aria-hidden="true" /><b>{grupo.titulo}</b><span>{grupo.descricao}</span><a className="rot-attention-action" aria-label={`${grupo.acao}: ${grupo.titulo}`} title={grupo.acao} href={`#rot-attention-${grupo.id}`} data-rot-attention-trigger={grupo.id} onClick={event => abrirAtencao(event, grupo.id)}><Eye size={14} strokeWidth={1.8} aria-hidden="true" /></a></div>
              })}
              {!fonteAtencoes && <p className="rot-attention-placeholder">{consultaAtencoesRot.status === 'erro' ? 'Não foi possível consultar as pendências de cobertura e Test Plans. Os apontamentos disponíveis dos bugs permanecem na lista.' : 'Consultando pendências de cobertura e Test Plans…'}</p>}
              {fonteAtencoes && gruposAtencao.length === 0 && <p className="rot-attention-placeholder">Nenhum ponto de atenção identificado nos dados disponíveis.</p>}

            </div>
          </article>
        </div>
        <section className="rot-summary-grid">
          <article className="rot-panel rot-rollover"><h3><IconeRot nome="rollover" /> Itens em rollover</h3>
            <div className="rot-rollover-preview">
              {itensRollover.length > 0 ? <>
                <p className="rot-rollover-counts">{itensRollover.filter(item => item.tipo !== 'TP').length} Bugs/Sub-bugs <span>·</span> {itensRollover.filter(item => item.tipo === 'TP').length} TPs</p>
                <table className="rot-rollover-mini"><thead><tr><th>Tipo</th><th>ID</th><th>Status</th><th title="Vezes carregado">Vezes</th></tr></thead><tbody>{itensRollover.slice(0, 5).map(item => <tr key={`${item.issue_key}-${item.sprint_atual_id}`}><td>{item.tipo}</td><td title={item.resumo ?? undefined}>{item.url && /^https?:\/\//i.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.issue_key}</a> : item.issue_key}</td><td title={item.status ?? undefined}>{item.status ?? '—'}</td><td title={item.vezes_carregado === null ? 'Histórico de datas insuficiente para contar' : undefined}>{item.vezes_carregado ?? '—'}</td></tr>)}</tbody></table>
              </> : <div className="rot-rollover-no-items"><Clock3 size={20} strokeWidth={1.8} aria-hidden="true" /><strong>{d.rollover ? 'Nenhum item em rollover' : 'Dados de rollover indisponíveis'}</strong><span>{d.rollover ? 'Nenhum Bug/Sub-bug ou TP pendente com origem fora da sprint atual ou desconhecida.' : 'Recarregue os indicadores para consultar os itens.'}</span></div>}
            </div>
            <a className="rot-rollover-more" href="#rot-rollover-detalhes" data-rot-rollover-trigger onClick={abrirRollover}>Ver todos ({itensRollover.length})<ChevronUp size={13} strokeWidth={1.8} aria-hidden="true" /></a>
          </article>
          <article className="rot-panel rot-governance"><h3><IconeRot nome="comentarios" /> Comentários / governança do QA</h3>
            <ResumoGovernancaROT registros={consultaGovernanca.dados?.registros ?? []} notas={notas} status={consultaGovernanca.status} abrir={abrirGovernanca} />
          </article>

          <article className="rot-panel rot-sprint-summary"><h3><IconeRot nome="resumo" /> Visão geral da sprint</h3><dl>{[
            ['Início da sprint', dataCurta(periodo?.inicio ?? null)],
            ['Previsão de término', dataCurta(periodo?.fim ?? null)],
            ['Test Plans vinculados', fmt(d.escopo.test_plans)],
            ['Histórias no escopo', fmt(d.escopo.historias)],
            ['Histórias com Test Plan', fmt(d.cobertura.historias_com_plano)],
            ['Última sincronização', data(d.contexto.atualizado_em ?? d.contexto.consolidada_em)],
          ].map(([nome, valor]) => <div key={nome}><dt>{nome}</dt><dd>{valor}</dd></div>)}</dl></article>
        </section>
        <details name="rot-detalhamento" className="rot-panel rot-rollover-details rot-governance-details rot-compact-details" id="rot-governance-detalhes">
          <summary><MessageSquareText size={18} strokeWidth={1.8} aria-hidden="true" /><strong>Comentários / Governança do QA</strong><span>{consultaGovernanca.dados?.registros.length ?? 0} registros</span><small>Ocultar<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" /></small></summary>
          <GovernancaROT cicloId={sprint.id} consulta={consultaGovernanca} somenteLeitura />
          {notas.length > 0 && <section className="rot-governance-legacy"><h4>Comentários anteriores do relatório</h4>{notas.map(nota => <p className="rot-note" key={nota.id}><strong>{nota.issue_key} · </strong>{nota.texto}</p>)}</section>}
        </details>
        <details name="rot-detalhamento" className="rot-panel rot-rollover-details rot-attention-details rot-compact-details" id="rot-attention-detalhes">
          <summary><Target size={18} strokeWidth={1.8} aria-hidden="true" /><strong>Pontos de atenção</strong><small>Ocultar<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" /></small></summary>
          {gruposAtencao.map(grupo => <section className="rot-attention-group" id={`rot-attention-${grupo.id}`} key={grupo.id} data-rot-attention-group={grupo.id} hidden={atencaoAberta !== grupo.id}>
            <h4>{grupo.titulo} ({grupo.itens.length})</h4><p>{grupo.descricao}</p>
            <div className="rot-rollover-table-wrap"><table className="rot-rollover-table"><thead><tr><th>ID</th><th>Resumo</th><th>Status</th><th>Motivo / ação</th></tr></thead><tbody>{grupo.itens.map((item, indice) => <tr key={`${item.chave}-${indice}`}><td>{item.url && /^https?:\/\//i.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.chave}</a> : item.chave}</td><td>{item.titulo || '—'}</td><td>{item.status}</td><td>{item.motivo}</td></tr>)}</tbody></table></div>
          </section>)}
        </details>
        <details name="rot-detalhamento" className="rot-panel rot-rollover-details rot-compact-details" id="rot-rollover-detalhes">
          <summary><History size={18} strokeWidth={1.8} aria-hidden="true" /><strong>Itens em rollover</strong><span>{itensRollover.length} itens</span><small>Ocultar<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" /></small></summary>
          <p>Bugs/Sub-bugs e Test Plans pendentes, com origem anterior ou não informada. Ordenados por tipo e quantidade de carregamentos.</p>
          {itensRollover.length > 0 ? <div className="rot-rollover-table-wrap"><table className="rot-rollover-table"><thead><tr><th>Tipo</th><th>ID</th><th>Status</th><th>Vezes carregado</th><th>Sprint de origem</th><th>Sprint atual</th></tr></thead><tbody>{itensRollover.map(item => <tr key={`${item.issue_key}-${item.sprint_atual_id}`}><td>{item.tipo}</td><td title={item.resumo ?? undefined}>{item.url && /^https?:\/\//i.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.issue_key}</a> : item.issue_key}</td><td>{item.status ?? '—'}</td><td title={item.vezes_carregado === null ? 'Histórico de datas insuficiente para contar' : undefined}>{item.vezes_carregado ?? '—'}</td><td>{item.sprint_origem}</td><td>{item.sprint_atual}</td></tr>)}</tbody></table></div> : <p>Nenhum item em rollover disponível.</p>}
          <div className="rot-rollover-footnotes">{(d.rollover?.inconsistentes ?? 0) > 0 && <p>{d.rollover?.inconsistentes} itens não entram no rollover desta sprint: a origem é posterior a ela ou a criação ocorreu depois do seu encerramento no Jira. Esses vínculos precisam de revisão.</p>}
          {(d.rollover?.sem_historico ?? 0) > 0 && <p>{d.rollover?.sem_historico} itens listados com origem ou quantidade de carregamentos ainda não informada. Eles permanecem no rollover; uma nova sincronização pode complementar o histórico.</p>}</div>
        </details>
        <details name="rot-detalhamento" className="rot-panel rot-sla-details" id="rot-sla-detalhes" data-page={paginaAtualSla}>
          <summary><IconeRot nome="sla" /><strong className="rot-sla-title">SLA dos defeitos</strong><span className="rot-sla-count">{fmt(d.defeitos.dados_sla?.length ?? 0)} defeitos</span><small className="rot-sla-collapse">Ocultar<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" /></small></summary>
          <div className="rot-sla-filters">{(['prioridade', 'status', 'situacao'] as const).map(campo => <label key={campo}>{campo === 'prioridade' ? 'Prioridade' : campo === 'status' ? 'Status' : 'Situação do SLA'}<select data-rot-sla-filter={campo} value={filtrosSla[campo]} onChange={event => filtrarSla(campo, event.target.value)}><option value="">Todos</option>{opcoesFiltroSla[campo].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(valor => <option key={valor} value={valor}>{valor}</option>)}</select></label>)}<button type="button" data-rot-clear onClick={() => { setFiltrosSla({ prioridade: '', status: '', situacao: '' }); setPaginaSla(1) }}><RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />Limpar filtros</button></div>
          {linhasSla.length ? <div className="rot-table-wrap"><table className="rot-sla-table"><thead><tr>
            <th>ID</th>
            <th>Prioridade</th><th>Status</th>
            <th>Data de criação</th><th>Data de resolução</th><th>SLA previsto</th><th>Tempo decorrido</th>
            <th>Situação do SLA</th>
          </tr></thead><tbody>{linhasSla.map(bug => <tr hidden={!visiveisSla.has(bug.indice)} key={bug.issue_key ?? bug.indice} data-prioridade={bug.prioridade || '—'} data-status={bug.status || '—'} data-situacao={bug.rotulo}>
            <td>{bug.url && /^https?:\/\//i.test(bug.url) ? <a className="rot-ticket-link" href={bug.url.trim()} target="_blank" rel="noopener noreferrer" title="Abrir defeito no Jira">{bug.issue_key || '—'}<span aria-hidden="true"> ↗</span></a> : bug.issue_key || '—'}</td>
            <td>{bug.prioridade || '—'}</td><td>{bug.status || '—'}</td>
            <td>{bug.criacao ? data(bug.criacao) : '—'}</td><td>{bug.resolucao ? data(bug.resolucao) : '—'}</td>
            <td>{formatarTempoUtil(minutosSla(bug.prioridade))}</td><td><span className="rot-sla-elapsed" title={formatarTempoUtil(bug.resultado.minutosConsumidos)} aria-label={formatarTempoUtil(bug.resultado.minutosConsumidos)}>{formatarTempoUtilCompacto(bug.resultado.minutosConsumidos)}</span>{bug.resultado.minutosConsumidos !== null && <small className="rot-sla-elapsed-note" aria-hidden="true">Tempo útil decorrido</small>}</td>
            <td><span className={`rot-sla-badge rot-sla-${bug.situacao}`}>{bug.rotulo}</span></td>
          </tr>)}</tbody></table></div> : <p>Nenhum defeito com dados de SLA disponível.</p>}

          <p data-rot-empty hidden={linhasFiltradasSla.length > 0}>Nenhum defeito encontrado para os filtros selecionados.</p>
          {linhasSla.length > 0 && <nav className="rot-sla-pagination" aria-label="Paginar defeitos">
            <span data-rot-page-range aria-live="polite">{linhasFiltradasSla.length ? (paginaAtualSla - 1) * 10 + 1 : 0}–{Math.min(paginaAtualSla * 10, linhasFiltradasSla.length)} de {linhasFiltradasSla.length} defeitos</span>
            <div><button type="button" data-rot-page="first" disabled={paginaAtualSla === 1} onClick={() => setPaginaSla(1)} aria-label="Primeira página">«</button>
            <button type="button" data-rot-page="prev" disabled={paginaAtualSla === 1} onClick={() => setPaginaSla(paginaAtualSla - 1)}>Anterior</button>
            <span data-rot-page-label>Página {paginaAtualSla} de {paginasSla}</span>
            <button type="button" data-rot-page="next" disabled={paginaAtualSla === paginasSla} onClick={() => setPaginaSla(paginaAtualSla + 1)}>Próxima</button>
            <button type="button" data-rot-page="last" disabled={paginaAtualSla === paginasSla} onClick={() => setPaginaSla(paginasSla)} aria-label="Última página">»</button></div>
          </nav>}
        </details>
        {avisos.length > 0 && <aside className="rot-panel"><h3>Ressalvas de disponibilidade</h3>{avisos.map(x => <p key={x}>{x}</p>)}</aside>}
        <footer className="rot-footer">QualityHub · Relatório estático com dados disponíveis no momento da geração. Sem atualização automática.</footer>
      </div>
    </main>
  </div>
}
