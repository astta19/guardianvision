// api/recaptcha-verify.js — Vercel Serverless
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token ausente' });

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.warn('RECAPTCHA_SECRET_KEY não configurada — verificação ignorada');
    return res.status(200).json({ ok: true, score: 1, dev: true });
  }

  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    const data = await r.json();
    const ok = data.success && (data.score ?? 1) >= 0.5;
    return res.status(200).json({
      ok,
      score: data.score,
      action: data.action,
      error: ok ? null : `Score insuficiente: ${data.score}`,
    });
  } catch (e) {
    console.error('reCAPTCHA verify error:', e.message);
    // Falha na verificação não bloqueia o login
    return res.status(200).json({ ok: true, score: null, error: e.message });
  }
}
