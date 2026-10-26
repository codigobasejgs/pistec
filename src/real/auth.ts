import { realUrl, supabase } from './client';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data;
}
export async function signUp(email: string, password: string, name: string) {
  if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.');
  const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: realUrl('/login') } });
  if (error) throw error;
}
export async function requestRecovery(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: realUrl('/nova-senha') });
  if (error) throw error;
}
export async function changePassword(password: string) {
  if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
export async function enrollMfa() {
  // Tentativas anteriores não concluídas são descartadas: só um QR válido por vez.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'PISTEC', friendlyName: `PISTEC ${new Date().toISOString()}` });
  if (error) throw error;
  return data;
}
export async function verifyMfa(factorId: string, code: string) {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) throw new Error('Informe os seis dígitos do aplicativo autenticador.');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: digits });
  if (error) throw new Error(/invalid|inválid/i.test(error.message)
    ? 'Código não aceito. Digite o código que está aparecendo agora (ele muda a cada 30 segundos). Se continuar, ative "Data e hora automáticas" no celular.'
    : error.message);
}
