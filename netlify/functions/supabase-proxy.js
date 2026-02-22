const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ACTIONS = [
  'inserir_treinamento',
  'buscar_estatisticas',
  'buscar_treinamento_count',
  'listar_usuarios',
  'definir_permissoes',
  'buscar_permissoes',
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Variáveis de ambiente não configuradas' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) }; }

  const { action, payload, token } = body;

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ação inválida' }) };
  }

  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token não fornecido' }) };
  }

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY }
  });

  if (!authRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token inválido ou expirado' }) };
  }

  const authUser = await authRes.json();
  const userRole = authUser?.user_metadata?.role || 'contador';

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    // ── inserir_treinamento ──────────────────────────────────────────
    if (action === 'inserir_treinamento') {
      const { pergunta, resposta, fonte, qualidade, user_id, cliente_id } = payload || {};
      if (!pergunta || !resposta) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
      }
      if (user_id !== authUser.id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'user_id não corresponde' }) };
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento`, {
        method: 'POST', headers,
        body: JSON.stringify({ pergunta, resposta, fonte: fonte || 'chat_com_feedback',
          qualidade: qualidade || 5, user_id, cliente_id: cliente_id || null,
          data_criacao: new Date().toISOString() })
      });
      const data = await res.json();
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    // ── buscar_estatisticas ──────────────────────────────────────────
    if (action === 'buscar_estatisticas') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/estatisticas_aprendizado?order=data.desc&limit=7`, { headers });
      const data = await res.json();
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    // ── buscar_treinamento_count ─────────────────────────────────────
    if (action === 'buscar_treinamento_count') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento?select=id`,
        { headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } });
      const count = res.headers.get('content-range')?.split('/')[1] || '0';
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: parseInt(count) }) };
    }

    // ── listar_usuarios ──────────────────────────────────────────────
    if (action === 'listar_usuarios') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
      });
      const data = await res.json();
      const usuarios = (data.users || [])
        .filter(u => u.id !== authUser.id)
        .map(u => ({ id: u.id, email: u.email, role: u.user_metadata?.role || 'contador',
                     permissions: u.user_metadata?.permissions || [] }));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarios }) };
    }

    // ── definir_permissoes ───────────────────────────────────────────
    if (action === 'definir_permissoes') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }
      const { userId, permissions } = payload || {};
      if (!userId || !Array.isArray(permissions)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'userId e permissions são obrigatórios' }) };
      }

      // 1. Buscar user_metadata atual para fazer MERGE (não sobrescrever role/theme/nome)
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
      });
      if (!userRes.ok) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Usuário não encontrado' }) };
      }
      const userData = await userRes.json();
      const existingMeta = userData.user_metadata || {};

      // 2. Salvar no auth.users fazendo MERGE do user_metadata
      const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_metadata: { ...existingMeta, permissions } })
      });
      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        return { statusCode: updateRes.status, body: JSON.stringify({ error: err.message || 'Falha ao atualizar user_metadata' }) };
      }

      // 3. Persistir também na tabela user_permissions (upsert)
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_permissions`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, permissions, updated_at: new Date().toISOString() })
      });

      const updatedUser = await updateRes.json().catch(() => ({}));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, user_metadata: updatedUser.user_metadata }) };
    }

    // ── buscar_permissoes ────────────────────────────────────────────
    if (action === 'buscar_permissoes') {
      // Qualquer usuário autenticado pode buscar suas próprias permissões
      const targetId = payload?.userId || authUser.id;
      // Apenas admin pode buscar permissões de outro usuário
      if (targetId !== authUser.id && userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso negado' }) };
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${targetId}&select=permissions`, {
        headers
      });
      const data = await res.json();
      const permissions = data?.[0]?.permissions || [];
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions }) };
    }

  } catch (error) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Erro interno ao processar a requisição' }) };
  }
};
