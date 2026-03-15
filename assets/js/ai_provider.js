// ============================================================
// AI_PROVIDER.JS — Abstração de provedor de IA
// ============================================================
// Para migrar de Groq → Anthropic:
//   1. Trocar current: 'anthropic'
//   2. Criar api/chat-anthropic.js na Vercel (ver comentário no fim)
//   3. Adicionar ANTHROPIC_KEY nas env vars da Vercel
// ============================================================

const AI_PROVIDER = {

  // ── Configuração ─────────────────────────────────────────
  // 'groq' | 'anthropic'
  current: 'anthropic',

  models: {
    groq: ['llama-3.3-70b-versatile'],
    anthropic: [
      'claude-sonnet-4-6',           // principal — raciocínio fiscal, tools, streaming
      'claude-haiku-4-5-20251001',   // fallback rápido e econômico
    ],
  },

  // Prompt caching e citations
  citations: { enabled: false },

  ativarCitations(ativo) {
    this.citations.enabled = !!ativo;
  },

  // Configurações de thinking
  thinking: {
    enabled:      false,       // ativado dinamicamente por pergunta
    budget_tokens: 8000,       // tokens máximos para raciocínio interno
    threshold:    120,         // palavras na pergunta para ativar thinking
  },

  endpoints: {
    groq:      '/api/chat',
    anthropic: '/api/chat-anthropic',
  },

  getModels()   { return this.models[this.current]   || this.models.groq; },
  getEndpoint() { return this.endpoints[this.current] || this.endpoints.groq; },

  // ── Normalizar tools ──────────────────────────────────────
  // Groq/OpenAI: { type:'function', function:{ name, description, parameters } }
  // Anthropic:   { name, description, input_schema }
  normalizarTools(tools) {
    if (!tools?.length) return undefined;
    if (this.current === 'anthropic') {
      return tools.map(t => ({
        name:         t.function.name,
        description:  t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    return tools;
  },

  // ── Normalizar mensagens para Anthropic ───────────────────
  // Problemas que precisam ser resolvidos:
  // 1. Anthropic não aceita role:'system' dentro do array messages
  // 2. Anthropic exige alternância estrita user/assistant
  // 3. Deve haver sempre um user como última mensagem
  normalizarMensagensAnthropic(messages) {
    // Separar system messages
    const systemParts = messages
      .filter(m => m.role === 'system')
      .map(m => m.content);

    // Pegar só user/assistant
    let conv = messages.filter(m => m.role === 'user' || m.role === 'assistant');

    // Garantir alternância — mesclar mensagens consecutivas do mesmo role
    const merged = [];
    for (const msg of conv) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        // Concatenar conteúdo
        if (typeof last.content === 'string' && typeof msg.content === 'string') {
          last.content += '\n\n' + msg.content;
        } else {
          // Já é array de blocos (ex: com imagem) — adicionar bloco de texto
          if (!Array.isArray(last.content)) last.content = [{ type: 'text', text: last.content }];
          last.content.push({ type: 'text', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) });
        }
      } else {
        merged.push({ role: msg.role, content: msg.content });
      }
    }

    // Garantir que começa com user (Anthropic exige)
    // Se começa com assistant, inserir placeholder em vez de descartar
    if (merged.length && merged[0].role === 'assistant') {
      merged.unshift({ role: 'user', content: '[continuação da conversa anterior]' });
    }
    // Garantir que termina com user
    if (merged.length && merged[merged.length - 1].role !== 'user') {
      merged.push({ role: 'user', content: '...' });
    }
    // Mínimo: pelo menos uma mensagem
    if (!merged.length) merged.push({ role: 'user', content: '...' });

    return { system: systemParts.join('\n\n') || undefined, messages: merged };
  },

  // ── Converter arquivo para bloco nativo Anthropic ─────────
  // Suporta PDF e imagens — mais preciso que incluir como texto
  arquivoParaBlocoAnthropic(file) {
    // PDF nativo
    if (file.base64 && file.mimeType === 'application/pdf') {
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.base64 },
      };
    }
    // Imagem nativa
    if (file.base64 && file.mimeType?.startsWith('image/')) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: file.mimeType, data: file.base64 },
      };
    }
    // XML/texto — como bloco de texto
    if (file.content) {
      return {
        type: 'text',
        text: `[Arquivo: ${file.name}]\n${file.content.substring(0, 8000)}`,
      };
    }
    return null;
  },

  // ── Montar body completo da requisição ────────────────────
  montarBody(model, messages, tools, arquivos) {
    const toolsNorm = this.normalizarTools(tools);

    if (this.current === 'anthropic') {
      const { system, messages: msgs } = this.normalizarMensagensAnthropic(messages);

      // Se há arquivos com base64, injetar como blocos na última mensagem user
      if (arquivos?.length) {
        const ultima = msgs[msgs.length - 1];
        if (ultima?.role === 'user') {
          const blocos = arquivos
            .map(f => this.arquivoParaBlocoAnthropic(f))
            .filter(Boolean);
          if (blocos.length) {
            const textoAtual = typeof ultima.content === 'string'
              ? [{ type: 'text', text: ultima.content }]
              : ultima.content;
            ultima.content = [...blocos, ...textoAtual];
          }
        }
      }

      // Prompt caching — reduz custo do system prompt em ~90% nas requisições subsequentes
      const systemPayload = system ? [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
      ] : undefined;

      // Extended thinking — ativar se habilitado e sem tools forçadas
      const useThinking = this.thinking.enabled && !toolsNorm;
      const thinkingPayload = useThinking ? {
        type: 'enabled',
        budget_tokens: this.thinking.budget_tokens,
      } : undefined;

      // Citations — ativar em blocos de documento se citations.enabled
      if (this.citations.enabled) {
        for (const msg of msgs) {
          if (msg.role === 'user' && Array.isArray(msg.content)) {
            msg.content = msg.content.map(blk =>
              blk.type === 'document' ? { ...blk, citations: { enabled: true } } : blk
            );
          }
        }
      }

      // Prompt caching nas mensagens: marcar a penúltima mensagem user
      // (a última não pode ser cacheada pois muda a cada turno)
      if (msgs.length >= 2) {
        const userMsgs = msgs.filter(m => m.role === 'user');
        const alvo = userMsgs.length >= 2 ? userMsgs[userMsgs.length - 2] : null;
        if (alvo) {
          if (typeof alvo.content === 'string') {
            alvo.content = [{ type: 'text', text: alvo.content, cache_control: { type: 'ephemeral' } }];
          } else if (Array.isArray(alvo.content) && alvo.content.length) {
            alvo.content[alvo.content.length - 1] = {
              ...alvo.content[alvo.content.length - 1],
              cache_control: { type: 'ephemeral' }
            };
          }
        }
      }

      const body = {
        model,
        max_tokens:  useThinking ? 32000 : 16000,
        system:      systemPayload,
        messages:    msgs,
        tools:       toolsNorm,
        tool_choice: toolsNorm ? { type: 'auto' } : undefined,
        // Streaming para respostas normais; tools precisam de JSON completo
        stream:      !toolsNorm,
      };
      if (thinkingPayload) body.thinking = thinkingPayload;
      return body;
    }

    // Groq / OpenAI — formato original, sem alterações
    return {
      model,
      temperature:  0.7,
      max_tokens:   4000,
      messages,
      tools:        toolsNorm,
      tool_choice:  toolsNorm ? 'auto' : undefined,
    };
  },

  // ── Normalizar resposta → formato interno ─────────────────
  // Retorna: { text, toolCalls, usage, model }
  // Adicionar citations a um bloco de documento (para PDFs e textos)
  adicionarCitations(mensagens) {
    return mensagens.map(m => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return m;
      return {
        ...m,
        content: m.content.map(blk => {
          if (blk.type === 'document') return { ...blk, citations: { enabled: true } };
          return blk;
        }),
      };
    });
  },

  normalizarResposta(data) {
    if (this.current === 'anthropic') {
      const content  = data.content || [];
      const textBlks = content.filter(b => b.type === 'text');
      const toolUses = content.filter(b => b.type === 'tool_use');
      // Citar blocos — incluir texto de citações inline
      const citacoes = content.filter(b => b.type === 'text_citation' || b.citations?.length);

      return {
        text: textBlks.map(b => b.text).join(''),
        toolCalls: toolUses.length ? toolUses.map(tu => ({
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
        })) : null,
        usage:           (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        inputTokens:     data.usage?.input_tokens       || 0,
        outputTokens:    data.usage?.output_tokens      || 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens  || 0,
        cacheWriteTokens:data.usage?.cache_creation_input_tokens || 0,
        model: data.model || '',
        citations: citacoes,
      };
    }

    // Groq / OpenAI
    const msg = data.choices?.[0]?.message || {};
    return {
      text:      msg.content || '',
      toolCalls: msg.tool_calls || null,
      usage:     data.usage?.total_tokens || 0,
      model:     data.model || '',
    };
  },

  isRateLimit(status) { return status === 429; },

  // Detectar se pergunta é complexa para ativar thinking automaticamente
  deveUsarThinking(texto) {
    if (!texto) return false;
    const palavras = texto.trim().split(/\s+/).length;
    const keywords = /planejamento|estratégia|comparar|analisar|calcular|otimizar|risco|elisão|estrutur/i;
    return palavras >= this.thinking.threshold || keywords.test(texto);
  },

  ativarThinking(ativo) {
    this.thinking.enabled = ativo;
  },
};

// ============================================================
// ENDPOINT BACKEND PARA ANTHROPIC — criar em api/chat-anthropic.js
// ============================================================
// export default async function handler(req, res) {
//   if (req.method !== 'POST') return res.status(405).end();
//   const response = await fetch('https://api.anthropic.com/v1/messages', {
//     method: 'POST',
//     headers: {
//       'x-api-key':         process.env.ANTHROPIC_KEY,
//       'anthropic-version': '2023-06-01',
//       'content-type':      'application/json',
//     },
//     body: JSON.stringify(req.body),
//   });
//   const data = await response.json();
//   res.status(response.status).json(data);
// }
