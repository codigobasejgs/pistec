// Preenchimento do contrato a partir dos dados CONGELADOS no servidor (contract_detail). Sem dependências: navegador e Deno.
// Nenhum campo pode ficar vazio em contrato final; se faltar dado, fill() falha em vez de gerar documento incompleto.

export interface ContractBody { title: string; subtitle: string; summaryTitle: string; summary: [string, string][]; summaryNote: string; sections: { title: string; paragraphs: string[] }[]; signatureTitle: string; signatureBlock: string[] }
export interface Commercial { planId: string; planVersion: string; planName: string; period: string; price: number; discount: number; total: number; coupon: string | null; trialDays: number; trialEnd: string | null; startDate: string; nextDue: string;
  entitlements: { users: number; branches: number; products: number; whatsapp: number; aiMessagesPerDay: number; features: string[]; modules: string[] }; renewal: string; cancellation: string; readjustment: string; grace: string; notification: string;
  support: string; exportDays: string; exportFormats: string; retention: string; integrations: string; billingMethod: string }
export interface Parties { provider: { legalName: string; document: string; legalNature: string; brand: string; address: string; contact: string; signerName: string; signerEmail: string };
  company: { legalName: string; tradeName: string; document: string; address: string; phone: string; email: string }; representative: { name: string; cpf: string; role: string; email: string; phone: string } }
export interface ContractData { id: string; number: string; status: string; sandbox: boolean; commercial: Commercial; parties: Parties; version: { code: string; title: string; status: string; body: ContractBody };
  signedAt?: string | null; signedSha256?: string | null; documentSha256?: string | null }

const PERIOD: Record<string, string> = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };
export const brl = (c: number) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = (iso?: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
const docMask = (d: string) => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;
const phoneMask = (d: string) => d.replace(/^55/, '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

/** Mapa das variáveis da minuta → valores congelados. Assinaturas/hash ficam com marcador explícito até a conclusão no provedor. */
export function variables(c: ContractData): Record<string, string> {
  const k = c.commercial, p = c.parties, e = k.entitlements;
  const pending = 'registrado pelo provedor de assinatura eletrônica na conclusão';
  return {
    contratada_nome: p.provider.legalName, contratada_cnpj: p.provider.document, contratada_marca: p.provider.brand, contratada_natureza: p.provider.legalNature,
    contratada_endereco: p.provider.address, contratada_contato: p.provider.contact,
    empresa_razao_social: p.company.legalName, empresa_nome_fantasia: p.company.tradeName, empresa_documento: docMask(p.company.document), empresa_endereco_completo: p.company.address,
    representante_nome: p.representative.name, representante_cpf: docMask(p.representative.cpf), representante_cargo: p.representative.role,
    representante_email: p.representative.email, representante_telefone: phoneMask(p.representative.phone),
    plano_nome: k.planName, plano_id: k.planId, plano_versao: k.planVersion.slice(0, 12), periodicidade: PERIOD[k.period] ?? k.period,
    valor_plano: brl(k.price), preco_base: brl(k.price), desconto_cupom_se_houver: k.discount ? `Desconto ${brl(k.discount)}${k.coupon ? ` (cupom ${k.coupon})` : ''}` : 'Sem desconto',
    cupom_aplicado: k.coupon ? `${k.coupon} (${brl(k.discount)})` : 'nenhum', valor_total_contratado: `${brl(k.total)} por período ${(PERIOD[k.period] ?? k.period).toLowerCase()}`,
    dias_teste: k.trialDays ? `período restante do teste gratuito de 1 mês calendário (${k.trialDays} dia(s), até ${day(k.trialEnd)})` : 'Sem período de teste nesta contratação', data_inicio_teste: k.trialDays ? day(k.startDate) : '—', data_fim_teste: k.trialDays ? day(k.trialEnd) : '—',
    condicoes_teste: k.trialDays ? `sem cobrança até ${day(k.trialEnd)}; a primeira cobrança vence nessa data e só é efetuada com pagamento confirmado pelo CONTRATANTE` : 'não aplicável',
    meio_cobranca: k.billingMethod, data_proximo_vencimento: day(k.nextDue), data_inicio: day(k.startDate), regra_renovacao: k.renewal, regra_cancelamento: k.cancellation, regra_reajuste: k.readjustment,
    prazo_tolerancia: k.grace, procedimento_notificacao: k.notification, condicoes_suporte_sla: k.support, prazo_exportacao: k.exportDays, formatos_exportacao: k.exportFormats, politica_retencao_versao: k.retention,
    integracoes_contratadas: k.integrations,
    snapshot_recursos_entitlements: `até ${e.users} usuários, ${e.branches} filial(is), ${e.products.toLocaleString('pt-BR')} produtos, ${e.whatsapp} conexão(ões) de WhatsApp, ${e.aiMessagesPerDay} consultas de IA/dia; módulos: ${e.modules.includes('*') ? 'todos os módulos da plataforma' : e.modules.join(', ')}; destaques: ${e.features.join('; ')}`,
    contract_id: `${c.number} (${c.id})`, data_hora_assinatura: c.signedAt ? new Date(c.signedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : pending,
    data_hora_conclusao: c.signedAt ? new Date(c.signedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : pending,
    signatario_contratada_nome: p.provider.signerName || 'a definir pela CONTRATADA', assinatura_contratada_referencia: pending, assinatura_cliente_referencia: pending,
    sha256_documento: 'calculado sobre este PDF e registrado na trilha de auditoria (vide certificado do provedor)', url_verificacao_documento: 'certificado de assinatura emitido pela Autentique, anexo ao documento final',
  };
}

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => { const v = vars[key]; if (v == null || String(v).trim() === '') throw new Error(`Variável do contrato sem valor: ${key}`); return String(v); });
}

export interface Filled { title: string; subtitle: string; draftNotice: string | null; summaryTitle: string; summary: [string, string][]; summaryNote: string; sections: { title: string; paragraphs: string[] }[]; signatureTitle: string; signatureBlock: string[]; footer: string }
export function fillContract(c: ContractData): Filled {
  const v = variables(c), b = c.version.body;
  const draft = c.version.status !== 'published' || c.sandbox;
  return { title: b.title, subtitle: b.subtitle,
    draftNotice: draft ? `${c.sandbox ? 'HOMOLOGAÇÃO (SANDBOX) — SEM VALIDADE CONTRATUAL. ' : ''}Versão ${c.version.code} ${c.version.status === 'published' ? 'publicada' : 'NÃO aprovada juridicamente (rascunho)'}.` : null,
    summaryTitle: b.summaryTitle, summary: b.summary.map(([k, t]) => [k, fill(t, v)]), // A nota da minuta explica os marcadores {{...}}; no documento preenchido isso vira texto descritivo.
    summaryNote: fill(b.summaryNote.replace('Campos {{...}} serão preenchidos', 'Os campos deste quadro foram preenchidos'), v),
    sections: b.sections.map(s => ({ title: s.title, paragraphs: s.paragraphs.map(p => fill(p, v)) })), signatureTitle: b.signatureTitle, signatureBlock: b.signatureBlock.map(l => fill(l, v)),
    footer: `Contrato ${c.number} · versão ${c.version.code} · ${c.parties.provider.brand} — ${c.parties.provider.legalName}, CNPJ ${c.parties.provider.document}` };
}
