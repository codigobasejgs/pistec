import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, History, Palette, Printer, ScrollText, Tag, Trash2 } from 'lucide-react';
import { useDemo } from '../../store';
import { can } from '../../domain';
import { money, uid } from '../../lib';
import { Badge, Button, Empty, Field, PageHeader, Panel, useNotice } from '../../ui';
import { buildDoc, DEFAULT_TEXTS, TITLES, type DocType, type Texts } from '../../../supabase/functions/_shared/documents/model';
import { renderHtml } from '../../../supabase/functions/_shared/documents/html';
import { DEFAULT_CALIBRATION, PAPERS, paperOf, type Calibration, type Sheet } from '../../../supabase/functions/_shared/documents/paper';
import { LABEL_KINDS, labelsHtml, productLabel, toEpl, toTspl, toZpl, workshopLabel, type LabelKind } from '../../../supabase/functions/_shared/documents/labels';
import { download, printHtml, qrSvg, renameStation, station, type PrinterProfile } from './service';
import DocumentDialog from './DocumentDialog';

const TABS = [['impressoras', 'Impressoras', Printer], ['etiquetas', 'Etiquetas', Tag], ['modelos', 'Modelos e identidade', Palette], ['historico', 'Fila e histórico', History], ['ajuda', 'Ajuda', BookOpen]] as const;
type Tab = typeof TABS[number][0];
const KINDS = { common: ['Impressora comum', 'Jato de tinta ou laser, A4/A5'], thermal: ['Térmica de cupom', 'Bobina 58 ou 80 mm'], label: ['Impressora de etiquetas', 'Rolo de etiquetas adesivas'], network: ['Compartilhada / rede', 'Instalada no computador por rede'], unknown: ['Ainda não sei', 'Começamos pelo modo universal'] } as const;
const FEEDBACK: Record<string, string> = {
  ok: 'Ótimo! Configuração salva.', cut: 'Cortou: escolha um papel menor/maior, reduza a escala para 95% ou ajuste a margem. No diálogo de impressão, desmarque "Cabeçalhos e rodapés" e use "Margens: nenhuma".',
  small: 'Saiu pequena: no diálogo de impressão use "Escala: 100%" (ou "Ajustar à página" desligado) e confirme o tamanho do papel no driver.', big: 'Saiu grande: confira se o papel do driver é o mesmo escolhido aqui; reduza a escala na calibração.',
  none: 'Não imprimiu: confira se a impressora está ligada, com papel, e aparece no diálogo do sistema. Imprima uma página de teste pelo Windows/macOS para validar o driver.',
  misaligned: 'Etiqueta desalinhada: ajuste os deslocamentos X/Y e o espaçamento entre etiquetas; calibre o sensor de gap na própria impressora.', notfound: 'Impressora não encontrada: instale o driver do fabricante no sistema operacional. O navegador só mostra impressoras instaladas no computador.',
};

export default function PrintCenter() {
  const { state, session, mode } = useDemo(); const notice = useNotice();
  const [tab, setTab] = useState<Tab>('impressoras');
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const real = mode === 'real', manage = ['Proprietário', 'Administrador', 'Gerente'].includes(session.role);
  const client = useCallback(async () => (await import('../../real/client')).supabase, []);
  const [printers, setPrinters] = useState<PrinterProfile[]>([]), [demoPrinters, setDemoPrinters] = useState<PrinterProfile[]>(() => { try { return JSON.parse(localStorage.getItem(`pistec-demo-printers-${session.tenantId}`) ?? '[]'); } catch { return []; } });
  const reload = useCallback(async () => { if (!real) return; const { data } = await (await client()).from('printer_profiles').select('*').eq('tenant_id', session.tenantId).order('name'); setPrinters((data ?? []) as PrinterProfile[]); }, [real, client, session.tenantId]);
  useEffect(() => { void reload(); }, [reload]);
  const list = real ? printers : demoPrinters;
  const save = async (p: Partial<PrinterProfile> & { name: string }) => {
    const body = { id: p.id, branchId: p.branch_id ?? session.branchId, station: p.station ?? station(), name: p.name, kind: p.kind, method: p.method ?? 'browser', protocol: p.protocol ?? 'none', device: p.device ?? '', model: p.model ?? '', paperId: p.paper_id, custom: p.custom ?? {}, calibration: p.calibration ?? {}, docTypes: p.doc_types ?? [], copies: p.copies ?? 1, isDefault: p.is_default ?? false, testResult: p.test_result ?? '' };
    if (real) { const { error } = await (await client()).rpc('save_printer_profile', { p_tenant: session.tenantId, p: body }); if (error) throw new Error(error.message); await reload(); }
    else { const row = { tenant_id: session.tenantId, branch_id: body.branchId, station: body.station, method: 'browser', protocol: 'none', device: '', model: '', custom: {}, calibration: {}, doc_types: [], copies: 1, is_default: false, test_result: '', ...p, id: p.id ?? uid() } as PrinterProfile;
      const next = [...demoPrinters.filter(x => x.id !== row.id), row]; setDemoPrinters(next); try { localStorage.setItem(`pistec-demo-printers-${session.tenantId}`, JSON.stringify(next)); } catch { /* demo */ } }
  };
  const remove = async (id: string) => { if (!confirm('Remover esta impressora?')) return; if (real) { const { error } = await (await client()).rpc('delete_printer_profile', { p_tenant: session.tenantId, p_id: id }); if (error) notice(error.message); await reload(); } else { const next = demoPrinters.filter(x => x.id !== id); setDemoPrinters(next); try { localStorage.setItem(`pistec-demo-printers-${session.tenantId}`, JSON.stringify(next)); } catch { /* demo */ } } };

  return <div className="page print-center">
    <PageHeader title="Impressão e documentos" subtitle={`Impressoras, papéis, etiquetas, modelos e histórico de ${tenant.name}. Configurações desta empresa não aparecem em outras.`}/>
    <nav className="tabs" aria-label="Seções da central de impressão" data-tour="print-tabs">{TABS.map(([id, label, Icon]) => <button key={id} className={`btn ${tab === id ? 'primary' : ''}`} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={15}/>{label}</button>)}</nav>
    {!real && <p className="callout">Demonstração: impressoras ficam salvas só neste navegador; envio digital e histórico exigem a conta real.</p>}
    {tab === 'impressoras' && <Printers list={list} manage={manage} save={save} remove={remove}/>}
    {tab === 'etiquetas' && <Labels printers={list}/>}
    {tab === 'modelos' && <Templates real={real} client={client} manage={can(session.role, 'personalizacao', 'editar')}/>}
    {tab === 'historico' && (real ? <HistoryTab client={client}/> : <Empty text="O histórico de impressões e envios é registrado na conta real."/>)}
    {tab === 'ajuda' && <HelpTab/>}
  </div>;
}

function Printers({ list, manage, save, remove }: { list: PrinterProfile[]; manage: boolean; save: (p: Partial<PrinterProfile> & { name: string }) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const { state, session } = useDemo(); const notice = useNotice();
  const [wizard, setWizard] = useState(false), [step, setStep] = useState(0), [here, setHere] = useState(station());
  const [draft, setDraft] = useState<Partial<PrinterProfile> & { name: string; kindChoice: keyof typeof KINDS }>({ name: '', kindChoice: 'common', kind: 'common', paper_id: 'a4', doc_types: [], copies: 1, calibration: {} });
  const [result, setResult] = useState(''), [testDoc, setTestDoc] = useState(false);
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const paper = paperOf(draft.paper_id ?? 'a4'), cal = useMemo(() => ({ ...DEFAULT_CALIBRATION, ...draft.calibration }) as Calibration, [draft.calibration]);
  const papersFor = PAPERS.filter(p => draft.kind === 'thermal' ? p.kind === 'thermal' : draft.kind === 'label' ? p.kind === 'label' : p.kind === 'page');
  const testHtml = useMemo(() => renderHtml(buildDoc({ type: 'test', number: 'TESTE', issuedAt: new Date().toISOString(), copy: 1, version: 1, texts: DEFAULT_TEXTS,
    company: { name: tenant.name, legalName: tenant.legalName, document: tenant.document, address: '', phone: '', whatsapp: '', email: tenant.email, website: '', logo: tenant.branding.logo },
    branch: { name: state.branches.find(b => b.id === session.branchId)?.name ?? '', document: '', address: '', phone: '' } }), paper, { qr: qrSvg, calibration: cal }), [tenant, paper, cal, state.branches, session.branchId]);
  const steps = ['Tipo', 'Método', 'Seleção', 'Papel', 'Teste', 'Confirmação', 'Salvar'];
  const setKind = (k: keyof typeof KINDS) => { const kind = k === 'thermal' ? 'thermal' : k === 'label' ? 'label' : k === 'network' ? 'network' : 'common'; setDraft(d => ({ ...d, kindChoice: k, kind, paper_id: kind === 'thermal' ? 'thermal-80' : kind === 'label' ? 'label-40x30' : 'a4', protocol: 'none' })); };
  const docTypes: DocType[] = ['sale', 'payment', 'quote', 'os-entry', 'os-done', 'warranty', 'purchase-order', 'cash', 'settlement', 'inventory'];

  return <div className="grid grid-2">
    <Panel title="Impressoras desta empresa"><div className="stack" data-tour="print-printers">
      <div className="toolbar"><label className="field" style={{ flex: 1 }}><span>Nome desta estação (computador/celular)</span><input value={here} maxLength={60} onChange={e => setHere(e.target.value)} onBlur={() => renameStation(here)} aria-label="Nome desta estação"/></label></div>
      <p className="muted small">Cada impressora fica ligada à estação onde foi configurada. A impressora do computador do caixa não é assumida no celular.</p>
      {list.length ? list.map(p => <article key={p.id} className="list-rows"><div><strong>{p.name}</strong> {p.is_default && <Badge>Padrão</Badge>} {p.station === station() && <Badge>Esta estação</Badge>}<br/>
        <small className="muted">{KINDS[p.kind === 'network' ? 'network' : p.kind]?.[0]} · {paperOf(p.paper_id).name} · {p.method === 'connector' ? `Conector (${p.protocol.toUpperCase()})` : 'Navegador'} · {p.station || 'Qualquer estação'}{p.doc_types.length ? ` · ${p.doc_types.map(t => TITLES[t as DocType] ?? t).join(', ')}` : ''}{p.test_result ? ` · Teste: ${p.test_result}` : ''}</small></div>
        {manage && <div className="toolbar"><Button onClick={() => { setDraft({ ...p, kindChoice: p.kind === 'network' ? 'network' : p.kind }); setStep(3); setWizard(true); }}>Editar</Button><button className="icon-button danger" aria-label={`Remover ${p.name}`} onClick={() => void remove(p.id)}><Trash2 size={16}/></button></div>}</article>)
        : <Empty text="Nenhuma impressora configurada. Sem configuração, o PISTEC usa o diálogo de impressão do sistema (funciona com qualquer impressora instalada)."/>}
      {manage ? <Button variant="primary" data-tour="print-add" onClick={() => { setDraft({ name: '', kindChoice: 'common', kind: 'common', paper_id: 'a4', doc_types: [], copies: 1, calibration: {} }); setStep(0); setResult(''); setWizard(true); }}><Printer size={16}/>Configurar impressora</Button>
        : <p className="muted small">Só proprietário, administrador ou gerente configura impressoras.</p>}
      <Button data-tour="print-test" onClick={() => setTestDoc(true)}><FileText size={16}/>Página de teste e documentos</Button>
    </div></Panel>
    {wizard && <Panel title="Assistente de impressora"><div className="stack" data-tour="print-wizard">
      <div className="print-steps" aria-label="Etapas">{steps.map((s, i) => <span key={s} className={i === step ? 'on' : ''}>{i + 1}. {s}</span>)}</div>
      {step === 0 && <><strong>Qual tipo de impressora você utiliza?</strong><div className="choice-grid">{(Object.keys(KINDS) as (keyof typeof KINDS)[]).map(k => <button key={k} type="button" className={`choice ${draft.kindChoice === k ? 'is-active' : ''}`} aria-pressed={draft.kindChoice === k} onClick={() => setKind(k)}><strong>{KINDS[k][0]}</strong><small>{KINDS[k][1]}</small></button>)}</div></>}
      {step === 1 && <><strong>Como o PISTEC vai imprimir?</strong><div className="choice-grid">
        <button type="button" className={`choice ${draft.method !== 'connector' ? 'is-active' : ''}`} onClick={() => setDraft(d => ({ ...d, method: 'browser', protocol: 'none' }))}><strong>Navegador / aplicativo</strong><small>Universal: usa o diálogo de impressão do sistema e o driver instalado. Recomendado.</small></button>
        <button type="button" className={`choice ${draft.method === 'connector' ? 'is-active' : ''}`} onClick={() => setDraft(d => ({ ...d, method: 'connector', protocol: d.kind === 'thermal' ? 'escpos' : d.kind === 'label' ? 'zpl' : 'none' }))}><strong>Conector local (avançado)</strong><small>Impressão direta por protocolo (ESC/POS, ZPL, TSPL, EPL). Exige programa conector instalado no computador — veja a Ajuda.</small></button></div>
        {draft.method === 'connector' && <><Field label="Protocolo (confirme no manual do modelo)"><select value={draft.protocol} onChange={e => setDraft(d => ({ ...d, protocol: e.target.value as PrinterProfile['protocol'] }))}><option value="escpos">ESC/POS (cupom)</option><option value="zpl">ZPL (Zebra e compatíveis)</option><option value="tspl">TSPL/TSPL2 (TSC, Elgin, Argox)</option><option value="epl">EPL2 (Zebra antigas, Argox)</option></select></Field>
          <p className="callout warning">Conector não detectado neste computador. Os comandos podem ser baixados em arquivo para teste, mas a impressão direta só funciona após instalar e autorizar o conector.</p></>}</>}
      {step === 2 && <><strong>Seleção</strong><p className="muted">O navegador não informa a lista de impressoras instaladas (proteção de privacidade). Você escolhe a impressora no diálogo do sistema na hora de imprimir; ele costuma lembrar a última usada.</p>
        <Field label="Nome para identificar" hint="Ex.: Caixa 01, Escritório, Etiquetas balcão"><input value={draft.name} maxLength={60} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/></Field>
        <div className="form-grid"><Field label="Fabricante/modelo (opcional)"><input value={draft.model ?? ''} maxLength={80} placeholder="Ex.: Elgin i9, Epson TM-T20X" onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}/></Field><Field label="Nome no sistema (opcional)"><input value={draft.device ?? ''} maxLength={120} onChange={e => setDraft(d => ({ ...d, device: e.target.value }))}/></Field></div></>}
      {step === 3 && <><strong>Papel</strong><div className="choice-grid">{papersFor.map(p => <button key={p.id} type="button" className={`choice ${draft.paper_id === p.id ? 'is-active' : ''}`} onClick={() => setDraft(d => ({ ...d, paper_id: p.id }))}><strong>{p.name}</strong><small>{p.kind === 'thermal' ? `Área útil ${p.printable} mm` : p.height ? `${p.width} × ${p.height} mm` : ''}</small></button>)}</div>
        <p className="muted small">O PISTEC não consegue ler qual papel está carregado: usa o formato escolhido aqui. Confira sempre a prévia.</p>
        <details><summary>Calibração (posição, escala, densidade)</summary><div className="form-grid">{([['offsetX', 'Deslocamento X (mm)'], ['offsetY', 'Deslocamento Y (mm)'], ['scale', 'Escala (%)'], ['gap', 'Espaço entre etiquetas (mm)'], ['density', 'Densidade (0–15/30, se suportado)'], ['speed', 'Velocidade (se suportado)']] as const).map(([k, l]) =>
          <Field key={k} label={l}><input type="number" step={k === 'scale' ? 1 : 0.5} value={cal[k] ?? ''} onChange={e => setDraft(d => ({ ...d, calibration: { ...d.calibration, [k]: e.target.value === '' ? undefined : Number(e.target.value) } }))}/></Field>)}</div></details>
        <Field label="Usar para"><div className="chips">{docTypes.map(t => <label key={t} className="chip"><input type="checkbox" checked={draft.doc_types?.includes(t) ?? false} onChange={e => setDraft(d => ({ ...d, doc_types: e.target.checked ? [...(d.doc_types ?? []), t] : (d.doc_types ?? []).filter(x => x !== t) }))}/> {TITLES[t]}</label>)}</div></Field>
        <div className="form-grid"><Field label="Cópias padrão"><input type="number" min={1} max={10} value={draft.copies ?? 1} onChange={e => setDraft(d => ({ ...d, copies: Math.min(10, Math.max(1, Number(e.target.value) || 1)) }))}/></Field>
          <label className="checkbox-row"><input type="checkbox" checked={draft.is_default ?? false} onChange={e => setDraft(d => ({ ...d, is_default: e.target.checked }))}/> Padrão desta estação para este tipo</label></div></>}
      {step === 4 && <><strong>Página de teste</strong><iframe className="label-preview" title="Prévia da página de teste" srcDoc={testHtml}/>
        <Button variant="primary" onClick={() => void printHtml(testHtml)}><Printer size={16}/>Imprimir teste</Button>
        {draft.method === 'connector' && draft.protocol !== 'none' && <Button onClick={() => { const l = [productLabel('price', { name: 'TESTE PISTEC', sku: 'TESTE-1', barcode: '', price: 1234, brand: tenant.name, category: '', location: '' }, { money })];
          const body = draft.protocol === 'zpl' ? toZpl(l, paper, { calibration: cal }) : draft.protocol === 'tspl' ? toTspl(l, paper, { calibration: cal }) : draft.protocol === 'epl' ? toEpl(l, paper) : '';
          if (body) download(body, `teste.${draft.protocol}`, 'text/plain'); else notice('ESC/POS de teste é gerado pelo conector.'); }}>Baixar comandos de teste ({draft.protocol?.toUpperCase()})</Button>}</>}
      {step === 5 && <><strong>A impressão saiu corretamente?</strong><div className="choice-grid">{[['ok', 'Sim'], ['cut', 'Ficou cortada'], ['small', 'Saiu pequena'], ['big', 'Saiu grande'], ['none', 'Não imprimiu'], ['misaligned', 'Etiqueta desalinhada'], ['notfound', 'Impressora não encontrada']].map(([k, l]) =>
        <button key={k} type="button" className={`choice ${result === k ? 'is-active' : ''}`} onClick={() => setResult(k)}><strong>{l}</strong></button>)}</div>{result && <p className={result === 'ok' ? 'callout' : 'callout warning'} role="status">{FEEDBACK[result]}</p>}
        {result && result !== 'ok' && <Button onClick={() => setStep(3)}>Ajustar papel e calibração</Button>}</>}
      {step === 6 && <><strong>Salvar configuração</strong><p>Empresa: <strong>{tenant.name}</strong> · Filial: <strong>{state.branches.find(b => b.id === session.branchId)?.name}</strong> · Estação: <strong>{station()}</strong></p>
        <p>{draft.name || 'Sem nome'} · {paper.name} · {draft.method === 'connector' ? `Conector ${draft.protocol?.toUpperCase()}` : 'Navegador'}</p></>}
      <div className="toolbar"><Button disabled={step === 0} onClick={() => setStep(s => s - 1)}>Voltar</Button>
        {step < 6 ? <Button variant="primary" onClick={() => { if (step === 2 && !draft.name.trim()) { notice('Dê um nome para identificar a impressora.'); return; } setStep(s => s + 1); }}>Avançar</Button>
          : <Button variant="primary" onClick={async () => { try { await save({ ...draft, station: station(), test_result: { ok: 'Aprovado pelo operador', cut: 'Cortada', small: 'Pequena', big: 'Grande', none: 'Não imprimiu', misaligned: 'Desalinhada', notfound: 'Não encontrada' }[result] ?? 'Não testado' }); notice('Impressora salva.'); setWizard(false); } catch (e) { notice((e as Error).message); } }}>Salvar impressora</Button>}
        <Button variant="ghost" onClick={() => setWizard(false)}>Cancelar</Button></div>
    </div></Panel>}
    <DocumentDialog source={testDoc ? { kind: 'stock', id: session.branchId } : null} types={['test']} onClose={() => setTestDoc(false)}/>
  </div>;
}

function Labels({ printers }: { printers: PrinterProfile[] }) {
  const { state, session, mode } = useDemo(); const notice = useNotice();
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const [kind, setKind] = useState<LabelKind>('price'), [paperId, setPaperId] = useState('label-40x30'), [query, setQuery] = useState(''), [qty, setQty] = useState<Record<string, number>>({}), [promo, setPromo] = useState('OFERTA');
  const [useSheet, setUseSheet] = useState(false), [sheet, setSheet] = useState<Sheet>({ columns: 3, rows: 10, top: 13, left: 5, labelWidth: 66.7, labelHeight: 25.4, gapX: 2.5, gapY: 0, start: 1 });
  const [osId, setOsId] = useState('');
  const products = state.products.filter(p => p.tenantId === tenant.id && p.active && (!query || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(query.toLowerCase()))).slice(0, 100);
  const oss = state.records.filter(r => r.tenantId === tenant.id && r.kind === 'ordens-servico' && !['Entregue', 'Cancelada'].includes(r.status));
  const printer = printers.find(p => p.kind === 'label' && (!p.station || p.station === station()));
  const paper = useSheet ? paperOf('a4') : paperOf(paperId), cal = { ...DEFAULT_CALIBRATION, ...printer?.calibration } as Calibration;
  const workshop = kind.startsWith('os-');
  const labels = useMemo(() => {
    if (workshop) { const r = oss.find(x => x.id === osId); if (!r) return [];
      const v = state.records.find(x => x.id === r.fields.vehicleId);
      const base = { number: r.title.replace(/\D+/g, '') || r.id.slice(0, 6), vehicle: v?.title ?? '', plate: v?.fields.plate, technician: r.fields.technician, status: r.status, date: new Date(r.date).toLocaleDateString('pt-BR') };
      // QR interno: rota autenticada do ERP (só quem tem acesso à empresa vê a OS).
      const link = `${location.origin}${mode === 'real' ? '/app' : ''}/loja/${tenant.slug}/ordens-servico?q=${encodeURIComponent(r.title)}`;
      return kind === 'os-part' ? r.items.map(i => workshopLabel('os-part', { ...base, part: i.name }, link)) : [workshopLabel(kind as 'os-key' | 'os-vehicle', base, link)]; }
    return state.products.filter(p => (qty[p.id] ?? 0) > 0 && p.tenantId === tenant.id).flatMap(p => Array.from({ length: Math.min(qty[p.id], 200) }, () => productLabel(kind, p, { promo, money })));
  }, [workshop, oss, osId, state, kind, qty, promo, tenant, mode]);
  const html = labelsHtml(labels, paper, { qr: qrSvg, sheet: useSheet ? sheet : null, calibration: cal });
  const invalid = !workshop && state.products.some(p => (qty[p.id] ?? 0) > 0 && p.price <= 0 && ['price', 'promo', 'shelf'].includes(kind));
  return <div className="grid grid-2">
    <Panel title="Etiquetas"><div className="stack" data-tour="labels-setup">
      <div className="form-grid"><Field label="Tipo de etiqueta"><select value={kind} onChange={e => setKind(e.target.value as LabelKind)}>{Object.entries(LABEL_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tamanho"><select value={paperId} disabled={useSheet} onChange={e => setPaperId(e.target.value)}>{PAPERS.filter(p => p.kind === 'label').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
      <label className="checkbox-row"><input type="checkbox" checked={useSheet} onChange={e => setUseSheet(e.target.checked)}/> Folha A4 de etiquetas (impressora comum)</label>
      {useSheet && <div className="form-grid">{([['columns', 'Colunas'], ['rows', 'Linhas'], ['top', 'Margem superior (mm)'], ['left', 'Margem lateral (mm)'], ['labelWidth', 'Largura (mm)'], ['labelHeight', 'Altura (mm)'], ['gapX', 'Espaço horizontal (mm)'], ['gapY', 'Espaço vertical (mm)'], ['start', 'Começar na posição']] as const).map(([k, l]) =>
        <Field key={k} label={l}><input type="number" step="0.1" min={0} value={sheet[k]} onChange={e => setSheet(s => ({ ...s, [k]: Number(e.target.value) || 0 }))}/></Field>)}</div>}
      {kind === 'promo' && <Field label="Texto promocional"><input value={promo} maxLength={20} onChange={e => setPromo(e.target.value)}/></Field>}
      {workshop ? <Field label="Ordem de serviço"><select value={osId} onChange={e => setOsId(e.target.value)}><option value="">Selecione</option>{oss.map(r => <option key={r.id} value={r.id}>{r.title} · {r.status}</option>)}</select></Field>
        : <><Field label="Buscar produto"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, SKU ou código"/></Field>
          <div className="label-pick" data-tour="labels-products">{products.map(p => <label key={p.id}><input type="checkbox" checked={(qty[p.id] ?? 0) > 0} onChange={e => setQty(q => ({ ...q, [p.id]: e.target.checked ? 1 : 0 }))}/><span>{p.name}<br/><small className="muted">{p.sku} · {money(p.price)}{p.barcode && !/^\d{13}$/.test(p.barcode) ? ' · código interno' : ''}</small></span>
            <input type="number" min={0} max={200} aria-label={`Quantidade de etiquetas de ${p.name}`} value={qty[p.id] ?? 0} onChange={e => setQty(q => ({ ...q, [p.id]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))}/></label>)}</div></>}
      <p className="muted small">GTIN/EAN só é impresso quando o código cadastrado é válido; nos demais casos usa-se o código interno (Code 128). Etiquetas de oficina não mostram o nome do cliente.</p>
      {invalid && <p className="callout warning">Há produto sem preço: revise o cadastro antes de imprimir etiquetas de preço.</p>}
      <div className="toolbar"><Button variant="primary" disabled={!labels.length || invalid} onClick={() => void printHtml(html)}><Printer size={16}/>Imprimir {labels.length} etiqueta(s)</Button>
        <Button disabled={!labels.length} onClick={() => download(toZpl(labels, paper, { calibration: cal }), 'etiquetas.zpl', 'text/plain')}>ZPL</Button>
        <Button disabled={!labels.length} onClick={() => download(toTspl(labels, paper, { calibration: cal }), 'etiquetas.tspl', 'text/plain')}>TSPL</Button>
        <Button disabled={!labels.length} onClick={() => download(toEpl(labels, paper), 'etiquetas.epl', 'text/plain')}>EPL</Button></div>
      <p className="muted small">ZPL/TSPL/EPL: arquivos de comandos para enviar à impressora pelo conector ou utilitário do fabricante. Confirme o protocolo do seu modelo.</p>
    </div></Panel>
    <Panel title="Prévia"><iframe className="label-preview" title="Prévia das etiquetas" srcDoc={html} data-tour="labels-preview"/>{!labels.length && <p className="muted">{workshop ? 'Escolha uma ordem de serviço.' : 'Marque produtos e quantidades.'}</p>}{labels.length > 0 && <Button onClick={() => notice(`${labels.length} etiqueta(s) prontas.`)}><ScrollText size={15}/>{labels.length} etiqueta(s)</Button>}</Panel>
  </div>;
}

type Settings = { texts: Partial<Texts>; style: 'elite' | 'minimal' | 'commercial' | 'workshop'; accent: string; logoSize: number; align: 'left' | 'center' };
function Templates({ real, client, manage }: { real: boolean; client: () => Promise<Awaited<typeof import('../../real/client')>['supabase']>; manage: boolean }) {
  const { state, session } = useDemo(); const notice = useNotice();
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const [s, setS] = useState<Settings>({ texts: {}, style: 'elite', accent: tenant.branding.primary, logoSize: 18, align: 'left' });
  const [contact, setContact] = useState({ address: '', phone: '', whatsapp: '', website: '' }), [pending, setPending] = useState(false), [paperId, setPaperId] = useState('a4');
  useEffect(() => { if (!real) return; void (async () => { const sb = await client(); const [{ data }, { data: t }] = await Promise.all([sb.from('document_settings').select('*').eq('tenant_id', tenant.id).maybeSingle(), sb.from('tenants').select('address,phone,whatsapp,website').eq('id', tenant.id).maybeSingle()]);
    if (data) setS({ texts: data.texts ?? {}, style: data.style, accent: data.accent || tenant.branding.primary, logoSize: data.logo_size, align: data.align }); if (t) setContact(t as typeof contact); })(); }, [real, client, tenant.id, tenant.branding.primary]);
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, footer: tenant.branding.footer || '', ...s.texts }), [tenant.branding.footer, s.texts]);
  const sample = useMemo(() => renderHtml(buildDoc({ type: 'quote', number: 'ORC-000123', issuedAt: new Date().toISOString(), copy: 1, version: 1, texts,
    company: { name: tenant.name, legalName: tenant.legalName, document: tenant.document, ...contact, email: tenant.email, logo: tenant.branding.logo },
    branch: { name: state.branches.find(b => b.id === session.branchId)?.name ?? '', document: '', address: '', phone: '' }, customer: { name: 'Exemplo de cliente' }, vehicle: { title: 'Exemplo de veículo', plate: 'ABC1D23' },
    record: { id: 'x', kind: 'orcamentos', title: 'Orçamento de exemplo', status: 'Aberto', date: new Date().toISOString(), amount: 0, fields: { validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) }, items: [{ name: 'Item de exemplo', quantity: 1, price: 10000 }], history: [] } }),
    paperOf(paperId), { qr: qrSvg, accent: s.accent, style: s.style, logoSize: s.logoSize, align: s.align }), [texts, tenant, contact, state.branches, session.branchId, paperId, s]);
  const saveAll = async () => { setPending(true); try { if (!real) throw new Error('Na demonstração os modelos são só visualizados.'); const sb = await client();
    const a = await sb.rpc('save_document_settings', { p_tenant: tenant.id, p: { texts: s.texts, style: s.style, accent: s.accent, logoSize: s.logoSize, align: s.align } }); if (a.error) throw new Error(a.error.message);
    const b = await sb.rpc('save_document_identity', { p_tenant: tenant.id, p: contact }); if (b.error) throw new Error(b.error.message); notice('Modelos salvos. Documentos já emitidos não mudam; os próximos usam a nova identidade.'); }
    catch (e) { notice((e as Error).message); } finally { setPending(false); } };
  return <div className="grid grid-2">
    <Panel title="Identidade nos documentos"><div className="stack" data-tour="print-templates">
      <p className="muted small">Logotipo, nome e CNPJ vêm de <Link to={`/loja/${tenant.slug}/personalizacao`}>Personalização</Link> e <Link to={`/loja/${tenant.slug}/configuracoes`}>Configurações</Link>.</p>
      <div className="form-grid">{([['address', 'Endereço completo'], ['phone', 'Telefone'], ['whatsapp', 'WhatsApp'], ['website', 'Site']] as const).map(([k, l]) => <Field key={k} label={l}><input value={contact[k]} maxLength={k === 'address' ? 300 : 160} onChange={e => setContact(c => ({ ...c, [k]: e.target.value }))}/></Field>)}</div>
      <div className="form-grid"><Field label="Modelo"><select value={s.style} onChange={e => setS(x => ({ ...x, style: e.target.value as Settings['style'] }))}><option value="elite">Elite</option><option value="commercial">Comercial</option><option value="workshop">Oficina</option><option value="minimal">Minimalista</option></select></Field>
        <Field label="Cor de destaque"><input type="color" value={s.accent || '#0b57d0'} onChange={e => setS(x => ({ ...x, accent: e.target.value }))}/></Field>
        <Field label="Tamanho do logo (mm)"><input type="number" min={8} max={40} value={s.logoSize} onChange={e => setS(x => ({ ...x, logoSize: Math.min(40, Math.max(8, Number(e.target.value) || 18)) }))}/></Field>
        <Field label="Alinhamento do cabeçalho"><select value={s.align} onChange={e => setS(x => ({ ...x, align: e.target.value as 'left' | 'center' }))}><option value="left">Esquerda</option><option value="center">Centro</option></select></Field></div>
      {([['header', 'Aviso no cabeçalho'], ['footer', 'Rodapé'], ['thanks', 'Mensagem de agradecimento (venda)'], ['quoteTerms', 'Condições do orçamento'], ['osTerms', 'Termo da OS de entrada'], ['warranty', 'Garantia comercial (OS concluída)'], ['deliveryTerms', 'Termo de entrega']] as const).map(([k, l]) =>
        <Field key={k} label={l}><textarea maxLength={1500} value={texts[k]} onChange={e => setS(x => ({ ...x, texts: { ...x.texts, [k]: e.target.value } }))}/></Field>)}
      <p className="muted small">Avisos obrigatórios ("documento não fiscal", via, cancelamento, garantia legal do CDC) são sempre incluídos e não podem ser removidos. Textos são exibidos como texto puro (sem HTML).</p>
      <Button variant="primary" loading={pending} disabled={!manage} onClick={() => void saveAll()}>Salvar modelos</Button>
    </div></Panel>
    <Panel title="Prévia do modelo"><Field label="Papel"><select value={paperId} onChange={e => setPaperId(e.target.value)}>{PAPERS.filter(p => p.kind !== 'label').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><iframe className="doc-preview" title="Prévia do modelo" srcDoc={sample}/></Panel>
  </div>;
}

type Hist = { id: string; kind: string; status: string; recipient: string; created_at: string; number: string; type: string; printer: string | null; operator: string | null; detail: string | null };
function HistoryTab({ client }: { client: () => Promise<Awaited<typeof import('../../real/client')>['supabase']> }) {
  const { session } = useDemo(); const [rows, setRows] = useState<Hist[] | null>(null), [filter, setFilter] = useState('');
  useEffect(() => { void (async () => { const { data } = await (await client()).rpc('document_history', { p_tenant: session.tenantId, p_document: null, p_limit: 300 }); setRows((data ?? []) as Hist[]); })(); }, [client, session.tenantId]);
  const label: Record<string, string> = { print: 'Impressão', reprint: 'Reimpressão', pdf: 'PDF', email: 'E-mail', whatsapp: 'WhatsApp', link: 'Link', revoke: 'Revogação' };
  const st: Record<string, string> = { sent_to_browser: 'Enviado ao navegador', sent_to_connector: 'Enviado ao conector', error: 'Erro', pending: 'Na fila', processing: 'Processando', accepted: 'Aceito pelo provedor', delivered: 'Entregue', failed: 'Falhou', done: 'Concluído', cancelled: 'Cancelado', expired: 'Expirado' };
  const shown = (rows ?? []).filter(r => !filter || r.kind === filter || (filter === 'fail' && ['failed', 'error'].includes(r.status)));
  return <Panel title="Fila e histórico"><div className="stack" data-tour="print-history"><div className="toolbar"><Field label="Filtrar"><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tudo</option><option value="print">Impressões</option><option value="reprint">Reimpressões</option><option value="email">E-mails</option><option value="whatsapp">WhatsApp</option><option value="fail">Falhas</option></select></Field></div>
    <p className="muted small">"Enviado ao navegador" significa que o diálogo de impressão foi aberto — o sistema não consegue confirmar que o papel saiu. "Aceito pelo provedor" não significa lido.</p>
    {rows === null ? <p role="status">Carregando…</p> : shown.length ? <div className="table-wrap"><table><thead><tr><th>Quando</th><th>Documento</th><th>Ação</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>{shown.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString('pt-BR')}</td><td>{TITLES[r.type as DocType] ?? r.type} {r.number}</td><td>{label[r.kind] ?? r.kind}</td><td>{st[r.status] ?? r.status}</td><td>{[r.operator, r.printer, r.recipient, r.detail].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div> : <Empty text="Nada registrado ainda."/>}
  </div></Panel>;
}

function HelpTab() {
  const { state, session } = useDemo(); const slug = state.tenants.find(t => t.id === session.tenantId)?.slug;
  return <Panel title="Ajuda rápida"><ul className="stack">
    <li><strong>Imprimir um cupom:</strong> conclua a venda e toque em "Imprimir · WhatsApp · E-mail · PDF" → Imprimir. Escolha a impressora no diálogo do sistema.</li>
    <li><strong>Térmica 58/80 mm:</strong> configure a impressora com o papel da bobina e, no diálogo, use margens "Nenhuma" e escala 100%.</li>
    <li><strong>Impressora não aparece:</strong> instale o driver do fabricante no Windows/macOS; o navegador só lista impressoras instaladas.</li>
    <li><strong>Etiquetas:</strong> aba Etiquetas → escolha tamanho, produtos e quantidades → imprimir. Para impressão direta por ZPL/TSPL é preciso um conector local.</li>
    <li><strong>Segunda via:</strong> Vendas → abra a venda → Documentos → Imprimir (vira "2ª via" automaticamente).</li>
    <li><strong>Nota fiscal:</strong> o PISTEC emite comprovantes NÃO fiscais. Emissão de NF-e/NFC-e/NFS-e exige integração fiscal (ainda não disponível).</li>
  </ul><Link className="btn" to={`/loja/${slug}/ajuda?q=impress`}>Ver todos os artigos de impressão</Link></Panel>;
}
