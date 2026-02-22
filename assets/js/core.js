// ============================================================
// CORE.JS — Estado global, Supabase, Auth, Utilitários
// ============================================================

// --- Configuração Supabase ---
const SB_URL = 'https://myezzedahfyrelqcgsad.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZXp6ZWRhaGZ5cmVscWNnc2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMDQ2NDUsImV4cCI6MjA4Njg4MDY0NX0.Cm1bvNbjpPAc7U_NOWPceTw62dSR_Yhv1d38lc1ScDI';
const sb = supabase.createClient(SB_URL, SB_KEY);

// --- Estado global ---
let currentUser    = null;
let currentCliente = null;
let currentChat    = { id: null, title: 'Nova Conversa', messages: [] };
let perfilCache    = null;
let allChats       = [];
let chatsPage      = 0;
let nfeData        = [];
let darfData = null;
let rateLimitUntil = 0;

const CHATS_PER_PAGE = 50;
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-8b-8192',
];

const fiscalDeadlines = {
      'sped_fiscal': { day: 15, month: 'monthly', description: 'Entrega SPED Fiscal' },
      'dctf': { day: 15, month: 'monthly', description: 'Entrega DCTF' },
      'ecf': { day: 31, month: 7, description: 'Entrega ECF' }
    };
let currentFiles = [];
let isProcessingFile = false;
let typingIndicator = null;
const responseCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos
let currentModelIndex = 0;
let consecutiveErrors = 0;
const badges = {
      'primeira_pergunta': { name: 'Primeiros Passos', icon: '', condition: (s) => s.questions >= 1 },
      'analista_10': { name: 'Analista Experiente', icon: '', condition: (s) => s.questions >= 10 },
      'mestre_pdfs': { name: 'Mestre dos PDFs', icon: '', condition: (s) => s.filesAnalyzed >= 5 },
      'fiscal_pro': { name: 'Fiscal Pro', icon: '', condition: (s) => s.correctAnswers >= 20 }
    };

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
  const next = current === 'light' ? 'dark' : 'light';
  setTheme(next);
  // Persistir no Supabase para sobreviver entre sessões
  if (currentUser) sb.auth.updateUser({ data: { theme: next } }).catch(() => {});
}

function applyAdminUI() {
  const admin = isAdmin();
  const perms = currentUser?.user_metadata?.permissions || [];

  // admin-only: apenas para admins
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });

  // admin-menu-item: admin vê tudo; contador vê se tiver permissão
  document.querySelectorAll('.admin-menu-item').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });

  // data-perm: itens com permissão específica
  document.querySelectorAll('[data-perm]').forEach(el => {
    const perm = el.getAttribute('data-perm');
    el.style.display = (admin || perms.includes(perm)) ? '' : 'none';
  });
}

// Chamada pelo admin para definir permissões de um contador
async function definirPermissoes(userId, permissions) {
  if (!isAdmin()) return;
  // Usa supabase-proxy com service key para updateUser
  const session = await sb.auth.getSession();
  const token = session?.data?.session?.access_token;
  const res = await fetch('/.netlify/functions/supabase-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'definir_permissoes', payload: { userId, permissions }, token })
  });
  return res.ok;
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

async function doGoogleLogin() {
  const btn = document.querySelector('.google-btn');
  const msg = document.getElementById('loginMsg');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="0" style="animation:spin .75s linear infinite"/></svg> Redirecionando...';
  }
  if (msg) { msg.textContent = ''; msg.className = 'auth-msg'; }

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });

  if (error) {
    if (msg) {
      msg.textContent = 'Erro ao conectar com Google: ' + error.message;
      msg.className = 'auth-msg error';
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.96 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continuar com Google';
    }
  }
  // Se sem erro: Supabase redireciona para Google automaticamente
}

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
  showConfirm('Tem certeza que deseja sair?', async () => {
    await sb.auth.signOut();
    window.location.reload();
  });
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
  // localStorage tem prioridade — é atualizado imediatamente ao trocar o tema
  setTheme(localStorage.getItem('theme') || currentUser?.user_metadata?.theme || 'light');
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
    // PASSWORD_RECOVERY DEVE ser tratado ANTES de SIGNED_IN
    // Supabase dispara SIGNED_IN junto com PASSWORD_RECOVERY — ignorar o SIGNED_IN nesses casos
    if (event === 'PASSWORD_RECOVERY') {
      currentUser = session?.user || null;
      hideLoading();
      showAuthState('setPassword');
      return; // não chamar showApp()
    }

    if (event === 'SIGNED_IN') {
      if (session) currentUser = session.user;
      showApp();
    } else if (event === 'TOKEN_REFRESHED') {
      if (session) currentUser = session.user;
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      currentUser = null;
      showAuthScreen();
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

// ── FECHAR MODAIS COM ESC ────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Fechar em ordem de prioridade (modal mais aberto fecha primeiro)
  if (typeof closeSped === 'function' && document.getElementById('spedModal')?.style.display !== 'none') { closeSped(); return; }
  if (typeof closeProfile === 'function' && document.getElementById('profileModal')?.style.display !== 'none') { closeProfile(); return; }
  if (document.getElementById('statsModal')?.style.display !== 'none') { if (typeof closeStats === 'function') closeStats(); return; }
  if (document.getElementById('learningStatsModal')?.style.display !== 'none') { if (typeof closeLearningStats === 'function') closeLearningStats(); return; }
  if (document.getElementById('shareModal')?.style.display !== 'none') { if (typeof closeShareModal === 'function') closeShareModal(); return; }
  if (!document.getElementById('clientModal')?.classList.contains('hidden')) { if (typeof closeClientModal === 'function') closeClientModal(); return; }
});
