-- MOMOS OPS · prueba H80 preflight de elaboraciones. Siempre ROLLBACK.
begin;

do $$
declare
  v_auth uuid;
  v_sabor text;
  v_mousse_item_id text;
  v_figura text;
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_80_produccion_preflight_elaboraciones'
  ), 'Falta aplicar la migración H80.';
  assert exists(
    select 1 from pg_trigger
    where tgname='production_batches_prepared_stock_guard'
      and tgrelid='public.production_batches'::regclass
      and not tgisinternal
      and tgenabled='O'
  ), 'Falta el trigger obligatorio de preflight.';
  assert not has_function_privilege(
    'authenticated','public._production_batch_prepared_stock_guard()','EXECUTE'
  ), 'La función interna quedó expuesta a authenticated.';

  select u.auth_id into v_auth
  from public.users u
  where u.activo and u.auth_id is not null
  order by (u.rol='Administrador') desc,u.id
  limit 1;

  select sr.sabor,sr.item_id into v_sabor,v_mousse_item_id
  from public.subrecetas sr
  where sr.activo
    and sr.tipo in ('mousse_frutal','mousse_cremosa')
  order by sr.id
  limit 1;

  select f.nombre into v_figura
  from public.figuras f
  where f.activo and f.product_id is not null and f.gramaje_g>0
  order by f.orden,f.nombre
  limit 1;

  assert v_auth is not null, 'Falta un usuario staff autenticable.';
  assert v_sabor is not null and v_mousse_item_id is not null,
    'Falta una mousse activa para la prueba.';
  assert v_figura is not null, 'Falta una figura producible para la prueba.';

  update public.inventory_items set stock=0 where id=v_mousse_item_id;
  perform set_config('momos.h80_actor_auth',v_auth::text,true);
  perform set_config('momos.h80_sabor',v_sabor,true);
  perform set_config('momos.h80_figura',v_figura,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',current_setting('momos.h80_actor_auth'),
    'role','authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_failed boolean:=false;
begin
  begin
    perform public.crear_corrida(jsonb_build_object(
      'sabor',current_setting('momos.h80_sabor'),
      'figuras',jsonb_build_array(jsonb_build_object(
        'figura',current_setting('momos.h80_figura'),'cant',1
      )),
      'obs','H80 PREFLIGHT TEST',
      'idempotency_key','h80-preflight-elaboraciones-test'
    ));
  exception when sqlstate '23514' then
    v_failed:=true;
    assert sqlerrm like '%Prepará y registrá esta elaboración%'
        or sqlerrm like '%falta en inventario una elaboración requerida%',
      'El bloqueo no explica cómo corregir el faltante: '||sqlerrm;
  end;

  assert v_failed,
    'crear_corrida permitió fabricar sin todas las elaboraciones preparadas.';
  assert not exists(
    select 1 from public.production_batches b
    where b.obs='H80 PREFLIGHT TEST'
  ), 'Quedó creado un lote pese al preflight fallido.';
  assert not exists(
    select 1 from public.corridas c
    where c.obs='H80 PREFLIGHT TEST'
  ), 'Quedó creada una corrida huérfana pese al preflight fallido.';
end $$;

reset role;
select 'TESTS_OK — preflight de elaboraciones/RBAC/rollback transaccional PASS, rollback total' as resultado;
rollback;
