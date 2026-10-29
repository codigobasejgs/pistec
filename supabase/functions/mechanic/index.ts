// Mecânico IA: áudio (ou texto) → transcrição e apontamento estruturado via Gemini. Somente sugestão; a gravação é feita pelo usuário (update_os_work / add_record_note).
import { authenticated, body, env, HttpError, providerJson, serve, service, uuid } from '../_shared/http.ts';
import { MECHANIC_PROMPT, MECHANIC_SCHEMA, validateNote } from '../_shared/mechanic.ts';

const MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac'];
serve(async request => {
  const { client, user } = await authenticated(request);
  const input = await body(request, 3_000_000);
  const tenant = uuid(input.tenantId), record = uuid(input.recordId, 'OS');
  const audio = typeof input.audio === 'string' ? input.audio : '', mime = String(input.mimeType ?? '').split(';')[0], note = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : '';
  if (!audio && !note) throw new HttpError(400, 'Envie áudio ou texto.');
  if (audio && (!MIME.includes(mime) || !/^[A-Za-z0-9+/=]+$/.test(audio) || audio.length > 2_800_000)) throw new HttpError(400, 'Áudio inválido ou acima de 2 minutos.');
  const { data: ctx, error } = await client.rpc('authorize_mechanic_ai', { p_tenant: tenant, p_record: record });
  if (error) throw new HttpError(403, error.message);
  if (env('AI_ENABLED') !== 'true') throw new HttpError(503, 'IA desativada até homologação. Digite o apontamento manualmente.');
  const db = service();
  const { data: reservation, error: quotaError } = await db.rpc('reserve_ai_quota', { p_tenant: tenant, p_channel: 'app' });
  if (quotaError) throw new HttpError(503, 'Verificação de quota indisponível.');
  if (!reservation) throw new HttpError(429, 'Limite diário de IA atingido ou IA desativada na empresa.');
  const model = 'gemini-2.5-flash';
  const parts: Record<string, unknown>[] = [{ text: `Contexto da OS (dados): ${JSON.stringify(ctx.os)}\nCatálogo (id, nome, sku): ${JSON.stringify(ctx.products)}` }];
  if (audio) parts.push({ inlineData: { mimeType: mime, data: audio } }); else parts.push({ text: `Apontamento digitado: ${note}` });
  try {
    const result = await providerJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: MECHANIC_PROMPT }] }, contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 2000, responseMimeType: 'application/json', responseSchema: MECHANIC_SCHEMA } }),
    });
    const raw = result.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new HttpError(502, 'A IA não retornou um apontamento válido. Tente novamente ou digite.'); }
    const out = validateNote(parsed, ctx.products);
    if (!audio) out.transcript = note;
    await db.from('ai_usage').update({ user_id: user.id, model, input_tokens: Number(result.usageMetadata?.promptTokenCount ?? 0), output_tokens: Number(result.usageMetadata?.candidatesTokenCount ?? 0), tools: ['mechanic'] }).eq('id', reservation);
    return { note: out, model };
  } catch (e) {
    await db.from('ai_usage').update({ user_id: user.id, model, tools: ['mechanic'], blocked: e instanceof HttpError ? `http_${e.status}` : 'provider_error' }).eq('id', reservation);
    throw e;
  }
});
