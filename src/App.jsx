import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const FONT_IMPORT = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
`;

// ───── Helpers ─────
const fmtBRL = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

const fmtBRLcompact = (v) => {
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(2).replace('.', ',')} M`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} k`;
  return fmtBRL(v);
};

const fmtPct = (v) => `${(v * 100).toFixed(2).replace('.', ',')}%`;

const parseInputBRL = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d,]/g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : Math.round(v);
};

// ───── Tabela IRPF 2026 ─────
const TABELA_IRPF = [
  { ate: 24511.92,  aliq: 0,     ded: 0        },
  { ate: 33919.8,   aliq: 0.075, ded: 1838.39  },
  { ate: 45012.6,   aliq: 0.15,  ded: 4382.38  },
  { ate: 55976.16,  aliq: 0.225, ded: 7758.32  },
  { ate: Infinity,  aliq: 0.275, ded: 10557.13 },
];

const calcularIRPFBase = (rendaTributavel) => {
  if (rendaTributavel <= 0) return 0;
  for (const f of TABELA_IRPF) {
    if (rendaTributavel <= f.ate) return Math.max(0, rendaTributavel * f.aliq - f.ded);
  }
  return 0;
};

// ── Lei 15.270 (vigência 2026):
// • Renda mensal ≤ R$ 5.000 (R$ 60.000/ano) → ISENTO total
// • R$ 5.000 < renda mensal < R$ 7.350 → faixa de transição linear
// • Renda mensal ≥ R$ 7.350 (R$ 88.200/ano) → tabela progressiva sem alteração
// O redutor anula o IRPF base proporcionalmente ao quanto a renda está
// "dentro" da janela de transição.
const calcularRedutor2026 = (rendaTributavelAnual) => {
  if (rendaTributavelAnual <= 0) return 0;
  const rendaMensal = rendaTributavelAnual / 12;
  if (rendaMensal <= 5000)  return calcularIRPFBase(rendaTributavelAnual);  // 100% redutor → IRPF zero
  if (rendaMensal >= 7350)  return 0;                                       // sem redutor
  const fatorReducao = (7350 - rendaMensal) / (7350 - 5000);                // 1.0 em 5k → 0.0 em 7,350
  return calcularIRPFBase(rendaTributavelAnual) * fatorReducao;
};

const calcularAliquotaMinima = (rendaTotal) => {
  if (rendaTotal <= 600000)  return 0;
  if (rendaTotal >= 1200000) return 0.1;
  return ((rendaTotal - 600000) / 600000) * 0.1;
};

const calcularAliquotaRetencaoDividendos = (dividendos) => {
  if (dividendos <= 600000)  return 0;
  if (dividendos >= 1200000) return 0.10;
  return ((dividendos - 600000) / 600000) * 0.10;
};

// ── Tabela regressiva de IR sobre RF, mapeada por preset de meses
// ≤ 3m  → 22,5%
// ≤ 6m  → 20%
// ≤ 12m → 17,5%
// > 12m → 15%
const aliquotaPorPrazo = (meses) => {
  if (meses <= 3)  return 0.225;
  if (meses <= 6)  return 0.20;
  if (meses <= 12) return 0.175;
  return 0.15;
};

// ───── Componentes base ─────
const Card = ({ children, className = '' }) => (
  <div className={`relative rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/70 to-zinc-900/30 backdrop-blur-sm p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ${className}`}>
    {children}
  </div>
);

const Eyebrow = ({ children }) => (
  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 font-medium mb-2">{children}</p>
);

const NumberInput = ({ label, value, onChange, max, step, hint, accent = 'emerald', sublabel }) => {
  const [textValue, setTextValue] = useState(fmtBRL(value));
  const [editing,   setEditing]   = useState(false);

  useEffect(() => {
    if (!editing) setTextValue(fmtBRL(value));
  }, [value, editing]);

  const pct = Math.min((value / max) * 100, 100);
  const colors = {
    emerald: { thumb: '#10b981', t1: 'rgb(52 211 153)',  t2: 'rgb(16 185 129)',  glow: 'rgba(16,185,129,0.15)',  val: 'text-emerald-300', ring: 'focus:ring-emerald-500/40' },
    amber:   { thumb: '#f59e0b', t1: 'rgb(251 191 36)',  t2: 'rgb(245 158 11)',  glow: 'rgba(245,158,11,0.15)',  val: 'text-amber-300',   ring: 'focus:ring-amber-500/40'   },
    sky:     { thumb: '#38bdf8', t1: 'rgb(125 211 252)', t2: 'rgb(56 189 248)',  glow: 'rgba(56,189,248,0.15)', val: 'text-sky-300',     ring: 'focus:ring-sky-500/40'     },
    violet:  { thumb: '#a78bfa', t1: 'rgb(196 181 253)', t2: 'rgb(167 139 250)', glow: 'rgba(167,139,250,0.15)',val: 'text-violet-300',  ring: 'focus:ring-violet-500/40'  },
  };
  const c = colors[accent] || colors.emerald;

  const commitText = () => {
    const parsed  = parseInputBRL(textValue);
    const clamped = Math.max(0, Math.min(max, parsed));
    onChange(clamped);
    setTextValue(fmtBRL(clamped));
    setEditing(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <label className="text-[13px] text-zinc-300 font-medium">{label}</label>
          {sublabel && <p className="text-[10px] text-zinc-600 mt-0.5 leading-relaxed">{sublabel}</p>}
        </div>
        <input
          type="text" inputMode="numeric"
          value={editing ? textValue : fmtBRL(value)}
          onFocus={(e) => { setEditing(true); setTextValue(String(value)); requestAnimationFrame(() => e.target.select()); }}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          className={`text-right text-[14px] font-semibold ${c.val} bg-zinc-900/40 border border-zinc-800/60 rounded-md px-2 py-1 w-[128px] flex-shrink-0 outline-none transition-all ${c.ring} focus:ring-2`}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}
        />
      </div>
      <div className="relative pt-1">
        <input
          type="range" min={0} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`slider-${accent} w-full h-2 appearance-none rounded-full cursor-pointer focus:outline-none`}
          style={{ background: `linear-gradient(to right, ${c.t1} 0%, ${c.t2} ${pct}%, rgb(39 39 42) ${pct}%, rgb(39 39 42) 100%)` }}
        />
        <style>{`
          .slider-${accent}::-webkit-slider-thumb {
            -webkit-appearance:none; appearance:none;
            width:22px; height:22px; border-radius:50%;
            background:#fafafa; border:2px solid ${c.thumb}; cursor:grab;
            box-shadow:0 0 0 4px ${c.glow},0 2px 6px rgba(0,0,0,0.4);
            transition:transform 0.15s ease;
          }
          .slider-${accent}::-webkit-slider-thumb:active { cursor:grabbing; transform:scale(1.1); }
          .slider-${accent}::-moz-range-thumb {
            width:22px; height:22px; border-radius:50%;
            background:#fafafa; border:2px solid ${c.thumb}; cursor:grab;
            box-shadow:0 0 0 4px ${c.glow},0 2px 6px rgba(0,0,0,0.4);
          }
        `}</style>
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
        <span>R$ 0</span>
        {hint && <span className="text-zinc-500 italic">{hint}</span>}
        <span>{fmtBRLcompact(max)}</span>
      </div>
    </div>
  );
};

const ToggleButton = ({ value, label, sublabel, current, onClick, accentAtivo = 'emerald' }) => {
  const ativo = Math.abs(current - value) < 0.0001;
  const ring = { emerald: 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.3)_inset]', sky: 'border-sky-500/50 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.3)_inset]' };
  const txt  = { emerald: 'text-emerald-300', sky: 'text-sky-300' };
  const sub  = { emerald: 'text-emerald-400/70', sky: 'text-sky-400/70' };
  return (
    <button onClick={() => onClick(value)} className={`flex-1 px-2 py-2.5 rounded-lg border text-center transition-all ${ativo ? ring[accentAtivo] : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'}`}>
      <div className={`text-[14px] font-semibold ${ativo ? txt[accentAtivo] : 'text-zinc-300'}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      <div className={`text-[9px] mt-0.5 ${ativo ? sub[accentAtivo] : 'text-zinc-600'}`}>{sublabel}</div>
    </button>
  );
};

const CapitalBar = ({ capitalAtual, capitalAlvo, label }) => {
  if (!capitalAlvo || capitalAlvo <= 0) return null;
  const pct = Math.min((capitalAtual / capitalAlvo) * 100, 100);
  const atingido = capitalAtual >= capitalAlvo;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-[10px]">
        <span className="text-zinc-500 uppercase tracking-[0.15em]">{label}</span>
        <span className={`font-mono font-semibold ${atingido ? 'text-emerald-300' : 'text-amber-300'}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${atingido ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
        <span>{fmtBRLcompact(capitalAtual)}</span>
        <span>meta {fmtBRLcompact(capitalAlvo)}</span>
      </div>
    </div>
  );
};

const CreditoPill = ({ label, valor, cor = 'sky', detalhe, zero }) => {
  const p = {
    sky:    { border: 'border-sky-500/30',    bg: 'bg-sky-500/5',    txt: 'text-sky-300',    dot: 'bg-sky-400'    },
    violet: { border: 'border-violet-500/30', bg: 'bg-violet-500/5', txt: 'text-violet-300', dot: 'bg-violet-400' },
    zinc:   { border: 'border-zinc-700/40',   bg: 'bg-zinc-800/20',  txt: 'text-zinc-500',   dot: 'bg-zinc-600'   },
  }[cor] || {};
  const paleta = zero ? p.zinc || { border: 'border-zinc-700/40', bg: 'bg-zinc-800/20', txt: 'text-zinc-500', dot: 'bg-zinc-600' } : p;
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${paleta.border} ${paleta.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${paleta.dot}`} />
        <div>
          <p className={`text-[12px] font-medium ${paleta.txt}`}>{label}</p>
          {detalhe && <p className="text-[10px] text-zinc-600 mt-0.5">{detalhe}</p>}
        </div>
      </div>
      <p className={`text-[14px] font-semibold ${paleta.txt}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
        {fmtBRL(valor)}
      </p>
    </div>
  );
};

const MiniValueInput = ({ value, onChange, max, accent = 'violet' }) => {
  const [textValue, setTextValue] = useState(fmtBRL(value));
  const [editing,   setEditing]   = useState(false);
  const colors = {
    violet: { val: 'text-violet-300', ring: 'focus:ring-violet-500/40', border: 'border-violet-500/40' },
  };
  const c = colors[accent] || colors.violet;

  useEffect(() => { if (!editing) setTextValue(fmtBRL(value)); }, [value, editing]);

  const commit = () => {
    const parsed  = parseInputBRL(textValue);
    const clamped = Math.max(0, Math.min(max, parsed));
    onChange(clamped);
    setTextValue(fmtBRL(clamped));
    setEditing(false);
  };

  return (
    <input
      type="text" inputMode="numeric"
      value={editing ? textValue : fmtBRL(value)}
      onFocus={(e) => { setEditing(true); setTextValue(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      className={`text-right text-[14px] font-semibold ${c.val} bg-zinc-900/60 border ${c.border} rounded-md px-3 py-1.5 w-full outline-none transition-all ${c.ring} focus:ring-2`}
      style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}
    />
  );
};

// ── Input digitável de prazo em meses
const MiniMonthsInput = ({ value, onChange, max = 360 }) => {
  const [textValue, setTextValue] = useState(String(value));
  const [editing,   setEditing]   = useState(false);

  useEffect(() => { if (!editing) setTextValue(String(value)); }, [value, editing]);

  const commit = () => {
    const parsed  = parseInt(String(textValue).replace(/[^\d]/g, ''), 10);
    const v       = isNaN(parsed) ? 1 : parsed;
    const clamped = Math.max(1, Math.min(max, v));
    onChange(clamped);
    setTextValue(String(clamped));
    setEditing(false);
  };

  const display = editing ? textValue : `${value} ${value === 1 ? 'mês' : 'meses'}`;

  return (
    <input
      type="text" inputMode="numeric"
      value={display}
      onFocus={(e) => { setEditing(true); setTextValue(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      placeholder="prazo personalizado em meses"
      className="text-center text-[14px] font-semibold text-emerald-300 bg-zinc-900/60 border border-emerald-500/40 rounded-md px-3 py-1.5 w-full outline-none transition-all focus:ring-2 focus:ring-emerald-500/40"
      style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}
    />
  );
};

// ───── Componente Principal ─────
export default function App() {
  const [rendaTributavel, setRendaTributavel] = useState(700000);
  const [dividendos,      setDividendos]      = useState(2000000);
  const [rendimentoExterior, setRendimentoExterior] = useState(250000);
  const [capitalAplicado, setCapitalAplicado] = useState(500000);
  const [aliqRetencao,    setAliqRetencao]    = useState(0.15);
  const [pctCDI,          setPctCDI]          = useState(1.0);
  const [prazoMeses,      setPrazoMeses]      = useState(24);

  // LCA — simulação de alocação isenta (mesmo capital, prazo e %CDI próprios)
  const [capitalLCA, setCapitalLCA] = useState(500000);
  const [prazoLCAMeses, setPrazoLCAMeses] = useState(24);
  const [pctCDILCA, setPctCDILCA] = useState(0.85);
  const [modoPrazoLCA, setModoPrazoLCA] = useState('auto');

  // Sincroniza alíquota com o prazo (regressiva da RF)
  useEffect(() => {
    setAliqRetencao(aliquotaPorPrazo(prazoMeses));
  }, [prazoMeses]);

  const [modoRetencaoDiv, setModoRetencaoDiv] = useState('auto');
  const [retencaoDivManual, setRetencaoDivManual] = useState(0);
  const [modoPrazo, setModoPrazo] = useState('auto');

  const [cdi,       setCdi]       = useState(0.1465);
  const [cdiData,   setCdiData]   = useState(null);
  const [cdiSource, setCdiSource] = useState('referência');

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json');
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!data?.[0]?.valor || cancelado) return;
        const selic = parseFloat(String(data[0].valor).replace(',', '.')) / 100;
        setCdi(selic - 0.001);
        setCdiData(data[0].data);
        setCdiSource('BCB · SGS 432');
      } catch (_) {}
    })();
    return () => { cancelado = true; };
  }, []);

  const ALIQ_EXTERIOR = 0.15;

  const calc = useMemo(() => {
    const taxaEfetiva       = cdi * pctCDI;
    const fatorPeriodo      = Math.pow(1 + taxaEfetiva, prazoMeses / 12) - 1;
    const rendimentoBruto   = capitalAplicado * fatorPeriodo;
    const irRetidoRF        = rendimentoBruto * aliqRetencao;
    const rendimentoLiquido = rendimentoBruto - irRetidoRF;

    const aliqRetencaoDiv    = calcularAliquotaRetencaoDividendos(dividendos);
    const irRetidoDivAuto    = dividendos * aliqRetencaoDiv;
    const irRetidoDividendos = modoRetencaoDiv === 'auto' ? irRetidoDivAuto : retencaoDivManual;

    // ── Rendimentos do exterior (tributação definitiva 15%)
    const irExterior = rendimentoExterior * ALIQ_EXTERIOR;

    // ── Base do IRPFM: pró-labore + dividendos + exterior + rendimento RF
    const rendaTotal          = rendaTributavel + dividendos + rendimentoExterior + rendimentoBruto;
    const aliqMinima          = calcularAliquotaMinima(rendaTotal);
    const impostoMinimoDevido = rendaTotal * aliqMinima;

    // ── IRPF tradicional sobre rendaTributavel (pró-labore)
    const irpfBase        = calcularIRPFBase(rendaTributavel);
    const redutor2026     = calcularRedutor2026(rendaTributavel);
    const irpfTradicional = Math.max(0, irpfBase - redutor2026);

    // ── IR pago de FORMA DEFINITIVA (sem IRRF dividendos)
    //    = IRPF trad. (pró-labore) + IR exterior (15%) + IR RF
    const irPagoDefinitivo = irpfTradicional + irExterior + irRetidoRF;

    // ── Passo 3: Necessário complementar (IRPFM vs IR pago def.)
    const necessarioComplementar = Math.max(0, impostoMinimoDevido - irPagoDefinitivo);

    // ── Passo 4: Considera IRRF Dividendos
    //    saldo > 0 → restituir | saldo < 0 → complementar
    const creditoTotal = irPagoDefinitivo + irRetidoDividendos;
    const saldoFinal   = creditoTotal - impostoMinimoDevido;
    const valorRestituir       = Math.max(0,  saldoFinal);
    const valorAdicionalAPagar = Math.max(0, -saldoFinal);

    const razaoCobertura = impostoMinimoDevido > 0
      ? creditoTotal / impostoMinimoDevido
      : 1;

    let faixa;
    if (rendaTotal <= 600000)      faixa = 'isento';
    else if (rendaTotal < 1200000) faixa = 'transicao';
    else                           faixa = 'piso';

    // ── Capital ADICIONAL para fechar o gap quando há complemento a pagar
    // Cada R$1 de rendimento RF adicional: + a (crédito) − 0,1 (IRPFM)
    // ΔK = adicional / (f × (a − 0,1))
    const margemRF = aliqRetencao - 0.1;
    let capitalAlvo = null;
    if (margemRF > 0 && valorAdicionalAPagar > 0) {
      const calcCap = (pct) => {
        const t = cdi * pct;
        const f = Math.pow(1 + t, prazoMeses / 12) - 1;
        if (f * margemRF <= 0) return Infinity;
        return valorAdicionalAPagar / (f * margemRF);
      };
      capitalAlvo = { c100: calcCap(1.0), c110: calcCap(1.1), c90: calcCap(0.9) };
    }

    const rendimentoBrutoNecessario = margemRF > 0 ? valorAdicionalAPagar / margemRF : 0;

    // ── ALVO IDEAL: "isenção" dos dividendos
    // Capital tal que IR pago definitivo (IRPF trad + IR exterior + IR RF) = IRPFM
    let capitalAlvoIsencao = null;
    if (margemRF > 0 && necessarioComplementar > 0) {
      const calcCap = (pct) => {
        const t = cdi * pct;
        const f = Math.pow(1 + t, prazoMeses / 12) - 1;
        if (f * margemRF <= 0) return Infinity;
        return necessarioComplementar / (f * margemRF);
      };
      capitalAlvoIsencao = { c100: calcCap(1.0), c110: calcCap(1.1), c90: calcCap(0.9) };
    }

    const rendimentoBrutoIsencao = margemRF > 0 ? necessarioComplementar / margemRF : 0;

    // ── COMPARATIVO CDB (tributado) × LCA (isento)
    // CDB usa os parâmetros da Simulação de Alocação Tributada.
    // LCA usa os parâmetros da Simulação de Alocação Isenta (próprios).
    // Comparamos o ganho líquido total = rendimento líquido + saldo do IRPFM.
    const apurarCenario = (rendBruto, irRF) => {
      const renda = rendaTributavel + dividendos + rendimentoExterior + rendBruto;
      const aliq  = calcularAliquotaMinima(renda);
      const irpfm = renda * aliq;
      const irPagoDef = irpfTradicional + irExterior + irRF;
      const credTotal = irPagoDef + irRetidoDividendos;
      const saldo = credTotal - irpfm;       // > 0 restituir | < 0 complementar
      return { renda, irpfm, irPagoDef, saldo };
    };

    // CDB: usa fator/aliq da simulação tributada (já calculados acima)
    const cdbRendBruto = capitalAplicado * fatorPeriodo;
    const cdbIRrf      = cdbRendBruto * aliqRetencao;
    const cdbCenario   = apurarCenario(cdbRendBruto, cdbIRrf);
    const cdbLiquido   = cdbRendBruto - cdbIRrf;
    const cdbResultado = cdbLiquido + cdbCenario.saldo;

    // LCA: usa parâmetros próprios — capital, prazo e %CDI da simulação isenta
    const taxaLCA      = cdi * pctCDILCA;
    const fatorLCA     = Math.pow(1 + taxaLCA, prazoLCAMeses / 12) - 1;
    const lcaRendBruto = capitalLCA * fatorLCA;
    const lcaCenario   = apurarCenario(0, 0);  // não entra na base do IRPFM
    const lcaLiquido   = lcaRendBruto;
    const lcaResultado = lcaLiquido + lcaCenario.saldo;

    const diferencaCDBLCA = cdbResultado - lcaResultado;
    const melhorOpcao     = diferencaCDBLCA >= 0 ? 'cdb' : 'lca';
    const comparativo = {
      cdb: { capital: capitalAplicado, prazo: prazoMeses, pctCDI, aliq: aliqRetencao,
             rendBruto: cdbRendBruto, ir: cdbIRrf, liquido: cdbLiquido,
             saldo: cdbCenario.saldo, resultado: cdbResultado, irpfm: cdbCenario.irpfm,
             fator: fatorPeriodo },
      lca: { capital: capitalLCA, prazo: prazoLCAMeses, pctCDI: pctCDILCA, aliq: 0,
             rendBruto: lcaRendBruto, ir: 0, liquido: lcaLiquido,
             saldo: lcaCenario.saldo, resultado: lcaResultado, irpfm: lcaCenario.irpfm,
             fator: fatorLCA },
      diferenca: diferencaCDBLCA,
      melhor: melhorOpcao,
    };

    return {
      rendaTotal,
      rendimentoBruto, rendimentoLiquido, rendimentoBrutoNecessario,
      irExterior,
      irRetidoRF, irRetidoDivAuto, aliqRetencaoDiv, irRetidoDividendos,
      irpfBase, redutor2026, irpfTradicional,
      irPagoDefinitivo, necessarioComplementar,
      saldoFinal, valorRestituir, valorAdicionalAPagar,
      aliqMinima, impostoMinimoDevido, creditoTotal,
      // aliases compat
      impostoAdicional: valorAdicionalAPagar,
      creditoExcedente: valorRestituir,
      razaoCobertura, razaoEquivalencia: razaoCobertura,
      faixa, capitalAlvo, capitalAlvoIsencao, rendimentoBrutoIsencao, margemRF,
      comparativo,
      taxaEfetiva, fatorPeriodo,
      irRFNecessario: valorAdicionalAPagar,
    };
  }, [rendaTributavel, dividendos, rendimentoExterior, capitalAplicado,
      aliqRetencao, pctCDI, cdi, modoRetencaoDiv, retencaoDivManual, prazoMeses,
      capitalLCA, prazoLCAMeses, pctCDILCA]);

  const insights = useMemo(() => {
    const arr = [];
    const r = calc.rendaTotal;
    const concDiv = dividendos / Math.max(r, 1);
    const concExt = rendimentoExterior / Math.max(r, 1);

    // Status principal: restituir / complementar / equilibrado
    if (calc.impostoMinimoDevido === 0) {
      arr.push({ tom: 'success', titulo: 'Sem IRPFM devido', texto: 'Renda total abaixo de R$ 600k — fora do gatilho da Lei 15.270.' });
    } else if (calc.valorRestituir > 1000) {
      arr.push({ tom: 'success', titulo: `Restituição prevista: ${fmtBRL(calc.valorRestituir)}`, texto: `Os créditos totais (${fmtBRL(calc.creditoTotal)}) excedem o IRPFM (${fmtBRL(calc.impostoMinimoDevido)}). O saldo é restituído na declaração anual.` });
    } else if (calc.valorAdicionalAPagar > 100) {
      arr.push({ tom: 'amber', titulo: `Adicional a complementar: ${fmtBRL(calc.valorAdicionalAPagar)}`, texto: `IRPFM (${fmtBRL(calc.impostoMinimoDevido)}) maior que créditos (${fmtBRL(calc.creditoTotal)}). Cada R$ 1 de rendimento RF contribui ${fmtPct(calc.margemRF)} líquido para fechar o gap.` });
    } else {
      arr.push({ tom: 'success', titulo: 'Equilíbrio fiscal', texto: `Créditos compensáveis ≡ IRPFM em ${fmtBRL(calc.impostoMinimoDevido)}. Eficiência tributária máxima.` });
    }

    // Faixa
    if (calc.faixa === 'isento')    arr.push({ tom: 'success', titulo: 'Renda total abaixo de R$ 600 mil', texto: 'Cliente fora do gatilho do IRPFM. Janela estratégica: dividendos ainda são tributariamente ótimos.' });
    if (calc.faixa === 'transicao') arr.push({ tom: 'warn',    titulo: 'Faixa de transição (R$ 600k–R$ 1,2M)', texto: `Alíquota mínima: ${fmtPct(calc.aliqMinima)}. Acima de R$ 1,2M trava em 10%. Adicionar capital tributado pode cruzar a fronteira — verificar incidência marginal.` });
    if (calc.faixa === 'piso')      arr.push({ tom: 'info',    titulo: 'Cliente no piso de 10% do IRPFM', texto: `Renda total ${fmtBRLcompact(r)} acima de R$ 1,2M. IRPFM de ${fmtBRL(calc.impostoMinimoDevido)} sobre todos os rendimentos do ano-calendário.` });

    if (calc.irRetidoDividendos > 0) {
      arr.push({ tom: 'info', titulo: 'IRRF Dividendos · Lei 15.270', texto: `${fmtBRL(calc.irRetidoDividendos)} retidos na fonte sobre os dividendos${modoRetencaoDiv === 'manual' ? ' (valor informado)' : ` (alíquota efetiva ${fmtPct(calc.aliqRetencaoDiv)})`}. Compensa o IRPFM em conjunto com os demais créditos.` });
    }
    if (calc.irExterior > 0) {
      arr.push({ tom: 'info', titulo: 'IR sobre rendimentos do exterior · 15%', texto: `${fmtBRL(calc.irExterior)} pagos de forma definitiva sobre ${fmtBRL(rendimentoExterior)}. Compõem o IR já recolhido na apuração do IRPFM.` });
    }
    if (dividendos > 0 && dividendos <= 600000) {
      arr.push({ tom: 'info', titulo: 'Dividendos abaixo do limiar de retenção', texto: 'Abaixo de R$ 600k/ano não há retenção na fonte sobre dividendos. Espaço para aumentar a distribuição sem disparar antecipação.' });
    }
    if (calc.capitalAlvoIsencao && calc.necessarioComplementar > 100) {
      arr.push({ tom: 'success', titulo: 'Capital adicional p/ isenção dos dividendos', texto: `Aplicar +${fmtBRLcompact(calc.capitalAlvoIsencao.c100)} a 100% CDI por ${prazoMeses}m com alíquota ${fmtPct(aliqRetencao)} faz o IR pago definitivo igualar o IRPFM. Os ${fmtBRL(calc.irRetidoDividendos)} retidos sobre dividendos voltam integralmente como restituição.` });
    }
    if (calc.margemRF <= 0 && calc.valorAdicionalAPagar > 0) {
      arr.push({ tom: 'amber', titulo: 'Alíquota da RF não cobre o IRPFM', texto: `Com alíquota de ${fmtPct(aliqRetencao)} a margem útil é ${fmtPct(calc.margemRF)}. Reduzir o prazo eleva a alíquota e cria margem para fechar o gap.` });
    }
    if (concDiv > 0.5 && r > 1000000) arr.push({ tom: 'amber', titulo: 'Concentração elevada em dividendos', texto: `${fmtPct(concDiv)} da renda vem de dividendos. Diversificar com FIIs, debêntures incentivadas e Tesouro IPCA+ reduz exposição regulatória.` });
    if (concExt > 0.2 && calc.faixa === 'piso') arr.push({ tom: 'info', titulo: 'Exposição relevante a rendimentos do exterior', texto: `${fmtPct(concExt)} da renda vem do exterior. Verificar tratados para evitar bitributação e considerar declaração via Carnê-Leão Web.` });
    if (capitalAplicado === 0 && calc.valorAdicionalAPagar > 0) arr.push({ tom: 'amber', titulo: 'Carteira sem renda fixa tributada', texto: `Sem alocação tributada, falta ${fmtBRL(calc.valorAdicionalAPagar)} para anular o complemento. Use o simulador para calcular o capital mínimo.` });
    arr.push({ tom: 'info', titulo: 'Lucros até 2025 escapam da Lei 15.270', texto: 'Dividendos de resultados apurados até 31/12/2025 mantêm isenção total. Aprovar distribuição em ata antes do fechamento é a janela final.' });
    if (r >= 5000000) arr.push({ tom: 'success', titulo: 'Cliente elegível: wealth management avançado', texto: 'Acima de R$ 5M: Fundos Exclusivos (FIE), COE estruturado e diversificação offshore combinam proteção patrimonial com eficiência tributária.' });
    if (r >= 2000000 && concDiv > 0.4) arr.push({ tom: 'info', titulo: 'Holding patrimonial — sucessão e blindagem', texto: 'Estruturação via holding (PJ) permite diferir tributação e otimizar transmissão patrimonial. Doação de cotas com usufruto vitalício reduz ITCMD.' });
    return arr;
  }, [calc, dividendos, rendimentoExterior, capitalAplicado, aliqRetencao, modoRetencaoDiv, prazoMeses]);

  const donutData = [
    { name: 'creditos', value: Math.min(calc.razaoCobertura * 100, 100) },
    { name: 'gap',      value: Math.max(100 - calc.razaoCobertura * 100, 0) },
  ];
  const corPrincipal = calc.razaoCobertura >= 0.99 ? '#34d399' : '#fbbf24';

  let statusOtimo = 'inativo';
  if (calc.impostoMinimoDevido > 0) {
    if (calc.creditoExcedente > 1000)     statusOtimo = 'excedente';
    else if (calc.impostoAdicional < 100) statusOtimo = 'otimo';
    else                                  statusOtimo = 'abaixo';
  } else {
    statusOtimo = 'sem-irpfm';
  }

  const detalheRetencaoDiv = (() => {
    if (modoRetencaoDiv === 'manual') return 'valor informado manualmente';
    if (dividendos <= 600000) return 'abaixo do limiar de R$ 600k/ano — sem retenção';
    return `alíquota ${fmtPct(calc.aliqRetencaoDiv)} s/ ${fmtBRLcompact(dividendos)} (progressiva Lei 15.270)`;
  })();

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 antialiased" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <style>{FONT_IMPORT}</style>
      <div className="pointer-events-none fixed inset-0 opacity-[0.025] mix-blend-overlay z-0" style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")" }} />
      <div className="pointer-events-none fixed -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-emerald-500/10 blur-[120px] z-0" />

      <div className="relative z-10 mx-auto max-w-md px-5 py-7 space-y-5">

        <header className="space-y-4 pt-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Lei 15.270 / 2025</span>
          </div>
          <h1 className="text-[34px] leading-[1.05] tracking-tight text-zinc-50" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500, fontVariationSettings: "'opsz' 144" }}>
            Otimização do{' '}
            <em className="text-emerald-300" style={{ fontStyle: 'italic' }}>IRPF-Mínimo</em>
          </h1>
          <p className="text-[13px] text-zinc-400 leading-relaxed">
            Apuração passo a passo da Lei 15.270 — composição da base, IR pago de forma definitiva, IRPFM, IRRF dividendos. Calcula o valor a restituir ou o capital adicional necessário em RF tributada para complementar o que falta.
          </p>
        </header>

        <Card>
          <Eyebrow>Cobertura · Créditos Compensáveis vs. IRPFM</Eyebrow>
          <div className="relative h-[260px] mt-2 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} innerRadius={88} outerRadius={114} startAngle={90} endAngle={-270} dataKey="value" stroke="none" isAnimationActive={false}>
                  <Cell fill={corPrincipal} />
                  <Cell fill="#27272a" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-12">
              <span className="text-[9px] uppercase tracking-[0.22em] text-zinc-500 mb-1.5">cobertura</span>
              <span className="text-[36px] leading-none font-semibold" style={{ fontFamily: "'Fraunces', serif", color: corPrincipal, fontVariantNumeric: 'tabular-nums', fontVariationSettings: "'opsz' 144" }}>
                {calc.impostoMinimoDevido > 0 ? `${(calc.razaoCobertura * 100).toFixed(1).replace('.', ',')}%` : '—'}
              </span>
              <span className="text-[10px] text-zinc-600 mt-2 font-mono">alvo · 100,0%</span>
            </div>
          </div>
          <div className="mt-3 pt-4 border-t border-zinc-800/70 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">Créditos compensáveis</p>
              <p className="text-[16px] font-semibold text-emerald-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.creditoTotal)}</p>
              <p className="text-[9px] text-zinc-600 mt-0.5">IRPF trad + IR RF + IR Div</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">IRPF Mínimo devido</p>
              <p className="text-[16px] font-semibold text-violet-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.impostoMinimoDevido)}</p>
              <p className="text-[9px] text-zinc-600 mt-0.5">{fmtPct(calc.aliqMinima)} sobre todos os rendimentos</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800/70 flex items-baseline justify-between">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Renda total · faixa</p>
            <div className="text-right">
              <span className="text-[13px] font-medium text-zinc-200" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtBRLcompact(calc.rendaTotal)}</span>
              <span className="ml-2 text-[11px]">
                {calc.faixa === 'isento'    && <span className="text-emerald-300">isento</span>}
                {calc.faixa === 'transicao' && <span className="text-amber-300">transição</span>}
                {calc.faixa === 'piso'      && <span className="text-amber-400">piso 10%</span>}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Apuração do IRPFM · Passo a Passo</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-1 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Cálculo da restituição</h2>
          <p className="text-[11px] text-zinc-500 mb-4">Lógica do treinamento Lei 15.270 (BB Private) replicada com seus dados.</p>

          {/* Passo 1: Composição da base & IR pago definitivo */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/80 font-medium">1° · Compõem a base & IR pago definitivo</p>

            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[9px] uppercase tracking-[0.15em] text-zinc-600 pb-1 border-b border-emerald-500/10">
              <span>Origem</span>
              <span className="text-right">Valor</span>
              <span className="text-right">IR pago</span>
            </div>

            {/* Pró-labore */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-[11px]">
              <div>
                <p className="text-zinc-300">Pró-labore</p>
                <p className="text-[9px] text-zinc-600">tabela progressiva</p>
              </div>
              <span className="text-zinc-300 font-mono text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(rendaTributavel)}</span>
              <span className="text-zinc-200 font-mono text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.irpfTradicional)}</span>
            </div>

            {/* Dividendos */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-[11px]">
              <div>
                <p className="text-zinc-300">Dividendos</p>
                <p className="text-[9px] text-zinc-600 italic">considera depois</p>
              </div>
              <span className="text-zinc-300 font-mono text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(dividendos)}</span>
              <span className="text-zinc-600 font-mono text-right">—</span>
            </div>

            {/* Exterior */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-[11px]">
              <div>
                <p className="text-zinc-300">Lucro no exterior</p>
                <p className="text-[9px] text-zinc-600">15% definitivo</p>
              </div>
              <span className="text-zinc-300 font-mono text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(rendimentoExterior)}</span>
              <span className="text-zinc-200 font-mono text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.irExterior)}</span>
            </div>

            {/* RF */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-[11px]">
              <div>
                <p className="text-zinc-300">Rendimento RF</p>
                <p className="text-[9px] text-zinc-600">{fmtPct(aliqRetencao)} · {prazoMeses}m</p>
              </div>
              <span className="text-zinc-300 font-mono text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.rendimentoBruto)}</span>
              <span className="text-zinc-200 font-mono text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.irRetidoRF)}</span>
            </div>

            {/* Totais */}
            <div className="pt-2 border-t border-emerald-500/30 space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline">
                <span className="text-[11px] text-zinc-300 font-medium">Rendimentos totais (base)</span>
                <span className="text-[13px] text-emerald-300 font-mono font-bold text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.rendaTotal)}</span>
                <span className="text-[11px] text-zinc-600 text-right">—</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline">
                <span className="text-[11px] text-zinc-300 font-medium">IR pago de forma definitiva</span>
                <span className="text-[11px] text-zinc-600 text-right">—</span>
                <span className="text-[13px] text-emerald-300 font-mono font-bold text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.irPagoDefinitivo)}</span>
              </div>
            </div>
          </div>

          {/* Passo 2: IRPFM */}
          <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-violet-400/80 font-medium">2° · IRPF Mínimo devido</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Base IRPFM</span>
                <span className="text-zinc-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.rendaTotal)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Alíquota mínima · faixa {calc.faixa}</span>
                <span className="text-zinc-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>× {fmtPct(calc.aliqMinima)}</span>
              </div>
              <div className="pt-2 border-t border-violet-500/20 flex justify-between text-[12px]">
                <span className="text-violet-300 font-medium">IRPFM</span>
                <span className="text-violet-300 font-mono font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.impostoMinimoDevido)}</span>
              </div>
            </div>
          </div>

          {/* Passo 3: IRPFM × IR pago def. */}
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80 font-medium">3° · IRPFM vs IR pago (sem dividendos)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">IRPFM</span>
                <span className="text-violet-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.impostoMinimoDevido)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">IR pago definitivo</span>
                <span className="text-emerald-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>−{fmtBRL(calc.irPagoDefinitivo)}</span>
              </div>
              <div className="pt-2 border-t border-amber-500/20 flex justify-between text-[12px]">
                <span className="text-zinc-300 font-medium">Necessário complementar</span>
                <span className="text-amber-300 font-mono font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.necessarioComplementar)}</span>
              </div>
            </div>
          </div>

          {/* Passo 4: + IRRF Dividendos */}
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">4° · Considerando IRRF Dividendos</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Necessário complementar</span>
                <span className="text-amber-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.necessarioComplementar)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">IRRF Dividendos (Lei 15.270)</span>
                <span className="text-violet-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>−{fmtBRL(calc.irRetidoDividendos)}</span>
              </div>
            </div>
          </div>

          {/* Resultado final */}
          <div className={`mt-3 relative overflow-hidden rounded-xl p-4 ${calc.valorRestituir > 1000 ? 'bg-emerald-500/10 border border-emerald-500/40' : calc.valorAdicionalAPagar > 0 ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-emerald-500/10 border border-emerald-500/30'}`}>
            <div className="flex justify-between items-center">
              <div>
                <p className={`text-[11px] uppercase tracking-[0.2em] font-medium ${calc.valorRestituir > 1000 ? 'text-emerald-300' : calc.valorAdicionalAPagar > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {calc.valorRestituir > 1000 ? 'Valor a restituir' : calc.valorAdicionalAPagar > 0 ? 'Adicional a pagar' : 'Equilibrado'}
                </p>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {calc.valorRestituir > 1000
                    ? 'IR pago + IRRF Div excede o IRPFM'
                    : calc.valorAdicionalAPagar > 0
                    ? 'Aportar mais em RF tributada'
                    : 'Créditos ≡ IRPFM'}
                </p>
              </div>
              <p className={`text-[26px] font-bold ${calc.valorRestituir > 1000 ? 'text-emerald-300' : calc.valorAdicionalAPagar > 0 ? 'text-amber-300' : 'text-emerald-300'}`} style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>
                {calc.valorRestituir > 1000
                  ? `+${fmtBRLcompact(calc.valorRestituir)}`
                  : calc.valorAdicionalAPagar > 0
                  ? `−${fmtBRLcompact(calc.valorAdicionalAPagar)}`
                  : '✓'}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Composição da Renda</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-1 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Dados da declaração</h2>
          <p className="text-[11px] text-zinc-500 mb-5">Slider para ajuste rápido ou toque no valor para inserir manualmente.</p>
          <div className="space-y-6">
            <NumberInput label="Renda Tributável" value={rendaTributavel} onChange={setRendaTributavel} max={5000000} step={25000} hint="salários, pró-labore, aluguéis" />

            <div className="space-y-3">
              <NumberInput label="Rendimentos do Exterior" value={rendimentoExterior} onChange={setRendimentoExterior} max={20000000} step={50000} hint="lucros, dividendos, juros · IR 15%" accent="amber" />

              {/* Painel IR exterior · 15% definitivo */}
              <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${calc.irExterior > 0 ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                  <div>
                    <p className="text-[11px] text-zinc-400 font-medium">IR pago no exterior · 15%</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">tributação definitiva</p>
                  </div>
                </div>
                <p className={`text-[14px] font-semibold ${calc.irExterior > 0 ? 'text-amber-300' : 'text-zinc-600'}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                  {fmtBRL(calc.irExterior)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <NumberInput label="Dividendos Recebidos" value={dividendos} onChange={setDividendos} max={20000000} step={100000} hint="soma de todas as fontes" />

              <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${calc.irRetidoDividendos > 0 ? 'bg-violet-400' : 'bg-zinc-600'}`} />
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">IR retido s/ dividendos</p>
                  </div>
                  <div className="flex rounded-md overflow-hidden border border-zinc-700/60 text-[10px] font-semibold">
                    <button
                      onClick={() => setModoRetencaoDiv('auto')}
                      className={`px-2.5 py-1 transition-all ${modoRetencaoDiv === 'auto' ? 'bg-violet-500/20 text-violet-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setModoRetencaoDiv('manual')}
                      className={`px-2.5 py-1 transition-all border-l border-zinc-700/60 ${modoRetencaoDiv === 'manual' ? 'bg-violet-500/20 text-violet-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                    >
                      Manual
                    </button>
                  </div>
                </div>

                <div className="px-3 py-3 space-y-2.5">
                  {modoRetencaoDiv === 'auto' ? (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                          <span>R$ 0</span>
                          <span>R$ 600k · 0%</span>
                          <span>R$ 1,2M · 10%</span>
                        </div>
                        <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="absolute left-0 top-0 h-full bg-zinc-700/40 rounded-l-full" style={{ width: '50%' }} />
                          <div className="absolute top-0 h-full" style={{ left: '50%', width: '50%', background: 'linear-gradient(to right, rgb(167 139 250 / 0.2), rgb(167 139 250 / 0.7))' }} />
                          {dividendos > 0 && (
                            <div
                              className="absolute top-0 h-full w-0.5 bg-violet-300"
                              style={{ left: `${Math.min((dividendos / 1200000) * 100, 100)}%` }}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <p className="text-[11px] text-zinc-500">
                          Alíquota efetiva:{' '}
                          <span className={`font-semibold ${calc.aliqRetencaoDiv > 0 ? 'text-violet-300' : 'text-zinc-500'}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {fmtPct(calc.aliqRetencaoDiv)}
                          </span>
                        </p>
                        <p className={`text-[16px] font-semibold ${calc.irRetidoDivAuto > 0 ? 'text-violet-300' : 'text-zinc-600'}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                          {fmtBRL(calc.irRetidoDivAuto)}
                        </p>
                      </div>
                      {dividendos <= 600000 && (
                        <p className="text-[10px] text-zinc-600 italic">Abaixo do limiar de R$ 600k/ano — sem retenção.</p>
                      )}
                      {dividendos > 600000 && dividendos < 1200000 && (
                        <p className="text-[10px] text-zinc-600 italic">
                          Faixa progressiva: {fmtPct(calc.aliqRetencaoDiv)} s/ {fmtBRL(dividendos)} totais (incide sobre o total, não sobre o excedente).
                        </p>
                      )}
                      {dividendos >= 1200000 && (
                        <p className="text-[10px] text-zinc-600 italic">Piso de 10% atingido — alíquota máxima sobre o total de dividendos.</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-zinc-400">Informe o valor efetivamente retido na fonte sobre dividendos:</p>
                      <MiniValueInput
                        value={retencaoDivManual}
                        onChange={setRetencaoDivManual}
                        max={dividendos * 0.15}
                        accent="violet"
                      />
                      <p className="text-[10px] text-zinc-600 italic">
                        Valor calculado automaticamente seria:{' '}
                        <span className="text-violet-400/70" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtBRL(calc.irRetidoDivAuto)}</span>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Capital em Renda Fixa Tributada</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-1 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Simulação de alocação</h2>
          <p className="text-[11px] text-zinc-500 mb-5">Ajuste o capital para ver em tempo real o crédito gerado e o impacto no adicional do IRPF-Mínimo.</p>
          <div className="space-y-5">
            <NumberInput
              label="Capital Aplicado"
              sublabel="total investido em CDB, fundos RF, FIA tributados"
              value={capitalAplicado}
              onChange={setCapitalAplicado}
              max={50000000}
              step={100000}
              hint="capital total"
              accent="sky"
            />

            {/* Prazo do investimento */}
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">Prazo do investimento</p>
                </div>
                <div className="flex rounded-md overflow-hidden border border-zinc-700/60 text-[10px] font-semibold">
                  <button
                    onClick={() => setModoPrazo('auto')}
                    className={`px-2.5 py-1 transition-all ${modoPrazo === 'auto' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => setModoPrazo('manual')}
                    className={`px-2.5 py-1 transition-all border-l border-zinc-700/60 ${modoPrazo === 'manual' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                  >
                    Manual
                  </button>
                </div>
              </div>
              <div className="px-3 py-3 space-y-2">
                {modoPrazo === 'auto' ? (
                  <div className="grid grid-cols-4 gap-2">
                    <ToggleButton value={3}  label="3"  sublabel="meses" current={prazoMeses} onClick={setPrazoMeses} accentAtivo="emerald" />
                    <ToggleButton value={6}  label="6"  sublabel="meses" current={prazoMeses} onClick={setPrazoMeses} accentAtivo="emerald" />
                    <ToggleButton value={12} label="12" sublabel="meses" current={prazoMeses} onClick={setPrazoMeses} accentAtivo="emerald" />
                    <ToggleButton value={24} label="24" sublabel="meses" current={prazoMeses} onClick={setPrazoMeses} accentAtivo="emerald" />
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-400">Informe o prazo personalizado em meses (1–360):</p>
                    <MiniMonthsInput value={prazoMeses} onChange={setPrazoMeses} />
                  </>
                )}
                <p className="text-[10px] text-zinc-600 font-mono text-center pt-1">
                  {prazoMeses} {prazoMeses === 1 ? 'mês' : 'meses'} · alíquota auto {fmtPct(aliquotaPorPrazo(prazoMeses))} (regressiva RF)
                </p>
              </div>
            </div>

            {/* Rendimento derivado */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/60 p-4 space-y-2.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Rendimento gerado pelo capital</p>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-[22px] font-semibold text-sky-300" style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.rendimentoBruto)}</span>
                  <span className="text-[11px] text-zinc-600 ml-2">bruto · {prazoMeses}m</span>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-emerald-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.rendimentoLiquido)}</p>
                  <p className="text-[9px] text-zinc-600 mt-0.5">líquido após IR</p>
                </div>
              </div>
              <div className="pt-2 border-t border-zinc-800/50 flex items-baseline justify-between">
                <p className="text-[11px] text-zinc-500">IR retido → crédito tributário</p>
                <p className="text-[15px] font-semibold text-sky-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.irRetidoRF)}</p>
              </div>
              <div className="pt-2 border-t border-zinc-800/50 flex items-baseline justify-between">
                <p className="text-[11px] text-zinc-500">Fator do período (composto)</p>
                <p className="text-[12px] font-semibold text-zinc-400" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                  {fmtPct(calc.fatorPeriodo)}
                </p>
              </div>
            </div>

            {/* % CDI */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Taxa do investimento · % do CDI</p>
              <div className="grid grid-cols-4 gap-2">
                <ToggleButton value={0.9}  label="90%"  sublabel="CDI" current={pctCDI} onClick={setPctCDI} accentAtivo="sky" />
                <ToggleButton value={0.95} label="95%"  sublabel="CDI" current={pctCDI} onClick={setPctCDI} accentAtivo="sky" />
                <ToggleButton value={1.0}  label="100%" sublabel="CDI" current={pctCDI} onClick={setPctCDI} accentAtivo="sky" />
                <ToggleButton value={1.1}  label="110%" sublabel="CDI" current={pctCDI} onClick={setPctCDI} accentAtivo="sky" />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1.5 font-mono text-center">
                CDI {fmtPct(cdi)} a.a. → taxa anual {fmtPct(calc.taxaEfetiva)} · em {prazoMeses}m fator {fmtPct(calc.fatorPeriodo)}
              </p>
            </div>

            {/* Alíquota de retenção */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">
                Alíquota de retenção · prazo do papel <span className="text-zinc-600 normal-case tracking-normal italic">(auto pelo prazo)</span>
              </p>
              <div className="grid grid-cols-4 gap-2">
                <ToggleButton value={0.225} label="22,5%" sublabel="≤ 180d"   current={aliqRetencao} onClick={setAliqRetencao} accentAtivo="emerald" />
                <ToggleButton value={0.2}   label="20%"   sublabel="181–360d" current={aliqRetencao} onClick={setAliqRetencao} accentAtivo="emerald" />
                <ToggleButton value={0.175} label="17,5%" sublabel="361–720d" current={aliqRetencao} onClick={setAliqRetencao} accentAtivo="emerald" />
                <ToggleButton value={0.15}  label="15%"   sublabel="> 720d"   current={aliqRetencao} onClick={setAliqRetencao} accentAtivo="emerald" />
              </div>
            </div>
          </div>
        </Card>

        {/* SIMULAÇÃO DE ALOCAÇÃO ISENTA · LCA / LCI */}
        <Card>
          <Eyebrow>Capital em Renda Fixa Isenta</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-1 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Simulação de alocação · LCA / LCI</h2>
          <p className="text-[11px] text-zinc-500 mb-5">Sem IR sobre o rendimento e fora da base do IRPFM. Use os mesmos valores do CDB para comparar de forma justa, ou parâmetros próprios do produto.</p>
          <div className="space-y-5">
            <NumberInput
              label="Capital Aplicado"
              sublabel="LCA, LCI, debêntures incentivadas, fundos isentos"
              value={capitalLCA}
              onChange={setCapitalLCA}
              max={50000000}
              step={100000}
              hint="capital total"
              accent="emerald"
            />

            {/* Prazo */}
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">Prazo do investimento</p>
                </div>
                <div className="flex rounded-md overflow-hidden border border-zinc-700/60 text-[10px] font-semibold">
                  <button
                    onClick={() => setModoPrazoLCA('auto')}
                    className={`px-2.5 py-1 transition-all ${modoPrazoLCA === 'auto' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                  >Auto</button>
                  <button
                    onClick={() => setModoPrazoLCA('manual')}
                    className={`px-2.5 py-1 transition-all border-l border-zinc-700/60 ${modoPrazoLCA === 'manual' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500 hover:text-zinc-400'}`}
                  >Manual</button>
                </div>
              </div>
              <div className="px-3 py-3 space-y-2">
                {modoPrazoLCA === 'auto' ? (
                  <div className="grid grid-cols-4 gap-2">
                    <ToggleButton value={3}  label="3"  sublabel="meses" current={prazoLCAMeses} onClick={setPrazoLCAMeses} accentAtivo="emerald" />
                    <ToggleButton value={6}  label="6"  sublabel="meses" current={prazoLCAMeses} onClick={setPrazoLCAMeses} accentAtivo="emerald" />
                    <ToggleButton value={12} label="12" sublabel="meses" current={prazoLCAMeses} onClick={setPrazoLCAMeses} accentAtivo="emerald" />
                    <ToggleButton value={24} label="24" sublabel="meses" current={prazoLCAMeses} onClick={setPrazoLCAMeses} accentAtivo="emerald" />
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-400">Informe o prazo personalizado em meses (1–360):</p>
                    <MiniMonthsInput value={prazoLCAMeses} onChange={setPrazoLCAMeses} />
                  </>
                )}
                <p className="text-[10px] text-zinc-600 font-mono text-center pt-1">
                  {prazoLCAMeses} {prazoLCAMeses === 1 ? 'mês' : 'meses'} · sem alíquota de IR
                </p>
              </div>
            </div>

            {/* Rendimento derivado */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/60 p-4 space-y-2.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Rendimento gerado pelo capital</p>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-[22px] font-semibold text-emerald-300" style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.comparativo.lca.rendBruto)}</span>
                  <span className="text-[11px] text-zinc-600 ml-2">líquido · {prazoLCAMeses}m</span>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium text-zinc-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>já isento de IR</p>
                  <p className="text-[9px] text-zinc-600 mt-0.5">não compõe base IRPFM</p>
                </div>
              </div>
              <div className="pt-2 border-t border-zinc-800/50 flex items-baseline justify-between">
                <p className="text-[11px] text-zinc-500">Fator do período (composto)</p>
                <p className="text-[12px] font-semibold text-zinc-400" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                  {fmtPct(calc.comparativo.lca.fator)}
                </p>
              </div>
            </div>

            {/* % CDI */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Taxa do investimento · % do CDI</p>
              <div className="grid grid-cols-4 gap-2">
                <ToggleButton value={0.80} label="80%"  sublabel="CDI" current={pctCDILCA} onClick={setPctCDILCA} accentAtivo="emerald" />
                <ToggleButton value={0.85} label="85%"  sublabel="CDI" current={pctCDILCA} onClick={setPctCDILCA} accentAtivo="emerald" />
                <ToggleButton value={0.90} label="90%"  sublabel="CDI" current={pctCDILCA} onClick={setPctCDILCA} accentAtivo="emerald" />
                <ToggleButton value={0.95} label="95%"  sublabel="CDI" current={pctCDILCA} onClick={setPctCDILCA} accentAtivo="emerald" />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1.5 font-mono text-center">
                CDI {fmtPct(cdi)} a.a. → taxa anual {fmtPct(cdi * pctCDILCA)} · em {prazoLCAMeses}m fator {fmtPct(calc.comparativo.lca.fator)}
              </p>
              <p className="text-[10px] text-zinc-600 mt-2 italic text-center">
                Isentos costumam pagar abaixo do CDI cheio — o spread é o "preço" da isenção.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Capital para Isenção dos Dividendos</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-1 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Alvo: restituir 100% do IRRF Div</h2>
          <p className="text-[12px] text-zinc-500 leading-relaxed mb-5">
            Capital de RF tal que o <span className="text-emerald-300 font-semibold">IR pago definitivo</span> (IRPF trad + IR exterior + IR RF) iguale o <span className="text-violet-300 font-semibold">IRPFM</span>. Atingido o ponto, todo o IRRF retido nos dividendos vira <span className="text-emerald-300 font-semibold">restituição integral</span> — efeito prático de "isenção" sobre a distribuição.
          </p>

          {calc.impostoMinimoDevido === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-center">
              <p className="text-[13px] text-zinc-400 leading-relaxed">
                Renda total abaixo de R$ 600k — sem IRPFM devido. Não há IRRF Div a restituir.
              </p>
            </div>
          ) : calc.necessarioComplementar < 100 ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-[14px] text-emerald-300 font-semibold mb-1">Isenção dos dividendos atingida</p>
                  <p className="text-[12.5px] text-zinc-400 leading-relaxed">
                    O IR pago definitivo ({fmtBRL(calc.irPagoDefinitivo)}) já cobre o IRPFM ({fmtBRL(calc.impostoMinimoDevido)}). O IRRF de {fmtBRL(calc.irRetidoDividendos)} retido nos dividendos será integralmente restituído na declaração anual.
                  </p>
                  {calc.valorRestituir > 1000 && (
                    <p className="text-[12px] text-emerald-300 font-semibold mt-2">
                      Restituição prevista: +{fmtBRL(calc.valorRestituir)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : calc.margemRF <= 0 ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-[13px] text-amber-300 font-semibold mb-1">Alíquota da RF não cobre o IRPFM</p>
              <p className="text-[12px] text-zinc-400 leading-relaxed">
                Margem útil ({fmtPct(calc.margemRF)}) é zero ou negativa — cada real adicional de RF não reduz o gap. Reduzir o prazo eleva a alíquota e cria margem.
              </p>
            </div>
          ) : (
            calc.capitalAlvoIsencao && (
              <div className="space-y-4">
                {/* Conta direta - alvo isenção */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 mb-3 font-medium">A conta direta · alvo isenção</p>
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-baseline">
                      <p className="text-[12px] text-zinc-400">Necessário complementar (passo 3)</p>
                      <p className="text-[16px] font-bold text-amber-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(calc.necessarioComplementar)}</p>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <p className="text-[12px] text-zinc-400">÷ margem útil ({fmtPct(aliqRetencao)} − 10%)</p>
                      <p className="text-[14px] font-semibold text-zinc-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>÷ {fmtPct(calc.margemRF)}</p>
                    </div>
                    <div className="pt-2 border-t border-emerald-500/20 flex justify-between items-baseline">
                      <p className="text-[12px] text-zinc-300 font-medium">Rendimento bruto adicional</p>
                      <p className="text-[18px] font-bold text-emerald-300" style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>
                        {fmtBRL(calc.rendimentoBrutoIsencao)}
                      </p>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <p className="text-[12px] text-zinc-400">÷ fator do período ({prazoMeses}m a 100% CDI)</p>
                      <p className="text-[14px] font-semibold text-zinc-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>÷ {fmtPct(calc.fatorPeriodo)}</p>
                    </div>
                    <div className="pt-2 border-t border-emerald-500/30 flex justify-between items-baseline">
                      <p className="text-[12px] text-emerald-300 font-medium">Capital adicional · 100% CDI</p>
                      <p className="text-[20px] font-bold text-emerald-300" style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>
                        +{fmtBRLcompact(calc.capitalAlvoIsencao.c100)}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-emerald-500/20 flex justify-between items-baseline">
                      <p className="text-[11px] text-zinc-400">Restituição prevista nesse cenário</p>
                      <p className="text-[14px] font-bold text-emerald-300" style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                        +{fmtBRL(calc.irRetidoDividendos)}
                      </p>
                    </div>
                  </div>
                </div>

                <CapitalBar
                  capitalAtual={capitalAplicado}
                  capitalAlvo={capitalAplicado + calc.capitalAlvoIsencao.c100}
                  label={`progresso · 100% CDI (${fmtPct(cdi)} a.a.)`}
                />

                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2.5">Capital adicional · variações de %CDI</p>
                  <div className="space-y-1.5">
                    {[
                      { pct: 1.1, label: '110% CDI', cap: calc.capitalAlvoIsencao.c110, cor: 'text-emerald-300' },
                      { pct: 1.0, label: '100% CDI', cap: calc.capitalAlvoIsencao.c100, cor: 'text-sky-300'     },
                      { pct: 0.9, label: '90% CDI',  cap: calc.capitalAlvoIsencao.c90,  cor: 'text-amber-300'  },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
                        <div>
                          <span className={`text-[13px] font-semibold ${row.cor}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            +{fmtBRLcompact(row.cap)}
                          </span>
                          <span className="text-[10px] text-zinc-600 ml-2">adicional</span>
                        </div>
                        <div className="text-right">
                          <span className={`text-[11px] font-semibold ${row.cor}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{row.label}</span>
                          <p className="text-[9px] text-zinc-600">({fmtPct(cdi * row.pct)} a.a.)</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-sky-400/80 mb-1">Capital total de RF</p>
                      <p className="text-[11px] text-zinc-500">atual + adicional a 100% CDI</p>
                    </div>
                    <p className="text-[26px] font-semibold text-sky-300" style={{ fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>
                      {fmtBRLcompact(capitalAplicado + calc.capitalAlvoIsencao.c100)}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 mb-2 font-medium">Por que esse alvo gera "isenção" dos dividendos?</p>
                  <p className="text-[12.5px] text-zinc-300 leading-relaxed">
                    No ponto de equilíbrio, IR pago def. = IRPFM. Como o IRRF Dividendos é antecipação do mesmo IRPFM, ele <em>passa a ser pura sobreposição</em> e a Receita restitui 100% na declaração — o cliente fica efetivamente "isento" sobre a distribuição (já tendo sido tributado na fonte do investimento RF a {fmtPct(aliqRetencao)}).
                    {calc.faixa !== 'piso' && <span className="block mt-2 text-amber-300/80 text-[11px] italic">Atenção: cliente fora do piso de 10%. Cálculo assume piso ao adicionar capital — verifique se a alocação manterá a renda total acima de R$ 1,2M.</span>}
                  </p>
                </div>
              </div>
            )
          )}
        </Card>

        <Card>
          <Eyebrow>Insights de Otimização</Eyebrow>
          <h2 className="text-[20px] text-zinc-100 mb-4 mt-1" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}>Recomendações ao cliente</h2>

          {/* PRIMEIRO INSIGHT · Comparativo CDB × LCA */}
          {(capitalAplicado > 0 || capitalLCA > 0) && (
            <div className={`rounded-xl border p-4 mb-3 ${calc.comparativo.melhor === 'cdb' ? 'border-sky-500/40 bg-sky-500/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
              <div className="flex items-start gap-2.5 mb-3">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${calc.comparativo.melhor === 'cdb' ? 'bg-sky-400' : 'bg-emerald-400'}`} />
                <div className="flex-1">
                  <h3 className={`text-[14px] font-semibold mb-1 ${calc.comparativo.melhor === 'cdb' ? 'text-sky-300' : 'text-emerald-300'}`}>
                    {calc.comparativo.melhor === 'cdb' ? 'CDB tributado vence a LCA' : 'LCA isenta vence o CDB'}
                  </h3>
                  <p className="text-[12px] text-zinc-400 leading-relaxed">
                    Diferença de <span className={`font-semibold ${calc.comparativo.melhor === 'cdb' ? 'text-sky-300' : 'text-emerald-300'}`}>{fmtBRL(Math.abs(calc.comparativo.diferenca))}</span> a favor do {calc.comparativo.melhor === 'cdb' ? 'CDB' : 'LCA'} no ganho líquido total (rendimento ± impacto no IRPFM), considerando os parâmetros próprios de cada simulação.
                  </p>
                </div>
              </div>

              {/* Comparação lado a lado */}
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                {/* CDB */}
                <div className={`rounded-lg p-3 border ${calc.comparativo.melhor === 'cdb' ? 'border-sky-500/40 bg-sky-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${calc.comparativo.melhor === 'cdb' ? 'text-sky-300' : 'text-zinc-500'}`}>CDB · {fmtPct(aliqRetencao)}</p>
                    {calc.comparativo.melhor === 'cdb' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/30 text-sky-200 font-bold uppercase">melhor</span>}
                  </div>
                  <p className="text-[9px] text-zinc-600 mb-1.5 font-mono">
                    {fmtBRLcompact(calc.comparativo.cdb.capital)} · {calc.comparativo.cdb.prazo}m · {(calc.comparativo.cdb.pctCDI * 100).toFixed(0)}% CDI
                  </p>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Bruto</span>
                      <span className="text-zinc-300 font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.comparativo.cdb.rendBruto)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">− IR RF</span>
                      <span className="text-amber-400/70 font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>−{fmtBRLcompact(calc.comparativo.cdb.ir)}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-zinc-800/50">
                      <span className="text-zinc-400">Líquido</span>
                      <span className="text-zinc-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.comparativo.cdb.liquido)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">{calc.comparativo.cdb.saldo >= 0 ? 'Restituição' : 'Complemento'}</span>
                      <span className={`font-mono ${calc.comparativo.cdb.saldo >= 0 ? 'text-emerald-400' : 'text-amber-400'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {calc.comparativo.cdb.saldo >= 0 ? '+' : ''}{fmtBRLcompact(calc.comparativo.cdb.saldo)}
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 mt-2 border-t border-zinc-800/60 flex justify-between items-baseline">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Total</span>
                    <span className={`text-[14px] font-bold font-mono ${calc.comparativo.melhor === 'cdb' ? 'text-sky-300' : 'text-zinc-300'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtBRLcompact(calc.comparativo.cdb.resultado)}
                    </span>
                  </div>
                </div>

                {/* LCA */}
                <div className={`rounded-lg p-3 border ${calc.comparativo.melhor === 'lca' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${calc.comparativo.melhor === 'lca' ? 'text-emerald-300' : 'text-zinc-500'}`}>LCA/LCI · isento</p>
                    {calc.comparativo.melhor === 'lca' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 font-bold uppercase">melhor</span>}
                  </div>
                  <p className="text-[9px] text-zinc-600 mb-1.5 font-mono">
                    {fmtBRLcompact(calc.comparativo.lca.capital)} · {calc.comparativo.lca.prazo}m · {(calc.comparativo.lca.pctCDI * 100).toFixed(0)}% CDI
                  </p>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Bruto</span>
                      <span className="text-zinc-300 font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.comparativo.lca.rendBruto)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">IR</span>
                      <span className="text-zinc-600 font-mono">—</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-zinc-800/50">
                      <span className="text-zinc-400">Líquido</span>
                      <span className="text-zinc-300 font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRLcompact(calc.comparativo.lca.liquido)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">{calc.comparativo.lca.saldo >= 0 ? 'Restituição' : 'Complemento'}</span>
                      <span className={`font-mono ${calc.comparativo.lca.saldo >= 0 ? 'text-emerald-400' : 'text-amber-400'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {calc.comparativo.lca.saldo >= 0 ? '+' : ''}{fmtBRLcompact(calc.comparativo.lca.saldo)}
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 mt-2 border-t border-zinc-800/60 flex justify-between items-baseline">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Total</span>
                    <span className={`text-[14px] font-bold font-mono ${calc.comparativo.melhor === 'lca' ? 'text-emerald-300' : 'text-zinc-300'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtBRLcompact(calc.comparativo.lca.resultado)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Aviso quando capitais são diferentes */}
              {capitalAplicado !== capitalLCA && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
                  <p className="text-[10px] text-zinc-500 italic">
                    ⓘ Capitais distintos ({fmtBRLcompact(capitalAplicado)} vs {fmtBRLcompact(capitalLCA)}). Para comparativo justo, use o mesmo capital nos dois simuladores.
                  </p>
                </div>
              )}

              {/* Explicação resumida */}
              <div className="mt-3 pt-3 border-t border-zinc-800/40">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5 font-medium">Como o cálculo é feito</p>
                <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                  {calc.comparativo.melhor === 'cdb' ? (
                    <>
                      O CDB rende {fmtBRLcompact(calc.comparativo.cdb.liquido)} líquido e gera {fmtBRLcompact(calc.comparativo.cdb.ir)} de IR como crédito contra o IRPFM. Esse crédito {calc.comparativo.cdb.saldo > calc.comparativo.lca.saldo ? 'aumenta a restituição (ou reduz o complemento)' : 'compensa parte do IRPFM'}, fazendo o ganho efetivo total ({fmtBRLcompact(calc.comparativo.cdb.resultado)}) superar o da LCA ({fmtBRLcompact(calc.comparativo.lca.resultado)}). A LCA é "isenta" mas <em>não gera crédito</em> — o IRRF dos dividendos continua sendo um custo (ou menor restituição).
                    </>
                  ) : (
                    <>
                      A LCA rende {fmtBRLcompact(calc.comparativo.lca.liquido)} totalmente líquido e <em>não entra na base do IRPFM</em>. Mesmo a {(pctCDILCA*100).toFixed(0)}% do CDI (vs {(pctCDI*100).toFixed(0)}% do CDB), o ganho efetivo da LCA ({fmtBRLcompact(calc.comparativo.lca.resultado)}) supera o do CDB ({fmtBRLcompact(calc.comparativo.cdb.resultado)}) porque o CDB ainda perde IR e infla a base do IRPFM, drenando parte do crédito gerado.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          {/* /PRIMEIRO INSIGHT */}

          {insights.length === 0 ? (
            <p className="text-[13px] text-zinc-500 italic py-4">Configuração equilibrada — nenhuma recomendação crítica.</p>
          ) : (
            <div className="space-y-3">
              {insights.map((ins, i) => {
                const cores = { success: 'border-emerald-500/30 bg-emerald-500/5', warn: 'border-amber-500/30 bg-amber-500/5', amber: 'border-amber-500/40 bg-amber-500/10', info: 'border-zinc-700 bg-zinc-800/30' };
                const corTitulo = { success: 'text-emerald-300', warn: 'text-amber-300', amber: 'text-amber-300', info: 'text-zinc-300' };
                const dot = { success: 'bg-emerald-400', warn: 'bg-amber-400', amber: 'bg-amber-400', info: 'bg-zinc-500' };
                return (
                  <div key={i} className={`rounded-xl border p-4 ${cores[ins.tom]}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${dot[ins.tom]} flex-shrink-0`} />
                      <div className="flex-1">
                        <h3 className={`text-[14px] font-semibold ${corTitulo[ins.tom]} mb-1.5`}>{ins.titulo}</h3>
                        <p className="text-[12.5px] text-zinc-400 leading-relaxed">{ins.texto}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <footer className="pt-5 pb-6">
          <div className="text-center space-y-2">
            <p className="text-[10px] text-zinc-600 leading-relaxed max-w-xs mx-auto">
              CDI {fmtPct(cdi)} a.a. · {cdiSource}
              {cdiData && ` · atualizado ${cdiData}`}
              <br />Simulação estimativa · Lei 15.270/2025
              <br />Não substitui orientação contábil profissional.
            </p>
            <div className="pt-3 inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.25em] text-zinc-700">
              <span className="w-3 h-px bg-zinc-700" />
              <span>desenvolvido por</span>
              <span className="w-3 h-px bg-zinc-700" />
            </div>
            <p className="text-[14px] text-zinc-300" style={{ fontFamily: "'Fraunces', serif", fontWeight: 500, fontStyle: 'italic' }}>Pedro Henrique Valentino</p>
            <p className="text-[10px] text-zinc-600">com auxílio do Claude · Anthropic</p>
          </div>
        </footer>
      </div>
    </div>
  );
}