-- MOMOS · Carril Pide · P04 pide-pedido-v1
--
-- El pedido público: del pago aprobado y firmado al pedido operativo de MOMO OPS
-- (docs/PIDE-SUPERFICIE-PUBLICA-V1.md §2 «Evolución de RPCs núcleo»,
-- «crear_pedido_publico_v1», «Webhook», «tracking_publico_v1»; alcance §4.4;
-- requisito sellado 3 del README del carril):
--   * evolución SELLADA de _crear_pedido_core y _set_order_status_core: la vía
--     service existe SOLO dentro del contexto transaccional que arma
--     crear_pedido_publico_v1 (GUC local momos.pide_ctx); las envolturas
--     públicas conservan is_staff()/matriz de roles intactas y el canal Pide
--     queda PROHIBIDO para staff (jamás se fabrica un pedido Pide a mano);
--   * gate [Pagado] POR CANAL: para 'Pide' la evidencia es el payment_event
--     firmado con monto exacto — la foto de comprobante no aplica; para el
--     resto de canales el gate vigente queda intacto;
--   * crear_pedido_publico_v1 (rol dedicado pide_service, patrón claude_agent,
--     JAMÁS service_role): gate de datos (evento firmado + monto exacto),
--     idempotency_key DETERMINÍSTICA (uuid v5 del payment_id — una
--     re-notificación con external_event_id nuevo produce el MISMO pedido),
--     precios/descuento/domicilio CONGELADOS de la quote (el pedido reproduce
--     exactamente lo cobrado o REVIENTA a conciliación), beneficio resuelto por
--     la propia RPC (el descarte silencioso del core queda prohibido en esta
--     rama), promoción de holds SIN re-correr FIFO (checkout_hold_lotes →
--     inventory_reservations con batch exacto) + patas que el hold no cubre
--     (empaque/insumos, espejo verbatim de _reserve_inventory), sello de
--     orders.fecha_entrega + orders.franja desde la quote (requisito 3),
--     token de tracking v4 y anonimización del checkout al cierre;
--   * registrar_evento_pago_v1: registro idempotente por
--     (payment_id, external_event_id); la FIRMA sobre el raw body (tiempo
--     constante, frescura ±5 min, rotación con dos secretos y key-id) la
--     verifica el WORKER privado — los secretos jamás viven en la base — y la
--     base sella lo atestado (firma_ok exige key_id + evento_ts), aplica la
--     máquina de estados de payments (guard P01) y el efecto por tipo:
--     Aprobado crea el pedido en SUB-BLOQUE AISLADO (si el pedido falla, el
--     evento SOBREVIVE y el pago queda Aprobado sin pedido = cola de
--     conciliación; un reintento legítimo lo recupera), Rechazado devuelve el
--     hold a su expira_original (reversa exacta del guard), Reembolso registra
--     y deja la decisión del pedido a conciliación humana;
--   * tracking_publico_v1 (anon): token opaco, mapping COMPLETO — Cancelado
--     distingue reembolso en proceso/realizado según payments, Reclamo mantiene
--     el último estado logístico público (coherente con fix_retroceso_reclamo)
--     — degradación post-Entregado (solo estado final), expiración perezosa a
--     N días de la entrega y rate limit; jamás dirección, nombre ni teléfono.
--
-- Decisiones técnicas EXPLÍCITAS (para el gate y para Jorge):
--   * pide_service: rol Postgres propio LOGIN NOINHERIT (patrón claude_agent,
--     schema-v5.sql:751). El password se setea EN EL DEPLOY (jamás se
--     comitea): alter role pide_service password '…'. Sin grants de tabla:
--     solo EXECUTE en sus dos RPC (superficie de lista cerrada).
--   * El secreto del webhook (dos claves vigentes + key-id) vive SOLO en el
--     runtime privado del worker. La base NO puede verificar la firma sin
--     tener el secreto (y tenerlo la volvería el punto de fuga): registra
--     firma_ok atestado por el worker y lo EXIGE para todo efecto.
--   * order_tracking_tokens ENTRA al guard H89 (pendiente README resuelto en
--     la dirección protectora: más tablas cerradas, no menos; tocar la lista
--     sellada de la spec §1.9 queda documentado para ratificación de Jorge).
--   * _pide_reservar_pedido_patas es espejo VERBATIM de las patas de
--     empaque/insumos/adiciones de _reserve_inventory; _reserve_inventory NO
--     se toca (cero riesgo staff). Regla sellada: todo cambio futuro a esas
--     patas se replica en ambos lados (README).
--
-- Aplicar a la base viva requiere aprobación explícita de Jorge.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

-- ============================================================================
-- Preflight: falla cerrado si la base no es EXACTAMENTE la verificada
-- (md5 capturados de staging clon de producción, 2026-07-22).
-- ============================================================================
do $$
declare t text; v_md5 text; v_def text;
begin
  -- Ancla del carril: P03 aplicado; P04 no re-aplicable.
  if not exists(select 1 from public.momos_ops_migrations
    where id='20260722_p03_pide_checkout') then
    raise exception 'P04 requiere 20260722_p03_pide_checkout aplicado en la base.';
  end if;
  if exists(select 1 from public.momos_ops_migrations
    where id='20260722_p04_pide_pedido') then
    raise exception 'P04 ya está aplicado; este hito no se reaplica.';
  end if;

  -- Tablas de las que dependen los cuerpos de P04.
  foreach t in array array[
    'orders','order_items','order_item_adiciones','customers','benefits',
    'quotes','checkout_sessions','checkout_holds','checkout_hold_lotes',
    'payments','payment_events','order_tracking_tokens','order_attributions',
    'inventory_reservations','inventory_items','recipes','campaigns','creatives',
    'deliveries','audit_logs','production_suggestions','zonas','franjas',
    'app_settings','pide_rate_counters','products','figuras','combo_components',
    'catalog_values'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Falta la tabla base %.',t;
    end if;
  end loop;

  -- Columnas que los cuerpos nuevos leen/escriben (CREATE FUNCTION no valida).
  foreach t in array array[
    'orders.fecha_entrega','orders.franja','orders.idempotency_key',
    'orders.inventario_reservado','orders.insumos_descontados','orders.pagado_en',
    'orders.comprobante','orders.campaign_id','orders.creative_id',
    'orders.origen_detalle','orders.benefit_id','orders.descuento',
    'payments.order_id','payments.external_id','payments.monto','payments.estado',
    'payment_events.external_event_id','payment_events.tipo','payment_events.firma_ok',
    'payment_events.key_id','payment_events.payload_hash','payment_events.evento_ts',
    'payment_events.monto_reportado','payment_events.procesado_at','payment_events.resultado',
    'order_tracking_tokens.token','order_tracking_tokens.estado',
    'order_tracking_tokens.expira_at','order_tracking_tokens.invalidado_at',
    'quotes.lineas','quotes.total','quotes.zona','quotes.franja',
    'quotes.fecha_entrega','quotes.benefit_id','quotes.atribucion','quotes.estado',
    'checkout_sessions.nombre','checkout_sessions.telefono','checkout_sessions.direccion',
    'checkout_sessions.barrio','checkout_sessions.referencia',
    'checkout_holds.estado','checkout_holds.expira_original','checkout_holds.expira_at',
    'checkout_holds.extendido_por_pago_at','checkout_holds.resuelto_at',
    'checkout_hold_lotes.batch_id','checkout_hold_lotes.figura','checkout_hold_lotes.cantidad',
    'benefits.hold_quote_id','benefits.pedido_uso','benefits.tipo_beneficio',
    'benefits.producto_gratis_id','audit_logs.fecha'
  ] loop
    if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name=split_part(t,'.',1)
        and column_name=split_part(t,'.',2)) then
      raise exception 'Falta la columna base %.',t;
    end if;
  end loop;

  -- Funciones base vivas.
  if to_regprocedure('public._crear_pedido_core(jsonb)') is null
     or to_regprocedure('public._set_order_status_core(text,text,boolean)') is null
     or to_regprocedure('public.crear_pedido(jsonb)') is null
     or to_regprocedure('public.set_order_status(text,text,boolean)') is null
     or to_regprocedure('public._reserve_inventory(text)') is null
     or to_regprocedure('public._add_reservation(text,text,text,text,text,numeric)') is null
     or to_regprocedure('public._add_movement(text,text,numeric,text,text,text)') is null
     or to_regprocedure('public._add_audit(text,text,text,text,text)') is null
     or to_regprocedure('public._tiene_evidencia(text,text)') is null
     or to_regprocedure('public._order_subtotal(text)') is null
     or to_regprocedure('public._normalizar_telefono(text)') is null
     or to_regprocedure('public.next_id(text,text,integer)') is null
     or to_regprocedure('public._pide_liberar_holds_interno(text[],uuid[],text[])') is null
     or to_regprocedure('public._pide_anonimizar_checkout(uuid)') is null
     or to_regprocedure('public._pide_error(text,text,text)') is null
     or to_regprocedure('public._pide_setting_int(text,integer)') is null
     or to_regprocedure('public._pide_rate_golpe(text,interval)') is null
     or to_regprocedure('public.is_staff()') is null
     or to_regprocedure('public.cierre_lecturas_pii_disponible()') is null then
    raise exception 'Faltan funciones base OPS/P01-P03 para el pedido público.';
  end if;

  -- Las funciones que P04 REEMPLAZA o ESPEJA deben ser EXACTAMENTE las
  -- verificadas (staging clon de producción, 2026-07-22). Un md5 distinto
  -- significa que otro carril las movió: se investiga y se re-captura, jamás
  -- se fuerza.
  v_md5:=md5(pg_get_functiondef('public._crear_pedido_core(jsonb)'::regprocedure));
  if v_md5 is distinct from 'eef5cfe92efd88df21e305e590fe5760' then
    raise exception '_crear_pedido_core difiere del verificado (md5 vivo: %). Re-capturar el cuerpo vivo y regenerar la evolución sellada antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._set_order_status_core(text,text,boolean)'::regprocedure));
  if v_md5 is distinct from 'bbce411531097fd0a6b22e098688a0db' then
    raise exception '_set_order_status_core difiere del verificado (md5 vivo: %). Re-capturar el cuerpo vivo y regenerar la evolución sellada antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public.crear_pedido(jsonb)'::regprocedure));
  if v_md5 is distinct from '898bdafa80cccaa599ac194378b33e24' then
    raise exception 'La envoltura crear_pedido difiere de la verificada (md5 vivo: %). P04 asume que delega en _crear_pedido_core con matriz de roles.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public.set_order_status(text,text,boolean)'::regprocedure));
  if v_md5 is distinct from 'e6367e9cfddfbf5b6506e045e079508c' then
    raise exception 'La envoltura set_order_status difiere de la verificada (md5 vivo: %). P04 asume que delega en _set_order_status_core con matriz de roles.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._reserve_inventory(text)'::regprocedure));
  if v_md5 is distinct from 'a87ee89cce4faf5ac5896af4069d7d2b' then
    raise exception '_reserve_inventory difiere del P03 verificado (md5 vivo: %). Las patas de _pide_reservar_pedido_patas son su espejo: re-verificar la equivalencia antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._pide_anonimizar_checkout(uuid)'::regprocedure));
  if v_md5 is distinct from 'fe2693eff1ce8d97023fe81cdc2f85ac' then
    raise exception '_pide_anonimizar_checkout difiere del P01 verificado (md5 vivo: %).',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public._asignar_variante_fifo(text,text,text,text,integer,text)'::regprocedure));
  if v_md5 is distinct from 'e2d147b0a41e1bf540bf0f84b9ac1817' then
    raise exception '_asignar_variante_fifo difiere del verificado (md5 vivo: %). La promoción de holds y el leg del regalo espejan su insert: re-verificar la equivalencia antes del gate.',v_md5;
  end if;
  v_md5:=md5(pg_get_functiondef('public.cierre_lecturas_pii_disponible()'::regprocedure));
  if v_md5 is distinct from 'a9fc48eeb6dcebb06280adc326d2aeed' then
    raise exception 'cierre_lecturas_pii_disponible() difiere del P01 verificado (md5 vivo: %). No forzar: re-capturar el guard vivo, auditar el cambio y regenerar este hash.',v_md5;
  end if;

  -- CHECK vivos que los cuerpos nuevos asumen (definición EXACTA).
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_pago_check';
  if v_def is distinct from
    'CHECK ((pago = ANY (ARRAY[''Nequi''::text, ''Daviplata''::text, ''Bancolombia''::text, ''Rappi (app)''::text, ''Pasarela (web)''::text])))' then
    raise exception 'orders_pago_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;
  if not exists(select 1 from pg_constraint
      where conrelid='public.orders'::regclass and conname='orders_canal_check'
        and pg_get_constraintdef(oid) like '%''Pide''%') then
    raise exception 'orders_canal_check no incluye Pide: P01 ausente o alterado.';
  end if;

  -- Los objetos P04 NO deben existir (residuo = base desconocida).
  if to_regprocedure('public._pide_service_ctx()') is not null
     or to_regprocedure('public._pide_uuid5(text)') is not null
     or to_regprocedure('public._pide_promover_holds(uuid,text)') is not null
     or to_regprocedure('public._pide_reservar_pedido_patas(text)') is not null
     or to_regprocedure('public._pide_reservar_item_regalo(text,text)') is not null
     or to_regprocedure('public.crear_pedido_publico_v1(jsonb)') is not null
     or to_regprocedure('public.registrar_evento_pago_v1(jsonb)') is not null
     or to_regprocedure('public.tracking_publico_v1(jsonb)') is not null then
    raise exception 'Objetos P04 ya presentes: base fuera del estado esperado.';
  end if;
  if exists(select 1 from pg_roles where rolname='pide_service') then
    raise exception 'El rol pide_service ya existe: base fuera del estado esperado.';
  end if;
  if exists(select 1 from pg_constraint
      where conrelid='public.orders'::regclass and conname='orders_pide_entrega_check') then
    raise exception 'orders_pide_entrega_check ya existe: base fuera del estado esperado.';
  end if;
  -- El canal recién nace: ningún pedido Pide puede pre-existir a esta migración.
  if exists(select 1 from public.orders where canal='Pide') then
    raise exception 'Existen pedidos canal Pide antes de P04: investigar antes de aplicar.';
  end if;
end $$;

-- ============================================================================
-- Seeds técnicos (valores de arranque NO aprobados como negocio — ver README).
-- ============================================================================
insert into public.app_settings(clave,valor) values
  ('pide_rate_limit_tracking',to_jsonb(30)),
  -- Sanidad de reloj del webhook: un evento_ts más futuro que esto se rechaza.
  -- La frescura REAL (±5 min de la firma) la aplica el worker sobre el raw body.
  ('pide_webhook_futuro_max_minutos',to_jsonb(5))
on conflict (clave) do nothing;

-- ============================================================================
-- Rol dedicado pide_service (patrón claude_agent, schema-v5.sql:751-757):
-- LOGIN NOINHERIT, password EN EL DEPLOY, cero grants de tabla. JAMÁS la
-- service key: la superficie del worker es la lista cerrada de sus dos RPC.
-- ============================================================================
create role pide_service login noinherit;   -- ⚠️ password en el deploy (no comitear):
grant usage on schema public to pide_service; -- alter role pide_service password '…';

-- ============================================================================
-- Helpers sellados.
-- ============================================================================
-- Contexto service transaccional: SOLO crear_pedido_publico_v1 lo enciende
-- (set_config local) y lo apaga antes de retornar; un rollback de savepoint lo
-- revierte solo. Nadie más en el sistema escribe momos.pide_ctx.
create function public._pide_service_ctx()
returns boolean
language sql stable
set search_path=pg_catalog,public,pg_temp
as $$
  select coalesce(current_setting('momos.pide_ctx',true),'')='p04'
$$;

-- UUID determinístico estilo v5 (namespace fijo + sha256 truncado, nibbles de
-- versión/variante correctos). El objetivo sellado es DETERMINISMO por pago:
-- mismo payment_id ⇒ misma idempotency_key ⇒ un solo pedido para siempre.
create function public._pide_uuid5(p_texto text)
returns uuid
language sql immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-'||
    to_hex((('x'||substr(h,17,2))::bit(8)::int & 63) | 128)||substr(h,19,2)||'-'||
    substr(h,21,12))::uuid
  from (select encode(sha256(('momos.pide.pedido:'||coalesce(p_texto,''))::bytea),'hex') as h) s
$$;

-- ============================================================================
-- Requisito sellado 3: un pedido Pide SIN fecha_entrega+franja no ocupa franja
-- — PROHIBIDO como invariante de datos, no promesa de RPC. El staff queda con
-- ambas en NULL (no ocupa franjas, coherente con su operación).
-- ============================================================================
alter table public.orders add constraint orders_pide_entrega_check
  check (canal<>'Pide' or (fecha_entrega is not null and franja is not null));

-- ============================================================================
-- Evolución SELLADA de _crear_pedido_core — cuerpo vivo verificado por md5 en
-- el preflight + rama de contexto Pide. Deltas EXACTOS sobre el verbatim:
--   (1) gate: is_staff() O contexto sellado;
--   (2) canal Pide ⟺ contexto sellado (staff jamás fabrica Pide; el flujo
--       público jamás crea otro canal);
--   (3) precio de línea, domicilio y descuento CONGELADOS de la quote (el
--       navegador nunca decide, y products.precio vivo tampoco: lo cobrado es
--       la quote);
--   (4) mínimo NO se re-valida en contexto (la quote lo validó; post-captura
--       jamás revienta por un mínimo que cambió);
--   (5) beneficio: el contexto lo recibe RESUELTO por el llamador (descarte
--       silencioso prohibido en esta rama); producto_gratis inserta su ítem
--       con COGS real igual que el core;
--   (6) hija de combo: en contexto se resuelve por el contrato P02
--       (combo_components + figura activa), sin el filtro de categoría
--       'Momos Signature' — la caja ya fue validada y RESPALDADA POR LOTE por
--       el hold; reventar acá post-captura por metadato de presentación
--       mandaría a conciliación un pago legítimo;
--   (7) sello de orders.fecha_entrega + orders.franja desde la quote
--       (requisito 3); orders.fecha sigue siendo la fecha operativa;
--   (8) auditoría sin PII en la rama pública: 'Cliente creado' sin nombre;
--   (9) adiciones PROHIBIDAS en contexto (P02 las rechaza; sin verdad
--       canónica de precio ninguna puede llegar sellada).
-- ============================================================================
create or replace function public._crear_pedido_core(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id text;
  v_nuevo jsonb;
  v_canal text;
  v_zona text;
  v_barrio text;
  v_direccion text;
  v_pago text;
  v_obs text;
  v_benefit_id text := nullif(p->>'benefit_id','');
  v_campaign_id text := nullif(p->>'campaign_id','');
  v_creative_id text := nullif(p->>'creative_id','');
  v_origen_detalle text := coalesce(p->>'origen_detalle','');
  v_idem text := nullif(p->>'idempotency_key','');
  v_order_id text;
  v_existing_order_id text;
  v_linea jsonb;
  v_box jsonb;
  v_slot jsonb;
  v_ad jsonb;
  v_prod record;
  v_precio numeric;
  v_costo numeric;
  v_relleno_fijo text;
  v_pedido_minimo numeric;
  v_tarifa numeric := 0;
  v_dom_cobrado numeric := 0;
  v_subtotal numeric;
  v_descuento numeric := 0;
  v_total numeric;
  v_item_id text;
  v_parent_id text;
  v_hija_item_id text;
  v_faltantes jsonb := '[]'::jsonb;
  v_faltantes_linea jsonb;
  v_benefit record;
  v_hija_product_id text;
  v_caja_num integer;
  v_slot_idx integer;
  v_ad_costo numeric;
  v_min_lineas boolean := false;
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
  v_ahora time := (now() at time zone 'America/Bogota')::time; -- hora operativa del negocio
  -- NORMALIZACIÓN v1: datos ya limpios del cliente nuevo (si aplica)
  v_nuevo_nombre text;
  v_nuevo_telefono text;
  v_nuevo_instagram text;
  v_nuevo_direccion text;
  -- P04: contexto service sellado (solo crear_pedido_publico_v1 lo enciende)
  v_pide_ctx boolean := public._pide_service_ctx();
  v_fecha_entrega date;
  v_franja text;
begin
  if not v_pide_ctx and not is_staff() then
    raise exception 'Solo staff activo puede crear pedidos';
  end if;

  -- Idempotencia: si ya existe un pedido con esa key, devolverlo tal cual (sin crear nada)
  if v_idem is not null then
    select id into v_existing_order_id from orders where idempotency_key = v_idem;
    if v_existing_order_id is not null then
      return jsonb_build_object(
        'order_id', v_existing_order_id,
        'subtotal', (select ventas from v_order_totals where order_id = v_existing_order_id),
        'descuento', (select descuento from orders where id = v_existing_order_id),
        'dom_cobrado', (select dom_cobrado from orders where id = v_existing_order_id),
        'total', coalesce((select ventas from v_order_totals where order_id = v_existing_order_id),0)
                 - (select descuento from orders where id = v_existing_order_id)
                 + (select dom_cobrado from orders where id = v_existing_order_id),
        'faltantes', '[]'::jsonb
      );
    end if;
  end if;

  -- Cliente: existente (id) o nuevo (nombre+telefono obligatorios)
  -- NORMALIZACIÓN v1: teléfono normalizado ANTES de buscar/insertar; si el
  -- teléfono normalizado ya pertenece a un cliente existente, se REUSA ese
  -- id en vez de crear un duplicado (mismo criterio que upsert_cliente alta,
  -- normalizacion-clientes-v1.sql).
  v_customer_id := nullif(p->>'customer_id','');
  v_nuevo := p->'nuevo_cliente';
  if v_customer_id is null then
    if v_nuevo is null or coalesce(v_nuevo->>'nombre','') = '' or coalesce(v_nuevo->>'telefono','') = '' then
      raise exception 'Debés indicar un cliente existente o los datos del cliente nuevo (nombre y teléfono)';
    end if;

    v_nuevo_nombre := trim(regexp_replace(v_nuevo->>'nombre', '\s+', ' ', 'g'));
    v_nuevo_telefono := _normalizar_telefono(v_nuevo->>'telefono');
    v_nuevo_instagram := lower(trim(coalesce(v_nuevo->>'instagram', '')));
    if v_nuevo_instagram <> '' then
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '^(https?://)?(www\.)?instagram\.com/', '');
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '^@', '');
      v_nuevo_instagram := regexp_replace(v_nuevo_instagram, '[/?].*$', '');
    end if;
    v_nuevo_direccion := trim(coalesce(v_nuevo->>'direccion',''));

    if v_nuevo_telefono = '' then
      raise exception 'Debés indicar un cliente existente o los datos del cliente nuevo (nombre y teléfono)';
    end if;

    select id into v_customer_id from customers where telefono = v_nuevo_telefono;
    if v_customer_id is null then
      v_customer_id := next_id('customer','C',2);

      -- Alta bajo carrera: mismo patrón que upsert_cliente (normalizacion-
      -- clientes-v1.sql, rama ALTA) — el índice único customers_telefono_
      -- unique_idx es el árbitro real; la perdedora reusa el id existente sin
      -- crear un audit de 'Cliente creado' duplicado para una fila que no creó.
      begin
        insert into customers (id, nombre, telefono, instagram, barrio, direccion, canal)
        values (v_customer_id, v_nuevo_nombre, v_nuevo_telefono, v_nuevo_instagram,
                coalesce(v_nuevo->>'barrio',''), v_nuevo_direccion,
                nullif(v_nuevo->>'canal',''));
        -- P04: en la rama pública la auditoría no lleva PII (el nombre queda
        -- en customers, jamás en audit_logs).
        perform _add_audit('Cliente', v_customer_id, 'Cliente creado', '',
          case when v_pide_ctx then '' else v_nuevo_nombre end);
      exception when unique_violation then
        select id into v_customer_id from customers where telefono = v_nuevo_telefono;
        if v_customer_id is null then
          raise;  -- otra violación de unicidad (p.ej. PK): no es idempotencia, propagar
        end if;
      end;
    end if;
  else
    if not exists (select 1 from customers where id = v_customer_id) then
      raise exception 'El cliente % no existe', v_customer_id;
    end if;
  end if;

  -- Al menos una línea con product_id
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p->'lineas','[]'::jsonb)) l
    where nullif(l->>'product_id','') is not null
  ) then
    raise exception 'El pedido debe tener al menos una línea con producto';
  end if;

  v_canal := p->>'canal';
  v_zona := nullif(p->>'zona','');
  v_barrio := coalesce(p->>'barrio','');
  v_direccion := coalesce(p->>'direccion','');
  v_pago := nullif(p->>'pago','');
  v_obs := coalesce(p->>'obs','');

  -- P04: el canal Pide y el contexto sellado son EQUIVALENTES — staff jamás
  -- fabrica un pedido Pide a mano y el flujo público jamás crea otro canal.
  if (v_canal = 'Pide') <> v_pide_ctx then
    raise exception 'El canal Pide nace únicamente del flujo público sellado (crear_pedido_publico_v1).';
  end if;
  if v_pide_ctx then
    begin
      v_fecha_entrega := (p->>'fecha_entrega')::date;
    exception when others then
      v_fecha_entrega := null;
    end;
    v_franja := nullif(p->>'franja','');
    if v_fecha_entrega is null or v_franja is null then
      raise exception 'Un pedido Pide exige fecha_entrega y franja sellados desde la quote.';
    end if;
  end if;

  select valor#>>'{}' into v_relleno_fijo from app_settings where clave = 'relleno_fijo';
  select coalesce((valor#>>'{}')::numeric, 0) into v_pedido_minimo from app_settings where clave = 'pedido_minimo';

  if v_canal = 'Rappi' then
    v_tarifa := 0;
    v_dom_cobrado := 0;
  elsif v_pide_ctx then
    -- P04: el domicilio se cobra CONGELADO de la quote — la tarifa viva pudo
    -- cambiar entre cotizar y el webhook, y lo cobrado es la quote.
    v_dom_cobrado := coalesce((p->>'dom_congelado')::numeric, 0);
    if v_dom_cobrado < 0 then
      raise exception 'El domicilio congelado de la quote no puede ser negativo.';
    end if;
  elsif v_zona is not null then
    select tarifa into v_tarifa from zonas where nombre = v_zona;
    v_dom_cobrado := coalesce(v_tarifa, 0);
  end if;

  v_order_id := next_id('order','P-',0);

  -- INSERT del pedido ANTES de las líneas: order_items.order_id tiene FK NOT NULL
  -- a orders(id) (y benefits.pedido_uso también referencia orders). descuento y
  -- benefit_id se consolidan al final vía UPDATE — misma transacción: cualquier
  -- raise posterior (mínimo, beneficio, combo incompleto) revienta todo el pedido.
  -- P04: fecha_entrega y franja viajan NULL para staff (no ocupa franjas) y
  -- sellados desde la quote en contexto Pide (requisito 3).
  insert into orders (
    id, fecha, hora, canal, customer_id, barrio, direccion, zona,
    dom_cobrado, dom_costo, descuento, benefit_id, pago, obs, estado,
    idempotency_key, campaign_id, creative_id, origen_detalle,
    fecha_entrega, franja
  ) values (
    v_order_id, v_hoy, v_ahora, v_canal, v_customer_id, v_barrio, v_direccion, v_zona,
    v_dom_cobrado, 0, 0, null, v_pago, v_obs, 'Nuevo',
    v_idem, v_campaign_id, v_creative_id, v_origen_detalle,
    v_fecha_entrega, v_franja
  );

  -- Insertar líneas
  for v_linea in select * from jsonb_array_elements(p->'lineas')
  loop
    if nullif(v_linea->>'product_id','') is null then
      continue;
    end if;

    select id, nombre, tipo, especie, precio, precio_rappi, costo, combo_size, empaque_item_id
      into v_prod from products where id = v_linea->>'product_id';
    if v_prod.id is null then
      raise exception 'Producto % no existe', v_linea->>'product_id';
    end if;

    if v_pide_ctx then
      -- P04: el precio de la línea es el CONGELADO de la quote (lo cobrado),
      -- jamás el precio vivo del catálogo ni un valor del navegador.
      v_precio := (v_linea->>'precio_congelado')::numeric;
      if v_precio is null or v_precio < 0 then
        raise exception 'La línea Pide de % no trae el precio congelado de la quote.', v_prod.id;
      end if;
    elsif v_canal = 'Rappi' then
      v_precio := coalesce(v_prod.precio_rappi, v_prod.precio * 1.25);
    else
      v_precio := v_prod.precio;
    end if;
    v_costo := v_prod.costo;

    v_item_id := next_id('item','IT',0);

    if v_prod.tipo = 'combo' then
      if v_linea->'boxes' is null or jsonb_array_length(v_linea->'boxes') = 0 then
        raise exception 'El combo % requiere las cajas completas (figura, sabor y salsa de cada slot)', v_prod.nombre;
      end if;
      if jsonb_array_length(v_linea->'boxes') <> coalesce((v_linea->>'cant')::numeric,1)::int then
        raise exception 'El combo % debe tener % caja(s), llegaron %',
          v_prod.nombre, (v_linea->>'cant')::int, jsonb_array_length(v_linea->'boxes');
      end if;

      -- Padre es_caja
      insert into order_items (id, order_id, product_id, nombre, cant, precio, costo_unitario, es_caja)
      values (v_item_id, v_order_id, v_prod.id, v_prod.nombre,
              coalesce((v_linea->>'cant')::numeric,1), v_precio, v_costo, true);

      v_caja_num := 0;
      for v_box in select * from jsonb_array_elements(v_linea->'boxes')
      loop
        v_caja_num := v_caja_num + 1;
        if jsonb_array_length(v_box) <> v_prod.combo_size then
          raise exception 'La caja % del combo % debe tener % slots, llegaron %',
            v_caja_num, v_prod.nombre, v_prod.combo_size, jsonb_array_length(v_box);
        end if;
        v_slot_idx := 0;
        for v_slot in select * from jsonb_array_elements(v_box)
        loop
          v_slot_idx := v_slot_idx + 1;
          if coalesce(v_slot->>'figura','') = '' or coalesce(v_slot->>'sabor','') = ''
             or coalesce(v_slot->>'salsa','') = '' then
            raise exception 'Caja % slot % del combo % está incompleto: falta figura, sabor o salsa',
              v_caja_num, v_slot_idx, v_prod.nombre;
          end if;

          -- La especie es solo metadato visual. La hija exacta se resuelve por
          -- la relación figura→presentación y luego se valida contra la caja.
          -- P04: en contexto Pide la resolución usa el CONTRATO P02 (membresía
          -- en combo_components + figura activa) — la caja ya fue validada y
          -- respaldada por lote en el hold; reventar post-captura por el
          -- metadato de categoría mandaría a conciliación un pago legítimo.
          if v_pide_ctx then
            select f.product_id into v_hija_product_id
            from figuras f join products pr on pr.id=f.product_id
            where f.nombre=v_slot->>'figura' and f.activo
              and pr.activo and pr.tipo='momo'
              and exists(select 1 from combo_components cc
                where cc.combo_id=v_prod.id and cc.component_id=f.product_id);
          else
            select f.product_id into v_hija_product_id
            from figuras f join products pr on pr.id=f.product_id
            where f.nombre=v_slot->>'figura' and f.activo
              and pr.activo and pr.tipo='momo' and pr.cat='Momos Signature';
          end if;
          if v_hija_product_id is null then
            raise exception 'Figura % no existe o no tiene presentación comercial activa',v_slot->>'figura';
          end if;
          if not exists(select 1 from combo_components cc
            where cc.combo_id=v_prod.id and cc.component_id=v_hija_product_id) then
            raise exception 'El combo % no admite la presentación exacta de la figura %',v_prod.nombre,v_slot->>'figura';
          end if;

          v_parent_id := v_item_id;
          v_hija_item_id := next_id('item','IT',0);
          insert into order_items (
            id, order_id, product_id, nombre, sabor, salsa, relleno, figura,
            cant, precio, costo_unitario, es_sub_momo, parent_item_id, caja_num
          ) values (
            v_hija_item_id, v_order_id, v_hija_product_id,
            (select nombre from products where id = v_hija_product_id),
            v_slot->>'sabor', v_slot->>'salsa', coalesce(v_relleno_fijo,''), v_slot->>'figura',
            1, 0, 0, true, v_parent_id, v_caja_num
          );

          -- Adiciones del slot (si vienen): cuelgan de la HIJA recién insertada.
          -- SECURITY v1: precio de adición es el único valor monetario que
          -- viaja del cliente sin recalcular server-side — se valida acá
          -- ANTES de insertar (precio >= 0, cant > 0, insumo_cant >= 0), para
          -- que un precio negativo no se cuele como descuento inyectado en
          -- _order_subtotal.
          -- P04: el canal Pide RECHAZA adiciones desde P02 (sin verdad canónica
          -- de precio); si alguna llegara acá en contexto sellado, revienta.
          if v_slot->'adiciones' is not null then
            if v_pide_ctx then
              raise exception 'El canal Pide no admite adiciones (sin verdad canónica de precio).';
            end if;
            for v_ad in select * from jsonb_array_elements(v_slot->'adiciones')
            loop
              if coalesce((v_ad->>'precio')::numeric,0) < 0 then
                raise exception 'Precio de adición inválido (negativo): %', v_ad->>'nombre';
              end if;
              if coalesce((v_ad->>'cant')::numeric,1) <= 0 then
                raise exception 'Cantidad de adición inválida (debe ser mayor a 0): %', v_ad->>'nombre';
              end if;
              if coalesce((v_ad->>'insumo_cant')::numeric,0) < 0 then
                raise exception 'Cantidad de insumo de adición inválida (negativa): %', v_ad->>'nombre';
              end if;

              v_ad_costo := null;
              if nullif(v_ad->>'insumo_id','') is not null then
                select costo into v_ad_costo from inventory_items where id = v_ad->>'insumo_id';
              end if;
              insert into order_item_adiciones (
                order_item_id, nombre, precio, cant, insumo_id, insumo_cant, insumo_costo
              ) values (
                v_hija_item_id,
                v_ad->>'nombre', coalesce((v_ad->>'precio')::numeric,0),
                coalesce((v_ad->>'cant')::numeric,1),
                nullif(v_ad->>'insumo_id',''), coalesce((v_ad->>'insumo_cant')::numeric,0), v_ad_costo
              );
            end loop;
          end if;
        end loop;
      end loop;

    else
      -- momo o pedido: línea simple
      insert into order_items (
        id, order_id, product_id, nombre, sabor, salsa, relleno, figura, cant, precio, costo_unitario
      ) values (
        v_item_id, v_order_id, v_prod.id, v_prod.nombre,
        coalesce(v_linea->>'sabor',''), coalesce(v_linea->>'salsa',''),
        coalesce(v_relleno_fijo,''), coalesce(v_linea->>'figura',''),
        coalesce((v_linea->>'cant')::numeric,1), v_precio, v_costo
      );

      -- SECURITY v1: misma validación de adiciones que en la rama de combo
      -- de arriba (precio >= 0, cant > 0, insumo_cant >= 0).
      if v_linea->'adiciones' is not null then
        if v_pide_ctx then
          raise exception 'El canal Pide no admite adiciones (sin verdad canónica de precio).';
        end if;
        for v_ad in select * from jsonb_array_elements(v_linea->'adiciones')
        loop
          if coalesce((v_ad->>'precio')::numeric,0) < 0 then
            raise exception 'Precio de adición inválido (negativo): %', v_ad->>'nombre';
          end if;
          if coalesce((v_ad->>'cant')::numeric,1) <= 0 then
            raise exception 'Cantidad de adición inválida (debe ser mayor a 0): %', v_ad->>'nombre';
          end if;
          if coalesce((v_ad->>'insumo_cant')::numeric,0) < 0 then
            raise exception 'Cantidad de insumo de adición inválida (negativa): %', v_ad->>'nombre';
          end if;

          v_ad_costo := null;
          if nullif(v_ad->>'insumo_id','') is not null then
            select costo into v_ad_costo from inventory_items where id = v_ad->>'insumo_id';
          end if;
          insert into order_item_adiciones (
            order_item_id, nombre, precio, cant, insumo_id, insumo_cant, insumo_costo
          ) values (
            v_item_id, v_ad->>'nombre', coalesce((v_ad->>'precio')::numeric,0),
            coalesce((v_ad->>'cant')::numeric,1),
            nullif(v_ad->>'insumo_id',''), coalesce((v_ad->>'insumo_cant')::numeric,0), v_ad_costo
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Subtotal (post-inserción de líneas, en la misma transacción)
  v_subtotal := _order_subtotal(v_order_id);

  -- P04: en contexto Pide el mínimo NO se re-valida — la quote lo validó al
  -- cotizar y el dinero ya fue capturado; un mínimo que subió después jamás
  -- revienta un pago legítimo.
  if not v_pide_ctx and v_subtotal < v_pedido_minimo then
    raise exception 'El pedido no alcanza el mínimo de % (subtotal: %)', v_pedido_minimo, v_subtotal;
  end if;

  if v_pide_ctx then
    -- P04: descuento CONGELADO de la quote + beneficio RESUELTO por el
    -- llamador (crear_pedido_publico_v1 lo valida y re-apunta bajo lock).
    -- El descarte silencioso del core queda prohibido en esta rama: si el
    -- beneficio no era consumible, el llamador ya lo degradó con warning y
    -- conciliación — el descuento cobrado se honra igual.
    v_descuento := coalesce((p->>'descuento_congelado')::numeric, 0);
    if v_descuento < 0 or v_descuento > v_subtotal then
      raise exception 'El descuento congelado (%) no es coherente con el subtotal (%).', v_descuento, v_subtotal;
    end if;
    v_benefit_id := nullif(p->>'benefit_resuelto','');
    if v_benefit_id is not null then
      select * into v_benefit from benefits where id = v_benefit_id;
      if v_benefit.id is null then
        v_benefit_id := null;
      elsif v_benefit.tipo_beneficio = 'producto_gratis' then
        -- COGS real del regalo, igual que el core staff.
        insert into order_items (id, order_id, product_id, nombre, cant, precio, costo_unitario)
        select next_id('item','IT',0), v_order_id, id, nombre || ' (beneficio)', 1, 0, costo
        from products where id = v_benefit.producto_gratis_id;
      end if;
    end if;
  elsif v_benefit_id is not null then
    -- Beneficio: elegible si es Activo, del customer, vigente (el mínimo se valida abajo)
    select * into v_benefit from benefits
      where id = v_benefit_id and customer_id = v_customer_id and estado = 'Activo'
        and (vence is null or vence >= v_hoy)
      for update;
    if v_benefit.id is not null then
      if v_subtotal < v_benefit.minimo then
        raise exception 'El beneficio % exige un mínimo de % (subtotal: %)', v_benefit_id, v_benefit.minimo, v_subtotal;
      end if;

      if v_benefit.tipo_beneficio = 'descuento_porcentaje' then
        v_descuento := round(v_subtotal * v_benefit.valor / 100);
      elsif v_benefit.tipo_beneficio = 'descuento_valor_fijo' then
        v_descuento := least(v_benefit.valor, v_subtotal);
      elsif v_benefit.tipo_beneficio = 'producto_gratis' then
        v_descuento := 0;
        -- COGS real del regalo: costo_unitario = products.costo (si va 0, el
        -- margen miente). El nombre lleva sufijo ' (beneficio)' como la maqueta.
        insert into order_items (id, order_id, product_id, nombre, cant, precio, costo_unitario)
        select next_id('item','IT',0), v_order_id, id, nombre || ' (beneficio)', 1, 0, costo
        from products where id = v_benefit.producto_gratis_id;
      end if;

      update benefits set estado = 'Reservado', pedido_uso = v_order_id where id = v_benefit_id;
      perform _add_audit('Beneficio', v_benefit_id, 'Beneficio reservado', 'Activo', 'Pedido ' || v_order_id);
    else
      v_benefit_id := null; -- no elegible: se ignora silenciosamente el benefit_id del payload
    end if;
  end if;

  v_total := v_subtotal - v_descuento + v_dom_cobrado;

  -- Consolidar descuento y beneficio calculados post-líneas (el pedido ya existe)
  update orders set descuento = v_descuento, benefit_id = v_benefit_id where id = v_order_id;

  -- Canal Rappi sin delivery previo → crear delivery automático
  if v_canal = 'Rappi' and not exists (select 1 from deliveries where order_id = v_order_id) then
    insert into deliveries (id, order_id, proveedor, costo_real, cobrado, estado)
    values (next_id('delivery','D-',0), v_order_id, 'Rappi', 0, 0, 'Solicitado');
    perform _add_audit('Domicilio', v_order_id, 'Domicilio Rappi creado automáticamente');
  end if;

  perform _add_audit('Pedido', v_order_id, 'Pedido creado', '', 'Nuevo');

  -- Faltantes de stock/especie NO bloquean: se calculan recién en set_order_status
  -- (efecto de reserva ocurre al pagar). crear_pedido NO reserva inventario todavía
  -- — la reserva es un EFECTO de la transición a Pagado (ver sección Efectos).
  -- Por eso v_faltantes queda vacío acá; se reporta en el jsonb de set_order_status.

  return jsonb_build_object(
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'descuento', v_descuento,
    'dom_cobrado', v_dom_cobrado,
    'total', v_total,
    'faltantes', v_faltantes
  );
end $$;

-- ============================================================================
-- Evolución SELLADA de _set_order_status_core — cuerpo vivo verificado por md5
-- en el preflight. Deltas EXACTOS sobre el verbatim:
--   (1) gate: is_staff() O contexto sellado;
--   (2) gate [Pagado] POR CANAL: 'Pide' exige el payment_event firmado con
--       pago aprobado y 'Pasarela (web)'; la foto de comprobante no aplica a
--       este canal y 'Pasarela (web)' queda prohibida fuera de él (simetría
--       con la regla Rappi). Todo lo demás queda byte-idéntico.
-- ============================================================================
create or replace function public._set_order_status_core(
  p_order_id text, p_estado text, p_venta_rapida boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_prev text;
  v_legal boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_faltantes_reserva jsonb;
  v_delivery record;
  v_customer record;
  v_reclamos_cliente integer;
  v_order_total numeric;
  v_item record;
  v_recipe_faltantes text := '';
  v_f text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
  v_ahora time := (now() at time zone 'America/Bogota')::time; -- hora operativa del negocio
begin
  if not is_staff() and not public._pide_service_ctx() then
    raise exception 'Solo staff activo';
  end if;

  select * into o from orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'El pedido % no existe', p_order_id;
  end if;

  -- (1) no-op si mismo estado
  if o.estado = p_estado then
    return jsonb_build_object('ok', true, 'de', o.estado, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  v_prev := o.estado;

  -- (2) gate de grafo
  v_legal := (
    (v_prev = 'Nuevo' and p_estado in ('Confirmado','Pendiente de pago','Pagado')) or
    (v_prev = 'Confirmado' and p_estado in ('Pendiente de pago','Pagado','Nuevo')) or
    (v_prev = 'Pendiente de pago' and p_estado in ('Pagado','Confirmado')) or
    (v_prev = 'Pagado' and p_estado in ('En producción','Pendiente de pago')) or
    (v_prev = 'En producción' and p_estado in ('Listo para empaque','Pagado')) or
    (v_prev = 'Listo para empaque' and p_estado in ('Empacado','En producción')) or
    (v_prev = 'Empacado' and p_estado in ('Listo para despacho','En ruta','Listo para empaque')) or
    (v_prev = 'Listo para despacho' and p_estado in ('En ruta','Empacado')) or
    (v_prev = 'En ruta' and p_estado in ('Entregado','Listo para despacho')) or
    (v_prev = 'Reclamo' and p_estado = 'Entregado') or
    p_estado in ('Cancelado','Reclamo') or
    (p_venta_rapida and p_estado = 'Entregado')
  );
  if not v_legal then
    raise exception 'Transición no permitida: de "%" no se puede pasar a "%". Avanzá paso a paso, o usá "Entrega inmediata" si es una venta en mano.', v_prev, p_estado;
  end if;

  -- (3) gate de pago genérico
  if p_estado in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado') and o.pagado_en is null then
    raise exception 'MOMOS no produce ni despacha pedidos sin pago confirmado.';
  end if;

  -- (4) gate Empacado: 'Caja abierta' Y ('Caja cerrada con sello' O 'Bolsa sellada')
  if p_estado = 'Empacado' then
    if not _tiene_evidencia(p_order_id, 'Caja abierta') then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja abierta.', p_order_id;
    end if;
    if not _tiene_sello(p_order_id) then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja cerrada con sello o Bolsa sellada.', p_order_id;
    end if;
  end if;

  -- (5) gate En ruta: sello + pago + delivery no-Cancelado + costo (salvo Rappi)
  if p_estado = 'En ruta' then
    if not _tiene_sello(p_order_id) then
      raise exception 'El pedido % no puede pasar a "En ruta": falta foto de caja cerrada con sello o bolsa sellada.', p_order_id;
    end if;
    if o.pagado_en is null then
      raise exception 'El pedido % no puede pasar a "En ruta": el pedido no tiene pago confirmado.', p_order_id;
    end if;
    select * into v_delivery from deliveries where order_id = p_order_id and estado <> 'Cancelado' limit 1;
    if v_delivery.id is null then
      raise exception 'El pedido % no puede pasar a "En ruta": no tiene domicilio asignado (solicítalo en Domicilios).', p_order_id;
    end if;
    if o.canal <> 'Rappi' then
      if not (coalesce(v_delivery.costo_real,0) > 0 or coalesce(o.dom_costo,0) > 0) then
        raise exception 'El pedido % no puede pasar a "En ruta": falta registrar el costo real del domicilio.', p_order_id;
      end if;
    end if;
  end if;

  -- (6) gate Entregado: pago + evidencia de pago/sello (según canal/venta rápida) + SIEMPRE evidencia 'Entrega'
  if p_estado = 'Entregado' then
    if o.pagado_en is null then
      raise exception 'El pedido % no puede pasar a "Entregado": el pedido no tiene pago confirmado.', p_order_id;
    end if;
    if o.canal = 'Rappi' then
      if not (_tiene_evidencia(p_order_id,'Comprobante de pago') or _tiene_evidencia(p_order_id,'Bolsa sellada')) then
        raise exception 'El pedido % no puede pasar a "Entregado": falta foto de comprobante de pago o bolsa sellada.', p_order_id;
      end if;
    elsif not p_venta_rapida then
      if not _tiene_sello(p_order_id) then
        raise exception 'El pedido % no puede pasar a "Entregado": falta foto de caja cerrada con sello o bolsa sellada.', p_order_id;
      end if;
    end if;
    if not _tiene_evidencia(p_order_id,'Entrega') then
      raise exception 'El pedido % no puede pasar a "Entregado": falta la foto de Entrega.', p_order_id;
    end if;
  end if;

  -- (7) gate Pagado — P04: la evidencia es POR CANAL. Para 'Pide' es el
  -- payment_event FIRMADO con monto exacto (la foto de comprobante no aplica);
  -- 'Pasarela (web)' queda prohibida fuera de Pide (simetría con Rappi).
  if p_estado = 'Pagado' then
    if o.pago = 'Efectivo' then
      raise exception 'MOMOS no acepta pagos en efectivo.';
    end if;
    if o.pago = 'Rappi (app)' and o.canal <> 'Rappi' then
      raise exception 'El medio de pago "Rappi (app)" solo aplica a pedidos del canal Rappi.';
    end if;
    if o.canal = 'Rappi' and o.pago <> 'Rappi (app)' then
      raise exception 'Los pedidos de canal Rappi deben pagarse con "Rappi (app)".';
    end if;
    if o.pago = 'Pasarela (web)' and o.canal <> 'Pide' then
      raise exception 'El medio de pago "Pasarela (web)" solo aplica a pedidos del canal Pide.';
    end if;
    if o.canal = 'Pide' then
      if o.pago <> 'Pasarela (web)' then
        raise exception 'Los pedidos del canal Pide se pagan con "Pasarela (web)".';
      end if;
      if not exists (
        select 1 from payments pa
        join payment_events pe on pe.payment_id = pa.id
        where pa.order_id = p_order_id and pa.estado = 'Aprobado'
          and pe.tipo = 'Aprobado' and pe.firma_ok
          and pe.monto_reportado is not distinct from pa.monto
      ) then
        raise exception 'El pedido % (canal Pide) solo se marca Pagado con el evento firmado de la pasarela; la foto de comprobante no aplica a este canal.', p_order_id;
      end if;
    elsif o.canal <> 'Rappi' and not _tiene_evidencia(p_order_id,'Comprobante de pago') then
      raise exception 'El pedido % no puede marcarse "Pagado": falta la foto del comprobante de pago.', p_order_id;
    end if;
  end if;

  -- Audit SIEMPRE (antes de efectos)
  perform _add_audit('Pedido', p_order_id, 'Cambio de estado', v_prev, p_estado);

  -- Aplicar el nuevo estado ya (los efectos leen/escriben sobre el estado nuevo)
  update orders set estado = p_estado where id = p_order_id;

  -- ===== Efectos post-transición (orden exacto) =====

  -- [Pagado]
  if p_estado = 'Pagado' then
    update orders set comprobante = true, pagado_en = now() where id = p_order_id;
    if not o.inventario_reservado then
      v_faltantes_reserva := _reserve_inventory(p_order_id);
      v_faltantes := v_faltantes || v_faltantes_reserva;
      update orders set inventario_reservado = true where id = p_order_id;
    end if;
    if o.benefit_id is not null then
      update benefits set estado = 'Usado' where id = o.benefit_id and estado = 'Reservado';
      if found then
        perform _add_audit('Beneficio', o.benefit_id, 'Beneficio usado', 'Reservado', 'Usado');
      end if;
    end if;
  end if;

  -- [Red #7] cualquier transición: si operativo/entregado AND pagado_en AND NOT reservado → reservar
  if p_estado in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado')
     and (case when p_estado = 'Pagado' then true else o.pagado_en is not null end)
     and not (case when p_estado = 'Pagado' then true else o.inventario_reservado end)
  then
    if not exists (select 1 from orders where id = p_order_id and inventario_reservado) then
      v_faltantes_reserva := _reserve_inventory(p_order_id);
      v_faltantes := v_faltantes || v_faltantes_reserva;
      update orders set inventario_reservado = true where id = p_order_id;
    end if;
  end if;

  -- [En producción]
  if p_estado = 'En producción' and not o.insumos_descontados then
    v_recipe_faltantes := '';
    for v_item in
      select oi.product_id, oi.cant from order_items oi
      join products p2 on p2.id = oi.product_id
      where oi.order_id = p_order_id and p2.tipo = 'pedido'
    loop
      v_f := _deduct_recipe(v_item.product_id, v_item.cant, 'Producción pedido ' || p_order_id, p_order_id);
      if v_f <> '' then
        v_recipe_faltantes := v_recipe_faltantes || case when v_recipe_faltantes = '' then '' else ', ' end || v_f;
      end if;
    end loop;
    update orders set insumos_descontados = true where id = p_order_id;
    if v_recipe_faltantes <> '' then
      perform _add_audit('Producción', p_order_id, 'Faltante de insumos en producción', '', v_recipe_faltantes);
    end if;
  end if;

  -- [Red #4] En ruta/Entregado sin insumos_descontados → entrega directa
  if p_estado in ('En ruta','Entregado') and not o.insumos_descontados
     and not exists (select 1 from orders where id = p_order_id and insumos_descontados)
  then
    v_recipe_faltantes := '';
    for v_item in
      select oi.product_id, oi.cant from order_items oi
      join products p2 on p2.id = oi.product_id
      where oi.order_id = p_order_id and p2.tipo = 'pedido'
    loop
      v_f := _deduct_recipe(v_item.product_id, v_item.cant, 'Producción pedido ' || p_order_id || ' (entrega directa)', p_order_id);
      if v_f <> '' then
        v_recipe_faltantes := v_recipe_faltantes || case when v_recipe_faltantes = '' then '' else ', ' end || v_f;
      end if;
    end loop;
    update orders set insumos_descontados = true where id = p_order_id;
    if v_recipe_faltantes <> '' then
      perform _add_audit('Producción', p_order_id, 'Faltante de insumos en producción', '', v_recipe_faltantes);
    end if;
  end if;

  -- [Cancelado]
  if p_estado = 'Cancelado' then
    if v_prev not in ('En ruta','Entregado') then
      perform _release_reservations(p_order_id);
    end if;
    -- flag insumos_descontados: false si prev no despachado (SIN recalcular: la
    -- liberación ya devolvió el stock). inventario_reservado NO se resetea —
    -- paridad con la maqueta: Cancelado es terminal.
    if o.insumos_descontados and v_prev not in ('En ruta','Entregado') then
      update orders set insumos_descontados = false where id = p_order_id;
    end if;

    if v_prev = 'Entregado' and o.metricas_cliente_actualizadas then
      select * into v_customer from customers where id = o.customer_id for update;
      if v_customer.id is not null then
        select coalesce(ventas,0) into v_order_total from v_order_totals where order_id = p_order_id;
        update customers set
          pedidos = greatest(0, pedidos - 1),
          total = greatest(0, total - (v_order_total - o.descuento + o.dom_cobrado))
        where id = o.customer_id;
      end if;
      update orders set metricas_cliente_actualizadas = false where id = p_order_id;
    end if;

    -- Beneficio: Reservado, o Usado con prev antes de producción → vuelve a Activo
    if o.benefit_id is not null then
      if exists (
        select 1 from benefits where id = o.benefit_id and (
          estado = 'Reservado' or
          (estado = 'Usado' and v_prev not in ('En producción','Listo para empaque','Empacado','Listo para despacho','En ruta','Entregado'))
        )
      ) then
        update benefits set estado = 'Activo', pedido_uso = null where id = o.benefit_id;
        perform _add_audit('Beneficio', o.benefit_id, 'Beneficio devuelto al cliente', v_prev, 'Activo');
      end if;
    end if;

    update deliveries set estado = 'Cancelado' where order_id = p_order_id and estado <> 'Cancelado';
  end if;

  -- [En ruta]
  if p_estado = 'En ruta' then
    update deliveries set estado = 'En ruta', h_salida = coalesce(h_salida, v_ahora)
    where order_id = p_order_id and estado not in ('Entregado','Cancelado');
  end if;

  -- [Entregado]
  if p_estado = 'Entregado' then
    perform _consume_reservations(p_order_id);
    if not o.metricas_cliente_actualizadas then
      select * into v_customer from customers where id = o.customer_id for update;
      if v_customer.id is not null then
        select coalesce(ventas,0) into v_order_total from v_order_totals where order_id = p_order_id;
        select count(*) into v_reclamos_cliente from claims where customer_id = v_customer.id;
        update customers set
          ultima = v_hoy,
          pedidos = v_customer.pedidos + 1,
          total = v_customer.total + (v_order_total - o.descuento + o.dom_cobrado),
          estado = case
            when v_reclamos_cliente >= 2 then 'Riesgo por reclamos'
            when (v_customer.pedidos + 1) >= 5 or (v_customer.total + (v_order_total - o.descuento + o.dom_cobrado)) >= 200000 then 'VIP'
            when (v_customer.pedidos + 1) >= 2 then 'Recurrente'
            else 'Nuevo'
          end
        where id = v_customer.id;
      end if;
      update orders set metricas_cliente_actualizadas = true where id = p_order_id;
    end if;
    update deliveries set estado = 'Entregado', h_entrega = v_ahora
    where order_id = p_order_id and estado <> 'Cancelado';
  end if;

  -- [Retroceso #14] prev='En ruta' y nuevo NOT IN ('En ruta','Entregado','Cancelado','Reclamo') → delivery vuelve a Asignado.
  -- 'Reclamo' EXCLUIDO (decisión usuario 2026-07-10, migración fix_retroceso_reclamo_v1): el reclamo es bandera
  -- administrativa/comercial (se compensa con bono → claims.benefit_id), NO retroceso logístico — la entrega sigue
  -- su curso y h_salida se preserva (trazabilidad de tiempos en tránsito).
  if v_prev = 'En ruta' and p_estado not in ('En ruta','Entregado','Cancelado','Reclamo') then
    update deliveries set estado = 'Asignado', h_salida = null
    where order_id = p_order_id and estado = 'En ruta';
  end if;

  return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', v_faltantes);
end $$;

-- ============================================================================
-- Patas que el hold NO cubre — espejo VERBATIM de los bloques de empaque,
-- insumos de receta y adiciones de _reserve_inventory (md5 pineado en el
-- preflight). El hold ya descontó products.stock y lote_figuras; estas patas
-- descuentan lo demás. Sin ellas, el flag inventario_reservado=true suprimiría
-- TODO y el inventario de empaques mentiría para siempre (hallazgo sellado).
-- Regla sellada (README): cualquier cambio futuro a las patas de
-- _reserve_inventory se replica acá en el mismo hito.
-- ============================================================================
create function public._pide_reservar_pedido_patas(p_order_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  comp record;
  addd record;
  v_toma numeric;
  v_req numeric;
  v_stock_actual numeric;
  v_faltantes jsonb := '[]'::jsonb;
  v_compras_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'combo'
  loop
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

  if v_compras_texto <> '' then
    perform _add_audit('Inventario', p_order_id, 'Compra sugerida creada', '', v_compras_texto);
  end if;
  return v_faltantes;
end $$;

-- ============================================================================
-- Leg del REGALO (hallazgo del panel, cerrado acá): el ítem de un beneficio
-- producto_gratis NO viene del hold (la quote lo lista como línea 'beneficio'
-- sin demanda de stock), así que en el camino promovido nadie lo descontaba y
-- el regalo salía sin tocar inventario (sobreventa del SKU). Este helper es el
-- espejo VERBATIM del leg de momo de _reserve_inventory (lock de producto →
-- FIFO vivo → faltante explícito con sugerencia de producción), acotado a los
-- ítems regalo (precio 0, sufijo ' (beneficio)') del producto indicado. En el
-- camino NO promovido no hace falta: el core corre _reserve_inventory completo.
-- ============================================================================
create function public._pide_reservar_item_regalo(p_order_id text, p_product_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  v_toma numeric;
  v_remanente integer;
  v_stock_actual numeric;
  v_faltantes jsonb := '[]'::jsonb;
  v_sugerencias_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre, oi.figura, oi.sabor
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
      and oi.product_id = p_product_id and oi.precio = 0
      and oi.nombre like '% (beneficio)'
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
  if v_sugerencias_texto <> '' then
    perform _add_audit('Producción', p_order_id, 'Sugerencia de producción creada', '', v_sugerencias_texto);
  end if;
  return v_faltantes;
end $$;

-- ============================================================================
-- Promoción del hold — SIN re-correr FIFO: cada fila de checkout_hold_lotes ya
-- descontó stock y lote exactos; acá solo se materializa como
-- inventory_reservations 'Reservada' con el MISMO batch/figura (espejo del
-- insert de _asignar_variante_fifo) y el hold pasa a Confirmada exactly-once.
-- Devuelve false si no hay hold Temporal (liberado/ausente): el llamador deja
-- inventario_reservado=false y el core re-toma con faltante EXPLÍCITO.
-- ============================================================================
create function public._pide_promover_holds(p_quote_id uuid, p_order_id text)
returns boolean
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_hold public.checkout_holds%rowtype;
  v_l record;
begin
  select * into v_hold from public.checkout_holds
    where quote_id=p_quote_id and estado='Temporal'
    for update;
  if v_hold.id is null then
    return false;
  end if;
  for v_l in
    select l.product_id, l.batch_id, l.figura, l.cantidad, p2.nombre
    from public.checkout_hold_lotes l
    join public.products p2 on p2.id=l.product_id
    where l.hold_id=v_hold.id
    order by l.id
  loop
    insert into public.inventory_reservations (
      id, order_id, tipo, product_id, item_id, nombre, cantidad, batch_id, figura
    ) values (
      public.next_id('reservation','RES-',0), p_order_id, 'producto', v_l.product_id, null,
      v_l.nombre || ' · ' || coalesce(v_l.figura,'') || ' (' || coalesce(v_l.batch_id,'') || ')',
      v_l.cantidad, v_l.batch_id, v_l.figura
    );
  end loop;
  update public.checkout_holds
    set estado='Confirmada', resuelto_at=clock_timestamp()
    where id=v_hold.id and estado='Temporal';
  return true;
end $$;

-- ============================================================================
-- crear_pedido_publico_v1 — del pago aprobado y firmado al pedido operativo.
-- Rol pide_service (jamás service_role); todo en UNA transacción; si el total
-- del pedido no reproduce lo cobrado, REVIENTA (el llamador aísla y el pago
-- queda Aprobado sin pedido = cola de conciliación).
-- ============================================================================
create function public.crear_pedido_publico_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  c_contract constant text:='momos.pide.pedido.v1';
  v_quote_id uuid;
  v_quote public.quotes%rowtype;
  v_pago public.payments%rowtype;
  v_ses public.checkout_sessions%rowtype;
  v_benefit public.benefits%rowtype;
  v_benefit_resuelto text;
  v_benefit_warning boolean:=false;
  v_linea jsonb;
  v_lineas jsonb:='[]'::jsonb;
  v_desc numeric:=0;
  v_dom numeric:=0;
  v_campaign text;
  v_creative text;
  v_idem text;
  v_order_id text;
  v_res jsonb;
  v_total_core numeric;
  v_promovido boolean;
  v_faltantes jsonb:='[]'::jsonb;
  v_token uuid;
begin
  -- Gate de rol: pide_service por conexión directa (session_user) o por claim
  -- JWT. service_role queda EXCLUIDO a propósito (spec §2).
  if session_user<>'pide_service'
     and coalesce(auth.role(),'') is distinct from 'pide_service' then
    raise exception 'Solo el servicio Pide puede crear pedidos públicos.' using errcode='42501';
  end if;

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

  -- Locks canónicos: quote → payment (el mismo orden del reaper P03).
  select * into v_quote from public.quotes where id=v_quote_id for update;
  if v_quote.id is null or v_quote.canal<>'Pide' then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La cotización no es válida.');
  end if;
  select * into v_pago from public.payments
    where quote_id=v_quote_id and estado='Aprobado'
    for update;
  if v_pago.id is null then
    return public._pide_error(c_contract,'PAGO_NO_CONFIRMADO','El pedido público solo nace de un pago aprobado.');
  end if;

  -- Gate de datos: el evento FIRMADO de aprobación con monto EXACTO debe
  -- existir en esta misma base (jamás se confía en el estado a secas).
  if not exists(select 1 from public.payment_events pe
      where pe.payment_id=v_pago.id and pe.tipo='Aprobado' and pe.firma_ok
        and pe.monto_reportado is not distinct from v_pago.monto) then
    return public._pide_error(c_contract,'EVIDENCIA_INSUFICIENTE','Falta el evento firmado de aprobación con monto exacto.');
  end if;

  -- Idempotencia DETERMINÍSTICA: mismo pago ⇒ mismo pedido, para siempre.
  v_idem:=public._pide_uuid5(v_pago.id::text)::text;
  select id into v_order_id from public.orders where idempotency_key=v_idem;
  if v_order_id is not null then
    select token into v_token from public.order_tracking_tokens
      where order_id=v_order_id and estado='Activo';
    if v_token is null then
      v_token:=gen_random_uuid();
      insert into public.order_tracking_tokens(token,order_id) values(v_token,v_order_id);
    end if;
    return jsonb_build_object('contract',c_contract,
      'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
      'ok',true,'reused',true,'order_id',v_order_id,'tracking_token',v_token,
      'total',v_pago.monto,'faltantes','[]'::jsonb);
  end if;

  if v_quote.estado='Usada' then
    -- Usada sin pedido de ESTE pago: otra vía la consumió — jamás fabricar un
    -- segundo pedido; conciliación humana con la evidencia sellada.
    raise warning 'crear_pedido_publico_v1: quote % Usada sin pedido del pago % — conciliar.',v_quote_id,v_pago.id;
    return public._pide_error(c_contract,'CONCILIACION','La cotización figura usada sin pedido de este pago; conciliación manual.');
  end if;
  if v_pago.monto is distinct from v_quote.total then
    raise warning 'crear_pedido_publico_v1: monto del intent % (%) no coincide con la quote % (%) — conciliar.',
      v_pago.id,v_pago.monto,v_quote_id,v_quote.total;
    return public._pide_error(c_contract,'CONCILIACION','El monto del pago no coincide con la cotización; conciliación manual.');
  end if;

  select * into v_ses from public.checkout_sessions where quote_id=v_quote_id;
  if v_ses.quote_id is null then
    raise warning 'crear_pedido_publico_v1: quote % sin checkout_session — conciliar.',v_quote_id;
    return public._pide_error(c_contract,'CONCILIACION','No hay datos de entrega para este pago; conciliación manual.');
  end if;

  -- Beneficio de la quote: el descarte silencioso queda PROHIBIDO en esta rama.
  -- Si no es consumible, el descuento congelado se honra IGUAL (lo cobrado es
  -- la quote) y queda warning + auditoría para conciliación humana.
  if v_quote.benefit_id is not null then
    select * into v_benefit from public.benefits
      where id=v_quote.benefit_id for update;
    if v_benefit.id is not null and v_benefit.estado='Reservado'
       and v_benefit.pedido_uso is null and v_benefit.hold_quote_id=v_quote_id then
      -- Paso 1 del re-punte (constraint P01: hold_quote_id y pedido_uso jamás
      -- conviven): se suelta el hold ANTES de crear el pedido; el paso 2
      -- (pedido_uso) llega con el order_id ya emitido.
      update public.benefits set hold_quote_id=null
        where id=v_benefit.id and estado='Reservado' and hold_quote_id=v_quote_id;
      v_benefit_resuelto:=v_benefit.id;
    else
      v_benefit_warning:=true;
    end if;
  end if;

  -- Líneas congeladas de la quote → payload del core sellado.
  for v_linea in select * from jsonb_array_elements(coalesce(v_quote.lineas,'[]'::jsonb))
  loop
    if v_linea->>'tipo'='producto' then
      v_lineas:=v_lineas||(
        jsonb_build_object(
          'product_id',v_linea->>'product_id',
          'cant',(v_linea->>'cantidad')::numeric,
          'precio_congelado',(v_linea->>'precio_unit')::numeric)
        ||case
            when v_linea#>'{detalle,boxes}' is not null
              then jsonb_build_object('boxes',v_linea#>'{detalle,boxes}')
            else jsonb_build_object(
              'figura',coalesce(v_linea#>>'{detalle,figura}',''),
              'sabor',coalesce(v_linea#>>'{detalle,sabor}',''),
              'salsa',coalesce(v_linea#>>'{detalle,salsa}',''))
          end);
    elsif v_linea->>'tipo'='beneficio' then
      v_desc:=greatest(v_desc,-coalesce((v_linea->>'total')::numeric,0));
    elsif v_linea->>'tipo'='domicilio' then
      v_dom:=coalesce((v_linea->>'total')::numeric,0);
    end if;
  end loop;
  if jsonb_array_length(v_lineas)=0 then
    raise warning 'crear_pedido_publico_v1: quote % sin líneas de producto (¿anonimizada?) — conciliar.',v_quote_id;
    return public._pide_error(c_contract,'CONCILIACION','La cotización no conserva líneas; conciliación manual.');
  end if;

  -- Atribución → columnas canónicas SOLO si existen en el catálogo (FK reales);
  -- el resto de la señal queda completa en order_attributions.
  v_campaign:=nullif(v_quote.atribucion->>'campaign_id','');
  if v_campaign is not null
     and not exists(select 1 from public.campaigns c where c.id=v_campaign) then
    v_campaign:=null;
  end if;
  v_creative:=nullif(v_quote.atribucion->>'creative_id','');
  if v_creative is not null
     and not exists(select 1 from public.creatives c where c.id=v_creative) then
    v_creative:=null;
  end if;

  -- Core SELLADO: el contexto se enciende, se usa y se apaga en esta llamada.
  perform set_config('momos.pide_ctx','p04',true);
  begin
    v_res:=public._crear_pedido_core(jsonb_build_object(
      'canal','Pide',
      'zona',v_quote.zona,
      'barrio',v_ses.barrio,
      'direccion',v_ses.direccion,
      'pago','Pasarela (web)',
      'obs',case when coalesce(v_ses.referencia,'')<>''
        then 'Referencia: '||v_ses.referencia else '' end,
      'idempotency_key',v_idem,
      'campaign_id',v_campaign,
      'creative_id',v_creative,
      'origen_detalle','Pide MOMOS',
      'fecha_entrega',v_quote.fecha_entrega,
      'franja',v_quote.franja,
      'dom_congelado',v_dom,
      'descuento_congelado',v_desc,
      'benefit_resuelto',v_benefit_resuelto,
      'nuevo_cliente',jsonb_build_object(
        'nombre',v_ses.nombre,'telefono',v_ses.telefono,
        'direccion',v_ses.direccion,'barrio',v_ses.barrio,'canal','Pide'),
      'lineas',v_lineas));
    v_order_id:=v_res->>'order_id';

    -- Invariante de dinero: el pedido reproduce EXACTO lo cobrado o revienta
    -- (el evento y el pago Aprobado sobreviven en el llamador = conciliación).
    v_total_core:=(v_res->>'total')::numeric;
    if v_total_core is distinct from v_quote.total then
      raise exception 'PIDE_TOTAL_DIVERGENTE: el pedido % reproduce % y lo cobrado fue % — se revierte a conciliación.',
        v_order_id,v_total_core,v_quote.total;
    end if;

    -- Paso 2 del beneficio: pedido_uso con el order_id ya emitido; el efecto
    -- [Pagado] del core lo pasa Reservado→Usado.
    if v_benefit_resuelto is not null then
      update public.benefits set pedido_uso=v_order_id
        where id=v_benefit_resuelto and estado='Reservado' and pedido_uso is null;
      if not found then
        v_benefit_warning:=true;
      end if;
    end if;

    -- Promoción del hold (sin re-correr FIFO) + patas que el hold no cubre.
    -- Sin hold Temporal: el core re-toma TODO con faltante explícito.
    v_promovido:=public._pide_promover_holds(v_quote_id,v_order_id);
    if v_promovido then
      update public.orders set inventario_reservado=true where id=v_order_id;
      -- El regalo de producto_gratis no vino del hold: se reserva con el leg
      -- espejo (lock de producto → FIFO → faltante explícito). Corre ANTES de
      -- las patas para conservar el orden canónico de _reserve_inventory
      -- (products → lote_figuras → inventory_items) — invertirlo abría un
      -- ABBA con el camino staff (hallazgo del re-juicio, cerrado acá).
      if v_benefit_resuelto is not null
         and v_benefit.tipo_beneficio='producto_gratis'
         and v_benefit.producto_gratis_id is not null then
        v_faltantes:=v_faltantes||public._pide_reservar_item_regalo(
          v_order_id,v_benefit.producto_gratis_id);
      end if;
      v_faltantes:=v_faltantes||public._pide_reservar_pedido_patas(v_order_id);
    end if;

    -- El pago queda atado al pedido ANTES de la transición: el gate [Pagado]
    -- por canal exige exactamente esta evidencia.
    update public.payments
      set order_id=v_order_id,actualizado_at=clock_timestamp()
      where id=v_pago.id;
    update public.quotes set estado='Usada' where id=v_quote_id;
    if v_quote.atribucion is not null then
      insert into public.order_attributions(order_id,atribucion)
      values(v_order_id,v_quote.atribucion)
      on conflict (order_id) do nothing;
    end if;

    v_res:=public._set_order_status_core(v_order_id,'Pagado',false);
    v_faltantes:=v_faltantes||coalesce(v_res->'faltantes','[]'::jsonb);

    if v_benefit_warning then
      perform public._add_audit('Pedido',v_order_id,'Beneficio de la quote no consumible','',
        'conciliar beneficio '||coalesce(v_quote.benefit_id,'(sin id)'));
      raise warning 'crear_pedido_publico_v1: beneficio % de la quote % no consumible; el descuento congelado se honró y queda conciliación.',
        v_quote.benefit_id,v_quote_id;
    end if;

    -- Token de tracking: emisión EXPLÍCITA, solo canal Pide (spec §1.7).
    v_token:=gen_random_uuid();
    insert into public.order_tracking_tokens(token,order_id)
    values(v_token,v_order_id);

    -- Privacidad al cierre: la sesión ya vive en customers/orders y la
    -- atribución en order_attributions — la quote se anonimiza (P01 verbatim).
    perform public._pide_anonimizar_checkout(v_quote_id);

    perform set_config('momos.pide_ctx','',true);
  exception when others then
    -- El rollback del savepoint revierte también el GUC; el clear explícito es
    -- defensa en profundidad para sabores de error no transaccionales.
    perform set_config('momos.pide_ctx','',true);
    raise;
  end;

  return jsonb_build_object('contract',c_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'reused',false,'order_id',v_order_id,'tracking_token',v_token,
    'total',v_quote.total,'faltantes',v_faltantes);
end $$;

-- ============================================================================
-- registrar_evento_pago_v1 — el webhook hacia la base. El worker privado
-- verifica la FIRMA sobre el raw body (tiempo constante, frescura ±5 min,
-- rotación con dos secretos y key-id) y atesta firma_ok; la base exige esa
-- atestación para todo efecto, registra el evento idempotente por
-- (payment_id, external_event_id) y aplica la máquina de estados. El body
-- JAMÁS se persiste ni se loguea: solo payload_hash.
-- ============================================================================
create function public.registrar_evento_pago_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  c_contract constant text:='momos.pide.webhook.v1';
  v_payment_id uuid;
  v_pago public.payments%rowtype;
  v_quote_id uuid;
  v_evento_id text;
  v_tipo text;
  v_estado_rep text;
  v_monto numeric;
  v_firma boolean;
  v_key text;
  v_hash text;
  v_ts timestamptz;
  v_ext text;
  v_ev_id uuid;
  v_resultado text:='';
  v_order jsonb;
  v_pedido text;
begin
  if session_user<>'pide_service'
     and coalesce(auth.role(),'') is distinct from 'pide_service' then
    raise exception 'Solo el servicio Pide puede registrar eventos de pago.' using errcode='42501';
  end if;

  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>4096 then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','La solicitud no tiene la forma esperada.');
  end if;

  v_evento_id:=btrim(coalesce(p->>'external_event_id',''));
  v_tipo:=btrim(coalesce(p->>'tipo',''));
  v_estado_rep:=left(btrim(coalesce(p->>'estado_reportado','')),60);
  v_hash:=lower(btrim(coalesce(p->>'payload_hash','')));
  v_key:=nullif(btrim(coalesce(p->>'key_id','')),'');
  v_ext:=nullif(btrim(coalesce(p->>'external_id','')),'');
  begin
    v_firma:=(p->>'firma_ok')::boolean;
    v_monto:=(p->>'monto_reportado')::numeric;
    v_ts:=(p->>'evento_ts')::timestamptz;
  exception when others then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','firma_ok/monto/evento_ts no tienen la forma esperada.');
  end;
  if v_evento_id !~ '^[A-Za-z0-9_.:-]{1,120}$'
     or v_tipo not in ('Aprobado','Rechazado','Cancelado','Expirado','Reembolso','Desconocido')
     or v_estado_rep=''
     or v_hash !~ '^[0-9a-f]{64}$'
     or v_firma is null
     or (v_key is not null and v_key !~ '^[A-Za-z0-9_.-]{1,40}$')
     or (v_ext is not null and v_ext !~ '^[A-Za-z0-9_.:-]{1,120}$')
     or (v_monto is not null and v_monto<0) then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','El evento no tiene la forma esperada.');
  end if;
  -- Una firma verificada exige key-id y timestamp firmado; la frescura real
  -- (±5 min) la aplicó el worker sobre el raw body — acá solo sanidad de reloj.
  if v_firma and (v_key is null or v_ts is null) then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','Una firma verificada exige key_id y evento_ts.');
  end if;
  if v_ts is not null and v_ts>clock_timestamp()
      +make_interval(mins=>public._pide_setting_int('pide_webhook_futuro_max_minutos',5)) then
    return public._pide_error(c_contract,'ENTRADA_INVALIDA','El evento_ts está en el futuro.');
  end if;

  -- Resolver el pago: payment_id preferente; (proveedor, external_id) como
  -- vía alterna. Sin pago no hay fila posible (FK): el worker registra el
  -- rechazo afuera y la pasarela reintenta.
  begin
    v_payment_id:=(p->>'payment_id')::uuid;
  exception when others then
    v_payment_id:=null;
  end;
  if v_payment_id is null and v_ext is not null then
    select id into v_payment_id from public.payments
      where proveedor=btrim(coalesce(p->>'proveedor','')) and external_id=v_ext;
  end if;
  if v_payment_id is null
     or not exists(select 1 from public.payments where id=v_payment_id) then
    return public._pide_error(c_contract,'PAGO_DESCONOCIDO','El evento no corresponde a ningún intent conocido.');
  end if;

  -- Locks canónicos: quote → payment (mismo orden que el reaper y el pedido).
  select quote_id into v_quote_id from public.payments where id=v_payment_id;
  perform 1 from public.quotes where id=v_quote_id for update;
  select * into v_pago from public.payments where id=v_payment_id for update;

  -- Idempotencia: (payment_id, external_event_id) es el árbitro.
  insert into public.payment_events(
    payment_id,external_event_id,tipo,estado_reportado,monto_reportado,
    firma_ok,key_id,payload_hash,evento_ts,resultado)
  values(v_pago.id,v_evento_id,v_tipo,v_estado_rep,v_monto,
    v_firma,v_key,v_hash,v_ts,'')
  on conflict (payment_id,external_event_id) do nothing
  returning id into v_ev_id;
  if v_ev_id is null then
    select resultado into v_resultado from public.payment_events
      where payment_id=v_pago.id and external_event_id=v_evento_id;
    return jsonb_build_object('contract',c_contract,
      'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
      'ok',true,'replay',true,'payment_id',v_pago.id,'estado',v_pago.estado,
      'resultado',coalesce(v_resultado,''));
  end if;

  if not v_firma then
    v_resultado:='firma_invalida: sin efectos';
    update public.payment_events
      set procesado_at=clock_timestamp(),resultado=v_resultado where id=v_ev_id;
    raise warning 'registrar_evento_pago_v1: evento % del pago % con firma inválida.',v_evento_id,v_pago.id;
    return jsonb_build_object('contract',c_contract,
      'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
      'ok',false,'error','FIRMA_INVALIDA','payment_id',v_pago.id,
      'estado',v_pago.estado,'resultado',v_resultado);
  end if;

  if v_tipo='Aprobado' then
    if v_pago.estado='Iniciado' then
      -- El pago se sella Aprobado (verdad del dinero) ANTES de intentar el
      -- pedido; external_id se sella una sola vez (guard P01).
      update public.payments
        set estado='Aprobado',
            external_id=coalesce(v_pago.external_id,v_ext),
            actualizado_at=clock_timestamp()
        where id=v_pago.id;
      if v_monto is distinct from v_pago.monto then
        v_resultado:='aprobado_monto_distinto: conciliar (pedido bloqueado)';
        raise warning 'registrar_evento_pago_v1: pago % aprobado con monto % distinto del intent % — conciliar.',
          v_pago.id,v_monto,v_pago.monto;
      else
        -- Pedido en SUB-BLOQUE AISLADO: si falla, el evento y el pago Aprobado
        -- SOBREVIVEN — «un webhook confirmado siempre produce pedido o entra a
        -- cola de conciliación con evidencia».
        begin
          v_order:=public.crear_pedido_publico_v1(jsonb_build_object('quote_id',v_quote_id));
          if coalesce((v_order->>'ok')::boolean,false) then
            v_pedido:=v_order->>'order_id';
            v_resultado:='pedido_creado: '||coalesce(v_pedido,'');
          else
            v_resultado:='pedido_pendiente: '||coalesce(v_order->>'error','');
            raise warning 'registrar_evento_pago_v1: pago % aprobado sin pedido (%).',
              v_pago.id,coalesce(v_order->>'error','');
          end if;
        exception when others then
          v_resultado:='pedido_pendiente_conciliar: '||left(sqlerrm,120);
          raise warning 'registrar_evento_pago_v1: pago % aprobado sin pedido (%).',v_pago.id,sqlerrm;
        end;
      end if;
    elsif v_pago.estado='Aprobado' then
      -- Reintento legítimo de la pasarela: si el pedido aún no existe, este
      -- evento lo RECUPERA (la key determinística garantiza un solo pedido).
      if v_pago.order_id is null and v_monto is not distinct from v_pago.monto then
        begin
          v_order:=public.crear_pedido_publico_v1(jsonb_build_object('quote_id',v_quote_id));
          if coalesce((v_order->>'ok')::boolean,false) then
            v_pedido:=v_order->>'order_id';
            v_resultado:='pedido_recuperado: '||coalesce(v_pedido,'');
          else
            v_resultado:='pedido_pendiente: '||coalesce(v_order->>'error','');
          end if;
        exception when others then
          v_resultado:='pedido_pendiente_conciliar: '||left(sqlerrm,120);
          raise warning 'registrar_evento_pago_v1: pago % sigue sin pedido (%).',v_pago.id,sqlerrm;
        end;
      else
        v_pedido:=v_pago.order_id;
        v_resultado:='replay_aprobado';
      end if;
    else
      -- Aprobado sobre un pago terminal (Rechazado/Expirado/Reembolsado):
      -- regresivo — jamás se re-abre (guard P01); conciliación con reembolso.
      v_resultado:='regresivo: pago '||v_pago.estado||' recibió Aprobado — conciliar';
      raise warning 'registrar_evento_pago_v1: pago % en estado % recibió Aprobado — conciliar.',
        v_pago.id,v_pago.estado;
    end if;

  elsif v_tipo in ('Rechazado','Cancelado','Expirado') then
    if v_pago.estado='Iniciado' then
      update public.payments
        set estado=case when v_tipo='Expirado' then 'Expirado' else 'Rechazado' end,
            actualizado_at=clock_timestamp()
        where id=v_pago.id;
      -- El hold vuelve a su expira_original (reversa exacta, rama (b) del
      -- guard P01); el beneficio lo reactiva la liberación al vencer el hold —
      -- ya sin intent vivo que la frene (anti doble canje intacto).
      update public.checkout_holds
        set expira_at=expira_original,extendido_por_pago_at=null
        where quote_id=v_quote_id and estado='Temporal'
          and extendido_por_pago_at is not null;
      v_resultado:='intent_cerrado: '||v_tipo;
    else
      v_resultado:='sin_efecto: pago '||v_pago.estado;
    end if;

  elsif v_tipo='Reembolso' then
    if v_pago.estado='Aprobado' then
      update public.payments
        set estado='Reembolsado',actualizado_at=clock_timestamp()
        where id=v_pago.id;
      -- El pedido NO se cancela automáticamente: la decisión operativa
      -- (reponer, cancelar, reclamo) es humana — acá queda la evidencia.
      v_resultado:='reembolso_registrado: pedido '||coalesce(v_pago.order_id,'(sin pedido)')||' a conciliación humana';
      raise warning 'registrar_evento_pago_v1: pago % reembolsado (pedido %) — conciliación humana.',
        v_pago.id,coalesce(v_pago.order_id,'(sin pedido)');
    else
      v_resultado:='sin_efecto: pago '||v_pago.estado;
    end if;

  else
    v_resultado:='registrado_sin_efecto';
  end if;

  update public.payment_events
    set procesado_at=clock_timestamp(),resultado=left(v_resultado,200)
    where id=v_ev_id;
  select * into v_pago from public.payments where id=v_payment_id;

  return jsonb_build_object('contract',c_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'replay',false,'payment_id',v_pago.id,'estado',v_pago.estado,
    'resultado',v_resultado,'order_id',v_pedido);
end $$;

-- ============================================================================
-- tracking_publico_v1 — token opaco para anon. Mapping COMPLETO, degradación
-- post-Entregado, expiración perezosa, rate limit y respuesta INDISTINGUIBLE
-- entre token inexistente/invalidado/expirado (anti-oráculo).
-- ============================================================================
create function public.tracking_publico_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  c_contract constant text:='momos.pide.tracking.v1';
  v_ventana interval;
  v_headers jsonb; v_xff text; v_ip_hash text; v_bucket text;
  v_token uuid;
  v_tok public.order_tracking_tokens%rowtype;
  v_o public.orders%rowtype;
  v_dias integer;
  v_estado_fuente text;
  v_pay text;
  v_publico text;
begin
  -- Rate limit (defensa de costo; patrón P02/P03) — ANTES de todo.
  v_ventana:=make_interval(mins=>public._pide_setting_int('pide_rate_ventana_minutos',10));
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers:='{}'::jsonb; end;
  v_xff:=coalesce(v_headers->>'x-forwarded-for','');
  v_xff:=btrim(coalesce(nullif(split_part(v_xff,',',
    greatest(1,coalesce(array_length(string_to_array(v_xff,','),1),1))),''),'sin-ip'));
  v_ip_hash:=encode(sha256(v_xff::bytea),'hex');
  v_bucket:=floor(extract(epoch from clock_timestamp())
    /(60*public._pide_setting_int('pide_rate_ventana_minutos',10)))::bigint::text;
  perform public._pide_rate_golpe('trg:'||v_bucket||':'||(pg_backend_pid()%8)::text,v_ventana);
  if (select coalesce(sum(golpes),0) from public.pide_rate_counters
      where clave like 'trg:'||v_bucket||':%')
     > public._pide_setting_int('pide_rate_limit_global',300) then
    return public._pide_error(c_contract,'TRACKING_RATE_LIMIT','Demasiadas consultas; probá en unos minutos.');
  end if;
  if public._pide_rate_golpe('trip:'||v_ip_hash,v_ventana)
     > public._pide_setting_int('pide_rate_limit_tracking',30) then
    return public._pide_error(c_contract,'TRACKING_RATE_LIMIT','Demasiadas consultas; probá en unos minutos.');
  end if;

  begin

  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>1024 then
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end if;
  begin
    v_token:=(p->>'token')::uuid;
  exception when others then
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end;
  if v_token is null then
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end if;

  select * into v_tok from public.order_tracking_tokens
    where token=v_token for update;
  if v_tok.token is null or v_tok.estado<>'Activo' then
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end if;
  select * into v_o from public.orders where id=v_tok.order_id;
  if v_o.id is null or v_o.canal<>'Pide' then
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end if;

  -- Expiración PEREZOSA: el token vive N días desde la ENTREGA (el sello se
  -- planta en la primera lectura post-Entregado; no depende de ningún job).
  v_dias:=public._pide_setting_int('pide_tracking_expira_dias',14);
  if v_o.estado='Entregado' then
    if v_tok.expira_at is null then
      update public.order_tracking_tokens
        set expira_at=clock_timestamp()+make_interval(days=>v_dias)
        where token=v_tok.token;
    elsif v_tok.expira_at<=clock_timestamp() then
      update public.order_tracking_tokens set estado='Expirado'
        where token=v_tok.token;
      return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
    end if;
  end if;

  -- Reclamo: bandera administrativa, NO retroceso logístico (coherente con
  -- fix_retroceso_reclamo) — el público sigue viendo el último estado
  -- logístico real, leído del audit sellado de la transición.
  v_estado_fuente:=v_o.estado;
  if v_o.estado='Reclamo' then
    select de into v_estado_fuente from public.audit_logs
      where entidad='Pedido' and entidad_id=v_o.id
        and accion='Cambio de estado' and a='Reclamo'
      order by fecha desc limit 1;
    v_estado_fuente:=coalesce(nullif(v_estado_fuente,''),'Pagado');
    if v_estado_fuente='Reclamo' then v_estado_fuente:='Pagado'; end if;
  end if;

  v_publico:=case v_estado_fuente
    when 'Nuevo' then 'Pedido recibido'
    when 'Confirmado' then 'Pedido recibido'
    when 'Pendiente de pago' then 'Pedido recibido'
    when 'Pagado' then 'Pago confirmado'
    when 'En producción' then 'En preparación'
    when 'Listo para empaque' then 'Preparando tu entrega'
    when 'Empacado' then 'Preparando tu entrega'
    when 'Listo para despacho' then 'Preparando tu entrega'
    when 'En ruta' then 'En camino'
    when 'Entregado' then 'Entregado'
    when 'Cancelado' then 'Cancelado'
    else 'En proceso'
  end;
  if v_estado_fuente='Cancelado' then
    select pa.estado into v_pay from public.payments pa
      where pa.order_id=v_o.id
      order by case pa.estado when 'Reembolsado' then 0 when 'Aprobado' then 1 else 2 end,
        pa.actualizado_at desc
      limit 1;
    v_publico:=case v_pay
      when 'Reembolsado' then 'Cancelado — reembolso realizado'
      when 'Aprobado' then 'Cancelado — reembolso en proceso'
      else 'Cancelado' end;
  end if;

  -- Degradación post-Entregado: SOLO el estado final — sin zona, franja ni fecha.
  if v_o.estado='Entregado' then
    return jsonb_build_object('contract',c_contract,
      'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false,
        'pseudonymous',true,'scope','single_order'),
      'ok',true,'estado',v_publico,'entregado',true);
  end if;

  return jsonb_build_object('contract',c_contract,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false,
      'pseudonymous',true,'scope','single_order'),
    'ok',true,'estado',v_publico,'entregado',false,
    'fecha_entrega',v_o.fecha_entrega,'franja',v_o.franja,'zona',v_o.zona);
  exception when others then
    -- Anti-oráculo: ningún sabor interno viaja; el detalle queda en el log.
    raise warning 'tracking_publico_v1: %',sqlerrm;
    return public._pide_error(c_contract,'TOKEN_INVALIDO','El seguimiento no está disponible para ese código.');
  end;
end $$;

-- ============================================================================
-- Guard H89 ampliado: order_tracking_tokens entra a la lista cerrada (la
-- dirección PROTECTORA del pendiente del README; tocar la lista sellada de la
-- spec §1.9 queda documentado para ratificación de Jorge). Cuerpo P01 + 1.
-- ============================================================================
create or replace function public.cierre_lecturas_pii_disponible()
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select cardinality(coalesce(public.current_roles(),array[]::text[]))>0
    and exists(select 1 from public.momos_ops_migrations
      where id='20260720_89_cierre_lecturas_pii')
    and to_regprocedure('public.momos_current_user_profile_v1()') is not null
    and not exists(
      select 1 from pg_catalog.pg_policies p
      where p.schemaname='public'
        and p.tablename=any(array[
          'users','customers','orders','order_items','order_item_adiciones',
          'deliveries','evidences','benefits','claims','audit_logs',
          'packing_verifications','order_stage_assignments','order_line_progress',
          'order_incidents','order_dispatch_handoffs','customer_crm_profiles',
          'customer_contacts','customer_activations',
          'quotes','checkout_sessions','checkout_holds','payments',
          'payment_events','pide_demand_events','order_tracking_tokens'
        ]::text[])
        and (p.policyname='staff_read'
          or p.policyname='packing_verifications_staff_read'
          or p.policyname='claude_read')
    )
$$;
revoke all on function public.cierre_lecturas_pii_disponible()
  from public,anon,service_role;
grant execute on function public.cierre_lecturas_pii_disponible() to authenticated;

-- ============================================================================
-- Perímetro y RBAC: tracking es la única superficie anon nueva; las dos RPC de
-- servicio son EXCLUSIVAS de pide_service; núcleo y helpers cerrados a todos.
-- Se re-sella lo reemplazado (create or replace conserva ACLs; el sello
-- explícito es la evidencia del gate).
-- ============================================================================
revoke all on function public._pide_service_ctx()
  from public,anon,authenticated,service_role;
revoke all on function public._pide_uuid5(text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_promover_holds(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_reservar_pedido_patas(text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_reservar_item_regalo(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.crear_pedido_publico_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_evento_pago_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.tracking_publico_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public._crear_pedido_core(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public._set_order_status_core(text,text,boolean)
  from public,anon,authenticated,service_role;

grant execute on function public.crear_pedido_publico_v1(jsonb) to pide_service;
grant execute on function public.registrar_evento_pago_v1(jsonb) to pide_service;
grant execute on function public.tracking_publico_v1(jsonb) to anon,authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_p04_pide_pedido',
  'Pedido publico Pide: evolucion sellada de los cores (via service por contexto transaccional, canal Pide prohibido para staff, gate Pagado por canal con evento firmado), crear_pedido_publico_v1 con key deterministica uuid5 del pago, precios/descuento/domicilio congelados de la quote, promocion de holds sin re-FIFO mas patas de empaque/insumos, sello de fecha_entrega+franja, webhook idempotente con efectos por tipo y sub-bloque aislado, tracking publico con token opaco, rol pide_service y guard H89 ampliado con order_tracking_tokens')
on conflict(id) do nothing;

commit;
