# Pendências e limitações conhecidas (impressão e documentos)

1. **Sem homologação física** de nenhuma impressora (térmica, etiqueta, comum) nem em aparelhos Android/iOS.
2. **Conector local (QZ Tray) não integrado**: impressão direta/silenciosa, listagem de impressoras, capacidades e fila local não existem; comandos ZPL/TSPL/EPL são baixados em arquivo. ESC/POS é gerado (testado em bytes) mas não há botão de envio sem conector.
3. **Logo em ESC/POS**: conversão de imagem para raster monocromático (dither) não está ligada à UI; HTML térmico aplica cinza/alto contraste via CSS.
4. **PDF não é armazenado no servidor** (Storage não implementado): o PDF é gerado no navegador a partir do snapshot; WhatsApp e e-mail enviam link seguro, não anexo. Fontes do PDF: Helvetica padrão (WinAnsi) — caracteres fora do Latin-1 viram "?". Logo WebP não entra no PDF (só PNG/JPEG).
5. **E-mail**: depende de `EMAIL_FROM` com domínio verificado no Resend (não configurado) — mensagens ficam na fila.
6. **WhatsApp**: exige instância conectada e consentimento do cliente; envio não foi executado contra a Evolution real nesta entrega (não autorizado disparar mensagens).
7. **Fila de impressão**: registra intenção (enviado ao navegador/conector) e erros informados; não há confirmação de papel impresso.
8. **Editor de modelos**: textos, cores, estilo, logo e alinhamento; reordenar seções e editor visual livre não foram implementados (intencional: evita remover avisos obrigatórios).
9. **Automação de envio** por evento não implementada (só emissão automática do comprovante de venda).
10. **Motivo do cancelamento** de venda não é registrado pelo `cancel_sale` atual; o documento mostra "Não informado no registro".
11. **Checklist** de entrada/saída usa o campo de texto da OS (sem fotos nem combustível estruturado). Fotos exigiriam Storage.
12. **Subdomínio por loja** não configurado; consulta via `/d/<token>`.
13. Página de teste usa a régua textual; não substitui ferramenta de calibração do fabricante.
14. Demonstração: impressoras ficam no navegador; histórico, links e envios só na conta real.
