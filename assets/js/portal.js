// api/portal.js — Portal do cliente: valida token e retorna dados
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ erro: 'Método não permitido' });

  const token = (req.query.token || '').trim();
  if (!token || token.length < 10) {
    return res.status(400).json({ erro: 'Token ausente ou inválido' });
  }

  const rpcRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/portal_buscar_por_token`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_token: token }),
    }
  );

  if (!rpcRes.ok) {
    console.error('portal rpc error:', rpcRes.status, await rpcRes.text());
    return res.status(500).json({ erro: 'Erro interno ao buscar dados do portal' });
  }

  const data = await rpcRes.json();

  if (data?.erro) {
    return res.status(404).json({ erro: data.erro });
  }

  return res.status(200).json(data);
};
