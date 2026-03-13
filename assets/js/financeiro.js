// ============================================================
// FINANCEIRO.JS — Lançamentos + Fluxo de Caixa
//
// SQL NECESSÁRIO NO SUPABASE:
// ─────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS lancamentos (
//   id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id      uuid REFERENCES auth.users NOT NULL,
//   cliente_id   uuid REFERENCES clientes(id) ON DELETE CASCADE,
//   tipo         text NOT NULL CHECK (tipo IN ('receita','despesa')),
//   categoria    text NOT NULL,
//   descricao    text NOT NULL,
//   valor        numeric(12,2) NOT NULL CHECK (valor > 0),
//   data_venc    date NOT NULL,
//   data_pgto    date,
//   status       text DEFAULT 'pendente' CHECK (status IN ('pendente','pago','cancelado')),
//   observacao   text,
//   criado_em    timestamptz DEFAULT now(),
//   atualizado_em timestamptz DEFAULT now()
// );
// ALTER TABLE lancamentos ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "lanc_own" ON lancamentos
//   USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
// CREATE INDEX idx_lanc_cliente_venc ON lancamentos(user_id, cliente_id, data_venc);
// ─────────────────────────────────────────────────────────────

// ── Estado ───────────────────────────────────────────────────
let lancamentos     = [];
let lancFiltroMes   = new Date().getMonth();
let lancFiltroAno   = new Date().getFullYear();
let lancFiltroTipo  = 'todos';
let lancEditandoId  = null;

const CATEGORIAS_RECEITA = [
  'Honorários contábeis','Consultoria','Serviços avulsos',
  'Reembolso','Outros recebimentos'
];
const CATEGORIAS_DESPESA = [
  'Impostos e tributos','Folha de pagamento','Aluguel',
  'Fornecedores','Serviços de terceiros','Tarifas bancárias',
  'Material de escritório','Software e tecnologia','Outras despesas'
];

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun',
               'Jul','Ago','Set','Out','Nov','Dez'];

// ── Abrir / Fechar ───────────────────────────────────────────
async function openFinanceiro() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.','warn'); return; }
  closeDropdowns();
  lancFiltroMes = new Date().getMonth();
  lancFiltroAno = new Date().getFullYear();
  document.getElementById('finModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  lancNovoForm();
  await finCarregar();
}

function closeFinanceiro() {
  document.getElementById('finModal').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Carregar do banco ─────────────────────────────────────────
async function finCarregar() {
  finRenderLoading();
  const ano = lancFiltroAno;
  const { data, error } = await sb
    .from('lancamentos')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('cliente_id', currentCliente.id)
    .gte('data_venc', `${ano}-01-01`)
    .lte('data_venc', `${ano}-12-31`)
    .order('data_venc', { ascending: false });

  if (error) { showToast('Erro ao carregar lançamentos.','error'); return; }
  lancamentos = data || [];
  finRenderTudo();
}

// ── Renderização ─────────────────────────────────────────────
function finRenderLoading() {
  document.getElementById('finLista').innerHTML =
    '<div class="dp-loading"><div class="dp-spin"></div> Carregando...</div>';
}

function finRenderTudo() {
  finRenderKPIs();
  finRenderFluxo();
  finRenderLista();
}

function finFiltrados() {
  return lancamentos.filter(l => {
    const d = new Date(l.data_venc + 'T12:00');
    const mesOk = d.getMonth() === lancFiltroMes && d.getFullYear() === lancFiltroAno;
    const tipoOk = lancFiltroTipo === 'todos' || l.tipo === lancFiltroTipo;
    return mesOk && tipoOk;
  });
}

function finRenderKPIs() {
  const todos = lancamentos;
  const mesAtual = new Date().getMonth();
  const anoAtual = new Date().getFullYear();

  const doMes = todos.filter(l => {
    const d = new Date(l.data_venc + 'T12:00');
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
  });

  const recMes  = doMes.filter(l => l.tipo === 'receita').reduce((a,l) => a + +l.valor, 0);
  const despMes = doMes.filter(l => l.tipo === 'despesa').reduce((a,l) => a + +l.valor, 0);
  const saldoMes = recMes - despMes;

  const vencidos = todos.filter(l =>
    l.status === 'pendente' && new Date(l.data_venc + 'T12:00') < new Date()
  );
  const totalVencido = vencidos.reduce((a,l) => a + +l.valor, 0);

  const kpis = [
    { icon:'trending-up',  label:'Receitas do mês', val: recMes,     cor:'#16a34a' },
    { icon:'trending-down',label:'Despesas do mês',  val: despMes,    cor:'#dc2626' },
    { icon:'wallet',       label:'Saldo do mês',    val: saldoMes,   cor: saldoMes >= 0 ? '#2563eb' : '#dc2626' },
    { icon:'alert-circle', label:'Em atraso',       val: totalVencido, cor:'#d97706', count: vencidos.length },
  ];

  document.getElementById('finKPIs').innerHTML = kpis.map(k => `
    <div class="fin-kpi">
      <div class="fin-kpi-icon" style="color:${k.cor}">
        <i data-lucide="${k.icon}" style="width:18px;height:18px"></i>
      </div>
      <div>
        <div class="fin-kpi-lbl">${k.label}${k.count ? ` <span class="fin-badge-warn">${k.count}</span>` : ''}</div>
        <div class="fin-kpi-val" style="color:${k.cor}">${fmtBRL(Math.abs(k.val))}${k.val < 0 ? ' ⚠️' : ''}</div>
      </div>
    </div>`).join('');
  lucide.createIcons();
}

function finRenderFluxo() {
  // Barras mensais do ano corrente
  const ano = lancFiltroAno;
  const meses = Array.from({length:12}, (_,i) => {
    const rec  = lancamentos.filter(l => {
      const d = new Date(l.data_venc+'T12:00');
      return d.getMonth()===i && d.getFullYear()===ano && l.tipo==='receita';
    }).reduce((a,l) => a + +l.valor, 0);
    const desp = lancamentos.filter(l => {
      const d = new Date(l.data_venc+'T12:00');
      return d.getMonth()===i && d.getFullYear()===ano && l.tipo==='despesa';
    }).reduce((a,l) => a + +l.valor, 0);
    return { mes: MESES[i], rec, desp, saldo: rec - desp };
  });

  const maxVal = Math.max(...meses.map(m => Math.max(m.rec, m.desp)), 1);
  const mesAtual = new Date().getMonth();

  document.getElementById('finFluxo').innerHTML = `
    <div class="fin-chart-wrap">
      <div class="fin-chart">
        ${meses.map((m,i) => `
          <div class="fin-chart-col ${i === lancFiltroMes ? 'active' : ''}"
               onclick="lancFiltroMes=${i};finRenderTudo()" style="cursor:pointer" title="${m.mes}: Rec ${fmtBRL(m.rec)} / Desp ${fmtBRL(m.desp)}">
            <div class="fin-chart-bars">
              <div class="fin-bar fin-bar-rec" style="height:${Math.round(m.rec/maxVal*100)}%"></div>
              <div class="fin-bar fin-bar-desp" style="height:${Math.round(m.desp/maxVal*100)}%"></div>
            </div>
            <div class="fin-chart-label ${i === mesAtual ? 'hoje' : ''}">${m.mes}</div>
            <div class="fin-chart-saldo ${m.saldo >= 0 ? 'pos' : 'neg'}">${m.saldo >= 0 ? '+' : '-'}${fmtBRLk(Math.abs(m.saldo))}</div>
          </div>`).join('')}
      </div>
      <div class="fin-legend">
        <span><span class="fin-dot-rec"></span>Receitas</span>
        <span><span class="fin-dot-desp"></span>Despesas</span>
        <span style="font-size:11px;color:var(--text-light)">Clique no mês para filtrar</span>
      </div>
    </div>`;
}

function finRenderLista() {
  const lista = finFiltrados();
  const mesLabel = `${MESES[lancFiltroMes]}/${lancFiltroAno}`;

  if (!lista.length) {
    document.getElementById('finLista').innerHTML =
      `<p class="dp-empty">Nenhum lançamento em ${mesLabel}.</p>`;
    document.getElementById('finMesLabel').textContent = mesLabel;
    return;
  }

  // Agrupar por status
  const pendentes = lista.filter(l => l.status === 'pendente');
  const pagos     = lista.filter(l => l.status === 'pago');

  const renderGrupo = (titulo, itens, cor) => {
    if (!itens.length) return '';
    return `
      <div class="fin-grupo-label" style="color:${cor}">${titulo} (${itens.length})</div>
      ${itens.map(l => finRenderLancamento(l)).join('')}`;
  };

  document.getElementById('finLista').innerHTML =
    renderGrupo('🕐 Pendentes', pendentes, 'var(--text-light)') +
    renderGrupo('✅ Pagos', pagos, '#16a34a');

  document.getElementById('finMesLabel').textContent = mesLabel;
  lucide.createIcons();
}

function finRenderLancamento(l) {
  const venceu = l.status === 'pendente' && new Date(l.data_venc+'T12:00') < new Date();
  const isRec  = l.tipo === 'receita';
  const dataFmt = new Date(l.data_venc+'T12:00').toLocaleDateString('pt-BR');
  return `
    <div class="fin-item ${venceu ? 'fin-item-vencido' : ''}">
      <div class="fin-item-left">
        <div class="fin-tipo-dot" style="background:${isRec ? '#16a34a' : '#dc2626'}"></div>
        <div>
          <div class="fin-item-desc">${escapeHtml(l.descricao)}</div>
          <div class="fin-item-meta">${escapeHtml(l.categoria)} · Venc: ${dataFmt}${l.data_pgto ? ' · Pago: '+new Date(l.data_pgto+'T12:00').toLocaleDateString('pt-BR') : ''}${venceu ? ' <span style="color:#dc2626;font-weight:600">VENCIDO</span>' : ''}</div>
        </div>
      </div>
      <div class="fin-item-right">
        <div class="fin-item-valor" style="color:${isRec ? '#16a34a' : '#dc2626'}">${isRec ? '+' : '-'} R$ ${fmtBRL(+l.valor)}</div>
        <div class="fin-item-acoes">
          ${l.status === 'pendente' ? `<button class="fin-btn-sm fin-btn-pagar" onclick="finMarcarPago('${l.id}')">Pago</button>` : ''}
          <button class="fin-btn-sm" onclick="finEditar('${l.id}')"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>
          <button class="fin-btn-sm fin-btn-del" onclick="finExcluir('${l.id}')"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
        </div>
      </div>
    </div>`;
}

// ── Formulário ───────────────────────────────────────────────
function lancNovoForm() {
  lancEditandoId = null;
  document.getElementById('lancFormTitulo').textContent = 'Novo Lançamento';
  document.getElementById('lancId').value = '';
  document.getElementById('lancTipo').value = 'despesa';
  lancAtualizarCategorias();
  document.getElementById('lancDescricao').value = '';
  document.getElementById('lancValor').value = '';
  document.getElementById('lancVenc').value = new Date().toISOString().slice(0,10);
  document.getElementById('lancPgto').value = '';
  document.getElementById('lancObs').value = '';
  document.getElementById('lancStatus').value = 'pendente';
  document.getElementById('lancDescricao').focus();
}

function lancAtualizarCategorias() {
  const tipo = document.getElementById('lancTipo').value;
  const cats = tipo === 'receita' ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
  const sel  = document.getElementById('lancCategoria');
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function finEditar(id) {
  const l = lancamentos.find(x => x.id === id);
  if (!l) return;
  lancEditandoId = id;
  document.getElementById('lancFormTitulo').textContent = 'Editar Lançamento';
  document.getElementById('lancId').value        = l.id;
  document.getElementById('lancTipo').value      = l.tipo;
  lancAtualizarCategorias();
  document.getElementById('lancCategoria').value = l.categoria;
  document.getElementById('lancDescricao').value = l.descricao;
  document.getElementById('lancValor').value     = l.valor;
  document.getElementById('lancVenc').value      = l.data_venc;
  document.getElementById('lancPgto').value      = l.data_pgto || '';
  document.getElementById('lancStatus').value    = l.status;
  document.getElementById('lancObs').value       = l.observacao || '';
  // Scroll para o form
  document.getElementById('lancForm').scrollIntoView({ behavior:'smooth', block:'nearest' });
  document.getElementById('lancDescricao').focus();
}

async function finSalvar() {
  const descricao = document.getElementById('lancDescricao').value.trim();
  const valor     = parseFloat(document.getElementById('lancValor').value);
  const data_venc = document.getElementById('lancVenc').value;

  if (!descricao) { showToast('Informe a descrição.','warn'); return; }
  if (!valor || valor <= 0) { showToast('Informe um valor válido.','warn'); return; }
  if (!data_venc) { showToast('Informe a data de vencimento.','warn'); return; }

  const btn = document.getElementById('finSalvarBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const _escFin = await getEscritorioIdAtual();
  const payload = {
    user_id:      currentUser.id,
    cliente_id:   currentCliente.id,
    escritorio_id: _escFin,
    tipo:         document.getElementById('lancTipo').value,
    categoria:    document.getElementById('lancCategoria').value,
    descricao,
    valor,
    data_venc,
    data_pgto:    document.getElementById('lancPgto').value || null,
    status:       document.getElementById('lancStatus').value,
    observacao:   document.getElementById('lancObs').value.trim() || null,
    atualizado_em: new Date().toISOString(),
  };

  let error;
  if (lancEditandoId) {
    ({ error } = await sb.from('lancamentos').update(payload).eq('id', lancEditandoId).eq('user_id', currentUser.id));
  } else {
    ({ error } = await sb.from('lancamentos').insert(payload));
  }

  btn.disabled = false;
  btn.textContent = 'Salvar';

  if (error) { showToast('Erro ao salvar: ' + error.message,'error'); return; }
  showToast(lancEditandoId ? 'Lançamento atualizado.' : 'Lançamento salvo.','success');
  if (typeof EmpresaContext !== 'undefined') EmpresaContext.invalidar();

  lancNovoForm();
  await finCarregar();
}

async function finMarcarPago(id) {
  const { error } = await sb.from('lancamentos').update({
    status: 'pago',
    data_pgto: new Date().toISOString().slice(0,10),
    atualizado_em: new Date().toISOString(),
  }).eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Erro ao atualizar.','error'); return; }
  showToast('Marcado como pago.','success');
  await finCarregar();
}

async function finExcluir(id) {
  const ok = await showConfirm('Excluir este lançamento?');
  if (!ok) return;
  const { error } = await sb.from('lancamentos').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Erro ao excluir.','error'); return; }
  showToast('Lançamento excluído.','success');
  await finCarregar();
}

// ── Exportações ──────────────────────────────────────────────
function finExportarPDF() {
  const lista = finFiltrados();
  const mesLabel = `${MESES[lancFiltroMes]}/${lancFiltroAno}`;
  const cliente = typeof currentCliente !== 'undefined' ? (currentCliente?.razao_social || '') : '';

  const totalRec  = lista.filter(l => l.tipo === 'receita').reduce((s, l) => s + (+l.valor||0), 0);
  const totalDesp = lista.filter(l => l.tipo === 'despesa').reduce((s, l) => s + (+l.valor||0), 0);
  const saldo     = totalRec - totalDesp;

  const linhas = lista.map(l => {
    const data = new Date(l.data_venc+'T12:00').toLocaleDateString('pt-BR');
    const sinal = l.tipo === 'receita' ? '+' : '-';
    const cor   = l.tipo === 'receita' ? '#16a34a' : '#dc2626';
    return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 8px;font-size:12px">${data}</td>
        <td style="padding:6px 8px;font-size:12px">${l.descricao||''}</td>
        <td style="padding:6px 8px;font-size:12px;color:#64748b">${l.categoria||''}</td>
        <td style="padding:6px 8px;font-size:12px;text-align:center">
          <span style="padding:2px 6px;border-radius:8px;font-size:11px;font-weight:600;
            background:${l.status==='pago'?'#dcfce7':'#fef9c3'};
            color:${l.status==='pago'?'#16a34a':'#d97706'}">
            ${l.status==='pago'?'Pago':'Pendente'}
          </span>
        </td>
        <td style="padding:6px 8px;font-size:12px;text-align:right;color:${cor};font-weight:600">
          ${sinal} R$ ${fmtBRL(+l.valor)}
        </td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Financeiro ${mesLabel}</title>
    <style>body{font-family:Arial,sans-serif;margin:32px;color:#1e293b}
    h2{margin:0 0 4px}p{margin:0 0 16px;color:#64748b;font-size:13px}
    table{width:100%;border-collapse:collapse}
    th{background:#f8fafc;padding:8px;font-size:12px;text-align:left;border-bottom:2px solid #e2e8f0}
    .resumo{display:flex;gap:24px;margin-bottom:20px}
    .resumo-item{padding:12px 20px;border-radius:8px;background:#f8fafc}
    .resumo-label{font-size:11px;color:#64748b}
    .resumo-valor{font-size:16px;font-weight:700;margin-top:2px}
    @media print{button{display:none}}</style>
  </head><body>
    <h2>Extrato Financeiro — ${mesLabel}</h2>
    <p>${cliente ? cliente + ' · ' : ''}Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    <div class="resumo">
      <div class="resumo-item"><div class="resumo-label">Receitas</div>
        <div class="resumo-valor" style="color:#16a34a">R$ ${fmtBRL(totalRec)}</div></div>
      <div class="resumo-item"><div class="resumo-label">Despesas</div>
        <div class="resumo-valor" style="color:#dc2626">R$ ${fmtBRL(totalDesp)}</div></div>
      <div class="resumo-item"><div class="resumo-label">Saldo</div>
        <div class="resumo-valor" style="color:${saldo>=0?'#16a34a':'#dc2626'}">R$ ${fmtBRL(saldo)}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Status</th><th style="text-align:right">Valor</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

function finExportarExcel() {
  const lista = finFiltrados();
  const mesLabel = `${MESES[lancFiltroMes]}_${lancFiltroAno}`;

  const header = ['Data Venc','Data Pgto','Tipo','Categoria','Descrição','Valor','Status','Observação'];
  const rows = lista.map(l => [
    l.data_venc || '',
    l.data_pgto || '',
    l.tipo === 'receita' ? 'Receita' : 'Despesa',
    l.categoria || '',
    l.descricao || '',
    +l.valor || 0,
    l.status === 'pago' ? 'Pago' : 'Pendente',
    l.observacao || '',
  ]);

  // Montar CSV (abre no Excel/Sheets sem dependência externa)
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))
    .join('\r\n');

  const bom = '﻿'; // UTF-8 BOM para Excel reconhecer acentos
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `Financeiro_${mesLabel}.csv`
  });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function finNavMes(delta) {
  lancFiltroMes += delta;
  if (lancFiltroMes < 0)  { lancFiltroMes = 11; lancFiltroAno--; }
  if (lancFiltroMes > 11) { lancFiltroMes = 0;  lancFiltroAno++; }
  finCarregar();
}

// ── Helpers ──────────────────────────────────────────────────
function fmtBRL(v)  { return (+v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtBRLk(v) {
  if (v >= 1000) return (v/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'k';
  return fmtBRL(v);
}
