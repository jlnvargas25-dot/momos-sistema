-- ============================================================================
-- usuarios_v1 — Hito 1 del slice Marketing+Usuarios (spec engram
-- momos/marketing-usuarios-spec): Config>Usuarios deja de escribir local.
--
--   · crear_usuario_staff(nombre, email, rol, sede?) → jsonb {ok, id}
--     Fila staff SIN login (auth_id NULL, decisión de Julián 2026-07-12):
--     aparece en dropdowns de responsable; vincular la cuenta de auth es
--     una tarea aparte. Sede default = la del admin que llama.
--   · set_user_activo(user_id, activo) → jsonb {ok, activo, cambio}
--     Toggle con no-op idempotente y ANTI-LOCKOUT: prohibido desactivar al
--     último Administrador activo (incluye auto-desactivación).
--
-- Reglas de la casa aplicadas:
--   · gates imperativos FAIL-CLOSED: `is_admin() is not true` (jamás `not
--     is_admin()` — hallazgo del juicio de variantes-3: NULL bypasea `not`).
--   · ids server-side vía next_id (counter 'user' ya existe, seed U01/U02).
--   · audit en la misma transacción, patrón de/a.
--   · revoke public/anon + grant explícito a authenticated (RPC pública).
-- ============================================================================

-- Respaldo real del pre-check de email duplicado (fix Ronda 1, Juez B): el
-- UNIQUE de la tabla es case-sensitive y NO cubre la carrera con casing
-- distinto; este índice funcional sí. Los emails existentes no colisionan
-- (la creación fallaría acá si lo hicieran — el dry-run lo prueba).
create unique index if not exists users_email_lower_key on users (lower(email));

create or replace function public.crear_usuario_staff(
  p_nombre text,
  p_email text,
  p_rol text,
  p_sede_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_sede text;
begin
  if is_admin() is not true then
    raise exception 'Solo un Administrador puede crear usuarios';
  end if;

  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'Falta el nombre del usuario';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'Falta el email del usuario';
  end if;
  -- Espejo amigable del CHECK users_rol_check (dominio cerrado en la tabla).
  if p_rol is null or p_rol not in ('Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque','Logística','Marketing/CRM','Mensajero') then
    raise exception 'Rol inválido: %', coalesce(p_rol, '(vacío)');
  end if;
  -- Chequeo amigable; el respaldo REAL ante la carrera es el índice único
  -- sobre lower(email) creado por esta misma migración (cubre también dos
  -- altas simultáneas con casing distinto — hallazgo del Juez B, Ronda 1).
  if exists (select 1 from users where lower(email) = lower(trim(p_email))) then
    raise exception 'Ya existe un usuario con el email %', trim(p_email);
  end if;

  v_sede := coalesce(p_sede_id, (select sede_id from users where auth_id = auth.uid()));
  if v_sede is null or not exists (select 1 from sedes where id = v_sede) then
    raise exception 'Sede inválida: %', coalesce(v_sede, '(vacía)');
  end if;

  v_id := next_id('user', 'U', 2);
  insert into users (id, auth_id, nombre, email, rol, activo, sede_id)
  values (v_id, null, trim(p_nombre), trim(p_email), p_rol, true, v_sede);

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2),
          (select id from users where auth_id = auth.uid()),
          'Usuario', v_id, 'Usuario creado', '', p_rol);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.set_user_activo(p_user_id text, p_activo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_activo boolean;
begin
  if is_admin() is not true then
    raise exception 'Solo un Administrador puede activar/desactivar usuarios';
  end if;
  if p_activo is null then
    raise exception 'Falta el estado destino (activo true/false)';
  end if;

  -- ORDEN DE LOCKS DETERMINÍSTICO (fix Ronda 1, Juez B): ante CUALQUIER
  -- desactivación se toma PRIMERO el lock del conjunto admin (order by id)
  -- y recién después el de la fila destino. Dos desactivaciones concurrentes
  -- se serializan en el mismo primer lock — el deadlock target-primero
  -- (T1 tiene X pide Y, T2 tiene Y pide X) queda imposible por construcción.
  -- Costo: lock de 1-3 filas en una tabla mínima.
  if p_activo is false then
    perform 1 from (
      select 1 from users where rol = 'Administrador' order by id for update
    ) s;
  end if;

  select rol, activo into v_rol, v_activo
  from users where id = p_user_id
  for update;
  if not found then
    raise exception 'El usuario % no existe', p_user_id;
  end if;

  if v_activo = p_activo then
    return jsonb_build_object('ok', true, 'activo', v_activo, 'cambio', false);
  end if;

  -- ANTI-LOCKOUT: nunca desactivar al último Administrador activo (el
  -- conjunto admin ya está lockeado arriba; este exists lee estado firme).
  if p_activo is false and v_rol = 'Administrador' then
    if not exists (
      select 1 from users
      where rol = 'Administrador' and activo and id <> p_user_id
    ) then
      raise exception 'No se puede desactivar al último Administrador activo';
    end if;
  end if;

  update users set activo = p_activo where id = p_user_id;

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2),
          (select id from users where auth_id = auth.uid()),
          'Usuario', p_user_id, 'Cambio de estado',
          case when v_activo then 'Activo' else 'Inactivo' end,
          case when p_activo then 'Activo' else 'Inactivo' end);

  return jsonb_build_object('ok', true, 'activo', p_activo, 'cambio', true);
end;
$$;

-- RPCs públicas: revoke public/anon + grant explícito a authenticated
-- (el gate admin vive adentro y falla cerrado).
revoke execute on function public.crear_usuario_staff(text, text, text, text) from public, anon;
grant execute on function public.crear_usuario_staff(text, text, text, text) to authenticated;
revoke execute on function public.set_user_activo(text, boolean) from public, anon;
grant execute on function public.set_user_activo(text, boolean) to authenticated;

-- Verificación esperada post-apply:
--   select proname, prosecdef from pg_proc
--     where proname in ('crear_usuario_staff','set_user_activo');   → 2 filas, prosecdef=t
--   (con anon) select crear_usuario_staff('x','y','Cocina');        → permission denied
