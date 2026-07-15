-- MOMOS OPS · Agencia Comercial v1: briefs, decisiones, versiones y autonomía protegida.
-- Paso 16, después de CRM clientes v2. No publica ni pauta sin integración externa.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260714_15_crm_clientes'
  ) then raise exception 'Falta el paso 15_crm_clientes.'; end if;
end $$;

create table if not exists public.agency_settings(
  id boolean primary key default true check(id),
  autonomy_mode text not null default 'Copiloto' check(autonomy_mode in ('Asesor','Copiloto','Autopiloto protegido')),
  daily_budget_limit numeric not null default 100000 check(daily_budget_limit>=0),
  campaign_budget_limit numeric not null default 500000 check(campaign_budget_limit>=0),
  scale_step_pct numeric not null default 15 check(scale_step_pct between 0 and 30),
  require_creative_approval boolean not null default true,
  block_out_of_stock boolean not null default true,
  contact_only_authorized boolean not null default true,
  paused boolean not null default false,
  updated_by text references public.users(id), updated_at timestamptz not null default now()
);
insert into public.agency_settings(id) values(true) on conflict(id) do nothing;

create table if not exists public.agency_briefs(
  id bigint generated always as identity primary key, decision_key text unique,
  title text not null check(length(btrim(title))>=3),
  objective text not null check(objective in ('Ventas','Recompra','Lanzamiento','Cumpleaños','Tráfico WhatsApp','Branding','Contenido','Otro')),
  campaign_id text references public.campaigns(id), product_id text references public.products(id),
  crm_segment text not null default '', offer text not null default '',
  channel text not null default 'Instagram' check(channel in ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico','Multicanal')),
  deliverables jsonb not null default '[]'::jsonb check(jsonb_typeof(deliverables)='array'),
  insight text not null default '', evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
  status text not null default 'Borrador' check(status in ('Borrador','En revisión','Aprobado','En producción','Completado','Descartado')),
  proposed_budget numeric not null default 0 check(proposed_budget>=0), approved_budget numeric check(approved_budget is null or approved_budget>=0),
  stock_snapshot numeric, created_by text not null references public.users(id), approved_by text references public.users(id),
  created_at timestamptz not null default now(), approved_at timestamptz, updated_at timestamptz not null default now(), notes text not null default ''
);
create index if not exists agency_briefs_status_idx on public.agency_briefs(status,created_at desc);

create table if not exists public.agency_decisions(
  id bigint generated always as identity primary key,
  brief_id bigint references public.agency_briefs(id) on delete set null,
  campaign_id text references public.campaigns(id), creative_id text references public.creatives(id),
  type text not null check(type in ('Crear contenido','Contactar segmento','Activar campaña','Pausar campaña','Escalar presupuesto','Reponer stock','Revisar creativo','Revisar oferta','Otro')),
  title text not null check(length(btrim(title))>=3), rationale text not null check(length(btrim(rationale))>=3),
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
  proposed_action jsonb not null default '{}'::jsonb check(jsonb_typeof(proposed_action)='object'),
  risk_level text not null default 'Bajo' check(risk_level in ('Bajo','Medio','Alto')),
  status text not null default 'Propuesta' check(status in ('Propuesta','Aprobada','Ejecutada','Descartada','Fallida')),
  author text not null default 'reglas' check(author in ('reglas','humano','ia')),
  created_by text not null references public.users(id), approved_by text references public.users(id), executed_by text references public.users(id),
  created_at timestamptz not null default now(), approved_at timestamptz, executed_at timestamptz, result text not null default ''
);
create index if not exists agency_decisions_status_idx on public.agency_decisions(status,risk_level,created_at desc);

create table if not exists public.agency_creative_versions(
  id bigint generated always as identity primary key,
  creative_id text not null references public.creatives(id) on delete cascade,
  brief_id bigint references public.agency_briefs(id) on delete set null,
  version integer not null check(version>0), provider text not null default 'manual',
  prompt text not null default '', negative_prompt text not null default '',
  brand_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(brand_snapshot)='object'),
  asset_url text not null default '', thumbnail_url text not null default '',
  status text not null default 'Borrador' check(status in ('Borrador','En revisión','Aprobada','Rechazada')),
  feedback text not null default '', generation_cost numeric not null default 0 check(generation_cost>=0),
  created_by text not null references public.users(id), reviewed_by text references public.users(id),
  created_at timestamptz not null default now(), reviewed_at timestamptz, unique(creative_id,version)
);

alter table public.agency_settings enable row level security;
alter table public.agency_briefs enable row level security;
alter table public.agency_decisions enable row level security;
alter table public.agency_creative_versions enable row level security;
drop policy if exists staff_read on public.agency_settings;
drop policy if exists staff_read on public.agency_briefs;
drop policy if exists staff_read on public.agency_decisions;
drop policy if exists staff_read on public.agency_creative_versions;
create policy staff_read on public.agency_settings for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_briefs for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_decisions for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_creative_versions for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_settings,public.agency_briefs,public.agency_decisions,public.agency_creative_versions from anon,authenticated;
grant select on public.agency_settings,public.agency_briefs,public.agency_decisions,public.agency_creative_versions to authenticated;
revoke insert,update,delete on public.marketing_ideas,public.marketing_tasks from anon,authenticated;
grant select on public.marketing_ideas,public.marketing_tasks to authenticated;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['campaigns','creatives','content_posts','metrics_daily','marketing_ideas','marketing_tasks','agency_settings','agency_briefs','agency_decisions','agency_creative_versions'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.agencia_comercial_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or v_actor.rol not in ('Administrador','Marketing/CRM') then raise exception 'Tu rol no puede operar Agencia MOMOS.'; end if;
  return v_actor;
end $$;

create or replace function public.guardar_configuracion_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_mode text; v_daily numeric; v_campaign numeric; v_scale numeric;
begin
  v_actor:=public._agency_actor();
  if v_actor.rol<>'Administrador' then raise exception 'Solo Administración puede cambiar los límites de Agencia MOMOS.'; end if;
  v_mode:=coalesce(nullif(p->>'autonomy_mode',''),'Copiloto'); v_daily:=coalesce((p->>'daily_budget_limit')::numeric,100000);
  v_campaign:=coalesce((p->>'campaign_budget_limit')::numeric,500000); v_scale:=coalesce((p->>'scale_step_pct')::numeric,15);
  if v_mode not in ('Asesor','Copiloto','Autopiloto protegido') or v_daily<0 or v_campaign<0 or v_scale<0 or v_scale>30 then raise exception 'Configuración comercial inválida.'; end if;
  update public.agency_settings set autonomy_mode=v_mode,daily_budget_limit=v_daily,campaign_budget_limit=v_campaign,scale_step_pct=v_scale,
    require_creative_approval=coalesce((p->>'require_creative_approval')::boolean,true),block_out_of_stock=coalesce((p->>'block_out_of_stock')::boolean,true),
    contact_only_authorized=coalesce((p->>'contact_only_authorized')::boolean,true),paused=coalesce((p->>'paused')::boolean,false),updated_by=v_actor.id,updated_at=now() where id;
  perform public._add_audit('Agencia','configuración','Configuración comercial actualizada','',v_mode);
  return jsonb_build_object('ok',true,'autonomy_mode',v_mode);
end $$;

create or replace function public.crear_brief_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id bigint; v_product text:=nullif(p->>'product_id',''); v_campaign text:=nullif(p->>'campaign_id','');
  v_budget numeric:=coalesce((p->>'proposed_budget')::numeric,0); v_limit numeric; v_stock numeric; v_key text:=nullif(p->>'decision_key','');
begin
  v_actor:=public._agency_actor(); select campaign_budget_limit into v_limit from public.agency_settings where id;
  if v_budget<0 or v_budget>v_limit then raise exception 'El presupuesto propuesto supera el límite protegido por campaña.'; end if;
  if v_product is not null and not exists(select 1 from public.products where id=v_product and activo) then raise exception 'El producto foco no existe o está inactivo.'; end if;
  if v_campaign is not null and not exists(select 1 from public.campaigns where id=v_campaign) then raise exception 'La campaña no existe.'; end if;
  select stock into v_stock from public.products where id=v_product;
  insert into public.agency_briefs(decision_key,title,objective,campaign_id,product_id,crm_segment,offer,channel,deliverables,insight,evidence,proposed_budget,stock_snapshot,created_by,notes)
  values(v_key,btrim(coalesce(p->>'title','')),coalesce(nullif(p->>'objective',''),'Otro'),v_campaign,v_product,coalesce(p->>'crm_segment',''),coalesce(p->>'offer',''),
    coalesce(nullif(p->>'channel',''),'Instagram'),coalesce(p->'deliverables','[]'::jsonb),coalesce(p->>'insight',''),coalesce(p->'evidence','{}'::jsonb),v_budget,v_stock,v_actor.id,coalesce(p->>'notes',''))
  on conflict(decision_key) do update set updated_at=public.agency_briefs.updated_at returning id into v_id;
  perform public._add_audit('Brief agencia',v_id::text,'Brief comercial creado','',coalesce(p->>'title',''));
  return jsonb_build_object('ok',true,'brief_id',v_id);
end $$;

create or replace function public.set_estado_brief_agencia(p_brief_id bigint,p_status text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_brief public.agency_briefs%rowtype; v_valid boolean; v_limit numeric;
begin
  v_actor:=public._agency_actor(); select * into v_brief from public.agency_briefs where id=p_brief_id for update;
  if v_brief.id is null then raise exception 'El brief no existe.'; end if;
  v_valid:=(v_brief.status='Borrador' and p_status in ('En revisión','Descartado'))
    or (v_brief.status='En revisión' and p_status in ('Aprobado','Borrador','Descartado'))
    or (v_brief.status='Aprobado' and p_status in ('En producción','Descartado'))
    or (v_brief.status='En producción' and p_status in ('Completado','Descartado'));
  if not v_valid then raise exception 'Transición de brief inválida: % a %.',v_brief.status,p_status; end if;
  if p_status='Aprobado' then
    select campaign_budget_limit into v_limit from public.agency_settings where id;
    if v_brief.proposed_budget>v_limit then raise exception 'El presupuesto ya no cabe en el límite protegido.'; end if;
  end if;
  update public.agency_briefs set status=p_status,
    notes=case when btrim(p_note)='' then notes else concat_ws(E'\n',nullif(notes,''),p_note) end,
    approved_by=case when p_status='Aprobado' then v_actor.id else approved_by end,
    approved_at=case when p_status='Aprobado' then now() else approved_at end,
    approved_budget=case when p_status='Aprobado' then proposed_budget else approved_budget end,updated_at=now()
  where id=p_brief_id;
  perform public._add_audit('Brief agencia',p_brief_id::text,'Estado de brief',v_brief.status,p_status);
  return jsonb_build_object('ok',true,'brief_id',p_brief_id,'status',p_status);
end $$;

create or replace function public.crear_decision_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id bigint; v_brief bigint:=nullif(p->>'brief_id','')::bigint;
begin
  v_actor:=public._agency_actor();
  if v_brief is not null and not exists(select 1 from public.agency_briefs where id=v_brief) then raise exception 'El brief no existe.'; end if;
  insert into public.agency_decisions(brief_id,campaign_id,creative_id,type,title,rationale,evidence,proposed_action,risk_level,author,created_by)
  values(v_brief,nullif(p->>'campaign_id',''),nullif(p->>'creative_id',''),p->>'type',btrim(coalesce(p->>'title','')),btrim(coalesce(p->>'rationale','')),
    coalesce(p->'evidence','{}'::jsonb),coalesce(p->'proposed_action','{}'::jsonb),coalesce(nullif(p->>'risk_level',''),'Bajo'),coalesce(nullif(p->>'author',''),'reglas'),v_actor.id)
  returning id into v_id;
  perform public._add_audit('Decisión agencia',v_id::text,'Decisión propuesta','',coalesce(p->>'type',''));
  return jsonb_build_object('ok',true,'decision_id',v_id);
end $$;

create or replace function public.resolver_decision_agencia(p_decision_id bigint,p_status text,p_result text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_decision public.agency_decisions%rowtype; v_settings public.agency_settings%rowtype;
  v_product text; v_creative text; v_budget numeric; v_daily numeric; v_customer text; v_allowed boolean;
begin
  v_actor:=public._agency_actor(); select * into v_decision from public.agency_decisions where id=p_decision_id for update;
  select * into v_settings from public.agency_settings where id;
  if v_decision.id is null then raise exception 'La decisión no existe.'; end if;
  if not ((v_decision.status='Propuesta' and p_status in ('Aprobada','Descartada')) or
          (v_decision.status='Aprobada' and p_status in ('Ejecutada','Fallida','Descartada'))) then
    raise exception 'Transición de decisión inválida: % a %.',v_decision.status,p_status;
  end if;
  if p_status='Ejecutada' then
    if v_settings.paused then raise exception 'La parada de emergencia de Agencia MOMOS está activa.'; end if;
    if v_settings.autonomy_mode='Asesor' then raise exception 'El modo Asesor solo permite proponer acciones.'; end if;
    if length(btrim(p_result))<3 then raise exception 'Registrá el resultado real de la ejecución.'; end if;
    v_product:=coalesce(nullif(v_decision.proposed_action->>'product_id',''),(select producto_foco_id from public.campaigns where id=v_decision.campaign_id));
    v_creative:=coalesce(nullif(v_decision.proposed_action->>'creative_id',''),v_decision.creative_id);
    v_budget:=coalesce((v_decision.proposed_action->>'proposed_budget')::numeric,0);
    v_daily:=coalesce((v_decision.proposed_action->>'daily_spend')::numeric,0)+coalesce((v_decision.proposed_action->>'incremental_daily_spend')::numeric,0);
    if v_budget>v_settings.campaign_budget_limit then raise exception 'La acción supera el límite protegido por campaña.'; end if;
    if v_daily>v_settings.daily_budget_limit then raise exception 'La acción supera el límite diario protegido.'; end if;
    if v_settings.block_out_of_stock and v_product is not null and v_decision.type<>'Reponer stock'
       and coalesce((select stock from public.products where id=v_product),0)<=0 then raise exception 'El producto foco no tiene stock.'; end if;
    if v_settings.require_creative_approval and v_decision.type='Activar campaña'
       and (v_creative is null or not exists(select 1 from public.creatives where id=v_creative and estado in ('Aprobado','Publicado','Ganador'))) then
      raise exception 'La campaña necesita un creativo con aprobación humana.';
    end if;
    if v_settings.contact_only_authorized and jsonb_typeof(v_decision.proposed_action->'customer_ids')='array' then
      for v_customer in select jsonb_array_elements_text(v_decision.proposed_action->'customer_ids') loop
        select contact_allowed into v_allowed from public.customer_crm_profiles where customer_id=v_customer;
        if v_allowed is distinct from true then raise exception 'La acción incluye un cliente sin autorización explícita de contacto.'; end if;
      end loop;
    end if;
  end if;
  update public.agency_decisions set status=p_status,result=coalesce(p_result,''),
    approved_by=case when p_status='Aprobada' then v_actor.id else approved_by end,approved_at=case when p_status='Aprobada' then now() else approved_at end,
    executed_by=case when p_status in ('Ejecutada','Fallida') then v_actor.id else executed_by end,executed_at=case when p_status in ('Ejecutada','Fallida') then now() else executed_at end
  where id=p_decision_id;
  perform public._add_audit('Decisión agencia',p_decision_id::text,'Estado de decisión',v_decision.status,p_status);
  return jsonb_build_object('ok',true,'decision_id',p_decision_id,'status',p_status);
end $$;

create or replace function public.crear_version_creativa_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_creative text:=nullif(p->>'creative_id',''); v_version integer; v_id bigint; v_brand jsonb;
begin
  v_actor:=public._agency_actor();
  if not exists(select 1 from public.creatives where id=v_creative) then raise exception 'El creativo no existe.'; end if;
  perform pg_advisory_xact_lock(hashtext('agency_creative_version:'||v_creative));
  select coalesce(max(version),0)+1 into v_version from public.agency_creative_versions where creative_id=v_creative;
  select jsonb_build_object('frases',frases,'tono',tono,'palabras_si',palabras_si,'palabras_no',palabras_no) into v_brand from public.brand_library where id;
  insert into public.agency_creative_versions(creative_id,brief_id,version,provider,prompt,negative_prompt,brand_snapshot,asset_url,thumbnail_url,status,generation_cost,created_by)
  values(v_creative,nullif(p->>'brief_id','')::bigint,v_version,coalesce(nullif(p->>'provider',''),'manual'),coalesce(p->>'prompt',''),coalesce(p->>'negative_prompt',''),
    coalesce(p->'brand_snapshot',v_brand,'{}'::jsonb),coalesce(p->>'asset_url',''),coalesce(p->>'thumbnail_url',''),'Borrador',coalesce((p->>'generation_cost')::numeric,0),v_actor.id)
  returning id into v_id;
  perform public._add_audit('Creativo',v_creative,'Versión creativa creada','',v_version::text);
  return jsonb_build_object('ok',true,'version_id',v_id,'version',v_version);
end $$;

create or replace function public.revisar_version_creativa_agencia(p_version_id bigint,p_status text,p_feedback text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_version public.agency_creative_versions%rowtype;
begin
  v_actor:=public._agency_actor(); select * into v_version from public.agency_creative_versions where id=p_version_id for update;
  if v_version.id is null then raise exception 'La versión creativa no existe.'; end if;
  if p_status not in ('En revisión','Aprobada','Rechazada') then raise exception 'Estado de revisión inválido.'; end if;
  if p_status='Aprobada' and btrim(v_version.asset_url)='' then raise exception 'No se puede aprobar una versión sin archivo.'; end if;
  update public.agency_creative_versions set status=p_status,feedback=coalesce(p_feedback,''),reviewed_by=v_actor.id,reviewed_at=now() where id=p_version_id;
  if p_status='Aprobada' then update public.creatives set asset_url=v_version.asset_url,estado='Aprobado' where id=v_version.creative_id; end if;
  perform public._add_audit('Creativo',v_version.creative_id,'Versión creativa revisada',v_version.status,p_status);
  return jsonb_build_object('ok',true,'version_id',p_version_id,'status',p_status);
end $$;

create or replace function public.set_idea_marketing_estado(p_id text,p_estado text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_old text;
begin
  v_actor:=public._agency_actor();
  if p_estado not in ('Nueva','Usada','Repetir','Ganadora','Descartada') then raise exception 'Estado de idea inválido.'; end if;
  select estado into v_old from public.marketing_ideas where id=p_id for update;
  if v_old is null then raise exception 'La idea no existe.'; end if;
  update public.marketing_ideas set estado=p_estado where id=p_id;
  perform public._add_audit('Idea',p_id,'Cambio de estado',v_old,p_estado);
  return jsonb_build_object('ok',true,'id',p_id,'estado',p_estado);
end $$;

create or replace function public.crear_tarea_marketing(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id text;
begin
  v_actor:=public._agency_actor(); v_id:=coalesce(nullif(p->>'id',''),'TAR-'||upper(substr(md5(gen_random_uuid()::text),1,8)));
  insert into public.marketing_tasks(id,tarea,fecha,estado,responsable,origen,recommendation_id)
  values(v_id,btrim(coalesce(p->>'tarea','')),coalesce(nullif(p->>'fecha','')::date,current_date),'Pendiente',coalesce(nullif(p->>'responsable',''),v_actor.nombre),'humano',nullif(p->>'recommendation_id','')::bigint);
  perform public._add_audit('Tarea marketing',v_id,'Tarea creada','',coalesce(p->>'tarea',''));
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.set_tarea_marketing_estado(p_id text,p_estado text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_old text;
begin
  v_actor:=public._agency_actor();
  if p_estado not in ('Pendiente','Hecha','Saltada') then raise exception 'Estado de tarea inválido.'; end if;
  select estado into v_old from public.marketing_tasks where id=p_id for update;
  if v_old is null then raise exception 'La tarea no existe.'; end if;
  update public.marketing_tasks set estado=p_estado where id=p_id;
  perform public._add_audit('Tarea marketing',p_id,'Cambio de estado',v_old,p_estado);
  return jsonb_build_object('ok',true,'id',p_id,'estado',p_estado);
end $$;

revoke all on function public._agency_actor() from public,anon,authenticated;
revoke all on function public.agencia_comercial_disponible() from public,anon,authenticated;
revoke all on function public.guardar_configuracion_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.crear_brief_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.set_estado_brief_agencia(bigint,text,text) from public,anon,authenticated;
revoke all on function public.crear_decision_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.resolver_decision_agencia(bigint,text,text) from public,anon,authenticated;
revoke all on function public.crear_version_creativa_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.revisar_version_creativa_agencia(bigint,text,text) from public,anon,authenticated;
revoke all on function public.set_idea_marketing_estado(text,text) from public,anon,authenticated;
revoke all on function public.crear_tarea_marketing(jsonb) from public,anon,authenticated;
revoke all on function public.set_tarea_marketing_estado(text,text) from public,anon,authenticated;
grant execute on function public.agencia_comercial_disponible() to authenticated;
grant execute on function public.guardar_configuracion_agencia(jsonb) to authenticated;
grant execute on function public.crear_brief_agencia(jsonb) to authenticated;
grant execute on function public.set_estado_brief_agencia(bigint,text,text) to authenticated;
grant execute on function public.crear_decision_agencia(jsonb) to authenticated;
grant execute on function public.resolver_decision_agencia(bigint,text,text) to authenticated;
grant execute on function public.crear_version_creativa_agencia(jsonb) to authenticated;
grant execute on function public.revisar_version_creativa_agencia(bigint,text,text) to authenticated;
grant execute on function public.set_idea_marketing_estado(text,text) to authenticated;
grant execute on function public.crear_tarea_marketing(jsonb) to authenticated;
grant execute on function public.set_tarea_marketing_estado(text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260714_16_agencia_comercial','Briefs, decisiones, versiones creativas, límites y autonomía comercial protegida')
on conflict(id) do update set detalle=excluded.detalle;
commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260714_16_agencia_comercial';
