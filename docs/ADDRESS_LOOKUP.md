# Consulta de CEP e endereço

## Provedores

| Ordem | Serviço | Endpoint | Quando |
|---|---|---|---|
| 1 | ViaCEP | `GET https://viacep.com.br/ws/{cep}/json/` | sempre |
| 2 | BrasilAPI | `GET https://brasilapi.com.br/api/cep/v2/{cep}` | só se o ViaCEP falhar (rede, timeout 5 s, HTTP ≠ 200, resposta inválida) |

- CEP **inexistente** no ViaCEP (`{"erro": true}`) é resposta definitiva: **não** consulta a BrasilAPI. Motivo verificado em 28/10/2026: a BrasilAPI devolve um endereço de Sarandi/PR para `99999-999`.
- BrasilAPI 404 = CEP inexistente.
- Resposta só é aceita se o CEP devolvido for o pedido e houver cidade + UF válida.
- Destinos fixos em HTTPS; só os 8 dígitos entram na URL (sem SSRF). Sem chave, sem backend intermediário. Ambos enviam `Access-Control-Allow-Origin: *`.
- Cache por aba e limite de 20 consultas/minuto.

## Código

| Peça | Arquivo |
|---|---|
| Serviço (`lookupCep`, `addressErrors`, `formatAddress`, `toAddress`, `maskCep`, `UFS`) | `src/services/address.ts` |
| Componente `BrazilianAddressFields` | `src/features/address/BrazilianAddressFields.tsx` |
| Banco: `address_data jsonb` em `tenants`, `branches`, `customers`; `app.address_norm`, `app.address_text`, RPC `update_tenant_address`; `onboard_tenant`, `save_customer`, `admin_save_tenant` aceitam endereço estruturado | `supabase/migrations/20261031000100_addresses.sql` |

Trocar ou acrescentar provedor = editar a lista `PROVIDERS` em `address.ts`; as telas não mudam.

## Comportamento

1. Máscara `00000-000`; consulta automática 450 ms depois do 8º dígito. O botão **Consultar endereço** repete a consulta manualmente.
2. Trocar o CEP cancela a consulta anterior (`AbortController`); resposta de um CEP que já não está no campo é descartada.
3. Preenche logradouro, bairro, cidade e UF. **Número e complemento nunca são preenchidos**; o complemento dos Correios aparece só como dica.
4. Campos digitados pela pessoa não são sobrescritos: o sistema mostra o endereço do CEP e oferece **Usar endereço do CEP** / **Manter o meu**. Campos que vieram da consulta anterior são atualizados.
5. CEP genérico (só cidade/UF): preenche só isso e foca no logradouro.
6. Mensagens: `Informe um CEP com 8 números.` · `Não encontramos este CEP. Confira os números informados.` · `Não foi possível consultar o CEP agora. Tente novamente ou preencha o endereço manualmente.` · `Endereço localizado! Confira os dados e informe o número.` · `Localizamos a cidade e o estado. Complete as demais informações do endereço.`
7. UF em seletor; uma coluna abaixo de 560 px.

## Onde está integrado

| Tela | Persistência |
|---|---|
| Landing `/cadastro` (etapa 3) | demonstração (IndexedDB) — a consulta é real, a empresa continua demonstrativa e isso está dito na tela |
| `/app/empresa/nova` (cadastro real) | `onboard_tenant` → `tenants.address_data` + matriz |
| Configurações → Endereço da empresa (real) | `update_tenant_address` |
| Contratação digital (`/app/contratar`) | dados do contrato (congelados em `tenant_contracts.parties`) + `update_tenant_address`; pré-preenche com o endereço confirmado da empresa |
| Clientes | `save_customer` (`address_data`; opcional) |
| Filiais, Fornecedores | `records.fields.addr_*` + texto em `fields.address` (usado em documentos) |
| Super Admin → editar empresa | `admin_save_tenant` (`addressData`) |

Contratos já assinados não mudam quando o endereço cadastral é alterado.

## Testes

- `src/services/address.test.ts` (13): máscara, 8 dígitos, inexistente sem fallback, fallback por rede/timeout/500, ambos fora, payload inválido, genérico, cancelamento, cache/limite, validação.
- `supabase/tests/addresses.test.ts` (5): onboarding, validação no servidor, isolamento, cliente, Super Admin.
- `src/features/address/address.e2e.ts` (6, rede interceptada): automático, inexistente/incompleto, fallback e manual, corrida de CEPs, preservação + voltar/avançar, genérico em 320 px.
- `src/features/address/address.real.e2e.ts` (2, **rede real**): ViaCEP preenche `01001-000` no navegador; BrasilAPI responde o mesmo CEP.
- `src/real/real.e2e.ts`: cadastro real com CEP real e conferência de `address_data` no Supabase (exige a migração aplicada).
