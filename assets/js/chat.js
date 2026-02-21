// ============================================================
// CHAT.JS — Mensagens, Send, Cache, Aprendizado, Feedback
// ============================================================

    // ============================================
    // FUNÇÕES DE CACHE
    // ============================================
    function getCacheKey(text, files) {
      const fileInfo = files.map(f => `${f.name}_${f.size}`).join('|');
      return `${text}_${fileInfo}`;
    }

    function getCachedResponse(key) {
      if (responseCache.has(key)) {
        const cached = responseCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
          return cached.data;
        }
        responseCache.delete(key);
      }
      return null;
    }

    function cacheResponse(key, data) {
      responseCache.set(key, {
        data,
        timestamp: Date.now()
      });
      // Limitar tamanho do cache
      if (responseCache.size > 50) {
        const oldestKey = responseCache.keys().next().value;
        responseCache.delete(oldestKey);
      }
    }

    // ============================================
    // FUNÇÃO PARA EXTRAIR TODOS OS ARQUIVOS DA CONVERSA
    // ============================================
    function getAllFilesFromChat() {
      const files = [];
      
      if (!currentChat.messages) return files;
      
      // Percorrer TODAS as mensagens, não só as recentes
      currentChat.messages.forEach(msg => {
        if (msg.files && msg.files.length > 0) {
          msg.files.forEach(file => {
            // Evitar duplicatas
            const exists = files.some(f => 
              f.name === file.name && f.size === file.size
            );
            if (!exists) {
              files.push(file);
            }
          });
        }
      });
      
      return files;
    }

    // ============================================
    // FUNÇÃO PARA CRIAR CONTEXTO DOS ARQUIVOS
    // ============================================
    function createFileContext() {
      const allFiles = getAllFilesFromChat();
      
      if (allFiles.length === 0) return '';
      
      let context = '\nARQUIVOS DISPONÍVEIS NESTA CONVERSA:\n';
      context += `Total de ${allFiles.length} arquivo(s) anexado(s).\n\n`;
      if (allFiles.length > 1) {
        context += 'INSTRUÇÃO DE CRUZAMENTO: Ao analisar estes arquivos, compare os dados entre eles. Identifique inconsistências, divergências de valores, CNPJs que aparecem em múltiplos documentos, e qualquer anomalia fiscal. Relacione informações complementares entre os arquivos.\n\n';
      }
      
      // Incluir TODOS os arquivos
      allFiles.forEach((file, index) => {
        context += `--- ARQUIVO ${index + 1}: ${file.name} ---\n`;
        
        if (file.summary) {
          context += `Tipo: ${file.summary}\n`;
        }
        
        // INCLUIR O CONTEÚDO COMPLETO (limitado a 4000 caracteres por arquivo)
        if (file.content) {
          const content = file.content.length > 4000 
            ? file.content.substring(0, 4000) + '... (conteúdo truncado por limite de tamanho)'
            : file.content;
          context += `CONTEÚDO:\n${content}\n`;
        }
        
        context += '\n';
      });
      
      return context;
    }


    // ============================================
    // SERVIÇO DE APRENDIZADO FISCAL
    // ============================================
    class FiscalLearningService {
      constructor(supabase) {
        this.supabase = supabase;
      }

      extrairTags(texto) {
        if (!texto) return [];
        
        const tags = [];
        const termosFiscais = [
          'icms', 'iss', 'pis', 'cofins', 'ipi', 'csll',
          'simples nacional', 'lucro real', 'lucro presumido',
          'nota fiscal', 'nfe', 'nfce', 'cte',
          'sped', 'dctf', 'ecf', 'efd',
          'cfop', 'cst', 'csosn', 'ncm',
          'prazo', 'multa', 'obrigação', 'declaração'
        ];

        const textoLower = texto.toLowerCase();
        for (const termo of termosFiscais) {
          if (textoLower.includes(termo)) {
            tags.push(termo);
          }
        }

        return tags;
      }

      async registrarInteracao(chatId, pergunta, resposta, tokens, modelo) {
        try {
          if (!pergunta || !resposta) {
            return null;
          }

          const tags = this.extrairTags(pergunta);
          
          const dadosInsercao = {
            chat_id: chatId || null,
            pergunta: pergunta,
            resposta: resposta,
            tags_pergunta: tags.length > 0 ? tags : null,
            tokens_utilizados: tokens || null,
            modelo_utilizado: modelo || null,
            user_id: currentUser?.id || null,
            cliente_id: currentCliente?.id || null,
            data_interacao: new Date().toISOString()
          };

          const { data, error } = await this.supabase
            .from('interacoes_chat')
            .insert(dadosInsercao)
            .select()
            .single();

          if (error) {
            return null;
          }

          return data.id;

        } catch (error) {
          return null;
        }
      }

      async registrarFeedback(interacaoId, nota) {
        try {
          if (!interacaoId) {
            return;
          }

          const idString = String(interacaoId).trim();
          
          const { error } = await this.supabase
            .from('interacoes_chat')
            .update({ feedback_usuario: nota })
            .eq('id', idString);

          if (error) return;

          // Atualizar estatisticas_aprendizado — upsert por data
          const hoje = new Date().toISOString().split('T')[0];
          const clienteId = typeof currentCliente !== 'undefined' ? currentCliente?.id : null;

          const { data: existing } = await this.supabase
            .from('estatisticas_aprendizado')
            .select('id, soma_notas, total_feedbacks')
            .eq('data', hoje)
            .maybeSingle();

          if (existing) {
            const novoTotal = (existing.total_feedbacks || 0) + 1;
            const novaSoma  = (existing.soma_notas || 0) + nota;
            await this.supabase
              .from('estatisticas_aprendizado')
              .update({
                total_feedbacks: novoTotal,
                soma_notas: novaSoma,
                taxa_acerto_media: Math.round((novaSoma / novoTotal) * 20)
              })
              .eq('id', existing.id);
          } else {
            await this.supabase
              .from('estatisticas_aprendizado')
              .insert({
                data: hoje,
                total_interacoes: 1,
                total_feedbacks: 1,
                soma_notas: nota,
                taxa_acerto_media: nota * 20,
                cliente_id: clienteId
              });
          }

          if (nota >= 4) {
            await this.adicionarAoTreinamento(interacaoId);
          }

        } catch (error) {
        }
      }

      async adicionarAoTreinamento(interacaoId) {
        try {
          const { data: interacao, error } = await this.supabase
            .from('interacoes_chat')
            .select('pergunta, resposta')
            .eq('id', interacaoId)
            .maybeSingle();

          if (error || !interacao) return;

          await supabaseProxy('inserir_treinamento', {
            pergunta: interacao.pergunta,
            resposta: interacao.resposta,
            fonte: 'chat_com_feedback',
            qualidade: 5,
            user_id: currentUser?.id || null,
            cliente_id: currentCliente?.id || null
          });

        } catch (error) {
          // falha silenciosa — não impede o fluxo principal
        }
      }

      async buscarEstatisticas() {
        try {
          const data = await supabaseProxy('buscar_estatisticas', {});
          return Array.isArray(data) ? data : [];
        } catch (error) {
          return [];
        }
      }

      async buscarContextoRAG(pergunta) {
        try {
          const tags = this.extrairTags(pergunta);
          const clienteId = currentCliente?.id || null;

          // RAG filtrado por cliente e usuário — isolamento completo
          let qInteracoes = this.supabase
            .from('interacoes_chat')
            .select('pergunta, resposta, feedback_usuario, tags_pergunta')
            .gte('feedback_usuario', 4)
            .not('resposta', 'is', null)
            .order('feedback_usuario', { ascending: false })
            .limit(10);
          if (clienteId) qInteracoes = qInteracoes.eq('cliente_id', clienteId);
          // Contador só vê RAG do próprio usuário; admin vê tudo
          if (!isAdmin() && currentUser?.id) qInteracoes = qInteracoes.eq('user_id', currentUser.id);

          let qTreinamento = this.supabase
            .from('dados_treinamento')
            .select('pergunta, resposta, qualidade')
            .gte('qualidade', 4)
            .order('qualidade', { ascending: false })
            .limit(10);
          if (clienteId) qTreinamento = qTreinamento.eq('cliente_id', clienteId);

          const [{ data: interacoes }, { data: treinamento }] = await Promise.all([
            qInteracoes, qTreinamento
          ]);

          const candidatos = [
            ...(interacoes || []).map(i => ({
              pergunta: i.pergunta,
              resposta: i.resposta,
              tags: i.tags_pergunta || [],
              peso: i.feedback_usuario || 0
            })),
            ...(treinamento || []).map(t => ({
              pergunta: t.pergunta,
              resposta: t.resposta,
              tags: [],
              peso: t.qualidade || 0
            }))
          ];

          if (candidatos.length === 0) return null;

          const palavras = pergunta.toLowerCase().split(/\s+/).filter(p => p.length > 3);

          const pontuados = candidatos.map(c => {
            const texto = (c.pergunta + ' ' + c.tags.join(' ')).toLowerCase();
            const matches = palavras.filter(p => texto.includes(p)).length;
            const tagMatches = tags.filter(t => c.tags.includes(t)).length;
            return { ...c, score: matches * 3 + tagMatches * 4 + (c.peso > 3 ? 1 : 0) };
          });

          const relevantes = pontuados
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

          if (relevantes.length === 0) return null;

          return relevantes.map(c =>
            `P: ${c.pergunta}\nR: ${c.resposta.substring(0, 500)}`
          ).join('\n\n---\n\n');

        } catch (error) {
          return null;
        }
      }

      classificarTipoArquivo(nome, conteudo) {
        const n = nome.toLowerCase();
        const c = (conteudo || '').toLowerCase();
        if (n.includes('nfe') || n.includes('nf-e') || c.includes('nota fiscal eletrônica')) return 'NF-e';
        if (n.includes('sped') || c.includes('registro 0000') || c.includes('|c100|')) return 'SPED';
        if (n.includes('dctf') || c.includes('dctf')) return 'DCTF';
        if (n.includes('ecf') || c.includes('ecf')) return 'ECF';
        if (n.includes('cte') || c.includes('conhecimento de transporte')) return 'CT-e';
        if (n.match(/\.(xls|xlsx)$/)) return 'Planilha';
        if (n.match(/\.pdf$/)) return 'PDF';
        if (n.match(/\.csv$/)) return 'CSV';
        return 'Documento';
      }

      async salvarDocumento(chatId, fileData) {
        try {
          if (!fileData || !fileData.name) return null;

          const tags = this.extrairTags((fileData.content || '') + ' ' + fileData.name);
          const tipo = this.classificarTipoArquivo(fileData.name, fileData.content);

          const { data, error } = await this.supabase
            .from('documentos_analisados')
            .insert({
              chat_id: chatId || null,
              nome_arquivo: fileData.name,
              tipo_arquivo: tipo,
              tamanho_bytes: fileData.size || null,
              conteudo_extraido: fileData.content ? fileData.content.substring(0, 15000) : null,
              resumo: fileData.summary || null,
              tags_extraidas: tags.length > 0 ? tags : null,
              user_id: currentUser?.id || null,
              cliente_id: currentCliente?.id || null
            })
            .select('id')
            .single();

          if (error) {
            return null;
          }

          return data.id;

        } catch (error) {
          return null;
        }
      }

      async buscarDocumentosRAG(pergunta, chatId) {
        try {
          const tags = this.extrairTags(pergunta);
          // Não retornar null se sem tags — documentos do chat atual sempre são relevantes
          const clienteId = currentCliente?.id || null;
          let qDocs = this.supabase
            .from('documentos_analisados')
            .select('nome_arquivo, tipo_arquivo, conteudo_extraido, resumo, tags_extraidas, chat_id, cliente_id')
            .not('conteudo_extraido', 'is', null)
            .order('data_upload', { ascending: false })
            .limit(20);
          if (clienteId) qDocs = qDocs.eq('cliente_id', clienteId);
          const { data } = await qDocs;

          if (!data || data.length === 0) return null;

          const palavras = pergunta.toLowerCase().split(/\s+/).filter(p => p.length > 3);

          const pontuados = data.map(doc => {
            const texto = ((doc.conteudo_extraido || '') + ' ' + (doc.tags_extraidas || []).join(' ')).toLowerCase();
            const tagMatches = tags.filter(t => (doc.tags_extraidas || []).includes(t)).length;
            const wordMatches = palavras.filter(p => texto.includes(p)).length;
            const mesmoChat = doc.chat_id === chatId ? 3 : 0;
            return { ...doc, score: tagMatches * 2 + wordMatches + mesmoChat };
          });

          const relevantes = pontuados
            .filter(d => d.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

          if (relevantes.length === 0) return null;

          return relevantes.map(d =>
            `[${d.tipo_arquivo}] ${d.nome_arquivo}\n${(d.conteudo_extraido || '').substring(0, 800)}`
          ).join('\n\n---\n\n');

        } catch (error) {
          return null;
        }
      }

      async buscarMelhoresPerguntas(limite = 5) {
        try {
          const { data, error } = await this.supabase
            .from('interacoes_chat')
            .select('pergunta, feedback_usuario')
            .not('feedback_usuario', 'is', null)
            .order('feedback_usuario', { ascending: false })
            .limit(limite);

          if (error) throw error;
          return data || [];

        } catch (error) {
          return [];
        }
      }
    }

    let learningService = null;

function getLearningService() {
  if (!learningService && typeof FiscalLearningService !== "undefined" && sb) {
    learningService = new FiscalLearningService(sb);
  }
  return learningService;
}


    // ============================================
    // FUNÇÕES DE FEEDBACK
    // ============================================
    let ultimaInteracaoId = null;

    function mostrarFeedbackOptions(interacaoId) {
      if (!interacaoId || interacaoId === 'null' || interacaoId === 'undefined' || interacaoId.trim() === '') {
        alert('Feedback indisponível para esta resposta. Apenas respostas novas possuem feedback.');
        return;
      }
      
      ultimaInteracaoId = String(interacaoId);
      
      const existingPrompt = document.getElementById('feedback-prompt');
      if (existingPrompt) existingPrompt.remove();
      
      const feedbackDiv = document.createElement('div');
      feedbackDiv.className = 'feedback-prompt';
      feedbackDiv.id = 'feedback-prompt';
      feedbackDiv.innerHTML = `
        <p style="margin-bottom: 8px;">Esta resposta foi útil?</p>
        <div class="feedback-options">
          <button class="feedback-btn" onclick="enviarFeedback(5)">
            <i data-lucide="thumbs-up"></i> Muito útil
          </button>
          <button class="feedback-btn" onclick="enviarFeedback(3)">
            <i data-lucide="meh"></i> Mais ou menos
          </button>
          <button class="feedback-btn" onclick="enviarFeedback(1)">
            <i data-lucide="thumbs-down"></i> Não foi útil
          </button>
        </div>
      `;
      
      document.getElementById('msgs').appendChild(feedbackDiv);
      lucide.createIcons();
      document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
    }

    async function enviarFeedback(nota) {
      if (ultimaInteracaoId) {
        await getLearningService().registrarFeedback(ultimaInteracaoId, nota);
        
        const agradecimento = document.createElement('div');
        agradecimento.className = 'msg assistant';
        agradecimento.innerHTML = `
          <div class="ava"><i data-lucide="bot"></i></div>
          <div class="bubble">
            Obrigado pelo seu feedback!
          </div>
        `;
        document.getElementById('msgs').appendChild(agradecimento);
        lucide.createIcons();
        document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
      }
      
      document.getElementById('feedback-prompt')?.remove();
      ultimaInteracaoId = null;
    }

    async function handleBatchUpload(event) {
      const files = Array.from(event.target.files);
      if (!files.length) return;

      const progressEl = document.getElementById('batchProgress');
      const MAX_SIZE = 20 * 1024 * 1024; // 20MB por arquivo no batch
      let sucesso = 0;
      let erro = 0;

      progressEl.innerHTML = `<i data-lucide="loader" style="width:12px;height:12px;vertical-align:middle"></i> Processando ${files.length} arquivo(s)...`;
      lucide.createIcons();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progressEl.innerHTML = `Processando ${i + 1}/${files.length}: ${escapeHtml(file.name)}`;

        if (file.size > MAX_SIZE) {
          erro++;
          continue;
        }

        try {
          const fileData = await processFile(file);

          // Salvar na base de conhecimento como dados_treinamento
          await supabaseProxy('inserir_treinamento', {
            pergunta: `[BASE DE CONHECIMENTO] ${file.name}`,
            resposta: fileData.content || 'Conteúdo não extraído',
            fonte: 'base_conhecimento',
            qualidade: 5,
            user_id: currentUser.id,
            cliente_id: currentCliente?.id || null
          });

          // Também salvar em documentos_analisados para RAG
          await getLearningService().salvarDocumento(currentChat?.id || null, {
            ...fileData,
            summary: `[BASE] ${fileData.summary}`
          });

          sucesso++;
        } catch (e) {
          erro++;
        }
      }

      // Reset input
      event.target.value = '';

      registrarAuditLog('BATCH_UPLOAD', 'dados_treinamento', null, {
        arquivos: files.length, sucesso, erro,
        cliente_id: currentCliente?.id || null
      });
      progressEl.innerHTML = `
        <span style="color:var(--success)">✓ ${sucesso} arquivo(s) adicionado(s) à base</span>
        ${erro > 0 ? `<span style="color:var(--error)"> · ${erro} com erro</span>` : ''}
        <br><small style="color:var(--text-light)">O sistema usará estes documentos como referência nas próximas consultas</small>
      `;
    }



    // Modal de confirmação estilizado — substitui confirm() nativo





    

    // ============================================
    // FUNÇÃO ADD MESSAGE - SUPORTA MÚLTIPLOS ARQUIVOS
    // ============================================
    function addMessage(text, isUser, confidence = 'medium', fileData = null, interactionId = null, allFiles = null) {
      const container = document.getElementById('msgs');
      container.querySelector('.empty')?.remove();

      const div = document.createElement('div');
      div.className = `msg ${isUser ? 'user' : 'assistant'}`;

      const formattedText = formatTextWithLinks(text);

      let fileHtml = '';
      
      if (allFiles && allFiles.length > 0) {
        fileHtml = '<div class="multiple-files">';
        allFiles.forEach(file => {
          if (file.type?.startsWith('image/') && file.raw) {
            fileHtml += `<img src="${file.raw}" class="file-preview" alt="${file.name}" style="max-width:100%; margin:5px 0;">`;
          } else {
            fileHtml += `
              <div class="file-attachment" style="margin:5px 0;">
                <i data-lucide="file-text"></i>
                <span>
                  <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
                  ${file.summary ? `<br><small>${file.summary}</small>` : ''}
                </span>
              </div>`;

            if (file.content && !file.type?.startsWith('image/')) {
              fileHtml += `
                <div class="file-content-preview" style="margin-top:5px;">
                  <strong>Preview:</strong><br>
                  ${escapeHtml(file.content.substring(0, 300))}${file.content.length > 300 ? '...' : ''}
                </div>`;
            }
          }
        });
        fileHtml += '</div>';
      } else if (fileData) {
        if (fileData.type?.startsWith('image/') && fileData.raw) {
          fileHtml = `<img src="${fileData.raw}" class="file-preview" alt="${fileData.name}">`;
        } else {
          fileHtml = `
            <div class="file-attachment">
              <i data-lucide="file-text"></i>
              <span>
                <strong>${fileData.name}</strong> (${(fileData.size / 1024).toFixed(1)} KB)
                ${fileData.summary ? `<br><small>${fileData.summary}</small>` : ''}
              </span>
            </div>`;

          if (fileData.content && !fileData.type?.startsWith('image/')) {
            fileHtml += `
              <div class="file-content-preview">
                <strong>Preview:</strong><br>
                ${escapeHtml(fileData.content.substring(0, 300))}${fileData.content.length > 300 ? '...' : ''}
              </div>`;
          }
        }
      }

      const hasValidInteraction = interactionId && 
                                  interactionId !== 'null' && 
                                  interactionId !== 'undefined' && 
                                  String(interactionId).trim() !== '' &&
                                  !String(interactionId).includes('error');

      const footer = !isUser ? `
        <div class="mfoot">
          <button class="btn-copy" onclick="copyMessage(this)">
            <i data-lucide="copy" style="width:12px;height:12px"></i> Copiar
          </button>
          <button class="btn-feedback" id="feedback-btn-${interactionId || 'temp'}"
            ${hasValidInteraction ? `onclick="mostrarFeedbackOptions('${interactionId}')"` : 'disabled style="opacity:0.4;cursor:not-allowed"'}
            title="${hasValidInteraction ? 'Avaliar resposta' : 'Feedback disponível apenas para respostas novas'}">
            <i data-lucide="thumbs-up" style="width:12px;height:12px"></i> Feedback
          </button>
          <span class="badge-conf badge ${confidence}">
            ${confidence === 'high' ? 'Alta' : confidence === 'low' ? 'Baixa' : 'Média'} confiança
          </span>
        </div>` : '';

      div.innerHTML = `
        <div class="ava"><i data-lucide="${isUser ? 'user' : 'bot'}"></i></div>
        <div class="bubble">
          ${formattedText}
          ${fileHtml}
          ${footer}
        </div>`;

      container.appendChild(div);
      lucide.createIcons();
      container.scrollTop = container.scrollHeight;
    }

    function formatTextWithLinks(text) {
      if (!text) return '';
      
      let t = escapeHtml(text);
      
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      
      t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/`(.*?)`/g, '<code>$1</code>');
      t = t.replace(/^- (.+)$/gm, '<li>$1</li>');
      t = t.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>');
      
      return t;
    }


    function showTypingIndicator() {
      hideTypingIndicator();

      const div = document.createElement('div');
      div.className = 'msg assistant';
      div.id = 'typing';
      div.innerHTML = `
        <div class="ava"><i data-lucide="bot"></i></div>
        <div class="bubble">
          <div class="typing-wrap">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
          </div>
        </div>`;

      document.getElementById('msgs').appendChild(div);
      lucide.createIcons();
      document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
    }

    function hideTypingIndicator() {
      document.getElementById('typing')?.remove();
    }

    function calculateConfidence(text) {
      if (!text) return 'medium';

      const highIndicators = [
        'lei', 'decreto', 'artigo', '§', 'instrução normativa',
        'convênio', 'lc', 'ctn', 'regulamento', 'solução de consulta'
      ];

      const lowIndicators = [
        'pode variar', 'consulte', 'verifique', 'depende',
        'recomenda-se', 'sugere-se', 'talvez', 'possivelmente'
      ];

      const textLower = text.toLowerCase();

      if (highIndicators.some(i => textLower.includes(i))) return 'high';
      if (lowIndicators.some(i => textLower.includes(i))) return 'low';
      return 'medium';
    }


    // ============================================
    // FUNÇÃO SEND CORRIGIDA - COM MEMÓRIA PERMANENTE E FALLBACK DE MODELOS
    // ============================================
    async function send() {
      const inp = document.getElementById('msgInput');
      const text = inp.value.trim();
      const hasFiles = currentFiles.length > 0;

      if (!text && !hasFiles) return;

      // Verificar rate limit — mostrar countdown e reenviar automaticamente
      if (Date.now() < rateLimitUntil) {
        const waitMs = rateLimitUntil - Date.now();
        const waitSeconds = Math.ceil(waitMs / 1000);
        addMessage(`Limite temporário atingido. Reenviando automaticamente em ${waitSeconds}s...`, false, 'low');
        setTimeout(() => send(), waitMs + 500);
        return;
      }

      document.getElementById('sendBtn').disabled = true;
      inp.disabled = true;

      try {

        // Preparar mensagem do usuário
        let messageContent = text || 'Arquivos enviados para análise fiscal';
        
        if (currentFiles.length > 0) {
          messageContent += '\n\nArquivos anexados:';
          currentFiles.forEach((file, index) => {
            messageContent += `\n\n**Arquivo ${index + 1}:** ${file.name}`;
            if (file.summary) {
              messageContent += `\n*Tipo:* ${file.summary}`;
            }
          });
        }

        addMessage(messageContent, true, 'medium', null, null, currentFiles);

        // Salvar arquivos na mensagem — limitar conteúdo para não estourar o JSONB do Supabase
        const filesParaSalvar = currentFiles.map(f => ({
          name: f.name,
          type: f.type,
          size: f.size,
          summary: f.summary || '',
          content: f.content ? f.content.substring(0, 3000) : '',
          raw: null // não salvar base64 de imagens no banco
        }));

        const userMessage = {
          role: 'user',
          content: text || 'Arquivos enviados para análise fiscal',
          files: filesParaSalvar
        };

        if (!currentChat.messages) currentChat.messages = [];
        currentChat.messages.push(userMessage);

        if (currentChat.messages.length === 1) {
          currentChat.title = (text || 'Análise de arquivos fiscais').substring(0, 50) +
            ((text || '').length > 50 ? '...' : '');
          await saveChat();
        }

        // CRIAR CONTEXTO DOS ARQUIVOS (TODOS OS ARQUIVOS DA CONVERSA)
        const fileContext = createFileContext();

        showTypingIndicator();

        // Buscar contexto RAG — aguardar antes de montar o prompt
        const [ragInteracoes, ragDocumentos] = await Promise.all([
          getLearningService().buscarContextoRAG(text || '').catch(() => null),
          getLearningService().buscarDocumentosRAG(text || '', currentChat.id).catch(() => null)
        ]);

        // Consultar CNPJ se detectado na mensagem
        let cnpjCtx = '';
        const cnpjDetectado = text ? extrairCNPJ(text) : null;
        if (cnpjDetectado) {
          addMessage('Consultando CNPJ na Receita Federal...', false, 'low');
          const dadosCNPJ = await consultarCNPJ(cnpjDetectado);
          const formatado = formatarDadosCNPJ(dadosCNPJ);
          if (formatado) {
            cnpjCtx = `

${formatado}`;
            // Remover mensagem de loading
            const msgs = document.getElementById('msgs');
            const ultimo = msgs.querySelector('.msg-row:last-child');
            if (ultimo) ultimo.remove();
          }
        }

        // Sistema prompt personalizado por cliente
        const clienteCtx = currentCliente
          ? `\n\nEMPRESA ATIVA:\n- Razão Social: ${currentCliente.razao_social}\n- CNPJ: ${currentCliente.cnpj}\n- Regime Tributário: ${currentCliente.regime_tributario || 'Não informado'}\n- Nome Fantasia: ${currentCliente.nome_fantasia || '-'}\nResponda sempre no contexto desta empresa.`
          : '';

        // Montar contexto RAG
        let ragCtx = '';
        if (ragInteracoes) ragCtx += `\n\n--- CONHECIMENTO FISCAL ACUMULADO ---\n${ragInteracoes}`;
        if (ragDocumentos) ragCtx += `\n\n--- DOCUMENTOS ANTERIORES RELEVANTES ---\n${ragDocumentos}`;

        // Sistema prompt com instruções EXPLÍCITAS
        const SYS = `Você é um especialista fiscal e tributário brasileiro sênior com mais de 20 anos de experiência prática em escritórios contábeis. Domina profundamente o sistema tributário brasileiro, legislação fiscal, obrigações acessórias, SPED, regimes tributários e a Reforma Tributária em andamento.${clienteCtx}${cnpjCtx}

========================================
REGIMES TRIBUTÁRIOS — REGRAS E ALÍQUOTAS
========================================

MEI (Microempreendedor Individual):
- Limite de faturamento: R$ 81.000/ano (R$ 6.750/mês)
- DAS fixo mensal: R$ 76,90 (comércio/indústria), R$ 80,90 (serviços), R$ 86,90 (comércio+serviços)
- Obrigações: DASN-SIMEI anual (até 31/05), emissão de NF para PJ
- Vedado: sócio em outra empresa, mais de 1 empregado, atividades não permitidas
- Desenquadramento automático ao ultrapassar R$ 97.200 no ano (20% acima do limite)

SIMPLES NACIONAL (LC 123/2006):
- Limite: até R$ 4.800.000/ano; sublimite ICMS/ISS: R$ 3.600.000
- Unifica: IRPJ, CSLL, PIS, COFINS, IPI, ICMS, ISS e CPP em guia única (DAS)
- Cálculo: alíquota efetiva = (RBT12 x alíquota nominal - parcela a deduzir) / RBT12
- Anexo I (Comércio): 4% a 19% | Anexo II (Indústria): 4,5% a 30%
- Anexo III (Serviços gerais): 6% a 33% | Anexo IV (Serviços específicos - CPP fora): 4,5% a 33%
- Anexo V (Serviços alta tributação): 15,5% a 30,5%
- Fator R: folha/faturamento ≥ 28% → Anexo III; < 28% → Anexo V (para atividades elegíveis)
- Obrigações: PGDAS-D mensal, DEFIS anual (até 31/03), DAS até dia 20 do mês seguinte
- Vedações: faturamento acima do limite, débitos em PGFN/RF sem parcelamento, atividades vedadas (LC 123 art. 17)

LUCRO PRESUMIDO:
- Limite: até R$ 78.000.000/ano (a partir de 2026 progressividade para receitas > R$5 milhões - LC 224/2025)
- IRPJ: 15% sobre lucro presumido + adicional de 10% sobre base trimestral > R$60.000
- CSLL: 9% sobre lucro presumido (15% para instituições financeiras)
- PIS: 0,65% sobre faturamento (regime cumulativo, sem créditos)
- COFINS: 3% sobre faturamento (regime cumulativo, sem créditos)
- Percentuais de presunção IRPJ: comércio 8%, indústria 8%, serviços em geral 32%, serviços hospitalares 8%, transporte de cargas 8%, transporte de passageiros 16%, construção civil (com material) 8%
- Percentuais de presunção CSLL: comércio/indústria 12%, serviços em geral 32%
- Apuração: IRPJ e CSLL trimestral; PIS e COFINS mensal
- Obrigações: ECF (até 31/07), ECD (até 30/06), DCTFWeb mensal, EFD-Contribuições (até 10º dia útil do 2º mês seguinte), EFD-Reinf (até dia 15 do mês seguinte)

LUCRO REAL:
- Obrigatório para: receita > R$78 milhões, instituições financeiras, factoring, empresas com lucros do exterior, beneficiárias de isenções/reduções de IRPJ
- IRPJ: 15% + adicional 10% sobre lucro real > R$20.000/mês (anual ou trimestral)
- CSLL: 9% (15% para financeiras e seguradoras)
- PIS: 1,65% (não cumulativo, com créditos sobre insumos, aluguéis, depreciações)
- COFINS: 7,6% (não cumulativo, com créditos)
- Estimativas mensais com ajuste anual (se opção anual)
- Obrigações adicionais: LALUR (Livro de Apuração do Lucro Real), ECD obrigatória, controle de JSCP

========================================
OBRIGAÇÕES ACESSÓRIAS — CALENDÁRIO 2026
========================================

MENSAIS:
- DCTFWeb: até o último dia útil do mês seguinte ao fato gerador (ex: jan/26 → 28/fev)
- EFD-Reinf (R-2099/R-4099): até dia 15 do mês seguinte (1º dia útil se cair em dia não útil)
- EFD-Contribuições (PIS/COFINS): até o 10º dia útil do 2º mês após o fato gerador
- DAS Simples Nacional: até dia 20 do mês seguinte
- PGDAS-D: até dia 20 do mês seguinte
- eSocial: competência mensal — folha até dia 15 do mês seguinte

ANUAIS:
- DASN-SIMEI (MEI): até 31/05/2026 (ano-base 2025)
- DEFIS (Simples Nacional): até 31/03/2026 (ano-base 2025)
- DIRPF (Pessoa Física): 15/03 a 29/05/2026
- ECD (Escrituração Contábil Digital): até 30/06/2026 (ano-base 2025)
- ECF (Escrituração Contábil Fiscal): até 31/07/2026 (ano-base 2025)
- DIRF: em extinção — substituída pelo eSocial/EFD-Reinf (Programa Autorregularização até 20/02/2026)
- RAIS: extinta — substituída pelo eSocial desde ano-base 2023

MULTAS POR ATRASO (referência):
- DCTFWeb: 2% ao mês sobre o valor informado, limitado a 20%
- ECD: multa por omissão/incorreção conforme art. 57 da MP 2.158-35/2001
- ECF: até 3% do valor omitido/inexato para Lucro Real; multas expressivas para Lucro Presumido
- Simples/PGDAS: multa automática por atraso

========================================
REFORMA TRIBUTÁRIA — SITUAÇÃO 2026
========================================

NOVOS TRIBUTOS (EC 132/2023 + LC 214/2025):
- CBS (Contribuição sobre Bens e Serviços): substitui PIS, COFINS e IPI — competência federal
- IBS (Imposto sobre Bens e Serviços): substitui ICMS e ISS — competência estadual/municipal
- IS (Imposto Seletivo): incide sobre bens/serviços prejudiciais à saúde ou meio ambiente

2026 — FASE DE TESTES (alíquotas simbólicas):
- Alíquota teste: 1% total (CBS 0,9% + IBS 0,1%)
- Sem aumento de carga: IBS/CBS compensados com PIS/COFINS
- Obrigatório destacar IBS e CBS nas NF-e, NFC-e, CT-e desde jan/2026
- Campos: CST-IBS/CBS e cClassTrib em todos os documentos fiscais eletrônicos
- Simples Nacional: dispensado do destaque em 2026; obrigatório a partir de 2027
- Sem penalidades por falta de preenchimento até o 1º dia do 4º mês após publicação dos regulamentos
- 2026 é fase educativa/testes — cobrança efetiva começa em 2027
- Extinção completa dos tributos antigos e implantação integral do IVA: 2033
- Split payment (separação automática do tributo no pagamento): obrigatório a partir de 2027

IMPACTO POR SETOR:
- Serviços: maior impacto — sai de ISS (2-5%) para IVA (~27%); profissionais liberais têm redução de 30%
- Comércio: pode ganhar com não-cumulatividade; atenção ao fluxo de caixa com split payment
- Indústria: beneficiada pela extinção do IPI e melhor aproveitamento de créditos
- Simples Nacional: 2026 sem mudança prática; atenção ao ecossistema de NFS-e nacional

========================================
SPED — ESTRUTURA E REGISTROS CHAVE
========================================

EFD ICMS/IPI (SPED Fiscal):
- Registro 0000: identificação do estabelecimento e período
- Registro C100: documentos de entrada e saída (NF, NFC-e)
- Registro C190: totalização por CFOP e CST
- Registro E110/E111: apuração ICMS
- Registro G110: apuração IPI

EFD-Contribuições:
- Apuração PIS/COFINS — regime cumulativo (LP) e não cumulativo (LR)
- Registro M200/M600: totais de contribuição apurada
- Créditos: registro M100/M500

ECD (Livros Contábeis):
- Livro Diário, Razão e Balancetes
- Pré-requisito para a ECF (especialmente no Lucro Real)

ECF (substitui DIPJ):
- Bloco K: controle da produção e estoque (indústrias)
- Bloco P: IRPJ e CSLL — apuração e LALUR

========================================
CFOP E CST — REFERÊNCIA RÁPIDA
========================================

CFOP principais:
- 1.102/2.102: compra para comercialização (dentro/fora do estado)
- 1.101/2.101: compra para industrialização
- 1.556/2.556: compra de material de uso e consumo
- 5.102/6.102: venda de mercadoria adquirida (dentro/fora do estado)
- 5.405: venda com ICMS-ST já retido
- 5.411: devolução de compra para comercialização
- 1.411/2.411: devolução de venda

CST ICMS:
- 00: tributada integralmente | 10: tributada com ST | 20: com redução de BC
- 30: isenta/não trib. com ST | 40: isenta | 41: não tributada | 50: com suspensão
- 60: ICMS cobrado por ST | 70: redução BC e ST | 90: outras

CST PIS/COFINS:
- 01: operação tributável (alíquota básica) | 02: alíquota diferenciada
- 04: operação imune | 05: suspensão | 06: alíquota zero | 07: isenta | 49: outras entradas
- 50: operação com direito a crédito (alíquota básica) | 70: adq. não tributada

========================================
SITUAÇÕES FISCAIS COMUNS E ALERTAS
========================================

ICMS-ST (Substituição Tributária):
- Responsabilidade do substituto (fabricante/importador) pelo recolhimento antecipado
- GNRE para operações interestaduais com ST
- Verificar Protocolo/Convênio entre estados
- Ressarcimento possível quando venda ao consumidor final abaixo do preço de pauta

DIFAL (Diferencial de Alíquota):
- ICMS nas compras interestaduais para uso/consumo ou ativo imobilizado
- Para não contribuintes do ICMS: recolhimento na entrada (art. 155 §2º IX 'a' CF)
- EC 87/2015: partilha entre estado de origem e destino até 2018; 100% destino desde 2019

SIMPLES NACIONAL — ALERTAS:
- Sublimite: acima de R$3,6 mi/ano → ICMS e ISS recolhidos separadamente
- Fator R mensal: recalcular todo mês para atividades dos Anexos III/V
- Vedação: débito com PGFN sem parcelamento causa exclusão
- Pró-labore: sócios devem ter pro-labore definido; ausência é risco trabalhista e previdenciário

RETENÇÕES NA FONTE:
- IRRF sobre serviços (PJ): 1,5% (manutenção, limpeza), 1% (comissões, propaganda), 1,5% (transportes), 15% (juros/royalties)
- CSRF (PIS+COFINS+CSLL): 4,65% sobre pagamentos a PJ de direito privado ≥ R$215,05
- ISS retido: conforme lei municipal do tomador (geralmente 2% a 5%)
- INSS retido (cessão de mão de obra): 11% sobre NF de serviços

PLANEJAMENTO TRIBUTÁRIO LEGAL:
- Splitting de atividades entre empresas (quando legítimo e com propósito negocial)
- Pró-labore otimizado vs. distribuição de lucros (lucros isentos de IRPF)
- Aproveitamento de créditos PIS/COFINS no Lucro Real
- JSCP (Juros sobre Capital Próprio): dedutível do IRPJ/CSLL — alíquota TJLP
- Escolha do regime tributário: simular Simples x LP x LR anualmente

========================================
DOCUMENTOS FISCAIS ELETRÔNICOS
========================================

NF-e (modelo 55): operações com mercadorias entre contribuintes do ICMS
NFC-e (modelo 65): venda ao consumidor final (substituiu ECF/nota fiscal de cupom)
CT-e (modelo 57): conhecimento de transporte eletrônico
NFS-e: nota fiscal de serviços — emitida pelo prestador conforme legislação municipal
MDF-e: manifesto eletrônico de documentos fiscais (transporte de cargas)
BP-e: bilhete de passagem eletrônico

Prazos de armazenamento: 5 anos (prazo decadencial) + 5 anos a mais por segurança (10 anos total recomendado)
XML das NF-e: obrigação legal de armazenar por contribuinte emitente e receptor

========================================
INSTRUÇÕES DE COMPORTAMENTO
========================================

SOBRE ARQUIVOS E DOCUMENTOS:
- Os arquivos enviados estão disponíveis durante TODA a conversa
- Ao analisar múltiplos arquivos: cruze os dados, compare valores, aponte inconsistências
- Em SPEDs: identifique os registros, apure os tributos e valide os totais
- Em planilhas: some colunas, compare períodos, identifique divergências
- Cite sempre o trecho/registro específico do documento ao fazer afirmações

POSTURA PROFISSIONAL:
- Responda em português brasileiro claro e objetivo
- Cite a legislação aplicável (lei, decreto, instrução normativa, artigo)
- Quantifique riscos: mencione percentuais de multa e valores estimados quando possível
- Diferencie o que é certeza legal do que é interpretação ou risco
- Sugira consulta formal à RFB (Solução de Consulta COSIT) quando a situação for ambígua
- Alerte sobre prazos quando a pergunta envolver obrigação com data próxima
- Para planejamento tributário: apresente sempre a opção legal e o risco da opção agressiva

`.trim();

        // Preparar mensagens (últimas 8 para manter contexto)
        const recentChatMessages = currentChat.messages.slice(-16).map(m => ({
          role: m.role,
          content: m.role === 'user' && m.files ?
            `${m.content}\n\n[Arquivos anexados nesta mensagem: ${m.files.map(f => f.name).join(', ')}]` :
            m.content
        }));

        // Montar mensagens — contexto de arquivos e RAG como system separado
        // para não ser truncado pelo limite do SYS prompt fiscal (14000 chars)
        const systemMessages = [{ role: 'system', content: SYS }];
        const contextExtra = [fileContext, ragCtx].filter(Boolean).join('\n').trim();
        if (contextExtra) {
          systemMessages.push({ role: 'system', content: contextExtra });
        }

        const messagesToSend = [
          ...systemMessages,
          ...recentChatMessages
        ];

        // Tentar com modelo atual, se falhar tentar próximo
        let data = null;
        let attempts = 0;
        const maxAttempts = MODELS.length * 2;

        while (attempts < maxAttempts && !data) {
          const modelIndex = currentModelIndex % MODELS.length;
          const model = MODELS[modelIndex];
          
          try {
            
            const res = await fetch('/.netlify/functions/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: model,
                temperature: 0.7,
                max_tokens: 4000,
                messages: messagesToSend
              })
            });

            if (res.status === 429) {
              // Rate limit - mudar para próximo modelo
              currentModelIndex++;
              attempts++;
              
              if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              } else {
                // Todos os modelos falharam
                rateLimitUntil = Date.now() + 60000; // Bloquear por 60 segundos
                throw new Error('Todos os modelos estão em rate limit. Aguarde 60 segundos.');
              }
            }

            if (!res.ok) {
              const errorText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errorText.substring(0, 100)}`);
            }
            
            data = await res.json();
            
            // Resetar erros consecutivos em caso de sucesso
            consecutiveErrors = 0;
            
          } catch (error) {
            consecutiveErrors++;
            
            // Se muitos erros consecutivos, mudar de modelo
            if (consecutiveErrors >= 2) {
              currentModelIndex++;
              consecutiveErrors = 0;
            }
            
            attempts++;
            
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              throw error;
            }
          }
        }

        if (!data?.choices?.[0]?.message) {
          throw new Error('Não foi possível obter resposta após múltiplas tentativas');
        }

        hideTypingIndicator();

        const reply = data.choices[0].message.content;
        const confidence = calculateConfidence(reply);

        // Registrar interação (opcional)
        let interacaoId = null;
        try {
          interacaoId = await getLearningService().registrarInteracao(
            currentChat.id,
            text || 'Arquivos enviados',
            reply,
            data.usage?.total_tokens || 0,
            MODELS[currentModelIndex % MODELS.length]
          );
        } catch (e) {
        }

        const assistantMessage = {
          role: 'assistant',
          content: reply,
          confidence,
          interactionId: interacaoId
        };

        currentChat.messages.push(assistantMessage);
        addMessage(reply, false, confidence, null, interacaoId);

        if (interacaoId) {
          setTimeout(() => {
            mostrarFeedbackOptions(interacaoId);
          }, 1500);
        }

        saveChat();
        inp.value = '';

      } catch (e) {
        hideTypingIndicator();
        
        let errorMessage = '';
        
        if (e.message.includes('429') || e.message.includes('rate limit')) {
          errorMessage = 'Limite de requisições excedido. Aguarde 30 segundos e tente novamente.';
          rateLimitUntil = Date.now() + 60000;
        } else if (e.message.includes('500') || e.message.includes('503')) {
          errorMessage = 'Serviço temporariamente indisponível. Tente novamente em alguns instantes.';
        } else if (e.message.includes('401')) {
          errorMessage = 'Erro de autenticação. Recarregue a página.';
        } else {
          errorMessage = 'Erro ao processar. Tente novamente.';
        }
        
        addMessage(errorMessage, false, 'low');
        
      } finally {
        document.getElementById('sendBtn').disabled = false;
        inp.disabled = false;
        inp.focus();
      }
    }

    async function handleMultipleFiles(event) {
      const files = Array.from(event.target.files);
      const MAX_SIZE = 10 * 1024 * 1024;

      for (const file of files) {
        if (file.size > MAX_SIZE) {
          alert(`Arquivo ${file.name} muito grande. Máx: 10MB`);
          continue;
        }

        try {
          showFileProgress(file);
          const fileData = await processFile(file);
          currentFiles.push(fileData);

          await getLearningService().salvarDocumento(currentChat.id, fileData);

        } catch (error) {
        } finally {
          isProcessingFile = false;
        }
      }

      updateFilesUI();
      event.target.value = '';
    }

    function showFileProgress(file) {
      const container = document.getElementById('fileContainer');
      const progressContainer = document.getElementById('fileProgressContainer');
      container.style.display = 'block';
      progressContainer.style.display = 'block';

      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        document.getElementById('progressFill').style.width = progress + '%';

        if (progress >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 500);
        }
      }, 100);
    }

    async function processFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const fileType = file.type;
        const fileName = file.name;

        reader.onload = async function (e) {
          try {
            let content = '';
            let summary = '';

            if (fileType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
              const pdfData = new Uint8Array(e.target.result);
              const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

              let text = '';
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                text += textContent.items.map(item => item.str).join(' ') + '\n';
                if (text.length > 30000) break; // evitar timeout em PDFs gigantes
              }

              content = text.substring(0, 15000);
              summary = `PDF com ${pdf.numPages} página(s)`;

              if (text.toLowerCase().includes('nota fiscal') || text.toLowerCase().includes('nfe')) {
                summary += ' - Documento fiscal';
              }

            } else if (fileType.includes('spreadsheet') || fileName.match(/\.(xls|xlsx|csv)$/i)) {
              const data = new Uint8Array(e.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              let allSheets = '';
              workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const csv = XLSX.utils.sheet_to_csv(sheet);
                if (csv.trim()) allSheets += `\n=== ABA: ${sheetName} ===\n${csv}`;
              });
              content = allSheets.substring(0, 15000);
              summary = `Planilha com ${workbook.SheetNames.length} aba(s)`;

            } else if (fileType.includes('text') || fileName.match(/\.(txt|csv)$/i)) {
              content = e.target.result.substring(0, 15000);
              summary = 'Arquivo de texto';

            } else if (
              fileType.includes('wordprocessingml') ||
              fileType.includes('msword') ||
              fileName.match(/\.docx?$/i)
            ) {
              try {
                const arrayBuffer = e.target.result;
                const result = await mammoth.extractRawText({ arrayBuffer });
                content = result.value.substring(0, 15000);
                summary = `Documento Word (${content.length} chars extraídos)`;
              } catch {
                content = 'Não foi possível extrair o texto do documento Word.';
                summary = 'Documento Word';
              }

            } else if (fileType.includes('image')) {
              content = 'Imagem enviada para análise';
              summary = 'Imagem';

            } else {
              content = 'Tipo de arquivo não suportado para leitura completa.';
              summary = 'Arquivo';
            }

            resolve({
              name: fileName,
              type: fileType,
              size: file.size,
              content,
              summary,
              raw: fileType.includes('image') ? e.target.result : null
            });

          } catch (error) {
            reject(error);
          }
        };

        reader.onerror = reject;

        if (
          file.type.includes('pdf') ||
          file.type.includes('wordprocessingml') ||
          file.type.includes('msword') ||
          file.name.match(/\.(xls|xlsx|csv|docx?)$/i)
        ) {
          reader.readAsArrayBuffer(file);
        } else if (file.type.includes('image')) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file, 'UTF-8');
        }
      });
    }

    function updateFilesUI() {
      const container = document.getElementById('fileContainer');
      const multipleFilesDiv = document.getElementById('multipleFiles');

      if (currentFiles.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';
      multipleFilesDiv.innerHTML = currentFiles.map((file, index) => `
        <span class="file-tag">
          <i data-lucide="file"></i>
          ${file.name}
          <i data-lucide="x" onclick="removeFile(${index})" style="cursor: pointer;"></i>
        </span>
      `).join('');

      lucide.createIcons();
    }

    function removeFile(index) {
      currentFiles.splice(index, 1);
      updateFilesUI();
    }

    function removeAllFiles() {
      currentFiles = [];
      updateFilesUI();
    }

    function copyMessage(btn) {
      const bubble = btn.closest('.bubble');
      const clone = bubble.cloneNode(true);
      clone.querySelector('.mfoot')?.remove();
      const text = clone.innerText.trim();

      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i data-lucide="check" style="width:12px;height:12px"></i> Copiado!';
        lucide.createIcons();
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="copy" style="width:12px;height:12px"></i> Copiar';
          lucide.createIcons();
        }, 2000);
      });
    }

    function checkDeadlines() {
      const today = new Date();
      const alerts = [];

      for (const [key, deadline] of Object.entries(fiscalDeadlines)) {
        if (deadline.month === 'monthly') {
          const nextDeadline = new Date(today.getFullYear(), today.getMonth(), deadline.day);
          const daysUntil = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));

          if (daysUntil <= 5 && daysUntil >= 0) {
            alerts.push({
              message: `${deadline.description} em ${daysUntil} dias`,
              severity: daysUntil <= 2 ? 'high' : 'medium'
            });
          }
        } else {
          const nextDeadline = new Date(today.getFullYear(), deadline.month - 1, deadline.day);
          if (today > nextDeadline) {
            nextDeadline.setFullYear(nextDeadline.getFullYear() + 1);
          }
          const daysUntil = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));

          if (daysUntil <= 30 && daysUntil >= 0) {
            alerts.push({
              message: `${deadline.description} em ${daysUntil} dias`,
              severity: daysUntil <= 7 ? 'high' : 'medium'
            });
          }
        }
      }

      const alertDiv = document.getElementById('deadlineAlerts');
      if (alerts.length > 0) {
        alertDiv.innerHTML = alerts.map(a => `
          <div class="alert alert-${a.severity}">
            <i data-lucide="alert-circle"></i>
            ${a.message}
          </div>
        `).join('');
        lucide.createIcons();
      } else {
        alertDiv.innerHTML = '';
      }
    }




    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-wrap')) closeDropdowns();
    });

    function useTemplate(text) {
      document.getElementById('msgInput').value = text;
      document.getElementById('msgInput').focus();
    }








    function calculateTaxes() {
      const v = parseFloat(document.getElementById('cV').value) || 0;
      const i = parseFloat(document.getElementById('cI').value) || 0;
      const p = parseFloat(document.getElementById('cP').value) || 0;
      const c = parseFloat(document.getElementById('cC').value) || 0;

      const format = n => `R$ ${n.toFixed(2).replace('.', ',')}`;
      const icms = v * i / 100;
      const pis = v * p / 100;
      const cof = v * c / 100;

      document.getElementById('rI').textContent = format(icms);
      document.getElementById('rP').textContent = format(pis);
      document.getElementById('rC').textContent = format(cof);
      document.getElementById('rT').textContent = format(icms + pis + cof);
      document.getElementById('cResult').style.display = 'block';
    }







    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openCalculator();
      }
      if (e.key === 'Escape' && currentFiles.length > 0) {
        removeAllFiles();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportChat();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (currentChat.messages && currentChat.messages.length > 0) {
        saveChat();
      }
    });
