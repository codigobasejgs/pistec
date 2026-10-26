import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleHelp, Inbox, RefreshCw } from 'lucide-react';
import { Badge, Button, Field, Modal } from '../../ui';

// Componentes do Super Admin construídos sobre o design system existente (ui.tsx + styles.css).

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return <div className="stack" role="status" aria-label={label}><div className="skeleton-line"/><div className="skeleton-line"/><div className="skeleton-line short"/></div>;
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="empty" role="alert"><AlertTriangle size={30} aria-hidden="true"/><p>{message}</p>{retry && <Button icon={<RefreshCw size={15}/>} onClick={retry}>Tentar novamente</Button>}</div>;
}
export function EmptyState({ title, text, action, help }: { title: string; text: string; action?: ReactNode; help?: string }) {
  return <div className="empty"><Inbox size={32} aria-hidden="true"/><strong>{title}</strong><p>{text}</p><div className="toolbar" style={{ justifyContent: 'center' }}>{action}{help && <Link className="btn ghost" to={`/admin/ajuda?q=${encodeURIComponent(help)}`}><CircleHelp size={15}/>Ajuda</Link>}</div></div>;
}
export function Loaded<T>({ q, children, empty }: { q: { data: T | null; error: string; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; empty?: ReactNode }) {
  if (q.loading && !q.data) return <LoadingState/>;
  if (q.error) return <ErrorState message={q.error} retry={q.reload}/>;
  if (!q.data || (Array.isArray(q.data) && q.data.length === 0 && empty)) return <>{empty}</>;
  return <>{children(q.data)}</>;
}

export function StatusBadge({ children }: { children: ReactNode }) { return <Badge>{children}</Badge>; }

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string }) {
  return <div className="tabs" role="tablist" aria-label={label}>{items.map(([k, l]) =>
    <button key={k} role="tab" aria-selected={value === k} className={`btn ${value === k ? 'primary' : 'ghost'}`} onClick={() => onChange(k)} data-tour={`tab-${k}`}>{l}</button>)}</div>;
}

/** Tabela com busca, ordenação e paginação; vira cartões no celular (CSS existente usa data-label). */
export type Column<T> = { key: string; label: string; render?: (row: T) => ReactNode; sort?: (row: T) => string | number };
export function AdvancedTable<T extends { id?: string }>({ rows, columns, search, onRow, pageSize = 15, caption, tour }: { rows: T[]; columns: Column<T>[]; search?: (row: T) => string; onRow?: (row: T) => void; pageSize?: number; caption: string; tour?: string }) {
  const [q, setQ] = useState(''), [page, setPage] = useState(0), [sort, setSort] = useState<{ key: string; dir: number } | null>(null);
  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('pt-BR');
    let list = term && search ? rows.filter(r => search(r).toLocaleLowerCase('pt-BR').includes(term)) : rows;
    const col = sort && columns.find(c => c.key === sort.key);
    if (col?.sort) list = [...list].sort((a, b) => { const x = col.sort!(a), y = col.sort!(b); return sort!.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })); });
    return list;
  }, [rows, q, sort, columns, search]);
  useEffect(() => setPage(0), [q, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages - 1);
  return <div className="stack" data-tour={tour}>
    {search && <input type="search" aria-label={`Buscar em ${caption}`} placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 360 }}/>}
    <div className="table-wrap"><table className="responsive-table"><caption className="sr-only">{caption}</caption>
      <thead><tr>{columns.map(c => <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
        {c.sort ? <button className="table-sort" onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key ? -s.dir : 1 }))}>{c.label}</button> : c.label}</th>)}</tr></thead>
      <tbody>{filtered.slice(current * pageSize, current * pageSize + pageSize).map((r, i) => <tr key={r.id ?? i} className={onRow ? 'clickable' : ''} onClick={onRow ? () => onRow(r) : undefined}>
        {columns.map(c => <td key={c.key} data-label={c.label}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}</td>)}</tr>)}</tbody></table>
      {!filtered.length && <p className="muted" style={{ padding: 16 }}>Nenhum resultado{q ? ` para "${q}"` : ''}.</p>}</div>
    {filtered.length > pageSize && <div className="pagination"><span>{filtered.length} registros</span><div>
      <Button disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Página anterior">‹</Button><span>{current + 1} de {pages}</span>
      <Button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label="Próxima página">›</Button></div></div>}
  </div>;
}

/** Confirmação com justificativa obrigatória (registrada na auditoria pelo servidor). */
export function ConfirmAction({ open, title, description, confirmLabel, danger, needReason = true, children, onClose, onConfirm }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string; danger?: boolean; needReason?: boolean; children?: ReactNode;
  onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);
  const submit = async () => {
    if (needReason && reason.trim().length < 5) { setError('Descreva o motivo (mínimo 5 caracteres). Ele fica registrado na auditoria.'); return; }
    setPending(true); setError('');
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } finally { setPending(false); }
  };
  return <Modal title={title} open={open} onClose={onClose} footer={<><Button onClick={onClose} disabled={pending}>Cancelar</Button><Button variant={danger ? 'danger' : 'primary'} loading={pending} onClick={() => void submit()}>{confirmLabel}</Button></>}>
    <div className="stack">{description}{children}
      {needReason && <Field label="Justificativa (obrigatória)" hint="Fica registrada na auditoria com seu nome e a data."><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} required/></Field>}
      {error && <p role="alert" className="field-error">{error}</p>}</div>
  </Modal>;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv-grid">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === '' || v == null ? '—' : v}</dd></div>)}</dl>;
}

export function Timeline({ items }: { items: { date: string; text: string; author?: string; internal?: boolean }[] }) {
  if (!items.length) return <p className="muted">Sem histórico.</p>;
  return <ol className="timeline">{[...items].reverse().map((h, i) => <li key={i}><time dateTime={h.date}>{new Date(h.date).toLocaleString('pt-BR')}</time>
    <p>{h.text}</p>{(h.author || h.internal != null) && <small>{h.author}{h.internal ? ' · nota interna' : h.internal === false ? ' · enviada ao cliente' : ''}</small>}</li>)}</ol>;
}

/** Série simples em barras (SVG), sem dependência nova: Recharts fica no chunk do ERP. */
export function BarSeries({ data, format, label }: { data: { x: string; y: number }[]; format: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.map(d => d.y)), w = 100 / Math.max(1, data.length);
  return <figure className="bar-series" aria-label={label}><svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
    {data.map((d, i) => <rect key={d.x} x={i * w + w * .15} width={w * .7} y={40 - (d.y / max) * 38} height={Math.max(.3, (d.y / max) * 38)} rx=".6"><title>{`${d.x}: ${format(d.y)}`}</title></rect>)}
  </svg><figcaption><span>{data[0]?.x}</span><span>máx. {format(max === 1 && !data.some(d => d.y) ? 0 : max)}</span><span>{data.at(-1)?.x}</span></figcaption></figure>;
}

export function Distribution({ items, format = String }: { items: { label: string; value: number }[]; format?: (n: number) => string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return <ul className="distribution">{items.map(i => <li key={i.label}><span>{i.label}</span><strong>{format(i.value)}</strong>
    <i aria-hidden="true"><b style={{ width: `${total ? (i.value / total) * 100 : 0}%` }}/></i></li>)}</ul>;
}
