// ============================================================
// PROFILE.JS — Perfil, Avatar, CRC, Notificações
// ============================================================

// ============================================
// PERFIL + NOTIFICAÇÕES
// ============================================

const OBRIGACOES_FISCAIS = [
  { id: 'das',        label: 'DAS Simples Nacional',  desc: 'Dia 20 de cada mês',        dia: 20, mensal: true  },
  { id: 'dctfweb',    label: 'DCTFWeb',               desc: 'Último dia útil do mês',    dia: 28, mensal: true  },
  { id: 'efd_reinf',  label: 'EFD-Reinf',             desc: 'Dia 15 de cada mês',        dia: 15, mensal: true  },
  { id: 'esocial',    label: 'eSocial (folha)',        desc: 'Dia 15 de cada mês',        dia: 15, mensal: true  },
  { id: 'efd_contrib',label: 'EFD-Contribuições',     desc: '10º dia útil do 2º mês',    dia: 10, mensal: true  },
  { id: 'dasn_simei', label: 'DASN-SIMEI (MEI) ⚠ Exclusivo MEI', desc: 'Declaração anual — Até 31/05 de cada ano', dia: 31, mes: 5, somenteMei: true },
  { id: 'defis',      label: 'DEFIS (Simples)',        desc: 'Até 31/03 anual',           dia: 31, mes: 3        },
  { id: 'ecd',        label: 'ECD',                   desc: 'Até 30/06 anual',           dia: 30, mes: 6        },
  { id: 'ecf',        label: 'ECF',                   desc: 'Até 31/07 anual',           dia: 31, mes: 7        },
  { id: 'dirpf',      label: 'DIRPF (PF)',            desc: 'Até 30/05 anual',           dia: 30, mes: 5        },
];


// ============================================
// PERFIS_USUARIOS — banco centralizado de perfil
// ============================================


async function carregarPerfil() {
  if (!currentUser) return null;
  try {
    const { data } = await sb
      .from('perfis_usuarios')
      .select('nome, avatar_url, crc, cpf, cod_mun, cnpj_escritorio')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    // Fallback para metadados do Google OAuth
    const meta = currentUser.user_metadata || {};
    const googleName = meta.full_name || meta.name || '';
    const googleAvatar = meta.avatar_url || meta.picture || '';

    perfilCache = {
      nome: data?.nome || googleName || '',
      avatar_url: data?.avatar_url || googleAvatar || '',
      crc: data?.crc || '',
      cpf: data?.cpf || '',
      cod_mun: data?.cod_mun || '',
      cnpj_escritorio: data?.cnpj_escritorio || ''
    };

    // Primeira vez com Google: salvar no banco automaticamente
    if (!data && googleName) {
      sb.from('perfis_usuarios').upsert({
        user_id: currentUser.id,
        nome: googleName,
        avatar_url: googleAvatar,
        atualizado_em: new Date().toISOString()
      }, { onConflict: 'user_id' }).catch(() => {});
    }

    return perfilCache;
  } catch(e) {
    perfilCache = {};
    return {};
  }
}

async function salvarPerfilBanco(campos) {
  if (!currentUser) return false;
  const { error } = await sb
    .from('perfis_usuarios')
    .upsert({ user_id: currentUser.id, ...campos, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' });
  if (!error && perfilCache) Object.assign(perfilCache, campos);
  return !error;
}

async function atualizarNomeHeader() {
  const nome = perfilCache?.nome || currentUser?.user_metadata?.nome;
  const email = currentUser?.email || '';
  const display = nome || email.split('@')[0] || 'usuário';
  document.getElementById('userEmail').textContent = display;

  // Atualizar avatar no header
  const wrap = document.getElementById('headerAvatarWrap');
  if (wrap && perfilCache?.avatar_url) {
    wrap.innerHTML = `<img src="${perfilCache.avatar_url}" class="header-avatar" alt="avatar">`;
  } else if (wrap) {
    wrap.innerHTML = '<i data-lucide="user" style="width:14px;height:14px;flex-shrink:0"></i>';
    lucide.createIcons();
  }
}

async function openProfile() {
  const modal = document.getElementById('profileModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // prevenir scroll do body

  // Resetar para aba Conta
  switchProfileTab('conta', modal.querySelector('.doc-tab'));
  setTimeout(() => document.getElementById('profileNome')?.focus(), 80);

  // Carregar perfil
  const perfil = await carregarPerfil();
  const email = currentUser?.email || '';

  // Avatar
  const avatarEl = document.getElementById('profileAvatar');
  if (perfil?.avatar_url) {
    avatarEl.innerHTML = `<img src="${perfil.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="avatar">`;
  } else {
    const inicial = (perfil?.nome || email)[0]?.toUpperCase() || '?';
    avatarEl.textContent = inicial;
  }

  // Nome e email no header do modal
  const nomeDisplay = document.getElementById('profileNomeDisplay');
  if (nomeDisplay) nomeDisplay.textContent = perfil?.nome || email;
  document.getElementById('profileEmailDisplay').textContent = email;

  // Campos editáveis
  document.getElementById('profileNome').value = perfil?.nome || '';
  const crcEl = document.getElementById('profileCRC');
  if (crcEl) crcEl.value = perfil?.crc || '';
  const cpfEl = document.getElementById('profileCPF');
  if (cpfEl) cpfEl.value = perfil?.cpf || '';
  const cnpjEscEl = document.getElementById('profileCNPJEsc');
  if (cnpjEscEl) cnpjEscEl.value = perfil?.cnpj_escritorio || '';
  const codMunEl = document.getElementById('profileCodMun');
  if (codMunEl) codMunEl.value = perfil?.cod_mun || '';

  // Tema atual
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const toggle = document.getElementById('profileThemeToggle');
  if (toggle) toggle.checked = isDark;

  // Listener de força de senha
  const pwdInput = document.getElementById('profileNewPwd');
  if (pwdInput) pwdInput.oninput = function() {
    checkPasswordStrengthEl(this.value, 'pwdBar2', 'pwdHint2');
  };

  lucide.createIcons();
}

async function closeProfile() {
  document.body.style.overflow = ''; // restaurar scroll
  document.getElementById('profileModal').style.display = 'none';
  document.getElementById('profilePwdMsg').className = 'auth-msg';
  document.getElementById('profileNotifMsg').className = 'auth-msg';
}


async function checkPasswordStrengthEl(pwd, barId, hintId) {
  const bar = document.getElementById(barId);
  const hint = document.getElementById(hintId);
  if (!bar || !hint) return;
  const checks = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
  const labels = ['mín. 8 chars', '1 maiúscula', '1 número', '1 especial'];
  const missing = checks.map((rx, i) => rx.test(pwd) ? null : labels[i]).filter(Boolean);
  const score = 4 - missing.length;
  const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];
  bar.style.width = `${score * 25}%`;
  bar.style.background = colors[score] || 'var(--border)';
  hint.textContent = score === 4 ? '✅ Senha forte' : `Faltando: ${missing.join(', ')}`;
  hint.style.color = score < 3 ? 'var(--error)' : score === 4 ? '#22c55e' : 'var(--text-light)';
}

async function salvarNome() {
  const nome         = document.getElementById('profileNome').value.trim();
  const crc          = document.getElementById('profileCRC')?.value.trim() || '';
  const cpf          = (document.getElementById('profileCPF')?.value || '').replace(/\D/g,'');
  const cnpj_escritorio = (document.getElementById('profileCNPJEsc')?.value || '').replace(/\D/g,'');
  const cod_mun      = document.getElementById('profileCodMun')?.value.trim() || '';
  const msgEl = document.getElementById('profileNomeMsg');
  const btn = event.target;

  btn.disabled = true; btn.textContent = 'Salvando...';
  const ok = await salvarPerfilBanco({ nome, crc, cpf, cnpj_escritorio, cod_mun });
  btn.disabled = false; btn.textContent = 'Salvar dados';

  if (!ok) {
    msgEl.textContent = 'Erro ao salvar. Tente novamente.';
    msgEl.className = 'auth-msg error';
  } else {
    atualizarNomeHeader();
    msgEl.textContent = '✅ Nome salvo com sucesso.';
    msgEl.className = 'auth-msg success';
  }
}

async function salvarSenha() {
  const pwd = document.getElementById('profileNewPwd').value;
  const confirm = document.getElementById('profileConfirmPwd').value;
  const msgEl = document.getElementById('profilePwdMsg');

  if (!pwd) return;
  if (pwd.length < 8) { msgEl.textContent = 'Mínimo 8 caracteres.'; msgEl.className = 'auth-msg error'; return; }
  if (!/[A-Z]/.test(pwd)) { msgEl.textContent = 'Inclua ao menos 1 letra maiúscula.'; msgEl.className = 'auth-msg error'; return; }
  if (!/[0-9]/.test(pwd)) { msgEl.textContent = 'Inclua ao menos 1 número.'; msgEl.className = 'auth-msg error'; return; }
  if (pwd !== confirm) { msgEl.textContent = 'As senhas não coincidem.'; msgEl.className = 'auth-msg error'; return; }

  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Salvando...';
  const { error } = await sb.auth.updateUser({ password: pwd });
  btn.disabled = false; btn.textContent = 'Salvar nova senha';

  if (error) {
    msgEl.textContent = 'Erro ao salvar. Tente novamente.';
    msgEl.className = 'auth-msg error';
  } else {
    msgEl.textContent = '✅ Senha alterada com sucesso.';
    msgEl.className = 'auth-msg success';
    document.getElementById('profileNewPwd').value = '';
    document.getElementById('profileConfirmPwd').value = '';
  }
}

async function toggleThemeFromProfile(isDark) {
  const theme = isDark ? 'dark' : 'light';
  localStorage.setItem('theme', theme);
  setTheme(theme);
  if (currentUser) sb.auth.updateUser({ data: { theme } });
}

// ---- NOTIFICAÇÕES ----

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file || !currentUser) return;

  // Validar tipo e tamanho (máx 2MB)
  if (!file.type.startsWith('image/')) {
    showToast('Selecione uma imagem válida (JPG, PNG ou WebP).', 'warn');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('A imagem deve ter no máximo 2MB.', 'warn');
    return;
  }

  const avatarEl = document.getElementById('profileAvatar');
  avatarEl.innerHTML = '<i data-lucide="loader" style="width:20px;height:20px;animation:spin 1s linear infinite"></i>';
  lucide.createIcons();

  try {
    // Upload para Supabase Storage bucket 'avatars'
    const ext = file.name.split('.').pop();
    const path = `${currentUser.id}/avatar.${ext}`;

    const { error: upErr } = await sb.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) throw upErr;

    // Gerar URL pública
    const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
    const avatar_url = urlData.publicUrl + '?t=' + Date.now(); // cache bust

    // Salvar URL no banco
    await salvarPerfilBanco({ avatar_url });

    // Atualizar UI
    avatarEl.innerHTML = `<img src="${avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="avatar">`;
    atualizarNomeHeader();

  } catch(e) {
    avatarEl.textContent = (perfilCache?.nome || currentUser?.email || '?')[0]?.toUpperCase();
    showToast('Erro ao enviar imagem. Verifique o bucket avatars no Supabase.', 'error');
  }

  input.value = ''; // resetar input
}

async function carregarConfigNotif() {
  const listEl = document.getElementById('notifObrigacoesList');
  listEl.innerHTML = '<p style="font-size:12px;color:var(--text-light)">Carregando...</p>';

  // Buscar config salva do usuário
  const { data } = await sb
    .from('notificacoes_config')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  const config = data || {};
  if (config.email_notif) document.getElementById('profileNotifEmail').value = config.email_notif;
  if (config.antecedencia_dias) document.getElementById('profileAntecedencia').value = config.antecedencia_dias;

  const regime  = currentCliente?.regime_tributario || '';
  const isMEI    = /mei/i.test(regime);
  const isSimp   = /simples/i.test(regime) || isMEI;
  const isLP     = /presumido/i.test(regime);
  const isLR     = /real/i.test(regime);

  // Pré-seleção por regime quando não há config salva
  let ativas = config.obrigacoes_ativas || null;
  if (!ativas) {
    if (isMEI)         ativas = ['das', 'dasn_simei', 'dirpf'];
    else if (isSimp)   ativas = ['das', 'defis', 'dirpf'];
    else if (isLP)     ativas = ['dctfweb', 'efd_contrib', 'ecd', 'ecf', 'dirpf'];
    else if (isLR)     ativas = ['dctfweb', 'efd_contrib', 'ecd', 'ecf', 'dirpf'];
    else               ativas = [];
  }

  listEl.innerHTML = OBRIGACOES_FISCAIS.map(ob => {
    const bloqueada = ob.somenteMei && !isMEI;
    return `
    <div class="notif-item" style="${bloqueada ? 'opacity:0.45;pointer-events:none' : ''}">
      <div class="notif-item-info">
        <div class="notif-item-title">${ob.label}${bloqueada ? ' <span style="font-size:10px;color:var(--text-light)">(apenas MEI)</span>' : ''}</div>
        <div class="notif-item-desc">${ob.desc}</div>
      </div>
      <label class="notif-toggle">
        <input type="checkbox" value="${ob.id}" ${ativas.includes(ob.id) && !bloqueada ? 'checked' : ''} ${bloqueada ? 'disabled' : ''}>
        <span class="notif-slider"></span>
      </label>
    </div>`;
  }).join('');
}

async function salvarConfigNotif() {
  const msgEl = document.getElementById('profileNotifMsg');
  const email = document.getElementById('profileNotifEmail').value.trim();
  const antecedencia = parseInt(document.getElementById('profileAntecedencia').value);
  const checkboxes = document.querySelectorAll('#notifObrigacoesList input[type=checkbox]:checked');
  const ativas = Array.from(checkboxes).map(cb => cb.value);

  // Validações
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msgEl.textContent = 'E-mail inválido. Corrija antes de salvar.';
    msgEl.className = 'auth-msg error';
    return;
  }
  const diasValidos = isNaN(antecedencia) || antecedencia < 1 ? 7 : Math.min(antecedencia, 30);

  const payload = {
    user_id: currentUser.id,
    email_notif: email || currentUser.email,
    antecedencia_dias: diasValidos,
    obrigacoes_ativas: ativas,
    atualizado_em: new Date().toISOString()
  };

  const { error } = await sb
    .from('notificacoes_config')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    msgEl.textContent = 'Erro ao salvar. Tente novamente.';
    msgEl.className = 'auth-msg error';
  } else {
    msgEl.textContent = `✅ Configurações salvas. Monitorando ${ativas.length} obrigação(ões).`;
    msgEl.className = 'auth-msg success';
  }
}

async function salvarDocumentoFiscal(tipo, dados) {
  if (!currentUser) return;
  try {
    await sb.from('documentos_fiscais').insert({
      user_id: currentUser.id,
      cliente_id: currentCliente?.id || null,
      tipo,
      dados,
      criado_em: new Date().toISOString()
    });
  } catch(e) {}
}

// ====== FUNÇÕES DE AUTENTICAÇÃO ======








async function loadChats(reset = true) {
  try {
    if (reset) { chatsPage = 0; allChats = []; }

    const from = chatsPage * CHATS_PER_PAGE;
    // SEMPRE filtrar por user_id — chats são estritamente privados por usuário
    let query = sb.from('chats')
      .select('id, title, created_at, updated_at, cliente_id')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })
      .range(from, from + CHATS_PER_PAGE - 1);

    if (currentCliente?.id) query = query.eq('cliente_id', currentCliente.id);

    const { data, error } = await query;
    if (error) {
      if (error.status === 401) { handleSessionExpired(); return; }
      throw error;
    }

    allChats = reset ? (data || []) : [...allChats, ...(data || [])];
    renderHistoryList(allChats, (data || []).length === CHATS_PER_PAGE);
  } catch (e) {
    document.getElementById('hList').innerHTML =
      `<p style="padding:16px;color:var(--error);font-size:13px">Erro ao carregar conversas</p>`;
  }
}

async function renderHistoryList(list, hasMore = false) {
  const el = document.getElementById('hList');
  if (!list || list.length === 0) {
    el.innerHTML = '<p style="padding:16px;text-align:center;color:var(--text-light);font-size:13px">Nenhuma conversa ainda</p>';
    return;
  }

  // Agrupar por data relativa
  const hoje     = new Date(); hoje.setHours(0,0,0,0);
  const ontem    = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const semana   = new Date(hoje); semana.setDate(semana.getDate() - 7);
  const mes      = new Date(hoje); mes.setDate(mes.getDate() - 30);

  function label(dateStr) {
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    if (d >= hoje)   return 'Hoje';
    if (d >= ontem)  return 'Ontem';
    if (d >= semana) return 'Últimos 7 dias';
    if (d >= mes)    return 'Últimos 30 dias';
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  // Agrupar
  const grupos = {};
  const ordem  = [];
  for (const c of list) {
    const g = label(c.updated_at || c.created_at);
    if (!grupos[g]) { grupos[g] = []; ordem.push(g); }
    grupos[g].push(c);
  }

  let html = '';
  for (const g of ordem) {
    html += `<div style="padding:6px 12px 2px;font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px">${g}</div>`;
    html += grupos[g].map(c => `
    <div class="h-item ${c.id === currentChat.id ? 'on' : ''}" onclick="openChat('${c.id}')">
      <div class="h-info">
        <div class="h-title" data-chat-id="${c.id}" title="Duplo clique para renomear">${escapeHtml(c.title || 'Nova Conversa')}</div>
        <div class="h-date">${new Date(c.updated_at || c.created_at).toLocaleDateString('pt-BR')}</div>
      </div>
      <button class="btn-del" onclick="event.stopPropagation();deleteChat('${c.id}')">
        <i data-lucide="trash-2" style="width:14px;height:14px"></i>
      </button>
    </div>`).join('');
  }

  el.innerHTML = html;

  if (hasMore) {
    el.innerHTML += `<button onclick="chatsPage++;loadChats(false)" style="width:100%;padding:10px;border:none;background:none;color:var(--accent);font-size:13px;cursor:pointer;border-top:1px solid var(--border)">Carregar mais conversas</button>`;
  }

  lucide.createIcons();

  // Event delegation para duplo clique nos títulos
  el.querySelectorAll('.h-title[data-chat-id]').forEach(titleEl => {
    titleEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      e.preventDefault();
      renameChat(titleEl.dataset.chatId, titleEl);
    });
  });
}

async function renameChat(id, el) {
  if (el.querySelector('input')) return; // já está editando
  const atual = el.textContent.trim();

  const input = document.createElement('input');
  input.value = atual;
  input.style.cssText = 'width:100%;font-size:12px;padding:2px 4px;border:1px solid var(--accent);border-radius:4px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box';

  // Substituir conteúdo do h-title pelo input
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  let saved = false;
  const salvar = async () => {
    if (saved) return;
    saved = true;
    const novo = input.value.trim() || atual;
    el.textContent = novo;
    if (novo !== atual) {
      await sb.from('chats').update({ title: novo }).eq('id', id).eq('user_id', currentUser.id);
      if (currentChat.id === id) currentChat.title = novo;
      const chat = allChats.find(c => c.id === id);
      if (chat) chat.title = novo;
    }
  };

  input.addEventListener('blur', salvar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { saved = true; el.textContent = atual; }
  });
  // impedir que o blur do input propague clique para o item pai
  input.addEventListener('click',    e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());
}

async function filterChats() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) { renderHistoryList(allChats); return; }

  // Busca local imediata por título
  const localMatch = allChats.filter(c => (c.title || '').toLowerCase().includes(q.toLowerCase()));
  renderHistoryList(localMatch);

  // Busca no banco por conteúdo das mensagens (debounce implícito — já filtramos local)
  try {
    const { data } = await sb.from('chats')
      .select('id, title, created_at, updated_at, cliente_id')
      .eq('user_id', currentUser.id)
      .ilike('title', `%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (data?.length) renderHistoryList(data);
  } catch {}
}

async function openChat(id) {
  try {
    const { data, error } = await sb
      .from('chats')
      .select('*')
      .eq('id', id)
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) throw error;

    currentChat = {
      id: data.id,
      title: data.title,
      messages: data.messages || []
    };

    renderMessages();
    renderHistoryList(allChats);
    closeSidebar();
  } catch (e) {
  }
}

async function saveChat() {
  try {
    if (!currentChat.messages || currentChat.messages.length === 0) return;

    const chatData = {
      title: currentChat.title || 'Nova Conversa',
      messages: currentChat.messages,
      updated_at: new Date().toISOString()
    };

    if (currentChat.id) {
      const { error } = await sb
        .from('chats')
        .update(chatData)
        .eq('id', currentChat.id)
        .eq('user_id', currentUser.id);

      if (error) {
        if (error.status === 401 || error.message?.includes('JWT')) { handleSessionExpired(); return; }
        throw error;
      }

    } else {
      const { data, error } = await sb
        .from('chats')
        .insert({
          title: chatData.title,
          messages: chatData.messages,
          user_id: currentUser?.id || null,
          cliente_id: currentCliente?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) throw error;

      currentChat.id = data.id;
    }

    await loadChats();

  } catch (e) {
  }
}

async function deleteChat(id) {
  showConfirm('Tem certeza que deseja excluir esta conversa?', async () => {
    try {
      const { error } = await sb.from('chats').delete().eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
      if (currentChat.id === id) newChat();
      else await loadChats();
    } catch (e) {}
  });
}

function newChat() {
  currentChat = { id: null, title: 'Nova Conversa', messages: [] };
  renderBoasVindas();
  lucide.createIcons();
  renderHistoryList(allChats);
  closeSidebar();
  removeAllFiles();
}

function renderBoasVindas() {
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = currentUser?.user_metadata?.name?.split(' ')[0] || '';

  // Calcular prazos próximos (7 dias)
  const hoje = new Date();
  const alertas = [];
  if (typeof fiscalDeadlines !== 'undefined' && currentCliente) {
    const regime = currentCliente.regime_tributario || '';
    const isMEI     = /mei/i.test(regime);
    const isSimples = /simples/i.test(regime);
    const isLucro   = /lucro/i.test(regime);
    const temEmp    = currentCliente.tem_empregado === true;

    for (const [, dl] of Object.entries(fiscalDeadlines)) {
      if (dl.meiOnly      && !isMEI)              continue;
      if (dl.simplesOuMei && !isMEI && !isSimples) continue;
      if (dl.naoSimples   && (isMEI || isSimples)) continue;
      if (dl.comEmpregado && !temEmp)              continue;

      let prazo;
      if (dl.month === 'monthly') {
        prazo = new Date(hoje.getFullYear(), hoje.getMonth(), dl.day);
        if (prazo < hoje) prazo.setMonth(prazo.getMonth() + 1);
      } else {
        prazo = new Date(hoje.getFullYear(), dl.month - 1, dl.day);
        if (prazo < hoje) prazo.setFullYear(prazo.getFullYear() + 1);
      }
      const dias = Math.ceil((prazo - hoje) / 86400000);
      if (dias >= 0 && dias <= 7) {
        const urgente = dias <= 2;
        alertas.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:500;background:${urgente ? 'rgba(220,38,38,.12)' : 'rgba(22,163,74,.1)'};color:${urgente ? '#dc2626' : '#16a34a'}">
          <i data-lucide="${urgente ? 'alert-circle' : 'calendar-check'}" style="width:11px;height:11px"></i>
          ${dl.description} ${dias === 0 ? '(hoje!)' : `em ${dias}d`}
        </span>`);
      }
    }
  }

  const prazosHtml = alertas.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px">${alertas.join('')}</div>`
    : '';

  const empresa = currentCliente
    ? `<p style="font-size:12px;color:var(--text-light);margin:4px 0 0">${currentCliente.razao_social}</p>`
    : '';

  document.getElementById('msgs').innerHTML = `
    <div class="empty">
      <i data-lucide="message-circle"></i>
      <h3>${saudacao}${nome ? ', ' + nome : ''}!</h3>
      <p>Como posso ajudar hoje?</p>
      ${empresa}
      ${prazosHtml}
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn-sugestao" onclick="useTemplate('Quais obrigações fiscais vencem essa semana?')">📅 Prazos da semana</button>
        <button class="btn-sugestao" onclick="useTemplate('Calcule o DARF de IRPJ para este mês')">🧮 Calcular DARF</button>
        <button class="btn-sugestao" onclick="useTemplate('Analise o regime tributário mais vantajoso')">⚖️ Regime tributário</button>
      </div>
    </div>`;
}

function renderMessages() {
  const container = document.getElementById('msgs');
  container.innerHTML = '';

  if (!currentChat.messages || currentChat.messages.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <i data-lucide="message-circle"></i>
        <h3>Olá! Sou seu especialista fiscal</h3>
        <p>Faça perguntas sobre tributos, CFOPs, cálculos e muito mais!</p>
      </div>`;
  } else {
    currentChat.messages.forEach(msg => {
      if (msg.role === 'user' && msg.files && msg.files.length > 0) {
        addMessage(msg.content, true, 'medium', null, null, msg.files);
      } else {
        addMessage(msg.content, msg.role === 'user', msg.confidence, msg.fileData, msg.interactionId);
      }
    });
  }
  lucide.createIcons();
}
