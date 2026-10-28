// Templates transacionais PISTEC (HTML com tabelas e estilos inline: compatível com Gmail/Outlook/celular).
// Todo dado variável passa por esc(). Links só para APP_URL.
import { TITLES } from './documents/model.ts';

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (cents: unknown) => (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (iso: unknown) => { const d = new Date(String(iso) + (String(iso).length === 10 ? 'T12:00:00Z' : '')); return isNaN(+d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); };

type Data = Record<string, unknown>;
const label = (d: Data) => TITLES[String(d.title) as keyof typeof TITLES] ?? 'Documento';
type Template = { subject: (d: Data) => string; lines: (d: Data) => string[]; cta?: { label: string; path: (d: Data) => string } };

export const templates: Record<string, Template> = {
  welcome: { subject: () => 'Bem-vindo ao PISTEC', lines: d => [`A empresa <strong>${esc(d.tenant)}</strong> foi cadastrada.`, `Seu período de teste vai até <strong>${esc(date(d.trialEnds))}</strong>. Nenhuma cobrança é feita durante o teste.`], cta: { label: 'Acessar o PISTEC', path: () => '/app' } },
  invite: { subject: d => `Convite para ${esc(d.tenant)} no PISTEC`, lines: d => [`Você foi convidado para a equipe de <strong>${esc(d.tenant)}</strong> como <strong>${esc(d.role)}</strong>.`, 'O convite vale por 7 dias. Use uma conta com este mesmo e-mail.'], cta: { label: 'Aceitar convite', path: d => `/app/convite/${encodeURIComponent(String(d.token))}` } },
  invoice_created: { subject: () => 'Fatura da sua assinatura PISTEC', lines: d => [`Uma fatura de <strong>${esc(money(d.amount))}</strong> foi gerada para <strong>${esc(d.tenant)}</strong>.`, `Vencimento: <strong>${esc(date(d.dueDate))}</strong>. Pague por Pix ou cartão em Minha assinatura.`], cta: { label: 'Ver fatura', path: () => '/app' } },
  payment_confirmed: { subject: () => 'Pagamento confirmado', lines: d => [`Recebemos o pagamento de <strong>${esc(money(d.amount))}</strong>.`, `Sua assinatura está ativa até <strong>${esc(date(d.paidUntil))}</strong>.`] },
  invoice_overdue: { subject: () => 'Fatura vencida — evite a suspensão', lines: d => [`A fatura de <strong>${esc(money(d.amount))}</strong> venceu em <strong>${esc(date(d.dueDate))}</strong>.`, 'Após 5 dias de atraso o acesso fica somente leitura até o pagamento.'], cta: { label: 'Pagar agora', path: () => '/app' } },
  trial_ending: { subject: () => 'Seu teste do PISTEC está terminando', lines: d => [`O teste de <strong>${esc(d.tenant)}</strong> termina em <strong>${esc(date(d.periodEnd))}</strong>.`, 'Escolha um plano em Minha assinatura para continuar sem interrupção.'], cta: { label: 'Escolher plano', path: () => '/app' } },
  // Documento de loja (comprovante, orçamento, OS): nome da loja; logo não é embutido (data URL é bloqueado por clientes de e-mail).
  // O link é de consulta segura, com validade.
  document: { subject: d => `${esc(label(d))} ${esc(d.number)} — ${esc(d.store)}`, lines: d => [`Olá${d.customer ? `, <strong>${esc(d.customer)}</strong>` : ''}.`, `<strong>${esc(d.store)}</strong> enviou o documento <strong>${esc(label(d))} ${esc(d.number)}</strong>.`, ...(d.message ? [esc(d.message)] : []), 'O link abaixo vale por 7 dias. Documento não fiscal.'], cta: { label: 'Ver documento', path: d => `/d/${encodeURIComponent(String(d.token))}` } },
  contract_signed: { subject: () => 'Seu contrato PISTEC foi assinado com sucesso', lines: d => [`Olá, <strong>${esc(d.name)}</strong>.`, `O contrato <strong>${esc(d.number)}</strong> da empresa <strong>${esc(d.company)}</strong> (plano ${esc(d.plan)}) foi assinado por todas as partes em ${esc(date(d.signedAt))}.`, 'O documento assinado, o certificado de assinatura e o histórico estão em Minha assinatura → Contratos e documentos (acesso com login).', 'Dúvidas: responda pelos canais de suporte publicados no PISTEC.'], cta: { label: 'Acessar meu contrato', path: d => `/app/loja/${encodeURIComponent(String(d.slug))}/minha-assinatura` } },
  suspended: { subject: () => 'Assinatura suspensa', lines: d => [`A assinatura de <strong>${esc(d.tenant)}</strong> foi suspensa por falta de pagamento.`, 'Seus dados estão preservados. O acesso volta assim que o pagamento for confirmado.'], cta: { label: 'Regularizar', path: () => '/app' } },
};

export function render(template: string, data: Data, appUrl: string) {
  const t = templates[template];
  if (!t) throw new Error(`Template desconhecido: ${template}`);
  const base = new URL(appUrl);
  const subject = t.subject(data).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lines = t.lines(data);
  const href = t.cta ? new URL(t.cta.path(data), base).href : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#eef2f8;font-family:Segoe UI,Arial,sans-serif;color:#0b1f3a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#061b3d;padding:20px 28px"><img src="${esc(new URL('/brand/symbol.webp', base).href)}" alt="PISTEC" height="32" style="vertical-align:middle"> <span style="color:#fff;font-weight:700;font-size:18px;vertical-align:middle;margin-left:8px">PISTEC</span></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55">${lines.map(l => `<p style="margin:0 0 14px">${l}</p>`).join('')}
${href ? `<p style="margin:24px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#007bff;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(t.cta!.label)}</a></p>` : ''}</td></tr>
<tr><td style="padding:16px 28px;background:#f6f8fc;font-size:12px;color:#5b6b85">PISTEC — Tecnologia que move seu negócio. Mensagem automática; não responda.</td></tr>
</table></td></tr></table></body></html>`;
  const text = lines.map(l => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")).join('\n\n') + (href ? `\n\n${t.cta!.label}: ${href}` : '');
  return { subject, html, text };
}

/** Erros permanentes do Resend (não adianta repetir). */
export const permanent = (status: number) => status >= 400 && status < 500 && status !== 429 && status !== 408;

/** Verificação Svix (Resend): HMAC-SHA256 de `id.timestamp.body`, segredo `whsec_<base64>`, tolerância 5 min. */
export async function verifySvix(secret: string, id: string, timestamp: string, signatures: string, body: string, now = Date.now()) {
  if (!id || !timestamp || !signatures || !secret.startsWith('whsec_')) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  for (const part of signatures.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    let given: Uint8Array; try { given = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { continue; }
    if (given.length === expected.length && given.reduce((d, b, i) => d | (b ^ expected[i]), 0) === 0) return true;
  }
  return false;
}

/** Nome de exibição da loja + endereço técnico verificado do PISTEC (nunca falsifica o domínio do remetente). */
export const displayFrom = (from: string, store: string) => `${store.replace(/["<>\\\r\n]/g, '').slice(0, 60)} via PISTEC <${(from.match(/<([^>]+)>/)?.[1] ?? from).trim()}>`;
