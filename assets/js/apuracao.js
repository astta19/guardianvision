// ============================================================
// APURACAO.JS — Módulo 6 dos Módulos Contábeis
// Apuração de IRPJ/CSLL/PIS/COFINS/DAS por regime
// Depende: core.js, sb, currentCliente, currentUser
// ============================================================

// ── Tabelas fiscais ───────────────────────────────────────────
const APUR_ANEXOS = {
  I: [  // Comércio
    { max: 180000,  aliq: 0.04,  ded: 0       },
    { max: 360000,  aliq: 0.073, ded: 5940    },
    { max: 720000,  aliq: 0.095, ded: 13860   },
    { max: 1800000, aliq: 0.107, ded: 22500   },
    { max: 3600000, aliq: 0.143, ded: 87300   },
    { max: 4800000, aliq: 0.19,  ded: 378000  },
  ],
  III: [ // Serviços Fator R ≥ 28%
    { max: 180000,  aliq: 0.06,  ded: 0       },
    { max: 360000,  aliq: 0.112, ded: 9360    },
    { max: 720000,  aliq: 0.135, ded: 17640   },
    { max: 1800000, aliq: 0.16,  ded: 35640   },
    { max: 3600000, aliq: 0.21,  ded: 125640  },
    { max: 4800000, aliq: 0.33,  ded: 648000  },
  ],
  V: [   // Serviços Fator R < 28%
    { max: 180000,  aliq: 0.155, ded: 0       },
    { max: 360000,  aliq: 0.18,  ded: 4500    },
    { max: 720000,  aliq: 0.195, ded: 9900    },
    { max: 1800000, aliq: 0.205, ded: 17100   },
    { max: 3600000, aliq: 0.23,  ded: 62100   },
    { max: 4800000, aliq: 0.305, ded: 540000  },
  ],
};

// Percentuais de presunção LP (IRPJ / CSLL)
const APUR_PRESUNCAO = {
  comercio:     { irpj: 0.08, csll: 0.12 },
  industria:    { irpj: 0.08, csll: 0.12 },
  servicos:     { irpj: 0.32, csll: 0.32 },
  transportes:  { irpj: 0.16, csll: 0.12 },
  construcao:   { irpj: 0.08, csll: 0.12 },
};

// ── Estado ───────────────────────────────────────────────────
let _apurMes = new Date().getMonth();
let _apurAno = new Date().getFullYear();

const MESES_APUR = ['Jan','Fev','Mar','Abr','Mai','Jun',
                    'Jul','Ago','Set','Out','Nov','Dez'];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openApuracao() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('apurModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Pré-preencher regime pelo cadastro do cliente
  const regime = (currentCliente.regime_tributario || '').toLowerCase();
  const selRegime = document.getElementById('apurRegime');
  if (selRegime) {
    if (regime.includes('simples')) selRegime.value = 'simples';
    else if (regime.includes('mei'))       selRegime.value = 'mei';
    else if (regime.includes('presumido')) selRegime.value = 'presumido';
    else if (regime.includes('real'))      selRegime.value = 'real';
  }
  apurAlterarRegime();
  _apurAtualizarLabel();

  // Tentar buscar faturamento do mês nos lançamentos contábeis (contas de receita)
  await _apurPreencherFaturamento();
}

function closeApuracao() {
  document.getElementById('apurModal').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('apurResultado').innerHTML = '';
}

// ── Helpers de UI ─────────────────────────────────────────────
function apurAlterarRegime() {
  const regime = document.getElementById('apurRegime').value;
  document.getElementById('apurCamposMEI').style.display       = regime === 'mei'       ? '' : 'none';
  document.getElementById('apurCamposSimples').style.display   = regime === 'simples'   ? '' : 'none';
  document.getElementById('apurCamposPresumido').style.display = regime === 'presumido' ? '' : 'none';
  document.getElementById('apurCamposReal').style.display      = regime === 'real'      ? '' : 'none';
  document.getElementById('apurResultado').innerHTML = '';
}

function _apurAtualizarLabel() {
  const el = document.getElementById('apurMesLabel');
  if (el) el.textContent = `${MESES_APUR[_apurMes]}/${_apurAno}`;
}

async function apurNavMes(delta) {
  _apurMes += delta;
  if (_apurMes > 11) { _apurMes = 0;  _apurAno++; }
  if (_apurMes < 0)  { _apurMes = 11; _apurAno--; }
  _apurAtualizarLabel();
  await _apurPreencherFaturamento();
}

// ── Pré-preencher faturamento dos lançamentos contábeis ───────
async function _apurPreencherFaturamento() {
  const comp = `${_apurAno}-${String(_apurMes + 1).padStart(2, '0')}`;

  // Buscar contas de receita analíticas
  const { data: contasReceita } = await sb
    .from('plano_contas')
    .select('id')
    .eq('cliente_id', currentCliente.id)
    .eq('tipo', 'receita')
    .eq('natureza', 'credora')
    .eq('grau', 'analitica');

  if (!contasReceita?.length) return;
  const ids = contasReceita.map(c => c.id);

  // Somar créditos nessas contas
  const { data: lancs } = await sb
    .from('lancamentos_contabeis')
    .select('credito_id, valor')
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .eq('competencia', comp)
    .eq('estornado', false)
    .in('credito_id', ids);

  const totalReceita = (lancs || []).reduce((s, l) => s + +l.valor, 0);
  if (totalReceita <= 0) return;

  // Preencher no campo correto conforme regime
  const regime = document.getElementById('apurRegime').value;
  const camposMap = {
    mei:       'apurFatMEI',
    simples:   'apurFatSimples',
    presumido: 'apurFatPresumido',
    real:      'apurFatReal',
  };
  const campo = camposMap[regime];
  if (campo) {
    const el = document.getElementById(campo);
    if (el && !el.value) el.value = totalReceita.toFixed(2);
  }
}

// ── Calcular ──────────────────────────────────────────────────
async function apurCalcular() {
  const regime  = document.getElementById('apurRegime').value;
  const comp    = `${MESES_APUR[_apurMes]}/${_apurAno}`;
  const compISO = `${_apurAno}-${String(_apurMes + 1).padStart(2, '0')}`;
  let tributos  = [];
  let resumo    = '';

  try {
    if (regime === 'mei') {
      tributos = _apurCalcularMEI();
      resumo   = 'DAS-MEI (valor fixo mensal)';

    } else if (regime === 'simples') {
      tributos = _apurCalcularSimples();
      resumo   = 'Simples Nacional';

    } else if (regime === 'presumido') {
      tributos = _apurCalcularPresumido();
      resumo   = 'Lucro Presumido';

    } else if (regime === 'real') {
      tributos = _apurCalcularReal();
      resumo   = 'Lucro Real (estimativa mensal)';
    }

    if (!tributos.length) return;

    _apurRenderResultado(tributos, comp, resumo);

    // Salvar apurações no banco
    const _escId = await getEscritorioIdAtual();
    for (const t of tributos) {
      await sb.from('apuracoes').upsert({
        user_id:       currentUser.id,
        cliente_id:    currentCliente.id,
        escritorio_id: _escId,
        competencia:   compISO,
        regime,
        tipo_tributo:  t.codigo,
        base_calculo:  t.base || null,
        aliquota:      t.aliquota || null,
        valor_tributo: t.valor,
        status:        'aberta',
        vencimento:    _apurVencimento(regime, _apurMes, _apurAno),
        codigo_receita: t.codigo,
        dados_calculo:  t,
      }, { onConflict: 'cliente_id,competencia,tipo_tributo' });
    }
    showToast('Apuração salva.', 'success');

  } catch (e) {
    showToast('Erro no cálculo: ' + e.message, 'error');
  }
}

// ── Cálculo MEI ───────────────────────────────────────────────
function _apurCalcularMEI() {
  const tipo = document.getElementById('apurTipoMEI').value;
  const base = {
    comercio:  { inss: 75.90, icms: 5.00, iss: 0,     total: 80.90  },
    servicos:  { inss: 75.90, icms: 0,    iss: 5.00,  total: 80.90  },
    ambos:     { inss: 75.90, icms: 5.00, iss: 5.00,  total: 85.90  },
  }[tipo] || { inss: 75.90, icms: 5.00, iss: 0, total: 80.90 };

  return [{ desc: 'DAS-MEI', codigo: '4328', valor: base.total,
    obs: `INSS R$${base.inss} + ${base.icms > 0 ? 'ICMS R$' + base.icms : ''}${base.iss > 0 ? 'ISS R$' + base.iss : ''}` }];
}

// ── Cálculo Simples Nacional ──────────────────────────────────
function _apurCalcularSimples() {
  const fat    = parseFloat(document.getElementById('apurFatSimples').value.replace(',', '.'));
  const rbt12  = parseFloat(document.getElementById('apurRBT12').value.replace(',', '.')) || fat * 12;
  const folha  = parseFloat(document.getElementById('apurFolhaSimples').value.replace(',', '.')) || 0;
  const ativ   = document.getElementById('apurAtivSimples').value;

  if (!fat || fat <= 0) { showToast('Informe o faturamento do mês.', 'warn'); return []; }

  let anexo, anexoLabel;
  if (ativ === 'servico') {
    const fatorR = folha > 0 ? (folha * 12) / rbt12 : 0;
    if (fatorR >= 0.28) { anexo = APUR_ANEXOS.III; anexoLabel = `Anexo III (Fator R: ${(fatorR*100).toFixed(1)}%)`; }
    else                { anexo = APUR_ANEXOS.V;   anexoLabel = `Anexo V (Fator R: ${(fatorR*100).toFixed(1)}%)`; }
  } else {
    anexo = APUR_ANEXOS.I; anexoLabel = 'Anexo I (Comércio)';
  }

  const faixa       = anexo.find(f => rbt12 <= f.max) || anexo[anexo.length - 1];
  const aliqEfetiva = (rbt12 * faixa.aliq - faixa.ded) / rbt12;
  const das         = fat * aliqEfetiva;

  return [{ desc: 'DAS Simples Nacional', codigo: 'DAS', valor: das, base: fat,
    aliquota: aliqEfetiva * 100,
    obs: `${anexoLabel} · RBT12 R$${_apurFmt(rbt12)} · Alíq. efetiva ${(aliqEfetiva * 100).toFixed(2)}%` }];
}

// ── Cálculo Lucro Presumido ───────────────────────────────────
function _apurCalcularPresumido() {
  const fat     = parseFloat(document.getElementById('apurFatPresumido').value.replace(',', '.'));
  const ativ    = document.getElementById('apurAtivPresumido').value;
  if (!fat || fat <= 0) { showToast('Informe o faturamento do mês.', 'warn'); return []; }

  const perc    = APUR_PRESUNCAO[ativ] || APUR_PRESUNCAO.servicos;
  const bcIRPJ  = fat * perc.irpj;
  const bcCSLL  = fat * perc.csll;
  const irpj    = bcIRPJ * 0.15 + Math.max(0, bcIRPJ - 20000) * 0.10; // adicional 10% acima de R$20k/mês
  const csll    = bcCSLL * 0.09;
  const pis     = fat * 0.0065;
  const cofins  = fat * 0.03;

  return [
    { desc: 'IRPJ',   codigo: '2089', valor: irpj,   base: bcIRPJ, aliquota: 15,
      obs: `BC R$${_apurFmt(bcIRPJ)} × 15% (presunção ${(perc.irpj*100).toFixed(0)}%)` },
    { desc: 'CSLL',   codigo: '2372', valor: csll,   base: bcCSLL, aliquota: 9,
      obs: `BC R$${_apurFmt(bcCSLL)} × 9%` },
    { desc: 'PIS',    codigo: '8109', valor: pis,    base: fat,    aliquota: 0.65,
      obs: `Fat × 0,65% (cumulativo)` },
    { desc: 'COFINS', codigo: '2172', valor: cofins, base: fat,    aliquota: 3,
      obs: `Fat × 3% (cumulativo)` },
  ];
}

// ── Cálculo Lucro Real (estimativa) ──────────────────────────
function _apurCalcularReal() {
  const fat     = parseFloat(document.getElementById('apurFatReal').value.replace(',', '.'));
  const custos  = parseFloat(document.getElementById('apurCustosReal').value.replace(',', '.')) || 0;
  const desp    = parseFloat(document.getElementById('apurDespesasReal').value.replace(',', '.')) || 0;
  if (!fat || fat <= 0) { showToast('Informe o faturamento.', 'warn'); return []; }

  const lucro   = fat - custos - desp;
  const bcIRPJ  = Math.max(0, lucro);
  const irpj    = bcIRPJ * 0.15 + Math.max(0, bcIRPJ - 20000) * 0.10;
  const csll    = Math.max(0, lucro) * 0.09;
  // PIS/COFINS não-cumulativo (créditos simplificados = 30% dos custos/desp)
  const creditosPIS    = (custos + desp) * 0.0165;
  const creditosCOFINS = (custos + desp) * 0.076;
  const pis    = Math.max(0, fat * 0.0165 - creditosPIS);
  const cofins = Math.max(0, fat * 0.076  - creditosCOFINS);

  return [
    { desc: 'IRPJ (estimativa)',   codigo: '2089', valor: irpj,   base: bcIRPJ, aliquota: 15,
      obs: `Lucro R$${_apurFmt(lucro)} × 15%${lucro > 20000 ? ' + adicional 10%' : ''}` },
    { desc: 'CSLL (estimativa)',   codigo: '2372', valor: csll,   base: bcIRPJ, aliquota: 9,
      obs: `Lucro R$${_apurFmt(lucro)} × 9%` },
    { desc: 'PIS (não-cumulativo)',  codigo: '8109', valor: pis,  base: fat,    aliquota: 1.65,
      obs: `Fat × 1,65% − créditos` },
    { desc: 'COFINS (não-cumulativo)', codigo: '2172', valor: cofins, base: fat, aliquota: 7.6,
      obs: `Fat × 7,6% − créditos` },
  ];
}

// ── Render resultado ──────────────────────────────────────────
function _apurRenderResultado(tributos, comp, resumo) {
  const el = document.getElementById('apurResultado');
  if (!el) return;

  const total = tributos.reduce((s, t) => s + t.valor, 0);
  const venc  = document.getElementById('apurVencLabel');
  if (venc) {
    const [m, a] = comp.split('/');
    const regime  = document.getElementById('apurRegime').value;
    venc.textContent = `Vencimento: ${_apurVencimento(regime, parseInt(m) - 1, parseInt(a))}`;
  }

  el.innerHTML = `
    <div style="background:var(--sidebar-hover);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">
        ${resumo} — ${comp}
      </div>
      ${tributos.map(t => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:13px;font-weight:600">${escapeHtml(t.desc)}</div>
            ${t.obs ? `<div style="font-size:11px;color:var(--text-light)">${escapeHtml(t.obs)}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:700;color:var(--accent)">R$ ${_apurFmt(t.valor)}</div>
            ${t.codigo !== t.desc ? `<div style="font-size:10px;color:var(--text-light)">Cód. ${t.codigo}</div>` : ''}
          </div>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;padding-top:10px;font-size:14px;font-weight:700">
        <span>Total a recolher</span>
        <span style="color:#dc2626">R$ ${_apurFmt(total)}</span>
      </div>
    </div>`;
}

// ── Histórico de apurações ─────────────────────────────────────
async function apurCarregarHistorico() {
  const el = document.getElementById('apurHistorico');
  if (!el) return;
  el.innerHTML = '<div class="dp-loading"><div class="dp-spin"></div></div>';

  const { data, error } = await sb
    .from('apuracoes')
    .select('*')
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .order('competencia', { ascending: false })
    .limit(24);

  if (error || !data?.length) {
    el.innerHTML = '<p style="font-size:12px;color:var(--text-light);text-align:center;padding:12px">Nenhuma apuração salva.</p>';
    return;
  }

  // Agrupar por competência
  const porComp = {};
  data.forEach(a => {
    if (!porComp[a.competencia]) porComp[a.competencia] = [];
    porComp[a.competencia].push(a);
  });

  el.innerHTML = Object.entries(porComp).map(([comp, items]) => {
    const total = items.reduce((s, a) => s + +a.valor_tributo, 0);
    const pago  = items.every(a => a.status === 'paga');
    return `
      <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-size:13px;font-weight:600">${comp}</span>
            <span style="font-size:11px;color:var(--text-light);margin-left:8px">${items[0].regime}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:${pago ? '#16a34a' : '#dc2626'}">
              R$ ${_apurFmt(total)}
            </span>
            <span style="font-size:10px;padding:2px 7px;border-radius:8px;font-weight:600;
              background:${pago ? '#dcfce7' : '#fef3c7'};color:${pago ? '#16a34a' : '#d97706'}">
              ${pago ? 'Pago' : 'Aberto'}
            </span>
          </div>
        </div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
          ${items.map(a => `
            <span style="font-size:11px;background:var(--sidebar-hover);padding:2px 8px;border-radius:6px">
              ${escapeHtml(a.tipo_tributo)}: R$ ${_apurFmt(+a.valor_tributo)}
            </span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

// ── Vencimento por regime ─────────────────────────────────────
function _apurVencimento(regime, mes, ano) {
  // Próximo mês para DAS/LP mensal
  let m = mes + 1, a = ano;
  if (m > 11) { m = 0; a++; }
  const dia = regime === 'simples' || regime === 'mei' ? 20 : 28;
  return `${String(dia).padStart(2,'0')}/${String(m+1).padStart(2,'0')}/${a}`;
}

// ── Helper ────────────────────────────────────────────────────
function _apurFmt(v) {
  return (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
