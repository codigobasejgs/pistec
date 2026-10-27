# Print & Documents 6.0 — arquitetura (2026-10-27)

Documentos relacionados: [PRINTER_SETUP](PRINTER_SETUP.md) · [PRINT_TEMPLATES](PRINT_TEMPLATES.md) · [PAPER_PROFILES](PAPER_PROFILES.md) · [PRINT_COMPATIBILITY_MATRIX](PRINT_COMPATIBILITY_MATRIX.md) · [DOCUMENT_DELIVERY](DOCUMENT_DELIVERY.md) · [PRINT_SECURITY](PRINT_SECURITY.md) · [PRINT_QA_REPORT](PRINT_QA_REPORT.md) · [PRINT_PWA_VALIDATION](PRINT_PWA_VALIDATION.md) · [PRINT_FISCAL_BOUNDARIES](PRINT_FISCAL_BOUNDARIES.md) · [PRINT_KNOWN_ISSUES](PRINT_KNOWN_ISSUES.md)

## Fluxo

```
registro real (venda, OS, orçamento, compra, caixa, baixa, estoque)
   │  issue_document(tenant, tipo, origem)   ← permissão do módulo + filial no servidor
   ▼
generated_documents (snapshot congelado: dados + identidade da empresa/filial + textos; versão; nº)
   │  buildDoc(snapshot) → Doc (layout neutro)          supabase/functions/_shared/documents/model.ts
   ├─ renderHtml(Doc, papel, calibração)  → prévia, impressão do navegador, página pública   html.ts
   ├─ renderPdf(Doc, papel)               → PDF vetorial (pdf-lib, carregado sob demanda)   src/features/documents/pdf.ts
   ├─ toEscPos(Doc)                       → bytes ESC/POS (conector local)                  escpos.ts
   └─ etiquetas: labelsHtml / toZpl / toTspl / toEpl                                        labels.ts
```

- **Uma fonte de verdade**: o snapshot é montado no Postgres (`app.doc_body`) a partir das tabelas reais. O navegador só renderiza. O mesmo snapshot gera prévia, impressão, PDF e página pública: o conteúdo não diverge do registro emitido.
- **Versões**: mesmo conteúdo de negócio (hash) = mesma versão (idempotente). Mudou o registro (ex.: venda cancelada) → nova versão, mesmo número. Documentos de venda preservam a identidade (logo, endereço, textos) da 1ª emissão.
- **Venda concluída**: trigger diferido emite o comprovante na mesma transação; se a emissão falhar, a venda NÃO é desfeita (o documento é emitido ao abrir).
- **Vias**: `record_document_print` conta impressões; a partir da 2ª o documento sai como "2ª VIA" e a reimpressão vai para a auditoria. Reimprimir não toca em venda/estoque/financeiro.
- Módulos compartilhados (`supabase/functions/_shared/documents/*`) não têm dependências: rodam no navegador (Vite) e no Deno (Edge Functions).

## Contratos (onde ficam)

| Contrato pedido | Implementação |
|---|---|
| DocumentService / generateDocument / previewDocument | RPC `issue_document` + `service.ts` (`html`, `demoSnapshot`) |
| PdfRenderer / downloadPdf | `pdf.ts` (`renderPdf`), `service.pdf`, `download` |
| PrintService / printDocument | `service.printHtml` (iframe isolado) + RPC `record_document_print` / `update_print_status` |
| PrinterAdapter | navegador (HTML/@page); protocolos `escpos.ts`, `labels.ts` (ZPL/TSPL/EPL) |
| PrinterDiscoveryAdapter / listPrinterCapabilities | Navegador: não existe (privacidade). Conector: ver PRINTER_SETUP (não instalado) |
| PaperProfileService | `paper.ts` (`PAPERS`, `paperOf`, `sheetSlots`, `dots`) |
| savePrinterProfile | RPC `save_printer_profile` / `delete_printer_profile` |
| DocumentTemplateService | RPC `save_document_settings`, `save_document_identity`; estilos em `html.ts` |
| DocumentDeliveryService / sendDocumentByEmail | RPC `send_document_email` → fila `email_messages` → worker (Resend) |
| WhatsAppDocumentAdapter / sendDocumentByWhatsApp | RPC `prepare_document_whatsapp` + Edge Function `whatsapp` (action `document`) |
| createSecureShareLink / revokeShareLink | RPC `create_document_link` / `revoke_document_links`; leitura `document_public` |
| getDeliveryStatus / DocumentAuditService | RPC `document_history` (situação real do e-mail via `email_messages`) + `audit_logs` |

## Telas

- **Sistema → Impressão e documentos** (`/loja/:slug/impressao`): Impressoras (assistente em 7 etapas, estação, calibração), Etiquetas (produtos e oficina, rolo ou folha A4, ZPL/TSPL/EPL), Modelos e identidade, Fila e histórico, Ajuda.
- **Janela "Documento"** (`DocumentDialog`): prévia + Imprimir | WhatsApp | E-mail | PDF | Link | Histórico. Aberta de: PDV (venda concluída), Vendas (2ª via, pagamento, cancelamento), Orçamentos, Ordens de serviço (9 documentos), Compras, Financeiro (recibo da baixa, extrato), Caixa (resumo).
- **Página pública** `/d/<token>`: só o documento do token, com a marca da loja; sem ERP, sem login.

## Banco (migration `20261029000100_documents.sql`, não destrutiva)

Novas tabelas: `document_settings`, `printer_profiles`, `document_counters`, `generated_documents`, `document_events`, `document_share_tokens` (RLS forçada). `branches` ganhou `document`, `address`, `phone` (colunas novas com default). Entidades do prompt agrupadas: `paper_profiles`/`print_templates` = catálogo em código + `document_settings`; `document_versions` = linhas versionadas em `generated_documents`; `print_jobs` + `document_deliveries` + `document_audit_events` = `document_events` (+ `audit_logs`); `printer_stations` = campo `station` em `printer_profiles`; `document_delivery_preferences` = `document_settings.messages` + consentimento do cliente.
