// api/backup.js — Teste mínimo
module.exports = async function handler(req, res) {
  console.log('1. Função iniciou');
  
  try {
    console.log('2. Verificando variáveis');
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    
    console.log('3. GITHUB_TOKEN existe?', !!GITHUB_TOKEN);
    console.log('4. SUPABASE_URL existe?', !!SUPABASE_URL);
    
    // Teste simples: listar tabelas do Supabase
    if (SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      console.log('5. Testando conexão Supabase...');
      const testUrl = `${SUPABASE_URL}/rest/v1/?select=*&limit=1`;
      const response = await fetch(testUrl, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      });
      console.log('6. Status do Supabase:', response.status);
    }
    
    console.log('7. Função terminou sem erros');
    return res.status(200).json({ 
      message: 'Teste funcionou',
      envs: {
        github_token: !!GITHUB_TOKEN,
        supabase_url: !!SUPABASE_URL,
        supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
        github_repo: process.env.GITHUB_REPO
      }
    });
    
  } catch (error) {
    console.error('ERRO:', error.message);
    console.error('STACK:', error.stack);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
};
