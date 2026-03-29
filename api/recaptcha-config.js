// api/recaptcha-config.js — Vercel Serverless
// A site key NÃO é secreta — pode ser exposta ao browser
// A secret key NUNCA é exposta (fica só no servidor)
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
  return res.status(200).json({ siteKey });
}
