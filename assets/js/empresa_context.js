// ============================================================
// EMPRESA_CONTEXT.JS — Contexto rico da empresa para a IA
// ============================================================
// Busca dados reais do banco (DARFs, financeiro, funcionários,
// agenda) e monta um bloco de contexto injetado no system prompt.
// Cache de 5 minutos para não sobrecarregar o Supabase.

const EmpresaContext = (() => {

  let _cache    = null;
  let _cacheTs  = 0;
  let _cacheId  = null;
  const TTL_MS  = 5 * 60 * 1000; // 5 minutos

  // ── Busca paralela de todos os dados ─────────────────────
  async function buscar(clienteId, userId) {
    const agora = Date.now();
    if (_cache && _cacheId === clienteId && (agora - _cacheTs) < TTL_MS) return _cache;

    const [darfs, ultimoDarf, lancamentos, funcionarios, agenda, holerites] = await Promise.allSettled([

      // Histórico de DARFs salvos explicitamente
      sb.from('darf_historico')
        .select('competencia, regime, total, status, data_pgto')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .order('competencia', { ascending: false }).limit(12),

      // Último DARF calculado (salvo automaticamente a cada cálculo)
      sb.from('documentos_fiscais')
        .select('dados, criado_em')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .eq('tipo', 'darf')
        .order('criado_em', { ascending: false }).limit(1),

      // Lançamentos do ano corrente
      sb.from('lancamentos')
        .select('tipo, categoria, descricao, valor, data_venc, status')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .gte('data_venc', `${new Date().getFullYear()}-01-01`)
        .order('data_venc', { ascending: false }).limit(50),

      // Funcionários ativos
      sb.from('dp_funcionarios')
        .select('nome, cargo, tipo_contrato, salario_base, admissao, status')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .eq('status', 'ativo').limit(30),

      // Tarefas pendentes próximas (60 dias)
      sb.from('agenda_tarefas')
        .select('titulo, prazo, prioridade, origem, status')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .eq('status', 'pendente')
        .lte('prazo', new Date(Date.now() + 60*24*60*60*1000).toISOString().slice(0,10))
        .order('prazo').limit(20),

      // Último holerite processado
      sb.from('dp_holerites')
        .select('competencia, salario_bruto, total_descontos, salario_liquido')
        .eq('user_id', userId).eq('cliente_id', clienteId)
        .order('competencia', { ascending: false }).limit(1),
    ]);

    const result = {
      darfs:       darfs.status       === 'fulfilled' ? darfs.value.data       || [] : [],
      ultimoDarf:  ultimoDarf.status  === 'fulfilled' ? ultimoDarf.value.data?.[0] || null : null,
      lancamentos: lancamentos.status === 'fulfilled' ? lancamentos.value.data || [] : [],
      funcionarios:funcionarios.status=== 'fulfilled' ? funcionarios.value.data|| [] : [],
      agenda:      agenda.status      === 'fulfilled' ? agenda.value.data      || [] : [],
      holerites:   holerites.status   === 'fulfilled' ? holerites.value.data   || [] : [],
    };

    _cache   = result;
    _cacheTs = agora;
    _cacheId = clienteId;
    return result;
  }

  // ── Montar bloco de texto para o system prompt ────────────
  function montar(cliente, dados) {
    if (!cliente) return '';

    const fmt  = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const fmtD = d => d ? new Date(d + 'T00:00').toLocaleDateString('pt-BR') : '—';
    const lines = [];

    // Dados cadastrais da empresa
    lines.push('════════════════════════════════════════');
    lines.push('CONTEXTO COMPLETO DA EMPRESA ATIVA');
    lines.push('════════════════════════════════════════');
    lines.push(`Razão Social : ${cliente.razao_social}`);
    lines.push(`Nome Fantasia: ${cliente.nome_fantasia || '—'}`);
    lines.push(`CNPJ         : ${cliente.cnpj || '—'}`);
    lines.push(`Regime       : ${cliente.regime_tributario || 'Não informado'}`);
    lines.push(`Regime Apur. : ${cliente.regime_apuracao || '—'}`);
    lines.push(`CNAE         : ${cliente.cnae_principal || '—'} — ${cliente.cnae_descricao || '—'}`);
    lines.push(`Natureza Jur.: ${cliente.natureza_juridica || '—'}`);
    lines.push(`Porte        : ${cliente.porte || '—'}`);
    lines.push(`Abertura     : ${cliente.data_abertura || '—'}`);
    lines.push(`Capital Soc. : ${cliente.capital_social ? 'R$ ' + Number(cliente.capital_social).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'}`);
    lines.push(`Situação     : ${cliente.situacao_cadastral || '—'}`);
    lines.push(`Ins. Estadual: ${cliente.inscricao_estadual || '—'}`);
    lines.push(`Ins. Municipal: ${cliente.inscricao_municipal || '—'}`);
    lines.push(`Endereço     : ${[cliente.logradouro,cliente.numero,cliente.bairro,cliente.municipio,cliente.uf].filter(Boolean).join(', ') || '—'}`);
    lines.push(`Telefone     : ${cliente.telefone || '—'}`);
    lines.push(`E-mail       : ${cliente.email_empresa || '—'}`);
    lines.push(`Tem empregado: ${cliente.tem_empregado ? 'Sim' : 'Não'}`);
    lines.push(`Optante Simpl: ${cliente.optante_simples ? 'Sim' : 'Não'}`);
    // Sócios
    if (cliente.socios?.length) {
      lines.push(`Sócios (${cliente.socios.length}):`);
      cliente.socios.forEach(s => {
        const pl = s.prolabore ? ` — Pró-labore: R$ ${Number(s.prolabore).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '';
        lines.push(`  • ${s.nome} (${s.qualificacao || '—'})${pl}`);
      });
    }
    // Financeiro cadastral
    if (cliente.faturamento_mensal) lines.push(`Fat. Mensal  : R$ ${fmt(cliente.faturamento_mensal)}`);
    if (cliente.faturamento_anual)  lines.push(`Fat. Anual   : R$ ${fmt(cliente.faturamento_anual)}`);
    if (cliente.prolabore_total)    lines.push(`Pró-labore   : R$ ${fmt(cliente.prolabore_total)}`);

    // Histórico de DARFs
    lines.push('\n── DARFS ────────────────────────────────');
    if (dados.darfs?.length) {
      const pendentes = dados.darfs.filter(d => d.status === 'pendente');
      const pagos     = dados.darfs.filter(d => d.status === 'pago');
      if (pendentes.length) {
        lines.push(`⚠️  Pendentes (${pendentes.length}):`);
        pendentes.forEach(d =>
          lines.push(`  • ${d.competencia} — R$ ${fmt(d.total)} [${d.regime}]`)
        );
        lines.push(`  Total pendente: R$ ${fmt(pendentes.reduce((a,d) => a + +d.total, 0))}`);
      }
      if (pagos.length) {
        lines.push(`✅ Pagos (${pagos.length}):`);
        pagos.slice(0, 6).forEach(d =>
          lines.push(`  • ${d.competencia} — R$ ${fmt(d.total)} — pago em ${fmtD(d.data_pgto)}`)
        );
      }
    } else if (dados.ultimoDarf?.dados) {
      // Nenhum DARF salvo no histórico — mostrar o último cálculo feito
      const d = dados.ultimoDarf.dados;
      lines.push(`  Último cálculo: competência ${d.competencia || '—'} — Total R$ ${fmt(d.totalFinal)} [${d.regime || '—'}]`);
      lines.push(`  Status: apenas calculado, não foi marcado como pago/pendente no histórico.`);
      lines.push(`  Dica: o contador pode salvar no histórico pelo botão "Salvar" após calcular.`);
    } else {
      lines.push('  Nenhum DARF calculado ou salvo ainda para esta empresa.');
    }

    // Situação financeira do ano
    if (dados.lancamentos?.length) {
      const rec  = dados.lancamentos.filter(l => l.tipo === 'receita').reduce((a,l) => a + +l.valor, 0);
      const desp = dados.lancamentos.filter(l => l.tipo === 'despesa').reduce((a,l) => a + +l.valor, 0);
      const vencidos = dados.lancamentos.filter(l =>
        l.status === 'pendente' && new Date(l.data_venc + 'T00:00') < new Date()
      );
      lines.push('\n── FINANCEIRO (ano corrente) ────────────');
      lines.push(`  Receitas: R$ ${fmt(rec)}`);
      lines.push(`  Despesas: R$ ${fmt(desp)}`);
      lines.push(`  Saldo   : R$ ${fmt(rec - desp)}`);
      if (vencidos.length) {
        lines.push(`  ⚠️ ${vencidos.length} lançamento(s) vencido(s) — R$ ${fmt(vencidos.reduce((a,l) => a + +l.valor, 0))}`);
      }
      // Maiores despesas por categoria
      const catDesp = {};
      dados.lancamentos.filter(l => l.tipo === 'despesa').forEach(l => {
        catDesp[l.categoria] = (catDesp[l.categoria] || 0) + +l.valor;
      });
      const topCats = Object.entries(catDesp).sort((a,b) => b[1]-a[1]).slice(0,3);
      if (topCats.length) {
        lines.push('  Principais despesas:');
        topCats.forEach(([cat, val]) => lines.push(`    • ${cat}: R$ ${fmt(val)}`));
      }
    }

    // Quadro de pessoal
    if (dados.funcionarios?.length) {
      lines.push('\n── QUADRO DE PESSOAL ────────────────────');
      lines.push(`  Total de funcionários ativos: ${dados.funcionarios.length}`);
      const folhaTotal = dados.funcionarios.reduce((a,f) => a + +f.salario_base, 0);
      lines.push(`  Folha bruta total: R$ ${fmt(folhaTotal)}`);
      const porTipo = {};
      dados.funcionarios.forEach(f => { porTipo[f.tipo_contrato] = (porTipo[f.tipo_contrato]||0)+1; });
      Object.entries(porTipo).forEach(([tipo, qt]) => lines.push(`    • ${tipo.toUpperCase()}: ${qt}`));
    } else {
      lines.push('\n── QUADRO DE PESSOAL ────────────────────');
      lines.push('  Sem funcionários cadastrados.');
    }

    // Agenda — prazos próximos
    if (dados.agenda?.length) {
      lines.push('\n── PRAZOS PENDENTES (próximos 60 dias) ──');
      dados.agenda.forEach(t => {
        const prioridade = t.prioridade === 'alta' ? '🔴' : t.prioridade === 'media' ? '🟡' : '🟢';
        lines.push(`  ${prioridade} ${fmtD(t.prazo)} — ${t.titulo}`);
      });
    }

    // Último holerite
    if (dados.holerites?.length) {
      const h = dados.holerites[0];
      lines.push('\n── ÚLTIMO HOLERITE PROCESSADO ───────────');
      lines.push(`  Competência: ${h.competencia}`);
      lines.push(`  Bruto: R$ ${fmt(h.salario_bruto)} | Descontos: R$ ${fmt(h.total_descontos)} | Líquido: R$ ${fmt(h.salario_liquido)}`);
    }

    lines.push('════════════════════════════════════════');
    lines.push('INSTRUÇÕES DE USO DO CONTEXTO:');
    lines.push('- Use SEMPRE os dados acima ao responder perguntas sobre esta empresa.');
    lines.push('- Se um dado estiver listado como "Nenhum" ou "Sem registros", informe isso diretamente — não diga que "não há informações suficientes".');
    lines.push('- Se o usuário perguntar sobre DARF pendente e o histórico estiver vazio, explique que nenhum DARF foi salvo no histórico ainda e oriente a calcular pelo módulo Documentos.');
    lines.push('- Nunca invente valores. Nunca direcione para a Receita Federal quando os dados já estão disponíveis acima.');

    return lines.join('\n');
  }

  // ── API pública ───────────────────────────────────────────
  return {
    invalidar() { _cache = null; _cacheTs = 0; },

    async obterContexto(cliente, userId) {
      if (!cliente?.id) return '';
      try {
        const dados = await buscar(cliente.id, userId);
        return montar(cliente, dados);
      } catch(e) {
        console.error('EmpresaContext:', e);
        return `EMPRESA ATIVA: ${cliente.razao_social} (CNPJ: ${cliente.cnpj}) — Regime: ${cliente.regime_tributario}`;
      }
    }
  };
})();
