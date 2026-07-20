-- MOMOS OPS · prueba adversarial H75 Finanzas operativas. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_finanzas_operativas_20260719'));

do $$
declare v_admin_auth uuid; v_staff_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_75_finanzas_operativas'),
    'Falta aplicar H75.';
  assert to_regclass('public.finance_sync_state') is not null
    and to_regclass('public.finance_delta_receipts') is not null
    and to_regprocedure('public.momos_finance_snapshot_v1(date,date)') is not null
    and to_regprocedure('public.actualizar_pauta_financiera_v1(jsonb)') is not null,
    'Falta una pieza del contrato H75.';
  assert has_function_privilege('authenticated','public.momos_finance_snapshot_v1(date,date)','EXECUTE')
    and has_function_privilege('authenticated','public.actualizar_pauta_financiera_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_finance_snapshot_v1(date,date)','EXECUTE')
    and not has_function_privilege('service_role','public.actualizar_pauta_financiera_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._touch_finance_sync_state()','EXECUTE'),
    'H75 abrió la frontera RBAC de sus funciones.';
  assert has_table_privilege('authenticated','public.finance_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.finance_sync_state','INSERT')
    and not has_table_privilege('authenticated','public.finance_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.finance_delta_receipts','SELECT')
    and not has_table_privilege('service_role','public.finance_delta_receipts','SELECT'),
    'H75 expuso escritura del outbox o los recibos privados.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.finance_sync_state'::regclass
      and a.attnum>0 and not a.attisdropped)=array['id','version','changed_at'],
    'El outbox financiero expuso detalle, actor o PII.';
  assert (select count(*) from pg_trigger t
    where not t.tgisinternal and t.tgname like 'trg_h75_finance_%')=10,
    'H75 no cubre las diez fuentes financieras autoritativas.';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='finance_sync_state'),
      'Realtime no incluye el outbox compacto de Finanzas.';
  end if;
  assert position('finanzas_operativas_disponibles' in pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure))>0,
    'El manifiesto de Data Sync no anuncia H75.';

  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  select u.auth_id into v_staff_auth from public.users u
  where u.activo and u.auth_id is not null
    and not ('Administrador'=any(coalesce(u.roles,array[u.rol])))
  order by u.id limit 1;
  assert v_admin_auth is not null and v_staff_auth is not null,
    'Falta Administrador y staff no Administrador para H75.';
  perform set_config('momos.h75_admin_auth',v_admin_auth::text,true);
  perform set_config('momos.h75_staff_auth',v_staff_auth::text,true);
end $$;

-- Un staff autenticado no puede leer ni mutar Finanzas.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h75_staff_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_finance_snapshot_v1(current_date-30,current_date);
  exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed,'Un usuario no Administrador pudo leer Finanzas.';
  v_failed:=false;
  begin perform public.actualizar_pauta_financiera_v1(jsonb_build_object(
    'idempotency_key','75000000-0000-4000-8000-000000000099',
    'monthly_budget',1,'from',current_date-30,'to',current_date));
  exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed,'Un usuario no Administrador pudo actualizar pauta.';
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h75_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_snapshot jsonb; v_facts jsonb; v_first jsonb; v_repeat jsonb;
  v_before bigint; v_after bigint; v_confirmed integer; v_gross numeric;
  v_key text:='75000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0');
  v_failed boolean:=false;
begin
  assert public.finanzas_operativas_disponibles(),
    'La capability H75 no quedó cerrada por migración y Administrador.';
  v_snapshot:=public.momos_finance_snapshot_v1(current_date-30,current_date);
  v_facts:=public.momos_financial_facts_v1(current_date-30,current_date);

  assert (select array_agg(k order by k) from jsonb_object_keys(v_snapshot) keys(k))=
    array['containsFreeText','containsPii','containsSecrets','containsStorageReferences',
      'contract','externalExecution','payments','range','serverTime','snapshotVersion','summary','version'],
    'El snapshot H75 expuso una colección o clave fuera del contrato compacto.';
  assert v_snapshot->>'contract'='momos.finance-snapshot.v1'
    and (v_snapshot->>'version')::integer=1
    and (v_snapshot->>'snapshotVersion')::bigint>0
    and coalesce((v_snapshot->>'containsPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsFreeText')::boolean,true)=false
    and coalesce((v_snapshot->>'containsStorageReferences')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'externalExecution')::boolean,true)=false,
    'H75 no selló versión, privacidad o no ejecución.';

  select count(*) filter(where (x->>'payment_confirmed')::boolean),
    coalesce(sum((x->>'total_charged')::numeric)
      filter(where (x->>'payment_confirmed')::boolean),0)
  into v_confirmed,v_gross from jsonb_array_elements(v_facts->'orders') x;
  assert (v_snapshot#>>'{summary,ordersReviewed}')::integer=jsonb_array_length(v_facts->'orders')
    and (v_snapshot#>>'{summary,confirmedPaymentOrders}')::integer=v_confirmed
    and (v_snapshot#>>'{summary,grossCollected}')::numeric=v_gross
    and (select coalesce(sum((p->>'orders')::integer),0)
      from jsonb_array_elements(v_snapshot->'payments') p)=v_confirmed,
    'El agregado H75 no cuadra con los hechos financieros H65 del mismo rango.';
  assert v_snapshot::text !~* 'order_id|customer|telefono|direccion|nota|storage[_-]?path|signed[_-]?url|auth_id|service[_-]?role|access[_-]?token|refresh[_-]?token|https?://',
    'El snapshot H75 expuso pedido, PII, nota, ruta, identidad o secreto.';

  select version into v_before from public.finance_sync_state where id=1;
  v_first:=public.actualizar_pauta_financiera_v1(jsonb_build_object(
    'idempotency_key',v_key,'monthly_budget',321000,
    'from',current_date-30,'to',current_date));
  select version into v_after from public.finance_sync_state where id=1;
  assert v_after=v_before+1
    and v_first->>'contract'='momos.finance-mutation.v1'
    and (v_first->>'duplicate')::boolean=false
    and (v_first->>'monthlyBudget')::numeric=321000
    and (v_first#>>'{snapshot,summary,configuredMonthlyAdBudget}')::numeric=321000
    and (v_first#>>'{snapshot,snapshotVersion}')::bigint=v_after
    and coalesce((v_first->>'containsPii')::boolean,true)=false
    and coalesce((v_first->>'containsSecrets')::boolean,true)=false
    and coalesce((v_first->>'externalExecution')::boolean,true)=false,
    'Actualizar pauta no devolvió el resumen exacto del mismo commit.';

  v_repeat:=public.actualizar_pauta_financiera_v1(jsonb_build_object(
    'idempotency_key',v_key,'monthly_budget',321000,
    'from',current_date-30,'to',current_date));
  assert (v_repeat->>'duplicate')::boolean=true
    and v_repeat-'duplicate'=v_first-'duplicate'
    and (select version from public.finance_sync_state where id=1)=v_after,
    'El replay financiero repitió efectos o cambió el resultado.';

  begin perform public.actualizar_pauta_financiera_v1(jsonb_build_object(
    'idempotency_key',v_key,'monthly_budget',322000,
    'from',current_date-30,'to',current_date));
  exception when others then v_failed:=true; end;
  assert v_failed,'H75 aceptó reutilizar la llave con otro presupuesto.';
  v_failed:=false;
  begin perform public.actualizar_pauta_financiera_v1(jsonb_build_object(
    'idempotency_key','75000000-0000-4000-8000-000000000098',
    'monthly_budget',1,'from',current_date-30,'to',current_date,'secret','x'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H75 aceptó un campo fuera del contrato cerrado.';
end $$;

reset role;

-- Una configuración ajena a Finanzas no despierta el dominio.
do $$
declare v_before bigint; v_after bigint; v_key text:='h75-unrelated-'||pg_backend_pid();
begin
  select version into v_before from public.finance_sync_state where id=1;
  insert into public.app_settings(clave,valor) values(v_key,'true'::jsonb);
  select version into v_after from public.finance_sync_state where id=1;
  assert v_after=v_before,'Una configuración no financiera despertó Finanzas.';
  delete from public.app_settings where clave=v_key;
  assert (select version from public.finance_sync_state where id=1)=v_before,
    'Eliminar una configuración no financiera despertó Finanzas.';
end $$;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_finance_snapshot_v1(current_date-30,current_date);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar Finanzas.';
end $$;
reset role;

select 'TESTS_OK — Finanzas resumen/detalle/pauta/idempotencia/outbox/PII/RBAC PASS, rollback total' as resultado;
rollback;
