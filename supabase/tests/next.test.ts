// PISTEC NEXT: portal do cliente, aprovação por item, conflito de agenda, cotação → compra, execução da OS, fotos e isolamento.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let mechanic: string, customer: string, vehicle: string, product: string, product2: string, supplier: string;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const save = (user: string, p: Record<string, unknown>) => rpc<string>(user, 'save_record', [A.tenant, { branchId: A.branch, ...p }]);
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@next.invalid', 'Oficina Next A');
  B = await tenantFor(db, 'b@next.invalid', 'Oficina Next B');
  mechanic = await createUser(db, 'mec@next.invalid');
  await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'Mecânico')", [A.tenant, mechanic]);
  customer = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Cliente Portal', phone: '11999990000', consent: true }]);
  product = await rpc<string>(A.user, 'save_product', [A.tenant, { name: 'Pastilha', sku: 'PAS-1', price: 10000, cost: 6000, min: 2 }]);
  product2 = await rpc<string>(A.user, 'save_product', [A.tenant, { name: 'Disco', sku: 'DIS-1', price: 20000, cost: 12000, min: 0 }]);
  vehicle = await save(A.user, { kind: 'veiculos', title: 'Moto CG', customerId: customer, fields: { plate: 'ABC1D23', brand: 'Honda', model: 'CG', year: '2020' } });
  supplier = await save(A.user, { kind: 'fornecedores', title: 'Distribuidora X', fields: { document: '11222333000181', phone: '1133334444' } });
}, 180000);
afterAll(async () => { await db?.close(); });

test('orçamento por item: cliente aprova parte pelo link, total reflete só o aprovado e conversão leva só os aprovados', async () => {
  const quote = await save(A.user, { kind: 'orcamentos', title: 'Freios', customerId: customer, fields: { vehicleId: vehicle, validUntil: '2099-12-31', labor: '150,00' },
    items: [{ productId: product, quantity: 2, price: 10000 }, { productId: product2, quantity: 1, price: 20000 }] });
  const link = await rpc<{ token: string }>(A.user, 'create_customer_link', [A.tenant, 'record', quote, 7]);
  expect(link.token).toMatch(/^[0-9a-f]{48}$/);
  const view = await rpc<{ records: { id: string; hash: string; amount: number; items: Record<string, unknown>[] }[]; company: { name: string } }>(null, 'portal_view', [link.token]);
  expect(view.company.name).toBe('Oficina Next A');
  const rec = view.records[0];
  expect(rec.amount).toBe(55000);
  expect(JSON.stringify(rec)).not.toContain('cost'); // custo nunca chega ao cliente
  // Hash antigo (oficina alterou depois) é recusado.
  await expect(rpc(null, 'portal_decide', [link.token, quote, 'x'.repeat(64), 'decide', { [product]: 'approve', [product2]: 'approve', labor: 'approve' }, 'Maria Cliente'])).rejects.toThrow(/alterado/);
  await expect(rpc(null, 'portal_decide', [link.token, quote, rec.hash, 'decide', { [product]: 'approve' }, 'Maria Cliente'])).rejects.toThrow(/cada item/);
  const r = await rpc<{ status: string; approvedTotal: number }>(null, 'portal_decide', [link.token, quote, rec.hash, 'decide', { [product]: 'approve', [product2]: 'reject', labor: 'approve' }, 'Maria Cliente']);
  expect(r).toEqual({ status: 'Aprovado', approvedTotal: 35000 });
  const [row] = (await db.query<{ amount: number; items: unknown[]; status: string }>('select amount, items, status from public.records where id = $1', [quote])).rows;
  expect(Number(row.amount)).toBe(35000); expect(row.items).toHaveLength(1);
  await expect(rpc(null, 'portal_decide', [link.token, quote, rec.hash, 'decide', { [product]: 'approve', [product2]: 'approve', labor: 'approve' }, 'Maria Cliente'])).rejects.toThrow(/já foi respondido/);
  const [snap] = (await db.query<{ n: number }>("select count(*)::int n from public.estimate_decisions where record_id = $1 and kind = 'decision'", [quote])).rows;
  expect(snap.n).toBe(1);
  const os = await rpc<string>(A.user, 'convert_record', [A.tenant, quote, 'ordens-servico']);
  const [o] = (await db.query<{ amount: number; items: { productId: string }[] }>('select amount, items from public.records where id = $1', [os])).rows;
  expect(Number(o.amount)).toBe(35000); expect(o.items.map(i => i.productId)).toEqual([product]);
});

test('link revogado ou de outra empresa não abre; token inválido devolve nulo', async () => {
  const quote = await save(A.user, { kind: 'orcamentos', title: 'Revisão', customerId: customer, fields: { validUntil: '2099-12-31', labor: '80,00' } });
  const link = await rpc<{ token: string }>(A.user, 'create_customer_link', [A.tenant, 'record', quote, 3]);
  await expect(rpc(B.user, 'create_customer_link', [A.tenant, 'record', quote, 3])).rejects.toThrow(/Acesso negado/);
  await expect(rpc(B.user, 'revoke_customer_links', [A.tenant, quote])).rejects.toThrow();
  expect(await rpc<number>(A.user, 'revoke_customer_links', [A.tenant, quote])).toBe(1);
  expect(await rpc(null, 'portal_view', [link.token])).toBeNull();
  expect(await rpc(null, 'portal_view', ['zz'])).toBeNull();
  // Leitura direta das tabelas do portal é bloqueada para anônimos e outra empresa.
  await expect(as(db, null, 'select * from public.customer_links')).rejects.toThrow();
  expect(await as(db, B.user, 'select * from public.customer_links')).toEqual([]);
  expect(await as(db, B.user, 'select * from public.estimate_decisions')).toEqual([]);
});

test('portal do cliente: escopo do cliente vê só seus veículos e registros, com fotos marcadas', async () => {
  const os = await save(A.user, { kind: 'ordens-servico', title: 'OS portal', customerId: customer, fields: { vehicleId: vehicle, technician: 'Rui', dueDate: '2099-01-01', complaint: 'Barulho', labor: '50,00', notes: 'NOTA INTERNA' } });
  const shared = await rpc<string>(A.user, 'add_record_attachment', [A.tenant, os, 'Frente', PHOTO, true]);
  await rpc(A.user, 'add_record_attachment', [A.tenant, os, 'Interna', PHOTO, false]);
  await expect(rpc(A.user, 'add_record_attachment', [A.tenant, os, 'Ruim', 'data:text/html;base64,AAAA', true])).rejects.toThrow();
  const other = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Outro cliente', phone: '11988887777' }]);
  await save(A.user, { kind: 'ordens-servico', title: 'OS de outro', customerId: other, fields: { technician: 'Rui', dueDate: '2099-01-01', complaint: 'x', labor: '10,00' } });
  const link = await rpc<{ token: string }>(A.user, 'create_customer_link', [A.tenant, 'customer', customer, 7]);
  const view = await rpc<{ vehicles: { plate: string }[]; records: { title: string; photos: { label: string }[] }[] }>(null, 'portal_view', [link.token]);
  expect(view.vehicles.map(v => v.plate)).toEqual(['ABC1D23']);
  expect(view.records.some(r => r.title === 'OS de outro')).toBe(false);
  const mine = view.records.find(r => r.title === 'OS portal')!;
  expect(mine.photos.map(p => p.label)).toEqual(['Frente']);
  expect(JSON.stringify(view)).not.toContain('NOTA INTERNA');
  expect(await as(db, B.user, 'select id from public.record_attachments')).toEqual([]);
  expect((await as(db, A.user, 'select id from public.record_attachments where id = $1', [shared])).length).toBe(1);
});

test('agenda bloqueia conflito de mecânico e box; encaixe explícito permitido', async () => {
  const base = { kind: 'agenda', customerId: customer, fields: { scheduledDate: '2099-05-10', time: '09:00', duration: '60', responsible: 'Ana', box: 'Box 1', service: 'Revisão' } };
  await save(A.user, { ...base, title: 'Agenda 1' });
  await expect(save(A.user, { ...base, title: 'Agenda 2', fields: { ...base.fields, time: '09:30', box: 'Box 2' } })).rejects.toThrow(/Conflito de agenda/);
  await expect(save(A.user, { ...base, title: 'Agenda 3', fields: { ...base.fields, time: '09:30', responsible: 'Rui' } })).rejects.toThrow(/Conflito de agenda/);
  await save(A.user, { ...base, title: 'Agenda 4', fields: { ...base.fields, time: '10:00' } });
  await save(A.user, { ...base, title: 'Agenda 5', fields: { ...base.fields, time: '09:15', allowOverlap: 'true' } });
  await expect(save(A.user, { ...base, title: 'Agenda 6', fields: { ...base.fields, time: '25:00' } })).rejects.toThrow(/Horário inválido/);
});

test('cotação: aprovação gera compra pendente com preços da proposta; exige permissão de compras', async () => {
  const q = await save(A.user, { kind: 'cotacoes', title: 'Cotação pastilhas', items: [{ productId: product, quantity: 5, price: 0 }] });
  await expect(rpc(A.user, 'approve_supplier_quote', [A.tenant, q, supplier])).rejects.toThrow(/Registre a proposta/);
  await db.query("update public.records set fields = fields || jsonb_build_object('responses', $2::text) where id = $1", [q, JSON.stringify([{ supplierId: supplier, prices: { [product]: 5500 }, freight: 1500, leadDays: 3, validUntil: '2099-01-01' }])]);
  await expect(rpc(mechanic, 'approve_supplier_quote', [A.tenant, q, supplier])).rejects.toThrow(/perfil/);
  const purchase = await rpc<string>(A.user, 'approve_supplier_quote', [A.tenant, q, supplier]);
  expect(await rpc<string>(A.user, 'approve_supplier_quote', [A.tenant, q, supplier])).toBe(purchase); // idempotente
  const [p] = (await db.query<{ status: string; amount: number; kind: string }>('select status, amount, kind from public.records where id = $1', [purchase])).rows;
  expect(p).toEqual({ status: 'Pendente', amount: 27500, kind: 'compras' });
  await rpc(A.user, 'receive_purchase', [A.tenant, purchase]);
  const [b] = (await db.query<{ quantity: number }>('select quantity from public.stock_balances where tenant_id = $1 and product_id = $2', [A.tenant, product])).rows;
  expect(b.quantity).toBe(5);
});

test('execução da OS: mecânico registra horas; custo/comissão só com permissão de relatórios; campos fora da lista recusados', async () => {
  const os = await save(A.user, { kind: 'ordens-servico', title: 'OS exec', customerId: customer, fields: { technician: 'Rui', dueDate: '2099-01-01', complaint: 'x', labor: '100,00' } });
  await rpc(mechanic, 'update_os_work', [A.tenant, os, { hoursWorked: '1.5', workLog: 'Troquei pastilhas', nextServiceDate: '2099-06-01', nextService: 'Revisão de freios' }]);
  await expect(rpc(mechanic, 'update_os_work', [A.tenant, os, { thirdPartyCost: '50,00' }])).rejects.toThrow(/perfil/);
  await expect(rpc(A.user, 'update_os_work', [A.tenant, os, { labor: '1,00' }])).rejects.toThrow(/não permitido/);
  await rpc(A.user, 'update_os_work', [A.tenant, os, { thirdPartyCost: '50,00', commissionPct: '10' }]);
  const [r] = (await db.query<{ fields: Record<string, string>; amount: number }>('select fields, amount from public.records where id = $1', [os])).rows;
  expect(r.fields.hoursWorked).toBe('1.5'); expect(r.fields.thirdPartyCost).toBe('50,00'); expect(Number(r.amount)).toBe(10000);
  await expect(rpc(B.user, 'update_os_work', [A.tenant, os, { hoursWorked: '1' }])).rejects.toThrow(/Acesso negado/);
});

test('configurações da oficina: custo/hora oculto de quem não vê relatórios; validação de limites; dispensa auditada', async () => {
  await rpc(A.user, 'save_workshop_settings', [A.tenant, { hourlyCost: 9000, lowMarginPct: 25, mode: 'assistido', packages: [] }]);
  await expect(rpc(A.user, 'save_workshop_settings', [A.tenant, { lowMarginPct: 150 }])).rejects.toThrow(/limite/);
  await expect(rpc(mechanic, 'save_workshop_settings', [A.tenant, { hourlyCost: 1 }])).rejects.toThrow(/perfil/);
  expect((await rpc<Record<string, unknown>>(A.user, 'workshop_settings', [A.tenant])).hourlyCost).toBe(9000);
  expect((await rpc<Record<string, unknown>>(mechanic, 'workshop_settings', [A.tenant])).hourlyCost).toBeUndefined();
  await rpc(A.user, 'dismiss_alert', [A.tenant, 'os-atrasada:abc-123', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)]);
  await expect(rpc(A.user, 'dismiss_alert', [A.tenant, 'os-atrasada:abc-123', '2099-01-01'])).rejects.toThrow(/90 dias/);
  await expect(rpc(A.user, 'dismiss_alert', [A.tenant, 'x', '2026-01-01'])).rejects.toThrow();
  await expect(rpc(B.user, 'workshop_settings', [A.tenant])).rejects.toThrow(/Acesso negado/);
  expect(await service(db, "select count(*)::int n from public.audit_logs where action like 'AutoPilot: alerta dispensado%'")).toEqual([{ n: 1 }]);
});

test('garantia recusada exige justificativa; frota é registro da oficina e não do SaaS', async () => {
  const os = await save(A.user, { kind: 'ordens-servico', title: 'OS garantia', customerId: customer, fields: { technician: 'Rui', dueDate: '2099-01-01', complaint: 'x', labor: '10,00' } });
  const w = await save(A.user, { kind: 'garantias', title: 'Garantia freio', customerId: customer, fields: { saleId: os, expiresAt: '2099-01-01', reason: 'Ruído' } });
  await expect(rpc(A.user, 'transition_record', [A.tenant, w, 'Rejeitada', null])).rejects.toThrow(/Justificativa/);
  await rpc(A.user, 'transition_record', [A.tenant, w, 'Rejeitada', 'Desgaste natural fora da cobertura']);
  const fleet = await save(A.user, { kind: 'frotas', title: 'Entregas Rápidas Ltda', fields: { document: '11222333000181' } });
  const [f] = (await db.query<{ status: string }>('select status from public.records where id = $1', [fleet])).rows;
  expect(f.status).toBe('Ativa');
  expect(await as(db, B.user, "select id from public.records where kind = 'frotas'")).toEqual([]);
});

test('Mecânico IA: autorização exige editar a OS e plano com IA; contexto sem custo nem dados do cliente', async () => {
  const os = await save(A.user, { kind: 'ordens-servico', title: 'OS IA', customerId: customer, fields: { technician: 'Rui', dueDate: '2099-01-01', complaint: 'Barulho no freio', labor: '10,00' } });
  const ctx = await rpc<{ os: { complaint: string }; products: { id: string }[] }>(mechanic, 'authorize_mechanic_ai', [A.tenant, os]);
  expect(ctx.os.complaint).toBe('Barulho no freio');
  expect(JSON.stringify(ctx)).not.toMatch(/cost|Cliente Portal|11999990000/);
  await expect(rpc(B.user, 'authorize_mechanic_ai', [A.tenant, os])).rejects.toThrow(/Acesso negado/);
  await db.query("update public.tenants set plan_id = 'essencial' where id = $1", [A.tenant]);
  await expect(rpc(A.user, 'authorize_mechanic_ai', [A.tenant, os])).rejects.toThrow(/plano|Módulo/);
  await db.query("update public.tenants set plan_id = 'premium' where id = $1", [A.tenant]);
});

test('WhatsApp: bot responde no máximo uma vez por mensagem, respeita atendimento humano e quota; status só avança', async () => {
  const inst = 'pistec-nexttest-0001';
  await db.query("insert into public.whatsapp_instances (tenant_id, instance_name, status, bot_enabled) values ($1, $2, 'open', true)", [A.tenant, inst]);
  await db.query("insert into public.ai_settings (tenant_id, enabled, whatsapp_bot, daily_limit) values ($1, true, true, 5) on conflict (tenant_id) do update set enabled = true, whatsapp_bot = true", [A.tenant]);
  const inbound = (id: string, from = '5511900000001@s.whatsapp.net', me = false) => service<{ r: { id: string } }>(db, 'select public.whatsapp_inbound($1, $2, $3, $4, $5) r', [inst, id, from, 'Bom dia, vocês abrem sábado?', me]).then(r => r[0].r);
  const m1 = await inbound('EXT-1');
  expect((await inbound('EXT-1')) as unknown).toMatchObject({ status: 'duplicate' });
  const pending = (await service<{ id: string }>(db, 'select public.svc_bot_pending(10) id')).map(r => r.id);
  expect(pending).toContain(m1.id);
  const ctx = (await service<{ r: Record<string, unknown> }>(db, 'select public.svc_bot_claim($1) r', [m1.id]))[0].r;
  expect(ctx).toMatchObject({ instance: inst, remote: '5511900000001@s.whatsapp.net' });
  expect(JSON.stringify(ctx)).not.toMatch(/cost|Cliente Portal/);
  expect((await service<{ r: Record<string, unknown> }>(db, 'select public.svc_bot_claim($1) r', [m1.id]))[0].r).toEqual({ skip: 'duplicate' });
  await service(db, 'select public.svc_bot_finish($1, $2, null)', [m1.id, 'OUT-1']);
  // Conversa assumida por humano: bot não responde.
  await db.query("update public.whatsapp_contacts set bot_paused = true where remote_jid = '5511900000001@s.whatsapp.net'");
  const m2 = await inbound('EXT-2');
  expect((await service<{ r: Record<string, unknown> }>(db, 'select public.svc_bot_claim($1) r', [m2.id]))[0].r).toEqual({ skip: 'human_handling' });
  // Quota esgotada.
  await db.query('update public.ai_settings set daily_limit = 0 where tenant_id = $1', [A.tenant]);
  const m3 = await inbound('EXT-3', '5511900000002@s.whatsapp.net');
  expect((await service<{ r: Record<string, unknown> }>(db, 'select public.svc_bot_claim($1) r', [m3.id]))[0].r).toEqual({ skip: 'quota_or_disabled' });
  // Status: sent → read; não volta para delivered; mensagem de outra instância não é afetada.
  await service(db, 'select public.whatsapp_inbound($1, $2, $3, $4, true, $5)', [inst, 'OUT-9', '5511900000001@s.whatsapp.net', 'resposta', 'sent']);
  const st = (s: string) => service<{ r: string }>(db, 'select public.whatsapp_message_status($1, $2, $3) r', [inst, 'OUT-9', s]).then(r => r[0].r);
  expect(await st('read')).toBe('read'); expect(await st('delivered')).toBe('kept'); expect(await st('failed')).toBe('kept');
  expect((await service<{ r: string }>(db, 'select public.whatsapp_message_status($1, $2, $3) r', ['pistec-outra-0001', 'OUT-9', 'read']))[0].r).toBe('unknown');
  await expect(as(db, A.user, 'select public.svc_bot_claim($1)', [m1.id])).rejects.toThrow();
  expect(await as(db, B.user, 'select id from public.whatsapp_messages')).toEqual([]);
});
