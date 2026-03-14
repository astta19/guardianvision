// ============================================================
// PLANO_CONTAS.JS — Módulo 1 dos Módulos Contábeis
// Gerencia a estrutura hierárquica de contas por cliente
// Depende: core.js (currentUser, currentCliente, sb, showToast, showConfirm)
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _pcContas      = [];   // lista plana carregada do banco
let _pcEditandoId  = null; // id em edição, null = novo
let _pcFiltro      = '';   // filtro de busca

// Grupos para organizar a exibição e geração de códigos
const PC_TIPOS = [
  { id: 'ativo',    label: 'Ativo',             natureza: 'devedora', cor: '#2563eb' },
  { id: 'passivo',  label: 'Passivo',            natureza: 'credora',  cor: '#dc2626' },
  { id: 'pl',       label: 'Patrimônio Líquido', natureza: 'credora',  cor: '#7c3aed' },
  { id: 'receita',  label: 'Receitas',           natureza: 'credora',  cor: '#16a34a' },
  { id: 'despesa',  label: 'Despesas',           natureza: 'devedora', cor: '#d97706' },
  { id: 'custo',    label: 'Custos',             natureza: 'devedora', cor: '#ea580c' },
];

// Plano padrão simplificado — importável em 1 clique
const PC_PADRAO = [
  // ATIVO
  { codigo:'1',       descricao:'ATIVO',                          tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:1 },
  { codigo:'1.1',     descricao:'ATIVO CIRCULANTE',               tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'1.1.01',  descricao:'Caixa e Equivalentes de Caixa',  tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:3 },
  { codigo:'1.1.01.001', descricao:'Caixa',                       tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.1.01.002', descricao:'Banco Conta Movimento',       tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.1.02',  descricao:'Contas a Receber',               tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:3 },
  { codigo:'1.1.02.001', descricao:'Clientes',                    tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.1.03',  descricao:'Estoques',                       tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:3 },
  { codigo:'1.1.03.001', descricao:'Mercadorias para Revenda',    tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.1.04',  descricao:'Impostos a Recuperar',           tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:3 },
  { codigo:'1.1.04.001', descricao:'ICMS a Recuperar',            tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.1.04.002', descricao:'PIS/COFINS a Recuperar',      tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.2',     descricao:'ATIVO NÃO CIRCULANTE',           tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'1.2.01',  descricao:'Imobilizado',                    tipo:'ativo',   natureza:'devedora', grau:'sintetica', nivel:3 },
  { codigo:'1.2.01.001', descricao:'Móveis e Utensílios',         tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.2.01.002', descricao:'Equipamentos de Informática', tipo:'ativo',   natureza:'devedora', grau:'analitica', nivel:4 },
  { codigo:'1.2.01.900', descricao:'(-) Depreciação Acumulada',   tipo:'ativo',   natureza:'credora',  grau:'analitica', nivel:4 },
  // PASSIVO
  { codigo:'2',       descricao:'PASSIVO',                        tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:1 },
  { codigo:'2.1',     descricao:'PASSIVO CIRCULANTE',             tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'2.1.01',  descricao:'Fornecedores',                   tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:3 },
  { codigo:'2.1.01.001', descricao:'Fornecedores Nacionais',      tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02',  descricao:'Obrigações Fiscais',             tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:3 },
  { codigo:'2.1.02.001', descricao:'ICMS a Recolher',             tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02.002', descricao:'DAS a Recolher',              tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02.003', descricao:'IRPJ a Recolher',             tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02.004', descricao:'CSLL a Recolher',             tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02.005', descricao:'PIS a Recolher',              tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.02.006', descricao:'COFINS a Recolher',           tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.03',  descricao:'Obrigações Trabalhistas',        tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:3 },
  { codigo:'2.1.03.001', descricao:'Salários a Pagar',            tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.03.002', descricao:'INSS a Recolher',             tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.1.03.003', descricao:'FGTS a Recolher',             tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  { codigo:'2.2',     descricao:'PASSIVO NÃO CIRCULANTE',         tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'2.2.01',  descricao:'Empréstimos e Financiamentos',   tipo:'passivo', natureza:'credora',  grau:'sintetica', nivel:3 },
  { codigo:'2.2.01.001', descricao:'Empréstimos Bancários LP',    tipo:'passivo', natureza:'credora',  grau:'analitica', nivel:4 },
  // PATRIMÔNIO LÍQUIDO
  { codigo:'3',       descricao:'PATRIMÔNIO LÍQUIDO',             tipo:'pl',      natureza:'credora',  grau:'sintetica', nivel:1 },
  { codigo:'3.1',     descricao:'Capital Social',                 tipo:'pl',      natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'3.1.001', descricao:'Capital Subscrito',              tipo:'pl',      natureza:'credora',  grau:'analitica', nivel:3 },
  { codigo:'3.2',     descricao:'Reservas',                       tipo:'pl',      natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'3.2.001', descricao:'Reserva Legal',                  tipo:'pl',      natureza:'credora',  grau:'analitica', nivel:3 },
  { codigo:'3.3',     descricao:'Lucros/Prejuízos Acumulados',    tipo:'pl',      natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'3.3.001', descricao:'Lucros Acumulados',              tipo:'pl',      natureza:'credora',  grau:'analitica', nivel:3 },
  // RECEITAS
  { codigo:'4',       descricao:'RECEITAS',                       tipo:'receita', natureza:'credora',  grau:'sintetica', nivel:1 },
  { codigo:'4.1',     descricao:'Receita Operacional Bruta',      tipo:'receita', natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'4.1.001', descricao:'Venda de Mercadorias',           tipo:'receita', natureza:'credora',  grau:'analitica', nivel:3 },
  { codigo:'4.1.002', descricao:'Prestação de Serviços',          tipo:'receita', natureza:'credora',  grau:'analitica', nivel:3 },
  { codigo:'4.2',     descricao:'(-) Deduções da Receita',        tipo:'receita', natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'4.2.001', descricao:'Devoluções e Abatimentos',       tipo:'receita', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'4.2.002', descricao:'Impostos sobre Vendas',          tipo:'receita', natureza:'devedora', grau:'analitica', nivel:3 },
  // CUSTOS
  { codigo:'5',       descricao:'CUSTOS',                         tipo:'custo',   natureza:'devedora', grau:'sintetica', nivel:1 },
  { codigo:'5.1',     descricao:'Custo das Mercadorias Vendidas',  tipo:'custo',  natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'5.1.001', descricao:'CMV — Mercadorias',              tipo:'custo',   natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'5.2',     descricao:'Custo dos Serviços Prestados',   tipo:'custo',   natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'5.2.001', descricao:'Mão de Obra Direta',             tipo:'custo',   natureza:'devedora', grau:'analitica', nivel:3 },
  // DESPESAS
  { codigo:'6',       descricao:'DESPESAS',                       tipo:'despesa', natureza:'devedora', grau:'sintetica', nivel:1 },
  { codigo:'6.1',     descricao:'Despesas Administrativas',       tipo:'despesa', natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'6.1.001', descricao:'Salários e Encargos',            tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.002', descricao:'Aluguel',                        tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.003', descricao:'Energia Elétrica',               tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.004', descricao:'Telefone e Internet',            tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.005', descricao:'Material de Escritório',         tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.006', descricao:'Honorários Contábeis',           tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.1.007', descricao:'Depreciação',                    tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.2',     descricao:'Despesas Financeiras',           tipo:'despesa', natureza:'devedora', grau:'sintetica', nivel:2 },
  { codigo:'6.2.001', descricao:'Juros e IOF',                    tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.2.002', descricao:'Tarifas Bancárias',              tipo:'despesa', natureza:'devedora', grau:'analitica', nivel:3 },
  { codigo:'6.3',     descricao:'Receitas Financeiras',           tipo:'despesa', natureza:'credora',  grau:'sintetica', nivel:2 },
  { codigo:'6.3.001', descricao:'Rendimento de Aplicações',       tipo:'despesa', natureza:'credora',  grau:'analitica', nivel:3 },
];

// ── Abrir / Fechar ────────────────────────────────────────────
async function openPlanoConta() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  closeDropdowns();
  document.getElementById('pcModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _pcEditandoId = null;
  _pcFiltro = '';
  document.getElementById('pcFiltro').value = '';
  await pcCarregar();
}

function closePlanoConta() {
  document.getElementById('pcModal').style.display = 'none';
  document.body.style.overflow = '';
  _pcContas = [];
}

// ── Carregar ──────────────────────────────────────────────────
async function pcCarregar() {
  pcRenderLoading();
  const { data, error } = await sb
    .from('plano_contas')
    .select('*')
    .eq('cliente_id', currentCliente.id)
    .order('codigo');

  if (error) { showToast('Erro ao carregar plano de contas: ' + error.message, 'error'); return; }
  _pcContas = data || [];
  pcRender();
}

// ── Render ────────────────────────────────────────────────────
function pcRenderLoading() {
  document.getElementById('pcLista').innerHTML =
    '<div class="dp-loading"><div class="dp-spin"></div> Carregando...</div>';
}

function pcRender() {
  const el = document.getElementById('pcLista');
  const filtro = _pcFiltro.toLowerCase();

  // Filtrar
  const contas = filtro
    ? _pcContas.filter(c =>
        c.codigo.toLowerCase().includes(filtro) ||
        c.descricao.toLowerCase().includes(filtro))
    : _pcContas;

  // KPIs
  const analiticas  = _pcContas.filter(c => c.grau === 'analitica').length;
  const sinteticas  = _pcContas.filter(c => c.grau === 'sintetica').length;
  document.getElementById('pcKpiTotal').textContent    = _pcContas.length;
  document.getElementById('pcKpiAnalitica').textContent = analiticas;
  document.getElementById('pcKpiSintetica').textContent = sinteticas;

  if (!contas.length) {
    el.innerHTML = `<div class="dp-empty" style="padding:40px 0">
      <i data-lucide="book-open" style="width:36px;height:36px;opacity:.25;display:block;margin:0 auto 12px"></i>
      ${_pcContas.length === 0
        ? `<p>Nenhuma conta cadastrada.</p>
           <button class="dp-btn-pri" style="margin-top:12px" onclick="pcImportarPadrao()">
             <i data-lucide="download" style="width:13px;height:13px"></i> Importar Plano Padrão
           </button>`
        : '<p>Nenhuma conta encontrada para este filtro.</p>'}
    </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Agrupar por tipo para exibição hierárquica
  const porTipo = {};
  contas.forEach(c => {
    if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
    porTipo[c.tipo].push(c);
  });

  const corTipo = tipo => PC_TIPOS.find(t => t.id === tipo)?.cor || '#64748b';

  el.innerHTML = PC_TIPOS
    .filter(t => porTipo[t.id]?.length)
    .map(t => {
      const contas = porTipo[t.id];
      const cor = t.cor;
      return `
        <div class="pc-grupo" style="margin-bottom:12px">
          <div class="pc-grupo-header" style="background:${cor}12;border-left:3px solid ${cor};padding:6px 12px;border-radius:0 6px 6px 0;display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:11px;font-weight:700;color:${cor};text-transform:uppercase;letter-spacing:.5px">${t.label}</span>
            <span style="font-size:10px;color:var(--text-light)">${contas.length} conta(s)</span>
          </div>
          ${contas.map(c => pcRenderConta(c, cor)).join('')}
        </div>`;
    }).join('');

  if (window.lucide) lucide.createIcons();
}

function pcRenderConta(c, cor) {
  const indent = (c.nivel - 1) * 16;
  const isAnalitica = c.grau === 'analitica';
  return `
    <div class="pc-item ${!c.ativo ? 'pc-item-inativo' : ''}"
         style="padding:7px 12px 7px ${12 + indent}px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);cursor:pointer"
         onclick="pcEditar('${c.id}')">
      <div style="width:8px;height:8px;border-radius:50%;background:${isAnalitica ? cor : 'transparent'};border:2px solid ${cor};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;font-weight:600;font-family:monospace;color:var(--text-light)">${escapeHtml(c.codigo)}</span>
          <span style="font-size:13px;${isAnalitica ? 'font-weight:500' : 'color:var(--text-light)'}">${escapeHtml(c.descricao)}</span>
          ${!c.ativo ? '<span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:1px 5px;border-radius:4px">Inativa</span>' : ''}
        </div>
        <div style="font-size:10px;color:var(--text-light);margin-top:1px">
          ${c.grau === 'analitica' ? 'Analítica' : 'Sintética'} · Natureza ${c.natureza}
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button onclick="event.stopPropagation();pcEditar('${c.id}')"
          style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text-light)">
          <i data-lucide="pencil" style="width:13px;height:13px"></i>
        </button>
        <button onclick="event.stopPropagation();pcExcluir('${c.id}')"
          style="background:none;border:none;cursor:pointer;padding:3px;color:var(--text-light)">
          <i data-lucide="trash-2" style="width:13px;height:13px"></i>
        </button>
      </div>
    </div>`;
}

// ── Formulário ────────────────────────────────────────────────
function pcNovoForm() {
  _pcEditandoId = null;
  document.getElementById('pcFormTitulo').textContent = 'Nova Conta';
  document.getElementById('pcFormId').value = '';
  document.getElementById('pcFormCodigo').value = '';
  document.getElementById('pcFormDescricao').value = '';
  document.getElementById('pcFormTipo').value = 'ativo';
  pcAtualizarNatureza();
  document.getElementById('pcFormGrau').value = 'analitica';
  document.getElementById('pcFormAtivo').checked = true;
  document.getElementById('pcFormPanel').style.display = '';
  document.getElementById('pcFormPanel').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('pcFormCodigo').focus();
}

function pcAtualizarNatureza() {
  const tipo = document.getElementById('pcFormTipo').value;
  const nat = PC_TIPOS.find(t => t.id === tipo)?.natureza || 'devedora';
  document.getElementById('pcFormNatureza').value = nat;
}

function pcEditar(id) {
  const c = _pcContas.find(x => x.id === id);
  if (!c) return;
  _pcEditandoId = id;
  document.getElementById('pcFormTitulo').textContent = 'Editar Conta';
  document.getElementById('pcFormId').value = c.id;
  document.getElementById('pcFormCodigo').value = c.codigo;
  document.getElementById('pcFormDescricao').value = c.descricao;
  document.getElementById('pcFormTipo').value = c.tipo;
  document.getElementById('pcFormNatureza').value = c.natureza;
  document.getElementById('pcFormGrau').value = c.grau;
  document.getElementById('pcFormAtivo').checked = c.ativo !== false;
  document.getElementById('pcFormPanel').style.display = '';
  document.getElementById('pcFormPanel').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('pcFormCodigo').focus();
}

function pcFecharForm() {
  document.getElementById('pcFormPanel').style.display = 'none';
  _pcEditandoId = null;
}

// ── Salvar ────────────────────────────────────────────────────
async function pcSalvar() {
  const codigo    = document.getElementById('pcFormCodigo').value.trim();
  const descricao = document.getElementById('pcFormDescricao').value.trim();
  const tipo      = document.getElementById('pcFormTipo').value;
  const natureza  = document.getElementById('pcFormNatureza').value;
  const grau      = document.getElementById('pcFormGrau').value;
  const ativo     = document.getElementById('pcFormAtivo').checked;

  if (!codigo)    { showToast('Informe o código da conta.', 'warn'); return; }
  if (!descricao) { showToast('Informe a descrição da conta.', 'warn'); return; }

  // Determinar nível pelo número de segmentos do código
  const nivel = codigo.split('.').length;

  // Determinar conta pai pelo código
  const partes = codigo.split('.');
  const codigoPai = partes.length > 1 ? partes.slice(0, -1).join('.') : null;
  const contaPai = codigoPai ? _pcContas.find(c => c.codigo === codigoPai) : null;

  const btn = document.getElementById('pcSalvarBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const _escId = await getEscritorioIdAtual();
  const payload = {
    user_id:      currentUser.id,
    cliente_id:   currentCliente.id,
    escritorio_id: _escId,
    codigo, descricao, tipo, natureza, grau, ativo,
    nivel,
    conta_pai_id: contaPai?.id || null,
  };

  let error;
  if (_pcEditandoId) {
    ({ error } = await sb.from('plano_contas').update(payload)
      .eq('id', _pcEditandoId).eq('user_id', currentUser.id));
  } else {
    ({ error } = await sb.from('plano_contas').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) {
    if (error.code === '23505') showToast('Código já existe neste plano de contas.', 'warn');
    else showToast('Erro ao salvar: ' + error.message, 'error');
    return;
  }

  showToast(_pcEditandoId ? 'Conta atualizada.' : 'Conta criada.', 'success');
  pcFecharForm();
  await pcCarregar();
}

// ── Excluir ───────────────────────────────────────────────────
async function pcExcluir(id) {
  const c = _pcContas.find(x => x.id === id);
  // Verificar se tem filhos
  const temFilhos = _pcContas.some(x => x.conta_pai_id === id);
  if (temFilhos) {
    showToast('Não é possível excluir uma conta com subcontas vinculadas.', 'warn');
    return;
  }
  const ok = await showConfirm(`Excluir a conta ${c?.codigo} — ${c?.descricao}?`);
  if (!ok) return;

  const { error } = await sb.from('plano_contas').delete()
    .eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return; }
  showToast('Conta excluída.', 'success');
  await pcCarregar();
}

// ── Filtro ────────────────────────────────────────────────────
function pcFiltrar(valor) {
  _pcFiltro = valor;
  pcRender();
}

// ── Importar Plano Padrão ─────────────────────────────────────
async function pcImportarPadrao() {
  if (_pcContas.length > 0) {
    const ok = await showConfirm('Já existem contas cadastradas. Importar o plano padrão irá adicionar as contas que ainda não existem. Continuar?');
    if (!ok) return;
  }

  const btn = document.getElementById('pcBtnImportar');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }

  const _escId = await getEscritorioIdAtual();
  let importadas = 0, ignoradas = 0;

  // Criar mapa de códigos existentes
  const codigosExistentes = new Set(_pcContas.map(c => c.codigo));

  // Construir mapa de códigos → ids (para conta_pai_id) durante o import
  const mapaIds = {};
  _pcContas.forEach(c => { mapaIds[c.codigo] = c.id; });

  for (const conta of PC_PADRAO) {
    if (codigosExistentes.has(conta.codigo)) { ignoradas++; continue; }

    const partes = conta.codigo.split('.');
    const codigoPai = partes.length > 1 ? partes.slice(0, -1).join('.') : null;

    const { data, error } = await sb.from('plano_contas').insert({
      user_id:       currentUser.id,
      cliente_id:    currentCliente.id,
      escritorio_id: _escId,
      codigo:        conta.codigo,
      descricao:     conta.descricao,
      tipo:          conta.tipo,
      natureza:      conta.natureza,
      grau:          conta.grau,
      nivel:         conta.nivel,
      conta_pai_id:  codigoPai ? mapaIds[codigoPai] || null : null,
    }).select('id').single();

    if (!error && data) {
      mapaIds[conta.codigo] = data.id;
      importadas++;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Importar Plano Padrão'; }
  showToast(`Importação concluída: ${importadas} conta(s) adicionada(s)${ignoradas ? `, ${ignoradas} já existiam` : ''}.`, 'success');
  await pcCarregar();
}

// ── Exportar CSV ──────────────────────────────────────────────
function pcExportarCSV() {
  if (!_pcContas.length) { showToast('Nenhuma conta para exportar.', 'warn'); return; }

  const header = ['Código', 'Descrição', 'Tipo', 'Natureza', 'Grau', 'Nível', 'Ativo'];
  const rows = _pcContas.map(c => [
    c.codigo, c.descricao, c.tipo, c.natureza, c.grau, c.nivel, c.ativo ? 'Sim' : 'Não'
  ]);

  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv),
    download: `plano-contas-${currentCliente.cnpj || 'empresa'}-${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}
