// api/backup.js — Backup diário automático via Vercel Cron
// Cron: todos os dias às 06h UTC (03h BRT) — vercel.json: "schedule": "0 6 * * *"
//
// Variáveis de ambiente necessárias:
//   CRON_SECRET          — segredo para autenticar chamada do cron
//   SUPABASE_URL         — ex: https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY — service role key (bypassa RLS)
//   GITHUB_TOKEN         — Personal Access Token com permissão repo/contents
//   GITHUB_REPO          — ex: astta19/guardianvision

module.exports = async function handler(req, res) {
  // ── Autenticação do cron ───────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const GITHUB_TOKEN         = process.env.GITHUB_TOKEN;
  const GITHUB_REPO          = process.env.GITHUB_REPO || 'astta19/guardianvision';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY ausentes' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN ausente' });
  }

  // ── Tabelas para backup ────────────────────────────────────────
  // Cada entrada: string (usa created_at como ordem) ou { tabela, ordem } personalizado
  const TABELAS = [
    // Núcleo do sistema
    { tabela: 'clientes',              ordem: 'criado_em' },
    { tabela: 'clientes_usuarios',     ordem: 'criado_em' },
    // Departamento Pessoal
    { tabela: 'dp_funcionarios',       ordem: 'criado_em' },
    { tabela: 'dp_holerites',          ordem: 'criado_em' },
    { tabela: 'dp_eventos',            ordem: 'criado_em' },
    { tabela: 'dp_dependentes',        ordem: 'criado_em' },
    { tabela: 'dp_rubricas',           ordem: 'criado_em' },
    { tabela: 'dp_historico',          ordem: 'alterado_em' },
    { tabela: 'dp_fgts_saldo',         ordem: 'criado_em' },
    { tabela: 'dp_esocial_logs',       ordem: 'criado_em' },
    // Financeiro / Contábil
    { tabela: 'honorarios',            ordem: 'criado_em' },
    { tabela: 'lancamentos_contabeis', ordem: 'criado_em' },
    { tabela: 'plano_contas',          ordem: 'criado_em' },
    { tabela: 'balancetes',            ordem: 'criado_em' },
    // Outros módulos
    { tabela: 'agenda_tarefas',        ordem: 'criado_em' },
    { tabela: 'apuracoes',             ordem: 'criado_em' },
    { tabela: 'documentos',            ordem: 'criado_em' },
    { tabela: 'contatos_whatsapp',     ordem: 'criado_em' },
    { tabela: 'disparos_email',        ordem: 'criado_em' },
  ];

  // ── Headers Supabase ───────────────────────────────────────────
  // CORREÇÃO BUG 1: remover header Range — usar apenas offset/limit na URL.
  // PostgREST sem Range-Unit: items trata Range como bytes → falha 416.
  // offset + limit na query string é a forma correta e documentada.
  const sbHeaders = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Prefer':        'count=none',
  };

  const PAGE_SIZE = 1000;

  // ── Buscar todos os registros de uma tabela com paginação ──────
  // CORREÇÃO BUG 2: usar ordem configurável por tabela em vez de order=id fixo.
  // Tabelas sem coluna id retornavam 400 e eram tratadas como "não encontradas".
  async function fetchTabela({ tabela, ordem }) {
    const registros = [];
    let offset = 0;
    let continuar = true;

    while (continuar) {
      // Usar apenas offset + limit na URL — sem header Range
      const url = `${SUPABASE_URL}/rest/v1/${tabela}` +
        `?select=*&order=${ordem}&offset=${offset}&limit=${PAGE_SIZE}`;

      let r;
      try {
        r = await fetch(url, { headers: sbHeaders });
      } catch (netErr) {
        return { dados: registros, erro: `Erro de rede: ${netErr.message}` };
      }

      // 404 = tabela não existe no schema
      if (r.status === 404) {
        return { dados: [], aviso: `tabela ${tabela} não encontrada (404)` };
      }

      // 400 agora é tratado como erro real (coluna de ordem inválida, etc.)
      // e não confundido com "tabela não existe"
      if (!r.ok) {
        const txt = await r.text().catch(() => String(r.status));
        // Tentar fallback com created_at se a coluna de ordem não existir
        if (r.status === 400 && ordem !== 'created_at') {
          console.warn(`[backup] ${tabela}: ordem ${ordem} falhou (${r.status}), tentando created_at`);
          return fetchTabela({ tabela, ordem: 'created_at' });
        }
        // Último fallback: tentar sem ordenação
        if (r.status === 400) {
          console.warn(`[backup] ${tabela}: created_at falhou, tentando sem ordenação`);
          return fetchTabelaSemOrdem(tabela);
        }
        return { dados: registros, erro: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
      }

      const pagina = await r.json();

      if (!Array.isArray(pagina) || pagina.length === 0) {
        continuar = false;
      } else {
        registros.push(...pagina);
        offset += pagina.length;
        if (pagina.length < PAGE_SIZE) continuar = false;
      }
    }

    return { dados: registros };
  }

  // Fallback sem ordenação (para tabelas sem coluna de data conhecida)
  async function fetchTabelaSemOrdem(tabela) {
    const registros = [];
    let offset = 0;
    let continuar = true;

    while (continuar) {
      const url = `${SUPABASE_URL}/rest/v1/${tabela}` +
        `?select=*&offset=${offset}&limit=${PAGE_SIZE}`;

      let r;
      try {
        r = await fetch(url, { headers: sbHeaders });
      } catch (netErr) {
        return { dados: registros, erro: `Erro de rede: ${netErr.message}` };
      }

      if (r.status === 404) return { dados: [], aviso: `tabela ${tabela} não encontrada (404)` };
      if (!r.ok) {
        const txt = await r.text().catch(() => String(r.status));
        return { dados: registros, erro: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
      }

      const pagina = await r.json();
      if (!Array.isArray(pagina) || pagina.length === 0) {
        continuar = false;
      } else {
        registros.push(...pagina);
        offset += pagina.length;
        if (pagina.length < PAGE_SIZE) continuar = false;
      }
    }

    return { dados: registros };
  }

  // ── CORREÇÃO BUG 3: buscar tabelas em paralelo (grupos de 5) ──
  // Execução sequencial de 18 tabelas facilmente estoura os 60s do Vercel.
  // Paralelo total pode saturar conexões do Supabase — usar grupos de 5.
  const inicio = Date.now();
  const backupData   = {};
  const metadados    = {};
  let totalRegistros = 0;
  let tabelasOk      = 0;
  let tabelasErro    = 0;

  const GRUPO_SIZE = 5;
  for (let i = 0; i < TABELAS.length; i += GRUPO_SIZE) {
    const grupo = TABELAS.slice(i, i + GRUPO_SIZE);
    const resultados = await Promise.all(grupo.map(t => fetchTabela(t)));

    for (let j = 0; j < grupo.length; j++) {
      const { tabela } = grupo[j];
      const resultado = resultados[j];
      backupData[tabela] = resultado.dados;
      totalRegistros += resultado.dados.length;

      if (resultado.erro) {
        metadados[tabela] = { registros: resultado.dados.length, erro: resultado.erro };
        tabelasErro++;
        console.error(`[backup] ${tabela}: ERRO — ${resultado.erro}`);
      } else if (resultado.aviso) {
        metadados[tabela] = { registros: 0, aviso: resultado.aviso };
        console.warn(`[backup] ${tabela}: ${resultado.aviso}`);
      } else {
        metadados[tabela] = { registros: resultado.dados.length };
        tabelasOk++;
        console.log(`[backup] ${tabela}: ${resultado.dados.length} registros`);
      }
    }
  }

  // ── Montar payload do backup ───────────────────────────────────
  const agora     = new Date();
  const dataStr   = agora.toISOString().slice(0, 10);
  const horaStr   = agora.toISOString().slice(11, 16).replace(':', '');
  const filename  = `backups/backup_${dataStr}_${horaStr}.json`;
  const duracao   = Date.now() - inicio;

  const payload = {
    _meta: {
      gerado_em:       agora.toISOString(),
      duracao_ms:      duracao,
      total_registros: totalRegistros,
      tabelas_ok:      tabelasOk,
      tabelas_erro:    tabelasErro,
      tabelas:         metadados,
      versao:          '3',
    },
    ...backupData,
  };

  const conteudoJSON = JSON.stringify(payload);

  // ── CORREÇÃO BUG 5: verificar tamanho antes de enviar ao GitHub ──
  // GitHub Content API rejeita arquivos >100MB, mas na prática falha ~25MB base64.
  // Se o payload for grande demais, salvar em chunks ou avisar claramente.
  const payloadKB = conteudoJSON.length / 1024;
  const LIMITE_KB = 90 * 1024; // 90MB em KB para ter margem
  if (payloadKB > LIMITE_KB) {
    console.error(`[backup] Payload muito grande: ${payloadKB.toFixed(0)}KB — GitHub pode rejeitar`);
  }

  const content = Buffer.from(conteudoJSON).toString('base64');
  console.log(`[backup] Total: ${totalRegistros} registros em ${duracao}ms | Payload: ${payloadKB.toFixed(1)}KB`);

  // ── Verificar se arquivo já existe no GitHub (precisamos do SHA) ──
  let sha;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'User-Agent':    'Fiscal365-Backup',
        },
      }
    );
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch { /* arquivo novo — sha não necessário */ }

  // ── Salvar no GitHub ───────────────────────────────────────────
  const ghBody = {
    message: `backup: ${dataStr} ${horaStr} — ${totalRegistros} registros`,
    content,
    ...(sha ? { sha } : {}),
  };

  const ghRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
    {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type':  'application/json',
        'User-Agent':    'Fiscal365-Backup',
      },
      body: JSON.stringify(ghBody),
    }
  );

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({}));
    console.error('[backup] GitHub error:', err);
    return res.status(500).json({
      error:     'Falha ao salvar no GitHub',
      detail:    err.message || err,
      registros: totalRegistros,
      tabelas:   metadados,
    });
  }

  // ── Limpar backups antigos (manter apenas os últimos 30) ───────
  // CORREÇÃO BUG 4: verificar resposta de cada DELETE e logar falhas
  try {
    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/backups`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'User-Agent':    'Fiscal365-Backup',
        },
      }
    );
    if (listRes.ok) {
      const arquivos = await listRes.json();
      if (Array.isArray(arquivos)) {
        const jsons = arquivos
          .filter(f => f.name.endsWith('.json') && f.name.startsWith('backup_'))
          .sort((a, b) => a.name.localeCompare(b.name)); // mais antigos primeiro

        const paraApagar = jsons.slice(0, Math.max(0, jsons.length - 30));
        for (const f of paraApagar) {
          const delRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${f.path}`,
            {
              method:  'DELETE',
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type':  'application/json',
                'User-Agent':    'Fiscal365-Backup',
              },
              body: JSON.stringify({
                message: `backup: remover arquivo antigo ${f.name}`,
                sha:     f.sha,
              }),
            }
          );
          if (delRes.ok) {
            console.log(`[backup] Removido backup antigo: ${f.name}`);
          } else {
            const delErr = await delRes.text().catch(() => '');
            console.warn(`[backup] Falha ao remover ${f.name}: ${delRes.status} ${delErr.slice(0, 100)}`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[backup] Limpeza de backups antigos falhou (não crítico):', e.message);
  }

  return res.status(200).json({
    ok:              true,
    arquivo:         filename,
    registros:       totalRegistros,
    tabelas_ok:      tabelasOk,
    tabelas_erro:    tabelasErro,
    duracao_ms:      duracao,
    payload_kb:      Math.round(payloadKB),
    tabelas:         metadados,
  });
};
