-- ============================================================
-- rpc_sugerencias_v1 — set_sugerencia_estado(p_sug_id, p_estado) → void
--
-- Gap descubierto en Fase 3 slice 4: "Marcar atendida" en Inventario (sobre
-- production_suggestions con area='Inventario') seguía escribiendo con
-- update(d => ...) local. production_suggestions es server-hydrated desde
-- slice 3a — esa escritura local se pierde en el siguiente refrescar().
-- Era la última mutación local que quedaba en Produccion/Inventario.
--
-- Estados válidos (CHECK de la tabla, schema-v5.sql): 'Pendiente' | 'Atendida'.
-- crear_lote (rpc-produccion-v1.sql) ya hace UPDATE directo a 'Atendida' al
-- consumir una sugerencia de área 'Producción' server-side, SIN pasar por esta
-- RPC ni auditar ese caso — este RPC cubre el otro camino: el botón manual
-- "Marcar atendida" del front sobre sugerencias de área 'Inventario'.
--
-- Patrón (Fase 2 / rpc-evidencias-v1.sql):
--   · gatea por is_staff()
--   · bloquea la fila con FOR UPDATE antes de decidir (evita carreras)
--   · valida existencia y que p_estado sea uno de los dos valores del CHECK
--   · no-op silencioso si ya está en el estado pedido (paridad con set_lote_estado)
--   · audita 'Cambio de estado' en la misma transacción vía _add_audit
-- ============================================================

create or replace function public.set_sugerencia_estado(p_sug_id text, p_estado text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s production_suggestions%rowtype;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede cambiar el estado de una sugerencia';
  end if;

  select * into s from production_suggestions where id = p_sug_id for update;
  if s.id is null then
    raise exception 'La sugerencia % no existe', p_sug_id;
  end if;

  if p_estado is null or p_estado not in ('Pendiente','Atendida') then
    raise exception 'Estado de sugerencia inválido: %', coalesce(p_estado, '(vacío)');
  end if;

  if s.estado = p_estado then
    return; -- no-op: ya estaba en el estado pedido (evita doble clic / doble audit)
  end if;

  update production_suggestions set estado = p_estado where id = p_sug_id;

  perform _add_audit('Inventario', p_sug_id, 'Cambio de estado', s.estado, p_estado);
end;
$$;

-- ⚠️ Regla del audit de Fase 2: el revoke SIEMPRE incluye authenticated para helpers;
-- esta es RPC PÚBLICA → revoke de public/anon + grant explícito solo a authenticated.
revoke execute on function public.set_sugerencia_estado(text, text) from public, anon;
grant execute on function public.set_sugerencia_estado(text, text) to authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname='set_sugerencia_estado';  → 1 fila, prosecdef=t
--   (con anon) select set_sugerencia_estado('S-1','Atendida');                     → permission denied
