const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ACTIONS = [
  'inserir_treinamento',
  'buscar_estatisticas',
  'buscar_treinamento_count',
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Variáveis de ambiente não configuradas' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const { action, payload, token } = body;

  // Validar action
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ação inválida' }) };
  }

  // Validar JWT do usuário — garante que só usuários autenticados chegam aqui
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token não fornecido' }) };
  }

  // Verificar token via Supabase Auth
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });

  if (!authRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token inválido ou expirado' }) };
  }

  const authUser = await authRes.json();
  const userRole = authUser?.user_metadata?.role || 'contador';

  // Headers para todas as chamadas ao Supabase
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    // --------------------------------------------------------
    // AÇÃO: inserir_treinamento
    // Qualquer usuário autenticado pode inserir (via feedback)
    // --------------------------------------------------------
    if (action === 'inserir_treinamento') {
      const { pergunta, resposta, fonte, qualidade, user_id, cliente_id } = payload || {};

      if (!pergunta || !resposta) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados incompletos' }) };
      }

      // Garantir que user_id bate com o usuário autenticado
      if (user_id !== authUser.id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'user_id não corresponde ao usuário autenticado' }) };
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/dados_treinamento`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pergunta,
          resposta,
          fonte: fonte || 'chat_com_feedback',
          qualidade: qualidade || 5,
          user_id,
          cliente_id: cliente_id || null,
          data_criacao: new Date().toISOString()
        })
      });

      const data = await res.json();
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    // --------------------------------------------------------
    // AÇÃO: buscar_estatisticas
    // Apenas admin
    // --------------------------------------------------------
    if (action === 'buscar_estatisticas') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/estatisticas_aprendizado?order=data.desc&limit=7`,
        { headers }
      );

      const data = await res.json();
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    // --------------------------------------------------------
    // AÇÃO: buscar_treinamento_count
    // Apenas admin
    // --------------------------------------------------------
    if (action === 'buscar_treinamento_count') {
      if (userRole !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Acesso restrito a administradores' }) };
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/dados_treinamento?select=id`,
        { headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
      );

      const count = res.headers.get('content-range')?.split('/')[1] || '0';
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: parseInt(count) }) };
    }

  } catch (error) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Erro interno ao processar a requisição' }) };
  }
};
