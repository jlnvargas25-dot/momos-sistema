-- MOMOS OPS - H113 - Auditoria MCP canonica y compatible.
-- Corrige la regresion de H109 sin reescribir migraciones aplicadas:
-- conserva el endurecimiento de privacidad, restaura los modos cerrados
-- Referencia/Solicitud y alinea estados y huellas con la tabla inmutable.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260723'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260723_112_recetas_figuras_v4'
  ) then
    raise exception 'Falta el paso 112_recetas_figuras_v4.';
  end if;
  if to_regclass('public.agency_mcp_access_log') is null
     or to_regprocedure('public._agency_mcp_json_safe(jsonb)') is null then
    raise exception 'Falta el contrato base de auditoria MCP.';
  end if;
end $$;

create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key',''));
  v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode',''));
  v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id',''));
  v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint',''));
  v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb);
  v_existing public.agency_mcp_access_log%rowtype;
  v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'Registro MCP invalido o con secretos.';
  end if;

  if v_key!~'^[A-Za-z0-9:_-]{3,180}$'
     or v_tool not in (
       'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
       'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
       'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
       'momos_generation_authorizations','momos_generation_pilots','momos_prepare_production_plan',
       'momos_creative_context','momos_search_brand_assets','momos_get_brand_asset_reference',
       'momos_submit_proposals','momos_request_human_approval','momos_get_human_approval'
     )
     or v_mode not in ('Lectura','Propuesta','Referencia','Solicitud')
     or v_status not in ('OK','Denegado','Fallido')
     or length(v_worker) not between 2 and 120
     or v_input!~'^[0-9a-f]{32}$'
     or (v_output<>'' and v_output!~'^[0-9a-f]{32}$')
     or jsonb_typeof(v_details)<>'object'
     or v_details::text~*'(customer|cliente|phone|telefono|email|address|direccion|signed_url|storage_path|secret|token|service_role|api_key)' then
    raise exception 'Contrato de auditoria MCP invalido.';
  end if;

  if (v_tool in (
        'momos_submit_proposals','momos_propose_creative_formula',
        'momos_propose_humanization_series','momos_propose_humanization_episode',
        'momos_prepare_production_plan'
      ) and v_mode<>'Propuesta')
     or (v_tool='momos_get_brand_asset_reference' and v_mode<>'Referencia')
     or (v_tool='momos_request_human_approval' and v_mode<>'Solicitud')
     or (v_tool not in (
       'momos_submit_proposals','momos_propose_creative_formula',
       'momos_propose_humanization_series','momos_propose_humanization_episode',
       'momos_prepare_production_plan','momos_get_brand_asset_reference',
       'momos_request_human_approval'
     ) and v_mode<>'Lectura') then
    raise exception 'El modo no coincide con la herramienta MCP.';
  end if;

  insert into public.agency_mcp_access_log(
    request_key,tool_name,mode,status,worker_id,subject_ref,
    input_fingerprint,output_fingerprint,details
  ) values(
    v_key,v_tool,v_mode,v_status,v_worker,v_subject,
    v_input,v_output,v_details
  )
  on conflict(request_key) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing
    from public.agency_mcp_access_log
    where request_key=v_key;

    if row(
      v_existing.tool_name,v_existing.mode,v_existing.status,
      v_existing.worker_id,v_existing.subject_ref,v_existing.input_fingerprint,
      v_existing.output_fingerprint,v_existing.details
    ) is distinct from row(
      v_tool,v_mode,v_status,v_worker,v_subject,v_input,v_output,v_details
    ) then
      raise exception 'La clave MCP ya pertenece a otro contrato.';
    end if;

    return jsonb_build_object(
      'ok',true,'id',v_existing.id,'log_id',v_existing.id,'duplicate',true
    );
  end if;

  return jsonb_build_object(
    'ok',true,'id',v_id,'log_id',v_id,'duplicate',false
  );
end $$;

revoke all on function public.registrar_acceso_mcp_agencia(jsonb)
  from public,anon,authenticated;
grant execute on function public.registrar_acceso_mcp_agencia(jsonb)
  to service_role;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260723_113_auditoria_mcp_modos_v2',
  'Auditoria MCP compatible: modos cerrados, estados/huellas alineados, PII bloqueada e idempotencia exacta'
);

commit;
