// ============================================================
// IMPORTACAO.JS — Importação em massa para onboarding
// Abas: Empresas | Funcionários | Plano de Contas |
//       Lançamentos | Honorários
// Acesso: apenas admin/master
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _impAba       = 'empresas';
let _impPreview   = [];  // dados parseados aguardando confirmação
let _impErros     = [];  // erros de validação linha a linha
let _impImportando = false;

// ── Templates CSV ────────────────────────────────────────────
const IMP_TEMPLATES = {
  empresas: {
    headers: ['razao_social','cnpj','nome_fantasia','regime_tributario','inscricao_estadual','honorario_valor','honorario_dia_vencimento'],
    exemplo: [
      'Padaria São José Ltda,12.345.678/0001-90,Padaria São José,Simples Nacional,123456789,350.00,10',
      'Mercado Oliveira ME,98.765.432/0001-01,Mercado Oliveira,MEI,,150.00,5',
    ],
    obrigatorios: ['razao_social','cnpj'],
  },
  funcionarios: {
    headers: ['cnpj_empresa','nome','cpf','cargo','salario_base','data_admissao','tipo_contrato','dependentes','email','telefone'],
    exemplo: [
      '12.345.678/0001-90,Maria Santos,123.456.789-00,Auxiliar Administrativo,1800.00,2024-01-15,clt,1,maria@email.com,(16)99999-9999',
      '12.345.678/0001-90,João Silva,987.654.321-00,Vendedor,2200.00,2023-06-01,clt,0,,',
    ],
    obrigatorios: ['cnpj_empresa','nome','salario_base','data_admissao','tipo_contrato'],
  },
  plano_contas: {
    headers: ['cnpj_empresa','codigo','descricao','tipo','natureza','grau'],
    exemplo: [
      '12.345.678/0001-90,1,ATIVO,patrimonial,devedora,sintetica',
      '12.345.678/0001-90,1.1,CIRCULANTE,patrimonial,devedora,sintetica',
      '12.345.678/0001-90,1.1.1,Caixa,patrimonial,devedora,analitica',
    ],
    obrigatorios: ['cnpj_empresa','codigo','descricao','tipo','natureza','grau'],
  },
  lancamentos: {
    headers: ['cnpj_empresa','data','historico','valor','codigo_debito','codigo_credito','competencia'],
    exemplo: [
      '12.345.678/0001-90,2026-01-15,Pagamento fornecedor,1500.00,1.1.2,2.1.1,2026-01',
      '12.345.678/0001-90,2026-01-20,Recebimento cliente,3000.00,1.1.1,3.1.1,2026-01',
    ],
    obrigatorios: ['cnpj_empresa','data','historico','valor','codigo_debito','codigo_credito','competencia'],
  },
  honorarios: {
    headers: ['cnpj_empresa','competencia','valor','dia_vencimento','descricao','status'],
    exemplo: [
      '12.345.678/0001-90,2026-01,350.00,10,Honorários contábeis Janeiro/2026,pendente',
      '98.765.432/0001-01,2026-01,150.00,5,Honorários contábeis Janeiro/2026,pago',
    ],
    obrigatorios: ['cnpj_empresa','competencia','valor'],
  },
};

const IMP_ABA_LABELS = {
  empresas:     { label: 'Empresas',        icon: 'building-2' },
  funcionarios: { label: 'Funcionários',    icon: 'users' },
  plano_contas: { label: 'Plano de Contas', icon: 'book-open' },
  lancamentos:  { label: 'Lançamentos',     icon: 'pen-line' },
  honorarios:   { label: 'Honorários',      icon: 'receipt' },
};

// ── Abrir modal ───────────────────────────────────────────────
function openImportacao() {
  if (!isAdmin() && !isMaster()) {
    showToast('Acesso restrito a administradores.', 'warn');
    return;
  }
  closeDropdowns();
  let modal = document.getElementById('importacaoModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'importacaoModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5800;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
    modal.onclick = e => { if (e.target === modal) closeImportacao(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = _impRenderModal();
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _impAba = 'empresas';
  _impPreview = [];
  _impErros = [];
  _impRenderAba();
  if (window.lucide) lucide.createIcons({ el: modal });
}

function closeImportacao() {
  const m = document.getElementById('importacaoModal');
  if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}

function _impRenderModal() {
  const abas = Object.entries(IMP_ABA_LABELS).map(([id, info]) => `
    <button class="imp-tab" data-tab="${id}" onclick="impMudarAba('${id}')">
      <i data-lucide="${info.icon}" style="width:14px;height:14px"></i>
      ${info.label}
    </button>`).join('');

  return `
    <div class="imp-modal">
      <div class="imp-header">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text)">Importação em Massa</div>
          <div style="font-size:12px;color:var(--text-light);margin-top:2px">Onboarding de novo escritório</div>
        </div>
        <button onclick="closeImportacao()" style="background:none;border:none;cursor:pointer;color:var(--text-light);padding:6px;border-radius:8px">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>
      <div class="imp-tabs">${abas}</div>
      <div id="impCorpo" class="imp-corpo"></div>
    </div>`;
}

function impMudarAba(aba) {
  _impAba = aba;
  _impPreview = [];
  _impErros = [];
  document.querySelectorAll('.imp-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === aba);
  });
  _impRenderAba();
}

function _impRenderAba() {
  const corpo = document.getElementById('impCorpo');
  if (!corpo) return;
  const tpl = IMP_TEMPLATES[_impAba];
  const info = IMP_ABA_LABELS[_impAba];

  corpo.innerHTML = `
    <div class="imp-instrucoes">
      <div class="imp-instrucoes-title">
        <i data-lucide="${info.icon}" style="width:15px;height:15px;color:var(--accent)"></i>
        Importar ${info.label}
      </div>
      <p>Faça o upload de um arquivo CSV ou Excel com os dados. Campos obrigatórios: <strong>${tpl.obrigatorios.join(', ')}</strong>.</p>
    </div>

    <div class="imp-actions-row">
      <button class="imp-btn-template" onclick="impBaixarTemplate('${_impAba}')">
        <i data-lucide="download" style="width:14px;height:14px"></i>
        Baixar template CSV
      </button>
      <label class="imp-btn-upload">
        <i data-lucide="upload" style="width:14px;height:14px"></i>
        Selecionar arquivo
        <input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="impLerArquivo(event)">
      </label>
    </div>

    <div class="imp-headers-info">
      <div style="font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Colunas esperadas</div>
      <div class="imp-headers-list">
        ${tpl.headers.map(h => `
          <span class="imp-header-tag ${tpl.obrigatorios.includes(h) ? 'required' : ''}">
            ${h}${tpl.obrigatorios.includes(h) ? ' *' : ''}
          </span>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-light);margin-top:8px">* Campo obrigatório</div>
    </div>

    <div id="impPreviewArea"></div>`;

  if (window.lucide) lucide.createIcons({ el: corpo });

  // Atualizar tab ativa
  document.querySelectorAll('.imp-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === _impAba);
  });
}

// ── Download de template ─────────────────────────────────────
function impBaixarTemplate(aba) {
  const tpl = IMP_TEMPLATES[aba];
  const linhas = [
    tpl.headers.join(','),
    ...tpl.exemplo,
  ];
  const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `template_${aba}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Template baixado.', 'success');
}

// ── Ler arquivo ──────────────────────────────────────────────
async function impLerArquivo(event) {
  const file = event.target.files[0];
  if (!file) return;

  const area = document.getElementById('impPreviewArea');
  area.innerHTML = '<div class="imp-loading"><div class="dp-spin"></div> Processando arquivo...</div>';

  try {
    let rows = [];
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
      const text = await file.text();
      rows = _impParseCSV(text);
    } else if (['xlsx','xls'].includes(ext)) {
      rows = await _impParseExcel(file);
    } else {
      showToast('Formato não suportado. Use CSV ou Excel.', 'error');
      area.innerHTML = '';
      return;
    }

    if (!rows.length) {
      area.innerHTML = '<div class="imp-empty">Nenhum dado encontrado no arquivo.</div>';
      return;
    }

    // Validar e montar preview
    const { validos, erros } = _impValidar(rows);
    _impPreview = validos;
    _impErros   = erros;
    _impRenderPreview(validos, erros);

  } catch(e) {
    area.innerHTML = `<div class="imp-erro-geral">Erro ao processar arquivo: ${e.message}</div>`;
    logErro(e, { modulo: 'importacao', aba: _impAba });
  }

  // Reset input para permitir re-upload
  event.target.value = '';
}

function _impParseCSV(text) {
  const linhas = text.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return [];

  const headers = linhas[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g,''));
  const rows = [];

  for (let i = 1; i < linhas.length; i++) {
    const vals = _impSplitCSVLine(linhas[i]);
    if (vals.every(v => !v.trim())) continue; // pular linhas vazias
    const obj = { _linha: i + 1 };
    headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim().replace(/^["']|["']$/g, ''); });
    rows.push(obj);
  }
  return rows;
}

function _impSplitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; continue; }
    if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += line[i];
  }
  result.push(current);
  return result;
}

async function _impParseExcel(file) {
  return new Promise((resolve, reject) => {
    // Verificar se SheetJS está disponível
    if (typeof XLSX === 'undefined') {
      reject(new Error('SheetJS não carregado. Use o formato CSV.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        // Normalizar headers para lowercase
        const rows = data.map((row, i) => {
          const obj = { _linha: i + 2 };
          Object.entries(row).forEach(([k,v]) => {
            obj[k.toLowerCase().trim()] = String(v).trim();
          });
          return obj;
        });
        resolve(rows);
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Validação ────────────────────────────────────────────────
function _impValidar(rows) {
  const tpl = IMP_TEMPLATES[_impAba];
  const validos = [];
  const erros   = [];

  rows.forEach(row => {
    const rowErros = [];

    // Verificar campos obrigatórios
    tpl.obrigatorios.forEach(campo => {
      if (!row[campo] || !row[campo].toString().trim()) {
        rowErros.push(`Campo "${campo}" é obrigatório`);
      }
    });

    // Validações específicas por aba
    if (_impAba === 'empresas') {
      const cnpj = (row.cnpj || '').replace(/\D/g, '');
      if (cnpj && cnpj.length !== 14) rowErros.push('CNPJ inválido (deve ter 14 dígitos)');
      const regimes = ['MEI','Simples Nacional','Lucro Presumido','Lucro Real'];
      if (row.regime_tributario && !regimes.some(r => row.regime_tributario.toLowerCase().includes(r.toLowerCase().split(' ')[0].toLowerCase()))) {
        rowErros.push(`Regime inválido. Use: ${regimes.join(', ')}`);
      }
    }

    if (_impAba === 'funcionarios') {
      const cnpj = (row.cnpj_empresa || '').replace(/\D/g, '');
      if (cnpj && cnpj.length !== 14) rowErros.push('CNPJ da empresa inválido');
      if (row.salario_base && isNaN(parseFloat(row.salario_base))) rowErros.push('Salário base inválido');
      if (row.data_admissao && !/^\d{4}-\d{2}-\d{2}$/.test(row.data_admissao)) rowErros.push('Data admissão deve ser AAAA-MM-DD');
      const tipos = ['clt','autonomo_rpa','pj','estagio'];
      if (row.tipo_contrato && !tipos.includes(row.tipo_contrato.toLowerCase())) rowErros.push(`Tipo contrato inválido. Use: ${tipos.join(', ')}`);
    }

    if (_impAba === 'plano_contas') {
      const tipos = ['patrimonial','resultado','compensacao'];
      if (row.tipo && !tipos.some(t => row.tipo.toLowerCase().includes(t.slice(0,5)))) rowErros.push(`Tipo inválido. Use: ${tipos.join(', ')}`);
      const naturezas = ['devedora','credora'];
      if (row.natureza && !naturezas.includes(row.natureza.toLowerCase())) rowErros.push(`Natureza inválida. Use: ${naturezas.join(', ')}`);
      const graus = ['sintetica','analitica'];
      if (row.grau && !graus.includes(row.grau.toLowerCase())) rowErros.push(`Grau inválido. Use: ${graus.join(', ')}`);
    }

    if (_impAba === 'lancamentos') {
      if (row.valor && isNaN(parseFloat(row.valor))) rowErros.push('Valor inválido');
      if (row.data && !/^\d{4}-\d{2}-\d{2}$/.test(row.data)) rowErros.push('Data deve ser AAAA-MM-DD');
      if (row.competencia && !/^\d{4}-\d{2}$/.test(row.competencia)) rowErros.push('Competência deve ser AAAA-MM');
    }

    if (_impAba === 'honorarios') {
      if (row.valor && isNaN(parseFloat(row.valor))) rowErros.push('Valor inválido');
      if (row.competencia && !/^\d{4}-\d{2}$/.test(row.competencia)) rowErros.push('Competência deve ser AAAA-MM');
    }

    if (rowErros.length) {
      erros.push({ linha: row._linha, erros: rowErros, dados: row });
    } else {
      validos.push(row);
    }
  });

  return { validos, erros };
}

// ── Render preview ───────────────────────────────────────────
function _impRenderPreview(validos, erros) {
  const area = document.getElementById('impPreviewArea');
  if (!area) return;

  const tpl = IMP_TEMPLATES[_impAba];
  const total = validos.length + erros.length;

  let html = `
    <div class="imp-summary">
      <div class="imp-summary-stat ok">
        <div class="imp-summary-num">${validos.length}</div>
        <div class="imp-summary-lbl">Prontos para importar</div>
      </div>
      <div class="imp-summary-stat ${erros.length ? 'error' : 'zero'}">
        <div class="imp-summary-num">${erros.length}</div>
        <div class="imp-summary-lbl">Com erro</div>
      </div>
      <div class="imp-summary-stat total">
        <div class="imp-summary-num">${total}</div>
        <div class="imp-summary-lbl">Total de linhas</div>
      </div>
    </div>`;

  // Tabela de preview dos válidos
  if (validos.length) {
    const colsVisiveis = tpl.headers.filter(h => h !== 'user_id' && h !== 'escritorio_id').slice(0, 5);
    html += `
      <div class="imp-preview-table-wrap">
        <div style="font-size:12px;font-weight:600;color:var(--text-light);margin-bottom:8px">
          Preview — primeiros ${Math.min(validos.length, 5)} de ${validos.length} registros
        </div>
        <table class="imp-preview-table">
          <thead><tr>${colsVisiveis.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>
            ${validos.slice(0, 5).map(row => `
              <tr>${colsVisiveis.map(h => `<td title="${row[h] || ''}">${_impTruncar(row[h] || '—', 25)}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Erros
  if (erros.length) {
    html += `
      <div class="imp-erros-section">
        <div style="font-size:12px;font-weight:600;color:#ef4444;margin-bottom:8px">
          ⚠ ${erros.length} linha(s) com erro — serão ignoradas
        </div>
        <div class="imp-erros-list">
          ${erros.slice(0, 10).map(e => `
            <div class="imp-erro-item">
              <span class="imp-erro-linha">Linha ${e.linha}</span>
              <span class="imp-erro-msg">${e.erros.join(' · ')}</span>
            </div>`).join('')}
          ${erros.length > 10 ? `<div class="imp-erro-item" style="color:var(--text-light)">... e mais ${erros.length - 10} erros</div>` : ''}
        </div>
      </div>`;
  }

  // Botão de importar
  if (validos.length) {
    html += `
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button onclick="_impLimpar()" class="imp-btn-cancel">Cancelar</button>
        <button onclick="impExecutar()" class="imp-btn-importar" id="impBtnExecutar">
          <i data-lucide="upload-cloud" style="width:15px;height:15px"></i>
          Importar ${validos.length} registro${validos.length > 1 ? 's' : ''}
        </button>
      </div>`;
  } else {
    html += `<div style="margin-top:12px;font-size:13px;color:#ef4444;text-align:center">Nenhum registro válido para importar. Corrija os erros e tente novamente.</div>`;
  }

  area.innerHTML = html;
  if (window.lucide) lucide.createIcons({ el: area });
}

function _impTruncar(str, max) {
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function _impLimpar() {
  _impPreview = [];
  _impErros   = [];
  const area = document.getElementById('impPreviewArea');
  if (area) area.innerHTML = '';
}

// ── Executar importação ───────────────────────────────────────
async function impExecutar() {
  if (!_impPreview.length || _impImportando) return;
  _impImportando = true;

  const btn = document.getElementById('impBtnExecutar');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="dp-spin" style="width:14px;height:14px"></div> Importando...'; }

  try {
    const _escId = await getEscritorioIdAtual();
    let sucesso = 0, falha = 0, errosMsgs = [];

    if (_impAba === 'empresas') {
      ({ sucesso, falha, errosMsgs } = await _impEmpresas(_impPreview, _escId));
    } else if (_impAba === 'funcionarios') {
      ({ sucesso, falha, errosMsgs } = await _impFuncionarios(_impPreview, _escId));
    } else if (_impAba === 'plano_contas') {
      ({ sucesso, falha, errosMsgs } = await _impPlanoContas(_impPreview, _escId));
    } else if (_impAba === 'lancamentos') {
      ({ sucesso, falha, errosMsgs } = await _impLancamentos(_impPreview, _escId));
    } else if (_impAba === 'honorarios') {
      ({ sucesso, falha, errosMsgs } = await _impHonorarios(_impPreview, _escId));
    }

    // Resultado
    const area = document.getElementById('impPreviewArea');
    if (area) {
      area.innerHTML = `
        <div class="imp-resultado">
          <div class="imp-resultado-icon ${falha === 0 ? 'ok' : 'warn'}">
            <i data-lucide="${falha === 0 ? 'check-circle' : 'alert-circle'}" style="width:32px;height:32px"></i>
          </div>
          <div class="imp-resultado-titulo">${falha === 0 ? 'Importação concluída!' : 'Importação parcial'}</div>
          <div class="imp-resultado-stats">
            <span class="ok">${sucesso} importado${sucesso !== 1 ? 's' : ''}</span>
            ${falha ? `<span class="error">${falha} falha${falha !== 1 ? 's' : ''}</span>` : ''}
          </div>
          ${errosMsgs.length ? `
            <div class="imp-erros-list" style="margin-top:12px;text-align:left">
              ${errosMsgs.slice(0,5).map(e => `<div class="imp-erro-item"><span class="imp-erro-msg">${e}</span></div>`).join('')}
            </div>` : ''}
          <button onclick="_impLimpar()" class="imp-btn-cancel" style="margin-top:16px">Nova importação</button>
        </div>`;
      if (window.lucide) lucide.createIcons({ el: area });
    }

    if (sucesso > 0) {
      registrarAuditLog('IMPORTACAO_EM_MASSA', _impAba, null, { sucesso, falha, total: _impPreview.length });
      // Recarregar módulo relevante
      if (_impAba === 'empresas' && typeof loadClientes === 'function') loadClientes();
    }

  } catch(e) {
    showToast('Erro na importação: ' + e.message, 'error');
    logErro(e, { modulo: 'importacao', aba: _impAba });
    if (btn) { btn.disabled = false; btn.innerHTML = 'Tentar novamente'; }
  } finally {
    _impImportando = false;
    _impPreview = [];
  }
}

// ── Importadores específicos ──────────────────────────────────
async function _impEmpresas(rows, escId) {
  let sucesso = 0, falha = 0;
  const errosMsgs = [];

  for (const row of rows) {
    try {
      const cnpjLimpo = (row.cnpj || '').replace(/\D/g, '');

      // Verificar se já existe
      const { data: existe } = await sb.from('clientes')
        .select('id').eq('cnpj', cnpjLimpo).eq('user_id', currentUser.id).maybeSingle();
      if (existe) { errosMsgs.push(`CNPJ ${row.cnpj} já cadastrado`); falha++; continue; }

      const { error } = await sb.from('clientes').insert({
        user_id:          currentUser.id,
        razao_social:     row.razao_social,
        cnpj:             cnpjLimpo,
        nome_fantasia:    row.nome_fantasia || null,
        regime_tributario:row.regime_tributario || null,
        inscricao_estadual:row.inscricao_estadual || null,
        honorario_valor:  row.honorario_valor ? parseFloat(row.honorario_valor) : null,
        honorario_dia_venc:row.honorario_dia_vencimento ? parseInt(row.honorario_dia_vencimento) : 10,
      });

      if (error) { errosMsgs.push(`${row.razao_social}: ${error.message}`); falha++; }
      else sucesso++;
    } catch(e) { errosMsgs.push(`${row.razao_social}: ${e.message}`); falha++; }
  }
  return { sucesso, falha, errosMsgs };
}

async function _impFuncionarios(rows, escId) {
  let sucesso = 0, falha = 0;
  const errosMsgs = [];

  // Montar cache de clientes por CNPJ
  const { data: clientes } = await sb.from('clientes')
    .select('id, cnpj').eq('user_id', currentUser.id);
  const clienteMap = {};
  (clientes || []).forEach(c => { clienteMap[c.cnpj] = c.id; });

  for (const row of rows) {
    try {
      const cnpjLimpo = (row.cnpj_empresa || '').replace(/\D/g, '');
      const clienteId = clienteMap[cnpjLimpo];
      if (!clienteId) { errosMsgs.push(`${row.nome}: empresa com CNPJ ${row.cnpj_empresa} não encontrada`); falha++; continue; }

      const { error } = await sb.from('dp_funcionarios').insert({
        user_id:       currentUser.id,
        cliente_id:    clienteId,
        escritorio_id: escId,
        nome:          row.nome,
        cpf:           (row.cpf || '').replace(/\D/g, '') || null,
        cargo:         row.cargo || null,
        salario_base:  parseFloat(row.salario_base),
        admissao:      row.data_admissao,
        tipo_contrato: row.tipo_contrato?.toLowerCase() || 'clt',
        dependentes:   parseInt(row.dependentes) || 0,
        email:         row.email || null,
        telefone:      (row.telefone || '').replace(/\D/g,'') || null,
        jornada_horas: parseInt(row.jornada_horas) || 44,
        status:        'ativo',
        atualizado_em: new Date().toISOString(),
      });

      if (error) { errosMsgs.push(`${row.nome}: ${error.message}`); falha++; }
      else sucesso++;
    } catch(e) { errosMsgs.push(`${row.nome}: ${e.message}`); falha++; }
  }
  return { sucesso, falha, errosMsgs };
}

async function _impPlanoContas(rows, escId) {
  let sucesso = 0, falha = 0;
  const errosMsgs = [];

  // Cache de clientes
  const { data: clientes } = await sb.from('clientes').select('id, cnpj').eq('user_id', currentUser.id);
  const clienteMap = {};
  (clientes || []).forEach(c => { clienteMap[c.cnpj] = c.id; });

  // Cache de contas já inseridas (para conta_pai_id)
  const contasInseridas = {}; // codigo → id

  // Inserir em ordem (sintéticas antes de analíticas pela ordenação)
  const rowsOrdenados = [...rows].sort((a, b) => {
    const na = (a.codigo || '').split('.').length;
    const nb = (b.codigo || '').split('.').length;
    return na - nb;
  });

  for (const row of rowsOrdenados) {
    try {
      const cnpjLimpo = (row.cnpj_empresa || '').replace(/\D/g, '');
      const clienteId = clienteMap[cnpjLimpo];
      if (!clienteId) { errosMsgs.push(`Conta ${row.codigo}: empresa ${row.cnpj_empresa} não encontrada`); falha++; continue; }

      // Determinar conta pai pelo código
      const partes = (row.codigo || '').split('.');
      const codigoPai = partes.length > 1 ? partes.slice(0, -1).join('.') : null;
      const contaPaiId = codigoPai ? contasInseridas[`${cnpjLimpo}_${codigoPai}`] : null;

      const tipoNorm = row.tipo?.toLowerCase().includes('patrimonial') ? 'patrimonial'
        : row.tipo?.toLowerCase().includes('resultado') ? 'resultado' : 'compensacao';
      const naturNorm = row.natureza?.toLowerCase() === 'credora' ? 'credora' : 'devedora';
      const grauNorm  = row.grau?.toLowerCase() === 'analitica' ? 'analitica' : 'sintetica';

      const { data, error } = await sb.from('plano_contas').insert({
        user_id:       currentUser.id,
        cliente_id:    clienteId,
        escritorio_id: escId,
        codigo:        row.codigo,
        descricao:     row.descricao,
        tipo:          tipoNorm,
        natureza:      naturNorm,
        grau:          grauNorm,
        nivel:         partes.length,
        conta_pai_id:  contaPaiId || null,
        ativo:         true,
      }).select('id').single();

      if (error) { errosMsgs.push(`${row.codigo}: ${error.message}`); falha++; }
      else { contasInseridas[`${cnpjLimpo}_${row.codigo}`] = data.id; sucesso++; }
    } catch(e) { errosMsgs.push(`${row.codigo}: ${e.message}`); falha++; }
  }
  return { sucesso, falha, errosMsgs };
}

async function _impLancamentos(rows, escId) {
  let sucesso = 0, falha = 0;
  const errosMsgs = [];

  // Cache de clientes
  const { data: clientes } = await sb.from('clientes').select('id, cnpj').eq('user_id', currentUser.id);
  const clienteMap = {};
  (clientes || []).forEach(c => { clienteMap[c.cnpj] = c.id; });

  // Cache de plano de contas por cliente+codigo
  const contaMap = {};

  for (const row of rows) {
    try {
      const cnpjLimpo = (row.cnpj_empresa || '').replace(/\D/g, '');
      const clienteId = clienteMap[cnpjLimpo];
      if (!clienteId) { errosMsgs.push(`Lançamento linha ${row._linha}: empresa não encontrada`); falha++; continue; }

      // Buscar contas por código (lazy cache)
      const cacheKey = `${clienteId}_${row.codigo_debito}`;
      const cacheKeyC = `${clienteId}_${row.codigo_credito}`;

      if (!contaMap[cacheKey]) {
        const { data } = await sb.from('plano_contas')
          .select('id').eq('user_id', currentUser.id).eq('cliente_id', clienteId)
          .eq('codigo', row.codigo_debito).maybeSingle();
        contaMap[cacheKey] = data?.id || null;
      }
      if (!contaMap[cacheKeyC]) {
        const { data } = await sb.from('plano_contas')
          .select('id').eq('user_id', currentUser.id).eq('cliente_id', clienteId)
          .eq('codigo', row.codigo_credito).maybeSingle();
        contaMap[cacheKeyC] = data?.id || null;
      }

      if (!contaMap[cacheKey])  { errosMsgs.push(`Linha ${row._linha}: conta débito ${row.codigo_debito} não encontrada`); falha++; continue; }
      if (!contaMap[cacheKeyC]) { errosMsgs.push(`Linha ${row._linha}: conta crédito ${row.codigo_credito} não encontrada`); falha++; continue; }

      const { error } = await sb.from('lancamentos_contabeis').insert({
        user_id:       currentUser.id,
        cliente_id:    clienteId,
        escritorio_id: escId,
        data_lanc:     row.data,
        historico:     row.historico,
        valor:         parseFloat(row.valor),
        debito_id:     contaMap[cacheKey],
        credito_id:    contaMap[cacheKeyC],
        competencia:   row.competencia,
        origem:        'importacao',
        estornado:     false,
      });

      if (error) { errosMsgs.push(`Linha ${row._linha}: ${error.message}`); falha++; }
      else sucesso++;
    } catch(e) { errosMsgs.push(`Linha ${row._linha}: ${e.message}`); falha++; }
  }
  return { sucesso, falha, errosMsgs };
}

async function _impHonorarios(rows, escId) {
  let sucesso = 0, falha = 0;
  const errosMsgs = [];

  // Cache de clientes
  const { data: clientes } = await sb.from('clientes').select('id, cnpj').eq('user_id', currentUser.id);
  const clienteMap = {};
  (clientes || []).forEach(c => { clienteMap[c.cnpj] = c.id; });

  for (const row of rows) {
    try {
      const cnpjLimpo = (row.cnpj_empresa || '').replace(/\D/g, '');
      const clienteId = clienteMap[cnpjLimpo];
      if (!clienteId) { errosMsgs.push(`Honorário ${row.competencia}: empresa não encontrada`); falha++; continue; }

      const statusValido = ['pendente','pago','cancelado'].includes(row.status?.toLowerCase())
        ? row.status.toLowerCase() : 'pendente';

      const { error } = await sb.from('honorarios').upsert({
        user_id:        currentUser.id,
        cliente_id:     clienteId,
        escritorio_id:  escId,
        competencia:    row.competencia,
        valor:          parseFloat(row.valor),
        dia_vencimento: parseInt(row.dia_vencimento) || 10,
        descricao:      row.descricao || `Honorários ${row.competencia}`,
        status:         statusValido,
      }, { onConflict: 'user_id,cliente_id,competencia', ignoreDuplicates: false });

      if (error) { errosMsgs.push(`${row.cnpj_empresa} ${row.competencia}: ${error.message}`); falha++; }
      else sucesso++;
    } catch(e) { errosMsgs.push(`${e.message}`); falha++; }
  }
  return { sucesso, falha, errosMsgs };
}
