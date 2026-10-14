import { useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ArrowRight, Edit, Eye, Plus, Trash2, Play } from 'lucide-react';
import { convertRecord, receivePurchase, transitionRecord } from '../../domain';
import { date, money, today, uid } from '../../lib';
import { Badge, DataTable, Empty, Modal, PageHeader, Panel } from '../../ui';
import type { OperationalRecord } from '../../types';
import CustomerRecords from './CustomerRecords';
import SalesRecords from './SalesRecords';
import { configs } from './record-config';
import { cents, decimal, inPeriod, matches, sumItems } from './logic';
import { ExportButton, FormActions, ItemEditor, SearchBox, SelectField, TextField, useErp, useSearchQuery } from './shared';

export default function Records() {
  const { module } = useParams();
  const location = useLocation();
  const kind = module || location.pathname.split('/').filter(Boolean).at(-1) || '';
  if (kind === 'clientes') return <CustomerRecords />;
  if (kind === 'vendas') return <SalesRecords />;
  return <DomainRecords key={kind} kind={kind} />;
}
function DomainRecords({ kind }: { kind: string }) {
  const { state, session, run, pending, notice, download, allowed } = useErp(kind);
  const config = configs[kind];
  const [query, setQuery] = useSearchQuery(), [status, setStatus] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [view, setView] = useState(config?.kanban ? 'kanban' : 'table');
  const [edit, setEdit] = useState<OperationalRecord | null>(null), [detailId, setDetailId] = useState(''), [note, setNote] = useState('');
  const tenantRecords = state.records.filter(record => record.tenantId === session.tenantId);
  const globalKinds = ['categorias', 'aplicacoes', 'veiculos', 'fornecedores', 'funcionarios', 'filiais', 'automacoes'];
  const storedRecords = tenantRecords.filter(record => record.kind === kind && (globalKinds.includes(kind) || record.branchId === session.branchId));
  const records: OperationalRecord[] = kind === 'filiais' ? [...storedRecords, ...state.branches.filter(branch => branch.tenantId === session.tenantId && !storedRecords.some(record => record.id === branch.id)).map(branch => ({ id: branch.id, tenantId: branch.tenantId, branchId: branch.id, kind: 'filiais', title: branch.name, status: branch.active ? 'Ativa' : 'Inativa', customerId: '', date: today(), amount: 0, fields: {}, items: [], history: [] } satisfies OperationalRecord))] : storedRecords;
  const rows = records.filter(record => matches(query, record.title, record.id, ...Object.values(record.fields), state.customers.find(customer => customer.id === record.customerId)?.name) && (!status || record.status === status) && inPeriod(record.date, start, end));
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const products = state.products.filter(product => product.tenantId === session.tenantId);
  const detail = records.find(record => record.id === detailId);
  const statuses = [...new Set([...(config?.statuses || []), ...records.map(record => record.status)])];
  const readonly = (record: OperationalRecord) => !!record.convertedId || ['Entregue', 'Recebida', 'Cancelada', 'Convertido'].includes(record.status) || ['reserved', 'consumed'].includes(record.fields.stockState);
  if (!config) return <div className="page"><PageHeader title="Módulo não encontrado" /><Empty text="Este endereço não corresponde a um módulo ERP disponível." /></div>;
  function fresh(): OperationalRecord {
    return { id: uid(), tenantId: session.tenantId, branchId: session.branchId, kind, title: '', status: config.statuses[0], customerId: '', date: today(), amount: 0, fields: Object.fromEntries(config.fields.map(field => [field.key, field.type === 'select' ? field.options?.[0] || '' : field.type === 'number' ? '0' : ''])), items: [], history: [] };
  }
  function setField(key: string, value: string) { setEdit(current => current ? { ...current, fields: { ...current.fields, [key]: value } } : current); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edit) return;
    try {
      if (!edit.title.trim()) throw new Error('Informe o título / nome.');
      for (const field of config.fields) {
        if (field.required && !edit.fields[field.key]?.trim()) throw new Error(`${field.label} é obrigatório.`);
        if (field.type === 'number' && edit.fields[field.key] && (!Number.isFinite(Number(edit.fields[field.key])) || Number(edit.fields[field.key]) < 0)) throw new Error(`${field.label} deve ser um número não negativo.`);
      }
      if (config.customer && !edit.customerId) throw new Error('Selecione o cliente.');
      if (edit.items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.price) || item.price < 0)) throw new Error('Revise quantidades e preços dos itens.');
      if (['compras', 'orcamentos', 'ordens-servico'].includes(kind) && !edit.items.length && !(edit.fields.labor && cents(edit.fields.labor) > 0)) throw new Error('Adicione produtos ou um valor de mão de obra.');
      if (kind === 'compras' && !edit.items.length) throw new Error('Adicione os produtos da compra.');
      if (kind === 'aplicacoes' && Number(edit.fields.yearEnd) < Number(edit.fields.yearStart)) throw new Error('Ano final deve ser igual ou posterior ao inicial.');
      if (kind === 'veiculos' && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(edit.fields.plate.replace(/[-\s]/g, '').toUpperCase())) throw new Error('Informe uma placa brasileira válida.');
      const form = new FormData(event.currentTarget);
      const record = { ...edit, title: edit.title.trim(), amount: kind === 'compras' ? edit.items.reduce((sum, item) => sum + item.quantity * item.cost, 0) : config.items ? sumItems(edit.items) + (edit.fields.labor ? cents(edit.fields.labor) : 0) : config.amount ? cents(String(form.get('amount') || '0')) : 0 };
      const exists = records.some(row => row.id === edit.id);
      if (await run(draft => {
        const index = draft.records.findIndex(row => row.id === record.id && row.tenantId === session.tenantId);
        if (index >= 0 && readonly(draft.records[index])) throw new Error('Registro já movimentou estoque ou foi finalizado; edição bloqueada.');
        if (record.customerId && !draft.customers.some(customer => customer.id === record.customerId && customer.tenantId === session.tenantId)) throw new Error('Cliente inválido.');
        if (record.fields.vehicleId && !draft.records.some(vehicle => vehicle.id === record.fields.vehicleId && vehicle.tenantId === session.tenantId && vehicle.kind === 'veiculos' && vehicle.customerId === record.customerId)) throw new Error('O veículo não pertence ao cliente selecionado.');
        if (kind === 'veiculos' && draft.records.some(row => row.tenantId === session.tenantId && row.kind === kind && row.id !== record.id && row.fields.plate?.replace(/[-\s]/g, '').toUpperCase() === record.fields.plate.replace(/[-\s]/g, '').toUpperCase())) throw new Error('Placa já cadastrada.');
        if (kind === 'compras' && !draft.records.some(row => row.id === record.fields.supplierId && row.tenantId === session.tenantId && row.kind === 'fornecedores' && row.status !== 'Inativo')) throw new Error('Fornecedor inválido ou inativo.');
        if (kind === 'garantias' && !draft.sales.some(row => row.id === record.fields.saleId && row.tenantId === session.tenantId && row.customerId === record.customerId && row.status === 'Concluída') && !draft.records.some(row => row.id === record.fields.saleId && row.tenantId === session.tenantId && row.kind === 'ordens-servico' && row.customerId === record.customerId)) throw new Error('Selecione uma venda ou ordem do cliente informado.');
        if (kind === 'funcionarios' && Number(record.fields.commission || 0) > 100) throw new Error('Comissão não pode ultrapassar 100%.');
        const saved = { ...record, history: [...(index >= 0 ? draft.records[index].history : []), { date: new Date().toISOString(), text: `${exists ? 'Atualizado' : 'Criado'} por ${session.name}` }] };
        if (index >= 0) draft.records[index] = saved; else draft.records.push(saved);
        if (kind === 'filiais') {
          const branch = draft.branches.find(row => row.id === record.id && row.tenantId === session.tenantId);
          if (branch) { branch.name = record.title; branch.active = record.status === 'Ativa'; }
          else {
            const tenant = draft.tenants.find(row => row.id === session.tenantId);
            const plan = draft.plans.find(row => row.id === tenant?.planId);
            if (plan && plan.branches > 0 && draft.branches.filter(row => row.tenantId === session.tenantId && row.active).length >= plan.branches) throw new Error('Limite de filiais do plano atingido.');
            draft.branches.push({ id: record.id, tenantId: session.tenantId, name: record.title, active: true });
          }
        }
      }, 'Registro salvo.', exists ? 'editar' : 'cadastrar')) setEdit(null);
    } catch (error) { notice(error instanceof Error ? error.message : 'Registro inválido.'); }
  }
  async function transition(record: OperationalRecord, next: string) {
    if (next === record.status) return;
    if (!window.confirm(`Alterar "${record.title}" de ${record.status} para ${next}?`)) return;
    await run(draft => {
      if (kind === 'filiais' && !draft.records.some(row => row.id === record.id && row.tenantId === session.tenantId)) draft.records.push(structuredClone(record));
      if (kind === 'compras' && next === 'Recebida') receivePurchase(draft, session.tenantId, record.id);
      else if (kind === 'filiais') {
        const row = draft.records.find(item => item.id === record.id && item.tenantId === session.tenantId);
        if (!row) throw new Error('Filial não encontrada.');
        row.status = next;
        row.history.push({ date: new Date().toISOString(), text: `Status: ${next} por ${session.name}` });
      } else transitionRecord(draft, session.tenantId, record.id, next);
      if (kind === 'filiais') {
        const branch = draft.branches.find(row => row.id === record.id && row.tenantId === session.tenantId);
        if (next === 'Inativa' && record.id === session.branchId) throw new Error('Não desative a filial em uso.');
        if (next === 'Inativa' && draft.cashRegisters.some(cash => cash.tenantId === session.tenantId && cash.branchId === record.id && !cash.closedAt)) throw new Error('Feche o caixa da filial antes de desativá-la.');
        if (branch) branch.active = next === 'Ativa';
      }
    }, 'Status atualizado.', next.startsWith('Cancel') ? 'cancelar' : 'editar');
  }
  async function remove(record: OperationalRecord) {
    if (!window.confirm(`Excluir "${record.title}"? Esta ação não pode ser desfeita.`)) return;
    await run(draft => {
      const current = draft.records.find(row => row.id === record.id && row.tenantId === session.tenantId);
      if (!current || readonly(current) || ['ordens-servico', 'compras', 'filiais'].includes(kind)) throw new Error('Registro protegido; utilize a transição de status.');
      if (draft.records.some(row => row.tenantId === session.tenantId && (Object.values(row.fields).includes(record.id) || row.convertedId === record.id))) throw new Error('Registro vinculado a outro atendimento.');
      draft.records = draft.records.filter(row => row.id !== record.id || row.tenantId !== session.tenantId);
    }, 'Registro excluído.', 'excluir');
  }
  async function convert(record: OperationalRecord) {
    const target = kind === 'orcamentos' ? 'ordens-servico' : 'orcamentos';
    if (!window.confirm(`Converter "${record.title}" para ${target === 'ordens-servico' ? 'ordem de serviço' : 'orçamento'}?`)) return;
    await run(draft => convertRecord(draft, session.tenantId, record.id, target), 'Conversão concluída. O vínculo foi preservado.', 'cadastrar');
  }
  async function simulate(record: OperationalRecord) {
    await run(draft => {
      const current = draft.records.find(row => row.id === record.id && row.tenantId === session.tenantId);
      if (!current || current.status !== 'Ativa') throw new Error('Ative a automação antes de simular.');
      const now = new Date().toISOString();
      draft.records.push({ ...fresh(), id: uid(), kind: 'notificacoes', title: `Simulação: ${current.title}`, status: 'Não lida', date: now, fields: { priority: 'Normal', message: current.fields.message, sourceId: current.id, simulation: 'true' }, history: [{ date: now, text: 'Simulação local. Nenhuma mensagem externa enviada.' }] });
      current.history.push({ date: now, text: `Simulação manual por ${session.name}. Notificação local criada; nenhum envio externo.` });
    }, 'Simulação registrada em Notificações. Nenhum envio externo.');
  }
  const actions = (record: OperationalRecord) => <div className="toolbar"><button className="btn ghost" aria-label={`Detalhes de ${record.title}`} onClick={() => setDetailId(record.id)}><Eye size={16} /></button><button className="btn ghost" aria-label={`Editar ${record.title}`} disabled={pending || readonly(record) || !allowed('editar')} onClick={() => setEdit(structuredClone(record))}><Edit size={16} /></button>{['orcamentos', 'crm', 'agenda'].includes(kind) && !record.convertedId && <button className="btn" disabled={pending || (kind === 'orcamentos' && record.status !== 'Aprovado')} onClick={() => void convert(record)}><ArrowRight size={16} aria-hidden="true" /> Converter</button>}{kind === 'automacoes' && <button className="btn" disabled={pending || record.status !== 'Ativa'} onClick={() => void simulate(record)}><Play size={16} aria-hidden="true" /> Simular</button>}{!['ordens-servico', 'compras', 'filiais'].includes(kind) && <button className="btn danger" aria-label={`Excluir ${record.title}`} disabled={pending || readonly(record) || !allowed('excluir')} onClick={() => void remove(record)}><Trash2 size={16} /></button>}</div>;
  const statusSelect = (record: OperationalRecord) => <select aria-label={`Status de ${record.title}`} disabled={pending || !!record.convertedId || ['Entregue', 'Recebida', 'Cancelada'].includes(record.status) || !allowed('editar')} value={record.status} onChange={event => void transition(record, event.target.value)}>{[...new Set([...config.statuses, record.status])].map(value => <option key={value}>{value}</option>)}</select>;
  return <div className="page stack"><PageHeader title={config.title} subtitle={`${rows.length} registros · filial ${state.branches.find(branch => branch.id === session.branchId)?.name || ''}`}><ExportButton onClick={() => download(kind, rows.map(record => ({ id: record.id, titulo: record.title, status: record.status, cliente: customers.find(customer => customer.id === record.customerId)?.name || '', data: record.date, valor: decimal(record.amount), ...Object.fromEntries(Object.entries(record.fields).filter(([key]) => key !== 'stockState')) })))} /><button className="btn primary" disabled={!allowed('cadastrar')} onClick={() => setEdit(fresh())}><Plus size={16} aria-hidden="true" /> Novo registro</button></PageHeader>{kind === 'automacoes' && <p className="muted">Regras armazenadas localmente. Use Simular para registrar uma execução manual; não há agendador nem envio externo.</p>}{kind === 'funcionarios' && <p className="muted">Cadastro operacional local. Não cria credenciais nem concede acesso ao sistema.</p>}<Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} /><SelectField label="Status" value={status} onChange={setStatus}><option value="">Todos</option>{statuses.map(value => <option key={value}>{value}</option>)}</SelectField><TextField label="De" type="date" value={start} onChange={setStart} /><TextField label="Até" type="date" value={end} onChange={setEnd} />{config.kanban && <button className="btn" onClick={() => setView(view === 'table' ? 'kanban' : 'table')}>{view === 'table' ? 'Ver Kanban' : 'Ver tabela'}</button>}</div>{!rows.length ? <Empty text={`Nenhum registro de ${config.title.toLowerCase()} encontrado. Crie um registro ou ajuste os filtros.`} /> : view === 'kanban' ? <div className="grid grid-3">{statuses.filter(value => !status || status === value).map(column => <section className="card stack" key={column} aria-label={column}><h3>{column} <Badge>{rows.filter(row => row.status === column).length}</Badge></h3>{rows.filter(row => row.status === column).map(record => <article className="card stack" key={record.id}><strong>{record.title}</strong><span className="muted">{customers.find(customer => customer.id === record.customerId)?.name || record.fields.responsible || record.fields.technician}</span>{record.amount > 0 && <span>{money(record.amount)}</span>}{statusSelect(record)}{actions(record)}</article>)}</section>)}</div> : <DataTable rows={rows} columns={[{ key: 'title', label: 'Título / nome' }, { key: 'customerId', label: config.customer ? 'Cliente' : 'Responsável', render: (record: OperationalRecord) => config.customer ? customers.find(customer => customer.id === record.customerId)?.name || '—' : record.fields.responsible || record.fields.manager || record.fields.contact || '—' }, { key: 'date', label: 'Data', render: (record: OperationalRecord) => date(record.date) }, ...(config.amount ? [{ key: 'amount', label: 'Valor', render: (record: OperationalRecord) => money(record.amount) }] : []), { key: 'status', label: 'Status', render: statusSelect }, { key: 'actions', label: 'Ações', render: actions }]} />}</Panel><Modal title={`Cadastro de ${config.singular}`} open={!!edit} onClose={() => !pending && setEdit(null)}>{edit && <form className="stack" onSubmit={save}><div className="form-grid"><TextField label="Título / nome" value={edit.title} required onChange={value => setEdit({ ...edit, title: value })} /><TextField label="Data do registro" type="date" value={edit.date.slice(0, 10)} required onChange={value => setEdit({ ...edit, date: value })} />{config.customer && <SelectField label="Cliente" value={edit.customerId} required onChange={value => setEdit({ ...edit, customerId: value, fields: { ...edit.fields, vehicleId: '' } })}><option value="">Selecione</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectField>}{config.vehicle && <SelectField label="Veículo do cliente" value={edit.fields.vehicleId || ''} onChange={value => setField('vehicleId', value)}><option value="">Sem veículo</option>{tenantRecords.filter(record => record.kind === 'veiculos' && record.customerId === edit.customerId).map(record => <option key={record.id} value={record.id}>{record.title} · {record.fields.plate}</option>)}</SelectField>}{config.fields.map(field => field.type === 'textarea' ? <label key={field.key}>{field.label}<textarea aria-label={field.label} required={field.required} value={edit.fields[field.key] || ''} onChange={event => setField(field.key, event.target.value)} /></label> : field.type === 'select' ? <SelectField key={field.key} label={field.label} required={field.required} value={edit.fields[field.key] || ''} onChange={value => setField(field.key, value)}><option value="">Selecione</option>{field.key === 'supplierId' ? tenantRecords.filter(record => record.kind === 'fornecedores' && record.status !== 'Inativo').map(record => <option key={record.id} value={record.id}>{record.title}</option>) : field.key === 'saleId' ? <>{state.sales.filter(sale => sale.tenantId === session.tenantId && sale.customerId === edit.customerId && sale.status === 'Concluída').map(sale => <option key={sale.id} value={sale.id}>Venda {sale.id.slice(0, 8)} · {money(sale.total)}</option>)}{tenantRecords.filter(record => record.kind === 'ordens-servico' && record.customerId === edit.customerId).map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</> : field.options?.map(value => <option key={value}>{value}</option>)}</SelectField> : <TextField key={field.key} label={field.label} type={field.type || 'text'} min={field.type === 'number' ? 0 : undefined} required={field.required} value={edit.fields[field.key] || ''} onChange={value => setField(field.key, value)} />)}{config.amount && !config.items && <label>Valor (R$)<input aria-label="Valor (R$)" name="amount" defaultValue={decimal(edit.amount)} required inputMode="decimal" /></label>}</div>{config.items && <ItemEditor items={edit.items} onChange={items => setEdit(current => current ? { ...current, items } : null)} products={products} cost={kind === 'compras'} />}{config.items && <strong>Subtotal dos itens: {money(sumItems(edit.items))}</strong>}<FormActions pending={pending} onClose={() => setEdit(null)} /></form>}</Modal><Modal title="Detalhes e histórico" open={!!detail} onClose={() => setDetailId('')}>{detail && <div className="stack"><h3>{detail.title}</h3><Badge>{detail.status}</Badge><p>{date(detail.date)} · {customers.find(customer => customer.id === detail.customerId)?.name} · {money(detail.amount)}</p>{config.fields.map(field => <p key={field.key}><strong>{field.label}:</strong> {field.key === 'supplierId' ? tenantRecords.find(record => record.id === detail.fields[field.key])?.title || detail.fields[field.key] : detail.fields[field.key] || '—'}</p>)}{detail.fields.vehicleId && <p>Veículo: {tenantRecords.find(record => record.id === detail.fields.vehicleId)?.title}</p>}{detail.items.length > 0 && <DataTable rows={detail.items.map(item => ({ ...item, id: item.productId }))} columns={[{ key: 'name', label: 'Produto' }, { key: 'quantity', label: 'Quantidade' }, { key: 'price', label: 'Unitário', render: (item: OperationalRecord['items'][number]) => money(item.price) }]} />}{detail.convertedId && <p>Convertido para: {tenantRecords.find(record => record.id === detail.convertedId)?.title || detail.convertedId}</p>}<h4>Histórico</h4>{detail.history.length ? <ol>{detail.history.map((entry, index) => <li key={`${entry.date}-${index}`}>{date(entry.date)} · {entry.text}</li>)}</ol> : <p className="muted">Sem eventos anteriores.</p>}<form className="stack" onSubmit={async event => { event.preventDefault(); if (!note.trim()) return; if (await run(draft => { const current = draft.records.find(record => record.id === detail.id && record.tenantId === session.tenantId); if (!current) { if (kind === 'filiais') { draft.records.push({ ...structuredClone(detail), history: [{ date: new Date().toISOString(), text: `${session.name}: ${note.trim()}` }] }); return; } throw new Error('Registro não encontrado.'); } current.history.push({ date: new Date().toISOString(), text: `${session.name}: ${note.trim()}` }); }, 'Nota adicionada.')) setNote(''); }}><label>Adicionar nota<textarea aria-label="Nota de histórico" required value={note} onChange={event => setNote(event.target.value)} /></label><button className="btn primary" disabled={pending}>Salvar nota</button></form>{actions(detail)}</div>}</Modal></div>;
}
