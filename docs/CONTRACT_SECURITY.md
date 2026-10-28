# Segurança e LGPD — contratos

- **RLS FORCE** em todas as tabelas. Leitura de contratos: proprietário, administrador e financeiro da empresa; Super Admin com `billing.read` ou papel contratual. Nenhuma escrita direta: só RPCs `SECURITY DEFINER` com `search_path=''`.
- **Checagens NULL-safe**: `coalesce(... , false)` em toda verificação de papel (corrigido também `delete_printer_profile` da 6.0, que permitia apagar perfil de outra empresa; teste de regressão em `documents.test.ts`).
- **Funções de serviço** (`svc_*`) só para `service_role`; usuários recebem `permission denied` (testado).
- **Imutabilidade**: gatilhos impedem alterar contrato finalizado, dados congelados e hash enviado; `no_delete` em contratos, eventos e identidade da contratada.
- **Storage**: bucket `contracts` privado; download só por URL assinada de 120 s, emitida após `contract_detail` validar acesso.
- **Webhook**: HMAC-SHA256 comparado em tempo constante; segredo ausente = 503; documento desconhecido ignorado.
- **Login com `next`**: apenas `/contratar[/plano]` (regex) — sem redirecionamento aberto.
- **Separação de funções** em versões: quem envia não revisa; aprovador ≠ revisor ≠ remetente; aprovação exige evidência; papéis atribuídos só pelo proprietário.
- **LGPD**: rascunho local do assistente não guarda CPF; CSV do Super Admin neutraliza fórmulas; WhatsApp compartilha só a situação e o link autenticado (sem PDF, sem dados pessoais); e-mails mascarados na auditoria.
- **Página pública** mostra só os termos e a identidade da contratada — nenhum dado de cliente.
