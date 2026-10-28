import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import minuta from '../../../supabase/functions/_shared/contracts/minuta-2026-1.json';
import { fill, fillContract, variables, type ContractData } from '../../../supabase/functions/_shared/contracts/template';
import { renderContractPdf, sha256Hex } from '../../../supabase/functions/_shared/contracts/pdf';
import { cnpjValid, cpfValid, maskCep, maskDoc, maskPhone } from './br';

const data = (over: Partial<ContractData> = {}): ContractData => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e', number: 'PST-2026-00001', status: 'prepared', sandbox: false,
  version: { code: '2026.1', title: 'Contrato', status: 'published', body: minuta.body as ContractData['version']['body'] },
  commercial: { planId: 'profissional', planVersion: 'abcdef0123456789', planName: 'Profissional', period: 'monthly', price: 24900, discount: 0, total: 24900, coupon: null, trialDays: 10, trialEnd: '2026-11-07', startDate: '2026-10-28', nextDue: '2026-11-07',
    entitlements: { users: 5, branches: 1, products: 5000, whatsapp: 2, aiMessagesPerDay: 30, features: ['Ordens de serviço', 'Relatórios'], modules: ['pdv', 'estoque'] },
    renewal: 'Renovação automática.', cancellation: 'Cancelamento a qualquer momento.', readjustment: 'Aviso de 30 dias.', grace: '5 dias.', notification: 'E-mail.', support: 'Canais publicados.',
    exportDays: '30 dias', exportFormats: 'CSV e PDF', retention: 'Política vigente', integrations: 'Conforme plano', billingMethod: 'InfinitePay (Pix ou cartão)' },
  parties: { provider: { legalName: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legalNature: 'Empresário Individual', brand: 'PISTEC', address: 'Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160', contact: 'marco.boggian@gmail.com | (11) 3621-8304', signerName: 'Marco Antonio Boggian', signerEmail: 'marco.boggian@gmail.com' },
    company: { legalName: 'Moto Prime Comércio Ltda', tradeName: 'Moto Prime', document: '11222333000181', address: 'Rua A, 10, Centro, São Paulo/SP, CEP 01001-000', phone: '11999990000', email: 'loja@x.invalid' },
    representative: { name: 'João Representante', cpf: '52998224725', role: 'Sócio', email: 'joao@x.invalid', phone: '11988887777' } }, ...over });

describe('minuta oficial e preenchimento', () => {
  it('a minuta 2026.1 vem do .docx fornecido: 14 cláusulas + 2 anexos, contratada como variável', () => {
    expect(minuta.body.sections.map(s => s.title.split(' — ')[0])).toEqual([...Array.from({ length: 14 }, (_, i) => `CLÁUSULA ${i + 1}`), 'ANEXO I', 'ANEXO II']);
    expect(JSON.stringify(minuta.body)).not.toContain('MARCO ANTONIO');
    expect(minuta.source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('preenche todas as variáveis com os dados congelados; contratada correta; nenhum {{ }} sobra', () => {
    const f = fillContract(data()), text = JSON.stringify(f);
    expect(text).not.toMatch(/\{\{/);
    expect(f.summary[0][1]).toBe('59.760.458 MARCO ANTONIO BOGGIAN');
    expect(text).toContain('59.760.458/0001-91'); expect(text).toContain('11.222.333/0001-81'); expect(text).toContain('529.982.247-25');
    expect(text).toContain('R$ 249,00'); expect(text).toContain('10 dias'); expect(text).toContain('até 5 usuários');
    expect(f.draftNotice).toBeNull();
  });
  it('rascunho/sandbox são marcados; variável vazia impede gerar documento final', () => {
    expect(fillContract(data({ version: { ...data().version, status: 'draft' } })).draftNotice).toMatch(/NÃO aprovada juridicamente/);
    expect(fillContract(data({ sandbox: true })).draftNotice).toMatch(/SEM VALIDADE CONTRATUAL/);
    expect(() => fill('{{representante_nome}}', { ...variables(data()), representante_nome: ' ' })).toThrow(/sem valor/);
    expect(() => fillContract(data({ parties: { ...data().parties, company: { ...data().parties.company, legalName: '' } } }))).toThrow(/empresa_razao_social/);
  });
  it('assinatura e hash nunca aparecem como concluídos antes do provedor', () => {
    const v = variables(data());
    expect(v.assinatura_cliente_referencia).toMatch(/provedor/); expect(v.data_hora_conclusao).toMatch(/provedor/);
  });
});

describe('PDF do contrato', () => {
  it('gera PDF A4 paginado, com metadados, e é reproduzível (mesmo contrato = mesmo hash)', async () => {
    const lib = { PDFDocument, StandardFonts, rgb }, f = fillContract(data()), meta = { number: 'PST-2026-00001', createdAt: '2026-10-28T12:00:00Z' };
    const a = await renderContractPdf(lib, f, meta), b = await renderContractPdf(lib, f, meta);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBeGreaterThan(3); expect(doc.getTitle()).toContain('PST-2026-00001');
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 0);
    const other = await renderContractPdf(lib, fillContract(data({ commercial: { ...data().commercial, total: 1 } })), meta);
    expect(await sha256Hex(other)).not.toBe(await sha256Hex(a));
  });
});

describe('validações brasileiras (espelho das funções SQL)', () => {
  it('CPF e CNPJ com dígitos verificadores; máscaras', () => {
    expect(cpfValid('529.982.247-25')).toBe(true); expect(cpfValid('111.111.111-11')).toBe(false); expect(cpfValid('529.982.247-24')).toBe(false);
    expect(cnpjValid('11.222.333/0001-81')).toBe(true); expect(cnpjValid('59.760.458/0001-91')).toBe(true); expect(cnpjValid('11.222.333/0001-80')).toBe(false);
    expect(maskDoc('11222333000181')).toBe('11.222.333/0001-81'); expect(maskDoc('52998224725')).toBe('529.982.247-25');
    expect(maskCep('05109160')).toBe('05109-160'); expect(maskPhone('11988887777')).toBe('(11) 98888-7777');
  });
});

describe('webhook Autentique (HMAC)', () => {
  it('aceita só a assinatura HMAC-SHA256 correta do corpo bruto', async () => {
    const { verifyWebhook } = await import('../../../supabase/functions/_shared/autentique.verify');
    const raw = '{"event":{"type":"document.finished"}}', secret = 'segredo-de-teste';
    const good = createHmac('sha256', secret).update(raw).digest('hex');
    expect(await verifyWebhook(raw, good, secret)).toBe(true);
    expect(await verifyWebhook(raw + ' ', good, secret)).toBe(false);
    expect(await verifyWebhook(raw, good, 'outro')).toBe(false);
    expect(await verifyWebhook(raw, null, secret)).toBe(false);
    expect(await verifyWebhook(raw, 'zz', secret)).toBe(false);
  });
});
