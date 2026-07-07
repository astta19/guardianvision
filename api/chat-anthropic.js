// api/chat-anthropic.js — Vercel Serverless
// Proxy para Anthropic Claude API — usado pelo ai_provider.js

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada.' });
  }

  const {
    model    = 'claude-sonnet-4-20250514',
    messages,
    system,
    max_tokens = 1000,
    temperature = 0.7,
    stream = false,
  } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Campo messages é obrigatório.' });
  }

  try {
    const body = {
      model,
      max_tokens,
      temperature,
      messages,
      ...(system ? { system } : {}),
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[chat-anthropic] Anthropic error:', response.status, err);
      return res.status(response.status).json({
        error:   err?.error?.message || 'Erro na API Anthropic',
        type:    err?.error?.type || 'api_error',
        status:  response.status,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e) {
    console.error('[chat-anthropic] Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
