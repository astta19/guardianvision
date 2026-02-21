// ============================================================
// CORE.JS — Estado global, Supabase, Auth, Utilitários
// ============================================================

// --- Configuração Supabase ---
const SB_URL = 'https://ixqcbvfnvkqfxpvczakg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cWNidmZudmtxZnhwdmN6YWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk3NDA5NDcsImV4cCI6MjA1NTMxNjk0N30.OgOHAn_0GIhDyFt9XCXIW4bIpuUCYPGKMt1MmpqGt0w';
const sb = supabase.createClient(SB_URL, SB_KEY);

// --- Estado global ---
let currentUser    = null;
let currentCliente = null;
let currentChat    = { id: null, title: 'Nova Conversa', messages: [] };
let perfilCache    = null;
let allChats       = [];
let chatsPage      = 0;
let nfeData        = [];
let rateLimitUntil = 0;

const CHATS_PER_PAGE = 50;
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
];

// --- Utilitários ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAdmin() {
  return currentUser?.user_metadata?.role === 'admin';
}

function hideLoading() {
  const el = document.getElementById('loadingScreen');
  if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
}

function setConnectionStatus(text, icon, color) {
  const el = document.getElementById('conn');
  if (!el) return;
  el.innerHTML = '<i data-lucide="' + icon + '" style="width:13px;height:13px"></i> <span>' + text + '</span>';
  el.style.color = color;
  if (window.lucide) lucide.createIcons();
}

async function checkConnection() {
  try {
    const { error } = await sb.from('chats').select('id', { count: 'exact', head: true });
    if (error) {
      if (error.status === 401 || error.message?.includes('JWT')) { handleSessionExpired(); return; }
      throw error;
    }
    setConnectionStatus('Online', 'cloud', '#10b981');
  } catch (e) {
    setConnectionStatus('Offline', 'cloud-off', '#ef4444');
  }
}

function handleSessionExpired() {
  const authScreen = document.getElementById('authScreen');
  if (authScreen && !authScreen.classList.contains('hidden')) return;
  showConfirm('Sua sessão expirou. Faça login novamente.', () => {
    sb.auth.signOut();
  }, true);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'light' ? 'dark' : 'light');
}

function applyAdminUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
  document.querySelectorAll('.admin-menu-item').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
}

// --- Auth: mostrar formulários corretos ---
// HTML usa: loginForm, resetForm, setPasswordForm, confirmSentForm
function showAuthState(state) {
  ['loginForm','resetForm','setPasswordForm','confirmSentForm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const map = { login:'loginForm', reset:'resetForm', setPassword:'setPasswordForm', confirmSent:'confirmSentForm' };
  const target = document.getElementById(map[state] || state);
  if (target) target.style.display = '';
}

// Mostrar mensagem no form correto
// HTML usa: loginMsg, resetMsg, setPasswordMsg
function setAuthMsg(msg, isError, formState) {
  isError = isError !== false;
  let elId = 'loginMsg';
  if (formState) {
    const map = { login:'loginMsg', reset:'resetMsg', setPassword:'setPasswordMsg' };
    elId = map[formState] || 'loginMsg';
  } else {
    if (document.getElementById('resetForm')?.style.display !== 'none') elId = 'resetMsg';
    else if (document.getElementById('setPasswordForm')?.style.display !== 'none') elId = 'setPasswordMsg';
  }
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'auth-msg ' + (isError ? 'error' : 'success');
}

// --- Auth: ações ---
// HTML usa: loginEmail, loginPassword, loginBtn
async function doLogin() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const pass  = document.getElementById('loginPassword')?.value;
  if (!email || !pass) { setAuthMsg('Preencha e-mail e senha.', true, 'login'); return; }
  const btn = document.getElementById('loginBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  if (error) setAuthMsg(error.message || 'Erro ao fazer login.', true, 'login');
}

// HTML usa: resetEmail
async function doReset() {
  const email = document.getElementById('resetEmail')?.value.trim();
  if (!email) { setAuthMsg('Informe seu e-mail.', true, 'reset'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=true'
  });
  if (error) setAuthMsg(error.message, true, 'reset');
  else setAuthMsg('E-mail de recuperação enviado!', false, 'reset');
}

// HTML usa: newPassword, confirmPassword
async function doSetPassword() {
  const pass  = document.getElementById('newPassword')?.value;
  const pass2 = document.getElementById('confirmPassword')?.value;
  if (!pass || pass.length < 8) { setAuthMsg('Mínimo 8 caracteres.', true, 'setPassword'); return; }
  if (pass !== pass2) { setAuthMsg('As senhas não coincidem.', true, 'setPassword'); return; }
  const { error } = await sb.auth.updateUser({ password: pass });
  if (error) setAuthMsg(error.message, true, 'setPassword');
  else { setAuthMsg('Senha definida!', false, 'setPassword'); setTimeout(() => showAuthState('login'), 2000); }
}

function doLogout() {
  showConfirm('Tem certeza que deseja sair?', async () => { await sb.auth.signOut(); });
}

// --- Confirm dialog ---
// HTML usa: confirmModal, confirmModalText, confirmModalCancel, confirmModalOk
function showConfirm(msg, onConfirm, hideCancel) {
  const modal = document.getElementById('confirmModal');
  if (!modal) return;
  const txt = document.getElementById('confirmModalText');
  if (txt) txt.textContent = msg;
  const cancelBtn = document.getElementById('confirmModalCancel');
  if (cancelBtn) cancelBtn.style.display = hideCancel ? 'none' : '';
  modal.style.display = 'flex';
  window._confirmCallback = onConfirm;
}

function closeConfirm(confirmed) {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';
  if (confirmed && typeof window._confirmCallback === 'function') window._confirmCallback();
  window._confirmCallback = null;
}

// --- Telas principal ---
function showAuthScreen() {
  ['confirmModal','clientModal','docModal','profileModal','calcModal',
   'statsModal','learningStatsModal','shareModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
  });
  ['sidebar','chat','overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
  });
  document.querySelector('header')?.classList.add('hidden');
  const auth = document.getElementById('authScreen');
  if (auth) { auth.classList.remove('hidden'); auth.style.display = ''; }
  showAuthState('login');
  const ue = document.getElementById('userEmail');
  if (ue) ue.textContent = '—';
  allChats = []; currentCliente = null; perfilCache = null;
  currentChat = { id: null, title: 'Nova Conversa', messages: [] };
  const hList = document.getElementById('hList');
  if (hList) hList.innerHTML = '';
  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = '<div class="empty"><i data-lucide="message-circle"></i><h3>Olá! Sou seu especialista fiscal</h3><p>Faça perguntas sobre tributos, CFOPs, cálculos e muito mais!</p></div>';
  if (window.lucide) lucide.createIcons();
}

async function showApp() {
  hideLoading();
  const auth = document.getElementById('authScreen');
  if (auth) { auth.classList.add('hidden'); auth.style.display = 'none'; }
  ['sidebar','chat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); el.style.removeProperty('display'); }
  });
  document.querySelector('header')?.classList.remove('hidden');
  const { data: { user } } = await sb.auth.getUser();
  if (user) currentUser = user;
  setTheme(currentUser?.user_metadata?.theme || localStorage.getItem('theme') || 'light');
  applyAdminUI();
  checkConnection();
  if (typeof loadClientes === 'function') loadClientes();
  if (typeof checkDeadlines === 'function') checkDeadlines();
  if (typeof carregarPerfil === 'function') carregarPerfil().then(() => {
    if (typeof atualizarNomeHeader === 'function') atualizarNomeHeader();
  });
  if (window.lucide) lucide.createIcons();
}

// --- Audit log ---
async function registrarAuditLog(acao, detalhes) {
  try {
    await sb.from('audit_log').insert({
      user_id: currentUser?.id,
      cliente_id: currentCliente?.id || null,
      acao,
      detalhes: detalhes || {},
      created_at: new Date().toISOString()
    });
  } catch (e) { /* silencioso */ }
}

// --- Supabase proxy (admin) ---
async function supabaseProxy(action, payload) {
  const res = await fetch('/.netlify/functions/supabase-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, token: (await sb.auth.getSession()).data.session?.access_token })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro ' + res.status);
  }
  return res.json();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  setTheme(localStorage.getItem('theme') || 'light');

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#docGenBtn') && !e.target.closest('#docGenMenu')) {
      const menu = document.getElementById('docGenMenu');
      if (menu) menu.style.display = 'none';
    }
  });

  // Eventos futuros de auth
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      if (session) currentUser = session.user;
      showApp();
    } else if (event === 'TOKEN_REFRESHED') {
      if (session) currentUser = session.user;
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showAuthScreen();
    } else if (event === 'PASSWORD_RECOVERY') {
      hideLoading();
      showAuthState('setPassword');
    }
  });

  // Sessão existente (carregamento inicial)
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) { currentUser = session.user; showApp(); }
    else { hideLoading(); showAuthScreen(); }
  }).catch(() => { hideLoading(); showAuthScreen(); });

  // Failsafe 6s
  setTimeout(() => {
    const loading = document.getElementById('loadingScreen');
    if (loading && loading.style.display !== 'none') { hideLoading(); showAuthScreen(); }
  }, 6000);
});
