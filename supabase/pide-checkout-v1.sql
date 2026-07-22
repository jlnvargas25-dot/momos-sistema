-- MOMOS · Carril Pide · P03 pide-checkout-v1
--
-- Checkout con hold real de inventario y apertura de intent de pago
-- (docs/PIDE-SUPERFICIE-PUBLICA-V1.md §1.5 + §2; alcance §4.3):
--   * reservar_checkout_v1 — toma el hold TODO-O-NADA corriendo el MISMO FIFO
--     del pago (lote exacto por producto+figura+sabor), escribe la sesión del
--     invitado y reserva el beneficio de la quote;
--   * iniciar_pago_v1 — valida la vigencia de la quote AL INICIAR el cobro,
--     abre el intent idempotente y extiende el hold UNA sola vez;
--   * techos anti-acaparamiento §1.5 — un checkout vivo por actor, tope global
--     de stock retenible por fracción y TTL corto;
--   * reaper de intents Iniciado abandonados (privacidad §1.2/H89) — pasado
--     pide_intent_ttl_minutos sin resolución de pasarela, el intent se declara
--     Expirado (terminal), el checkout se anonimiza (delega VERBATIM en
--     _pide_anonimizar_checkout, md5 verificado) y el beneficio reservado
--     vuelve a Activo. Mientras el intent vive, la liberación de holds NO
--     reactiva el beneficio (anti doble canje: cobro en vuelo = beneficio
--     retenido);
--   * cableado de la liberación perezosa dentro de _reserve_inventory (staff),
--     prometido por P01 — sin esto un job caído produce quiebre fantasma
--     también para el mostrador.
--
-- Requisitos sellados del README, cerrados acá:
--   1. El FIFO del hold JAMÁS emite una fila con batch_id null: Pide siempre
--      exige figura+sabor exactos y el hold solo toma stock respaldado por
--      lote (igual que _asignar_variante_fifo con figura específica, que
--      devuelve el remanente sin lote como faltante). Verificado contra el
--      dominio vivo (2026-07-22): existe stock de momos SIN lote (drift
--      histórico) — ese stock NO es apartable por figura exacta en ningún
--      canal, y en Pide simplemente no se promete (SIN_DISPONIBILIDAD).
--   2. Orden de locks products→lote_figuras en TODAS las rutas de P03: el
--      núcleo _pide_liberar_holds_interno bloquea PRIMERO el conjunto completo
--      de productos (liberación + demanda del llamador) por id asc y DESPUÉS
--      lote_figuras por (batch_id,figura). reservar_checkout_v1 y el
--      _reserve_inventory cableado pasan su demanda como p_lock_productos, así
--      todos sus locks de producto posteriores ya están adquiridos. Esto
--      alinea a P03 con la disciplina DOMINANTE del sistema OPS
--      (_reserve_inventory, _asignar_variante_fifo, _release_reservations,
--      desechar_producto_terminado_delta: todos products→lote_figuras).
--
--      LÍMITE HONESTO (hallazgo del panel de concurrencia): NO es un invariante
--      universal. La función OPS viva `_atender_cola_produccion(batch)` bloquea
--      lote_figuras ANTES que products (orden inverso), de modo que puede
--      formar un deadlock ABBA con cualquier ruta products→lote_figuras. Ese
--      ciclo PRE-EXISTE a P03 (ya existía entre _reserve_inventory y
--      _atender_cola) y su corrección pertenece a un hito del carril OPS con su
--      propia suite de concurrencia — NO se empotra acá para no cruzar el
--      carril sin poder correr esa suite. P03 NO lo corrige y NO cierra este
--      requisito como universal; lo trata con RESILIENCIA: reservar/iniciar
--      capturan deadlock_detected/lock_not_available y responden un error
--      reintentable limpio (nunca una alarma de "invariante rota" ni un
--      ENTRADA_INVALIDA genérico). El fix real queda sellado como pendiente OPS.
--
-- Decisiones técnicas EXPLÍCITAS (para el gate y para Jorge):
--   * actor del techo "un checkout vivo": sha256 del teléfono normalizado de
--     la sesión de checkout, calculado en servidor SIN pepper (la RPC pública
--     no tiene runtime privado en el camino). Es forjable, igual que la clave
--     de teléfono del rate limit de P02, y se documenta como tal: la defensa
--     REAL anti-acaparamiento es el tope de fracción por producto (no depende
--     del actor) + rate limit + TTL corto. El hash vive solo en tablas
--     deny-all.
--   * pasarela: app_settings.pide_pasarela_proveedor NO se siembra — el slug
--     es decisión pendiente de Jorge y sin él iniciar_pago_v1 falla cerrado
--     (PAGO_NO_DISPONIBLE). Ningún intent puede abrirse contra un proveedor
--     que el negocio no aprobó.
--   * tope de fracción: greatest(1, floor(fraccion*base)) — con fracción > 0
--     la última unidad SIEMPRE es apartable (no se pierde la venta del último
--     momo); fracción 0 apaga los holds del producto de forma explícita.
--
-- Aplicar a la base viva requiere aprobación explícita de Jorge.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

-- ============================================================================
-- Preflight: falla cerrado si la base no es EXACTAMENTE la verificada.
-- ============================================================================
do $$
declare t text; v_md5 text;
begin
  -- Ancla del carril: P02 aplicado; P03 no re-aplicable.
  if not exists(select 1 from public.momos_ops_migrations
    where id='20260722_p02_pide_cotizacion') then
    raise exception 'P03 requiere 20260722_p02_pide_cotizacion aplicado en la base.';
  end if;
  if exists(select 1 from public.momos_ops_migrations
    where id='20260722_p03_pide_checkout') then
    raise exception 'P03 ya está aplicado; este hito no se reaplica.';
  end if;

  -- Objetos P01/P02 de los que depende el checkout.
  foreach t in array array[
    'quotes','checkout_sessions','checkout_holds','checkout_hold_lotes',
    'payments','payment_events','pide_rate_counters','benefits','products',
    'production_batches','lote_figuras','figuras','combo_components',
    'app_settings','order_items','inventory_reservations'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Falta la tabla base %.',t;
    end if;
  end loop;
  -- Columnas de las que dependen los CUERPOS de P03: CREATE FUNCTION no las
  -- valida (plpgsql resuelve en runtime), así que sin este check una columna
  -- ausente pasaría el gate y explotaría recién en producción.
  foreach t in array array[
    'products.pide_hold_fraccion','products.precio_pide','products.stock',
    'products.tipo','products.activo',
    'quotes.canal','quotes.estado','quotes.vence_at','quotes.lineas',
    'quotes.total','quotes.benefit_id','quotes.telefono_hmac',
    'checkout_holds.quote_id','checkout_holds.actor_hmac','checkout_holds.estado',
    'checkout_holds.expira_original','checkout_holds.expira_at',
    'checkout_holds.extendido_por_pago_at','checkout_holds.resuelto_at',
    'checkout_hold_lotes.hold_id','checkout_hold_lotes.product_id',
    'checkout_hold_lotes.batch_id','checkout_hold_lotes.figura',
    'checkout_hold_lotes.cantidad',
    'checkout_sessions.quote_id','checkout_sessions.opt_in',
    'payments.quote_id','payments.proveedor','payments.monto','payments.moneda',
    'payments.estado','payments.order_id','payments.creado_at',
    'payments.actualizado_at',
    'benefits.hold_quote_id','benefits.pedido_uso'
  ] loop
    if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name=split_part(t,'.',1)
        and column_name=split_part(t,'.',2)) then
      raise exception 'Falta la columna base %.',t;
    end if;
  end loop;
  if to_regprocedure('public._pide_liberar_holds_vencidos(text)') is null
     or to_regprocedure('public._pide_rate_golpe(text,interval)') is null
     or to_regprocedure('public._pide_setting_int(text,integer)') is null
     or to_regprocedure('public._pide_error(text,text)') is null
     or to_regprocedure('public._normalizar_telefono(text)') is null
     or to_regprocedure('public._asignar_variante_fifo(text,text,text,text,integer,text)') is null
     or to_regprocedure('public._reserve_inventory(text)') is null
     or to_regprocedure('public.purgar_checkout_efimero_v1(integer)') is null
     or to_regprocedure('public._pide_anonimizar_checkout(uuid)') is null
     or to_regprocedure('public.current_customer_id()') is null then
    raise exception 'Faltan funciones base P01/P02/OPS para el checkout.';
  end if;
  if to_regclass('public.payments_quote_vivo_uidx') is null
     or to_regclass('public.checkout_holds_quote_temporal_uidx') is null
     or to_regclass('public.checkout_holds_actor_temporal_uidx') is null then
    raise exception 'Faltan los índices de idempotencia de P01.';
  end if;
  foreach t in array array[
    'pide_hold_ttl_minutos','pide_hold_extension_minutos',
    'pide_hold_stock_fraccion','pide_rate_ventana_minutos',
    'pide_rate_limit_global'
  ] loop
    if not exists(select 1 from public.app_settings where clave=t) then
      raise exception 'Falta el seed % de P01/P02.',t;
    end if;
  end loop;

  -- Las funciones que P03 reemplaza o espeja deben ser EXACTAMENTE las
  -- verificadas en la base viva (2026-07-22). Un md5 distinto significa que
  -- otro carril las movió: se investiga y se re-captura, jamás se fuerza.
  v_md5:=md5(pg_get_functiondef('public._reserve_inventory(text)'::regprocedure));
  if v_md5 is distinct from '1d5dda324899cebc62cb2608ec2db596' then
    raise exception '_reserve_inventory difiere del verificado (md5 vivo: %). Re-capturar el cuerpo vivo y regenerar el cableado antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._asignar_variante_fifo(text,text,text,text,integer,text)'::regprocedure));
  if v_md5 is distinct from 'e2d147b0a41e1bf540bf0f84b9ac1817' then
    raise exception '_asignar_variante_fifo difiere del verificado (md5 vivo: %). El FIFO del hold es su espejo: re-verificar la equivalencia antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._pide_liberar_holds_vencidos(text)'::regprocedure));
  if v_md5 is distinct from '93ab660f0741697ae2628caa3ad52b38' then
    raise exception '_pide_liberar_holds_vencidos difiere del P01 verificado (md5 vivo: %).',v_md5;
  end if;

  -- Los objetos P03 NO deben existir (residuo = base desconocida).
  if to_regprocedure('public.reservar_checkout_v1(jsonb)') is not null
     or to_regprocedure('public.iniciar_pago_v1(jsonb)') is not null
     or to_regprocedure('public._pide_liberar_holds_interno(text[],uuid[],text[])') is not null
     or to_regprocedure('public._pide_asignar_hold_fifo(uuid,text,text,text,integer)') is not null
     or to_regprocedure('public._pide_setting_num(text,numeric)') is not null
     or to_regprocedure('public._pide_error(text,text,text)') is not null
     or to_regprocedure('public._pide_reaper_intents_v1(integer)') is not null
     or to_regprocedure('public.purgar_intents_pide_v1(integer)') is not null then
    raise exception 'Objetos P03 ya presentes: base fuera del estado esperado.';
  end if;

  -- _pide_anonimizar_checkout se REUSA verbatim (el reaper de intents delega en
  -- ella para anonimizar el checkout abandonado): su cuerpo vivo debe ser el
  -- P01 verificado, o el reaper podría no borrar la PII como se espera.
  v_md5:=md5(pg_get_functiondef('public._pide_anonimizar_checkout(uuid)'::regprocedure));
  if v_md5 is distinct from 'fe2693eff1ce8d97023fe81cdc2f85ac' then
    raise exception '_pide_anonimizar_checkout difiere del P01 verificado (md5 vivo: %).',v_md5;
  end if;
end $$;

-- ============================================================================
-- Seeds técnicos (valores de arranque NO aprobados como negocio — ver README).
-- pide_pasarela_proveedor NO se siembra a propósito (fail closed, cabecera).
-- ============================================================================
insert into public.app_settings(clave,valor) values
  ('pide_rate_limit_checkout',to_jsonb(15)),
  ('pide_rate_limit_pago',to_jsonb(15)),
  -- TTL del reaper de intents Iniciado abandonados (§ privacidad): debe superar
  -- con margen la ventana de la pasarela (hold ttl + extensión). Un intent más
  -- viejo que esto sin webhook se declara Expirado y su checkout se anonimiza.
  ('pide_intent_ttl_minutos',to_jsonb(60))
on conflict (clave) do nothing;

-- ============================================================================
-- Helpers de contrato: error con contract explícito y setting numérico.
-- ============================================================================
create function public._pide_error(p_contract text, p_error text, p_mensaje text)
returns jsonb
language sql immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select jsonb_build_object(
    'contract',p_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',false,'error',p_error,'mensaje',p_mensaje)
$$;

create function public._pide_setting_num(p_clave text, p_default numeric)
returns numeric
language sql stable
set search_path=pg_catalog,public,pg_temp
as $$
  select coalesce((select (valor #>> '{}')::numeric
    from public.app_settings where clave=p_clave),p_default)
$$;

-- ============================================================================
-- Núcleo de liberación de holds — generaliza el cuerpo probado de P01 para
-- que TODA ruta comparta un único pase de locks en orden canónico global.
--   p_productos: filtra los holds VENCIDOS a los que tocan estos productos
--     (null = todos, semántica del job de purga);
--   p_holds_extra: holds Temporal a resolver AUNQUE no estén vencidos (el
--     hold previo del actor y el hold previo de la quote en reservar);
--   p_lock_productos: productos adicionales a bloquear en el MISMO pase
--     ascendente (la demanda del llamador) — así los locks de producto que el
--     llamador tome después ya están adquiridos y no introducen orden nuevo.
-- ============================================================================
create function public._pide_liberar_holds_interno(
  p_productos text[] default null,
  p_holds_extra uuid[] default null,
  p_lock_productos text[] default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_extra uuid[];
  v_vencidos uuid[];
  v_holds uuid[];
  v_validos uuid[]:=array[]::uuid[];
  v_irreconciliables integer:=0;
  v_hold uuid;
  v_linea record;
  v_ok boolean;
  v_consumidas numeric;
  v_prev numeric;
  v_acc jsonb:='{}'::jsonb;   -- devolución tentativa acumulada {batch:{figura:cant}}
  v_cand jsonb;
  v_esperadas integer;
  v_actualizadas integer;
begin
  -- (1a) holds extra del llamador: se resuelven aunque NO estén vencidos y el
  -- lock es BLOQUEANTE (el llamador los necesita resueltos, no salteados).
  select coalesce(array_agg(s.id),array[]::uuid[]) into v_extra
  from (
    select h.id from public.checkout_holds h
    where p_holds_extra is not null and h.id=any(p_holds_extra)
      and h.estado='Temporal'
    order by h.id
    for update
  ) s;

  -- (1b) holds vencidos, bloqueados, en orden determinista. SKIP LOCKED
  -- preserva liveness entre liberadores y el lock da el exactly-once.
  select coalesce(array_agg(s.id),array[]::uuid[]) into v_vencidos
  from (
    select h.id from public.checkout_holds h
    where h.estado='Temporal' and h.expira_at<clock_timestamp()
      and not (h.id=any(v_extra))
      and (p_productos is null or exists(
        select 1 from public.checkout_hold_lotes l
        where l.hold_id=h.id and l.product_id=any(p_productos)))
    order by h.id
    for update skip locked
  ) s;
  v_holds:=v_extra||v_vencidos;

  -- (2) locks globales deterministas: products → lote_figuras. El conjunto de
  -- productos incluye la demanda del llamador (p_lock_productos) para que
  -- TODOS los locks de producto de la transacción salgan de este único pase
  -- ascendente. Con los locks tomados en este orden, los pases de update no
  -- pueden interbloquearse.
  perform 1 from public.products p
    where p.id in (
      select l.product_id from public.checkout_hold_lotes l
      where l.hold_id=any(v_holds)
      union
      select unnest(p_lock_productos))
    order by p.id
    for update;
  if coalesce(array_length(v_holds,1),0)=0 then
    return jsonb_build_object('liberados',0,'irreconciliables',0);
  end if;
  perform 1 from public.lote_figuras lf
    where (lf.batch_id,lf.figura) in (
      select l.batch_id,l.figura from public.checkout_hold_lotes l
      where l.hold_id=any(v_holds) and l.batch_id is not null)
    order by lf.batch_id,lf.figura
    for update;

  -- (3) conciliación por hold, aislada (hold veneno → warning + skip).
  foreach v_hold in array v_holds loop
    begin
      v_ok:=true;
      v_cand:=v_acc;
      if exists(select 1 from public.checkout_hold_lotes l
        where l.hold_id=v_hold
          and not exists(select 1 from public.products p where p.id=l.product_id)) then
        v_ok:=false;
      end if;
      if v_ok then
        for v_linea in
          select l.batch_id,l.figura,sum(l.cantidad) as cantidad
          from public.checkout_hold_lotes l
          where l.hold_id=v_hold and l.batch_id is not null
          group by l.batch_id,l.figura
          order by l.batch_id,l.figura
        loop
          select lf.consumidas into v_consumidas from public.lote_figuras lf
            where lf.batch_id=v_linea.batch_id and lf.figura=v_linea.figura;
          v_prev:=coalesce((v_cand #>> array[v_linea.batch_id,v_linea.figura])::numeric,0);
          if v_consumidas is null or v_consumidas-v_prev<v_linea.cantidad then
            v_ok:=false;
            exit;
          end if;
          v_cand:=jsonb_set(
            jsonb_set(v_cand,array[v_linea.batch_id],
              coalesce(v_cand->v_linea.batch_id,'{}'::jsonb)),
            array[v_linea.batch_id,v_linea.figura],
            to_jsonb(v_prev+v_linea.cantidad));
        end loop;
      end if;
      if v_ok then
        v_validos:=v_validos||v_hold;
        v_acc:=v_cand;
      else
        v_irreconciliables:=v_irreconciliables+1;
        raise warning 'Hold % irreconciliable contra products/lote_figuras: queda Temporal y se reintenta el próximo ciclo.',v_hold;
      end if;
    exception when others then
      v_irreconciliables:=v_irreconciliables+1;
      raise warning 'Hold % irreconciliable (%): queda Temporal y se reintenta el próximo ciclo.',v_hold,sqlerrm;
    end;
  end loop;

  if coalesce(array_length(v_validos,1),0)=0 then
    return jsonb_build_object('liberados',0,'irreconciliables',v_irreconciliables);
  end if;

  -- (4) pase ÚNICO sobre products (locks ya tomados en orden por product_id).
  update public.products p
    set stock=coalesce(p.stock,0)+agg.cantidad
    from (
      select l.product_id,sum(l.cantidad) as cantidad
      from public.checkout_hold_lotes l
      where l.hold_id=any(v_validos)
      group by l.product_id
    ) agg
    where p.id=agg.product_id;

  -- (5) pase ÚNICO sobre lote_figuras. Lo validado bajo locks debe cuadrar
  -- EXACTO; un desvío acá es corrupción imposible-por-construcción y aborta
  -- con evidencia.
  select count(*) into v_esperadas from (
    select l.batch_id,l.figura from public.checkout_hold_lotes l
    where l.hold_id=any(v_validos) and l.batch_id is not null
    group by l.batch_id,l.figura
  ) e;
  update public.lote_figuras lf
    set consumidas=lf.consumidas-agg.cantidad
    from (
      select l.batch_id,l.figura,sum(l.cantidad) as cantidad
      from public.checkout_hold_lotes l
      where l.hold_id=any(v_validos) and l.batch_id is not null
      group by l.batch_id,l.figura
    ) agg
    where lf.batch_id=agg.batch_id and lf.figura=agg.figura
      and lf.consumidas>=agg.cantidad;
  get diagnostics v_actualizadas=row_count;
  if v_actualizadas<>v_esperadas then
    raise exception 'Liberación inconsistente: % lotes esperados, % actualizados (invariante rota bajo locks).',
      v_esperadas,v_actualizadas;
  end if;

  -- beneficios reservados por los holds liberados → vuelven a Activo (§1.10),
  -- SALVO que la quote tenga un intent de pago vivo o aprobado: reactivar el
  -- beneficio con el cobro en vuelo habilita el doble canje (se usa en otra
  -- quote mientras la pasarela aprueba esta). Ese caso lo resuelve el reaper
  -- de intents al expirar, o la conciliación P04 al aprobar.
  update public.benefits b
    set estado='Activo',hold_quote_id=null
    where b.estado='Reservado' and b.pedido_uso is null
      and b.hold_quote_id in (
        select h.quote_id from public.checkout_holds h where h.id=any(v_validos))
      and not exists(select 1 from public.payments pa
        where pa.quote_id=b.hold_quote_id and pa.estado in ('Iniciado','Aprobado'));

  -- exactly-once: las filas siguen bloqueadas por esta transacción.
  update public.checkout_holds
    set estado='Expirada',resuelto_at=clock_timestamp()
    where id=any(v_validos) and estado='Temporal';

  return jsonb_build_object(
    'liberados',coalesce(array_length(v_validos,1),0),
    'irreconciliables',v_irreconciliables);
end $$;

-- La firma P01 sobrevive como envoltura EXACTA (la usan la purga y los tests
-- del carril): mismo contrato, mismo retorno, cuerpo delegado al núcleo.
create or replace function public._pide_liberar_holds_vencidos(p_product_id text default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  return public._pide_liberar_holds_interno(
    case when p_product_id is null then null else array[p_product_id] end,
    null,null);
end $$;

-- ============================================================================
-- FIFO del hold — espejo EXACTO del _asignar_variante_fifo VIVO (el del paso
-- 12 de la cadena, cuarentena de vencidos: mismo join, mismos filtros de lote
-- Listo+contabilizado+VIGENTE, mismo orden de vencimiento/fecha/id/figura,
-- mismo FOR UPDATE OF lf), con dos diferencias deliberadas:
--   * escribe checkout_hold_lotes en lugar de inventory_reservations;
--   * NO toca products.stock (el llamador hace un solo update por producto).
-- El filtro de vigencia NO es opcional: sin él, el ORDER BY compartido
-- (vencimiento asc) hace que el hold elija PRIMERO exactamente los lotes
-- vencidos que el FIFO de pago excluye — el cliente pagaría stock que el
-- cumplimiento jamás asignará (hallazgo del re-juicio, cerrado acá).
-- En Pide figura y sabor SIEMPRE llegan (P02 los exige), así que cada línea
-- del hold nace respaldada por lote: batch_id null jamás se emite (cabecera).
-- ============================================================================
create function public._pide_asignar_hold_fifo(
  p_hold_id uuid, p_product_id text, p_figura text, p_sabor text,
  p_cantidad integer)
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  rec record;
  v_figura text:=nullif(trim(p_figura),'');
  v_sabor text:=nullif(trim(p_sabor),'');
  v_restante integer:=p_cantidad;
  v_toma integer;
begin
  if p_cantidad is null or p_cantidad<=0 then return 0; end if;
  for rec in
    select lf.batch_id, lf.figura, (lf.perfectas-lf.consumidas) as disp
    from public.lote_figuras lf
    join public.production_batches b on b.id=lf.batch_id
    where b.product_id=p_product_id
      and b.estado='Listo'
      and b.stock_contabilizado
      and (coalesce(b.vencimiento,b.vence) is null
        or coalesce(b.vencimiento,b.vence)>=current_date)
      and (v_sabor is null or b.sabor=v_sabor)
      and (v_figura is null or lf.figura=v_figura)
      and (lf.perfectas-lf.consumidas)>0
    order by coalesce(b.vencimiento,b.vence) asc nulls last,
             b.fecha asc, b.id asc, lf.figura asc
    for update of lf
  loop
    exit when v_restante<=0;
    v_toma:=least(rec.disp,v_restante);
    if v_toma<=0 then continue; end if;
    update public.lote_figuras set consumidas=consumidas+v_toma
      where batch_id=rec.batch_id and figura=rec.figura;
    insert into public.checkout_hold_lotes(hold_id,product_id,batch_id,figura,cantidad)
    values(p_hold_id,p_product_id,rec.batch_id,rec.figura,v_toma);
    v_restante:=v_restante-v_toma;
  end loop;
  return v_restante;
end $$;

-- ============================================================================
-- reservar_checkout_v1 — el hold TODO-O-NADA del checkout público.
-- Un hold que no puede cubrir la quote completa no toma NADA (la cotización
-- prometió en grueso; la verdad exacta se decide acá) y la respuesta es
-- indistinguible entre falta de stock y tope anti-acaparamiento.
-- ============================================================================
create function public.reservar_checkout_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  c_contract constant text:='momos.pide.hold.v1';
  v_ventana interval;
  v_headers jsonb; v_xff text; v_ip_hash text; v_bucket text; v_lim integer;
  v_tel_in text; v_tel text; v_tel_hash text; v_actor text;
  v_nombre text; v_direccion text; v_barrio text; v_referencia text;
  v_opt boolean;
  v_quote_id uuid;
  v_quote public.quotes%rowtype;
  v_hold_prev public.checkout_holds%rowtype;
  v_extra uuid[]:=array[]::uuid[];
  v_linea jsonb; v_box jsonb; v_slot jsonb;
  v_prod record;
  v_demanda jsonb:='{}'::jsonb;   -- {product|figura|sabor: cantidad}
  v_clave text; v_partes text[];
  v_productos text[];
  v_need integer; v_cobertura numeric; v_stock numeric; v_held numeric;
  v_frac numeric; v_base numeric; v_tope numeric;
  v_hold_id uuid; v_expira timestamptz;
  v_rem integer;
  v_k text;
begin
  -- ---- Rate limit (defensa de costo; patrón P02) — ANTES de todo. ----------
  v_ventana:=make_interval(mins=>public._pide_setting_int('pide_rate_ventana_minutos',10));
  v_lim:=public._pide_setting_int('pide_rate_limit_checkout',15);
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers:='{}'::jsonb; end;
  v_xff:=coalesce(v_headers->>'x-forwarded-for','');
  v_xff:=btrim(coalesce(nullif(split_part(v_xff,',',
    greatest(1,coalesce(array_length(string_to_array(v_xff,','),1),1))),''),'sin-ip'));
  v_ip_hash:=encode(sha256(v_xff::bytea),'hex');
  v_bucket:=floor(extract(epoch from clock_timestamp())
    /(60*public._pide_setting_int('pide_rate_ventana_minutos',10)))::bigint::text;
  perform public._pide_rate_golpe('rcg:'||v_bucket||':'||(pg_backend_pid()%8)::text,v_ventana);
  if (select coalesce(sum(golpes),0) from public.pide_rate_counters
      where clave like 'rcg:'||v_bucket||':%')
     > public._pide_setting_int('pide_rate_limit_global',300) then
    return public._pide_error(c_contract,'CHECKOUT_RATE_LIMIT','Demasiados intentos; probá en unos minutos.');
  end if;
  if public._pide_rate_golpe('rcip:'||v_ip_hash,v_ventana)>v_lim then
    return public._pide_error(c_contract,'CHECKOUT_RATE_LIMIT','Demasiados intentos; probá en unos minutos.');
  end if;
  -- La señal de teléfono usa la MISMA normalización canónica que el actor:
  -- '3150000001', '573150000001' y '0057315...' golpean UN solo contador
  -- (con el strip crudo cada formato diluía el límite en un contador propio).
  v_tel_in:=public._normalizar_telefono(coalesce(p->>'telefono',''));
  if v_tel_in is not null then
    v_tel_hash:=encode(sha256(v_tel_in::bytea),'hex');
    if public._pide_rate_golpe('rctel:'||v_tel_hash,v_ventana)
         > public._pide_setting_int('pide_rate_limit_checkout',15)
       and coalesce((select golpes from public.pide_rate_counters
           where clave='rcip:'||v_ip_hash),0) > v_lim/2 then
      return public._pide_error(c_contract,'CHECKOUT_RATE_LIMIT','Demasiados intentos; probá en unos minutos.');
    end if;
  end if;

  -- Del rate limit para abajo el cuerpo corre en un sub-bloque: una excepción
  -- interna NO revierte los golpes ya contados (patrón P02).
  begin

  -- ---- Entrada dura, ANTES de tocar la base. -------------------------------
  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>8192 then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La solicitud no tiene la forma esperada.');
  end if;
  begin
    v_quote_id:=(p->>'quote_id')::uuid;
  exception when others then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La cotización no es válida.');
  end;
  if v_quote_id is null then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La cotización no es válida.');
  end if;
  v_nombre:=btrim(coalesce(p->>'nombre',''));
  v_direccion:=btrim(coalesce(p->>'direccion',''));
  v_barrio:=btrim(coalesce(p->>'barrio',''));
  v_referencia:=btrim(coalesce(p->>'referencia',''));
  begin
    v_opt:=coalesce((p->>'opt_in')::boolean,false);  -- separado, JAMÁS preseleccionado
  exception when others then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La solicitud no tiene la forma esperada.');
  end;
  v_tel:=public._normalizar_telefono(coalesce(p->>'telefono',''));
  if v_tel is null or v_tel !~ '^57[0-9]{10}$' then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','El teléfono no es válido.');
  end if;
  if length(v_nombre) not between 1 and 120
     or length(v_direccion) not between 3 and 240
     or length(v_barrio)>120 or length(v_referencia)>240 then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','Los datos de entrega no son válidos.');
  end if;

  -- ---- Actor + serialización por actor (cabecera: sha256 sin pepper). ------
  v_actor:=encode(sha256(v_tel::bytea),'hex');
  perform pg_advisory_xact_lock(hashtext('pide_actor:'||v_actor));

  -- ---- Quote bajo lock: vigente o nada. ------------------------------------
  select * into v_quote from public.quotes where id=v_quote_id for update;
  if v_quote.id is null or v_quote.canal<>'Pide' or v_quote.estado<>'Vigente' then
    return public._pide_error(c_contract,'QUOTE_VENCIDA','La cotización ya no está vigente; cotizá de nuevo.');
  end if;
  if v_quote.vence_at<=clock_timestamp() then
    update public.quotes set estado='Vencida' where id=v_quote_id;
    return public._pide_error(c_contract,'QUOTE_VENCIDA','La cotización venció; cotizá de nuevo.');
  end if;

  -- ---- Idempotencia y techo "un checkout vivo por actor" (§1.5). -----------
  select * into v_hold_prev from public.checkout_holds
    where quote_id=v_quote_id and estado='Temporal';
  if v_hold_prev.id is not null then
    if v_hold_prev.actor_hmac=v_actor and v_hold_prev.expira_at>clock_timestamp() then
      -- rama perdedora/refresh: devuelve el hold existente y refresca la sesión
      insert into public.checkout_sessions(quote_id,nombre,telefono,direccion,barrio,referencia,opt_in)
      values(v_quote_id,v_nombre,v_tel,v_direccion,v_barrio,v_referencia,v_opt)
      on conflict (quote_id) do update set
        nombre=excluded.nombre,telefono=excluded.telefono,
        direccion=excluded.direccion,barrio=excluded.barrio,
        referencia=excluded.referencia,opt_in=excluded.opt_in;
      return jsonb_build_object('contract',c_contract,
        'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
        'ok',true,'quote_id',v_quote_id,'expira_at',v_hold_prev.expira_at);
    end if;
    -- vencido, o el actor cambió (teléfono editado): se resuelve y se re-toma
    v_extra:=v_extra||v_hold_prev.id;
  end if;
  -- hold vivo del MISMO actor sobre OTRA quote: el nuevo lo invalida (§1.5)
  select * into v_hold_prev from public.checkout_holds
    where actor_hmac=v_actor and estado='Temporal'
      and quote_id<>v_quote_id;
  if v_hold_prev.id is not null then
    v_extra:=v_extra||v_hold_prev.id;
  end if;

  -- ---- Demanda exacta desde las líneas congeladas de la quote. -------------
  -- momo: (product, figura, sabor, cantidad). combo: cada slot de cada caja se
  -- resuelve a su producto canónico H90 vía figuras.product_id. tipo pedido:
  -- se prepara al momento, no aparta stock.
  for v_linea in select * from jsonb_array_elements(coalesce(v_quote.lineas,'[]'::jsonb))
  loop
    if v_linea->>'tipo'<>'producto' then continue; end if;
    select p2.id,p2.tipo,p2.activo,p2.precio_pide into v_prod
      from public.products p2 where p2.id=v_linea->>'product_id';
    if v_prod.id is null or not v_prod.activo or v_prod.precio_pide is null then
      raise exception 'producto no disponible' using errcode='P0301';
    end if;
    if v_prod.tipo='momo' then
      -- La clave de demanda usa '|' como separador: una figura o sabor con
      -- pipe corrompería el parseo de v_partes (defensa contra un dominio
      -- canónico futuro que lo permita; hoy no existe ninguno con pipe).
      if position('|' in coalesce(v_linea#>>'{detalle,figura}','')
          ||coalesce(v_linea#>>'{detalle,sabor}',''))>0 then
        raise exception 'clave con separador' using errcode='P0301';
      end if;
      v_clave:=v_prod.id||'|'||(v_linea#>>'{detalle,figura}')||'|'||(v_linea#>>'{detalle,sabor}');
      v_demanda:=jsonb_set(v_demanda,array[v_clave],
        to_jsonb(coalesce((v_demanda->>v_clave)::integer,0)
          +(v_linea->>'cantidad')::integer));
    elsif v_prod.tipo='combo' then
      for v_box in select * from jsonb_array_elements(coalesce(v_linea#>'{detalle,boxes}','[]'::jsonb))
      loop
        for v_slot in select * from jsonb_array_elements(v_box)
        loop
          if position('|' in coalesce(v_slot->>'figura','')
              ||coalesce(v_slot->>'sabor',''))>0 then
            raise exception 'clave con separador' using errcode='P0301';
          end if;
          select f.product_id into v_clave from public.figuras f
            where f.nombre=v_slot->>'figura' and f.activo
              and exists(select 1 from public.products pc
                where pc.id=f.product_id and pc.activo and pc.tipo='momo');
          if v_clave is null then
            raise exception 'figura no disponible' using errcode='P0301';
          end if;
          v_clave:=v_clave||'|'||(v_slot->>'figura')||'|'||(v_slot->>'sabor');
          v_demanda:=jsonb_set(v_demanda,array[v_clave],
            to_jsonb(coalesce((v_demanda->>v_clave)::integer,0)+1));
        end loop;
      end loop;
    end if;
  end loop;

  select coalesce(array_agg(distinct split_part(k,'|',1)),array[]::text[])
    into v_productos from jsonb_object_keys(v_demanda) k;

  -- ---- Liberación + locks en orden canónico global (cabecera, punto 2). ----
  -- Un solo pase: resuelve el hold previo del actor/quote, libera vencidos de
  -- los productos demandados y bloquea products (unión) por id ascendente.
  -- El array VACÍO de demanda viaja como array vacío (no matchea ningún hold
  -- vencido); null significaría "todos" — esa semántica es SOLO de la purga.
  -- Si el hold nuevo falla después de este punto, el error viaja como raise
  -- P0301/P0302: el savepoint del sub-bloque revierte estas liberaciones y el
  -- hold previo del actor SOBREVIVE — invalidar sin entregar nada a cambio
  -- sería denegación gratis contra un actor forjable.
  if cardinality(v_productos)>0 or cardinality(v_extra)>0 then
    perform public._pide_liberar_holds_interno(
      v_productos,
      case when cardinality(v_extra)=0 then null else v_extra end,
      v_productos);
  end if;

  -- ---- Validación TODO-O-NADA bajo locks, ANTES de mutar nada. -------------
  -- Con el lock del producto en mano, sus lotes no pueden moverse (toda
  -- escritura de lote en el sistema toma primero el lock del producto dueño).
  for v_k in select k from jsonb_object_keys(v_demanda) k order by k
  loop
    v_partes:=string_to_array(v_k,'|');
    v_need:=(v_demanda->>v_k)::integer;
    -- Cobertura SOLO de lotes vigentes: el MISMO filtro del FIFO del hold —
    -- si divergieran, el todo-o-nada validaría unidades que el FIFO no toma
    -- y dispararía la alarma de invariante rota más abajo.
    select coalesce(sum(lf.perfectas-lf.consumidas),0) into v_cobertura
      from public.lote_figuras lf
      join public.production_batches b on b.id=lf.batch_id
      where b.product_id=v_partes[1] and b.estado='Listo' and b.stock_contabilizado
        and (coalesce(b.vencimiento,b.vence) is null
          or coalesce(b.vencimiento,b.vence)>=current_date)
        and b.sabor=v_partes[3] and lf.figura=v_partes[2]
        and (lf.perfectas-lf.consumidas)>0;
    if v_cobertura<v_need then
      raise exception 'sin cobertura de lote' using errcode='P0301';
    end if;
  end loop;
  foreach v_clave in array v_productos
  loop
    select coalesce(sum((value)::text::integer),0) into v_need
      from jsonb_each(v_demanda) where split_part(key,'|',1)=v_clave;
    select coalesce(stock,0) into v_stock from public.products where id=v_clave;
    if v_stock<v_need then
      raise exception 'sin stock agregado' using errcode='P0301';
    end if;
    -- Tope anti-acaparamiento (§1.5): fracción del stock real retenible por
    -- holds no pagados; la respuesta es INDISTINGUIBLE del stock agotado.
    select coalesce(sum(l.cantidad),0) into v_held
      from public.checkout_hold_lotes l
      join public.checkout_holds h on h.id=l.hold_id
      where l.product_id=v_clave and h.estado='Temporal'
        and h.expira_at>clock_timestamp();
    v_frac:=coalesce((select pide_hold_fraccion from public.products where id=v_clave),
      public._pide_setting_num('pide_hold_stock_fraccion',0.5));
    v_base:=v_stock+v_held;
    v_tope:=case when v_frac<=0 then 0 else greatest(1,floor(v_frac*v_base)) end;
    if v_held+v_need>v_tope then
      raise exception 'tope de holds alcanzado' using errcode='P0301';
    end if;
  end loop;

  -- ---- Beneficio de la quote: reservar o invalidar (jamás cobrar de más). --
  if v_quote.benefit_id is not null then
    perform 1 from public.benefits b where b.id=v_quote.benefit_id for update;
    if not exists(select 1 from public.benefits b
        where b.id=v_quote.benefit_id
          and (b.estado='Activo'
            or (b.estado='Reservado' and b.hold_quote_id=v_quote_id))) then
      -- el beneficio ya no está: la quote muere ANTES de cobrar (spec §3.4);
      -- el sello 'Vencida' lo aplica el handler DESPUÉS del savepoint, para
      -- que persista aunque las liberaciones de arriba se reviertan.
      raise exception 'beneficio no disponible' using errcode='P0302';
    end if;
    update public.benefits set estado='Reservado',hold_quote_id=v_quote_id
      where id=v_quote.benefit_id and estado='Activo';
  end if;

  -- ---- Hold + FIFO exacto (validado arriba: no puede fallar). --------------
  v_expira:=clock_timestamp()
    +make_interval(mins=>public._pide_setting_int('pide_hold_ttl_minutos',7));
  insert into public.checkout_holds(quote_id,actor_hmac,estado,expira_original,expira_at)
  values(v_quote_id,v_actor,'Temporal',v_expira,v_expira)
  returning id into v_hold_id;
  for v_k in select k from jsonb_object_keys(v_demanda) k order by k
  loop
    v_partes:=string_to_array(v_k,'|');
    v_rem:=public._pide_asignar_hold_fifo(
      v_hold_id,v_partes[1],v_partes[2],v_partes[3],(v_demanda->>v_k)::integer);
    if v_rem>0 then
      raise exception 'FIFO del hold sin cobertura tras validar bajo locks (%: faltan %): invariante rota.',v_k,v_rem;
    end if;
  end loop;
  foreach v_clave in array v_productos
  loop
    select coalesce(sum((value)::text::integer),0) into v_need
      from jsonb_each(v_demanda) where split_part(key,'|',1)=v_clave;
    update public.products set stock=coalesce(stock,0)-v_need where id=v_clave;
  end loop;

  -- ---- Sesión del invitado (PII en tabla deny-all; purga P01 la gobierna). -
  insert into public.checkout_sessions(quote_id,nombre,telefono,direccion,barrio,referencia,opt_in)
  values(v_quote_id,v_nombre,v_tel,v_direccion,v_barrio,v_referencia,v_opt)
  on conflict (quote_id) do update set
    nombre=excluded.nombre,telefono=excluded.telefono,
    direccion=excluded.direccion,barrio=excluded.barrio,
    referencia=excluded.referencia,opt_in=excluded.opt_in;

  return jsonb_build_object('contract',c_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'quote_id',v_quote_id,'expira_at',v_expira);
  exception
    when sqlstate 'P0301' then
      -- Disponibilidad insuficiente (producto/figura/lote/stock/tope): el
      -- savepoint ya revirtió liberaciones y mutaciones parciales. La causa
      -- exacta es INDISTINGUIBLE a propósito (anti-oráculo de stock).
      return public._pide_error(c_contract,'SIN_DISPONIBILIDAD','No pudimos apartar los productos; probá de nuevo en unos minutos.');
    when sqlstate 'P0302' then
      update public.quotes set estado='Vencida'
        where id=v_quote_id and estado='Vigente';
      return public._pide_error(c_contract,'QUOTE_VENCIDA','La cotización ya no es válida; cotizá de nuevo.');
    when deadlock_detected or lock_not_available then
      -- Cabecera: el ciclo ABBA con _atender_cola_produccion pre-existe en el
      -- carril OPS; acá la respuesta es limpia y reintentable, jamás una
      -- alarma de invariante ni un ENTRADA_INVALIDA engañoso.
      return public._pide_error(c_contract,'REINTENTAR','Hay mucho movimiento en la tienda; probá de nuevo en unos segundos.');
    when unique_violation then
      -- Hold veneno del propio actor o de la quote: el núcleo lo aisló como
      -- irreconciliable (sigue Temporal) y el hold nuevo chocó con el UNIQUE
      -- parcial. Señal tipificada para operación; al cliente, indisponibilidad
      -- honesta (no es un payload malformado y no debe parecerlo).
      raise warning 'reservar_checkout_v1: unique_violation con hold veneno probable (quote %, actor %).',v_quote_id,v_actor;
      return public._pide_error(c_contract,'SIN_DISPONIBILIDAD','No pudimos apartar los productos; probá de nuevo en unos minutos.');
    when others then
      raise warning 'reservar_checkout_v1: %',sqlerrm;
      return public._pide_error(c_contract,'ENTRADA_INVALIDA','No pudimos procesar la solicitud.');
  end;
end $$;

-- ============================================================================
-- iniciar_pago_v1 — abre el intent idempotente y extiende el hold UNA vez.
-- La vigencia de la quote se valida AL INICIAR el cobro (jerarquía de relojes
-- §7); desde ahí el hold cubre la ventana de la pasarela.
-- ============================================================================
create function public.iniciar_pago_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  c_contract constant text:='momos.pide.intent.v1';
  v_ventana interval;
  v_headers jsonb; v_xff text; v_ip_hash text; v_bucket text; v_lim integer;
  v_quote_id uuid;
  v_quote public.quotes%rowtype;
  v_hold public.checkout_holds%rowtype;
  v_proveedor text;
  v_pago public.payments%rowtype;
  v_nueva timestamptz;
begin
  -- ---- Rate limit (defensa de costo) — ANTES de todo. ----------------------
  v_ventana:=make_interval(mins=>public._pide_setting_int('pide_rate_ventana_minutos',10));
  v_lim:=public._pide_setting_int('pide_rate_limit_pago',15);
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers:='{}'::jsonb; end;
  v_xff:=coalesce(v_headers->>'x-forwarded-for','');
  v_xff:=btrim(coalesce(nullif(split_part(v_xff,',',
    greatest(1,coalesce(array_length(string_to_array(v_xff,','),1),1))),''),'sin-ip'));
  v_ip_hash:=encode(sha256(v_xff::bytea),'hex');
  v_bucket:=floor(extract(epoch from clock_timestamp())
    /(60*public._pide_setting_int('pide_rate_ventana_minutos',10)))::bigint::text;
  perform public._pide_rate_golpe('pgg:'||v_bucket||':'||(pg_backend_pid()%8)::text,v_ventana);
  if (select coalesce(sum(golpes),0) from public.pide_rate_counters
      where clave like 'pgg:'||v_bucket||':%')
     > public._pide_setting_int('pide_rate_limit_global',300) then
    return public._pide_error(c_contract,'PAGO_RATE_LIMIT','Demasiados intentos; probá en unos minutos.');
  end if;
  if public._pide_rate_golpe('pgip:'||v_ip_hash,v_ventana)>v_lim then
    return public._pide_error(c_contract,'PAGO_RATE_LIMIT','Demasiados intentos; probá en unos minutos.');
  end if;

  begin

  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>2048 then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La solicitud no tiene la forma esperada.');
  end if;
  begin
    v_quote_id:=(p->>'quote_id')::uuid;
  exception when others then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La cotización no es válida.');
  end;
  if v_quote_id is null then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La cotización no es válida.');
  end if;

  -- ---- Quote vigente AL INICIAR el cobro. ----------------------------------
  select * into v_quote from public.quotes where id=v_quote_id for update;
  if v_quote.id is null or v_quote.canal<>'Pide' or v_quote.estado<>'Vigente' then
    return public._pide_error(c_contract,'QUOTE_VENCIDA','La cotización ya no está vigente; cotizá de nuevo.');
  end if;
  if v_quote.vence_at<=clock_timestamp() then
    update public.quotes set estado='Vencida' where id=v_quote_id;
    return public._pide_error(c_contract,'QUOTE_VENCIDA','La cotización venció; cotizá de nuevo.');
  end if;

  -- ---- Hold vivo bajo lock — HOLD_VENCIDO antes de crear el intent. --------
  select * into v_hold from public.checkout_holds
    where quote_id=v_quote_id and estado='Temporal'
    for update;
  if v_hold.id is null or v_hold.expira_at<=clock_timestamp() then
    return public._pide_error(c_contract,'HOLD_VENCIDO','La reserva del checkout venció; volvé a confirmar tus productos.');
  end if;

  -- ---- Pasarela: sin decisión de negocio no se abre ningún intent. ---------
  v_proveedor:=btrim(coalesce((select valor #>> '{}' from public.app_settings
    where clave='pide_pasarela_proveedor'),''));
  if v_proveedor !~ '^[a-z0-9_]{2,40}$' then
    return public._pide_error(c_contract,'PAGO_NO_DISPONIBLE','El pago en línea aún no está habilitado.');
  end if;

  -- ---- Idempotencia por quote: un solo intent vivo o aprobado. -------------
  select * into v_pago from public.payments
    where quote_id=v_quote_id and estado in ('Iniciado','Aprobado')
    for update;
  if v_pago.id is null then
    begin
      insert into public.payments(quote_id,proveedor,monto,moneda,estado)
      values(v_quote_id,v_proveedor,v_quote.total,'COP','Iniciado')
      returning * into v_pago;
    exception when unique_violation then
      -- carrera legítima: la rama perdedora devuelve el intent del ganador
      select * into v_pago from public.payments
        where quote_id=v_quote_id and estado in ('Iniciado','Aprobado');
      if v_pago.id is null then
        return public._pide_error(c_contract,'ENTRADA_INVALIDA','No pudimos procesar la solicitud.');
      end if;
    end;
    -- ---- Extensión del hold: UNA sola vez, bajo el lock ya tomado. ---------
    if v_pago.estado='Iniciado' and v_hold.extendido_por_pago_at is null then
      v_nueva:=clock_timestamp()
        +make_interval(mins=>public._pide_setting_int('pide_hold_extension_minutos',10));
      if v_nueva>v_hold.expira_at then
        update public.checkout_holds
          set expira_at=v_nueva,extendido_por_pago_at=clock_timestamp()
          where id=v_hold.id;
        v_hold.expira_at:=v_nueva;
      end if;
    end if;
  end if;

  return jsonb_build_object('contract',c_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'payment_id',v_pago.id,'proveedor',v_pago.proveedor,
    'monto',v_pago.monto,'moneda',v_pago.moneda,'estado',v_pago.estado,
    'quote_id',v_quote_id,'hold_expira_at',v_hold.expira_at);
  exception
    when deadlock_detected or lock_not_available then
      return public._pide_error(c_contract,'REINTENTAR','Hay mucho movimiento en la tienda; probá de nuevo en unos segundos.');
    when others then
      raise warning 'iniciar_pago_v1: %',sqlerrm;
      return public._pide_error(c_contract,'ENTRADA_INVALIDA','No pudimos procesar la solicitud.');
  end;
end $$;

-- ============================================================================
-- Reaper de intents Iniciado abandonados (privacidad §1.2/H89). La purga P01
-- EXCLUYE toda quote con fila en payments: sin este reaper, un intent
-- abandonado retendría la sesión del invitado (PII completa) para siempre.
-- Pasado el TTL sin resolución de pasarela: el intent pasa a Expirado
-- (terminal, libera el slot del UNIQUE parcial), la quote Vigente se sella
-- Vencida, el checkout se anonimiza (delegación VERBATIM en
-- _pide_anonimizar_checkout, md5 verificado en el preflight) y el beneficio
-- que la liberación retuvo por el intent vivo vuelve a Activo.
-- Orden de locks: quotes (id asc) → payments — el MISMO del camino público.
-- ============================================================================
create function public._pide_reaper_intents_v1(p_minutos integer default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_min integer;
  v_piso integer;
  v_ids uuid[];
  v_pago record;
  v_expirados integer:=0;
  v_anonimizados integer:=0;
  v_saltados integer:=0;
begin
  v_min:=coalesce(p_minutos,public._pide_setting_int('pide_intent_ttl_minutos',60));
  -- Fail closed (patrón purga P01): el TTL debe superar la ventana COMPLETA de
  -- la pasarela (hold + extensión) — jamás expirar un cobro posiblemente vivo —
  -- y quedar dentro de un día — jamás convertirse en retención encubierta.
  v_piso:=public._pide_setting_int('pide_hold_ttl_minutos',7)
    +public._pide_setting_int('pide_hold_extension_minutos',10);
  if v_min<v_piso or v_min>1440 then
    raise exception 'El TTL del reaper debe estar entre % y 1440 minutos.',v_piso;
  end if;

  -- Candidatas SIN lock; la verdad se re-verifica bajo los locks de abajo.
  select array_agg(s.qid) into v_ids from (
    select p.quote_id as qid from public.payments p
    where p.estado='Iniciado'
      and p.creado_at<clock_timestamp()-make_interval(mins=>v_min)
    order by p.quote_id
  ) s;
  if v_ids is null then
    return jsonb_build_object('ok',true,'intentsExpirados',0,
      'checkoutsAnonimizados',0,'saltados',0,
      'containsCustomerPii',false,'containsSecrets',false);
  end if;

  -- Locks en orden canónico: quotes (id asc) primero. SKIP LOCKED preserva
  -- liveness frente al camino público y a otros reapers concurrentes.
  select array_agg(s.id) into v_ids from (
    select q.id from public.quotes q
    where q.id=any(v_ids)
    order by q.id
    for update skip locked
  ) s;
  if v_ids is null then
    return jsonb_build_object('ok',true,'intentsExpirados',0,
      'checkoutsAnonimizados',0,'saltados',0,
      'containsCustomerPii',false,'containsSecrets',false);
  end if;

  for v_pago in
    select p.* from public.payments p
    where p.quote_id=any(v_ids) and p.estado='Iniciado'
      and p.creado_at<clock_timestamp()-make_interval(mins=>v_min)
    order by p.quote_id
    for update skip locked
  loop
    begin
      -- Guards re-verificados bajo lock: jamás expirar un intent con pedido
      -- sellado, con quote Usada o con un hold vivo (webhook posiblemente en
      -- vuelo) — esos casos son de conciliación, no de expiración.
      if v_pago.order_id is not null
         or exists(select 1 from public.quotes q
             where q.id=v_pago.quote_id and q.estado='Usada')
         or exists(select 1 from public.checkout_holds h
             where h.quote_id=v_pago.quote_id and h.estado='Temporal'
               and h.expira_at>clock_timestamp()) then
        v_saltados:=v_saltados+1;
        raise warning 'Intent % con señales vivas: se salta y se concilia aparte.',v_pago.id;
        continue;
      end if;
      update public.payments
        set estado='Expirado',actualizado_at=clock_timestamp()
        where id=v_pago.id and estado='Iniciado';
      v_expirados:=v_expirados+1;
      update public.quotes set estado='Vencida'
        where id=v_pago.quote_id and estado='Vigente';
      -- El beneficio que la liberación retuvo mientras el intent vivía: con el
      -- intent ya Expirado (terminal) vuelve a Activo — cero doble canje.
      update public.benefits b
        set estado='Activo',hold_quote_id=null
        where b.hold_quote_id=v_pago.quote_id
          and b.estado='Reservado' and b.pedido_uso is null;
      perform public._pide_anonimizar_checkout(v_pago.quote_id);
      v_anonimizados:=v_anonimizados+1;
    exception when others then
      v_saltados:=v_saltados+1;
      raise warning 'Intent % irreconciliable (%): se reintenta el próximo ciclo.',v_pago.id,sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ok',true,'intentsExpirados',v_expirados,
    'checkoutsAnonimizados',v_anonimizados,'saltados',v_saltados,
    'containsCustomerPii',false,'containsSecrets',false);
end $$;

-- Superficie del job privado (patrón purgar_checkout_efimero_v1): el claim
-- service_role gatea; el núcleo queda cerrado a todos los roles.
create function public.purgar_intents_pide_v1(p_minutos integer default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el job privado puede purgar intents de Pide.';
  end if;
  return public._pide_reaper_intents_v1(p_minutos);
end $$;

-- ============================================================================
-- Cableado de la liberación perezosa en _reserve_inventory (staff): cuerpo
-- vivo verificado por md5 en el preflight + prólogo P03. El prólogo corre
-- ANTES de cualquier lock de producto y delega en el núcleo, que bloquea la
-- unión (holds vencidos + productos del pedido) en el orden canónico global —
-- los locks de producto del resto de la función ya quedan adquiridos.
-- ============================================================================
create or replace function _reserve_inventory(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  comp record;
  addd record;
  v_toma numeric;
  v_necesita numeric;
  v_req numeric;
  v_stock_actual numeric;
  v_tiene_hijas boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_sugerencias_texto text := '';
  v_compras_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_remanente integer;
  v_pide_productos text[];
begin
  -- P03: liberar los holds Pide vencidos de los productos de este pedido ANTES
  -- de tomar cualquier lock de producto (quiebre fantasma del mostrador). El
  -- núcleo bloquea products por id asc y después lote_figuras (batch,figura);
  -- pasar la demanda como p_lock_productos deja pre-adquiridos los locks que
  -- esta función toma más abajo.
  select array_agg(distinct x.pid) into v_pide_productos from (
    select oi.product_id as pid
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
    union
    select cc.component_id
    from order_items oi
    join products p on p.id = oi.product_id and p.tipo = 'combo'
    join combo_components cc on cc.combo_id = oi.product_id
    where oi.order_id = p_order_id
  ) x;
  if v_pide_productos is not null then
    perform public._pide_liberar_holds_interno(
      v_pide_productos, null, v_pide_productos);
  end if;

  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre, oi.figura, oi.sabor
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
  loop
    select stock into v_stock_actual from products where id = item.product_id for update;
    v_toma := least(coalesce(v_stock_actual,0), item.cant);
    update products set stock = coalesce(stock,0) - v_toma where id = item.product_id;
    if v_toma > 0 then
      v_remanente := _asignar_variante_fifo(
        p_order_id, item.product_id, item.figura, item.sabor,
        round(v_toma)::integer, item.nombre
      );
      if v_remanente > 0 then
        if nullif(trim(coalesce(item.figura,'')), '') is not null
           or nullif(trim(coalesce(item.sabor,'')), '') is not null then
          update products set stock = coalesce(stock,0) + v_remanente where id = item.product_id;
          v_toma := v_toma - v_remanente;
        else
          perform _add_reservation(p_order_id, 'producto', item.product_id, null, item.nombre, v_remanente);
        end if;
      end if;
    end if;
    if v_toma < item.cant then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto', item.nombre, 'cant', item.cant - v_toma, 'area', 'Producción');
      v_sugerencias_texto := v_sugerencias_texto
        || case when v_sugerencias_texto = '' then '' else ', ' end
        || (item.cant - v_toma) || '× ' || item.nombre;
      insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area, order_item_id)
      values (next_id('suggestion','S-',0), v_hoy, item.product_id,
              item.cant - v_toma, 'Faltante al reservar pedido ' || p_order_id, p_order_id, 'Producción', item.id);
    end if;
  end loop;

  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'combo'
  loop
    select exists(select 1 from order_items where parent_item_id = item.id) into v_tiene_hijas;

    if not v_tiene_hijas then
      select combo_size into v_necesita from products where id = item.product_id;
      v_necesita := v_necesita * item.cant;
      for comp in
        select cc.component_id, pr.nombre as comp_nombre
        from combo_components cc join products pr on pr.id = cc.component_id
        where cc.combo_id = item.product_id
      loop
        exit when v_necesita <= 0;
        select stock into v_stock_actual from products where id = comp.component_id for update;
        v_toma := least(coalesce(v_stock_actual,0), v_necesita);
        update products set stock = coalesce(stock,0) - v_toma where id = comp.component_id;
        if v_toma > 0 then
          v_remanente := _asignar_variante_fifo(
            p_order_id, comp.component_id, null, null,
            round(v_toma)::integer, comp.comp_nombre || ' (para ' || item.nombre || ')'
          );
          if v_remanente > 0 then
            perform _add_reservation(p_order_id, 'producto', comp.component_id, null,
              comp.comp_nombre || ' (para ' || item.nombre || ')', v_remanente);
          end if;
        end if;
        v_necesita := v_necesita - v_toma;
      end loop;
      if v_necesita > 0 then
        v_faltantes := v_faltantes || jsonb_build_object(
          'producto', 'Momos para ' || item.nombre, 'cant', v_necesita, 'area', 'Producción');
        v_sugerencias_texto := v_sugerencias_texto
          || case when v_sugerencias_texto = '' then '' else ', ' end
          || v_necesita || '× Momos para ' || item.nombre;
        insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
        values (next_id('suggestion','S-',0), v_hoy, item.product_id, v_necesita,
                'Faltante al reservar pedido ' || p_order_id || ' (Momos para ' || item.nombre || ')',
                p_order_id, 'Producción');
      end if;
    end if;

    declare
      v_empaque_id text;
      v_empaque_nombre text;
      v_empaque_stock numeric;
    begin
      select empaque_item_id into v_empaque_id from products where id = item.product_id;
      select nombre, stock into v_empaque_nombre, v_empaque_stock from inventory_items where id = v_empaque_id for update;
      v_toma := least(coalesce(v_empaque_stock,0), item.cant);
      update inventory_items set stock = round(stock - v_toma, 2) where id = v_empaque_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'empaque', null, v_empaque_id, v_empaque_nombre, v_toma);
        perform _add_movement('Salida', v_empaque_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < item.cant then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', v_empaque_id, 'producto', v_empaque_nombre, 'cant', item.cant - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (item.cant - v_toma) || '× ' || v_empaque_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, item.cant - v_toma,
                'Faltante de empaque al reservar pedido ' || p_order_id, p_order_id, 'Inventario', v_empaque_id);
      end if;
    end;

    for comp in
      select r.item_id, r.cantidad, it.nombre as it_nombre
      from recipes r join inventory_items it on it.id = r.item_id
      where r.product_id = item.product_id
    loop
      v_req := comp.cantidad * item.cant;
      select stock into v_stock_actual from inventory_items where id = comp.item_id for update;
      v_toma := least(coalesce(v_stock_actual,0), v_req);
      update inventory_items set stock = round(stock - v_toma, 3) where id = comp.item_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'insumo', null, comp.item_id, comp.it_nombre, v_toma);
        perform _add_movement('Salida', comp.item_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < v_req then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', comp.item_id, 'producto', comp.it_nombre, 'cant', v_req - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (v_req - v_toma) || '× ' || comp.it_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
                'Faltante de insumo al reservar pedido ' || p_order_id, p_order_id, 'Inventario', comp.item_id);
      end if;
    end loop;
  end loop;

  for addd in
    select a.id, a.nombre, a.insumo_id, a.insumo_cant, a.cant as ad_cant,
           oi.cant as item_cant, it.nombre as insumo_nombre
    from order_item_adiciones a
    join order_items oi on oi.id = a.order_item_id
    join inventory_items it on it.id = a.insumo_id
    where oi.order_id = p_order_id and a.insumo_id is not null
  loop
    v_req := addd.insumo_cant * addd.ad_cant * addd.item_cant;
    select stock into v_stock_actual from inventory_items where id = addd.insumo_id for update;
    v_toma := least(coalesce(v_stock_actual,0), v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = addd.insumo_id;
    if v_toma > 0 then
      perform _add_reservation(p_order_id, 'insumo', null, addd.insumo_id,
        addd.insumo_nombre || ' (adición ' || addd.nombre || ')', v_toma);
      perform _add_movement('Salida', addd.insumo_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', addd.insumo_id, 'producto', addd.insumo_nombre || ' (adición ' || addd.nombre || ')',
        'cant', v_req - v_toma, 'area', 'Inventario');
      v_compras_texto := v_compras_texto
        || case when v_compras_texto = '' then '' else ', ' end
        || (v_req - v_toma) || '× ' || addd.insumo_nombre;
      insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
      values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
              'Faltante de insumo (adición ' || addd.nombre || ') al reservar pedido ' || p_order_id,
              p_order_id, 'Inventario', addd.insumo_id);
    end if;
  end loop;

  if v_sugerencias_texto <> '' then
    perform _add_audit('Producción', p_order_id, 'Sugerencia de producción creada', '', v_sugerencias_texto);
  end if;
  if v_compras_texto <> '' then
    perform _add_audit('Inventario', p_order_id, 'Compra sugerida creada', '', v_compras_texto);
  end if;
  return v_faltantes;
end $$;

-- ============================================================================
-- Perímetro y RBAC: las DOS RPC nuevas son la única superficie pública nueva;
-- el núcleo, el FIFO del hold y los helpers quedan cerrados. Se re-sella lo
-- reemplazado (create or replace conserva ACLs, pero el sello explícito es la
-- evidencia del gate).
-- ============================================================================
revoke all on function public._pide_liberar_holds_interno(text[],uuid[],text[])
  from public,anon,authenticated,service_role;
revoke all on function public._pide_liberar_holds_vencidos(text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_asignar_hold_fifo(uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_error(text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_setting_num(text,numeric)
  from public,anon,authenticated,service_role;
revoke all on function public.reservar_checkout_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.iniciar_pago_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_reaper_intents_v1(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.purgar_intents_pide_v1(integer)
  from public,anon,authenticated,service_role;
revoke execute on function _reserve_inventory(text) from public, anon, authenticated;
grant execute on function public.reservar_checkout_v1(jsonb) to anon,authenticated;
grant execute on function public.iniciar_pago_v1(jsonb) to anon,authenticated;
grant execute on function public.purgar_intents_pide_v1(integer) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_p03_pide_checkout',
  'Checkout Pide: hold todo-o-nada con FIFO exacto y vigente por lote, techos anti-acaparamiento, intent de pago idempotente con extension unica del hold, pasarela fail-closed sin decision de negocio, reaper de intents abandonados con anonimizacion y liberacion perezosa cableada en _reserve_inventory con orden global de locks')
on conflict(id) do nothing;

commit;
