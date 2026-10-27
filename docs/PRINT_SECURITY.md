# Segurança de documentos e impressão

- **Multi-tenant**: todas as tabelas novas com RLS forçada. Leitura de documentos/eventos/links exige `app.can_read(empresa, módulo do tipo, filial)` — Mecânico não lê comprovante de venda; filial restrita não lê documento de outra filial.
- **Emissão no servidor**: `issue_document` monta o snapshot com `security definer` a partir das tabelas e checa `app.require(empresa, módulo, 'visualizar', filial)`. O cliente não envia conteúdo do documento.
- **Envio** exige permissão de cadastro no módulo (ou PDV para comprovante).
- **Impressoras**: configuração só por Proprietário/Administrador/Gerente; impressora de outra empresa recusada em `record_document_print`. Perfis por empresa + filial + estação.
- **Links**: token aleatório, hash SHA-256 no banco, expiração, revogação, limite de aberturas; regex estrito no token (sem injeção); dados de contato removidos.
- **SSRF**: o servidor nunca imprime em IP/porta informados pelo cliente. Impressão direta só por conector local autorizado.
- **XSS**: textos e dados escapados em HTML; logo só `data:image/(png|jpeg|webp)` ou caminho local; prévia em iframe `sandbox` sem scripts.
- **Credenciais**: Resend/Evolution só em secrets das Edge Functions. Nenhuma chave no frontend ou em tabelas legíveis.
- **Dados pessoais**: etiquetas de oficina sem nome do cliente; histórico mostra destinatário mascarado; página pública só com o nome do cliente.
- **Auditoria**: reimpressão, link criado/revogado, e-mail enfileirado, modelos e impressoras alterados → `audit_logs`.
- Testes: `supabase/tests/documents.test.ts` (isolamento A/B, token forjado/expirado/revogado, permissão, anônimo sem acesso às tabelas), `security.test.ts`.
