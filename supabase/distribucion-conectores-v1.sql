-- MOMOS OPS · Distribución por conectores v1.
-- Paso 29. Agrega una outbox sellada después de la aprobación humana.
-- No contiene secretos ni publica desde el navegador: un worker/MCP service_role
-- reclama, despacha una sola vez y concilia el resultado del proveedor.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_28_orquestador_agencia'
  ) then raise exception 'Falta el paso 28_orquestador_agencia.'; end if;
end $$;

create table if not exists public.distribution_connector_jobs(
  id bigint generated always as identity primary key,
  distribution_id bigint not null references public.content_distributions(id) on delete restrict,
  post_id text not null references public.content_posts(id) on delete restrict,
  provider text not null check(provider in ('Meta','TikTok')),
  mode text not null check(mode in ('Borrador','Directo')),
  attempt integer not null check(attempt>0),
  idempotency_key text not null unique check(idempotency_key ~ '^momos:distribution:[0-9]+:[0-9]+$'),
  sealed_snapshot jsonb not null check(jsonb_typeof(sealed_snapshot)='object'),
  snapshot_fingerprint text not null check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  status text not null default 'Autorizado' check(status in ('Autorizado','Arrendado','Despachando','En proveedor','Borrador listo','Publicado','Fallido','Incierto','Cancelado')),
  authorized_by text not null references public.users(id),
  authorized_at timestamptz not null default now(),
  scheduled_at timestamptz not null,
  worker_id text not null default '',
  lease_token uuid,
  lease_expires_at timestamptz,
  dispatched_at timestamptz,
  provider_job_id text not null default '',
  external_url text not null default '',
  provider_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_metadata)='object'),
  actual_cost_cop numeric not null default 0 check(actual_cost_cop>=0 and actual_cost_cop::text not in ('NaN','Infinity','-Infinity')),
  error_message text not null default '' check(length(error_message)<=500),
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint distribution_connector_attempt_uq unique(distribution_id,attempt),
  constraint distribution_connector_lease_pair check((lease_token is null)=(lease_expires_at is null)),
  constraint distribution_connector_no_snapshot_secret check(sealed_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:'),
  constraint distribution_connector_no_metadata_secret check(provider_metadata::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:')
);
create index if not exists distribution_connector_jobs_queue_idx on public.distribution_connector_jobs(status,scheduled_at,next_attempt_at,id);
create index if not exists distribution_connector_jobs_post_idx on public.distribution_connector_jobs(post_id,attempt desc);
create unique index if not exists distribution_connector_one_open_idx on public.distribution_connector_jobs(distribution_id)
  where status in ('Autorizado','Arrendado','Despachando','En proveedor','Borrador listo','Incierto');

alter table public.distribution_connector_jobs enable row level security;
drop policy if exists staff_read on public.distribution_connector_jobs;
create policy staff_read on public.distribution_connector_jobs for select to authenticated using(public.is_staff());
revoke all on public.distribution_connector_jobs from public,anon,authenticated;
grant select on public.distribution_connector_jobs to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='distribution_connector_jobs') then
    alter publication supabase_realtime add table public.distribution_connector_jobs;
  end if;
end $$;

create or replace function public.distribucion_conectores_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._distribution_provider(p_channel text) returns text
language sql immutable security definer set search_path=public as $$
  select case btrim(coalesce(p_channel,'')) when 'Instagram' then 'Meta' when 'Facebook' then 'Meta' when 'TikTok' then 'TikTok' else '' end
$$;

create or replace function public._distribution_connector_fingerprint(p jsonb) returns text
language sql immutable security definer set search_path=public as $$ select md5(p::text) $$;

create or replace function public._distribution_connector_snapshot(p_post public.content_posts,p_run public.content_distributions,p_creative public.creatives) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'schema_version',1,'post_id',p_post.id,'distribution_id',p_run.id,'distribution_attempt',p_run.attempt,
    'channel',p_post.canal,'scheduled_date',p_post.fecha,'scheduled_time',p_post.hora,
    'title',p_post.titulo,'copy_final',p_post.copy_final,'campaign_id',p_post.campaign_id,
    'creative',jsonb_build_object('id',p_creative.id,'title',p_creative.titulo,'format',p_creative.formato,
      'asset_url',p_creative.asset_url,'state',p_creative.estado,'aigc',p_creative.generacion is not null),
    'approval',jsonb_build_object('approved_by',p_run.approved_by,'approved_at',p_run.approved_at,'checklist',p_run.checklist)
  )
$$;

create or replace function public._distribution_connector_validate_snapshot(p jsonb) returns void
language plpgsql immutable security definer set search_path=public as $$
begin
  if p is null or jsonb_typeof(p)<>'object' or coalesce(p->>'post_id','')='' or coalesce(p#>>'{creative,asset_url}','')='' then
    raise exception 'La instantánea de distribución está incompleta.';
  end if;
  if p::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then
    raise exception 'La instantánea de distribución contiene secretos.';
  end if;
end $$;

create or replace function public.autorizar_despacho_distribucion(p_post_id text,p_mode text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_post public.content_posts%rowtype; v_run public.content_distributions%rowtype;
  v_creative public.creatives%rowtype; v_integration public.agency_integrations%rowtype; v_provider text; v_mode text;
  v_snapshot jsonb; v_attempt integer; v_id bigint; v_existing public.distribution_connector_jobs%rowtype; v_scheduled timestamptz;
begin
  v_actor:=public._distribution_actor();
  select * into v_post from public.content_posts where id=p_post_id for update;
  select * into v_run from public.content_distributions where post_id=p_post_id for update;
  if v_post.id is null or v_run.id is null then raise exception 'La salida comercial no existe.'; end if;
  if v_post.estado<>'Programado' or v_run.status<>'Aprobada' or v_run.approved_by is null then raise exception 'La salida necesita aprobación humana vigente.'; end if;
  select * into v_creative from public.creatives where id=v_post.creative_id;
  if v_creative.id is null or v_creative.estado not in ('Aprobado','Publicado','Ganador') or length(btrim(coalesce(v_creative.asset_url,'')))=0 then
    raise exception 'El creativo aprobado y su archivo final deben seguir vigentes.';
  end if;
  v_provider:=public._distribution_provider(v_post.canal);
  if v_provider='' then raise exception 'El canal % conserva distribución manual.',v_post.canal; end if;
  select * into v_integration from public.agency_integrations where provider=v_provider for update;
  if v_integration.provider is null or v_integration.status<>'Activa' or v_integration.secret_configured is not true
     or v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
    raise exception 'El conector % no está activo, no tiene secreto confirmado o perdió su heartbeat.',v_provider;
  end if;
  if v_provider='TikTok' then
    v_mode:=coalesce(nullif(p_mode,''),'Borrador');
    if v_mode not in ('Borrador','Directo') then raise exception 'Modo de TikTok inválido.'; end if;
    if v_mode='Borrador' and not (v_integration.capabilities ? 'Borradores') then raise exception 'TikTok no confirmó la capacidad Borradores.'; end if;
    if v_mode='Directo' and not (v_integration.capabilities ? 'Direct Post auditado') then raise exception 'TikTok Direct Post requiere auditoría y capacidad explícita.'; end if;
  else
    v_mode:=coalesce(nullif(p_mode,''),'Directo');
    if v_mode<>'Directo' then raise exception 'Meta solo admite modo Directo en este contrato.'; end if;
    if not (v_integration.capabilities ? 'Publicación directa') then raise exception 'Meta no confirmó Publicación directa.'; end if;
  end if;
  select * into v_existing from public.distribution_connector_jobs where distribution_id=v_run.id
    and status in ('Autorizado','Arrendado','Despachando','En proveedor','Borrador listo','Incierto') order by attempt desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok',true,'job_id',v_existing.id,'status',v_existing.status,'duplicate',true,
      'idempotency_key',v_existing.idempotency_key,'requires_worker',v_existing.status not in ('Borrador listo','Incierto'));
  end if;
  if exists(select 1 from public.distribution_connector_jobs where distribution_id=v_run.id and status='Publicado') then
    raise exception 'La salida ya fue publicada por un conector.';
  end if;
  v_snapshot:=public._distribution_connector_snapshot(v_post,v_run,v_creative);
  perform public._distribution_connector_validate_snapshot(v_snapshot);
  select coalesce(max(attempt),0)+1 into v_attempt from public.distribution_connector_jobs where distribution_id=v_run.id;
  v_scheduled:=((v_post.fecha::timestamp+v_post.hora) at time zone 'America/Bogota');
  insert into public.distribution_connector_jobs(distribution_id,post_id,provider,mode,attempt,idempotency_key,sealed_snapshot,snapshot_fingerprint,authorized_by,scheduled_at,next_attempt_at)
  values(v_run.id,v_post.id,v_provider,v_mode,v_attempt,'momos:distribution:'||v_run.id::text||':'||v_attempt::text,
    v_snapshot,public._distribution_connector_fingerprint(v_snapshot),v_actor.id,v_scheduled,greatest(now(),v_scheduled)) returning id into v_id;
  perform public._add_audit('Distribución conector',v_id::text,'Despacho autorizado','',v_provider||' · '||v_mode||' · '||p_post_id);
  return jsonb_build_object('ok',true,'job_id',v_id,'status','Autorizado','duplicate',false,
    'idempotency_key','momos:distribution:'||v_run.id::text||':'||v_attempt::text,'requires_worker',true);
end $$;

create or replace function public.reintentar_despacho_distribucion(p_job_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.distribution_connector_jobs%rowtype;
begin
  v_actor:=public._distribution_actor();
  select * into v_job from public.distribution_connector_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El despacho no existe.'; end if;
  if v_job.status not in ('Fallido','Cancelado') then raise exception 'Solo un despacho Fallido o Cancelado admite un nuevo intento.'; end if;
  return public.autorizar_despacho_distribucion(v_job.post_id,v_job.mode);
end $$;

create or replace function public.reclamar_despacho_distribucion(p_worker_id text,p_lease_minutes integer default 5) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_worker text:=btrim(coalesce(p_worker_id,'')); v_job public.distribution_connector_jobs%rowtype;
  v_integration public.agency_integrations%rowtype; v_token uuid:=gen_random_uuid();
begin
  if v_worker !~ '^[A-Za-z0-9._:-]{3,120}$' or p_lease_minutes not between 1 and 15 then raise exception 'Worker o lease inválido.'; end if;
  select * into v_job from public.distribution_connector_jobs where status='Autorizado' and scheduled_at<=now() and next_attempt_at<=now()
    order by scheduled_at,id for update skip locked limit 1;
  if v_job.id is null then return '{}'::jsonb; end if;
  if v_job.snapshot_fingerprint<>public._distribution_connector_fingerprint(v_job.sealed_snapshot) then raise exception 'La instantánea del despacho perdió integridad.'; end if;
  perform public._distribution_connector_validate_snapshot(v_job.sealed_snapshot);
  if not exists(select 1 from public.content_distributions where id=v_job.distribution_id and status='Aprobada')
     or not exists(select 1 from public.content_posts where id=v_job.post_id and estado='Programado') then
    raise exception 'La aprobación o la programación ya no están vigentes.';
  end if;
  select * into v_integration from public.agency_integrations where provider=v_job.provider;
  if v_integration.provider is null or v_integration.status<>'Activa' or v_integration.secret_configured is not true
     or v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
    raise exception 'El conector % no está saludable.',v_job.provider;
  end if;
  update public.distribution_connector_jobs set status='Arrendado',worker_id=v_worker,lease_token=v_token,
    lease_expires_at=now()+make_interval(mins=>p_lease_minutes),updated_at=now() where id=v_job.id;
  return jsonb_build_object('job_id',v_job.id,'provider',v_job.provider,'mode',v_job.mode,'attempt',v_job.attempt,
    'idempotency_key',v_job.idempotency_key,'snapshot',v_job.sealed_snapshot,'lease_token',v_token,'lease_minutes',p_lease_minutes);
end $$;

create or replace function public.marcar_despacho_distribucion(p_job_id bigint,p_lease_token uuid,p_metadata jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.distribution_connector_jobs%rowtype;
begin
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or p_metadata::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then
    raise exception 'La metadata de despacho es inválida o contiene secretos.';
  end if;
  select * into v_job from public.distribution_connector_jobs where id=p_job_id for update;
  if v_job.status='Despachando' and v_job.lease_token=p_lease_token then return jsonb_build_object('ok',true,'job_id',v_job.id,'duplicate',true,'idempotency_key',v_job.idempotency_key); end if;
  if v_job.id is null or v_job.status<>'Arrendado' or v_job.lease_token is distinct from p_lease_token or v_job.lease_expires_at<=now() then raise exception 'Lease inválido o vencido.'; end if;
  update public.distribution_connector_jobs set status='Despachando',dispatched_at=now(),provider_metadata=p_metadata,updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'duplicate',false,'idempotency_key',v_job.idempotency_key);
end $$;

create or replace function public.confirmar_recepcion_despacho_distribucion(p_job_id bigint,p_lease_token uuid,p_provider_job_id text,p_state text default 'En proveedor',p_external_url text default '',p_metadata jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.distribution_connector_jobs%rowtype; v_external text:=btrim(coalesce(p_provider_job_id,''));
begin
  if p_state not in ('En proveedor','Borrador listo') or length(v_external)<2 then raise exception 'Identidad o estado del proveedor inválido.'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or p_metadata::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then raise exception 'Metadata inválida o con secretos.'; end if;
  select * into v_job from public.distribution_connector_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El despacho no existe.'; end if;
  if v_job.status=p_state and v_job.provider_job_id=v_external then return jsonb_build_object('ok',true,'job_id',v_job.id,'status',v_job.status,'duplicate',true); end if;
  if v_job.status<>'Despachando' or v_job.lease_token is distinct from p_lease_token then raise exception 'El despacho no está marcado antes del HTTP o el lease no coincide.'; end if;
  if p_state='Borrador listo' and v_job.mode<>'Borrador' then raise exception 'Un envío Directo no puede cerrarse como borrador.'; end if;
  update public.distribution_connector_jobs set status=p_state,provider_job_id=v_external,external_url=btrim(coalesce(p_external_url,'')),
    provider_metadata=provider_metadata||p_metadata,completed_at=case when p_state='Borrador listo' then now() else null end,
    lease_token=null,lease_expires_at=null,updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status',p_state,'duplicate',false);
end $$;

create or replace function public.conciliar_despacho_distribucion(p_job_id bigint,p_result text,p_provider_job_id text default '',p_external_url text default '',p_error text default '',p_actual_cost_cop numeric default 0,p_metadata jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.distribution_connector_jobs%rowtype; v_run public.content_distributions%rowtype; v_post public.content_posts%rowtype;
  v_external text:=btrim(coalesce(p_provider_job_id,'')); v_url text:=btrim(coalesce(p_external_url,'')); v_error text:=btrim(coalesce(p_error,''));
begin
  if p_result not in ('Publicado','Borrador listo','Fallido','Incierto') then raise exception 'Resultado de conciliación inválido.'; end if;
  if coalesce(p_actual_cost_cop,-1)<0 or p_actual_cost_cop::text in ('NaN','Infinity','-Infinity') then raise exception 'Costo de distribución inválido.'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or p_metadata::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then raise exception 'Metadata inválida o con secretos.'; end if;
  select * into v_job from public.distribution_connector_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El despacho no existe.'; end if;
  if v_job.status=p_result and p_result in ('Publicado','Borrador listo','Fallido','Incierto') then return jsonb_build_object('ok',true,'job_id',v_job.id,'status',v_job.status,'duplicate',true); end if;
  if v_job.status not in ('Despachando','En proveedor') then raise exception 'El despacho no está pendiente de conciliación.'; end if;
  if p_result='Publicado' and length(coalesce(nullif(v_external,''),nullif(v_job.provider_job_id,'')))=0 and length(v_url)=0 then raise exception 'Falta evidencia externa de publicación.'; end if;
  if p_result in ('Fallido','Incierto') and length(v_error)<5 then raise exception 'Explicá el resultado fallido o incierto.'; end if;
  if p_result='Borrador listo' and v_job.mode<>'Borrador' then raise exception 'El modo Directo no puede producir un borrador.'; end if;
  update public.distribution_connector_jobs set status=p_result,provider_job_id=coalesce(nullif(v_external,''),provider_job_id),
    external_url=coalesce(nullif(v_url,''),external_url),actual_cost_cop=p_actual_cost_cop,provider_metadata=provider_metadata||p_metadata,
    error_message=case when p_result in ('Fallido','Incierto') then v_error else '' end,completed_at=now(),lease_token=null,lease_expires_at=null,updated_at=now()
  where id=v_job.id;
  if p_result='Publicado' then
    select * into v_run from public.content_distributions where id=v_job.distribution_id for update;
    select * into v_post from public.content_posts where id=v_job.post_id for update;
    if v_run.status<>'Aprobada' or v_post.estado<>'Programado' then raise exception 'La salida cambió durante la conciliación; se requiere revisión humana.'; end if;
    update public.content_distributions set status='Publicada',executed_by=v_job.authorized_by,published_at=now(),
      external_url=coalesce(nullif(v_url,''),v_job.external_url),external_post_id=coalesce(nullif(v_external,''),nullif(v_job.provider_job_id,''),''),failure_reason='',updated_at=now() where id=v_run.id;
    update public.content_posts set estado='Publicado',url_publicacion=coalesce(nullif(v_url,''),v_job.external_url),
      external_post_id=coalesce(nullif(v_external,''),nullif(v_job.provider_job_id,'')) where id=v_post.id;
    update public.creatives set estado='Publicado',external_id=coalesce(nullif(v_external,''),nullif(v_job.provider_job_id,''),external_id)
      where id=v_post.creative_id and estado='Aprobado';
  end if;
  perform public._add_audit('Distribución conector',v_job.id::text,'Conciliación',v_job.status,p_result||case when v_error<>'' then ' · '||v_error else '' end);
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status',p_result,'duplicate',false);
end $$;

create or replace function public._distribution_connector_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='distribution_connector_jobs' and tg_op='UPDATE' then
    if new.distribution_id is distinct from old.distribution_id or new.post_id is distinct from old.post_id or new.provider is distinct from old.provider
       or new.mode is distinct from old.mode or new.attempt is distinct from old.attempt or new.idempotency_key is distinct from old.idempotency_key
       or new.sealed_snapshot is distinct from old.sealed_snapshot or new.snapshot_fingerprint is distinct from old.snapshot_fingerprint
       or new.authorized_by is distinct from old.authorized_by or new.authorized_at is distinct from old.authorized_at or new.scheduled_at is distinct from old.scheduled_at then
      raise exception 'El despacho sellado no se puede reescribir.';
    end if;
  elsif tg_table_name='content_distributions' and tg_op='UPDATE' and old.status='Aprobada' and new.status in ('Publicada','Fallida')
    and exists(select 1 from public.distribution_connector_jobs j where j.distribution_id=old.id and j.status in ('Autorizado','Arrendado','Despachando','En proveedor','Incierto')) then
    raise exception 'Hay un despacho de conector activo o incierto; conciliá antes de cerrar manualmente.';
  end if;
  return new;
end $$;

create or replace function public._distribution_connector_manual_completion() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status='Aprobada' and new.status='Publicada' then
    update public.distribution_connector_jobs set status='Publicado',external_url=coalesce(nullif(new.external_url,''),external_url),
      provider_job_id=coalesce(nullif(new.external_post_id,''),provider_job_id),error_message='',completed_at=coalesce(completed_at,now()),updated_at=now()
    where distribution_id=new.id and status='Borrador listo';
  elsif old.status='Aprobada' and new.status='Fallida' then
    update public.distribution_connector_jobs set status='Cancelado',error_message=left(coalesce(nullif(new.failure_reason,''),'Cierre manual'),500),
      completed_at=coalesce(completed_at,now()),updated_at=now()
    where distribution_id=new.id and status='Borrador listo';
  end if;
  return new;
end $$;
drop trigger if exists distribution_connector_jobs_immutable on public.distribution_connector_jobs;
create trigger distribution_connector_jobs_immutable before update on public.distribution_connector_jobs for each row execute function public._distribution_connector_guard();
drop trigger if exists content_distributions_connector_guard on public.content_distributions;
create trigger content_distributions_connector_guard before update of status on public.content_distributions for each row execute function public._distribution_connector_guard();
drop trigger if exists content_distributions_connector_completion on public.content_distributions;
create trigger content_distributions_connector_completion after update of status on public.content_distributions for each row execute function public._distribution_connector_manual_completion();

revoke all on function public.distribucion_conectores_disponible() from public,anon,authenticated;
revoke all on function public._distribution_provider(text) from public,anon,authenticated;
revoke all on function public._distribution_connector_fingerprint(jsonb) from public,anon,authenticated;
revoke all on function public._distribution_connector_snapshot(public.content_posts,public.content_distributions,public.creatives) from public,anon,authenticated;
revoke all on function public._distribution_connector_validate_snapshot(jsonb) from public,anon,authenticated;
revoke all on function public._distribution_connector_guard() from public,anon,authenticated;
revoke all on function public._distribution_connector_manual_completion() from public,anon,authenticated;
revoke all on function public.autorizar_despacho_distribucion(text,text) from public,anon,authenticated;
revoke all on function public.reintentar_despacho_distribucion(bigint) from public,anon,authenticated;
revoke all on function public.reclamar_despacho_distribucion(text,integer) from public,anon,authenticated;
revoke all on function public.marcar_despacho_distribucion(bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.confirmar_recepcion_despacho_distribucion(bigint,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.conciliar_despacho_distribucion(bigint,text,text,text,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.distribucion_conectores_disponible() to authenticated;
grant execute on function public.autorizar_despacho_distribucion(text,text) to authenticated;
grant execute on function public.reintentar_despacho_distribucion(bigint) to authenticated;
grant execute on function public.reclamar_despacho_distribucion(text,integer) to service_role;
grant execute on function public.marcar_despacho_distribucion(bigint,uuid,jsonb) to service_role;
grant execute on function public.confirmar_recepcion_despacho_distribucion(bigint,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.conciliar_despacho_distribucion(bigint,text,text,text,text,numeric,jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_29_distribucion_conectores','Outbox sellada, autorización humana, idempotencia, leases y conciliación para Meta/TikTok')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260716_29_distribucion_conectores';
