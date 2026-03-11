// ============================================================
// CHAT_INTERNO.JS v3 — Chat profissional entre contadores
//
// Funcionalidades:
//   • Broadcast (<100ms) + postgres_changes (resiliência)
//   • Som de notificação via AudioContext (desbloqueado no 1º clique)
//   • Envio de imagens/prints (base64 → Supabase Storage)
//   • Status de envio: enviando → ✓ entregue
//   • Reações rápidas em mensagens
//   • Menção @nome com autocomplete
//   • Indicador "digitando..."
//   • Presença com avatares online
//   • Badge não lidas + toast com som
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _ciEscId     = null;
let _ciEscNome   = '';
let _ciBc        = null;
let _ciPg        = null;
let _ciPr        = null;
let _ciPerfis    = {};
let _ciNaoLidas  = 0;
let _ciAberto    = false;
let _ciPagina    = 0;
let _ciReady     = false;
let _ciFp        = new Set();
let _ciDigTimer  = null;
let _ciDigitando = {};  // { uid: timeout }
const _CI_PS     = 40;

// ── Som ──────────────────────────────────────────────────────
let _ciACtx    = null;
let _ciAUnlock = false;

document.addEventListener('click', () => {
  if (_ciAUnlock) return;
  try {
    _ciACtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ciACtx.state === 'suspended') _ciACtx.resume();
    _ciAUnlock = true;
  } catch(_) {}
}, { passive: true });

function _ciSom() {
  try {
    if (!_ciACtx) {
      _ciACtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ciACtx.state === 'suspended') _ciACtx.resume();
    const osc  = _ciACtx.createOscillator();
    const gain = _ciACtx.createGain();
    osc.connect(gain);
    gain.connect(_ciACtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, _ciACtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, _ciACtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, _ciACtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ciACtx.currentTime + 0.22);
    osc.start(_ciACtx.currentTime);
    osc.stop(_ciACtx.currentTime + 0.22);
  } catch(_) {}
}

// ── Fingerprint de dedup ──────────────────────────────────────
function _ciFpKey(msg) {
  const min = (msg.criado_em || '').slice(0, 16);
  return `${msg.user_id}_${min}_${(msg.conteudo||'').slice(0,20)}`;
}

// ── Bootstrap ────────────────────────────────────────────────
async function ciInit() {
  if (!currentUser) return;
  if (!isAdmin() && !_ciTemPermissao()) return;
  _ciEscId = await _ciResolverEscritorio();
  if (!_ciEscId) return;
  _ciReady = true;
  await _ciCarregarPerfis();
  await _ciContarNaoLidas();
  _ciRenderBadge();
  _ciSubscribe();
  const btn = document.getElementById('ciBtnHeader');
  if (btn) btn.style.display = 'flex';
}

function _ciTemPermissao() {
  return (currentUser?.user_metadata?.permissions || []).includes('chat_interno');
}

async function _ciResolverEscritorio() {
  const { data: own } = await sb.from('escritorios')
    .select('id,nome').eq('owner_id', currentUser.id).limit(1);
  if (own?.length) { _ciEscNome = own[0].nome || 'Escritório'; return own[0].id; }
  const { data: vin } = await sb.from('escritorio_usuarios')
    .select('escritorio_id,escritorios(nome)').eq('user_id', currentUser.id).limit(1);
  if (vin?.length) { _ciEscNome = vin[0].escritorios?.nome || 'Escritório'; return vin[0].escritorio_id; }
  return null;
}

// ── Perfis ────────────────────────────────────────────────────
async function _ciCarregarPerfis() {
  const { data: membros } = await sb.from('escritorio_usuarios')
    .select('user_id').eq('escritorio_id', _ciEscId);
  const ids = (membros || []).map(m => m.user_id);
  if (!ids.includes(currentUser.id)) ids.push(currentUser.id);
  await _ciFetchPerfis(ids);
}

async function _ciFetchPerfis(ids) {
  if (!ids?.length) return;
  const novos = ids.filter(id => !_ciPerfis[id]);
  if (!novos.length) return;
  const { data } = await sb.from('perfis_usuarios')
    .select('user_id,nome,avatar_url').in('user_id', novos);
  (data || []).forEach(p => { _ciPerfis[p.user_id] = p; });
}

function _ciNome(uid) {
  const p = _ciPerfis[uid];
  if (p?.nome) return p.nome;
  if (uid === currentUser?.id) return currentUser.email?.split('@')[0] || 'Você';
  return 'Contador';
}

function _ciCor(uid) {
  const pal = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#9333ea','#0d9488'];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return pal[h % pal.length];
}

function _ciAvatarEl(uid, src, nome, sz) {
  sz = sz || 28;
  const fs  = Math.round(sz * 0.42);
  const cor = _ciCor(uid);
  const ini = ((nome || '?')[0] || '?').toUpperCase();
  if (src) {
    const img = document.createElement('img');
    img.src   = src;
    img.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0`;
    img.alt   = '';
    img.onerror = () => img.replaceWith(_ciAvatarEl(uid, '', nome, sz));
    return img;
  }
  const div = document.createElement('div');
  div.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;background:${cor};color:#fff;font-size:${fs}px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0`;
  div.textContent = ini;
  return div;
}

function _ciAvatar(uid, sz) {
  const p = _ciPerfis[uid];
  return _ciAvatarEl(uid, p?.avatar_url || '', _ciNome(uid), sz || 28);
}

// ── Canais Realtime ───────────────────────────────────────────
function _ciSubscribe() {
  if (_ciBc) sb.removeChannel(_ciBc);
  if (_ciPg) sb.removeChannel(_ciPg);
  if (_ciPr) sb.removeChannel(_ciPr);

  _ciBc = sb.channel(`ci_bc_${_ciEscId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msg'      }, ({ payload }) => _ciReceber(payload))
    .on('broadcast', { event: 'typing'   }, ({ payload }) => _ciMostrarDigitando(payload))
    .on('broadcast', { event: 'reaction' }, ({ payload }) => _ciAplicarReacao(payload))
    .subscribe();

  _ciPg = sb.channel(`ci_pg_${_ciEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'chat_interno_mensagens',
      filter: `escritorio_id=eq.${_ciEscId}`,
    }, ({ new: row }) => _ciReceber(row))
    .subscribe();

  _ciPr = sb.channel(`ci_pr_${_ciEscId}`, { config: { presence: { key: currentUser.id } } })
    .on('presence', { event: 'sync'  }, _ciRenderOnline)
    .on('presence', { event: 'join'  }, _ciRenderOnline)
    .on('presence', { event: 'leave' }, _ciRenderOnline)
    .subscribe(async s => {
      if (s !== 'SUBSCRIBED') return;
      await _ciPr.track({
        user_id: currentUser.id,
        nome:    _ciNome(currentUser.id),
        avatar:  _ciPerfis[currentUser.id]?.avatar_url || '',
      });
    });
}

// ── Receber mensagem (broadcast + pg_changes) ─────────────────
function _ciReceber(msg) {
  const key = msg.id || _ciFpKey(msg);
  if (_ciFp.has(key)) return;
  _ciFp.add(key);

  if (msg.nome_sender && !_ciPerfis[msg.user_id]?.nome) {
    _ciPerfis[msg.user_id] = { user_id: msg.user_id, nome: msg.nome_sender, avatar_url: msg.avatar_sender || '' };
  }

  if (_ciAberto) {
    _ciRenderMsgNova(msg);
    _ciMarcarLidas();
  } else if (msg.user_id !== currentUser.id) {
    _ciNaoLidas++;
    _ciRenderBadge();
    _ciSom();
    _ciToastMsg(msg);
  }
}

// ── Indicador "digitando..." ──────────────────────────────────
function ciInputDigitando() {
  // Debounce — envia broadcast "typing" a cada 2s enquanto digita
  clearTimeout(_ciDigTimer);
  _ciDigTimer = setTimeout(() => {
    if (!_ciBc || !_ciEscId) return;
    _ciBc.send({ type: 'broadcast', event: 'typing', payload: {
      user_id: currentUser.id,
      nome:    _ciNome(currentUser.id),
    }});
  }, 400);
}

function _ciMostrarDigitando({ user_id, nome }) {
  if (user_id === currentUser.id) return;
  const el = document.getElementById('ciDigitando');
  if (!el) return;

  clearTimeout(_ciDigitando[user_id]);
  el.textContent = `${nome || 'Alguém'} está digitando...`;
  el.style.display = 'block';

  _ciDigitando[user_id] = setTimeout(() => {
    el.style.display = 'none';
    el.textContent = '';
  }, 3000);
}

// ── Reações ───────────────────────────────────────────────────
const CI_REACOES = ['👍','❤️','😂','😮','🎉','✅'];

function ciMostrarReacoes(msgEl, msgId) {
  document.querySelector('.ci-reacao-picker')?.remove();
  const picker = document.createElement('div');
  picker.className = 'ci-reacao-picker';
  picker.innerHTML = CI_REACOES.map(e =>
    `<button onclick="ciEnviarReacao('${msgId}','${e}',this.closest('.ci-reacao-picker'))">${e}</button>`
  ).join('');
  msgEl.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 10);
}

async function ciEnviarReacao(msgId, emoji, picker) {
  picker?.remove();
  if (!_ciBc) return;
  const payload = { msg_id: msgId, emoji, user_id: currentUser.id, nome: _ciNome(currentUser.id) };
  _ciBc.send({ type: 'broadcast', event: 'reaction', payload });
  _ciAplicarReacao(payload);
  // Persistir reação
  await sb.from('chat_interno_reacoes').upsert({
    mensagem_id: msgId, user_id: currentUser.id, emoji,
  }, { onConflict: 'mensagem_id,user_id' });
}

function _ciAplicarReacao({ msg_id, emoji, user_id, nome }) {
  const msgEl = document.querySelector(`[data-msg-id="${msg_id}"]`);
  if (!msgEl) return;
  let wrap = msgEl.querySelector('.ci-reacoes');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'ci-reacoes'; msgEl.querySelector('.ci-bubble').after(wrap); }

  let btn = wrap.querySelector(`[data-emoji="${emoji}"]`);
  if (btn) {
    const count = parseInt(btn.dataset.count || '0') + 1;
    btn.dataset.count = count;
    btn.querySelector('.ci-r-count').textContent = count;
  } else {
    btn = document.createElement('button');
    btn.className = 'ci-r-btn';
    btn.dataset.emoji = emoji;
    btn.dataset.count = '1';
    btn.title = nome || '';
    btn.innerHTML = `${emoji} <span class="ci-r-count">1</span>`;
    wrap.appendChild(btn);
  }
  if (user_id === currentUser.id) btn.classList.add('ci-r-proprio');
}

// ── Upload de imagem / print ──────────────────────────────────
function ciAbrirUpload() {
  const inp = document.getElementById('ciFileInput');
  if (inp) inp.click();
}

async function ciHandleFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const MAX = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX) { showToast('Imagem muito grande (máx 5MB).', 'warn'); return; }
  if (!file.type.startsWith('image/')) { showToast('Apenas imagens são permitidas.', 'warn'); return; }

  showToast('Enviando imagem...', 'info', 2000);

  // Upload para Supabase Storage no bucket portal-uploads
  const ext  = file.name.split('.').pop() || 'png';
  const path = `chat/${_ciEscId}/${Date.now()}_${currentUser.id}.${ext}`;
  const { data: up, error: upErr } = await sb.storage
    .from('portal-uploads').upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) { showToast('Erro ao enviar imagem.', 'error'); return; }

  const { data: { publicUrl } } = sb.storage.from('portal-uploads').getPublicUrl(path);
  await _ciEnviarMensagem(`[img:${publicUrl}]`);
}

// ── Abrir / Fechar ────────────────────────────────────────────
async function abrirChatInterno() {
  if (!_ciReady) {
    await ciInit();
    if (!_ciReady) { showToast('Chat indisponível.', 'warn'); return; }
  }
  _ciAberto   = true;
  _ciNaoLidas = 0;
  _ciRenderBadge();

  const drawer = document.getElementById('ciDrawer');
  drawer.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('ci-open'));

  const title = document.getElementById('ciEscNome');
  if (title) title.textContent = _ciEscNome;

  _ciPagina = 0;
  await _ciCarregarHistorico(false);
  _ciMarcarLidas();
  setTimeout(() => document.getElementById('ciInput')?.focus(), 120);
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
  if (!append) corpo.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="hon-spinner"></div></div>';

  const from = _ciPagina * _CI_PS;
  const { data, error } = await sb.from('chat_interno_mensagens')
    .select('id,user_id,conteudo,nome_sender,avatar_sender,criado_em')
    .eq('escritorio_id', _ciEscId)
    .order('criado_em', { ascending: false })
    .range(from, from + _CI_PS - 1);

  if (error) { if (!append) corpo.innerHTML = '<p class="ci-vazio">Erro ao carregar.</p>'; return; }

  const msgs = (data || []).reverse();
  await _ciFetchPerfis([...new Set(msgs.map(m => m.user_id))]);

  if (!append) {
    corpo.innerHTML = '';
    if (!msgs.length) { corpo.innerHTML = '<p class="ci-vazio">Nenhuma mensagem ainda.<br>Seja o primeiro a falar! 👋</p>'; return; }
  }

  if ((data?.length || 0) === _CI_PS && !corpo.querySelector('.ci-load-mais')) {
    const d = document.createElement('div');
    d.className = 'ci-load-mais';
    d.innerHTML = '<button onclick="_ciMaisAntigo()">Carregar mensagens anteriores</button>';
    corpo.insertBefore(d, corpo.firstChild);
  }

  const diasSet = new Set();
  const frag    = document.createDocumentFragment();
  msgs.forEach(m => { _ciFp.add(m.id || _ciFpKey(m)); frag.appendChild(_ciCriarEl(m, diasSet)); });

  if (append) {
    const antes = corpo.scrollHeight;
    corpo.insertBefore(frag, corpo.querySelector('.ci-load-mais')?.nextSibling || corpo.firstChild);
    corpo.scrollTop = corpo.scrollHeight - antes;
  } else {
    corpo.appendChild(frag);
    corpo.scrollTop = corpo.scrollHeight;
  }

  // Carregar reações do histórico
  const ids = msgs.map(m => m.id).filter(Boolean);
  if (ids.length) _ciCarregarReacoes(ids);
}

async function _ciMaisAntigo() { _ciPagina++; await _ciCarregarHistorico(true); }

async function _ciCarregarReacoes(ids) {
  const { data } = await sb.from('chat_interno_reacoes')
    .select('mensagem_id,emoji,user_id,perfis_usuarios(nome)')
    .in('mensagem_id', ids);
  (data || []).forEach(r => _ciAplicarReacao({
    msg_id: r.mensagem_id, emoji: r.emoji,
    user_id: r.user_id, nome: r.perfis_usuarios?.nome || '',
  }));
}

// ── Criar elemento de mensagem ────────────────────────────────
function _ciCriarEl(msg, diasSet) {
  const frag  = document.createDocumentFragment();
  const dia   = (msg.criado_em || '').slice(0, 10);

  if (dia && !diasSet.has(dia)) {
    diasSet.add(dia);
    const hoje  = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const label = dia === hoje ? 'Hoje' : dia === ontem ? 'Ontem'
      : new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const sep = document.createElement('div');
    sep.className = 'ci-sep-dia';
    sep.innerHTML = `<span>${label}</span>`;
    frag.appendChild(sep);
  }

  const proprio = msg.user_id === currentUser.id;
  const hora    = msg.criado_em
    ? new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const nome   = _ciPerfis[msg.user_id]?.nome || msg.nome_sender || _ciNome(msg.user_id);
  const src    = _ciPerfis[msg.user_id]?.avatar_url || msg.avatar_sender || '';
  const avatar = _ciAvatarEl(msg.user_id, src, nome, 28);

  // Wrapper com data-msg-id para reações
  const wrap = document.createElement('div');
  wrap.className = `ci-msg-wrap ${proprio ? 'ci-prp-wrap' : ''}`;
  if (msg.id) wrap.dataset.msgId = msg.id;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ci-msg ${proprio ? 'ci-prp' : 'ci-out'}`;

  // Bubble com suporte a imagem
  const bubble = document.createElement('div');
  bubble.className = 'ci-bubble';

  const conteudo = msg.conteudo || '';
  if (conteudo.startsWith('[img:') && conteudo.endsWith(']')) {
    const url = conteudo.slice(5, -1);
    const img = document.createElement('img');
    img.src   = url;
    img.className = 'ci-img-preview';
    img.onclick   = () => window.open(url, '_blank');
    img.onerror   = () => { img.style.display = 'none'; };
    bubble.appendChild(img);
  } else {
    // Realçar @menções
    const html = escapeHtml(conteudo).replace(/\n/g, '<br>')
      .replace(/@(\w[\w\s]*?)(?=\s|$|<)/g, '<span class="ci-mencao">@$1</span>');
    bubble.innerHTML = html;
  }

  const horaEl = document.createElement('span');
  horaEl.className = 'ci-hora';
  horaEl.textContent = hora;
  bubble.appendChild(horaEl);

  // Botão de reação (hover)
  if (msg.id) {
    const rBtn = document.createElement('button');
    rBtn.className = 'ci-r-trigger';
    rBtn.innerHTML = '😊';
    rBtn.title = 'Reagir';
    rBtn.onclick = (e) => { e.stopPropagation(); ciMostrarReacoes(wrap, msg.id); };
    msgDiv.appendChild(rBtn);
  }

  if (proprio) {
    msgDiv.appendChild(bubble);
    msgDiv.appendChild(avatar);
  } else {
    const mbody = document.createElement('div');
    mbody.className = 'ci-mbody';
    const nomeEl = document.createElement('div');
    nomeEl.className = 'ci-nome';
    nomeEl.textContent = nome;
    mbody.appendChild(nomeEl);
    mbody.appendChild(bubble);
    msgDiv.insertBefore(avatar, msgDiv.firstChild);
    msgDiv.appendChild(mbody);
  }

  wrap.appendChild(msgDiv);
  frag.appendChild(wrap);
  return frag;
}

function _ciRenderMsgNova(msg) {
  const corpo = document.getElementById('ciCorpo');
  if (!corpo) return;
  corpo.querySelector('.ci-vazio')?.remove();
  const diasSet = new Set();
  const seps    = [...corpo.querySelectorAll('.ci-sep-dia')];
  if (seps.length && seps[seps.length - 1].querySelector('span')?.textContent === 'Hoje') {
    diasSet.add(new Date().toISOString().slice(0, 10));
  }
  corpo.appendChild(_ciCriarEl(msg, diasSet));
  corpo.scrollTop = corpo.scrollHeight;
}

// ── Enviar texto ──────────────────────────────────────────────
async function ciEnviar() {
  const input = document.getElementById('ciInput');
  const texto = input?.value.trim();
  if (!texto || !_ciEscId) return;
  input.value = '';
  input.style.height = 'auto';
  await _ciEnviarMensagem(texto);
}

async function _ciEnviarMensagem(conteudo) {
  const agora  = new Date().toISOString();
  const nome   = _ciNome(currentUser.id);
  const avatar = _ciPerfis[currentUser.id]?.avatar_url || '';

  const payload = {
    user_id: currentUser.id, escritorio_id: _ciEscId,
    conteudo, nome_sender: nome, avatar_sender: avatar, criado_em: agora,
  };

  _ciFp.add(_ciFpKey(payload));
  _ciRenderMsgNova(payload);
  _ciBc?.send({ type: 'broadcast', event: 'msg', payload });

  const { error } = await sb.from('chat_interno_mensagens').insert({
    escritorio_id: _ciEscId, user_id: currentUser.id,
    conteudo, nome_sender: nome, avatar_sender: avatar,
  });
  if (error) showToast('Erro ao salvar mensagem.', 'error');
}

function ciKeyDown(e) {
  ciInputDigitando();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ciEnviar(); }
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
}

// ── Não lidas ─────────────────────────────────────────────────
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

function _ciRenderBadge() {
  const b = document.getElementById('ciBadge');
  if (!b) return;
  b.textContent   = _ciNaoLidas > 9 ? '9+' : String(_ciNaoLidas);
  b.style.display = _ciNaoLidas > 0 ? 'flex' : 'none';
}

// ── Presença ─────────────────────────────────────────────────
function _ciRenderOnline() {
  if (!_ciPr) return;
  const todos  = Object.values(_ciPr.presenceState()).flat();
  const outros = todos.filter(p => p.user_id !== currentUser.id);
  const label  = document.getElementById('ciOnlineLabel');
  if (label) label.textContent = outros.length ? `${outros.length + 1} online` : 'Apenas você online';
  const wrap = document.getElementById('ciOnlineAvatares');
  if (!wrap) return;
  wrap.innerHTML = '';
  outros.slice(0, 5).forEach(p => {
    const uid = p.user_id;
    const d   = document.createElement('div');
    d.style.cssText = 'position:relative;flex-shrink:0';
    d.title = p.nome || _ciNome(uid);
    d.appendChild(_ciAvatarEl(uid, p.avatar || _ciPerfis[uid]?.avatar_url || '', p.nome || _ciNome(uid), 22));
    const dot = document.createElement('span');
    dot.style.cssText = 'position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#16a34a;border-radius:50%;border:1.5px solid var(--card)';
    d.appendChild(dot);
    wrap.appendChild(d);
  });
}

function _ciToastMsg(msg) {
  const nome    = msg.nome_sender || _ciNome(msg.user_id);
  const preview = (msg.conteudo || '').startsWith('[img:') ? '📷 Imagem'
    : (msg.conteudo || '').slice(0, 60) + ((msg.conteudo || '').length > 60 ? '…' : '');
  showToast(`💬 ${nome}: ${preview}`, 'info', 4500);
}
