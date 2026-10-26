-- Agendamentos: worker (1 min) e ciclo de cobrança (diário, 03:15 UTC).
-- URL e token do worker ficam no Vault (por ambiente), nunca no SQL versionado:
--   select vault.create_secret('<https://<ref>.supabase.co/functions/v1/worker>', 'pistec_worker_url');
--   select vault.create_secret('<WORKER_TOKEN>', 'pistec_worker_token');
-- Ambientes sem pg_cron/pg_net (testes PGlite) ignoram este arquivo.
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net indisponíveis: agendamentos não criados.';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.schedule('pistec-worker', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'pistec_worker_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pistec_worker_token')),
      body := '{}'::jsonb, timeout_milliseconds := 55000)
    where exists (select 1 from vault.decrypted_secrets where name = 'pistec_worker_url')
  $job$);
  perform cron.schedule('pistec-billing-cycle', '15 3 * * *', 'select public.run_billing_cycle()');
  -- Histórico do cron cresce indefinidamente sem limpeza.
  perform cron.schedule('pistec-cron-cleanup', '30 3 * * *', $job$ delete from cron.job_run_details where end_time < now() - interval '14 days' $job$);
end $outer$;
