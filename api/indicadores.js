// api/indicadores.js — Indicadores econômicos com cache 24h
// GET /api/indicadores?tipo=selic|ipca|igpm|cdi|tjlp|usd|todos
// Fontes: BCB (api.bcb.gov.br) + BrasilAPI

// Cache em memória — persiste enquanto a função estiver quente na Vercel
const _cache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Séries BCB: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/1
const BCB_SERIES = {
  selic:  { codigo: 11,  label: 'SELIC (% a.a.)',      formato: 'percentual' },
  cdi:    { codigo: 12,  label: 'CDI (% a.a.)',         formato: 'percentual' },
  ipca:   { codigo: 433, label: 'IPCA (% mês)',         formato: 'percentual' },
  igpm:   { codigo: 189, label: 'IGP-M (% mês)',        formato: 'percentual' },
  tjlp:   { codigo: 256, label: 'TJLP (% a.a.)',        formato: 'percentual' },
  usd:    { codigo: 1,   label: 'USD/BRL',               formato: 'moeda'      },
};

async function buscarBCB(codigo) {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/1?formato=json`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`BCB HTTP ${r.status}`);
  const data = await r.json();
  return data?.[0] || null;
}

async function buscarIndicador(tipo) {
  const agora = Date.now();
  if (_cache[tipo] && (agora - _cache[tipo].ts) < CACHE_TTL) {
    return { ..._cache[tipo].data, cached: true };
  }

  const serie = BCB_SERIES[tipo];
  if (!serie) throw new Error(`Indicador desconhecido: ${tipo}`);

  const raw = await buscarBCB(serie.codigo);
  if (!raw) throw new Error(`Sem dados para ${tipo}`);

  const result = {
    tipo,
    label:  serie.label,
    valor:  parseFloat(raw.valor?.replace(',', '.') || '0'),
    data:   raw.data || null,
    formato: serie.formato,
  };

  _cache[tipo] = { data: result, ts: agora };
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // cache CDN 1h

  const { tipo = 'todos' } = req.query;

  try {
    if (tipo === 'todos') {
      // Buscar todos em paralelo — erros individuais não quebram o conjunto
      const resultados = await Promise.allSettled(
        Object.keys(BCB_SERIES).map(t => buscarIndicador(t))
      );

      const dados = {};
      Object.keys(BCB_SERIES).forEach((t, i) => {
        const r = resultados[i];
        dados[t] = r.status === 'fulfilled'
          ? r.value
          : { tipo: t, label: BCB_SERIES[t].label, valor: null, erro: r.reason?.message };
      });

      return res.status(200).json({ ok: true, dados, gerado_em: new Date().toISOString() });
    }

    // Tipo específico
    const dados = await buscarIndicador(tipo);
    return res.status(200).json({ ok: true, ...dados });

  } catch (e) {
    console.error('indicadores error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
