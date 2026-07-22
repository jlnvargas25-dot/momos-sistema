-- MOMOS OPS · prueba adversarial H88. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260720_88_aislamiento_snapshots_rol'),'falta H88';
  assert to_regprocedure('public.momos_core_snapshot_v3()') is not null
    and to_regprocedure('public.momos_operational_snapshot_v2()') is not null
    and to_regprocedure('public.aislamiento_snapshots_rol_disponible()') is not null,
    'faltan contratos H88';
  assert has_function_privilege('authenticated','public.momos_core_snapshot_v3()','EXECUTE')
    and has_function_privilege('authenticated','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_operational_snapshot_v2()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_project_jsonb_rows(jsonb,text[])','EXECUTE'),
    'H88 perdió la frontera pública/privada';
end $$;

create temporary table h88_context(
  admin_id text not null,
  auth_id uuid not null,
  kitchen_id text not null,
  crm_id text not null
) on commit drop;

do $$
declare
  v_admin public.users%rowtype;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null and 'Administrador'=any(roles)
  order by id limit 1;
  assert v_admin.id is not null,'H88 necesita un Administrador autenticado';

  insert into public.users(id,nombre,email,rol,roles,activo)
  values
    ('H88-C-'||v_suffix,'Cocina H88','h88-c-'||v_suffix||'@momos.test','Cocina',array['Cocina']::text[],true),
    ('H88-M-'||v_suffix,'CRM H88','h88-m-'||v_suffix||'@momos.test','Marketing/CRM',array['Marketing/CRM']::text[],true);
  insert into h88_context values(
    v_admin.id,v_admin.auth_id,'H88-C-'||v_suffix,'H88-M-'||v_suffix
  );
end $$;

grant select on table h88_context to authenticated;

-- Cocina presta la identidad real durante la transacción y no recibe PII de
-- clientes, pago, Storage, CRM ni historial administrativo.
do $$
declare v_admin text; v_auth uuid; v_kitchen text;
begin
  select admin_id,auth_id,kitchen_id into v_admin,v_auth,v_kitchen from h88_context;
  update public.users set auth_id=null where id=v_admin;
  update public.users set auth_id=v_auth where id=v_kitchen;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h88_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_op jsonb; v_core jsonb;
begin
  assert public.aislamiento_snapshots_rol_disponible(),'H88 no se anunció a Cocina';
  v_op:=public.momos_operational_snapshot_v2();
  v_core:=public.momos_core_snapshot_v3();

  assert (v_op->>'version')::integer=2 and (v_core->>'version')::integer=3,
    'H88 devolvió una versión incorrecta';
  assert v_op->'role_scope'=jsonb_build_array('Cocina')
    and v_core->'role_scope'=jsonb_build_array('Cocina'),
    'H88 mezcló el rol de otra sesión';
  assert not exists(select 1 from jsonb_array_elements(v_op->'customers') x
    where x ?| array['telefono','instagram','barrio','direccion','cumple','favoritos','notas']),
    'Cocina recibió PII o perfil CRM de clientes';
  assert not exists(select 1 from jsonb_array_elements(v_op->'orders') x
    where x ?| array['direccion','zona','pago','comprobante','campaign_id','creative_id','origen_detalle']),
    'Cocina recibió dirección, pago o atribución comercial';
  assert not exists(select 1 from jsonb_array_elements(v_op->'order_items') x
    where x ?| array['precio','costo_unitario']),
    'Cocina recibió precios o costos unitarios';
  assert jsonb_array_length(v_op->'deliveries')=0
    and jsonb_array_length(v_op->'evidences')=0
    and jsonb_array_length(v_op->'benefits')=0
    and jsonb_array_length(v_op->'claims')=0
    and jsonb_array_length(v_op->'audit_logs')=0
    and jsonb_array_length(v_op->'customer_crm_profiles')=0
    and jsonb_array_length(v_op->'customer_contacts')=0
    and jsonb_array_length(v_op->'customer_activations')=0,
    'Cocina recibió dominios ajenos';
  assert not exists(select 1 from jsonb_array_elements(v_core->'users') x where x ? 'email'),
    'el catálogo de Cocina expuso correos del equipo';
  assert coalesce((v_op#>>'{privacy,contains_customer_pii}')::boolean,true)=false
    and coalesce((v_op#>>'{privacy,contains_secrets}')::boolean,true)=false
    and coalesce((v_op#>>'{privacy,external_execution}')::boolean,true)=false,
    'H88 declaró mal la privacidad de Cocina';
end $$;

reset role;

-- Marketing/CRM recibe contacto y perfil comercial, pero no la dirección
-- exacta, comprobantes, evidencias o ejecución externa.
do $$
declare v_auth uuid; v_kitchen text; v_crm text;
begin
  select auth_id,kitchen_id,crm_id into v_auth,v_kitchen,v_crm from h88_context;
  update public.users set auth_id=null where id=v_kitchen;
  update public.users set auth_id=v_auth where id=v_crm;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h88_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_op jsonb; v_core jsonb;
begin
  v_op:=public.momos_operational_snapshot_v2();
  v_core:=public.momos_core_snapshot_v3();
  assert v_op->'role_scope'=jsonb_build_array('Marketing/CRM'),'H88 no aisló CRM';
  assert not exists(select 1 from jsonb_array_elements(v_op->'customers') x where x ? 'direccion'),
    'CRM recibió dirección exacta';
  assert not exists(select 1 from jsonb_array_elements(v_op->'orders') x
    where x ?| array['direccion','zona','pago','comprobante','dom_costo']),
    'CRM recibió logística, pago o comprobante';
  assert jsonb_array_length(v_op->'deliveries')=0
    and jsonb_array_length(v_op->'evidences')=0
    and jsonb_array_length(v_op->'inventory_movements')=0,
    'CRM recibió Storage, domicilios o kardex';
  assert not exists(select 1 from jsonb_array_elements(v_core->'users') x where x ? 'email'),
    'el catálogo CRM expuso correos del equipo';
  assert coalesce((v_op#>>'{privacy,contains_customer_pii}')::boolean,false)
    and not coalesce((v_op#>>'{privacy,contains_storage_references}')::boolean,true),
    'H88 declaró mal la privacidad CRM';
  assert v_op::text !~* 'api[_-]?key|secret[_-]?key|service[_-]?role|bearer[[:space:]]',
    'H88 expuso un secreto';
end $$;

reset role;

-- Administración conserva el contrato completo necesario para gestionar el
-- equipo; se restaura la identidad original antes de comprobarlo.
do $$
declare v_admin text; v_auth uuid; v_crm text;
begin
  select admin_id,auth_id,crm_id into v_admin,v_auth,v_crm from h88_context;
  update public.users set auth_id=null where id=v_crm;
  update public.users set auth_id=v_auth where id=v_admin;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h88_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_op jsonb; v_core jsonb;
begin
  v_op:=public.momos_operational_snapshot_v2();
  v_core:=public.momos_core_snapshot_v3();
  assert 'Administrador'=any(array(select jsonb_array_elements_text(v_op->'role_scope'))),
    'H88 no restauró Administración';
  assert exists(select 1 from jsonb_array_elements(v_core->'users') x where x ? 'email'),
    'Administración perdió el correo necesario para gestionar usuarios';
  assert coalesce((v_op#>>'{privacy,contains_customer_pii}')::boolean,false)
    and coalesce((v_core#>>'{privacy,contains_staff_email}')::boolean,false),
    'H88 ocultó el alcance administrativo en su contrato';
end $$;

reset role;

select 'TESTS_OK — snapshots por rol/PII/contrato/compatibilidad/RBAC PASS, rollback total' as resultado;
rollback;
