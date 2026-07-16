-- MOMOS OPS · Autorización de inversión Meta v1.
-- Paso 40. Separa la aprobación analítica de un permiso corto, exacto e idempotente.
-- Este hito opera únicamente en Simulación: no llama Meta ni cambia campañas.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_39_escenarios_inversion'
  ) then raise exception 'Falta el paso 39_escenarios_inversion.'; end if;
end $$;

create table if not exists public.agency_meta_investment_authorizations(
  id bigint generated always as identity primary key,
  authorization_key text not null unique check(authorization_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  scenario_id bigint not null references public.agency_meta_investment_scenarios(id) on delete restrict,
  measurement_id bigint not null references public.agency_meta_lift_measurements(id) on delete restrict,
  campaign_id text not null references public.campaigns(id) on delete restrict,
  product_id text references public.products(id) on delete restrict,
  selected_option text not null check(selected_option in ('Conservar','Reducir','Redistribuir','Experimento')),
  audience_external_id text not null check(audience_external_id ~ '^[A-Za-z0-9._:-]{3,180}$'),
  target_budget numeric not null check(target_budget>=0 and target_budget::text not in ('NaN','Infinity','-Infinity')),
  execution_mode text not null default 'Simulación' check(execution_mode='Simulación'),
  status text not null default 'En revisión' check(status in
    ('En revisión','Autorizada','Devuelta','Rechazada','Revocada','Vencida','Sustituida','Simulada','Fallida','Incierta')),
  justification text not null check(length(btrim(justification)) between 16 and 600),
  valid_from timestamptz not null default now(), valid_until timestamptz not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{32}$'),
  sealed_snapshot jsonb not null check(jsonb_typeof(sealed_snapshot)='object'),
  snapshot_fingerprint text not null check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  requested_by text not null references public.users(id), requested_at timestamptz not null default now(),
  authorized_by text references public.users(id), authorized_at timestamptz,
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  revoked_by text references public.users(id), revoked_at timestamptz, revoke_reason text not null default '',
  check(valid_until>valid_from and valid_until<=valid_from+interval '120 minutes'),
  constraint meta_authorization_no_secret check(sealed_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:')
);
create unique index if not exists agency_meta_authorization_one_open_idx
  on public.agency_meta_investment_authorizations(scenario_id)
  where status in ('En revisión','Autorizada');
create index if not exists agency_meta_authorization_status_idx
  on public.agency_meta_investment_authorizations(status,valid_until,id);

create table if not exists public.agency_meta_investment_execution_jobs(
  id bigint generated always as identity primary key,
  authorization_id bigint not null references public.agency_meta_investment_authorizations(id) on delete restrict,
  attempt integer not null default 1 check(attempt=1),
  idempotency_key text not null unique check(idempotency_key ~ '^momos:meta-investment:[0-9]+:1$'),
  execution_mode text not null default 'Simulación' check(execution_mode='Simulación'),
  status text not null default 'Autorizado' check(status in
    ('Autorizado','Arrendado','Despachando','Simulado','Fallido','Incierto','Cancelado')),
  sealed_snapshot jsonb not null check(jsonb_typeof(sealed_snapshot)='object'),
  snapshot_fingerprint text not null check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  worker_id text not null default '', lease_token uuid, lease_expires_at timestamptz,
  dispatched_at timestamptz, completed_at timestamptz,
  receipt jsonb not null default '{}'::jsonb check(jsonb_typeof(receipt)='object'),
  error_message text not null default '' check(length(error_message)<=600),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(authorization_id,attempt),
  check((lease_token is null)=(lease_expires_at is null)),
  constraint meta_execution_no_snapshot_secret check(sealed_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:'),
  constraint meta_execution_no_receipt_secret check(receipt::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:')
);
create unique index if not exists agency_meta_execution_one_open_idx
  on public.agency_meta_investment_execution_jobs(authorization_id)
  where status in ('Autorizado','Arrendado','Despachando','Incierto');
create index if not exists agency_meta_execution_queue_idx
  on public.agency_meta_investment_execution_jobs(status,id);

alter table public.agency_meta_investment_authorizations enable row level security;
alter table public.agency_meta_investment_execution_jobs enable row level security;
drop policy if exists staff_read on public.agency_meta_investment_authorizations;
create policy staff_read on public.agency_meta_investment_authorizations for select to authenticated using(public.is_staff());
drop policy if exists staff_read on public.agency_meta_investment_execution_jobs;
create policy staff_read on public.agency_meta_investment_execution_jobs for select to authenticated using(public.is_staff());
revoke all on public.agency_meta_investment_authorizations,public.agency_meta_investment_execution_jobs from public,anon,authenticated;
grant select on public.agency_meta_investment_authorizations,public.agency_meta_investment_execution_jobs to authenticated;

create or replace function public.autorizacion_inversion_meta_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._meta_authorization_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Las autorizaciones Meta no se eliminan.'; end if;
  if new.authorization_key is distinct from old.authorization_key or new.scenario_id is distinct from old.scenario_id
     or new.measurement_id is distinct from old.measurement_id or new.campaign_id is distinct from old.campaign_id
     or new.product_id is distinct from old.product_id or new.selected_option is distinct from old.selected_option
     or new.audience_external_id is distinct from old.audience_external_id or new.target_budget is distinct from old.target_budget
     or new.execution_mode is distinct from old.execution_mode or new.justification is distinct from old.justification
     or new.valid_from is distinct from old.valid_from or new.valid_until is distinct from old.valid_until
     or new.request_fingerprint is distinct from old.request_fingerprint or new.sealed_snapshot is distinct from old.sealed_snapshot
     or new.snapshot_fingerprint is distinct from old.snapshot_fingerprint or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then raise exception 'El contrato Meta sellado no se puede reescribir.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_authorization_guard on public.agency_meta_investment_authorizations;
create trigger agency_meta_authorization_guard before update or delete on public.agency_meta_investment_authorizations
for each row execute function public._meta_authorization_guard();

create or replace function public._meta_execution_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los intentos Meta no se eliminan.'; end if;
  if new.authorization_id is distinct from old.authorization_id or new.attempt is distinct from old.attempt
     or new.idempotency_key is distinct from old.idempotency_key or new.execution_mode is distinct from old.execution_mode
     or new.sealed_snapshot is distinct from old.sealed_snapshot or new.snapshot_fingerprint is distinct from old.snapshot_fingerprint
     or new.created_at is distinct from old.created_at then raise exception 'La identidad y evidencia del intento Meta son inmutables.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_execution_guard on public.agency_meta_investment_execution_jobs;
create trigger agency_meta_execution_guard before update or delete on public.agency_meta_investment_execution_jobs
for each row execute function public._meta_execution_guard();

create or replace function public.solicitar_autorizacion_inversion_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_scenario public.agency_meta_investment_scenarios%rowtype; v_campaign public.campaigns%rowtype;
  v_settings public.agency_settings%rowtype; v_existing public.agency_meta_investment_authorizations%rowtype;
  v_key text:=btrim(coalesce(p->>'authorization_key','')); v_option_key text:=btrim(coalesce(p->>'selected_option',''));
  v_audience text:=btrim(coalesce(p->>'audience_external_id','')); v_justification text:=btrim(coalesce(p->>'justification',''));
  v_budget numeric:=coalesce(nullif(p->>'target_budget','')::numeric,-1); v_minutes integer:=coalesce(nullif(p->>'valid_minutes','')::integer,0);
  v_option jsonb; v_ops jsonb; v_request jsonb; v_snapshot jsonb; v_request_fp text; v_snapshot_fp text; v_id bigint; v_until timestamptz;
begin
  v_actor:=public._agency_actor();
  if not(public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then raise exception 'Tu rol no solicita autorizaciones de inversión.'; end if;
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or coalesce(p->>'execution_mode','')<>'Simulación' then raise exception 'La solicitud es inválida, contiene secretos o intenta salir de Simulación.'; end if;
  select * into v_scenario from public.agency_meta_investment_scenarios where id=nullif(p->>'scenario_id','')::bigint and status='Aprobado' for update;
  if v_scenario.id is null then raise exception 'La autorización exige un escenario aprobado.'; end if;
  if exists(select 1 from public.agency_meta_investment_scenarios s where s.measurement_id=v_scenario.measurement_id and s.prepared_at>v_scenario.prepared_at) then
    raise exception 'El escenario fue sustituido por evidencia operativa más reciente.'; end if;
  select value into v_option from jsonb_array_elements(v_scenario.options_snapshot) where value->>'key'=v_option_key;
  if v_option is null or v_option_key not in ('Conservar','Reducir','Redistribuir','Experimento') then raise exception 'Elegí una alternativa sellada.'; end if;
  if jsonb_typeof(v_option->'blockers')<>'array' or jsonb_array_length(v_option->'blockers')>0 then
    raise exception 'La alternativa conserva bloqueos operativos sin resolver.'; end if;
  if v_audience !~ '^[A-Za-z0-9._:-]{3,180}$' or length(v_justification) not between 16 and 600 or v_minutes not between 10 and 120 then
    raise exception 'Completá audiencia exacta, justificación y vigencia de 10 a 120 minutos.'; end if;
  if abs(v_budget-coalesce((v_option->>'proposed_budget')::numeric,-2))>.01 then raise exception 'El presupuesto no coincide con la alternativa sellada.'; end if;
  select * into v_campaign from public.campaigns where id=v_scenario.campaign_id;
  select * into v_settings from public.agency_settings where id;
  if v_campaign.id is null or lower(coalesce(v_campaign.external_platform,''))<>'meta' or length(btrim(coalesce(v_campaign.external_id,'')))<3 then
    raise exception 'La campaña necesita identidad externa exacta de Meta.'; end if;
  if v_settings.paused or v_budget>v_settings.campaign_budget_limit
     or (v_budget>v_campaign.presupuesto and v_budget-v_campaign.presupuesto>v_settings.daily_budget_limit) then
    raise exception 'Agencia está pausada o el objetivo supera sus límites protegidos.'; end if;
  v_ops:=public._meta_investment_ops_snapshot(v_scenario.measurement_id);
  if coalesce((v_ops#>>'{operations,stock_blocked}')::boolean,true) and v_option_key<>'Reducir' then
    raise exception 'Sin stock operativo solo puede solicitarse reducir exposición.'; end if;
  v_request:=jsonb_build_object('scenario_fingerprint',v_scenario.scenario_fingerprint,'selected_option',v_option_key,
    'audience_external_id',v_audience,'target_budget',v_budget,'valid_minutes',v_minutes,'justification',v_justification,'execution_mode','Simulación');
  v_request_fp:=public._agency_mesa_fingerprint(v_request);
  select * into v_existing from public.agency_meta_investment_authorizations where authorization_key=v_key;
  if v_existing.id is not null and v_existing.request_fingerprint<>v_request_fp then raise exception 'La clave de autorización ya pertenece a otro contrato.'; end if;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'authorization_id',v_existing.id,'status',v_existing.status,
    'duplicate',true,'authorized',v_existing.status='Autorizada','executed',false,'simulation_only',true); end if;
  select * into v_existing from public.agency_meta_investment_authorizations where scenario_id=v_scenario.id and status in ('En revisión','Autorizada') order by id desc limit 1;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'authorization_id',v_existing.id,'status',v_existing.status,
    'duplicate',true,'authorized',v_existing.status='Autorizada','executed',false,'simulation_only',true); end if;
  v_until:=now()+make_interval(mins=>v_minutes);
  v_snapshot:=jsonb_build_object('schema_version',1,'scenario_id',v_scenario.id,'scenario_fingerprint',v_scenario.scenario_fingerprint,
    'measurement_id',v_scenario.measurement_id,'campaign',jsonb_build_object('id',v_campaign.id,'external_id',v_campaign.external_id,
      'external_platform',v_campaign.external_platform,'state',v_campaign.estado,'current_budget',v_campaign.presupuesto),
    'product_id',v_scenario.product_id,'selected_option',v_option,'audience_external_id',v_audience,'target_budget',v_budget,
    'valid_from',now(),'valid_until',v_until,'operations',v_ops->'operations','limits',v_ops->'limits',
    'guards',jsonb_build_object('human_authorization_required',true,'simulation_only',true,'external_http_forbidden',true,
      'publication_forbidden',true,'automatic_retry_forbidden',true));
  v_snapshot_fp:=public._agency_mesa_fingerprint(v_snapshot);
  insert into public.agency_meta_investment_authorizations(authorization_key,scenario_id,measurement_id,campaign_id,product_id,selected_option,
    audience_external_id,target_budget,execution_mode,status,justification,valid_from,valid_until,request_fingerprint,sealed_snapshot,
    snapshot_fingerprint,requested_by)
  values(v_key,v_scenario.id,v_scenario.measurement_id,v_scenario.campaign_id,v_scenario.product_id,v_option_key,v_audience,v_budget,
    'Simulación','En revisión',v_justification,now(),v_until,v_request_fp,v_snapshot,v_snapshot_fp,v_actor.id) returning id into v_id;
  perform public._add_audit('Autorización Meta',v_id::text,'Permiso solicitado','',v_option_key||' · Simulación · '||v_minutes||' min');
  return jsonb_build_object('ok',true,'authorization_id',v_id,'status','En revisión','duplicate',false,'authorized',false,
    'executed',false,'simulation_only',true,'valid_until',v_until);
end $$;

create or replace function public.resolver_autorizacion_inversion_meta(p_authorization_id bigint,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_auth public.agency_meta_investment_authorizations%rowtype;
  v_scenario public.agency_meta_investment_scenarios%rowtype; v_campaign public.campaigns%rowtype; v_settings public.agency_settings%rowtype;
  v_ops jsonb; v_note text:=btrim(coalesce(p_note,'')); v_status text; v_job bigint;
begin
  v_actor:=public._agency_actor();
  if public.has_current_role('Administrador') is not true then raise exception 'Solo Administración autoriza inversión.'; end if;
  select * into v_auth from public.agency_meta_investment_authorizations where id=p_authorization_id for update;
  if v_auth.id is null or v_auth.status<>'En revisión' then raise exception 'La solicitud no espera revisión humana.'; end if;
  if p_decision not in ('Autorizar','Devolver','Rechazar') or length(v_note)<16 then raise exception 'La decisión necesita una nota humana de al menos 16 caracteres.'; end if;
  if p_decision='Autorizar' then
    if v_auth.valid_until<=now() then update public.agency_meta_investment_authorizations set status='Vencida',reviewed_by=v_actor.id,reviewed_at=now(),review_note='Venció antes de autorizar.' where id=v_auth.id;
      raise exception 'La solicitud venció antes de ser autorizada.'; end if;
    select * into v_scenario from public.agency_meta_investment_scenarios where id=v_auth.scenario_id;
    if v_scenario.status<>'Aprobado' or exists(select 1 from public.agency_meta_investment_scenarios s where s.measurement_id=v_scenario.measurement_id and s.prepared_at>v_scenario.prepared_at) then
      raise exception 'El escenario aprobado ya no es el vigente.'; end if;
    select * into v_campaign from public.campaigns where id=v_auth.campaign_id;
    select * into v_settings from public.agency_settings where id;
    if v_settings.paused or v_auth.target_budget>v_settings.campaign_budget_limit
       or (v_auth.target_budget>v_campaign.presupuesto and v_auth.target_budget-v_campaign.presupuesto>v_settings.daily_budget_limit) then
      raise exception 'La autorización ya no cabe en los límites vigentes.'; end if;
    if v_campaign.presupuesto is distinct from (v_auth.sealed_snapshot#>>'{campaign,current_budget}')::numeric
       or v_campaign.external_id is distinct from v_auth.sealed_snapshot#>>'{campaign,external_id}' then
      raise exception 'La campaña cambió después de solicitar el permiso.'; end if;
    v_ops:=public._meta_investment_ops_snapshot(v_auth.measurement_id);
    if coalesce((v_ops#>>'{operations,stock_blocked}')::boolean,true) and v_auth.selected_option<>'Reducir' then
      raise exception 'El stock actual bloquea esta alternativa.'; end if;
    update public.agency_meta_investment_authorizations set status='Autorizada',authorized_by=v_actor.id,authorized_at=now(),
      reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_auth.id;
    insert into public.agency_meta_investment_execution_jobs(authorization_id,attempt,idempotency_key,execution_mode,status,sealed_snapshot,snapshot_fingerprint)
    values(v_auth.id,1,'momos:meta-investment:'||v_auth.id::text||':1','Simulación','Autorizado',v_auth.sealed_snapshot,v_auth.snapshot_fingerprint)
    on conflict(authorization_id,attempt) do update set updated_at=excluded.updated_at returning id into v_job;
    perform public._add_audit('Autorización Meta',v_auth.id::text,'Permiso autorizado','',v_auth.selected_option||' · solo Simulación');
    return jsonb_build_object('ok',true,'authorization_id',v_auth.id,'job_id',v_job,'status','Autorizada','authorized',true,
      'executed',false,'simulation_only',true,'idempotency_key','momos:meta-investment:'||v_auth.id::text||':1');
  end if;
  v_status:=case p_decision when 'Devolver' then 'Devuelta' else 'Rechazada' end;
  update public.agency_meta_investment_authorizations set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_auth.id;
  perform public._add_audit('Autorización Meta',v_auth.id::text,'Permiso '||lower(v_status),'',left(v_note,180));
  return jsonb_build_object('ok',true,'authorization_id',v_auth.id,'status',v_status,'authorized',false,'executed',false,'simulation_only',true);
end $$;

create or replace function public.revocar_autorizacion_inversion_meta(p_authorization_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_auth public.agency_meta_investment_authorizations%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  v_actor:=public._agency_actor();
  if public.has_current_role('Administrador') is not true then raise exception 'Solo Administración revoca permisos de inversión.'; end if;
  if length(v_reason)<16 then raise exception 'Explicá por qué se revoca el permiso.'; end if;
  select * into v_auth from public.agency_meta_investment_authorizations where id=p_authorization_id for update;
  if v_auth.status not in ('En revisión','Autorizada') then raise exception 'El permiso ya no admite revocación.'; end if;
  if exists(select 1 from public.agency_meta_investment_execution_jobs where authorization_id=v_auth.id and status in ('Despachando','Incierto')) then
    raise exception 'El intento ya fue despachado o quedó incierto; primero hay que conciliarlo.'; end if;
  update public.agency_meta_investment_execution_jobs set status='Cancelado',lease_token=null,lease_expires_at=null,
    error_message='Autorización revocada antes del despacho.',completed_at=now(),updated_at=now()
    where authorization_id=v_auth.id and status in ('Autorizado','Arrendado');
  update public.agency_meta_investment_authorizations set status='Revocada',revoked_by=v_actor.id,revoked_at=now(),revoke_reason=v_reason where id=v_auth.id;
  perform public._add_audit('Autorización Meta',v_auth.id::text,'Permiso revocado','',left(v_reason,180));
  return jsonb_build_object('ok',true,'authorization_id',v_auth.id,'status','Revocada','executed',false,'simulation_only',true);
end $$;

create or replace function public._invalidar_autorizaciones_meta_por_escenario() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  update public.agency_meta_investment_execution_jobs j set status='Cancelado',lease_token=null,lease_expires_at=null,
    error_message='Evidencia operativa sustituida antes del despacho.',completed_at=now(),updated_at=now()
  from public.agency_meta_investment_authorizations a
  where j.authorization_id=a.id and a.measurement_id=new.measurement_id and a.scenario_id<>new.id and j.status in ('Autorizado','Arrendado');
  update public.agency_meta_investment_authorizations set status='Sustituida',review_note='Nueva evidencia operativa invalidó el permiso antes del despacho.'
  where measurement_id=new.measurement_id and scenario_id<>new.id and status in ('En revisión','Autorizada')
    and not exists(select 1 from public.agency_meta_investment_execution_jobs j
      where j.authorization_id=agency_meta_investment_authorizations.id and j.status in ('Despachando','Incierto'));
  return new;
end $$;
drop trigger if exists invalidate_meta_authorizations_on_scenario on public.agency_meta_investment_scenarios;
create trigger invalidate_meta_authorizations_on_scenario after insert on public.agency_meta_investment_scenarios
for each row execute function public._invalidar_autorizaciones_meta_por_escenario();

create or replace function public.reclamar_simulacion_inversion_meta(p_worker_id text,p_lease_minutes integer default 5) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_worker text:=btrim(coalesce(p_worker_id,'')); v_job public.agency_meta_investment_execution_jobs%rowtype;
  v_auth public.agency_meta_investment_authorizations%rowtype; v_token uuid:=gen_random_uuid();
begin
  if v_worker !~ '^[A-Za-z0-9._:-]{3,120}$' or p_lease_minutes not between 1 and 10 then raise exception 'Worker o lease inválido.'; end if;
  update public.agency_meta_investment_authorizations set status='Vencida',review_note='El permiso venció sin ser consumido.'
    where status in ('En revisión','Autorizada') and valid_until<=now();
  update public.agency_meta_investment_execution_jobs j set status='Cancelado',lease_token=null,lease_expires_at=null,
    error_message='La autorización venció.',completed_at=now(),updated_at=now()
    where j.status in ('Autorizado','Arrendado') and exists(select 1 from public.agency_meta_investment_authorizations a where a.id=j.authorization_id and a.status='Vencida');
  update public.agency_meta_investment_execution_jobs j set status='Fallido',lease_token=null,lease_expires_at=null,
    error_message='El worker perdió el lease antes de despachar.',completed_at=now(),updated_at=now()
    where j.status='Arrendado' and j.lease_expires_at<=now();
  update public.agency_meta_investment_authorizations a set status='Fallida',review_note='El worker perdió el lease antes de despachar.'
    where a.status='Autorizada' and exists(select 1 from public.agency_meta_investment_execution_jobs j where j.authorization_id=a.id and j.status='Fallido');
  update public.agency_meta_investment_execution_jobs j set status='Incierto',lease_token=null,lease_expires_at=null,
    error_message='El worker se perdió después de marcar el despacho; no se reenviará.',updated_at=now()
    where j.status='Despachando' and j.lease_expires_at<=now();
  update public.agency_meta_investment_authorizations a set status='Incierta',review_note='Despacho incierto pendiente de conciliación; reenvío bloqueado.'
    where a.status='Autorizada' and exists(select 1 from public.agency_meta_investment_execution_jobs j where j.authorization_id=a.id and j.status='Incierto');
  select j.* into v_job from public.agency_meta_investment_execution_jobs j join public.agency_meta_investment_authorizations a on a.id=j.authorization_id
    join public.agency_meta_investment_scenarios s on s.id=a.scenario_id
    where j.status='Autorizado' and a.status='Autorizada' and a.valid_until>now() and s.status='Aprobado'
      and not exists(select 1 from public.agency_meta_investment_scenarios newer where newer.measurement_id=s.measurement_id and newer.prepared_at>s.prepared_at)
    order by a.valid_until,j.id for update of j skip locked limit 1;
  if v_job.id is null then return '{}'::jsonb; end if;
  select * into v_auth from public.agency_meta_investment_authorizations where id=v_job.authorization_id;
  if v_job.snapshot_fingerprint<>public._agency_mesa_fingerprint(v_job.sealed_snapshot)
     or v_auth.snapshot_fingerprint<>v_job.snapshot_fingerprint then raise exception 'El contrato perdió integridad.'; end if;
  update public.agency_meta_investment_execution_jobs set status='Arrendado',worker_id=v_worker,lease_token=v_token,
    lease_expires_at=now()+make_interval(mins=>p_lease_minutes),updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'authorization_id',v_job.authorization_id,'lease_token',v_token,
    'idempotency_key',v_job.idempotency_key,'snapshot',v_job.sealed_snapshot,'simulation_only',true,'external_http_forbidden',true);
end $$;

create or replace function public.marcar_despacho_simulacion_inversion_meta(p_job_id bigint,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.agency_meta_investment_execution_jobs%rowtype; v_auth public.agency_meta_investment_authorizations%rowtype;
  v_scenario public.agency_meta_investment_scenarios%rowtype;
begin
  select * into v_job from public.agency_meta_investment_execution_jobs where id=p_job_id for update;
  if v_job.status='Despachando' and v_job.lease_token=p_lease_token then return jsonb_build_object('ok',true,'job_id',v_job.id,'duplicate',true,
    'idempotency_key',v_job.idempotency_key,'simulation_only',true,'external_http_forbidden',true); end if;
  if v_job.id is null or v_job.status<>'Arrendado' or v_job.lease_token is distinct from p_lease_token or v_job.lease_expires_at<=now() then
    raise exception 'Lease inválido o vencido.'; end if;
  select * into v_auth from public.agency_meta_investment_authorizations where id=v_job.authorization_id;
  select * into v_scenario from public.agency_meta_investment_scenarios where id=v_auth.scenario_id;
  if v_auth.status<>'Autorizada' or v_auth.valid_until<=now() or v_scenario.status<>'Aprobado'
     or exists(select 1 from public.agency_meta_investment_scenarios s where s.measurement_id=v_scenario.measurement_id and s.prepared_at>v_scenario.prepared_at) then
    raise exception 'La autorización dejó de estar vigente antes del despacho.'; end if;
  update public.agency_meta_investment_execution_jobs set status='Despachando',dispatched_at=now(),updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'duplicate',false,'idempotency_key',v_job.idempotency_key,
    'simulation_only',true,'external_http_forbidden',true,'instruction','Calcular dry-run; no llamar APIs ni mutar Meta.');
end $$;

create or replace function public.registrar_resultado_simulacion_inversion_meta(p_job_id bigint,p_lease_token uuid,p_result text,p_receipt jsonb default '{}'::jsonb,p_error text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.agency_meta_investment_execution_jobs%rowtype; v_status text; v_auth_status text; v_error text:=btrim(coalesce(p_error,''));
begin
  select * into v_job from public.agency_meta_investment_execution_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El intento no existe.'; end if;
  if v_job.status in ('Simulado','Fallido','Incierto') and v_job.status=p_result then return jsonb_build_object('ok',true,'job_id',v_job.id,
    'status',v_job.status,'duplicate',true,'retry_blocked',v_job.status='Incierto','executed',false); end if;
  if v_job.status<>'Despachando' or v_job.lease_token is distinct from p_lease_token or v_job.lease_expires_at<=now() then raise exception 'El lease no concilia este intento.'; end if;
  if p_result not in ('Simulado','Fallido','Incierto') then raise exception 'H40 solo admite simulación, fallo o incertidumbre.'; end if;
  if public._agency_mesa_has_secret(coalesce(p_receipt,'{}'::jsonb)) then raise exception 'El recibo contiene secretos.'; end if;
  if p_result='Simulado' and (coalesce((p_receipt->>'dry_run')::boolean,false) is not true
     or coalesce((p_receipt->>'external_mutation')::boolean,false) is true or p_receipt ? 'external_change_id') then
    raise exception 'La simulación no demuestra que evitó cambios externos.'; end if;
  if p_result in ('Fallido','Incierto') and length(v_error)<8 then raise exception 'Explicá el fallo o la incertidumbre.'; end if;
  v_status:=p_result; v_auth_status:=case p_result when 'Simulado' then 'Simulada' when 'Fallido' then 'Fallida' else 'Incierta' end;
  update public.agency_meta_investment_execution_jobs set status=v_status,receipt=coalesce(p_receipt,'{}'::jsonb),error_message=v_error,
    completed_at=case when p_result='Incierto' then null else now() end,lease_token=null,lease_expires_at=null,updated_at=now() where id=v_job.id;
  update public.agency_meta_investment_authorizations set status=v_auth_status,
    review_note=case when p_result='Incierto' then 'Resultado incierto; no reenviar automáticamente. '||v_error else review_note end
    where id=v_job.authorization_id;
  perform public._add_audit('Autorización Meta',v_job.authorization_id::text,'Simulación '||lower(v_status),'',left(coalesce(v_error,p_result),180));
  return jsonb_build_object('ok',true,'job_id',v_job.id,'authorization_id',v_job.authorization_id,'status',v_status,'duplicate',false,
    'retry_blocked',p_result='Incierto','executed',false,'simulation_only',true);
end $$;

do $$ declare v_name text; begin
  foreach v_name in array array['_meta_authorization_guard()','_meta_execution_guard()','_invalidar_autorizaciones_meta_por_escenario()'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',v_name); end loop;
end $$;
revoke all on function public.autorizacion_inversion_meta_disponible() from public,anon;
revoke all on function public.solicitar_autorizacion_inversion_meta(jsonb) from public,anon;
revoke all on function public.resolver_autorizacion_inversion_meta(bigint,text,text) from public,anon;
revoke all on function public.revocar_autorizacion_inversion_meta(bigint,text) from public,anon;
revoke all on function public.reclamar_simulacion_inversion_meta(text,integer) from public,anon,authenticated;
revoke all on function public.marcar_despacho_simulacion_inversion_meta(bigint,uuid) from public,anon,authenticated;
revoke all on function public.registrar_resultado_simulacion_inversion_meta(bigint,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.autorizacion_inversion_meta_disponible() to authenticated;
grant execute on function public.solicitar_autorizacion_inversion_meta(jsonb) to authenticated;
grant execute on function public.resolver_autorizacion_inversion_meta(bigint,text,text) to authenticated;
grant execute on function public.revocar_autorizacion_inversion_meta(bigint,text) to authenticated;
grant execute on function public.reclamar_simulacion_inversion_meta(text,integer) to service_role;
grant execute on function public.marcar_despacho_simulacion_inversion_meta(bigint,uuid) to service_role;
grant execute on function public.registrar_resultado_simulacion_inversion_meta(bigint,uuid,text,jsonb,text) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_meta_investment_authorizations') then
      alter publication supabase_realtime add table public.agency_meta_investment_authorizations; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_meta_investment_execution_jobs') then
      alter publication supabase_realtime add table public.agency_meta_investment_execution_jobs; end if;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_40_autorizacion_inversion','Permiso Meta exacto, corto e idempotente con simulación, lease e incertidumbre sin ejecutar pauta')
on conflict(id) do update set detalle=excluded.detalle;

commit;
