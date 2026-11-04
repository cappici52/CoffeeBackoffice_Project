export function assertDemoIsolation(url:string,nodeEnv:string){
  const target=new URL(url);
  const database=/^\/coffee_(demo|sim|test)(_[a-z0-9]+)*$/i.test(target.pathname);
  const schema=/^-csearch_path=e2e_[a-f0-9]{32}$/.test(target.searchParams.get('options')??'');
  if(nodeEnv==='production'||(!database&&!schema))throw new Error('Demo data is restricted to an explicitly isolated demonstration/test database or generated E2E schema');
}
