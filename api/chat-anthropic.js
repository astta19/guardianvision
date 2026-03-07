// api/chat-anthropic.js — com streaming SSE
const MAX_PER_DAY = 50;
const counts = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const uid   = req.headers['x-user-id'] || req.headers['x-forwarded-for']?.split(',')[0] || 'anon';
  const today = new Date().toISOString().slice(0, 10);
  const rk    = `${uid}:${today}`;
  const n     = (counts.get(rk) || 0) + 1;
  counts.set(rk, n);

  if (n > MAX_PER_DAY) {
    return res.status(429).json({ error: 'limite_diario', limite: MAX_PER_DAY });
  }

  try {
    const body = { ...req.body };

    // Se o cliente pediu stream, fazer proxy SSE
    // Senão (ex: tools), retornar JSON normal
    const wantStream = body.stream === true;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify(body),
    });

    // ── JSON (sem streaming) ──────────────────────────────
    if (!wantStream) {
      const data = await upstream.json();
      res.setHeader('X-Requests-Today', n);
      return res.status(upstream.status).json(data);
    }

    // ── SSE proxy ─────────────────────────────────────────
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Requests-Today',  n);

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`);
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

  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'upstream_error', message: e.message });
    } else {
      res.end();
    }
  }
}
