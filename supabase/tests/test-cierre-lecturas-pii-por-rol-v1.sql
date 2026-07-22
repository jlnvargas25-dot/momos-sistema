-- MOMOS OPS · prueba adversarial H89. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260720_89_cierre_lecturas_pii'),'Falta aplicar H89.';
  assert to_regprocedure('public.momos_current_user_profile_v1()') is not null
    and to_regprocedure('public.cierre_lecturas_pii_disponible()') is not null,
    'Faltan los contratos públicos H89.';
  assert has_function_privilege('authenticated','public.momos_current_user_profile_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.cierre_lecturas_pii_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.momos_current_user_profile_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_current_user_profile_v1()','EXECUTE'),
    'H89 perdió la frontera de ejecución.';
  assert not exists(
    select 1 from pg_catalog.pg_policies p
    where p.schemaname='public'
      and p.tablename=any(array[
        'users','customers','orders','order_items','order_item_adiciones',
        'deliveries','evidences','benefits','claims','audit_logs',
        'packing_verifications','order_stage_assignments','order_line_progress',
        'order_incidents','order_dispatch_handoffs','customer_crm_profiles',
        'customer_contacts','customer_activations'
      ]::text[])
      and (p.policyname='staff_read'
        or p.policyname='packing_verifications_staff_read'
        or p.policyname='claude_read')
  ),'H89 dejó una política de lectura amplia.';
  assert exists(select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='users'
      and policyname='own_profile_read' and cmd='SELECT'),
    'H89 no conservó la lectura del perfil propio.';
end $$;

create temporary table h89_context(
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
  where activo and auth_id is not null and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  assert v_admin.id is not null,'H89 necesita un Administrador autenticado.';
  insert into public.users(id,nombre,email,rol,roles,activo)
  values
    ('H89-C-'||v_suffix,'Cocina H89','h89-c-'||v_suffix||'@momos.test','Cocina',array['Cocina']::text[],true),
    ('H89-M-'||v_suffix,'CRM H89','h89-m-'||v_suffix||'@momos.test','Marketing/CRM',array['Marketing/CRM']::text[],true);
  insert into h89_context values(
    v_admin.id,v_admin.auth_id,'H89-C-'||v_suffix,'H89-M-'||v_suffix
  );
end $$;
grant select on table h89_context to authenticated;

-- Cocina no puede extraer ninguna tabla sensible, pero conserva su perfil y
-- la operación estrictamente proyectada por H88.
do $$
declare v_admin text; v_auth uuid; v_kitchen text;
begin
  select admin_id,auth_id,kitchen_id into v_admin,v_auth,v_kitchen from h89_context;
  update public.users set auth_id=null where id=v_admin;
  update public.users set auth_id=v_auth where id=v_kitchen;
end $$;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h89_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_profile jsonb; v_op jsonb; v_core jsonb;
begin
  assert public.cierre_lecturas_pii_disponible(),'H89 no se anunció a Cocina.';
  assert (select count(*) from public.users)=1,'Cocina leyó el directorio completo.';
  assert (select count(*) from public.customers)=0
    and (select count(*) from public.orders)=0
    and (select count(*) from public.order_items)=0
    and (select count(*) from public.deliveries)=0
    and (select count(*) from public.evidences)=0
    and (select count(*) from public.claims)=0,
    'Cocina pudo extraer tablas operativas sensibles.';
  v_profile:=public.momos_current_user_profile_v1();
  v_op:=public.momos_operational_snapshot_v2();
  v_core:=public.momos_core_snapshot_v3();
  assert v_profile->>'id' like 'H89-C-%'
    and v_profile->'roles'=jsonb_build_array('Cocina')
    and not (v_profile ?| array['email','auth_id']),
    'El perfil propio mezcló identidad ajena o datos prohibidos.';
  assert v_profile::text !~* 'service[_-]?role|access[_-]?token|refresh[_-]?token|bearer[[:space:]]'
    and coalesce((v_profile#>>'{privacy,own_profile_only}')::boolean,false),
    'El perfil propio perdió privacidad.';
  assert v_op->'role_scope'=jsonb_build_array('Cocina')
    and v_core->'role_scope'=jsonb_build_array('Cocina')
    and not exists(select 1 from jsonb_array_elements(v_op->'customers') x
      where x ?| array['telefono','direccion','instagram','cumple','notas']),
    'La ruta protegida de Cocina perdió su proyección H88.';
end $$;
reset role;

-- CRM tampoco lee tablas directas: recibe únicamente contacto comercial sin
-- dirección exacta mediante el snapshot protegido.
do $$
declare v_auth uuid; v_kitchen text; v_crm text;
begin
  select auth_id,kitchen_id,crm_id into v_auth,v_kitchen,v_crm from h89_context;
  update public.users set auth_id=null where id=v_kitchen;
  update public.users set auth_id=v_auth where id=v_crm;
end $$;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h89_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_op jsonb;
begin
  assert (select count(*) from public.customers)=0
    and (select count(*) from public.customer_contacts)=0
    and (select count(*) from public.customer_activations)=0,
    'CRM pudo saltarse el snapshot y leer tablas directas.';
  v_op:=public.momos_operational_snapshot_v2();
  assert v_op->'role_scope'=jsonb_build_array('Marketing/CRM')
    and not exists(select 1 from jsonb_array_elements(v_op->'customers') x where x ? 'direccion')
    and jsonb_array_length(v_op->'deliveries')=0
    and jsonb_array_length(v_op->'evidences')=0,
    'CRM recibió dirección exacta, logística o Storage.';
end $$;
reset role;

-- Administración conserva la lectura completa que ya estaba protegida por
-- admin_all y recupera su identidad original antes de comprobarla.
do $$
declare v_admin text; v_auth uuid; v_crm text;
begin
  select admin_id,auth_id,crm_id into v_admin,v_auth,v_crm from h89_context;
  update public.users set auth_id=null where id=v_crm;
  update public.users set auth_id=v_auth where id=v_admin;
end $$;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h89_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_profile jsonb; v_op jsonb;
begin
  assert (select count(*) from public.users)>1,'Administración perdió el directorio.';
  assert (select count(*) from public.customers)>0,'Administración perdió clientes.';
  v_profile:=public.momos_current_user_profile_v1();
  v_op:=public.momos_operational_snapshot_v2();
  assert v_profile->'roles' ? 'Administrador'
    and coalesce((v_op#>>'{privacy,contains_customer_pii}')::boolean,false),
    'Administración perdió su contrato operativo.';
end $$;
reset role;

select 'TESTS_OK — cierre PII/snapshots obligatorios/perfil propio/agente/RBAC PASS, rollback total' as resultado;
rollback;
