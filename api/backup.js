// api/backup.js — Backup automático diário dos dados contábeis
// Cron: todo dia às 03:00 BRT (06:00 UTC)
// Estratégia: exportar tabelas críticas como JSON → salvar no Supabase Storage
// Retenção: 90 dias (arquivos antigos removidos automaticamente)
// Sem custo adicional — usa Storage do próprio Supabase (1GB free)

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Tabelas críticas para backup — dados que não podem ser perdidos
const TABELAS_CRITICAS = [
  // Financeiro
  { tabela: 'clientes',              select: '*', ordem: 'created_at' },
  { tabela: 'lancamentos',           select: '*', ordem: 'created_at' },
  { tabela: 'honorarios',            select: '*', ordem: 'created_at' },
  { tabela: 'darf_historico',        select: '*', ordem: 'created_at' },
  // Folha
  { tabela: 'dp_funcionarios',       select: '*', ordem: 'created_at' },
  { tabela: 'dp_holerites',          select: '*', ordem: 'created_at' },
  { tabela: 'dp_eventos',            select: '*', ordem: 'created_at' },
  // Contábil
  { tabela: 'plano_contas',          select: '*', ordem: 'created_at' },
  { tabela: 'lancamentos_contabeis', select: '*', ordem: 'created_at' },
  { tabela: 'apuracoes',             select: '*', ordem: 'created_at' },
  // SPED
  { tabela: 'sped_periodos',         select: '*', ordem: 'created_at' },
  { tabela: 'sped_documentos',       select: '*', ordem: 'criado_em'  },
  // Portal
  { tabela: 'portal_uploads',        select: '*', ordem: 'created_at' },
  // Escritório
  { tabela: 'escritorios',           select: '*', ordem: 'created_at' },
  { tabela: 'escritorio_usuarios',   select: '*', ordem: 'created_at' },
];

const BUCKET = 'backups';

const sbHeaders = {
  'apikey':        SB_SERVICE,
  'Authorization': `Bearer ${SB_SERVICE}`,
  'Content-Type':  'application/json',
};

// ── Exportar uma tabela via REST API ──────────────────────────
async function exportarTabela(tabela, select, ordem) {
  const params = new URLSearchParams({
    select,
    order: `${ordem}.desc`,
    limit: '100000',
  });
  const res = await fetch(`${SB_URL}/rest/v1/${tabela}?${params}`, {
    headers: sbHeaders,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro ao exportar ${tabela}: ${res.status} ${err}`);
  }
  return res.json();
}

// ── Salvar arquivo no Supabase Storage ────────────────────────
async function salvarNoStorage(caminho, conteudo) {
  const body = JSON.stringify(conteudo, null, 2);

  // Upsert: sobrescreve se já existir
  const res = await fetch(
    `${SB_URL}/storage/v1/object/${BUCKET}/${caminho}`,
    {
      method: 'POST',
      headers: {
        ...sbHeaders,
        'Content-Type':    'application/json',
        'x-upsert':        'true',
        'Cache-Control':   'no-cache',
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro ao salvar ${caminho}: ${res.status} ${err}`);
  }
  return body.length;
}

// ── Remover backups com mais de 90 dias ───────────────────────
async function limparBackupsAntigos() {
  try {
    const res = await fetch(
      `${SB_URL}/storage/v1/object/list/${BUCKET}`,
      {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ prefix: '', limit: 1000 }),
      }
    );
    if (!res.ok) return;

    const arquivos = await res.json();
    const limite   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const antigos  = (arquivos || [])
      .filter(f => f.created_at < limite)
      .map(f => f.name);

    if (!antigos.length) return;

    await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
      method:  'DELETE',
      headers: sbHeaders,
      body:    JSON.stringify({ prefixes: antigos }),
    });

    return antigos.length;
  } catch {
    // Falha na limpeza não deve interromper o backup
    return 0;
  }
}

// ── Garantir que o bucket existe ──────────────────────────────
async function garantirBucket() {
  // Criar bucket se não existir (privado — sem acesso público)
  const res = await fetch(`${SB_URL}/storage/v1/bucket`, {
    method:  'POST',
    headers: sbHeaders,
    body: JSON.stringify({
      id:     BUCKET,
      name:   BUCKET,
      public: false,
    }),
  });
  // 409 = já existe, OK
  if (!res.ok && res.status !== 409) {
    const err = await res.text();
    throw new Error(`Erro ao criar bucket: ${err}`);
  }
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Validar segredo do cron
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  if (!SB_URL || !SB_SERVICE) {
    return res.status(500).json({ error: 'Variáveis de ambiente não configuradas' });
  }

  const inicio  = Date.now();
  const data    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const hora    = new Date().toISOString().slice(11, 16).replace(':', 'h'); // HHhMM
  const pasta   = `${data}/${hora}`;

  const resultado = {
    data,
    tabelas:  {},
    erros:    [],
    bytes:    0,
    removidos: 0,
    duracao_ms: 0,
  };

  try {
    await garantirBucket();

    // Exportar cada tabela
    for (const { tabela, select, ordem } of TABELAS_CRITICAS) {
      try {
        const dados = await exportarTabela(tabela, select, ordem);
        const caminho = `${pasta}/${tabela}.json`;
        const bytes = await salvarNoStorage(caminho, dados);
        resultado.tabelas[tabela] = { registros: dados.length, bytes };
        resultado.bytes += bytes;
      } catch (e) {
        resultado.erros.push({ tabela, erro: e.message });
      }
    }

    // Salvar manifesto do backup
    resultado.duracao_ms = Date.now() - inicio;
    await salvarNoStorage(`${pasta}/_manifesto.json`, resultado);

    // Limpar backups antigos
    resultado.removidos = await limparBackupsAntigos() || 0;

    // Salvar log do último backup para monitoramento
    await salvarNoStorage('_ultimo_backup.json', {
      ...resultado,
      timestamp: new Date().toISOString(),
    });

    const totalRegistros = Object.values(resultado.tabelas)
      .reduce((s, t) => s + t.registros, 0);

    console.log(`[backup] ${data} — ${totalRegistros} registros, ${(resultado.bytes/1024).toFixed(1)}KB, ${resultado.erros.length} erros`);

    return res.status(200).json(resultado);

  } catch (e) {
    console.error('[backup] Erro fatal:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
