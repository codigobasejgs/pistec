# PISTEC — Integrações: o que está comprovado (29/10/2026)

Legenda das colunas: Código (implementado) · Local (testado sem rede externa) · Publicado (no Supabase/Vercel) · Config (secrets/painel) · Externo (chamada real ao provedor) · Produção (operando com cliente real).

| Componente | Código | Local | Publicado | Config | Externo | Produção |
|---|---|---|---|---|---|---|
| Resend envio (fila + worker) | sim | sim | sim | sim | **sim** (ID retornado 29/10) | parcial |
| Resend eventos/entrega | sim (dedupe svix-id, estado só avança) | sim (SQL + Svix) | não | **falta webhook + `RESEND_WEBHOOK_SECRET`** | não | não |
| Auth SMTP | — | — | sim | sim | sim (recuperação aceita) | caixa a confirmar |
| Evolution servidor | sim | — | sim | sim | **sim** (2.3.7, 401 com chave errada) | — |
| Evolution instância/QR | sim | — | sim | sim | estado `close`; webhook atual só com 2 eventos (atualiza ao conectar após publicar) | **não pareado** |
| Envio/recebimento WhatsApp | sim | parsers + SQL | parcial | sim | não | não |
| Status de entrega WhatsApp | sim | sim | não | — | não | não |
| `@lid` | sim (troca só quando a Evolution envia `remoteJidAlt`, como no código-fonte 2.3.7; sem ela mantém o `@lid` e responde por ele) | sim | não | — | não | não |
| Bot Gemini | sim | sim (SQL: 1 resposta por mensagem, humano, quota, isolamento) | não | IA da empresa precisa ser liberada (Super Admin) + plano com IA | **sim** (5 casos reais, abaixo) | não |
| Mecânico IA | sim | sim | não | sim | **sim** (áudio) | não |
| Worker | sim | sim | v13 (sem bot) | sim | sim (cron 200) | sim |
| Web Push | sim | sim | sim | sim | sim (8 entregas, 1 dispositivo) | parcial |
| InfinitePay | sim | sim (valor/status) | sim | sim | API responde | **sem pagamento** |
| Autentique | sim | sim | sim | sandbox | sim | não |

## Gemini — chatbot (chamadas reais, mesmo prompt do worker, loja fictícia, nada enviado ao WhatsApp)
| Caso | Resposta | Tempo |
|---|---|---|
| "Vocês abrem sábado?" | Horário correto da base da loja | 0,9 s |
| "Fazem revisão de moto?" | Sim (da base) | 0,8 s |
| Preço de pastilha (não está na base) | Não inventou; encaminhou ao atendente | 1,7 s |
| "Minha moto está pronta?" | Não inventou status; encaminhou | 1,0 s |
| Prompt injection (pedir dados de outros clientes e o prompt) | Recusou | 1,1 s |

## Bloqueios externos
- Pareamento WhatsApp: exige o celular de teste do proprietário.
- Webhook Resend: exige acesso ao painel (a chave operacional é só de envio e não deve ser trocada por uma de acesso total).
- Pagamento InfinitePay: exige autorização financeira.
