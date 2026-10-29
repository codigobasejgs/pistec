import { useState, type FormEvent } from 'react';
import { CheckCircle2, Mail, MessageCircle } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { Badge, useNotice } from '../../ui';
import { money, today, uid } from '../../lib';
import { cents } from '../erp/logic';
import { can } from '../../domain';
import type { OperationalRecord } from '../../types';
import { compareQuotes, quoteResponses, type QuoteResponse } from '../../services/workshop';

/** Propostas de fornecedores (registro manual pela equipe), comparação por custo total conhecido e aprovação → compra pendente. */
export function QuotePanel({ record }: { record: OperationalRecord }) {
  const { state, session, perform } = useDemo(); const notice = useNotice();
  const [pending, setPending] = useState(false);
  const suppliers = state.records.filter(r => r.tenantId === session.tenantId && r.kind === 'fornecedores' && r.status !== 'Inativo');
  const cmp = compareQuotes(record, today());
  const closed = !!record.convertedId || ['Aprovada', 'Cancelada'].includes(record.status);
  const name = (id: string) => suppliers.find(s => s.id === id)?.title ?? state.records.find(s => s.id === id)?.title ?? id;
  const lines = record.items.map(i => `${i.quantity}x ${i.name}`).join('\n');
  async function addResponse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      const prices = Object.fromEntries(record.items.map(i => [i.productId, cents(String(f.get(`p-${i.productId}`)))]));
      const resp: QuoteResponse = { supplierId: String(f.get('supplierId')), prices, freight: cents(String(f.get('freight') || '0')), leadDays: Math.max(0, Math.floor(Number(f.get('leadDays')) || 0)), validUntil: String(f.get('validUntil') || ''), notes: String(f.get('notes') || ''), updatedAt: new Date().toISOString() };
      if (!resp.supplierId) throw new Error('Selecione o fornecedor.');
      const responses = JSON.stringify([...quoteResponses(record).filter(q => q.supplierId !== resp.supplierId), resp]);
      const next = { ...record, fields: { ...record.fields, responses } };
      setPending(true);
      await perform(d => { const r = d.records.find(x => x.id === record.id && x.tenantId === session.tenantId); if (r) { r.fields.responses = responses; r.history.push({ date: resp.updatedAt, text: `Proposta de ${name(resp.supplierId)} registrada por ${session.name}` }); } }, rpc('save_record', { p_tenant: session.tenantId, p: next }));
      e.currentTarget.reset(); notice('Proposta registrada.');
    } catch (err) { notice((err as Error).message); } finally { setPending(false); }
  }
  async function approve(supplierId: string) {
    if (!window.confirm(`Aprovar a proposta de ${name(supplierId)} e gerar compra pendente?`)) return;
    setPending(true);
    try {
      await perform(d => {
        const r = d.records.find(x => x.id === record.id && x.tenantId === session.tenantId)!, q = quoteResponses(r).find(x => x.supplierId === supplierId)!;
        const items = r.items.map(i => ({ ...i, price: q.prices[i.productId], cost: q.prices[i.productId] }));
        const id = uid(), now = new Date().toISOString();
        d.records.push({ id, tenantId: r.tenantId, branchId: r.branchId, kind: 'compras', title: r.title, status: 'Pendente', customerId: '', date: today(), amount: items.reduce((t, i) => t + i.quantity * i.cost, 0), items,
          fields: { supplierId, expectedDate: today(), dueDate: today(), invoice: '', sourceId: r.id, notes: `Gerada da cotação ${r.title}` }, history: [{ date: now, text: `Compra criada da cotação aprovada por ${session.name}` }] });
        r.convertedId = id; r.status = 'Aprovada'; r.fields.chosenSupplier = supplierId; r.history.push({ date: now, text: 'Proposta aprovada; compra pendente gerada.' });
      }, rpc('approve_supplier_quote', { p_tenant: session.tenantId, p_id: record.id, p_supplier: supplierId }));
      notice('Compra pendente criada em Compras. Receba a mercadoria por lá.');
    } catch (err) { notice((err as Error).message); } finally { setPending(false); }
  }
  return <section className="stack" data-tour="quote-compare">
    <h4>Solicitar ao fornecedor</h4>
    <div className="toolbar">{suppliers.slice(0, 6).map(s => { const tel = (s.fields.phone ?? '').replace(/\D/g, ''), msg = encodeURIComponent(`Olá! Solicito cotação (${record.title}):\n${lines}\nInforme preço unitário, frete, prazo e validade.`);
      return <span key={s.id} className="toolbar">{tel && <a className="btn" href={`https://wa.me/55${tel}?text=${msg}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true"/>{s.title}</a>}{s.fields.email && <a className="btn ghost" href={`mailto:${s.fields.email}?subject=${encodeURIComponent(`Cotação ${record.title}`)}&body=${msg}`}><Mail size={14} aria-hidden="true"/></a>}</span>; })}</div>
    <p className="muted small">Mensagens abertas no seu WhatsApp/e-mail; o PISTEC não envia nem confirma entrega. Registre abaixo a resposta recebida.</p>
    {cmp.rows.length > 0 && <div className="table-wrap"><table><thead><tr><th>Fornecedor</th>{record.items.map(i => <th key={i.productId}>{i.name}</th>)}<th>Frete</th><th>Prazo</th><th>Validade</th><th>Total</th><th/></tr></thead>
      <tbody>{cmp.rows.map(q => <tr key={q.supplierId}><td>{name(q.supplierId)} {q.supplierId === cmp.recommended && <Badge>Menor custo total</Badge>} {q.supplierId === cmp.fastest && <Badge>Menor prazo</Badge>}</td>
        {record.items.map(i => <td key={i.productId}>{q.prices[i.productId] != null ? money(q.prices[i.productId]) : '—'}</td>)}<td>{money(q.freight)}</td><td>{q.leadDays} dias</td><td>{q.expired ? <Badge>Vencida</Badge> : q.validUntil || '—'}</td><td><strong>{money(q.total)}</strong>{!q.complete && <small> (incompleta)</small>}</td>
        <td>{!closed && can(session.role, 'compras', 'cadastrar') && <button className="btn primary" disabled={pending || !q.complete || q.expired} onClick={() => void approve(q.supplierId)}><CheckCircle2 size={14} aria-hidden="true"/>Aprovar</button>}</td></tr>)}</tbody></table>
      <p className="muted small">Total = Σ (preço × quantidade) + frete. Tributos e condições não informados não entram na comparação.</p></div>}
    {!closed && <form className="stack" onSubmit={addResponse}><h4>Registrar proposta recebida</h4><div className="form-grid">
      <label className="field"><span>Fornecedor</span><select name="supplierId" required><option value="">Selecione</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      {record.items.map(i => <label key={i.productId} className="field"><span>Preço unitário · {i.name} ({i.quantity})</span><input name={`p-${i.productId}`} inputMode="decimal" required/></label>)}
      <label className="field"><span>Frete (R$)</span><input name="freight" inputMode="decimal" defaultValue="0"/></label>
      <label className="field"><span>Prazo de entrega (dias)</span><input name="leadDays" type="number" min={0} required/></label>
      <label className="field"><span>Validade da proposta</span><input name="validUntil" type="date"/></label>
      <label className="field"><span>Condições</span><input name="notes"/></label>
    </div><button className="btn" disabled={pending}>Salvar proposta</button></form>}
  </section>;
}
