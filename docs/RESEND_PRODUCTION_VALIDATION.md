# Resend — validação (29/10/2026)

| Item | Resultado |
|---|---|
| Domínio | `pistec.com.br` verificado; DKIM `resend._domainkey`, SPF em `send.pistec.com.br`, DMARC `p=reject`; raiz `v=spf1 -all` (domínio não envia por outro serviço) |
| Remetente | `EMAIL_FROM=PISTEC <nao-responda@pistec.com.br>` |
| Envio pela fila | `welcome` aceito com ID do Resend em 29/10 17:52 (`email_messages.status = sent`) |
| Entrega | **Não confirmada pelo sistema**: falta o webhook (`RESEND_WEBHOOK_SECRET` ausente) e a chave atual é só de envio (não consulta eventos) |
| Supabase Auth SMTP | `smtp.resend.com:465`, remetente verificado, modelos PT-BR; recuperação de senha aceita (HTTP 200). Recebimento na caixa: a confirmar por você |
| Templates no código | boas-vindas, convite, teste terminando (7/3/1/0), fatura criada/paga/vencida, suspensão, contrato, documento (orçamento/OS) |

## Para homologar entrega
1. Resend → Webhooks → `https://<ref>.supabase.co/functions/v1/email-webhook`, eventos `email.delivered`, `email.bounced`, `email.complained`.
2. Gravar o segredo do webhook como `RESEND_WEBHOOK_SECRET` no Supabase.
3. Reenviar 1 e-mail para o endereço de homologação e conferir `email_messages.status = delivered`.
