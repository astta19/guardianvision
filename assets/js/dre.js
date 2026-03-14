// ============================================================
// DRE.JS — Módulo 4 dos Módulos Contábeis
// Demonstração do Resultado do Exercício
// Depende: core.js, sb, currentCliente, currentUser
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _dreAnoIni  = new Date().getFullYear();
let _dreMesIni  = 0;
let _dreAnoFim  = new Date().getFullYear();
let _dreMesFim  = new Date().getMonth();

const MESES_DRE = ['Jan','Fev','Mar','Abr','Mai','Jun',
                   'Jul','Ago','Set','Out','Nov','Dez'];

// Grupos da DRE em ordem — mapeados por tipo de conta do plano
const DRE_GRUPOS = [
  { id: 'receita_bruta',        label: 'Receita Bruta',                      tipos: ['receita'],  sinal:  1 },
  { id: 'deducoes',             label: '(-) Deduções da Receita',             tipos: ['receita'],  sinal: -1, natureza: 'devedora' },
  { id: 'receita_liquida',      label: '(=) Receita Líquida',                 subtotal: true },
  { id: 'custo',                label: '(-) Custos',                          tipos: ['custo'],    sinal: -1 },
  { id: 'lucro_bruto',          label: '(=) Lucro Bruto',                     subtotal: true },
  { id: 'despesa',              label: '(-) Despesas Operacionais',            tipos: ['despesa'],  sinal: -1 },
  { id: 'resultado_operacional',label: '(=) Resultado Operacional',            subtotal: true },
  { id: 'resultado_liquido',    label: '(=) Resultado Líquido do Exercício',   subtotal: true, final: true },
];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openDRE() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('dreModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _drePopularSelects();
  await dreGerar();
}

function closeDRE() {
  document.getElementById('dreModal').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Selects de período ────────────────────────────────────────
function _drePopularSelects() {
  ['dreSelMesIni','dreSelMesFim'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = i === 0 ? _dreMesIni : _dreMesFim;
    el.innerHTML = MESES_DRE.map((m, idx) =>
      `<option value="${idx}" ${idx === val ? 'selected' : ''}>${m}</option>`
    ).join('');
  });
  ['dreSelAnoIni','dreSelAnoFim'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = i === 0 ? _dreAnoIni : _dreAnoFim;
    const ano = new Date().getFullYear();
    el.innerHTML = Array.from({ length: 6 }, (_, k) => ano - 3 + k)
      .map(a => `<option value="${a}" ${a === val ? 'selected' : ''}>${a}</option>`)
      .join('');
  });
}

function dreAtualizarFiltro() {
  _dreMesIni = parseInt(document.getElementById('dreSelMesIni').value);
  _dreAnoIni = parseInt(document.getElementById('dreSelAnoIni').value);
  _dreMesFim = parseInt(document.getElementById('dreSelMesFim').value);
  _dreAnoFim = parseInt(document.getElementById('dreSelAnoFim').value);
}

// ── Gerar DRE ─────────────────────────────────────────────────
async function dreGerar() {
  const el = document.getElementById('dreConteudo');
  if (el) el.innerHTML = '<div class="dp-loading"><div class="dp-spin"></div> Calculando...</div>';

  const compIni = `${_dreAnoIni}-${String(_dreMesIni + 1).padStart(2, '0')}`;
  const compFim = `${_dreAnoFim}-${String(_dreMesFim + 1).padStart(2, '0')}`;

  // Buscar plano de contas analíticas
  const { data: contas, error: ePC } = await sb
    .from('plano_contas')
    .select('id, codigo, descricao, tipo, natureza, grau')
    .eq('cliente_id', currentCliente.id)
    .eq('ativo', true)
    .eq('grau', 'analitica')
    .order('codigo');

  if (ePC || !contas?.length) {
    if (el) el.innerHTML = '<div class="dp-empty" style="padding:40px 0"><p>Nenhuma conta no plano de contas.</p></div>';
    return;
  }

  // Buscar lançamentos do período
  const { data: lancs, error: eLC } = await sb
    .from('lancamentos_contabeis')
    .select('debito_id, credito_id, valor')
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .eq('estornado', false)
    .gte('competencia', compIni)
    .lte('competencia', compFim);

  if (eLC) { showToast('Erro ao buscar lançamentos: ' + eLC.message, 'error'); return; }

  // Calcular saldo por conta (natureza define D-C ou C-D)
  const saldos = {};
  contas.forEach(c => { saldos[c.id] = 0; });

  (lancs || []).forEach(l => {
    if (saldos[l.debito_id]  !== undefined) saldos[l.debito_id]  += +l.valor;
    if (saldos[l.credito_id] !== undefined) saldos[l.credito_id] -= +l.valor;
  });

  // Saldo final: devedora = positivo quando D>C, credora = positivo quando C>D
  contas.forEach(c => {
    if (c.natureza === 'credora') saldos[c.id] = -saldos[c.id];
  });

  // Agrupar contas por tipo
  const porTipo = {};
  contas.forEach(c => {
    if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
    porTipo[c.tipo].push({ ...c, saldo: saldos[c.id] || 0 });
  });

  // Montar linhas da DRE
  const linhasDRE = [];
  let receitaBruta = 0, custo = 0, despesa = 0, deducoes = 0;

  // Receitas credoras (saldo positivo = receita)
  const receitas = (porTipo['receita'] || []).filter(c => c.natureza === 'credora' && c.saldo > 0);
  receitas.forEach(c => { receitaBruta += c.saldo; });

  // Deduções (contas de receita com natureza devedora = retificadoras)
  const deducoesContas = (porTipo['receita'] || []).filter(c => c.natureza === 'devedora' && c.saldo > 0);
  deducoesContas.forEach(c => { deducoes += c.saldo; });

  // Custos
  (porTipo['custo'] || []).forEach(c => { custo += Math.abs(c.saldo); });

  // Despesas
  (porTipo['despesa'] || []).forEach(c => { despesa += Math.abs(c.saldo); });

  const receitaLiquida    = receitaBruta - deducoes;
  const lucroBruto        = receitaLiquida - custo;
  const resultadoOpera    = lucroBruto - despesa;
  const resultadoLiquido  = resultadoOpera;
  const lucro             = resultadoLiquido >= 0;

  // KPIs
  document.getElementById('dreKpiReceita').textContent  = _dreFmt(receitaBruta);
  document.getElementById('dreKpiCusto').textContent    = _dreFmt(custo + despesa);
  document.getElementById('dreKpiResultado').textContent = _dreFmt(Math.abs(resultadoLiquido));
  document.getElementById('dreKpiResultado').style.color = lucro ? '#16a34a' : '#dc2626';
  document.getElementById('dreKpiLabel').textContent     = lucro ? 'Lucro Líquido' : 'Prejuízo Líquido';

  const periodo = `${MESES_DRE[_dreMesIni]}/${_dreAnoIni}` +
    (_dreMesIni !== _dreMesFim || _dreAnoIni !== _dreAnoFim
      ? ` a ${MESES_DRE[_dreMesFim]}/${_dreAnoFim}` : '');
  const pEl = document.getElementById('drePeriodoLabel');
  if (pEl) pEl.textContent = periodo;

  // Render
  _dreRender({
    receitaBruta, deducoes, receitaLiquida,
    custo, lucroBruto, despesa,
    resultadoOpera, resultadoLiquido,
    porTipo, lucro,
  });
}

// ── Render ────────────────────────────────────────────────────
function _dreRender(d) {
  const el = document.getElementById('dreConteudo');
  if (!el) return;

  const semDados = d.receitaBruta === 0 && d.custo === 0 && d.despesa === 0;
  if (semDados) {
    el.innerHTML = '<div class="dp-empty" style="padding:30px 0"><p>Nenhum lançamento no período selecionado.</p></div>';
    return;
  }

  const linha = (label, valor, opts = {}) => {
    const { subtotal, final, detalhe, indent = 0, negativo = false } = opts;
    const cor = final ? (d.lucro ? '#16a34a' : '#dc2626') : subtotal ? 'var(--text)' : 'var(--text-light)';
    const bg  = final ? (d.lucro ? '#f0fdf4' : '#fef2f2') : subtotal ? 'var(--sidebar-hover)' : '';
    const fw  = subtotal || final ? '700' : '400';
    const fs  = final ? '14px' : '13px';
    const valorFmt = valor !== null
      ? `<span style="color:${negativo && valor > 0 ? '#dc2626' : cor}">${negativo && valor > 0 ? '(' + _dreFmt(valor) + ')' : _dreFmt(Math.abs(valor))}</span>`
      : '';

    return `
      <tr style="${bg ? 'background:' + bg + ';' : ''}border-bottom:1px solid var(--border)">
        <td style="padding:${subtotal || final ? '10px' : '7px'} 14px;padding-left:${14 + indent * 16}px;font-size:${fs};font-weight:${fw};color:${cor}">
          ${escapeHtml(label)}
        </td>
        <td style="padding:${subtotal || final ? '10px' : '7px'} 14px;text-align:right;font-size:${fs};font-weight:${fw}">
          ${valorFmt}
        </td>
      </tr>`;
  };

  const linhaContas = (contas, negativo = false) => contas
    .filter(c => c.saldo !== 0)
    .map(c => linha(`${c.codigo} — ${c.descricao}`, Math.abs(c.saldo), { indent: 1, negativo }))
    .join('');

  let html = `<table style="width:100%;border-collapse:collapse">`;

  // Receita Bruta
  html += linha('RECEITA BRUTA', d.receitaBruta, { subtotal: true });
  html += linhaContas(d.porTipo['receita']?.filter(c => c.natureza === 'credora' && c.saldo > 0) || []);

  // Deduções
  if (d.deducoes > 0) {
    html += linha('(-) Deduções da Receita', d.deducoes, { negativo: true });
    html += linhaContas(d.porTipo['receita']?.filter(c => c.natureza === 'devedora' && c.saldo > 0) || [], true);
  }

  // Receita Líquida
  html += linha('(=) RECEITA LÍQUIDA', d.receitaLiquida, { subtotal: true });

  // Custos
  if (d.custo > 0) {
    html += linha('(-) Custos', d.custo, { negativo: true });
    html += linhaContas(d.porTipo['custo'] || [], true);
  }

  // Lucro Bruto
  html += linha('(=) LUCRO BRUTO', d.lucroBruto, { subtotal: true });

  // Despesas
  if (d.despesa > 0) {
    html += linha('(-) Despesas Operacionais', d.despesa, { negativo: true });
    html += linhaContas(d.porTipo['despesa'] || [], true);
  }

  // Resultado final
  html += linha(
    `(=) ${d.lucro ? 'LUCRO' : 'PREJUÍZO'} LÍQUIDO DO EXERCÍCIO`,
    d.resultadoLiquido,
    { subtotal: true, final: true }
  );

  html += '</table>';
  el.innerHTML = html;
}

// ── Imprimir ──────────────────────────────────────────────────
function dreImprimir() {
  const conteudo = document.getElementById('dreConteudo');
  if (!conteudo || conteudo.querySelector('.dp-empty')) {
    showToast('Gere a DRE primeiro.', 'warn'); return;
  }

  const empresa = currentCliente.nome_fantasia || currentCliente.razao_social;
  const periodo = document.getElementById('drePeriodoLabel')?.textContent || '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>DRE — ${empresa}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #1e293b; font-size: 12px; }
      h2 { margin: 0 0 2px; font-size: 16px; }
      p  { margin: 0 0 20px; color: #64748b; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
      td:last-child { text-align: right; }
      @media print { button { display: none } }
    </style>
  </head><body>
    <h2>Demonstração do Resultado do Exercício</h2>
    <p>${empresa} &nbsp;·&nbsp; CNPJ ${currentCliente.cnpj || '—'} &nbsp;·&nbsp;
       Período: ${periodo} &nbsp;·&nbsp; Emitido em ${new Date().toLocaleDateString('pt-BR')}</p>
    ${conteudo.innerHTML}
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ── Helper ────────────────────────────────────────────────────
function _dreFmt(v) {
  return (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
