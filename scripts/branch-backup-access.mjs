// pg_dump --no-acl does not restore runtime grants; RLS policy roles are cluster objects.
export async function prepareBranchRole(client,manifest){
 if(!manifest.tables.branches)return;
 await client.query(`DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coffee_branch_runtime') THEN CREATE ROLE coffee_branch_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coffee_branch_runtime' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN RAISE EXCEPTION 'Unsafe branch runtime role'; END IF;
  EXECUTE format('GRANT coffee_branch_runtime TO %I',current_user);
 END $$`);
}
export async function restoreBranchGrants(client,manifest){
 if(!manifest.tables.branches)return;
 await client.query('GRANT USAGE ON SCHEMA public TO coffee_branch_runtime');
 await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO coffee_branch_runtime');
 await client.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO coffee_branch_runtime');
}
