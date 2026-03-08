// api/face-auth.js
// Recebe: { email, descriptor: float[] }
// Busca face_descriptor + face_senha do usuário pelo e-mail
// Compara descritores localmente e retorna face_senha se match
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const THRESHOLD            = 0.55;

function distancia(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { email, descriptor } = req.body || {};
  if (!email || !Array.isArray(descriptor) || descriptor.length !== 128)
    return res.status(400).json({ error: 'Dados inválidos' });

  // Buscar perfil pelo e-mail via auth.users + perfis_usuarios
  const q = `${SUPABASE_URL}/rest/v1/rpc/face_auth_buscar`;
  let data;
  try {
    const r = await fetch(q, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_email: email }),
    });
    data = await r.json();
  } catch(e) {
    return res.status(502).json({ error: 'Erro ao conectar ao banco' });
  }

  if (!data?.face_descriptor || !data?.face_senha)
    return res.status(404).json({ error: 'Usuário não tem login facial configurado' });

  const dist = distancia(descriptor, data.face_descriptor);
  console.log('[face-auth] distância:', dist.toFixed(4));

  if (dist > THRESHOLD)
    return res.status(401).json({ error: 'Rosto não reconhecido. Tente novamente.' });

  return res.status(200).json({ face_senha: data.face_senha });
};
