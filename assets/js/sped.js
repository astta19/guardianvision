// ============================================================
// SPED.JS — EFD-ICMS/IPI: Formulário + Geração do .txt
// Leiaute: Ato COTEPE/ICMS nº 9/2008 e atualizações
// ============================================================

// --- Estado do módulo ---
let spedPeriodo   = null; // período aberto
let spedDocs      = [];   // documentos do período
let spedParts     = [];   // participantes
let spedProds     = [];   // produtos
let spedApuracao  = null; // apuração ICMS

// --- Abrir módulo SPED ---
async function openSped() {
  const modal = document.getElementById('spedModal');
  if (!modal) return;
  if (!currentCliente) { alert('Selecione uma empresa antes de acessar o SPED.'); return; }
  modal.style.display = 'flex';
  await spedCarregarPeriodos();
  switchSpedTab('periodos');
  lucide.createIcons();
}

async function closeSped() {
  const modal = document.getElementById('spedModal');
  if (modal) modal.style.display = 'none';
}

async function switchSpedTab(tab) {
  document.querySelectorAll('.sped-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.sped-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`spedPanel_${tab}`)?.classList.remove('hidden');
  document.querySelector(`[onclick="switchSpedTab('${tab}')"]`)?.classList.add('active');
}

// ============================================================
// PERÍODOS
// ============================================================

async function spedCarregarPeriodos() {
  const lista = document.getElementById('spedListaPeriodos');
  if (!lista) return;
  lista.innerHTML = '<div class="sped-loading">Carregando...</div>';

  const { data, error } = await sb
    .from('sped_periodos')
    .select('*')
    .eq('cliente_id', currentCliente.id)
    .order('dt_ini', { ascending: false });

  if (error) { lista.innerHTML = '<div class="sped-msg error">Erro ao carregar períodos.</div>'; return; }

  if (!data?.length) {
    lista.innerHTML = '<div class="sped-msg">Nenhum período cadastrado. Crie um novo acima.</div>';
    return;
  }

  lista.innerHTML = data.map(p => `
    <div class="sped-periodo-card">
      <div class="sped-periodo-info">
        <strong>${formatarPeriodo(p.periodo)}</strong>
        <span class="sped-badge sped-badge-${p.status}">${p.status}</span>
      </div>
      <div class="sped-periodo-meta">
        ${p.dt_ini} a ${p.dt_fin} · UF: ${p.uf || '—'} · Perfil ${p.ind_perfil}
      </div>
      <div class="sped-periodo-actions">
        <button class="btn-sped-sm" onclick="spedAbrirPeriodo('${p.id}')">
          <i data-lucide="folder-open" style="width:13px;height:13px"></i> Abrir
        </button>
        <button class="btn-sped-sm btn-sped-generate" onclick="spedGerarTxt('${p.id}')">
          <i data-lucide="download" style="width:13px;height:13px"></i> Gerar .txt
        </button>
        <button class="btn-sped-sm btn-sped-danger" onclick="spedExcluirPeriodo('${p.id}')">
          <i data-lucide="trash-2" style="width:13px;height:13px"></i>
        </button>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function formatarPeriodo(periodo) {
  if (!periodo || periodo.length !== 6) return periodo;
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const m = parseInt(periodo.substring(0,2)) - 1;
  const a = periodo.substring(2);
  return `${meses[m]}/${a}`;
}

async function spedCriarPeriodo() {
  const mes   = document.getElementById('spedMes')?.value;
  const ano   = document.getElementById('spedAno')?.value;
  const uf    = document.getElementById('spedUF')?.value?.trim().toUpperCase();
  const ie    = document.getElementById('spedIE')?.value?.trim();
  const perfil = document.getElementById('spedPerfil')?.value || 'A';
  const ativ  = document.getElementById('spedAtiv')?.value || '0';
  const msg   = document.getElementById('spedPeriodoMsg');

  if (!mes || !ano || !uf) {
    if (msg) { msg.textContent = 'Mês, ano e UF são obrigatórios.'; msg.className = 'sped-msg error'; }
    return;
  }

  const periodo = `${String(mes).padStart(2,'0')}${ano}`;
  const dt_ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const dt_fin = `${ano}-${String(mes).padStart(2,'0')}-${lastDay}`;

  const { data, error } = await sb.from('sped_periodos').insert({
    cliente_id: currentCliente.id,
    user_id: currentUser.id,
    periodo, dt_ini, dt_fin,
    nome_emp: currentCliente.razao_social,
    cnpj: currentCliente.cnpj?.replace(/\D/g,''),
    uf, ie: ie || '',
    ind_perfil: perfil,
    ind_ativ: ativ,
    status: 'rascunho'
  }).select().single();

  if (error) {
    if (msg) { msg.textContent = 'Erro ao criar período: ' + error.message; msg.className = 'sped-msg error'; }
    return;
  }

  if (msg) { msg.textContent = 'Período criado!'; msg.className = 'sped-msg success'; }
  setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
  await spedCarregarPeriodos();
}

async function spedAbrirPeriodo(id) {
  const { data, error } = await sb.from('sped_periodos').select('*').eq('id', id).maybeSingle();
  if (error || !data) { alert('Erro ao abrir período.'); return; }
  spedPeriodo = data;

  document.getElementById('spedPeriodoAtual').textContent =
    `${formatarPeriodo(data.periodo)} — ${data.nome_emp || currentCliente.razao_social}`;

  await Promise.all([
    spedCarregarDocs(),
    spedCarregarParticipantes(),
    spedCarregarProdutos(),
    spedCarregarApuracao()
  ]);
  switchSpedTab('documentos');
}

async function spedExcluirPeriodo(id) {
  if (!confirm('Excluir este período e todos os dados? Esta ação não pode ser desfeita.')) return;
  await sb.from('sped_periodos').delete().eq('id', id);
  if (spedPeriodo?.id === id) spedPeriodo = null;
  await spedCarregarPeriodos();
}

// ============================================================
// DOCUMENTOS FISCAIS (C100)
// ============================================================

async function spedCarregarDocs() {
  if (!spedPeriodo) return;
  const { data } = await sb.from('sped_documentos')
    .select('*').eq('periodo_id', spedPeriodo.id).order('dt_doc');
  spedDocs = data || [];
  spedRenderDocs();
}

async function spedRenderDocs() {
  const lista = document.getElementById('spedListaDocs');
  if (!lista) return;

  if (!spedDocs.length) {
    lista.innerHTML = '<div class="sped-msg">Nenhum documento. Adicione uma NF acima.</div>';
    return;
  }

  const totEntradas = spedDocs.filter(d => d.ind_oper === '0').reduce((s,d) => s + parseFloat(d.vl_doc||0), 0);
  const totSaidas   = spedDocs.filter(d => d.ind_oper === '1').reduce((s,d) => s + parseFloat(d.vl_doc||0), 0);

  lista.innerHTML = `
    <div class="sped-totais">
      <span>Entradas: <strong>R$ ${totEntradas.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>
      <span>Saídas: <strong>R$ ${totSaidas.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>
    </div>
    <table class="sped-table">
      <thead><tr>
        <th>Tipo</th><th>NF</th><th>Data</th><th>Participante</th>
        <th>CFOP</th><th>Valor</th><th>ICMS</th><th></th>
      </tr></thead>
      <tbody>
        ${spedDocs.map(d => `
          <tr>
            <td><span class="sped-badge ${d.ind_oper==='0'?'sped-badge-entrada':'sped-badge-saida'}">${d.ind_oper==='0'?'E':'S'}</span></td>
            <td>${escapeHtml(d.num_doc)} ${d.ser?`-${escapeHtml(d.ser)}`:''}</td>
            <td>${d.dt_doc}</td>
            <td>${escapeHtml(d.cod_part||'—')}</td>
            <td>${escapeHtml(d.vl_bc_icms > 0 ? '(ver itens)' : '—')}</td>
            <td>R$ ${parseFloat(d.vl_doc||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
            <td>R$ ${parseFloat(d.vl_icms||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
            <td>
              <button class="btn-sped-sm btn-sped-danger" onclick="spedExcluirDoc('${d.id}')">
                <i data-lucide="trash-2" style="width:12px;height:12px"></i>
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  lucide.createIcons();
}

async function spedAdicionarDoc() {
  if (!spedPeriodo) { alert('Abra um período primeiro.'); return; }

  const oper    = document.getElementById('docOper')?.value;
  const numDoc  = document.getElementById('docNum')?.value?.trim();
  const ser     = document.getElementById('docSer')?.value?.trim() || '';
  const codPart = document.getElementById('docPart')?.value?.trim();
  const dtDoc   = document.getElementById('docData')?.value;
  const vlDoc   = parseFloat(document.getElementById('docValor')?.value || 0);
  const vlIcms  = parseFloat(document.getElementById('docIcms')?.value || 0);
  const vlBcIcms= parseFloat(document.getElementById('docBcIcms')?.value || 0);
  const chvNfe  = document.getElementById('docChave')?.value?.trim() || '';
  const msg     = document.getElementById('spedDocMsg');

  if (!numDoc || !dtDoc) {
    if (msg) { msg.textContent = 'Número e data são obrigatórios.'; msg.className = 'sped-msg error'; }
    return;
  }

  const { error } = await sb.from('sped_documentos').insert({
    periodo_id: spedPeriodo.id,
    ind_oper: oper, ind_emit: '0', cod_mod: '55', cod_sit: '00',
    cod_part: codPart, num_doc: numDoc, ser, chv_nfe: chvNfe,
    dt_doc: dtDoc, dt_e_s: dtDoc,
    vl_doc: vlDoc, vl_merc: vlDoc,
    vl_bc_icms: vlBcIcms, vl_icms: vlIcms
  });

  if (error) {
    if (msg) { msg.textContent = 'Erro: ' + error.message; msg.className = 'sped-msg error'; }
    return;
  }

  // Limpar form
  ['docNum','docSer','docPart','docData','docValor','docIcms','docBcIcms','docChave'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (msg) { msg.textContent = 'Documento adicionado!'; msg.className = 'sped-msg success'; }
  setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
  await spedCarregarDocs();
  await spedRecalcularApuracao();
}

async function spedExcluirDoc(id) {
  await sb.from('sped_documentos').delete().eq('id', id);
  spedDocs = spedDocs.filter(d => d.id !== id);
  spedRenderDocs();
  await spedRecalcularApuracao();
}

// ============================================================
// PARTICIPANTES (0150)
// ============================================================

async function spedCarregarParticipantes() {
  if (!spedPeriodo) return;
  const { data } = await sb.from('sped_participantes')
    .select('*').eq('periodo_id', spedPeriodo.id).order('cod_part');
  spedParts = data || [];
  spedRenderParticipantes();
}

async function spedRenderParticipantes() {
  const lista = document.getElementById('spedListaParts');
  if (!lista) return;
  if (!spedParts.length) {
    lista.innerHTML = '<div class="sped-msg">Nenhum participante cadastrado.</div>'; return;
  }
  lista.innerHTML = `
    <table class="sped-table">
      <thead><tr><th>Código</th><th>Nome</th><th>CNPJ/CPF</th><th>Município</th><th></th></tr></thead>
      <tbody>${spedParts.map(p => `
        <tr>
          <td>${escapeHtml(p.cod_part)}</td>
          <td>${escapeHtml(p.nome)}</td>
          <td>${escapeHtml(p.cnpj || p.cpf || '—')}</td>
          <td>${escapeHtml(p.cod_mun || '—')}</td>
          <td><button class="btn-sped-sm btn-sped-danger" onclick="spedExcluirPart('${p.id}')">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i></button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  lucide.createIcons();
}

async function spedAdicionarParticipante() {
  if (!spedPeriodo) { alert('Abra um período primeiro.'); return; }
  const cod  = document.getElementById('partCod')?.value?.trim();
  const nome = document.getElementById('partNome')?.value?.trim();
  const cnpj = document.getElementById('partCnpj')?.value?.replace(/\D/g,'') || '';
  const ie   = document.getElementById('partIE')?.value?.trim() || '';
  const mun  = document.getElementById('partMun')?.value?.trim() || '';
  const msg  = document.getElementById('spedPartMsg');

  if (!cod || !nome) {
    if (msg) { msg.textContent = 'Código e nome são obrigatórios.'; msg.className = 'sped-msg error'; }
    return;
  }

  const { error } = await sb.from('sped_participantes').insert({
    periodo_id: spedPeriodo.id, cod_part: cod, nome, cnpj, ie, cod_mun: mun
  });

  if (error) {
    if (msg) { msg.textContent = 'Erro: ' + error.message; msg.className = 'sped-msg error'; }
    return;
  }
  ['partCod','partNome','partCnpj','partIE','partMun'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  if (msg) { msg.textContent = 'Participante adicionado!'; msg.className = 'sped-msg success'; }
  setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
  await spedCarregarParticipantes();
}

async function spedExcluirPart(id) {
  await sb.from('sped_participantes').delete().eq('id', id);
  spedParts = spedParts.filter(p => p.id !== id);
  spedRenderParticipantes();
}

// ============================================================
// PRODUTOS (0200)
// ============================================================

async function spedCarregarProdutos() {
  if (!spedPeriodo) return;
  const { data } = await sb.from('sped_produtos')
    .select('*').eq('periodo_id', spedPeriodo.id).order('cod_item');
  spedProds = data || [];
  spedRenderProdutos();
}

async function spedRenderProdutos() {
  const lista = document.getElementById('spedListaProds');
  if (!lista) return;
  if (!spedProds.length) {
    lista.innerHTML = '<div class="sped-msg">Nenhum produto cadastrado.</div>'; return;
  }
  lista.innerHTML = `
    <table class="sped-table">
      <thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>Unid</th><th>Tipo</th><th>Alíq ICMS</th><th></th></tr></thead>
      <tbody>${spedProds.map(p => `
        <tr>
          <td>${escapeHtml(p.cod_item)}</td>
          <td>${escapeHtml(p.descr_item)}</td>
          <td>${escapeHtml(p.cod_ncm || '—')}</td>
          <td>${escapeHtml(p.unid_inv)}</td>
          <td>${escapeHtml(p.tipo_item)}</td>
          <td>${p.aliq_icms}%</td>
          <td><button class="btn-sped-sm btn-sped-danger" onclick="spedExcluirProd('${p.id}')">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i></button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  lucide.createIcons();
}

async function spedAdicionarProduto() {
  if (!spedPeriodo) { alert('Abra um período primeiro.'); return; }
  const cod   = document.getElementById('prodCod')?.value?.trim();
  const descr = document.getElementById('prodDescr')?.value?.trim();
  const ncm   = document.getElementById('prodNCM')?.value?.trim() || '';
  const unid  = document.getElementById('prodUnid')?.value?.trim() || 'UN';
  const tipo  = document.getElementById('prodTipo')?.value || '00';
  const aliq  = parseFloat(document.getElementById('prodAliq')?.value || 0);
  const msg   = document.getElementById('spedProdMsg');

  if (!cod || !descr) {
    if (msg) { msg.textContent = 'Código e descrição são obrigatórios.'; msg.className = 'sped-msg error'; }
    return;
  }

  const { error } = await sb.from('sped_produtos').insert({
    periodo_id: spedPeriodo.id, cod_item: cod, descr_item: descr,
    cod_ncm: ncm, unid_inv: unid, tipo_item: tipo, aliq_icms: aliq
  });

  if (error) {
    if (msg) { msg.textContent = 'Erro: ' + error.message; msg.className = 'sped-msg error'; }
    return;
  }
  ['prodCod','prodDescr','prodNCM','prodUnid','prodAliq'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  if (msg) { msg.textContent = 'Produto adicionado!'; msg.className = 'sped-msg success'; }
  setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
  await spedCarregarProdutos();
}

async function spedExcluirProd(id) {
  await sb.from('sped_produtos').delete().eq('id', id);
  spedProds = spedProds.filter(p => p.id !== id);
  spedRenderProdutos();
}

// ============================================================
// APURAÇÃO DO ICMS (E110)
// ============================================================

async function spedCarregarApuracao() {
  if (!spedPeriodo) return;
  const { data } = await sb.from('sped_apuracao_icms')
    .select('*').eq('periodo_id', spedPeriodo.id).maybeSingle();
  spedApuracao = data;
  spedRenderApuracao();
}

async function spedRenderApuracao() {
  if (!spedApuracao) { spedRecalcularApuracao(); return; }
  const a = spedApuracao;
  const saldo = parseFloat(a.vl_icms_recolher || 0);
  const credor = parseFloat(a.vl_sld_credor_transportar || 0);

  const el = document.getElementById('spedApuracaoResumo');
  if (!el) return;
  el.innerHTML = `
    <div class="sped-apuracao-grid">
      <div class="sped-apuracao-item">
        <span>Débitos (saídas)</span>
        <strong>R$ ${parseFloat(a.vl_tot_debitos||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
      </div>
      <div class="sped-apuracao-item">
        <span>Créditos (entradas)</span>
        <strong>R$ ${parseFloat(a.vl_tot_creditos||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
      </div>
      <div class="sped-apuracao-item">
        <span>Saldo credor anterior</span>
        <strong>R$ ${parseFloat(a.vl_sld_credor_ant||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
      </div>
      <div class="sped-apuracao-item sped-resultado ${saldo > 0 ? 'debit' : 'credit'}">
        <span>${saldo > 0 ? '⚠️ ICMS a Recolher' : '✅ Saldo Credor'}</span>
        <strong>R$ ${(saldo > 0 ? saldo : credor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
      </div>
    </div>`;

  // Preencher inputs manuais
  ['vl_aj_debitos','vl_estornos_cred','vl_aj_creditos','vl_estornos_deb',
   'vl_sld_credor_ant','vl_tot_ded','deb_esp'].forEach(field => {
    const el2 = document.getElementById(`apuracao_${field}`);
    if (el2) el2.value = parseFloat(a[field] || 0).toFixed(2);
  });
}

async function spedRecalcularApuracao() {
  if (!spedPeriodo) return;

  // Recarregar docs do banco para ter valores atualizados
  const { data: docs } = await sb.from('sped_documentos')
    .select('*').eq('periodo_id', spedPeriodo.id);
  const allDocs = docs || [];

  const debitos  = allDocs.filter(d => d.ind_oper === '1').reduce((s,d) => s + parseFloat(d.vl_icms||0), 0);
  const creditos = allDocs.filter(d => d.ind_oper === '0').reduce((s,d) => s + parseFloat(d.vl_icms||0), 0);

  // Pegar ajustes manuais dos inputs
  const ajDeb    = parseFloat(document.getElementById('apuracao_vl_aj_debitos')?.value || 0);
  const estCred  = parseFloat(document.getElementById('apuracao_vl_estornos_cred')?.value || 0);
  const ajCred   = parseFloat(document.getElementById('apuracao_vl_aj_creditos')?.value || 0);
  const estDeb   = parseFloat(document.getElementById('apuracao_vl_estornos_deb')?.value || 0);
  const sldAnt   = parseFloat(document.getElementById('apuracao_vl_sld_credor_ant')?.value || 0);
  const totDed   = parseFloat(document.getElementById('apuracao_vl_tot_ded')?.value || 0);
  const debEsp   = parseFloat(document.getElementById('apuracao_deb_esp')?.value || 0);

  const totDebAjust = debitos + ajDeb - estDeb;
  const totCredAjust = creditos + ajCred - estCred;
  const saldoApurado = totDebAjust - totCredAjust - sldAnt;
  const icmsRecolher = Math.max(0, saldoApurado - totDed + debEsp);
  const sldCreedor   = saldoApurado < 0 ? Math.abs(saldoApurado) : 0;

  const payload = {
    periodo_id: spedPeriodo.id,
    vl_tot_debitos: debitos,
    vl_aj_debitos: ajDeb,
    vl_tot_aj_deb: totDebAjust,
    vl_estornos_cred: estCred,
    vl_tot_creditos: creditos,
    vl_aj_creditos: ajCred,
    vl_tot_aj_cred: totCredAjust,
    vl_estornos_deb: estDeb,
    vl_sld_credor_ant: sldAnt,
    vl_sld_apurado: saldoApurado,
    vl_tot_ded: totDed,
    vl_icms_recolher: icmsRecolher,
    vl_sld_credor_transportar: sldCreedor,
    deb_esp: debEsp
  };

  const { data: existing } = await sb.from('sped_apuracao_icms')
    .select('id').eq('periodo_id', spedPeriodo.id).maybeSingle();

  if (existing?.id) {
    await sb.from('sped_apuracao_icms').update(payload).eq('id', existing.id);
  } else {
    await sb.from('sped_apuracao_icms').insert(payload);
  }

  await spedCarregarApuracao();
}

// ============================================================
// GERAÇÃO DO ARQUIVO .TXT — EFD-ICMS/IPI
// ============================================================

async function spedGerarTxt(periodoId) {
  const pid = periodoId || spedPeriodo?.id;
  if (!pid) { alert('Abra um período antes de gerar.'); return; }

  try {
    // Carregar todos os dados
    const [{ data: per }, { data: parts }, { data: prods }, { data: docs }, { data: apuracao }] =
      await Promise.all([
        sb.from('sped_periodos').select('*').eq('id', pid).maybeSingle(),
        sb.from('sped_participantes').select('*').eq('periodo_id', pid),
        sb.from('sped_produtos').select('*').eq('periodo_id', pid),
        sb.from('sped_documentos').select('*').eq('periodo_id', pid).order('dt_doc'),
        sb.from('sped_apuracao_icms').select('*').eq('periodo_id', pid).maybeSingle()
      ]);

    if (!per) { alert('Período não encontrado.'); return; }

    const linhas = [];
    let totalLinhas = 0;

    const add = (registro) => {
      linhas.push(`|${registro}|`);
      totalLinhas++;
    };

    const fmt = (val, decimals = 2) => {
      if (val === null || val === undefined || val === '') return '';
      const n = parseFloat(val);
      if (isNaN(n)) return String(val);
      return n.toFixed(decimals).replace('.', ',');
    };

    const fmtDate = (d) => {
      if (!d) return '';
      return d.replace(/-/g,'').replace(/(\d{4})(\d{2})(\d{2})/,'$3$2$1');
    };

    const cnpjLimpo = (per.cnpj || '').replace(/\D/g,'');
    const dtIni = fmtDate(per.dt_ini);
    const dtFin = fmtDate(per.dt_fin);

    // ===== BLOCO 0 =====
    // 0000 — Abertura
    add(`0000|${dtIni}|${dtFin}|${per.nome_emp||''}|${cnpjLimpo}||${per.uf||''}|${per.ie||''}|${per.cod_mun||''}|${per.im||''}|${per.suframa||''}|${per.ind_perfil||'A'}|${per.ind_ativ||'0'}`);
    // 0001 — Abertura do Bloco 0
    add(`0001|0`);
    // 0005 — Dados complementares
    add(`0005|EFD|${per.ie||''}|||${per.nome_emp||''}||||`);
    // 0100 — Dados do contabilista
    const perfil = perfilCache || {};
    add(`0100|${perfil.nome||''}|${cnpjLimpo}||||||||${perfil.crc||''}|`);
    // 0150 — Participantes
    (parts||[]).forEach(p => {
      add(`0150|${p.cod_part}|${p.nome}|${p.cod_pais||'1058'}|${(p.cnpj||'').replace(/\D/g,'')}|${(p.cpf||'').replace(/\D/g,'')}|${p.ie||''}|${p.cod_mun||''}|${p.suframa||''}|${p.end_part||''}|${p.num_part||''}|${p.compl_part||''}|${p.bairro_part||''}`);
    });
    // 0190 — Unidades de medida (extrair das únicas dos produtos)
    const unidades = [...new Set((prods||[]).map(p => p.unid_inv).filter(Boolean))];
    unidades.forEach(u => add(`0190|${u}|`));
    // 0200 — Produtos
    (prods||[]).forEach(p => {
      add(`0200|${p.cod_item}|${p.descr_item}|${p.cod_barra||''}|${p.cod_ant_item||''}|${p.unid_inv}|${p.tipo_item||'00'}|${p.cod_ncm||''}|${p.ex_ipi||''}|${p.cod_gen||''}|${p.cod_lst||''}|${fmt(p.aliq_icms)}`);
    });
    // 0990 — Encerramento do Bloco 0
    const cnt0 = linhas.length + 1;
    add(`0990|${cnt0}`);

    // ===== BLOCO C =====
    add(`C001|0`);
    (docs||[]).forEach(d => {
      add(`C100|${d.ind_oper}|${d.ind_emit||'0'}|${d.cod_part||''}|${d.cod_mod||'55'}|${d.cod_sit||'00'}|${d.ser||''}|${d.num_doc}|${d.chv_nfe||''}|${fmtDate(d.dt_doc)}|${fmtDate(d.dt_e_s||d.dt_doc)}|${fmt(d.vl_doc)}|${d.ind_pgto||'0'}|${fmt(d.vl_desc)}|${fmt(d.vl_abat_nt)}|${fmt(d.vl_merc||d.vl_doc)}|${d.ind_frt||'9'}|${fmt(d.vl_frt)}|${fmt(d.vl_seg)}|${fmt(d.vl_out_da)}|${fmt(d.vl_bc_icms)}|${fmt(d.vl_icms)}|${fmt(d.vl_bc_icms_st)}|${fmt(d.vl_icms_st)}|${fmt(d.vl_ipi)}|${fmt(d.vl_pis)}|${fmt(d.vl_cofins)}|${fmt(d.vl_pis_st)}|${fmt(d.vl_cofins_st)}`);
      // C190 — registro analítico (resumo por CST/CFOP)
      // Simplificado: uma linha por documento
      if (parseFloat(d.vl_bc_icms) > 0 || parseFloat(d.vl_icms) > 0) {
        const cfopBase = d.ind_oper === '0' ? '1102' : '5102'; // CFOP genérico se não informado
        add(`C190|000|${cfopBase}|${fmt(0)}|${fmt(d.vl_doc)}|${fmt(d.vl_bc_icms)}|${fmt(0)}|${fmt(d.vl_icms)}|${fmt(0)}|${fmt(0)}|${fmt(0)}|${fmt(0)}|${fmt(0)}|${fmt(0)}|${fmt(0)}|${fmt(0)}`);
      }
    });
    const cntC = linhas.filter(l => l.startsWith('|C')).length + 1;
    add(`C990|${cntC + 1}`);

    // ===== BLOCO E — Apuração do ICMS =====
    add(`E001|0`);
    const ap = apuracao || {};
    add(`E110|${fmt(ap.vl_tot_debitos)}|${fmt(ap.vl_aj_debitos)}|${fmt(ap.vl_tot_aj_deb)}|${fmt(ap.vl_estornos_cred)}|${fmt(ap.vl_tot_creditos)}|${fmt(ap.vl_aj_creditos)}|${fmt(ap.vl_tot_aj_cred)}|${fmt(ap.vl_estornos_deb)}|${fmt(ap.vl_sld_credor_ant)}|${fmt(ap.vl_sld_apurado)}|${fmt(ap.vl_tot_ded)}|${fmt(ap.vl_icms_recolher)}|${fmt(ap.vl_sld_credor_transportar)}|${fmt(ap.deb_esp)}`);
    const cntE = linhas.filter(l => l.startsWith('|E')).length + 1;
    add(`E990|${cntE + 1}`);

    // ===== BLOCO G — CIAP (vazio para caso base) =====
    add(`G001|1`);
    add(`G990|2`);

    // ===== BLOCO H — Inventário (vazio para caso base) =====
    add(`H001|1`);
    add(`H990|2`);

    // ===== BLOCO K — Produção (vazio — apenas indústria) =====
    if (per.ind_ativ === '1') {
      add(`K001|1`);
      add(`K990|2`);
    }

    // ===== BLOCO 9 — Encerramento =====
    add(`9001|0`);
    // 9900 — Totais por bloco
    const blocos = ['0','C','E','G','H','9'];
    blocos.forEach(b => {
      const cnt = linhas.filter(l => l.startsWith(`|${b}`)).length;
      if (cnt > 0) add(`9900|${b}|${cnt}`);
    });
    const totalFinal = linhas.length + 2; // +9001 +9990
    add(`9990|${totalFinal}`);
    add(`9999|${totalFinal}`);

    // Montar arquivo
    const conteudo = linhas.join('\r\n') + '\r\n';
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `SPED_EFD_${cnpjLimpo}_${per.periodo}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    // Atualizar status do período
    await sb.from('sped_periodos').update({ status: 'gerado', updated_at: new Date().toISOString() }).eq('id', pid);
    await spedCarregarPeriodos();

    alert(`✅ Arquivo gerado com ${linhas.length} registros.\n\nImporte no PVA (Programa Validador e Assinador) da RFB para validar, assinar com certificado digital e transmitir.\n\nDownload: SPED_EFD_${cnpjLimpo}_${per.periodo}.txt`);

  } catch(e) {
    console.error('Erro ao gerar SPED:', e);
    alert('Erro ao gerar o arquivo: ' + e.message);
  }
}
