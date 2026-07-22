-- MOMOS OPS · H104 · lectura humana compacta para el piloto comercial H102.
-- No abre trafico, no crea pedidos y no agrega mutaciones comerciales.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_102_piloto_comercial_controlado')
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_103_inteligencia_creativa_publicitaria')
     or to_regprocedure('public.momos_commercial_pilot_snapshot_v1()') is null then
    raise exception 'H104 requiere H102 y H103 aplicados en orden.';
  end if;
end $$;

create or replace function public.momos_commercial_pilot_snapshot_v2()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_actor text;
  v_result jsonb;
  v_health public.operational_health_state%rowtype;
begin
  if public.current_user_has_any_role(array['Administrador','Coordinador de pedidos','Cajero']) is not true then
    raise exception 'Tu rol no puede consultar el piloto.' using errcode='42501';
  end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_health from public.operational_health_state where singleton;

  select jsonb_build_object(
    'contract','momos.commercial-pilot.snapshot.v2',
    'capturedAt',clock_timestamp(),
    'pilots',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'key',r.pilot_key,
        'environment',r.environment,
        'status',r.status,
        'plannedOrders',r.planned_orders,
        'maxOrderTotal',r.max_order_total,
        'linkedOrders',(select count(*) from public.commercial_pilot_orders o where o.pilot_id=r.id),
        'reconciledOrders',(select count(*) from public.commercial_pilot_orders o where o.pilot_id=r.id and o.reconciled),
        'approvedSignoffs',(select count(*) from public.commercial_pilot_signoffs s where s.pilot_id=r.id and s.status='Aprobado'),
        'startsAt',r.starts_at,
        'expiresAt',r.expires_at,
        'version',r.version,
        'signoffs',coalesce((
          select jsonb_agg(jsonb_build_object('area',s.area,'status',s.status) order by
            case s.area when 'Producto' then 1 when 'Operaciones' then 2 when 'Finanzas' then 3 else 4 end)
          from public.commercial_pilot_signoffs s where s.pilot_id=r.id
        ),'[]'::jsonb),
        'orders',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',o.order_id,'status',o.current_status,'outcome',o.outcome,
            'reconciled',o.reconciled,'linkedAt',o.linked_at,
            'finalMargin',case when o.reconciled then o.final_margin end
          ) order by o.linked_at,o.order_id)
          from public.commercial_pilot_orders o where o.pilot_id=r.id
        ),'[]'::jsonb)
      ) order by r.created_at desc)
      from (select * from public.commercial_pilot_runs order by created_at desc limit 20) r
    ),'[]'::jsonb),
    'eligibleOrders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,'status',q.estado,'total',q.total,'paidAt',q.pagado_en
      ) order by q.pagado_en,q.id)
      from (
        select o.id,o.estado,o.pagado_en,
          coalesce(t.ventas,0)-coalesce(o.descuento,0)+coalesce(o.dom_cobrado,0) as total
        from public.orders o
        left join public.v_order_totals t on t.order_id=o.id
        where o.pagado_en is not null
          and o.estado in ('Pagado','En producción','Listo para empaque','Empacado','Listo para despacho','En ruta')
          and not exists(select 1 from public.commercial_pilot_orders x where x.order_id=o.id)
        order by o.pagado_en,o.id
        limit 30
      ) q where q.total>0 and q.total<=500000
    ),'[]'::jsonb),
    'permissions',jsonb_build_object(
      'canPrepare',public.current_user_has_any_role(array['Administrador']),
      'canStart',public.current_user_has_any_role(array['Administrador']),
      'canLink',public.current_user_has_any_role(array['Administrador','Coordinador de pedidos']),
      'canReconcile',public.current_user_has_any_role(array['Administrador','Coordinador de pedidos','Cajero']),
      'canClose',public.current_user_has_any_role(array['Administrador']),
      'canAbort',public.current_user_has_any_role(array['Administrador']),
      'signableAreas',(
        select coalesce(jsonb_agg(x.area order by x.ord),'[]'::jsonb)
        from (values
          ('Producto',1,public.current_user_has_any_role(array['Administrador'])),
          ('Operaciones',2,public.current_user_has_any_role(array['Administrador','Coordinador de pedidos'])),
          ('Finanzas',3,public.current_user_has_any_role(array['Administrador','Cajero'])),
          ('Seguridad y Privacidad',4,public.current_user_has_any_role(array['Administrador']))
        ) x(area,ord,allowed) where x.allowed
      )
    ),
    'health',jsonb_build_object(
      'ready',coalesce(not v_health.read_only,false)
        and coalesce(v_health.resilience_certified_until>clock_timestamp(),false)
        and coalesce(v_health.continuity_certified_until>clock_timestamp(),false)
        and not exists(select 1 from public.operational_health_incidents
          where status in ('Abierto','Confirmado') and severity in ('Alta','Crítica')),
      'status',coalesce(v_health.status,'Sin diagnóstico'),
      'operationReadOnly',coalesce(v_health.read_only,true),
      'blockingIncidents',(select count(*) from public.operational_health_incidents
        where status in ('Abierto','Confirmado') and severity in ('Alta','Crítica'))
    ),
    'authority',jsonb_build_object(
      'actorPresent',v_actor is not null,
      'readOnly',true,
      'publicTrafficOpened',false
    ),
    'privacy',jsonb_build_object(
      'containsCustomerPii',false,
      'containsSecrets',false,
      'containsFreeText',false
    ),
    'externalExecution',false
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.momos_commercial_pilot_snapshot_v2() from public,anon,authenticated,service_role;
grant execute on function public.momos_commercial_pilot_snapshot_v2() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_104_piloto_comercial_ui',
  'Vista humana compacta del piloto con firmas, pedidos, salud y permisos sin PII ni ejecucion externa')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_104_piloto_comercial_ui';
