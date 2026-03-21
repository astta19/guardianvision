// ============================================================
// ERROR_LOGGER.JS — Centralização de erros com Sentry
// Sentry plano free: 5.000 erros/mês — mais que suficiente
// Setup: criar projeto em sentry.io → copiar DSN → adicionar à env da Vercel
// ============================================================

// ── Config ───────────────────────────────────────────────────
// DSN disponível após criar projeto em https://sentry.io (gratuito)
// Adicionar SENTRY_DSN nas Environment Variables da Vercel
// No frontend, o DSN é público (projetado para isso)
const SENTRY_DSN = window.__SENTRY_DSN__ || null; // injetado pelo backend ou null

// Nível mínimo para enviar ao Sentry ('error' | 'warn' | 'info')
const LOG_LEVEL = 'error';

// ── Estado ───────────────────────────────────────────────────
let _logReady    = false;
let _logQueue    = []; // fila antes do Sentry carregar
let _logCtx      = {}; // contexto atual do usuário

// ── Init ──────────────────────────────────────────────────────
function logInit(user) {
  _logCtx = {
    id:    user?.id    || 'anon',
    email: user?.email || 'anon',
    role:  user?.user_metadata?.role || 'unknown',
  };

  if (!SENTRY_DSN) {
    // Sem DSN configurado — só console (dev mode)
    _logReady = true;
    _logQueue.forEach(([lvl, msg, extra]) => _logLocal(lvl, msg, extra));
    _logQueue = [];
    return;
  }

  // Carregar SDK Sentry dinamicamente (não bloqueia o carregamento da página)
  if (window.Sentry) { _logSetupSentry(user); return; }

  const script = document.createElement('script');
  script.src = 'https://browser.sentry-cdn.com/7.99.0/bundle.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => _logSetupSentry(user);
  script.onerror = () => {
    // Falha ao carregar Sentry — degradar para console
    _logReady = true;
    console.warn('[log] Sentry não carregou, usando console');
    _logQueue.forEach(([lvl, msg, extra]) => _logLocal(lvl, msg, extra));
    _logQueue = [];
  };
  document.head.appendChild(script);
}

function _logSetupSentry(user) {
  try {
    Sentry.init({
      dsn:              SENTRY_DSN,
      environment:      window.location.hostname.includes('localhost') ? 'development' : 'production',
      release:          'fiscal365@1.0.0',
      tracesSampleRate: 0.1,   // 10% de traces (performance) — economiza cota
      // Ignorar erros que não são nossos
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        /^Script error/,
        /^Network Error/,
        'Load failed',
      ],
      beforeSend(event) {
        // Nunca enviar dados sensíveis
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });

    if (user?.id) {
      Sentry.setUser({ id: user.id, email: user.email });
    }
    Sentry.setTag('app', 'fiscal365');

    _logReady = true;
    _logQueue.forEach(([lvl, msg, extra]) => logCapturar(lvl, msg, extra));
    _logQueue = [];
  } catch (e) {
    console.error('[log] Erro ao inicializar Sentry:', e);
    _logReady = true;
  }
}

// ── API pública ───────────────────────────────────────────────

// Capturar erro com contexto
function logErro(erro, contexto) {
  logCapturar('error', erro, contexto);
}

// Capturar aviso
function logAviso(mensagem, contexto) {
  logCapturar('warn', mensagem, contexto);
}

// Capturar info
function logInfo(mensagem, contexto) {
  logCapturar('info', mensagem, contexto);
}

// Capturar evento de usuário (auditoria leve)
function logEvento(nome, dados) {
  try {
    if (window.Sentry && SENTRY_DSN) {
      Sentry.addBreadcrumb({
        category: 'user-action',
        message:  nome,
        data:     _logSanitizar(dados),
        level:    'info',
      });
    }
    console.info(`[evento] ${nome}`, dados);
  } catch {}
}

function logCapturar(nivel, erroOuMsg, contexto) {
  if (!_logReady) {
    _logQueue.push([nivel, erroOuMsg, contexto]);
    return;
  }

  const extra = {
    user_id:   _logCtx.id,
    modulo:    contexto?.modulo || _logDetectarModulo(),
    ...(_logSanitizar(contexto)),
  };

  _logLocal(nivel, erroOuMsg, extra);

  if (!window.Sentry || !SENTRY_DSN) return;
  if (nivel === 'info' && LOG_LEVEL !== 'info') return;
  if (nivel === 'warn' && LOG_LEVEL === 'error') return;

  try {
    Sentry.withScope(scope => {
      scope.setLevel(nivel);
      scope.setExtras(extra);
      if (_logCtx.id) scope.setUser({ id: _logCtx.id, email: _logCtx.email });

      if (erroOuMsg instanceof Error) {
        Sentry.captureException(erroOuMsg);
      } else {
        Sentry.captureMessage(String(erroOuMsg), nivel);
      }
    });
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────
function _logLocal(nivel, erroOuMsg, extra) {
  const fn = nivel === 'error' ? console.error
           : nivel === 'warn'  ? console.warn
           : console.info;
  fn(`[fiscal365:${nivel}]`, erroOuMsg, extra || '');
}

function _logDetectarModulo() {
  // Heurística: ver qual modal está aberto
  const modais = [
    ['pcModal',    'plano_contas'],
    ['lcModal',    'lancamentos'],
    ['balModal',   'balancete'],
    ['dreModal',   'dre'],
    ['concModal',  'conciliacao'],
    ['apurModal',  'apuracao'],
    ['spedModal',  'sped'],
    ['folhaModal', 'folha'],
    ['finModal',   'financeiro'],
    ['agendaModal','agenda'],
    ['honModal',   'honorarios'],
  ];
  for (const [id, nome] of modais) {
    const el = document.getElementById(id);
    if (el?.style.display !== 'none' && el?.style.display) return nome;
  }
  return 'geral';
}

function _logSanitizar(obj) {
  if (!obj) return {};
  // Nunca logar campos sensíveis
  const BLOCKED = ['senha', 'password', 'token', 'cpf', 'cnpj', 'key', 'secret', 'base64'];
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED.some(b => k.toLowerCase().includes(b))) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = '[object]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── Handler global de erros não capturados ────────────────────
window.addEventListener('error', e => {
  logCapturar('error', e.error || e.message, {
    modulo:   'global',
    filename: e.filename,
    lineno:   e.lineno,
  });
});

window.addEventListener('unhandledrejection', e => {
  logCapturar('error', e.reason || 'Unhandled Promise Rejection', {
    modulo: 'promise',
  });
});
