// Integração do backend em Postgres real (PGlite): RLS, RPCs, idempotência, privilégios e cobrança.
import { beforeAll, describe, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>;
let B: Awaited<ReturnType<typeof tenantFor>>;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[], aal = 'aal1') =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args, aal).then(rows => rows[0]?.r as T);
const fails = (promise: Promise<unknown>, message: RegExp) => expect(promise).rejects.toThrow(message);

async function productWithStock(owner: typeof A, sku: string, quantity: number, price = 1000) {
  const id = await rpc<string>(owner.user, 'save_product', [owner.tenant, { name: `Produto ${sku}`, sku, cost: 400, price, min: 1 }]);
  if (quantity) await rpc(owner.user, 'move_stock', [owner.tenant, owner.branch, id, quantity, 'Entrada', `nf-${sku}`]);
  return id;
}

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'dono-a@teste.dev', 'Loja A');
  B = await tenantFor(db, 'dono-b@teste.dev', 'Loja B');
}, 120000);

describe('onboarding e isolamento entre empresas (RLS)', () => {
  test('onboarding cria empresa, matriz, proprietário e assinatura em teste; é idempotente', async () => {
    const [tenant] = await as<{ status: string; plan_id: string }>(db, A.user, 'select status, plan_id from public.tenants');
    expect(tenant).toEqual({ status: 'Teste', plan_id: 'premium' });
    expect(await as(db, A.user, 'select role from public.memberships')).toEqual([{ role: 'Proprietário' }]);
    const again = await rpc<{ tenantId: string }>(A.user, 'onboard_tenant', [{ name: 'Loja A', planId: 'premium' }]);
    expect(again.tenantId).toBe(A.tenant);
  });

  test('e-mail não confirmado não cria empresa; anônimo não cria', async () => {
    const user = await createUser(db, 'sem-confirmar@teste.dev');
    await db.query('update auth.users set email_confirmed_at = null where id = $1', [user]);
    await fails(rpc(user, 'onboard_tenant', [{ name: 'X' }]), /Confirme seu e-mail/);
    await fails(rpc(null, 'onboard_tenant', [{ name: 'X' }]), /permission denied|Entre na sua conta/);
  });

  test('usuário de A não lê nem escreve dados de B, mesmo enviando o tenantId de B', async () => {
    const productB = await productWithStock(B, 'B-1', 5);
    expect(await as(db, A.user, 'select id from public.products where tenant_id = $1', [B.tenant])).toEqual([]);
    expect(await as(db, A.user, 'select id from public.tenants where id = $1', [B.tenant])).toEqual([]);
    await fails(rpc(A.user, 'save_product', [B.tenant, { name: 'Invasão', sku: 'X', cost: 0, price: 0 }]), /Acesso negado/);
    await fails(rpc(A.user, 'move_stock', [B.tenant, B.branch, productB, 1, 'Saída', 'x']), /Acesso negado/);
    // tentar sobrescrever produto de B pelo id, usando o próprio tenant
    await fails(rpc(A.user, 'save_product', [A.tenant, { id: productB, name: 'Roubo', sku: 'R', cost: 0, price: 0 }]), /outra empresa/);
  });

  test('escrita direta nas tabelas é negada; só RPC', async () => {
    await fails(as(db, A.user, `insert into public.products (tenant_id, name, sku) values ($1, 'x', 'y')`, [A.tenant]), /permission denied/);
    await fails(as(db, A.user, `update public.tenants set plan_id = 'enterprise'`), /permission denied/);
    await fails(as(db, A.user, `insert into public.platform_admins (user_id) values ($1)`, [A.user]), /permission denied/);
    await fails(as(db, A.user, 'select * from public.integration_secrets'), /permission denied/);
  });

  test('anônimo só enxerga planos ativos', async () => {
    expect((await as(db, null, 'select id from public.plans order by sort')).map(r => r.id)).toEqual(['essencial', 'profissional', 'premium', 'enterprise']);
    await fails(as(db, null, 'select * from public.tenants'), /permission denied/);
  });
});

describe('papéis, filiais e plano no servidor', () => {
  test('convite: e-mail precisa coincidir; papel aplicado; Caixa não cadastra produto', async () => {
    const invite = await rpc<{ token: string }>(A.user, 'invite_member', [A.tenant, 'caixa@teste.dev', 'Caixa', null]);
    const intruso = await createUser(db, 'outro@teste.dev');
    await fails(rpc(intruso, 'accept_invite', [invite.token]), /outro e-mail/);
    const caixa = await createUser(db, 'caixa@teste.dev');
    expect((await rpc<{ tenantId: string }>(caixa, 'accept_invite', [invite.token])).tenantId).toBe(A.tenant);
    expect((await rpc<{ tenantId: string }>(caixa, 'accept_invite', [invite.token])).tenantId).toBe(A.tenant); // idempotente
    await fails(rpc(caixa, 'save_product', [A.tenant, { name: 'x', sku: 'c1', cost: 0, price: 0 }]), /não permite/);
    await fails(rpc(caixa, 'accept_invite', ['token-falso']), /inválido/);
  });

  test('membro restrito a uma filial não opera outra', async () => {
    const filial2 = await rpc<string>(A.user, 'save_record', [A.tenant, { kind: 'filiais', title: 'Filial 2', branchId: A.branch, fields: { address: 'Rua 2', manager: 'Ana' } }]);
    const invite = await rpc<{ token: string }>(A.user, 'invite_member', [A.tenant, 'gerente2@teste.dev', 'Gerente', [filial2]]);
    const gerente = await createUser(db, 'gerente2@teste.dev');
    await rpc(gerente, 'accept_invite', [invite.token]);
    await fails(rpc(gerente, 'open_cash', [A.tenant, A.branch, 0]), /filial/);
    expect(await rpc(gerente, 'open_cash', [A.tenant, filial2, 0])).toBeTruthy();
  });

  test('módulo fora do plano é bloqueado e assinatura suspensa impede escrita', async () => {
    const C = await tenantFor(db, 'dono-c@teste.dev', 'Loja C', 'essencial');
    await fails(rpc(C.user, 'save_record', [C.tenant, { kind: 'ordens-servico', title: 'OS', branchId: C.branch, fields: { labor: '10,00' } }]), /não incluído no plano/);
    await db.query(`update public.tenants set status = 'Suspensa' where id = $1`, [C.tenant]);
    await fails(rpc(C.user, 'save_product', [C.tenant, { name: 'p', sku: 'p', cost: 0, price: 0 }]), /suspensa/);
    expect(await as(db, C.user, 'select id from public.tenants')).toHaveLength(1); // leitura continua
  });

  test('limite de produtos do plano é aplicado no banco', async () => {
    const D = await tenantFor(db, 'dono-d@teste.dev', 'Loja D', 'essencial');
    await db.query(`update public.plans set products = 1 where id = 'essencial'`);
    try {
      await productWithStock(D, 'D-1', 0);
      await fails(rpc(D.user, 'save_product', [D.tenant, { name: 'segundo', sku: 'D-2', cost: 0, price: 0 }]), /Limite de produtos/);
    } finally { await db.query(`update public.plans set products = 500 where id = 'essencial'`); }
  });

  test('paridade role_can SQL × can() do frontend', async () => {
    const { can } = await import('../../src/domain');
    const roles = ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro'] as const;
    const modules = ['pdv', 'produtos', 'financeiro', 'caixa', 'vendas', 'ordens-servico', 'crm', 'configuracoes'];
    const actions = ['visualizar', 'cadastrar', 'editar', 'excluir', 'cancelar', 'exportar', 'configurar', 'hack'];
    const rows = await db.query<{ r: string; m: string; a: string; ok: boolean }>(
      'select r, m, a, app.role_can(r, m, a) ok from unnest($1::text[]) r, unnest($2::text[]) m, unnest($3::text[]) a', [roles, modules, actions]);
    for (const row of rows.rows) expect([row.r, row.m, row.a, row.ok]).toEqual([row.r, row.m, row.a, can(row.r as typeof roles[number], row.m, row.a)]);
  });
});

describe('PDV, caixa e financeiro', () => {
  let product: string;
  beforeAll(async () => { product = await productWithStock(A, 'A-PDV', 10, 2500); });

  test('venda exige caixa aberto; venda mista com troco só em dinheiro; idempotente', async () => {
    const sale = { tenantId: A.tenant, branchId: A.branch, items: [{ productId: product, quantity: 2 }], discount: 0, surcharge: 0, payments: [{ method: 'Pix', amount: 1000 }, { method: 'Dinheiro', amount: 5000 }], requestId: 'venda-1' };
    await fails(rpc(A.user, 'complete_sale', [sale]), /Abra o caixa/);
    const cash = await rpc<string>(A.user, 'open_cash', [A.tenant, A.branch, 10000]);
    const done = await rpc<{ id: string; total: number; change: number; payments: { amount: number; tendered?: number }[] }>(A.user, 'complete_sale', [sale]);
    expect(done.total).toBe(5000);
    expect(done.change).toBe(1000);
    expect(done.payments).toEqual([{ method: 'Pix', amount: 1000 }, { method: 'Dinheiro', amount: 4000, tendered: 5000 }]);
    const again = await rpc<{ id: string }>(A.user, 'complete_sale', [sale]);
    expect(again.id).toBe(done.id);
    await fails(rpc(A.user, 'complete_sale', [{ ...sale, discount: 100 }]), /outro conteúdo/);
    const [stock] = await as<{ quantity: number }>(db, A.user, 'select quantity from public.stock_balances where product_id = $1 and branch_id = $2', [product, A.branch]);
    expect(stock.quantity).toBe(8);
    const [{ total }] = await as<{ total: number }>(db, A.user, 'select app.cash_total($1)::int total', [cash]).catch(() => [{ total: -1 }]);
    expect(total).toBe(-1); // app.* não exposto ao cliente
    const [{ t }] = await db.query<{ t: number }>('select app.cash_total($1)::int t', [cash]).then(r => r.rows);
    expect(t).toBe(14000); // fundo + dinheiro líquido (sem troco)
    const fin = await as<{ amount: number; paid: boolean }>(db, A.user, `select amount::int, paid from public.financial_entries where reference = $1`, [done.id]);
    expect(fin).toEqual([{ amount: 5000, paid: true }]);
  });

  test('preço vem do servidor, não do cliente; estoque insuficiente e pagamento inválido falham sem efeito parcial', async () => {
    const base = { tenantId: A.tenant, branchId: A.branch, discount: 0, surcharge: 0 };
    const sale = await rpc<{ total: number; items: { price: number }[] }>(A.user, 'complete_sale', [{ ...base, items: [{ productId: product, quantity: 1, price: 1 }], payments: [{ method: 'Pix', amount: 2500 }], requestId: 'venda-preco' }]);
    expect(sale.items[0].price).toBe(2500);
    await fails(rpc(A.user, 'complete_sale', [{ ...base, items: [{ productId: product, quantity: 999 }], payments: [{ method: 'Pix', amount: 1 }], requestId: 'venda-x' }]), /insuficiente/);
    await fails(rpc(A.user, 'complete_sale', [{ ...base, items: [{ productId: product, quantity: 1 }], payments: [{ method: 'Pix', amount: 9999 }], requestId: 'venda-y' }]), /excede/);
    await fails(rpc(A.user, 'complete_sale', [{ ...base, items: [{ productId: product, quantity: 1 }], payments: [{ method: 'Cheque', amount: 2500 }], requestId: 'venda-z' }]), /inválida/);
    await fails(rpc(A.user, 'complete_sale', [{ ...base, items: [{ productId: product, quantity: 1.5 }], payments: [{ method: 'Pix', amount: 2500 }], requestId: 'venda-w' }]), /inteiro/);
    const rows = await as(db, A.user, `select id from public.sales where request_id in ('venda-x', 'venda-y', 'venda-z', 'venda-w')`);
    expect(rows).toEqual([]);
  });

  test('cancelamento devolve estoque, estorna dinheiro líquido e é idempotente', async () => {
    const sale = await rpc<{ id: string }>(A.user, 'complete_sale', [{ tenantId: A.tenant, branchId: A.branch, items: [{ productId: product, quantity: 1 }], discount: 0, surcharge: 0, payments: [{ method: 'Dinheiro', amount: 3000 }], requestId: 'venda-cancel' }]);
    const before = (await db.query<{ q: number }>('select quantity q from public.stock_balances where product_id = $1 and branch_id = $2', [product, A.branch])).rows[0].q;
    await rpc(A.user, 'cancel_sale', [A.tenant, sale.id]);
    await rpc(A.user, 'cancel_sale', [A.tenant, sale.id]);
    const after = (await db.query<{ q: number }>('select quantity q from public.stock_balances where product_id = $1 and branch_id = $2', [product, A.branch])).rows[0].q;
    expect(after).toBe(before + 1);
    const moves = (await db.query<{ amount: number }>(`select amount::int from public.cash_movements where reason = $1`, [`Estorno ${sale.id}`])).rows;
    expect(moves).toEqual([{ amount: -2500 }]);
    await fails(rpc(B.user, 'cancel_sale', [A.tenant, sale.id]), /Acesso negado|não encontrada/);
  });

  test('baixa parcial, idempotência da baixa, estorno e cancelamento', async () => {
    const entry = await rpc<string>(A.user, 'save_entry', [A.tenant, { type: 'Despesa', category: 'Aluguel', description: 'Aluguel', amount: 10000, dueDate: '2026-10-30', branchId: A.branch }]);
    const s1 = await rpc<string>(A.user, 'settle_entry', [A.tenant, entry, { amount: 4000, method: 'Pix', requestId: 'b1' }]);
    expect(await rpc(A.user, 'settle_entry', [A.tenant, entry, { amount: 4000, method: 'Pix', requestId: 'b1' }])).toBe(s1);
    await fails(rpc(A.user, 'settle_entry', [A.tenant, entry, { amount: 7000, method: 'Pix', requestId: 'b2' }]), /superior ao saldo/);
    await rpc(A.user, 'settle_entry', [A.tenant, entry, { amount: 6000, method: 'Boleto', requestId: 'b2' }]);
    expect((await as<{ paid: boolean }>(db, A.user, 'select paid from public.financial_entries where id = $1', [entry]))[0].paid).toBe(true);
    await fails(rpc(A.user, 'cancel_entry', [A.tenant, entry, 'erro']), /baixas ativas/);
    await rpc(A.user, 'reverse_settlement', [A.tenant, entry, s1, 'Pix devolvido']);
    expect((await as<{ paid: boolean }>(db, A.user, 'select paid from public.financial_entries where id = $1', [entry]))[0].paid).toBe(false);
  });

  test('fechamento de caixa: diferença exige motivo; idempotente com mesmo valor', async () => {
    const [cash] = await as<{ id: string }>(db, A.user, 'select id from public.cash_registers where branch_id = $1 and closed_at is null', [A.branch]);
    await fails(rpc(A.user, 'close_cash', [A.tenant, cash.id, 1, null]), /exige motivo/);
    const closed = await rpc<{ expected: number; difference: number }>(A.user, 'close_cash', [A.tenant, cash.id, 1, 'Contagem conferida']);
    expect(closed.difference).toBe(1 - closed.expected);
    await rpc(A.user, 'close_cash', [A.tenant, cash.id, 1, 'Contagem conferida']);
    await fails(rpc(A.user, 'close_cash', [A.tenant, cash.id, 2, 'x']), /outro valor/);
  });
});

describe('ordens de serviço, compras e conversões', () => {
  test('OS reserva, consome, gera receita e cancelamento reverte', async () => {
    const product = await productWithStock(A, 'A-OS', 5);
    const customer = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Cliente OS', phone: '1199999' }]);
    const os = await rpc<string>(A.user, 'save_record', [A.tenant, { kind: 'ordens-servico', title: 'Revisão', status: 'Aberta', branchId: A.branch, customerId: customer, items: [{ productId: product, quantity: 2, price: 1000 }], fields: { labor: '50,00', technician: 'Ana' } }]);
    expect((await db.query<{ amount: number }>('select amount::int from public.records where id = $1', [os])).rows[0].amount).toBe(7000);
    await fails(rpc(A.user, 'transition_record', [A.tenant, os, 'Entregue']), /Transição de OS inválida/);
    await rpc(A.user, 'transition_record', [A.tenant, os, 'Em execução']);
    const reserved = async () => (await db.query<{ q: number; r: number }>('select quantity q, reserved r from public.stock_balances where product_id = $1', [product])).rows[0];
    expect(await reserved()).toEqual({ q: 5, r: 2 });
    await fails(rpc(A.user, 'move_stock', [A.tenant, A.branch, product, 1, 'Ajuste', 'inv']), /reservado/);
    await fails(rpc(A.user, 'save_record', [A.tenant, { id: os, kind: 'ordens-servico', title: 'Editada', branchId: A.branch, fields: { labor: '1,00' } }]), /edição bloqueada/);
    await rpc(A.user, 'transition_record', [A.tenant, os, 'Pronta']);
    expect(await reserved()).toEqual({ q: 3, r: 0 });
    expect((await db.query<{ amount: number }>(`select amount::int from public.financial_entries where reference = $1`, [os])).rows).toEqual([{ amount: 7000 }]);
    await rpc(A.user, 'transition_record', [A.tenant, os, 'Cancelada']);
    expect(await reserved()).toEqual({ q: 5, r: 0 });
  });

  test('compra recebida entra no estoque e gera conta a pagar uma vez', async () => {
    const product = await productWithStock(A, 'A-COMPRA', 0);
    const supplier = await rpc<string>(A.user, 'save_record', [A.tenant, { kind: 'fornecedores', title: 'Fornecedor', status: 'Ativo', branchId: A.branch, fields: { phone: '11' } }]);
    const purchase = await rpc<string>(A.user, 'save_record', [A.tenant, { kind: 'compras', title: 'Pedido 1', status: 'Pendente', branchId: A.branch, items: [{ productId: product, quantity: 4, price: 300 }], fields: { supplierId: supplier, dueDate: '2026-11-10' } }]);
    await fails(rpc(A.user, 'transition_record', [A.tenant, purchase, 'Recebida']), /Status inválido|recebimento/);
    await rpc(A.user, 'receive_purchase', [A.tenant, purchase]);
    await rpc(A.user, 'receive_purchase', [A.tenant, purchase]);
    expect((await db.query<{ q: number }>('select quantity q from public.stock_balances where product_id = $1', [product])).rows[0].q).toBe(4);
    expect((await db.query('select 1 from public.financial_entries where reference = $1', [purchase])).rows).toHaveLength(1);
  });

  test('orçamento aprovado converte para OS uma única vez', async () => {
    const quote = await rpc<string>(A.user, 'save_record', [A.tenant, { kind: 'orcamentos', title: 'Orç 1', status: 'Aberto', branchId: A.branch, fields: { labor: '100,00' } }]);
    await fails(rpc(A.user, 'convert_record', [A.tenant, quote, 'ordens-servico']), /Aprove/);
    await rpc(A.user, 'transition_record', [A.tenant, quote, 'Aprovado']);
    const target = await rpc<string>(A.user, 'convert_record', [A.tenant, quote, 'ordens-servico']);
    expect(await rpc(A.user, 'convert_record', [A.tenant, quote, 'ordens-servico'])).toBe(target);
    await fails(rpc(A.user, 'convert_record', [A.tenant, quote, 'pedidos']), /outro tipo/);
  });

  test('importação respeita duplicidades e estratégia', async () => {
    const report = await rpc<{ created: number; updated: number; skipped: number; errors: unknown[] }>(A.user, 'import_products', [A.tenant, [
      { line: 2, name: 'Óleo', sku: 'IMP-1', cost: 100, price: 200 },
      { line: 3, name: 'Óleo dup', sku: 'imp-1', cost: 100, price: 200 },
      { line: 4, name: 'Filtro', sku: 'IMP-2', cost: 1.5, price: 200 },
    ], 'upsert']);
    expect(report).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(report.errors).toHaveLength(2);
    expect((await rpc<{ updated: number }>(A.user, 'import_products', [A.tenant, [{ line: 2, name: 'Óleo 2', sku: 'IMP-1', cost: 1, price: 2 }], 'update'])).updated).toBe(1);
  });
});

describe('Super Admin, cobrança e webhooks', () => {
  let admin: string;
  beforeAll(async () => {
    admin = await createUser(db, 'admin@pistec.dev');
    await db.query('insert into public.platform_admins (user_id) values ($1)', [admin]);
  });

  test('Super Admin só com linha em platform_admins; usuário comum nunca, nem com aal2', async () => {
    await fails(rpc(A.user, 'admin_save_coupon', [{ code: 'X1' }], 'aal2'), /Super Admin/);
    await fails(rpc(null, 'admin_save_coupon', [{ code: 'X1' }]), /permission denied|Super Admin/);
    expect(await as(db, admin, 'select id from public.tenants')).toHaveLength(await db.query('select 1 from public.tenants').then(r => r.rows.length));
    expect(await as(db, A.user, 'select id from public.tenants')).toHaveLength(1);
    await fails(as(db, A.user, 'insert into public.platform_admins(user_id) values ($1)', [A.user]), /permission denied/);
  });

  test('fatura com cupom; pagamento só via confirmação de servidor; webhook duplicado é ignorado', async () => {
    await rpc(admin, 'admin_save_coupon', [{ code: 'PISTEC20', description: '20%', kind: 'percent', value: 2000, startsAt: '2026-01-01', endsAt: '2027-12-31', maxUses: 0, perTenant: 1 }], 'aal2');
    const invoice = await rpc<string>(A.user, 'request_subscription_invoice', [A.tenant, 'premium', 'monthly', 'pistec20', 'fatura-1']);
    expect(await rpc(A.user, 'request_subscription_invoice', [A.tenant, 'premium', 'monthly', 'pistec20', 'fatura-1'])).toBe(invoice);
    await fails(rpc(A.user, 'request_subscription_invoice', [A.tenant, 'premium', 'monthly', 'PISTEC20', 'fatura-2']), /por empresa/);
    const [inv] = (await db.query<{ amount: number; status: string }>('select amount::int, status from public.billing_invoices where id = $1', [invoice])).rows;
    expect(inv).toEqual({ amount: 35920, status: 'Pendente' });
    await fails(as(db, A.user, 'select app.svc_confirm_payment($1, $2, 1, 1, null, null, null, null)', [invoice, 'nsu']), /permission denied/);
    await fails(as(db, A.user, `update public.billing_invoices set status = 'Paga'`), /permission denied/);
    expect((await service<{ r: string }>(db, 'select app.svc_confirm_payment($1, $2, $3, $3, $4, null, null, null) r', [invoice, 'nsu-1', 100, 'pix']))[0].r).toBe('amount_mismatch');
    expect((await service<{ r: string }>(db, 'select app.svc_confirm_payment($1, $2, $3, $3, $4, null, null, null) r', [invoice, 'nsu-1', 35920, 'pix']))[0].r).toBe('paid');
    expect((await service<{ r: string }>(db, 'select app.svc_confirm_payment($1, $2, $3, $3, $4, null, null, null) r', [invoice, 'nsu-1', 35920, 'pix']))[0].r).toBe('duplicate');
    expect((await as<{ status: string }>(db, A.user, 'select status from public.tenants'))[0].status).toBe('Ativa');
    expect((await as<{ status: string }>(db, A.user, 'select status from public.subscriptions'))[0].status).toBe('active');
  });

  test('ciclo de cobrança: vencimento → past_due → suspensão após carência', async () => {
    const E = await tenantFor(db, 'dono-e@teste.dev', 'Loja E', 'essencial');
    await db.query(`update public.subscriptions set current_period_end = current_date - 10 where tenant_id = $1`, [E.tenant]);
    await service(db, 'select app.svc_billing_cycle(5)');
    await service(db, 'select app.svc_billing_cycle(5)');
    expect((await as<{ status: string }>(db, E.user, 'select status from public.tenants'))[0].status).toBe('Suspensa');
    expect((await db.query(`select 1 from public.billing_invoices where tenant_id = $1 and request_id like 'renewal:%'`, [E.tenant])).rows).toHaveLength(1);
  });

  test('outbox: eventos gravados na transação, claim exclusivo, dead-letter após 5 falhas', async () => {
    const events = await service<{ id: number; type: string }>(db, 'select id, type from app.svc_claim_events(500)');
    expect(events.map(e => e.type)).toContain('sale.completed');
    expect(await service(db, 'select id from app.svc_claim_events(500)')).toEqual([]);
    const id = events[0].id;
    for (let i = 0; i < 5; i++) {
      await service(db, `select app.svc_finish_event($1, 'falha')`, [id]);
      await db.query('update public.outbox_events set available_at = now() where id = $1', [id]);
      if (i < 4) await service(db, 'select app.svc_claim_events(500)');
    }
    expect((await db.query<{ status: string }>('select status from public.outbox_events where id = $1', [id])).rows[0].status).toBe('dead');
    await fails(as(db, A.user, 'select app.svc_claim_events(1)'), /permission denied/);
  });

  test('WhatsApp: mensagem duplicada do webhook é armazenada uma vez e isolada por tenant', async () => {
    await db.query(`insert into public.whatsapp_instances (tenant_id, instance_name) values ($1, 'pistec-loja-a')`, [A.tenant]);
    const first = await service<{ r: { status: string } }>(db, `select app.svc_whatsapp_inbound('pistec-loja-a', 'MSG1', '5511@s.whatsapp.net', 'Olá', false) r`);
    const dup = await service<{ r: { status: string } }>(db, `select app.svc_whatsapp_inbound('pistec-loja-a', 'MSG1', '5511@s.whatsapp.net', 'Olá', false) r`);
    expect([first[0].r.status, dup[0].r.status]).toEqual(['stored', 'duplicate']);
    expect(await as(db, A.user, 'select body from public.whatsapp_messages')).toEqual([{ body: 'Olá' }]);
    expect(await as(db, B.user, 'select body from public.whatsapp_messages')).toEqual([]);
  });

  test('push: assinatura do próprio usuário; leitura de notificação coletiva por usuário', async () => {
    await rpc(A.user, 'save_push_subscription', ['https://push.example/abc', 'k', 'a', 'teste']);
    expect(await as(db, B.user, 'select 1 from public.push_subscriptions')).toEqual([]);
    await fails(rpc(A.user, 'save_push_subscription', ['http://inseguro', 'k', 'a', '']), /inválida/);
    const [n] = await service<{ id: string }>(db, `select app.svc_notify($1, 'teste', 'Título', 'Corpo') id`, [A.tenant]);
    expect(await as(db, B.user, 'select 1 from public.notifications where id = $1', [n.id])).toEqual([]);
    await rpc(A.user, 'mark_notifications_read', [[n.id]]);
    expect(await as(db, A.user, 'select 1 from public.notification_reads where notification_id = $1', [n.id])).toHaveLength(1);
  });

  test('cota de IA respeita plano e configuração', async () => {
    const quota = (channel = 'app') => service<{ r: number | null }>(db, 'select app.svc_ai_take_quota($1, $2) r', [A.tenant, channel]).then(rows => rows[0].r);
    expect(await quota()).toBeNull();
    await rpc(A.user, 'save_ai_settings', [A.tenant, { enabled: true, dailyLimit: 1 }]);
    expect(Number(await quota())).toBeGreaterThan(0);
    expect(await quota()).toBeNull();
    expect(await quota('whatsapp')).toBeNull();
  });
});
