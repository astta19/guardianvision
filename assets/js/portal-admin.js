// ============================================================
// PORTAL-ADMIN.JS — Geração e gestão de links do portal
// Usado dentro do sistema principal (contador)
// ============================================================

// ── Abrir modal de gestão de links ──────────────────────────
async function abrirPortalCliente() {
  if (!currentCliente) {
    showToast('Selecione uma empresa primeiro.', 'warn');
    return;
  }
  closeDropdowns();

  const nomeEl = document.getElementById('portalClienteNome');
  if (nomeEl) nomeEl.textContent = currentCliente.nome_fantasia || currentCliente.razao_social;

  const modal = document.getElementById('portalAdminModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  await portalCarregarLinks();
}

function fecharPortalAdmin() {
  document.getElementById('portalAdminModal').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Carregar links existentes ────────────────────────────────
async function portalCarregarLinks() {
  const el = document.getElementById('portalLinksList');
  el.innerHTML = '<p style="font-size:13px;color:var(--text-light);text-align:center;padding:20px">Carregando...</p>';

  const { data, error } = await sb
    .from('portal_tokens')
    .select('*')
    .eq('cliente_id', currentCliente.id)
    .eq('user_id', currentUser.id)
    .order('criado_em', { ascending: false });

  if (error || !data?.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--text-light)">
        <i data-lucide="link" style="width:32px;height:32px;display:block;margin:0 auto 10px;opacity:.3"></i>
        <p style="font-size:13px">Nenhum link gerado ainda para este cliente.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  const hoje = new Date();
  el.innerHTML = data.map(tk => {
    const expirado = new Date(tk.expira_em) < hoje;
    const diasRestantes = Math.ceil((new Date(tk.expira_em) - hoje) / 86400000);
    const link = `${window.location.origin}/portal.html?token=${tk.token}`;
    return `
      <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:var(--text)">
            ${new Date(tk.criado_em).toLocaleDateString('pt-BR')}
          </span>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600;
            background:${expirado ? '#fef2f2' : '#f0fdf4'};
            color:${expirado ? '#dc2626' : '#16a34a'}">
            ${expirado ? 'Expirado' : `Válido — ${diasRestantes}d`}
          </span>
          ${tk.ultimo_acesso ? `<span style="font-size:11px;color:var(--text-light)">Último acesso: ${new Date(tk.ultimo_acesso).toLocaleDateString('pt-BR')}</span>` : '<span style="font-size:11px;color:var(--text-light)">Nunca acessado</span>'}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="text" value="${link}" readonly
            style="flex:1;font-size:11px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);min-width:0">
          <button onclick="portalCopiarLink('${link}', this)" title="Copiar link"
            style="display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--accent);color:var(--user-text);border:none;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;font-weight:600">
            <i data-lucide="copy" style="width:12px;height:12px"></i> Copiar
          </button>
          <button onclick="portalRevogarLink('${tk.id}')" title="Revogar"
            style="padding:6px 10px;background:none;border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;color:var(--text-light);display:flex;align-items:center">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();
}

// ── Gerar novo link ──────────────────────────────────────────
async function portalGerarLink() {
  const btn = document.getElementById('btnPortalGerar');
  btn.disabled = true;
  btn.textContent = 'Gerando...';

  const validade = parseInt(document.getElementById('portalValidade').value) || 90;

  try {
    const { data, error } = await sb
      .from('portal_tokens')
      .insert({
        cliente_id:   currentCliente.id,
        user_id:      currentUser.id,
        escritorio_id: await getEscritorioIdAtual(),
        expira_em:    new Date(Date.now() + validade * 86400000).toISOString()
      })
      .select('token')
      .single();

    if (error || !data?.token) {
      console.error('portalGerarLink error:', error);
      portalShowMsg('Erro ao gerar link: ' + (error?.message || 'verifique se a tabela portal_tokens existe no Supabase.'), 'error');
      return;
    }

    const link = `${window.location.origin}/portal.html?token=${data.token}`;
    await portalCarregarLinks();

    try {
      await navigator.clipboard.writeText(link);
      portalShowMsg('✅ Link gerado e copiado para a área de transferência!', 'success');
    } catch {
      portalShowMsg('✅ Link gerado! Copie abaixo para enviar ao cliente.', 'success');
    }
  } catch (e) {
    console.error('portalGerarLink exception:', e);
    portalShowMsg('Erro inesperado ao gerar link.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar novo link';
  }
}

// ── Copiar link ──────────────────────────────────────────────}

// ── Copiar link ──────────────────────────────────────────────
async function portalCopiarLink(link, btn) {
  try {
    await navigator.clipboard.writeText(link);
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado';
    btn.style.background = '#16a34a';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
    }, 2000);
  } catch {
    prompt('Copie o link abaixo:', link);
  }
}

// ── Revogar link ─────────────────────────────────────────────
function portalRevogarLink(tokenId) {
  showConfirm('Revogar este link? O cliente perderá o acesso imediatamente.', async () => {
    const { error } = await sb.from('portal_tokens').delete().eq('id', tokenId);
    if (error) { showToast('Erro ao revogar o link. Tente novamente.', 'error'); return; }
    await portalCarregarLinks();
    portalShowMsg('Link revogado.', 'info');
  });
}

// ── Mensagem de feedback ─────────────────────────────────────
function portalShowMsg(msg, tipo) {
  const el = document.getElementById('portalMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = tipo === 'success' ? '#16a34a' : tipo === 'error' ? '#dc2626' : 'var(--text-light)';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
