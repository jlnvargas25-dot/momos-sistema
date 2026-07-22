-- MOMOS OPS · Estudio creativo por escenas v1.
-- Paso 31. Convierte un contrato aprobado en storyboard y tomas versionadas.
-- No genera, no gasta y no publica.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_30_mesa_agencia'
  ) then raise exception 'Falta el paso 30_mesa_agencia.'; end if;
end $$;

create table if not exists public.agency_storyboards(
  id bigint generated always as identity primary key,
  storyboard_key text not null unique check(storyboard_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  contract_id bigint not null references public.agency_creative_contracts(id) on delete restrict,
  version integer not null check(version>0),
  title text not null check(length(btrim(title)) between 3 and 180),
  status text not null default 'Borrador' check(status in ('Borrador','En revisión','Aprobado','Sustituido','Anulado')),
  channel text not null check(length(btrim(channel)) between 2 and 60),
  format text not null check(length(btrim(format)) between 2 and 60),
  aspect_ratio text not null check(aspect_ratio in ('9:16','1:1','4:5','16:9')),
  target_duration_sec numeric(8,2) not null check(target_duration_sec between 1 and 600),
  creative_brief jsonb not null check(jsonb_typeof(creative_brief)='object'),
  retention_plan jsonb not null check(jsonb_typeof(retention_plan)='object'),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{32}$'),
  estimated_cost_cop numeric(14,2) not null default 0 check(estimated_cost_cop>=0),
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  submitted_by text references public.users(id), submitted_at timestamptz,
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(contract_id,version), unique(contract_id,source_fingerprint)
);
create index if not exists agency_storyboards_status_idx on public.agency_storyboards(status,created_at desc);

create table if not exists public.agency_storyboard_shots(
  id bigint generated always as identity primary key,
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  shot_number integer not null check(shot_number between 1 and 200),
  revision integer not null check(revision>0),
  status text not null default 'Vigente' check(status in ('Vigente','Sustituida','Anulada')),
  title text not null check(length(btrim(title)) between 2 and 160),
  purpose text not null check(length(btrim(purpose)) between 2 and 600),
  duration_sec numeric(8,2) not null check(duration_sec between 0.1 and 120),
  shot_payload jsonb not null check(jsonb_typeof(shot_payload)='object'),
  input_asset_ids bigint[] not null default '{}'::bigint[],
  estimated_cost_cop numeric(14,2) not null default 0 check(estimated_cost_cop>=0),
  shot_fingerprint text not null check(shot_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  unique(storyboard_id,shot_number,revision), unique(storyboard_id,shot_number,shot_fingerprint)
);
create unique index if not exists agency_storyboard_shots_one_current_idx
  on public.agency_storyboard_shots(storyboard_id,shot_number) where status='Vigente';
create index if not exists agency_storyboard_shots_board_idx on public.agency_storyboard_shots(storyboard_id,shot_number,revision desc);

alter table public.agency_storyboards enable row level security;
alter table public.agency_storyboard_shots enable row level security;
drop policy if exists staff_read on public.agency_storyboards;
drop policy if exists staff_read on public.agency_storyboard_shots;
create policy staff_read on public.agency_storyboards for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_storyboard_shots for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_storyboards,public.agency_storyboard_shots from anon,authenticated;
grant select on public.agency_storyboards,public.agency_storyboard_shots to authenticated;

create or replace function public.estudio_escenas_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._storyboard_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.storyboard_key is distinct from old.storyboard_key or new.contract_id is distinct from old.contract_id
     or new.version is distinct from old.version or new.title is distinct from old.title
     or new.channel is distinct from old.channel or new.format is distinct from old.format
     or new.aspect_ratio is distinct from old.aspect_ratio or new.target_duration_sec is distinct from old.target_duration_sec
     or new.creative_brief is distinct from old.creative_brief or new.retention_plan is distinct from old.retention_plan
     or new.source_snapshot is distinct from old.source_snapshot or new.source_fingerprint is distinct from old.source_fingerprint
     or new.estimated_cost_cop is distinct from old.estimated_cost_cop or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'El plan sellado del storyboard no se puede reescribir; creá una nueva versión.';
  end if;
  return new;
end $$;
drop trigger if exists agency_storyboards_immutable on public.agency_storyboards;
create trigger agency_storyboards_immutable before update on public.agency_storyboards
for each row execute function public._storyboard_immutable();

create or replace function public._storyboard_shot_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Las revisiones de toma no se eliminan.'; end if;
  if new.storyboard_id is distinct from old.storyboard_id or new.shot_number is distinct from old.shot_number
     or new.revision is distinct from old.revision or new.title is distinct from old.title
     or new.purpose is distinct from old.purpose or new.duration_sec is distinct from old.duration_sec
     or new.shot_payload is distinct from old.shot_payload or new.input_asset_ids is distinct from old.input_asset_ids
     or new.estimated_cost_cop is distinct from old.estimated_cost_cop or new.shot_fingerprint is distinct from old.shot_fingerprint
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'La revisión de una toma es inmutable; guardá una revisión nueva.';
  end if;
  return new;
end $$;
drop trigger if exists agency_storyboard_shots_immutable on public.agency_storyboard_shots;
create trigger agency_storyboard_shots_immutable before update or delete on public.agency_storyboard_shots
for each row execute function public._storyboard_shot_immutable();

create or replace function public._storyboard_errors(p_storyboard_id bigint) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare v_board public.agency_storyboards%rowtype; v_contract public.agency_creative_contracts%rowtype;
  v_errors text[]:='{}'::text[]; v_count integer; v_min integer; v_max integer; v_sum numeric; v_loop jsonb;
begin
  select * into v_board from public.agency_storyboards where id=p_storyboard_id;
  if v_board.id is null then return array['El storyboard no existe.']; end if;
  select * into v_contract from public.agency_creative_contracts where id=v_board.contract_id;
  if v_contract.id is null or v_contract.status<>'Aprobado' then v_errors:=array_append(v_errors,'El contrato creativo dejó de estar aprobado.'); end if;
  select count(*),min(shot_number),max(shot_number),coalesce(sum(duration_sec),0)
    into v_count,v_min,v_max,v_sum from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente';
  if v_count=0 then v_errors:=array_append(v_errors,'Falta al menos una toma vigente.');
  elsif v_min<>1 or v_max<>v_count then v_errors:=array_append(v_errors,'Las tomas deben ser consecutivas desde la número 1.'); end if;
  if v_count>0 and abs(v_sum-v_board.target_duration_sec)>0.51 then
    v_errors:=array_append(v_errors,format('Las tomas suman %s s y el objetivo es %s s.',v_sum,v_board.target_duration_sec));
  end if;
  if exists(select 1 from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente' and (
      length(btrim(coalesce(shot_payload->>'subject','')))<2 or length(btrim(coalesce(shot_payload->>'action','')))<2
      or length(btrim(coalesce(shot_payload->>'camera','')))<2 or length(btrim(coalesce(shot_payload->>'continuity_out','')))<2)) then
    v_errors:=array_append(v_errors,'Hay tomas sin sujeto, acción, cámara o continuidad de salida.');
  end if;
  if coalesce(jsonb_typeof(v_board.retention_plan->'loops'),'')<>'array' then
    v_errors:=array_append(v_errors,'Falta al menos un loop de retención con payoff.');
  elsif jsonb_array_length(v_board.retention_plan->'loops')=0 then
    v_errors:=array_append(v_errors,'Falta al menos un loop de retención con payoff.');
  else
    for v_loop in select value from jsonb_array_elements(v_board.retention_plan->'loops') loop
      if length(btrim(coalesce(v_loop->>'promise','')))<2 or length(btrim(coalesce(v_loop->>'payoff','')))<2
         or coalesce(nullif(v_loop->>'open_sec','')::numeric,-1)<0
         or coalesce(nullif(v_loop->>'close_sec','')::numeric,-1)<coalesce(nullif(v_loop->>'open_sec','')::numeric,0)
         or coalesce(nullif(v_loop->>'close_sec','')::numeric,999999)>v_board.target_duration_sec then
        v_errors:=array_append(v_errors,'Hay un loop sin promesa, payoff o cierre válido.'); exit;
      end if;
    end loop;
  end if;
  if exists(
    select 1 from public.agency_storyboard_shots s,unnest(s.input_asset_ids) asset_id
    left join public.brand_media_assets a on a.id=asset_id
    where s.storyboard_id=v_board.id and s.status='Vigente'
      and (a.id is null or a.status<>'Activo' or a.rights_status<>'Autorizado' or not a.ai_use_allowed
        or (a.rights_expires_at is not null and a.rights_expires_at<current_date))
  ) then v_errors:=array_append(v_errors,'Una toma usa activos inexistentes, archivados o sin derechos vigentes para IA.'); end if;
  return v_errors;
end $$;

create or replace function public.crear_storyboard_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_contract public.agency_creative_contracts%rowtype; v_room public.agency_collaboration_rooms%rowtype;
  v_id bigint; v_existing public.agency_storyboards%rowtype; v_version integer; v_source jsonb; v_fingerprint text;
  v_key text:=btrim(coalesce(p->>'storyboard_key','')); v_contract_id bigint:=nullif(p->>'contract_id','')::bigint;
  v_title text:=btrim(coalesce(p->>'title','')); v_channel text:=btrim(coalesce(p->>'channel',''));
  v_format text:=btrim(coalesce(p->>'format','')); v_ratio text:=btrim(coalesce(p->>'aspect_ratio',''));
  v_duration numeric:=coalesce(nullif(p->>'target_duration_sec','')::numeric,0); v_cost numeric:=coalesce(nullif(p->>'estimated_cost_cop','')::numeric,0);
  v_brief jsonb:=coalesce(p->'creative_brief','{}'::jsonb); v_retention jsonb:=coalesce(p->'retention_plan','{}'::jsonb);
begin
  v_actor:=public._agency_actor();
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El storyboard es inválido o contiene secretos.'; end if;
  select * into v_contract from public.agency_creative_contracts where id=v_contract_id for update;
  if v_contract.id is null or v_contract.status<>'Aprobado' then raise exception 'El Estudio solo abre desde un contrato creativo aprobado.'; end if;
  select * into v_room from public.agency_collaboration_rooms where id=v_contract.room_id;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or length(v_title) not between 3 and 180 or length(v_channel) not between 2 and 60
     or length(v_format) not between 2 and 60 or v_ratio not in ('9:16','1:1','4:5','16:9') or v_duration not between 1 and 600
     or v_cost<0 or jsonb_typeof(v_brief)<>'object' or jsonb_typeof(v_retention)<>'object' then raise exception 'La ficha del storyboard no cumple el contrato.'; end if;
  if length(btrim(coalesce(v_brief->>'hook','')))<2 or length(btrim(coalesce(v_brief->>'payoff','')))<2
     or length(btrim(coalesce(v_brief->>'call_to_action','')))<2 then raise exception 'Definí hook, payoff y llamado a la acción antes de abrir el storyboard.'; end if;
  v_source:=jsonb_build_object('schema_version',1,'contract_id',v_contract.id,'contract_version',v_contract.version,
    'contract_fingerprint',v_contract.contract_fingerprint,'contract_payload',v_contract.sealed_payload,
    'room_id',v_room.id,'context_fingerprint',v_room.context_fingerprint,'storyboard',jsonb_build_object(
      'title',v_title,'channel',v_channel,'format',v_format,'aspect_ratio',v_ratio,'target_duration_sec',v_duration,
      'creative_brief',v_brief,'retention_plan',v_retention,'estimated_cost_cop',v_cost));
  v_fingerprint:=public._agency_mesa_fingerprint(v_source);
  select * into v_existing from public.agency_storyboards where storyboard_key=v_key;
  if v_existing.id is not null then
    if v_existing.contract_id<>v_contract.id or v_existing.source_fingerprint<>v_fingerprint then raise exception 'La clave idempotente ya pertenece a otro storyboard.'; end if;
    return jsonb_build_object('ok',true,'storyboard_id',v_existing.id,'version',v_existing.version,'duplicate',true,'executed',false);
  end if;
  select * into v_existing from public.agency_storyboards
    where contract_id=v_contract.id and source_fingerprint=v_fingerprint;
  if v_existing.id is not null then
    return jsonb_build_object('ok',true,'storyboard_id',v_existing.id,'version',v_existing.version,'duplicate',true,'executed',false);
  end if;
  perform pg_advisory_xact_lock(hashtext('agency_storyboard:'||v_contract.id::text));
  select coalesce(max(version),0)+1 into v_version from public.agency_storyboards where contract_id=v_contract.id;
  update public.agency_storyboards set status='Sustituido',review_note='Sustituido por una nueva versión antes de aprobación.'
    where contract_id=v_contract.id and status in ('Borrador','En revisión');
  insert into public.agency_storyboards(storyboard_key,contract_id,version,title,channel,format,aspect_ratio,target_duration_sec,
    creative_brief,retention_plan,source_snapshot,source_fingerprint,estimated_cost_cop,created_by)
  values(v_key,v_contract.id,v_version,v_title,v_channel,v_format,v_ratio,v_duration,v_brief,v_retention,v_source,v_fingerprint,v_cost,v_actor.id)
  returning id into v_id;
  perform public._add_audit('Storyboard Agencia',v_id::text,'Storyboard abierto','',v_title||' · V'||v_version::text);
  return jsonb_build_object('ok',true,'storyboard_id',v_id,'version',v_version,'duplicate',false,'executed',false,'requires_human_approval',true);
end $$;

create or replace function public.guardar_toma_storyboard(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_board public.agency_storyboards%rowtype; v_id bigint; v_revision integer; v_existing bigint;
  v_board_id bigint:=nullif(p->>'storyboard_id','')::bigint; v_number integer:=nullif(p->>'shot_number','')::integer;
  v_title text:=btrim(coalesce(p->>'title','')); v_purpose text:=btrim(coalesce(p->>'purpose',''));
  v_duration numeric:=coalesce(nullif(p->>'duration_sec','')::numeric,0); v_cost numeric:=coalesce(nullif(p->>'estimated_cost_cop','')::numeric,0);
  v_payload jsonb:=coalesce(p->'shot','{}'::jsonb); v_assets bigint[]:='{}'::bigint[]; v_sealed jsonb; v_fingerprint text;
begin
  v_actor:=public._agency_actor(); select * into v_board from public.agency_storyboards where id=v_board_id for update;
  if v_board.id is null or v_board.status<>'Borrador' then raise exception 'La toma solo se puede guardar mientras el storyboard está en Borrador.'; end if;
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_number not between 1 and 200
     or length(v_title) not between 2 and 160 or length(v_purpose) not between 2 and 600 or v_duration not between 0.1 and 120
     or v_cost<0 or jsonb_typeof(v_payload)<>'object' then raise exception 'La toma no cumple el contrato.'; end if;
  if length(btrim(coalesce(v_payload->>'subject','')))<2 or length(btrim(coalesce(v_payload->>'action','')))<2
     or length(btrim(coalesce(v_payload->>'camera','')))<2 or length(btrim(coalesce(v_payload->>'continuity_out','')))<2 then
    raise exception 'Cada toma necesita sujeto, acción, cámara y continuidad de salida.';
  end if;
  if p ? 'input_asset_ids' then
    if jsonb_typeof(p->'input_asset_ids')<>'array' then raise exception 'Los activos de la toma deben ser una lista.'; end if;
    select coalesce(array_agg(distinct value::bigint order by value::bigint),'{}'::bigint[]) into v_assets
      from jsonb_array_elements_text(p->'input_asset_ids') where value ~ '^[1-9][0-9]*$';
    if cardinality(v_assets)<>jsonb_array_length(p->'input_asset_ids') then raise exception 'La lista de activos contiene identificadores inválidos o duplicados.'; end if;
    if exists(select 1 from unnest(v_assets) asset_id left join public.brand_media_assets a on a.id=asset_id
      where a.id is null or a.status<>'Activo' or a.rights_status<>'Autorizado' or not a.ai_use_allowed
        or (a.rights_expires_at is not null and a.rights_expires_at<current_date)) then
      raise exception 'Una referencia no existe o no tiene derechos vigentes para IA.';
    end if;
  end if;
  v_sealed:=jsonb_build_object('schema_version',1,'storyboard_id',v_board.id,'storyboard_fingerprint',v_board.source_fingerprint,
    'shot_number',v_number,'title',v_title,'purpose',v_purpose,'duration_sec',v_duration,'shot',v_payload,
    'input_asset_ids',to_jsonb(v_assets),'estimated_cost_cop',v_cost);
  v_fingerprint:=public._agency_mesa_fingerprint(v_sealed);
  select id into v_existing from public.agency_storyboard_shots where storyboard_id=v_board.id and shot_number=v_number and shot_fingerprint=v_fingerprint;
  if v_existing is not null then return jsonb_build_object('ok',true,'shot_id',v_existing,'duplicate',true,'executed',false); end if;
  perform pg_advisory_xact_lock(hashtext('agency_storyboard_shot:'||v_board.id::text||':'||v_number::text));
  select coalesce(max(revision),0)+1 into v_revision from public.agency_storyboard_shots where storyboard_id=v_board.id and shot_number=v_number;
  update public.agency_storyboard_shots set status='Sustituida' where storyboard_id=v_board.id and shot_number=v_number and status='Vigente';
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,
    estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board.id,v_number,v_revision,v_title,v_purpose,v_duration,v_payload,v_assets,v_cost,v_fingerprint,v_actor.id) returning id into v_id;
  perform public._add_audit('Storyboard Agencia',v_board.id::text,'Toma versionada','',format('Toma %s · R%s',v_number,v_revision));
  return jsonb_build_object('ok',true,'shot_id',v_id,'revision',v_revision,'duplicate',false,'executed',false);
end $$;

create or replace function public.enviar_storyboard_revision(p_storyboard_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_board public.agency_storyboards%rowtype; v_errors text[];
begin
  v_actor:=public._agency_actor(); select * into v_board from public.agency_storyboards where id=p_storyboard_id for update;
  if v_board.id is null or v_board.status<>'Borrador' then raise exception 'El storyboard no existe o no está en Borrador.'; end if;
  v_errors:=public._storyboard_errors(v_board.id);
  if cardinality(v_errors)>0 then raise exception 'Storyboard incompleto: %',array_to_string(v_errors,' '); end if;
  update public.agency_storyboards set status='En revisión',submitted_by=v_actor.id,submitted_at=now(),
    reviewed_by=null,reviewed_at=null,review_note='' where id=v_board.id;
  perform public._add_audit('Storyboard Agencia',v_board.id::text,'Storyboard enviado','Borrador','En revisión');
  return jsonb_build_object('ok',true,'storyboard_id',v_board.id,'status','En revisión','executed',false,'generation_started',false);
end $$;

create or replace function public.resolver_storyboard_agencia(p_storyboard_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_board public.agency_storyboards%rowtype; v_errors text[]; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_board from public.agency_storyboards where id=p_storyboard_id for update;
  if v_board.id is null or v_board.status<>'En revisión' then raise exception 'El storyboard no existe o no espera revisión.'; end if;
  if p_decision not in ('Aprobar','Devolver') then raise exception 'La decisión de storyboard no es válida.'; end if;
  if p_decision='Devolver' then
    if length(v_note)<3 then raise exception 'Explicá qué toma o criterio debe corregirse.'; end if;
    update public.agency_storyboards set status='Borrador',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_board.id;
    perform public._add_audit('Storyboard Agencia',v_board.id::text,'Storyboard devuelto','En revisión','Borrador · '||left(v_note,160));
    return jsonb_build_object('ok',true,'storyboard_id',v_board.id,'status','Borrador','executed',false);
  end if;
  v_errors:=public._storyboard_errors(v_board.id);
  if cardinality(v_errors)>0 then raise exception 'El storyboard dejó de ser aprobable: %',array_to_string(v_errors,' '); end if;
  update public.agency_storyboards set status='Sustituido',review_note='Sustituido por la versión aprobada posterior.'
    where contract_id=v_board.contract_id and status='Aprobado' and id<>v_board.id;
  update public.agency_storyboards set status='Aprobado',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_board.id;
  perform public._add_audit('Storyboard Agencia',v_board.id::text,'Storyboard aprobado','En revisión','Aprobado · no ejecutado');
  return jsonb_build_object('ok',true,'storyboard_id',v_board.id,'status','Aprobado','executed',false,
    'generation_started',false,'distribution_started',false,'requires_next_authorization',true);
end $$;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['agency_storyboards','agency_storyboard_shots'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.estudio_escenas_disponible() from public,anon;
revoke all on function public._storyboard_immutable() from public,anon,authenticated;
revoke all on function public._storyboard_shot_immutable() from public,anon,authenticated;
revoke all on function public._storyboard_errors(bigint) from public,anon,authenticated;
revoke all on function public.crear_storyboard_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.guardar_toma_storyboard(jsonb) from public,anon,authenticated;
revoke all on function public.enviar_storyboard_revision(bigint) from public,anon,authenticated;
revoke all on function public.resolver_storyboard_agencia(bigint,text,text) from public,anon,authenticated;
grant execute on function public.estudio_escenas_disponible() to authenticated;
grant execute on function public.crear_storyboard_agencia(jsonb) to authenticated;
grant execute on function public.guardar_toma_storyboard(jsonb) to authenticated;
grant execute on function public.enviar_storyboard_revision(bigint) to authenticated;
grant execute on function public.resolver_storyboard_agencia(bigint,text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_31_estudio_escenas','Storyboard y tomas versionadas con continuidad, retención, derechos, costo y aprobación humana previa al gasto')
on conflict(id) do update set detalle=excluded.detalle;

commit;
