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
  const TABELAS = [
    // Núcleo do sistema
    'clientes',
    'clientes_usuarios',
    // Departamento Pessoal
    'dp_funcionarios',
    'dp_holerites',
    'dp_eventos',
    'dp_dependentes',
    'dp_rubricas',
    'dp_historico',
    'dp_fgts_saldo',
    'dp_esocial_logs',
    // Financeiro / Contábil
    'honorarios',
    'lancamentos_contabeis',
    'plano_contas',
    'balancetes',
    // Outros módulos
    'agenda_tarefas',
    'apuracoes',
    'documentos',
    'contatos_whatsapp',
    'disparos_email',
  ];

  // ── Headers corretos para bypass RLS com service key ──────────
  // Supabase PostgREST exige apikey + Authorization + Prefer
  const sbHeaders = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'count=none',  // evita overhead de contagem
  };

  const PAGE_SIZE = 1000; // máximo seguro por request (teto padrão do PostgREST)

  // ── Buscar todos os registros de uma tabela com paginação ──────
  async function fetchTabela(tabela) {
    const registros = [];
    let offset = 0;
    let continuar = true;

    while (continuar) {
      const url = `${SUPABASE_URL}/rest/v1/${tabela}` +
        `?select=*&order=id&offset=${offset}&limit=${PAGE_SIZE}`;

      const r = await fetch(url, {
        headers: {
          ...sbHeaders,
          'Range': `${offset}-${offset + PAGE_SIZE - 1}`,
        },
      });

      if (r.status === 404 || r.status === 400) {
        // Tabela não existe — registrar mas não falhar
        return { dados: [], aviso: `tabela ${tabela} não encontrada (${r.status})` };
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => r.status.toString());
        return { dados: registros, erro: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
      }

      const pagina = await r.json();

      if (!Array.isArray(pagina) || pagina.length === 0) {
        continuar = false;
      } else {
        registros.push(...pagina);
        offset += pagina.length;
        // Se retornou menos que PAGE_SIZE, é a última página
        if (pagina.length < PAGE_SIZE) continuar = false;
      }
    }

    return { dados: registros };
  }

  // ── Executar backup de todas as tabelas ───────────────────────
  const inicio = Date.now();
  const backupData   = {};
  const metadados    = {};
  let totalRegistros = 0;
  let tabelasOk      = 0;
  let tabelasErro    = 0;

  for (const tabela of TABELAS) {
    const resultado = await fetchTabela(tabela);
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
      versao:          '2',
    },
    ...backupData,
  };

  const conteudoJSON = JSON.stringify(payload);
  const content      = Buffer.from(conteudoJSON).toString('base64');

  console.log(`[backup] Total: ${totalRegistros} registros em ${duracao}ms | Payload: ${(conteudoJSON.length / 1024).toFixed(1)}KB`);

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
      const jsons = arquivos
        .filter(f => f.name.endsWith('.json') && f.name.startsWith('backup_'))
        .sort((a, b) => a.name.localeCompare(b.name)); // mais antigos primeiro

      // Apagar os que passam de 30
      const paraApagar = jsons.slice(0, Math.max(0, jsons.length - 30));
      for (const f of paraApagar) {
        await fetch(
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
        console.log(`[backup] Removido backup antigo: ${f.name}`);
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
    tabelas:         metadados,
  });
};
