// ============================================================
// MOBILE.JS — UX nativa para mobile
// 1. Bottom navigation bar
// 2. Swipe para abrir/fechar sidebar
// 3. Sincronização de badges
// 4. Utilitários mobile
// ============================================================

// ── 1. BOTTOM NAVIGATION ─────────────────────────────────────

let _bnTabAtiva = 'chat';

function bnSelectTab(tab) {
  _bnTabAtiva = tab;

  // Atualizar estado visual dos botões
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bn' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (btn) btn.classList.add('active');

  // Ações por aba
  switch (tab) {
    case 'chat':
      // Fechar qualquer modal aberto, focar no chat
      if (typeof closeDropdowns === 'function') closeDropdowns();
      document.getElementById('msgInput')?.focus();
      break;

    case 'agenda':
      if (typeof openAgenda === 'function') openAgenda();
      // Voltar foco para chat após fechar agenda
      break;

    case 'ferramentas':
      // Abrir o tools dropdown ou uma sheet de módulos
      _bnAbrirModulosSheet();
      break;

    case 'perfil':
      if (typeof openProfile === 'function') openProfile();
      break;
  }
}

function _bnAbrirModulosSheet() {
  // Em mobile, abrir um sheet com os módulos disponíveis
  // em vez do dropdown do header
  const existing = document.getElementById('bnModulosSheet');
  if (existing) { existing.remove(); return; }

  const modulos = [
    // Linha 1 — mais usados
    { label: 'Agenda',     icon: 'calendar-clock', fn: 'openAgenda',               perm: 'agenda' },
    { label: 'Financeiro', icon: 'wallet',          fn: 'openFinanceiro',           perm: 'financeiro' },
    { label: 'Honorários', icon: 'receipt',         fn: 'openHonorarios',           perm: 'honorarios' },
    { label: 'Folha',      icon: 'users',           fn: 'openFolha',                perm: 'folha' },
    // Linha 2
    { label: 'Documentos', icon: 'file-text',       fn: 'openDocumentos',           perm: 'documentos' },
    { label: 'Portal',     icon: 'external-link',   fn: 'abrirPortalCliente',       perm: 'portal' },
    { label: 'SPED',       icon: 'file-code-2',     fn: 'openSped',                 perm: 'sped' },
    { label: 'Empresa',    icon: 'building-2',      fn: 'openEmpresaPerfil',        perm: 'perfil_empresa' },
    // Linha 3 — contabilidade
    { label: 'Plano',      icon: 'book-open',       fn: 'openPlanoConta',           perm: 'contabilidade' },
    { label: 'Lançamentos',icon: 'pen-line',        fn: 'openLancamentosContabeis', perm: 'contabilidade' },
    { label: 'Balancete',  icon: 'table-2',         fn: 'openBalancete',            perm: 'contabilidade' },
    { label: 'DRE',        icon: 'trending-up',     fn: 'openDRE',                  perm: 'contabilidade' },
    { label: 'Conciliação',icon: 'git-compare',     fn: 'openConciliacao',          perm: 'contabilidade' },
    { label: 'Apuração',   icon: 'calculator',      fn: 'openApuracao',             perm: 'contabilidade' },
    // Ações
    { label: 'Importar',   icon: 'file-up',         fn: 'openImportacao',           perm: null, adminOnly: true },
    { label: 'Calc.',      icon: 'calculator',      fn: 'openCalculator',           perm: 'calculadora' },
    // Admin
    { label: 'Permissões', icon: 'shield',          fn: 'abrirGerenciarPermissoes', perm: null, adminOnly: true },
    { label: 'Escritório', icon: 'users',           fn: 'abrirConvites',            perm: null, adminOnly: true },
    // Master
    { label: 'Stats',      icon: 'bar-chart-2',     fn: 'showStats',                perm: null, masterOnly: true },
    { label: 'Aprendizado',icon: 'brain',           fn: 'showLearningStats',        perm: null, masterOnly: true },
  ];

  const perms = typeof currentUser !== 'undefined'
    ? (currentUser?.user_metadata?.permissions || []) : [];
  const admin  = typeof isAdmin  === 'function' && isAdmin();
  const master = typeof isMaster === 'function' && isMaster();

  const itensVisiveis = modulos.filter(m => {
    if (m.masterOnly && !master) return false;
    if (m.adminOnly  && !admin && !master) return false;
    if (!m.perm) return true;
    return admin || master || perms.includes(m.perm);
  });

  const sheet = document.createElement('div');
  sheet.id = 'bnModulosSheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Módulos do sistema');
  sheet.innerHTML = `
    <div id="bnModulosOverlay" onclick="document.getElementById('bnModulosSheet')?.remove()"></div>
    <div id="bnModulosBox">
      <div class="bn-sheet-handle"></div>
      <div class="bn-sheet-title">Módulos</div>
      <div class="bn-sheet-grid">
        ${itensVisiveis.map(m => `
          <button class="bn-sheet-item" onclick="(function(){
            document.getElementById('bnModulosSheet')?.remove();
            setTimeout(()=>{ if(typeof ${m.fn}==='function') ${m.fn}(); }, 80);
          })()">
            <div class="bn-sheet-icon">
              <i data-lucide="${m.icon}"></i>
            </div>
            <span>${m.label}</span>
          </button>`).join('')}
      </div>
    </div>`;

  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('bn-sheet-open'));
  if (window.lucide) lucide.createIcons({ el: sheet });
}

// ── 2. SWIPE PARA ABRIR/FECHAR SIDEBAR ───────────────────────

function _initSwipeSidebar() {
  // Só em mobile
  if (window.innerWidth > 600) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = false;

  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('overlay');
  if (!sidebar) return;

  // Swipe da esquerda para direita — abre sidebar
  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiping = touchStartX < 24; // zona de 24px da borda esquerda
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!swiping) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx > 60 && dy < 80) {
      // Swipe direita — abrir
      sidebar.classList.add('on');
      overlay?.classList.add('on');
    }
    swiping = false;
  }, { passive: true });

  // Swipe da direita para esquerda na sidebar — fecha
  sidebar.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  sidebar.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx < -60 && dy < 80) {
      // Swipe esquerda — fechar
      sidebar.classList.remove('on');
      overlay?.classList.remove('on');
    }
  }, { passive: true });
}

// ── 3. SINCRONIZAÇÃO DE BADGES ───────────────────────────────

function bnAtualizarBadgeAgenda(count) {
  const badge = document.getElementById('bnAgendaBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function bnAtualizarBadgeTools(count) {
  const badge = document.getElementById('bnToolsBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── 4. RESET ABA ATIVA QUANDO MODAL FECHA ────────────────────

function bnResetTab() {
  // Quando um modal fecha em mobile, voltar foco para chat
  if (window.innerWidth > 600) return;
  setTimeout(() => {
    document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
    document.getElementById('bnChat')?.classList.add('active');
    _bnTabAtiva = 'chat';
  }, 100);
}

// ── 5. UTILITÁRIOS ───────────────────────────────────────────

// Detectar se é mobile
function isMobileDevice() {
  return window.innerWidth <= 600;
}

// Fechar sheet de módulos ao pressionar ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('bnModulosSheet')?.remove();
  }
});

// Fechar sheet ao redimensionar para desktop
window.addEventListener('resize', () => {
  if (window.innerWidth > 600) {
    document.getElementById('bnModulosSheet')?.remove();
  }
}, { passive: true });

// ── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _initSwipeSidebar();
});
