-- MOMOS OPS · H63 Cierre RBAC de aprobación humana MCP v1.
-- Forward fix para instalaciones que aplicaron H62 antes de revocar el acceso
-- directo de service_role a la tabla/sequence. Las RPC security definer siguen
-- siendo la única superficie del runtime MCP.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260718_62_mcp_aprobacion_humana') then
    raise exception 'Falta el paso 62_mcp_aprobacion_humana.';
  end if;
  if to_regclass('public.agency_mcp_human_approvals') is null then
    raise exception 'Falta la tabla de aprobaciones humanas MCP.';
  end if;
end $$;

revoke all on public.agency_mcp_human_approvals
  from public,anon,authenticated,service_role;
revoke all on sequence public.agency_mcp_human_approvals_id_seq
  from public,anon,authenticated,service_role;

-- El navegador puede leer únicamente por RLS para mostrar la bandeja. Nunca
-- inserta, cambia estados ni suplanta al runtime.
grant select on public.agency_mcp_human_approvals to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_63_mcp_aprobacion_humana_rbac',
  'Cierra acceso directo de service_role a tabla y sequence de aprobaciones; conserva únicamente RPCs gobernadas y lectura RLS humana')
on conflict(id) do update set detalle=excluded.detalle;

commit;
