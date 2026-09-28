import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from '@/components/Brand';
import { useAuth } from '@/auth/AuthProvider';

export function SignupPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState({ arenaName: '', adminName: '', phone: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => { if (user) navigate(user.role === 'platform_admin' ? '/platform' : user.setupNeeded ? '/onboarding' : '/', { replace: true }); }, [user, navigate]);

  function update(key: keyof typeof fields, value: string) { setFields((current) => ({ ...current, [key]: value })); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (fields.password.length < 8) { setError('Use uma senha com pelo menos 8 caracteres.'); return; }
    if (fields.password !== fields.confirm) { setError('As senhas não conferem.'); return; }
    setPending(true);
    try {
      await register({ arenaName: fields.arenaName, adminName: fields.adminName, phone: fields.phone, email: fields.email.trim(), password: fields.password });
      navigate('/onboarding', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a conta.'); }
    finally { setPending(false); }
  }

  return <main className="grid min-h-svh place-items-center p-3 sm:p-5"><div className="w-full max-w-lg"><div className="mb-6"><Brand /></div><Card className="rounded-2xl border-border/80 shadow-lg shadow-primary/5"><CardHeader className="p-4 pb-4 sm:p-7 sm:pb-4"><Button asChild variant="ghost" size="sm" className="-ml-3 mb-3 w-fit"><Link to="/login"><ArrowLeft /> Voltar ao acesso</Link></Button><CardTitle className="text-2xl tracking-tight">Crie o acesso da sua arena</CardTitle><CardDescription>Comece com os dados do responsável. Depois, configure sua arena em quatro etapas.</CardDescription></CardHeader><CardContent className="p-4 pt-0 sm:p-7 sm:pt-0"><form className="grid gap-4" onSubmit={submit} noValidate><div className="grid gap-2"><Label htmlFor="arenaName">Nome da arena</Label><Input id="arenaName" autoComplete="organization" maxLength={100} value={fields.arenaName} onChange={(event) => update('arenaName', event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="adminName">Seu nome</Label><Input id="adminName" autoComplete="name" maxLength={100} value={fields.adminName} onChange={(event) => update('adminName', event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="phone">Telefone com DDD</Label><Input id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(31) 99999-9999" value={fields.phone} onChange={(event) => update('phone', event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="email">E-mail de acesso</Label><Input id="email" type="email" autoComplete="email" maxLength={254} value={fields.email} onChange={(event) => update('email', event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="password">Senha</Label><Input id="password" type="password" autoComplete="new-password" minLength={8} maxLength={200} value={fields.password} onChange={(event) => update('password', event.target.value)} required /><p className="text-xs text-muted-foreground">Pelo menos 8 caracteres.</p></div><div className="grid gap-2"><Label htmlFor="confirm">Confirme a senha</Label><Input id="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={200} value={fields.confirm} onChange={(event) => update('confirm', event.target.value)} required /></div>{error && <p role="alert" className="flex gap-2 text-sm text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</p>}<Button className="mt-1 h-11" type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Criar conta e continuar</Button></form><p className="mt-4 text-xs leading-5 text-muted-foreground">Ao criar a conta, você poderá editar os dados da arena depois em Configurações.</p></CardContent></Card></div></main>;
}
