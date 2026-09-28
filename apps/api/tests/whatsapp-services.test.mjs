import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,createCipheriv,randomBytes} from 'node:crypto';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import sharp from 'sharp';
import Fastify from 'fastify';
import {bookingInstant,cancellationAllowed,chatDestination,safePublicLink,serviceDefaults} from '../dist/whatsapp-service-rules.js';
import {db,client} from '../dist/database.js';
import {companies,courts,bookings,integrationSettings,whatsappDeliveries,whatsappConversations,whatsappMessages,financeEntries,users} from '@quadrasflow/database';
import {eq,and} from 'drizzle-orm';
import {registerWhatsAppServiceRoutes,prepareCancellation,cancelOwnBooking,ownBookings,handoff,queueCourtPhotos,enqueueDelivery} from '../dist/whatsapp-services.js';
import {scheduleReviews,deliverOne,processWhatsAppDeliveries} from '../dist/whatsapp-delivery-worker.js';
import {processExpiredWhatsAppPix} from '../dist/mercadopago.js';
import {handleIncoming,registerWhatsAppRoutes} from '../dist/whatsapp.js';

if(!process.env.DATABASE_URL?.includes('quadrasflow_test'))throw new Error('Only disposable test DB allowed');
const id='arena-service-test',other='arena-other',phone='5594999999999',group='120363000000000@g.us';
const settings={...serviceDefaults,groupEnabled:true,groupId:group,reviewEnabled:true,reviewEnabledAt:new Date(Date.now()-3600000).toISOString()};
const sent=[];let network='ok';let aiCalls=[];const mpStatuses=new Map();
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{
 if(String(url).startsWith('https://api.mercadopago.com/v1/payments/'))return Response.json(mpStatuses.get(String(url).split('/').at(-1))||{});
 if(String(url).startsWith('https://api.openai.com/')){const call=aiCalls.shift();assert.ok(call,'Unexpected AI call');return Response.json({choices:[{message:call}]});}
 assert.ok(String(url).startsWith('http://waha-test/'),'No live external calls');
 if(network==='timeout')throw new Error('timeout');if(network==='429')return new Response('{}',{status:429});
 if(init.method==='POST')sent.push(JSON.parse(init.body));
 return Response.json({id:group});
};
process.env.WAHA_BASE_URL='http://waha-test';process.env.WAHA_API_KEY='test-only';process.env.WAHA_WEBHOOK_SECRET='test-only-secret';process.env.OPENAI_API_KEY='test-only';process.env.ARENA_MEDIA_DIR='/tmp/quadrasflow-services-test-media';process.env.MERCADOPAGO_ENCRYPTION_KEY='11'.repeat(32);
function encryptTest(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(process.env.MERCADOPAGO_ENCRYPTION_KEY,'hex'),iv),data=Buffer.concat([cipher.update(value),cipher.final()]);return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${data.toString('hex')}`;}
const now=()=>new Date().toISOString();
async function config(provider,value,companyId=id){await db.insert(integrationSettings).values({companyId,provider,settings:value,updatedAt:now()}).onConflictDoUpdate({target:[integrationSettings.companyId,integrationSettings.provider],set:{settings:value,updatedAt:now()}});}
async function booking(extra={}){const r={id:randomUUID(),companyId:id,courtId:'court-service',customerName:'Cliente teste',customerPhone:phone,startAt:new Date(Date.now()+3*86400000).toISOString(),endAt:new Date(Date.now()+3*86400000+3600000).toISOString(),status:'confirmed',source:'staff',amountCents:10000,createdAt:now(),updatedAt:now(),...extra};await db.insert(bookings).values(r);return r;}
async function status(deliveryId){return (await db.select().from(whatsappDeliveries).where(eq(whatsappDeliveries.id,deliveryId)))[0];}
async function clearConversation(){await db.delete(whatsappConversations).where(and(eq(whatsappConversations.companyId,id),eq(whatsappConversations.phone,phone)));}
const app=Fastify();app.decorate('authenticate',async req=>{if(req.headers.authorization!=='test')throw Object.assign(new Error('Unauthorized'),{statusCode:401});req.user={id:'admin',role:req.headers['x-test-role']||'arena_admin',company:{id},setupNeeded:false};});await registerWhatsAppServiceRoutes(app);await registerWhatsAppRoutes(app);await app.ready();

await test('WhatsApp services integration',async t=>{
 await db.delete(companies).where(eq(companies.id,id));await db.delete(companies).where(eq(companies.id,other));
 await db.insert(companies).values([{id,name:'Arena Teste',slug:id,createdAt:now(),address:'Rua teste',city:'Parauapebas',state:'PA',publicOptions:{contactLinks:{reviewUrl:'https://g.page/r/test/review'}}},{id:other,name:'Outra Arena',slug:other,createdAt:now()}]);
 await db.insert(users).values({id:'admin',companyId:id,name:'Test Admin',email:'admin@example.test',passwordHash:'test-only',passwordSalt:'test-only',role:'arena_admin',createdAt:now()});
 await db.insert(courts).values([{id:'court-service',companyId:id,name:'Society 2',sport:'Society',createdAt:now()},{id:'court-other',companyId:other,name:'Outra quadra',sport:'Society',createdAt:now()}]);
 await config('whatsapp_bot',{timeZone:'America/Belem'},other);await config('whatsapp_services',settings);await config('whatsapp_bot',{timeZone:'America/Belem',enabled:true,testMode:false});await config('waha',{session:'arena',enabled:true});
 await t.test('wall times, group destination, URL validation',()=>{
  assert.equal(new Date(bookingInstant('2026-09-28T21:00:00.000Z','America/Belem')).toISOString(),'2026-09-29T00:00:00.000Z');
  assert.equal(chatDestination(group),group);assert.throws(()=>chatDestination('x@g.us'));
  assert.throws(()=>safePublicLink('https://google.com.evil.example/','maps'));assert.throws(()=>safePublicLink('javascript:alert(1)','review'));
  assert.equal(safePublicLink('https://instagram.com/arena/','instagram'),'https://instagram.com/arena/');
  assert.equal(cancellationAllowed('cancelled','2026-09-28T21:00:00Z','America/Belem',24,0),false);
 });
 await t.test('API auth, settings persistence and invalid configuration',async()=>{
  assert.equal((await app.inject({url:'/api/whatsapp/services'})).statusCode,401);
  const read=await app.inject({url:'/api/whatsapp/services',headers:{authorization:'test'}});assert.equal(read.statusCode,200);
  const payload=read.json();assert.equal(payload.arena.city,'Parauapebas');
  assert.equal((await app.inject({method:'PUT',url:'/api/whatsapp/services',headers:{authorization:'test','x-test-role':'staff'},payload})).statusCode,403);
  payload.arena.instagramUrl='https://instagram.com/arena/';
  assert.equal((await app.inject({method:'PUT',url:'/api/whatsapp/services',headers:{authorization:'test'},payload})).statusCode,200);
  payload.arena.mapsUrl='https://evil.example/';assert.equal((await app.inject({method:'PUT',url:'/api/whatsapp/services',headers:{authorization:'test'},payload})).statusCode,400);
 });
 await t.test('group management is scoped and only creates the selected WhatsApp group',async()=>{
  const created=await app.inject({method:'POST',url:'/api/whatsapp/groups',headers:{authorization:'test'},payload:{name:'Equipe teste',participants:['5594991112222','5594993334444']}});
  assert.equal(created.statusCode,200);assert.equal(created.json().id,group);
  const invalid=await app.inject({method:'POST',url:'/api/whatsapp/groups',headers:{authorization:'test'},payload:{name:'x',participants:['bad']}});assert.equal(invalid.statusCode,400);
 });
 await t.test('booking events cover staff creation; concurrent worker does not repeat',async()=>{
  const b=await booking();const jobs=await db.select().from(whatsappDeliveries).where(eq(whatsappDeliveries.bookingId,b.id));assert.equal(jobs.length,1);assert.equal(jobs[0].destination,group);
  const before=sent.length;await Promise.all([deliverOne(jobs[0].id),deliverOne(jobs[0].id)]);assert.equal(sent.length,before+1);assert.equal(sent.at(-1).chatId,group);
 });
 await t.test('cancellation ownership, deadline and double confirmation',async()=>{
  const b=await booking();assert.ok((await ownBookings(id,phone)).some(r=>r.id===b.id));assert.equal((await ownBookings(other,phone)).length,0);
  await assert.rejects(prepareCancellation(other,phone,b.id));await assert.rejects(cancelOwnBooking(id,'5511000000000',b.id));
  const preview=await prepareCancellation(id,phone,b.id);assert.equal(preview.manual,false);
  await Promise.all([cancelOwnBooking(id,phone,b.id),cancelOwnBooking(id,phone,b.id)]);
  assert.equal((await db.select().from(bookings).where(eq(bookings.id,b.id)))[0].status,'cancelled');
  const jobs=await db.select().from(whatsappDeliveries).where(and(eq(whatsappDeliveries.bookingId,b.id),eq(whatsappDeliveries.kind,'cancelled')));assert.equal(jobs.length,1);
  const close=await booking({startAt:new Date(Date.now()).toISOString()});assert.equal((await prepareCancellation(id,phone,close.id)).manual,true);
 });
 await t.test('Pix only expires when Mercado Pago confirms a final unpaid state',async()=>{
  const pending=await booking({status:'pending'}),paid=await booking({status:'pending'});
  await config('mercadopago',{connected:true,user_id:'seller-test',access_token:encryptTest('mock-token'),expires_at:new Date(Date.now()+3600000).toISOString()});
  const charge=(b,paymentId)=>({paymentId,amountCents:10000,totalAmountCents:10000,arenaName:'Arena Teste',courtName:'Society 2',expiresAt:new Date(Date.now()-1000).toISOString(),createdAt:now()});
  await config('mp_pix',{[pending.id]:charge(pending,'expired-test'),[paid.id]:charge(paid,'paid-test')});
  mpStatuses.set('expired-test',{id:'expired-test',external_reference:pending.id,currency_id:'BRL',status:'cancelled'});
  mpStatuses.set('paid-test',{id:'paid-test',external_reference:paid.id,currency_id:'BRL',status:'approved'});
  await processExpiredWhatsAppPix();
  assert.equal((await db.select().from(bookings).where(eq(bookings.id,pending.id)))[0].status,'cancelled');
  assert.match((await db.select().from(bookings).where(eq(bookings.id,pending.id)))[0].cancelReason,/pix-expired/);
  assert.equal((await db.select().from(bookings).where(eq(bookings.id,paid.id)))[0].status,'pending');
  const alerts=await db.select().from(whatsappDeliveries).where(eq(whatsappDeliveries.id,`pix-expired:${pending.id}`));assert.equal(alerts.length,1);assert.equal(alerts[0].destination,phone+'@c.us');
  const groups=await db.select().from(whatsappDeliveries).where(and(eq(whatsappDeliveries.bookingId,pending.id),eq(whatsappDeliveries.kind,'expired'),eq(whatsappDeliveries.destination,group)));assert.equal(groups.length,1);assert.equal(groups[0].destination,group);
  await processExpiredWhatsAppPix();assert.equal((await db.select().from(whatsappDeliveries).where(eq(whatsappDeliveries.id,`pix-expired:${pending.id}`))).length,1);
 });
 await t.test('handoff persists once, alerts group and menu cannot resume manual conversation',async()=>{
  await clearConversation();await Promise.all([handoff(id,phone,'Pedido do cliente','Quer conversar'),handoff(id,phone,'Pedido do cliente','Quer conversar')]);
  const jobs=await db.select().from(whatsappDeliveries).where(eq(whatsappDeliveries.kind,'handoff'));assert.equal(jobs.length,1);
  const before=sent.length;await handleIncoming({id,name:'Arena Teste'},'arena',{from:phone+'@c.us',body:'menu'});assert.equal(sent.length,before);
  assert.equal((await db.select().from(whatsappConversations).where(eq(whatsappConversations.phone,phone)))[0].step,'human');
  const resumed=await app.inject({method:'PATCH',url:`/api/whatsapp/conversations/${phone}/resume`,headers:{authorization:'test'}});assert.equal(resumed.statusCode,200,resumed.body);assert.equal((await db.select().from(whatsappConversations).where(eq(whatsappConversations.phone,phone)))[0].step,'');
 });
 await t.test('review is after END in arena zone, one per booking, cancel suppresses delivery',async()=>{
  const wall=new Date(Date.now()-3*3600000-30*60000).toISOString();const b=await booking({endAt:wall});
  await scheduleReviews();await scheduleReviews();assert.ok(await status('review:'+b.id));
  const before=sent.length;await deliverOne('review:'+b.id);assert.equal(sent.length,before+1);assert.ok(sent.at(-1).text.includes('https://g.page/r/test/review'));
  await scheduleReviews();await deliverOne('review:'+b.id);assert.equal(sent.length,before+1);
  const canceled=await booking({endAt:wall});await scheduleReviews(Date.now()+6*60000);await db.update(bookings).set({status:'cancelled'}).where(eq(bookings.id,canceled.id));await deliverOne('review:'+canceled.id);assert.equal((await status('review:'+canceled.id)).status,'skipped');
  const old=await booking({endAt:new Date(Date.now()-3*3600000-2*86400000).toISOString()});await scheduleReviews(Date.now()+12*60000);assert.equal(await status('review:'+old.id),undefined);
 });
 await t.test('photos validate owner, send media and deduplicate repeated request',async()=>{
  const folder=createHash('sha256').update(id).digest('hex').slice(0,32),filename=randomUUID()+'.webp',url=`/api/arena/media/${folder}/${filename}`;
  await mkdir(`${process.env.ARENA_MEDIA_DIR}/${folder}`,{recursive:true});await writeFile(`${process.env.ARENA_MEDIA_DIR}/${folder}/${filename}`,await sharp({create:{width:10,height:10,channels:3,background:'#008844'}}).webp().toBuffer());
  assert.equal((await app.inject({method:'PUT',url:'/api/whatsapp/courts/court-other/photos',headers:{authorization:'test'},payload:{photos:[url]}})).statusCode,404);
  assert.equal((await app.inject({method:'PUT',url:'/api/whatsapp/courts/court-service/photos',headers:{authorization:'test'},payload:{photos:[url]}})).statusCode,200);
  const one=await queueCourtPhotos(id,phone,'court-service','request-1');const two=await queueCourtPhotos(id,phone,'court-service','request-1');assert.deepEqual(one.ids,two.ids);await deliverOne(one.ids[0]);assert.equal(sent.at(-1).file.mimetype,'image/jpeg');assert.equal((await status(one.ids[0])).status,'sent');
 });
 await t.test('uncertain dispatch is not retried; known rate limit is retried',async()=>{
  const uncertain=await enqueueDelivery(id,'photo',phone,{url:'bad'});await deliverOne(uncertain);assert.equal((await status(uncertain)).status,'pending');
  const a=await enqueueDelivery(id,'handoff',group,{text:'Teste'});network='timeout';await deliverOne(a);assert.equal((await status(a)).status,'unknown');
  const b=await enqueueDelivery(id,'handoff',group,{text:'Teste'});network='429';await deliverOne(b);assert.equal((await status(b)).status,'pending');network='ok';
 });
 await t.test('agent cancellation tools ask confirmation then cancel, not booking reset',async()=>{
  await clearConversation();const b=await booking();
  aiCalls=[{tool_calls:[{id:'call1',function:{name:'preparar_cancelamento',arguments:JSON.stringify({reserva_id:b.id})}}]}];
  await handleIncoming({id,name:'Arena Teste'},'arena',{id:'msg-1',from:phone+'@c.us',body:'Quero cancelar minha reserva'});
  assert.match(sent.at(-1).text,/Confirma o cancelamento/);
  await handleIncoming({id,name:'Arena Teste'},'arena',{id:'msg-2',from:phone+'@c.us',body:'sim'});
  assert.match(sent.at(-1).text,/Sua reserva foi cancelada/);assert.equal((await db.select().from(bookings).where(eq(bookings.id,b.id)))[0].status,'cancelled');
 });
 await t.test('agent uses registered info and out of scope handoff',async()=>{
  await clearConversation();aiCalls=[{tool_calls:[{id:'info',function:{name:'consultar_informacoes_arena',arguments:'{}'}}]},{content:'Estamos na Rua teste, Parauapebas.'}];
  await handleIncoming({id,name:'Arena Teste'},'arena',{from:phone+'@c.us',body:'Onde vocês ficam?'});assert.match(sent.at(-1).text,/Rua teste/);
  aiCalls=[{tool_calls:[{id:'human',function:{name:'chamar_atendente',arguments:JSON.stringify({motivo:'Fora do escopo',resumo:'Pergunta geral'})}}]}];
  await handleIncoming({id,name:'Arena Teste'},'arena',{from:phone+'@c.us',body:'Explique física nuclear'});
  assert.equal((await db.select().from(whatsappConversations).where(eq(whatsappConversations.phone,phone)))[0].step,'human');
  const resumed=await app.inject({method:'PATCH',url:`/api/whatsapp/conversations/${phone}/resume`,headers:{authorization:'test'}});assert.equal(resumed.statusCode,200,resumed.body);assert.equal((await db.select().from(whatsappConversations).where(eq(whatsappConversations.phone,phone)))[0].step,'');
 });
 await t.test('incoming group messages never reach the agent or persistence',async()=>{
  await clearConversation();const before=sent.length;
  await handleIncoming({id,name:'Arena Teste'},'arena',{from:phone+'@c.us',body:'Quero reservar para hoje',_data:{Info:{Chat:group,IsGroup:true}}});
  assert.equal(sent.length,before);assert.equal(aiCalls.length,0);
  const groupPayloads=[
   {id:'group-jid-event',from:group,fromMe:false,body:'Quero reservar para hoje'},
   {id:'group-metadata-event',from:phone+'@c.us',fromMe:false,body:'Quero reservar para hoje',_data:{Info:{Chat:group,IsGroup:true}}},
   {id:'group-remote-jid-event',from:phone+'@c.us',fromMe:false,body:'Quero reservar para hoje',_data:{key:{remoteJid:group}}},
  ];
  for(const payload of groupPayloads){const response=await app.inject({method:'POST',url:`/api/webhooks/waha/${id}`,headers:{'x-quadrasflow-secret':process.env.WAHA_WEBHOOK_SECRET},payload:{event:'message',id:payload.id,session:'arena',payload}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().reason,'private_chats_only');}
  assert.equal(sent.length,before);assert.equal(aiCalls.length,0);
  assert.equal((await db.select().from(whatsappMessages).where(eq(whatsappMessages.companyId,id))).filter(row=>groupPayloads.some(item=>row.eventId===item.id)).length,0);
  assert.equal((await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.companyId,id),eq(whatsappConversations.phone,phone)))).length,0);
 });
});
await app.close();globalThis.fetch=realFetch;await client.end();await rm(process.env.ARENA_MEDIA_DIR,{recursive:true,force:true});
