import { readFile } from 'node:fs/promises';
import { expect,test } from 'vitest';
import { assertDemoIsolation } from '../src/demo-isolation.js';

test('demo creation is rejected on operational databases and every production target',()=>{
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee_backoffice','development')).toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee_demo_qa','production')).toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee_demo_qa','development')).not.toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee_test_backup_'+ 'a'.repeat(32),'test')).not.toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee_restore_fixture_'+ 'a'.repeat(32),'test')).toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee?options=-csearch_path%3De2e_'+ 'a'.repeat(32),'test')).not.toThrow();
 expect(()=>assertDemoIsolation('postgresql://test:test@localhost/coffee?options=-csearch_path%3Dpublic','test')).toThrow();
});
test('normal startup and migration sources never invoke demo/simulation seed commands',async()=>{
 for(const file of ['src/server.ts','scripts/start-local.mjs','compose.yaml']){
  const text=await readFile(file,'utf8');expect(text).not.toMatch(/(?:dist\/demo|src\/demo|db:demo|replay-shop-sales|simulate-sales)/);
 }
});
