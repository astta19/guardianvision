// api/supabase-proxy.js — Vercel Serverless Function
// Proxy seguro para operações admin no Supabase (service key no servidor)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ACTIONS = [
  'inserir_treinamento',
  'buscar_estatisticas',
  'buscar_treinamento_count',
  'listar_usuarios',
  'listar_logins',
  'definir_permissoes',
  'buscar_permissoes',
  'buscar_base_conhecimento',
  'excluir_treinamento',
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
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }

      // Buscar todos os usuários da plataforma via Auth Admin API
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
      });
      const data = await r.json();
      const allUsers = data.users || [];

      // master: retorna TODOS — necessário para busca de usuário por e-mail ao adicionar membros
      if (userRole === 'master') {
        const usuarios = allUsers
          .filter(u => u.id !== authUser.id)
          .map(u => ({
            id: u.id,
            email: u.email,
            role: u.user_metadata?.role || 'contador',
            permissions: u.user_metadata?.permissions || [],
          }));
        return res.status(200).json({ usuarios });
      }

      // admin: retorna apenas membros do próprio escritório — filtro server-side
      const escRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
        { headers: sbHeaders }
      );
      const escData = await escRes.json();
      const escId = escData?.[0]?.id || null;

      let membrosIds = new Set();
      if (escId) {
        const memRes = await fetch(
          `${SUPABASE_URL}/rest/v1/escritorio_usuarios?escritorio_id=eq.${escId}&select=user_id`,
          { headers: sbHeaders }
        );
        const memData = await memRes.json();
        (memData || []).forEach(m => membrosIds.add(m.user_id));
      }

      const usuarios = allUsers
        .filter(u => u.id !== authUser.id && membrosIds.has(u.id))
        .map(u => ({
          id: u.id,
          email: u.email,
          role: u.user_metadata?.role || 'contador',
          permissions: u.user_metadata?.permissions || [],
        }));

      return res.status(200).json({ usuarios });
    }

    // ── listar_logins ────────────────────────────────────────────────
    if (action === 'listar_logins') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
      });
      const data = await r.json();
      const logins = (data.users || [])
        .map(u => ({
          id:             u.id,
          email:          u.email,
          role:           u.user_metadata?.role || 'contador',
          nome:           u.user_metadata?.nome || null,
          created_at:     u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          confirmed_at:   u.confirmed_at || null,
          email_confirmed: !!u.email_confirmed_at,
        }))
        .sort((a, b) => {
          if (!a.last_sign_in_at) return 1;
          if (!b.last_sign_in_at) return -1;
          return new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at);
        });
      return res.status(200).json({ logins });
    }

    // ── definir_permissoes ──────────────────────────────────────────
    if (action === 'definir_permissoes') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { userId, permissions } = payload || {};
      if (!userId || !Array.isArray(permissions)) {
        return res.status(400).json({ error: 'userId e permissions são obrigatórios' });
      }

      // Verificar se o userId alvo pertence ao escritório do admin (proteção multi-tenant)
      // master pode alterar qualquer usuário
      if (userRole !== 'master') {
        const escRes = await fetch(
          `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
          { headers: sbHeaders }
        );
        const escData = await escRes.json();
        const escId = escData?.[0]?.id || null;
        if (escId) {
          const memRes = await fetch(
            `${SUPABASE_URL}/rest/v1/escritorio_usuarios?escritorio_id=eq.${escId}&user_id=eq.${userId}&select=user_id&limit=1`,
            { headers: sbHeaders }
          );
          const memData = await memRes.json();
          if (!memData?.length) {
            return res.status(403).json({ error: 'Usuário não pertence ao seu escritório' });
          }
        }
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

    // ── buscar_usuario_por_email ────────────────────────────────────
    // Busca um único usuário por email para adicionar ao escritório
    // Retorna apenas id + email — sem dados sensíveis
    if (action === 'buscar_usuario_por_email') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      const { email } = payload || {};
      if (!email) return res.status(400).json({ error: 'email obrigatório' });

      const r = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
        { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY } }
      );
      const data = await r.json();
      const found = (data.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) return res.status(404).json({ error: 'Usuário não encontrado. Ele precisa ter feito login ao menos uma vez.' });

      return res.status(200).json({ id: found.id, email: found.email });
    }

    // ── buscar_base_conhecimento ────────────────────────────────────
    if (action === 'buscar_base_conhecimento') {
      const { userId } = payload || {};
      const uid = userId || authUser.id;
      // Contador só acessa seus próprios dados; admin acessa qualquer um
      if (uid !== authUser.id && userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const [rCount, rDocs] = await Promise.all([
        // Contar pares Q&A da base de conhecimento
        fetch(
          `${SUPABASE_URL}/rest/v1/dados_treinamento?user_id=eq.${uid}&fonte=eq.base_conhecimento&select=id`,
          { headers: { ...sbHeaders, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
        ),
        // Contar feedbacks positivos
        fetch(
          `${SUPABASE_URL}/rest/v1/interacoes_chat?user_id=eq.${uid}&feedback_usuario=gte.4&select=id`,
          { headers: { ...sbHeaders, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
        ),
      ]);

      const countBase = parseInt(rCount.headers.get('content-range')?.split('/')[1] || '0');
      const countFeedback = parseInt(rDocs.headers.get('content-range')?.split('/')[1] || '0');

      // Buscar média de feedback
      const rAvg = await fetch(
        `${SUPABASE_URL}/rest/v1/interacoes_chat?user_id=eq.${uid}&feedback_usuario=not.is.null&select=feedback_usuario&order=data_interacao.desc&limit=100`,
        { headers: sbHeaders }
      );
      const avgData = await rAvg.json().catch(() => []);
      const avgFeedback = avgData.length
        ? (avgData.reduce((s, r) => s + (r.feedback_usuario || 0), 0) / avgData.length).toFixed(1)
        : null;

      return res.status(200).json({ countBase, countFeedback, avgFeedback });
    }

    // ── excluir_treinamento ──────────────────────────────────────────
    if (action === 'excluir_treinamento') {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: 'id obrigatório' });

      // Verificar que o registro pertence ao usuário (exceto master)
      if (userRole !== 'master') {
        const check = await fetch(
          `${SUPABASE_URL}/rest/v1/dados_treinamento?id=eq.${id}&user_id=eq.${authUser.id}&select=id&limit=1`,
          { headers: sbHeaders }
        );
        const rows = await check.json().catch(() => []);
        if (!rows?.length) return res.status(403).json({ error: 'Registro não encontrado ou sem permissão' });
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento?id=eq.${id}`, {
        method: 'DELETE',
        headers: sbHeaders,
      });
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

  } catch (error) {
    console.error('supabase-proxy erro:', error);
    return res.status(502).json({ error: 'Erro interno ao processar a requisição' });
  }
}
