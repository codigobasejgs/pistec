# Fluxo de assinatura

## Estados (`tenant_contracts.status`)

| Estado | Quando |
|---|---|
| `prepared` | `prepare_contract` congelou dados; ainda não enviado |
| `awaiting_customer` | enviado ao Autentique; cliente não assinou |
| `awaiting_provider` | cliente assinou; falta a contratada |
| `partially_signed` | todos assinaram no provedor, aguardando o PDF final / conclusão |
| `signed` | `svc_contract_complete`: todos assinados + PDF assinado salvo com SHA-256 |
| `refused` | algum signatário recusou |
| `expired` | 15 dias sem conclusão (worker) |
| `cancelled` | cancelado pelo lojista (antes de assinar) ou Super Admin; documento bloqueado no provedor |
| `error` | falha de integração registrada (`svc_contract_failed`) |

Estados finais (`signed`, `refused`, `expired`, `cancelled`) são imutáveis (gatilho `app.contract_guard`); contratos e eventos não podem ser apagados.

## Passo a passo

1. Assistente: Plano → Empresa → Representante → Contrato (leitura até o fim obrigatória) → Assinatura → Pagamento → Conclusão.
2. `contract-sign {send}`: `contract_for_signing` (permissão) → PDF → SHA-256 → Storage privado → `createDocument` com signatários cliente + contratada (`refusable`, `stop_on_rejected`, rolagem obrigatória) → `svc_contract_sent`.
3. Atualizações chegam por webhook, botão "Atualizar situação" ou worker. Todas passam por `reconcile()`, que consulta o documento no provedor (fonte da verdade) e aplica de forma idempotente.
4. Conclusão: baixa o PDF assinado (inclui o certificado do Autentique), calcula hash, salva, `svc_contract_complete` → e-mail "Seu contrato PISTEC foi assinado com sucesso" + notificação (exceto homologação).
5. Pagamento: `contract_invoice` → checkout InfinitePay. Ativação só por `svc_confirm_payment` (servidor).

## Garantias

- Evento duplicado: `event_key` único. Fora de ordem: estado derivado do provedor, nunca regride.
- O PISTEC não assina pela contratada: o signatário autorizado assina pelo próprio e-mail.
- Aditivo: novo registro `kind='addendum'` com `parent_id`; o contrato original permanece intacto. (Geração de aditivo pela UI: ver `CONTRACT_KNOWN_ISSUES.md`.)
