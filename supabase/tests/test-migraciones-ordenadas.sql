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
    '20260719_73_produccion_deltas','20260719_74_catalogo_crm_deltas'
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
end $$;

select 'TESTS_OK — migraciones ordenadas 01-74 PASS, rollback total' as resultado;
rollback;
