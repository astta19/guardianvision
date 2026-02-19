// netlify/functions/notificacoes-prazos.js
// Executa diariamente às 08h (horário de Brasília = 11h UTC)
// Instalar dependência: npm install @resend/node
//
// Variáveis de ambiente necessárias no Netlify:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   RESEND_API_KEY  ← obter em resend.com (gratuito até 3.000/mês)

const schedule = require('@netlify/functions').schedule;

const OBRIGACOES = [
  { id: 'das',         label: 'DAS Simples Nacional',  dia: 20, mensal: true  },
  { id: 'dctfweb',     label: 'DCTFWeb',               dia: 28, mensal: true  },
  { id: 'efd_reinf',   label: 'EFD-Reinf',             dia: 15, mensal: true  },
  { id: 'esocial',     label: 'eSocial (folha)',        dia: 15, mensal: true  },
  { id: 'efd_contrib', label: 'EFD-Contribuições',     dia: 10, mensal: true  },
  { id: 'dasn_simei',  label: 'DASN-SIMEI (MEI)',      dia: 31, mes: 5        },
  { id: 'defis',       label: 'DEFIS (Simples)',        dia: 31, mes: 3        },
  { id: 'ecd',         label: 'ECD',                   dia: 30, mes: 6        },
  { id: 'ecf',         label: 'ECF',                   dia: 31, mes: 7        },
  { id: 'dirpf',       label: 'DIRPF (PF)',            dia: 29, mes: 5        },
];

function calcularDiasAte(dia, mes, mensal) {
  const hoje = new Date();
  let prazo;
  if (mensal) {
    prazo = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
    if (prazo < hoje) prazo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
  } else {
    prazo = new Date(hoje.getFullYear(), mes - 1, dia);
    if (prazo < hoje) prazo = new Date(hoje.getFullYear() + 1, mes - 1, dia);
  }
  return Math.ceil((prazo - hoje) / (1000 * 60 * 60 * 24));
}

function formatarData(dia, mes, mensal) {
  if (mensal) {
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const hoje = new Date();
    const m = new Date(hoje.getFullYear(), hoje.getMonth(), dia) < hoje
      ? hoje.getMonth() + 1 : hoje.getMonth();
    return `${String(dia).padStart(2,'0')}/${meses[m]}`;
  }
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${String(dia).padStart(2,'0')}/${meses[mes-1]}`;
}

async function buscarUsuariosComNotif() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/notificacoes_config?select=user_id,email_notif,antecedencia_dias,obrigacoes_ativas&obrigacoes_ativas=not.eq.{}`,
    { headers }
  );
  return res.ok ? res.json() : [];
}

async function enviarEmail(para, assunto, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Fiscal365 <noreply@fiscal365.com.br>',
      to: [para],
      subject: assunto,
      html
    })
  });
  return res.ok;
}

function gerarHtmlEmail(prazos) {
  const linhas = prazos.map(p => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px">${p.label}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center">${p.data}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:${p.dias <= 3 ? '#dc2626' : p.dias <= 7 ? '#d97706' : '#16a34a'};font-weight:600">${p.dias} dia(s)</td>
    </tr>`).join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
      <div style="background:#000;padding:24px 28px">
        <h1 style="color:#fff;margin:0;font-size:20px">Fiscal365</h1>
        <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px">Alertas de prazos fiscais</p>
      </div>
      <div style="padding:24px 28px">
        <p style="font-size:15px;color:#1a1a1a;margin-top:0">Você tem <strong>${prazos.length} obrigação(ões) fiscal(is) próxima(s)</strong>:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Obrigação</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Vencimento</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Faltam</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
        <a href="https://fiscalchat.netlify.app" style="display:inline-block;background:#000;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Abrir Fiscal365 →</a>
      </div>
      <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">
        <p style="font-size:11px;color:#94a3b8;margin:0">Para cancelar estas notificações, acesse seu perfil no Fiscal365 e desative as obrigações desejadas.</p>
      </div>
    </div>
  </body>
  </html>`;
}

const handler = async () => {
  try {
    const configs = await buscarUsuariosComNotif();
    let enviados = 0;

    for (const config of configs) {
      const { email_notif, antecedencia_dias = 7, obrigacoes_ativas = [] } = config;
      if (!email_notif || !obrigacoes_ativas.length) continue;

      // Calcular prazos relevantes dentro da antecedência configurada
      const prazos = OBRIGACOES
        .filter(ob => obrigacoes_ativas.includes(ob.id))
        .map(ob => ({
          ...ob,
          dias: calcularDiasAte(ob.dia, ob.mes, ob.mensal),
          data: formatarData(ob.dia, ob.mes, ob.mensal)
        }))
        .filter(ob => ob.dias > 0 && ob.dias <= antecedencia_dias)
        .sort((a, b) => a.dias - b.dias);

      if (!prazos.length) continue;

      const assunto = prazos.length === 1
        ? `⚠️ ${prazos[0].label} vence em ${prazos[0].dias} dia(s) — Fiscal365`
        : `⚠️ ${prazos.length} prazos fiscais próximos — Fiscal365`;

      const ok = await enviarEmail(email_notif, assunto, gerarHtmlEmail(prazos));
      if (ok) enviados++;
    }

    console.log(`Notificações enviadas: ${enviados}/${configs.length}`);
    return { statusCode: 200 };
  } catch (e) {
    console.error('Erro ao enviar notificações:', e);
    return { statusCode: 500 };
  }
};

// Rodar todo dia às 11h UTC (08h Brasília)
exports.handler = schedule('0 11 * * *', handler);
