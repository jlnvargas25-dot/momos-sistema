-- MOMOS OPS · Gateway MCP semántico de Agencia v1.
-- Paso 42. Expone contexto agregado sin PII ni secretos y permite únicamente
-- registrar propuestas selladas para revisión humana. No ofrece SQL libre,
-- ejecución externa, pagos, contacto, publicación o cambios de presupuesto.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_41_meta_conector_dry_run'
  ) then raise exception 'Falta el paso 41_meta_conector_dry_run.'; end if;
end $$;

create table if not exists public.agency_mcp_access_log(
  id bigint generated always as identity primary key,
  request_key text not null unique check(request_key ~ '^[A-Za-z0-9:_-]{3,180}$'),
  tool_name text not null check(tool_name in
    ('momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context','momos_submit_proposals')),
  mode text not null check(mode in ('Lectura','Propuesta')),
  status text not null check(status in ('OK','Denegado','Fallido')),
  worker_id text not null check(length(btrim(worker_id)) between 2 and 120),
  subject_ref text not null default '' check(length(subject_ref)<=180),
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{32}$'),
  output_fingerprint text not null default '' check(output_fingerprint='' or output_fingerprint ~ '^[0-9a-f]{32}$'),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),
  constraint agency_mcp_log_no_secret check(details::text !~*
    '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)"[[:space:]]*:')
);
create index if not exists agency_mcp_access_log_created_idx on public.agency_mcp_access_log(created_at desc,id desc);

alter table public.agency_mcp_access_log enable row level security;
drop policy if exists admin_read on public.agency_mcp_access_log;
create policy admin_read on public.agency_mcp_access_log for select to authenticated using(public.has_current_role('Administrador'));
revoke all on public.agency_mcp_access_log from public,anon,authenticated;
grant select on public.agency_mcp_access_log to authenticated;

create or replace function public.mcp_agency_gateway_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_mcp_json_safe(p jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select p is not null and p::text !~*
    '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)"[[:space:]]*:'
$$;

create or replace function public._agency_mcp_log_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  raise exception 'La bitácora MCP es inmutable.';
end $$;
drop trigger if exists agency_mcp_log_guard on public.agency_mcp_access_log;
create trigger agency_mcp_log_guard before update or delete on public.agency_mcp_access_log
for each row execute function public._agency_mcp_log_guard();

create or replace function public.obtener_contexto_director_agencia() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_snapshot jsonb; v_integrations jsonb; v_signals jsonb:='[]'::jsonb;
  v_active_orders integer; v_waiting_payment integer; v_kitchen integer; v_packing integer; v_logistics integer;
  v_paid_30d integer; v_revenue_30d numeric; v_batches integer; v_ready_units numeric; v_expiring integer;
  v_suggestions integer; v_contactable integer; v_inactive integer; v_briefs integer; v_proposals integer;
  v_jobs integer; v_paused boolean; v_meta_status text;
begin
  select count(*) into v_active_orders from public.orders where estado not in ('Entregado','Cancelado');
  select count(*) into v_waiting_payment from public.orders where estado in ('Nuevo','Confirmado','Pendiente de pago');
  select count(*) into v_kitchen from public.orders where estado in ('Pagado','En producción');
  select count(*) into v_packing from public.orders where estado in ('Listo para empaque','Empacado');
  select count(*) into v_logistics from public.orders where estado in ('Listo para despacho','En ruta');
  select count(*) into v_paid_30d from public.orders where pagado_en>=now()-interval '30 days' and estado<>'Cancelado';
  select coalesce(sum(
    coalesce((select sum(oi.precio*oi.cant) from public.order_items oi where oi.order_id=o.id and not oi.es_sub_momo),0)
    +o.dom_cobrado-o.descuento
  ),0) into v_revenue_30d from public.orders o where o.pagado_en>=now()-interval '30 days' and o.estado<>'Cancelado';

  select count(*) into v_batches from public.production_batches where estado in ('En preparación','Congelando');
  select coalesce(sum(greatest(perfectas,0)),0) into v_ready_units from public.production_batches where estado='Listo' and (vence is null or vence>=current_date);
  select count(*) into v_expiring from public.production_batches where estado='Listo' and vence between current_date and current_date+2;
  select count(*) into v_suggestions from public.production_suggestions where estado='Pendiente';
  select count(*) into v_contactable from public.customer_crm_profiles where contact_allowed and preferred_channel<>'No contactar';
  select count(*) into v_inactive from public.customers c join public.customer_crm_profiles p on p.customer_id=c.id
    where p.contact_allowed and p.preferred_channel<>'No contactar' and c.ultima<current_date-30;
  select count(*) into v_briefs from public.agency_briefs where status in ('Borrador','En revisión','Aprobado','En producción');
  select count(*) into v_proposals from public.agency_agent_proposals where status='Propuesta';
  select count(*) into v_jobs from public.creative_generation_jobs where status in ('Borrador','Preparado','En generación');
  select coalesce(paused,false) into v_paused from public.agency_settings where id;
  select status into v_meta_status from public.agency_meta_connector_dry_runs order by id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',provider,'kind',kind,'status',status,'environment',environment,
    'secret_configured',secret_configured,'last_heartbeat_at',last_heartbeat_at,
    'last_sync_at',last_sync_at,'capabilities',capabilities
  ) order by provider),'[]'::jsonb) into v_integrations from public.agency_integrations;

  if v_kitchen>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',100,'area','Operación','signal','Pedidos requieren Cocina','count',v_kitchen,'external_action',false)); end if;
  if v_packing>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',95,'area','Operación','signal','Pedidos requieren Empaque','count',v_packing,'external_action',false)); end if;
  if v_suggestions>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',90,'area','Producción','signal','Sugerencias pendientes','count',v_suggestions,'external_action',false)); end if;
  if v_expiring>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',85,'area','Inventario terminado','signal','Lotes vencen en 48 horas','count',v_expiring,'external_action',false)); end if;
  if v_waiting_payment>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',80,'area','Ventas','signal','Pedidos esperan cierre comercial','count',v_waiting_payment,'external_action',false)); end if;
  if v_proposals>0 then v_signals:=v_signals||jsonb_build_array(jsonb_build_object('priority',70,'area','Agencia','signal','Propuestas esperan decisión humana','count',v_proposals,'external_action',false)); end if;

  v_snapshot:=jsonb_build_object(
    'schema_version','momos-agency-context/v1','generated_at',now(),'timezone','America/Bogota',
    'scope','Agregado comercial y operativo sin PII','external_execution_allowed',false,
    'policies',jsonb_build_object('human_approval_required',true,'sql_tool_available',false,'secrets_in_context',false,
      'payments_allowed',false,'publishing_allowed',false,'budget_changes_allowed',false,'customer_contact_allowed',false),
    'orders',jsonb_build_object('active',v_active_orders,'waiting_commercial_close',v_waiting_payment,'kitchen',v_kitchen,
      'packing',v_packing,'logistics',v_logistics,'paid_last_30_days',v_paid_30d,'revenue_last_30_days_cop',v_revenue_30d),
    'operations',jsonb_build_object('active_production_batches',v_batches,'ready_units_reported',v_ready_units,
      'lots_expiring_48h',v_expiring,'pending_production_suggestions',v_suggestions),
    'crm',jsonb_build_object('contactable_with_consent',v_contactable,'inactive_contactable_30d',v_inactive,'contains_pii',false),
    'agency',jsonb_build_object('paused',v_paused,'open_briefs',v_briefs,'pending_human_proposals',v_proposals,
      'creative_jobs_in_progress',v_jobs,'latest_meta_dry_run_status',coalesce(v_meta_status,''),'integrations',v_integrations),
    'priority_signals',v_signals
  );
  return jsonb_build_object('snapshot',v_snapshot,'fingerprint',md5(v_snapshot::text));
end $$;

create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then raise exception 'Registro MCP inválido o con secretos.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or v_tool not in
    ('momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context','momos_submit_proposals')
    or v_mode not in ('Lectura','Propuesta') or v_status not in ('OK','Denegado','Fallido')
    or length(v_worker) not between 2 and 120 or v_input !~ '^[0-9a-f]{32}$'
    or (v_output<>'' and v_output !~ '^[0-9a-f]{32}$') or jsonb_typeof(v_details)<>'object' then
    raise exception 'Contrato de bitácora MCP inválido.';
  end if;
  if (v_tool='momos_submit_proposals')<>(v_mode='Propuesta') then raise exception 'El modo no coincide con la herramienta MCP.'; end if;
  insert into public.agency_mcp_access_log(request_key,tool_name,mode,status,worker_id,subject_ref,input_fingerprint,output_fingerprint,details)
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,v_output,v_details)
  on conflict(request_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
    if v_existing.tool_name<>v_tool or v_existing.mode<>v_mode or v_existing.input_fingerprint<>v_input then
      raise exception 'La clave MCP ya fue usada con otro contrato.';
    end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

revoke all on function public.mcp_agency_gateway_disponible() from public,anon;
revoke all on function public._agency_mcp_json_safe(jsonb) from public,anon,authenticated;
revoke all on function public._agency_mcp_log_guard() from public,anon,authenticated;
revoke all on function public.obtener_contexto_director_agencia() from public,anon,authenticated;
revoke all on function public.registrar_acceso_mcp_agencia(jsonb) from public,anon,authenticated;
grant execute on function public.mcp_agency_gateway_disponible() to authenticated,service_role;
grant execute on function public.obtener_contexto_director_agencia() to service_role;
grant execute on function public.registrar_acceso_mcp_agencia(jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_42_mcp_agency_gateway','Gateway MCP semántico sin PII, SQL libre, secretos o ejecución externa; propuestas con aprobación humana y bitácora inmutable')
on conflict(id) do update set detalle=excluded.detalle;

commit;

