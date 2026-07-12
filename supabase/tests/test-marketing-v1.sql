-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · marketing_v1 (Hito 2
-- slice Marketing+Usuarios: crear_campana + editar_campana + set_campana_estado)
--
-- CÓMO CORRERLA: script completo en una transacción; termina SIEMPRE en error
-- «TESTS_OK — marketing-v1 bloques A-E PASS, rollback total» ⇒ PASS.
-- Fixtures sintéticos 'T-MKT *' creados por las propias RPCs (vía pública).
-- Requiere migración marketing_v1 aplicada; U01 admin activo (auth 992a7036…)
-- y U02 staff activo no-admin (el gate es is_staff, el bloque E lo prueba).
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_id text;
  v_prod text;
  v_err boolean;
  v_msg text;
  v_u02_auth uuid;
begin
  select id into v_prod from products where activo limit 1;
  assert v_prod is not null, 'PRE0 debe existir al menos un producto activo';

  -- ==========================================================================
  -- A. CREAR HAPPY PATH: campaña completa con producto foco → fila + audit;
  -- gasto_real default 0 cuando no viene.
  -- ==========================================================================
  r := crear_campana(jsonb_build_object(
    'nombre', 'T-MKT Lanzamiento', 'canal', 'Instagram', 'objetivo', 'Lanzamiento',
    'producto_foco_id', v_prod, 'oferta', '2x1 de prueba',
    'fecha_inicio', current_date::text, 'fecha_fin', (current_date + 15)::text,
    'presupuesto', 100000, 'estado', 'Activa', 'responsable', 'Marketing', 'notas', 'fixture'));
  assert (r->>'ok')::boolean and (r->>'id') like 'CMP-%', 'A1 crear debe suceder con id CMP-%';
  v_id := r->>'id';
  assert (select nombre = 'T-MKT Lanzamiento' and canal = 'Instagram' and objetivo = 'Lanzamiento'
            and producto_foco_id = v_prod and presupuesto = 100000 and gasto_real = 0
            and estado = 'Activa' from campaigns where id = v_id),
    'A2 la fila debe nacer con los valores enviados y gasto_real default 0';
  assert exists (select 1 from audit_logs where entidad = 'Campaña' and entidad_id = v_id
                 and accion = 'Campaña creada'),
    'A3 debe quedar el audit del alta';

  -- ==========================================================================
  -- B. VALIDACIONES: nombre vacío, canal/objetivo/estado fuera de dominio,
  -- presupuesto negativo, fechas invertidas, producto foco inexistente.
  -- ==========================================================================
  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', '  ', 'canal', 'Instagram', 'objetivo', 'Ventas'));
  exception when others then v_err := true; end;
  assert v_err, 'B1 nombre vacío debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B2', 'canal', 'Telegram', 'objetivo', 'Ventas'));
  exception when others then v_err := true; end;
  assert v_err, 'B2 canal fuera del dominio debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B3', 'canal', 'Instagram', 'objetivo', 'Dominar el mundo'));
  exception when others then v_err := true; end;
  assert v_err, 'B3 objetivo fuera del dominio debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B4', 'canal', 'Instagram', 'objetivo', 'Ventas', 'estado', 'Zombie'));
  exception when others then v_err := true; end;
  assert v_err, 'B4 estado fuera del dominio debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B5', 'canal', 'Instagram', 'objetivo', 'Ventas', 'presupuesto', -1));
  exception when others then v_err := true; end;
  assert v_err, 'B5 presupuesto negativo debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B6', 'canal', 'Instagram', 'objetivo', 'Ventas',
    'fecha_inicio', current_date::text, 'fecha_fin', (current_date - 1)::text));
  exception when others then v_err := true; end;
  assert v_err, 'B6 fecha fin anterior a inicio debe rechazarse';

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B7', 'canal', 'Instagram', 'objetivo', 'Ventas', 'producto_foco_id', 'PR-NOEXISTE'));
  exception when others then v_err := true; end;
  assert v_err, 'B7 producto foco inexistente debe rechazarse';

  -- Casts defendidos (fix Ronda 1): basura → mensaje de dominio, jamás el
  -- error crudo de Postgres; '' en fecha = sin fecha (form vacío).
  v_err := false; v_msg := '';
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B9', 'canal', 'Instagram', 'objetivo', 'Ventas', 'fecha_inicio', 'no-es-fecha'));
  exception when others then v_err := true; v_msg := sqlerrm; end;
  assert v_err and v_msg like 'Fecha inicio inválida%',
    'B9 fecha basura debe rechazarse con mensaje de dominio, no error crudo';

  v_err := false; v_msg := '';
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT B10', 'canal', 'Instagram', 'objetivo', 'Ventas', 'presupuesto', 'abc'));
  exception when others then v_err := true; v_msg := sqlerrm; end;
  assert v_err and v_msg like 'Presupuesto inválido%',
    'B10 presupuesto basura debe rechazarse con mensaje de dominio';

  r := crear_campana(jsonb_build_object('nombre', 'T-MKT B11 sin fechas', 'canal', 'Instagram', 'objetivo', 'Ventas', 'fecha_inicio', '', 'fecha_fin', ''));
  assert (select fecha_inicio is null and fecha_fin is null from campaigns where id = r->>'id'),
    'B11 fecha vacía ('''') debe tratarse como sin fecha, no reventar';

  assert (select count(*) from campaigns where nombre like 'T-MKT B%') = 1
         and exists (select 1 from campaigns where nombre = 'T-MKT B11 sin fechas'),
    'B8 los rechazos no deben dejar filas (la única B es la B11 legítima)';

  -- ==========================================================================
  -- C. EDITAR: cambio de campos sin estado → audit 'Campaña editada';
  -- cambio de estado vía editar → audit 'Cambio de estado' de/a;
  -- gasto_real editable; inexistente rechazado.
  -- ==========================================================================
  r := editar_campana(v_id, jsonb_build_object(
    'nombre', 'T-MKT Lanzamiento v2', 'canal', 'Instagram', 'objetivo', 'Lanzamiento',
    'producto_foco_id', v_prod, 'oferta', '2x1', 'fecha_inicio', current_date::text,
    'fecha_fin', (current_date + 15)::text, 'presupuesto', 120000, 'gasto_real', 35000,
    'estado', 'Activa', 'responsable', 'Marketing', 'notas', 'editada'));
  assert (r->>'ok')::boolean and not (r->>'cambio_estado')::boolean,
    'C1 editar sin cambio de estado debe reportar cambio_estado=false';
  assert (select presupuesto = 120000 and gasto_real = 35000 and nombre = 'T-MKT Lanzamiento v2'
          from campaigns where id = v_id),
    'C2 presupuesto, gasto_real y nombre deben quedar actualizados';
  assert exists (select 1 from audit_logs where entidad = 'Campaña' and entidad_id = v_id
                 and accion = 'Campaña editada'),
    'C3 debe quedar el audit de edición';

  r := editar_campana(v_id, jsonb_build_object(
    'nombre', 'T-MKT Lanzamiento v2', 'canal', 'Instagram', 'objetivo', 'Lanzamiento',
    'producto_foco_id', v_prod, 'oferta', '2x1', 'fecha_inicio', current_date::text,
    'fecha_fin', (current_date + 15)::text, 'presupuesto', 120000, 'gasto_real', 35000,
    'estado', 'Pausada', 'responsable', 'Marketing', 'notas', 'editada'));
  assert (r->>'cambio_estado')::boolean, 'C4 editar con cambio de estado debe reportarlo';
  assert exists (select 1 from audit_logs where entidad = 'Campaña' and entidad_id = v_id
                 and accion = 'Cambio de estado' and de = 'Activa' and a = 'Pausada'),
    'C5 debe quedar el audit Activa → Pausada';

  v_err := false;
  begin r := editar_campana('CMP-NOEXISTE', jsonb_build_object('nombre', 'x', 'canal', 'Instagram', 'objetivo', 'Ventas'));
  exception when others then v_err := true; end;
  assert v_err, 'C6 editar campaña inexistente debe rechazarse';

  -- PATCH (fix Ronda 1): un payload parcial NO borra los campos ausentes.
  r := editar_campana(v_id, jsonb_build_object('gasto_real', 50000));
  assert (r->>'ok')::boolean and not (r->>'cambio_estado')::boolean,
    'C7 editar parcial debe suceder sin cambio de estado';
  assert (select gasto_real = 50000 and nombre = 'T-MKT Lanzamiento v2' and producto_foco_id = v_prod
            and oferta = '2x1' and fecha_inicio is not null and presupuesto = 120000
          from campaigns where id = v_id),
    'C7b el payload parcial solo toca gasto_real — nombre, foco, oferta, fechas y presupuesto intactos';

  -- ==========================================================================
  -- D. SET ESTADO: cambio con audit; no-op idempotente sin audit duplicado;
  -- estado inválido rechazado.
  -- ==========================================================================
  r := set_campana_estado(v_id, 'Activa');
  assert (r->>'cambio')::boolean and (r->>'de') = 'Pausada' and (r->>'a') = 'Activa',
    'D1 reactivar debe reportar de Pausada a Activa';
  assert (select estado from campaigns where id = v_id) = 'Activa', 'D2 el estado debe quedar Activa';

  r := set_campana_estado(v_id, 'Activa');
  assert not (r->>'cambio')::boolean, 'D3 repetir el mismo estado es no-op';
  assert (select count(*) from audit_logs where entidad = 'Campaña' and entidad_id = v_id
          and accion = 'Cambio de estado') = 2,
    'D4 el no-op no debe duplicar audits (van 2: editar C4 + D1)';

  v_err := false;
  begin r := set_campana_estado(v_id, 'Cancelada');
  exception when others then v_err := true; end;
  assert v_err, 'D5 estado fuera del dominio debe rechazarse';

  -- ==========================================================================
  -- E. GATE is_staff: U02 (staff activo NO admin) SÍ puede crear — el gate
  -- es staff, no admin; un sub desconocido (sin fila en users) es rechazado
  -- por las TRES RPCs sin tocar nada.
  -- ==========================================================================
  select auth_id into v_u02_auth from users where id = 'U02';
  assert v_u02_auth is not null,
    'PRE-E U02 debe existir con auth_id — precondición explícita del gate staff (fix Ronda 1: sin if silencioso)';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u02_auth, 'role', 'authenticated')::text, true);
  r := crear_campana(jsonb_build_object('nombre', 'T-MKT staff', 'canal', 'WhatsApp', 'objetivo', 'Recompra'));
  assert (r->>'ok')::boolean, 'E1 staff activo no-admin debe poder crear (gate is_staff)';

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);

  v_err := false;
  begin r := crear_campana(jsonb_build_object('nombre', 'T-MKT intruso', 'canal', 'Instagram', 'objetivo', 'Ventas'));
  exception when others then v_err := true; end;
  assert v_err, 'E2 un no-staff no puede crear campañas';

  v_err := false;
  begin r := set_campana_estado(v_id, 'Pausada');
  exception when others then v_err := true; end;
  assert v_err, 'E3 un no-staff no puede cambiar estados';

  v_err := false;
  begin r := editar_campana(v_id, jsonb_build_object('nombre', 'hack', 'canal', 'Instagram', 'objetivo', 'Ventas'));
  exception when others then v_err := true; end;
  assert v_err, 'E4 un no-staff no puede editar';

  perform set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
  assert not exists (select 1 from campaigns where nombre = 'T-MKT intruso'),
    'E5 el rechazo del intruso no debe dejar fila';
  assert (select estado from campaigns where id = v_id) = 'Activa',
    'E6 el rechazo del intruso no debe haber tocado el estado';

  raise exception 'TESTS_OK — marketing-v1 bloques A-E PASS, rollback total';
end $$;
