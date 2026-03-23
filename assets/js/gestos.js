// ============================================================
// GESTOS.JS — UX nativa mobile completa
// 1. Swipe down para fechar qualquer bottom sheet
// 2. Botão voltar Android (popstate)
// 3. Overlay tap fecha modais sem handler
// 4. Pull-to-dismiss com feedback visual
// ============================================================

// ── Mapa de modais → funções close ───────────────────────────
const MODAL_CLOSE_MAP = {
  empresaPerfilModal:  () => typeof closeEmpresaPerfil         === 'function' && closeEmpresaPerfil(),
  spedModal:           () => typeof closeSped                  === 'function' && closeSped(),
  docModal:            () => typeof closeDocumentos            === 'function' && closeDocumentos(),
  profileModal:        () => typeof closeProfile               === 'function' && closeProfile(),
  permissoesModal:     () => typeof fecharPermissoesModal      === 'function' && fecharPermissoesModal(),
  finModal:            () => typeof closeFinanceiro            === 'function' && closeFinanceiro(),
  folhaModal:          () => typeof closeFolha                 === 'function' && closeFolha(),
  convitesModal:       () => typeof fecharConvites             === 'function' && fecharConvites(),
  honModal:            () => typeof closeHonorarios            === 'function' && closeHonorarios(),
  pcModal:             () => typeof closePlanoConta            === 'function' && closePlanoConta(),
  lcModal:             () => typeof closeLancamentosContabeis  === 'function' && closeLancamentosContabeis(),
  balModal:            () => typeof closeBalancete             === 'function' && closeBalancete(),
  dreModal:            () => typeof closeDRE                   === 'function' && closeDRE(),
  concModal:           () => typeof closeConciliacao           === 'function' && closeConciliacao(),
  apurModal:           () => typeof closeApuracao              === 'function' && closeApuracao(),
  clientModal:         () => typeof closeClientModal           === 'function' && closeClientModal(),
  calcModal:           () => typeof closeCalculator            === 'function' && closeCalculator(),
  statsModal:          () => typeof closeStats                 === 'function' && closeStats(),
  learningStatsModal:  () => typeof closeLearningStats         === 'function' && closeLearningStats(),
  shareModal:          () => typeof closeShareModal            === 'function' && closeShareModal(),
  agendaModal:         () => typeof closeAgenda                === 'function' && closeAgenda(),
  importacaoModal:     () => typeof closeImportacao            === 'function' && closeImportacao(),
  portalAdminModal:    () => typeof fecharPortalAdmin          === 'function' && fecharPortalAdmin(),
  atalhoModal:         () => document.getElementById('atalhoModal')?.remove(),
  cmdOverlay:          () => typeof cmdFechar                  === 'function' && cmdFechar(),
  bnModulosSheet:      () => document.getElementById('bnModulosSheet')?.remove(),
};

// ── Obter modal visível mais recente ─────────────────────────
function _getModalAberto() {
  const ids = Object.keys(MODAL_CLOSE_MAP);
  // Percorrer em ordem reversa para pegar o mais recente (maior z-index)
  for (let i = ids.length - 1; i >= 0; i--) {
    const el = document.getElementById(ids[i]);
    if (!el) continue;
    const style = window.getComputedStyle(el);
    const display = style.display;
    if (display !== 'none' && display !== '') return ids[i];
  }
  return null;
}

function _fecharModalAberto() {
  const id = _getModalAberto();
  if (id && MODAL_CLOSE_MAP[id]) {
    MODAL_CLOSE_MAP[id]();
    return true;
  }
  return false;
}

// ── 1. SWIPE DOWN PARA FECHAR (pull-to-dismiss) ───────────────
function _initSwipeToClose() {
  let touchStartY   = 0;
  let touchStartX   = 0;
  let activeSheet   = null;
  let activeInner   = null;
  let isDragging    = false;
  let startTranslate = 0;

  // Identificar o elemento arrastável (o inner box do bottom sheet)
  function _getSheetInner(target) {
    // Verificar se o toque começou numa área scrollável com conteúdo
    const sheet = target.closest(
      '.dp-modal, #profileModal > div, #clientModal .client-modal-box, ' +
      '#spedModal .sped-modal-box, .imp-modal, #docModal > div, ' +
      '#calcModal > div, #shareModal > div, #statsModal > div, ' +
      '#learningStatsModal > div, #bnModulosBox, #cmdBox, #atalhoBox'
    );
    return sheet;
  }

  document.addEventListener('touchstart', e => {
    if (window.innerWidth > 600) return;
    const inner = _getSheetInner(e.target);
    if (!inner) return;

    // Só iniciar drag se o scroll interno já estiver no topo
    const scrollTop = inner.scrollTop || 0;
    if (scrollTop > 4) return; // deixar scroll normal acontecer

    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    activeInner = inner;
    isDragging  = false;
    startTranslate = 0;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!activeInner || window.innerWidth > 600) return;

    const dy = e.touches[0].clientY - touchStartY;
    const dx = Math.abs(e.touches[0].clientX - touchStartX);

    // Só engajar se movimento for principalmente vertical para baixo
    if (!isDragging) {
      if (dy < 8) return;
      if (dx > dy) { activeInner = null; return; } // scroll horizontal, ignorar
      isDragging = true;
    }

    if (dy <= 0) { // deslizando para cima — scroll normal
      activeInner.style.transform = '';
      return;
    }

    // Aplicar resistência: quanto mais arrasta, mais lento
    const resistance = 0.45;
    const translate = dy * resistance;
    activeInner.style.transform = `translateY(${translate}px)`;
    activeInner.style.transition = 'none';

    // Feedback visual — opacidade do overlay
    const overlay = activeInner.closest('[id$="Modal"], #bnModulosSheet, #cmdOverlay, #atalhoModal');
    if (overlay) {
      const progress = Math.min(translate / 150, 1);
      overlay.style.background = `rgba(0,0,0,${0.55 * (1 - progress * 0.7)})`;
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!activeInner || !isDragging || window.innerWidth > 600) {
      activeInner = null;
      isDragging  = false;
      return;
    }

    const dy = e.changedTouches[0].clientY - touchStartY;
    const threshold = 80; // px para confirmar dismiss

    if (dy > threshold) {
      // Animar até sair da tela e fechar
      activeInner.style.transition = 'transform .25s ease';
      activeInner.style.transform  = `translateY(100%)`;
      setTimeout(() => {
        activeInner.style.transform  = '';
        activeInner.style.transition = '';
        _fecharModalAberto();
      }, 220);
    } else {
      // Snap back — cancelar
      activeInner.style.transition = 'transform .2s cubic-bezier(.4,0,.2,1)';
      activeInner.style.transform  = '';
      // Restaurar overlay
      const overlay = activeInner.closest('[id$="Modal"], #bnModulosSheet, #cmdOverlay');
      if (overlay) overlay.style.background = '';
      setTimeout(() => {
        if (activeInner) activeInner.style.transition = '';
      }, 200);
    }

    activeInner = null;
    isDragging  = false;
  }, { passive: true });
}

// ── 2. BOTÃO VOLTAR ANDROID (popstate) ───────────────────────
function _initAndroidBack() {
  // Pushamos um state quando um modal abre
  // Quando pressionar voltar, o popstate fecha o modal

  // Interceptar abertura de modais via MutationObserver
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mut => {
      if (mut.type !== 'attributes' || mut.attributeName !== 'style') return;
      const el  = mut.target;
      const id  = el.id;
      if (!id || !MODAL_CLOSE_MAP[id]) return;

      const visivel = el.style.display !== 'none' && el.style.display !== '';
      if (visivel) {
        // Modal abriu — push state
        history.pushState({ modal: id }, '', window.location.href);
      }
    });
  });

  // Observar todos os modais
  Object.keys(MODAL_CLOSE_MAP).forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['style'] });
  });

  // Handler do botão voltar
  window.addEventListener('popstate', e => {
    // Tentar fechar modal aberto
    const fechou = _fecharModalAberto();
    if (!fechou) {
      // Nenhum modal aberto — comportamento padrão (sair da página)
      // Não fazer nada, deixar o browser decidir
    }
  });
}

// ── 3. FECHAR SIDEBAR COM BOTÃO VOLTAR ───────────────────────
function _initSidebarBack() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const obs = new MutationObserver(() => {
    if (sidebar.classList.contains('on')) {
      history.pushState({ modal: 'sidebar' }, '', window.location.href);
    }
  });
  obs.observe(sidebar, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('popstate', e => {
    if (sidebar.classList.contains('on')) {
      sidebar.classList.remove('on');
      document.getElementById('overlay')?.classList.remove('on');
    }
  });
}

// ── 4. INDICADOR VISUAL DE SWIPE NOS BOTTOM SHEETS ───────────
function _addSwipeHints() {
  // Adicionar handle visual nos modais que ainda não têm via CSS ::before
  // (apenas garantir que o drag handle seja visível e clicável)
  // O CSS já adiciona o ::before — apenas adicionar aria para acessibilidade
  document.querySelectorAll('.dp-modal').forEach(el => {
    if (!el.hasAttribute('aria-label')) {
      el.setAttribute('role', 'dialog');
    }
  });
}

// ── 5. HAPTIC FEEDBACK (onde disponível) ─────────────────────
function _haptic(type = 'light') {
  if (!window.navigator?.vibrate) return;
  const patterns = { light: [10], medium: [20], heavy: [30, 10, 30] };
  navigator.vibrate(patterns[type] || patterns.light);
}

// Expor para uso externo
window._haptic = _haptic;

// ── INIT ─────────────────────────────────────────────────────
function gestosInit() {
  if (window.innerWidth > 600) {
    // Desktop: apenas garantir que ESC fecha modais (já feito no ui_pro.js)
    return;
  }
  _initSwipeToClose();
  _initAndroidBack();
  _initSidebarBack();
  _addSwipeHints();
}

document.addEventListener('DOMContentLoaded', gestosInit);

// Re-inicializar em resize (tablet rotacionado)
let _gestosResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_gestosResizeTimer);
  _gestosResizeTimer = setTimeout(gestosInit, 300);
}, { passive: true });
