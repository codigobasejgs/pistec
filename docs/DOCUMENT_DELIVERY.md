# Entrega digital de documentos

## Link seguro
- `create_document_link(tenant, documento, dias 1–30)`: token aleatório de 192 bits (48 hex), **só o SHA-256 fica no banco**. Revogável (`revoke_document_links`), expira, 60 aberturas/hora por token.
- Página `/d/<token>`: mostra só aquele documento com a marca da loja (sem ERP). Os dados de contato do cliente são removidos (só o nome). Cabeçalhos `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.
- Não há URL pública permanente nem bucket público. PDFs não são armazenados no servidor: o PDF é gerado no navegador a partir do snapshot persistido (mesmo conteúdo do registro).

## E-mail (Resend)
`send_document_email` valida o destinatário, aplica limite (30/h por empresa, além do limite geral de 50/h), cria link de 7 dias e enfileira em `email_messages` (template `document`). O worker envia pelo **remetente técnico verificado** (`EMAIL_FROM`) com nome de exibição "<Loja> via PISTEC" e `reply_to` = e-mail da loja. Sem `EMAIL_FROM` com domínio verificado os e-mails **ficam na fila** (situação atual do ambiente: Resend sem domínio). Estados: Na fila → Processando → Aceito pelo provedor → Entregue (webhook) / Falhou / bounce. Idempotência pela chave da ação. PDF não é anexado (link seguro).

Domínio próprio da loja como remetente: exigiria verificação DNS por empresa no Resend — não implementado.

## WhatsApp (Evolution API 2.3.7)
`prepare_document_whatsapp` (banco) valida: permissão, cliente identificado, **consentimento de WhatsApp registrado**, telefone com DDD (normalizado para 55…), instância da loja **conectada**, limite 30/h, idempotência. A Edge Function `whatsapp` (action `document`) envia texto + link seguro por `sendText` e registra o retorno. "Aceito" = aceito pela Evolution; entrega/leitura não são confirmadas. Envio de PDF como mídia não foi feito (o PDF não fica no servidor); o link cumpre o papel sem URL pública permanente.

## Mensagens padrão
Venda: "Olá, {nome}. Segue o comprovante da sua compra na {loja}. Obrigado pela preferência!" · Orçamento · OS · Veículo pronto (OS concluída) — editáveis antes de enviar.

## Automações
Padrão conservador: **venda concluída gera o comprovante automaticamente** (trigger); os demais documentos são gerados ao abrir. **Nenhum envio automático** — todo envio é ação do operador. Automação de envio por evento ficou fora desta entrega.

## Subdomínio por loja
Não há domínio próprio/DNS curinga; a consulta usa `/d/<token>` na origem atual. A identidade visual vem do documento, nunca do hostname.
