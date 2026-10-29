import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CheckCircle2, HelpCircle, Phone, XCircle } from 'lucide-react';
import { money, date } from '../../lib';

type Item = { productId: string; name: string; quantity: number; price: number };
type Rec = { id: string; kind: string; title: string; status: string; date: string; amount: number; dueDate?: string; validUntil?: string; labor: number; complaint?: string; terms?: string;
  items: Item[]; vehicle?: { title: string; plate: string } | null; photos: { label: string; data: string }[]; hash: string; decision?: { approvedTotal: number; originalTotal: number; name: string; at: string } | null };
type View = { scope: string; expiresAt: string; company: { name: string; phone: string; whatsapp: string; email: string; address: string; logo: string; primary: string }; customer: { name: string } | null;
  vehicles: { id: string; title: string; plate: string; mileage: string }[]; records: Rec[]; reminders: { service: string; date: string; km: string }[] };

/** Etapas visíveis ao cliente, derivadas do status real da OS (sem percentuais fictícios). */
const STEPS = ['Aberta', 'Em diagnóstico', 'Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Em testes', 'Pronta', 'Entregue'];
const LABEL: Record<string, string> = { Aberta: 'Veículo recebido', 'Em diagnóstico': 'Em diagnóstico', 'Aguardando aprovação': 'Aguardando aprovação', 'Aguardando peças': 'Aguardando peças', 'Em execução': 'Em execução', 'Em testes': 'Em testes', Pronta: 'Pronto para retirada', Entregue: 'Entregue' };

export default function CustomerPortal() {
  const token = location.pathname.split('/')[2] ?? '';
  const [view, setView] = useState<View | null | 'invalid'>(null);
  const load = useCallback(async () => {
    try { const { supabase } = await import('../../real/client'); const { data, error } = await supabase.rpc('portal_view', { p_token: token }); setView(error || !data ? 'invalid' : data as View); }
    catch { setView('invalid'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view && view !== 'invalid') document.title = `${view.company.name} — Acompanhamento`; }, [view]);
  if (view === null) return <main className="portal" role="status">Carregando…</main>;
  if (view === 'invalid') return <main className="portal"><h1>Link indisponível</h1><p>Este link expirou, foi revogado ou não existe. Peça um novo link à oficina.</p></main>;
  const c = view.company, wa = c.whatsapp.replace(/\D/g, '');
  return <main className="portal" style={{ '--brand': c.primary } as CSSProperties}>
    <header className="portal-head">{c.logo ? <img src={c.logo} alt={c.name}/> : <strong>{c.name}</strong>}<div><h1>{view.customer ? `Olá, ${view.customer.name}` : c.name}</h1><p className="muted small">Link válido até {date(view.expiresAt)}</p></div></header>
    {view.vehicles.length > 0 && <section className="portal-card"><h2>Meus veículos</h2><ul>{view.vehicles.map(v => <li key={v.id}>{v.title} · {v.plate}{v.mileage && ` · ${Number(v.mileage).toLocaleString('pt-BR')} km (último registro)`}</li>)}</ul></section>}
    {view.records.map(r => r.kind === 'orcamentos' ? <Quote key={r.id} rec={r} token={token} onDone={load}/> : <Service key={r.id} rec={r}/>)}
    {!view.records.length && <p>Nenhum atendimento disponível neste link.</p>}
    {view.reminders.length > 0 && <section className="portal-card"><h2>Próximas revisões</h2><ul>{view.reminders.map((m, i) => <li key={i}>{m.service || 'Revisão'} — previsto para {date(m.date)}{m.km && ` ou ${Number(m.km).toLocaleString('pt-BR')} km`} (recomendação registrada pela oficina)</li>)}</ul></section>}
    <section className="portal-card"><h2>Contato</h2><p>{c.address}</p><div className="toolbar">{c.phone && <a className="btn" href={`tel:${c.phone.replace(/\D/g, '')}`}><Phone size={16} aria-hidden="true"/>{c.phone}</a>}{wa && <a className="btn" href={`https://wa.me/55${wa}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}{c.email && <a className="btn" href={`mailto:${c.email}`}>{c.email}</a>}</div></section>
    <footer className="muted small">Acompanhamento seguro fornecido pela oficina via PISTEC. Documento não fiscal.</footer>
  </main>;
}

function Photos({ photos }: { photos: Rec['photos'] }) {
  return photos.length ? <div className="portal-photos">{photos.map((p, i) => <figure key={i}><img src={p.data} alt={p.label} loading="lazy"/><figcaption>{p.label}</figcaption></figure>)}</div> : null;
}

function Service({ rec }: { rec: Rec }) {
  const step = STEPS.indexOf(rec.status);
  return <section className="portal-card"><h2>{rec.kind === 'garantias' ? 'Garantia' : 'Ordem de serviço'}: {rec.title}</h2>
    {rec.vehicle && <p>{rec.vehicle.title} · {rec.vehicle.plate}</p>}
    {rec.status === 'Cancelada' ? <p className="badge danger">Cancelada</p> : step >= 0 ? <ol className="portal-steps" aria-label="Situação do serviço">{STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>{LABEL[s]}</li>)}</ol> : <p>Situação: {rec.status}</p>}
    {rec.dueDate && <p>Previsão de entrega: {date(rec.dueDate)}</p>}
    {rec.complaint && <p><strong>Relato:</strong> {rec.complaint}</p>}
    {rec.items.length > 0 && <ul>{rec.items.map(i => <li key={i.productId}>{i.quantity}× {i.name}</li>)}</ul>}
    <Photos photos={rec.photos}/>
  </section>;
}

function Quote({ rec, token, onDone }: { rec: Rec; token: string; onDone: () => void }) {
  const [choice, setChoice] = useState<Record<string, 'approve' | 'reject'>>({}), [name, setName] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const keys = useMemo(() => [...rec.items.map(i => i.productId), ...(rec.labor > 0 ? ['labor'] : [])], [rec]);
  const open = ['Aberto', 'Enviado'].includes(rec.status);
  const total = rec.items.reduce((t, i) => t + (choice[i.productId] === 'approve' ? i.price * i.quantity : 0), 0) + (choice.labor === 'approve' ? rec.labor : 0);
  async function send(action: 'decide' | 'question') {
    setBusy(true); setMsg('');
    try {
      const { supabase } = await import('../../real/client');
      const { error } = await supabase.rpc('portal_decide', { p_token: token, p_record: rec.id, p_hash: rec.hash, p_action: action, p_decisions: choice, p_name: name, p_note: note });
      if (error) throw new Error(error.message);
      setMsg(action === 'question' ? 'Dúvida enviada à oficina.' : 'Decisão registrada. Obrigado!'); onDone();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const row = (key: string, label: string, value: number) => <li key={key} className="portal-item"><span>{label}</span><strong>{money(value)}</strong>
    {open && <span className="toolbar" role="group" aria-label={`Decisão: ${label}`}><button type="button" className={`btn ${choice[key] === 'approve' ? 'primary' : ''}`} aria-pressed={choice[key] === 'approve'} onClick={() => setChoice({ ...choice, [key]: 'approve' })}><CheckCircle2 size={16} aria-hidden="true"/>Aprovar</button>
      <button type="button" className={`btn ${choice[key] === 'reject' ? 'danger' : ''}`} aria-pressed={choice[key] === 'reject'} onClick={() => setChoice({ ...choice, [key]: 'reject' })}><XCircle size={16} aria-hidden="true"/>Recusar</button></span>}</li>;
  return <section className="portal-card" data-tour="portal-quote"><h2>Orçamento: {rec.title}</h2>
    {rec.vehicle && <p>{rec.vehicle.title} · {rec.vehicle.plate}</p>}
    {rec.validUntil && <p className="muted small">Válido até {date(rec.validUntil)}</p>}
    <ul className="portal-items">{rec.items.map(i => row(i.productId, `${i.quantity}× ${i.name}`, i.price * i.quantity))}{rec.labor > 0 && row('labor', 'Mão de obra', rec.labor)}</ul>
    <Photos photos={rec.photos}/>
    {rec.terms && <p className="small"><strong>Condições:</strong> {rec.terms}</p>}
    {open ? <div className="stack">
      <div className="toolbar"><button type="button" className="btn" onClick={() => setChoice(Object.fromEntries(keys.map(k => [k, 'approve'])))}>Aprovar tudo</button><span>Total aprovado: <strong>{money(total)}</strong> de {money(rec.amount)}</span></div>
      <label className="field"><span>Seu nome completo</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="name" required/></label>
      <label className="field"><span>Observação ou dúvida (opcional)</span><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000}/></label>
      <div className="toolbar"><button className="btn primary" disabled={busy || keys.some(k => !choice[k]) || name.trim().length < 3} onClick={() => void send('decide')}>Confirmar decisão</button>
        <button className="btn" disabled={busy || note.trim().length < 3 || name.trim().length < 3} onClick={() => void send('question')}><HelpCircle size={16} aria-hidden="true"/>Pedir esclarecimento</button></div>
      <p className="muted small">Ao confirmar, você autoriza somente os itens aprovados, pelos valores exibidos. Mudanças posteriores exigem nova aprovação.</p>
    </div> : <p><strong>{rec.status}</strong>{rec.decision && ` por ${rec.decision.name} em ${date(rec.decision.at)} — total aprovado ${money(rec.decision.approvedTotal)} de ${money(rec.decision.originalTotal)}`}</p>}
    {msg && <p role="status">{msg}</p>}
  </section>;
}
