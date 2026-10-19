import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeftRight, ClipboardCheck, PackagePlus } from 'lucide-react';
import { moveStock, transferStock } from '../../domain';
import { date, uid } from '../../lib';
import { Badge, DataTable, Empty, Modal, PageHeader, Panel } from '../../ui';
import type { StockMovement } from '../../types';
import { matches, inPeriod } from './logic';
import { ExportButton, FormActions, SearchBox, SelectField, TextField, useErp } from './shared';
import { rpc } from '../../store';

export default function Inventory() {
  const { state, session, pending, run, download, notice } = useErp('estoque');
  const inventoryRoute = useLocation().pathname.endsWith('/inventario');
  const [tab, setTab] = useState(inventoryRoute ? 'inventory' : 'balances'), [query, setQuery] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [mode, setMode] = useState(''), [productId, setProductId] = useState(''), [quantity, setQuantity] = useState('1'), [type, setType] = useState('Entrada'), [target, setTarget] = useState(''), [reference, setReference] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const products = state.products.filter(product => product.tenantId === session.tenantId);
  const branches = state.branches.filter(branch => branch.tenantId === session.tenantId && branch.active);
  const rows = products.filter(product => product.active && matches(query, product.name, product.sku)).map(product => {
    const balance = state.balances.find(item => item.tenantId === session.tenantId && item.branchId === session.branchId && item.productId === product.id);
    return { ...product, quantity: balance?.quantity ?? 0, reserved: balance?.reserved ?? 0, available: (balance?.quantity ?? 0) - (balance?.reserved ?? 0) };
  });
  const movements = state.movements.filter(movement => movement.tenantId === session.tenantId && movement.branchId === session.branchId && inPeriod(movement.date, start, end) && matches(query, products.find(product => product.id === movement.productId)?.name, movement.reference, movement.type)).slice().reverse();
  const reset = () => { setMode(''); setReference(''); setProductId(''); setTarget(''); setQuantity('1'); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < (type === 'Ajuste' && mode !== 'transfer' ? 0 : 1)) { notice('Informe uma quantidade inteira válida.'); return; }
    const ok = await run(draft => {
      if (mode === 'transfer') transferStock(draft, session.tenantId, session.branchId, target, productId, amount);
      else moveStock(draft, session.tenantId, session.branchId, productId, amount, type, reference.trim());
    }, mode === 'transfer' ? 'Transferência realizada.' : 'Movimentação registrada.', 'editar', mode === 'transfer'
      ? rpc('transfer_stock', { p_tenant: session.tenantId, p_from: session.branchId, p_to: target, p_product: productId, p_quantity: amount, p_request_id: uid() })
      : rpc('move_stock', { p_tenant: session.tenantId, p_branch: session.branchId, p_product: productId, p_quantity: amount, p_type: type, p_reference: reference.trim() }));
    if (ok) reset();
  }
  async function inventory() {
    const entries = Object.entries(counts).filter(([, count]) => count !== '');
    if (!entries.length) { notice('Informe pelo menos uma contagem física.'); return; }
    if (entries.some(([, count]) => !Number.isInteger(Number(count)) || Number(count) < 0)) { notice('Contagens devem ser inteiros não negativos.'); return; }
    if (!window.confirm(`Aplicar contagem de ${entries.length} produtos na filial atual?`)) return;
    const batch = `Inventário ${uid()}`;
    if (await run(draft => entries.forEach(([id, count]) => moveStock(draft, session.tenantId, session.branchId, id, Number(count), 'Ajuste', batch)), 'Inventário aplicado.', 'editar', rpc('apply_inventory', { p_tenant: session.tenantId, p_branch: session.branchId, p_counts: Object.fromEntries(entries.map(([id, count]) => [id, Number(count)])), p_reference: batch }))) setCounts({});
  }
  return <div className="page stack"><PageHeader title="Estoque" subtitle="Saldo físico, reservas, transferências e rastreabilidade."><ExportButton onClick={() => download(tab === 'movements' ? 'movimentacoes' : 'estoque', tab === 'movements' ? movements.map(row => ({ produto: products.find(product => product.id === row.productId)?.name, quantidade: row.quantity, tipo: row.type, referencia: row.reference, data: row.date })) : rows.map(row => ({ sku: row.sku, produto: row.name, saldo: row.quantity, reservado: row.reserved, disponivel: row.available })))} /><button className="btn" onClick={() => { setReference(`Movimento ${uid()}`); setMode('move'); }}><PackagePlus size={16} aria-hidden="true" /> Movimentar</button><button className="btn primary" onClick={() => setMode('transfer')}><ArrowLeftRight size={16} aria-hidden="true" /> Transferir</button></PageHeader><div className="tabs">{[['balances', 'Saldos'], ['movements', 'Movimentações'], ['inventory', 'Inventário físico']].map(([value, label]) => <button key={value} className={`btn ${tab === value ? 'primary' : ''}`} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div><Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} />{tab === 'movements' && <><TextField label="De" type="date" value={start} onChange={setStart} /><TextField label="Até" type="date" value={end} onChange={setEnd} /></>}</div>{tab === 'movements' ? movements.length ? <DataTable rows={movements} columns={[{ key: 'date', label: 'Data', render: (row: StockMovement) => date(row.date) }, { key: 'productId', label: 'Produto', render: (row: StockMovement) => products.find(product => product.id === row.productId)?.name || row.productId }, { key: 'type', label: 'Tipo' }, { key: 'quantity', label: 'Quantidade' }, { key: 'reference', label: 'Referência' }]} /> : <Empty text="Nenhuma movimentação neste período." /> : rows.length ? <DataTable rows={rows} columns={[{ key: 'name', label: 'Produto' }, { key: 'sku', label: 'SKU' }, { key: 'quantity', label: 'Físico' }, { key: 'reserved', label: 'Reservado' }, { key: 'available', label: 'Disponível' }, { key: 'min', label: 'Mínimo' }, { key: 'status', label: tab === 'inventory' ? 'Contagem física' : 'Situação', render: (row: typeof rows[number]) => tab === 'inventory' ? <input aria-label={`Contagem de ${row.name}`} type="number" min={0} step="1" value={counts[row.id] ?? ''} placeholder={String(row.quantity)} onChange={event => setCounts(current => ({ ...current, [row.id]: event.target.value }))} /> : <Badge>{row.available < row.min ? 'Repor' : 'Regular'}</Badge> }]} /> : <Empty text="Nenhum produto encontrado nesta filial." />}{tab === 'inventory' && <div className="stack"><p className="muted">Campos vazios não alteram o saldo. Reservas existentes são preservadas e validadas. O ajuste registra o saldo físico alvo informado.</p><button className="btn primary" disabled={pending} onClick={() => void inventory()}><ClipboardCheck size={16} aria-hidden="true" /> {pending ? 'Aplicando…' : 'Aplicar inventário'}</button></div>}</Panel><Modal title={mode === 'transfer' ? 'Transferir entre filiais' : 'Movimentar estoque'} open={!!mode} onClose={() => !pending && reset()}><form className="stack" onSubmit={submit}><SelectField label="Produto" required value={productId} onChange={setProductId}><option value="">Selecione</option>{products.filter(product => product.active).map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</SelectField>{mode === 'transfer' ? <SelectField label="Filial de destino" required value={target} onChange={setTarget}><option value="">Selecione</option>{branches.filter(branch => branch.id !== session.branchId).map(branch => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</SelectField> : <><SelectField label="Tipo" value={type} onChange={setType}><option>Entrada</option><option>Saída</option><option>Ajuste</option></SelectField><TextField label="Referência / motivo" value={reference} required onChange={setReference} /></>}<TextField label={type === 'Ajuste' && mode !== 'transfer' ? 'Saldo físico contado' : 'Quantidade'} type="number" step="1" min={type === 'Ajuste' && mode !== 'transfer' ? 0 : 1} required value={quantity} onChange={setQuantity} /><FormActions pending={pending} onClose={reset} label="Confirmar" /></form></Modal></div>;
}
