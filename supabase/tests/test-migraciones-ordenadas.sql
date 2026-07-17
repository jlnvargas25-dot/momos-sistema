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
    '20260716_49_gobernanza_marca'
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

select 'TESTS_OK — migraciones ordenadas 01-49 PASS, rollback total' as resultado;
rollback;
