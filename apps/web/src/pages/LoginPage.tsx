import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from '@/components/Brand';
import { useAuth } from '@/auth/AuthProvider';

function destination(role?: string, setupNeeded?: boolean) {
  if (role === 'platform_admin') return '/platform';
  return setupNeeded ? '/onboarding' : '/';
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => { if (user) navigate(destination(user.role, user.setupNeeded), { replace: true }); }, [user, navigate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setPending(true);
    try {
      const signedIn = await login(email.trim(), password);
      const next = (location.state as { from?: string } | null)?.from;
      navigate(next && next.startsWith('/') ? next : destination(signedIn.role, signedIn.setupNeeded), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.');
    } finally { setPending(false); }
  }

  return <main className="grid min-h-svh place-items-center p-3 sm:p-5"><div className="w-full max-w-md"><div className="mb-6"><Brand /></div><Card className="rounded-2xl border-border/80 shadow-lg shadow-primary/5"><CardHeader className="space-y-2 p-4 pb-2 sm:p-7 sm:pb-2"><CardTitle className="text-2xl tracking-tight">Acesse sua arena</CardTitle><CardDescription>Entre com o e-mail e a senha da sua conta.</CardDescription></CardHeader><CardContent className="p-4 pt-5 sm:p-7 sm:pt-5"><form className="grid gap-5" onSubmit={submit} noValidate><div className="grid gap-2"><Label htmlFor="email">E-mail</Label><Input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></div><div className="grid gap-2"><Label htmlFor="password">Senha</Label><Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>{error && <p role="alert" className="flex items-start gap-2 text-sm text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</p>}<Button className="h-11" type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Entrar</Button></form><div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">Ainda não tem uma arena? <Link className="font-semibold text-primary underline-offset-4 hover:underline" to="/cadastro">Criar conta</Link></div></CardContent></Card><p className="mt-5 text-center text-xs text-muted-foreground">Acesso seguro à gestão da sua arena.</p></div></main>;
}
