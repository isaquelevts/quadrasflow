import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Envio de e-mail por SMTP (Resend, Hostinger, Google Workspace…).
 * Sem SMTP_HOST e SMTP_FROM configurados, o envio fica desligado e quem chama segue sem e-mail.
 */
let transporter: Transporter | null | undefined;

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function transport() {
  if (transporter !== undefined) return transporter;
  if (!mailConfigured()) return (transporter = null);
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
  });
  return transporter;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Envia o convite. Devolve true só se o servidor SMTP aceitou a mensagem. */
export async function sendInviteEmail(input: { to: string; name: string; arenaName: string; roleLabel: string; link: string; expiresAt: string }) {
  const mail = transport();
  if (!mail) return false;
  const expires = new Date(input.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const subject = `Convite para acessar ${input.arenaName} no QuadrasFlow`;
  const text = `Olá, ${input.name}!\n\nVocê foi convidado para acessar o painel da ${input.arenaName} no QuadrasFlow como ${input.roleLabel}.\n\nCrie sua senha pelo link abaixo (válido até ${expires}):\n${input.link}\n\nSe você não esperava este convite, ignore este e-mail.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0e1512;max-width:520px">
    <p>Olá, ${escapeHtml(input.name)}!</p>
    <p>Você foi convidado para acessar o painel da <b>${escapeHtml(input.arenaName)}</b> no QuadrasFlow como <b>${escapeHtml(input.roleLabel)}</b>.</p>
    <p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#0f3d30;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Criar minha senha</a></p>
    <p style="color:#6b7471;font-size:13px">O link vale até ${expires} e só pode ser usado uma vez. Se você não esperava este convite, ignore este e-mail.</p>
  </div>`;
  await mail.sendMail({ from: process.env.SMTP_FROM, to: input.to, subject, text, html });
  return true;
}
