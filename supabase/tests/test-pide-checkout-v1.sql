-- MOMOS · Carril Pide · prueba adversarial P03 pide-checkout. Siempre ROLLBACK.
-- Requiere una base con la cadena OPS + P01 + P02 + P03 y dominio canónico
-- vivo: al menos DOS productos momo activos con figura canónica activa y un
-- sabor canónico en catalog_values (los mismos supuestos de P02).
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_pide_test_p03'));

-- 0) Ledger y RBAC estructural: las DOS RPC nuevas son la única superficie.
do $$
declare v_rol text; v_priv text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_p03_pide_checkout'),'Falta P03 en el ledger.';
  assert has_function_privilege('anon','public.reservar_checkout_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.reservar_checkout_v1(jsonb)','EXECUTE')
    and has_function_privilege('anon','public.iniciar_pago_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.iniciar_pago_v1(jsonb)','EXECUTE'),
    'P03 no expuso reservar/iniciar_pago a anon/authenticated.';
  assert not has_function_privilege('service_role','public.reservar_checkout_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.iniciar_pago_v1(jsonb)','EXECUTE'),
    'service_role no debe tener la superficie pública del checkout.';
  foreach v_rol in array array['anon','authenticated','service_role'] loop
    assert not has_function_privilege(v_rol,
      'public._pide_liberar_holds_interno(text[],uuid[],text[])','EXECUTE'),
      'El núcleo de liberación quedó expuesto a '||v_rol;
    assert not has_function_privilege(v_rol,
      'public._pide_asignar_hold_fifo(uuid,text,text,text,integer)','EXECUTE'),
      'El FIFO del hold quedó expuesto a '||v_rol;
    assert not has_function_privilege(v_rol,
      'public._pide_liberar_holds_vencidos(text)','EXECUTE'),
      'La envoltura de liberación quedó expuesta a '||v_rol;
    assert not has_function_privilege(v_rol,
      'public._pide_setting_num(text,numeric)','EXECUTE'),
      '_pide_setting_num quedó expuesto a '||v_rol;
    assert not has_function_privilege(v_rol,
      'public._pide_error(text,text,text)','EXECUTE'),
      '_pide_error/3 quedó expuesto a '||v_rol;
  end loop;
  -- La firma P01 sobrevive (la usan purga y tests P01) y delega en el núcleo.
  assert to_regprocedure('public._pide_liberar_holds_vencidos(text)') is not null
    and position('_pide_liberar_holds_interno' in pg_get_functiondef(
      'public._pide_liberar_holds_vencidos(text)'::regprocedure))>0,
    'La envoltura P01 de liberación no delega en el núcleo P03.';
  -- El cableado staff quedó instalado.
  assert position('_pide_liberar_holds_interno' in pg_get_functiondef(
      'public._reserve_inventory(text)'::regprocedure))>0,
    '_reserve_inventory no quedó cableado a la liberación perezosa.';
  -- Seeds técnicos presentes; la pasarela NO se siembra (fail closed).
  assert exists(select 1 from public.app_settings where clave='pide_rate_limit_checkout')
    and exists(select 1 from public.app_settings where clave='pide_rate_limit_pago'),
    'Faltan los seeds de rate limit de P03.';
end $$;

-- Contexto compartido (ids como texto; siempre rollback).
create temporary table p03_ids(clave text primary key,valor text not null) on commit drop;
grant select on table p03_ids to anon,authenticated,service_role;

do $$
declare
  v_sfx text:=pg_backend_pid()::text||'-'||(extract(epoch from clock_timestamp())::bigint%100000)::text;
  v_admin public.users%rowtype;
  v_momo text; v_figura text;
  v_momo2 text; v_figura2 text;
  v_sabor text; v_sabor_cat text; v_salsa text;
  v_cliente text;
  v_tel text:='315'||lpad(((extract(epoch from clock_timestamp())::bigint)%10000000)::text,7,'0');
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'P03 necesita un Administrador autenticado en la base.';
  insert into p03_ids values('sfx',v_sfx),('admin_auth',v_admin.auth_id::text);

  -- DOS productos momo con figura canónica activa (lección H90, patrón P02).
  select f.product_id,f.nombre into v_momo,v_figura
    from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and p.activo and p.tipo='momo'
    order by f.product_id,f.orden limit 1;
  assert v_momo is not null,'P03 necesita una figura canónica activa (H90).';
  select f.product_id,f.nombre into v_momo2,v_figura2
    from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and p.activo and p.tipo='momo' and f.product_id<>v_momo
    order by f.product_id,f.orden limit 1;
  assert v_momo2 is not null,'P03 necesita un segundo momo con figura canónica activa.';

  select valor,categoria into v_sabor,v_sabor_cat from public.catalog_values
    where activo and categoria like 'sabor_%' order by categoria,orden,valor limit 1;
  select valor into v_salsa from public.catalog_values
    where activo and categoria='salsa' order by orden,valor limit 1;
  assert v_sabor is not null and v_salsa is not null,
    'P03 necesita sabor y salsa canónicos activos.';
  -- Sabor canónico EXTRA sin lote (para el todo-o-nada); rollback lo retira.
  insert into public.catalog_values(categoria,valor,activo,orden)
  values(v_sabor_cat,'P03 Sabor '||v_sfx,true,999);

  -- Lotes DETERMINISTAS: se neutralizan los existentes de ambos productos y se
  -- instala un lote propio por producto con el sabor canónico del test.
  update public.production_batches set stock_contabilizado=false
    where product_id in (v_momo,v_momo2) and stock_contabilizado;
  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values
    ('P03-LA-'||v_sfx,current_date,v_momo,v_figura,v_sabor,180,10,10,0,0,
     'Listo',true,clock_timestamp(),6),
    ('P03-LB-'||v_sfx,current_date,v_momo2,v_figura2,v_sabor,180,1,1,0,0,
     'Listo',true,clock_timestamp(),6);
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas)
  values('P03-LA-'||v_sfx,v_figura,10,10,0,0,0),
        ('P03-LB-'||v_sfx,v_figura2,1,1,0,0,0);
  -- Lote VENCIDO del mismo producto/figura/sabor: por el ORDER BY compartido
  -- (vencimiento asc) sería el PRIMER candidato del FIFO — el espejo de
  -- vigencia debe excluirlo de cobertura y de asignación. Si algún hold lo
  -- toma, los asserts exactos sobre lote_a de los bloques 2-7 revientan.
  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias,vencimiento
  ) values
    ('P03-LV-'||v_sfx,current_date-10,v_momo,v_figura,v_sabor,180,5,5,0,0,
     'Listo',true,clock_timestamp()-interval '10 days',6,current_date-1);
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas)
  values('P03-LV-'||v_sfx,v_figura,5,5,0,0,0);
  update public.products set precio_pide=48000, stock=10, pide_hold_fraccion=null
    where id=v_momo;
  update public.products set precio_pide=30000, stock=1, pide_hold_fraccion=null
    where id=v_momo2;

  insert into public.zonas(nombre,tarifa,sede_id)
  values('P03 Zona '||v_sfx,6000,(select sede_id from public.zonas order by nombre limit 1));
  insert into public.franjas(nombre,hora_inicio,hora_fin,cupo,activo)
  values('P03 Franja '||v_sfx,'10:00','12:00',50,true);

  select id into v_cliente from public.customers where auth_id=v_admin.auth_id limit 1;
  if v_cliente is null then
    v_cliente:='P03-C-'||v_sfx;
    insert into public.customers(id,nombre,telefono,canal,auth_id)
    values(v_cliente,'P03 cliente',v_tel,'Pide',v_admin.auth_id);
  end if;
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor)
  values('P03-B-'||v_sfx,v_cliente,'P03 descuento','descuento_valor_fijo',5000);

  insert into p03_ids values
    ('momo',v_momo),('figura',v_figura),
    ('momo2',v_momo2),('figura2',v_figura2),
    ('sabor',v_sabor),('sabor_sin_lote','P03 Sabor '||v_sfx),('salsa',v_salsa),
    ('lote_a','P03-LA-'||v_sfx),('lote_b','P03-LB-'||v_sfx),
    ('lote_v','P03-LV-'||v_sfx),
    ('zona','P03 Zona '||v_sfx),('franja','P03 Franja '||v_sfx),
    ('cliente',v_cliente),('benefit','P03-B-'||v_sfx),
    ('tel1','3150000001'),('tel2','3150000002'),('tel3','3150000003'),
    ('tel4','3150000004'),('tel5','3150000005');

  -- Margen del rate limit durante el test (patrón P02); el bloque 11 lo baja.
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_ip';
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_checkout';
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_pago';
  -- El seed de pasarela NO debe existir todavía (el bloque 9 lo introduce).
  delete from public.app_settings where clave='pide_pasarela_proveedor';
end $$;

-- Helper local: cotiza N unidades del producto dado y devuelve el quote_id.
create function pg_temp._p03_cotizar(p_prod text, p_cant integer, p_sabor text)
returns uuid
language plpgsql
as $$
declare v_q jsonb;
begin
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',p_prod,'cantidad',p_cant,
      'figura',(select valor from p03_ids where clave=
        case when p_prod=(select valor from p03_ids where clave='momo')
          then 'figura' else 'figura2' end),
      'sabor',p_sabor,
      'salsa',(select valor from p03_ids where clave='salsa'))),
    'zona',(select valor from p03_ids where clave='zona'),
    'franja',(select valor from p03_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q->>'ok')::boolean,false),
    'La cotización del fixture falló: '||coalesce(v_q->>'error','?');
  return (v_q->>'quote_id')::uuid;
end $$;

-- Helper local: payload de checkout con teléfono variable.
create function pg_temp._p03_datos(p_quote uuid, p_tel text)
returns jsonb
language sql
as $$
  select jsonb_build_object('quote_id',p_quote,'nombre','P03 Invitado',
    'telefono',p_tel,'direccion','Calle 1 # 2-33','barrio','Centro',
    'referencia','Portón azul')
$$;

-- 1) EXECUTE real bajo anon: la validación corta sin internals.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
begin
  assert (public.reservar_checkout_v1('{}'::jsonb)->>'error')='ENTRADA_INVALIDA',
    'reservar_checkout_v1 no ejecutó bajo el rol anon real.';
  assert (public.iniciar_pago_v1('{}'::jsonb)->>'error')='ENTRADA_INVALIDA',
    'iniciar_pago_v1 no ejecutó bajo el rol anon real.';
end $$;
reset role;
-- Del bloque 2 en adelante el rol REAL es el dueño (los asserts leen tablas
-- deny-all y mutan fixtures — lección de P01/P02); la identidad pública viaja
-- en el claim y las RPC son SECURITY DEFINER: el camino de código es idéntico.
select set_config('request.jwt.claims','{"role":"anon"}',true);

-- 2) Hold feliz TODO-O-NADA: FIFO exacto, stock/lote descontados, sesión
--    escrita y CERO líneas con batch_id null (requisito sellado 1).
do $$
declare
  v_q uuid; v_r jsonb; v_hold public.checkout_holds%rowtype;
  v_momo text:=(select valor from p03_ids where clave='momo');
  v_tel text:=(select valor from p03_ids where clave='tel1');
begin
  v_q:=pg_temp._p03_cotizar(v_momo,2,(select valor from p03_ids where clave='sabor'));
  insert into p03_ids values('q1',v_q::text);
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,v_tel));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El hold feliz falló: '||coalesce(v_r->>'error','?');
  assert v_r->>'contract'='momos.pide.hold.v1'
    and (v_r->>'expira_at')::timestamptz>clock_timestamp()
    -- Anclado al setting vivo (+2 min de margen), no a la constante 7: si
    -- Jorge sube el TTL comercial el assert acompaña.
    and (v_r->>'expira_at')::timestamptz<clock_timestamp()+make_interval(
      mins=>2+coalesce((select (valor #>> '{}')::integer from public.app_settings
        where clave='pide_hold_ttl_minutos'),7)),
    'El hold no respetó contrato/TTL corto.';
  select * into v_hold from public.checkout_holds
    where quote_id=v_q and estado='Temporal';
  assert v_hold.id is not null
    and v_hold.actor_hmac=encode(sha256(('57'||v_tel)::bytea),'hex')
    and v_hold.extendido_por_pago_at is null
    and v_hold.expira_at=v_hold.expira_original,
    'El hold no nació con actor/expira coherentes.';
  assert (select coalesce(sum(cantidad),0) from public.checkout_hold_lotes
      where hold_id=v_hold.id)=2
    and not exists(select 1 from public.checkout_hold_lotes
      where hold_id=v_hold.id and batch_id is null)
    and (select count(distinct batch_id) from public.checkout_hold_lotes
      where hold_id=v_hold.id)=1
    and exists(select 1 from public.checkout_hold_lotes
      where hold_id=v_hold.id
        and batch_id=(select valor from p03_ids where clave='lote_a')),
    'El FIFO del hold no registró el lote exacto (o emitió batch_id null).';
  assert (select stock from public.products where id=v_momo)=8,
    'El hold no descontó products.stock.';
  assert (select consumidas from public.lote_figuras
      where batch_id=(select valor from p03_ids where clave='lote_a'))=2,
    'El hold no descontó lote_figuras.consumidas.';
  assert exists(select 1 from public.checkout_sessions
      where quote_id=v_q and telefono='57'||v_tel and opt_in=false),
    'La sesión del invitado no quedó escrita (o preseleccionó opt_in).';
  insert into p03_ids values('hold1',v_hold.id::text);
end $$;

-- 3) Idempotencia por quote: repetir devuelve el MISMO hold sin doble
--    descuento (rama perdedora del UNIQUE parcial).
do $$
declare
  v_q uuid:=(select valor::uuid from p03_ids where clave='q1');
  v_r jsonb;
begin
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q,(select valor from p03_ids where clave='tel1')));
  assert coalesce((v_r->>'ok')::boolean,false)
    and (v_r->>'expira_at')::timestamptz=(select expira_at
      from public.checkout_holds
      where id=(select valor::uuid from p03_ids where clave='hold1')),
    'La repetición no devolvió el hold existente.';
  assert (select count(*) from public.checkout_holds
      where quote_id=v_q and estado='Temporal')=1
    and (select stock from public.products
      where id=(select valor from p03_ids where clave='momo'))=8,
    'La repetición duplicó el hold o re-descontó stock.';
end $$;

-- 4) Un checkout vivo por actor: el hold nuevo invalida el anterior y
--    devuelve su stock/lote exactamente una vez.
do $$
declare
  v_q2 uuid; v_r jsonb;
  v_momo text:=(select valor from p03_ids where clave='momo');
begin
  v_q2:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor'));
  insert into p03_ids values('q2',v_q2::text);
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q2,(select valor from p03_ids where clave='tel1')));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El segundo checkout del actor falló: '||coalesce(v_r->>'error','?');
  assert (select estado from public.checkout_holds
      where id=(select valor::uuid from p03_ids where clave='hold1'))='Expirada',
    'El hold anterior del actor no quedó invalidado.';
  -- neto: +2 devueltos del hold1, −1 del hold nuevo
  assert (select stock from public.products where id=v_momo)=9
    and (select consumidas from public.lote_figuras
      where batch_id=(select valor from p03_ids where clave='lote_a'))=1,
    'La invalidación del hold anterior no devolvió stock/lote exactos.';
  assert (select count(*) from public.checkout_holds
      where actor_hmac=encode(sha256(('57'||(select valor from p03_ids where clave='tel1'))::bytea),'hex')
        and estado='Temporal')=1,
    'El actor quedó con más de un checkout vivo.';
end $$;

-- 5) Tope anti-acaparamiento: fracción 0 apaga los holds del producto y la
--    respuesta es INDISTINGUIBLE del stock agotado; la última unidad de otro
--    producto SÍ es apartable (greatest(1,·)) y el segundo actor ya no entra.
do $$
declare
  v_q uuid; v_q2 uuid; v_r jsonb;
  v_momo text:=(select valor from p03_ids where clave='momo');
  v_momo2 text:=(select valor from p03_ids where clave='momo2');
begin
  update public.products set pide_hold_fraccion=0 where id=v_momo;
  v_q:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q,(select valor from p03_ids where clave='tel2')));
  assert v_r->>'error'='SIN_DISPONIBILIDAD',
    'Fracción 0 no apagó los holds del producto.';
  assert not exists(select 1 from public.checkout_holds h
      join public.quotes q on q.id=h.quote_id where q.id=v_q),
    'El tope dejó un hold residual.';
  update public.products set pide_hold_fraccion=null where id=v_momo;

  -- Última unidad (stock 1, fracción default 0.5 ⇒ tope greatest(1,0)=1):
  -- la carrera REAL exige que ambas quotes nazcan cuando aún hay stock (con
  -- stock 0 P02 ni cotiza — agotado); el primer actor aparta la última unidad
  -- y el segundo muere en el HOLD, indistinguible del agotado.
  v_q:=pg_temp._p03_cotizar(v_momo2,1,(select valor from p03_ids where clave='sabor'));
  v_q2:=pg_temp._p03_cotizar(v_momo2,1,(select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q,(select valor from p03_ids where clave='tel2')));
  assert coalesce((v_r->>'ok')::boolean,false),
    'La última unidad no fue apartable: '||coalesce(v_r->>'error','?');
  assert (select stock from public.products where id=v_momo2)=0,
    'La última unidad no descontó stock.';
  insert into p03_ids values('q_ultima',v_q::text);

  -- Doble hold sobre la última unidad (otro actor, quote pre-existente).
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q2,(select valor from p03_ids where clave='tel3')));
  assert v_r->>'error'='SIN_DISPONIBILIDAD',
    'Dos actores apartaron la misma última unidad.';
end $$;

-- 6) TODO-O-NADA: un sabor canónico sin lote cotiza en grueso pero el hold
--    no toma NADA (cero residuos, cero batch_id null).
do $$
declare
  v_q uuid; v_r jsonb;
  v_momo text:=(select valor from p03_ids where clave='momo');
begin
  v_q:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor_sin_lote'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q,(select valor from p03_ids where clave='tel4')));
  assert v_r->>'error'='SIN_DISPONIBILIDAD',
    'Un sabor sin lote consiguió hold igual.';
  assert not exists(select 1 from public.checkout_holds where quote_id=v_q)
    and (select stock from public.products where id=v_momo)=9
    and (select consumidas from public.lote_figuras
      where batch_id=(select valor from p03_ids where clave='lote_a'))=1,
    'El todo-o-nada dejó residuos.';
end $$;

-- 7) Liberación perezosa en la RPC pública: un hold vencido del producto se
--    concilia ANTES de decidir disponibilidad.
do $$
declare
  v_q uuid; v_r jsonb; v_hold uuid; v_qv uuid;
  v_momo text:=(select valor from p03_ids where clave='momo');
  v_lote text:=(select valor from p03_ids where clave='lote_a');
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  -- hold vencido simulado (patrón P01): descuenta 2 y expira en el pasado.
  perform set_config('request.jwt.claims','',true);
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(2000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,v_pasado)
  returning id into v_qv;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_qv,encode(sha256('p03-actor-viejo'::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_hold;
  insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
  values(v_hold,v_momo,v_lote,(select valor from p03_ids where clave='figura'),2);
  update public.products set stock=stock-2 where id=v_momo;
  update public.lote_figuras set consumidas=consumidas+2 where batch_id=v_lote;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);

  v_q:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_q,(select valor from p03_ids where clave='tel4')));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El checkout no liberó el hold vencido del producto: '||coalesce(v_r->>'error','?');
  assert (select estado from public.checkout_holds where id=v_hold)='Expirada',
    'El hold vencido no quedó Expirada en el camino público.';
  -- neto: 7 (tras hold vencido) +2 devueltos −1 nuevo = 8
  assert (select stock from public.products where id=v_momo)=8
    and (select consumidas from public.lote_figuras where batch_id=v_lote)=2,
    'La liberación perezosa no conservó la contabilidad exacta.';
  insert into p03_ids values('q_pago',v_q::text);
end $$;

-- 8) Beneficio reservado por el hold y jamás cobrado de más: si el beneficio
--    ya no está para otra quote, esa quote muere ANTES de cobrar.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select valor from p03_ids where clave='admin_auth'),'role','authenticated'
)::text,true);
do $$
declare
  v_b1 uuid; v_b2 uuid; v_r jsonb; v_q jsonb; v_payload jsonb;
  v_benefit text:=(select valor from p03_ids where clave='benefit');
begin
  v_payload:=jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p03_ids where clave='momo'),'cantidad',1,
      'figura',(select valor from p03_ids where clave='figura'),
      'sabor',(select valor from p03_ids where clave='sabor'),
      'salsa',(select valor from p03_ids where clave='salsa'))),
    'zona',(select valor from p03_ids where clave='zona'),
    'franja',(select valor from p03_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text);
  v_q:=public.cotizar_pedido_v1(v_payload);
  assert coalesce((v_q->>'ok')::boolean,false)
    and (select benefit_id from public.quotes
      where id=(v_q->>'quote_id')::uuid)=v_benefit,
    'La quote autenticada no ancló el beneficio.';
  v_b1:=(v_q->>'quote_id')::uuid;
  v_q:=public.cotizar_pedido_v1(v_payload);
  v_b2:=(v_q->>'quote_id')::uuid;
  assert (select benefit_id from public.quotes where id=v_b2)=v_benefit,
    'La segunda quote no ancló el beneficio (cotizar no debe mutarlo).';

  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_b1,(select valor from p03_ids where clave='tel5')));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El checkout con beneficio falló: '||coalesce(v_r->>'error','?');
  assert (select estado from public.benefits where id=v_benefit)='Reservado'
    and (select hold_quote_id from public.benefits where id=v_benefit)=v_b1,
    'El beneficio no quedó reservado por el hold.';

  -- Otra quote con el MISMO beneficio (otro actor): muere antes de cobrar.
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(
    v_b2,(select valor from p03_ids where clave='tel3')));
  assert v_r->>'error'='QUOTE_VENCIDA'
    and (select estado from public.quotes where id=v_b2)='Vencida',
    'Una quote con beneficio ya reservado sobrevivió (doble canje).';
  insert into p03_ids values('q_benefit',v_b1::text);
end $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);

-- 9) iniciar_pago_v1: pasarela fail-closed, intent idempotente y extensión
--    del hold exactly-once; hold vencido y quote vencida cortan ANTES.
do $$
declare
  v_q uuid:=(select valor::uuid from p03_ids where clave='q_pago');
  v_r jsonb; v_pid uuid; v_exp1 timestamptz; v_exp2 timestamptz;
  v_qv uuid; v_hold uuid;
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  -- 9a) sin decisión de pasarela: fail closed, cero intents.
  v_r:=public.iniciar_pago_v1(jsonb_build_object('quote_id',v_q));
  assert v_r->>'error'='PAGO_NO_DISPONIBLE'
    and not exists(select 1 from public.payments where quote_id=v_q),
    'Sin pasarela aprobada se abrió un intent igual.';

  -- 9b) con pasarela: intent Iniciado con el total de la quote y extensión.
  insert into public.app_settings(clave,valor)
  values('pide_pasarela_proveedor',to_jsonb('pasarela_test'::text));
  select expira_at into v_exp1 from public.checkout_holds
    where quote_id=v_q and estado='Temporal';
  v_r:=public.iniciar_pago_v1(jsonb_build_object('quote_id',v_q));
  assert coalesce((v_r->>'ok')::boolean,false)
    and v_r->>'contract'='momos.pide.intent.v1'
    and v_r->>'estado'='Iniciado'
    and (v_r->>'monto')::numeric=(select total from public.quotes where id=v_q),
    'El intent no abrió con el total autoritativo: '||coalesce(v_r->>'error','?');
  v_pid:=(v_r->>'payment_id')::uuid;
  select expira_at into v_exp2 from public.checkout_holds
    where quote_id=v_q and estado='Temporal';
  assert v_exp2>v_exp1
    and (select extendido_por_pago_at from public.checkout_holds
      where quote_id=v_q and estado='Temporal') is not null,
    'El intent no extendió el hold (sello único).';

  -- 9c) reintento: MISMO intent, cero segunda extensión.
  v_r:=public.iniciar_pago_v1(jsonb_build_object('quote_id',v_q));
  assert (v_r->>'payment_id')::uuid=v_pid
    and (select count(*) from public.payments where quote_id=v_q)=1
    and (select expira_at from public.checkout_holds
      where quote_id=v_q and estado='Temporal')=v_exp2,
    'El reintento duplicó el intent o re-extendió el hold.';

  -- 9d) hold vencido: corta ANTES de crear el intent.
  perform set_config('request.jwt.claims','',true);
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(2000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,
    clock_timestamp()+interval '15 minutes')
  returning id into v_qv;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_qv,encode(sha256('p03-actor-vencido'::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_hold;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.iniciar_pago_v1(jsonb_build_object('quote_id',v_qv));
  assert v_r->>'error'='HOLD_VENCIDO'
    and not exists(select 1 from public.payments where quote_id=v_qv),
    'Un hold vencido consiguió intent.';

  -- 9e) quote vencida por tiempo: QUOTE_VENCIDA y sello de estado.
  perform set_config('request.jwt.claims','',true);
  update public.quotes set vence_at=v_pasado
    where id=(select valor::uuid from p03_ids where clave='q_benefit');
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_r:=public.iniciar_pago_v1(jsonb_build_object(
    'quote_id',(select valor from p03_ids where clave='q_benefit')));
  assert v_r->>'error'='QUOTE_VENCIDA'
    and (select estado from public.quotes
      where id=(select valor::uuid from p03_ids where clave='q_benefit'))='Vencida',
    'Una quote vencida por tiempo abrió intent.';
end $$;

-- 10) Cableado staff: _reserve_inventory libera el hold Pide vencido del
--     producto ANTES de reservar — el mostrador no ve quiebre fantasma.
select set_config('request.jwt.claims','',true);
do $$
declare
  v_momo text:=(select valor from p03_ids where clave='momo');
  v_lote text:=(select valor from p03_ids where clave='lote_a');
  v_sfx text:=(select valor from p03_ids where clave='sfx');
  v_qv uuid; v_hold uuid; v_stock0 numeric; v_cons0 numeric; v_falt jsonb;
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  select stock into v_stock0 from public.products where id=v_momo;
  select consumidas into v_cons0 from public.lote_figuras where batch_id=v_lote;
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(2000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,v_pasado)
  returning id into v_qv;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_qv,encode(sha256('p03-actor-staff'::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_hold;
  insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
  values(v_hold,v_momo,v_lote,(select valor from p03_ids where clave='figura'),2);
  update public.products set stock=stock-2 where id=v_momo;
  update public.lote_figuras set consumidas=consumidas+2 where batch_id=v_lote;

  insert into public.orders(id,fecha,hora,canal,customer_id,estado,zona,franja)
  values('P03-O-'||v_sfx,current_date,current_time,'Directo',
    (select valor from p03_ids where clave='cliente'),'Nuevo',
    (select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'));
  insert into public.order_items(id,order_id,product_id,cant,nombre,figura,sabor)
  values('P03-OI-'||v_sfx,'P03-O-'||v_sfx,v_momo,1,'P03 item staff',
    (select valor from p03_ids where clave='figura'),
    (select valor from p03_ids where clave='sabor'));

  v_falt:=public._reserve_inventory('P03-O-'||v_sfx);
  assert (select estado from public.checkout_holds where id=v_hold)='Expirada',
    '_reserve_inventory no liberó el hold Pide vencido.';
  -- neto: (stock0−2 por el hold) +2 devueltos −1 reservado por el pedido
  assert (select stock from public.products where id=v_momo)=v_stock0-1
    and (select consumidas from public.lote_figuras where batch_id=v_lote)=v_cons0+1,
    'El cableado no conservó la contabilidad exacta del mostrador.';
  assert v_falt='[]'::jsonb
    and exists(select 1 from public.inventory_reservations
      where order_id='P03-O-'||v_sfx and batch_id=v_lote),
    'El pedido staff no reservó del lote tras la liberación.';
end $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);

-- 11) Rate limit del checkout y del pago: cortan con error propio.
do $$
declare v_r jsonb;
begin
  update public.app_settings set valor=to_jsonb(1) where clave='pide_rate_limit_checkout';
  v_r:=public.reservar_checkout_v1('{}'::jsonb);
  v_r:=public.reservar_checkout_v1('{}'::jsonb);
  assert v_r->>'error'='CHECKOUT_RATE_LIMIT','El rate limit del checkout no cortó.';
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_checkout';
  update public.app_settings set valor=to_jsonb(1) where clave='pide_rate_limit_pago';
  v_r:=public.iniciar_pago_v1('{}'::jsonb);
  v_r:=public.iniciar_pago_v1('{}'::jsonb);
  assert v_r->>'error'='PAGO_RATE_LIMIT','El rate limit del pago no cortó.';
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_pago';
  -- La señal de teléfono es canónica: dos FORMATOS del mismo número golpean
  -- UN solo contador (el strip crudo diluía el límite en un contador por
  -- formato).
  v_r:=public.reservar_checkout_v1(jsonb_build_object('telefono','3159999998'));
  v_r:=public.reservar_checkout_v1(jsonb_build_object('telefono','573159999998'));
  assert (select golpes from public.pide_rate_counters
      where clave='rctel:'||encode(sha256('573159999998'::bytea),'hex'))=2,
    'La clave rctel no normalizó el teléfono (contadores diluidos por formato).';
end $$;

-- 12) Ramas del hold sin cobertura previa: actor cambiado en la MISMA quote,
--     hold veneno del propio actor (aislado + respuesta honesta) y cobertura
--     que ignora lotes vencidos aunque el stock agregado alcance.
do $$
declare
  v_momo text:=(select valor from p03_ids where clave='momo');
  v_q uuid; v_r jsonb; v_h1 uuid; v_h2 uuid;
  v_stock0 numeric; v_vig numeric;
  v_qv uuid; v_hold_v uuid;
  v_pasado timestamptz:=clock_timestamp()-interval '10 minutes';
begin
  select stock into v_stock0 from public.products where id=v_momo;

  -- 12a) teléfono editado sobre la MISMA quote: el hold previo se resuelve
  -- con devolución exacta y el actor nuevo toma el suyo.
  v_q:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,'3150000006'));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El hold del primer actor falló: '||coalesce(v_r->>'error','?');
  select id into v_h1 from public.checkout_holds where quote_id=v_q and estado='Temporal';
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,'3150000007'));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El hold del actor cambiado falló: '||coalesce(v_r->>'error','?');
  select id into v_h2 from public.checkout_holds where quote_id=v_q and estado='Temporal';
  assert v_h2 is not null and v_h2<>v_h1
    and (select estado from public.checkout_holds where id=v_h1)='Expirada'
    and (select actor_hmac from public.checkout_holds where id=v_h2)
      =encode(sha256('573150000007'::bytea),'hex'),
    'El teléfono editado no re-tomó el hold de la quote.';
  assert (select stock from public.products where id=v_momo)=v_stock0-1,
    'La re-toma del hold no conservó la contabilidad exacta.';

  -- 12b) hold veneno del PROPIO actor (reclama más de lo que el lote respalda):
  -- el núcleo lo aísla (sigue Temporal, warning) y la RPC responde
  -- indisponibilidad honesta — jamás ENTRADA_INVALIDA por unique_violation.
  perform set_config('request.jwt.claims','',true);
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(2000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,v_pasado)
  returning id into v_qv;
  insert into public.checkout_holds(quote_id,actor_hmac,expira_original,expira_at)
  values(v_qv,encode(sha256('573150000008'::bytea),'hex'),v_pasado,v_pasado)
  returning id into v_hold_v;
  insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
  values(v_hold_v,v_momo,(select valor from p03_ids where clave='lote_a'),
    (select valor from p03_ids where clave='figura'),999);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p03_cotizar(v_momo,1,(select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,'3150000008'));
  assert v_r->>'error'='SIN_DISPONIBILIDAD',
    'El hold veneno no respondió indisponibilidad honesta: '||coalesce(v_r->>'error','?');
  assert (select estado from public.checkout_holds where id=v_hold_v)='Temporal',
    'El hold veneno no quedó aislado como Temporal para conciliación.';

  -- 12c) cobertura vigente: aunque products.stock cuente el lote vencido, la
  -- demanda que excede lo VIGENTE muere limpia (ni invariante rota ni hold).
  perform set_config('request.jwt.claims','',true);
  select 10-consumidas into v_vig from public.lote_figuras
    where batch_id=(select valor from p03_ids where clave='lote_a');
  update public.products set stock=v_vig+5, pide_hold_fraccion=1 where id=v_momo;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_q:=pg_temp._p03_cotizar(v_momo,(v_vig+1)::integer,
    (select valor from p03_ids where clave='sabor'));
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,'3150000009'));
  assert v_r->>'error'='SIN_DISPONIBILIDAD',
    'La cobertura contó lotes vencidos (o el FIFO reventó): '||coalesce(v_r->>'error','?');
  perform set_config('request.jwt.claims','',true);
  update public.products set stock=v_stock0-1, pide_hold_fraccion=null where id=v_momo;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
end $$;

-- 13) Combo end-to-end: cada slot se resuelve a su momo canónico (H90) y el
--     hold nace 100% respaldado por lote (requisito sellado 1 en combos).
do $$
declare
  v_sfx text:=(select valor from p03_ids where clave='sfx');
  v_combo text; v_size integer; v_cfig text; v_cprod text;
  v_sabor text:=(select valor from p03_ids where clave='sabor');
  v_slot jsonb; v_boxes jsonb; v_qj jsonb; v_q uuid; v_r jsonb; i integer;
  v_hold uuid;
begin
  perform set_config('request.jwt.claims','',true);
  select p.id,p.combo_size into v_combo,v_size from public.products p
    where p.tipo='combo' and p.activo and coalesce(p.combo_size,0)>=1
      and exists(select 1 from public.combo_components cc
        join public.figuras f on f.product_id=cc.component_id and f.activo
        where cc.combo_id=p.id)
    order by p.id limit 1;
  assert v_combo is not null,'P03 necesita un combo activo con componentes y figuras.';
  select f.nombre,f.product_id into v_cfig,v_cprod
    from public.combo_components cc
    join public.figuras f on f.product_id=cc.component_id and f.activo
    join public.products pm on pm.id=f.product_id and pm.activo and pm.tipo='momo'
    where cc.combo_id=v_combo order by f.orden,f.nombre limit 1;
  assert v_cprod is not null,'P03 necesita una figura de combo con momo activo.';
  update public.products set precio_pide=96000 where id=v_combo;
  -- La disponibilidad del combo agrega TODOS los componentes: ninguno puede
  -- estar agotado para cotizar (rollback restaura los stocks del dominio).
  update public.products set stock=greatest(coalesce(stock,0),1)
    where id in (select component_id from public.combo_components
      where combo_id=v_combo);
  -- lote propio para el momo resuelto + stock suficiente y fracción plena
  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values('P03-LC-'||v_sfx,current_date,v_cprod,v_cfig,v_sabor,180,
    v_size,v_size,0,0,'Listo',true,clock_timestamp(),6);
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas)
  values('P03-LC-'||v_sfx,v_cfig,v_size,v_size,0,0,0);
  update public.products set stock=coalesce(stock,0)+v_size, pide_hold_fraccion=1
    where id=v_cprod;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);

  v_slot:=jsonb_build_object('figura',v_cfig,'sabor',v_sabor,
    'salsa',(select valor from p03_ids where clave='salsa'));
  v_boxes:='[]'::jsonb;
  for i in 1..v_size loop v_boxes:=v_boxes||v_slot; end loop;
  v_qj:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_combo,'cantidad',1,'boxes',jsonb_build_array(v_boxes))),
    'zona',(select valor from p03_ids where clave='zona'),
    'franja',(select valor from p03_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_qj->>'ok')::boolean,false),
    'La cotización del combo falló: '||coalesce(v_qj->>'error','?');
  v_q:=(v_qj->>'quote_id')::uuid;
  v_r:=public.reservar_checkout_v1(pg_temp._p03_datos(v_q,'3150000011'));
  assert coalesce((v_r->>'ok')::boolean,false),
    'El hold del combo falló: '||coalesce(v_r->>'error','?');
  select id into v_hold from public.checkout_holds
    where quote_id=v_q and estado='Temporal';
  assert (select coalesce(sum(cantidad),0) from public.checkout_hold_lotes
      where hold_id=v_hold and product_id=v_cprod)=v_size
    and not exists(select 1 from public.checkout_hold_lotes
      where hold_id=v_hold and batch_id is null),
    'El combo no apartó sus slots respaldados por lote.';
end $$;

-- 14) Reaper de intents: TTL fail-closed, gate service_role, expiración
--     exactly-once, anonimización delegada, beneficio retenido por la
--     liberación mientras el intent vive y reactivado al expirar; el intent
--     fresco y el Aprobado quedan intactos.
do $$
declare
  v_q uuid:=(select valor::uuid from p03_ids where clave='q_pago');
  v_qb uuid:=(select valor::uuid from p03_ids where clave='q_benefit');
  v_benefit text:=(select valor from p03_ids where clave='benefit');
  v_qf uuid; v_qa uuid; v_pf uuid; v_pa uuid;
  v_r jsonb; v_failed boolean;
  v_rol text;
begin
  -- RBAC estructural: wrapper solo service_role; núcleo cerrado a todos.
  assert has_function_privilege('service_role','public.purgar_intents_pide_v1(integer)','EXECUTE')
    and not has_function_privilege('anon','public.purgar_intents_pide_v1(integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.purgar_intents_pide_v1(integer)','EXECUTE'),
    'RBAC del wrapper del reaper incorrecto.';
  foreach v_rol in array array['anon','authenticated','service_role'] loop
    assert not has_function_privilege(v_rol,
      'public._pide_reaper_intents_v1(integer)','EXECUTE'),
      'El núcleo del reaper quedó expuesto a '||v_rol;
  end loop;

  -- Gate por claim: sin service_role no corre (patrón purga P01).
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  v_failed:=false;
  begin
    perform public.purgar_intents_pide_v1(60);
  exception when others then v_failed:=true; end;
  assert v_failed,'El reaper corrió sin el claim service_role.';

  -- Fixtures: q_pago = intent viejo con hold muerto (candidato canónico);
  -- q_benefit = beneficio Reservado bajo intent vivo; fresco y Aprobado.
  perform set_config('request.jwt.claims','',true);
  update public.payments set creado_at=clock_timestamp()-interval '2 hours'
    where quote_id=v_q;
  insert into public.payments(quote_id,proveedor,monto,estado,creado_at)
  values(v_qb,'pasarela_test',1000,'Iniciado',clock_timestamp()-interval '2 hours');
  -- Simulación de paso del tiempo: estos holds nacieron del camino público
  -- REAL (no admiten el INSERT-con-expira-pasado de otros bloques) y el guard
  -- sella expira_at en operación — el fixture lo suspende SOLO para el
  -- backdate y lo re-arma de inmediato.
  alter table public.checkout_holds disable trigger checkout_holds_guard;
  -- Backdate COHERENTE con el CHECK extension_coherente: sin sello ambos
  -- campos EXACTAMENTE iguales (now() es estable dentro del statement;
  -- clock_timestamp() volátil difiere por microsegundos y rompe la igualdad).
  update public.checkout_holds set
    expira_original=now()-interval '100 minutes',
    expira_at=case when extendido_por_pago_at is not null
      then now()-interval '90 minutes'
      else now()-interval '100 minutes' end
    where quote_id in (v_q,v_qb) and estado='Temporal';
  alter table public.checkout_holds enable trigger checkout_holds_guard;
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(3000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,
    clock_timestamp()+interval '15 minutes')
  returning id into v_qf;
  insert into public.payments(quote_id,proveedor,monto)
  values(v_qf,'pasarela_test',3000) returning id into v_pf;
  insert into public.quotes(total,zona,franja,fecha_entrega,vence_at)
  values(3000,(select valor from p03_ids where clave='zona'),
    (select valor from p03_ids where clave='franja'),current_date+2,
    clock_timestamp()+interval '15 minutes')
  returning id into v_qa;
  insert into public.payments(quote_id,proveedor,monto,estado,creado_at)
  values(v_qa,'pasarela_test',3000,'Aprobado',clock_timestamp()-interval '3 hours')
  returning id into v_pa;
  assert exists(select 1 from public.checkout_sessions where quote_id=v_q)
    and exists(select 1 from public.checkout_sessions where quote_id=v_qb),
    'El fixture del reaper necesita las sesiones vivas de q_pago y q_benefit.';

  -- La LIBERACIÓN de los holds muertos NO reactiva el beneficio con intent
  -- vivo (anti doble canje) — y sí resuelve los holds (semántica p_productos
  -- null = todos, la de la purga).
  v_r:=public._pide_liberar_holds_vencidos();
  assert (select estado from public.benefits where id=v_benefit)='Reservado'
    and (select hold_quote_id from public.benefits where id=v_benefit)=v_qb,
    'La liberación reactivó un beneficio con intent vivo (doble canje).';
  assert not exists(select 1 from public.checkout_holds
      where quote_id in (v_q,v_qb) and estado='Temporal'),
    'La liberación global no resolvió los holds muertos.';

  -- TTL fail-closed: fuera de [ventana pasarela, 1 día] no corre.
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_failed:=false;
  begin
    perform public.purgar_intents_pide_v1(5);
  exception when others then v_failed:=true; end;
  assert v_failed,'El reaper aceptó un TTL menor que la ventana de la pasarela.';
  v_failed:=false;
  begin
    perform public.purgar_intents_pide_v1(2000);
  exception when others then v_failed:=true; end;
  assert v_failed,'El reaper aceptó un TTL mayor a un día.';

  -- Corrida real: expira los dos intents viejos, anonimiza sus checkouts y
  -- reactiva el beneficio; el fresco y el Aprobado quedan intactos.
  v_r:=public.purgar_intents_pide_v1(60);
  assert coalesce((v_r->>'ok')::boolean,false)
    and (v_r->>'intentsExpirados')::integer>=2
    and (v_r->>'containsCustomerPii')='false',
    'El reaper no expiró los intents viejos: '||v_r::text;
  assert (select estado from public.payments where quote_id=v_q)='Expirado'
    and (select estado from public.payments where quote_id=v_qb)='Expirado',
    'Los intents viejos no quedaron Expirado.';
  assert not exists(select 1 from public.checkout_sessions where quote_id=v_q)
    and not exists(select 1 from public.checkout_sessions where quote_id=v_qb),
    'El reaper no anonimizó las sesiones (PII retenida).';
  assert (select estado from public.quotes where id=v_q)='Vencida',
    'La quote del intent expirado no quedó sellada Vencida.';
  assert (select estado from public.benefits where id=v_benefit)='Activo'
    and (select hold_quote_id from public.benefits where id=v_benefit) is null,
    'El beneficio no volvió a Activo al expirar el intent.';
  assert (select estado from public.payments where id=v_pf)='Iniciado',
    'El reaper tocó un intent fresco.';
  assert (select estado from public.payments where id=v_pa)='Aprobado',
    'El reaper tocó un intent Aprobado.';
  -- Idempotencia: la segunda corrida no encuentra nada nuestro.
  v_r:=public.purgar_intents_pide_v1(60);
  assert not exists(select 1 from public.payments
      where quote_id in (v_q,v_qb) and estado<>'Expirado'),
    'La segunda corrida del reaper alteró intents ya resueltos.';
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
end $$;

-- 15) Invariantes globales del run: ninguna línea de hold nació sin lote y
--     NINGUNA tocó el lote VENCIDO.
do $$
begin
  assert not exists(select 1 from public.checkout_hold_lotes where batch_id is null),
    'Algún hold emitió batch_id null (requisito sellado 1 roto).';
  assert not exists(select 1 from public.checkout_hold_lotes
      where batch_id=(select valor from p03_ids where clave='lote_v')),
    'Algún hold tomó el lote VENCIDO (espejo de vigencia roto).';
end $$;

select 'TESTS_OK — P03 hold todo-o-nada con FIFO exacto y vigente/idempotencia/un checkout por actor y teléfono editado/tope de fracción con última unidad/liberación perezosa pública y staff/hold veneno aislado con respuesta honesta/combo respaldado por lote/beneficio sin doble canje bajo intent vivo/intent idempotente con extensión única/pasarela fail-closed/reaper de intents con TTL fail-closed y anonimización/rate limit con teléfono canónico PASS, rollback total' as resultado;
rollback;
