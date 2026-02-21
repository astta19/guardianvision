// ============================================================
// DOCUMENTS.JS — Geração de PDF, DOCX, Excel
// ============================================================

    // ============================================================
    // GERAÇÃO DE DOCUMENTOS
    // ============================================================

    async function gerarConclusaoLLM(empresa, obrigacoes, resumoChat) {
      const prompt = `Você é um contador sênior. Com base na consulta fiscal abaixo, redija um parecer técnico com:
1. Análise objetiva dos pontos levantados na consulta
2. Identificação de riscos ou inconsistências fiscais
3. Recomendações práticas e fundamentadas em legislação
4. Linguagem formal e profissional

EMPRESA: ${empresa.razao_social} | CNPJ: ${empresa.cnpj} | Regime: ${empresa.regime_tributario}

OBRIGAÇÕES DO PERÍODO:
${obrigacoes.map(ob => `- ${ob.nome}: venc. ${ob.vencStr} — Status: ${ob.status} | Base: ${ob.base}`).join('\n')}

CONSULTA REALIZADA:
${resumoChat.substring(0, 3000)}

Escreva apenas o texto do parecer, sem títulos nem formatação markdown. Máximo 4 parágrafos.`;

      try {
        const res = await fetch('/.netlify/functions/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODELS[0],
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
            temperature: 0.3
          })
        });
        if (!res.ok) throw new Error('LLM indisponível');
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch(e) {
        return null;
      }
    }


    function getMesAno() {
      const d = new Date();
      return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    }

    function getObrigacoesMes() {
      const hoje = new Date();
      const mes = hoje.getMonth();
      const ano = hoje.getFullYear();
      const regime = currentCliente?.regime_tributario || '';
      const isSimplesOuMEI = /simples|mei/i.test(regime);

      const todas = [
        {
          nome: 'DAS — Simples Nacional',
          venc: new Date(ano, mes, 20),
          valor: darfResult?.das || null,
          base: 'LC 123/2006, art. 21 § 3º; Resolução CGSN nº 140/2018, art. 38',
          desc: 'Documento de Arrecadação do Simples Nacional',
          aplica: isSimplesOuMEI
        },
        {
          nome: 'DCTFWeb',
          venc: new Date(ano, mes, 28),
          valor: null,
          base: 'IN RFB nº 2005/2021, art. 7º; Portaria RFB nº 402/2019',
          desc: 'Declaração de Débitos e Créditos Tributários Federais Web',
          aplica: true
        },
        {
          nome: 'EFD-Reinf',
          venc: new Date(ano, mes, 15),
          valor: null,
          base: 'IN RFB nº 2043/2021; Resolução do Comitê Gestor do eSocial nº 2/2016',
          desc: 'Escrituração Fiscal Digital de Retenções e Outras Informações Fiscais',
          aplica: true
        },
        {
          nome: 'eSocial — Folha de Pagamento',
          venc: new Date(ano, mes, 15),
          valor: null,
          base: 'Lei nº 8.212/1991, art. 32; Decreto nº 3.048/1999; Resolução eSocial nº 2/2016',
          desc: 'Obrigação acessória de informações trabalhistas, previdenciárias e fiscais',
          aplica: true
        },
        {
          nome: 'EFD-Contribuições',
          venc: new Date(ano, mes, 10),
          valor: null,
          base: 'IN RFB nº 1252/2012; Lei nº 10.637/2002 e 10.833/2003',
          desc: 'Escrituração Fiscal Digital do PIS/Pasep e da COFINS',
          aplica: !/simples|mei/i.test(regime)
        },
        {
          nome: 'IRPJ / CSLL — Estimativa',
          venc: new Date(ano, mes, 30),
          valor: darfResult?.irpj || null,
          base: 'Lei nº 9.430/1996, art. 2º; IN RFB nº 1700/2017',
          desc: 'Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido',
          aplica: /lucro real|lucro presumido/i.test(regime)
        },
      ];

      return todas
        .filter(ob => ob.aplica)
        .map(ob => ({
          ...ob,
          status: ob.venc < hoje ? 'Vencida' : (ob.venc - hoje) / 86400000 <= 7 ? 'Próxima' : 'Em aberto',
          vencStr: ob.venc.toLocaleDateString('pt-BR')
        }));
    }

    async function getResumoChatTexto() {
      if (!currentChat.messages?.length) return 'Nenhuma conversa registrada nesta sessão.';
      return currentChat.messages
        .map(m => `[${m.role === 'user' ? 'Usuário' : 'Assistente'}] ${(m.content || '').replace(/<[^>]+>/g, '').substring(0, 500)}`)
        .join('\n\n');
    }

    // ----------------------------------------------------------
    // PDF — Relatório Fiscal Mensal
    // ----------------------------------------------------------
    async function gerarRelatorioFiscal() {
      document.getElementById('docGenMenu').style.display = 'none';
      if (!currentCliente) { alert('Selecione uma empresa antes de gerar o relatório.'); return; }
      try {

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const perfil = perfilCache || {};
      const empresa = currentCliente;
      const mesAno = getMesAno();
      const W = 210, margin = 15;

      // Cabeçalho
      doc.setFillColor(0, 0, 0);
      doc.rect(0, 0, W, 32, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18); doc.setFont('helvetica', 'bold');
      doc.text('Fiscal365', margin, 14);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text('Relatório Fiscal Mensal', margin, 21);
      doc.text(`${mesAno.charAt(0).toUpperCase() + mesAno.slice(1)}`, margin, 27);
      doc.setTextColor(0, 0, 0);

      // Dados da empresa
      let y = 42;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, W - margin*2, 24, 3, 3, 'F');
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(empresa.razao_social || 'Empresa', margin + 4, y + 8);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`CNPJ: ${empresa.cnpj || '—'}  |  Regime: ${empresa.regime_tributario || '—'}`, margin + 4, y + 15);
      doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}  |  Contador: ${perfil.nome || currentUser?.email || '—'}`, margin + 4, y + 21);
      doc.setTextColor(0, 0, 0);
      y += 32;

      // Obrigações do mês
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text('Obrigações do Mês', margin, y); y += 4;

      const obrigacoes = getObrigacoesMes();
      if (typeof doc.autoTable !== 'function') throw new Error('jsPDF autoTable não carregado');
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Obrigação', 'Vencimento', 'Status', 'Fundamentação Legal']],
        body: obrigacoes.map(ob => [
          ob.nome, ob.vencStr, ob.status, ob.base || '—'
        ]),
        headStyles: { fillColor: [0,0,0], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [248,250,252] },
        columnStyles: {
          2: { cellWidth: 28, halign: 'center',
               didDrawCell: (data) => {
                 if (data.section === 'body') {
                   const v = data.cell.raw;
                   if (v === 'Vencida') doc.setTextColor(220,38,38);
                   else if (v === 'Próxima') doc.setTextColor(217,119,6);
                   else doc.setTextColor(22,163,74);
                 }
               }
          },
          3: { halign: 'right' }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 2) {
            const v = data.cell.raw;
            if (v === 'Vencida') data.cell.styles.textColor = [220,38,38];
            else if (v === 'Próxima') data.cell.styles.textColor = [217,119,6];
            else data.cell.styles.textColor = [22,163,74];
          }
        }
      });
      y = doc.lastAutoTable.finalY + 10;

      // NFs analisadas
      if (nfeData?.length > 0) {
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text('Notas Fiscais Analisadas', margin, y); y += 4;
        doc.autoTable({
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Arquivo', 'CNPJ Emitente', 'Valor Total', 'Status']],
          body: nfeData.map(nf => [
            (nf.arquivo || '').substring(0,30),
            nf.cnpj_emit || '—',
            nf.valor_total ? `R$ ${parseFloat(nf.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '—',
            nf.erro ? 'Erro' : nf.nivel === 'ok' ? 'OK' : 'Alerta'
          ]),
          headStyles: { fillColor: [0,0,0], textColor: 255, fontSize: 9, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248,250,252] }
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      // Alertas
      const alertEls = document.querySelectorAll('.alert');
      if (alertEls.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text('Alertas e Riscos Identificados', margin, y); y += 6;
        alertEls.forEach(el => {
          const txt = el.textContent.trim();
          if (!txt) return;
          const isCrit = el.classList.contains('alert-error');
          doc.setFillColor(isCrit ? 254 : 255, isCrit ? 242 : 251, isCrit ? 242 : 235);
          const lines = doc.splitTextToSize(`• ${txt}`, W - margin*2 - 8);
          doc.roundedRect(margin, y-4, W-margin*2, lines.length*5+6, 2, 2, 'F');
          doc.setFontSize(9); doc.setFont('helvetica', 'normal');
          doc.setTextColor(isCrit ? 185 : 146, isCrit ? 28 : 64, isCrit ? 28 : 14);
          doc.text(lines, margin+4, y+1);
          doc.setTextColor(0,0,0);
          y += lines.length*5+10;
        });
      }

      // Rodapé
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226,232,240); doc.line(margin, 287, W-margin, 287);
        doc.setFontSize(8); doc.setTextColor(148,163,184);
        doc.text('Fiscal365 — Documento auxiliar de acompanhamento. Não substitui SPED, obrigações acessórias ou orientação contábil com CRC.', margin, 291);
        doc.text(`Página ${i}/${pages}`, W-margin, 291, { align: 'right' });
      }

      doc.save(`relatorio-fiscal-${empresa.cnpj?.replace(/\D/g,'') || 'empresa'}-${new Date().toISOString().slice(0,7)}.pdf`);
      } catch(e) {
        console.error('Erro ao gerar PDF:', e);
        alert('Erro ao gerar o relatório. Verifique se a página carregou completamente e tente novamente.');
      }
    }

    // ----------------------------------------------------------
    // DOCX — Parecer Fiscal
    // ----------------------------------------------------------
    async function gerarParecer() {
      document.getElementById('docGenMenu').style.display = 'none';
      if (!currentCliente) { alert('Selecione uma empresa antes de gerar o parecer.'); return; }
      if (typeof docx === 'undefined') { alert('Biblioteca DOCX não carregada. Recarregue a página.'); return; }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
              Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } = docx;

      const empresa = currentCliente;
      const perfil = perfilCache || {};
      const mesAno = getMesAno();
      const dataHoje = new Date().toLocaleDateString('pt-BR');
      const obrigacoes = getObrigacoesMes();
      const resumoChat = getResumoChatTexto();

      // Gerar conclusão via LLM
      const btnGen = document.getElementById('docGenBtn');
      const originalTitle = btnGen.title;
      btnGen.title = 'Gerando parecer...';

      const conclusaoLLM = await gerarConclusaoLLM(empresa, obrigacoes, resumoChat);
      const textoConclusao = conclusaoLLM ||
        `Com base na análise realizada em ${dataHoje}, foram identificadas ${obrigacoes.filter(o=>o.status==='Vencida').length} obrigação(ões) vencida(s) e ${obrigacoes.filter(o=>o.status==='Próxima').length} com vencimento próximo para a empresa ${empresa.razao_social}. Recomenda-se regularização imediata das pendências e acompanhamento contínuo dos prazos fiscais conforme legislação vigente.`;

      btnGen.title = originalTitle;

      try {
      // Quebrar resumo em parágrafos
      const chatParas = resumoChat.split('\n\n').filter(Boolean).map(txt =>
        new Paragraph({
          children: [new TextRun({ text: txt, size: 22, font: 'Calibri' })],
          spacing: { after: 160 }
        })
      );

      const doc = new Document({
        sections: [{
          properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
          children: [
            // Cabeçalho
            new Paragraph({
              children: [new TextRun({ text: 'Fiscal365', bold: true, size: 36, font: 'Calibri', color: '000000' })],
              spacing: { after: 80 }
            }),
            new Paragraph({
              children: [new TextRun({ text: 'Parecer Fiscal — ' + mesAno.charAt(0).toUpperCase() + mesAno.slice(1), size: 26, font: 'Calibri', color: '475569' })],
              spacing: { after: 400 }
            }),

            // Dados da empresa
            new Paragraph({ children: [new TextRun({ text: 'EMPRESA', bold: true, size: 20, font: 'Calibri', color: '64748b' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: empresa.razao_social || '—', bold: true, size: 26, font: 'Calibri' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: `CNPJ: ${empresa.cnpj || '—'}  |  Regime: ${empresa.regime_tributario || '—'}`, size: 22, font: 'Calibri', color: '475569' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: `Contador responsável: ${perfil.nome || currentUser?.email || '—'}`, size: 22, font: 'Calibri', color: '475569' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: `Data: ${dataHoje}`, size: 22, font: 'Calibri', color: '475569' })], spacing: { after: 400 } }),

            // Análise do chat
            new Paragraph({ text: '1. Análise da Consulta Fiscal', heading: HeadingLevel.HEADING_2, spacing: { after: 160 } }),
            ...chatParas,

            // Obrigações
            new Paragraph({ text: '2. Obrigações do Período', heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: ['Obrigação','Vencimento','Status'].map(h =>
                    new TableCell({
                      shading: { type: ShadingType.SOLID, color: '000000' },
                      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20, font: 'Calibri' })] })]
                    })
                  )
                }),
                ...obrigacoes.map(ob => new TableRow({
                  children: [ob.nome, ob.vencStr, ob.status].map((txt, i) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({
                        text: txt, size: 20, font: 'Calibri',
                        color: i === 2 ? (txt === 'Vencida' ? 'dc2626' : txt === 'Próxima' ? 'd97706' : '16a34a') : '000000'
                      })] })]
                    })
                  )
                }))
              ]
            }),

            // Conclusão
            new Paragraph({ text: '3. Conclusão e Recomendações', heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 160 } }),
            ...textoConclusao.split('\n\n').filter(Boolean).map(txt =>
              new Paragraph({
                children: [new TextRun({ text: txt, size: 22, font: 'Calibri' })],
                spacing: { after: 200 }
              })
            ),
            new Paragraph({ spacing: { after: 400 } }),

            // Assinatura
            new Paragraph({ children: [new TextRun({ text: '___________________________________', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: perfil.nome || 'Contador Responsável', bold: true, size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
            perfil.crc ? new Paragraph({ children: [new TextRun({ text: `CRC: ${perfil.crc}`, size: 20, font: 'Calibri', color: '475569' })], spacing: { after: 80 } }) : new Paragraph({}),
            new Paragraph({ children: [new TextRun({ text: currentUser?.email || '', size: 20, font: 'Calibri', color: '475569' })], spacing: { after: 80 } }),
            new Paragraph({ children: [new TextRun({ text: dataHoje, size: 20, font: 'Calibri', color: '475569' })], spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: 'Documento auxiliar gerado pelo Fiscal365. Não substitui obrigações acessórias (SPED, DCTFWeb, EFD) nem dispensa orientação contábil profissional habilitado com CRC. Fundamentação conforme legislação vigente na data de emissão.', size: 16, font: 'Calibri', color: '94a3b8', italics: true })] }),
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parecer-fiscal-${empresa.cnpj?.replace(/\D/g,'') || 'empresa'}-${new Date().toISOString().slice(0,7)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      } catch(e) {
        console.error('Erro ao gerar DOCX:', e);
        alert('Erro ao gerar o parecer. Verifique se a página carregou completamente e tente novamente.');
      }
    }

    // ----------------------------------------------------------
    // Excel — Planilha de Apuração
    // ----------------------------------------------------------
    function gerarPlanilha() {
      document.getElementById('docGenMenu').style.display = 'none';
      if (!currentCliente) { alert('Selecione uma empresa antes de gerar a planilha.'); return; }
      try {

      const empresa = currentCliente;
      const mesAno = getMesAno();
      const obrigacoes = getObrigacoesMes();
      const wb = XLSX.utils.book_new();

      // ABA 1: Resumo Financeiro
      const resumoData = [
        [`RESUMO FINANCEIRO — ${mesAno.toUpperCase()}`],
        [],
        ['Empresa:', empresa.razao_social || '—'],
        ['CNPJ:', empresa.cnpj || '—'],
        ['Regime:', empresa.regime_tributario || '—'],
        ['Gerado em:', new Date().toLocaleDateString('pt-BR')],
        [],
        ['OBRIGAÇÕES DO MÊS'],
        ['Obrigação', 'Vencimento', 'Status', 'Fundamentação Legal', 'Valor Estimado'],
        ...obrigacoes.map(ob => [ob.nome, ob.vencStr, ob.status, ob.valor || '']),
        [],
        ['RESUMO DE NFs ANALISADAS'],
        nfeData?.length > 0
          ? ['Arquivo', 'CNPJ Emitente', 'Valor Total', 'Status']
          : ['Nenhuma NF-e analisada nesta sessão'],
        ...(nfeData?.length > 0 ? nfeData.map(nf => [
          nf.arquivo || '—',
          nf.cnpj_emit || '—',
          nf.valor_total ? parseFloat(nf.valor_total) : '',
          nf.erro ? 'Erro' : nf.nivel === 'ok' ? 'OK' : 'Alerta'
        ]) : []),
        [],
        ['CÁLCULOS TRIBUTÁRIOS'],
        darfResult ? [
          ['Tipo', 'Valor'],
          ...Object.entries(darfResult).map(([k,v]) => [k.toUpperCase(), typeof v === 'number' ? v : ''])
        ].flat() : ['Nenhum cálculo realizado nesta sessão']
      ];

      const ws = XLSX.utils.aoa_to_sheet(resumoData);

      // Larguras das colunas
      ws['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 15 }, { wch: 20 }];

      // Merge do título
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

      XLSX.utils.book_append_sheet(wb, ws, 'Resumo Financeiro');

      // ABA 2: Chat (log completo)
      if (currentChat.messages?.length > 0) {
        const chatData = [
          ['HISTÓRICO DA CONSULTA FISCAL'],
          ['Data/Hora', 'Papel', 'Mensagem'],
          ...currentChat.messages.map(m => [
            new Date().toLocaleDateString('pt-BR'),
            m.role === 'user' ? 'Usuário' : 'Assistente',
            (m.content || '').replace(/<[^>]+>/g, '').substring(0, 1000)
          ])
        ];
        const wsChat = XLSX.utils.aoa_to_sheet(chatData);
        wsChat['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 80 }];
        XLSX.utils.book_append_sheet(wb, wsChat, 'Consulta Fiscal');
      }

      // ABA 3: Referências Legislativas
      const legData = [
        ['REFERÊNCIAS LEGISLATIVAS'],
        [],
        ['Norma', 'Descrição', 'Obrigação Relacionada'],
        ['LC 123/2006, art. 21 § 3º', 'Prazo de recolhimento do DAS', 'DAS Simples Nacional'],
        ['Resolução CGSN nº 140/2018, art. 38', 'Regulamentação do Simples Nacional', 'DAS Simples Nacional'],
        ['IN RFB nº 2005/2021', 'Institui a DCTFWeb e define obrigados', 'DCTFWeb'],
        ['IN RFB nº 2043/2021', 'Regulamenta a EFD-Reinf', 'EFD-Reinf'],
        ['Lei nº 8.212/1991, art. 32', 'Obrigações acessórias previdenciárias', 'eSocial'],
        ['IN RFB nº 1252/2012', 'Institui a EFD-Contribuições', 'EFD-Contribuições'],
        ['Lei nº 9.430/1996, art. 2º', 'Estimativa mensal IRPJ/CSLL', 'IRPJ/CSLL'],
        ['Lei nº 10.637/2002', 'PIS/Pasep não cumulativo', 'EFD-Contribuições'],
        ['Lei nº 10.833/2003', 'COFINS não cumulativa', 'EFD-Contribuições'],
        [],
        ['Disclaimer: Este documento é auxiliar de acompanhamento fiscal. Não substitui obrigações acessórias oficiais nem orientação de contador habilitado com CRC.']
      ];
      const wsLeg = XLSX.utils.aoa_to_sheet(legData);
      wsLeg['!cols'] = [{ wch: 35 }, { wch: 50 }, { wch: 30 }];
      wsLeg['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
      XLSX.utils.book_append_sheet(wb, wsLeg, 'Referências Legislativas');

      XLSX.writeFile(wb, `apuracao-${empresa.cnpj?.replace(/\D/g,'') || 'empresa'}-${new Date().toISOString().slice(0,7)}.xlsx`);
      } catch(e) {
        console.error('Erro ao gerar Excel:', e);
        alert('Erro ao gerar a planilha. Verifique se a página carregou completamente e tente novamente.');
      }
    }
