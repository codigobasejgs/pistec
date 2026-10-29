import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, Trash2 } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { PageHeader, Panel, useNotice } from '../../ui';
import { today, uid } from '../../lib';
import { can } from '../../domain';
import type { OperationalRecord } from '../../types';
import { compressPhoto } from './photo';

export const CHECK_STATES = ['Conforme', 'Atenção', 'Não conforme', 'Não avaliado'] as const;
export const CHECKLISTS: Record<'Carro' | 'Moto', Record<string, string[]>> = {
  Carro: { Exterior: ['Lataria e pintura', 'Para-brisa e vidros', 'Faróis e lanternas'], Interior: ['Bancos e forração', 'Painel e luzes de alerta'], Elétrica: ['Bateria', 'Buzina'], Segurança: ['Freio de estacionamento', 'Cintos'], Pneus: ['Pneus dianteiros', 'Pneus traseiros', 'Estepe'], Fluidos: ['Óleo do motor', 'Arrefecimento', 'Fluido de freio'], Acessórios: ['Macaco e chave de roda', 'Triângulo'] },
  Moto: { Exterior: ['Carenagem e pintura', 'Retrovisores', 'Farol e piscas'], Elétrica: ['Bateria', 'Buzina', 'Painel'], Segurança: ['Freio dianteiro', 'Freio traseiro', 'Kit transmissão'], Pneus: ['Pneu dianteiro', 'Pneu traseiro'], Fluidos: ['Óleo do motor'], Acessórios: ['Baú / bagageiro', 'Capacete deixado'] },
};
const PHOTO_SPOTS = { Carro: ['Frente', 'Traseira', 'Lado esquerdo', 'Lado direito', 'Painel / quilometragem', 'Avarias'], Moto: ['Frente', 'Traseira', 'Lado esquerdo', 'Lado direito', 'Painel / quilometragem', 'Avarias'] };
const FUEL = ['Reserva', '1/4', '1/2', '3/4', 'Cheio', 'Não se aplica'];

/** Entrada de veículo: cria a OS real (mesma RPC save_record) com checklist estruturado e anexa fotos privadas. */
export default function CheckIn() {
  const { state, session, prefix, mode, perform } = useDemo(); const notice = useNotice(); const navigate = useNavigate();
  const [customerId, setCustomerId] = useState(''), [vehicleId, setVehicleId] = useState(''), [type, setType] = useState<'Carro' | 'Moto'>('Carro');
  const [checks, setChecks] = useState<Record<string, { state: string; note: string }>>({}), [photos, setPhotos] = useState<{ label: string; data: string; shared: boolean }[]>([]);
  const [pending, setPending] = useState(false), [quick, setQuick] = useState(false);
  const customers = state.customers.filter(c => c.tenantId === session.tenantId);
  const vehicles = state.records.filter(r => r.tenantId === session.tenantId && r.kind === 'veiculos' && r.customerId === customerId && r.status === 'Ativo');
  const vehicle = vehicles.find(v => v.id === vehicleId);
  const slug = state.tenants.find(t => t.id === session.tenantId)?.slug;
  const allowed = can(session.role, 'ordens-servico', 'cadastrar');
  const list = CHECKLISTS[type];
  async function addPhoto(label: string, file?: File) {
    if (!file) return;
    try { const data = await compressPhoto(file); setPhotos(p => [...p, { label, data, shared: label !== 'Painel / quilometragem' }]); } catch (e) { notice((e as Error).message); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!customerId || !vehicle) { notice('Selecione cliente e veículo.'); return; }
    if (f.plateConfirm.replace(/[-\s]/g, '').toUpperCase() !== (vehicle.fields.plate ?? '').replace(/[-\s]/g, '').toUpperCase()) { notice('A placa conferida não corresponde ao veículo.'); return; }
    if (!quick && !photos.length) { notice('Registre ao menos uma foto ou marque "Atendimento rápido".'); return; }
    const checklist = Object.entries(list).flatMap(([cat, items]) => items.map(item => ({ cat, item, ...(checks[`${cat}:${item}`] ?? { state: 'Não avaliado', note: '' }) })));
    const at = new Date().toISOString();
    const record: OperationalRecord = { id: uid(), tenantId: session.tenantId, branchId: session.branchId, kind: 'ordens-servico', title: `${vehicle.title} · ${vehicle.fields.plate}`, status: 'Aberta', customerId, date: today(), amount: 0, items: [], history: [],
      fields: { vehicleId, technician: f.technician, dueDate: f.dueDate, mileage: f.mileage, complaint: f.complaint, checklist: checklist.filter(c => c.state !== 'Conforme' && c.state !== 'Não avaliado').map(c => `${c.cat} · ${c.item}: ${c.state}${c.note ? ` (${c.note})` : ''}`).join('\n'),
        notes: '', labor: '', checkin: JSON.stringify({ at, by: session.name, type, fuel: f.fuel, belongings: f.belongings, damages: f.damages, accessories: f.accessories, receivedState: f.receivedState, checklist, quick, version: 1 }), receivedBy: session.name } };
    setPending(true);
    try {
      const id = await perform(draft => { draft.records.push({ ...record, history: [{ date: at, text: `Check-in 360° por ${session.name}` }] }); return record.id; }, rpc('save_record', { p_tenant: session.tenantId, p: { ...record, status: undefined } })) as string;
      if (mode === 'real' && photos.length) {
        const { supabase } = await import('../../real/client'); let failed = 0;
        for (const p of photos) { const { error } = await supabase.rpc('add_record_attachment', { p_tenant: session.tenantId, p_record: id, p_label: p.label, p_data: p.data, p_shared: p.shared }); if (error) failed++; }
        if (failed) notice(`${failed} foto(s) não foram salvas. A OS foi criada; anexe novamente pela tela Mecânico.`);
      }
      notice(mode === 'demo' && photos.length ? 'Entrada registrada. Na demonstração as fotos não são armazenadas.' : 'Entrada registrada e OS aberta.');
      navigate(`${prefix}/loja/${slug}/ordens-servico?q=${encodeURIComponent(record.title)}`);
    } catch (err) { notice((err as Error).message); } finally { setPending(false); }
  }
  if (!allowed) return <div className="page"><PageHeader title="Check-in 360°"/><p>Seu perfil não permite abrir ordens de serviço.</p></div>;
  return <form className="page stack" onSubmit={submit}>
    <PageHeader title="Check-in 360° — Nova entrada de veículo" subtitle="Cria a ordem de serviço com checklist, fotos e condições de recebimento."/>
    <Panel title="1. Cliente e veículo"><div className="form-grid" data-tour="checkin-vehicle">
      <label className="field"><span>Cliente</span><select required value={customerId} onChange={e => { setCustomerId(e.target.value); setVehicleId(''); }}><option value="">Selecione</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span>Veículo</span><select required value={vehicleId} onChange={e => { setVehicleId(e.target.value); const v = vehicles.find(x => x.id === e.target.value); if (v?.fields.type === 'Moto') setType('Moto'); else if (v) setType('Carro'); }}><option value="">{customerId && !vehicles.length ? 'Cadastre o veículo em Veículos' : 'Selecione'}</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.title} · {v.fields.plate}</option>)}</select></label>
      <label className="field"><span>Confirme a placa</span><input name="plateConfirm" required autoComplete="off" placeholder={vehicle?.fields.plate}/></label>
      <label className="field"><span>Tipo</span><select value={type} onChange={e => setType(e.target.value as 'Carro' | 'Moto')}><option>Carro</option><option>Moto</option></select></label>
      <label className="field"><span>Quilometragem</span><input name="mileage" type="number" min={Number(vehicle?.fields.mileage) || 0} required inputMode="numeric"/></label>
      <label className="field"><span>Combustível</span><select name="fuel">{FUEL.map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="field"><span>Técnico responsável</span><input name="technician" required/></label>
      <label className="field"><span>Previsão de entrega</span><input name="dueDate" type="date" required min={today()}/></label>
      <label className="field form-span"><span>Relato do cliente</span><textarea name="complaint" required/></label>
    </div></Panel>
    <Panel title="2. Condições de recebimento"><div className="form-grid">
      <label className="field"><span>Avarias visíveis</span><textarea name="damages"/></label><label className="field"><span>Pertences deixados</span><textarea name="belongings"/></label>
      <label className="field"><span>Acessórios</span><textarea name="accessories"/></label>
      <label className="field"><span>Situação de recebimento</span><select name="receivedState"><option>Rodando</option><option>Guinchado</option><option>Sem partida</option></select></label>
    </div></Panel>
    <Panel title="3. Checklist"><div className="checkin-grid" data-tour="checkin-checklist">{Object.entries(list).map(([cat, items]) => <fieldset key={cat}><legend>{cat}</legend>{items.map(item => { const k = `${cat}:${item}`, v = checks[k] ?? { state: 'Não avaliado', note: '' };
      return <div key={k} className="check-row"><span>{item}</span><select aria-label={`${item}: estado`} value={v.state} onChange={e => setChecks({ ...checks, [k]: { ...v, state: e.target.value } })}>{CHECK_STATES.map(s => <option key={s}>{s}</option>)}</select>
        {v.state !== 'Conforme' && v.state !== 'Não avaliado' && <input aria-label={`${item}: observação`} placeholder="Observação" value={v.note} onChange={e => setChecks({ ...checks, [k]: { ...v, note: e.target.value } })}/>}</div>; })}</fieldset>)}</div></Panel>
    <Panel title="4. Fotos"><label className="toolbar"><input type="checkbox" checked={quick} onChange={e => setQuick(e.target.checked)}/> Atendimento rápido (fotos opcionais)</label>
      <div className="photo-spots" data-tour="checkin-photos">{PHOTO_SPOTS[type].map(spot => <label key={spot} className="btn"><Camera size={16} aria-hidden="true"/>{spot}<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={e => { void addPhoto(spot, e.target.files?.[0]); e.target.value = ''; }}/></label>)}</div>
      {photos.length > 0 && <ul className="photo-list">{photos.map((p, i) => <li key={i}><img src={p.data} alt={p.label}/><span>{p.label}</span><label className="small"><input type="checkbox" checked={p.shared} onChange={e => setPhotos(photos.map((x, j) => j === i ? { ...x, shared: e.target.checked } : x))}/> Mostrar ao cliente</label><button type="button" className="btn ghost" aria-label={`Remover foto ${p.label}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}><Trash2 size={16}/></button></li>)}</ul>}
    </Panel>
    <Panel title="5. Conferir e registrar"><p className="small">Ao registrar, a entrada fica no histórico da OS com data, hora e funcionário ({session.name}). Esta conferência não é assinatura com certificação de identidade.</p>
      <button className="btn primary" disabled={pending} data-tour="checkin-submit"><CheckCircle2 size={16} aria-hidden="true"/>{pending ? 'Registrando…' : 'Registrar entrada'}</button></Panel>
  </form>;
}
