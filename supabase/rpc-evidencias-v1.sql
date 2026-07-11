-- ============================================================
-- rpc_evidencias_v1 — crear_evidencia(order_id, tipo, storage_path) → id
--
-- Gap descubierto en Fase 3 slice 3b: el front no puede insertar en evidences
-- directo porque el id (text PK sin default) requiere next_id(), y next_id
-- quedó REVOCADO para authenticated por fix_helper_grants_v1 (audit de seguridad).
-- Solución correcta: RPC security definer (patrón Fase 2) que:
--   · gatea por is_staff()
--   · asigna el id server-side (next_id 'evidence' → E01, E02…)
--   · deriva user_id de auth.uid() (ya no se confía en el client)
--   · audita 'Foto subida' en la misma transacción
-- La gate de set_order_status lee la FILA de evidences: esta RPC es el único
-- camino de escritura del front (la policy evid_insert directa queda sin uso
-- práctico al no poder generar ids — se conserva por si un flujo futuro la necesita).
-- ============================================================

create or replace function public.crear_evidencia(p_order_id text, p_tipo text, p_storage_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text;
  v_id text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede subir evidencias';
  end if;
  if not exists (select 1 from orders where id = p_order_id) then
    raise exception 'El pedido % no existe', p_order_id;
  end if;
  if p_tipo is null or p_tipo not in ('Pedido armado','Caja abierta','Caja cerrada con sello','Bolsa sellada','Comprobante de pago','Entrega') then
    raise exception 'Tipo de evidencia inválido: %', coalesce(p_tipo, '(vacío)');
  end if;
  if p_storage_path is null or length(trim(p_storage_path)) = 0 then
    raise exception 'Falta la ruta del archivo de la evidencia';
  end if;
  -- Hardening (deuda 2026-07-11): la fila de evidences destranca gates de
  -- set_order_status — exigir que el ARCHIVO exista de verdad en Storage
  -- (el front sube primero y llama esta RPC después; una fila sin archivo
  -- solo puede venir de un client malicioso o de un bug).
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'evidencias' and name = p_storage_path
  ) then
    raise exception 'El archivo de la evidencia no existe en Storage — subí la foto primero';
  end if;

  select id into v_user_id from users where auth_id = auth.uid();

  v_id := next_id('evidence', 'E', 2);
  insert into evidences (id, order_id, tipo, storage_path, user_id)
  values (v_id, p_order_id, p_tipo, p_storage_path, v_user_id);

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_user_id, 'Evidencia', p_order_id, 'Foto subida', '', p_tipo);

  return v_id;
end;
$$;

-- ⚠️ Regla del audit de Fase 2: el revoke SIEMPRE incluye authenticated para helpers;
-- esta es RPC PÚBLICA → revoke de public/anon + grant explícito solo a authenticated.
revoke execute on function public.crear_evidencia(text, text, text) from public, anon;
grant execute on function public.crear_evidencia(text, text, text) to authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname='crear_evidencia';  → 1 fila, prosecdef=t
--   (con anon) select crear_evidencia('P-1','x','y');                        → permission denied
