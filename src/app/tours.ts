import type { TourStep } from '../types';

/** Passos de tour guiado por módulo do sistema. target = data-tour. */
export const tours: Record<string, TourStep[]> = {
  dashboard: [
    { target: 'shell-navigation', title: 'Menu de módulos', text: 'Os módulos estão agrupados por área operacional. Use a busca interna para localizar rotas rapidamente.' },
    { target: 'shell-search', title: 'Busca universal', text: 'Ctrl+K encontra produtos, clientes, veículos, OS, orçamentos e vendas da empresa ativa.' },
    { target: 'shell-branch', title: 'Filial ativa', text: 'Estoque, caixa e indicadores refletem rigorosamente a filial selecionada no topo.' },
    { target: 'dash-kpis', title: 'Indicadores operacionais', text: 'Calculados em tempo real a partir das vendas concluídas, do estoque e das ordens de serviço.' },
    { target: 'dash-sales', title: 'Vendas por período', text: 'Troque o período ou filtre datas personalizadas. O botão "Ver dados" exibe a tabela acessível.' },
    { target: 'dash-mix', title: 'Mix de produtos', text: 'Distribuição percentual e contagem de itens vendidos por categoria no período.' },
    { target: 'dash-quick', title: 'Ações rápidas', text: 'Atalhos diretos para abrir vendas, criar OS, cadastrar clientes e dar entrada em estoque.' },
    { target: 'dash-widgets', title: 'Personalize o painel', text: 'Mostre, oculte e reordene os blocos do dashboard conforme a rotina da sua equipe.' },
    { target: 'shell-account', title: 'Perfil e tour', text: 'Alterne entre os 9 papéis de acesso demonstrativos e reinicie o tour quando quiser.' },
  ],
  pdv: [
    { target: 'pdv-search', title: 'Busca de produtos', text: 'Adicione itens por código de barras, SKU ou descrição com busca rápida.', route: 'pdv' },
    { target: 'pdv-cart', title: 'Carrinho da venda', text: 'Altere quantidades, confira preços unitários e remova itens em tempo real.', route: 'pdv' },
    { target: 'pdv-customer', title: 'Identificação do cliente', text: 'Vincule a venda a um cliente cadastrado ou finalize no balcão avulso.', route: 'pdv' },
    { target: 'pdv-discount', title: 'Descontos e acréscimos', text: 'Aplique desconto em reais ou porcentagem com validação de limite.', route: 'pdv' },
    { target: 'pdv-payments', title: 'Pagamento múltiplo', text: 'Combine Dinheiro, Pix e Cartão. O sistema calcula o valor líquido e troco.', route: 'pdv' },
    { target: 'pdv-summary', title: 'Resumo e troco', text: 'Validação instantânea: impede pagamentos insuficientes e excedentes em cartão.', route: 'pdv' },
    { target: 'pdv-finish', title: 'Concluir venda', text: 'Emissão rápida do comprovante não fiscal com trava contra duplo clique.', route: 'pdv' },
  ],
  financeiro: [
    { target: 'fin-kpis', title: 'Indicadores financeiros', text: 'Acompanhe saldo em caixa, receitas liquidadas, despesas pagas e saldos a vencer.', route: 'financeiro' },
    { target: 'fin-tabs', title: 'Lançamentos e Caixa', text: 'Alterne entre títulos a pagar/receber e a conferência diária do caixa.', route: 'financeiro' },
    { target: 'fin-new', title: 'Novo lançamento', text: 'Registre contas a pagar ou a receber com categoria, centro de custo e vencimento.', route: 'financeiro' },
    { target: 'fin-table', title: 'Controle de saldo e baixas', text: 'Visualize valor original, valor pago, saldo restante e registre baixas parciais.', route: 'financeiro' },
    { target: 'caixa-status', title: 'Turno do caixa', text: 'Verifique se o caixa da filial está aberto ou fechado pelo operador.', route: 'caixa' },
    { target: 'caixa-close', title: 'Fechamento de caixa', text: 'Informe o valor contado; divergências exigem justificativa obrigatória e auditada.', route: 'caixa' },
  ],
  produtos: [
    { target: 'produtos-kpis', title: 'Visão do catálogo', text: 'Total de itens ativos, valor patrimonial em estoque e alertas de reposição.', route: 'produtos' },
    { target: 'produtos-import-btn', title: 'Importação XLSX e CSV', text: 'Importe produtos em massa com mapeamento automático de colunas e prévia.', route: 'produtos' },
    { target: 'produtos-template-btn', title: 'Planilha modelo', text: 'Baixe o modelo CSV pré-formatado para organizar seu catálogo antes de importar.', route: 'produtos' },
    { target: 'produtos-new', title: 'Novo produto', text: 'Cadastro com seções e cálculo automático em tempo real de margem e markup.', route: 'produtos' },
  ],
  crm: [
    { target: 'crm-kpis', title: 'Funil de vendas', text: 'Acompanhe oportunidades ativas, taxa de conversão e valor total no pipeline.', route: 'crm' },
    { target: 'crm-kanban', title: 'Quadro de negociações', text: 'Mova cards entre etapas do funil e registre justificativas de perda.', route: 'crm' },
  ],
  'ordens-servico': [
    { target: 'ordens-servico-kpis', title: 'Painel da oficina', text: 'Visão consolidada de serviços abertos, em execução, prontos e entregues.', route: 'ordens-servico' },
    { target: 'ordens-servico-kanban', title: 'Fluxo da oficina', text: 'Acompanhe veículos, prazos, mecânicos responsáveis e status de execução.', route: 'ordens-servico' },
    { target: 'ordens-servico-new', title: 'Nova OS', text: 'Abertura rápida com cliente, placa do veículo, checklist de entrada e diagnóstico.', route: 'ordens-servico' },
  ],
  agenda: [
    { target: 'agenda-kpis', title: 'Agendamentos', text: 'Total do dia, confirmados e taxa de comparecimento da oficina.', route: 'agenda' },
    { target: 'agenda-timeline', title: 'Grade horária e timeline', text: 'Linha do tempo diária com alerta de conflitos de horário para o mesmo mecânico.', route: 'agenda' },
  ],
  whatsapp: [
    { target: 'whatsapp-disclaimer', title: 'Simulador local', text: 'Ambiente seguro para testes demonstrativos sem envio real de mensagens externas.', route: 'whatsapp' },
    { target: 'whatsapp-quick-replies', title: 'Respostas rápidas', text: 'Mensagens pré-configuradas para agilizar o atendimento de balcão e pós-venda.', route: 'whatsapp' },
    { target: 'whatsapp-note-toggle', title: 'Notas internas', text: 'Recados amarelados visíveis exclusivamente para a sua equipe interna.', route: 'whatsapp' },
    { target: 'whatsapp-side-panel', title: 'Ficha do cliente', text: 'Consulte orçamentos, ordens de serviço e veículos sem sair da conversa.', route: 'whatsapp' },
  ],
  relatorios: [
    { target: 'relatorios-kpis', title: 'Totalizadores', text: 'Receita, despesa e saldo calculados a partir das liquidações reais.', route: 'relatorios' },
    { target: 'relatorios-chart', title: 'Gráficos gerenciais', text: 'Distribuição visual dos produtos e serviços mais vendidos por período.', route: 'relatorios' },
    { target: 'relatorios-print', title: 'Impressão A4 / PDF', text: 'Relatório limpo formatado com cabeçalho da empresa, pronto para salvar PDF.', route: 'relatorios' },
  ],
  personalizacao: [
    { target: 'brand-logo', title: 'Logotipo', text: 'Envie PNG, JPEG ou WebP de até 2 MB. Fica salvo exclusivamente nesta empresa.', route: 'personalizacao' },
    { target: 'brand-palettes', title: 'Paletas prontas', text: 'Aplique paletas profissionais com contraste pré-calculado e refine conforme desejar.', route: 'personalizacao' },
    { target: 'brand-colors', title: 'Cores e contraste', text: 'Contraste WCAG calculado ao vivo; botões ajustam o texto automaticamente.', route: 'personalizacao' },
    { target: 'brand-preview', title: 'Prévia em tempo real', text: 'Veja sidebar, cards, tabela, gráfico e formulário antes de salvar. Alterne desktop/mobile.', route: 'personalizacao' },
    { target: 'brand-save', title: 'Salvar identidade', text: 'Nada é aplicado na loja antes de salvar. Cancelar restaura a versão anterior.', route: 'personalizacao' },
  ],
  'minha-assinatura': [
    { target: 'sub-plan', title: 'Seu plano PISTEC', text: 'Plano, situação e vencimento da assinatura SaaS da plataforma.', route: 'minha-assinatura' },
    { target: 'sub-usage', title: 'Uso dos limites', text: 'Usuários, filiais, produtos e instâncias WhatsApp versus os limites contratados.', route: 'minha-assinatura' },
    { target: 'sub-change', title: 'Simulação de mudança', text: 'Simule upgrade e downgrade; limites menores que o uso atual bloqueiam a troca.', route: 'minha-assinatura' },
    { target: 'sub-invoices', title: 'Faturas SaaS', text: 'Faturas simuladas via Asaas e InfinitePay. Nenhum pagamento real é cobrado.', route: 'minha-assinatura' },
  ],
  admin: [
    { target: 'admin-kpis', title: 'Painel da plataforma', text: 'MRR, ARR, empresas ativas, inadimplência e novos clientes calculados ao vivo.', route: '' },
    { target: 'admin-companies', title: 'Gestão de empresas', text: 'Controle de tenants, filiais ativas, limites e situação cadastral.', route: 'empresas' },
    { target: 'admin-plans', title: 'Planos e limites', text: 'Tabela de preços mensal, trimestral, anual e limites que alimentam a landing page.', route: 'planos' },
    { target: 'admin-billing', title: 'Faturamento SaaS', text: 'Cobranças exclusivas da plataforma PISTEC (separadas das vendas das lojas).', route: 'cobrancas' },
    { target: 'admin-coupons', title: 'Cupons promocionais', text: 'Gerenciamento de cupons de desconto para a primeira fatura SaaS.', route: 'cobrancas' },
    { target: 'admin-support', title: 'Central de suporte', text: 'Acompanhamento de tickets demonstrativos de atendimento aos lojistas.', route: 'suporte' },
  ],
};

/** Identifica o tour correspondente ao caminho da URL. */
export function tourFor(pathname: string, admin: boolean): string {
  const parts = pathname.split('/').filter(Boolean);
  if (admin) {
    const sec = parts[1];
    if (sec === 'cobrancas') return 'admin';
    return sec && tours[`admin-${sec}`] ? `admin-${sec}` : 'admin';
  }
  const mod = parts[2] ?? 'dashboard';
  return tours[mod] ? mod : 'dashboard';
}
