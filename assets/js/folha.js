// ============================================================
// FOLHA.JS — Folha de Pagamento Simplificada
// Cálculo de INSS, IRRF, FGTS e geração de recibo PDF
// Tabelas vigentes: Portaria MF 1.191/2025 (INSS) e 1.206/2025 (IRRF)
// ============================================================

// ── Tabelas tributárias vigentes 2025/2026 ──────────────────

const INSS_FAIXAS = [
  { ate: 1518.00,  aliq: 0.075 },
  { ate: 2793.88,  aliq: 0.09  },
  { ate: 4190.83,  aliq: 0.12  },
  { ate: 8157.41,  aliq: 0.14  },
];
const INSS_TETO = 908.85;

const IRRF_FAIXAS = [
  { ate: 2428.80,  aliq: 0,     deducao: 0       },
  { ate: 2826.65,  aliq: 0.075, deducao: 182.16  },
  { ate: 3751.05,  aliq: 0.15,  deducao: 394.16  },
  { ate: 4664.68,  aliq: 0.225, deducao: 675.49  },
  { ate: Infinity, aliq: 0.275, deducao: 908.74  },
];
const IRRF_DEDUCAO_DEPENDENTE = 189.59;
const FGTS_ALIQ = 0.08;

// ── Estado do módulo ─────────────────────────────────────────
let folhaFuncionarios = [];   // lista de funcionários calculados na sessão

// ── Utilitários ──────────────────────────────────────────────
function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// INSS progressivo — cada faixa tributa apenas o excedente dela
function calcularINSS(salarioBruto) {
  if (salarioBruto <= 0) return 0;
  let inss = 0;
  let base = Math.min(salarioBruto, 8157.41); // teto da tabela
  let anterior = 0;
  for (const f of INSS_FAIXAS) {
    if (base <= anterior) break;
    const faixaMax = Math.min(base, f.ate);
    inss += (faixaMax - anterior) * f.aliq;
    anterior = f.ate;
  }
  return Math.min(Math.round(inss * 100) / 100, INSS_TETO);
}

// IRRF sobre base (salário - INSS - dedução dependentes - pensão)
function calcularIRRF(baseCalculo) {
  if (baseCalculo <= 0) return 0;
  const faixa = IRRF_FAIXAS.find(f => baseCalculo <= f.ate) || IRRF_FAIXAS.at(-1);
  const irrf = baseCalculo * faixa.aliq - faixa.deducao;
  return Math.max(0, Math.round(irrf * 100) / 100);
}

// ── Cálculo principal ────────────────────────────────────────
function calcularFolha() {
  const salarioBruto   = parseFloat(document.getElementById('folhaSalario').value)     || 0;
  const horasExtras50  = parseFloat(document.getElementById('folhaHE50').value)         || 0;
  const horasExtras100 = parseFloat(document.getElementById('folhaHE100').value)        || 0;
  const adicNoturno    = parseFloat(document.getElementById('folhaAdicNoturno').value)  || 0;
  const dependentes    = parseInt(document.getElementById('folhaDependentes').value)    || 0;
  const pensaoAlim     = parseFloat(document.getElementById('folhaPensao').value)       || 0;
  const outrosDescontos= parseFloat(document.getElementById('folhaOutrosDesc').value)   || 0;
  const outrosAcrescimos=parseFloat(document.getElementById('folhaOutrosAcr').value)    || 0;
  const diasTrabalhados= parseInt(document.getElementById('folhaDias').value)           || 30;
  const tipoContrato   = document.getElementById('folhaTipoContrato').value;

  if (salarioBruto <= 0) {
    document.getElementById('folhaResult').style.display = 'none';
    document.getElementById('folhaActions').style.display = 'none';
    return;
  }

  // Proporcionalidade por dias trabalhados
  const proporcao = diasTrabalhados / 30;
  const salarioProporcional = salarioBruto * proporcao;

  // Cálculo das horas
  const valorHora = salarioBruto / 220;
  const vlHE50    = horasExtras50  * valorHora * 1.50;
  const vlHE100   = horasExtras100 * valorHora * 2.00;
  const vlAdicNot = adicNoturno    * valorHora * 0.20;

  // Total de proventos brutos
  const totalBruto = salarioProporcional + vlHE50 + vlHE100 + vlAdicNot + outrosAcrescimos;

  // INSS sobre total bruto (teto aplica ao bruto)
  const inss = calcularINSS(Math.min(totalBruto, 8157.41));

  // FGTS sobre bruto (não retido do empregado — custo patronal)
  const fgts = Math.round(totalBruto * FGTS_ALIQ * 100) / 100;

  // Base IRRF = bruto - INSS - dedução dependentes - pensão alimentícia
  const baseIRRF = Math.max(0, totalBruto - inss - (dependentes * IRRF_DEDUCAO_DEPENDENTE) - pensaoAlim);
  const irrf = calcularIRRF(baseIRRF);

  // Total descontos e líquido
  const totalDescontos = inss + irrf + pensaoAlim + outrosDescontos;
  const salarioLiquido = Math.max(0, totalBruto - totalDescontos);

  // Custo total para empresa (bruto + FGTS + INSS patronal 20%)
  let inssPatronal = 0;
  if (tipoContrato === 'clt') {
    inssPatronal = Math.round(totalBruto * 0.20 * 100) / 100;
  } else if (tipoContrato === 'mei') {
    inssPatronal = Math.round(totalBruto * 0.03 * 100) / 100; // MEI: 3%
  }
  const custoTotal = totalBruto + fgts + inssPatronal;

  // Renderizar resultado
  renderFolhaResult({
    salarioBruto, proporcao, diasTrabalhados, salarioProporcional,
    vlHE50, horasExtras50, vlHE100, horasExtras100,
    vlAdicNot, adicNoturno, outrosAcrescimos,
    totalBruto, inss, irrf, fgts,
    dependentes, pensaoAlim, outrosDescontos,
    baseIRRF, totalDescontos, salarioLiquido,
    inssPatronal, custoTotal, tipoContrato,
  });
}

function renderFolhaResult(r) {
  const el = document.getElementById('folhaResult');
  const nomeFuncionario = document.getElementById('folhaNome').value || 'Funcionário';
  const cargo = document.getElementById('folhaCargo').value || '';
  const competencia = document.getElementById('folhaCompetencia').value || '—';

  const rowProv = (desc, valor, destaque = false) => valor > 0
    ? `<tr><td style="padding:5px 8px;font-size:12px;color:var(--text)">${desc}</td><td style="padding:5px 8px;font-size:12px;text-align:right;color:${destaque ? '#16a34a' : 'var(--text)'}">R$ ${fmtBRL(valor)}</td></tr>`
    : '';

  const rowDesc = (desc, valor, obs = '') => valor > 0
    ? `<tr><td style="padding:5px 8px;font-size:12px;color:var(--text)">${desc}${obs ? `<span style="font-size:10px;color:var(--text-light);margin-left:6px">${obs}</span>` : ''}</td><td style="padding:5px 8px;font-size:12px;text-align:right;color:#dc2626">- R$ ${fmtBRL(valor)}</td></tr>`
    : '';

  el.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:16px">

      <!-- Cabeçalho do recibo -->
      <div style="background:var(--accent);padding:12px 16px;color:var(--user-text)">
        <div style="font-weight:700;font-size:14px">${escapeHtml(nomeFuncionario)}${cargo ? ' — ' + escapeHtml(cargo) : ''}</div>
        <div style="font-size:11px;opacity:.8;margin-top:2px">Competência: ${escapeHtml(competencia)} · ${r.diasTrabalhados} dias trabalhados</div>
      </div>

      <!-- Proventos -->
      <div style="padding:8px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;padding:6px 8px 4px">Proventos</div>
        <table style="width:100%;border-collapse:collapse">
          ${rowProv('Salário Base' + (r.proporcao < 1 ? ` (${r.diasTrabalhados}/30 dias)` : ''), r.salarioProporcional)}
          ${rowProv(`Horas Extras 50% (${r.horasExtras50}h)`, r.vlHE50)}
          ${rowProv(`Horas Extras 100% (${r.horasExtras100}h)`, r.vlHE100)}
          ${rowProv(`Adicional Noturno (${r.adicNoturno}h)`, r.vlAdicNot)}
          ${r.outrosAcrescimos > 0 ? rowProv('Outros acréscimos', r.outrosAcrescimos) : ''}
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 8px;font-size:13px;font-weight:600;color:var(--text)">Total de Proventos</td>
            <td style="padding:7px 8px;font-size:13px;font-weight:700;text-align:right;color:var(--text)">R$ ${fmtBRL(r.totalBruto)}</td>
          </tr>
        </table>
      </div>

      <!-- Descontos -->
      <div style="padding:8px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;padding:6px 8px 4px">Descontos</div>
        <table style="width:100%;border-collapse:collapse">
          ${rowDesc('INSS', r.inss, `(tabela progressiva)`)}
          ${rowDesc('IRRF', r.irrf, `(base R$ ${fmtBRL(r.baseIRRF)})`)}
          ${r.pensaoAlim > 0 ? rowDesc('Pensão Alimentícia', r.pensaoAlim) : ''}
          ${r.outrosDescontos > 0 ? rowDesc('Outros descontos', r.outrosDescontos) : ''}
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 8px;font-size:13px;font-weight:600;color:var(--text)">Total de Descontos</td>
            <td style="padding:7px 8px;font-size:13px;font-weight:700;text-align:right;color:#dc2626">- R$ ${fmtBRL(r.totalDescontos)}</td>
          </tr>
        </table>
      </div>

      <!-- Líquido -->
      <div style="padding:12px 16px;background:var(--hover);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:15px;font-weight:700;color:var(--text)">SALÁRIO LÍQUIDO</span>
        <span style="font-size:18px;font-weight:800;color:#16a34a">R$ ${fmtBRL(r.salarioLiquido)}</span>
      </div>

      <!-- Custo empresa -->
      <div style="padding:10px 16px">
        <div style="font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Custo para a Empresa</div>
        <table style="width:100%;border-collapse:collapse">
          ${rowProv('Salário Bruto', r.totalBruto)}
          ${rowProv('FGTS (8%)', r.fgts)}
          ${r.tipoContrato === 'clt'  ? rowProv('INSS Patronal (20%)', r.inssPatronal) : ''}
          ${r.tipoContrato === 'mei'  ? rowProv('INSS Patronal MEI (3%)', r.inssPatronal) : ''}
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 8px;font-size:13px;font-weight:600;color:var(--text)">Custo Total</td>
            <td style="padding:7px 8px;font-size:13px;font-weight:700;text-align:right;color:var(--text)">R$ ${fmtBRL(r.custoTotal)}</td>
          </tr>
        </table>
        <p style="font-size:10px;color:var(--text-light);margin:8px 8px 0;line-height:1.5">
          ⚠️ Valores calculados com tabelas Portaria MF 1.191/2025 e 1.206/2025. Não incluem PLR, vale-refeição, convênios ou outras verbas específicas da empresa.
        </p>
      </div>
    </div>`;

  el.style.display = 'block';
  document.getElementById('folhaActions').style.display = 'flex';

  // Salvar último cálculo para PDF/chat
  window._folhaData = {
    nomeFuncionario, cargo, competencia,
    empresa: currentCliente?.razao_social || '',
    cnpj: currentCliente?.cnpj || '',
    ...r,
  };

  // Adicionar à lista de funcionários da sessão (evita duplicatas pelo nome)
  const idx = folhaFuncionarios.findIndex(f => f.nomeFuncionario === nomeFuncionario);
  if (idx >= 0) folhaFuncionarios[idx] = window._folhaData;
  else folhaFuncionarios.push(window._folhaData);
}

// ── Abrir / Fechar modal ─────────────────────────────────────
function openFolha() {
  closeDropdowns();
  document.getElementById('folhaModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Auto-preencher competência com mês atual
  const hoje = new Date();
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  document.getElementById('folhaCompetencia').value = `${mm}/${hoje.getFullYear()}`;
}

function closeFolha() {
  document.getElementById('folhaModal').style.display = 'none';
  document.body.style.overflow = '';
}

function limparFolha() {
  ['folhaNome','folhaCargo','folhaSalario','folhaHE50','folhaHE100',
   'folhaAdicNoturno','folhaPensao','folhaOutrosDesc','folhaOutrosAcr'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('folhaDependentes').value = '0';
  document.getElementById('folhaDias').value = '30';
  document.getElementById('folhaTipoContrato').value = 'clt';
  document.getElementById('folhaResult').style.display = 'none';
  document.getElementById('folhaActions').style.display = 'none';
  window._folhaData = null;
}

// ── Exportar PDF ─────────────────────────────────────────────
async function exportarFolhaPDF() {
  const d = window._folhaData;
  if (!d) return;
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('jsPDF não carregado. Recarregue a página.'); return; }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 15;
  const perfil = perfilCache || {};

  // Cabeçalho
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, W, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('Fiscal365', M, 13);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text('Recibo de Pagamento de Salário', M, 21);
  doc.setFontSize(9);
  doc.text(`Competência: ${d.competencia}  |  Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, M, 28);
  doc.setTextColor(0, 0, 0);

  // Dados do funcionário
  let y = 44;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - M * 2, 26, 3, 3, 'F');
  doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text(d.nomeFuncionario, M + 4, y + 8);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  if (d.cargo) doc.text(`Cargo: ${d.cargo}`, M + 4, y + 15);
  doc.text(`Empresa: ${d.empresa || '—'}  |  CNPJ: ${d.cnpj || '—'}`, M + 4, y + 21);
  doc.text(`Contador: ${perfil.nome || '—'}  |  CRC: ${perfil.crc || '—'}`, W - M - 4, y + 21, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 34;

  const linhaTabela = (desc, valor, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.text(desc, M + 4, y);
    doc.text(`R$ ${fmtBRL(valor)}`, W - M - 4, y, { align: 'right' });
    y += 6;
  };

  // Proventos
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('PROVENTOS', M, y); y += 5;
  doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;

  linhaTabela(`Salário Base${d.proporcao < 1 ? ` (${d.diasTrabalhados}/30 dias)` : ''}`, d.salarioProporcional);
  if (d.vlHE50 > 0)   linhaTabela(`Horas Extras 50% (${d.horasExtras50}h)`, d.vlHE50);
  if (d.vlHE100 > 0)  linhaTabela(`Horas Extras 100% (${d.horasExtras100}h)`, d.vlHE100);
  if (d.vlAdicNot > 0) linhaTabela(`Adicional Noturno (${d.adicNoturno}h)`, d.vlAdicNot);
  if (d.outrosAcrescimos > 0) linhaTabela('Outros acréscimos', d.outrosAcrescimos);

  doc.line(M, y, W - M, y); y += 4;
  doc.setFillColor(240, 253, 244);
  doc.rect(M, y - 2, W - M * 2, 8, 'F');
  linhaTabela('TOTAL DE PROVENTOS', d.totalBruto, true);
  y += 4;

  // Descontos
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('DESCONTOS', M, y); y += 5;
  doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;

  linhaTabela(`INSS (tabela progressiva)`, d.inss);
  linhaTabela(`IRRF (base R$ ${fmtBRL(d.baseIRRF)})`, d.irrf);
  if (d.pensaoAlim > 0)    linhaTabela('Pensão Alimentícia', d.pensaoAlim);
  if (d.outrosDescontos > 0) linhaTabela('Outros descontos', d.outrosDescontos);

  doc.line(M, y, W - M, y); y += 4;
  doc.setFillColor(254, 242, 242);
  doc.rect(M, y - 2, W - M * 2, 8, 'F');
  linhaTabela('TOTAL DE DESCONTOS', d.totalDescontos, true);
  y += 6;

  // Líquido
  doc.setFillColor(0, 0, 0);
  doc.roundedRect(M, y, W - M * 2, 12, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text('SALÁRIO LÍQUIDO', M + 6, y + 8);
  doc.text(`R$ ${fmtBRL(d.salarioLiquido)}`, W - M - 6, y + 8, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 20;

  // Custo empresa
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('CUSTO PARA A EMPRESA', M, y); y += 5;
  doc.setDrawColor(226, 232, 240); doc.line(M, y, W - M, y); y += 4;

  linhaTabela('Salário Bruto', d.totalBruto);
  linhaTabela('FGTS (8%)', d.fgts);
  if (d.inssPatronal > 0) {
    linhaTabela(d.tipoContrato === 'mei' ? 'INSS Patronal MEI (3%)' : 'INSS Patronal (20%)', d.inssPatronal);
  }
  doc.line(M, y, W - M, y); y += 4;
  linhaTabela('CUSTO TOTAL', d.custoTotal, true);
  y += 8;

  // Assinatura
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.setDrawColor(0, 0, 0);
  doc.line(M, y + 10, M + 70, y + 10);
  doc.line(W - M - 70, y + 10, W - M, y + 10);
  doc.text('Assinatura do Empregado', M + 10, y + 15);
  doc.text('Assinatura do Empregador', W - M - 55, y + 15);
  y += 24;

  // Rodapé
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.line(M, 287, W - M, 287);
    doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text('Fiscal365 — Recibo auxiliar. Tabelas: Portaria MF 1.191/2025 (INSS) e 1.206/2025 (IRRF). Não substitui sistemas de RH homologados.', M, 291);
    doc.text(`Pág. ${p}/${pages}`, W - M, 291, { align: 'right' });
  }

  const cnpjStr = (d.cnpj || 'empresa').replace(/\D/g, '');
  const nomeStr = d.nomeFuncionario.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  doc.save(`recibo-${nomeStr}-${cnpjStr}-${(d.competencia || '').replace('/', '')}.pdf`);
}

// ── Exportar Excel ───────────────────────────────────────────
function exportarFolhaExcel() {
  if (!folhaFuncionarios.length) return;
  const wb = XLSX.utils.book_new();

  // ABA: Holerites
  const cabecalho = [
    'Funcionário','Cargo','Competência','Dias Trab.','Salário Base',
    'HE 50%','HE 100%','Adic. Noturno','Outros Acrésc.','Total Bruto',
    'INSS','IRRF','Pensão Alim.','Outros Desc.','Total Desc.',
    'Salário Líquido','FGTS (emp.)','INSS Patronal','Custo Total Empresa'
  ];
  const linhas = folhaFuncionarios.map(f => [
    f.nomeFuncionario, f.cargo, f.competencia, f.diasTrabalhados,
    +f.salarioBruto.toFixed(2), +f.vlHE50.toFixed(2), +f.vlHE100.toFixed(2),
    +f.vlAdicNot.toFixed(2), +f.outrosAcrescimos.toFixed(2), +f.totalBruto.toFixed(2),
    +f.inss.toFixed(2), +f.irrf.toFixed(2), +f.pensaoAlim.toFixed(2),
    +f.outrosDescontos.toFixed(2), +f.totalDescontos.toFixed(2),
    +f.salarioLiquido.toFixed(2), +f.fgts.toFixed(2), +f.inssPatronal.toFixed(2),
    +f.custoTotal.toFixed(2)
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`FOLHA DE PAGAMENTO — ${folhaFuncionarios[0]?.empresa || ''}`],
    [`Competência: ${folhaFuncionarios[0]?.competencia || ''}  |  CNPJ: ${folhaFuncionarios[0]?.cnpj || ''}`],
    [`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`],
    [],
    cabecalho,
    ...linhas,
    [],
    ['Tabelas: Portaria MF 1.191/2025 (INSS) e 1.206/2025 (IRRF). Não substitui sistemas de RH homologados.']
  ]);
  ws['!cols'] = cabecalho.map((_, i) => ({ wch: i < 3 ? 22 : 14 }));
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Folha de Pagamento');

  const comp = (folhaFuncionarios[0]?.competencia || '').replace('/', '');
  const cnpj = (folhaFuncionarios[0]?.cnpj || 'empresa').replace(/\D/g, '');
  XLSX.writeFile(wb, `folha-pagamento-${cnpj}-${comp}.xlsx`);
}

// ── Enviar para o chat ────────────────────────────────────────
function enviarFolhaParaChat() {
  const d = window._folhaData;
  if (!d) return;
  const resumo = [
    `Funcionário: ${d.nomeFuncionario}${d.cargo ? ' — ' + d.cargo : ''}`,
    `Empresa: ${d.empresa || '—'}  |  Competência: ${d.competencia}`,
    `Salário Bruto: R$ ${fmtBRL(d.totalBruto)}`,
    `INSS (empregado): R$ ${fmtBRL(d.inss)}`,
    `IRRF: R$ ${fmtBRL(d.irrf)}  (base R$ ${fmtBRL(d.baseIRRF)})`,
    `Salário Líquido: R$ ${fmtBRL(d.salarioLiquido)}`,
    `FGTS: R$ ${fmtBRL(d.fgts)}`,
    `INSS Patronal: R$ ${fmtBRL(d.inssPatronal)}`,
    `Custo Total para Empresa: R$ ${fmtBRL(d.custoTotal)}`,
  ].join('\n');

  document.getElementById('msgInput').value =
    `Analise a folha de pagamento abaixo e verifique se os cálculos estão corretos, incluindo INSS e IRRF:\n\n${resumo}`;
  closeFolha();
  document.getElementById('msgInput').focus();
}
