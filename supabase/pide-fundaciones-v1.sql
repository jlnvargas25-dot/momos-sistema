-- MOMOS · Carril Pide · P01 pide-fundaciones-v1
--
-- Fundaciones de schema de la superficie pública de Pide MOMOS
-- (docs/PIDE-SUPERFICIE-PUBLICA-V1.md §1, ítems 1-10; alcance §4.1).
--
-- Carril con prefijo `p` sobre el MISMO ledger public.momos_ops_migrations:
-- el preflight se ancla en 20260721_93_continuidad_recuperacion (último hito
-- OPS verificado en la base viva) más checks de objetos y de las definiciones
-- EXACTAS de los CHECK vivos. NO exige los hitos OPS 94-97: los carriles se
-- aplican en orden libre entre sí y la historia real la da applied_at.
--
-- Este hito NO crea RPCs públicas (llegan en P02-P05) y NO toca
-- _reserve_inventory (el cableado de la liberación perezosa dentro de
-- _reserve_inventory y de las RPC públicas llega en P03; tocarla acá cruzaría
-- el carril OPS). El pepper del HMAC de teléfono vive SOLO en runtime privado:
-- aquí no hay tabla de secretos ni pepper — solo la columna telefono_hmac.
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
declare
  t text;
  v_def text;
  v_cols text[];
begin
  -- Ancla del carril: ledger compartido + H93 aplicado. NO se exige 94-97.
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_93_continuidad_recuperacion') then
    raise exception 'P01 requiere 20260721_93_continuidad_recuperacion aplicado en la base.';
  end if;
  if exists(select 1 from public.momos_ops_migrations
    where id='20260721_p01_pide_fundaciones') then
    raise exception 'P01 ya está aplicado; este hito no se reaplica.';
  end if;

  -- Funciones base vivas.
  if to_regprocedure('public._normalizar_telefono(text)') is null
     or to_regprocedure('public.cierre_lecturas_pii_disponible()') is null
     or to_regprocedure('public._momos_h92_hash(jsonb)') is null
     or to_regprocedure('public.current_roles()') is null
     or to_regprocedure('public.is_staff()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Faltan funciones base (_normalizar_telefono, cierre H89, hash H92 o roles).';
  end if;

  -- Tablas base vivas.
  foreach t in array array[
    'orders','customers','inventory_reservations','benefits','products',
    'production_batches','lote_figuras','zonas','franjas','app_settings'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Falta la tabla base %.',t;
    end if;
  end loop;
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='lote_figuras'
      and column_name='consumidas') then
    raise exception 'Falta lote_figuras.consumidas (cadena FIFO de variantes incompleta).';
  end if;

  -- Los objetos nuevos NO deben existir (residuo = base desconocida).
  foreach t in array array[
    'quotes','checkout_sessions','checkout_holds','checkout_hold_lotes',
    'payments','payment_events','pide_demand_events','pide_demand_snapshots',
    'order_tracking_tokens','order_attributions'
  ] loop
    if to_regclass('public.'||t) is not null then
      raise exception 'La tabla % ya existe: base fuera del estado esperado.',t;
    end if;
  end loop;
  if exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='benefits'
        and column_name='hold_quote_id')
     or exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='products'
        and column_name='pide_hold_fraccion') then
    raise exception 'Columnas P01 ya presentes: base fuera del estado esperado.';
  end if;

  -- CHECK vivos: definición EXACTA por pg_get_constraintdef (fail closed).
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_canal_check';
  if v_def is distinct from
    'CHECK ((canal = ANY (ARRAY[''WhatsApp''::text, ''Instagram''::text, ''Rappi''::text, ''Directo''::text])))' then
    raise exception 'orders_canal_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.customers'::regclass and conname='customers_canal_check';
  if v_def is distinct from
    'CHECK ((canal = ANY (ARRAY[''WhatsApp''::text, ''Instagram''::text, ''Rappi''::text, ''Directo''::text])))' then
    raise exception 'customers_canal_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_origen_detalle_check';
  if v_def is distinct from
    'CHECK ((origen_detalle = ANY (ARRAY[''''::text, ''Historia de Instagram''::text, ''Anuncio Meta''::text, ''TikTok orgánico''::text, ''Reel de Instagram''::text, ''Referido''::text, ''Rappi''::text, ''WhatsApp directo''::text, ''Influencer''::text, ''Otro''::text])))' then
    raise exception 'orders_origen_detalle_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_pago_check';
  if v_def is distinct from
    'CHECK ((pago = ANY (ARRAY[''Nequi''::text, ''Daviplata''::text, ''Bancolombia''::text, ''Rappi (app)''::text])))' then
    raise exception 'orders_pago_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.inventory_reservations'::regclass
      and conname='inventory_reservations_estado_check';
  if v_def is distinct from
    'CHECK ((estado = ANY (ARRAY[''Reservada''::text, ''Liberada''::text, ''Consumida''::text, ''Temporal''::text])))' then
    raise exception 'inventory_reservations_estado_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;

  -- benefits_estado_check YA incluye Reservado: se verifica y NO se recrea.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.benefits'::regclass and conname='benefits_estado_check';
  if v_def is distinct from
    'CHECK ((estado = ANY (ARRAY[''Activo''::text, ''Reservado''::text, ''Usado''::text, ''Vencido''::text])))' then
    raise exception 'benefits_estado_check cambió respecto de lo verificado: %',coalesce(v_def,'(ausente)');
  end if;

  -- Gancho muerto Temporal/expira: cero uso o no se toca nada.
  if exists(select 1 from public.inventory_reservations
    where estado='Temporal' or expira is not null) then
    raise exception 'Hay reservas Temporal o con expira: el gancho no está muerto, no se retira.';
  end if;
  select array_agg(column_name::text order by column_name) into v_cols
    from information_schema.columns
    where table_schema='public' and table_name='inventory_reservations';
  if v_cols is distinct from array[
    'batch_id','cantidad','estado','expira','fecha','figura','id','item_id',
    'liberada_en','nombre','order_id','product_id','tipo']::text[] then
    raise exception 'inventory_reservations cambió de forma: %',array_to_string(v_cols,',');
  end if;
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_reservations'
      and column_name='expira' and data_type='timestamp with time zone'
      and is_nullable='YES') then
    raise exception 'inventory_reservations.expira no es timestamptz nullable.';
  end if;

  -- Guard H89 vigente: igualdad EXACTA por md5 de pg_get_functiondef (hash
  -- capturado de la base viva el 2026-07-21). Marcadores posicionales quedan
  -- prohibidos: eran asimétricos y dejaban pasar cuerpos divergentes.
  v_def:=pg_get_functiondef('public.cierre_lecturas_pii_disponible()'::regprocedure);
  if md5(v_def) is distinct from 'd863dc51f6bc772cda23ba6e5da357b8' then
    raise exception 'cierre_lecturas_pii_disponible() difiere del H89 verificado (md5 vivo: %). No forzar: re-capturar el guard vivo de la base, auditar el cambio y regenerar este hash antes del gate de aplicación.',
      md5(v_def);
  end if;
end $$;

-- ============================================================================
-- §1.1 · Canal Pide en los CHECK vivos (drop + add, misma transacción).
-- ============================================================================
alter table public.orders drop constraint orders_canal_check;
alter table public.orders add constraint orders_canal_check
  check (canal in ('WhatsApp','Instagram','Rappi','Directo','Pide'));

alter table public.customers drop constraint customers_canal_check;
alter table public.customers add constraint customers_canal_check
  check (canal in ('WhatsApp','Instagram','Rappi','Directo','Pide'));

alter table public.orders drop constraint orders_origen_detalle_check;
alter table public.orders add constraint orders_origen_detalle_check
  check (origen_detalle in
    ('','Historia de Instagram','Anuncio Meta','TikTok orgánico','Reel de Instagram',
     'Referido','Rappi','WhatsApp directo','Influencer','Otro','Pide MOMOS'));

alter table public.orders drop constraint orders_pago_check;
alter table public.orders add constraint orders_pago_check
  check (pago in ('Nequi','Daviplata','Bancolombia','Rappi (app)','Pasarela (web)'));

-- Retiro del gancho muerto: el hold del shop vive en checkout_holds.
alter table public.inventory_reservations drop constraint inventory_reservations_estado_check;
alter table public.inventory_reservations add constraint inventory_reservations_estado_check
  check (estado in ('Reservada','Liberada','Consumida'));
alter table public.inventory_reservations drop column expira;

-- ============================================================================
-- §1.2 · quotes — PII mínima, atribución por whitelist, purga en dos fases.
-- ============================================================================
-- Whitelist de atribución (§4 de PIDE-COTIZAR-PEDIDO-V1): la whitelist cierra
-- CLAVES y también VALORES.
--   * Claves de ID de plataforma (campaign_id/creative_id/post_id): patrón
--     opaco estricto ^[A-Za-z0-9:_-]{1,64}$. Los IDs de Meta SON numéricos
--     largos, por eso estas TRES claves admiten numérico largo: es un ID de
--     plataforma, no un teléfono, y se valida contra catálogo en P04. El
--     riesgo real de PII vive en el texto libre, no acá.
--   * Todo valor de texto libre (utm_*, cupon, referido, landing, qr) queda
--     rechazado si al depurar no-dígitos forma un run de 7 o más dígitos
--     (teléfonos, tarjetas, cédulas): un run largo de dígitos jamás es señal
--     comercial legítima — los IDs de plataforma viajan por sus tres claves.
create function public._pide_atribucion_valida(p jsonb)
returns boolean
language sql immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select jsonb_typeof(p)='object'
    and not exists(
      select 1 from jsonb_each(p) e(key,value)
      where e.key not in (
          'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
          'campaign_id','creative_id','post_id','cupon','referido','landing','qr')
        or jsonb_typeof(e.value) not in ('string','null')
        or length(coalesce(e.value #>> '{}',''))>120
        or (e.key in ('campaign_id','creative_id','post_id')
            and jsonb_typeof(e.value)='string'
            and coalesce(e.value #>> '{}','') !~ '^[A-Za-z0-9:_-]{1,64}$')
        or (e.key not in ('campaign_id','creative_id','post_id')
            and regexp_replace(coalesce(e.value #>> '{}',''),'[^0-9]','','g') ~ '^[0-9]{7,}$')
    )
$$;
revoke all on function public._pide_atribucion_valida(jsonb)
  from public,anon,authenticated,service_role;

create table public.quotes(
  id uuid primary key default gen_random_uuid()
    constraint quotes_id_uuid_v4_check check (
      id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  quote_version integer not null default 1 check (quote_version>=1),
  canal text not null default 'Pide' check (canal='Pide'),
  customer_id text references public.customers(id),
  -- HMAC-SHA256 del teléfono normalizado; el pepper vive SOLO en runtime privado.
  telefono_hmac text check (telefono_hmac is null or telefono_hmac ~ '^[0-9a-f]{64}$'),
  lineas jsonb check (lineas is null or jsonb_typeof(lineas)='array'),
  total numeric not null check (total>=0),
  moneda text not null default 'COP' check (moneda='COP'),
  zona text not null references public.zonas(nombre),
  franja text not null references public.franjas(nombre),
  fecha_entrega date not null,
  benefit_id text references public.benefits(id),
  atribucion jsonb check (atribucion is null or public._pide_atribucion_valida(atribucion)),
  estado text not null default 'Vigente' check (estado in ('Vigente','Usada','Vencida')),
  vence_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index quotes_purga_idx on public.quotes(created_at) where estado<>'Usada';

-- §1.2 · order_attributions — schema fundacional: al crear el pedido (P04) la
-- atribución PII-free de la quote se copia acá y la quote puede anonimizarse
-- sin perder la señal comercial. Misma whitelist que quotes.atribucion.
-- NO entra en la lista del guard H89: la spec §1.9 fija las seis tablas y esta
-- es PII-free por construcción (whitelist de claves y valores).
create table public.order_attributions(
  order_id text primary key references public.orders(id) on delete restrict,
  atribucion jsonb not null check (public._pide_atribucion_valida(atribucion)),
  created_at timestamptz not null default clock_timestamp()
);

-- ============================================================================
-- §1.3 · checkout_sessions — el camino de datos del invitado.
-- ============================================================================
create table public.checkout_sessions(
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  -- crudo normalizado por _normalizar_telefono (57 + 10 dígitos).
  telefono text not null check (telefono ~ '^57[0-9]{10}$'),
  direccion text not null check (length(btrim(direccion)) between 3 and 240),
  barrio text not null default '' check (length(barrio)<=120),
  referencia text not null default '' check (length(referencia)<=240),
  opt_in boolean not null default false,   -- separado y JAMÁS preseleccionado
  created_at timestamptz not null default clock_timestamp()
);

-- ============================================================================
-- §1.4 + §1.5 · checkout_holds + checkout_hold_lotes — hold con lote exacto
-- y techos anti-acaparamiento a nivel schema.
-- ============================================================================
create table public.checkout_holds(
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  -- actor del techo "un checkout vivo": HMAC (teléfono/dispositivo/IP) del
  -- runtime privado; jamás el identificador crudo.
  actor_hmac text not null check (actor_hmac ~ '^[0-9a-f]{64}$'),
  estado text not null default 'Temporal'
    check (estado in ('Temporal','Confirmada','Expirada')),
  creado_at timestamptz not null default clock_timestamp(),
  expira_original timestamptz not null,
  expira_at timestamptz not null,
  -- extensión UNA sola vez, por el intent de pago; un intent rechazado/vencido
  -- devuelve expira_at a expira_original limpiando el sello. Exactly-once EN
  -- SCHEMA: el trigger checkout_holds_guard solo admite sellar una vez o la
  -- reversa exacta — el constraint solo no alcanza (permitiría N re-extensiones).
  extendido_por_pago_at timestamptz,
  resuelto_at timestamptz,
  constraint checkout_holds_extension_coherente check (
    (extendido_por_pago_at is null and expira_at=expira_original)
    or (extendido_por_pago_at is not null and expira_at>=expira_original)),
  constraint checkout_holds_resolucion_coherente check (
    (estado='Temporal' and resuelto_at is null)
    or (estado<>'Temporal' and resuelto_at is not null))
);
-- Idempotencia bajo carrera: un solo hold vivo por quote (patrón
-- customers_telefono_unique_idx) y un solo checkout vivo por actor.
create unique index checkout_holds_quote_temporal_uidx
  on public.checkout_holds(quote_id) where estado='Temporal';
create unique index checkout_holds_actor_temporal_uidx
  on public.checkout_holds(actor_hmac) where estado='Temporal';
create index checkout_holds_expirados_idx
  on public.checkout_holds(expira_at) where estado='Temporal';

-- Exactly-once de la extensión y terminalidad de estados COMO INVARIANTE DE
-- DATOS, no promesa de RPC:
--   (a) sellar la extensión UNA sola vez: extendido_por_pago_at pasa de null a
--       not null Y expira_at sube en ese MISMO update;
--   (b) reversa tras intent rechazado/vencido: expira_at=expira_original
--       limpiando extendido_por_pago_at;
--   y nada más — cualquier otro cambio de expira_at/extension se rechaza.
-- Además: expira_original es inmutable y de un estado terminal
-- (Confirmada/Expirada) no se sale jamás.
create function public._pide_checkout_holds_guard()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if old.estado in ('Confirmada','Expirada') and new.estado is distinct from old.estado then
    raise exception 'checkout_holds: % es terminal; la transición a % está prohibida.',
      old.estado,new.estado;
  end if;
  if new.expira_original is distinct from old.expira_original then
    raise exception 'checkout_holds: expira_original es inmutable.';
  end if;
  if new.quote_id is distinct from old.quote_id
     or new.actor_hmac is distinct from old.actor_hmac
     or new.creado_at is distinct from old.creado_at then
    raise exception 'checkout_holds: quote_id/actor_hmac/creado_at son inmutables.';
  end if;
  if old.resuelto_at is not null
     and new.resuelto_at is distinct from old.resuelto_at then
    raise exception 'checkout_holds: resuelto_at se sella una sola vez.';
  end if;
  if new.expira_at is distinct from old.expira_at
     or new.extendido_por_pago_at is distinct from old.extendido_por_pago_at then
    if old.estado='Temporal' and new.estado='Temporal'
       and old.extendido_por_pago_at is null
       and new.extendido_por_pago_at is not null
       and new.expira_at>old.expira_at then
      null;  -- (a) sello de extensión: una sola vez, sube expira_at en el mismo update
    elsif old.estado='Temporal' and new.estado='Temporal'
       and old.extendido_por_pago_at is not null
       and new.extendido_por_pago_at is null
       and new.expira_at=new.expira_original then
      null;  -- (b) reversa exacta a expira_original tras intent rechazado/vencido
    else
      raise exception 'checkout_holds: expira_at/extension solo admite el sello único (a) o la reversa a expira_original (b).';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._pide_checkout_holds_guard()
  from public,anon,authenticated,service_role;
create trigger checkout_holds_guard
before update on public.checkout_holds
for each row execute function public._pide_checkout_holds_guard();

-- Detalle exacto del descuento: cada fila descuenta products.stock (suma por
-- product_id) y, cuando batch_id no es null, lote_figuras.consumidas del lote
-- EXACTO que corrió el FIFO — sin batch_id la devolución fuga disponibilidad.
create table public.checkout_hold_lotes(
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.checkout_holds(id) on delete restrict,
  product_id text not null references public.products(id),
  batch_id text,
  figura text,
  cantidad integer not null check (cantidad>0),
  constraint checkout_hold_lotes_lote_coherente check (
    (batch_id is null and figura is null)
    or (batch_id is not null and figura is not null)),
  constraint checkout_hold_lotes_lote_fk
    foreign key (batch_id,figura) references public.lote_figuras(batch_id,figura)
);
create index checkout_hold_lotes_hold_idx on public.checkout_hold_lotes(hold_id);
create index checkout_hold_lotes_producto_idx on public.checkout_hold_lotes(product_id);

-- Techos configurables (§1.5). El techo por producto puede sobrescribir la
-- fracción global; NULL = usa el default de app_settings.
alter table public.products add column pide_hold_fraccion numeric
  check (pide_hold_fraccion is null or (pide_hold_fraccion>=0 and pide_hold_fraccion<=1));
insert into public.app_settings(clave,valor) values
  ('pide_hold_ttl_minutos',to_jsonb(7)),
  ('pide_hold_extension_minutos',to_jsonb(10)),
  ('pide_hold_stock_fraccion',to_jsonb(0.5)),
  ('pide_purga_checkout_horas',to_jsonb(48)),
  ('pide_tracking_expira_dias',to_jsonb(14))
on conflict (clave) do nothing;

-- ============================================================================
-- §1.6 · payments + payment_events — lista blanca por columnas, jamás payload.
-- ============================================================================
create table public.payments(
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  proveedor text not null check (proveedor ~ '^[a-z0-9_]{2,40}$'),
  external_id text check (external_id is null or external_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  monto numeric not null check (monto>0),
  moneda text not null default 'COP' check (moneda='COP'),
  estado text not null default 'Iniciado'
    check (estado in ('Iniciado','Aprobado','Rechazado','Expirado','Reembolsado')),
  order_id text references public.orders(id),
  creado_at timestamptz not null default clock_timestamp(),
  actualizado_at timestamptz not null default clock_timestamp()
);
-- Un solo intent VIVO O APROBADO por quote: el UNIQUE parcial cubre
-- 'Iniciado' Y 'Aprobado' — cubrir solo 'Iniciado' permitía dos filas
-- Aprobado (doble captura real). El segundo webhook LEGÍTIMO de aprobación
-- del mismo pago actualiza la misma fila; un segundo payment Aprobado para la
-- quote choca acá y P04 lo enruta a conciliación. 'Reembolsado' libera el
-- slot: una recompra legítima puede abrir un intent nuevo sobre la quote.
create unique index payments_quote_vivo_uidx
  on public.payments(quote_id) where estado in ('Iniciado','Aprobado');
create unique index payments_proveedor_external_uidx
  on public.payments(proveedor,external_id) where external_id is not null;
create index payments_order_idx on public.payments(order_id) where order_id is not null;

-- Terminalidad de payments como invariante de datos (exactly-once en schema):
-- Rechazado/Expirado/Reembolsado no se abandonan y Aprobado solo avanza a
-- Reembolsado. Un webhook regresivo (p.ej. Aprobado→Iniciado) choca acá y
-- P04 lo enruta a conciliación — jamás re-abre un pago cerrado.
create function public._pide_payments_guard()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if new.estado is distinct from old.estado then
    if old.estado in ('Rechazado','Expirado','Reembolsado') then
      raise exception 'payments: % es terminal; la transición a % está prohibida.',
        old.estado,new.estado;
    end if;
    if old.estado='Aprobado' and new.estado<>'Reembolsado' then
      raise exception 'payments: Aprobado solo puede pasar a Reembolsado, jamás a %.',
        new.estado;
    end if;
  end if;
  -- Columnas de verdad selladas una vez cerrado el pago (Aprobado o terminal):
  -- un bug de RPC jamás reescribe el monto de un pago aprobado. external_id
  -- solo admite sellarse una vez (null → valor).
  if old.estado in ('Aprobado','Rechazado','Expirado','Reembolsado') then
    if new.quote_id is distinct from old.quote_id
       or new.proveedor is distinct from old.proveedor
       or new.monto is distinct from old.monto
       or new.moneda is distinct from old.moneda
       or (new.external_id is distinct from old.external_id
           and old.external_id is not null) then
      raise exception 'payments: quote_id/proveedor/monto/moneda/external_id están sellados en estado %.',
        old.estado;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._pide_payments_guard()
  from public,anon,authenticated,service_role;
create trigger payments_guard
before update on public.payments
for each row execute function public._pide_payments_guard();

create table public.payment_events(
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  external_event_id text not null check (external_event_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  tipo text not null check (tipo in
    ('Aprobado','Rechazado','Cancelado','Expirado','Reembolso','Desconocido')),
  estado_reportado text not null check (length(estado_reportado) between 1 and 60),
  monto_reportado numeric check (monto_reportado is null or monto_reportado>=0),
  firma_ok boolean not null,
  key_id text check (key_id is null or key_id ~ '^[A-Za-z0-9_.-]{1,40}$'),
  -- El body jamás se persiste ni se loguea: solo su hash para conciliación.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  evento_ts timestamptz,
  recibido_at timestamptz not null default clock_timestamp(),
  procesado_at timestamptz,
  resultado text not null default '' check (length(resultado)<=200),
  constraint payment_events_unico unique (payment_id,external_event_id)
);

-- ============================================================================
-- §1.7 · Tracking público — token v4 explícito, sin default de columna.
-- ============================================================================
create table public.order_tracking_tokens(
  -- SIN default: la emisión es una decisión explícita (solo pedidos del canal
  -- Pide, en la RPC de P04) — jamás un default de columna.
  token uuid primary key
    constraint order_tracking_tokens_v4_check check (
      token::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  order_id text not null references public.orders(id) on delete restrict,
  estado text not null default 'Activo' check (estado in ('Activo','Invalidado','Expirado')),
  emitido_at timestamptz not null default clock_timestamp(),
  expira_at timestamptz,
  invalidado_at timestamptz,
  constraint order_tracking_tokens_invalidado_coherente check (
    (estado='Invalidado')=(invalidado_at is not null))
);
-- Re-emitir invalida el anterior: un solo token Activo por pedido.
create unique index order_tracking_tokens_order_activo_uidx
  on public.order_tracking_tokens(order_id) where estado='Activo';

-- Terminalidad como invariante de datos: Invalidado/Expirado jamás vuelven a
-- Activo — re-habilitar el acceso requiere EMITIR un token nuevo (decisión
-- explícita de la RPC de P04), nunca resucitar uno quemado.
create function public._pide_tracking_tokens_guard()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if new.estado is distinct from old.estado
     and old.estado in ('Invalidado','Expirado') then
    raise exception 'order_tracking_tokens: % es terminal; la transición a % está prohibida.',
      old.estado,new.estado;
  end if;
  if new.order_id is distinct from old.order_id
     or new.emitido_at is distinct from old.emitido_at then
    raise exception 'order_tracking_tokens: order_id/emitido_at son inmutables.';
  end if;
  return new;
end $$;
revoke all on function public._pide_tracking_tokens_guard()
  from public,anon,authenticated,service_role;
create trigger order_tracking_tokens_guard
before update on public.order_tracking_tokens
for each row execute function public._pide_tracking_tokens_guard();

-- ============================================================================
-- §1.8 · pide_demand_events — la zona JAMÁS es texto crudo del usuario.
-- ============================================================================
create table public.pide_demand_events(
  id uuid primary key default gen_random_uuid(),
  zona text not null,
  franja text not null,
  fecha date not null,
  error text not null check (error in ('FUERA_DE_COBERTURA','SIN_CAPACIDAD_FRANJA')),
  cantidad integer not null check (cantidad between 1 and 24),
  creado_at timestamptz not null default clock_timestamp()
);
create index pide_demand_events_fecha_idx on public.pide_demand_events(fecha,zona);

-- Normalización contra catálogo: lo que no es canónico se registra como
-- 'OTRA_ZONA'/'OTRA_FRANJA' (el texto libre podría ser una dirección o un
-- teléfono — jamás se persiste).
create function public._pide_demand_normalizar()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if new.zona is null or not exists(select 1 from public.zonas z where z.nombre=new.zona) then
    new.zona:='OTRA_ZONA';
  end if;
  if new.franja is null or not exists(select 1 from public.franjas f where f.nombre=new.franja) then
    new.franja:='OTRA_FRANJA';
  end if;
  return new;
end $$;
revoke all on function public._pide_demand_normalizar()
  from public,anon,authenticated,service_role;
create trigger pide_demand_events_normalizar
before insert or update on public.pide_demand_events
for each row execute function public._pide_demand_normalizar();

-- Snapshot sellado con dueño (patrón H88): el MCP y cualquier agente leen SOLO
-- el snapshot; el cómputo en vivo permitiría ataque por diferencia de consultas.
create table public.pide_demand_snapshots(
  id uuid primary key default gen_random_uuid(),
  periodo_inicio date not null,
  periodo_fin date not null check (periodo_fin>=periodo_inicio),
  k_minimo integer not null default 3 check (k_minimo>=3),
  celdas jsonb not null check (jsonb_typeof(celdas)='array'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  generado_at timestamptz not null default clock_timestamp()
);
create index pide_demand_snapshots_recientes_idx
  on public.pide_demand_snapshots(generado_at desc);

-- Materializador con dueño: SOLO el job privado. Celdas por (zona,error) con
-- k>=3; lo que no alcanza k se re-agrega a 'OTRA_ZONA' y, si sigue por debajo,
-- se descarta. Jamás expone qr/referido/utm como dimensión.
create function public.sellar_pide_demand_snapshot_v1(p_dias integer default 28)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_k constant integer:=3;
  v_inicio_ts timestamptz;
  v_fin_ts timestamptz;
  v_celdas jsonb;
  v_id uuid;
  v_fp text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el job privado puede sellar el snapshot de demanda.';
  end if;
  if p_dias is null or p_dias<1 or p_dias>90 then
    raise exception 'La ventana del snapshot debe estar entre 1 y 90 días.';
  end if;
  -- Criterio de ventana: el snapshot captura cuándo OCURRIÓ la demanda
  -- (creado_at ∈ [fin-p_dias, fin]), NO `fecha` — `fecha` es la fecha de
  -- ENTREGA solicitada, usualmente futura y sin tope superior, y filtrar por
  -- ella dejaba la ventana abierta hacia adelante mientras se sellaba
  -- periodo_fin=current_date. periodo_inicio/fin sellan la ventana de CAPTURA;
  -- `fecha` queda como dato agregable fuera de las dimensiones del snapshot.
  -- Se usa clock_timestamp() y no now(): creado_at también nace de
  -- clock_timestamp(), y con now() (inicio de transacción) los eventos de la
  -- misma transacción quedarían fuera de la ventana.
  v_fin_ts:=clock_timestamp();
  v_inicio_ts:=v_fin_ts-make_interval(days=>p_dias);
  with base as (
    select zona,error,count(*)::integer as eventos,sum(cantidad)::integer as cantidad
    from public.pide_demand_events
    where creado_at>=v_inicio_ts and creado_at<=v_fin_ts
    group by zona,error
  ), reagrupado as (
    select case when eventos>=v_k then zona else 'OTRA_ZONA' end as zona,
      error,sum(eventos)::integer as eventos,sum(cantidad)::integer as cantidad
    from base group by 1,2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'zona',zona,'error',error,'eventos',eventos,'cantidad',cantidad)
      order by zona,error),'[]'::jsonb)
    into v_celdas
    from reagrupado where eventos>=v_k;
  v_fp:=public._momos_h92_hash(jsonb_build_object(
    'inicio',v_inicio_ts,'fin',v_fin_ts,'k',v_k,'celdas',v_celdas));
  insert into public.pide_demand_snapshots(
    periodo_inicio,periodo_fin,k_minimo,celdas,fingerprint
  ) values (v_inicio_ts::date,v_fin_ts::date,v_k,v_celdas,v_fp)
  returning id into v_id;
  return jsonb_build_object('ok',true,'snapshotId',v_id,
    'celdas',jsonb_array_length(v_celdas),'kMinimo',v_k,
    'contract','momos.pide.demand-snapshot.v1',
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

create function public.pide_demand_snapshot_v1()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_row public.pide_demand_snapshots%rowtype;
begin
  if public.is_staff() is not true then
    raise exception 'Sesión MOMOS no autorizada.' using errcode='42501';
  end if;
  select * into v_row from public.pide_demand_snapshots
    order by generado_at desc limit 1;
  if v_row.id is null then
    return jsonb_build_object('ok',false,'contract','momos.pide.demand-snapshot.v1',
      'celdas','[]'::jsonb,'sellado',false,
      'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false));
  end if;
  return jsonb_build_object('ok',true,'contract','momos.pide.demand-snapshot.v1',
    'snapshotId',v_row.id,'generadoAt',v_row.generado_at,
    'periodoInicio',v_row.periodo_inicio,'periodoFin',v_row.periodo_fin,
    'kMinimo',v_row.k_minimo,'celdas',v_row.celdas,'fingerprint',v_row.fingerprint,
    'sellado',true,
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false));
end $$;

-- ============================================================================
-- §1.10 · Beneficio reservado por hold (rama NUEVA, ningún RPC vivo la procesa).
-- ============================================================================
alter table public.benefits add column hold_quote_id uuid references public.quotes(id);
alter table public.benefits add constraint benefits_hold_quote_consistencia
  check (hold_quote_id is null or (estado='Reservado' and pedido_uso is null));
create unique index benefits_hold_quote_uidx
  on public.benefits(hold_quote_id) where hold_quote_id is not null;

-- ============================================================================
-- §1.5 · Liberación perezosa de holds vencidos (helper con dueño).
-- El cableado dentro de _reserve_inventory y de las RPC públicas llega en P03;
-- este hito NO modifica _reserve_inventory (cruzaría el carril OPS).
-- ============================================================================
-- Orden GLOBAL determinista de locks (anti-deadlock, no orden local por hold):
--   (1) recolectar TODOS los holds vencidos FOR UPDATE SKIP LOCKED (por id;
--       SKIP LOCKED preserva liveness entre liberadores y el lock da el
--       exactly-once — nadie más puede resolver un hold que tenemos tomado);
--   (2) bloquear TODAS las filas afectadas en orden canónico global:
--       products por product_id y después lote_figuras por (batch_id,figura);
--   (3) conciliar CADA hold contra los lotes YA bloqueados (ver hold veneno);
--   (4) UN solo pase de update sobre products;
--   (5) UN solo pase sobre lote_figuras.
--
-- Hold veneno: la conciliación de cada hold corre aislada en su propio scope
-- begin/exception y valida ACUMULANDO la devolución tentativa por lote antes
-- del pase global: el hold que no cuadra (producto ausente, lote inexistente o
-- consumidas insuficientes para su devolución acumulada) se salta con WARNING,
-- queda Temporal vencido para reintentar el próximo ciclo y se cuenta en el
-- campo `irreconciliables` del retorno. Los pases globales corren SOLO con los
-- holds válidos: el veneno JAMÁS aborta la liberación ni la purga de PII que
-- la invoca. Validar-primero bajo locks hace imposible que un hold válido
-- falle después en el pase global (los lotes no pueden moverse entre medio).
create function public._pide_liberar_holds_vencidos(p_product_id text default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
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
  -- (1) todos los holds vencidos, bloqueados, en orden determinista.
  select coalesce(array_agg(s.id),array[]::uuid[]) into v_holds
  from (
    select h.id from public.checkout_holds h
    where h.estado='Temporal' and h.expira_at<clock_timestamp()
      and (p_product_id is null or exists(
        select 1 from public.checkout_hold_lotes l
        where l.hold_id=h.id and l.product_id=p_product_id))
    order by h.id
    for update skip locked
  ) s;
  if coalesce(array_length(v_holds,1),0)=0 then
    return jsonb_build_object('liberados',0,'irreconciliables',0);
  end if;

  -- (2) locks globales deterministas: products → lote_figuras. Con los locks
  -- ya tomados en este orden, los pases de update no pueden interbloquearse.
  perform 1 from public.products p
    where p.id in (select l.product_id from public.checkout_hold_lotes l
      where l.hold_id=any(v_holds))
    order by p.id
    for update;
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
        raise warning 'Hold % irreconciliable contra products/lote_figuras: queda Temporal vencido y se reintenta el próximo ciclo.',v_hold;
      end if;
    exception when others then
      v_irreconciliables:=v_irreconciliables+1;
      raise warning 'Hold % irreconciliable (%): queda Temporal vencido y se reintenta el próximo ciclo.',v_hold,sqlerrm;
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

  -- beneficios reservados por los holds liberados → vuelven a Activo (§1.10)
  update public.benefits b
    set estado='Activo',hold_quote_id=null
    where b.estado='Reservado' and b.pedido_uso is null
      and b.hold_quote_id in (
        select h.quote_id from public.checkout_holds h where h.id=any(v_validos));

  -- exactly-once: las filas siguen bloqueadas por esta transacción.
  update public.checkout_holds
    set estado='Expirada',resuelto_at=clock_timestamp()
    where id=any(v_validos) and estado='Temporal';

  return jsonb_build_object(
    'liberados',coalesce(array_length(v_validos,1),0),
    'irreconciliables',v_irreconciliables);
end $$;

-- ============================================================================
-- §1.2/§1.3 · Purga en dos fases (funciones con dueño; el job se programa
-- después y su health-check es precondición para habilitar el canal).
-- ============================================================================
-- Fase "con payment/pedido": ANONIMIZAR, jamás borrar (FK de payments es
-- RESTRICT). Conserva id/estado/total; borra el crudo de checkout_sessions.
-- La atribución NO se toca acá: se copia a order_attributions en P04 y es
-- PII-free por whitelist.
create function public._pide_anonimizar_checkout(p_quote_id uuid)
returns void
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  delete from public.checkout_sessions where quote_id=p_quote_id;
  -- Re-saneo defensivo de la atribución ANTES de que la fila quede permanente:
  -- si la whitelist vigente se endureció después del insert, cada entrada que
  -- ya no pasa se anula (y el objeto entero si no sobrevive ninguna). Sin esto
  -- una atribución vieja fuera de whitelist quedaría permanente — y el CHECK
  -- de quotes.atribucion, re-evaluado en este UPDATE, bloquearía la purga de
  -- PII con un check_violation.
  update public.quotes q
    set telefono_hmac=null,
        lineas=null,
        atribucion=case
          when q.atribucion is null then null
          when jsonb_typeof(q.atribucion)<>'object' then null
          when public._pide_atribucion_valida(q.atribucion) then q.atribucion
          else (
            select nullif(coalesce(
              jsonb_object_agg(e.key,e.value) filter (where
                public._pide_atribucion_valida(jsonb_build_object(e.key,e.value))),
              '{}'::jsonb),'{}'::jsonb)
            from jsonb_each(q.atribucion) e(key,value))
        end
    where q.id=p_quote_id;
  if not found then
    raise exception 'La quote % no existe.',p_quote_id;
  end if;
end $$;

-- Fase "sin payment ni pedido": DELETE 24-72 h. Libera antes los holds
-- vencidos (devuelve stock/lotes/beneficio) y jamás toca quotes Usadas,
-- con pago o con hold vivo/confirmado.
create function public.purgar_checkout_efimero_v1(p_horas integer default null)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_horas integer; v_ids uuid[]; v_lib jsonb; v_purgadas integer:=0; v_sesiones integer:=0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el job privado puede purgar el checkout efímero.';
  end if;
  v_horas:=coalesce(p_horas,
    (select (valor #>> '{}')::integer from public.app_settings
      where clave='pide_purga_checkout_horas'),48);
  -- La spec §1.2 fija el DELETE sin payment/pedido en 24-72 h: fuera de ese
  -- rango la purga falla cerrada (el seed vigente es 48 h).
  if v_horas<24 or v_horas>72 then
    raise exception 'La ventana de purga debe estar entre 24 y 72 horas.';
  end if;
  v_lib:=public._pide_liberar_holds_vencidos();
  -- La retención acotada de PII NO depende de la conciliación de inventario:
  -- las sesiones de TODA quote vieja sin pago caen al vencer la ventana,
  -- incluidas las excluidas de la purga por un hold Temporal vencido
  -- irreconciliable (hold veneno). Borrar la sesión es seguro (nada la
  -- referencia); la quote y el hold quedan para la conciliación posterior.
  delete from public.checkout_sessions s
    using public.quotes q
    where s.quote_id=q.id
      and q.created_at<clock_timestamp()-make_interval(hours=>v_horas)
      and q.estado<>'Usada'
      and not exists(select 1 from public.payments p where p.quote_id=q.id);
  get diagnostics v_sesiones=row_count;
  -- Ventana select→delete cerrada: las candidatas quedan BLOQUEADAS
  -- (FOR UPDATE SKIP LOCKED — el lock de la quote además frena FKs nuevos:
  -- insertar payments/checkout_holds toma KEY SHARE sobre la quote) y cada
  -- DELETE re-verifica sus guards. Una fila que dejó de cumplir se salta,
  -- jamás aborta el lote completo.
  select array_agg(s.id) into v_ids from (
    select q.id from public.quotes q
    where q.created_at<clock_timestamp()-make_interval(hours=>v_horas)
      and q.estado<>'Usada'
      and not exists(select 1 from public.payments p where p.quote_id=q.id)
      and not exists(select 1 from public.checkout_holds h
        where h.quote_id=q.id and h.estado in ('Temporal','Confirmada'))
    order by q.id
    for update skip locked
  ) s;
  if v_ids is null then
    return jsonb_build_object('ok',true,'quotesPurgadas',0,
      'sesionesPurgadas',v_sesiones,
      'holdsLiberados',coalesce((v_lib->>'liberados')::integer,0),
      'holdsIrreconciliables',coalesce((v_lib->>'irreconciliables')::integer,0),
      'containsCustomerPii',false,'containsSecrets',false);
  end if;
  -- Guard re-verificado: solo se purgan holds en estado terminal 'Expirada'.
  delete from public.checkout_hold_lotes l
    using public.checkout_holds h
    where l.hold_id=h.id and h.quote_id=any(v_ids)
      and h.estado='Expirada';
  delete from public.checkout_holds h
    where h.quote_id=any(v_ids) and h.estado='Expirada';
  update public.benefits set estado='Activo',hold_quote_id=null
    where hold_quote_id=any(v_ids) and estado='Reservado' and pedido_uso is null;
  -- Guards re-verificados DENTRO del DELETE: sin pago, sin hold vivo, no Usada.
  delete from public.quotes q
    where q.id=any(v_ids)
      and q.estado<>'Usada'
      and not exists(select 1 from public.payments p where p.quote_id=q.id)
      and not exists(select 1 from public.checkout_holds h
        where h.quote_id=q.id and h.estado in ('Temporal','Confirmada'));
  get diagnostics v_purgadas=row_count;
  return jsonb_build_object('ok',true,'quotesPurgadas',v_purgadas,
    'sesionesPurgadas',v_sesiones,
    'holdsLiberados',coalesce((v_lib->>'liberados')::integer,0),
    'holdsIrreconciliables',coalesce((v_lib->>'irreconciliables')::integer,0),
    'containsCustomerPii',false,'containsSecrets',false);
end $$;

-- ============================================================================
-- §1.9 · Perímetro: RLS deny-all + revoke explícito en TODAS las tablas nuevas
-- (acceso futuro SOLO vía RPC definer/snapshot, P02-P05) y reemplazo del guard
-- H89 con la lista ampliada.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'quotes','checkout_sessions','checkout_holds','checkout_hold_lotes',
    'payments','payment_events','pide_demand_events','pide_demand_snapshots',
    'order_tracking_tokens','order_attributions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- Reemplazo del guard H89: cuerpo idéntico + las seis tablas Pide en la lista
-- cerrada de políticas prohibidas.
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
          'payment_events','pide_demand_events'
        ]::text[])
        and (p.policyname='staff_read'
          or p.policyname='packing_verifications_staff_read'
          or p.policyname='claude_read')
    )
$$;
revoke all on function public.cierre_lecturas_pii_disponible()
  from public,anon,service_role;
grant execute on function public.cierre_lecturas_pii_disponible() to authenticated;

-- RBAC de las funciones nuevas: todo cerrado por defecto; el job privado solo
-- ejecuta purga y sellado; el personal autenticado solo lee el snapshot sellado.
revoke all on function public.sellar_pide_demand_snapshot_v1(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.pide_demand_snapshot_v1()
  from public,anon,authenticated,service_role;
revoke all on function public._pide_liberar_holds_vencidos(text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_anonimizar_checkout(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.purgar_checkout_efimero_v1(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.sellar_pide_demand_snapshot_v1(integer) to service_role;
grant execute on function public.purgar_checkout_efimero_v1(integer) to service_role;
grant execute on function public.pide_demand_snapshot_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_p01_pide_fundaciones',
  'Fundaciones Pide: canal, quotes, checkout, holds con extension exactly-once, pagos con terminales selladas, atribucion PII-free de pedidos, tracking, demanda k>=3, guard H89 ampliado y purga en dos fases 24-72h')
on conflict(id) do nothing;

commit;
