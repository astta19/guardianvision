// ============================================================
// MESSENGER.JS — Messenger interno estilo Facebook Messenger
// Supabase Realtime Broadcast (entrega) + pg_changes (persistência)
// Features: status online, digitando, leitura ✓✓, imagens, busca
// ============================================================

// ── Estado ───────────────────────────────────────────────────
let _msnEscId      = null;   // escritório atual
let _msnPerfis     = {};     // { userId: { nome, avatar_url } }
let _msnContatos   = [];     // lista de membros do escritório
let _msnPeerAtivo  = null;   // userId da conversa aberta
let _msnMensagens  = {};     // { peerId: [msgs] }
let _msnNaoLidas   = {};     // { peerId: count }
let _msnAberto     = false;
let _msnBcCanal    = null;   // canal broadcast geral do escritório
let _msnPgCanal    = null;   // canal pg_changes para novas msgs
let _msnPrCanal    = null;   // canal presence para status online
let _msnOnline     = new Set();
let _msnDigitando  = {};     // { peerId: timer }
let _msnDigTimer   = null;
let _msnBuscaQ     = '';
let _msnFp         = new Set(); // dedup

// ── Áudio ────────────────────────────────────────────────────
let _msnACtx = null;
document.addEventListener('click', () => {
  if (_msnACtx) return;
  try { _msnACtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}, { once: true });

function _msnSom() {
  if (!_msnACtx) return;
  try {
    const o = _msnACtx.createOscillator();
    const g = _msnACtx.createGain();
    o.connect(g); g.connect(_msnACtx.destination);
    o.frequency.setValueAtTime(880, _msnACtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, _msnACtx.currentTime + 0.15);
    g.gain.setValueAtTime(0.15, _msnACtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _msnACtx.currentTime + 0.2);
    o.start(); o.stop(_msnACtx.currentTime + 0.2);
  } catch {}
}

// ── Init ─────────────────────────────────────────────────────
async function msnInit() {
  if (!currentUser) return;
  if (!isAdmin() && !(currentUser?.user_metadata?.permissions || []).includes('chat_interno')) return;

  // Resolver escritório
  if (isAdmin()) {
    const { data } = await sb.from('escritorios').select('id,nome').eq('owner_id', currentUser.id).limit(1);
    if (data?.[0]) { _msnEscId = data[0].id; }
  } else {
    const { data } = await sb.from('escritorio_usuarios').select('escritorio_id').eq('user_id', currentUser.id).limit(1);
    if (data?.[0]) _msnEscId = data[0].escritorio_id;
  }
  if (!_msnEscId) return;

  await _msnCarregarContatos();
  await _msnContarNaoLidas();
  _msnRenderBadge();
  _msnSubscribe();

  // Mostrar botão no header
  const btn = document.getElementById('msnBtnHeader');
  if (btn) btn.style.display = 'flex';
}

function msnReset() {
  [_msnBcCanal, _msnPgCanal, _msnPrCanal].forEach(c => { try { if (c) sb.removeChannel(c); } catch {} });
  _msnBcCanal = _msnPgCanal = _msnPrCanal = null;
  _msnEscId = null; _msnPeerAtivo = null;
  _msnMensagens = {}; _msnNaoLidas = {}; _msnOnline = new Set();
  _msnDigitando = {}; _msnFp = new Set(); _msnAberto = false;
  document.getElementById('msnBtnHeader')?.style?.setProperty('display', 'none');
  document.getElementById('msnPanel')?.remove();
}

// ── Carregar contatos (membros do escritório) ─────────────────
async function _msnCarregarContatos() {
  try {
    const res = await supabaseProxy('listar_usuarios', {});
    const todos = res?.usuarios || [];
    // Membros do escritório exceto o próprio usuário
    const { data: vinculos } = await sb.from('escritorio_usuarios')
      .select('user_id').eq('escritorio_id', _msnEscId);
    const ids = new Set((vinculos || []).map(v => v.user_id));
    _msnContatos = todos.filter(u => ids.has(u.id) && u.id !== currentUser.id);
    _msnContatos.forEach(u => {
      _msnPerfis[u.id] = { nome: u.email?.split('@')[0] || u.email, avatar_url: u.avatar_url || '' };
    });
    // Adicionar o próprio usuário ao cache de perfis
    _msnPerfis[currentUser.id] = {
      nome: currentUser.user_metadata?.nome || currentUser.email?.split('@')[0] || 'Você',
      avatar_url: currentUser.user_metadata?.avatar_url || '',
    };
  } catch {}
}

// ── Subscribe Realtime ────────────────────────────────────────
function _msnSubscribe() {
  // Broadcast: entrega instantânea de msgs e eventos de digitação
  _msnBcCanal = sb.channel(`msn_bc_${_msnEscId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msn_msg'     }, ({ payload }) => _msnReceberMsg(payload))
    .on('broadcast', { event: 'msn_typing'  }, ({ payload }) => _msnReceberDigitando(payload))
    .on('broadcast', { event: 'msn_read'    }, ({ payload }) => _msnReceberLeitura(payload))
    .subscribe();

  // pg_changes: garantia de entrega mesmo se broadcast falhar
  _msnPgCanal = sb.channel(`msn_pg_${_msnEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messenger_mensagens',
      filter: `receiver_id=eq.${currentUser.id}`,
    }, (payload) => _msnReceberMsgPg(payload.new))
    .subscribe();

  // Presence: status online
  _msnPrCanal = sb.channel(`msn_pr_${_msnEscId}`, {
    config: { presence: { key: currentUser.id } },
  })
    .on('presence', { event: 'sync'  }, () => _msnAtualizarOnline())
    .on('presence', { event: 'join'  }, () => _msnAtualizarOnline())
    .on('presence', { event: 'leave' }, () => _msnAtualizarOnline())
    .subscribe(async s => {
      if (s === 'SUBSCRIBED') {
        await _msnPrCanal.track({
          user_id:    currentUser.id,
          nome:       _msnPerfis[currentUser.id]?.nome,
          avatar_url: _msnPerfis[currentUser.id]?.avatar_url,
        });
      }
    });
}

function _msnAtualizarOnline() {
  if (!_msnPrCanal) return;
  const todos = Object.values(_msnPrCanal.presenceState()).flat();
  _msnOnline = new Set(todos.map(p => p.user_id).filter(id => id !== currentUser.id));
  _msnRenderContatos();
}

// ── Contar não lidas ──────────────────────────────────────────
async function _msnContarNaoLidas() {
  const { data } = await sb.from('messenger_mensagens')
    .select('sender_id')
    .eq('receiver_id', currentUser.id)
    .eq('lida', false);
  _msnNaoLidas = {};
  (data || []).forEach(m => {
    _msnNaoLidas[m.sender_id] = (_msnNaoLidas[m.sender_id] || 0) + 1;
  });
}

function _msnNaoLidasTotal() {
  return Object.values(_msnNaoLidas).reduce((s, n) => s + n, 0);
}

function _msnRenderBadge() {
  const total = _msnNaoLidasTotal();
  const b = document.getElementById('msnBadge');
  if (!b) return;
  b.textContent   = total > 9 ? '9+' : String(total);
  b.style.display = total > 0 ? 'flex' : 'none';
}

// ── Abrir / Fechar painel ─────────────────────────────────────
async function abrirMessenger() {
  if (_msnAberto) { fecharMessenger(); return; }
  _msnAberto = true;
  _msnRenderPainel();
}

function fecharMessenger() {
  _msnAberto = false;
  _msnPeerAtivo = null;
  document.getElementById('msnPanel')?.remove();
}

// ── Render painel principal ───────────────────────────────────
function _msnRenderPainel() {
  document.getElementById('msnPanel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'msnPanel';
  panel.style.cssText = `
    position:fixed; bottom:72px; right:16px;
    width:360px; height:520px;
    background:var(--card); border:1px solid var(--border);
    border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,.25);
    z-index:8400; display:flex; flex-direction:column;
    overflow:hidden; animation:msnSlideUp .2s ease;
  `;

  panel.innerHTML = `
    <style>
      @keyframes msnSlideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
      .msn-contact { display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:.15s;border-radius:10px;margin:2px 6px; }
      .msn-contact:hover { background:var(--sidebar-hover); }
      .msn-contact.active { background:var(--sidebar-hover); }
      .msn-avatar { width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff; }
      .msn-dot { width:10px;height:10px;border-radius:50%;border:2px solid var(--card);position:absolute;bottom:0;right:0; }
      .msn-bubble { max-width:75%;padding:8px 12px;border-radius:18px;font-size:13px;line-height:1.45;word-break:break-word; }
      .msn-bubble-out { background:var(--accent);color:#fff;border-bottom-right-radius:4px; }
      .msn-bubble-in  { background:var(--sidebar-hover);color:var(--text);border-bottom-left-radius:4px; }
      .msn-time { font-size:10px;color:var(--text-light);margin-top:3px; }
      .msn-read { font-size:10px;color:var(--text-light);margin-top:2px; }
      .msn-img { max-width:200px;max-height:160px;border-radius:12px;cursor:pointer;object-fit:cover; }
      .msn-typing-dot { display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--text-light);animation:msnBounce .9s infinite; }
      .msn-typing-dot:nth-child(2) { animation-delay:.15s }
      .msn-typing-dot:nth-child(3) { animation-delay:.3s }
      @keyframes msnBounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
    </style>

    <!-- Header -->
    <div style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);gap:10px">
      <div id="msnHeaderTitle" style="flex:1;font-size:14px;font-weight:700">Messenger</div>
      <div id="msnHeaderAcoes" style="display:flex;gap:6px">
        <input id="msnBusca" type="text" placeholder="Buscar..." oninput="msnFiltrarBusca(this.value)"
          style="display:none;padding:5px 10px;border:1px solid var(--border);border-radius:20px;background:var(--bg);color:var(--text);font-size:12px;width:140px;outline:none">
        <button onclick="msnToggleBusca()" title="Buscar"
          style="background:none;border:none;cursor:pointer;padding:5px;color:var(--text-light);border-radius:8px;display:flex;align-items:center">
          <i data-lucide="search" style="width:15px;height:15px"></i>
        </button>
        <button onclick="fecharMessenger()" title="Fechar"
          style="background:none;border:none;cursor:pointer;padding:5px;color:var(--text-light);border-radius:8px;display:flex;align-items:center">
          <i data-lucide="x" style="width:15px;height:15px"></i>
        </button>
      </div>
    </div>

    <!-- Área principal: contatos OU conversa -->
    <div id="msnCorpo" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>
  `;

  document.body.appendChild(panel);
  if (window.lucide) lucide.createIcons();
  _msnRenderContatos();
}

// ── Lista de contatos ─────────────────────────────────────────
function _msnRenderContatos() {
  if (_msnPeerAtivo) return; // não re-renderizar se conversa aberta
  const corpo = document.getElementById('msnCorpo');
  if (!corpo) return;

  const busca = _msnBuscaQ.toLowerCase();
  const lista = _msnContatos.filter(u =>
    !busca || (_msnPerfis[u.id]?.nome || '').toLowerCase().includes(busca)
  );

  corpo.innerHTML = `
    <div style="padding:8px 6px;overflow-y:auto;flex:1">
      ${!lista.length ? `<p style="text-align:center;color:var(--text-light);font-size:13px;padding:24px">Nenhum contato encontrado</p>` : ''}
      ${lista.map(u => {
        const p     = _msnPerfis[u.id] || {};
        const online = _msnOnline.has(u.id);
        const naoLidas = _msnNaoLidas[u.id] || 0;
        const inicial = (p.nome || '?')[0].toUpperCase();
        const avatarHtml = p.avatar_url
          ? `<img src="${p.avatar_url}" style="width:38px;height:38px;border-radius:50%;object-fit:cover">`
          : `<div class="msn-avatar" style="background:${_msnCor(u.id)}">${inicial}</div>`;
        return `
          <div class="msn-contact ${_msnPeerAtivo === u.id ? 'active' : ''}" onclick="msnAbrirConversa('${u.id}')">
            <div style="position:relative;flex-shrink:0">
              ${avatarHtml}
              <span class="msn-dot" style="background:${online ? '#16a34a' : '#94a3b8'}"></span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:${naoLidas ? '700' : '500'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${escapeHtml(p.nome || u.email)}
              </div>
              <div style="font-size:11px;color:${online ? '#16a34a' : 'var(--text-light)'}">
                ${online ? 'Online' : 'Offline'}
              </div>
            </div>
            ${naoLidas ? `<span style="background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">${naoLidas}</span>` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

// ── Abrir conversa ────────────────────────────────────────────
async function msnAbrirConversa(peerId) {
  _msnPeerAtivo = peerId;
  _msnNaoLidas[peerId] = 0;
  _msnRenderBadge();

  // Marcar mensagens como lidas no banco
  await sb.from('messenger_mensagens')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('receiver_id', currentUser.id)
    .eq('sender_id', peerId)
    .eq('lida', false);

  // Notificar o peer via broadcast
  _msnBcCanal?.send({ type: 'broadcast', event: 'msn_read',
    payload: { reader_id: currentUser.id, sender_id: peerId } });

  // Carregar histórico se não carregado ainda
  if (!_msnMensagens[peerId]) {
    await _msnCarregarHistorico(peerId);
  }

  _msnRenderConversa(peerId);
}

async function _msnCarregarHistorico(peerId) {
  const { data } = await sb.from('messenger_mensagens')
    .select('*')
    .eq('escritorio_id', _msnEscId)
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${currentUser.id})`)
    .order('criado_em', { ascending: true })
    .limit(80);
  _msnMensagens[peerId] = data || [];
}

// ── Render conversa ───────────────────────────────────────────
function _msnRenderConversa(peerId) {
  const corpo = document.getElementById('msnCorpo');
  if (!corpo) return;
  const p     = _msnPerfis[peerId] || {};
  const online = _msnOnline.has(peerId);
  const inicial = (p.nome || '?')[0].toUpperCase();
  const avatarHtml = p.avatar_url
    ? `<img src="${p.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
    : `<div style="width:28px;height:28px;border-radius:50%;background:${_msnCor(peerId)};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${inicial}</div>`;

  // Atualizar header
  const header = document.getElementById('msnHeaderTitle');
  if (header) header.innerHTML = `
    <button onclick="msnVoltarLista()" style="background:none;border:none;cursor:pointer;padding:4px;margin-right:4px;color:var(--text-light);display:inline-flex;align-items:center">
      <i data-lucide="arrow-left" style="width:15px;height:15px"></i>
    </button>
    <div style="display:inline-flex;align-items:center;gap:8px">
      <div style="position:relative">
        ${avatarHtml}
        <span style="width:9px;height:9px;border-radius:50%;background:${online ? '#16a34a' : '#94a3b8'};border:2px solid var(--card);position:absolute;bottom:0;right:0"></span>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700">${escapeHtml(p.nome || '')}</div>
        <div style="font-size:10px;color:${online ? '#16a34a' : 'var(--text-light)'};">${online ? 'Online' : 'Offline'}</div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons();

  corpo.innerHTML = `
    <div id="msnMsgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px"></div>
    <div id="msnDigitandoBar" style="min-height:20px;padding:0 14px 2px;font-size:11px;color:var(--text-light);display:flex;align-items:center;gap:6px"></div>
    <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end">
      <button onclick="msnEscolherImagem()" title="Enviar imagem"
        style="background:none;border:none;cursor:pointer;padding:6px;color:var(--text-light);flex-shrink:0;border-radius:8px;display:flex;align-items:center">
        <i data-lucide="image" style="width:18px;height:18px"></i>
      </button>
      <textarea id="msnInput" rows="1" placeholder="Mensagem..."
        oninput="msnInputEvt(this)" onkeydown="msnKeyDown(event)"
        style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:20px;background:var(--bg);color:var(--text);font-size:13px;resize:none;outline:none;max-height:100px;font-family:inherit;line-height:1.4"></textarea>
      <button onclick="msnEnviar()" id="msnBtnEnviar"
        style="background:var(--accent);color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s">
        <i data-lucide="send" style="width:15px;height:15px"></i>
      </button>
    </div>
    <input type="file" id="msnImgInput" accept="image/*" style="display:none" onchange="msnEnviarImagem(event)">
  `;

  if (window.lucide) lucide.createIcons();
  _msnRenderMensagens(peerId);
  setTimeout(() => document.getElementById('msnInput')?.focus(), 100);
}

function _msnRenderMensagens(peerId) {
  const el = document.getElementById('msnMsgs');
  if (!el) return;
  const msgs = _msnMensagens[peerId] || [];

  if (!msgs.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--text-light);font-size:12px;padding:24px 0;margin:auto">Inicie a conversa!</div>`;
    return;
  }

  // Agrupar por data
  let dataAnterior = '';
  el.innerHTML = msgs.map((m, i) => {
    const proprio  = m.sender_id === currentUser.id;
    const hora     = new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dataMsg  = new Date(m.criado_em).toLocaleDateString('pt-BR');
    const ehUltima = i === msgs.length - 1;

    let separador = '';
    if (dataMsg !== dataAnterior) {
      separador = `<div style="text-align:center;font-size:10px;color:var(--text-light);margin:8px 0;padding:4px 10px;background:var(--sidebar-hover);border-radius:10px;width:fit-content;margin-left:auto;margin-right:auto">${dataMsg}</div>`;
      dataAnterior = dataMsg;
    }

    const leituraHtml = proprio && ehUltima
      ? `<div class="msn-read" style="text-align:right">${m.lida ? '✓✓' : '✓'}</div>`
      : '';

    let conteudoHtml = '';
    if (m.tipo === 'imagem' && m.imagem_url) {
      conteudoHtml = `<img src="${escapeHtml(m.imagem_url)}" class="msn-img" onclick="window.open('${escapeHtml(m.imagem_url)}','_blank')" alt="imagem">`;
    } else {
      conteudoHtml = escapeHtml(m.conteudo || '');
    }

    return `
      ${separador}
      <div style="display:flex;flex-direction:column;align-items:${proprio ? 'flex-end' : 'flex-start'}">
        <div class="msn-bubble ${proprio ? 'msn-bubble-out' : 'msn-bubble-in'}">${conteudoHtml}</div>
        <div class="msn-time">${hora}</div>
        ${leituraHtml}
      </div>`;
  }).join('');

  el.scrollTop = el.scrollHeight;
}

function _msnAppendMsg(msg) {
  const el = document.getElementById('msnMsgs');
  if (!el) return;

  const proprio  = msg.sender_id === currentUser.id;
  const hora     = new Date(msg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Atualizar ✓ → ✓✓ da última mensagem própria anterior
  if (proprio) {
    el.querySelectorAll('.msn-read').forEach(r => r.remove());
  }

  let conteudoHtml = '';
  if (msg.tipo === 'imagem' && msg.imagem_url) {
    conteudoHtml = `<img src="${escapeHtml(msg.imagem_url)}" class="msn-img" onclick="window.open('${escapeHtml(msg.imagem_url)}','_blank')" alt="imagem">`;
  } else {
    conteudoHtml = escapeHtml(msg.conteudo || '');
  }

  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${proprio ? 'flex-end' : 'flex-start'}`;
  div.innerHTML = `
    <div class="msn-bubble ${proprio ? 'msn-bubble-out' : 'msn-bubble-in'}">${conteudoHtml}</div>
    <div class="msn-time">${hora}</div>
    ${proprio ? '<div class="msn-read" style="text-align:right">✓</div>' : ''}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ── Enviar mensagem ───────────────────────────────────────────
async function msnEnviar() {
  if (!_msnPeerAtivo) return;
  const input = document.getElementById('msnInput');
  const texto = input?.value.trim();
  if (!texto) return;
  input.value = '';
  input.style.height = 'auto';

  const msg = {
    id:           crypto.randomUUID?.() || Date.now().toString(36),
    escritorio_id: _msnEscId,
    sender_id:    currentUser.id,
    receiver_id:  _msnPeerAtivo,
    conteudo:     texto,
    tipo:         'texto',
    lida:         false,
    criado_em:    new Date().toISOString(),
  };

  // Render local imediato
  _msnFp.add(msg.id);
  if (!_msnMensagens[_msnPeerAtivo]) _msnMensagens[_msnPeerAtivo] = [];
  _msnMensagens[_msnPeerAtivo].push(msg);
  _msnAppendMsg(msg);

  // Broadcast para entrega instantânea
  _msnBcCanal?.send({ type: 'broadcast', event: 'msn_msg', payload: msg });

  // Persistir no banco
  const { error } = await sb.from('messenger_mensagens').insert({
    escritorio_id: _msnEscId,
    sender_id:     currentUser.id,
    receiver_id:   _msnPeerAtivo,
    conteudo:      texto,
    tipo:          'texto',
  });
  if (error) console.error('msn insert:', error);
}

function msnKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); msnEnviar(); }
}

// ── Indicador de digitação ────────────────────────────────────
function msnInputEvt(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';

  // Broadcast digitando
  if (_msnDigTimer) clearTimeout(_msnDigTimer);
  _msnBcCanal?.send({ type: 'broadcast', event: 'msn_typing',
    payload: { user_id: currentUser.id, peer_id: _msnPeerAtivo, digitando: true } });
  _msnDigTimer = setTimeout(() => {
    _msnBcCanal?.send({ type: 'broadcast', event: 'msn_typing',
      payload: { user_id: currentUser.id, peer_id: _msnPeerAtivo, digitando: false } });
  }, 2000);
}

function _msnReceberDigitando({ user_id, peer_id, digitando }) {
  // Só mostrar se a conversa com esse usuário está aberta
  if (_msnPeerAtivo !== user_id) return;
  if (peer_id !== currentUser.id) return;

  const bar = document.getElementById('msnDigitandoBar');
  if (!bar) return;

  if (digitando) {
    const nome = (_msnPerfis[user_id]?.nome || '').split(' ')[0];
    bar.innerHTML = `<span class="msn-typing-dot"></span><span class="msn-typing-dot"></span><span class="msn-typing-dot"></span><span style="margin-left:4px">${escapeHtml(nome)} está digitando...</span>`;
    if (_msnDigitando[user_id]) clearTimeout(_msnDigitando[user_id]);
    _msnDigitando[user_id] = setTimeout(() => { bar.innerHTML = ''; }, 3000);
  } else {
    bar.innerHTML = '';
    clearTimeout(_msnDigitando[user_id]);
  }
}

// ── Receber mensagem (broadcast) ──────────────────────────────
function _msnReceberMsg(msg) {
  if (!msg?.id || _msnFp.has(msg.id)) return;
  _msnFp.add(msg.id);

  const peer = msg.sender_id;
  if (!_msnMensagens[peer]) _msnMensagens[peer] = [];
  _msnMensagens[peer].push(msg);

  if (_msnPeerAtivo === peer) {
    _msnAppendMsg(msg);
    // Marcar como lida imediatamente
    sb.from('messenger_mensagens').update({ lida: true, lida_em: new Date().toISOString() })
      .eq('receiver_id', currentUser.id).eq('sender_id', peer).eq('lida', false).then(() => {
        _msnBcCanal?.send({ type: 'broadcast', event: 'msn_read',
          payload: { reader_id: currentUser.id, sender_id: peer } });
      });
  } else {
    _msnNaoLidas[peer] = (_msnNaoLidas[peer] || 0) + 1;
    _msnRenderBadge();
    _msnRenderContatos();
    _msnSom();
    showToast(`💬 ${_msnPerfis[peer]?.nome || 'Mensagem'}: ${(msg.conteudo || '📷').substring(0, 60)}`, 'info', 4000);
  }
}

// Receber via pg_changes (garantia de entrega)
function _msnReceberMsgPg(row) {
  if (!row?.id || _msnFp.has(row.id)) return;
  _msnReceberMsg(row);
}

// ── Confirmação de leitura ✓✓ ─────────────────────────────────
function _msnReceberLeitura({ reader_id, sender_id }) {
  // Eu enviei mensagem para reader_id e ele leu
  if (sender_id !== currentUser.id) return;
  if (_msnPeerAtivo !== reader_id) return;

  // Atualizar ✓ → ✓✓ no último balão
  const msgs = document.querySelectorAll('#msnMsgs .msn-read');
  msgs.forEach(el => { el.textContent = '✓✓'; });

  // Atualizar no cache local
  (_msnMensagens[reader_id] || []).forEach(m => {
    if (m.sender_id === currentUser.id) m.lida = true;
  });
}

// ── Upload de imagem ──────────────────────────────────────────
function msnEscolherImagem() {
  document.getElementById('msnImgInput')?.click();
}

async function msnEnviarImagem(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !_msnPeerAtivo) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande. Máx: 5MB', 'warn'); return; }

  showToast('Enviando imagem...', 'info', 2000);

  try {
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `${currentUser.id}/${Date.now()}.${ext}`;
    const { error: errUp } = await sb.storage.from('messenger-images').upload(path, file);
    if (errUp) throw errUp;

    const { data: { publicUrl } } = sb.storage.from('messenger-images').getPublicUrl(path);

    const msg = {
      id:            crypto.randomUUID?.() || Date.now().toString(36),
      escritorio_id: _msnEscId,
      sender_id:     currentUser.id,
      receiver_id:   _msnPeerAtivo,
      conteudo:      null,
      tipo:          'imagem',
      imagem_url:    publicUrl,
      lida:          false,
      criado_em:     new Date().toISOString(),
    };

    _msnFp.add(msg.id);
    if (!_msnMensagens[_msnPeerAtivo]) _msnMensagens[_msnPeerAtivo] = [];
    _msnMensagens[_msnPeerAtivo].push(msg);
    _msnAppendMsg(msg);

    _msnBcCanal?.send({ type: 'broadcast', event: 'msn_msg', payload: msg });

    await sb.from('messenger_mensagens').insert({
      escritorio_id: _msnEscId,
      sender_id:     currentUser.id,
      receiver_id:   _msnPeerAtivo,
      tipo:          'imagem',
      imagem_url:    publicUrl,
    });
  } catch (e) {
    showToast('Erro ao enviar imagem: ' + e.message, 'error');
  }
}

// ── Busca no histórico ────────────────────────────────────────
function msnToggleBusca() {
  const input = document.getElementById('msnBusca');
  if (!input) return;
  const visivel = input.style.display !== 'none';
  input.style.display = visivel ? 'none' : 'block';
  if (!visivel) { input.focus(); } else { input.value = ''; msnFiltrarBusca(''); }
}

function msnFiltrarBusca(q) {
  _msnBuscaQ = q;
  if (_msnPeerAtivo) {
    // Buscar nas mensagens da conversa ativa
    const el = document.getElementById('msnMsgs');
    if (!el) return;
    el.querySelectorAll('[data-msn-msg]').forEach(div => {
      div.style.display = q && !div.textContent.toLowerCase().includes(q.toLowerCase()) ? 'none' : '';
    });
  } else {
    _msnRenderContatos();
  }
}

// ── Voltar para lista ─────────────────────────────────────────
function msnVoltarLista() {
  _msnPeerAtivo = null;
  _msnBuscaQ = '';
  const header = document.getElementById('msnHeaderTitle');
  if (header) header.innerHTML = 'Messenger';
  if (window.lucide) lucide.createIcons();
  _msnRenderContatos();
  document.getElementById('msnCorpo').innerHTML = '';
  _msnRenderContatos();
}

// ── Helpers ───────────────────────────────────────────────────
function _msnCor(uid) {
  const cores = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#db2777'];
  let h = 0;
  for (let i = 0; i < (uid || '').length; i++) h = (h * 31 + uid.charCodeAt(i)) % cores.length;
  return cores[h];
}
