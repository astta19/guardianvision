// ============================================================
// MESSENGER.JS v3 - CORRIGIDO
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
let _msnRenderizando = false; // 🔹 Novo: controle de renderização

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
  _msnRenderizando = false; // 🔹 Reset do controle
  const btn = document.getElementById('msnBtnHeader');
  if (btn) btn.style.display = 'none';
  document.getElementById('msnPanel')?.remove();
}

// ── Carregar contatos ─────────────────────────────────────────
async function _msnCarregarContatos() {
  try {
    const { data: vinculos, error: ve } = await sb
      .from('escritorio_usuarios')
      .select('user_id')
      .eq('escritorio_id', _msnEscId);

    if (ve) throw new Error('escritorio_usuarios: ' + ve.message);

    const ids = (vinculos || [])
      .map(v => v.user_id)
      .filter(id => id !== currentUser.id);

    if (!ids.length) return;

    const { data: perfis } = await sb
      .from('perfis_usuarios')
      .select('user_id, nome, avatar_url')
      .in('user_id', ids);

    _msnContatos = ids.map(id => {
      const p = (perfis || []).find(x => x.user_id === id);
      const nome = p?.nome?.trim() || ('user_' + id.slice(0, 6));
      _msnPerfis[id] = { nome, avatar_url: p?.avatar_url || '' };
      return { id, nome };
    });

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
  
  // 🔹 Otimizado: só atualiza se o painel estiver aberto
  if (_msnAberto && !_msnPeer) {
    _msnRenderLista();
  }
  
  if (_msnPeer) {
    const hdot = document.getElementById('msnHdDot');
    const hsub = document.getElementById('msnHdSub');
    const on   = _msnOnline.has(_msnPeer);
    if (hdot) hdot.style.background = on ? '#16a34a' : '#94a3b8';
    if (hsub) { 
      hsub.textContent = on ? 'Online' : 'Offline'; 
      hsub.style.color = on ? '#16a34a' : 'var(--text-light)'; 
    }
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
  // 🔹 Previne renderização recursiva
  if (_msnRenderizando) return;
  _msnRenderizando = true;
  
  if (_msnPeer) {
    _msnRenderizando = false;
    return;
  }
  
  const body = document.getElementById('msnBody');
  if (!body) {
    _msnRenderizando = false;
    return;
  }
  
  const fl = (filtro || '').toLowerCase();
  const lista = _msnContatos.filter(c => !fl || c.nome.toLowerCase().includes(fl));

  if (!lista.length) {
    body.innerHTML = `<div style="display:flex;flex:1;align-items:center;justify-content:center">
      <p style="color:var(--text-light);font-size:13px;text-align:center;padding:24px">
        ${_msnContatos.length ? 'Nenhum resultado' : 'Nenhum colega encontrado.<br><small>Verifique se o SQL de setup foi executado.</small>'}
      </p></div>`;
    _msnRenderizando = false;
    return;
  }

  // 🔹 Usa DocumentFragment para melhor performance
  const container = document.createElement('div');
  container.style.cssText = 'overflow-y:auto;flex:1;padding:8px 4px';
  
  lista.forEach(c => {
    const p  = _msnPerfis[c.id] || {};
    const on = _msnOnline.has(c.id);
    const nl = _msnNaoLidas[c.id] || 0;
    
    const item = document.createElement('div');
    item.className = 'mcitem';
    item.setAttribute('onclick', `msnAbrirConversa('${c.id}')`);
    
    item.innerHTML = `
      <div style="position:relative;flex-shrink:0">
        ${_msnAvatar(c.id, 40)}
        <span data-msn-dot="${c.id}" style="width:10px;height:10px;border-radius:50%;border:2px solid var(--card);position:absolute;bottom:1px;right:1px;background:${on ? '#16a34a' : '#94a3b8'}"></span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:${nl ? 700 : 500};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.nome || c.id.slice(0,8))}</div>
        <div style="font-size:11px;color:${on ? '#16a34a' : 'var(--text-light)'}">${on ? 'Online agora' : 'Offline'}</div>
      </div>
      ${nl ? `<span style="background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0">${nl > 9 ? '9+' : nl}</span>` : ''}
    `;
    container.appendChild(item);
  });
  
  body.innerHTML = '';
  body.appendChild(container);
  
  // 🔹 Libera o lock após renderizar
  setTimeout(() => { _msnRenderizando = false; }, 50);
}

// 🔹 Versão otimizada do avatar sem loops
function _msnAvatar(uid, size) {
  const p = _msnPerfis[uid] || {};
  const s = size || 36;
  
  if (p.avatar_url) {
    return `<img src="${escapeHtml(p.avatar_url)}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`;
  }
  
  const cores = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2','#db2777'];
  const hash = uid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const cor = cores[hash % cores.length];
  const ini = (p.nome || '?')[0]?.toUpperCase() || '?';
  
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;font-size:${Math.round(s*0.38)}px;font-weight:700;color:#fff;flex-shrink:0">${ini}</div>`;
}

// ... (restante do código permanece igual até o final)
