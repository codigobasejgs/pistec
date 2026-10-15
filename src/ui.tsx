import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownUp, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { money } from './lib';
import { useBusyGuard } from './pwa';

const NoticeContext = createContext<(message: string) => void>(() => {});
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const notice = useCallback((text: string) => { const id = Date.now() + Math.random(); setNotices(n => [...n.slice(-3), { id, text }]); setTimeout(() => setNotices(n => n.filter(x => x.id !== id)), 6500); }, []);
  return <NoticeContext.Provider value={notice}>{children}<div className="toasts" aria-live="polite">{notices.map(n => <div className="toast" key={n.id}>{n.text}<button aria-label="Fechar aviso" onClick={() => setNotices(v => v.filter(x => x.id !== n.id))}><X size={16}/></button></div>)}</div></NoticeContext.Provider>;
}
export const useNotice = () => useContext(NoticeContext);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'secondary', loading = false, icon, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`btn ${variant} ${loading ? 'is-loading' : ''} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>{loading ? <Loader2 size={16} className="spin" aria-hidden="true"/> : icon}{children}</button>;
}
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) { return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>{children && <div className="toolbar">{children}</div>}</header>; }
export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>; }
export function Stat({ label, value, hint, icon, tone = 'blue', trend, action }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: string; trend?: { value: number; label: string }; action?: ReactNode }) {
  return <article className={`stat ${tone}`}><div className="stat-top"><span>{label}</span>{icon && <span className="stat-icon" aria-hidden="true">{icon}</span>}</div><strong>{value}</strong>
    {trend && Number.isFinite(trend.value) && <span className={`trend ${trend.value >= 0 ? 'up' : 'down'}`}>{trend.value >= 0 ? <ArrowUpRight size={14} aria-hidden="true"/> : <ArrowDownRight size={14} aria-hidden="true"/>}{`${trend.value >= 0 ? '+' : ''}${trend.value.toFixed(1)}%`}<small>{trend.label}</small></span>}
    {hint && <small>{hint}</small>}{action && <div className="stat-action">{action}</div>}</article>;
}
export function Badge({ children }: { children: ReactNode }) { const text = String(children); const tone = /Conclu|Ativa|Aprovad|Entregue|Pag[ao]|Pronta|Recebid|Conectad|Quitad|Ganho/.test(text) ? 'success' : /Cancel|Vencid|Suspens|Recusad|Perdid/.test(text) ? 'danger' : /Aguard|Pendente|Aber|Teste|diagnóstico|Parcial/.test(text) ? 'warning' : 'info'; return <span className={`badge ${tone}`}>{children}</span>; }
export function Modal({ title, open, onClose, children, footer, size = 'md' }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  useBusyGuard(open); // formulário aberto: atualização do app pede confirmação
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={`modal-content size-${size}`} aria-describedby={undefined}><div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><button className="icon-button" aria-label="Fechar janela"><X size={20}/></button></Dialog.Close></div><div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <label className={`field ${error ? 'has-error' : ''}`}><span>{label}</span>{children}{error ? <em className="field-error" role="alert">{error}</em> : hint && <small className="field-hint">{hint}</small>}</label>; }
export function Empty({ text }: { text: string }) { return <div className="empty"><Inbox size={32} aria-hidden="true"/><p>{text}</p></div>; }

/** Campo monetário: digita reais, entrega centavos inteiros (sem float acumulado). */
export function MoneyInput({ value, onChange, ...rest }: { value: number; onChange: (cents: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => value ? (value / 100).toFixed(2).replace('.', ',') : '');
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setText(value ? (value / 100).toFixed(2).replace('.', ',') : ''); }
  return <input inputMode="decimal" placeholder="0,00" {...rest} value={text} onChange={e => { const raw = e.target.value.replace(/[^\d,.]/g, ''); setText(raw); const norm = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw; const cents = /^\d*(\.\d{0,2})?$/.test(norm) && norm !== '' && norm !== '.' ? Math.round(Number(norm) * 100) : 0; setLast(cents); onChange(cents); }}/>;
}
/** Tooltip Recharts com tokens do tema. */
export function ChartTooltip({ active, payload, label, currency = true }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; currency?: boolean }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((p, i) => <span key={i}><i style={{ background: p.color }}/>{p.name}: <b>{currency ? money(Number(p.value ?? 0)) : Number(p.value ?? 0).toLocaleString('pt-BR')}</b></span>)}</div>;
}

export function DataTable<T extends object>({ columns, rows, onRow, pageSize = 10 }: { columns: { key: string; label: string; render?: (row: T) => ReactNode }[]; rows: T[]; onRow?: (row: T) => void; pageSize?: number }) {
  const [page, setPage] = useState(0); const [sort, setSort] = useState<{ key: string; direction: number }>();
  const sorted = sort ? [...rows].sort((a, b) => { const av = a[sort.key as keyof T], bv = b[sort.key as keyof T]; return sort.direction * (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true })); }) : rows;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize)); const actualPage = Math.min(page, pages - 1);
  return <><div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c.key} aria-sort={sort?.key === c.key ? (sort.direction > 0 ? 'ascending' : 'descending') : undefined}><button className="table-sort" onClick={() => setSort(s => ({ key: c.key, direction: s?.key === c.key ? -s.direction : 1 }))}>{c.label}<ArrowDownUp size={12} aria-hidden="true"/></button></th>)}</tr></thead><tbody>{sorted.slice(actualPage * pageSize, actualPage * pageSize + pageSize).map((row, i) => <tr key={'id' in row ? String(row.id) : i} onClick={onRow ? () => onRow(row) : undefined} className={onRow ? 'clickable' : ''}>{columns.map((c, j) => <td key={c.key} data-label={c.label}>{j === 0 && onRow ? <button className="row-link" onClick={e => { e.stopPropagation(); onRow(row); }}>{c.render ? c.render(row) : String(row[c.key as keyof T] ?? '—')}</button> : c.render ? c.render(row) : String(row[c.key as keyof T] ?? '—')}</td>)}</tr>)}</tbody></table>{!rows.length && <Empty text="Nenhum registro encontrado. Ajuste os filtros ou cadastre o primeiro."/>}</div>{rows.length > pageSize && <div className="pagination"><span>{rows.length} registros</span><div><button className="icon-button" aria-label="Página anterior" disabled={actualPage === 0} onClick={() => setPage(actualPage - 1)}><ChevronLeft size={16}/></button><span>{actualPage + 1} de {pages}</span><button className="icon-button" aria-label="Próxima página" disabled={actualPage + 1 >= pages} onClick={() => setPage(actualPage + 1)}><ChevronRight size={16}/></button></div></div>}</>;
}
