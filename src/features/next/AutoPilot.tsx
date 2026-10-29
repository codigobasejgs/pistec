import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BellOff, Radar, Settings2 } from 'lucide-react';
import { useDemo } from '../../store';
import { Badge, Empty, Modal, PageHeader, Panel, Stat, useNotice } from '../../ui';
import { today } from '../../lib';
import { can } from '../../domain';
import { autopilot, type WorkshopSettings } from '../../services/workshop';
import { useWorkshop } from './useWorkshop';

const RULES: [keyof WorkshopSettings, string, string][] = [
  ['quoteFollowupDays', 'Orçamento sem resposta após (dias)', 'Orçamentos Abertos/Enviados sem atualização.'],
  ['osStaleDays', 'OS sem atualização após (dias)', 'OS em andamento sem movimentação no histórico.'],
  ['lowMarginPct', 'Meta de margem de contribuição (%)', 'OS prontas/entregues abaixo da meta.'],
  ['warrantyWarnDays', 'Garantia: avisar antes do vencimento (dias)', ''],
  ['maintenanceWarnDays', 'Revisão prevista: avisar com antecedência (dias)', 'Usa a data registrada na OS, nunca quilometragem presumida.'],
];

/** AutoPilot: regras determinísticas sobre os dados reais da filial. Modo informativo/assistido; nunca executa ações sozinho. */
export default function AutoPilot() {
  const { state, session, prefix } = useDemo(); const notice = useNotice();
  const { settings, save, dismiss, error } = useWorkshop();
  const [config, setConfig] = useState(false), [filter, setFilter] = useState('');
  const day = today();
  const alerts = useMemo(() => autopilot(state, session.tenantId, session.branchId, settings, day), [state, session, settings, day]);
  const base = `${prefix}/loja/${state.tenants.find(t => t.id === session.tenantId)?.slug}`;
  const shown = alerts.filter(a => !filter || a.severity === filter);
  const count = (s: string) => alerts.filter(a => a.severity === s).length;
  const canConfig = can(session.role, 'configuracoes', 'configurar');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { await save({ ...Object.fromEntries(RULES.map(([k]) => [k, Number(f.get(k))])), mode: f.get('mode') as WorkshopSettings['mode'] }); setConfig(false); notice('Regras salvas.'); } catch (err) { notice((err as Error).message); }
  }
  async function snooze(key: string) {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    try { await dismiss(key, until); notice('Alerta dispensado por 7 dias (registrado na auditoria).'); } catch (err) { notice((err as Error).message); }
  }
  return <div className="page stack">
    <PageHeader title="PISTEC AutoPilot" subtitle={`Pendências da filial calculadas agora a partir dos dados reais · modo ${settings.mode}`}>{canConfig && <button className="btn" data-tour="autopilot-config" onClick={() => setConfig(true)}><Settings2 size={16} aria-hidden="true"/>Regras</button>}</PageHeader>
    {error && <p role="alert">{error}</p>}
    <div className="grid grid-4" data-tour="autopilot-kpis">
      <Stat label="Pendências" value={alerts.length} tone="blue" icon={<Radar size={18}/>}/>
      <Stat label="Urgentes" value={count('alta')} tone={count('alta') ? 'red' : 'green'} icon={<AlertTriangle size={18}/>}/>
      <Stat label="Atenção" value={count('média')} tone="amber"/>
      <Stat label="Acompanhamento" value={count('baixa')} tone="cyan"/>
    </div>
    <Panel><div className="toolbar" role="group" aria-label="Filtrar por gravidade">{['', 'alta', 'média', 'baixa'].map(s => <button key={s} className={`btn ${filter === s ? 'primary' : ''}`} onClick={() => setFilter(s)}>{s || 'Todas'}</button>)}</div>
      {!shown.length ? <Empty text="Nenhuma pendência pelas regras configuradas. Bom trabalho!"/> :
        <ul className="autopilot-list" data-tour="autopilot-list">{shown.map(a => <li key={a.key} className={`autopilot-item sev-${a.severity === 'média' ? 'media' : a.severity}`}>
          <div><Badge>{a.severity === 'alta' ? 'Urgente' : a.severity === 'média' ? 'Atenção' : 'Acompanhar'}</Badge> <strong>{a.title}</strong><p className="muted small">{a.detail}</p></div>
          <div className="toolbar"><Link className="btn" to={`${base}/${a.module === 'estoque' ? 'estoque-inteligente' : a.module === 'relatorios' ? 'lucro-os' : a.module === 'clientes' ? 'fideliza' : a.module}${a.module === 'estoque' ? '' : a.recordId ? `?q=${encodeURIComponent(state.records.find(r => r.id === a.recordId)?.title ?? '')}` : ''}`}>Abrir</Link>
            {a.rule === 'os-aguardando-pecas' && <Link className="btn" to={`${base}/cotacoes`}>Cotar peças</Link>}
            <button className="btn ghost" onClick={() => void snooze(a.key)} aria-label={`Dispensar ${a.title}`}><BellOff size={16} aria-hidden="true"/>Dispensar 7 dias</button></div>
        </li>)}</ul>}
      <p className="muted small">O AutoPilot não envia mensagens, não compra e não altera valores sozinho: ele aponta e você decide. Regras: {RULES.map(r => `${r[1]} = ${settings[r[0]]}`).join(' · ')}.</p>
    </Panel>
    <Modal title="Regras do AutoPilot" open={config} onClose={() => setConfig(false)}><form className="stack" onSubmit={submit}>
      {RULES.map(([k, label, hint]) => <label key={k} className="field"><span>{label}</span><input name={k} type="number" min={0} max={k === 'lowMarginPct' ? 100 : 365} defaultValue={Number(settings[k])} required/>{hint && <small className="field-hint">{hint}</small>}</label>)}
      <label className="field"><span>Modo</span><select name="mode" defaultValue={settings.mode}><option value="informativo">Informativo (somente alerta)</option><option value="assistido">Assistido (prepara ações, exige confirmação)</option></select><small className="field-hint">O modo automatizado não está habilitado: nenhuma ação externa, financeira ou de compra é executada sem você.</small></label>
      <div className="toolbar"><button type="button" className="btn" onClick={() => setConfig(false)}>Cancelar</button><button className="btn primary">Salvar regras</button></div>
    </form></Modal>
  </div>;
}
