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
  const salarioBruto    = parseFloat(document.getElementById('folhaSalario').value)      || 0;
  const horasExtras50   = parseFloat(document.getElementById('folhaHE50').value)          || 0;
  const horasExtras100  = parseFloat(document.getElementById('folhaHE100').value)         || 0;
  const adicNoturno     = parseFloat(document.getElementById('folhaAdicNoturno').value)   || 0;
  const dependentes     = parseInt(document.getElementById('folhaDependentes').value)     || 0;
  const pensaoAlim      = parseFloat(document.getElementById('folhaPensao').value)        || 0;
  const outrosDescontos = parseFloat(document.getElementById('folhaOutrosDesc').value)    || 0;
  const outrosAcrescimos= parseFloat(document.getElementById('folhaOutrosAcr').value)    || 0;
  const diasTrabalhados = parseInt(document.getElementById('folhaDias').value)            || 30;
  const tipoContrato    = document.getElementById('folhaTipoContrato').value; // clt | pj | estagio

  if (salarioBruto <= 0) {
    document.getElementById('folhaResult').style.display = 'none';
    document.getElementById('folhaActions').style.display = 'none';
    return;
  }

  // Proporcionalidade por dias trabalhados (CLT art. 64 — base 30 dias)
  const proporcao           = diasTrabalhados / 30;
  const salarioProporcional = Math.round(salarioBruto * proporcao * 100) / 100;

  // Valor hora normal (CLT: 220h/mês = 8h × 5 dias × 4,5 semanas)
  const valorHora = salarioBruto / 220;
  const vlHE50    = Math.round(horasExtras50  * valorHora * 1.50 * 100) / 100; // CLT art. 59
  const vlHE100   = Math.round(horasExtras100 * valorHora * 2.00 * 100) / 100; // feriados/DSR
  const vlAdicNot = Math.round(adicNoturno    * valorHora * 0.20 * 100) / 100; // CLT art. 73: 20%

  // Total de proventos brutos
  const totalBruto = salarioProporcional + vlHE50 + vlHE100 + vlAdicNot + outrosAcrescimos;

  // ── Cálculos por tipo de contrato ────────────────────────
  let inss = 0, irrf = 0, baseIRRF = 0;
  let fgts = 0, inssPatronal = 0, ratAcidenteTrabalho = 0;
  let observacoes = [];

  if (tipoContrato === 'clt') {
    // CLT padrão — tabelas Portaria MF 1.191/2025 e 1.206/2025
    inss     = calcularINSS(totalBruto);                                            // progressivo
    fgts     = Math.round(totalBruto * 0.08 * 100) / 100;                          // FGTS 8%
    baseIRRF = Math.max(0, totalBruto - inss - (dependentes * IRRF_DEDUCAO_DEPENDENTE) - pensaoAlim);
    irrf     = calcularIRRF(baseIRRF);
    inssPatronal        = Math.round(totalBruto * 0.20 * 100) / 100;               // INSS patronal 20%
    ratAcidenteTrabalho = Math.round(totalBruto * 0.02 * 100) / 100;               // RAT médio 2%
    observacoes.push('INSS progressivo • IRRF retido na fonte • FGTS 8% (custo empresa)');
    observacoes.push('Não inclui: 13º salário (1/12), férias (1/3) e outras verbas');

  } else if (tipoContrato === 'pj') {
    // Autônomo / PJ — emite RPA ou nota fiscal, não há vínculo CLT
    // INSS autônomo: contribuinte individual 20% sobre remuneração (teto R$ 8.157,41)
    const baseInssAutonomo = Math.min(totalBruto, 8157.41);
    inss = Math.min(Math.round(baseInssAutonomo * 0.20 * 100) / 100, INSS_TETO);
    // IRRF retido na fonte pelo tomador (tabela progressiva após INSS)
    baseIRRF = Math.max(0, totalBruto - inss - (dependentes * IRRF_DEDUCAO_DEPENDENTE) - pensaoAlim);
    irrf     = calcularIRRF(baseIRRF);
    // Sem FGTS (não há vínculo empregatício) e sem INSS patronal
    fgts         = 0;
    inssPatronal = 0;
    observacoes.push('INSS contribuinte individual 20% (teto R$ 8.157,41)');
    observacoes.push('Sem FGTS e sem INSS patronal • Emite RPA ou Nota Fiscal de Serviço');

  } else if (tipoContrato === 'estagio') {
    // Estágio — Lei 11.788/2008: não há FGTS, não há INSS, não é vínculo CLT
    inss         = 0;
    irrf         = 0; // bolsa-auxílio isenta de IRRF até R$ 2.428,80
    fgts         = 0;
    inssPatronal = 0;
    // IRRF só incide se bolsa superar isenção
    baseIRRF = Math.max(0, totalBruto - (dependentes * IRRF_DEDUCAO_DEPENDENTE) - pensaoAlim);
    irrf     = calcularIRRF(baseIRRF);
    observacoes.push('Estágio (Lei 11.788/2008): sem FGTS e sem INSS previdenciário');
    observacoes.push('IRRF incide apenas se bolsa superar a faixa isenta (R$ 2.428,80)');
  }

  // Totais
  const totalDescontos = inss + irrf + pensaoAlim + outrosDescontos;
  const salarioLiquido = Math.max(0, totalBruto - totalDescontos);
  const custoTotal     = totalBruto + fgts + inssPatronal + ratAcidenteTrabalho;

  renderFolhaResult({
    salarioBruto, proporcao, diasTrabalhados, salarioProporcional,
    vlHE50, horasExtras50, vlHE100, horasExtras100,
    vlAdicNot, adicNoturno, outrosAcrescimos,
    totalBruto, inss, irrf, fgts,
    dependentes, pensaoAlim, outrosDescontos,
    baseIRRF, totalDescontos, salarioLiquido,
    inssPatronal, ratAcidenteTrabalho, custoTotal, tipoContrato, observacoes,
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
      ${r.tipoContrato !== 'pj' && r.tipoContrato !== 'estagio' ? `
      <div style="padding:10px 16px">
        <div style="font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Custo para a Empresa (CLT)</div>
        <table style="width:100%;border-collapse:collapse">
          ${rowProv('Salário Bruto', r.totalBruto)}
          ${rowProv('FGTS (8%)', r.fgts)}
          ${rowProv('INSS Patronal (20%)', r.inssPatronal)}
          ${r.ratAcidenteTrabalho > 0 ? rowProv('RAT — Acidente de Trabalho (~2%)', r.ratAcidenteTrabalho) : ''}
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 8px;font-size:13px;font-weight:600;color:var(--text)">Custo Total Empresa</td>
            <td style="padding:7px 8px;font-size:13px;font-weight:700;text-align:right;color:var(--text)">R$ ${fmtBRL(r.custoTotal)}</td>
          </tr>
        </table>
      </div>` : ''}

      <!-- Observações -->
      ${(r.observacoes || []).length > 0 ? `
      <div style="padding:8px 16px 12px">
        ${r.observacoes.map(o => `<p style="font-size:10px;color:var(--text-light);line-height:1.5;margin:2px 0">ℹ️ ${o}</p>`).join('')}
      </div>` : ''}
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
  if (!jsPDF) { showToast('jsPDF não carregado. Recarregue a página.', 'error'); return; }

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
