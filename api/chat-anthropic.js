// api/chat-anthropic.js
const MAX_PER_DAY = 50;
const counts = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const uid   = req.headers['x-user-id'] || req.headers['x-forwarded-for'] || 'anon';
  const today = new Date().toISOString().slice(0, 10);
  const rk    = uid + ':' + today;
  const n     = (counts.get(rk) || 0) + 1;
  counts.set(rk, n);

  if (n > MAX_PER_DAY) {
    return res.status(429).json({ error: 'limite_diario', limite: MAX_PER_DAY });
  }

  res.setHeader('X-Requests-Today', n);
  res.setHeader('X-Requests-Limit', MAX_PER_DAY);

  const body = { ...req.body };
  const wantsStream = body.stream !== false;

  const headers = {
    'x-api-key':         process.env.ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta':    'prompt-caching-2024-07-31',
    'content-type':      'application/json',
  };

  body.stream = wantsStream;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });

  // Não-streaming: devolver JSON direto
  if (!wantsStream) {
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  }

  // Streaming: proxy SSE
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    res.write('data: ' + JSON.stringify({ type: 'error', error: err }) + '\n\n');
    res.end();
    return;
  }

  const reader  = upstream.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    res.end();
  }
}
