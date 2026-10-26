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
