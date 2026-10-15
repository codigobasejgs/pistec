# PISTEC — Auditoria de UX para Usuários Iniciantes e Perfis Operacionais

## 1. Avaliação por Perfil Operacional

| Perfil | Principais Tarefas | Pontos Críticos Avaliados | Solução Implementada |
|---|---|---|---|
| **Vendedor de Balcão** | Vender rápido, consultar preço, calcular troco, conceder desconto | Não pode perder tempo com campos desnecessários ou cálculos mentais | PDV simplificado em 3 etapas no celular; cálculo de troco automático em verde; atalho Ctrl+K para buscar peças |
| **Operador de Caixa** | Abrir turno, receber pagamentos mistos, fechar caixa | Medo de diferença no fechamento sem explicação clara | Fechamento cego: digita o valor contado e o sistema audita divergências com justificativa obrigatória |
| **Estoquista** | Dar entrada, consultar saldo mínimo, importar planilha de fornecedor | Medo de corromper catálogo ao subir Excel do distribuidor | Importador XLSX com prévia, mapeamento visual de colunas e detecção de duplicatas antes de gravar |
| **Mecânico** | Consultar veículo, ver reclamação, requisitar peças da OS, finalizar | Não deve ter acesso a faturamento ou configurações financeiras | Papel "Mecânico" bloqueia módulo Financeiro, oculta botões de exclusão e foca no Kanban de OS |
| **Gerente de Loja** | Acompanhar vendas do dia, autorizar cancelamentos, revisar OS atrasadas | Precisa de visão rápida dos problemas prioritários | Bloco "Atenção ao que importa" no dashboard: lista produtos abaixo do mínimo e OS com entrega atrasada |
| **Proprietário da Loja** | Ver faturamento do mês, margem bruta, controlar filiais, personalizar cores | Precisa de números confiáveis que reflitam a realidade | Indicadores separam Faturamento (vendas concluídas) de Caixa Líquido e Contas a Receber |
| **Administrador da Plataforma (Super Admin)** | Gerenciar assinaturas, criar cupons, acompanhar MRR e novos clientes | Não pode misturar faturamento das lojas com mensalidades PISTEC | Telas com faturamento SaaS isolado e legendas contratuais explicando que MRR é recorrência, não dinheiro em caixa |

---

## 2. Proposta de Teste Moderado com Usuários Reais (Pendente de Participantes)

Para a fase seguinte de validação de campo, foi estruturado um roteiro de teste moderado para **5 a 8 participantes sem experiência prévia com ERPs**:

- **Perfil dos participantes:** 3 proprietários de pequenas oficinas/motopeças, 3 balconistas/atendentes, 2 operadores de caixa.
- **Formato:** Sessão individual de 40 minutos em computador e smartphone.
- **Instrução ao participante:** *"Você acabou de contratar um sistema para sua loja. Seu objetivo é realizar as operações normais do seu dia sem pedir ajuda ao instrutor."*
- **Métricas a coletar:**
  - Taxa de sucesso sem assistência (meta: >= 85%).
  - Tempo médio até a primeira venda concluída (meta: <= 3 minutos).
  - Número de cliques desnecessários ou recuos de navegação.
  - Escala de Usabilidade do Sistema (SUS score - meta: >= 80 pontos).
- **Ressalva ética e de QA:** Esta validação permanece registrada como **pendente de realização com sujeitos humanos reais**. Não declaramos conclusão empírica antes da execução dessas sessões.
