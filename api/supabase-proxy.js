// api/supabase-proxy.js — Vercel Serverless Function
// Proxy seguro para operações admin no Supabase (service key no servidor)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ACTIONS = [
  'inserir_treinamento',
  'buscar_estatisticas',
  'buscar_treinamento_count',
  'listar_usuarios',
  'definir_permissoes',
  'buscar_permissoes',
  'criar_escritorio',
  'convidar_usuario',
  'listar_convites',
  'vincular_usuario_escritorio',
  'buscar_usuario_por_email',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas' });
  }

  const { action, payload, token } = req.body || {};

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Ação inválida' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  // Validar JWT do usuário
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY },
  });

  if (!authRes.ok) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const authUser = await authRes.json();
  const userRole = authUser?.user_metadata?.role || 'contador';

  const sbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  try {
    // ── inserir_treinamento ─────────────────────────────────────────
    if (action === 'inserir_treinamento') {
      const { pergunta, resposta, fonte, qualidade, user_id, cliente_id } = payload || {};
      if (!pergunta || !resposta) {
        return res.status(400).json({ error: 'Dados incompletos' });
      }
      if (user_id !== authUser.id) {
        return res.status(403).json({ error: 'user_id não corresponde' });
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          pergunta, resposta,
          fonte: fonte || 'chat_com_feedback',
          qualidade: qualidade || 5,
          user_id, cliente_id: cliente_id || null,
          data_criacao: new Date().toISOString(),
        }),
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    // ── buscar_estatisticas ─────────────────────────────────────────
    if (action === 'buscar_estatisticas') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/estatisticas_aprendizado?order=data.desc&limit=7`,
        { headers: sbHeaders }
      );
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    // ── buscar_treinamento_count ────────────────────────────────────
    if (action === 'buscar_treinamento_count') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento?select=id`, {
        headers: { ...sbHeaders, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
      });
      const count = r.headers.get('content-range')?.split('/')[1] || '0';
      return res.status(200).json({ count: parseInt(count) });
    }

    // ── listar_usuarios ─────────────────────────────────────────────
    if (action === 'listar_usuarios') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }

      // Buscar escritório do admin (onde ele é owner)
      const escRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
        { headers: sbHeaders }
      );
      const escData = await escRes.json();
      const escritorioId = escData?.[0]?.id;

      if (!escritorioId) {
        // Admin ainda sem escritório — retorna só ele mesmo (nenhum outro)
        return res.status(200).json({ usuarios: [], escritorio_id: null });
      }

      // Buscar membros do escritório via RPC segura
      const membrosRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/listar_usuarios_escritorio`,
        {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({ p_escritorio_id: escritorioId }),
        }
      );
      const membros = await membrosRes.json();
      const usuarios = (Array.isArray(membros) ? membros : [])
        .filter(u => u.user_id !== authUser.id)
        .map(u => ({
          id: u.user_id,
          email: u.email,
          role: u.role || 'contador',
          permissions: u.permissions || [],
        }));

      return res.status(200).json({ usuarios, escritorio_id: escritorioId });
    }

    // ── definir_permissoes ──────────────────────────────────────────
    if (action === 'definir_permissoes') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { userId, permissions } = payload || {};
      if (!userId || !Array.isArray(permissions)) {
        return res.status(400).json({ error: 'userId e permissions são obrigatórios' });
      }

      // 1. Buscar user_metadata atual para MERGE (não sobrescrever role/theme/nome)
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
      });
      if (!userRes.ok) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
      const userData = await userRes.json();
      const existingMeta = userData.user_metadata || {};

      // 2. Atualizar auth.users com MERGE do user_metadata
      const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_metadata: { ...existingMeta, permissions } }),
      });
      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        return res.status(updateRes.status).json({
          error: err.message || 'Falha ao atualizar user_metadata',
        });
      }

      // 3. Persistir também em user_permissions (upsert)
      await fetch(`${SUPABASE_URL}/rest/v1/user_permissions`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, permissions, updated_at: new Date().toISOString() }),
      });

      const updatedUser = await updateRes.json().catch(() => ({}));
      return res.status(200).json({ ok: true, user_metadata: updatedUser.user_metadata });
    }

    // ── buscar_permissoes ───────────────────────────────────────────
    if (action === 'buscar_permissoes') {
      const targetId = payload?.userId || authUser.id;
      if (targetId !== authUser.id && userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${targetId}&select=permissions`,
        { headers: sbHeaders }
      );
      const data = await r.json();
      const permissions = data?.[0]?.permissions || [];
      return res.status(200).json({ permissions });
    }

    // ── criar_escritorio ────────────────────────────────────────────
    if (action === 'criar_escritorio') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { nome } = payload || {};
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });

      // Verificar se já tem escritório
      const existeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
        { headers: sbHeaders }
      );
      const existe = await existeRes.json();
      if (existe?.[0]?.id) {
        return res.status(200).json({ escritorio_id: existe[0].id, criado: false });
      }

      // Criar escritório
      const criRes = await fetch(`${SUPABASE_URL}/rest/v1/escritorios`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=representation' },
        body: JSON.stringify({ nome, owner_id: authUser.id }),
      });
      const escritorio = (await criRes.json())?.[0];

      // Auto-vincular o próprio admin
      await fetch(`${SUPABASE_URL}/rest/v1/escritorio_usuarios`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ escritorio_id: escritorio.id, user_id: authUser.id }),
      });

      return res.status(200).json({ escritorio_id: escritorio.id, criado: true });
    }

    // ── convidar_usuario ─────────────────────────────────────────────
    if (action === 'convidar_usuario') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { email, escritorio_id } = payload || {};
      if (!email || !escritorio_id) {
        return res.status(400).json({ error: 'email e escritorio_id são obrigatórios' });
      }

      // Confirmar que o escritório pertence ao admin
      const escRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?id=eq.${escritorio_id}&owner_id=eq.${authUser.id}&select=id`,
        { headers: sbHeaders }
      );
      const esc = await escRes.json();
      if (!esc?.[0]) return res.status(403).json({ error: 'Escritório não autorizado' });

      // Criar convite
      const convRes = await fetch(`${SUPABASE_URL}/rest/v1/convites`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=representation' },
        body: JSON.stringify({ escritorio_id, convidado_por: authUser.id, email }),
      });
      const convite = (await convRes.json())?.[0];

      return res.status(200).json({ token: convite.token, expira_em: convite.expira_em });
    }

    // ── listar_convites ──────────────────────────────────────────────
    if (action === 'listar_convites') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { escritorio_id } = payload || {};
      if (!escritorio_id) return res.status(400).json({ error: 'escritorio_id obrigatório' });

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/convites?escritorio_id=eq.${escritorio_id}&usado=eq.false&order=criado_em.desc`,
        { headers: sbHeaders }
      );
      const data = await r.json();
      return res.status(200).json({ convites: data || [] });
    }

    // ── buscar_usuario_por_email ────────────────────────────────────
    if (action === 'buscar_usuario_por_email') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { email } = payload || {};
      if (!email) return res.status(400).json({ error: 'email obrigatório' });

      const r = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=100`,
        { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
      );
      const data = await r.json();
      const found = (data.users || []).find(u => u.email === email);
      if (!found) return res.status(200).json({ user_id: null });
      return res.status(200).json({ user_id: found.id, email: found.email });
    }

    // ── vincular_usuario_escritorio ──────────────────────────────────
    if (action === 'vincular_usuario_escritorio') {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { user_id, escritorio_id } = payload || {};
      if (!user_id || !escritorio_id) {
        return res.status(400).json({ error: 'user_id e escritorio_id são obrigatórios' });
      }

      // Confirmar que o escritório pertence ao admin
      const escRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?id=eq.${escritorio_id}&owner_id=eq.${authUser.id}&select=id`,
        { headers: sbHeaders }
      );
      const esc = await escRes.json();
      if (!esc?.[0]) return res.status(403).json({ error: 'Escritório não autorizado' });

      await fetch(`${SUPABASE_URL}/rest/v1/escritorio_usuarios`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ escritorio_id, user_id }),
      });

      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('supabase-proxy erro:', error);
    return res.status(502).json({ error: 'Erro interno ao processar a requisição' });
  }
}
