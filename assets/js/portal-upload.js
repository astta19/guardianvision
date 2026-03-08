// api/portal-upload.js — Recebe upload de arquivo do cliente via portal
// Valida token, isola por user_id+cliente_id, salva no Storage e registra na tabela
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TIPOS_PERMITIDOS = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'text/xml', 'application/xml',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// Buscar token e retornar { user_id, cliente_id, token_id } ou null
async function validarToken(token) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/portal_tokens` +
    `?token=eq.${encodeURIComponent(token)}` +
    `&select=id,user_id,cliente_id,expira_em,revogado` +
    `&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows?.length) return null;

  const tk = rows[0];
  if (tk.revogado) return null;
  if (new Date(tk.expira_em) < new Date()) return null;

  return { user_id: tk.user_id, cliente_id: tk.cliente_id, token_id: tk.id };
}

// Upload para o Supabase Storage
async function uploadStorage(path, buffer, contentType) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/portal-uploads/${path}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage erro ${res.status}: ${err}`);
  }
  return path;
}

// Registrar na tabela portal_uploads
async function registrarUpload({ user_id, cliente_id, token_id, nome, tipo, tamanho_kb, path, descricao }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/portal_uploads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      user_id, cliente_id, token_id,
      nome_arquivo: nome,
      tipo_arquivo: tipo,
      tamanho_kb,
      storage_path: path,
      descricao: descricao || null,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DB erro ${res.status}: ${err}`);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    // Ler body como buffer raw (Vercel envia multipart como buffer)
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ erro: 'Envie como multipart/form-data' });
    }

    // Parsear multipart manualmente via busboy
    const busboy = require('busboy');
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });

    let token, descricao, fileBuffer, fileName, fileMime, fileSizeBytes, limitExceeded = false;

    await new Promise((resolve, reject) => {
      bb.on('field', (name, val) => {
        if (name === 'token')    token     = val.trim();
        if (name === 'descricao') descricao = val.trim().substring(0, 200);
      });

      bb.on('file', (name, stream, info) => {
        fileName  = info.filename?.replace(/[^a-zA-Z0-9._\-]/g, '_') || 'arquivo';
        fileMime  = info.mimeType;
        const chunks = [];

        stream.on('data', chunk => chunks.push(chunk));
        stream.on('limit', () => { limitExceeded = true; stream.resume(); });
        stream.on('end', () => {
          if (!limitExceeded) {
            fileBuffer    = Buffer.concat(chunks);
            fileSizeBytes = fileBuffer.length;
          }
        });
      });

      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (limitExceeded) return res.status(413).json({ erro: 'Arquivo muito grande. Limite: 10MB' });
    if (!token)        return res.status(400).json({ erro: 'Token ausente' });
    if (!fileBuffer)   return res.status(400).json({ erro: 'Arquivo ausente' });

    // Validar tipo MIME
    if (!TIPOS_PERMITIDOS.includes(fileMime)) {
      return res.status(415).json({ erro: `Tipo de arquivo não permitido: ${fileMime}` });
    }

    // Validar token e obter isolamento
    const ctx = await validarToken(token);
    if (!ctx) return res.status(403).json({ erro: 'Token inválido ou expirado' });

    // Classificar tipo
    const tipoMap = {
      'application/pdf': 'pdf',
      'text/xml': 'nfe', 'application/xml': 'nfe',
      'image/jpeg': 'imagem', 'image/png': 'imagem', 'image/webp': 'imagem',
    };
    const tipo = tipoMap[fileMime] || (fileMime.includes('excel') || fileMime.includes('sheet') ? 'planilha' : 'outro');

    // Path isolado: user_id/cliente_id/timestamp_arquivo
    const ts   = Date.now();
    const ext  = fileName.split('.').pop() || 'bin';
    const safe = fileName.replace(/\.[^.]+$/, '').substring(0, 50);
    const path = `${ctx.user_id}/${ctx.cliente_id}/${ts}_${safe}.${ext}`;

    await uploadStorage(path, fileBuffer, fileMime);

    const registro = await registrarUpload({
      ...ctx,
      nome: fileName,
      tipo,
      tamanho_kb: Math.ceil(fileSizeBytes / 1024),
      path,
      descricao,
    });

    console.log(`Upload recebido: ${fileName} (${Math.ceil(fileSizeBytes/1024)}KB) — cliente ${ctx.cliente_id}`);
    return res.status(200).json({ ok: true, id: registro?.[0]?.id });

  } catch (e) {
    console.error('portal-upload erro:', e.message);
    return res.status(500).json({ erro: 'Erro ao processar upload' });
  }
};
