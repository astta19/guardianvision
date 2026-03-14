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
    // Se não for owner, verificar se é membro
    if (!_escIdCache) {
      const { data: mem } = await sb.from('escritorio_usuarios').select('escritorio_id')
        .eq('user_id', currentUser.id).limit(1);
      _escIdCache = mem?.[0]?.escritorio_id || null;
    }
    return _escIdCache;
  } catch { return null; }
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
      // Mensais
      'das':         { day: 20, month: 'monthly', description: 'DAS Simples Nacional',  simplesOuMei: true },
      'dctfweb':     { day: 28, month: 'monthly', description: 'DCTFWeb'                                   },
      'efd_reinf':   { day: 15, month: 'monthly', description: 'EFD-Reinf'                                 },
      'esocial':     { day: 15, month: 'monthly', description: 'eSocial (folha)'                            },
      'efd_contrib': { day: 10, month: 'monthly', description: 'EFD-Contribuições',     naoSimples: true    },
      'sped_fiscal': { day: 15, month: 'monthly', description: 'SPED Fiscal'                                },
      'dctf':        { day: 15, month: 'monthly', description: 'DCTF'                                       },
      // Anuais
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

function isMaster() {
  return currentUser?.user_metadata?.role === 'master';
}

function isAdmin() {
  // master também é admin — tem todos os poderes
  return currentUser?.user_metadata?.role === 'admin'
      || currentUser?.user_metadata?.role === 'master';
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
  // Persistir no Supabase para sobreviver entre sessões
  if (currentUser) sb.auth.updateUser({ data: { theme: next } }).catch(() => {});
}


// ── Toast notifications ───────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const colors = { success: '#22c55e', error: '#ef4444', warn: '#f59e0b', info: 'var(--accent)' };
  const toast = document.createElement('div');
  toast.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.18);opacity:0;transition:opacity .2s;white-space:nowrap;pointer-events:none;`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

function applyAdminUI() {
  const admin = isAdmin();
  const perms = currentUser?.user_metadata?.permissions || [];

  // admin-only: para admins e master
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
  // master-only: apenas para o master da plataforma
  const master = isMaster();
  document.querySelectorAll('.master-only').forEach(el => {
    el.style.display = master ? '' : 'none';
  });
  // toolsAdminSection: visível para admin e master
  const adminSection = document.getElementById('toolsAdminSection');
  if (adminSection) adminSection.style.display = admin ? '' : 'none';

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
  if (!isAdmin() && !isMaster()) return false;
  try {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    const res = await fetch('/api/supabase-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'definir_permissoes', payload: { userId, permissions }, token })
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : false;
  } catch(e) {
    console.error('definirPermissoes:', e);
    return false;
  }
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
  if (!modal) {
    // Fallback sem modal: resolve via confirm() nativo e chama callback se existir
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
    // Guardar resolve E callback para suportar ambos os padrões simultaneamente
    window._confirmResolve   = resolve;
    window._confirmCallback  = typeof onConfirm === 'function' ? onConfirm : null;
  });
}

function closeConfirm(confirmed) {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';

  // Resolver a Promise primeiro
  if (typeof window._confirmResolve === 'function') {
    window._confirmResolve(!!confirmed);
  }
  // Executar callback legado se existir e confirmado
  if (confirmed && typeof window._confirmCallback === 'function') {
    window._confirmCallback();
  }

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

  // Limpar estado de módulos que cacheiam dados do usuário
  if (typeof learningService !== 'undefined') learningService = null;
  if (_pollingUploadTimer) { clearInterval(_pollingUploadTimer); _pollingUploadTimer = null; }
  _pollingUploadUltimoCount = -1;
  if (typeof ciReset === 'function') ciReset();
  if (typeof escritorioReset === 'function') escritorioReset();
  if (typeof EmpresaContext !== 'undefined') EmpresaContext.invalidar();
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
  // Buscar permissões atualizadas da tabela (sem depender só do JWT)
  if (currentUser && !isAdmin()) {
    try {
      const r = await supabaseProxy('buscar_permissoes', { userId: currentUser.id });
      if (r?.permissions && Array.isArray(r.permissions)) {
        // Mesclar no objeto currentUser para applyAdminUI usar
        if (!currentUser.user_metadata) currentUser.user_metadata = {};
        currentUser.user_metadata.permissions = r.permissions;
      }
    } catch(e) {} // silencioso — fallback para user_metadata do JWT
  }
  applyAdminUI();
  checkConnection();
  // Carregar perfil ANTES dos módulos que dependem de perfilCache (nome, CRC, avatar)
  if (typeof carregarPerfil === 'function') {
    await carregarPerfil();
    if (typeof atualizarNomeHeader === 'function') atualizarNomeHeader();
  }
  // Chat interno: inicializar para admin e contadores com permissão
  if (typeof ciInit === 'function') ciInit();
  if (typeof loadClientes === 'function') loadClientes();
  if (typeof checkDeadlines === 'function') checkDeadlines();
  carregarKPIs();
  iniciarPollingUploads();
  if (isMaster()) carregarDashboardMaster();
  if (window.lucide) lucide.createIcons();
  // Carregar chat compartilhado via link (?shared=TOKEN)
  const _sharedToken = new URLSearchParams(window.location.search).get('shared');
  if (_sharedToken) carregarChatCompartilhado(_sharedToken);
}

// --- Audit log ---
async function registrarAuditLog(acao, tabelaOuDetalhes, id, detalhes) {
  // Aceita (acao, detalhes) ou (acao, tabela, id, detalhes)
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
      // Processar convite na URL se existir
      if (typeof verificarConviteURL === 'function') verificarConviteURL();
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

// Atualizar título da aba com o nome do chat
// Stub: sistema de convites por URL foi substituído pelo modal de gestão de escritório
function verificarConviteURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('convite');
  if (!token) return;
  // Remover parâmetro da URL sem recarregar
  params.delete('convite');
  const novaUrl = [window.location.pathname, params.toString()].filter(Boolean).join('?');
  history.replaceState({}, '', novaUrl);
  // Avisar que o fluxo de convite mudou
  showToast('Para entrar em um escritório, solicite ao administrador que te adicione diretamente.', 'info', 5000);
}

function updateChatTitle(title) {
  document.title = title ? `${title} — Fiscal365` : 'Fiscal365';
}

// Fechar modais com ESC
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const closers = [
    // Dropdowns — fecham primeiro, antes de qualquer modal
    () => { const m = document.getElementById('toolsMenu'); if (m?.style.display === 'block' && typeof closeDropdowns === 'function') closeDropdowns(); },
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
    () => { const m = document.getElementById('honPagoModal');       if (m?.style.display !== 'none' && typeof honPagoFechar === 'function') honPagoFechar(); },
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
  // Garantir que o container pai (kpiDashboard) também esteja visível
  const kpi = document.getElementById('kpiDashboard');
  if (kpi) kpi.style.display = 'block';

  try {
    const hoje = new Date();
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
    const mesFim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);

    // Buscar membros do escritório do master para isolar as queries
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
      // contadores via proxy
      supabaseProxy('listar_logins', {}).then(r => ({ data: r?.logins || [] })),
      // uploads não lidos — apenas dos membros do escritório
      sb.from('portal_uploads').select('*', { count: 'exact', head: true })
        .in('user_id', membrosIds).eq('lido', false),
      // funcionários ativos — apenas dos membros do escritório
      sb.from('dp_funcionarios').select('*', { count: 'exact', head: true })
        .in('user_id', membrosIds).eq('status', 'ativo'),
      // honorários recebidos no mês — apenas dos membros do escritório
      sb.from('lancamentos').select('valor')
        .in('user_id', membrosIds)
        .eq('tipo', 'receita').eq('status', 'pago')
        .gte('data_pgto', mesIni).lte('data_pgto', mesFim),
      // clientes por regime — apenas dos membros do escritório
      sb.from('clientes').select('regime_tributario')
        .in('user_id', membrosIds),
    ]);

    // Contadores (exclui master)
    const contadores = (usuariosData || []).filter(u => u.role !== 'master');
    const elC = document.getElementById('dmContadores');
    if (elC) elC.textContent = contadores.length;

    // Arquivos não lidos
    const elU = document.getElementById('dmUploadsNaoLidos');
    if (elU) elU.textContent = cUploads ?? '—';

    // Funcionários ativos
    const elF = document.getElementById('dmFuncionarios');
    if (elF) elF.textContent = cFuncionarios ?? '—';

    // Honorários do mês
    const totalHon = (honorariosData || []).reduce((s, l) => s + (+l.valor||0), 0);
    const elH = document.getElementById('dmHonorarios');
    if (elH) elH.textContent = totalHon > 0
      ? 'R$ ' + totalHon.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : 'R$ 0';

    // Breakdown por regime
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
          return `<span style="font-size:11px;padding:3px 10px;border-radius:10px;
            background:${cor}18;color:${cor};font-weight:600">${r}: ${n}</span>`;
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
  if (_pollingUploadTimer) return; // já rodando
  await _checkUploadsNaoLidos();
  _pollingUploadTimer = setInterval(_checkUploadsNaoLidos, 5 * 60 * 1000); // 5 min
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

    // Toast apenas quando o número aumenta (novo arquivo chegou)
    if (_pollingUploadUltimoCount >= 0 && count > _pollingUploadUltimoCount) {
      const novos = count - _pollingUploadUltimoCount;
      showToast(`📥 ${novos} novo${novos > 1 ? 's arquivos recebidos' : ' arquivo recebido'} no portal`, 'info');
    }
    _pollingUploadUltimoCount = count ?? 0;
  } catch(e) {
    // silencioso — polling não deve quebrar UI
  }
}
