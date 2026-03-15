// ============================================================
// MESSENGER.JS v3
// ============================================================

let _msnEscId    = null;
let _msnPerfis   = {};
let _msnContatos = [];
let _msnPeer     = null;
let _msnCache    = {};
let _msnNaoLidas = {};
let _msnAberto   = false;
let _msnBc       = null;
let _msnPg       = null;
let _msnPr       = null;
let _msnOnline   = new Set();
let _msnDigTimer = null;
let _msnDigMap   = {};
let _msnFp       = new Set();

// ── Áudio ─────────────────────────────────────────────────────
let _msnAudio = null;
document.addEventListener('click', () => {
  if (_msnAudio) return;
  try { _msnAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}, { once: true });

function _msnBeep() {
  try {
    if (!_msnAudio) return;
    const o = _msnAudio.createOscillator(), g = _msnAudio.createGain();
    o.connect(g); g.connect(_msnAudio.destination);
    o.frequency.setValueAtTime(880, _msnAudio.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, _msnAudio.currentTime + 0.15);
    g.gain.setValueAtTime(0.1, _msnAudio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _msnAudio.currentTime + 0.2);
    o.start(); o.stop(_msnAudio.currentTime + 0.2);
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────
async function msnInit() {
  if (!currentUser) return;
  const temPerm = isAdmin() || (currentUser?.user_metadata?.permissions || []).includes('chat_interno');
  if (!temPerm) return;

  try {
    _msnEscId = await getEscritorioIdAtual();
    if (!_msnEscId) return;
  } catch { return; }

  await _msnCarregarContatos();
  await _msnContarNaoLidas();
  _msnRenderBadge();
  _msnSubscribe();
  const btn = document.getElementById('msnBtnHeader');
  if (btn) btn.style.display = 'flex';
}

function msnReset() {
  if (_msnDigTimer) clearTimeout(_msnDigTimer);
  Object.values(_msnDigMap).forEach(clearTimeout);
  [_msnBc, _msnPg, _msnPr].forEach(ch => { try { if (ch) sb.removeChannel(ch); } catch {} });
  _msnBc = _msnPg = _msnPr = null;
  _msnEscId = null; _msnPeer = null;
  _msnCache = {}; _msnNaoLidas = {}; _msnOnline = new Set();
  _msnPerfis = {}; _msnContatos = [];
  _msnDigTimer = null; _msnDigMap = {}; _msnFp = new Set(); _msnAberto = false;
  const btn = document.getElementById('msnBtnHeader');
  if (btn) btn.style.display = 'none';
  document.getElementById('msnPanel')?.remove();
}

// ── Carregar contatos ─────────────────────────────────────────
// Estratégia: escritorio_usuarios + perfis_usuarios (sem proxy admin)
// Funciona para TODOS os papéis (admin, contador)
async function _msnCarregarContatos() {
  try {
    // 1. Buscar IDs dos membros do escritório
    const { data: vinculos, error: ve } = await sb
      .from('escritorio_usuarios')
      .select('user_id')
      .eq('escritorio_id', _msnEscId);

    if (ve) throw new Error('escritorio_usuarios: ' + ve.message);

    const ids = (vinculos || [])
      .map(v => v.user_id)
      .filter(id => id !== currentUser.id);

    if (!ids.length) return;

    // 2. Buscar perfis (nome + avatar)
    const { data: perfis } = await sb
      .from('perfis_usuarios')
      .select('user_id, nome, avatar_url')
      .in('user_id', ids);

    // 3. Montar contatos — fallback para primeiros chars do UUID se sem perfil
    _msnContatos = ids.map(id => {
      const p = (perfis || []).find(x => x.user_id === id);
      const nome = p?.nome?.trim() || ('user_' + id.slice(0, 6));
      _msnPerfis[id] = { nome, avatar_url: p?.avatar_url || '' };
      return { id, nome };
    });

    // 4. Perfil próprio — usa perfilCache se disponível
    const meuNome = perfilCache?.nome?.trim()
      || currentUser.user_metadata?.full_name
      || currentUser.user_metadata?.nome
      || currentUser.email?.split('@')[0]
      || 'Eu';
    const meuAvatar = perfilCache?.avatar_url
      || currentUser.user_metadata?.avatar_url
      || currentUser.user_metadata?.picture
      || '';
    _msnPerfis[currentUser.id] = { nome: meuNome, avatar_url: meuAvatar };

  } catch (e) {
    console.error('[msn] _msnCarregarContatos:', e.message);
  }
}

// ── Realtime ──────────────────────────────────────────────────
function _msnSubscribe() {
  _msnBc = sb.channel(`msn_bc_${_msnEscId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msn_msg'    }, ({ payload }) => _msnOnMsg(payload))
    .on('broadcast', { event: 'msn_typing' }, ({ payload }) => _msnOnTyping(payload))
    .on('broadcast', { event: 'msn_read'   }, ({ payload }) => _msnOnRead(payload))
    .on('broadcast', { event: 'msn_del'    }, ({ payload }) => _msnOnDel(payload))
    .subscribe();

  _msnPg = sb.channel(`msn_pg_${_msnEscId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messenger_mensagens',
      filter: `receiver_id=eq.${currentUser.id}`,
    }, ({ new: row }) => {
      if (!_msnFp.has(row.id)) _msnOnMsg(row);
    })
    .subscribe();

  _msnPr = sb.channel(`msn_pr_${_msnEscId}`, { config: { presence: { key: currentUser.id } } })
    .on('presence', { event: 'sync'  }, _msnSyncPresence)
    .on('presence', { event: 'join'  }, _msnSyncPresence)
    .on('presence', { event: 'leave' }, _msnSyncPresence)
    .subscribe(async s => {
      if (s !== 'SUBSCRIBED') return;
      await _msnPr.track({
        user_id:    currentUser.id,
        nome:       _msnPerfis[currentUser.id]?.nome,
        avatar_url: _msnPerfis[currentUser.id]?.avatar_url,
      });
    });
}

function _msnSyncPresence() {
  if (!_msnPr) return;
  const estado = Object.values(_msnPr.presenceState()).flat();
  _msnOnline = new Set(estado.map(p => p.user_id).filter(id => id !== currentUser.id));
  // Atualizar dots sem re-renderizar tudo
  _msnContatos.forEach(({ id }) => {
    const dot = document.querySelector(`[data-msn-dot="${id}"]`);
    if (dot) dot.style.background = _msnOnline.has(id) ? '#16a34a' : '#94a3b8';
  });
  if (_msnPeer) {
    const hdot = document.getElementById('msnHdDot');
    const hsub = document.getElementById('msnHdSub');
    const on   = _msnOnline.has(_msnPeer);
    if (hdot) hdot.style.background = on ? '#16a34a' : '#94a3b8';
    if (hsub) { hsub.textContent = on ? 'Online' : 'Offline'; hsub.style.color = on ? '#16a34a' : 'var(--text-light)'; }
  }
}

// ── Não lidas ─────────────────────────────────────────────────
async function _msnContarNaoLidas() {
  try {
    const { data } = await sb.from('messenger_mensagens')
      .select('sender_id').eq('receiver_id', currentUser.id).eq('lida', false).eq('deletada', false);
    _msnNaoLidas = {};
    (data || []).forEach(m => { _msnNaoLidas[m.sender_id] = (_msnNaoLidas[m.sender_id] || 0) + 1; });
  } catch {}
}

function _msnTotalNaoLidas() {
  return Object.values(_msnNaoLidas).reduce((s, n) => s + n, 0);
}

function _msnRenderBadge() {
  const total = _msnTotalNaoLidas();
  const b = document.getElementById('msnBadge');
  if (!b) return;
  b.textContent   = total > 9 ? '9+' : String(total);
  b.style.display = total > 0 ? 'flex' : 'none';
}

// ── Abrir / Fechar ────────────────────────────────────────────
function abrirMessenger() {
  if (_msnAberto) { fecharMessenger(); return; }
  _msnAberto = true;
  _msnMontarPainel();
}

function fecharMessenger() {
  _msnAberto = false; _msnPeer = null;
  document.getElementById('msnPanel')?.remove();
}

// ── Painel ────────────────────────────────────────────────────
function _msnMontarPainel() {
  document.getElementById('msnPanel')?.remove();
  const p = document.createElement('div');
  p.id = 'msnPanel';
  p.style.cssText = 'position:fixed;bottom:72px;right:16px;width:360px;height:540px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.28);z-index:8400;display:flex;flex-direction:column;overflow:hidden;animation:msnIn .18s ease';

  p.innerHTML = `
    <style>
      @keyframes msnIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      .mcitem{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-radius:10px;margin:2px 6px;transition:.12s}
      .mcitem:hover{background:var(--sidebar-hover)}
      .msbub{max-width:76%;padding:8px 12px;border-radius:18px;font-size:13px;line-height:1.45;word-break:break-word}
      .msbub-out{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
      .msbub-in{background:var(--sidebar-hover);color:var(--text);border-bottom-left-radius:4px}
      .mstime{font-size:10px;color:var(--text-light);margin-top:2px}
      .msread{font-size:10px;color:var(--text-light);margin-top:1px}
      .msimg{max-width:200px;max-height:150px;border-radius:12px;cursor:pointer;object-fit:cover;display:block;margin-top:4px}
      .msdel{font-style:italic;opacity:.5;font-size:12px;padding:4px 0}
      .mssep{text-align:center;font-size:10px;color:var(--text-light);margin:8px auto;padding:3px 12px;background:var(--sidebar-hover);border-radius:20px;display:table}
      .msgrow{display:flex;flex-direction:column;margin:3px 0;position:relative}
      .msgrow:hover .msactions{opacity:1;pointer-events:auto}
      .msactions{opacity:0;pointer-events:none;position:absolute;top:-30px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:3px 6px;display:flex;gap:2px;box-shadow:0 2px 10px rgba(0,0,0,.15);z-index:20;white-space:nowrap;transition:opacity .1s}
      .msactions-out{right:0}.msactions-in{left:0}
      .msabtn{background:none;border:none;cursor:pointer;padding:3px 7px;border-radius:6px;font-size:11px;color:var(--text);display:flex;align-items:center;gap:4px}
      .msabtn:hover{background:var(--sidebar-hover)}
      .msabtn.del{color:#dc2626}.msabtn.del:hover{background:#fef2f2}
      .tdot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text-light);animation:tdb .9s infinite}
      .tdot:nth-child(2){animation-delay:.15s}.tdot:nth-child(3){animation-delay:.3s}
      @keyframes tdb{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
    </style>
    <div id="msnHd" style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);gap:8px;flex-shrink:0">
      <div id="msnHdInfo" style="flex:1;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px;font-weight:700">Messenger</span>
      </div>
      <input id="msnSrch" type="text" placeholder="Buscar..." oninput="_msnFiltrar(this.value)"
        style="display:none;padding:5px 10px;border:1px solid var(--border);border-radius:20px;background:var(--bg);color:var(--text);font-size:12px;width:130px;outline:none">
      <button onclick="_msnToggleSrch()" style="background:none;border:none;cursor:pointer;padding:5px;color:var(--text-light);display:flex;align-items:center;border-radius:7px" title="Buscar">
        <i data-lucide="search" style="width:15px;height:15px"></i>
      </button>
      <button onclick="fecharMessenger()" style="background:none;border:none;cursor:pointer;padding:5px;color:var(--text-light);display:flex;align-items:center;border-radius:7px" title="Fechar">
        <i data-lucide="x" style="width:15px;height:15px"></i>
      </button>
    </div>
    <div id="msnBody" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0"></div>`;

  document.body.appendChild(p);
  if (window.lucide) lucide.createIcons();
  _msnRenderLista();
}

// ── Lista de contatos ─────────────────────────────────────────
function _msnRenderLista(filtro) {
  if (_msnPeer) return;
  const body = document.getElementById('msnBody');
  if (!body) return;
  const fl = (filtro || '').toLowerCase();
  const lista = _msnContatos.filter(c => !fl || c.nome.toLowerCase().includes(fl));

  if (!lista.length) {
    body.innerHTML = `<div style="display:flex;flex:1;align-items:center;justify-content:center">
      <p style="color:var(--text-light);font-size:13px;text-align:center;padding:24px">
        ${_msnContatos.length ? 'Nenhum resultado' : 'Nenhum colega encontrado.<br><small>Verifique se o SQL de setup foi executado.</small>'}
      </p></div>`;
    return;
  }

  body.innerHTML = `<div style="overflow-y:auto;flex:1;padding:8px 4px">
    ${lista.map(c => {
      const p  = _msnPerfis[c.id] || {};
      const on = _msnOnline.has(c.id);
      const nl = _msnNaoLidas[c.id] || 0;
      return `<div class="mcitem" onclick="msnAbrirConversa('${c.id}')">
        <div style="position:relative;flex-shrink:0">
          ${_msnAvatar(c.id, 40)}
          <span data-msn-dot="${c.id}" style="width:10px;height:10px;border-radius:50%;border:2px solid var(--card);position:absolute;bottom:1px;right:1px;background:${on ? '#16a34a' : '#94a3b8'}"></span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:${nl ? 700 : 500};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.nome || c.id.slice(0,8))}</div>
          <div style="font-size:11px;color:${on ? '#16a34a' : 'var(--text-light)'}">${on ? 'Online agora' : 'Offline'}</div>
        </div>
        ${nl ? `<span style="background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0">${nl > 9 ? '9+' : nl}</span>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

// ── Abrir conversa ────────────────────────────────────────────
async function msnAbrirConversa(peerId) {
  _msnPeer = peerId;
  _msnNaoLidas[peerId] = 0;
  _msnRenderBadge();

  // Header com info do peer
  const hdInfo = document.getElementById('msnHdInfo');
  if (hdInfo) {
    const p  = _msnPerfis[peerId] || {};
    const on = _msnOnline.has(peerId);
    hdInfo.innerHTML = `
      <button onclick="msnVoltarLista()" style="background:none;border:none;cursor:pointer;padding:4px 6px;color:var(--text-light);display:flex;align-items:center;border-radius:7px;flex-shrink:0">
        <i data-lucide="arrow-left" style="width:16px;height:16px"></i>
      </button>
      <div style="position:relative;flex-shrink:0">
        ${_msnAvatar(peerId, 32)}
        <span id="msnHdDot" style="width:9px;height:9px;border-radius:50%;border:2px solid var(--card);position:absolute;bottom:0;right:0;background:${on ? '#16a34a' : '#94a3b8'}"></span>
      </div>
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.nome || peerId.slice(0,8))}</div>
        <div id="msnHdSub" style="font-size:10px;color:${on ? '#16a34a' : 'var(--text-light)'}">${on ? 'Online agora' : 'Offline'}</div>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  // Body da conversa
  const body = document.getElementById('msnBody');
  if (!body) return;
  body.innerHTML = `
    <div id="msnMsgs" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-height:0"></div>
    <div id="msnTypBar" style="min-height:18px;padding:0 14px 2px;font-size:11px;color:var(--text-light);display:flex;align-items:center;gap:5px;flex-shrink:0"></div>
    <div style="padding:8px 10px;border-top:1px solid var(--border);display:flex;gap:6px;align-items:flex-end;flex-shrink:0">
      <button onclick="msnPickImg()" style="background:none;border:none;cursor:pointer;padding:6px;color:var(--text-light);flex-shrink:0;display:flex;align-items:center;border-radius:8px" title="Imagem">
        <i data-lucide="image" style="width:17px;height:17px"></i>
      </button>
      <textarea id="msnInput" rows="1" placeholder="Mensagem..."
        oninput="msnOnInput(this)" onkeydown="msnOnKey(event)"
        style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:20px;background:var(--bg);color:var(--text);font-size:13px;resize:none;outline:none;max-height:90px;font-family:inherit;line-height:1.4;min-height:36px"></textarea>
      <button onclick="msnEnviar()" style="background:var(--accent);color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s" title="Enviar">
        <i data-lucide="send" style="width:14px;height:14px"></i>
      </button>
    </div>
    <input type="file" id="msnImgFile" accept="image/*" style="display:none" onchange="msnEnviarImagem(event)">`;

  if (window.lucide) lucide.createIcons();

  // Marcar como lidas
  sb.from('messenger_mensagens')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('receiver_id', currentUser.id).eq('sender_id', peerId).eq('lida', false)
    .then(() => {
      _msnBc?.send({ type: 'broadcast', event: 'msn_read',
        payload: { reader_id: currentUser.id, sender_id: peerId } });
    });

  // Carregar histórico
  await _msnCarregarHistorico(peerId);
  _msnRenderMsgs(peerId);
  setTimeout(() => document.getElementById('msnInput')?.focus(), 80);
}

// ── Histórico ─────────────────────────────────────────────────
async function _msnCarregarHistorico(peerId) {
  try {
    const [{ data: env, error: e1 }, { data: rec, error: e2 }] = await Promise.all([
      sb.from('messenger_mensagens').select('*')
        .eq('escritorio_id', _msnEscId)
        .eq('sender_id',   currentUser.id).eq('receiver_id', peerId)
        .order('criado_em', { ascending: true }).limit(80),
      sb.from('messenger_mensagens').select('*')
        .eq('escritorio_id', _msnEscId)
        .eq('sender_id',   peerId).eq('receiver_id', currentUser.id)
        .order('criado_em', { ascending: true }).limit(80),
    ]);
    if (e1) console.error('[msn] hist env:', e1.message);
    if (e2) console.error('[msn] hist rec:', e2.message);
    const todas = [...(env || []), ...(rec || [])];
    todas.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
    _msnCache[peerId] = todas.slice(-80);
  } catch (e) {
    console.error('[msn] histórico:', e.message);
    _msnCache[peerId] = [];
  }
}

// ── Render mensagens ──────────────────────────────────────────
function _msnRenderMsgs(peerId) {
  const el = document.getElementById('msnMsgs');
  if (!el) return;
  const msgs = _msnCache[peerId || _msnPeer] || [];

  if (!msgs.length) {
    el.innerHTML = `<div style="margin:auto;text-align:center;color:var(--text-light);font-size:12px;padding:20px">Nenhuma mensagem. Diga olá! 👋</div>`;
    return;
  }

  let diaAnt = '';
  el.innerHTML = '';
  msgs.forEach((m, i) => {
    const dia = new Date(m.criado_em).toLocaleDateString('pt-BR');
    if (dia !== diaAnt) {
      const sep = document.createElement('span');
      sep.className = 'mssep'; sep.textContent = dia;
      el.appendChild(sep);
      diaAnt = dia;
    }
    el.appendChild(_msnMontarMsgEl(m, i === msgs.length - 1));
  });
  el.scrollTop = el.scrollHeight;
}

function _msnMontarMsgEl(m, ehUlt) {
  const proprio = m.sender_id === currentUser.id;
  const hora    = new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const row = document.createElement('div');
  row.className = 'msgrow';
  row.setAttribute('data-msg-id', m.id);
  row.style.alignItems = proprio ? 'flex-end' : 'flex-start';

  if (m.deletada) {
    row.innerHTML = `<span class="msdel">🚫 Mensagem apagada</span>`;
    return row;
  }

  // Ações hover
  const actions = `<div class="msactions ${proprio ? 'msactions-out' : 'msactions-in'}">
    <button class="msabtn" onclick="_msnReagir('${m.id}','👍')">👍</button>
    <button class="msabtn" onclick="_msnReagir('${m.id}','❤️')">❤️</button>
    <button class="msabtn" onclick="_msnReagir('${m.id}','😂')">😂</button>
    <button class="msabtn" onclick="_msnCopiar('${escapeHtml((m.conteudo||'').replace(/'/g,'\\x27'))}')">
      <i data-lucide="copy" style="width:11px;height:11px"></i> Copiar
    </button>
    ${proprio ? `<button class="msabtn del" onclick="_msnApagar('${m.id}')">
      <i data-lucide="trash-2" style="width:11px;height:11px"></i> Apagar
    </button>` : ''}
  </div>`;

  let corpo = '';
  if (m.tipo === 'imagem' && m.imagem_url) {
    corpo = `<img src="${escapeHtml(m.imagem_url)}" class="msimg" onclick="window.open('${escapeHtml(m.imagem_url)}','_blank')" alt="img">`;
  } else {
    corpo = escapeHtml(m.conteudo || '');
  }

  const leitura = proprio && ehUlt
    ? `<div class="msread" style="text-align:right">${m.lida ? '✓✓' : '✓'}</div>` : '';

  const reacoes = m.reacoes?.length
    ? `<div style="font-size:13px;margin-top:2px">${m.reacoes.join('')}</div>` : '';

  row.innerHTML = `
    ${actions}
    <div class="msbub ${proprio ? 'msbub-out' : 'msbub-in'}">${corpo}</div>
    ${reacoes}
    <div class="mstime">${hora}</div>
    ${leitura}`;

  if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  return row;
}

// ── Append nova msg ───────────────────────────────────────────
function _msnAppend(msg) {
  const el = document.getElementById('msnMsgs');
  if (!el) return;
  const proprio = msg.sender_id === currentUser.id;
  if (proprio) el.querySelectorAll('.msread').forEach(r => r.remove());

  const ehUlt = true;
  // Verificar separador de data
  const hoje  = new Date(msg.criado_em).toLocaleDateString('pt-BR');
  const ultSep = el.querySelector('.mssep:last-of-type');
  if (!ultSep || ultSep.textContent !== hoje) {
    const sep = document.createElement('span');
    sep.className = 'mssep'; sep.textContent = hoje;
    el.appendChild(sep);
  }

  el.appendChild(_msnMontarMsgEl(msg, ehUlt));
  el.scrollTop = el.scrollHeight;
}

// ── Enviar texto ──────────────────────────────────────────────
async function msnEnviar() {
  if (!_msnPeer) return;
  const inp = document.getElementById('msnInput');
  const txt = inp?.value.trim();
  if (!txt) return;
  inp.value = ''; inp.style.height = 'auto';

  const id  = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const msg = {
    id, escritorio_id: _msnEscId,
    sender_id: currentUser.id, receiver_id: _msnPeer,
    conteudo: txt, tipo: 'texto',
    lida: false, deletada: false,
    criado_em: new Date().toISOString(),
  };

  _msnFp.add(id);
  if (!_msnCache[_msnPeer]) _msnCache[_msnPeer] = [];
  _msnCache[_msnPeer].push(msg);
  _msnAppend(msg);

  _msnBc?.send({ type: 'broadcast', event: 'msn_msg', payload: msg });

  const { error } = await sb.from('messenger_mensagens').insert({
    escritorio_id: _msnEscId,
    sender_id: currentUser.id, receiver_id: _msnPeer,
    conteudo: txt, tipo: 'texto',
  });
  if (error) console.error('[msn] insert:', error.message);
}

// ── Enviar imagem ─────────────────────────────────────────────
function msnPickImg() { document.getElementById('msnImgFile')?.click(); }

async function msnEnviarImagem(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !_msnPeer) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Máx 5MB por imagem', 'warn'); return; }
  showToast('Enviando imagem...', 'info', 1500);
  try {
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `${currentUser.id}/${Date.now()}.${ext}`;
    const { error: eu } = await sb.storage.from('messenger-images').upload(path, file);
    if (eu) throw new Error(eu.message);
    const { data: { publicUrl } } = sb.storage.from('messenger-images').getPublicUrl(path);

    const id  = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    const msg = {
      id, escritorio_id: _msnEscId,
      sender_id: currentUser.id, receiver_id: _msnPeer,
      conteudo: null, tipo: 'imagem', imagem_url: publicUrl,
      lida: false, deletada: false, criado_em: new Date().toISOString(),
    };
    _msnFp.add(id);
    if (!_msnCache[_msnPeer]) _msnCache[_msnPeer] = [];
    _msnCache[_msnPeer].push(msg);
    _msnAppend(msg);
    _msnBc?.send({ type: 'broadcast', event: 'msn_msg', payload: msg });
    await sb.from('messenger_mensagens').insert({
      escritorio_id: _msnEscId,
      sender_id: currentUser.id, receiver_id: _msnPeer,
      tipo: 'imagem', imagem_url: publicUrl,
    });
  } catch (err) { showToast('Erro ao enviar imagem: ' + err.message, 'error'); }
}

// ── Apagar mensagem ───────────────────────────────────────────
async function _msnApagar(msgId) {
  if (!await showConfirm('Apagar esta mensagem para todos?')) return;
  const peer = _msnPeer;

  const { error } = await sb.from('messenger_mensagens')
    .update({ deletada: true, conteudo: null, imagem_url: null })
    .eq('id', msgId).eq('sender_id', currentUser.id);

  if (error) { showToast('Erro ao apagar: ' + error.message, 'error'); return; }

  // Atualizar cache e DOM
  const arr = _msnCache[peer] || [];
  const m = arr.find(x => x.id === msgId);
  if (m) m.deletada = true;
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) { el.innerHTML = `<span class="msdel">🚫 Mensagem apagada</span>`; el.style.alignItems = 'flex-end'; }

  _msnBc?.send({ type: 'broadcast', event: 'msn_del',
    payload: { id: msgId, peer_id: peer } });
}

// ── Copiar ────────────────────────────────────────────────────
function _msnCopiar(txt) {
  navigator.clipboard?.writeText(txt)
    .then(() => showToast('Copiado!', 'success', 1500))
    .catch(() => showToast('Não foi possível copiar', 'warn'));
}

// ── Reação rápida ─────────────────────────────────────────────
function _msnReagir(msgId, emoji) {
  // Visual imediato
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    let r = el.querySelector('.msn-react');
    if (!r) { r = document.createElement('div'); r.className = 'msn-react'; r.style.cssText = 'font-size:14px;margin-top:2px'; el.appendChild(r); }
    if (!r.textContent.includes(emoji)) r.textContent += emoji;
  }
}

// ── Digitando ─────────────────────────────────────────────────
function msnOnInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 90) + 'px';
  if (_msnDigTimer) clearTimeout(_msnDigTimer);
  _msnBc?.send({ type: 'broadcast', event: 'msn_typing',
    payload: { user_id: currentUser.id, peer_id: _msnPeer, on: true } });
  _msnDigTimer = setTimeout(() => {
    _msnBc?.send({ type: 'broadcast', event: 'msn_typing',
      payload: { user_id: currentUser.id, peer_id: _msnPeer, on: false } });
  }, 2000);
}

function msnOnKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); msnEnviar(); }
}

// ── Receber eventos Realtime ──────────────────────────────────
function _msnOnMsg(msg) {
  if (!msg?.id || !msg.sender_id) return;
  if (_msnFp.has(msg.id)) return;
  _msnFp.add(msg.id);

  // Peer = quem não sou eu
  const peer = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id;
  if (!_msnCache[peer]) _msnCache[peer] = [];
  _msnCache[peer].push(msg);

  if (_msnPeer === peer) {
    _msnAppend(msg);
    if (msg.sender_id !== currentUser.id) {
      sb.from('messenger_mensagens')
        .update({ lida: true, lida_em: new Date().toISOString() })
        .eq('id', msg.id)
        .then(() => _msnBc?.send({ type: 'broadcast', event: 'msn_read',
          payload: { reader_id: currentUser.id, sender_id: peer } }));
    }
  } else if (msg.sender_id !== currentUser.id) {
    _msnNaoLidas[peer] = (_msnNaoLidas[peer] || 0) + 1;
    _msnRenderBadge();
    if (!_msnPeer) _msnRenderLista();
    _msnBeep();
    showToast(`💬 ${_msnPerfis[peer]?.nome || 'Nova mensagem'}: ${(msg.conteudo || '📷').substring(0, 50)}`, 'info', 4500);
  }
}

function _msnOnTyping({ user_id, peer_id, on }) {
  if (user_id === currentUser.id || _msnPeer !== user_id || peer_id !== currentUser.id) return;
  const bar = document.getElementById('msnTypBar');
  if (!bar) return;
  if (on) {
    const nome = (_msnPerfis[user_id]?.nome || '').split(' ')[0];
    bar.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span><span style="margin-left:4px">${escapeHtml(nome)} está digitando...</span>`;
    clearTimeout(_msnDigMap[user_id]);
    _msnDigMap[user_id] = setTimeout(() => { bar.innerHTML = ''; }, 3500);
  } else {
    bar.innerHTML = '';
    clearTimeout(_msnDigMap[user_id]);
  }
}

function _msnOnRead({ reader_id, sender_id }) {
  if (sender_id !== currentUser.id || _msnPeer !== reader_id) return;
  document.querySelectorAll('#msnMsgs .msread').forEach(el => { el.textContent = '✓✓'; });
  (_msnCache[reader_id] || []).forEach(m => { if (m.sender_id === currentUser.id) m.lida = true; });
}

function _msnOnDel({ id, peer_id }) {
  const peer = peer_id || _msnPeer;
  if (!peer) return;
  const m = (_msnCache[peer] || []).find(x => x.id === id);
  if (m) { m.deletada = true; m.conteudo = null; }
  if (_msnPeer === peer) {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (el) { el.innerHTML = `<span class="msdel">🚫 Mensagem apagada</span>`; el.style.alignItems = 'flex-start'; }
  }
}

// ── Voltar à lista ────────────────────────────────────────────
function msnVoltarLista() {
  _msnPeer = null;
  const hdInfo = document.getElementById('msnHdInfo');
  if (hdInfo) hdInfo.innerHTML = `<span style="font-size:14px;font-weight:700">Messenger</span>`;
  const body = document.getElementById('msnBody');
  if (body) body.innerHTML = '';
  _msnRenderLista();
}

// ── Busca ─────────────────────────────────────────────────────
function _msnToggleSrch() {
  const inp = document.getElementById('msnSrch');
  if (!inp) return;
  const vis = inp.style.display !== 'none';
  inp.style.display = vis ? 'none' : 'block';
  if (!vis) inp.focus(); else { inp.value = ''; _msnFiltrar(''); }
}

function _msnFiltrar(q) {
  if (_msnPeer) {
    document.querySelectorAll('#msnMsgs .msgrow').forEach(div => {
      div.style.display = q && !div.textContent.toLowerCase().includes(q.toLowerCase()) ? 'none' : '';
    });
  } else {
    _msnRenderLista(q);
  }
}

// ── Avatar ────────────────────────────────────────────────────
function _msnAvatar(uid, size) {
  const p = _msnPerfis[uid] || {};
  const s = size || 36;
  if (p.avatar_url) return `<img src="${escapeHtml(p.avatar_url)}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`;
  const cor = _msnCor(uid);
  const ini = (p.nome || '?')[0].toUpperCase();
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;font-size:${Math.round(s*0.38)}px;font-weight:700;color:#fff;flex-shrink:0">${ini}</div>`;
}

function _msnCor(uid) {
  const cores = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#db2777'];
  let h = 0;
  for (let i = 0; i < (uid||'').length; i++) h = (h * 31 + uid.charCodeAt(i)) % cores.length;
  return cores[h];
}
