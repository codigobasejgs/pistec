// Teste gratuito: 1 mês calendário (mesma regra de app.trial_end no banco).
// Data no calendário de São Paulo + N meses; se o dia não existe no mês final (29/30/31), usa o último dia desse mês.
// O acesso vale até o fim do dia retornado. O servidor é a fonte de verdade; aqui só para a demonstração e exibição.

export const DEFAULT_TRIAL_MONTHS = 1;
export const TRIAL_TZ = 'America/Sao_Paulo';

/** Dia (YYYY-MM-DD) no calendário de São Paulo para um instante. */
export function saoPauloDay(instant: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TRIAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => p.find(x => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Último dia (YYYY-MM-DD) do teste iniciado em `start`. */
export function trialEndDay(start: Date, months = DEFAULT_TRIAL_MONTHS): string {
  if (!Number.isInteger(months) || months < 0) throw new Error('Duração de teste inválida.');
  const [y, m, d] = saoPauloDay(start).split('-').map(Number);
  const target = m - 1 + months, year = y + Math.floor(target / 12), month = target % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Dias restantes até o fim do teste (0 = termina hoje; negativo = encerrado). */
export function trialDaysLeft(endDay: string, now = new Date()): number {
  return Math.round((Date.parse(`${endDay}T12:00:00Z`) - Date.parse(`${saoPauloDay(now)}T12:00:00Z`)) / 864e5);
}

export const trialLabel = (months: number) => months <= 0 ? 'Sem teste gratuito' : months === 1 ? '1 mês grátis' : `${months} meses grátis`;
