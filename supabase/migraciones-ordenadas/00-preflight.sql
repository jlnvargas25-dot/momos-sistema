-- MOMOS OPS · preflight de migraciones ordenadas (solo lectura)
-- Éxito: devuelve una fila con listo = true. Siempre termina en ROLLBACK.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
declare
  v_faltantes text[] := array[]::text[];
begin
  if to_regclass('public.orders') is null then v_faltantes := array_append(v_faltantes, 'public.orders'); end if;
  if to_regclass('public.order_items') is null then v_faltantes := array_append(v_faltantes, 'public.order_items'); end if;
  if to_regclass('public.evidences') is null then v_faltantes := array_append(v_faltantes, 'public.evidences'); end if;
  if to_regclass('public.figuras') is null then v_faltantes := array_append(v_faltantes, 'public.figuras'); end if;
  if to_regclass('public.catalog_values') is null then v_faltantes := array_append(v_faltantes, 'public.catalog_values'); end if;
  if to_regclass('storage.objects') is null then v_faltantes := array_append(v_faltantes, 'storage.objects'); end if;
  if to_regclass('public.lote_figuras') is null then v_faltantes := array_append(v_faltantes, 'public.lote_figuras (variantes-v1.sql)'); end if;
  if to_regclass('public.inventory_reservations') is null then v_faltantes := array_append(v_faltantes, 'public.inventory_reservations'); end if;
  if to_regprocedure('public.crear_evidencia(text,text,text)') is null then v_faltantes := array_append(v_faltantes, 'crear_evidencia(text,text,text)'); end if;
  if to_regprocedure('public.crear_pedido(jsonb)') is null then v_faltantes := array_append(v_faltantes, 'crear_pedido(jsonb)'); end if;
  if to_regprocedure('public.set_order_status(text,text,boolean)') is null then v_faltantes := array_append(v_faltantes, 'set_order_status(text,text,boolean)'); end if;
  if to_regprocedure('public._add_reservation(text,text,text,text,text,numeric)') is null then v_faltantes := array_append(v_faltantes, '_add_reservation(text,text,text,text,text,numeric)'); end if;
  if cardinality(v_faltantes) > 0 then
    raise exception 'PRECHECK FALLÓ. Faltan dependencias: %', array_to_string(v_faltantes, ', ');
  end if;

  if exists (
    select 1 from public.evidences
    where storage_path is not null
    group by storage_path having count(*) > 1
  ) then
    raise exception 'PRECHECK FALLÓ. Hay storage_path repetidos en evidences; reconciliarlos antes del paso 01.';
  end if;

  if exists (
    select 1 from public.order_items
    where cant <= 0 or cant <> trunc(cant)
  ) then
    raise exception 'PRECHECK FALLÓ. Hay cantidades no enteras/no positivas en order_items; reconciliarlas antes del paso 02.';
  end if;
end $$;

select true as listo,
       (select count(*) from public.orders) as pedidos,
       (select count(*) from public.evidences) as evidencias,
       (select count(*) from public.order_items) as lineas;

rollback;
