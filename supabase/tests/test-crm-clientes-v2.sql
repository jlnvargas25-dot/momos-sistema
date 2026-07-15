-- MOMOS OPS · prueba adversarial CRM clientes v2. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260714_15_crm_clientes'), 'Falta aplicar la migración 15.';
  assert to_regclass('public.customer_contacts') is not null, 'Falta bitácora de contactos.';
  assert to_regclass('public.customer_activations') is not null, 'Faltan activaciones.';
  assert not has_table_privilege('authenticated','public.customer_contacts','INSERT'), 'CRM permite INSERT directo.';
  assert not has_table_privilege('authenticated','public.customer_activations','UPDATE'), 'CRM permite UPDATE directo.';
  assert has_function_privilege('authenticated','public.registrar_contacto_cliente(jsonb)','EXECUTE'), 'Falta RPC de contactos.';
  assert not has_function_privilege('authenticated','public._crm_actor(text[])','EXECUTE'), 'Helper CRM expuesto.';
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_customer text; v_activation bigint; v_contact bigint; v_benefit text; v_failed boolean:=false; v_phone text:='300'||right('0000000'||pg_backend_pid()::text,7);
begin
  assert public.crm_clientes_disponible(), 'La sonda CRM no responde.';
  v_customer:=public.upsert_cliente(null,jsonb_build_object('nombre','CRM adversarial','telefono',v_phone,'canal','WhatsApp'));
  perform public.guardar_preferencias_cliente(v_customer,jsonb_build_object('contact_allowed',true,'preferred_channel','WhatsApp','acquisition_source','Referido'));
  assert exists(select 1 from public.customer_crm_profiles where customer_id=v_customer and acquisition_source='Referido'), 'No guardó preferencias.';

  v_activation:=(public.crear_activacion_cliente(jsonb_build_object('customer_id',v_customer,'type','Reactivación','title','Volver por su favorito','message','Hola, te extrañamos','expires_on',current_date+7))->>'activation_id')::bigint;
  v_contact:=(public.registrar_contacto_cliente(jsonb_build_object('customer_id',v_customer,'channel','WhatsApp','reason','Reactivación personalizada','outcome','Enviado','activation_id',v_activation))->>'contact_id')::bigint;
  assert exists(select 1 from public.customer_contacts where id=v_contact and customer_id=v_customer), 'No registró contacto.';
  assert (select status from public.customer_activations where id=v_activation)='Contactada', 'Contacto no avanzó activación.';

  v_benefit:=public.activar_beneficio_cliente(jsonb_build_object('customer_id',v_customer,'tipo_beneficio','descuento_porcentaje','valor',15,'condicion','CRM test','minimo',30000,'vence',current_date+5))->>'benefit_id';
  assert exists(select 1 from public.benefits where id=v_benefit and customer_id=v_customer and estado='Activo'), 'Beneficio no persistió.';

  perform public.guardar_preferencias_cliente(v_customer,jsonb_build_object('contact_allowed',false,'contact_reason','Solicitó no recibir mensajes'));
  v_failed:=false;
  begin perform public.crear_activacion_cliente(jsonb_build_object('customer_id',v_customer,'type','Otro','title','No debe crearse'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se creó una activación para cliente No contactar.';

  v_failed:=false;
  begin perform public.registrar_contacto_cliente(jsonb_build_object('customer_id',v_customer,'channel','WhatsApp','reason','Contacto prohibido'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se registró contacto para cliente No contactar.';
  assert exists(select 1 from public.audit_logs where entidad='Cliente' and entidad_id=v_customer and accion='Contacto CRM registrado'), 'Falta auditoría CRM.';
end $$;

select 'TESTS_OK — CRM clientes/activaciones/contactos/RBAC PASS, rollback total' as resultado;
rollback;
