// api/chat.js — Vercel Serverless Function
// Proxy para a API Groq (LLM)

const ALLOWED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada' });
  }

  const { model, messages, temperature = 0.7, max_tokens = 4000 } = req.body || {};

  if (!model || !ALLOWED_MODELS.includes(model)) {
    return res.status(400).json({ error: 'Modelo inválido' });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages inválido' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);

  } catch (error) {
    console.error('Erro ao chamar Groq:', error);
    return res.status(502).json({ error: 'Erro ao conectar com a API de IA' });
  }
}
