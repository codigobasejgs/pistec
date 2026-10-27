// DocumentService: único ponto entre a UI e documentos/impressão/entrega. Componentes não chamam integrações diretamente.
// Real: snapshot emitido no servidor (issue_document). Demo: snapshot montado do IndexedDB, marcado como demonstrativo.
import qrcode from 'qrcode-generator';
import { uid } from '../../lib';
import type { DemoState, Session } from '../../types';
import { buildDoc, DEFAULT_TEXTS, type DocType, type Snapshot } from '../../../supabase/functions/_shared/documents/model';
import { renderHtml, type HtmlOptions, type TemplateStyle } from '../../../supabase/functions/_shared/documents/html';
import { paperOf, type Calibration, type Paper } from '../../../supabase/functions/_shared/documents/paper';

export type Issued = { id: string; number: string; version: number; copies: number; snapshot: Snapshot & { style?: { style?: TemplateStyle; accent?: string; logoSize?: number; align?: 'left' | 'center' } } };
export interface PrinterProfile { id: string; tenant_id: string; branch_id: string | null; station: string; name: string; kind: 'common' | 'thermal' | 'label' | 'network'; method: 'browser' | 'connector';
  protocol: 'none' | 'escpos' | 'zpl' | 'tspl' | 'epl'; device: string; model: string; paper_id: string; custom: { width?: number; height?: number | null }; calibration: Partial<Calibration>; doc_types: string[]; copies: number; is_default: boolean; test_result: string }

export const qrSvg = (value: string) => { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); };

/** Estação = este navegador/computador. Impressora do computador A não é assumida no celular B. */
const STATION_KEY = 'pistec-print-station';
export function station(): string {
  try { let v = localStorage.getItem(STATION_KEY); if (!v) { v = `Estação ${uid().slice(0, 4).toUpperCase()}`; localStorage.setItem(STATION_KEY, v); } return v; } catch { return 'Este dispositivo'; }
}
export function renameStation(name: string) { try { localStorage.setItem(STATION_KEY, name.trim().slice(0, 60) || station()); } catch { /* preferência local opcional */ } }

/** Impressora indicada para o tipo de documento: desta estação > da filial > da empresa; padrão do tipo primeiro. */
export function pickPrinter(printers: PrinterProfile[], type: string, branchId: string, here = station()): PrinterProfile | null {
  const fits = (p: PrinterProfile) => (!p.doc_types.length || p.doc_types.includes(type)) && (p.branch_id == null || p.branch_id === branchId) && (!p.station || p.station === here);
  const score = (p: PrinterProfile) => (p.doc_types.includes(type) ? 4 : 0) + (p.station === here ? 2 : 0) + (p.is_default ? 1 : 0);
  return printers.filter(fits).sort((a, b) => score(b) - score(a))[0] ?? null;
}
export const paperFor = (p: PrinterProfile | null, fallback: string): Paper => p ? paperOf(p.paper_id, p.custom?.width ? { width: p.custom.width, height: p.custom.height ?? null, kind: p.kind === 'thermal' ? 'thermal' : p.kind === 'label' ? 'label' : 'page' } : undefined) : paperOf(fallback);
export const DEFAULT_PAPER: Partial<Record<DocType, string>> = { sale: 'thermal-80', payment: 'thermal-80', 'sale-cancel': 'thermal-80', cart: 'thermal-80', settlement: 'thermal-80', cash: 'thermal-80' };

export function html(issued: Issued, paper: Paper, calibration?: Partial<Calibration>, extra: Partial<HtmlOptions> = {}) {
  const s = issued.snapshot, doc = buildDoc({ ...s, copy: Math.max(1, s.copy) });
  return renderHtml(doc, paper, { qr: qrSvg, calibration: { offsetX: 0, offsetY: 0, scale: 100, gap: 2, ...calibration }, accent: s.style?.accent || undefined, style: s.style?.style, logoSize: s.style?.logoSize, align: s.style?.align, ...extra });
}
// pdf-lib (~400 KB) só é baixado quando alguém pede o PDF.
export const pdf = async (issued: Issued, paper: Paper) => (await import('./pdf')).renderPdf(buildDoc({ ...issued.snapshot, copy: Math.max(1, issued.snapshot.copy) }), paper, issued.snapshot.style?.accent || undefined);

/** Impressão pelo navegador num iframe isolado: só o documento é impresso (sem sidebar/topbar). Resolve ao abrir o diálogo — não confirma papel impresso. */
export function printHtml(content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    frame.setAttribute('aria-hidden', 'true'); frame.srcdoc = content;
    frame.onload = () => { try { const w = frame.contentWindow!; w.focus(); w.print(); resolve(); } catch (e) { reject(e); } finally { setTimeout(() => frame.remove(), 60_000); } };
    document.body.appendChild(frame);
  });
}
export function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type }); const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- modo demonstração: snapshot local (dados fictícios, nunca enviado)
export function demoSnapshot(state: DemoState, session: Session, type: DocType, sourceId: string, copy = 1): Issued {
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const branchRec = state.records.find(r => r.tenantId === tenant.id && r.kind === 'filiais' && r.title === state.branches.find(b => b.id === session.branchId)?.name);
  const company = { name: tenant.name, legalName: tenant.legalName, document: tenant.document, address: branchRec?.fields.address ?? '', phone: branchRec?.fields.phone ?? '', whatsapp: '', email: tenant.email, website: '', logo: tenant.branding.logo };
  const customerOf = (id: string) => { const c = state.customers.find(x => x.tenantId === tenant.id && x.id === id); return c ? { name: c.name, phone: c.phone, email: c.email, document: c.document } : null; };
  const base: Omit<Snapshot, 'type'> = { number: `DEMO-${sourceId.slice(-6).toUpperCase()}`, issuedAt: new Date().toISOString(), copy, version: 1, company,
    branch: { name: state.branches.find(b => b.id === session.branchId)?.name ?? '', document: branchRec?.fields.document ?? '', address: branchRec?.fields.address ?? '', phone: branchRec?.fields.phone ?? '' },
    texts: { ...DEFAULT_TEXTS, footer: tenant.branding.footer || '', header: 'DEMONSTRAÇÃO — dados fictícios' }, operator: session.name };
  let snap: Snapshot;
  if (type === 'sale' || type === 'payment' || type === 'sale-cancel') {
    const s = state.sales.find(x => x.tenantId === tenant.id && x.id === sourceId); if (!s) throw new Error('Venda não encontrada.');
    snap = { ...base, type, customer: customerOf(s.customerId), sale: { id: s.id, date: s.date, seller: s.seller, status: s.status, discount: s.discount, surcharge: s.surcharge, total: s.total, change: s.change, payments: s.payments,
      items: s.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, sku: state.products.find(p => p.id === i.productId)?.sku })) } };
  } else if (type === 'cash') {
    const c = state.cashRegisters.find(x => x.tenantId === tenant.id && x.id === sourceId); if (!c) throw new Error('Caixa não encontrado.');
    snap = { ...base, type, cash: { id: c.id, openedAt: c.openedAt, closedAt: c.closedAt, opening: c.opening, expected: c.expected, counted: c.counted, difference: c.difference, reason: c.closingReason, closedBy: c.closedBy, movements: c.movements } };
  } else if (type === 'settlement' || type === 'statement') {
    const e = state.finances.find(x => x.tenantId === tenant.id && (x.id === sourceId || x.settlements.some(st => st.id === sourceId))); if (!e) throw new Error('Lançamento não encontrado.');
    snap = { ...base, type, entry: { id: e.id, type: e.type, category: e.category, description: e.description, amount: e.amount, dueDate: e.dueDate, cancelled: !!e.cancelled, settlementId: type === 'settlement' ? sourceId : undefined,
      settlements: e.settlements.map(st => ({ id: st.id, amount: st.amount, date: st.date, method: st.method, user: st.user, note: st.note, reversedAt: st.reversedAt, reversalReason: st.reversalReason })) } };
  } else if (type === 'inventory') {
    snap = { ...base, type, stock: { rows: state.products.filter(p => p.tenantId === tenant.id && p.active).map(p => { const b = state.balances.find(x => x.tenantId === tenant.id && x.branchId === session.branchId && x.productId === p.id); return { sku: p.sku, name: p.name, location: p.location, quantity: b?.quantity ?? 0, reserved: b?.reserved ?? 0 }; }) } };
  } else if (type === 'test') snap = { ...base, type };
  else {
    const r = state.records.find(x => x.tenantId === tenant.id && x.id === sourceId); if (!r) throw new Error('Registro não encontrado.');
    const v = state.records.find(x => x.tenantId === tenant.id && x.id === r.fields.vehicleId), sup = state.records.find(x => x.tenantId === tenant.id && x.id === r.fields.supplierId);
    snap = { ...base, type, customer: customerOf(r.customerId), vehicle: v ? { title: v.title, plate: v.fields.plate, brand: v.fields.brand, model: v.fields.model, year: v.fields.year, color: v.fields.color, mileage: r.fields.mileage || v.fields.mileage } : null,
      supplier: sup ? { name: sup.title, phone: sup.fields.phone } : null,
      record: { id: r.id, kind: r.kind, title: r.title, status: r.status, date: r.date, amount: r.amount, fields: r.fields, history: r.history, items: r.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, sku: state.products.find(p => p.id === i.productId)?.sku })) } };
  }
  return { id: `demo-${type}-${sourceId}`, number: base.number, version: 1, copies: copy - 1, snapshot: snap };
}
