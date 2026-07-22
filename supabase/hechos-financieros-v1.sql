-- MOMOS OPS · H65 Hechos financieros completos por rango v1.
--
-- Este read model no reemplaza ni reimplementa la contabilidad. Ventas y COGS
-- provienen de public.v_order_totals, la fuente canónica que congela precio,
-- costo y adiciones por pedido. La función únicamente cierra el conjunto de
-- hechos necesarios para Finanzas y evita depender de las ventanas operativas
-- de 50 filas de H56/H64.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_64_integridad_snapshot_realtime'
  ) then
    raise exception 'Falta el paso 64_integridad_snapshot_realtime.';
  end if;
  if to_regclass('public.v_order_totals') is null then
    raise exception 'Falta la fuente contable canónica v_order_totals.';
  end if;
  if to_regprocedure('public.has_current_role(text)') is null then
    raise exception 'Falta la matriz de roles múltiples.';
  end if;
  if to_regclass('public.inventory_lots') is null
     or to_regclass('public.metrics_daily') is null
     or to_regclass('public.app_settings') is null then
    raise exception 'Faltan compras por lote, métricas de pauta o configuración.';
  end if;
end $$;

-- Índices dirigidos: el rango se resuelve en servidor sin escanear el ledger
-- completo. Son aditivos e idempotentes; no cambian ninguna regla de negocio.
create index if not exists orders_finance_range_idx
  on public.orders(fecha,id);
create index if not exists inventory_movements_finance_range_idx
  on public.inventory_movements(fecha,id);
create index if not exists claims_finance_range_idx
  on public.claims(fecha,id);
create index if not exists metrics_daily_finance_range_idx
  on public.metrics_daily(fecha,id);
create index if not exists deliveries_finance_order_idx
  on public.deliveries(order_id,id);
create index if not exists order_items_finance_order_idx
  on public.order_items(order_id,id);
create index if not exists evidences_finance_order_type_idx
  on public.evidences(order_id,tipo);

-- SECURITY INVOKER es intencional: además del gate de Administrador, cada
-- lectura conserva los permisos/RLS de la sesión. No contiene clientes,
-- direcciones, teléfonos, notas, rutas de Storage, URLs ni actores.
create or replace function public.momos_financial_facts_v1(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_started_at timestamptz:=statement_timestamp();
  v_monthly_ad numeric:=0;
  v_days integer;
  v_result jsonb;
begin
  if auth.uid() is null or public.has_current_role('Administrador') is not true then
    raise exception 'Solo Administración puede consultar hechos financieros.' using errcode='42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_from>p_to then
    raise exception 'El rango financiero no es válido.' using errcode='22007';
  end if;
  if (p_to-p_from)>366 then
    raise exception 'El rango financiero no puede superar 367 días inclusivos.' using errcode='22023';
  end if;

  v_days:=(p_to-p_from)+1;
  select coalesce(case jsonb_typeof(s.valor)
    when 'number' then nullif(s.valor#>>'{}','')::numeric
    when 'string' then nullif(btrim(s.valor#>>'{}'),'')::numeric
    else 0 end,0)
  into v_monthly_ad
  from public.app_settings s
  where s.clave='pauta_mensual';
  v_monthly_ad:=greatest(coalesce(v_monthly_ad,0),0);

  with order_facts as materialized (
    select
      o.id as order_id,
      o.fecha as order_date,
      o.canal as channel,
      o.estado as state,
      coalesce(o.pago,'') as payment_method,
      (o.pagado_en is not null) as payment_confirmed,
      o.campaign_id,
      o.creative_id,
      coalesce(t.ventas,0)::numeric as product_revenue,
      coalesce(t.cogs,0)::numeric as cogs,
      coalesce(o.descuento,0)::numeric as discount,
      coalesce(o.dom_cobrado,0)::numeric as delivery_collected,
      coalesce(o.dom_costo,0)::numeric as delivery_cost_on_order,
      coalesce(o.comision_pago,0)::numeric as payment_fee,
      (coalesce(t.ventas,0)-coalesce(o.descuento,0)+coalesce(o.dom_cobrado,0))::numeric as total_charged,
      coalesce(lines.line_count,0)::integer as line_count,
      coalesce(lines.incomplete_cost_lines,0)::integer as incomplete_cost_lines,
      exists(
        select 1 from public.evidences e
        where e.order_id=o.id and e.tipo='Comprobante de pago'
      ) as has_payment_evidence
    from public.orders o
    left join public.v_order_totals t on t.order_id=o.id
    left join lateral (
      select count(*)::integer as line_count,
        count(*) filter(
          where oi.cant<=0 or oi.precio<0
            or (not oi.es_sub_momo and oi.costo_unitario<=0)
        )::integer as incomplete_cost_lines
      from public.order_items oi where oi.order_id=o.id
    ) lines on true
    where o.fecha between p_from and p_to
  ),
  delivery_facts as materialized (
    select d.id as delivery_id,d.order_id,d.estado as state,
      coalesce(d.costo_real,0)::numeric as actual_cost,
      coalesce(d.cobrado,0)::numeric as charged
    from public.deliveries d
    join order_facts o on o.order_id=d.order_id
  ),
  claim_facts as materialized (
    select c.id as claim_id,c.order_id,c.fecha as claim_date,c.estado as state,
      coalesce(c.costo,0)::numeric as documented_cost,
      case when c.estado in ('Aprobado','Compensado')
        then coalesce(c.costo,0)::numeric else 0::numeric end as recognized_cost
    from public.claims c
    where c.fecha between p_from and p_to
  ),
  purchase_facts as materialized (
    select m.id as movement_id,l.id as lot_id,
      (m.fecha at time zone 'America/Bogota')::date as purchase_date,
      m.item_id,coalesce(m.cant,0)::numeric as quantity,
      coalesce(l.unit_cost,0)::numeric as unit_cost,
      (coalesce(m.cant,0)*coalesce(l.unit_cost,0))::numeric as documented_cost,
      l.origin
    from public.inventory_movements m
    join public.inventory_lots l
      on l.source_movement_id=m.id and l.origin='Compra'
    where (m.fecha at time zone 'America/Bogota')::date between p_from and p_to
      and m.tipo='Entrada' and m.cant>0
  ),
  ad_facts as materialized (
    select md.id as metric_id,md.fecha as metric_date,md.fuente as source,
      md.campaign_id,md.creative_id,md.post_id,coalesce(md.gasto,0)::numeric as documented_spend
    from public.metrics_daily md
    where md.fecha between p_from and p_to
  )
  select jsonb_build_object(
    'version',1,
    'server_time',v_started_at,
    'range',jsonb_build_object('from',p_from,'to',p_to,'days',v_days),
    'orders',coalesce((select jsonb_agg(to_jsonb(x) order by x.order_date,x.order_id) from order_facts x),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.order_id,x.delivery_id) from delivery_facts x),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(to_jsonb(x) order by x.claim_date,x.claim_id) from claim_facts x),'[]'::jsonb),
    'inventory_purchases',coalesce((select jsonb_agg(to_jsonb(x) order by x.purchase_date,x.movement_id,x.lot_id) from purchase_facts x),'[]'::jsonb),
    'ad_spend',coalesce((select jsonb_agg(to_jsonb(x) order by x.metric_date,x.metric_id) from ad_facts x),'[]'::jsonb),
    'configured_ad',jsonb_build_object(
      'monthly_budget',v_monthly_ad,
      'range_days',v_days,
      'prorated_budget',round(v_monthly_ad/30*v_days,2)
    ),
    'counts',jsonb_build_object(
      'orders',(select count(*) from order_facts),
      'deliveries',(select count(*) from delivery_facts),
      'claims',(select count(*) from claim_facts),
      'inventory_purchases',(select count(*) from purchase_facts),
      'ad_spend_rows',(select count(*) from ad_facts)
    ),
    'accounting_sources',jsonb_build_object(
      'order_revenue_and_cogs','v_order_totals',
      'inventory_purchases','inventory_lots.source_movement_id',
      'ad_spend','metrics_daily.gasto',
      'configured_ad','app_settings.pauta_mensual'
    ),
    'contains_pii',false,
    'contains_free_text',false,
    'contains_storage_references',false,
    'external_execution',false
  ) into v_result;

  return v_result;
end
$$;

-- La vista canónica ya respeta RLS (security_invoker). Este grant permite que
-- la función invoker la consulte con la misma frontera authenticated.
-- No amplía la frontera material: schema-v5 ya autoriza al staff a leer las
-- tablas base y costo_unitario. El gate Admin de H65 reduce esa superficie.
grant select on public.v_order_totals to authenticated;

revoke all on function public.momos_financial_facts_v1(date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.momos_financial_facts_v1(date,date)
  to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260718_65_hechos_financieros',
  'Hechos financieros completos por rango desde fuentes canónicas, sin ventanas operativas, PII, rutas ni notas'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
