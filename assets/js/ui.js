// ============================================================
// UI.JS — Sidebar, Modais, Dropdowns, Tema
// ============================================================

async function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('on');
  document.getElementById('overlay')?.classList.toggle('on');
}

async function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('on');
  document.getElementById('overlay')?.classList.remove('on');
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

async function switchDocTab(tab, btn) {
  // Esconder todos os painéis e desativar abas
  document.querySelectorAll('#docModal .doc-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#docModal .doc-tab').forEach(b => b.classList.remove('active'));

  // Mostrar o painel correto — HTML usa camelCase: docPanelNfe, docPanelDarf
  const panelId = 'docPanel' + tab.charAt(0).toUpperCase() + tab.slice(1);
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');

  // Ativar a aba clicada
  if (btn) btn.classList.add('active');
}

async function switchProfileTab(tab, btn) {
  // Esconder todos os painéis
  document.querySelectorAll('#profileModal .doc-panel').forEach(p => {
p.classList.remove('active');
p.style.display = 'none';
  });
  document.querySelectorAll('#profileModal .doc-tab').forEach(b => b.classList.remove('active'));

  // HTML usa id="profileTabConta", "profileTabNotif"
  const map = { conta: 'profileTabConta', notif: 'profileTabNotif' };
  const panelId = map[tab] || ('profileTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  const panel = document.getElementById(panelId);
  if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }

  if (btn) btn.classList.add('active');

  // Carregar notificações ao abrir a aba
  if (tab === 'notif') {
if (typeof carregarConfigNotif === 'function') carregarConfigNotif();
  }
}

async function openDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  // Ativar aba NF-e por padrão
  const firstTab = modal?.querySelector('.doc-tab');
  switchDocTab('nfe', firstTab);
  lucide.createIcons();
}

async function closeDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

async function openCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  lucide.createIcons();
}

async function closeCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

async function showStats() {
  const modal = document.getElementById('statsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const content = document.getElementById('statsContent');
  if (content) content.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:20px">Carregando...</p>';

  try {
const { data: interacoes } = await sb
  .from('interacoes_chat')
  .select('id, tokens_usados, feedback_usuario, criado_em')
  .eq('user_id', currentUser.id)
  .order('criado_em', { ascending: false })
  .limit(100);

const total = interacoes?.length || 0;
const tokens = (interacoes || []).reduce((s, r) => s + (r.tokens_usados || 0), 0);
const positivos = (interacoes || []).filter(r => r.feedback_usuario >= 4).length;
const hoje = new Date().toISOString().slice(0, 10);
const hojeCount = (interacoes || []).filter(r => r.criado_em?.startsWith(hoje)).length;

const { data: docs } = await sb
  .from('documentos_fiscais')
  .select('id, tipo')
  .eq('user_id', currentUser.id);
const totalDocs = docs?.length || 0;

if (content) content.innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:4px 0">
    <div style="background:var(--sidebar-hover);border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:var(--primary)">${total}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:4px">Conversas no chat</div>
    </div>
    <div style="background:var(--sidebar-hover);border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:var(--primary)">${hojeCount}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:4px">Consultas hoje</div>
    </div>
    <div style="background:var(--sidebar-hover);border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:var(--primary)">${totalDocs}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:4px">Documentos gerados</div>
    </div>
    <div style="background:var(--sidebar-hover);border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:var(--primary)">${positivos}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:4px">Feedbacks positivos</div>
    </div>
  </div>
  <div style="margin-top:12px;padding:12px;background:var(--sidebar-hover);border-radius:10px;font-size:12px;color:var(--text-light);text-align:center">
    Total de tokens usados: <strong style="color:var(--text)">${tokens.toLocaleString('pt-BR')}</strong>
  </div>`;
  } catch(e) {
if (content) content.innerHTML = '<p style="color:var(--error);text-align:center;padding:20px">Erro ao carregar estatísticas.</p>';
  }
}

async function closeStats() {
  const modal = document.getElementById('statsModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

async function openShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
}

async function closeShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

async function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  document.querySelectorAll('.dropdown-menu').forEach(d => d.style.display = 'none');
  el.style.display = isOpen ? 'none' : 'block';
}

async function toggleDocGenMenu() {
  const menu = document.getElementById('docGenMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}


async function exportChat() {
  if (!currentChat.messages || currentChat.messages.length === 0) {
    alert('Nenhuma mensagem para exportar');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 190; // largura útil (210 - 2*10)
  const marginL = 10, marginR = 10, marginT = 15;
  let y = marginT;

  // Cabeçalho
  doc.setFillColor(27, 67, 50); // verde escuro
  doc.rect(0, 0, 210, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Fiscal365 — Exportação de Conversa', marginL, 8);
  doc.setTextColor(180, 220, 180);
  doc.setFontSize(8);
  const empresa = currentCliente ? currentCliente.razao_social : 'Sem empresa selecionada';
  doc.text(empresa, 210 - marginR, 8, { align: 'right' });

  y = 20;

  // Título do chat
  doc.setTextColor(27, 67, 50);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const titulo = currentChat.title || 'Conversa sem título';
  doc.text(titulo.substring(0, 80), marginL, y);
  y += 5;

  // Data
  doc.setTextColor(107, 114, 128);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' }), marginL, y);
  y += 8;

  // Linha separadora
  doc.setDrawColor(200, 220, 200);
  doc.line(marginL, y, 210 - marginR, y);
  y += 6;

  // Mensagens
  for (const msg of currentChat.messages) {
    const isUser = msg.role === 'user';
    const label = isUser ? 'USUÁRIO' : 'ASSISTENTE';
    const labelColor = isUser ? [37, 99, 235] : [27, 67, 50]; // azul : verde

    // Verificar espaço na página
    if (y > 270) {
      doc.addPage();
      y = 15;
    }

    // Label
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...labelColor);
    doc.text(label, marginL, y);
    y += 5;

    // Conteúdo — quebrar texto longo
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);

    const content = (msg.content || '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
    const lines = doc.splitTextToSize(content, W);

    for (const line of lines) {
      if (y > 275) {
        doc.addPage();
        y = 15;
      }
      doc.text(line, marginL, y);
      y += 4.5;
    }

    // Separador entre mensagens
    y += 3;
    doc.setDrawColor(230, 240, 230);
    doc.line(marginL + 5, y, 210 - marginR - 5, y);
    y += 5;
  }

  // Rodapé na última página
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text(`Fiscal365 · Gerado em ${new Date().toLocaleDateString('pt-BR')} · Página ${p} de ${pageCount}`, 105, 292, { align: 'center' });
  }

  const filename = `fiscal365-chat-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
}

async function shareChat() {
  if (!currentChat.messages || currentChat.messages.length === 0) {
    alert('Nenhuma conversa para compartilhar');
    return;
  }

  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const shareLink = `${window.location.origin}?shared=${token}`;

  const sharedChats = JSON.parse(localStorage.getItem('sharedChats') || '{}');
  sharedChats[token] = {
    chat: currentChat,
    expires: Date.now() + (24 * 60 * 60 * 1000)
  };
  localStorage.setItem('sharedChats', JSON.stringify(sharedChats));

  document.getElementById('shareLink').value = shareLink;
  document.getElementById('shareModal').classList.add('on');
}

async function showLearningStats() {
  const modal = document.getElementById('learningStatsModal');
  if (modal) modal.style.display = 'flex';
  const statsDiv = document.getElementById('learningStatsContent');
  if (statsDiv) statsDiv.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:24px">Carregando...</p>';

  try {
    let countRAG = 0, countDocs = 0, total = 0, avgFeedback = '—';

    // Feedbacks positivos
    try {
      const r = await sb.from('interacoes_chat')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .gte('feedback_usuario', 4);
      countRAG = r.count || 0;
    } catch(e) {}

    // Documentos analisados
    try {
      const r = await sb.from('documentos_fiscais')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id);
      countDocs = r.count || 0;
    } catch(e) {}

    // Interações recentes
    try {
      const { data } = await sb.from('interacoes_chat')
        .select('feedback_usuario')
        .eq('user_id', currentUser.id)
        .order('criado_em', { ascending: false })
        .limit(50);
      total = data?.length || 0;
      if (total > 0) {
        const soma = data.reduce((s, r) => s + (r.feedback_usuario || 0), 0);
        avgFeedback = (soma / total).toFixed(1);
      }
    } catch(e) {}

    // Treinamento — só admin
    let countTreinamento = '—';
    if (isAdmin()) {
      try {
        const r = await supabaseProxy('buscar_treinamento_count', {});
        countTreinamento = r?.count ?? 0;
      } catch(e) {}
    }

    if (!statsDiv) return;

    const cards = [
      { valor: countRAG,  label: 'Feedbacks positivos' },
      { valor: countDocs, label: 'Docs analisados' },
      { valor: total,     label: 'Interações recentes' },
      { valor: avgFeedback, label: 'Feedback médio' }
    ];

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    cards.forEach(function(c) {
      html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">' +
        '<div style="font-size:28px;font-weight:700;color:var(--accent)">' + c.valor + '</div>' +
        '<div style="font-size:11px;color:var(--text-light);margin-top:3px">' + c.label + '</div>' +
        '</div>';
    });

    if (isAdmin()) {
      html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;grid-column:1/-1">' +
        '<div style="font-size:28px;font-weight:700;color:var(--accent)">' + countTreinamento + '</div>' +
        '<div style="font-size:11px;color:var(--text-light);margin-top:3px">Dados de treinamento (admin)</div>' +
        '</div>';
    }

    html += '</div>';
    statsDiv.innerHTML = html;

  } catch(e) {
    console.error('showLearningStats:', e);
    if (statsDiv) statsDiv.innerHTML = '<p style="color:var(--error);text-align:center;padding:16px">Erro ao carregar dados.</p>';
  }
}

function closeLearningStats() {
  const m = document.getElementById('learningStatsModal');
  if (m) m.style.display = 'none';
}

function copyShareLink() {
  const link = document.getElementById('shareLink');
  link.select();
  navigator.clipboard.writeText(link.value);
  alert('Link copiado!');
}

function closeDropdowns() {
  document.querySelectorAll('.hdr-dropdown').forEach(d => d.classList.remove('on'));
}


function fechar(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
}

// Fechar modais com ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
closeDocumentos();
closeCalculator();
closeStats();
closeShareModal();
if (typeof closeProfile === 'function') closeProfile();
  }
});
