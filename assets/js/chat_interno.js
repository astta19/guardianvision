// ============================================================
// CHAT_INTERNO.JS v4
// Broadcast (UI instantânea) + postgres_changes (persistência)
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _ciEscId    = null;
let _ciEscNome  = '';
let _ciBc       = null;
let _ciPg       = null;
let _ciPr       = null;
let _ciPerfis   = {};
let _ciNaoLidas = 0;
let _ciAberto   = false;
let _ciPagina   = 0;
let _ciReady    = false;
// Dedup por fingerprint — evita colisão entre id temporário (broadcast) e uuid (banco)
let _ciFp       = new Set();
const _CI_PS    = 40;

// ── Som ───────────────────────────────────────────────────────
let _ciACtx    = null;
let _ciAUnlock = false;

// Desbloquear AudioContext na primeira interação do usuário
document.addEventListener('click', function _ciUnlockAudio() {
  if (_ciAUnlock) return;
  try {
    _ciACtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ciACtx.state === 'suspended') _ciACtx.resume();
    _ciAUnlock = true;
  } catch(_) {}
}, { once: false, passive: true });

function _ciSom() {
  try {
    if (!_ciACtx || _ciACtx.state === 'suspended') return;
    const osc  = _ciACtx.createOscillator();
    const gain = _ciACtx.createGain();
    osc.connect(gain);
    gain.connect(_ciACtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, _ciACtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, _ciACtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.18, _ciACtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ciACtx.currentTime + 0.25);
    osc.start(_ciACtx.currentTime);
    osc.stop(_ciACtx.currentTime + 0.25);
  } catch (_) {}
}

// ── Fingerprint de dedup ──────────────────────────────────────
// Usa conteudo+user_id+minuto — funciona para id temporário e uuid real
function _ciFpKey(msg) {
  const min = (msg.criado_em || '').slice(0, 16); // "2026-03-11T14:05"
  return `${msg.user_id}|${min}|${(msg.conteudo || '').slice(0, 40)}`;
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
  const novos = ids.filter(id => id && !_ciPerfis[id]);
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
  const cor = _ciCor(uid);
  const ini = (nome || '?')[0].toUpperCase();
  const fs  = Math.round(sz * 0.42);
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

// ── Canais Realtime ───────────────────────────────────────────
function _ciSubscribe() {
  if (_ciBc) sb.removeChannel(_ciBc);
  if (_ciPg) sb.removeChannel(_ciPg);
  if (_ciPr) sb.removeChannel(_ciPr);

  // Broadcast: entrega <100ms, self:false = não recebe de volta
  _ciBc = sb.channel(`ci_bc_${_ciEscId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msg' }, ({ payload }) => _ciReceber(payload, 'bc'))
    .subscribe();

  // postgres_changes: resiliência + sync outras abas
  _ciPg = sb.channel(`ci_pg_${_ciEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'chat_interno_mensagens',
      filter: `escritorio_id=eq.${_ciEscId}`,
    }, ({ new: row }) => _ciReceber(row, 'pg'))
    .subscribe();

  // Presence
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

// ── Receber mensagem (broadcast ou pg_changes) ────────────────
function _ciReceber(msg, fonte) {
  // Dedup por fingerprint (conteudo+user+minuto) — cobre id_temp vs uuid_real
  const fp = _ciFpKey(msg);
  if (_ciFp.has(fp)) return;
  _ciFp.add(fp);

  // Atualizar cache de perfil com dados embutidos
  if (msg.user_id && msg.nome_sender && !_ciPerfis[msg.user_id]?.nome) {
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

  // Limpar estado ao abrir — histórico fresco a cada abertura
  _ciPagina = 0;
  _ciFp.clear();
  await _ciCarregarHistorico(false);
  _ciMarcarLidas();
  setTimeout(() => document.getElementById('ciInput')?.focus(), 100);
}

function fecharChatInterno() {
  _ciAberto = false;
  const drawer = document.getElementById('ciDrawer');
  drawer.classList.remove('ci-open');
  setTimeout(() => { if (!_ciAberto) drawer.style.display = 'none'; }, 280);
}

// ── Histórico ────────────────────────────────────────────────
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

  if (error) {
    if (!append) corpo.innerHTML = '<p class="ci-vazio">Erro ao carregar histórico.</p>';
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

  if ((data || []).length === _CI_PS && !corpo.querySelector('.ci-load-mais')) {
    const btn = document.createElement('div');
    btn.className = 'ci-load-mais';
    btn.innerHTML = '<button onclick="_ciMaisAntigo()">Carregar mensagens anteriores</button>';
    corpo.insertBefore(btn, corpo.firstChild);
  }

  const diasSet = new Set();
  const frag    = document.createDocumentFragment();
  msgs.forEach(m => {
    _ciFp.add(_ciFpKey(m)); // registrar no dedup para não duplicar via realtime
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
}

async function _ciMaisAntigo() {
  _ciPagina++;
  await _ciCarregarHistorico(true);
}

// ── Construir elemento de mensagem ────────────────────────────
function _ciCriarEl(msg, diasSet) {
  const frag   = document.createDocumentFragment();
  const dia    = (msg.criado_em || '').slice(0, 10);

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

  const bubble = document.createElement('div');
  bubble.className = 'ci-bubble';
  bubble.innerHTML = escapeHtml(msg.conteudo || '').replace(/\n/g, '<br>');
  const hora_el = document.createElement('span');
  hora_el.className = 'ci-hora';
  hora_el.textContent = hora;
  bubble.appendChild(hora_el);

  const div = document.createElement('div');
  div.className = `ci-msg ${proprio ? 'ci-prp' : 'ci-out'}`;

  if (proprio) {
    div.appendChild(bubble);
    div.appendChild(avatar);
  } else {
    const mbody = document.createElement('div');
    mbody.className = 'ci-mbody';
    const nomeEl = document.createElement('div');
    nomeEl.className = 'ci-nome';
    nomeEl.textContent = nome;
    mbody.appendChild(nomeEl);
    mbody.appendChild(bubble);
    div.appendChild(avatar);
    div.appendChild(mbody);
  }

  frag.appendChild(div);
  return frag;
}

// Renderizar msg nova recebida via realtime no corpo aberto
function _ciRenderMsgNova(msg) {
  const corpo = document.getElementById('ciCorpo');
  if (!corpo) return;
  corpo.querySelector('.ci-vazio')?.remove();

  // Descobrir último dia já exibido para o separador
  const diasSet  = new Set();
  const sepAtual = [...corpo.querySelectorAll('.ci-sep-dia')].pop();
  if (sepAtual) {
    // Marcar o dia de hoje se o último sep for "Hoje"
    if (sepAtual.querySelector('span')?.textContent === 'Hoje') {
      diasSet.add(new Date().toISOString().slice(0, 10));
    }
  }
  corpo.appendChild(_ciCriarEl(msg, diasSet));
  corpo.scrollTop = corpo.scrollHeight;
}

// ── Enviar ────────────────────────────────────────────────────
async function ciEnviar() {
  const input = document.getElementById('ciInput');
  const texto = input?.value.trim();
  if (!texto || !_ciEscId) return;

  const backup = texto;
  input.value  = '';
  input.style.height = 'auto';

  const agora  = new Date().toISOString();
  const nome   = _ciNome(currentUser.id);
  const avatar = _ciPerfis[currentUser.id]?.avatar_url || '';

  const payload = {
    user_id:       currentUser.id,
    escritorio_id: _ciEscId,
    conteudo:      texto,
    nome_sender:   nome,
    avatar_sender: avatar,
    criado_em:     agora,
  };

  // Registrar fingerprint antes de renderizar — bloqueia chegada via pg_changes
  _ciFp.add(_ciFpKey(payload));

  // Renderizar localmente de imediato
  _ciRenderMsgNova(payload);

  // Broadcast para outros (<100ms)
  _ciBc.send({ type: 'broadcast', event: 'msg', payload });

  // Persistir no banco
  const { error } = await sb.from('chat_interno_mensagens').insert({
    escritorio_id: _ciEscId,
    user_id:       currentUser.id,
    conteudo:      texto,
    nome_sender:   nome,
    avatar_sender: avatar,
  });
  if (error) {
    showToast('Erro ao salvar mensagem.', 'error');
    input.value = backup;
  }
}

function ciKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ciEnviar(); }
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
}

// ── Não lidas ────────────────────────────────────────────────
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

  const label = document.getElementById('ciOnlineLabel');
  if (label) label.textContent = outros.length ? `${outros.length + 1} online` : 'Apenas você online';

  const wrap = document.getElementById('ciOnlineAvatares');
  if (!wrap) return;
  wrap.innerHTML = '';
  outros.slice(0, 5).forEach(p => {
    const uid  = p.user_id;
    const nome = p.nome || _ciNome(uid);
    const src  = p.avatar || _ciPerfis[uid]?.avatar_url || '';
    const wrap2 = document.createElement('div');
    wrap2.style.cssText = 'position:relative;flex-shrink:0';
    wrap2.title = nome;
    wrap2.appendChild(_ciAvatarEl(uid, src, nome, 22));
    const dot = document.createElement('span');
    dot.style.cssText = 'position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#16a34a;border-radius:50%;border:1.5px solid var(--card)';
    wrap2.appendChild(dot);
    wrap.appendChild(wrap2);
  });
}

// ── Toast ────────────────────────────────────────────────────
function _ciToastMsg(msg) {
  const nome    = msg.nome_sender || _ciNome(msg.user_id);
  const preview = (msg.conteudo || '').slice(0, 60) + ((msg.conteudo || '').length > 60 ? '…' : '');
  showToast(`💬 ${nome}: ${preview}`, 'info', 4500);
}
