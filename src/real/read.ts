import type { SupabaseClient } from '@supabase/supabase-js';
import { toAddress } from '../services/address';
import type { Branding, DemoState, BillingPeriod } from '../types';

// Snapshot de leitura em memória; não reutiliza seed nem IndexedDB.
export const emptyState = (): DemoState => ({ version: 2, tenants: [], plans: [], branches: [], products: [], customers: [], balances: [], movements: [], sales: [], cashRegisters: [], finances: [], records: [], invoices: [], coupons: [], couponRedemptions: [], audit: [] });
const branding: Branding = { primary: '#007BFF', secondary: '#00E5FF', accent: '#FFB020', sidebar: '#061B3D', theme: 'dark', logo: '', font: 'Inter', density: 'comfortable', radius: 'default', footer: 'Gestão com PISTEC', widgets: ['revenue', 'sales', 'stock', 'services'] };
type Row = Record<string, unknown>;
const str = (value: unknown) => value == null ? '' : String(value);
export function integer(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) throw new Error('Valor numérico inválido recebido do servidor.');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Valor do servidor excede a precisão numérica suportada.');
  return result;
}
const optionalNumber = (value: unknown) => value == null ? undefined : integer(value);
const textArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const object = (value: unknown): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, str(item)])) : {};
function group(rows: Row[], field: string) {
  const map = new Map<string, Row[]>();
  for (const row of rows) { const key = str(row[field]); map.set(key, [...(map.get(key) ?? []), row]); }
  return map;
}

// Paginação explícita: nenhuma coleção truncada silenciosamente no limite de 1.000 linhas.
async function rows(client: SupabaseClient, table: string, tenant?: string, platform = false): Promise<Row[]> {
  const result: Row[] = [];
  const order = table === 'stock_balances' ? ['tenant_id', 'branch_id', 'product_id'] : table === 'sale_items' ? ['sale_id', 'product_id'] : ['id'];
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select('*');
    if (tenant) query = query.eq('tenant_id', tenant);
    if (platform) query = query.is('tenant_id', null);
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw new Error(`Falha ao consultar ${table}: ${error.message}`);
    if (!data) throw new Error(`Resposta ausente ao consultar ${table}.`);
    result.push(...data);
    if (data.length < 500) return result;
  }
}

export async function loadRealState(client: SupabaseClient, tenantId: string | null, admin = false): Promise<DemoState> {
  const state = emptyState();
  const [plans, tenants, branches] = await Promise.all([rows(client, 'plans'), rows(client, 'tenants'), rows(client, 'branches')]);
  state.plans = plans.map(r => ({ id: str(r.id), name: str(r.name), monthly: integer(r.monthly), quarterly: integer(r.quarterly), annual: integer(r.annual), users: integer(r.users), branches: integer(r.branches), products: integer(r.products), whatsapp: integer(r.whatsapp), trialMonths: integer(r.trial_months ?? 1), features: textArray(r.features) }));
  state.tenants = tenants.map(r => ({ id: str(r.id), slug: str(r.slug), name: str(r.name), legalName: str(r.legal_name), document: str(r.document), owner: str(r.owner_name), email: str(r.email), profile: str(r.profile), planId: str(r.plan_id), status: str(r.status), dueDate: str(r.due_date), notes: str(r.notes), branding: { ...branding, ...(r.branding as Partial<Branding>) } }));
  state.branches = branches.map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), name: str(r.name), active: r.active === true }));
  if (!tenantId && !admin) return state;
  if (!admin && !state.tenants.some(t => t.id === tenantId)) throw new Error('Acesso à empresa indisponível.');
  const scope = admin ? undefined : tenantId!;
  const tables = admin
    ? ['records', 'billing_invoices', 'coupons', 'coupon_redemptions', 'audit_logs']
    : ['products', 'customers', 'stock_balances', 'stock_movements', 'sales', 'sale_items', 'sale_payments', 'cash_registers', 'cash_movements', 'financial_entries', 'settlements', 'records', 'billing_invoices', 'coupon_redemptions', 'audit_logs'];
  const data = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(client, table, scope, admin && table === 'records')] as const)));
  const get = (table: string) => data[table] ?? [];
  state.products = get('products').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), name: str(r.name), sku: str(r.sku), barcode: str(r.barcode), category: str(r.category), brand: str(r.brand), cost: integer(r.cost), price: integer(r.price), min: integer(r.min), max: integer(r.max), location: str(r.location), active: r.active === true, details: object(r.details) }));
  state.customers = get('customers').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), name: str(r.name), document: str(r.document), email: str(r.email), phone: str(r.phone), address: str(r.address), addressData: toAddress(r.address_data), consent: r.consent === true, notes: str(r.notes) }));
  state.balances = get('stock_balances').map(r => ({ tenantId: str(r.tenant_id), branchId: str(r.branch_id), productId: str(r.product_id), quantity: integer(r.quantity), reserved: integer(r.reserved) }));
  state.movements = get('stock_movements').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), branchId: str(r.branch_id), productId: str(r.product_id), quantity: integer(r.quantity), type: str(r.type), reference: str(r.reference), date: str(r.created_at) }));
  const items = group(get('sale_items'), 'sale_id'), payments = group(get('sale_payments'), 'sale_id');
  state.sales = get('sales').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), branchId: str(r.branch_id), customerId: str(r.customer_id), seller: str(r.seller), discount: integer(r.discount), surcharge: integer(r.surcharge), total: integer(r.total), change: integer(r.change), status: r.status as 'Concluída' | 'Cancelada', requestId: str(r.request_id), cashId: str(r.cash_id), date: str(r.created_at),
    items: (items.get(str(r.id)) ?? []).map(i => ({ productId: str(i.product_id), name: str(i.name), quantity: integer(i.quantity), price: integer(i.price), cost: integer(i.cost) })),
    payments: (payments.get(str(r.id)) ?? []).sort((a, b) => integer(a.position) - integer(b.position)).map(p => ({ method: str(p.method), amount: integer(p.amount), ...(p.tendered == null ? {} : { tendered: integer(p.tendered) }) })),
  }));
  const cashMoves = group(get('cash_movements'), 'cash_id'), settlements = group(get('settlements'), 'entry_id');
  state.cashRegisters = get('cash_registers').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), branchId: str(r.branch_id), opening: integer(r.opening), openedAt: str(r.opened_at), closedAt: r.closed_at == null ? undefined : str(r.closed_at), counted: optionalNumber(r.counted), expected: optionalNumber(r.expected), difference: optionalNumber(r.difference), closingReason: str(r.closing_reason), closedBy: str(r.closed_by), movements: (cashMoves.get(str(r.id)) ?? []).map(m => ({ id: str(m.id), amount: integer(m.amount), reason: str(m.reason), date: str(m.created_at) })) }));
  state.finances = get('financial_entries').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), branchId: str(r.branch_id), type: r.type as 'Receita' | 'Despesa', category: str(r.category), description: str(r.description), amount: integer(r.amount), dueDate: str(r.due_date), paid: r.paid === true, cancelled: r.cancelled === true, reference: str(r.reference), date: str(r.created_at), settlements: (settlements.get(str(r.id)) ?? []).map(s => ({ id: str(s.id), requestId: str(s.request_id), amount: integer(s.amount), date: str(s.date), method: str(s.method), user: str(s.user_name), note: str(s.note), reversedAt: s.reversed_at == null ? undefined : str(s.reversed_at), reversedBy: str(s.reversed_by), reversalReason: str(s.reversal_reason) })) }));
  state.records = get('records').map(r => ({ id: str(r.id), tenantId: r.tenant_id == null ? 'platform' : str(r.tenant_id), branchId: str(r.branch_id), kind: str(r.kind), title: str(r.title), status: str(r.status), customerId: str(r.customer_id), date: str(r.date), amount: integer(r.amount), fields: object(r.fields), items: Array.isArray(r.items) ? r.items.map(i => ({ productId: str(i.productId), name: str(i.name), quantity: integer(i.quantity), price: integer(i.price), cost: integer(i.cost) })) : [], history: Array.isArray(r.history) ? r.history.map(h => ({ date: str(h.date), text: str(h.text) })) : [], convertedId: r.converted_id == null ? undefined : str(r.converted_id) }));
  state.invoices = get('billing_invoices').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), planId: str(r.plan_id), period: r.period as BillingPeriod, amount: integer(r.amount), originalAmount: integer(r.original_amount), discount: integer(r.discount), couponCode: str(r.coupon_code), status: str(r.status), dueDate: str(r.due_date), provider: r.provider as 'InfinitePay' | 'Asaas', reference: str(r.request_id) }));
  state.coupons = get('coupons').map(r => ({ id: str(r.id), code: str(r.code), description: str(r.description), kind: r.kind as 'percent' | 'fixed', value: integer(r.value), startsAt: str(r.starts_at), endsAt: str(r.ends_at), maxUses: integer(r.max_uses), perTenant: integer(r.per_tenant), planIds: textArray(r.plan_ids), periods: textArray(r.periods) as BillingPeriod[], active: r.active === true, scope: 'first' }));
  state.couponRedemptions = get('coupon_redemptions').map(r => ({ id: str(r.id), tenantId: str(r.tenant_id), couponId: str(r.coupon_id), invoiceId: str(r.invoice_id), discount: integer(r.discount), date: str(r.created_at) }));
  state.audit = get('audit_logs').map(r => ({ id: str(r.id), tenantId: r.tenant_id == null ? 'platform' : str(r.tenant_id), date: str(r.created_at), action: str(r.action) }));
  return state;
}
