// ============================================================
// EMPRESA_PERFIL.JS — Perfil completo da empresa
// ============================================================
// Modal com abas: Cadastro | Endereço | Financeiro | Sócios
// Auto-preenchimento via BrasilAPI (CNPJ, CEP)
// Persistência completa no Supabase (tabela clientes)

// ── Abrir modal ───────────────────────────────────────────
async function openEmpresaPerfil() {
  if (!currentCliente?.id) {
    showToast('Selecione uma empresa primeiro.', 'warn');
    return;
  }
  const modal = document.getElementById('empresaPerfilModal');
  modal.style.display = 'flex';

  // Carregar dados completos do banco
  await carregarPerfilEmpresa();
  switchPerfilTab('cadastro');
}

function closeEmpresaPerfil() {
  document.getElementById('empresaPerfilModal').style.display = 'none';
}

// ── Carregar dados do banco ───────────────────────────────
async function carregarPerfilEmpresa() {
  const { data, error } = await sb
    .from('clientes')
    .select('*')
    .eq('id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error || !data) return;

  // Mesclar em currentCliente
  Object.assign(currentCliente, data);

  // Preencher formulário
  preencherFormPerfil(data);

  // Atualizar header com última atualização
  const el = document.getElementById('epUltimaAtualizacao');
  if (el && data.ultima_atualizacao) {
    el.textContent = `Atualizado: ${new Date(data.ultima_atualizacao).toLocaleDateString('pt-BR')}`;
  }
}

// ── Preencher campos do formulário ────────────────────────
function preencherFormPerfil(d) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.value = val;
  };

  // Aba Cadastro
  set('epRazao',           d.razao_social);
  set('epFantasia',        d.nome_fantasia);
  set('epCnpj',            d.cnpj ? formatarCNPJ(d.cnpj) : '');
  set('epRegime',          d.regime_tributario);
  set('epRegimeApuracao',  d.regime_apuracao);
  set('epCnae',            d.cnae_principal);
  set('epCnaeDesc',        d.cnae_descricao);
  set('epNatureza',        d.natureza_juridica);
  set('epPorte',           d.porte);
  set('epDataAbertura',    d.data_abertura);
  set('epCapital',         d.capital_social ? Number(d.capital_social).toFixed(2) : '');
  set('epSituacao',        d.situacao_cadastral);
  set('epIE',              d.inscricao_estadual);
  set('epIM',              d.inscricao_municipal);
  set('epTelefone',        d.telefone);
  set('epEmail',           d.email_empresa);
  set('epTemEmpregado',    d.tem_empregado ? 'true' : 'false');
  set('epOptanteSimples',  d.optante_simples ? 'true' : 'false');
  set('epOptanteMei',      d.optante_mei ? 'true' : 'false');

  // Aba Endereço
  set('epCep',             d.cep ? formatarCEP(d.cep) : '');
  set('epLogradouro',      d.logradouro);
  set('epNumero',          d.numero);
  set('epComplemento',     d.complemento);
  set('epBairro',          d.bairro);
  set('epMunicipio',       d.municipio);
  set('epUf',              d.uf);

  // Aba Financeiro
  set('epFatMensal',   d.faturamento_mensal  ? Number(d.faturamento_mensal).toFixed(2)  : '');
  set('epFatAnual',    d.faturamento_anual   ? Number(d.faturamento_anual).toFixed(2)   : '');
  set('epProlabore',   d.prolabore_total     ? Number(d.prolabore_total).toFixed(2)     : '');

  // Aba Sócios
  renderSocios(d.socios || []);
}

// ── Formatar helpers ──────────────────────────────────────
function formatarCNPJ(v) {
  const n = v.replace(/\D/g,'');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function formatarCEP(v) {
  const n = v.replace(/\D/g,'');
  return n.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

// ── Tabs ──────────────────────────────────────────────────
function switchPerfilTab(tab) {
  document.querySelectorAll('.ep-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.style.color = b.dataset.tab === tab ? 'var(--text)' : 'var(--text-light)';
    b.style.borderBottomColor = b.dataset.tab === tab ? 'var(--text)' : 'transparent';
  });
  ['cadastro','endereco','financeiro','socios'].forEach(t => {
    const el = document.getElementById(`epTab_${t}`);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
}

// ── Auto-preencher via BrasilAPI (CNPJ) ──────────────────
async function epBuscarCNPJ() {
  const cnpj = document.getElementById('epCnpj').value.replace(/\D/g,'');
  if (cnpj.length !== 14) { showToast('CNPJ inválido.', 'warn'); return; }

  const btn = document.getElementById('epBtnBuscarCnpj');
  btn.disabled = true; btn.textContent = 'Buscando...';

  try {
    // Tentar BrasilAPI primeiro, fallback para ReceitaWS
    let d = null;
    const apis = [
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      `https://receitaws.com.br/v1/cnpj/${cnpj}`,
    ];
    for (const url of apis) {
      try {
        const res = await fetch(url);
        if (res.ok) { d = await res.json(); if (d && !d.message) break; }
      } catch { continue; }
    }
    if (!d || d.message) throw new Error('CNPJ não encontrado nas APIs públicas');

    // Preencher automaticamente todos os campos
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    // Normalizar campos (BrasilAPI e ReceitaWS têm nomes ligeiramente diferentes)
    const norm = {
      razao:      d.razao_social || d.nome,
      fantasia:   d.nome_fantasia || d.fantasia,
      cnae:       d.cnae_fiscal ? String(d.cnae_fiscal) : (d.atividade_principal?.[0]?.code || ''),
      cnaeDesc:   d.cnae_fiscal_descricao || d.atividade_principal?.[0]?.text || '',
      natureza:   d.natureza_juridica || (typeof d.natureza_juridica === 'object' ? d.natureza_juridica?.descricao : ''),
      porte:      d.porte,
      abertura:   d.data_inicio_atividade || d.abertura,
      capital:    d.capital_social ? Number(d.capital_social).toFixed(2) : '',
      situacao:   d.descricao_situacao_cadastral || d.situacao,
      telefone:   d.ddd_telefone_1 ? `(${d.ddd_telefone_1}) ${d.telefone_1}` : (d.telefone || ''),
      email:      d.email,
      simples:    d.opcao_pelo_simples || (d.simples?.optante === 'Sim'),
      mei:        d.opcao_pelo_mei || (d.mei?.optante === 'Sim'),
      cep:        d.cep,
      logradouro: d.logradouro,
      numero:     d.numero,
      complemento:d.complemento,
      bairro:     d.bairro,
      municipio:  d.municipio,
      uf:         d.uf,
      socios:     (d.qsa || d.quadro_societario || []).map(s => ({
        nome: s.nome_socio || s.nome,
        qualificacao: s.qualificacao_socio || s.qual || 'Sócio',
      })),
    };

    set('epRazao',       norm.razao);
    set('epFantasia',    norm.fantasia);
    set('epCnae',        norm.cnae);
    set('epCnaeDesc',    norm.cnaeDesc);
    set('epNatureza',    typeof norm.natureza === 'string' ? norm.natureza : '');
    set('epPorte',       norm.porte);
    set('epDataAbertura',norm.abertura);
    set('epCapital',     norm.capital);
    set('epSituacao',    norm.situacao);
    set('epTelefone',    norm.telefone);
    set('epEmail',       norm.email);

    // Regime automático
    const regEl = document.getElementById('epRegime');
    if (regEl && !regEl.value) {
      if (norm.mei) regEl.value = 'MEI';
      else if (norm.simples) regEl.value = 'Simples Nacional';
    }
    document.getElementById('epOptanteSimples').value = norm.simples ? 'true' : 'false';
    document.getElementById('epOptanteMei').value = norm.mei ? 'true' : 'false';

    // Endereço
    set('epCep',         norm.cep ? formatarCEP(norm.cep) : '');
    set('epLogradouro',  norm.logradouro);
    set('epNumero',      norm.numero);
    set('epComplemento', norm.complemento);
    set('epBairro',      norm.bairro);
    set('epMunicipio',   norm.municipio);
    set('epUf',          norm.uf);

    // Sócios
    renderSocios(norm.socios);

    // Guardar payload bruto para salvar
    document.getElementById('epDadosReceita').value = JSON.stringify(d);

    showToast('Dados da Receita Federal carregados.', 'success');
  } catch(e) {
    showToast('Erro ao buscar CNPJ: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Buscar na Receita Federal';
  }
}

// ── Auto-preencher endereço via CEP (ViaCEP) ─────────────
async function epBuscarCEP() {
  const cep = document.getElementById('epCep').value.replace(/\D/g,'');
  if (cep.length !== 8) return;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = await res.json();
    if (d.erro) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('epLogradouro', d.logradouro);
    set('epBairro',     d.bairro);
    set('epMunicipio',  d.localidade);
    set('epUf',         d.uf);
    document.getElementById('epNumero')?.focus();
  } catch(e) {}
}

// ── Renderizar lista de sócios ────────────────────────────
function renderSocios(socios) {
  const container = document.getElementById('epSociosList');
  if (!container) return;

  container.innerHTML = socios.length === 0
    ? '<p style="color:var(--text-light);font-size:13px">Nenhum sócio cadastrado.</p>'
    : socios.map((s, i) => `
      <div class="ep-socio-row" id="epSocio_${i}">
        <input type="text" placeholder="Nome" value="${s.nome||''}"
          oninput="epSocioUpdate(${i},'nome',this.value)"
          style="flex:2;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px">
        <input type="text" placeholder="Qualificação" value="${s.qualificacao||''}"
          oninput="epSocioUpdate(${i},'qualificacao',this.value)"
          style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px">
        <input type="number" placeholder="Pró-labore (R$)" value="${s.prolabore||''}"
          oninput="epSocioUpdate(${i},'prolabore',this.value)"
          style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px">
        <button onclick="epRemoverSocio(${i})"
          style="padding:7px 10px;background:none;border:1px solid var(--border);border-radius:8px;cursor:pointer;color:var(--text-light)">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>`).join('');

  lucide.createIcons();
  _sociosTemp = [...socios];
}

let _sociosTemp = [];

function epSocioUpdate(idx, campo, val) {
  if (!_sociosTemp[idx]) _sociosTemp[idx] = {};
  _sociosTemp[idx][campo] = val;
}

function epAdicionarSocio() {
  _sociosTemp.push({ nome: '', qualificacao: 'Sócio-Administrador', prolabore: '' });
  renderSocios(_sociosTemp);
}

function epRemoverSocio(idx) {
  _sociosTemp.splice(idx, 1);
  renderSocios(_sociosTemp);
}

// ── Recalcular faturamento anual ao mudar mensal ──────────
function epCalcFatAnual() {
  const mensal = parseFloat(document.getElementById('epFatMensal')?.value || 0);
  if (mensal > 0) {
    const el = document.getElementById('epFatAnual');
    if (el && !el.value) el.value = (mensal * 12).toFixed(2);
  }
}

// ── Salvar no Supabase ────────────────────────────────────
async function salvarPerfilEmpresa() {
  if (!currentCliente?.id) return;

  const get    = id => document.getElementById(id)?.value?.trim() || null;
  const getNum = id => { const v = parseFloat(get(id)); return isNaN(v) ? null : v; };
  const getBool= id => get(id) === 'true';

  // Calcular pró-labore total dos sócios
  const prolaboreTotal = _sociosTemp.reduce((a,s) => a + (parseFloat(s.prolabore)||0), 0) || getNum('epProlabore');

  const payload = {
    // Cadastral
    razao_social:        get('epRazao'),
    nome_fantasia:       get('epFantasia'),
    regime_tributario:   get('epRegime'),
    regime_apuracao:     get('epRegimeApuracao'),
    cnae_principal:      get('epCnae'),
    cnae_descricao:      get('epCnaeDesc'),
    natureza_juridica:   get('epNatureza'),
    porte:               get('epPorte'),
    data_abertura:       get('epDataAbertura') || null,
    capital_social:      getNum('epCapital'),
    situacao_cadastral:  get('epSituacao'),
    inscricao_estadual:  get('epIE'),
    inscricao_municipal: get('epIM'),
    telefone:            get('epTelefone'),
    email_empresa:       get('epEmail'),
    tem_empregado:       getBool('epTemEmpregado'),
    optante_simples:     getBool('epOptanteSimples'),
    optante_mei:         getBool('epOptanteMei'),
    // Endereço
    cep:         (get('epCep')||'').replace(/\D/g,''),
    logradouro:  get('epLogradouro'),
    numero:      get('epNumero'),
    complemento: get('epComplemento'),
    bairro:      get('epBairro'),
    municipio:   get('epMunicipio'),
    uf:          get('epUf'),
    // Financeiro
    faturamento_mensal: getNum('epFatMensal'),
    faturamento_anual:  getNum('epFatAnual'),
    prolabore_total:    prolaboreTotal || null,
    // Sócios
    socios: _sociosTemp.filter(s => s.nome),
    // Payload bruto da Receita
    dados_receita: (() => { try { return JSON.parse(get('epDadosReceita')||'null'); } catch { return null; } })(),
    ultima_atualizacao: new Date().toISOString(),
  };

  const btn = document.getElementById('epBtnSalvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { error } = await sb.from('clientes').update(payload).eq('id', currentCliente.id).eq('user_id', currentUser.id);

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) {
    showToast('Erro ao salvar: ' + error.message, 'error');
    return;
  }

  // Atualizar currentCliente em memória
  Object.assign(currentCliente, payload);

  // Invalidar cache do EmpresaContext
  if (typeof EmpresaContext !== 'undefined') EmpresaContext.invalidar();

  showToast('Perfil da empresa salvo.', 'success');
  document.getElementById('epUltimaAtualizacao').textContent = `Atualizado: ${new Date().toLocaleDateString('pt-BR')}`;
}
