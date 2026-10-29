# Web Push — validação (29/10/2026)

| Item | Resultado |
|---|---|
| Chaves | `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` no Supabase; `VITE_VAPID_PUBLIC_KEY` na Vercel = mesma chave pública (comparação local) |
| Privada no navegador | Não (scan do `dist`) |
| Envio real | 8 entregas `sent` em 27/10; 1 dispositivo inscrito |
| Conteúdo | Genérico ("Abra o PISTEC para ver os detalhes"), sem dado pessoal |
| Inscrições inválidas | 404/410 → `expired` (teste `webpush.test.ts`) |
| Dispositivos físicos | Não testados nesta etapa (Android, iOS 16.4+ instalado, Windows, macOS) |
