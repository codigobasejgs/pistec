# QA — Print & Documents 6.0 (2026-10-27, ambiente local)

| Verificação | Resultado |
|---|---|
| `tsc -b`, `eslint .`, `npm run build` | OK |
| Vitest (suíte completa) | **246/246** |
| — `src/features/documents/documents.test.ts` (14) | Conteúdo de todos os tipos; não fiscal; 2ª via; cancelamento; orçamento sem aceite; CDC na OS; HTML 58/80/A4/A5, escape de dados e logo; 200 itens; PDF A4 multipágina com numeração e metadados; PDF 80 mm recortado; A5; EAN-13 x Code 128; ESC/POS (init, CP860, colunas, corte, gaveta); ZPL 203/300 dpi, TSPL com calibração, EPL; folha A4 com posição inicial; etiqueta de oficina sem cliente; escolha de impressora por estação/filial/tipo |
| — `supabase/tests/documents.test.ts` (8, Postgres real/PGlite) | Comprovante emitido na transação da venda com dados reais e filial; versão idempotente; identidade histórica preservada; vias e auditoria; reimpressão não cria venda; isolamento A/B (documento, impressora, leitura); link (hash, revogação, expiração, token forjado, anônimo sem acesso); e-mail (validação, fila, idempotência, situação real); WhatsApp (consentimento, telefone, instância, idempotência); Mecânico sem acesso; documento de cancelamento |
| — `api/`, `security.test.ts` | OK (helper `doc_module` exposto por ser mapeamento puro usado em RLS) |
| Deno type-check (8 Edge Functions) | OK (`whatsapp` com action `document`; `worker` com remetente de exibição) |
| Playwright (suíte completa, local, demo) | **43/43** — novos: venda→documento (marca, não fiscal, troca de papel, PDF baixado, envio bloqueado na demo); assistente de impressora + etiquetas + ZPL; documentos da OS (entrada e garantia) + celular 390 px sem rolagem |
| Amostras geradas | `docs/print-samples/`: 10 PDFs (80/58 mm, 2ª via A4, orçamento, OS entrada, OS conclusão A5, termo de entrega, garantia A5, documento extenso 90 itens, página de teste) + HTML, ZPL/TSPL de 3 tamanhos e `venda-80mm.escpos.bin` |
| Capturas | `docs/screenshots/print/` (9: desktop, tablet, celular) |

## Produção (2026-10-27, autorizado)
| Etapa | Resultado |
|---|---|
| Migration `20261029000100_documents` no Supabase remoto | 18/18 aplicadas; smoke geral PASS |
| Smoke de documentos (`supabase/tests/remote-smoke-documents.sql`, com rollback) | PASS: emissão com dados reais, vias, link (público sem contato, revogado), e-mail na fila, WhatsApp validado sem instância, isolamento B; nenhum dado ficou |
| Edge Functions | `whatsapp` v2 (verify_jwt) e `worker` v7 (token próprio) ACTIVE, publicadas pela API (`scripts/deploy-function.mjs`; o CLI 2.120 falhava na rede); 401 sem credencial; cron do worker respondendo 200 |
| Vercel | 1º deploy falhou (o `.vercelignore` excluía `supabase/` e o frontend importa `supabase/functions/_shared/documents`); corrigido e produção READY; novos chunks no precache do `sw.js`; `/d/*` com `no-referrer`, `noindex`, `no-store` |
| Fluxo real com conta/empresa temporárias (`scripts/documents-prod-check.mjs`) | Login → abrir caixa → venda → comprovante VEN-000001 emitido pelo servidor com endereço cadastrado → PDF baixado → link seguro → histórico → página pública → revogação → indisponível. Conta e empresa removidas (produção sem dados de teste) |

## Não executado
- Nenhum envio real de e-mail (Resend sem domínio) ou WhatsApp (sem autorização para disparar mensagens a clientes).
- Nenhuma impressão física; nenhum teste em aparelho (Android/iOS/Windows/macOS) — ver [PRINT_COMPATIBILITY_MATRIX](PRINT_COMPATIBILITY_MATRIX.md).

## Critérios de aceitação
Implementado e testado localmente: central, configuração e fallback do navegador, perfis de papel, calibração, modelos A4/A5 e térmicos, etiquetas, prévia, PDF, logo e dados da filial, comprovante, 2ª via, orçamento, OS (entrada, diagnóstico, andamento, conclusão), checklist, termo de entrega, garantia, etiquetas de produtos e de oficina, inventário, compras, recibos/extrato/caixa, links seguros, histórico, auditoria, reimpressão, permissões, RLS, multi-tenant, tour, ajuda.
Implementado, **dependente de configuração/validação externa**: WhatsApp (Evolution conectada), e-mail (domínio no Resend).
**Não implementado**: conector local (QZ Tray), detecção automática de papel, emissão fiscal, subdomínio por loja, anexos PDF em mensagens, automação de envio, editor de seções.
