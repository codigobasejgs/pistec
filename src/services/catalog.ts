// Catálogo comercial de recursos. A mesma lista é gravada no banco (migração 20261105000100) e conferida por teste.
// Disponibilidade por plano = todos os módulos exigidos liberados pelo plano (mesma regra de app.require no servidor).
import type { Plan } from '../types';

export type FeatureStatus = 'disponivel' | 'requer_configuracao' | 'em_homologacao';
export type FeatureCategory = 'Gestão comercial' | 'Oficina' | 'Inteligência' | 'Relacionamento' | 'Administração';
export interface Feature { key: string; name: string; category: FeatureCategory; modules: string[]; status: FeatureStatus; summary: string; next?: boolean }

/** Módulos liberados em todos os planos (espelho da lista fixa de app.require). */
export const ALWAYS = ['dashboard', 'configuracoes', 'personalizacao', 'minha-assinatura', 'notificacoes', 'filiais', 'funcionarios', 'categorias', 'aplicacoes', 'tarefas', 'instancias'];

export const FEATURES: Feature[] = [
  { key: 'pdv', name: 'PDV e caixa', category: 'Gestão comercial', modules: ['pdv', 'caixa'], status: 'disponivel', summary: 'Venda no balcão com pagamentos mistos, troco e leitor de código de barras.' },
  { key: 'produtos_estoque', name: 'Produtos e estoque por filial', category: 'Gestão comercial', modules: ['produtos', 'estoque'], status: 'disponivel', summary: 'Catálogo, saldos, reservas, transferências e inventário.' },
  { key: 'vendas', name: 'Vendas', category: 'Gestão comercial', modules: ['vendas'], status: 'disponivel', summary: 'Histórico, cancelamento com estorno de estoque e financeiro.' },
  { key: 'clientes', name: 'Clientes', category: 'Gestão comercial', modules: ['clientes'], status: 'disponivel', summary: 'Cadastro com endereço por CEP e consentimento de contato.' },
  { key: 'crm', name: 'CRM', category: 'Gestão comercial', modules: ['crm'], status: 'disponivel', summary: 'Funil de oportunidades com motivo de perda.' },
  { key: 'financeiro', name: 'Financeiro', category: 'Gestão comercial', modules: ['financeiro'], status: 'disponivel', summary: 'Contas a pagar e receber, baixas parciais e estornos.' },
  { key: 'ordens_servico', name: 'Ordens de serviço', category: 'Oficina', modules: ['ordens-servico', 'veiculos'], status: 'disponivel', summary: 'Do diagnóstico à entrega, com reserva e baixa de peças.' },
  { key: 'orcamentos', name: 'Orçamentos', category: 'Oficina', modules: ['orcamentos'], status: 'disponivel', summary: 'Orçamento convertido em OS sem redigitar.' },
  { key: 'checkin_360', name: 'Check-in 360°', category: 'Oficina', modules: ['ordens-servico', 'veiculos'], status: 'disponivel', summary: 'Entrada do veículo com fotos, checklist, quilometragem e avarias.', next: true },
  { key: 'interactive_estimates', name: 'Orçamento interativo', category: 'Oficina', modules: ['orcamentos'], status: 'disponivel', summary: 'Cliente aprova ou recusa cada item pelo celular, com registro da decisão.', next: true },
  { key: 'smart_scheduling', name: 'Agenda inteligente', category: 'Oficina', modules: ['agenda'], status: 'disponivel', summary: 'Mecânicos e boxes sem conflito de horário.', next: true },
  { key: 'warranty_management', name: 'Garantias e retrabalho', category: 'Oficina', modules: ['garantias'], status: 'disponivel', summary: 'Garantia ligada à venda ou OS, causa, custo e justificativa.', next: true },
  { key: 'moto_express', name: 'Moto Express', category: 'Oficina', modules: ['ordens-servico', 'veiculos'], status: 'disponivel', summary: 'Atendimento rápido com pacotes de serviço cadastrados pela loja.', next: true },
  { key: 'autopilot', name: 'AutoPilot', category: 'Inteligência', modules: ['dashboard'], status: 'disponivel', summary: 'Pendências da operação por regras configuráveis; você decide cada ação.', next: true },
  { key: 'smart_inventory', name: 'Estoque inteligente', category: 'Inteligência', modules: ['estoque'], status: 'disponivel', summary: 'Ponto de reposição pela demanda real e sugestão de compra.', next: true },
  { key: 'supplier_quotes', name: 'Cotação com fornecedores', category: 'Inteligência', modules: ['compras', 'fornecedores'], status: 'disponivel', summary: 'Compare preço, frete e prazo; a compra só nasce da sua aprovação.', next: true },
  { key: 'os_profitability', name: 'Lucro por OS', category: 'Inteligência', modules: ['relatorios', 'ordens-servico'], status: 'disponivel', summary: 'Margem de contribuição por OS (antes de despesas indiretas).', next: true },
  { key: 'assistant_ai', name: 'Assistente com IA', category: 'Inteligência', modules: ['assistente'], status: 'requer_configuracao', summary: 'Consultas em linguagem natural, só leitura, com limite diário.' },
  { key: 'mechanic_ai', name: 'Mecânico IA por voz', category: 'Inteligência', modules: ['ordens-servico', 'assistente'], status: 'requer_configuracao', summary: 'Fale o que foi feito; a IA transcreve e organiza para você revisar.', next: true },
  { key: 'customer_portal', name: 'Portal do Cliente', category: 'Relacionamento', modules: ['orcamentos'], status: 'disponivel', summary: 'Link seguro com a marca da oficina para acompanhar e aprovar.', next: true },
  { key: 'customer_loyalty', name: 'Fideliza (revisões)', category: 'Relacionamento', modules: ['clientes', 'ordens-servico'], status: 'disponivel', summary: 'Revisões previstas pela recomendação registrada na OS.', next: true },
  { key: 'whatsapp', name: 'WhatsApp da loja', category: 'Relacionamento', modules: ['whatsapp'], status: 'requer_configuracao', summary: 'Conecte o número da loja por QR Code e atenda pelo PISTEC.' },
  { key: 'whatsapp_bot', name: 'Atendente automático no WhatsApp', category: 'Relacionamento', modules: ['whatsapp', 'assistente'], status: 'em_homologacao', summary: 'Responde dúvidas simples até um atendente assumir.' },
  { key: 'automacoes', name: 'Automações', category: 'Relacionamento', modules: ['automacoes'], status: 'disponivel', summary: 'Regras de lembrete com execução manual registrada.' },
  { key: 'relatorios', name: 'Relatórios', category: 'Administração', modules: ['relatorios'], status: 'disponivel', summary: 'Vendas, margem e estoque por período e filial.' },
  { key: 'compras', name: 'Compras e fornecedores', category: 'Administração', modules: ['compras', 'fornecedores'], status: 'disponivel', summary: 'Pedido, recebimento e conta a pagar automática.' },
  { key: 'personalizacao', name: 'Marca própria (white label)', category: 'Administração', modules: ['personalizacao'], status: 'disponivel', summary: 'Logo, cores e tema da empresa no sistema e no app instalável.' },
  { key: 'fleet_management', name: 'Frotas', category: 'Administração', modules: ['clientes', 'veiculos'], status: 'disponivel', summary: 'Clientes empresariais com veículos vinculados e portal da frota.', next: true },
];

export const STATUS_LABEL: Record<FeatureStatus, string> = { disponivel: 'Disponível', requer_configuracao: 'Requer configuração', em_homologacao: 'Em homologação' };

export const planAllows = (planModules: string[], module: string) => planModules.includes('*') || planModules.includes(module) || ALWAYS.includes(module);
export const featureInPlan = (feature: Pick<Feature, 'modules'>, planModules: string[]) => feature.modules.every(m => planAllows(planModules, m));

/** Plano público vindo do banco (plan_catalog) ou do seed da demonstração. */
export type CatalogPlan = Pick<Plan, 'id' | 'name' | 'monthly' | 'quarterly' | 'annual' | 'users' | 'branches' | 'products' | 'whatsapp' | 'trialMonths'> & { aiMessages: number; modules: string[]; selfService: boolean };
