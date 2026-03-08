// api/portal-upload.js — Gera URL assinada para upload direto no Supabase Storage
// Fluxo: 1) cliente chama este endpoint com token + metadados
//        2) endpoint valida token e retorna signed URL
//        3) cliente faz PUT direto no Storage com o arquivo
//        4) cliente notifica este endpoint para registrar na tabela
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TIPOS_PERMITIDOS = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'text/xml', 'application/xml',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

async function validarToken(token) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/portal_tokens?token=eq.${encodeURIComponent(token)}&select=id,user_id,cliente_id,expira_em,revogado&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows?.length) return null;
  const tk = rows[0];
  if (tk.revogado || new Date(tk.expira_em) < new Date()) return null;
  return { user_id: tk.user_id, cliente_id: tk.cliente_id, token_id: tk.id };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ erro: 'Método não permitido' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ erro: 'Body inválido' }); }

  const { action, token } = body || {};
  if (!token) return res.status(400).json({ erro: 'Token ausente' });

  const ctx = await validarToken(token);
  if (!ctx) return res.status(403).json({ erro: 'Token inválido ou expirado' });

  // ── Ação 1: gerar signed URL para upload direto ───────────
  if (action === 'gerar_url') {
    const { nome_arquivo, mime_type, tamanho_kb } = body;

    if (!TIPOS_PERMITIDOS.includes(mime_type))
      return res.status(415).json({ erro: `Tipo não permitido: ${mime_type}` });
    if (tamanho_kb > 10240)
      return res.status(413).json({ erro: 'Arquivo muito grande. Limite: 10MB' });

    const safe = (nome_arquivo || 'arquivo').replace(/[^a-zA-Z0-9._\-]/g, '_').substring(0, 80);
    const path = `${ctx.user_id}/${ctx.cliente_id}/${Date.now()}_${safe}`;

    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/portal-uploads/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ upsert: false }),
      }
    );

    if (!signRes.ok) {
      const err = await signRes.text();
      console.error('Storage sign error:', err);
      return res.status(500).json({ erro: 'Erro ao gerar URL de upload' });
    }

    const { signedURL, token: uploadToken } = await signRes.json();
    return res.status(200).json({
      upload_url: `${SUPABASE_URL}/storage/v1${signedURL}`,
      path,
      upload_token: uploadToken,
    });
  }

  // ── Ação 2: registrar após upload concluído ───────────────
  if (action === 'registrar') {
    const { nome_arquivo, mime_type, tamanho_kb, storage_path, descricao } = body;

    const tipoMap = {
      'application/pdf': 'pdf', 'text/xml': 'nfe', 'application/xml': 'nfe',
      'image/jpeg': 'imagem', 'image/png': 'imagem', 'image/webp': 'imagem',
    };
    const tipo = tipoMap[mime_type] || (mime_type?.includes('sheet') || mime_type?.includes('excel') ? 'planilha' : 'outro');

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_uploads`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id:      ctx.user_id,
        cliente_id:   ctx.cliente_id,
        token_id:     ctx.token_id,
        nome_arquivo: nome_arquivo || 'arquivo',
        tipo_arquivo: tipo,
        tamanho_kb:   tamanho_kb   || null,
        storage_path,
        descricao:    descricao    || null,
      }),
    });

    if (!insRes.ok) {
      const err = await insRes.text();
      console.error('DB insert error:', err);
      return res.status(500).json({ erro: 'Erro ao registrar arquivo' });
    }

    const rows = await insRes.json();
    console.log(`Upload registrado: ${nome_arquivo} — cliente ${ctx.cliente_id}`);
    return res.status(200).json({ ok: true, id: rows?.[0]?.id });
  }

  return res.status(400).json({ erro: 'Ação inválida' });
};
