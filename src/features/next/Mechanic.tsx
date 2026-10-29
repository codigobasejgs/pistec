import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Mic, Square, Timer } from 'lucide-react';
import { useDemo, rpc } from '../../store';
import { Badge, Empty, PageHeader, Panel, useNotice } from '../../ui';
import { can, transitionRecord } from '../../domain';
import type { OperationalRecord } from '../../types';
import { compressPhoto } from './photo';

type Note = { transcript: string; summary: string; servicesDone: string[]; recommendations: string[]; parts: { productId: string; name: string; quantity: number }[]; uncertain: string[] };
const OPEN = ['Aberta', 'Em diagnóstico', 'Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Em testes', 'Pronta'];
const NEXT: Record<string, string[]> = { Aberta: ['Em diagnóstico'], 'Em diagnóstico': ['Aguardando aprovação', 'Aguardando peças'], 'Aguardando peças': ['Em execução'], 'Aguardando aprovação': ['Em execução'], 'Em execução': ['Em testes', 'Pronta'], 'Em testes': ['Pronta'] };
const TIMER = (id: string) => `pistec-os-timer:${id}`;

/** Execução da OS pelo mecânico: tempo trabalhado, apontamento por voz (Gemini), fotos e próxima revisão. Toda gravação exige confirmação. */
export default function Mechanic() {
  const { state, session, mode, perform } = useDemo(); const notice = useNotice();
  const mine = state.records.filter(r => r.tenantId === session.tenantId && r.branchId === session.branchId && r.kind === 'ordens-servico' && OPEN.includes(r.status));
  const [id, setId] = useState(''); const os = mine.find(r => r.id === id) ?? mine[0];
  if (!mine.length) return <div className="page"><PageHeader title="Mecânico — execução"/><Empty text="Nenhuma OS aberta nesta filial."/></div>;
  return <div className="page stack">
    <PageHeader title="Mecânico — execução da OS" subtitle="Registre o que foi feito, o tempo e as recomendações. Valores e baixa de estoque continuam nas etapas da OS."/>
    <label className="field" data-tour="mech-os"><span>Ordem de serviço</span><select value={os.id} onChange={e => setId(e.target.value)}>{mine.map(r => <option key={r.id} value={r.id}>{r.title} · {r.status}{r.fields.technician ? ` · ${r.fields.technician}` : ''}</option>)}</select></label>
    <WorkPanel key={os.id} os={os} mode={mode} tenantId={session.tenantId} role={session.role} name={session.name} perform={perform} notice={notice}/>
  </div>;
}

function WorkPanel({ os, mode, tenantId, role, name, perform, notice }: { os: OperationalRecord; mode: string; tenantId: string; role: Parameters<typeof can>[0]; name: string; perform: ReturnType<typeof useDemo>['perform']; notice: (m: string) => void }) {
  const [started, setStarted] = useState<number | null>(() => { try { return Number(localStorage.getItem(TIMER(os.id))) || null; } catch { return null; } });
  const [, tick] = useState(0); useEffect(() => { if (!started) return; const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, [started]);
  const [rec, setRec] = useState<MediaRecorder | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<Note | null>(null), [text, setText] = useState('');
  const chunks = useRef<Blob[]>([]);
  const manager = can(role, 'relatorios', 'editar'), canEdit = can(role, 'ordens-servico', 'editar');
  async function work(fields: Record<string, string>, ok: string) {
    try { await perform(d => { const r = d.records.find(x => x.id === os.id && x.tenantId === tenantId)!; Object.assign(r.fields, fields); r.history.push({ date: new Date().toISOString(), text: `Execução atualizada por ${name}: ${Object.keys(fields).join(', ')}` }); }, rpc('update_os_work', { p_tenant: tenantId, p_id: os.id, p: fields })); notice(ok); return true; }
    catch (e) { notice((e as Error).message); return false; }
  }
  function startTimer() { const now = Date.now(); setStarted(now); try { localStorage.setItem(TIMER(os.id), String(now)); } catch { /* sem armazenamento: cronômetro só nesta tela */ } }
  async function stopTimer() {
    if (!started) return; const hours = Math.round((Date.now() - started) / 36e5 * 100) / 100, total = Math.round(((Number(os.fields.hoursWorked) || 0) + hours) * 100) / 100;
    if (!window.confirm(`Registrar ${hours.toFixed(2)} h (total ${total.toFixed(2)} h) nesta OS?`)) return;
    if (await work({ hoursWorked: String(total) }, 'Tempo registrado.')) { setStarted(null); try { localStorage.removeItem(TIMER(os.id)); } catch { /* ignore */ } }
  }
  async function analyze(payload: { audio?: string; mimeType?: string; text?: string }) {
    if (mode === 'demo') { notice('A IA por voz funciona na conta real com Gemini configurado. Na demonstração, digite o apontamento.'); return; }
    setBusy(true);
    try {
      const { supabase } = await import('../../real/client');
      const { data, error } = await supabase.functions.invoke('mechanic', { body: { tenantId, recordId: os.id, ...payload } });
      if (error) { const d = await (error as { context?: Response }).context?.json?.().catch(() => null); throw new Error(d?.error ?? 'IA indisponível. Digite o apontamento.'); }
      setNote(data.note); setText(data.note.transcript);
    } catch (e) { notice((e as Error).message); } finally { setBusy(false); }
  }
  async function record() {
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { notice('Gravação de áudio não suportada neste navegador. Digite o apontamento.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), r = new MediaRecorder(stream); chunks.current = [];
      r.ondataavailable = e => chunks.current.push(e.data);
      r.onstop = async () => { stream.getTracks().forEach(t => t.stop()); setRec(null); const blob = new Blob(chunks.current, { type: r.mimeType });
        const b64 = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.readAsDataURL(blob); });
        await analyze({ audio: b64, mimeType: r.mimeType }); };
      r.start(); setRec(r); setTimeout(() => { if (r.state === 'recording') r.stop(); }, 120000);
    } catch { notice('Microfone não autorizado.'); }
  }
  async function confirmNote(e: FormEvent) {
    e.preventDefault(); const body = [text.trim(), note?.servicesDone.length ? `Executado: ${note.servicesDone.join('; ')}` : '', note?.recommendations.length ? `Recomendações: ${note.recommendations.join('; ')}` : '', note?.parts.length ? `Peças citadas (conferir antes de lançar): ${note.parts.map(p => `${p.quantity}x ${p.name}`).join(', ')}` : ''].filter(Boolean).join('\n').slice(0, 2000);
    if (!body) return;
    try { await perform(d => { d.records.find(x => x.id === os.id && x.tenantId === tenantId)!.history.push({ date: new Date().toISOString(), text: `${name}: ${body}` }); }, rpc('add_record_note', { p_tenant: tenantId, p_id: os.id, p_note: body })); notice('Apontamento registrado na OS.'); setNote(null); setText(''); }
    catch (err) { notice((err as Error).message); }
  }
  async function photo(file?: File) {
    if (!file) return; if (mode === 'demo') { notice('Fotos são armazenadas apenas na conta real.'); return; }
    try { const data = await compressPhoto(file); const { supabase } = await import('../../real/client'); const { error } = await supabase.rpc('add_record_attachment', { p_tenant: tenantId, p_record: os.id, p_label: file.name.slice(0, 60) || 'Execução', p_data: data, p_shared: false }); if (error) throw new Error(error.message); notice('Foto anexada (privada; marque no portal se quiser compartilhar).'); }
    catch (e) { notice((e as Error).message); }
  }
  async function advance(status: string) {
    if (!window.confirm(`Mover a OS para "${status}"?${status === 'Em execução' ? ' As peças serão reservadas.' : status === 'Pronta' ? ' As peças reservadas serão baixadas e a receita lançada.' : ''}`)) return;
    try { await perform(d => transitionRecord(d, tenantId, os.id, status), rpc('transition_record', { p_tenant: tenantId, p_id: os.id, p_status: status })); notice('Status atualizado.'); } catch (e) { notice((e as Error).message); }
  }
  return <>
    <Panel title={os.title}><p><Badge>{os.status}</Badge> {os.fields.complaint && <>· Relato: {os.fields.complaint}</>}</p>
      {os.items.length > 0 && <p className="small">Peças: {os.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</p>}
      {canEdit && <div className="toolbar">{(NEXT[os.status] ?? []).map(s => <button key={s} className="btn" onClick={() => void advance(s)}>{s}</button>)}</div>}</Panel>
    <Panel title="Tempo trabalhado"><div className="toolbar" data-tour="mech-timer"><span><Timer size={16} aria-hidden="true"/> Registrado: <strong>{Number(os.fields.hoursWorked || 0).toFixed(2)} h</strong>{os.fields.estimatedHours && ` · previsto ${os.fields.estimatedHours} h`}</span>
      {started ? <button className="btn primary" onClick={() => void stopTimer()}>Parar ({((Date.now() - started) / 36e5).toFixed(2)} h)</button> : <button className="btn" disabled={!canEdit} onClick={startTimer}>Iniciar cronômetro</button>}</div></Panel>
    <Panel title="Apontamento por voz ou texto"><div className="toolbar" data-tour="mech-voice">
      <button className={`btn ${rec ? 'danger' : 'primary'}`} disabled={busy || !canEdit} onClick={() => void record()}>{rec ? <><Square size={16} aria-hidden="true"/>Parar e analisar</> : <><Mic size={16} aria-hidden="true"/>Falar</>}</button>
      <label className="btn"><Camera size={16} aria-hidden="true"/>Foto<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }}/></label>
      {busy && <span role="status">Analisando com IA…</span>}</div>
      <form className="stack" onSubmit={confirmNote}><label className="field"><span>Texto do apontamento (revise antes de registrar)</span><textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000}/></label>
        {note && <div className="callout"><p><strong>Sugestão da IA</strong> (confira; nada foi gravado): {note.summary}</p>
          {note.servicesDone.length > 0 && <p>Executado: {note.servicesDone.join('; ')}</p>}{note.recommendations.length > 0 && <p>Recomendações: {note.recommendations.join('; ')}</p>}
          {note.parts.length > 0 && <p>Peças do catálogo citadas: {note.parts.map(p => `${p.quantity}x ${p.name}`).join(', ')} — inclua na OS/orçamento pela tela da OS.</p>}
          {note.uncertain.length > 0 && <p className="field-error">Sem fonte técnica confirmada: {note.uncertain.join('; ')}</p>}</div>}
        <div className="toolbar"><button className="btn" type="button" disabled={busy || !text.trim()} onClick={() => void analyze({ text })}>Organizar texto com IA</button><button className="btn primary" disabled={!text.trim() || !canEdit}>Registrar na OS</button></div></form></Panel>
    <Panel title="Próxima revisão (Fideliza)"><form className="form-grid" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; void work({ nextService: f.nextService, nextServiceDate: f.nextServiceDate, nextServiceKm: f.nextServiceKm }, 'Recomendação registrada.'); }}>
      <label className="field"><span>Serviço recomendado</span><input name="nextService" defaultValue={os.fields.nextService} placeholder="Ex.: Troca de óleo"/></label>
      <label className="field"><span>Data sugerida</span><input name="nextServiceDate" type="date" defaultValue={os.fields.nextServiceDate}/></label>
      <label className="field"><span>Ou quilometragem</span><input name="nextServiceKm" inputMode="numeric" defaultValue={os.fields.nextServiceKm}/></label>
      <button className="btn" disabled={!canEdit}>Salvar recomendação</button><p className="muted small form-span">Intervalo definido pelo profissional ou pelo manual do fabricante; o PISTEC não presume quilometragem atual.</p></form></Panel>
    {manager && <Panel title="Custos diretos (gestão)"><form className="form-grid" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; void work({ estimatedHours: f.estimatedHours || '0', thirdPartyCost: f.thirdPartyCost || '0', commissionPct: f.commissionPct || '0' }, 'Custos registrados.'); }}>
      <label className="field"><span>Horas previstas</span><input name="estimatedHours" inputMode="decimal" defaultValue={os.fields.estimatedHours}/></label>
      <label className="field"><span>Serviços terceirizados (R$)</span><input name="thirdPartyCost" inputMode="decimal" defaultValue={os.fields.thirdPartyCost}/></label>
      <label className="field"><span>Comissão sobre mão de obra (%)</span><input name="commissionPct" inputMode="decimal" defaultValue={os.fields.commissionPct}/></label>
      <button className="btn">Salvar custos</button></form></Panel>}
  </>;
}
