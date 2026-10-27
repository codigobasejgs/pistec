import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banknote, Camera, Coins, CreditCard, Keyboard, LayoutGrid, List, Lock, Minus, Pause, Play, Plus, Printer, ScanBarcode, ShoppingCart, Star, Trash2, UserPlus, X } from 'lucide-react';
import { can, closeCash, completeSale, openCash } from '../../domain';
import { money, uid } from '../../lib';
import { Badge, Button, Empty, Modal, Stat } from '../../ui';
import type { OperationalRecord, Sale } from '../../types';
import { cents, decimal, matches, cashExpected, paymentSummary } from './logic';
import { FormActions, SelectField, TextField, useErp, useNarrow } from './shared';
import { Receipt } from './SalesRecords';
import { useBusyGuard, usePwa } from '../../pwa';
import { rpc } from '../../store';
import DocumentDialog from '../documents/DocumentDialog';

interface CartLine { productId: string; quantity: number }
const METHODS = ['Dinheiro', 'Pix', 'Crédito', 'Débito'];
const STEPS = [['products', 'Produtos'], ['cart', 'Carrinho'], ['payment', 'Pagamento']] as const;
type Step = typeof STEPS[number][0];
const SHORTCUTS = [['F2', 'Buscar produto / ler código'], ['F4', 'Escolher cliente'], ['F6', 'Desconto e acréscimo'], ['F8', 'Suspender carrinho'], ['F9', 'Cobrar / finalizar venda'], ['Esc', 'Fechar pagamento ou janela']];
const local = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* preferência opcional */ } } };

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
const BarcodeDetectorApi = () => (globalThis as unknown as { BarcodeDetector?: new (o?: { formats: string[] }) => Detector }).BarcodeDetector;

/** Leitura pela câmera (opcional): BarcodeDetector nativo. Sem suporte, orienta usar leitor USB ou digitar. */
function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null); const [error, setError] = useState('');
  useEffect(() => {
    const Api = BarcodeDetectorApi(); let stream: MediaStream | null = null; let timer = 0; let stopped = false;
    if (!Api) { setError('Este navegador não lê código pela câmera. Use um leitor USB/Bluetooth ou digite o código.'); return; }
    void navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } }).then(async s => {
      stream = s; if (stopped || !video.current) return; video.current.srcObject = s; await video.current.play();
      const detector = new Api({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] });
      const tick = async () => { if (stopped || !video.current) return; try { const [hit] = await detector.detect(video.current); if (hit?.rawValue) { onCode(hit.rawValue); return; } } catch { /* quadro sem código */ } timer = window.setTimeout(tick, 300); };
      void tick();
    }).catch(() => setError('Câmera indisponível ou permissão negada. Use o leitor ou digite o código.'));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [onCode]);
  return <Modal title="Ler código pela câmera" open onClose={onClose}>{error ? <p className="callout warning" role="alert">{error}</p> : <><video ref={video} className="pos-camera" muted playsInline aria-label="Imagem da câmera"/><p className="muted small">Aponte para o código de barras. O produto entra no carrinho ao ser reconhecido.</p></>}</Modal>;
}

export default function Pos() {
  const { state, session, run, pending, notice, mode } = useErp('pdv');
  const { online } = usePwa();
  const narrow = useNarrow(760);
  const [step, setStep] = useState<Step>('products');
  const [query, setQuery] = useState(''), [customerId, setCustomerId] = useState(''), [cart, setCart] = useState<CartLine[]>([]);
  useBusyGuard(cart.length > 0); // venda em andamento: atualização do app pede confirmação
  const [discount, setDiscount] = useState('0'), [surcharge, setSurcharge] = useState('0'), [discountMode, setDiscountMode] = useState('value');
  const [payments, setPayments] = useState([{ method: 'Dinheiro', value: '' }]);
  const [receipt, setReceipt] = useState<Sale | null>(null), [cashModal, setCashModal] = useState<'' | 'open' | 'close'>(''), [opening, setOpening] = useState('0'), [counted, setCounted] = useState(''), [closeReason, setCloseReason] = useState(''), [suspendedId, setSuspendedId] = useState('');
  const [checkout, setCheckout] = useState(false), [shortcuts, setShortcuts] = useState(false), [camera, setCamera] = useState(false), [adjust, setAdjust] = useState(false);
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null), [category, setCategory] = useState('');
  const [view, setView] = useState<'cards' | 'list'>(() => local.get('pistec-pdv-view') === 'list' ? 'list' : 'cards');
  const favKey = `pistec-pdv-favs-${session.tenantId}`;
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(local.get(favKey) ?? '[]'); } catch { return []; } });
  const [docFor, setDocFor] = useState<Sale | null>(null);
  const search = useRef<HTMLInputElement>(null), customerRef = useRef<HTMLDivElement>(null), firstPayment = useRef<HTMLDivElement>(null);
  // Uma chave por carrinho: reenvio (duplo clique, falha de rede, timeout) usa a MESMA chave e não duplica venda; só renova após concluir/limpar.
  const requestId = useRef<string>(uid());
  // ponytail: filtro síncrono (lista limitada a 60 itens); debounce só se o catálogo passar de ~10 mil produtos.
  const products = state.products.filter(product => product.tenantId === session.tenantId && product.active);
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const tenant = state.tenants.find(t => t.id === session.tenantId);
  const branch = state.branches.find(b => b.id === session.branchId);
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
  const offline = mode === 'real' && !online; // venda real nunca é registrada offline
  const blocked = !cart.length || invalidMoney || total <= 0 || discountAmount > subtotal || !!summary.error;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const listed = products.filter(p => (!category || (category === '★' ? favorites.includes(p.id) : p.category === category)) && matches(query, p.name, p.sku, p.barcode, p.brand))
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id))).slice(0, 60);

  function add(productId: string) {
    const current = cart.find(item => item.productId === productId)?.quantity || 0;
    if (current >= available(productId)) { notice('Sem estoque disponível nesta filial para adicionar este produto.'); return false; }
    setCart(previous => previous.some(item => item.productId === productId) ? previous.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item) : [...previous, { productId, quantity: 1 }]);
    return true;
  }
  /** Leitor de código (teclado + Enter) ou câmera: código exato primeiro; senão, resultado único da busca. */
  function scan(code: string) {
    const c = code.trim().toLocaleLowerCase('pt-BR'); if (!c) return;
    const hit = products.find(p => p.barcode && p.barcode.toLocaleLowerCase('pt-BR') === c) ?? products.find(p => p.sku.toLocaleLowerCase('pt-BR') === c);
    const only = products.filter(p => matches(code, p.name, p.sku, p.barcode, p.brand));
    const product = hit ?? (only.length === 1 ? only[0] : undefined);
    if (!product) { notice(only.length ? 'Vários produtos encontrados: toque em Adicionar no produto desejado.' : 'Nenhum produto com este código nesta empresa.'); return; }
    if (add(product.id)) { setQuery(''); notice(`${product.name} adicionado.`); }
  }
  const toggleFav = (id: string) => setFavorites(f => { const next = f.includes(id) ? f.filter(x => x !== id) : [...f, id]; local.set(favKey, JSON.stringify(next)); return next; });
  const setQty = (productId: string, quantity: number) => setCart(current => current.map(row => row.productId === productId ? { ...row, quantity } : row));
  function completePayment(index: number) {
    const other = parsed.reduce((sum, payment, i) => i === index ? sum : sum + payment.amount, 0);
    setPayments(current => current.map((row, i) => i === index ? { ...row, value: decimal(Math.max(0, total - other)) } : row));
  }
  function clear() { setCart([]); setCustomerId(''); setDiscount('0'); setSurcharge('0'); setDiscountMode('value'); setPayments([{ method: 'Dinheiro', value: '' }]); setSuspendedId(''); setStep('products'); setCheckout(false); requestId.current = uid(); }
  function openCheckout() {
    if (!cart.length) { notice('Adicione produtos para cobrar.'); return; }
    if (!cash) { notice('Caixa fechado: abra o caixa para cobrar.'); return; }
    if (offline) { notice('Sem conexão com o servidor: vendas não são registradas offline. Aguarde a conexão voltar.'); return; }
    if (invalidMoney || discountAmount > subtotal || total <= 0) { notice('Revise desconto e acréscimo antes de cobrar.'); setAdjust(true); return; }
    setCheckout(true); if (narrow) setStep('payment');
  }
  async function finish(event?: FormEvent) {
    event?.preventDefault();
    if (offline) { notice('Sem conexão com o servidor: a venda não foi enviada. Tente novamente quando a conexão voltar; a mesma venda não será duplicada.'); return; }
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
    const title = `Carrinho · ${customers.find(customer => customer.id === customerId)?.name || session.name}`;
    if (await run(draft => {
      const now = new Date().toISOString();
      const record: OperationalRecord = { id, tenantId: session.tenantId, branchId: session.branchId, kind: 'cart', title, status: 'Suspenso', customerId, date: now, amount: total, fields: { discount, surcharge, discountMode, requestId: requestId.current }, items: cart.map(item => { const product = draft.products.find(row => row.id === item.productId && row.tenantId === session.tenantId && row.active); if (!product) throw new Error('Um produto deixou de estar disponível.'); return { ...item, name: product.name, price: product.price, cost: product.cost }; }), history: [{ date: now, text: `Carrinho suspenso por ${session.name}; estoque não reservado.` }] };
      const index = draft.records.findIndex(row => row.id === id && row.tenantId === session.tenantId);
      if (index >= 0) { if (draft.records[index].fields.saleId) throw new Error('Carrinho já convertido em venda.'); record.history = [...draft.records[index].history, ...record.history]; draft.records[index] = record; } else draft.records.push(record);
    }, 'Carrinho suspenso. Valores e estoque serão revalidados ao retomar.', 'cadastrar', rpc('save_record', { p_tenant: session.tenantId, p: {
      id, kind: 'cart', branchId: session.branchId, customerId, amount: Math.max(total, 0), title,
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
  function discard(record: OperationalRecord) {
    if (window.confirm('Descartar este carrinho suspenso?')) void run(draft => { const saved = draft.records.find(row => row.id === record.id && row.tenantId === session.tenantId); if (!saved || saved.fields.saleId) throw new Error('Carrinho indisponível.'); saved.status = 'Descartado'; saved.history.push({ date: new Date().toISOString(), text: `Descartado por ${session.name}` }); }, 'Carrinho descartado.', 'excluir', rpc('transition_record', { p_tenant: session.tenantId, p_id: record.id, p_status: 'Descartado' }));
  }
  async function saveCustomer(event: FormEvent) {
    event.preventDefault(); if (!newCustomer) return;
    const edit = { id: uid(), tenantId: session.tenantId, name: newCustomer.name.trim(), phone: newCustomer.phone.trim(), document: '', email: '', address: '', consent: false, notes: 'Cadastro rápido pelo PDV' };
    if (!edit.name || !edit.phone) { notice('Informe nome e telefone.'); return; }
    if (await run(draft => { draft.customers.push(edit); draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `Cadastro rápido de cliente ${edit.name} pelo PDV` }); }, 'Cliente cadastrado e selecionado.', 'cadastrar', rpc('save_customer', { p_tenant: session.tenantId, p: edit }))) { setCustomerId(edit.id); setNewCustomer(null); }
  }
  async function submitCash(event: FormEvent) {
    event.preventDefault();
    try {
      if (cashModal === 'open') { const amount = cents(opening); if (await run(draft => openCash(draft, session.tenantId, session.branchId, amount), 'Caixa aberto.', 'editar', rpc('open_cash', { p_tenant: session.tenantId, p_branch: session.branchId, p_opening: amount }))) setCashModal(''); return; }
      if (!cash) return;
      const amount = cents(counted), expected = cashExpected(cash);
      if (amount !== expected && !closeReason.trim()) { notice('Informe o motivo da diferença de caixa.'); return; }
      if (await run(draft => closeCash(draft, session.tenantId, cash.id, amount, closeReason.trim() || undefined, session.name), 'Caixa fechado. Fechamento registrado no histórico.', 'editar', rpc('close_cash', { p_tenant: session.tenantId, p_cash: cash.id, p_counted: amount, p_reason: closeReason.trim() || null }))) { setCashModal(''); setCounted(''); setCloseReason(''); }
    } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); }
  }

  // Atalhos de teclado do operador. Ref com as ações atuais evita recriar o listener a cada render.
  const keys = useRef({ openCheckout, finish, suspend, checkout });
  keys.current = { openCheckout, finish, suspend, checkout };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); search.current?.select(); }
      else if (e.key === 'F4') { e.preventDefault(); setStep('cart'); customerRef.current?.querySelector('select')?.focus(); }
      else if (e.key === 'F6') { e.preventDefault(); setStep('cart'); setAdjust(true); setTimeout(() => document.querySelector<HTMLInputElement>('.pos-adjust input')?.focus(), 0); }
      else if (e.key === 'F8') { e.preventDefault(); void k.suspend(); }
      else if (e.key === 'F9') { e.preventDefault(); if (k.checkout) void k.finish(); else k.openCheckout(); }
      else if (e.key === 'Escape' && k.checkout && !document.querySelector('.modal-content')) setCheckout(false);
    };
    addEventListener('keydown', handler); return () => removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { if (checkout) firstPayment.current?.querySelector('input')?.focus(); }, [checkout]);
  const show = (section: Step) => !narrow || step === section || (section === 'cart' && step === 'payment');
  const canCustomer = can(session.role, 'clientes', 'cadastrar'), canCash = can(session.role, 'caixa', 'editar');

  const catalog = <section className="panel pos-catalog" aria-label="Catálogo">
    <div className="pos-search-row">
      <label className="pos-search" data-tour="pdv-search"><ScanBarcode size={19} aria-hidden="true"/><input ref={search} aria-label="Nome, SKU ou código de barras" placeholder="Nome, SKU ou código de barras" value={query} autoComplete="off" enterKeyHint="search"
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); scan(query); } }}/><kbd>F2</kbd></label>
      {BarcodeDetectorApi() && <button type="button" className="icon-button" aria-label="Ler código pela câmera" onClick={() => setCamera(true)}><Camera size={18}/></button>}
      <div className="segmented" data-tour="pdv-view" role="group" aria-label="Visualização do catálogo">{([['cards', LayoutGrid, 'Cartões'], ['list', List, 'Lista']] as const).map(([v, Icon, label]) => <button key={v} type="button" className={`icon-button ${view === v ? 'is-active' : ''}`} aria-pressed={view === v} aria-label={`Ver em ${label.toLowerCase()}`} onClick={() => { setView(v); local.set('pistec-pdv-view', v); }}><Icon size={17}/></button>)}</div>
    </div>
    {(categories.length > 0 || favorites.length > 0) && <div className="chips" role="group" aria-label="Filtrar por categoria"><button type="button" className={`chip ${!category ? 'is-active' : ''}`} onClick={() => setCategory('')}>Todos</button>{favorites.length > 0 && <button type="button" className={`chip ${category === '★' ? 'is-active' : ''}`} onClick={() => setCategory('★')}><Star size={13}/>Favoritos</button>}{categories.map(c => <button type="button" key={c} className={`chip ${category === c ? 'is-active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>}
    <div className={`pos-products ${view}`}>{listed.map((product, index) => { const stock = available(product.id), fav = favorites.includes(product.id); return <article className="pos-product" key={product.id} data-tour={index === 0 ? 'pdv-product' : undefined}>
      <div className="pos-product-info"><strong>{product.name}</strong><small className="muted">{product.sku}{product.brand ? ` · ${product.brand}` : ''}</small><small className={stock < 1 ? 'bad' : stock <= product.min ? 'warn' : 'muted'}>{stock < 1 ? 'Sem estoque nesta filial' : `Disponível: ${stock}`}</small></div>
      <span className="pos-price">{money(product.price)}</span>
      <div className="pos-product-actions"><button type="button" className={`icon-button ${fav ? 'is-active' : ''}`} aria-pressed={fav} aria-label={`${fav ? 'Desfavoritar' : 'Favoritar'} ${product.name}`} onClick={() => toggleFav(product.id)}><Star size={15} fill={fav ? 'currentColor' : 'none'}/></button><button className="btn" type="button" disabled={pending || stock < 1} onClick={() => add(product.id)}><Plus size={16} aria-hidden="true"/> Adicionar</button></div>
    </article>; })}</div>
    {!products.length ? <Empty text="Cadastre produtos e registre uma entrada de estoque para vender."/> : !listed.length && <Empty text="Nenhum produto encontrado. Confira o código ou busque pelo nome."/>}
    {listed.length === 60 && <p className="muted small">Exibindo 60 produtos. Refine a busca para localizar itens específicos.</p>}
  </section>;

  const cartPanel = <section className="panel pos-cart" aria-label="Carrinho">
    <div className="panel-heading"><h2><ShoppingCart size={18}/>Carrinho <span className="muted small">({itemCount} {itemCount === 1 ? 'item' : 'itens'})</span></h2>{cart.length > 0 && <button type="button" className="text-button" onClick={() => { if (window.confirm('Limpar o carrinho?')) clear(); }}>Limpar</button>}</div>
    <div className="pos-customer" ref={customerRef}><SelectField label="Cliente" value={customerId} onChange={setCustomerId} tour="pdv-customer"><option value="">Consumidor não identificado</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectField>
      {canCustomer && <button type="button" className="icon-button" aria-label="Cadastrar cliente rápido" onClick={() => setNewCustomer({ name: '', phone: '' })}><UserPlus size={18}/></button>}</div>
    <div className="pos-lines" data-tour="pdv-cart">{cart.length ? cart.map((item, index) => { const product = products.find(p => p.id === item.productId); const name = product?.name || 'Produto indisponível'; const max = available(item.productId);
      return <div className="pos-line" key={item.productId}><div className="pos-line-name"><strong>{name}</strong><small className="muted">{money(priceOf(item.productId))} un.{item.quantity > max ? ' · acima do disponível' : ''}</small></div>
        <div className="pos-qty" data-tour={index === 0 ? 'pdv-qty' : undefined}><button type="button" className="icon-button" aria-label={`Diminuir quantidade de ${name}`} disabled={item.quantity <= 1} onClick={() => setQty(item.productId, item.quantity - 1)}><Minus size={14}/></button>
          <TextField label="Quantidade" type="number" required min={1} max={max} step="1" value={item.quantity} onChange={value => setQty(item.productId, Number(value))}/>
          <button type="button" className="icon-button" aria-label={`Aumentar quantidade de ${name}`} disabled={item.quantity >= max} onClick={() => setQty(item.productId, item.quantity + 1)}><Plus size={14}/></button></div>
        <strong className="pos-line-total">{money(item.quantity * priceOf(item.productId))}</strong>
        <button type="button" className="icon-button danger" aria-label={`Remover ${name}`} onClick={() => setCart(current => current.filter(row => row.productId !== item.productId))}><Trash2 size={16}/></button></div>; })
      : <Empty text="Leia um código de barras ou toque em Adicionar para iniciar a venda."/>}</div>
    <details className="pos-adjust" data-tour="pdv-discount" open={adjust} onToggle={event => setAdjust(event.currentTarget.open)}><summary>Desconto e acréscimo <kbd>F6</kbd>{(discountAmount > 0 || surchargeAmount > 0) && <span className="muted small"> · −{money(discountAmount)} / +{money(surchargeAmount)}</span>}</summary>
      <div className="form-grid"><SelectField label="Tipo de desconto" value={discountMode} onChange={setDiscountMode}><option value="value">Valor em R$</option><option value="percent">Percentual</option></SelectField><TextField label={discountMode === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} inputMode="decimal" value={discount} onChange={setDiscount} error={discountAmount > subtotal ? 'Desconto maior que o subtotal.' : undefined}/><TextField label="Acréscimo (R$)" inputMode="decimal" value={surcharge} onChange={setSurcharge}/></div>
      <p className="muted small">O servidor revalida desconto, preço e estoque ao finalizar.</p></details>
    <dl className="pos-totals"><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>{discountAmount > 0 && <div><dt>Desconto</dt><dd>−{money(discountAmount)}</dd></div>}{surchargeAmount > 0 && <div><dt>Acréscimo</dt><dd>+{money(surchargeAmount)}</dd></div>}<div className="grand"><dt>Total</dt><dd>{money(Math.max(total, 0))}</dd></div></dl>
    <div className="pos-cart-actions"><button type="button" className="btn" data-tour="pdv-suspend" disabled={pending || !cart.length} onClick={() => void suspend()}><Pause size={16} aria-hidden="true"/> Suspender</button>
      <button type="button" className="btn primary pos-charge" data-tour="pdv-charge" disabled={pending || !cart.length} onClick={openCheckout}>Cobrar <span>{money(Math.max(total, 0))}</span><kbd>F9</kbd></button></div>
  </section>;

  const drawer = checkout && <div className="pos-drawer-layer"><button type="button" className="pos-drawer-scrim" aria-label="Fechar pagamento" tabIndex={-1} onClick={() => setCheckout(false)}/>
    <form className="pos-drawer" role="dialog" aria-modal="false" aria-label="Pagamento" onSubmit={finish}>
      <div className="pos-drawer-head"><div><span className="eyebrow">PAGAMENTO</span><strong className="pos-drawer-total">{money(Math.max(total, 0))}</strong><small className="muted">{itemCount} {itemCount === 1 ? 'item' : 'itens'} · {customers.find(c => c.id === customerId)?.name || 'Consumidor não identificado'}</small></div><button type="button" className="icon-button" aria-label="Fechar pagamento" onClick={() => { setCheckout(false); if (narrow) setStep('cart'); }}><X size={20}/></button></div>
      <p className="muted small">Informe o valor <strong>entregue</strong> em cada forma. Troco só em dinheiro; Pix e cartões não podem passar do total.</p>
      <fieldset className="stack" data-tour="pdv-payment"><legend>Pagamentos mistos</legend>{payments.map((payment, index) => <div className="pos-payment" key={index} ref={index === 0 ? firstPayment : undefined}>
        <SelectField label={`Forma de pagamento ${index + 1}`} value={payment.method} onChange={method => setPayments(current => current.map((row, i) => i === index ? { ...row, method } : row))}>{METHODS.map(method => <option key={method}>{method}</option>)}</SelectField>
        <TextField label={`Valor do pagamento ${index + 1} (R$)`} inputMode="decimal" required value={payment.value} onChange={value => setPayments(current => current.map((row, i) => i === index ? { ...row, value } : row))}/>
        <button type="button" className="btn ghost" onClick={() => completePayment(index)}>Completar</button>
        <button type="button" className="icon-button danger" aria-label={`Remover pagamento ${index + 1}`} disabled={payments.length === 1} onClick={() => setPayments(current => current.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>)}
        <button className="btn" type="button" onClick={() => setPayments(current => [...current, { method: 'Pix', value: '' }])}><Plus size={16} aria-hidden="true"/> Outra forma</button></fieldset>
      <div className="grid grid-2 pos-pay-stats"><Stat label="Total recebido" value={money(summary.received)} icon={<CreditCard size={18}/>} tone="purple"/><Stat label="Falta receber" value={money(summary.remaining)} tone={summary.remaining ? 'amber' : 'green'} hint={summary.remaining ? 'Pagamento incompleto' : 'Coberto'}/>
        <div data-tour="pdv-change" className="span-2"><Stat label="Troco a devolver" value={money(summary.change)} icon={<Coins size={18}/>} tone={summary.change ? 'cyan' : 'green'} hint={summary.change ? 'Devolver em dinheiro' : 'Sem troco'}/></div></div>
      <p role="status" aria-live="polite" className={summary.error || invalidMoney ? 'callout warning' : 'callout'}>{invalidMoney ? 'Revise os valores informados (use até duas casas decimais).' : summary.error || (summary.change ? `Pagamento coberto. Devolva ${money(summary.change)} de troco.` : 'Pagamento coberto, sem troco.')}</p>
      {!cash && <p className="callout warning">Caixa fechado: abra o caixa para finalizar.</p>}
      {offline && <p className="callout warning" role="alert">Sem conexão com o servidor. A venda não será registrada até a conexão voltar.</p>}
      <div className="pos-drawer-actions"><Button onClick={() => { setCheckout(false); if (narrow) setStep('cart'); }}>Voltar ao carrinho</Button><Button type="submit" variant="primary" data-tour="pdv-finish" loading={pending} disabled={!cash || blocked || offline}>Finalizar venda <kbd>F9</kbd></Button></div>
    </form></div>;

  return <div className="page pos-page">
    <header className="pos-header"><div className="pos-title"><h1>Frente de caixa</h1><p className="muted small">{tenant?.name} · {branch?.name ?? 'Filial'} · Operador: {session.name}{cash ? ` · Aberto às ${new Date(cash.openedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · Dinheiro esperado ${money(cashExpected(cash))}` : ''}</p></div>
      <div className="toolbar"><Badge>{cash ? 'Caixa aberto' : 'Caixa fechado'}</Badge>
        {!cash ? <button className="btn primary" data-tour="pdv-open-cash" onClick={() => setCashModal('open')}><Banknote size={16} aria-hidden="true"/> Abrir caixa</button>
          : canCash && <button className="btn" onClick={() => { setCounted(decimal(cashExpected(cash))); setCashModal('close'); }}><Lock size={16} aria-hidden="true"/> Fechar caixa</button>}
        <button className="icon-button" aria-label="Atalhos de teclado" data-tour="pdv-shortcuts" onClick={() => setShortcuts(true)}><Keyboard size={18}/></button></div></header>
    {offline && <p className="callout warning" role="alert">Sem conexão com o servidor: consulte o catálogo, mas vendas só são registradas com conexão.</p>}
    {narrow && <nav className="tabs pos-steps" aria-label="Etapas da venda">{STEPS.map(([value, label], index) => <button key={value} type="button" className={`btn ${step === value ? 'primary' : ''}`} aria-current={step === value ? 'step' : undefined} onClick={() => value === 'payment' ? openCheckout() : (setStep(value), setCheckout(false))}>{index + 1}. {label}{value === 'cart' ? ` (${itemCount})` : ''}</button>)}</nav>}
    <div className="pos-layout">{show('products') && catalog}{show('cart') && cartPanel}</div>
    {narrow && step === 'products' && cart.length > 0 && <button type="button" className="btn primary pos-mobile-bar" onClick={() => setStep('cart')}><ShoppingCart size={16}/>Ver carrinho ({itemCount}) · {money(Math.max(total, 0))}</button>}
    {drawer}
    {suspended.length > 0 && <section className="panel pos-suspended" aria-label="Carrinhos suspensos"><h2>Carrinhos suspensos ({suspended.length})</h2><div className="pos-suspended-list">{suspended.map(record => <article key={record.id} className="pos-suspended-item"><div><strong>{record.title}</strong><small className="muted">{money(record.amount)} · {new Date(record.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><button className="btn" disabled={pending} onClick={() => resume(record)}><Play size={16} aria-hidden="true"/> Retomar</button><button className="icon-button danger" aria-label={`Descartar ${record.title}`} disabled={pending || record.id === suspendedId} onClick={() => discard(record)}><Trash2 size={16}/></button></article>)}</div></section>}
    <Modal title={cashModal === 'close' ? 'Fechar caixa' : 'Abrir caixa'} open={!!cashModal} onClose={() => !pending && setCashModal('')}><form className="stack" onSubmit={submitCash}>
      {cashModal === 'open' ? <TextField label="Fundo de abertura (R$)" inputMode="decimal" required value={opening} onChange={setOpening}/> : cash && <><p>Dinheiro esperado na gaveta: <strong>{money(cashExpected(cash))}</strong> (fundo + vendas em dinheiro − troco ± movimentos).</p><TextField label="Dinheiro contado (R$)" inputMode="decimal" required value={counted} onChange={setCounted}/><TextField label="Motivo da diferença" value={closeReason} onChange={setCloseReason} hint="Obrigatório quando o contado for diferente do esperado."/><p className="muted small">O fechamento é definitivo e fica no histórico do Caixa.</p></>}
      <FormActions pending={pending} onClose={() => setCashModal('')} label={cashModal === 'close' ? 'Fechar caixa' : 'Abrir caixa'}/></form></Modal>
    <Modal title="Cadastro rápido de cliente" open={!!newCustomer} onClose={() => !pending && setNewCustomer(null)}>{newCustomer && <form className="stack" onSubmit={saveCustomer}><TextField label="Nome do cliente" required value={newCustomer.name} onChange={name => setNewCustomer(c => c && { ...c, name })}/><TextField label="Telefone do cliente" required inputMode="numeric" value={newCustomer.phone} onChange={phone => setNewCustomer(c => c && { ...c, phone })}/><p className="muted small">Documento, e-mail e consentimento podem ser completados depois em Clientes.</p><FormActions pending={pending} onClose={() => setNewCustomer(null)} label="Cadastrar e selecionar"/></form>}</Modal>
    <Modal title="Atalhos do PDV" open={shortcuts} onClose={() => setShortcuts(false)}><dl className="kv-grid">{SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl><p className="muted small">Leitor de código de barras USB/Bluetooth funciona como teclado: leia o código com o campo de busca focado (F2) e o produto entra no carrinho ao final da leitura (Enter).</p></Modal>
    <DocumentDialog source={docFor ? { kind: 'sale', id: docFor.id, customerId: docFor.customerId } : null} onClose={() => setDocFor(null)}/>
    {camera && <CameraScan onClose={() => setCamera(false)} onCode={code => { setCamera(false); scan(code); }}/>}
    <Modal title="Venda concluída" open={!!receipt} onClose={() => setReceipt(null)}>{receipt && <div className="stack" data-tour="pdv-receipt">{receipt.change > 0 ? <p className="callout" role="status"><strong style={{ fontSize: '1.4rem' }}>Troco: {money(receipt.change)}</strong></p> : <p className="callout" role="status">Sem troco a devolver.</p>}
      <Receipt sale={receipt} customer={customers.find(customer => customer.id === receipt.customerId)?.name} business={tenant?.name}/>
      <div className="toolbar no-print" data-tour="pdv-deliver"><Button icon={<Printer size={16}/>} onClick={() => setDocFor(receipt)}>Imprimir · WhatsApp · E-mail · PDF</Button><Button variant="primary" onClick={() => { setReceipt(null); setTimeout(() => search.current?.focus(), 0); }}>Nova venda</Button></div></div>}</Modal>
  </div>;
}
