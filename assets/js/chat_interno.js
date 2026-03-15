// ============================================================
// CHAT_INTERNO.JS v4
// Arquitetura de dedup corrigida:
//   - Msgs próprias: renderizadas localmente, tempId no Set,
//     pg_changes ignorado via fonte='pg' + user_id check
//   - Msgs de outros: broadcast registra UUID-like key,
//     pg_changes registra UUID real — ambos usam conteudo+uid+min
//     como chave normalizada para garantir match
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
let _ciFp        = new Set(); // chaves de dedup
let _ciDigTimer  = null;
let _ciDigitando = {};
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
    if (!_ciACtx) _ciACtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ciACtx.state === 'suspended') _ciACtx.resume();
    const osc = _ciACtx.createOscillator(), gain = _ciACtx.createGain();
    osc.connect(gain); gain.connect(_ciACtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, _ciACtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, _ciACtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, _ciACtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ciACtx.currentTime + 0.22);
    osc.start(_ciACtx.currentTime);
    osc.stop(_ciACtx.currentTime + 0.22);
  } catch(_) {}
}

// ── Chave de dedup ────────────────────────────────────────────
// Usa uid + minuto + primeiros 60 chars — funciona tanto para
// o broadcast (sem id definitivo) quanto para o pg_changes (com UUID)
function _ciKey(msg) {
  const min = (msg.criado_em || new Date().toISOString()).slice(0, 16); // "2026-03-13T14:05"
  return `${msg.user_id}|${min}|${(msg.conteudo || '').slice(0, 60)}`;
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

function ciReset() {
  // Cancelar subscriptions ativas
  if (_ciBc) { try { sb.removeChannel(_ciBc); } catch {} _ciBc = null; }
  if (_ciPg) { try { sb.removeChannel(_ciPg); } catch {} _ciPg = null; }
  if (_ciPr) { try { sb.removeChannel(_ciPr); } catch {} _ciPr = null; }
  // Resetar estado
  _ciEscId     = null;
  _ciEscNome   = '';
  _ciReady     = false;
  _ciFp        = new Set();
  _ciPerfis    = {};
  _ciNaoLidas  = 0;
  _ciAberto    = false;
  _ciPagina    = 0;
  if (_ciDigTimer) { clearTimeout(_ciDigTimer); _ciDigTimer = null; }
  const btn = document.getElementById('ciBtnHeader');
  if (btn) btn.style.display = 'none';
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
  const fs = Math.round(sz * 0.42), cor = _ciCor(uid);
  const ini = ((nome || '?')[0] || '?').toUpperCase();
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0`;
    img.alt = '';
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
    .on('broadcast', { event: 'msg'      }, ({ payload }) => _ciReceber(payload, 'bc'))
    .on('broadcast', { event: 'typing'   }, ({ payload }) => _ciMostrarDigitando(payload))
    .on('broadcast', { event: 'reaction' }, ({ payload }) => _ciAplicarReacao(payload))
    .subscribe();

  _ciPg = sb.channel(`ci_pg_${_ciEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'chat_interno_mensagens',
      filter: `escritorio_id=eq.${_ciEscId}`,
    }, ({ new: row }) => _ciReceber(row, 'pg'))
    .subscribe();

  _ciPr = sb.channel(`ci_pr_${_ciEscId}`, { config: { presence: { key: currentUser.id } } })
    .on('presence', { event: 'sync'  }, _ciRenderOnline)
    .on('presence', { event: 'join'  }, _ciRenderOnline)
    .on('presence', { event: 'leave' }, _ciRenderOnline)
    .subscribe(async s => {
      if (s !== 'SUBSCRIBED') return;
      await _ciPr.track({
        user_id: currentUser.id,
        nome: _ciNome(currentUser.id),
        avatar: _ciPerfis[currentUser.id]?.avatar_url || '',
      });
    });
}

// ── Receber — lógica de dedup corrigida ───────────────────────
function _ciReceber(msg, fonte) {
  // REGRA 1: msgs próprias via pg_changes → sempre ignorar
  // (já foram renderizadas localmente antes do INSERT)
  if (fonte === 'pg' && msg.user_id === currentUser.id) return;

  // REGRA 2: dedup por chave normalizada uid+minuto+conteudo
  // Tanto o broadcast quanto o pg_changes do mesmo usuário
  // produzem a mesma key → segunda chegada é ignorada
  const key = _ciKey(msg);
  if (_ciFp.has(key)) return;
  _ciFp.add(key);

  // Atualizar cache de perfil com dados embutidos
  if (msg.nome_sender && !_ciPerfis[msg.user_id]?.nome) {
    _ciPerfis[msg.user_id] = {
      user_id: msg.user_id,
      nome: msg.nome_sender,
      avatar_url: msg.avatar_sender || '',
    };
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

// ── "Digitando..." ────────────────────────────────────────────
function ciInputDigitando() {
  clearTimeout(_ciDigTimer);
  _ciDigTimer = setTimeout(() => {
    _ciBc?.send({ type: 'broadcast', event: 'typing',
      payload: { user_id: currentUser.id, nome: _ciNome(currentUser.id) } });
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
    el.style.display = 'none'; el.textContent = '';
  }, 3000);
}

// ── Reações ───────────────────────────────────────────────────
const CI_REACOES = ['👍','❤️','😂','😮','🎉','✅'];

function ciMostrarReacoes(wrapEl, msgId) {
  document.querySelector('.ci-reacao-picker')?.remove();
  const picker = document.createElement('div');
  picker.className = 'ci-reacao-picker';
  CI_REACOES.forEach(e => {
    const btn = document.createElement('button');
    btn.textContent = e;
    btn.onclick = (ev) => { ev.stopPropagation(); ciEnviarReacao(msgId, e); picker.remove(); };
    picker.appendChild(btn);
  });
  wrapEl.style.position = 'relative';
  wrapEl.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 10);
}

async function ciEnviarReacao(msgId, emoji) {
  if (!_ciBc) return;
  const payload = { msg_id: msgId, emoji, user_id: currentUser.id, nome: _ciNome(currentUser.id) };
  _ciBc.send({ type: 'broadcast', event: 'reaction', payload });
  _ciAplicarReacao(payload);
  await sb.from('chat_interno_reacoes').upsert(
    { mensagem_id: msgId, user_id: currentUser.id, emoji },
    { onConflict: 'mensagem_id,user_id' }
  );
}

function _ciAplicarReacao({ msg_id, emoji, user_id, nome }) {
  // Buscar o wrap correto pelo data-msg-id
  const wrapEl = document.querySelector(`.ci-msg-wrap[data-msg-id="${msg_id}"]`);
  if (!wrapEl) return;

  let reacoes = wrapEl.querySelector('.ci-reacoes');
  if (!reacoes) {
    reacoes = document.createElement('div');
    reacoes.className = 'ci-reacoes';
    wrapEl.appendChild(reacoes);
  }

  let btn = reacoes.querySelector(`[data-emoji="${CSS.escape(emoji)}"]`);
  if (btn) {
    const n = parseInt(btn.dataset.count || '0') + 1;
    btn.dataset.count = n;
    btn.querySelector('.ci-r-count').textContent = n;
  } else {
    btn = document.createElement('button');
    btn.className = 'ci-r-btn';
    btn.dataset.emoji = emoji;
    btn.dataset.count = '1';
    btn.title = nome || '';
    const span = document.createElement('span');
    span.className = 'ci-r-count';
    span.textContent = '1';
    btn.append(document.createTextNode(emoji + ' '), span);
    reacoes.appendChild(btn);
  }
  if (user_id === currentUser.id) btn.classList.add('ci-r-proprio');
}

// ── Upload de imagem ──────────────────────────────────────────
function ciAbrirUpload() {
  document.getElementById('ciFileInput')?.click();
}

async function ciHandleFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande (máx 5MB).', 'warn'); return; }
  if (!file.type.startsWith('image/')) { showToast('Apenas imagens são suportadas.', 'warn'); return; }

  showToast('Enviando imagem...', 'info', 3000);

  const ext  = (file.name.split('.').pop() || 'png').toLowerCase();
  // Path: chat_img/{uid}/{timestamp}.ext
  // Primeiro folder = uid do usuário → bate com a policy existente
  const path = `chat_img/${currentUser.id}/${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage
    .from('portal-uploads')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) {
    console.error('storage upload error:', upErr);
    showToast(`Erro ao enviar imagem: ${upErr.message}`, 'error');
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('portal-uploads').getPublicUrl(path);
  await _ciEnviarMensagem(`[img:${publicUrl}]`);
}

// ── Abrir / Fechar ────────────────────────────────────────────
async function abrirChatInterno() {
  if (!_ciReady) {
    await ciInit();
    if (!_ciReady) { showToast('Chat indisponível.', 'warn'); return; }
  }
  _ciAberto = true;
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

  if (!append) {
    corpo.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="hon-spinner"></div></div>';
    _ciFp.clear(); // limpar dedup ao recarregar histórico completo
  }

  const from = _ciPagina * _CI_PS;
  const { data, error } = await sb.from('chat_interno_mensagens')
    .select('id,user_id,conteudo,nome_sender,avatar_sender,criado_em')
    .eq('escritorio_id', _ciEscId)
    .order('criado_em', { ascending: false })
    .range(from, from + _CI_PS - 1);

  if (error) {
    if (!append) corpo.innerHTML = '<p class="ci-vazio">Erro ao carregar.</p>';
    return;
  }

  const msgs = (data || []).reverse();
  await _ciFetchPerfis([...new Set(msgs.map(m => m.user_id))]);

  if (!append) {
    corpo.innerHTML = '';
    if (!msgs.length) {
      corpo.innerHTML = '<p class="ci-vazio">Nenhuma mensagem ainda.<br>Seja o primeiro a falar! 👋</p>';
      return;
    }
  }

  if ((data?.length || 0) === _CI_PS && !corpo.querySelector('.ci-load-mais')) {
    const d = document.createElement('div');
    d.className = 'ci-load-mais';
    d.innerHTML = '<button onclick="_ciMaisAntigo()">Carregar mensagens anteriores</button>';
    corpo.insertBefore(d, corpo.firstChild);
  }

  const diasSet = new Set();
  const frag = document.createDocumentFragment();
  msgs.forEach(m => {
    // Registrar AMBAS as chaves: key normalizada E id UUID
    _ciFp.add(_ciKey(m));
    if (m.id) _ciFp.add(m.id);
    frag.appendChild(_ciCriarEl(m, diasSet));
  });

  if (append) {
    const antes = corpo.scrollHeight;
    corpo.insertBefore(frag, corpo.querySelector('.ci-load-mais')?.nextSibling || corpo.firstChild);
    corpo.scrollTop = corpo.scrollHeight - antes;
  } else {
    corpo.appendChild(frag);
    corpo.scrollTop = corpo.scrollHeight;
  }

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
// Último dia renderizado por _ciRenderMsgNova — rastreado via DOM
function _ciUltimoDia() {
  const seps = document.querySelectorAll('#ciCorpo .ci-sep-dia');
  if (!seps.length) return '';
  return seps[seps.length - 1].dataset.dia || '';
}

function _ciCriarEl(msg, diasSet) {
  const frag = document.createDocumentFragment();
  const dia  = (msg.criado_em || '').slice(0, 10);

  if (dia && !diasSet.has(dia)) {
    diasSet.add(dia);
    const hoje  = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const label = dia === hoje ? 'Hoje' : dia === ontem ? 'Ontem'
      : new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const sep = document.createElement('div');
    sep.className = 'ci-sep-dia';
    sep.dataset.dia = dia; // armazenar data no DOM, não no texto
    sep.innerHTML = `<span>${label}</span>`;
    frag.appendChild(sep);
  }

  const proprio = msg.user_id === currentUser.id;
  const hora    = msg.criado_em
    ? new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nome   = _ciPerfis[msg.user_id]?.nome || msg.nome_sender || _ciNome(msg.user_id);
  const src    = _ciPerfis[msg.user_id]?.avatar_url || msg.avatar_sender || '';
  const avatar = _ciAvatarEl(msg.user_id, src, nome, 28);

  const wrap = document.createElement('div');
  wrap.className = `ci-msg-wrap ${proprio ? 'ci-prp-wrap' : ''}`;
  if (msg.id) wrap.dataset.msgId = msg.id;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ci-msg ${proprio ? 'ci-prp' : 'ci-out'}`;

  const bubble = document.createElement('div');
  bubble.className = 'ci-bubble';

  const conteudo = msg.conteudo || '';
  if (conteudo.startsWith('[img:') && conteudo.endsWith(']')) {
    const url = conteudo.slice(5, -1);
    const img = document.createElement('img');
    img.src = url;
    img.className = 'ci-img-preview';
    img.onclick = () => window.open(url, '_blank');
    img.onerror = () => { img.style.display = 'none'; };
    bubble.appendChild(img);
  } else {
    const html = escapeHtml(conteudo).replace(/\n/g, '<br>')
      .replace(/@(\S+)/g, '<span class="ci-mencao">@$1</span>');
    bubble.innerHTML = html;
  }

  const horaEl = document.createElement('span');
  horaEl.className = 'ci-hora';
  horaEl.textContent = hora;
  bubble.appendChild(horaEl);

  // Botão reação — só em msgs com ID real (salvas no banco)
  if (msg.id) {
    const rBtn = document.createElement('button');
    rBtn.className = 'ci-r-trigger';
    rBtn.textContent = '😊';
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
    msgDiv.appendChild(avatar);
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

  // Usar data-dia do DOM em vez de comparar texto
  const dia     = (msg.criado_em || new Date().toISOString()).slice(0, 10);
  const diasSet = new Set([_ciUltimoDia()]);

  corpo.appendChild(_ciCriarEl(msg, diasSet));
  corpo.scrollTop = corpo.scrollHeight;
}

// ── Enviar ────────────────────────────────────────────────────
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

  const localMsg = { user_id: currentUser.id, escritorio_id: _ciEscId,
    conteudo, nome_sender: nome, avatar_sender: avatar, criado_em: agora };

  // Registrar chave normalizada ANTES de renderizar
  // Quando o pg_changes chegar com o mesmo uid+min+conteudo → ignorado
  _ciFp.add(_ciKey(localMsg));
  _ciRenderMsgNova(localMsg);

  // Broadcast para outros via canal instantâneo
  _ciBc?.send({ type: 'broadcast', event: 'msg', payload: localMsg });

  // Persistir
  const { error } = await sb.from('chat_interno_mensagens').insert({
    escritorio_id: _ciEscId, user_id: currentUser.id,
    conteudo, nome_sender: nome, avatar_sender: avatar,
  });
  if (error) {
    console.error('ci insert:', error);
    showToast(`Erro ao enviar: ${error.message}`, 'error');
  }
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

// ── Presença ──────────────────────────────────────────────────
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
    const d = document.createElement('div');
    d.style.cssText = 'position:relative;flex-shrink:0';
    d.title = p.nome || _ciNome(p.user_id);
    d.appendChild(_ciAvatarEl(p.user_id, p.avatar || _ciPerfis[p.user_id]?.avatar_url || '', p.nome || _ciNome(p.user_id), 22));
    const dot = document.createElement('span');
    dot.style.cssText = 'position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#16a34a;border-radius:50%;border:1.5px solid var(--card)';
    d.appendChild(dot);
    wrap.appendChild(d);
  });
}

// ── Toast ─────────────────────────────────────────────────────
function _ciToastMsg(msg) {
  const nome    = msg.nome_sender || _ciNome(msg.user_id);
  const preview = (msg.conteudo || '').startsWith('[img:') ? '📷 Imagem'
    : (msg.conteudo || '').slice(0, 60) + ((msg.conteudo || '').length > 60 ? '…' : '');
  showToast(`💬 ${nome}: ${preview}`, 'info', 4500);
}

// ============================================================
// DMs — Mensagens Diretas entre contadores
// Canal: ci_dm_{min(idA,idB)}_{max(idA,idB)} (Supabase Broadcast)
// ============================================================

let _dmCanais      = {};   // { peerId: channel }
let _dmHistorico   = {};   // { peerId: [msgs] }
let _dmPeerAtivo   = null; // userId do contador na conversa aberta
let _dmNaoLidas    = {};   // { peerId: count }

// ── Abrir DM com um usuário ───────────────────────────────────
async function ciAbrirDM(peerId) {
  if (!peerId || peerId === currentUser.id) return;
  _dmPeerAtivo = peerId;

  // Criar canal DM se ainda não existe
  if (!_dmCanais[peerId]) {
    const ids  = [currentUser.id, peerId].sort();
    const nome = `ci_dm_${ids[0]}_${ids[1]}`;
    const canal = sb.channel(nome, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'dm' }, ({ payload }) => _dmReceberMsg(payload));
    await canal.subscribe();
    _dmCanais[peerId] = canal;
  }

  // Carregar histórico do banco
  if (!_dmHistorico[peerId]) {
    const ids = [currentUser.id, peerId].sort();
    const { data } = await sb.from('chat_dm_mensagens')
      .select('*')
      .or(`and(sender_id.eq.${ids[0]},receiver_id.eq.${ids[1]}),and(sender_id.eq.${ids[1]},receiver_id.eq.${ids[0]})`)
      .order('criado_em', { ascending: true })
      .limit(100);
    _dmHistorico[peerId] = data || [];
  }

  // Marcar como lidas
  _dmNaoLidas[peerId] = 0;
  _dmRenderBadgeTotal();

  _dmRenderModal();
}

// ── Enviar mensagem DM ────────────────────────────────────────
async function ciEnviarDM() {
  const input = document.getElementById('dmInput');
  const texto = input?.value.trim();
  if (!texto || !_dmPeerAtivo) return;
  input.value = '';

  const msg = {
    id:          crypto.randomUUID?.() || Date.now().toString(36),
    sender_id:   currentUser.id,
    receiver_id: _dmPeerAtivo,
    conteudo:    texto,
    criado_em:   new Date().toISOString(),
    nome_sender: _ciNome(currentUser.id),
  };

  // Render local imediato
  if (!_dmHistorico[_dmPeerAtivo]) _dmHistorico[_dmPeerAtivo] = [];
  _dmHistorico[_dmPeerAtivo].push(msg);
  _dmAppendMsg(msg);

  // Broadcast para o peer
  _dmCanais[_dmPeerAtivo]?.send({ type: 'broadcast', event: 'dm', payload: msg });

  // Persistir
  await sb.from('chat_dm_mensagens').insert({
    sender_id:   currentUser.id,
    receiver_id: _dmPeerAtivo,
    conteudo:    texto,
    nome_sender: msg.nome_sender,
  }).catch(e => console.error('dm insert:', e));
}

// ── Receber mensagem DM ───────────────────────────────────────
function _dmReceberMsg(msg) {
  if (!msg?.sender_id) return;
  const peer = msg.sender_id;

  if (!_dmHistorico[peer]) _dmHistorico[peer] = [];
  _dmHistorico[peer].push(msg);

  // Se DM com este peer está aberto, renderizar
  if (_dmPeerAtivo === peer) {
    _dmAppendMsg(msg);
  } else {
    // Incrementar badge de não lidas
    _dmNaoLidas[peer] = (_dmNaoLidas[peer] || 0) + 1;
    _dmRenderBadgeTotal();
    _ciSom();
    showToast(`💬 DM de ${msg.nome_sender || _ciNome(peer)}: ${msg.conteudo.substring(0, 60)}`, 'info', 4000);
  }
}

// ── Render modal DM ───────────────────────────────────────────
function _dmRenderModal() {
  let modal = document.getElementById('dmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dmModal';
    modal.style.cssText = 'position:fixed;bottom:80px;right:24px;width:340px;height:460px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.2);z-index:8500;display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(modal);
  }

  const nome  = _ciNome(_dmPeerAtivo);
  const avatar = _ciPerfis[_dmPeerAtivo]?.avatar_url || '';
  const msgs  = (_dmHistorico[_dmPeerAtivo] || []);

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--card)">
      ${_ciAvatarEl(_dmPeerAtivo, avatar, nome, 28).outerHTML}
      <div style="flex:1;font-size:13px;font-weight:600">${escapeHtml(nome)}</div>
      <button onclick="ciFecharDM()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-light)">
        <i data-lucide="x" style="width:15px;height:15px"></i>
      </button>
    </div>
    <div id="dmMsgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
      ${msgs.map(m => _dmRenderMsgHtml(m)).join('')}
    </div>
    <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px">
      <input id="dmInput" type="text" placeholder="Mensagem direta..."
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ciEnviarDM()}"
        style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:13px;outline:none">
      <button onclick="ciEnviarDM()"
        style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600">
        <i data-lucide="send" style="width:14px;height:14px"></i>
      </button>
    </div>`;

  if (window.lucide) lucide.createIcons();

  // Scroll ao final
  const msgsEl = document.getElementById('dmMsgs');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  setTimeout(() => document.getElementById('dmInput')?.focus(), 100);
}

function _dmRenderMsgHtml(msg) {
  const proprio = msg.sender_id === currentUser.id;
  const hora    = new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `
    <div style="display:flex;flex-direction:column;align-items:${proprio ? 'flex-end' : 'flex-start'}">
      <div style="max-width:80%;padding:8px 12px;border-radius:${proprio ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
        background:${proprio ? 'var(--accent)' : 'var(--sidebar-hover)'};
        color:${proprio ? '#fff' : 'var(--text)'};font-size:13px;line-height:1.4">
        ${escapeHtml(msg.conteudo)}
      </div>
      <span style="font-size:10px;color:var(--text-light);margin-top:2px">${hora}</span>
    </div>`;
}

function _dmAppendMsg(msg) {
  const el = document.getElementById('dmMsgs');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', _dmRenderMsgHtml(msg));
  el.scrollTop = el.scrollHeight;
}

function ciFecharDM() {
  document.getElementById('dmModal')?.remove();
  _dmPeerAtivo = null;
}

function _dmRenderBadgeTotal() {
  const total = Object.values(_dmNaoLidas).reduce((s, n) => s + n, 0);
  const badge = document.getElementById('dmBadgeTotal');
  if (badge) {
    badge.textContent   = total > 9 ? '9+' : String(total);
    badge.style.display = total > 0 ? 'flex' : 'none';
  }
}
