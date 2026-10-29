# PISTEC NEXT — Pendências conhecidas

1. **Nada publicado.** Migration `20261104000100_pistec_next.sql`, Edge Function `mechanic` e frontend aguardam autorização. A migration depende da `20261103000100_trial_one_month.sql` (também pendente) apenas pela ordem; não altera o teste gratuito.
2. **Mecânico IA**: depende de `AI_ENABLED=true`, `GEMINI_API_KEY` e plano com `assistente`. Chamada real com áudio não executada.
3. **WhatsApp Evolution**: instância PISTEC desconectada; os novos módulos usam compartilhamento manual (wa.me). Envio automático de orçamento/lembrete não implementado.
4. **AutoPilot** é calculado na tela (dados carregados). Não há job de servidor nem push/e-mail de alertas. Modo "automatizado" não habilitado por decisão de segurança.
5. **Agenda**: bloqueio de conflito no servidor implementado; cadastro de recursos (turnos, feriados, ausências, capacidade de box) e sugestão de horário na tela da Agenda ainda não.
6. **Garantias/retrabalho**: campos e regra de recusa prontos; painel de indicadores não.
7. **Frotas**: cadastro, vínculo de veículos e portal B2B prontos; condutores, centros de custo em relatórios e aprovação pelo gestor da frota não.
8. **Check-in**: sem assinatura desenhada e sem vídeo. Na demonstração as fotos não são persistidas.
9. **Portal**: acesso por link temporário; sessão própria com OTP/magic link não implementada.
10. **Landing page**: não atualizada com os novos diferenciais (pedido: só após homologação, com screenshots reais).
11. **Super Admin**: sem painel de uso dos novos recursos (consumo Gemini já aparece em uso de IA existente).
12. **Vitest padrão** estoura memória do Node nesta máquina; usar `npx vitest run --maxWorkers=2`.
