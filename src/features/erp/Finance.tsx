import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowDownCircle, Banknote, Check, Edit, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import { openCash, closeCash } from '../../domain';
import { date, money, today, uid } from '../../lib';
import { Badge, DataTable, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { FinancialEntry } from '../../types';
import { cashExpected, cents, decimal, inPeriod, matches } from './logic';
import { ExportButton, FormActions, SearchBox, SelectField, TextField, useErp } from './shared';

export default function Finance() {
  const route = useLocation().pathname.split('/').at(-1);
  const cashOnly = route === 'caixa';
  const { state, session, pending, run, notice, download } = useErp(cashOnly ? 'caixa' : 'financeiro');
  const [query, setQuery] = useState(''), [type, setType] = useState(route === 'contas-pagar' ? 'Despesa' : route === 'contas-receber' ? 'Receita' : ''), [status, setStatus] = useState(route?.startsWith('contas-') ? 'open' : ''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [tab, setTab] = useState(cashOnly ? 'cash' : 'entries');
  const [edit, setEdit] = useState<FinancialEntry | null>(null), [cashAction, setCashAction] = useState(''), [cashValue, setCashValue] = useState('0'), [reason, setReason] = useState(''), [pay, setPay] = useState<FinancialEntry | null>(null), [method, setMethod] = useState('Pix');
  const entries = state.finances.filter(entry => !cashOnly && entry.tenantId === session.tenantId && entry.branchId === session.branchId);
  const rows = entries.filter(entry => matches(query, entry.description, entry.category, entry.reference) && (!type || entry.type === type) && (!status || (status === 'paid' ? entry.paid : status === 'overdue' ? !entry.paid && entry.dueDate < today() : !entry.paid)) && inPeriod(entry.dueDate, start, end));
  const registers = state.cashRegisters.filter(register => register.tenantId === session.tenantId && register.branchId === session.branchId);
  const cash = registers.find(register => !register.closedAt);
  const newEntry = (): FinancialEntry => ({ id: uid(), tenantId: session.tenantId, branchId: session.branchId, type: type === 'Despesa' ? 'Despesa' : 'Receita', category: '', description: '', amount: 0, dueDate: today(), paid: false, reference: '', date: new Date().toISOString() });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edit) return;
    try {
      const amount = cents(String(new FormData(event.currentTarget).get('amount')));
      if (amount <= 0 || !edit.description.trim() || !edit.category.trim()) throw new Error('Descrição, categoria e valor maior que zero são obrigatórios.');
      if (await run(draft => {
        const index = draft.finances.findIndex(entry => entry.id === edit.id && entry.tenantId === session.tenantId);
        if (index >= 0 && (draft.finances[index].paid || draft.finances[index].reference)) throw new Error('Lançamento quitado ou vinculado não pode ser editado.');
        const entry = { ...edit, amount, description: edit.description.trim(), category: edit.category.trim() };
        if (index >= 0) draft.finances[index] = entry; else draft.finances.push(entry);
      }, 'Lançamento salvo.', entries.some(entry => entry.id === edit.id) ? 'editar' : 'cadastrar')) setEdit(null);
    } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); }
  }
  async function settle(event: FormEvent) {
    event.preventDefault(); if (!pay) return;
    if (await run(draft => {
      const entry = draft.finances.find(row => row.id === pay.id && row.tenantId === session.tenantId && row.branchId === session.branchId);
      if (!entry || entry.paid) throw new Error('Lançamento já quitado ou indisponível.');
      if (method === 'Dinheiro') {
        const register = draft.cashRegisters.find(row => row.tenantId === session.tenantId && row.branchId === session.branchId && !row.closedAt);
        if (!register) throw new Error('Abra o caixa para registrar pagamento em dinheiro.');
        const amount = entry.type === 'Receita' ? entry.amount : -entry.amount;
        if (cashExpected(register) + amount < 0) throw new Error('Saldo de caixa insuficiente.');
        register.movements.push({ id: uid(), amount, reason: `Quitação ${entry.id}: ${entry.description}`, date: new Date().toISOString() });
      }
      entry.paid = true;
      draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `Quitação ${entry.id} via ${method} por ${session.name}` });
    }, pay.type === 'Receita' ? 'Recebimento registrado.' : 'Pagamento registrado.')) setPay(null);
  }
  async function cashSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const amount = cents(cashValue);
      if ((cashAction === 'withdraw' || cashAction === 'supply') && (!reason.trim() || amount <= 0)) throw new Error('Informe motivo e valor maior que zero.');
      if (cashAction === 'close' && !window.confirm(`Fechar o caixa com contagem de ${money(amount)}? O fechamento é definitivo.`)) return;
      if (await run(draft => {
        if (cashAction === 'open') openCash(draft, session.tenantId, session.branchId, amount);
        else {
          const register = draft.cashRegisters.find(row => row.id === cash?.id && row.tenantId === session.tenantId && !row.closedAt);
          if (!register) throw new Error('O caixa não está mais aberto.');
          if (cashAction === 'close') closeCash(draft, session.tenantId, register.id, amount);
          else {
            const movement = cashAction === 'withdraw' ? -amount : amount;
            if (cashExpected(register) + movement < 0) throw new Error('Saldo insuficiente para sangria.');
            register.movements.push({ id: uid(), amount: movement, reason: `${cashAction === 'withdraw' ? 'Sangria' : 'Suprimento'}: ${reason.trim()}`, date: new Date().toISOString() });
            draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `${cashAction === 'withdraw' ? 'Sangria' : 'Suprimento'} ${money(amount)}: ${reason.trim()}` });
          }
        }
      }, 'Caixa atualizado.')) { setCashAction(''); setCashValue('0'); setReason(''); }
    } catch (error) { notice(error instanceof Error ? error.message : 'Valor inválido.'); }
  }
  const set = (key: keyof FinancialEntry, value: string) => setEdit(current => current ? { ...current, [key]: value } : current);
  const income = rows.filter(entry => entry.type === 'Receita').reduce((sum, entry) => sum + entry.amount, 0);
  const expense = rows.filter(entry => entry.type === 'Despesa').reduce((sum, entry) => sum + entry.amount, 0);
  return <div className="page stack"><PageHeader title="Financeiro" subtitle="Contas a pagar e receber, receitas, despesas e caixa físico."><ExportButton onClick={() => download(cashOnly ? 'caixas' : 'financeiro', cashOnly ? registers.map(register => ({ abertura: register.openedAt, fechamento: register.closedAt || '', fundo: decimal(register.opening), esperado: decimal(cashExpected(register)), contado: register.counted === undefined ? '' : decimal(register.counted), diferenca: register.counted === undefined ? '' : decimal(register.counted - cashExpected(register)) })) : rows.map(entry => ({ descricao: entry.description, tipo: entry.type, categoria: entry.category, valor: decimal(entry.amount), vencimento: entry.dueDate, quitado: entry.paid, referencia: entry.reference })))} />{!cashOnly && <button className="btn primary" onClick={() => setEdit(newEntry())}><Plus size={16} aria-hidden="true" /> Novo lançamento</button>}</PageHeader><div className="grid grid-4"><Stat label="Receitas filtradas" value={money(income)} /><Stat label="Despesas filtradas" value={money(expense)} /><Stat label="Resultado filtrado" value={money(income - expense)} /><Stat label="Caixa físico atual" value={cash ? money(cashExpected(cash)) : 'Fechado'} icon={<Banknote size={20} />} /></div><div className="tabs">{!cashOnly && <button className={`btn ${tab === 'entries' ? 'primary' : ''}`} aria-pressed={tab === 'entries'} onClick={() => setTab('entries')}>Lançamentos</button>}<button className={`btn ${tab === 'cash' ? 'primary' : ''}`} aria-pressed={tab === 'cash'} onClick={() => setTab('cash')}>Caixa e histórico</button></div>{tab === 'entries' ? <Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} /><SelectField label="Tipo" value={type} onChange={setType}><option value="">Todos</option><option value="Receita">Receitas / receber</option><option value="Despesa">Despesas / pagar</option></SelectField><SelectField label="Situação" value={status} onChange={setStatus}><option value="">Todas</option><option value="open">Em aberto</option><option value="paid">Quitadas</option><option value="overdue">Vencidas</option></SelectField><TextField label="Vencimento de" type="date" value={start} onChange={setStart} /><TextField label="Vencimento até" type="date" value={end} onChange={setEnd} /></div>{rows.length ? <DataTable rows={rows} columns={[{ key: 'description', label: 'Descrição' }, { key: 'type', label: 'Tipo' }, { key: 'category', label: 'Categoria' }, { key: 'amount', label: 'Valor', render: (entry: FinancialEntry) => money(entry.amount) }, { key: 'dueDate', label: 'Vencimento', render: (entry: FinancialEntry) => date(entry.dueDate) }, { key: 'paid', label: 'Situação', render: (entry: FinancialEntry) => <Badge>{entry.paid ? 'Quitada' : entry.dueDate < today() ? 'Vencida' : 'Em aberto'}</Badge> }, { key: 'actions', label: 'Ações', render: (entry: FinancialEntry) => <div className="toolbar"><button className="btn" disabled={pending || entry.paid} onClick={() => { setPay(entry); setMethod('Pix'); }}><Check size={16} aria-hidden="true" /> {entry.type === 'Receita' ? 'Receber' : 'Pagar'}</button><button className="btn ghost" aria-label={`Editar ${entry.description}`} disabled={pending || entry.paid || !!entry.reference} onClick={() => setEdit({ ...entry })}><Edit size={16} /></button><button className="btn danger" aria-label={`Excluir ${entry.description}`} disabled={pending || entry.paid || !!entry.reference} onClick={() => { if (window.confirm('Excluir lançamento em aberto sem vínculo?')) void run(draft => { const current = draft.finances.find(row => row.id === entry.id && row.tenantId === session.tenantId); if (!current || current.paid || current.reference) throw new Error('Lançamento protegido.'); draft.finances = draft.finances.filter(row => row.id !== entry.id || row.tenantId !== session.tenantId); }, 'Lançamento excluído.', 'excluir'); }}><Trash2 size={16} /></button></div> }]} /> : <Empty text="Nenhum lançamento encontrado. Crie um lançamento ou ajuste os filtros." />}</Panel> : <div className="stack"><Panel title="Caixa da filial"><div className="toolbar">{cash ? <><button className="btn" disabled={pending} onClick={() => { setCashAction('withdraw'); setCashValue('0'); }}><ArrowDownCircle size={16} aria-hidden="true" /> Sangria</button><button className="btn" disabled={pending} onClick={() => { setCashAction('supply'); setCashValue('0'); }}><Plus size={16} aria-hidden="true" /> Suprimento</button><button className="btn danger" disabled={pending} onClick={() => { setCashAction('close'); setCashValue(decimal(cashExpected(cash))); }}><Lock size={16} aria-hidden="true" /> Fechar caixa</button></> : <button className="btn primary" onClick={() => { setCashAction('open'); setCashValue('0'); }}><Unlock size={16} aria-hidden="true" /> Abrir caixa</button>}</div>{cash ? <><p>Abertura: {date(cash.openedAt)} · Fundo: {money(cash.opening)} · Esperado: {money(cashExpected(cash))}</p><DataTable rows={cash.movements} columns={[{ key: 'date', label: 'Data', render: (movement: typeof cash.movements[number]) => date(movement.date) }, { key: 'reason', label: 'Motivo' }, { key: 'amount', label: 'Valor', render: (movement: typeof cash.movements[number]) => money(movement.amount) }]} /></> : <Empty text="Caixa fechado. Abra um caixa para operar vendas em dinheiro." />}<p className="muted">Sangria e suprimento movimentam somente o caixa físico, não representam receita ou despesa. Pix e cartões não entram no saldo físico.</p></Panel><Panel title="Fechamentos">{registers.filter(register => register.closedAt).length ? registers.filter(register => register.closedAt).slice().reverse().map(register => <details key={register.id} className="card"><summary>{date(register.openedAt)} a {date(register.closedAt || '')} · Contado {money(register.counted ?? 0)} · Diferença {money((register.counted ?? 0) - cashExpected(register))}</summary><p>Fundo {money(register.opening)} · Esperado {money(cashExpected(register))}</p>{register.movements.map(movement => <p key={movement.id}>{date(movement.date)} · {movement.reason} · {money(movement.amount)}</p>)}</details>) : <Empty text="Ainda não há fechamentos nesta filial." />}</Panel></div>}<Modal title="Lançamento financeiro" open={!!edit} onClose={() => !pending && setEdit(null)}>{edit && <form className="stack" onSubmit={save}><SelectField label="Tipo" value={edit.type} onChange={value => set('type', value)}><option>Receita</option><option>Despesa</option></SelectField><TextField label="Descrição" required value={edit.description} onChange={value => set('description', value)} /><TextField label="Categoria" required value={edit.category} onChange={value => set('category', value)} /><label>Valor (R$)<input name="amount" aria-label="Valor (R$)" required inputMode="decimal" defaultValue={decimal(edit.amount)} /></label><TextField label="Vencimento" type="date" required value={edit.dueDate} onChange={value => set('dueDate', value)} /><p className="muted">O lançamento será criado em aberto; use Pagar/Receber para quitá-lo.</p><FormActions pending={pending} onClose={() => setEdit(null)} /></form>}</Modal><Modal title={pay?.type === 'Receita' ? 'Registrar recebimento' : 'Registrar pagamento'} open={!!pay} onClose={() => !pending && setPay(null)}>{pay && <form className="stack" onSubmit={settle}><p>{pay.description} · {money(pay.amount)}</p><SelectField label="Forma de liquidação" value={method} onChange={setMethod}>{['Pix', 'Dinheiro', 'Transferência', 'Crédito', 'Débito'].map(value => <option key={value}>{value}</option>)}</SelectField><p className="muted">Liquidação integral. Dinheiro atualiza o caixa físico; demais formas registram apenas a quitação financeira.</p><FormActions pending={pending} onClose={() => setPay(null)} label="Confirmar quitação" /></form>}</Modal><Modal title={{ open: 'Abrir caixa', close: 'Fechar caixa', withdraw: 'Registrar sangria', supply: 'Registrar suprimento' }[cashAction] || 'Caixa'} open={!!cashAction} onClose={() => !pending && setCashAction('')}><form className="stack" onSubmit={cashSubmit}><TextField label={cashAction === 'close' ? 'Dinheiro contado (R$)' : 'Valor (R$)'} required value={cashValue} onChange={setCashValue} />{['withdraw', 'supply'].includes(cashAction) && <TextField label="Motivo" required value={reason} onChange={setReason} />}{cashAction === 'close' && cash && <p>Saldo esperado: {money(cashExpected(cash))}. A diferença será preservada no histórico.</p>}<FormActions pending={pending} onClose={() => setCashAction('')} label="Confirmar" /></form></Modal></div>;
}
