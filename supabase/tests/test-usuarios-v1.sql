-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · usuarios_v1 (Hito 1
-- slice Marketing+Usuarios: crear_usuario_staff + set_user_activo)
--
-- CÓMO CORRERLA: script completo en una transacción; termina SIEMPRE en error
-- «TESTS_OK — usuarios-v1 bloques A-E PASS, rollback total» ⇒ PASS.
-- Fixtures sintéticos 'T-USR-*' (email @test.local). Requiere migración
-- usuarios_v1 aplicada; U01 Administrador activo con auth 992a7036-….
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_id1 text;
  v_id2 text;
  v_err boolean;
  v_msg text;
begin
  -- ==========================================================================
  -- A. ALTA HAPPY PATH: fila staff sin login, sede heredada del admin que
  -- llama, audit; el email duplicado (aun con otra caja) se rechaza.
  -- ==========================================================================
  r := crear_usuario_staff('Test Uno', 't-usr-1@test.local', 'Cocina');
  assert (r->>'ok')::boolean and (r->>'id') is not null, 'A1 el alta debe suceder y devolver id';
  v_id1 := r->>'id';
  assert v_id1 like 'U%', 'A2 el id debe salir del counter user (prefijo U)';
  assert (select auth_id is null and activo and rol = 'Cocina' and sede_id = 'SEDE-01'
            and nombre = 'Test Uno' and email = 't-usr-1@test.local'
          from users where id = v_id1),
    'A3 la fila debe nacer sin login (auth_id NULL), activa, con la sede del admin creador';
  assert exists (select 1 from audit_logs where entidad = 'Usuario' and entidad_id = v_id1
                 and accion = 'Usuario creado' and a = 'Cocina'),
    'A4 debe quedar el audit del alta';

  v_err := false;
  begin
    r := crear_usuario_staff('Test Dup', 'T-USR-1@TEST.LOCAL', 'Empaque');
  exception when others then
    v_err := true;
  end;
  assert v_err, 'A5 el email duplicado (case-insensitive) debe rechazarse';

  assert exists (select 1 from pg_indexes where tablename = 'users'
                 and indexname = 'users_email_lower_key'),
    'A6 debe existir el índice único lower(email) — respaldo real de la carrera con casing distinto';

  -- ==========================================================================
  -- B. VALIDACIONES DEL ALTA: nombre vacío, email vacío, rol fuera del
  -- dominio y sede inexistente se rechazan sin dejar fila.
  -- ==========================================================================
  v_err := false;
  begin r := crear_usuario_staff('   ', 't-usr-b1@test.local', 'Cocina');
  exception when others then v_err := true; end;
  assert v_err, 'B1 nombre vacío debe rechazarse';

  v_err := false;
  begin r := crear_usuario_staff('Test B2', '', 'Cocina');
  exception when others then v_err := true; end;
  assert v_err, 'B2 email vacío debe rechazarse';

  v_err := false;
  begin r := crear_usuario_staff('Test B3', 't-usr-b3@test.local', 'Gerente');
  exception when others then v_err := true; end;
  assert v_err, 'B3 rol fuera del dominio debe rechazarse';

  v_err := false;
  begin r := crear_usuario_staff('Test B4', 't-usr-b4@test.local', 'Cocina', 'SEDE-NOEXISTE');
  exception when others then v_err := true; end;
  assert v_err, 'B4 sede inexistente debe rechazarse';

  assert not exists (select 1 from users where email like 't-usr-b%@test.local'),
    'B5 los rechazos no deben dejar filas';

  -- ==========================================================================
  -- C. TOGGLE: desactivar → audit de/a; repetir es no-op sin audit duplicado;
  -- reactivar vuelve; usuario inexistente se rechaza.
  -- ==========================================================================
  r := set_user_activo(v_id1, false);
  assert (r->>'ok')::boolean and (r->>'cambio')::boolean and not (r->>'activo')::boolean,
    'C1 desactivar debe suceder y reportar cambio';
  assert (select not activo from users where id = v_id1), 'C2 la fila debe quedar inactiva';
  assert exists (select 1 from audit_logs where entidad = 'Usuario' and entidad_id = v_id1
                 and accion = 'Cambio de estado' and de = 'Activo' and a = 'Inactivo'),
    'C3 debe quedar el audit Activo → Inactivo';

  r := set_user_activo(v_id1, false);
  assert (r->>'ok')::boolean and not (r->>'cambio')::boolean,
    'C4 repetir el mismo estado es no-op (cambio=false)';
  assert (select count(*) from audit_logs where entidad = 'Usuario' and entidad_id = v_id1
          and accion = 'Cambio de estado') = 1,
    'C5 el no-op no debe duplicar el audit';

  r := set_user_activo(v_id1, true);
  assert (r->>'cambio')::boolean and (select activo from users where id = v_id1),
    'C6 reactivar debe volver a Activo';

  v_err := false;
  begin r := set_user_activo('T-USR-NOEXISTE', false);
  exception when others then v_err := true; end;
  assert v_err, 'C7 usuario inexistente debe rechazarse';

  -- ==========================================================================
  -- D. ANTI-LOCKOUT: con un segundo admin activo, desactivarlo es legal;
  -- cuando U01 queda como ÚNICO admin activo, desactivarlo debe fallar
  -- (incluida la auto-desactivación — U01 es quien llama).
  -- ==========================================================================
  r := crear_usuario_staff('Test Admin 2', 't-usr-a2@test.local', 'Administrador');
  v_id2 := r->>'id';

  r := set_user_activo(v_id2, false);
  assert (r->>'cambio')::boolean,
    'D1 desactivar a un admin cuando queda otro activo (U01) es legal';

  v_err := false; v_msg := '';
  begin
    r := set_user_activo('U01', false);
  exception when others then
    v_err := true; v_msg := sqlerrm;
  end;
  assert v_err and v_msg like '%último Administrador activo%',
    'D2 desactivar al último admin activo debe fallar con el mensaje anti-lockout';
  assert (select activo from users where id = 'U01'),
    'D3 U01 debe seguir activo tras el rechazo';

  -- ==========================================================================
  -- E. GATE DE SEGURIDAD (regla is not true): un sub que no existe en users
  -- (para is_admin, lo mismo que un empleado no-admin: rol NULL/no admin)
  -- debe ser rechazado por AMBAS RPCs sin tocar nada.
  -- ==========================================================================
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);

  v_err := false;
  begin r := crear_usuario_staff('Test Intruso', 't-usr-e1@test.local', 'Cocina');
  exception when others then v_err := true; end;
  assert v_err, 'E1 un no-admin no puede crear usuarios';

  v_err := false;
  begin r := set_user_activo(v_id1, false);
  exception when others then v_err := true; end;
  assert v_err, 'E2 un no-admin no puede activar/desactivar';

  perform set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
  assert not exists (select 1 from users where email = 't-usr-e1@test.local'),
    'E3 el rechazo del intruso no debe dejar fila';
  assert (select activo from users where id = v_id1),
    'E4 el rechazo del intruso no debe haber tocado el estado';

  raise exception 'TESTS_OK — usuarios-v1 bloques A-E PASS, rollback total';
end $$;
