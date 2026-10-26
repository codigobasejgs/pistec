import { useState, type CSSProperties } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Monitor, Palette, RotateCcw, Save, Smartphone, Undo2, Upload, LayoutDashboard, Package, Boxes, Wallet } from 'lucide-react';
import { rpc, useDemo } from '../../store';
import { can } from '../../domain';
import { imageData } from '../../lib';
import { Badge, Field, PageHeader, Panel, useNotice } from '../../ui';
import type { Branding, Theme } from '../../types';
import MyApp from './MyApp';

export const PALETTES: { name: string; primary: string; secondary: string; accent: string; sidebar: string; theme: Theme }[] = [
  { name: 'PISTEC Original', primary: '#007bff', secondary: '#00e5ff', accent: '#ffb020', sidebar: '#0c172b', theme: 'dark' },
  { name: 'Racing Orange', primary: '#ea580c', secondary: '#fb923c', accent: '#facc15', sidebar: '#1c1310', theme: 'dark' },
  { name: 'Corporate Blue', primary: '#1d4ed8', secondary: '#38bdf8', accent: '#f59e0b', sidebar: '#0f1e3d', theme: 'light' },
  { name: 'Emerald Pro', primary: '#047857', secondary: '#34d399', accent: '#fbbf24', sidebar: '#0a221c', theme: 'dark' },
  { name: 'Graphite Premium', primary: '#475569', secondary: '#94a3b8', accent: '#eab308', sidebar: '#111318', theme: 'dark' },
  { name: 'Minimal Light', primary: '#0f172a', secondary: '#2563eb', accent: '#d97706', sidebar: '#1e293b', theme: 'light' },
];
export const DEFAULT_BRANDING: Omit<Branding, 'logo' | 'footer' | 'widgets'> = { primary: '#007bff', secondary: '#00e5ff', accent: '#ffb020', sidebar: '#0c172b', theme: 'dark', font: 'Inter', density: 'comfortable', radius: 'default' };

/** Razão de contraste WCAG entre duas cores hex. */
export function contrast(a: string, b = '#ffffff') {
  const lum = (hex: string) => { const c = (hex.slice(1).match(/.{2}/g) ?? ['0', '0', '0']).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + .05) / (l2 + .05);
}

export default function BrandingPage() {
  const { state, session, perform } = useDemo(); const notice = useNotice();
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const [branding, setBranding] = useState<Branding>(() => structuredClone(tenant.branding));
  const [name, setName] = useState(tenant.name);
  const [mobile, setMobile] = useState(false); const [pending, setPending] = useState(false);
  const allowed = can(session.role, 'personalizacao', 'editar');
  const dirty = JSON.stringify(branding) !== JSON.stringify(tenant.branding) || name !== tenant.name;
  const set = <K extends keyof Branding>(key: K, value: Branding[K]) => setBranding(b => ({ ...b, [key]: value }));
  const ratio = contrast(branding.primary); const sidebarRatio = contrast(branding.sidebar);
  const save = async () => {
    setPending(true);
    try {
      if (!name.trim()) throw new Error('Informe o nome fantasia.');
      // Isolamento: grava somente no tenant da sessão; Super Admin nunca lê esta marca.
      await perform(s => { if (!can(session.role, 'personalizacao', 'editar')) throw new Error('Perfil sem permissão.'); const t = s.tenants.find(t => t.id === tenant.id)!; t.branding = structuredClone(branding); t.name = name.trim().slice(0, 120); }, rpc('update_branding', { p_tenant: tenant.id, p_branding: branding, p_name: name.trim() }));
      notice('Identidade salva somente nesta empresa.');
    } catch (e) { notice((e as Error).message); } finally { setPending(false); }
  };
  const previewTheme = branding.theme === 'light' ? 'light' : 'dark';
  const spark = [3, 5, 4, 7, 6, 9, 8, 11].map((v, i) => ({ i, v }));
  return <div className="page">
    <PageHeader title="Personalização" subtitle="Sua marca, seu ambiente. As outras empresas e o Super Admin permanecem intactos.">
      <button className="btn" disabled={!dirty || pending} onClick={() => { setBranding(structuredClone(tenant.branding)); setName(tenant.name); }}><Undo2 size={16}/>Cancelar alterações</button>
      <button className="btn primary" data-tour="brand-save" disabled={!dirty || pending || !allowed} onClick={() => void save()}><Save size={16}/>{pending ? 'Salvando…' : 'Salvar identidade'}</button>
    </PageHeader>
    {!allowed && <p className="callout warning">Seu perfil pode visualizar, mas não salvar a personalização.</p>}
    {dirty && <p className="callout">Você está vendo uma prévia. Nada foi aplicado ainda.</p>}
    <div className="branding-layout"><div className="stack">
      <Panel title="Identidade da empresa"><div data-tour="brand-logo"><div className="branding-logo"><img src={branding.logo || '/brand/logo-horizontal.webp'} alt="Prévia da marca"/></div>
        <div className="form-grid"><Field label="Nome fantasia"><input value={name} maxLength={120} onChange={e => setName(e.target.value)}/></Field><Field label="Logotipo" hint="PNG, JPEG ou WebP · até 2 MB · até 4096 px"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const f = e.target.files?.[0]; if (f) try { set('logo', await imageData(f)); } catch (err) { notice((err as Error).message); } e.target.value = ''; }}/></Field></div>
        <button className="text-button" onClick={() => set('logo', '')}><Upload size={14}/>Usar marca padrão PISTEC</button></div></Panel>
      <Panel title="Paletas prontas"><div className="palette-grid" data-tour="brand-palettes">{PALETTES.map(p => <button key={p.name} className={`palette-card ${branding.primary === p.primary && branding.sidebar === p.sidebar ? 'active' : ''}`} onClick={() => setBranding(b => ({ ...b, primary: p.primary, secondary: p.secondary, accent: p.accent, sidebar: p.sidebar, theme: p.theme }))}><span className="swatches">{[p.sidebar, p.primary, p.secondary, p.accent].map(c => <i key={c} style={{ background: c }}/>)}</span><strong>{p.name}</strong><small>{p.theme === 'dark' ? 'Tema escuro' : 'Tema claro'}</small></button>)}</div></Panel>
      <Panel title="Cores"><div className="form-grid" data-tour="brand-colors">{([['primary', 'Cor primária'], ['secondary', 'Cor secundária'], ['accent', 'Destaque'], ['sidebar', 'Sidebar']] as const).map(([key, label]) => <Field key={key} label={label}><div className="color-field"><input type="color" value={branding[key]} onChange={e => set(key, e.target.value)} aria-label={label}/><code>{branding[key]}</code></div></Field>)}</div>
        <div className="contrast-row"><Badge>{ratio >= 4.5 ? 'Contraste AA' : ratio >= 3 ? 'Contraste mínimo' : 'Contraste baixo'}</Badge><span className="muted small">Primária × texto branco: {ratio.toFixed(1)}:1 · Sidebar × texto claro: {sidebarRatio.toFixed(1)}:1.{ratio < 3 ? ' Escolha uma cor mais escura para botões legíveis.' : ''}</span></div></Panel>
      <Panel title="Preferências visuais"><div className="form-grid">
        <Field label="Tema"><select value={branding.theme} onChange={e => set('theme', e.target.value as Theme)}><option value="dark">Escuro</option><option value="light">Claro</option><option value="system">Automático do sistema</option></select></Field>
        <Field label="Tipografia"><select value={branding.font} onChange={e => set('font', e.target.value)}><option value="Inter">Inter / sistema</option><option value="Arial">Arial</option><option value="Verdana">Verdana</option><option value="Trebuchet MS">Trebuchet</option></select></Field>
        <Field label="Densidade das tabelas"><select value={branding.density} onChange={e => set('density', e.target.value as Branding['density'])}><option value="comfortable">Confortável</option><option value="compact">Compacta</option></select></Field>
        <Field label="Arredondamento"><select value={branding.radius ?? 'default'} onChange={e => set('radius', e.target.value as Branding['radius'])}><option value="compact">Discreto</option><option value="default">Padrão</option><option value="round">Arredondado</option></select></Field>
        <Field label="Rodapé dos documentos"><input value={branding.footer} maxLength={180} onChange={e => set('footer', e.target.value)}/></Field>
      </div>
        <button className="btn" onClick={() => { if (confirm('Restaurar as cores e preferências padrão PISTEC na prévia? (só será aplicado ao salvar)')) setBranding(b => ({ ...b, ...DEFAULT_BRANDING, logo: '' })); }}><RotateCcw size={15}/>Restaurar padrão</button></Panel>
      <MyApp logo={branding.logo} primary={branding.primary}/>
    </div>
      <Panel className="branding-preview"><div data-tour="brand-preview"><div className="panel-heading"><h2><Palette size={18}/>Prévia em tempo real</h2><div className="toolbar"><button className={`icon-button ${!mobile ? 'is-active' : ''}`} aria-pressed={!mobile} aria-label="Prévia desktop" onClick={() => setMobile(false)}><Monitor size={18}/></button><button className={`icon-button ${mobile ? 'is-active' : ''}`} aria-pressed={mobile} aria-label="Prévia mobile" onClick={() => setMobile(true)}><Smartphone size={18}/></button></div></div>
        <div className={`preview-frame radius-${branding.radius ?? 'default'} ${mobile ? 'phone' : ''}`} data-theme={previewTheme} style={{ '--brand': branding.primary, '--secondary': branding.secondary, '--accent': branding.accent, '--chart-line': branding.secondary, fontFamily: `${branding.font}, "Segoe UI", system-ui, sans-serif` } as CSSProperties}>
          <div className="preview-sidebar" style={{ background: branding.sidebar }}><img src={branding.logo || '/brand/symbol.webp'} alt=""/><span className="on"><LayoutDashboard size={13}/>Dashboard</span><span><Package size={13}/>Produtos</span><span><Boxes size={13}/>Estoque</span><span><Wallet size={13}/>Financeiro</span></div>
          <div className="preview-main"><small className="muted">{name || 'Sua empresa'}</small><h3>Olá! Sua operação, do seu jeito.</h3>
            <div className="grid grid-2"><div className="stat blue"><div className="stat-top"><span>Vendas do dia</span></div><strong>R$ 2.450</strong></div><div className="stat amber"><div className="stat-top"><span>Estoque baixo</span></div><strong>18</strong></div></div>
            <div className="preview-chart"><ResponsiveContainer width="100%" height={70}><AreaChart data={spark}><Area dataKey="v" type="monotone" stroke="var(--chart-line)" fill="var(--chart-line)" fillOpacity={.18} strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>
            <div className="table-wrap"><table><thead><tr><th><span className="table-sort">Produto</span></th><th><span className="table-sort">Saldo</span></th></tr></thead><tbody><tr><td>Filtro de óleo</td><td>12</td></tr><tr><td>Pastilha de freio</td><td>4</td></tr></tbody></table></div>
            <label className="field"><span>Campo de formulário</span><input readOnly value="Exemplo"/></label>
            <div className="toolbar"><button className="btn primary" tabIndex={-1}>Botão primário</button><button className="btn" tabIndex={-1}>Secundário</button></div>
            <p className="muted small">Prévia ilustrativa de estilo; valores fictícios.</p></div></div></div></Panel>
    </div>
  </div>;
}
