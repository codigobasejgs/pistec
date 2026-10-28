# Limitações conhecidas — contratos

1. **Migração não aplicada em produção** (`20261030000100_contracts.sql`) e funções `contract-sign`/`contract-webhook`/`worker` não publicadas — aguardam autorização.
2. **Autentique sem credenciais**: integração testada só com mock; nenhum envio real ou sandbox.
3. **Minuta sem aprovação jurídica** e sem signatário da contratada → contratação real bloqueada (comportamento correto).
4. **Aditivo**: modelo de dados pronto (`kind='addendum'`, `parent_id`); a UI ainda não gera aditivo — mudança de plano gera novo contrato.
5. **Certificado**: o Autentique embute o certificado no PDF assinado; `certificate_path` aponta para o mesmo arquivo. Não há certificado separado.
6. **Comparação de versões** no Super Admin é por parágrafo (adicionado/removido), não por palavra.
7. **Editor de versão** usa o corpo em JSON; não há editor visual de cláusulas.
8. **Assistente autenticado sem E2E com backend real**: depende da migração aplicada. Coberto por testes SQL (fluxo) e E2E de página pública, redirecionamento de login e 320 px.
9. **WhatsApp** é compartilhamento manual (`wa.me`), não envio automático pela Evolution.
10. Tour da contratação mostra o passo como "aparece quando o assistente chegar nela" quando a etapa ainda não está na tela (o assistente é sequencial).
