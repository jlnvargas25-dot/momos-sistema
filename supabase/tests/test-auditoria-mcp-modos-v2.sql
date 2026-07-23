-- MOMOS OPS - H113 - prueba adversarial de auditoria MCP canonica.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_auditoria_mcp_modos_v2'));

do $$
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260723_113_auditoria_mcp_modos_v2'
  ), 'H113 no esta registrada.';
  assert has_function_privilege(
      'service_role','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'
    ),
    'H113 perdio el RBAC privado de la bitacora MCP.';
end $$;

set local role service_role;

do $$
declare
  v_suffix text:=pg_backend_pid()::text;
  v_reference jsonb;
  v_proposal jsonb;
  v_request jsonb;
  v_read jsonb;
  v_duplicate jsonb;
  v_failed boolean:=false;
begin
  v_reference:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h113-reference-'||v_suffix,
    'tool_name','momos_get_brand_asset_reference',
    'mode','Referencia','status','OK','worker_id','h113-worker',
    'subject_ref','brand-asset:test',
    'input_fingerprint',md5('reference-in'),
    'output_fingerprint',md5('reference-out'),
    'details','{"credentials_included":false,"private_path_logged":false}'::jsonb
  ));
  v_proposal:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h113-proposal-'||v_suffix,
    'tool_name','momos_prepare_production_plan',
    'mode','Propuesta','status','OK','worker_id','h113-worker',
    'subject_ref','production-plan:test',
    'input_fingerprint',md5('proposal-in'),
    'output_fingerprint',md5('proposal-out'),
    'details','{"external_execution":false}'::jsonb
  ));
  v_request:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h113-request-'||v_suffix,
    'tool_name','momos_request_human_approval',
    'mode','Solicitud','status','OK','worker_id','h113-worker',
    'subject_ref','human-approval:test',
    'input_fingerprint',md5('request-in'),
    'output_fingerprint',md5('request-out'),
    'details','{"automatic_approval":false}'::jsonb
  ));
  v_read:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h113-read-'||v_suffix,
    'tool_name','momos_generation_pilots',
    'mode','Lectura','status','OK','worker_id','h113-worker',
    'subject_ref','generation-pilots',
    'input_fingerprint',md5('read-in'),
    'output_fingerprint',md5('read-out'),
    'details','{"publication_allowed":false}'::jsonb
  ));

  assert coalesce((v_reference->>'ok')::boolean,false)
    and coalesce((v_proposal->>'ok')::boolean,false)
    and coalesce((v_request->>'ok')::boolean,false)
    and coalesce((v_read->>'ok')::boolean,false),
    'H113 no admite los cuatro modos canonicos.';

  v_duplicate:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h113-reference-'||v_suffix,
    'tool_name','momos_get_brand_asset_reference',
    'mode','Referencia','status','OK','worker_id','h113-worker',
    'subject_ref','brand-asset:test',
    'input_fingerprint',md5('reference-in'),
    'output_fingerprint',md5('reference-out'),
    'details','{"credentials_included":false,"private_path_logged":false}'::jsonb
  ));
  assert coalesce((v_duplicate->>'duplicate')::boolean,false)
    and v_duplicate->>'id'=v_reference->>'id',
    'H113 no conserva idempotencia exacta.';

  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','h113-reference-'||v_suffix,
      'tool_name','momos_get_brand_asset_reference',
      'mode','Referencia','status','Denegado','worker_id','h113-worker',
      'subject_ref','brand-asset:test',
      'input_fingerprint',md5('reference-in'),
      'output_fingerprint',md5('reference-out'),
      'details','{"credentials_included":false,"private_path_logged":false}'::jsonb
    ));
  exception when others then v_failed:=position('otro contrato' in sqlerrm)>0; end;
  assert v_failed, 'H113 permitio reutilizar request_key con otro contrato.';

  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','h113-wrong-mode-'||v_suffix,
      'tool_name','momos_get_brand_asset_reference',
      'mode','Lectura','status','OK','worker_id','h113-worker',
      'subject_ref','brand-asset:test',
      'input_fingerprint',md5('wrong-mode'),
      'output_fingerprint',md5('wrong-mode-out'),
      'details','{}'::jsonb
    ));
  exception when others then v_failed:=position('modo no coincide' in sqlerrm)>0; end;
  assert v_failed, 'H113 permitio cruzar herramienta y modo.';

  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','h113-invalid-status-'||v_suffix,
      'tool_name','momos_health',
      'mode','Lectura','status','Error','worker_id','h113-worker',
      'subject_ref','health',
      'input_fingerprint',md5('invalid-status'),
      'output_fingerprint',md5('invalid-status-out'),
      'details','{}'::jsonb
    ));
  exception when others then v_failed:=position('Contrato de auditoria' in sqlerrm)>0; end;
  assert v_failed, 'H113 acepto un estado que la tabla rechaza.';

  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','h113-invalid-hash-'||v_suffix,
      'tool_name','momos_health',
      'mode','Lectura','status','OK','worker_id','h113-worker',
      'subject_ref','health',
      'input_fingerprint',repeat('a',64),
      'output_fingerprint',md5('invalid-hash-out'),
      'details','{}'::jsonb
    ));
  exception when others then v_failed:=position('Contrato de auditoria' in sqlerrm)>0; end;
  assert v_failed, 'H113 acepto una huella incompatible con la tabla.';

  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','h113-pii-'||v_suffix,
      'tool_name','momos_health',
      'mode','Lectura','status','OK','worker_id','h113-worker',
      'subject_ref','health',
      'input_fingerprint',md5('pii-in'),
      'output_fingerprint',md5('pii-out'),
      'details','{"customer_phone":"3000000000"}'::jsonb
    ));
  exception when others then v_failed:=position('Contrato de auditoria' in sqlerrm)>0; end;
  assert v_failed, 'H113 permitio PII en details.';
end $$;

reset role;

do $$
begin
  assert (
    select count(*) from public.agency_mcp_access_log
    where worker_id='h113-worker'
  )=4, 'H113 duplico o perdio eventos validos.';
end $$;

select 'TESTS_OK - H113 modos/idempotencia/PII/huellas/RBAC PASS, rollback total' as resultado;
rollback;
