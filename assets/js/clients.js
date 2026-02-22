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
  // Admin busca todos; outros buscam via vínculo clientes_usuarios
  let data, error;
  if (isAdmin()) {
    ({ data, error } = await sb
      .from('clientes')
      .select('id, razao_social, cnpj, regime_tributario, nome_fantasia')
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

async function setCurrentCliente(cliente) {
  currentCliente = cliente;
  localStorage.setItem('lastClienteId', cliente.id);

  const displayName = cliente.nome_fantasia || cliente.razao_social;

  // Atualizar UI
  document.getElementById('sidebarClientName').textContent = displayName;
  const badge = document.getElementById('headerClientBadge');
  document.getElementById('headerClientName').textContent = displayName;
  badge.style.display = 'flex';

  // Recarregar chats filtrados
  loadChats();
}

async function openClientModal() {
  closeSidebar(); // fecha sidebar antes de abrir modal no mobile
  document.getElementById('clientModal').classList.remove('hidden');
  renderClientList();
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
      .select('id, razao_social, cnpj, regime_tributario, nome_fantasia')
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

  el.innerHTML = data.map(cl => `
    <div class="client-item ${currentCliente?.id === cl.id ? 'active' : ''}" style="position:relative">
      <div style="flex:1;cursor:pointer" onclick="selectCliente('${cl.id}')">
        <div class="client-item-name">${escapeHtml(cl.razao_social)}</div>
        <div class="client-item-cnpj">CNPJ: ${escapeHtml(cl.cnpj)}</div>
      </div>
      ${cl.regime_tributario ? `<span class="client-item-regime">${escapeHtml(cl.regime_tributario)}</span>` : ''}
      ${isAdmin() ? `<button onclick="gerenciarAcessos('${cl.id}','${escapeHtml(cl.razao_social).replace(/'/g,'')}')" title="Gerenciar acessos" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-light);display:flex;align-items:center">
        <i data-lucide="users" style="width:15px;height:15px"></i>
      </button>` : ''}
    </div>`).join('');

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
    .select('id, razao_social, cnpj, regime_tributario, nome_fantasia')
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


// ══════════════════════════════════════════════════
// PERMISSÕES GLOBAIS POR USUÁRIO (admin only)
// ══════════════════════════════════════════════════
async 

async

// ══════════════════════════════════════════════════════════════
// PERMISSÕES DE USUÁRIOS — modal dedicado
// ══════════════════════════════════════════════════════════════

const PERMS_LIST = [
  { id: 'documentos',  label: 'Documentos Fiscais', icon: 'file-text' },
  { id: 'sped',        label: 'SPED EFD',           icon: 'layers' },
  { id: 'exportar',    label: 'Exportar Conversa',  icon: 'download' },
  { id: 'calculadora', label: 'Calculadora',         icon: 'calculator' },
];

async function abrirGerenciarPermissoes() {
  if (!isAdmin()) return;
  const modal = document.getElementById('permissoesModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const content = document.getElementById('permissoesContent');
  content.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:24px;font-size:13px">Carregando usuários...</p>';
  lucide.createIcons();

  let usuarios;
  try {
    const res = await supabaseProxy('listar_usuarios', {});
    if (!res?.usuarios) throw new Error(res?.error || 'Sem dados');
    usuarios = res.usuarios;
  } catch(e) {
    content.innerHTML = `<p style="color:var(--error);font-size:13px;padding:12px">Erro ao carregar: ${e.message}</p>`;
    return;
  }

  // Guardar estado das permissões indexado por userId para uso no save
  window._permUsuarios = {};
  usuarios.forEach(u => { window._permUsuarios[u.id] = [...(u.permissions || [])]; });

  content.innerHTML = usuarios.length === 0
    ? '<p style="color:var(--text-light);font-size:13px;text-align:center;padding:20px">Nenhum usuário encontrado.</p>'
    : usuarios.map(u => renderPermUsuario(u)).join('');

  lucide.createIcons();
}

function renderPermUsuario(u) {
  const permsAtivas = u.permissions || [];
  const checkboxes = PERMS_LIST.map(p => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:8px;user-select:none;">
      <input type="checkbox" id="perm_${u.id}_${p.id}" data-uid="${u.id}" data-perm="${p.id}"
        ${permsAtivas.includes(p.id) ? 'checked' : ''}
        onchange="togglePermLocal('${u.id}','${p.id}',this.checked)"
        style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer">
      <i data-lucide="${p.icon}" style="width:12px;height:12px;color:var(--text-light)"></i>
      ${p.label}
    </label>`).join('');

  return `
    <div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px;">
        <i data-lucide="user" style="width:14px;height:14px;color:var(--text-light)"></i>
        ${escapeHtml(u.email)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${checkboxes}</div>
      <button id="savebtn_${u.id}"
        onclick="salvarPermissoesUsuario('${u.id}', '${escapeHtml(u.email)}')"
        style="background:var(--accent);color:var(--user-text);border:none;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;">
        Salvar
      </button>
      <span id="permsg_${u.id}" style="font-size:12px;margin-left:8px;color:var(--text-light)"></span>
    </div>`;
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

async function salvarPermissoesUsuario(userId, email) {
  const btn = document.getElementById('savebtn_' + userId);
  const msg = document.getElementById('permsg_' + userId);
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  if (msg) { msg.textContent = ''; }

  const permissions = window._permUsuarios?.[userId] || [];
  let ok = false;
  try {
    const res = await definirPermissoes(userId, permissions);
    ok = res === true || res?.ok === true;
  } catch(e) { ok = false; }

  if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  if (msg) {
    msg.textContent = ok ? '✅ Salvo' : '❌ Erro ao salvar';
    msg.style.color = ok ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)';
    setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
  }
}

function fecharPermissoesModal() {
  const m = document.getElementById('permissoesModal');
  if (m) m.style.display = 'none';
  window._permUsuarios = {};
}
