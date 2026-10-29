import { useMemo, useState } from 'react';
import { useDemo } from '../../store';
import { DataTable, Empty, PageHeader, Panel, Stat } from '../../ui';
import { money, date } from '../../lib';
import { inPeriod } from '../erp/logic';
import { TextField } from '../erp/shared';
import { osProfit } from '../../services/workshop';
import { useWorkshop } from './useWorkshop';

/** Margem de contribuição por OS (antes de despesas indiretas). Acesso = permissão de Relatórios. */
export default function Profit() {
  const { state, session } = useDemo(); const { settings } = useWorkshop();
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const rows = useMemo(() => state.records.filter(r => r.tenantId === session.tenantId && r.branchId === session.branchId && r.kind === 'ordens-servico' && ['Pronta', 'Entregue'].includes(r.status) && inPeriod(r.date, start, end))
    .map(r => ({ id: r.id, record: r, ...osProfit(r, settings) })), [state, session, settings, start, end]);
  const tot = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenue, direct: t.direct + r.direct, margin: t.margin + r.margin }), { revenue: 0, direct: 0, margin: 0 });
  const low = rows.filter(r => r.marginPct !== null && r.marginPct < settings.lowMarginPct).length;
  return <div className="page stack">
    <PageHeader title="Lucro por OS" subtitle="Margem de contribuição de OS prontas e entregues, antes de despesas indiretas. Não é lucro líquido."/>
    <div className="grid grid-4" data-tour="profit-kpis">
      <Stat label="Receita das OS" value={money(tot.revenue)} tone="blue"/><Stat label="Custo direto" value={money(tot.direct)} tone="amber"/>
      <Stat label="Margem de contribuição" value={money(tot.margin)} hint={tot.revenue ? `${(tot.margin * 100 / tot.revenue).toFixed(1)}%` : '—'} tone={tot.margin >= 0 ? 'green' : 'red'}/>
      <Stat label={`Abaixo da meta (${settings.lowMarginPct}%)`} value={low} tone={low ? 'red' : 'green'}/>
    </div>
    <Panel><div className="toolbar"><TextField label="De" type="date" value={start} onChange={setStart}/><TextField label="Até" type="date" value={end} onChange={setEnd}/></div>
      {!settings.hourlyCost && <p className="callout warning">Custo/hora não configurado (AutoPilot → Regras de custo em Configurações da oficina): o custo de mão de obra própria está zerado e a margem fica superestimada.</p>}
      {!rows.length ? <Empty text="Nenhuma OS pronta ou entregue no período."/> : <DataTable rows={rows} columns={[
        { key: 'title', label: 'OS', render: (r: typeof rows[number]) => <>{r.record.title}<br/><small className="muted">{date(r.record.date)} · {r.record.status}</small></> },
        { key: 'revenue', label: 'Receita', render: (r: typeof rows[number]) => money(r.revenue) },
        { key: 'parts', label: 'Peças (custo)', render: (r: typeof rows[number]) => money(r.partsCost) },
        { key: 'labor', label: 'Mão de obra (custo)', render: (r: typeof rows[number]) => `${money(r.laborCost)} · ${r.hours}h${r.estimatedHours ? ` / ${r.estimatedHours}h prev.` : ''}` },
        { key: 'other', label: 'Terceiros + comissão', render: (r: typeof rows[number]) => money(r.thirdParty + r.commission) },
        { key: 'margin', label: 'Margem', render: (r: typeof rows[number]) => <strong style={{ color: r.margin < 0 ? 'var(--danger)' : undefined }}>{money(r.margin)}{r.marginPct !== null && ` (${r.marginPct}%)`}</strong> },
      ]}/>}
      <p className="muted small">Fórmula: receita da OS − (custo das peças + horas trabalhadas × custo/hora + serviços terceirizados + comissão sobre mão de obra). Horas, terceiros e comissão vêm da tela Mecânico (execução).</p>
    </Panel>
  </div>;
}
