// api/embeddings.js — Gera embeddings via Voyage AI (200M tokens/mês grátis)
// Modelo: voyage-3-lite — 512 dims, rápido, supera ada-002
// Docs: https://docs.voyageai.com/docs/embeddings
const VOYAGE_URL   = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3-lite';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { texts } = req.body || {};
  if (!texts?.length) return res.status(400).json({ error: 'texts obrigatório' });

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'VOYAGE_API_KEY não configurada' });

  try {
    const r = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.detail || 'Voyage API error' });
    }

    const data = await r.json();
    // Retorna array de vetores na mesma ordem dos textos
    const embeddings = data.data?.map(d => d.embedding) || [];
    return res.status(200).json({ embeddings });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
