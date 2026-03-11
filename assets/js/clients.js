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
      <button onclick="verArquivosCliente('${cl.id}','${escapeHtml(cl.razao_social).replace(/'/g,'')}')" title="Arquivos recebidos" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-light);display:flex;align-items:center">
        <i data-lucide="inbox" style="width:15px;height:15px"></i>
      </button>
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
  exibirChecklistOnboarding(novo);
}

// ── Checklist de onboarding ─────────────────────────────────
function exibirChecklistOnboarding(cliente) {
  const pendencias = [];
  if (!cliente.cnpj)               pendencias.push({ icon: 'hash',        texto: 'Preencher CNPJ' });
  if (!cliente.regime_tributario)  pendencias.push({ icon: 'landmark',    texto: 'Definir regime tributário' });
  if (!cliente.nome_fantasia)      pendencias.push({ icon: 'tag',         texto: 'Adicionar nome fantasia' });

  // Verificar contador vinculado e portal (async, exibe depois)
  Promise.all([
    sb.from('clientes_usuarios').select('id',{count:'exact',head:true}).eq('cliente_id', cliente.id),
    sb.from('portal_tokens').select('id',{count:'exact',head:true}).eq('cliente_id', cliente.id).gt('expira_em', new Date().toISOString()),
  ]).then(([{count: cContador}, {count: cPortal}]) => {
    if (!cContador) pendencias.push({ icon: 'user-check', texto: 'Vincular um contador' });
    if (!cPortal)   pendencias.push({ icon: 'link',       texto: 'Gerar link do portal' });
    if (!pendencias.length) return; // tudo ok, não exibir

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--card);border-radius:16px;padding:24px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <div style="width:36px;height:36px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center">
            <i data-lucide="clipboard-list" style="width:18px;height:18px;color:#d97706"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:700">Empresa cadastrada!</div>
            <div style="font-size:12px;color:var(--text-light)">Complete o cadastro para começar</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
          ${pendencias.map(p => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border)">
              <i data-lucide="${p.icon}" style="width:15px;height:15px;color:#d97706;flex-shrink:0"></i>
              <span style="font-size:13px">${p.texto}</span>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="this.closest('[style*=fixed]').remove()"
            style="flex:1;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:13px;color:var(--text)">
            Depois
          </button>
          <button onclick="openClientModal();this.closest('[style*=fixed]').remove()"
            style="flex:1;padding:9px;border:none;border-radius:8px;background:var(--accent);cursor:pointer;font-size:13px;color:#fff;font-weight:600">
            Ver empresa
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    if (window.lucide) lucide.createIcons();
  }).catch(() => {});
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
  { id: 'agenda',        label: 'Agenda Fiscal',      icon: 'calendar-clock' },
  { id: 'documentos',    label: 'Documentos Fiscais', icon: 'file-text' },
  { id: 'sped',          label: 'SPED EFD',           icon: 'layers' },
  { id: 'folha',         label: 'Dep. Pessoal',       icon: 'users' },
  { id: 'financeiro',    label: 'Financeiro',         icon: 'bar-chart-2' },
  { id: 'perfil_empresa',label: 'Perfil da Empresa',  icon: 'building-2' },
  { id: 'portal',        label: 'Portal do Cliente',  icon: 'link' },
  { id: 'calculadora',   label: 'Calculadora',        icon: 'calculator' },
  { id: 'honorarios',    label: 'Honorários',         icon: 'receipt'  },
  { id: 'exportar',      label: 'Exportar Conversa',  icon: 'download' },
  { id: 'compartilhar',  label: 'Compartilhar Chat',  icon: 'share-2' },
  { id: 'arquivos',      label: 'Anexar Arquivos',    icon: 'paperclip' },
  { id: 'gerar_doc',     label: 'Gerar Documentos',   icon: 'file-plus' },
];

async function abrirGerenciarPermissoes() {
  if (!isAdmin() && !isMaster()) return;
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
    const todos = res.usuarios;

    // Filtrar apenas usuários do escritório do admin logado
    const { data: vinculos } = await sb
      .from('escritorio_usuarios')
      .select('user_id')
      .eq('escritorio_id', (await sb.from('escritorios').select('id').eq('owner_id', currentUser.id).limit(1)).data?.[0]?.id || '');

    const idsEscritorio = new Set((vinculos || []).map(v => v.user_id));
    usuarios = todos.filter(u => idsEscritorio.has(u.id));
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


// ============================================================
// ARQUIVOS RECEBIDOS DO PORTAL — painel dentro do clientModal
// ============================================================
async function verArquivosCliente(clienteId, clienteNome) {
  if (!currentUser?.id) return;

  const listEl = document.getElementById('clientList');
  listEl.innerHTML = `
    <div style="margin-bottom:12px">
      <button onclick="renderClientList()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:13px;display:flex;align-items:center;gap:4px">
        <i data-lucide="arrow-left" style="width:14px;height:14px"></i> Voltar
      </button>
      <p style="font-weight:600;margin:8px 0 2px">${escapeHtml(clienteNome)}</p>
      <p style="font-size:12px;color:var(--text-light);margin:0">Arquivos enviados pelo cliente via portal</p>
    </div>
    <div id="arquivosClienteLista"><p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Carregando...</p></div>
  `;
  lucide.createIcons();

  try {
    const { data, error } = await sb
      .from('portal_uploads')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('cliente_id', clienteId)
      .order('criado_em', { ascending: false })
      .limit(50);

    if (error) throw error;

    const el = document.getElementById('arquivosClienteLista');
    if (!el) return;

    if (!data?.length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Nenhum arquivo recebido deste cliente ainda.</p>';
      return;
    }

    const iconeMap = { pdf:'file-text', nfe:'scan-line', planilha:'table', imagem:'image', guia:'receipt', extrato:'landmark', outro:'file' };
    const corMap   = { pdf:'#dc2626', nfe:'#2563eb', planilha:'#16a34a', imagem:'#7c3aed', guia:'#ea580c', extrato:'#0891b2', outro:'#64748b' };
    const labelMap = { pdf:'PDF', nfe:'NF-e / XML', planilha:'Planilha', imagem:'Imagem', guia:'Guia', extrato:'Extrato', outro:'Outro' };

    // Guardar uploads no window para acesso pelo botão
    window._uploadsPortal = {};
    data.forEach(u => { window._uploadsPortal[u.id] = u; });

    // Agrupar por tipo
    const grupos = {};
    data.forEach(u => {
      const tipo = u.tipo_arquivo || 'outro';
      if (!grupos[tipo]) grupos[tipo] = [];
      grupos[tipo].push(u);
    });

    const renderItem = u => {
      const fmt   = new Date(u.criado_em).toLocaleDateString('pt-BR');
      const hora  = new Date(u.criado_em).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      const tipo  = u.tipo_arquivo || 'outro';
      const icone = iconeMap[tipo] || 'file';
      const cor   = corMap[tipo]   || '#64748b';
      const nome  = escapeHtml(u.nome_arquivo || '');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:30px;height:30px;border-radius:8px;background:var(--sidebar-hover);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i data-lucide="${icone}" style="width:15px;height:15px;color:${cor}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:${u.lido?'400':'600'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nome}</div>
          <div style="font-size:11px;color:var(--text-light);margin-top:2px">
            ${u.tamanho_kb ? u.tamanho_kb+' KB · ' : ''}${fmt} às ${hora}${u.descricao ? ' · '+escapeHtml(u.descricao) : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
          ${!u.lido ? '<span style="font-size:10px;font-weight:700;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:10px">Novo</span>' : ''}
          <button data-uid="${u.id}" onclick="baixarArquivoPortal(this.dataset.uid)"
            style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;color:var(--text);display:flex;align-items:center;gap:3px">
            <i data-lucide="download" style="width:11px;height:11px"></i> Baixar
          </button>
          <button data-uid="${u.id}" onclick="excluirArquivoPortal(this.dataset.uid, this)"
            style="font-size:11px;padding:4px 8px;border:1px solid #fca5a5;border-radius:6px;background:var(--bg);cursor:pointer;color:#dc2626;display:flex;align-items:center;gap:3px">
            <i data-lucide="trash-2" style="width:11px;height:11px"></i>
          </button>
        </div>
      </div>`;
    };

    el.innerHTML = Object.entries(grupos).map(([tipo, itens]) => {
      const label = labelMap[tipo] || tipo.toUpperCase();
      const cor   = corMap[tipo] || '#64748b';
      const icone = iconeMap[tipo] || 'file';
      const novos = itens.filter(u => !u.lido).length;
      return `
        <div style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;padding:8px 0 4px;font-size:11px;font-weight:700;color:${cor};text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid ${cor}22">
            <i data-lucide="${icone}" style="width:12px;height:12px"></i>
            ${label}
            <span style="font-weight:400;color:var(--text-light)">(${itens.length})</span>
            ${novos ? `<span style="margin-left:auto;background:#dbeafe;color:#1d4ed8;font-size:10px;padding:1px 6px;border-radius:10px">${novos} novo${novos>1?'s':''}</span>` : ''}
          </div>
          ${itens.map(renderItem).join('')}
        </div>`;
    }).join('');

    lucide.createIcons();
  } catch(e) {
    const el = document.getElementById('arquivosClienteLista');
    if (el) el.innerHTML = '<p style="font-size:13px;color:var(--error);text-align:center;padding:20px">Erro: '+escapeHtml(e.message)+'</p>';
  }
}

async function baixarArquivoPortal(uid) {
  const u = (window._uploadsPortal || {})[uid];
  if (!u) return;
  try {
    const { data, error } = await sb.storage.from('portal-uploads').createSignedUrl(u.storage_path, 60);
    if (error) throw error;
    const a = Object.assign(document.createElement('a'), { href: data.signedUrl, download: u.nome_arquivo || 'arquivo', target: '_blank' });
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 100);
    await sb.from('portal_uploads').update({ lido: true }).eq('id', uid).eq('user_id', currentUser.id);
  } catch(e) {
    showToast('Erro ao baixar: ' + e.message, 'error');
  }
}

async function excluirArquivoPortal(uid, btn) {
  const u = (window._uploadsPortal || {})[uid];
  if (!u) return;
  if (!confirm('Excluir o arquivo "' + (u.nome_arquivo || 'arquivo') + '" permanentemente?')) return;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    // 1. Remover do Storage
    const { error: errStorage } = await sb.storage.from('portal-uploads').remove([u.storage_path]);
    if (errStorage) throw errStorage;

    // 2. Remover registro da tabela
    const { error: errDb, count } = await sb.from('portal_uploads').delete()
      .eq('id', uid)
      .eq('user_id', currentUser.id)
      .select('id', { count: 'exact', head: true });
    if (errDb) throw errDb;
    if (count === 0) throw new Error('Sem permissão para excluir este arquivo (RLS).');

    // 3. Remover do cache local e do DOM
    delete window._uploadsPortal[uid];
    btn.closest('div[style*="border-bottom"]').remove();

    // 4. Se lista vazia, mostrar mensagem
    const el = document.getElementById('arquivosClienteLista');
    if (el && !Object.keys(window._uploadsPortal).length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Nenhum arquivo recebido deste cliente ainda.</p>';
    }

    showToast('Arquivo excluído com sucesso.', 'success');
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Excluir';
    showToast('Erro ao excluir: ' + e.message, 'error');
  }
}
