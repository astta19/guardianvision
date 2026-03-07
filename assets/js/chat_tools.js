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
      description: 'Gera e baixa o Relatório Fiscal Mensal em PDF com obrigações, DARFs, financeiro e dados do banco. Use quando o usuário pedir relatório fiscal, relatório mensal, PDF da empresa ou resumo tributário em PDF.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título personalizado do relatório (opcional)' },
          conteudo_extra: { type: 'string', description: 'Conteúdo adicional ou correções mencionadas no chat para incluir no relatório' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_documento_pdf',
      description: 'Gera um PDF livre com o conteúdo que o usuário pediu — pode ser um parecer, análise, resumo, cálculo, ou qualquer texto da conversa. Use quando o usuário pedir "gera um PDF disso", "quero isso em PDF", "exporta em PDF", "me dá um documento com essas informações".',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título do documento' },
          conteudo: { type: 'string', description: 'Conteúdo completo do documento — escreva aqui o texto integral que deve aparecer no PDF, com todas as informações da conversa. Seja detalhado.' },
          subtitulo: { type: 'string', description: 'Subtítulo ou descrição curta (opcional)' },
        },
        required: ['titulo', 'conteudo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_documento_docx',
      description: 'Gera um arquivo Word (DOCX) com o conteúdo que o usuário pediu — parecer, relatório, análise, contrato, ou qualquer texto. Use quando o usuário pedir "gera um Word", "quero em DOCX", "documento Word", "exporta em Word".',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título do documento' },
          conteudo: { type: 'string', description: 'Conteúdo completo do documento em texto corrido. Inclua tudo que foi discutido e que o usuário quer no documento.' },
          subtitulo: { type: 'string', description: 'Subtítulo (opcional)' },
        },
        required: ['titulo', 'conteudo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_parecer_docx',
      description: 'Gera e baixa o Parecer Fiscal formal em DOCX (Word) com análise técnica e fundamentação legal. Use especificamente quando pedirem parecer fiscal, parecer contábil, parecer técnico.',
      parameters: {
        type: 'object',
        properties: {
          conteudo_extra: { type: 'string', description: 'Texto do parecer que você já elaborou na resposta — inclua aqui para que o DOCX tenha exatamente o que foi discutido' },
        },
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
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Busca dados reais de um cliente no banco (regime tributário, CNPJ, faturamento, sócios, endereço). Use quando o usuário perguntar sobre um cliente específico pelo nome ou CNPJ.',
      parameters: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Nome, razão social ou CNPJ do cliente a buscar' },
        },
        required: ['busca'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_rescisao',
      description: 'Calcula a rescisão trabalhista de um funcionário direto pelo chat. Use quando o usuário informar o nome do funcionário e a data de desligamento.',
      parameters: {
        type: 'object',
        properties: {
          nome_funcionario: { type: 'string',  description: 'Nome do funcionário (busca parcial)' },
          dt_desligamento:  { type: 'string',  description: 'Data de desligamento YYYY-MM-DD' },
          motivo:           { type: 'string',  description: 'sem_justa_causa | justa_causa | pedido_demissao | acordo_mutuo' },
          saldo_dias:       { type: 'integer', description: 'Dias trabalhados no mês da rescisão' },
          meses_ferias:     { type: 'integer', description: 'Meses de férias proporcionais não gozadas (0-11)' },
          meses_decimo:     { type: 'integer', description: 'Meses de 13º proporcional (0-11)' },
          aviso_previo:     { type: 'boolean', description: 'Aviso prévio indenizado' },
        },
        required: ['nome_funcionario', 'dt_desligamento'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_ferias',
      description: 'Calcula férias de um funcionário direto pelo chat com valores líquidos. Use quando o usuário perguntar sobre férias de um funcionário.',
      parameters: {
        type: 'object',
        properties: {
          nome_funcionario: { type: 'string',  description: 'Nome do funcionário (busca parcial)' },
          dias:             { type: 'integer', description: 'Dias de férias (padrão 30)' },
          abono:            { type: 'boolean', description: 'Vender 10 dias de abono pecuniário' },
          competencia:      { type: 'string',  description: 'Competência MM/AAAA' },
        },
        required: ['nome_funcionario'],
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

    const fat  = args.faturamento || 0;
    const regime = (args.regime || currentCliente.regime_tributario || 'simples')
      .toLowerCase()
      .replace('simples nacional','simples')
      .replace('lucro presumido','presumido')
      .replace('lucro real','real');

    // Calcular inline sem abrir módulo
    let resumo = '';
    let totalFinal = 0;

    if (regime === 'mei') {
      const das = 86.90;
      totalFinal = das;
      resumo = `DAS MEI fixo: R$ ${das.toFixed(2)}`;
    } else if (regime === 'simples') {
      // Alíquota simplificada Anexo III (serviços) — IA detalha no texto
      const aliq = fat <= 180000 ? 0.06 : fat <= 360000 ? 0.112 : fat <= 720000 ? 0.135 : fat <= 1800000 ? 0.16 : fat <= 3600000 ? 0.21 : 0.33;
      const das = fat * aliq;
      totalFinal = das;
      resumo = `DAS Simples: R$ ${das.toLocaleString('pt-BR',{minimumFractionDigits:2})} (alíq. efetiva ~${(aliq*100).toFixed(1)}% sobre R$ ${fat.toLocaleString('pt-BR',{minimumFractionDigits:2})})`;
    } else if (regime === 'presumido') {
      const irpj = fat * 0.08 * 0.15;
      const csll = fat * 0.12 * 0.09;
      const pis  = fat * 0.0065;
      const cof  = fat * 0.03;
      totalFinal = irpj + csll + pis + cof;
      resumo = `IRPJ: R$ ${irpj.toLocaleString('pt-BR',{minimumFractionDigits:2})} | CSLL: R$ ${csll.toLocaleString('pt-BR',{minimumFractionDigits:2})} | PIS: R$ ${pis.toLocaleString('pt-BR',{minimumFractionDigits:2})} | COFINS: R$ ${cof.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
    } else if (regime === 'real') {
      const pis  = fat * 0.0165;
      const cof  = fat * 0.076;
      totalFinal = pis + cof;
      resumo = `PIS: R$ ${pis.toLocaleString('pt-BR',{minimumFractionDigits:2})} | COFINS: R$ ${cof.toLocaleString('pt-BR',{minimumFractionDigits:2})} (IRPJ/CSLL dependem do lucro apurado)`;
    }

    // Também preencher o módulo visual se estiver disponível
    try {
      await openDocumentos();
      await new Promise(r => setTimeout(r, 200));
      const tabDarf = document.querySelector('.doc-tab[onclick*="darf"]');
      if (tabDarf) switchDocTab('darf', tabDarf);
      await new Promise(r => setTimeout(r, 100));
      const elRegime = document.getElementById('darfRegime');
      const elComp   = document.getElementById('darfCompetencia');
      const elFat    = document.getElementById('darfFaturamento');
      if (elRegime && regime) elRegime.value = regime;
      if (elComp   && args.competencia) elComp.value = args.competencia;
      if (elFat    && fat) elFat.value = fat;
      if (typeof atualizarCamposDarf === 'function') atualizarCamposDarf();
      if (typeof calcularDarf === 'function') calcularDarf();
    } catch {}

    return {
      ok: true,
      msg: `📊 DARF ${args.competencia || ''} (${regime.toUpperCase()})\n${resumo}\n💰 Total estimado: R$ ${totalFinal.toLocaleString('pt-BR',{minimumFractionDigits:2})}`,
    };
  },

  criar_lancamento: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    // Suporta objeto único ou array de lançamentos
    const lista = Array.isArray(args.lancamentos) ? args.lancamentos : [args];
    const rows = lista.map(l => ({
      user_id:       currentUser.id,
      cliente_id:    currentCliente.id,
      tipo:          l.tipo,
      categoria:     l.categoria || (l.tipo === 'receita' ? 'Outros recebimentos' : 'Outros despesas'),
      descricao:     l.descricao,
      valor:         l.valor,
      data_venc:     l.data_venc,
      status:        l.status || 'pendente',
      atualizado_em: new Date().toISOString(),
    }));
    const { error } = await sb.from('lancamentos').insert(rows);
    if (error) return { ok: false, msg: 'Erro ao salvar: ' + error.message };
    const total = rows.reduce((s, r) => s + (r.valor || 0), 0);
    return {
      ok: true,
      msg: rows.length === 1
        ? `Lançamento criado: ${rows[0].tipo === 'receita' ? '+' : '-'} R$ ${rows[0].valor.toLocaleString('pt-BR',{minimumFractionDigits:2})} — ${rows[0].descricao} (venc. ${new Date(rows[0].data_venc+'T00:00').toLocaleDateString('pt-BR')}).`
        : `${rows.length} lançamentos criados. Total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}.`,
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

  gerar_relatorio_pdf: async (args) => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar o relatório.' };
    if (typeof gerarRelatorioFiscal !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      await gerarRelatorioFiscal();
      return { ok: true, msg: 'Relatório Fiscal PDF gerado e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar PDF: ' + e.message };
    }
  },

  gerar_parecer_docx: async (args) => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar o parecer.' };
    if (typeof gerarParecer !== 'function') return { ok: false, msg: 'Função de geração não disponível.' };
    try {
      await gerarParecer();
      return { ok: true, msg: 'Parecer Fiscal DOCX gerado e download iniciado.' };
    } catch(e) {
      return { ok: false, msg: 'Erro ao gerar DOCX: ' + e.message };
    }
  },

  gerar_documento_pdf: async (args) => {
    if (!currentCliente) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    try {
      await gerarDocumentoLivrePDF(args?.titulo || 'Documento', args?.conteudo || '', args?.subtitulo || '');
      return { ok: true, msg: `PDF "${args?.titulo || 'Documento'}" gerado e download iniciado.` };
    } catch(e) { return { ok: false, msg: 'Erro ao gerar PDF: ' + e.message }; }
  },

  gerar_documento_docx: async (args) => {
    if (!currentCliente) return { ok: false, msg: 'Nenhuma empresa selecionada.' };
    try {
      await gerarDocumentoLivreDocx(args?.titulo || 'Documento', args?.conteudo || '', args?.subtitulo || '');
      return { ok: true, msg: `Word "${args?.titulo || 'Documento'}" gerado e download iniciado.` };
    } catch(e) { return { ok: false, msg: 'Erro ao gerar DOCX: ' + e.message }; }
  },

  gerar_planilha_excel: async (args) => {
    if (!currentCliente) return { ok: false, msg: 'Selecione uma empresa antes de gerar a planilha.' };

    // Se IA enviou dados dinâmicos, gerar planilha customizada via SheetJS
    if (args?.abas?.length || args?.dados?.length) {
      try {
        const wb = XLSX.utils.book_new();

        // Suporte a múltiplas abas ou aba única com dados
        const abas = args.abas || [{ nome: args.titulo || 'Dados', linhas: args.dados }];
        for (const aba of abas) {
          const ws = XLSX.utils.aoa_to_sheet(aba.linhas || []);
          XLSX.utils.book_append_sheet(wb, ws, (aba.nome || 'Dados').substring(0, 31));
        }

        const nome = `${(args.titulo || 'planilha-fiscal')}-${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, nome);
        return { ok: true, msg: `Planilha "${args.titulo || 'Planilha'}" gerada com ${abas.length} aba(s) e download iniciado.` };
      } catch(e) {
        return { ok: false, msg: 'Erro ao gerar Excel: ' + e.message };
      }
    }

    // Fallback: planilha padrão do sistema
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

  buscar_cliente: async (args) => {
    try {
      const q = (args.busca || '').trim();
      if (!q) return { ok: false, msg: 'Informe o nome ou CNPJ do cliente.' };

      const { data, error } = await sb.from('clientes')
        .select('razao_social, nome_fantasia, cnpj, regime_tributario, email, telefone, cidade, uf, atividade_principal, tem_empregado')
        .or(`razao_social.ilike.%${q}%,nome_fantasia.ilike.%${q}%,cnpj.ilike.%${q}%`)
        .eq('user_id', currentUser.id)
        .limit(3);

      if (error) return { ok: false, msg: 'Erro ao buscar: ' + error.message };
      if (!data?.length) return { ok: false, msg: `Nenhum cliente encontrado para "${q}".` };

      const linhas = data.map(cl =>
        `• ${cl.razao_social}${cl.nome_fantasia ? ` (${cl.nome_fantasia})` : ''} | CNPJ: ${cl.cnpj} | Regime: ${cl.regime_tributario} | ${cl.cidade}/${cl.uf}`
      ).join('\n');

      return { ok: true, msg: `Clientes encontrados:\n${linhas}` };
    } catch(e) {
      return { ok: false, msg: e.message };
    }
  },

  calcular_rescisao: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };

    // Buscar funcionário por nome parcial
    const { data: funcs } = await sb.from('dp_funcionarios')
      .select('id, nome, salario_base, cargo, admissao')
      .eq('cliente_id', currentCliente.id)
      .eq('user_id', currentUser.id)
      .ilike('nome', `%${args.nome_funcionario}%`)
      .limit(1);

    const func = funcs?.[0];
    if (!func) return { ok: false, msg: `Funcionário "${args.nome_funcionario}" não encontrado.` };

    const sal      = func.salario_base || 0;
    const vDia     = sal / 30;
    const saldoDias= args.saldo_dias  || 15;
    const mesesFer = args.meses_ferias || 0;
    const meses13  = args.meses_decimo || 0;
    const aviso    = args.aviso_previo !== false && args.motivo !== 'justa_causa' ? sal : 0;
    const saldo    = Math.round(saldoDias * vDia * 100) / 100;
    const ferProp  = Math.round(sal * mesesFer / 12 * 100) / 100;
    const umTerco  = Math.round(ferProp / 3 * 100) / 100;
    const dec13    = Math.round(sal * meses13 / 12 * 100) / 100;
    const bruto    = saldo + aviso + ferProp + umTerco + dec13;

    // INSS progressivo simplificado
    let inss = 0, ant = 0;
    const base = Math.min(saldo + aviso, 8157.41);
    for (const f of [{ate:1518,aliq:.075},{ate:2793.88,aliq:.09},{ate:4190.83,aliq:.12},{ate:8157.41,aliq:.14}]) {
      if (base <= ant) break;
      inss += (Math.min(base, f.ate) - ant) * f.aliq;
      ant = f.ate;
    }
    inss = Math.round(inss * 100) / 100;

    const baseIRRF = Math.max(0, bruto - inss);
    let irrf = 0;
    for (const f of [{ate:2259.20,aliq:0,ded:0},{ate:2826.65,aliq:.075,ded:169.44},{ate:3751.05,aliq:.15,ded:381.44},{ate:4664.68,aliq:.225,ded:662.77},{ate:Infinity,aliq:.275,ded:896.00}]) {
      if (baseIRRF <= f.ate) { irrf = Math.max(0, Math.round((baseIRRF * f.aliq - f.ded) * 100) / 100); break; }
    }

    const fgts   = Math.round((saldo + aviso) * 0.08 * 100) / 100;
    const multa  = args.motivo !== 'justa_causa' && args.motivo !== 'pedido_demissao' ? Math.round(fgts * 5 * 100) / 100 : 0;
    const liq    = Math.round((bruto - inss - irrf) * 100) / 100;
    const fmt    = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    return {
      ok: true,
      msg: [
        `📋 Rescisão — ${func.nome} (${func.cargo || 'sem cargo'})`,
        `Motivo: ${args.motivo || 'sem_justa_causa'} | Desligamento: ${new Date(args.dt_desligamento+'T00:00').toLocaleDateString('pt-BR')}`,
        ``,
        `Saldo de salário (${saldoDias}d): R$ ${fmt(saldo)}`,
        aviso > 0 ? `Aviso prévio indenizado: R$ ${fmt(aviso)}` : '',
        ferProp > 0 ? `Férias proporcionais (${mesesFer}/12) + 1/3: R$ ${fmt(ferProp + umTerco)}` : '',
        dec13  > 0 ? `13º proporcional (${meses13}/12): R$ ${fmt(dec13)}` : '',
        `Bruto: R$ ${fmt(bruto)} | INSS: -R$ ${fmt(inss)} | IRRF: -R$ ${fmt(irrf)}`,
        `💰 Rescisão líquida: R$ ${fmt(liq)}`,
        multa > 0 ? `🏦 Encargos empresa — FGTS: R$ ${fmt(fgts)} + Multa 40%: R$ ${fmt(multa)}` : '',
      ].filter(Boolean).join('\n'),
    };
  },

  calcular_ferias: async (args) => {
    if (!currentCliente?.id) return { ok: false, msg: 'Nenhuma empresa selecionada.' };

    const { data: funcs } = await sb.from('dp_funcionarios')
      .select('id, nome, salario_base, cargo, admissao, dependentes')
      .eq('cliente_id', currentCliente.id)
      .eq('user_id', currentUser.id)
      .ilike('nome', `%${args.nome_funcionario}%`)
      .limit(1);

    const func = funcs?.[0];
    if (!func) return { ok: false, msg: `Funcionário "${args.nome_funcionario}" não encontrado.` };

    const sal     = func.salario_base || 0;
    const dias    = args.dias || 30;
    const abono   = args.abono || false;
    const base    = Math.round(sal * (dias / 30) * 100) / 100;
    const umTerco = Math.round(base / 3 * 100) / 100;
    const abonoV  = abono ? Math.round(sal * (10 / 30) * 100) / 100 : 0;
    const bruto   = base + umTerco + abonoV;

    let inss = 0, ant = 0;
    const baseInss = Math.min(bruto, 8157.41);
    for (const f of [{ate:1518,aliq:.075},{ate:2793.88,aliq:.09},{ate:4190.83,aliq:.12},{ate:8157.41,aliq:.14}]) {
      if (baseInss <= ant) break;
      inss += (Math.min(baseInss, f.ate) - ant) * f.aliq;
      ant = f.ate;
    }
    inss = Math.round(inss * 100) / 100;

    const DEP_IRRF = 189.59;
    const baseIRRF = Math.max(0, bruto - inss - (func.dependentes || 0) * DEP_IRRF);
    let irrf = 0;
    for (const f of [{ate:2259.20,aliq:0,ded:0},{ate:2826.65,aliq:.075,ded:169.44},{ate:3751.05,aliq:.15,ded:381.44},{ate:4664.68,aliq:.225,ded:662.77},{ate:Infinity,aliq:.275,ded:896.00}]) {
      if (baseIRRF <= f.ate) { irrf = Math.max(0, Math.round((baseIRRF * f.aliq - f.ded) * 100) / 100); break; }
    }

    const liq = Math.round((bruto - inss - irrf) * 100) / 100;
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const admissao = func.admissao ? new Date(func.admissao + 'T00:00') : null;
    const meses = admissao ? Math.floor((new Date() - admissao) / (30.44 * 86400000)) : null;

    return {
      ok: true,
      msg: [
        `🏖️ Férias — ${func.nome} (${dias} dias${abono ? ' + 10 abono' : ''})`,
        meses !== null ? `Tempo de serviço: ${meses} meses` : '',
        ``,
        `Salário base: R$ ${fmt(sal)}`,
        `Férias (${dias}d): R$ ${fmt(base)} | 1/3: R$ ${fmt(umTerco)}`,
        abono ? `Abono pecuniário (10d): R$ ${fmt(abonoV)}` : '',
        `Bruto: R$ ${fmt(bruto)} | INSS: -R$ ${fmt(inss)} | IRRF: -R$ ${fmt(irrf)}`,
        `💰 Férias líquidas: R$ ${fmt(liq)}`,
      ].filter(Boolean).join('\n'),
    };
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
      gerar_relatorio_pdf:  'file-text',
      gerar_parecer_docx:   'file-type-2',
      gerar_documento_pdf:  'file-down',
      gerar_documento_docx: 'file-type',
      gerar_planilha_excel: 'table-2',
      gerar_dctfweb_pdf:    'landmark',
      buscar_cliente:       'search',
      calcular_rescisao:    'user-x',
      calcular_ferias:      'umbrella',
    }[r.tool] || 'zap';
    const cor = r.ok ? '#16a34a' : '#dc2626';
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--sidebar-hover);border:1px solid var(--border);border-left:3px solid ${cor};border-radius:8px;margin-bottom:6px;font-size:12px;">
      <i data-lucide="${icon}" style="width:14px;height:14px;color:${cor};flex-shrink:0;margin-top:1px"></i>
      <span style="color:var(--text)">${r.msg}</span>
    </div>`;
  }).join('');
}
