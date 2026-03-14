// ============================================================
// LANCAMENTOS_CONTABEIS.JS — Módulo 2 dos Módulos Contábeis
// Diário contábil — débito/crédito no plano de contas
// Depende: plano_contas.js (pcContas), core.js, sb
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _lcLancamentos  = [];
let _lcEditandoId   = null;
let _lcFiltroMes    = new Date().getMonth();
let _lcFiltroAno    = new Date().getFullYear();
let _lcContasCache  = [];  // plano de contas do cliente atual

const MESES_LC = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openLancamentosContabeis() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('lcModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _lcEditandoId = null;
  await _lcCarregarContas();
  await lcCarregar();
}

function closeLancamentosContabeis() {
  document.getElementById('lcModal').style.display = 'none';
  document.body.style.overflow = '';
  _lcLancamentos = [];
  _lcContasCache = [];
}

// ── Carregar plano de contas (para os selects) ────────────────
async function _lcCarregarContas() {
  const { data } = await sb
    .from('plano_contas')
    .select('id, codigo, descricao, tipo, natureza, grau')
    .eq('cliente_id', currentCliente.id)
    .eq('ativo', true)
    .order('codigo');
  _lcContasCache = data || [];

  // Preencher selects de débito e crédito
  const opts = _lcContasCache
    .filter(c => c.grau === 'analitica')
    .map(c => `<option value="${c.id}">[${escapeHtml(c.codigo)}] ${escapeHtml(c.descricao)}</option>`)
    .join('');

  const semContas = `<option value="">-- Sem contas analíticas no plano --</option>`;
  ['lcFormDebito', 'lcFormCredito'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts || semContas;
  });
}

// ── Carregar lançamentos do mês ───────────────────────────────
async function lcCarregar() {
  lcRenderLoading();
  _lcAtualizarMesLabel();

  const compStr = `${_lcFiltroAno}-${String(_lcFiltroMes + 1).padStart(2, '0')}`;

  const { data, error } = await sb
    .from('lancamentos_contabeis')
    .select(`
      *,
      debito:debito_id(codigo, descricao, natureza),
      credito:credito_id(codigo, descricao, natureza)
    `)
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .eq('competencia', compStr)
    .eq('estornado', false)
    .order('data_lanc')
    .order('numero');

  if (error) {
    showToast('Erro ao carregar lançamentos: ' + error.message, 'error');
    return;
  }

  _lcLancamentos = data || [];
  lcRender();
}

function _lcAtualizarMesLabel() {
  const el = document.getElementById('lcMesLabel');
  if (el) el.textContent = `${MESES_LC[_lcFiltroMes]} ${_lcFiltroAno}`;
}

// ── Render ────────────────────────────────────────────────────
function lcRenderLoading() {
  const el = document.getElementById('lcLista');
  if (el) el.innerHTML = '<div class="dp-loading"><div class="dp-spin"></div> Carregando...</div>';
}

function lcRender() {
  const el = document.getElementById('lcLista');
  if (!el) return;

  // KPIs
  const totalDebitos  = _lcLancamentos.reduce((s, l) => s + (+l.valor || 0), 0);
  const totalCreditos = totalDebitos; // débitos = créditos por definição contábil
  document.getElementById('lcKpiLancamentos').textContent = _lcLancamentos.length;
  document.getElementById('lcKpiDebitos').textContent     = _lcFmtBRL(totalDebitos);
  document.getElementById('lcKpiCreditos').textContent    = _lcFmtBRL(totalCreditos);

  if (!_lcLancamentos.length) {
    const semPC = _lcContasCache.length === 0;
    el.innerHTML = `
      <div class="dp-empty" style="padding:40px 0">
        <i data-lucide="book" style="width:36px;height:36px;opacity:.25;display:block;margin:0 auto 12px"></i>
        <p>${semPC
          ? 'Plano de contas vazio. <a href="#" onclick="closeLancamentosContabeis();openPlanoConta()" style="color:var(--accent)">Configure o plano de contas</a> antes de lançar.'
          : 'Nenhum lançamento em ' + MESES_LC[_lcFiltroMes] + '/' + _lcFiltroAno + '.'
        }</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:var(--sidebar-hover);color:var(--text-light);text-transform:uppercase;font-size:10px;letter-spacing:.4px">
          <th style="padding:8px 10px;text-align:left;font-weight:600">Nº</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Data</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Histórico</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Débito</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600">Crédito</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600">Valor</th>
          <th style="padding:8px 10px;text-align:center;font-weight:600">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${_lcLancamentos.map(l => _lcRenderLinha(l)).join('')}
      </tbody>
    </table>`;

  if (window.lucide) lucide.createIcons();
}

function _lcRenderLinha(l) {
  const data  = l.data_lanc ? new Date(l.data_lanc + 'T12:00').toLocaleDateString('pt-BR') : '—';
  const deb   = l.debito  ? `${l.debito.codigo} — ${l.debito.descricao}`   : '—';
  const cred  = l.credito ? `${l.credito.codigo} — ${l.credito.descricao}` : '—';
  const orig  = l.origem && l.origem !== 'manual'
    ? `<span style="font-size:10px;background:var(--sidebar-hover);padding:1px 5px;border-radius:4px;margin-left:4px">${escapeHtml(l.origem)}</span>`
    : '';

  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;color:var(--text-light)">${l.numero || '—'}</td>
      <td style="padding:8px 10px;white-space:nowrap">${data}</td>
      <td style="padding:8px 10px;max-width:200px">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(l.historico)}">
          ${escapeHtml(l.historico)}${orig}
        </div>
      </td>
      <td style="padding:8px 10px;color:#2563eb;font-size:11px;max-width:150px">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(deb)}">${escapeHtml(deb)}</div>
      </td>
      <td style="padding:8px 10px;color:#16a34a;font-size:11px;max-width:150px">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(cred)}">${escapeHtml(cred)}</div>
      </td>
      <td style="padding:8px 10px;text-align:right;font-weight:600">R$ ${_lcFmtBRL(+l.valor)}</td>
      <td style="padding:8px 10px;text-align:center">
        <div style="display:flex;gap:4px;justify-content:center">
          ${l.origem === 'manual' || !l.origem ? `
          <button onclick="lcEditar('${l.id}')" title="Editar"
            style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text-light)">
            <i data-lucide="pencil" style="width:13px;height:13px"></i>
          </button>` : ''}
          <button onclick="lcEstornar('${l.id}')" title="Estornar"
            style="background:none;border:none;cursor:pointer;padding:3px;color:#d97706">
            <i data-lucide="rotate-ccw" style="width:13px;height:13px"></i>
          </button>
          <button onclick="lcExcluir('${l.id}')" title="Excluir"
            style="background:none;border:none;cursor:pointer;padding:3px;color:#dc2626">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
      </td>
    </tr>`;
}

// ── Navegação de mês ──────────────────────────────────────────
async function lcNavMes(delta) {
  _lcFiltroMes += delta;
  if (_lcFiltroMes > 11) { _lcFiltroMes = 0;  _lcFiltroAno++; }
  if (_lcFiltroMes < 0)  { _lcFiltroMes = 11; _lcFiltroAno--; }
  await lcCarregar();
}

// ── Formulário ────────────────────────────────────────────────
function lcNovoForm() {
  if (_lcContasCache.filter(c => c.grau === 'analitica').length === 0) {
    showToast('Cadastre contas analíticas no Plano de Contas antes de lançar.', 'warn');
    return;
  }
  _lcEditandoId = null;
  document.getElementById('lcFormTitulo').textContent = 'Novo Lançamento';
  document.getElementById('lcFormId').value       = '';
  document.getElementById('lcFormData').value     = new Date().toISOString().slice(0, 10);
  document.getElementById('lcFormHistorico').value = '';
  document.getElementById('lcFormValor').value    = '';
  document.getElementById('lcFormDebito').selectedIndex  = 0;
  document.getElementById('lcFormCredito').selectedIndex = 0;
  document.getElementById('lcFormPanel').style.display   = '';
  document.getElementById('lcFormPanel').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('lcFormHistorico').focus();
}

function lcFecharForm() {
  document.getElementById('lcFormPanel').style.display = 'none';
  _lcEditandoId = null;
}

function lcEditar(id) {
  const l = _lcLancamentos.find(x => x.id === id);
  if (!l) return;
  _lcEditandoId = id;
  document.getElementById('lcFormTitulo').textContent    = 'Editar Lançamento';
  document.getElementById('lcFormId').value              = l.id;
  document.getElementById('lcFormData').value            = l.data_lanc || '';
  document.getElementById('lcFormHistorico').value       = l.historico || '';
  document.getElementById('lcFormValor').value           = l.valor || '';
  document.getElementById('lcFormDebito').value          = l.debito_id || '';
  document.getElementById('lcFormCredito').value         = l.credito_id || '';
  document.getElementById('lcFormPanel').style.display   = '';
  document.getElementById('lcFormPanel').scrollIntoView({ behavior: 'smooth' });
}

// ── Salvar ────────────────────────────────────────────────────
async function lcSalvar() {
  const data_lanc  = document.getElementById('lcFormData').value;
  const historico  = document.getElementById('lcFormHistorico').value.trim();
  const valor      = parseFloat(document.getElementById('lcFormValor').value);
  const debito_id  = document.getElementById('lcFormDebito').value;
  const credito_id = document.getElementById('lcFormCredito').value;

  if (!data_lanc)   { showToast('Informe a data.', 'warn'); return; }
  if (!historico)   { showToast('Informe o histórico.', 'warn'); return; }
  if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'warn'); return; }
  if (!debito_id)   { showToast('Selecione a conta de débito.', 'warn'); return; }
  if (!credito_id)  { showToast('Selecione a conta de crédito.', 'warn'); return; }
  if (debito_id === credito_id) { showToast('Débito e crédito não podem ser a mesma conta.', 'warn'); return; }

  const btn = document.getElementById('lcSalvarBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const competencia = `${_lcFiltroAno}-${String(_lcFiltroMes + 1).padStart(2, '0')}`;
  const _escId = await getEscritorioIdAtual();

  const payload = {
    user_id:       currentUser.id,
    cliente_id:    currentCliente.id,
    escritorio_id: _escId,
    data_lanc,
    historico,
    valor,
    debito_id,
    credito_id,
    competencia,
    origem:        'manual',
    estornado:     false,
  };

  let error;
  if (_lcEditandoId) {
    ({ error } = await sb.from('lancamentos_contabeis')
      .update(payload).eq('id', _lcEditandoId).eq('user_id', currentUser.id));
  } else {
    ({ error } = await sb.from('lancamentos_contabeis').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return; }
  showToast(_lcEditandoId ? 'Lançamento atualizado.' : 'Lançamento registrado.', 'success');
  lcFecharForm();
  await lcCarregar();
}

// ── Estornar ──────────────────────────────────────────────────
async function lcEstornar(id) {
  const l = _lcLancamentos.find(x => x.id === id);
  if (!l) return;
  const ok = await showConfirm(
    `Estornar lançamento Nº${l.numero || id.slice(0,8)}?\nUm lançamento inverso será criado.`
  );
  if (!ok) return;

  const _escId = await getEscritorioIdAtual();
  const competencia = `${_lcFiltroAno}-${String(_lcFiltroMes + 1).padStart(2, '0')}`;

  // Marcar original como estornado + criar lançamento inverso
  const { error: e1 } = await sb.from('lancamentos_contabeis')
    .update({ estornado: true }).eq('id', id).eq('user_id', currentUser.id);
  if (e1) { showToast('Erro ao estornar: ' + e1.message, 'error'); return; }

  const { error: e2 } = await sb.from('lancamentos_contabeis').insert({
    user_id:       currentUser.id,
    cliente_id:    currentCliente.id,
    escritorio_id: _escId,
    data_lanc:     new Date().toISOString().slice(0, 10),
    historico:     `ESTORNO — ${l.historico}`,
    valor:         l.valor,
    debito_id:     l.credito_id,   // invertido
    credito_id:    l.debito_id,    // invertido
    competencia,
    origem:        'manual',
    estorno_de:    id,
    estornado:     false,
  });
  if (e2) { showToast('Lançamento estornado mas erro ao criar contrapartida: ' + e2.message, 'warn'); }
  else showToast('Estorno realizado.', 'success');

  await lcCarregar();
}

// ── Excluir ───────────────────────────────────────────────────
async function lcExcluir(id) {
  const l = _lcLancamentos.find(x => x.id === id);
  const ok = await showConfirm(`Excluir o lançamento "${l?.historico || ''}"?`);
  if (!ok) return;
  const { error } = await sb.from('lancamentos_contabeis')
    .delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return; }
  showToast('Lançamento excluído.', 'success');
  await lcCarregar();
}

// ── Exportar CSV ──────────────────────────────────────────────
function lcExportarCSV() {
  if (!_lcLancamentos.length) { showToast('Nenhum lançamento para exportar.', 'warn'); return; }

  const header = ['Nº', 'Data', 'Histórico', 'Débito Cód', 'Débito Conta', 'Crédito Cód', 'Crédito Conta', 'Valor', 'Origem'];
  const rows = _lcLancamentos.map(l => [
    l.numero || '',
    l.data_lanc || '',
    l.historico || '',
    l.debito?.codigo || '',
    l.debito?.descricao || '',
    l.credito?.codigo || '',
    l.credito?.descricao || '',
    +l.valor || 0,
    l.origem || 'manual',
  ]);

  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv),
    download: `lancamentos-${currentCliente.cnpj || 'empresa'}-${_lcFiltroAno}-${String(_lcFiltroMes+1).padStart(2,'0')}.csv`,
  });
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}

// ── Helper ────────────────────────────────────────────────────
function _lcFmtBRL(v) {
  return (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
