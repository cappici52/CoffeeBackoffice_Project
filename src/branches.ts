import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from './db.js';
import { ApiError, type User } from './security.js';
import { inBranch } from './branch-context.js';
import { fail, idSchema, record } from './shop/shared.js';

export async function authorizedBranches(db:Database,user:User) {
  return (await db.query(`SELECT b.* FROM branches b WHERE $1='owner' OR EXISTS(
    SELECT 1 FROM user_branches u WHERE u.branch_id=b.id AND u.user_id=$2) ORDER BY b.is_legacy DESC,b.code`,[user.role,user.id])).rows;
}
export function branchMiddleware(db:Database):RequestHandler {
  return async(req,res,next)=>{
    const user=res.locals.user as User;
    const branches=await authorizedBranches(db,user);
    const requested=req.get('X-Branch-Id') ?? (typeof req.query.branch_id==='string'?req.query.branch_id:undefined);
    // EventSource cannot set a header. Remove its scope parameter before strict route validation.
    if(req.query.branch_id!==undefined) {
      const url=new URL(req.url,'http://local');url.searchParams.delete('branch_id');req.url=url.pathname+url.search;
    }
    const all=requested==='all';
    fail(!all||['owner','manager'].includes(user.role),403,'BRANCH_FORBIDDEN');
    const branch=all?null:branches.find(b=>b.id===(requested??branches.find(b=>b.is_active)?.id));
    fail(all?branches.length:branch,403,'BRANCH_FORBIDDEN');
    if(branch&&!branch.is_active)fail(['GET','HEAD'].includes(req.method)&&['owner','manager'].includes(user.role),403,'BRANCH_INACTIVE');
    const aggregatePaths=['/reports','/ingredients','/stock-movements','/shop-context','/audit-logs'];
    if(all)fail(['GET','HEAD'].includes(req.method)&&aggregatePaths.some(p=>req.path===p||req.path.startsWith(p+'/')),400,'SELECT_SINGLE_BRANCH');
    res.locals.branch=branch;res.locals.branchIds=all?branches.map(b=>b.id):[branch!.id];
    inBranch({ids:res.locals.branchIds,write:!all&&Boolean(branch?.is_active),master:!all&&user.role==='owner',actorId:user.id},next);
  };
}
const fields=z.object({name:z.string().trim().min(1).max(120),code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
  address:z.string().trim().max(1000).default(''),phone:z.string().trim().max(50).default(''),is_active:z.boolean().default(true)}).strict();
export function branchesRouter(db:Database,auth:RequestHandler,owner:RequestHandler) {
  const r=Router();r.use('/branches',auth);
  r.get('/branches',async(_req,res)=>res.json({branches:await authorizedBranches(db,res.locals.user),can_manage:res.locals.user.role==='owner',can_aggregate:['owner','manager'].includes(res.locals.user.role)}));
  r.post('/branches',owner,async(req,res)=>{
    const p=fields.parse(req.body),id=randomUUID();
    await db.transaction(async sql=>{
      await sql.query('INSERT INTO branches(id,name,code,address,phone,is_active) VALUES($1,$2,$3,$4,$5,$6)',[id,p.name,p.code,p.address,p.phone,p.is_active]);
      await record(sql,res.locals.user,'branch.created','branch',id,p);
    });res.status(201).json({id});
  });
  r.patch('/branches/:id',owner,async(req,res)=>{
    const id=idSchema.parse(req.params.id),p=fields.extend({expected_version:z.number().int().positive()}).parse(req.body);
    await db.transaction(async sql=>{
      const row=(await sql.query('UPDATE branches SET name=$1,code=$2,address=$3,phone=$4,is_active=$5,version=version+1,updated_at=now() WHERE id=$6 AND version=$7 RETURNING id',[p.name,p.code,p.address,p.phone,p.is_active,id,p.expected_version])).rows[0];
      fail(row,409,'VERSION_CONFLICT');await record(sql,res.locals.user,'branch.updated','branch',id,p);
    });res.sendStatus(204);
  });
  r.get('/branches/:id/employees',async(req,res)=>{
    const id=idSchema.parse(req.params.id);fail((await authorizedBranches(db,res.locals.user)).some(b=>b.id===id),403,'BRANCH_FORBIDDEN');
    fail(['owner','manager'].includes(res.locals.user.role),403,'FORBIDDEN');
    res.json({employees:(await db.query(`SELECT u.id,u.name,u.role,u.is_active,EXISTS(SELECT 1 FROM user_branches m WHERE m.user_id=u.id AND m.branch_id=$1) AS assigned
      FROM users u WHERE $2='owner' OR EXISTS(SELECT 1 FROM user_branches m WHERE m.user_id=u.id AND m.branch_id=$1) ORDER BY u.name`,[id,res.locals.user.role])).rows});
  });
  r.put('/branches/:id/employees/:userId',owner,async(req,res)=>{
    const branch=idSchema.parse(req.params.id),user=idSchema.parse(req.params.userId),p=z.object({assigned:z.boolean()}).strict().parse(req.body);
    await db.transaction(async sql=>{
      fail((await sql.query('SELECT id FROM branches WHERE id=$1',[branch])).rows[0],404,'NOT_FOUND');
      fail((await sql.query('SELECT id FROM users WHERE id=$1',[user])).rows[0],404,'NOT_FOUND');
      if(p.assigned)await sql.query('INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user,branch]);
      else await sql.query('DELETE FROM user_branches WHERE user_id=$1 AND branch_id=$2',[user,branch]);
      await record(sql,res.locals.user,'branch.employee_assigned','branch',branch,{user_id:user,...p});
    });res.sendStatus(204);
  });
  return r;
}
