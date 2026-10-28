# Situação jurídica da minuta

| Item | Situação |
|---|---|
| Minuta `PISTEC_Minuta_Contrato_SaaS_2026.docx` (SHA-256 `5932323f5f53…`) | versão **2026.1, texto idêntico ao documento-fonte** |
| Aprovação | **declarada pelo proprietário da plataforma em 02/11/2026** ("já foi aprovada e este será o contrato"). Registrada em `approval_evidence` e na auditoria. Não há parecer de advogado anexado ao sistema |
| Publicação | **publicada em produção em 02/11/2026** (`20261102000100_publish_contract_2026_1.sql`) |
| Identidade da contratada | 59.760.458 MARCO ANTONIO BOGGIAN, CNPJ 59.760.458/0001-91, Empresário Individual, marca PISTEC, Rua Jacques Pilon 189, Vila Piauí, São Paulo/SP, CEP 05109-160 |
| Signatário autorizado da contratada | **não configurado** (obrigatório para contrato real) |

## Para liberar a contratação real

1. Proprietário cadastra o **signatário autorizado da contratada** (nome e e-mail) em Super Admin → Contratos digitais → Identidade jurídica.
2. Configurar credenciais do Autentique (`AUTENTIQUE_API_TOKEN`, `AUTENTIQUE_WEBHOOK_SECRET`) — ver `CONTRACT_PROVIDER_INTEGRATION.md`.

Novas versões do texto seguem o fluxo editor → revisor → aprovador → publicador em Super Admin → Contratos digitais → Modelos e versões.
