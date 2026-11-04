import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash,randomBytes } from 'node:crypto';
import { resolve,join } from 'node:path';
import pg from 'pg';

// Restore into a NEW verification database. No DROP, DELETE, TRUNCATE or --clean.
const file=resolve(process.argv[2]??'');
if(!file.startsWith(resolve('.local/backups')+ '\\')&&process.platform==='win32')throw new Error('Use a workspace backup');
const manifest=JSON.parse(await readFile(file+'.json','utf8'));
if(createHash('sha256').update(await readFile(file)).digest('hex')!==manifest.sha256)throw new Error('Backup hash mismatch');
const url=new URL(process.env.DATABASE_URL),database='coffee_verify_'+randomBytes(8).toString('hex');
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:database};
const program=process.platform==='win32'?'pg_restore.exe':'pg_restore';
const binary=process.env.PG_BIN?join(process.env.PG_BIN,program):process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe':program;
const command=args=>new Promise((done,reject)=>{
 const child=spawn(binary,args,{env,windowsHide:true,stdio:['ignore','pipe','ignore']});let text='';child.stdout.on('data',v=>text+=v);
 child.once('error',()=>reject(new Error('Cannot launch pg_restore')));child.once('exit',code=>code===0?done(text):reject(new Error('Backup verification restore failed')));
});
const list=await command(['--list',file]);
const filtered=String(list).split('\n').filter(line=>!/^\d+; \d+ \d+ SCHEMA - public\b/.test(line)).join('\n');
const listFile=file+'.verify-list';await writeFile(listFile,filtered,{flag:'wx',mode:0o600});
const source=new pg.Client({connectionString:process.env.DATABASE_URL});await source.connect();
try {
 if(manifest.tables.branches){
  const role=(await source.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='coffee_branch_runtime'")).rows[0];
  if(!role||role.rolsuper||role.rolbypassrls||role.rolcanlogin)throw new Error('Branch role must already be provisioned by an authorized administrator; verification never changes source privileges');
 }
 await source.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
}finally{await source.end();}
await command(['--no-password','--no-owner','--no-acl','--exit-on-error','--single-transaction','--use-list='+listFile,'--dbname='+database,file]);
url.pathname='/'+database;const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{
 const counts={};for(const table of Object.keys(manifest.tables))counts[table]=(await db.query(`SELECT count(*)::text AS n FROM public."${table.replaceAll('"','""')}"`)).rows[0].n;
 if(JSON.stringify(counts)!==JSON.stringify(manifest.tables))throw new Error('Restored row counts differ');
 const migrations=(await db.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
 if(JSON.stringify(migrations)!==JSON.stringify(manifest.migrations))throw new Error('Restored migrations differ');
 const verification={verified_at:new Date().toISOString(),database,backup_sha256:manifest.sha256,tables:Object.keys(counts).length,all_row_counts_match:true,migration_checksums_match:true,source_unchanged:true,no_deletions:true};
 await writeFile(file+'.verified.json',JSON.stringify(verification,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(verification,null,2));
}finally{await db.end();}
