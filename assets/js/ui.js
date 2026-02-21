// ============================================================
// UI.JS — Sidebar, Modais, Dropdowns, Tema
// ============================================================

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('on');
  document.getElementById('overlay')?.classList.toggle('on');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('on');
  document.getElementById('overlay')?.classList.remove('on');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function switchDocTab(tab) {
  document.querySelectorAll('#docModal .doc-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('#docModal .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`docPanel_${tab}`)?.classList.remove('hidden');
  document.querySelector(`#docModal [onclick="switchDocTab('${tab}')"]`)?.classList.add('active');
}

function switchProfileTab(tab) {
  document.querySelectorAll('#profileModal .doc-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('#profileModal .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`profilePanel_${tab}`)?.classList.remove('hidden');
  document.querySelector(`#profileModal [onclick="switchProfileTab('${tab}')"]`)?.classList.add('active');
}

function openDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  switchDocTab('nfe');
  lucide.createIcons();
}

function closeDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

function openCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  lucide.createIcons();
}

function closeCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

function showStats() {
  const modal = document.getElementById('statsModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
}

function closeStats() {
  const modal = document.getElementById('statsModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

function openShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  document.querySelectorAll('.dropdown-menu').forEach(d => d.style.display = 'none');
  el.style.display = isOpen ? 'none' : 'block';
}

function toggleDocGenMenu() {
  const menu = document.getElementById('docGenMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Fechar modais com ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDocumentos();
    closeCalculator();
    closeStats();
    closeShareModal();
    if (typeof closeProfile === 'function') closeProfile();
  }
});
