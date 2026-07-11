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
-- DEPENDENCIA (desde normalizacion-clientes-v1.sql, 2026-07-11): el cuerpo de
-- abajo usa _normalizar_telefono() y el índice único parcial
-- customers_telefono_unique_idx. Ejecutar normalizacion-clientes-v1.sql
-- ANTES de reaplicar este mirror standalone en una base nueva.
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
--
-- v2 (normalizacion-clientes-v1.sql, 2026-07-11): teléfono se normaliza a
-- E.164 colombiano vía _normalizar_telefono() y el dedupe pasa a ser por
-- teléfono normalizado (antes era nombre+teléfono exacto). instagram se
-- limpia a handle pelado. cumple valida rango real (MM 01-12, DD 01-31),
-- no solo el shape. nombre colapsa espacios internos múltiples. Detalle
-- completo de las decisiones de normalización: ver el header de
-- normalizacion-clientes-v1.sql — ese archivo es la fuente de verdad de
-- ESTA versión del cuerpo; este archivo es su mirror sincronizado.
-- ---------------------------------------------------------------------------
create or replace function upsert_cliente(p_customer_id text, p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := trim(regexp_replace(coalesce(p->>'nombre',''), '\s+', ' ', 'g'));
  v_telefono text := _normalizar_telefono(p->>'telefono');
  v_instagram text;
  v_cumple text := coalesce(p->>'cumple','');
  v_estado text;
  v_id text;
  v_existe customers%rowtype;
  v_dueno_actual text;
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

  -- Instagram: lowercase, sin '@', sin forma URL (instagram.com/handle, con o
  -- sin https/www, con o sin slash/query final) → handle pelado.
  v_instagram := lower(trim(coalesce(p->>'instagram', '')));
  if v_instagram <> '' then
    v_instagram := regexp_replace(v_instagram, '^(https?://)?(www\.)?instagram\.com/', '');
    v_instagram := regexp_replace(v_instagram, '^@', '');
    v_instagram := regexp_replace(v_instagram, '[/?].*$', '');
  end if;

  -- Pre-validación amigable del CHECK de la tabla (cumple = '' o 'MM-DD'):
  -- se tighten acá a rangos reales (MM 01-12, DD 01-31) — el CHECK de la
  -- tabla solo exige el shape \d{2}-\d{2}, esta RPC es más estricta a
  -- propósito, sin tocar el constraint de la tabla.
  if v_cumple <> '' then
    if v_cumple !~ '^\d{2}-\d{2}$' then
      raise exception 'Cumpleaños inválido (formato MM-DD): %', v_cumple;
    end if;
    if split_part(v_cumple,'-',1)::int not between 1 and 12
       or split_part(v_cumple,'-',2)::int not between 1 and 31 then
      raise exception 'Cumpleaños inválido (mes o día fuera de rango): %', v_cumple;
    end if;
  end if;

  v_id := nullif(p_customer_id, '');

  if v_id is not null then
    select * into v_existe from customers where id = v_id for update;
    if v_existe.id is null then
      raise exception 'El cliente % no existe', v_id;
    end if;

    -- Pre-check amigable: si el teléfono normalizado ya es de OTRO cliente,
    -- no dejamos que reviente el unique_violation crudo del índice.
    select id into v_dueno_actual from customers
    where telefono = v_telefono and id <> v_id;
    if v_dueno_actual is not null then
      raise exception 'Ese teléfono ya pertenece a otro cliente (%).', v_dueno_actual;
    end if;

    update customers set
      nombre    = v_nombre,
      telefono  = v_telefono,
      instagram = v_instagram,
      canal     = nullif(p->>'canal',''),
      barrio    = coalesce(p->>'barrio', ''),
      direccion = trim(coalesce(p->>'direccion', '')),
      cumple    = v_cumple,
      favoritos = coalesce(p->>'favoritos', ''),
      estado    = v_estado,
      notas     = coalesce(p->>'notas', '')
    where id = v_id;

    perform _add_audit('Cliente', v_id, 'Cliente editado', '', v_nombre);
    return v_id;
  else
    -- Idempotencia (doble click / reintento del UI, y dedupe real de leads):
    -- mismo teléfono normalizado = mismo cliente; se devuelve el existente
    -- sin duplicar, sin importar si el nombre vino distinto o mal tipeado.
    select id into v_id from customers
    where telefono = v_telefono
    order by id limit 1;
    if v_id is not null then
      return v_id;
    end if;

    v_id := next_id('customer', 'C', 2);

    -- Alta bajo carrera: dos requests concurrentes con el mismo teléfono
    -- normalizado pueden pasar ambas el SELECT de idempotencia de arriba; el
    -- índice único customers_telefono_unique_idx (sección 3) es el árbitro
    -- real — la perdedora reusa el id ya creado por la ganadora, en vez de
    -- reventar con un unique_violation crudo. Mismo patrón que crear_lote()
    -- en rpc-produccion-v1.sql.
    begin
      insert into customers (
        id, nombre, telefono, instagram, canal, barrio, direccion,
        cumple, favoritos, estado, notas, primera, ultima, total, pedidos
      ) values (
        v_id, v_nombre, v_telefono, v_instagram, nullif(p->>'canal',''),
        coalesce(p->>'barrio',''), trim(coalesce(p->>'direccion','')), v_cumple,
        coalesce(p->>'favoritos',''), v_estado, coalesce(p->>'notas',''),
        null, null, 0, 0
      );
    exception when unique_violation then
      select id into v_id from customers where telefono = v_telefono order by id limit 1;
      if v_id is not null then
        return v_id;
      end if;
      raise;  -- otra violación de unicidad (p.ej. PK): no es idempotencia, propagar
    end;

    perform _add_audit('Cliente', v_id, 'Cliente creado a mano (lead)', '', v_nombre);
    return v_id;
  end if;
end $$;

revoke execute on function upsert_cliente(text, jsonb) from public, anon;
grant execute on function upsert_cliente(text, jsonb) to authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname='upsert_cliente'; → 1 fila, prosecdef=t
--   (con anon) select upsert_cliente(null, '{"nombre":"x","telefono":"1"}'::jsonb); → permission denied
