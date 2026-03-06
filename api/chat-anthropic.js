// api/chat-anthropic.js
// Limite: MAX_REQUESTS_PER_DAY por usuário (controlado por IP + user_id no header)

const MAX_REQUESTS_PER_DAY = 50; // ajuste conforme seu plano
const requestCounts = new Map();  // em memória — reseta ao fazer redeploy

function getRateKey(req) {
  const userId = req.headers['x-user-id'] || '';
  const ip     = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
  return userId || ip;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Rate limit por usuário ──────────────────────────────
  const key   = getRateKey(req);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const mapKey = `${key}:${today}`;
  const count  = (requestCounts.get(mapKey) || 0) + 1;
  requestCounts.set(mapKey, count);

  if (count > MAX_REQUESTS_PER_DAY) {
    return res.status(429).json({
      error: 'limite_diario',
      message: `Limite de ${MAX_REQUESTS_PER_DAY} mensagens por dia atingido. Tente novamente amanhã.`,
      reset: today,
    });
  }

  // ── Chamar Anthropic ────────────────────────────────────
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Adicionar info de uso no header para o frontend monitorar
    res.setHeader('X-Requests-Today', count);
    res.setHeader('X-Requests-Limit', MAX_REQUESTS_PER_DAY);

    return res.status(response.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: 'upstream_error', message: e.message });
  }
}
