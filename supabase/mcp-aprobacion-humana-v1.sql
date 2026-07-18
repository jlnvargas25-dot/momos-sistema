-- MOMOS OPS · H62 Aprobación humana para MCP v1.
-- Codex puede solicitar y consultar una decisión exacta, pero nunca aprobarla.
-- Solo Administración autenticada en MOMO OPS puede resolver el preflight y,
-- al aprobarlo, autorizar el trabajo creativo existente con su tope sellado.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260718_61_biblioteca_produccion') then
    raise exception 'Falta el paso 61_biblioteca_produccion.';
  end if;
  if to_regprocedure('public.momos_get_brand_asset_reference(jsonb)') is null
     or to_regprocedure('public.autorizar_trabajo_creativo(bigint,numeric)') is null then
    raise exception 'Faltan el MCP de Biblioteca o la autorización creativa.';
  end if;
end $$;

alter table public.agency_mcp_access_log
  drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log
  add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
    'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context',
    'momos_submit_proposals','momos_search_brand_assets','momos_get_brand_asset_reference',
    'momos_request_human_approval','momos_get_human_approval'
  ));
alter table public.agency_mcp_access_log
  drop constraint if exists agency_mcp_access_log_mode_check;
alter table public.agency_mcp_access_log
  add constraint agency_mcp_access_log_mode_check check(mode in ('Lectura','Propuesta','Referencia','Solicitud'));

create table if not exists public.agency_mcp_human_approvals(
  id bigint generated always as identity primary key,
  request_key text not null unique check(request_key~'^[A-Za-z0-9:_-]{3,180}$'),
  worker_id text not null check(worker_id~'^[A-Za-z0-9._:-]{2,120}$'),
  job_id bigint not null references public.creative_generation_jobs(id) on delete restrict,
  title text not null check(length(btrim(title)) between 3 and 180),
  status text not null default 'Pendiente' check(status in ('Pendiente','Aprobada','Rechazada','Vencida','Cancelada')),
  approval_contract jsonb not null check(jsonb_typeof(approval_contract)='object'),
  contract_fingerprint text not null check(contract_fingerprint~'^[0-9a-f]{32}$'),
  job_fingerprint text not null check(job_fingerprint~'^[0-9a-f]{32}$'),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by text references public.users(id),
  decided_at timestamptz,
  decision_note text not null default '' check(length(decision_note)<=500),
  constraint agency_mcp_human_approval_expiry check(expires_at>requested_at and expires_at<=requested_at+interval '72 hours'),
  constraint agency_mcp_human_approval_no_secret check(approval_contract::text !~*
    '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization|signed[_-]?url|storage[_-]?path)"[[:space:]]*:'),
  constraint agency_mcp_human_approval_no_execution check(
    approval_contract->>'generation_allowed'='false' and approval_contract->>'external_execution'='false'
  ),
  constraint agency_mcp_human_approval_decision_tuple check(
    (status in ('Pendiente','Vencida','Cancelada') and decided_by is null and decided_at is null and decision_note='')
    or (status in ('Aprobada','Rechazada') and decided_by is not null and decided_at is not null and length(btrim(decision_note))>=3)
  )
);
create index if not exists agency_mcp_human_approvals_status_idx
  on public.agency_mcp_human_approvals(status,requested_at desc);
create unique index if not exists agency_mcp_human_approvals_one_pending_job_idx
  on public.agency_mcp_human_approvals(job_id) where status='Pendiente';

alter table public.agency_mcp_human_approvals enable row level security;
drop policy if exists staff_read on public.agency_mcp_human_approvals;
create policy staff_read on public.agency_mcp_human_approvals for select to authenticated
  using(public.current_user_has_any_role(array['Administrador','Marketing/CRM']));
revoke all on public.agency_mcp_human_approvals from public,anon,authenticated,service_role;
revoke all on sequence public.agency_mcp_human_approvals_id_seq from public,anon,authenticated,service_role;
grant select on public.agency_mcp_human_approvals to authenticated;

create or replace function public.mcp_aprobaciones_humanas_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public.mcp_aprobacion_humana_contrato() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'schema_version','momos-human-approval-contract/v1',
    'status_schema','momos-human-approval-status/v1',
    'provider','Higgsfield',
    'tools',jsonb_build_array('momos_request_human_approval','momos_get_human_approval'),
    'required_preflight',jsonb_build_array(
      'model','duration_seconds','target_format','references','lens','camera_movement',
      'lighting','prompt_fingerprint','estimated_credits','max_cost_cop','balance_credits'
    ),
    'max_ttl_hours',72,
    'human_resolver','MOMO OPS · Administración',
    'mcp_can_decide',false,
    'external_execution_allowed',false
  )
$$;

create or replace function public._mcp_human_text_safe(p_text text,p_min integer,p_max integer) returns boolean
language sql immutable security definer set search_path=public as $$
  select length(btrim(coalesce(p_text,''))) between p_min and p_max
    and coalesce(p_text,'') !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    and coalesce(p_text,'') !~* '(https?://|www\.)'
    and coalesce(p_text,'') !~* '(sb_secret_|\bsk-[A-Za-z0-9_-]{8,}|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|app[ _-]?secret|password|service[ _-]?role|authorization)'
$$;

create or replace function public._mcp_human_job_fingerprint(p_job_id bigint) returns text
language plpgsql stable security definer set search_path=public as $$
declare v_job public.creative_generation_jobs%rowtype; v_assets jsonb;
begin
  select * into v_job from public.creative_generation_jobs where id=p_job_id;
  if v_job.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',src.id::bigint,'fingerprint',public._mcp_brand_asset_fingerprint(src.id::bigint)
  ) order by src.ord),'[]'::jsonb) into v_assets
  from jsonb_array_elements_text(v_job.input_asset_ids) with ordinality src(id,ord);
  return md5(jsonb_build_object(
    'id',v_job.id,'provider',v_job.provider,'operation',v_job.operation,
    'target_channel',v_job.target_channel,'target_format',v_job.target_format,
    'prompt',v_job.prompt,'negative_prompt',v_job.negative_prompt,
    'brand_snapshot',v_job.brand_snapshot,'output_spec',v_job.output_spec,
    'assets',v_assets
  )::text);
end $$;

create or replace function public.momos_solicitar_aprobacion_humana(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key',''));
  v_worker text:=btrim(coalesce(p->>'worker_id',''));
  v_job_id bigint:=nullif(p->>'job_id','')::bigint;
  v_title text:=btrim(coalesce(p->>'title',''));
  v_ttl integer:=coalesce(nullif(p->>'expires_in_hours','')::integer,24);
  v_contract jsonb:=coalesce(p->'contract','{}'::jsonb);
  v_job public.creative_generation_jobs%rowtype;
  v_existing public.agency_mcp_human_approvals%rowtype;
  v_ref jsonb; v_asset public.brand_media_assets%rowtype; v_asset_id bigint;
  v_contract_fp text; v_job_fp text; v_id bigint;
  v_pack public.brand_production_packs%rowtype;
  v_allowed_keys text[]:=array[
    'schema_version','provider','surface','model','workflow','objective','duration_seconds',
    'aspect_ratio','target_channel','target_format','resolution','audio','outputs','references',
    'production_pack_id','production_pack_fingerprint','lens','camera_movement','lighting',
    'prompt','prompt_version','prompt_fingerprint','estimated_credits','max_cost_cop','balance_credits',
    'risks','acceptance_criteria','generation_allowed','external_execution'
  ];
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'La solicitud MCP es inválida o contiene secretos.';
  end if;
  if exists(select 1 from jsonb_object_keys(p) k where k not in ('request_key','worker_id','job_id','title','expires_in_hours','contract')) then
    raise exception 'La solicitud MCP contiene campos fuera del contrato.';
  end if;
  if v_key!~'^[A-Za-z0-9:_-]{3,180}$' or v_worker!~'^[A-Za-z0-9._:-]{2,120}$'
     or not public._mcp_human_text_safe(v_title,3,180) or v_ttl not between 1 and 72 then
    raise exception 'La identidad, título o vigencia de la solicitud es inválida.';
  end if;
  if jsonb_typeof(v_contract)<>'object'
     or exists(select 1 from jsonb_object_keys(v_contract) k where k<>all(v_allowed_keys)) then
    raise exception 'El preflight contiene campos fuera del contrato.';
  end if;
  if v_contract->>'schema_version' is distinct from 'momos-human-approval-contract/v1'
     or v_contract->>'provider' is distinct from 'Higgsfield'
     or v_contract->>'generation_allowed' is distinct from 'false'
     or v_contract->>'external_execution' is distinct from 'false' then
    raise exception 'El preflight no conserva el proveedor o los límites de ejecución.';
  end if;
  if not public._mcp_human_text_safe(v_contract->>'surface',2,120)
     or not public._mcp_human_text_safe(v_contract->>'model',2,120)
     or not public._mcp_human_text_safe(v_contract->>'workflow',0,160)
     or not public._mcp_human_text_safe(v_contract->>'objective',8,500)
     or not public._mcp_human_text_safe(v_contract->>'lens',2,120)
     or not public._mcp_human_text_safe(v_contract->>'camera_movement',3,500)
     or not public._mcp_human_text_safe(v_contract->>'lighting',3,500)
     or not public._mcp_human_text_safe(v_contract->>'target_channel',2,80)
     or not public._mcp_human_text_safe(v_contract->>'target_format',2,120)
     or not public._mcp_human_text_safe(v_contract->>'prompt',12,6000) then
    raise exception 'El modelo, objetivo, cámara, luz o prompt del preflight es inválido.';
  end if;
  if jsonb_typeof(v_contract->'duration_seconds') is distinct from 'number' or (v_contract->>'duration_seconds')::numeric not between 1 and 300
     or v_contract->>'aspect_ratio' is null or v_contract->>'aspect_ratio' not in ('9:16','16:9','1:1','4:5')
     or v_contract->>'resolution' is null or v_contract->>'resolution' not in ('720p','1080p','4K')
     or jsonb_typeof(v_contract->'audio') is distinct from 'boolean'
     or jsonb_typeof(v_contract->'outputs') is distinct from 'number' or (v_contract->>'outputs')::integer not between 1 and 4
     or jsonb_typeof(v_contract->'estimated_credits') is distinct from 'number' or (v_contract->>'estimated_credits')::numeric<=0
     or jsonb_typeof(v_contract->'max_cost_cop') is distinct from 'number' or (v_contract->>'max_cost_cop')::numeric<=0
     or jsonb_typeof(v_contract->'balance_credits') is distinct from 'number'
     or (v_contract->>'balance_credits')::numeric<(v_contract->>'estimated_credits')::numeric then
    raise exception 'Duración, formato técnico, salidas, créditos o costo inválidos.';
  end if;
  if coalesce(v_contract->>'prompt_version','')!~'^[A-Za-z0-9._:-]{1,80}$'
     or coalesce(v_contract->>'prompt_fingerprint','')!~'^[0-9a-f]{32}$'
     or v_contract->>'prompt_fingerprint' is distinct from md5(v_contract->>'prompt') then
    raise exception 'El prompt no tiene una versión y huella válidas.';
  end if;
  if jsonb_typeof(v_contract->'references') is distinct from 'array' or jsonb_array_length(v_contract->'references') not between 1 and 20
     or jsonb_typeof(v_contract->'risks') is distinct from 'array' or jsonb_array_length(v_contract->'risks')>8
     or jsonb_typeof(v_contract->'acceptance_criteria') is distinct from 'array'
     or jsonb_array_length(v_contract->'acceptance_criteria') not between 1 and 12 then
    raise exception 'Referencias, riesgos o criterios de aceptación inválidos.';
  end if;
  if exists(select 1 from jsonb_array_elements(v_contract->'risks') x where jsonb_typeof(x)<>'string')
     or exists(select 1 from jsonb_array_elements(v_contract->'acceptance_criteria') x where jsonb_typeof(x)<>'string')
     or exists(select 1 from jsonb_array_elements_text(v_contract->'risks') x where not public._mcp_human_text_safe(x,3,300))
     or exists(select 1 from jsonb_array_elements_text(v_contract->'acceptance_criteria') x where not public._mcp_human_text_safe(x,3,300)) then
    raise exception 'Un riesgo o criterio contiene texto no permitido.';
  end if;

  update public.agency_mcp_human_approvals set status='Vencida'
  where status='Pendiente' and expires_at<=now();
  select * into v_existing from public.agency_mcp_human_approvals where request_key=v_key;

  select * into v_job from public.creative_generation_jobs where id=v_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  v_contract_fp:=md5(v_contract::text);
  v_job_fp:=public._mcp_human_job_fingerprint(v_job.id);
  if v_existing.id is not null then
    if v_existing.job_id<>v_job.id or v_existing.worker_id<>v_worker or v_existing.title<>v_title
       or round((extract(epoch from (v_existing.expires_at-v_existing.requested_at))/3600)::numeric,6)<>v_ttl::numeric
       or v_existing.contract_fingerprint<>v_contract_fp or v_existing.job_fingerprint<>v_job_fp then
      raise exception 'La clave MCP ya fue usada con otro preflight.';
    end if;
    return jsonb_build_object('schema_version','momos-human-approval-status/v1','approval_id',v_existing.id,
      'job_id',v_existing.job_id,'status',v_existing.status,'contract_fingerprint',v_existing.contract_fingerprint,
      'requested_at',v_existing.requested_at,'expires_at',v_existing.expires_at,'decided_at',v_existing.decided_at,
      'decision_summary',case when v_existing.status in ('Aprobada','Rechazada') then v_existing.decision_note else '' end,
      'duplicate',true,'requires_human_approval',v_existing.status='Pendiente',
      'generation_authorized',v_existing.status='Aprobada','external_execution_allowed',false);
  end if;
  if v_job.status<>'Preparado' or v_job.provider<>'Higgsfield' then
    raise exception 'La aprobación MCP requiere un trabajo Higgsfield en estado Preparado.';
  end if;
  if v_contract->>'target_channel' is distinct from v_job.target_channel
     or v_contract->>'target_format' is distinct from v_job.target_format
     or v_contract->>'prompt' is distinct from v_job.prompt then
    raise exception 'Canal, formato o prompt no coinciden con el trabajo creativo.';
  end if;
  if jsonb_array_length(v_contract->'references')<>jsonb_array_length(v_job.input_asset_ids)
     or exists(select 1 from jsonb_array_elements(v_contract->'references') r
       group by r->>'asset_id' having count(*)>1) then
    raise exception 'Las referencias no corresponden exactamente a las fuentes del trabajo.';
  end if;
  for v_ref in select value from jsonb_array_elements(v_contract->'references') loop
    if jsonb_typeof(v_ref)<>'object'
       or exists(select 1 from jsonb_object_keys(v_ref) k where k not in ('asset_id','asset_fingerprint','role'))
       or coalesce(v_ref->>'asset_id','')!~'^[1-9][0-9]*$'
       or coalesce(v_ref->>'asset_fingerprint','')!~'^[0-9a-f]{32}$'
       or v_ref->>'role' is null
       or v_ref->>'role' not in ('Identidad','Producto','Empaque','Mano','Presentador','Locación','Movimiento','Logo','Audio','Start frame','End frame','Continuidad','Referencia') then
      raise exception 'Una referencia del preflight es inválida.';
    end if;
    v_asset_id:=(v_ref->>'asset_id')::bigint;
    if not exists(select 1 from jsonb_array_elements_text(v_job.input_asset_ids) x where x::bigint=v_asset_id) then
      raise exception 'La referencia % no pertenece al trabajo.',v_asset_id;
    end if;
    select * into v_asset from public.brand_media_assets where id=v_asset_id;
    if v_asset.id is null or v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado')
       or not v_asset.ai_use_allowed or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
       or (v_asset.contains_people and v_asset.rights_status<>'Autorizado')
       or public._mcp_brand_asset_fingerprint(v_asset_id) is distinct from v_ref->>'asset_fingerprint' then
      raise exception 'La referencia % perdió derechos, permiso o integridad.',v_asset_id;
    end if;
  end loop;

  if nullif(v_job.output_spec->>'production_pack_id','') is null then
    if nullif(v_contract->>'production_pack_id','') is not null or coalesce(v_contract->>'production_pack_fingerprint','')<>'' then
      raise exception 'El preflight declara un paquete que el trabajo no conserva.';
    end if;
  else
    if v_contract->>'production_pack_id' is distinct from v_job.output_spec->>'production_pack_id'
       or v_contract->>'production_pack_fingerprint' is distinct from v_job.output_spec->>'production_pack_fingerprint' then
      raise exception 'El paquete de producción no coincide con el trabajo.';
    end if;
    select * into v_pack from public.brand_production_packs where id=(v_contract->>'production_pack_id')::bigint;
    if v_pack.id is null or v_pack.status<>'Aprobado' or v_pack.fingerprint<>v_contract->>'production_pack_fingerprint' then
      raise exception 'El paquete de producción perdió su aprobación o integridad.';
    end if;
  end if;

  if exists(select 1 from public.agency_mcp_human_approvals where job_id=v_job.id and status='Pendiente') then
    raise exception 'Este trabajo ya tiene una solicitud humana pendiente.';
  end if;
  insert into public.agency_mcp_human_approvals(
    request_key,worker_id,job_id,title,approval_contract,contract_fingerprint,job_fingerprint,expires_at
  ) values(v_key,v_worker,v_job.id,v_title,v_contract,v_contract_fp,v_job_fp,now()+make_interval(hours=>v_ttl))
  returning id into v_id;
  perform public._add_audit('Aprobaciones MCP',v_id::text,'Preflight solicitado','Preparado',
    'Trabajo #'||v_job.id||' · Higgsfield · espera decisión humana');
  return jsonb_build_object('schema_version','momos-human-approval-status/v1','approval_id',v_id,
    'job_id',v_job.id,'status','Pendiente','contract_fingerprint',v_contract_fp,
    'requested_at',now(),'expires_at',now()+make_interval(hours=>v_ttl),'duplicate',false,
    'requires_human_approval',true,'generation_authorized',false,'external_execution_allowed',false);
end $$;

create or replace function public.momos_consultar_aprobacion_humana(
  p_approval_id bigint,p_expected_fingerprint text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_row public.agency_mcp_human_approvals%rowtype; v_current text;
begin
  if p_approval_id is null or p_approval_id<=0 or coalesce(p_expected_fingerprint,'')!~'^[0-9a-f]{32}$' then
    raise exception 'La consulta de aprobación es inválida.';
  end if;
  select * into v_row from public.agency_mcp_human_approvals where id=p_approval_id for update;
  if v_row.id is null or v_row.contract_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'La aprobación no existe o no corresponde al preflight esperado.';
  end if;
  if v_row.status='Pendiente' and v_row.expires_at<=now() then
    update public.agency_mcp_human_approvals set status='Vencida' where id=v_row.id;
    v_row.status:='Vencida';
  elsif v_row.status='Pendiente' then
    v_current:=public._mcp_human_job_fingerprint(v_row.job_id);
    if v_current is distinct from v_row.job_fingerprint then
      update public.agency_mcp_human_approvals set status='Cancelada' where id=v_row.id;
      v_row.status:='Cancelada';
    end if;
  end if;
  return jsonb_build_object(
    'schema_version','momos-human-approval-status/v1','approval_id',v_row.id,'job_id',v_row.job_id,
    'status',v_row.status,'contract_fingerprint',v_row.contract_fingerprint,
    'requested_at',v_row.requested_at,'expires_at',v_row.expires_at,'decided_at',v_row.decided_at,
    'decision_summary',case when v_row.status in ('Aprobada','Rechazada') then v_row.decision_note else '' end,
    'requires_human_approval',v_row.status='Pendiente','generation_authorized',v_row.status='Aprobada',
    'external_execution_allowed',false
  );
end $$;

-- Un trabajo con preflight MCP vigente no puede saltarse la bandeja exacta
-- usando el botón legado de autorización con tope.
create or replace function public.autorizar_trabajo_creativo(p_job_id bigint,p_max_cost_cop numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype; v_paused boolean; v_mcp_status text;
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status<>'Preparado' then raise exception 'Solo un trabajo Preparado puede autorizarse.'; end if;
  select status into v_mcp_status from public.agency_mcp_human_approvals
    where job_id=v_job.id order by requested_at desc,id desc limit 1;
  if v_mcp_status is not null and v_mcp_status<>'Aprobada' then
    raise exception 'Este trabajo pertenece al flujo MCP; resolvé o renová su preflight en la bandeja de aprobación humana.';
  end if;
  if v_job.provider not in ('Higgsfield','HeyGen','Manual') then raise exception 'Elegí un motor real antes de autorizar.'; end if;
  if p_max_cost_cop is null or p_max_cost_cop<0 or (v_job.provider<>'Manual' and p_max_cost_cop<=0) then
    raise exception 'Definí un tope de costo válido en COP.';
  end if;
  select paused into v_paused from public.agency_settings where id;
  if coalesce(v_paused,false) then raise exception 'La parada de emergencia de Agencia MOMOS está activa.'; end if;
  if v_job.brief_id is not null and not exists(
    select 1 from public.agency_briefs where id=v_job.brief_id and status in ('Aprobado','En producción','Completado')
  ) then raise exception 'El brief necesita aprobación humana antes de generar.'; end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  update public.creative_generation_jobs set status='Autorizado',max_cost_cop=p_max_cost_cop,
    authorized_by=v_actor.id,authorized_at=now(),error_message='',updated_at=now() where id=v_job.id;
  perform public._add_audit('Estudio creativo',v_job.id::text,'Trabajo autorizado','Preparado',
    v_job.provider||' · tope COP '||p_max_cost_cop::text);
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','Autorizado','max_cost_cop',p_max_cost_cop);
end $$;

create or replace function public.resolver_aprobacion_humana_mcp(
  p_approval_id bigint,p_decision text,p_note text,p_expected_fingerprint text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_row public.agency_mcp_human_approvals%rowtype;
  v_job public.creative_generation_jobs%rowtype; v_note text:=btrim(coalesce(p_note,''));
  v_status text; v_authorization jsonb;
begin
  v_actor:=public._brand_actor();
  if not public.has_current_role('Administrador') then
    raise exception 'Solo Administración puede resolver aprobaciones de generación MCP.';
  end if;
  if p_decision is null or p_decision not in ('Aprobar','Rechazar') or not public._mcp_human_text_safe(v_note,3,500)
     or coalesce(p_expected_fingerprint,'')!~'^[0-9a-f]{32}$' then
    raise exception 'La decisión, nota o huella de aprobación es inválida.';
  end if;
  select * into v_row from public.agency_mcp_human_approvals where id=p_approval_id for update;
  if v_row.id is null or v_row.contract_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'La aprobación no existe o el preflight cambió.';
  end if;
  if v_row.status<>'Pendiente' or v_row.expires_at<=now() then
    raise exception 'La solicitud ya no está pendiente o venció.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_row.job_id for update;
  if v_job.id is null or v_job.status<>'Preparado'
     or public._mcp_human_job_fingerprint(v_job.id)<>v_row.job_fingerprint then
    raise exception 'El trabajo creativo cambió; solicitá una aprobación nueva.';
  end if;
  if p_decision='Aprobar' then
    v_status:='Aprobada';
  else
    v_status:='Rechazada';
  end if;
  update public.agency_mcp_human_approvals set status=v_status,decided_by=v_actor.id,
    decided_at=now(),decision_note=v_note where id=v_row.id;
  if p_decision='Aprobar' then
    v_authorization:=public.autorizar_trabajo_creativo(v_job.id,(v_row.approval_contract->>'max_cost_cop')::numeric);
  end if;
  perform public._add_audit('Aprobaciones MCP',v_row.id::text,'Preflight '||lower(v_status),'Pendiente',
    'Trabajo #'||v_job.id||' · decisión humana · '||v_note);
  return jsonb_build_object('ok',true,'approval_id',v_row.id,'job_id',v_job.id,'status',v_status,
    'job_status',case when v_status='Aprobada' then 'Autorizado' else v_job.status end,
    'generation_authorized',v_status='Aprobada','external_execution',false,'authorization',v_authorization);
end $$;

-- Extiende la bitácora oficial sin permitir que la herramienta de solicitud se
-- presente como una lectura ni que ninguna tool suplante la decisión humana.
create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'Registro MCP inválido o con secretos.';
  end if;
  if v_key!~'^[A-Za-z0-9:_-]{3,180}$' or v_tool not in (
      'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context',
      'momos_submit_proposals','momos_search_brand_assets','momos_get_brand_asset_reference',
      'momos_request_human_approval','momos_get_human_approval'
    ) or v_mode not in ('Lectura','Propuesta','Referencia','Solicitud') or v_status not in ('OK','Denegado','Fallido')
    or length(v_worker) not between 2 and 120 or v_input!~'^[0-9a-f]{32}$'
    or (v_output<>'' and v_output!~'^[0-9a-f]{32}$') or jsonb_typeof(v_details)<>'object' then
    raise exception 'Contrato de bitácora MCP inválido.';
  end if;
  if (v_tool='momos_submit_proposals' and v_mode<>'Propuesta')
     or (v_tool='momos_get_brand_asset_reference' and v_mode<>'Referencia')
     or (v_tool='momos_request_human_approval' and v_mode<>'Solicitud')
     or (v_tool not in ('momos_submit_proposals','momos_get_brand_asset_reference','momos_request_human_approval') and v_mode<>'Lectura') then
    raise exception 'El modo no coincide con la herramienta MCP.';
  end if;
  insert into public.agency_mcp_access_log(request_key,tool_name,mode,status,worker_id,subject_ref,input_fingerprint,output_fingerprint,details)
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,v_output,v_details)
  on conflict(request_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
    if v_existing.tool_name<>v_tool or v_existing.mode<>v_mode or v_existing.status<>v_status
       or v_existing.worker_id<>v_worker or v_existing.subject_ref<>v_subject
       or v_existing.input_fingerprint<>v_input or v_existing.output_fingerprint<>v_output
       or v_existing.details<>v_details then
      raise exception 'La clave MCP ya fue usada con otro contrato.';
    end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

-- El manifiesto evita una sonda adicional en el navegador.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_capabilities jsonb; v_schema_version text;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb) into v_capabilities
  from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible','orquestador_agencia_disponible',
    'centro_acciones_agencia_disponible','resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible','postproduccion_exportacion_disponible',
    'postproduccion_audio_disponible','retencion_guiones_disponible','retencion_loops_disponible','observatorio_meta_disponible',
    'incrementalidad_meta_disponible','escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible','meta_conector_dry_run_disponible',
    'distribucion_comercial_disponible','distribucion_conectores_disponible','biblioteca_creativa_disponible','produccion_creativa_disponible',
    'revision_creativa_disponible','versiones_creativas_disponibles','integraciones_agencia_disponibles','higgsfield_conector_disponible',
    'kling_conector_disponible','gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible','mundo_animado_disponible',
    'eliminacion_logo_oficial_disponible','biblioteca_produccion_disponible','mcp_aprobaciones_humanas_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  return jsonb_build_object('version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)),
    'contains_pii',false,'contains_secrets',false,'external_execution',false);
end $$;

revoke all on function public.mcp_aprobaciones_humanas_disponible() from public,anon;
revoke all on function public.mcp_aprobacion_humana_contrato() from public,anon,authenticated;
revoke all on function public._mcp_human_text_safe(text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public._mcp_human_job_fingerprint(bigint) from public,anon,authenticated,service_role;
revoke all on function public.momos_solicitar_aprobacion_humana(jsonb) from public,anon,authenticated;
revoke all on function public.momos_consultar_aprobacion_humana(bigint,text) from public,anon,authenticated;
revoke all on function public.resolver_aprobacion_humana_mcp(bigint,text,text,text) from public,anon,service_role;
revoke all on function public.registrar_acceso_mcp_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.mcp_aprobaciones_humanas_disponible() to authenticated,service_role;
grant execute on function public.mcp_aprobacion_humana_contrato() to service_role;
grant execute on function public.momos_solicitar_aprobacion_humana(jsonb) to service_role;
grant execute on function public.momos_consultar_aprobacion_humana(bigint,text) to service_role;
grant execute on function public.resolver_aprobacion_humana_mcp(bigint,text,text,text) to authenticated;
grant execute on function public.registrar_acceso_mcp_agencia(jsonb) to service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_mcp_human_approvals') then
    alter publication supabase_realtime add table public.agency_mcp_human_approvals;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_62_mcp_aprobacion_humana',
  'Tools MCP para solicitar y consultar preflights Higgsfield; resolución exclusiva de Administración en MOMO OPS con huellas exactas')
on conflict(id) do update set detalle=excluded.detalle;

commit;
