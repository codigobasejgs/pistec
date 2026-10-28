import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { isTourVisible, tourIndex } from '../../app/tour-targets';
import { adminTours, type AdminTourStep } from './helpContent';

/** Tour do Super Admin (e da contratação): mesmas classes e regras do tour das lojas (destaca o [data-tour] real). */
export default function AdminTour({ onClose, initial, tours = adminTours, storage = 'pistec-admin-tour', label = 'Tour guiado do Super Admin', missingText = 'Elemento indisponível agora: pode depender do seu perfil ou de haver dados.' }: {
  onClose: () => void; initial?: string; tours?: Record<string, { label: string; steps: (Omit<AdminTourStep, 'route'> & { route?: string })[] }>; storage?: string; label?: string; missingText?: string }) {
  const navigate = useNavigate(), location = useLocation();
  const [module, setModule] = useState(() => initial ?? (() => { try { return sessionStorage.getItem(`${storage}-next`) ?? Object.keys(tours)[0]; } catch { return Object.keys(tours)[0]; } })());
  const steps = tours[module]?.steps ?? [];
  const key = `${storage}-${module}`;
  const [index, setIndex] = useState(() => { try { return tourIndex(localStorage.getItem(key), steps.length); } catch { return 0; } });
  const [rect, setRect] = useState<DOMRect | null>(null), [missing, setMissing] = useState(false);
  const pop = useRef<HTMLDivElement>(null); const step = steps[Math.min(index, steps.length - 1)];
  useEffect(() => { try { localStorage.setItem(key, String(index)); sessionStorage.removeItem(`${storage}-next`); } catch { /* opcional */ } }, [key, index, storage]);
  useEffect(() => {
    if (!step) return; let cancelled = false; setRect(null); setMissing(false);
    if (step.route && location.pathname !== step.route) navigate(step.route);
    let tries = 0;
    const tick = () => { if (cancelled) return; const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (isTourVisible(el)) { el!.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); setTimeout(() => !cancelled && setRect(el!.getBoundingClientRect()), 260); return; }
      if (++tries > 30) { setMissing(true); return; } setTimeout(tick, 120); };
    tick(); return () => { cancelled = true; };
  }, [step, navigate, location.pathname]);
  useEffect(() => { if (!step) return; const u = () => { const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`); if (isTourVisible(el)) setRect(el!.getBoundingClientRect()); }; addEventListener('resize', u); addEventListener('scroll', u, true); return () => { removeEventListener('resize', u); removeEventListener('scroll', u, true); }; }, [step]);
  useLayoutEffect(() => { pop.current?.focus(); }, [index, module]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if ((e.target as HTMLElement)?.matches('input,textarea,select')) return; if (e.key === 'ArrowRight') setIndex(i => Math.min(steps.length - 1, i + 1)); if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1)); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [steps.length, onClose]);
  const mobile = innerWidth < 640, pad = 8, last = index >= steps.length - 1;
  const pos = rect && !mobile ? (() => { const w = 360, h = 230; const top = rect.bottom + 14 + h < innerHeight ? rect.bottom + 14 : Math.max(12, rect.top - h - 14); return { top, left: Math.min(Math.max(12, rect.left), innerWidth - w - 12), width: w }; })() : undefined;
  return <div className="tour-layer" role="dialog" aria-modal="false" aria-label={label}>
    {rect ? <div className="tour-spotlight" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}/> : <div className="tour-dim"/>}
    <div ref={pop} tabIndex={-1} className={`tour-popover ${mobile || !rect ? 'is-docked' : ''}`} style={pos}>
      <div className="tour-head"><select aria-label="Tour" value={module} onChange={e => { setModule(e.target.value); setIndex(0); }}>{Object.entries(tours).map(([k, t]) => <option key={k} value={k}>Tour: {t.label}</option>)}</select><button className="icon-button" aria-label="Encerrar tour" onClick={onClose}><X size={16}/></button></div>
      {step && <><span className="eyebrow">PASSO {Math.min(index, steps.length - 1) + 1} DE {steps.length}</span><h3>{step.title}</h3><p>{missing ? `${step.text} (${missingText})` : step.text}</p>
        <div className="tour-progress" aria-hidden="true"><i style={{ width: `${((Math.min(index, steps.length - 1) + 1) / steps.length) * 100}%` }}/></div>
        <div className="tour-actions"><button className="btn ghost" onClick={() => setIndex(0)}>Reiniciar</button><button className="btn" disabled={!index} onClick={() => setIndex(i => i - 1)}>Voltar</button>{last ? <button className="btn primary" onClick={onClose}>Concluir</button> : <button className="btn primary" onClick={() => setIndex(i => i + 1)}>Avançar</button>}</div>
        <button className="text-button tour-skip" onClick={onClose}>Pular tour</button></>}
    </div></div>;
}
