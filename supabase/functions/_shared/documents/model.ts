// Núcleo de documentos PISTEC (compartilhado entre navegador e Edge Functions; sem dependências).
// Snapshot = dados congelados na emissão (empresa, filial, textos e o registro). Doc = layout neutro, renderizado em HTML, PDF ou ESC/POS.

export type DocType = 'sale' | 'payment' | 'sale-cancel' | 'cart' | 'quote' | 'os-entry' | 'os-diagnosis' | 'os-progress' | 'os-done' | 'os-delivery'
  | 'warranty' | 'checklist-in' | 'checklist-out' | 'pick-list' | 'purchase-order' | 'purchase-receipt' | 'cash' | 'settlement' | 'statement' | 'inventory' | 'test';

export interface Company { name: string; legalName: string; document: string; address: string; phone: string; whatsapp: string; email: string; website: string; logo: string }
export interface BranchInfo { name: string; document: string; address: string; phone: string }
export interface Texts { header: string; footer: string; thanks: string; warranty: string; quoteTerms: string; osTerms: string; deliveryTerms: string }
export interface Person { name: string; phone?: string; email?: string; document?: string }
export interface Vehicle { title: string; plate?: string; brand?: string; model?: string; year?: string; mileage?: string; color?: string }
export interface Line { name: string; quantity: number; price: number; sku?: string }
export interface SaleSource { id: string; date: string; seller: string; status: string; items: Line[]; discount: number; surcharge: number; total: number; change: number; payments: { method: string; amount: number; tendered?: number | null }[]; cancelledAt?: string | null; cancelReason?: string | null }
export interface RecordSource { id: string; kind: string; title: string; status: string; date: string; amount: number; fields: Record<string, string>; items: Line[]; history: { date: string; text: string }[] }
export interface CashSource { id: string; openedAt: string; closedAt?: string | null; opening: number; expected?: number | null; counted?: number | null; difference?: number | null; reason?: string | null; closedBy?: string | null; movements: { amount: number; reason: string; date: string }[] }
export interface EntrySource { id: string; type: string; category: string; description: string; amount: number; dueDate: string; cancelled: boolean; settlements: { id: string; amount: number; date: string; method: string; user: string; note: string; reversedAt?: string | null; reversalReason?: string | null }[]; settlementId?: string }
export interface StockSource { rows: { sku: string; name: string; location: string; quantity: number; reserved: number }[] }
export interface Snapshot {
  type: DocType; number: string; issuedAt: string; copy: number; version: number; company: Company; branch: BranchInfo; texts: Texts;
  customer?: Person | null; vehicle?: Vehicle | null; operator?: string; supplier?: Person | null; link?: string;
  sale?: SaleSource; record?: RecordSource; cash?: CashSource; entry?: EntrySource; stock?: StockSource;
}

export type Block =
  | { t: 'title'; text: string }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'table'; head: string[]; rows: string[][]; align: ('l' | 'r' | 'c')[]; widths: number[] }
  | { t: 'totals'; rows: [string, string, boolean?][] }
  | { t: 'text'; text: string; small?: boolean; strong?: boolean }
  | { t: 'checklist'; items: { label: string; checked: boolean | null }[] }
  | { t: 'signature'; labels: string[] }
  | { t: 'qr'; value: string; caption: string }
  | { t: 'barcode'; value: string; caption?: string };
export interface Doc { title: string; subtitle: string; number: string; issuedAt: string; copy: number; version: number; company: Company; branch: BranchInfo; header: string; blocks: Block[]; notices: string[]; footer: string }

export const NON_FISCAL = 'DOCUMENTO NÃO FISCAL. Não substitui nota fiscal (NF-e/NFC-e/NFS-e).';
export const money = (cents: number) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const when = (iso?: string | null, time = true) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso); return isNaN(+d) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }); };
const parseMoney = (v?: string) => { const s = String(v ?? '').trim().replace(/^R\$\s*/, ''); if (!s) return 0; const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const filled = (rows: [string, string | undefined | null][]) => rows.filter((r): r is [string, string] => !!r[1] && String(r[1]).trim() !== '').map(([k, v]) => [k, String(v)] as [string, string]);
const lines = (items: Line[]): Block => ({ t: 'table', head: ['Item', 'Qtd.', 'Unit.', 'Total'], align: ['l', 'r', 'r', 'r'], widths: [0.52, 0.12, 0.18, 0.18],
  rows: items.map(i => [i.sku ? `${i.name} (${i.sku})` : i.name, String(i.quantity), money(i.price), money(i.quantity * i.price)]) });
const sum = (items: Line[]) => items.reduce((s, i) => s + i.quantity * i.price, 0);
const people = (s: Snapshot): Block[] => [
  ...(s.customer ? [{ t: 'kv', rows: filled([['Cliente', s.customer.name], ['Telefone', s.customer.phone], ['Documento', s.customer.document]]) } as Block] : []),
  ...(s.vehicle ? [{ t: 'kv', rows: filled([['Veículo', s.vehicle.title], ['Placa', s.vehicle.plate], ['Marca/modelo', [s.vehicle.brand, s.vehicle.model].filter(Boolean).join(' ')], ['Ano', s.vehicle.year], ['Cor', s.vehicle.color], ['Km', s.vehicle.mileage]]) } as Block] : []),
];
const checklistOf = (text?: string) => String(text ?? '').split(/[\n;,]+/).map(x => x.trim()).filter(Boolean).slice(0, 40);

export const TITLES: Record<DocType, string> = {
  sale: 'Comprovante de venda', payment: 'Comprovante de pagamento registrado', 'sale-cancel': 'Comprovante de cancelamento', cart: 'Prévia de carrinho (venda não concluída)',
  quote: 'Orçamento', 'os-entry': 'Ordem de serviço — entrada', 'os-diagnosis': 'Ordem de serviço — diagnóstico', 'os-progress': 'Ordem de serviço — andamento',
  'os-done': 'Ordem de serviço — conclusão', 'os-delivery': 'Termo de entrega do veículo', warranty: 'Termo de garantia comercial', 'checklist-in': 'Checklist de entrada',
  'checklist-out': 'Checklist de saída', 'pick-list': 'Requisição / separação de peças', 'purchase-order': 'Pedido de compra', 'purchase-receipt': 'Conferência de recebimento',
  cash: 'Resumo de caixa', settlement: 'Recibo de recebimento', statement: 'Extrato do lançamento', inventory: 'Folha de inventário', test: 'Página de teste de impressão',
};
/** Quais documentos cada origem oferece (o servidor valida de novo). */
export const DOCS_FOR: Record<string, DocType[]> = {
  sale: ['sale', 'payment', 'sale-cancel'], cart: ['cart'], orcamentos: ['quote'],
  'ordens-servico': ['os-entry', 'checklist-in', 'os-diagnosis', 'os-progress', 'pick-list', 'os-done', 'checklist-out', 'os-delivery', 'warranty'],
  compras: ['purchase-order', 'purchase-receipt'], cash: ['cash'], entry: ['settlement', 'statement'], stock: ['inventory'],
};

/** Monta o layout de um snapshot. Nunca inventa valores: campos ausentes simplesmente não aparecem. */
export function buildDoc(s: Snapshot): Doc {
  const blocks: Block[] = [], notices: string[] = [];
  const r = s.record, sale = s.sale;
  let subtitle = '';
  switch (s.type) {
    case 'sale': case 'payment': case 'sale-cancel': {
      if (!sale) throw new Error('Venda ausente no documento.');
      subtitle = `Venda ${sale.id.slice(0, 8).toUpperCase()} · ${when(sale.date)} · ${sale.status}`;
      blocks.push({ t: 'kv', rows: filled([['Operador', sale.seller], ['Cliente', s.customer?.name ?? 'Consumidor não identificado'], ['Telefone', s.customer?.phone]]) });
      if (s.type === 'sale-cancel') {
        if (sale.status !== 'Cancelada') throw new Error('Esta venda não está cancelada.');
        blocks.push({ t: 'kv', rows: filled([['Cancelada em', when(sale.cancelledAt)], ['Motivo', sale.cancelReason ?? 'Não informado no registro']]) }, lines(sale.items),
          { t: 'totals', rows: [['Valor estornado', money(sale.total), true]] }, { t: 'text', text: 'Estoque, caixa e financeiro foram revertidos pelo cancelamento registrado no sistema.', small: true });
        break;
      }
      if (s.type === 'sale') blocks.push(lines(sale.items));
      blocks.push({ t: 'totals', rows: [...(s.type === 'sale' ? [['Subtotal', money(sum(sale.items))]] as [string, string][] : []), ...(sale.discount ? [['Desconto', '− ' + money(sale.discount)]] as [string, string][] : []),
        ...(sale.surcharge ? [['Acréscimo', '+ ' + money(sale.surcharge)]] as [string, string][] : []), ['Total', money(sale.total), true]] });
      blocks.push({ t: 'title', text: 'Pagamentos registrados' }, { t: 'kv', rows: sale.payments.map(p => [p.method, p.tendered && p.tendered !== p.amount ? `${money(p.amount)} (entregue ${money(p.tendered)})` : money(p.amount)] as [string, string]) });
      if (sale.change) blocks.push({ t: 'totals', rows: [['Troco', money(sale.change), true]] });
      if (s.type === 'payment') notices.push('Comprovante de registro interno do pagamento. Não substitui comprovante bancário, de Pix ou da operadora de cartão.');
      if (sale.status === 'Cancelada') notices.push('ATENÇÃO: esta venda foi CANCELADA em ' + when(sale.cancelledAt) + '.');
      if (s.texts.thanks && s.type === 'sale') blocks.push({ t: 'text', text: s.texts.thanks, strong: true });
      break;
    }
    case 'cart':
      if (!r) throw new Error('Carrinho ausente.');
      subtitle = `${r.title} · ${when(r.date)}`; blocks.push(...people(s), lines(r.items), { t: 'totals', rows: [['Total estimado', money(r.amount), true]] });
      notices.push('PRÉVIA INTERNA: a venda NÃO foi concluída. Preços e estoque são revalidados ao finalizar.'); break;
    case 'quote': {
      if (!r) throw new Error('Orçamento ausente.');
      const labor = parseMoney(r.fields.labor);
      subtitle = `${r.title} · ${when(r.date, false)} · Situação: ${r.status}`;
      blocks.push({ t: 'kv', rows: filled([['Validade', when(r.fields.validUntil, false)], ['Responsável', s.operator]]) }, ...people(s), lines(r.items),
        { t: 'totals', rows: [['Peças', money(sum(r.items))], ...(labor ? [['Mão de obra', money(labor)]] as [string, string][] : []), ['Total', money(r.amount || sum(r.items) + labor), true]] });
      if (r.fields.notes) blocks.push({ t: 'title', text: 'Condições e observações' }, { t: 'text', text: r.fields.notes });
      if (s.texts.quoteTerms) blocks.push({ t: 'text', text: s.texts.quoteTerms, small: true });
      if (s.link) blocks.push({ t: 'qr', value: s.link, caption: 'Consulte este orçamento pelo link seguro' });
      blocks.push({ t: 'signature', labels: ['Aprovação do cliente (nome, data e assinatura)'] });
      notices.push('Orçamento sujeito à aprovação. A simples visualização ou recebimento deste documento não representa aceite.'); break;
    }
    case 'os-entry': case 'os-diagnosis': case 'os-progress': case 'os-done': case 'os-delivery': case 'warranty': case 'checklist-in': case 'checklist-out': case 'pick-list': {
      if (!r) throw new Error('Ordem de serviço ausente.');
      const labor = parseMoney(r.fields.labor);
      subtitle = `${r.title} · Aberta em ${when(r.date)} · Situação: ${r.status}`;
      blocks.push({ t: 'kv', rows: filled([['Técnico', r.fields.technician], ['Previsão', when(r.fields.dueDate, false)], ['Km de entrada', r.fields.mileage]]) });
      if (s.type !== 'pick-list') blocks.push(...people(s));
      if (s.type === 'os-entry') {
        blocks.push({ t: 'title', text: 'Relato do cliente' }, { t: 'text', text: r.fields.complaint || '—' });
        if (r.fields.checklist) blocks.push({ t: 'title', text: 'Condições, acessórios e objetos' }, { t: 'checklist', items: checklistOf(r.fields.checklist).map(label => ({ label, checked: null })) });
        if (s.texts.osTerms) blocks.push({ t: 'text', text: s.texts.osTerms, small: true });
        blocks.push({ t: 'signature', labels: ['Recebido por (oficina)', 'Cliente'] });
      } else if (s.type === 'checklist-in' || s.type === 'checklist-out') {
        const items = checklistOf(r.fields.checklist);
        blocks.push({ t: 'title', text: s.type === 'checklist-in' ? 'Itens conferidos na entrada' : 'Itens conferidos na saída' },
          { t: 'checklist', items: (items.length ? items : ['Lataria/carenagem', 'Pneus', 'Luzes', 'Painel/alertas', 'Nível de combustível', 'Objetos pessoais']).map(label => ({ label, checked: null })) },
          { t: 'kv', rows: [['Km', r.fields.mileage || '______'], ['Combustível', '______']] }, { t: 'signature', labels: ['Conferido por', 'Cliente'] });
      } else if (s.type === 'os-diagnosis') {
        blocks.push({ t: 'title', text: 'Sintomas relatados' }, { t: 'text', text: r.fields.complaint || '—' }, { t: 'title', text: 'Diagnóstico' }, { t: 'text', text: r.fields.diagnosis || 'Diagnóstico ainda não registrado.' });
        if (r.items.length) blocks.push({ t: 'title', text: 'Peças sugeridas' }, lines(r.items));
        blocks.push({ t: 'totals', rows: [['Estimativa', money(sum(r.items) + labor), true]] });
      } else if (s.type === 'pick-list') {
        blocks.push({ t: 'table', head: ['Peça', 'Qtd.', 'Separado'], align: ['l', 'r', 'c'], widths: [0.66, 0.14, 0.2], rows: r.items.map(i => [i.sku ? `${i.name} (${i.sku})` : i.name, String(i.quantity), '[   ]']) },
          { t: 'signature', labels: ['Separado por', 'Recebido por (técnico)'] });
      } else {
        if (s.type !== 'warranty' && s.type !== 'os-delivery') blocks.push({ t: 'title', text: 'Serviço' }, { t: 'text', text: [r.fields.complaint && `Relato: ${r.fields.complaint}`, r.fields.diagnosis && `Diagnóstico: ${r.fields.diagnosis}`].filter(Boolean).join('\n') || '—' });
        if (r.items.length) blocks.push({ t: 'title', text: s.type === 'os-progress' ? 'Peças previstas' : 'Peças utilizadas' }, lines(r.items));
        blocks.push({ t: 'totals', rows: [['Peças', money(sum(r.items))], ...(labor ? [['Mão de obra', money(labor)]] as [string, string][] : []), ['Total', money(r.amount || sum(r.items) + labor), true]] });
        if (s.type === 'os-progress' && r.history.length) blocks.push({ t: 'title', text: 'Histórico' }, { t: 'kv', rows: r.history.slice(-12).map(h => [when(h.date), h.text] as [string, string]) });
        if (s.type === 'os-done' || s.type === 'warranty') blocks.push({ t: 'title', text: 'Garantia comercial' }, { t: 'text', text: s.texts.warranty || 'Condições de garantia comercial não configuradas pela empresa.' },
          { t: 'text', text: 'A garantia comercial é complementar à garantia legal prevista no Código de Defesa do Consumidor (art. 26 e 50) e não a substitui.', small: true });
        if (s.type === 'os-delivery') blocks.push({ t: 'kv', rows: [['Km na entrega', '______'], ['Data/hora da retirada', '____/____/______  ____:____']] }, ...(s.texts.deliveryTerms ? [{ t: 'text', text: s.texts.deliveryTerms, small: true } as Block] : []),
          { t: 'signature', labels: ['Entregue por (oficina)', 'Recebido por (cliente ou autorizado)'] });
        if (s.type === 'os-done') blocks.push({ t: 'signature', labels: ['Responsável técnico'] });
      }
      break;
    }
    case 'purchase-order': case 'purchase-receipt': {
      if (!r) throw new Error('Compra ausente.');
      subtitle = `${r.title} · ${when(r.date, false)} · Situação: ${r.status}`;
      blocks.push({ t: 'kv', rows: filled([['Fornecedor', s.supplier?.name], ['Contato', s.supplier?.phone], ['Previsão de recebimento', when(r.fields.expectedDate, false)], ['Vencimento', when(r.fields.dueDate, false)], ['NF / referência', r.fields.invoice]]) });
      if (s.type === 'purchase-order') blocks.push(lines(r.items), { t: 'totals', rows: [['Total', money(r.amount || sum(r.items)), true]] });
      else blocks.push({ t: 'table', head: ['Item', 'Pedido', 'Recebido', 'Divergência'], align: ['l', 'r', 'c', 'l'], widths: [0.46, 0.14, 0.16, 0.24], rows: r.items.map(i => [i.name, String(i.quantity), '_____', '']) },
        { t: 'signature', labels: ['Conferido por', 'Data'] });
      if (r.fields.notes) blocks.push({ t: 'text', text: r.fields.notes, small: true });
      notices.push('Documento interno. Não substitui a nota fiscal do fornecedor.'); break;
    }
    case 'cash': {
      const c = s.cash; if (!c) throw new Error('Caixa ausente.');
      subtitle = `Aberto em ${when(c.openedAt)}${c.closedAt ? ` · Fechado em ${when(c.closedAt)}` : ' · Caixa aberto'}`;
      blocks.push({ t: 'kv', rows: [['Fundo de abertura', money(c.opening)]] });
      if (c.movements.length) blocks.push({ t: 'table', head: ['Data', 'Movimento', 'Valor'], align: ['l', 'l', 'r'], widths: [0.28, 0.5, 0.22], rows: c.movements.map(m => [when(m.date), m.reason, money(m.amount)]) });
      const expected = c.expected ?? c.opening + c.movements.reduce((t, m) => t + m.amount, 0);
      blocks.push({ t: 'totals', rows: [['Dinheiro esperado', money(expected), true], ...(c.counted != null ? [['Contado', money(c.counted)], ['Diferença', money(c.difference ?? c.counted - expected), true]] as [string, string, boolean?][] : [])] });
      if (c.reason) blocks.push({ t: 'kv', rows: [['Motivo da diferença', c.reason]] });
      blocks.push({ t: 'signature', labels: [c.closedBy ? `Fechado por ${c.closedBy}` : 'Operador', 'Conferente'] }); break;
    }
    case 'settlement': case 'statement': {
      const e = s.entry; if (!e) throw new Error('Lançamento ausente.');
      const active = e.settlements.filter(x => !x.reversedAt), paid = active.reduce((t, x) => t + x.amount, 0);
      subtitle = `${e.type} · ${e.description || e.category} · Vencimento ${when(e.dueDate, false)}`;
      if (s.type === 'settlement') {
        const st = e.settlements.find(x => x.id === e.settlementId); if (!st) throw new Error('Baixa não encontrada.');
        if (st.reversedAt) notices.push(`ATENÇÃO: esta baixa foi ESTORNADA em ${when(st.reversedAt)}${st.reversalReason ? ` (${st.reversalReason})` : ''}.`);
        blocks.push(...people(s), { t: 'kv', rows: filled([['Referente a', e.description || e.category], ['Data', when(st.date, false)], ['Forma registrada', st.method], ['Registrado por', st.user], ['Observação', st.note]]) },
          { t: 'totals', rows: [['Valor recebido', money(st.amount), true], ['Valor original', money(e.amount)], ['Saldo pendente', money(Math.max(0, e.amount - paid))]] },
          { t: 'signature', labels: ['Recebido por'] });
        notices.push('Recibo de registro interno. Não comprova liquidação bancária.');
      } else {
        blocks.push(...people(s), { t: 'table', head: ['Data', 'Forma', 'Valor', 'Situação'], align: ['l', 'l', 'r', 'l'], widths: [0.24, 0.3, 0.22, 0.24],
          rows: e.settlements.map(x => [when(x.date, false), x.method, money(x.amount), x.reversedAt ? 'Estornada' : 'Ativa']) },
          { t: 'totals', rows: [['Valor original', money(e.amount)], ['Pago', money(paid)], ['Saldo', money(Math.max(0, e.amount - paid)), true]] });
        if (e.cancelled) notices.push('Lançamento CANCELADO.');
      }
      break;
    }
    case 'inventory':
      subtitle = `${s.branch.name} · ${when(s.issuedAt)}`;
      blocks.push({ t: 'table', head: ['SKU', 'Produto', 'Local', 'Sistema', 'Contado'], align: ['l', 'l', 'l', 'r', 'c'], widths: [0.16, 0.42, 0.14, 0.12, 0.16],
        rows: (s.stock?.rows ?? []).map(x => [x.sku, x.name, x.location || '', String(x.quantity), '______']) }, { t: 'signature', labels: ['Contado por', 'Conferido por'] });
      notices.push('Documento interno de contagem. Ajustes só valem após registro no sistema.'); break;
    case 'test':
      subtitle = 'Confira margens, acentos, códigos e escala.';
      blocks.push({ t: 'text', text: 'Acentuação: ÁÉÍÓÚ áéíóú ÂÊÔ âêô ÃÕ ãõ Ç ç ª º °' }, { t: 'kv', rows: [['Régua', '|----|----|----|----|----|'], ['Escala', '10 mm = |----------|']] },
        { t: 'barcode', value: 'PISTEC-TESTE-123', caption: 'Code 128 de teste' }, { t: 'qr', value: 'https://pistec.vercel.app', caption: 'QR Code de teste' },
        { t: 'text', text: 'Se o texto acima estiver cortado, ajuste a largura do papel ou a margem na calibração.', small: true }); break;
  }
  if (s.copy > 1) notices.unshift(`${s.copy}ª VIA — reimpressão do documento original emitido.`);
  if (s.type !== 'test') notices.push(NON_FISCAL);
  return { title: TITLES[s.type], subtitle, number: s.number, issuedAt: s.issuedAt, copy: s.copy, version: s.version, company: s.company, branch: s.branch, header: s.texts.header, blocks, notices, footer: s.texts.footer };
}

export const DEFAULT_TEXTS: Texts = { header: '', footer: '', thanks: 'Obrigado pela preferência!', warranty: '', quoteTerms: 'Valores sujeitos à disponibilidade de estoque na aprovação.', osTerms: 'Autorizo a avaliação do veículo. Serviços só serão executados após aprovação do orçamento.', deliveryTerms: '' };
