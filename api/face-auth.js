// api/face-auth.js — Luxand.cloud
// Token: via env var LUXAND_TOKEN (já configurado)
// POST multipart { action:'enroll', user_id, face_senha, photo }
// POST multipart { action:'verify', email, photo }
// POST JSON      { action:'delete', person_uuid }

const LUXAND_TOKEN = process.env.LUXAND_TOKEN;
const LUXAND_BASE  = 'https://api.luxand.cloud';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const { IncomingForm } = require('formidable');
const fs = require('fs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método não permitido' });

  const ct = req.headers['content-type'] || '';

  // ── JSON: delete ─────────────────────────────────────────────
  if (ct.includes('application/json')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { action, person_uuid } = JSON.parse(body || '{}');

    if (action === 'delete' && person_uuid) {
      await fetch(`${LUXAND_BASE}/v2/person/${person_uuid}`, {
        method: 'DELETE', headers: { token: LUXAND_TOKEN }
      });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Ação inválida' });
  }

  // ── MULTIPART ────────────────────────────────────────────────
  const form = new IncomingForm({ maxFileSize: 8 * 1024 * 1024, keepExtensions: true });
  const { fields, files } = await new Promise((resolve, reject) =>
    form.parse(req, (err, f, fi) => err ? reject(err) : resolve({ fields: f, files: fi }))
  );

  const action = _field(fields, 'action') || 'verify';
  const photo  = files.photo?.[0] || files.photo;
  if (!photo) return res.status(400).json({ error: 'Foto não enviada' });

  const photoBuffer = fs.readFileSync(photo.filepath || photo.path);

  // ── ENROLL ───────────────────────────────────────────────────
  if (action === 'enroll') {
    const userId    = _field(fields, 'user_id');
    const faceSenha = _field(fields, 'face_senha');

    const fm = new FormData();
    fm.append('name', userId);
    fm.append('store', '1');
    fm.append('photos', new Blob([photoBuffer], { type: 'image/jpeg' }), 'face.jpg');

    const r    = await fetch(`${LUXAND_BASE}/v2/person`, {
      method: 'POST', headers: { token: LUXAND_TOKEN }, body: fm
    });
    const json = await r.json();

    if (!r.ok || json.status === 'failure')
      return res.status(400).json({ error: json.message || 'Erro ao cadastrar rosto' });

    return res.status(200).json({ person_uuid: json.uuid });
  }

  // ── VERIFY ───────────────────────────────────────────────────
  const email = _field(fields, 'email');
  if (!email) return res.status(400).json({ error: 'E-mail não informado' });

  // 1. Buscar user_id pelo e-mail
  const uRes  = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&per_page=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const uData = await uRes.json();
  const userId = uData?.users?.[0]?.id;
  if (!userId) return res.status(404).json({ error: 'Usuário não encontrado' });

  // 2. Buscar person_uuid + face_senha
  const pRes  = await fetch(
    `${SUPABASE_URL}/rest/v1/perfis_usuarios?user_id=eq.${userId}&select=face_descriptor,face_senha&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const pData = await pRes.json();
  const personUuid = pData?.[0]?.face_descriptor;
  const faceSenha  = pData?.[0]?.face_senha;

  if (!personUuid)
    return res.status(404).json({ error: 'Login facial não configurado para este usuário' });

  // 3. Verificar no Luxand
  const fm2 = new FormData();
  fm2.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), 'face.jpg');

  const lRes  = await fetch(`${LUXAND_BASE}/photo/verify/${personUuid}`, {
    method: 'POST', headers: { token: LUXAND_TOKEN }, body: fm2
  });
  const lJson = await lRes.json();

  if (!lRes.ok)
    return res.status(400).json({ error: lJson?.message || 'Erro na verificação' });

  const prob = lJson.probability ?? lJson.confidence ?? 0;
  if (prob < 0.70)
    return res.status(401).json({ error: `Rosto não reconhecido (${Math.round(prob * 100)}% de similaridade)` });

  return res.status(200).json({ face_senha: faceSenha });
};

function _field(fields, key) {
  const v = fields[key];
  return Array.isArray(v) ? v[0] : v;
}
