# Variáveis do modelo contratual

Definidas em `variables()` de `supabase/functions/_shared/contracts/template.ts`. `fill()` **lança erro** se alguma variável usada estiver vazia ou não existir — nenhum contrato sai com `{{...}}`.

| Grupo | Variáveis |
|---|---|
| Contratada (congelada de `legal_provider_profiles`) | `contratada_nome`, `contratada_cnpj`, `contratada_natureza`, `contratada_marca`, `contratada_endereco`, `contratada_contato` |
| Contratante | razão social, nome fantasia, CNPJ/CPF, endereço, telefone, e-mail (ver `variables()`) |
| Representante | nome, CPF, cargo, e-mail, telefone |
| Comercial (congelado em `prepare_contract`) | plano, periodicidade, preço, desconto, total, cupom, dias de teste, fim do teste, início, próximo vencimento, limites (usuários, filiais, produtos, WhatsApp, IA/dia), recursos, módulos |
| Textos contratuais | renovação, cancelamento, reajuste, tolerância, notificação, suporte, prazo/formatos de exportação, retenção, integrações, forma de cobrança |
| Documento | número, data, versão; hash e dados de assinatura mostram "registrado pelo provedor" até a conclusão |

Regras:
- A identidade da contratada nunca é digitada no contrato: vem do cadastro ativo, e o nome empresarial é o registrado (PISTEC é marca).
- Nova variável = alterar `variables()` + teste em `src/features/contracts/contracts.test.ts`; versões que usem variável inexistente falham na pré-visualização do Super Admin e ao salvar o rascunho.
