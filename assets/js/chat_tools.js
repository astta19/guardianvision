// ============================================================
// CHAT_TOOLS.JS — Tool Use (Function Calling) via Groq/Llama
// ============================================================
// As tools permitem que a IA abra módulos, pré-preencha campos
// e crie registros diretamente a partir do chat.

// ── Definição das tools (formato OpenAI / Groq) ──────────────
const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'abrir_sped',
      description: 'Abre o módulo SPED e pré-preenche o período de competência. Use quando o usuário pedir para criar, abrir ou gerar o SPED de um determinado mês/ano.',
      parameters: {
        type: 'object',
        properties: {
          mes:  { type: 'integer', description: 'Mês (1-12)' },
          ano:  { type: 'integer', description: 'Ano (ex: 2026)' },
          uf:   { type: 'string',  description: 'UF do estado (ex: SP, RJ). Usar a da empresa se não informado.' },
        },
        required: ['mes', 'ano'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_darf',
      description: 'Abre o módulo DARF/DAS e pré-preenche os valores para cálculo. Use quando o usuário pedir para calcular imposto, DAS, DARF de uma competência.',
      parameters: {
        type: 'object',
        properties: {
          competencia:  { type: 'string',  description: 'Competência no formato MM/AAAA (ex: 02/2026)' },
          faturamento:  { type: 'number',  description: 'Faturamento bruto do período em R$' },
          regime:       { type: 'string',  description: 'Regime tributário: mei | simples | presumido | real' },
          prolabore:    { type: 'number',  description: 'Total de pró-labore em R$ (opcional)' },
          folha:        { type: 'number',  description: 'Total da folha de pagamento em R$ (opcional)' },
        },
        required: ['competencia'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_lancamento',
      description: 'Cria um lançamento financeiro (receita ou despesa) no módulo Financeiro. Use quando o usuário informar um pagamento, despesa, imposto a pagar ou recebimento.',
      parameters: {
        type: 'object',
        properties: {
          tipo:        { type: 'string', description: 'receita ou despesa' },
          descricao:   { type: 'string', description: 'Descrição do lançamento' },
          valor:       { type: 'number', description: 'Valor em R$' },
          data_venc:   { type: 'string', description: 'Data de vencimento no formato YYYY-MM-DD' },
          categoria:   { type: 'string', description: 'Categoria do lançamento (ex: Impostos e tributos, Honorários contábeis)' },
          status:      { type: 'string', description: 'pendente ou pago' },
        },
        required: ['tipo', 'descricao', 'valor', 'data_venc'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abrir_folha',
      description: 'Abre o módulo de Folha de Pagamento. Use quando o usuário pedir para ver funcionários, processar folha, calcular holerite ou acessar o departamento pessoal.',
      parameters: {
        type: 'object',
        properties: {
          aba: { type: 'string', description: 'Aba para abrir: funcionarios | folha | ferias | decimo | rescisao | relatorios' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abrir_agenda',
      description: 'Abre a agenda de prazos fiscais. Use quando o usuário perguntar sobre prazos, obrigações do mês ou querer ver o calendário fiscal.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'abrir_financeiro',
      description: 'Abre o módulo financeiro. Use quando o usuário quiser ver lançamentos, fluxo de caixa, contas a pagar ou receber.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_relatorio_pdf',
      description: 'Gera e baixa o Relatório Fiscal Mensal em PDF com obrigações, status e dados do DARF. Use quando o usuário pedir relatório fiscal, relatório mensal, PDF da empresa ou resumo tributário em PDF.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_parecer_docx',
      description: 'Gera e baixa o Parecer Fiscal em DOCX (Word). A IA escreve o texto do parecer com base no contexto da conversa. Use quando o usuário pedir parecer, documento Word, relatório Word, parecer fiscal ou DOCX.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_planilha_excel',
      description: 'Gera e baixa a Planilha de Apuração Fiscal em Excel (XLSX). Use quando o usuário pedir planilha, Excel, apuração em planilha ou dados em Excel.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_dctfweb_pdf',
      description: 'Gera e baixa o documento de apuração DCTFWeb em PDF. Use quando o usuário pedir DCTFWeb, declaração de débitos, DCTF.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ── Executores — chamados quando a IA aciona uma tool ─────────
const TOOL_EXECUTORS = {

  abrir_sped: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    await openSped();
    // Pré-preencher campos do período
    await new Promise(r => setTimeout(r, 300));
    const elMes = document.getElementById('spedMes');
    const elAno = document.getElementById('spedAno');
    const elUF  = document.getElementById('spedUF');
    if (elMes && args.mes) elMes.value = String(args.mes).padStart(2, '0');
    if (elAno && args.ano) elAno.value = String(args.ano);
    if (elUF  && args.uf)  elUF.value  = args.uf.toUpperCase();
    // Preencher CNPJ e nome da empresa automaticamente
    const elCnpj = document.getElementById('spedCNPJ');
    if (elCnpj && currentCliente.cnpj) elCnpj.value = currentCliente.cnpj;
    return {
      ok: true,
      msg: `SPED aberto. Período ${String(args.mes).padStart(2,'0')}/${args.ano} pré-preenchido. Verifique os campos e clique em "Criar Período".`,
    };
  },

  calcular_darf: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    await openDocumentos();
    // Mudar para aba DARF
    await new Promise(r => setTimeout(r, 200));
    const tabDarf = document.querySelector('.doc-tab[onclick*="darf"]');
    if (tabDarf) switchDocTab('darf', tabDarf);
    await new Promise(r => setTimeout(r, 100));
    // Preencher campos
    const regime = args.regime || currentCliente.regime_tributario?.toLowerCase()
      .replace('simples nacional','simples')
      .replace('lucro presumido','presumido')
      .replace('lucro real','real')
      .replace('mei','mei') || 'simples';
    const elRegime = document.getElementById('darfRegime');
    const elComp   = document.getElementById('darfCompetencia');
    const elFat    = document.getElementById('darfFaturamento');
    const elPro    = document.getElementById('darfProlabore');
    const elFolha  = document.getElementById('darfFolha');
    if (elRegime) elRegime.value = regime;
    if (elComp   && args.competencia) elComp.value = args.competencia;
    if (elFat    && args.faturamento) elFat.value  = args.faturamento;
    if (elPro    && args.prolabore)   elPro.value  = args.prolabore;
    if (elFolha  && args.folha)       elFolha.value = args.folha;
    if (typeof atualizarCamposDarf === 'function') atualizarCamposDarf();
    if (typeof calcularDarf === 'function') calcularDarf();
    const total = window.darfData?.totalFinal;
    return {
      ok: true,
      msg: `DARF calculado para ${args.competencia}${total ? ` — Total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}` : ''}. Clique em "Salvar" para registrar no histórico.`,
    };
  },

  criar_lancamento: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    // Salvar direto no banco sem abrir o modal
    const cat = args.categoria || (args.tipo === 'receita' ? 'Outros recebimentos' : 'Outros despesas');
    const { error } = await sb.from('lancamentos').insert({
      user_id:    currentUser.id,
      cliente_id: currentCliente.id,
      tipo:       args.tipo,
      categoria:  cat,
      descricao:  args.descricao,
      valor:      args.valor,
      data_venc:  args.data_venc,
      status:     args.status || 'pendente',
      atualizado_em: new Date().toISOString(),
    });
    if (error) return { ok: false, msg: 'Erro ao salvar: ' + error.message };
    return {
      ok: true,
      msg: `Lançamento criado: ${args.tipo === 'receita' ? '+' : '-'} R$ ${args.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})} — ${args.descricao} (venc. ${new Date(args.data_venc+'T00:00').toLocaleDateString('pt-BR')}).`,
    };
  },

  abrir_folha: async (args) => {
    await openFolha();
    if (args.aba) {
      await new Promise(r => setTimeout(r, 300));
      if (typeof switchDpTab === 'function') switchDpTab(args.aba);
    }
    return { ok: true, msg: `Folha de pagamento aberta${args.aba ? ` — aba "${args.aba}"` : ''}.` };
  },

  abrir_agenda: async () => {
    await openAgenda();
    return { ok: true, msg: 'Agenda de prazos aberta.' };
  },

  abrir_financeiro: async () => {
    await openFinanceiro();
    return { ok: true, msg: 'Módulo financeiro aberto.' };
  },

  gerar_relatorio_pdf: async () => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar o relatório.' };
    if (typeof gerarRelatorioFiscal !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      await gerarRelatorioFiscal();
      return { ok: true, msg: 'Relatório Fiscal PDF gerado e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar PDF: ' + e.message };
    }
  },

  gerar_parecer_docx: async () => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar o parecer.' };
    if (typeof gerarParecer !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      await gerarParecer();
      return { ok: true, msg: 'Parecer Fiscal DOCX gerado e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar DOCX: ' + e.message };
    }
  },

  gerar_planilha_excel: async () => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar a planilha.' };
    if (typeof gerarPlanilha !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      gerarPlanilha();
      return { ok: true, msg: 'Planilha de Apuração Excel gerada e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar Excel: ' + e.message };
    }
  },

  gerar_dctfweb_pdf: async () => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar o DCTFWeb.' };
    if (typeof gerarDctfWeb !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      await gerarDctfWeb();
      return { ok: true, msg: 'DCTFWeb PDF gerado e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar DCTFWeb: ' + e.message };
    }
  },
};

// ── Processar resposta com tool_calls ─────────────────────────
async function processarToolCalls(toolCalls) {
  const resultados = [];
  for (const tc of toolCalls) {
    const nome = tc.function?.name;
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch(e) {}
    const executor = TOOL_EXECUTORS[nome];
    if (!executor) {
      resultados.push({ tool: nome, ok: false, msg: 'Tool não reconhecida.' });
      continue;
    }
    try {
      const res = await executor(args);
      resultados.push({ tool: nome, ...res });
    } catch(e) {
      resultados.push({ tool: nome, ok: false, msg: e.message });
    }
  }
  return resultados;
}

// ── Renderizar card de ação executada no chat ─────────────────
function renderToolCard(resultados) {
  return resultados.map(r => {
    const icon = {
      abrir_sped:          'file-code-2',
      calcular_darf:       'receipt',
      criar_lancamento:    'wallet',
      abrir_folha:         'users',
      abrir_agenda:        'calendar-clock',
      abrir_financeiro:    'wallet',
      gerar_relatorio_pdf: 'file-text',
      gerar_parecer_docx:  'file-type-2',
      gerar_planilha_excel:'table-2',
      gerar_dctfweb_pdf:   'landmark',
    }[r.tool] || 'zap';
    const cor = r.ok ? '#16a34a' : '#dc2626';
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--sidebar-hover);border:1px solid var(--border);border-left:3px solid ${cor};border-radius:8px;margin-bottom:6px;font-size:12px;">
      <i data-lucide="${icon}" style="width:14px;height:14px;color:${cor};flex-shrink:0;margin-top:1px"></i>
      <span style="color:var(--text)">${r.msg}</span>
    </div>`;
  }).join('');
}
