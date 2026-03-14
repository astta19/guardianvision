// api/recaptcha-verify.js — Vercel Serverless
// Verifica token reCAPTCHA v3 no servidor (secret key nunca exposta ao client)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token ausente' });

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Se a variável não está configurada, deixar passar (ambiente de dev)
    console.warn('RECAPTCHA_SECRET_KEY não configurada — verificação ignorada');
    return res.status(200).json({ ok: true, score: 1, dev: true });
  }

  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secret}&response=${token}`,
    });
    const data = await r.json();

    // score: 0.0 (bot) → 1.0 (humano). Threshold: 0.5
    const ok = data.success && (data.score ?? 1) >= 0.5;

    return res.status(200).json({
      ok,
      score: data.score,
      action: data.action,
      error: ok ? null : `Score insuficiente: ${data.score}`,
    });
  } catch (e) {
    // Falha na verificação não deve bloquear o login — logar e deixar passar
    console.error('reCAPTCHA verify error:', e.message);
    return res.status(200).json({ ok: true, score: null, error: e.message });
  }
}
