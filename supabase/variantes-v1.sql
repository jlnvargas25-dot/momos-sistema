-- ============================================================================
-- MOMOS OPS — Variantes Etapa 1a: desmolde por figura (2026-07-12)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas base:
-- schema-v5.sql. Fuente de verdad de estados/desmolde vivos:
-- rpc-produccion-v2.sql (desmoldar_lote, set_lote_estado). Fuente de verdad
-- del catálogo de rutas: rutas-familia-v1.sql.
--
-- QUÉ ES ESTE SLICE (Etapa 1a — spec aprobada):
-- Un lote de production_batches puede ser MIXTO: la columna jsonb `figuras`
-- (escrita una sola vez por crear_corrida, WRITE-ONCE) es el PLAN de
-- composición del lote, ej. [{"cant":1,"figura":"Danna"},{"cant":2,"figura":
-- "Max"}]. Hoy desmoldar_lote solo registra 3 conteos TOTALES del lote
-- (perfectas/imperfectas/descartadas) — no hay forma de saber cuántas
-- perfectas salieron de CADA figura dentro de un lote mixto. Este archivo
-- agrega la tabla `lote_figuras` como RESULTADO del desmolde (los conteos
-- reales, por figura, del evento de desmolde) y evoluciona desmoldar_lote
-- para poder recibirlos.
--
-- DECISIÓN DE DISEÑO — jsonb = PLAN (write-once), tabla = RESULTADO:
-- production_batches.figuras (jsonb) nace en crear_corrida y NUNCA se
-- reescribe después — es la composición PLANEADA del lote, inmutable. La
-- tabla nueva `lote_figuras` es el RESULTADO del desmolde: un evento ÚNICO
-- por lote (no hay desmolde parcial en Etapa 1a — cada figura del lote
-- cuadra COMPLETA el mismo día que se desmolda el lote entero). Las
-- imperfectas/descartadas se reparten POR FIGURA en ese mismo evento — el
-- dato de "cuántas imperfectas salieron de la figura X" nace ACÁ, nunca se
-- infiere ni se prorratea después de la tabla del plan.
--
-- ETAPAS FUTURAS (fuera de alcance de este archivo, documentado para que no
-- se reinvente el diseño):
--   1b: descuento FIFO de venta por variante (qué lote/figura se vende primero).
--   2:  reservas por variante (hoy `reservations` es por producto, no por figura).
--   3:  colchón/buffer de stock mínimo por variante (hoy `products.minimo`
--       es por producto agregado, no por figura).
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql
--   2. rpc-produccion-v1.sql
--   3. sedes-v1.sql
--   4. fix-grants-v1.sql
--   5. rpc-produccion-v2.sql   (desmoldar_lote/set_lote_estado que ESTE archivo evoluciona)
--   6. subrecetas-bom-v1.sql
--   7. rutas-familia-v1.sql
--   8. ESTE ARCHIVO (variantes-v1.sql)
--
-- CONCLUSIÓN sobre set_lote_estado (leído el cuerpo real en rpc-produccion-v2.sql
-- sección D, líneas 550-615): la rama →'Listo' YA exige, desde v2, que
-- perfectas+imperfectas+descartadas = prod ANTES de aceptar la transición
-- (guard de la línea 579). Ese guard no distingue lote mixto de lote simple:
-- solo mira los 3 totales del lote. desmoldar_lote es quien AHORA exige
-- p_figuras para lotes mixtos (ver sección C más abajo) — una vez que
-- desmoldar_lote corrió con éxito (con o sin p_figuras), el lote YA tiene
-- perfectas+imperfectas+descartadas=prod Y estado='Listo' seteado por la
-- MISMA función. Por lo tanto set_lote_estado NO NECESITÓ NINGÚN CAMBIO: un
-- lote mixto que todavía no pasó por desmoldar_lote sigue sin poder llegar a
-- 'Listo' (falla el guard existente exactamente igual que hoy, con el mismo
-- mensaje "usá desmoldar_lote"); y un lote (simple o mixto) que YA desmoldó
-- por la función nueva pasa sin fricción, porque sus 3 totales ya cuadran.
-- CERO líneas tocadas en set_lote_estado.
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- begin/commit: el swap de firma de desmoldar_lote (create nueva + drop vieja
-- + grants) debe ser atómico ante cualquier método de deploy — sin ventana
-- donde ambas firmas coexistan para llamadas concurrentes.
begin;

-- ============================================================================
-- A) DDL — tabla lote_figuras (RESULTADO del desmolde, por figura)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A.1) lote_figuras — una fila por figura de un lote YA desmoldado. `cant` es
-- la copia del PLAN (production_batches.figuras) al momento del desmolde —
-- NUNCA se lee el jsonb después de este punto para saber "cuánto se debía
-- producir de esta figura": esta tabla es la fuente de verdad post-desmolde.
-- check de cuadratura POR FILA: cada figura cuadra COMPLETA (el desmolde es
-- un evento único por lote, no hay desmolde parcial en esta etapa — ver
-- DECISIÓN DE DISEÑO arriba).
-- ---------------------------------------------------------------------------
create table if not exists lote_figuras (
  batch_id    text not null references production_batches(id),
  figura      text not null,
  cant        integer not null check (cant > 0),
  perfectas   integer not null default 0 check (perfectas >= 0),
  imperfectas integer not null default 0 check (imperfectas >= 0),
  descartadas integer not null default 0 check (descartadas >= 0),
  primary key (batch_id, figura),
  constraint lote_figuras_cuadra check (perfectas + imperfectas + descartadas = cant)
);

-- RLS — MISMO patrón vigente que rpc-produccion-v2.sql/subrecetas-bom-v1.sql
-- (admin_all `to authenticated` + staff_read `to authenticated`), NO el
-- patrón viejo de sedes-v1.sql que omite `to authenticated` en admin_all.
-- Sin política de insert/update para staff: la única puerta de escritura es
-- desmoldar_lote (security definer, corre como dueño).
alter table lote_figuras enable row level security;

drop policy if exists admin_all on lote_figuras;
create policy admin_all on lote_figuras for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists staff_read on lote_figuras;
create policy staff_read on lote_figuras for select
  to authenticated using (is_staff());

-- ============================================================================
-- B) desmoldar_lote — NUEVA FIRMA (p_figuras jsonb default null agregado).
--
-- ⚠️ IDENTIDAD DE FUNCIÓN EN POSTGRES: agregar un parámetro (aunque tenga
-- DEFAULT) cambia la firma de la función — `create or replace` con una firma
-- distinta NO reemplaza la función existente, CREA UNA SEGUNDA función
-- (desmoldar_lote(text,int,int,int,jsonb) coexistiendo con
-- desmoldar_lote(text,int,int,int)). Los GRANTS no se heredan de la vieja a
-- la nueva: hay que (1) crear la versión nueva, (2) DROP explícito de la
-- vieja de 4 args, (3) revoke/grant EXACTO en la nueva — mismo patrón de
-- fix-grants-v1.sql (revoke SIEMPRE incluye `authenticated`, no solo
-- public/anon, porque Supabase otorga EXECUTE por default privileges a
-- anon/authenticated sobre TODA función nueva — incluida esta).
--
-- LÓGICA PRESERVADA INTACTA de rpc-produccion-v2.sql sección C (guards de
-- is_staff/lote existe/stock_contabilizado/estado válido/conteos=prod, el
-- UPDATE de production_batches con estado='Listo'+stock_contabilizado=true,
-- la suma de stock del producto SIN movimiento de inventario, y el audit
-- final) — CERO guards ni efectos removidos, solo se AGREGA el manejo de
-- p_figuras alrededor de esa lógica ya existente.
--
-- LÓGICA NUEVA:
--  1. Leer el PLAN (production_batches.figuras). Lotes pre-v2 sin jsonb
--     válido (null o no-array) se tratan como figura única de fallback
--     legacy: nombre = coalesce(nullif(figura,''), '—'), cant = prod — la
--     misma convención de "figura vacía" que ya usa el resto del sistema
--     para lotes viejos.
--  2. p_figuras IS NULL:
--     - Plan de 1 sola figura → AUTO-DERIVAR una fila lote_figuras con los
--       conteos TOTALES del lote (perfectas/imperfectas/descartadas ya
--       validados arriba). Cero fricción para el front actual — un lote
--       simple sigue desmoldándose exactamente como hoy, sin mandar nada
--       nuevo en el payload.
--     - Plan MIXTO (2+ figuras) → raise exception 'LOTE_MIXTO: ...' — el
--       front usa ese mensaje/código para abrir el detalle por figura y
--       reintentar CON p_figuras.
--  3. p_figuras viene (array [{figura,perfectas,imperfectas,descartadas}]):
--     guards (a) set de figuras == exactamente las del plan (ni de más ni de
--     menos, sin duplicados), (b) por figura perfectas+imperfectas+
--     descartadas = cant del plan (ese guard también vive como CHECK de
--     tabla — se valida acá ANTES para dar un mensaje claro por figura en
--     vez de un error crudo de constraint), (c) Σ perfectas/imperfectas/
--     descartadas de p_figuras == p_perfectas/p_imperfectas/p_descartadas
--     (coherencia doble: los totales del lote siguen siendo la fuente que
--     alimenta products.stock, exactamente igual que antes — p_figuras
--     nunca reemplaza esa fuente, solo la desglosa).
--  4. Idempotencia/carrera: se preserva el guard existente de
--     `stock_contabilizado` (ya bloquea un segundo desmolde del mismo lote
--     ANTES de tocar lote_figuras). Adicionalmente, si por alguna carrera
--     ya hubiera filas en lote_figuras para este batch_id, la PK
--     (batch_id, figura) las protege de duplicado — se atrapa ese error
--     puntual con un mensaje claro en vez de dejar pasar el 23505 crudo.
-- ============================================================================
create or replace function desmoldar_lote(
  p_batch_id text, p_perfectas integer, p_imperfectas integer, p_descartadas integer,
  p_figuras jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  v_prod record;
  v_plan jsonb;                    -- PLAN normalizado: [{"figura":..,"cant":..}, ...]
  v_plan_count integer;
  v_fig jsonb;
  v_fig_nombre text;
  v_fig_cant integer;
  v_fig_perfectas integer;
  v_fig_imperfectas integer;
  v_fig_descartadas integer;
  v_plan_figuras text[];           -- nombres del PLAN, sin duplicados
  v_enviadas_figuras text[];       -- nombres recibidos en p_figuras, sin duplicados
  v_sum_perfectas integer := 0;
  v_sum_imperfectas integer := 0;
  v_sum_descartadas integer := 0;
  v_cant_plan integer;             -- cant del plan para la figura actual (segunda pasada)
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede desmoldar lotes';
  end if;

  select * into b from production_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'El lote % no existe', p_batch_id;
  end if;

  -- ---- INTACTO de rpc-produccion-v2.sql sección C: guards de idempotencia/
  -- estado/conteos, SIN NINGÚN CAMBIO ----
  if b.stock_contabilizado then
    raise exception 'El lote % ya fue desmoldado', p_batch_id;
  end if;
  if b.estado not in ('En preparación','Congelando') then
    raise exception 'El lote % debe estar "En preparación" o "Congelando" para desmoldarse (está en "%")', p_batch_id, b.estado;
  end if;

  if p_perfectas is null or p_imperfectas is null or p_descartadas is null
     or p_perfectas < 0 or p_imperfectas < 0 or p_descartadas < 0 then
    raise exception 'Perfectas, imperfectas y descartadas son obligatorias y no pueden ser negativas';
  end if;
  if p_perfectas + p_imperfectas + p_descartadas <> b.prod then
    raise exception 'Los conteos no cuadran: %+%+%=% pero el lote produjo %',
      p_perfectas, p_imperfectas, p_descartadas, p_perfectas + p_imperfectas + p_descartadas, b.prod;
  end if;

  -- ---- NUEVO: resolver el PLAN de figuras de este lote. Lotes pre-v2 (sin
  -- jsonb válido) caen al fallback legacy de figura única = columna `figura`
  -- (o '—' si vino vacía) con cant = prod del lote.
  if b.figuras is not null and jsonb_typeof(b.figuras) = 'array' and jsonb_array_length(b.figuras) > 0 then
    v_plan := b.figuras;
  else
    v_plan := jsonb_build_array(
      jsonb_build_object('figura', coalesce(nullif(b.figura,''), '—'), 'cant', b.prod)
    );
  end if;
  select array_agg(distinct trim(f->>'figura')) into v_plan_figuras
  from jsonb_array_elements(v_plan) as f;
  v_plan_count := coalesce(array_length(v_plan_figuras, 1), 0);

  -- ---- NUEVO: invariante del plan DECLARADA (la garantiza crear_corrida vía
  -- group by product+gramaje con figuras únicas — acá se declara en vez de
  -- asumirse, para que el limit 1/indexación de las ramas de abajo sea seguro) ----
  if (select count(*) from jsonb_array_elements(v_plan)) <> (select count(distinct trim(f->>'figura')) from jsonb_array_elements(v_plan) f) then
    raise exception 'Plan de figuras corrupto en el lote %: figura repetida en production_batches.figuras — revisá el lote', p_batch_id;
  end if;

  if p_figuras is null then
    -- ---- NUEVO: plan de una sola figura → auto-derivar, cero fricción ----
    if v_plan_count = 1 then
      -- ---- NUEVO: mismo catch de idempotencia/carrera que la rama con
      -- p_figuras — mismo mensaje amable en vez del 23505 crudo ----
      begin
        insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
        values (p_batch_id, v_plan_figuras[1], (v_plan->0->>'cant')::integer, p_perfectas, p_imperfectas, p_descartadas);
      exception when unique_violation then
        raise exception 'El lote % ya tiene el desmolde por figura registrado', p_batch_id;
      end;
    else
      raise exception 'LOTE_MIXTO: el lote % combina % figuras — enviá p_figuras con conteos por figura', p_batch_id, v_plan_count;
    end if;
  else
    -- ---- NUEVO: p_figuras viene — guards (a) set exacto, (b) cuadratura
    -- por figura, (c) coherencia con los totales del lote ----
    if jsonb_typeof(p_figuras) <> 'array' or jsonb_array_length(p_figuras) = 0 then
      raise exception 'p_figuras debe ser un array no vacío de {figura,perfectas,imperfectas,descartadas}';
    end if;

    select array_agg(distinct trim(f->>'figura')) into v_enviadas_figuras
    from jsonb_array_elements(p_figuras) as f;

    if jsonb_array_length(p_figuras) <> coalesce(array_length(v_enviadas_figuras,1),0) then
      raise exception 'p_figuras no puede repetir la misma figura dos veces';
    end if;
    if not (v_enviadas_figuras <@ v_plan_figuras and v_plan_figuras <@ v_enviadas_figuras) then
      raise exception 'p_figuras debe cubrir EXACTAMENTE las figuras del plan del lote % (plan: %, recibidas: %)',
        p_batch_id, array_to_string(v_plan_figuras, ', '), array_to_string(v_enviadas_figuras, ', ');
    end if;

    for v_fig in select * from jsonb_array_elements(p_figuras)
    loop
      v_fig_nombre := trim(v_fig->>'figura');
      v_fig_perfectas := nullif(v_fig->>'perfectas','')::integer;
      v_fig_imperfectas := nullif(v_fig->>'imperfectas','')::integer;
      v_fig_descartadas := nullif(v_fig->>'descartadas','')::integer;
      if v_fig_perfectas is null or v_fig_imperfectas is null or v_fig_descartadas is null
         or v_fig_perfectas < 0 or v_fig_imperfectas < 0 or v_fig_descartadas < 0 then
        raise exception 'La figura «%» necesita perfectas/imperfectas/descartadas obligatorias y no negativas', v_fig_nombre;
      end if;

      select (f->>'cant')::integer into v_cant_plan
      from jsonb_array_elements(v_plan) as f
      where trim(f->>'figura') = v_fig_nombre
      limit 1;

      if v_fig_perfectas + v_fig_imperfectas + v_fig_descartadas <> v_cant_plan then
        raise exception 'La figura «%» no cuadra: %+%+%=% pero el plan pide %',
          v_fig_nombre, v_fig_perfectas, v_fig_imperfectas, v_fig_descartadas,
          v_fig_perfectas + v_fig_imperfectas + v_fig_descartadas, v_cant_plan;
      end if;

      v_sum_perfectas := v_sum_perfectas + v_fig_perfectas;
      v_sum_imperfectas := v_sum_imperfectas + v_fig_imperfectas;
      v_sum_descartadas := v_sum_descartadas + v_fig_descartadas;
    end loop;

    if v_sum_perfectas <> p_perfectas or v_sum_imperfectas <> p_imperfectas or v_sum_descartadas <> p_descartadas then
      raise exception 'La suma por figura (%+%+%=%) no coincide con los totales del lote (%+%+%=%)',
        v_sum_perfectas, v_sum_imperfectas, v_sum_descartadas, v_sum_perfectas + v_sum_imperfectas + v_sum_descartadas,
        p_perfectas, p_imperfectas, p_descartadas, p_perfectas + p_imperfectas + p_descartadas;
    end if;

    -- ---- NUEVO: idempotencia/carrera — si ya hay filas de este batch_id
    -- (carrera rarísima: stock_contabilizado se marca en el UPDATE de abajo,
    -- en la MISMA transacción; esta protección es defensiva, la PK es el
    -- árbitro real) ----
    begin
      insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
      select p_batch_id, trim(f->>'figura'), (f->>'cant')::integer,
             (f2->>'perfectas')::integer, (f2->>'imperfectas')::integer, (f2->>'descartadas')::integer
      from jsonb_array_elements(v_plan) as f
      join jsonb_array_elements(p_figuras) as f2 on trim(f2->>'figura') = trim(f->>'figura');
    exception when unique_violation then
      raise exception 'El lote % ya tiene el desmolde por figura registrado', p_batch_id;
    end;
  end if;

  -- ---- INTACTO de rpc-produccion-v2.sql sección C: mismo UPDATE, mismo
  -- alta de stock del producto, mismo audit, SIN NINGÚN CAMBIO ----
  update production_batches set
    perfectas = p_perfectas,
    imperfectas = p_imperfectas,
    descartadas = p_descartadas,
    estado = 'Listo',
    stock_contabilizado = true
  where id = p_batch_id;

  select id, tipo into v_prod from products where id = b.product_id for update;
  if v_prod.id is not null and v_prod.tipo = 'momo' then
    update products set stock = coalesce(stock,0) + p_perfectas where id = b.product_id;
  end if;

  perform _add_audit('Lote', p_batch_id, 'Lote desmoldado', b.estado,
    'Listo · P=' || p_perfectas || ' I=' || p_imperfectas || ' D=' || p_descartadas);

  return jsonb_build_object('ok', true, 'estado', 'Listo');
end $$;

-- Firma vieja de 4 args: DROP explícito — create or replace de arriba, con
-- firma DISTINTA (5 args), no la reemplaza (ver ⚠️ de la sección B). Sin
-- este DROP quedarían DOS funciones desmoldar_lote coexistiendo y Postgres
-- fallaría la llamada con "function is not unique" en cuanto el caller no
-- mande p_figuras explícito con su tipo exacto.
drop function if exists desmoldar_lote(text, integer, integer, integer);

-- Grants — MISMO patrón que fix-grants-v1.sql/rpc-produccion-v2.sql sección E:
-- revoke SIEMPRE incluye `authenticated` (Supabase otorga EXECUTE por default
-- privileges a anon/authenticated sobre TODA función nueva — y esta lo es,
-- por la firma nueva) + grant explícito solo a `authenticated`.
revoke execute on function desmoldar_lote(text, integer, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function desmoldar_lote(text, integer, integer, integer, jsonb) to authenticated;

-- set_lote_estado NO se toca en este archivo — CERO cambios, ver CONCLUSIÓN
-- en la cabecera. Su firma (p_batch_id text, p_estado text) no varía, así
-- que ni siquiera hace falta un create or replace: no hay nada que replicar.

-- ============================================================================
-- C) Vista v_variantes_disponibles — disponible por variante (producto +
-- figura + sabor + gramaje), para consumo de staff (sin costos).
-- security_invoker = on (regla del proyecto para vistas nuevas — mismo
-- patrón que v_order_totals/v_campaign_metrics en schema-v5.sql: la vista
-- respeta el RLS del que consulta, no del dueño; sin esto el audit de
-- advisors marca la vista como fuga potencial).
-- ============================================================================
create or replace view v_variantes_disponibles with (security_invoker = on) as
select
  p.id as product_id,
  p.nombre as producto,
  lf.figura,
  b.sabor,
  b.gramaje_g,
  sum(lf.perfectas) as disponibles,
  min(coalesce(b.vencimiento, b.vence)) as vencimiento_proximo
from lote_figuras lf
join production_batches b on b.id = lf.batch_id
join products p on p.id = b.product_id
where b.estado = 'Listo' and b.stock_contabilizado = true
group by p.id, p.nombre, lf.figura, b.sabor, b.gramaje_g;

grant select on v_variantes_disponibles to authenticated;
-- Sin políticas RLS propias: es una vista (no una tabla), security_invoker
-- hace que el RLS de lote_figuras/production_batches/products se aplique
-- con el rol del que consulta — mismo mecanismo que las vistas de
-- schema-v5.sql, sin necesidad de una policy nueva.

commit;
