// ============================================================
// CHAT_INTERNO.JS v2 — Chat em tempo real entre contadores
//
// Arquitetura dual:
//   • Broadcast (Supabase Realtime) → entrega <100ms para UI
//   • postgres_changes → resiliência/sync entre abas
//   • INSERT no banco em paralelo → persistência
//
// Fixes v2: avatar on-demand + onerror fallback, nome embutido
//   na mensagem, som via AudioContext, canal inicia no boot,
//   separador de dia por Set (sem variável global), presença
//   com avatar/nome do payload (sem depender de cache).
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _ciEscId     = null;
let _ciEscNome   = '';
let _ciBc        = null;   // broadcast
let _ciPg        = null;   // postgres_changes
let _ciPr        = null;   // presence
let _ciPerfis    = {};     // { uid: { nome, avatar_url } }
let _ciNaoLidas  = 0;
let _ciAberto    = false;
let _ciPagina    = 0;
let _ciReady     = false;
let _ciIds       = new Set(); // dedup broadcast + pg_changes
const _CI_PS     = 40;

// ── Som de notificação (AudioContext) ─────────────────────────
let _ciACtx = null;
function _ciSom() {
  try {
    if (!_ciACtx) _ciACtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = _ciACtx.createOscillator();
    const gain = _ciACtx.createGain();
    osc.connect(gain);
    gain.connect(_ciACtx.destination);
    osc.frequency.setValueAtTime(880, _ciACtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, _ciACtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, _ciACtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ciACtx.currentTime + 0.2);
    osc.start(_ciACtx.currentTime);
    osc.stop(_ciACtx.currentTime + 0.2);
  } catch (_) {}
}

// ── Bootstrap (chamado no boot via core.js) ───────────────────
async function ciInit() {
  if (!currentUser) return;
  if (!isAdmin() && !_ciTemPermissao()) return;

  _ciEscId = await _ciResolverEscritorio();
  if (!_ciEscId) return;

  _ciReady = true;
  await _ciCarregarPerfis();
  await _ciContarNaoLidas();
  _ciRenderBadge();
  _ciSubscribe(); // canais ativos no boot — não no primeiro clique

  const btn = document.getElementById('ciBtnHeader');
  if (btn) btn.style.display = 'flex';
}

function _ciTemPermissao() {
  const perms = currentUser?.user_metadata?.permissions || [];
  return perms.includes('chat_interno');
}

async function _ciResolverEscritorio() {
  const { data: own } = await sb.from('escritorios')
    .select('id, nome').eq('owner_id', currentUser.id).limit(1);
  if (own?.length) { _ciEscNome = own[0].nome || 'Escritório'; return own[0].id; }

  const { data: vin } = await sb.from('escritorio_usuarios')
    .select('escritorio_id, escritorios(nome)').eq('user_id', currentUser.id).limit(1);
  if (vin?.length) {
    _ciEscNome = vin[0].escritorios?.nome || 'Escritório';
    return vin[0].escritorio_id;
  }
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
    .select('user_id, nome, avatar_url').in('user_id', novos);
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

function _ciAvatarHtml(uid, src, nome, sz) {
  sz = sz || 28;
  const fs  = Math.round(sz * 0.42);
  const cor = _ciCor(uid);
  const ini = escapeHtml((nome || '?')[0].toUpperCase());
  if (!src) {
    return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${cor};color:#fff;font-size:${fs}px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ini}</div>`;
  }
  // onerror chama função global — evita problemas com aspas dentro de atributo HTML
  return `<img src="${escapeHtml(src)}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="ciAvatarFallback(this,'${uid}','${ini}',${sz})" alt="">`;
}

// Fallback global chamado pelo onerror do img
function ciAvatarFallback(img, uid, ini, sz) {
  const fs  = Math.round(sz * 0.42);
  const cor = _ciCor(uid);
  const div = document.createElement('div');
  div.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;background:${cor};color:#fff;font-size:${fs}px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0`;
  div.textContent = ini;
  img.replaceWith(div);
}

function _ciAvatar(uid, sz) {
  const p   = _ciPerfis[uid];
  const src = p?.avatar_url || '';
  const nm  = _ciNome(uid);
  return _ciAvatarHtml(uid, src, nm, sz || 28);
}

// ── Canais Realtime ───────────────────────────────────────────
function _ciSubscribe() {
  if (_ciBc) sb.removeChannel(_ciBc);
  if (_ciPg) sb.removeChannel(_ciPg);
  if (_ciPr) sb.removeChannel(_ciPr);

  // 1. Broadcast — entrega instantânea, self:false (não recebe própria msg)
  _ciBc = sb.channel(`ci_bc_${_ciEscId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msg' }, ({ payload }) => _ciReceber(payload))
    .subscribe();

  // 2. postgres_changes — sync/resiliência
  _ciPg = sb.channel(`ci_pg_${_ciEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'chat_interno_mensagens',
      filter: `escritorio_id=eq.${_ciEscId}`,
    }, ({ new: row }) => _ciReceber(row))
    .subscribe();

  // 3. Presence
  _ciPr = sb.channel(`ci_pr_${_ciEscId}`, { config: { presence: { key: currentUser.id } } })
    .on('presence', { event: 'sync'  }, _ciRenderOnline)
    .on('presence', { event: 'join'  }, _ciRenderOnline)
    .on('presence', { event: 'leave' }, _ciRenderOnline)
    .subscribe(async s => {
      if (s !== 'SUBSCRIBED') return;
      await _ciPr.track({
        user_id:  currentUser.id,
        nome:     _ciNome(currentUser.id),
        avatar:   _ciPerfis[currentUser.id]?.avatar_url || '',
      });
    });
}

// Ponto único de recebimento — deduplicação por id
function _ciReceber(msg) {
  const key = msg.id || `${msg.user_id}_${msg.criado_em}`;
  if (_ciIds.has(key)) return;
  _ciIds.add(key);
  if (msg.user_id && msg.nome_sender && !_ciPerfis[msg.user_id]?.nome) {
    _ciPerfis[msg.user_id] = {
      user_id:    msg.user_id,
      nome:       msg.nome_sender,
      avatar_url: msg.avatar_sender || '',
    };
  }

  if (_ciAberto) {
    _ciRenderMsg(msg, true);
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

  _ciPagina = 0;
  // NÃO limpar _ciIds aqui — mantém dedup de msgs já renderizadas via broadcast
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

  if (!append) {
    corpo.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="hon-spinner"></div></div>';
  }

  const from = _ciPagina * _CI_PS;
  const { data, error } = await sb.from('chat_interno_mensagens')
    .select('id, user_id, conteudo, nome_sender, avatar_sender, criado_em')
    .eq('escritorio_id', _ciEscId)
    .order('criado_em', { ascending: false })
    .range(from, from + _CI_PS - 1);

  if (error) {
    if (!append) corpo.innerHTML = '<p class="ci-vazio">Erro ao carregar histórico.</p>';
    return;
  }

  const msgs = (data || []).reverse();

  // Pré-fetch de perfis ausentes
  const uids = [...new Set(msgs.map(m => m.user_id))];
  await _ciFetchPerfis(uids);

  if (!append) {
    corpo.innerHTML = '';
    if (!msgs.length) {
      corpo.innerHTML = '<p class="ci-vazio">Nenhuma mensagem ainda.<br>Seja o primeiro a falar! 👋</p>';
      return;
    }
  }

  if (data?.length === _CI_PS) {
    if (!corpo.querySelector('.ci-load-mais')) {
      const div = document.createElement('div');
      div.className = 'ci-load-mais';
      div.innerHTML = '<button onclick="_ciMaisAntigo()">Carregar mensagens anteriores</button>';
      corpo.insertBefore(div, corpo.firstChild);
    }
  }

  const diasSet = new Set();
  const frag    = document.createDocumentFragment();
  msgs.forEach(m => {
    _ciIds.add(m.id);
    frag.appendChild(_ciCriarFrag(m, diasSet));
  });

  if (append) {
    const antes = corpo.scrollHeight;
    const ref   = corpo.querySelector('.ci-load-mais')?.nextSibling || corpo.firstChild;
    corpo.insertBefore(frag, ref);
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

// ── Criar fragmento de mensagem ───────────────────────────────
function _ciCriarFrag(msg, diasSet) {
  const frag   = document.createDocumentFragment();
  const dia    = (msg.criado_em || '').slice(0, 10);

  if (dia && !diasSet.has(dia)) {
    diasSet.add(dia);
    const hoje  = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const label = dia === hoje ? 'Hoje'
      : dia === ontem ? 'Ontem'
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

  // Nome: cache > embutido na mensagem
  const nomePerfil = _ciPerfis[msg.user_id]?.nome;
  const nome       = nomePerfil || msg.nome_sender || _ciNome(msg.user_id);

  // Avatar: cache > embutido na mensagem
  const avatSrc = _ciPerfis[msg.user_id]?.avatar_url || msg.avatar_sender || '';
  const avatar  = _ciAvatarHtml(msg.user_id, avatSrc, nome, 28);

  const texto = escapeHtml(msg.conteudo || '').replace(/\n/g, '<br>');

  const div = document.createElement('div');
  div.className = `ci-msg ${proprio ? 'ci-prp' : 'ci-out'}`;
  div.innerHTML = proprio
    ? `<div class="ci-bubble">${texto}<span class="ci-hora">${hora}</span></div>${avatar}`
    : `${avatar}<div class="ci-mbody"><div class="ci-nome">${escapeHtml(nome)}</div><div class="ci-bubble">${texto}<span class="ci-hora">${hora}</span></div></div>`;

  frag.appendChild(div);
  return frag;
}

// Renderizar msg nova em realtime (broadcast/pg) no corpo aberto
function _ciRenderMsg(msg, scroll) {
  const corpo = document.getElementById('ciCorpo');
  if (!corpo) return;
  corpo.querySelector('.ci-vazio')?.remove();

  // Descobrir último dia já exibido
  const seps   = corpo.querySelectorAll('.ci-sep-dia');
  const diasSet = new Set();
  seps.forEach(s => {
    // Reverter label → data não é viável, então apenas marcamos o dia de hoje/ontem
    // A lógica de _ciCriarFrag já cuida de não duplicar por Set
  });
  // Para msgs em tempo real: checar se o separador do dia já existe
  const dia = (msg.criado_em || new Date().toISOString()).slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);
  // Se último separador for "Hoje" e a msg for de hoje, não adicionar de novo
  const ultimoSep = seps[seps.length - 1];
  if (ultimoSep?.querySelector('span')?.textContent === 'Hoje' && dia === hoje) {
    diasSet.add(dia);
  }

  corpo.appendChild(_ciCriarFrag(msg, diasSet));
  if (scroll) corpo.scrollTop = corpo.scrollHeight;
}

// ── Enviar ────────────────────────────────────────────────────
async function ciEnviar() {
  const input = document.getElementById('ciInput');
  const texto = input?.value.trim();
  if (!texto || !_ciEscId) return;

  const backup  = texto;
  input.value   = '';
  input.style.height = 'auto';

  const agora   = new Date().toISOString();
  const nome    = _ciNome(currentUser.id);
  const avatar  = _ciPerfis[currentUser.id]?.avatar_url || '';
  const tempId  = `bc_${currentUser.id}_${Date.now()}`;

  const payload = {
    id:            tempId,
    escritorio_id: _ciEscId,
    user_id:       currentUser.id,
    conteudo:      texto,
    nome_sender:   nome,
    avatar_sender: avatar,
    criado_em:     agora,
  };

  // Renderizar localmente de imediato
  _ciIds.add(tempId);
  _ciRenderMsg(payload, true);

  // Broadcast para outros (instantâneo)
  _ciBc.send({ type: 'broadcast', event: 'msg', payload });

  // Persistir no banco (não bloqueia UI)
  const { error } = await sb.from('chat_interno_mensagens').insert({
    escritorio_id: _ciEscId,
    user_id:       currentUser.id,
    conteudo:      texto,
    nome_sender:   nome,
    avatar_sender: avatar,
  });
  if (error) { showToast('Erro ao salvar mensagem.', 'error'); input.value = backup; }
}

function ciKeyDown(e) {
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

  const label = document.getElementById('ciOnlineLabel');
  if (label) label.textContent = outros.length
    ? `${outros.length + 1} online`
    : 'Apenas você online';

  const wrap = document.getElementById('ciOnlineAvatares');
  if (!wrap) return;
  wrap.innerHTML = outros.slice(0, 5).map(p => {
    const uid  = p.user_id;
    const nome = p.nome || _ciNome(uid);
    const src  = p.avatar || _ciPerfis[uid]?.avatar_url || '';
    const img  = _ciAvatarHtml(uid, src, nome, 22);
    return `<div style="position:relative;flex-shrink:0" title="${escapeHtml(nome)}">${img}<span style="position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#16a34a;border-radius:50%;border:1.5px solid var(--card)"></span></div>`;
  }).join('');
}

// ── Toast ─────────────────────────────────────────────────────
function _ciToastMsg(msg) {
  const nome    = msg.nome_sender || _ciNome(msg.user_id);
  const preview = (msg.conteudo || '').slice(0, 60) + ((msg.conteudo || '').length > 60 ? '…' : '');
  showToast(`💬 ${nome}: ${preview}`, 'info', 4500);
}
