begin;

do $$
declare v_definition text;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_110_formato_video_cuatro_tres'),
    'Falta H110.';
  select pg_get_functiondef('public.crear_trabajo_creativo(jsonb)'::regprocedure) into v_definition;
  assert position('''Video 4:3''' in v_definition)>0,
    'El contrato de trabajos no admite Video 4:3.';
  assert position('''Video 16:10''' in v_definition)=0,
    'H110 abrió formatos arbitrarios.';
  assert has_function_privilege('authenticated','public.crear_trabajo_creativo(jsonb)','EXECUTE'),
    'El staff autenticado perdió el RPC canónico.';
  assert not has_function_privilege('anon','public.crear_trabajo_creativo(jsonb)','EXECUTE'),
    'H110 expuso creación de trabajos a anon.';
end $$;

select 'TESTS_OK — Video 4:3 contrato cerrado/RBAC PASS, rollback total' as resultado;
rollback;
