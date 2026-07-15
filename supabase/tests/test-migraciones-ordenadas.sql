-- MOMOS OPS · aceptación compacta de migraciones ordenadas. Siempre ROLLBACK.
begin;

do $$
declare v_id text;
begin
  foreach v_id in array array[
    '20260714_01_evidencias_seguras','20260714_02_integridad_pedidos',
    '20260714_03_roles_flujo','20260714_04_tiempos_pedidos',
    '20260714_05_admin_operacion','20260714_06_fifo_variantes_exactas',
    '20260714_07_listo_para_empaque','20260714_08_sello_rbac',
    '20260714_09_empaque_trazable','20260714_10_domicilio_empaque',
    '20260714_11_inventario_vencimientos','20260714_12_inventario_lotes',
    '20260714_13_productos_servidor','20260714_14_control_operativo',
    '20260714_15_crm_clientes','20260714_16_agencia_comercial',
    '20260715_17_vencimiento_terminado','20260715_18_abastecimiento_interno'
  ] loop
    assert exists(select 1 from public.momos_ops_migrations where id=v_id), 'Falta registrar ' || v_id;
  end loop;

  assert to_regclass('public.packing_verifications') is not null, 'falta Empaque trazable';
  assert to_regclass('public.inventory_lots') is not null, 'falta inventario por lotes';
  assert to_regclass('public.inventory_lot_allocations') is not null, 'falta asignación FIFO de lotes';
  assert to_regclass('public.v_variantes_cuarentena') is not null, 'falta cuarentena de producto terminado';
  assert exists(select 1 from pg_trigger where tgname='orders_packing_verification_guard' and not tgisinternal), 'falta guard de Empaque';
  assert exists(select 1 from pg_trigger where tgname='orders_close_terminal_suggestions' and not tgisinternal), 'falta cierre de tareas terminales';
  assert exists(select 1 from pg_trigger where tgname='production_batches_finished_expiry_guard' and not tgisinternal), 'falta guard de vencimiento terminado';
  assert exists(select 1 from pg_trigger where tgname='inventory_lots_internal_purchase_guard' and not tgisinternal), 'falta guard de compra para elaboraciones internas';
  assert exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='production_batches' and column_name='desmoldado_en'
  ), 'falta timestamp de desmolde';
  assert exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_items' and column_name='origen_abastecimiento'
  ), 'falta origen de abastecimiento de inventario';
  assert not has_table_privilege('authenticated','public.packing_verifications','INSERT'), 'Empaque no inserta verificaciones directo';
  assert not has_table_privilege('authenticated','public.inventory_lots','INSERT'), 'staff no inserta lotes directo';
  assert has_function_privilege('authenticated','public.confirmar_verificacion_empaque(text,text[])','EXECUTE'), 'falta RPC de Empaque';
  assert has_function_privilege('authenticated','public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text)','EXECUTE'), 'falta RPC de compra por lote';
  assert has_function_privilege('authenticated','public.desechar_lote_insumo(text,text)','EXECUTE'), 'falta RPC de desecho exacto';
  assert has_function_privilege('authenticated','public.crear_producto(jsonb)','EXECUTE'), 'falta RPC de Productos';
  assert has_function_privilege('authenticated','public.productos_servidor_disponible()','EXECUTE'), 'falta sonda de Productos';
  assert has_function_privilege('authenticated','public.guardar_receta_producto(text,jsonb)','EXECUTE'), 'falta RPC de recetas';
  assert has_function_privilege('authenticated','public.tomar_etapa_pedido(text,text)','EXECUTE'), 'falta RPC de responsables';
  assert has_function_privilege('authenticated','public.aceptar_relevo_despacho(text)','EXECUTE'), 'falta RPC de relevo físico';
  assert has_function_privilege('authenticated','public.registrar_contacto_cliente(jsonb)','EXECUTE'), 'falta RPC de contactos CRM';
  assert has_function_privilege('authenticated','public.activar_beneficio_cliente(jsonb)','EXECUTE'), 'falta RPC de beneficios CRM';
  assert has_function_privilege('authenticated','public.crear_brief_agencia(jsonb)','EXECUTE'), 'falta RPC de briefs comerciales';
  assert has_function_privilege('authenticated','public.resolver_decision_agencia(bigint,text,text)','EXECUTE'), 'falta RPC de decisiones comerciales';
  assert not has_table_privilege('authenticated','public.agency_decisions','UPDATE'), 'decisiones comerciales conservan escritura directa';
  assert not has_table_privilege('authenticated','public.customer_contacts','INSERT'), 'contactos CRM conservan escritura directa';
  assert not has_table_privilege('authenticated','public.order_line_progress','UPDATE'), 'progreso conserva escritura directa';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders'), 'orders no publica cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_line_progress'), 'progreso no publica cambios en tiempo real';
  end if;
  assert not has_table_privilege('authenticated','public.products','UPDATE'), 'products conserva escritura directa';
  assert not has_table_privilege('authenticated','public.recipes','INSERT'), 'recipes conserva escritura directa';
  assert not exists(select 1 from public.v_inventory_lot_reconciliation where difference<>0), 'stock agregado y lotes no cuadran';
  assert not exists(select 1 from public.v_variantes_disponibles where vencimiento_proximo<current_date), 'FIFO terminado expone vencidos';
  assert not exists(
    select 1 from public.production_batches
    where desmoldado_en is not null
      and (
        vence is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + 3)
        or vencimiento is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + 3)
      )
  ), 'producto terminado no respeta desmolde +3 días';
  assert not exists(
    select 1
    from public.subrecetas sr
    join public.inventory_items i on i.id=sr.item_id
    where i.origen_abastecimiento<>'Producción interna'
  ), 'una elaboración interna quedó clasificada como compra';
  assert not exists(
    select 1 from public.production_suggestions ps join public.orders o on o.id=ps.order_id
    where ps.estado='Pendiente' and o.estado in ('Cancelado','Entregado')
  ), 'hay tareas pendientes de pedidos terminales';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-18 PASS, rollback total' as resultado;
  rollback;
