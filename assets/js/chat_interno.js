// ============================================================
// CHAT_INTERNO.JS — Chat em tempo real entre contadores
// Isolamento por escritório · Supabase Realtime + Presence
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _ciEscId    = null;   // escritorio_id resolvido
let _ciChannel  = null;   // canal postgres_changes
let _ciPresence = null;   // canal presence
let _ciPerfis   = {};     // { user_id: { nome, avatar_url } }
let _ciNaoLidas = 0;
let _ciAberto   = false;
let _ciPagina   = 0;
let _ciTem      = false;  // permissão confirmada
const _CI_PS    = 40;     // page size

// ── Inicialização ─────────────────────────────────────────────
async function ciInit() {
  if (!currentUser) return;
  if (!isAdmin() && !_ciTemPermissao()) return;

  _ciEscId = await _ciResolverEscritorio();
  if (!_ciEscId) return;

  _ciTem = true;
  await _ciCarregarPerfis();
  await _ciContarNaoLidas();
  _ciRenderBadge();
  _ciSubscribe();
  // Mostrar botão no header
  const btn = document.getElementById('ciBtnHeader');
  if (btn) btn.style.display = 'flex';
}

function _ciTemPermissao() {
  const perms = currentUser?.user_metadata?.permissions || [];
  return perms.includes('chat_interno');
}

// Funciona para admin (owner) E para contadores vinculados
async function _ciResolverEscritorio() {
  // Tenta como owner
  const { data: own } = await sb.from('escritorios')
    .select('id').eq('owner_id', currentUser.id).limit(1);
  if (own?.length) return own[0].id;

  // Tenta como membro
  const { data: vin } = await sb.from('escritorio_usuarios')
    .select('escritorio_id').eq('user_id', currentUser.id).limit(1);
  if (vin?.length) return vin[0].escritorio_id;

  return null;
}

// ── Perfis dos membros ────────────────────────────────────────
async function _ciCarregarPerfis() {
  const { data: membros } = await sb.from('escritorio_usuarios')
    .select('user_id').eq('escritorio_id', _ciEscId);
  if (!membros?.length) return;

  const ids = membros.map(m => m.user_id);
  // Garantir que o owner também está
  if (!ids.includes(currentUser.id)) ids.push(currentUser.id);

  const { data: perfis } = await sb.from('perfis_usuarios')
    .select('user_id, nome, avatar_url').in('user_id', ids);

  _ciPerfis = {};
  (perfis || []).forEach(p => { _ciPerfis[p.user_id] = p; });
}

function _ciNome(uid) {
  const p = _ciPerfis[uid];
  if (p?.nome) return p.nome;
  if (uid === currentUser?.id) return currentUser.email?.split('@')[0] || 'Você';
  return 'Contador';
}

// Cor determinística por user_id — evita conflito de nomes de variável com funções
function _ciCor(uid) {
  const palette = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#9333ea','#0d9488'];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function _ciAvatar(uid, sz = 28) {
  const p    = _ciPerfis[uid];
  const nome = _ciNome(uid);
  if (p?.avatar_url) {
    return `<img src="${escapeHtml(p.avatar_url)}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="">`;
  }
  const fs = Math.round(sz * 0.42);
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${_ciCor(uid)};color:#fff;font-size:${fs}px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${nome[0].toUpperCase()}</div>`;
}

// ── Realtime: mensagens + presence ───────────────────────────
function _ciSubscribe() {
  if (_ciChannel)  sb.removeChannel(_ciChannel);
  if (_ciPresence) sb.removeChannel(_ciPresence);

  // Mensagens novas
  _ciChannel = sb.channel(`ci_msg_${_ciEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'chat_interno_mensagens',
      filter: `escritorio_id=eq.${_ciEscId}`,
    }, ({ new: msg }) => {
      if (_ciAberto) {
        _ciRenderMsg(msg, true);
        _ciMarcarLidas();
      } else if (msg.user_id !== currentUser.id) {
        _ciNaoLidas++;
        _ciRenderBadge();
        _ciToast(msg);
      }
    })
    .subscribe();

  // Presença — quem está online
  _ciPresence = sb.channel(`ci_pres_${_ciEscId}`, { config: { presence: { key: currentUser.id } } })
    .on('presence', { event: 'sync'  }, _ciRenderOnline)
    .on('presence', { event: 'join'  }, _ciRenderOnline)
    .on('presence', { event: 'leave' }, _ciRenderOnline)
    .subscribe(async s => {
      if (s === 'SUBSCRIBED') {
        await _ciPresence.track({ user_id: currentUser.id, nome: _ciNome(currentUser.id) });
      }
    });
}

// ── Abrir / Fechar drawer ─────────────────────────────────────
async function abrirChatInterno() {
  if (!_ciTem) {
    await ciInit();
    if (!_ciTem) { showToast('Chat indisponível: escritório não configurado.', 'warn'); return; }
  }

  _ciAberto   = true;
  _ciNaoLidas = 0;
  _ciRenderBadge();

  const drawer = document.getElementById('ciDrawer');
  drawer.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('ci-open'));

  _ciPagina = 0;
  await _ciCarregarHistorico(false);
  _ciMarcarLidas();
  document.getElementById('ciInput')?.focus();
}

function fecharChatInterno() {
  _ciAberto = false;
  const drawer = document.getElementById('ciDrawer');
  drawer.classList.remove('ci-open');
  setTimeout(() => { if (!_ciAberto) drawer.style.display = 'none'; }, 280);
}

// ── Histórico ─────────────────────────────────────────────────
async function _ciCarregarHistorico(append) {
  const corpo = document.getElementById('ciCorpo');
  if (!corpo) return;

  if (!append) corpo.innerHTML = '<div style="display:flex;justify-content:center;padding:32px"><div class="hon-spinner"></div></div>';

  const from = _ciPagina * _CI_PS;
  const { data, error } = await sb.from('chat_interno_mensagens')
    .select('id,user_id,conteudo,criado_em')
    .eq('escritorio_id', _ciEscId)
    .order('criado_em', { ascending: false })
    .range(from, from + _CI_PS - 1);

  if (error || !data) { corpo.innerHTML = '<p class="ci-vazio">Erro ao carregar.</p>'; return; }

  const msgs = data.reverse();

  if (!append) {
    corpo.innerHTML = '';
    if (!msgs.length) {
      corpo.innerHTML = '<p class="ci-vazio">Nenhuma mensagem ainda.<br>Seja o primeiro a falar! 👋</p>';
      return;
    }
    if (data.length === _CI_PS) {
      corpo.insertAdjacentHTML('afterbegin',
        `<div class="ci-load-mais"><button onclick="_ciMaisAntigo()">Carregar mensagens anteriores</button></div>`);
    }
    msgs.forEach(m => _ciRenderMsg(m, false));
    corpo.scrollTop = corpo.scrollHeight;
  } else {
    const antes = corpo.scrollHeight;
    msgs.forEach(m => corpo.insertBefore(_ciCriarEl(m), corpo.children[1])); // depois do botão
    corpo.scrollTop = corpo.scrollHeight - antes;
  }
}

async function _ciMaisAntigo() {
  _ciPagina++;
  await _ciCarregarHistorico(true);
}

// ── Render de uma mensagem ────────────────────────────────────
function _ciCriarEl(msg) {
  const proprio = msg.user_id === currentUser.id;
  const hora    = new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const texto   = escapeHtml(msg.conteudo).replace(/\n/g, '<br>');

  // Separador de dia
  const diaEl = _ciSepDia(msg.criado_em.slice(0, 10));

  const frag = document.createDocumentFragment();
  if (diaEl) frag.appendChild(diaEl);

  const div = document.createElement('div');
  div.className = `ci-msg ${proprio ? 'ci-prp' : 'ci-out'}`;

  if (proprio) {
    div.innerHTML = `<div class="ci-bubble">${texto}<span class="ci-hora">${hora}</span></div>${_ciAvatar(msg.user_id, 26)}`;
  } else {
    div.innerHTML = `${_ciAvatar(msg.user_id, 26)}<div class="ci-mbody"><div class="ci-nome">${escapeHtml(_ciNome(msg.user_id))}</div><div class="ci-bubble">${texto}<span class="ci-hora">${hora}</span></div></div>`;
  }
  frag.appendChild(div);
  return frag;
}

let _ciUltDia = '';
function _ciSepDia(diaKey) {
  if (_ciUltDia === diaKey) return null;
  _ciUltDia = diaKey;
  const hoje  = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const label = diaKey === hoje ? 'Hoje' : diaKey === ontem ? 'Ontem'
    : new Date(diaKey + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const el = document.createElement('div');
  el.className = 'ci-sep-dia';
  el.innerHTML = `<span>${label}</span>`;
  return el;
}

function _ciRenderMsg(msg, scroll) {
  const corpo = document.getElementById('ciCorpo');
  if (!corpo) return;
  const vazio = corpo.querySelector('.ci-vazio');
  if (vazio) vazio.remove();
  _ciUltDia = ''; // forçar reavaliação do separador apenas para novas msgs realtime
  const frag = _ciCriarEl(msg);
  corpo.appendChild(frag);
  if (scroll) corpo.scrollTop = corpo.scrollHeight;
}

// ── Enviar ────────────────────────────────────────────────────
async function ciEnviar() {
  const input = document.getElementById('ciInput');
  const texto = input?.value.trim();
  if (!texto || !_ciEscId) return;

  const backup = texto;
  input.value = '';
  input.style.height = 'auto';

  const { error } = await sb.from('chat_interno_mensagens').insert({
    escritorio_id: _ciEscId,
    user_id:       currentUser.id,
    conteudo:      texto,
  });

  if (error) { showToast('Erro ao enviar.', 'error'); input.value = backup; }
}

function ciKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ciEnviar(); }
  // Auto-resize
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
}

// ── Marcar lidas via RPC ──────────────────────────────────────
async function _ciMarcarLidas() {
  if (!_ciEscId) return;
  await sb.rpc('ci_marcar_lidas', { p_escritorio_id: _ciEscId, p_user_id: currentUser.id });
  _ciNaoLidas = 0;
  _ciRenderBadge();
}

async function _ciContarNaoLidas() {
  if (!_ciEscId) return;
  const { count } = await sb.from('chat_interno_mensagens')
    .select('*', { count: 'exact', head: true })
    .eq('escritorio_id', _ciEscId)
    .neq('user_id', currentUser.id)
    .not('lida_por', 'cs', `{${currentUser.id}}`);
  _ciNaoLidas = count || 0;
}

// ── Badge header ──────────────────────────────────────────────
function _ciRenderBadge() {
  const b = document.getElementById('ciBadge');
  if (!b) return;
  b.textContent  = _ciNaoLidas > 9 ? '9+' : String(_ciNaoLidas);
  b.style.display = _ciNaoLidas > 0 ? 'flex' : 'none';
}

// ── Presença — avatares online ────────────────────────────────
function _ciRenderOnline() {
  if (!_ciPresence) return;
  const todos   = Object.values(_ciPresence.presenceState()).flat();
  const outros  = todos.filter(p => p.user_id !== currentUser.id);

  const label = document.getElementById('ciOnlineLabel');
  if (label) label.textContent = outros.length ? `${outros.length + 1} online` : 'Apenas você';

  const wrap = document.getElementById('ciOnlineAvatares');
  if (!wrap) return;
  wrap.innerHTML = outros.slice(0, 5).map(p => `
    <div style="position:relative;flex-shrink:0">
      ${_ciAvatar(p.user_id, 22)}
      <span style="position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#16a34a;border-radius:50%;border:1.5px solid var(--card)"></span>
    </div>`).join('');
}

// ── Toast nova mensagem ───────────────────────────────────────
function _ciToast(msg) {
  const nome    = _ciNome(msg.user_id);
  const preview = msg.conteudo.length > 55 ? msg.conteudo.slice(0, 55) + '…' : msg.conteudo;
  showToast(`💬 ${nome}: ${preview}`, 'info', 4500);
}
