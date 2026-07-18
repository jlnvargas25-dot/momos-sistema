-- MOMOS OPS · prueba adversarial H62/H63 Aprobación humana MCP. Siempre ROLLBACK.
-- Verifica que el runtime MCP solo pueda solicitar/consultar un preflight exacto
-- y que únicamente Administración autenticada pueda resolverlo y sellar su tope.
begin;

do $$
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_62_mcp_aprobacion_humana'
  ), 'Falta aplicar H62 Aprobación humana MCP.';
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_63_mcp_aprobacion_humana_rbac'
  ), 'Falta aplicar H63 cierre RBAC de Aprobación humana MCP.';
  assert public.mcp_aprobaciones_humanas_disponible(),
    'La sonda de aprobaciones humanas MCP no responde.';
  assert to_regclass('public.agency_mcp_human_approvals') is not null,
    'Falta la bandeja de aprobaciones humanas MCP.';

  assert public.mcp_aprobacion_humana_contrato()->>'schema_version'='momos-human-approval-contract/v1'
    and public.mcp_aprobacion_humana_contrato()->>'status_schema'='momos-human-approval-status/v1'
    and public.mcp_aprobacion_humana_contrato()->>'provider'='Higgsfield'
    and (public.mcp_aprobacion_humana_contrato()->>'max_ttl_hours')::integer=72
    and coalesce((public.mcp_aprobacion_humana_contrato()->>'mcp_can_decide')::boolean,true)=false
    and coalesce((public.mcp_aprobacion_humana_contrato()->>'external_execution_allowed')::boolean,true)=false,
    'El contrato MCP amplió proveedor, vigencia o capacidad de ejecución.';

  assert has_function_privilege(
    'service_role','public.momos_solicitar_aprobacion_humana(jsonb)','EXECUTE'
  ), 'El runtime MCP no puede solicitar una decisión.';
  assert has_function_privilege(
    'service_role','public.momos_consultar_aprobacion_humana(bigint,text)','EXECUTE'
  ), 'El runtime MCP no puede consultar una decisión exacta.';
  assert not has_function_privilege(
    'service_role','public.resolver_aprobacion_humana_mcp(bigint,text,text,text)','EXECUTE'
  ), 'El runtime MCP puede autoaprobar una solicitud.';
  assert not has_function_privilege(
    'authenticated','public.momos_solicitar_aprobacion_humana(jsonb)','EXECUTE'
  ), 'El navegador puede fabricar solicitudes del runtime.';
  assert not has_function_privilege(
    'authenticated','public.momos_consultar_aprobacion_humana(bigint,text)','EXECUTE'
  ), 'El navegador puede consultar la superficie privada del runtime.';
  assert has_function_privilege(
    'authenticated','public.resolver_aprobacion_humana_mcp(bigint,text,text,text)','EXECUTE'
  ), 'La bandeja humana no puede resolver mediante su RPC gobernada.';
  assert not has_function_privilege(
    'anon','public.resolver_aprobacion_humana_mcp(bigint,text,text,text)','EXECUTE'
  ), 'Anon puede resolver aprobaciones creativas.';

  assert not has_table_privilege(
    'service_role','public.agency_mcp_human_approvals','INSERT'
  ) and not has_table_privilege(
    'service_role','public.agency_mcp_human_approvals','UPDATE'
  ) and not has_table_privilege(
    'service_role','public.agency_mcp_human_approvals','SELECT'
  ), 'El runtime puede saltarse las RPC y manipular la bandeja directamente.';
  assert not has_sequence_privilege(
    'service_role','public.agency_mcp_human_approvals_id_seq','USAGE'
  ), 'El runtime conserva acceso directo a la secuencia de aprobaciones.';
  assert has_table_privilege(
    'authenticated','public.agency_mcp_human_approvals','SELECT'
  ) and not has_table_privilege(
    'authenticated','public.agency_mcp_human_approvals','INSERT'
  ) and not has_table_privilege(
    'authenticated','public.agency_mcp_human_approvals','UPDATE'
  ), 'La bandeja humana perdió lectura RLS o permite alterar decisiones directamente.';
  assert not has_function_privilege(
    'service_role','public._mcp_human_job_fingerprint(bigint)','EXECUTE'
  ) and not has_function_privilege(
    'authenticated','public._mcp_human_text_safe(text,integer,integer)','EXECUTE'
  ), 'Un helper privado de huellas o saneamiento quedó expuesto.';

  assert position(
    'mcp_aprobaciones_humanas_disponible'
    in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure)
  )>0, 'El manifiesto de Data Sync no anuncia la aprobación humana MCP.';
end $$;

-- Datos sintéticos sin identidad de cliente, direcciones, teléfonos, correos ni notas libres.
do $$
declare
  v_admin public.users%rowtype;
  v_staff public.users%rowtype;
  v_product text;
  v_creative text:='CRE-MCP-APPROVAL-'||pg_backend_pid()::text;
  v_asset bigint;
  v_job bigint;
  v_prompt text:='Animar el postre MOMOS con movimiento natural y conservar su forma exacta.';
  v_contract jsonb;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select * into v_staff from public.users
  where activo and auth_id is not null
    and not ('Administrador'=any(coalesce(roles,array[rol])))
  order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_admin.id is not null and v_staff.id is not null and v_product is not null,
    'Falta Administrador, usuario no administrador o producto activo para la prueba.';

  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,estado,notas)
  values(
    v_creative,'Preflight MCP adversarial','Instagram','Reel',v_product,'Idea',
    'Dato sintético; rollback total'
  );
  insert into public.brand_media_assets(
    name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,
    storage_path,content_hash,mime_type,size_bytes,tags,created_by
  ) values(
    'Referencia MCP sintética','Foto','MOMOS',v_product,'Max','Oreo','Producto','Vertical',
    false,'Propio',true,'["Instagram"]','Activo',
    'test/mcp-approval-'||v_suffix||'.png',
    md5('mcp-approval-a-'||v_suffix)||md5('mcp-approval-b-'||v_suffix),
    'image/png',2048,'["momos:producto","prueba"]',v_admin.id
  ) returning id into v_asset;
  insert into public.creative_generation_jobs(
    creative_id,provider,operation,status,input_asset_ids,target_channel,target_format,
    prompt,negative_prompt,output_spec,created_by
  ) values(
    v_creative,'Higgsfield','Generar video','Preparado',jsonb_build_array(v_asset),
    'Instagram','Reel 9:16',v_prompt,'Evitar deformaciones del producto','{}'::jsonb,v_admin.id
  ) returning id into v_job;

  v_contract:=jsonb_build_object(
    'schema_version','momos-human-approval-contract/v1',
    'provider','Higgsfield',
    'surface','Higgsfield MCP',
    'model','Seedance 2.0 Fast',
    'workflow','Image to video',
    'objective','Crear un clip breve que preserve producto, marca y antojo.',
    'duration_seconds',5,
    'aspect_ratio','9:16',
    'target_channel','Instagram',
    'target_format','Reel 9:16',
    'resolution','1080p',
    'audio',false,
    'outputs',1,
    'references',jsonb_build_array(jsonb_build_object(
      'asset_id',v_asset,
      'asset_fingerprint',public._mcp_brand_asset_fingerprint(v_asset),
      'role','Producto'
    )),
    'lens','50 mm',
    'camera_movement','Dolly in lento con micro movimiento físico y estable.',
    'lighting','Luz lateral suave con sombra natural y fondo ligeramente oscuro.',
    'prompt',v_prompt,
    'prompt_version','v1',
    'prompt_fingerprint',md5(v_prompt),
    'estimated_credits',20,
    'max_cost_cop',30000,
    'balance_credits',100,
    'risks',jsonb_build_array('Deformación del producto','Movimiento de cámara artificial'),
    'acceptance_criteria',jsonb_build_array(
      'El producto conserva forma y proporción','La marca permanece legible'
    ),
    'generation_allowed',false,
    'external_execution',false
  );

  perform set_config('momos.mcp62_admin_auth',v_admin.auth_id::text,true);
  perform set_config('momos.mcp62_staff_auth',v_staff.auth_id::text,true);
  perform set_config('momos.mcp62_admin_id',v_admin.id,true);
  perform set_config('momos.mcp62_asset',v_asset::text,true);
  perform set_config('momos.mcp62_job',v_job::text,true);
  perform set_config('momos.mcp62_contract',v_contract::text,true);
  perform set_config('momos.mcp62_request_key','mcp62-request-'||v_suffix,true);
end $$;

-- El runtime puede solicitar y consultar, pero no escribir ni decidir.
set local role service_role;
do $$
declare
  v_contract jsonb:=current_setting('momos.mcp62_contract')::jsonb;
  v_key text:=current_setting('momos.mcp62_request_key');
  v_request jsonb;
  v_repeat jsonb;
  v_query jsonb;
  v_failed boolean:=false;
begin
  v_request:=public.momos_solicitar_aprobacion_humana(jsonb_build_object(
    'request_key',v_key,
    'worker_id','mcp62-worker',
    'job_id',current_setting('momos.mcp62_job')::bigint,
    'title','Aprobar clip de producto MOMOS',
    'expires_in_hours',24,
    'contract',v_contract
  ));
  assert v_request->>'schema_version'='momos-human-approval-status/v1'
    and v_request->>'status'='Pendiente'
    and (v_request->>'requires_human_approval')::boolean
    and not (v_request->>'generation_authorized')::boolean
    and not (v_request->>'external_execution_allowed')::boolean
    and not (v_request->>'duplicate')::boolean,
    'Solicitar convirtió el preflight en ejecución o perdió su contrato seguro.';
  perform set_config('momos.mcp62_approval',v_request->>'approval_id',true);
  perform set_config('momos.mcp62_fingerprint',v_request->>'contract_fingerprint',true);

  v_repeat:=public.momos_solicitar_aprobacion_humana(jsonb_build_object(
    'request_key',v_key,
    'worker_id','mcp62-worker',
    'job_id',current_setting('momos.mcp62_job')::bigint,
    'title','Aprobar clip de producto MOMOS',
    'expires_in_hours',24,
    'contract',v_contract
  ));
  assert (v_repeat->>'duplicate')::boolean
    and v_repeat->>'approval_id'=v_request->>'approval_id'
    and v_repeat->>'contract_fingerprint'=v_request->>'contract_fingerprint',
    'El reintento idempotente creó otra solicitud o cambió su huella.';

  v_query:=public.momos_consultar_aprobacion_humana(
    (v_request->>'approval_id')::bigint,v_request->>'contract_fingerprint'
  );
  assert v_query->>'status'='Pendiente'
    and (v_query->>'requires_human_approval')::boolean
    and not (v_query->>'generation_authorized')::boolean
    and coalesce(v_query->>'decision_summary','')='',
    'Consultar una solicitud pendiente inventó decisión o autorización.';

  v_failed:=false;
  begin
    perform public.momos_consultar_aprobacion_humana(
      (v_request->>'approval_id')::bigint,md5('preflight-ajeno')
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'La consulta aceptó una huella de preflight ajena.';

  v_failed:=false;
  begin
    perform public.momos_solicitar_aprobacion_humana(jsonb_build_object(
      'request_key',v_key,
      'worker_id','mcp62-worker',
      'job_id',current_setting('momos.mcp62_job')::bigint,
      'title','Aprobar clip de producto MOMOS',
      'expires_in_hours',24,
      'contract',jsonb_set(v_contract,'{max_cost_cop}','30001'::jsonb)
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'La misma request_key aceptó un tope divergente.';

  v_failed:=false;
  begin
    perform public.momos_solicitar_aprobacion_humana(jsonb_build_object(
      'request_key','mcp62-auto-'||pg_backend_pid(),
      'worker_id','mcp62-worker',
      'job_id',current_setting('momos.mcp62_job')::bigint,
      'title','Intento de auto aprobación',
      'expires_in_hours',24,
      'contract',jsonb_set(v_contract,'{generation_allowed}','true'::jsonb)
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'El MCP declaró generación permitida antes de decisión humana.';

  v_failed:=false;
  begin
    perform public.momos_solicitar_aprobacion_humana(jsonb_build_object(
      'request_key','mcp62-stale-'||pg_backend_pid(),
      'worker_id','mcp62-worker',
      'job_id',current_setting('momos.mcp62_job')::bigint,
      'title','Referencia con huella incorrecta',
      'expires_in_hours',24,
      'contract',jsonb_set(
        v_contract,'{references,0,asset_fingerprint}',to_jsonb(md5('referencia-anterior'))
      )
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'El preflight aceptó una referencia cuya huella ya no coincide.';

  v_failed:=false;
  begin
    perform public.momos_solicitar_aprobacion_humana(jsonb_build_object(
      'request_key','mcp62-channel-'||pg_backend_pid(),
      'worker_id','mcp62-worker',
      'job_id',current_setting('momos.mcp62_job')::bigint,
      'title','Canal divergente del trabajo',
      'expires_in_hours',24,
      'contract',jsonb_set(v_contract,'{target_channel}',to_jsonb('TikTok'::text))
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'El preflight no comparó canal, formato y prompt con el trabajo real.';

  v_failed:=false;
  begin
    perform public.resolver_aprobacion_humana_mcp(
      (v_request->>'approval_id')::bigint,'Aprobar','Decisión simulada',
      v_request->>'contract_fingerprint'
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'El runtime service_role pudo autoaprobar el trabajo.';

  v_failed:=false;
  begin
    insert into public.agency_mcp_human_approvals(
      request_key,worker_id,job_id,title,approval_contract,
      contract_fingerprint,job_fingerprint,expires_at
    ) values(
      'mcp62-direct-'||pg_backend_pid(),'mcp62-worker',
      current_setting('momos.mcp62_job')::bigint,'Inserción directa bloqueada',
      v_contract,md5(v_contract::text),md5('trabajo'),now()+interval '1 hour'
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'El runtime insertó una decisión fuera de las RPC.';
end $$;
reset role;

-- Un rol operativo puede ver solo lo que permita RLS, pero jamás resolver.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.mcp62_staff_auth'),'role','authenticated'
)::text,true);
set local role authenticated;
do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.resolver_aprobacion_humana_mcp(
      current_setting('momos.mcp62_approval')::bigint,'Aprobar',
      'Intento de rol operativo',current_setting('momos.mcp62_fingerprint')
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un usuario no administrador resolvió la aprobación MCP.';
end $$;
reset role;

-- Administración tampoco puede saltarse la bandeja usando el botón legado.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.mcp62_admin_auth'),'role','authenticated'
)::text,true);
set local role authenticated;
do $$
declare v_result jsonb; v_failed boolean:=false;
begin
  begin
    perform public.resolver_aprobacion_humana_mcp(
      current_setting('momos.mcp62_approval')::bigint,'Aprobar',
      'Huella deliberadamente incorrecta',md5('preflight-ajeno')
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'Administración resolvió una huella distinta al preflight mostrado.';

  v_failed:=false;
  begin
    perform public.autorizar_trabajo_creativo(
      current_setting('momos.mcp62_job')::bigint,30000
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'El botón legado saltó una aprobación MCP pendiente.';

  v_result:=public.resolver_aprobacion_humana_mcp(
    current_setting('momos.mcp62_approval')::bigint,'Aprobar',
    'Producto, referencias y tope verificados',current_setting('momos.mcp62_fingerprint')
  );
  assert v_result->>'status'='Aprobada'
    and v_result->>'job_status'='Autorizado'
    and (v_result->>'generation_authorized')::boolean
    and not (v_result->>'external_execution')::boolean,
    'La decisión humana no selló el trabajo sin ejecutar externamente.';

  v_failed:=false;
  begin
    perform public.resolver_aprobacion_humana_mcp(
      current_setting('momos.mcp62_approval')::bigint,'Rechazar',
      'Segundo intento de decisión',current_setting('momos.mcp62_fingerprint')
    );
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una aprobación ya resuelta aceptó una segunda decisión.';
end $$;
reset role;

-- La consulta privada refleja la decisión humana exacta, sin ejecutar nada.
set local role service_role;
do $$
declare v_status jsonb;
begin
  v_status:=public.momos_consultar_aprobacion_humana(
    current_setting('momos.mcp62_approval')::bigint,
    current_setting('momos.mcp62_fingerprint')
  );
  assert v_status->>'status'='Aprobada'
    and (v_status->>'generation_authorized')::boolean
    and not (v_status->>'requires_human_approval')::boolean
    and not (v_status->>'external_execution_allowed')::boolean
    and v_status->>'decision_summary'='Producto, referencias y tope verificados',
    'La consulta final perdió la decisión humana o amplió ejecución externa.';
end $$;
reset role;

do $$
declare
  v_job bigint:=current_setting('momos.mcp62_job')::bigint;
  v_approval bigint:=current_setting('momos.mcp62_approval')::bigint;
begin
  assert exists(
    select 1 from public.creative_generation_jobs
    where id=v_job and status='Autorizado' and max_cost_cop=30000
      and authorized_by=current_setting('momos.mcp62_admin_id')
      and authorized_at is not null and provider_job_id is null
  ), 'La autorización no conservó el tope exacto o inició trabajo externo.';
  assert exists(
    select 1 from public.agency_mcp_human_approvals
    where id=v_approval and status='Aprobada'
      and decided_by=current_setting('momos.mcp62_admin_id')
      and decision_note='Producto, referencias y tope verificados'
      and approval_contract->>'max_cost_cop'='30000'
      and approval_contract->>'generation_allowed'='false'
      and approval_contract->>'external_execution'='false'
  ), 'La bandeja no conservó actor, nota o preflight inmutable.';
  assert exists(
    select 1 from public.audit_logs
    where entidad='Aprobaciones MCP' and entidad_id=v_approval::text
      and accion='Preflight solicitado'
  ), 'Falta auditoría de la solicitud MCP.';
  assert exists(
    select 1 from public.audit_logs
    where entidad='Aprobaciones MCP' and entidad_id=v_approval::text
      and accion='Preflight aprobada'
  ), 'Falta auditoría de la decisión humana.';
end $$;

select 'TESTS_OK — MCP solicitud/consulta/preflight exacto/RBAC/anti-autoaprobación/tope PASS, rollback total' as resultado;
rollback;
