// api/portal.js
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ erro: 'Método não permitido' });

  const token = (req.query.token || '').trim();
  if (!token || token.length < 10)
    return res.status(400).json({ erro: 'Token ausente ou inválido' });

  // Buscar dados do portal via RPC
  let rpcRes;
  try {
    rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_buscar_por_token`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_token: token }),
    });
  } catch (err) {
    return res.status(502).json({ erro: 'Não foi possível conectar ao banco.' });
  }

  if (!rpcRes.ok) {
    const body = await rpcRes.text().catch(() => '');
    console.error('portal rpc error:', rpcRes.status, body);
    return res.status(500).json({ erro: 'Erro interno ao buscar dados do portal' });
  }

  let data;
  try {
    const raw = await rpcRes.json();
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return res.status(500).json({ erro: 'Resposta inválida do banco' });
  }

  if (data?.erro) return res.status(404).json({ erro: data.erro });

  // Buscar token_id para o upload (usando service key — sem RLS)
  try {
    const tkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_tokens?token=eq.${encodeURIComponent(token)}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await tkRes.json();
    if (rows?.[0]?.id) data.token_id = rows[0].id;
  } catch {}

  return res.status(200).json(data);
};
