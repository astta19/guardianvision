<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal do Cliente — Fiscal365</title>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f8fafc; --card: #fff; --border: #e2e8f0;
      --text: #0f172a; --text-light: #64748b;
      --accent: #000; --accent-fg: #fff;
      --ok: #16a34a; --warn: #d97706; --error: #dc2626;
      --radius: 12px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100dvh; }

    /* Loading */
    #loading { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 99; }
    .spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .75s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Layout */
    .container { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }

    /* Header */
    .header { background: var(--accent); color: var(--accent-fg); border-radius: var(--radius); padding: 24px; margin-bottom: 20px; }
    .header-logo { font-size: 13px; font-weight: 700; letter-spacing: .5px; opacity: .7; margin-bottom: 8px; text-transform: uppercase; }
    .header-empresa { font-size: 22px; font-weight: 800; line-height: 1.2; }
    .header-cnpj { font-size: 12px; opacity: .65; margin-top: 4px; }
    .header-meta { display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; }
    .header-badge { background: rgba(255,255,255,.12); border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; }

    /* Cards */
    .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-light); margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }

    /* Contador */
    .contador-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .contador-item label { font-size: 11px; color: var(--text-light); display: block; margin-bottom: 2px; }
    .contador-item span { font-size: 13px; font-weight: 600; color: var(--text); }

    /* Prazos */
    .prazo-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .prazo-item:last-child { border-bottom: none; }
    .prazo-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .prazo-nome { flex: 1; font-size: 13px; font-weight: 500; }
    .prazo-data { font-size: 12px; color: var(--text-light); white-space: nowrap; }
    .prazo-dias { font-size: 11px; font-weight: 700; white-space: nowrap; padding: 2px 8px; border-radius: 20px; }
    .dias-ok   { background: #dcfce7; color: var(--ok); }
    .dias-warn { background: #fef3c7; color: var(--warn); }
    .dias-error{ background: #fee2e2; color: var(--error); }
    .dias-done { background: #f1f5f9; color: var(--text-light); }

    /* Documentos */
    .doc-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .doc-item:last-child { border-bottom: none; }
    .doc-icon { width: 32px; height: 32px; border-radius: 8px; background: var(--bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .doc-info { flex: 1; min-width: 0; }
    .doc-nome { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-meta { font-size: 11px; color: var(--text-light); margin-top: 2px; }

    /* Erro */
    .erro-box { text-align: center; padding: 60px 24px; }
    .erro-box svg { opacity: .3; margin-bottom: 16px; }
    .erro-box h2 { font-size: 18px; margin-bottom: 8px; }
    .erro-box p { font-size: 13px; color: var(--text-light); }

    /* Footer */
    .footer { text-align: center; padding-top: 24px; font-size: 11px; color: var(--text-light); }

    @media (max-width: 480px) {
      .header { border-radius: 0 0 var(--radius) var(--radius); margin: -16px -16px 20px; }
      .contador-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<div id="loading"><div class="spinner"></div></div>

<div class="container" id="app" style="display:none"></div>

<script>
const token = new URLSearchParams(location.search).get('token');

async function init() {
  const app = document.getElementById('app');

  if (!token) {
    renderErro('Link inválido', 'Este link não contém um token de acesso válido.');
    return;
  }

  try {
    const res = await fetch(`/api/portal?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!res.ok || data.erro) {
      renderErro(
        data.erro?.includes('expirado') ? 'Link expirado' : 'Acesso inválido',
        data.erro || 'Este link não é válido ou foi revogado pelo seu contador.'
      );
      return;
    }

    renderPortal(data);
  } catch (e) {
    renderErro('Erro de conexão', 'Não foi possível carregar os dados. Tente novamente em instantes.');
  }

  document.getElementById('loading').style.display = 'none';
  app.style.display = 'block';
  if (window.lucide) lucide.createIcons();
}

function renderPortal(d) {
  const empresa  = d.empresa  || {};
  const contador = d.contador || {};
  const prazos   = d.prazos   || [];
  const docs     = d.documentos || [];

  const regime = empresa.regime_tributario || '—';
  const geradoEm = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  document.getElementById('app').innerHTML = `

    <!-- Header -->
    <div class="header">
      <div class="header-logo">Fiscal365 · Portal do Cliente</div>
      <div class="header-empresa">${esc(empresa.razao_social || 'Empresa')}</div>
      ${empresa.cnpj ? `<div class="header-cnpj">CNPJ: ${esc(empresa.cnpj)}</div>` : ''}
      <div class="header-meta">
        <span class="header-badge">${esc(regime)}</span>
        ${empresa.nome_fantasia ? `<span class="header-badge">${esc(empresa.nome_fantasia)}</span>` : ''}
        <span class="header-badge">Atualizado em ${geradoEm}</span>
      </div>
    </div>

    <!-- Contador responsável -->
    <div class="card">
      <div class="card-title"><i data-lucide="user-check" style="width:14px;height:14px"></i> Contador Responsável</div>
      <div class="contador-grid">
        <div class="contador-item"><label>Nome</label><span>${esc(contador.nome || '—')}</span></div>
        <div class="contador-item"><label>CRC</label><span>${esc(contador.crc || '—')}</span></div>
        <div class="contador-item"><label>E-mail</label><span>${esc(contador.email || '—')}</span></div>
        <div class="contador-item"><label>CNPJ Escritório</label><span>${esc(contador.cnpj_escritorio || '—')}</span></div>
      </div>
    </div>

    <!-- Prazos -->
    <div class="card">
      <div class="card-title"><i data-lucide="calendar-clock" style="width:14px;height:14px"></i> Prazos Fiscais — ${mesAtual()}</div>
      ${prazos.length
        ? prazos.map(p => renderPrazo(p)).join('')
        : '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:16px 0">Nenhum prazo cadastrado para este período.</p>'
      }
    </div>

    <!-- Documentos -->
    ${docs.length ? `
    <div class="card">
      <div class="card-title"><i data-lucide="file-text" style="width:14px;height:14px"></i> Documentos Recentes</div>
      ${docs.map(d => renderDoc(d)).join('')}
    </div>` : ''}

    <div class="footer">
      Portal gerado pelo Fiscal365. As informações são de responsabilidade do escritório contábil.<br>
      Dúvidas? Entre em contato com seu contador.
    </div>
  `;
}

function renderPrazo(p) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const prazo = new Date(p.prazo + 'T00:00:00');
  const dias = Math.ceil((prazo - hoje) / 86400000);
  const concluida = p.status === 'concluida';

  let corDot, classDias, textoDias;
  if (concluida) {
    corDot = '#94a3b8'; classDias = 'dias-done'; textoDias = '✓ Concluído';
  } else if (dias < 0) {
    corDot = '#dc2626'; classDias = 'dias-error'; textoDias = `${Math.abs(dias)}d vencido`;
  } else if (dias <= 5) {
    corDot = '#d97706'; classDias = 'dias-warn'; textoDias = `${dias}d restante${dias !== 1 ? 's' : ''}`;
  } else {
    corDot = '#16a34a'; classDias = 'dias-ok'; textoDias = `${dias}d restantes`;
  }

  return `
    <div class="prazo-item">
      <div class="prazo-dot" style="background:${corDot}"></div>
      <div class="prazo-nome">${esc(p.obrigacao)}</div>
      <div class="prazo-data">${prazo.toLocaleDateString('pt-BR')}</div>
      <span class="prazo-dias ${classDias}">${textoDias}</span>
    </div>`;
}

function renderDoc(d) {
  const data = d.criado_em ? new Date(d.criado_em).toLocaleDateString('pt-BR') : '—';
  const icone = d.tipo === 'nfe' ? 'scan-line' : d.tipo === 'darf' ? 'receipt' : 'file-text';
  const cor   = d.tipo === 'nfe' ? '#2563eb' : d.tipo === 'darf' ? '#dc2626' : '#7c3aed';
  return `
    <div class="doc-item">
      <div class="doc-icon"><i data-lucide="${icone}" style="width:16px;height:16px;color:${cor}"></i></div>
      <div class="doc-info">
        <div class="doc-nome">${esc(d.tipo?.toUpperCase() || 'Documento')}</div>
        <div class="doc-meta">Gerado em ${data}</div>
      </div>
    </div>`;
}

function renderErro(titulo, msg) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('app').innerHTML = `
    <div class="erro-box">
      <i data-lucide="shield-off" style="width:56px;height:56px"></i>
      <h2>${esc(titulo)}</h2>
      <p>${esc(msg)}</p>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function mesAtual() {
  return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
</script>
</body>
</html>
