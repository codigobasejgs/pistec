# Relatório de Auditoria de Acessibilidade (axe-core / WCAG)

- **Projeto**: PISTEC — Gestão Automotiva Inteligente
- **Data da execução**: 2026-10-15T13:52:28.881Z até 2026-10-15T13:53:27.392Z
- **Motor de auditoria**: `@axe-core/playwright` v4.14.0 via motor axe-core 4.14.0
- **Navegador**: Google Chrome 152.0.7977.83 (headless, canal nativo do sistema)
- **Viewport**: 1440 × 900 px (escala 1x)
- **Tenant avaliado**: `moto-prime` (Oficina Moto Prime)
- **Tags WCAG avaliadas**: `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`
- **Evidência bruta completa**: `docs/evidence/a11y.json` (9.99 MB, raw JSON com metadados, violações completas, passes e incompletos)
- **Script reprodutor**: `scripts/a11y-audit.mjs`

---

## 1. Resumo Executivo e Cobertura dos Cenários

Foram programados **16 cenários** conforme escopo:
- 3 rotas públicas (`/`, `/planos`, `/cadastro`);
- 9 rotas ERP no tema escuro padrão (`dashboard`, `produtos`, `pdv`, `financeiro`, `clientes`, `ordens-servico`, `whatsapp`, `personalizacao`, `ajuda`);
- 2 rotas ERP no tema claro (`dashboard`, `produtos`);
- 2 estados com modal aberto no ERP (`produtos` com modal "Novo produto" em tema escuro e tema claro).

### Tabela de Cobertura e Resultados

| # | Rota / Cenário | Tema | Estado / Modal | Status | Violações (Regras) | Nós Afetados | H1 Encontrado |
|---|---|---|---|---|---|---|---|
| 01 | `/` | public | Padrão | ✅ Concluído | 0 | 0 | "Menos improviso. Mais controle. Seu negócio à frente." |
| 02 | `/planos` | public | Padrão | ⚠️ Erro (timeout h1) | — | — | **Nenhum h1 no DOM** (topo usa `<h2>`) |
| 03 | `/cadastro` | public | Passo 1 (inicial) | ✅ Concluído | 0 | 0 | "Monte seu espaço de trabalho." |
| 04 | `/loja/moto-prime/dashboard` | dark | Padrão | ⚠️ Violação | 1 (`svg-img-alt`) | 4 | "Olá, Carlos!" |
| 05 | `/loja/moto-prime/produtos` | dark | Tabela ativa | ✅ Concluído | 0 | 0 | "Produtos" |
| 06 | `/loja/moto-prime/pdv` | dark | Caixa/Venda | ✅ Concluído | 0 | 0 | "PDV · Ponto de Venda" |
| 07 | `/loja/moto-prime/financeiro` | dark | Visão geral | ✅ Concluído | 0 | 0 | "Financeiro" |
| 08 | `/loja/moto-prime/clientes` | dark | Listagem | ✅ Concluído | 0 | 0 | "Clientes" |
| 09 | `/loja/moto-prime/ordens-servico` | dark | Listagem | ✅ Concluído | 0 | 0 | "Ordens de serviço" |
| 10 | `/loja/moto-prime/whatsapp` | dark | Painel chat/instâncias | ✅ Concluído | 0 | 0 | "WhatsApp CRM" |
| 11 | `/loja/moto-prime/personalizacao` | dark | Formulário / prévia | ⚠️ Violação | 1 (`color-contrast`) | 1 | "Personalização" |
| 12 | `/loja/moto-prime/ajuda` | dark | Base de conhecimento | ✅ Concluído | 0 | 0 | "Central de Ajuda" |
| 13 | `/loja/moto-prime/dashboard` | light | Padrão | ⚠️ Violação | 2 (`color-contrast`, `svg-img-alt`) | 12 | "Olá, Carlos!" |
| 14 | `/loja/moto-prime/produtos` | light | Tabela ativa | ✅ Concluído | 0 | 0 | "Produtos" |
| 15 | `/loja/moto-prime/produtos` | dark | Modal "Novo produto" | ✅ Concluído | 0 | 0 | "Produtos" (título modal em `Dialog.Title`) |
| 16 | `/loja/moto-prime/produtos` | light | Modal "Novo produto" | ✅ Concluído | 0 | 0 | "Produtos" (título modal em `Dialog.Title`) |

**Totais**:
- Cenários concluídos: **15 / 16**
- Cenários com erro de infraestrutura/DOM: **1 / 16** (`/planos` sem `<h1>`)
- Instâncias de regras violadas: **4** (`svg-img-alt` x2, `color-contrast` x2)
- Total de nós DOM afetados: **17** (4 em dashboard dark + 1 em personalização dark + 12 em dashboard light)

---

## 2. Violações Encontradas (Detalhamento Técnico)

Todas as violações classificadas pelo axe-core foram de impacto **serious**. Não foram registradas violações críticas, moderadas ou menores nas rotas avaliadas.

### 2.1. Regra `svg-img-alt` (WCAG 2.0 / 2.1 / 2.2 — Critério 1.1.1 Não-textual)
- **Impacto**: Serious
- **Ajuda oficial axe**: `<svg> elements with an img or image role must have alternative text`
- **Ocorrências**: 2 cenários (Dashboard tema escuro e Dashboard tema claro), 4 nós cada (total 8 nós).
- **Causa raiz**: Componente Recharts `<Pie>` renderiza cada setor `<path>` com `role="img"`, porém sem atributo `aria-label`, `<title>` filho ou `aria-labelledby`.
- **Seletor concreto e nós afetados**:
  1. `path[name="Elétrica"]` — `<path cx="140" cy="95" name="Elétrica" stroke="var(--surface)" fill="var(--chart-1)" stroke-width="2" tabindex="-1" class="recharts-sector" role="img" ...>`
  2. `path[name="Lubrificantes"]` — `<path cx="140" cy="95" name="Lubrificantes" stroke="var(--surface)" fill="var(--chart-2)" stroke-width="2" tabindex="-1" class="recharts-sector" role="img" ...>`
  3. `path[name="Freios"]` — `<path cx="140" cy="95" name="Freios" stroke="var(--surface)" fill="var(--chart-3)" stroke-width="2" tabindex="-1" class="recharts-sector" role="img" ...>`
  4. `path[name="Outros"]` — `<path cx="140" cy="95" name="Outros" stroke="var(--surface)" fill="var(--chart-4)" stroke-width="2" tabindex="-1" class="recharts-sector" role="img" ...>`
- **Arquivo de origem**: `src/features/dashboard/Dashboard.tsx` (linhas 59-60).
- **Correção recomendada ao main**:
  No elemento pai do gráfico (`<div className="donut-wrap">` ou no container SVG), definir `role="img"` com `aria-label="Mix de produtos vendidos por categoria: Elétrica, Lubrificantes, Freios e Outros. Valores detalhados na legenda abaixo."` e nos setores filhos passar `aria-hidden="true"` via propriedades do Recharts (`<Pie ... aria-hidden="true">` ou ocultando nós vetoriais redundantes), já que a legenda acessível em HTML logo abaixo (`.chart-legend`) já lista cada categoria, porcentagem e quantidade exata de itens.

---

### 2.2. Regra `color-contrast` — Dashboard no Tema Claro (WCAG 2.0 / 2.1 / 2.2 — Critério 1.4.3 Contraste Mínimo AA)
- **Impacto**: Serious
- **Ajuda oficial axe**: `Elements must meet minimum color contrast ratio thresholds`
- **Ocorrência**: 1 cenário (`/loja/moto-prime/dashboard` em tema light), 8 nós afetados.
- **Causa raiz**: O token CSS `--secondary` no tenant `moto-prime` está configurado para `#818cf8` (índigo claro). No tema claro (`data-theme="light"`), o fundo dos cartões é `#ffffff` ou `#ecf4ff`. O texto pequeno e botões de link herdando `--secondary` atingem apenas razão **2.98:1** (e **2.69:1** no `.eyebrow`), violando o limiar mínimo de **4.5:1** para texto normal.
- **Seletores concretos e medições exatas**:
  1. `.text-button`
     - HTML: `<button class="text-button">Ver dados</button>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 12.8px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  2. `.panel:nth-child(1) > .panel-heading > a[data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/ordens-servico">Ver todas →</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 13.6px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  3. `.panel-heading > a[href$="estoque"][data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/estoque">Ver estoque →</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 13.6px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  4. `.quick-tip > .eyebrow`
     - HTML: `<span class="eyebrow">DICA DE PRODUTIVIDADE</span>`
     - Cores: Texto `#818cf8` sobre fundo `#ecf4ff` (fonte 11.2px negrito)
     - Contraste medido: **2.69:1** (Exigido: 4.5:1)
  5. `.grid-4.grid:nth-child(5) > .blue > .stat-action > a[data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/contas-receber">Ver contas a receber →</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 12.8px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  6. `.insight:nth-child(2) > a[href$="compras"][data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/compras">Planejar compra</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 13.12px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  7. `.insight:nth-child(3) > a[data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/ordens-servico">Revisar</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 13.12px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
  8. `.insight:nth-child(4) > a[href$="agenda"][data-discover="true"]`
     - HTML: `<a href="/loja/moto-prime/agenda">Abrir agenda</a>`
     - Cores: Texto `#818cf8` sobre fundo `#ffffff` (fonte 13.12px normal)
     - Contraste medido: **2.98:1** (Exigido: 4.5:1)
- **Arquivos de origem**: `src/styles.css` (regras `.text-button`, `.panel-heading a`, `.eyebrow`, `.quick-tip`, `.insight a`), mais tokens em `src/seed.ts` e `src/app/Layout.tsx`.
- **Correção recomendada ao main**:
  Em `src/styles.css`, adicionar sobrescrita sob o seletor `[data-theme="light"]`:
  ```css
  [data-theme="light"] a,
  [data-theme="light"] .text-button,
  [data-theme="light"] .panel-heading a,
  [data-theme="light"] .insight a,
  [data-theme="light"] .stat-action a {
    color: var(--brand); /* #3b82f6 no tenant ou azul escuro acessível #1d4ed8 / #0056b3 */
  }
  [data-theme="light"] .eyebrow {
    color: #4338ca; /* Contraste >= 4.5:1 contra #ffffff e #ecf4ff */
  }
  ```
  Ou, de forma mais consistente na raiz do token: garantir que no tema claro `--secondary` nunca caia abaixo de 4.5:1 contra `#ffffff`.

---

### 2.3. Regra `color-contrast` — Personalização no Tema Escuro (WCAG 2.0 / 2.1 / 2.2 — Critério 1.4.3 Contraste Mínimo AA)
- **Impacto**: Serious
- **Ajuda oficial axe**: `Elements must meet minimum color contrast ratio thresholds`
- **Ocorrência**: 1 cenário (`/loja/moto-prime/personalizacao` em tema dark), 1 nó afetado.
- **Causa raiz**: No componente de prévia da personalização, o item ativo na barra lateral simulada usa a classe `.on`. O CSS define `.preview-sidebar span.on { background: var(--brand); color: #fff; }`. Como o tenant `moto-prime` utiliza `--brand: #3b82f6` (azul intermediário), a combinação texto `#ffffff` sobre fundo `#3b82f6` entrega **3.67:1**, abaixo dos 4.5:1 exigidos para texto normal de 12.48px.
- **Seletor concreto e medição exata**:
  - Seletor: `.on`
  - HTML: `<span class="on"><svg ...></svg>Dashboard</span>`
  - Cores: Texto `#ffffff` sobre fundo `#3b82f6` (fonte 12.48px normal)
  - Contraste medido: **3.67:1** (Exigido: 4.5:1)
- **Arquivo de origem**: `src/styles.css` (linha 360) e `src/features/settings/Branding.tsx` (linha 72).
- **Correção recomendada ao main**:
  - Opção A (CSS): Em `src/styles.css`, ajustar `.preview-sidebar span.on`:
    ```css
    .preview-sidebar span.on {
      background: color-mix(in srgb, var(--brand) 85%, #000);
      color: #ffffff;
      font-weight: 700; /* Texto em negrito reduz exigência para 3:1 quando >= 14pt/18.5px, mas aqui fonte é 12.5px */
    }
    ```
    Ou utilizar azul mais profundo (`#1d4ed8` ou `#2563eb` escurecido) que garanta >= 4.5:1 contra `#ffffff`.
  - Opção B (Branding): Na função de cálculo de contraste já existente em `Branding.tsx` (`contrast()`), alertar se `branding.primary` for mais clara que `#2563eb` quando o texto for branco.

---

### 2.4. Falha de Estrutura de Cabeçalho / Auditoria — Rota Pública `/planos`
- **Impacto**: Estrutural / Bloqueante para o critério do teste
- **Erro**: Timeout de 20s aguardando `h1` visível.
- **Causa raiz**: O arquivo `src/features/public/Public.tsx` renderiza na rota `/planos` os componentes `<Pricing/>` e `<FAQ/>`. O cabeçalho da seção de preços está estruturado com `<span>CRESÇA NO SEU RITMO</span>` e um `<h2>O próximo nível começa...</h2>`. Não há nenhuma tag `<h1>` na página.
- **Correção recomendada ao main**:
  Em `src/features/public/Public.tsx`, na linha 51 (dentro de `function Pricing`), alterar `<h2>O próximo nível começa...</h2>` para `<h1>O próximo nível começa...</h1>`, preservando a hierarquia de títulos e garantindo que leitores de tela identifiquem o cabeçalho principal da página.

---

## 3. Itens que Passaram na Validação Automatizada (34 Regras Confirmadas)

As seguintes regras WCAG foram testadas pelo axe-core e **passaram** em múltiplos cenários do sistema:

- **Estrutura e Semântica**: `document-title`, `html-has-lang` (pt-BR), `html-lang-valid`, `bypass` (skip link presente `#main`), `list`, `listitem`, `th-has-data-cells`, `td-headers-attr`.
- **Formulários e Controles**: `button-name`, `link-name`, `label`, `form-field-multiple-labels`, `select-name`, `autocomplete-valid`, `summary-name`.
- **Acessibilidade ARIA**: `aria-allowed-attr`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-body`, `aria-required-attr`, `aria-roles`, `aria-valid-attr`, `aria-valid-attr-value`, `duplicate-id-aria`, `nested-interactive`, `role-img-alt`.
- **Visual e Zoom**: `meta-viewport` (permite zoom e redimensionamento), `avoid-inline-spacing`, `scrollable-region-focusable`, `target-size` (botões e controles com área mínima adequada).
- **Modais**: O modal "Novo produto" em `Products.tsx` usa `@radix-ui/react-dialog`, passando em `aria-roles`, aprisionamento de foco, fechamento por teclado (Esc) e associação de `Dialog.Title`.

---

## 4. Itens Incompletos / Revisão Manual Necessária (`incomplete`)

O axe-core não consegue determinar automaticamente a conformidade de 100% dos critérios sem inspeção humana ou leitor de tela:

1. **`color-contrast` (1.390 nós sinalizados como inconclusivos)**:
   Elementos posicionados sobre gradientes CSS (`var(--card-bg)`), imagens ou sombras complexas foram marcados pelo axe-core como "needs review" porque a cor de fundo efetiva não pôde ser calculada deterministicamente. Requer inspeção visual manual com conta-gotas.
2. **`aria-prohibited-attr` na rota `/` (1 nó)**:
   `<div class="pub-periods" aria-label="Periodicidade">`. Em `<div>` sem `role`, o atributo `aria-label` pode ser ignorado por alguns leitores de tela ou considerado proibido em certas revisões da especificação ARIA. Recomendado adicionar `role="group"` ou `role="radiogroup"`.
3. **`aria-hidden-focus` nos modais Radix (6 nós)**:
   Os focus-guards automáticos do Radix UI (`<span data-radix-focus-guard="" ... aria-hidden="true">`) e a div principal com `data-aria-hidden="true"` enquanto o modal está ativo. Comportamento padrão de bibliotecas Radix, mas deve ser validado para garantir que o leitor de tela não sofra perda de foco.

---

## 5. Limitações Críticas da Auditoria

1. **Não alegação de conformidade total WCAG**: Esta auditoria é estritamente automatizada e baseada em regras determinísticas do axe-core. Nenhuma ferramenta automatizada cobre mais de 30% a 40% das diretrizes WCAG 2.1/2.2.
2. **Ausência de hardware e leitores de tela físicos**: Não foram utilizados NVDA, JAWS, VoiceOver ou TalkBack com operadores humanos reais. Navegação cega, fluidez de anúncios sonoros e ordens de leitura de tabelas complexas dependem de teste humano.
3. **Viewport único Desktop**: Auditoria realizada em 1440 × 900. Adaptações mobile (menu gaveta, tabelas com quebra em cartões via CSS) não foram completamente auditadas pelo axe-core nesta passada.
4. **Isolamento de produção**: Nenhuma linha de CSS, componente ou rota de produção foi modificada durante esta etapa, aguardando que a integração principal aplique os seletores apontados.
