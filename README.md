# PISTEC — Tecnologia que move seu negócio

Frontend SaaS multiempresa para oficinas, motopeças e autopeças. **Modo demonstração**: dados fictícios e persistência local (IndexedDB). Não há backend, autenticação real, cobrança, envio de WhatsApp nem emissão fiscal.

## Executar

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build && npm run preview
```

## Verificar

```bash
npm run typecheck
npm run lint
npm test             # Vitest: domínio, store, ERP, modelo público
npm run test:e2e     # Playwright (usa o Google Chrome instalado)
```

Screenshots da landing (telas reais, dados demo), com `npm run dev` ativo:

```bash
npm run screenshots && python scripts/assets.py
```

## Ambientes e rotas

| Ambiente | Rota | Entrada demo |
|---|---|---|
| Site comercial | `/`, `/planos`, `/funcionalidades`, `/oficinas`, `/motopecas`, `/autopecas`, `/contato`, `/cadastro`, `/licenca-perpetua`, `/termos`, `/privacidade` | livre |
| ERP da loja | `/loja/:tenantSlug/*` (ex.: `/loja/moto-prime/dashboard`) | `/demonstracao`: escolher empresa e perfil |
| Super Admin | `/admin/*` | `/demonstracao` → "Entrar como Super Admin" |

Empresas demo: `moto-prime` (Premium, 2 filiais), `oficina-rota-88` (Profissional) e `auto-center` (Essencial), além de 5 empresas só cadastradas, em estados variados (teste, vencida, suspensa, cancelada).
A sessão demo fica em memória: ao recarregar a página, volta ao perfil padrão (Carlos Silva, Proprietário). Os dados continuam salvos.
Para restaurar os dados demo: Configurações → "Restaurar todos os dados demo".

## Arquitetura

- `src/types.ts`: modelos compartilhados (dinheiro sempre em centavos inteiros).
- `src/domain.ts`: regras puras e atômicas (venda, cancelamento, estoque, OS, caixa, compras, conversões, limites de plano, `can()` para RBAC demo) e `validateState`.
- `src/store.tsx`: fila serializada de mutações. Grava o snapshot no Dexie antes de publicar, simula latência e falha.
- `src/seed.ts`: dados determinísticos, com datas relativas ao dia atual.
- `src/services/billing.ts`: `BillingProviderAdapter`, `MockAsaasAdapter`, `MockInfinitePayAdapter`, sem rede nem segredos. O retorno do checkout nunca confirma pagamento.
- `src/app/`: layout (sidebar, topbar, busca Ctrl+K, tour); `src/features/*`: telas.

Asaas e InfinitePay servem **apenas** às assinaturas do PISTEC (`state.invoices`). Vendas das lojas ficam em `sales`/`finances`.

## Publicação (Vercel)

`vercel.json` já traz rewrites de SPA e cabeçalhos básicos. Build: `npm run build`; saída: `dist`. Nenhuma variável de ambiente é necessária. **Nada foi publicado nem enviado a repositório remoto.**

## Próximos passos (backend)

Veja `docs/SUPABASE.md` e `docs/IMPLEMENTATION_STATUS.md`.
