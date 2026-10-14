import { useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowDownCircle, ArrowDownRight, ArrowUpRight, Ban, Banknote, Check, Edit, History, Lock, Plus, Trash2, Undo2, Unlock } from 'lucide-react';
import { openCash, closeCash, settleEntry, reverseSettlement, cancelEntry, entryStatus, entryPaid, entryBalance } from '../../domain';
import { date, money, today, uid } from '../../lib';
import { Badge, Button, DataTable, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { CashRegister, FinancialEntry } from '../../types';
import { cashExpected, cents, decimal, inPeriod, matches } from './logic';
import { ExportButton, FormActions, SearchBox, SelectField, TextField, useErp } from './shared';

const METHODS = ['Pix', 'Dinheiro', 'Transferência', 'Crédito', 'Débito', 'Boleto'];
const STATUSES = ['Em aberto', 'Parcialmente pago', 'Vencido', 'Quitado', 'Cancelado'];
const tryCents = (value: string) => { try { return cents(value); } catch { return null; } };

export default function Finance() {
  const route = useLocation().pathname.split('/').at(-1);
  const cashOnly = route === 'caixa';
  const { state, session, pending, run, notice, download } = useErp(cashOnly ? 'caixa' : 'financeiro');
  const now = today();
  const [query, setQuery] = useState(''), [type, setType] = useState(route === 'contas-pagar' ? 'Despesa' : route === 'contas-receber' ? 'Receita' : ''), [status, setStatus] = useState(route?.startsWith('contas-') ? 'open' : ''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [tab, setTab] = useState(cashOnly ? 'cash' : 'entries');
  const [edit, setEdit] = useState<FinancialEntry | null>(null), [cashAction, setCashAction] = useState(''), [cashValue, setCashValue] = useState('0'), [reason, setReason] = useState('');
  const [payId, setPayId] = useState(''), [payAmount, setPayAmount] = useState(''), [method, setMethod] = useState('Pix'), [payDate, setPayDate] = useState(now), [payNote, setPayNote] = useState('');
  const [historyId, setHistoryId] = useState(''), [actionReason, setActionReason] = useState('');
  const payRequest = useRef(uid());
  const entries = state.finances.filter(entry => !cashOnly && entry.tenantId === session.tenantId && entry.branchId === session.branchId);
  const statusOf = (entry: FinancialEntry) => entryStatus(entry, now);
  const rows = entries.filter(entry => { const current = statusOf(entry); return matches(query, entry.description, entry.category, entry.reference) && (!type || entry.type === type) && (!status || (status === 'open' ? ['Em aberto', 'Parcialmente pago', 'Vencido'].includes(current) : current === status)) && inPeriod(entry.dueDate, start, end); });
  const registers = state.cashRegisters.filter(register => register.tenantId === session.tenantId && register.branchId === session.branchId);
  const cash = registers.find(register => !register.closedAt);
  const closed = registers.filter(register => register.closedAt).slice().reverse();
  const pay = entries.find(entry => entry.id === payId);
  const history = entries.find(entry => entry.id === historyId);
  const newEntry = (): FinancialEntry => ({ id: uid(), tenantId: session.tenantId, branchId: session.branchId, type: type === 'Despesa' ? 'Despesa' : 'Receita', category: '', description: '', amount: 0, dueDate: now, paid: false, settlements: [], reference: '', date: new Date().toISOString() });

  // Indicadores sobre o recorte filtrado; abertos usam SALDO (original − baixas ativas), cancelados ficam fora.
  const live = rows.filter(entry => !entry.cancelled);
  const sum = (list: FinancialEntry[], pick: (entry: FinancialEntry) => number) => list.reduce((total, entry) => total + pick(entry), 0);
  const receivable = sum(live.filter(entry => entry.type === 'Receita'), entryBalance), payable = sum(live.filter(entry => entry.type === 'Despesa'), entryBalance);
  const overdue = live.filter(entry => statusOf(entry) === 'Vencido');
  const received = sum(live.filter(entry => entry.type === 'Receita'), entryPaid), paidOut = sum(live.filter(entry => entry.type === 'Despesa'), entryPaid);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edit) return;
    try {
      const amount = cents(String(new FormData(event.currentTarget).get('amount')));
      if (amount <= 0 || !edit.description.trim() || !edit.category.trim()) throw new Error('Descrição, categoria e valor maior que zero são obrigatórios.');
      if (await run(draft => {
        const index = draft.finances.findIndex(entry => entry.id === edit.id && entry.tenantId === session.tenantId);
        if (index >= 0 && (entryPaid(draft.finances[index]) > 0 || draft.finances[index].cancelled || draft.finances[index].reference)) throw new Error('Lançamento com baixas, cancelado ou vinculado não pode ser editado.');
        const entry = { ...edit, amount, description: edit.description.trim(), category: edit.category.trim() };
        if (index >= 0) draft.finances[index] = entry; else draft.finances.push(entry);
      }, 'Lançamento salvo.', entries.some(entry => entry.id === edit.id) ? 'editar' : 'cadastrar')) setEdit(null);
    } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); }
  }
  function openPay(entry: FinancialEntry) { setPayId(entry.id); setPayAmount(decimal(entryBalance(entry))); setMethod('Pix'); setPayDate(now); setPayNote(''); payRequest.current = uid(); }
  const payCents = tryCents(payAmount || '');
  const payError = !pay ? '' : payCents === null ? 'Valor inválido (até duas casas decimais).' : payCents <= 0 ? 'Informe valor maior que zero.' : payCents > entryBalance(pay) ? `Valor acima do saldo de ${money(entryBalance(pay))}.` : '';
  async function settle(event: FormEvent) {
    event.preventDefault(); if (!pay || payError || payCents === null) return;
    const entryId = pay.id, amount = payCents, partial = amount < entryBalance(pay);
    if (await run(draft => settleEntry(draft, session.tenantId, entryId, { amount, method, date: payDate, user: session.name, note: payNote.trim(), requestId: payRequest.current }), partial ? 'Baixa parcial registrada.' : pay.type === 'Receita' ? 'Recebimento quitado.' : 'Pagamento quitado.')) setPayId('');
  }
  async function reverse(settlementId: string) {
    if (!history) return;
    if (!actionReason.trim()) { notice('Informe o motivo do estorno.'); return; }
    if (!window.confirm('Estornar esta baixa? O saldo volta a ficar em aberto.')) return;
    if (await run(draft => reverseSettlement(draft, session.tenantId, history.id, settlementId, session.name, actionReason.trim()), 'Baixa estornada.')) setActionReason('');
  }
  async function cancel() {
    if (!history) return;
    if (!actionReason.trim()) { notice('Informe o motivo do cancelamento.'); return; }
    if (!window.confirm('Cancelar este lançamento? A ação fica registrada no histórico.')) return;
    if (await run(draft => cancelEntry(draft, session.tenantId, history.id, session.name, actionReason.trim()), 'Lançamento cancelado.', 'cancelar')) setActionReason('');
  }

  const counted = tryCents(cashValue);
  const expected = cash ? cashExpected(cash) : 0;
  const difference = counted === null ? 0 : counted - expected;
  async function cashSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const amount = cents(cashValue);
      if ((cashAction === 'withdraw' || cashAction === 'supply') && (!reason.trim() || amount <= 0)) throw new Error('Informe motivo e valor maior que zero.');
      if (cashAction === 'close' && amount !== expected && !reason.trim()) throw new Error('Informe o motivo da diferença de caixa.');
      if (cashAction === 'close' && !window.confirm(`Fechar o caixa com contagem de ${money(amount)}? O fechamento é definitivo.`)) return;
      if (await run(draft => {
        if (cashAction === 'open') openCash(draft, session.tenantId, session.branchId, amount);
        else {
          const register = draft.cashRegisters.find(row => row.id === cash?.id && row.tenantId === session.tenantId && !row.closedAt);
          if (!register) throw new Error('O caixa não está mais aberto.');
          if (cashAction === 'close') closeCash(draft, session.tenantId, register.id, amount, reason.trim() || undefined, session.name);
          else {
            const movement = cashAction === 'withdraw' ? -amount : amount;
            if (cashExpected(register) + movement < 0) throw new Error('Saldo insuficiente para sangria.');
            register.movements.push({ id: uid(), amount: movement, reason: `${cashAction === 'withdraw' ? 'Sangria' : 'Suprimento'}: ${reason.trim()}`, date: new Date().toISOString() });
            draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `${cashAction === 'withdraw' ? 'Sangria' : 'Suprimento'} ${money(amount)}: ${reason.trim()}` });
          }
        }
      }, cashAction === 'close' ? 'Caixa fechado. Fechamento registrado no histórico.' : 'Caixa atualizado.')) { setCashAction(''); setCashValue('0'); setReason(''); }
    } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); }
  }
  const set = (key: keyof FinancialEntry, value: string) => setEdit(current => current ? { ...current, [key]: value } : current);
  const closedExpected = (register: CashRegister) => register.expected ?? cashExpected(register);
  const closedDiff = (register: CashRegister) => register.difference ?? (register.counted ?? 0) - closedExpected(register);

  const entriesPanel = <Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} tour="finance-search" /><SelectField label="Tipo" value={type} onChange={setType}><option value="">Todos</option><option value="Receita">Receitas / receber</option><option value="Despesa">Despesas / pagar</option></SelectField><SelectField label="Situação" value={status} onChange={setStatus} tour="finance-status"><option value="">Todas</option><option value="open">Com saldo em aberto</option>{STATUSES.map(value => <option key={value}>{value}</option>)}</SelectField><TextField label="Vencimento de" type="date" value={start} onChange={setStart} /><TextField label="Vencimento até" type="date" value={end} onChange={setEnd} /></div>
    <div data-tour="finance-table">{rows.length ? <DataTable rows={rows} columns={[
      { key: 'description', label: 'Descrição', render: (entry: FinancialEntry) => <>{entry.description}<small className="muted"> · {entry.category}</small></> },
      { key: 'type', label: 'Tipo', render: (entry: FinancialEntry) => entry.type === 'Receita' ? <span><ArrowUpRight size={14} aria-hidden="true" /> Receber</span> : <span><ArrowDownRight size={14} aria-hidden="true" /> Pagar</span> },
      { key: 'amount', label: 'Original', render: (entry: FinancialEntry) => money(entry.amount) },
      { key: 'paidValue', label: 'Pago', render: (entry: FinancialEntry) => money(entryPaid(entry)) },
      { key: 'balance', label: 'Saldo', render: (entry: FinancialEntry) => <strong>{money(entry.cancelled ? 0 : entryBalance(entry))}</strong> },
      { key: 'dueDate', label: 'Vencimento', render: (entry: FinancialEntry) => date(entry.dueDate) },
      { key: 'status', label: 'Situação', render: (entry: FinancialEntry) => <Badge>{statusOf(entry)}</Badge> },
      { key: 'actions', label: 'Ações', render: (entry: FinancialEntry) => { const balance = entryBalance(entry), locked = entry.cancelled || entryPaid(entry) > 0 || !!entry.reference; return <div className="toolbar"><button className="btn" data-tour={entry === rows[0] ? 'finance-settle' : undefined} disabled={pending || entry.cancelled || balance <= 0} onClick={() => openPay(entry)}><Check size={16} aria-hidden="true" /> {entry.type === 'Receita' ? 'Receber' : 'Pagar'}</button><button className="btn ghost" aria-label={`Histórico de ${entry.description}`} data-tour={entry === rows[0] ? 'finance-history' : undefined} onClick={() => { setHistoryId(entry.id); setActionReason(''); }}><History size={16} /></button><button className="btn ghost" aria-label={`Editar ${entry.description}`} disabled={pending || locked} onClick={() => setEdit({ ...entry })}><Edit size={16} /></button><button className="btn danger" aria-label={`Excluir ${entry.description}`} disabled={pending || locked} onClick={() => { if (window.confirm('Excluir lançamento em aberto sem vínculo nem baixas?')) void run(draft => { const current = draft.finances.find(row => row.id === entry.id && row.tenantId === session.tenantId); if (!current || entryPaid(current) > 0 || current.cancelled || current.reference) throw new Error('Lançamento protegido. Use cancelar.'); draft.finances = draft.finances.filter(row => row.id !== entry.id || row.tenantId !== session.tenantId); }, 'Lançamento excluído.', 'excluir'); }}><Trash2 size={16} /></button></div>; } },
    ]} /> : <Empty text="Nenhum lançamento encontrado. Crie um lançamento ou ajuste os filtros." />}</div></Panel>;

  const cashPanel = <div className="stack"><Panel title="Caixa da filial"><div className="toolbar">{cash ? <><button className="btn" disabled={pending} onClick={() => { setCashAction('withdraw'); setCashValue('0'); setReason(''); }}><ArrowDownCircle size={16} aria-hidden="true" /> Sangria</button><button className="btn" disabled={pending} onClick={() => { setCashAction('supply'); setCashValue('0'); setReason(''); }}><Plus size={16} aria-hidden="true" /> Suprimento</button><button className="btn danger" data-tour="cash-close" disabled={pending} onClick={() => { setCashAction('close'); setCashValue(''); setReason(''); }}><Lock size={16} aria-hidden="true" /> Fechar caixa</button></> : <button className="btn primary" data-tour="cash-open" onClick={() => { setCashAction('open'); setCashValue('0'); }}><Unlock size={16} aria-hidden="true" /> Abrir caixa</button>}</div>{cash ? <><p>Abertura: {date(cash.openedAt)} · Fundo: {money(cash.opening)} · Esperado: <strong>{money(expected)}</strong></p><DataTable rows={cash.movements} columns={[{ key: 'date', label: 'Data', render: (movement: typeof cash.movements[number]) => date(movement.date) }, { key: 'reason', label: 'Motivo' }, { key: 'amount', label: 'Valor', render: (movement: typeof cash.movements[number]) => money(movement.amount) }]} /></> : <Empty text="Caixa fechado. Abra um caixa para operar vendas em dinheiro." />}<p className="muted">Sangria e suprimento movimentam somente o caixa físico, não representam receita ou despesa. Pix e cartões não entram no saldo físico.</p></Panel>
    <Panel title="Histórico de fechamentos"><div data-tour="cash-history">{closed.length ? <DataTable rows={closed} columns={[
      { key: 'openedAt', label: 'Abertura', render: (register: CashRegister) => date(register.openedAt) },
      { key: 'closedAt', label: 'Fechamento', render: (register: CashRegister) => date(register.closedAt || '') },
      { key: 'expected', label: 'Esperado', render: (register: CashRegister) => money(closedExpected(register)) },
      { key: 'counted', label: 'Contado', render: (register: CashRegister) => money(register.counted ?? 0) },
      { key: 'difference', label: 'Diferença', render: (register: CashRegister) => { const value = closedDiff(register); return <span>{value ? <AlertTriangle size={14} aria-hidden="true" /> : null} {value > 0 ? 'Sobra ' : value < 0 ? 'Falta ' : 'Sem diferença '}{value ? money(Math.abs(value)) : ''}</span>; } },
      { key: 'closingReason', label: 'Motivo', render: (register: CashRegister) => register.closingReason || '—' },
      { key: 'closedBy', label: 'Responsável', render: (register: CashRegister) => register.closedBy || '—' },
    ]} /> : <Empty text="Ainda não há fechamentos nesta filial." />}</div></Panel></div>;

  return <div className="page stack"><PageHeader title="Financeiro" subtitle="Contas a pagar e receber com baixas parciais, estornos e caixa físico."><ExportButton tour="finance-export" onClick={() => download(cashOnly ? 'caixas' : 'financeiro', cashOnly ? registers.map(register => ({ abertura: register.openedAt, fechamento: register.closedAt || '', fundo: decimal(register.opening), esperado: decimal(closedExpected(register)), contado: register.counted === undefined ? '' : decimal(register.counted), diferenca: register.counted === undefined ? '' : decimal(closedDiff(register)), motivo: register.closingReason || '' })) : rows.map(entry => ({ descricao: entry.description, tipo: entry.type, categoria: entry.category, original: decimal(entry.amount), pago: decimal(entryPaid(entry)), saldo: decimal(entryBalance(entry)), vencimento: entry.dueDate, situacao: statusOf(entry), referencia: entry.reference })))} />{!cashOnly && <button className="btn primary" data-tour="finance-new" onClick={() => setEdit(newEntry())}><Plus size={16} aria-hidden="true" /> Novo lançamento</button>}</PageHeader>
    {cashOnly ? <div className="grid grid-3"><Stat label="Caixa físico esperado" value={cash ? money(expected) : 'Fechado'} icon={<Banknote size={20} />} tone="green" /><Stat label="Fechamentos registrados" value={closed.length} tone="blue" /><Stat label="Fechamentos com diferença" value={closed.filter(register => closedDiff(register) !== 0).length} tone="amber" /></div>
      : <div className="grid grid-4" data-tour="finance-kpis"><Stat label="A receber (saldo)" value={money(receivable)} hint={`Recebido: ${money(received)}`} tone="green" /><Stat label="A pagar (saldo)" value={money(payable)} hint={`Pago: ${money(paidOut)}`} tone="red" /><Stat label="Vencidos" value={overdue.length} hint={money(sum(overdue, entryBalance))} tone="amber" icon={<AlertTriangle size={18} />} /><Stat label="Saldo projetado" value={money(receivable - payable)} hint="Receber − pagar em aberto" tone="purple" /></div>}
    {!cashOnly && <div className="tabs"><button className={`btn ${tab === 'entries' ? 'primary' : ''}`} aria-pressed={tab === 'entries'} onClick={() => setTab('entries')}>Lançamentos</button><button className={`btn ${tab === 'cash' ? 'primary' : ''}`} aria-pressed={tab === 'cash'} onClick={() => setTab('cash')}>Caixa e histórico</button></div>}
    {tab === 'entries' && !cashOnly ? entriesPanel : cashPanel}
    <Modal title="Lançamento financeiro" open={!!edit} onClose={() => !pending && setEdit(null)}>{edit && <form className="stack" onSubmit={save}><SelectField label="Tipo" value={edit.type} onChange={value => set('type', value)}><option>Receita</option><option>Despesa</option></SelectField><TextField label="Descrição" required value={edit.description} onChange={value => set('description', value)} /><TextField label="Categoria" required value={edit.category} onChange={value => set('category', value)} /><label className="field"><span>Valor (R$)</span><input name="amount" aria-label="Valor (R$)" required inputMode="decimal" defaultValue={decimal(edit.amount)} /></label><TextField label="Vencimento" type="date" required value={edit.dueDate} onChange={value => set('dueDate', value)} /><p className="muted">O lançamento é criado em aberto; use Pagar/Receber para baixas parciais ou totais.</p><FormActions pending={pending} onClose={() => setEdit(null)} /></form>}</Modal>
    <Modal title={pay?.type === 'Receita' ? 'Registrar recebimento' : 'Registrar pagamento'} open={!!pay} onClose={() => !pending && setPayId('')}>{pay && <form className="stack" onSubmit={settle}><p><strong>{pay.description}</strong> · Original {money(pay.amount)} · Pago {money(entryPaid(pay))} · Saldo <strong>{money(entryBalance(pay))}</strong></p><TextField label="Valor da baixa (R$)" inputMode="decimal" required value={payAmount} onChange={setPayAmount} error={payError || undefined} hint={payCents !== null && payCents > 0 && payCents < entryBalance(pay) ? `Baixa parcial: restará ${money(entryBalance(pay) - payCents)}.` : 'Baixa integral do saldo.'} tour="finance-settle-amount" /><SelectField label="Forma de liquidação" value={method} onChange={setMethod}>{METHODS.map(value => <option key={value}>{value}</option>)}</SelectField><TextField label="Data da baixa" type="date" required value={payDate} onChange={setPayDate} /><TextField label="Observação" value={payNote} onChange={setPayNote} /><div className="toolbar"><Button disabled={pending} onClick={() => setPayId('')}>Cancelar</Button><Button type="submit" variant="primary" loading={pending} disabled={!!payError}>Confirmar baixa</Button></div></form>}</Modal>
    <Modal title="Histórico de baixas" size="lg" open={!!history} onClose={() => !pending && setHistoryId('')}>{history && <div className="stack"><p><strong>{history.description}</strong> · <Badge>{statusOf(history)}</Badge></p><p>Original {money(history.amount)} · Pago {money(entryPaid(history))} · Saldo {money(entryBalance(history))} · Vencimento {date(history.dueDate)}</p>{history.settlements.length ? <ul className="timeline">{history.settlements.map(item => <li key={item.id} className="card"><strong>{money(item.amount)}</strong> · {item.method} · {date(item.date)} · {item.user}{item.note && <> · {item.note}</>}{item.reversedAt ? <p><Badge>Estornada</Badge> {date(item.reversedAt)} por {item.reversedBy}: {item.reversalReason}</p> : <p><button className="btn" disabled={pending || history.cancelled} onClick={() => void reverse(item.id)}><Undo2 size={16} aria-hidden="true" /> Estornar baixa</button></p>}</li>)}</ul> : <Empty text="Nenhuma baixa registrada." />}{!history.cancelled && <><TextField label="Motivo (estorno ou cancelamento)" value={actionReason} onChange={setActionReason} /><div className="toolbar"><button className="btn danger" disabled={pending || entryPaid(history) > 0} onClick={() => void cancel()}><Ban size={16} aria-hidden="true" /> Cancelar lançamento</button></div>{entryPaid(history) > 0 && <p className="muted">Para cancelar, estorne antes as baixas ativas.</p>}</>}</div>}</Modal>
    <Modal title={{ open: 'Abrir caixa', close: 'Fechar caixa', withdraw: 'Registrar sangria', supply: 'Registrar suprimento' }[cashAction] || 'Caixa'} open={!!cashAction} onClose={() => !pending && setCashAction('')}><form className="stack" onSubmit={cashSubmit}><TextField label={cashAction === 'close' ? 'Dinheiro contado (R$)' : 'Valor (R$)'} inputMode="decimal" required value={cashValue} onChange={setCashValue} error={cashValue && counted === null ? 'Valor inválido.' : undefined} />
      {cashAction === 'close' && cash && <div className="grid grid-3" role="status" aria-live="polite" data-tour="cash-difference"><Stat label="Esperado" value={money(expected)} tone="blue" /><Stat label="Contado" value={counted === null ? '—' : money(counted)} tone="purple" /><Stat label="Diferença" value={money(difference)} hint={difference > 0 ? 'Sobra no caixa' : difference < 0 ? 'Falta no caixa' : 'Caixa confere'} tone={difference ? 'red' : 'green'} /></div>}
      {['withdraw', 'supply'].includes(cashAction) && <TextField label="Motivo" required value={reason} onChange={setReason} />}
      {cashAction === 'close' && <TextField label="Motivo da diferença" required={difference !== 0} value={reason} onChange={setReason} hint={difference ? 'Obrigatório quando há diferença.' : 'Opcional quando o caixa confere.'} />}
      <FormActions pending={pending} onClose={() => setCashAction('')} label="Confirmar" /></form></Modal></div>;
}
