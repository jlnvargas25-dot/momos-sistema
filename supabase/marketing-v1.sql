-- ============================================================================
-- marketing_v1 — Hito 2 del slice Marketing+Usuarios (spec engram
-- momos/marketing-usuarios-spec): el tab Marketing y los botones de campaña
-- de Crecimiento dejan de escribir local.
--
--   · campaigns.gasto_real numeric ≥0 default 0 (decisión de Julián: columna
--     editable simple; la integración Meta futura ya tiene external_platform/
--     external_id en el schema v5).
--   · crear_campana(p jsonb)            → jsonb {ok, id}
--   · editar_campana(p_id, p jsonb)     → jsonb {ok, cambio_estado}
--     SEMÁNTICA PATCH (fix Ronda 1 del juicio: un caller parcial NO borra
--     nada) — clave AUSENTE = conservar el valor actual; clave presente con
--     ''/null = limpiar a propósito (solo campos opcionales). Si el estado
--     cambió el audit es 'Cambio de estado' de/a, si no 'Campaña editada'.
--   · set_campana_estado(p_id, estado)  → jsonb {ok, de, a, cambio}
--     (los botones Pausar de Crecimiento; no-op idempotente)
--
-- Casts DEFENDIDOS (fix Ronda 1): '' en fecha = sin fecha (form vacío es uso
-- normal); basura en fecha/número = raise con mensaje de dominio, jamás el
-- error crudo de Postgres.
--
-- Gate: is_staff() is not true (falla cerrado — regla de la casa; Marketing
-- lo opera el rol Marketing/CRM, no hace falta admin). Dominios canal/
-- objetivo/estado: la tabla YA tiene los CHECKs (schema v5); las RPCs los
-- espejan con mensajes amigables. producto_foco_id: FK a products (la deuda
-- "productoFoco por nombre" muere acá — el front manda id y la hidratación
-- devuelve el nombre). Las 3 campañas demo locales NO se migran.
-- ============================================================================

alter table campaigns
  add column if not exists gasto_real numeric not null default 0
  check (gasto_real >= 0);

create or replace function public.crear_campana(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_actor text;
  v_fi date;
  v_ff date;
  v_pres numeric;
  v_gasto numeric;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede crear campañas';
  end if;

  if coalesce(trim(p->>'nombre'), '') = '' then
    raise exception 'Falta el nombre de la campaña';
  end if;
  if p->>'canal' is null or p->>'canal' not in ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico') then
    raise exception 'Canal inválido: %', coalesce(p->>'canal', '(vacío)');
  end if;
  if p->>'objetivo' is null or p->>'objetivo' not in ('Ventas','Recompra','Lanzamiento','Cumpleaños','Tráfico WhatsApp','Branding') then
    raise exception 'Objetivo inválido: %', coalesce(p->>'objetivo', '(vacío)');
  end if;
  if coalesce(p->>'estado', 'Planeada') not in ('Planeada','Activa','Pausada','Finalizada') then
    raise exception 'Estado inválido: %', p->>'estado';
  end if;

  begin
    v_fi := nullif(trim(coalesce(p->>'fecha_inicio', '')), '')::date;
  exception when others then
    raise exception 'Fecha inicio inválida: %', p->>'fecha_inicio';
  end;
  begin
    v_ff := nullif(trim(coalesce(p->>'fecha_fin', '')), '')::date;
  exception when others then
    raise exception 'Fecha fin inválida: %', p->>'fecha_fin';
  end;
  if v_fi is not null and v_ff is not null and v_ff < v_fi then
    raise exception 'La fecha fin no puede ser anterior a la fecha inicio';
  end if;

  begin
    v_pres := coalesce(nullif(trim(coalesce(p->>'presupuesto', '')), '')::numeric, 0);
  exception when others then
    raise exception 'Presupuesto inválido: %', p->>'presupuesto';
  end;
  begin
    v_gasto := coalesce(nullif(trim(coalesce(p->>'gasto_real', '')), '')::numeric, 0);
  exception when others then
    raise exception 'Gasto real inválido: %', p->>'gasto_real';
  end;
  if v_pres < 0 or v_gasto < 0 then
    raise exception 'Presupuesto y gasto real no pueden ser negativos';
  end if;

  if nullif(p->>'producto_foco_id', '') is not null
     and not exists (select 1 from products where id = p->>'producto_foco_id') then
    raise exception 'El producto foco % no existe', p->>'producto_foco_id';
  end if;

  select id into v_actor from users where auth_id = auth.uid();
  v_id := next_id('campaign', 'CMP-', 2);

  insert into campaigns (id, nombre, canal, objetivo, producto_foco_id, oferta,
                         fecha_inicio, fecha_fin, presupuesto, gasto_real,
                         estado, responsable, notas)
  values (v_id, trim(p->>'nombre'), p->>'canal', p->>'objetivo',
          nullif(p->>'producto_foco_id', ''), p->>'oferta',
          v_fi, v_ff, v_pres, v_gasto,
          coalesce(p->>'estado', 'Planeada'), p->>'responsable', p->>'notas');

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_actor, 'Campaña', v_id, 'Campaña creada', '', trim(p->>'nombre'));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.editar_campana(p_id text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v campaigns%rowtype;
  v_estado_prev text;
  v_actor text;
begin
  if is_staff() is not true then
    raise exception 'Solo staff activo puede editar campañas';
  end if;

  select * into v from campaigns where id = p_id for update;
  if not found then
    raise exception 'La campaña % no existe', p_id;
  end if;
  v_estado_prev := v.estado;

  -- PATCH: clave ausente = conservar; presente = aplicar (''/null limpia
  -- solo campos opcionales). Un caller parcial jamás borra por accidente.
  if p ? 'nombre' then v.nombre := trim(p->>'nombre'); end if;
  if coalesce(v.nombre, '') = '' then
    raise exception 'Falta el nombre de la campaña';
  end if;
  if p ? 'canal' then v.canal := p->>'canal'; end if;
  if v.canal is null or v.canal not in ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico') then
    raise exception 'Canal inválido: %', coalesce(v.canal, '(vacío)');
  end if;
  if p ? 'objetivo' then v.objetivo := p->>'objetivo'; end if;
  if v.objetivo is null or v.objetivo not in ('Ventas','Recompra','Lanzamiento','Cumpleaños','Tráfico WhatsApp','Branding') then
    raise exception 'Objetivo inválido: %', coalesce(v.objetivo, '(vacío)');
  end if;
  if p ? 'estado' then v.estado := p->>'estado'; end if;
  if v.estado is null or v.estado not in ('Planeada','Activa','Pausada','Finalizada') then
    raise exception 'Estado inválido: %', coalesce(v.estado, '(vacío)');
  end if;

  if p ? 'producto_foco_id' then v.producto_foco_id := nullif(p->>'producto_foco_id', ''); end if;
  if v.producto_foco_id is not null
     and not exists (select 1 from products where id = v.producto_foco_id) then
    raise exception 'El producto foco % no existe', v.producto_foco_id;
  end if;
  if p ? 'oferta' then v.oferta := nullif(p->>'oferta', ''); end if;
  if p ? 'responsable' then v.responsable := nullif(p->>'responsable', ''); end if;
  if p ? 'notas' then v.notas := nullif(p->>'notas', ''); end if;

  if p ? 'fecha_inicio' then
    begin
      v.fecha_inicio := nullif(trim(coalesce(p->>'fecha_inicio', '')), '')::date;
    exception when others then
      raise exception 'Fecha inicio inválida: %', p->>'fecha_inicio';
    end;
  end if;
  if p ? 'fecha_fin' then
    begin
      v.fecha_fin := nullif(trim(coalesce(p->>'fecha_fin', '')), '')::date;
    exception when others then
      raise exception 'Fecha fin inválida: %', p->>'fecha_fin';
    end;
  end if;
  if v.fecha_inicio is not null and v.fecha_fin is not null and v.fecha_fin < v.fecha_inicio then
    raise exception 'La fecha fin no puede ser anterior a la fecha inicio';
  end if;

  if p ? 'presupuesto' then
    begin
      v.presupuesto := coalesce(nullif(trim(coalesce(p->>'presupuesto', '')), '')::numeric, 0);
    exception when others then
      raise exception 'Presupuesto inválido: %', p->>'presupuesto';
    end;
  end if;
  if p ? 'gasto_real' then
    begin
      v.gasto_real := coalesce(nullif(trim(coalesce(p->>'gasto_real', '')), '')::numeric, 0);
    exception when others then
      raise exception 'Gasto real inválido: %', p->>'gasto_real';
    end;
  end if;
  if v.presupuesto < 0 or v.gasto_real < 0 then
    raise exception 'Presupuesto y gasto real no pueden ser negativos';
  end if;

  update campaigns set
    nombre = v.nombre, canal = v.canal, objetivo = v.objetivo,
    producto_foco_id = v.producto_foco_id, oferta = v.oferta,
    fecha_inicio = v.fecha_inicio, fecha_fin = v.fecha_fin,
    presupuesto = v.presupuesto, gasto_real = v.gasto_real,
    estado = v.estado, responsable = v.responsable, notas = v.notas
  where id = p_id;

  select id into v_actor from users where auth_id = auth.uid();
  if v.estado <> v_estado_prev then
    insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
    values (next_id('audit', 'A', 2), v_actor, 'Campaña', p_id, 'Cambio de estado', v_estado_prev, v.estado);
  else
    insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
    values (next_id('audit', 'A', 2), v_actor, 'Campaña', p_id, 'Campaña editada', '', v.nombre);
  end if;

  return jsonb_build_object('ok', true, 'cambio_estado', v.estado <> v_estado_prev);
end;
$$;

create or replace function public.set_campana_estado(p_id text, p_estado text)
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
    raise exception 'Solo staff activo puede cambiar el estado de campañas';
  end if;
  if p_estado is null or p_estado not in ('Planeada','Activa','Pausada','Finalizada') then
    raise exception 'Estado inválido: %', coalesce(p_estado, '(vacío)');
  end if;

  select estado into v_prev from campaigns where id = p_id for update;
  if not found then
    raise exception 'La campaña % no existe', p_id;
  end if;

  if v_prev = p_estado then
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'cambio', false);
  end if;

  update campaigns set estado = p_estado where id = p_id;

  select id into v_actor from users where auth_id = auth.uid();
  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_actor, 'Campaña', p_id, 'Cambio de estado', v_prev, p_estado);

  return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'cambio', true);
end;
$$;

-- RPCs públicas: revoke public/anon + grant explícito a authenticated
-- (el gate staff vive adentro y falla cerrado).
revoke execute on function public.crear_campana(jsonb) from public, anon;
grant execute on function public.crear_campana(jsonb) to authenticated;
revoke execute on function public.editar_campana(text, jsonb) from public, anon;
grant execute on function public.editar_campana(text, jsonb) to authenticated;
revoke execute on function public.set_campana_estado(text, text) from public, anon;
grant execute on function public.set_campana_estado(text, text) to authenticated;

-- Verificación esperada post-apply:
--   select proname, prosecdef from pg_proc where proname in
--     ('crear_campana','editar_campana','set_campana_estado');  → 3 filas, prosecdef=t
--   select column_name from information_schema.columns
--     where table_name='campaigns' and column_name='gasto_real'; → 1 fila
