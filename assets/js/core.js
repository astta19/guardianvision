// ============================================================
// CORE.JS — Estado global, Supabase, Auth, Utilitários
// ============================================================

// --- Configuração Supabase ---
const SB_URL = 'https://ixqcbvfnvkqfxpvczakg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cWNidmZudmtxZnhwdmN6YWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk3NDA5NDcsImV4cCI6MjA1NTMxNjk0N30.OgOHAn_0GIhDyFt9XCXIW4bIpuUCYPGKMt1MmpqGt0w';
const sb = supabase.createClient(SB_URL, SB_KEY);

// --- Estado global ---
let currentUser   = null;
let currentCliente = null;
let currentChat   = { id: null, title: 'Nova Conversa', messages: [] };
let perfilCache   = null;
let allChats      = [];
let chatsPage     = 0;
let nfeData       = [];
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
  const el = document.getElementById('connStatus');
  if (!el) return;
  el.innerHTML = `<i data-lucide="${icon}" style="width:13px;height:13px"></i> ${text}`;
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
  if (document.getElementById('authScreen')?.classList.contains('hidden') === false) return;
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
}

// --- Auth ---
function showAuthState(state) {
  document.querySelectorAll('.auth-state').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`authState_${state}`);
  if (target) target.classList.remove('hidden');
}

function setAuthMsg(msg, isError = true) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${isError ? 'error' : 'success'}`;
}

async function doLogin() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const pass  = document.getElementById('loginPass')?.value;
  if (!email || !pass) { setAuthMsg('Preencha e-mail e senha.'); return; }
  const btn = document.querySelector('#authState_login .btn-auth');
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  if (error) setAuthMsg(error.message || 'Erro ao fazer login.');
}

async function doReset() {
  const email = document.getElementById('resetEmail')?.value.trim();
  if (!email) { setAuthMsg('Informe seu e-mail.'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=true'
  });
  if (error) setAuthMsg(error.message);
  else setAuthMsg('E-mail de recuperação enviado!', false);
}

async function doSetPassword() {
  const pass  = document.getElementById('newPassInput')?.value;
  const pass2 = document.getElementById('newPassInput2')?.value;
  if (!pass || pass.length < 8) { setAuthMsg('Senha deve ter pelo menos 8 caracteres.'); return; }
  if (pass !== pass2) { setAuthMsg('As senhas não coincidem.'); return; }
  const { error } = await sb.auth.updateUser({ password: pass });
  if (error) setAuthMsg(error.message);
  else { setAuthMsg('Senha definida com sucesso!', false); setTimeout(() => showAuthState('login'), 2000); }
}

function doLogout() {
  showConfirm('Tem certeza que deseja sair?', async () => {
    await sb.auth.signOut();
  });
}

// --- Telas ---
function showAuthScreen() {
  ['confirmModal','clientModal','docModal','profileModal','calcModal',
   'statsModal','learningStatsModal','shareModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
  });
  ['sidebar','chat','overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  document.querySelector('header')?.classList.add('hidden');

  document.getElementById('authScreen').classList.remove('hidden');
  showAuthState('login');
  document.getElementById('userEmail').textContent = '—';
  allChats      = [];
  currentCliente = null;
  perfilCache   = null;
  currentChat   = { id: null, title: 'Nova Conversa', messages: [] };
  document.getElementById('hList').innerHTML = '';
  document.getElementById('msgs').innerHTML = `
    <div class="empty">
      <i data-lucide="message-circle"></i>
      <h3>Olá! Sou seu especialista fiscal</h3>
      <p>Faça perguntas sobre tributos, CFOPs, cálculos e muito mais!</p>
    </div>`;
  lucide.createIcons();
}

async function showApp() {
  hideLoading();
  document.getElementById('authScreen').classList.add('hidden');
  ['sidebar','chat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });
  document.querySelector('header')?.classList.remove('hidden');

  carregarPerfil().then(() => atualizarNomeHeader());

  const { data: { user } } = await sb.auth.getUser();
  if (user) currentUser = user;

  const savedTheme = currentUser?.user_metadata?.theme || localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  applyAdminUI();
  checkConnection();
  loadClientes();
  checkDeadlines();
}

// --- Confirm dialog ---
function showConfirm(msg, onConfirm, hideCancel = false) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmMsg').textContent = msg;
  const cancelBtn = document.getElementById('confirmCancel');
  if (cancelBtn) cancelBtn.style.display = hideCancel ? 'none' : '';
  modal.style.display = 'flex';
  window._confirmCallback = onConfirm;
}

function closeConfirm(confirmed) {
  document.getElementById('confirmModal').style.display = 'none';
  if (confirmed && typeof window._confirmCallback === 'function') {
    window._confirmCallback();
  }
  window._confirmCallback = null;
}

// --- Audit log ---
async function registrarAuditLog(acao, detalhes = {}) {
  try {
    await sb.from('audit_log').insert({
      user_id: currentUser?.id,
      cliente_id: currentCliente?.id || null,
      acao,
      detalhes,
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
    throw new Error(err.error || `Erro ${res.status}`);
  }
  return res.json();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  // Tema salvo
  const saved = localStorage.getItem('theme') || 'light';
  setTheme(saved);

  // Fechar dropdowns ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#docGenBtn') && !e.target.closest('#docGenMenu')) {
      const menu = document.getElementById('docGenMenu');
      if (menu) menu.style.display = 'none';
    }
  });

  // Auth state listener
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (session) currentUser = session.user;
      if (event === 'SIGNED_IN') showApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      hideLoading();
      showAuthScreen();
    } else if (event === 'PASSWORD_RECOVERY') {
      showAuthState('setPassword');
    }
  });

  // Verificar sessão existente imediatamente — resolve o loading eterno
  // onAuthStateChange pode não disparar se não houver sessão
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      showApp();
    } else {
      hideLoading();
      showAuthScreen();
    }
  }).catch(() => {
    hideLoading();
    showAuthScreen();
  });

  // Failsafe: se nada resolver em 5s, esconde o loading
  setTimeout(() => {
    const loading = document.getElementById('loadingScreen');
    if (loading && !loading.classList.contains('hidden')) {
      hideLoading();
      showAuthScreen();
    }
  }, 5000);

  // Verificar token de convite/reset no hash
  const hash = window.location.hash;
  if (hash.includes('access_token') && hash.includes('type=recovery')) {
    showAuthState('setPassword');
  }
});
