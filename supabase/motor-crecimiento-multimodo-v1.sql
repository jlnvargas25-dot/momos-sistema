-- MOMOS OPS · motor determinístico de crecimiento multimodo v1.
-- Paso 53. Sella cuatro estrategias compatibles con la operación, separa Pauta
-- de Orgánico y registra la elección humana. No publica, pauta, gasta ni reserva stock.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260717'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260717_52_catalogo_figuras_toby'
  ) then raise exception 'Falta el paso 52_catalogo_figuras_toby.'; end if;
  if to_regclass('public.agency_brand_profiles') is null or to_regclass('public.agency_briefs') is null then
    raise exception 'Falta la gobernanza de marca o Agencia Comercial.';
  end if;
end $$;

create table if not exists public.agency_growth_mode_policies(
  mode_key text primary key check(mode_key in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje')),
  label text not null check(length(btrim(label)) between 5 and 100),
  channel_mode text not null check(channel_mode in ('Mixto','Orgánico','Pauta')),
  objective text not null check(length(btrim(objective)) between 20 and 400),
  controls jsonb not null check(jsonb_typeof(controls)='object'),
  version integer not null default 1 check(version>0),
  active boolean not null default true,
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now(),
  constraint agency_growth_policy_no_execution check(
    coalesce((controls->>'external_execution')::boolean,false)=false
    and coalesce((controls->>'human_decision_required')::boolean,true)=true
  )
);

create table if not exists public.agency_growth_snapshots(
  id bigint generated always as identity primary key,
  snapshot_key text not null unique check(snapshot_key ~ '^growth:[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9-]{3,80}$'),
  engine_version integer not null check(engine_version=1),
  generated_for date not null,
  facts jsonb not null check(jsonb_typeof(facts)='object'),
  modes jsonb not null check(jsonb_typeof(modes)='array' and jsonb_array_length(modes)=4),
  recommended_mode text not null check(recommended_mode in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje')),
  policy_snapshot jsonb not null check(jsonb_typeof(policy_snapshot)='object'),
  snapshot_fingerprint text not null unique check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text not null references public.users(id),
  prepared_at timestamptz not null default now(),
  constraint agency_growth_snapshot_no_secret check(
    (facts::text||modes::text||policy_snapshot::text) !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role|phone|telefono|email|address|direccion)"[[:space:]]*:'
  ),
  constraint agency_growth_snapshot_no_execution check(
    coalesce((policy_snapshot->>'externalExecution')::boolean,false)=false
    and coalesce((policy_snapshot->>'humanDecisionRequired')::boolean,true)=true
  )
);
create index if not exists agency_growth_snapshots_day_idx on public.agency_growth_snapshots(generated_for desc,id desc);

create table if not exists public.agency_growth_selections(
  id bigint generated always as identity primary key,
  snapshot_id bigint not null unique references public.agency_growth_snapshots(id) on delete restrict,
  mode_key text not null check(mode_key in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje')),
  objective text not null check(length(btrim(objective)) between 10 and 300),
  status text not null default 'Seleccionado' check(status='Seleccionado'),
  selected_by text not null references public.users(id),
  selected_at timestamptz not null default now(),
  external_execution boolean not null default false check(external_execution=false)
);
create index if not exists agency_growth_selections_mode_idx on public.agency_growth_selections(mode_key,selected_at desc);

alter table public.agency_growth_mode_policies enable row level security;
alter table public.agency_growth_snapshots enable row level security;
alter table public.agency_growth_selections enable row level security;
drop policy if exists staff_read on public.agency_growth_mode_policies;
drop policy if exists staff_read on public.agency_growth_snapshots;
drop policy if exists staff_read on public.agency_growth_selections;
create policy staff_read on public.agency_growth_mode_policies for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_growth_snapshots for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_growth_selections for select to authenticated using(public.is_staff());
revoke all on public.agency_growth_mode_policies,public.agency_growth_snapshots,public.agency_growth_selections from public,anon,authenticated;
grant select on public.agency_growth_mode_policies,public.agency_growth_snapshots,public.agency_growth_selections to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_growth_snapshots') then
      alter publication supabase_realtime add table public.agency_growth_snapshots; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_growth_selections') then
      alter publication supabase_realtime add table public.agency_growth_selections; end if;
  end if;
end $$;

create or replace function public._agency_growth_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or not (
    'Administrador'=any(coalesce(v_actor.roles,array[v_actor.rol]))
    or 'Marketing/CRM'=any(coalesce(v_actor.roles,array[v_actor.rol]))
  ) then raise exception 'Tu rol no puede preparar estrategias de crecimiento.'; end if;
  return v_actor;
end $$;

create or replace function public.motor_crecimiento_multimodo_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public.registrar_snapshot_motor_crecimiento(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_key text:=btrim(coalesce(p->>'snapshot_key',''));
  v_modes jsonb:=coalesce(p->'modes','[]'::jsonb); v_facts jsonb:=coalesce(p->'facts','{}'::jsonb);
  v_policy jsonb:=coalesce(p->'policy','{}'::jsonb); v_recommended text:=btrim(coalesce(p->>'recommended_mode',''));
  v_sealed jsonb; v_fingerprint text; v_existing public.agency_growth_snapshots%rowtype; v_id bigint;
begin
  v_actor:=public._agency_growth_actor();
  if v_key !~ '^growth:[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9-]{3,80}$' then raise exception 'snapshot_key inválida.'; end if;
  if coalesce((p->>'engine_version')::int,0)<>1 then raise exception 'Versión del motor no soportada.'; end if;
  if jsonb_typeof(v_facts)<>'object' or jsonb_typeof(v_modes)<>'array' or jsonb_array_length(v_modes)<>4 then
    raise exception 'El snapshot necesita hechos y los cuatro modos.'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(v_modes))<>4
     or exists(select 1 from jsonb_array_elements(v_modes) m where m->>'id' not in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje')) then
    raise exception 'Los modos están incompletos, duplicados o fuera de la lista cerrada.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_modes) m where m->>'id'='marca-comunidad' and m->>'channel'='Orgánico')
     or not exists(select 1 from jsonb_array_elements(v_modes) m where m->>'id'='pauta-aprendizaje' and m->>'channel'='Pauta') then
    raise exception 'Pauta y Orgánico deben permanecer separados.'; end if;
  if v_recommended not in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje') then raise exception 'Recomendación inválida.'; end if;
  if coalesce((v_policy->>'externalExecution')::boolean,true) or coalesce((v_policy->>'humanDecisionRequired')::boolean,false) is not true then
    raise exception 'El motor no puede ejecutar y siempre requiere decisión humana.'; end if;
  if coalesce((v_facts->>'exactStockUnits')::numeric,-1)<0 or coalesce((v_facts->>'paidOrders30d')::numeric,-1)<0
     or coalesce((v_facts->>'productionUnits')::numeric,-1)<0 then raise exception 'Los hechos operativos no pueden ser negativos ni faltar.'; end if;
  if (v_facts::text||v_modes::text||v_policy::text) ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role|phone|telefono|email|address|direccion)"[[:space:]]*:' then
    raise exception 'El snapshot contiene PII o secretos.'; end if;
  if (v_modes::text||v_policy::text) ~* '"(execute|executed|publish|published|spend|external_execution)"[[:space:]]*:[[:space:]]*(true|[1-9])' then
    raise exception 'El snapshot intentó ejecutar, publicar o gastar.'; end if;
  v_sealed:=jsonb_build_object('engine_version',1,'generated_for',p->>'generated_for','facts',v_facts,'modes',v_modes,
    'recommended_mode',v_recommended,'policy',v_policy);
  v_fingerprint:=md5(v_sealed::text);
  select * into v_existing from public.agency_growth_snapshots where snapshot_key=v_key;
  if v_existing.id is not null then
    if v_existing.snapshot_fingerprint<>v_fingerprint then raise exception 'La misma clave ya fue sellada con otros hechos.'; end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'idempotent',true,'external_execution',false);
  end if;
  insert into public.agency_growth_snapshots(snapshot_key,engine_version,generated_for,facts,modes,recommended_mode,policy_snapshot,snapshot_fingerprint,prepared_by)
  values(v_key,1,(p->>'generated_for')::date,v_facts,v_modes,v_recommended,v_policy,v_fingerprint,v_actor.id) returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'idempotent',false,'external_execution',false);
end $$;

create or replace function public.seleccionar_modo_crecimiento(p_snapshot_id bigint,p_mode_key text,p_objective text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_snapshot public.agency_growth_snapshots%rowtype;
  v_existing public.agency_growth_selections%rowtype; v_objective text:=btrim(coalesce(p_objective,'')); v_id bigint;
begin
  v_actor:=public._agency_growth_actor();
  select * into v_snapshot from public.agency_growth_snapshots where id=p_snapshot_id for share;
  if v_snapshot.id is null then raise exception 'El snapshot no existe.'; end if;
  if p_mode_key not in ('venta-inmediata','conquistar-demanda','marca-comunidad','pauta-aprendizaje')
     or not exists(select 1 from jsonb_array_elements(v_snapshot.modes) m where m->>'id'=p_mode_key) then raise exception 'Modo no incluido en el snapshot.'; end if;
  if length(v_objective) not between 10 and 300 then raise exception 'Explicá el objetivo en una frase breve.'; end if;
  if v_objective ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' or v_objective ~ '[0-9]{7,}' then raise exception 'El objetivo no debe contener datos personales.'; end if;
  select * into v_existing from public.agency_growth_selections where snapshot_id=p_snapshot_id;
  if v_existing.id is not null then
    if v_existing.mode_key<>p_mode_key or v_existing.objective<>v_objective then raise exception 'La elección ya quedó sellada; prepará un snapshot nuevo para cambiarla.'; end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'idempotent',true,'external_execution',false);
  end if;
  insert into public.agency_growth_selections(snapshot_id,mode_key,objective,selected_by)
  values(p_snapshot_id,p_mode_key,v_objective,v_actor.id) returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'idempotent',false,'external_execution',false);
end $$;

insert into public.agency_growth_mode_policies(mode_key,label,channel_mode,objective,controls,updated_by)
select mode_key,label,channel_mode,objective,controls,(select id from public.users where activo and ('Administrador'=any(coalesce(roles,array[rol]))) order by id limit 1)
from (values
  ('venta-inmediata','Vender lo que está listo','Mixto','Convertir disponibilidad exacta vigente sin crear faltantes.',jsonb_build_object('external_execution',false,'human_decision_required',true,'exact_stock_required',true)),
  ('conquistar-demanda','Salir a conquistar demanda','Mixto','Abrir demanda y convertirla en capacidad verificable de Producción.',jsonb_build_object('external_execution',false,'human_decision_required',true,'production_gate_required',true)),
  ('marca-comunidad','Construir marca y comunidad','Orgánico','Crear memoria y conversación sin depender del inventario del día.',jsonb_build_object('external_execution',false,'human_decision_required',true,'brand_gate_required',true)),
  ('pauta-aprendizaje','Probar y escalar con pauta','Pauta','Comparar ángulos y escalar únicamente beneficio incremental demostrado.',jsonb_build_object('external_execution',false,'human_decision_required',true,'measurement_gate_required',true))
) as seed(mode_key,label,channel_mode,objective,controls)
on conflict(mode_key) do update set label=excluded.label,channel_mode=excluded.channel_mode,objective=excluded.objective,
  controls=excluded.controls,version=public.agency_growth_mode_policies.version+1,updated_by=excluded.updated_by,updated_at=now()
where (public.agency_growth_mode_policies.label,public.agency_growth_mode_policies.channel_mode,
  public.agency_growth_mode_policies.objective,public.agency_growth_mode_policies.controls)
  is distinct from (excluded.label,excluded.channel_mode,excluded.objective,excluded.controls);

revoke all on function public._agency_growth_actor() from public,anon,authenticated,service_role;
revoke all on function public.motor_crecimiento_multimodo_disponible() from public,anon;
revoke all on function public.registrar_snapshot_motor_crecimiento(jsonb) from public,anon;
revoke all on function public.seleccionar_modo_crecimiento(bigint,text,text) from public,anon;
grant execute on function public.motor_crecimiento_multimodo_disponible() to authenticated,service_role;
grant execute on function public.registrar_snapshot_motor_crecimiento(jsonb) to authenticated;
grant execute on function public.seleccionar_modo_crecimiento(bigint,text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_53_motor_crecimiento_multimodo','Cuatro modos de crecimiento, Pauta/Orgánico separados, capacidad protegida y elección humana trazable')
on conflict(id) do update set detalle=excluded.detalle;
commit;
