import {createHash, randomUUID} from 'node:crypto';
import {isSimulating,isSimulatorPhone,simulationNote} from './whatsapp-simulation.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {and,eq,desc,sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {companies,courts,bookings,bookingEvents,clients,integrationSettings,whatsappConversations,whatsappDeliveries,whatsappMessages,appAudit,financeEntries} from '@quadrasflow/database';
import {db} from './database.js';
import {adminOf,companyOf,fail} from './arena.js';
import {serviceDefaults,safePublicLink,chatDestination,bookingInstant,cancellationAllowed,type ServiceSettings} from './whatsapp-service-rules.js';
export async function serviceSettings(companyId:string):Promise<ServiceSettings> {
 const row=(await db.select().from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'whatsapp_services'))).limit(1))[0];
 return {...serviceDefaults,...(row?.settings as Partial<ServiceSettings>||{})} as ServiceSettings;
}
export async function integration(companyId:string,provider:string):Promise<Record<string,any>> {
 return (await db.select().from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,provider))).limit(1))[0]?.settings as Record<string,any>||{};
}
export async function wahaRequest(companyId:string,path:string,body?:unknown) {
 const config=await integration(companyId,'waha');
 if(!config.enabled||!config.session||!process.env.WAHA_BASE_URL||!process.env.WAHA_API_KEY)throw fail(409,'Conecte o WhatsApp da arena primeiro.');
 const response=await fetch(`${process.env.WAHA_BASE_URL.replace(/\/$/,'')}${path.replace('{session}',encodeURIComponent(config.session))}`,{method:body===undefined?'GET':'POST',headers:{'X-Api-Key':process.env.WAHA_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({...body as object,session:config.session})}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Object.assign(fail(422,'O WhatsApp não concluiu a operação. Confira a sessão e as permissões do grupo.'),{wahaStatus:response.status});
 return await response.json().catch(()=>({}));
}
export async function arenaInformation(companyId:string){
 const c=(await db.select().from(companies).where(eq(companies.id,companyId)).limit(1))[0];if(!c)throw fail(404,'Arena não encontrada.');
 const links=(c.publicOptions.contactLinks||{}) as Record<string,string>;
 return {nome:c.name,endereco:[c.address,c.addressNumber,c.district,c.city,c.state].filter(Boolean).join(', '),address:c.address,addressNumber:c.addressNumber,district:c.district,city:c.city,state:c.state,mapsUrl:links.mapsUrl||'',instagramUrl:links.instagramUrl||'',reviewUrl:links.reviewUrl||''};
}
export async function enqueueDelivery(companyId:string,kind:string,destination:string,payload:Record<string,unknown>,id:string=randomUUID(),bookingId:string|null=null,dueAt=new Date().toISOString()) {
 if(isSimulating()||isSimulatorPhone(destination)){simulationNote('note',`Envio automático "${kind}" (não enviado no simulador).`);return id;}
 const now=new Date().toISOString();await db.insert(whatsappDeliveries).values({id,companyId,kind,destination:chatDestination(destination),payload,bookingId,dueAt,createdAt:now,updatedAt:now}).onConflictDoNothing();return id;
}
/**
 * Passa a conversa para a equipe. `pause:false` (pedido fora do horário humano) só deixa o recado:
 * a equipe é avisada, mas o bot continua atendendo reservas.
 */
export async function handoff(companyId:string,phone:string,reason:string,summary:string,{pause=true}:{pause?:boolean}={}){
 const now=new Date().toISOString(),awaitingTeam={at:now,reason:reason.slice(0,200),summary:summary.slice(0,700)};
 await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}),hashtext(${phone}))`);
  const prior=(await tx.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,companyId),eq(whatsappConversations.phone,phone))).limit(1))[0];
  if(prior?.step==='human')return;
  if(pause)await tx.insert(whatsappConversations).values({companyId,phone,step:'human',context:{handoffReason:reason.slice(0,200),handoffSummary:summary.slice(0,700),awaitingTeam},updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{step:'human',context:{handoffReason:reason.slice(0,200),handoffSummary:summary.slice(0,700),awaitingTeam},updatedAt:now}});
  else await tx.insert(whatsappConversations).values({companyId,phone,step:'',context:{awaitingTeam},updatedAt:now}).onConflictDoUpdate({target:[whatsappConversations.companyId,whatsappConversations.phone],set:{context:sql`${whatsappConversations.context} || ${JSON.stringify({awaitingTeam})}::jsonb`,updatedAt:now}});
  const settings=(await tx.select().from(integrationSettings).where(and(eq(integrationSettings.companyId,companyId),eq(integrationSettings.provider,'whatsapp_services'))).limit(1))[0]?.settings as ServiceSettings|undefined;
  if(isSimulating()){simulationNote('note',pause?`Aqui a equipe seria chamada (${reason.slice(0,200)}). O bot fica pausado nesta conversa.`:`Fora do horário humano: a equipe seria avisada (${reason.slice(0,200)}), e o bot continua atendendo.`);return;}
  if(settings?.groupEnabled&&settings.groupId&&settings.events.includes('handoff')){
   const base=(process.env.APP_BASE_URL||'').replace(/\/$/,'');
   await tx.insert(whatsappDeliveries).values({id:randomUUID(),companyId,kind:'handoff',destination:settings.groupId,payload:{text:`Atendimento humano solicitado${pause?'':' (fora do horário; o bot segue atendendo)'}\nContato: ${phone}\nMotivo: ${reason.slice(0,200)}\nResumo: ${summary.slice(0,700)}\n${base}/whatsapp?phone=${encodeURIComponent(phone)}`},dueAt:now,createdAt:now,updatedAt:now});
  }
 });
}
export async function ownBookings(companyId:string,phone:string){
 const bot=await integration(companyId,'whatsapp_bot');if(!bot.timeZone)throw fail(409,'A equipe precisa configurar o fuso da arena.');
 const list=await db.select({booking:bookings,quadra:courts.name}).from(bookings).innerJoin(courts,eq(courts.id,bookings.courtId)).where(and(eq(bookings.companyId,companyId),eq(bookings.customerPhone,phone),sql`${bookings.status} IN ('pending','confirmed')`)).orderBy(bookings.startAt);
 return list.filter(r=>bookingInstant(r.booking.startAt,bot.timeZone)>Date.now()).slice(0,30).map(r=>({id:r.booking.id,quadra:r.quadra,inicio:r.booking.startAt,fim:r.booking.endAt,status:r.booking.status}));
}
export async function prepareCancellation(companyId:string,phone:string,id:string){
 const row=(await ownBookings(companyId,phone)).find(r=>r.id===id);if(!row)throw fail(404,'Não encontrei essa reserva entre os seus próximos horários.');
 const company=(await db.select().from(companies).where(eq(companies.id,companyId)).limit(1))[0]!;
 const bot=await integration(companyId,'whatsapp_bot');
 if(!cancellationAllowed(row.status,row.inicio,bot.timeZone,company.cancellationHours))return {manual:true,mensagem:`O prazo de cancelamento é de ${company.cancellationHours} horas antes do jogo. Vou encaminhar para a equipe analisar.`};
 const paid=(await db.select().from(financeEntries).where(and(eq(financeEntries.companyId,companyId),eq(financeEntries.bookingId,id),sql`${financeEntries.paidAt} IS NOT NULL`)).limit(1))[0];
 return {manual:false,id,resumo:`Cancelar ${row.quadra}, dia ${row.inicio.slice(0,10).split('-').reverse().join('/')}, das ${row.inicio.slice(11,16)} às ${row.fim.slice(11,16)}?${paid?' O pagamento já recebido será analisado pela equipe para eventual estorno.':''}\nConfirma o cancelamento?`,createdAt:new Date().toISOString()};
}
export async function cancelOwnBooking(companyId:string,phone:string,id:string){
 const bot=await integration(companyId,'whatsapp_bot');
 return db.transaction(async tx=>{
  const row=(await tx.select().from(bookings).where(and(eq(bookings.id,id),eq(bookings.companyId,companyId),eq(bookings.customerPhone,phone))).for('update'))[0];
  if(!row)throw fail(404,'Reserva não encontrada.');if(row.status==='cancelled')return {cancelled:true,already:true};
  const company=(await tx.select().from(companies).where(eq(companies.id,companyId)).limit(1))[0]!;
  if(!cancellationAllowed(row.status,row.startAt,bot.timeZone,company.cancellationHours))throw fail(409,'O prazo ou a situação da reserva mudou. A equipe precisa analisar o cancelamento.');
  const now=new Date().toISOString();
  await tx.update(bookings).set({status:'cancelled',cancelReason:'Solicitado pelo cliente no WhatsApp',updatedAt:now}).where(eq(bookings.id,id));
  await tx.insert(bookingEvents).values({id:randomUUID(),companyId,bookingId:id,event:'cancelled',details:{source:'whatsapp',phone},createdAt:now});
  await tx.insert(appAudit).values({id:randomUUID(),companyId,action:'whatsapp.booking.cancelled',entity:'booking',entityId:id,details:{phone},createdAt:now});
  await tx.update(whatsappDeliveries).set({status:'skipped',updatedAt:now}).where(and(eq(whatsappDeliveries.bookingId,id),eq(whatsappDeliveries.kind,'review'),eq(whatsappDeliveries.status,'pending')));
  return {cancelled:true,already:false};
 });
}
export async function queueCourtPhotos(companyId:string,phone:string,courtId:string,requestId:string){
 const court=(await db.select().from(courts).where(and(eq(courts.id,courtId),eq(courts.companyId,companyId),eq(courts.active,true))).limit(1))[0];if(!court)throw fail(404,'Quadra não encontrada.');
 if(!court.photos.length)return {enviadas:0,mensagem:'Essa quadra ainda não tem fotos cadastradas.'};
 if(isSimulating()){for(const url of court.photos)simulationNote('note',`Foto enviada: ${url}`);return {enviadas:court.photos.length,mensagem:`${court.photos.length} foto(s) da ${court.name} enviada(s).`};}
 const ids=[];for(const [index,url] of court.photos.entries())ids.push(await enqueueDelivery(companyId,'photo',phone,{url,caption:court.name},`photo:${createHash('sha256').update(`${companyId}:${phone}:${requestId}:${court.id}:${index}`).digest('hex')}`));
 return {agendadas:ids.length,ids};
}
export async function localPhoto(companyId:string,url:string){
 const folder=createHash('sha256').update(companyId).digest('hex').slice(0,32);
 const match=url.match(/^\/api\/arena\/media\/([a-f0-9]{32})\/([a-f0-9-]{36}\.webp)$/);
 if(!match||match[1]!==folder)throw new Error('Foto não pertence à arena.');
 const image=await readFile(join(process.env.ARENA_MEDIA_DIR||'/data/media',folder,match[2]!));
 if(image.length>6*1024*1024)throw new Error('Imagem muito grande.');
 return (await sharp(image,{limitInputPixels:30000000}).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()).toString('base64');
}
export async function registerWhatsAppServiceRoutes(app:FastifyInstance){
 const auth={preHandler:app.authenticate};
 app.get('/api/whatsapp/services',auth,async req=>{const id=companyOf(req);return {settings:await serviceSettings(id),arena:await arenaInformation(id),courts:await db.select({id:courts.id,name:courts.name,photos:courts.photos}).from(courts).where(eq(courts.companyId,id)).orderBy(courts.name)};});
 app.put('/api/whatsapp/services',auth,async req=>{
  adminOf(req);const id=companyOf(req),body=req.body as Record<string,any>,before=await serviceSettings(id),raw=body.settings||{},arena=body.arena||{};
  const settings:ServiceSettings={...before,groupId:String(raw.groupId||''),groupEnabled:raw.groupEnabled===true,events:Array.isArray(raw.events)?raw.events.filter((v:unknown)=>serviceDefaults.events.includes(String(v))):[],reviewEnabled:raw.reviewEnabled===true,reviewDelayMinutes:Number(raw.reviewDelayMinutes),reviewMessage:String(raw.reviewMessage||'').trim(),manualResumeOnly:raw.manualResumeOnly!==false};
  if(settings.groupId&&!/^\d+(?:-\d+)?@g\.us$/.test(settings.groupId))throw fail(400,'Selecione um grupo válido.');
  if(settings.groupEnabled&&!settings.groupId)throw fail(400,'Selecione o grupo de avisos.');
  if(!Number.isInteger(settings.reviewDelayMinutes)||settings.reviewDelayMinutes<0||settings.reviewDelayMinutes>1440)throw fail(400,'Use um intervalo entre 0 e 1440 minutos.');
  if(settings.reviewMessage.length>1200||!settings.reviewMessage.includes('{review_link}'))throw fail(400,'A mensagem deve conter {review_link} e até 1200 caracteres.');
  let links;try{links={mapsUrl:safePublicLink(arena.mapsUrl,'maps'),instagramUrl:safePublicLink(arena.instagramUrl,'instagram'),reviewUrl:safePublicLink(arena.reviewUrl,'review')};}catch(e){throw fail(400,(e as Error).message);}
  if(settings.reviewEnabled&&!links.reviewUrl)throw fail(400,'Cadastre o link de avaliação do Google.');
  if(settings.reviewEnabled&&!(await integration(id,'whatsapp_bot')).timeZone)throw fail(400,'Configure o fuso horário antes de ativar avaliações.');
  if(settings.groupEnabled&&(!before.groupEnabled||settings.groupId!==before.groupId))await wahaRequest(id,`/api/{session}/groups/${encodeURIComponent(settings.groupId)}`);
  if(settings.reviewEnabled&&!before.reviewEnabled)settings.reviewEnabledAt=new Date().toISOString();
  const address:Record<string,string>={};for(const key of ['address','addressNumber','district','city','state']){address[key]=String(arena[key]||'').trim();if(address[key]!.length>180)throw fail(400,'Confira o endereço da arena.');}
  if(!address.address||!address.city||!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(address.state||''))throw fail(400,'Confira endereço, cidade e UF.');
  await db.transaction(async tx=>{
   const current=(await tx.select().from(companies).where(eq(companies.id,id)).for('update'))[0]!;
   await tx.update(companies).set({...address,publicOptions:{...current.publicOptions,contactLinks:links}}).where(eq(companies.id,id));
   const now=new Date().toISOString();await tx.insert(integrationSettings).values({companyId:id,provider:'whatsapp_services',settings,updatedAt:now}).onConflictDoUpdate({target:[integrationSettings.companyId,integrationSettings.provider],set:{settings,updatedAt:now}});
  });return {ok:true};
 });
 app.put('/api/whatsapp/courts/:id/photos',auth,async req=>{
  adminOf(req);const companyId=companyOf(req),id=(req.params as {id:string}).id,photos=(req.body as {photos?:unknown}).photos;
  const folder=createHash('sha256').update(companyId).digest('hex').slice(0,32);
  if(!Array.isArray(photos)||photos.length>6||photos.some(p=>typeof p!=='string'||!new RegExp(`^/api/arena/media/${folder}/[a-f0-9-]{36}\\.webp$`).test(p)))throw fail(400,'Envie até seis fotos pela galeria desta arena.');
  const updated=await db.update(courts).set({photos:[...new Set(photos)],photoUrl:photos[0]||null}).where(and(eq(courts.id,id),eq(courts.companyId,companyId))).returning({id:courts.id});if(!updated.length)throw fail(404,'Quadra não encontrada.');return {ok:true};
 });
 app.get('/api/whatsapp/groups',auth,async req=>{adminOf(req);const page=Math.max(0,Math.min(1000,Number((req.query as {page?:string}).page)||0));const data=await wahaRequest(companyOf(req),`/api/{session}/groups?limit=50&offset=${page*50}&exclude=participants`);const list=Array.isArray(data)?data:Array.isArray(data.groups)?data.groups:Object.values(data);return {groups:list.map((g:any)=>({id:typeof g.id==='string'?g.id:g.id?._serialized,name:g.subject||g.name||g.id})).filter((g:any)=>/^\d+(?:-\d+)?@g\.us$/.test(g.id)),hasMore:list.length===50};});
 app.post('/api/whatsapp/groups', {...auth,config:{rateLimit:{max:3,timeWindow:60000}}},async req=>{adminOf(req);const body=req.body as {name?:string;participants?:string[]};const name=String(body.name||'').trim();if(name.length<3||name.length>80||!Array.isArray(body.participants)||!body.participants.length||body.participants.length>30||body.participants.some(p=>!/^\d{10,15}$/.test(p)))throw fail(400,'Informe o nome do grupo e de 1 a 30 telefones com DDI e DDD.');const result=await wahaRequest(companyOf(req),'/api/{session}/groups',{name,participants:[...new Set(body.participants)].map(p=>({id:`${p}@c.us`}))});const id=typeof result.id==='string'?result.id:result.id?._serialized;if(!/^\d+(?:-\d+)?@g\.us$/.test(id||''))throw fail(422,'Confira no WhatsApp se o grupo foi criado e atualize a lista antes de tentar novamente.');return {id,name};});
 app.get('/api/whatsapp/deliveries',auth,async req=>({deliveries:await db.select({id:whatsappDeliveries.id,kind:whatsappDeliveries.kind,status:whatsappDeliveries.status,createdAt:whatsappDeliveries.createdAt,error:whatsappDeliveries.error}).from(whatsappDeliveries).where(eq(whatsappDeliveries.companyId,companyOf(req))).orderBy(desc(whatsappDeliveries.createdAt)).limit(30)}));
}
