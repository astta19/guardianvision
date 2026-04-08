// api/backup.js — Versão estável (baseada no antigo que funcionava)
module.exports = async function handler(req, res) {
  // Autenticação
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'astta19/guardianvision';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!GITHUB_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variáveis ausentes' });
  }

  try {
    // Tabelas essenciais (mesmo do antigo, que funcionava)
    const tabelas = [
      'clientes', 
      'dp_funcionarios', 
      'honorarios', 
      'lancamentos_contabeis',
      'plano_contas', 
      'agenda_tarefas', 
      'apuracoes'
    ];

    const sbHeaders = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    const backupData = {};
    let totalRegistros = 0;

    for (const tabela of tabelas) {
      try {
        // Tenta pegar com paginação (melhoria do novo)
        let todosRegistros = [];
        let offset = 0;
        const limit = 1000;
        let continuar = true;

        while (continuar) {
          const url = `${SUPABASE_URL}/rest/v1/${tabela}?select=*&offset=${offset}&limit=${limit}`;
          const r = await fetch(url, { headers: sbHeaders });
          
          if (!r.ok) {
            console.warn(`⚠️ Tabela ${tabela} não acessível: ${r.status}`);
            break;
          }
          
          const dados = await r.json();
          if (!Array.isArray(dados) || dados.length === 0) {
            continuar = false;
          } else {
            todosRegistros.push(...dados);
            offset += dados.length;
            if (dados.length < limit) continuar = false;
          }
        }
        
        backupData[tabela] = todosRegistros;
        totalRegistros += todosRegistros.length;
        console.log(`✅ ${tabela}: ${todosRegistros.length} registros`);
        
      } catch (err) {
        console.error(`❌ Erro na tabela ${tabela}:`, err.message);
        backupData[tabela] = { error: err.message };
      }
    }

    // Salvar no GitHub
    const agora = new Date();
    const dataStr = agora.toISOString().slice(0, 10);
    const horaStr = agora.toISOString().slice(11, 16).replace(':', '');
    const filename = `backups/backup_${dataStr}_${horaStr}.json`;
    
    const payload = {
      _meta: {
        gerado_em: agora.toISOString(),
        total_registros: totalRegistros,
        versao: '3'
      },
      ...backupData
    };
    
    const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');

    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Fiscal365-Backup',
      },
      body: JSON.stringify({
        message: `backup: ${dataStr} ${horaStr} - ${totalRegistros} registros`,
        content,
      }),
    });

    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      throw new Error(`GitHub API: ${err.message || ghRes.status}`);
    }

    console.log(`✅ Backup salvo: ${filename} (${totalRegistros} registros)`);
    return res.status(200).json({ 
      ok: true, 
      arquivo: filename, 
      registros: totalRegistros,
      tabelas: Object.keys(backupData).length
    });

  } catch (err) {
    console.error('🔥 Backup error:', err);
    return res.status(500).json({ error: err.message });
  }
};
