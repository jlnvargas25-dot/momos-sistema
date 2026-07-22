-- MOMOS OPS · Centro humano de acciones de Agencia v1.
-- Paso 45. Expone a la interfaz únicamente la cola semántica sanitizada del
-- H44. No entrega el snapshot privado MCP ni crea capacidades de ejecución.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_44_bandeja_semantica_agencia'
  ) then raise exception 'Falta el paso 44_bandeja_semantica_agencia.'; end if;
end $$;

create or replace function public.obtener_bandeja_acciones_agencia() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_queue jsonb;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then
    return jsonb_build_object(
      'allowed',false,'actionable_total',0,'returned_total',0,'items','[]'::jsonb,
      'contains_pii',false,'free_text_exposed',false,'external_execution_allowed',false
    );
  end if;
  v_queue:=public._agency_mcp_action_queue();
  return v_queue||jsonb_build_object('allowed',true);
end $$;

create or replace function public.centro_acciones_agencia_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public.obtener_bandeja_acciones_agencia() from public,anon;
revoke all on function public.centro_acciones_agencia_disponible() from public,anon;
grant execute on function public.obtener_bandeja_acciones_agencia() to authenticated;
grant execute on function public.centro_acciones_agencia_disponible() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260716_45_centro_acciones_agencia',
  'Bandeja humana de siguientes pasos sanitizados con navegación por área y cero ejecución externa'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
