import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { users } from '@quadrasflow/database';
import { db } from './database.js';
import { isUniqueViolation } from './db-errors.js';
import { adminOf, audit, companyOf, fail, text } from './arena.js';
const bodyOf=(req:{body?:unknown})=>(req.body||{}) as Record<string,unknown>;
export const ROLES = ['arena_admin', 'staff'] as const;

/** Dono da conta: o primeiro administrador da arena. Não pode ser rebaixado, desativado nem removido. */
async function ownerId(companyId: string) {
  const row = (await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, 'arena_admin'))).orderBy(asc(users.createdAt)).limit(1))[0];
  return row?.id;
}

/** Carrega um membro da equipe que o administrador pode alterar (não é ele mesmo nem o dono). */
async function editableMember(companyId: string, actorId: string, id: string, action: string) {
  if (id === actorId) throw fail(400, `Você não pode ${action} a sua própria conta.`);
  const row = (await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1))[0];
  if (!row) throw fail(404, 'Funcionário não encontrado.');
  if (row.id === await ownerId(companyId)) throw fail(403, 'O dono da conta não pode ser alterado.');
  return row;
}

export async function registerUserRoutes(app:FastifyInstance){const auth={preHandler:app.authenticate};
 app.get('/api/arena/users',auth,async req=>{
  const companyId=companyOf(req), owner=await ownerId(companyId);
  const list=await db.select({id:users.id,name:users.name,email:users.email,role:users.role,active:users.active,createdAt:users.createdAt,lastLoginAt:users.lastLoginAt}).from(users).where(eq(users.companyId,companyId)).orderBy(asc(users.createdAt));
  return {users:list.map(u=>({...u,created_at:u.createdAt,last_login_at:u.lastLoginAt,owner:u.id===owner}))};
 });
 // Cadastro direto com senha (fluxo antigo). A tela usa convites; a rota continua para compatibilidade.
 app.post('/api/arena/users',auth,async(req,reply)=>{const actor=adminOf(req),companyId=companyOf(req),b=bodyOf(req),name=text(b.name,'o nome do usuário'),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw fail(400,'Informe um e-mail válido.');if(password.length<8||password.length>200)throw fail(400,'A senha precisa ter pelo menos 8 caracteres.');const id=randomUUID(),salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(password,salt,64).toString('hex'),createdAt=new Date().toISOString();try{await db.insert(users).values({id,companyId,name,email,passwordHash,passwordSalt:salt,role:'staff',active:true,createdAt});}catch(e){if(isUniqueViolation(e))throw fail(409,'Esse e-mail já possui uma conta no QuadrasFlow.');throw e;}await audit(companyId,actor.id,'user.staff_created','user',id);return reply.code(201).send({user:{id,name,email,role:'staff',active:true,created_at:createdAt}});});
 app.patch('/api/arena/users/:id/status',auth,async req=>{
  const actor=adminOf(req),companyId=companyOf(req),{id}=req.params as {id:string},active=bodyOf(req).active;
  if(typeof active!=='boolean')throw fail(400,'Informe o novo estado do usuário.');
  await editableMember(companyId,actor.id,id,active?'reativar':'desativar');
  await db.update(users).set({active}).where(and(eq(users.id,id),eq(users.companyId,companyId)));
  await audit(companyId,actor.id,active?'user.activated':'user.deactivated','user',id);
  return {ok:true};
 });
 app.patch('/api/arena/users/:id/role',auth,async req=>{
  const actor=adminOf(req),companyId=companyOf(req),{id}=req.params as {id:string},role=String(bodyOf(req).role||'');
  if(!(ROLES as readonly string[]).includes(role))throw fail(400,'Papel inválido.');
  const row=await editableMember(companyId,actor.id,id,'mudar o papel da');
  await db.update(users).set({role}).where(and(eq(users.id,id),eq(users.companyId,companyId)));
  await audit(companyId,actor.id,'user.role_changed','user',id,{from:row.role,to:role});
  return {ok:true};
 });
 app.delete('/api/arena/users/:id',auth,async req=>{
  const actor=adminOf(req),companyId=companyOf(req),{id}=req.params as {id:string};
  const row=await editableMember(companyId,actor.id,id,'remover');
  // As sessões caem junto (cascade); o histórico de ações fica registrado sem o vínculo.
  await db.delete(users).where(and(eq(users.id,id),eq(users.companyId,companyId)));
  await audit(companyId,actor.id,'user.removed','user',id,{email:row.email});
  return {ok:true};
 });
}
