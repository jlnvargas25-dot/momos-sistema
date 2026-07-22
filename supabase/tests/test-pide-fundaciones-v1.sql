-- MOMOS · Carril Pide · prueba adversarial P01 pide-fundaciones. Siempre ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_pide_test_p01'));

-- 0) Ledger, deny-all estructural y RBAC de funciones.
do $$
declare t text; v_rol text; v_priv text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260721_p01_pide_fundaciones'),'Falta P01 en el ledger.';
  foreach t in array array[
    'quotes','checkout_sessions','checkout_holds','checkout_hold_lotes',
    'payments','payment_events','pide_demand_events','pide_demand_snapshots',
    'order_tracking_tokens','order_attributions'
  ] loop
    assert to_regclass('public.'||t) is not null
      and (select relrowsecurity from pg_class where oid=('public.'||t)::regclass),
      'P01 expuso o no protegió '||t;
    -- deny-all para los CUATRO verbos, no solo SELECT: escribir directo es tan
    -- grave como leer directo.
    foreach v_rol in array array['anon','authenticated','service_role'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        assert not has_table_privilege(v_rol,'public.'||t,v_priv),
          'P01 dejó '||v_priv||' de '||v_rol||' sobre '||t;
      end loop;
    end loop;
  end loop;
  assert has_function_privilege('service_role','public.purgar_checkout_efimero_v1(integer)','EXECUTE')
    and has_function_privilege('service_role','public.sellar_pide_demand_snapshot_v1(integer)','EXECUTE')
    and has_function_privilege('authenticated','public.pide_demand_snapshot_v1()','EXECUTE')
    and not has_function_privilege('anon','public.pide_demand_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.sellar_pide_demand_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.purgar_checkout_efimero_v1(integer)','EXECUTE')
    and not has_function_privilege('anon','public._pide_liberar_holds_vencidos(text)','EXECUTE')
    and not has_function_privilege('authenticated','public._pide_liberar_holds_vencidos(text)','EXECUTE')
    and not has_function_privilege('authenticated','public._pide_anonimizar_checkout(uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.pide_demand_snapshot_v1()','EXECUTE'),
    'P01 perdió el RBAC de funciones.';
  assert not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='inventory_reservations'
        and column_name='expira'),
    'P01 no retiró la columna expira del gancho muerto.';
end $$;

-- Contexto compartido entre bloques (ids como texto; siempre rollback).
create temporary table p01_ids(clave text primary key,valor text not null) on commit drop;
grant select on table p01_ids to authenticated,service_role;

do $$
declare
  v_sfx text:=pg_backend_pid()::text||'-'||(extract(epoch from clock_timestamp())::bigint%100000)::text;
  v_admin public.users%rowtype;
  v_tel text:='300'||lpad(((extract(epoch from clock_timestamp())::bigint)%10000000)::text,7,'0');
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'P01 necesita un Administrador autenticado en la base.';
  insert into p01_ids values('sfx',v_sfx),('admin_auth',v_admin.auth_id::text);

  insert into public.zonas(nombre,tarifa) values('P01 Zona '||v_sfx,6000);
  insert into public.franjas(nombre) values('P01 Franja '||v_sfx);
  insert into public.product_cats(nombre) values('P01 Cat '||v_sfx);
  insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock)
  values('P01-PR-'||v_sfx,'P01 producto','P01 Cat '||v_sfx,'momo','gato',1000,500,5);
  insert into public.production_batches(id,fecha,product_id,figura,sabor,prod,estado,stock_contabilizado,vencimiento)
  values('P01-L-'||v_sfx,current_date,'P01-PR-'||v_sfx,'P01Figura','P01Sabor',5,'Listo',true,current_date+10);
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas)
  values('P01-L-'||v_sfx,'P01Figura',5,5,0,0);
  insert into public.customers(id,nombre,telefono,canal)
  values('P01-C-'||v_sfx,'P01 cliente',v_tel,'Pide');   -- customers_canal_check + 'Pide'
  insert into p01_ids values('zona','P01 Zona '||v_sfx),('franja','P01 Franja '||v_sfx),
    ('producto','P01-PR-'||v_sfx),('lote','P01-L-'||v_sfx),('cliente','P01-C-'||v_sfx);
end $$;

-- 1) CHECKs recreados: aceptan los valores nuevos y conservan los viejos;
--    'Temporal' queda rechazado en inventory_reservations.
do $$
declare v_sfx text:=(select valor from p01_ids where clave='sfx'); v_failed boolean:=false;
begin
  insert into public.orders(id,fecha,hora,canal,customer_id,estado,pago,origen_detalle)
  values('P01-O1-'||v_sfx,current_date,current_time,'Pide',
    (select valor from p01_ids where clave='cliente'),'Nuevo','Pasarela (web)','Pide MOMOS');
  insert into public.orders(id,fecha,hora,canal,customer_id,estado,pago,origen_detalle)
  values('P01-O2-'||v_sfx,current_date,current_time,'WhatsApp',
    (select valor from p01_ids where clave='cliente'),'Nuevo','Nequi','');
  insert into p01_ids values('pedido_pide','P01-O1-'||v_sfx),('pedido_wa','P01-O2-'||v_sfx);
  begin
    insert into public.orders(id,fecha,hora,canal,customer_id,estado)
    values('P01-OX-'||v_sfx,current_date,current_time,'Tienda',
      (select valor from p01_ids where clave='cliente'),'Nuevo');
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'orders_canal_check aceptó un canal inventado.';
  v_failed:=false;
  begin
    insert into public.inventory_reservations(id,order_id,tipo,product_id,nombre,cantidad,estado)
    values('P01-R1-'||v_sfx,'P01-O1-'||v_sfx,'producto',
      (select valor from p01_ids where clave='producto'),'P01 reserva',1,'Temporal');
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'inventory_reservations volvió a aceptar el estado Temporal.';
  insert into public.inventory_reservations(id,order_id,tipo,product_id,nombre,cantidad,estado)
  values('P01-R2-'||v_sfx,'P01-O1-'||v_sfx,'producto',
    (select valor from p01_ids where clave='producto'),'P01 reserva',1,'Reservada');
end $$;

-- 2) Deny-all REAL prestando identidad: ni anon, ni authenticated, ni
--    service_role leen directo las tablas nuevas.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare t text; v_failed boolean;
begin
  foreach t in array array['quotes','checkout_sessions','checkout_holds',
    'payments','payment_events','pide_demand_events','order_tracking_tokens',
    'order_attributions'] loop
    v_failed:=false;
    begin
      execute format('select count(*) from public.%I',t);
    exception when insufficient_privilege then v_failed:=true; end;
    assert v_failed,'anon leyó '||t||' directo.';
  end loop;
  -- Escritura impersonada: el INSERT directo también debe morir.
  v_failed:=false;
  begin
    insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
    values(1,'x','x',current_date,clock_timestamp());
  exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed,'anon insertó en quotes directo.';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select valor from p01_ids where clave='admin_auth'),'role','authenticated'
)::text,true);
do $$
declare t text; v_failed boolean;
begin
  foreach t in array array['quotes','checkout_holds','payments',
    'pide_demand_events','pide_demand_snapshots','order_tracking_tokens',
    'order_attributions'] loop
    v_failed:=false;
    begin
      execute format('select count(*) from public.%I',t);
    exception when insufficient_privilege then v_failed:=true; end;
    assert v_failed,'authenticated (aun admin) leyó '||t||' directo.';
  end loop;
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin
    perform count(*) from public.payments;
  exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed,'service_role leyó payments directo.';
end $$;
reset role;

-- 3) UNIQUE parciales: un solo hold Temporal por quote y por actor; un solo
--    payment Iniciado por quote.
do $$
declare
  v_q1 uuid; v_q2 uuid; v_h1 uuid; v_failed boolean:=false;
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_actor_a text:=encode(sha256(('p01-actor-a')::bytea),'hex');
  v_actor_b text:=encode(sha256(('p01-actor-b')::bytea),'hex');
  v_exp timestamptz:=clock_timestamp()+interval '7 minutes';
begin
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(54000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes')
  returning id into v_q1;
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(48000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes')
  returning id into v_q2;
  insert into p01_ids values('q1',v_q1::text),('q2',v_q2::text);

  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_q1,v_actor_a,v_exp,v_exp) returning id into v_h1;
  begin
    insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
    values(v_q1,v_actor_b,v_exp,v_exp);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Dos holds Temporal vivos sobre la misma quote.';
  v_failed:=false;
  begin
    insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
    values(v_q2,v_actor_a,v_exp,v_exp);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'El mismo actor sostuvo dos checkouts vivos.';

  insert into public.payments(quote_id,proveedor,monto)
  values(v_q1,'pasarela_test',54000);
  v_failed:=false;
  begin
    insert into public.payments(quote_id,proveedor,monto)
    values(v_q1,'pasarela_test',54000);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Dos intents Iniciado vivos sobre la misma quote.';
  insert into public.payments(quote_id,proveedor,monto,estado)
  values(v_q1,'pasarela_test',54000,'Rechazado');   -- terminal: permitido
end $$;

-- 4) Beneficio reservado por hold (§1.10): rama nueva consistente.
do $$
declare
  v_sfx text:=(select valor from p01_ids where clave='sfx');
  v_q1 uuid:=(select valor::uuid from p01_ids where clave='q1');
  v_q2 uuid:=(select valor::uuid from p01_ids where clave='q2');
  v_failed boolean:=false;
begin
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor)
  values('P01-B1-'||v_sfx,(select valor from p01_ids where clave='cliente'),
    'P01 beneficio','descuento_valor_fijo',2000);
  update public.benefits set estado='Reservado',hold_quote_id=v_q1
    where id='P01-B1-'||v_sfx;
  begin
    insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor,estado,hold_quote_id)
    values('P01-B2-'||v_sfx,(select valor from p01_ids where clave='cliente'),
      'P01 beneficio 2','descuento_valor_fijo',2000,'Activo',v_q2);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'Un beneficio Activo quedó atado a un hold.';
  v_failed:=false;
  begin
    insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor,estado,hold_quote_id)
    values('P01-B3-'||v_sfx,(select valor from p01_ids where clave='cliente'),
      'P01 beneficio 3','descuento_valor_fijo',2000,'Reservado',v_q1);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Dos beneficios reservados por el mismo hold-quote.';
end $$;

-- 5) Atribución por whitelist: clave extraña y referido con formato de
--    teléfono se rechazan.
do $$
declare
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_failed boolean:=false;
begin
  begin
    insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,atribucion)
    values(1000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes',
      '{"hack":"si"}'::jsonb);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'La atribución aceptó una clave fuera de la whitelist.';
  v_failed:=false;
  begin
    insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,atribucion)
    values(1000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes',
      '{"referido":"300 123-4567"}'::jsonb);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'La atribución aceptó un referido con formato de teléfono.';
  -- F2: el rechazo formato-teléfono cubre TODO el texto libre, no solo referido.
  v_failed:=false;
  begin
    insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,atribucion)
    values(1000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes',
      '{"utm_campaign":"promo 300-123-4567"}'::jsonb);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'utm_campaign aceptó un valor con formato de teléfono.';
  -- F2: las claves de ID exigen patrón opaco estricto…
  v_failed:=false;
  begin
    insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,atribucion)
    values(1000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes',
      '{"campaign_id":"camp 120!*"}'::jsonb);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'campaign_id aceptó un valor fuera del patrón opaco.';
  -- …pero el ID numérico largo de plataforma (Meta) es legítimo.
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,atribucion)
  values(1000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes',
    '{"utm_source":"meta","referido":"REF-8F3K2Q","campaign_id":"120210000000000042"}'::jsonb);
  -- F12: order_attributions comparte la MISMA whitelist.
  v_failed:=false;
  begin
    insert into public.order_attributions(order_id,atribucion)
    values((select valor from p01_ids where clave='pedido_pide'),'{"hack":"si"}'::jsonb);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'order_attributions aceptó una clave fuera de la whitelist.';
  insert into public.order_attributions(order_id,atribucion)
  values((select valor from p01_ids where clave='pedido_pide'),
    '{"utm_source":"meta","campaign_id":"120210000000000042"}'::jsonb);
end $$;

-- 6) Anonimización en dos fases: conserva id/estado/total, anula
--    telefono_hmac/lineas y borra el crudo de checkout_sessions.
do $$
declare
  v_q3 uuid;
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_row public.quotes%rowtype;
begin
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,estado,telefono_hmac,lineas,atribucion)
  values(54000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes','Usada',
    encode(sha256(('p01-telefono')::bytea),'hex'),
    '[{"tipo":"producto","product_id":"P01","cantidad":1}]'::jsonb,
    '{"utm_source":"meta"}'::jsonb)
  returning id into v_q3;
  insert into public.checkout_sessions(quote_id,nombre,telefono,direccion,barrio)
  values(v_q3,'P01 invitada','573001234567','Calle P01 # 1-23','P01 barrio');
  insert into p01_ids values('q3',v_q3::text);

  perform public._pide_anonimizar_checkout(v_q3);
  select * into v_row from public.quotes where id=v_q3;
  assert v_row.telefono_hmac is null and v_row.lineas is null
    and v_row.estado='Usada' and v_row.total=54000,
    'La anonimización no conservó id/estado/total o dejó PII.';
  -- F2: el re-saneo defensivo conserva una atribución que sigue en whitelist.
  assert v_row.atribucion='{"utm_source":"meta"}'::jsonb,
    'El re-saneo defensivo alteró una atribución válida.';
  assert not exists(select 1 from public.checkout_sessions where quote_id=v_q3),
    'La anonimización dejó el crudo de checkout_sessions.';
end $$;

-- 7) FK RESTRICT: una quote con pago no se puede borrar.
do $$
declare
  v_q3 uuid:=(select valor::uuid from p01_ids where clave='q3');
  v_pid uuid;
  v_failed boolean:=false;
begin
  insert into public.payments(quote_id,proveedor,monto,estado)
  values(v_q3,'pasarela_test',54000,'Aprobado') returning id into v_pid;
  insert into p01_ids values('pago_q3',v_pid::text);
  begin
    delete from public.quotes where id=v_q3;
  exception when foreign_key_violation then v_failed:=true; end;
  assert v_failed,'Se pudo borrar una quote con pago (RESTRICT roto).';
end $$;

-- 7b) F7: doble Aprobado bloqueado en schema y Reembolsado libera el slot;
--     F9: terminales de payments irreversibles; F8: payment_events idempotente
--     por (payment_id,external_event_id).
do $$
declare
  v_q3 uuid:=(select valor::uuid from p01_ids where clave='q3');
  v_pago uuid:=(select valor::uuid from p01_ids where clave='pago_q3');
  v_failed boolean:=false;
begin
  -- F7: el segundo webhook legítimo de aprobación (fila Aprobado nueva) choca
  -- acá; P04 lo enruta a conciliación.
  begin
    insert into public.payments(quote_id,proveedor,monto,estado)
    values(v_q3,'pasarela_test',54000,'Aprobado');
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Doble Aprobado sobre la misma quote.';
  v_failed:=false;
  begin
    insert into public.payments(quote_id,proveedor,monto)
    values(v_q3,'pasarela_test',54000);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Un intent nuevo convivió con un Aprobado vivo.';
  -- F9: Aprobado jamás vuelve a Iniciado.
  v_failed:=false;
  begin
    update public.payments set estado='Iniciado' where id=v_pago;
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'payments permitió Aprobado→Iniciado.';
  -- Aprobado→Reembolsado es legítimo y LIBERA el slot del índice parcial.
  update public.payments set estado='Reembolsado' where id=v_pago;
  insert into public.payments(quote_id,proveedor,monto)
  values(v_q3,'pasarela_test',54000);
  -- F9: Reembolsado es terminal.
  v_failed:=false;
  begin
    update public.payments set estado='Aprobado' where id=v_pago;
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'payments permitió salir de Reembolsado.';

  -- F8: mismo (payment_id,external_event_id) → unique_violation; un
  -- external_event_id distinto entra (re-notificación legítima que P04
  -- arbitra por key determinística).
  insert into public.payment_events(payment_id,external_event_id,tipo,
    estado_reportado,firma_ok,payload_hash)
  values(v_pago,'P01-EV-1','Aprobado','approved',true,
    encode(sha256(('p01-payload-1')::bytea),'hex'));
  v_failed:=false;
  begin
    insert into public.payment_events(payment_id,external_event_id,tipo,
      estado_reportado,firma_ok,payload_hash)
    values(v_pago,'P01-EV-1','Aprobado','approved',true,
      encode(sha256(('p01-payload-1bis')::bytea),'hex'));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'payment_events aceptó dos veces el mismo external_event_id.';
  insert into public.payment_events(payment_id,external_event_id,tipo,
    estado_reportado,firma_ok,payload_hash)
  values(v_pago,'P01-EV-2','Aprobado','approved',true,
    encode(sha256(('p01-payload-2')::bytea),'hex'));
end $$;

-- 8) Liberación perezosa de holds vencidos: devuelve stock, lote exacto y
--    beneficio, exactamente una vez.
do $$
declare
  v_sfx text:=(select valor from p01_ids where clave='sfx');
  v_producto text:=(select valor from p01_ids where clave='producto');
  v_lote text:=(select valor from p01_ids where clave='lote');
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_q4 uuid; v_hold uuid; v_res jsonb;
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(2000,v_zona,v_franja,current_date+2,clock_timestamp()-interval '5 minutes')
  returning id into v_q4;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_q4,encode(sha256(('p01-actor-c')::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_hold;
  insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
  values(v_hold,v_producto,v_lote,'P01Figura',2);
  -- simular el descuento que hizo el hold al reservar
  update public.products set stock=stock-2 where id=v_producto;
  update public.lote_figuras set consumidas=consumidas+2
    where batch_id=v_lote and figura='P01Figura';
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor,estado,hold_quote_id)
  values('P01-B4-'||v_sfx,(select valor from p01_ids where clave='cliente'),
    'P01 beneficio hold','descuento_valor_fijo',2000,'Reservado',v_q4);

  insert into p01_ids values('hold_expirado',v_hold::text);
  v_res:=public._pide_liberar_holds_vencidos(v_producto);
  assert (v_res->>'liberados')::integer=1
    and (v_res->>'irreconciliables')::integer=0,
    'La liberación no procesó el hold vencido.';
  assert (select stock from public.products where id=v_producto)=5,
    'La liberación no devolvió el stock agregado.';
  assert (select consumidas from public.lote_figuras
    where batch_id=v_lote and figura='P01Figura')=0,
    'La liberación no devolvió el lote exacto.';
  assert (select estado from public.checkout_holds where id=v_hold)='Expirada'
    and (select resuelto_at from public.checkout_holds where id=v_hold) is not null,
    'El hold vencido no quedó Expirada con sello.';
  assert (select estado from public.benefits where id='P01-B4-'||v_sfx)='Activo'
    and (select hold_quote_id from public.benefits where id='P01-B4-'||v_sfx) is null,
    'El beneficio reservado por el hold no volvió a Activo.';
  v_res:=public._pide_liberar_holds_vencidos(v_producto);
  assert (v_res->>'liberados')::integer=0,
    'La liberación procesó dos veces el mismo hold.';
end $$;

-- 8b) F6: la extensión del hold es exactly-once EN SCHEMA (sello único +
--     reversa exacta); F9: Expirada es terminal; F4: el hold veneno se aísla
--     con warning, queda Temporal vencido y JAMÁS bloquea el ciclo.
do $$
declare
  v_producto text:=(select valor from p01_ids where clave='producto');
  v_lote text:=(select valor from p01_ids where clave='lote');
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_q5 uuid; v_q6 uuid; v_h5 uuid; v_h6 uuid; v_res jsonb; v_failed boolean:=false;
  v_exp timestamptz:=clock_timestamp()+interval '7 minutes';
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(3000,v_zona,v_franja,current_date+2,clock_timestamp()+interval '15 minutes')
  returning id into v_q5;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_q5,encode(sha256(('p01-actor-d')::bytea),'hex'),v_exp,v_exp)
  returning id into v_h5;
  -- subir expira_at sin sello → rechazado
  begin
    update public.checkout_holds set expira_at=expira_at+interval '10 minutes'
      where id=v_h5;
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'Se subió expira_at sin sellar la extensión.';
  -- sello único: la primera extensión pasa…
  update public.checkout_holds
    set expira_at=expira_at+interval '10 minutes',
        extendido_por_pago_at=clock_timestamp()
    where id=v_h5;
  -- …la segunda se rechaza (re-extensión = segundo sello)
  v_failed:=false;
  begin
    update public.checkout_holds set expira_at=expira_at+interval '10 minutes'
      where id=v_h5;
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'El hold aceptó una segunda extensión.';
  -- reversa legítima tras intent rechazado: expira_original + sello limpio
  update public.checkout_holds
    set expira_at=expira_original,extendido_por_pago_at=null
    where id=v_h5;
  assert (select expira_at=expira_original and extendido_por_pago_at is null
    from public.checkout_holds where id=v_h5),
    'La reversa no volvió a expira_original limpiando el sello.';
  -- F9: Expirada es terminal (hold liberado en el bloque 8)
  v_failed:=false;
  begin
    update public.checkout_holds set estado='Temporal',resuelto_at=null
      where id=(select valor::uuid from p01_ids where clave='hold_expirado');
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'Un hold Expirada volvió a Temporal.';

  -- F4: hold veneno — su línea de lote no tiene respaldo en consumidas.
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(1000,v_zona,v_franja,current_date+2,clock_timestamp()-interval '5 minutes')
  returning id into v_q6;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_q6,encode(sha256(('p01-actor-e')::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_h6;
  insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
  values(v_h6,v_producto,v_lote,'P01Figura',1);
  update public.products set stock=stock-1 where id=v_producto;
  -- (corrupción simulada: consumidas NO se incrementó al reservar)
  v_res:=public._pide_liberar_holds_vencidos(v_producto);
  assert (v_res->>'liberados')::integer=0
    and (v_res->>'irreconciliables')::integer=1,
    'El hold veneno no quedó aislado con conteo.';
  assert (select estado from public.checkout_holds where id=v_h6)='Temporal',
    'El hold veneno cambió de estado sin conciliar.';
  -- reparada la verdad del lote, el ciclo siguiente concilia exactly-once
  update public.lote_figuras set consumidas=consumidas+1
    where batch_id=v_lote and figura='P01Figura';
  v_res:=public._pide_liberar_holds_vencidos(v_producto);
  assert (v_res->>'liberados')::integer=1
    and (v_res->>'irreconciliables')::integer=0,
    'El hold reparado no se concilió en el ciclo siguiente.';
  assert (select stock from public.products where id=v_producto)=5
    and (select consumidas from public.lote_figuras
      where batch_id=v_lote and figura='P01Figura')=0,
    'La conciliación del hold reparado no devolvió stock/lote.';
end $$;

-- 9) Tracking §1.7: v4 obligatorio, un solo token Activo por pedido y cero
--    exposición en snapshots o superficies de agente.
do $$
declare
  v_pedido text:=(select valor from p01_ids where clave='pedido_pide');
  v_t1 uuid:=gen_random_uuid(); v_t2 uuid:=gen_random_uuid();
  v_failed boolean:=false; v_def text;
begin
  insert into public.order_tracking_tokens(token,order_id) values(v_t1,v_pedido);
  begin
    insert into public.order_tracking_tokens(token,order_id) values(v_t2,v_pedido);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'Dos tokens Activo para el mismo pedido.';
  update public.order_tracking_tokens
    set estado='Invalidado',invalidado_at=clock_timestamp() where token=v_t1;
  insert into public.order_tracking_tokens(token,order_id) values(v_t2,v_pedido);
  -- F9: Invalidado es terminal — jamás se resucita un token quemado.
  v_failed:=false;
  begin
    update public.order_tracking_tokens
      set estado='Activo',invalidado_at=null where token=v_t1;
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'Un token Invalidado volvió a Activo.';
  v_failed:=false;
  begin
    insert into public.order_tracking_tokens(token,order_id)
    values('00000000-0000-1000-8000-000000000000'::uuid,v_pedido);
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'Se aceptó un token que no es UUID v4.';
  if to_regprocedure('public.momos_operational_snapshot_v2()') is not null then
    v_def:=pg_get_functiondef('public.momos_operational_snapshot_v2()'::regprocedure);
    assert position('tracking' in lower(v_def))=0,
      'El snapshot operativo referencia tracking (invariante §1.7 rota).';
  end if;
  if to_regprocedure('public.momos_core_snapshot_v3()') is not null then
    v_def:=pg_get_functiondef('public.momos_core_snapshot_v3()'::regprocedure);
    assert position('tracking' in lower(v_def))=0,
      'El snapshot de catálogos referencia tracking (invariante §1.7 rota).';
  end if;
  v_def:=pg_get_functiondef('public.pide_demand_snapshot_v1()'::regprocedure);
  assert position('tracking' in lower(v_def))=0,
    'El snapshot de demanda referencia tracking (invariante §1.7 rota).';
end $$;

-- 10) Demanda: zona/franja no canónicas se normalizan; el snapshot sellado
--     solo expone celdas k>=3 y jamás el texto crudo.
do $$
declare
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_zona_out text; v_franja_out text;
begin
  insert into public.pide_demand_events(zona,franja,fecha,error,cantidad)
  values('Calle 45 # 3-21 tel 3001234567','franja inventada',current_date,'FUERA_DE_COBERTURA',2)
  returning zona,franja into v_zona_out,v_franja_out;
  assert v_zona_out='OTRA_ZONA' and v_franja_out='OTRA_FRANJA',
    'La demanda persistió texto crudo del usuario.';
  insert into public.pide_demand_events(zona,franja,fecha,error,cantidad)
  select v_zona,v_franja,current_date,'SIN_CAPACIDAD_FRANJA',1
  from generate_series(1,3);
  assert not exists(select 1 from public.pide_demand_events where zona like 'Calle%'),
    'Quedó una zona cruda en pide_demand_events.';
end $$;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_seal jsonb;
begin
  v_seal:=public.sellar_pide_demand_snapshot_v1(7);
  assert coalesce((v_seal->>'ok')::boolean,false)
    and v_seal->>'contract'='momos.pide.demand-snapshot.v1'
    and coalesce((v_seal->>'containsCustomerPii')::boolean,true)=false,
    'El sellado del snapshot de demanda no cumplió su contrato.';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select valor from p01_ids where clave='admin_auth'),'role','authenticated'
)::text,true);
do $$
declare
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_snapshot jsonb;
begin
  v_snapshot:=public.pide_demand_snapshot_v1();
  assert coalesce((v_snapshot->>'ok')::boolean,false)
    and coalesce((v_snapshot->>'sellado')::boolean,false)
    and v_snapshot->>'contract'='momos.pide.demand-snapshot.v1',
    'El lector de demanda no entregó el snapshot sellado.';
  assert exists(select 1 from jsonb_array_elements(v_snapshot->'celdas') c
    where c->>'zona'=v_zona and (c->>'eventos')::integer>=3),
    'El snapshot perdió la celda canónica k>=3.';
  assert not exists(select 1 from jsonb_array_elements(v_snapshot->'celdas') c
    where (c->>'eventos')::integer<3),
    'El snapshot expuso una celda por debajo de k=3.';
  assert position('Calle 45' in v_snapshot::text)=0,
    'El snapshot expuso texto crudo del usuario.';
end $$;

-- 11) Guard H89 ampliado: una política staff_read sobre una tabla Pide apaga
--     cierre_lecturas_pii_disponible().
do $$
begin
  assert public.cierre_lecturas_pii_disponible(),
    'El guard H89 no está disponible con la base sana.';
  assert position('pide_demand_events' in
    pg_get_functiondef('public.cierre_lecturas_pii_disponible()'::regprocedure))>0,
    'El guard H89 no incluye las tablas Pide.';
end $$;
reset role;
create policy staff_read on public.quotes for select to authenticated using(true);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select valor from p01_ids where clave='admin_auth'),'role','authenticated'
)::text,true);
do $$
begin
  assert not public.cierre_lecturas_pii_disponible(),
    'El guard H89 ignoró una política staff_read sobre quotes.';
end $$;
reset role;
drop policy staff_read on public.quotes;

-- 12) Purga efímera: borra solo quotes viejas sin pago ni pedido; conserva la
--     quote Usada anonimizada (verdad del FK de payments).
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  v_zona text:=(select valor from p01_ids where clave='zona');
  v_franja text:=(select valor from p01_ids where clave='franja');
  v_q_vieja uuid; v_res jsonb; v_failed boolean:=false;
  v_q3 uuid:=(select valor::uuid from p01_ids where clave='q3');
begin
  -- F1: la ventana de purga es 24-72 h (spec §1.2) — fuera de rango, cerrada.
  begin
    v_res:=public.purgar_checkout_efimero_v1(100);
  exception when raise_exception then v_failed:=true; end;
  assert v_failed,'La purga aceptó una ventana fuera de 24-72 h.';
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at,created_at)
  values(1000,v_zona,v_franja,current_date+2,
    clock_timestamp()-interval '79 hours',clock_timestamp()-interval '80 hours')
  returning id into v_q_vieja;
  v_res:=public.purgar_checkout_efimero_v1(48);
  assert coalesce((v_res->>'ok')::boolean,false)
    and (v_res->>'quotesPurgadas')::integer>=1
    and (v_res->>'holdsIrreconciliables')::integer=0,
    'La purga efímera no corrió.';
  assert not exists(select 1 from public.quotes where id=v_q_vieja),
    'La purga dejó viva una quote vieja sin pago.';
  assert exists(select 1 from public.quotes where id=v_q3),
    'La purga borró una quote con pago (rompe conciliación).';
end $$;
reset role;

select 'TESTS_OK — P01 canal/holds/extensión exactly-once/hold veneno/pagos con terminales/eventos idempotentes/beneficio/anonimización+re-saneo/atribución/tracking/demanda k>=3/guard H89/purga 24-72h PASS, rollback total' as resultado;
rollback;
