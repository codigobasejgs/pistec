import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useDemo } from '../store';
import { tours, tourFor } from './tours';
import type { TourStep } from '../types';
import { can } from '../domain';
import { isTourVisible as visible, tourIndex } from './tour-targets';

const findTarget = (step: TourStep) => document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);

/**
 * Tour por componente: destaca o elemento real ([data-tour]), rola até ele e explica.
 * Abre no módulo atual; `before` clica em outro alvo antes (ex.: abrir o formulário).
 * Progresso salvo por empresa/papel/módulo (preferência local, opcional).
 */
export default function Tour({ onClose }: { onClose: () => void }) {
  const { state, session } = useDemo(); const navigate = useNavigate(); const location = useLocation();
  const base = `/loja/${state.tenants.find(t => t.id === session.tenantId)?.slug}`;
  const [module, setModule] = useState(() => tourFor(location.pathname));
  const steps = tours[module] ?? [];
  const key = `pistec-tour-${session.tenantId}-${session.role}-${module}`;
  const [index, setIndex] = useState(() => { try { return tourIndex(localStorage.getItem(key), steps.length); } catch { return 0; } });
  const [rect, setRect] = useState<DOMRect | null>(null); const [missing, setMissing] = useState(false);
  const popover = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];

  useEffect(() => { try { localStorage.setItem(key, String(index)); } catch { /* preferência opcional */ } }, [key, index]);
  // Navega para a rota do passo, executa o pré-clique e localiza o alvo (espera render lazy).
  useEffect(() => {
    if (!step) return; let cancelled = false; setRect(null); setMissing(false);
    // Rota do passo: route explícita (''=raiz) ou o próprio módulo.
    const sub = step.route ?? module;
    const route = `${base}${sub ? `/${sub}` : ''}`;
    if (location.pathname !== route) navigate(route);
    let tries = 0; let preClicked = false;
    const tick = () => {
      if (cancelled) return;
      if (step.before && !preClicked) { const pre = document.querySelector<HTMLElement>(`[data-tour="${step.before}"]`); if (pre && !findTarget(step)) { pre.click(); preClicked = true; } }
      const el = findTarget(step);
      if (visible(el)) { el!.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); setTimeout(() => !cancelled && setRect(el!.getBoundingClientRect()), 260); return; }
      if (++tries > 25) { setMissing(true); return; }
      setTimeout(tick, 120);
    };
    tick();
    return () => { cancelled = true; };
  }, [step, base, module, navigate, location.pathname]);
  // Acompanha rolagem/redimensionamento.
  useEffect(() => { if (!step) return; const update = () => { const el = findTarget(step); if (visible(el)) setRect(el!.getBoundingClientRect()); }; addEventListener('resize', update); addEventListener('scroll', update, true); return () => { removeEventListener('resize', update); removeEventListener('scroll', update, true); }; }, [step]);
  useLayoutEffect(() => { popover.current?.focus(); }, [index, module]);
  const next = useCallback(() => setIndex(i => i + 1 >= steps.length ? i : i + 1), [steps.length]);
  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if ((e.target as HTMLElement)?.matches('input,textarea,select')) return; if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); }; addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey); }, [next, prev, onClose]);

  const modules = Object.keys(tours).filter(m => can(session.role, m, 'visualizar'));
  const last = index >= steps.length - 1;
  // Posição do popover: abaixo do alvo, acima se não couber; no mobile, fixo no rodapé.
  const mobile = innerWidth < 640; const pad = 8;
  const pos = rect && !mobile ? (() => { const w = 360, h = 230; const top = rect.bottom + 14 + h < innerHeight ? rect.bottom + 14 : Math.max(12, rect.top - h - 14); const left = Math.min(Math.max(12, rect.left), innerWidth - w - 12); return { top, left, width: w }; })() : undefined;

  return <div className="tour-layer" role="dialog" aria-modal="false" aria-label="Tour guiado">
    {rect ? <div className="tour-spotlight" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}/> : <div className="tour-dim"/>}
    <div ref={popover} tabIndex={-1} className={`tour-popover ${mobile || !rect ? 'is-docked' : ''}`} style={pos}>
      <div className="tour-head"><select aria-label="Módulo do tour" value={module} onChange={e => { setModule(e.target.value); setIndex(0); }}>{modules.map(m => <option key={m} value={m}>{tours[m][0]?.title ? `Tour: ${labelOf(m)}` : m}</option>)}</select><button className="icon-button" aria-label="Encerrar tour" onClick={onClose}><X size={16}/></button></div>
      {step ? <><span className="eyebrow">PASSO {Math.min(index, steps.length - 1) + 1} DE {steps.length}</span><h3>{step.title}</h3><p>{missing ? `${step.text} (Este elemento não está disponível agora — pode depender do seu perfil, do plano ou de um registro selecionado.)` : step.text}</p>
        <div className="tour-progress" aria-hidden="true"><i style={{ width: `${((Math.min(index, steps.length - 1) + 1) / steps.length) * 100}%` }}/></div>
        <div className="tour-actions"><button className="btn ghost" onClick={() => setIndex(0)}>Reiniciar</button><button className="btn" disabled={!index} onClick={prev}>Voltar</button>{last ? <button className="btn primary" onClick={onClose}>Concluir</button> : <button className="btn primary" onClick={next}>Avançar</button>}</div>
        <button className="text-button tour-skip" onClick={onClose}>Pular tour</button></> : <p>Não há tour para esta tela. Escolha um módulo acima.</p>}
    </div>
  </div>;
}
const labelOf = (m: string) => ({ dashboard: 'Dashboard', produtos: 'Produtos', estoque: 'Estoque', inventario: 'Inventário', vendas: 'Vendas', pdv: 'PDV', caixa: 'Caixa', clientes: 'Clientes', crm: 'CRM', veiculos: 'Veículos', orcamentos: 'Orçamentos', 'ordens-servico': 'Ordens de serviço', agenda: 'Agenda', compras: 'Compras', financeiro: 'Financeiro', 'contas-receber': 'Contas a receber', 'contas-pagar': 'Contas a pagar', whatsapp: 'WhatsApp', relatorios: 'Relatórios', funcionarios: 'Funcionários', filiais: 'Filiais', personalizacao: 'Personalização', 'minha-assinatura': 'Minha assinatura' } as Record<string, string>)[m] ?? m;
