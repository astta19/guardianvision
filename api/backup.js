// api/backup.js — Debug progressivo
module.exports = async function handler(req, res) {
  console.log('🚀 [1/10] Iniciando backup');
  
  // Autenticação
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  console.log('✅ [2/10] Autenticação OK');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'astta19/guardianvision';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN ausente' });
  }
  console.log('✅ [3/10] Variáveis OK');

  // Tabelas reduzidas para teste (só 2 tabelas)
  const TABELAS = ['clientes', 'dp_funcionarios'];

  const sbHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=none',
  };

  const PAGE_SIZE = 1000;
  console.log('✅ [4/10] Configurações OK');

  // Função fetchTabela simplificada (sem paginação complexa)
  async function fetchTabela(tabela) {
    console.log(`  🔍 Buscando ${tabela}...`);
    const url = `${SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=${PAGE_SIZE}`;
    
    const r = await fetch(url, { headers: sbHeaders });
    
    if (r.status === 404) {
      console.log(`  ⚠️ Tabela ${tabela} não encontrada`);
      return { dados: [], aviso: `tabela ${tabela} não encontrada` };
    }
    
    if (!r.ok) {
      const txt = await r.text();
      console.log(`  ❌ Erro ${tabela}: ${r.status}`);
      return { dados: [], erro: `HTTP ${r.status}` };
    }
    
    const dados = await r.json();
    console.log(`  ✅ ${tabela}: ${dados.length} registros`);
    return { dados };
  }

  console.log('✅ [5/10] Função fetchTabela definida');

  // Executar backup
  const backupData = {};
  const metadados = {};
  let totalRegistros = 0;
  let tabelasOk = 0;
  let tabelasErro = 0;

  for (const tabela of TABELAS) {
    console.log(`📋 Processando ${tabela}...`);
    const resultado = await fetchTabela(tabela);
    backupData[tabela] = resultado.dados;
    totalRegistros += resultado.dados.length;
    
    if (resultado.erro) {
      tabelasErro++;
    } else {
      tabelasOk++;
    }
  }
  console.log(`✅ [6/10] Backup concluído: ${totalRegistros} registros`);

  // Montar payload
  const agora = new Date();
  const dataStr = agora.toISOString().slice(0, 10);
  const horaStr = agora.toISOString().slice(11, 16).replace(':', '');
  const filename = `backups/backup_${dataStr}_${horaStr}.json`;
  
  const payload = {
    _meta: {
      gerado_em: agora.toISOString(),
      total_registros: totalRegistros,
      tabelas_ok: tabelasOk,
      tabelas_erro: tabelasErro,
      versao: 'debug',
    },
    ...backupData,
  };

  const conteudoJSON = JSON.stringify(payload);
  const content = Buffer.from(conteudoJSON).toString('base64');
  console.log(`✅ [7/10] Payload pronto: ${(conteudoJSON.length / 1024).toFixed(1)}KB`);

  // Salvar no GitHub
  console.log(`💾 [8/10] Salvando no GitHub: ${filename}`);
  const ghBody = {
    message: `backup: ${dataStr} ${horaStr} — ${totalRegistros} registros`,
    content,
  };

  const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Fiscal365-Backup',
    },
    body: JSON.stringify(ghBody),
  });

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({}));
    console.error('❌ [9/10] GitHub error:', err);
    return res.status(500).json({ error: 'Falha ao salvar no GitHub', detail: err });
  }
  console.log('✅ [9/10] GitHub OK');

  console.log('✅ [10/10] Backup completo!');
  return res.status(200).json({
    ok: true,
    arquivo: filename,
    registros: totalRegistros,
    tabelas_ok: tabelasOk,
    tabelas_erro: tabelasErro,
  });
};
