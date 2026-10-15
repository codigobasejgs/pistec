import { useState, type FormEvent } from 'react';
import { ArrowLeft, Forward, MessageSquare, Phone, Plus, Send, Smartphone, StickyNote, Tag, User, Wrench, X } from 'lucide-react';
import { date, money, uid } from '../../lib';
import { Badge, Button, Empty, Modal, PageHeader, Panel } from '../../ui';
import type { OperationalRecord } from '../../types';
import { matches } from './logic';
import { ExportButton, FormActions, SearchBox, SelectField, TextField, useErp } from './shared';

const QUICK_REPLIES = [
  'Olá! Seu veículo já está em diagnóstico. Logo passamos o orçamento.',
  'Informamos que as peças já chegaram e o serviço foi iniciado.',
  'Sua ordem de serviço está concluída e o veículo pronto para retirada!',
  'Agradecemos a preferência! Como foi sua experiência conosco?',
];

export default function WhatsApp() {
  const { state, session, run, pending, notice, download } = useErp('whatsapp');
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(''), [body, setBody] = useState(''), [messageType, setMessageType] = useState<'outbound' | 'inbound' | 'note'>('outbound'), [instanceId, setInstanceId] = useState(''), [tab, setTab] = useState<'conversations' | 'instances'>('conversations');
  const [statusFilter, setStatusFilter] = useState(''), [tagFilter, setTagFilter] = useState('');
  const [newConversation, setNewConversation] = useState(false), [customerId, setCustomerId] = useState(''), [newInstance, setNewInstance] = useState(false), [instanceName, setInstanceName] = useState(''), [phone, setPhone] = useState('');
  const [transferModal, setTransferModal] = useState(false), [transferTo, setTransferTo] = useState('');
  const [tagModal, setTagModal] = useState(false), [tagInput, setTagInput] = useState('');

  const records = state.records.filter(record => record.tenantId === session.tenantId);
  const customers = state.customers.filter(customer => customer.tenantId === session.tenantId);
  const conversations = records.filter(record => record.kind === 'whatsapp' && record.branchId === session.branchId);
  const instances = records.filter(record => record.kind === 'instancias');
  const employees = records.filter(record => record.kind === 'funcionarios' && record.status !== 'Inativo');

  const current = conversations.find(record => record.id === selected);
  const customer = customers.find(row => row.id === current?.customerId);
  const messages = records.filter(record => record.kind === 'mensagens' && record.fields.conversationId === selected).slice().sort((a, b) => a.date.localeCompare(b.date));

  // Vínculos com o cliente da conversa ativa
  const customerOs = customer ? records.filter(r => r.kind === 'ordens-servico' && r.customerId === customer.id) : [];
  const customerQuotes = customer ? records.filter(r => r.kind === 'orcamentos' && r.customerId === customer.id) : [];
  const customerVehicles = customer ? records.filter(r => r.kind === 'veiculos' && r.customerId === customer.id) : [];

  const allTags = [...new Set(conversations.flatMap(c => (c.fields.tags || '').split(',').map(t => t.trim()).filter(Boolean)))];

  const filteredConversations = conversations.filter(record => {
    const tags = (record.fields.tags || '').split(',').map(t => t.trim());
    return matches(query, record.title, record.fields.lastMessage, record.fields.assignedTo, record.fields.tags)
      && (!statusFilter || record.status === statusFilter)
      && (!tagFilter || tags.includes(tagFilter));
  });

  const make = (kind: string, title: string, status: string, fields: Record<string, string>, id = uid()): OperationalRecord => ({ id, tenantId: session.tenantId, branchId: session.branchId, kind, title, status, customerId: '', date: new Date().toISOString(), amount: 0, fields, items: [], history: [] });

  async function createConversation(event: FormEvent) {
    event.preventDefault();
    const existing = conversations.find(record => record.customerId === customerId);
    if (existing) { setSelected(existing.id); setNewConversation(false); return; }
    const id = uid();
    if (await run(draft => {
      const person = draft.customers.find(row => row.id === customerId && row.tenantId === session.tenantId);
      if (!person) throw new Error('Selecione um cliente válido.');
      draft.records.push({ ...make('whatsapp', person.name, 'Aberta', { assignedTo: session.name, tags: 'Novo' }, id), customerId });
    }, 'Conversa local criada.', 'cadastrar')) { setSelected(id); setNewConversation(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault(); if (!current || !body.trim()) return;
    if (body.length > 4000) { notice('Limite de 4.000 caracteres por mensagem.'); return; }
    if (await run(draft => {
      const conversation = draft.records.find(record => record.id === current.id && record.tenantId === session.tenantId && record.kind === 'whatsapp');
      if (!conversation || conversation.status === 'Resolvida') throw new Error('Reabra a conversa para adicionar mensagens.');
      const person = draft.customers.find(row => row.id === conversation.customerId && row.tenantId === session.tenantId);
      if (messageType === 'outbound') {
        if (!person?.consent) throw new Error('Cliente não autorizou mensagens. Registre o consentimento antes de enviar.');
        const instance = draft.records.find(record => record.id === instanceId && record.tenantId === session.tenantId && record.kind === 'instancias');
        if (instance?.status !== 'Conectada') throw new Error('Selecione uma instância simulada conectada.');
      }
      const message = { ...make('mensagens', body.trim(), messageType === 'note' ? 'Nota interna' : 'Simulada', { conversationId: current.id, direction: messageType, body: body.trim(), instanceId: messageType === 'outbound' ? instanceId : '', author: session.name, simulated: 'true' }), customerId: conversation.customerId };
      draft.records.push(message);
      conversation.history.push({ date: message.date, text: messageType === 'note' ? `Nota interna por ${session.name}` : `${messageType === 'inbound' ? 'Recebimento' : 'Envio'} simulado por ${session.name}` });
      conversation.fields.lastMessage = body.trim();
    }, messageType === 'note' ? 'Nota interna salva.' : 'Mensagem simulada registrada. Nenhum envio externo.', 'cadastrar')) setBody('');
  }

  async function consent() {
    if (!customer) return;
    if (!window.confirm(customer.consent ? 'Revogar consentimento de mensagens deste cliente?' : 'Confirma que o cliente autorizou mensagens e que a autorização está documentada nas notas do cadastro?')) return;
    await run(draft => {
      const person = draft.customers.find(row => row.id === customer.id && row.tenantId === session.tenantId);
      if (!person) throw new Error('Cliente não encontrado.');
      person.consent = !person.consent;
      person.notes += `\n${new Date().toISOString()} · Consentimento ${person.consent ? 'registrado' : 'revogado'} por ${session.name}.`;
      draft.audit.push({ id: uid(), tenantId: session.tenantId, date: new Date().toISOString(), action: `Consentimento WhatsApp ${person.consent ? 'registrado' : 'revogado'}: ${person.name}` });
    }, 'Consentimento atualizado.');
  }

  async function transfer() {
    if (!current || !transferTo) return;
    if (await run(draft => {
      const conv = draft.records.find(r => r.id === current.id && r.tenantId === session.tenantId);
      if (!conv) throw new Error('Conversa indisponível.');
      conv.fields.assignedTo = transferTo;
      conv.history.push({ date: new Date().toISOString(), text: `Atendimento transferido para ${transferTo} por ${session.name}` });
    }, `Atendimento transferido para ${transferTo}.`)) setTransferModal(false);
  }

  async function addTag() {
    if (!current || !tagInput.trim()) return;
    const clean = tagInput.trim().replace(/,/g, '');
    const currentTags = (current.fields.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (currentTags.includes(clean)) { notice('Tag já associada.'); return; }
    const updated = [...currentTags, clean].join(',');
    if (await run(draft => {
      const conv = draft.records.find(r => r.id === current.id && r.tenantId === session.tenantId);
      if (!conv) throw new Error('Conversa indisponível.');
      conv.fields.tags = updated;
    }, 'Etiqueta adicionada.')) { setTagInput(''); setTagModal(false); }
  }

  async function removeTag(tagToRemove: string) {
    if (!current) return;
    const currentTags = (current.fields.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const updated = currentTags.filter(t => t !== tagToRemove).join(',');
    await run(draft => {
      const conv = draft.records.find(r => r.id === current.id && r.tenantId === session.tenantId);
      if (!conv) throw new Error('Conversa indisponível.');
      conv.fields.tags = updated;
    }, 'Etiqueta removida.');
  }

  const tagsOf = (conv: OperationalRecord) => (conv.fields.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  return <div className="page stack"><PageHeader title="WhatsApp" subtitle="Central simulada de atendimento ao cliente, orçamentos e ordens de serviço."><ExportButton tour="whatsapp-export" onClick={() => download('conversas-whatsapp', conversations.map(record => ({ cliente: record.title, status: record.status, responsavel: record.fields.assignedTo || '', etiquetas: record.fields.tags || '', inicio: record.date, ultimaMensagem: record.fields.lastMessage || '' })))} /><button className="btn primary" data-tour="whatsapp-new" onClick={() => setNewConversation(true)}><Plus size={16} aria-hidden="true" /> Nova conversa</button></PageHeader>
    <div className="demo-pill" role="status" aria-label="Aviso de simulação"><i></i> Ambiente de simulação local: nenhum dado ou mensagem trafega pela rede nem chega ao celular de clientes.</div>

    <div className="tabs">
      <button type="button" className={`btn ${tab === 'conversations' ? 'primary' : ''}`} aria-pressed={tab === 'conversations'} onClick={() => setTab('conversations')}><MessageSquare size={16} aria-hidden="true" /> Conversas ({conversations.length})</button>
      <button type="button" className={`btn ${tab === 'instances' ? 'primary' : ''}`} aria-pressed={tab === 'instances'} onClick={() => setTab('instances')}><Smartphone size={16} aria-hidden="true" /> Instâncias simuladas ({instances.length})</button>
    </div>

    {tab === 'instances' ? <Panel title="Conexões locais"><div className="toolbar"><button className="btn primary" onClick={() => setNewInstance(true)}><Plus size={16} aria-hidden="true" /> Nova instância</button></div>{instances.length ? instances.map(instance => <article className="card stack" key={instance.id}><strong>{instance.title}</strong><span>{instance.fields.phone}</span><Badge>{instance.status} · Simulação</Badge><button className="btn" disabled={pending} onClick={() => void run(draft => { const row = draft.records.find(record => record.id === instance.id && record.tenantId === session.tenantId); if (!row) throw new Error('Instância não encontrada.'); row.status = row.status === 'Conectada' ? 'Desconectada' : 'Conectada'; row.history.push({ date: new Date().toISOString(), text: `${row.status} em simulação por ${session.name}` }); }, 'Estado simulado atualizado.', 'configurar')}>{instance.status === 'Conectada' ? 'Desconectar simulação' : 'Conectar simulação'}</button><details><summary>Histórico da instância</summary>{instance.history.map((entry, index) => <p key={index}>{date(entry.date)} · {entry.text}</p>)}</details></article>) : <Empty text="Nenhuma instância. Cadastre uma conexão simulada para testar os atendimentos." />}</Panel>
      : <div className={`chat-layout ${selected ? 'has-selection' : ''}`} data-tour="whatsapp-layout">
        {/* Coluna 1: Lista de conversas */}
        <div className="chat-list" data-tour="whatsapp-list">
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }} className="stack">
            <SearchBox value={query} onChange={setQuery} placeholder="Buscar cliente ou mensagem" tour="whatsapp-search" />
            <div className="toolbar">
              <SelectField label="Status" value={statusFilter} onChange={setStatusFilter}><option value="">Todos</option><option value="Aberta">Aberta</option><option value="Resolvida">Resolvida</option></SelectField>
              {allTags.length > 0 && <SelectField label="Tag" value={tagFilter} onChange={setTagFilter}><option value="">Todas tags</option>{allTags.map(t => <option key={t} value={t}>{t}</option>)}</SelectField>}
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filteredConversations.map(record => {
              const tags = tagsOf(record);
              return <button className={`chat-item ${selected === record.id ? 'active' : ''}`} key={record.id} onClick={() => setSelected(record.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                    <strong>{record.title}</strong>
                    <Badge>{record.status}</Badge>
                  </div>
                  <small className="muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.fields.lastMessage || 'Sem mensagens'}</small>
                  <div className="meta" style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {record.fields.assignedTo && <small className="muted"><User size={10} aria-hidden="true" /> {record.fields.assignedTo}</small>}
                    {tags.map(t => <span key={t} className="badge info" style={{ fontSize: '.68rem', padding: '1px 6px' }}>{t}</span>)}
                  </div>
                </div>
              </button>;
            })}
            {!filteredConversations.length && <Empty text="Nenhuma conversa encontrada." />}
          </div>
        </div>

        {/* Coluna 2: Mensagens e composição */}
        <div className="chat-main">
          {current ? <>
            <div className="toolbar" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
              <div className="toolbar">
                <button type="button" className="btn ghost" aria-label="Voltar para a lista" onClick={() => setSelected('')} style={{ display: 'inline-flex' }}><ArrowLeft size={16} aria-hidden="true" /> Voltar</button>
                <strong>{current.title}</strong>
                <Badge>{current.status}</Badge>
              </div>
              <div className="toolbar">
                <button type="button" className="btn ghost" onClick={() => setTagModal(true)}><Tag size={15} aria-hidden="true" /> Tags</button>
                <button type="button" className="btn ghost" onClick={() => setTransferModal(true)}><Forward size={15} aria-hidden="true" /> Transferir</button>
                <button type="button" className="btn" disabled={pending} onClick={() => void run(draft => {
                  const conversation = draft.records.find(r => r.id === current.id && r.tenantId === session.tenantId);
                  if (!conversation) throw new Error('Conversa indisponível.');
                  conversation.status = conversation.status === 'Resolvida' ? 'Aberta' : 'Resolvida';
                  conversation.history.push({ date: new Date().toISOString(), text: `${conversation.status} por ${session.name}` });
                }, 'Atendimento atualizado.')}>{current.status === 'Resolvida' ? 'Reabrir' : 'Resolver'}</button>
              </div>
            </div>

            <div className="chat-messages" role="log" aria-label="Histórico de mensagens" aria-live="polite">
              {messages.length ? messages.map(msg => {
                const dir = msg.fields.direction || 'outbound';
                const cls = dir === 'note' ? 'note' : dir === 'inbound' ? 'in' : 'out';
                return <article className={`chat-bubble ${cls}`} key={msg.id}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{msg.fields.body || msg.title}</p>
                  <small>{date(msg.date)} · {dir === 'note' ? 'Nota interna' : dir === 'inbound' ? 'Recebida (simulada)' : 'Enviada (simulada)'} · {msg.fields.author || 'Sistema'}</small>
                </article>;
              }) : <Empty text="Nenhuma mensagem. Envie uma mensagem ou nota interna." />}
            </div>

            {/* Respostas rápidas */}
            <div data-tour="whatsapp-quick-replies" style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, overflowX: 'auto' }}>
              {QUICK_REPLIES.map((qr, i) => <button key={i} type="button" className="btn ghost" style={{ fontSize: '.75rem', padding: '3px 8px', whiteSpace: 'nowrap' }} onClick={() => setBody(qr)}>{qr.slice(0, 36)}…</button>)}
            </div>

            <form className="chat-compose" onSubmit={send}>
              <div className="toolbar" data-tour="whatsapp-compose-type">
                <SelectField label="Tipo" value={messageType} onChange={v => setMessageType(v as typeof messageType)}>
                  <option value="outbound">Mensagem enviada (simulada)</option>
                  <option value="inbound">Mensagem recebida (simulada)</option>
                  <option value="note">Nota interna (amarela)</option>
                </SelectField>
                {messageType === 'outbound' && <SelectField label="Instância simulada" required value={instanceId} onChange={setInstanceId}>
                  <option value="">Selecione a conexão</option>
                  {instances.filter(i => i.status === 'Conectada').map(inst => <option key={inst.id} value={inst.id}>{inst.title} ({inst.fields.phone})</option>)}
                </SelectField>}
              </div>
              <label className="field"><span>{messageType === 'note' ? 'Nota interna' : 'Mensagem'}</span><textarea aria-label="Texto da mensagem ou nota" required maxLength={4000} rows={2} value={body} onChange={e => setBody(e.target.value)} placeholder={messageType === 'note' ? 'Escreva uma nota visível apenas para a equipe...' : 'Digite a mensagem para o cliente...'} /></label>
              <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="primary" loading={pending} disabled={current.status === 'Resolvida' || (messageType === 'outbound' && (!customer?.consent || !instanceId))}>
                  {messageType === 'note' ? <StickyNote size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />} {messageType === 'note' ? 'Salvar nota' : 'Registrar simulação'}
                </Button>
              </div>
            </form>
          </> : <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Empty text="Selecione uma conversa à esquerda para visualizar mensagens e histórico." /></div>}
        </div>

        {/* Coluna 3: Painel do cliente e vínculos (OS / Orçamentos) */}
        <aside className="chat-side" data-tour="whatsapp-customer-panel">
          {customer ? <div className="stack">
            <header className="toolbar" style={{ justifyContent: 'space-between' }}>
              <strong>{customer.name}</strong>
              <Badge>{customer.consent ? 'Consentimento ativo' : 'Sem consentimento'}</Badge>
            </header>
            <div className="meta">
              {customer.phone && <span><Phone size={13} aria-hidden="true" /> {customer.phone}</span>}
              {customer.email && <span>{customer.email}</span>}
            </div>
            <button type="button" className="btn" disabled={pending} onClick={() => void consent()}>{customer.consent ? 'Revogar consentimento' : 'Registrar consentimento'}</button>

            {current && <section className="stack">
              <h4>Etiquetas do atendimento</h4>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {tagsOf(current).map(t => <span key={t} className="badge info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{t} <button type="button" aria-label={`Remover tag ${t}`} onClick={() => void removeTag(t)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}><X size={12} /></button></span>)}
                {!tagsOf(current).length && <small className="muted">Nenhuma etiqueta.</small>}
              </div>
            </section>}

            <section className="stack">
              <h4>Ordens de serviço ({customerOs.length})</h4>
              {customerOs.slice(0, 4).map(os => <article key={os.id} className="card" style={{ padding: 8, fontSize: '.8rem' }}>
                <strong>#{os.id.slice(0, 8)} · {os.title}</strong>
                <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <Badge>{os.status}</Badge>
                  <span>{money(os.amount)}</span>
                </div>
              </article>)}
              {!customerOs.length && <small className="muted">Sem ordens vinculadas.</small>}
            </section>

            <section className="stack">
              <h4>Orçamentos ({customerQuotes.length})</h4>
              {customerQuotes.slice(0, 3).map(orc => <article key={orc.id} className="card" style={{ padding: 8, fontSize: '.8rem' }}>
                <strong>{orc.title}</strong>
                <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <Badge>{orc.status}</Badge>
                  <span>{money(orc.amount)}</span>
                </div>
              </article>)}
              {!customerQuotes.length && <small className="muted">Sem orçamentos vinculados.</small>}
            </section>

            {customerVehicles.length > 0 && <section className="stack">
              <h4>Veículos cadastrados</h4>
              {customerVehicles.map(v => <p key={v.id} style={{ fontSize: '.8rem', margin: 0 }}><Wrench size={12} aria-hidden="true" /> {v.title} · {v.fields.plate}</p>)}
            </section>}
          </div> : <Empty text="Selecione uma conversa para ver dados do cliente." />}
        </aside>
      </div>}

    <Modal title="Nova conversa" open={newConversation} onClose={() => !pending && setNewConversation(false)}>
      <form className="stack" onSubmit={createConversation}>
        <SelectField label="Cliente" required value={customerId} onChange={setCustomerId}><option value="">Selecione o cliente</option>{customers.map(p => <option value={p.id} key={p.id}>{p.name} · {p.phone || 'Sem fone'}</option>)}</SelectField>
        <FormActions pending={pending} onClose={() => setNewConversation(false)} label="Abrir conversa" />
      </form>
    </Modal>

    <Modal title="Nova instância simulada" open={newInstance} onClose={() => !pending && setNewInstance(false)}>
      <form className="stack" onSubmit={async event => {
        event.preventDefault();
        if (!instanceName.trim() || phone.replace(/\D/g, '').length < 10) { notice('Informe nome e telefone válido com DDD.'); return; }
        if (await run(draft => {
          const tenant = draft.tenants.find(row => row.id === session.tenantId);
          const plan = draft.plans.find(row => row.id === tenant?.planId);
          if (plan && draft.records.filter(row => row.tenantId === session.tenantId && row.kind === 'instancias').length >= plan.whatsapp) throw new Error('Limite de instâncias do plano atingido.');
          if (draft.records.some(row => row.tenantId === session.tenantId && row.kind === 'instancias' && row.fields.phone?.replace(/\D/g, '') === phone.replace(/\D/g, ''))) throw new Error('Telefone já cadastrado nesta empresa.');
          draft.records.push(make('instancias', instanceName.trim(), 'Desconectada', { phone, simulation: 'true' }));
        }, 'Instância simulada criada.', 'configurar')) { setNewInstance(false); setInstanceName(''); setPhone(''); }
      }}>
        <TextField label="Nome da conexão simulada" required value={instanceName} onChange={setInstanceName} />
        <TextField label="Telefone com DDD" type="tel" required value={phone} onChange={setPhone} />
        <p className="muted">Ambiente simulado: conectar altera apenas o estado local demonstrativo.</p>
        <FormActions pending={pending} onClose={() => setNewInstance(false)} label="Criar instância" />
      </form>
    </Modal>

    <Modal title="Transferir atendimento" open={transferModal} onClose={() => setTransferModal(false)}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void transfer(); }}>
        <p>Transferir o atendimento de <strong>{current?.title}</strong> para outro atendente:</p>
        <SelectField label="Novo responsável" required value={transferTo} onChange={setTransferTo}>
          <option value="">Selecione o colaborador</option>
          {employees.map(e => <option key={e.id} value={e.title}>{e.title} ({e.fields.role})</option>)}
          {!employees.length && <option value={session.name}>{session.name} (Atual)</option>}
        </SelectField>
        <div className="toolbar"><button type="button" className="btn" onClick={() => setTransferModal(false)}>Cancelar</button><button type="submit" className="btn primary">Confirmar transferência</button></div>
      </form>
    </Modal>

    <Modal title="Adicionar etiqueta" open={tagModal} onClose={() => setTagModal(false)}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void addTag(); }}>
        <TextField label="Nome da etiqueta" required value={tagInput} onChange={setTagInput} />
        <div className="toolbar"><button type="button" className="btn" onClick={() => setTagModal(false)}>Cancelar</button><button type="submit" className="btn primary">Adicionar tag</button></div>
      </form>
    </Modal>
  </div>;
}
