-- ============================================================================
-- marketing_contenido_v1 — Creativos, Calendario y Resultados contra Supabase.
--
-- Decisiones de dominio:
--   · creatives.producto_foco_id es FK; el front hidrata también el nombre.
--   · content_posts reemplaza content_calendar.
--   · metrics_daily guarda SOLO métricas de plataforma. Pedidos/ventas se
--     derivan de orders; nunca vuelven a tipearse en Resultados.
--   · una captura manual por creativo+día: repetirla actualiza la fila.
--
-- RPCs públicas (security definer, gate staff que falla cerrado):
--   crear_creativo(p jsonb)
--   editar_creativo(p_id text, p jsonb)              -- PATCH real
--   crear_publicacion(p jsonb)
--   set_publicacion_estado(p_id text, p_estado text) -- no-op idempotente
--   registrar_metricas_creativo(p jsonb)             -- upsert diario manual
-- ============================================================================

alter table public.metrics_daily
  add column if not exists notas text not null default '';

-- Bloque re-ejecutable: la instalación viva anterior no tenía estos CHECK.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.creatives'::regclass and conname = 'creatives_fecha_entrega_finita'
  ) then
    execute $ddl$
      alter table public.creatives add constraint creatives_fecha_entrega_finita
        check (fecha_entrega is null or isfinite(fecha_entrega))
    $ddl$;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.content_posts'::regclass and conname = 'content_posts_fecha_finita'
  ) then
    execute $ddl$
      alter table public.content_posts add constraint content_posts_fecha_finita
        check (isfinite(fecha))
    $ddl$;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.metrics_daily'::regclass and conname = 'metrics_daily_fecha_finita'
  ) then
    execute $ddl$
      alter table public.metrics_daily add constraint metrics_daily_fecha_finita
        check (isfinite(fecha))
    $ddl$;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.metrics_daily'::regclass and conname = 'metrics_daily_tiene_dimension'
  ) then
    execute $ddl$
      alter table public.metrics_daily add constraint metrics_daily_tiene_dimension
        check (num_nonnulls(campaign_id, creative_id, post_id) >= 1)
    $ddl$;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.metrics_daily'::regclass and conname = 'metrics_daily_valores_validos'
  ) then
    execute $ddl$
      alter table public.metrics_daily add constraint metrics_daily_valores_validos check (
        impresiones >= 0 and alcance >= 0 and clicks >= 0 and mensajes_wa >= 0
        and gasto >= 0 and gasto::text not in ('NaN', 'Infinity', '-Infinity')
      )
    $ddl$;
  end if;
end $$;

-- El UNIQUE legado considera los NULL distintos y deja duplicar exactamente
-- la misma combinación lógica. PG 17 permite cerrar esa grieta para manual y MCP.
create unique index if not exists metrics_daily_dimensiones_dia_uq
  on public.metrics_daily (fecha, fuente, campaign_id, creative_id, post_id)
  nulls not distinct;

-- La base viva conserva este UNIQUE antiguo (NULLS DISTINCT). El nuevo índice
-- ya lo reemplaza; quitar el constraint evita drift y un índice redundante.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.metrics_daily'::regclass
      and conname = 'metrics_daily_fecha_fuente_campaign_id_creative_id_post_id_key'
  ) then
    execute 'alter table public.metrics_daily '
      || 'drop constraint metrics_daily_fecha_fuente_campaign_id_creative_id_post_id_key';
  end if;
end $$;

-- El UNIQUE original permite duplicados cuando post_id/campaign_id son NULL.
-- Esta superficie concreta (captura manual por creativo, sin post) sí necesita
-- unicidad real para que dos toques o dos dispositivos no dupliquen el día.
create unique index if not exists metrics_daily_manual_creative_dia_uq
  on public.metrics_daily (fecha, creative_id)
  where fuente = 'manual' and post_id is null;

-- Invariante central (también para escrituras directas permitidas por RLS):
-- una publicación y su creativo siempre comparten campaña. FOR SHARE
-- serializa el alta del post con un cambio concurrente del creativo.
create or replace function public.validar_publicacion_creativo_campaign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign text;
begin
  if new.creative_id is null then return new; end if;
  select campaign_id into v_campaign
  from creatives where id = new.creative_id
  for share;
  if not found then raise exception 'El creativo % no existe', new.creative_id; end if;
  if new.campaign_id is null then
    new.campaign_id := v_campaign;
  elsif new.campaign_id is distinct from v_campaign then
    raise exception 'La publicación y el creativo deben pertenecer a la misma campaña';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_posts_campaign_creative on public.content_posts;
create trigger trg_content_posts_campaign_creative
before insert or update of creative_id, campaign_id on public.content_posts
for each row execute function public.validar_publicacion_creativo_campaign();

create or replace function public.validar_cambio_campaign_creativo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_id is distinct from old.campaign_id and exists (
    select 1 from content_posts
    where creative_id = old.id and campaign_id is distinct from new.campaign_id
  ) then
    raise exception 'No se puede cambiar la campaña: el creativo ya tiene publicaciones ligadas';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_creatives_campaign_posts on public.creatives;
create trigger trg_creatives_campaign_posts
before update of campaign_id on public.creatives
for each row execute function public.validar_cambio_campaign_creativo();

revoke execute on function public.validar_publicacion_creativo_campaign() from public, anon, authenticated;
revoke execute on function public.validar_cambio_campaign_creativo() from public, anon, authenticated;

create or replace function public.crear_creativo(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_actor text;
  v_fecha date;
  v_campaign text := nullif(trim(coalesce(p->>'campaign_id', '')), '');
  v_producto text := nullif(trim(coalesce(p->>'producto_foco_id', '')), '');
  v_figura text := nullif(trim(coalesce(p->>'figura', '')), '');
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede crear creativos';
  end if;
  if coalesce(trim(p->>'titulo'), '') = '' then
    raise exception 'Falta el título del creativo';
  end if;
  if p->>'canal' is null or p->>'canal' not in
      ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico') then
    raise exception 'Canal inválido: %', coalesce(p->>'canal', '(vacío)');
  end if;
  if p->>'formato' is null or p->>'formato' not in
      ('Reel','Historia','Carrusel','Foto producto','Video UGC','Anuncio','Guion','Copy','Diseño empaque') then
    raise exception 'Formato inválido: %', coalesce(p->>'formato', '(vacío)');
  end if;
  if coalesce(p->>'estado', 'Idea') not in
      ('Idea','En diseño','En revisión','Aprobado','Publicado','Ganador','Descartado') then
    raise exception 'Estado inválido: %', coalesce(p->>'estado', '(vacío)');
  end if;

  begin
    v_fecha := nullif(trim(coalesce(p->>'fecha_entrega', '')), '')::date;
  exception when others then
    raise exception 'Fecha de entrega inválida: %', p->>'fecha_entrega';
  end;
  if v_fecha is not null and not isfinite(v_fecha) then
    raise exception 'Fecha de entrega inválida: %', p->>'fecha_entrega';
  end if;

  if v_campaign is not null and not exists (select 1 from campaigns where id = v_campaign) then
    raise exception 'La campaña % no existe', v_campaign;
  end if;
  if v_producto is not null and not exists (select 1 from products where id = v_producto) then
    raise exception 'El producto foco % no existe', v_producto;
  end if;
  if v_figura is not null and not exists (select 1 from figuras where nombre = v_figura) then
    raise exception 'La figura % no existe', v_figura;
  end if;

  select id into v_actor from users where auth_id = auth.uid();
  v_id := next_id('creative', 'CRE-', 2);

  insert into creatives (
    id, campaign_id, titulo, canal, formato, producto_foco_id, figura, sabor,
    hook, copy, guion, estado, responsable, fecha_entrega, asset_url, notas
  ) values (
    v_id, v_campaign, trim(p->>'titulo'), p->>'canal', p->>'formato', v_producto,
    v_figura, nullif(p->>'sabor', ''), coalesce(p->>'hook', ''),
    coalesce(p->>'copy', ''), coalesce(p->>'guion', ''), coalesce(p->>'estado', 'Idea'),
    coalesce(p->>'responsable', ''), v_fecha, coalesce(p->>'asset_url', ''),
    coalesce(p->>'notas', '')
  );

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_actor, 'Creativo', v_id, 'Creativo creado', '', trim(p->>'titulo'));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.editar_creativo(p_id text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v creatives%rowtype;
  v_estado_prev text;
  v_actor text;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede editar creativos';
  end if;

  select * into v from creatives where id = p_id for update;
  if not found then
    raise exception 'El creativo % no existe', p_id;
  end if;
  v_estado_prev := v.estado;

  if p ? 'titulo' then v.titulo := trim(p->>'titulo'); end if;
  if coalesce(v.titulo, '') = '' then raise exception 'Falta el título del creativo'; end if;
  if p ? 'canal' then v.canal := p->>'canal'; end if;
  if v.canal is null or v.canal not in
      ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico') then
    raise exception 'Canal inválido: %', coalesce(v.canal, '(vacío)');
  end if;
  if p ? 'formato' then v.formato := p->>'formato'; end if;
  if v.formato is null or v.formato not in
      ('Reel','Historia','Carrusel','Foto producto','Video UGC','Anuncio','Guion','Copy','Diseño empaque') then
    raise exception 'Formato inválido: %', coalesce(v.formato, '(vacío)');
  end if;
  if p ? 'estado' then v.estado := p->>'estado'; end if;
  if v.estado is null or v.estado not in
      ('Idea','En diseño','En revisión','Aprobado','Publicado','Ganador','Descartado') then
    raise exception 'Estado inválido: %', coalesce(v.estado, '(vacío)');
  end if;

  if p ? 'campaign_id' then v.campaign_id := nullif(trim(coalesce(p->>'campaign_id', '')), ''); end if;
  if p ? 'producto_foco_id' then v.producto_foco_id := nullif(trim(coalesce(p->>'producto_foco_id', '')), ''); end if;
  if p ? 'figura' then v.figura := nullif(trim(coalesce(p->>'figura', '')), ''); end if;
  if v.campaign_id is not null and not exists (select 1 from campaigns where id = v.campaign_id) then
    raise exception 'La campaña % no existe', v.campaign_id;
  end if;
  if p ? 'campaign_id' and exists (
    select 1 from content_posts
    where creative_id = p_id and campaign_id is distinct from v.campaign_id
  ) then
    raise exception 'No se puede cambiar la campaña: el creativo ya tiene publicaciones ligadas';
  end if;
  if v.producto_foco_id is not null and not exists (select 1 from products where id = v.producto_foco_id) then
    raise exception 'El producto foco % no existe', v.producto_foco_id;
  end if;
  if v.figura is not null and not exists (select 1 from figuras where nombre = v.figura) then
    raise exception 'La figura % no existe', v.figura;
  end if;

  if p ? 'fecha_entrega' then
    begin
      v.fecha_entrega := nullif(trim(coalesce(p->>'fecha_entrega', '')), '')::date;
    exception when others then
      raise exception 'Fecha de entrega inválida: %', p->>'fecha_entrega';
    end;
    if v.fecha_entrega is not null and not isfinite(v.fecha_entrega) then
      raise exception 'Fecha de entrega inválida: %', p->>'fecha_entrega';
    end if;
  end if;
  if p ? 'sabor' then v.sabor := nullif(p->>'sabor', ''); end if;
  if p ? 'hook' then v.hook := coalesce(p->>'hook', ''); end if;
  if p ? 'copy' then v.copy := coalesce(p->>'copy', ''); end if;
  if p ? 'guion' then v.guion := coalesce(p->>'guion', ''); end if;
  if p ? 'responsable' then v.responsable := coalesce(p->>'responsable', ''); end if;
  if p ? 'asset_url' then v.asset_url := coalesce(p->>'asset_url', ''); end if;
  if p ? 'notas' then v.notas := coalesce(p->>'notas', ''); end if;

  update creatives set
    campaign_id = v.campaign_id, titulo = v.titulo, canal = v.canal, formato = v.formato,
    producto_foco_id = v.producto_foco_id, figura = v.figura, sabor = v.sabor,
    hook = v.hook, copy = v.copy, guion = v.guion, estado = v.estado,
    responsable = v.responsable, fecha_entrega = v.fecha_entrega,
    asset_url = v.asset_url, notas = v.notas
  where id = p_id;

  select id into v_actor from users where auth_id = auth.uid();
  if v.estado <> v_estado_prev then
    insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
    values (next_id('audit', 'A', 2), v_actor, 'Creativo', p_id, 'Cambio de estado', v_estado_prev, v.estado);
  else
    insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
    values (next_id('audit', 'A', 2), v_actor, 'Creativo', p_id, 'Creativo editado', '', v.titulo);
  end if;

  return jsonb_build_object('ok', true, 'cambio_estado', v.estado <> v_estado_prev);
end;
$$;

create or replace function public.crear_publicacion(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_actor text;
  v_fecha date;
  v_hora time;
  v_campaign text := nullif(trim(coalesce(p->>'campaign_id', '')), '');
  v_creative text := nullif(trim(coalesce(p->>'creative_id', '')), '');
  v_creative_campaign text;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede crear publicaciones';
  end if;
  if coalesce(trim(p->>'titulo'), '') = '' then raise exception 'Falta el título de la publicación'; end if;
  if p->>'canal' is null or p->>'canal' not in
      ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico') then
    raise exception 'Canal inválido: %', coalesce(p->>'canal', '(vacío)');
  end if;
  if coalesce(p->>'estado', 'Pendiente') not in ('Pendiente','Programado','Publicado','No publicado') then
    raise exception 'Estado inválido: %', coalesce(p->>'estado', '(vacío)');
  end if;

  begin
    v_fecha := nullif(trim(coalesce(p->>'fecha', '')), '')::date;
  exception when others then
    raise exception 'Fecha de publicación inválida: %', p->>'fecha';
  end;
  if v_fecha is null then raise exception 'Falta la fecha de publicación'; end if;
  if not isfinite(v_fecha) then raise exception 'Fecha de publicación inválida: %', p->>'fecha'; end if;
  begin
    v_hora := coalesce(nullif(trim(coalesce(p->>'hora', '')), '')::time, '12:00'::time);
  exception when others then
    raise exception 'Hora de publicación inválida: %', p->>'hora';
  end;

  if v_campaign is not null and not exists (select 1 from campaigns where id = v_campaign) then
    raise exception 'La campaña % no existe', v_campaign;
  end if;
  if v_creative is not null then
    select campaign_id into v_creative_campaign from creatives where id = v_creative;
    if not found then raise exception 'El creativo % no existe', v_creative; end if;
    if v_campaign is null then v_campaign := v_creative_campaign; end if;
    if v_campaign is not null and v_creative_campaign is not null and v_campaign <> v_creative_campaign then
      raise exception 'La publicación y el creativo deben pertenecer a la misma campaña';
    end if;
  end if;

  select id into v_actor from users where auth_id = auth.uid();
  v_id := next_id('calendar', 'CAL-', 2);
  insert into content_posts (
    id, fecha, hora, canal, campaign_id, creative_id, titulo, copy_final,
    estado, url_publicacion, notas
  ) values (
    v_id, v_fecha, v_hora, p->>'canal', v_campaign, v_creative, trim(p->>'titulo'),
    coalesce(p->>'copy_final', ''), coalesce(p->>'estado', 'Pendiente'),
    coalesce(p->>'url_publicacion', ''), coalesce(p->>'notas', '')
  );

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_actor, 'Publicación', v_id, 'Publicación creada', '', trim(p->>'titulo'));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.set_publicacion_estado(p_id text, p_estado text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_actor text;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede cambiar el estado de publicaciones';
  end if;
  if p_estado is null or p_estado not in ('Pendiente','Programado','Publicado','No publicado') then
    raise exception 'Estado inválido: %', coalesce(p_estado, '(vacío)');
  end if;
  select estado into v_prev from content_posts where id = p_id for update;
  if not found then raise exception 'La publicación % no existe', p_id; end if;
  if v_prev = p_estado then
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'cambio', false);
  end if;

  update content_posts set estado = p_estado where id = p_id;
  select id into v_actor from users where auth_id = auth.uid();
  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_actor, 'Publicación', p_id, 'Cambio de estado', v_prev, p_estado);
  return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'cambio', true);
end;
$$;

create or replace function public.registrar_metricas_creativo(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_actor text;
  v_fecha date;
  v_creative text := nullif(trim(coalesce(p->>'creative_id', '')), '');
  v_campaign text;
  v_imp integer;
  v_alc integer;
  v_clicks integer;
  v_wa integer;
  v_gasto numeric;
  v_existia boolean;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede registrar métricas';
  end if;
  if v_creative is null then raise exception 'Falta elegir el creativo'; end if;
  select campaign_id into v_campaign from creatives where id = v_creative;
  if not found then raise exception 'El creativo % no existe', v_creative; end if;

  begin
    v_fecha := coalesce(nullif(trim(coalesce(p->>'fecha', '')), '')::date,
                        (now() at time zone 'America/Bogota')::date);
  exception when others then
    raise exception 'Fecha de métricas inválida: %', p->>'fecha';
  end;
  if not isfinite(v_fecha) then raise exception 'Fecha de métricas inválida: %', p->>'fecha'; end if;
  begin
    v_imp := coalesce(nullif(trim(coalesce(p->>'impresiones', '')), '')::integer, 0);
    v_alc := coalesce(nullif(trim(coalesce(p->>'alcance', '')), '')::integer, 0);
    v_clicks := coalesce(nullif(trim(coalesce(p->>'clicks', '')), '')::integer, 0);
    v_wa := coalesce(nullif(trim(coalesce(p->>'mensajes_wa', '')), '')::integer, 0);
  exception when others then
    raise exception 'Impresiones, alcance, clicks y mensajes deben ser números enteros';
  end;
  begin
    v_gasto := coalesce(nullif(trim(coalesce(p->>'gasto', '')), '')::numeric, 0);
  exception when others then
    raise exception 'Gasto inválido: %', p->>'gasto';
  end;
  if least(v_imp, v_alc, v_clicks, v_wa) < 0
      or v_gasto < 0 or v_gasto::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Las métricas y el gasto deben ser finitos y no negativos';
  end if;

  insert into metrics_daily (
    fecha, fuente, campaign_id, creative_id, post_id,
    impresiones, alcance, clicks, mensajes_wa, gasto, notas
  ) values (
    v_fecha, 'manual', v_campaign, v_creative, null,
    v_imp, v_alc, v_clicks, v_wa, v_gasto, coalesce(p->>'notas', '')
  )
  on conflict (fecha, creative_id)
    where fuente = 'manual' and post_id is null
  do nothing
  returning id into v_id;

  v_existia := v_id is null;
  if v_existia then
    update metrics_daily set
      campaign_id = v_campaign,
      impresiones = v_imp,
      alcance = v_alc,
      clicks = v_clicks,
      mensajes_wa = v_wa,
      gasto = v_gasto,
      notas = coalesce(p->>'notas', '')
    where fecha = v_fecha and fuente = 'manual'
      and creative_id = v_creative and post_id is null
    returning id into v_id;
  end if;

  select id into v_actor from users where auth_id = auth.uid();
  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (
    next_id('audit', 'A', 2), v_actor, 'Resultado', v_id::text,
    case when v_existia then 'Métricas actualizadas' else 'Métricas registradas' end,
    '', v_creative || ' · ' || v_fecha::text
  );
  return jsonb_build_object('ok', true, 'id', v_id, 'actualizado', v_existia);
end;
$$;

revoke execute on function public.crear_creativo(jsonb) from public, anon;
grant execute on function public.crear_creativo(jsonb) to authenticated;
revoke execute on function public.editar_creativo(text, jsonb) from public, anon;
grant execute on function public.editar_creativo(text, jsonb) to authenticated;
revoke execute on function public.crear_publicacion(jsonb) from public, anon;
grant execute on function public.crear_publicacion(jsonb) to authenticated;
revoke execute on function public.set_publicacion_estado(text, text) from public, anon;
grant execute on function public.set_publicacion_estado(text, text) to authenticated;
revoke execute on function public.registrar_metricas_creativo(jsonb) from public, anon;
grant execute on function public.registrar_metricas_creativo(jsonb) to authenticated;
