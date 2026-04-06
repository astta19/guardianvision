// api/esocial-transmitir.js — Vercel Serverless Function
// Transmissão real ao eSocial via REST API + certificado A1 (.pfx)
//
// Variáveis de ambiente necessárias (Vercel Dashboard → Settings → Environment Variables):
//   ESOCIAL_CERT_PFX_B64  — certificado A1 em base64  (openssl base64 -in cert.pfx | tr -d '\n')
//   ESOCIAL_CERT_SENHA    — senha do certificado .pfx
//   ESOCIAL_AMBIENTE      — "1" = produção | "2" = homologação (padrão: "2")
//   SUPABASE_URL          — já existente no projeto
//   SUPABASE_SERVICE_KEY  — já existente no projeto
//
// Endpoints oficiais:
//   Homologação : https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/envioLoteEventos/WsEnvioLoteEventos.svc
//   Produção    : https://webservices.esocial.gov.br/servicos/empregador/envioLoteEventos/WsEnvioLoteEventos.svc

import { create } from 'xmlbuilder2';
import { SignedXml } from 'xml-crypto';
import forge from 'node-forge';
import https from 'https';
import { createHash, randomUUID } from 'crypto';

// ── Constantes ─────────────────────────────────────────────────
const XMLNS   = 'http://www.esocial.gov.br/schema/lote/envio/v01_01_00';
const XMLNS_S2200 = 'http://www.esocial.gov.br/schema/evt/evtAdmissao/v02_05_00';
const XMLNS_SIG   = 'http://www.w3.org/2000/09/xmldsig#';

const ENDPOINTS = {
  '1': 'https://webservices.esocial.gov.br/servicos/empregador/envioLoteEventos/WsEnvioLoteEventos.svc',
  '2': 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/envioLoteEventos/WsEnvioLoteEventos.svc',
};

// ── Handler principal ──────────────────────────────────────────
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Método não permitido' });

  // ── 1. Validar variáveis de ambiente ─────────────────────────
  const certB64 = process.env.ESOCIAL_CERT_PFX_B64;
  const certSenha = process.env.ESOCIAL_CERT_SENHA;
  if (!certB64 || !certSenha) {
    return res.status(500).json({
      ok: false,
      erro: 'Certificado digital não configurado.',
      detalhe: 'Configure ESOCIAL_CERT_PFX_B64 e ESOCIAL_CERT_SENHA nas variáveis de ambiente do Vercel.',
    });
  }

  // ── 2. Validar body ──────────────────────────────────────────
  const { evento, dados, cnpjEmpregador } = req.body || {};
  if (!evento || !dados || !cnpjEmpregador) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: evento, dados, cnpjEmpregador' });
  }
  if (evento !== 'S-2200') {
    return res.status(400).json({ ok: false, erro: `Evento "${evento}" ainda não implementado.` });
  }

  const ambiente = process.env.ESOCIAL_AMBIENTE || '2';
  const endpoint = ENDPOINTS[ambiente];

  try {
    // ── 3. Carregar certificado A1 ───────────────────────────
    const pfxBuffer = Buffer.from(certB64, 'base64');
    const { privateKey, certificate } = carregarCertificado(pfxBuffer, certSenha);

    // ── 4. Montar XML do evento ──────────────────────────────
    const eventoId = `ID${cnpjEmpregador.replace(/\D/g,'')}${Date.now()}`;
    const xmlEvento = montarXmlS2200(dados, cnpjEmpregador, ambiente, eventoId);

    // ── 5. Assinar XML ───────────────────────────────────────
    const xmlAssinado = assinarXml(xmlEvento, privateKey, certificate, eventoId);

    // ── 6. Montar lote de envio ──────────────────────────────
    const nrLote = Date.now().toString();
    const xmlLote = montarLoteEnvio(xmlAssinado, cnpjEmpregador, nrLote, ambiente);

    // ── 7. Transmitir ao governo ─────────────────────────────
    const resposta = await transmitirLote(xmlLote, endpoint, pfxBuffer, certSenha);

    // ── 8. Parsear retorno ───────────────────────────────────
    const resultado = parsearRetorno(resposta);

    // ── 9. Salvar resultado no Supabase ──────────────────────
    await salvarLog({
      evento,
      cnpj_empregador: cnpjEmpregador,
      funcionario_id: dados.funcionario_id || null,
      ambiente,
      nr_lote: nrLote,
      protocolo: resultado.protocolo || null,
      status: resultado.ok ? 'enviado' : 'erro',
      retorno_raw: resposta.slice(0, 2000),
    });

    return res.status(200).json({
      ok: resultado.ok,
      protocolo: resultado.protocolo,
      dataEnvio: new Date().toISOString(),
      ambiente: ambiente === '1' ? 'producao' : 'homologacao',
      mensagem: resultado.mensagem,
    });

  } catch (e) {
    console.error('[esocial-transmitir] Erro:', e.message);
    return res.status(500).json({
      ok: false,
      erro: e.message,
      detalhe: e.stack?.split('\n')[1] || null,
    });
  }
}

// ── Carregar certificado PFX ───────────────────────────────────
function carregarCertificado(pfxBuffer, senha) {
  const pfxDer   = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const pfxAsn1  = forge.asn1.fromDer(pfxDer);
  const pfx      = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, senha);

  // Extrair chave privada
  const keyBags  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag   = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no certificado.');
  const privateKey = forge.pki.privateKeyToPem(keyBag.key);

  // Extrair certificado público
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const certBag  = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error('Certificado público não encontrado no .pfx.');
  const certificate = forge.pki.certificateToPem(certBag.cert);

  // Validar validade
  const notAfter = certBag.cert.validity.notAfter;
  if (new Date() > notAfter) throw new Error(`Certificado vencido em ${notAfter.toLocaleDateString('pt-BR')}.`);

  return { privateKey, certificate };
}

// ── Montar XML S-2200 leiaute 2.5 ─────────────────────────────
function montarXmlS2200(d, cnpj, ambiente, eventoId) {
  const cnpjLimpo = cnpj.replace(/\D/g, '').slice(0, 8); // raiz CNPJ (8 dígitos)

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(XMLNS_S2200, 'eSocial')
      .ele('evtAdmissao', { Id: eventoId })

        .ele('ideEvento')
          .ele('indRetif').txt('1').up()        // 1=original, 2=retificação
          .ele('tpAmb').txt(ambiente).up()       // 1=prod, 2=homolog
          .ele('procEmi').txt('1').up()          // 1=app do empregador
          .ele('verProc').txt('1.0').up()
        .up()

        .ele('ideEmpregador')
          .ele('tpInsc').txt('1').up()           // 1=CNPJ
          .ele('nrInsc').txt(cnpjLimpo).up()
        .up()

        .ele('trabalhador')
          .ele('cpfTrab').txt((d.cpf || '').replace(/\D/g,'')).up()
          .ele('nmTrab').txt(d.nome || '').up()
          .ele('sexo').txt(d.sexo || 'M').up()
          .ele('racaCor').txt(d.raca_cor || '9').up()    // 9=não informado
          .ele('estCiv').txt(_estCivCodigo(d.estado_civil)).up()
          .ele('grauInstr').txt(d.grau_instrucao || '01').up()
          .ele('nmMae').txt(d.nome_mae || '').up()
          .ele('nascimento')
            .ele('dtNasc').txt(d.data_nascimento || '').up()
            .ele('paisNasc').txt('105').up()     // 105=Brasil
            .ele('nacionalidade').txt('10').up() // 10=brasileiro nato
          .up()
          .ele('endereco')
            .ele('brasil')
              .ele('tpLograd').txt('R').up()     // R=Rua
              .ele('dscLograd').txt(d.logradouro || '').up()
              .ele('nrLograd').txt(d.numero || 'S/N').up()
              .ele('complemento').txt(d.complemento || '').up()
              .ele('bairro').txt(d.bairro || '').up()
              .ele('cep').txt((d.cep || '').replace(/\D/g,'')).up()
              .ele('codMunic').txt(d.cod_municipio || '').up()
              .ele('uf').txt(d.uf || '').up()
            .up()
          .up()
          .ele('infoDocumentos')
            .ele('ctps')
              .ele('nrCtps').txt((d.ctps || '').split(/[\s·]/)[0]?.replace(/\D/g,'') || '0').up()
              .ele('dtExped').txt('2000-01-01').up()  // campo obrigatório — idealmente no cadastro
              .ele('uf').txt(d.uf || 'SP').up()
            .up()
          .up()
        .up()

        .ele('vinculo')
          .ele('matricula').txt(d.matricula || eventoId.slice(-8)).up()
          .ele('tpRegTrab').txt('1').up()        // 1=CLT
          .ele('tpRegPrev').txt('1').up()        // 1=RGPS
          .ele('cadIni').txt('S').up()
          .ele('infoRegCLT')
            .ele('dtAdm').txt(d.admissao || '').up()
            .ele('tpAdmissao').txt('1').up()
            .ele('indAdmissao').txt('1').up()
            .ele('nrProcTrab').txt('').up()
            .ele('tpRegJor').txt('1').up()
            .ele('natAtividade').txt('1').up()
            .ele('dtBase').txt(String(new Date().getMonth() + 1).padStart(2,'0')).up()
            .ele('cnpjSindLaboral').txt('').up()
          .up()
          .ele('dadosContrato')
            .ele('codCateg').txt(d.categoria_esocial || '101').up()
            .ele('remuneracao')
              .ele('vrSalFx').txt(String(d.salario_base || 0)).up()
              .ele('undSalFixo').txt('5').up()   // 5=mensal
            .up()
            .ele('FGTS')
              .ele('optFGTS').txt('1').up()
              .ele('dtOpcFGTS').txt(d.admissao || '').up()
            .up()
            .ele('jornada')
              .ele('qtdHrsSem').txt(String(d.jornada_horas || 44)).up()
              .ele('tpJornada').txt('2').up()
              .ele('horNoturno').txt('N').up()
            .up()
          .up()
        .up()

      .up() // evtAdmissao
    .up(); // eSocial

  return root.end({ prettyPrint: false });
}

// ── Assinar XML com certificado A1 ────────────────────────────
function assinarXml(xmlStr, privateKeyPem, certificatePem, referenceId) {
  const sig = new SignedXml({ privateKey: privateKeyPem });

  // Algoritmos exigidos pelo eSocial
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

  sig.addReference({
    xpath: `//*[@Id='${referenceId}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });

  // Adicionar certificado ao KeyInfo
  const certDer = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certDer}</X509Certificate></X509Data>`,
  };

  sig.computeSignature(xmlStr, {
    location: { reference: `//*[@Id='${referenceId}']`, action: 'append' },
  });

  return sig.getSignedXml();
}

// ── Montar envelope de lote ────────────────────────────────────
function montarLoteEnvio(xmlEvento, cnpj, nrLote, ambiente) {
  const cnpjLimpo = cnpj.replace(/\D/g, '').slice(0, 8);
  return create({ version: '1.0', encoding: 'UTF-8' })
    .ele(XMLNS, 'eSocial')
      .ele('envioLoteEventos', { grupo: '1' })
        .ele('ideEmpregador')
          .ele('tpInsc').txt('1').up()
          .ele('nrInsc').txt(cnpjLimpo).up()
        .up()
        .ele('ideTransmissor')
          .ele('tpInsc').txt('1').up()
          .ele('nrInsc').txt(cnpj.replace(/\D/g,'')).up()
        .up()
        .ele('eventos')
          .ele('evento', { Id: `lote${nrLote}` })
            // Inserir XML do evento já assinado como nó filho
            .import(create(xmlEvento).root())
          .up()
        .up()
      .up()
    .up()
    .end({ prettyPrint: false });
}

// ── Transmitir lote ao webservice ─────────────────────────────
async function transmitirLote(xmlLote, endpoint, pfxBuffer, senha) {
  // Configurar agente HTTPS com mTLS (certificado do cliente)
  const pfxDer  = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx     = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, senha);

  const keyBags  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyPem   = forge.pki.privateKeyToPem(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key);
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const certPem  = forge.pki.certificateToPem(certBags[forge.pki.oids.certBag][0].cert);

  const agent = new https.Agent({
    key:  keyPem,
    cert: certPem,
    rejectUnauthorized: true,
  });

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'SOAPAction': '"http://www.esocial.gov.br/servicos/empregador/lote/WsEnvioLoteEventos/EnviarLoteEventos"',
    },
    body: _envelopeSOAP(xmlLote),
    // @ts-ignore — Node 18 aceita agent no fetch nativo
    agent,
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Governo retornou HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }

  return await resp.text();
}

// ── Envelope SOAP ──────────────────────────────────────────────
function _envelopeSOAP(xmlLote) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ws="http://www.esocial.gov.br/servicos/empregador/lote/WsEnvioLoteEventos">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:EnviarLoteEventos>
      <ws:loteEventos>${xmlLote}</ws:loteEventos>
    </ws:EnviarLoteEventos>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── Parsear retorno do governo ─────────────────────────────────
function parsearRetorno(xmlResposta) {
  // Extrair protocolo do XML de resposta SOAP
  const protocolo = xmlResposta.match(/<nrRec>(.*?)<\/nrRec>/)?.[1] || null;
  const cdResp    = xmlResposta.match(/<cdResp>(.*?)<\/cdResp>/)?.[1] || null;
  const descResp  = xmlResposta.match(/<descResp>(.*?)<\/descResp>/)?.[1] || null;
  const ok        = cdResp === '201' || !!protocolo;

  return {
    ok,
    protocolo,
    mensagem: descResp || (ok ? 'Lote recebido com sucesso.' : 'Erro no envio — verifique o retorno.'),
    cdResp,
  };
}

// ── Salvar log no Supabase ─────────────────────────────────────
async function salvarLog(dados) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return; // silencioso — log é opcional

  try {
    await fetch(`${url}/rest/v1/dp_esocial_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ ...dados, criado_em: new Date().toISOString() }),
    });
  } catch { /* log nunca bloqueia o fluxo principal */ }
}

// ── Helpers ────────────────────────────────────────────────────
function _estCivCodigo(estCivil) {
  const map = {
    solteiro:      '1',
    casado:        '2',
    divorciado:    '3',
    viuvo:         '4',
    uniao_estavel: '5',
  };
  return map[estCivil] || '0'; // 0=não informado
}
