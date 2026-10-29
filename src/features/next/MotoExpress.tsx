import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, Plus, Trash2 } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { Empty, PageHeader, Panel, useNotice } from '../../ui';
import { money, today, uid } from '../../lib';
import { can } from '../../domain';
import { cents } from '../erp/logic';
import type { OperationalRecord } from '../../types';
import type { ServicePackage } from '../../services/workshop';
import { useWorkshop } from './useWorkshop';

/** Atendimento rápido: pacote cadastrado pela loja → OS real (mesmas regras de estoque, aprovação e financeiro). */
export default function MotoExpress() {
  const { state, session, prefix, perform } = useDemo(); const notice = useNotice(); const navigate = useNavigate(); const { settings, save } = useWorkshop();
  const [customerId, setCustomerId] = useState(''), [vehicleId, setVehicleId] = useState(''), [pkgId, setPkgId] = useState(''), [pending, setPending] = useState(false), [editing, setEditing] = useState(false);
  const customers = state.customers.filter(c => c.tenantId === session.tenantId);
  const vehicles = state.records.filter(r => r.tenantId === session.tenantId && r.kind === 'veiculos' && r.customerId === customerId && r.status === 'Ativo');
  const products = state.products.filter(p => p.tenantId === session.tenantId && p.active);
  const pkg = settings.packages.find(p => p.id === pkgId);
  const available = (pid: string) => { const b = state.balances.find(x => x.tenantId === session.tenantId && x.branchId === session.branchId && x.productId === pid); return (b?.quantity ?? 0) - (b?.reserved ?? 0); };
  const items = (pkg?.items ?? []).flatMap(i => { const p = products.find(x => x.id === i.productId); return p ? [{ productId: p.id, name: p.name, quantity: i.quantity, price: p.price, cost: p.cost }] : []; });
  const total = items.reduce((t, i) => t + i.price * i.quantity, 0) + (pkg?.labor ?? 0);
  const short = items.filter(i => available(i.productId) < i.quantity);
  const slug = state.tenants.find(t => t.id === session.tenantId)?.slug;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!pkg || pending) return; const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const v = vehicles.find(x => x.id === vehicleId); if (!v) { notice('Selecione a moto.'); return; }
    const record: OperationalRecord = { id: uid(), tenantId: session.tenantId, branchId: session.branchId, kind: 'ordens-servico', title: `Express · ${pkg.name} · ${v.fields.plate}`, status: 'Aberta', customerId, date: today(), amount: total, items, history: [],
      fields: { vehicleId, technician: f.technician, dueDate: today(), mileage: f.mileage, complaint: `Moto Express: ${pkg.name}`, labor: (pkg.labor / 100).toFixed(2), express: pkg.id, notes: '' } };
    setPending(true);
    try { await perform(d => { d.records.push({ ...record, history: [{ date: new Date().toISOString(), text: `Moto Express aberto por ${session.name}` }] }); }, rpc('save_record', { p_tenant: session.tenantId, p: { ...record, status: undefined } }));
      notice(short.length ? 'OS aberta. Atenção: há peça sem saldo — a reserva será recusada até repor.' : 'OS aberta. Avance para Em execução para reservar as peças.'); navigate(`${prefix}/loja/${slug}/mecanico`); }
    catch (err) { notice((err as Error).message); } finally { setPending(false); }
  }
  if (!can(session.role, 'ordens-servico', 'cadastrar')) return <div className="page"><PageHeader title="Moto Express"/><p>Seu perfil não permite abrir atendimentos.</p></div>;
  return <div className="page stack">
    <PageHeader title="Moto Express — Novo atendimento" subtitle="Serviços rápidos com pacotes cadastrados pela loja.">{can(session.role, 'configuracoes', 'configurar') && <button className="btn" onClick={() => setEditing(v => !v)}>{editing ? 'Fechar pacotes' : 'Gerenciar pacotes'}</button>}</PageHeader>
    {editing && <Packages packages={settings.packages} products={products} onSave={async packages => { try { await save({ packages }); notice('Pacotes salvos.'); } catch (e) { notice((e as Error).message); } }}/>}
    {!settings.packages.length ? <Empty text="Nenhum pacote cadastrado. Use Gerenciar pacotes (ex.: Troca de óleo, Kit transmissão) com as peças do seu catálogo."/> :
    <form className="stack express" onSubmit={submit} data-tour="express-form"><Panel><div className="form-grid">
      <label className="field"><span>Cliente</span><select required value={customerId} onChange={e => { setCustomerId(e.target.value); setVehicleId(''); }}><option value="">Selecione</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span>Moto</span><select required value={vehicleId} onChange={e => setVehicleId(e.target.value)}><option value="">Selecione</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.title} · {v.fields.plate}</option>)}</select></label>
      <label className="field"><span>Quilometragem</span><input name="mileage" type="number" min={0} required inputMode="numeric"/></label>
      <label className="field"><span>Técnico</span><input name="technician" required defaultValue={session.role === 'Mecânico' ? session.name : ''}/></label>
    </div></Panel>
      <div className="express-packages" role="radiogroup" aria-label="Pacote de serviço">{settings.packages.map(p => <button type="button" key={p.id} role="radio" aria-checked={pkgId === p.id} className={`btn ${pkgId === p.id ? 'primary' : ''}`} onClick={() => setPkgId(p.id)}><Bike size={16} aria-hidden="true"/>{p.name}</button>)}</div>
      {pkg && <Panel title="Conferência"><ul>{items.map(i => <li key={i.productId}>{i.quantity}× {i.name} — {money(i.price * i.quantity)} {available(i.productId) < i.quantity && <strong className="field-error">· saldo {available(i.productId)}</strong>}</li>)}{pkg.labor > 0 && <li>Mão de obra — {money(pkg.labor)}</li>}</ul>
        {items.length < pkg.items.length && <p className="field-error">Há peça do pacote inativa ou removida do catálogo; revise o pacote.</p>}
        <p><strong>Total: {money(total)}</strong></p><button className="btn primary" disabled={pending}>Abrir atendimento</button>
        <p className="muted small">Gera uma OS normal: reserva de peças em "Em execução", baixa e receita em "Pronta", pagamento pelo Financeiro/PDV. Nenhuma etapa de segurança é pulada.</p></Panel>}
    </form>}
  </div>;
}

function Packages({ packages, products, onSave }: { packages: ServicePackage[]; products: { id: string; name: string }[]; onSave: (p: ServicePackage[]) => Promise<void> }) {
  const [list, setList] = useState(packages), [productId, setProductId] = useState('');
  const upd = (i: number, p: Partial<ServicePackage>) => setList(list.map((x, j) => j === i ? { ...x, ...p } : x));
  return <Panel title="Pacotes de serviço"><div className="stack">{list.map((p, i) => <fieldset key={p.id} className="stack"><legend>{p.name || 'Novo pacote'}</legend>
    <div className="form-grid"><label className="field"><span>Nome</span><input value={p.name} onChange={e => upd(i, { name: e.target.value })} required/></label>
      <label className="field"><span>Mão de obra (R$)</span><input inputMode="decimal" defaultValue={(p.labor / 100).toFixed(2)} onBlur={e => { try { upd(i, { labor: cents(e.target.value || '0') }); } catch { e.target.value = '0.00'; } }}/></label></div>
    <ul>{p.items.map((it, k) => <li key={it.productId}>{products.find(x => x.id === it.productId)?.name ?? 'Produto removido'} × <input type="number" min={1} value={it.quantity} aria-label="Quantidade" style={{ width: 64 }} onChange={e => upd(i, { items: p.items.map((x, m) => m === k ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x) })}/> <button type="button" className="btn ghost" aria-label="Remover peça" onClick={() => upd(i, { items: p.items.filter((_, m) => m !== k) })}><Trash2 size={14}/></button></li>)}</ul>
    <div className="toolbar"><select aria-label="Peça do pacote" value={productId} onChange={e => setProductId(e.target.value)}><option value="">Adicionar peça do catálogo</option>{products.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <button type="button" className="btn" disabled={!productId || p.items.some(x => x.productId === productId)} onClick={() => { upd(i, { items: [...p.items, { productId, quantity: 1 }] }); setProductId(''); }}>Adicionar</button>
      <button type="button" className="btn danger" onClick={() => setList(list.filter((_, j) => j !== i))}>Excluir pacote</button></div></fieldset>)}
    <div className="toolbar"><button type="button" className="btn" onClick={() => setList([...list, { id: crypto.randomUUID(), name: '', items: [], labor: 0 }])}><Plus size={16} aria-hidden="true"/>Novo pacote</button>
      <button type="button" className="btn primary" disabled={list.some(p => !p.name.trim())} onClick={() => void onSave(list)}>Salvar pacotes</button></div></div></Panel>;
}
