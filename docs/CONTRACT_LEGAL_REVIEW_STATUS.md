# Situação jurídica da minuta

| Item | Situação |
|---|---|
| Minuta `PISTEC_Minuta_Contrato_SaaS_2026.docx` (SHA-256 `5932323f5f53…`) | importada como versão **2026.1 em rascunho** |
| Revisão jurídica | **pendente** — não registrada por ninguém |
| Aprovação | **pendente** — nenhuma aprovação foi inventada ou simulada no banco |
| Publicação | **não publicada** → contratação digital real bloqueada no servidor (`prepare_contract`) |
| Identidade da contratada | 59.760.458 MARCO ANTONIO BOGGIAN, CNPJ 59.760.458/0001-91, Empresário Individual, marca PISTEC, Rua Jacques Pilon 189, Vila Piauí, São Paulo/SP, CEP 05109-160 |
| Signatário autorizado da contratada | **não configurado** (obrigatório para contrato real) |

## Para liberar

1. Proprietário atribui papéis em `/admin/contratos` → Modelos e versões → Papéis contratuais (editor, revisor, aprovador, publicador — pessoas distintas para revisão e aprovação).
2. Advogado revisa o texto (ajustes pelo editor em "Editar rascunho"), editor envia para revisão.
3. Revisor registra parecer; aprovador aprova com evidência (ex.: parecer nº, nome/OAB); publicador publica.
4. Proprietário cadastra o signatário autorizado em Identidade jurídica.
5. Configurar credenciais Autentique (`CONTRACT_PROVIDER_INTEGRATION.md`).

Até lá, a página `/contrato` exibe "Minuta em revisão jurídica" e o assistente informa que a contratação digital não está liberada.
