-- ============================================================================
-- MOMOS OPS — Normalización de datos de clientes (v1) — 2026-07-11
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas: schema-v5.sql.
-- Fuente de verdad de lógica: upsert_cliente (rpc-clientes-v1.sql) y crear_pedido
-- (rpc-pedidos-v1.sql, rama nuevo_cliente).
--
-- REGLA DE ORO (spec aprobada por Julián, 2026-07-11): la normalización vive
-- SERVER-SIDE, dentro de las RPCs. El front NUNCA normaliza — solo manda lo
-- que el usuario tipeó. Así cualquier cliente (OPS hoy, Pide MOMOS mañana,
-- un curl directo) obtiene el mismo dato limpio, sin depender de JS duplicado.
--
-- Alcance: teléfono → E.164 colombiano, dedupe de clientes por teléfono
-- normalizado, instagram → handle limpio, cumple → validación de rango real,
-- nombre → espacios colapsados, dirección → trim, y un hueco de seguridad en
-- crear_pedido (precio de adición negativo = descuento inyectado).
--
-- Este archivo se ejecuta UNA VEZ, de punta a punta, en este orden:
--   1) _normalizar_telefono (helper interno)
--   2) UPDATE de normalización sobre customers.telefono existentes
--   3) índice único parcial sobre customers.telefono
--   4) upsert_cliente v2 (CREATE OR REPLACE completo)
--   5) crear_pedido (CREATE OR REPLACE completo, con la rama nuevo_cliente y
--      las validaciones de adiciones parcheadas — el resto queda byte-idéntico
--      a rpc-pedidos-v1.sql)
--
-- NO EJECUTAR contra ninguna base desde el editor/asistente — archivo de
-- definición únicamente. Ejecutar a mano en el SQL Editor de Supabase.
--
-- VENTANA DE EJECUCIÓN: este archivo debe correr SIN escrituras concurrentes
-- sobre customers (ventana breve) — el UPDATE de normalización (sección 2) y
-- la creación del índice único (sección 3) asumen que ningún alta/edición de
-- cliente corre en paralelo. Si se reaplica esta migración a mano y luego se
-- CAMBIA la definición del índice de la sección 3, un `create index if not
-- exists` NO reconstruye nada — Postgres solo chequea que el NOMBRE ya
-- exista, no compara definiciones. Un cambio de índice real requiere
-- `drop index` explícito antes de recrearlo.
-- ============================================================================

-- TRANSACCIÓN EXPLÍCITA: todo el archivo corre dentro de un único begin/commit
-- — si cualquier statement de acá abajo falla a mitad de camino (incluido el
-- guard de colisiones de la sección 2), Postgres revierte TODO: no queda el
-- helper creado sin el índice, ni el índice sin las RPCs actualizadas.
begin;

-- ============================================================================
-- 1) _normalizar_telefono(text) returns text
--
-- Decisiones de normalización (documentadas acá porque son las que definen
-- el comportamiento, no solo el "qué hace" del código):
--
--   a) Se despoja todo lo que no sea dígito (espacios, guiones, paréntesis,
--      '+'). Un teléfono es una secuencia de dígitos; el resto es formato.
--   b) Si after-strip empieza con '00' (prefijo internacional de marcado,
--      no de E.164), se le saca ese '00' ANTES de evaluar el resto — '0057...'
--      se trata como si el usuario hubiese tipeado '57...'.
--   c) Si el resultado empieza con '57' y mide 12 dígitos exacto (57 + 10
--      dígitos de número colombiano) → ya está en E.164, se deja tal cual.
--   d) Si mide exactamente 10 dígitos (número colombiano sin indicativo de
--      país) → se le antepone '57'.
--   e) Vacío → se devuelve '' (no hay teléfono, no es un error).
--   f) CUALQUIER OTRA FORMA (longitudes raras, extranjeros, typos con dígitos
--      de más o de menos) → se guardan los dígitos ya despojados, TAL CUAL,
--      sin adivinar y SIN LANZAR EXCEPCIÓN. Justificación de negocio: un
--      teléfono con forma rara no puede bloquear una venta — MOMOS prefiere
--      guardar un dato imperfecto (y corregible a mano después) a perder el
--      pedido completo por un constraint. Este es el único punto de la spec
--      donde "no adivinar" significa "no forzar a 10/12 dígitos", no "fallar".
--
-- IMMUTABLE: la salida depende solo del argumento (sin acceso a tablas ni al
-- reloj) — habilita su uso en la definición del índice único parcial de la
-- sección 3 sin que Postgres se queje de funciones no deterministas.
--
-- INTERNO: revoke de public, anon Y authenticated. Solo lo llaman las RPCs
-- definer de abajo (mismo patrón que fix-grants-v1.sql, sección de defensa en
-- profundidad — el default privilege de Supabase otorga EXECUTE a
-- authenticated en toda función nueva; hay que revocarlo a mano).
-- ============================================================================

create or replace function _normalizar_telefono(p_telefono text) returns text
language plpgsql immutable as $$
declare
  v_digitos text;
begin
  v_digitos := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');

  if v_digitos = '' then
    return '';
  end if;

  if left(v_digitos, 2) = '00' then
    v_digitos := substring(v_digitos from 3);
  end if;

  if left(v_digitos, 2) = '57' and length(v_digitos) = 12 then
    return v_digitos;
  end if;

  if length(v_digitos) = 10 then
    return '57' || v_digitos;
  end if;

  -- Forma no reconocida: se guardan los dígitos despojados tal cual (ver
  -- decisión f arriba). No es un error — es un dato imperfecto que no debe
  -- bloquear la venta.
  return v_digitos;
end $$;

revoke execute on function _normalizar_telefono(text) from public, anon, authenticated;

-- ============================================================================
-- 2) Normalización de los teléfonos ya existentes en customers.
--
-- Verificado antes de escribir este archivo: hoy solo hay 2 filas con
-- teléfono no vacío (C09, C10) y CERO colisiones entre sus formas
-- normalizadas — el UPDATE de abajo no puede disparar el índice único de la
-- sección 3 (que se crea DESPUÉS, a propósito, para no correr el riesgo de
-- que este UPDATE choque contra un índice que todavía no reflejaba data
-- vieja sin normalizar).
--
-- GUARD previo al UPDATE: si la base tuviera más filas de las verificadas
-- arriba (o corriera en otro entorno), dos teléfonos con formas DISTINTAS hoy
-- pueden normalizar al MISMO valor (p.ej. '3001234567' y '+57 300 123 4567').
-- Ese caso rompería el UPDATE de abajo con un unique_violation tardío recién
-- al crear el índice de la sección 3 — o, peor, el UPDATE simplemente no
-- puede escribir dos filas con el mismo telefono aunque el índice todavía no
-- exista, porque igual violaría la futura unicidad de negocio. Este bloque
-- aborta ANTES, con un mensaje que lista los valores en colisión, en vez de
-- dejar el UPDATE a medio aplicar.
-- ============================================================================

do $$
declare
  v_colisiones text;
begin
  select string_agg(dup.telefono_norm || ' (' || dup.cant || ' clientes)', ', ')
    into v_colisiones
  from (
    select _normalizar_telefono(telefono) as telefono_norm, count(*) as cant
    from customers
    -- Filtro por el valor NORMALIZADO (no el raw): un teléfono-basura sin
    -- dígitos normaliza a '' y el índice lo excluye — no es colisión real.
    where _normalizar_telefono(telefono) <> ''
    group by _normalizar_telefono(telefono)
    having count(*) > 1
  ) dup;

  if v_colisiones is not null then
    raise exception 'Normalización de teléfono abortada: hay teléfonos que colisionan tras normalizar: %. Resolvé el duplicado a mano antes de reaplicar este archivo.', v_colisiones;
  end if;
end $$;

update customers
set telefono = _normalizar_telefono(telefono)
where telefono <> _normalizar_telefono(telefono);

-- ============================================================================
-- 3) Índice único parcial: un teléfono normalizado no puede pertenecer a más
-- de un cliente. Parcial (WHERE telefono <> '') porque múltiples clientes
-- con teléfono vacío SÍ son válidos (leads incompletos, alta a mano sin
-- dato todavía) — no queremos que '' colisione contra sí mismo.
-- ============================================================================

create unique index if not exists customers_telefono_unique_idx
  on customers (telefono)
  where telefono <> '';

-- ============================================================================
-- 4) upsert_cliente v2 — CREATE OR REPLACE completo.
--
-- Cambios respecto a v1 (rpc-clientes-v1.sql):
--   - telefono se normaliza con _normalizar_telefono antes de cualquier uso.
--   - instagram se normaliza (lowercase, sin '@', sin forma URL).
--   - cumple valida rango real (MM 01-12, DD 01-31), no solo el shape \d{2}-\d{2}.
--   - nombre: trim + colapso de espacios internos múltiples.
--   - direccion: trim (ya venía con coalesce a '', se le suma trim).
--   - ALTA: el lookup de idempotencia deja de ser nombre+teléfono exacto y
--     pasa a ser SOLO por teléfono normalizado (dedupe real: mismo teléfono,
--     nombre distinto o mal tipeado = mismo lead, se devuelve el id existente
--     en vez de crear un duplicado).
--   - EDICIÓN: si el teléfono nuevo (normalizado) ya pertenece a OTRO
--     cliente, se lanza una excepción amigable ANTES del UPDATE (pre-check),
--     para no dejar que el unique_violation crudo de Postgres le llegue al
--     usuario.
-- ============================================================================

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
  -- tabla solo exige el shape \d{2}-\d{2}, esta RPC es más estricta que eso
  -- a propósito, sin tocar el constraint de la tabla.
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

revoke execute on function upsert_cliente(text, jsonb) from public, anon, authenticated;
grant execute on function upsert_cliente(text, jsonb) to authenticated;

-- ============================================================================
-- 5) crear_pedido — CREATE OR REPLACE completo.
--
-- Copia byte-idéntica de rpc-pedidos-v1.sql salvo:
--   a) rama nuevo_cliente (dentro de "Cliente: existente (id) o nuevo"):
--      ahora normaliza teléfono/nombre/instagram/dirección y busca por
--      teléfono normalizado ANTES de insertar. Si existe, REUSA ese
--      customer_id en vez de crear un duplicado (mismo criterio que
--      upsert_cliente alta).
--   b) validación de cada adición (línea simple Y slot de combo): precio >= 0,
--      cant > 0, insumo_cant >= 0. precio de adición es el ÚNICO valor
--      monetario que viaja desde el cliente sin recalcular server-side —
--      uno negativo es un descuento inyectable. Se valida ANTES del insert
--      en order_item_adiciones, en AMBOS lugares donde el body original
--      inserta adiciones (rama de slot de combo, ~línea 594-611 del
--      original; rama de línea simple, ~línea 626-641 del original).
--
-- El resto del cuerpo (helpers, set_order_status, marcar_pagado,
-- cancelar_pedido, grants) NO se toca — se restatea tal cual para que
-- reaplicar este archivo nunca deje al mirror en un estado parcial.
-- ============================================================================

alter table orders add column if not exists inventario_reservado boolean not null default false;
alter table orders add column if not exists insumos_descontados boolean not null default false;
alter table orders add column if not exists metricas_cliente_actualizadas boolean not null default false;

create or replace function _add_audit(
  p_entidad text, p_entidad_id text, p_accion text,
  p_de text default '', p_a text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user_id text;
begin
  select id into v_user_id from users where auth_id = auth.uid();
  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit','A',2), v_user_id, p_entidad, p_entidad_id, p_accion, p_de, p_a);
end $$;

create or replace function _add_movement(
  p_tipo text, p_item_id text, p_cant numeric, p_nota text default '',
  p_order_id text default null, p_batch_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inventory_movements (id, tipo, item_id, cant, nota, order_id, batch_id)
  values (next_id('movement','M',2), p_tipo, p_item_id, p_cant, p_nota, p_order_id, p_batch_id);
end $$;

create or replace function _add_reservation(
  p_order_id text, p_tipo text, p_product_id text, p_item_id text,
  p_nombre text, p_cantidad numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inventory_reservations (id, order_id, tipo, product_id, item_id, nombre, cantidad)
  values (next_id('reservation','RES-',0), p_order_id, p_tipo, p_product_id, p_item_id, p_nombre, p_cantidad);
end $$;

create or replace function _tiene_evidencia(p_order_id text, p_tipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from evidences where order_id = p_order_id and tipo = p_tipo)
$$;

create or replace function _tiene_sello(p_order_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from evidences
    where order_id = p_order_id and tipo in ('Caja cerrada con sello','Bolsa sellada')
  )
$$;

create or replace function _order_subtotal(p_order_id text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(oi.precio * oi.cant), 0)
       + coalesce((
           select sum(a.precio * a.cant * oi2.cant)
           from order_item_adiciones a
           join order_items oi2 on oi2.id = a.order_item_id
           where oi2.order_id = p_order_id
         ), 0)
  from order_items oi
  where oi.order_id = p_order_id
$$;

create or replace function _deduct_recipe(
  p_product_id text, p_unidades numeric, p_nota text, p_order_id text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_req numeric;
  v_toma numeric;
  v_faltantes text := '';
begin
  for rec in select r.item_id, r.cantidad, it.nombre, it.stock, it.unidad
             from recipes r join inventory_items it on it.id = r.item_id
             where r.product_id = p_product_id
             for update of it
  loop
    v_req := round(rec.cantidad * p_unidades, 3);
    v_toma := least(rec.stock, v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = rec.item_id;
    if v_toma > 0 then
      perform _add_movement('Uso en producción', rec.item_id, -v_toma, p_nota, p_order_id);
      if p_order_id is not null then
        perform _add_reservation(p_order_id, 'insumo', null, rec.item_id, rec.nombre, v_toma);
      end if;
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes
        || case when v_faltantes = '' then '' else ', ' end
        || rec.nombre || ' (faltan ' || (v_req - v_toma) || ' ' || rec.unidad || ')';
    end if;
  end loop;
  return v_faltantes;
end $$;

create or replace function _reserve_inventory(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  comp record;
  addd record;
  v_toma numeric;
  v_necesita numeric;
  v_req numeric;
  v_stock_actual numeric;
  v_tiene_hijas boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_sugerencias_texto text := '';
  v_compras_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
begin
  -- 1) Momos (incluye hijas de combo, es_sub_momo=true, y momos sueltos)
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
  loop
    -- Releer stock EN VIVO con lock: dos filas del mismo producto en un pedido
    -- (ej. 2 hijas del mismo momo) deben ver el stock ya decrementado por la
    -- anterior — como muta la maqueta — no el snapshot del cursor.
    select stock into v_stock_actual from products where id = item.product_id for update;
    v_toma := least(coalesce(v_stock_actual,0), item.cant);
    update products set stock = coalesce(stock,0) - v_toma where id = item.product_id;
    if v_toma > 0 then
      perform _add_reservation(p_order_id, 'producto', item.product_id, null, item.nombre, v_toma);
    end if;
    if v_toma < item.cant then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto', item.nombre, 'cant', item.cant - v_toma, 'area', 'Producción');
      v_sugerencias_texto := v_sugerencias_texto
        || case when v_sugerencias_texto = '' then '' else ', ' end
        || (item.cant - v_toma) || '× ' || item.nombre;
      insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
      values (next_id('suggestion','S-',0), v_hoy, item.product_id,
              item.cant - v_toma, 'Faltante al reservar pedido ' || p_order_id, p_order_id, 'Producción');
    end if;
  end loop;

  -- 2) Combos: pull genérico SOLO si no tiene hijas (legacy); empaque y extras
  --    de receta SIEMPRE se descuentan (con o sin hijas).
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'combo'
  loop
    select exists(select 1 from order_items where parent_item_id = item.id) into v_tiene_hijas;

    if not v_tiene_hijas then
      select combo_size into v_necesita from products where id = item.product_id;
      v_necesita := v_necesita * item.cant;
      for comp in
        select cc.component_id, pr.nombre as comp_nombre
        from combo_components cc join products pr on pr.id = cc.component_id
        where cc.combo_id = item.product_id
      loop
        exit when v_necesita <= 0;
        select stock into v_stock_actual from products where id = comp.component_id for update;
        v_toma := least(coalesce(v_stock_actual,0), v_necesita);
        update products set stock = coalesce(stock,0) - v_toma where id = comp.component_id;
        if v_toma > 0 then
          perform _add_reservation(p_order_id, 'producto', comp.component_id, null,
            comp.comp_nombre || ' (para ' || item.nombre || ')', v_toma);
        end if;
        -- Lo tomado de este componente REDUCE lo que falta cubrir (sin esto,
        -- cada componente descontaría la necesidad completa = doble resta)
        v_necesita := v_necesita - v_toma;
      end loop;
      -- Faltante del combo: UNA sola vez, al final, con lo que quedó sin cubrir
      if v_necesita > 0 then
        v_faltantes := v_faltantes || jsonb_build_object(
          'producto', 'Momos para ' || item.nombre, 'cant', v_necesita, 'area', 'Producción');
        v_sugerencias_texto := v_sugerencias_texto
          || case when v_sugerencias_texto = '' then '' else ', ' end
          || v_necesita || '× Momos para ' || item.nombre;
        insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
        values (next_id('suggestion','S-',0), v_hoy, item.product_id, v_necesita,
                'Faltante al reservar pedido ' || p_order_id || ' (Momos para ' || item.nombre || ')',
                p_order_id, 'Producción');
      end if;
    end if;

    -- Empaque: SIEMPRE
    declare
      v_empaque_id text;
      v_empaque_nombre text;
      v_empaque_stock numeric;
    begin
      select empaque_item_id into v_empaque_id from products where id = item.product_id;
      select nombre, stock into v_empaque_nombre, v_empaque_stock from inventory_items where id = v_empaque_id for update;
      v_toma := least(coalesce(v_empaque_stock,0), item.cant);
      update inventory_items set stock = round(stock - v_toma, 2) where id = v_empaque_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'empaque', null, v_empaque_id, v_empaque_nombre, v_toma);
        perform _add_movement('Salida', v_empaque_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < item.cant then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', v_empaque_id, 'producto', v_empaque_nombre, 'cant', item.cant - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (item.cant - v_toma) || '× ' || v_empaque_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, item.cant - v_toma,
                'Faltante de empaque al reservar pedido ' || p_order_id, p_order_id, 'Inventario', v_empaque_id);
      end if;
    end;

    -- Extras de receta del combo (recipes del producto combo)
    for comp in
      select r.item_id, r.cantidad, it.nombre as it_nombre
      from recipes r join inventory_items it on it.id = r.item_id
      where r.product_id = item.product_id
    loop
      v_req := comp.cantidad * item.cant;
      select stock into v_stock_actual from inventory_items where id = comp.item_id for update;
      v_toma := least(coalesce(v_stock_actual,0), v_req);
      update inventory_items set stock = round(stock - v_toma, 3) where id = comp.item_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'insumo', null, comp.item_id, comp.it_nombre, v_toma);
        perform _add_movement('Salida', comp.item_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < v_req then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', comp.item_id, 'producto', comp.it_nombre, 'cant', v_req - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (v_req - v_toma) || '× ' || comp.it_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
                'Faltante de insumo al reservar pedido ' || p_order_id, p_order_id, 'Inventario', comp.item_id);
      end if;
    end loop;
  end loop;

  -- 3) Adiciones (de todos los items del pedido, solo con insumo_id)
  for addd in
    select a.id, a.nombre, a.insumo_id, a.insumo_cant, a.cant as ad_cant,
           oi.cant as item_cant, it.nombre as insumo_nombre
    from order_item_adiciones a
    join order_items oi on oi.id = a.order_item_id
    join inventory_items it on it.id = a.insumo_id
    where oi.order_id = p_order_id and a.insumo_id is not null
  loop
    v_req := addd.insumo_cant * addd.ad_cant * addd.item_cant;
    select stock into v_stock_actual from inventory_items where id = addd.insumo_id for update;
    v_toma := least(coalesce(v_stock_actual,0), v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = addd.insumo_id;
    if v_toma > 0 then
      perform _add_reservation(p_order_id, 'insumo', null, addd.insumo_id,
        addd.insumo_nombre || ' (adición ' || addd.nombre || ')', v_toma);
      perform _add_movement('Salida', addd.insumo_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', addd.insumo_id, 'producto', addd.insumo_nombre || ' (adición ' || addd.nombre || ')',
        'cant', v_req - v_toma, 'area', 'Inventario');
      v_compras_texto := v_compras_texto
        || case when v_compras_texto = '' then '' else ', ' end
        || (v_req - v_toma) || '× ' || addd.insumo_nombre;
      insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
      values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
              'Faltante de insumo (adición ' || addd.nombre || ') al reservar pedido ' || p_order_id,
              p_order_id, 'Inventario', addd.insumo_id);
    end if;
  end loop;

  -- Audits agregados si hubo faltantes
  if v_sugerencias_texto <> '' then
    perform _add_audit('Producción', p_order_id, 'Sugerencia de producción creada', '', v_sugerencias_texto);
  end if;
  if v_compras_texto <> '' then
    perform _add_audit('Inventario', p_order_id, 'Compra sugerida creada', '', v_compras_texto);
  end if;

  return v_faltantes;
end $$;

create or replace function _release_reservations(p_order_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_liberadas integer := 0;
begin
  for r in select * from inventory_reservations where order_id = p_order_id and estado = 'Reservada' for update
  loop
    if r.tipo = 'producto' then
      update products set stock = coalesce(stock,0) + r.cantidad where id = r.product_id;
    elsif r.tipo = 'empaque' then
      update inventory_items set stock = round(stock + r.cantidad, 2) where id = r.item_id;
      perform _add_movement('Entrada', r.item_id, r.cantidad,
        'Liberación por cancelación de ' || p_order_id, p_order_id);
    elsif r.tipo = 'insumo' then
      update inventory_items set stock = round(stock + r.cantidad, 3) where id = r.item_id;
      perform _add_movement('Entrada', r.item_id, r.cantidad,
        'Liberación por cancelación de ' || p_order_id, p_order_id);
    end if;
    update inventory_reservations set estado = 'Liberada', liberada_en = now() where id = r.id;
    v_liberadas := v_liberadas + 1;
  end loop;

  if v_liberadas > 0 then
    perform _add_audit('Inventario', p_order_id, 'Reservas liberadas', '',
      v_liberadas || ' reserva(s) devueltas al stock');
  end if;

  return v_liberadas;
end $$;

create or replace function _consume_reservations(p_order_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update inventory_reservations set estado = 'Consumida'
  where order_id = p_order_id and estado = 'Reservada';
end $$;

-- ---------------------------------------------------------------------------
-- crear_pedido(p jsonb) returns jsonb
-- Payload: ver spec del orquestador. El servidor NUNCA confía en precios del
-- cliente (excepto precio de adiciones, editable pero con costo snapshoteado
-- Y AHORA validado >= 0 — ver sección "Cliente nuevo" y las dos ramas de
-- adiciones más abajo, marcadas con NORMALIZACIÓN v1 / SECURITY v1).
-- ---------------------------------------------------------------------------
create or replace function crear_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id text;
  v_nuevo jsonb;
  v_canal text;
  v_zona text;
  v_barrio text;
  v_direccion text;
  v_pago text;
  v_obs text;
  v_benefit_id text := nullif(p->>'benefit_id','');
  v_campaign_id text := nullif(p->>'campaign_id','');
  v_creative_id text := nullif(p->>'creative_id','');
  v_origen_detalle text := coalesce(p->>'origen_detalle','');
  v_idem text := nullif(p->>'idempotency_key','');
  v_order_id text;
  v_existing_order_id text;
  v_linea jsonb;
  v_box jsonb;
  v_slot jsonb;
  v_ad jsonb;
  v_prod record;
  v_precio numeric;
  v_costo numeric;
  v_relleno_fijo text;
  v_pedido_minimo numeric;
  v_tarifa numeric := 0;
  v_dom_cobrado numeric := 0;
  v_subtotal numeric;
  v_descuento numeric := 0;
  v_total numeric;
  v_item_id text;
  v_parent_id text;
  v_hija_item_id text;
  v_faltantes jsonb := '[]'::jsonb;
  v_faltantes_linea jsonb;
  v_benefit record;
  v_especie text;
  v_hija_product_id text;
  v_caja_num integer;
  v_slot_idx integer;
  v_ad_costo numeric;
  v_min_lineas boolean := false;
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
  v_ahora time := (now() at time zone 'America/Bogota')::time; -- hora operativa del negocio
  -- NORMALIZACIÓN v1: datos ya limpios del cliente nuevo (si aplica)
  v_nuevo_nombre text;
  v_nuevo_telefono text;
  v_nuevo_instagram text;
  v_nuevo_direccion text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear pedidos';
  end if;

  -- Idempotencia: si ya existe un pedido con esa key, devolverlo tal cual (sin crear nada)
  if v_idem is not null then
    select id into v_existing_order_id from orders where idempotency_key = v_idem;
    if v_existing_order_id is not null then
      return jsonb_build_object(
        'order_id', v_existing_order_id,
        'subtotal', (select ventas from v_order_totals where order_id = v_existing_order_id),
        'descuento', (select descuento from orders where id = v_existing_order_id),
        'dom_cobrado', (select dom_cobrado from orders where id = v_existing_order_id),
        'total', coalesce((select ventas from v_order_totals where order_id = v_existing_order_id),0)
                 - (select descuento from orders where id = v_existing_order_id)
                 + (select dom_cobrado from orders where id = v_existing_order_id),
        'faltantes', '[]'::jsonb
      );
    end if;
  end if;

  -- Cliente: existente (id) o nuevo (nombre+telefono obligatorios)
  -- NORMALIZACIÓN v1: teléfono normalizado ANTES de buscar/insertar; si el
  -- teléfono normalizado ya pertenece a un cliente existente, se REUSA ese
  -- id en vez de crear un duplicado (mismo criterio que upsert_cliente alta,
  -- normalizacion-clientes-v1.sql).
  v_customer_id := nullif(p->>'customer_id','');
  v_nuevo := p->'nuevo_cliente';
  if v_customer_id is null then
    if v_nuevo is null or coalesce(v_nuevo->>'nombre','') = '' or coalesce(v_nuevo->>'telefono','') = '' then
      raise exception 'Debés indicar un cliente existente o los datos del cliente nuevo (nombre y teléfono)';
    end if;

    v_nuevo_nombre := trim(regexp_replace(v_nuevo->>'nombre', '\s+', ' ', 'g'));
    v_nuevo_telefono := _normalizar_telefono(v_nuevo->>'telefono');
    v_nuevo_instagram := lower(trim(coalesce(v_nuevo->>'instagram', '')));
    if v_nuevo_instagram <> '' then
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '^(https?://)?(www\.)?instagram\.com/', '');
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '^@', '');
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '[/?].*$', '');
    end if;
    v_nuevo_direccion := trim(coalesce(v_nuevo->>'direccion',''));

    if v_nuevo_telefono = '' then
      raise exception 'Debés indicar un cliente existente o los datos del cliente nuevo (nombre y teléfono)';
    end if;

    select id into v_customer_id from customers where telefono = v_nuevo_telefono;
    if v_customer_id is null then
      v_customer_id := next_id('customer','C',2);

      -- Alta bajo carrera: mismo patrón que upsert_cliente (normalizacion-
      -- clientes-v1.sql, rama ALTA) — el índice único customers_telefono_
      -- unique_idx es el árbitro real; la perdedora reusa el id existente sin
      -- crear un audit de 'Cliente creado' duplicado para una fila que no creó.
      begin
        insert into customers (id, nombre, telefono, instagram, barrio, direccion, canal)
        values (v_customer_id, v_nuevo_nombre, v_nuevo_telefono, v_nuevo_instagram,
                coalesce(v_nuevo->>'barrio',''), v_nuevo_direccion,
                nullif(v_nuevo->>'canal',''));
        perform _add_audit('Cliente', v_customer_id, 'Cliente creado', '', v_nuevo_nombre);
      exception when unique_violation then
        select id into v_customer_id from customers where telefono = v_nuevo_telefono;
        if v_customer_id is null then
          raise;  -- otra violación de unicidad (p.ej. PK): no es idempotencia, propagar
        end if;
      end;
    end if;
  else
    if not exists (select 1 from customers where id = v_customer_id) then
      raise exception 'El cliente % no existe', v_customer_id;
    end if;
  end if;

  -- Al menos una línea con product_id
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p->'lineas','[]'::jsonb)) l
    where nullif(l->>'product_id','') is not null
  ) then
    raise exception 'El pedido debe tener al menos una línea con producto';
  end if;

  v_canal := p->>'canal';
  v_zona := nullif(p->>'zona','');
  v_barrio := coalesce(p->>'barrio','');
  v_direccion := coalesce(p->>'direccion','');
  v_pago := nullif(p->>'pago','');
  v_obs := coalesce(p->>'obs','');

  select valor#>>'{}' into v_relleno_fijo from app_settings where clave = 'relleno_fijo';
  select coalesce((valor#>>'{}')::numeric, 0) into v_pedido_minimo from app_settings where clave = 'pedido_minimo';

  if v_canal = 'Rappi' then
    v_tarifa := 0;
    v_dom_cobrado := 0;
  elsif v_zona is not null then
    select tarifa into v_tarifa from zonas where nombre = v_zona;
    v_dom_cobrado := coalesce(v_tarifa, 0);
  end if;

  v_order_id := next_id('order','P-',0);

  -- INSERT del pedido ANTES de las líneas: order_items.order_id tiene FK NOT NULL
  -- a orders(id) (y benefits.pedido_uso también referencia orders). descuento y
  -- benefit_id se consolidan al final vía UPDATE — misma transacción: cualquier
  -- raise posterior (mínimo, beneficio, combo incompleto) revienta todo el pedido.
  insert into orders (
    id, fecha, hora, canal, customer_id, barrio, direccion, zona,
    dom_cobrado, dom_costo, descuento, benefit_id, pago, obs, estado,
    idempotency_key, campaign_id, creative_id, origen_detalle
  ) values (
    v_order_id, v_hoy, v_ahora, v_canal, v_customer_id, v_barrio, v_direccion, v_zona,
    v_dom_cobrado, 0, 0, null, v_pago, v_obs, 'Nuevo',
    v_idem, v_campaign_id, v_creative_id, v_origen_detalle
  );

  -- Insertar líneas
  for v_linea in select * from jsonb_array_elements(p->'lineas')
  loop
    if nullif(v_linea->>'product_id','') is null then
      continue;
    end if;

    select id, nombre, tipo, especie, precio, precio_rappi, costo, combo_size, empaque_item_id
      into v_prod from products where id = v_linea->>'product_id';
    if v_prod.id is null then
      raise exception 'Producto % no existe', v_linea->>'product_id';
    end if;

    if v_canal = 'Rappi' then
      v_precio := coalesce(v_prod.precio_rappi, v_prod.precio * 1.25);
    else
      v_precio := v_prod.precio;
    end if;
    v_costo := v_prod.costo;

    v_item_id := next_id('item','IT',0);

    if v_prod.tipo = 'combo' then
      if v_linea->'boxes' is null or jsonb_array_length(v_linea->'boxes') = 0 then
        raise exception 'El combo % requiere las cajas completas (figura, sabor y salsa de cada slot)', v_prod.nombre;
      end if;
      if jsonb_array_length(v_linea->'boxes') <> coalesce((v_linea->>'cant')::numeric,1)::int then
        raise exception 'El combo % debe tener % caja(s), llegaron %',
          v_prod.nombre, (v_linea->>'cant')::int, jsonb_array_length(v_linea->'boxes');
      end if;

      -- Padre es_caja
      insert into order_items (id, order_id, product_id, nombre, cant, precio, costo_unitario, es_caja)
      values (v_item_id, v_order_id, v_prod.id, v_prod.nombre,
              coalesce((v_linea->>'cant')::numeric,1), v_precio, v_costo, true);

      v_caja_num := 0;
      for v_box in select * from jsonb_array_elements(v_linea->'boxes')
      loop
        v_caja_num := v_caja_num + 1;
        if jsonb_array_length(v_box) <> v_prod.combo_size then
          raise exception 'La caja % del combo % debe tener % slots, llegaron %',
            v_caja_num, v_prod.nombre, v_prod.combo_size, jsonb_array_length(v_box);
        end if;
        v_slot_idx := 0;
        for v_slot in select * from jsonb_array_elements(v_box)
        loop
          v_slot_idx := v_slot_idx + 1;
          if coalesce(v_slot->>'figura','') = '' or coalesce(v_slot->>'sabor','') = ''
             or coalesce(v_slot->>'salsa','') = '' then
            raise exception 'Caja % slot % del combo % está incompleto: falta figura, sabor o salsa',
              v_caja_num, v_slot_idx, v_prod.nombre;
          end if;

          select especie into v_especie from figuras where nombre = v_slot->>'figura';
          if v_especie is null then
            raise exception 'Figura % no existe en el catálogo', v_slot->>'figura';
          end if;
          select cc.component_id into v_hija_product_id
            from combo_components cc join products pr on pr.id = cc.component_id
            where cc.combo_id = v_prod.id and pr.especie = v_especie
            limit 1;
          if v_hija_product_id is null then
            raise exception 'No hay componente de especie % configurado para el combo %', v_especie, v_prod.nombre;
          end if;

          v_parent_id := v_item_id;
          v_hija_item_id := next_id('item','IT',0);
          insert into order_items (
            id, order_id, product_id, nombre, sabor, salsa, relleno, figura,
            cant, precio, costo_unitario, es_sub_momo, parent_item_id, caja_num
          ) values (
            v_hija_item_id, v_order_id, v_hija_product_id,
            (select nombre from products where id = v_hija_product_id),
            v_slot->>'sabor', v_slot->>'salsa', coalesce(v_relleno_fijo,''), v_slot->>'figura',
            1, 0, 0, true, v_parent_id, v_caja_num
          );

          -- Adiciones del slot (si vienen): cuelgan de la HIJA recién insertada.
          -- SECURITY v1: precio de adición es el único valor monetario que
          -- viaja del cliente sin recalcular server-side — se valida acá
          -- ANTES de insertar (precio >= 0, cant > 0, insumo_cant >= 0), para
          -- que un precio negativo no se cuele como descuento inyectado en
          -- _order_subtotal.
          if v_slot->'adiciones' is not null then
            for v_ad in select * from jsonb_array_elements(v_slot->'adiciones')
            loop
              if coalesce((v_ad->>'precio')::numeric,0) < 0 then
                raise exception 'Precio de adición inválido (negativo): %', v_ad->>'nombre';
              end if;
              if coalesce((v_ad->>'cant')::numeric,1) <= 0 then
                raise exception 'Cantidad de adición inválida (debe ser mayor a 0): %', v_ad->>'nombre';
              end if;
              if coalesce((v_ad->>'insumo_cant')::numeric,0) < 0 then
                raise exception 'Cantidad de insumo de adición inválida (negativa): %', v_ad->>'nombre';
              end if;

              v_ad_costo := null;
              if nullif(v_ad->>'insumo_id','') is not null then
                select costo into v_ad_costo from inventory_items where id = v_ad->>'insumo_id';
              end if;
              insert into order_item_adiciones (
                order_item_id, nombre, precio, cant, insumo_id, insumo_cant, insumo_costo
              ) values (
                v_hija_item_id,
                v_ad->>'nombre', coalesce((v_ad->>'precio')::numeric,0),
                coalesce((v_ad->>'cant')::numeric,1),
                nullif(v_ad->>'insumo_id',''), coalesce((v_ad->>'insumo_cant')::numeric,0), v_ad_costo
              );
            end loop;
          end if;
        end loop;
      end loop;

    else
      -- momo o pedido: línea simple
      insert into order_items (
        id, order_id, product_id, nombre, sabor, salsa, relleno, figura, cant, precio, costo_unitario
      ) values (
        v_item_id, v_order_id, v_prod.id, v_prod.nombre,
        coalesce(v_linea->>'sabor',''), coalesce(v_linea->>'salsa',''),
        coalesce(v_relleno_fijo,''), coalesce(v_linea->>'figura',''),
        coalesce((v_linea->>'cant')::numeric,1), v_precio, v_costo
      );

      -- SECURITY v1: misma validación de adiciones que en la rama de combo
      -- de arriba (precio >= 0, cant > 0, insumo_cant >= 0).
      if v_linea->'adiciones' is not null then
        for v_ad in select * from jsonb_array_elements(v_linea->'adiciones')
        loop
          if coalesce((v_ad->>'precio')::numeric,0) < 0 then
            raise exception 'Precio de adición inválido (negativo): %', v_ad->>'nombre';
          end if;
          if coalesce((v_ad->>'cant')::numeric,1) <= 0 then
            raise exception 'Cantidad de adición inválida (debe ser mayor a 0): %', v_ad->>'nombre';
          end if;
          if coalesce((v_ad->>'insumo_cant')::numeric,0) < 0 then
            raise exception 'Cantidad de insumo de adición inválida (negativa): %', v_ad->>'nombre';
          end if;

          v_ad_costo := null;
          if nullif(v_ad->>'insumo_id','') is not null then
            select costo into v_ad_costo from inventory_items where id = v_ad->>'insumo_id';
          end if;
          insert into order_item_adiciones (
            order_item_id, nombre, precio, cant, insumo_id, insumo_cant, insumo_costo
          ) values (
            v_item_id, v_ad->>'nombre', coalesce((v_ad->>'precio')::numeric,0),
            coalesce((v_ad->>'cant')::numeric,1),
            nullif(v_ad->>'insumo_id',''), coalesce((v_ad->>'insumo_cant')::numeric,0), v_ad_costo
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Subtotal (post-inserción de líneas, en la misma transacción)
  v_subtotal := _order_subtotal(v_order_id);

  if v_subtotal < v_pedido_minimo then
    raise exception 'El pedido no alcanza el mínimo de % (subtotal: %)', v_pedido_minimo, v_subtotal;
  end if;

  -- Beneficio: elegible si es Activo, del customer, vigente (el mínimo se valida abajo)
  if v_benefit_id is not null then
    select * into v_benefit from benefits
      where id = v_benefit_id and customer_id = v_customer_id and estado = 'Activo'
        and (vence is null or vence >= v_hoy)
      for update;
    if v_benefit.id is not null then
      if v_subtotal < v_benefit.minimo then
        raise exception 'El beneficio % exige un mínimo de % (subtotal: %)', v_benefit_id, v_benefit.minimo, v_subtotal;
      end if;

      if v_benefit.tipo_beneficio = 'descuento_porcentaje' then
        v_descuento := round(v_subtotal * v_benefit.valor / 100);
      elsif v_benefit.tipo_beneficio = 'descuento_valor_fijo' then
        v_descuento := least(v_benefit.valor, v_subtotal);
      elsif v_benefit.tipo_beneficio = 'producto_gratis' then
        v_descuento := 0;
        -- COGS real del regalo: costo_unitario = products.costo (si va 0, el
        -- margen miente). El nombre lleva sufijo ' (beneficio)' como la maqueta.
        insert into order_items (id, order_id, product_id, nombre, cant, precio, costo_unitario)
        select next_id('item','IT',0), v_order_id, id, nombre || ' (beneficio)', 1, 0, costo
        from products where id = v_benefit.producto_gratis_id;
      end if;

      update benefits set estado = 'Reservado', pedido_uso = v_order_id where id = v_benefit_id;
      perform _add_audit('Beneficio', v_benefit_id, 'Beneficio reservado', 'Activo', 'Pedido ' || v_order_id);
    else
      v_benefit_id := null; -- no elegible: se ignora silenciosamente el benefit_id del payload
    end if;
  end if;

  v_total := v_subtotal - v_descuento + v_dom_cobrado;

  -- Consolidar descuento y beneficio calculados post-líneas (el pedido ya existe)
  update orders set descuento = v_descuento, benefit_id = v_benefit_id where id = v_order_id;

  -- Canal Rappi sin delivery previo → crear delivery automático
  if v_canal = 'Rappi' and not exists (select 1 from deliveries where order_id = v_order_id) then
    insert into deliveries (id, order_id, proveedor, costo_real, cobrado, estado)
    values (next_id('delivery','D-',0), v_order_id, 'Rappi', 0, 0, 'Solicitado');
    perform _add_audit('Domicilio', v_order_id, 'Domicilio Rappi creado automáticamente');
  end if;

  perform _add_audit('Pedido', v_order_id, 'Pedido creado', '', 'Nuevo');

  -- Faltantes de stock/especie NO bloquean: se calculan recién en set_order_status
  -- (efecto de reserva ocurre al pagar). crear_pedido NO reserva inventario todavía
  -- — la reserva es un EFECTO de la transición a Pagado (ver sección Efectos).
  -- Por eso v_faltantes queda vacío acá; se reporta en el jsonb de set_order_status.

  return jsonb_build_object(
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'descuento', v_descuento,
    'dom_cobrado', v_dom_cobrado,
    'total', v_total,
    'faltantes', v_faltantes
  );
end $$;

-- ---------------------------------------------------------------------------
-- set_order_status(order_id, estado, venta_rapida) returns jsonb
-- Centro del ciclo de vida. Lock FOR UPDATE al entrar → serializa transiciones.
-- (byte-idéntico a rpc-pedidos-v1.sql — no forma parte del alcance de esta
-- normalización, se restatea para que el archivo sea ejecutable de punta a
-- punta sin dejar el mirror a medio actualizar)
-- ---------------------------------------------------------------------------
create or replace function set_order_status(
  p_order_id text, p_estado text, p_venta_rapida boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_prev text;
  v_legal boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_faltantes_reserva jsonb;
  v_delivery record;
  v_customer record;
  v_reclamos_cliente integer;
  v_order_total numeric;
  v_item record;
  v_recipe_faltantes text := '';
  v_f text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
  v_ahora time := (now() at time zone 'America/Bogota')::time; -- hora operativa del negocio
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into o from orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'El pedido % no existe', p_order_id;
  end if;

  -- (1) no-op si mismo estado
  if o.estado = p_estado then
    return jsonb_build_object('ok', true, 'de', o.estado, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  v_prev := o.estado;

  -- (2) gate de grafo
  v_legal := (
    (v_prev = 'Nuevo' and p_estado in ('Confirmado','Pendiente de pago','Pagado')) or
    (v_prev = 'Confirmado' and p_estado in ('Pendiente de pago','Pagado','Nuevo')) or
    (v_prev = 'Pendiente de pago' and p_estado in ('Pagado','Confirmado')) or
    (v_prev = 'Pagado' and p_estado in ('En producción','Pendiente de pago')) or
    (v_prev = 'En producción' and p_estado in ('Listo para empaque','Pagado')) or
    (v_prev = 'Listo para empaque' and p_estado in ('Empacado','En producción')) or
    (v_prev = 'Empacado' and p_estado in ('Listo para despacho','En ruta','Listo para empaque')) or
    (v_prev = 'Listo para despacho' and p_estado in ('En ruta','Empacado')) or
    (v_prev = 'En ruta' and p_estado in ('Entregado','Listo para despacho')) or
    (v_prev = 'Reclamo' and p_estado = 'Entregado') or
    p_estado in ('Cancelado','Reclamo') or
    (p_venta_rapida and p_estado = 'Entregado')
  );
  if not v_legal then
    raise exception 'Transición no permitida: de "%" no se puede pasar a "%". Avanzá paso a paso, o usá "Entrega inmediata" si es una venta en mano.', v_prev, p_estado;
  end if;

  -- (3) gate de pago genérico
  if p_estado in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado') and o.pagado_en is null then
    raise exception 'MOMOS no produce ni despacha pedidos sin pago confirmado.';
  end if;

  -- (4) gate Empacado: 'Caja abierta' Y ('Caja cerrada con sello' O 'Bolsa sellada')
  if p_estado = 'Empacado' then
    if not _tiene_evidencia(p_order_id, 'Caja abierta') then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja abierta.', p_order_id;
    end if;
    if not _tiene_sello(p_order_id) then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja cerrada con sello o Bolsa sellada.', p_order_id;
    end if;
  end if;

  -- (5) gate En ruta: sello + pago + delivery no-Cancelado + costo (salvo Rappi)
  if p_estado = 'En ruta' then
    if not _tiene_sello(p_order_id) then
      raise exception 'El pedido % no puede pasar a "En ruta": falta foto de caja cerrada con sello o bolsa sellada.', p_order_id;
    end if;
    if o.pagado_en is null then
      raise exception 'El pedido % no puede pasar a "En ruta": el pedido no tiene pago confirmado.', p_order_id;
    end if;
    select * into v_delivery from deliveries where order_id = p_order_id and estado <> 'Cancelado' limit 1;
    if v_delivery.id is null then
      raise exception 'El pedido % no puede pasar a "En ruta": no tiene domicilio asignado (solicítalo en Domicilios).', p_order_id;
    end if;
    if o.canal <> 'Rappi' then
      if not (coalesce(v_delivery.costo_real,0) > 0 or coalesce(o.dom_costo,0) > 0) then
        raise exception 'El pedido % no puede pasar a "En ruta": falta registrar el costo real del domicilio.', p_order_id;
      end if;
    end if;
  end if;

  -- (6) gate Entregado: pago + evidencia de pago/sello (según canal/venta rápida) + SIEMPRE evidencia 'Entrega'
  if p_estado = 'Entregado' then
    if o.pagado_en is null then
      raise exception 'El pedido % no puede pasar a "Entregado": el pedido no tiene pago confirmado.', p_order_id;
    end if;
    if o.canal = 'Rappi' then
      if not (_tiene_evidencia(p_order_id,'Comprobante de pago') or _tiene_evidencia(p_order_id,'Bolsa sellada')) then
        raise exception 'El pedido % no puede pasar a "Entregado": falta foto de comprobante de pago o bolsa sellada.', p_order_id;
      end if;
    elsif not p_venta_rapida then
      if not _tiene_sello(p_order_id) then
        raise exception 'El pedido % no puede pasar a "Entregado": falta foto de caja cerrada con sello o bolsa sellada.', p_order_id;
      end if;
    end if;
    if not _tiene_evidencia(p_order_id,'Entrega') then
      raise exception 'El pedido % no puede pasar a "Entregado": falta la foto de Entrega.', p_order_id;
    end if;
  end if;

  -- (7) gate Pagado
  if p_estado = 'Pagado' then
    if o.pago = 'Efectivo' then
      raise exception 'MOMOS no acepta pagos en efectivo.';
    end if;
    if o.pago = 'Rappi (app)' and o.canal <> 'Rappi' then
      raise exception 'El medio de pago "Rappi (app)" solo aplica a pedidos del canal Rappi.';
    end if;
    if o.canal = 'Rappi' and o.pago <> 'Rappi (app)' then
      raise exception 'Los pedidos de canal Rappi deben pagarse con "Rappi (app)".';
    end if;
    if o.canal <> 'Rappi' and not _tiene_evidencia(p_order_id,'Comprobante de pago') then
      raise exception 'El pedido % no puede marcarse "Pagado": falta la foto del comprobante de pago.', p_order_id;
    end if;
  end if;

  -- Audit SIEMPRE (antes de efectos)
  perform _add_audit('Pedido', p_order_id, 'Cambio de estado', v_prev, p_estado);

  -- Aplicar el nuevo estado ya (los efectos leen/escriben sobre el estado nuevo)
  update orders set estado = p_estado where id = p_order_id;

  -- ===== Efectos post-transición (orden exacto) =====

  -- [Pagado]
  if p_estado = 'Pagado' then
    update orders set comprobante = true, pagado_en = now() where id = p_order_id;
    if not o.inventario_reservado then
      v_faltantes_reserva := _reserve_inventory(p_order_id);
      v_faltantes := v_faltantes || v_faltantes_reserva;
      update orders set inventario_reservado = true where id = p_order_id;
    end if;
    if o.benefit_id is not null then
      update benefits set estado = 'Usado' where id = o.benefit_id and estado = 'Reservado';
      if found then
        perform _add_audit('Beneficio', o.benefit_id, 'Beneficio usado', 'Reservado', 'Usado');
      end if;
    end if;
  end if;

  -- [Red #7] cualquier transición: si operativo/entregado AND pagado_en AND NOT reservado → reservar
  if p_estado in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado')
     and (case when p_estado = 'Pagado' then true else o.pagado_en is not null end)
     and not (case when p_estado = 'Pagado' then true else o.inventario_reservado end)
  then
    if not exists (select 1 from orders where id = p_order_id and inventario_reservado) then
      v_faltantes_reserva := _reserve_inventory(p_order_id);
      v_faltantes := v_faltantes || v_faltantes_reserva;
      update orders set inventario_reservado = true where id = p_order_id;
    end if;
  end if;

  -- [En producción]
  if p_estado = 'En producción' and not o.insumos_descontados then
    v_recipe_faltantes := '';
    for v_item in
      select oi.product_id, oi.cant from order_items oi
      join products p2 on p2.id = oi.product_id
      where oi.order_id = p_order_id and p2.tipo = 'pedido'
    loop
      v_f := _deduct_recipe(v_item.product_id, v_item.cant, 'Producción pedido ' || p_order_id, p_order_id);
      if v_f <> '' then
        v_recipe_faltantes := v_recipe_faltantes || case when v_recipe_faltantes = '' then '' else ', ' end || v_f;
      end if;
    end loop;
    update orders set insumos_descontados = true where id = p_order_id;
    if v_recipe_faltantes <> '' then
      perform _add_audit('Producción', p_order_id, 'Faltante de insumos en producción', '', v_recipe_faltantes);
    end if;
  end if;

  -- [Red #4] En ruta/Entregado sin insumos_descontados → entrega directa
  if p_estado in ('En ruta','Entregado') and not o.insumos_descontados
     and not exists (select 1 from orders where id = p_order_id and insumos_descontados)
  then
    v_recipe_faltantes := '';
    for v_item in
      select oi.product_id, oi.cant from order_items oi
      join products p2 on p2.id = oi.product_id
      where oi.order_id = p_order_id and p2.tipo = 'pedido'
    loop
      v_f := _deduct_recipe(v_item.product_id, v_item.cant, 'Producción pedido ' || p_order_id || ' (entrega directa)', p_order_id);
      if v_f <> '' then
        v_recipe_faltantes := v_recipe_faltantes || case when v_recipe_faltantes = '' then '' else ', ' end || v_f;
      end if;
    end loop;
    update orders set insumos_descontados = true where id = p_order_id;
    if v_recipe_faltantes <> '' then
      perform _add_audit('Producción', p_order_id, 'Faltante de insumos en producción', '', v_recipe_faltantes);
    end if;
  end if;

  -- [Cancelado]
  if p_estado = 'Cancelado' then
    if v_prev not in ('En ruta','Entregado') then
      perform _release_reservations(p_order_id);
    end if;
    -- flag insumos_descontados: false si prev no despachado (SIN recalcular: la
    -- liberación ya devolvió el stock). inventario_reservado NO se resetea —
    -- paridad con la maqueta: Cancelado es terminal.
    if o.insumos_descontados and v_prev not in ('En ruta','Entregado') then
      update orders set insumos_descontados = false where id = p_order_id;
    end if;

    if v_prev = 'Entregado' and o.metricas_cliente_actualizadas then
      select * into v_customer from customers where id = o.customer_id for update;
      if v_customer.id is not null then
        select coalesce(ventas,0) into v_order_total from v_order_totals where order_id = p_order_id;
        update customers set
          pedidos = greatest(0, pedidos - 1),
          total = greatest(0, total - (v_order_total - o.descuento + o.dom_cobrado))
        where id = o.customer_id;
      end if;
      update orders set metricas_cliente_actualizadas = false where id = p_order_id;
    end if;

    -- Beneficio: Reservado, o Usado con prev antes de producción → vuelve a Activo
    if o.benefit_id is not null then
      if exists (
        select 1 from benefits where id = o.benefit_id and (
          estado = 'Reservado' or
          (estado = 'Usado' and v_prev not in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado'))
        )
      ) then
        update benefits set estado = 'Activo', pedido_uso = null where id = o.benefit_id;
        perform _add_audit('Beneficio', o.benefit_id, 'Beneficio devuelto al cliente', v_prev, 'Activo');
      end if;
    end if;

    update deliveries set estado = 'Cancelado' where order_id = p_order_id and estado <> 'Cancelado';
  end if;

  -- [En ruta]
  if p_estado = 'En ruta' then
    update deliveries set estado = 'En ruta', h_salida = coalesce(h_salida, v_ahora)
    where order_id = p_order_id and estado not in ('Entregado','Cancelado');
  end if;

  -- [Entregado]
  if p_estado = 'Entregado' then
    perform _consume_reservations(p_order_id);
    if not o.metricas_cliente_actualizadas then
      select * into v_customer from customers where id = o.customer_id for update;
      if v_customer.id is not null then
        select coalesce(ventas,0) into v_order_total from v_order_totals where order_id = p_order_id;
        select count(*) into v_reclamos_cliente from claims where customer_id = v_customer.id;
        update customers set
          ultima = v_hoy,
          pedidos = v_customer.pedidos + 1,
          total = v_customer.total + (v_order_total - o.descuento + o.dom_cobrado),
          estado = case
            when v_reclamos_cliente >= 2 then 'Riesgo por reclamos'
            when (v_customer.pedidos + 1) >= 5 or (v_customer.total + (v_order_total - o.descuento + o.dom_cobrado)) >= 200000 then 'VIP'
            when (v_customer.pedidos + 1) >= 2 then 'Recurrente'
            else 'Nuevo'
          end
        where id = v_customer.id;
      end if;
      update orders set metricas_cliente_actualizadas = true where id = p_order_id;
    end if;
    update deliveries set estado = 'Entregado', h_entrega = v_ahora
    where order_id = p_order_id and estado <> 'Cancelado';
  end if;

  -- [Retroceso #14] prev='En ruta' y nuevo NOT IN ('En ruta','Entregado','Cancelado','Reclamo') → delivery vuelve a Asignado.
  -- 'Reclamo' EXCLUIDO (decisión usuario 2026-07-10, migración fix_retroceso_reclamo_v1): el reclamo es bandera
  -- administrativa/comercial (se compensa con bono → claims.benefit_id), NO retroceso logístico — la entrega sigue
  -- su curso y h_salida se preserva (trazabilidad de tiempos en tránsito).
  if v_prev = 'En ruta' and p_estado not in ('En ruta','Entregado','Cancelado','Reclamo') then
    update deliveries set estado = 'Asignado', h_salida = null
    where order_id = p_order_id and estado = 'En ruta';
  end if;

  return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', v_faltantes);
end $$;

-- ---------------------------------------------------------------------------
-- marcar_pagado / cancelar_pedido: wrappers de conveniencia sobre set_order_status
-- ---------------------------------------------------------------------------
create or replace function marcar_pagado(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;
  return set_order_status(p_order_id, 'Pagado', false);
end $$;

create or replace function cancelar_pedido(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;
  return set_order_status(p_order_id, 'Cancelado', false);
end $$;

-- ============================================================================
-- Grants (restateados tal cual rpc-pedidos-v1.sql, salvo crear_pedido: ver
-- nota abajo — se separa a un revoke/grant propio para seguir el patrón
-- uniforme del header de este archivo, igual que upsert_cliente en la
-- sección 4. set_order_status/marcar_pagado/cancelar_pedido no forman parte
-- del alcance de esta normalización y quedan byte-idénticos al mirror.)
-- ============================================================================

-- crear_pedido: patrón uniforme (revoke de public, anon Y authenticated,
-- después grant explícito a authenticated) — mismo criterio que
-- upsert_cliente (sección 4).
revoke execute on function crear_pedido(jsonb) from public, anon, authenticated;
grant execute on function crear_pedido(jsonb) to authenticated;

revoke execute on function set_order_status(text, text, boolean) from public, anon;
revoke execute on function marcar_pagado(text) from public, anon;
revoke execute on function cancelar_pedido(text) from public, anon;

grant execute on function set_order_status(text, text, boolean) to authenticated;
grant execute on function marcar_pagado(text) to authenticated;
grant execute on function cancelar_pedido(text) to authenticated;

-- Los helpers _* NO reciben grants: solo los invoca el definer de las RPCs
-- públicas de arriba (mismo dueño/definer, no requieren EXECUTE explícito
-- para ser llamados desde otra función SECURITY DEFINER del mismo owner,
-- pero por defensa en profundidad se revocan explícitamente de public/anon).
revoke execute on function _add_audit(text, text, text, text, text) from public, anon;
revoke execute on function _add_movement(text, text, numeric, text, text, text) from public, anon;
revoke execute on function _add_reservation(text, text, text, text, text, numeric) from public, anon;
revoke execute on function _tiene_evidencia(text, text) from public, anon;
revoke execute on function _tiene_sello(text) from public, anon;
revoke execute on function _order_subtotal(text) from public, anon;
revoke execute on function _deduct_recipe(text, numeric, text, text) from public, anon;
revoke execute on function _reserve_inventory(text) from public, anon;
revoke execute on function _release_reservations(text) from public, anon;
revoke execute on function _consume_reservations(text) from public, anon;

commit;

-- ============================================================================
-- Verificación esperada
-- ============================================================================
--
-- Teléfono → E.164:
--   select _normalizar_telefono('+57 300 123-4567');        -- → '573001234567'
--   select _normalizar_telefono('300 123 4567');             -- → '573001234567'
--   select _normalizar_telefono('0057 300 1234567');         -- → '573001234567'
--   select _normalizar_telefono('573001234567');             -- → '573001234567' (ya E.164, se deja)
--   select _normalizar_telefono('');                         -- → ''
--   select _normalizar_telefono('abc');                      -- → '' (sin dígitos)
--   select _normalizar_telefono('123');                      -- → '123' (forma rara: se guarda tal cual, NO explota)
--   select _normalizar_telefono('570000000000');             -- → '570000000000' (12 dígitos con prefijo '57':
--   -- se acepta como E.164 y se guarda tal cual, SIN re-validar contra rangos
--   -- reales de celular colombiano (3XX...) — intencional: esta función solo
--   -- valida FORMA (57 + 12 dígitos), no rangos de operador.
--
-- Índice único de teléfono:
--   select count(*) from customers where telefono <> '' group by telefono having count(*) > 1;
--   -- → 0 filas (ninguna colisión post-normalización)
--
-- Dedupe en upsert_cliente (alta):
--   select upsert_cliente(null, '{"nombre":"Ana","telefono":"3001234567"}'::jsonb);      -- crea C11 (ejemplo)
--   select upsert_cliente(null, '{"nombre":"Ana P.","telefono":"+57 300 123 4567"}'::jsonb);
--   -- → devuelve el MISMO id de C11 (lead idempotente, no duplica)
--
-- Dedupe en upsert_cliente (edición, colisión):
--   -- si C05 ya tiene telefono '573009999999' y se intenta:
--   select upsert_cliente('C11', '{"nombre":"Ana","telefono":"300 999 9999"}'::jsonb);
--   -- → exception 'Ese teléfono ya pertenece a otro cliente (C05).'
--
-- Dedupe en crear_pedido (rama nuevo_cliente):
--   select crear_pedido('{"canal":"WhatsApp","lineas":[{"product_id":"P01","cant":1}],
--     "nuevo_cliente":{"nombre":"Ana Duplicada","telefono":"3001234567"}}'::jsonb);
--   -- → customer_id del pedido = mismo id de C11, NO crea un C12 nuevo
--
-- Instagram:
--   select upsert_cliente(null, '{"nombre":"x","telefono":"3000000001","instagram":"@Momos.co"}'::jsonb);
--   -- → instagram guardado: 'momos.co'
--   -- 'https://www.instagram.com/momos.co/' → 'momos.co'
--   -- 'instagram.com/momos.co?hl=es'         → 'momos.co'
--
-- Cumple (rango real):
--   select upsert_cliente(null, '{"nombre":"x","telefono":"3000000002","cumple":"13-01"}'::jsonb);
--   -- → exception 'Cumpleaños inválido (mes o día fuera de rango): 13-01' (mes 13 no existe)
--   select upsert_cliente(null, '{"nombre":"x","telefono":"3000000003","cumple":"02-30"}'::jsonb);
--   -- → ok, cumple guardado '02-30' (día 30 no existe en NINGÚN febrero, pero
--   --    la validación es de RANGO puro —MM 01-12, DD 01-31— no de días-por-
--   --    mes real. Limitación conocida y aceptada a propósito: el shape MM-DD
--   --    no tiene año, así que no hay forma de distinguir bisiesto sin uno, y
--   --    complicar con esa lógica no aporta valor de negocio acá)
--   select upsert_cliente(null, '{"nombre":"x","telefono":"3000000004","cumple":"12-25"}'::jsonb);
--   -- → ok, cumple guardado '12-25'
--
-- Nombre (colapso de espacios):
--   select upsert_cliente(null, '{"nombre":"Ana   María   Pérez","telefono":"3000000005"}'::jsonb);
--   -- → nombre guardado: 'Ana María Pérez'
--
-- Adición negativa rechazada en crear_pedido:
--   select crear_pedido('{"canal":"WhatsApp","customer_id":"C01",
--     "lineas":[{"product_id":"P01","cant":1,"adiciones":[{"nombre":"Salsa extra","precio":-5000,"cant":1}]}]}'::jsonb);
--   -- → exception 'Precio de adición inválido (negativo): Salsa extra'
--   -- (mismo resultado si la adición negativa viene dentro de un slot de combo)
-- ============================================================================
