import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Sql } from './db.js';
import { ApiError } from './security.js';

export const LEGACY_BRANCH='00000000-0000-4000-8000-000000000016';
export type BranchScope={ ids:string[]; write:boolean; master:boolean; actorId?:string };
const storage=new AsyncLocalStorage<BranchScope>();
export const branchScope=()=>storage.getStore();
export const inBranch=<T>(scope:BranchScope,work:()=>T):T=>storage.run(scope,work);
const wrapped=new WeakMap<Database,Database>();
export function branchDatabase(db:Database):Database {
  const previous=wrapped.get(db);if(previous)return previous;
  const setup=async(sql:Sql,scope:BranchScope)=>{
    const branches=await sql.query(`SELECT b.id FROM branches b WHERE b.id=ANY($1::uuid[]) AND (NOT $2::boolean OR b.is_active) FOR SHARE`,[scope.ids,scope.write]);
    if(branches.rows.length!==scope.ids.length)throw new ApiError(403,'BRANCH_INACTIVE');
    if(scope.actorId){
      const actor=(await sql.query(`SELECT u.role FROM users u WHERE u.id=$1 AND u.is_active AND (u.role='owner' OR NOT EXISTS(
        SELECT 1 FROM unnest($2::uuid[]) id WHERE NOT EXISTS(SELECT 1 FROM user_branches m WHERE m.user_id=u.id AND m.branch_id=id))) FOR SHARE`,[scope.actorId,scope.ids])).rows[0];
      if(!actor)throw new ApiError(403,'BRANCH_FORBIDDEN');
      if(scope.master&&actor.role!=='owner')throw new ApiError(403,'FORBIDDEN');
    }
    await sql.query("SELECT set_config('coffee.branch_ids',$1,true),set_config('coffee.branch_write',$2,true),set_config('coffee.master_write',$3,true)",
      [scope.ids.join(','),scope.write?'on':'off',scope.master?'on':'off']);
    await sql.query('SET LOCAL ROLE coffee_branch_runtime');
  };
  const result:Database={
    query:async(text,values)=>{
      const scope=storage.getStore();if(!scope)return db.query(text,values);
      return db.transaction(async sql=>{await setup(sql,scope);return sql.query(text,values);});
    },
    transaction:async work=>{
      const scope=storage.getStore();
      return db.transaction(async sql=>{if(scope)await setup(sql,scope);return work(sql);});
    },
  };
  wrapped.set(db,result);wrapped.set(result,result);return result;
}
