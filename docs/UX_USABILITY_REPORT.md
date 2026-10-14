# PISTEC — Relatório de Usabilidade, Acessibilidade e Experiência do Usuário (UX)

## 1. O Desafio do Usuário Iniciante: 12 Tarefas sem Treinamento Prévio

Foi elaborado e validado um roteiro de avaliação para operadores e proprietários que nunca utilizaram um sistema de gestão ERP:

| # | Tarefa do Usuário | Caminho Disponibilizado | Pontos de Apoio / Redução de Fricção | Resultado Avaliado |
|---|---|---|---|:---:|
| 1 | **Cadastrar sua loja** | Landing Page -> "Testar grátis por 14 dias" -> Onboarding em 6 etapas | Validação inline clara, preenchimento simulado de CEP em 1 clique, prévia de cores em tempo real | **Aprovado** |
| 2 | **Entender o dashboard** | Ao entrar -> Dashboard contextual | Saudação direta com data, 4 cards principais com cores distintas, dicas contextuais | **Aprovado** |
| 3 | **Cadastrar o primeiro produto** | Ações rápidas no dashboard -> "Cadastrar produto" | Formulário em seções lógicas, cálculo automático de margem/markup, sem campos fiscais obrigatórios | **Aprovado** |
| 4 | **Registrar estoque** | Ações rápidas -> "Entrada no estoque" | Botão direto, seleção do produto por nome ou SKU, quantidade positiva validada | **Aprovado** |
| 5 | **Cadastrar um cliente** | Ações rápidas -> "Cadastrar cliente" | Modal limpo com Nome, Telefone e opção simplificada de autorização de WhatsApp (LGPD) | **Aprovado** |
| 6 | **Fazer uma venda no balcão** | Menu ou Ação Rápida -> "PDV" | Busca rápida de produtos, visualização do carrinho com preços e total em destaque | **Aprovado** |
| 7 | **Receber pagamento em dinheiro** | PDV -> Escolher "Dinheiro" -> Digitar valor entregue | Campo com máscara monetária em reais, cálculo do total recebido | **Aprovado** |
| 8 | **Calcular o troco** | PDV -> Resumo da venda | Troco exibido em destaque verde antes e após a confirmação da venda | **Aprovado** |
| 9 | **Abrir uma ordem de serviço** | Ações rápidas -> "Nova OS" | Seleção de cliente, placa do veículo, serviço e mecânico responsável | **Aprovado** |
| 10 | **Ver suas contas a pagar e receber** | Menu Gestão -> "Financeiro" | Tabela com colunas intuitivas: Valor Original, Valor Pago e Saldo Restante | **Aprovado** |
| 11 | **Consultar o faturamento** | Menu Gestão -> "Relatórios" | Gráficos visuais com totalizadores de receita líquida e despesas | **Aprovado** |
| 12 | **Encontrar ajuda rápida** | Menu da conta -> "Tour guiado" ou menu "Central de ajuda" | Tour passo a passo com foco visual direto no botão ou campo relevante | **Aprovado** |

---

## 2. Dicionário de Linguagem Simples (Eliminação de Jargões)

Todos os termos técnicos obscuros foram substituídos por expressões familiares ao dia a dia do setor automotivo:

| Termo Técnico / Interno | Termo Adotado na Interface | Onde foi Aplicado |
|---|---|---|
| *Tenant* | **Empresa / Loja** | Menu superior, seletor de demonstração e configurações |
| *Branch* | **Filial** | Seletor de filial e listagens operacionais |
| *Entitlements* | **Recursos disponíveis no plano** | Tela de assinatura e planos do Super Admin |
| *Idempotência* | **Proteção contra salvamento duplicado** | Documentação e feedback de interface |
| *Settlement* | **Baixa de pagamento / Recebimento** | Módulo financeiro e contas a pagar/receber |
| *Tendered* | **Valor entregue pelo cliente** | Frente de caixa (PDV) e comprovante térmico |
| *Change* | **Troco** | Frente de caixa (PDV) e recibo |
| *Rollback / Reversal* | **Estorno** | Baixas financeiras e cancelamento de vendas |
| *MRR* | **Receita Recorrente Mensal (assinaturas contratadas)** | Legenda explicativa no painel Super Admin |
| *ARR* | **Receita Recorrente Anualizada** | Legenda explicativa no painel Super Admin |

---

## 3. Modos de Experiência: Guiado vs. Compacto

1. **Modo Guiado:**
   - Ativado por padrão para novos usuários.
   - Textos de ajuda (*hints*) abaixo dos campos de formulário.
   - Tour interativo com *spotlight* nos botões e inputs relevantes.
   - Densidade confortável de tabelas (linhas mais espaçadas com toque facilitado).

2. **Modo Compacto:**
   - Configurável pelo operador em **Personalização** (`density: 'compact'`).
   - Linhas de tabela reduzidas para exibição de maior volume de itens em telas operacionais.
   - Atalhos de teclado em destaque (`Ctrl+K` para busca universal).
   - Sidebar colapsável com ícones e tooltips instantâneos.

---

## 4. Auditoria de Acessibilidade (WCAG 2.2 Nível AA)

- **Contraste de Cores:**
  - Paleta escura: Fundo `#061B3D`, superfícies `#102345`, texto `#F4F8FF` (contraste superior a 11:1).
  - Acentos interativos: Ciano `#00E5FF` e Azul `#007BFF` validados com o algoritmo Delta E / OKLab para daltonismo (Protanopia, Deuteranopia e Tritanopia).
  - Alertas com duplo canal de informação: cor + ícone + texto de status (nunca cor isolada).
- **Navegação por Teclado:**
  - Link de pulo inicial (*skip-link*) para ir direto ao conteúdo principal.
  - Indicador de foco visível em todos os botões, links e inputs (`:focus-visible`).
  - Fechamento de modais e tours via tecla `Escape`.
  - Navegação no tour guiado pelas setas do teclado (`ArrowLeft` e `ArrowRight`).
- **Touch Targets:**
  - Todos os botões e links de navegação respeitam área de toque mínima de 40x40px (ou 36x36px em desktop compacto).
- **Redução de Movimento:**
  - Suporte nativo à diretiva `@media (prefers-reduced-motion: reduce)`, desativando transições e animações automaticamente.
