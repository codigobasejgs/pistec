# Gemini — validação (29/10/2026)

| Item | Resultado |
|---|---|
| Runtime | Só backend: `assistant`, `mechanic`, `worker` (bot). Chave nunca vai ao navegador (scan do `dist` sem ocorrências) |
| Modelo | `gemini-2.5-flash` |
| Flag | `AI_ENABLED=true` em produção |
| Uso real em produção | Nenhum registro em `ai_usage` |
| Limites | Por empresa (`ai_settings.daily_limit`) e por plano (`plans.ai_messages`); reserva antes da chamada |

## Teste real autorizado (fora do app, mesma requisição da função `mechanic`)
Áudio sintético pt-BR (TTS) com: troca de óleo e filtro, desgaste de pastilha, "torque de 80 Newton metro". Catálogo fictício de 3 itens.
- HTTP 200 em 4,9 s; 726 tokens de entrada (490 de áudio), 154 de saída.
- Transcrição fiel; serviços e recomendação corretos; peças apenas do catálogo (óleo, filtro); **torque colocado em "uncertain"** (não aceito como dado técnico).
- Saída validada por `validateNote` (o mesmo código da Edge Function).

## Pendente
- Publicar `mechanic` e o worker com o bot; testar pelo app com uma OS real.
- Chatbot: depende do pareamento da Evolution.
