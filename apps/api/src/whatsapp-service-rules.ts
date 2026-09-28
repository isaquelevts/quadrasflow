/** Booking timestamps currently encode arena wall time with a Z suffix. */
export function bookingInstant(wallTime: string, timeZone: string): number {
  const wall = Date.parse(wallTime);
  if (!Number.isFinite(wall) || !timeZone) throw new Error('Data ou fuso da arena inválido.');
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(instant)).map(p => [p.type,p.value]));
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += wall - rendered;
  }
  return instant;
}
export const serviceDefaults = { groupId:'', groupEnabled:false, events:['pending','confirmed','cancelled','expired','paid','handoff'], reviewEnabled:false, reviewDelayMinutes:15, reviewMessage:'Oi, {nome}! Como foi o jogo na {arena_name}? Sua avaliação ajuda bastante a nossa arena: {review_link}', reviewEnabledAt:'', manualResumeOnly:true };
export type ServiceSettings = typeof serviceDefaults;
export function safePublicLink(value: unknown, kind: 'maps'|'instagram'|'review'): string {
  const raw=String(value??'').trim(); if (!raw) return '';
  let url: URL; try {url=new URL(raw);} catch {throw new Error('Informe um link completo e válido.');}
  const host=url.hostname.toLowerCase();
  const allowed=kind==='instagram'?host==='instagram.com'||host==='www.instagram.com':host==='g.page'||host==='maps.app.goo.gl'||host==='goo.gl'||host==='search.google.com'||host==='maps.google.com'||host==='www.google.com'||host==='google.com'||host==='www.google.com.br'||host==='google.com.br';
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed||raw.length>1000)throw new Error('Use um link HTTPS do Google ou Instagram correspondente ao campo.');
  return url.toString();
}
export function chatDestination(value:string):string {
  if (/^\d+(?:-\d+)?@g\.us$/.test(value)||/^\d+@lid$/.test(value)||/^\d{10,15}@c\.us$/.test(value)) return value;
  if (/^\d{10,15}$/.test(value)) return `${value}@c.us`;
  throw new Error('Destino WhatsApp inválido.');
}
export function cancellationAllowed(status:string,start:string,timeZone:string,hours:number,now=Date.now()) {
  return ['pending','confirmed'].includes(status)&&bookingInstant(start,timeZone)>now&&
    (status==='pending'||bookingInstant(start,timeZone)-now>=hours*3600000);
}
