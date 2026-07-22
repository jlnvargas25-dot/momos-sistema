-- MOMOS OPS · H66 Snapshot escalonado de Agencia v1.
--
-- Reemplaza el fan-out del navegador por un bundle atomico con cuatro
-- alcances acotados. Cada alcance conserva una proyeccion explicita, un
-- cursor por contenido y un sobre que declara privacidad y autoridad. No
-- publica, pauta, genera ni modifica ningun dato externo.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_65_hechos_financieros'
  ) then
    raise exception 'Falta el paso 65_hechos_financieros.';
  end if;
  if to_regprocedure('public.current_user_has_any_role(text[])') is null then
    raise exception 'Falta la matriz de roles multiples.';
  end if;
end $$;

-- Un unico evento sanitizado reemplaza la exposicion Realtime de las tablas
-- crudas de Agencia. La version solo comunica "algo cambio"; nunca incluye
-- filas, actores, rutas, notas, payloads ni secretos.
create table if not exists public.agency_snapshot_events(
  id boolean primary key default true check(id=true),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);

insert into public.agency_snapshot_events(id,version,changed_at)
values(true,1,clock_timestamp())
on conflict(id) do nothing;

alter table public.agency_snapshot_events enable row level security;
drop policy if exists agency_snapshot_events_authorized_read on public.agency_snapshot_events;
create policy agency_snapshot_events_authorized_read
on public.agency_snapshot_events
for select to authenticated
using(
  auth.uid() is not null
  and public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is true
);

revoke all on table public.agency_snapshot_events from public,anon,authenticated,service_role;
grant select on table public.agency_snapshot_events to authenticated;

-- Lista cerrada de fuentes que alimentan alguno de los cuatro scopes. Se
-- conserva privada para que el navegador no pueda usarla como inventario del
-- esquema. H66 proyecta 66 fuentes, incluidos los singletons de salud que
-- forman parte del contrato vigente.
create or replace function public._momos_agency_snapshot_source_tables_v1()
returns text[]
language sql
immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select array[
    'agency_settings','agency_briefs','agency_decisions','agency_creative_versions',
    'marketing_ideas','marketing_guiones','marketing_mensajes','marketing_tasks',
    'campaigns','creatives','content_posts','metrics_daily','agency_growth_mode_policies',
    'agency_growth_snapshots','agency_growth_selections','agency_agent_runs','agency_agent_proposals',
    'agency_action_outcomes','agency_collaboration_rooms','agency_collaboration_entries',
    'agency_creative_contracts','content_distributions','distribution_connector_jobs',
    'agency_integrations','creative_connector_runs','agency_mcp_human_approvals',
    'agency_brand_profiles','agency_brand_kits','agency_brand_color_tokens','agency_brand_kit_assets',
    'agency_brand_gate_bindings','agency_master_releases',
    'agency_master_release_events','agency_meta_investment_authorizations',
    'agency_meta_investment_execution_jobs','agency_meta_connector_dry_runs',
    'brand_media_assets','brand_asset_production_profiles','creative_generation_jobs','brand_media_usages',
    'brand_production_packs','brand_production_pack_assets','agency_storyboards',
    'agency_storyboard_shots','agency_motion_plans','agency_motion_recipes',
    'agency_motion_observations','agency_scene_routing_plans','agency_scene_quality_reviews',
    'agency_postproduction_packages','agency_postproduction_exports',
    'agency_postproduction_worker_health','agency_postproduction_export_audio',
    'agency_retention_scripts','agency_retention_hooks','agency_retention_loops',
    'agency_retention_experiments','agency_retention_measurements',
    'agency_retention_diagnostics','agency_retention_learnings','agency_meta_policies',
    'agency_meta_signal_snapshots','agency_meta_diagnostics','agency_meta_lift_studies',
    'agency_meta_lift_measurements','agency_meta_investment_scenarios'
  ]::text[];
$$;

revoke all on function public._momos_agency_snapshot_source_tables_v1() from public,anon,authenticated,service_role;

-- El helper no tiene ACL para clientes. Mantiene el cuerpo del RPC principal
-- legible y hace imposible pedir una tabla o columna arbitraria.
create or replace function public._momos_agency_scope_payload_v1(p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if p_scope='overview' then
    return jsonb_build_object(
      'agency_snapshot_ready',true,
      'agency_server_ready',true,
      'agency_settings',coalesce((select to_jsonb(x) from (
        select autonomy_mode,daily_budget_limit,campaign_budget_limit,scale_step_pct,
          require_creative_approval,block_out_of_stock,contact_only_authorized,paused,updated_at
        from public.agency_settings where id=true
      ) x),'null'::jsonb),
      'agency_briefs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,decision_key,title,objective,campaign_id,product_id,crm_segment,offer,channel,
          deliverables,insight,evidence,status,proposed_budget,approved_budget,stock_snapshot,
          created_at,approved_at,updated_at
        from public.agency_briefs order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_decisions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,brief_id,campaign_id,creative_id,type,title,rationale,evidence,proposed_action,
          risk_level,status,author,created_at,approved_at,executed_at,result
        from public.agency_decisions order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_creative_versions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,creative_id,brief_id,version,provider,prompt,negative_prompt,brand_snapshot,
          status,feedback,generation_cost,created_at,reviewed_at
        from public.agency_creative_versions order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'marketing_ideas',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
        select i.id,i.titulo,i.cat,i.objetivo,i.producto_sugerido_id,p.nombre as producto_sugerido,
          i.copy,i.guion_corto,i.canal,i.estado
        from public.marketing_ideas i left join public.products p on p.id=i.producto_sugerido_id
        order by i.id desc limit 100
      ) x),'[]'::jsonb),
      'marketing_guiones',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
        select g.id,g.titulo,g.duracion_seg,g.producto_foco_id,p.nombre as producto_foco,
          g.objetivo,g.dificultad,g.escenas,g.texto_pantalla,g.audio
        from public.marketing_guiones g left join public.products p on p.id=g.producto_foco_id
        order by g.id desc limit 100
      ) x),'[]'::jsonb),
      'marketing_mensajes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,tipo,texto from public.marketing_mensajes order by id
      ) x),'[]'::jsonb),
      'marketing_tasks',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
        select id,tarea,fecha,estado,responsable,origen,recommendation_id
        from public.marketing_tasks order by fecha desc,id desc limit 100
      ) x),'[]'::jsonb),
      'campaigns',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select c.id,c.nombre,c.canal,c.objetivo,c.producto_foco_id,p.nombre as producto_foco,
          c.oferta,c.fecha_inicio,c.fecha_fin,c.presupuesto,c.gasto_real,c.estado,c.responsable
        from public.campaigns c left join public.products p on p.id=c.producto_foco_id
        order by c.id
      ) x),'[]'::jsonb),
      'creatives',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
        select c.id,c.campaign_id,c.titulo,c.canal,c.formato,c.producto_foco_id,
          p.nombre as producto_foco,c.figura as figura_foco,c.sabor as sabor_foco,c.hook,c.copy,
          c.guion,c.estado,c.responsable,c.fecha_entrega,c.external_id,c.generacion
        from public.creatives c left join public.products p on p.id=c.producto_foco_id
        order by c.id desc limit 200
      ) x),'[]'::jsonb),
      'content_calendar',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.hora desc) from (
        select id,fecha,hora,canal,campaign_id,creative_id,titulo,copy_final,estado,
          url_publicacion,external_post_id
        from public.content_posts order by fecha desc,hora desc limit 200
      ) x),'[]'::jsonb),
      'creative_results',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
        select id,fecha,fuente,campaign_id,creative_id,post_id,impresiones,alcance,clicks,
          mensajes_wa as mensajes_whatsapp,gasto
        from public.metrics_daily order by fecha desc,id desc limit 300
      ) x),'[]'::jsonb),
      'agency_growth_ready',true,
      'agency_growth_policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.mode_key) from (
        select mode_key,label,channel_mode,objective,controls,version,active,updated_at
        from public.agency_growth_mode_policies where active order by mode_key
      ) x),'[]'::jsonb),
      'agency_growth_snapshots',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,snapshot_key,engine_version,generated_for,facts,modes,recommended_mode,
          policy_snapshot as policy,snapshot_fingerprint as fingerprint,prepared_at
        from public.agency_growth_snapshots order by prepared_at desc limit 30
      ) x),'[]'::jsonb),
      'agency_growth_selections',coalesce((select jsonb_agg(to_jsonb(x) order by x.selected_at desc) from (
        select id,snapshot_id,mode_key,objective,status,selected_at,external_execution
        from public.agency_growth_selections order by selected_at desc limit 30
      ) x),'[]'::jsonb),
      -- Metadatos oficiales sin storage_path ni URLs firmadas. La firma del
      -- logo sigue ocurriendo solo cuando la persona abre Identidad.
      'agency_brand_identity',coalesce(public.obtener_identidad_marca(false),'{}'::jsonb)
    );
  elsif p_scope='workflow' then
    return jsonb_build_object(
      'agency_orchestrator_ready',true,
      'agency_agent_runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (
        select id,run_key,trigger_type,status,focus,context_snapshot,agent_name,agent_version,
          requested_at,completed_at
        from public.agency_agent_runs order by requested_at desc limit 50
      ) x),'[]'::jsonb),
      'agency_agent_proposals',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,run_id,proposal_key,payload_fingerprint as fingerprint,status,decision_id,
          resolved_at,created_at,
          jsonb_build_object(
            'decision_type',sealed_payload->'decision_type','title',sealed_payload->'title',
            'rationale',sealed_payload->'rationale','evidence',sealed_payload->'evidence',
            'proposed_action',sealed_payload->'proposed_action','required_tools',sealed_payload->'required_tools',
            'confidence',sealed_payload->'confidence','risk_level',sealed_payload->'risk_level',
            'estimated_cost_cop',sealed_payload->'estimated_cost_cop','cost_cap_cop',sealed_payload->'cost_cap_cop',
            'execution_mode',sealed_payload->'execution_mode','source',sealed_payload->'source'
          ) as sealed_payload
        from public.agency_agent_proposals order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_action_queue_ready',true,
      'agency_action_queue',coalesce(public.obtener_bandeja_acciones_agencia(),'{}'::jsonb),
      'agency_action_outcomes_ready',true,
      'agency_action_outcomes',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,decision_id,action_code,completion_status,target_decision_status,observed_result,
          evidence_kind,evidence_id,actual_cost,summary,blocker_code,external_execution,fingerprint,created_at
        from public.agency_action_outcomes order by created_at desc limit 200
      ) x),'[]'::jsonb),
      'agency_collaboration_ready',true,
      'agency_collaboration_rooms',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
        select id,room_key,title,objective,status,brief_id,decision_id,context_fingerprint,created_at,updated_at
        from public.agency_collaboration_rooms order by updated_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_collaboration_entries',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
        select id,room_id,entry_key,author_kind,entry_type,body,payload_fingerprint as fingerprint,
          agent_name,created_at
        from public.agency_collaboration_entries order by created_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_creative_contracts',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,contract_key,room_id,version,status,sealed_payload,contract_fingerprint as fingerprint,
          prepared_at,approved_at,approval_snapshot
        from public.agency_creative_contracts order by prepared_at desc limit 100
      ) x),'[]'::jsonb),
      'distribution_server_ready',true,
      'content_distributions',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
        select id,post_id,channel,content_mode,status,checklist,attempt,prepared_at,approved_at,
          published_at,external_post_id,failure_reason,updated_at
        from public.content_distributions order by updated_at desc limit 100
      ) x),'[]'::jsonb),
      'distribution_connector_ready',true,
      'distribution_connector_jobs',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
        select id,distribution_id,post_id,provider,mode,attempt,status,authorized_at,scheduled_at,
          dispatched_at,actual_cost_cop,completed_at,updated_at
        from public.distribution_connector_jobs order by updated_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_integrations_ready',true,
      'agency_integrations',coalesce((select jsonb_agg(to_jsonb(x) order by x.provider) from (
        select provider,kind,status,environment,account_label,capabilities,secret_configured,
          last_heartbeat_at,last_sync_at,updated_at,worker_version,last_job_at,successful_jobs,failed_jobs
        from public.agency_integrations order by provider
      ) x),'[]'::jsonb),
      'higgsfield_connector_ready',public.higgsfield_conector_disponible(),
      'kling_connector_ready',public.kling_conector_disponible(),
      'creative_connector_runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.leased_at desc) from (
        select id,job_id,provider,state,estimated_cost_cop,actual_cost_cop,leased_at,started_at,finished_at
        from public.creative_connector_runs order by leased_at desc limit 50
      ) x),'[]'::jsonb),
      'mcp_human_approval_ready',true,
      'mcp_human_approvals',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (
        select id,request_key,job_id,title,status,contract_fingerprint,job_fingerprint,
          requested_at,expires_at,decided_at
        from public.agency_mcp_human_approvals order by requested_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_brand_governance_ready',true,
      'agency_brand_profile',coalesce(public.obtener_perfil_marca_activo(),'{}'::jsonb),
      'agency_brand_gate_bindings',coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc) from (
        select id,target_type,target_key,brand_profile_id,brand_fingerprint,target_fingerprint,passed_at
        from public.agency_brand_gate_bindings order by passed_at desc limit 200
      ) x),'[]'::jsonb),
      'agency_creative_flow_ready',true,
      'agency_master_releases',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
        select id,release_key,contract_id,storyboard_id,export_id,output_asset_id,creative_id,post_id,
          distribution_id,content_mode,status,lineage_fingerprint,prepared_at,updated_at
        from public.agency_master_releases order by updated_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_master_release_events',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc) from (
        select id,release_id,event_type,target_key,event_fingerprint,recorded_at
        from public.agency_master_release_events order by recorded_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_meta_authorization_ready',true,
      'agency_meta_investment_authorizations',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (
        select id,authorization_key,scenario_id,measurement_id,campaign_id,product_id,selected_option,
          target_budget,execution_mode,status,valid_from,valid_until,snapshot_fingerprint as fingerprint,
          requested_at,authorized_at,reviewed_at,revoked_at
        from public.agency_meta_investment_authorizations order by requested_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_meta_investment_execution_jobs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,authorization_id,attempt,execution_mode,status,lease_expires_at,dispatched_at,
          completed_at,created_at,updated_at
        from public.agency_meta_investment_execution_jobs order by created_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_meta_connector_ready',true,
      'agency_meta_connector_dry_runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,dry_run_key,authorization_id,campaign_id,api_version,mode,status,prepared_at,
          lease_expires_at,started_at,completed_at,updated_at
        from public.agency_meta_connector_dry_runs order by prepared_at desc limit 300
      ) x),'[]'::jsonb)
    );
  elsif p_scope='production' then
    return jsonb_build_object(
      'brand_media_ready',true,
      'mundo_animado_ready',public.mundo_animado_disponible(),
      'official_logo_deletion_ready',public.eliminacion_logo_oficial_disponible(),
      'brand_production_ready',public.biblioteca_produccion_disponible(),
      'creative_production_ready',public.produccion_creativa_disponible(),
      'creative_review_ready',public.revision_creativa_disponible(),
      'creative_iteration_ready',public.versiones_creativas_disponibles(),
      'brand_media_assets',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select a.id,a.name,a.media_type,a.source,a.product_id,p.nombre as product_name,a.figure,a.flavor,
          a.shot_type,a.orientation,a.contains_people,a.rights_status,a.rights_expires_at,a.ai_use_allowed,
          a.allowed_channels,a.status,a.storage_path,a.mime_type,a.size_bytes,a.width,a.height,
          a.duration_seconds,a.tags,a.content_hash,a.original_asset_id,a.generation_meta,
          a.created_by,a.created_at,a.archived_by,a.archived_at,
          case when pp.asset_id is null then null else jsonb_build_object(
            'asset_id',pp.asset_id,'component_type',pp.component_type,'view_angle',pp.view_angle,
            'physical_state',pp.physical_state,'interaction_type',pp.interaction_type,
            'hand_assignment',pp.hand_assignment,'location_name',pp.location_name,
            'light_direction',pp.light_direction,'scale_reference',pp.scale_reference,
            'source_quality',pp.source_quality,'qa_status',pp.qa_status,
            'consent_status',pp.consent_status,
            'canonical',pp.canonical,'created_at',pp.created_at,'updated_at',pp.updated_at
          ) end as production_profile
        from public.brand_media_assets a left join public.products p on p.id=a.product_id
        left join public.brand_asset_production_profiles pp on pp.asset_id=a.id
        where a.status in ('Activo','Archivado','Bloqueado')
        order by a.created_at desc limit 100
      ) x),'[]'::jsonb),
      'creative_generation_jobs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,
          prompt,negative_prompt,brand_snapshot,output_spec,output_asset_id,generation_cost,max_cost_cop,
          provider_job_id,error_message,authorized_at,cancelled_at,cancellation_reason,attempt_count,
          started_at,completed_at,output_review_status,output_review_feedback,output_reviewed_at,
          revision_of_job_id,revision_number,created_by,created_at,updated_at
        from public.creative_generation_jobs order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'brand_media_usages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,asset_id,job_id,creative_version_id,role,start_second,end_second,created_by,created_at
        from public.brand_media_usages order by created_at desc limit 300
      ) x),'[]'::jsonb),
      'brand_production_packs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,name,purpose,version,status,product_id,figure,channel,target_format,description,
          requirements,fingerprint,created_by,created_at,reviewed_by,reviewed_at,review_note
        from public.brand_production_packs where status<>'Archivado' order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'brand_production_pack_assets',coalesce((select jsonb_agg(to_jsonb(x) order by x.pack_id desc,x.sequence) from (
        select pack_id,asset_id,role,sequence,required,notes,added_by,added_at
        from public.brand_production_pack_assets order by pack_id desc,sequence limit 500
      ) x),'[]'::jsonb),
      'agency_scene_studio_ready',true,
      'agency_storyboards',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,
          target_duration_sec,creative_brief,retention_plan,source_fingerprint as fingerprint,
          estimated_cost_cop,created_at,submitted_at,reviewed_at
        from public.agency_storyboards order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_storyboard_shots',coalesce((select jsonb_agg(to_jsonb(x) order by x.shot_number) from (
        select id,storyboard_id,shot_number,revision,status,title,purpose,duration_sec,
          shot_payload as payload,input_asset_ids as asset_ids,estimated_cost_cop,
          shot_fingerprint as fingerprint,created_at
        from public.agency_storyboard_shots order by created_at desc,shot_number limit 1000
      ) x),'[]'::jsonb),
      'agency_motion_ready',true,
      'agency_motion_plans',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,plan_key,storyboard_id,version,status,grammar_primary,grammar_secondary,continuity_ledger,
          plan_snapshot as snapshot,plan_fingerprint as fingerprint,estimated_preview_cost_cop,source_kind,
          prepared_at,reviewed_at
        from public.agency_motion_plans order by prepared_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_motion_recipes',coalesce((select jsonb_agg(to_jsonb(x) order by x.shot_number) from (
        select id,plan_id,storyboard_id,shot_id,shot_number,shot_fingerprint,selected_key,proposals,
          selected_recipe,recipe_fingerprint as fingerprint,estimated_preview_cost_cop,created_at
        from public.agency_motion_recipes order by created_at desc,shot_number limit 1000
      ) x),'[]'::jsonb),
      'agency_motion_observations',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc) from (
        select id,observation_key,plan_id,recipe_id,shot_id,job_id,quality_review_id,provider,model,
          model_version,effective_parameters,actual_cost_cop,runtime_sec,attempts,errors,manual_corrections,
          qa_snapshot,attention_snapshot,observation_fingerprint as fingerprint,recorded_at
        from public.agency_motion_observations order by recorded_at desc limit 1000
      ) x),'[]'::jsonb),
      'agency_scene_router_ready',true,
      'agency_scene_routing_plans',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,plan_key,storyboard_id,motion_plan_id,motion_plan_fingerprint,version,status,
          plan_snapshot as snapshot,plan_fingerprint as fingerprint,total_estimated_cost_cop,total_cost_cap_cop,
          created_at,resolved_at,job_ids
        from public.agency_scene_routing_plans order by created_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_quality_ready',true,
      'agency_scene_quality_reviews',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,review_key,routing_plan_id,storyboard_id,shot_id,job_id,output_asset_id,source_kind,
          status,failure_type,scores,score_total,findings,continuity_observation,
          review_fingerprint as fingerprint,created_at,resolved_at
        from public.agency_scene_quality_reviews order by created_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_postproduction_packages',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,package_key,storyboard_id,routing_plan_id,version,status,package_snapshot as snapshot,
          package_fingerprint as fingerprint,prepared_at,reviewed_at
        from public.agency_postproduction_packages order by prepared_at desc limit 100
      ) x),'[]'::jsonb),
      'agency_postproduction_export_ready',true,
      'agency_postproduction_exports',coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (
        select id,export_key,package_id,version,status,export_snapshot as snapshot,export_fingerprint as fingerprint,
          requested_at,attempts,output_asset_id,result_fingerprint,started_at,exported_at,reviewed_at
        from public.agency_postproduction_exports order by requested_at desc limit 200
      ) x),'[]'::jsonb),
      'agency_postproduction_workers',coalesce((select jsonb_agg(to_jsonb(x) order by x.heartbeat_at desc) from (
        select version,status,ffmpeg_available,ffmpeg_version,heartbeat_at
        from public.agency_postproduction_worker_health order by heartbeat_at desc limit 20
      ) x),'[]'::jsonb),
      'agency_postproduction_audio_ready',true,
      'agency_postproduction_audio_bindings',coalesce((select jsonb_agg(to_jsonb(x) order by x.authorized_at desc) from (
        select export_id,mode,asset_id,audio_snapshot as snapshot,audio_fingerprint as fingerprint,authorized_at
        from public.agency_postproduction_export_audio order by authorized_at desc limit 200
      ) x),'[]'::jsonb)
    );
  elsif p_scope='measurement' then
    return jsonb_build_object(
      'agency_retention_ready',true,
      'agency_retention_scripts',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,script_key,contract_id,version,title,status,platform,target_duration_sec,objective,audience,
          promise,payoff,source_kind,script_snapshot as snapshot,script_fingerprint as fingerprint,
          prepared_at,reviewed_at
        from public.agency_retention_scripts order by prepared_at desc limit 200
      ) x),'[]'::jsonb),
      'agency_retention_hooks',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,script_id,variant_key,label,mechanism,hook_text,opening_visual,proof,scores,
          score_total,selected,hook_fingerprint as fingerprint
        from public.agency_retention_hooks order by id limit 500
      ) x),'[]'::jsonb),
      'agency_retention_loops',coalesce((select jsonb_agg(to_jsonb(x) order by x.script_id,x.open_sec) from (
        select id,script_id,loop_key,question,open_sec,partial_payoff_sec,close_sec,payoff,
          loop_fingerprint as fingerprint
        from public.agency_retention_loops order by script_id,open_sec limit 1000
      ) x),'[]'::jsonb),
      'agency_retention_experiments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select id,experiment_key,script_id,control_hook_id,challenger_hook_id,declared_variable,
          hypothesis,primary_metric,status,experiment_snapshot as snapshot,
          experiment_fingerprint as fingerprint,created_at,resolved_at,resolution,winner_hook_id
        from public.agency_retention_experiments order by created_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_retention_measurements',coalesce((select jsonb_agg(to_jsonb(x) order by x.captured_at desc) from (
        select id,measurement_key,experiment_id,hook_id,content_post_id,platform,captured_at,sample_size,
          impressions,starts,views_3s,views_25,views_50,views_75,views_100,watch_time_sec,clicks,
          paid_orders,attributed_revenue,attributed_margin,incremental_profit,retention_curve,
          publication_fingerprint,source_kind
        from public.agency_retention_measurements order by captured_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_loop_learning_ready',true,
      'agency_retention_diagnostics',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,diagnostic_key,measurement_id,experiment_id,script_id,hook_id,status,tested_variable,
          primary_signal,hypothesis,recommendation,confidence,diagnostic_fingerprint as fingerprint,
          source_kind,prepared_at,reviewed_at
        from public.agency_retention_diagnostics order by prepared_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_retention_learnings',coalesce((select jsonb_agg(to_jsonb(x) order by x.approved_at desc) from (
        select id,learning_key,diagnostic_id,platform,audience,target_duration_sec,tested_variable,
          statement,scope_snapshot as scope,evidence_snapshot as evidence,learning_fingerprint as fingerprint,approved_at
        from public.agency_retention_learnings order by approved_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_meta_ready',true,
      'agency_meta_policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.version desc) from (
        select id,policy_key,version,status,source_label,market,currency,effective_from,effective_until,
          targets,thresholds,policy_fingerprint as fingerprint,created_at
        from public.agency_meta_policies order by version desc limit 100
      ) x),'[]'::jsonb),
      'agency_meta_snapshots',coalesce((select jsonb_agg(to_jsonb(x) order by x.window_end desc) from (
        select id,snapshot_key,entity_type,objective,currency,timezone,window_start,window_end,
          source_captured_at,local_campaign_id,local_creative_id,local_post_id,metrics,pixel_events,
          publication_fingerprint,snapshot_fingerprint as fingerprint,created_at
        from public.agency_meta_signal_snapshots order by window_end desc limit 500
      ) x),'[]'::jsonb),
      'agency_meta_diagnostics',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,diagnostic_key,snapshot_id,policy_id,status,what_happened,why_hypotheses,
          recommended_actions,evidence_snapshot as evidence,confidence,source_kind,
          diagnostic_fingerprint as fingerprint,prepared_at,reviewed_at
        from public.agency_meta_diagnostics order by prepared_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_meta_incrementality_ready',true,
      'agency_meta_lift_studies',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,study_key,diagnostic_id,snapshot_id,campaign_id,design,lifecycle_scope,status,
          window_start,window_end,minimum_per_arm,hypothesis,assignment_snapshot as assignment,
          guardrails,study_fingerprint as fingerprint,source_kind,prepared_at,reviewed_at
        from public.agency_meta_lift_studies order by prepared_at desc limit 300
      ) x),'[]'::jsonb),
      'agency_meta_lift_measurements',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc) from (
        select id,measurement_key,study_id,status,captured_at,control_cell as control,exposed_cell as exposed,
          incremental_spend,platform_result,local_lifecycle_snapshot as lifecycle,result_snapshot as result,
          measurement_fingerprint as fingerprint,recorded_at,reviewed_at
        from public.agency_meta_lift_measurements order by recorded_at desc limit 500
      ) x),'[]'::jsonb),
      'agency_meta_investment_ready',true,
      'agency_meta_investment_scenarios',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc) from (
        select id,scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,
          recommended_option,evidence_snapshot as evidence,options_snapshot as options,guardrails,
          scenario_fingerprint as fingerprint,source_kind,prepared_at,reviewed_at
        from public.agency_meta_investment_scenarios order by prepared_at desc limit 300
      ) x),'[]'::jsonb)
    );
  end if;

  raise exception 'Scope de Agencia invalido.' using errcode='22023';
end $$;

revoke all on function public._momos_agency_scope_payload_v1(text) from public,anon,authenticated,service_role;

-- Construye un sobre ya autorizado usando una version fuente fijada por el
-- RPC publico. Es privado: separar el armado del gate permite que el bundle
-- capture el singleton una sola vez y que los cuatro scopes compartan la
-- misma fotografia MVCC, sin exponer una ruta que acepte versiones elegidas
-- por el cliente.
create or replace function public._momos_agency_snapshot_envelope_v1(
  p_scope text,
  p_source_version bigint,
  p_server_time timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_scope text:=lower(btrim(coalesce(p_scope,'')));
begin
  if v_scope not in ('overview','workflow','production','measurement') then
    raise exception 'Scope de Agencia invalido.' using errcode='22023';
  end if;
  if p_source_version is null or p_source_version<=0 then
    raise exception 'Version fuente de Agencia invalida.' using errcode='22023';
  end if;
  if p_server_time is null then
    raise exception 'Reloj de snapshot de Agencia invalido.' using errcode='22023';
  end if;

  return jsonb_build_object(
    'version',1,
    'source_version',p_source_version,
    'scope',v_scope,
    'server_time',p_server_time,
    'event_id',md5(v_scope||':'||p_source_version::text),
    'privacy',jsonb_build_object(
      'customer_records_projected',false,
      'secrets_projected',false,
      'free_text_unverified',true,
      'telemetry_allowed',false,
      'storage_references_projected',v_scope='production',
      'projection','agency-authorized-v1'
    ),
    'authority',jsonb_build_object(
      'read_only',true,
      'external_execution',false,
      'human_approval_required',true,
      'allowed_roles',jsonb_build_array('Administrador','Marketing/CRM')
    ),
    'payload',public._momos_agency_scope_payload_v1(v_scope)
  );
end $$;

revoke all on function public._momos_agency_snapshot_envelope_v1(text,bigint,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.momos_agency_snapshot_v1(
  p_scope text default 'overview'
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_scope text:=lower(btrim(coalesce(p_scope,'')));
  v_server_time timestamptz:=statement_timestamp();
  v_source_version bigint;
begin
  if auth.uid() is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then
    raise exception 'Tu rol no puede consultar Agencia MOMOS.' using errcode='42501';
  end if;
  if v_scope not in ('overview','workflow','production','measurement') then
    raise exception 'Scope de Agencia invalido.' using errcode='22023';
  end if;

  select version into v_source_version
  from public.agency_snapshot_events
  where id=true;
  if v_source_version is null then
    raise exception 'Falta el evento singleton de Agencia.' using errcode='55000';
  end if;

  return public._momos_agency_snapshot_envelope_v1(
    v_scope,v_source_version,v_server_time
  );
end $$;

revoke all on function public.momos_agency_snapshot_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.momos_agency_snapshot_v1(text) to authenticated;

-- Lectura canonica de Agencia: un solo RPC, un solo gate y una sola version
-- fuente para overview, workflow, production y measurement. Al ser STABLE,
-- todas las consultas internas observan el snapshot de la sentencia que
-- invoca este RPC; una escritura concurrente solo aparecera en la siguiente
-- lectura y en la siguiente version del outbox.
create or replace function public.momos_agency_snapshots_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_server_time timestamptz:=statement_timestamp();
  v_source_version bigint;
begin
  if auth.uid() is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then
    raise exception 'Tu rol no puede consultar Agencia MOMOS.' using errcode='42501';
  end if;

  select version into v_source_version
  from public.agency_snapshot_events
  where id=true;
  if v_source_version is null or v_source_version<=0 then
    raise exception 'Falta el evento singleton de Agencia.' using errcode='55000';
  end if;

  return jsonb_build_object(
    'version',1,
    'source_version',v_source_version,
    'server_time',v_server_time,
    'snapshots',jsonb_build_array(
      public._momos_agency_snapshot_envelope_v1('overview',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('workflow',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('production',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('measurement',v_source_version,v_server_time)
    )
  );
end $$;

revoke all on function public.momos_agency_snapshots_v1() from public,anon,authenticated,service_role;
grant execute on function public.momos_agency_snapshots_v1() to authenticated;

-- Cada fuente toca el singleton una sola vez por sentencia, aunque una
-- operacion afecte cientos de filas. El trigger no serializa OLD/NEW y no
-- puede filtrar informacion por Realtime.
create or replace function public._momos_touch_agency_snapshot_event_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  insert into public.agency_snapshot_events(id,version,changed_at)
  values(true,1,clock_timestamp())
  on conflict(id) do update
    set version=public.agency_snapshot_events.version+1,
        changed_at=excluded.changed_at;
  return null;
end $$;

revoke all on function public._momos_touch_agency_snapshot_event_v1() from public,anon,authenticated,service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array public._momos_agency_snapshot_source_tables_v1() loop
    if to_regclass(format('public.%I',v_table)) is not null then
      execute format('drop trigger if exists momos_agency_snapshot_event_v1 on public.%I',v_table);
      execute format(
        'create trigger momos_agency_snapshot_event_v1 '
        'after insert or update or delete or truncate on public.%I '
        'for each statement execute function public._momos_touch_agency_snapshot_event_v1()',
        v_table
      );
    end if;
  end loop;
end $$;

-- Fail closed: una publicacion FOR ALL TABLES haria imposible garantizar que
-- las fuentes crudas no se emitan. Si la publicacion es de lista cerrada,
-- retiramos cada fuente y agregamos exclusivamente el singleton sanitizado.
do $$
declare
  v_table text;
  v_all_tables boolean;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    select puballtables into v_all_tables
    from pg_publication where pubname='supabase_realtime';
    if coalesce(v_all_tables,false) then
      raise exception 'supabase_realtime publica todas las tablas; H66 no puede proteger fuentes crudas.'
        using errcode='55000';
    end if;

    foreach v_table in array public._momos_agency_snapshot_source_tables_v1() loop
      if to_regclass(format('public.%I',v_table)) is not null and exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime drop table public.%I',v_table);
      end if;
    end loop;

    if not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='agency_snapshot_events'
    ) then
      alter publication supabase_realtime add table public.agency_snapshot_events;
    end if;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260718_66_agency_snapshot_rendimiento',
  'Bundle atomico de Agencia con cuatro scopes, version fuente comun, RBAC y evento Realtime singleton sanitizado'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
