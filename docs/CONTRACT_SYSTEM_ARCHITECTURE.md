# Contratação digital — arquitetura (7.0)

## Visão geral

```
Landing (/contrato, /planos) ──► /app/contratar[/:plano]  (Hire.tsx, login obrigatório)
   prepare_contract (RPC) ── congela comercial + partes ──► tenant_contracts (prepared)
   contract-sign {send} ── renderiza PDF (pdf-lib) → SHA-256 → Storage contracts/ → Autentique createDocument
   Autentique ── webhook (HMAC) ──► contract-webhook ─┐
   worker (cron) ── reconcilia pendentes > 10 min ────┼─► reconcile(): svc_contract_apply → baixa PDF assinado → svc_contract_complete
   contract-sign {reconcile} (botão "Atualizar") ─────┘
   contract_invoice (RPC, só contrato assinado) ──► billing_invoices ──► billing-checkout (InfinitePay) ──► svc_confirm_payment (existente)
```

## Componentes

| Camada | Arquivo |
|---|---|
| Migração (tabelas, RLS, RPCs, gatilhos) | `supabase/migrations/20261030000100_contracts.sql` |
| Minuta estruturada | `supabase/functions/_shared/contracts/minuta-2026-1.json` (origem: `docs/contracts/PISTEC_Minuta_Contrato_SaaS_2026.docx`) |
| Preenchimento / PDF / logo | `_shared/contracts/template.ts`, `pdf.ts`, `logo.ts` (compartilhados com o frontend) |
| Provedor | `_shared/autentique.ts`, `_shared/autentique.verify.ts` |
| Reconciliação | `_shared/contracts/reconcile.ts` |
| Edge Functions | `contract-sign` (send, reconcile, download, resend, cancel), `contract-webhook`, `worker` (expiração + reconciliação) |
| Página pública | `src/features/contracts/PublicContract.tsx` |
| Assistente | `src/features/contracts/Hire.tsx` |
| Área do lojista | `src/features/contracts/MyContracts.tsx` (em Minha assinatura) |
| Super Admin | `src/real/admin/Contracts.tsx` (`/admin/contratos`: contratos, modelos e versões, identidade jurídica, papéis contratuais) |

## Tabelas

- `legal_provider_profiles` — identidade da contratada; um registro ativo; cada alteração cria nova linha (histórico); sem DELETE.
- `legal_contract_versions` — `draft → in_review → approved → published → archived`; uma publicada; corpo editável só em rascunho.
- `tenant_contracts` — número `PST-AAAA-NNNNN`, `commercial` e `parties` congelados (jsonb), hashes, caminhos no Storage, provedor, `sandbox`, `invoice_id`, `request_id` (idempotência), `expires_at` (15 dias), `kind`/`parent_id` (aditivo).
- `contract_signers`, `contract_signature_events` (`event_key` único = deduplicação), `contract_counters`.
- `platform_admins.contract_roles` — `editor`, `reviewer`, `approver`, `publisher`.

## Decisões

- PDF gerado no servidor com data fixa → SHA-256 reproduzível; o hash enviado é imutável após o envio.
- Contrato só vira `signed` por `svc_contract_complete`, que exige todos os signatários assinados **e** o PDF assinado baixado com hash. Eventos fora de ordem ou duplicados não regridem estado.
- Cobrança só depois da assinatura; preço do catálogo divergente do congelado bloqueia a fatura (renegociar = novo contrato).
- Contratação real exige versão **publicada** e signatário da contratada configurado. Sem isso, apenas Super Admin gera contrato de **homologação** (`sandbox`, documento marcado, sem cobrança, sem e-mail).
