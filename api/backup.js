// api/backup.js — Com tratamento específico para variáveis
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

  // --- PROBLEMA ESTÁ AQUI ---
  // Vamos debugar cada variável individualmente
  console.log('🔍 [2.1] Lendo SUPABASE_URL');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  console.log('🔍 [2.2] SUPABASE_URL existe?', SUPABASE_URL ? 'SIM' : 'NÃO');
  console.log('🔍 [2.3] Valor (primeiros 20 chars):', SUPABASE_URL ? SUPABASE_URL.substring(0, 20) : 'undefined');
  
  console.log('🔍 [2.4] Lendo SUPABASE_SERVICE_KEY');
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  console.log('🔍 [2.5] SUPABASE_SERVICE_KEY existe?', SUPABASE_SERVICE_KEY ? 'SIM' : 'NÃO');
  
  console.log('🔍 [2.6] Lendo GITHUB_TOKEN');
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  console.log('🔍 [2.7] GITHUB_TOKEN existe?', GITHUB_TOKEN ? 'SIM' : 'NÃO');
  
  console.log('🔍 [2.8] Lendo GITHUB_REPO');
  const GITHUB_REPO = process.env.GITHUB_REPO || 'astta19/guardianvision';
  console.log('🔍 [2.9] GITHUB_REPO:', GITHUB_REPO);
  
  // Verificações com mensagens específicas
  if (!SUPABASE_URL) {
    console.error('❌ ERRO: SUPABASE_URL não encontrada nas variáveis de ambiente');
    return res.status(500).json({ error: 'SUPABASE_URL ausente. Verifique as Environment Variables no Vercel.' });
  }
  
  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ ERRO: SUPABASE_SERVICE_KEY não encontrada nas variáveis de ambiente');
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY ausente. Verifique as Environment Variables no Vercel.' });
  }
  
  if (!GITHUB_TOKEN) {
    console.error('❌ ERRO: GITHUB_TOKEN não encontrada nas variáveis de ambiente');
    return res.status(500).json({ error: 'GITHUB_TOKEN ausente. Verifique as Environment Variables no Vercel.' });
  }
  
  console.log('✅ [3/10] Variáveis OK');

  // Se chegou aqui, continua com o backup (versão simplificada para teste)
  try {
    const tabelas = ['clientes'];
    
    const sbHeaders = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    };
    
    console.log('🔍 Testando conexão com Supabase...');
    const testUrl = `${SUPABASE_URL}/rest/v1/clientes?select=id&limit=1`;
    const testFetch = await fetch(testUrl, { headers: sbHeaders });
    
    if (!testFetch.ok) {
      throw new Error(`Supabase respondeu com status ${testFetch.status}`);
    }
    console.log('✅ Conexão Supabase OK');
    
    // Backup simples
    const agora = new Date();
    const dataStr = agora.toISOString().slice(0, 10);
    const horaStr = agora.toISOString().slice(11, 16).replace(':', '');
    const filename = `backups/backup_test_${dataStr}_${horaStr}.json`;
    
    const payload = {
      teste: true,
      data: agora.toISOString(),
      mensagem: 'Backup funcionou!'
    };
    
    const content = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `teste: ${dataStr}`,
        content,
      }),
    });
    
    if (!ghRes.ok) {
      const err = await ghRes.json();
      throw new Error(`GitHub: ${err.message || ghRes.status}`);
    }
    
    console.log('✅ Backup salvo com sucesso!');
    return res.status(200).json({ 
      ok: true, 
      message: 'Backup funcionou!',
      arquivo: filename 
    });
    
  } catch (error) {
    console.error('❌ Erro no backup:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
