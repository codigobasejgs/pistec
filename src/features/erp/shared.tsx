import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Download, Search } from 'lucide-react';
import { useDemo } from '../../store';
import { can } from '../../domain';
import { exportCsv, money } from '../../lib';
import { Field, useNotice } from '../../ui';
import type { DemoState, Product, SaleItem } from '../../types';
import { cents, csvSafe, decimal } from './logic';

export function useErp(module: string) {
  const demo = useDemo();
  const notice = useNotice();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const allowed = (action = 'visualizar') => can(demo.session.role, module, action);
  async function run(action: (draft: DemoState) => void, message = 'Alterações salvas.', permission = 'editar') {
    if (lock.current) return false;
    if (!allowed(permission)) { notice('Seu perfil não permite esta ação.'); return false; }
    lock.current = true; setPending(true);
    try { await demo.mutate(action); notice(message); return true; }
    catch (error) { notice(error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'); return false; }
    finally { lock.current = false; setPending(false); }
  }
  function download(name: string, rows: Record<string, unknown>[]) {
    if (!allowed('exportar')) { notice('Seu perfil não permite exportar.'); return; }
    try { exportCsv(name, csvSafe(rows)); } catch (error) { notice(error instanceof Error ? error.message : 'Falha ao exportar.'); }
  }
  return { ...demo, notice, pending, run, allowed, download };
}
export function useSearchQuery() {
  const [params, setParams] = useSearchParams();
  return [params.get('q') || '', (value: string) => setParams(current => { const next = new URLSearchParams(current); if (value) next.set('q', value); else next.delete('q'); return next; }, { replace: true })] as const;
}
export function SearchBox({ value, onChange, placeholder = 'Buscar registros' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="toolbar"><Search size={17} aria-hidden="true" /><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
export function ExportButton({ onClick }: { onClick: () => void }) { return <button className="btn" onClick={onClick}><Download size={16} aria-hidden="true" /> Exportar CSV</button>; }
export function FormActions({ pending, onClose, label = 'Salvar' }: { pending: boolean; onClose: () => void; label?: string }) {
  return <div className="toolbar"><button className="btn" type="button" disabled={pending} onClick={onClose}>Cancelar</button><button className="btn primary" type="submit" disabled={pending}>{pending ? 'Salvando…' : label}</button></div>;
}
export function TextField({ label, value, onChange, type = 'text', required = false, min, step, max }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; required?: boolean; min?: number; max?: number; step?: string }) {
  return <Field label={label}><input aria-label={label} type={type} value={value} required={required} min={min} max={max} step={step} onChange={event => onChange(event.target.value)} /></Field>;
}
export function SelectField({ label, value, onChange, children, required }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; required?: boolean }) {
  return <Field label={label}><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} required={required}>{children}</select></Field>;
}
export function ItemEditor({ items, onChange, products, cost = false }: { items: SaleItem[]; onChange: (items: SaleItem[]) => void; products: Product[]; cost?: boolean }) {
  const [productId, setProductId] = useState('');
  const [error, setError] = useState('');
  function add() {
    const product = products.find(item => item.id === productId);
    if (!product) { setError('Selecione um produto.'); return; }
    if (items.some(item => item.productId === productId)) { setError('Produto já incluído; altere a quantidade.'); return; }
    onChange([...items, { productId, name: product.name, quantity: 1, price: cost ? product.cost : product.price, cost: product.cost }]); setError('');
  }
  return <fieldset className="stack"><legend>Itens e produtos</legend><div className="toolbar"><select aria-label="Produto para adicionar" value={productId} onChange={event => setProductId(event.target.value)}><option value="">Selecione um produto</option>{products.filter(product => product.active).map(product => <option key={product.id} value={product.id}>{product.name} · {money(cost ? product.cost : product.price)}</option>)}</select><button type="button" className="btn" onClick={add}><Plus size={16} aria-hidden="true" /> Adicionar item</button></div>{error && <p role="alert">{error}</p>}{items.map((item, index) => <div className="form-grid" key={item.productId}><span>{item.name}</span><TextField label={`Quantidade de ${item.name}`} type="number" min={1} step="1" required value={item.quantity} onChange={value => onChange(items.map((row, i) => i === index ? { ...row, quantity: Number(value) } : row))} /><Field label={`Preço de ${item.name}`}><input aria-label={`Preço de ${item.name}`} required inputMode="decimal" defaultValue={decimal(item.price)} key={`${item.productId}-${cost}`} onChange={event => { try { const price = cents(event.target.value); event.target.setCustomValidity(''); onChange(items.map((row, i) => i === index ? { ...row, price, ...(cost ? { cost: price } : {}) } : row)); setError(''); } catch { event.target.setCustomValidity('Informe um preço válido com até duas casas decimais.'); setError('Revise o preço informado antes de salvar.'); } }} /></Field><button type="button" className="btn danger" aria-label={`Remover ${item.name}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}</fieldset>;
}
