// ============================================================
// HONORARIOS.JS — Módulo de Controle de Honorários
//
// SQL NECESSÁRIO NO SUPABASE:
// ─────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS honorarios (
//   id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id       uuid REFERENCES auth.users NOT NULL,
//   cliente_id    uuid REFERENCES clientes(id) ON DELETE CASCADE,
//   valor         numeric(12,2) NOT NULL CHECK (valor > 0),
//   dia_vencimento int NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 28),
//   descricao     text,
//   status        text DEFAULT 'pendente' CHECK (status IN ('pendente','pago','isento')),
//   competencia   text NOT NULL,           -- ex: '05/2025'
//   data_pgto     date,
//   observacao    text,
//   criado_em     timestamptz DEFAULT now(),
//   atualizado_em timestamptz DEFAULT now(),
//   UNIQUE(user_id, cliente_id, competencia)
// );
// ALTER TABLE honorarios ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "hon_own" ON honorarios
//   USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
// CREATE INDEX idx_hon_user_comp ON honorarios(user_id, competencia);
// CREATE INDEX idx_hon_cliente   ON honorarios(user_id, cliente_id);
//
// ALTER TABLE clientes
//   ADD COLUMN IF NOT EXISTS honorario_valor    numeric(12,2),
//   ADD COLUMN IF NOT EXISTS honorario_dia_venc int DEFAULT 10;
// ─────────────────────────────────────────────────────────────

// ── Estado ───────────────────────────────────────────────────
let honMes    = new Date().getMonth();
let honAno    = new Date().getFullYear();
let honLista  = [];
let honTodos  = true; // false = só do cliente atual

const MESES_HON = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── Abrir / Fechar ───────────────────────────────────────────
async function openHonorarios() {
  closeDropdowns();
  document.getElementById('honModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  honTodos = true;
  _honAtualizarToggle();
  await honCarregar();
}

function closeHonorarios() {
  document.getElementById('honModal').style.display = 'none';
  document.body.style.overflow = '';
}

function honToggleFiltro() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  honTodos = !honTodos;
  _honAtualizarToggle();
  honCarregar();
}

function _honAtualizarToggle() {
  const btn   = document.getElementById('honToggleBtn');
  const lbl   = document.getElementById('honToggleLbl');
  const sub   = document.getElementById('honSubtitulo');
  const nome  = currentCliente ? (currentCliente.nome_fantasia || currentCliente.razao_social) : null;

  if (honTodos) {
    if (lbl) lbl.textContent = 'Todos';
    if (btn) btn.style.background = '';
    if (sub) sub.textContent = 'Todos os clientes do escritório';
  } else {
    if (lbl) lbl.textContent = nome || 'Empresa';
    if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = 'var(--bg)'; }
    if (sub) sub.textContent = nome ? `Filtrando: ${nome}` : 'Empresa selecionada';
  }
}

// ── Carregar dados ───────────────────────────────────────────
async function honCarregar() {
  _honAtualizarToggle();
  honRenderLoading();
  const compStr = `${String(honMes + 1).padStart(2,'0')}/${honAno}`;

  try {
    let query = sb.from('honorarios')
      .select(`*, clientes(razao_social, nome_fantasia, regime_tributario)`)
      .eq('user_id', currentUser.id)
      .eq('competencia', compStr)
      .order('status')
      .order('criado_em');

    if (!honTodos && currentCliente?.id) {
      query = query.eq('cliente_id', currentCliente.id);
    }

    const { data, error } = await query;
    if (error) throw error;
    honLista = data || [];
    honRender();
  } catch(e) {
    document.getElementById('honCorpo').innerHTML =
      `<div class="hon-empty"><i data-lucide="alert-circle" style="width:32px;height:32px;opacity:.4"></i>
       <p>Erro ao carregar: ${escapeHtml(e.message)}</p></div>`;
    if (window.lucide) lucide.createIcons();
  }
}

// ── Render principal ─────────────────────────────────────────
function honRenderLoading() {
  document.getElementById('honCorpo').innerHTML =
    `<div class="hon-empty"><div class="hon-spinner"></div><p style="margin-top:12px">Carregando...</p></div>`;
}

function honRender() {
  const compLabel = `${MESES_HON[honMes]} ${honAno}`;
  document.getElementById('honMesLabel').textContent = compLabel;

  // KPIs
  const total    = honLista.reduce((s, h) => s + (+h.valor||0), 0);
  const recebido = honLista.filter(h => h.status === 'pago').reduce((s, h) => s + (+h.valor||0), 0);
  const pendente = honLista.filter(h => h.status === 'pendente').reduce((s, h) => s + (+h.valor||0), 0);
  const inadimp  = honLista.filter(h => h.status === 'pendente' && _honVencido(h)).length;

  document.getElementById('honKpiTotal').textContent    = fmtHon(total);
  document.getElementById('honKpiRecebido').textContent = fmtHon(recebido);
  document.getElementById('honKpiPendente').textContent = fmtHon(pendente);
  document.getElementById('honKpiInadimpl').textContent = inadimp;

  const el = document.getElementById('honCorpo');
  if (!honLista.length) {
    el.innerHTML = `
      <div class="hon-empty">
        <i data-lucide="receipt" style="width:40px;height:40px;opacity:.25"></i>
        <p>Nenhum honorário em ${compLabel}.</p>
        <button class="dp-btn-pri" onclick="honGerarCompetencia()" style="margin-top:8px;font-size:12px;padding:8px 16px">
          <i data-lucide="zap" style="width:13px;height:13px"></i> Gerar para todos os clientes
        </button>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Agrupar: vencidos primeiro, depois pendentes, depois pagos
  const vencidos  = honLista.filter(h => h.status === 'pendente' && _honVencido(h));
  const pendentes = honLista.filter(h => h.status === 'pendente' && !_honVencido(h));
  const pagos     = honLista.filter(h => h.status === 'pago');
  const isentos   = honLista.filter(h => h.status === 'isento');

  el.innerHTML = [
    vencidos.length  ? `<div class="hon-grupo-label hon-label-venc">⚠ Vencidos (${vencidos.length})</div>${vencidos.map(honRenderItem).join('')}` : '',
    pendentes.length ? `<div class="hon-grupo-label hon-label-pend">⏳ Aguardando (${pendentes.length})</div>${pendentes.map(honRenderItem).join('')}` : '',
    pagos.length     ? `<div class="hon-grupo-label hon-label-pago">✓ Recebidos (${pagos.length})</div>${pagos.map(honRenderItem).join('')}` : '',
    isentos.length   ? `<div class="hon-grupo-label hon-label-isen">— Isentos (${isentos.length})</div>${isentos.map(honRenderItem).join('')}` : '',
  ].join('');

  if (window.lucide) lucide.createIcons();
}

function honRenderItem(h) {
  const cl        = h.clientes || {};
  const nome      = escapeHtml(cl.nome_fantasia || cl.razao_social || '—');
  const regime    = cl.regime_tributario || '';
  const venceu    = _honVencido(h);
  const dataVenc  = _honDataVenc(h);
  const dataPgto  = h.data_pgto ? new Date(h.data_pgto+'T12:00').toLocaleDateString('pt-BR') : null;
  const regimeCor = _honRegimeCor(regime);

  return `
    <div class="hon-item ${venceu && h.status==='pendente' ? 'hon-item-venc' : ''} ${h.status==='pago'?'hon-item-pago':''}" data-id="${h.id}">
      <div class="hon-item-left">
        <div class="hon-avatar" style="background:${regimeCor}18;color:${regimeCor}">
          ${(cl.nome_fantasia||cl.razao_social||'?')[0].toUpperCase()}
        </div>
        <div class="hon-item-info">
          <div class="hon-item-nome">${nome}</div>
          <div class="hon-item-meta">
            ${regime ? `<span class="hon-regime-badge" style="background:${regimeCor}18;color:${regimeCor}">${escapeHtml(regime)}</span>` : ''}
            <span>Venc: ${dataVenc.toLocaleDateString('pt-BR')}</span>
            ${venceu && h.status==='pendente' ? `<span style="color:#dc2626;font-weight:700">${Math.abs(Math.ceil((dataVenc-new Date())/86400000))}d atrasado</span>` : ''}
            ${dataPgto ? `<span style="color:#16a34a">Pago em ${dataPgto}</span>` : ''}
            ${h.descricao ? `<span style="color:var(--text-light)">${escapeHtml(h.descricao)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="hon-item-right">
        <div class="hon-valor ${h.status==='pago'?'hon-valor-pago':venceu?'hon-valor-venc':''}">
          R$ ${fmtHon(+h.valor)}
        </div>
        <div class="hon-acoes">
          ${h.status === 'pendente' ? `
            <button class="hon-btn hon-btn-pagar" onclick="honMarcarPago('${h.id}')" title="Marcar como pago">
              <i data-lucide="check" style="width:13px;height:13px"></i>
            </button>` : ''}
          <button class="hon-btn" onclick="honGerarRecibo('${h.id}')" title="Gerar recibo PDF">
            <i data-lucide="file-text" style="width:13px;height:13px"></i>
          </button>
          <button class="hon-btn" onclick="honEditar('${h.id}')" title="Editar">
            <i data-lucide="pencil" style="width:13px;height:13px"></i>
          </button>
          <button class="hon-btn hon-btn-del" onclick="honExcluir('${h.id}')" title="Excluir">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
      </div>
    </div>`;
}

// ── Helpers ──────────────────────────────────────────────────
function fmtHon(v) {
  return (+v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _honVencido(h) {
  const d = _honDataVenc(h);
  return d < new Date();
}

function _honDataVenc(h) {
  const [mm, yy] = h.competencia.split('/');
  return new Date(+yy, +mm - 1, h.dia_vencimento || 10);
}

function _honRegimeCor(r) {
  if (/mei/i.test(r))     return '#7c3aed';
  if (/simples/i.test(r)) return '#2563eb';
  if (/presumido/i.test(r)) return '#d97706';
  if (/real/i.test(r))    return '#dc2626';
  return '#64748b';
}

// ── Navegação de mês ─────────────────────────────────────────
async function honNavMes(delta) {
  honMes += delta;
  if (honMes > 11) { honMes = 0;  honAno++; }
  if (honMes < 0)  { honMes = 11; honAno--; }
  await honCarregar();
}

// ── Gerar honorários para todos os clientes do mês ───────────
async function honGerarCompetencia() {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }

  const compStr = `${String(honMes + 1).padStart(2,'0')}/${honAno}`;
  try {
    // Buscar clientes com valor de honorário configurado
    const { data: clientes, error } = await sb
      .from('clientes')
      .select('id, razao_social, honorario_valor, honorario_dia_venc')
      .eq('user_id', currentUser.id)
      .not('honorario_valor', 'is', null)
      .gt('honorario_valor', 0);

    if (error) throw error;
    if (!clientes?.length) {
      showToast('Nenhum cliente com honorário configurado. Configure o valor no cadastro de cada cliente.', 'warn');
      return;
    }

    // Inserir apenas os que ainda não existem (ON CONFLICT ignora)
    const _escGer = await getEscritorioIdAtual();
    const registros = clientes.map(c => ({
      user_id:        currentUser.id,
      cliente_id:     c.id,
      escritorio_id:  _escGer,
      valor:          c.honorario_valor,
      dia_vencimento: c.honorario_dia_venc || 10,
      competencia:    compStr,
      descricao:      `Honorários contábeis ${compStr}`,
      status:         'pendente',
    }));

    const { error: errIns } = await sb.from('honorarios').upsert(registros, {
      onConflict: 'user_id,cliente_id,competencia',
      ignoreDuplicates: true,
    });
    if (errIns) throw errIns;

    showToast(`${registros.length} honorário(s) gerado(s) para ${compStr}.`, 'success');
    await honCarregar();
  } catch(e) {
    showToast('Erro ao gerar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Gerar para todos os clientes'; }
  }
}

// ── Marcar como pago ─────────────────────────────────────────
let _honPagoId = null; // id do honorário pendente de confirmação

function honMarcarPago(id) {
  const h = honLista.find(x => x.id === id);
  if (!h) return;
  _honPagoId = id;

  const nome = h.clientes?.nome_fantasia || h.clientes?.razao_social || 'Cliente';
  document.getElementById('honPagoNome').textContent = `${nome} — R$ ${fmtHon(+h.valor)}`;
  document.getElementById('honPagoData').value = new Date().toISOString().slice(0, 10);
  document.getElementById('honPagoModal').style.display = 'flex';
}

function honPagoFechar() {
  document.getElementById('honPagoModal').style.display = 'none';
  _honPagoId = null;
}

async function honPagoConfirmar() {
  if (!_honPagoId) return;
  const dataPgto = document.getElementById('honPagoData').value;
  if (!dataPgto) { showToast('Informe a data do recebimento.', 'warn'); return; }

  const btn = document.querySelector('#honPagoModal button:last-child');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const { error } = await sb.from('honorarios').update({
    status: 'pago',
    data_pgto: dataPgto,
    atualizado_em: new Date().toISOString(),
  }).eq('id', _honPagoId).eq('user_id', currentUser.id);

  if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }

  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  honPagoFechar();
  showToast('Honorário marcado como recebido.', 'success');
  await honCarregar();
}

// ── Editar ───────────────────────────────────────────────────
function honEditar(id) {
  const h = honLista.find(x => x.id === id);
  if (!h) return;
  document.getElementById('honFormId').value          = h.id;
  document.getElementById('honFormClienteId').value   = h.cliente_id; // preservar ao editar
  document.getElementById('honFormValor').value       = h.valor;
  document.getElementById('honFormDia').value         = h.dia_vencimento;
  document.getElementById('honFormDescricao').value   = h.descricao || '';
  document.getElementById('honFormObs').value         = h.observacao || '';
  document.getElementById('honFormStatus').value      = h.status;
  document.getElementById('honFormPgto').value        = h.data_pgto || '';
  document.getElementById('honFormTitulo').textContent = 'Editar Honorário';
  document.getElementById('honFormPanel').style.display = '';
  document.getElementById('honFormPanel').scrollIntoView({ behavior: 'smooth' });
}

// ── Novo ─────────────────────────────────────────────────────
function honNovo() {
  if (!currentCliente?.id) { showToast('Selecione uma empresa primeiro.', 'warn'); return; }
  const nomeCliente = currentCliente.nome_fantasia || currentCliente.razao_social;
  document.getElementById('honFormId').value         = '';
  document.getElementById('honFormClienteId').value  = ''; // vazio = usar currentCliente ao salvar
  document.getElementById('honFormValor').value      = '';
  document.getElementById('honFormDia').value        = '10';
  document.getElementById('honFormDescricao').value  = `Honorários contábeis ${String(honMes+1).padStart(2,'0')}/${honAno}`;
  document.getElementById('honFormObs').value        = '';
  document.getElementById('honFormStatus').value     = 'pendente';
  document.getElementById('honFormPgto').value       = '';
  // Em modo Todos: indicar para qual cliente está criando
  document.getElementById('honFormTitulo').textContent = honTodos
    ? `Novo Honorário — ${nomeCliente}`
    : 'Novo Honorário';
  document.getElementById('honFormPanel').style.display = '';
  document.getElementById('honFormPanel').scrollIntoView({ behavior: 'smooth' });
}

function honFecharForm() {
  document.getElementById('honFormPanel').style.display = 'none';
}

// ── Salvar ───────────────────────────────────────────────────
async function honSalvar() {
  const id    = document.getElementById('honFormId').value;
  const valor = parseFloat(document.getElementById('honFormValor').value);
  const dia   = parseInt(document.getElementById('honFormDia').value);

  if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'warn'); return; }
  if (!dia || dia < 1 || dia > 28) { showToast('Dia de vencimento deve ser entre 1 e 28.', 'warn'); return; }

  const btn = document.getElementById('honSalvarBtn');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const compStr = `${String(honMes + 1).padStart(2,'0')}/${honAno}`;
  // Ao editar: preservar o cliente_id original do registro (campo oculto honFormClienteId)
  // Ao criar:  usar currentCliente.id
  const clienteIdSalvo = document.getElementById('honFormClienteId').value;
  const clienteId = (id && clienteIdSalvo) ? clienteIdSalvo : currentCliente?.id;

  if (!clienteId) { showToast('Selecione uma empresa primeiro.', 'warn'); btn.disabled = false; btn.textContent = 'Salvar'; return; }

  const _escHon = await getEscritorioIdAtual();
  const payload = {
    user_id:        currentUser.id,
    cliente_id:     clienteId,
    escritorio_id:  _escHon,
    valor,
    dia_vencimento: dia,
    descricao:      document.getElementById('honFormDescricao').value.trim() || null,
    observacao:     document.getElementById('honFormObs').value.trim() || null,
    status:         document.getElementById('honFormStatus').value,
    data_pgto:      document.getElementById('honFormPgto').value || null,
    competencia:    compStr,
    atualizado_em:  new Date().toISOString(),
  };

  let error;
  if (id) {
    ({ error } = await sb.from('honorarios').update(payload).eq('id', id).eq('user_id', currentUser.id));
  } else {
    ({ error } = await sb.from('honorarios').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Salvar';
  if (error) {
    if (error.code === '23505') showToast('Já existe honorário para este cliente nesta competência.', 'warn');
    else showToast('Erro ao salvar: ' + error.message, 'error');
    return;
  }
  showToast(id ? 'Honorário atualizado.' : 'Honorário criado.', 'success');
  honFecharForm();
  await honCarregar();
}

// ── Excluir ──────────────────────────────────────────────────
async function honExcluir(id) {
  const h = honLista.find(x => x.id === id);
  const ok = await showConfirm(`Excluir honorário de ${h?.clientes?.razao_social || 'cliente'}?`);
  if (!ok) return;
  const { error } = await sb.from('honorarios').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return; }
  showToast('Honorário excluído.', 'success');
  await honCarregar();
}

// ── Relatório de inadimplência ────────────────────────────────
async function honRelatorioInadimplencia() {
  // Montar as 3 competências de uma vez e buscar em query única
  const hoje = new Date();
  const comps = Array.from({ length: 3 }, (_, i) => {
    let m = hoje.getMonth() - i;
    let y = hoje.getFullYear();
    if (m < 0) { m += 12; y--; }
    return `${String(m + 1).padStart(2, '0')}/${y}`;
  });

  const { data, error } = await sb.from('honorarios')
    .select('*, clientes(razao_social, nome_fantasia, regime_tributario)')
    .eq('user_id', currentUser.id)
    .in('competencia', comps)
    .eq('status', 'pendente');

  if (error) { showToast('Erro ao buscar inadimplência: ' + error.message, 'error'); return; }

  const registros = (data || []).map(r => ({ ...r, _comp: r.competencia }));

  if (!registros.length) {
    showToast('Nenhuma inadimplência nos últimos 3 meses.', 'success');
    return;
  }

  // Agrupar por cliente
  const porCliente = {};
  registros.forEach(r => {
    const nome = r.clientes?.nome_fantasia || r.clientes?.razao_social || 'Desconhecido';
    if (!porCliente[nome]) porCliente[nome] = { meses: [], total: 0, regime: r.clientes?.regime_tributario || '' };
    porCliente[nome].meses.push(r._comp);
    porCliente[nome].total += +r.valor;
  });

  const linhas = Object.entries(porCliente)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([nome, d]) => `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:8px 10px;font-size:13px;font-weight:600">${nome}</td>
        <td style="padding:8px 10px;font-size:12px;color:#64748b">${d.regime}</td>
        <td style="padding:8px 10px;font-size:12px">${d.meses.join(', ')}</td>
        <td style="padding:8px 10px;font-size:13px;font-weight:700;color:#dc2626;text-align:right">R$ ${fmtHon(d.total)}</td>
      </tr>`).join('');

  const totalGeral = registros.reduce((s,r) => s + (+r.valor||0), 0);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Relatório de Inadimplência</title>
    <style>
      body{font-family:Arial,sans-serif;margin:32px;color:#1e293b}
      h2{margin:0 0 4px;color:#dc2626}p{margin:0 0 20px;color:#64748b;font-size:13px}
      table{width:100%;border-collapse:collapse}
      th{background:#fef2f2;padding:9px 10px;font-size:12px;text-align:left;border-bottom:2px solid #fca5a5;color:#dc2626}
      .total{margin-top:16px;text-align:right;font-size:16px;font-weight:700;color:#dc2626}
      @media print{button{display:none}}
    </style>
  </head><body>
    <h2>⚠ Relatório de Inadimplência</h2>
    <p>Honorários pendentes — últimos 3 meses · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    <table>
      <thead><tr>
        <th>Cliente</th><th>Regime</th><th>Competências</th><th style="text-align:right">Total em aberto</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="total">Total inadimplente: R$ ${fmtHon(totalGeral)}</div>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ── Gerar Recibo PDF ─────────────────────────────────────────
function honGerarRecibo(id) {
  const h = honLista.find(x => x.id === id);
  if (!h) return;
  const cl      = h.clientes || {};
  const nome    = cl.nome_fantasia || cl.razao_social || '—';
  const regime  = cl.regime_tributario || '';
  const dataVenc = _honDataVenc(h).toLocaleDateString('pt-BR');
  const dataPgto = h.data_pgto ? new Date(h.data_pgto+'T12:00').toLocaleDateString('pt-BR') : null;
  const escritorio = currentUser?.user_metadata?.nome || currentUser?.email || 'Escritório';
  const hoje    = new Date().toLocaleDateString('pt-BR');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Recibo de Honorários</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
      .recibo{background:#fff;width:600px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
      .recibo-header{background:#1a1a1a;color:#fff;padding:28px 32px}
      .recibo-header h1{font-size:22px;font-weight:700;letter-spacing:-.3px}
      .recibo-header p{font-size:13px;opacity:.6;margin-top:4px}
      .recibo-num{font-size:11px;opacity:.5;margin-top:8px;letter-spacing:1px;text-transform:uppercase}
      .recibo-body{padding:32px}
      .recibo-row{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 0;border-bottom:1px solid #f1f5f9}
      .recibo-row:last-child{border-bottom:none}
      .recibo-label{font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
      .recibo-val{font-size:14px;color:#1e293b;font-weight:500;text-align:right;max-width:60%}
      .recibo-valor-box{margin:24px 0;padding:20px 24px;background:#f0fdf4;border-radius:10px;border:2px solid #bbf7d0;text-align:center}
      .recibo-valor-label{font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
      .recibo-valor-num{font-size:36px;font-weight:800;color:#15803d;margin-top:4px}
      .recibo-status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;
        background:${h.status==='pago'?'#dcfce7':'#fef3c7'};color:${h.status==='pago'?'#16a34a':'#d97706'}}
      .recibo-footer{background:#f8fafc;padding:16px 32px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;
        display:flex;justify-content:space-between;align-items:center}
      @media print{body{background:#fff;padding:0}.recibo{box-shadow:none;border-radius:0;width:100%}button{display:none}}
    </style>
  </head><body>
    <div class="recibo">
      <div class="recibo-header">
        <h1>${escapeHtml(escritorio)}</h1>
        <p>Recibo de Honorários Contábeis</p>
        <div class="recibo-num">Competência ${h.competencia}</div>
      </div>
      <div class="recibo-body">
        <div class="recibo-row">
          <span class="recibo-label">Cliente</span>
          <span class="recibo-val">${escapeHtml(nome)}</span>
        </div>
        ${regime ? `<div class="recibo-row">
          <span class="recibo-label">Regime Tributário</span>
          <span class="recibo-val">${escapeHtml(regime)}</span>
        </div>` : ''}
        <div class="recibo-row">
          <span class="recibo-label">Descrição</span>
          <span class="recibo-val">${escapeHtml(h.descricao || 'Honorários contábeis')}</span>
        </div>
        <div class="recibo-row">
          <span class="recibo-label">Vencimento</span>
          <span class="recibo-val">${dataVenc}</span>
        </div>
        ${dataPgto ? `<div class="recibo-row">
          <span class="recibo-label">Data de Pagamento</span>
          <span class="recibo-val">${dataPgto}</span>
        </div>` : ''}
        <div class="recibo-row">
          <span class="recibo-label">Status</span>
          <span class="recibo-val"><span class="recibo-status">${h.status==='pago'?'✓ Pago':'⏳ Pendente'}</span></span>
        </div>

        <div class="recibo-valor-box">
          <div class="recibo-valor-label">Valor dos Honorários</div>
          <div class="recibo-valor-num">R$ ${fmtHon(+h.valor)}</div>
        </div>

        ${h.observacao ? `<div style="font-size:12px;color:#64748b;padding:12px;background:#f8fafc;border-radius:8px;margin-top:4px">
          <strong>Observação:</strong> ${escapeHtml(h.observacao)}
        </div>` : ''}
      </div>
      <div class="recibo-footer">
        <span>${escapeHtml(escritorio)}</span>
        <span>Emitido em ${hoje}</span>
      </div>
    </div>
    <script>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}
