// api/portal.js — Portal do cliente: valida token e retorna dados
// A RPC portal_buscar_por_token deve retornar:
// {
//   empresa:   { razao_social, cnpj, nome_fantasia, regime_tributario },
//   contador:  { nome, crc, email, cnpj_escritorio },
//   prazos:    [{ obrigacao, prazo (YYYY-MM-DD), status }],
//   documentos:[{ tipo, criado_em }]
// }

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ erro: 'Método não permitido' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('portal: variáveis de ambiente não configuradas');
    return res.status(500).json({ erro: 'Configuração do servidor incompleta' });
  }

  const token = (req.query.token || '').trim();
  if (!token || token.length < 10) {
    return res.status(400).json({ erro: 'Token ausente ou inválido' });
  }

  try {
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

    const text = await rpcRes.text();

    if (!rpcRes.ok) {
      console.error('portal rpc error:', rpcRes.status, text);
      return res.status(500).json({ erro: 'Erro interno ao buscar dados do portal' });
    }

    // Supabase RPC com retorno JSONB às vezes serializa como string dupla
    let data;
    try {
      const parsed = JSON.parse(text);
      data = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch {
      console.error('portal: resposta não é JSON válido:', text.substring(0, 200));
      return res.status(500).json({ erro: 'Resposta inválida do servidor' });
    }

    if (data?.erro) {
      return res.status(404).json({ erro: data.erro });
    }

    return res.status(200).json(data);

  } catch (e) {
    console.error('portal: exceção ao chamar Supabase:', e.message);
    return res.status(502).json({ erro: 'Não foi possível conectar ao banco de dados' });
  }
}
