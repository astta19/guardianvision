// ============================================================
// FOLHA.JS — Departamento Pessoal Completo v2
// Tabelas: Portaria MF 1.191/2025 (INSS) · 1.206/2025 (IRRF)
//
// SQL NECESSÁRIO NO SUPABASE:
// ─────────────────────────────────────────────────────────────
// CREATE TABLE dp_funcionarios (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id uuid REFERENCES auth.users NOT NULL,
//   cliente_id uuid REFERENCES clientes,
//   nome text NOT NULL,
//   cargo text,
//   cpf text,
//   ctps text,
//   pis text,
//   admissao date NOT NULL,
//   salario_base numeric(12,2) NOT NULL,
//   tipo_contrato text DEFAULT 'clt',
//   dependentes int DEFAULT 0,
//   banco text, agencia text, conta text,
//   status text DEFAULT 'ativo',
//   criado_em timestamptz DEFAULT now(),
//   atualizado_em timestamptz DEFAULT now()
// );
// ALTER TABLE dp_funcionarios ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own" ON dp_funcionarios USING (user_id = auth.uid());
//
// CREATE TABLE dp_holerites (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id uuid REFERENCES auth.users NOT NULL,
//   cliente_id uuid REFERENCES clientes,
//   funcionario_id uuid REFERENCES dp_funcionarios,
//   competencia text NOT NULL,
//   dias_trabalhados int DEFAULT 30,
//   salario_bruto numeric(12,2),
//   he50_horas numeric(5,2) DEFAULT 0,
//   he100_horas numeric(5,2) DEFAULT 0,
//   adic_noturno_horas numeric(5,2) DEFAULT 0,
//   outros_acrescimos numeric(12,2) DEFAULT 0,
//   total_bruto numeric(12,2),
//   inss numeric(12,2), irrf numeric(12,2),
//   pensao_alimenticia numeric(12,2) DEFAULT 0,
//   outros_descontos numeric(12,2) DEFAULT 0,
//   total_descontos numeric(12,2),
//   salario_liquido numeric(12,2),
//   fgts numeric(12,2), inss_patronal numeric(12,2),
//   rat numeric(12,2) DEFAULT 0,
//   custo_total numeric(12,2),
//   tipo_contrato text DEFAULT 'clt',
//   dados_completos jsonb,
//   criado_em timestamptz DEFAULT now(),
//   UNIQUE(user_id, funcionario_id, competencia)
// );
// ALTER TABLE dp_holerites ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own" ON dp_holerites USING (user_id = auth.uid());
//
// CREATE TABLE dp_eventos (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id uuid REFERENCES auth.users NOT NULL,
//   cliente_id uuid REFERENCES clientes,
//   funcionario_id uuid REFERENCES dp_funcionarios,
//   tipo text NOT NULL,
//   competencia text,
//   dados jsonb NOT NULL,
//   criado_em timestamptz DEFAULT now()
// );
// ALTER TABLE dp_eventos ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own" ON dp_eventos USING (user_id = auth.uid());
// ─────────────────────────────────────────────────────────────

// ── Tabelas tributárias 2025/2026 ─────────────────────────────
const INSS_FAIXAS = [
  { ate: 1518.00, aliq: 0.075 },
  { ate: 2793.88, aliq: 0.09  },
  { ate: 4190.83, aliq: 0.12  },
  { ate: 8157.41, aliq: 0.14  },
];
const INSS_TETO = 908.85;

const IRRF_FAIXAS = [
  { ate: 2428.80,  aliq: 0,     ded: 0      },
  { ate: 2826.65,  aliq: 0.075, ded: 182.16 },
  { ate: 3751.05,  aliq: 0.15,  ded: 394.16 },
  { ate: 4664.68,  aliq: 0.225, ded: 675.49 },
  { ate: Infinity, aliq: 0.275, ded: 908.74 },
];
const IRRF_DEP = 189.59;

// ── Estado ─────────────────────────────────────────────────────
let dpFuncionarios  = [];
let dpFuncAtivo     = null;
let folhaFuncionarios = []; // compat exportarFolhaExcel

// ── Utilitários ────────────────────────────────────────────────
function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function r2(v) { return Math.round((v || 0) * 100) / 100; }

function calcularINSS(bruto) {
  if (bruto <= 0) return 0;
  let inss = 0, ant = 0;
  const base = Math.min(bruto, 8157.41);
  for (const f of INSS_FAIXAS) {
    if (base <= ant) break;
    inss += (Math.min(base, f.ate) - ant) * f.aliq;
    ant = f.ate;
  }
  return Math.min(r2(inss), INSS_TETO);
}

function calcularIRRF(base) {
  if (base <= 0) return 0;
  const f = IRRF_FAIXAS.find(x => base <= x.ate) || IRRF_FAIXAS.at(-1);
  return Math.max(0, r2(base * f.aliq - f.ded));
}

// ── Abrir / Fechar / Abas ──────────────────────────────────────
async function openFolha() {
  closeDropdowns();
  if (!currentUser) { showToast('Faça login para acessar o DP.', 'warn'); return; }
  document.getElementById('folhaModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Competência padrão
  const hoje = new Date();
  const comp = String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  ['folhaCompetencia','dpFeriasComp','dp13Comp'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = comp;
  });

  await dpCarregarFuncionarios();
  const badge = document.getElementById('dpEmpresaBadge');
  if (badge) badge.textContent = currentCliente?.nome_fantasia || currentCliente?.razao_social || '';
  switchDpTab('funcionarios');
  lucide.createIcons();
  setTimeout(() => document.getElementById('dpFuncNome')?.focus(), 80);
}

function closeFolha() {
  document.getElementById('folhaModal').style.display = 'none';
  document.body.style.overflow = '';
}

function switchDpTab(tab) {
  document.querySelectorAll('.dp-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dp-panel').forEach(p => { p.style.display = 'none'; });
  const btn = document.querySelector(`.dp-tab-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('dpPanel_' + tab);
  if (panel) panel.style.display = 'block';
  if (tab === 'folha')     dpPreencherSelect('folhaFuncSelect');
  if (tab === 'ferias')    dpPreencherSelect('dpFeriasFuncSelect');
  if (tab === 'decimo')    dpPreencherSelect('dp13FuncSelect');
  if (tab === 'rescisao')  dpPreencherSelect('dpRescFuncSelect');
  if (tab === 'relatorios') dpCarregarRelatorio();
}

// ── FUNCIONÁRIOS ───────────────────────────────────────────────
async function dpCarregarFuncionarios() {
  if (!currentUser || !currentCliente?.id) return;
  try {
    const { data, error } = await sb
      .from('dp_funcionarios')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('cliente_id', currentCliente.id)
      .order('nome');
    if (error) throw error;
    dpFuncionarios = data || [];
    dpRenderFuncionarios();
  } catch { showToast('Erro ao carregar funcionários.', 'error'); }
}

function dpRenderFuncionarios() {
  const el = document.getElementById('dpFuncList');
  if (!el) return;
  if (!currentCliente) {
    el.innerHTML = '<p class="dp-empty">Selecione uma empresa primeiro.</p>';
    return;
  }
  if (!dpFuncionarios.length) {
    el.innerHTML = '<p class="dp-empty">Nenhum funcionário cadastrado.<br>Use o formulário abaixo para adicionar.</p>';
    return;
  }
  el.innerHTML = dpFuncionarios.map(f => `
    <div class="dp-func-card${f.status === 'rescindido' ? ' dp-rescindido' : ''}" onclick="dpSelecionarFunc('${f.id}')">
      <div class="dp-func-avatar">${(f.nome||'?')[0].toUpperCase()}</div>
      <div class="dp-func-info">
        <div class="dp-func-nome">${escapeHtml(f.nome)}</div>
        <div class="dp-func-sub">${escapeHtml(f.cargo || '—')} · ${(f.tipo_contrato||'clt').toUpperCase()}</div>
        <div class="dp-func-sub">Adm: ${f.admissao ? new Date(f.admissao+'T00:00').toLocaleDateString('pt-BR') : '—'} · R$ ${fmtBRL(f.salario_base)}</div>
      </div>
      <div class="dp-func-btns">
        <button class="dp-icon-btn" onclick="event.stopPropagation();dpEditarFunc('${f.id}')" title="Editar">
          <i data-lucide="pencil"></i>
        </button>
        <button class="dp-icon-btn dp-icon-danger" onclick="event.stopPropagation();dpExcluirFunc('${f.id}')" title="Excluir">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`).join('');
  lucide.createIcons();
}

function dpPreencherSelect(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Selecione o funcionário —</option>' +
    dpFuncionarios.filter(f => f.status !== 'rescindido').map(f =>
      `<option value="${f.id}">${escapeHtml(f.nome)}${f.cargo ? ' — ' + escapeHtml(f.cargo) : ''}</option>`
    ).join('');
  if (prev) sel.value = prev;
}

function dpSelecionarFunc(id) {
  dpFuncAtivo = dpFuncionarios.find(f => f.id === id);
  document.querySelectorAll('.dp-func-card').forEach(c => c.classList.remove('dp-selected'));
  document.querySelector(`.dp-func-card[onclick*="${id}"]`)?.classList.add('dp-selected');
}

function dpEditarFunc(id) {
  const f = dpFuncionarios.find(x => x.id === id);
  if (!f) return;
  dpFuncAtivo = f;
  document.getElementById('dpFuncFormId').value   = f.id;
  document.getElementById('dpFuncNome').value     = f.nome || '';
  document.getElementById('dpFuncCargo').value    = f.cargo || '';
  document.getElementById('dpFuncCPF').value      = f.cpf || '';
  document.getElementById('dpFuncCTPS').value     = f.ctps || '';
  document.getElementById('dpFuncPIS').value      = f.pis || '';
  document.getElementById('dpFuncAdmissao').value = f.admissao || '';
  document.getElementById('dpFuncSalario').value  = f.salario_base || '';
  document.getElementById('dpFuncTipo').value     = f.tipo_contrato || 'clt';
  document.getElementById('dpFuncDep').value      = f.dependentes || 0;
  document.getElementById('dpFuncBanco').value    = f.banco || '';
  document.getElementById('dpFuncAgencia').value  = f.agencia || '';
  document.getElementById('dpFuncConta').value    = f.conta || '';
  document.getElementById('dpFuncNome').focus();
}

function dpNovoFunc() {
  dpFuncAtivo = null;
  ['dpFuncFormId','dpFuncNome','dpFuncCargo','dpFuncCPF','dpFuncCTPS','dpFuncPIS',
   'dpFuncAdmissao','dpFuncBanco','dpFuncAgencia','dpFuncConta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('dpFuncSalario').value = '';
  document.getElementById('dpFuncTipo').value    = 'clt';
  document.getElementById('dpFuncDep').value     = 0;
  document.getElementById('dpFuncNome').focus();
}

async function dpSalvarFunc() {
  if (!currentUser || !currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  const id      = document.getElementById('dpFuncFormId').value;
  const nome    = document.getElementById('dpFuncNome').value.trim();
  const admissao= document.getElementById('dpFuncAdmissao').value;
  const salario = parseFloat(document.getElementById('dpFuncSalario').value);
  if (!nome || !admissao || !salario) { showToast('Nome, admissão e salário são obrigatórios.', 'warn'); return; }

  const payload = {
    user_id:       currentUser.id,
    cliente_id:    currentCliente.id,
    nome,
    cargo:         document.getElementById('dpFuncCargo').value.trim() || null,
    cpf:           document.getElementById('dpFuncCPF').value.replace(/\D/g,'') || null,
    ctps:          document.getElementById('dpFuncCTPS').value.trim() || null,
    pis:           document.getElementById('dpFuncPIS').value.replace(/\D/g,'') || null,
    admissao,
    salario_base:  salario,
    tipo_contrato: document.getElementById('dpFuncTipo').value,
    dependentes:   parseInt(document.getElementById('dpFuncDep').value) || 0,
    banco:         document.getElementById('dpFuncBanco').value.trim() || null,
    agencia:       document.getElementById('dpFuncAgencia').value.trim() || null,
    conta:         document.getElementById('dpFuncConta').value.trim() || null,
    atualizado_em: new Date().toISOString(),
  };

  const btn = document.getElementById('dpFuncSalvarBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const { error } = id
      ? await sb.from('dp_funcionarios').update(payload).eq('id', id).eq('user_id', currentUser.id)
      : await sb.from('dp_funcionarios').insert({ ...payload, status: 'ativo' });
    if (error) throw error;
    showToast(id ? 'Funcionário atualizado!' : 'Funcionário cadastrado!', 'success');
    dpNovoFunc();
    await dpCarregarFuncionarios();
  } catch(e) { showToast('Erro ao salvar: ' + (e.message || ''), 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Salvar Funcionário'; } }
}

async function dpExcluirFunc(id) {
  const f = dpFuncionarios.find(x => x.id === id);
  if (!f) return;
  showConfirm(`Excluir "${f.nome}"? Holerites vinculados são mantidos.`, async () => {
    const { error } = await sb.from('dp_funcionarios').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Funcionário removido.', 'success');
    await dpCarregarFuncionarios();
  });
}

// ── FOLHA MENSAL ───────────────────────────────────────────────
function dpFuncChanged(selectId) {
  const id = document.getElementById(selectId)?.value;
  if (!id) return;
  dpFuncAtivo = dpFuncionarios.find(f => f.id === id);
  if (!dpFuncAtivo || selectId !== 'folhaFuncSelect') return;
  const s = document.getElementById('folhaSalario');
  if (s) s.value = dpFuncAtivo.salario_base || '';
  const t = document.getElementById('folhaTipoContrato');
  if (t) t.value = dpFuncAtivo.tipo_contrato || 'clt';
  const d = document.getElementById('folhaDependentes');
  if (d) d.value = dpFuncAtivo.dependentes || 0;
  calcularFolha();
}

function calcularFolha() {
  const sal   = parseFloat(document.getElementById('folhaSalario')?.value)     || 0;
  const he50  = parseFloat(document.getElementById('folhaHE50')?.value)         || 0;
  const he100 = parseFloat(document.getElementById('folhaHE100')?.value)        || 0;
  const anot  = parseFloat(document.getElementById('folhaAdicNoturno')?.value)  || 0;
  const dep   = parseInt(document.getElementById('folhaDependentes')?.value)    || 0;
  const pen   = parseFloat(document.getElementById('folhaPensao')?.value)       || 0;
  const outD  = parseFloat(document.getElementById('folhaOutrosDesc')?.value)   || 0;
  const outA  = parseFloat(document.getElementById('folhaOutrosAcr')?.value)    || 0;
  const dias  = parseInt(document.getElementById('folhaDias')?.value)           || 30;
  const tipo  = document.getElementById('folhaTipoContrato')?.value || 'clt';
  const comp  = document.getElementById('folhaCompetencia')?.value || '';

  if (sal <= 0) {
    document.getElementById('folhaResult')  && (document.getElementById('folhaResult').style.display  = 'none');
    document.getElementById('folhaActions') && (document.getElementById('folhaActions').style.display = 'none');
    return;
  }

  // Proventos
  const prop  = r2(dias / 30);
  const salProp = r2(sal * prop);
  const vh    = sal / 220;
  const vlHE50  = r2(he50  * vh * 1.50);
  const vlHE100 = r2(he100 * vh * 2.00);
  const vlAnot  = r2(anot  * vh * 0.20);
  const bruto   = r2(salProp + vlHE50 + vlHE100 + vlAnot + outA);

  // Descontos por tipo de contrato
  let inss = 0, irrf = 0, baseIRRF = 0, fgts = 0, pat = 0, rat = 0, obs = [];

  if (tipo === 'clt') {
    inss     = calcularINSS(bruto);
    fgts     = r2(bruto * 0.08);
    baseIRRF = Math.max(0, bruto - inss - dep * IRRF_DEP - pen);
    irrf     = calcularIRRF(baseIRRF);
    pat      = r2(bruto * 0.20);
    rat      = r2(bruto * 0.02);
    obs      = ['INSS progressivo · FGTS 8% · INSS Patronal 20% + RAT ~2%',
                'Não inclui: 13º (1/12), férias (1/3+1/3), VT, VR'];
  } else if (tipo === 'pj') {
    inss     = Math.min(r2(Math.min(bruto, 8157.41) * 0.20), INSS_TETO);
    baseIRRF = Math.max(0, bruto - inss - dep * IRRF_DEP - pen);
    irrf     = calcularIRRF(baseIRRF);
    obs      = ['INSS contrib. individual 20% (teto R$ 8.157,41) · Sem FGTS · Emite RPA ou NFS-e'];
  } else {
    baseIRRF = Math.max(0, bruto - dep * IRRF_DEP - pen);
    irrf     = calcularIRRF(baseIRRF);
    obs      = ['Estágio (Lei 11.788/2008): sem INSS previdenciário e sem FGTS'];
  }

  const totD   = r2(inss + irrf + pen + outD);
  const liq    = Math.max(0, r2(bruto - totD));
  const custo  = r2(bruto + fgts + pat + rat);
  const func   = dpFuncAtivo || {};

  const d = {
    funcId: func.id || null, nomeFuncionario: func.nome || '',
    cargo: func.cargo || '', empresa: currentCliente?.razao_social || '',
    cnpj: currentCliente?.cnpj || '', competencia: comp,
    salarioBruto: sal, proporcao: prop, diasTrabalhados: dias, salarioProporcional: salProp,
    vlHE50, horasExtras50: he50, vlHE100, horasExtras100: he100, vlAdicNot: vlAnot, adicNoturno: anot,
    outrosAcrescimos: outA, totalBruto: bruto,
    inss, irrf, fgts, baseIRRF, dependentes: dep, pensaoAlim: pen,
    outrosDescontos: outD, totalDescontos: totD, salarioLiquido: liq,
    inssPatronal: pat, rat, custoTotal: custo, tipoContrato: tipo, observacoes: obs,
  };

  renderFolhaResult(d);
}

function renderFolhaResult(r) {
  const el = document.getElementById('folhaResult');
  if (!el) return;

  const rP = (desc, v) => v > 0
    ? `<tr><td class="dp-td">${desc}</td><td class="dp-td r dp-green">+ R$ ${fmtBRL(v)}</td></tr>` : '';
  const rD = (desc, v, obs='') => v > 0
    ? `<tr><td class="dp-td">${desc}${obs ? `<small class="dp-obs"> ${obs}</small>` : ''}</td><td class="dp-td r dp-red">- R$ ${fmtBRL(v)}</td></tr>` : '';

  el.innerHTML = `
    <div class="dp-recibo">
      <div class="dp-recibo-hd">
        <span class="dp-recibo-nm">${escapeHtml(r.nomeFuncionario||'Funcionário')}${r.cargo?' — '+escapeHtml(r.cargo):''}</span>
        <span class="dp-recibo-sub">Comp: ${r.competencia} · ${r.diasTrabalhados} dias · ${(r.tipoContrato||'CLT').toUpperCase()}</span>
      </div>
      <div class="dp-sec"><div class="dp-sec-title">Proventos</div>
        <table class="dp-table">
          ${rP('Salário Base'+(r.proporcao<1?` (${r.diasTrabalhados}/30)`:''), r.salarioProporcional)}
          ${rP(`HE 50% — ${r.horasExtras50}h`, r.vlHE50)}
          ${rP(`HE 100% — ${r.horasExtras100}h`, r.vlHE100)}
          ${rP(`Adic. Noturno — ${r.adicNoturno}h`, r.vlAdicNot)}
          ${rP('Outros acréscimos', r.outrosAcrescimos)}
          <tr class="dp-tr-tot"><td class="dp-td bold">Total Proventos</td><td class="dp-td r bold">R$ ${fmtBRL(r.totalBruto)}</td></tr>
        </table>
      </div>
      <div class="dp-sec"><div class="dp-sec-title">Descontos</div>
        <table class="dp-table">
          ${rD('INSS', r.inss, '(progressivo)')}
          ${rD('IRRF', r.irrf, `(base R$ ${fmtBRL(r.baseIRRF)})`)}
          ${rD('Pensão Alimentícia', r.pensaoAlim)}
          ${rD('Outros descontos', r.outrosDescontos)}
          <tr class="dp-tr-tot"><td class="dp-td bold">Total Descontos</td><td class="dp-td r bold dp-red">- R$ ${fmtBRL(r.totalDescontos)}</td></tr>
        </table>
      </div>
      <div class="dp-liquido">
        <span>SALÁRIO LÍQUIDO</span>
        <span class="dp-liq-val">R$ ${fmtBRL(r.salarioLiquido)}</span>
      </div>
      ${r.tipoContrato === 'clt' ? `
      <div class="dp-sec"><div class="dp-sec-title">Custo Empresa (CLT)</div>
        <table class="dp-table">
          ${rP('Salário Bruto', r.totalBruto)}
          ${rP('FGTS (8%)', r.fgts)}
          ${rP('INSS Patronal (20%)', r.inssPatronal)}
          ${rP('RAT — Acidente Trabalho (~2%)', r.rat)}
          <tr class="dp-tr-tot"><td class="dp-td bold">Custo Total Empresa</td><td class="dp-td r bold">R$ ${fmtBRL(r.custoTotal)}</td></tr>
        </table>
      </div>` : ''}
      ${(r.observacoes||[]).map(o=>`<p class="dp-note">ℹ️ ${o}</p>`).join('')}
    </div>`;

  el.style.display = 'block';
  const ac = document.getElementById('folhaActions');
  if (ac) ac.style.display = 'flex';

  window._folhaData = r;
  folhaFuncionarios = folhaFuncionarios.filter(x => x.nomeFuncionario !== r.nomeFuncionario);
  folhaFuncionarios.push(r);
}

async function dpSalvarHolerite() {
  const d = window._folhaData;
  if (!d) { showToast('Calcule a folha primeiro.', 'warn'); return; }
  if (!d.funcId) { showToast('Selecione um funcionário cadastrado para salvar.', 'warn'); return; }
  const btn = document.getElementById('dpSalvarHoleriteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const { error } = await sb.from('dp_holerites').upsert({
      user_id: currentUser.id, cliente_id: currentCliente?.id,
      funcionario_id: d.funcId, competencia: d.competencia,
      dias_trabalhados: d.diasTrabalhados, salario_bruto: d.salarioBruto,
      he50_horas: d.horasExtras50, he100_horas: d.horasExtras100,
      adic_noturno_horas: d.adicNoturno, outros_acrescimos: d.outrosAcrescimos,
      total_bruto: d.totalBruto, inss: d.inss, irrf: d.irrf,
      pensao_alimenticia: d.pensaoAlim, outros_descontos: d.outrosDescontos,
      total_descontos: d.totalDescontos, salario_liquido: d.salarioLiquido,
      fgts: d.fgts, inss_patronal: d.inssPatronal, rat: d.rat,
      custo_total: d.custoTotal, tipo_contrato: d.tipoContrato, dados_completos: d,
    }, { onConflict: 'user_id,funcionario_id,competencia' });
    if (error) throw error;
    showToast('Holerite salvo no banco!', 'success');
  } catch(e) { showToast('Erro ao salvar: ' + (e.message || ''), 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Holerite'; } }
}

// ── FÉRIAS ─────────────────────────────────────────────────────
function calcularFerias() {
  const funcId = document.getElementById('dpFeriasFuncSelect')?.value;
  const dias   = parseInt(document.getElementById('dpFeriasDias')?.value) || 30;
  const abono  = document.getElementById('dpFeriasAbono')?.checked;
  const comp   = document.getElementById('dpFeriasComp')?.value;
  const func   = dpFuncionarios.find(f => f.id === funcId);
  if (!func) { showToast('Selecione um funcionário.', 'warn'); return; }

  const sal      = func.salario_base;
  const base     = r2(sal * (dias / 30));
  const umTerco  = r2(base / 3);
  const abonoV   = abono ? r2(sal * (10 / 30)) : 0;
  const bruto    = r2(base + umTerco + abonoV);
  const inss     = calcularINSS(bruto);
  const baseIRRF = Math.max(0, bruto - inss - (func.dependentes || 0) * IRRF_DEP);
  const irrf     = calcularIRRF(baseIRRF);
  const liq      = r2(bruto - inss - irrf);

  const admissao = func.admissao ? new Date(func.admissao + 'T00:00') : null;
  const mesesTrab = admissao ? Math.floor((new Date() - admissao) / (30.44 * 86400000)) : null;

  const d = {
    funcId: func.id, nomeFuncionario: func.nome, cargo: func.cargo,
    empresa: currentCliente?.razao_social || '', cnpj: currentCliente?.cnpj || '',
    competencia: comp, diasFerias: dias, abono, salBase: sal,
    base, umTerco, abonoV, bruto, inss, irrf, baseIRRF, liq, mesesTrab, tipo: 'ferias',
  };

  const el = document.getElementById('dpFeriasResult');
  if (el) {
    el.innerHTML = `<div class="dp-recibo">
      <div class="dp-recibo-hd">
        <span class="dp-recibo-nm">${escapeHtml(func.nome)} — Férias</span>
        <span class="dp-recibo-sub">Comp: ${comp} · ${dias} dias${abono ? ' + 10 abono' : ''}${mesesTrab !== null ? ' · ' + mesesTrab + ' meses serviço' : ''}</span>
      </div>
      <div class="dp-sec"><table class="dp-table">
        <tr><td class="dp-td">Salário Base</td><td class="dp-td r">R$ ${fmtBRL(sal)}</td></tr>
        <tr><td class="dp-td">Férias (${dias} dias)</td><td class="dp-td r dp-green">R$ ${fmtBRL(base)}</td></tr>
        <tr><td class="dp-td">1/3 Constitucional</td><td class="dp-td r dp-green">R$ ${fmtBRL(umTerco)}</td></tr>
        ${abonoV > 0 ? `<tr><td class="dp-td">Abono Pecuniário (10 dias)</td><td class="dp-td r dp-green">R$ ${fmtBRL(abonoV)}</td></tr>` : ''}
        <tr class="dp-tr-tot"><td class="dp-td bold">Total Bruto</td><td class="dp-td r bold">R$ ${fmtBRL(bruto)}</td></tr>
        <tr><td class="dp-td">INSS</td><td class="dp-td r dp-red">- R$ ${fmtBRL(inss)}</td></tr>
        <tr><td class="dp-td">IRRF</td><td class="dp-td r dp-red">- R$ ${fmtBRL(irrf)}</td></tr>
      </table></div>
      <div class="dp-liquido"><span>FÉRIAS LÍQUIDAS</span><span class="dp-liq-val">R$ ${fmtBRL(liq)}</span></div>
      <p class="dp-note">ℹ️ Férias pagas com 2 dias de antecedência (CLT art. 145). INSS e IRRF incidem normalmente.</p>
    </div>`;
    el.style.display = 'block';
  }
  document.getElementById('dpFeriasActions') && (document.getElementById('dpFeriasActions').style.display = 'flex');
  window._dpFeriasData = d;
}

async function dpSalvarFerias() {
  const d = window._dpFeriasData;
  if (!d || !currentUser) { showToast('Calcule as férias primeiro.', 'warn'); return; }
  try {
    const { error } = await sb.from('dp_eventos').insert({
      user_id: currentUser.id, cliente_id: currentCliente?.id,
      funcionario_id: d.funcId, tipo: 'ferias', competencia: d.competencia, dados: d,
    });
    if (error) throw error;
    showToast('Férias salvas no banco!', 'success');
  } catch { showToast('Erro ao salvar férias.', 'error'); }
}

// ── 13º SALÁRIO ────────────────────────────────────────────────
function calcularDecimo() {
  const funcId  = document.getElementById('dp13FuncSelect')?.value;
  const parcela = document.getElementById('dp13Parcela')?.value || '1';
  const meses   = parseInt(document.getElementById('dp13Meses')?.value) || 12;
  const comp    = document.getElementById('dp13Comp')?.value;
  const func    = dpFuncionarios.find(f => f.id === funcId);
  if (!func) { showToast('Selecione um funcionário.', 'warn'); return; }

  const sal  = func.salario_base;
  const prop = r2(sal * meses / 12);
  let bruto, inss = 0, irrf = 0, liq, obs;

  if (parcela === '1') {
    bruto = r2(prop / 2);
    liq   = bruto;
    obs   = '1ª parcela: 50% do 13º proporcional, sem INSS e IRRF. Pago até 30/11.';
  } else {
    const inssInt  = calcularINSS(prop);
    const baseIRRF = Math.max(0, prop - inssInt - (func.dependentes || 0) * IRRF_DEP);
    const irrfInt  = calcularIRRF(baseIRRF);
    const prima    = r2(prop / 2);
    bruto = r2(prop - prima);
    inss  = inssInt; irrf = irrfInt;
    liq   = r2(bruto - inss - irrf);
    obs   = `2ª parcela: saldo após 1ª. INSS/IRRF sobre valor integral R$ ${fmtBRL(prop)}. Pago até 20/12.`;
  }

  const d = {
    funcId: func.id, nomeFuncionario: func.nome, cargo: func.cargo,
    empresa: currentCliente?.razao_social || '', cnpj: currentCliente?.cnpj || '',
    competencia: comp, parcela, meses, salBase: sal, prop, bruto, inss, irrf, liq, obs,
    tipo: 'decimo_terceiro',
  };

  const el = document.getElementById('dp13Result');
  if (el) {
    el.innerHTML = `<div class="dp-recibo">
      <div class="dp-recibo-hd">
        <span class="dp-recibo-nm">${escapeHtml(func.nome)} — 13º Salário</span>
        <span class="dp-recibo-sub">${parcela === '1' ? '1ª Parcela' : '2ª Parcela'} · ${meses}/12 meses · Comp: ${comp}</span>
      </div>
      <div class="dp-sec"><table class="dp-table">
        <tr><td class="dp-td">Salário Base</td><td class="dp-td r">R$ ${fmtBRL(sal)}</td></tr>
        <tr><td class="dp-td">13º Proporcional (${meses}/12)</td><td class="dp-td r">R$ ${fmtBRL(prop)}</td></tr>
        <tr><td class="dp-td">${parcela==='1'?'1ª Parcela (50%)':'2ª Parcela (saldo)'}</td><td class="dp-td r dp-green">R$ ${fmtBRL(bruto)}</td></tr>
        ${inss > 0 ? `<tr><td class="dp-td">INSS</td><td class="dp-td r dp-red">- R$ ${fmtBRL(inss)}</td></tr>` : ''}
        ${irrf > 0 ? `<tr><td class="dp-td">IRRF</td><td class="dp-td r dp-red">- R$ ${fmtBRL(irrf)}</td></tr>` : ''}
      </table></div>
      <div class="dp-liquido"><span>VALOR LÍQUIDO</span><span class="dp-liq-val">R$ ${fmtBRL(liq)}</span></div>
      <p class="dp-note">ℹ️ ${obs}</p>
    </div>`;
    el.style.display = 'block';
  }
  document.getElementById('dp13Actions') && (document.getElementById('dp13Actions').style.display = 'flex');
  window._dpDecimoData = d;
}

async function dpSalvarDecimo() {
  const d = window._dpDecimoData;
  if (!d || !currentUser) { showToast('Calcule o 13º primeiro.', 'warn'); return; }
  try {
    const { error } = await sb.from('dp_eventos').insert({
      user_id: currentUser.id, cliente_id: currentCliente?.id,
      funcionario_id: d.funcId, tipo: 'decimo_terceiro', competencia: d.competencia, dados: d,
    });
    if (error) throw error;
    showToast('13º salvo no banco!', 'success');
  } catch { showToast('Erro ao salvar 13º.', 'error'); }
}

// ── RESCISÃO ───────────────────────────────────────────────────
function calcularRescisao() {
  const funcId   = document.getElementById('dpRescFuncSelect')?.value;
  const dtDeslig = document.getElementById('dpRescData')?.value;
  const motivo   = document.getElementById('dpRescMotivo')?.value || 'sem_justa_causa';
  const saldoDias= parseInt(document.getElementById('dpRescSaldoDias')?.value) || 0;
  const mesesFer = parseInt(document.getElementById('dpRescFerProp')?.value) || 0;
  const meses13  = parseInt(document.getElementById('dpRescDecProp')?.value) || 0;
  const avisoPrev= document.getElementById('dpRescAviso')?.checked;
  const func     = dpFuncionarios.find(f => f.id === funcId);
  if (!func || !dtDeslig) { showToast('Selecione o funcionário e a data de desligamento.', 'warn'); return; }

  const sal       = func.salario_base;
  const vDia      = r2(sal / 30);
  const saldo     = r2(saldoDias * vDia);
  const aviso     = (avisoPrev && ['sem_justa_causa'].includes(motivo)) ? sal : 0;
  const ferProp   = r2(sal * mesesFer / 12);
  const umTerco   = r2(ferProp / 3);
  const dec13     = r2(sal * meses13 / 12);
  const bruto     = r2(saldo + aviso + ferProp + umTerco + dec13);

  // INSS: sobre saldo + aviso (Súmula 173 STJ; férias e 13 não pagam INSS na rescisão)
  const baseInss  = r2(saldo + aviso);
  const inss      = calcularINSS(baseInss);
  const baseIRRF  = Math.max(0, bruto - inss);
  const irrf      = calcularIRRF(baseIRRF);
  const fgts      = r2(baseInss * 0.08);
  const multa40   = motivo === 'sem_justa_causa' ? r2(fgts * 5) : 0;
  const liq       = r2(bruto - inss - irrf);

  const MOTIVOS = {
    sem_justa_causa: 'Demissão Sem Justa Causa',
    justa_causa:     'Demissão por Justa Causa',
    pedido_demissao: 'Pedido de Demissão',
    acordo_mutuo:    'Acordo Mútuo (§ 15, art. 484-A CLT)',
  };

  const d = {
    funcId: func.id, nomeFuncionario: func.nome, cargo: func.cargo,
    empresa: currentCliente?.razao_social || '', cnpj: currentCliente?.cnpj || '',
    dtDeslig, motivo, saldoDias, mesesFer, meses13, avisoPrev,
    sal, saldo, aviso, ferProp, umTerco, dec13, bruto,
    baseInss, inss, baseIRRF, irrf, fgts, multa40, liq, tipo: 'rescisao',
  };

  const el = document.getElementById('dpRescResult');
  if (el) {
    const rP = (desc, v) => v > 0
      ? `<tr><td class="dp-td">${desc}</td><td class="dp-td r dp-green">R$ ${fmtBRL(v)}</td></tr>` : '';
    el.innerHTML = `<div class="dp-recibo">
      <div class="dp-recibo-hd">
        <span class="dp-recibo-nm">${escapeHtml(func.nome)} — Rescisão</span>
        <span class="dp-recibo-sub">${MOTIVOS[motivo]||motivo} · ${new Date(dtDeslig+'T00:00').toLocaleDateString('pt-BR')}</span>
      </div>
      <div class="dp-sec"><div class="dp-sec-title">Verbas Rescisórias</div>
        <table class="dp-table">
          ${rP(`Saldo de Salário (${saldoDias} dias)`, saldo)}
          ${rP('Aviso Prévio Indenizado', aviso)}
          ${rP(`Férias Proporcionais (${mesesFer}/12)`, ferProp)}
          ${rP('1/3 Constitucional s/ Férias', umTerco)}
          ${rP(`13º Proporcional (${meses13}/12)`, dec13)}
          <tr class="dp-tr-tot"><td class="dp-td bold">Total Bruto</td><td class="dp-td r bold">R$ ${fmtBRL(bruto)}</td></tr>
          <tr><td class="dp-td">INSS (saldo + aviso)</td><td class="dp-td r dp-red">- R$ ${fmtBRL(inss)}</td></tr>
          <tr><td class="dp-td">IRRF</td><td class="dp-td r dp-red">- R$ ${fmtBRL(irrf)}</td></tr>
        </table>
      </div>
      <div class="dp-liquido"><span>RESCISÃO LÍQUIDA</span><span class="dp-liq-val">R$ ${fmtBRL(liq)}</span></div>
      ${multa40 > 0 ? `
      <div class="dp-sec"><div class="dp-sec-title">Encargos — Empresa</div>
        <table class="dp-table">
          ${rP('FGTS sobre verbas tributáveis', fgts)}
          ${rP('Multa 40% FGTS (sem justa causa)', multa40)}
        </table>
      </div>` : ''}
      <p class="dp-note">ℹ️ Verifique extrato FGTS na CAIXA. Homologar no Sindicato quando necessário (acima de 1 ano de serviço).</p>
    </div>`;
    el.style.display = 'block';
  }
  document.getElementById('dpRescActions') && (document.getElementById('dpRescActions').style.display = 'flex');
  window._dpRescData = d;
}

async function dpSalvarRescisao() {
  const d = window._dpRescData;
  if (!d || !currentUser) { showToast('Calcule a rescisão primeiro.', 'warn'); return; }
  try {
    await sb.from('dp_funcionarios')
      .update({ status: 'rescindido', atualizado_em: new Date().toISOString() })
      .eq('id', d.funcId).eq('user_id', currentUser.id);
    const { error } = await sb.from('dp_eventos').insert({
      user_id: currentUser.id, cliente_id: currentCliente?.id,
      funcionario_id: d.funcId, tipo: 'rescisao',
      competencia: d.dtDeslig?.slice(0, 7), dados: d,
    });
    if (error) throw error;
    showToast('Rescisão salva. Funcionário marcado como rescindido.', 'success');
    await dpCarregarFuncionarios();
  } catch { showToast('Erro ao salvar rescisão.', 'error'); }
}

// ── RELATÓRIOS ─────────────────────────────────────────────────
async function dpCarregarRelatorio() {
  const el = document.getElementById('dpRelContent');
  if (!el || !currentUser || !currentCliente?.id) return;
  el.innerHTML = '<p class="dp-empty">Carregando relatórios...</p>';

  try {
    const [
      { data: holerites },
      { data: eventos },
      { count: ativos },
      { count: rescindidos },
    ] = await Promise.all([
      sb.from('dp_holerites')
        .select('competencia,total_bruto,inss,irrf,fgts,inss_patronal,rat,custo_total,salario_liquido')
        .eq('user_id', currentUser.id).eq('cliente_id', currentCliente.id)
        .order('competencia', { ascending: false }).limit(60),
      sb.from('dp_eventos')
        .select('tipo,competencia,dados,criado_em')
        .eq('user_id', currentUser.id).eq('cliente_id', currentCliente.id)
        .order('criado_em', { ascending: false }).limit(20),
      sb.from('dp_funcionarios').select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id).eq('cliente_id', currentCliente.id).eq('status', 'ativo'),
      sb.from('dp_funcionarios').select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id).eq('cliente_id', currentCliente.id).eq('status', 'rescindido'),
    ]);

    // Agrupar por competência
    const porComp = {};
    for (const h of (holerites || [])) {
      if (!porComp[h.competencia]) porComp[h.competencia] = { comp: h.competencia, bruto: 0, inss: 0, irrf: 0, fgts: 0, pat: 0, rat: 0, custo: 0, liq: 0, qtd: 0 };
      const c = porComp[h.competencia];
      c.bruto += +h.total_bruto || 0; c.inss   += +h.inss || 0;
      c.irrf  += +h.irrf || 0;        c.fgts   += +h.fgts || 0;
      c.pat   += +h.inss_patronal || 0; c.rat  += +h.rat || 0;
      c.custo += +h.custo_total || 0; c.liq   += +h.salario_liquido || 0;
      c.qtd++;
    }
    const comps = Object.values(porComp).sort((a, b) => b.comp.localeCompare(a.comp));
    const totalCusto = comps.reduce((s, c) => s + c.custo, 0);
    const medCusto   = comps.length ? r2(totalCusto / comps.length) : 0;

    el.innerHTML = `
      <!-- KPIs -->
      <div class="dp-kpis">
        <div class="dp-kpi"><span class="dp-kpi-v">${ativos ?? 0}</span><span class="dp-kpi-l">Funcionários Ativos</span></div>
        <div class="dp-kpi"><span class="dp-kpi-v">${rescindidos ?? 0}</span><span class="dp-kpi-l">Rescindidos</span></div>
        <div class="dp-kpi"><span class="dp-kpi-v">${comps.length}</span><span class="dp-kpi-l">Meses com Folha</span></div>
        <div class="dp-kpi"><span class="dp-kpi-v">R$ ${fmtBRL(medCusto)}</span><span class="dp-kpi-l">Custo Médio/Mês</span></div>
        <div class="dp-kpi"><span class="dp-kpi-v">R$ ${fmtBRL(totalCusto)}</span><span class="dp-kpi-l">Custo Total Acumulado</span></div>
      </div>

      <!-- Tabela histórico -->
      <div class="dp-rel-bloco">
        <div class="dp-rel-title">Histórico de Folhas por Competência
          <button class="dp-rel-export-btn" onclick="dpExportarRelatorioExcel()">
            <i data-lucide="download"></i> Exportar Excel
          </button>
        </div>
        ${comps.length ? `
        <div class="dp-tbl-wrap">
          <table class="dp-rel-table">
            <thead><tr>
              <th>Comp.</th><th>Func.</th><th>Bruto</th>
              <th>INSS</th><th>IRRF</th><th>FGTS</th>
              <th>Patronal</th><th>Custo Total</th>
            </tr></thead>
            <tbody>
              ${comps.map(c => `<tr>
                <td class="dp-td-comp">${c.comp}</td>
                <td class="n">${c.qtd}</td>
                <td class="n">R$ ${fmtBRL(c.bruto)}</td>
                <td class="n">R$ ${fmtBRL(c.inss)}</td>
                <td class="n">R$ ${fmtBRL(c.irrf)}</td>
                <td class="n">R$ ${fmtBRL(c.fgts)}</td>
                <td class="n">R$ ${fmtBRL(c.pat)}</td>
                <td class="n bold">R$ ${fmtBRL(c.custo)}</td>
              </tr>`).join('')}
              <tr class="dp-tr-tot">
                <td colspan="2" class="dp-td bold">TOTAL</td>
                <td class="n bold">R$ ${fmtBRL(comps.reduce((s,c)=>s+c.bruto,0))}</td>
                <td class="n">R$ ${fmtBRL(comps.reduce((s,c)=>s+c.inss,0))}</td>
                <td class="n">R$ ${fmtBRL(comps.reduce((s,c)=>s+c.irrf,0))}</td>
                <td class="n">R$ ${fmtBRL(comps.reduce((s,c)=>s+c.fgts,0))}</td>
                <td class="n">R$ ${fmtBRL(comps.reduce((s,c)=>s+c.pat,0))}</td>
                <td class="n bold">R$ ${fmtBRL(totalCusto)}</td>
              </tr>
            </tbody>
          </table>
        </div>` : '<p class="dp-empty">Nenhum holerite salvo ainda.</p>'}
      </div>

      <!-- Eventos DP -->
      <div class="dp-rel-bloco">
        <div class="dp-rel-title">Últimos Eventos (Férias · 13º · Rescisões)</div>
        ${(eventos || []).length ? `
        <div class="dp-tbl-wrap">
          <table class="dp-rel-table">
            <thead><tr><th>Tipo</th><th>Funcionário</th><th>Competência</th><th>Valor Líquido</th></tr></thead>
            <tbody>
              ${eventos.map(e => `<tr>
                <td>${e.tipo === 'ferias' ? '🏖️ Férias' : e.tipo === 'decimo_terceiro' ? '🎁 13º' : '📋 Rescisão'}</td>
                <td>${escapeHtml(e.dados?.nomeFuncionario || '—')}</td>
                <td>${e.competencia || '—'}</td>
                <td class="n">R$ ${fmtBRL(e.dados?.liq || e.dados?.liquido || 0)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="dp-empty">Nenhum evento registrado.</p>'}
      </div>`;

    lucide.createIcons();
  } catch(e) {
    el.innerHTML = `<p class="dp-empty" style="color:#dc2626">Erro: ${e.message}</p>`;
  }
}

async function dpExportarRelatorioExcel() {
  if (!currentUser || !currentCliente?.id) return;
  try {
    const { data } = await sb.from('dp_holerites')
      .select('*, dp_funcionarios(nome, cargo)')
      .eq('user_id', currentUser.id).eq('cliente_id', currentCliente.id)
      .order('competencia');
    const cab = ['Competência','Funcionário','Cargo','Dias','Bruto','INSS','IRRF',
                 'Pensão','Outros Desc.','Total Desc.','Líquido','FGTS','INSS Pat.','RAT','Custo Total'];
    const rows = (data || []).map(h => [
      h.competencia, h.dp_funcionarios?.nome || '', h.dp_funcionarios?.cargo || '',
      h.dias_trabalhados,
      +Number(h.total_bruto||0).toFixed(2), +Number(h.inss||0).toFixed(2),
      +Number(h.irrf||0).toFixed(2), +Number(h.pensao_alimenticia||0).toFixed(2),
      +Number(h.outros_descontos||0).toFixed(2), +Number(h.total_descontos||0).toFixed(2),
      +Number(h.salario_liquido||0).toFixed(2), +Number(h.fgts||0).toFixed(2),
      +Number(h.inss_patronal||0).toFixed(2), +Number(h.rat||0).toFixed(2),
      +Number(h.custo_total||0).toFixed(2),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [`FOLHA DE PAGAMENTO — ${currentCliente.razao_social}`],
      [`CNPJ: ${currentCliente.cnpj} | Gerado: ${new Date().toLocaleDateString('pt-BR')}`],
      [], cab, ...rows,
    ]);
    ws['!cols'] = cab.map((_, i) => ({ wch: i < 3 ? 22 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Folha DP');
    XLSX.writeFile(wb, `dp-${(currentCliente.cnpj||'').replace(/\D/g,'')}-${new Date().toISOString().slice(0,7)}.xlsx`);
  } catch { showToast('Erro ao exportar.', 'error'); }
}

// ── PDF Holerite ───────────────────────────────────────────────
async function exportarFolhaPDF() {
  const d = window._folhaData;
  if (!d) { showToast('Calcule a folha primeiro.', 'warn'); return; }
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { showToast('jsPDF não carregado.', 'error'); return; }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15;
  let y = M;

  // Cabeçalho
  doc.setFillColor(26,26,26); doc.rect(0,0,W,14,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text('RECIBO DE PAGAMENTO — Fiscal365', M, 9);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(`${currentCliente?.razao_social||''} | CNPJ: ${currentCliente?.cnpj||'—'}`, W-M, 9, { align:'right' });
  y = 22;

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(0,0,0);
  doc.text(`${d.nomeFuncionario}${d.cargo?' — '+d.cargo:''}`, M, y); y += 6;
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
  doc.text(`Competência: ${d.competencia} · ${d.diasTrabalhados} dias · ${(d.tipoContrato||'CLT').toUpperCase()}`, M, y);
  y += 8; doc.setTextColor(0,0,0);

  const hdr = (cor, txt) => {
    doc.setFillColor(...cor); doc.rect(M, y-6, W-2*M, 8, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(txt, M+1, y); doc.setTextColor(0,0,0); y += 5;
  };
  const row = (label, val, bold=false) => {
    doc.setFontSize(9); doc.setFont('helvetica', bold?'bold':'normal');
    doc.text(label, M+1, y);
    doc.text(`R$ ${fmtBRL(val)}`, W-M, y, { align:'right' }); y += 5;
  };

  hdr([16,185,129], 'PROVENTOS');
  row('Salário Base'+(d.proporcao<1?` (${d.diasTrabalhados}/30)`:'' ), d.salarioProporcional);
  if (d.vlHE50  > 0) row(`HE 50% (${d.horasExtras50}h)`,  d.vlHE50);
  if (d.vlHE100 > 0) row(`HE 100% (${d.horasExtras100}h)`, d.vlHE100);
  if (d.vlAdicNot > 0) row(`Adic. Noturno (${d.adicNoturno}h)`, d.vlAdicNot);
  if (d.outrosAcrescimos > 0) row('Outros acréscimos', d.outrosAcrescimos);
  doc.line(M, y, W-M, y); y += 3; row('TOTAL PROVENTOS', d.totalBruto, true); y += 4;

  hdr([220,38,38], 'DESCONTOS');
  if (d.inss > 0) row(`INSS (tabela progressiva)`, d.inss);
  if (d.irrf > 0) row(`IRRF (base R$ ${fmtBRL(d.baseIRRF)})`, d.irrf);
  if (d.pensaoAlim > 0) row('Pensão Alimentícia', d.pensaoAlim);
  if (d.outrosDescontos > 0) row('Outros Descontos', d.outrosDescontos);
  doc.line(M, y, W-M, y); y += 3; row('TOTAL DESCONTOS', d.totalDescontos, true); y += 6;

  doc.setFillColor(240,253,244); doc.rect(M, y-5, W-2*M, 10, 'F');
  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(22,163,74);
  doc.text('SALÁRIO LÍQUIDO', M+2, y);
  doc.text(`R$ ${fmtBRL(d.salarioLiquido)}`, W-M-2, y, { align:'right' });
  y += 14; doc.setTextColor(0,0,0);

  if (d.tipoContrato === 'clt') {
    hdr([37,99,235], 'CUSTO EMPRESA');
    row('Salário Bruto', d.totalBruto);
    row('FGTS (8%)', d.fgts);
    row('INSS Patronal (20%)', d.inssPatronal);
    if (d.rat > 0) row('RAT (~2%)', d.rat);
    doc.line(M, y, W-M, y); y += 3; row('CUSTO TOTAL', d.custoTotal, true); y += 6;
  }

  y += 4;
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
  doc.line(M, y, M+65, y); doc.line(W-M-65, y, W-M, y); y += 5;
  doc.text('Assinatura do Empregado', M+5, y);
  doc.text('Assinatura do Empregador', W-M-55, y);

  doc.setDrawColor(200,200,200); doc.line(M, 285, W-M, 285);
  doc.setFontSize(7); doc.setTextColor(150,150,150);
  doc.text('Fiscal365 — Tabelas Portaria MF 1.191/2025 e 1.206/2025. Documento auxiliar.', 105, 290, { align:'center' });

  const nome = (d.nomeFuncionario||'func').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  doc.save(`recibo-${nome}-${(d.competencia||'').replace('/','')}.pdf`);
}

// ── Exportar Excel session ─────────────────────────────────────
function exportarFolhaExcel() {
  if (!folhaFuncionarios.length) { showToast('Calcule ao menos um holerite.', 'warn'); return; }
  const cab = ['Funcionário','Cargo','Comp.','Dias','Bruto','INSS','IRRF','Pensão','OutrosD','TotalD','Líquido','FGTS','Patronal','RAT','Custo Total'];
  const rows = folhaFuncionarios.map(f => [
    f.nomeFuncionario, f.cargo||'', f.competencia, f.diasTrabalhados,
    +r2(f.totalBruto), +r2(f.inss), +r2(f.irrf),
    +r2(f.pensaoAlim||0), +r2(f.outrosDescontos||0), +r2(f.totalDescontos),
    +r2(f.salarioLiquido), +r2(f.fgts), +r2(f.inssPatronal), +r2(f.rat||0), +r2(f.custoTotal),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [`FOLHA — ${folhaFuncionarios[0]?.empresa||''}`],
    [`Gerado: ${new Date().toLocaleDateString('pt-BR')}`], [], cab, ...rows,
  ]);
  ws['!cols'] = cab.map((_,i) => ({ wch: i < 3 ? 22 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Folha');
  XLSX.writeFile(wb, `folha-${new Date().toISOString().slice(0,7)}.xlsx`);
}

// ── Chat ───────────────────────────────────────────────────────
function enviarFolhaParaChat() {
  const d = window._folhaData;
  if (!d) { showToast('Calcule a folha primeiro.', 'warn'); return; }
  document.getElementById('msgInput').value =
    `Analise a folha de pagamento abaixo:\n\n` +
    `Funcionário: ${d.nomeFuncionario}${d.cargo?' — '+d.cargo:''}\n` +
    `Empresa: ${d.empresa||'—'} | Comp: ${d.competencia} | ${(d.tipoContrato||'CLT').toUpperCase()}\n` +
    `Bruto: R$ ${fmtBRL(d.totalBruto)} | INSS: R$ ${fmtBRL(d.inss)} | IRRF: R$ ${fmtBRL(d.irrf)}\n` +
    `Líquido: R$ ${fmtBRL(d.salarioLiquido)}\n` +
    `FGTS: R$ ${fmtBRL(d.fgts)} | Patronal: R$ ${fmtBRL(d.inssPatronal)} | RAT: R$ ${fmtBRL(d.rat)}\n` +
    `Custo Total: R$ ${fmtBRL(d.custoTotal)}`;
  closeFolha();
  document.getElementById('msgInput').focus();
}

function limparFolha() {
  ['folhaSalario','folhaHE50','folhaHE100','folhaAdicNoturno',
   'folhaPensao','folhaOutrosDesc','folhaOutrosAcr'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const dep = document.getElementById('folhaDependentes'); if (dep) dep.value = 0;
  const dias= document.getElementById('folhaDias');       if (dias) dias.value = 30;
  const res = document.getElementById('folhaResult');     if (res) res.style.display = 'none';
  const ac  = document.getElementById('folhaActions');    if (ac)  ac.style.display  = 'none';
  window._folhaData = null;
}
