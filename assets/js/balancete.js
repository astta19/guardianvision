// ============================================================
// BALANCETE.JS — Módulo 3 dos Módulos Contábeis
// Balancete de verificação por período
// Depende: core.js, sb, currentCliente, currentUser
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _balAnoIni  = new Date().getFullYear();
let _balMesIni  = 0;   // Janeiro
let _balAnoFim  = new Date().getFullYear();
let _balMesFim  = new Date().getMonth();
let _balDados   = [];  // { conta, saldo_anterior, debitos, creditos, saldo_atual }

const MESES_BAL = ['Jan','Fev','Mar','Abr','Mai','Jun',
                   'Jul','Ago','Set','Out','Nov','Dez'];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openBalancete() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('balModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _balAtualizarLabels();
  await balGerar();
}

function closeBalancete() {
  document.getElementById('balModal').style.display = 'none';
  document.body.style.overflow = '';
  _balDados = [];
}

// ── Labels de período ─────────────────────────────────────────
function _balAtualizarLabels() {
  const ini = `${MESES_BAL[_balMesIni]}/${_balAnoIni}`;
  const fim = `${MESES_BAL[_balMesFim]}/${_balAnoFim}`;
  const el = document.getElementById('balPeriodoLabel');
  if (el) el.textContent = ini === fim ? ini : `${ini} a ${fim}`;

  // Preencher os selects
  _balPopularSelects();
}

function _balPopularSelects() {
  ['balSelMesIni','balSelMesFim'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = i === 0 ? _balMesIni : _balMesFim;
    el.innerHTML = MESES_BAL.map((m, idx) =>
      `<option value="${idx}" ${idx === val ? 'selected' : ''}>${m}</option>`
    ).join('');
  });
  ['balSelAnoIni','balSelAnoFim'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = i === 0 ? _balAnoIni : _balAnoFim;
    const anoAtual = new Date().getFullYear();
    el.innerHTML = Array.from({ length: 6 }, (_, k) => anoAtual - 3 + k)
      .map(a => `<option value="${a}" ${a === val ? 'selected' : ''}>${a}</option>`)
      .join('');
  });
}

function balAtualizarFiltro() {
  _balMesIni = parseInt(document.getElementById('balSelMesIni').value);
  _balAnoIni = parseInt(document.getElementById('balSelAnoIni').value);
  _balMesFim = parseInt(document.getElementById('balSelMesFim').value);
  _balAnoFim = parseInt(document.getElementById('balSelAnoFim').value);
  _balAtualizarLabels();
}

// ── Gerar balancete ───────────────────────────────────────────
async function balGerar() {
  const el = document.getElementById('balConteudo');
  if (el) el.innerHTML = '<div class="dp-loading"><div class="dp-spin"></div> Calculando...</div>';

  const compIni = `${_balAnoIni}-${String(_balMesIni + 1).padStart(2, '0')}`;
  const compFim = `${_balAnoFim}-${String(_balMesFim + 1).padStart(2, '0')}`;

  // Buscar plano de contas
  const { data: contas, error: ePC } = await sb
    .from('plano_contas')
    .select('id, codigo, descricao, tipo, natureza, grau, conta_pai_id')
    .eq('cliente_id', currentCliente.id)
    .eq('ativo', true)
    .order('codigo');

  if (ePC || !contas?.length) {
    if (el) el.innerHTML = '<div class="dp-empty" style="padding:40px 0"><p>Nenhuma conta no plano de contas.</p></div>';
    return;
  }

  // Buscar lançamentos do período
  const { data: lançamentos, error: eLC } = await sb
    .from('lancamentos_contabeis')
    .select('debito_id, credito_id, valor, competencia')
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .eq('estornado', false)
    .gte('competencia', compIni)
    .lte('competencia', compFim);

  if (eLC) { showToast('Erro ao buscar lançamentos: ' + eLC.message, 'error'); return; }

  // Calcular totais por conta analítica
  const totais = {}; // { conta_id: { debitos, creditos } }
  contas.filter(c => c.grau === 'analitica').forEach(c => {
    totais[c.id] = { debitos: 0, creditos: 0 };
  });

  (lançamentos || []).forEach(l => {
    if (totais[l.debito_id])  totais[l.debito_id].debitos   += +l.valor;
    if (totais[l.credito_id]) totais[l.credito_id].creditos += +l.valor;
  });

  // Montar estrutura hierárquica acumulando sintéticas
  const mapaContas = {};
  contas.forEach(c => {
    mapaContas[c.id] = {
      ...c,
      debitos:  totais[c.id]?.debitos  || 0,
      creditos: totais[c.id]?.creditos || 0,
    };
  });

  // Propagar saldos das analíticas para as sintéticas
  contas.filter(c => c.grau === 'analitica').forEach(c => {
    let pai = mapaContas[c.conta_pai_id];
    while (pai) {
      pai.debitos  += mapaContas[c.id].debitos;
      pai.creditos += mapaContas[c.id].creditos;
      pai = mapaContas[pai.conta_pai_id];
    }
  });

  // Calcular saldo final por natureza
  Object.values(mapaContas).forEach(c => {
    c.saldo = c.natureza === 'devedora'
      ? c.debitos - c.creditos
      : c.creditos - c.debitos;
  });

  _balDados = Object.values(mapaContas);

  // KPIs
  const analiticas    = _balDados.filter(c => c.grau === 'analitica');
  const totalDebitos  = analiticas.reduce((s, c) => s + c.debitos, 0);
  const totalCreditos = analiticas.reduce((s, c) => s + c.creditos, 0);
  const contasAtivas  = analiticas.filter(c => c.debitos > 0 || c.creditos > 0).length;
  const eq = Math.abs(totalDebitos - totalCreditos) < 0.01;

  document.getElementById('balKpiContas').textContent    = contasAtivas;
  document.getElementById('balKpiDebitos').textContent   = _balFmt(totalDebitos);
  document.getElementById('balKpiCreditos').textContent  = _balFmt(totalCreditos);
  document.getElementById('balKpiEquilibrio').textContent = eq ? '✓ Equilibrado' : '⚠ Descasado';
  document.getElementById('balKpiEquilibrio').style.color = eq ? '#16a34a' : '#dc2626';

  _balRender(contas, mapaContas);
}

// ── Render ────────────────────────────────────────────────────
function _balRender(contas, mapa) {
  const el = document.getElementById('balConteudo');
  if (!el) return;

  const temMovimento = Object.values(mapa).some(c => c.debitos > 0 || c.creditos > 0);
  if (!temMovimento) {
    el.innerHTML = '<div class="dp-empty" style="padding:30px 0"><p>Nenhum lançamento no período selecionado.</p></div>';
    return;
  }

  const corTipo = { ativo:'#2563eb', passivo:'#dc2626', pl:'#7c3aed', receita:'#16a34a', despesa:'#d97706', custo:'#ea580c' };

  const linhas = contas.map(c => {
    const d = mapa[c.id];
    const indent = (c.nivel - 1) * 14;
    const isSint = c.grau === 'sintetica';
    const cor    = corTipo[c.tipo] || '#64748b';
    const saldoNeg = d.saldo < 0;

    return `
      <tr style="border-bottom:1px solid var(--border);${isSint ? 'background:var(--sidebar-hover)' : ''}">
        <td style="padding:6px 10px;padding-left:${10 + indent}px;font-size:${isSint ? '11px' : '12px'};font-weight:${isSint ? '700' : '400'}">
          <span style="font-family:monospace;color:${cor};margin-right:6px">${escapeHtml(c.codigo)}</span>
          ${escapeHtml(c.descricao)}
        </td>
        <td style="padding:6px 10px;text-align:right;font-size:12px;color:#2563eb">${d.debitos > 0 ? _balFmt(d.debitos) : '—'}</td>
        <td style="padding:6px 10px;text-align:right;font-size:12px;color:#16a34a">${d.creditos > 0 ? _balFmt(d.creditos) : '—'}</td>
        <td style="padding:6px 10px;text-align:right;font-size:12px;font-weight:${isSint ? '700' : '500'};color:${saldoNeg ? '#dc2626' : 'var(--text)'}">
          ${d.debitos > 0 || d.creditos > 0 ? _balFmt(Math.abs(d.saldo)) + (saldoNeg ? ' C' : ' D') : '—'}
        </td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:var(--card);color:var(--text-light);font-size:10px;text-transform:uppercase;letter-spacing:.4px;position:sticky;top:0;z-index:1">
          <th style="padding:8px 10px;text-align:left;font-weight:600;border-bottom:2px solid var(--border)">Conta</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600;border-bottom:2px solid var(--border);color:#2563eb">Débitos</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600;border-bottom:2px solid var(--border);color:#16a34a">Créditos</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600;border-bottom:2px solid var(--border)">Saldo</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

// ── Imprimir / Exportar ───────────────────────────────────────
function balImprimir() {
  if (!_balDados.length) { showToast('Gere o balancete primeiro.', 'warn'); return; }

  const compIni = `${MESES_BAL[_balMesIni]}/${_balAnoIni}`;
  const compFim = `${MESES_BAL[_balMesFim]}/${_balAnoFim}`;
  const periodo = compIni === compFim ? compIni : `${compIni} a ${compFim}`;
  const empresa = currentCliente.nome_fantasia || currentCliente.razao_social;

  const linhas = _balDados.map(c => {
    const indent = '&nbsp;'.repeat((c.nivel - 1) * 4);
    const isSint = c.grau === 'sintetica';
    const saldo  = c.debitos > 0 || c.creditos > 0
      ? _balFmt(Math.abs(c.saldo)) + (c.saldo < 0 ? ' C' : ' D')
      : '—';
    return `
      <tr style="${isSint ? 'background:#f8fafc;font-weight:700' : ''}">
        <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0">${indent}${c.codigo} — ${c.descricao}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f0f0f0;color:#2563eb">${c.debitos > 0 ? _balFmt(c.debitos) : ''}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f0f0f0;color:#16a34a">${c.creditos > 0 ? _balFmt(c.creditos) : ''}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #f0f0f0">${saldo}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Balancete — ${empresa}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #1e293b; font-size: 12px; }
      h2 { margin: 0 0 2px; font-size: 16px; }
      p  { margin: 0 0 16px; color: #64748b; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f8fafc; padding: 7px 8px; font-size: 11px; text-align: left;
           border-bottom: 2px solid #e2e8f0; }
      th:not(:first-child) { text-align: right; }
      @media print { button { display: none } }
    </style>
  </head><body>
    <h2>Balancete de Verificação</h2>
    <p>${empresa} &nbsp;·&nbsp; CNPJ ${currentCliente.cnpj || '—'} &nbsp;·&nbsp; Período: ${periodo} &nbsp;·&nbsp;
       Emitido em ${new Date().toLocaleDateString('pt-BR')}</p>
    <table>
      <thead><tr>
        <th>Conta</th>
        <th style="text-align:right;color:#2563eb">Débitos</th>
        <th style="text-align:right;color:#16a34a">Créditos</th>
        <th style="text-align:right">Saldo</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ── Helper ────────────────────────────────────────────────────
function _balFmt(v) {
  return (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
