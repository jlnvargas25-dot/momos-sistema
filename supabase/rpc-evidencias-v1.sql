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
-- camino de escritura del front. No existe policy INSERT directa.
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
  v_path text := trim(coalesce(p_storage_path, ''));
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
  if v_path = '' or left(v_path, length(p_order_id) + 1) <> p_order_id || '/'
     or v_path like '/%' or v_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'Ruta inválida: la evidencia debe vivir dentro de %/', p_order_id;
  end if;
  -- Hardening (deuda 2026-07-11): la fila de evidences destranca gates de
  -- set_order_status — exigir que el ARCHIVO exista de verdad en Storage
  -- (el front sube primero y llama esta RPC después; una fila sin archivo
  -- solo puede venir de un client malicioso o de un bug).
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'evidencias' and name = v_path
  ) then
    raise exception 'El archivo de la evidencia no existe en Storage — subí la foto primero';
  end if;
  if exists (select 1 from evidences where storage_path = v_path) then
    raise exception 'Esta foto ya fue registrada y no se puede reutilizar';
  end if;

  select id into v_user_id from users where auth_id = auth.uid();

  v_id := next_id('evidence', 'E', 2);
  insert into evidences (id, order_id, tipo, storage_path, user_id)
  values (v_id, p_order_id, p_tipo, v_path, v_user_id);

  insert into audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (next_id('audit', 'A', 2), v_user_id, 'Evidencia', p_order_id, 'Foto subida', '', p_tipo);

  return v_id;
end;
$$;

-- ⚠️ Regla del audit de Fase 2: el revoke SIEMPRE incluye authenticated para helpers;
-- esta es RPC PÚBLICA → revoke de public/anon + grant explícito solo a authenticated.
revoke execute on function public.crear_evidencia(text, text, text) from public, anon;
grant execute on function public.crear_evidencia(text, text, text) to authenticated;

drop policy if exists evid_insert on public.evidences;
create unique index if not exists evidences_storage_path_uq on public.evidences(storage_path);
revoke insert, update, delete on table public.evidences from anon, authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname='crear_evidencia';  → 1 fila, prosecdef=t
--   (con anon) select crear_evidencia('P-1','x','y');                        → permission denied
