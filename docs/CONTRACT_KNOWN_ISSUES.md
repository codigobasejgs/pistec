# Limitações conhecidas — contratos

1. **Produção:** `20261030000100_contracts.sql` aplicada e funções publicadas em 28/10/2026. `20261101000100_contract_checkout.sql` (contratação a partir de /planos) **ainda não aplicada** — aguarda autorização.
2. **Autentique sem credenciais**: integração testada só com mock; nenhum envio real ou sandbox.
3. **Minuta sem aprovação jurídica** e sem signatário da contratada → contratação real bloqueada (comportamento correto).
4. **Aditivo**: modelo de dados pronto (`kind='addendum'`, `parent_id`); a UI ainda não gera aditivo — mudança de plano gera novo contrato.
5. **Certificado**: o Autentique embute o certificado no PDF assinado; `certificate_path` aponta para o mesmo arquivo. Não há certificado separado.
6. **Comparação de versões** no Super Admin é por parágrafo (adicionado/removido), não por palavra.
7. **Editor de versão** usa o corpo em JSON; não há editor visual de cláusulas.
8. **Assistente autenticado sem E2E com backend real**: ver item 13.
9. **WhatsApp** é compartilhamento manual (`wa.me`), não envio automático pela Evolution.
10. Tour da contratação mostra o passo como "aparece quando o assistente chegar nela" quando a etapa ainda não está na tela (o assistente é sequencial).
11. **Licença perpétua sem contrato próprio**: a minuta 2026.1 é de assinatura SaaS (renovação periódica). Licença perpétua precisa de minuta específica (licença, hospedagem, manutenção, atualizações) — pendente de redação e aprovação jurídica; não é oferecida na contratação online.
12. **Assinatura incorporada (embed)**: hoje por convite de e-mail do Autentique; embed depende de homologação com credenciais.
13. **Jornada autenticada ponta a ponta**: testada no banco (SQL, 9 combinações plano × periodicidade) e na interface sem login; a etapa de contrato com usuário real só roda após aplicar `20261101000100_contract_checkout.sql` e com a minuta publicada (ou em homologação sandbox pelo Super Admin).
