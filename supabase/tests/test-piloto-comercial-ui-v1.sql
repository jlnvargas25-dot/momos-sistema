-- MOMOS OPS · H104 · contrato adversarial de la vista humana del piloto. Siempre ROLLBACK.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h104_commercial_pilot_ui'));

create temporary table h104_context(admin_id text not null,auth_id uuid not null,pilot_id uuid) on commit drop;
grant select,update on table h104_context to authenticated,anon;

do $$
declare v_admin public.users%rowtype;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_104_piloto_comercial_ui')
    and to_regprocedure('public.momos_commercial_pilot_snapshot_v2()') is not null,
    'H104 requiere aplicar piloto-comercial-ui-v1.sql.';
  assert has_function_privilege('authenticated','public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_table_privilege('authenticated','public.commercial_pilot_signoffs','SELECT')
    and not has_table_privilege('authenticated','public.commercial_pilot_orders','SELECT'),
    'H104 perdió RBAC o expuso tablas privadas.';
  select * into v_admin from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  assert v_admin.id is not null,'H104 necesita un Administrador autenticado.';
  insert into h104_context(admin_id,auth_id) values(v_admin.id,v_admin.auth_id);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h104_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_run jsonb; v_snapshot jsonb; v_pilot jsonb; v_keys text[];
begin
  v_run:=public.preparar_piloto_comercial_v1(jsonb_build_object(
    'contract','momos.commercial-pilot.prepare.v1',
    'pilot_key','pilot-ui-h104-'||pg_backend_pid(),
    'environment','Staging',
    'planned_orders',2,
    'max_order_total',150000,
    'starts_at',clock_timestamp()+interval '1 minute',
    'expires_at',clock_timestamp()+interval '1 day'
  ));
  update h104_context set pilot_id=(v_run->>'pilotId')::uuid;
  v_snapshot:=public.momos_commercial_pilot_snapshot_v2();
  select value into v_pilot from jsonb_array_elements(v_snapshot->'pilots')
    where value->>'id'=v_run->>'pilotId';

  assert v_snapshot->>'contract'='momos.commercial-pilot.snapshot.v2'
    and jsonb_array_length(v_pilot->'signoffs')=4
    and jsonb_array_length(v_pilot->'orders')=0
    and (v_pilot->>'approvedSignoffs')::integer=0
    and coalesce((v_snapshot#>>'{authority,publicTrafficOpened}')::boolean,true)=false
    and coalesce((v_snapshot->>'externalExecution')::boolean,true)=false,
    'H104 no devolvió el flujo cerrado completo.';

  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_pilot) key;
  assert v_keys=array[
    'approvedSignoffs','environment','expiresAt','id','key','linkedOrders','maxOrderTotal',
    'orders','plannedOrders','reconciledOrders','signoffs','startsAt','status','version'
  ]::text[], 'H104 expuso detalle fuera del contrato compacto.';

  assert coalesce((v_snapshot#>>'{privacy,containsCustomerPii}')::boolean,true)=false
    and coalesce((v_snapshot#>>'{privacy,containsSecrets}')::boolean,true)=false
    and coalesce((v_snapshot#>>'{privacy,containsFreeText}')::boolean,true)=false
    and coalesce((v_snapshot#>>'{authority,actorPresent}')::boolean,false)=true
    and ((v_snapshot-'privacy'-'authority')::text)!~*
      'telefono|direcci[oó]n|email|customer|cliente|nombre|nota|notes|actor|evidence.?code|service_role|api.?key|token|secret',
    'H104 expuso PII, notas, actor, evidencia o secretos.';
  assert not exists(
    select 1 from jsonb_array_elements(v_snapshot->'eligibleOrders') item
    cross join lateral jsonb_object_keys(item) key
    where key not in ('id','status','total','paidAt')
  ),'H104 amplió los pedidos elegibles fuera del contrato mínimo.';
end $$;

reset role;
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_commercial_pilot_snapshot_v2();
  exception when insufficient_privilege then v_failed:=true;
  when others then v_failed:=sqlstate='42501'; end;
  assert v_failed,'H104 permitió lectura anónima.';
end $$;

reset role;
select 'TESTS_OK — H104 UI piloto/firmas/pedidos/salud/PII/RBAC PASS, rollback total' as resultado;
rollback;
