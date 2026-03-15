// api/chat-anthropic.js — SSE proxy com rate limit persistente no Supabase
const MAX_PER_DAY = 50;
const SB_URL      = process.env.SUPABASE_URL;
const SB_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Rate limit persistente — funciona entre instâncias serverless e deploys
async function checkRateLimit(uid) {
  if (!SB_URL || !SB_SERVICE) return { allowed: true, count: 0 };

  const today   = new Date().toISOString().slice(0, 10);
  const headers = {
    'apikey':        SB_SERVICE,
    'Authorization': `Bearer ${SB_SERVICE}`,
    'Content-Type':  'application/json',
  };

  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/incrementar_uso_diario`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_user_id: uid, p_data: today }),
    });
    if (!res.ok) return { allowed: true, count: 0 };
    const count = await res.json();
    return { allowed: count <= MAX_PER_DAY, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const uid = req.headers['x-user-id'] || req.headers['x-forwarded-for']?.split(',')[0] || 'anon';

  const { allowed, count } = await checkRateLimit(uid);
  if (!allowed) {
    return res.status(429).json({ error: 'limite_diario', limite: MAX_PER_DAY, count });
  }

  try {
    const body       = { ...req.body };
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

    if (!wantStream) {
      const data = await upstream.json();
      res.setHeader('X-Requests-Today', count);
      res.setHeader('X-Requests-Max',   MAX_PER_DAY);
      return res.status(upstream.status).json(data);
    }

    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Requests-Today',  count);
    res.setHeader('X-Requests-Max',    MAX_PER_DAY);

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
