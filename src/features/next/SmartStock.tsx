import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { Badge, DataTable, Empty, PageHeader, Panel, Stat, useNotice } from '../../ui';
import { money, today, uid } from '../../lib';
import { can } from '../../domain';
import { stockInsights } from '../../services/workshop';
import { useWorkshop } from './useWorkshop';

/** Reposição transparente a partir de vendas, consumo em OS, reservas e compras pendentes. Sugestão, nunca pedido automático. */
export default function SmartStock() {
  const { state, session, prefix, perform } = useDemo(); const notice = useNotice(); const navigate = useNavigate(); const { settings } = useWorkshop();
  const [filter, setFilter] = useState('repor'), [qty, setQty] = useState<Record<string, number>>({}), [pending, setPending] = useState(false);
  const day = today();
  const all = useMemo(() => stockInsights(state, session.tenantId, session.branchId, settings, day), [state, session, settings, day]);
  const rows = all.filter(i => filter === 'repor' ? i.suggested > 0 : filter === 'todos' || i.status === filter).map(i => ({ id: i.product.id, ...i }));
  const value = all.reduce((t, i) => t + i.quantity * i.product.cost, 0);
  const selected = rows.filter(r => (qty[r.id] ?? r.suggested) > 0 && filter === 'repor');
  const slug = state.tenants.find(t => t.id === session.tenantId)?.slug;
  async function quote() {
    if (!selected.length || pending) return;
    const record = { id: uid(), tenantId: session.tenantId, branchId: session.branchId, kind: 'cotacoes', title: `Reposição ${day}`, status: 'Aberta', customerId: '', date: day, amount: 0, history: [],
      fields: { neededBy: day, sourceOs: '', notes: 'Gerada pelo Estoque inteligente a partir das sugestões revisadas.' },
      items: selected.map(r => ({ productId: r.id, name: r.product.name, quantity: qty[r.id] ?? r.suggested, price: r.lastCost, cost: r.lastCost })) };
    setPending(true);
    try { await perform(d => { d.records.push({ ...record, history: [{ date: new Date().toISOString(), text: `Criada por ${session.name}` }] }); }, rpc('save_record', { p_tenant: session.tenantId, p: { ...record, status: undefined } })); notice('Cotação criada. Registre as propostas dos fornecedores.'); navigate(`${prefix}/loja/${slug}/cotacoes`); }
    catch (e) { notice((e as Error).message); } finally { setPending(false); }
  }
  return <div className="page stack">
    <PageHeader title="Estoque inteligente" subtitle={`Demanda observada nos últimos ${settings.demandDays} dias · filial ativa`}>{can(session.role, 'compras', 'cadastrar') && <button className="btn primary" data-tour="stock-quote" disabled={!selected.length || pending} onClick={() => void quote()}><ShoppingCart size={16} aria-hidden="true"/>Gerar cotação ({selected.length})</button>}</PageHeader>
    <div className="grid grid-4" data-tour="stock-kpis">
      <Stat label="Repor" value={all.filter(i => i.suggested > 0).length} tone="amber"/><Stat label="Rupturas" value={all.filter(i => i.status === 'ruptura').length} tone="red"/>
      <Stat label="Sem giro" value={all.filter(i => i.status === 'sem giro').length} tone="cyan"/><Stat label="Valor em estoque (custo)" value={money(value)} tone="blue"/>
    </div>
    <Panel><div className="toolbar" role="group" aria-label="Filtro">{[['repor', 'Sugestões de reposição'], ['ruptura', 'Rupturas'], ['abaixo do mínimo', 'Abaixo do mínimo'], ['sem giro', 'Sem giro'], ['excesso', 'Excesso'], ['todos', 'Todos']].map(([k, l]) => <button key={k} className={`btn ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
      {!rows.length ? <Empty text="Nada a exibir neste filtro."/> : <DataTable rows={rows} columns={[
        { key: 'name', label: 'Produto', render: (r: typeof rows[number]) => <>{r.product.name}<br/><small className="muted">{r.product.sku}</small></> },
        { key: 'status', label: 'Situação', render: (r: typeof rows[number]) => <Badge>{r.status}</Badge> },
        { key: 'stock', label: 'Saldo / reservado / disponível', render: (r: typeof rows[number]) => `${r.quantity} / ${r.reserved} / ${r.available}` },
        { key: 'demand', label: 'Demanda no período', render: (r: typeof rows[number]) => r.demand },
        { key: 'rp', label: 'Ponto de reposição', render: (r: typeof rows[number]) => <span title={`ceil(${r.demand} ÷ ${settings.demandDays} × ${r.leadDays} dias) + mínimo ${r.product.min}`}>{r.reorderPoint} ({r.leadDays}d)</span> },
        { key: 'pending', label: 'Compras pendentes', render: (r: typeof rows[number]) => r.pendingIn },
        { key: 'suggested', label: 'Quantidade', render: (r: typeof rows[number]) => filter === 'repor' ? <input type="number" min={0} aria-label={`Quantidade de ${r.product.name}`} value={qty[r.id] ?? r.suggested} onChange={e => setQty({ ...qty, [r.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ width: 80 }}/> : r.suggested },
        { key: 'cost', label: 'Custo ref.', render: (r: typeof rows[number]) => money(r.lastCost) },
      ]}/>}
      <p className="muted small">Ponto de reposição = demanda média no prazo de entrega + estoque mínimo (segurança). Prazo do produto: campo "leadDays" nos detalhes ou {settings.defaultLeadDays} dias. É uma estimativa baseada no histórico, não uma previsão garantida.</p>
    </Panel>
  </div>;
}
