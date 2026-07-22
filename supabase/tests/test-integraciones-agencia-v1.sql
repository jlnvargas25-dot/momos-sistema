-- MOMOS OPS · prueba adversarial Integraciones de Agencia v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_23_integraciones_agencia'), 'Falta aplicar la migración 23.';
  assert public.integraciones_agencia_disponibles(), 'La sonda de integraciones no responde.';
  assert (select count(*) from public.agency_integrations)=4, 'El catálogo de proveedores quedó incompleto.';
  assert not has_table_privilege('authenticated','public.agency_integrations','UPDATE'), 'Authenticated puede falsificar la salud del conector.';
  assert has_function_privilege('authenticated','public.guardar_referencia_integracion_agencia(jsonb)','EXECUTE'), 'Falta la configuración administrativa.';
  assert not has_function_privilege('authenticated','public.reportar_integracion_agencia_conector(text,text,boolean,text,jsonb,text,text,boolean)','EXECUTE'), 'El heartbeat privado quedó expuesto.';
  assert not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agency_integrations'
      and column_name in ('token','access_token','refresh_token','api_key','secret','secret_value')
  ), 'La tabla pública contiene una columna de secretos.';
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_result jsonb; v_failed boolean:=false;
begin
  v_result:=public.guardar_referencia_integracion_agencia(jsonb_build_object(
    'provider','Higgsfield','environment','Pruebas','account_label','Cuenta creativa MOMOS','external_account_id','acct-test'
  ));
  assert v_result->>'status'='Configurada', 'La referencia no dejó la integración Configurada.';
  assert exists(select 1 from public.agency_integrations where provider='Higgsfield' and account_label='Cuenta creativa MOMOS' and secret_configured=false), 'La referencia inventó un secreto configurado.';
  perform public.pausar_integracion_agencia('Higgsfield','Pausa adversarial controlada');
  assert exists(select 1 from public.agency_integrations where provider='Higgsfield' and status='Pausada'), 'La pausa administrativa no quedó sellada.';
  begin perform public.reportar_integracion_agencia_conector('Higgsfield','Activa',true,'',null,null,null,false);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Authenticated reportó un heartbeat reservado al servidor.';
end $$;

reset role;
set local role service_role;

do $$
declare v_failed boolean:=false;
begin
  begin perform public.reportar_integracion_agencia_conector('Higgsfield','Activa',false,'',null,null,null,false);
  exception when others then v_failed:=true; end;
  assert v_failed, 'El servidor declaró Activo un conector sin secreto.';
  perform public.reportar_integracion_agencia_conector(
    'Higgsfield','Activa',true,'',jsonb_build_array('Imagen','Video'),'MOMOS Creativo','acct-live',true
  );
end $$;

reset role;
set local role authenticated;

do $$ begin
  assert exists(
    select 1 from public.agency_integrations
    where provider='Higgsfield' and status='Activa' and secret_configured
      and last_heartbeat_at is not null and last_sync_at is not null and last_error=''
  ), 'El heartbeat válido no dejó salud y sincronización trazables.';
end $$;

select 'TESTS_OK — integraciones Agencia salud/secretos/RBAC PASS, rollback total' as resultado;
rollback;
