-- ============================================================================
-- MOMOS OPS — Fix de permisos v1 (2026-07-10)
-- Hallazgo del linter de seguridad de Supabase (get_advisors):
-- los helpers internos _* del slice 1 y next_id() eran ejecutables vía la API
-- REST por `authenticated` (y next_id hasta por `anon`). Causa: Supabase otorga
-- EXECUTE por default privileges a anon/authenticated sobre toda función nueva;
-- el slice 1 revocó de public/anon pero NO de authenticated.
--
-- Impacto que cierra este fix: un staff logueado podía invocar _add_movement /
-- _deduct_recipe / _release_reservations / _add_audit etc. DIRECTO por REST,
-- saltándose los gates y validaciones de las RPCs públicas (contra el diseño
-- servidor-árbitro), y un anónimo podía inflar counters con next_id().
--
-- NO se toca: is_staff() / is_admin() / current_rol() / current_customer_id()
-- — las políticas RLS los evalúan como el ROL CONSULTANTE (anon/authenticated);
-- revocarlos rompería todas las policies. Que anon pueda llamarlos es
-- INTENCIONAL y no filtra nada (devuelven false/null sin sesión).
--
-- Los definer (RPCs públicas) siguen funcionando igual: internamente corren
-- como el dueño (postgres), no necesitan que el caller tenga EXECUTE en los
-- helpers.
-- ============================================================================

revoke execute on function _add_audit(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function _add_movement(text, text, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function _add_reservation(text, text, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function _consume_reservations(text) from public, anon, authenticated;
revoke execute on function _deduct_recipe(text, numeric, text, text) from public, anon, authenticated;
revoke execute on function _order_subtotal(text) from public, anon, authenticated;
revoke execute on function _release_reservations(text) from public, anon, authenticated;
revoke execute on function _reserve_inventory(text) from public, anon, authenticated;
revoke execute on function _tiene_evidencia(text, text) from public, anon, authenticated;
revoke execute on function _tiene_sello(text) from public, anon, authenticated;

-- next_id: solo lo invocan las RPCs definer (corren como dueño); nadie de
-- afuera necesita ejecutarlo.
revoke execute on function next_id(text, text, integer) from public, anon, authenticated;
