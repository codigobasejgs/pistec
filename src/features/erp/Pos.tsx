import { useRef, useState, type FormEvent } from 'react';
import { Banknote, Pause, Play, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { completeSale, openCash } from '../../domain';
import { money, uid } from '../../lib';
import { Badge, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { OperationalRecord, Sale } from '../../types';
import { cents, decimal, matches, cashExpected } from './logic';
import { FormActions, SearchBox, SelectField, TextField, useErp } from './shared';
import { Receipt } from './SalesRecords';

interface CartLine { productId: string; quantity: number }
export default function Pos() {
  const { state, session, run, pending, notice } = useErp('pdv');
  const [query, setQuery] = useState(''), [customerId, setCustomerId] = useState(''), [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('0'), [surcharge, setSurcharge] = useState('0'), [discountMode, setDiscountMode] = useState('value');
  const [payments, setPayments] = useState([{ method: 'Dinheiro', value: '' }]);
  const [receipt, setReceipt] = useState<Sale | null>(null), [cashModal, setCashModal] = useState(false), [opening, setOpening] = useState('0'), [suspendedId, setSuspendedId] = useState('');
  const requestId = useRef<string>(uid());
  const products = state.products.filter(product => product.tenantId === session.tenantId && product.active);
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const cash = state.cashRegisters.find(register => register.tenantId === session.tenantId && register.branchId === session.branchId && !register.closedAt);
  const suspended = state.records.filter(record => record.tenantId === session.tenantId && record.branchId === session.branchId && record.kind === 'cart' && record.status === 'Suspenso');
  const available = (productId: string) => { const balance = state.balances.find(row => row.tenantId === session.tenantId && row.branchId === session.branchId && row.productId === productId); return balance ? balance.quantity - balance.reserved : 0; };
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * (products.find(product => product.id === item.productId)?.price || 0), 0);
  let discountAmount = 0, surchargeAmount = 0, invalidMoney = false;
  try {
    if (discountMode === 'percent') {
      const percent = Number(discount.replace(',', '.'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Percentual inválido.');
      discountAmount = Math.round(subtotal * percent / 100);
    } else discountAmount = cents(discount || '0');
    surchargeAmount = cents(surcharge || '0');
  } catch { invalidMoney = true; }
  const total = subtotal - discountAmount + surchargeAmount;
  let paid = 0;
  try { paid = payments.reduce((sum, payment) => sum + cents(payment.value || '0'), 0); } catch { invalidMoney = true; }
  function add(productId: string) {
    const current = cart.find(item => item.productId === productId)?.quantity || 0;
    if (current >= available(productId)) { notice('Sem estoque disponível para adicionar este produto.'); return; }
    setCart(previous => previous.some(item => item.productId === productId) ? previous.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item) : [...previous, { productId, quantity: 1 }]);
  }
  function completePayment(index: number) {
    const other = payments.reduce((sum, payment, i) => {
      if (i === index) return sum;
      try { return sum + cents(payment.value || '0'); } catch { return sum; }
    }, 0);
    setPayments(current => current.map((row, i) => i === index ? { ...row, value: decimal(Math.max(0, total - other)) } : row));
  }
  function clear() { setCart([]); setCustomerId(''); setDiscount('0'); setSurcharge('0'); setPayments([{ method: 'Dinheiro', value: '' }]); setSuspendedId(''); requestId.current = uid(); }
  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (!cart.length || invalidMoney || total < 0 || discountAmount > subtotal || paid !== total) { notice('Revise o carrinho, o desconto e os pagamentos. A soma deve ser exatamente igual ao total.'); return; }
    let sale: Sale | null = null;
    const ok = await run(draft => {
      if (suspendedId) {
        const saved = draft.records.find(record => record.id === suspendedId && record.tenantId === session.tenantId && record.kind === 'cart');
        if (!saved || !['Suspenso', 'Retomado'].includes(saved.status)) throw new Error('Carrinho suspenso já utilizado ou removido.');
      }
      sale = completeSale(draft, { tenantId: session.tenantId, branchId: session.branchId, customerId, seller: session.name, items: cart, discount: discountAmount, surcharge: surchargeAmount, payments: payments.map(payment => ({ method: payment.method, amount: cents(payment.value) })), requestId: requestId.current });
      if (suspendedId) {
        const saved = draft.records.find(record => record.id === suspendedId && record.tenantId === session.tenantId);
        if (saved) { saved.status = 'Concluído'; saved.fields.saleId = sale.id; saved.history.push({ date: new Date().toISOString(), text: `Venda concluída: ${sale.id}` }); }
      }
    }, 'Venda concluída. Estoque, caixa e financeiro atualizados.', 'cadastrar');
    if (ok && sale) { setReceipt(sale); clear(); }
  }
  async function suspend() {
    if (!cart.length || invalidMoney || discountAmount > subtotal || total < 0) { notice('Adicione itens e revise os valores antes de suspender.'); return; }
    const id = suspendedId || uid();
    if (await run(draft => {
      const now = new Date().toISOString();
      const record: OperationalRecord = { id, tenantId: session.tenantId, branchId: session.branchId, kind: 'cart', title: `Carrinho · ${customers.find(customer => customer.id === customerId)?.name || session.name}`, status: 'Suspenso', customerId, date: now, amount: total, fields: { discount, surcharge, discountMode, requestId: requestId.current }, items: cart.map(item => { const product = draft.products.find(row => row.id === item.productId && row.tenantId === session.tenantId && row.active); if (!product) throw new Error('Um produto deixou de estar disponível.'); return { ...item, name: product.name, price: product.price, cost: product.cost }; }), history: [{ date: now, text: `Carrinho suspenso por ${session.name}; estoque não reservado.` }] };
      const index = draft.records.findIndex(row => row.id === id && row.tenantId === session.tenantId);
      if (index >= 0) { if (draft.records[index].fields.saleId) throw new Error('Carrinho já convertido em venda.'); record.history = [...draft.records[index].history, ...record.history]; draft.records[index] = record; } else draft.records.push(record);
    }, 'Carrinho suspenso. Valores e estoque serão revalidados ao retomar.', 'cadastrar')) clear();
  }
  function resume(record: OperationalRecord) {
    if (cart.length && !window.confirm('Substituir o carrinho atual? Itens não suspensos serão descartados.')) return;
    if (record.items.some(item => !products.some(product => product.id === item.productId))) { notice('Carrinho contém produto arquivado. Restaure o produto antes de retomar.'); return; }
    setCart(record.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
    setCustomerId(record.customerId); setDiscount(record.fields.discount || '0'); setDiscountMode(record.fields.discountMode || 'value'); setSurcharge(record.fields.surcharge || '0'); setSuspendedId(record.id); setPayments([{ method: 'Dinheiro', value: '' }]); requestId.current = record.fields.requestId || uid();
    notice('Carrinho retomado com preços atuais. Confira estoque, desconto e pagamentos.');
  }
  return <div className="page stack"><PageHeader title="Frente de caixa" subtitle="Venda local integrada ao estoque e ao financeiro."><Badge>{cash ? 'Caixa aberto' : 'Caixa fechado'}</Badge>{!cash && <button className="btn primary" onClick={() => setCashModal(true)}><Banknote size={16} aria-hidden="true" /> Abrir caixa</button>}</PageHeader><div className="grid grid-3"><Stat label="Itens no carrinho" value={cart.reduce((sum, item) => sum + item.quantity, 0)} icon={<ShoppingCart size={20} />} /><Stat label="Total da venda" value={money(Math.max(total, 0))} /><Stat label="Dinheiro esperado no caixa" value={cash ? money(cashExpected(cash)) : 'Fechado'} /></div><div className="grid grid-2"><Panel title="Catálogo"><SearchBox value={query} onChange={setQuery} placeholder="Nome, SKU ou código de barras" /><div className="grid grid-2">{products.filter(product => matches(query, product.name, product.sku, product.barcode)).slice(0, 60).map(product => <article className="card stack" key={product.id}><strong>{product.name}</strong><small className="muted">{product.sku} · Disponível: {available(product.id)}</small><span>{money(product.price)}</span><button className="btn" disabled={pending || available(product.id) < 1} onClick={() => add(product.id)}><Plus size={16} aria-hidden="true" /> Adicionar</button></article>)}</div>{!products.length && <Empty text="Cadastre produtos e registre uma entrada de estoque para vender." />}<p className="muted">Exibindo até 60 produtos. Use a busca para localizar itens específicos.</p></Panel><Panel title="Venda atual"><form className="stack" onSubmit={checkout}><SelectField label="Cliente" value={customerId} onChange={setCustomerId}><option value="">Consumidor não identificado</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectField>{cart.length ? cart.map(item => <div className="card stack" key={item.productId}><strong>{products.find(product => product.id === item.productId)?.name || 'Produto indisponível'}</strong><div className="toolbar"><TextField label="Quantidade" type="number" required min={1} max={available(item.productId)} step="1" value={item.quantity} onChange={value => setCart(current => current.map(row => row.productId === item.productId ? { ...row, quantity: Number(value) } : row))} /><span>{money(item.quantity * (products.find(product => product.id === item.productId)?.price || 0))}</span><button type="button" className="btn danger" aria-label={`Remover ${products.find(product => product.id === item.productId)?.name}`} onClick={() => setCart(current => current.filter(row => row.productId !== item.productId))}><Trash2 size={16} /></button></div></div>) : <Empty text="Adicione produtos para iniciar a venda." />}<div className="form-grid"><SelectField label="Tipo de desconto" value={discountMode} onChange={setDiscountMode}><option value="value">Valor em R$</option><option value="percent">Percentual</option></SelectField><TextField label={discountMode === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} value={discount} onChange={setDiscount} /><TextField label="Acréscimo (R$)" value={surcharge} onChange={setSurcharge} /></div><p>Subtotal {money(subtotal)} · Desconto {money(discountAmount)} · Total <strong>{money(Math.max(total, 0))}</strong></p><fieldset className="stack"><legend>Pagamentos mistos</legend>{payments.map((payment, index) => <div className="toolbar" key={index}><SelectField label={`Forma de pagamento ${index + 1}`} value={payment.method} onChange={method => setPayments(current => current.map((row, i) => i === index ? { ...row, method } : row))}>{['Dinheiro', 'Pix', 'Crédito', 'Débito'].map(method => <option key={method}>{method}</option>)}</SelectField><TextField label={`Valor do pagamento ${index + 1} (R$)`} required value={payment.value} onChange={value => setPayments(current => current.map((row, i) => i === index ? { ...row, value } : row))} /><button type="button" className="btn ghost" onClick={() => completePayment(index)}>Completar</button><button type="button" className="btn danger" aria-label={`Remover pagamento ${index + 1}`} disabled={payments.length === 1} onClick={() => setPayments(current => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}<button className="btn" type="button" onClick={() => setPayments(current => [...current, { method: 'Pix', value: '' }])}><Plus size={16} aria-hidden="true" /> Outra forma</button></fieldset><p role="status">{invalidMoney ? 'Revise os valores informados.' : paid > total ? `Excesso de ${money(paid - total)}. Informe o valor líquido recebido, sem troco.` : `Restante: ${money(total - paid)}`}</p><div className="toolbar"><button type="button" className="btn" disabled={pending || !cart.length} onClick={() => void suspend()}><Pause size={16} aria-hidden="true" /> Suspender</button><button className="btn primary" disabled={pending || !cash || !cart.length || invalidMoney || paid !== total}>{pending ? 'Processando…' : 'Finalizar venda'}</button></div></form></Panel></div><Panel title="Carrinhos suspensos">{suspended.length ? suspended.map(record => <article key={record.id} className="toolbar"><strong>{record.title}</strong><span>{money(record.amount)}</span><button className="btn" disabled={pending} onClick={() => resume(record)}><Play size={16} aria-hidden="true" /> Retomar</button><button className="btn danger" disabled={pending || record.id === suspendedId} onClick={() => { if (window.confirm('Descartar este carrinho suspenso?')) void run(draft => { const saved = draft.records.find(row => row.id === record.id && row.tenantId === session.tenantId); if (!saved || saved.fields.saleId) throw new Error('Carrinho indisponível.'); saved.status = 'Descartado'; saved.history.push({ date: new Date().toISOString(), text: `Descartado por ${session.name}` }); }, 'Carrinho descartado.', 'excluir'); }}>Descartar</button></article>) : <Empty text="Nenhum carrinho suspenso." />}</Panel><Modal title="Abrir caixa" open={cashModal} onClose={() => !pending && setCashModal(false)}><form className="stack" onSubmit={async event => { event.preventDefault(); try { const amount = cents(opening); if (await run(draft => openCash(draft, session.tenantId, session.branchId, amount), 'Caixa aberto.')) setCashModal(false); } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); } }}><TextField label="Fundo de abertura (R$)" required value={opening} onChange={setOpening} /><FormActions pending={pending} onClose={() => setCashModal(false)} label="Abrir caixa" /></form></Modal><Modal title="Venda concluída" open={!!receipt} onClose={() => setReceipt(null)}>{receipt && <Receipt sale={receipt} customer={customers.find(customer => customer.id === receipt.customerId)?.name} business={state.tenants.find(tenant => tenant.id === session.tenantId)?.name} />}</Modal></div>;
}
