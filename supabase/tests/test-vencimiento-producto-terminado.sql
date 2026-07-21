-- MOMOS OPS · vencimiento de producto terminado. Siempre ROLLBACK.
begin;

do $$
declare
  v_batch text := 'TST-VENCE-' || txid_current()::text;
  v_fixed text := 'TST-VENCE-TZ-' || txid_current()::text;
  v_expired text := 'TST-VENCE-EXP-' || txid_current()::text;
  v_product text;
  v_desmoldado timestamptz;
  v_vence date;
  v_alias date;
  v_days integer;
begin
  assert exists (
    select 1 from public.momos_ops_migrations
    where id = '20260715_17_vencimiento_terminado'
  ), 'falta paso 17_vencimiento_terminado';
  select coalesce((valor#>>'{}')::integer,3) into v_days
  from public.app_settings where clave='vida_util_producto_terminado_dias';
  v_days:=coalesce(v_days,3);

  -- Un lote en proceso no empieza vida útil, aunque un cliente viejo mande fecha.
  insert into public.production_batches(
    id, fecha, prod, estado, stock_contabilizado, vence, vencimiento
  ) values (
    v_batch, current_date, 1, 'En preparación', false, current_date + 99, current_date + 99
  );
  select desmoldado_en, vence, vencimiento
  into v_desmoldado, v_vence, v_alias
  from public.production_batches where id = v_batch;
  assert v_desmoldado is null, 'un lote en proceso quedó desmoldado';
  assert v_vence is null and v_alias is null, 'un lote en proceso recibió vencimiento';

  -- El cambio atómico usado por desmoldar_lote sella la regla vigente.
  update public.production_batches
  set estado = 'Listo', stock_contabilizado = true,
      perfectas = 1, imperfectas = 0, descartadas = 0
  where id = v_batch;
  select desmoldado_en, vence, vencimiento
  into v_desmoldado, v_vence, v_alias
  from public.production_batches where id = v_batch;
  assert v_desmoldado is not null, 'el desmolde no selló desmoldado_en';
  assert v_vence = (v_desmoldado at time zone 'America/Bogota')::date + v_days,
    'vence no corresponde a la vida útil vigente desde el desmolde';
  assert v_alias = v_vence, 'vence y vencimiento quedaron divergentes';

  -- Ni la fecha visible ni el timestamp pueden rejuvenecerse manualmente.
  update public.production_batches
  set vence = current_date + 90,
      vencimiento = current_date + 90,
      desmoldado_en = desmoldado_en + interval '1 day'
  where id = v_batch;
  assert exists (
    select 1 from public.production_batches
    where id = v_batch
      and desmoldado_en = v_desmoldado
      and vence = v_vence
      and vencimiento = v_alias
  ), 'una edición manual rejuveneció el lote';

  -- La fecha se calcula en Bogotá incluso cerca del cambio de día UTC.
  insert into public.production_batches(
    id, fecha, prod, estado, stock_contabilizado, desmoldado_en
  ) values (
    v_fixed, date '2026-07-15', 1, 'Listo', true, timestamptz '2026-07-15 23:30:00-05'
  );
  assert exists (
    select 1 from public.production_batches
    where id = v_fixed
      and vence = date '2026-07-15' + v_days
      and vencimiento = date '2026-07-15' + v_days
  ), 'el cálculo no respetó la fecha local de Bogotá';

  -- Un desmolde anterior a la vida útil ya está vencido: aparece en cuarentena y
  -- jamás en la disponibilidad exacta que consume el FIFO.
  select id into v_product from public.products order by id limit 1;
  assert v_product is not null, 'el test necesita al menos un producto';
  insert into public.production_batches(
    id, fecha, product_id, figura, sabor, gramaje_g, prod,
    perfectas, imperfectas, descartadas, estado, stock_contabilizado, desmoldado_en
  ) values (
    v_expired, current_date - (v_days + 1), v_product, 'TST Figura', 'TST Sabor', 150, 1,
    1, 0, 0, 'Listo', true, now() - make_interval(days=>v_days+1)
  );
  insert into public.lote_figuras(batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values(v_expired, 'TST Figura', 1, 1, 0, 0);
  assert not exists (
    select 1 from public.v_variantes_disponibles
    where product_id = v_product and figura = 'TST Figura' and sabor = 'TST Sabor'
  ), 'FIFO expuso producto terminado vencido';
  assert exists (
    select 1 from public.v_variantes_cuarentena
    where product_id = v_product and figura = 'TST Figura' and sabor = 'TST Sabor'
  ), 'el producto terminado vencido no llegó a cuarentena';

  assert not exists (
    select 1 from public.production_batches
    where desmoldado_en is not null
      and (
        vida_util_dias is null
        or vence is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + vida_util_dias)
        or vencimiento is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + vida_util_dias)
      )
  ), 'hay lotes desmoldados fuera de su vida útil sellada';
end $$;

select 'TESTS_OK — producto terminado usa vida útil configurable desde desmolde, fecha inmutable, rollback total' as resultado;
rollback;
