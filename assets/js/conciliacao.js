// ============================================================
// CONCILIACAO.JS — Módulo 5 dos Módulos Contábeis
// Conciliação bancária: extrato vs lançamentos contábeis
// Depende: core.js, sb, currentCliente, currentUser
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _concContaId      = null;  // conta bancária selecionada
let _concContas       = [];    // lista de contas bancárias
let _concExtrato      = [];    // linhas do extrato importado
let _concLancamentos  = [];    // lançamentos contábeis do período
let _concMes          = new Date().getMonth();
let _concAno          = new Date().getFullYear();

const MESES_CONC = ['Jan','Fev','Mar','Abr','Mai','Jun',
                    'Jul','Ago','Set','Out','Nov','Dez'];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openConciliacao() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('concModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  await _concCarregarContas();
  _concAtualizarLabels();
}

function closeConciliacao() {
  document.getElementById('concModal').style.display = 'none';
  document.body.style.overflow = '';
  _concExtrato = [];
  _concLancamentos = [];
  _concContaId = null;
}

// ── Contas bancárias ──────────────────────────────────────────
async function _concCarregarContas() {
  const { data } = await sb
    .from('contas_bancarias')
    .select('id, banco, agencia, conta, tipo, descricao')
    .eq('cliente_id', currentCliente.id)
    .eq('ativo', true)
    .order('banco');

  _concContas = data || [];
  _concRenderContas();
}

function _concRenderContas() {
  const sel = document.getElementById('concSelConta');
  if (!sel) return;

  if (!_concContas.length) {
    sel.innerHTML = '<option value="">-- Nenhuma conta cadastrada --</option>';
    document.getElementById('concBtnNovaConta').style.display = '';
    return;
  }

  sel.innerHTML = '<option value="">Selecione uma conta...</option>' +
    _concContas.map(c =>
      `<option value="${c.id}">${escapeHtml(c.banco)} — Ag ${c.agencia || '—'} / C ${c.conta}${c.descricao ? ' (' + escapeHtml(c.descricao) + ')' : ''}</option>`
    ).join('');
}

async function concSelecionarConta() {
  _concContaId = document.getElementById('concSelConta').value || null;
  if (_concContaId) await concCarregar();
}

// ── Nova conta bancária ───────────────────────────────────────
function concAbrirFormConta() {
  document.getElementById('concFormContaPanel').style.display = '';
  document.getElementById('concFormContaPanel').scrollIntoView({ behavior: 'smooth' });
}

function concFecharFormConta() {
  document.getElementById('concFormContaPanel').style.display = 'none';
  ['concFcBanco','concFcAgencia','concFcConta','concFcDescricao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function concSalvarConta() {
  const banco     = document.getElementById('concFcBanco').value.trim();
  const agencia   = document.getElementById('concFcAgencia').value.trim();
  const conta     = document.getElementById('concFcConta').value.trim();
  const tipo      = document.getElementById('concFcTipo').value;
  const descricao = document.getElementById('concFcDescricao').value.trim();

  if (!banco || !conta) { showToast('Banco e conta são obrigatórios.', 'warn'); return; }

  const _escId = await getEscritorioIdAtual();
  const { data, error } = await sb.from('contas_bancarias').insert({
    user_id:       currentUser.id,
    cliente_id:    currentCliente.id,
    escritorio_id: _escId,
    banco, agencia, conta, tipo, descricao: descricao || null,
  }).select('id').single();

  if (error) { showToast('Erro ao salvar conta: ' + error.message, 'error'); return; }

  showToast('Conta bancária cadastrada!', 'success');
  concFecharFormConta();
  await _concCarregarContas();
  // Selecionar a conta recém criada
  document.getElementById('concSelConta').value = data.id;
  _concContaId = data.id;
  await concCarregar();
}

// ── Carregar extrato e lançamentos do mês ────────────────────
async function concCarregar() {
  if (!_concContaId) return;

  const elRes = document.getElementById('concResultado');
  if (elRes) elRes.innerHTML = '<div class="dp-loading"><div class="dp-spin"></div> Carregando...</div>';

  const compIni = `${_concAno}-${String(_concMes + 1).padStart(2, '0')}-01`;
  const compFim = `${_concAno}-${String(_concMes + 1).padStart(2, '0')}-31`;
  const comp    = `${_concAno}-${String(_concMes + 1).padStart(2, '0')}`;

  // Carregar extrato e lançamentos em paralelo
  const [{ data: extrato }, { data: lancs }] = await Promise.all([
    sb.from('extratos_bancarios')
      .select('*')
      .eq('conta_id', _concContaId)
      .gte('data_extrato', compIni)
      .lte('data_extrato', compFim)
      .order('data_extrato'),
    sb.from('lancamentos_contabeis')
      .select('id, data_lanc, historico, valor, debito:debito_id(codigo,descricao), credito:credito_id(codigo,descricao)')
      .eq('cliente_id', currentCliente.id)
      .eq('user_id', currentUser.id)
      .eq('competencia', comp)
      .eq('estornado', false)
      .order('data_lanc'),
  ]);

  _concExtrato     = extrato || [];
  _concLancamentos = lancs   || [];

  _concRenderResultado();
}

// ── Render resultado ──────────────────────────────────────────
function _concRenderResultado() {
  const el = document.getElementById('concResultado');
  if (!el) return;

  const totalExtrato  = _concExtrato.reduce((s, e) => s + +e.valor, 0);
  const naoConc       = _concExtrato.filter(e => !e.conciliado).length;
  const conciliados   = _concExtrato.filter(e => e.conciliado).length;

  // KPIs
  document.getElementById('concKpiExtrato').textContent    = _concExtrato.length;
  document.getElementById('concKpiConciliado').textContent = conciliados;
  document.getElementById('concKpiPendente').textContent   = naoConc;
  document.getElementById('concKpiSaldo').textContent      = _concFmt(totalExtrato);
  document.getElementById('concKpiSaldo').style.color      = totalExtrato >= 0 ? '#16a34a' : '#dc2626';

  if (!_concExtrato.length && !_concLancamentos.length) {
    el.innerHTML = `
      <div class="dp-empty" style="padding:30px 0">
        <i data-lucide="inbox" style="width:36px;height:36px;opacity:.25;display:block;margin:0 auto 12px"></i>
        <p>Nenhum dado para o período. Importe um extrato ou registre lançamentos.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Duas colunas: extrato | lançamentos
  const linhasExtrato = _concExtrato.map(e => {
    const data  = new Date(e.data_extrato + 'T12:00').toLocaleDateString('pt-BR');
    const cor   = +e.valor >= 0 ? '#16a34a' : '#dc2626';
    const conc  = e.conciliado;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);${conc ? 'opacity:.5' : ''}">
        <div style="width:8px;height:8px;border-radius:50%;background:${conc ? '#16a34a' : '#f59e0b'};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.descricao)}</div>
          <div style="font-size:10px;color:var(--text-light)">${data}</div>
        </div>
        <div style="font-size:12px;font-weight:600;color:${cor};white-space:nowrap">${+e.valor >= 0 ? '+' : ''}${_concFmt(+e.valor)}</div>
        ${!conc ? `<button onclick="concConciliar('${e.id}')" title="Marcar como conciliado"
          style="background:none;border:none;cursor:pointer;padding:2px;color:#16a34a">
          <i data-lucide="check-circle" style="width:14px;height:14px"></i>
        </button>` : `<i data-lucide="check-circle" style="width:14px;height:14px;color:#16a34a"></i>`}
      </div>`;
  }).join('') || '<p style="font-size:12px;color:var(--text-light);text-align:center;padding:16px">Nenhuma linha importada</p>';

  const linhasLanc = _concLancamentos.map(l => {
    const data = new Date(l.data_lanc + 'T12:00').toLocaleDateString('pt-BR');
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.historico)}</div>
          <div style="font-size:10px;color:var(--text-light)">
            D: ${l.debito?.codigo || '—'} / C: ${l.credito?.codigo || '—'} · ${data}
          </div>
        </div>
        <div style="font-size:12px;font-weight:600;white-space:nowrap">R$ ${_concFmt(+l.valor)}</div>
      </div>`;
  }).join('') || '<p style="font-size:12px;color:var(--text-light);text-align:center;padding:16px">Nenhum lançamento no período</p>';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid var(--border)">
          Extrato Bancário (${_concExtrato.length})
        </div>
        <div style="max-height:380px;overflow-y:auto">${linhasExtrato}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid var(--border)">
          Lançamentos Contábeis (${_concLancamentos.length})
        </div>
        <div style="max-height:380px;overflow-y:auto">${linhasLanc}</div>
      </div>
    </div>`;

  if (window.lucide) lucide.createIcons();
}

// ── Conciliar item ────────────────────────────────────────────
async function concConciliar(extratoId) {
  const { error } = await sb.from('extratos_bancarios')
    .update({ conciliado: true })
    .eq('id', extratoId);
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  const item = _concExtrato.find(e => e.id === extratoId);
  if (item) item.conciliado = true;
  _concRenderResultado();
}

// ── Importar extrato CSV ──────────────────────────────────────
function concAbrirImport() {
  document.getElementById('concImportInput').click();
}

async function concImportarCSV(event) {
  if (!_concContaId) { showToast('Selecione uma conta bancária primeiro.', 'warn'); return; }
  const file = event.target.files[0];
  if (!file) return;

  const texto = await file.text();
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());

  // Detectar separador
  const sep = linhas[0]?.includes(';') ? ';' : ',';

  // Pular cabeçalho se tiver texto não numérico na primeira coluna
  const inicio = isNaN(Date.parse(linhas[0]?.split(sep)[0])) ? 1 : 0;
  const dados = linhas.slice(inicio);

  const _escId = await getEscritorioIdAtual();
  let importados = 0, erros = 0;

  for (const linha of dados) {
    const cols = linha.split(sep).map(c => c.replace(/"/g, '').trim());
    if (cols.length < 3) continue;

    // Formato esperado: data | descrição | valor
    const [dataRaw, descricao, valorRaw] = cols;
    const valor = parseFloat(valorRaw?.replace(',', '.')) || 0;
    if (!dataRaw || !descricao || valor === 0) continue;

    // Aceitar datas DD/MM/YYYY ou YYYY-MM-DD
    let dataISO = dataRaw;
    if (dataRaw.includes('/')) {
      const [d, m, a] = dataRaw.split('/');
      dataISO = `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }

    const { error } = await sb.from('extratos_bancarios').insert({
      user_id:      currentUser.id,
      cliente_id:   currentCliente.id,
      escritorio_id: _escId,
      conta_id:     _concContaId,
      data_extrato: dataISO,
      descricao,
      valor,
      tipo:         valor >= 0 ? 'credito' : 'debito',
      conciliado:   false,
    });

    if (error) erros++; else importados++;
  }

  event.target.value = '';
  showToast(`${importados} linha(s) importada(s)${erros ? ', ' + erros + ' com erro' : ''}.`, 'success');
  await concCarregar();
}

// ── Navegação de mês ──────────────────────────────────────────
async function concNavMes(delta) {
  _concMes += delta;
  if (_concMes > 11) { _concMes = 0;  _concAno++; }
  if (_concMes < 0)  { _concMes = 11; _concAno--; }
  _concAtualizarLabels();
  if (_concContaId) await concCarregar();
}

function _concAtualizarLabels() {
  const el = document.getElementById('concMesLabel');
  if (el) el.textContent = `${MESES_CONC[_concMes]}/${_concAno}`;
}

// ── Helper ────────────────────────────────────────────────────
function _concFmt(v) {
  return (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
