-- ============================================================================
-- MOMOS OPS — Variantes Etapa 3: colchón de sobre-producción (2026-07-12)
-- Target: Supabase / PostgreSQL 17. Cierra el slice variantes+reservas
-- (Etapa 1a desmolde por figura → 1b venta FIFO → sabor sobre figura →
-- Etapa 2 cola de producción → ESTE archivo).
--
-- QUÉ ES ESTE SLICE (decisión del dueño 2026-07-12: colchón POR PRODUCTO):
-- "Sugerencia = reservas + X". Cuando la cocina va a producir para la cola,
-- producir EXACTO lo adeudado es miope: la producción tiene merma
-- (imperfectas/descartadas) y el mostrador vende sin pedido previo. El
-- colchón X es cuántas unidades DE MÁS conviene producir por corrida de ese
-- producto — absorbe imperfectas y mostrador.
--
-- DECISIÓN DE DISEÑO CLAVE (NO reabrir): el colchón es ADVISORY, jamás toca
-- la contabilidad. production_suggestions.cantidad sigue siendo EXACTAMENTE
-- lo adeudado (la cola de Etapa 2 asigna contra ese número); el colchón se
-- suma solo en la CAPA DE DECISIÓN (front: card de sugerencia y banner del
-- form de corrida muestran "cola + colchón = sugerido producir"). Cero
-- cambios en _reserve_inventory / _atender_cola_produccion / desmoldar_lote.
--
-- Solo productos tipo 'momo' llevan colchón: las sugerencias de combo
-- ("Momos para Caja x3") se producen vía sus momos componentes, y los tipo
-- 'pedido' no se producen por corrida.
--
-- SEGURIDAD: set_colchon_produccion es la ÚNICA vía de escritura (el módulo
-- Productos del front aún escribe local — deuda conocida — así que esta RPC
-- es la frontera real: is_admin() adentro, grant a authenticated afuera,
-- mismo patrón que el resto de RPCs públicas de la casa).
--
-- DEPENDENCIAS: schema-v5.sql (products, is_admin, next_id, _add_audit).
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

begin;

-- ============================================================================
-- A) DDL — products.colchon_produccion: unidades de sobre-producción
-- recomendadas por corrida de este producto. 0 = sin colchón (default).
-- ============================================================================
alter table products add column if not exists colchon_produccion integer not null default 0;

alter table products add constraint products_colchon_valido
  check (colchon_produccion >= 0);

comment on column products.colchon_produccion is
  'Colchón de sobre-producción POR PRODUCTO (variantes Etapa 3): unidades de MÁS que conviene producir al atender la cola — absorbe imperfectas y mostrador. ADVISORY: no toca la contabilidad de sugerencias/reservas; solo alimenta la capa de decisión del front (sugerido producir = cola + colchón). Editable solo por Administrador vía set_colchon_produccion.';

-- ============================================================================
-- B) set_colchon_produccion — RPC pública con gate is_admin() adentro.
-- ============================================================================
create or replace function set_colchon_produccion(p_product_id text, p_colchon integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prod record;
begin
  -- `is not true` y NO `not is_admin()`: is_admin() devuelve NULL para un
  -- authenticated sin fila activa en users (ej. cuenta de cliente) — `not
  -- NULL` es NULL y plpgsql lo trata como false = gate BYPASSEADO (fail
  -- open). `is not true` falla CERRADO con NULL, igual que las policies RLS.
  -- (Hallazgo del Judgment Day de Etapa 3, confirmado empíricamente.)
  if is_admin() is not true then
    raise exception 'Solo el Administrador puede cambiar el colchón de producción';
  end if;
  if p_colchon is null or p_colchon < 0 then
    raise exception 'El colchón debe ser un entero mayor o igual a 0';
  end if;

  select id, tipo, nombre, colchon_produccion into v_prod
  from products where id = p_product_id for update;
  if v_prod.id is null then
    raise exception 'El producto % no existe', p_product_id;
  end if;
  if v_prod.tipo <> 'momo' then
    raise exception 'El colchón de producción solo aplica a momos (los combos se producen vía sus componentes)';
  end if;

  if v_prod.colchon_produccion = p_colchon then
    return jsonb_build_object('ok', true, 'colchon', p_colchon, 'cambio', false);
  end if;

  update products set colchon_produccion = p_colchon where id = p_product_id;

  perform _add_audit('Producto', p_product_id, 'Colchón de producción actualizado',
    v_prod.colchon_produccion::text, p_colchon::text || ' (' || v_prod.nombre || ')');

  return jsonb_build_object('ok', true, 'colchon', p_colchon, 'cambio', true);
end $$;

-- Grants — patrón de la casa: revoke public/anon SIEMPRE; grant a
-- authenticated (el gate real es is_admin() adentro, como en el resto de
-- RPCs administrativas).
revoke execute on function set_colchon_produccion(text, integer) from public, anon;
grant execute on function set_colchon_produccion(text, integer) to authenticated;

commit;
