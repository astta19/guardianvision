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
      if (!pergunta || !resposta) return null;

      const tags = this.extrairTags(pergunta);

      const dadosInsercao = {
        chat_id:           chatId || null,
        pergunta,
        resposta,
        tags_pergunta:     tags.length > 0 ? tags : null,
        tokens_utilizados: tokens || null,
        modelo_utilizado:  modelo || null,
        user_id:           currentUser?.id || null,
        cliente_id:        currentCliente?.id || null,
        data_interacao:    new Date().toISOString(),
      };

      const { data, error } = await this.supabase
        .from('interacoes_chat')
        .insert(dadosInsercao)
        .select()
        .single();

      if (error) return null;

      // Gerar embedding em background — não bloqueia a resposta ao usuário
      if (data?.id) {
        this._gerarEmbeddingAsync('interacoes_chat', data.id, pergunta).catch(() => {});
      }

      return data.id;

    } catch {
      return null;
    }
  }

  // Gera embedding via Voyage AI e salva na tabela (background)
  async _gerarEmbeddingAsync(tabela, id, texto) {
    try {
      const res = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [texto] }),
      });
      if (!res.ok) return;
      const { embeddings } = await res.json();
      const emb = embeddings?.[0];
      if (!emb?.length) return;
      await this.supabase.from(tabela).update({ embedding: emb }).eq('id', id);
    } catch { /* silencioso */ }
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
        .eq('user_id', currentUser?.id || '')
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
            user_id: currentUser?.id || null,
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
      const clienteId = currentCliente?.id || null;

      // ── Tentar RAG semântico (pgvector + Voyage AI) ───────
      const embRes = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [pergunta] }),
      }).catch(() => null);

      if (embRes?.ok) {
        const { embeddings } = await embRes.json();
        const emb = embeddings?.[0];
        if (emb?.length) {
          const { data: semResults } = await this.supabase
            .rpc('buscar_rag_semantico', {
              p_embedding:  emb,
              p_user_id:    currentUser.id,
              p_cliente_id: clienteId,
              p_limit:      3,
            });

          if (semResults?.length) {
            return semResults
              .map(r => `P: ${r.pergunta}\nR: ${r.resposta.substring(0, 1500)}`)
              .join('\n\n---\n\n');
          }
        }
      }

      // ── Fallback: busca por palavras (sem pgvector) ────────
      const tags = this.extrairTags(pergunta);

      let qInteracoes = this.supabase
        .from('interacoes_chat')
        .select('pergunta, resposta, feedback_usuario, tags_pergunta')
        .gte('feedback_usuario', 4)
        .not('resposta', 'is', null)
        .order('feedback_usuario', { ascending: false })
        .limit(10);
      if (clienteId) qInteracoes = qInteracoes.eq('cliente_id', clienteId);
      if (!isAdmin() && currentUser?.id) qInteracoes = qInteracoes.eq('user_id', currentUser.id);

      let qTreinamento = this.supabase
        .from('dados_treinamento')
        .select('pergunta, resposta, qualidade')
        .gte('qualidade', 4)
        .order('qualidade', { ascending: false })
        .limit(10);
      if (clienteId) qTreinamento = qTreinamento.eq('cliente_id', clienteId);
      if (currentUser?.id) qTreinamento = qTreinamento.eq('user_id', currentUser.id);

      const [{ data: interacoes }, { data: treinamento }] = await Promise.all([
        qInteracoes, qTreinamento,
      ]);

      const candidatos = [
        ...(interacoes || []).map(i => ({
          pergunta: i.pergunta, resposta: i.resposta,
          tags: i.tags_pergunta || [], peso: i.feedback_usuario || 0,
        })),
        ...(treinamento || []).map(t => ({
          pergunta: t.pergunta, resposta: t.resposta,
          tags: [], peso: t.qualidade || 0,
        })),
      ];

      if (!candidatos.length) return null;

      const palavras = pergunta.toLowerCase().split(/\s+/).filter(p => p.length >= 2);
      const pontuados = candidatos.map(c => {
        const texto = (c.pergunta + ' ' + c.tags.join(' ')).toLowerCase();
        const matches    = palavras.filter(p => texto.includes(p)).length;
        const tagMatches = tags.filter(t => c.tags.includes(t)).length;
        return { ...c, score: matches * 3 + tagMatches * 4 + (c.peso > 3 ? 1 : 0) };
      });

      const relevantes = pontuados
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      if (!relevantes.length) return null;
      return relevantes
        .map(c => `P: ${c.pergunta}\nR: ${c.resposta.substring(0, 1500)}`)
        .join('\n\n---\n\n');

    } catch {
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
        .order('created_at', { ascending: false })
        .limit(20);
      if (clienteId) qDocs = qDocs.eq('cliente_id', clienteId);
      if (currentUser?.id) qDocs = qDocs.eq('user_id', currentUser.id);
      const { data } = await qDocs;

      if (!data || data.length === 0) return null;

      const palavras = pergunta.toLowerCase().split(/\s+/).filter(p => p.length >= 2);

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
    showToast('Feedback disponível apenas para respostas novas.', 'info');
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

// ============================================================
// SISTEMA DE APRENDIZADO — Upload e extração inteligente
// ============================================================

// Chunking: divide conteúdo em blocos de ~2000 chars por parágrafo/seção
function _chunkar(texto, tamanhoMax = 2000) {
  const chunks = [];
  const paragrafos = texto.split(/\n{2,}/).filter(p => p.trim().length > 50);
  let bloco = '';
  for (const p of paragrafos) {
    if ((bloco + '\n\n' + p).length > tamanhoMax && bloco) {
      chunks.push(bloco.trim());
      bloco = p;
    } else {
      bloco = bloco ? bloco + '\n\n' + p : p;
    }
  }
  if (bloco.trim()) chunks.push(bloco.trim());
  // Se não houver parágrafos duplos, fatiar por tamanho
  if (!chunks.length) {
    for (let i = 0; i < texto.length; i += tamanhoMax) {
      const c = texto.slice(i, i + tamanhoMax).trim();
      if (c.length > 100) chunks.push(c);
    }
  }
  return chunks;
}

// Gera pares Q&A a partir de um chunk via API Anthropic
async function _gerarQAPorChunk(chunk, nomeArquivo, indice, total) {
  try {
    const res = await fetch('/api/chat-anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: false,
        messages: [{
          role: 'user',
          content: `Você é um assistente contábil/fiscal brasileiro especializado.
Analise o trecho abaixo (${indice + 1}/${total}) do arquivo "${nomeArquivo}" e gere de 1 a 4 pares de perguntas e respostas que um contador faria sobre esse conteúdo.
Foque em: valores, alíquotas, prazos, CNPJs, regras fiscais, obrigações, procedimentos.
Ignore cabeçalhos genéricos, páginas em branco ou conteúdo sem relevância contábil.

TRECHO:
${chunk}

Responda APENAS em JSON válido, sem markdown, no formato:
{"pares": [{"pergunta": "...", "resposta": "..."}]}
Se o trecho não tiver conteúdo fiscal relevante, retorne: {"pares": []}`
        }],
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content || []).find(b => b.type === 'text')?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed.pares || [];
  } catch { return []; }
}

async function handleBatchUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  const progressEl = document.getElementById('batchProgress');
  const MAX_SIZE = 20 * 1024 * 1024;
  let totalPares = 0, totalErro = 0;

  const setProgress = (msg, tipo = '') => {
    if (!progressEl) return;
    progressEl.innerHTML = `<span style="color:${tipo === 'erro' ? 'var(--error)' : 'var(--text-light)'}">${msg}</span>`;
  };

  setProgress(`<i data-lucide="loader" style="width:12px;height:12px;vertical-align:middle;animation:spin 1s linear infinite"></i> Iniciando processamento de ${files.length} arquivo(s)...`);
  if (window.lucide) lucide.createIcons();

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];

    if (file.size > MAX_SIZE) {
      setProgress(`⚠ ${escapeHtml(file.name)}: arquivo muito grande (máx 20MB). Pulando...`);
      totalErro++;
      continue;
    }

    try {
      // 1. Extrair texto do arquivo
      setProgress(`📄 (${fi + 1}/${files.length}) Extraindo texto: ${escapeHtml(file.name)}...`);
      const fileData = await processFile(file);

      if (!fileData.content || fileData.content.length < 100) {
        setProgress(`⚠ ${escapeHtml(file.name)}: conteúdo insuficiente para indexar.`);
        continue;
      }

      // 2. Verificar duplicata pelo nome + user
      const { count: jaExiste } = await sb.from('dados_treinamento')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .eq('fonte', 'base_conhecimento')
        .ilike('pergunta', `%${file.name}%`);

      if (jaExiste > 0) {
        setProgress(`ℹ ${escapeHtml(file.name)}: já indexado anteriormente. Pulando.`);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      // 3. Dividir em chunks semânticos
      const chunks = _chunkar(fileData.content);
      setProgress(`🔍 (${fi + 1}/${files.length}) ${escapeHtml(file.name)}: ${chunks.length} seção(ões) encontrada(s). Gerando Q&A com IA...`);

      let paresArquivo = 0;

      for (let ci = 0; ci < chunks.length; ci++) {
        setProgress(`🧠 (${fi + 1}/${files.length}) ${escapeHtml(file.name)}: analisando seção ${ci + 1}/${chunks.length}...`);
        const pares = await _gerarQAPorChunk(chunks[ci], file.name, ci, chunks.length);

        for (const par of pares) {
          if (!par.pergunta || !par.resposta || par.pergunta.length < 10) continue;
          try {
            await supabaseProxy('inserir_treinamento', {
              pergunta: par.pergunta,
              resposta: par.resposta,
              fonte: 'base_conhecimento',
              qualidade: 5,
              user_id: currentUser.id,
              cliente_id: currentCliente?.id || null,
            });
            paresArquivo++;
            totalPares++;
          } catch { totalErro++; }
        }

        // Pausa entre chunks para não saturar rate limit
        if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 600));
      }

      // 4. Salvar referência do documento completo para RAG de documentos
      await getLearningService().salvarDocumento(null, {
        name: file.name,
        type: file.type,
        size: file.size,
        content: fileData.content,
        summary: `[BASE] ${fileData.summary} — ${paresArquivo} Q&A extraídos`,
      });

      setProgress(`✅ ${escapeHtml(file.name)}: ${paresArquivo} par(es) Q&A indexado(s).`);
      await new Promise(r => setTimeout(r, 600));

    } catch (e) {
      setProgress(`❌ ${escapeHtml(file.name)}: erro — ${e.message}`, 'erro');
      totalErro++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  event.target.value = '';

  registrarAuditLog('BATCH_UPLOAD', 'dados_treinamento', null, {
    arquivos: files.length, pares: totalPares, erros: totalErro,
    cliente_id: currentCliente?.id || null
  });

  const corStatus = totalErro > 0 && totalPares === 0 ? 'var(--error)' : '#16a34a';
  progressEl.innerHTML = `
    <div style="margin-top:8px;padding:10px 12px;background:var(--sidebar-hover);border-radius:8px;border-left:3px solid ${corStatus}">
      <div style="font-size:13px;font-weight:600;color:${corStatus}">
        ${totalPares > 0 ? `✅ ${totalPares} par(es) Q&A adicionados à base de conhecimento` : '⚠ Nenhum conteúdo indexado'}
      </div>
      ${totalErro > 0 ? `<div style="font-size:11px;color:var(--error);margin-top:3px">${totalErro} erro(s) durante o processo</div>` : ''}
      <div style="font-size:11px;color:var(--text-light);margin-top:4px">
        A IA usará este conhecimento automaticamente nas próximas consultas relacionadas.
      </div>
    </div>`;

  // Atualizar painel de aprendizado se estiver aberto
  if (document.getElementById('learningStatsModal')?.style.display !== 'none') {
    await showLearningStats();
  }
}



// Modal de confirmação estilizado — substitui confirm() nativo







// ============================================
// FUNÇÃO ADD MESSAGE - SUPORTA MÚLTIPLOS ARQUIVOS
// ============================================
function addMessage(text, isUser, confidence = 'medium', fileData = null, interactionId = null, allFiles = null, modelUsed = null) {
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

      ${modelUsed ? `<span class="badge-model" title="Modelo utilizado">${modelUsed.includes('claude') ? '✦ Claude' : modelUsed.includes('llama-3.3') ? 'Llama 3.3' : modelUsed.includes('llama-3.1') ? 'Llama 3.1' : 'Llama'}</span>` : ''}
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
  // Usar marked.js se disponível, senão mini-render manual
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true, sanitize: false });
    return marked.parse(text);
  }
  // Mini-renderer de fallback
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
    .replace(/^(.+)$/, '<p>$1</p>');
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



// ── Thinking toggle (UI) ──────────────────────────────────
function toggleThinking(ativo) {
  if (typeof AI_PROVIDER !== 'undefined') {
    AI_PROVIDER.ativarThinking(ativo);
    const lbl = document.getElementById('modelLabel');
    if (lbl) lbl.textContent = ativo ? 'claude-sonnet-4-6 + thinking' : 'claude-sonnet-4-6';
  }
}

// ── Modo Fiscal Focado (sem tools, só texto) ──────────────
let _modoFocado = false;

function toggleModoFocado() {
  _modoFocado = !_modoFocado;
  const btn = document.getElementById('btnModoFocado');
  if (btn) {
    btn.style.background   = _modoFocado ? 'var(--accent)'     : '';
    btn.style.color        = _modoFocado ? '#fff'               : '';
    btn.style.borderColor  = _modoFocado ? 'var(--accent)'     : '';
    btn.title = _modoFocado ? 'Modo Focado ativo — sem ações automáticas' : 'Ativar Modo Focado (só texto)';
  }
  showToast(_modoFocado ? '🎯 Modo Focado ativado — respostas só em texto' : 'Modo Focado desativado', 'info');
}

// ── Streaming helpers ─────────────────────────────────────
function addMessageStreaming(isUser) {
  const container = document.getElementById('msgs');
  container.querySelector('.empty')?.remove();
  const div = document.createElement('div');
  div.className = `msg ${isUser ? 'user' : 'assistant'} streaming`;
  div.innerHTML = `
    <div class="ava"><i data-lucide="bot"></i></div>
    <div class="bubble"><span class="stream-cursor">▍</span></div>`;
  container.appendChild(div);
  lucide.createIcons();
  container.scrollTop = container.scrollHeight;
  return div;
}

function updateStreamBubble(div, text) {
  if (!div) return;
  const bubble = div.querySelector('.bubble');
  if (!bubble) return;
  bubble.innerHTML = formatTextWithLinks(text) + '<span class="stream-cursor">▍</span>';
  const container = document.getElementById('msgs');
  container.scrollTop = container.scrollHeight;
}

function finalizeStreamBubble(div, text, footer) {
  if (!div) return;
  const bubble = div.querySelector('.bubble');
  if (!bubble) return;
  div.classList.remove('streaming');
  bubble.innerHTML = formatTextWithLinks(text) + (footer || '');
  lucide.createIcons();
}

// ── Thinking indicator ────────────────────────────────────
let _thinkingEl = null;

function showThinkingIndicator() {
  hideThinkingIndicator();
  const container = document.getElementById('msgs');
  _thinkingEl = document.createElement('div');
  _thinkingEl.className = 'msg assistant thinking-msg';
  _thinkingEl.innerHTML = `
    <div class="ava"><i data-lucide="brain"></i></div>
    <div class="bubble thinking-bubble">
      <div class="thinking-header">
        <span class="thinking-dot"></span>
        <span style="font-size:11px;color:var(--text-light)">Analisando profundamente...</span>
      </div>
      <div id="thinkingPreview" style="font-size:11px;color:var(--text-light);max-height:60px;overflow:hidden;margin-top:4px"></div>
    </div>`;
  container.appendChild(_thinkingEl);
  lucide.createIcons();
  container.scrollTop = container.scrollHeight;
}

function updateThinkingIndicator(text) {
  const el = document.getElementById('thinkingPreview');
  if (el && text) {
    el.textContent = text.slice(-200); // mostrar últimas 200 chars do raciocínio
  }
}

function hideThinkingIndicator() {
  _thinkingEl?.remove();
  _thinkingEl = null;
}

// ── Token/custo counter ───────────────────────────────────
let _sessionTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };

function updateTokenCounter(inputT, outputT, cacheReadT = 0, cacheWriteT = 0) {
  _sessionTokens.input      += inputT      || 0;
  _sessionTokens.output     += outputT     || 0;
  _sessionTokens.cacheRead  += cacheReadT  || 0;
  _sessionTokens.cacheWrite += cacheWriteT || 0;
  _sessionTokens.requests   += 1;

  // Preços Sonnet 4.6: input $3/MTok, output $15/MTok
  // Cache write $3.75/MTok, cache read $0.30/MTok (90% desconto)
  const custoUSD = (
    _sessionTokens.input      * 3.00 +
    _sessionTokens.output     * 15.00 +
    _sessionTokens.cacheWrite * 3.75 +
    _sessionTokens.cacheRead  * 0.30
  ) / 1_000_000;
  const custoBRL = custoUSD * 5.8;

  const totalTok = _sessionTokens.input + _sessionTokens.output;
  const cacheHit = _sessionTokens.cacheRead > 0
    ? ` · cache ${Math.round(_sessionTokens.cacheRead / (totalTok || 1) * 100)}%`
    : '';

  const el = document.getElementById('tokenCounter');
  if (el) {
    el.title = [
      `Entrada: ${_sessionTokens.input.toLocaleString()} tok`,
      `Saída: ${_sessionTokens.output.toLocaleString()} tok`,
      `Cache lido: ${_sessionTokens.cacheRead.toLocaleString()} tok`,
      `Cache escrito: ${_sessionTokens.cacheWrite.toLocaleString()} tok`,
      `Custo estimado: R$ ${custoBRL.toFixed(4)}`,
    ].join(' | ');
    el.textContent = `~R$ ${custoBRL.toFixed(3)} · ${_sessionTokens.requests} msg${cacheHit}`;
  }
}

// ── Streaming de resposta da API Anthropic ────────────────
async function streamResposta(endpoint, body, onChunk, onThinking, onDone, onError) {
  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let err = {};
      try { err = JSON.parse(text); } catch { err = { error: text.substring(0, 200) || 'Erro desconhecido' }; }
      onError(err, res.status);
      return;
    }

    // Detectar pelo Content-Type se é JSON ou SSE
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');

    if (isJson) {
      const data = await res.json();
      if (data.error) { onError(data, 0); return; }
      const content = data.content || [];
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
      const toolUses = content.filter(b => b.type === 'tool_use');
      onDone({
        text,
        thinking: '',
        inputTokens:  data.usage?.input_tokens  || 0,
        outputTokens: data.usage?.output_tokens || 0,
        toolCalls: toolUses.length ? toolUses.map(tu => ({
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
        })) : null,
      });
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   thinkingText = '';
    let   responseText = '';
    let   inputTokens  = 0, outputTokens = 0;
    let   cacheReadTokens = 0, cacheWriteTokens = 0;
    let   inThinking   = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // última linha pode estar incompleta

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;

        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        // Thinking block
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'thinking') {
          inThinking = true;
        }
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'text') {
          inThinking = false;
        }
        if (evt.type === 'content_block_stop') {
          inThinking = false;
        }

        // Erro vindo do backend via SSE
        if (evt.type === 'error') {
          onError(evt.error || { error: 'Erro da API' }, evt.error?.status || 0);
          return;
        }

        // Deltas
        if (evt.type === 'content_block_delta') {
          const delta = evt.delta;
          if (delta?.type === 'thinking_delta') {
            thinkingText += delta.thinking || '';
            onThinking?.(thinkingText);
          } else if (delta?.type === 'text_delta') {
            responseText += delta.text || '';
            onChunk(responseText);
          }
        }

        // Uso de tokens (incluindo cache)
        if (evt.type === 'message_delta' && evt.usage) {
          outputTokens = evt.usage.output_tokens || 0;
        }
        if (evt.type === 'message_start' && evt.message?.usage) {
          const u = evt.message.usage;
          inputTokens      = u.input_tokens                   || 0;
          cacheReadTokens  = u.cache_read_input_tokens        || 0;
          cacheWriteTokens = u.cache_creation_input_tokens    || 0;
        }

        // Tool use via streaming — acumular input JSON delta por delta
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          if (!window._streamToolBuffer) window._streamToolBuffer = [];
          window._streamToolBuffer.push({ name: evt.content_block.name, inputRaw: '' });
        }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'input_json_delta') {
          const buf = window._streamToolBuffer;
          if (buf?.length) buf[buf.length - 1].inputRaw += evt.delta.partial_json || '';
        }
        if (evt.type === 'message_stop' && window._streamToolBuffer?.length) {
          window._streamToolCalls = window._streamToolBuffer.map(t => {
            let input = {};
            try { input = JSON.parse(t.inputRaw || '{}'); } catch {}
            return { function: { name: t.name, arguments: JSON.stringify(input) } };
          });
          window._streamToolBuffer = [];
        }
      }
    }

    onDone({ text: responseText, thinking: thinkingText, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

  } catch(e) {
    onError({ error: e.message }, 0);
  }
}

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
      // Título provisório imediato — será substituído pelo haiku em background
      currentChat.title = (text || 'Análise de arquivos fiscais').substring(0, 50) +
        ((text || '').length > 50 ? '...' : '');
      await saveChat();
      // Gerar título descritivo via haiku em background (não bloqueia o envio)
      _gerarTituloChat(text || 'Análise de arquivos fiscais').catch(() => {});
    }

    // Atualizar contador de mensagens do dia no header
    _atualizarContadorMensagens();

    // CRIAR CONTEXTO DOS ARQUIVOS (TODOS OS ARQUIVOS DA CONVERSA)
    const fileContext = createFileContext();

    // ── Envio via AI_PROVIDER (Groq ou Anthropic) ───────────
    const provider   = (typeof AI_PROVIDER !== 'undefined') ? AI_PROVIDER : null;

    // Ativar citations automaticamente se há documentos anexados
    if (currentFiles.some(f => f.content && !f.type?.startsWith('image/'))) {
      provider?.ativarCitations?.(true);
    }

    // Indicador visual de busca de dados
    function setDbIndicator(msg) {
      const el = document.getElementById('dbIndicator');
      if (el) { el.textContent = msg; el.style.display = msg ? 'flex' : 'none'; }
    }

    showTypingIndicator();
    setDbIndicator('🔍 Consultando base de conhecimento...');

    // Buscar contexto RAG — aguardar antes de montar o prompt
    const [ragInteracoes, ragDocumentos] = await Promise.all([
      getLearningService().buscarContextoRAG(text || '').catch(() => null),
      getLearningService().buscarDocumentosRAG(text || '', currentChat.id).catch(() => null)
    ]);

    setDbIndicator('');

    // Consultar CNPJ se detectado na mensagem
    let cnpjCtx = '';
    const cnpjDetectado = text ? extrairCNPJ(text) : null;
    if (cnpjDetectado) {
      setDbIndicator('🏢 Consultando CNPJ na Receita Federal...');
      addMessage('Consultando CNPJ na Receita Federal...', false, 'low');
      const dadosCNPJ = await consultarCNPJ(cnpjDetectado);
      const formatado = formatarDadosCNPJ(dadosCNPJ);
      if (formatado) {
        cnpjCtx = `

${formatado}`;
        const msgs = document.getElementById('msgs');
        const ultimo = msgs.querySelector('.msg-row:last-child');
        if (ultimo) ultimo.remove();
      }
      setDbIndicator('');
    }

    // Contexto rico da empresa — dados reais do banco (DARFs, financeiro, pessoal, agenda)
    const clienteCtx = (typeof EmpresaContext !== 'undefined' && currentCliente)
      ? '\n\n' + await EmpresaContext.obterContexto(currentCliente, currentUser.id)
      : currentCliente
        ? `\n\nEMPRESA ATIVA: ${currentCliente.razao_social} (CNPJ: ${currentCliente.cnpj}) — Regime: ${currentCliente.regime_tributario}`
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
- DIRPF (Pessoa Física): 15/03 a 30/05/2026
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

    // Resumo automático: se conversa longa, comprimir mensagens antigas via haiku
    let historicoBase = currentChat.messages;
    if (historicoBase.length > 20 && !historicoBase[0]?._resumo) {
      const antigas   = historicoBase.slice(0, -10);
      const recentes  = historicoBase.slice(-10);

      // Tentar gerar resumo via haiku (assíncrono mas awaited aqui — necessário antes do envio)
      let resumoTexto = null;
      try {
        const blocoParaResumir = antigas.map(m =>
          `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${(m.content || '').substring(0, 600)}`
        ).join('\n');

        const rRes = await fetch('/api/chat-anthropic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
          body: JSON.stringify({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 400,
            stream:     false,
            messages: [{
              role:    'user',
              content: `Faça um resumo conciso (máx 350 palavras) dos pontos fiscais/tributários discutidos nesta conversa. Preserve valores, datas, cálculos e decisões importantes:\n\n${blocoParaResumir}`,
            }],
          }),
        });
        if (rRes.ok) {
          const rData = await rRes.json();
          resumoTexto = rData?.content?.[0]?.text?.trim() || null;
        }
      } catch { /* usa fallback */ }

      // Fallback se haiku falhou
      if (!resumoTexto) {
        resumoTexto = antigas.map(m =>
          `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${(m.content || '').substring(0, 400)}`
        ).join('\n');
      }

      historicoBase = [
        { role: 'user', content: `[Resumo do histórico anterior desta conversa:]\n${resumoTexto}`, _resumo: true },
        ...recentes,
      ];
    }

    // Preparar mensagens (últimas 10 + possível resumo)
    const recentChatMessages = historicoBase.slice(-12).map(m => ({
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

    // ── Continua envio via AI_PROVIDER ───────────────────────
    const modelList  = provider ? provider.getModels() : MODELS;
    const endpoint   = provider ? provider.getEndpoint() : '/api/chat';
    const tools      = (_modoFocado || typeof CHAT_TOOLS === 'undefined') ? undefined : CHAT_TOOLS;

    let data = null;
    let attempts = 0;
    let consecutiveErrors = 0;
    let model = modelList[currentModelIndex % modelList.length];
    const maxAttempts = modelList.length * 2;

    while (attempts < maxAttempts && !data) {
      model = modelList[currentModelIndex % modelList.length];

      try {
        // Detectar se deve usar thinking antes de montar o body
        const useThinking = provider?.current === 'anthropic' &&
          typeof AI_PROVIDER?.deveUsarThinking === 'function' &&
          AI_PROVIDER.deveUsarThinking(text || '');
        if (useThinking) {
          AI_PROVIDER.ativarThinking(true);
          showThinkingIndicator();
        }

        const body = provider
          ? provider.montarBody(model, messagesToSend, tools, currentFiles)
          : { model, temperature: 0.7, max_tokens: 4000, messages: messagesToSend };

        if (useThinking) AI_PROVIDER.ativarThinking(false);

        // ── Streaming ────────────────────────────────────────
        window._streamToolCalls = null;  // limpar antes de cada chamada
        window._streamToolBuffer = [];        // limpar buffer de tools
        const bodyParaEnvio = body;

        let streamDone = false;
        let streamText = '';
        let streamThinking = '';
        let streamTokens  = { input: 0, output: 0 };
        let msgBubble = null;  // elemento DOM da bolha em construção

        await new Promise((resolve, reject) => {
          streamResposta(
            endpoint, bodyParaEnvio,
            // onChunk — atualizar bolha em tempo real
            (text) => {
              streamText = text;
              if (!msgBubble) {
                hideTypingIndicator();
                hideThinkingIndicator();
                msgBubble = addMessageStreaming(false);
              }
              updateStreamBubble(msgBubble, text);
            },
            // onThinking — mostrar raciocínio parcial
            (thinking) => {
              streamThinking = thinking;
              updateThinkingIndicator(thinking);
            },
            // onDone
            (result) => {
              streamText    = result.text;
              streamThinking= result.thinking || '';
              streamTokens  = {
                input:       result.inputTokens       || 0,
                output:      result.outputTokens      || 0,
                cacheRead:   result.cacheReadTokens   || 0,
                cacheWrite:  result.cacheWriteTokens  || 0,
              };
              if (result.toolCalls) window._streamToolCalls = result.toolCalls;
              hideTypingIndicator();
              hideThinkingIndicator();
              streamDone = true;
              resolve();
            },
            // onError
            (err, status) => {
              console.error('[Chat API Error]', status, err);
              if (status === 429) {
                reject(new Error(err.error === 'limite_diario'
                  ? 'Limite diário de mensagens atingido.'
                  : 'Rate limit. Aguarde 60 segundos.'));
              } else if (status === 400) {
                // Erro de request — não tentar de novo
                reject(new Error('Erro na requisição: ' + (err.error?.message || JSON.stringify(err).substring(0, 100))));
              } else {
                reject(new Error((err.error?.message || err.error || 'Erro na API') + (status ? ' (HTTP ' + status + ')' : '')));
              }
            }
          );
        });

        // Montar data compatível com o restante do fluxo
        data = {
          _streaming: true,
          _text:      streamText,
          _thinking:  streamThinking,
          _tokens:    streamTokens,
          content:    [{ type: 'text', text: streamText }],
          _bubble:    msgBubble,
        };
        consecutiveErrors = 0;

      } catch (error) {
        consecutiveErrors++;
        if (consecutiveErrors >= 2) { currentModelIndex++; consecutiveErrors = 0; }
        attempts++;
        if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 2000));
        else throw error;
      }
    }

    // Fallback para Groq se Anthropic falhar completamente
    if (!data && provider?.current === 'anthropic') {
      console.warn('Anthropic falhou — tentando Groq como fallback');
      const groqRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.7, max_tokens: 4000,
          messages: messagesToSend,
        }),
      });
      if (groqRes.ok) {
        data = await groqRes.json();
        // Normalizar manualmente como Groq
        const msg = data?.choices?.[0]?.message || {};
        const normalized = { text: msg.content || '', toolCalls: msg.tool_calls || null, usage: data.usage?.total_tokens || 0, model: 'llama-3.3-70b-versatile (fallback)' };
        hideTypingIndicator();
        const reply = normalized.text;
        const confidence = calculateConfidence(reply);
        currentChat.messages.push({ role: 'assistant', content: reply, confidence });
        addMessage(reply, false, confidence, null, null, null, normalized.model);
        showToast('Anthropic indisponível — resposta via Groq', 'warn');
        return;
      }
    }

    if (!data) throw new Error('Não foi possível obter resposta após múltiplas tentativas');

    hideTypingIndicator();
    hideThinkingIndicator();

    // ── Normalizar resposta (Groq ou Anthropic) ──────────
    // Se veio por streaming, data._streaming está setado
    const normalized = data._streaming ? {
      text:      data._text || '',
      toolCalls: window._streamToolCalls || null,
      usage:     (data._tokens?.input || 0) + (data._tokens?.output || 0),
      model,
      _bubble:   data._bubble,
      _tokens:   data._tokens,
    } : provider ? provider.normalizarResposta(data) : {
      text: data.choices?.[0]?.message?.content || '',
      toolCalls: data.choices?.[0]?.message?.tool_calls || null,
      usage: data.usage?.total_tokens || 0,
      model,
    };
    const { text: replyText, toolCalls } = normalized;

    // ── Tool use: executar ações e fechar o loop com a API ───
    let toolCardsHtml = '';
    let toolMsgsTexto = '';
    let replyTextoFinal = replyText; // pode ser atualizado após o loop de tools

    if (toolCalls?.length && typeof processarToolCalls === 'function') {
      const resultados = await processarToolCalls(toolCalls);
      toolCardsHtml = renderToolCard(resultados);
      toolMsgsTexto = resultados.map(r => r.msg).join(' ');
      if (window.lucide) setTimeout(() => lucide.createIcons(), 100);

      // ── Fechar loop com Anthropic: enviar tool_result e obter resposta final ──
      // Protocolo: assistant(tool_use) → user(tool_result) → assistant(texto final)
      if (provider?.current === 'anthropic') {
        try {
          // 1. Montar bloco assistant com os tool_use originais
          const toolUseBlocks = toolCalls.map(tc => {
            let input = {};
            try { input = JSON.parse(tc.function?.arguments || '{}'); } catch {}
            return { type: 'tool_use', id: tc.id || `tool_${tc.function?.name}`, name: tc.function?.name, input };
          });

          // 2. Montar bloco user com tool_result de cada execução
          const toolResultBlocks = resultados.map((r, i) => ({
            type: 'tool_result',
            tool_use_id: toolCalls[i]?.id || `tool_${toolCalls[i]?.function?.name}`,
            content: r.ok ? r.msg : `Erro: ${r.msg}`,
          }));

          // 3. Montar mensagens com o histórico + tool_use + tool_result
          const msgsComToolResult = [
            ...messagesToSend.filter(m => m.role !== 'system'),
            { role: 'assistant', content: replyText ? [{ type: 'text', text: replyText }, ...toolUseBlocks] : toolUseBlocks },
            { role: 'user',      content: toolResultBlocks },
          ];

          // 4. Chamar API novamente para obter o texto conclusivo
          showTypingIndicator();
          const bodyFinal = provider.montarBody(model, [
            ...messagesToSend.filter(m => m.role === 'system'),
            ...msgsComToolResult,
          ], undefined, []); // sem tools na segunda chamada — só texto

          const respostaFinal = await new Promise((res, rej) => {
            let textoAcumulado = '';
            let bolhaFinal = null;
            streamResposta(
              endpoint, bodyFinal,
              (chunk) => {
                textoAcumulado = chunk;
                if (!bolhaFinal) {
                  hideTypingIndicator();
                  bolhaFinal = addMessageStreaming(false);
                }
                updateStreamBubble(bolhaFinal, chunk);
              },
              null,
              (result) => res({ text: result.text || textoAcumulado, bubble: bolhaFinal }),
              (err) => { hideTypingIndicator(); rej(new Error(err.error || 'Erro na resposta final')); }
            );
          });

          if (respostaFinal.text) replyTextoFinal = respostaFinal.text;
          // Finalizar bolha da resposta final se veio por streaming
          if (respostaFinal.bubble) {
            respostaFinal.bubble.classList.remove('streaming');
            respostaFinal.bubble.querySelector('.bubble').innerHTML = formatTextWithLinks(replyTextoFinal);
          }
        } catch (toolLoopErr) {
          console.warn('[tool loop] Falha ao fechar ciclo com Anthropic:', toolLoopErr.message);
          // Não bloquear — o toolCard já foi renderizado
        }
      }
    }

    const reply = replyTextoFinal + (toolMsgsTexto && !replyTextoFinal ? toolMsgsTexto : '');
    const replyFinal = toolCardsHtml
      ? `<div class="tool-cards-wrap">${toolCardsHtml}</div>${reply ? '<div class="tool-text-reply">' + reply + '</div>' : ''}`
      : reply;
    const confidence = calculateConfidence(reply || toolMsgsTexto);

    // Registrar interação
    let interacaoId = null;
    try {
      interacaoId = await getLearningService().registrarInteracao(
        currentChat.id,
        text || 'Arquivos enviados',
        reply || toolMsgsTexto,
        normalized.usage || 0,
        normalized.model || modelList[currentModelIndex % modelList.length]
      );
    } catch (e) {}

    const assistantMessage = {
      role: 'assistant',
      content: replyTextoFinal || '',  // texto final após loop de tool_result
      confidence,
      interactionId: interacaoId
    };

    currentChat.messages.push(assistantMessage);

    // Se veio por streaming com bolha já criada, finalizar ela
    // Se não há bolha (resposta JSON sem chunks), usar addMessage normal
    if (data._streaming && data._bubble) {
      const hasValidInteraction = interacaoId && String(interacaoId).trim() !== '' && !String(interacaoId).includes('error');
      const footer = `
        <div class="mfoot">
          <button class="btn-copy" onclick="copyMessage(this)">
            <i data-lucide="copy" style="width:12px;height:12px"></i> Copiar
          </button>
          <button class="btn-feedback" id="feedback-btn-${interacaoId || 'temp'}"
            ${hasValidInteraction ? `onclick="mostrarFeedbackOptions('${interacaoId}')"` : 'disabled style="opacity:0.4;cursor:not-allowed"'}
            title="${hasValidInteraction ? 'Avaliar resposta' : 'Feedback disponível apenas para respostas novas'}">
            <i data-lucide="thumbs-up" style="width:12px;height:12px"></i> Feedback
          </button>

          <span class="badge-model" title="Modelo utilizado">✦ Claude</span>
          ${data._tokens ? `<span class="badge-tokens" title="Tokens usados">${(data._tokens.input||0)+(data._tokens.output||0)} tok</span>` : ''}
        </div>`;
      finalizeStreamBubble(data._bubble, toolCardsHtml
        ? `<div class="tool-cards-wrap">${toolCardsHtml}</div>${replyTextoFinal ? '<div class="tool-text-reply">' + replyTextoFinal + '</div>' : ''}`
        : replyTextoFinal, footer);
      if (data._tokens) updateTokenCounter(data._tokens.input, data._tokens.output, data._tokens.cacheRead, data._tokens.cacheWrite);
    } else {
      // Sem bolha de streaming — addMessage com texto puro + toolCards em seguida
      addMessage(replyTextoFinal || toolMsgsTexto || '...', false, confidence, null, interacaoId, null, normalized.model);
      if (toolCardsHtml) {
        const msgs = document.getElementById('msgs');
        const lastBubble = msgs.querySelector('.msg:last-child .bubble');
        if (lastBubble) {
          const toolDiv = document.createElement('div');
          toolDiv.className = 'tool-cards-wrap';
          toolDiv.innerHTML = toolCardsHtml;
          lastBubble.insertBefore(toolDiv, lastBubble.firstChild);
        }
      }
    }

    if (interacaoId) {
      setTimeout(() => {
        mostrarFeedbackOptions(interacaoId);
      }, 1500);
    }

    // Respostas sugeridas contextuais
    setTimeout(() => mostrarSugestoes(replyText), 800);

    saveChat();
    inp.value = '';

  } catch (e) {
    hideTypingIndicator();
    
    let errorMessage = '';
    
    console.error('[send() error]', e.message, e);
    if (e.message.includes('429') || e.message.includes('rate limit') || e.message.includes('limite_diario')) {
      errorMessage = 'Limite de requisições excedido. Aguarde 60 segundos e tente novamente.';
      rateLimitUntil = Date.now() + 60000;
    } else if (e.message.includes('401') || e.message.includes('authentication')) {
      errorMessage = 'Erro de autenticação com a API. Verifique a chave da Anthropic.';
    } else if (e.message.includes('invalid_request') || e.message.includes('400')) {
      errorMessage = 'Erro na requisição: ' + e.message;
    } else {
      // Mostrar erro real para diagnóstico
      errorMessage = 'Erro: ' + (e.message || 'desconhecido');
    }
    
    addMessage(errorMessage, false, 'low');
    
  } finally {
    document.getElementById('sendBtn').disabled = false;
    inp.disabled = false;
    inp.focus();
  }
}

// ── Sugestões contextuais após resposta ──────────────────────
// ── Título automático via claude-haiku ───────────────────────
async function _gerarTituloChat(primeiraPergunta) {
  if (!currentChat.id) return;
  try {
    const res = await fetch('/api/chat-anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 30,
        stream: false,
        messages: [{
          role: 'user',
          content: `Gere um título de até 6 palavras em português para esta conversa fiscal. Responda APENAS o título, sem pontuação final.\n\nPergunta: ${primeiraPergunta.substring(0, 300)}`
        }]
      }),
    });
    if (!res.ok) return;
    const data  = await res.json();
    const titulo = data?.content?.[0]?.text?.trim();
    if (!titulo || titulo.length < 3) return;

    currentChat.title = titulo.substring(0, 60);
    await sb.from('chats').update({ title: currentChat.title }).eq('id', currentChat.id);

    // Atualizar na sidebar sem re-query
    const item = allChats.find(c => c.id === currentChat.id);
    if (item) { item.title = currentChat.title; renderHistoryList(allChats, false); }
  } catch { /* silencioso — título provisório permanece */ }
}

// ── Contador de mensagens do dia no header ────────────────────
let _usoDiarioCached = 0;

async function _atualizarContadorMensagens() {
  try {
    const res = await fetch('/api/chat-anthropic', {
      method: 'HEAD',
      headers: { 'x-user-id': currentUser?.id || '' },
    }).catch(() => null);

    // O header X-Requests-Today é retornado na última chamada real
    // Incrementar otimisticamente no contador local
    _usoDiarioCached = Math.min(_usoDiarioCached + 1, 50);
    _renderContadorMensagens(_usoDiarioCached);
  } catch { /* silencioso */ }
}

function _renderContadorMensagens(count) {
  let el = document.getElementById('msgCounterBadge');
  if (!el) {
    const header = document.querySelector('.chat-input-area') || document.getElementById('inputArea');
    if (!header) return;
    el = document.createElement('span');
    el.id = 'msgCounterBadge';
    el.style.cssText = 'font-size:11px;color:var(--text-light);padding:2px 6px;border-radius:8px;background:var(--sidebar-hover);margin-left:8px;white-space:nowrap';
    header.appendChild(el);
  }
  const restante = Math.max(0, 50 - count);
  el.textContent  = `${count}/50 hoje`;
  el.style.color  = restante <= 5 ? '#dc2626' : restante <= 15 ? '#d97706' : 'var(--text-light)';
  el.title        = `${restante} mensagem(ns) restante(s) hoje`;
}

async function mostrarSugestoes(textoResposta) {
  document.getElementById('sugestoes-wrap')?.remove();
  if (!textoResposta || textoResposta.length < 50) return;

  try {
    const res = await fetch('/api/chat-anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 120, stream: false,
        messages: [{ role: 'user',
          content: `Com base nesta resposta fiscal, gere exatamente 3 perguntas de follow-up curtas e relevantes. Responda APENAS as 3 perguntas, uma por linha, sem numeração.

Resposta: ${textoResposta.substring(0, 500)}` }],
      }),
    });
    if (!res.ok) throw new Error('haiku falhou');
    const data     = await res.json();
    const textoRaw = data?.content?.[0]?.text?.trim() || '';
    const sugestoes = textoRaw.split('\n').map(s => s.trim()).filter(s => s.length > 8).slice(0, 3);
    if (!sugestoes.length) throw new Error('sem sugestões');
    _renderSugestoes(sugestoes);
  } catch {
    _renderSugestoesFallback(textoResposta);
  }
}

function _renderSugestoes(sugestoes) {
  document.getElementById('sugestoes-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'sugestoes-wrap';
  wrap.style.cssText = 'padding:8px 16px 4px;display:flex;flex-wrap:wrap;gap:6px;';
  wrap.innerHTML = sugestoes.map(s => `
    <button onclick="useTemplate('${s.replace(/'/g, "\'")}');document.getElementById('sugestoes-wrap')?.remove()"
      style="padding:6px 12px;font-size:12px;border:1px solid var(--border);border-radius:16px;background:var(--sidebar-hover);color:var(--text);cursor:pointer;transition:.15s;text-align:left"
      onmouseover="this.style.background='var(--accent)';this.style.color='#fff';this.style.borderColor='var(--accent)'"
      onmouseout="this.style.background='var(--sidebar-hover)';this.style.color='var(--text)';this.style.borderColor='var(--border)'">
      ${escapeHtml(s)}
    </button>`).join('');
  document.getElementById('msgs').appendChild(wrap);
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
}

function _renderSugestoesFallback(textoResposta) {
  const t = textoResposta.toLowerCase();
  const mapa = [
    { termos: ['simples nacional','das ','pgdas','anexo'],
      perguntas: ['Qual a alíquota efetiva do Simples este mês?','Como calcular o Fator R?','Quando vence o DAS?'] },
    { termos: ['icms','substituição tributária','difal'],
      perguntas: ['Como apurar o ICMS-ST?','Quais CFOPs usar para operações interestaduais?','O que é DIFAL?'] },
    { termos: ['irpj','csll','lucro presumido','lucro real'],
      perguntas: ['Qual a diferença entre Lucro Real e Presumido?','Como calcular o adicional de IRPJ?','Quando é obrigatório o Lucro Real?'] },
    { termos: ['darf','vencimento','multa'],
      perguntas: ['Como emitir o DARF no portal?','Como calcular juros e multa por atraso?','Posso parcelar este débito?'] },
    { termos: ['sped','efd','ecd','ecf'],
      perguntas: ['Quais registros do SPED devo validar?','Como corrigir um SPED após entrega?','Qual o prazo para retificação?'] },
    { termos: ['folha','rescisão','inss','fgts'],
      perguntas: ['Como calcular a rescisão sem justa causa?','Qual a alíquota de INSS sobre pró-labore?','Como calcular férias proporcionais?'] },
    { termos: ['reforma tributária','cbs','ibs'],
      perguntas: ['Quando começa a cobrança efetiva do IBS/CBS?','Preciso destacar CBS na NF-e agora?','Como a Reforma impacta o Simples Nacional?'] },
  ];
  let sugestoes = ['Pode detalhar mais?','Quais são as multas por descumprimento?','Como isso se aplica ao meu regime?'];
  for (const { termos, perguntas } of mapa) {
    if (termos.some(term => t.includes(term))) { sugestoes = perguntas; break; }
  }
  _renderSugestoes(sugestoes);
}

async function handleMultipleFiles(event) {
  const files = Array.from(event.target.files);
  const MAX_SIZE = 20 * 1024 * 1024; // 20MB

  for (const file of files) {
    if (file.size > MAX_SIZE) {
      showToast(`${file.name}: arquivo muito grande. Máx: 10MB`, 'warn');
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
  const regime = currentCliente?.regime_tributario || '';
  const isMEI          = /mei/i.test(regime);
  const isSimples      = /simples/i.test(regime);
  const isSimplesOuMEI = isMEI || isSimples;
  const isLucro        = /lucro/i.test(regime);
  const temEmpregado   = currentCliente?.tem_empregado === true;
  const alerts = [];

  for (const [key, deadline] of Object.entries(fiscalDeadlines)) {
    if (deadline.meiOnly      && !isMEI)          continue; // DASN-SIMEI: só MEI
    if (deadline.simplesOuMei && !isSimplesOuMEI) continue; // DAS/DEFIS: só Simples/MEI
    if (deadline.naoSimples   && isSimplesOuMEI)  continue; // EFD-Contrib/SPED/DCTF: não Simples/MEI
    if (deadline.comEmpregado && !temEmpregado)   continue; // eSocial/EFD-Reinf/DCTFWeb: só com empregado

    let daysUntil;
    let thresholdDays;

    if (deadline.month === 'monthly') {
      // Obrigação mensal — janela de 7 dias
      thresholdDays = 7;
      const nextDeadline = new Date(today.getFullYear(), today.getMonth(), deadline.day);
      if (nextDeadline < today) nextDeadline.setMonth(nextDeadline.getMonth() + 1);
      daysUntil = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));
    } else {
      // Obrigação anual — janela de 30 dias
      thresholdDays = 30;
      const nextDeadline = new Date(today.getFullYear(), deadline.month - 1, deadline.day);
      if (nextDeadline < today) nextDeadline.setFullYear(nextDeadline.getFullYear() + 1);
      daysUntil = Math.ceil((nextDeadline - today) / (1000 * 60 * 60 * 24));
    }

    if (daysUntil >= 0 && daysUntil <= thresholdDays) {
      alerts.push({
        message: `${deadline.description} em ${daysUntil} dia(s)`,
        severity: daysUntil <= 2 ? 'high' : 'medium'
      });
    }
  }

  const alertDiv = document.getElementById('deadlineAlerts');
  if (!alertDiv) return;
  if (!alerts.length) { alertDiv.innerHTML = ''; return; }

  const hasHigh   = alerts.some(a => a.severity === 'high');
  const bannerCls = hasHigh ? 'high' : 'medium';
  const count     = alerts.length;
  const label     = hasHigh
    ? `${alerts.filter(a=>a.severity==='high').length} prazo(s) crítico(s)`
    : `${count} prazo(s) próximo(s)`;

  alertDiv.innerHTML = `
    <div class="deadline-banner ${bannerCls}" onclick="toggleDeadlineDetail(this)">
      <i data-lucide="${hasHigh ? 'alert-circle' : 'clock'}" style="width:14px;height:14px;flex-shrink:0"></i>
      <div class="deadline-banner-tags">
        ${alerts.slice(0,3).map(a =>
          `<span class="deadline-tag ${a.severity}">${a.message}</span>`
        ).join('')}
        ${count > 3 ? `<span class="deadline-tag medium">+${count-3} mais</span>` : ''}
      </div>
      <i data-lucide="chevron-down" class="deadline-expand" style="width:13px;height:13px"></i>
    </div>
    <div class="deadline-detail" id="deadlineDetailPanel">
      <div class="deadline-detail-inner">
        ${alerts.map(a => `
          <div class="deadline-row">
            <div class="deadline-dot" style="background:${a.severity==='high'?'#dc2626':'#f59e0b'}"></div>
            <span style="flex:1">${a.message}</span>
            ${a.severity==='high' ? '<span style="font-size:10px;font-weight:700;color:#dc2626">URGENTE</span>' : ''}
          </div>`).join('')}
      </div>
    </div>`;
  lucide.createIcons();

  // Atualizar badge no botão da agenda
  const badge = document.getElementById('agendaBadgeCount');
  if (badge) {
    if (alerts.length > 0) {
      badge.textContent = alerts.length > 9 ? '9+' : alerts.length;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}




function toggleDeadlineDetail(banner) {
  const panel   = document.getElementById('deadlineDetailPanel');
  const chevron = banner.querySelector('.deadline-expand');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open', open);
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







// ── Atalhos de prompt via / ──────────────────────────────────
const SLASH_COMMANDS = {
  '/darf':   'Calcule o DARF de IRPJ/CSLL para este trimestre. Informe os percentuais e o valor a recolher.',
  '/sped':   'Analise o SPED Fiscal e verifique os registros C100, E110 e totalização por CFOP.',
  '/folha':  'Abra o módulo de folha de pagamento e exiba o resumo do mês atual.',
  '/agenda': 'Quais obrigações fiscais vencem nos próximos 7 dias?',
  '/simples': 'Calcule a alíquota efetiva do Simples Nacional e sugira o anexo mais adequado.',
  '/icms':   'Explique as regras de ICMS-ST para operações interestaduais do meu estado.',
  '/reforma': 'Resuma os impactos da Reforma Tributária (CBS/IBS) para minha empresa em 2026.',
};

(function iniciarSlashCommands() {
  const input = document.getElementById('msgInput');
  if (!input) return;

  let popup = null;

  function fecharPopup() {
    popup?.remove();
    popup = null;
  }

  input.addEventListener('input', () => {
    const v = input.value;
    if (!v.startsWith('/')) { fecharPopup(); return; }

    const matches = Object.entries(SLASH_COMMANDS).filter(([cmd]) =>
      cmd.startsWith(v.toLowerCase())
    );

    fecharPopup();
    if (!matches.length) return;

    popup = document.createElement('div');
    popup.id = 'slashPopup';
    popup.style.cssText = `
      position:absolute;bottom:calc(100% + 8px);left:0;right:0;
      background:var(--sidebar);border:1px solid var(--border);
      border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);
      overflow:hidden;z-index:100;max-height:220px;overflow-y:auto
    `;
    popup.innerHTML = matches.map(([cmd, texto]) => `
      <div class="slash-item" onclick="aplicarSlash('${cmd}')"
           style="padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border)">
        <code style="font-size:12px;color:var(--accent);min-width:70px">${cmd}</code>
        <span style="font-size:12px;color:var(--text-light)">${texto.substring(0, 60)}…</span>
      </div>`).join('');

    // Posicionar relativo ao container do input
    const wrap = input.closest('form, .input-wrap, .chat-input, div') || document.body;
    wrap.style.position = 'relative';
    wrap.appendChild(popup);
  });

  input.addEventListener('keydown', (e) => {
    if (!popup) return;
    if (e.key === 'Escape') { fecharPopup(); return; }
    if (e.key === 'Tab' || e.key === 'Enter') {
      const first = popup.querySelector('.slash-item');
      if (first) { e.preventDefault(); first.click(); }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#slashPopup') && !e.target.closest('#msgInput')) fecharPopup();
  });
})();

function aplicarSlash(cmd) {
  const texto = SLASH_COMMANDS[cmd];
  if (!texto) return;
  const input = document.getElementById('msgInput');
  input.value = texto;
  input.focus();
  document.getElementById('slashPopup')?.remove();
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
