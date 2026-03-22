// ============================================================
// TERMOS.JS — Termos de Uso e Política de Privacidade (LGPD)
// Fiscal365 / GuardianVision
// ============================================================

function abrirTermos() {
  _termosAbrirModal('termos');
}

function abrirPrivacidade() {
  _termosAbrirModal('privacidade');
}

function _termosAbrirModal(aba) {
  let modal = document.getElementById('termosModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'termosModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99000;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.onclick = e => { if (e.target === modal) _termosFechar(); };
    modal.innerHTML = `
      <div style="background:var(--card);border-radius:16px;width:100%;max-width:680px;max-height:90dvh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.2)">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="display:flex;gap:8px">
            <button id="abaTermosBtn" onclick="_termosAba('termos')"
              style="padding:6px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600">
              Termos de Uso
            </button>
            <button id="abaPrivBtn" onclick="_termosAba('privacidade')"
              style="padding:6px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600">
              Privacidade e LGPD
            </button>
          </div>
          <button onclick="_termosFechar()" style="background:none;border:none;cursor:pointer;color:var(--text-light);padding:4px;border-radius:6px">
            <i data-lucide="x" style="width:18px;height:18px"></i>
          </button>
        </div>
        <!-- Conteúdo -->
        <div id="termosConteudo" style="overflow-y:auto;padding:24px;flex:1;font-size:13px;line-height:1.75;color:var(--text)"></div>
        <!-- Footer -->
        <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;flex-shrink:0">
          <button onclick="_termosFechar()"
            style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer">
            Entendido
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    if (window.lucide) lucide.createIcons();
  }
  modal.style.display = 'flex';
  _termosAba(aba);
}

function _termosFechar() {
  const modal = document.getElementById('termosModal');
  if (modal) modal.style.display = 'none';
}

function _termosAba(aba) {
  const el = document.getElementById('termosConteudo');
  const btnT = document.getElementById('abaTermosBtn');
  const btnP = document.getElementById('abaPrivBtn');
  if (!el) return;

  const activeStyle = 'background:var(--accent);color:#fff';
  const inactiveStyle = 'background:var(--sidebar-hover);color:var(--text-light)';
  btnT.style.cssText += ';' + (aba === 'termos' ? activeStyle : inactiveStyle);
  btnP.style.cssText += ';' + (aba === 'privacidade' ? activeStyle : inactiveStyle);

  el.innerHTML = aba === 'termos' ? _conteudoTermos() : _conteudoPrivacidade();
}

function _conteudoTermos() {
  const ano = new Date().getFullYear();
  return `
    <h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Termos de Uso</h2>
    <p style="color:var(--text-light);font-size:12px;margin:0 0 20px">Última atualização: Janeiro de ${ano}</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">1. Aceitação</h3>
    <p>Ao acessar ou utilizar o Fiscal365, você concorda com estes Termos de Uso. Se não concordar, não utilize o sistema.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">2. Descrição do Serviço</h3>
    <p>O Fiscal365 é uma plataforma de gestão contábil e fiscal destinada a escritórios de contabilidade e profissionais contábeis. O sistema oferece ferramentas para apuração de impostos, folha de pagamento, emissão de documentos orientadores e chat com inteligência artificial.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">3. Responsabilidade pelo Uso</h3>
    <p>O usuário é responsável pela correta utilização do sistema. Os cálculos e documentos gerados têm caráter <strong>orientador</strong> e não substituem a análise de um profissional contábil habilitado. O Fiscal365 não assume responsabilidade por erros decorrentes de dados incorretos inseridos pelo usuário.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">4. Obrigações do Usuário</h3>
    <p>O usuário compromete-se a: (a) manter suas credenciais de acesso em sigilo; (b) não compartilhar o acesso com terceiros não autorizados; (c) utilizar o sistema apenas para fins lícitos; (d) manter os dados dos clientes atualizados e íntegros.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">5. Propriedade Intelectual</h3>
    <p>Todos os direitos sobre o software, marcas, layout e conteúdo do Fiscal365 são reservados. É vedada a reprodução, cópia ou redistribuição sem autorização prévia e por escrito.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">6. Disponibilidade</h3>
    <p>O serviço é fornecido "no estado em que se encontra". Eventuais interrupções para manutenção serão comunicadas com antecedência sempre que possível.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">7. Alterações</h3>
    <p>Estes termos podem ser atualizados a qualquer momento. O uso continuado do sistema após alterações implica aceitação dos novos termos.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">8. Foro</h3>
    <p>Fica eleito o foro da Comarca de Ribeirão Preto/SP para dirimir quaisquer litígios decorrentes destes termos, com renúncia a qualquer outro.</p>
  `;
}

function _conteudoPrivacidade() {
  const ano = new Date().getFullYear();
  return `
    <h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Política de Privacidade e LGPD</h2>
    <p style="color:var(--text-light);font-size:12px;margin:0 0 20px">Última atualização: Janeiro de ${ano} · Lei nº 13.709/2018 (LGPD)</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">1. Controlador dos Dados</h3>
    <p>O controlador dos dados pessoais tratados nesta plataforma é o titular da conta administradora do escritório de contabilidade. O Fiscal365 atua como operador de dados, nos termos do art. 5º, VII da LGPD.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">2. Dados Coletados</h3>
    <p>Coletamos os seguintes dados para operação do sistema:</p>
    <ul style="padding-left:20px;margin:8px 0">
      <li><strong>Dados de identificação:</strong> nome, e-mail, CPF, CRC do contador</li>
      <li><strong>Dados dos clientes:</strong> razão social, CNPJ, regime tributário, dados fiscais e contábeis</li>
      <li><strong>Dados de uso:</strong> logs de acesso, interações com o sistema, histórico de chat</li>
      <li><strong>Dados biométricos (opcional):</strong> reconhecimento facial para autenticação, mediante consentimento explícito</li>
    </ul>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">3. Finalidade do Tratamento</h3>
    <p>Os dados são tratados para: (a) prestação dos serviços contratados; (b) cumprimento de obrigações legais; (c) melhoria contínua do sistema; (d) comunicações relacionadas ao serviço.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">4. Base Legal</h3>
    <p>O tratamento de dados é fundamentado no <strong>cumprimento de contrato</strong> (art. 7º, V da LGPD) e no <strong>legítimo interesse</strong> (art. 7º, IX da LGPD) para melhoria dos serviços.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">5. Compartilhamento de Dados</h3>
    <p>Os dados <strong>não são vendidos ou compartilhados</strong> com terceiros para fins comerciais. São compartilhados apenas com fornecedores de infraestrutura essencial (Supabase para banco de dados, Anthropic para IA), todos com políticas de privacidade compatíveis com a LGPD.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">6. Armazenamento e Segurança</h3>
    <p>Os dados são armazenados em servidores seguros com criptografia em trânsito (TLS) e em repouso. Backups automáticos são realizados diariamente. O sistema implementa controle de acesso baseado em papéis (RBAC) e políticas de segurança no nível do banco de dados (RLS).</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">7. Retenção de Dados</h3>
    <p>Os dados são mantidos pelo período necessário à prestação do serviço e pelo prazo legal aplicável à documentação contábil (5 anos, conforme art. 1.194 do Código Civil). Após o encerramento da conta, os dados podem ser solicitados para exclusão.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">8. Direitos do Titular</h3>
    <p>Nos termos da LGPD, o titular tem direito a: confirmação de tratamento, acesso, correção, portabilidade, eliminação, informação sobre compartilhamento e revogação de consentimento. Para exercer esses direitos, entre em contato pelo suporte.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">9. Dados Biométricos</h3>
    <p>O reconhecimento facial é opcional e requer consentimento explícito. Os dados biométricos são processados localmente e armazenados de forma criptografada. O usuário pode desativar e solicitar a exclusão a qualquer momento nas configurações do perfil.</p>

    <h3 style="font-size:14px;font-weight:700;margin:20px 0 8px">10. Contato (DPO)</h3>
    <p>Para questões sobre privacidade e proteção de dados, entre em contato com nosso encarregado (DPO) pelo suporte do sistema.</p>
  `;
}
