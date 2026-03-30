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

// Cache do escritório do usuário atual — usado em inserts de todas as tabelas
let _escIdCache = null;

// Retorna o escritorio_id do usuário atual (com cache).
// Retorna null silenciosamente se não encontrar — não quebra fluxo.
async function getEscritorioIdAtual() {
  if (_escIdCache) return _escIdCache;
  if (!currentUser) return null;
  try {
    const { data } = await sb.from('escritorios').select('id')
      .eq('owner_id', currentUser.id).limit(1);
    _escIdCache = data?.[0]?.id || null;
    if (!_escIdCache) {
      const { data: mem } = await sb.from('escritorio_usuarios').select('escritorio_id')
        .eq('user_id', currentUser.id).limit(1);
      _escIdCache = mem?.[0]?.escritorio_id || null;
    }
    if (!_escIdCache) {
      console.warn('[fiscal365] getEscritorioIdAtual: nenhum escritório encontrado para', currentUser?.email);
    }
    return _escIdCache;
  } catch(e) {
    console.error('[fiscal365] getEscritorioIdAtual error:', e);
    return null;
  }
}

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
  'das':         { day: 20, month: 'monthly', description: 'DAS Simples Nacional',  simplesOuMei: true },
  'dctfweb':     { day: 28, month: 'monthly', description: 'DCTFWeb'                                   },
  'efd_reinf':   { day: 15, month: 'monthly', description: 'EFD-Reinf'                                 },
  'esocial':     { day: 15, month: 'monthly', description: 'eSocial (folha)'                            },
  'efd_contrib': { day: 10, month: 'monthly', description: 'EFD-Contribuições',     naoSimples: true    },
  'sped_fiscal': { day: 15, month: 'monthly', description: 'SPED Fiscal'                                },
  'dctf':        { day: 15, month: 'monthly', description: 'DCTF'                                       },
  'dasn_simei':  { day: 31, month: 5,         description: 'DASN-SIMEI (MEI)',      meiOnly: true       },
  'defis':       { day: 31, month: 3,         description: 'DEFIS (Simples)',       simplesOuMei: true   },
  'ecd':         { day: 30, month: 6,         description: 'ECD'                                        },
  'ecf':         { day: 31, month: 7,         description: 'ECF'                                        },
  'dirpf':       { day: 29, month: 5,         description: 'DIRPF (PF)'                                 },
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
  'analista_10':       { name: 'Analista Experiente', icon: '', condition: (s) => s.questions >= 10 },
  'mestre_pdfs':       { name: 'Mestre dos PDFs', icon: '', condition: (s) => s.filesAnalyzed >= 5 },
  'fiscal_pro':        { name: 'Fiscal Pro', icon: '', condition: (s) => s.correctAnswers >= 20 }
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

function isMaster() {
  return currentUser?.user_metadata?.role === 'master';
}

function isAdmin() {
  return currentUser?.user_metadata?.role === 'admin'
      || currentUser?.user_metadata?.role === 'master';
}

let _splashShownAt = Date.now();

function hideLoading() {
  const el = document.getElementById('loadingScreen');
  if (!el) return;
  const elapsed = Date.now() - _splashShownAt;
  const remaining = Math.max(0, 4000 - elapsed);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; el.classList.add('hidden'); }, 500);
  }, remaining);
}

function setConnectionStatus(text, icon, color) {
  const el = document.getElementById('conn');
  if (!el) return;
  el.innerHTML = '<i data-lucide="' + icon + '" style="width:13px;height:13px"></i> <span>' + text + '</span>';
  el.style.color = color;
  el.classList.remove('offline', 'connecting');
  if (icon === 'cloud-off') el.classList.add('offline');
  if (icon === 'loader')    el.classList.add('connecting');
  if (window.lucide) lucide.createIcons();
}

async function checkConnection() {
  try {
    const { error } = await sb.from('perfis_usuarios').select('user_id', { count: 'exact', head: true })
      .eq('user_id', currentUser?.id || '00000000-0000-0000-0000-000000000000');
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
  if (currentUser) sb.auth.updateUser({ data: { theme: next } }).catch(() => {});
}

// ── Toast notifications ───────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  if (typeof showToastComAcao === 'function') {
    showToastComAcao(msg, type, null, null, duration);
    return;
  }
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const colors = { success: '#22c55e', error: '#ef4444', warn: '#f59e0b', info: 'var(--accent)' };
  const toast = document.createElement('div');
  toast.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.18);opacity:0;transition:opacity .2s;white-space:nowrap;pointer-events:auto;`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, duration);
}

function applyAdminUI() {
  const admin = isAdmin();
  const perms = currentUser?.user_metadata?.permissions || [];

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
  const master = isMaster();
  document.querySelectorAll('.master-only').forEach(el => {
    el.style.display = master ? '' : 'none';
  });
  const adminSection = document.getElementById('toolsAdminSection');
  if (adminSection) adminSection.style.display = admin ? '' : 'none';

  document.querySelectorAll('.admin-menu-item').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
  document.querySelectorAll('[data-perm]').forEach(el => {
    const perm = el.getAttribute('data-perm');
    el.style.display = (admin || perms.includes(perm)) ? '' : 'none';
  });
}

async function definirPermissoes(userId, permissions) {
  if (!isAdmin() && !isMaster()) return false;
  try {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    const res = await fetch('/api/supabase-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'definir_permissoes', payload: { userId, permissions }, token })
    });
    return res.ok ? { ok: true } : false;
  } catch(e) {
    console.error('definirPermissoes:', e);
    return false;
  }
}

function showAuthState(state) {
  ['loginForm','resetForm','setPasswordForm','confirmSentForm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const map = { login:'loginForm', reset:'resetForm', setPassword:'setPasswordForm', confirmSent:'confirmSentForm' };
  const target = document.getElementById(map[state] || state);
  if (target) target.style.display = '';

  // Atualizar título do painel direito conforme o estado
  const subtitle = document.getElementById('authSubtitle');
  if (subtitle) {
    const titles = {
      login:       'Bem-vindo de volta',
      reset:       'Recuperar acesso',
      setPassword: window._primeiroAcesso ? 'Crie sua senha' : 'Definir nova senha',
      confirmSent: 'Verifique seu e-mail',
    };
    subtitle.textContent = titles[state] || 'Bem-vindo de volta';
  }
}

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

// ── Validação de aceite dos termos ────────────────────────────
function _termosVerificar() {
  const check = document.getElementById('termosCheck');
  const erro  = document.getElementById('termosErro');
  if (!check) return true;
  if (check.checked) {
    if (erro) erro.style.display = 'none';
    return true;
  }
  if (erro) erro.style.display = 'block';
  check.closest('label')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  check.focus();
  return false;
}

async function _termosRegistrarAceite() {
  if (!currentUser) return;
  try {
    await sb.from('perfis_usuarios').upsert({
      user_id: currentUser.id,
      termos_aceito_em: new Date().toISOString(),
      termos_versao: '2026-01',
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch(e) { /* silencioso */ }
}

async function doGoogleLogin() {
  if (!_termosVerificar()) return;
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
}

async function doLogin() {
  if (!_termosVerificar()) return;
  const email = document.getElementById('loginEmail')?.value.trim();
  const pass  = document.getElementById('loginPassword')?.value;
  if (!email || !pass) { setAuthMsg('Preencha e-mail e senha.', true, 'login'); return; }
  const btn = document.getElementById('loginBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }

  // reCAPTCHA v3 — aguarda estar pronto se ainda carregando (max 5s)
  try {
    if (typeof grecaptcha !== 'undefined' || window._recaptchaLoading) {
      // Aguardar RECAPTCHA_SITE_KEY estar disponível
      if (!window.RECAPTCHA_SITE_KEY) {
        await new Promise((resolve, reject) => {
          const t = Date.now();
          const check = setInterval(() => {
            if (window.RECAPTCHA_SITE_KEY) { clearInterval(check); resolve(); }
            else if (!window._recaptchaLoading && !window.RECAPTCHA_SITE_KEY) { clearInterval(check); reject(new Error('blocked')); }
            else if (Date.now() - t > 5000) { clearInterval(check); reject(new Error('timeout')); }
          }, 100);
        });
      }
      const token = await grecaptcha.execute(window.RECAPTCHA_SITE_KEY, { action: 'login' });
      const r = await fetch('/api/recaptcha-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('application/json')) {
        const data = await r.json();
        if (!data.ok) {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          setAuthMsg('Verificação de segurança falhou. Tente novamente.', true, 'login');
          return;
        }
      }
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
    setAuthMsg('Verificação de segurança indisponível. Recarregue a página e tente novamente.', true, 'login');
    return;
  }

  if (btn) btn.textContent = 'Entrando...';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  if (error) setAuthMsg(error.message || 'Erro ao fazer login.', true, 'login');
}

async function doReset() {
  const email = document.getElementById('resetEmail')?.value.trim();
  if (!email) { setAuthMsg('Informe seu e-mail.', true, 'reset'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=true'
  });
  if (error) setAuthMsg(error.message, true, 'reset');
  else setAuthMsg('E-mail de recuperação enviado!', false, 'reset');
}

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
function showConfirm(msg, onConfirm, hideCancel) {
  const modal = document.getElementById('confirmModal');
  if (!modal) {
    const ok = window.confirm(msg);
    if (ok && typeof onConfirm === 'function') onConfirm();
    return Promise.resolve(ok);
  }
  const txt = document.getElementById('confirmModalText');
  if (txt) txt.textContent = msg;
  const cancelBtn = document.getElementById('confirmModalCancel');
  if (cancelBtn) cancelBtn.style.display = hideCancel ? 'none' : '';
  modal.style.display = 'flex';

  return new Promise(resolve => {
    window._confirmResolve  = resolve;
    window._confirmCallback = typeof onConfirm === 'function' ? onConfirm : null;
  });
}

function closeConfirm(confirmed) {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';
  if (typeof window._confirmResolve === 'function') window._confirmResolve(!!confirmed);
  if (confirmed && typeof window._confirmCallback === 'function') window._confirmCallback();
  window._confirmResolve  = null;
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
  allChats = []; currentCliente = null; perfilCache = null; _escIdCache = null;
  currentChat = { id: null, title: 'Nova Conversa', messages: [] };

  // Esconder bottom nav na tela de autenticação
  const bn = document.getElementById('bottomNav');
  if (bn) bn.style.display = 'none';

  if (typeof learningService !== 'undefined') learningService = null;
  if (_pollingUploadTimer) { clearInterval(_pollingUploadTimer); _pollingUploadTimer = null; }
  _pollingUploadUltimoCount = -1;
  if (typeof msnReset === 'function') msnReset();
  if (typeof escritorioReset === 'function') escritorioReset();
  if (typeof EmpresaContext !== 'undefined') EmpresaContext.invalidar();
  const hList = document.getElementById('hList');
  if (hList) hList.innerHTML = '';
  const msgs = document.getElementById('msgs');
  if (msgs) {
    const nome = currentUser?.user_metadata?.nome || currentUser?.email?.split('@')[0] || '';
    const saudacao = (() => {
      const h = new Date().getHours();
      if (h < 12) return 'Bom dia';
      if (h < 18) return 'Boa tarde';
      return 'Boa noite';
    })();
    msgs.innerHTML = `<div class="empty">
      <img src="https://myezzedahfyrelqcgsad.supabase.co/storage/v1/object/public/assets/logo_fiscal365.png"
        style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin-bottom:4px;opacity:.9"
        onerror="this.style.display='none'">
      <h3>${saudacao}${nome ? ', ' + nome.split(' ')[0] : ''}!</h3>
      <p>Faça perguntas sobre tributos, CFOPs, cálculos e muito mais.</p>
    </div>`;
  }
  if (window.lucide) lucide.createIcons();

  // Inicializar reCAPTCHA apenas quando a tela de login é exibida
  _initRecaptcha();
}

async function showApp() {
  hideLoading();
  const auth = document.getElementById('authScreen');
  if (auth) { auth.classList.add('hidden'); auth.style.display = 'none'; }
  ['sidebar','chat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); el.style.removeProperty('display'); }
  });

  // Header: visível no desktop, escondido no mobile (bottom nav assume)
  const header = document.querySelector('header');
  if (header) {
    if (window.innerWidth <= 600) header.classList.add('hidden');
    else header.classList.remove('hidden');
  }

  // Mostrar bottom nav apenas após autenticado
  const bn = document.getElementById('bottomNav');
  if (bn) bn.style.removeProperty('display');
  const { data: { user } } = await sb.auth.getUser();
  if (user) currentUser = user;
  setTheme(localStorage.getItem('theme') || currentUser?.user_metadata?.theme || 'light');
  if (currentUser && !isAdmin()) {
    try {
      const r = await supabaseProxy('buscar_permissoes', { userId: currentUser.id });
      if (r?.permissions && Array.isArray(r.permissions)) {
        if (!currentUser.user_metadata) currentUser.user_metadata = {};
        currentUser.user_metadata.permissions = r.permissions;
      }
    } catch(e) {}
  }
  applyAdminUI();
  checkConnection();
  if (typeof carregarPerfil === 'function') {
    await carregarPerfil();
    if (typeof atualizarNomeHeader === 'function') atualizarNomeHeader();
  }
  if (typeof msnInit === 'function') msnInit();
  if (typeof loadClientes === 'function') loadClientes();
  if (typeof checkDeadlines === 'function') checkDeadlines();
  carregarKPIs();
  iniciarPollingUploads();
  _idleStart();
  if (isMaster()) carregarDashboardMaster();
  if (window.lucide) lucide.createIcons();
  const _sharedToken = new URLSearchParams(window.location.search).get('shared');
  if (_sharedToken) carregarChatCompartilhado(_sharedToken);
}

// ── Expiração de sessão por inatividade ──────────────────────
const IDLE_TIMEOUT_MS  = 30 * 60 * 1000;
const IDLE_WARNING_MS  = 28 * 60 * 1000;
const IDLE_EVENTS      = ['mousedown','mousemove','keydown','keypress','touchstart','touchmove','scroll','click','input','focus'];

let _idleTimer        = null;
let _idleWarnTimer    = null;
let _idleWarnEl       = null;
let _idleActive       = false;

function _idleReset() {
  if (!_idleActive) return;
  clearTimeout(_idleTimer);
  clearTimeout(_idleWarnTimer);
  _idleWarnHide();
  _idleWarnTimer = setTimeout(_idleWarn,    IDLE_WARNING_MS);
  _idleTimer     = setTimeout(_idleLogout,  IDLE_TIMEOUT_MS);
}

function _idleWarn() {
  if (!_idleActive) return;
  if (_idleWarnEl) return;
  _idleWarnEl = document.createElement('div');
  _idleWarnEl.id = 'idleWarn';
  _idleWarnEl.innerHTML = `
    <div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 22px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;align-items:center;gap:14px;z-index:99999;min-width:320px;max-width:90vw;animation:slideUp .25s ease">
      <i data-lucide="clock" style="width:22px;height:22px;color:#f59e0b;flex-shrink:0"></i>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--text)">Sessão expirando</div>
        <div style="font-size:12px;color:var(--text-light);margin-top:2px">Você será deslogado em 2 minutos por inatividade.</div>
      </div>
      <button onclick="_idleReset()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0">
        Continuar
      </button>
    </div>`;
  document.body.appendChild(_idleWarnEl);
  if (window.lucide) lucide.createIcons();
}

function _idleWarnHide() {
  if (_idleWarnEl) { _idleWarnEl.remove(); _idleWarnEl = null; }
}

async function _idleLogout() {
  if (!_idleActive) return;
  _idleStop();
  showToast('Sessão encerrada por inatividade.', 'warn');
  await sb.auth.signOut();
}

function _idleStart() {
  if (_idleActive) return;
  _idleActive = true;
  IDLE_EVENTS.forEach(ev => document.addEventListener(ev, _idleReset, { passive: true }));
  _idleReset();
}

function _idleStop() {
  _idleActive = false;
  clearTimeout(_idleTimer);
  clearTimeout(_idleWarnTimer);
  _idleWarnHide();
  IDLE_EVENTS.forEach(ev => document.removeEventListener(ev, _idleReset));
}

// --- Audit log ---
async function registrarAuditLog(acao, tabelaOuDetalhes, id, detalhes) {
  let tabela = null, dados = {};
  if (typeof tabelaOuDetalhes === 'string') {
    tabela = tabelaOuDetalhes;
    dados = { ...(detalhes || {}), registro_id: id };
  } else {
    dados = tabelaOuDetalhes || {};
  }
  try {
    await sb.from('audit_log').insert({
      user_id: currentUser?.id,
      cliente_id: currentCliente?.id || null,
      acao,
      detalhes: { tabela, ...dados },
      created_at: new Date().toISOString()
    });
  } catch (e) { /* silencioso */ }
}

// --- reCAPTCHA init — chamado quando tela de login é exibida ---
let _recaptchaInitialized = false;
async function _initRecaptcha() {
  if (_recaptchaInitialized) return; // já carregado
  _recaptchaInitialized = true;
  window._recaptchaLoading = true;
  try {
    const r = await fetch('/api/recaptcha-config');
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('application/json')) return;
    const { siteKey } = await r.json();
    if (!siteKey) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://www.google.com/recaptcha/api.js?render=' + siteKey;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    await new Promise(resolve => grecaptcha.ready(resolve));
    window.RECAPTCHA_SITE_KEY = siteKey;
  } catch (e) {
    _recaptchaInitialized = false; // permitir retry
  } finally {
    window._recaptchaLoading = false;
  }
}

// --- Supabase proxy (admin) ---
async function supabaseProxy(action, payload) {
  const res = await fetch('/api/supabase-proxy', {
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

  // ── ESC fecha qualquer modal aberto ──────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const closers = [
      { id: 'apurModal',         fn: () => typeof closeApuracao             === 'function' && closeApuracao() },
      { id: 'balModal',          fn: () => typeof closeBalancete            === 'function' && closeBalancete() },
      { id: 'dreModal',          fn: () => typeof closeDRE                  === 'function' && closeDRE() },
      { id: 'concModal',         fn: () => typeof closeConciliacao          === 'function' && closeConciliacao() },
      { id: 'lcModal',           fn: () => typeof closeLancamentosContabeis === 'function' && closeLancamentosContabeis() },
      { id: 'pcModal',           fn: () => typeof closePlanoConta           === 'function' && closePlanoConta() },
      { id: 'folhaModal',        fn: () => typeof closeFolha                === 'function' && closeFolha() },
      { id: 'honModal',          fn: () => typeof closeHonorarios           === 'function' && closeHonorarios() },
      { id: 'finModal',          fn: () => typeof closeFinanceiro           === 'function' && closeFinanceiro() },
      { id: 'agendaModal',       fn: () => typeof closeAgenda               === 'function' && closeAgenda() },
      { id: 'spedModal',         fn: () => typeof closeSped                 === 'function' && closeSped() },
      { id: 'docModal',          fn: () => typeof closeDocumentos           === 'function' && closeDocumentos() },
      { id: 'profileModal',      fn: () => typeof closeProfile              === 'function' && closeProfile() },
      { id: 'empresaPerfilModal',fn: () => typeof closeEmpresaPerfil        === 'function' && closeEmpresaPerfil() },
      { id: 'calcModal',         fn: () => { const m = document.getElementById('calcModal'); if (m) m.style.display = 'none'; } },
      { id: 'statsModal',        fn: () => { const m = document.getElementById('statsModal'); if (m) m.style.display = 'none'; } },
      { id: 'learningStatsModal',fn: () => { const m = document.getElementById('learningStatsModal'); if (m) m.style.display = 'none'; } },
      { id: 'shareModal',        fn: () => { const m = document.getElementById('shareModal'); if (m) m.style.display = 'none'; } },
      { id: 'clientModal',       fn: () => typeof closeClientModal          === 'function' && closeClientModal() },
      { id: 'termosModal',       fn: () => { const m = document.getElementById('termosModal'); if (m) m.style.display = 'none'; } },
    ];
    for (const { id, fn } of closers) {
      const el = document.getElementById(id);
      if (el && (el.style.display === 'flex' || el.style.display === 'block') && !el.classList.contains('hidden')) {
        fn();
        e.preventDefault();
        return;
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#docGenBtn') && !e.target.closest('#docGenMenu')) {
      const menu = document.getElementById('docGenMenu');
      if (menu) menu.style.display = 'none';
    }
  });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      currentUser = session?.user || null;
      hideLoading();
      showAuthState('setPassword');
      return;
    }
    // Primeiro acesso via convite — Supabase dispara SIGNED_IN com user_metadata.invited_at
    if (event === 'SIGNED_IN') {
      if (session) currentUser = session.user;
      // Detectar se é primeiro acesso (convidado mas sem senha definida)
      const isInvite = session?.user?.app_metadata?.provider === 'email'
        && session?.user?.user_metadata?.invited_at
        && !session?.user?.last_sign_in_at;
      if (isInvite) {
        hideLoading();
        window._primeiroAcesso = true;
        showAuthState('setPassword');
        return;
      }
      if (typeof logInit === 'function') logInit(currentUser);
      _termosRegistrarAceite();
      showApp();
      if (typeof verificarConviteURL === 'function') verificarConviteURL();
    } else if (event === 'TOKEN_REFRESHED') {
      if (session) currentUser = session.user;
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      currentUser = null;
      _idleStop();
      showAuthScreen();
    }
  });

  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      if (typeof logInit === 'function') logInit(currentUser);
      showApp();
    }
    else {
      hideLoading();
      // Detectar convite na URL (?type=invite ou #type=invite no hash)
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
      const type = urlParams.get('type') || hashParams.get('type');
      if (type === 'invite') {
        window._primeiroAcesso = true;
        showAuthScreen();
        showAuthState('setPassword');
      } else {
        showAuthScreen();
      }
    }
  }).catch(() => { hideLoading(); showAuthScreen(); });

  // Failsafe 10s
  setTimeout(() => {
    const loading = document.getElementById('loadingScreen');
    if (loading && loading.style.display !== 'none') { hideLoading(); showAuthScreen(); }
  }, 10000);
});

async function carregarKPIs() {
  if (!currentUser) return;
  const dashboard = document.getElementById('kpiDashboard');
  if (!dashboard) return;
  try {
    const hoje = new Date();
    const semanaFim = new Date(hoje); semanaFim.setDate(hoje.getDate() + 7);
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
    const mesFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString();

    const [{ count: cTarefas }, { count: cVencidos }, { count: cClientes }, { count: cDarfs }] =
      await Promise.all([
        sb.from('agenda_tarefas').select('*', { count: 'exact', head: true })
          .eq('user_id', currentUser.id).eq('status', 'pendente')
          .gte('prazo', hoje.toISOString().slice(0,10))
          .lte('prazo', semanaFim.toISOString().slice(0,10)),
        sb.from('agenda_tarefas').select('*', { count: 'exact', head: true })
          .eq('user_id', currentUser.id).eq('status', 'pendente')
          .lt('prazo', hoje.toISOString().slice(0,10)),
        sb.from('clientes').select('*', { count: 'exact', head: true })
          .eq('user_id', currentUser.id),
        sb.from('documentos_fiscais').select('*', { count: 'exact', head: true })
          .eq('user_id', currentUser.id).eq('tipo', 'darf')
          .gte('criado_em', mesIni).lte('criado_em', mesFim),
      ]);

    document.getElementById('kpiTarefas').textContent  = cTarefas  ?? '—';
    document.getElementById('kpiVencidos').textContent = cVencidos  ?? '—';
    document.getElementById('kpiClientes').textContent = cClientes  ?? '—';
    document.getElementById('kpiDarfs').textContent    = cDarfs     ?? '—';

    dashboard.style.display = 'block';
    if (window.lucide) lucide.createIcons();
  } catch(e) {
    console.error('KPI error:', e);
  }
}

function verificarConviteURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('convite');
  if (!token) return;
  params.delete('convite');
  const novaUrl = [window.location.pathname, params.toString()].filter(Boolean).join('?');
  history.replaceState({}, '', novaUrl);
  showToast('Para entrar em um escritório, solicite ao administrador que te adicione diretamente.', 'info', 5000);
}

function updateChatTitle(title) {
  document.title = title ? `${title} — Fiscal365` : 'Fiscal365';
}

// Fechar modais com ESC (segundo listener — cobre modais não listados acima)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const closers = [
    () => { const m = document.getElementById('toolsMenu');         if (m?.style.display === 'block' && typeof closeDropdowns === 'function') closeDropdowns(); },
    () => { const m = document.getElementById('confirmModal');      if (m?.style.display !== 'none') closeConfirm(false); },
    () => { const m = document.getElementById('clientModal');       if (!m?.classList.contains('hidden') && typeof closeClientModal === 'function') closeClientModal(); },
    () => { const m = document.getElementById('empresaPerfilModal');if (m?.style.display !== 'none' && typeof closeEmpresaPerfil === 'function') closeEmpresaPerfil(); },
    () => { const m = document.getElementById('spedModal');         if (m?.style.display !== 'none' && typeof closeSped === 'function') closeSped(); },
    () => { const m = document.getElementById('docModal');          if (m?.style.display !== 'none' && typeof closeDocumentos === 'function') closeDocumentos(); },
    () => { const m = document.getElementById('profileModal');      if (m?.style.display !== 'none' && typeof closeProfile === 'function') closeProfile(); },
    () => { const m = document.getElementById('permissoesModal');   if (m?.style.display !== 'none' && typeof fecharPermissoesModal === 'function') fecharPermissoesModal(); },
    () => { const m = document.getElementById('convitesModal');     if (m?.style.display !== 'none' && typeof fecharConvites === 'function') fecharConvites(); },
    () => { const m = document.getElementById('agendaModal');       if (m?.style.display !== 'none' && typeof closeAgenda === 'function') closeAgenda(); },
    () => { const m = document.getElementById('finModal');          if (m?.style.display !== 'none' && typeof closeFinanceiro === 'function') closeFinanceiro(); },
    () => { const m = document.getElementById('folhaModal');        if (m?.style.display !== 'none' && typeof closeFolha === 'function') closeFolha(); },
    () => { const m = document.getElementById('pcModal');           if (m?.style.display !== 'none' && typeof closePlanoConta === 'function') closePlanoConta(); },
    () => { const m = document.getElementById('lcModal');           if (m?.style.display !== 'none' && typeof closeLancamentosContabeis === 'function') closeLancamentosContabeis(); },
    () => { const m = document.getElementById('balModal');          if (m?.style.display !== 'none' && typeof closeBalancete === 'function') closeBalancete(); },
    () => { const m = document.getElementById('dreModal');          if (m?.style.display !== 'none' && typeof closeDRE === 'function') closeDRE(); },
    () => { const m = document.getElementById('concModal');         if (m?.style.display !== 'none' && typeof closeConciliacao === 'function') closeConciliacao(); },
    () => { const m = document.getElementById('apurModal');         if (m?.style.display !== 'none' && typeof closeApuracao === 'function') closeApuracao(); },
    () => { const m = document.getElementById('honPagoModal');      if (m?.style.display !== 'none' && typeof honPagoFechar === 'function') honPagoFechar(); },
    () => { const m = document.getElementById('honModal');          if (m?.style.display !== 'none' && typeof closeHonorarios === 'function') closeHonorarios(); },
    () => { const m = document.getElementById('portalAdminModal');  if (m?.style.display !== 'none' && typeof fecharPortalAdmin === 'function') fecharPortalAdmin(); },
    () => { const m = document.getElementById('calcModal');         if (m?.style.display !== 'none') m.style.display = 'none'; },
    () => { const m = document.getElementById('statsModal');        if (m?.style.display !== 'none') m.style.display = 'none'; },
    () => { const m = document.getElementById('learningStatsModal');if (m?.style.display !== 'none') m.style.display = 'none'; },
    () => { const m = document.getElementById('shareModal');        if (m?.style.display !== 'none') m.style.display = 'none'; },
  ];
  closers.forEach(fn => { try { fn(); } catch {} });
});

// ── Dashboard Master ─────────────────────────────────────────
async function carregarDashboardMaster() {
  if (!isMaster()) return;
  const el = document.getElementById('dashboardMaster');
  if (!el) return;
  el.style.display = 'block';
  const kpi = document.getElementById('kpiDashboard');
  if (kpi) kpi.style.display = 'block';

  try {
    const hoje = new Date();
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
    const mesFim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);

    const { data: escData } = await sb.from('escritorios').select('id')
      .eq('owner_id', currentUser.id).limit(1);
    const escId = escData?.[0]?.id || null;

    let membrosIds = [currentUser.id];
    if (escId) {
      const { data: membros } = await sb.from('escritorio_usuarios')
        .select('user_id').eq('escritorio_id', escId);
      if (membros?.length) membrosIds = membros.map(m => m.user_id);
    }

    const [
      { data: usuariosData },
      { count: cUploads },
      { count: cFuncionarios },
      { data: honorariosData },
      { data: clientesData },
    ] = await Promise.all([
      supabaseProxy('listar_logins', {}).then(r => ({ data: r?.logins || [] })),
      sb.from('portal_uploads').select('*', { count: 'exact', head: true })
        .in('user_id', membrosIds).eq('lido', false),
      sb.from('dp_funcionarios').select('*', { count: 'exact', head: true })
        .in('user_id', membrosIds).eq('status', 'ativo'),
      sb.from('lancamentos').select('valor')
        .in('user_id', membrosIds)
        .eq('tipo', 'receita').eq('status', 'pago')
        .gte('data_pgto', mesIni).lte('data_pgto', mesFim),
      sb.from('clientes').select('regime_tributario')
        .in('user_id', membrosIds),
    ]);

    const contadores = (usuariosData || []).filter(u => u.role !== 'master');
    const elC = document.getElementById('dmContadores');
    if (elC) elC.textContent = contadores.length;

    const elU = document.getElementById('dmUploadsNaoLidos');
    if (elU) elU.textContent = cUploads ?? '—';

    const elF = document.getElementById('dmFuncionarios');
    if (elF) elF.textContent = cFuncionarios ?? '—';

    const totalHon = (honorariosData || []).reduce((s, l) => s + (+l.valor||0), 0);
    const elH = document.getElementById('dmHonorarios');
    if (elH) elH.textContent = totalHon > 0
      ? 'R$ ' + totalHon.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : 'R$ 0';

    const regimes = {};
    (clientesData || []).forEach(c => {
      const r = c.regime_tributario || 'Não definido';
      regimes[r] = (regimes[r] || 0) + 1;
    });
    const corRegime = {
      'MEI': '#7c3aed', 'Simples Nacional': '#2563eb',
      'Lucro Presumido': '#d97706', 'Lucro Real': '#dc2626',
    };
    const elR = document.getElementById('dmRegimes');
    if (elR) {
      elR.innerHTML = Object.entries(regimes)
        .sort((a,b) => b[1]-a[1])
        .map(([r, n]) => {
          const cor = corRegime[r] || '#64748b';
          return `<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:${cor}18;color:${cor};font-weight:600">${r}: ${n}</span>`;
        }).join('');
    }
    if (window.lucide) lucide.createIcons();
  } catch(e) {
    console.error('dashboardMaster:', e);
  }
}

// ── Polling: arquivos recebidos não lidos ────────────────────
let _pollingUploadTimer  = null;
let _pollingUploadUltimoCount = -1;

async function iniciarPollingUploads() {
  if (_pollingUploadTimer) return;
  await _checkUploadsNaoLidos();
  _pollingUploadTimer = setInterval(_checkUploadsNaoLidos, 5 * 60 * 1000);
}

async function _checkUploadsNaoLidos() {
  if (!currentUser) return;
  try {
    const { count } = await sb
      .from('portal_uploads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('lido', false);

    const badge = document.getElementById('portalBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    if (_pollingUploadUltimoCount >= 0 && count > _pollingUploadUltimoCount) {
      const novos = count - _pollingUploadUltimoCount;
      showToast(`📥 ${novos} novo${novos > 1 ? 's arquivos recebidos' : ' arquivo recebido'} no portal`, 'info');
    }
    _pollingUploadUltimoCount = count ?? 0;
  } catch(e) {
    // silencioso — polling não deve quebrar UI
  }
}
