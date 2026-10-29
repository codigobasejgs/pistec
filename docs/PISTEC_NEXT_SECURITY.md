# PISTEC NEXT — Segurança

| Risco | Controle | Teste |
|---|---|---|
| Vazamento entre empresas | Toda RPC chama `app.require(tenant, módulo, ação, filial)`; tabelas novas com RLS forçada; `record_attachments` lido via `can_read` do registro | `next.test.ts`: empresa B não lê links, decisões, fotos, frotas; não gera/revoga link nem autoriza IA da A |
| Link do portal adivinhável | 24 bytes aleatórios, só SHA-256 no banco, validade 1–30 dias, revogável, limite 120 visões e 10 ações/hora | token inválido/revogado → `null` |
| Cliente vê custo ou nota interna | `app.portal_record` monta JSON explícito (sem `cost`, sem `notes`, só fotos `shared`) | asserção de ausência de `cost` e `NOTA INTERNA` |
| Preço alterado após envio | Cliente envia hash do conteúdo visto (`app.quote_hash`); divergente → recusa | teste com hash antigo |
| Navegador manda total | `portal_decide` recalcula a partir dos itens no servidor; `update_os_work` não aceita `labor`, itens nem valor | testes |
| Mecânico altera custos | `thirdPartyCost`/`commissionPct` exigem editar Relatórios; custo/hora omitido de quem não vê Relatórios | testes |
| IA inventa dado técnico / escolhe tenant | Tenant vem da autorização do usuário; peças só com ID do catálogo do tenant; saída validada; prompt proíbe torque/fluido/código; nada é gravado sem confirmação | `mechanic-note.test.ts` |
| Dados pessoais à IA | Contexto = OS (título, status, relato, nomes de itens) + catálogo nome/SKU | teste confirma ausência de custo, nome e telefone do cliente |
| Compra automática | Só `approve_supplier_quote` por usuário com cadastrar Compras; gera compra Pendente | teste com Mecânico recusado |
| Envio indevido | Nenhum disparo automático novo: WhatsApp/e-mail abrem o app do usuário com texto pronto | — |
| Fotos | Apenas `data:image/(jpeg|png|webp);base64`, ≤ 700 KB, 24 por registro; `Permissions-Policy` libera câmera/microfone só para o próprio site | teste com `text/html` recusado |
| Portal indexado/vazando referer | `/c/*` com `no-referrer`, `noindex`, `no-store` (vercel.json) | — |

`ponytail:` fotos em `data:` dentro do Postgres; migrar para Storage privado com URL assinada quando o volume por empresa crescer (~5 GB).
