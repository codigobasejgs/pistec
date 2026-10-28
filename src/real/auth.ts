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
// Retorno pós-login/cadastro: só a jornada de contratação (sem redirecionamento aberto).
const HIRE_PATH = /^\/contratar(\/[a-z0-9-]{2,40})?(\?periodo=(monthly|quarterly|annual))?$/;
export const safeNext = (next: string | null | undefined) => next && HIRE_PATH.test(next) ? next : null;
// Plano escolhido em /planos (não é dado pessoal): sobrevive à confirmação de e-mail e ao cadastro da empresa.
const INTENT = 'pistec-hire-intent';
export function rememberHire(path: string) { try { if (safeNext(path)) localStorage.setItem(INTENT, path); } catch { /* opcional */ } }
export function pendingHire() { try { return safeNext(localStorage.getItem(INTENT)); } catch { return null; } }
export function clearHire() { try { localStorage.removeItem(INTENT); } catch { /* opcional */ } }

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
