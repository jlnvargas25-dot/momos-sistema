-- MOMOS · Carril Pide · prueba adversarial P04 pide-pedido. Siempre ROLLBACK.
-- Requiere una base con la cadena OPS + P01 + P02 + P03 + P04 y dominio
-- canónico vivo (mismos supuestos de P03: dos momos activos con figura
-- canónica y sabor canónico en catalog_values).
--
-- Referencias de callers: supabase/migraciones-ordenadas/README.md (pasos P04)
-- y tests/test-migraciones-ordenadas.sql (sección P04).
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtext('momos_pide_test_p04'));

-- 0) Ledger y RBAC estructural: tracking es la única superficie anon nueva;
--    las dos RPC de servicio son EXCLUSIVAS de pide_service.
do $$
declare v_rol text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_p04_pide_pedido'),'Falta P04 en el ledger.';
  assert exists(select 1 from pg_roles where rolname='pide_service'),
    'Falta el rol pide_service.';
  assert has_function_privilege('pide_service','public.crear_pedido_publico_v1(jsonb)','EXECUTE')
    and has_function_privilege('pide_service','public.registrar_evento_pago_v1(jsonb)','EXECUTE'),
    'pide_service no tiene su superficie de servicio.';
  assert has_function_privilege('anon','public.tracking_publico_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.tracking_publico_v1(jsonb)','EXECUTE'),
    'tracking_publico_v1 no quedó expuesta a anon/authenticated.';
  foreach v_rol in array array['anon','authenticated','service_role'] loop
    assert not has_function_privilege(v_rol,'public.crear_pedido_publico_v1(jsonb)','EXECUTE'),
      'crear_pedido_publico_v1 quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public.registrar_evento_pago_v1(jsonb)','EXECUTE'),
      'registrar_evento_pago_v1 quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._pide_promover_holds(uuid,text)','EXECUTE'),
      '_pide_promover_holds quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._pide_reservar_pedido_patas(text)','EXECUTE'),
      '_pide_reservar_pedido_patas quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._pide_reservar_item_regalo(text,text)','EXECUTE'),
      '_pide_reservar_item_regalo quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._pide_service_ctx()','EXECUTE'),
      '_pide_service_ctx quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._pide_uuid5(text)','EXECUTE'),
      '_pide_uuid5 quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._crear_pedido_core(jsonb)','EXECUTE'),
      '_crear_pedido_core quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,'public._set_order_status_core(text,text,boolean)','EXECUTE'),
      '_set_order_status_core quedó expuesta a '||v_rol;
  end loop;
  assert not has_function_privilege('pide_service','public.purgar_intents_pide_v1(integer)','EXECUTE')
    and not has_function_privilege('pide_service','public.reservar_checkout_v1(jsonb)','EXECUTE'),
    'pide_service tiene superficie de más (lista cerrada rota).';
  -- Guard H89 ampliado con order_tracking_tokens.
  assert position('order_tracking_tokens' in pg_get_functiondef(
    'public.cierre_lecturas_pii_disponible()'::regprocedure))>0,
    'El guard H89 no incluye order_tracking_tokens.';
  -- El constraint del requisito 3 quedó instalado.
  assert exists(select 1 from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_pide_entrega_check'),
    'Falta orders_pide_entrega_check.';
  -- Seeds técnicos.
  assert exists(select 1 from public.app_settings where clave='pide_rate_limit_tracking')
    and exists(select 1 from public.app_settings where clave='pide_webhook_futuro_max_minutos'),
    'Faltan los seeds de P04.';
end $$;

-- Contexto compartido (ids como texto; siempre rollback).
create temporary table p04_ids(clave text primary key,valor text not null) on commit drop;
grant select on table p04_ids to anon,authenticated,service_role;

do $$
declare
  v_sfx text:=pg_backend_pid()::text||'-'||(extract(epoch from clock_timestamp())::bigint%100000)::text;
  v_admin public.users%rowtype;
  v_momo text; v_figura text;
  v_momo2 text; v_figura2 text;
  v_sabor text; v_salsa text;
  v_cliente text;
  v_tel text:='315'||lpad(((extract(epoch from clock_timestamp())::bigint)%10000000)::text,7,'0');
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'P04 necesita un Administrador autenticado en la base.';
  insert into p04_ids values('sfx',v_sfx),('admin_auth',v_admin.auth_id::text);

  select f.product_id,f.nombre into v_momo,v_figura
    from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and p.activo and p.tipo='momo'
    order by f.product_id,f.orden limit 1;
  assert v_momo is not null,'P04 necesita una figura canónica activa (H90).';
  select f.product_id,f.nombre into v_momo2,v_figura2
    from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and p.activo and p.tipo='momo' and f.product_id<>v_momo
    order by f.product_id,f.orden limit 1;
  assert v_momo2 is not null,'P04 necesita un segundo momo con figura canónica activa.';
  select valor into v_sabor from public.catalog_values
    where activo and categoria like 'sabor_%' order by categoria,orden,valor limit 1;
  select valor into v_salsa from public.catalog_values
    where activo and categoria='salsa' order by orden,valor limit 1;
  assert v_sabor is not null and v_salsa is not null,
    'P04 necesita sabor y salsa canónicos activos.';

  -- Lotes DETERMINISTAS (patrón P03): se neutralizan los existentes.
  update public.production_batches set stock_contabilizado=false
    where product_id in (v_momo,v_momo2) and stock_contabilizado;
  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values
    ('P04-LA-'||v_sfx,current_date,v_momo,v_figura,v_sabor,180,20,20,0,0,
     'Listo',true,clock_timestamp(),6),
    ('P04-LB-'||v_sfx,current_date,v_momo2,v_figura2,v_sabor,180,12,12,0,0,
     'Listo',true,clock_timestamp(),6);
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas)
  values('P04-LA-'||v_sfx,v_figura,20,20,0,0,0),
        ('P04-LB-'||v_sfx,v_figura2,12,12,0,0,0);
  update public.products set precio_pide=48000, stock=20, pide_hold_fraccion=null
    where id=v_momo;
  update public.products set precio_pide=30000, stock=12, pide_hold_fraccion=null
    where id=v_momo2;

  insert into public.zonas(nombre,tarifa,sede_id)
  values('P04 Zona '||v_sfx,6000,(select sede_id from public.zonas order by nombre limit 1));
  insert into public.franjas(nombre,hora_inicio,hora_fin,cupo,activo)
  values('P04 Franja '||v_sfx,'10:00','12:00',50,true);

  select id into v_cliente from public.customers where auth_id=v_admin.auth_id limit 1;
  if v_cliente is null then
    v_cliente:='P04-C-'||v_sfx;
    insert into public.customers(id,nombre,telefono,canal,auth_id)
    values(v_cliente,'P04 cliente',v_tel,'Pide',v_admin.auth_id);
  end if;
  -- Beneficio de descuento fijo para el E2E con posesión probada.
  delete from public.benefits where customer_id=v_cliente and estado='Activo';
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor)
  values('P04-B-'||v_sfx,v_cliente,'P04 descuento','descuento_valor_fijo',5000);

  insert into p04_ids values
    ('momo',v_momo),('figura',v_figura),
    ('momo2',v_momo2),('figura2',v_figura2),
    ('sabor',v_sabor),('salsa',v_salsa),
    ('lote_a','P04-LA-'||v_sfx),('lote_b','P04-LB-'||v_sfx),
    ('zona','P04 Zona '||v_sfx),('franja','P04 Franja '||v_sfx),
    ('cliente',v_cliente),('benefit','P04-B-'||v_sfx);

  -- Margen del rate limit durante el test (patrón P02/P03).
  update public.app_settings set valor=to_jsonb(100000) where clave='pide_rate_limit_ip';
  update public.app_settings set valor=to_jsonb(100000) where clave='pide_rate_limit_checkout';
  update public.app_settings set valor=to_jsonb(100000) where clave='pide_rate_limit_pago';
  update public.app_settings set valor=to_jsonb(100000) where clave='pide_rate_limit_tracking';
  update public.app_settings set valor=to_jsonb(100000) where clave='pide_rate_limit_global';
  -- Pasarela habilitada SOLO dentro del test (rollback la retira).
  insert into public.app_settings(clave,valor)
  values('pide_pasarela_proveedor',to_jsonb('pasarela_test'::text))
  on conflict (clave) do update set valor=excluded.valor;
end $$;

-- Helpers locales.
create function pg_temp._p04_cotizar(p_prod text, p_cant integer, p_atrib jsonb default null)
returns uuid
language plpgsql
as $$
declare v_q jsonb;
begin
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',p_prod,'cantidad',p_cant,
      'figura',(select valor from p04_ids where clave=
        case when p_prod=(select valor from p04_ids where clave='momo')
          then 'figura' else 'figura2' end),
      'sabor',(select valor from p04_ids where clave='sabor'),
      'salsa',(select valor from p04_ids where clave='salsa'))),
    'zona',(select valor from p04_ids where clave='zona'),
    'franja',(select valor from p04_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text,
    'atribucion',p_atrib));
  assert coalesce((v_q->>'ok')::boolean,false),
    'cotizar falló: '||coalesce(v_q->>'error','(sin error)')||' '||coalesce(v_q->>'mensaje','');
  return (v_q->>'quote_id')::uuid;
end $$;

create function pg_temp._p04_checkout(p_quote uuid, p_tel text)
returns void
language plpgsql
as $$
declare v_r jsonb;
begin
  v_r:=public.reservar_checkout_v1(jsonb_build_object(
    'quote_id',p_quote,'nombre','P04 Invitado','telefono',p_tel,
    'direccion','Calle P04 #1-23','barrio','P04','referencia','Torre P04',
    'opt_in',false));
  assert coalesce((v_r->>'ok')::boolean,false),
    'reservar falló: '||coalesce(v_r->>'error','?')||' '||coalesce(v_r->>'mensaje','');
end $$;

create function pg_temp._p04_intent(p_quote uuid)
returns uuid
language plpgsql
as $$
declare v_r jsonb;
begin
  v_r:=public.iniciar_pago_v1(jsonb_build_object('quote_id',p_quote));
  assert coalesce((v_r->>'ok')::boolean,false),
    'iniciar_pago falló: '||coalesce(v_r->>'error','?')||' '||coalesce(v_r->>'mensaje','');
  return (v_r->>'payment_id')::uuid;
end $$;

create function pg_temp._p04_webhook(
  p_payment uuid, p_evento text, p_tipo text, p_monto numeric,
  p_firma boolean default true)
returns jsonb
language plpgsql
as $$
begin
  return public.registrar_evento_pago_v1(jsonb_build_object(
    'payment_id',p_payment,'external_event_id',p_evento,
    'tipo',p_tipo,'estado_reportado',lower(p_tipo),
    'monto_reportado',p_monto,'firma_ok',p_firma,
    'key_id',case when p_firma then 'k1' end,
    'payload_hash',encode(sha256(('P04:'||p_evento)::bytea),'hex'),
    'evento_ts',clock_timestamp()::text,
    'external_id','EXT-'||p_evento));
end $$;

-- 2) E2E feliz: quote con beneficio (posesión probada) → hold → intent →
--    webhook Aprobado → pedido Pagado con TODO sellado.
do $$
declare
  v_q uuid; v_pid uuid; v_r jsonb; v_order text;
  v_stock_post_hold numeric; v_consumidas_post_hold numeric;
  v_lotes integer; v_res integer;
  v_o public.orders%rowtype;
  v_total_math numeric;
begin
  -- posesión probada: sesión del cliente vinculado (patrón P02/P03)
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),2,
    jsonb_build_object('utm_source','meta','campaign_id','CMP-P04-NOEXISTE'));
  insert into p04_ids values('q_feliz',v_q::text);
  -- el beneficio quedó en la quote
  assert (select benefit_id from public.quotes where id=v_q)
    =(select valor from p04_ids where clave='benefit'),
    'La quote no tomó el beneficio con posesión probada.';

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform pg_temp._p04_checkout(v_q,'3159990001');
  select stock into v_stock_post_hold from public.products
    where id=(select valor from p04_ids where clave='momo');
  select consumidas into v_consumidas_post_hold from public.lote_figuras
    where batch_id=(select valor from p04_ids where clave='lote_a');
  assert v_stock_post_hold=18 and v_consumidas_post_hold=2,
    'El hold no descontó stock/lote como se esperaba.';
  v_pid:=pg_temp._p04_intent(v_q);
  insert into p04_ids values('pago_feliz',v_pid::text);

  -- webhook Aprobado con monto EXACTO, como pide_service
  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-FELIZ-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert coalesce((v_r->>'ok')::boolean,false) and v_r->>'resultado' like 'pedido_creado:%',
    'El webhook aprobado no creó el pedido: '||coalesce(v_r->>'resultado','?');
  v_order:=v_r->>'order_id';
  insert into p04_ids values('order_feliz',v_order);

  select * into v_o from public.orders where id=v_order;
  -- Requisito 3: fecha_entrega + franja sellados desde la quote; fecha operativa intacta.
  assert v_o.canal='Pide' and v_o.estado='Pagado' and v_o.pagado_en is not null
    and v_o.comprobante and v_o.inventario_reservado,
    'El pedido no quedó Pagado con inventario reservado.';
  assert v_o.fecha_entrega=current_date+2
    and v_o.franja=(select valor from p04_ids where clave='franja')
    and v_o.fecha=(now() at time zone 'America/Bogota')::date,
    'fecha_entrega/franja/fecha no quedaron sellados como exige el requisito 3.';
  assert v_o.pago='Pasarela (web)' and v_o.origen_detalle='Pide MOMOS'
    and v_o.zona=(select valor from p04_ids where clave='zona'),
    'canal de pago/origen/zona del pedido incorrectos.';
  assert v_o.campaign_id is null,
    'campaign_id inexistente en catálogo debió quedar null.';
  -- Invariante de dinero: pedido ≡ quote ≡ monto capturado.
  select coalesce(t.ventas,0)-v_o.descuento+v_o.dom_cobrado into v_total_math
    from public.v_order_totals t where t.order_id=v_order;
  assert v_total_math=(select monto from public.payments where id=v_pid)
    and v_o.descuento=5000 and v_o.dom_cobrado=6000,
    'El total del pedido no reproduce lo cobrado (desc/dom/total).';
  -- Beneficio consumido de punta a punta.
  assert (select estado from public.benefits
    where id=(select valor from p04_ids where clave='benefit'))='Usado'
    and (select pedido_uso from public.benefits
      where id=(select valor from p04_ids where clave='benefit'))=v_order
    and (select hold_quote_id from public.benefits
      where id=(select valor from p04_ids where clave='benefit')) is null,
    'El beneficio no terminó Usado con pedido_uso sellado.';
  -- Hold promovido SIN re-FIFO: reservas espejo del lote exacto y stock intacto.
  assert (select estado from public.checkout_holds where quote_id=v_q)='Confirmada',
    'El hold no quedó Confirmada.';
  select count(*) into v_lotes from public.checkout_hold_lotes l
    join public.checkout_holds h on h.id=l.hold_id where h.quote_id=v_q;
  select count(*) into v_res from public.inventory_reservations
    where order_id=v_order and tipo='producto'
      and batch_id=(select valor from p04_ids where clave='lote_a');
  assert v_res=v_lotes and v_res>0,
    'La promoción no materializó las reservas con el batch exacto.';
  assert (select stock from public.products
      where id=(select valor from p04_ids where clave='momo'))=v_stock_post_hold
    and (select consumidas from public.lote_figuras
      where batch_id=(select valor from p04_ids where clave='lote_a'))=v_consumidas_post_hold,
    'La promoción re-descontó stock/lote (doble descuento).';
  -- Pago atado, quote Usada y PII fuera.
  assert (select order_id from public.payments where id=v_pid)=v_order,
    'payments.order_id no quedó sellado.';
  assert (select estado from public.quotes where id=v_q)='Usada'
    and (select telefono_hmac from public.quotes where id=v_q) is null
    and (select lineas from public.quotes where id=v_q) is null,
    'La quote no quedó Usada y anonimizada.';
  assert not exists(select 1 from public.checkout_sessions where quote_id=v_q),
    'La sesión del invitado no se borró tras crear el pedido.';
  -- Atribución copiada PII-free.
  assert exists(select 1 from public.order_attributions where order_id=v_order),
    'La atribución no se copió a order_attributions.';
  -- Auditoría sin PII en la rama pública.
  assert not exists(select 1 from public.audit_logs
    where entidad='Cliente' and accion='Cliente creado'
      and a like '%P04 Invitado%'),
    'La rama pública auditó el nombre del cliente (PII en audit_logs).';
  -- Tracking emitido.
  assert exists(select 1 from public.order_tracking_tokens
    where order_id=v_order and estado='Activo'),
    'No se emitió el token de tracking.';
  insert into p04_ids
  select 'token_feliz',token::text from public.order_tracking_tokens
    where order_id=v_order and estado='Activo';
end $$;

-- 3) Idempotencia total: replay del MISMO evento, evento NUEVO del mismo pago
--    y llamada directa — siempre el MISMO pedido.
do $$
declare v_pid uuid; v_r jsonb; v_order text; v_pedidos integer;
begin
  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_pid:=(select valor from p04_ids where clave='pago_feliz')::uuid;
  v_order:=(select valor from p04_ids where clave='order_feliz');

  v_r:=pg_temp._p04_webhook(v_pid,'EV-FELIZ-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert coalesce((v_r->>'replay')::boolean,false),
    'El replay del mismo evento no fue detectado.';

  v_r:=pg_temp._p04_webhook(v_pid,'EV-FELIZ-2','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert coalesce((v_r->>'ok')::boolean,false)
    and coalesce(v_r->>'order_id',v_r->>'resultado') like '%'||v_order||'%',
    'Una re-notificación con evento nuevo no devolvió el mismo pedido.';

  v_r:=public.crear_pedido_publico_v1(jsonb_build_object(
    'quote_id',(select valor from p04_ids where clave='q_feliz')::uuid));
  assert coalesce((v_r->>'ok')::boolean,false)
    and coalesce((v_r->>'reused')::boolean,false)
    and v_r->>'order_id'=v_order,
    'La llamada directa no reusó el pedido idempotente.';

  select count(*) into v_pedidos from public.orders
    where idempotency_key=public._pide_uuid5(v_pid::text)::text;
  assert v_pedidos=1,'La key determinística produjo más de un pedido.';
end $$;

-- 4) Firma inválida: el evento queda registrado SIN efectos.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),1);
  perform pg_temp._p04_checkout(v_q,'3159990002');
  v_pid:=pg_temp._p04_intent(v_q);
  insert into p04_ids values('q_firma',v_q::text),('pago_firma',v_pid::text);

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-FIRMA-1','Aprobado',
    (select monto from public.payments where id=v_pid),false);
  assert coalesce((v_r->>'ok')::boolean,true)=false
    and v_r->>'error'='FIRMA_INVALIDA',
    'La firma inválida no fue rechazada.';
  assert (select estado from public.payments where id=v_pid)='Iniciado',
    'Un evento sin firma movió el estado del pago.';
  assert exists(select 1 from public.payment_events
    where payment_id=v_pid and external_event_id='EV-FIRMA-1' and not firma_ok),
    'El evento sin firma no quedó registrado como evidencia.';
  v_r:=public.crear_pedido_publico_v1(jsonb_build_object('quote_id',v_q));
  assert v_r->>'error'='PAGO_NO_CONFIRMADO',
    'crear_pedido_publico aceptó un pago no aprobado.';
end $$;

-- 5) Monto distinto: el pago se sella Aprobado (verdad del dinero) pero el
--    pedido queda BLOQUEADO — conciliación, jamás un pedido que no reproduce
--    lo cobrado.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),1);
  perform pg_temp._p04_checkout(v_q,'3159990003');
  v_pid:=pg_temp._p04_intent(v_q);

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-MONTO-1','Aprobado',
    (select monto from public.payments where id=v_pid)+1000);
  assert v_r->>'resultado' like 'aprobado_monto_distinto%',
    'El monto distinto no fue detectado: '||coalesce(v_r->>'resultado','?');
  assert (select estado from public.payments where id=v_pid)='Aprobado',
    'La verdad del dinero (Aprobado) no quedó sellada.';
  assert not exists(select 1 from public.orders
    where idempotency_key=public._pide_uuid5(v_pid::text)::text),
    'Se creó un pedido con monto divergente.';
  -- La vía directa también queda bloqueada por el gate de monto exacto.
  v_r:=public.crear_pedido_publico_v1(jsonb_build_object('quote_id',v_q));
  assert v_r->>'error'='EVIDENCIA_INSUFICIENTE',
    'crear_pedido_publico ignoró el gate de monto exacto.';
end $$;

-- 6) Rechazado: el intent cierra y el hold vuelve EXACTO a su expira_original.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb; v_h public.checkout_holds%rowtype;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),1);
  perform pg_temp._p04_checkout(v_q,'3159990004');
  v_pid:=pg_temp._p04_intent(v_q);
  select * into v_h from public.checkout_holds where quote_id=v_q and estado='Temporal';
  assert v_h.extendido_por_pago_at is not null and v_h.expira_at>v_h.expira_original,
    'El intent no extendió el hold (fixture del bloque roto).';

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-RECH-1','Rechazado',null);
  assert v_r->>'resultado' like 'intent_cerrado%',
    'El rechazo no cerró el intent: '||coalesce(v_r->>'resultado','?');
  assert (select estado from public.payments where id=v_pid)='Rechazado',
    'El pago no quedó Rechazado.';
  select * into v_h from public.checkout_holds where quote_id=v_q and estado='Temporal';
  assert v_h.expira_at=v_h.expira_original and v_h.extendido_por_pago_at is null,
    'El hold no volvió a su expira_original tras el rechazo.';
end $$;

-- 7) Hold Temporal VENCIDO pero no liberado: la promoción lo respeta (sus
--    descuentos siguen vigentes) — cero re-FIFO, cero doble descuento.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb; v_order text; v_stock numeric;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo2'),1);
  perform pg_temp._p04_checkout(v_q,'3159990005');
  v_pid:=pg_temp._p04_intent(v_q);
  -- Backdate coherente (patrón P03): el guard sella expira_at en operación —
  -- se suspende SOLO para el backdate y se re-arma de inmediato.
  alter table public.checkout_holds disable trigger checkout_holds_guard;
  update public.checkout_holds
    set expira_original=clock_timestamp()-interval '30 minutes',
        expira_at=clock_timestamp()-interval '10 minutes'
    where quote_id=v_q and estado='Temporal';
  alter table public.checkout_holds enable trigger checkout_holds_guard;
  assert exists(select 1 from public.checkout_holds
    where quote_id=v_q and estado='Temporal' and expira_at<=clock_timestamp()),
    'El fixture no dejó un hold Temporal vencido.';
  select stock into v_stock from public.products
    where id=(select valor from p04_ids where clave='momo2');

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-VENC-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert v_r->>'resultado' like 'pedido_creado:%',
    'El webhook no creó pedido con hold vencido-no-liberado: '||coalesce(v_r->>'resultado','?');
  v_order:=v_r->>'order_id';
  assert (select estado from public.checkout_holds where quote_id=v_q)='Confirmada',
    'El hold vencido-no-liberado no fue promovido.';
  assert (select stock from public.products
    where id=(select valor from p04_ids where clave='momo2'))=v_stock,
    'La promoción del hold vencido re-descontó stock.';
  assert exists(select 1 from public.inventory_reservations
    where order_id=v_order and batch_id=(select valor from p04_ids where clave='lote_b')),
    'La promoción no conservó el lote exacto del hold.';
end $$;

-- 8) Hold LIBERADO (Expirada): el core re-toma TODO con FIFO vivo y el
--    faltante — si lo hay — es EXPLÍCITO, jamás silencioso.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb; v_order text; v_stock_libre numeric;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo2'),1);
  perform pg_temp._p04_checkout(v_q,'3159990006');
  v_pid:=pg_temp._p04_intent(v_q);
  -- Backdate coherente (patrón P03) para poder liberar de verdad.
  alter table public.checkout_holds disable trigger checkout_holds_guard;
  update public.checkout_holds
    set expira_original=clock_timestamp()-interval '30 minutes',
        expira_at=clock_timestamp()-interval '10 minutes'
    where quote_id=v_q and estado='Temporal';
  alter table public.checkout_holds enable trigger checkout_holds_guard;
  -- Liberación real (job): devuelve stock y deja el hold Expirada.
  perform public._pide_liberar_holds_vencidos(null);
  assert (select estado from public.checkout_holds where quote_id=v_q)='Expirada',
    'La liberación no expiró el hold del fixture.';
  select stock into v_stock_libre from public.products
    where id=(select valor from p04_ids where clave='momo2');

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-LIB-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert v_r->>'resultado' like 'pedido_creado:%',
    'El webhook no creó pedido tras hold liberado: '||coalesce(v_r->>'resultado','?');
  v_order:=v_r->>'order_id';
  assert (select inventario_reservado from public.orders where id=v_order),
    'El pedido re-tomado no quedó con inventario reservado.';
  assert (select stock from public.products
    where id=(select valor from p04_ids where clave='momo2'))=v_stock_libre-1,
    'El core no re-tomó el stock tras la liberación del hold.';
  assert exists(select 1 from public.inventory_reservations
    where order_id=v_order and tipo='producto'),
    'La re-toma no dejó reservas.';
end $$;

-- 8b) Beneficio producto_gratis por Pide: el regalo REAL del dominio es un
--     producto tipo 'pedido' (malteadas/antojos — la guarda H90 bloquea
--     regalar momos Signature sin figura/sabor en TODOS los canales, staff
--     incluido; verificado vivo 2026-07-22). El ítem regalo entra al pedido,
--     el beneficio se consume, y tipo 'pedido' NO aparta stock (igual que el
--     staff: se prepara al momento). El leg espejo _pide_reservar_item_regalo
--     queda instalado para el día en que un regalo momo lleve figura/sabor.
do $$
declare
  v_q uuid; v_pid uuid; v_r jsonb; v_order text;
  v_gift_prod text; v_gift record;
begin
  select id into v_gift_prod from public.products
    where activo and tipo='pedido' order by id limit 1;
  if v_gift_prod is null then
    raise notice 'P04 regalo E2E: sin producto tipo pedido activo; bloque saltado (cobertura reducida).';
    return;
  end if;
  perform set_config('request.jwt.claims','',true);
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,producto_gratis_id)
  values('P04-BG-'||(select valor from p04_ids where clave='sfx'),
    (select valor from p04_ids where clave='cliente'),
    'P04 regalo','producto_gratis',v_gift_prod);

  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),1);
  assert (select benefit_id from public.quotes where id=v_q)
    ='P04-BG-'||(select valor from p04_ids where clave='sfx'),
    'La quote no tomó el beneficio de regalo.';

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform pg_temp._p04_checkout(v_q,'3159990007');
  v_pid:=pg_temp._p04_intent(v_q);

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-GIFT-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert v_r->>'resultado' like 'pedido_creado:%',
    'El webhook con regalo no creó pedido: '||coalesce(v_r->>'resultado','?');
  v_order:=v_r->>'order_id';

  select * into v_gift from public.order_items
    where order_id=v_order and precio=0 and nombre like '% (beneficio)';
  assert v_gift.id is not null and v_gift.product_id=v_gift_prod,
    'El pedido no incluye el ítem regalo.';
  -- tipo 'pedido' se prepara al momento: cero reservas para el regalo (paridad
  -- staff — sus insumos se descuentan recién en [En producción]).
  assert not exists(select 1 from public.inventory_reservations
    where order_id=v_order and product_id=v_gift_prod),
    'Un regalo tipo pedido no debe apartar stock.';
  assert (select estado from public.benefits
    where id='P04-BG-'||(select valor from p04_ids where clave='sfx'))='Usado'
    and (select pedido_uso from public.benefits
      where id='P04-BG-'||(select valor from p04_ids where clave='sfx'))=v_order,
    'El beneficio de regalo no terminó Usado con pedido_uso sellado.';
  -- El total sigue reproduciendo lo cobrado (el regalo vale 0).
  assert (select coalesce(t.ventas,0)-o.descuento+o.dom_cobrado
      from public.orders o join public.v_order_totals t on t.order_id=o.id
      where o.id=v_order)=(select monto from public.payments where id=v_pid),
    'El regalo alteró el total del pedido.';
end $$;

-- 8c) Combo end-to-end por Pide: rama de combo del core sellado + pata de
--     empaque descontada y reservada. (Se salta con aviso si la base no tiene
--     un combo que admita ambas figuras del fixture.)
do $$
declare
  v_combo record; v_q jsonb; v_qid uuid; v_pid uuid; v_r jsonb; v_order text;
  v_slots jsonb:='[]'::jsonb; v_emp_stock numeric; v_emp_id text;
  i integer; v_qtotal numeric;
begin
  select p.id,p.nombre,p.combo_size,p.empaque_item_id into v_combo
  from public.products p
  where p.tipo='combo' and p.activo and p.empaque_item_id is not null
    and p.combo_size between 2 and 6
    and exists(select 1 from public.combo_components cc where cc.combo_id=p.id
      and cc.component_id=(select valor from p04_ids where clave='momo'))
    and exists(select 1 from public.combo_components cc where cc.combo_id=p.id
      and cc.component_id=(select valor from p04_ids where clave='momo2'))
  order by p.combo_size, p.id limit 1;
  if v_combo.id is null then
    raise notice 'P04 combo E2E: sin combo elegible con ambas figuras del fixture; bloque saltado (cobertura reducida).';
    return;
  end if;
  perform set_config('request.jwt.claims','',true);
  update public.products set precio_pide=99000 where id=v_combo.id;
  v_emp_id:=v_combo.empaque_item_id;
  update public.inventory_items set stock=greatest(coalesce(stock,0),5) where id=v_emp_id;
  select stock into v_emp_stock from public.inventory_items where id=v_emp_id;
  for i in 1..v_combo.combo_size loop
    v_slots:=v_slots||jsonb_build_object(
      'figura',(select valor from p04_ids where clave=
        case when i%2=1 then 'figura' else 'figura2' end),
      'sabor',(select valor from p04_ids where clave='sabor'),
      'salsa',(select valor from p04_ids where clave='salsa'));
  end loop;

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_combo.id,'cantidad',1,'boxes',jsonb_build_array(v_slots))),
    'zona',(select valor from p04_ids where clave='zona'),
    'franja',(select valor from p04_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q->>'ok')::boolean,false),
    'cotizar combo falló: '||coalesce(v_q->>'error','?')||' '||coalesce(v_q->>'mensaje','');
  v_qid:=(v_q->>'quote_id')::uuid;
  v_qtotal:=(v_q->>'total')::numeric;
  perform pg_temp._p04_checkout(v_qid,'3159990008');
  v_pid:=pg_temp._p04_intent(v_qid);

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-COMBO-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert v_r->>'resultado' like 'pedido_creado:%',
    'El webhook del combo no creó pedido: '||coalesce(v_r->>'resultado','?');
  v_order:=v_r->>'order_id';

  assert (select count(*) from public.order_items where order_id=v_order and es_caja)=1
    and (select count(*) from public.order_items
      where order_id=v_order and es_sub_momo)=v_combo.combo_size,
    'El combo Pide no armó padre + hijas exactas.';
  assert (select coalesce(t.ventas,0)-o.descuento+o.dom_cobrado
      from public.orders o join public.v_order_totals t on t.order_id=o.id
      where o.id=v_order)=v_qtotal
    and v_qtotal=(select monto from public.payments where id=v_pid),
    'El total del combo no reproduce lo cobrado.';
  assert (select stock from public.inventory_items where id=v_emp_id)=v_emp_stock-1,
    'La pata de empaque no descontó inventario.';
  assert exists(select 1 from public.inventory_reservations
    where order_id=v_order and tipo='empaque' and item_id=v_emp_id),
    'La pata de empaque no dejó reserva.';
end $$;

-- 8d) Invariante de dinero AISLADO: una quote saboteada (línea que no cuadra
--     con el total) revienta el pedido, y el evento + pago Aprobado SOBREVIVEN
--     como cola de conciliación — jamás un pedido con total ≠ lo cobrado.
do $$
declare v_q uuid; v_pid uuid; v_r jsonb;
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p04_cotizar((select valor from p04_ids where clave='momo'),1);
  perform pg_temp._p04_checkout(v_q,'3159990009');
  v_pid:=pg_temp._p04_intent(v_q);
  -- Sabotaje directo post-intent (imposible por superficie pública): la línea
  -- congelada deja de cuadrar con quotes.total.
  perform set_config('request.jwt.claims','',true);
  update public.quotes set lineas=(
    select jsonb_agg(case when l->>'tipo'='producto'
      then jsonb_set(l,'{precio_unit}',to_jsonb(((l->>'precio_unit')::numeric)+1000))
      else l end)
    from jsonb_array_elements(lineas) l) where id=v_q;

  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook(v_pid,'EV-DIV-1','Aprobado',
    (select monto from public.payments where id=v_pid));
  assert v_r->>'resultado' like 'pedido_pendiente_conciliar:%',
    'La divergencia de total no fue aislada: '||coalesce(v_r->>'resultado','?');
  assert (select estado from public.payments where id=v_pid)='Aprobado'
    and exists(select 1 from public.payment_events
      where payment_id=v_pid and external_event_id='EV-DIV-1')
    and not exists(select 1 from public.orders
      where idempotency_key=public._pide_uuid5(v_pid::text)::text),
    'El sub-bloque aislado no preservó evento+pago o dejó un pedido divergente.';
end $$;

-- 9) Staff: el canal Pide queda PROHIBIDO a mano y el flujo staff clásico
--    sigue INTACTO (regresión del núcleo).
do $$
declare v_r jsonb; v_order text; v_err boolean:=false;
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  -- staff jamás fabrica un pedido Pide
  begin
    perform public.crear_pedido(jsonb_build_object(
      'canal','Pide','customer_id',(select valor from p04_ids where clave='cliente'),
      'zona',(select valor from p04_ids where clave='zona'),
      'pago','Pasarela (web)',
      'lineas',jsonb_build_array(jsonb_build_object(
        'product_id',(select valor from p04_ids where clave='momo'),
        'cant',1,
        'figura',(select valor from p04_ids where clave='figura'),
        'sabor',(select valor from p04_ids where clave='sabor'),
        'salsa',(select valor from p04_ids where clave='salsa')))));
  exception when others then v_err:=true; end;
  assert v_err,'Staff pudo fabricar un pedido canal Pide.';

  -- flujo staff clásico: crear + transición simple — intacto.
  -- cant 2: el precio staff (products.precio) debe superar el pedido_minimo
  -- global — que el core lo siga validando es parte de la regresión.
  v_r:=public.crear_pedido(jsonb_build_object(
    'canal','WhatsApp','customer_id',(select valor from p04_ids where clave='cliente'),
    'zona',(select valor from p04_ids where clave='zona'),
    'pago','Nequi',
    'lineas',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p04_ids where clave='momo'),
      'cant',2,
      'figura',(select valor from p04_ids where clave='figura'),
      'sabor',(select valor from p04_ids where clave='sabor'),
      'salsa',(select valor from p04_ids where clave='salsa')))));
  v_order:=v_r->>'order_id';
  assert v_order is not null,'El flujo staff clásico dejó de crear pedidos.';
  assert (select fecha_entrega from public.orders where id=v_order) is null
    and (select franja from public.orders where id=v_order) is null,
    'Un pedido staff ocupó franja (fecha_entrega/franja deben ser NULL).';
  v_r:=public.set_order_status(v_order,'Confirmado',false);
  assert coalesce((v_r->>'ok')::boolean,false),'set_order_status staff dejó de operar.';
  -- el gate clásico de comprobante sigue vivo para canales staff
  v_err:=false;
  begin
    perform public.set_order_status(v_order,'Pagado',false);
  exception when others then v_err:=true; end;
  assert v_err,'Staff marcó Pagado sin comprobante (gate clásico roto).';
  insert into p04_ids values('order_staff',v_order);
end $$;

-- 9b) Gate [Pagado] por canal: un pedido Pide plantado sin evento firmado
--     JAMÁS se marca Pagado, ni siquiera por un Administrador.
do $$
declare v_order text; v_err boolean:=false;
begin
  -- fixture directo (sin superficie pública): canal Pide exige fecha+franja
  perform set_config('request.jwt.claims','',true);
  v_order:='P04-GATE-'||(select valor from p04_ids where clave='sfx');
  insert into public.orders(id,fecha,hora,canal,customer_id,zona,franja,
    fecha_entrega,dom_cobrado,dom_costo,descuento,pago,estado)
  values(v_order,current_date,'10:00','Pide',
    (select valor from p04_ids where clave='cliente'),
    (select valor from p04_ids where clave='zona'),
    (select valor from p04_ids where clave='franja'),
    current_date+2,6000,0,0,'Pasarela (web)','Nuevo');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  begin
    perform public.set_order_status(v_order,'Pagado',false);
  exception when others then v_err:=true; end;
  assert v_err,'Un pedido Pide sin evento firmado se marcó Pagado.';
end $$;

-- 10) Tracking público: mapping completo, Reclamo conserva el último estado
--     logístico, Cancelado distingue el reembolso y post-Entregado degrada.
do $$
declare v_tok uuid; v_r jsonb; v_order text;
begin
  v_tok:=(select valor from p04_ids where clave='token_feliz')::uuid;
  v_order:=(select valor from p04_ids where clave='order_feliz');

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert coalesce((v_r->>'ok')::boolean,false) and v_r->>'estado'='Pago confirmado'
    and v_r->>'fecha_entrega' is not null and v_r->>'franja' is not null,
    'El tracking del pedido pagado no responde su estado.';
  assert v_r->'privacy'->>'pseudonymous'='true'
    and (v_r ? 'order_id') is false,
    'El tracking expone más de lo permitido (order_id o privacidad mal etiquetada).';
  -- token inexistente: mismo shape de error (anti-oráculo)
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',gen_random_uuid()));
  assert v_r->>'error'='TOKEN_INVALIDO','Un token inexistente reveló otra cosa.';

  -- Reclamo: el público sigue viendo el último estado logístico.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  perform public.set_order_status(v_order,'Reclamo',false);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert v_r->>'estado'='Pago confirmado',
    'El Reclamo alteró el estado público (debe conservar el logístico).';

  -- Cancelado: reembolso en proceso → realizado según payments.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',(select valor from p04_ids where clave='admin_auth'))::text,true);
  perform public.set_order_status(v_order,'Cancelado',false);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert v_r->>'estado'='Cancelado — reembolso en proceso',
    'El cancelado con pago aprobado no anuncia el reembolso en proceso.';
  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_r:=pg_temp._p04_webhook((select valor from p04_ids where clave='pago_feliz')::uuid,
    'EV-REEM-1','Reembolso',null);
  assert v_r->>'resultado' like 'reembolso_registrado%',
    'El reembolso no quedó registrado: '||coalesce(v_r->>'resultado','?');
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert v_r->>'estado'='Cancelado — reembolso realizado',
    'El reembolso realizado no se refleja en el tracking.';

  -- Degradación + expiración perezosa post-Entregado.
  perform set_config('request.jwt.claims','',true);
  update public.orders set estado='Entregado' where id=v_order;
  update public.app_settings set valor=to_jsonb(0) where clave='pide_tracking_expira_dias';
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert coalesce((v_r->>'ok')::boolean,false) and (v_r->>'entregado')::boolean
    and (v_r ? 'fecha_entrega') is false and (v_r ? 'zona') is false,
    'El tracking post-Entregado no degradó (expone zona/franja/fecha).';
  v_r:=public.tracking_publico_v1(jsonb_build_object('token',v_tok));
  assert v_r->>'error'='TOKEN_INVALIDO',
    'El token no expiró tras la ventana post-entrega.';
  assert (select estado from public.order_tracking_tokens where token=v_tok)='Expirado',
    'El token expirado no quedó sellado.';
  update public.app_settings set valor=to_jsonb(14) where clave='pide_tracking_expira_dias';
end $$;

-- 11) RBAC dinámico: nadie más que pide_service entra a la superficie de
--     servicio — ni anon, ni authenticated, ni service_role, ni sin claims.
do $$
declare v_err boolean; v_claims text;
begin
  foreach v_claims in array array[
    '{"role":"anon"}','{"role":"authenticated"}','{"role":"service_role"}',''
  ] loop
    perform set_config('request.jwt.claims',v_claims,true);
    v_err:=false;
    begin
      perform public.crear_pedido_publico_v1(jsonb_build_object('quote_id',gen_random_uuid()));
    exception when others then v_err:=true; end;
    assert v_err,'crear_pedido_publico_v1 aceptó claims '||coalesce(nullif(v_claims,''),'(vacíos)');
    v_err:=false;
    begin
      perform public.registrar_evento_pago_v1(jsonb_build_object('payment_id',gen_random_uuid()));
    exception when others then v_err:=true; end;
    assert v_err,'registrar_evento_pago_v1 aceptó claims '||coalesce(nullif(v_claims,''),'(vacíos)');
  end loop;
end $$;

-- 12) Requisito 3 como invariante de DATOS: un pedido Pide sin fecha_entrega
--     o sin franja revienta en el constraint, no en una promesa de RPC.
do $$
declare v_err boolean:=false;
begin
  perform set_config('request.jwt.claims','',true);
  begin
    insert into public.orders(id,fecha,hora,canal,customer_id,zona,
      dom_cobrado,dom_costo,descuento,pago,estado)
    values('P04-SINF-'||(select valor from p04_ids where clave='sfx'),
      current_date,'10:00','Pide',
      (select valor from p04_ids where clave='cliente'),
      (select valor from p04_ids where clave='zona'),
      6000,0,0,'Pasarela (web)','Nuevo');
  exception when check_violation then v_err:=true; end;
  assert v_err,'orders_pide_entrega_check no bloqueó un Pide sin fecha_entrega/franja.';
end $$;

-- 13) uuid5 determinístico: mismo input ⇒ mismo uuid; formato v5; inputs
--     distintos ⇒ uuids distintos.
do $$
begin
  assert public._pide_uuid5('a')=public._pide_uuid5('a'),'uuid5 no es determinístico.';
  assert public._pide_uuid5('a')<>public._pide_uuid5('b'),'uuid5 colisiona trivialmente.';
  assert public._pide_uuid5('a')::text ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    'uuid5 no respeta versión/variante.';
end $$;

-- 14) El evento con evento_ts futuro se rechaza (sanidad de reloj).
do $$
declare v_pid uuid; v_r jsonb;
begin
  perform set_config('request.jwt.claims','{"role":"pide_service"}',true);
  v_pid:=(select valor from p04_ids where clave='pago_firma')::uuid;
  v_r:=public.registrar_evento_pago_v1(jsonb_build_object(
    'payment_id',v_pid,'external_event_id','EV-FUTURO-1',
    'tipo','Aprobado','estado_reportado','approved',
    'monto_reportado',(select monto from public.payments where id=v_pid),
    'firma_ok',true,'key_id','k1',
    'payload_hash',encode(sha256('P04:futuro'::bytea),'hex'),
    'evento_ts',(clock_timestamp()+interval '1 hour')::text));
  assert v_r->>'error'='ENTRADA_INVALIDA',
    'Un evento_ts futuro fue aceptado.';
end $$;

select 'TESTS_OK P04'::text as resultado;

rollback;
