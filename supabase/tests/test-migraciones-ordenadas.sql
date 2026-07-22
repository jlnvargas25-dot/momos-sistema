-- MOMOS OPS · aceptación compacta de migraciones ordenadas. Siempre ROLLBACK.
begin;

do $$
declare v_id text; v_sources text[];
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
    '20260715_25_kling_conector','20260715_26_revision_creativa',
    '20260715_27_versiones_creativas','20260715_28_orquestador_agencia',
    '20260716_29_distribucion_conectores','20260716_30_mesa_agencia',
    '20260716_31_estudio_escenas','20260716_32_enrutador_escenas',
    '20260716_33_calidad_postproduccion','20260716_34_retencion_aprendizaje',
    '20260716_35_experiencia_loops','20260716_36_experiencia_motion',
    '20260716_37_observatorio_meta','20260716_38_incrementalidad_meta',
    '20260716_39_escenarios_inversion','20260716_40_autorizacion_inversion',
    '20260716_41_meta_conector_dry_run','20260716_42_mcp_agency_gateway',
    '20260716_43_ciclo_cooperativo_mcp','20260716_44_bandeja_semantica_agencia',
    '20260716_45_centro_acciones_agencia','20260716_46_resultados_verificables_agencia',
    '20260716_47_postproduccion_exportacion','20260716_48_audio_postproduccion',
    '20260716_49_gobernanza_marca','20260716_50_flujo_creativo_e2e',
    '20260717_51_eliminacion_biblioteca','20260717_52_catalogo_figuras_toby',
    '20260717_53_motor_crecimiento_multimodo','20260717_54_mcp_biblioteca_creativa',
    '20260717_55_identidad_marca','20260717_56_data_sync_rendimiento',
    '20260717_57_reingreso_archivo_eliminado','20260718_58_edicion_biblioteca',
    '20260718_59_mundo_animado','20260718_60_eliminacion_logo_oficial',
    '20260718_61_biblioteca_produccion','20260718_62_mcp_aprobacion_humana',
    '20260718_63_mcp_aprobacion_humana_rbac','20260718_64_integridad_snapshot_realtime',
    '20260718_65_hechos_financieros','20260718_66_agency_snapshot_rendimiento',
    '20260718_67_agency_operational_facts','20260719_68_inventario_precision_lotes',
    '20260719_69_inventario_deltas','20260719_70_inventario_delta_consistencia',
    '20260719_71_pedidos_deltas','20260719_72_producto_terminado_deltas',
    '20260719_73_produccion_deltas','20260719_74_catalogo_crm_deltas',
    '20260719_75_finanzas_operativas','20260719_76_configuracion_servidor',
    '20260719_77_dashboard_operativo','20260719_78_produccion_estados_fisicos',
    '20260719_79_historial_operativo_paginado',
    '20260719_80_produccion_preflight_elaboraciones',
    '20260719_81_domicilios_snapshot',
    '20260719_82_domicilios_mutaciones_atomicas',
    '20260719_83_vida_util_produccion',
    '20260720_84_desecho_producto_terminado'
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
  assert not has_function_privilege('service_role','public.reportar_worker_kling(text,text,text,text,boolean)','EXECUTE')
    and has_function_privilege('service_role','public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text)','EXECUTE'),
    'worker Kling no migró al heartbeat v2 con entorno sellado';
  assert has_function_privilege('service_role','public.reclamar_trabajo_kling(text,integer)','EXECUTE'), 'worker Kling sin permiso de cola';
  assert public.revision_creativa_disponible(), 'falta sonda de revisión creativa';
  assert has_function_privilege('authenticated','public.revisar_salida_creativa(bigint,text,text)','EXECUTE'), 'falta revisión humana de salidas IA';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='creative_generation_jobs' and column_name='output_review_status'), 'falta estado de revisión de salida';
  assert not exists(select 1 from public.creative_generation_jobs where status='Completado' and output_asset_id is not null and output_review_status='No aplica'), 'salida completada sin revisión pendiente o sellada';
  assert public.versiones_creativas_disponibles(), 'falta sonda de versiones creativas';
  assert has_function_privilege('authenticated','public.crear_revision_salida_creativa(bigint)','EXECUTE'), 'falta creación protegida de versiones';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='creative_generation_jobs' and column_name='revision_of_job_id'), 'falta cadena de versiones creativas';
  assert public.orquestador_agencia_disponible(), 'falta sonda del orquestador de Agencia';
  assert to_regclass('public.agency_agent_runs') is not null and to_regclass('public.agency_agent_proposals') is not null, 'falta bandeja del cerebro de Agencia';
  assert has_function_privilege('authenticated','public.resolver_propuesta_orquestador(bigint,text,text)','EXECUTE'), 'falta aprobación humana del orquestador';
  assert has_function_privilege('service_role','public.registrar_corrida_orquestador_agente(jsonb)','EXECUTE'), 'falta contrato privado MCP';
  assert not has_function_privilege('authenticated','public.registrar_corrida_orquestador_agente(jsonb)','EXECUTE'), 'contrato MCP expuesto al navegador';
  assert not has_table_privilege('authenticated','public.agency_agent_proposals','UPDATE'), 'propuestas del agente admiten escritura directa';
  assert public.distribucion_conectores_disponible(), 'falta sonda de distribución por conectores';
  assert to_regclass('public.distribution_connector_jobs') is not null, 'falta outbox de distribución por conectores';
  assert has_function_privilege('authenticated','public.autorizar_despacho_distribucion(text,text)','EXECUTE'), 'falta autorización humana de despacho';
  assert not has_table_privilege('authenticated','public.distribution_connector_jobs','INSERT'), 'navegador puede insertar despachos externos';
  assert not has_table_privilege('authenticated','public.distribution_connector_jobs','UPDATE'), 'navegador puede alterar despachos externos';
  assert has_function_privilege('service_role','public.reclamar_despacho_distribucion(text,integer)','EXECUTE'), 'worker de distribución sin lease';
  assert has_function_privilege('service_role','public.conciliar_despacho_distribucion(bigint,text,text,text,text,numeric,jsonb)','EXECUTE'), 'worker de distribución sin conciliación';
  assert not has_function_privilege('authenticated','public.reclamar_despacho_distribucion(text,integer)','EXECUTE'), 'lease de distribución expuesto al navegador';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_connector_completion' and not tgisinternal), 'borrador no se concilia con cierre humano';
  assert public.mesa_agencia_disponible(), 'falta sonda de Mesa cooperativa';
  assert to_regclass('public.agency_collaboration_rooms') is not null and to_regclass('public.agency_creative_contracts') is not null, 'falta Mesa o contrato creativo';
  assert has_function_privilege('authenticated','public.abrir_mesa_agencia(jsonb)','EXECUTE'), 'falta apertura humana de Mesa';
  assert has_function_privilege('authenticated','public.aprobar_contrato_creativo(bigint,text)','EXECUTE'), 'falta aprobación humana del contrato';
  assert has_function_privilege('service_role','public.registrar_aporte_agente_mesa(jsonb)','EXECUTE'), 'falta aporte privado del agente';
  assert not has_function_privilege('authenticated','public.registrar_aporte_agente_mesa(jsonb)','EXECUTE'), 'aporte del agente expuesto al navegador';
  assert not has_table_privilege('authenticated','public.agency_creative_contracts','UPDATE'), 'contrato creativo admite aprobación directa';
  assert public.estudio_escenas_disponible(), 'falta sonda del Estudio por escenas';
  assert to_regclass('public.agency_storyboards') is not null and to_regclass('public.agency_storyboard_shots') is not null, 'falta storyboard o tomas versionadas';
  assert has_function_privilege('authenticated','public.crear_storyboard_agencia(jsonb)','EXECUTE'), 'falta apertura gobernada del storyboard';
  assert has_function_privilege('authenticated','public.guardar_toma_storyboard(jsonb)','EXECUTE'), 'falta versionado gobernado de tomas';
  assert has_function_privilege('authenticated','public.enviar_storyboard_revision(bigint)','EXECUTE'), 'falta envío humano a revisión';
  assert has_function_privilege('authenticated','public.resolver_storyboard_agencia(bigint,text,text)','EXECUTE'), 'falta aprobación humana del storyboard';
  assert not has_table_privilege('authenticated','public.agency_storyboards','INSERT'), 'storyboards admiten inserción directa';
  assert not has_table_privilege('authenticated','public.agency_storyboard_shots','UPDATE'), 'tomas admiten reescritura directa';
  assert public.enrutador_escenas_disponible(), 'falta sonda del Enrutador de escenas';
  assert to_regclass('public.agency_scene_routing_plans') is not null, 'falta enrutamiento multimotor sellado';
  assert has_function_privilege('authenticated','public.preparar_enrutamiento_escenas(jsonb)','EXECUTE'), 'falta preparación humana de rutas';
  assert has_function_privilege('authenticated','public.resolver_enrutamiento_escenas(bigint,text,text)','EXECUTE'), 'falta autorización humana de rutas';
  assert has_function_privilege('service_role','public.registrar_plan_enrutamiento_agente(jsonb)','EXECUTE'), 'falta propuesta privada del cerebro MCP';
  assert not has_function_privilege('authenticated','public.registrar_plan_enrutamiento_agente(jsonb)','EXECUTE'), 'propuesta MCP expuesta al navegador';
  assert not has_table_privilege('authenticated','public.agency_scene_routing_plans','UPDATE'), 'planes de motor admiten reescritura directa';
  assert public.calidad_postproduccion_disponible(), 'falta sonda de Calidad y postproducción';
  assert to_regclass('public.agency_scene_quality_reviews') is not null and to_regclass('public.agency_postproduction_packages') is not null, 'faltan QA o paquetes de postproducción';
  assert not has_table_privilege('authenticated','public.agency_scene_quality_reviews','UPDATE'), 'QA de escenas admite reescritura directa';
  assert public.retencion_guiones_disponible(), 'falta sonda de guiones de retención';
  assert to_regclass('public.agency_retention_scripts') is not null and to_regclass('public.agency_retention_measurements') is not null, 'faltan guiones o mediciones de retención';
  assert not has_table_privilege('authenticated','public.agency_retention_measurements','UPDATE'), 'mediciones de retención admiten reescritura directa';
  assert public.retencion_loops_disponible(), 'falta sonda de experiencia de loops';
  assert to_regclass('public.agency_retention_diagnostics') is not null and to_regclass('public.agency_retention_learnings') is not null, 'faltan diagnósticos o aprendizajes de loops';
  assert not has_table_privilege('authenticated','public.agency_retention_learnings','UPDATE'), 'aprendizajes admiten reescritura directa';
  assert public.motion_experience_disponible(), 'falta sonda de Dirección motion';
  assert to_regclass('public.agency_motion_plans') is not null and to_regclass('public.agency_motion_recipes') is not null, 'faltan planes o recetas motion';
  assert has_function_privilege('authenticated','public.resolver_plan_motion(bigint,text,text)','EXECUTE'), 'falta revisión humana de motion';
  assert not has_function_privilege('authenticated','public.proponer_plan_motion_agente(jsonb)','EXECUTE'), 'propuesta privada motion expuesta';
  assert public.observatorio_meta_disponible(), 'falta sonda del Observatorio Meta';
  assert to_regclass('public.agency_meta_signal_snapshots') is not null and to_regclass('public.agency_meta_diagnostics') is not null, 'faltan señales o diagnósticos Meta';
  assert has_function_privilege('authenticated','public.preparar_diagnostico_meta(bigint,text)','EXECUTE'), 'falta diagnóstico Meta humano';
  assert not has_function_privilege('authenticated','public.registrar_snapshot_meta_conector(jsonb)','EXECUTE'), 'ingesta Meta privada expuesta';
  assert has_function_privilege('service_role','public.registrar_snapshot_meta_conector(jsonb)','EXECUTE'), 'conector Meta sin permiso privado';
  assert not has_table_privilege('authenticated','public.agency_meta_signal_snapshots','UPDATE'), 'snapshots Meta admiten reescritura directa';
  assert public.incrementalidad_meta_disponible(), 'falta sonda de Incrementalidad Meta';
  assert to_regclass('public.agency_meta_lift_studies') is not null and to_regclass('public.agency_meta_lift_measurements') is not null, 'faltan estudios o mediciones lift';
  assert has_function_privilege('authenticated','public.crear_estudio_incremental_meta(jsonb)','EXECUTE'), 'falta diseño humano de estudios lift';
  assert not has_function_privilege('authenticated','public.registrar_medicion_incremental_meta_conector(jsonb)','EXECUTE'), 'medición lift privada expuesta';
  assert has_function_privilege('service_role','public.registrar_medicion_incremental_meta_conector(jsonb)','EXECUTE'), 'conector lift sin permiso privado';
  assert not has_table_privilege('authenticated','public.agency_meta_lift_measurements','UPDATE'), 'mediciones lift admiten reescritura directa';
  assert public.escenarios_inversion_meta_disponible(), 'falta sonda de escenarios de inversión Meta';
  assert to_regclass('public.agency_meta_investment_scenarios') is not null, 'faltan escenarios de inversión Meta';
  assert has_function_privilege('authenticated','public.crear_escenarios_inversion_meta(jsonb)','EXECUTE'), 'falta preparación humana de escenarios Meta';
  assert not has_function_privilege('authenticated','public.proponer_escenarios_inversion_meta_agente(jsonb,text)','EXECUTE'), 'propuesta privada de inversión expuesta';
  assert has_function_privilege('service_role','public.proponer_escenarios_inversion_meta_agente(jsonb,text)','EXECUTE'), 'cerebro sin propuesta privada de inversión';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_scenarios','UPDATE'), 'escenarios Meta admiten reescritura directa';
  assert public.autorizacion_inversion_meta_disponible(), 'falta sonda de autorización de inversión Meta';
  assert to_regclass('public.agency_meta_investment_authorizations') is not null and to_regclass('public.agency_meta_investment_execution_jobs') is not null, 'faltan autorizaciones o ensayos de inversión Meta';
  assert has_function_privilege('authenticated','public.solicitar_autorizacion_inversion_meta(jsonb)','EXECUTE'), 'falta solicitud humana de autorización Meta';
  assert has_function_privilege('authenticated','public.resolver_autorizacion_inversion_meta(bigint,text,text)','EXECUTE'), 'falta resolución humana de autorización Meta';
  assert not has_function_privilege('authenticated','public.reclamar_simulacion_inversion_meta(text,integer)','EXECUTE'), 'worker de simulación expuesto al navegador';
  assert has_function_privilege('service_role','public.reclamar_simulacion_inversion_meta(text,integer)','EXECUTE'), 'worker privado sin acceso al ensayo Meta';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_authorizations','INSERT'), 'autorizaciones Meta admiten inserción directa';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_execution_jobs','UPDATE'), 'ensayos Meta admiten reescritura directa';
  assert public.meta_conector_dry_run_disponible(), 'falta conector Meta dry-run';
  assert to_regclass('public.agency_meta_connector_dry_runs') is not null, 'falta evidencia del conector Meta';
  assert has_function_privilege('authenticated','public.preparar_dry_run_meta(bigint,text,text)','EXECUTE'), 'falta preparación humana del dry-run Meta';
  assert not has_function_privilege('authenticated','public.reclamar_dry_run_meta(text,integer)','EXECUTE'), 'worker Meta expuesto al navegador';
  assert has_function_privilege('service_role','public.reclamar_dry_run_meta(text,integer)','EXECUTE'), 'worker Meta privado sin acceso';
  assert not has_table_privilege('authenticated','public.agency_meta_connector_dry_runs','UPDATE'), 'evidencia Meta admite reescritura directa';
  assert public.mcp_agency_gateway_disponible(), 'falta Gateway MCP semántico';
  assert to_regclass('public.agency_mcp_access_log') is not null, 'falta bitácora del Gateway MCP';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'cerebro MCP sin contexto privado';
  assert has_function_privilege('service_role','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'), 'cerebro MCP sin trazabilidad';
  assert not has_function_privilege('authenticated','public.obtener_contexto_director_agencia()','EXECUTE'), 'contexto MCP expuesto al navegador';
  assert not has_function_privilege('authenticated','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'), 'navegador suplanta al Gateway MCP';
  assert not has_table_privilege('authenticated','public.agency_mcp_access_log','UPDATE'), 'bitácora MCP admite reescritura directa';
  assert public.mcp_agency_feedback_disponible(), 'falta retorno cooperativo del Cerebro MCP';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'Cerebro MCP sin feedback humano';
  assert not has_function_privilege('authenticated','public._obtener_contexto_director_agencia_h42()','EXECUTE'), 'navegador salta sanitización del feedback MCP';
  assert not has_function_privilege('service_role','public._agency_mcp_human_feedback()','EXECUTE'), 'helper de feedback expuesto al runtime';
  assert public.mcp_agency_action_queue_disponible(), 'falta bandeja semántica del Cerebro MCP';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'Cerebro MCP sin bandeja semántica';
  assert not has_function_privilege('authenticated','public._obtener_contexto_director_agencia_h43()','EXECUTE'), 'navegador salta sanitización de la bandeja MCP';
  assert not has_function_privilege('service_role','public._agency_mcp_next_action(bigint)','EXECUTE'), 'helper de siguiente acción expuesto al runtime';
  assert not has_function_privilege('service_role','public._agency_mcp_action_queue()','EXECUTE'), 'helper de cola semántica expuesto al runtime';
  assert public.centro_acciones_agencia_disponible(), 'falta Centro humano de acciones de Agencia';
  assert has_function_privilege('authenticated','public.obtener_bandeja_acciones_agencia()','EXECUTE'), 'Centro de acciones no disponible para usuarios autenticados';
  assert not has_function_privilege('anon','public.obtener_bandeja_acciones_agencia()','EXECUTE'), 'Centro de acciones expuesto a anon';
  assert not has_function_privilege('authenticated','public._agency_mcp_action_queue()','EXECUTE'), 'Centro de acciones expone helper privado';
  assert public.resultados_acciones_agencia_disponibles(), 'falta cierre verificable de acciones de Agencia';
  assert to_regclass('public.agency_action_outcomes') is not null, 'falta ledger de resultados de Agencia';
  assert has_function_privilege('authenticated','public.registrar_resultado_accion_agencia(jsonb)','EXECUTE'), 'falta RPC de resultados verificables';
  assert not has_table_privilege('authenticated','public.agency_action_outcomes','INSERT'), 'resultados de Agencia permiten INSERT directo';
  assert not has_table_privilege('authenticated','public.agency_action_outcomes','UPDATE'), 'resultados de Agencia permiten UPDATE directo';
  assert exists(select 1 from pg_trigger where tgname='agency_decisions_outcome_guard' and not tgisinternal), 'falta guard contra cierre libre de decisiones';
  assert public.postproduccion_exportacion_disponible(), 'falta exportación verificable de postproducción';
  assert to_regclass('public.agency_postproduction_exports') is not null, 'falta cola de exportación de másters';
  assert has_function_privilege('authenticated','public.autorizar_exportacion_postproduccion(jsonb)','EXECUTE'), 'falta autorización humana de exportación';
  assert has_function_privilege('service_role','public.reclamar_exportacion_postproduccion(text,integer)','EXECUTE'), 'worker de exportación sin lease';
  assert not has_function_privilege('authenticated','public.reclamar_exportacion_postproduccion(text,integer)','EXECUTE'), 'lease de exportación expuesto al navegador';
  assert not has_table_privilege('authenticated','public.agency_postproduction_exports','INSERT'), 'exportaciones admiten inserción directa';
  assert not has_table_privilege('authenticated','public.agency_postproduction_exports','UPDATE'), 'exportaciones admiten reescritura directa';
  assert public.postproduccion_audio_disponible(), 'falta audio trazable de postproducción';
  assert to_regclass('public.agency_postproduction_export_audio') is not null, 'falta ledger de audio por exportación';
  assert has_function_privilege('authenticated','public.autorizar_exportacion_postproduccion(jsonb)','EXECUTE'), 'falta autorización humana de pista y máster';
  assert not has_function_privilege('authenticated','public.reclamar_exportacion_postproduccion(text,integer)','EXECUTE'), 'worker de audio expuesto al navegador';
  assert not has_table_privilege('authenticated','public.agency_postproduction_export_audio','UPDATE'), 'audio aprobado admite reescritura';
  assert public.gobernanza_marca_disponible(), 'falta gobernanza determinística de marca';
  assert to_regclass('public.agency_brand_profiles') is not null and to_regclass('public.agency_brand_gate_bindings') is not null, 'faltan perfil o gates de marca';
  assert has_function_privilege('authenticated','public.preparar_perfil_marca(jsonb,text)','EXECUTE'), 'falta versionado gobernado de marca';
  assert has_function_privilege('authenticated','public.activar_perfil_marca(bigint,text)','EXECUTE'), 'falta activación humana de marca';
  assert not has_table_privilege('authenticated','public.agency_brand_profiles','UPDATE'), 'marca admite reescritura directa';
  assert not has_table_privilege('authenticated','public.agency_brand_gate_bindings','INSERT'), 'gates de marca admiten escritura directa';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_brand_gate' and not tgisinternal), 'falta gate final de marca';
  assert exists(select 1 from pg_trigger where tgname='distribution_connector_brand_gate' and not tgisinternal), 'conector puede saltar gate de marca';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='content_distributions' and column_name='content_mode'), 'distribución no separa Pauta de Orgánico';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_mode_guard' and not tgisinternal), 'intención Pauta/Orgánico admite reescritura';
  assert public._agency_brand_content_contract_valid('Pauta','Pedidos pagados','Convertir demanda','{"paid_and_organic_separated":true}'::jsonb), 'contrato Pauta inválido';
  assert not public._agency_brand_content_contract_valid('Orgánico','CPA','Construir afinidad','{"paid_and_organic_separated":true}'::jsonb), 'métricas Pauta/Orgánico mezcladas';
  assert public.flujo_creativo_e2e_disponible(), 'falta flujo creativo E2E';
  assert to_regclass('public.agency_master_releases') is not null and to_regclass('public.agency_master_release_events') is not null, 'faltan relevo o eventos del máster exacto';
  assert has_function_privilege('authenticated','public.preparar_relevo_master_creativo(bigint,text)','EXECUTE'), 'falta relevo humano del máster';
  assert has_function_privilege('authenticated','public.vincular_publicacion_master(bigint,text)','EXECUTE'), 'falta vínculo de publicación exacta';
  assert not has_table_privilege('authenticated','public.agency_master_releases','UPDATE'), 'el relevo exacto admite reescritura directa';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_master_lineage_before' and not tgisinternal), 'distribución puede saltar el máster exacto';
  assert public.eliminacion_biblioteca_disponible(), 'falta eliminación segura de Biblioteca';
  assert public.edicion_biblioteca_disponible(), 'falta edición segura y versionada de Biblioteca';
  assert public.mundo_animado_disponible(), 'falta Mundo animado y su taxonomía protegida';
  assert public.eliminacion_logo_oficial_disponible(), 'falta eliminación protegida del logo oficial';
  assert exists(select 1 from pg_trigger where tgname='validar_taxonomia_mundo_animado' and not tgisinternal), 'falta guard del Mundo animado';
  assert to_regclass('public.brand_media_asset_metadata_versions') is not null,
    'falta historial de metadatos de Biblioteca';
  assert not has_table_privilege('authenticated','public.brand_media_assets','UPDATE'),
    'edición de Biblioteca permite saltarse la RPC protegida';
  assert not has_table_privilege('authenticated','public.brand_media_asset_metadata_versions','INSERT'),
    'edición de Biblioteca permite fabricar versiones';
  assert has_function_privilege('authenticated','public.preparar_eliminacion_activo_marca(bigint)','EXECUTE'), 'falta preparar eliminación de Biblioteca';
  assert has_function_privilege('authenticated','public.cancelar_eliminacion_activo_marca(bigint,text)','EXECUTE'), 'falta compensación de eliminación de Biblioteca';
  assert has_function_privilege('authenticated','public.confirmar_eliminacion_activo_marca(bigint)','EXECUTE'), 'falta cierre de eliminación de Biblioteca';
  assert not has_function_privilege('authenticated','public._motivos_bloqueo_eliminacion_activo(bigint)','EXECUTE'), 'helper privado de eliminación expuesto';
  assert has_function_privilege('authenticated','public.preparar_eliminacion_logo_oficial(bigint,text)','EXECUTE'), 'falta preparar eliminación protegida del logo';
  assert has_function_privilege('authenticated','public.confirmar_eliminacion_logo_oficial(bigint,text)','EXECUTE'), 'falta cerrar eliminación protegida del logo';
  assert not has_function_privilege('authenticated','public._motivos_bloqueo_eliminacion_logo_oficial(bigint)','EXECUTE'), 'helper privado del logo expuesto';
  assert exists(select 1 from public.figuras where nombre='Momo' and activo), 'Momo falta en el catálogo activo de figuras';
  assert exists(select 1 from public.figuras where nombre='Toby' and activo and gramaje_g=280), 'Toby no está activo como figura de 280 g';
  assert to_regclass('public.agency_growth_snapshots') is not null, 'falta motor de crecimiento multimodo';
  assert (select count(*) from public.agency_growth_mode_policies where active)=4, 'falta alguno de los cuatro modos de crecimiento';
  assert has_function_privilege('authenticated','public.registrar_snapshot_motor_crecimiento(jsonb)','EXECUTE'), 'falta RPC del motor de crecimiento';
  assert not has_table_privilege('authenticated','public.agency_growth_selections','INSERT'), 'selecciones de crecimiento permiten bypass directo';
  assert public.mcp_biblioteca_creativa_disponible(), 'falta Biblioteca Creativa gobernada por MCP';
  assert has_function_privilege('service_role','public.mcp_biblioteca_creativa_contrato()','EXECUTE'), 'Cerebro MCP sin sonda de contrato de Biblioteca';
  assert not has_function_privilege('authenticated','public.mcp_biblioteca_creativa_contrato()','EXECUTE'), 'sonda privada de Biblioteca expuesta al navegador';
  assert to_regclass('public.agency_mcp_asset_searches') is not null and to_regclass('public.agency_mcp_asset_claims') is not null, 'faltan ledgers MCP de Biblioteca';
  assert has_function_privilege('service_role','public.momos_search_brand_assets(jsonb)','EXECUTE'), 'Cerebro MCP sin búsqueda privada de Biblioteca';
  assert has_function_privilege('service_role','public.momos_get_brand_asset_reference(jsonb)','EXECUTE'), 'Cerebro MCP sin referencia privada de Biblioteca';
  assert not has_function_privilege('authenticated','public.momos_search_brand_assets(jsonb)','EXECUTE'), 'búsqueda privada de Biblioteca expuesta al navegador';
  assert not has_function_privilege('authenticated','public.momos_get_brand_asset_reference(jsonb)','EXECUTE'), 'referencia privada de Biblioteca expuesta al navegador';
  assert not has_table_privilege('authenticated','public.agency_mcp_asset_claims','SELECT'), 'ledger privado de referencias expuesto al navegador';
  assert not has_table_privilege('service_role','public.agency_mcp_asset_claims','SELECT'), 'runtime MCP puede saltar el contrato con SQL directo';
  assert public.biblioteca_produccion_disponible(), 'falta Biblioteca de produccion para motores creativos';
  assert to_regclass('public.brand_asset_production_profiles') is not null
    and to_regclass('public.brand_production_packs') is not null
    and to_regclass('public.brand_production_pack_assets') is not null,
    'faltan perfiles, paquetes o fuentes de produccion creativa';
  assert has_function_privilege('authenticated','public.clasificar_activo_produccion(bigint,jsonb)','EXECUTE'),
    'falta clasificacion gobernada de activos para produccion';
  assert not has_table_privilege('authenticated','public.brand_asset_production_profiles','INSERT')
    and not has_table_privilege('authenticated','public.brand_production_packs','UPDATE'),
    'Biblioteca de produccion admite escritura directa';
  assert public.mcp_aprobaciones_humanas_disponible(), 'falta aprobacion humana del flujo MCP';
  assert to_regclass('public.agency_mcp_human_approvals') is not null,
    'falta bandeja de aprobaciones humanas MCP';
  assert has_function_privilege('service_role','public.momos_solicitar_aprobacion_humana(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.momos_consultar_aprobacion_humana(bigint,text)','EXECUTE'),
    'runtime MCP sin solicitud o consulta gobernada';
  assert not has_function_privilege('service_role','public.resolver_aprobacion_humana_mcp(bigint,text,text,text)','EXECUTE'),
    'runtime MCP puede autoaprobar';
  assert has_function_privilege('authenticated','public.resolver_aprobacion_humana_mcp(bigint,text,text,text)','EXECUTE'),
    'bandeja humana sin resolucion autenticada';
  assert not has_table_privilege('service_role','public.agency_mcp_human_approvals','SELECT')
    and not has_table_privilege('service_role','public.agency_mcp_human_approvals','INSERT')
    and not has_table_privilege('service_role','public.agency_mcp_human_approvals','UPDATE'),
    'runtime MCP conserva acceso SQL directo a aprobaciones';
  assert has_table_privilege('authenticated','public.agency_mcp_human_approvals','SELECT')
    and not has_table_privilege('authenticated','public.agency_mcp_human_approvals','INSERT')
    and not has_table_privilege('authenticated','public.agency_mcp_human_approvals','UPDATE'),
    'bandeja humana perdio lectura RLS o admite decisiones directas';
  assert public.identidad_marca_disponible(), 'falta Identidad de marca operable';
  assert to_regprocedure('public.momos_sync_manifest_v1()') is not null, 'falta manifiesto único de Data Sync';
  assert position('mundo_animado_disponible' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0,
    'el manifiesto de Data Sync no incluye Mundo animado';
  assert position('eliminacion_logo_oficial_disponible' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0,
    'el manifiesto de Data Sync no incluye eliminación protegida del logo';
  assert to_regprocedure('public.momos_core_snapshot_v1()') is not null and to_regprocedure('public.momos_operational_snapshot_v1()') is not null, 'faltan snapshots de Data Sync';
  assert to_regprocedure('public.momos_history_page_v1(jsonb,integer)') is not null, 'falta historial paginado de Data Sync';
  assert has_function_privilege('authenticated','public.momos_sync_manifest_v1()','EXECUTE'), 'la app no puede leer el manifiesto de Data Sync';
  assert has_function_privilege('authenticated','public.momos_core_snapshot_v1()','EXECUTE') and has_function_privilege('authenticated','public.momos_operational_snapshot_v1()','EXECUTE'), 'la app no puede leer snapshots de Data Sync';
  assert not has_function_privilege('anon','public.momos_sync_manifest_v1()','EXECUTE'), 'el manifiesto de Data Sync quedó público';
  assert not has_function_privilege('service_role','public.momos_operational_snapshot_v1()','EXECUTE'), 'el snapshot operativo permite saltar la sesión autenticada';
  assert pg_get_functiondef('public.momos_operational_snapshot_v1()'::regprocedure)
      ~* 'pb[.]estado[[:space:]]*=[[:space:]]*''Listo''(::text)?'
    and position('pb.stock_contabilizado' in pg_get_functiondef('public.momos_operational_snapshot_v1()'::regprocedure))>0
    and pg_get_functiondef('public.momos_operational_snapshot_v1()'::regprocedure)
      ~* 'coalesce[(]pb[.]vencimiento,[[:space:]]*pb[.]vence[)][[:space:]]*>=[[:space:]]*current_date'
    and pg_get_functiondef('public.momos_operational_snapshot_v1()'::regprocedure)
      ~* '[(]lf[.]perfectas[[:space:]]*-[[:space:]]*lf[.]consumidas[)][[:space:]]*>[[:space:]]*0',
    'H64 perdió la conservación de lotes Listo vigentes con stock vendible';
  assert to_regprocedure('public.momos_financial_facts_v1(date,date)') is not null, 'falta lectura financiera completa H65';
  assert has_function_privilege('authenticated','public.momos_financial_facts_v1(date,date)','EXECUTE')
    and not has_function_privilege('anon','public.momos_financial_facts_v1(date,date)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_financial_facts_v1(date,date)','EXECUTE'),
    'H65 perdió su frontera autenticada y exclusiva para sesiones administrativas';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_financial_facts_v1(date,date)'::regprocedure
      and p.prosecdef is false and p.provolatile='s'
  ), 'H65 dejó de ser STABLE SECURITY INVOKER';
  assert pg_get_functiondef('public.momos_financial_facts_v1(date,date)'::regprocedure)
      ~* 'has_current_role[(]''Administrador''(::text)?[)]'
    and position('v_order_totals' in pg_get_functiondef('public.momos_financial_facts_v1(date,date)'::regprocedure))>0
    and pg_get_functiondef('public.momos_financial_facts_v1(date,date)'::regprocedure)
      ~* '''contains_pii''(::text)?,[[:space:]]*false'
    and pg_get_functiondef('public.momos_financial_facts_v1(date,date)'::regprocedure)
      ~* '''contains_free_text''(::text)?,[[:space:]]*false'
    and pg_get_functiondef('public.momos_financial_facts_v1(date,date)'::regprocedure)
      ~* '''contains_storage_references''(::text)?,[[:space:]]*false',
    'H65 perdió gate Administrador, fuente contable canónica o contrato de privacidad';
  assert has_table_privilege('authenticated','public.v_order_totals','SELECT'), 'H65 no puede leer la fuente contable canónica como invoker';
  assert to_regprocedure('public.momos_agency_snapshot_v1(text)') is not null,
    'falta snapshot escalonado de Agencia H66';
  assert to_regprocedure('public.momos_agency_snapshots_v1()') is not null,
    'falta bundle atomico de Agencia H66';
  assert to_regclass('public.agency_snapshot_events') is not null,
    'falta evento singleton sanitizado H66';
  assert has_function_privilege('authenticated','public.momos_agency_snapshot_v1(text)','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshot_v1(text)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_agency_snapshot_v1(text)','EXECUTE'),
    'H66 perdió su frontera exclusiva para sesiones autorizadas de Agencia';
  assert has_function_privilege('authenticated','public.momos_agency_snapshots_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshots_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_agency_snapshots_v1()','EXECUTE'),
    'bundle H66 perdio su frontera exclusiva para sesiones autorizadas de Agencia';
  assert not has_function_privilege('authenticated','public._momos_agency_scope_payload_v1(text)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_snapshot_source_tables_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_agency_snapshot_event_v1()','EXECUTE'),
    'H66 expuso un helper interno';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_agency_snapshot_v1(text)'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'H66 dejó de ser STABLE SECURITY DEFINER con search_path cerrado';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_agency_snapshots_v1()'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ) and exists(
    select 1 from pg_proc p
    where p.oid='public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'bundle/helper H66 perdieron STABLE SECURITY DEFINER o search_path cerrado';
  assert position('current_user_has_any_role' in pg_get_functiondef('public.momos_agency_snapshot_v1(text)'::regprocedure))>0
    and position('Administrador' in pg_get_functiondef('public.momos_agency_snapshot_v1(text)'::regprocedure))>0
    and position('Marketing/CRM' in pg_get_functiondef('public.momos_agency_snapshot_v1(text)'::regprocedure))>0
    and position('source_version' in pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure))>0
    and pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure)
      ~* '''customer_records_projected''(::text)?,[[:space:]]*false'
    and pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure)
      ~* '''secrets_projected''(::text)?,[[:space:]]*false'
    and pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure)
      ~* '''free_text_unverified''(::text)?,[[:space:]]*true'
    and pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure)
      ~* '''telemetry_allowed''(::text)?,[[:space:]]*false'
    and position('agency-authorized-v1' in pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure))>0
    and pg_get_functiondef('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure)
      ~* '''external_execution''(::text)?,[[:space:]]*false'
    and position('current_user_has_any_role' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('Administrador' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('Marketing/CRM' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('source_version' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('jsonb_build_array' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('''overview''' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('''workflow''' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('''production''' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('''measurement''' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0,
    'H66 perdió roles, privacidad, autoridad o alguno de sus cuatro scopes';
  assert position('agency_snapshot_ready' in pg_get_functiondef('public._momos_agency_scope_payload_v1(text)'::regprocedure))>0
    and position('agency_brand_identity' in pg_get_functiondef('public._momos_agency_scope_payload_v1(text)'::regprocedure))>0,
    'H66 overview no declara readiness o Identidad segura';
  assert exists(
    select 1 from pg_class c
    where c.oid='public.agency_snapshot_events'::regclass and c.relrowsecurity
  ) and has_table_privilege('authenticated','public.agency_snapshot_events','SELECT')
    and not has_table_privilege('authenticated','public.agency_snapshot_events','UPDATE')
    and not has_table_privilege('anon','public.agency_snapshot_events','SELECT')
    and not has_table_privilege('service_role','public.agency_snapshot_events','SELECT'),
    'H66 perdió RLS o ACL cerrados del singleton';
  v_sources:=public._momos_agency_snapshot_source_tables_v1();
  assert cardinality(v_sources)=66
    and array['agency_brand_kits','agency_brand_color_tokens','agency_brand_kit_assets']::text[] <@ v_sources
    and not exists(
      select 1 from unnest(v_sources) s(table_name)
      where to_regclass(format('public.%I',s.table_name)) is null
        or not exists(
          select 1 from pg_trigger t
          where t.tgrelid=to_regclass(format('public.%I',s.table_name))
            and t.tgname='momos_agency_snapshot_event_v1'
            and not t.tgisinternal and (t.tgtype::integer & 1)=0
        )
    ), 'H66 perdió fuentes o triggers por sentencia del singleton';
  assert to_regclass('public.agency_brand_kits') is not null and to_regclass('public.agency_brand_kit_assets') is not null, 'faltan kit o logos oficiales de marca';
  assert has_function_privilege('authenticated','public.obtener_identidad_marca(boolean)','EXECUTE'), 'la UI no puede leer Identidad de marca';
  assert not has_table_privilege('authenticated','public.agency_brand_kits','UPDATE'), 'Identidad de marca admite reescritura directa';
  assert not has_table_privilege('authenticated','public.brand_library','UPDATE'), 'la fuente verbal legado sigue editable';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='agency_brand_gate_bindings' and column_name='brand_kit_id'), 'los gates no sellan el kit oficial';
  assert exists(select 1 from pg_trigger where tgname='creatives_master_lineage_guard' and not tgisinternal), 'creativo sellado admite sustitución';
  assert not has_table_privilege('authenticated','public.agency_decisions','UPDATE'), 'decisiones comerciales conservan escritura directa';
  assert not has_table_privilege('authenticated','public.customer_contacts','INSERT'), 'contactos CRM conservan escritura directa';
  assert not has_table_privilege('authenticated','public.order_line_progress','UPDATE'), 'progreso conserva escritura directa';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert not (select puballtables from pg_publication where pubname='supabase_realtime'), 'Realtime FOR ALL TABLES expone fuentes crudas';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders'), 'orders no publica cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_line_progress'), 'progreso no publica cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='production_batches'), 'lotes de producción no publican cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_movements'), 'movimientos de inventario no publican cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='deliveries'), 'domicilios no publican cambios en tiempo real';
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_snapshot_events'), 'evento sanitizado H66 no publica cambios en tiempo real';
    assert not exists(
      select 1 from pg_publication_tables p
      join unnest(v_sources) s(table_name) on s.table_name=p.tablename
      where p.pubname='supabase_realtime' and p.schemaname='public'
    ), 'Realtime conserva fuentes H66 crudas';
    assert not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename in ('brand_media_assets','brand_asset_production_profiles','brand_production_packs','brand_production_pack_assets')
    ), 'Realtime conserva tablas de marca crudas';
  end if;
  assert not has_table_privilege('authenticated','public.products','UPDATE'), 'products conserva escritura directa';
  assert not has_table_privilege('authenticated','public.recipes','INSERT'), 'recipes conserva escritura directa';
  assert public.inventory_lot_precision_disponible(), 'falta precisión canónica H68 de inventario por lotes';
  assert not has_function_privilege('authenticated','public._sync_inventory_stock_from_lots(text)','EXECUTE'), 'helper H68 expuesto';
  assert not has_function_privilege('authenticated','public._assert_inventory_lot_reconciliation()','EXECUTE'), 'guarda privada H68 expuesta';
  assert not has_function_privilege('authenticated','public._guard_inventory_finite_values()','EXECUTE'), 'guarda finita H68 expuesta';
  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_items'::regclass
      and t.tgname='inventory_items_stock_guard'
      and t.tgdeferrable and t.tginitdeferred and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lots'::regclass
      and t.tgname='inventory_lots_stock_guard'
      and t.tgdeferrable and t.tginitdeferred and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lot_allocations'::regclass
      and t.tgname='inventory_lot_allocations_stock_guard'
      and t.tgdeferrable and t.tginitdeferred and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_movements'::regclass
      and t.tgname='inventory_movements_stock_guard'
      and t.tgdeferrable and t.tginitdeferred and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ), 'faltan guardas diferidas de inventario y ledger';
  assert not has_table_privilege('authenticated','public.inventory_items','INSERT')
    and not has_table_privilege('authenticated','public.inventory_items','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_items','DELETE')
    and not has_table_privilege('authenticated','public.inventory_items','TRUNCATE')
    and not has_table_privilege('authenticated','public.inventory_items','TRIGGER'),
    'stock agregado conserva escritura directa';
  assert not has_table_privilege('authenticated','public.inventory_lots','INSERT')
    and not has_table_privilege('authenticated','public.inventory_lots','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_lots','DELETE')
    and not has_table_privilege('authenticated','public.inventory_lot_allocations','INSERT')
    and not has_table_privilege('authenticated','public.inventory_lot_allocations','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_lot_allocations','DELETE')
    and not has_table_privilege('authenticated','public.inventory_movements','INSERT')
    and not has_table_privilege('authenticated','public.inventory_movements','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_movements','DELETE'),
    'lotes, asignaciones o movimientos conservan escritura directa';
  assert not exists(
    select 1 from public.v_inventory_lot_reconciliation
    where official_stock<>lot_stock or difference<>0
  ), 'stock agregado y lotes no cuadran';
  assert not exists(select 1 from public.v_variantes_disponibles where vencimiento_proximo<current_date), 'FIFO terminado expone vencidos';
  assert not exists(
    select 1 from public.production_batches
    where desmoldado_en is not null
      and (
        vida_util_dias is null
        or vence is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + vida_util_dias)
        or vencimiento is distinct from ((desmoldado_en at time zone 'America/Bogota')::date + vida_util_dias)
      )
  ), 'producto terminado no respeta la vida útil sellada desde el desmolde';
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
  assert to_regprocedure('public.momos_agency_snapshots_v2()') is not null,
    'falta bundle H67 de hechos operativos';
  assert has_function_privilege('authenticated','public.momos_agency_snapshots_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshots_v2()','EXECUTE'),
    'H67 perdio su frontera authenticated';
  assert to_regprocedure('public._momos_agency_operational_facts_payload_v1()') is not null
    and not has_function_privilege('authenticated','public._momos_agency_operational_facts_payload_v1()','EXECUTE'),
    'falta payload privado H67';
  assert to_regclass('public.inventory_delta_receipts') is not null
    and to_regclass('public.inventory_sync_events') is not null,
    'faltan recibos idempotentes o outbox H69';
  assert to_regprocedure('public.entrada_insumo_lote_delta(jsonb)') is not null
    and to_regprocedure('public.movimiento_insumo_delta(jsonb)') is not null
    and to_regprocedure('public.desechar_lote_insumo_delta(jsonb)') is not null
    and to_regprocedure('public.momos_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_inventory_deltas_since_v1(bigint,integer)') is not null,
    'falta una RPC de mutación o conciliación H69';
  assert has_function_privilege('authenticated','public.entrada_insumo_lote_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.movimiento_insumo_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.desechar_lote_insumo_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_inventory_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.momos_inventory_deltas_since_v1(bigint,integer)','EXECUTE')
    and not has_function_privilege('anon','public.entrada_insumo_lote_delta(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_inventory_delta_v1(text,bigint)','EXECUTE'),
    'H69 perdió su frontera RBAC';
  assert not has_table_privilege('authenticated','public.inventory_delta_receipts','SELECT')
    and has_table_privilege('authenticated','public.inventory_sync_events','SELECT')
    and not has_table_privilege('authenticated','public.inventory_sync_events','INSERT'),
    'H69 expuso recibos o permitió inyectar eventos';
  assert to_regprocedure('public._momos_compact_inventory_delta_receipt_v1()') is not null
    and not has_function_privilege(
      'authenticated','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'anon','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'service_role','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    ),'H70 expuso el compactador privado de recibos';
  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_delta_receipts'::regclass
      and t.tgname='inventory_delta_receipts_compact_v1'
      and not t.tgisinternal
      and t.tgfoid='public._momos_compact_inventory_delta_receipt_v1()'::regprocedure
  ) and exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_delta_receipts'::regclass
      and c.conname='inventory_delta_receipts_response_compact'
      and c.convalidated
  ) and not exists(
    select 1 from public.inventory_delta_receipts r where r.response ? 'delta'
  ) and not exists(
    select 1
    from public.inventory_delta_receipts r
    where jsonb_typeof(r.response) is distinct from 'object'
      or not (r.response ?& array[
        'contract','operation','idempotency_key','duplicate','result'
      ])
      or r.response-array[
        'contract','operation','idempotency_key','duplicate','result'
      ]<>'{}'::jsonb
      or r.response->>'contract' is distinct from 'momos.inventory-mutation.v1'
      or r.response->>'operation' is distinct from r.operation
      or r.response->>'idempotency_key' is distinct from r.idempotency_key::text
      or jsonb_typeof(r.response->'duplicate') is distinct from 'boolean'
  ) and position(
    'IS TRUE' in upper(pg_get_constraintdef((
      select c.oid from pg_constraint c
      where c.conrelid='public.inventory_delta_receipts'::regclass
        and c.conname='inventory_delta_receipts_response_compact'
    )))
  )>0 and position(
    'jsonb_build_object' in lower(pg_get_functiondef(
      'public._momos_compact_inventory_delta_receipt_v1()'::regprocedure
    ))
  )>0,'H70 no garantiza recibos O(1), cerrados y sin delta/PII';
  assert (
    select array_agg(c.column_name::text order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='inventory_sync_events'
  )=array['event_id','item_id','changed_at']::text[]
    and to_regclass('public.inventory_sync_event_xids') is not null
    and (
      select array_agg(c.column_name::text order by c.ordinal_position)
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name='inventory_sync_event_xids'
    )=array['event_id','producer_xid']::text[]
    and exists(
      select 1 from pg_class c
      where c.oid='public.inventory_sync_event_xids'::regclass
        and c.relrowsecurity
    )
    and exists(
      select 1 from pg_indexes i
      where i.schemaname='public' and i.tablename='inventory_sync_event_xids'
        and i.indexname='inventory_sync_event_xids_producer_idx'
    )
    and exists(
      select 1 from pg_constraint c
      where c.conrelid='public.inventory_sync_event_xids'::regclass
        and c.contype='p'
    )
    and exists(
      select 1 from pg_constraint c
      where c.conrelid='public.inventory_sync_event_xids'::regclass
        and c.contype='f'
        and c.confrelid='public.inventory_sync_events'::regclass
        and c.confdeltype='c'
    )
    and not exists(
      select 1 from pg_publication_tables p
      where p.schemaname='public' and p.tablename='inventory_sync_event_xids'
    )
    and not exists(select 1 from pg_catalog.pg_publication where puballtables)
    and not has_table_privilege(
      'authenticated','public.inventory_sync_event_xids','SELECT'
    )
    and not has_table_privilege(
      'anon','public.inventory_sync_event_xids','SELECT'
    )
    and not has_table_privilege(
      'service_role','public.inventory_sync_event_xids','SELECT'
    )
    and not exists(
      select 1
      from public.inventory_sync_events e
      left join public.inventory_sync_event_xids x on x.event_id=e.event_id
      where x.event_id is null
    )
    and to_regprocedure(
    'public._momos_inventory_events_page_v1(bigint,bigint,integer)'
  ) is not null
    and not has_function_privilege(
      'authenticated',
      'public._momos_inventory_events_page_v1(bigint,bigint,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public._momos_inventory_events_page_v1(bigint,bigint,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public._momos_inventory_events_page_v1(bigint,bigint,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public._momos_touch_inventory_sync_event_v1()','EXECUTE'
    )
    and position(
      'insert into public.inventory_sync_event_xids' in lower(pg_get_functiondef(
        'public._momos_touch_inventory_sync_event_v1()'::regprocedure
      ))
    )>0
    and position(
      'pg_current_xact_id' in lower(pg_get_functiondef(
        'public._momos_touch_inventory_sync_event_v1()'::regprocedure
      ))
    )>0,'H70 no sella el xid privado o expuso su paginador/trigger';
  assert exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_lots'
      and i.indexname='inventory_lots_item_history_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_movements'
      and i.indexname='inventory_movements_item_recent_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_item_recent_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_recent_idx'
  ),'H70 no instala los indices completos de lotes e historial';
  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_items'::regclass
      and t.tgname='inventory_items_sync_event_v1'
      and not t.tgisinternal
      and t.tgfoid=to_regprocedure('public._momos_touch_inventory_sync_event_v1()')
  ), 'falta trigger de outbox H69';
  assert position('inventario_deltas_disponibles' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0
    and position('inventory_latest_event_id' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0,
    'el manifiesto Data Sync no anuncia H69';
  assert pg_get_functiondef(
      'public._momos_inventory_delta_v1(text,bigint)'::regprocedure
    ) !~* 'for[[:space:]]+(share|update)'
    and pg_get_functiondef(
      'public.momos_inventory_deltas_v1(text[])'::regprocedure
    ) !~* 'for[[:space:]]+(share|update)',
    'H70 conserva locks de fila en el delta o batch';
  assert position(
      '_momos_inventory_delta_v1' in lower(pg_get_functiondef(
        'public.momos_inventory_deltas_v1(text[])'::regprocedure
      ))
    )=0
    and position(
      'with requested as materialized' in lower(pg_get_functiondef(
        'public.momos_inventory_deltas_v1(text[])'::regprocedure
      ))
    )>0,
    'H70 no arma el batch completo en un statement MVCC';
  assert regexp_count(lower(pg_get_functiondef(
      'public._momos_inventory_delta_v1(text,bigint)'::regprocedure
    )),'limit[[:space:]]+50')=2
    and regexp_count(lower(pg_get_functiondef(
      'public.momos_inventory_deltas_v1(text[])'::regprocedure
    )),'limit[[:space:]]+50')=2,
    'H70 no conserva 50 movimientos y auditorias por item';
  assert position(
      'with snapshot_payload as materialized' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0
    and position(
      'inventory_latest_event_id' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0
    and position(
      'pg_snapshot_xmin' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0
    and position(
      '4611686018427387904' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0
    and position(
      'inventory_movements' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0
    and position(
      'inventory_audit_logs' in lower(pg_get_functiondef(
        'public.momos_core_snapshot_v1()'::regprocedure
      ))
    )>0,
    'H70 no captura safe xmin e historial sanitario dentro del core snapshot';
  assert position(
      'pg_snapshot_xmin' in lower(pg_get_functiondef(
        'public.momos_inventory_deltas_since_v1(bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      '_momos_inventory_events_page_v1' in lower(pg_get_functiondef(
        'public.momos_inventory_deltas_since_v1(bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'x.producer_xid>=p_after_xid' in lower(pg_get_functiondef(
        'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'x.producer_xid<p_target_xid' in lower(pg_get_functiondef(
        'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'group by x.producer_xid' in lower(pg_get_functiondef(
        'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'limit p_limit+1' in lower(pg_get_functiondef(
        'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'v_group_count>=p_limit' in lower(pg_get_functiondef(
        'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      '4611686018427387904' in lower(pg_get_functiondef(
        'public.momos_inventory_deltas_since_v1(bigint,integer)'::regprocedure
      ))
    )>0
    and position(
      'pg_snapshot_xmin' in lower(pg_get_functiondef(
        'public.momos_sync_manifest_v1()'::regprocedure
      ))
    )>0,
    'H70 vuelve a depender de identity como orden global de commit';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert not (select puballtables from pg_publication where pubname='supabase_realtime')
      and exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public'
          and tablename='inventory_sync_events'
      ) and not exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public'
          and tablename='inventory_sync_event_xids'
      ), 'Realtime no conserva el outbox sanitario y el mapping privado';
    assert exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='order_sync_versions'
    ), 'Realtime no incluye el outbox compacto de Pedidos';
  end if;
  assert to_regclass('public.order_sync_versions') is not null,
    'H71 no instaló las versiones compactas por pedido';
  assert has_function_privilege('authenticated','public.momos_order_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('anon','public.momos_order_deltas_v1(text[])','EXECUTE'),
    'H71 perdió la frontera RBAC del delta de Pedidos';
  assert has_table_privilege('authenticated','public.order_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.order_sync_versions','INSERT')
    and not has_table_privilege('service_role','public.order_sync_versions','SELECT'),
    'H71 no dejó el outbox disponible para Realtime o permitió escritura directa';
  assert exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='order_sync_versions'
      and policyname='order_sync_versions_staff_read'
      and roles @> array['authenticated']::name[]
  ), 'H71 perdió el RLS de personal del outbox compacto';
  assert position('pedidos_deltas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H71';
  assert to_regclass('public.finished_inventory_sync_versions') is not null,
    'H72 no instaló las versiones compactas por producto terminado';
  assert has_function_privilege('authenticated','public.momos_finished_inventory_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('anon','public.momos_finished_inventory_deltas_v1(text[])','EXECUTE'),
    'H72 perdió la frontera RBAC del delta de Inventario terminado';
  assert has_table_privilege('authenticated','public.finished_inventory_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.finished_inventory_sync_versions','INSERT')
    and not has_table_privilege('service_role','public.finished_inventory_sync_versions','SELECT'),
    'H72 no dejó el outbox disponible para Realtime o permitió escritura directa';
  assert exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='finished_inventory_sync_versions'
      and policyname='finished_inventory_sync_versions_staff_read'
      and roles @> array['authenticated']::name[]
  ), 'H72 perdió el RLS de personal del outbox compacto';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='finished_inventory_sync_versions'
    ), 'Realtime no incluye el outbox compacto de Inventario terminado';
  end if;
  assert position('producto_terminado_deltas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H72';
  assert to_regclass('public.production_activity_sync_versions') is not null
    and to_regclass('public.production_delta_receipts') is not null,
    'H73 no instaló el outbox y los recibos de Producción';
  assert has_function_privilege('authenticated','public.crear_corrida_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.producir_subreceta_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.convertir_imperfectas_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_production_activity_delta_v1()','EXECUTE')
    and not has_function_privilege('anon','public.crear_corrida_delta(jsonb)','EXECUTE'),
    'H73 perdió la frontera RBAC de Producción';
  assert has_table_privilege('authenticated','public.production_activity_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.production_activity_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.production_delta_receipts','SELECT'),
    'H73 expuso escritura del outbox o lectura de recibos';
  assert exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='production_activity_sync_versions'
      and policyname='production_activity_sync_versions_staff_read'
      and roles @> array['authenticated']::name[]
  ), 'H73 perdió el RLS de personal del outbox compacto';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='production_activity_sync_versions'
    ), 'Realtime no incluye el outbox compacto de Producción';
  end if;
  assert position('produccion_deltas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H73';
  assert to_regclass('public.product_catalog_sync_versions') is not null
    and to_regclass('public.customer_crm_sync_versions') is not null
    and to_regclass('public.catalog_crm_delta_receipts') is not null,
    'H74 no instaló outboxes y recibos de Catálogo/CRM';
  assert has_function_privilege('authenticated','public.momos_product_catalog_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.momos_customer_crm_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.mutar_catalogo_crm_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.mutar_catalogo_crm_delta(jsonb)','EXECUTE'),
    'H74 perdió la frontera RBAC de Catálogo/CRM';
  assert has_table_privilege('authenticated','public.product_catalog_sync_versions','SELECT')
    and has_table_privilege('authenticated','public.customer_crm_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.product_catalog_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.customer_crm_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.catalog_crm_delta_receipts','SELECT'),
    'H74 expuso escritura de outboxes o lectura de recibos';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_catalog_sync_versions')
      and exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='customer_crm_sync_versions'),
      'Realtime no incluye los outboxes compactos de Catálogo/CRM';
  end if;
  assert position('catalogo_crm_deltas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H74';
  assert to_regclass('public.finance_sync_state') is not null
    and to_regclass('public.finance_delta_receipts') is not null,
    'H75 no instaló el outbox y los recibos privados de Finanzas';
  assert has_function_privilege('authenticated','public.momos_finance_snapshot_v1(date,date)','EXECUTE')
    and has_function_privilege('authenticated','public.actualizar_pauta_financiera_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_finance_snapshot_v1(date,date)','EXECUTE')
    and not has_function_privilege('service_role','public.actualizar_pauta_financiera_v1(jsonb)','EXECUTE'),
    'H75 perdió la frontera RBAC de Finanzas';
  assert has_table_privilege('authenticated','public.finance_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.finance_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.finance_delta_receipts','SELECT'),
    'H75 expuso escritura del outbox o lectura de recibos financieros';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='finance_sync_state'),
      'Realtime no incluye el outbox compacto de Finanzas';
  end if;
  assert position('finanzas_operativas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H75';
  assert to_regclass('public.configuration_sync_state') is not null
    and to_regclass('public.configuration_mutation_receipts') is not null,
    'H76 no instaló el outbox y los recibos privados de Configuración';
  assert has_function_privilege('authenticated','public.momos_configuration_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.guardar_configuracion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_configuration_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.guardar_configuracion_v1(jsonb)','EXECUTE'),
    'H76 perdió la frontera RBAC de Configuración';
  assert has_table_privilege('authenticated','public.configuration_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.configuration_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.configuration_mutation_receipts','SELECT'),
    'H76 expuso escritura del outbox o lectura de recibos de Configuración';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='configuration_sync_state'),
      'Realtime no incluye el outbox compacto de Configuración';
  end if;
  assert position('configuracion_servidor_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H76';
  assert to_regclass('public.dashboard_sync_state') is not null
    and to_regprocedure('public.momos_dashboard_snapshot_v1()') is not null,
    'H77 no instaló el outbox y el snapshot compacto de Dashboard';
  assert has_function_privilege('authenticated','public.momos_dashboard_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.dashboard_operativo_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.momos_dashboard_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_dashboard_snapshot_v1()','EXECUTE'),
    'H77 perdió la frontera RBAC del Dashboard';
  assert has_table_privilege('authenticated','public.dashboard_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.dashboard_sync_state','UPDATE'),
    'H77 expuso escritura del outbox de Dashboard';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='dashboard_sync_state'),
      'Realtime no incluye el outbox compacto de Dashboard';
  end if;
  assert position('dashboard_operativo_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H77';
  assert position('p_estado not in' in pg_get_functiondef(
      'public.set_lote_estado(text,text)'::regprocedure
    ))>0,
    'H78 no cerró los estados manuales Reservado/Vendido del lote';
  assert to_regprocedure('public.momos_history_page_v2(jsonb,integer,text,text,date,date)') is not null
    and to_regprocedure('public.historial_operativo_paginado_disponible()') is not null,
    'H79 no instaló el historial filtrado y paginado';
  assert has_function_privilege('authenticated','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and not has_function_privilege('anon','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_history_area_v2(text)','EXECUTE'),
    'H79 perdió su frontera RBAC';
  assert exists(select 1 from pg_indexes where schemaname='public' and indexname='audit_logs_history_recent_idx')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='audit_logs_history_area_recent_idx'),
    'H79 no instaló los índices del historial';
  assert exists(select 1 from pg_trigger
      where tgname='production_batches_prepared_stock_guard'
        and tgrelid='public.production_batches'::regclass
        and not tgisinternal and tgenabled='O')
    and not has_function_privilege(
      'authenticated','public._production_batch_prepared_stock_guard()','EXECUTE'
    ),
    'H80 no cerró la creación de lotes sin elaboraciones o expuso su función interna';
  assert to_regclass('public.delivery_sync_state') is not null
    and to_regprocedure('public.momos_delivery_snapshot_v1(integer)') is not null
    and to_regprocedure('public.domicilios_snapshot_disponible()') is not null,
    'H81 no instaló el snapshot compacto de Domicilios';
  assert has_function_privilege('authenticated','public.momos_delivery_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('anon','public.momos_delivery_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_delivery_snapshot_v1(integer)','EXECUTE'),
    'H81 perdió la frontera RBAC de Domicilios';
  assert has_table_privilege('authenticated','public.delivery_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.delivery_sync_state','UPDATE'),
    'H81 expuso escritura del outbox de Domicilios';
  assert position('domicilios_snapshot_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H81';
  assert to_regclass('public.delivery_mutation_receipts') is not null
    and to_regprocedure('public.mutar_domicilio_delta(jsonb)') is not null
    and to_regprocedure('public.domicilios_mutaciones_atomicas_disponibles()') is not null,
    'H82 no instaló recibos privados y mutaciones atómicas de Domicilios';
  assert has_function_privilege('authenticated','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.domicilios_mutaciones_atomicas_disponibles()','EXECUTE')
    and not has_function_privilege('anon','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.mutar_domicilio_delta(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_delivery_mutation_response_v1(text,uuid,boolean,text,text)','EXECUTE'),
    'H82 perdió su frontera RPC pública/privada';
  assert not has_table_privilege('authenticated','public.delivery_mutation_receipts','SELECT')
    and not has_table_privilege('authenticated','public.delivery_mutation_receipts','INSERT')
    and not has_table_privilege('service_role','public.delivery_mutation_receipts','SELECT'),
    'H82 expuso recibos idempotentes privados';
  assert position('domicilios_mutaciones_atomicas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H82';
  assert exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='production_batches' and column_name='vida_util_dias')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='inventory_lots' and column_name='vida_util_dias')
    and to_regprocedure('public.momos_configuration_snapshot_v2()') is not null
    and to_regprocedure('public.guardar_configuracion_v2(jsonb)') is not null,
    'H83 no instaló vida útil sellada y Configuración v2';
  assert has_function_privilege('authenticated','public.momos_configuration_snapshot_v2()','EXECUTE')
    and has_function_privilege('authenticated','public.guardar_configuracion_v2(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_configuration_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.guardar_configuracion_v2(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.configuration_v2_mutation_receipts','SELECT'),
    'H83 perdió su frontera administrativa o expuso recibos privados';
  assert (select (valor#>>'{}')::integer between 1 and 30
      from public.app_settings where clave='vida_util_producto_terminado_dias')
    and (select (valor#>>'{}')::integer between 1 and 30
      from public.app_settings where clave='vida_util_mezclas_dias'),
    'H83 dejó una vida útil fuera del rango permitido';
  assert not exists(select 1 from public.production_batches
      where desmoldado_en is not null
        and (vida_util_dias is null
          or vence<>(desmoldado_en at time zone 'America/Bogota')::date+vida_util_dias
          or vencimiento is distinct from vence)),
    'H83 dejó lotes terminados sin fecha sellada consistente';
  assert not exists(select 1
      from public.inventory_lots l
      join public.subrecetas sr on sr.item_id=l.item_id
      where l.available_quantity>0
        and (l.vida_util_dias is null or l.expires_at<>l.received_at+l.vida_util_dias)),
    'H83 dejó elaboraciones disponibles sin vida útil sellada consistente';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-83 PASS, rollback total' as resultado;
do $$
begin
  assert to_regclass('public.finished_product_disposals') is not null
    and to_regprocedure('public.desechar_producto_terminado_delta(jsonb)') is not null
    and to_regprocedure('public.desecho_producto_terminado_disponible()') is not null,
    'H84 no instaló el ledger y RPC de desecho terminado';
  assert has_function_privilege('authenticated','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.desecho_producto_terminado_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.desecho_producto_terminado_disponible()','EXECUTE')
    and has_table_privilege('authenticated','public.finished_product_disposals','SELECT')
    and not has_table_privilege('authenticated','public.finished_product_disposals','INSERT')
    and not has_table_privilege('authenticated','public.finished_product_disposals','UPDATE'),
    'H84 perdió RBAC o expuso escritura directa del ledger';
  assert position('cantidad_esperada' in pg_get_functiondef('public.desechar_producto_terminado_delta(jsonb)'::regprocedure))>0,
    'H84 no exige la cantidad exacta que la persona confirmó';
  assert position('desecho_producto_terminado_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H84';
  assert position('from public.products' in pg_get_functiondef('public.desechar_producto_terminado_delta(jsonb)'::regprocedure))
       < position('from public.lote_figuras' in pg_get_functiondef('public.desechar_producto_terminado_delta(jsonb)'::regprocedure)),
    'H84 invirtió el orden canónico de locks producto antes de lote_figuras';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-84 PASS, rollback total' as resultado_h84;
do $$
begin
  assert to_regclass('public.kitchen_procedure_versions') is not null
    and to_regprocedure('public.guardar_ficha_tecnica_cocina(jsonb)') is not null
    and to_regprocedure('public.activar_ficha_tecnica_cocina(bigint,text)') is not null
    and to_regprocedure('public.momos_core_snapshot_v2()') is not null
    and to_regprocedure('public.fichas_tecnicas_cocina_disponibles()') is not null,
    'H85 no instaló fichas técnicas y snapshot v2';
  assert has_function_privilege('authenticated','public.momos_core_snapshot_v2()','EXECUTE')
    and has_function_privilege('authenticated','public.guardar_ficha_tecnica_cocina(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_core_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.activar_ficha_tecnica_cocina(bigint,text)','EXECUTE')
    and has_table_privilege('authenticated','public.kitchen_procedure_versions','SELECT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_versions','UPDATE'),
    'H85 perdió RBAC o expuso escritura directa';
  assert position('fichas_tecnicas_cocina_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,'el manifiesto de Data Sync no anuncia H85';
  assert not exists(
    select subrecipe_id from public.kitchen_procedure_versions
    where status='Vigente' group by subrecipe_id having count(*)<>1
  ) and (select count(*) from public.kitchen_procedure_versions where status='Vigente')
      =(select count(*) from public.subrecetas where activo),
    'H85 no dejó exactamente una ficha vigente por subreceta activa';
  assert exists(
    select 1 from public.kitchen_procedure_versions k
    join public.subrecetas s on s.id=k.subrecipe_id
    where s.tipo like 'mousse_%' and k.status='Vigente'
      and not k.process_defined
  ),'H85 inventó que el proceso de mousse ya estaba completamente definido';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-85 PASS, rollback total' as resultado_h85;
do $$
begin
  assert to_regclass('public.kitchen_procedure_sync_state') is not null
    and to_regprocedure('public.listar_fichas_tecnicas_cocina(text)') is not null
    and to_regprocedure('public.archivar_borrador_ficha_tecnica(bigint,text)') is not null
    and to_regprocedure('public.gestion_fichas_tecnicas_cocina_disponible()') is not null,
    'H86 no instaló gestión e historial de fichas';
  assert has_function_privilege('authenticated','public.listar_fichas_tecnicas_cocina(text)','EXECUTE')
    and has_function_privilege('authenticated','public.archivar_borrador_ficha_tecnica(bigint,text)','EXECUTE')
    and not has_function_privilege('anon','public.listar_fichas_tecnicas_cocina(text)','EXECUTE')
    and not has_function_privilege('service_role','public.archivar_borrador_ficha_tecnica(bigint,text)','EXECUTE')
    and has_table_privilege('authenticated','public.kitchen_procedure_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_sync_state','UPDATE'),
    'H86 perdió RBAC o expuso escritura del cursor';
  assert (
    select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a
    where a.attrelid='public.kitchen_procedure_sync_state'::regclass
      and a.attnum>0 and not a.attisdropped
  )=array['id','version','changed_at']::text[],
    'H86 dejó de usar un cursor compacto';
  assert position('kitchen_procedure_sync_version' in pg_get_functiondef(
      'public.momos_core_snapshot_v2()'::regprocedure
    ))>0
    and position('gestion_fichas_tecnicas_cocina_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,'snapshot o manifiesto no entregan H86';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-86 PASS, rollback total' as resultado_h86;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260720_87_formulas_elaboraciones')
    and to_regprocedure('public.listar_fichas_integrales_elaboracion(text)') is not null
    and to_regprocedure('public.formulas_elaboraciones_internas_disponibles()') is not null,
    'H87 no instaló las fórmulas integrales de elaboraciones';
  assert exists(select 1 from pg_attribute
      where attrelid='public.kitchen_procedure_versions'::regclass and attname='formula' and not attisdropped)
    and exists(select 1 from pg_attribute
      where attrelid='public.kitchen_procedure_versions'::regclass and attname='formula_fingerprint' and not attisdropped),
    'H87 no versiona fórmula y huella';
  assert has_function_privilege('authenticated','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and not has_function_privilege('anon','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and not has_function_privilege('service_role','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','INSERT')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','UPDATE')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','DELETE'),
    'H87 perdió RBAC o expuso escritura directa de fórmulas';
  assert position('formula_fingerprint' in pg_get_functiondef(
      'public.activar_ficha_tecnica_cocina(bigint,text)'::regprocedure))>0
    and position('formulas_elaboraciones_internas_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure))>0,
    'H87 no verifica integridad o no aparece en el manifiesto';
  assert not exists(
    select 1 from public.kitchen_procedure_versions
    where formula is null or formula_fingerprint!~'^[0-9a-f]{64}$'
  ),'H87 dejó versiones sin fórmula capturada o huella';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-87 PASS, rollback total' as resultado_h87;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260720_88_aislamiento_snapshots_rol')
    and to_regprocedure('public.momos_core_snapshot_v3()') is not null
    and to_regprocedure('public.momos_operational_snapshot_v2()') is not null
    and to_regprocedure('public.aislamiento_snapshots_rol_disponible()') is not null,
    'H88 no instaló snapshots aislados por rol';
  assert has_function_privilege('authenticated','public.momos_core_snapshot_v3()','EXECUTE')
    and has_function_privilege('authenticated','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_project_jsonb_rows(jsonb,text[])','EXECUTE'),
    'H88 perdió RBAC o expuso su proyector interno';
  assert position('public.current_roles()' in pg_get_functiondef(
      'public.momos_operational_snapshot_v2()'::regprocedure))>0
    and position('public._momos_project_jsonb_rows' in pg_get_functiondef(
      'public.momos_operational_snapshot_v2()'::regprocedure))>0,
    'H88 dejó de proyectar por la unión real de roles';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-88 PASS, continúa H89' as resultado_h88;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260720_89_cierre_lecturas_pii')
    and to_regprocedure('public.momos_current_user_profile_v1()') is not null
    and to_regprocedure('public.cierre_lecturas_pii_disponible()') is not null,
    'H89 no instaló el cierre de lecturas PII';
  assert has_function_privilege('authenticated','public.momos_current_user_profile_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_current_user_profile_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_current_user_profile_v1()','EXECUTE'),
    'H89 perdió RBAC en el perfil propio';
  assert exists(select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename='users'
        and policyname='own_profile_read' and cmd='SELECT')
    and not exists(
      select 1 from pg_catalog.pg_policies p
      where p.schemaname='public'
        and p.tablename=any(array[
          'users','customers','orders','order_items','order_item_adiciones',
          'deliveries','evidences','benefits','claims','audit_logs',
          'packing_verifications','order_stage_assignments','order_line_progress',
          'order_incidents','order_dispatch_handoffs','customer_crm_profiles',
          'customer_contacts','customer_activations'
        ]::text[])
        and (p.policyname='staff_read'
          or p.policyname='packing_verifications_staff_read'
          or p.policyname='claude_read')
    ),'H89 dejó una lectura amplia o perdió el perfil propio';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-89 PASS, continúa H90' as resultado_h89;
do $$
declare v_audit jsonb;
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260720_90_dominio_productos_figuras')
    and to_regprocedure('public.auditar_dominio_productos_figuras_v1()') is not null
    and to_regprocedure('public.dominio_productos_figuras_canonico_disponible()') is not null,
    'H90 no instaló el dominio canónico de productos y figuras';
  assert has_function_privilege('authenticated','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and not has_function_privilege('anon','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_guard_linea_pedido_canonica()','EXECUTE'),
    'H90 perdió RBAC o expuso un guard interno';
  assert exists(select 1 from public.products where id='PR08'
      and cat='Momos Cuchara' and tipo='pedido' and especie is null and stock is null)
    and not exists(select 1 from public.figuras where product_id='PR08')
    and (select count(*) from public.figuras f
      where f.activo and public._momos_es_figura_canonica(f.nombre))=7,
    'H90 dejó PR08 o las siete figuras en un estado ambiguo';
  assert not exists(select 1 from public.combo_components cc
      left join public.products c on c.id=cc.combo_id
      left join public.products p on p.id=cc.component_id
      where c.id is null or c.tipo<>'combo' or c.cat<>'Cajas y Combos'
        or p.id is null or p.tipo<>'momo' or p.cat<>'Momos Signature' or not p.activo
        or not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)),
    'H90 dejó una caja ligada a una presentación sin figura exacta';
  v_audit:=public.auditar_dominio_productos_figuras_v1();
  assert v_audit->>'contract'='momos.domain-integrity.v1'
    and (v_audit->>'canonical_figures')::integer=7
    and (v_audit->>'invalid_product_classifications')::integer=0
    and (v_audit->>'invalid_figure_mappings')::integer=0
    and (v_audit->>'invalid_combo_components')::integer=0
    and coalesce((v_audit->>'contains_customer_pii')::boolean,true)=false
    and coalesce((v_audit->>'external_execution')::boolean,true)=false,
    'H90 perdió integridad, privacidad o no ejecución';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-90 PASS, continúa H91' as resultado_h90;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_91_mutaciones_compuestas_atomicas')
    and to_regclass('public.compound_mutation_receipts') is not null
    and to_regprocedure('public.completar_cocina_y_entregar_empaque_v1(jsonb)') is not null
    and to_regprocedure('public.crear_corrida_agrupada_v1(jsonb)') is not null
    and to_regprocedure('public.registrar_compra_y_atender_sugerencias_v1(jsonb)') is not null
    and to_regprocedure('public.mutaciones_compuestas_atomicas_disponibles()') is not null,
    'H91 no instaló las mutaciones compuestas atómicas';
  assert has_function_privilege('authenticated','public.completar_cocina_y_entregar_empaque_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.crear_corrida_agrupada_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.registrar_compra_y_atender_sugerencias_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.completar_cocina_y_entregar_empaque_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.crear_corrida_agrupada_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_h91_suggestion_ids(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.compound_mutation_receipts','SELECT')
    and not has_table_privilege('service_role','public.compound_mutation_receipts','SELECT'),
    'H91 perdió RBAC o expuso sus recibos/helpers';
  assert position('completar_etapa_pedido' in pg_get_functiondef(
      'public.completar_cocina_y_entregar_empaque_v1(jsonb)'::regprocedure))>0
    and position('set_order_status' in pg_get_functiondef(
      'public.completar_cocina_y_entregar_empaque_v1(jsonb)'::regprocedure))>0
    and position('crear_corrida_delta' in pg_get_functiondef(
      'public.crear_corrida_agrupada_v1(jsonb)'::regprocedure))>0
    and position('entrada_insumo_lote_delta' in pg_get_functiondef(
      'public.registrar_compra_y_atender_sugerencias_v1(jsonb)'::regprocedure))>0,
    'H91 dejó de componer las RPC canónicas';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-91 PASS, continúa H92' as resultado_h91;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_92_centro_salud_operativa')
    and to_regclass('public.operational_health_state') is not null
    and to_regclass('public.operational_health_incidents') is not null
    and to_regclass('public.operational_health_error_events') is not null
    and to_regprocedure('public.momos_operational_health_snapshot_v1()') is not null
    and to_regprocedure('public.ejecutar_monitor_salud_operativa_v1(text,text)') is not null,
    'H92 no instaló el centro de salud operativa';
  assert has_function_privilege('authenticated','public.momos_operational_health_snapshot_v1()','EXECUTE')
    and has_function_privilege('service_role','public.ejecutar_monitor_salud_operativa_v1(text,text)','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_health_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._run_operational_health_monitor_v1(text)','EXECUTE')
    and not has_table_privilege('authenticated','public.operational_health_incidents','SELECT')
    and not has_table_privilege('service_role','public.operational_health_error_events','SELECT'),
    'H92 perdió RBAC o expuso fuentes internas';
  assert (select count(*) from pg_trigger where not tgisinternal
      and tgname='momos_h92_read_only_guard')>=14,
    'H92 no instaló el modo Solo lectura sobre todo el núcleo';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-92 PASS, continúa H93' as resultado_h92;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_93_continuidad_recuperacion')
    and to_regclass('public.operational_continuity_policy') is not null
    and to_regclass('public.operational_backup_observations') is not null
    and to_regclass('public.operational_recovery_drills') is not null
    and to_regclass('public.operational_contingency_actions') is not null
    and to_regprocedure('public.momos_continuity_snapshot_v1()') is not null
    and to_regprocedure('public.momos_contingency_export_v1()') is not null
    and to_regprocedure('public.registrar_simulacro_recuperacion_v1(jsonb)') is not null,
    'H93 no instaló continuidad y recuperación verificable';
  assert has_function_privilege('authenticated','public.momos_continuity_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.momos_contingency_export_v1()','EXECUTE')
    and has_function_privilege('service_role','public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.operational_recovery_drills','SELECT')
    and not has_table_privilege('service_role','public.operational_contingency_actions','SELECT'),
    'H93 perdió RBAC o expuso evidencia privada';
  assert position('momos_operational_snapshot_v2' in pg_get_functiondef(
      'public.momos_contingency_export_v1()'::regprocedure))>0
    and position('status=''Aprobado''' in pg_get_functiondef(
      'public.registrar_simulacro_recuperacion_v1(jsonb)'::regprocedure))>0,
    'H93 dejó de usar el aislamiento por rol o la certificación explícita';
end $$;

select 'TESTS_OK — migraciones ordenadas 01-93 PASS, rollback total' as resultado_h93;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_94_certificacion_concurrencia_caos')
    and to_regclass('public.operational_resilience_runs') is not null
    and to_regclass('public.operational_resilience_resources') is not null
    and to_regclass('public.operational_resilience_receipts') is not null
    and to_regclass('public.operational_resilience_scenarios') is not null
    and to_regprocedure('public.iniciar_certificacion_resiliencia_v1(jsonb)') is not null
    and to_regprocedure('public.finalizar_certificacion_resiliencia_v1(uuid)') is not null
    and to_regprocedure('public.momos_resilience_snapshot_v1()') is not null,
    'H94 no instalo la certificacion aislada de concurrencia y caos';
  assert has_function_privilege('service_role','public.iniciar_certificacion_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_idempotencia_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_ultima_unidad_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_lease_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_atomicidad_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_resilience_snapshot_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_resilience_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.iniciar_certificacion_resiliencia_v1(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.operational_resilience_runs','SELECT')
    and not has_table_privilege('service_role','public.operational_resilience_receipts','SELECT'),
    'H94 perdio RBAC o expuso evidencia privada';
  assert position('IDEMPOTENT_REPLAY' in pg_get_functiondef(
      'public.registrar_resultados_resiliencia_v1(jsonb)'::regprocedure))>0
    and position('Validado sintetico' in pg_get_functiondef(
      'public.finalizar_certificacion_resiliencia_v1(uuid)'::regprocedure))>0
    and position('environment=''Staging''' in pg_get_functiondef(
      'public.finalizar_certificacion_resiliencia_v1(uuid)'::regprocedure))>0,
    'H94 confundio validacion sintetica con certificacion staging';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-94 PASS, continua H95' as resultado_h94;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_95_observabilidad_slo')
    and to_regclass('public.operational_slo_policies') is not null
    and to_regclass('public.operational_slo_buckets') is not null
    and to_regclass('public.operational_slo_ingest_receipts') is not null
    and to_regprocedure('public.registrar_telemetria_slo_v1(jsonb)') is not null
    and to_regprocedure('public.momos_operational_slo_snapshot_v1(integer)') is not null,
    'H95 no instalo observabilidad y SLO agregados';
  assert has_function_privilege('service_role','public.registrar_telemetria_slo_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_operational_slo_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_slo_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.registrar_telemetria_slo_v1(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.operational_slo_buckets','SELECT')
    and not has_table_privilege('service_role','public.operational_slo_ingest_receipts','SELECT'),
    'H95 perdio RBAC o expuso telemetria privada';
  assert (select count(*) from public.operational_slo_policies)=7
    and position('histogram-upper-bound' in pg_get_functiondef(
      'public.momos_operational_slo_snapshot_v1(integer)'::regprocedure))>0
    and position('idempotency_key' in pg_get_functiondef(
      'public.registrar_telemetria_slo_v1(jsonb)'::regprocedure))>0,
    'H95 perdio dominios, percentiles o idempotencia';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-95 PASS, continua H96' as resultado_h95;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260721_96_telemetria_alertas')
    and to_regclass('public.operational_slo_alerts') is not null
    and to_regprocedure('public.registrar_lote_telemetria_cliente_slo_v1(jsonb)') is not null
    and to_regprocedure('public.obtener_sonda_slo_servidor_v1()') is not null
    and to_regprocedure('public.evaluar_alertas_slo_v1(integer)') is not null,
    'H96 no instalo telemetria real, sondas y alertas';
  assert has_function_privilege('authenticated','public.registrar_lote_telemetria_cliente_slo_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.obtener_sonda_slo_servidor_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.obtener_sonda_slo_servidor_v1()','EXECUTE')
    and not has_table_privilege('authenticated','public.operational_slo_alerts','SELECT')
    and not has_table_privilege('service_role','public.operational_slo_alerts','SELECT'),
    'H96 perdio RBAC o expuso alertas privadas';
  assert position('client-slo-batch.v1' in pg_get_functiondef(
      'public.registrar_lote_telemetria_cliente_slo_v1(jsonb)'::regprocedure))>0
    and position('momos.server-slo-probe.v1' in pg_get_functiondef(
      'public.obtener_sonda_slo_servidor_v1()'::regprocedure))>0
    and position('containsCustomerPii' in pg_get_functiondef(
      'public.momos_operational_slo_snapshot_v1(integer)'::regprocedure))>0,
    'H96 perdio contratos cerrados o privacidad';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-96 PASS, continua H97' as resultado_h96;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260721_97_evidencia_recuperacion_derivada')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='recovery_target_at')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='storage_manifest_fingerprint')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='replay_receipt_fingerprint'),
    'H97 no instaló evidencia derivada de recuperación, Storage y replay';
  assert has_function_privilege('service_role',
      'public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated',
      'public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated',
      'public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon',
      'public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_table_privilege('authenticated',
      'public.operational_recovery_drills','SELECT'),
    'H97 perdió RBAC o expuso evidencia privada';
  assert position('recovery_target_at' in pg_get_functiondef(
      'public.registrar_simulacro_recuperacion_v1(jsonb)'::regprocedure))>0
    and position('storage_manifest_fingerprint' in pg_get_functiondef(
      'public.registrar_simulacro_recuperacion_v1(jsonb)'::regprocedure))>0
    and position('evidenceDerived' in pg_get_functiondef(
      'public.momos_continuity_snapshot_v1()'::regprocedure))>0
    and position('databaseOnly' in pg_get_functiondef(
      'public.momos_continuity_snapshot_v1()'::regprocedure))>0,
    'H97 perdió derivación temporal o el contrato compacto honesto';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-97 PASS, continua H100' as resultado_h97;
do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_100_piloto_operativo_interno')
    and to_regprocedure('public.piloto_operativo_interno_disponible()') is not null
    and to_regprocedure('public.ofrecer_relevo_despacho(text,text)') is not null,
    'H100 no instalo el cierre del relevo operativo interno';
  assert has_function_privilege('authenticated',
      'public.ofrecer_relevo_despacho(text,text)','EXECUTE')
    and has_function_privilege('authenticated',
      'public.piloto_operativo_interno_disponible()','EXECUTE')
    and not has_function_privilege('anon',
      'public.ofrecer_relevo_despacho(text,text)','EXECUTE')
    and not has_function_privilege('service_role',
      'public.ofrecer_relevo_despacho(text,text)','EXECUTE'),
    'H100 perdio RBAC en el relevo operativo';
  assert position('pg_catalog.sha256' in pg_get_functiondef(
      'public.ofrecer_relevo_despacho(text,text)'::regprocedure))>0
    and position('digest(' in pg_get_functiondef(
      'public.ofrecer_relevo_despacho(text,text)'::regprocedure))=0,
    'H100 conserva la dependencia fragil de pgcrypto.digest';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-100 PASS, continua H102' as resultado_h100;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_102_piloto_comercial_controlado')
    and to_regclass('public.commercial_pilot_runs') is not null
    and to_regclass('public.commercial_pilot_signoffs') is not null
    and to_regclass('public.commercial_pilot_orders') is not null
    and to_regclass('public.commercial_pilot_events') is not null,
    'H102 no instaló el piloto comercial controlado';
  assert to_regprocedure('public.preparar_piloto_comercial_v1(jsonb)') is not null
    and to_regprocedure('public.firmar_piloto_comercial_v1(uuid,text,text,bigint)') is not null
    and to_regprocedure('public.iniciar_piloto_comercial_v1(uuid,bigint,text)') is not null
    and to_regprocedure('public.vincular_pedido_piloto_comercial_v1(uuid,text,uuid)') is not null
    and to_regprocedure('public.conciliar_pedido_piloto_comercial_v1(uuid,text)') is not null
    and to_regprocedure('public.cerrar_piloto_comercial_v1(uuid,bigint)') is not null
    and to_regprocedure('public.momos_commercial_pilot_snapshot_v1()') is not null,
    'H102 perdió una RPC canónica';
  assert has_function_privilege('authenticated',
      'public.momos_commercial_pilot_snapshot_v1()','EXECUTE')
    and not has_function_privilege('anon',
      'public.momos_commercial_pilot_snapshot_v1()','EXECUTE')
    and not has_table_privilege('authenticated',
      'public.commercial_pilot_orders','SELECT')
    and not has_table_privilege('service_role',
      'public.commercial_pilot_orders','SELECT'),
    'H102 perdió RBAC o expuso tablas privadas';
  assert position('publicTrafficOpened' in pg_get_functiondef(
      'public.iniciar_piloto_comercial_v1(uuid,bigint,text)'::regprocedure))>0
    and position('resilience_certified_until' in pg_get_functiondef(
      'public.iniciar_piloto_comercial_v1(uuid,bigint,text)'::regprocedure))>0
    and position('continuity_certified_until' in pg_get_functiondef(
      'public.iniciar_piloto_comercial_v1(uuid,bigint,text)'::regprocedure))>0,
    'H102 perdió cierre de tráfico o gates de salud y recuperación';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-102 PASS, continúa H103' as resultado_h102;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_103_inteligencia_creativa_publicitaria')
    and to_regclass('public.agency_creative_formulas') is not null
    and to_regclass('public.agency_creative_formula_measurements') is not null,
    'H103 no instaló inteligencia creativa publicitaria';
  assert to_regprocedure('public.proponer_formula_creativa_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_formula_creativa_agente_v1(jsonb)') is not null
    and to_regprocedure('public.revisar_formula_creativa_v1(bigint,text,text)') is not null
    and to_regprocedure('public.medir_formula_creativa_v1(jsonb)') is not null
    and to_regprocedure('public.medir_formula_creativa_conector_v1(jsonb)') is not null
    and to_regprocedure('public.resolver_medicion_formula_creativa_v1(bigint,text,text)') is not null
    and to_regprocedure('public.momos_creative_intelligence_v1()') is not null,
    'H103 perdió una RPC canónica';
  assert has_function_privilege('authenticated',
      'public.momos_creative_intelligence_v1()','EXECUTE')
    and has_function_privilege('service_role',
      'public.momos_creative_intelligence_v1()','EXECUTE')
    and not has_function_privilege('anon',
      'public.momos_creative_intelligence_v1()','EXECUTE')
    and not has_table_privilege('authenticated',
      'public.agency_creative_formulas','SELECT')
    and not has_table_privilege('service_role',
      'public.agency_creative_formula_measurements','SELECT'),
    'H103 perdió RBAC o expuso tablas privadas';
  assert position('platform_roas' in pg_get_functiondef(
      'public.momos_creative_intelligence_v1()'::regprocedure))>0
    and position('internal_roas' in pg_get_functiondef(
      'public.momos_creative_intelligence_v1()'::regprocedure))>0
    and position('contribution_return' in pg_get_functiondef(
      'public.momos_creative_intelligence_v1()'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef(
      'public.momos_creative_intelligence_v1()'::regprocedure))>0,
    'H103 mezcló retornos o perdió el cierre de ejecución externa';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-103 PASS, continúa H104' as resultado_h103;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_104_piloto_comercial_ui')
    and to_regprocedure('public.momos_commercial_pilot_snapshot_v2()') is not null,
    'H104 no instaló la vista humana del piloto comercial';
  assert has_function_privilege('authenticated',
      'public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_function_privilege('anon',
      'public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role',
      'public.momos_commercial_pilot_snapshot_v2()','EXECUTE')
    and not has_table_privilege('authenticated',
      'public.commercial_pilot_signoffs','SELECT')
    and not has_table_privilege('authenticated',
      'public.commercial_pilot_orders','SELECT'),
    'H104 perdió RBAC o expuso tablas privadas';
  assert position('containsCustomerPii' in pg_get_functiondef(
      'public.momos_commercial_pilot_snapshot_v2()'::regprocedure))>0
    and position('publicTrafficOpened' in pg_get_functiondef(
      'public.momos_commercial_pilot_snapshot_v2()'::regprocedure))>0
    and position('eligibleOrders' in pg_get_functiondef(
      'public.momos_commercial_pilot_snapshot_v2()'::regprocedure))>0,
    'H104 perdió privacidad, cierre de tráfico o pedidos elegibles';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-104 PASS, continúa H105' as resultado_h104;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_105_humanizacion_comunidad')
    and to_regclass('public.agency_humanization_series') is not null
    and to_regclass('public.agency_humanization_episodes') is not null
    and to_regclass('public.agency_humanization_episode_publications') is not null
    and to_regclass('public.agency_community_signal_rollups') is not null,
    'H105 no instaló Humanización y Comunidad';
  assert to_regprocedure('public.proponer_serie_humanizacion_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_serie_humanizacion_agente_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_episodio_humanizacion_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_episodio_humanizacion_agente_v1(jsonb)') is not null
    and to_regprocedure('public.registrar_senal_comunidad_conector_v1(jsonb)') is not null
    and to_regprocedure('public.momos_humanization_community_v1()') is not null,
    'H105 perdió una RPC canónica';
  assert has_function_privilege('authenticated','public.momos_humanization_community_v1()','EXECUTE')
    and has_function_privilege('service_role','public.momos_humanization_community_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_humanization_community_v1()','EXECUTE')
    and not has_table_privilege('authenticated','public.agency_humanization_series','SELECT')
    and not has_table_privilege('service_role','public.agency_community_signal_rollups','SELECT'),
    'H105 perdió RBAC o expuso tablas privadas';
  assert position('contains_raw_comments' in pg_get_functiondef('public.momos_humanization_community_v1()'::regprocedure))>0
    and position('can_reply' in pg_get_functiondef('public.momos_humanization_community_v1()'::regprocedure))>0
    and position('views_alone_can_win' in pg_get_functiondef('public.momos_humanization_community_v1()'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef('public.momos_humanization_community_v1()'::regprocedure))>0,
    'H105 perdió privacidad, evidencia o cierre externo';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-105 PASS, continúa H106' as resultado_h105;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_106_biblioteca_visual_ampliada')
    and to_regprocedure('public.biblioteca_visual_ampliada_disponible()') is not null
    and to_regprocedure('public.momos_visual_library_v1(jsonb)') is not null
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='brand_asset_production_profiles' and column_name='visual_set_key')
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='brand_asset_production_profiles' and column_name='consent_purposes'),
    'H106 no instaló sets, alcances o proyección visual';
  assert has_function_privilege('service_role','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_table_privilege('authenticated','public.brand_asset_production_profiles','UPDATE'),
    'H106 perdió RBAC o permitió fabricar consentimiento';
  assert position('contains_storage_paths' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('contains_people_identity' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('momos_propose_creative_formula' in pg_get_functiondef('public.registrar_acceso_mcp_agencia(jsonb)'::regprocedure))>0
    and position('momos_humanization_community' in pg_get_functiondef('public.registrar_acceso_mcp_agencia(jsonb)'::regprocedure))>0,
    'H106 perdió privacidad, cierre externo o auditoría H103/H105';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-106 PASS, continúa H107' as resultado_h106;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_107_orquestacion_produccion_formulas')
    and to_regclass('public.agency_formula_production_plans') is not null,
    'H107 no instaló la orquestación fórmula + paquete visual';
  assert to_regprocedure('public.orquestacion_produccion_formulas_disponible()') is not null
    and to_regprocedure('public.preparar_plan_produccion_formula_v1(jsonb)') is not null
    and to_regprocedure('public.preparar_plan_produccion_formula_agente_v1(jsonb)') is not null
    and to_regprocedure('public.revisar_plan_produccion_formula_v1(bigint,text,text)') is not null
    and to_regprocedure('public.momos_production_preflight_v1()') is not null,
    'H107 perdió una RPC canónica';
  assert has_function_privilege('authenticated','public.momos_production_preflight_v1()','EXECUTE')
    and has_function_privilege('service_role','public.momos_production_preflight_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_production_preflight_v1()','EXECUTE')
    and not has_table_privilege('authenticated','public.agency_formula_production_plans','SELECT')
    and not has_table_privilege('service_role','public.agency_formula_production_plans','SELECT'),
    'H107 perdió RBAC o expuso la tabla privada';
  assert position('credits_consumed' in pg_get_functiondef('public.momos_production_preflight_v1()'::regprocedure))>0
    and position('jobs_created' in pg_get_functiondef('public.momos_production_preflight_v1()'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef('public.momos_production_preflight_v1()'::regprocedure))>0
    and position('publication_allowed' in pg_get_functiondef('public.momos_production_preflight_v1()'::regprocedure))>0
    and position('momos_prepare_production_plan' in pg_get_functiondef('public.registrar_acceso_mcp_agencia(jsonb)'::regprocedure))>0,
    'H107 perdió guardas cerradas o auditoría MCP';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-107 PASS, continúa H108' as resultado_h107;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_108_autorizacion_generacion_preflight')
    and to_regclass('public.agency_formula_generation_authorizations') is not null,
    'H108 no instaló la autorización de generación desde preflight';
  assert to_regprocedure('public.autorizacion_generacion_preflight_disponible()') is not null
    and to_regprocedure('public.autorizar_generacion_desde_preflight_v1(jsonb)') is not null
    and to_regprocedure('public.momos_generation_authorizations_v1()') is not null,
    'H108 perdió una RPC canónica';
  assert has_function_privilege('authenticated','public.autorizar_generacion_desde_preflight_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.autorizar_generacion_desde_preflight_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.momos_generation_authorizations_v1()','EXECUTE')
    and not has_table_privilege('authenticated','public.agency_formula_generation_authorizations','SELECT')
    and not has_table_privilege('service_role','public.agency_formula_generation_authorizations','SELECT'),
    'H108 perdió RBAC o expuso la tabla privada';
  assert position('credits_consumed_by_authorization' in pg_get_functiondef(
      'public.momos_generation_authorizations_v1()'::regprocedure))>0
    and position('external_generation_authorized' in pg_get_functiondef(
      'public.momos_generation_authorizations_v1()'::regprocedure))>0
    and position('publication_allowed' in pg_get_functiondef(
      'public.momos_generation_authorizations_v1()'::regprocedure))>0
    and position('momos_generation_authorizations' in pg_get_functiondef(
      'public.registrar_acceso_mcp_agencia(jsonb)'::regprocedure))>0,
    'H108 perdió separación de créditos/publicación o auditoría MCP';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-108 PASS, continúa H109' as resultado_h108;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_109_preparacion_piloto_conectores')
    and to_regclass('public.agency_connector_runtime_seal') is not null
    and to_regclass('public.agency_connector_resume_events') is not null,
    'H109 no instaló aislamiento y evidencia de reanudación';
  assert to_regprocedure('public.configurar_entorno_conectores_v1(jsonb)') is not null
    and to_regprocedure('public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)') is not null
    and to_regprocedure('public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text)') is not null
    and to_regprocedure('public.preparar_reanudacion_integracion_agencia_v1(jsonb)') is not null
    and to_regprocedure('public.momos_connector_pilot_readiness_v1()') is not null,
    'H109 perdió una RPC canónica';
  assert has_function_privilege('service_role','public.configurar_entorno_conectores_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.preparar_reanudacion_integracion_agencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.momos_connector_pilot_readiness_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.reportar_worker_higgsfield(text,text,text,text,boolean)','EXECUTE')
    and not has_table_privilege('authenticated','public.agency_connector_runtime_seal','SELECT')
    and not has_table_privilege('service_role','public.agency_connector_resume_events','SELECT'),
    'H109 perdió RBAC o conservó el heartbeat sin entorno';
  assert position('credits_consumed_by_readiness' in pg_get_functiondef(
      'public.momos_connector_pilot_readiness_v1()'::regprocedure))>0
    and position('publication_allowed' in pg_get_functiondef(
      'public.momos_connector_pilot_readiness_v1()'::regprocedure))>0
    and position('project_ref_verified' in pg_get_functiondef(
      'public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)'::regprocedure))>0,
    'H109 perdió cierre de créditos/publicación o verificación de project ref';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-109 PASS, continúa H110' as resultado_h109;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_110_calidad_maestra_biblioteca_ia')
    and to_regclass('public.brand_visual_quality_assessments') is not null,
    'H110 no instaló la evidencia append-only de calidad visual';
  assert to_regprocedure('public.biblioteca_calidad_ia_disponible()') is not null
    and to_regprocedure('public.biblioteca_calidad_ia_read_model_v1()') is not null
    and to_regprocedure('public.revisar_calidad_activo_visual_v1(bigint,jsonb)') is not null
    and to_regprocedure('public.estado_calidad_paquete_visual_v1(bigint,text)') is not null,
    'H110 perdió una RPC canónica';
  assert has_function_privilege('authenticated','public.revisar_calidad_activo_visual_v1(bigint,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.revisar_calidad_activo_visual_v1(bigint,jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.biblioteca_calidad_ia_read_model_v1()','EXECUTE')
    and not has_table_privilege('authenticated','public.brand_visual_quality_assessments','SELECT')
    and not has_table_privilege('authenticated','public.brand_visual_quality_assessments','INSERT')
    and not has_table_privilege('service_role','public.brand_visual_quality_assessments','SELECT'),
    'H110 perdió RBAC o expuso la evidencia privada';
  assert exists(select 1 from pg_trigger where tgname='agency_formula_plan_visual_quality_guard' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgname='agency_formula_authorization_visual_quality_guard' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgname='creative_job_visual_quality_guard' and not tgisinternal),
    'H110 perdió uno de los tres gates de calidad antes de consumir créditos';
  assert position('target_use' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('quality_contract_version' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('credits_consumed' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef('public.momos_visual_library_v1(jsonb)'::regprocedure))>0,
    'H110 perdió uso objetivo, calidad o cierre de ejecución externa';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-110 PASS, continúa H111' as resultado_h110;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_111_politica_maestro_visual_limpio')
    and to_regprocedure('public.biblioteca_maestro_limpio_disponible()') is not null
    and to_regprocedure('public.estado_maestro_visual_limpio_v1(bigint)') is not null,
    'H111 no instaló la política de máster visual limpio';
  assert exists(select 1 from pg_trigger
      where tgname='brand_clean_master_profile_guard' and not tgisinternal),
    'H111 perdió el guard de clasificación canónica';
  assert has_function_privilege('authenticated','public.biblioteca_maestro_limpio_disponible()','EXECUTE')
    and has_function_privilege('service_role','public.biblioteca_maestro_limpio_disponible()','EXECUTE')
    and not has_function_privilege('authenticated','public.estado_maestro_visual_limpio_v1(bigint)','EXECUTE')
    and not has_function_privilege('service_role','public.estado_maestro_visual_limpio_v1(bigint)','EXECUTE'),
    'H111 perdió RBAC o expuso el clasificador interno';
  assert position('clean_master_policy_version' in pg_get_functiondef(
      'public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('source_quality' in pg_get_functiondef(
      'public.momos_visual_library_v1(jsonb)'::regprocedure))>0
    and position('Original con escarcha' in pg_get_functiondef(
      'public.estado_calidad_activo_visual_v1(bigint,text)'::regprocedure))>0
    and position('external_execution_allowed' in pg_get_functiondef(
      'public.estado_maestro_visual_limpio_v1(bigint)'::regprocedure))>0,
    'H111 perdió la clasificación MCP o el gate dinámico anti-escarcha';
end $$;

select 'TESTS_OK - migraciones ordenadas 01-111 PASS, rollback total' as resultado_h111;
rollback;
