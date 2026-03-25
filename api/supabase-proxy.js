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
  'salvar_acessos_cliente',
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

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
    headers: { 
      'Authorization': `Bearer ${token}`, 
      'apikey': SUPABASE_SERVICE_KEY
    },
  });

  if (!authRes.ok) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const authUser = await authRes.json();
  const userRole = authUser?.user_metadata?.role || 'contador';

  const getSbHeaders = (options = {}) => ({
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...options,
  });

  try {
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
        headers: getSbHeaders(),
        body: JSON.stringify({
          pergunta, resposta,
          fonte: fonte || 'chat_com_feedback',
          qualidade: qualidade || 5,
          user_id, cliente_id: cliente_id || null,
          data_criacao: new Date().toISOString(),
        }),
      });
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.message || 'Erro ao inserir' });
      }
      
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === 'buscar_estatisticas') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/estatisticas_aprendizado?order=data.desc&limit=7`,
        { headers: getSbHeaders() }
      );
      
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    if (action === 'buscar_treinamento_count') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      
      const r = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento?select=id`, {
        headers: { ...getSbHeaders(), 'Prefer': 'count=exact' },
      });
      
      const count = r.headers.get('content-range')?.split('/')[1] || '0';
      return res.status(200).json({ count: parseInt(count) });
    }

    if (action === 'listar_usuarios') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }

      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
      });
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.message || 'Erro ao buscar usuários' });
      }
      
      const data = await r.json();
      const allUsers = data.users || [];

      if (userRole === 'master') {
        const usuarios = allUsers
          .filter(u => u.id !== authUser.id)
          .map(u => ({
            id: u.id,
            email: u.email,
            role: u.user_metadata?.role || 'contador',
            permissions: u.user_metadata?.permissions || [],
            nome: u.user_metadata?.nome || null,
          }));
        return res.status(200).json({ usuarios });
      }

      const escRes = await fetch(
        `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
        { headers: getSbHeaders() }
      );
      const escData = await escRes.json();
      const escId = escData?.[0]?.id || null;

      let membrosIds = new Set([authUser.id]);
      if (escId) {
        const memRes = await fetch(
          `${SUPABASE_URL}/rest/v1/escritorio_usuarios?escritorio_id=eq.${escId}&select=user_id`,
          { headers: getSbHeaders() }
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
          nome: u.user_metadata?.nome || null,
        }));

      return res.status(200).json({ usuarios });
    }

    if (action === 'listar_logins') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
      });
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.message || 'Erro ao buscar logins' });
      }
      
      const data = await r.json();
      const logins = (data.users || [])
        .map(u => ({
          id: u.id,
          email: u.email,
          role: u.user_metadata?.role || 'contador',
          nome: u.user_metadata?.nome || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          confirmed_at: u.confirmed_at || null,
          email_confirmed: !!u.email_confirmed_at,
        }))
        .sort((a, b) => {
          if (!a.last_sign_in_at) return 1;
          if (!b.last_sign_in_at) return -1;
          return new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at);
        });
      
      return res.status(200).json({ logins });
    }

    if (action === 'salvar_acessos_cliente') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      
      const { clienteId, selecionados, desmarcados } = payload || {};
      if (!clienteId) {
        return res.status(400).json({ error: 'clienteId é obrigatório' });
      }

      if (userRole !== 'master') {
        const clRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&user_id=eq.${authUser.id}&select=id&limit=1`,
          { headers: getSbHeaders() }
        );
        const clData = await clRes.json();
        if (!clData?.length) {
          return res.status(403).json({ error: 'Cliente não pertence ao seu escritório' });
        }
      }

      if (Array.isArray(desmarcados) && desmarcados.length) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_usuarios?cliente_id=eq.${clienteId}&user_id=in.(${desmarcados.join(',')})`,
          { method: 'DELETE', headers: getSbHeaders() }
        );
      }

      if (Array.isArray(selecionados) && selecionados.length) {
        const vinculos = selecionados.map(uid => ({
          cliente_id: clienteId,
          user_id: uid,
          criado_por: authUser.id,
        }));
        
        const insRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_usuarios?on_conflict=cliente_id,user_id`,
          {
            method: 'POST',
            headers: getSbHeaders({ 'Prefer': 'resolution=ignore-duplicates,return=minimal' }),
            body: JSON.stringify(vinculos),
          }
        );
        
        if (!insRes.ok) {
          const err = await insRes.json().catch(() => ({}));
          return res.status(insRes.status).json({ error: err.message || 'Erro ao inserir vínculos' });
        }
      }

      return res.status(200).json({ ok: true });
    }

    if (action === 'definir_permissoes') {
      if (userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
      }
      
      const { userId, permissions } = payload || {};
      if (!userId || !Array.isArray(permissions)) {
        return res.status(400).json({ error: 'userId e permissions são obrigatórios' });
      }

      if (userRole !== 'master') {
        const escRes = await fetch(
          `${SUPABASE_URL}/rest/v1/escritorios?owner_id=eq.${authUser.id}&select=id&limit=1`,
          { headers: getSbHeaders() }
        );
        const escData = await escRes.json();
        const escId = escData?.[0]?.id || null;
        
        if (escId) {
          const memRes = await fetch(
            `${SUPABASE_URL}/rest/v1/escritorio_usuarios?escritorio_id=eq.${escId}&user_id=eq.${userId}&select=user_id&limit=1`,
            { headers: getSbHeaders() }
          );
          const memData = await memRes.json();
          if (!memData?.length) {
            return res.status(403).json({ error: 'Usuário não pertence ao seu escritório' });
          }
        }
      }

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

      await fetch(`${SUPABASE_URL}/rest/v1/user_permissions`, {
        method: 'POST',
        headers: getSbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ user_id: userId, permissions, updated_at: new Date().toISOString() }),
      });

      const updatedUser = await updateRes.json().catch(() => ({}));
      return res.status(200).json({ ok: true, user_metadata: updatedUser.user_metadata });
    }

    if (action === 'buscar_permissoes') {
      const targetId = payload?.userId || authUser.id;
      if (targetId !== authUser.id && userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${targetId}&select=permissions`,
        { headers: getSbHeaders() }
      );
      
      const data = await r.json();
      const permissions = data?.[0]?.permissions || [];
      return res.status(200).json({ permissions });
    }

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
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.message || 'Erro ao buscar usuários' });
      }
      
      const data = await r.json();
      const found = (data.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());
      
      if (!found) {
        return res.status(404).json({ error: 'Usuário não encontrado. Ele precisa ter feito login ao menos uma vez.' });
      }

      return res.status(200).json({ id: found.id, email: found.email });
    }

    if (action === 'buscar_base_conhecimento') {
      const { userId } = payload || {};
      const uid = userId || authUser.id;
      
      if (uid !== authUser.id && userRole !== 'admin' && userRole !== 'master') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const [rCount, rDocs] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/dados_treinamento?user_id=eq.${uid}&fonte=eq.base_conhecimento&select=id`,
          { headers: { ...getSbHeaders(), 'Prefer': 'count=exact' } }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/interacoes_chat?user_id=eq.${uid}&feedback_usuario=gte.4&select=id`,
          { headers: { ...getSbHeaders(), 'Prefer': 'count=exact' } }
        ),
      ]);

      const countBase = parseInt(rCount.headers.get('content-range')?.split('/')[1] || '0');
      const countFeedback = parseInt(rDocs.headers.get('content-range')?.split('/')[1] || '0');

      const rAvg = await fetch(
        `${SUPABASE_URL}/rest/v1/interacoes_chat?user_id=eq.${uid}&feedback_usuario=not.is.null&select=feedback_usuario&order=data_interacao.desc&limit=100`,
        { headers: getSbHeaders() }
      );
      const avgData = await rAvg.json().catch(() => []);
      const avgFeedback = avgData.length
        ? (avgData.reduce((s, r) => s + (r.feedback_usuario || 0), 0) / avgData.length).toFixed(1)
        : null;

      return res.status(200).json({ countBase, countFeedback, avgFeedback });
    }

    if (action === 'excluir_treinamento') {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: 'id obrigatório' });

      if (userRole !== 'master') {
        const check = await fetch(
          `${SUPABASE_URL}/rest/v1/dados_treinamento?id=eq.${id}&user_id=eq.${authUser.id}&select=id&limit=1`,
          { headers: getSbHeaders() }
        );
        const rows = await check.json().catch(() => []);
        if (!rows?.length) {
          return res.status(403).json({ error: 'Registro não encontrado ou sem permissão' });
        }
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento?id=eq.${id}`, {
        method: 'DELETE',
        headers: getSbHeaders(),
      });
      
      return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
    }

    return res.status(400).json({ error: 'Ação não implementada' });

  } catch (error) {
    return res.status(502).json({ error: 'Erro interno ao processar a requisição' });
  }
}
