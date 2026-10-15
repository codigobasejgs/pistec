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
    { target: 'pdv-open-cash', title: '1. Abra o caixa', text: 'Antes de vender, abra o caixa da filial informando o dinheiro inicial (troco disponível na gaveta).', route: 'pdv' },
    { target: 'pdv-search', title: '2. Procure o produto', text: 'Digite o nome, o código do produto (SKU) ou leia o código de barras.', route: 'pdv' },
    { target: 'pdv-product', title: '3. Adicione ao carrinho', text: 'Toque em "Adicionar". O saldo disponível na filial aparece no cartão do produto.', route: 'pdv' },
    { target: 'pdv-cart', title: '4. Confira o carrinho', text: 'Altere a quantidade ou remova itens. O total é recalculado na hora.', route: 'pdv' },
    { target: 'pdv-customer', title: '5. Cliente (opcional)', text: 'Escolha um cliente cadastrado ou deixe "Consumidor não identificado".', route: 'pdv' },
    { target: 'pdv-discount', title: '6. Desconto', text: 'Informe desconto em reais ou porcentagem. O sistema não deixa o total ficar negativo.', route: 'pdv' },
    { target: 'pdv-payment', title: '7. Forma de pagamento', text: 'Informe quanto o cliente entregou em cada forma. Pode misturar Pix, cartão e dinheiro.', route: 'pdv' },
    { target: 'pdv-change', title: '8. Troco', text: 'Só o dinheiro gera troco. Cartão e Pix não podem passar do total da venda.', route: 'pdv' },
    { target: 'pdv-finish', title: '9. Finalize', text: 'Toque uma vez em finalizar. O estoque baixa e o caixa recebe apenas o valor líquido em dinheiro.', route: 'pdv' },
  ],
  financeiro: [
    { target: 'finance-kpis', title: 'Resumo financeiro', text: 'Recebido e pago consideram só baixas registradas. "A receber" e "a pagar" mostram o saldo em aberto.', route: 'financeiro' },
    { target: 'finance-new', title: '1. Crie uma conta', text: 'Lance uma conta a pagar ou a receber com categoria, valor e vencimento.', route: 'financeiro' },
    { target: 'finance-search', title: '2. Encontre a conta', text: 'Busque pela descrição ou filtre pela situação (em aberto, parcialmente paga, quitada).', route: 'financeiro' },
    { target: 'finance-table', title: '3. Valor original, pago e saldo', text: 'O valor original nunca muda. O saldo diminui a cada baixa registrada.', route: 'financeiro' },
    { target: 'finance-settle', title: '4. Registre a baixa', text: 'Pode receber ou pagar só uma parte. Baixas acima do saldo são bloqueadas.', route: 'financeiro' },
    { target: 'finance-history', title: '5. Histórico e estorno', text: 'Veja cada baixa com data, forma e responsável. Estorne informando o motivo se lançou errado.', route: 'financeiro' },
  ],
  caixa: [
    { target: 'cash-open', title: 'Abrir o caixa', text: 'Informe o dinheiro inicial da gaveta. Só é possível um caixa aberto por filial.', route: 'caixa' },
    { target: 'cash-close', title: 'Fechar o caixa', text: 'Conte o dinheiro e informe o valor. Se houver diferença, explique o motivo; ela fica registrada.', route: 'caixa' },
    { target: 'cash-history', title: 'Fechamentos anteriores', text: 'Consulte esperado, contado, diferença e quem fechou cada caixa.', route: 'caixa' },
  ],
  produtos: [
    { target: 'products-search', title: '1. Pesquise', text: 'Busque por nome, código do produto (SKU), código de barras ou marca.', route: 'produtos' },
    { target: 'products-category', title: '2. Filtre por categoria', text: 'Mostre apenas uma categoria para achar peças mais rápido.', route: 'produtos' },
    { target: 'products-new', title: '3. Cadastre um produto', text: 'Abre o formulário em seções: identificação, preços, estoque e dados fiscais.', route: 'produtos' },
    { target: 'products-form-sku', before: 'products-new', title: '4. Código do produto (SKU)', text: 'Um código único por empresa. Use o da etiqueta ou crie o seu.', route: 'produtos' },
    { target: 'products-form-cost', before: 'products-new', title: '5. Preço de custo', text: 'Quanto você pagou. Serve para calcular margem e valor do estoque.', route: 'produtos' },
    { target: 'products-form-price', before: 'products-new', title: '6. Preço de venda', text: 'A margem e o markup são calculados automaticamente enquanto você digita.', route: 'produtos' },
    { target: 'products-save', before: 'products-new', title: '7. Salve', text: 'Depois de salvar, o produto aparece na lista e no PDV.', route: 'produtos' },
    { target: 'products-import', title: 'Importar planilha', text: 'Traga muitos produtos de uma vez (CSV ou XLSX), com prévia e escolha entre criar ou atualizar.', route: 'produtos' },
    { target: 'products-template', title: 'Modelo da planilha', text: 'Baixe o modelo para preencher as colunas no formato certo.', route: 'produtos' },
    { target: 'products-export', title: 'Exportar', text: 'Gere uma planilha CSV com os produtos filtrados.', route: 'produtos' },
  ],
  crm: [
    { target: 'crm-kpis', title: 'Funil de vendas', text: 'Oportunidades abertas, ganhas e valor em negociação.', route: 'crm' },
    { target: 'crm-new', title: 'Nova oportunidade', text: 'Registre o interesse do cliente, valor estimado e próximo contato.', route: 'crm' },
    { target: 'crm-kanban', title: 'Quadro de etapas', text: 'Mude a etapa pelo seletor do cartão. Ao perder, informe o motivo.', route: 'crm' },
  ],
  'ordens-servico': [
    { target: 'os-kpis', title: 'Painel da oficina', text: 'Quantas OS estão abertas, em execução, prontas e atrasadas.', route: 'ordens-servico' },
    { target: 'ordens-servico-new', title: '1. Abra uma OS', text: 'Escolha cliente e veículo, descreva o problema e o mecânico responsável.', route: 'ordens-servico' },
    { target: 'ordens-servico-kanban', title: '2. Acompanhe as etapas', text: 'Em execução as peças ficam reservadas; ao marcar Pronta elas saem do estoque.', route: 'ordens-servico' },
  ],
  agenda: [
    { target: 'agenda-kpis', title: 'Agendamentos', text: 'Atendimentos do dia e confirmados.', route: 'agenda' },
    { target: 'agenda-new', title: 'Novo agendamento', text: 'Data, horário, duração e mecânico. Conflitos de horário do mesmo mecânico geram aviso.', route: 'agenda' },
    { target: 'agenda-kanban', title: 'Situação dos agendamentos', text: 'Confirme, conclua ou cancele. Converta em orçamento quando o cliente chegar.', route: 'agenda' },
  ],
  whatsapp: [
    { target: 'whatsapp-list', title: 'Conversas', text: 'Atendimentos desta empresa. É uma simulação: nenhuma mensagem real é enviada.', route: 'whatsapp' },
    { target: 'whatsapp-search', title: 'Busca', text: 'Encontre a conversa pelo nome ou telefone do cliente.', route: 'whatsapp' },
    { target: 'whatsapp-quick-replies', title: 'Respostas rápidas', text: 'Toque para preencher uma mensagem pronta e ajuste antes de registrar.', route: 'whatsapp' },
    { target: 'whatsapp-compose-type', title: 'Mensagem ou nota interna', text: 'Notas internas ficam amarelas e só a equipe vê.', route: 'whatsapp' },
    { target: 'whatsapp-customer-panel', title: 'Ficha do cliente', text: 'OS, orçamentos e consentimento de contato sem sair da conversa (telas largas).', route: 'whatsapp' },
  ],
  relatorios: [
    { target: 'reports-type', title: 'Escolha o relatório', text: 'Vendas, estoque, financeiro, OS e outros, sempre a partir dos registros reais.', route: 'relatorios' },
    { target: 'reports-kpis', title: 'Totais', text: 'Totais do período e filtros escolhidos.', route: 'relatorios' },
    { target: 'reports-table', title: 'Detalhes', text: 'Cada linha que compõe o total.', route: 'relatorios' },
    { target: 'reports-export', title: 'Exportar CSV', text: 'Abra no Excel ou Google Planilhas.', route: 'relatorios' },
    { target: 'reports-print', title: 'Imprimir ou salvar PDF', text: 'Usa a impressão do navegador; escolha "Salvar como PDF" no destino.', route: 'relatorios' },
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
