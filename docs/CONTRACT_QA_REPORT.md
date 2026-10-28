# QA — Contratação digital 7.0 (28/10/2026)

## Verificações

| Verificação | Resultado |
|---|---|
| `tsc -b` | 0 erros |
| `eslint .` | 0 erros, 0 avisos |
| Vitest (21 arquivos, inclui SQL contra Postgres de teste) | **261/261** |
| Playwright Chrome (todos os cenários) | **46/46** (inclui 3 novos de contratos) |
| `deno check` contract-sign, contract-webhook, worker, email | ok |
| `vite build` | ok |

## Cobertura por área (exigida no prompt)

| Área | Como foi testado | Status |
|---|---|---|
| Cadastro: CNPJ/CPF, e-mail, telefone, CEP/UF, representante com poderes | `contracts.test.ts` (SQL) + `br.ts` unit | Testado com mock |
| Planos, periodicidades, cupom, preço congelado, preço alterado, plano desativado | SQL: "preço congelado", "fatura… bloqueio por mudança de preço" | Testado com mock |
| Contrato: preenchimento, variáveis, versão, cláusulas, PDF, hash reproduzível | unit `contracts.test.ts` (7) | Implementado e testado |
| Sem versão publicada → bloqueio; homologação só admin | SQL | Testado |
| Separação de funções editor/revisor/aprovador/publicador | SQL | Testado |
| Assinatura: fora de ordem, duplicado, recusa, expiração, cancelamento, conclusão, imutabilidade, sem DELETE | SQL (eventos simulados como o provedor) | Testado com mock |
| Cobrança após assinatura, idempotência, confirmação de pagamento | SQL | Testado com mock |
| Segurança: isolamento entre empresas, usuário sem permissão, `svc_*` bloqueadas, helpers expostos | SQL + `security.test.ts` | Testado |
| Regressão 6.0: apagar impressora de outra empresa | `documents.test.ts` | Corrigido e testado |
| ~~Página pública /contrato~~ (removida em 01/11; ver abaixo) | — | Substituído |
| 320 px sem rolagem lateral (/contrato, antes da remoção) | E2E + capturas 320/820/1440/2560 em `docs/screenshots/contracts/` | Testado |
| Login com retorno para `/contratar/:plano` (sem redirect aberto) | E2E + regex | Testado |
| Tour (8 passos) e 11 artigos de ajuda; alvos `data-tour` existem | `tours.test.ts`, `help.test.ts` | Testado |
| Autentique real / sandbox | — | **Pendente de credenciais** |
| Assistente autenticado ponta a ponta com backend | — | Pendente (migração não aplicada em produção) |

## Correção 01/11/2026 — contrato integrado a /planos

| Verificação | Resultado |
|---|---|
| Vitest (inclui SQL) | 283/283 |
| Playwright (sem o teste contra produção) | 61/61 (11 novos da jornada) |
| tsc, eslint, build | ok |
| Contrato = plano escolhido (9 combinações) | testado (SQL) |
| Sem aba "Contrato" na landing; /contrato → /planos | testado (E2E) |
| Plano preservado sem login / após login | testado (E2E: URL + intenção guardada) |
| 320/390/768/1366 px sem rolagem lateral | testado (E2E) |
| Assinatura sandbox/real | **não executado** — pendente de credenciais e de versão publicada |
| Pagamento real | **não executado** — sem autorização de cobrança |

## Achados corrigidos nesta entrega

- Checagens de papel NULL-unsafe (`admin_role() <> 'owner'`, `(membership).role not in`) liberavam ação a não membros → `coalesce` em todas; mesmo bug na 6.0 (`delete_printer_profile`) corrigido.
- `svc_contract_apply` marcava assinado sem PDF final → agora `partially_signed` até `svc_contract_complete`.
- Contrato prometia "cancelamento em Minha assinatura", mas não havia botão → adicionado "Cancelar assinatura" (RPC existente `cancel_subscription`, só proprietário).
- `.vercelignore` bloquearia os módulos compartilhados de contratos (mesma falha do deploy 6.0) → liberados.
