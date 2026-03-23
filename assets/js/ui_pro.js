// ============================================================
// UI_PRO.JS — Melhorias de UI profissional
// 1. Busca global Ctrl+K (command palette)
// 2. Toast com ação (desfazer)
// 3. Indicador de módulo ativo no header
// 4. Atalhos de teclado documentados
// ============================================================

// ── 1. COMMAND PALETTE (Ctrl+K) ──────────────────────────────

const CMD_ITEMS = [
  // Módulos — visíveis conforme permissão
  { id: 'agenda',       label: 'Agenda Fiscal',          icon: 'calendar-clock', fn: () => openAgenda(),                 perm: 'agenda',        group: 'Módulos' },
  { id: 'financeiro',   label: 'Financeiro',              icon: 'wallet',         fn: () => openFinanceiro(),             perm: 'financeiro',    group: 'Módulos' },
  { id: 'honorarios',   label: 'Honorários',              icon: 'receipt',        fn: () => openHonorarios(),             perm: 'honorarios',    group: 'Módulos' },
  { id: 'folha',        label: 'Folha de Pagamento',      icon: 'users',          fn: () => openFolha(),                  perm: 'folha',         group: 'Módulos' },
  { id: 'sped',         label: 'SPED Fiscal',             icon: 'file-code-2',    fn: () => openSped(),                   perm: 'sped',          group: 'Módulos' },
  { id: 'plano',        label: 'Plano de Contas',         icon: 'book-open',      fn: () => openPlanoConta(),             perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'lanc',         label: 'Lançamentos Contábeis',   icon: 'pen-line',       fn: () => openLancamentosContabeis(),   perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'balancete',    label: 'Balancete',               icon: 'table-2',        fn: () => openBalancete(),              perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'dre',          label: 'DRE',                     icon: 'trending-up',    fn: () => openDRE(),                    perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'conciliacao',  label: 'Conciliação Bancária',    icon: 'git-compare',    fn: () => openConciliacao(),            perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'apuracao',     label: 'Apuração de Impostos',    icon: 'calculator',     fn: () => openApuracao(),               perm: 'contabilidade', group: 'Contabilidade' },
  { id: 'documentos',   label: 'Gerar Documento',         icon: 'file-text',      fn: () => openDocumentos(),             perm: 'documentos',    group: 'Módulos' },
  { id: 'portal',       label: 'Portal do Cliente',       icon: 'external-link',  fn: () => abrirPortalCliente(),         perm: 'portal',        group: 'Módulos' },
  { id: 'perfil_emp',   label: 'Perfil da Empresa',       icon: 'building-2',     fn: () => openEmpresaPerfil(),          perm: 'perfil_empresa',group: 'Configurações' },
  { id: 'calc',         label: 'Calculadora',             icon: 'calculator',     fn: () => openCalculator(),             perm: 'calculadora',   group: 'Módulos' },
  // Ações rápidas — sempre disponíveis
  { id: 'new_chat',     label: 'Nova Conversa',           icon: 'plus',           fn: () => newChat(),                    perm: null,            group: 'Ações' },
  { id: 'empresa',      label: 'Trocar Empresa',          icon: 'building-2',     fn: () => openClientModal(),            perm: null,            group: 'Ações' },
  { id: 'perfil',       label: 'Meu Perfil',              icon: 'user',           fn: () => openProfile(),                perm: null,            group: 'Ações' },
  { id: 'tema',         label: 'Alternar Tema',           icon: 'moon',           fn: () => toggleTheme(),                perm: null,            group: 'Ações' },
  { id: 'fullscreen',   label: 'Tela Cheia',              icon: 'maximize-2',     fn: () => toggleFullscreen(),           perm: null,            group: 'Ações' },
  { id: 'atalhos',      label: 'Ver Atalhos de Teclado',  icon: 'keyboard',       fn: () => cmdMostrarAtalhos(),          perm: null,            group: 'Ações' },
  { id: 'importar',     label: 'Importar Dados em Massa',    icon: 'file-up',        fn: () => typeof openImportacao === 'function' && openImportacao(), perm: null, group: 'Configurações' },
];

let _cmdAberto = false;
let _cmdIdx    = -1;
let _cmdFiltro = '';

function cmdAbrir() {
  if (_cmdAberto) return;
  _cmdAberto = true;
  _cmdIdx = -1;
  _cmdFiltro = '';

  // Criar overlay
  const overlay = document.createElement('div');
  overlay.id = 'cmdOverlay';
  overlay.onclick = e => { if (e.target === overlay) cmdFechar(); };

  overlay.innerHTML = `
    <div id="cmdBox" role="dialog" aria-label="Busca global" aria-modal="true">
      <div id="cmdInputWrap">
        <svg id="cmdSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="cmdInput" type="text" placeholder="Buscar módulo ou ação..." autocomplete="off" spellcheck="false">
        <kbd id="cmdEscHint">ESC</kbd>
      </div>
      <div id="cmdList"></div>
      <div id="cmdFooter">
        <span><kbd>↑↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> abrir</span>
        <span><kbd>Esc</kbd> fechar</span>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('cmd-visible'));

  const input = document.getElementById('cmdInput');
  input.addEventListener('input', () => {
    _cmdFiltro = input.value;
    _cmdIdx = -1;
    cmdRenderLista();
  });
  input.addEventListener('keydown', cmdKeyNav);
  input.focus();

  cmdRenderLista();
}

function cmdFechar() {
  const overlay = document.getElementById('cmdOverlay');
  if (!overlay) return;
  overlay.classList.remove('cmd-visible');
  setTimeout(() => { overlay.remove(); _cmdAberto = false; }, 180);
}

function cmdRenderLista() {
  const lista = document.getElementById('cmdList');
  if (!lista) return;

  const q = _cmdFiltro.toLowerCase().trim();
  const perms = currentUser?.user_metadata?.permissions || [];
  const admin  = typeof isAdmin  === 'function' && isAdmin();
  const master = typeof isMaster === 'function' && isMaster();

  // Filtrar por permissão e query
  const visíveis = CMD_ITEMS.filter(item => {
    // Verificar permissão
    if (item.perm) {
      const temPerm = admin || master || perms.includes(item.perm);
      if (!temPerm) return false;
    }
    // Verificar query
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q);
  });

  if (!visíveis.length) {
    lista.innerHTML = '<div id="cmdEmpty">Nenhum resultado para "<strong>' + _cmdFiltro + '</strong>"</div>';
    return;
  }

  // Agrupar
  const grupos = {};
  visíveis.forEach(item => {
    if (!grupos[item.group]) grupos[item.group] = [];
    grupos[item.group].push(item);
  });

  let html = '';
  let globalIdx = 0;
  for (const [grupo, items] of Object.entries(grupos)) {
    html += `<div class="cmd-group-label">${grupo}</div>`;
    items.forEach(item => {
      const ativo = globalIdx === _cmdIdx ? ' cmd-item-active' : '';
      html += `<button class="cmd-item${ativo}" data-idx="${globalIdx}" onclick="cmdExecutar(${CMD_ITEMS.indexOf(item)})">
        <i data-lucide="${item.icon}" class="cmd-item-icon"></i>
        <span class="cmd-item-label">${_cmdHighlight(item.label, q)}</span>
        <span class="cmd-item-group">${item.group}</span>
      </button>`;
      globalIdx++;
    });
  }

  lista.innerHTML = html;
  if (window.lucide) lucide.createIcons({ el: lista });

  // Re-vincular hover
  lista.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      _cmdIdx = parseInt(el.dataset.idx);
      cmdAtualizarAtivo();
    });
  });
}

function cmdKeyNav(e) {
  const lista = document.getElementById('cmdList');
  const items = lista?.querySelectorAll('.cmd-item') || [];
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cmdIdx = Math.min(_cmdIdx + 1, items.length - 1);
    cmdAtualizarAtivo();
    items[_cmdIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cmdIdx = Math.max(_cmdIdx - 1, 0);
    cmdAtualizarAtivo();
    items[_cmdIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_cmdIdx >= 0 && items[_cmdIdx]) {
      items[_cmdIdx].click();
    } else if (items.length === 1) {
      items[0].click();
    }
  }
}

function cmdAtualizarAtivo() {
  document.querySelectorAll('.cmd-item').forEach((el, i) => {
    el.classList.toggle('cmd-item-active', i === _cmdIdx);
  });
}

function cmdExecutar(itemIdx) {
  const item = CMD_ITEMS[itemIdx];
  if (!item) return;
  cmdFechar();
  setTimeout(() => {
    try { item.fn(); } catch(e) {}
  }, 100);
}

function _cmdHighlight(text, q) {
  if (!q) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

// ── 2. TOAST COM AÇÃO ─────────────────────────────────────────

function showToastComAcao(msg, tipo = 'info', labelAcao, fnAcao, duration = 5000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const cores = { success: '#22c55e', error: '#ef4444', warn: '#f59e0b', info: 'var(--accent)' };
  const toast = document.createElement('div');
  toast.className = 'toast-pro';
  toast.style.setProperty('--toast-color', cores[tipo] || cores.info);

  toast.innerHTML = `
    <div class="toast-pro-content">
      <div class="toast-pro-bar"></div>
      <span class="toast-pro-msg">${msg}</span>
      ${labelAcao ? `<button class="toast-pro-btn" onclick="this.closest('.toast-pro')._fnAcao && this.closest('.toast-pro')._fnAcao()">${labelAcao}</button>` : ''}
      <button class="toast-pro-close" onclick="this.closest('.toast-pro')._dismiss()">✕</button>
    </div>`;

  toast._fnAcao = fnAcao;
  toast._dismiss = () => {
    toast.classList.add('toast-pro-out');
    clearTimeout(toast._timer);
    setTimeout(() => toast.remove(), 250);
  };

  if (fnAcao) {
    const btn = toast.querySelector('.toast-pro-btn');
    btn.addEventListener('click', () => { fnAcao(); toast._dismiss(); });
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-pro-in'));

  toast._timer = setTimeout(() => toast._dismiss(), duration);
  return toast;
}

// ── 3. INDICADOR DE MÓDULO ATIVO ─────────────────────────────

const MODULO_LABELS = {
  folhaModal:        { label: 'Folha de Pagamento',    icon: 'users' },
  honModal:          { label: 'Honorários',             icon: 'receipt' },
  finModal:          { label: 'Financeiro',             icon: 'wallet' },
  agendaModal:       { label: 'Agenda Fiscal',          icon: 'calendar-clock' },
  spedModal:         { label: 'SPED',                   icon: 'file-code-2' },
  pcModal:           { label: 'Plano de Contas',        icon: 'book-open' },
  lcModal:           { label: 'Lançamentos',            icon: 'pen-line' },
  balModal:          { label: 'Balancete',              icon: 'table-2' },
  dreModal:          { label: 'DRE',                    icon: 'trending-up' },
  concModal:         { label: 'Conciliação Bancária',   icon: 'git-compare' },
  apurModal:         { label: 'Apuração de Impostos',   icon: 'calculator' },
  docModal:          { label: 'Documentos',             icon: 'file-text' },
  empresaPerfilModal:{ label: 'Perfil da Empresa',      icon: 'building-2' },
  calcModal:         { label: 'Calculadora',            icon: 'calculator' },
};

function moduloIndicarAtivo(modalId) {
  const info = MODULO_LABELS[modalId];
  const badge = document.getElementById('moduloAtivoBadge');
  if (!badge) return;
  if (!info) { badge.style.display = 'none'; return; }
  badge.style.display = 'flex';
  badge.innerHTML = `<i data-lucide="${info.icon}" style="width:12px;height:12px"></i><span>${info.label}</span>`;
  if (window.lucide) lucide.createIcons({ el: badge });
}

function moduloLimparAtivo() {
  const badge = document.getElementById('moduloAtivoBadge');
  if (badge) badge.style.display = 'none';
}

// Interceptar open/close de todos os modais para atualizar o indicador
function _proxyModulo() {
  const modais = Object.keys(MODULO_LABELS);
  modais.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new MutationObserver(() => {
      const visivel = el.style.display && el.style.display !== 'none';
      if (visivel) moduloIndicarAtivo(id);
      else {
        // Verificar se outro modal está aberto
        const outroAberto = modais.some(mid => {
          const m = document.getElementById(mid);
          return m && m.style.display && m.style.display !== 'none';
        });
        if (!outroAberto) moduloLimparAtivo();
      }
    });
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });
  });
}

// ── 4. ATALHOS DE TECLADO ─────────────────────────────────────

const ATALHOS = [
  { tecla: 'Ctrl + K',   desc: 'Abrir busca global' },
  { tecla: 'Esc',        desc: 'Fechar modal / busca' },
  { tecla: 'Ctrl + N',   desc: 'Nova conversa' },
  { tecla: 'Ctrl + /',   desc: 'Ver atalhos de teclado' },
  { tecla: 'Enter',      desc: 'Enviar mensagem' },
];

function cmdMostrarAtalhos() {
  const modal = document.createElement('div');
  modal.id = 'atalhoModal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div id="atalhoBox" role="dialog" aria-label="Atalhos de teclado">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;color:var(--text)">Atalhos de teclado</div>
        <button onclick="document.getElementById('atalhoModal').remove()"
          style="background:none;border:none;cursor:pointer;color:var(--text-light);padding:4px;border-radius:6px;font-size:16px">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${ATALHOS.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px;color:var(--text-light)">${a.desc}</span>
            <kbd style="background:var(--sidebar-hover);border:1px solid var(--border);border-radius:5px;padding:3px 8px;font-size:12px;color:var(--text);font-family:monospace;white-space:nowrap">${a.tecla}</kbd>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('cmd-visible'));
}

// ── INIT GLOBAL ───────────────────────────────────────────────

function uiProInit() {
  // Atalhos globais de teclado
  document.addEventListener('keydown', e => {
    // Ctrl+K — abrir command palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      _cmdAberto ? cmdFechar() : cmdAbrir();
      return;
    }
    // Ctrl+N — nova conversa
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      if (typeof newChat === 'function') newChat();
      return;
    }
    // Ctrl+/ — ver atalhos
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      cmdMostrarAtalhos();
      return;
    }
    // Esc — fechar command palette se aberto
    if (e.key === 'Escape' && _cmdAberto) {
      cmdFechar();
    }
  });

  // Inicializar observer de módulo ativo
  // Aguarda DOM estar pronto (modais podem ainda não existir)
  setTimeout(_proxyModulo, 1000);
}

document.addEventListener('DOMContentLoaded', uiProInit);
