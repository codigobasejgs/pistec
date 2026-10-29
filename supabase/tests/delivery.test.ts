// Entrega multicanal (push, e-mail, WhatsApp, cobrança) em Postgres real (PGlite).
import { beforeAll, afterAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let mechanic: string;
const sub = (user: string, endpoint: string) => as(db, user, `select public.save_push_subscription($1,'k','a','teste')`, [endpoint]);
const deliver = async (tenant: string | null, type: string, payload: object = {}) => {
  const { rows: [e] } = await db.query<{ id: number }>(`insert into public.outbox_events(tenant_id,type,payload,status) values($1,$2,$3,'processing') returning id`, [tenant, type, payload]);
  await service(db, 'select public.deliver_internal_event($1)', [e.id]);
  return e.id;
};
const deliveries = (user: string) => db.query<{ type: string }>(`select n.type from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where d.user_id=$1 order by d.id`, [user]).then(r => r.rows.map(x => x.type));

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'dono-a@delivery.invalid', 'Loja A');
  B = await tenantFor(db, 'dono-b@delivery.invalid', 'Loja B');
  mechanic = await createUser(db, 'mecanico@delivery.invalid');
  await db.query(`insert into public.memberships(tenant_id,user_id,role) values($1,$2,'Mecânico')`, [A.tenant, mechanic]);
  await sub(A.user, 'https://push.example/owner-1');
  await sub(A.user, 'https://push.example/owner-2');
  await sub(mechanic, 'https://push.example/mech');
  await sub(B.user, 'https://push.example/b');
}, 120000);
afterAll(async () => { await db?.close(); });

test('push: dois dispositivos do dono; papel sem acesso e outra empresa não recebem', async () => {
  await deliver(A.tenant, 'cash.difference', { difference: 100 });
  expect(await deliveries(A.user)).toEqual(['cash.difference', 'cash.difference']);
  expect(await deliveries(mechanic)).toEqual([]);
  expect(await deliveries(B.user)).toEqual([]);
});

test('push: preferência desligada e tipo silenciado bloqueiam; categoria liberada passa', async () => {
  await as(db, mechanic, 'select public.save_notification_preferences($1,$2)', [A.tenant, { push: true, mutedTypes: ['record.status'] }]);
  await deliver(A.tenant, 'record.status', { kind: 'ordens-servico', title: 'OS 1', to: 'Pronta' });
  await deliver(A.tenant, 'record.created', { kind: 'ordens-servico', title: 'OS 2' });
  expect(await deliveries(mechanic)).toEqual(['record.created']);
  await as(db, mechanic, 'select public.save_notification_preferences($1,$2)', [A.tenant, { push: false }]);
  await deliver(A.tenant, 'record.created', { kind: 'ordens-servico', title: 'OS 3' });
  expect(await deliveries(mechanic)).toEqual(['record.created']);
});

test('push: worker reserva, 410 expira inscrição, 500 faz backoff, 201 conclui; reprocessar evento não duplica', async () => {
  const claimed = await service<{ id: number; endpoint: string; url: string }>(db, 'select * from public.claim_push(500)');
  expect(claimed.length).toBeGreaterThan(0);
  expect(claimed.every(c => c.url.startsWith('/app/'))).toBe(true);
  expect(await service(db, 'select * from public.claim_push(500)')).toEqual([]); // reserva exclusiva
  const byEndpoint = (e: string) => claimed.find(c => c.endpoint === e)!.id;
  const finish = (id: number, status: number) => service<{ r: string }>(db, 'select public.finish_push($1,$2,null) r', [id, status]).then(r => r[0].r);
  expect(await finish(byEndpoint('https://push.example/owner-1'), 201)).toBe('sent');
  expect(await finish(byEndpoint('https://push.example/owner-2'), 410)).toBe('expired');
  expect(await finish(byEndpoint('https://push.example/mech'), 503)).toBe('pending');
  expect((await db.query(`select 1 from public.push_subscriptions where endpoint='https://push.example/owner-2' and expired_at is not null`)).rows).toHaveLength(1);
  expect((await db.query<{ ok: boolean }>(`select available_at > now() ok from public.notification_deliveries where id=$1`, [byEndpoint('https://push.example/mech')])).rows[0].ok).toBe(true);
  const before = (await deliveries(A.user)).length;
  const id = await deliver(A.tenant, 'stock.low', { name: 'Óleo' });
  await db.query(`update public.outbox_events set status='processing' where id=$1`, [id]);
  await service(db, 'select public.deliver_internal_event($1)', [id]);
  expect((await deliveries(A.user)).length).toBe(before + 1); // só owner-1 ativo; reprocesso sem duplicar
});

test('push: teste autorizado só para si, com limite; não-membro bloqueado', async () => {
  expect(Number((await as<{ n: number }>(db, A.user, 'select public.send_test_push($1) n', [A.tenant]))[0].n)).toBe(1);
  await expect(as(db, A.user, 'select public.send_test_push($1)', [B.tenant])).rejects.toThrow(/Acesso negado/);
  for (let i = 0; i < 4; i++) await as(db, A.user, 'select public.send_test_push($1)', [A.tenant]);
  await expect(as(db, A.user, 'select public.send_test_push($1)', [A.tenant])).rejects.toThrow(/Muitos testes/);
  await expect(as(db, A.user, 'select * from public.claim_push(1)')).rejects.toThrow(/permission denied/);
  expect(await as(db, B.user, 'select 1 from public.notification_deliveries')).toEqual([]);
});

test('e-mail: boas-vindas e convite enfileirados uma vez; token sai do outbox; supressão após bounce', async () => {
  const welcome = await deliver(A.tenant, 'tenant.created', {});
  await db.query(`update public.outbox_events set status='processing' where id=$1`, [welcome]);
  await service(db, 'select public.deliver_internal_event($1)', [welcome]);
  expect((await db.query(`select 1 from public.email_messages where template='welcome' and tenant_id=$1`, [A.tenant])).rows).toHaveLength(1);
  const inviteEvent = await deliver(A.tenant, 'invite.created', { inviteId: 'i-1', email: 'novo@delivery.invalid', role: 'Caixa', token: 'segredo' });
  expect((await db.query<{ p: object }>('select payload p from public.outbox_events where id=$1', [inviteEvent])).rows[0].p).not.toHaveProperty('token');
  const [m] = await service<{ id: string; data: { token: string } }>(db, 'select * from public.claim_emails(50) where template=$1', ['invite']);
  expect(m.data.token).toBe('segredo');
  expect(await service(db, `select public.finish_email($1,'re_1',null,false) r`, [m.id])).toEqual([{ r: 'sent' }]);
  expect(await service(db, `select public.email_provider_event('re_1','email.bounced') r`)).toEqual([{ r: 'bounced' }]);
  await deliver(A.tenant, 'invite.created', { inviteId: 'i-2', email: 'novo@delivery.invalid', role: 'Caixa', token: 'x' });
  expect((await db.query<{ status: string; last_error: string }>(`select status,last_error from public.email_messages where idempotency_key='invite:i-2'`)).rows[0]).toEqual({ status: 'failed', last_error: 'suppressed' });
  expect(await as(db, A.user, 'select 1 from public.email_messages')).toEqual([]); // RLS: só Super Admin lê
});

test('e-mail: falha temporária reagenda; permanente encerra; 5 tentativas = dead', async () => {
  await db.query(`insert into public.email_messages(to_email,template,idempotency_key) values('x@delivery.invalid','welcome','retry-1'),('y@delivery.invalid','welcome','perm-1')`);
  const claim = async (key: string) => (await service<{ id: string }>(db, 'select id from public.claim_emails(50) where idempotency_key=$1', [key]))[0]?.id;
  const claimed = await service<{ id: string; idempotency_key: string }>(db, 'select id, idempotency_key from public.claim_emails(50)');
  const retry = claimed.find(c => c.idempotency_key === 'retry-1')!.id, perm = claimed.find(c => c.idempotency_key === 'perm-1')!.id;
  expect(await service(db, `select public.finish_email($1,null,'http_500',false) r`, [retry])).toEqual([{ r: 'queued' }]);
  expect(await service(db, `select public.finish_email($1,null,'http_422',true) r`, [perm])).toEqual([{ r: 'failed' }]);
  for (let i = 0; i < 4; i++) {
    await db.query(`update public.email_messages set next_attempt_at=now() where id=$1`, [retry]);
    const id = await claim('retry-1');
    await service(db, `select public.finish_email($1,null,'http_500',false)`, [id]);
  }
  expect((await db.query<{ status: string }>('select status from public.email_messages where id=$1', [retry])).rows[0].status).toBe('dead');
});

test('WhatsApp: contato criado, atribuição avisa só o atendente, pausa do bot, isolamento', async () => {
  await db.query(`insert into public.whatsapp_instances(tenant_id,instance_name,status) values($1,'pistec-loja-a1','open')`, [A.tenant]);
  const inbound = (id: string) => service<{ r: { status: string; bot: boolean } }>(db, `select public.whatsapp_inbound('pistec-loja-a1',$1,'5511900000001@s.whatsapp.net','Olá',false) r`, [id]).then(r => r[0].r);
  expect((await inbound('W1')).status).toBe('stored');
  expect((await inbound('W1')).status).toBe('duplicate');
  const [contact] = await as<{ id: string }>(db, A.user, 'select id from public.whatsapp_contacts');
  expect(await as(db, B.user, 'select 1 from public.whatsapp_contacts')).toEqual([]);
  expect(await as(db, mechanic, 'select 1 from public.whatsapp_contacts')).toEqual([]); // Mecânico sem módulo whatsapp
  const attendant = await createUser(db, 'atendente@delivery.invalid');
  await db.query(`insert into public.memberships(tenant_id,user_id,role) values($1,$2,'Atendente')`, [A.tenant, attendant]);
  await expect(as(db, A.user, 'select public.assign_whatsapp_contact($1,$2,$3,true)', [A.tenant, contact.id, mechanic])).rejects.toThrow(/sem acesso/);
  await as(db, A.user, 'select public.assign_whatsapp_contact($1,$2,$3,true)', [A.tenant, contact.id, attendant]);
  expect(await as(db, attendant, `select type from public.notifications where type='whatsapp.assigned'`)).toHaveLength(1);
  expect(await as(db, A.user, `select type from public.notifications where type='whatsapp.assigned'`)).toEqual([]);
  expect((await inbound('W2')).bot).toBe(false); // bot pausado para esta conversa
  await expect(as(db, B.user, 'select public.authorize_whatsapp($1,$2)', [A.tenant, 'send'])).rejects.toThrow(/Acesso negado/);
  expect(await as(db, A.user, `select public.authorize_whatsapp($1,'send') r`, [A.tenant])).toEqual([{ r: 'pistec-loja-a1' }]);
  await expect(as(db, A.user, `select public.whatsapp_inbound('pistec-loja-a1','X','1@s.whatsapp.net','forjado',false)`)).rejects.toThrow(/permission denied/);
});

test('cobrança: vencimento e fim de teste geram evento uma vez; Super Admin é avisado', async () => {
  // Avisos de fim de teste em 7, 3, 1 e 0 dias (política de 1 mês, 03/11/2026).
  await db.query(`update public.subscriptions set current_period_end=(now() at time zone 'America/Sao_Paulo')::date+3 where tenant_id=$1`, [B.tenant]);
  await service(db, 'select public.run_billing_cycle()');
  await service(db, 'select public.run_billing_cycle()');
  expect((await db.query(`select 1 from public.outbox_events where tenant_id=$1 and type='subscription.trial_ending'`, [B.tenant])).rows).toHaveLength(1);
  const admin = await createUser(db, 'admin@delivery.invalid');
  await db.query('insert into public.platform_admins(user_id) values($1)', [admin]);
  await sub(admin, 'https://push.example/admin');
  const event = await deliver(B.tenant, 'tenant.created', {});
  await db.query(`update public.outbox_events set status='processing' where id=$1`, [event]);
  await service(db, 'select public.deliver_internal_event($1)', [event]); // reprocesso: aviso não duplica
  expect(await deliveries(admin)).toEqual(['platform.tenant.created']);
  const q = `select 1 from public.notifications where type='platform.tenant.created' and data->>'tenantId'=$1`;
  expect(await as(db, admin, q, [B.tenant])).toHaveLength(1);
  expect(await as(db, B.user, q, [B.tenant])).toEqual([]); // aviso de plataforma não vaza para a loja
  const summary = (await as<{ r: { pushDevices: number } }>(db, admin, 'select public.admin_integration_summary() r', [], 'aal2'))[0].r;
  expect(summary.pushDevices).toBeGreaterThan(0);
  await expect(as(db, A.user, 'select public.admin_integration_summary()', [], 'aal2')).rejects.toThrow(/Super Admin/);
});
