export type Role = 'Proprietário' | 'Administrador' | 'Gerente' | 'Vendedor' | 'Caixa' | 'Estoquista' | 'Mecânico' | 'Atendente' | 'Financeiro';
export type Theme = 'dark' | 'light' | 'system';
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual';
export interface Plan { id: string; name: string; monthly: number; quarterly: number; annual: number; users: number; branches: number; products: number; whatsapp: number; trialDays: number; features: string[] }
/** widgets: ordem = ordem de exibição no dashboard. */
export interface Branding { primary: string; secondary: string; accent: string; sidebar: string; theme: Theme; logo: string; font: string; density: 'comfortable' | 'compact'; radius: 'compact' | 'default' | 'round'; footer: string; widgets: string[] }
export interface Tenant { id: string; slug: string; name: string; legalName: string; document: string; owner: string; email: string; profile: string; planId: string; status: string; dueDate: string; branding: Branding; notes: string }
export interface Branch { id: string; tenantId: string; name: string; active: boolean }
export interface Product { id: string; tenantId: string; name: string; sku: string; barcode: string; category: string; brand: string; cost: number; price: number; min: number; max: number; location: string; active: boolean; details: Record<string, string> }
export interface Customer { id: string; tenantId: string; name: string; document: string; email: string; phone: string; address: string; addressData?: import('./services/address').Address; consent: boolean; notes: string }
export interface StockBalance { tenantId: string; branchId: string; productId: string; quantity: number; reserved: number }
export interface StockMovement { id: string; tenantId: string; branchId: string; productId: string; quantity: number; type: string; reference: string; date: string }
export interface SaleItem { productId: string; name: string; quantity: number; price: number; cost: number }
/** amount = valor aplicado à venda. tendered = valor entregue (só Dinheiro); troco desta linha = tendered - amount. */
export interface Payment { method: string; amount: number; tendered?: number }
export interface Sale { id: string; tenantId: string; branchId: string; customerId: string; seller: string; items: SaleItem[]; discount: number; surcharge: number; total: number; payments: Payment[]; change: number; status: 'Concluída' | 'Cancelada'; date: string; requestId: string; cashId: string }
export interface CashRegister { id: string; tenantId: string; branchId: string; opening: number; openedAt: string; closedAt?: string; counted?: number; expected?: number; difference?: number; closingReason?: string; closedBy?: string; movements: { id: string; amount: number; reason: string; date: string }[] }
export interface Settlement { id: string; requestId: string; amount: number; date: string; method: string; user: string; note: string; reversedAt?: string; reversedBy?: string; reversalReason?: string }
export type EntryStatus = 'Em aberto' | 'Parcialmente pago' | 'Quitado' | 'Vencido' | 'Cancelado';
/** amount = valor original (nunca muda com baixas). paid = quitado integralmente (mantido pelo domínio). */
export interface FinancialEntry { id: string; tenantId: string; branchId: string; type: 'Receita' | 'Despesa'; category: string; description: string; amount: number; dueDate: string; paid: boolean; settlements: Settlement[]; cancelled?: boolean; reference: string; date: string }
export interface OperationalRecord { id: string; tenantId: string; branchId: string; kind: string; title: string; status: string; customerId: string; date: string; amount: number; fields: Record<string, string>; items: SaleItem[]; history: { date: string; text: string }[]; convertedId?: string }
export interface BillingInvoice { id: string; tenantId: string; amount: number; status: string; dueDate: string; provider: 'Asaas' | 'InfinitePay'; reference: string; planId?: string; period?: BillingPeriod; originalAmount?: number; discount?: number; couponCode?: string }
/** Cupom SaaS (assinatura PISTEC), nunca venda de loja. value: percent em pontos-base (2000 = 20%), fixed em centavos. scope 'first' = só a fatura em que foi aplicado. */
export interface Coupon { id: string; code: string; description: string; kind: 'percent' | 'fixed'; value: number; startsAt: string; endsAt: string; maxUses: number; perTenant: number; planIds: string[]; periods: BillingPeriod[]; active: boolean; scope: 'first' }
export interface CouponRedemption { id: string; couponId: string; tenantId: string; invoiceId: string; discount: number; date: string }
export interface AuditEntry { id: string; tenantId: string; date: string; action: string }
export interface DemoState { version: number; tenants: Tenant[]; plans: Plan[]; branches: Branch[]; products: Product[]; customers: Customer[]; balances: StockBalance[]; movements: StockMovement[]; sales: Sale[]; cashRegisters: CashRegister[]; finances: FinancialEntry[]; records: OperationalRecord[]; invoices: BillingInvoice[]; coupons: Coupon[]; couponRedemptions: CouponRedemption[]; audit: AuditEntry[] }
export interface Session { tenantId: string; branchId: string; role: Role; name: string; admin: boolean }
/** payments[].amount na entrada = valor ENTREGUE por forma; o domínio calcula aplicado e troco. */
export interface SaleInput { tenantId: string; branchId: string; customerId: string; seller: string; items: { productId: string; quantity: number }[]; discount: number; surcharge: number; payments: Payment[]; requestId: string }
export interface ProductImportRow { line: number; sku: string; name: string; category: string; brand: string; barcode: string; unit: string; cost: number; price: number; min: number; max: number; location: string }
export interface ImportReport { created: number; updated: number; skipped: number; errors: { line: number; message: string }[] }
/** Passo de tour: target/before são valores de data-tour. route = subrota do módulo (ex.: 'pdv'). */
export interface TourStep { target: string; title: string; text: string; before?: string; route?: string }
