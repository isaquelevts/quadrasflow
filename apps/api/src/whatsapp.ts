import {arenaInformation,bookingLabel,serviceSettings,handoff,ownBookings,prepareCancellation,cancelOwnBooking,queueCourtPhotos,rescheduleCheck,rescheduleOwnBooking} from './whatsapp-services.js';
import {paidForBooking} from './booking-policy.js';
import {deliverOne} from './whatsapp-delivery-worker.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { appAudit, blockedSlots, bookingEvents, bookings, clients, companies, companyHours, companyPriceSlots, courts, integrationSettings, messageTemplates, monthlyMembers, webhookEvents, whatsappConversations, whatsappMessages, whatsappDeliveries } from '@quadrasflow/database';
import { db } from './database.js';
import { bookingAmountCents } from './pricing.js';
import { createBookingPixCharge, linkChargeCents, PIX_MINUTES } from './mercadopago.js';
import { botPaused, DEFAULT_OUTSIDE_HOURS_MESSAGE, isOutsideHumanHours, LEGACY_OUTSIDE_HOURS_MESSAGE, outsideHoursText, wantsHuman } from './whatsapp-handoff-rules.js';
import { activeCourts, confirmPendingBooking, saveClientEmail, dayScheduleReply, sendCourtPhotos, listFreeCourts, prepareBookingSummary, priceReply, runWhatsAppAgent, type AgentDeps, type PendingBooking } from './whatsapp-agent.js';
import { durationLabel, parseTimeDuration, type Duration } from './whatsapp-court-search.js';
import { testPhoneMatches } from './whatsapp-test-mode.js';
import { parseCourtRules, ruleProblem, ruleProblemText } from './court-rules.js';
import { DATE_QUESTION, NAME_QUESTION, askDurationText, isAllCourts, isCancelIntent, isRescheduleIntent, rescheduleSummary, rescheduledText, pickBooking, type BookingOption, isGreeting, isPhotoRequest, photoQuestion, isPeriodOnly, isPriceQuestion, isReserveIntent, isTimesQuestion, matchCourt, mentionsDate as saysDate, parseBareTime, parsePeriod, timeUnavailableText, welcomeMenu } from './whatsapp-flow.js';
import { durationChoices, durationError, durationRangeText, maxDurationOf, validDuration } from './booking-duration.js';
import { confirmsCancellation, confirmsSummary } from './whatsapp-confirm.js';
import { isSimulating, runSimulation, simulationNote, simulatorPhone, SIMULATOR_PREFIX } from './whatsapp-simulation.js';
import { chargeAmountCents, type PaymentPolicy } from './payment-policy.js';
import { displayDate, localNow, parseArenaDate } from './arena-dates.js';
import { adminOf, audit, companyOf, fail, text, userOf } from './arena.js';
const auth=(app:FastifyInstance)=>({preHandler:app.authenticate});const bodyOf=(req:{body?:unknown})=>(req.body||{}) as Record<string,unknown>;const digits=(v:unknown)=>String(v??'').replace(/\D/g,'');
type JsonRecord=Record<string,unknown>;
function recordOf(value:unknown):JsonRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{ };}
function chatAddress(value:unknown):string{if(typeof value==='string')return value.trim();const object=recordOf(value);for(const key of ['_serialized','serialized','remoteJid','remote','Chat','chatId','id']){const nested=object[key];if(typeof nested==='string'&&nested.trim())return nested.trim();if(nested&&typeof nested==='object'){const result=chatAddress(nested);if(result)return result;}}return '';}
function isPrivateChatAddress(value:string):boolean{return /^\d{7,15}$/.test(value)||/^\d+@(c\.us|lid)$/i.test(value);}
function isPrivateIncomingPayload(payload:JsonRecord):boolean{
 const data=recordOf(payload._data),info=recordOf(data.Info??data.info),key=recordOf(data.key),chat=recordOf(payload.chat);
 if(payload.isGroup===true||chat.isGroup===true||info.IsGroup===true||info.isGroup===true||data.isGroup===true)return false;
 const candidates=[payload.from,payload.chatId,payload.chat,info.Chat,info.chat,key.remoteJid,key.remote,recordOf(data.id).remote,recordOf(data.id).remoteJid];
 const addresses:string[]=[];
 for(const candidate of candidates){if(candidate===undefined||candidate===null||candidate==='')continue;const address=chatAddress(candidate);if(!address||!isPrivateChatAddress(address))return false;addresses.push(address);}
 if(!addresses.length||!isPrivateChatAddress(addresses[0]!))return false;
 const messageId=String(payload.id||''),embeddedJid=messageId.match(/(?:^|_)([^_]+@(?:g\.us|broadcast|newsletter))(?:_|$)/i)?.[1];
 if(embeddedJid)return false;
 return true;
}
type WahaConfig={session?:string;enabled?:boolean;status?:string};
type BotConfig=PaymentPolicy&{timeZone:string;enabled:boolean;testMode:boolean;testPhones:string[];welcome:string;handoffMessage:string;reactivateAfterHours:number;humanStart:string;humanEnd:string;outsideHoursMessage:string;manualResumeOnly?:boolean;notifyPayment:boolean;remindUnpaid:boolean;menuOptions:{id:string;label:string;response:string}[]};
const defaultBotConfig:BotConfig={timeZone:'',enabled:true,testMode:false,testPhones:[],welcome:'Como posso te ajudar?',handoffMessage:'Certo! Me conta rapidinho o que você precisa. A equipe responde por aqui assim que assumir. 👇',reactivateAfterHours:4,humanStart:'06:00',humanEnd:'23:00',outsideHoursMessage:DEFAULT_OUTSIDE_HOURS_MESSAGE,paymentMode:'none',paymentPercent:50,paymentFixedCents:5000,notifyPayment:true,remindUnpaid:true,menuOptions:[]};
async function botConfig(companyId:string):Promise<BotConfig>{const row=(await db.select().from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'whatsapp_bot'))).limit(1))[0];const bot={...defaultBotConfig,...(row?.settings||{})} as BotConfig;if(bot.outsideHoursMessage===LEGACY_OUTSIDE_HOURS_MESSAGE)bot.outsideHoursMessage=DEFAULT_OUTSIDE_HOURS_MESSAGE;return bot;}
/** Retomada do bot: a opção fica na configuração do bot; arenas antigas herdam a de "Informações & automações". */
async function resumePolicy(companyId:string,bot:BotConfig){return {manualResumeOnly:bot.manualResumeOnly??(await serviceSettings(companyId)).manualResumeOnly,reactivateAfterHours:bot.reactivateAfterHours};}
async function mercadoPagoConnected(companyId:string){const row=(await db.select({settings:integrationSettings.settings}).from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'mercadopago'))).limit(1))[0];return (row?.settings as {connected?:boolean}|undefined)?.connected===true;}
async function saveBotConfig(companyId:string,value:BotConfig){const now=new Date().toISOString();await db.insert(integrationSettings).values({companyId,provider:'whatsapp_bot',settings:value,updatedAt:now}).onConflictDoUpdate({target:[integrationSettings.companyId,integrationSettings.provider],set:{settings:value,updatedAt:now}});}
async function config(companyId:string):Promise<WahaConfig>{const row=(await db.select().from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'waha'))).limit(1))[0];return (row?.settings||{}) as WahaConfig;}
async function saveConfig(companyId:string,value:WahaConfig){const now=new Date().toISOString();await db.insert(integrationSettings).values({companyId,provider:'waha',settings:value,updatedAt:now}).onConflictDoUpdate({target:[integrationSettings.companyId,integrationSettings.provider],set:{settings:value,updatedAt:now}});}
async function sendText(companyId:string,session:string,contact:string,message:string){const isLid=/^\d+@lid$/.test(contact),phone=isLid?contact:digits(contact),chatId=isLid?contact:`${phone}@c.us`;if(isSimulating())simulationNote('reply',message);else{const base=process.env.WAHA_BASE_URL||'',key=process.env.WAHA_API_KEY||'';if(!base||!key)throw fail(503,'WAHA não está configurado no servidor.');const response=await fetch(`${base.replace(/\/$/,'')}/api/sendText`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({chatId,text:message,session}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw fail(502,'O WAHA não conseguiu enviar esta mensagem. Verifique a sessão.');}const now=new Date().toISOString();await db.insert(whatsappMessages).values({id:randomUUID(),companyId,eventId:randomUUID(),phone,direction:'out',body:message.slice(0,2000),createdAt:now});await db.insert(whatsappConversations).values({companyId,phone,step:'',context:{},updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{updatedAt:now}});}
async function simulatedPixCharge(companyId:string,bookingId:string){const row=(await db.select({booking:bookings,court:courts.name,arena:companies.name}).from(bookings).innerJoin(courts,eq(courts.id,bookings.courtId)).innerJoin(companies,eq(companies.id,bookings.companyId)).where(and(eq(bookings.id,bookingId),eq(bookings.companyId,companyId))).limit(1))[0];if(!row)throw new Error('Reserva não encontrada.');const b=row.booking,now=new Date();return {paymentId:'simulado',qrCode:`PIX-SIMULADO-${bookingId.slice(0,8)} (código de teste, não pague)`,qrBase64:'',ticketUrl:'',amountCents:await linkChargeCents(companyId,b.amountCents),totalAmountCents:b.amountCents,date:b.startAt.slice(0,10),startTime:b.startAt.slice(11,16),endTime:b.endAt.slice(11,16),courtName:row.court,arenaName:row.arena,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+PIX_MINUTES*60000).toISOString()};}
async function sendBookingPix(companyId:string,session:string,phone:string,bookingId:string,payerEmail:string){
 const payment=isSimulating()?await simulatedPixCharge(companyId,bookingId):await createBookingPixCharge(companyId,bookingId,payerEmail);
 const existing=await db.select({body:whatsappMessages.body}).from(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,phone),eq(whatsappMessages.direction,'out'))).orderBy(desc(whatsappMessages.createdAt)).limit(30);
 if(existing.some(item=>item.body.includes(payment.qrCode)))return 'ja_enviado';
 const balance=Math.max(0,(payment.totalAmountCents||payment.amountCents)-payment.amountCents);const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
 const bot=await botConfig(companyId),until=payment.expiresAt?new Intl.DateTimeFormat('pt-BR',{timeZone:bot.timeZone||'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(payment.expiresAt)):'';
 await sendText(companyId,session,phone,`Pedido registrado e aguardando pagamento.\n\n🏟️ ${payment.courtName}\n📅 ${payment.date.split('-').reverse().join('/')} · ${payment.startTime} às ${payment.endTime}\n💰 Valor total: ${money(payment.totalAmountCents||payment.amountCents)}\n💳 Pix agora: ${money(payment.amountCents)}${balance>0?`\n🏟️ Saldo a pagar na arena: ${money(balance)}`:''}\n\nVou enviar o QR Code e, em seguida, o código Pix para copiar.`);
 let imageSent=false;
 if(isSimulating()){simulationNote('note',`QR Code do Pix de ${money(payment.amountCents)} (simulado: nada foi gerado no Mercado Pago).`);imageSent=true;}
 else try{
  const base=process.env.WAHA_BASE_URL||'',key=process.env.WAHA_API_KEY||'';
  const jpeg=(await sharp(Buffer.from(payment.qrBase64,'base64')).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer()).toString('base64');
  const image=await fetch(`${base.replace(/\/$/,'')}/api/sendImage`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({session,chatId:`${phone}@c.us`,file:{mimetype:'image/jpeg',filename:'pix-reserva.jpg',data:jpeg},caption:`Pix da reserva na ${payment.arenaName}: ${payment.courtName}, ${payment.date.split('-').reverse().join('/')} das ${payment.startTime} às ${payment.endTime}. Valor do Pix: ${money(payment.amountCents)}.`}),signal:AbortSignal.timeout(10000)});
  imageSent=image.ok;
 }catch(error){console.error('whatsapp_pix_image_failed',error instanceof Error?error.message:'unknown');}
 if(!imageSent)await sendText(companyId,session,phone,'A imagem do QR Code não foi enviada. Você pode pagar usando o Pix Copia e Cola abaixo.');
 await sendText(companyId,session,phone,payment.qrCode);
 if(until)await sendText(companyId,session,phone,`⏳ Este Pix vale por ${PIX_MINUTES} minutos. Seu horário fica guardado até as ${until}. Se o pagamento não for confirmado até lá, a reserva é cancelada e o horário volta a ficar disponível para outras pessoas.`);
 return imageSent?'codigo_e_qr_enviados':'codigo_enviado_sem_imagem';
}
async function template(companyId:string,category:string,fallback:string,vars:Record<string,string>={}){const row=(await db.select().from(messageTemplates).where(and(eq(messageTemplates.companyId,companyId),eq(messageTemplates.category,category),eq(messageTemplates.active,true))).orderBy(desc(messageTemplates.createdAt)).limit(1))[0];return String(row?.body||fallback).replace(/\{([a-z_]+)\}/gi,(match,key:string)=>Object.hasOwn(vars,key)?vars[key]!:match);}
function timeHH(m:number){return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
function parseClockRange(input:string){const value=input.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');const match=value.match(/\b(?:das?\s*)?(\d{1,2})(?:[:h](\d{2})|h)?\s*(?:as|a|-)\s*(\d{1,2})(?:[:h](\d{2})|h)?\b/);if(!match)return undefined;const startHour=Number(match[1]),startMinute=Number(match[2]||0),endHour=Number(match[3]),endMinute=Number(match[4]||0);if(startHour>23||endHour>23||startMinute>59||endMinute>59)return undefined;const start=timeHH(startHour*60+startMinute),duration=endHour*60+endMinute-(startHour*60+startMinute);return duration>0?{start,duration}:undefined;}
function parseDurationMinutes(input:string){const value=input.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();if(/^(1|1h|60|60min|1 hora|uma hora)$/.test(value))return 60;if(/^(1h30|1:30|90|90min|1 hora e meia|uma hora e meia|1 hora e 30 minutos?)$/.test(value))return 90;if(/^(2|2h|120|120min|2 horas|duas horas)$/.test(value))return 120;return undefined;}
type AvailabilitySlot={inicio:string;valor:string;amountCents:number};
type AvailabilityResult={open:boolean;quadra?:string;slots:AvailabilitySlot[]};
const affirmative=(value:string)=>/^(1|1️⃣|sim|s|sim pode reservar|sim, pode reservar|sim pode confirmar|sim, pode confirmar|confirmo|confirmar|pode|pode reservar|pode confirmar|isso|ok|okay|fechado|pode marcar|quero|confirmado)[.,!\s🙏👍]*$/i.test(value.replace(/\[Transcrição do áudio\]\s*/gi,'').trim());
const OPENAI_API=(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
const aiConfigured=()=>Boolean(process.env.OPENAI_API_KEY);
async function transcribeWhatsAppAudio(media:Record<string,unknown>):Promise<string>{
 const mime=String(media.mimetype||'').split(';')[0]!.trim().toLowerCase();if(!/^audio\/(ogg|opus|mpeg|mp3|mp4|m4a|wav|webm|flac)$/.test(mime))throw new Error('unsupported_audio_format');
 const mediaUrl=String(media.url||'');if(!mediaUrl)throw new Error('audio_media_unavailable');if(!process.env.OPENAI_API_KEY)throw new Error('transcription_not_configured');
 let path='';try{path=new URL(mediaUrl).pathname;}catch{throw new Error('invalid_audio_url');}if(!path.startsWith('/api/files/'))throw new Error('invalid_audio_url');
 const base=(process.env.WAHA_BASE_URL||'').replace(/\/$/,'');if(!base)throw new Error('waha_not_configured');
 const response=await fetch(`${base}${path}`,{headers:{'X-Api-Key':process.env.WAHA_API_KEY||''},signal:AbortSignal.timeout(12000)});if(!response.ok||!response.body)throw new Error('audio_download_failed');
 const maxBytes=20*1024*1024,length=Number(response.headers.get('content-length')||0);if(length>maxBytes)throw new Error('audio_too_large');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('audio_too_large');}chunks.push(value);}if(!size)throw new Error('empty_audio');
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const extensions:Record<string,string>={'audio/ogg':'ogg','audio/opus':'ogg','audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'mp4','audio/m4a':'m4a','audio/wav':'wav','audio/webm':'webm','audio/flac':'flac'},form=new FormData();form.append('model',process.env.WHATSAPP_TRANSCRIPTION_MODEL||'gpt-transcribe');form.append('response_format','json');form.append('prompt','Transcreva fielmente em português brasileiro. Contexto: reserva de quadra, arena, Society, Beach Tennis, horário e Pix.');form.append('file',new Blob([bytes],{type:mime}),`whatsapp-audio.${extensions[mime]||'ogg'}`);
 const result=await fetch(`${OPENAI_API}/audio/transcriptions`,{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(45000)});if(!result.ok)throw new Error(`transcription_http_${result.status}`);const data=await result.json() as {text?:unknown};const text=String(data.text||'').trim().slice(0,1000);if(!text)throw new Error('empty_transcription');return text;
}
function validDate(day:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const d=new Date(`${day}T12:00:00Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===day;}
async function resolveCourt(companyId:string,name:string){const normalized=name.trim().toLocaleLowerCase('pt-BR');if(!normalized)return undefined;const list=await db.select().from(courts).where(and(eq(courts.companyId,companyId),eq(courts.active,true))).orderBy(asc(courts.name));return list.find(c=>c.id===name)||list.find(c=>c.name.toLocaleLowerCase('pt-BR')===normalized)||list.find(c=>c.name.toLocaleLowerCase('pt-BR').includes(normalized));}
/** Duração máxima por reserva configurada pela arena (Configurações → Horários). */
async function arenaMaxDuration(companyId:string){const row=(await db.select({publicOptions:companies.publicOptions}).from(companies).where(eq(companies.id,companyId)).limit(1))[0];return maxDurationOf(row?.publicOptions);}
/** A reserva pedida fere uma regra da quadra (horas cheias, horário nobre)? Devolve a explicação para o cliente. */
async function courtRuleIssue(courtId:string,day:string,start:string,minutes:number){
 const court=(await db.select({name:courts.name,rules:courts.bookingRules}).from(courts).where(eq(courts.id,courtId)).limit(1))[0];if(!court)return null;
 const s=Number(start.slice(0,2))*60+Number(start.slice(3)),problem=ruleProblem(parseCourtRules(court.rules),new Date(`${day}T12:00:00Z`).getUTCDay(),s,s+minutes);
 return problem?{problem,text:ruleProblemText(problem,court.name)}:null;
}
/** Inícios livres de uma quadra no dia. `exclude`: reserva que está sendo remarcada (não conta como ocupada). */
async function availability(companyId:string,courtId:string,day:string,duration:number,exclude=''):Promise<AvailabilityResult>{
 if(!validDate(day))throw new Error('Use uma data válida no formato AAAA-MM-DD.');
 const today=localNow((await botConfig(companyId)).timeZone),last=new Date(`${today.date}T12:00:00Z`);last.setUTCDate(last.getUTCDate()+90);if(day<today.date||day>last.toISOString().slice(0,10))throw new Error('A data deve estar entre hoje e os próximos 90 dias.');
 const maxDuration=await arenaMaxDuration(companyId);if(!validDuration(duration,maxDuration))throw new Error(durationError(maxDuration));
 const hour=(await db.select().from(companyHours).where(and(eq(companyHours.companyId,companyId),eq(companyHours.weekday,new Date(`${day}T12:00:00Z`).getUTCDay()))).limit(1))[0];if(!hour?.isOpen)return {open:false,slots:[]};
 const opening=Number(hour.openTime.slice(0,2))*60+Number(hour.openTime.slice(3)),closing=Number(hour.closeTime.slice(0,2))*60+Number(hour.closeTime.slice(3)),[nh,nm]=today.time.split(':').map(Number),minimum=day===today.date?Math.max(opening,Math.ceil((nh!*60+nm!)/30)*30):opening;
 const weekday=new Date(`${day}T12:00:00Z`).getUTCDay(),[busy,blocks,members,tariffs,court]=await Promise.all([db.select().from(bookings).where(and(eq(bookings.companyId,companyId),eq(bookings.courtId,courtId),ne(bookings.status,'cancelled'),exclude?ne(bookings.id,exclude):undefined,gte(bookings.startAt,`${day}T00:00:00.000Z`),lt(bookings.startAt,`${day}T24:00:00.000Z`))),db.select().from(blockedSlots).where(and(eq(blockedSlots.companyId,companyId),eq(blockedSlots.courtId,courtId),gte(blockedSlots.startAt,`${day}T00:00:00.000Z`),lt(blockedSlots.startAt,`${day}T24:00:00.000Z`))),db.select().from(monthlyMembers).where(and(eq(monthlyMembers.companyId,companyId),eq(monthlyMembers.courtId,courtId),eq(monthlyMembers.weekday,weekday),eq(monthlyMembers.status,'active'))),db.select({weekday:companyPriceSlots.weekday,startTime:companyPriceSlots.startTime,endTime:companyPriceSlots.endTime,priceCents:companyPriceSlots.priceCents}).from(companyPriceSlots).where(eq(companyPriceSlots.companyId,companyId)),db.select().from(courts).where(and(eq(courts.companyId,companyId),eq(courts.id,courtId),eq(courts.active,true))).limit(1)]);
 if(!court[0])throw new Error('Não encontrei essa quadra ativa.');const rules=parseCourtRules(court[0].bookingRules),slots:AvailabilitySlot[]=[];/* regras da quadra: só horas cheias e horário nobre */for(let minute=Math.ceil(minimum/rules.step)*rules.step;minute+duration<=closing;minute+=rules.step){if(ruleProblem(rules,weekday,minute,minute+duration))continue;const start=`${day}T${timeHH(minute)}:00.000Z`,end=`${day}T${timeHH(minute+duration)}:00.000Z`;const recurring=members.some(member=>{const from=Number(member.startTime.slice(0,2))*60+Number(member.startTime.slice(3));return from<minute+duration&&from+member.durationMinutes>minute;});if(!recurring&&![...busy,...blocks].some(x=>x.startAt<end&&x.endAt>start)){const cents=bookingAmountCents(start,end,court[0].priceCents,tariffs),value=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);slots.push({inicio:timeHH(minute),valor:value,amountCents:cents});}}
 return {open:true,quadra:court[0].name,slots};
}
function previewSlots(slots:AvailabilitySlot[],period:string){
 const groups={manha:slots.filter(x=>x.inicio<'12:00'),tarde:slots.filter(x=>x.inicio>='12:00'&&x.inicio<'18:00'),noite:slots.filter(x=>x.inicio>='18:00')};
 const counts={manha:groups.manha.length,tarde:groups.tarde.length,noite:groups.noite.length};
 const selected=period==='manha'||period==='tarde'||period==='noite'?groups[period]:slots;
 return {slots:selected,counts,total:selected.length};
}
async function availableTimesReply(companyId:string,courtId:string,day:string,duration=60,period='todos'){
 const free=await availability(companyId,courtId,day,duration),preview=previewSlots(free.slots,period);
 if(!free.open)return `A arena está fechada em ${displayDate(day)}. Qual outro dia você prefere?`;
 if(!preview.total)return `Não encontrei horários livres de ${durationLabel(duration)} em ${displayDate(day)}. Prefere outro dia ou outra duração?`;
 const scope=period==='manha'?'da manhã':period==='tarde'?'da tarde':period==='noite'?'da noite':'do dia';
 return `Para ${free.quadra} em ${displayDate(day)}, estes são todos os horários disponíveis ${scope} para ${durationLabel(duration)}:\n\n${preview.slots.map(slot=>`🕒 ${slot.inicio}`).join('\n')}\n\nQual horário você prefere?`;
}
async function createConfirmedBooking(companyId:string,phone:string,pending:PendingBooking){
 if(Date.now()-Date.parse(pending.createdAt)>15*60*1000)throw new Error('A confirmação expirou. Consulte os horários novamente.');
 const latest=await availability(companyId,pending.courtId,pending.date,pending.durationMinutes),slot=latest.slots.find(x=>x.inicio===pending.startTime);
 if(!slot)throw new Error('Esse horário deixou de estar disponível. Consulte outros horários.');
 if(slot.amountCents!==pending.amountCents)throw new Error('O valor mudou. Consulte novamente e peça uma nova confirmação.');
 const startAt=`${pending.date}T${pending.startTime}:00.000Z`,startMinute=Number(pending.startTime.slice(0,2))*60+Number(pending.startTime.slice(3)),endAt=`${pending.date}T${timeHH(startMinute+pending.durationMinutes)}:00.000Z`,now=new Date().toISOString();
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}),hashtext(${pending.courtId}))`);
  const court=(await tx.select().from(courts).where(and(eq(courts.id,pending.courtId),eq(courts.companyId,companyId),eq(courts.active,true))).limit(1))[0];if(!court)throw new Error('A quadra não está disponível.');
  const weekday=new Date(`${pending.date}T12:00:00Z`).getUTCDay(),[conflicts,blocks,members]=await Promise.all([tx.select({id:bookings.id}).from(bookings).where(and(eq(bookings.companyId,companyId),eq(bookings.courtId,pending.courtId),ne(bookings.status,'cancelled'),sql`${bookings.startAt}<${endAt}`,sql`${bookings.endAt}>${startAt}`)).limit(1),tx.select({id:blockedSlots.id}).from(blockedSlots).where(and(eq(blockedSlots.companyId,companyId),eq(blockedSlots.courtId,pending.courtId),sql`${blockedSlots.startAt}<${endAt}`,sql`${blockedSlots.endAt}>${startAt}`)).limit(1),tx.select().from(monthlyMembers).where(and(eq(monthlyMembers.companyId,companyId),eq(monthlyMembers.courtId,pending.courtId),eq(monthlyMembers.weekday,weekday),eq(monthlyMembers.status,'active')))]);
  const recurring=members.some(member=>{const memberStart=Number(member.startTime.slice(0,2))*60+Number(member.startTime.slice(3));return memberStart<startMinute+pending.durationMinutes&&memberStart+member.durationMinutes>startMinute;});
  if(conflicts.length||blocks.length||recurring)throw new Error('Esse horário acabou de ficar indisponível. Consulte outros horários.');
  const hours=(await tx.select().from(companyHours).where(and(eq(companyHours.companyId,companyId),eq(companyHours.weekday,new Date(`${pending.date}T12:00:00Z`).getUTCDay()))).limit(1))[0],from=startMinute,to=from+pending.durationMinutes;
  if(!hours?.isOpen||from<Number(hours.openTime.slice(0,2))*60+Number(hours.openTime.slice(3))||to>Number(hours.closeTime.slice(0,2))*60+Number(hours.closeTime.slice(3)))throw new Error('O horário de funcionamento da arena mudou. Consulte novamente.');
  const customerName=isSimulating()?`[Teste] ${pending.customerName}`.slice(0,100):pending.customerName;const old=(await tx.select().from(clients).where(and(eq(clients.companyId,companyId),eq(clients.phone,phone))).limit(1))[0],clientId=old?.id||randomUUID();if(old)await tx.update(clients).set({name:pending.customerName}).where(eq(clients.id,clientId));else await tx.insert(clients).values({id:clientId,companyId,name:pending.customerName,phone,createdAt:now});
  const tariffs=await tx.select({weekday:companyPriceSlots.weekday,startTime:companyPriceSlots.startTime,endTime:companyPriceSlots.endTime,priceCents:companyPriceSlots.priceCents}).from(companyPriceSlots).where(eq(companyPriceSlots.companyId,companyId)),id=randomUUID(),amountCents=bookingAmountCents(startAt,endAt,court.priceCents,tariffs);
  if(amountCents!==pending.amountCents)throw new Error('O valor mudou. Consulte novamente e peça uma nova confirmação.');
  await tx.insert(bookings).values({id,companyId,courtId:pending.courtId,clientId,customerName,customerPhone:phone,startAt,endAt,amountCents,status:'pending',source:'whatsapp',cancelReason:'',createdAt:now,updatedAt:now});
  await tx.insert(bookingEvents).values({id:randomUUID(),companyId,bookingId:id,userId:null,event:'whatsapp_request',details:{},createdAt:now});return {id,amountCents,courtName:court.name};
 });
}
async function saveConversationState(companyId:string,phone:string,step:string,context:Record<string,unknown>){const now=new Date().toISOString();await db.insert(whatsappConversations).values({companyId,phone,step,context,updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{step,context,updatedAt:now}});}
const agentDeps:AgentDeps={botConfig,mercadoPagoConnected,availability,previewSlots,availableTimesReply,resolveCourt,createConfirmedBooking,sendBookingPix,timeHH};
async function callOpenAi(companyId:string,session:string,phone:string,context:Record<string,unknown>,message:string,canConfirm:boolean,receivedAt:Date){
 return runWhatsAppAgent(agentDeps,{companyId,session,phone,context,message,canConfirm,receivedAt});
}
/** Última atividade da conversa antes desta mensagem (o webhook já atualizou a conversa ao receber). */
async function previousActivity(companyId:string,phone:string,receivedAt:Date,fallback:string){const row=(await db.select({at:sql<string|null>`max(${whatsappMessages.createdAt})`}).from(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,phone),lt(whatsappMessages.createdAt,receivedAt.toISOString()))))[0];return row?.at||fallback;}
async function isBotPaused(companyId:string,phone:string,conversation:{step:string;updatedAt:string}|undefined,bot:BotConfig,receivedAt:Date){if(conversation?.step!=='human')return false;return botPaused({step:'human',updatedAt:await previousActivity(companyId,phone,receivedAt,conversation.updatedAt)},await resumePolicy(companyId,bot),receivedAt.getTime());}
async function handleIncoming(company:{id:string;name:string},session:string,payload:Record<string,unknown>){const phone=digits(String(payload.from||'').split('@')[0]),message=String(payload.body||'').trim().slice(0,1000),key=message.toLocaleLowerCase('pt-BR');if(!isPrivateIncomingPayload(payload)||phone.length<10||!message)return;const bot=await botConfig(company.id),paymentRequired=bot.paymentMode!=='none'&&await mercadoPagoConnected(company.id),receivedAt=new Date(String(payload.receivedAt||new Date().toISOString()));if(!bot.enabled)return;const conversation=(await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,company.id),eq(whatsappConversations.phone,phone))).limit(1))[0],context=(conversation?.context||{}) as Record<string,unknown>,step=conversation?.step||'';

 context.serviceRequestId=String(payload.id||randomUUID());
 // Marcas de "acabei de enviar o menu / os valores": valem só para a próxima mensagem.
 const menuShown=Boolean(context.menu),priceAsked=Boolean(context.priceAsked),menuChoice=menuShown&&/^\s*[12]\uFE0F?\u20E3?\s*$/.test(message)?message.replace(/\D/g,''):'';delete context.menu;delete context.priceAsked;
 // Conversa parada há mais de 6 horas recomeça a reserva do zero (não arrasta data/quadra de outro dia).
 if(conversation&&receivedAt.getTime()-Date.parse(await previousActivity(company.id,phone,receivedAt,conversation.updatedAt))>6*3600000)for(const k of ['confirmedDate','search','courtOptions','selectedCourtId','selectedCourtName','pendingBooking','awaitingEmail','awaitingTimeChoice','awaitingCourtChoice','intervalStage','intervalReservation','pendingDate','confirmedInterval'])delete context[k];
 if(await isBotPaused(company.id,phone,conversation,bot,receivedAt)){
  await db.update(whatsappConversations).set({updatedAt:new Date().toISOString()}).where(and(eq(whatsappConversations.companyId,company.id),eq(whatsappConversations.phone,phone)));return;
 }
 if(wantsHuman(message)||menuChoice==='2'){
  // Fora do horário humano o bot não pausa: deixa o recado para a equipe e segue atendendo reservas.
  const outside=isOutsideHumanHours(bot,receivedAt);
  await handoff(company.id,phone,'Cliente solicitou atendimento humano',message,{pause:!outside});
  await sendText(company.id,session,phone,outside?outsideHoursText(bot):bot.handoffMessage);return;
 }
 // Cancelamento: feito pelo sistema (sempre permitido). Confirmação → cancela; lista de reservas → escolha; pedido → lista ou resumo.
 const cancellation=context.pendingCancellation as {id:string;createdAt:string}|undefined,cancelPick=context.cancelPick as {at:string;options:BookingOption[]}|undefined;
 const sayCancel=async(text:string)=>{await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,text);};
 const startCancellation=async(id:string)=>{const prepared=await prepareCancellation(company.id,phone,id);delete context.cancelPick;delete context.pendingBooking;delete context.chosen;context.pendingCancellation={id:prepared.id,createdAt:prepared.createdAt};await sayCancel(prepared.resumo);};
 if(cancellation&&(confirmsCancellation(message)||affirmative(message))){
  delete context.pendingCancellation;delete context.cancellationFlow;delete context.cancellationOptions;
  if(Date.now()-Date.parse(cancellation.createdAt)>10*60000){await sayCancel('A confirmação expirou. Se ainda quiser cancelar, é só me pedir de novo. 🙂');return;}
  try{const done=await cancelOwnBooking(company.id,phone,cancellation.id);/* o recado do handoff fica no contexto que será salvo agora */if(done.teamNotified)context.awaitingTeam={at:new Date().toISOString(),reason:'Devolução de cancelamento'};await sayCancel(done.already?`Essa reserva já estava cancelada. 🙂`:`Pronto! Sua reserva da ${done.label} foi cancelada e o horário ficou livre.${done.money?`\n\n${done.money}`:''}\n\nSe quiser marcar outro horário, é só me chamar. 🙂`);}
  catch(error){console.error('whatsapp_cancel_failed',error instanceof Error?error.message:'unknown');await handoff(company.id,phone,'Cancelamento não concluído',message,{pause:false});context.awaitingTeam={at:new Date().toISOString(),reason:'Cancelamento não concluído'};await sayCancel('Não consegui concluir o cancelamento agora. Deixei um recado para a equipe resolver. 🙏');}
  return;
 }
 if(cancellation){delete context.pendingCancellation;delete context.cancellationFlow;delete context.cancellationOptions;if(/^(n[ãa]o|nao|desisti|deixa|esquece)\b/i.test(message.trim())){await sayCancel('Tudo bem, sua reserva foi mantida. 🙂');return;}await saveConversationState(company.id,phone,'',context);}
 if(cancelPick&&Date.now()-Date.parse(cancelPick.at)<10*60000){
  const id=pickBooking(message,cancelPick.options,localNow(bot.timeZone||'America/Belem',receivedAt).date);
  if(id){try{await startCancellation(id);}catch{delete context.cancelPick;await sayCancel('Essa reserva não está mais disponível para cancelar. Quer que eu mostre as suas reservas de novo?');}return;}
 }else if(cancelPick)delete context.cancelPick;
 // Remarcação: feita pelo sistema. Escolhe a reserva, confere a regra da arena (desligada, prazo, Pix em aberto),
 // pede o novo dia/horário (mesma quadra e duração, a não ser que o cliente diga outras), confere a agenda e confirma.
 type Reschedule={at:string;step:'pick'|'when'|'confirm';options?:BookingOption[]|undefined;bookingId?:string|undefined;courtId?:string|undefined;courtName?:string|undefined;minutes?:number|undefined;from?:string|undefined;day?:string|undefined;start?:string|undefined;to?:{courtId:string;courtName:string;startAt:string;endAt:string;amountCents:number;paidCents:number}};
 const rs=context.reschedule as Reschedule|undefined,rsFresh=Boolean(rs&&Date.now()-Date.parse(rs.at)<15*60000);
 if(rs&&!rsFresh)delete context.reschedule;
 const sayRs=async(text:string)=>{if(context.reschedule)(context.reschedule as Reschedule).at=new Date().toISOString();await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,text);};
 const blockedText=(reason:'off'|'prazo'|'pix',hours:number)=>reason==='off'?'Por aqui não dá para remarcar reservas. 🙂 Se quiser, eu cancelo esta e você marca outro horário, ou chamo a equipe para te ajudar.':reason==='pix'?'Essa reserva ainda está aguardando o pagamento do Pix. Depois de pagar, você pode remarcar por aqui; se preferir, eu cancelo. 🙂':`A remarcação pelo WhatsApp só é possível até ${hours} ${hours===1?'hora':'horas'} antes do jogo. Se quiser, posso cancelar a reserva ou chamar a equipe. 🙂`;
 /** Entende dia, horário, duração e quadra ditos pelo cliente e responde (horários livres, pergunta ou resumo). null = a mensagem não falou de quando. */
 const rescheduleWhen=async(state:Reschedule,text:string):Promise<string|null>=>{
  const asked=parseTimeDuration(text),bare=parseBareTime(text),start=asked.start??bare,saysDay=saysDate(text);
  const list=await activeCourts(company.id),courtHit=list.length>1?matchCourt(text,list,false):null;
  if(!saysDay&&!start&&!asked.duration&&!courtHit)return null;
  let day=state.day;
  if(saysDay){const parsed=parseArenaDate(text,bot.timeZone,receivedAt);if(!parsed.date)return parsed.question||'Qual dia você prefere? 📅';day=parsed.date;}
  const courtId=courtHit??state.courtId!,courtName=list.find(c=>c.id===courtId)?.name||state.courtName||'',maxDuration=await arenaMaxDuration(company.id),minutes=asked.duration??state.minutes!;
  if(!validDuration(minutes,maxDuration))return `${durationError(maxDuration)} Qual duração você prefere?`;
  Object.assign(state,{courtId,courtName,minutes,...(day?{day}:{})});
  if(!day){state.start=start??undefined;return 'Para qual dia você quer mudar? 📅';}
  const chosen=start??state.start;
  const free=await availability(company.id,courtId,day,minutes,state.bookingId);
  const times=free.slots.map(x=>x.inicio),when=`${displayDate(day)}`;
  if(!free.open)return `A arena está fechada em ${when}. Qual outro dia você prefere? 📅`;
  if(!chosen){state.step='when';return times.length?`📅 ${when} — horários livres na ${courtName} (${durationLabel(minutes)}):\n\n🕒 ${times.join(' · ')}\n\nQual horário você prefere?`:`Em ${when} não tem horário livre na ${courtName} para ${durationLabel(minutes)}. Quer tentar outro dia? 📅`;}
  const rsIssue=await courtRuleIssue(courtId,day,chosen,minutes);
  if(rsIssue){state.step='when';state.start=undefined;return `${rsIssue.text}\n\n${times.length?`🕒 ${times.join(' · ')}\n\nQual deles você prefere?`:'Quer tentar outro dia ou outra duração? 📅'}`;}
  const slot=free.slots.find(x=>x.inicio===chosen);
  if(!slot){state.step='when';state.start=undefined;return times.length?`${timeUnavailableText(chosen,day===localNow(bot.timeZone,receivedAt).date&&chosen<=localNow(bot.timeZone,receivedAt).time?'passou':'ocupado')}\n\n🕒 ${times.join(' · ')}\n\nQual deles você prefere?`:`Em ${when} não tem horário livre na ${courtName} para ${durationLabel(minutes)}. Quer tentar outro dia? 📅`;}
  const startMin=Number(chosen.slice(0,2))*60+Number(chosen.slice(3)),startAt=`${day}T${chosen}:00.000Z`,endAt=`${day}T${timeHH(startMin+minutes)}:00.000Z`;
  const original=(await db.select({courtId:bookings.courtId,startAt:bookings.startAt,endAt:bookings.endAt}).from(bookings).where(eq(bookings.id,state.bookingId!)).limit(1))[0];
  if(original&&original.courtId===courtId&&original.startAt===startAt&&original.endAt===endAt)return 'Esse já é o horário da sua reserva. 🙂 Para quando você quer mudar?';
  const paid=await paidForBooking(db,company.id,state.bookingId!);
  state.to={courtId,courtName,startAt,endAt,amountCents:slot.amountCents,paidCents:paid};state.step='confirm';
  return rescheduleSummary({from:state.from!,to:bookingLabel({quadra:courtName,inicio:startAt,fim:endAt}),amountCents:slot.amountCents,paidCents:paid});
 };
 const startReschedule=async(row:{id:string;quadra:string;inicio:string;fim:string;status:string},text:string)=>{
  const check=await rescheduleCheck(company.id,row);delete context.reschedule;
  if(!check.ok){await sayRs(blockedText(check.reason,check.policy.rescheduleHours));return;}
  const b=(await db.select({courtId:bookings.courtId}).from(bookings).where(eq(bookings.id,row.id)).limit(1))[0];
  const state:Reschedule={at:new Date().toISOString(),step:'when',bookingId:row.id,courtId:b?.courtId,courtName:row.quadra,minutes:(Date.parse(row.fim)-Date.parse(row.inicio))/60000,from:bookingLabel(row),day:row.inicio.slice(0,10)/* só o horário = mesmo dia da reserva */};
  context.reschedule=state;delete context.pendingBooking;delete context.chosen;delete context.cancelPick;delete context.pendingCancellation;
  const reply=await rescheduleWhen(state,text);
  await sayRs(reply??`Para quando você quer mudar a reserva da ${state.from}? Me diga o dia e o horário. 🙂`);
 };
 if(rs&&rsFresh){
  if(rs.step==='confirm'&&rs.to&&(confirmsSummary(message)||affirmative(message))){
   delete context.reschedule;
   try{const done=await rescheduleOwnBooking(company.id,phone,rs.bookingId!,{courtId:rs.to.courtId,startAt:rs.to.startAt,endAt:rs.to.endAt});if(done.excess>0)context.awaitingTeam={at:new Date().toISOString(),reason:'Estorno a devolver (remarcação)'};await sayRs(rescheduledText({to:done.label,amountCents:done.amountCents,paidCents:done.paid}));}
   catch(error){const why=error instanceof Error?error.message:'';await sayRs(`Não consegui remarcar: ${why||'o horário não está mais disponível'}. Quer escolher outro horário? 🙂`);}
   return;
  }
  if(/^(n[ãa]o|nao|desisti|deixa|esquece|cancela a remarca)/i.test(message.trim())&&rs.step!=='pick'){delete context.reschedule;await sayRs('Tudo bem, sua reserva continua como estava. 🙂');return;}
  if(rs.step==='pick'&&rs.options){
   const id=pickBooking(message,rs.options,localNow(bot.timeZone||'America/Belem',receivedAt).date),row=id?(await ownBookings(company.id,phone)).find(r=>r.id===id):undefined;
   if(row){await startReschedule(row,'');return;}
  }else if(rs.step!=='pick'){
   const reply=await rescheduleWhen(rs,message);
   if(reply){context.reschedule=rs;await sayRs(reply);return;}
  }
 }
 if(isRescheduleIntent(message)){
  if(!bot.timeZone){await handoff(company.id,phone,'Remarcação (arena sem fuso)',message,{pause:false});context.awaitingTeam={at:new Date().toISOString(),reason:'Remarcação'};await sayRs('Vou pedir para a equipe te ajudar com a remarcação. 🙏');return;}
  const list=await ownBookings(company.id,phone);
  if(!list.length){delete context.reschedule;await sayRs('Não encontrei reservas futuras feitas por este número para remarcar. Se ela foi feita por outro número, me diga que eu chamo a equipe. 🙂');return;}
  if(list.length===1){await startReschedule(list[0]!,message);return;}
  context.reschedule={at:new Date().toISOString(),step:'pick',options:list.map(r=>({id:r.id,court:r.quadra,start:r.inicio}))} satisfies Reschedule;
  await sayRs(`Você tem estas reservas:\n\n${list.map((r,n)=>`${n+1}. ${bookingLabel(r)}`).join('\n')}\n\nQual delas você quer remarcar? Envie o número.`);return;
 }
 if(isCancelIntent(message)){
  delete context.cancelPick;
  if(!bot.timeZone){await handoff(company.id,phone,'Cancelamento (arena sem fuso)',message,{pause:false});await sayCancel('Vou pedir para a equipe te ajudar com o cancelamento. 🙏');return;}
  const list=await ownBookings(company.id,phone);
  if(!list.length){await sayCancel('Não encontrei reservas futuras feitas por este número. Se ela foi feita por outro número ou é de mensalista, me diga que eu chamo a equipe. 🙂');return;}
  if(list.length===1){await startCancellation(list[0]!.id);return;}
  context.cancelPick={at:new Date().toISOString(),options:list.map(r=>({id:r.id,court:r.quadra,start:r.inicio}))};
  await sayCancel(`Você tem estas reservas:\n\n${list.map((r,n)=>`${n+1}. ${bookingLabel(r)}`).join('\n')}\n\nQual delas você quer cancelar? Envie o número.`);return;
 }
 if(key==='menu'){await saveConversationState(company.id,phone,'',{menu:true});await sendText(company.id,session,phone,`Como posso ajudar?\n1️⃣ Reservar uma quadra\n2️⃣ Falar com a equipe`);return;}
 // Fotos: o sistema pergunta a quadra, guarda o pedido por 15 minutos e envia (a IA não participa). Respostas curtas ("areia 1", "das 3", "todas") valem.
 const photoAsk=context.photoAsk as {at:string}|undefined,photoFresh=Boolean(photoAsk&&Date.now()-Date.parse(photoAsk.at)<15*60000),wantsPhotos=isPhotoRequest(message);
 if(!photoFresh)delete context.photoAsk;delete context.photoRequested;
 if((wantsPhotos||photoFresh)&&!context.pendingBooking&&!context.cancellationFlow){
  const list=await activeCourts(company.id),one=list.length>1?matchCourt(message,list,false):null,picks=list.length===1||isAllCourts(message,list.length)?list:one?list.filter(c=>c.id===one):[];
  if(list.length&&picks.length){
   delete context.photoAsk;const text=await sendCourtPhotos(company.id,phone,picks,String(context.serviceRequestId||randomUUID()),message,context);
   if(text.includes('Quer agendar'))context.priceAsked=true;await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,text);return;
  }
  if(list.length&&wantsPhotos){context.photoAsk={at:new Date().toISOString()};await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,photoQuestion(list.map(c=>c.name)));return;}
 }
 if(context.cancellationFlow||/instagram|localiza|endere[çc]o|onde (?:fica|voc)|avalia[çc]/i.test(message)){
  if(!aiConfigured()){await handoff(company.id,phone,'Solicitação precisa da equipe',message);await sendText(company.id,session,phone,bot.handoffMessage);return;}
  try{const answer=await callOpenAi(company.id,session,phone,context,message,false,receivedAt);if(!context.handoff)await saveConversationState(company.id,phone,'',context);if(answer)await sendText(company.id,session,phone,answer);}
  catch{await handoff(company.id,phone,'Falha no atendimento',message);await sendText(company.id,session,phone,bot.handoffMessage);}return;
 }
 if(!bot.timeZone){await handoff(company.id,phone,'Arena sem fuso configurado',message);await sendText(company.id,session,phone,'Vou chamar a equipe para ajudar com a sua reserva.');return;}
 const pending=context.pendingBooking as PendingBooking|undefined,fresh=Boolean(pending&&Date.now()-Date.parse(pending.createdAt)<15*60*1000);
 if(pending&&!fresh)delete context.pendingBooking;
 // 0) conversa de entrada: boas-vindas, pergunta do dia e valores são texto do sistema (a IA não reescreve).
 if(aiConfigured()&&!pending){
  const fixed=await (async():Promise<string|undefined>=>{
   if(isGreeting(message)&&!context.confirmedDate){context.menu=true;return welcomeMenu(company.name,bot.welcome);}
   // Dia já escolhido e o cliente pede para ver os horários (ou só "e à noite?"): horários por quadra primeiro.
   if(context.confirmedDate&&(isPeriodOnly(message)||(isTimesQuestion(message)&&!saysDate(message))))return dayScheduleReply(agentDeps,company.id,context,String(context.confirmedDate),parsePeriod(message));
   // Pedido de horários já com o dia ("quais disponíveis amanhã?", "tem vaga sábado?"): horários por quadra direto, sem depender da IA.
   if(isTimesQuestion(message)&&saysDate(message)){const parsed=parseArenaDate(message,bot.timeZone,receivedAt);if(parsed.date)return dayScheduleReply(agentDeps,company.id,context,parsed.date,parsePeriod(message));if(parsed.question)return parsed.question;}
   if(menuChoice==='1'&&!context.confirmedDate)return DATE_QUESTION;
   if(isReserveIntent(message)&&!context.confirmedDate)return DATE_QUESTION;
   if(isPriceQuestion(message)){context.priceAsked=true;return priceReply(company.id,context.confirmedDate?String(context.confirmedDate):undefined);}
   if(priceAsked&&affirmative(message)&&!context.confirmedDate)return DATE_QUESTION;
   return undefined;
  })();
  if(fixed){await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,fixed);return;}
 }
 // Passos críticos feitos pelo sistema, sem depender da IA lembrar da ferramenta:
 // 1) "sim" claro ao resumo confirma a reserva e envia o Pix na hora.
 if(aiConfigured()&&pending&&fresh&&confirmsSummary(message)){
  const done=await confirmPendingBooking(agentDeps,{companyId:company.id,session,phone,context});
  await saveConversationState(company.id,phone,'',context);
  const text=done.error?`Não consegui registrar: ${done.error}`:done.reply;if(text)await sendText(company.id,session,phone,text);return;
 }
 // 2) escolha da quadra pelo número da lista, quando já se sabe a duração: mostra os horários livres dela.
 const courtOptions=Array.isArray(context.courtOptions)?(context.courtOptions as unknown[]).map(String):[],search=context.search as {date?:string;start?:string|null;duration?:number|null}|undefined,pick=message.trim().match(/^(?:quadra\s*|op[cç][aã]o\s*)?(\d{1,2})$/i);
 //    Reconhece o número ou o nome ("pode ser a society 1") e segue sem repetir a lista de quadras.
 const proceedToBooking=async(court:{id:string;name:string},day:string,start:string,minutes:number):Promise<string>=>{
  delete context.timesShown;context.search={date:day,start,duration:minutes};context.selectedCourtId=court.id;context.selectedCourtName=court.name;
  const unavailable=async()=>{context.timesShown=true;context.search={date:day,start:null,duration:minutes};return `${timeUnavailableText(start,reasonFor(day,start))}\n\n${await availableTimesReply(company.id,court.id,day,minutes)}`;};
  const issue=await courtRuleIssue(court.id,day,start,minutes);
  if(issue?.problem.kind==='start'){context.timesShown=true;context.search={date:day,start:null,duration:minutes%60?60:minutes};return `${issue.text}\n\n${await availableTimesReply(company.id,court.id,day,minutes%60?60:minutes)}`;}
  if(issue){context.search={date:day,start,duration:null};return `${issue.text}\n\n${await askDuration(court,day,start)}`;}
  const free=await availability(company.id,court.id,day,minutes);if(!free.slots.some(x=>x.inicio===start))return unavailable();
  context.chosen={courtId:court.id,courtName:court.name,date:day,start,minutes};
  const saved=(await db.select({name:clients.name}).from(clients).where(and(eq(clients.companyId,company.id),eq(clients.phone,phone))).limit(1))[0]?.name||'';
  if(!saved)return NAME_QUESTION;
  const done=await prepareBookingSummary(agentDeps,{companyId:company.id,phone,context,bot,paymentRequired},{court,day,startTime:start,minutes,customerName:saved,customerEmail:''});
  return 'erro' in done?unavailable():done.reply;
 };
 const reply_=async(text:string)=>{await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,text);};
 const reasonFor=(day:string,start:string)=>{const now=localNow(bot.timeZone,receivedAt);return day===now.date&&start<=now.time?'passou' as const:'ocupado' as const;};
 /** Só o horário é conhecido: pergunta a duração (as que cabem naquela quadra) ou, se não cabe, mostra os horários livres dela. */
 const askDuration=async(court:{id:string;name:string},day:string,start:string):Promise<string>=>{
  // Regras da quadra (horas cheias, horário nobre) só tiram algumas durações; ocupação para na primeira que não cabe.
  const fits:number[]=[];for(const minutes of durationChoices(await arenaMaxDuration(company.id))){if(await courtRuleIssue(court.id,day,start,minutes))continue;const free=await availability(company.id,court.id,day,minutes);if(!free.slots.some(x=>x.inicio===start))break;fits.push(minutes);}
  if(fits.length){delete context.timesShown;context.search={date:day,start,duration:null};return askDurationText(court.name,start,fits);}
  // Nenhuma duração cabe: se é por regra da quadra (ex.: 19h30 numa quadra de horas cheias), diz a regra, não "ocupado".
  const startIssue=await courtRuleIssue(court.id,day,start,60);
  context.timesShown=true;context.search={date:day,start:null,duration:60};return `${startIssue?.problem.kind==='start'?startIssue.text:timeUnavailableText(start,reasonFor(day,start))}\n\n${await availableTimesReply(company.id,court.id,day,60)}`;
 };
 //    A quadra citada na própria frase ("pode ser areia 1 as 20 hrs") vale na hora, e o horário ou a duração ditos agora mandam sobre o que estava guardado.
 //    Com uma quadra já escolhida, um horário ou duração novos continuam nela. Número solto só vale como quadra depois de uma lista numerada.
 const askNow=parseTimeDuration(message);
 // Dia dito na mesma frase da quadra ("a society 1 amanhã às 19h"): vale esse dia (e começa uma busca nova).
 const datedCourt=aiConfigured()&&!context.pendingBooking&&saysDate(message)&&(askNow.start||askNow.duration)?parseArenaDate(message,bot.timeZone,receivedAt).date:undefined;
 const dayNow=String(datedCourt??search?.date??context.confirmedDate??'');
 const allCourts=aiConfigured()&&!context.pendingBooking&&dayNow&&(!saysDate(message)||datedCourt)?await db.select({id:courts.id,name:courts.name}).from(courts).where(and(eq(courts.companyId,company.id),eq(courts.active,true))).orderBy(asc(courts.name)):[];
 const ordered=courtOptions.length?courtOptions.map(id=>allCourts.find(c=>c.id===id)).filter((c):c is {id:string;name:string}=>Boolean(c)):allCourts;
 const courtId=(allCourts.length?matchCourt(message,ordered,courtOptions.length>0):null)??(!datedCourt&&context.selectedCourtId&&(askNow.start||askNow.duration)?String(context.selectedCourtId):null),courtNow=courtId?allCourts.find(c=>c.id===courtId):undefined;
 if(courtNow&&dayNow){
  if(datedCourt&&datedCourt!==search?.date){delete context.search;delete context.courtOptions;delete context.timesShown;delete context.chosen;context.confirmedDate=datedCourt;}
  const maxDuration=await arenaMaxDuration(company.id),start=askNow.start??(datedCourt?null:search?.start??null),duration=askNow.duration??(datedCourt?null:search?.duration??null);
  context.selectedCourtId=courtNow.id;context.selectedCourtName=courtNow.name;
  if(duration&&!validDuration(duration,maxDuration)){await reply_(`${durationError(maxDuration)} Qual duração você prefere?`);return;}
  if(start&&duration){await reply_(await proceedToBooking(courtNow,dayNow,start,duration));return;}
  if(start){await reply_(await askDuration(courtNow,dayNow,start));return;}
  context.timesShown=true;context.search={date:dayNow,start:null,duration};
  await reply_(await availableTimesReply(company.id,courtNow.id,dayNow,duration??60));return;
 }
 //    Só faltava a duração: o cliente responde "1 hora" e o sistema segue para o nome ou o resumo.
 const answer=parseTimeDuration(message);
 if(aiConfigured()&&!context.pendingBooking&&context.selectedCourtId&&search?.date&&search.start&&!search.duration&&answer.duration){
  const maxDuration=await arenaMaxDuration(company.id),court={id:String(context.selectedCourtId),name:String(context.selectedCourtName||'')};
  await reply_(validDuration(answer.duration,maxDuration)?await proceedToBooking(court,search.date,search.start,answer.duration):`${durationError(maxDuration)} Qual duração você prefere?`);return;
 }
 //    Horário escolhido da lista ("20", "às 20h"): o sistema confere na agenda antes de responder.
 const timePick=parseBareTime(message);
 if(aiConfigured()&&!context.pendingBooking&&context.timesShown&&context.selectedCourtId&&search?.date&&!search.duration&&timePick){
  await reply_(await askDuration({id:String(context.selectedCourtId),name:String(context.selectedCourtName||'')},search.date,timePick));return;
 }
 if(aiConfigured()&&!context.pendingBooking&&context.timesShown&&context.selectedCourtId&&search?.date&&search.duration&&timePick){
  const court={id:String(context.selectedCourtId),name:String(context.selectedCourtName||'')},day=search.date,minutes=search.duration;
  const pickIssue=await courtRuleIssue(court.id,day,timePick,minutes);
  if(pickIssue){await reply_(`${pickIssue.text}\n\n${pickIssue.problem.kind==='start'?await availableTimesReply(company.id,court.id,day,minutes):await askDuration(court,day,timePick)}`);return;}
  const free=await availability(company.id,court.id,day,minutes);
  if(free.slots.some(x=>x.inicio===timePick)){await reply_(await proceedToBooking(court,day,timePick,minutes));return;}
  await reply_(`${timeUnavailableText(timePick,reasonFor(day,timePick))}\n\n${await availableTimesReply(company.id,court.id,day,minutes)}`);return;
 }
 //    Depois de "horários livres: 20:00 · 20:30", o cliente responde só com um deles ("20", "às 20h"): lista as quadras livres naquele horário.
 const suggested=Array.isArray(context.suggested)?(context.suggested as unknown[]).map(String):[],suggestedPick=parseBareTime(message);
 if(aiConfigured()&&!context.pendingBooking&&!context.selectedCourtId&&context.confirmedDate&&suggestedPick&&suggested.includes(suggestedPick)){
  const prev=context.search as {duration?:Duration|null}|undefined,found=await listFreeCourts(agentDeps,company.id,context,String(context.confirmedDate),suggestedPick,prev?.duration??null);
  await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,found.message);return;
 }
 // 3) com a data já escolhida e ainda sem quadra, horário e/ou duração na mensagem: lista as quadras livres.
 const asked=parseTimeDuration(message),mentionsDate=/\b(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|dia \d)|\d{1,2}\/\d{1,2}/i.test(message);
 if(aiConfigured()&&!context.pendingBooking&&!context.selectedCourtId&&context.confirmedDate&&(asked.start||asked.duration)&&!mentionsDate&&!pick){
  const prev=context.search as {start?:string|null;duration?:Duration|null}|undefined,found=await listFreeCourts(agentDeps,company.id,context,String(context.confirmedDate),asked.start??prev?.start??null,asked.duration??prev?.duration??null);
  await saveConversationState(company.id,phone,'',context);await sendText(company.id,session,phone,found.message);return;
 }
 const canConfirm=Boolean(pending&&fresh&&!/\b(n[ãa]o|cancel)/i.test(message));
 let reply:string;if(aiConfigured()){try{reply=await callOpenAi(company.id,session,phone,context,message,canConfirm,receivedAt);}catch(error){console.error('whatsapp_ai_unavailable',error instanceof Error?error.message:'unknown');await handoff(company.id,phone,'Instabilidade do atendimento automático',message);delete context.pendingBooking;await sendText(company.id,session,phone,'Tive uma instabilidade no atendimento automático. Sua mensagem ficou registrada e vou chamar alguém da equipe para continuar com você.');return;}}else{await handleIncomingScript(company,session,payload);return;}
 if(context.handoff===true){if(reply)await sendText(company.id,session,phone,reply);return;}await saveConversationState(company.id,phone,'',context);if(reply)await sendText(company.id,session,phone,reply);
}
async function handleIncomingScript(company:{id:string;name:string},session:string,payload:Record<string,unknown>){const phone=digits(String(payload.from||'').split('@')[0]),message=String(payload.body||'').trim().slice(0,1000),key=message.toLocaleLowerCase('pt-BR');if(phone.length<10||!message||String(payload.from||'').endsWith('@g.us'))return;let conversation=(await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,company.id),eq(whatsappConversations.phone,phone))).limit(1))[0],context=(conversation?.context||{}) as Record<string,unknown>,step=conversation?.step||'',reply='';
 const receivedAt=new Date(String(payload.receivedAt||new Date().toISOString())),bot=await botConfig(company.id),paymentRequired=bot.paymentMode!=='none'&&await mercadoPagoConnected(company.id);if(!bot.enabled)return;const volunteeredName=message.match(/^(?:meu nome é|me chamo|pode me chamar de)\s+([\p{L}][\p{L} '-]{1,80})[.!]*$/iu);if(volunteeredName&&step!=='name'){const name=(volunteeredName[1]||'').trim(),now=new Date().toISOString(),prior=(await db.select({id:clients.id}).from(clients).where(and(eq(clients.companyId,company.id),eq(clients.phone,phone))).limit(1))[0];if(prior)await db.update(clients).set({name}).where(eq(clients.id,prior.id));else await db.insert(clients).values({id:randomUUID(),companyId:company.id,name,phone,createdAt:now});reply=`Prazer, ${name}! Seu contato ficou salvo. Diga como posso ajudar com sua reserva.`;await db.insert(whatsappConversations).values({companyId:company.id,phone,step,context,updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{step,context,updatedAt:now}});await sendText(company.id,session,phone,reply);return;}
 if(await isBotPaused(company.id,phone,conversation,bot,receivedAt)){if(/^(menu|reservar)$/i.test(key)){step='';context={};}else{await db.update(whatsappConversations).set({updatedAt:new Date().toISOString()}).where(and(eq(whatsappConversations.companyId,company.id),eq(whatsappConversations.phone,phone)));return;}}
 const custom=!step||step==='menu'?bot.menuOptions.find((option,index)=>option.label.toLocaleLowerCase('pt-BR')===key||key===String(index+3)):undefined;
 if(custom){step='';context={};reply=custom.response;}
 else if(wantsHuman(message,true)||(step==='menu'&&key==='2')){const outside=isOutsideHumanHours(bot,receivedAt);await handoff(company.id,phone,'Cliente solicitou atendimento humano',message,{pause:!outside});if(outside){step='';context={...context,awaitingTeam:{at:new Date().toISOString(),reason:'Cliente solicitou atendimento humano'}};reply=outsideHoursText(bot);}else{step='human';reply=bot.handoffMessage;}}
 else if(step==='menu'){if(key==='1'||/^(reservar|agendar)$/i.test(key)){const list=await db.select().from(courts).where(and(eq(courts.companyId,company.id),eq(courts.active,true))).orderBy(asc(courts.name));if(!list.length){step='';reply=`Olá! ${company.name} ainda não cadastrou quadras para reserva.`;}else{context={courts:list.map(c=>c.id)};step='court';reply=`🏟️ *Escolha a quadra*\n\n${list.map((c,i)=>`${i+1}️⃣ ${c.name} · ${c.sport}`).join('\n')}\n\nResponda com o número da opção.`;}}else reply='Não entendi. Responda com o número de uma das opções do menu.';}
 else if(/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|reservar|agendar)$/i.test(key)||!step){step='menu';reply=`${bot.welcome}\n\n1 – Agendar horário\n2 – Falar com atendente${bot.menuOptions.map((option,index)=>`\n${index+3} – ${option.label}`).join('')}`;}
 else if(step==='court'){const list=await db.select().from(courts).where(and(eq(courts.companyId,company.id),eq(courts.active,true))).orderBy(asc(courts.name)),chosen=list[Number(key)-1];if(!chosen)reply='Não reconheci a quadra. Envie o número de uma das opções ou escreva “menu”.';else{context.courtId=chosen.id;step='date';reply=`📅 Qual dia você prefere para ${chosen.name}?`;}}
 else if(step==='date'){const parsed=parseArenaDate(message,bot.timeZone,receivedAt);if(!parsed.date)reply=parsed.question||'Informe uma data válida.';else{context.date=parsed.date;step='date_confirm';reply=`📅 Entendi: *${displayDate(parsed.date)}*. Certo? Responda “sim” ou informe outra data.`;}}
 else if(step==='date_confirm'){if(!affirmative(message)){step='date';const parsed=parseArenaDate(message,bot.timeZone,receivedAt);if(parsed.date){context.date=parsed.date;step='date_confirm';reply=`📅 Entendi: *${displayDate(parsed.date)}*. Certo?`;}else reply=parsed.question||'Qual data você prefere?';}else{const day=String(context.date||''),courtId=String(context.courtId||'');try{const free=await availability(company.id,courtId,day,60);if(!free.open){step='date';reply='A arena está fechada nesse dia. Qual outra data você prefere?';}else if(!free.slots.length){step='date';reply='Não há horários livres nesse dia. Qual outra data você prefere?';}else{const preview=previewSlots(free.slots,'todos');context.slots=free.slots.map(slot=>slot.inicio);step='time';reply=`📅 *Horários disponíveis*\n🏟️ ${free.quadra}\n${displayDate(day)}\n\n${preview.slots.map(slot=>`🕒 ${slot.inicio}`).join('\n')}\n\nQual horário você prefere?`;}}catch(error){step='date';reply=error instanceof Error?error.message:'Não consegui consultar esse dia. Informe outra data.';}}}
 else if(step==='time'){const slots=Array.isArray(context.slots)?context.slots.map(String):[],range=parseClockRange(message),start=range?.start||key;if(!slots.includes(start))reply=`Escolha um horário da lista: ${slots.join(', ')||'envie “menu” para recomeçar'}.`;else if(range&&!validDuration(range.duration,await arenaMaxDuration(company.id))){context.startTime=start;step='duration';reply=`Esse intervalo não corresponde a uma duração possível. ${durationError(await arenaMaxDuration(company.id))} Qual duração você prefere?`;}else{context.startTime=start;if(range)context.durationMinutes=range.duration;step=range?'name':'duration';reply=range?'Qual é o seu nome para registrar a reserva?':`Qual será a duração da reserva: ${durationRangeText(await arenaMaxDuration(company.id))}?`;}}
 else if(step==='payment_email'){const email=message.trim().toLowerCase(),bookingId=String(context.bookingId||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))reply='Informe um e-mail válido para gerar o Pix.';else if(!bookingId){step='';context={};reply='Não encontrei sua reserva. Vou chamar alguém da equipe para verificar.';}else{try{await saveClientEmail(company.id,phone,'',email);await sendBookingPix(company.id,session,phone,bookingId,email);step='';context={};reply='';}catch(error){console.error('whatsapp_payment_failed',error instanceof Error?error.message:'unknown');reply='Não consegui gerar o Pix agora. Confira o e-mail ou peça ajuda à equipe.';}}}
 else if(step==='duration'){const maxDuration=await arenaMaxDuration(company.id),minutes=parseDurationMinutes(message)??parseTimeDuration(message).duration;if(!minutes||!validDuration(minutes,maxDuration))reply=`Qual será a duração da reserva: ${durationRangeText(maxDuration)}?`;else{context.durationMinutes=minutes;step='name';reply='Qual é o seu nome para registrar a reserva?';}}
 else if(step==='name'){const minutes=Number(context.durationMinutes),maxDuration=await arenaMaxDuration(company.id);if(!validDuration(minutes,maxDuration))reply=`Qual será a duração da reserva: ${durationRangeText(maxDuration)}?`;else{const from=String(context.startTime),day=String(context.date),courtId=String(context.courtId),startMinute=Number(from.slice(0,2))*60+Number(from.slice(3)),startAt=`${day}T${from}:00.000Z`,endAt=`${day}T${timeHH(startMinute+minutes)}:00.000Z`,name=String(message.trim()).slice(0,100),now=new Date().toISOString();try{if(step==='name'){if(name.length<2)throw new Error('Informe seu nome para continuar.');const prior=(await db.select({id:clients.id}).from(clients).where(and(eq(clients.companyId,company.id),eq(clients.phone,phone))).limit(1))[0];if(prior)await db.update(clients).set({name}).where(eq(clients.id,prior.id));else await db.insert(clients).values({id:randomUUID(),companyId:company.id,name,phone,createdAt:now});}const checked=await availability(company.id,courtId,day,minutes);if(!checked.slots.some(slot=>slot.inicio===from))throw new Error('Esse horário não está mais disponível. Consulte outra opção.');const item=await db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${company.id}),hashtext(${courtId}))`);const court=(await tx.select().from(courts).where(and(eq(courts.id,courtId),eq(courts.companyId,company.id),eq(courts.active,true))).limit(1))[0];if(!court)throw fail(409,'A quadra não está disponível.');const conflict=await tx.select({id:bookings.id}).from(bookings).where(and(eq(bookings.companyId,company.id),eq(bookings.courtId,courtId),ne(bookings.status,'cancelled'),sql`${bookings.startAt}<${endAt}`,sql`${bookings.endAt}>${startAt}`)).limit(1);if(conflict.length)throw fail(409,'Esse horário acabou de ficar indisponível.');const client=(await tx.select().from(clients).where(and(eq(clients.companyId,company.id),eq(clients.phone,phone))).limit(1))[0],clientId=client?.id||randomUUID();if(client)await tx.update(clients).set({name}).where(eq(clients.id,clientId));else await tx.insert(clients).values({id:clientId,companyId:company.id,name,phone,createdAt:now});const tariffs=await tx.select({weekday:companyPriceSlots.weekday,startTime:companyPriceSlots.startTime,endTime:companyPriceSlots.endTime,priceCents:companyPriceSlots.priceCents}).from(companyPriceSlots).where(eq(companyPriceSlots.companyId,company.id));const id=randomUUID(),amountCents=bookingAmountCents(startAt,endAt,court.priceCents,tariffs);await tx.insert(bookings).values({id,companyId:company.id,courtId,clientId,customerName:isSimulating()?`[Teste] ${name}`.slice(0,100):name,customerPhone:phone,startAt,endAt,amountCents,status:'pending',source:'whatsapp',cancelReason:'',createdAt:now,updatedAt:now});await tx.insert(bookingEvents).values({id:randomUUID(),companyId:company.id,bookingId:id,userId:null,event:'whatsapp_request',details:{},createdAt:now});return {id,amountCents,courtName:court.name};});const amount=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(item.amountCents/100),deposit=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(chargeAmountCents(item.amountCents,bot)/100);const paymentStatus=paymentRequired&&item.amountCents>0?'aguardando_email':bot.paymentMode==='none'?'sem_cobranca':'sem_mercado_pago';reply=(await template(company.id,'reserva_criada','Pedido recebido para {data}, das {horario}. Valor estimado: {valor}. A equipe da {arena_name} vai confirmar pelo WhatsApp.',{data:day,horario:`${from} às ${timeHH(startMinute+minutes)}`,valor:amount,arena_name:company.name}))+((paymentRequired&&item.amountCents>0)?`\n\nPix antecipado: ${deposit}. Para receber o Pix Copia e Cola e o QR Code, informe seu e-mail.`:'');step=paymentRequired&&item.amountCents>0?'payment_email':'';context=step?{bookingId:item.id}:{};await db.insert(appAudit).values({id:randomUUID(),companyId:company.id,userId:null,action:'whatsapp.booking.created',entity:'booking',entityId:item.id,details:{paymentStatus},createdAt:now});}catch(e){step='date';reply=`${e instanceof Error?e.message:'Esse horário acabou de ficar indisponível.'}\nEnvie outra data no formato AAAA-MM-DD.`;}}}
 else{step='';reply='Vamos começar novamente. Escreva “reservar”.';}
 const now=new Date().toISOString();await db.insert(whatsappConversations).values({companyId:company.id,phone,step,context,updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{step,context,updatedAt:now}});if(reply)await sendText(company.id,session,phone,reply);
}
function wahaReady(){return Boolean(process.env.WAHA_BASE_URL&&process.env.WAHA_API_KEY&&process.env.WAHA_WEBHOOK_SECRET&&process.env.APP_BASE_URL);}
function wahaSecretOk(req:FastifyRequest){const secret=process.env.WAHA_WEBHOOK_SECRET||'',a=Buffer.from(secret),b=Buffer.from(String(req.headers['x-quadrasflow-secret']||''));return Boolean(secret)&&a.length===b.length&&timingSafeEqual(a,b);}
async function resolveWahaSender(session:string,rawFrom:string):Promise<{phone:string;contact:string}>{const from=rawFrom.trim(),jid=from.includes('@')?from:`${digits(from)}@c.us`;if(jid.endsWith('@c.us'))return {phone:digits(jid),contact:digits(jid)};if(jid.endsWith('@lid')){try{const base=(process.env.WAHA_BASE_URL||'').replace(/\/$/,''),response=await fetch(`${base}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(jid)}`,{headers:{'X-Api-Key':process.env.WAHA_API_KEY||''},signal:AbortSignal.timeout(3000)});if(response.ok){const data=await response.json() as {pn?:string|null};const phone=digits(data.pn||'');if(phone.length>=10&&phone.length<=15)return {phone,contact:phone};}}catch{}return {phone:'',contact:jid};}return {phone:'',contact:jid};}
async function prepareWahaSession(session:string,slug:string,recoverFailed=true){
 const base=(process.env.WAHA_BASE_URL||'').replace(/\/$/,''),key=process.env.WAHA_API_KEY||'',secret=process.env.WAHA_WEBHOOK_SECRET||'';if(!wahaReady())throw fail(503,'O serviço WhatsApp ainda não foi configurado no servidor.');
 const webhookBase=(process.env.WAHA_WEBHOOK_BASE_URL||process.env.APP_BASE_URL||'').replace(/\/$/,'');const request=async(path:string,method='GET',body?:unknown)=>fetch(`${base}${path}`,{method,headers:{'X-Api-Key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const name=encodeURIComponent(session);let response=await request(`/api/sessions/${name}`);
 if(response.status===404){response=await request('/api/sessions','POST',{name:session,config:{webhooks:[{url:`${webhookBase}/api/webhooks/waha/${slug}`,events:['message','session.status'],customHeaders:[{name:'X-Quadrasflow-Secret',value:secret}],retries:{policy:'exponential',attempts:8,delaySeconds:2}}]}});if(!response.ok&&response.status!==409)throw fail(502,'Não foi possível criar a sessão WhatsApp.');response=await request(`/api/sessions/${name}`);}
 if(!response.ok)throw fail(502,'O servidor WhatsApp não encontrou a sessão da arena.');const info=await response.json() as {status?:string};
 const status=String(info.status||'').toUpperCase();
 if(status==='STOPPED'){const started=await request(`/api/sessions/${name}/start`,'POST',{});if(!started.ok)throw fail(502,'Não foi possível iniciar a sessão WhatsApp.');}
 else if(status==='FAILED'){if(!recoverFailed)throw fail(425,'A sessão do WhatsApp está sendo reiniciada. Aguarde e tente novamente.');const restarted=await request(`/api/sessions/${name}/restart`,'POST',{});if(!restarted.ok)throw fail(502,'A sessão do WhatsApp falhou e não foi possível reiniciá-la. Tente atualizar o QR Code novamente.');}
}
function wahaSessionName(slug:string){return slug.slice(0,64);}
async function connectWaha(companyId:string,slug:string,userId:string){
 const current=await config(companyId),session=current.session||wahaSessionName(slug);
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(session)||!(session===slug||session.startsWith(`${slug}-`)))throw fail(409,'O identificador salvo para esta arena é inválido.');
 const records=await db.select().from(integrationSettings).where(eq(integrationSettings.provider,'waha'));
 if(records.some(r=>r.companyId!==companyId&&(r.settings as WahaConfig).session===session))throw fail(409,'Essa sessão WAHA já está vinculada a outra arena.');
 await saveConfig(companyId,{session,enabled:true,status:'STARTING'});
 await prepareWahaSession(session,slug);
 await audit(companyId,userId,'integration.waha.configured','integration',companyId,{session});
 return {ok:true,session,enabled:true};
}
export async function registerWhatsAppRoutes(app:FastifyInstance){const protectedRoute=auth(app);
 app.get('/api/whatsapp/bot-settings',protectedRoute,async req=>{const user=userOf(req),settings=await botConfig(companyOf(req));return {...settings,manualResumeOnly:(await resumePolicy(companyOf(req),settings)).manualResumeOnly,testPhones:user.role==='arena_admin'?settings.testPhones:[],aiConfigured:aiConfigured(),aiModel:process.env.WHATSAPP_AI_MODEL||'gpt-4.1-mini'};});
 app.put('/api/whatsapp/bot-settings',protectedRoute,async req=>{const user=adminOf(req),companyId=companyOf(req),b=bodyOf(req),current=await botConfig(companyId);const start=String(b.humanStart||current.humanStart),end=String(b.humanEnd||current.humanEnd);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||start>=end)throw fail(400,'Informe um intervalo de horário válido para atendimento humano.');const hours=Number(b.reactivateAfterHours??current.reactivateAfterHours);if(!Number.isInteger(hours)||hours<1||hours>48)throw fail(400,'O prazo de retomada deve ser entre 1 e 48 horas.');const options=Array.isArray(b.menuOptions)?b.menuOptions.slice(0,10).map((v:any)=>({id:String(v.id||randomUUID()),label:String(v.label||'').trim().slice(0,24),response:String(v.response||'').trim().slice(0,2000)})):current.menuOptions;if(options.some(o=>!o.label||!o.response))throw fail(400,'Cada opção personalizada precisa de nome e resposta.');const rawPhones=Array.isArray(b.testPhones)?b.testPhones:current.testPhones,testPhones=[...new Set(rawPhones.map((value:unknown)=>{const raw=String(value??'').trim();if(raw&&!/^[\d\s()+.-]+$/.test(raw))throw fail(400,'Use somente os dígitos e a formatação comum de telefone nos números de teste.');return digits(raw);}).filter(Boolean))];if(testPhones.some(phone=>phone.length<10||phone.length>15))throw fail(400,'Cada número de teste deve ter entre 10 e 15 dígitos, incluindo o código do país quando necessário.');const testMode=typeof b.testMode==='boolean'?b.testMode:current.testMode;if(testMode&&!testPhones.length)throw fail(400,'Adicione ao menos um número autorizado antes de ativar o modo de teste.');const timeZone=String(b.timeZone??current.timeZone).trim();if(timeZone){try{new Intl.DateTimeFormat('pt-BR',{timeZone});}catch{throw fail(400,'Informe um fuso horário IANA válido para a arena.');}}const paymentMode=String(b.paymentMode??current.paymentMode);if(!['none','full','percent','fixed'].includes(paymentMode))throw fail(400,'Escolha uma forma válida de pagamento antecipado.');const paymentPercent=Number(b.paymentPercent??current.paymentPercent),paymentFixedCents=Number(b.paymentFixedCents??current.paymentFixedCents);if(paymentMode==='percent'&&(!Number.isInteger(paymentPercent)||paymentPercent<1||paymentPercent>100))throw fail(400,'O percentual deve ser de 1% a 100%.');if(paymentMode==='fixed'&&(!Number.isInteger(paymentFixedCents)||paymentFixedCents<1))throw fail(400,'Informe um sinal maior que zero.');const next:BotConfig={paymentMode:paymentMode as PaymentPolicy['paymentMode'],paymentPercent,paymentFixedCents,timeZone,enabled:Boolean(b.enabled),testMode,testPhones,welcome:String(b.welcome??current.welcome).trim().slice(0,500),handoffMessage:String(b.handoffMessage??current.handoffMessage).trim().slice(0,1000),reactivateAfterHours:hours,humanStart:start,humanEnd:end,outsideHoursMessage:String(b.outsideHoursMessage??current.outsideHoursMessage).trim().slice(0,1000),manualResumeOnly:typeof b.manualResumeOnly==='boolean'?b.manualResumeOnly:(await resumePolicy(companyId,current)).manualResumeOnly,notifyPayment:Boolean(b.notifyPayment),remindUnpaid:Boolean(b.remindUnpaid),menuOptions:options};if(!next.welcome||!next.handoffMessage||!next.outsideHoursMessage)throw fail(400,'Preencha as mensagens do bot.');await saveBotConfig(companyId,next);await audit(companyId,user.id,'whatsapp.bot_settings_updated','integration',companyId);return next;});
 app.get('/api/integrations/waha',protectedRoute,async req=>{const user=userOf(req);if(!user.company)throw fail(403,'Esta conta não pertence a uma arena.');const c=await config(user.company.id);return {session:c.session||'',enabled:Boolean(c.enabled),status:c.status||'unknown',connected:wahaReady(),serviceConfigured:wahaReady(),aiConfigured:aiConfigured(),webhookUrl:process.env.APP_BASE_URL&&user.company.slug?`${process.env.APP_BASE_URL.replace(/\/$/,'')}/api/webhooks/waha/${user.company.slug}`:''};});
 app.post('/api/integrations/waha/connect',protectedRoute,async req=>{const user=adminOf(req);if(!user.company?.slug)throw fail(403,'Esta conta não pertence a uma arena.');if(!wahaReady())throw fail(503,'O serviço WhatsApp ainda não foi configurado no servidor.');return connectWaha(user.company.id,user.company.slug,user.id);});
 app.put('/api/integrations/waha',protectedRoute,async req=>{const user=adminOf(req),companyId=companyOf(req),b=bodyOf(req),session=String(b.session||'').trim();if(!/^[a-zA-Z0-9_-]{1,64}$/.test(session))throw fail(400,'Informe o nome válido da sessão WAHA.');if(!user.company?.slug||!(session===user.company.slug||session.startsWith(`${user.company.slug}-`)))throw fail(400,`A sessão precisa começar com o identificador desta arena: ${user.company?.slug||''}-`);if(!wahaReady())throw fail(503,'O serviço WhatsApp ainda não foi configurado no servidor.');await saveConfig(companyId,{session,enabled:b.enabled!==false,status:(await config(companyId)).status||'STARTING'});await prepareWahaSession(session,user.company.slug);await audit(companyId,user.id,'integration.waha.configured','integration',companyId,{session});return {ok:true,session,enabled:b.enabled!==false};});
 app.get('/api/integrations/waha/status',protectedRoute,async req=>{const companyId=companyOf(req),c=await config(companyId);if(!c.session||!wahaReady())return {configured:false,status:'not_configured',serviceConfigured:wahaReady(),aiConfigured:aiConfigured()};try{const response=await fetch(`${process.env.WAHA_BASE_URL!.replace(/\/$/,'')}/api/sessions/${encodeURIComponent(c.session)}`,{headers:{'X-Api-Key':process.env.WAHA_API_KEY!},signal:AbortSignal.timeout(6000)});const data=await response.json() as Record<string,unknown>;if(!response.ok)throw new Error();return {configured:true,status:String(data.status||data.state||'unknown'),session:c.session,serviceConfigured:true,aiConfigured:aiConfigured()};}catch{return {configured:true,status:'unavailable',session:c.session,serviceConfigured:true,aiConfigured:aiConfigured()};}});
 app.get('/api/integrations/waha/qr',protectedRoute,async req=>{const user=userOf(req);if(user.role!=='arena_admin')throw fail(403,'Somente o administrador pode conectar o WhatsApp da arena.');const c=await config(companyOf(req));if(!c.session||!user.company?.slug)throw fail(409,'Inicie a conexão WhatsApp antes de solicitar o QR Code.');await prepareWahaSession(c.session,user.company.slug,false);const response=await fetch(`${process.env.WAHA_BASE_URL!.replace(/\/$/,'')}/api/${encodeURIComponent(c.session)}/auth/qr?format=image`,{headers:{'X-Api-Key':process.env.WAHA_API_KEY!,Accept:'image/png'},signal:AbortSignal.timeout(10000)});if(!response.ok){if(response.status===422||response.status===404)throw fail(425,'O WhatsApp ainda está preparando o QR Code. Aguarde alguns segundos.');throw fail(502,'O WAHA não conseguiu gerar o QR Code. Tente novamente.');}const contentType=response.headers.get('content-type')||'';if(!/^image\/(png|jpeg|webp)/i.test(contentType))throw fail(502,'O WAHA retornou um formato de QR Code inválido.');const image=Buffer.from(await response.arrayBuffer()).toString('base64');return {image:`data:${contentType.split(';')[0]};base64,${image}`};});
 app.get('/api/message-templates',protectedRoute,async req=>{const companyId=companyOf(req),now=new Date().toISOString(),defaults=[['menu','Boas-vindas','Olá! Vou ajudar com sua reserva.'],['reserva_criada','Pedido de reserva','Pedido recebido para {data}, das {horario}. Valor estimado: {valor}. A arena {arena_name} vai confirmar pelo WhatsApp.'],['avaliacao','Solicitar avaliação','Como foi sua experiência na {arena_name}? Avalie aqui: {review_link}']],seeded=(await db.select({companyId:integrationSettings.companyId}).from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'whatsapp_templates_seeded'))).limit(1))[0];if(!seeded){for(const [category,title,body] of defaults){const found=await db.select({id:messageTemplates.id}).from(messageTemplates).where(and(eq(messageTemplates.companyId,companyId),eq(messageTemplates.category,category!))).limit(1);if(!found.length)await db.insert(messageTemplates).values({id:randomUUID(),companyId,title:title!,category:category!,body:body!,active:true,createdAt:now});}await db.insert(integrationSettings).values({companyId,provider:'whatsapp_templates_seeded',settings:{seeded:true},updatedAt:now}).onConflictDoNothing();}const list=await db.select().from(messageTemplates).where(eq(messageTemplates.companyId,companyId)).orderBy(asc(messageTemplates.createdAt),asc(messageTemplates.title));return {templates:list.map(t=>({...t,created_at:t.createdAt}))};});
 app.post('/api/message-templates',protectedRoute,async(req,reply)=>{const user=adminOf(req),companyId=companyOf(req),b=bodyOf(req),title=text(b.title,'o título do modelo'),category=String(b.category||''),body=String(b.body||'').trim();if(!['menu','reserva_criada','avaliacao','reserva_confirmada','lembrete','pagamento','personalizado'].includes(category)||!body||body.length>2000)throw fail(400,'Confira a categoria e o texto do modelo.');const id=randomUUID();await db.insert(messageTemplates).values({id,companyId,title,category,body,active:true,createdAt:new Date().toISOString()});await audit(companyId,user.id,'message_template.created','message_template',id);return reply.code(201).send({id});});
 app.patch('/api/message-templates/:id',protectedRoute,async req=>{const user=adminOf(req),companyId=companyOf(req),{id}=req.params as {id:string},b=bodyOf(req);if(typeof b.active!=='boolean'&&typeof b.title!=='string'&&typeof b.body!=='string')throw fail(400,'Informe alterações válidas para o modelo.');const update:Record<string,unknown>={};if(typeof b.active==='boolean')update.active=b.active;if(typeof b.title==='string')update.title=text(b.title,'o título do modelo');if(typeof b.body==='string'){const body=b.body.trim();if(!body||body.length>2000)throw fail(400,'O texto do modelo deve ter até 2.000 caracteres.');update.body=body;}const rows=await db.update(messageTemplates).set(update).where(and(eq(messageTemplates.id,id),eq(messageTemplates.companyId,companyId))).returning({id:messageTemplates.id});if(!rows.length)throw fail(404,'Modelo não encontrado.');await audit(companyId,user.id,'message_template.updated','message_template',id);return {ok:true};});
 app.delete('/api/message-templates/:id',protectedRoute,async req=>{const user=adminOf(req),companyId=companyOf(req),{id}=req.params as {id:string},rows=await db.delete(messageTemplates).where(and(eq(messageTemplates.id,id),eq(messageTemplates.companyId,companyId))).returning({id:messageTemplates.id});if(!rows.length)throw fail(404,'Modelo não encontrado.');await audit(companyId,user.id,'message_template.deleted','message_template',id);return {ok:true};});
 // Clientes esperando a equipe (pediram atendente e ninguém respondeu pelo painel ainda): alimenta o sininho.
 const attentionItems=async(companyId:string)=>{const rows=await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,companyId),sql`${whatsappConversations.context} ? 'awaitingTeam'`,sql`${whatsappConversations.phone} NOT LIKE ${SIMULATOR_PREFIX+'%'}`)).orderBy(desc(whatsappConversations.updatedAt)).limit(50);return rows.map(r=>{const a=((r.context as Record<string,unknown>).awaitingTeam||{}) as {at?:string;reason?:string};return {phone:r.phone,reason:a.reason||'Atendimento humano',at:a.at||r.updatedAt,paused:r.step==='human'};});};
 app.get('/api/whatsapp/attention',protectedRoute,async req=>{const items=await attentionItems(companyOf(req));return {count:items.length,items};});
 // Tudo o que o menu e o sininho mostram, numa única chamada (o limite de requisições é por IP no painel inteiro).
 app.get('/api/shell',protectedRoute,async req=>{const companyId=companyOf(req);const [[pending],[active],waha,attention]=await Promise.all([db.select({n:sql<number>`count(*)::int`}).from(bookings).where(and(eq(bookings.companyId,companyId),eq(bookings.status,'pending'))),db.select({n:sql<number>`count(*)::int`}).from(courts).where(and(eq(courts.companyId,companyId),eq(courts.active,true))),config(companyId),attentionItems(companyId)]);return {pending:pending?.n??0,courtsActive:active?.n??0,whatsapp:!waha.session?'off':waha.status==='WORKING'?'on':'off',attention};});
 app.get('/api/whatsapp/conversations',protectedRoute,async req=>{const companyId=companyOf(req),q=req.query as {phone?:string},raw=String(q.phone||''),phone=/^\d+@lid$/.test(raw)?raw:digits(raw);if(phone){const messages=await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,phone))).orderBy(asc(whatsappMessages.createdAt)).limit(300);return {messages:messages.map(m=>({direction:m.direction,body:m.body,created_at:m.createdAt}))};}const conv=await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,companyId),sql`${whatsappConversations.phone} NOT LIKE ${SIMULATOR_PREFIX+'%'}`)).orderBy(desc(whatsappConversations.updatedAt)).limit(100);const conversations=await Promise.all(conv.map(async c=>{const latest=(await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,c.phone))).orderBy(desc(whatsappMessages.createdAt)).limit(1))[0];return {phone:c.phone,step:c.step,updated_at:c.updatedAt,last_message:latest?.body||'',last_direction:latest?.direction||'',awaiting_team:Boolean((c.context as Record<string,unknown>|null)?.awaitingTeam)};}));return {conversations};});
 app.post('/api/whatsapp/reply',protectedRoute,async req=>{const user=userOf(req),companyId=companyOf(req),b=bodyOf(req),raw=String(b.phone||''),isLid=/^\d+@lid$/.test(raw),phone=isLid?raw:digits(raw),valid=isLid||(phone.length>=10&&phone.length<=15),message=String(b.message||'').trim();if(!valid||!message||message.length>2000)throw fail(400,'Confira o telefone e o texto da mensagem.');const c=await config(companyId);if(!c.enabled||!c.session)throw fail(409,'Conecte a sessão WAHA da arena antes de responder.');await sendText(companyId,c.session,phone,message);await db.insert(whatsappConversations).values({companyId,phone,step:'human',context:{},updatedAt:new Date().toISOString()}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{step:'human',context:sql`${whatsappConversations.context} - 'awaitingTeam'`,updatedAt:new Date().toISOString()}});await audit(companyId,user.id,'whatsapp.reply_sent','conversation',phone);return {ok:true};});
 app.patch('/api/whatsapp/conversations/:phone/resume',protectedRoute,async req=>{const user=userOf(req),companyId=companyOf(req),{phone:raw}=req.params as {phone:string},phone=/^\d+@lid$/.test(raw)?raw:digits(raw),updated=await db.update(whatsappConversations).set({step:'',context:sql`CASE WHEN ${whatsappConversations.step}='human' THEN '{}'::jsonb ELSE ${whatsappConversations.context} - 'awaitingTeam' END`,updatedAt:new Date().toISOString()}).where(and(eq(whatsappConversations.companyId,companyId),eq(whatsappConversations.phone,phone))).returning({phone:whatsappConversations.phone});if(!updated.length)throw fail(404,'Conversa não encontrada.');await audit(companyId,user.id,'whatsapp.automation_resumed','conversation',phone);return {ok:true};});
 // Simulador do agente: só administrador; mesmo atendimento, sem enviar nada para fora (ver whatsapp-simulation.ts).
 const simulatorState=async(companyId:string,phone:string)=>{const [conversation,messages]=await Promise.all([db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,companyId),eq(whatsappConversations.phone,phone))).limit(1),db.select().from(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,phone))).orderBy(asc(whatsappMessages.createdAt)).limit(300)]);const bot=await botConfig(companyId);return {step:conversation[0]?.step||'',context:conversation[0]?.context||{},messages:messages.map(m=>({direction:m.direction,body:m.body,created_at:m.createdAt})),botEnabled:Boolean(bot.enabled),aiConfigured:aiConfigured()};};
 app.get('/api/whatsapp/simulator',protectedRoute,async req=>{const user=adminOf(req);return simulatorState(companyOf(req),simulatorPhone(user.id));});
 app.post('/api/whatsapp/simulator',{...protectedRoute,config:{rateLimit:{max:40,timeWindow:60000}}},async req=>{
  const user=adminOf(req),companyId=companyOf(req),phone=simulatorPhone(user.id),message=String(bodyOf(req).message||'').trim().slice(0,1000);if(!message)throw fail(400,'Escreva uma mensagem.');
  const company=(await db.select({id:companies.id,name:companies.name}).from(companies).where(eq(companies.id,companyId)).limit(1))[0];if(!company)throw fail(404,'Arena não encontrada.');
  const now=new Date().toISOString(),eventId=`sim-${randomUUID()}`;
  await db.insert(whatsappConversations).values({companyId,phone,step:'',context:{},updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{updatedAt:now}});
  await db.insert(whatsappMessages).values({id:randomUUID(),companyId,eventId,phone,direction:'in',body:message,createdAt:now});
  const started=Date.now(),events=await runSimulation(async()=>{try{await handleIncoming(company,'simulador',{id:eventId,from:`${phone}@c.us`,body:message,receivedAt:now});}catch(error){simulationNote('note',`Erro no atendimento: ${error instanceof Error?error.message:'desconhecido'}`);}});
  const state=await simulatorState(companyId,phone);
  if(!state.botEnabled)events.push({kind:'note',text:'O bot automático está desligado nas configurações; nada foi respondido.'});
  else if(state.step==='human'&&!events.some(e=>e.kind==='reply'))events.push({kind:'note',text:'A conversa está com a equipe (atendimento humano), então o bot não responde. Use "Apagar memória" para recomeçar.'});
  return {...state,events,elapsedMs:Date.now()-started};
 });
 app.delete('/api/whatsapp/simulator',protectedRoute,async req=>{
  const user=adminOf(req),companyId=companyOf(req),phone=simulatorPhone(user.id);
  const removed=await db.transaction(async tx=>{
   const ids=(await tx.select({id:bookings.id}).from(bookings).where(and(eq(bookings.companyId,companyId),eq(bookings.customerPhone,phone)))).map(r=>r.id);
   if(ids.length){const list=sql.join(ids.map(id=>sql`${id}`),sql`,`);
    await tx.execute(sql`DELETE FROM finance_entries WHERE company_id=${companyId} AND booking_id IN (${list})`);
    await tx.execute(sql`DELETE FROM booking_events WHERE company_id=${companyId} AND booking_id IN (${list})`);
    await tx.execute(sql`DELETE FROM app_audit WHERE company_id=${companyId} AND entity='booking' AND entity_id IN (${list})`);
    await tx.execute(sql`DELETE FROM bookings WHERE company_id=${companyId} AND id IN (${list})`);}
   await tx.execute(sql`DELETE FROM clients WHERE company_id=${companyId} AND phone=${phone}`);
   await tx.delete(whatsappMessages).where(and(eq(whatsappMessages.companyId,companyId),eq(whatsappMessages.phone,phone)));
   await tx.delete(whatsappConversations).where(and(eq(whatsappConversations.companyId,companyId),eq(whatsappConversations.phone,phone)));
   return ids.length;
  });
  return {ok:true,bookingsRemoved:removed};
 });
 // Todos os avisos do WAHA (de todas as arenas) chegam do mesmo IP: os autenticados ficam fora do limite global por IP.
 app.post('/api/webhooks/waha/:slug',{config:{rateLimit:{allowList:(req:FastifyRequest)=>wahaSecretOk(req)}}},async(req,reply)=>{
  if(!process.env.WAHA_WEBHOOK_SECRET)throw fail(503,'Webhook WAHA sem segredo configurado.');if(!wahaSecretOk(req))throw fail(401,'Webhook não autorizado.');
  const {slug}=req.params as {slug:string},company=(await db.select({id:companies.id,name:companies.name,slug:companies.slug}).from(companies).where(and(eq(companies.slug,slug),eq(companies.status,'active'))).limit(1))[0];if(!company)throw fail(404,'Arena não encontrada.');
  const body=bodyOf(req),c=await config(company.id);if(!c.enabled||!c.session||body.session!==c.session)throw fail(403,'Sessão WAHA não autorizada para esta arena.');
  const payload=(body.payload||{}) as Record<string,unknown>,eventId=String(body.id||payload.id||'');
  if(body.event==='message'&&eventId&&!payload.fromMe){
   if(!isPrivateIncomingPayload(payload))return {ok:true,ignored:true,reason:'private_chats_only'};
   const [accepted]=await db.insert(webhookEvents).values({provider:'waha',eventId,companyId:company.id,receivedAt:new Date().toISOString()}).onConflictDoNothing().returning({eventId:webhookEvents.eventId});if(!accepted)return {ok:true,duplicate:true};
   const rawFrom=String(payload.from||'').trim();
   const {phone,contact}=await resolveWahaSender(c.session,rawFrom),identity=phone||contact,originalMessage=String(payload.body||'').trim().slice(0,1000),now=new Date().toISOString();
   if((phone.length>=10&&phone.length<=15)||/^\d+@lid$/.test(identity)){
    await db.insert(whatsappConversations).values({companyId:company.id,phone:identity,step:'',context:{},updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{updatedAt:now}});
   }
   const bot=await botConfig(company.id);
   // A automação pode não rodar (modo de teste, identificador sem telefone), mas o que o cliente escreveu fica na aba Conversas para a equipe.
   const recordOnly=async()=>{const text=originalMessage||(payload.hasMedia===true?'[Mídia recebida]':'');if(text&&((phone.length>=10&&phone.length<=15)||/^\d+@lid$/.test(identity)))await db.insert(whatsappMessages).values({id:randomUUID(),companyId:company.id,eventId,phone:identity,direction:'in',body:text,createdAt:now}).onConflictDoNothing();};
   if(bot.testMode&&(!phone||!bot.testPhones.some(allowed=>testPhoneMatches(phone,allowed)))){req.log.info({companyId:company.id,senderResolved:Boolean(phone)},'Mensagem recebida; automação bloqueada pelo modo de teste.');await recordOnly();return {ok:true,ignored:true};}
   if(!phone){req.log.info({companyId:company.id,senderResolved:false},'Mensagem recebida com identificador LID sem telefone associado; automação não executada.');await recordOnly();return {ok:true,ignored:true};}
   const media=(payload.media&&typeof payload.media==='object'?payload.media:{}) as Record<string,unknown>,mime=String(media.mimetype||'').toLowerCase();let message=originalMessage;
   if(payload.hasMedia===true&&mime.startsWith('audio/')){try{const transcript=await transcribeWhatsAppAudio(media);message=[originalMessage,`[Transcrição do áudio] ${transcript}`].filter(Boolean).join('\n\n');}catch(error){req.log.warn({companyId:company.id,reason:error instanceof Error?error.message:'transcription_failed'},'Não foi possível transcrever o áudio recebido.');const reason=error instanceof Error?error.message:'';const notice=reason==='transcription_not_configured'?'O atendimento por áudio ainda não está configurado. Você pode escrever sua mensagem por aqui.':'Não consegui entender esse áudio. Pode enviar novamente ou escrever sua mensagem?';await db.insert(whatsappMessages).values({id:randomUUID(),companyId:company.id,eventId,phone:identity,direction:'in',body:'[Áudio recebido; não foi possível transcrever]',createdAt:now}).onConflictDoNothing();await sendText(company.id,c.session,phone,notice);return {ok:true,transcriptionFailed:true};}}
   if(message)await db.insert(whatsappMessages).values({id:randomUUID(),companyId:company.id,eventId,phone:identity,direction:'in',body:message,createdAt:now}).onConflictDoNothing();
   try{if(message)await handleIncoming(company,c.session,{...payload,body:message,from:`${phone}@c.us`,receivedAt:now});}catch(error){req.log.error({err:error,companyId:company.id},'Falha ao processar mensagem WAHA; evento marcado para evitar duplicar uma reserva.');}
  }else if(body.event==='session.status'){await saveConfig(company.id,{...c,status:String((payload as Record<string,unknown>).status||'unknown').slice(0,40)});}
  return reply.send({ok:true});
 });
}

export {handleIncoming};
