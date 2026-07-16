-- MOMOS OPS · Conector oficial Meta, verificación dry-run v1.
-- Paso 41. Lee cuenta/campaña/audiencia con ads_read y appsecret_proof.
-- No publica, no cambia presupuesto y no admite métodos externos distintos de GET.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_40_autorizacion_inversion'
  ) then raise exception 'Falta el paso 40_autorizacion_inversion.'; end if;
end $$;

create table if not exists public.agency_meta_connector_dry_runs(
  id bigint generated always as identity primary key,
  dry_run_key text not null unique check(dry_run_key ~ '^meta-dry-run:[0-9]+:1$'),
  authorization_id bigint not null unique references public.agency_meta_investment_authorizations(id) on delete restrict,
  campaign_id text not null references public.campaigns(id) on delete restrict,
  campaign_external_id text not null check(campaign_external_id ~ '^[A-Za-z0-9._:-]{3,180}$'),
  audience_external_id text not null check(audience_external_id ~ '^[A-Za-z0-9._:-]{3,180}$'),
  ad_account_id text not null check(ad_account_id ~ '^act_[0-9]{3,40}$'),
  api_version text not null check(api_version ~ '^v[0-9]{1,2}\.[0-9]+$'),
  mode text not null default 'Read-only' check(mode='Read-only'),
  status text not null default 'Preparado' check(status in
    ('Preparado','Arrendado','Leyendo','Conciliado','Divergente','Fallido','Incierto','Cancelado')),
  idempotency_key text not null unique check(idempotency_key ~ '^momos:meta-dry-run:[0-9]+:1$'),
  sealed_snapshot jsonb not null check(jsonb_typeof(sealed_snapshot)='object'),
  snapshot_fingerprint text not null check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text not null references public.users(id), prepared_at timestamptz not null default now(),
  worker_id text not null default '', lease_token uuid, lease_expires_at timestamptz,
  started_at timestamptz, completed_at timestamptz,
  receipt jsonb not null default '{}'::jsonb check(jsonb_typeof(receipt)='object'),
  error_message text not null default '' check(length(error_message)<=800),
  updated_at timestamptz not null default now(),
  check((lease_token is null)=(lease_expires_at is null)),
  constraint meta_dry_run_snapshot_no_secret check(sealed_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role)"[[:space:]]*:'),
  constraint meta_dry_run_receipt_no_secret check(receipt::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role)"[[:space:]]*:')
);
create index if not exists agency_meta_dry_run_queue_idx on public.agency_meta_connector_dry_runs(status,id);

alter table public.agency_meta_connector_dry_runs enable row level security;
drop policy if exists staff_read on public.agency_meta_connector_dry_runs;
create policy staff_read on public.agency_meta_connector_dry_runs for select to authenticated using(public.is_staff());
revoke all on public.agency_meta_connector_dry_runs from public,anon,authenticated;
grant select on public.agency_meta_connector_dry_runs to authenticated;

create or replace function public.meta_conector_dry_run_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._meta_dry_run_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'La evidencia de verificación Meta no se elimina.'; end if;
  if new.dry_run_key is distinct from old.dry_run_key or new.authorization_id is distinct from old.authorization_id
    or new.campaign_id is distinct from old.campaign_id or new.campaign_external_id is distinct from old.campaign_external_id
    or new.audience_external_id is distinct from old.audience_external_id or new.ad_account_id is distinct from old.ad_account_id
    or new.api_version is distinct from old.api_version or new.mode is distinct from old.mode
    or new.idempotency_key is distinct from old.idempotency_key or new.sealed_snapshot is distinct from old.sealed_snapshot
    or new.snapshot_fingerprint is distinct from old.snapshot_fingerprint or new.prepared_by is distinct from old.prepared_by
    or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La identidad y el contrato dry-run son inmutables.';
  end if;
  return new;
end $$;
drop trigger if exists agency_meta_dry_run_guard on public.agency_meta_connector_dry_runs;
create trigger agency_meta_dry_run_guard before update or delete on public.agency_meta_connector_dry_runs
for each row execute function public._meta_dry_run_guard();

create or replace function public.preparar_dry_run_meta(p_authorization_id bigint,p_ad_account_id text,p_api_version text default 'v25.0') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_auth public.agency_meta_investment_authorizations%rowtype;
  v_scenario public.agency_meta_investment_scenarios%rowtype; v_existing public.agency_meta_connector_dry_runs%rowtype;
  v_account text:=btrim(coalesce(p_ad_account_id,'')); v_version text:=btrim(coalesce(p_api_version,''));
  v_campaign_external text; v_snapshot jsonb; v_fp text; v_id bigint;
begin
  v_actor:=public._agency_actor();
  if public.has_current_role('Administrador') is not true then raise exception 'Solo Administración prepara verificaciones Meta.'; end if;
  if v_account ~ '^[0-9]{3,40}$' then v_account:='act_'||v_account; end if;
  if v_account !~ '^act_[0-9]{3,40}$' or v_version !~ '^v[0-9]{1,2}\.[0-9]+$' then
    raise exception 'Completá cuenta publicitaria act_ y versión Graph exactas.';
  end if;
  select * into v_auth from public.agency_meta_investment_authorizations where id=p_authorization_id for update;
  if v_auth.id is null or v_auth.status<>'Autorizada' or v_auth.valid_until<=now() then
    raise exception 'La verificación exige una autorización humana vigente.';
  end if;
  select * into v_scenario from public.agency_meta_investment_scenarios where id=v_auth.scenario_id;
  if v_scenario.status<>'Aprobado' or exists(select 1 from public.agency_meta_investment_scenarios s
    where s.measurement_id=v_scenario.measurement_id and s.prepared_at>v_scenario.prepared_at) then
    raise exception 'El escenario autorizado ya no es el vigente.';
  end if;
  if exists(select 1 from public.agency_meta_investment_execution_jobs where authorization_id=v_auth.id and status in ('Arrendado','Despachando','Incierto')) then
    raise exception 'La simulación anterior está activa o incierta; primero hay que conciliarla.';
  end if;
  select * into v_existing from public.agency_meta_connector_dry_runs where authorization_id=v_auth.id;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'dry_run_id',v_existing.id,'status',v_existing.status,'duplicate',true,'read_only',true,'executed',false); end if;
  v_campaign_external:=btrim(coalesce(v_auth.sealed_snapshot#>>'{campaign,external_id}',''));
  if v_campaign_external !~ '^[A-Za-z0-9._:-]{3,180}$' then raise exception 'La autorización no selló una campaña Meta exacta.'; end if;
  update public.agency_meta_investment_execution_jobs set status='Cancelado',completed_at=now(),error_message='Sustituido por verificación oficial H41 solo lectura.',updated_at=now()
    where authorization_id=v_auth.id and status='Autorizado';
  v_snapshot:=jsonb_build_object('schema_version',1,'authorization_id',v_auth.id,'authorization_fingerprint',v_auth.snapshot_fingerprint,
    'api_version',v_version,'mode','Read-only','expected',jsonb_build_object('authorization_id',v_auth.id,'ad_account_id',v_account,
      'campaign_external_id',v_campaign_external,'audience_external_id',v_auth.audience_external_id,'target_budget',v_auth.target_budget),
    'allowed_requests',jsonb_build_array(jsonb_build_object('resource','account','method','GET','host','graph.facebook.com'),
      jsonb_build_object('resource','campaign','method','GET','host','graph.facebook.com'),
      jsonb_build_object('resource','audience','method','GET','host','graph.facebook.com')),
    'guards',jsonb_build_object('ads_read_only',true,'ads_management_forbidden',true,'external_mutation_forbidden',true,'automatic_retry_forbidden',true));
  v_fp:=public._agency_mesa_fingerprint(v_snapshot);
  insert into public.agency_meta_connector_dry_runs(dry_run_key,authorization_id,campaign_id,campaign_external_id,audience_external_id,
    ad_account_id,api_version,mode,status,idempotency_key,sealed_snapshot,snapshot_fingerprint,prepared_by)
  values('meta-dry-run:'||v_auth.id||':1',v_auth.id,v_auth.campaign_id,v_campaign_external,v_auth.audience_external_id,v_account,v_version,
    'Read-only','Preparado','momos:meta-dry-run:'||v_auth.id||':1',v_snapshot,v_fp,v_actor.id) returning id into v_id;
  perform public._add_audit('Conector Meta',v_id::text,'Dry-run preparado','','GET · '||v_account||' · '||v_version);
  return jsonb_build_object('ok',true,'dry_run_id',v_id,'status','Preparado','duplicate',false,'read_only',true,'executed',false);
end $$;

create or replace function public.reportar_worker_meta(p_worker_id text,p_version text,p_api_version text,p_status text,p_error text,
  p_account_label text,p_ad_account_id text,p_synced boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_current text; v_worker text:=btrim(coalesce(p_worker_id,'')); v_version text:=btrim(coalesce(p_version,''));
  v_api text:=btrim(coalesce(p_api_version,'')); v_account text:=btrim(coalesce(p_ad_account_id,'')); v_error text:=left(btrim(coalesce(p_error,'')),500);
begin
  if v_account ~ '^[0-9]{3,40}$' then v_account:='act_'||v_account; end if;
  if v_worker !~ '^[A-Za-z0-9._:-]{3,120}$' or length(v_version) not between 3 and 80 or v_api !~ '^v[0-9]{1,2}\.[0-9]+$'
    or v_account !~ '^act_[0-9]{3,40}$' or p_status not in ('Activa','Con error') then raise exception 'Reporte de worker Meta inválido.'; end if;
  select status into v_current from public.agency_integrations where provider='Meta' for update;
  if v_current='Pausada' then
    update public.agency_integrations set worker_version=v_version,last_heartbeat_at=now(),last_error=v_error,updated_at=now() where provider='Meta';
    return jsonb_build_object('ok',true,'status','Pausada','reactivated',false);
  end if;
  update public.agency_integrations set status=p_status,secret_configured=(p_status='Activa'),worker_version=v_version,
    last_heartbeat_at=now(),last_sync_at=case when p_synced then now() else last_sync_at end,last_error=v_error,
    account_label=left(btrim(coalesce(p_account_label,'')),100),external_account_id=v_account,
    capabilities='["Instagram","Facebook","Métricas","Lectura dry-run","ads_read"]'::jsonb,updated_at=now() where provider='Meta';
  return jsonb_build_object('ok',true,'status',p_status,'read_only',true,'api_version',v_api);
end $$;

create or replace function public.reclamar_dry_run_meta(p_worker_id text,p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_worker text:=btrim(coalesce(p_worker_id,'')); v_run public.agency_meta_connector_dry_runs%rowtype; v_token uuid:=gen_random_uuid();
begin
  if v_worker !~ '^[A-Za-z0-9._:-]{3,120}$' or p_lease_seconds not between 30 and 600 then raise exception 'Worker o lease Meta inválido.'; end if;
  update public.agency_meta_connector_dry_runs set status='Fallido',error_message='Lease vencido antes de leer Meta.',completed_at=now(),lease_token=null,lease_expires_at=null,updated_at=now()
    where status='Arrendado' and lease_expires_at<=now();
  update public.agency_meta_connector_dry_runs set status='Incierto',error_message='Lectura interrumpida; conciliación manual requerida y reintento bloqueado.',lease_token=null,lease_expires_at=null,updated_at=now()
    where status='Leyendo' and lease_expires_at<=now();
  if not exists(select 1 from public.agency_integrations where provider='Meta' and status='Activa' and secret_configured
    and last_heartbeat_at>now()-interval '10 minutes' and capabilities @> '["ads_read"]'::jsonb and not capabilities @> '["ads_management"]'::jsonb) then
    raise exception 'El worker Meta de solo lectura no está saludable.';
  end if;
  select r.* into v_run from public.agency_meta_connector_dry_runs r
    join public.agency_meta_investment_authorizations a on a.id=r.authorization_id
    join public.agency_meta_investment_scenarios s on s.id=a.scenario_id
    where r.status='Preparado' and a.status='Autorizada' and a.valid_until>now() and s.status='Aprobado'
      and not exists(select 1 from public.agency_meta_investment_scenarios n where n.measurement_id=s.measurement_id and n.prepared_at>s.prepared_at)
    order by a.valid_until,r.id for update of r skip locked limit 1;
  if v_run.id is null then return '{}'::jsonb; end if;
  if v_run.snapshot_fingerprint<>public._agency_mesa_fingerprint(v_run.sealed_snapshot) then raise exception 'El contrato dry-run perdió integridad.'; end if;
  update public.agency_meta_connector_dry_runs set status='Arrendado',worker_id=v_worker,lease_token=v_token,
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now() where id=v_run.id;
  return jsonb_build_object('ok',true,'dry_run_id',v_run.id,'authorization_id',v_run.authorization_id,'lease_token',v_token,
    'idempotency_key',v_run.idempotency_key,'snapshot',v_run.sealed_snapshot,'read_only',true,'allowed_method','GET');
end $$;

create or replace function public.marcar_lectura_dry_run_meta(p_dry_run_id bigint,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_run public.agency_meta_connector_dry_runs%rowtype;
begin
  select * into v_run from public.agency_meta_connector_dry_runs where id=p_dry_run_id for update;
  if v_run.status='Leyendo' and v_run.lease_token=p_lease_token then return jsonb_build_object('ok',true,'duplicate',true,'read_only',true); end if;
  if v_run.id is null or v_run.status<>'Arrendado' or v_run.lease_token is distinct from p_lease_token or v_run.lease_expires_at<=now() then
    raise exception 'Lease Meta inválido o vencido.';
  end if;
  update public.agency_meta_connector_dry_runs set status='Leyendo',started_at=now(),updated_at=now() where id=v_run.id;
  return jsonb_build_object('ok',true,'duplicate',false,'read_only',true,'instruction','Solo tres GET oficiales; ninguna mutación externa.');
end $$;

create or replace function public.registrar_resultado_dry_run_meta(p_dry_run_id bigint,p_lease_token uuid,p_result text,
  p_receipt jsonb default '{}'::jsonb,p_error text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_run public.agency_meta_connector_dry_runs%rowtype; v_error text:=btrim(coalesce(p_error,'')); v_requests jsonb;
begin
  select * into v_run from public.agency_meta_connector_dry_runs where id=p_dry_run_id for update;
  if v_run.id is null then raise exception 'El dry-run Meta no existe.'; end if;
  if v_run.status in ('Conciliado','Divergente','Fallido','Incierto') and v_run.status=p_result then
    return jsonb_build_object('ok',true,'dry_run_id',v_run.id,'status',v_run.status,'duplicate',true,'retry_blocked',v_run.status='Incierto');
  end if;
  if v_run.status<>'Leyendo' or v_run.lease_token is distinct from p_lease_token or v_run.lease_expires_at<=now() then raise exception 'El lease no concilia esta lectura.'; end if;
  if p_result not in ('Conciliado','Divergente','Fallido','Incierto') then raise exception 'Resultado dry-run Meta inválido.'; end if;
  if public._agency_mesa_has_secret(coalesce(p_receipt,'{}'::jsonb)) then raise exception 'El recibo Meta contiene secretos.'; end if;
  if p_result in ('Conciliado','Divergente') then
    v_requests:=p_receipt->'requests';
    if coalesce(p_receipt->>'schema_version','')<>'1' or p_receipt->>'api_version'<>v_run.api_version or p_receipt->>'mode'<>'Read-only'
      or coalesce((p_receipt->>'external_mutation')::boolean,true) or jsonb_typeof(v_requests)<>'array' or jsonb_array_length(v_requests)<>3
      or exists(select 1 from jsonb_array_elements(v_requests) q where q->>'method'<>'GET' or q->>'host'<>'graph.facebook.com')
      or p_receipt#>>'{account,id}'<>v_run.ad_account_id or p_receipt#>>'{campaign,id}'<>v_run.campaign_external_id
      or p_receipt#>>'{audience,id}'<>v_run.audience_external_id
      or coalesce((p_receipt->>'reconciled')::boolean,false) is distinct from (p_result='Conciliado') then
      raise exception 'El recibo no demuestra tres GET ni identidades exactas sin mutación.';
    end if;
  elsif length(v_error)<8 then raise exception 'Explicá el fallo o la incertidumbre Meta.'; end if;
  update public.agency_meta_connector_dry_runs set status=p_result,receipt=coalesce(p_receipt,'{}'::jsonb),error_message=v_error,
    completed_at=case when p_result='Incierto' then null else now() end,lease_token=null,lease_expires_at=null,updated_at=now() where id=v_run.id;
  update public.agency_integrations set successful_jobs=successful_jobs+case when p_result='Conciliado' then 1 else 0 end,
    failed_jobs=failed_jobs+case when p_result in ('Fallido','Divergente') then 1 else 0 end,last_job_at=now(),
    last_sync_at=case when p_result='Conciliado' then now() else last_sync_at end,last_error=case when p_result='Conciliado' then '' else left(coalesce(nullif(v_error,''),p_result),500) end,updated_at=now()
    where provider='Meta';
  perform public._add_audit('Conector Meta',v_run.id::text,'Dry-run '||lower(p_result),'',case when p_result='Conciliado' then 'Tres GET conciliados · cero mutaciones' else left(coalesce(nullif(v_error,''),p_result),180) end);
  return jsonb_build_object('ok',true,'dry_run_id',v_run.id,'status',p_result,'duplicate',false,'retry_blocked',p_result='Incierto','external_mutation',false);
end $$;

do $$ declare v_name text; begin
  foreach v_name in array array['_meta_dry_run_guard()'] loop execute format('revoke all on function public.%s from public,anon,authenticated',v_name); end loop;
end $$;
revoke all on function public.meta_conector_dry_run_disponible() from public,anon;
revoke all on function public.preparar_dry_run_meta(bigint,text,text) from public,anon;
revoke all on function public.reportar_worker_meta(text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.reclamar_dry_run_meta(text,integer) from public,anon,authenticated;
revoke all on function public.marcar_lectura_dry_run_meta(bigint,uuid) from public,anon,authenticated;
revoke all on function public.registrar_resultado_dry_run_meta(bigint,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.meta_conector_dry_run_disponible() to authenticated;
grant execute on function public.preparar_dry_run_meta(bigint,text,text) to authenticated;
grant execute on function public.reportar_worker_meta(text,text,text,text,text,text,text,boolean) to service_role;
grant execute on function public.reclamar_dry_run_meta(text,integer) to service_role;
grant execute on function public.marcar_lectura_dry_run_meta(bigint,uuid) to service_role;
grant execute on function public.registrar_resultado_dry_run_meta(bigint,uuid,text,jsonb,text) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_meta_connector_dry_runs') then
    alter publication supabase_realtime add table public.agency_meta_connector_dry_runs;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_41_meta_conector_dry_run','Conector oficial Meta ads_read: tres GET con appsecret_proof, conciliación exacta, lease e incertidumbre sin mutar pauta')
on conflict(id) do update set detalle=excluded.detalle;

commit;
