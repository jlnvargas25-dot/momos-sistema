-- MOMOS OPS · H102 · piloto comercial controlado. Siempre ROLLBACK.
-- No abre checkout, no cobra, no publica y no conserva el pedido sintético.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h102_commercial_pilot'));

create temporary table h102_context(
  admin_id text not null,
  auth_id uuid not null,
  customer_id text not null,
  order_id text not null,
  order_item_id text not null,
  product_id text not null,
  figure text not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  pilot_id uuid,
  pilot_version bigint
) on commit drop;
grant select,update on table h102_context to authenticated,anon;

do $$
declare
  v_admin public.users%rowtype;
  v_product text;
  v_figure text;
  v_suffix text:=pg_backend_pid()::text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_102_piloto_comercial_controlado'),
    'H102 requiere aplicar piloto-comercial-controlado-v1.sql.';
  assert to_regprocedure('public.preparar_piloto_comercial_v1(jsonb)') is not null
    and to_regprocedure('public.firmar_piloto_comercial_v1(uuid,text,text,bigint)') is not null
    and to_regprocedure('public.iniciar_piloto_comercial_v1(uuid,bigint,text)') is not null
    and to_regprocedure('public.vincular_pedido_piloto_comercial_v1(uuid,text,uuid)') is not null
    and to_regprocedure('public.conciliar_pedido_piloto_comercial_v1(uuid,text)') is not null
    and to_regprocedure('public.cerrar_piloto_comercial_v1(uuid,bigint)') is not null
    and to_regprocedure('public.abortar_piloto_comercial_v1(uuid,bigint,text)') is not null
    and to_regprocedure('public.momos_commercial_pilot_snapshot_v1()') is not null,
    'H102 no instaló el contrato completo del piloto.';

  assert not has_table_privilege('authenticated','public.commercial_pilot_runs','SELECT')
    and not has_table_privilege('authenticated','public.commercial_pilot_signoffs','SELECT')
    and not has_table_privilege('authenticated','public.commercial_pilot_orders','SELECT')
    and not has_table_privilege('authenticated','public.commercial_pilot_events','SELECT')
    and not has_table_privilege('service_role','public.commercial_pilot_runs','SELECT')
    and has_function_privilege('authenticated','public.preparar_piloto_comercial_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.preparar_piloto_comercial_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.preparar_piloto_comercial_v1(jsonb)','EXECUTE'),
    'H102 perdió aislamiento de tablas o RBAC de RPC.';

  select * into v_admin from public.users
  where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select f.product_id,f.nombre into v_product,v_figure
  from public.figuras f
  join public.products p on p.id=f.product_id
  where f.activo and public._momos_es_figura_canonica(f.nombre)
    and p.activo and p.tipo='momo'
  order by f.nombre limit 1;
  assert v_admin.id is not null and v_product is not null,
    'H102 necesita Administrador autenticado y una figura canónica activa.';

  insert into public.customers(id,nombre,telefono,canal)
  values('C-H102-'||v_suffix,'Cliente sintético H102',
    '398'||right('0000000'||v_suffix,7),'Directo');
  insert into public.orders(
    id,fecha,hora,canal,customer_id,barrio,direccion,zona,dom_cobrado,dom_costo,
    pago,comprobante,estado,obs,inventario_reservado,insumos_descontados
  ) values(
    'P-H102-'||v_suffix,current_date,localtime,'Directo','C-H102-'||v_suffix,
    'Piloto cerrado','Dirección sintética',null,5000,5000,'Nequi',false,
    'Pendiente de pago','[TEST H102 · ROLLBACK]',true,true
  );
  insert into public.order_items(
    id,order_id,product_id,nombre,figura,sabor,relleno,cant,precio,costo_unitario
  ) select 'OI-H102-'||v_suffix,'P-H102-'||v_suffix,p.id,p.nombre,v_figure,
      'Coco','Cheesecake con ganache',1,p.precio,p.costo
    from public.products p where p.id=v_product;

  insert into h102_context values(
    v_admin.id,v_admin.auth_id,'C-H102-'||v_suffix,'P-H102-'||v_suffix,
    'OI-H102-'||v_suffix,v_product,v_figure,
    clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',null,null
  );
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h102_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare
  v_payload jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object(
    'contract','momos.commercial-pilot.prepare.v1',
    'pilot_key','pilot-h102-'||pg_backend_pid(),
    'environment','Produccion',
    'planned_orders',1,
    'max_order_total',500000,
    'starts_at',(select starts_at from h102_context),
    'expires_at',(select expires_at from h102_context)
  );
  begin
    perform public.preparar_piloto_comercial_v1(v_payload||jsonb_build_object('customer_phone','3000000000'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 aceptó PII o campos abiertos en el contrato.';

  v_failed:=false;
  begin perform public.preparar_piloto_comercial_v1(v_payload);
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 preparó Producción sin confirmación humana explícita.';

  v_payload:=v_payload||jsonb_build_object(
    'production_confirmation','PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO'
  );
  v_result:=public.preparar_piloto_comercial_v1(v_payload);
  v_replay:=public.preparar_piloto_comercial_v1(v_payload);
  assert v_result->>'contract'='momos.commercial-pilot.v1'
    and (v_result->>'status')='Borrador'
    and coalesce((v_result->>'duplicate')::boolean,true)=false
    and coalesce((v_replay->>'duplicate')::boolean,false)=true
    and coalesce((v_result->>'publicTrafficOpened')::boolean,true)=false
    and coalesce((v_result->>'externalExecution')::boolean,true)=false,
    'H102 no conservó preparación idempotente, cerrada y sin ejecución.';
  update h102_context set pilot_id=(v_result->>'pilotId')::uuid,
    pilot_version=(v_result->>'version')::bigint;

  v_failed:=false;
  begin perform public.iniciar_piloto_comercial_v1(
    (v_result->>'pilotId')::uuid,(v_result->>'version')::bigint,'INICIAR_PILOTO_CERRADO_PRODUCCION');
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 inició sin las cuatro firmas.';
end $$;

do $$
declare v_result jsonb; v_version bigint:=(select pilot_version from h102_context);
begin
  v_result:=public.firmar_piloto_comercial_v1((select pilot_id from h102_context),'Producto','SCOPE_APPROVED',v_version);
  v_version:=(v_result->>'version')::bigint;
  v_result:=public.firmar_piloto_comercial_v1((select pilot_id from h102_context),'Operaciones','ROLES_TRAINED',v_version);
  v_version:=(v_result->>'version')::bigint;
  v_result:=public.firmar_piloto_comercial_v1((select pilot_id from h102_context),'Finanzas','CLOSE_READY',v_version);
  v_version:=(v_result->>'version')::bigint;
  v_result:=public.firmar_piloto_comercial_v1((select pilot_id from h102_context),'Seguridad y Privacidad','PRIVACY_REVIEWED',v_version);
  assert v_result->>'status'='Listo' and (v_result->>'approvedSignoffs')::integer=4,
    'H102 no exigió y consolidó las cuatro firmas.';
  update h102_context set pilot_version=(v_result->>'version')::bigint;

  v_result:=public.firmar_piloto_comercial_v1(
    (select pilot_id from h102_context),'Producto','SCOPE_APPROVED',1);
  assert coalesce((v_result->>'duplicate')::boolean,false),
    'H102 no toleró el replay exacto de una firma.';
end $$;

do $$
declare v_failed boolean:=false;
begin
  begin perform public.iniciar_piloto_comercial_v1(
    (select pilot_id from h102_context),(select pilot_version from h102_context),'');
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 inició Producción sin su segunda confirmación.';
end $$;

reset role;
update public.operational_health_state set
  status='Solo lectura',read_only=true,reason_code='TEST_H102_BLOCK',
  resilience_certified_until=clock_timestamp()+interval '1 day',
  continuity_certified_until=clock_timestamp()+interval '1 day'
where singleton;
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  begin perform public.iniciar_piloto_comercial_v1(
    (select pilot_id from h102_context),(select pilot_version from h102_context),
    'INICIAR_PILOTO_CERRADO_PRODUCCION');
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 ignoró el modo solo lectura.';
end $$;

reset role;
update public.operational_health_state set
  status='Saludable',read_only=false,reason_code='TEST_H102_READY',
  resilience_certified_until=clock_timestamp()+interval '1 day',
  continuity_certified_until=clock_timestamp()+interval '1 day'
where singleton;
update public.operational_health_incidents set
  status='Resuelto',resolved_by=(select auth_id from h102_context),
  resolved_at=clock_timestamp(),resolution_code='FALSO_POSITIVO'
where status in ('Abierto','Confirmado') and severity in ('Alta','Crítica');
set local role authenticated;

do $$
declare v_result jsonb; v_failed boolean:=false;
begin
  v_result:=public.iniciar_piloto_comercial_v1(
    (select pilot_id from h102_context),(select pilot_version from h102_context),
    'INICIAR_PILOTO_CERRADO_PRODUCCION');
  assert v_result->>'status'='En curso'
    and coalesce((v_result->>'publicTrafficOpened')::boolean,true)=false,
    'H102 no inició la muestra cerrada aun con salud certificada.';
  update h102_context set pilot_version=(v_result->>'version')::bigint;

  begin perform public.vincular_pedido_piloto_comercial_v1(
    (select pilot_id from h102_context),(select order_id from h102_context),
    '10200000-0000-4000-8000-000000000001'::uuid);
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 vinculó un pedido no pagado.';
end $$;

reset role;
update public.orders set estado='Pagado',pagado_en=clock_timestamp(),comprobante=true
where id=(select order_id from h102_context);
set local role authenticated;

do $$
declare v_first jsonb; v_replay jsonb; v_failed boolean:=false;
begin
  v_first:=public.vincular_pedido_piloto_comercial_v1(
    (select pilot_id from h102_context),(select order_id from h102_context),
    '10200000-0000-4000-8000-000000000001'::uuid);
  v_replay:=public.vincular_pedido_piloto_comercial_v1(
    (select pilot_id from h102_context),(select order_id from h102_context),
    '10200000-0000-4000-8000-000000000001'::uuid);
  assert coalesce((v_first->>'duplicate')::boolean,true)=false
    and coalesce((v_replay->>'duplicate')::boolean,false)=true
    and v_first->>'orderId'=(select order_id from h102_context),
    'H102 perdió idempotencia durable al vincular el pedido.';
  begin perform public.vincular_pedido_piloto_comercial_v1(
    (select pilot_id from h102_context),(select order_id from h102_context),gen_random_uuid());
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 vinculó dos veces el mismo pedido.';
end $$;

reset role;
update public.orders set estado='Cancelado' where id=(select order_id from h102_context);
delete from public.inventory_reservations where order_id=(select order_id from h102_context);
delete from public.order_stage_assignments where order_id=(select order_id from h102_context);
set local role authenticated;

do $$
declare v_result jsonb; v_snapshot jsonb; v_failed boolean:=false;
begin
  v_result:=public.conciliar_pedido_piloto_comercial_v1(
    (select pilot_id from h102_context),(select order_id from h102_context));
  assert v_result->>'outcome'='Cancelado'
    and coalesce((v_result->>'reconciled')::boolean,false)
    and (v_result::text)!~* 'telefono|direcci[oó]n|email|service_role|api_key|token',
    'H102 no concilió cancelación o expuso PII/secretos.';

  v_result:=public.cerrar_piloto_comercial_v1(
    (select pilot_id from h102_context),(select pilot_version from h102_context));
  assert v_result->>'status'='Cerrado'
    and (v_result->>'orders')::integer=1
    and (v_result->>'reconciled')::integer=1
    and nullif(v_result->>'resultFingerprint','') is not null,
    'H102 cerró sin muestra exacta, conciliación o sello.';

  v_snapshot:=public.momos_commercial_pilot_snapshot_v1();
  assert v_snapshot->>'contract'='momos.commercial-pilot.snapshot.v1'
    and jsonb_array_length(v_snapshot->'pilots')>=1
    and coalesce((v_snapshot#>>'{privacy,containsCustomerPii}')::boolean,true)=false
    and coalesce((v_snapshot#>>'{privacy,containsSecrets}')::boolean,true)=false
    and coalesce((v_snapshot->>'externalExecution')::boolean,true)=false
    and (v_snapshot::text)!~* 'telefono|direcci[oó]n|email|service_role|api_key|token',
    'H102 snapshot expuso PII, secretos o ejecución externa.';

  begin perform public.abortar_piloto_comercial_v1(
    (select pilot_id from h102_context),(v_result->>'version')::bigint,
    'ABORTAR_PILOTO_SIN_REVERTIR_PEDIDOS');
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 permitió abortar un piloto ya sellado.';
end $$;

reset role;
do $$
begin
  assert (select status from public.commercial_pilot_runs
      where id=(select pilot_id from h102_context))='Cerrado'
    and (select result_fingerprint is not null from public.commercial_pilot_runs
      where id=(select pilot_id from h102_context)),
    'H102 no selló el resultado terminal.';
  assert (select count(*) from public.commercial_pilot_orders
      where pilot_id=(select pilot_id from h102_context))=1
    and (select count(*) from public.commercial_pilot_signoffs
      where pilot_id=(select pilot_id from h102_context) and status='Aprobado')=4,
    'H102 perdió muestra exacta o firmas.';
  assert (select count(*) from public.commercial_pilot_events
      where pilot_id=(select pilot_id from h102_context) and event_code='ORDER_LINKED')=1
    and (select count(*) from public.commercial_pilot_events
      where pilot_id=(select pilot_id from h102_context) and event_code='CLOSED')=1,
    'H102 duplicó eventos por reintentos.';
end $$;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_commercial_pilot_snapshot_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'H102 permitió consulta anónima.';
end $$;
reset role;

select 'TESTS_OK — H102 piloto cerrado/firmas/salud/idempotencia/conciliación/PII/RBAC PASS, rollback total'
  as resultado;
rollback;
