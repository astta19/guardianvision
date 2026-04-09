// api/backup.js — Backup diário automático via Vercel Cron
// Cron: todos os dias às 06h UTC (03h BRT) — vercel.json: "schedule": "0 6 * * *"
//
// Variáveis de ambiente necessárias:
//   CRON_SECRET          — segredo para autenticar chamada do cron
//   SUPABASE_URL         — ex: https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY — service role key (bypassa RLS)
//   GITHUB_TOKEN         — Personal Access Token com permissão repo/contents
//   GITHUB_REPO          — ex: astta19/guardianvision

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

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
  // CORREÇÃO: remover tabelas inexistentes (balancetes, documentos,
  // contatos_whatsapp, disparos_email) — causavam 404 em todo backup
  // e poluíam os logs com avisos desnecessários.
  // Adicionar tabela scraper_lugares que existe no projeto.
  const TABELAS = [
    // Núcleo
    { tabela: 'clientes',              ordem: 'created_at'  },
    { tabela: 'clientes_usuarios',     ordem: 'criado_em'   },
    // Departamento Pessoal
    { tabela: 'dp_funcionarios',       ordem: 'criado_em',
      // CORREÇÃO CRÍTICA: excluir foto_base64 do backup.
      // 2 fotos de 16 funcionários já ocupam 90% (1.4 MB) do arquivo.
      // Com 100+ funcionários o backup explodiria e ultrapassaria o limite do GitHub.
      // Fotos ficam no Supabase Storage — não precisam de backup JSON.
      select: 'id,user_id,cliente_id,escritorio_id,nome,cargo,cpf,ctps,pis,rg,' +
              'data_nascimento,sexo,estado_civil,nome_mae,nacionalidade,naturalidade,' +
              'email,telefone,jornada_horas,admissao,salario_base,tipo_contrato,' +
              'dependentes,banco,agencia,conta,endereco,logradouro,numero,complemento,' +
              'bairro,cidade,uf,cep,matricula,centro_custo,vale_transporte,vale_refeicao,' +
              'insalubridade_pct,periculosidade_pct,categoria_esocial,grau_instrucao,' +
              'deficiencia,tipo_deficiencia,observacoes,status,foto_url,' +
              'criado_em,atualizado_em'
    },
    { tabela: 'dp_holerites',          ordem: 'criado_em',
      // Excluir dados_completos (JSONB grande, redundante com as colunas individuais)
      select: 'id,user_id,cliente_id,escritorio_id,funcionario_id,competencia,' +
              'dias_trabalhados,salario_bruto,he50_horas,he100_horas,adic_noturno_horas,' +
              'outros_acrescimos,total_bruto,inss,irrf,pensao_alimenticia,outros_descontos,' +
              'total_descontos,salario_liquido,fgts,inss_patronal,rat,custo_total,' +
              'tipo_contrato,criado_em'
    },
    { tabela: 'dp_eventos',            ordem: 'criado_em'   },
    { tabela: 'dp_dependentes',        ordem: 'criado_em'   },
    { tabela: 'dp_rubricas',           ordem: 'criado_em'   },
    { tabela: 'dp_historico',          ordem: 'alterado_em' },
    { tabela: 'dp_fgts_saldo',         ordem: 'criado_em'   },
    { tabela: 'dp_esocial_logs',       ordem: 'criado_em'   },
    // Financeiro / Contábil
    { tabela: 'honorarios',            ordem: 'criado_em'   },
    { tabela: 'lancamentos_contabeis', ordem: 'criado_em'   },
    { tabela: 'plano_contas',          ordem: 'criado_em'   },
    // Outros módulos
    { tabela: 'agenda_tarefas',        ordem: 'criado_em'   },
    { tabela: 'apuracoes',             ordem: 'criado_em'   },
    { tabela: 'scraper_lugares',       ordem: 'criado_em'   },
  ];

  // ── Headers Supabase ───────────────────────────────────────────
  const sbHeaders = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Prefer':        'count=none',
  };

  const PAGE_SIZE = 1000;

  // ── Buscar todos os registros de uma tabela com paginação ──────
  async function fetchTabela({ tabela, ordem, select }) {
    const campos = select || '*';
    const registros = [];
    let offset = 0;
    let continuar = true;

    while (continuar) {
      const url = `${SUPABASE_URL}/rest/v1/${tabela}` +
        `?select=${encodeURIComponent(campos)}&order=${ordem}&offset=${offset}&limit=${PAGE_SIZE}`;

      let r;
      try {
        r = await fetch(url, { headers: sbHeaders });
      } catch (netErr) {
        return { dados: registros, erro: `Erro de rede: ${netErr.message}` };
      }

      if (r.status === 404) {
        return { dados: [], aviso: `tabela ${tabela} não encontrada (404)` };
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => String(r.status));
        // Fallback: tentar created_at se a coluna de ordem não existir
        if (r.status === 400 && ordem !== 'created_at') {
          console.warn(`[backup] ${tabela}: ordem ${ordem} falhou, tentando created_at`);
          return fetchTabela({ tabela, ordem: 'created_at', select });
        }
        // Último fallback: sem ordenação
        if (r.status === 400) {
          console.warn(`[backup] ${tabela}: created_at falhou, tentando sem ordenação`);
          return fetchTabelaSemOrdem(tabela, campos);
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

  async function fetchTabelaSemOrdem(tabela, campos = '*') {
    const registros = [];
    let offset = 0;
    let continuar = true;

    while (continuar) {
      const url = `${SUPABASE_URL}/rest/v1/${tabela}` +
        `?select=${encodeURIComponent(campos)}&offset=${offset}&limit=${PAGE_SIZE}`;

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

  // ── Executar backup em grupos paralelos de 5 ──────────────────
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
      const resultado  = resultados[j];
      backupData[tabela] = resultado.dados;
      totalRegistros    += resultado.dados.length;

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

  // ── Montar e comprimir payload ─────────────────────────────────
  // CORREÇÃO: salvar como .json.gz — compressão reduz ~70-80% do tamanho.
  // Com 304 registros o arquivo era 1.5 MB (90% fotos já removidas).
  // Gzip vai a ~150-200 KB, muito abaixo do limite do GitHub.
  const agora    = new Date();
  const dataStr  = agora.toISOString().slice(0, 10);
  const horaStr  = agora.toISOString().slice(11, 16).replace(':', '');
  const duracao  = Date.now() - inicio;

  const payload = {
    _meta: {
      gerado_em:       agora.toISOString(),
      duracao_ms:      duracao,
      total_registros: totalRegistros,
      tabelas_ok:      tabelasOk,
      tabelas_erro:    tabelasErro,
      tabelas:         metadados,
      versao:          '4',
    },
    ...backupData,
  };

  const conteudoJSON = JSON.stringify(payload);
  const jsonKB = conteudoJSON.length / 1024;

  // Comprimir com gzip
  const conteudoGzip = await gzip(Buffer.from(conteudoJSON, 'utf8'));
  const gzipKB       = conteudoGzip.length / 1024;
  const filename     = `backups/backup_${dataStr}_${horaStr}.json.gz`;
  const content      = conteudoGzip.toString('base64');

  console.log(`[backup] JSON: ${jsonKB.toFixed(1)}KB → Gzip: ${gzipKB.toFixed(1)}KB (${(100-gzipKB/jsonKB*100).toFixed(0)}% menor) | ${totalRegistros} registros | ${duracao}ms`);

  // Alerta se mesmo comprimido for grande
  if (gzipKB > 90 * 1024) {
    console.error(`[backup] Payload gzip muito grande: ${gzipKB.toFixed(0)}KB — GitHub pode rejeitar`);
  }

  // ── Verificar SHA se arquivo já existe ────────────────────────
  let sha;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'Fiscal365-Backup' } }
    );
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch { /* arquivo novo */ }

  // ── Salvar no GitHub ───────────────────────────────────────────
  const ghRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
    {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type':  'application/json',
        'User-Agent':    'Fiscal365-Backup',
      },
      body: JSON.stringify({
        message: `backup: ${dataStr} ${horaStr} — ${totalRegistros} registros`,
        content,
        ...(sha ? { sha } : {}),
      }),
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

  // ── Limpar backups antigos (manter os últimos 30) ─────────────
  try {
    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/backups`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'Fiscal365-Backup' } }
    );
    if (listRes.ok) {
      const arquivos = await listRes.json();
      if (Array.isArray(arquivos)) {
        const backups = arquivos
          .filter(f => f.name.startsWith('backup_'))
          .sort((a, b) => a.name.localeCompare(b.name));

        const paraApagar = backups.slice(0, Math.max(0, backups.length - 30));
        for (const f of paraApagar) {
          const del = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${f.path}`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type':  'application/json',
                'User-Agent':    'Fiscal365-Backup',
              },
              body: JSON.stringify({ message: `backup: remover ${f.name}`, sha: f.sha }),
            }
          );
          if (del.ok) {
            console.log(`[backup] Removido: ${f.name}`);
          } else {
            console.warn(`[backup] Falha ao remover ${f.name}: ${del.status}`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[backup] Limpeza falhou (não crítico):', e.message);
  }

  return res.status(200).json({
    ok:           true,
    arquivo:      filename,
    registros:    totalRegistros,
    tabelas_ok:   tabelasOk,
    tabelas_erro: tabelasErro,
    duracao_ms:   duracao,
    json_kb:      Math.round(jsonKB),
    gzip_kb:      Math.round(gzipKB),
    tabelas:      metadados,
  });
};
