import {and,eq,gte,lte,sql} from 'drizzle-orm';
import { isTestPhone } from './whatsapp-test-mode.js';
import {randomUUID} from 'node:crypto';
import {bookings,clients,companies,integrationSettings,monthlyCharges,monthlyMembers,whatsappDeliveries,whatsappMessages} from '@quadrasflow/database';
import {localNow} from './arena-dates.js';
import {chargeDueNow,chargeMessage,DEFAULT_CHARGE_MESSAGE,dueDateOf} from './monthly-plan.js';
import {db} from './database.js';
import {arenaInformation,enqueueDelivery,integration,localPhoto,serviceSettings,wahaRequest} from './whatsapp-services.js';
import {bookingInstant,chatDestination,type ServiceSettings} from './whatsapp-service-rules.js';
import {isSimulatorPhone} from './whatsapp-simulation.js';

let nextReviewScanAt=0;
export async function scheduleReviews(now=Date.now()){
 if(now<nextReviewScanAt)return;nextReviewScanAt=now+5*60*1000;
 const settings=await db.select().from(integrationSettings).where(eq(integrationSettings.provider,'whatsapp_services'));
 for(const row of settings){const cfg=row.settings as ServiceSettings;if(!cfg.reviewEnabled||!cfg.reviewEnabledAt)continue;
  const bot=await integration(row.companyId,'whatsapp_bot');if(!bot.timeZone)continue;
  const info=await arenaInformation(row.companyId);if(!info.reviewUrl)continue;
  // Legacy dates are arena wall times. A wide SQL bound is narrowed after conversion.
  const list=await db.select().from(bookings).where(and(eq(bookings.companyId,row.companyId),sql`${bookings.status} IN ('confirmed','completed')`,gte(bookings.endAt,new Date(now-3*86400000).toISOString()),lte(bookings.endAt,new Date(now+86400000).toISOString())));
  for(const b of list){const ended=bookingInstant(b.endAt,bot.timeZone),due=ended+cfg.reviewDelayMinutes*60000;
   if(!b.customerPhone||ended<Date.parse(cfg.reviewEnabledAt)||due>now||now-due>86400000)continue;
   await enqueueDelivery(row.companyId,'review',b.customerPhone,{},`review:${b.id}`,b.id,new Date(due).toISOString());
  }
 }
}
// Cobrança automática de mensalistas: uma mensagem por mensalidade, no dia do vencimento a partir das 9h da arena.
let nextChargeScanAt=0;
export async function scheduleMonthlyCharges(now=Date.now()){
 if(now<nextChargeScanAt)return;nextChargeScanAt=now+5*60*1000;
 const plans=await db.select({member:monthlyMembers,phone:clients.phone}).from(monthlyMembers).innerJoin(clients,eq(monthlyMembers.clientId,clients.id)).where(and(eq(monthlyMembers.status,'active'),eq(monthlyMembers.autoCharge,true)));
 for(const companyId of [...new Set(plans.map(p=>p.member.companyId))]){
  const bot=await integration(companyId,'whatsapp_bot');if(!bot.timeZone)continue;
  const local=localNow(String(bot.timeZone),new Date(now)),cycle=local.date.slice(0,7),created=new Date(now).toISOString();
  for(const {member,phone} of plans.filter(p=>p.member.companyId===companyId&&p.phone)){
   await db.insert(monthlyCharges).values({id:randomUUID(),companyId,memberId:member.id,cycle,amountCents:member.amountCents,dueDate:dueDateOf(cycle,member.dueDay),paidAt:null,createdAt:created}).onConflictDoNothing();
   const charge=(await db.select().from(monthlyCharges).where(and(eq(monthlyCharges.memberId,member.id),eq(monthlyCharges.cycle,cycle))).limit(1))[0];
   if(charge&&!charge.paidAt&&chargeDueNow(charge.dueDate,local))await enqueueDelivery(companyId,'monthly_charge',phone!,{chargeId:charge.id},`monthly-charge:${charge.id}`,null,created);
  }
 }
}
const labels:Record<string,string>={pending:'Nova reserva aguardando confirmação ou pagamento',confirmed:'Reserva confirmada',cancelled:'Reserva cancelada',expired:'Reserva expirada',paid:'Pagamento recebido'};
export async function deliverOne(id?:string){
 const now=new Date().toISOString();
 const job=await db.transaction(async tx=>{
  const rows=await tx.select().from(whatsappDeliveries).where(and(eq(whatsappDeliveries.status,'pending'),lte(whatsappDeliveries.dueAt,now),id?eq(whatsappDeliveries.id,id):undefined)).orderBy(whatsappDeliveries.dueAt).limit(1).for('update',{skipLocked:true});
  const row=rows[0];if(!row)return;
  await tx.update(whatsappDeliveries).set({status:'sending',attempts:row.attempts+1,updatedAt:now}).where(eq(whatsappDeliveries.id,row.id));return row;
 });if(!job)return false;
 let attempted=false;
 const finish=async(status:string,error='')=>{await db.update(whatsappDeliveries).set({status,error,updatedAt:new Date().toISOString()}).where(eq(whatsappDeliveries.id,job.id));};
 try{
  const cfg=await serviceSettings(job.companyId),bot=await integration(job.companyId,'whatsapp_bot'),waha=await integration(job.companyId,'waha');
  const company=(await db.select({status:companies.status}).from(companies).where(eq(companies.id,job.companyId)).limit(1))[0];if(company?.status!=='active'){await finish('skipped');return true;}
  if(Date.now()-Date.parse(job.createdAt)>86400000){await finish('skipped','Envio vencido.');return true;}
  const group=job.destination.endsWith('@g.us');
  if(isSimulatorPhone(job.destination)){await finish('skipped','Simulador do agente.');return true;}
  if(group&&(!cfg.groupEnabled||cfg.groupId!==job.destination||!cfg.events.includes(job.kind))){await finish('skipped');return true;}
  const phone=job.destination.replace(/@c\.us$/,'');
  if(!group&&bot.testMode&&!isTestPhone(phone,(bot.testPhones||[]) as string[])){await finish('skipped','Contato fora do modo de teste.');return true;}
  if(!waha.enabled||!waha.session||!process.env.WAHA_BASE_URL||!process.env.WAHA_API_KEY)throw new Error('WhatsApp desconectado.');
  let text=String(job.payload.text||'');
  if(job.kind==='review'){
   const b=(await db.select().from(bookings).where(and(eq(bookings.id,job.bookingId!),eq(bookings.companyId,job.companyId))).limit(1))[0];
   const info=await arenaInformation(job.companyId);
   if(!cfg.reviewEnabled||!info.reviewUrl||!b||!['confirmed','completed'].includes(b.status)||!bot.timeZone||b.customerPhone!==phone){await finish('skipped');return true;}
   const due=bookingInstant(b.endAt,bot.timeZone)+cfg.reviewDelayMinutes*60000;
   if(due>Date.now()){await db.update(whatsappDeliveries).set({status:'pending',dueAt:new Date(due).toISOString(),updatedAt:now}).where(eq(whatsappDeliveries.id,job.id));return true;}
   if(bookingInstant(b.endAt,bot.timeZone)<Date.parse(cfg.reviewEnabledAt)||Date.now()-due>86400000){await finish('skipped');return true;}
   text=cfg.reviewMessage.replace(/\{(nome|arena_name|review_link)\}/g,(_,key:string)=>({nome:b.customerName,arena_name:info.nome,review_link:info.reviewUrl})[key]!);
  }else if(job.kind==='monthly_charge'){
   // Confere de novo na hora de enviar: paga, plano pausado/encerrado ou cobrança desligada não manda nada.
   const row=(await db.select({charge:monthlyCharges,member:monthlyMembers,name:clients.name,phone:clients.phone}).from(monthlyCharges).innerJoin(monthlyMembers,eq(monthlyCharges.memberId,monthlyMembers.id)).innerJoin(clients,eq(monthlyMembers.clientId,clients.id)).where(and(eq(monthlyCharges.id,String(job.payload.chargeId||'')),eq(monthlyCharges.companyId,job.companyId))).limit(1))[0];
   if(!row||row.charge.paidAt||row.member.status!=='active'||!row.member.autoCharge||!row.phone||chatDestination(row.phone)!==job.destination){await finish('skipped');return true;}
   const info=await arenaInformation(job.companyId);
   text=chargeMessage(cfg.monthlyChargeMessage||DEFAULT_CHARGE_MESSAGE,{name:row.name,arena:info.nome,amountCents:row.charge.amountCents,dueDate:row.charge.dueDate,cycle:row.charge.cycle});
  }else if(job.kind==='expired'&&!group){
   const p=job.payload;
   text=`⏰ O prazo do Pix acabou e a reserva de ${p.court}, ${String(p.start).slice(0,10).split('-').reverse().join('/')} das ${String(p.start).slice(11,16)} às ${String(p.end).slice(11,16)}, foi cancelada. O horário voltou a ficar disponível.\n\nSe ainda quiser jogar, é só me chamar que faço uma nova reserva.`;
  }else if(labels[job.kind]){
   const p=job.payload;const base=(process.env.APP_BASE_URL||'').replace(/\/$/,'');
   text=`${labels[job.kind]} · ${p.arena}\n${p.customerName}${p.phone?` · ${p.phone}`:''}\n${p.court}\n${String(p.start).slice(0,10).split('-').reverse().join('/')} · ${String(p.start).slice(11,16)} às ${String(p.end).slice(11,16)}${job.kind==='paid'&&p.bookingStatus==='cancelled'?'\nAtenção: reserva cancelada. Analisar o pagamento e eventual estorno.':''}\n${base}/reservas`;
  }
  let body:Record<string,unknown>={chatId:job.destination,text};let path='/api/sendText';
  if(job.kind==='photo'){const data=await localPhoto(job.companyId,String(job.payload.url));path='/api/sendImage';body={chatId:job.destination,file:{mimetype:'image/jpeg',filename:'quadra.jpg',data},caption:String(job.payload.caption||'')};text=`[Foto: ${job.payload.caption}] ${job.payload.url}`;}
  // Failures after dispatch can have an ambiguous outcome; never blindly resend them.
  attempted=true;await wahaRequest(job.companyId,path,body);
  await db.transaction(async tx=>{
   await tx.update(whatsappDeliveries).set({status:'sent',error:'',updatedAt:new Date().toISOString()}).where(eq(whatsappDeliveries.id,job.id));
   if(!group)await tx.insert(whatsappMessages).values({id:job.id,companyId:job.companyId,eventId:job.id,phone,direction:'out',body:text.slice(0,2000),createdAt:new Date().toISOString()}).onConflictDoNothing();
  });
 }catch(error){
  const status=(error as {wahaStatus?:number}).wahaStatus;
  if((!attempted||status===429)&&job.attempts<4){await db.update(whatsappDeliveries).set({status:'pending',error:'Envio adiado. Verifique a conexão do WhatsApp.',dueAt:new Date(Date.now()+60000*2**job.attempts).toISOString(),updatedAt:new Date().toISOString()}).where(eq(whatsappDeliveries.id,job.id));}
  else await finish(attempted&&(!status||status>=500)?'unknown':'failed',attempted&&(!status||status>=500)?'Entrega incerta. Confira no WhatsApp antes de reenviar.':'Não foi possível enviar. Confira a conexão e as permissões.');
 }
 return true;
}
let running=false;
export async function processWhatsAppDeliveries(){if(running)return;running=true;try{
 await db.update(whatsappDeliveries).set({status:'unknown',error:'Processamento interrompido. Confira a entrega no WhatsApp.'}).where(and(eq(whatsappDeliveries.status,'sending'),lte(whatsappDeliveries.updatedAt,new Date(Date.now()-5*60000).toISOString())));
 await scheduleReviews();await scheduleMonthlyCharges();for(let i=0;i<30;i++){if(!await deliverOne())break;}
}finally{running=false;}}
