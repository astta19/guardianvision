// ============================================================
// CLIENTS.JS — Empresas, Acessos, CNPJ
// ============================================================
// ====== FUNÇÕES CNPJ ======

function extrairCNPJ(texto) {
  const match = texto.match(/\d{2}[\.\-]?\d{3}[\.\-]?\d{3}[\/]?\d{4}[\-]?\d{2}/);
  if (!match) return null;
  return match[0].replace(/\D/g, '');
}

async function consultarCNPJ(cnpj) {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (!res.ok) return null;
    const d = await res.json();
    return d;
  } catch {
    return null;
  }
}

function formatarDadosCNPJ(d) {
  if (!d) return null;
  const situacao = d.descricao_situacao_cadastral || 'Não informado';
  const atividade = d.cnae_fiscal_descricao || d.atividade_principal?.[0]?.text || 'Não informado';
  const socios = d.qsa?.map(s => `${s.nome_socio} (${s.qualificacao_socio})`).join(', ') || 'Não informado';
  const endereco = [d.logradouro, d.numero, d.complemento, d.bairro, d.municipio, d.uf]
    .filter(Boolean).join(', ');

  return `DADOS DA RECEITA FEDERAL — CNPJ ${d.cnpj}:
- Razão Social: ${d.razao_social}
- Nome Fantasia: ${d.nome_fantasia || '—'}
- Situação Cadastral: ${situacao}
- Data Abertura: ${d.data_inicio_atividade || '—'}
- Atividade Principal: ${atividade}
- Natureza Jurídica: ${d.natureza_juridica || '—'}
- Capital Social: R$ ${Number(d.capital_social || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}
- Endereço: ${endereco || '—'}
- Município/UF: ${d.municipio || '—'}/${d.uf || '—'}
- CEP: ${d.cep || '—'}
- Telefone: ${d.ddd_telefone_1 ? `(${d.ddd_telefone_1}) ${d.telefone_1}` : '—'}
- E-mail: ${d.email || '—'}
- Sócios/Administradores: ${socios}
- Porte: ${d.porte || '—'}
- Optante Simples Nacional: ${d.opcao_pelo_simples ? 'Sim' : 'Não'}
- Optante MEI: ${d.opcao_pelo_mei ? 'Sim' : 'Não'}`;
}

// ====== FUNÇÕES DE CLIENTES ======
async function loadClientes() {
  // Guard: aguardar currentUser estar disponível
  if (!currentUser) {
    const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: {} }));
    if (user) currentUser = user;
    else return; // não autenticado
  }
  // Admin busca todos; outros buscam via vínculo clientes_usuarios
  let data, error;
  if (isAdmin()) {
    ({ data, error } = await sb
      .from('clientes')
      .select('id, razao_social, cnpj, regime_tributario, nome_fantasia, tem_empregado, cnae_principal, cnae_descricao, natureza_juridica, data_abertura, capital_social, situacao_cadastral, inscricao_estadual, inscricao_municipal, logradouro, numero, bairro, municipio, uf, cep, telefone, email_empresa, socios, prolabore_total, faturamento_mensal, faturamento_anual, regime_apuracao, porte, optante_simples, optante_mei')
      .eq('user_id', currentUser.id)
      .order('razao_social'));
  } else {
    ({ data, error } = await sb
      .from('clientes_usuarios')
      .select('clientes(id, razao_social, cnpj, regime_tributario, nome_fantasia)')
      .eq('user_id', currentUser.id)
      .order('clientes(razao_social)'));
    if (!error && data) {
      data = data.map(r => r.clientes).filter(Boolean);
    }
  }
  if (error) {
    console.error('Erro ao carregar clientes:', error);
    return;
  }

  const clientes = data || [];

  // Auto-selecionar se tiver só 1, ou restaurar último selecionado
  const lastId = localStorage.getItem('lastClienteId');
  const found = clientes.find(c => c.id === lastId);
  if (found) {
    setCurrentCliente(found);
  } else if (clientes.length === 1) {
    setCurrentCliente(clientes[0]);
  } else if (clientes.length > 1) {
    // Mostrar modal para escolher
    openClientModal();
  }

  loadChats();
}

// ── Templates dinâmicos por regime ────────────────────────────────────────
function atualizarTemplates(regime) {
  const tplRow = document.querySelector('.tpl-row');
  if (!tplRow) return;

  const r = (regime || '').toLowerCase();
  const isMEI     = r.includes('mei');
  const isSimples = r.includes('simples') || isMEI;
  const isLP      = r.includes('presumido');
  const isLR      = r.includes('real');

  const templates = isMEI ? [
    { icon: 'file-badge',   label: 'DASN-SIMEI', q: 'Como declarar o DASN-SIMEI para MEI?' },
    { icon: 'receipt',      label: 'DAS-MEI',    q: 'Qual o valor do DAS-MEI em 2026?' },
    { icon: 'alert-circle', label: 'Limites',    q: 'Quais são os limites de faturamento do MEI?' },
    { icon: 'file-text',    label: 'NF-e MEI',   q: 'Quando o MEI é obrigado a emitir nota fiscal?' },
    { icon: 'clock',        label: 'Prazos',     q: 'Quais são os prazos obrigatórios do MEI em 2026?' },
  ] : isSimples ? [
    { icon: 'calculator',   label: 'DAS',        q: 'Como calcular o DAS do Simples Nacional?' },
    { icon: 'shield',       label: 'Fator R',    q: 'Como funciona o Fator R no Simples Nacional?' },
    { icon: 'bar-chart-2',  label: 'Anexos',     q: 'Qual a diferença entre os anexos do Simples Nacional?' },
    { icon: 'file-text',    label: 'CFOPs',      q: 'Quando usar CFOP 5102?' },
    { icon: 'clock',        label: 'Prazos',     q: 'Prazo do DAS Simples Nacional 2026' },
  ] : isLP ? [
    { icon: 'calculator',   label: 'IRPJ/CSLL',  q: 'Como calcular IRPJ e CSLL no Lucro Presumido?' },
    { icon: 'receipt',      label: 'PIS/COFINS', q: 'Como calcular PIS e COFINS no Lucro Presumido?' },
    { icon: 'file-code-2',  label: 'ECF',        q: 'O que é ECF e qual o prazo de entrega?' },
    { icon: 'file-text',    label: 'CFOPs',      q: 'Quando usar CFOP 5102?' },
    { icon: 'clock',        label: 'Prazos',     q: 'Calendário fiscal Lucro Presumido 2026' },
  ] : isLR ? [
    { icon: 'calculator',   label: 'IRPJ Real',  q: 'Como apurar o IRPJ no Lucro Real?' },
    { icon: 'receipt',      label: 'PIS/COFINS', q: 'Como calcular créditos de PIS/COFINS no Lucro Real?' },
    { icon: 'book-open',    label: 'ECD/ECF',    q: 'O que é ECD e ECF no Lucro Real?' },
    { icon: 'shield',       label: 'CSLL',       q: 'Como calcular CSLL no Lucro Real?' },
    { icon: 'clock',        label: 'Prazos',     q: 'Calendário fiscal Lucro Real 2026' },
  ] : [
    { icon: 'calculator',   label: 'ICMS',       q: 'Como calcular ICMS de R$ 10.000 com alíquota 18%?' },
    { icon: 'shield',       label: 'ICMS-ST',    q: 'Como funciona o ICMS-ST?' },
    { icon: 'bar-chart-2',  label: 'Regimes',    q: 'Diferença entre Lucro Real e Presumido' },
    { icon: 'file-text',    label: 'CFOPs',      q: 'Quando usar CFOP 5102?' },
    { icon: 'clock',        label: 'Prazos',     q: 'Prazo SPED Fiscal 2026' },
  ];

  tplRow.innerHTML = templates.map((t, i) =>
    `<button class="chip" data-tpl-idx="${i}" onclick="useTplByIdx(this)">
      <i data-lucide="${t.icon}"></i> ${t.label}
    </button>`
  ).join('');
  // Guardar perguntas sem risco de quebrar HTML com aspas
  tplRow._tplQuestions = templates.map(t => t.q);
  if (window.lucide) lucide.createIcons();
}

function useTplByIdx(btn) {
  const row = btn.closest('.tpl-row');
  const idx = parseInt(btn.dataset.tplIdx);
  const q   = row?._tplQuestions?.[idx];
  if (q && typeof useTemplate === 'function') useTemplate(q);
}

async function setCurrentCliente(cliente) {
  currentCliente = cliente;
  localStorage.setItem('lastClienteId', cliente.id);

  const displayName = cliente.nome_fantasia || cliente.razao_social;

  // Atualizar UI
  document.getElementById('sidebarClientName').textContent = displayName;
  const badge = document.getElementById('headerClientBadge');
  document.getElementById('headerClientName').textContent = displayName;
  badge.style.display = 'flex';

  // Templates dinâmicos por regime
  atualizarTemplates(cliente.regime_tributario);

  // Invalidar cache de contexto da empresa
  if (typeof EmpresaContext !== 'undefined') EmpresaContext.invalidar();

  // Re-aplicar permissões — garante que botões data-perm aparecem após empresa carregar
  if (typeof applyAdminUI === 'function') applyAdminUI();

  // Mostrar botão de perfil da empresa (visível para qualquer usuário com empresa)
  const btnPerfil = document.getElementById('btnEmpresaPerfil');
  if (btnPerfil) btnPerfil.style.display = 'flex';
  const btnPerfilCard = document.getElementById('btnPerfilEmpresaCard');
  if (btnPerfilCard) btnPerfilCard.style.display = '';

  // Mostrar DASN-SIMEI só para MEI
  const btnDasn = document.getElementById('btnDasnSimei');
  if (btnDasn) btnDasn.style.display = /mei/i.test(cliente.regime_tributario || '') ? 'flex' : 'none';

  // Recarregar chats filtrados
  loadChats();
}

async function openClientModal() {
  closeSidebar(); // fecha sidebar antes de abrir modal no mobile
  document.getElementById('clientModal').classList.remove('hidden');
  renderClientList();
  setTimeout(() => document.getElementById('clientSearchInput')?.focus(), 80);
}

async function closeClientModal() {
  document.getElementById('clientModal').classList.add('hidden');
  document.getElementById('newClientForm').classList.remove('show');
}

async function renderClientList() {
  const el = document.getElementById('clientList');
  el.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:13px;padding:8px">Carregando...</p>';

  // Admin busca todos; outros buscam via vínculo clientes_usuarios
  let data, error;
  if (isAdmin()) {
    ({ data, error } = await sb
      .from('clientes')
      .select('id, razao_social, cnpj, regime_tributario, nome_fantasia, tem_empregado')
      .eq('user_id', currentUser.id)
      .order('razao_social'));
  } else {
    ({ data, error } = await sb
      .from('clientes_usuarios')
      .select('clientes(id, razao_social, cnpj, regime_tributario, nome_fantasia)')
      .eq('user_id', currentUser.id));
    if (!error && data) {
      data = data.map(r => r.clientes).filter(Boolean)
        .sort((a,b) => a.razao_social.localeCompare(b.razao_social));
    }
  }

  if (error) {
    console.error('Erro ao buscar clientes:', error);
    el.innerHTML = `<p style="text-align:center;color:var(--error);font-size:13px;padding:12px">Erro ao carregar empresas: ${error.message || 'verifique sua conexão.'}</p>`;
    return;
  }
  if (!data?.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:13px;padding:12px">Nenhuma empresa cadastrada ainda.</p>';
    return;
  }

  el.innerHTML = data.map(cl => {
    const nome = escapeHtml(cl.razao_social);
    const fantasia = cl.nome_fantasia ? escapeHtml(cl.nome_fantasia) : '';
    const nomeExibido = fantasia || nome;
    const regime = cl.regime_tributario ? escapeHtml(cl.regime_tributario) : '';
    // Regime abreviado para caber no badge sem romper layout
    const regimeAbrev = regime
      .replace('Simples Nacional', 'Simples')
      .replace('Lucro Presumido', 'L. Presumido')
      .replace('Lucro Real', 'L. Real')
      .replace('Microempreendedor Individual', 'MEI');
    return `<div class="client-item ${currentCliente?.id === cl.id ? 'active' : ''}">
      <div class="client-item-info" onclick="selectCliente('${cl.id}')" style="cursor:pointer">
        <div class="client-item-name" title="${nome}">${nomeExibido}</div>
        <div class="client-item-cnpj">CNPJ: ${escapeHtml(cl.cnpj)}</div>
      </div>
      ${regimeAbrev ? `<span class="client-item-regime" title="${regime}">${regimeAbrev}</span>` : ''}
      ${isAdmin() ? `<button onclick="gerenciarAcessos('${cl.id}','${nome.replace(/'/g,'')}')" title="Gerenciar acessos" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-light);display:flex;align-items:center;flex-shrink:0">
        <i data-lucide="users" style="width:15px;height:15px"></i>
      </button>` : ''}
    </div>`;
  }).join('');

  // Guardar lista para selectCliente usar
  window._clientesList = data;
  lucide.createIcons();
}

async function selectCliente(id) {
  const cliente = (window._clientesList || []).find(c => c.id === id);
  if (!cliente) return;
  setCurrentCliente(cliente);
  closeClientModal();
  newChat(); // iniciar nova conversa no contexto do cliente
}

async function toggleNewClientForm() {
  const form = document.getElementById('newClientForm');
  form.classList.toggle('show');
  document.getElementById('clientFormMsg').className = 'auth-msg';
  if (form.classList.contains('show') && isAdmin()) {
    carregarContadoresParaForm();
  }
}

async function carregarContadoresParaForm() {
  const listEl = document.getElementById('fContadoresList');
  if (!listEl) return;
  listEl.innerHTML = '<p style="font-size:12px;color:var(--text-light)">Carregando...</p>';

  try {
    const res = await supabaseProxy('listar_usuarios', {});

    if (res?.error) {
      listEl.innerHTML = `<p style="font-size:12px;color:var(--error)">Erro: ${escapeHtml(res.error)}</p>`;
      return;
    }

    const usuarios = res?.usuarios || [];
    if (!usuarios.length) {
      listEl.innerHTML = '<p style="font-size:12px;color:var(--text-light)">Nenhum contador cadastrado ainda.</p>';
      return;
    }

    listEl.innerHTML = usuarios.map(u => `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:4px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" value="${u.id}" style="width:14px;height:14px">
        <span>${escapeHtml(u.email)}</span>
      </label>
    `).join('');
  } catch(e) {
    listEl.innerHTML = '<p style="font-size:12px;color:var(--error)">Erro ao carregar contadores. Verifique se você tem permissão de admin.</p>';
  }
}

async function validarCNPJ(cnpj) {
  cnpj = cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  // Rejeitar sequências repetidas (00000000000000, 11111111111111, etc.)
  if (/^(\d)\1+$/.test(cnpj)) return false;
  const calc = (cnpj, len) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(cnpj[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(cnpj, 12) === parseInt(cnpj[12]) && calc(cnpj, 13) === parseInt(cnpj[13]);
}

async function checkPasswordStrength(pwd) {
  const bar = document.getElementById('pwdBar');
  const hint = document.getElementById('pwdHint');
  if (!bar) return;
  let score = 0;
  const checks = [
    [/.{8,}/, 'mínimo 8 caracteres'],
    [/[A-Z]/, '1 letra maiúscula'],
    [/[0-9]/, '1 número'],
    [/[^A-Za-z0-9]/, '1 caractere especial']
  ];
  const missing = checks.filter(([rx]) => !rx.test(pwd)).map(([,msg]) => msg);
  score = checks.filter(([rx]) => rx.test(pwd)).length;
  const levels = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];
  const labels = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  bar.style.width = `${score * 25}%`;
  bar.style.background = levels[score] || 'var(--border)';
  hint.textContent = score === 4 ? '✅ Senha forte' : `Faltando: ${missing.join(', ')}`;
  hint.style.color = score < 3 ? 'var(--error)' : score === 4 ? '#22c55e' : 'var(--text-light)';
}

async function updateCharCount() {
  const inp = document.getElementById('msgInput');
  const counter = document.getElementById('charCount');
  const len = inp.value.length;
  const max = 8000;
  counter.style.display = len > 100 ? 'block' : 'none';
  counter.textContent = `${len.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')}`;
  counter.style.color = len > 7000 ? 'var(--error)' : len > 6000 ? '#d97706' : 'var(--text-light)';
  document.getElementById('sendBtn').disabled = len > max;
}

async function maskCnpj(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 14);
  v = v.replace(/^(\d{2})(\d)/, '$1.$2');
  v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
  v = v.replace(/\.(\d{3})(\d)/, '.$1/$2');
  v = v.replace(/(\d{4})(\d)/, '$1-$2');
  input.value = v;
}

async function autoPreencherCNPJ(valor) {
  const cnpj = valor.replace(/\D/g, '');
  if (cnpj.length !== 14) return;
  if (!validarCNPJ(cnpj)) {
    const msgEl = document.getElementById('clientFormMsg');
    msgEl.textContent = 'CNPJ inválido — verifique os dígitos.';
    msgEl.className = 'auth-msg error';
    return;
  }
  const msgEl = document.getElementById('clientFormMsg');
  msgEl.textContent = 'Consultando Receita Federal...';
  msgEl.className = 'auth-msg';

  const dados = await consultarCNPJ(cnpj);
  if (!dados) {
    msgEl.textContent = 'CNPJ não encontrado na Receita Federal.';
    msgEl.className = 'auth-msg error';
    return;
  }

  // Preencher campos automaticamente
  const razao = document.getElementById('fRazao');
  const fantasia = document.getElementById('fFantasia');

  if (!razao.value) razao.value = dados.razao_social || '';
  if (!fantasia.value) fantasia.value = dados.nome_fantasia || '';

  // Detectar regime pelo Simples/MEI
  const regime = document.getElementById('fRegime');
  if (!regime.value) {
    if (dados.opcao_pelo_mei) regime.value = 'MEI';
    else if (dados.opcao_pelo_simples) regime.value = 'Simples Nacional';
  }

  const situacao = dados.descricao_situacao_cadastral || '';
  const cor = situacao.toLowerCase().includes('ativa') ? 'success' : 'error';
  msgEl.textContent = `Situação: ${situacao}`;
  msgEl.className = `auth-msg ${cor}`;
}

async function saveNewClient() {
  const razao = document.getElementById('fRazao').value.trim();
  const cnpj = document.getElementById('fCnpj').value.trim();
  const fantasia = document.getElementById('fFantasia').value.trim();
  const regime = document.getElementById('fRegime').value;
  const ie = document.getElementById('fIE').value.trim();
  const msgEl = document.getElementById('clientFormMsg');

  if (!razao || !cnpj) {
    msgEl.textContent = 'Razão social e CNPJ são obrigatórios.';
    msgEl.className = 'auth-msg error';
    return;
  }

  const cnpjLimpo = cnpj.replace(/[^0-9]/g, '').substring(0, 14);
  if (!validarCNPJ(cnpjLimpo)) {
    msgEl.textContent = 'CNPJ inválido — verifique os dígitos verificadores.';
    msgEl.className = 'auth-msg error';
    return;
  }
  const btn = document.querySelector('#newClientForm .btn-save');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  // Insert separado do select — evita conflito com RLS policy de SELECT
  const { error: insertError } = await sb.from('clientes').insert({
    razao_social: razao,
    cnpj: cnpjLimpo,
    nome_fantasia: fantasia || null,
    regime_tributario: regime || null,
    inscricao_estadual: ie || null,
    tem_empregado: document.getElementById('fTemEmpregado')?.value === 'true',
    user_id: currentUser.id
  });

  btn.disabled = false;
  btn.textContent = 'Salvar Empresa';

  if (insertError) {
    const msg = insertError.message.includes('duplicate') || insertError.code === '23505'
      ? 'CNPJ já cadastrado para este usuário.'
      : `Erro ao salvar: ${insertError.message}`;
    msgEl.textContent = msg;
    msgEl.className = 'auth-msg error';
    return;
  }

  // Buscar o registro recém-inserido para ter o ID
  const { data: novo, error: selectError } = await sb
    .from('clientes')
    .select('id, razao_social, cnpj, regime_tributario, nome_fantasia, tem_empregado')
    .eq('cnpj', cnpjLimpo)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (selectError || !novo) {
    // Insert funcionou mas não conseguiu buscar — recarregar lista
    await loadClientes();
    closeClientModal();
    return;
  }

  // Inserir vínculos com contadores selecionados
  if (isAdmin()) {
    const checkboxes = document.querySelectorAll('#fContadoresList input[type=checkbox]:checked');
    const userIds = Array.from(checkboxes).map(cb => cb.value);
    if (userIds.length > 0) {
      const vinculos = userIds.map(uid => ({
        cliente_id: novo.id,
        user_id: uid,
        criado_por: currentUser.id
      }));
      await sb.from('clientes_usuarios').insert(vinculos);
    }
  }

  registrarAuditLog('EMPRESA_CADASTRADA', 'clientes', novo.id, {
    razao_social: novo.razao_social, cnpj: novo.cnpj, regime: novo.regime_tributario
  });
  ['fRazao','fCnpj','fFantasia','fIE'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fRegime').value = '';
  toggleNewClientForm();
  setCurrentCliente(novo);
  closeClientModal();
  newChat();
  showToast('Empresa cadastrada com sucesso!', 'success');
}

async function gerenciarAcessos(clienteId, clienteNome) {
  // Reusar o modal de clientes com conteúdo dinâmico
  const listEl = document.getElementById('clientList');
  listEl.innerHTML = `
    <div style="margin-bottom:12px">
      <button onclick="renderClientList()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:13px;display:flex;align-items:center;gap:4px">
        <i data-lucide="arrow-left" style="width:14px;height:14px"></i> Voltar
      </button>
      <p style="font-weight:600;margin:8px 0 4px">${escapeHtml(clienteNome)}</p>
      <p style="font-size:12px;color:var(--text-light)">Marque os contadores com acesso a esta empresa</p>
    </div>
    <div id="acessosList" style="display:flex;flex-direction:column;gap:6px"></div>
    <button class="btn-save" style="width:100%;margin-top:12px" onclick="salvarAcessos('${clienteId}')">Salvar acessos</button>
    <div id="acessosMsg" class="auth-msg" style="margin-top:8px"></div>
  `;
  lucide.createIcons();

  // Carregar usuários e acessos atuais em paralelo
  const [resUsers, { data: atuais }] = await Promise.all([
    supabaseProxy('listar_usuarios', {}),
    sb.from('clientes_usuarios').select('user_id').eq('cliente_id', clienteId)
  ]);

  const comAcesso = new Set((atuais || []).map(a => a.user_id));
  const usuarios = resUsers?.usuarios || [];

  if (resUsers?.error) {
    document.getElementById('acessosList').innerHTML =
      `<p style="font-size:13px;color:var(--error)">Erro ao carregar usuários: ${escapeHtml(resUsers.error)}<br><small>Verifique se sua conta tem role 'admin' no user_metadata do Supabase.</small></p>`;
    return;
  }

  if (!usuarios.length) {
    document.getElementById('acessosList').innerHTML =
      '<p style="font-size:13px;color:var(--text-light)">Nenhum outro usuário cadastrado no sistema.</p>';
    return;
  }

  document.getElementById('acessosList').innerHTML = usuarios.map(u => `
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 0;border-bottom:1px solid var(--border)">
      <input type="checkbox" value="${u.id}" ${comAcesso.has(u.id) ? 'checked' : ''} style="width:15px;height:15px">
      <span>${escapeHtml(u.email)}</span>
    </label>
  `).join('');
}

async function salvarAcessos(clienteId) {
  const msgEl = document.getElementById('acessosMsg');
  const checkboxes = document.querySelectorAll('#acessosList input[type=checkbox]');
  const selecionados = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
  const desmarcados = Array.from(checkboxes).filter(cb => !cb.checked).map(cb => cb.value);

  msgEl.textContent = 'Salvando...';
  msgEl.className = 'auth-msg';

  try {
    // Remover vínculos desmarcados
    if (desmarcados.length) {
      await sb.from('clientes_usuarios')
        .delete()
        .eq('cliente_id', clienteId)
        .in('user_id', desmarcados);
    }

    // Inserir novos vínculos (upsert evita duplicatas)
    if (selecionados.length) {
      const vinculos = selecionados.map(uid => ({
        cliente_id: clienteId,
        user_id: uid,
        criado_por: currentUser.id
      }));
      await sb.from('clientes_usuarios').upsert(vinculos, { onConflict: 'cliente_id,user_id' });
    }

    registrarAuditLog('ACESSOS_ATUALIZADOS', 'clientes_usuarios', clienteId, {
      adicionados: selecionados.length, removidos: desmarcados.length
    });
    msgEl.textContent = 'Acessos salvos com sucesso.';
    msgEl.className = 'auth-msg success';
  } catch (e) {
    msgEl.textContent = 'Erro ao salvar acessos.';
    msgEl.className = 'auth-msg error';
  }
}


// ══════════════════════════════════════════════════════════════
// PERMISSÕES DE USUÁRIOS — modal dedicado
// ══════════════════════════════════════════════════════════════

const PERMS_LIST = [
  { id: 'agenda',        label: 'Agenda de Prazos',     icon: 'calendar-clock' },
  { id: 'documentos',    label: 'Documentos Fiscais',   icon: 'file-text' },
  { id: 'sped',          label: 'SPED EFD',             icon: 'layers' },
  { id: 'folha',         label: 'Folha de Pagamento',   icon: 'users' },
  { id: 'financeiro',    label: 'Financeiro',           icon: 'wallet' },
  { id: 'calculadora',   label: 'Calculadora',          icon: 'calculator' },
  { id: 'portal',        label: 'Portal do Cliente',    icon: 'external-link' },
  { id: 'arquivos',      label: 'Anexar Arquivos',      icon: 'paperclip' },
  { id: 'gerar_doc',     label: 'Gerar Documentos',     icon: 'file-down' },
  { id: 'exportar',      label: 'Exportar Conversa',    icon: 'download' },
  { id: 'compartilhar',  label: 'Compartilhar Chat',    icon: 'share-2' },
];

// ── PAINEL DE USUÁRIOS: abas Usuários + Convites ─────────────

async function abrirGerenciarPermissoes() {
  if (!isAdmin()) return;
  const modal = document.getElementById('permissoesModal');
  if (!modal) return;
  modal.style.display = 'flex';
  await _renderPainelUsuarios('usuarios');
}

async function _renderPainelUsuarios(aba) {
  const content = document.getElementById('permissoesContent');

  const tabs = `
    <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:8px">
      <button onclick="_renderPainelUsuarios('usuarios')"
        style="padding:6px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${aba==='usuarios'?'var(--accent)':'var(--card)'};
               color:${aba==='usuarios'?'#fff':'var(--text-light)'}">
        Usuários
      </button>
      <button onclick="_renderPainelUsuarios('convites')"
        style="padding:6px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${aba==='convites'?'var(--accent)':'var(--card)'};
               color:${aba==='convites'?'#fff':'var(--text-light)'}">
        Convites
      </button>
    </div>`;

  content.innerHTML = tabs + '<p style="color:var(--text-light);text-align:center;padding:24px;font-size:13px">Carregando...</p>';
  lucide.createIcons();

  if (aba === 'usuarios') await _renderAbaUsuarios(content, tabs);
  else                    await _renderAbaConvites(content, tabs);
}

async function _renderAbaUsuarios(content, tabs) {
  let usuarios;
  try {
    const res = await supabaseProxy('listar_usuarios', {});
    if (!res?.usuarios) throw new Error(res?.error || 'Sem dados');
    usuarios = res.usuarios;
  } catch(e) {
    content.innerHTML = tabs + `<p style="color:var(--error);font-size:13px;padding:12px">Erro: ${e.message}</p>`;
    return;
  }

  window._permUsuarios = {};
  usuarios.forEach(u => { window._permUsuarios[u.id] = [...(u.permissions || [])]; });

  const lista = usuarios.length === 0
    ? '<p style="color:var(--text-light);font-size:13px;text-align:center;padding:20px">Nenhum usuário encontrado.</p>'
    : usuarios.map(u => _renderCardUsuario(u)).join('');

  content.innerHTML = tabs + lista;
  lucide.createIcons();
}

function _renderCardUsuario(u) {
  const bloqueado = u.status === 'bloqueado';
  const isAdminUser = u.role === 'admin';
  const euMesmo = u.id === currentUser?.id;
  const badgeRole = isAdminUser
    ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">Admin</span>`
    : `<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:99px;font-size:11px">Contador</span>`;
  const badgeStatus = bloqueado
    ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:99px;font-size:11px">Bloqueado</span>`
    : `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:99px;font-size:11px">Ativo</span>`;

  const checkboxes = PERMS_LIST.map(p => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:8px;user-select:none;">
      <input type="checkbox" id="perm_${u.id}_${p.id}"
        ${(u.permissions||[]).includes(p.id) ? 'checked' : ''}
        onchange="togglePermLocal('${u.id}','${p.id}',this.checked)"
        style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer"
        ${isAdminUser ? 'disabled title="Admin tem acesso total"' : ''}>
      <i data-lucide="${p.icon}" style="width:12px;height:12px;color:var(--text-light)"></i>
      ${p.label}
    </label>`).join('');

  return `
    <div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;opacity:${bloqueado?'0.7':'1'}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text)">
          <i data-lucide="user" style="width:14px;height:14px;color:var(--text-light)"></i>
          ${escapeHtml(u.email)}
          ${euMesmo ? '<span style="font-size:11px;color:var(--text-light)">(você)</span>' : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center">${badgeRole}${badgeStatus}</div>
      </div>

      ${!isAdminUser ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${checkboxes}</div>` : ''}

      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${!isAdminUser ? `
          <button id="savebtn_${u.id}" onclick="salvarPermissoesUsuario('${u.id}')"
            style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">
            Salvar permissões
          </button>` : ''}
        ${!euMesmo ? `
          <button onclick="_toggleRole('${u.id}','${u.role}')"
            style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text)">
            ${isAdminUser ? '↓ Tornar Contador' : '↑ Tornar Admin'}
          </button>
          <button onclick="_toggleStatus('${u.id}','${u.status}')"
            style="background:${bloqueado?'#dcfce7':'#fee2e2'};border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:${bloqueado?'#16a34a':'#dc2626'}">
            ${bloqueado ? '✓ Reativar' : '⊘ Bloquear'}
          </button>` : ''}
        <span id="permsg_${u.id}" style="font-size:12px;color:var(--text-light)"></span>
      </div>
    </div>`;
}

async function _renderAbaConvites(content, tabs) {
  let convites = [];
  try {
    const res = await supabaseProxy('listar_convites', {});
    convites = res?.convites || [];
  } catch(e) {}

  const BASE_URL = window.location.origin + window.location.pathname;

  const lista = convites.length === 0
    ? '<p style="color:var(--text-light);font-size:13px;text-align:center;padding:12px 0">Nenhum convite gerado ainda.</p>'
    : convites.map(cv => {
        const expirado = new Date(cv.expires_at) < new Date();
        const usado    = !!cv.usado_por;
        const link     = `${BASE_URL}?convite=${cv.token}`;
        const badge    = usado ? '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:99px;font-size:11px">Usado</span>'
                       : expirado ? '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:99px;font-size:11px">Expirado</span>'
                       : '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:99px;font-size:11px">Ativo</span>';
        const roleLabel = cv.role === 'admin' ? 'Admin' : 'Contador';
        return `
          <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;opacity:${expirado||usado?'0.6':'1'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap">
              <span style="font-size:12px;font-weight:600;color:var(--text)">${roleLabel} ${cv.email ? '→ '+escapeHtml(cv.email) : ''}</span>
              <div style="display:flex;gap:6px;align-items:center">${badge}</div>
            </div>
            <div style="font-size:11px;color:var(--text-light);margin-bottom:8px">
              Expira: ${new Date(cv.expires_at).toLocaleDateString('pt-BR')}
            </div>
            <div style="display:flex;gap:6px">
              ${!usado && !expirado ? `
                <button onclick="navigator.clipboard.writeText('${link}').then(()=>showToast('Link copiado!','success'))"
                  style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer">
                  Copiar link
                </button>` : ''}
              <button onclick="_revogarConvite('${cv.id}')"
                style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;color:var(--text)">
                Remover
              </button>
            </div>
          </div>`;
      }).join('');

  content.innerHTML = tabs + `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px">
      <p style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text)">Gerar novo convite</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select id="_conviteRole" style="flex:1;min-width:120px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg)">
          <option value="contador">Contador</option>
          <option value="admin">Admin</option>
        </select>
        <input id="_conviteEmail" placeholder="E-mail (opcional)" type="email"
          style="flex:2;min-width:160px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg)">
        <select id="_conviteDias" style="flex:1;min-width:100px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg)">
          <option value="1">1 dia</option>
          <option value="3">3 dias</option>
          <option value="7" selected>7 dias</option>
          <option value="30">30 dias</option>
        </select>
      </div>
      <button onclick="_gerarConvite()"
        style="width:100%;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer">
        Gerar link de convite
      </button>
      <div id="_conviteGeradoBox" style="display:none;margin-top:10px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
        <p style="font-size:12px;font-weight:600;color:#16a34a;margin-bottom:4px">✅ Link gerado:</p>
        <input id="_conviteGeradoUrl" readonly style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #bbf7d0;border-radius:6px;font-size:11px;font-family:monospace;background:#fff">
        <button onclick="navigator.clipboard.writeText(document.getElementById('_conviteGeradoUrl').value).then(()=>showToast('Copiado!','success'))"
          style="margin-top:6px;background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">
          Copiar
        </button>
      </div>
    </div>
    <p style="font-size:12px;font-weight:600;color:var(--text-light);margin-bottom:8px">Convites gerados</p>
    ${lista}`;
  lucide.createIcons();
}

async function _gerarConvite() {
  const role  = document.getElementById('_conviteRole')?.value  || 'contador';
  const email = document.getElementById('_conviteEmail')?.value.trim() || null;
  const dias  = parseInt(document.getElementById('_conviteDias')?.value) || 7;

  const res = await supabaseProxy('criar_convite', { role, email, dias });
  if (!res?.ok) { showToast(res?.erro || 'Erro ao gerar convite', 'error'); return; }

  const link = `${window.location.origin}${window.location.pathname}?convite=${res.token}`;
  const box  = document.getElementById('_conviteGeradoBox');
  const inp  = document.getElementById('_conviteGeradoUrl');
  if (box) { box.style.display = 'block'; inp.value = link; }
  navigator.clipboard.writeText(link).catch(() => {});
  showToast('Convite gerado!', 'success');
}

async function _revogarConvite(conviteId) {
  const ok = await supabaseProxy('revogar_convite', { conviteId });
  if (ok?.ok) { showToast('Convite removido', 'success'); _renderPainelUsuarios('convites'); }
  else          showToast('Erro ao remover', 'error');
}

async function _toggleRole(userId, roleAtual) {
  const novoRole = roleAtual === 'admin' ? 'contador' : 'admin';
  const label    = novoRole === 'admin' ? 'tornar admin' : 'rebaixar para contador';
  if (!confirm(`Confirma ${label} este usuário?`)) return;
  const res = await supabaseProxy('definir_role', { userId, role: novoRole });
  if (res?.ok) { showToast('Role atualizado', 'success'); _renderPainelUsuarios('usuarios'); }
  else          showToast(res?.erro || 'Erro', 'error');
}

async function _toggleStatus(userId, statusAtual) {
  const novoStatus = statusAtual === 'bloqueado' ? 'ativo' : 'bloqueado';
  const label      = novoStatus === 'bloqueado' ? 'bloquear' : 'reativar';
  if (!confirm(`Confirma ${label} este usuário?`)) return;
  const res = await supabaseProxy('definir_status_usuario', { userId, status: novoStatus });
  if (res?.ok) { showToast('Status atualizado', 'success'); _renderPainelUsuarios('usuarios'); }
  else          showToast(res?.erro || 'Erro', 'error');
}

function togglePermLocal(userId, permId, checked) {
  if (!window._permUsuarios) window._permUsuarios = {};
  if (!window._permUsuarios[userId]) window._permUsuarios[userId] = [];
  if (checked) {
    if (!window._permUsuarios[userId].includes(permId)) window._permUsuarios[userId].push(permId);
  } else {
    window._permUsuarios[userId] = window._permUsuarios[userId].filter(p => p !== permId);
  }
}

async function salvarPermissoesUsuario(userId) {
  const btn = document.getElementById('savebtn_' + userId);
  const msg = document.getElementById('permsg_' + userId);
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  const permissions = window._permUsuarios?.[userId] || [];
  const res = await definirPermissoes(userId, permissions).catch(() => null);
  const ok  = res === true || res?.ok === true;
  if (btn) { btn.disabled = false; btn.textContent = 'Salvar permissões'; }
  if (msg) {
    msg.textContent = ok ? '✅ Salvo' : '❌ Erro';
    msg.style.color = ok ? '#16a34a' : '#ef4444';
    setTimeout(() => { if(msg) msg.textContent = ''; }, 3000);
  }
}

function fecharPermissoesModal() {
  const m = document.getElementById('permissoesModal');
  if (m) m.style.display = 'none';
  window._permUsuarios = {};
}
