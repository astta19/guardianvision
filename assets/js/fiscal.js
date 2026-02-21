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

async function switchDocTab(tab) {
  document.querySelectorAll('#docModal .doc-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('#docModal .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`docPanel_${tab}`)?.classList.remove('hidden');
  document.querySelector(`#docModal [onclick="switchDocTab('${tab}')"]`)?.classList.add('active');
}

async function switchProfileTab(tab) {
  document.querySelectorAll('#profileModal .doc-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('#profileModal .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`profilePanel_${tab}`)?.classList.remove('hidden');
  document.querySelector(`#profileModal [onclick="switchProfileTab('${tab}')"]`)?.classList.add('active');
}

async function openDocumentos() {
  const modal = document.getElementById('docModal');
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
  switchDocTab('nfe');
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
  if (modal) { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
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

      const chatText = currentChat.messages.map(msg => {
        const role = msg.role === 'user' ? 'USUÁRIO' : 'ASSISTENTE';
        return `${role}:\n${msg.content}\n`;
      }).join('\n' + '='.repeat(50) + '\n\n');

      const blob = new Blob([chatText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversa_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
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
      const [stats, melhoresPerguntas, countRAG, countDocs, countTreinamento] = await Promise.all([
        learningService.buscarEstatisticas(),
        learningService.buscarMelhoresPerguntas(5),
        sb.from('interacoes_chat').select('id', { count: 'exact', head: true }).gte('feedback_usuario', 4),
        sb.from('documentos_analisados').select('id', { count: 'exact', head: true }),
        supabaseProxy('buscar_treinamento_count', {}).catch(() => ({ count: 0 }))
      ]);

      let statsHTML = '<div class="stats-card">';

      statsHTML += `
        <div class="stats-item"><span>Respostas na memória RAG</span><strong>${countRAG.count || 0}</strong></div>
        <div class="stats-item"><span>Documentos salvos</span><strong>${countDocs.count || 0}</strong></div>
        <div class="stats-item"><span>Base de treinamento</span><strong>${countTreinamento.count || 0} registros</strong></div>
      `;

      if (stats.length > 0) {
        statsHTML += '<h4 style="margin-top:14px">Últimos 7 dias</h4>';
        stats.forEach(s => {
          statsHTML += `
            <div class="stats-item">
              <span>${new Date(s.data).toLocaleDateString('pt-BR')}</span>
              <span>${s.total_interacoes || 0} perguntas | ${s.taxa_acerto_media?.toFixed(1) || 0}% acerto</span>
            </div>`;
        });
      } else {
        statsHTML += '<p style="padding:8px 0;font-size:13px;color:var(--text-light)">Nenhuma estatística ainda. Continue usando o chat!</p>';
      }

      if (melhoresPerguntas.length > 0) {
        statsHTML += '<h4 style="margin-top:14px">Melhores feedbacks</h4>';
        melhoresPerguntas.forEach(p => {
          statsHTML += `
            <div class="stats-item">
              <span>${p.pergunta.substring(0, 50)}...</span>
              <span>Nota: ${p.feedback_usuario}/5</span>
            </div>`;
        });
      }

      statsHTML += '</div>';

      document.getElementById('learningStatsContent').innerHTML = statsHTML;
      document.getElementById('learningStatsModal').classList.add('on');
      lucide.createIcons();
    }

    function closeLearningStats() {
      document.getElementById('learningStatsModal').classList.remove('on');
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
