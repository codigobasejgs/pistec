import type { DemoState, Plan, Session, OperationalRecord, Product, Tenant, Coupon } from './types';
import { completeSale, openCash, closeCash, receivePurchase, transitionRecord, convertRecord, validateState, domainClock } from './domain';

export const PLANS: Plan[] = [
  { id: 'essencial', name: 'Essencial', monthly: 12900, quarterly: 34900, annual: 123900, users: 2, branches: 1, products: 500, whatsapp: 1, trialMonths: 1, features: ['PDV e caixa', 'Produtos e estoque', 'Clientes', 'Financeiro básico'] },
  { id: 'profissional', name: 'Profissional', monthly: 24900, quarterly: 66900, annual: 238900, users: 5, branches: 1, products: 5000, whatsapp: 2, trialMonths: 1, features: ['Tudo do Essencial', 'Ordens de serviço', 'Compras', 'Relatórios', 'WhatsApp'] },
  { id: 'premium', name: 'Premium', monthly: 44900, quarterly: 120900, annual: 430900, users: 15, branches: 3, products: 20000, whatsapp: 5, trialMonths: 1, features: ['Tudo do Profissional', 'Múltiplas filiais', 'CRM', 'Automações', 'Personalização'] },
  { id: 'enterprise', name: 'Enterprise', monthly: 79900, quarterly: 239700, annual: 958800, users: 100, branches: 20, products: 100000, whatsapp: 20, trialMonths: 1, features: ['Tudo do Premium', 'Implantação assistida', 'Limites ampliados', 'Suporte prioritário'] },
];

export const INITIAL_SESSION: Session = { tenantId: 'tenant-premium', branchId: 'branch-premium-matriz', role: 'Proprietário', name: 'Carlos Silva', admin: false };

const catalog: [string, string, string, number, number][] = [
  ['Filtro de óleo PSL55', 'Filtros', 'Tecfil', 1850, 3490],
  ['Óleo sintético 5W30 1L', 'Lubrificantes', 'Mobil', 3250, 5490],
  ['Pastilha de freio dianteira', 'Freios', 'Fras-le', 8900, 15990],
  ['Disco de freio ventilado', 'Freios', 'Fremax', 12500, 21990],
  ['Vela de ignição NGK', 'Ignição', 'NGK', 2250, 3990],
  ['Correia dentada', 'Motor', 'Gates', 7800, 12990],
  ['Amortecedor dianteiro', 'Suspensão', 'Cofap', 21500, 34990],
  ['Bateria 60Ah', 'Elétrica', 'Moura', 34900, 52990],
  ['Palheta limpador 22 polegadas', 'Acessórios', 'Bosch', 2850, 4990],
  ['Fluido de freio DOT4', 'Lubrificantes', 'Bosch', 1990, 3490],
  ['Filtro de ar do motor', 'Filtros', 'Mann', 2450, 4590],
  ['Lâmpada H7 55W', 'Elétrica', 'Philips', 1890, 3290],
  ['Kit embreagem 200mm', 'Transmissão', 'Sachs', 29500, 47990],
  ['Terminal de direção', 'Suspensão', 'TRW', 4590, 7990],
  ['Sensor de temperatura', 'Injeção', 'MTE', 3290, 5990],
  ['Aditivo radiador 1L', 'Arrefecimento', 'Paraflu', 1790, 2990],
];
const names = ['Ana Martins', 'Bruno Almeida', 'Carla Souza', 'Diego Lima', 'Elisa Rocha', 'Felipe Nunes', 'Gabriela Dias', 'Henrique Melo', 'Isabela Santos', 'João Ribeiro', 'Larissa Freitas', 'Marcos Oliveira'];

/** Mesma data de referência gera mesmos dados; identidades e transações são fictícias. */
export function createSeed(reference = new Date()): DemoState {
  if (!Number.isFinite(reference.getTime())) throw new Error('Data de referência inválida.');
  const realClock = domainClock.now; domainClock.now = () => 0;
  try { return buildSeed(reference); } finally { domainClock.now = realClock; }
}
function buildSeed(reference: Date): DemoState {
  const anchor = new Date(`${reference.toISOString().slice(0, 10)}T12:00:00.000Z`);
  const at = (days: number, hour = 12) => {
    const value = new Date(anchor); value.setUTCDate(value.getUTCDate() + days); value.setUTCHours(hour, 0, 0, 0); return value.toISOString();
  };
  const date = (days: number) => at(days).slice(0, 10);
  const state: DemoState = {
    version: 2,
    tenants: [],
    plans: structuredClone(PLANS),
    branches: [],
    products: [],
    customers: [],
    balances: [],
    movements: [],
    sales: [],
    cashRegisters: [],
    finances: [],
    records: [],
    invoices: [],
    coupons: [],
    couponRedemptions: [],
    audit: [],
  };
  const definitions = [
    { key: 'autopecas', name: 'Auto Center Peças', slug: 'auto-center', owner: 'Rafael Mendes', profile: 'Autopeças', planId: 'essencial', color: '#f59e0b' },
    { key: 'oficina', name: 'Oficina Rota 88', slug: 'oficina-rota-88', owner: 'Camila Ribeiro', profile: 'Oficina mecânica', planId: 'profissional', color: '#38bdf8' },
    { key: 'premium', name: 'Moto Prime Peças', slug: 'moto-prime', owner: 'Carlos Silva', profile: 'Motopeças', planId: 'premium', color: '#3b82f6' },
  ];
  let sequence = 0;
  const addRecord = (owner: Tenant, kind: string, title: string, status: string, fields: Record<string, string> = {}, customerId = '', day = -5): OperationalRecord => {
    const row: OperationalRecord = { id: `seed-record-${++sequence}`, tenantId: owner.id, branchId: state.branches.find(row => row.tenantId === owner.id)!.id, kind, title, status, customerId, date: at(day), amount: 0, fields, items: [], history: [{ date: at(day), text: 'Registro demonstrativo criado.' }] };
    state.records.push(row); return row;
  };
  for (const [index, definition] of definitions.entries()) {
    const owner: Tenant = {
      id: `tenant-${definition.key}`, slug: definition.slug, name: definition.name, legalName: `${definition.name} Comércio e Serviços Ltda. (DEMO)`, document: '', owner: definition.owner, email: `contato@${definition.key}.example`, profile: definition.profile, planId: definition.planId, status: 'Ativa', dueDate: date(8 + index), notes: 'Dados fictícios para demonstração. Nenhuma cobrança ou contato real.',
      branding: { primary: definition.color, secondary: '#818cf8', accent: '#fb923c', sidebar: '#101827', theme: 'dark', logo: '', font: 'Inter', density: 'comfortable', radius: 'default', footer: 'PISTEC • Ambiente demonstrativo', widgets: ['revenue', 'sales', 'stock', 'services'] },
    };
    state.tenants.push(owner);
    const branches = [{ id: `branch-${definition.key}-matriz`, tenantId: owner.id, name: 'Matriz • Centro', active: true }];
    if (definition.key === 'premium') branches.push({ id: 'branch-premium-norte', tenantId: owner.id, name: 'Filial • Zona Norte', active: true });
    state.branches.push(...branches);
    catalog.forEach(([name, category, brand, cost, price], productIndex) => {
      const item: Product = { id: `product-${definition.key}-${productIndex + 1}`, tenantId: owner.id, name, sku: `${definition.key.slice(0, 3).toUpperCase()}-${String(productIndex + 1).padStart(4, '0')}`, barcode: `DEMO-${index + 1}-${String(productIndex + 1).padStart(6, '0')}`, category, brand, cost, price, min: 8, max: 150, location: `Corredor ${1 + productIndex % 3} / Prateleira ${1 + productIndex % 4}`, active: true, details: { application: ['VW Gol / Fox 1.6', 'Fiat Palio / Uno 1.0', 'Chevrolet Onix 1.0'][productIndex % 3], warranty: '90 dias', unit: 'UN', ncm: '87089990' } };
      state.products.push(item);
      for (const branch of branches) {
        const quantity = productIndex >= 14 ? 5 + productIndex % 2 : 60 + productIndex * 3;
        state.balances.push({ tenantId: owner.id, branchId: branch.id, productId: item.id, quantity, reserved: 0 });
        state.movements.push({ id: `seed-initial-${branch.id}-${item.id}`, tenantId: owner.id, branchId: branch.id, productId: item.id, quantity, type: 'Entrada', reference: 'Inventário inicial DEMO', date: at(-29, 7) });
      }
    });
    names.forEach((name, customerIndex) => {
      const customerId = `customer-${definition.key}-${customerIndex + 1}`;
      state.customers.push({ id: customerId, tenantId: owner.id, name, document: '', email: `cliente${customerIndex + 1}@${definition.key}.example`, phone: '', address: `Rua Demonstração, ${100 + customerIndex * 10} • Centro`, consent: customerIndex % 4 !== 0, notes: customerIndex % 3 === 0 ? 'Prefere agendamento pela manhã. Cadastro fictício.' : 'Cliente demonstrativo.' });
      if (customerIndex < 6) addRecord(owner, 'veiculos', ['VW Gol 1.6', 'Chevrolet Onix 1.0', 'Fiat Argo 1.3', 'Hyundai HB20', 'Renault Sandero', 'Toyota Corolla'][customerIndex], 'Ativo', { plate: `DEMO-${customerIndex + 1}`, model: ['Gol', 'Onix', 'Argo', 'HB20', 'Sandero', 'Corolla'][customerIndex], brand: ['Volkswagen', 'Chevrolet', 'Fiat', 'Hyundai', 'Renault', 'Toyota'][customerIndex], year: `${2018 + customerIndex % 5}`, mileage: `${35000 + customerIndex * 7200}`, color: ['Prata', 'Branco', 'Preto'][customerIndex % 3] }, customerId, -29);
    });
    addRecord(owner, 'fornecedores', 'Distribuidora Eixo Sul (DEMO)', 'Ativo', { contact: 'Paulo — demonstração', email: 'vendas@eixosul.example', phone: '', document: '', paymentTerms: '28 dias' }, '', -29);
    addRecord(owner, 'fornecedores', 'Peças e Cia Atacado (DEMO)', 'Ativo', { contact: 'Renata — demonstração', email: 'comercial@pecas.example', phone: '', paymentTerms: '14 dias' }, '', -29);
    addRecord(owner, 'funcionarios', definition.owner, 'Ativo', { role: 'Proprietário', email: `gestor@${definition.key}.example` }, '', -29);
    addRecord(owner, 'funcionarios', ['Paula Vieira', 'Lucas Teixeira', 'Renato Barros'][index], 'Ativo', { role: index === 0 ? 'Vendedor' : 'Mecânico', email: `equipe@${definition.key}.example` }, '', -29);
    addRecord(owner, 'instancias', 'Atendimento principal (simulado)', 'Conectada', { phone: '', provider: 'Demo', mock: 'true' }, '', -29);
    state.invoices.push({ id: `invoice-${definition.key}-paid`, tenantId: owner.id, amount: PLANS[index].monthly, status: 'Paga', dueDate: date(-21), provider: index % 2 ? 'InfinitePay' : 'Asaas', reference: `demo:subscription:${definition.key}:paid` }, { id: `invoice-${definition.key}-open`, tenantId: owner.id, amount: PLANS[index].monthly, status: 'Pendente', dueDate: date(8 + index), provider: index % 2 ? 'InfinitePay' : 'Asaas', reference: `demo:subscription:${definition.key}:open` });
    state.audit.push({ id: `seed-audit-${definition.key}`, tenantId: owner.id, date: at(-29, 7), action: 'Base demonstrativa iniciada.' });
  }
  // Reproduz dias em ordem para estoque, caixa, vendas e financeiro conciliarem.
  for (let day = -29; day <= 0; day++) {
    state.audit.push({ id: `seed-clock-${day}`, tenantId: INITIAL_SESSION.tenantId, date: at(day, 8), action: 'Abertura do dia demonstrativo.' });
    for (const [tenantIndex, owner] of state.tenants.entries()) {
      const products = state.products.filter(row => row.tenantId === owner.id);
      const customers = state.customers.filter(row => row.tenantId === owner.id);
      for (const [branchIndex, branch] of state.branches.filter(row => row.tenantId === owner.id).entries()) {
        openCash(state, owner.id, branch.id, 20000);
        const productIndex = ((day + 29) * 3 + tenantIndex + branchIndex) % 14;
        const item = products[productIndex];
        const quantity = 1 + (day + 29) % 2;
        const total = item.price * quantity;
        const method = ['Dinheiro', 'Pix', 'Crédito', 'Débito'][(day + 29 + tenantIndex) % 4];
        completeSale(state, { tenantId: owner.id, branchId: branch.id, customerId: customers[(day + 29) % customers.length].id, seller: owner.owner, items: [{ productId: item.id, quantity }], discount: 0, surcharge: 0, payments: [{ method, amount: total }], requestId: `seed:${branch.id}:${date(day)}` });
        if (day < 0) {
          const cash = state.cashRegisters.find(row => row.tenantId === owner.id && row.branchId === branch.id && !row.closedAt)!;
          const expected = cash.opening + cash.movements.reduce((total, row) => total + row.amount, 0);
          // Demonstração: no dia -2 na filial premium matriz, simula quebra de caixa de -R$ 20,00 (-2000 centavos) com motivo
          if (day === -2 && owner.id === 'tenant-premium' && branch.id === 'branch-premium-matriz') {
            closeCash(state, owner.id, cash.id, expected - 2000, 'Diferença de conferência no fechamento noturno (DEMO)', owner.owner);
          } else {
            closeCash(state, owner.id, cash.id, expected);
          }
        }
        if (day === -21 || day === -9) {
          const purchase = addRecord(owner, 'compras', `Reposição ${branch.name} • ${date(day)}`, 'Pendente', { supplierId: state.records.find(row => row.tenantId === owner.id && row.kind === 'fornecedores')!.id, dueDate: date(day + 28), expectedDate: date(day) }, '', day);
          purchase.branchId = branch.id;
          purchase.items = products.slice(0, 3).map(item => ({ productId: item.id, name: item.name, quantity: 12, price: item.price, cost: item.cost }));
          purchase.amount = purchase.items.reduce((total, item) => total + item.quantity * item.cost, 0);
          receivePurchase(state, owner.id, purchase.id);
        }
      }
      if ([-24, -17, -10].includes(day)) {
        const service = addRecord(owner, 'ordens-servico', `Revisão preventiva • ${customers[(day + 30) % 6].name}`, 'Aberta', { labor: '150.00', technician: 'Equipe técnica', complaint: 'Revisão periódica e troca de óleo', diagnosis: 'Troca de filtro e lubrificante', dueDate: date(day + 1), vehicleId: state.records.find(row => row.tenantId === owner.id && row.kind === 'veiculos')!.id }, customers[(day + 30) % 6].id, day);
        service.items = [{ productId: products[0].id, name: products[0].name, quantity: 1, price: products[0].price, cost: products[0].cost }];
        service.amount = products[0].price + 15000;
        transitionRecord(state, owner.id, service.id, 'Em diagnóstico');
        transitionRecord(state, owner.id, service.id, 'Em execução');
        transitionRecord(state, owner.id, service.id, 'Em testes');
        transitionRecord(state, owner.id, service.id, 'Pronta');
        transitionRecord(state, owner.id, service.id, 'Entregue');
        const fin = state.finances.find(row => row.reference === service.id && row.tenantId === owner.id)!;
        fin.paid = day < -10;
        if (fin.paid) {
          fin.settlements = [{
            id: `seed-settle-${service.id}`,
            requestId: `seed:settle:${service.id}`,
            amount: fin.amount,
            date: date(day),
            method: 'Pix',
            user: 'Equipe técnica',
            note: 'Quitação automática da OS',
          }];
        }
      }
      if (day === -15 || day === -3) {
        const expAmount = day === -15 ? 240000 : 46890;
        const expDate = date(day);
        const expPaid = day === -15;
        const expId = `seed-expense-${owner.id}-${day}`;
        const settlements = expPaid ? [{
          id: `seed-settle-${expId}`,
          requestId: `seed:settle:${expId}`,
          amount: expAmount,
          date: expDate,
          method: 'Boleto',
          user: owner.owner,
          note: 'Pagamento integral confirmado',
        }] : [];
        state.finances.push({
          id: expId,
          tenantId: owner.id,
          branchId: state.branches.find(row => row.tenantId === owner.id)!.id,
          type: 'Despesa',
          category: day === -15 ? 'Aluguel' : 'Energia',
          description: day === -15 ? 'Aluguel comercial' : 'Energia elétrica',
          amount: expAmount,
          dueDate: expDate,
          paid: expPaid,
          settlements,
          reference: `expense:${owner.id}:${day}`,
          date: at(day),
        });
      }
    }
  }
  for (const owner of state.tenants) {
    const products = state.products.filter(row => row.tenantId === owner.id);
    const customers = state.customers.filter(row => row.tenantId === owner.id);
    const vehicle = state.records.find(row => row.tenantId === owner.id && row.kind === 'veiculos')!;
    for (let index = 0; index < 6; index++) {
      const customer = customers[index];
      const service = addRecord(owner, 'ordens-servico', ['Troca de pastilhas', 'Diagnóstico de injeção', 'Revisão de suspensão', 'Troca de correia', 'Verificação elétrica', 'Alinhamento preventivo'][index], 'Aberta', { labor: '180.00', technician: 'Equipe técnica', dueDate: date(index % 3), complaint: ['Ruído ao frear', 'Luz de injeção acesa', 'Vibração na direção'][index % 3], diagnosis: '', vehicleId: vehicle.id }, customer.id, -4 + index % 3);
      const item = products[index + 2];
      service.items = [{ productId: item.id, name: item.name, quantity: 1, price: item.price, cost: item.cost }]; service.amount = item.price + 18000;
      if (index === 0) transitionRecord(state, owner.id, service.id, 'Em diagnóstico');
      if (index === 1) transitionRecord(state, owner.id, service.id, 'Aguardando aprovação');
      if (index === 2) { transitionRecord(state, owner.id, service.id, 'Em diagnóstico'); transitionRecord(state, owner.id, service.id, 'Aguardando peças'); }
      if (index >= 3) transitionRecord(state, owner.id, service.id, 'Em execução');
      if (index === 4) transitionRecord(state, owner.id, service.id, 'Em testes');
      if (index === 5) transitionRecord(state, owner.id, service.id, 'Pronta');
      const appointment = addRecord(owner, 'agenda', `Atendimento • ${customer.name}`, index < 2 ? 'Concluído' : index === 2 ? 'Confirmado' : 'Agendado', { date: date(index - 2), time: `${9 + index}:00`, dueDate: date(index - 2), technician: 'Equipe técnica', recordId: service.id, vehicleId: vehicle.id, notes: service.title }, customer.id, -5);
      const conversation = addRecord(owner, 'whatsapp', customer.name, index % 3 === 0 ? 'Pendente' : 'Em atendimento', { phone: '', unread: index % 3 === 0 ? '1' : '0', lastMessage: index % 2 ? 'Pode confirmar meu agendamento?' : 'Qual o prazo para a revisão?', channel: 'WhatsApp simulado', assignedTo: owner.owner, recordId: service.id }, customer.id, -index);
      addRecord(owner, 'mensagens', 'Olá! Gostaria de confirmar o atendimento.', 'Recebida', { conversationId: conversation.id, direction: 'inbound', body: 'Olá! Gostaria de confirmar o atendimento.', text: 'Olá! Gostaria de confirmar o atendimento.', sender: customer.name, simulated: 'true' }, customer.id, -index);
      addRecord(owner, 'mensagens', 'Olá! Seu atendimento está agendado. Mensagem demonstrativa.', 'Enviada', { conversationId: conversation.id, direction: 'outbound', body: 'Olá! Seu atendimento está agendado. Mensagem demonstrativa.', text: 'Olá! Seu atendimento está agendado. Mensagem demonstrativa.', sender: owner.owner, simulated: 'true' }, customer.id, -index);
      addRecord(owner, 'crm', `Revisão completa • ${customer.name}`, ['Novo', 'Em contato', 'Proposta', 'Ganho', 'Perdido', 'Proposta'][index], { source: 'WhatsApp', nextContact: date(index - 1), notes: 'Interesse em revisão preventiva', appointmentId: appointment.id, owner: owner.owner }, customer.id, -8 + index).amount = 35000 + index * 8500;
      const quote = addRecord(owner, 'orcamentos', `Orçamento • ${customer.name}`, ['Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Aprovado', 'Enviado'][index], { validUntil: date(5), labor: '120.00', vehicleId: vehicle.id }, customer.id, -5 + index % 3);
      quote.items = [{ productId: item.id, name: item.name, quantity: 1, price: item.price, cost: item.cost }]; quote.amount = item.price + 12000;
      if (index === 4) convertRecord(state, owner.id, quote.id, 'ordens-servico');
    }
    const pending = addRecord(owner, 'compras', 'Reposição semanal de lubrificantes', 'Pendente', { supplierId: state.records.find(row => row.tenantId === owner.id && row.kind === 'fornecedores')!.id, dueDate: date(14), expectedDate: date(2) });
    pending.items = [{ productId: products[1].id, name: products[1].name, quantity: 24, price: products[1].price, cost: products[1].cost }]; pending.amount = products[1].cost * 24;
    addRecord(owner, 'tarefas', 'Conferir estoque de sensores', 'Pendente', { dueDate: date(1), priority: 'Alta', assignedTo: owner.owner });
    addRecord(owner, 'tarefas', 'Retornar orçamentos enviados', 'Em andamento', { dueDate: date(0), priority: 'Média', assignedTo: owner.owner });
    addRecord(owner, 'notificacoes', 'Produtos abaixo do estoque mínimo', 'Não lida', { message: 'Sensores e aditivos precisam de reposição.', type: 'Estoque' }, '', 0);
    addRecord(owner, 'automacoes', 'Lembrete de revisão', 'Inativa', { trigger: '30 dias após serviço', action: 'Preparar mensagem simulada', enabled: 'false' });
    addRecord(owner, 'garantias', 'Garantia de revisão preventiva', 'Aberta', { dueDate: date(80), coverage: 'Mão de obra • 90 dias', recordId: state.records.find(row => row.tenantId === owner.id && row.kind === 'ordens-servico' && row.status === 'Entregue')!.id }, customers[0].id);
  }
  // Carteira SaaS: empresas só cadastradas (sem operação) para o Super Admin ter estados variados.
  const portfolio: [string, string, string, string, number][] = [
    ['Garage Speed Motos', 'garage-speed', 'Teste', 'profissional', 9], ['Center Car Peças', 'center-car', 'Vencida', 'essencial', -6],
    ['Rota Sul Autopeças', 'rota-sul', 'Suspensa', 'essencial', -25], ['Moto & Cia Acessórios', 'moto-cia', 'Ativa', 'premium', 18],
    ['Mecânica Bom Pistão', 'bom-pistao', 'Cancelada', 'profissional', -40],
  ];
  portfolio.forEach(([name, slug, status, planId, due], index) => {
    const id = `tenant-${slug}`; const plan = PLANS.find(p => p.id === planId)!;
    state.tenants.push({ ...structuredClone(state.tenants[0]), id, slug, name, legalName: `${name} Ltda. (DEMO)`, owner: names[index], email: `contato@${slug}.example`, planId, status, dueDate: date(due), notes: 'Empresa fictícia da carteira SaaS demonstrativa.' });
    state.branches.push({ id: `branch-${slug}-matriz`, tenantId: id, name: 'Matriz', active: true });
    state.invoices.push({ id: `invoice-${slug}`, tenantId: id, amount: plan.monthly, status: status === 'Vencida' || status === 'Suspensa' ? 'Vencida' : status === 'Cancelada' ? 'Cancelada' : status === 'Teste' ? 'Pendente' : 'Paga', dueDate: date(due), provider: index % 2 ? 'InfinitePay' : 'Asaas', reference: `demo:subscription:${slug}` });
  });
  const platform = (id: string, kind: string, title: string, status: string, fields: Record<string, string>, day: number): OperationalRecord => ({ id, tenantId: 'platform', branchId: '', kind, title, status, customerId: '', date: at(day), amount: 0, fields, items: [], history: [{ date: at(day), text: 'Registro demonstrativo.' }] });
  state.records.push(
    platform('ticket-1', 'admin-ticket', 'Dúvida sobre importação de produtos', 'Aberto', { tenant: 'Auto Center Peças', priority: 'Normal' }, -1),
    platform('ticket-2', 'admin-ticket', 'Solicitação de nova filial', 'Em andamento', { tenant: 'Moto Prime Peças', priority: 'Alta' }, -3),
    platform('ticket-3', 'admin-ticket', 'Ajuste de permissões do caixa', 'Resolvido', { tenant: 'Oficina Rota 88', priority: 'Baixa' }, -9),
    platform('lead-1', 'admin-lead', 'Paulo Henrique (DEMO)', 'Aberto', { email: 'paulo@exemplo.example', company: 'Moto Peças Litoral', consent: 'true' }, -2),
    platform('lead-2', 'admin-lead', 'Renata Vieira (DEMO)', 'Aberto', { email: 'renata@exemplo.example', company: 'Auto Elétrica Norte', consent: 'true' }, -5),
  );

  // Cupons SaaS demonstrativos (contrato item 8)
  const coupons: Coupon[] = [
    {
      id: 'coupon-pistec20',
      code: 'PISTEC20',
      description: '20% de desconto no plano Profissional ou Premium',
      kind: 'percent',
      value: 2000, // 2000 bps = 20%
      startsAt: date(-60),
      endsAt: date(60),
      maxUses: 100,
      perTenant: 1,
      planIds: ['profissional', 'premium'],
      periods: ['monthly', 'quarterly', 'annual'],
      active: true,
      scope: 'first',
    },
    {
      id: 'coupon-bemvindo50',
      code: 'BEMVINDO50',
      description: 'R$ 50,00 de desconto na primeira fatura',
      kind: 'fixed',
      value: 5000, // 5000 centavos = R$ 50,00
      startsAt: date(-30),
      endsAt: date(90),
      maxUses: 50,
      perTenant: 1,
      planIds: [],
      periods: [],
      active: true,
      scope: 'first',
    },
    {
      id: 'coupon-anual30',
      code: 'ANUAL30',
      description: '30% de desconto exclusivo em assinaturas anuais',
      kind: 'percent',
      value: 3000, // 3000 bps = 30%
      startsAt: date(-15),
      endsAt: date(45),
      maxUses: 20,
      perTenant: 1,
      planIds: ['profissional', 'premium', 'enterprise'],
      periods: ['annual'],
      active: true,
      scope: 'first',
    },
  ];
  state.coupons.push(...coupons);

  // Contas parcialmente pagas para demonstração de telas (item 8)
  const premiumTenant = state.tenants.find(t => t.id === 'tenant-premium')!;
  const premiumBranch = state.branches.find(b => b.tenantId === premiumTenant.id)!;
  const partial1 = {
    id: 'seed-expense-partial-1',
    tenantId: premiumTenant.id,
    branchId: premiumBranch.id,
    type: 'Despesa' as const,
    category: 'Manutenção',
    description: 'Reforma da bancada de testes (DEMO parcial)',
    amount: 150000, // R$ 1.500,00
    dueDate: date(5),
    paid: false,
    settlements: [{
      id: 'seed-settle-part-1',
      requestId: 'seed:settle:part-1',
      amount: 50000, // R$ 500,00 pagos (saldo R$ 1.000,00)
      date: date(-2),
      method: 'Pix',
      user: premiumTenant.owner,
      note: 'Entrada de 33% paga via Pix',
    }],
    reference: 'expense:demo:partial-1',
    date: at(-2),
  };
  const partial2 = {
    id: 'seed-revenue-partial-2',
    tenantId: premiumTenant.id,
    branchId: premiumBranch.id,
    type: 'Receita' as const,
    category: 'Serviços',
    description: 'Contrato frotista mensal (DEMO parcial)',
    amount: 320000, // R$ 3.200,00
    dueDate: date(-1), // Vencida parcialmente
    paid: false,
    settlements: [{
      id: 'seed-settle-part-2',
      requestId: 'seed:settle:part-2',
      amount: 120000, // R$ 1.200,00 pagos (saldo R$ 2.000,00)
      date: date(-5),
      method: 'Transferência',
      user: premiumTenant.owner,
      note: 'Primeira parcela recebida',
    }],
    reference: 'revenue:demo:partial-2',
    date: at(-5),
  };
  state.finances.push(partial1, partial2);

  validateState(state);
  return state;
}
