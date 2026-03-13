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
  if (!modal) return;
  modal.style.display = 'flex';
  switchDocTab('nfe', modal.querySelector('.doc-tab'));
  lucide.createIcons();
  setTimeout(() => document.getElementById('nfeFileInput')?.closest('button')?.focus?.(), 50);
  // Restaurar último DARF calculado se existir na sessão
  if (typeof carregarUltimoDarf === 'function') carregarUltimoDarf();
}

async function closeDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) modal.style.display = 'none';
}

async function openCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  lucide.createIcons();
  setTimeout(() => document.getElementById('cV')?.focus(), 50);
}

async function closeCalculator() {
  const modal = document.getElementById('calcModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

async function showStats() {
  const modal = document.getElementById('statsModal');
  if (!modal) return;
  if (!currentUser) return;
  modal.classList.remove('hidden');
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

async function carregarChatCompartilhado(token) {
  const { data, error } = await sb
    .from('shared_chats')
    .select('title, messages, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single();

  // Limpar o token da URL sem recarregar
  const url = new URL(window.location);
  url.searchParams.delete('shared');
  history.replaceState({}, '', url);

  if (error || !data) {
    showToast('Link inválido ou expirado.', 'error');
    return;
  }

  // Carregar mensagens no chat atual (somente leitura — não salva)
  currentChat = { id: null, title: data.title, messages: data.messages };
  if (typeof renderMessages === 'function') renderMessages();
  if (typeof updateChatTitle === 'function') updateChatTitle(data.title);

  const exp = new Date(data.expires_at).toLocaleDateString('pt-BR');
  showToast?.(`Chat compartilhado carregado. Válido até ${exp}.`);
}

async function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display === 'block';
  closeDropdowns(); // fechar todos antes
  el.style.display = isOpen ? 'none' : 'block';
}

async function toggleDocGenMenu() {
  const menu = document.getElementById('docGenMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}


function exportChatTxt() {
  if (!currentChat.messages?.length) { showToast('Nenhuma mensagem para exportar.', 'warn'); return; }

  const titulo  = currentChat.title || 'Conversa';
  const empresa = currentCliente ? currentCliente.razao_social : '';
  const data    = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

  let txt = `FISCAL365 — EXPORTAÇÃO DE CONVERSA\n`;
  txt += `${'='.repeat(50)}\n`;
  txt += `Título: ${titulo}\n`;
  if (empresa) txt += `Empresa: ${empresa}\n`;
  txt += `Data: ${data}\n`;
  txt += `${'='.repeat(50)}\n\n`;

  for (const msg of currentChat.messages) {
    if (msg._resumo) continue;
    const label = msg.role === 'user' ? '[ VOCÊ ]' : '[ FISCAL365 ]';
    txt += `${label}\n`;
    txt += (msg.content || '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
    txt += `\n\n${'─'.repeat(40)}\n\n`;
  }

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `fiscal365-chat-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportChat() {
  if (!currentChat.messages || currentChat.messages.length === 0) {
    showToast('Nenhuma mensagem para exportar.', 'warn');
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
    showToast('Nenhuma conversa para compartilhar.', 'warn');
    return;
  }

  const token = crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const expires = new Date(Date.now() + 7 * 86400000).toISOString();

  // Limpar mensagens internas antes de compartilhar
  const mensagensPublicas = currentChat.messages
    .filter(m => !m._resumo)
    .map(m => ({ role: m.role, content: m.content || '' }));

  const { error } = await sb.from('shared_chats').insert({
    token,
    title:      currentChat.title || 'Conversa',
    messages:   mensagensPublicas,
    created_by: currentUser?.id || null,
    expires_at: expires,
  });

  if (error) {
    showToast('Erro ao gerar link: ' + error.message, 'error');
    return;
  }

  const shareLink = `${window.location.origin}?shared=${token}`;
  const el = document.getElementById('shareLink');
  if (el) el.value = shareLink;
  openShareModal();
}

async function showLearningStats() {
  const modal = document.getElementById('learningStatsModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  if (!currentUser) return;
  const statsDiv = document.getElementById('learningStatsContent');
  if (statsDiv) statsDiv.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:24px">Carregando...</p>';

  try {
    let countRAG = 0, countDocs = 0, countTreinamento = 0;

    try {
      const r = await sb.from('interacoes_chat')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .gte('feedback_usuario', 4);
      countRAG = r.count || 0;
    } catch(e) {}

    try {
      const r = await sb.from('documentos_analisados')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id);
      countDocs = r.count || 0;
    } catch(e) {}

    if (isAdmin()) {
      try {
        const r = await supabaseProxy('buscar_treinamento_count', {});
        countTreinamento = r?.count ?? 0;
      } catch(e) {}
    }

    const { data: interacoes } = await sb
      .from('interacoes_chat')
      .select('feedback_usuario')
      .eq('user_id', currentUser.id)
      .order('criado_em', { ascending: false })
      .limit(50);

    const total = interacoes?.length || 0;
    const avgFeedback = total > 0
      ? ((interacoes || []).reduce((s, r) => s + (r.feedback_usuario || 0), 0) / total).toFixed(1)
      : '—';

    if (!statsDiv) return;

    statsDiv.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div style="background:var(--sidebar-hover);border-radius:10px;padding:14px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:var(--primary)">' + countTreinamento + '</div>' +
          '<div style="font-size:11px;color:var(--text-light);margin-top:3px">Dados de treinamento</div>' +
        '</div>' +
        '<div style="background:var(--sidebar-hover);border-radius:10px;padding:14px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:var(--primary)">' + countRAG + '</div>' +
          '<div style="font-size:11px;color:var(--text-light);margin-top:3px">Feedbacks positivos</div>' +
        '</div>' +
        '<div style="background:var(--sidebar-hover);border-radius:10px;padding:14px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:var(--primary)">' + countDocs + '</div>' +
          '<div style="font-size:11px;color:var(--text-light);margin-top:3px">Docs analisados</div>' +
        '</div>' +
        '<div style="background:var(--sidebar-hover);border-radius:10px;padding:14px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:var(--primary)">' + avgFeedback + '</div>' +
          '<div style="font-size:11px;color:var(--text-light);margin-top:3px">Feedback médio</div>' +
        '</div>' +
      '</div>';

  } catch(e) {
    console.error('showLearningStats:', e);
    if (statsDiv) statsDiv.innerHTML = '<p style="color:var(--error);text-align:center;padding:16px">Erro ao carregar dados de aprendizado.</p>';
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
  showToast('Link copiado!', 'success');
}

function closeDropdowns() {
  document.querySelectorAll('.hdr-dropdown').forEach(d => {
    d.style.display = 'none';
    d.classList.remove('on');
  });
}


function fechar(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
}

// ESC: tratado globalmente em core.js

// ════════════════════════════════════════════════════════════
// GESTÃO DO ESCRITÓRIO
// ════════════════════════════════════════════════════════════

let _escritorioId = null;

function escritorioReset() {
  _escritorioId = null;
}

// ── Gestão do Escritório — tabs ─────────────────────────────
function gestaoSwitchTab(tab) {
  const isMembros = tab === 'membros';
  document.getElementById('gestaoSecMembros').style.display  = isMembros ? '' : 'none';
  document.getElementById('gestaoSecLogins').style.display   = isMembros ? 'none' : '';
  document.getElementById('gestaoTabMembros').style.color         = isMembros ? 'var(--accent)' : 'var(--text-light)';
  document.getElementById('gestaoTabMembros').style.fontWeight    = isMembros ? '600' : '400';
  document.getElementById('gestaoTabMembros').style.borderBottom  = isMembros ? '2px solid var(--accent)' : '2px solid transparent';
  document.getElementById('gestaoTabLogins').style.color          = isMembros ? 'var(--text-light)' : 'var(--accent)';
  document.getElementById('gestaoTabLogins').style.fontWeight     = isMembros ? '400' : '600';
  document.getElementById('gestaoTabLogins').style.borderBottom   = isMembros ? '2px solid transparent' : '2px solid var(--accent)';
  if (!isMembros) _carregarLogins();
}

async function _carregarLogins() {
  const el = document.getElementById('gestaoLoginsLista');
  if (!el) return;
  el.innerHTML = '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Carregando...</p>';
  try {
    const res = await supabaseProxy('listar_logins', {});
    if (res?.error) throw new Error(res.error);
    const logins = res.logins || [];
    if (!logins.length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Nenhum usuário encontrado.</p>';
      return;
    }
    const fmtData = iso => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    };
    const roleLabel = { master: 'Master', admin: 'Admin', contador: 'Contador' };
    const roleCor   = { master: '#7c3aed', admin: '#2563eb', contador: '#16a34a' };
    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="border-bottom:2px solid var(--border);color:var(--text-light)">
            <th style="text-align:left;padding:6px 8px;font-weight:600">Usuário</th>
            <th style="text-align:left;padding:6px 8px;font-weight:600">Cadastro</th>
            <th style="text-align:left;padding:6px 8px;font-weight:600">Último login</th>
            <th style="text-align:center;padding:6px 8px;font-weight:600">Status</th>
          </tr>
        </thead>
        <tbody>
          ${logins.map(u => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 8px">
                <div style="font-weight:500;color:var(--text)">${escapeHtml(u.nome || u.email)}</div>
                ${u.nome ? `<div style="font-size:11px;color:var(--text-light)">${escapeHtml(u.email)}</div>` : ''}
                <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;background:${roleCor[u.role]||'#64748b'}22;color:${roleCor[u.role]||'#64748b'}">${roleLabel[u.role]||u.role}</span>
              </td>
              <td style="padding:8px 8px;color:var(--text-light);white-space:nowrap">${fmtData(u.created_at)}</td>
              <td style="padding:8px 8px;white-space:nowrap;${!u.last_sign_in_at?'color:var(--text-light)':''}">${fmtData(u.last_sign_in_at)}</td>
              <td style="padding:8px 8px;text-align:center">
                ${u.email_confirmed
                  ? '<span style="font-size:10px;font-weight:700;background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:8px">Ativo</span>'
                  : '<span style="font-size:10px;font-weight:700;background:#fef3c7;color:#d97706;padding:2px 7px;border-radius:8px">Pendente</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    el.innerHTML = `<p style="font-size:13px;color:var(--error);text-align:center;padding:20px">Erro: ${escapeHtml(e.message)}</p>`;
  }
}

async function abrirConvites() {
  const modal = document.getElementById('convitesModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('vincularMsg').textContent = '';
  document.getElementById('vincularEmail').value     = '';
  _escritorioId = null; // reset cache para recarregar
  await _carregarMembros();
}

function fecharConvites() {
  const modal = document.getElementById('convitesModal');
  if (modal) modal.style.display = 'none';
}

async function _getEscritorioId() {
  if (_escritorioId) return _escritorioId;
  const { data, error } = await sb
    .from('escritorios').select('id')
    .eq('owner_id', currentUser.id).limit(1);
  if (error) throw new Error('Erro ao buscar escritório: ' + error.message);
  if (!data?.length) throw new Error('Escritório não encontrado. Execute o SQL check_escritorio.sql no Supabase.');
  _escritorioId = data[0].id;
  return _escritorioId;
}

async function _carregarMembros() {
  const el = document.getElementById('escritorioMembros');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-light);font-size:13px;text-align:center;padding:12px">Carregando...</p>';

  try {
    const escId = await _getEscritorioId();

    // Buscar vínculos
    const { data: vinculos, error: vErr } = await sb
      .from('escritorio_usuarios').select('user_id').eq('escritorio_id', escId);
    if (vErr) throw new Error(vErr.message);

    if (!vinculos?.length) {
      el.innerHTML = '<p style="color:var(--text-light);font-size:13px;text-align:center;padding:12px">Nenhum membro ainda.</p>';
      return;
    }

    let allUsers = [];
    try {
      const proxyData = await supabaseProxy('listar_usuarios', {});
      allUsers = proxyData.usuarios || proxyData.users || [];
    } catch(_) {}

    const membros = vinculos.map(v => {
      const u = allUsers.find(u => u.id === v.user_id);
      // fallback: admin está filtrado do proxy, usar e-mail da sessão
      const email = u?.email || (v.user_id === currentUser.id ? currentUser.email : v.user_id);
      return { user_id: v.user_id, email };
    });

    el.innerHTML = membros.map(m => {
      const isOwner = m.user_id === currentUser.id;
      const inicial = (m.email || '?').charAt(0).toUpperCase();
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--sidebar-hover);border-radius:10px">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${inicial}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.email}</div>
          <div style="font-size:11px;color:var(--text-light)">${isOwner ? 'Administrador' : 'Contador'}</div>
        </div>
        ${!isOwner ? `<button onclick="_removerMembro('${escId}','${m.user_id}')" style="background:none;border:none;cursor:pointer;color:#dc2626;padding:4px" title="Remover"><i data-lucide="user-minus" style="width:15px;height:15px"></i></button>` : ''}
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();

  } catch (e) {
    el.innerHTML = `<p style="color:#dc2626;font-size:13px;padding:12px">Erro: ${e.message}</p>`;
  }
}

async function vincularUsuarioManual() {
  const email = document.getElementById('vincularEmail').value.trim().toLowerCase();
  const msgEl = document.getElementById('vincularMsg');
  const btn   = document.getElementById('vincularBtn');
  if (!email) { msgEl.style.color = '#dc2626'; msgEl.textContent = 'Informe o e-mail.'; return; }

  btn.disabled = true;
  msgEl.style.color = 'var(--text-light)';
  msgEl.textContent = 'Buscando usuário...';

  try {
    const escId = await _getEscritorioId();

    const lista = await supabaseProxy('listar_usuarios', {});
    const found = (lista.usuarios || lista.users || []).find(u => u.email?.toLowerCase() === email);
    if (!found?.id) throw new Error('Usuário não encontrado. Ele precisa ter feito login ao menos uma vez.');

    const { error } = await sb
      .from('escritorio_usuarios')
      .insert({ escritorio_id: escId, user_id: found.id });

    if (error && error.code !== '23505') throw new Error(error.message);

    msgEl.style.color = '#16a34a';
    msgEl.textContent = '✓ Usuário adicionado!';
    document.getElementById('vincularEmail').value = '';
    await _carregarMembros();

  } catch (e) {
    msgEl.style.color = '#dc2626';
    msgEl.textContent = '⚠ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function _removerMembro(escritorioId, userId) {
  if (!confirm('Remover este membro do escritório?')) return;
  const { error } = await sb
    .from('escritorio_usuarios').delete()
    .eq('escritorio_id', escritorioId).eq('user_id', userId);
  if (!error) await _carregarMembros();
  else alert('Erro ao remover: ' + error.message);
}
