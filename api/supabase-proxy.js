// api/supabase-proxy.js — Fiscal365
// Actions disponíveis:
//   listar_usuarios, definir_permissoes, buscar_permissoes,
//   criar_convite, listar_convites, revogar_convite,
//   definir_role, definir_status_usuario, verificar_acesso

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, args, serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function adminApi(path, method = 'GET', body = null, serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Validar token JWT do usuário solicitante
async function getCallerUser(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function isAdmin(user) {
  return user?.user_metadata?.role === 'admin';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método não permitido' });

  const { action, payload = {}, token } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action obrigatória' });
  if (!token)  return res.status(401).json({ error: 'Token ausente' });

  const caller = await getCallerUser(token);
  if (!caller)  return res.status(401).json({ error: 'Token inválido' });

  try {
    // ── buscar_permissoes — qualquer usuário logado ────────────
    if (action === 'buscar_permissoes') {
      const { data } = await adminApi(`users/${caller.id}`, 'GET', null, SUPABASE_SERVICE_KEY);
      return res.json({
        permissions: data?.user_metadata?.permissions || [],
        role:        data?.user_metadata?.role || 'contador',
        status:      data?.user_metadata?.status || 'ativo',
      });
    }

    // ── verificar_acesso — chama RPC para checar status ────────
    if (action === 'verificar_acesso') {
      const r = await rpc('verificar_acesso', { p_user_id: caller.id }, SUPABASE_SERVICE_KEY);
      return res.json(r.data);
    }

    // ── usar_convite — qualquer usuário logado ─────────────────
    if (action === 'usar_convite') {
      const { token: conviteToken } = payload;
      if (!conviteToken) return res.status(400).json({ ok: false, erro: 'Token de convite ausente.' });
      const r = await rpc('usar_convite', { p_token: conviteToken, p_user_id: caller.id }, SUPABASE_SERVICE_KEY);
      return res.json(r.data);
    }

    // ── APENAS ADMINS a partir daqui ───────────────────────────
    if (!isAdmin(caller)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // ── listar_usuarios ────────────────────────────────────────
    if (action === 'listar_usuarios') {
      const r = await adminApi('users?per_page=200', 'GET', null, SUPABASE_SERVICE_KEY);
      const usuarios = (r.data?.users || []).map(u => ({
        id:          u.id,
        email:       u.email,
        nome:        u.user_metadata?.full_name || u.user_metadata?.name || '',
        role:        u.user_metadata?.role || 'contador',
        permissions: u.user_metadata?.permissions || [],
        status:      u.user_metadata?.status || 'ativo',
        created_at:  u.created_at,
        last_sign_in: u.last_sign_in_at,
      }));
      return res.json({ usuarios });
    }

    // ── definir_permissoes ─────────────────────────────────────
    if (action === 'definir_permissoes') {
      const { userId, permissions } = payload;
      if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
      const r = await adminApi(`users/${userId}`, 'PUT', {
        user_metadata: { permissions }
      }, SUPABASE_SERVICE_KEY);
      return res.json(r.ok ? { ok: true } : { error: r.data?.message || 'Erro' });
    }

    // ── definir_role ───────────────────────────────────────────
    if (action === 'definir_role') {
      const { userId, role } = payload;
      if (!userId || !['admin','contador'].includes(role))
        return res.status(400).json({ error: 'userId e role (admin|contador) obrigatórios' });
      const r = await rpc('definir_role', {
        p_admin_id: caller.id, p_user_id: userId, p_role: role
      }, SUPABASE_SERVICE_KEY);
      return res.json(r.data);
    }

    // ── definir_status_usuario ─────────────────────────────────
    if (action === 'definir_status_usuario') {
      const { userId, status } = payload;
      if (!userId || !['ativo','bloqueado'].includes(status))
        return res.status(400).json({ error: 'userId e status (ativo|bloqueado) obrigatórios' });
      const r = await rpc('definir_status_usuario', {
        p_admin_id: caller.id, p_user_id: userId, p_status: status
      }, SUPABASE_SERVICE_KEY);
      return res.json(r.data);
    }

    // ── criar_convite ──────────────────────────────────────────
    if (action === 'criar_convite') {
      const { role = 'contador', email = null, dias = 7 } = payload;
      const r = await rpc('criar_convite', {
        p_criado_por: caller.id, p_role: role, p_email: email, p_dias: dias
      }, SUPABASE_SERVICE_KEY);
      return res.json(r.data);
    }

    // ── listar_convites ────────────────────────────────────────
    if (action === 'listar_convites') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/convites?criado_por=eq.${caller.id}&order=criado_em.desc`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const data = await r.json().catch(() => []);
      return res.json({ convites: Array.isArray(data) ? data : [] });
    }

    // ── revogar_convite ────────────────────────────────────────
    if (action === 'revogar_convite') {
      const { conviteId } = payload;
      if (!conviteId) return res.status(400).json({ error: 'conviteId obrigatório' });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/convites?id=eq.${conviteId}&criado_por=eq.${caller.id}`,
        {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
        }
      );
      return res.json({ ok: r.ok });
    }

    return res.status(400).json({ error: `Action desconhecida: ${action}` });

  } catch (e) {
    console.error('supabase-proxy erro:', e);
    return res.status(500).json({ error: e.message });
  }
};
