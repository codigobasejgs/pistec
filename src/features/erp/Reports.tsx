import { useMemo, useState } from 'react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { date, money, today } from '../../lib';
import { ChartTooltip, DataTable, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import { decimal, inPeriod } from './logic';
import { ExportButton, SelectField, TextField, useErp } from './shared';
import { entryBalance, entryPaid } from '../../domain';

interface Aggregate { name: string; count: number; total: number; cost: number }

const REPORT_LABELS: Record<string, string> = {
  products: 'Produtos vendidos',
  sellers: 'Vendas por vendedor',
  customers: 'Vendas por cliente',
  payments: 'Formas de pagamento',
  days: 'Vendas por dia',
  finance: 'Financeiro por categoria',
  orders: 'Ordens de serviço',
  stock: 'Posição atual de estoque',
};

export default function Reports() {
  const { state, session, download } = useErp('relatorios');
  const [start, setStart] = useState(`${today().slice(0, 7)}-01`), [end, setEnd] = useState(today()), [branch, setBranch] = useState(session.branchId), [report, setReport] = useState('products');
  const [printModal, setPrintModal] = useState(false);

  const tenant = state.tenants.find(t => t.id === session.tenantId);
  const branchName = branch ? state.branches.find(b => b.id === branch)?.name || 'Filial' : 'Todas as filiais';

  const data = useMemo(() => {
    const scoped = (row: { tenantId: string; branchId: string }) => row.tenantId === session.tenantId && (!branch || row.branchId === branch);
    const sales = state.sales.filter(sale => scoped(sale) && inPeriod(sale.date, start, end));
    const completed = sales.filter(sale => sale.status === 'Concluída');
    const finances = state.finances.filter(entry => scoped(entry) && !entry.cancelled && inPeriod(entry.dueDate, start, end));
    const records = state.records.filter(record => scoped(record) && inPeriod(record.date, start, end) && record.kind === 'ordens-servico');
    const groups = new Map<string, Aggregate>();
    const add = (name: string, count: number, total: number, cost = 0) => { const existing = groups.get(name) || { name, count: 0, total: 0, cost: 0 }; existing.count += count; existing.total += total; existing.cost += cost; groups.set(name, existing); };
    if (report === 'products') completed.forEach(sale => sale.items.forEach(item => add(item.name, item.quantity, item.quantity * item.price, item.quantity * item.cost)));
    if (report === 'sellers') completed.forEach(sale => add(sale.seller, 1, sale.total, sale.items.reduce((sum, item) => sum + item.quantity * item.cost, 0)));
    if (report === 'customers') completed.forEach(sale => add(state.customers.find(customer => customer.id === sale.customerId && customer.tenantId === session.tenantId)?.name || 'Consumidor não identificado', 1, sale.total));
    if (report === 'payments') completed.forEach(sale => sale.payments.forEach(payment => add(payment.method, 1, payment.amount)));
    if (report === 'days') completed.forEach(sale => add(sale.date.slice(0, 10), 1, sale.total, sale.items.reduce((sum, item) => sum + item.quantity * item.cost, 0)));
    if (report === 'finance') finances.forEach(entry => add(`${entry.type} · ${entry.category} · ${entryPaid(entry) >= entry.amount ? 'Quitada' : 'Em aberto'}`, 1, entry.type === 'Receita' ? entryBalance(entry) : -entryBalance(entry)));
    if (report === 'orders') records.forEach(record => add(record.status, 1, record.amount, record.items.reduce((sum, item) => sum + item.quantity * item.cost, 0)));
    if (report === 'stock') state.balances.filter(scoped).forEach(balance => { const product = state.products.find(item => item.id === balance.productId && item.tenantId === session.tenantId); if (product) add(product.name, balance.quantity, balance.quantity * product.price, balance.quantity * product.cost); });
    const revenue = completed.reduce((sum, sale) => sum + sale.total, 0);
    const cost = completed.reduce((sum, sale) => sum + sale.items.reduce((total, item) => total + item.quantity * item.cost, 0), 0);
    // Contas em aberto com base no saldo e excluindo canceladas
    const receivable = finances.filter(entry => entry.type === 'Receita').reduce((sum, entry) => sum + entryBalance(entry), 0);
    const payable = finances.filter(entry => entry.type === 'Despesa').reduce((sum, entry) => sum + entryBalance(entry), 0);
    return { groups: [...groups.values()].sort((a, b) => report === 'days' ? a.name.localeCompare(b.name) : b.total - a.total), revenue, cost, completed: completed.length, cancelled: sales.length - completed.length, receivable, payable };
  }, [state, session.tenantId, branch, start, end, report]);

  const hasCost = ['products', 'sellers', 'days', 'stock', 'orders'].includes(report);
  const chartData = data.groups.slice(0, 10).map(g => ({ name: g.name.length > 18 ? `${g.name.slice(0, 16)}…` : g.name, total: g.total }));

  return <div className="page stack"><PageHeader title="Relatórios" subtitle="Agregações dos registros reais salvos neste dispositivo; sem valores fictícios.">
    <ExportButton tour="reports-export" onClick={() => download(`relatorio-${report}`, data.groups.map(row => ({ grupo: row.name, quantidade: row.count, valor: decimal(row.total), ...(hasCost ? { custo: decimal(row.cost), margem: decimal(row.total - row.cost) } : {}), inicio: start, fim: end, filial: branchName })))} />
    <button type="button" className="btn" data-tour="reports-print" onClick={() => setPrintModal(true)}><Printer size={16} aria-hidden="true" /> Imprimir / salvar PDF</button>
  </PageHeader>
  <Panel><div className="toolbar">
    <SelectField label="Relatório" value={report} onChange={setReport} tour="reports-type">{Object.entries(REPORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
    <SelectField label="Filial" value={branch} onChange={setBranch} tour="reports-branch"><option value="">Todas as filiais</option>{state.branches.filter(row => row.tenantId === session.tenantId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectField>
    <TextField label="De" type="date" value={start} onChange={setStart} />
    <TextField label="Até" type="date" value={end} onChange={setEnd} />
  </div>{start && end && start > end && <p role="alert">A data inicial deve ser anterior à final.</p>}</Panel>
  <div className="grid grid-4" data-tour="reports-kpis">
    <Stat label="Vendas concluídas no período" value={money(data.revenue)} icon={<FileSpreadsheet size={20} />} />
    <Stat label="Margem bruta das vendas" value={money(data.revenue - data.cost)} hint="Receita líquida de descontos menos custo dos itens; não inclui despesas operacionais." />
    <Stat label="Ticket médio" value={money(data.completed ? Math.round(data.revenue / data.completed) : 0)} hint={`${data.completed} concluídas · ${data.cancelled} canceladas`} />
    <Stat label="Saldo de contas em aberto" value={money(data.receivable - data.payable)} hint={`Receber ${money(data.receivable)} · Pagar ${money(data.payable)}`} />
  </div>

  {/* Gráfico comparativo dos 10 maiores grupos */}
  {chartData.length > 0 && <Panel title="Visualização comparativa (Top 10)"><div role="img" aria-label={`Gráfico de ${REPORT_LABELS[report] || 'relatório'}`} style={{ width: '100%', height: 240 }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 20 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={40} />
        <YAxis tickFormatter={v => `R$ ${(v / 100).toLocaleString('pt-BR', { notation: 'compact' })}`} tick={{ fill: 'var(--muted)', fontSize: 11 }} width={70} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="total" name="Valor" fill="var(--chart-line, #3b82f6)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div></Panel>}

  <Panel title="Detalhamento agregado"><div data-tour="reports-table">{data.groups.length ? <DataTable rows={data.groups.map(row => ({ ...row, id: row.name }))} columns={[{ key: 'name', label: 'Grupo' }, { key: 'count', label: report === 'products' || report === 'stock' ? 'Unidades' : 'Registros' }, { key: 'total', label: report === 'stock' ? 'Valor de venda potencial' : 'Valor', render: (row: Aggregate) => money(row.total) }, ...(hasCost ? [{ key: 'cost', label: 'Custo', render: (row: Aggregate) => money(row.cost) }, { key: 'margin', label: 'Margem bruta', render: (row: Aggregate) => money(row.total - row.cost) }] : [])]} /> : <Empty text="Nenhum dado para os filtros selecionados. Registre operações ou amplie o período." />}</div><p className="muted">{report === 'products' ? 'Produtos: valores brutos dos itens, antes dos descontos e acréscimos da venda. O total pode diferir da receita líquida.' : report === 'stock' ? 'Estoque: posição atual, independentemente do período. Não representa receita realizada. Indicadores superiores continuam usando o período.' : report === 'finance' ? 'Financeiro agrupado pelo vencimento, com base nos saldos em aberto. Despesas exibidas com sinal negativo.' : report === 'orders' ? 'Ordens agrupadas pela data de criação. Valores de OS não são contabilizados como vendas realizadas.' : 'Vendas canceladas excluídas dos valores agregados.'}</p></Panel>

  {/* Modal de impressão com cabeçalho completo; renderiza em .modal-content preservado no print CSS */}
  <Modal title="Impressão de relatório" size="xl" open={printModal} onClose={() => setPrintModal(false)} footer={<div className="toolbar" style={{ justifyContent: 'space-between', width: '100%' }}><span className="muted">Use a caixa de diálogo do navegador para selecionar "Salvar como PDF" ou sua impressora.</span><div className="toolbar"><button type="button" className="btn" onClick={() => setPrintModal(false)}>Fechar</button><button type="button" className="btn primary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Imprimir agora</button></div></div>}>
    <article className="stack" style={{ padding: '8px 4px' }}>
      <header style={{ borderBottom: '2px solid var(--border)', paddingBottom: 12 }}>
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{tenant?.name || 'PISTEC ERP'}</h2>
            <p className="muted" style={{ margin: '2px 0 0' }}>{tenant?.legalName ? `${tenant.legalName} · ` : ''}{tenant?.document || ''}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="badge info">{branchName}</span>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>Gerado em: {new Date().toLocaleString('pt-BR')}</p>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: '.84rem' }}>
          <span><strong>Relatório:</strong> {REPORT_LABELS[report]}</span>
          <span><strong>Período:</strong> {date(start)} a {date(end)}</span>
          <span><strong>Emissor:</strong> {session.name}</span>
        </div>
      </header>

      <section className="grid grid-4" style={{ margin: '12px 0' }}>
        <Stat label="Receita no período" value={money(data.revenue)} />
        <Stat label="Margem bruta" value={money(data.revenue - data.cost)} />
        <Stat label="Ticket médio" value={money(data.completed ? Math.round(data.revenue / data.completed) : 0)} />
        <Stat label="Contas em aberto" value={money(data.receivable - data.payable)} />
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Grupo / Item</th>
              <th>Qtd.</th>
              <th>Valor total</th>
              {hasCost && <><th>Custo</th><th>Margem</th></>}
            </tr>
          </thead>
          <tbody>
            {data.groups.map(row => <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.count}</td>
              <td>{money(row.total)}</td>
              {hasCost && <><td>{money(row.cost)}</td><td>{money(row.total - row.cost)}</td></>}
            </tr>)}
            {data.groups.length > 0 && <tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
              <td>TOTAIS</td>
              <td>{data.groups.reduce((s, r) => s + r.count, 0)}</td>
              <td>{money(data.groups.reduce((s, r) => s + r.total, 0))}</td>
              {hasCost && <><td>{money(data.groups.reduce((s, r) => s + r.cost, 0))}</td><td>{money(data.groups.reduce((s, r) => s + (r.total - r.cost), 0))}</td></>}
            </tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.75rem', marginTop: 12 }}>Documento interno demonstrativo gerado por PISTEC ERP.</p>
    </article>
  </Modal>
  </div>;
}
