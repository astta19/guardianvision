// ============================================================
// FISCAL.JS — NF-e, DARF, Prazos
// ============================================================

    // ============================================
    // MÓDULO DOCUMENTOS FISCAIS
    // ============================================

    let darfData = null; // resultado do cálculo DARF


    // ---- CONFERÊNCIA NF-e ----

    const CFOP_VALIDO = {
      entrada: ['1','2','3'],
      saida: ['5','6','7']
    };

    const CST_ICMS_SIMPLES = ['101','102','103','201','202','203','300','400','500','900'];
    const CST_ICMS_NORMAL = ['00','10','20','30','40','41','50','51','60','70','90'];

    function validarNFe(nf) {
      const issues = [];
      const regime = currentCliente?.regime_tributario || '';
      const isSimples = regime.includes('Simples') || regime === 'MEI';

      // 1. CFOP x tipo de operação
      const cfop = nf.cfop || '';
      const tipoNF = nf.tipo; // '0' = entrada, '1' = saída
      if (tipoNF === '0' && !CFOP_VALIDO.entrada.includes(cfop[0])) {
        issues.push({ nivel: 'error', msg: `CFOP ${cfop} inválido para NF de entrada (deve começar com 1, 2 ou 3)` });
      }
      if (tipoNF === '1' && !CFOP_VALIDO.saida.includes(cfop[0])) {
        issues.push({ nivel: 'error', msg: `CFOP ${cfop} inválido para NF de saída (deve começar com 5, 6 ou 7)` });
      }

      // 2. CST x Regime
      const cst = nf.cst || nf.csosn || '';
      if (isSimples && CST_ICMS_NORMAL.includes(cst)) {
        issues.push({ nivel: 'warn', msg: `CST ${cst} é de regime normal. Empresa no Simples deve usar CSOSN (1xx, 2xx, 3xx, 4xx, 5xx, 9xx)` });
      }
      if (!isSimples && CST_ICMS_SIMPLES.includes(cst)) {
        issues.push({ nivel: 'warn', msg: `CSOSN ${cst} é do Simples Nacional. Regime ${regime} deve usar CST (00-90)` });
      }

      // 3. Validar base de cálculo x valor ICMS
      if (nf.vBC && nf.vICMS && nf.pICMS) {
        const esperado = parseFloat(nf.vBC) * parseFloat(nf.pICMS) / 100;
        const declarado = parseFloat(nf.vICMS);
        if (Math.abs(esperado - declarado) > 0.02) {
          issues.push({ nivel: 'error', msg: `ICMS divergente: BC R$${nf.vBC} x ${nf.pICMS}% = R$${esperado.toFixed(2)}, declarado R$${declarado.toFixed(2)}` });
        }
      }

      // 4. Validar PIS/COFINS (Lucro Presumido/Real)
      if (!isSimples && nf.vPIS && nf.vBCPIS && nf.pPIS) {
        const esperado = parseFloat(nf.vBCPIS) * parseFloat(nf.pPIS) / 100;
        const declarado = parseFloat(nf.vPIS);
        if (Math.abs(esperado - declarado) > 0.02) {
          issues.push({ nivel: 'warn', msg: `PIS divergente: BC R$${nf.vBCPIS} x ${nf.pPIS}% = R$${esperado.toFixed(2)}, declarado R$${declarado.toFixed(2)}` });
        }
      }

      // 5. Verificar chave de acesso (44 dígitos)
      if (nf.chave && nf.chave.replace(/\D/g, '').length !== 44) {
        issues.push({ nivel: 'error', msg: `Chave de acesso inválida: ${nf.chave.replace(/\D/g,'').length} dígitos (esperado 44)` });
      }

      // 6. Data de emissão
      if (nf.dhEmi) {
        const emissao = new Date(nf.dhEmi);
        const hoje = new Date();
        const diasDif = (hoje - emissao) / (1000*60*60*24);
        if (diasDif > 365) {
          issues.push({ nivel: 'warn', msg: `NF emitida há ${Math.floor(diasDif)} dias — verificar prazo para lançamento` });
        }
      }

      const nivel = issues.some(i => i.nivel === 'error') ? 'error'
                  : issues.some(i => i.nivel === 'warn') ? 'warn' : 'ok';

      return { issues, nivel };
    }

    function parseXMLNFe(xml, nomeArquivo) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        const g = (tag) => doc.getElementsByTagName(tag)[0]?.textContent || '';

        // Dados do item (pegar o primeiro det para validação de CST/CFOP)
        const det = doc.getElementsByTagName('det')[0];
        const imposto = det?.getElementsByTagName('ICMS')[0];
        const icmsEl = imposto?.children[0]; // ICMSxx
        const pisEl = det?.getElementsByTagName('PISAliq')[0] || det?.getElementsByTagName('PISOutr')[0];
        const cofinsEl = det?.getElementsByTagName('COFINSAliq')[0] || det?.getElementsByTagName('COFINSOutr')[0];

        const nf = {
          arquivo: nomeArquivo,
          chave: g('chNFe') || g('Id')?.replace('NFe',''),
          numero: g('nNF'),
          serie: g('serie'),
          tipo: g('tpNF'), // 0=entrada, 1=saída
          dhEmi: g('dhEmi'),
          emitente: g('xNome') || g('xFant'),
          cnpjEmit: g('CNPJ'),
          cfop: det?.getElementsByTagName('CFOP')[0]?.textContent || '',
          cst: icmsEl?.getElementsByTagName('CST')[0]?.textContent || '',
          csosn: icmsEl?.getElementsByTagName('CSOSN')[0]?.textContent || '',
          vNF: g('vNF'),
          vBC: icmsEl?.getElementsByTagName('vBC')[0]?.textContent || '',
          pICMS: icmsEl?.getElementsByTagName('pICMS')[0]?.textContent || '',
          vICMS: icmsEl?.getElementsByTagName('vICMS')[0]?.textContent || '',
          vBCPIS: pisEl?.getElementsByTagName('vBC')[0]?.textContent || '',
          pPIS: pisEl?.getElementsByTagName('pPIS')[0]?.textContent || '',
          vPIS: pisEl?.getElementsByTagName('vPIS')[0]?.textContent || '',
          vCOFINS: cofinsEl?.getElementsByTagName('vCOFINS')[0]?.textContent || '',
        };

        return nf;
      } catch(e) {
        return null;
      }
    }

    async function processarNFes(event) {
      const files = Array.from(event.target.files);
      if (!files.length) return;

      nfeData = [];
      const statusEl = document.getElementById('nfeStatus');
      const resultEl = document.getElementById('nfeResult');
      resultEl.innerHTML = '';
      statusEl.textContent = `Processando ${files.length} arquivo(s)...`;

      for (const file of files) {
        const xml = await file.text();
        const nf = parseXMLNFe(xml, file.name);
        if (!nf) {
          nfeData.push({ arquivo: file.name, erro: true });
          continue;
        }
        const validacao = validarNFe(nf);
        nfeData.push({ ...nf, ...validacao });
      }

      renderNFeResults();
      salvarDocumentoFiscal('nfe', { notas: nfeData });
      event.target.value = '';
    }

    function renderNFeResults() {
      const el = document.getElementById('nfeResult');
      const ok    = nfeData.filter(n => n.nivel === 'ok').length;
      const warn  = nfeData.filter(n => n.nivel === 'warn').length;
      const error = nfeData.filter(n => n.nivel === 'error').length;
      const erro  = nfeData.filter(n => n.erro).length;

      document.getElementById('nfeStatus').innerHTML =
        `${nfeData.length} NF(s) processada(s) — ` +
        `<span class="risk-ok">✅ ${ok} OK</span> · ` +
        `<span class="risk-warn">⚠️ ${warn} atenção</span> · ` +
        `<span class="risk-error">🔴 ${error} erro(s)</span>` +
        (erro ? ` · ${erro} inválido(s)` : '');

      el.innerHTML = nfeData.map(nf => {
        if (nf.erro) return `<div class="nfe-card"><span class="risk-error">❌ ${escapeHtml(nf.arquivo)} — arquivo inválido ou não é XML de NF-e</span></div>`;

        const icon = nf.nivel === 'ok' ? '✅' : nf.nivel === 'warn' ? '⚠️' : '🔴';
        const cls  = nf.nivel === 'ok' ? 'risk-ok' : nf.nivel === 'warn' ? 'risk-warn' : 'risk-error';
        const tipo = nf.tipo === '0' ? 'Entrada' : 'Saída';
        const data = nf.dhEmi ? new Date(nf.dhEmi).toLocaleDateString('pt-BR') : '—';

        let issuesHtml = '';
        if (nf.issues?.length) {
          issuesHtml = `<div class="nfe-issues">` +
            nf.issues.map(i => {
              const ic = i.nivel === 'error' ? '🔴' : '⚠️';
              return `<div class="nfe-issue"><span>${ic}</span><span>${i.msg}</span></div>`;
            }).join('') + `</div>`;
        }

        return `<div class="nfe-card">
          <div class="nfe-card-head">
            <div>
              <div class="nfe-card-title">NF-e nº ${nf.numero || '—'} · ${tipo} · ${data}</div>
              <div style="font-size:12px;color:var(--text-light)">${nf.emitente || nf.arquivo} · CNPJ: ${nf.cnpjEmit || '—'}</div>
              <div style="font-size:12px;color:var(--text-light)">CFOP: ${nf.cfop} · CST/CSOSN: ${nf.cst || nf.csosn || '—'} · Valor: R$ ${parseFloat(nf.vNF||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
            </div>
            <span class="${cls}" style="font-size:18px;flex-shrink:0">${icon}</span>
          </div>
          ${nf.vICMS ? `<div style="font-size:12px;color:var(--text-light)">ICMS: BC R$${nf.vBC} × ${nf.pICMS}% = R$${nf.vICMS}</div>` : ''}
          ${issuesHtml}
        </div>`;
      }).join('');

      document.getElementById('nfeActions').style.display = nfeData.length ? 'flex' : 'none';
      lucide.createIcons();
    }

    function enviarNFeParaChat() {
      const resumo = nfeData.map(nf => {
        if (nf.erro) return `- ${nf.arquivo}: inválido`;
        const nivel = nf.nivel === 'ok' ? '✅ OK' : nf.nivel === 'warn' ? '⚠️ Atenção' : '🔴 Erro';
        const issues = nf.issues?.map(i => `  · ${i.msg}`).join('\n') || '';
        return `- NF-e ${nf.numero} (${nf.tipo==='0'?'Entrada':'Saída'}) · ${nivel} · R$ ${parseFloat(nf.vNF||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${issues}`;
      }).join('\n');

      document.getElementById('msgInput').value =
        `Analise o resultado da conferência das NF-e abaixo e me dê um parecer fiscal completo:\n\n${resumo}`;
      closeDocumentos();
      document.getElementById('msgInput').focus();
    }

    // ---- DARF / DAS ----

    function maskCompetencia(input) {
      let v = input.value.replace(/\D/g,'');
      if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2,6);
      input.value = v;
      calcularDarf();
    }

    function atualizarCamposDarf() {
      const regime = document.getElementById('darfRegime').value;
      document.getElementById('darfFieldLucro').style.display = ['presumido','real'].includes(regime) ? 'block' : 'none';
      document.getElementById('darfFieldPro').style.display = ['presumido','real','simples'].includes(regime) ? 'grid' : 'none';

      // Preencher vencimento padrão
      const comp = document.getElementById('darfCompetencia').value;
      const venc = document.getElementById('darfVencimento');
      if (comp.match(/^\d{2}\/\d{4}$/)) {
        const [mm, aaaa] = comp.split('/');
        if (regime === 'simples' || regime === 'mei') venc.value = `${aaaa}-${mm}-20`;
        else venc.value = `${aaaa}-${String(parseInt(mm)+1).padStart(2,'0')}-30`;
      }
      calcularDarf();
    }

    function calcularJurosMulta(valor, vencimento, pagamento) {
      if (!vencimento || !pagamento) return { juros: 0, multa: 0, diasAtraso: 0 };
      const venc = new Date(vencimento);
      const pag  = new Date(pagamento);
      if (pag <= venc) return { juros: 0, multa: 0, diasAtraso: 0 };
      const diasAtraso = Math.ceil((pag - venc) / (1000*60*60*24));
      const mesesAtraso = Math.ceil(diasAtraso / 30);
      const taxaSelic = 0.01075; // Selic aproximada mensal 2026
      const juros = valor * taxaSelic * mesesAtraso;
      const multa = diasAtraso <= 30 ? valor * 0.02 : valor * 0.20;
      return { juros, multa, diasAtraso };
    }

    function calcularDarf() {
      const regime = document.getElementById('darfRegime').value;
      const fat = parseFloat(document.getElementById('darfFaturamento').value) || 0;
      const lucro = parseFloat(document.getElementById('darfLucro').value) || 0;
      const prolabore = parseFloat(document.getElementById('darfProlabore').value) || 0;
      const folha = parseFloat(document.getElementById('darfFolha').value) || 0;
      const vencimento = document.getElementById('darfVencimento').value;
      const pagamento = document.getElementById('darfPagamento').value;
      const competencia = document.getElementById('darfCompetencia').value;

      if (!regime || fat === 0) {
        document.getElementById('darfResult').className = 'darf-result';
        document.getElementById('darfActions').style.display = 'none';
        return;
      }

      let linhas = [];
      let totalPrincipal = 0;

      if (regime === 'mei') {
        const das = 76.90;
        linhas.push({ desc: 'DAS-MEI (fixo mensal)', codigo: '4328', valor: das });
        totalPrincipal = das;

      } else if (regime === 'simples') {
        // Cálculo simplificado Anexo I (comércio) como exemplo
        // Na prática depende do anexo e RBT12
        const aliquota = fat <= 180000 ? 0.04
          : fat <= 360000 ? 0.073 : fat <= 720000 ? 0.095
          : fat <= 1800000 ? 0.107 : fat <= 3600000 ? 0.143 : 0.19;
        const das = fat * aliquota;
        linhas.push({ desc: 'DAS Simples Nacional', codigo: '4128', valor: das, obs: `Faturamento R$${fat.toLocaleString('pt-BR',{minimumFractionDigits:2})} × ${(aliquota*100).toFixed(1)}%` });
        totalPrincipal = das;

      } else if (regime === 'presumido') {
        const bcIRPJ  = fat * 0.08;  // presunção comércio/indústria
        const bcCSLL  = fat * 0.12;
        const irpj    = Math.max(0, bcIRPJ * 0.15 + Math.max(0, bcIRPJ - 60000) * 0.10);
        const csll    = bcCSLL * 0.09;
        const pis     = fat * 0.0065;
        const cofins  = fat * 0.03;
        const inss    = (prolabore + folha) * 0.20;
        linhas.push({ desc: 'IRPJ (DARF 2089)', codigo: '2089', valor: irpj, obs: `BC R$${bcIRPJ.toFixed(2)} × 15%` });
        linhas.push({ desc: 'CSLL (DARF 2372)', codigo: '2372', valor: csll, obs: `BC R$${bcCSLL.toFixed(2)} × 9%` });
        linhas.push({ desc: 'PIS  (DARF 8109)', codigo: '8109', valor: pis,  obs: `Faturamento × 0,65%` });
        linhas.push({ desc: 'COFINS (DARF 2172)', codigo: '2172', valor: cofins, obs: `Faturamento × 3%` });
        if (inss > 0) linhas.push({ desc: 'INSS Patronal (GPS)', codigo: 'GPS', valor: inss, obs: `(Pró-labore + Folha) × 20%` });
        totalPrincipal = linhas.reduce((a,l) => a + l.valor, 0);

      } else if (regime === 'real') {
        const irpj   = Math.max(0, lucro * 0.15 + Math.max(0, lucro - 20000) * 0.10);
        const csll   = lucro * 0.09;
        const pis    = fat * 0.0165;
        const cofins = fat * 0.076;
        const inss   = (prolabore + folha) * 0.20;
        linhas.push({ desc: 'IRPJ (DARF 2089)', codigo: '2089', valor: irpj, obs: `Lucro R$${lucro.toFixed(2)} × 15%` });
        linhas.push({ desc: 'CSLL (DARF 2372)', codigo: '2372', valor: csll, obs: `Lucro × 9%` });
        linhas.push({ desc: 'PIS  (DARF 8109)', codigo: '8109', valor: pis,  obs: `Faturamento × 1,65% (não-cumulativo)` });
        linhas.push({ desc: 'COFINS (DARF 2172)', codigo: '2172', valor: cofins, obs: `Faturamento × 7,6% (não-cumulativo)` });
        if (inss > 0) linhas.push({ desc: 'INSS Patronal (GPS)', codigo: 'GPS', valor: inss, obs: `(Pró-labore + Folha) × 20%` });
        totalPrincipal = linhas.reduce((a,l) => a + l.valor, 0);
      }

      const { juros, multa, diasAtraso } = calcularJurosMulta(totalPrincipal, vencimento, pagamento);
      const totalFinal = totalPrincipal + juros + multa;

      const linhasHtml = linhas.map(l => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <div>
            <strong>${l.desc}</strong>
            ${l.obs ? `<div style="font-size:11px;color:var(--text-light)">${l.obs}</div>` : ''}
          </div>
          <strong>R$ ${l.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong>
        </div>`).join('');

      const atrasadoHtml = diasAtraso > 0 ? `
        <div style="margin-top:10px;padding:10px;background:#fef2f2;border-radius:8px;font-size:12px">
          <strong style="color:#dc2626">⚠️ Em atraso — ${diasAtraso} dias</strong><br>
          Multa: R$ ${multa.toLocaleString('pt-BR',{minimumFractionDigits:2})} · 
          Juros (Selic): R$ ${juros.toLocaleString('pt-BR',{minimumFractionDigits:2})}
        </div>` : '';

      document.getElementById('darfResult').innerHTML = `
        <strong style="font-size:13px">Competência ${competencia} — ${document.getElementById('darfRegime').options[document.getElementById('darfRegime').selectedIndex].text}</strong>
        <div style="margin-top:12px">${linhasHtml}</div>
        ${atrasadoHtml}
        <div class="darf-total">Total a recolher: R$ ${totalFinal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
        <div style="font-size:11px;color:var(--text-light);margin-top:8px">
          ⚠️ Valores calculados com base nas alíquotas padrão. Verifique exceções, deduções e créditos específicos da empresa antes de recolher.
        </div>`;

      document.getElementById('darfResult').className = 'darf-result show';
      document.getElementById('darfActions').style.display = 'flex';

      darfData = { regime, competencia, linhas, totalPrincipal, juros, multa, totalFinal, diasAtraso };
      salvarDocumentoFiscal('darf', darfData);
      lucide.createIcons();
    }

    function enviarDarfParaChat() {
      if (!darfData) return;
      const linhas = darfData.linhas.map(l =>
        `  · ${l.desc}: R$ ${l.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}${l.obs ? ' ('+l.obs+')' : ''}`
      ).join('\n');
      document.getElementById('msgInput').value =
        `Revise o cálculo tributário abaixo para a competência ${darfData.competencia} e verifique se há algo a ajustar:\n\n${linhas}\nTotal principal: R$ ${darfData.totalPrincipal.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${darfData.diasAtraso > 0 ? `Em atraso ${darfData.diasAtraso} dias — multa R$ ${darfData.multa.toFixed(2)} + juros R$ ${darfData.juros.toFixed(2)}\n` : ''}Total final: R$ ${darfData.totalFinal.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
      closeDocumentos();
      document.getElementById('msgInput').focus();
    }

    // ---- EXPORTS ----

    async function exportarNFePDF() {
      if (!nfeData.length) return;
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        alert('Biblioteca jsPDF não carregada. Tente exportar via Excel ou Analisar no Chat.');
        return;
      }
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(14); doc.text('Conferência de NF-e — Fiscal365', 14, y); y += 8;
      doc.setFontSize(10); doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, y); y += 10;
      nfeData.forEach(nf => {
        if (y > 270) { doc.addPage(); y = 20; }
        const nivel = nf.erro ? '❌' : nf.nivel === 'ok' ? '✅' : nf.nivel === 'warn' ? '⚠️' : '🔴';
        doc.setFontSize(11);
        doc.text(`${nivel} NF-e ${nf.numero || nf.arquivo} — R$ ${parseFloat(nf.vNF||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}`, 14, y); y += 6;
        if (nf.issues?.length) {
          nf.issues.forEach(i => {
            doc.setFontSize(9);
            const lines = doc.splitTextToSize(`  ${i.nivel === 'error' ? '🔴' : '⚠️'} ${i.msg}`, 180);
            doc.text(lines, 14, y); y += lines.length * 5;
          });
        }
        y += 4;
      });
      doc.save(`conferencia-nfe-${new Date().toISOString().split('T')[0]}.pdf`);
    }

    function exportarNFeExcel() {
      if (!nfeData.length) return;
      const rows = [['Arquivo','NF-e','Tipo','Data','Emitente','CNPJ','CFOP','CST/CSOSN','Valor NF','BC ICMS','Aliq ICMS','Valor ICMS','Status','Inconsistências']];
      nfeData.forEach(nf => {
        if (nf.erro) { rows.push([nf.arquivo,'','','','','','','','','','','','INVÁLIDO','']); return; }
        rows.push([
          nf.arquivo, nf.numero, nf.tipo==='0'?'Entrada':'Saída',
          nf.dhEmi ? new Date(nf.dhEmi).toLocaleDateString('pt-BR') : '',
          nf.emitente, nf.cnpjEmit, nf.cfop, nf.cst||nf.csosn,
          parseFloat(nf.vNF||0).toFixed(2), nf.vBC, nf.pICMS, nf.vICMS,
          nf.nivel === 'ok' ? 'OK' : nf.nivel === 'warn' ? 'ATENÇÃO' : 'ERRO',
          nf.issues?.map(i => i.msg).join(' | ') || ''
        ]);
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Conferência NF-e');
      XLSX.writeFile(wb, `conferencia-nfe-${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    async function exportarDarfPDF() {
      if (!darfData) return;
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) { alert('Biblioteca jsPDF não disponível. Use Analisar no Chat para registrar o cálculo.'); return; }
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(16); doc.text('Documento de Referência — DARF/DAS', 14, y); y += 8;
      doc.setFontSize(10);
      doc.text(`Fiscal365 · Gerado em ${new Date().toLocaleString('pt-BR')} · Usuário: ${currentUser?.email||''}`, 14, y); y += 10;
      doc.setFontSize(12);
      doc.text(`Empresa: ${currentCliente?.razao_social||'Não selecionada'} · CNPJ: ${currentCliente?.cnpj||'—'}`, 14, y); y += 7;
      doc.text(`Regime: ${darfData.regime} · Competência: ${darfData.competencia}`, 14, y); y += 12;
      doc.setFontSize(11);
      darfData.linhas.forEach(l => {
        doc.text(`${l.desc}: R$ ${l.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}`, 14, y); y += 6;
        if (l.obs) { doc.setFontSize(9); doc.text(`  ${l.obs}`, 14, y); doc.setFontSize(11); y += 5; }
      });
      y += 4;
      if (darfData.diasAtraso > 0) {
        doc.setTextColor(220,38,38);
        doc.text(`Em atraso ${darfData.diasAtraso} dias — Multa: R$ ${darfData.multa.toFixed(2)} + Juros: R$ ${darfData.juros.toFixed(2)}`, 14, y); y += 7;
        doc.setTextColor(0,0,0);
      }
      doc.setFontSize(13);
      doc.text(`TOTAL A RECOLHER: R$ ${darfData.totalFinal.toLocaleString('pt-BR',{minimumFractionDigits:2})}`, 14, y); y += 10;
      doc.setFontSize(8); doc.setTextColor(100,100,100);
      doc.text('AVISO: Este documento é uma referência de cálculo. Valores sujeitos a deduções, créditos e particularidades da empresa. Confirme antes de recolher.', 14, y, {maxWidth:180});
      doc.save(`darf-${darfData.regime}-${darfData.competencia.replace('/','')}.pdf`);
    }

    function exportarDarfExcel() {
      if (!darfData) return;
      const rows = [
        ['DOCUMENTO DE REFERÊNCIA — DARF/DAS — FISCAL365'],
        ['Empresa:', currentCliente?.razao_social||'', 'CNPJ:', currentCliente?.cnpj||''],
        ['Regime:', darfData.regime, 'Competência:', darfData.competencia],
        ['Gerado em:', new Date().toLocaleString('pt-BR'), 'Usuário:', currentUser?.email||''],
        [],
        ['Tributo', 'Código Receita', 'Base de Cálculo', 'Valor (R$)', 'Observação'],
        ...darfData.linhas.map(l => [l.desc, l.codigo, '', l.valor.toFixed(2), l.obs||'']),
        [],
        ['', '', 'Total Principal', darfData.totalPrincipal.toFixed(2)],
        ...(darfData.diasAtraso > 0 ? [
          ['', '', `Multa (${darfData.diasAtraso} dias atraso)`, darfData.multa.toFixed(2)],
          ['', '', 'Juros (Selic)', darfData.juros.toFixed(2)],
        ] : []),
        ['', '', 'TOTAL A RECOLHER', darfData.totalFinal.toFixed(2)],
        [],
        ['AVISO: Valores calculados com alíquotas padrão. Verifique deduções e créditos específicos.']
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DARF');
      XLSX.writeFile(wb, `darf-${darfData.regime}-${darfData.competencia.replace('/','')}.xlsx`);
    }
