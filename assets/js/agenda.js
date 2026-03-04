// ============================================================
// AGENDA.JS — Painel de agenda consolidada por cliente
// ============================================================

// ── Constantes ──────────────────────────────────────────────
const PRIORIDADE_COR = { alta: '#dc2626', media: '#d97706', baixa: '#16a34a' };
const PRIORIDADE_BG  = { alta: '#fef2f2', media: '#fffbeb', baixa: '#f0fdf4' };
const STATUS_LABEL   = { pendente: 'Pendente', concluida: 'Concluída', ignorada: 'Ignorada' };

// Obrigações fiscais automáticas — sincronizadas com fiscalDeadlines
const OBRIGACOES_AGENDA = [
  { id: 'das',         label: 'DAS Simples Nacional',  dia: 20, mensal: true,  simplesOuMei: true  },
  { id: 'dctfweb',     label: 'DCTFWeb',               dia: 28, mensal: true,  comEmpregado: true  },
  { id: 'efd_reinf',   label: 'EFD-Reinf',             dia: 15, mensal: true,  comEmpregado: true  },
  { id: 'esocial',     label: 'eSocial (folha)',        dia: 15, mensal: true,  comEmpregado: true  },
  { id: 'efd_contrib', label: 'EFD-Contribuições',     dia: 10, mensal: true,  naoSimples: true    },
  { id: 'sped_fiscal', label: 'SPED Fiscal',           dia: 15, mensal: true                       },
  { id: 'dasn_simei',  label: 'DASN-SIMEI (MEI)',      dia: 31, mes: 5,        meiOnly: true       },
  { id: 'defis',       label: 'DEFIS (Simples)',        dia: 31, mes: 3,        simplesOuMei: true  },
  { id: 'ecd',         label: 'ECD',                   dia: 30, mes: 6                             },
  { id: 'ecf',         label: 'ECF',                   dia: 31, mes: 7                             },
  { id: 'dirpf',       label: 'DIRPF (PF)',            dia: 30, mes: 5                             },
];

// Estado
let agendaClientes    = [];
let agendaTarefas     = [];
let agendaFiltroMes   = new Date().getMonth();
let agendaFiltroAno   = new Date().getFullYear();
let agendaFiltroStatus = 'pendente';
let agendaFiltroCliente = 'todos';

// ── Abrir / Fechar ───────────────────────────────────────────
async function openAgenda() {
  closeDropdowns();
  agendaFiltroMes = new Date().getMonth();
  agendaFiltroAno = new Date().getFullYear();
  document.getElementById('agendaFiltroMes').value = agendaFiltroMes;
  document.getElementById('agendaMesLabel').textContent = agendaMesLabel();
  document.getElementById('agendaModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  await agendaCarregar();
}

function closeAgenda() {
  document.getElementById('agendaModal').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Carregar dados ───────────────────────────────────────────
async function agendaCarregar() {
  agendaRenderLoading();

  // Carregar clientes do usuário
  let { data: clientes } = isAdmin()
    ? await sb.from('clientes').select('id, razao_social, nome_fantasia, regime_tributario, cnpj, tem_empregado').order('razao_social')
    : await sb.from('clientes_usuarios').select('clientes(id, razao_social, nome_fantasia, regime_tributario, cnpj, tem_empregado)').eq('user_id', currentUser.id);

  if (!isAdmin() && clientes) {
    clientes = clientes.map(r => r.clientes).filter(Boolean);
  }
  agendaClientes = clientes || [];

  // Carregar tarefas manuais do banco
  const { data: tarefas } = await sb
    .from('agenda_tarefas')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('prazo', `${agendaFiltroAno}-01-01`)
    .lte('prazo', `${agendaFiltroAno}-12-31`)
    .order('prazo');

  agendaTarefas = tarefas || [];

  // Gerar tarefas automáticas (obrigações fiscais por cliente)
  const automaticas = agendaGerarAutomaticas();

  // Mesclar: manuais + automáticas que ainda não foram marcadas como concluídas/ignoradas
  const manualIds = new Set(agendaTarefas.filter(t => t.origem === 'automatica').map(t => `${t.cliente_id}__${t.obrigacao_id}__${t.prazo}`));
  const novas = automaticas.filter(t => !manualIds.has(`${t.cliente_id}__${t.obrigacao_id}__${t.prazo}`));

  agendaTarefas = [...agendaTarefas, ...novas];

  agendaPopularFiltros();
  agendaRender();
}

// ── Gerar tarefas automáticas por cliente e regime ───────────
function agendaGerarAutomaticas() {
  const tarefas = [];
  const hoje = new Date();

  for (const cliente of agendaClientes) {
    const regime = cliente.regime_tributario || '';
    const isMEI     = /mei/i.test(regime);
    const isSimples = /simples/i.test(regime);
    const isSimplesOuMEI = isMEI || isSimples;
    const temEmpregado = cliente.tem_empregado === true;

    for (const ob of OBRIGACOES_AGENDA) {
      // Filtrar por regime
      if (ob.meiOnly      && !isMEI)          continue;
      if (ob.simplesOuMei && !isSimplesOuMEI) continue;
      if (ob.naoSimples   && isSimplesOuMEI)  continue;
      if (ob.comEmpregado && !temEmpregado)   continue;

      if (ob.mensal) {
        // Gerar para os meses do ano filtrado
        for (let mes = 0; mes < 12; mes++) {
          const prazo = new Date(agendaFiltroAno, mes, ob.dia);
          tarefas.push(agendaMontarTarefa(cliente, ob, prazo));
        }
      } else {
        // Anual — mês fixo
        const prazo = new Date(agendaFiltroAno, ob.mes - 1, ob.dia);
        tarefas.push(agendaMontarTarefa(cliente, ob, prazo));
      }
    }
  }
  return tarefas;
}

function agendaMontarTarefa(cliente, ob, prazo) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dias = Math.ceil((prazo - hoje) / 86400000);
  const prazoStr = prazo.toISOString().slice(0, 10);
  return {
    id: null, // não persistida ainda
    user_id: currentUser.id,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome_fantasia || cliente.razao_social,
    titulo: ob.label,
    prazo: prazoStr,
    status: 'pendente',
    prioridade: dias < 0 ? 'alta' : dias <= 3 ? 'alta' : dias <= 7 ? 'media' : 'baixa',
    origem: 'automatica',
    obrigacao_id: ob.id,
  };
}

// ── Filtros ──────────────────────────────────────────────────
function agendaPopularFiltros() {
  // Filtro de cliente
  const sel = document.getElementById('agendaFiltroCliente');
  if (!sel) return;
  const valorAtual = sel.value;
  sel.innerHTML = '<option value="todos">Todos os clientes</option>';
  agendaClientes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nome_fantasia || c.razao_social;
    sel.appendChild(opt);
  });
  sel.value = valorAtual || 'todos';
}

function agendaAplicarFiltros() {
  agendaFiltroStatus  = document.getElementById('agendaFiltroStatus').value;
  agendaFiltroCliente = document.getElementById('agendaFiltroCliente').value;
  const mes = parseInt(document.getElementById('agendaFiltroMes').value);
  agendaFiltroMes = mes;
  agendaRender();
}

function agendaNavMes(delta) {
  agendaFiltroMes += delta;
  if (agendaFiltroMes < 0)  { agendaFiltroMes = 11; agendaFiltroAno--; }
  if (agendaFiltroMes > 11) { agendaFiltroMes = 0;  agendaFiltroAno++; }
  document.getElementById('agendaFiltroMes').value = agendaFiltroMes;
  document.getElementById('agendaMesLabel').textContent = agendaMesLabel();
  agendaCarregar();
}

function agendaMesLabel() {
  return new Date(agendaFiltroAno, agendaFiltroMes, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ── Render ───────────────────────────────────────────────────
function agendaRenderLoading() {
  const el = document.getElementById('agendaLista');
  if (el) el.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:32px;font-size:13px">Carregando...</p>';
}

function agendaRender() {
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Filtrar
  const tarefas = agendaTarefas.filter(t => {
    const prazo = new Date(t.prazo + 'T00:00:00');
    if (prazo.getMonth() !== agendaFiltroMes || prazo.getFullYear() !== agendaFiltroAno) return false;
    if (agendaFiltroStatus !== 'todos' && t.status !== agendaFiltroStatus) return false;
    if (agendaFiltroCliente !== 'todos' && t.cliente_id !== agendaFiltroCliente) return false;
    return true;
  });

  // Ordenar por prazo
  tarefas.sort((a, b) => a.prazo.localeCompare(b.prazo));

  // Contadores do cabeçalho
  const todas = agendaTarefas.filter(t => {
    const prazo = new Date(t.prazo + 'T00:00:00');
    return prazo.getMonth() === agendaFiltroMes && prazo.getFullYear() === agendaFiltroAno;
  });
  const vencidas  = todas.filter(t => new Date(t.prazo + 'T00:00:00') < hoje && t.status === 'pendente');
  const proximas  = todas.filter(t => {
    const d = Math.ceil((new Date(t.prazo + 'T00:00:00') - hoje) / 86400000);
    return d >= 0 && d <= 7 && t.status === 'pendente';
  });
  const concluidas = todas.filter(t => t.status === 'concluida');

  document.getElementById('agendaCountVencidas').textContent  = vencidas.length;
  document.getElementById('agendaCountProximas').textContent  = proximas.length;
  document.getElementById('agendaCountConcluidas').textContent = concluidas.length;
  document.getElementById('agendaCountTotal').textContent     = todas.length;

  const el = document.getElementById('agendaLista');
  if (!el) return;

  if (tarefas.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:48px 20px;color:var(--text-light)">
        <i data-lucide="calendar-check" style="width:40px;height:40px;margin-bottom:12px;opacity:0.3"></i>
        <p style="font-size:14px">Nenhuma tarefa encontrada para este período.</p>
        <button onclick="agendaNovaManual()" style="margin-top:16px;padding:8px 20px;background:var(--accent);color:var(--user-text);border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600">
          + Adicionar tarefa
        </button>
      </div>`;
    lucide.createIcons();
    return;
  }

  // Agrupar por dia
  const porDia = {};
  tarefas.forEach(t => {
    if (!porDia[t.prazo]) porDia[t.prazo] = [];
    porDia[t.prazo].push(t);
  });

  el.innerHTML = Object.entries(porDia).map(([dia, items]) => {
    const prazoDate = new Date(dia + 'T00:00:00');
    const diasAte = Math.ceil((prazoDate - hoje) / 86400000);
    const diaLabel = prazoDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const diaStatus = diasAte < 0 ? 'vencido' : diasAte === 0 ? 'hoje' : diasAte <= 3 ? 'urgente' : 'normal';
    const diaCorMap = { vencido: '#dc2626', hoje: '#d97706', urgente: '#d97706', normal: 'var(--text-light)' };
    const diaCor = diaCorMap[diaStatus];

    return `
      <div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:${diaCor};text-transform:uppercase;letter-spacing:.5px">${diaLabel}</span>
          ${diaStatus === 'vencido' ? '<span style="font-size:10px;background:#fef2f2;color:#dc2626;padding:2px 7px;border-radius:99px;font-weight:600">VENCIDO</span>' : ''}
          ${diaStatus === 'hoje'    ? '<span style="font-size:10px;background:#fffbeb;color:#d97706;padding:2px 7px;border-radius:99px;font-weight:600">HOJE</span>' : ''}
          <div style="flex:1;height:1px;background:var(--border)"></div>
          <span style="font-size:11px;color:var(--text-light)">${items.length} tarefa${items.length > 1 ? 's' : ''}</span>
        </div>
        ${items.map(t => agendaRenderTarefa(t, diasAte)).join('')}
      </div>`;
  }).join('');

  lucide.createIcons();
}

function agendaRenderTarefa(t, diasAte) {
  const cor = PRIORIDADE_COR[t.prioridade] || '#666';
  const bg  = PRIORIDADE_BG[t.prioridade]  || '#f9f9f9';
  const concluida = t.status === 'concluida';
  const ignorada  = t.status === 'ignorada';
  const opacidade = (concluida || ignorada) ? '0.6' : '1';
  const clienteNome = t.cliente_nome || agendaClientes.find(c => c.id === t.cliente_id)?.nome_fantasia
    || agendaClientes.find(c => c.id === t.cliente_id)?.razao_social || '—';

  return `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-left:3px solid ${concluida ? '#16a34a' : ignorada ? '#94a3b8' : cor};border-radius:8px;margin-bottom:6px;opacity:${opacidade}">
      <button onclick="agendaToggleStatus('${t.id}','${t.cliente_id}','${t.obrigacao_id}','${t.prazo}','${t.titulo}','${t.status}')"
        style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:2px solid ${concluida ? '#16a34a' : 'var(--border)'};background:${concluida ? '#16a34a' : 'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;margin-top:1px;padding:0">
        ${concluida ? '<i data-lucide="check" style="width:11px;height:11px;color:#fff"></i>' : ''}
      </button>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:var(--text);${concluida ? 'text-decoration:line-through' : ''}">${escapeHtml(t.titulo)}</span>
          ${t.origem === 'manual' ? '<span style="font-size:10px;background:var(--bg);border:1px solid var(--border);color:var(--text-light);padding:1px 6px;border-radius:99px">manual</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--text-light);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <i data-lucide="building-2" style="width:11px;height:11px"></i>
          <span>${escapeHtml(clienteNome)}</span>
          ${t.descricao ? `<span>· ${escapeHtml(t.descricao)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-size:11px;font-weight:600;color:${cor};background:${bg};padding:2px 8px;border-radius:99px">${t.prioridade}</span>
        ${t.origem === 'manual' ? `
          <button onclick="agendaExcluir('${t.id}')" title="Excluir"
            style="background:none;border:none;cursor:pointer;color:var(--text-light);padding:2px;display:flex;align-items:center">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>` : `
          <button onclick="agendaIgnorar('${t.id}','${t.cliente_id}','${t.obrigacao_id}','${t.prazo}','${t.titulo}','${t.status}')" title="Ignorar esta ocorrência"
            style="background:none;border:none;cursor:pointer;color:var(--text-light);padding:2px;display:flex;align-items:center">
            <i data-lucide="eye-off" style="width:13px;height:13px"></i>
          </button>`}
      </div>
    </div>`;
}

// ── Ações ────────────────────────────────────────────────────
async function agendaToggleStatus(id, clienteId, obrigacaoId, prazo, titulo, statusAtual) {
  const novoStatus = statusAtual === 'concluida' ? 'pendente' : 'concluida';

  if (id && id !== 'null') {
    // Tarefa já persistida
    await sb.from('agenda_tarefas').update({ status: novoStatus, atualizado_em: new Date().toISOString() }).eq('id', id);
    const t = agendaTarefas.find(x => x.id === id);
    if (t) t.status = novoStatus;
  } else {
    // Tarefa automática — persistir primeiro
    const novaId = await agendaPersistirAutomatica(clienteId, obrigacaoId, prazo, titulo, novoStatus);
    const t = agendaTarefas.find(x => x.cliente_id === clienteId && x.obrigacao_id === obrigacaoId && x.prazo === prazo);
    if (t) { t.id = novaId; t.status = novoStatus; }
  }
  agendaRender();
}

async function agendaIgnorar(id, clienteId, obrigacaoId, prazo, titulo, statusAtual) {
  if (id && id !== 'null') {
    await sb.from('agenda_tarefas').update({ status: 'ignorada', atualizado_em: new Date().toISOString() }).eq('id', id);
    const t = agendaTarefas.find(x => x.id === id);
    if (t) t.status = 'ignorada';
  } else {
    const novaId = await agendaPersistirAutomatica(clienteId, obrigacaoId, prazo, titulo, 'ignorada');
    const t = agendaTarefas.find(x => x.cliente_id === clienteId && x.obrigacao_id === obrigacaoId && x.prazo === prazo);
    if (t) { t.id = novaId; t.status = 'ignorada'; }
  }
  agendaRender();
}

async function agendaPersistirAutomatica(clienteId, obrigacaoId, prazo, titulo, status) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const prazoDate = new Date(prazo + 'T00:00:00');
  const dias = Math.ceil((prazoDate - hoje) / 86400000);
  const prioridade = dias < 0 ? 'alta' : dias <= 3 ? 'alta' : dias <= 7 ? 'media' : 'baixa';

  const payload = {
    user_id: currentUser.id,
    cliente_id: clienteId,
    titulo,
    prazo,
    status,
    prioridade,
    origem: 'automatica',
    obrigacao_id: obrigacaoId,
    atualizado_em: new Date().toISOString()
  };
  const { data } = await sb.from('agenda_tarefas').insert(payload).select('id').single();
  return data?.id || null;
}

async function agendaExcluir(id) {
  if (!id || id === 'null') return;
  showConfirm('Excluir esta tarefa?', async () => {
    await sb.from('agenda_tarefas').delete().eq('id', id);
    agendaTarefas = agendaTarefas.filter(t => t.id !== id);
    agendaRender();
  });
}

// ── Nova tarefa manual ────────────────────────────────────────
function agendaNovaManual() {
  const hoje = new Date().toISOString().slice(0, 10);
  const clienteOpts = agendaClientes.map(c =>
    `<option value="${c.id}">${escapeHtml(c.nome_fantasia || c.razao_social)}</option>`
  ).join('');

  document.getElementById('agendaFormWrap').innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
      <p style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">Nova Tarefa</p>
      <div style="display:grid;gap:10px">
        <div>
          <label class="f-lbl">Título *</label>
          <input id="agTitulo" class="c-inp" placeholder="Ex: Entregar documentos SPED" style="width:100%">
        </div>
        <div>
          <label class="f-lbl">Cliente</label>
          <select id="agCliente" class="c-inp" style="width:100%">
            <option value="">Sem cliente específico</option>
            ${clienteOpts}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label class="f-lbl">Prazo *</label>
            <input id="agPrazo" type="date" class="c-inp" value="${hoje}" style="width:100%">
          </div>
          <div>
            <label class="f-lbl">Prioridade</label>
            <select id="agPrioridade" class="c-inp" style="width:100%">
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
        </div>
        <div>
          <label class="f-lbl">Observações</label>
          <input id="agDesc" class="c-inp" placeholder="Opcional" style="width:100%">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="agendaFecharForm()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;cursor:pointer">Cancelar</button>
          <button onclick="agendaSalvarManual()" style="padding:8px 16px;border-radius:8px;background:var(--accent);color:var(--user-text);border:none;font-size:13px;cursor:pointer;font-weight:600">Salvar</button>
        </div>
      </div>
    </div>`;
}

function agendaFecharForm() {
  document.getElementById('agendaFormWrap').innerHTML = '';
}

async function agendaSalvarManual() {
  const titulo    = document.getElementById('agTitulo').value.trim();
  const prazo     = document.getElementById('agPrazo').value;
  const clienteId = document.getElementById('agCliente').value || null;
  const prioridade = document.getElementById('agPrioridade').value;
  const descricao  = document.getElementById('agDesc').value.trim();

  if (!titulo || !prazo) {
    alert('Título e prazo são obrigatórios.');
    return;
  }

  const clienteNome = clienteId
    ? (agendaClientes.find(c => c.id === clienteId)?.nome_fantasia || agendaClientes.find(c => c.id === clienteId)?.razao_social)
    : null;

  const payload = {
    user_id: currentUser.id,
    cliente_id: clienteId,
    titulo,
    descricao: descricao || null,
    prazo,
    prioridade,
    status: 'pendente',
    origem: 'manual',
    atualizado_em: new Date().toISOString()
  };

  const { data, error } = await sb.from('agenda_tarefas').insert(payload).select('id').single();
  if (error) { alert('Erro ao salvar tarefa.'); return; }

  agendaTarefas.push({ ...payload, id: data.id, cliente_nome: clienteNome });
  agendaFecharForm();
  agendaRender();
}
