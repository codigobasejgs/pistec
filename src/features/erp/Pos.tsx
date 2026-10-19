import { useRef, useState, type FormEvent } from 'react';
import { Banknote, Coins, CreditCard, Pause, Play, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { completeSale, openCash } from '../../domain';
import { money, uid } from '../../lib';
import { Badge, Button, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { OperationalRecord, Sale } from '../../types';
import { cents, decimal, matches, cashExpected, paymentSummary } from './logic';
import { FormActions, SearchBox, SelectField, TextField, useErp, useNarrow } from './shared';
import { Receipt } from './SalesRecords';
import { useBusyGuard } from '../../pwa';
import { rpc } from '../../store';

interface CartLine { productId: string; quantity: number }
const METHODS = ['Dinheiro', 'Pix', 'Crédito', 'Débito'];
const STEPS = [['products', 'Produtos'], ['cart', 'Carrinho'], ['payment', 'Pagamento']] as const;
type Step = typeof STEPS[number][0];

export default function Pos() {
  const { state, session, run, pending, notice } = useErp('pdv');
  const narrow = useNarrow(760);
  const [step, setStep] = useState<Step>('products');
  const [query, setQuery] = useState(''), [customerId, setCustomerId] = useState(''), [cart, setCart] = useState<CartLine[]>([]);
  useBusyGuard(cart.length > 0); // venda em andamento: atualização do app pede confirmação
  const [discount, setDiscount] = useState('0'), [surcharge, setSurcharge] = useState('0'), [discountMode, setDiscountMode] = useState('value');
  const [payments, setPayments] = useState([{ method: 'Dinheiro', value: '' }]);
  const [receipt, setReceipt] = useState<Sale | null>(null), [cashModal, setCashModal] = useState(false), [opening, setOpening] = useState('0'), [suspendedId, setSuspendedId] = useState('');
  // Uma chave por carrinho: reenvio (duplo clique, falha de rede) não duplica venda; só renova após concluir/limpar.
  const requestId = useRef<string>(uid());
  const products = state.products.filter(product => product.tenantId === session.tenantId && product.active);
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const cash = state.cashRegisters.find(register => register.tenantId === session.tenantId && register.branchId === session.branchId && !register.closedAt);
  const suspended = state.records.filter(record => record.tenantId === session.tenantId && record.branchId === session.branchId && record.kind === 'cart' && record.status === 'Suspenso');
  const available = (productId: string) => { const balance = state.balances.find(row => row.tenantId === session.tenantId && row.branchId === session.branchId && row.productId === productId); return balance ? balance.quantity - balance.reserved : 0; };
  const priceOf = (productId: string) => products.find(product => product.id === productId)?.price || 0;
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * priceOf(item.productId), 0);
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
  const parsed = payments.map(payment => { try { return { method: payment.method, amount: cents(payment.value || '0') }; } catch { invalidMoney = true; return { method: payment.method, amount: 0 }; } });
  const summary = paymentSummary(Math.max(total, 0), parsed);
  const blocked = !cart.length || invalidMoney || total <= 0 || discountAmount > subtotal || !!summary.error;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  function add(productId: string) {
    const current = cart.find(item => item.productId === productId)?.quantity || 0;
    if (current >= available(productId)) { notice('Sem estoque disponível para adicionar este produto.'); return; }
    setCart(previous => previous.some(item => item.productId === productId) ? previous.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item) : [...previous, { productId, quantity: 1 }]);
  }
  function completePayment(index: number) {
    const other = parsed.reduce((sum, payment, i) => i === index ? sum : sum + payment.amount, 0);
    setPayments(current => current.map((row, i) => i === index ? { ...row, value: decimal(Math.max(0, total - other)) } : row));
  }
  function clear() { setCart([]); setCustomerId(''); setDiscount('0'); setSurcharge('0'); setDiscountMode('value'); setPayments([{ method: 'Dinheiro', value: '' }]); setSuspendedId(''); setStep('products'); requestId.current = uid(); }
  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (blocked) { notice(summary.error || 'Revise o carrinho, o desconto e os pagamentos.'); return; }
    const input = { tenantId: session.tenantId, branchId: session.branchId, customerId, seller: session.name, items: cart, discount: discountAmount, surcharge: surchargeAmount, payments: parsed.filter(payment => payment.amount > 0), requestId: requestId.current };
    const ok = await run(draft => {
      if (suspendedId) {
        const saved = draft.records.find(record => record.id === suspendedId && record.tenantId === session.tenantId && record.kind === 'cart');
        if (!saved || !['Suspenso', 'Retomado'].includes(saved.status)) throw new Error('Carrinho suspenso já utilizado ou removido.');
      }
      // Valor ENTREGUE por forma; o domínio aplica não-dinheiro primeiro e calcula o troco.
      const sale = completeSale(draft, input);
      if (suspendedId) {
        const saved = draft.records.find(record => record.id === suspendedId && record.tenantId === session.tenantId);
        if (saved) { saved.status = 'Concluído'; saved.fields.saleId = sale.id; saved.history.push({ date: new Date().toISOString(), text: `Venda concluída: ${sale.id}` }); }
      }
      return sale;
    }, 'Venda concluída. Estoque, caixa e financeiro atualizados.', 'cadastrar', rpc('complete_sale', { p: { ...input, cartId: suspendedId || null } }));
    if (ok) { setReceipt(ok.value as Sale); clear(); }
  }
  async function suspend() {
    if (!cart.length || invalidMoney || discountAmount > subtotal || total < 0) { notice('Adicione itens e revise os valores antes de suspender.'); return; }
    const id = suspendedId || uid();
    if (await run(draft => {
      const now = new Date().toISOString();
      const record: OperationalRecord = { id, tenantId: session.tenantId, branchId: session.branchId, kind: 'cart', title: `Carrinho · ${customers.find(customer => customer.id === customerId)?.name || session.name}`, status: 'Suspenso', customerId, date: now, amount: total, fields: { discount, surcharge, discountMode, requestId: requestId.current }, items: cart.map(item => { const product = draft.products.find(row => row.id === item.productId && row.tenantId === session.tenantId && row.active); if (!product) throw new Error('Um produto deixou de estar disponível.'); return { ...item, name: product.name, price: product.price, cost: product.cost }; }), history: [{ date: now, text: `Carrinho suspenso por ${session.name}; estoque não reservado.` }] };
      const index = draft.records.findIndex(row => row.id === id && row.tenantId === session.tenantId);
      if (index >= 0) { if (draft.records[index].fields.saleId) throw new Error('Carrinho já convertido em venda.'); record.history = [...draft.records[index].history, ...record.history]; draft.records[index] = record; } else draft.records.push(record);
    }, 'Carrinho suspenso. Valores e estoque serão revalidados ao retomar.', 'cadastrar', rpc('save_record', { p_tenant: session.tenantId, p: {
      id, kind: 'cart', branchId: session.branchId, customerId, amount: Math.max(total, 0),
      title: `Carrinho · ${customers.find(customer => customer.id === customerId)?.name || session.name}`,
      fields: { discount, surcharge, discountMode, requestId: requestId.current },
      items: cart.map(item => ({ productId: item.productId, quantity: item.quantity, price: products.find(product => product.id === item.productId)?.price ?? 0 })),
    } }))) clear();
  }
  function resume(record: OperationalRecord) {
    if (cart.length && !window.confirm('Substituir o carrinho atual? Itens não suspensos serão descartados.')) return;
    if (record.items.some(item => !products.some(product => product.id === item.productId))) { notice('Carrinho contém produto arquivado. Restaure o produto antes de retomar.'); return; }
    setCart(record.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
    setCustomerId(record.customerId); setDiscount(record.fields.discount || '0'); setDiscountMode(record.fields.discountMode || 'value'); setSurcharge(record.fields.surcharge || '0'); setSuspendedId(record.id); setPayments([{ method: 'Dinheiro', value: '' }]); requestId.current = record.fields.requestId || uid();
    setStep('cart');
    notice('Carrinho retomado com preços atuais. Confira estoque, desconto e pagamentos.');
  }
  const show = (section: Step) => !narrow || step === section;

  const catalog = <Panel title="Catálogo"><SearchBox value={query} onChange={setQuery} placeholder="Nome, SKU ou código de barras" tour="pdv-search" /><div className="grid grid-2">{products.filter(product => matches(query, product.name, product.sku, product.barcode)).slice(0, 60).map((product, index) => <article className="card stack" key={product.id} data-tour={index === 0 ? 'pdv-product' : undefined}><strong>{product.name}</strong><small className="muted">{product.sku} · Disponível: {available(product.id)}</small><span>{money(product.price)}</span><button className="btn" disabled={pending || available(product.id) < 1} onClick={() => add(product.id)}><Plus size={16} aria-hidden="true" /> Adicionar</button></article>)}</div>{!products.length && <Empty text="Cadastre produtos e registre uma entrada de estoque para vender." />}<p className="muted">Exibindo até 60 produtos. Use a busca para localizar itens específicos.</p>{narrow && <Button variant="primary" disabled={!cart.length} onClick={() => setStep('cart')}>Ver carrinho ({itemCount})</Button>}</Panel>;

  const cartPanel = <Panel title="Carrinho"><div className="stack" data-tour="pdv-cart"><SelectField label="Cliente" value={customerId} onChange={setCustomerId} tour="pdv-customer"><option value="">Consumidor não identificado</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectField>{cart.length ? cart.map((item, index) => { const name = products.find(product => product.id === item.productId)?.name || 'Produto indisponível'; return <div className="card stack" key={item.productId}><strong>{name}</strong><div className="toolbar"><span data-tour={index === 0 ? 'pdv-qty' : undefined}><TextField label="Quantidade" type="number" required min={1} max={available(item.productId)} step="1" value={item.quantity} onChange={value => setCart(current => current.map(row => row.productId === item.productId ? { ...row, quantity: Number(value) } : row))} /></span><span>{money(item.quantity * priceOf(item.productId))}</span><button type="button" className="btn danger" aria-label={`Remover ${name}`} onClick={() => setCart(current => current.filter(row => row.productId !== item.productId))}><Trash2 size={16} /></button></div></div>; }) : <Empty text="Adicione produtos para iniciar a venda." />}<div className="form-grid" data-tour="pdv-discount"><SelectField label="Tipo de desconto" value={discountMode} onChange={setDiscountMode}><option value="value">Valor em R$</option><option value="percent">Percentual</option></SelectField><TextField label={discountMode === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} inputMode="decimal" value={discount} onChange={setDiscount} error={discountAmount > subtotal ? 'Desconto maior que o subtotal.' : undefined} /><TextField label="Acréscimo (R$)" inputMode="decimal" value={surcharge} onChange={setSurcharge} /></div><p>Subtotal {money(subtotal)} · Desconto {money(discountAmount)} · Total <strong>{money(Math.max(total, 0))}</strong></p><div className="toolbar"><button type="button" className="btn" disabled={pending || !cart.length} onClick={() => void suspend()}><Pause size={16} aria-hidden="true" /> Suspender</button>{narrow && <Button variant="primary" disabled={!cart.length} onClick={() => setStep('payment')}>Ir para pagamento</Button>}</div></div></Panel>;

  const paymentPanel = <Panel title="Pagamento"><div className="stack"><p className="muted">Informe o valor <strong>entregue</strong> em cada forma. Troco só em dinheiro; Pix e cartões não podem passar do total.</p><fieldset className="stack" data-tour="pdv-payment"><legend>Pagamentos mistos</legend>{payments.map((payment, index) => <div className="toolbar" key={index}><SelectField label={`Forma de pagamento ${index + 1}`} value={payment.method} onChange={method => setPayments(current => current.map((row, i) => i === index ? { ...row, method } : row))}>{METHODS.map(method => <option key={method}>{method}</option>)}</SelectField><TextField label={`Valor do pagamento ${index + 1} (R$)`} inputMode="decimal" required value={payment.value} onChange={value => setPayments(current => current.map((row, i) => i === index ? { ...row, value } : row))} /><button type="button" className="btn ghost" onClick={() => completePayment(index)}>Completar</button><button type="button" className="btn danger" aria-label={`Remover pagamento ${index + 1}`} disabled={payments.length === 1} onClick={() => setPayments(current => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}<button className="btn" type="button" onClick={() => setPayments(current => [...current, { method: 'Pix', value: '' }])}><Plus size={16} aria-hidden="true" /> Outra forma</button></fieldset>
    <div className="grid grid-4"><Stat label="Total da venda" value={money(Math.max(total, 0))} tone="blue" /><Stat label="Total recebido" value={money(summary.received)} icon={<CreditCard size={18} />} tone="purple" /><Stat label="Falta receber" value={money(summary.remaining)} tone={summary.remaining ? 'amber' : 'green'} hint={summary.remaining ? 'Pagamento incompleto' : 'Coberto'} /><div data-tour="pdv-change"><Stat label="Troco a devolver" value={money(summary.change)} icon={<Coins size={18} />} tone={summary.change ? 'cyan' : 'green'} hint={summary.change ? 'Devolver em dinheiro' : 'Sem troco'} /></div></div>
    <p role="status" aria-live="polite" className={summary.error || invalidMoney ? 'callout warning' : 'callout'}>{invalidMoney ? 'Revise os valores informados (use até duas casas decimais).' : summary.error || (summary.change ? `Pagamento coberto. Devolva ${money(summary.change)} de troco.` : 'Pagamento coberto, sem troco.')}</p>
    {!cash && <p className="callout warning">Caixa fechado: abra o caixa para finalizar.</p>}
    <div className="toolbar">{narrow && <Button onClick={() => setStep('cart')}>Voltar ao carrinho</Button>}<Button type="submit" variant="primary" data-tour="pdv-finish" loading={pending} disabled={!cash || blocked}>Finalizar venda</Button></div></div></Panel>;

  return <div className="page stack"><PageHeader title="Frente de caixa" subtitle="Venda local integrada ao estoque e ao financeiro."><Badge>{cash ? 'Caixa aberto' : 'Caixa fechado'}</Badge>{!cash && <button className="btn primary" data-tour="pdv-open-cash" onClick={() => setCashModal(true)}><Banknote size={16} aria-hidden="true" /> Abrir caixa</button>}</PageHeader>
    <div className="grid grid-3"><Stat label="Itens no carrinho" value={itemCount} icon={<ShoppingCart size={20} />} /><Stat label="Total da venda" value={money(Math.max(total, 0))} /><Stat label="Dinheiro esperado no caixa" value={cash ? money(cashExpected(cash)) : 'Fechado'} /></div>
    {narrow && <nav className="tabs" aria-label="Etapas da venda">{STEPS.map(([value, label], index) => <button key={value} type="button" className={`btn ${step === value ? 'primary' : ''}`} aria-current={step === value ? 'step' : undefined} onClick={() => setStep(value)}>{index + 1}. {label}{value === 'cart' ? ` (${itemCount})` : ''}</button>)}</nav>}
    <div className="grid grid-2">{show('products') && catalog}<form className="stack" onSubmit={checkout}>{show('cart') && cartPanel}{show('payment') && paymentPanel}</form></div>
    <Panel title="Carrinhos suspensos">{suspended.length ? suspended.map(record => <article key={record.id} className="toolbar"><strong>{record.title}</strong><span>{money(record.amount)}</span><button className="btn" disabled={pending} onClick={() => resume(record)}><Play size={16} aria-hidden="true" /> Retomar</button><button className="btn danger" disabled={pending || record.id === suspendedId} onClick={() => { if (window.confirm('Descartar este carrinho suspenso?')) void run(draft => { const saved = draft.records.find(row => row.id === record.id && row.tenantId === session.tenantId); if (!saved || saved.fields.saleId) throw new Error('Carrinho indisponível.'); saved.status = 'Descartado'; saved.history.push({ date: new Date().toISOString(), text: `Descartado por ${session.name}` }); }, 'Carrinho descartado.', 'excluir', rpc('transition_record', { p_tenant: session.tenantId, p_id: record.id, p_status: 'Descartado' })); }}>Descartar</button></article>) : <Empty text="Nenhum carrinho suspenso." />}</Panel>
    <Modal title="Abrir caixa" open={cashModal} onClose={() => !pending && setCashModal(false)}><form className="stack" onSubmit={async event => { event.preventDefault(); try { const amount = cents(opening); if (await run(draft => openCash(draft, session.tenantId, session.branchId, amount), 'Caixa aberto.', 'editar', rpc('open_cash', { p_tenant: session.tenantId, p_branch: session.branchId, p_opening: amount }))) setCashModal(false); } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); } }}><TextField label="Fundo de abertura (R$)" inputMode="decimal" required value={opening} onChange={setOpening} /><FormActions pending={pending} onClose={() => setCashModal(false)} label="Abrir caixa" /></form></Modal>
    <Modal title="Venda concluída" open={!!receipt} onClose={() => setReceipt(null)}>{receipt && <div className="stack" data-tour="pdv-receipt">{receipt.change > 0 ? <p className="callout" role="status"><strong style={{ fontSize: '1.4rem' }}>Troco: {money(receipt.change)}</strong></p> : <p className="callout" role="status">Sem troco a devolver.</p>}<Receipt sale={receipt} customer={customers.find(customer => customer.id === receipt.customerId)?.name} business={state.tenants.find(tenant => tenant.id === session.tenantId)?.name} /></div>}</Modal></div>;
}
