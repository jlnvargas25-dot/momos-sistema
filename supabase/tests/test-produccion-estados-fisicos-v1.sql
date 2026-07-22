-- MOMOS OPS · prueba H78 estados físicos del lote. Siempre ROLLBACK.
begin;

do $$
declare v_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_78_produccion_estados_fisicos'), 'Falta aplicar la migración H78.';
  assert has_function_privilege('authenticated','public.set_lote_estado(text,text)','EXECUTE'), 'Staff perdió la RPC de estados físicos.';
  assert not has_function_privilege('anon','public.set_lote_estado(text,text)','EXECUTE'), 'La RPC de estados físicos quedó expuesta a anon.';
  assert pg_get_functiondef('public.set_lote_estado(text,text)'::regprocedure) like '%p_estado not in (%', 'La RPC no contiene el cierre de dominio físico.';
  select auth_id into v_auth from public.users where activo and auth_id is not null order by (rol='Administrador') desc,id limit 1;
  assert v_auth is not null, 'Falta un usuario staff autenticable para la prueba.';
  perform set_config('momos.h78_actor_auth',v_auth::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h78_actor_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_batch text;
  v_before text;
  v_forbidden text;
  v_failed boolean;
  v_result jsonb;
begin
  select id,estado into v_batch,v_before from public.production_batches order by id desc limit 1;
  assert v_batch is not null, 'Falta un lote real para probar el cierre sin fabricar inventario.';

  foreach v_forbidden in array array['Reservado','Vendido','Imperfecto','Descartado'] loop
    v_failed:=false;
    begin
      perform public.set_lote_estado(v_batch,v_forbidden);
    exception when sqlstate '22023' then
      v_failed:=true;
    end;
    assert v_failed, 'La RPC aceptó el estado manual prohibido '||v_forbidden;
    assert (select estado from public.production_batches where id=v_batch)=v_before,
      'El lote cambió después de rechazar '||v_forbidden;
  end loop;

  -- Un no-op físico válido demuestra que la función sigue operable sin tocar
  -- stock, cronómetro ni auditoría del lote escogido.
  if v_before in ('En preparación','Congelando','Listo') then
    v_result:=public.set_lote_estado(v_batch,v_before);
    assert (v_result->>'sin_cambio')::boolean, 'El no-op físico válido dejó de funcionar.';
  end if;
end $$;

reset role;
select 'TESTS_OK — estados físicos del lote/RBAC/anti-reserva-manual PASS, rollback total' as resultado;
rollback;
