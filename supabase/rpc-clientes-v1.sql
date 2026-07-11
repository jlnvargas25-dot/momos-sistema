-- ============================================================================
-- MOMOS OPS — RPC de clientes / CRM (v1)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas: schema-v5.sql.
-- Fuente de verdad de lógica: src/MomosOps.jsx, componente Clientes
-- (guardarCliente, ~línea 3747-3765).
--
-- Alcance v1: SOLO el flujo standalone del CRM (alta/edición de un cliente
-- desde el módulo Clientes). La creación INLINE de cliente nuevo al tomar un
-- pedido YA está resuelta server-side: crear_pedido (rpc-pedidos-v1.sql,
-- líneas 456-472) hace next_id('customer','C',2) + insert en customers +
-- audit 'Cliente creado' cuando el payload trae nuevo_cliente sin customer_id.
-- Confirmado leyendo el cuerpo de esa función — no hay gap ahí, es un camino
-- de escritura server-side distinto y ya cerrado desde el slice 3b.
--
-- Esta RPC cubre el hueco restante: editar un cliente existente, o darlo de
-- alta a mano como lead SIN pasar por un pedido (botón "＋ nuevo cliente" del
-- módulo CRM). upsert_cliente por prefijo/padding IDÉNTICO al de crear_pedido
-- ('C', pad 2) — mismo contador `counters` (clave 'customer'), sin colisión.
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- upsert_cliente(p_customer_id, p jsonb) returns text (id del cliente)
--
-- p_customer_id NULL/vacío → alta (next_id server-side, ignora cualquier id
-- que el cliente mande en el payload). p_customer_id con valor → edición de
-- fila existente (error si no existe: evita upsert fantasma sobre un id
-- inventado por el front).
--
-- Payload p (mismos campos que `campos` en guardarCliente, snake_case):
--   nombre*, telefono*, instagram, canal, barrio, direccion, cumple,
--   favoritos, estado, notas.
--   (*) obligatorios — mismo guard que la maqueta: "Nombre y teléfono son
--   obligatorios."
--
-- Campos derivados (primera/ultima/total/pedidos/estado por defecto) NO se
-- tocan en edición — son terreno de set_order_status (Entregado/Cancelado)
-- y de la primera creación. En alta arrancan en 0/'' como en la maqueta.
-- ---------------------------------------------------------------------------
create or replace function upsert_cliente(p_customer_id text, p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := trim(coalesce(p->>'nombre',''));
  v_telefono text := trim(coalesce(p->>'telefono',''));
  v_estado text;
  v_id text;
  v_existe customers%rowtype;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear o editar clientes';
  end if;

  if v_nombre = '' or v_telefono = '' then
    raise exception 'Nombre y teléfono son obligatorios.';
  end if;

  v_estado := coalesce(nullif(p->>'estado',''), 'Nuevo');
  if v_estado not in ('Nuevo','Recurrente','VIP','Riesgo por reclamos','Inactivo') then
    raise exception 'Estado de cliente inválido: %', v_estado;
  end if;
  if nullif(p->>'canal','') is not null and p->>'canal' not in ('WhatsApp','Instagram','Rappi','Directo') then
    raise exception 'Canal inválido: %', p->>'canal';
  end if;
  -- Pre-validación amigable del CHECK de la tabla (cumple = '' o 'MM-DD'):
  -- sin esto, un typo del form revienta con el error nativo del constraint.
  if coalesce(p->>'cumple','') <> '' and p->>'cumple' !~ '^\d{2}-\d{2}$' then
    raise exception 'Cumpleaños inválido (formato MM-DD): %', p->>'cumple';
  end if;

  v_id := nullif(p_customer_id, '');

  if v_id is not null then
    select * into v_existe from customers where id = v_id for update;
    if v_existe.id is null then
      raise exception 'El cliente % no existe', v_id;
    end if;

    update customers set
      nombre    = v_nombre,
      telefono  = v_telefono,
      instagram = coalesce(p->>'instagram', ''),
      canal     = nullif(p->>'canal',''),
      barrio    = coalesce(p->>'barrio', ''),
      direccion = coalesce(p->>'direccion', ''),
      cumple    = coalesce(p->>'cumple', ''),
      favoritos = coalesce(p->>'favoritos', ''),
      estado    = v_estado,
      notas     = coalesce(p->>'notas', '')
    where id = v_id;

    perform _add_audit('Cliente', v_id, 'Cliente editado', '', v_nombre);
    return v_id;
  else
    -- Idempotencia (doble click / reintento del UI): mismo nombre+teléfono
    -- exactos = misma alta; se devuelve el cliente existente sin duplicar.
    select id into v_id from customers
    where nombre = v_nombre and telefono = v_telefono
    order by id limit 1;
    if v_id is not null then
      return v_id;
    end if;

    v_id := next_id('customer', 'C', 2);
    insert into customers (
      id, nombre, telefono, instagram, canal, barrio, direccion,
      cumple, favoritos, estado, notas, primera, ultima, total, pedidos
    ) values (
      v_id, v_nombre, v_telefono, coalesce(p->>'instagram',''), nullif(p->>'canal',''),
      coalesce(p->>'barrio',''), coalesce(p->>'direccion',''), coalesce(p->>'cumple',''),
      coalesce(p->>'favoritos',''), v_estado, coalesce(p->>'notas',''),
      null, null, 0, 0
    );

    perform _add_audit('Cliente', v_id, 'Cliente creado a mano (lead)', '', v_nombre);
    return v_id;
  end if;
end $$;

revoke execute on function upsert_cliente(text, jsonb) from public, anon;
grant execute on function upsert_cliente(text, jsonb) to authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname='upsert_cliente'; → 1 fila, prosecdef=t
--   (con anon) select upsert_cliente(null, '{"nombre":"x","telefono":"1"}'::jsonb); → permission denied
