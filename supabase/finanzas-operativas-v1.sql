-- MOMOS OPS · H75 Finanzas operativas independientes v1.
--
-- Finanzas deja de depender del snapshot operativo general. La pantalla recibe
-- un resumen compacto por rango; los hechos completos H65 se consultan solo al
-- abrir el asistente. Un outbox singleton despierta Realtime sin exponer PII.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260719_74_catalogo_crm_deltas'
  ) then raise exception 'Falta el paso 74_catalogo_crm_deltas.'; end if;
  if to_regprocedure('public.momos_financial_facts_v1(date,date)') is null then
    raise exception 'Falta el contrato canónico H65 de hechos financieros.';
  end if;
  if to_regprocedure('public.has_current_role(text)') is null then
    raise exception 'Falta la matriz de roles MOMOS.';
  end if;
end $$;

create table if not exists public.finance_sync_state(
  id smallint primary key default 1 check(id=1),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.finance_sync_state(id,version) values(1,1)
on conflict(id) do nothing;
alter table public.finance_sync_state enable row level security;
drop policy if exists finance_sync_state_admin_read on public.finance_sync_state;
create policy finance_sync_state_admin_read on public.finance_sync_state
  for select to authenticated
  using(public.has_current_role('Administrador'));
revoke all on table public.finance_sync_state from public,anon,authenticated,service_role;
grant select on table public.finance_sync_state to authenticated;

create or replace function public._touch_finance_sync_state()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.finance_sync_state
  set version=version+1,changed_at=clock_timestamp()
  where id=1;
  return null;
end $$;
revoke all on function public._touch_finance_sync_state() from public,anon,authenticated,service_role;

do $$
declare v_table text; v_trigger text;
begin
  foreach v_table in array array[
    'orders','order_items','order_item_adiciones','deliveries','claims',
    'inventory_movements','inventory_lots','metrics_daily','evidences'
  ] loop
    v_trigger:='trg_h75_finance_'||v_table;
    execute format('drop trigger if exists %I on public.%I',v_trigger,v_table);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public._touch_finance_sync_state()',
      v_trigger,v_table
    );
  end loop;
end $$;

drop trigger if exists trg_h75_finance_app_settings on public.app_settings;
create or replace function public._touch_finance_app_settings()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if (tg_op='INSERT' and new.clave='pauta_mensual')
     or (tg_op='DELETE' and old.clave='pauta_mensual')
     or (tg_op='UPDATE' and (new.clave='pauta_mensual' or old.clave='pauta_mensual')) then
    update public.finance_sync_state
    set version=version+1,changed_at=clock_timestamp()
    where id=1;
  end if;
  return null;
end $$;
revoke all on function public._touch_finance_app_settings() from public,anon,authenticated,service_role;

create trigger trg_h75_finance_app_settings
after insert or update or delete on public.app_settings
for each row
execute function public._touch_finance_app_settings();

create or replace function public.momos_finance_snapshot_v1(p_from date,p_to date)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_facts jsonb;
  v_summary jsonb;
  v_payments jsonb;
  v_version bigint;
begin
  if auth.uid() is null or public.has_current_role('Administrador') is not true then
    raise exception 'Solo Administración puede consultar Finanzas.' using errcode='42501';
  end if;
  v_facts:=public.momos_financial_facts_v1(p_from,p_to);
  select s.version into v_version from public.finance_sync_state s where s.id=1;

  with
  orders as materialized(
    select * from jsonb_to_recordset(v_facts->'orders') as x(
      order_id text,order_date date,channel text,state text,payment_method text,
      payment_confirmed boolean,product_revenue numeric,cogs numeric,discount numeric,
      delivery_collected numeric,delivery_cost_on_order numeric,total_charged numeric,
      line_count integer,incomplete_cost_lines integer,has_payment_evidence boolean
    )
  ),
  deliveries as materialized(
    select * from jsonb_to_recordset(v_facts->'deliveries') as x(
      delivery_id text,order_id text,state text,actual_cost numeric,charged numeric
    )
  ),
  claims as materialized(
    select * from jsonb_to_recordset(v_facts->'claims') as x(
      claim_id text,order_id text,claim_date date,state text,documented_cost numeric,recognized_cost numeric
    )
  ),
  purchases as materialized(
    select * from jsonb_to_recordset(v_facts->'inventory_purchases') as x(
      movement_id text,lot_id text,purchase_date date,item_id text,quantity numeric,
      unit_cost numeric,documented_cost numeric,origin text
    )
  ),
  ad_spend as materialized(
    select * from jsonb_to_recordset(v_facts->'ad_spend') as x(
      metric_id text,metric_date date,source text,campaign_id text,creative_id text,
      post_id text,documented_spend numeric
    )
  ),
  delivery_stats as materialized(
    select d.order_id,
      count(*) filter(where d.state in ('Solicitado','Asignado','En ruta','Entregado'))::integer active_count,
      coalesce((
        array_agg(d.actual_cost order by (d.state='Entregado') desc,d.delivery_id)
          filter(where d.state in ('Solicitado','Asignado','En ruta','Entregado'))
      )[1],0)::numeric authoritative_cost
    from deliveries d group by d.order_id
  ),
  order_flags as materialized(
    select o.*,
      (o.payment_confirmed and o.state='Cancelado')::integer f_refund,
      ((not o.payment_confirmed) and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado'))::integer f_unpaid_operation,
      (o.payment_confirmed and o.state in ('Nuevo','Confirmado','Pendiente de pago'))::integer f_paid_prestate,
      (o.product_revenue<=0 or o.total_charged<=0 or o.discount>o.product_revenue)::integer f_invalid_total,
      ((not o.payment_confirmed) and o.has_payment_evidence)::integer f_verify_payment,
      (o.payment_confirmed and not(lower(coalesce(o.channel,''))='rappi' or lower(coalesce(o.payment_method,'')) like '%rappi%') and not o.has_payment_evidence)::integer f_missing_proof,
      (o.line_count=0)::integer f_missing_lines,
      (o.payment_confirmed and o.incomplete_cost_lines>0)::integer f_missing_cost,
      (not(lower(coalesce(o.channel,''))='rappi' or lower(coalesce(o.payment_method,'')) like '%rappi%')
        and o.state in ('En ruta','Entregado','Reclamo')
        and (coalesce(ds.active_count,0)=0 or coalesce(ds.authoritative_cost,0)<=0))::integer f_delivery_cost,
      (not(lower(coalesce(o.channel,''))='rappi' or lower(coalesce(o.payment_method,'')) like '%rappi%')
        and o.state in ('En ruta','Entregado','Reclamo') and coalesce(ds.active_count,0)>1)::integer f_duplicate_delivery,
      (coalesce(ds.authoritative_cost,0)>0 and o.delivery_cost_on_order>0
        and abs(o.delivery_cost_on_order-ds.authoritative_cost)>=1)::integer f_delivery_mismatch
    from orders o left join delivery_stats ds on ds.order_id=o.order_id
  ),
  claim_flags as materialized(
    select c.*,
      (c.state in ('En revisión','Abierto','Pendiente'))::integer f_open,
      (c.state in ('Aprobado','Compensado') and c.documented_cost<=0)::integer f_zero_cost
    from claims c
  ),
  configured as materialized(
    select
      coalesce((v_facts->'configured_ad'->>'monthly_budget')::numeric,0) monthly_budget,
      coalesce((v_facts->'configured_ad'->>'prorated_budget')::numeric,0) prorated_budget,
      coalesce((v_facts->'range'->>'days')::integer,1) range_days
  ),
  totals as materialized(
    select
      count(*)::integer orders_reviewed,
      count(*) filter(where o.payment_confirmed)::integer confirmed_payment_orders,
      count(*) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado'))::integer paid_orders,
      coalesce(sum(o.total_charged) filter(where o.payment_confirmed),0)::numeric gross_collected,
      coalesce(sum(greatest(0,o.total_charged)) filter(where not o.payment_confirmed and o.state<>'Cancelado'),0)::numeric pending_value,
      coalesce(sum(o.product_revenue-o.discount) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0)::numeric product_revenue,
      coalesce(sum(o.delivery_collected) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0)::numeric delivery_collected,
      coalesce(sum(o.cogs) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0)::numeric cogs,
      coalesce(sum(o.delivery_cost_on_order) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0)::numeric recorded_delivery_costs,
      coalesce(sum(greatest(0,o.delivery_cost_on_order-o.delivery_collected)) filter(where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0)::numeric delivery_subsidy,
      coalesce(sum(f_refund+f_unpaid_operation+f_paid_prestate+f_invalid_total+f_verify_payment+f_missing_proof+f_missing_lines+f_missing_cost+f_delivery_cost+f_duplicate_delivery+f_delivery_mismatch),0)::integer order_exceptions,
      coalesce(sum(f_refund+f_unpaid_operation+f_paid_prestate+f_invalid_total+f_verify_payment+f_missing_proof+f_missing_lines+f_missing_cost+f_delivery_cost+f_duplicate_delivery),0)::integer order_blocking,
      coalesce(sum(f_verify_payment),0)::integer payment_evidence_waiting,
      coalesce(sum(f_delivery_cost+f_duplicate_delivery+f_delivery_mismatch),0)::integer delivery_issues,
      coalesce(sum(f_missing_cost),0)::integer order_cost_issues
    from order_flags o
  ),
  other_totals as materialized(
    select
      coalesce((select sum(d.actual_cost) from deliveries d join orders o on o.order_id=d.order_id where o.payment_confirmed and o.state not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado') and d.state<>'Cancelado'),0)::numeric delivery_costs,
      coalesce((select sum(c.recognized_cost) from claims c),0)::numeric recognized_claims,
      coalesce((select sum(a.documented_spend) from ad_spend a),0)::numeric platform_spend,
      coalesce((select sum(p.documented_cost) from purchases p),0)::numeric inventory_purchases,
      coalesce((select sum(c.f_open+c.f_zero_cost) from claim_flags c),0)::integer claim_exceptions,
      coalesce((select sum(c.f_zero_cost) from claim_flags c),0)::integer claim_blocking,
      coalesce((select sum(c.f_open+c.f_zero_cost) from claim_flags c),0)::integer claim_cost_issues
  ),
  final as materialized(
    select t.*,x.*,c.*,
      round(c.prorated_budget,0)::numeric manual_ad_allocation,
      (c.prorated_budget>0 and (x.platform_spend=0 or abs(c.prorated_budget-x.platform_spend)>greatest(5000,c.prorated_budget*0.2))) ad_mismatch
    from totals t cross join other_totals x cross join configured c
  )
  select jsonb_build_object(
    'ordersReviewed',orders_reviewed,'confirmedPaymentOrders',confirmed_payment_orders,'paidOrders',paid_orders,
    'grossCollected',gross_collected,'pendingValue',pending_value,'productRevenue',product_revenue,
    'deliveryCollected',delivery_collected,'cogs',cogs,'deliveryCosts',delivery_costs,
    'recognizedClaims',recognized_claims,'platformSpend',platform_spend,
    'manualAdAllocation',manual_ad_allocation,'configuredMonthlyAdBudget',monthly_budget,
    'inventoryPurchases',inventory_purchases,'rangeDays',range_days,
    'grossMargin',product_revenue-cogs,'recordedDeliveryCosts',recorded_delivery_costs,
    'deliverySubsidy',delivery_subsidy,'recognizedClaimsForPeriod',recognized_claims,
    'estimatedProfit',(product_revenue-cogs)+delivery_collected-recorded_delivery_costs-manual_ad_allocation-recognized_claims,
    'operatingResult',product_revenue-cogs+delivery_collected-delivery_costs-recognized_claims-platform_spend,
    'exceptions',order_exceptions+claim_exceptions+ad_mismatch::integer,
    'blocking',order_blocking+claim_blocking,
    'closeReady',(order_blocking+claim_blocking)=0,
    'paymentEvidenceWaiting',payment_evidence_waiting,
    'deliveryIssues',delivery_issues,
    'costIssues',order_cost_issues+claim_cost_issues
  ) into v_summary from final;

  with orders as materialized(
    select * from jsonb_to_recordset(v_facts->'orders') as x(
      order_id text,payment_method text,payment_confirmed boolean,total_charged numeric
    )
  ), grouped as(
    select coalesce(nullif(payment_method,''),'Sin medio') method,count(*)::integer orders,
      coalesce(sum(total_charged),0)::numeric amount
    from orders where payment_confirmed
    group by coalesce(nullif(payment_method,''),'Sin medio')
  )
  select coalesce(jsonb_agg(jsonb_build_object('method',method,'orders',orders,'amount',amount) order by amount desc,method),'[]'::jsonb)
  into v_payments from grouped;

  return jsonb_build_object(
    'contract','momos.finance-snapshot.v1','version',1,'snapshotVersion',v_version::text,
    'serverTime',v_facts->>'server_time','range',v_facts->'range',
    'summary',v_summary,'payments',v_payments,
    'containsPii',false,'containsFreeText',false,'containsStorageReferences',false,
    'containsSecrets',false,'externalExecution',false
  );
end $$;
revoke all on function public.momos_finance_snapshot_v1(date,date) from public,anon,service_role;
grant execute on function public.momos_finance_snapshot_v1(date,date) to authenticated;

create table if not exists public.finance_delta_receipts(
  idempotency_key text primary key check(idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.finance_delta_receipts enable row level security;
revoke all on table public.finance_delta_receipts from public,anon,authenticated,service_role;

create or replace function public.actualizar_pauta_financiera_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_key text; v_hash text; v_budget numeric; v_from date; v_to date;
  v_receipt public.finance_delta_receipts%rowtype;
  v_old numeric:=0; v_user_id text; v_snapshot jsonb; v_result jsonb;
begin
  if auth.uid() is null or public.has_current_role('Administrador') is not true then
    raise exception 'Solo Administración puede actualizar la pauta financiera.' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('idempotency_key','monthly_budget','from','to')) then
    raise exception 'La actualización financiera no cumple el contrato cerrado.';
  end if;
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  if v_key is null or v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'La actualización financiera requiere una llave idempotente UUID.';
  end if;
  if jsonb_typeof(p->'monthly_budget') is distinct from 'number' then raise exception 'monthly_budget debe ser numérico.'; end if;
  v_budget:=(p->>'monthly_budget')::numeric;
  if v_budget<0 or v_budget>1000000000 then raise exception 'La pauta mensual está fuera del rango permitido.'; end if;
  v_from:=nullif(p->>'from','')::date; v_to:=nullif(p->>'to','')::date;
  if v_from is null or v_to is null or v_from>v_to or (v_to-v_from)>366 then raise exception 'El rango financiero no es válido.'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('monthly_budget',v_budget,'from',v_from,'to',v_to)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-finance:'||v_key,0));
  select * into v_receipt from public.finance_delta_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave de idempotencia ya pertenece a otra actualización.'; end if;
    return v_receipt.result||jsonb_build_object('duplicate',true);
  end if;
  select coalesce(case jsonb_typeof(s.valor) when 'number' then (s.valor#>>'{}')::numeric when 'string' then nullif(btrim(s.valor#>>'{}'),'')::numeric else 0 end,0)
  into v_old from public.app_settings s where s.clave='pauta_mensual';
  insert into public.app_settings(clave,valor) values('pauta_mensual',to_jsonb(v_budget))
  on conflict(clave) do update set valor=excluded.valor;
  select u.id into v_user_id from public.users u where u.auth_id=auth.uid() and u.activo order by u.id limit 1;
  insert into public.audit_logs(id,user_id,entidad,entidad_id,accion,de,a)
  values('AF-'||replace(gen_random_uuid()::text,'-',''),v_user_id,'Configuración','pauta','Pauta actualizada',v_old::text,v_budget::text);
  v_snapshot:=public.momos_finance_snapshot_v1(v_from,v_to);
  v_result:=jsonb_build_object(
    'contract','momos.finance-mutation.v1','idempotencyKey',v_key,'duplicate',false,
    'monthlyBudget',v_budget,'snapshot',v_snapshot,'containsPii',false,
    'containsSecrets',false,'externalExecution',false
  );
  insert into public.finance_delta_receipts(idempotency_key,request_hash,result,created_by)
  values(v_key,v_hash,v_result,auth.uid());
  return v_result;
end $$;
revoke all on function public.actualizar_pauta_financiera_v1(jsonb) from public,anon,service_role;
grant execute on function public.actualizar_pauta_financiera_v1(jsonb) to authenticated;

create or replace function public.finanzas_operativas_disponibles()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.has_current_role('Administrador')
    and to_regprocedure('public.momos_finance_snapshot_v1(date,date)') is not null
    and to_regprocedure('public.actualizar_pauta_financiera_v1(jsonb)') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_75_finanzas_operativas')
$$;
revoke all on function public.finanzas_operativas_disponibles() from public,anon,service_role;
grant execute on function public.finanzas_operativas_disponibles() to authenticated;

create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0; v_finance_version bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible','orquestador_agencia_disponible',
    'centro_acciones_agencia_disponible','resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible','postproduccion_exportacion_disponible',
    'postproduccion_audio_disponible','retencion_guiones_disponible','retencion_loops_disponible','observatorio_meta_disponible',
    'incrementalidad_meta_disponible','escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible','meta_conector_dry_run_disponible',
    'distribucion_comercial_disponible','distribucion_conectores_disponible','biblioteca_creativa_disponible','produccion_creativa_disponible',
    'revision_creativa_disponible','versiones_creativas_disponibles','integraciones_agencia_disponibles','higgsfield_conector_disponible',
    'kling_conector_disponible','gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible','mundo_animado_disponible',
    'eliminacion_logo_oficial_disponible','biblioteca_produccion_disponible','mcp_aprobaciones_humanas_disponible',
    'inventario_deltas_disponibles','pedidos_deltas_disponibles','producto_terminado_deltas_disponibles',
    'produccion_deltas_disponibles','catalogo_crm_deltas_disponibles','finanzas_operativas_disponibles'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300),
      'finanzas',jsonb_build_object('version',coalesce(v_finance_version,0)::text,'ttl_seconds',60)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='finance_sync_state') then
    alter publication supabase_realtime add table public.finance_sync_state;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_75_finanzas_operativas','Resumen financiero compacto por rango, detalle bajo demanda, pauta idempotente y outbox Realtime sin PII')
on conflict(id) do update set detalle=excluded.detalle;
commit;
