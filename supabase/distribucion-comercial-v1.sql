-- MOMOS OPS · Distribución Comercial v1.
-- Paso 19, después de abastecimiento interno. No publica en plataformas:
-- sella preparación, aprobación humana y evidencia de la ejecución externa.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_18_abastecimiento_interno'
  ) then raise exception 'Falta el paso 18_abastecimiento_interno.'; end if;
end $$;

create table if not exists public.content_distributions(
  id bigint generated always as identity primary key,
  post_id text not null unique references public.content_posts(id) on delete cascade,
  channel text not null check(channel in ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico')),
  status text not null default 'Preparación' check(status in ('Preparación','Lista','Aprobada','Publicada','Fallida','Cancelada')),
  checklist jsonb not null default '{}'::jsonb check(jsonb_typeof(checklist)='object'),
  attempt integer not null default 1 check(attempt>0),
  prepared_by text not null references public.users(id),
  prepared_at timestamptz not null default now(),
  approved_by text references public.users(id),
  approved_at timestamptz,
  executed_by text references public.users(id),
  published_at timestamptz,
  external_url text not null default '',
  external_post_id text not null default '',
  failure_reason text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now(),
  constraint content_distributions_approval_pair check((approved_by is null)=(approved_at is null)),
  constraint content_distributions_publication_evidence check(
    status<>'Publicada' or (published_at is not null and executed_by is not null and (length(btrim(external_url))>0 or length(btrim(external_post_id))>0))
  ),
  constraint content_distributions_failure_reason check(status<>'Fallida' or length(btrim(failure_reason))>=5)
);
create index if not exists content_distributions_status_idx on public.content_distributions(status,updated_at desc);

alter table public.content_distributions enable row level security;
drop policy if exists staff_read on public.content_distributions;
create policy staff_read on public.content_distributions for select to authenticated using(public.is_staff());
revoke all on public.content_distributions from public,anon,authenticated;
grant select on public.content_distributions to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='content_distributions') then
    alter publication supabase_realtime add table public.content_distributions;
  end if;
end $$;

create or replace function public.distribucion_comercial_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._distribution_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or v_actor.rol not in ('Administrador','Marketing/CRM') then
    raise exception 'Tu rol no puede operar la distribución comercial.';
  end if;
  return v_actor;
end $$;

create or replace function public._distribution_required_keys(p_channel text,p_format text) returns text[]
language plpgsql immutable set search_path=public as $$
declare v_keys text[]:=array['formato_canal','copy_revisado','cta_enlace'];
begin
  if p_channel in ('Instagram','Facebook','TikTok','Rappi','Influencer','Orgánico') then v_keys:=array_prepend('archivo_final',v_keys); end if;
  if p_channel in ('Instagram','TikTok') and p_format in ('Reel','Video UGC') then v_keys:=array_append(v_keys,'audio_derechos'); end if;
  if p_channel='WhatsApp' then v_keys:=array_append(v_keys,'audiencia_autorizada'); end if;
  if p_channel='Rappi' then v_keys:=array_append(v_keys,'ficha_disponible'); end if;
  if p_channel='Influencer' then v_keys:=array_append(v_keys,'menciones_acordadas'); end if;
  return v_keys;
end $$;

create or replace function public._distribution_checklist_complete(p_checklist jsonb,p_channel text,p_format text) returns boolean
language sql immutable set search_path=public as $$
  select coalesce(bool_and(coalesce((p_checklist->>k)::boolean,false)),false)
  from unnest(public._distribution_required_keys(p_channel,p_format)) k
$$;

create or replace function public.guardar_preparacion_distribucion(p_post_id text,p_checklist jsonb,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_post public.content_posts%rowtype; v_creative public.creatives%rowtype;
  v_complete boolean; v_previous public.content_distributions%rowtype; v_status text; v_attempt integer:=1;
begin
  v_actor:=public._distribution_actor();
  if p_checklist is null or jsonb_typeof(p_checklist)<>'object' then raise exception 'El checklist debe ser un objeto válido.'; end if;
  select * into v_post from public.content_posts where id=p_post_id for update;
  if v_post.id is null then raise exception 'La publicación % no existe.',p_post_id; end if;
  if v_post.estado<>'Programado' then raise exception 'La publicación debe estar Programada antes de preparar su salida.'; end if;
  if v_post.creative_id is null then raise exception 'La publicación necesita un creativo.'; end if;
  select * into v_creative from public.creatives where id=v_post.creative_id;
  if v_creative.id is null or v_creative.estado not in ('Aprobado','Publicado','Ganador') then raise exception 'El creativo necesita aprobación humana.'; end if;
  if v_creative.canal<>v_post.canal then raise exception 'El canal del creativo no coincide con la publicación.'; end if;
  if length(btrim(coalesce(v_post.copy_final,'')))=0 then raise exception 'Falta el copy final.'; end if;
  if v_post.canal in ('Instagram','Facebook','TikTok','Rappi','Influencer','Orgánico') and length(btrim(coalesce(v_creative.asset_url,'')))=0 then
    raise exception 'El creativo necesita un archivo final antes de distribuirse.';
  end if;
  if v_creative.producto_foco_id is not null and not exists(select 1 from public.products where id=v_creative.producto_foco_id and activo and stock>0) then
    raise exception 'El producto foco no está activo o no tiene disponibilidad.';
  end if;
  v_complete:=public._distribution_checklist_complete(p_checklist,v_post.canal,v_creative.formato);
  v_status:=case when v_complete then 'Lista' else 'Preparación' end;
  select * into v_previous from public.content_distributions where post_id=p_post_id for update;
  if v_previous.status in ('Publicada','Cancelada') then raise exception 'La distribución ya está cerrada.'; end if;
  if v_previous.status='Aprobada' then raise exception 'La salida aprobada no puede editarse; registrá su ejecución o fallo.'; end if;
  if v_previous.status='Fallida' then v_attempt:=v_previous.attempt+1; elsif v_previous.id is not null then v_attempt:=v_previous.attempt; end if;
  insert into public.content_distributions(post_id,channel,status,checklist,attempt,prepared_by,prepared_at,notes,updated_at,
    approved_by,approved_at,executed_by,published_at,external_url,external_post_id,failure_reason)
  values(p_post_id,v_post.canal,v_status,p_checklist,v_attempt,v_actor.id,now(),coalesce(p_notes,''),now(),null,null,null,null,'','','')
  on conflict(post_id) do update set channel=excluded.channel,status=excluded.status,checklist=excluded.checklist,attempt=excluded.attempt,
    prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,notes=excluded.notes,updated_at=excluded.updated_at,
    approved_by=null,approved_at=null,executed_by=null,published_at=null,external_url='',external_post_id='',failure_reason='';
  perform public._add_audit('Distribución',p_post_id,'Preparación comercial',coalesce(v_previous.status,''),v_status||' · intento '||v_attempt);
  return jsonb_build_object('ok',true,'post_id',p_post_id,'status',v_status,'checklist_complete',v_complete,'attempt',v_attempt);
end $$;

create or replace function public.aprobar_distribucion(p_post_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_run public.content_distributions%rowtype; v_post public.content_posts%rowtype; v_format text;
begin
  v_actor:=public._distribution_actor();
  select * into v_run from public.content_distributions where post_id=p_post_id for update;
  if v_run.id is null then raise exception 'Primero prepará la distribución.'; end if;
  if v_run.status='Aprobada' then return jsonb_build_object('ok',true,'post_id',p_post_id,'status','Aprobada','cambio',false); end if;
  if v_run.status<>'Lista' then raise exception 'La salida debe estar Lista antes de aprobarse.'; end if;
  select * into v_post from public.content_posts where id=p_post_id for update;
  select formato into v_format from public.creatives where id=v_post.creative_id;
  if v_post.estado<>'Programado' or not public._distribution_checklist_complete(v_run.checklist,v_post.canal,v_format) then
    raise exception 'La publicación o su checklist ya no cumplen el preflight.';
  end if;
  update public.content_distributions set status='Aprobada',approved_by=v_actor.id,approved_at=now(),updated_at=now() where id=v_run.id;
  perform public._add_audit('Distribución',p_post_id,'Salida aprobada','Lista','Aprobada');
  return jsonb_build_object('ok',true,'post_id',p_post_id,'status','Aprobada','cambio',true);
end $$;

create or replace function public.cerrar_distribucion_publicacion(p_post_id text,p_result text,p_external_url text default '',p_external_post_id text default '',p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_run public.content_distributions%rowtype; v_post public.content_posts%rowtype; v_due timestamptz;
begin
  v_actor:=public._distribution_actor();
  if p_result not in ('Publicada','Fallida') then raise exception 'Resultado de distribución inválido.'; end if;
  select * into v_run from public.content_distributions where post_id=p_post_id for update;
  select * into v_post from public.content_posts where id=p_post_id for update;
  if v_run.id is null or v_post.id is null then raise exception 'La distribución no existe.'; end if;
  if v_run.status='Publicada' and p_result='Publicada' then return jsonb_build_object('ok',true,'post_id',p_post_id,'status','Publicada','cambio',false); end if;
  if v_run.status in ('Publicada','Cancelada') then raise exception 'La distribución ya está cerrada.'; end if;
  if p_result='Publicada' then
    if v_run.status<>'Aprobada' or v_run.approved_by is null then raise exception 'La salida necesita aprobación humana antes de publicarse.'; end if;
    v_due:=((v_post.fecha::timestamp+v_post.hora) at time zone 'America/Bogota');
    if v_due>now() then raise exception 'Todavía no llegó la fecha y hora programadas.'; end if;
    if length(btrim(coalesce(p_external_url,'')))=0 and length(btrim(coalesce(p_external_post_id,'')))=0 then
      raise exception 'Registrá la URL o el identificador externo.';
    end if;
    update public.content_distributions set status='Publicada',executed_by=v_actor.id,published_at=now(),external_url=btrim(coalesce(p_external_url,'')),
      external_post_id=btrim(coalesce(p_external_post_id,'')),failure_reason='',notes=case when length(btrim(coalesce(p_note,'')))>0 then p_note else notes end,updated_at=now() where id=v_run.id;
    update public.content_posts set estado='Publicado',url_publicacion=btrim(coalesce(p_external_url,'')),external_post_id=nullif(btrim(coalesce(p_external_post_id,'')),'') where id=p_post_id;
    update public.creatives set estado='Publicado',external_id=coalesce(nullif(btrim(coalesce(p_external_post_id,'')),''),external_id)
      where id=v_post.creative_id and estado='Aprobado';
  else
    if length(btrim(coalesce(p_note,'')))<5 then raise exception 'Explicá por qué no se pudo publicar.'; end if;
    update public.content_distributions set status='Fallida',executed_by=v_actor.id,failure_reason=btrim(p_note),notes=btrim(p_note),updated_at=now() where id=v_run.id;
    update public.content_posts set estado='No publicado' where id=p_post_id;
  end if;
  perform public._add_audit('Distribución',p_post_id,'Cierre de distribución',v_run.status,p_result||case when p_result='Fallida' then ' · '||btrim(p_note) else '' end);
  return jsonb_build_object('ok',true,'post_id',p_post_id,'status',p_result,'cambio',true);
end $$;

create or replace function public.enforce_content_distribution_transition() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.estado='Publicado' then
    raise exception 'Una publicación nueva no puede nacer Publicada; debe pasar por Distribución.';
  end if;
  if tg_op='UPDATE' and new.estado='Publicado' and old.estado is distinct from 'Publicado' and not exists(
    select 1 from public.content_distributions d
    where d.post_id=new.id and d.status='Publicada' and d.approved_by is not null and d.executed_by is not null
      and (length(btrim(d.external_url))>0 or length(btrim(d.external_post_id))>0)
  ) then raise exception 'La publicación debe cerrarse desde Distribución con aprobación y evidencia.';
  end if;
  if tg_op='UPDATE' and new.estado='No publicado' and old.estado='Programado'
     and exists(select 1 from public.content_distributions d where d.post_id=new.id)
     and not exists(select 1 from public.content_distributions d where d.post_id=new.id and d.status in ('Fallida','Cancelada')) then
    raise exception 'La salida preparada debe cerrarse como fallo desde Distribución.';
  end if;
  return new;
end $$;

revoke all on function public.enforce_content_distribution_transition() from public,anon,authenticated;
drop trigger if exists content_posts_distribution_guard on public.content_posts;
create trigger content_posts_distribution_guard
before insert or update of estado on public.content_posts
for each row execute function public.enforce_content_distribution_transition();

revoke all on function public.distribucion_comercial_disponible() from public,anon,authenticated;
revoke all on function public._distribution_actor() from public,anon,authenticated;
revoke all on function public._distribution_required_keys(text,text) from public,anon,authenticated;
revoke all on function public._distribution_checklist_complete(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.guardar_preparacion_distribucion(text,jsonb,text) from public,anon,authenticated;
revoke all on function public.aprobar_distribucion(text) from public,anon,authenticated;
revoke all on function public.cerrar_distribucion_publicacion(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.distribucion_comercial_disponible() to authenticated;
grant execute on function public.guardar_preparacion_distribucion(text,jsonb,text) to authenticated;
grant execute on function public.aprobar_distribucion(text) to authenticated;
grant execute on function public.cerrar_distribucion_publicacion(text,text,text,text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_19_distribucion_comercial','Preparación, aprobación humana, evidencia externa y cierre auditable por publicación')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260715_19_distribucion_comercial';
