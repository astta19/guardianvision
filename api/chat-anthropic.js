// api/chat-anthropic.js — versão robusta sem streaming
const MAX_PER_DAY = 50;
const counts = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Rate limit
  const uid   = req.headers['x-user-id'] || req.headers['x-forwarded-for']?.split(',')[0] || 'anon';
  const today = new Date().toISOString().slice(0, 10);
  const rk    = `${uid}:${today}`;
  const n     = (counts.get(rk) || 0) + 1;
  counts.set(rk, n);

  if (n > MAX_PER_DAY) {
    return res.status(429).json({ error: 'limite_diario', limite: MAX_PER_DAY });
  }

  try {
    const body = { ...req.body, stream: false }; // forçar sem streaming no backend

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (e) {
    return res.status(500).json({ error: 'upstream_error', message: e.message });
  }
}
