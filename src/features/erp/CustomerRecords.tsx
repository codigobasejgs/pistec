import { useState, type FormEvent } from 'react';
import { Edit, Eye, Plus, Trash2 } from 'lucide-react';
import { uid, money, date } from '../../lib';
import { Badge, DataTable, Empty, Modal, PageHeader, Panel } from '../../ui';
import type { Customer } from '../../types';
import { matches } from './logic';
import { ExportButton, FormActions, SearchBox, SelectField, TextField, useErp, useSearchQuery } from './shared';
import { rpc } from '../../store';

export default function CustomerRecords() {
  const { state, session, run, pending, notice, download, allowed } = useErp('clientes');
  const [query, setQuery] = useSearchQuery(), [consent, setConsent] = useState('');
  const [edit, setEdit] = useState<Customer | null>(null), [detailId, setDetailId] = useState('');
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const rows = customers.filter(customer => matches(query, customer.name, customer.document, customer.email, customer.phone) && (!consent || customer.consent === (consent === 'yes')));
  const detail = customers.find(customer => customer.id === detailId);
  function set(key: keyof Customer, value: string | boolean) { setEdit(current => current ? { ...current, [key]: value } : current); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!edit) return;
    if (!edit.name.trim() || !edit.phone.trim()) { notice('Nome e telefone são obrigatórios.'); return; }
    if (await run(draft => {
      if (edit.document && draft.customers.some(customer => customer.tenantId === session.tenantId && customer.document.replace(/\D/g, '') === edit.document.replace(/\D/g, '') && customer.id !== edit.id)) throw new Error('Documento já cadastrado.');
      const index = draft.customers.findIndex(customer => customer.id === edit.id && customer.tenantId === session.tenantId);
      const customer = { ...edit, name: edit.name.trim(), phone: edit.phone.trim() };
      if (index >= 0) draft.customers[index] = customer; else draft.customers.push(customer);
      draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `${index < 0 ? 'Cadastro' : 'Edição'} de cliente ${customer.name}; consentimento WhatsApp: ${customer.consent ? 'sim' : 'não'}` });
    }, 'Cliente salvo.', customers.some(customer => customer.id === edit.id) ? 'editar' : 'cadastrar', rpc('save_customer', { p_tenant: session.tenantId, p: edit }))) setEdit(null);
  }
  async function remove(customer: Customer) {
    if (!window.confirm(`Excluir ${customer.name}? A exclusão será bloqueada se houver histórico relacionado.`)) return;
    await run(draft => {
      if (draft.sales.some(sale => sale.tenantId === session.tenantId && sale.customerId === customer.id) || draft.records.some(record => record.tenantId === session.tenantId && record.customerId === customer.id)) throw new Error('Cliente possui histórico. Preserve o cadastro e registre a restrição nas notas.');
      draft.customers = draft.customers.filter(row => row.id !== customer.id || row.tenantId !== session.tenantId);
    }, 'Cliente excluído.', 'excluir', rpc('delete_customer', { p_tenant: session.tenantId, p_id: customer.id }));
  }
  return <div className="page stack"><PageHeader title="Clientes" subtitle="Relacionamento, veículos e consentimento de contato."><ExportButton onClick={() => download('clientes', rows.map(customer => ({ nome: customer.name, documento: customer.document, email: customer.email, telefone: customer.phone, endereco: customer.address, consentimento: customer.consent, notas: customer.notes })))} /><button className="btn primary" disabled={!allowed('cadastrar')} onClick={() => setEdit({ id: uid(), tenantId: session.tenantId, name: '', document: '', email: '', phone: '', address: '', consent: false, notes: '' })}><Plus size={16} aria-hidden="true" /> Novo cliente</button></PageHeader><Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Nome, documento, telefone ou e-mail" /><SelectField label="Consentimento WhatsApp" value={consent} onChange={setConsent}><option value="">Todos</option><option value="yes">Autorizado</option><option value="no">Não autorizado</option></SelectField></div>{rows.length ? <DataTable rows={rows} columns={[{ key: 'name', label: 'Nome' }, { key: 'document', label: 'Documento' }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail' }, { key: 'consent', label: 'WhatsApp', render: (customer: Customer) => <Badge>{customer.consent ? 'Autorizado' : 'Sem consentimento'}</Badge> }, { key: 'actions', label: 'Ações', render: (customer: Customer) => <div className="toolbar"><button className="btn ghost" aria-label={`Detalhes de ${customer.name}`} onClick={() => setDetailId(customer.id)}><Eye size={16} /></button><button className="btn ghost" aria-label={`Editar ${customer.name}`} disabled={pending || !allowed('editar')} onClick={() => setEdit({ ...customer })}><Edit size={16} /></button><button className="btn danger" aria-label={`Excluir ${customer.name}`} disabled={pending || !allowed('excluir')} onClick={() => void remove(customer)}><Trash2 size={16} /></button></div> }]} /> : <Empty text="Nenhum cliente encontrado. Cadastre o primeiro cliente ou ajuste a busca." />}</Panel><Modal title="Cadastro de cliente" open={!!edit} onClose={() => !pending && setEdit(null)}>{edit && <form className="stack" onSubmit={save}><div className="form-grid"><TextField label="Nome / razão social" value={edit.name} required onChange={value => set('name', value)} /><TextField label="CPF / CNPJ" value={edit.document} onChange={value => set('document', value)} /><TextField label="Telefone" type="tel" value={edit.phone} required onChange={value => set('phone', value)} /><TextField label="E-mail" type="email" value={edit.email} onChange={value => set('email', value)} /><TextField label="Endereço" value={edit.address} onChange={value => set('address', value)} /></div><label>Notas<textarea aria-label="Notas do cliente" value={edit.notes} onChange={event => set('notes', event.target.value)} /></label><label><input type="checkbox" checked={edit.consent} onChange={event => set('consent', event.target.checked)} /> Cliente autorizou mensagens via WhatsApp</label><p className="muted">Registre nas notas a origem e a data da autorização. É possível revogar a qualquer momento.</p><FormActions pending={pending} onClose={() => setEdit(null)} /></form>}</Modal><Modal title="Histórico do cliente" open={!!detail} onClose={() => setDetailId('')}>{detail && <div className="stack"><h3>{detail.name}</h3><p>{detail.document} · {detail.phone} · {detail.email}</p><p>{detail.address}</p><Badge>{detail.consent ? 'WhatsApp autorizado' : 'Sem consentimento WhatsApp'}</Badge><p>{detail.notes || 'Sem notas.'}</p><h4>Veículos e atendimentos</h4>{state.records.filter(record => record.tenantId === session.tenantId && record.customerId === detail.id).map(record => <p key={record.id}>{date(record.date)} · {record.title} · {record.status}</p>)}<h4>Compras</h4>{state.sales.filter(sale => sale.tenantId === session.tenantId && sale.customerId === detail.id).map(sale => <p key={sale.id}>{date(sale.date)} · {sale.id.slice(0, 8)} · {money(sale.total)} · {sale.status}</p>)}</div>}</Modal></div>;
}
