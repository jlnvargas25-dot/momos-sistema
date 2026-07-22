-- MOMOS OPS · H88 Snapshots aislados por rol.
--
-- Esta migración es deliberadamente compatible: instala primero los contratos
-- seguros que consumirá el frontend. El cierre de SELECT directo sobre tablas
-- con PII se realizará en H89, después de comprobar este contrato en producción.
begin;

set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_87_formulas_elaboraciones'
  ) then
    raise exception 'Falta el paso 87_formulas_elaboraciones.';
  end if;
  if to_regprocedure('public.current_roles()') is null
     or to_regprocedure('public.momos_core_snapshot_v2()') is null
     or to_regprocedure('public.momos_operational_snapshot_v1()') is null then
    raise exception 'Faltan los contratos base de roles o Data Sync.';
  end if;
end $$;

-- Proyecta una colección JSON conservando orden y únicamente las claves
-- declaradas. Es privada: un cliente no puede usarla como extractor genérico.
create or replace function public._momos_project_jsonb_rows(
  p_rows jsonb,
  p_keys text[]
) returns jsonb
language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp
as $$
  select coalesce(
    jsonb_agg(
      coalesce((
        select jsonb_object_agg(pair.key,pair.value)
        from jsonb_each(row_value.value) pair
        where pair.key=any(coalesce(p_keys,array[]::text[]))
      ),'{}'::jsonb)
      order by row_value.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(coalesce(p_rows,'[]'::jsonb))='array'
      then coalesce(p_rows,'[]'::jsonb) else '[]'::jsonb end
  ) with ordinality row_value(value,ordinality)
$$;
revoke all on function public._momos_project_jsonb_rows(jsonb,text[])
  from public,anon,authenticated,service_role;

-- Catálogos v3: los datos de producto siguen siendo compartidos por operación,
-- pero el directorio del equipo deja de transportar correos a cualquier rol.
-- Administración conserva el contrato completo para gestionar usuarios.
create or replace function public.momos_core_snapshot_v3()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
set row_security=off
as $$
declare
  v_roles text[]:=coalesce(public.current_roles(),array[]::text[]);
  v_base jsonb;
begin
  if auth.uid() is null or cardinality(v_roles)=0 then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;

  v_base:=public.momos_core_snapshot_v2();
  if 'Administrador'=any(v_roles) then
    return jsonb_set(v_base,'{version}','3'::jsonb,true)
      ||jsonb_build_object(
        'role_scope',to_jsonb(v_roles),
        'privacy',jsonb_build_object(
          'contains_staff_email',true,'contains_customer_pii',false,
          'contains_secrets',false,'external_execution',false
        )
      );
  end if;

  return jsonb_set(
      jsonb_set(v_base,'{version}','3'::jsonb,true),
      '{users}',
      public._momos_project_jsonb_rows(
        v_base->'users',array['id','nombre','rol','roles','activo']::text[]
      ),true
    )||jsonb_build_object(
      'role_scope',to_jsonb(v_roles),
      'privacy',jsonb_build_object(
        'contains_staff_email',false,'contains_customer_pii',false,
        'contains_secrets',false,'external_execution',false
      )
    );
end;
$$;
revoke all on function public.momos_core_snapshot_v3()
  from public,anon,service_role;
grant execute on function public.momos_core_snapshot_v3() to authenticated;

-- Operación v2: parte del snapshot relacional canónico y aplica una proyección
-- por la unión de roles del usuario. No modifica filas, no firma archivos y no
-- habilita ejecución externa.
create or replace function public.momos_operational_snapshot_v2()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
set row_security=off
as $$
declare
  v_roles text[]:=coalesce(public.current_roles(),array[]::text[]);
  v_base jsonb;
  v_result jsonb;
  v_admin boolean;
  v_sales boolean;
  v_kitchen boolean;
  v_packing boolean;
  v_logistics boolean;
  v_crm boolean;
  v_customer_keys text[]:=array['id','nombre']::text[];
  v_order_keys text[]:=array['id','fecha','hora','canal','customer_id','estado']::text[];
  v_item_keys text[]:=array[
    'id','order_id','product_id','nombre','sabor','salsa','relleno','figura',
    'cant','es_caja','parent_item_id','caja_num','es_sub_momo'
  ]::text[];
  v_addition_keys text[]:=array['id','order_item_id','nombre','cant']::text[];
begin
  if auth.uid() is null or cardinality(v_roles)=0 then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;

  v_admin:='Administrador'=any(v_roles);
  v_sales:=v_roles && array['Cajero','Coordinador de pedidos']::text[];
  v_kitchen:='Cocina'=any(v_roles);
  v_packing:='Empaque'=any(v_roles);
  v_logistics:=v_roles && array['Logística','Mensajero']::text[];
  v_crm:='Marketing/CRM'=any(v_roles);
  v_base:=public.momos_operational_snapshot_v1();

  if v_admin then
    return jsonb_set(v_base,'{version}','2'::jsonb,true)
      ||jsonb_build_object(
        'role_scope',to_jsonb(v_roles),
        'privacy',jsonb_build_object(
          'contains_customer_pii',true,'contains_staff_identity',true,
          'contains_storage_references',true,'contains_secrets',false,
          'external_execution',false
        )
      );
  end if;

  if v_sales then
    v_customer_keys:=v_customer_keys||array[
      'telefono','instagram','barrio','direccion','canal','primera','ultima',
      'total','pedidos','estado'
    ]::text[];
    v_order_keys:=v_order_keys||array[
      'barrio','direccion','zona','dom_cobrado','dom_costo','descuento',
      'benefit_id','pago','comprobante','obs','pagado_en'
    ]::text[];
    v_item_keys:=v_item_keys||array['precio','costo_unitario']::text[];
    v_addition_keys:=v_addition_keys||array['precio','insumo_id','insumo_cant']::text[];
  end if;

  if v_kitchen then
    v_order_keys:=v_order_keys||array['obs','pagado_en']::text[];
    v_addition_keys:=v_addition_keys||array['insumo_id','insumo_cant']::text[];
  end if;

  if v_packing then
    v_customer_keys:=v_customer_keys||array['telefono','barrio','direccion']::text[];
    v_order_keys:=v_order_keys||array[
      'barrio','direccion','zona','dom_cobrado','pago','obs','pagado_en'
    ]::text[];
  end if;

  if v_logistics then
    v_customer_keys:=v_customer_keys||array['telefono','barrio','direccion']::text[];
    v_order_keys:=v_order_keys||array[
      'barrio','direccion','zona','dom_cobrado','estado','obs','pagado_en'
    ]::text[];
  end if;

  if v_crm then
    v_customer_keys:=v_customer_keys||array[
      'telefono','instagram','barrio','canal','primera','ultima','total','pedidos',
      'cumple','favoritos','estado','notas'
    ]::text[];
    v_order_keys:=v_order_keys||array[
      'barrio','descuento','benefit_id','estado','pagado_en','campaign_id',
      'creative_id','origen_detalle'
    ]::text[];
    v_item_keys:=v_item_keys||array['precio']::text[];
    v_addition_keys:=v_addition_keys||array['precio']::text[];
  end if;

  v_result:=jsonb_set(v_base,'{version}','2'::jsonb,true);
  v_result:=jsonb_set(v_result,'{customers}',
    public._momos_project_jsonb_rows(v_base->'customers',v_customer_keys),true);
  v_result:=jsonb_set(v_result,'{orders}',
    public._momos_project_jsonb_rows(v_base->'orders',v_order_keys),true);
  v_result:=jsonb_set(v_result,'{order_items}',
    public._momos_project_jsonb_rows(v_base->'order_items',v_item_keys),true);
  v_result:=jsonb_set(v_result,'{order_item_adiciones}',
    public._momos_project_jsonb_rows(v_base->'order_item_adiciones',v_addition_keys),true);

  if not (v_sales or v_packing or v_logistics) then
    v_result:=jsonb_set(v_result,'{deliveries}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{evidences}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{packing_verifications}','[]'::jsonb,true);
  end if;
  if not (v_sales or v_crm or v_packing or v_logistics) then
    v_result:=jsonb_set(v_result,'{claims}','[]'::jsonb,true);
  end if;
  if not (v_sales or v_crm) then
    v_result:=jsonb_set(v_result,'{benefits}','[]'::jsonb,true);
  end if;
  if not (v_kitchen or v_sales or v_packing or v_logistics) then
    v_result:=jsonb_set(v_result,'{inventory_reservations}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{production_suggestions}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{production_batches}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{lote_figuras}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{subreceta_producciones}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{variantes}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{variantes_cuarentena}','[]'::jsonb,true);
  end if;
  if not v_kitchen then
    v_result:=jsonb_set(v_result,'{inventory_movements}','[]'::jsonb,true);
  end if;
  if not (v_sales or v_kitchen or v_packing or v_logistics) then
    v_result:=jsonb_set(v_result,'{order_stage_assignments}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{order_line_progress}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{order_incidents}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{order_dispatch_handoffs}','[]'::jsonb,true);
  end if;
  if not (v_sales or 'Coordinador de pedidos'=any(v_roles)) then
    v_result:=jsonb_set(v_result,'{audit_logs}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{history_cursor}','null'::jsonb,true);
  end if;
  if not v_crm then
    v_result:=jsonb_set(v_result,'{customer_crm_profiles}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{customer_contacts}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{customer_activations}','[]'::jsonb,true);
  end if;

  return v_result||jsonb_build_object(
    'role_scope',to_jsonb(v_roles),
    'privacy',jsonb_build_object(
      'contains_customer_pii',(v_sales or v_packing or v_logistics or v_crm),
      'contains_staff_identity',true,
      'contains_storage_references',(v_sales or v_packing or v_logistics),
      'contains_secrets',false,'external_execution',false
    )
  );
end;
$$;
revoke all on function public.momos_operational_snapshot_v2()
  from public,anon,service_role;
grant execute on function public.momos_operational_snapshot_v2() to authenticated;

create or replace function public.aislamiento_snapshots_rol_disponible()
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select cardinality(coalesce(public.current_roles(),array[]::text[]))>0
    and exists(select 1 from public.momos_ops_migrations
      where id='20260720_88_aislamiento_snapshots_rol')
    and to_regprocedure('public.momos_core_snapshot_v3()') is not null
    and to_regprocedure('public.momos_operational_snapshot_v2()') is not null
$$;
revoke all on function public.aislamiento_snapshots_rol_disponible()
  from public,anon,service_role;
grant execute on function public.aislamiento_snapshots_rol_disponible() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260720_88_aislamiento_snapshots_rol',
  'Snapshots de catálogos y operación proyectados por unión de roles, sin secretos ni ejecución externa'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
