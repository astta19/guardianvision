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
    groq: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama3-8b-8192',
    ],
    anthropic: [
      'claude-sonnet-4-5',  // principal — raciocínio fiscal preciso, tools confiáveis
      'claude-haiku-4-5',   // fallback — rápido e barato para perguntas simples
    ],
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

    // Garantir que começa com user e termina com user
    if (merged.length && merged[0].role === 'assistant') merged.shift();
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

      return {
        model,
        max_tokens: 4096,
        system:      systemPayload,
        messages:    msgs,
        tools:       toolsNorm,
        tool_choice: toolsNorm ? { type: 'auto' } : undefined,
      };
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
  normalizarResposta(data) {
    if (this.current === 'anthropic') {
      const content  = data.content || [];
      const textBlks = content.filter(b => b.type === 'text');
      const toolUses = content.filter(b => b.type === 'tool_use');

      return {
        text: textBlks.map(b => b.text).join(''),
        toolCalls: toolUses.length ? toolUses.map(tu => ({
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
        })) : null,
        usage: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        model: data.model || '',
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
