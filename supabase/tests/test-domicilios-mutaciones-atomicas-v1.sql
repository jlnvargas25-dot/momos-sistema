-- MOMOS OPS · prueba adversarial H82. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_domicilios_mutaciones_20260719'));

do $$
declare
  v_actor uuid; v_denied uuid; v_order text; v_provider text; v_delivery text;
  v_key uuid:='82000000-0000-4000-8000-000000000001';
  v_update_key uuid:='82000000-0000-4000-8000-000000000002';
  v_assign jsonb; v_duplicate jsonb; v_update jsonb;
  v_assign_version bigint; v_update_version bigint; v_count integer;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_82_domicilios_mutaciones_atomicas'),'Falta aplicar H82.';
  assert to_regclass('public.delivery_mutation_receipts') is not null
    and to_regprocedure('public.mutar_domicilio_delta(jsonb)') is not null
    and to_regprocedure('public.domicilios_mutaciones_atomicas_disponibles()') is not null,
    'H82 no instaló su contrato completo.';
  assert has_function_privilege('authenticated','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_delivery_mutation_response_v1(text,uuid,boolean,text,text)','EXECUTE'),
    'H82 perdió la frontera de funciones.';
  assert not has_table_privilege('authenticated','public.delivery_mutation_receipts','SELECT')
    and not has_table_privilege('authenticated','public.delivery_mutation_receipts','INSERT')
    and not has_table_privilege('service_role','public.delivery_mutation_receipts','SELECT'),
    'H82 expuso los recibos privados.';

  select u.auth_id into v_actor from public.users u
  where u.activo and u.auth_id is not null
    and coalesce(u.roles,array[u.rol])&&array['Administrador','Logística','Mensajero']::text[]
  order by ('Administrador'=any(coalesce(u.roles,array[u.rol]))) desc,u.id limit 1;
  select u.auth_id into v_denied from public.users u
  where u.activo and u.auth_id is not null
    and not(coalesce(u.roles,array[u.rol])&&array['Administrador','Logística','Mensajero']::text[])
  order by u.id limit 1;
  select o.id into v_order from public.orders o
  where coalesce(o.canal,'')<>'Rappi' and o.estado not in('Entregado','Cancelado')
  order by o.fecha,o.hora,o.id limit 1;
  select p.nombre into v_provider from public.proveedores_domicilio p where p.activo order by p.orden,p.nombre limit 1;
  assert v_actor is not null and v_denied is not null and v_order is not null and v_provider is not null,
    'Falta actor, pedido o proveedor para la prueba H82.';

  -- El pedido se aísla dentro de la transacción para probar una asignación real.
  update public.deliveries set estado='Cancelado' where order_id=v_order and estado<>'Cancelado';
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  assert public.domicilios_mutaciones_atomicas_disponibles(),'H82 no se anunció al rol Logística.';

  v_assign:=public.mutar_domicilio_delta(jsonb_build_object(
    'operation','assign','idempotency_key',v_key,'payload',jsonb_build_object(
      'order_id',v_order,'proveedor',v_provider,'zona','Zona H82','costo_real',7200,'obs','Prueba rollback H82'
    )
  ));
  v_delivery:=v_assign->>'deliveryId';
  assert (select count(*) from jsonb_object_keys(v_assign))=10 and v_assign ?& array[
    'contract','operation','idempotencyKey','duplicate','orderId','deliveryId','orderDelta',
    'containsCustomerPii','containsSecrets','externalExecution'
  ],'H82 abrió el contrato de respuesta.';
  assert v_assign->>'contract'='momos.delivery-mutation.v1'
    and v_assign->>'operation'='assign' and (v_assign->>'duplicate')::boolean=false
    and v_assign->>'orderId'=v_order and nullif(v_delivery,'') is not null
    and v_assign#>>'{orderDelta,contract}'='momos.order-delta-batch.v1'
    and v_assign#>>'{orderDelta,deltas,0,orderId}'=v_order
    and (v_assign->>'containsCustomerPii')::boolean
    and not(v_assign->>'containsSecrets')::boolean
    and not(v_assign->>'externalExecution')::boolean,
    'H82 no devolvió el domicilio y el pedido del mismo commit.';
  assert exists(
    select 1 from jsonb_array_elements(v_assign#>'{orderDelta,deltas,0,deliveries}') d
    where d->>'id'=v_delivery and d->>'orderId'=v_order
  ),'El delta H82 omitió el domicilio recién creado.';
  v_assign_version:=(v_assign#>>'{orderDelta,deltas,0,version}')::bigint;

  v_update:=public.mutar_domicilio_delta(jsonb_build_object(
    'operation','update','idempotency_key',v_update_key,'payload',jsonb_build_object(
      'order_id',v_order,'delivery_id',v_delivery,'estado','Asignado','codigo','H82-CODE'
    )
  ));
  v_update_version:=(v_update#>>'{orderDelta,deltas,0,version}')::bigint;
  assert v_update_version>v_assign_version
    and exists(select 1 from public.deliveries where id=v_delivery and estado='Asignado' and codigo='H82-CODE'),
    'H82 no confirmó una versión posterior de la actualización.';

  v_duplicate:=public.mutar_domicilio_delta(jsonb_build_object(
    'operation','assign','idempotency_key',v_key,'payload',jsonb_build_object(
      'order_id',v_order,'proveedor',v_provider,'zona','Zona H82','costo_real',7200,'obs','Prueba rollback H82'
    )
  ));
  select count(*) into v_count from public.deliveries where order_id=v_order and estado<>'Cancelado';
  assert (v_duplicate->>'duplicate')::boolean and v_count=1
    and (v_duplicate#>>'{orderDelta,deltas,0,version}')::bigint>=v_update_version,
    'El reintento H82 duplicó el domicilio o devolvió una lectura vieja.';

  begin
    perform public.mutar_domicilio_delta(jsonb_build_object(
      'operation','assign','idempotency_key',v_key,'payload',jsonb_build_object(
        'order_id',v_order,'proveedor',v_provider,'zona','Zona H82','costo_real',9999,'obs','Contrato cambiado'
      )
    ));
    raise exception using errcode='P0004',message='H82 aceptó reutilizar la llave con otro contrato.';
  exception when others then
    if sqlstate='P0004' then raise; end if;
  end;
  begin
    perform public.mutar_domicilio_delta(jsonb_build_object(
      'operation','update','idempotency_key',gen_random_uuid(),'payload',jsonb_build_object(
        'order_id',v_order,'delivery_id',v_delivery,'estado','Asignado','secreto','x'
      )
    ));
    raise exception using errcode='P0004',message='H82 aceptó un campo fuera del contrato.';
  exception when others then
    if sqlstate='P0004' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',v_denied::text,true);
  assert not public.domicilios_mutaciones_atomicas_disponibles(),'H82 se anunció a un rol ajeno a Logística.';
  begin
    perform public.mutar_domicilio_delta(jsonb_build_object(
      'operation','update','idempotency_key',gen_random_uuid(),'payload',jsonb_build_object(
        'order_id',v_order,'delivery_id',v_delivery,'estado','Problema'
      )
    ));
    raise exception using errcode='P0004',message='Un rol ajeno a Logística pudo mutar domicilios.';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  assert position('domicilios_mutaciones_atomicas_disponibles' in pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure
  ))>0,'El manifiesto no anuncia H82.';
end $$;

select 'TESTS_OK — Domicilios mutaciones/commit/delta/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
