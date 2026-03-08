// api/face-auth.js — sem dependências externas
const LUXAND_TOKEN = process.env.LUXAND_TOKEN;
const LUXAND_BASE  = 'https://api.luxand.cloud';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método não permitido' });
  if (!LUXAND_TOKEN)           return res.status(500).json({ error: 'LUXAND_TOKEN não configurado' });

  const bodyBuf = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const ct = req.headers['content-type'] || '';

  // ── JSON: delete ──────────────────────────────────────────
  if (ct.includes('application/json')) {
    try {
      const { action, person_uuid } = JSON.parse(bodyBuf.toString());
      if (action === 'delete' && person_uuid) {
        await fetch(`${LUXAND_BASE}/v2/person/${person_uuid}`, {
          method: 'DELETE', headers: { token: LUXAND_TOKEN }
        });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Ação inválida' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── MULTIPART ─────────────────────────────────────────────
  const boundary = (ct.match(/boundary=([^\s;]+)/) || [])[1];
  if (!boundary) return res.status(400).json({ error: 'Content-Type multipart inválido' });

  let fields, photoBlob;
  try {
    ({ fields, photoBlob } = parseMultipart(bodyBuf, boundary));
  } catch (e) {
    return res.status(400).json({ error: 'Erro multipart: ' + e.message });
  }

  const action = fields.action || 'verify';
  if (!photoBlob) return res.status(400).json({ error: 'Foto não enviada' });

  // ── ENROLL ────────────────────────────────────────────────
  if (action === 'enroll') {
    const userId    = fields.user_id;
    const faceSenha = fields.face_senha;
    if (!userId || !faceSenha) return res.status(400).json({ error: 'user_id e face_senha obrigatórios' });

    try {
      const fm = new FormData();
      fm.append('name',   userId);
      fm.append('store',  '1');
      fm.append('photos', new Blob([photoBlob], { type: 'image/jpeg' }), 'face.jpg');

      const r    = await fetch(`${LUXAND_BASE}/v2/person`, {
        method: 'POST', headers: { token: LUXAND_TOKEN }, body: fm
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { return res.status(500).json({ error: 'Luxand: ' + text.slice(0, 120) }); }
      if (!r.ok || json.status === 'failure')
        return res.status(400).json({ error: json.message || 'Erro ao cadastrar rosto' });

      return res.status(200).json({ person_uuid: json.uuid });
    } catch (e) {
      return res.status(500).json({ error: 'Enroll: ' + e.message });
    }
  }

  // ── VERIFY ────────────────────────────────────────────────
  const email = fields.email;
  if (!email) return res.status(400).json({ error: 'E-mail não informado' });

  try {
    // Buscar face_descriptor + face_senha via admin API (join auth.users + perfis_usuarios)
    const uRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const uData = await uRes.json();
    const user  = (uData?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado: ' + email });

    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis_usuarios?user_id=eq.${user.id}&select=face_descriptor,face_senha&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const pData     = await pRes.json();
    const personUuid = pData?.[0]?.face_descriptor;
    const faceSenha  = pData?.[0]?.face_senha;

    if (!personUuid)
      return res.status(404).json({ error: 'Login facial não configurado para este usuário' });

    // Verificar no Luxand
    const fm2 = new FormData();
    fm2.append('photo', new Blob([photoBlob], { type: 'image/jpeg' }), 'face.jpg');

    const lRes  = await fetch(`${LUXAND_BASE}/photo/verify/${personUuid}`, {
      method: 'POST', headers: { token: LUXAND_TOKEN }, body: fm2
    });
    const lText = await lRes.text();
    let lJson;
    try { lJson = JSON.parse(lText); } catch { return res.status(500).json({ error: 'Luxand verify: ' + lText.slice(0, 120) }); }
    if (!lRes.ok) return res.status(400).json({ error: lJson?.message || 'Erro na verificação' });

    const prob = lJson.probability ?? lJson.confidence ?? 0;
    if (prob < 0.70)
      return res.status(401).json({ error: `Rosto não reconhecido (${Math.round(prob * 100)}%)` });

    return res.status(200).json({ face_senha: faceSenha });
  } catch (e) {
    return res.status(500).json({ error: 'Verify: ' + e.message });
  }
};

function parseMultipart(buf, boundary) {
  const sep    = Buffer.from('--' + boundary);
  const fields = {};
  let photoBlob = null;

  let pos = 0;
  while (pos < buf.length) {
    const sepIdx = buf.indexOf(sep, pos);
    if (sepIdx === -1) break;
    pos = sepIdx + sep.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;
    if (buf[pos] === 0x0d) pos += 2;

    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = buf.slice(pos, headerEnd).toString();
    pos = headerEnd + 4;

    const nextSep = buf.indexOf(sep, pos);
    const partEnd = nextSep === -1 ? buf.length : nextSep - 2;
    const partData = buf.slice(pos, partEnd);
    pos = nextSep;

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;

    if (headerStr.includes('filename=')) {
      photoBlob = partData;
    } else {
      fields[nameMatch[1]] = partData.toString();
    }
  }
  return { fields, photoBlob };
}
