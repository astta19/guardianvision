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
      { id: 'dasn_simei', label: 'DASN-SIMEI (MEI)',      desc: 'Até 31/05 anual',           dia: 31, mes: 5        },
      { id: 'defis',      label: 'DEFIS (Simples)',        desc: 'Até 31/03 anual',           dia: 31, mes: 3        },
      { id: 'ecd',        label: 'ECD',                   desc: 'Até 30/06 anual',           dia: 30, mes: 6        },
      { id: 'ecf',        label: 'ECF',                   desc: 'Até 31/07 anual',           dia: 31, mes: 7        },
      { id: 'dirpf',      label: 'DIRPF (PF)',            desc: 'Até 29/05 anual',           dia: 29, mes: 5        },
    ];


    // ============================================
    // PERFIS_USUARIOS — banco centralizado de perfil
    // ============================================

    let perfilCache = null; // cache local para evitar múltiplas queries

    async function carregarPerfil() {
      if (!currentUser) return null;
      try {
        const { data } = await sb
          .from('perfis_usuarios')
          .select('nome, avatar_url')
          .eq('user_id', currentUser.id)
          .maybeSingle();
        perfilCache = data || {};
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

    function atualizarNomeHeader() {
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

      // Resetar para aba Conta sempre que abre
      modal.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.doc-panel').forEach(p => p.classList.remove('active'));
      modal.querySelector('.doc-tab').classList.add('active');
      document.getElementById('profileTabConta').classList.add('active');

      // Carregar perfil do banco
      const perfil = await carregarPerfil();
      const email = currentUser?.email || '';

      // Avatar — foto ou inicial
      const avatarEl = document.getElementById('profileAvatar');
      if (perfil?.avatar_url) {
        avatarEl.innerHTML = `<img src="${perfil.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="avatar">`;
      } else {
        const inicial = (perfil?.nome || email)[0]?.toUpperCase() || '?';
        avatarEl.textContent = inicial;
      }

      document.getElementById('profileEmailDisplay').textContent = email;
      document.getElementById('profileNome').value = perfil?.nome || '';
      const crcEl = document.getElementById('profileCRC');
      if (crcEl) crcEl.value = perfil?.crc || '';

      // Tema atual
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.getElementById('profileThemeToggle').checked = isDark;

      // pwdBar2
      document.getElementById('profileNewPwd').oninput = function() {
        checkPasswordStrengthEl(this.value, 'pwdBar2', 'pwdHint2');
      };

      carregarConfigNotif();
      lucide.createIcons();
    }

    function closeProfile() {
      document.getElementById('profileModal').style.display = 'none';
      document.getElementById('profilePwdMsg').className = 'auth-msg';
      document.getElementById('profileNotifMsg').className = 'auth-msg';
    }

    function switchProfileTab(tab, btn) {
      const modal = document.getElementById('profileModal');
      modal.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.doc-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panelId = tab === 'conta' ? 'profileTabConta' : 'profileTabNotif';
      document.getElementById(panelId).classList.add('active');
    }

    function checkPasswordStrengthEl(pwd, barId, hintId) {
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
      const nome = document.getElementById('profileNome').value.trim();
      const crc  = document.getElementById('profileCRC')?.value.trim() || '';
      const msgEl = document.getElementById('profileNomeMsg');
      const btn = event.target;

      btn.disabled = true; btn.textContent = 'Salvando...';
      const ok = await salvarPerfilBanco({ nome, crc });
      btn.disabled = false; btn.textContent = 'Salvar informações';

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

    function toggleThemeFromProfile(isDark) {
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
        alert('Selecione uma imagem válida (JPG, PNG, WebP).');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert('A imagem deve ter no máximo 2MB.');
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
        alert('Erro ao enviar imagem. Verifique se o bucket "avatars" existe no Supabase Storage.');
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

      const ativas = config.obrigacoes_ativas || [];

      listEl.innerHTML = OBRIGACOES_FISCAIS.map(ob => `
        <div class="notif-item">
          <div class="notif-item-info">
            <div class="notif-item-title">${ob.label}</div>
            <div class="notif-item-desc">${ob.desc}</div>
          </div>
          <label class="notif-toggle">
            <input type="checkbox" value="${ob.id}" ${ativas.includes(ob.id) ? 'checked' : ''}>
            <span class="notif-slider"></span>
          </label>
        </div>`).join('');
    }

    async function salvarConfigNotif() {
      const msgEl = document.getElementById('profileNotifMsg');
      const email = document.getElementById('profileNotifEmail').value.trim();
      const antecedencia = parseInt(document.getElementById('profileAntecedencia').value);
      const checkboxes = document.querySelectorAll('#notifObrigacoesList input[type=checkbox]:checked');
      const ativas = Array.from(checkboxes).map(cb => cb.value);

      const payload = {
        user_id: currentUser.id,
        email_notif: email || currentUser.email,
        antecedencia_dias: antecedencia,
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
    function setAuthMsg(id, msg, type) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg;
      el.className = `auth-msg ${type}`;
    }

    function showAuthState(state, subtitle) {
      const forms = ['loginForm', 'setPasswordForm', 'resetForm', 'confirmSentForm'];
      forms.forEach(f => { const el = document.getElementById(f); if (el) el.style.display = 'none'; });
      const subtitles = {
        login: 'Acesso exclusivo para colaboradores',
        setPassword: 'Defina sua senha para ativar o acesso',
        reset: 'Recuperação de senha',
        confirmSent: ''
      };
      document.getElementById('authSubtitle').textContent = subtitle || subtitles[state] || '';
      const map = { login: 'loginForm', setPassword: 'setPasswordForm', reset: 'resetForm', confirmSent: 'confirmSentForm' };
      const el = document.getElementById(map[state]);
      if (el) el.style.display = 'block';
      lucide.createIcons();
    }

    async function doLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      if (!email || !password) return setAuthMsg('loginMsg', 'Preencha e-mail e senha.', 'error');

      const btn = document.getElementById('loginBtn');
      btn.disabled = true;
      btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block"></span>Entrando...</span>';

      const { error } = await sb.auth.signInWithPassword({ email, password });

      btn.disabled = false;
      btn.innerHTML = 'Entrar';

      if (error) {
        const msg = error.message.includes('Invalid login') || error.message.includes('invalid_credentials')
          ? 'E-mail ou senha incorretos.'
          : error.message.includes('Email not confirmed')
          ? 'Confirme seu e-mail antes de entrar.'
          : 'Erro ao entrar. Tente novamente.';
        setAuthMsg('loginMsg', msg, 'error');
      }
    }

    async function doReset() {
      const email = document.getElementById('resetEmail').value.trim();
      if (!email) return setAuthMsg('resetMsg', 'Informe seu e-mail.', 'error');

      const btn = document.getElementById('resetBtn');
      btn.disabled = true;
      btn.textContent = 'Enviando...';

      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });

      btn.disabled = false;
      btn.textContent = 'Enviar link';

      if (error) {
        setAuthMsg('resetMsg', 'Erro ao enviar. Verifique o e-mail informado.', 'error');
      } else {
        document.getElementById('confirmSentTitle').textContent = 'Link de recuperação enviado!';
        document.getElementById('confirmSentText').textContent =
          'Verifique sua caixa de entrada e clique no link para redefinir sua senha.';
        showAuthState('confirmSent');
      }
    }

    async function doSetPassword() {
      const password = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;
      if (!password || !confirm) return setAuthMsg('setPasswordMsg', 'Preencha os dois campos.', 'error');
      if (password.length < 8) return setAuthMsg('setPasswordMsg', 'Senha deve ter mínimo 8 caracteres.', 'error');
      if (!/[A-Z]/.test(password)) return setAuthMsg('setPasswordMsg', 'Senha precisa de ao menos 1 letra maiúscula.', 'error');
      if (!/[0-9]/.test(password)) return setAuthMsg('setPasswordMsg', 'Senha precisa de ao menos 1 número.', 'error');
      if (password !== confirm) return setAuthMsg('setPasswordMsg', 'As senhas não coincidem.', 'error');

      const btn = document.getElementById('setPasswordBtn');
      btn.disabled = true;
      btn.textContent = 'Salvando...';

      const { error } = await sb.auth.updateUser({ password });

      btn.disabled = false;
      btn.textContent = 'Definir senha e entrar';

      if (error) setAuthMsg('setPasswordMsg', 'Erro ao definir senha. Tente novamente.', 'error');
    }

    async function doLogout() {
      showConfirm('Tem certeza que deseja sair?', async () => {
        await sb.auth.signOut();
      });
    }

    async function checkConnection() {
      try {
        const { error } = await sb.from('chats').select('id', { count: 'exact', head: true });
        if (error) {
          if (error.status === 401 || error.message?.includes('JWT')) {
            handleSessionExpired();
            return;
          }
          throw error;
        }
        setConnectionStatus('Online', 'cloud', '#10b981');
      } catch (e) {
        setConnectionStatus('Offline', 'cloud-off', '#ef4444');
      }
    }

    function handleSessionExpired() {
      currentUser = null;
      hideLoading();
      showAuthScreen();
      // Mostrar mensagem após tela de login renderizar
      setTimeout(() => {
        setAuthMsg('loginMsg', 'Sua sessão expirou. Faça login novamente.', 'error');
      }, 100);
    }

    function setConnectionStatus(label, icon, color) {
      document.getElementById('conn').innerHTML =
        `<i data-lucide="${icon}" style="width:12px;height:12px;color:${color}"></i><span>${label}</span>`;
      lucide.createIcons();
    }

    let chatsPage = 0;
    const CHATS_PER_PAGE = 50;

    async function loadChats(reset = true) {
      try {
        if (reset) { chatsPage = 0; allChats = []; }

        const from = chatsPage * CHATS_PER_PAGE;
        let query = sb.from('chats')
          .select('id, title, created_at, updated_at, cliente_id')
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

    function renderHistoryList(list, hasMore = false) {
      const el = document.getElementById('hList');
      if (!list || list.length === 0) {
        el.innerHTML = '<p style="padding:16px;text-align:center;color:var(--text-light);font-size:13px">Nenhuma conversa ainda</p>';
        return;
      }

      el.innerHTML = list.map(c => `
        <div class="h-item ${c.id === currentChat.id ? 'on' : ''}" onclick="openChat('${c.id}')">
          <div class="h-info">
            <div class="h-title">${escapeHtml(c.title || 'Nova Conversa')}</div>
            <div class="h-date">${new Date(c.created_at).toLocaleDateString('pt-BR')}</div>
          </div>
          <button class="btn-del" onclick="event.stopPropagation();deleteChat('${c.id}')">
            <i data-lucide="trash-2" style="width:14px;height:14px"></i>
          </button>
        </div>`).join('');

      if (hasMore) {
        el.innerHTML += `<button onclick="chatsPage++;loadChats(false)" style="width:100%;padding:10px;border:none;background:none;color:var(--accent);font-size:13px;cursor:pointer;border-top:1px solid var(--border)">Carregar mais conversas</button>`;
      }

      lucide.createIcons();
    }

    function filterChats() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const filtered = q ? allChats.filter(c => (c.title || '').toLowerCase().includes(q)) : allChats;
      renderHistoryList(filtered);
    }

    async function openChat(id) {
      try {
        const { data, error } = await sb
          .from('chats')
          .select('*')
          .eq('id', id)
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
            .eq('id', currentChat.id);

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

    function deleteChat(id) {
      showConfirm('Tem certeza que deseja excluir esta conversa?', async () => {
        try {
          const { error } = await sb.from('chats').delete().eq('id', id);
          if (error) throw error;
          if (currentChat.id === id) newChat();
          else await loadChats();
        } catch (e) {}
      });
    }

    function newChat() {
      currentChat = { id: null, title: 'Nova Conversa', messages: [] };
      document.getElementById('msgs').innerHTML = `
        <div class="empty">
          <i data-lucide="message-circle"></i>
          <h3>Nova conversa</h3>
          <p>Faça sua primeira pergunta!</p>
        </div>`;
      lucide.createIcons();
      renderHistoryList(allChats);
      closeSidebar();
      removeAllFiles();
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

