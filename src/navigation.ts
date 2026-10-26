import { LayoutDashboard, Package, Boxes, ShoppingCart, Monitor, Wrench, Users, Truck, Wallet, MessageCircle, ChartNoAxesCombined, Settings, CalendarDays, Car, FileText, Building2, Bell, ListTodo, Palette, Crown, CircleHelp, Tags, ShieldCheck, ClipboardList, Contact, Workflow, BookOpen, Undo2, type LucideIcon } from 'lucide-react';
export interface NavItem { path: string; label: string; icon: LucideIcon; group: string }
export const nav: NavItem[] = [
  { path:'dashboard',label:'Dashboard',icon:LayoutDashboard,group:'Visão geral' },
  { path:'produtos',label:'Produtos',icon:Package,group:'Comercial' },{path:'estoque',label:'Estoque',icon:Boxes,group:'Comercial'},
  {path:'vendas',label:'Vendas',icon:ShoppingCart,group:'Comercial'},{path:'pdv',label:'PDV',icon:Monitor,group:'Comercial'},
  {path:'orcamentos',label:'Orçamentos',icon:FileText,group:'Comercial'},{path:'clientes',label:'Clientes',icon:Users,group:'Comercial'},
  {path:'crm',label:'CRM',icon:Contact,group:'Comercial'},{path:'compras',label:'Compras',icon:Truck,group:'Comercial'},
  {path:'fornecedores',label:'Fornecedores',icon:Building2,group:'Comercial'},{path:'categorias',label:'Categorias',icon:Tags,group:'Comercial'},
  {path:'aplicacoes',label:'Aplicações de peças',icon:BookOpen,group:'Comercial'},{path:'inventario',label:'Inventário',icon:ClipboardList,group:'Comercial'},
  {path:'ordens-servico',label:'Ordens de serviço',icon:Wrench,group:'Oficina'},{path:'agenda',label:'Agenda',icon:CalendarDays,group:'Oficina'},
  {path:'veiculos',label:'Veículos',icon:Car,group:'Oficina'},{path:'garantias',label:'Garantias e devoluções',icon:Undo2,group:'Oficina'},
  {path:'financeiro',label:'Financeiro',icon:Wallet,group:'Gestão'},{path:'contas-pagar',label:'Contas a pagar',icon:Wallet,group:'Gestão'},
  {path:'contas-receber',label:'Contas a receber',icon:Wallet,group:'Gestão'},{path:'caixa',label:'Caixa',icon:Wallet,group:'Gestão'},
  {path:'relatorios',label:'Relatórios',icon:ChartNoAxesCombined,group:'Gestão'},{path:'funcionarios',label:'Equipe e acessos',icon:ShieldCheck,group:'Gestão'},
  {path:'filiais',label:'Filiais',icon:Building2,group:'Gestão'},
  {path:'whatsapp',label:'WhatsApp',icon:MessageCircle,group:'Relacionamento'},{path:'automacoes',label:'Automações',icon:Workflow,group:'Relacionamento'},
  {path:'tarefas',label:'Tarefas',icon:ListTodo,group:'Relacionamento'},{path:'notificacoes',label:'Notificações',icon:Bell,group:'Relacionamento'},
  {path:'configuracoes',label:'Configurações',icon:Settings,group:'Sistema'},{path:'personalizacao',label:'Personalização',icon:Palette,group:'Sistema'},
  {path:'minha-assinatura',label:'Minha assinatura',icon:Crown,group:'Sistema'},{path:'ajuda',label:'Central de ajuda',icon:CircleHelp,group:'Sistema'},
];
