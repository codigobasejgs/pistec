import { useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, MessageCircle } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { Badge, DataTable, Empty, PageHeader, Panel, Stat, useNotice } from '../../ui';
import { date, today } from '../../lib';
import { maintenanceDue } from '../../services/workshop';
import { useWorkshop } from './useWorkshop';

/** Revisões previstas a partir das recomendações registradas nas OS entregues. Contato manual, respeitando consentimento. */
export default function Loyalty() {
  const { state, session, perform } = useDemo(); const notice = useNotice(); const { settings } = useWorkshop();
  const [days, setDays] = useState(settings.maintenanceWarnDays || 15);
  const day = today();
  const due = useMemo(() => maintenanceDue(state, session.tenantId, day, days), [state, session.tenantId, day, days]);
  const rows = due.map(d => ({ id: d.record.id, ...d }));
  const scheduled = state.records.filter(r => r.tenantId === session.tenantId && r.kind === 'agenda' && r.fields.source === 'fideliza');
  async function done(id: string) {
    try { await perform(d => { const r = d.records.find(x => x.id === id && x.tenantId === session.tenantId)!; r.fields.nextServiceDone = 'true'; r.history.push({ date: new Date().toISOString(), text: `Revisão marcada como tratada por ${session.name}` }); }, rpc('update_os_work', { p_tenant: session.tenantId, p_id: id, p: { nextServiceDone: 'true' } })); notice('Marcado como tratado.'); }
    catch (e) { notice((e as Error).message); }
  }
  async function schedule(row: typeof rows[number]) {
    const when = window.prompt('Data do agendamento (AAAA-MM-DD)', row.record.fields.nextServiceDate), time = when && window.prompt('Horário (HH:MM)', '09:00');
    if (!when || !time) return;
    const rec = { id: crypto.randomUUID(), tenantId: session.tenantId, branchId: session.branchId, kind: 'agenda', title: row.record.fields.nextService || 'Revisão', status: 'Agendado', customerId: row.record.customerId, date: day, amount: 0, items: [], history: [],
      fields: { vehicleId: row.record.fields.vehicleId ?? '', scheduledDate: when, time, duration: '60', responsible: row.record.fields.technician || session.name, box: '', service: `${row.record.fields.nextService || 'Revisão'} (retorno da OS ${row.record.title})`, source: 'fideliza', sourceOs: row.record.id, allowOverlap: 'Não' } };
    try { await perform(d => { d.records.push({ ...rec, history: [{ date: new Date().toISOString(), text: `Agendado pelo Fideliza por ${session.name}` }] }); }, rpc('save_record', { p_tenant: session.tenantId, p: { ...rec, status: undefined } })); notice('Agendamento criado. Confirme com o cliente.'); }
    catch (e) { notice((e as Error).message); }
  }
  return <div className="page stack">
    <PageHeader title="PISTEC Fideliza" subtitle="Clientes com revisão recomendada pela oficina. Baseado na data registrada na OS, não na quilometragem atual (desconhecida)."/>
    <div className="grid grid-4" data-tour="loyalty-kpis">
      <Stat label="Elegíveis no período" value={rows.length} tone="blue"/><Stat label="Vencidas" value={rows.filter(r => r.overdue).length} tone="red"/>
      <Stat label="Com consentimento" value={rows.filter(r => r.customer?.consent).length} tone="green"/><Stat label="Agendamentos gerados" value={scheduled.length} hint={`${scheduled.filter(s => s.status === 'Concluído').length} comparecimentos`} tone="cyan"/>
    </div>
    <Panel><label className="field" style={{ maxWidth: 260 }}><span>Mostrar revisões até (dias à frente)</span><input type="number" min={0} max={180} value={days} onChange={e => setDays(Math.max(0, Number(e.target.value) || 0))}/></label>
      {!rows.length ? <Empty text="Nenhuma revisão prevista. Registre a próxima recomendação na tela Mecânico ao concluir a OS."/> : <DataTable rows={rows} columns={[
        { key: 'customer', label: 'Cliente', render: (r: typeof rows[number]) => <>{r.customer?.name ?? '—'}{!r.customer?.consent && <><br/><small className="muted">sem consentimento de contato</small></>}</> },
        { key: 'vehicle', label: 'Veículo', render: (r: typeof rows[number]) => r.vehicle ? `${r.vehicle.title} · ${r.vehicle.fields.plate}` : '—' },
        { key: 'service', label: 'Recomendação', render: (r: typeof rows[number]) => <>{r.record.fields.nextService || 'Revisão'}<br/><small className="muted">{r.record.fields.nextServiceKm ? `ou ${r.record.fields.nextServiceKm} km · ` : ''}última km registrada: {r.record.fields.mileage || '—'}</small></> },
        { key: 'date', label: 'Previsto', render: (r: typeof rows[number]) => <>{date(r.record.fields.nextServiceDate)} {r.overdue && <Badge>Vencida</Badge>}</> },
        { key: 'actions', label: 'Ações', render: (r: typeof rows[number]) => { const tel = r.customer?.phone.replace(/\D/g, ''), msg = encodeURIComponent(`Olá, ${r.customer?.name}! Pelo nosso último atendimento, recomendamos ${r.record.fields.nextService || 'uma revisão'} por volta de ${date(r.record.fields.nextServiceDate)}. Quer agendar?`);
          return <div className="toolbar">{tel && r.customer?.consent && <a className="btn" href={`https://wa.me/55${tel}?text=${msg}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true"/>Lembrar</a>}<button className="btn" onClick={() => void schedule(r)}><CalendarPlus size={14} aria-hidden="true"/>Agendar</button><button className="btn ghost" onClick={() => void done(r.id)}><CheckCircle2 size={14} aria-hidden="true"/>Tratado</button></div>; } },
      ]}/>}
      <p className="muted small">O lembrete abre o seu WhatsApp com o texto pronto; o PISTEC não envia em massa nem confirma entrega. Agendamento não é venda: a receita só existe quando a OS for concluída.</p>
    </Panel>
  </div>;
}
