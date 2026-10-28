import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { changePassword, pendingHire, requestRecovery, safeNext, signIn, signUp } from './auth';

export default function AuthPage({ page }: { page: 'login' | 'cadastro' | 'recuperar' | 'nova-senha' }) {
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const navigate = useNavigate();
  const titles = { login: 'Entrar na sua conta', cadastro: 'Criar conta PISTEC', recuperar: 'Recuperar acesso', 'nova-senha': 'Definir nova senha' };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget), email = String(form.get('email') ?? ''), password = String(form.get('password') ?? '');
    setPending(true); setError(''); setMessage('');
    try {
      // Retorno só para rotas internas da contratação (evita redirecionamento aberto).
      if (page === 'login') { await signIn(email, password); navigate(safeNext(new URLSearchParams(location.search).get('next')) ?? pendingHire() ?? '/', { replace: true }); }
      else if (page === 'cadastro') { await signUp(email, password, String(form.get('name') ?? '')); setMessage('Se o cadastro puder ser concluído, você receberá as instruções por e-mail. Confirme o endereço antes de entrar.'); }
      else if (page === 'recuperar') { await requestRecovery(email); setMessage('Se houver uma conta para este endereço, você receberá as instruções de recuperação.'); }
      else { await changePassword(password); setMessage('Senha atualizada.'); navigate('/', { replace: true }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { setPending(false); }
  }
  return <main className="page" style={{ maxWidth: 520, margin: '3rem auto' }}>
    <img src="/brand/logo-horizontal.webp" alt="PISTEC" width="200" /><h1>{titles[page]}</h1>
    <p>Ambiente real. Dados protegidos pela sua conta e pelas permissões da empresa.</p>
    <form className="stack" onSubmit={submit}>
      {page === 'cadastro' && <label className="field">Nome<input name="name" autoComplete="name" required maxLength={120}/></label>}
      {page !== 'nova-senha' && <label className="field">E-mail<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
      {page !== 'recuperar' && <label className="field">Senha<input name="password" type="password" autoComplete={page === 'login' ? 'current-password' : 'new-password'} required minLength={page === 'login' ? 1 : 12} maxLength={128}/>{page !== 'login' && <small>Pelo menos 12 caracteres. Use uma senha exclusiva.</small>}</label>}
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button className="btn primary" disabled={pending}>{pending ? 'Aguarde…' : titles[page]}</button>
      <nav className="toolbar"><Link to="/login">Entrar</Link><Link to="/cadastro">Criar conta</Link><Link to="/recuperar">Esqueci a senha</Link></nav>
      <a href="/demonstracao">Explorar demonstração sem cadastro</a>
    </form>
  </main>;
}
