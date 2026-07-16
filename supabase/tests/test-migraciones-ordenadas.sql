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
    '20260715_17_vencimiento_terminado','20260715_18_abastecimiento_interno',
    '20260715_19_distribucion_comercial','20260715_20_biblioteca_creativa',
    '20260715_21_roles_multiples','20260715_22_produccion_creativa',
    '20260715_23_integraciones_agencia','20260715_24_higgsfield_conector',
    '20260715_25_kling_conector','20260715_26_revision_creativa'
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
  assert exists(select 1 from pg_trigger where tgname='content_posts_distribution_guard' and not tgisinternal), 'falta guard de publicación comercial';
  assert to_regclass('public.content_distributions') is not null, 'falta distribución comercial';
  assert to_regclass('public.brand_media_assets') is not null, 'falta biblioteca inteligente de marca';
  assert to_regclass('public.creative_generation_jobs') is not null, 'falta estudio creativo trazable';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='roles'), 'falta roles múltiples';
  assert has_function_privilege('authenticated','public.quitar_rol_usuario(text,text)','EXECUTE'), 'falta RPC para retirar roles';
  assert public.roles_multiples_disponible(), 'falta sonda de roles múltiples';
  assert not exists(select 1 from public.users where public.valid_user_roles(roles,rol) is not true), 'hay usuarios con roles inválidos';
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
  assert has_function_privilege('authenticated','public.cerrar_distribucion_publicacion(text,text,text,text,text)','EXECUTE'), 'falta RPC de cierre comercial';
  assert has_function_privilege('authenticated','public.crear_trabajo_creativo(jsonb)','EXECUTE'), 'falta RPC del estudio creativo';
  assert has_function_privilege('authenticated','public.autorizar_trabajo_creativo(bigint,numeric)','EXECUTE'), 'falta autorizacion protegida del estudio';
  assert not has_function_privilege('authenticated','public.tomar_trabajo_creativo_conector(bigint,text)','EXECUTE'), 'conector creativo privado expuesto';
  assert to_regclass('public.agency_integrations') is not null, 'falta centro de integraciones de Agencia';
  assert public.integraciones_agencia_disponibles(), 'falta sonda de integraciones de Agencia';
  assert not has_table_privilege('authenticated','public.agency_integrations','UPDATE'), 'salud de integraciones permite UPDATE directo';
  assert not has_function_privilege('authenticated','public.reportar_integracion_agencia_conector(text,text,boolean,text,jsonb,text,text,boolean)','EXECUTE'), 'heartbeat privado de integraciones expuesto';
  assert to_regclass('public.creative_connector_runs') is not null, 'falta ejecución trazable de Higgsfield';
  assert public.higgsfield_conector_disponible(), 'falta sonda del worker Higgsfield';
  assert not has_table_privilege('authenticated','public.creative_connector_runs','INSERT'), 'staff puede insertar ejecuciones del conector';
  assert not has_table_privilege('authenticated','public.creative_connector_runs','UPDATE'), 'staff puede alterar ejecuciones del conector';
  assert not has_function_privilege('authenticated','public.reclamar_trabajo_higgsfield(text,integer)','EXECUTE'), 'lease Higgsfield privado expuesto';
  assert not has_function_privilege('authenticated','public.marcar_despacho_higgsfield(bigint,uuid)','EXECUTE'), 'inicio de despacho Higgsfield privado expuesto';
  assert not has_function_privilege('authenticated','public.confirmar_despacho_higgsfield(bigint,uuid,text,numeric,jsonb)','EXECUTE'), 'despacho Higgsfield privado expuesto';
  assert not has_function_privilege('authenticated','public.registrar_salida_higgsfield(bigint,uuid,jsonb)','EXECUTE'), 'salida Higgsfield privada expuesta';
  assert public.kling_conector_disponible(), 'falta sonda del worker Kling';
  assert exists(select 1 from public.agency_integrations where provider='Kling'), 'falta Kling en el catálogo protegido';
  assert not has_function_privilege('authenticated','public.reclamar_trabajo_kling(text,integer)','EXECUTE'), 'lease Kling privado expuesto';
  assert not has_function_privilege('authenticated','public.marcar_despacho_kling(bigint,uuid,text,numeric,jsonb)','EXECUTE'), 'inicio de despacho Kling privado expuesto';
  assert not has_function_privilege('authenticated','public.conciliar_despacho_kling(bigint,uuid,text)','EXECUTE'), 'conciliación Kling privada expuesta';
  assert not has_function_privilege('authenticated','public.registrar_salida_kling(bigint,uuid,jsonb)','EXECUTE'), 'salida Kling privada expuesta';
  assert has_function_privilege('service_role','public.reportar_worker_kling(text,text,text,text,boolean)','EXECUTE'), 'worker Kling sin permiso de salud';
  assert has_function_privilege('service_role','public.reclamar_trabajo_kling(text,integer)','EXECUTE'), 'worker Kling sin permiso de cola';
  assert public.revision_creativa_disponible(), 'falta sonda de revisión creativa';
  assert has_function_privilege('authenticated','public.revisar_salida_creativa(bigint,text,text)','EXECUTE'), 'falta revisión humana de salidas IA';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='creative_generation_jobs' and column_name='output_review_status'), 'falta estado de revisión de salida';
  assert not exists(select 1 from public.creative_generation_jobs where status='Completado' and output_asset_id is not null and output_review_status='No aplica'), 'salida completada sin revisión pendiente o sellada';
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

select 'TESTS_OK — migraciones ordenadas 01-26 PASS, rollback total' as resultado;
rollback;
