// api/backup.js — Serverless function para o cron de backup diário
// Chamada pelo Vercel Cron todos os dias às 03h BRT
// Executa pg_dump via variável DATABASE_URL e salva no repositório via GitHub API

module.exports = async function handler(req, res) {
  // Verificar autorização (Vercel Cron envia header CRON_SECRET)
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO || 'astta19/guardianvision';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!GITHUB_TOKEN || !SUPABASE_URL) {
    return res.status(500).json({ error: 'Variáveis de ambiente ausentes' });
  }

  try {
    // Exportar dados críticos via REST API do Supabase (sem pg_dump no serverless)
    const tabelas = ['clientes', 'dp_funcionarios', 'honorarios', 'lancamentos_contabeis',
                     'plano_contas', 'agenda_tarefas', 'apuracoes'];

    const sbHeaders = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    const backupData = {};
    for (const tabela of tabelas) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=50000`, {
        headers: sbHeaders
      });
      if (r.ok) {
        backupData[tabela] = await r.json();
      }
    }

    // Salvar no GitHub via API
    const agora    = new Date();
    const data     = agora.toISOString().slice(0,10);
    const hora     = agora.toISOString().slice(11,16).replace(':','');
    const filename = `backups/backup_${data}_${hora}.json`;
    const content  = Buffer.from(JSON.stringify(backupData, null, 2)).toString('base64');

    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Fiscal365-Backup',
      },
      body: JSON.stringify({
        message: `backup: ${data} ${hora}`,
        content,
      }),
    });

    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      console.error('GitHub backup error:', err);
      return res.status(500).json({ error: 'Falha ao salvar backup no GitHub', detail: err.message });
    }

    const totalRegistros = Object.values(backupData).reduce((s, arr) => s + (arr?.length || 0), 0);
    console.log(`Backup ${filename}: ${totalRegistros} registros`);
    return res.status(200).json({ ok: true, arquivo: filename, registros: totalRegistros });

  } catch (err) {
    console.error('Backup error:', err);
    return res.status(500).json({ error: err.message });
  }
};
