-- MOMOS · Carril Pide · P02 pide-cotizacion-v1
--
-- Cotización autoritativa y catálogo público del shop
-- (docs/PIDE-COTIZAR-PEDIDO-V1.md v2 completa; superficie §2 alcance P02).
--
-- El navegador arma la intención; el servidor decide TODO: precio (precio_pide),
-- cobertura (zonas), capacidad (franjas.cupo − pedidos activos), mínimo,
-- beneficio (solo posesión probada) y disponibilidad GRUESA. La quote queda
-- inmutable con precio congelado y vencimiento; re-cotizar crea otra.
--
-- Decisiones RATIFICADAS por Jorge (2026-07-22):
--   * precio por canal = columna products.precio_pide (NULL = producto NO
--     habilitado en Pide) — espejo del precedente precio_rappi;
--   * mínimo de pedido = app_settings.pedido_minimo global, con override
--     opcional pide_pedido_minimo.
--
-- Cotizar NO muta estado comercial (§3.3): únicas escrituras = la quote,
-- eventos de demanda insatisfecha PII-free y contadores de rate limit.
-- Holds/reservas llegan en P03; pedido/pagos en P04.
--
-- Adiciones: HOY no existe verdad canónica de precio de adiciones (el flujo
-- staff recibe el precio desde la UI; no hay catálogo). Repreciar server-side
-- es imposible sin inventar una fuente de verdad, así que el canal público
-- las RECHAZA (ENTRADA_INVALIDA) hasta que exista un catálogo de adiciones
-- con precio por canal (pendiente de negocio, ver README).
--
-- Remediación incluida (hallazgo pre-abierto, verificado 2026-07-22 en
-- staging): shop_mis_pedidos/shop_mis_items tenían grants completos
-- (SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER) para anon y
-- authenticated — drift vivo que ningún SQL del repo creó (el repo solo
-- concede SELECT a authenticated: schema-v5.sql:839). Acá se revoca todo y
-- se restituye el contrato del repo.
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
declare t text;
begin
  -- Ancla del carril: P01 aplicado; P02 no re-aplicable.
  if not exists(select 1 from public.momos_ops_migrations
    where id='20260721_p01_pide_fundaciones') then
    raise exception 'P02 requiere 20260721_p01_pide_fundaciones aplicado en la base.';
  end if;
  if exists(select 1 from public.momos_ops_migrations
    where id='20260722_p02_pide_cotizacion') then
    raise exception 'P02 ya está aplicado; este hito no se reaplica.';
  end if;

  -- Objetos P01 de los que depende la cotización.
  foreach t in array array['quotes','pide_demand_events','pide_demand_snapshots'] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Falta la tabla P01 %.',t;
    end if;
  end loop;
  if to_regprocedure('public._pide_atribucion_valida(jsonb)') is null
     or to_regprocedure('public._pide_demand_normalizar()') is null then
    raise exception 'Faltan funciones P01 (_pide_atribucion_valida / _pide_demand_normalizar).';
  end if;

  -- Verdad base del dominio.
  foreach t in array array[
    'products','figuras','combo_components','catalog_values','zonas','franjas',
    'orders','benefits','app_settings','shop_mis_pedidos','shop_mis_items'
  ] loop
    if to_regclass('public.'||t) is null then
      raise exception 'Falta la relación base %.',t;
    end if;
  end loop;
  if to_regclass('public.shop_catalogo') is null then
    raise exception 'Falta la vista shop_catalogo (proyección de productos activos).';
  end if;
  if to_regprocedure('public.current_customer_id()') is null
     or to_regprocedure('public.is_staff()') is null then
    raise exception 'Faltan funciones de sesión (current_customer_id / is_staff).';
  end if;

  -- Formas verificadas (2026-07-22, staging clon de producción).
  if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='orders' and column_name='franja')
     or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='orders' and column_name='zona') then
    raise exception 'orders perdió zona/franja: la capacidad por franja+fecha no puede contarse.';
  end if;
  if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='franjas' and column_name='cupo') then
    raise exception 'franjas.cupo ausente (gancho de capacidad).';
  end if;
  if not exists(select 1 from public.catalog_values where categoria='salsa')
     or not exists(select 1 from public.catalog_values where categoria like 'sabor_%') then
    raise exception 'catalog_values sin categorías de sabor/salsa: el endurecimiento §5.4 no puede anclarse.';
  end if;
  if not exists(select 1 from public.app_settings where clave='pedido_minimo') then
    raise exception 'Falta app_settings.pedido_minimo (mínimo global del negocio).';
  end if;

  -- Los objetos P02 NO deben existir.
  if exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='precio_pide') then
    raise exception 'products.precio_pide ya existe: base fuera del estado esperado.';
  end if;
  if to_regclass('public.pide_rate_counters') is not null
     or to_regprocedure('public.cotizar_pedido_v1(jsonb)') is not null
     or to_regprocedure('public.catalogo_publico_v1()') is not null then
    raise exception 'Objetos P02 ya presentes: base fuera del estado esperado.';
  end if;
end $$;

-- ============================================================================
-- Habilitación y precio por canal (decisión ratificada: columna, NULL=apagado).
-- ============================================================================
alter table public.products add column precio_pide numeric
  check (precio_pide is null or precio_pide>0);

-- Seeds técnicos (valores de arranque NO aprobados como negocio — ver README).
insert into public.app_settings(clave,valor) values
  ('pide_quote_ttl_minutos',to_jsonb(15)),
  ('pide_max_items_quote',to_jsonb(6)),
  ('pide_max_cant_item',to_jsonb(12)),
  ('pide_stock_colchon',to_jsonb(2)),
  ('pide_rate_ventana_minutos',to_jsonb(10)),
  ('pide_rate_limit_ip',to_jsonb(30)),
  ('pide_rate_limit_telefono',to_jsonb(10)),
  ('pide_rate_limit_global',to_jsonb(300))
on conflict (clave) do nothing;

-- ============================================================================
-- Remediación del hallazgo de grants (drift vivo, ver cabecera).
-- ============================================================================
revoke all on table public.shop_mis_pedidos from anon;
revoke all on table public.shop_mis_items from anon;
revoke all on table public.shop_mis_pedidos from authenticated;
revoke all on table public.shop_mis_items from authenticated;
grant select on table public.shop_mis_pedidos to authenticated;
grant select on table public.shop_mis_items to authenticated;

-- ============================================================================
-- Rate limiting (defensa de COSTO/DoS, documentada como tal — la
-- anti-enumeración es por diseño, §8). Contadores por clave con ventana corta.
-- La clave de teléfono usa sha256 SIN pepper (cualquiera puede forjarla): por
-- eso el límite por teléfono JAMÁS bloquea solo — solo suma señal junto al
-- límite por IP; el techo duro anti-DoS es ip+global. TTL corto y limpieza
-- oportunista acotan la tabla. Deny-all: nadie la lee directo.
-- ============================================================================
create table public.pide_rate_counters(
  clave text primary key,
  ventana_inicio timestamptz not null,
  golpes integer not null check (golpes>0)
);

create function public._pide_rate_golpe(p_clave text, p_ventana interval)
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_golpes integer;
begin
  -- limpieza oportunista acotada: claves muertas de ventanas viejas
  delete from public.pide_rate_counters
    where ventana_inicio<clock_timestamp()-(p_ventana*4);
  insert into public.pide_rate_counters as c(clave,ventana_inicio,golpes)
  values (p_clave,clock_timestamp(),1)
  on conflict (clave) do update set
    golpes=case when c.ventana_inicio<clock_timestamp()-p_ventana
                then 1 else c.golpes+1 end,
    ventana_inicio=case when c.ventana_inicio<clock_timestamp()-p_ventana
                then clock_timestamp() else c.ventana_inicio end
  returning golpes into v_golpes;
  return v_golpes;
end $$;

create function public._pide_setting_int(p_clave text, p_default integer)
returns integer
language sql stable
set search_path=pg_catalog,public,pg_temp
as $$
  select coalesce((select (valor #>> '{}')::integer
    from public.app_settings where clave=p_clave),p_default)
$$;

-- ============================================================================
-- Disponibilidad GRUESA (§3.6/§8): jamás el número exacto; el colchón corre el
-- punto de quiebre para impedir búsqueda binaria del stock real.
--   tipo momo  → por products.stock con colchón;
--   tipo combo → el peor componente (cajas se resuelven por figuras/productos);
--   tipo pedido→ 'disponible' (se prepara al momento; la franja acota).
-- ============================================================================
create function public._pide_disponibilidad(p_product_id text)
returns text
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_tipo text; v_stock numeric; v_colchon integer;
  v_peor text:='disponible'; v_sig text; v_comp record;
begin
  select tipo,stock into v_tipo,v_stock from public.products where id=p_product_id;
  v_colchon:=public._pide_setting_int('pide_stock_colchon',2);
  if v_tipo='momo' then
    if coalesce(v_stock,0)<=0 then return 'agotado'; end if;
    if v_stock<=v_colchon+1 then return 'pocas_unidades'; end if;
    return 'disponible';
  elsif v_tipo='combo' then
    for v_comp in
      select cc.component_id from public.combo_components cc
      where cc.combo_id=p_product_id
    loop
      v_sig:=public._pide_disponibilidad(v_comp.component_id);
      if v_sig='agotado' then return 'agotado'; end if;
      if v_sig='pocas_unidades' then v_peor:='pocas_unidades'; end if;
    end loop;
    return v_peor;
  end if;
  return 'disponible';
end $$;

-- ============================================================================
-- Catálogo público (extiende shop_catalogo sin tocarla): SOLO productos
-- activos con precio_pide; precio del canal, disponibilidad gruesa y las
-- opciones canónicas del configurador. Sin costos, sin márgenes, sin precio
-- staff, sin números de stock.
-- ============================================================================
create function public.catalogo_publico_v1()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_productos jsonb; v_zonas jsonb; v_franjas jsonb;
        v_sabores jsonb; v_salsas jsonb; v_figuras jsonb; v_minimo integer;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',p.id,'nombre',p.nombre,'categoria',p.cat,
      'descr',coalesce(p.descr,''),'foto_path',coalesce(p.foto_path,''),
      'alergenos',coalesce(p.alergenos,''),'combo_size',p.combo_size,
      'precio',p.precio_pide,
      'disponibilidad',public._pide_disponibilidad(p.id))
      order by p.cat,p.nombre),'[]'::jsonb)
    into v_productos
    from public.products p
    where p.activo and p.precio_pide is not null;
  select coalesce(jsonb_agg(jsonb_build_object(
      'figura',f.nombre,'especie',f.especie,'product_id',f.product_id)
      order by f.orden,f.nombre),'[]'::jsonb)
    into v_figuras from public.figuras f where f.activo;
  select coalesce(jsonb_agg(cv.valor order by cv.orden,cv.valor),'[]'::jsonb)
    into v_sabores from public.catalog_values cv
    where cv.activo and cv.categoria like 'sabor_%';
  select coalesce(jsonb_agg(cv.valor order by cv.orden,cv.valor),'[]'::jsonb)
    into v_salsas from public.catalog_values cv
    where cv.activo and cv.categoria='salsa';
  select coalesce(jsonb_agg(jsonb_build_object('zona',z.nombre,'tarifa',z.tarifa)
      order by z.nombre),'[]'::jsonb)
    into v_zonas from public.zonas z;
  select coalesce(jsonb_agg(jsonb_build_object(
      'franja',f.nombre,'inicio',f.hora_inicio,'fin',f.hora_fin)
      order by f.hora_inicio),'[]'::jsonb)
    into v_franjas from public.franjas f where coalesce(f.activo,true);
  v_minimo:=public._pide_setting_int('pide_pedido_minimo',
    public._pide_setting_int('pedido_minimo',25000));
  return jsonb_build_object(
    'contract','momos.pide.catalogo.v1',
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'moneda','COP','pedido_minimo',v_minimo,
    'productos',v_productos,'figuras',v_figuras,
    'sabores',v_sabores,'salsas',v_salsas,
    'zonas',v_zonas,'franjas',v_franjas);
end $$;

-- ============================================================================
-- cotizar_pedido_v1 — la cotización autoritativa. Errores tipificados EXACTOS
-- (§6); jamás internals; para anon la respuesta es INDISTINGUIBLE exista o no
-- beneficio (§3.9). Escrituras permitidas: quote + demanda + rate.
-- ============================================================================
create function public._pide_error(p_error text, p_mensaje text)
returns jsonb
language sql immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select jsonb_build_object(
    'contract','momos.pide.quote.v1',
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',false,'error',p_error,'mensaje',p_mensaje,'advertencias','[]'::jsonb)
$$;

create function public.cotizar_pedido_v1(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_ventana interval;
  v_headers jsonb;
  v_ip_hash text; v_tel_crudo text; v_tel_hash text;
  v_item jsonb; v_box jsonb; v_slot jsonb;
  v_prod public.products%rowtype;
  v_max_items integer; v_max_cant integer;
  v_cantidad integer; v_unidades integer:=0;
  v_subtotal numeric:=0; v_lineas jsonb:='[]'::jsonb;
  v_detalle jsonb;
  v_zona_in text; v_franja_in text; v_fecha date;
  v_tarifa numeric; v_cupo integer; v_activos integer;
  v_minimo numeric; v_customer text;
  v_benefit public.benefits%rowtype; v_desc numeric:=0;
  v_total numeric; v_quote_id uuid; v_vence timestamptz;
  v_advertencias jsonb:='[]'::jsonb;
  v_disp text;
  v_figura text; v_sabor text; v_salsa text;
begin
  -- ---- Rate limit (defensa de costo; §8) — ANTES de tocar catálogo. -------
  v_ventana:=make_interval(mins=>public._pide_setting_int('pide_rate_ventana_minutos',10));
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers:='{}'::jsonb; end;
  v_ip_hash:=encode(sha256(coalesce(v_headers->>'x-forwarded-for','sin-ip')::bytea),'hex');
  if public._pide_rate_golpe('g',v_ventana)
       > public._pide_setting_int('pide_rate_limit_global',300)
     or public._pide_rate_golpe('ip:'||v_ip_hash,v_ventana)
       > public._pide_setting_int('pide_rate_limit_ip',30) then
    return public._pide_error('QUOTE_RATE_LIMIT','Demasiadas cotizaciones; probá en unos minutos.');
  end if;
  -- El contador por teléfono es señal (hash forjable sin pepper): SOLO aplica
  -- si la IP ya está en la mitad de su presupuesto — así un tercero no puede
  -- agotar el límite de TU teléfono desde otra IP (anti-envenenamiento).
  v_tel_crudo:=nullif(regexp_replace(coalesce(p->>'telefono',''),'\D','','g'),'');
  if v_tel_crudo is not null then
    v_tel_hash:=encode(sha256(v_tel_crudo::bytea),'hex');
    if public._pide_rate_golpe('tel:'||v_tel_hash,v_ventana)
         > public._pide_setting_int('pide_rate_limit_telefono',10)
       and coalesce((select golpes from public.pide_rate_counters
           where clave='ip:'||v_ip_hash),0)
         > public._pide_setting_int('pide_rate_limit_ip',30)/2 then
      return public._pide_error('QUOTE_RATE_LIMIT','Demasiadas cotizaciones; probá en unos minutos.');
    end if;
  end if;

  -- ---- Límites duros de entrada (§4) — antes de tocar catálogo. -----------
  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>16384 then
    return public._pide_error('ENTRADA_INVALIDA','La solicitud no tiene la forma esperada.');
  end if;
  if coalesce(p->>'canal','')<>'pide' then
    return public._pide_error('ENTRADA_INVALIDA','Canal no reconocido.');
  end if;
  if jsonb_typeof(p->'items')<>'array'
     or jsonb_array_length(p->'items')<1 then
    return public._pide_error('ENTRADA_INVALIDA','La cotización necesita al menos un producto.');
  end if;
  v_max_items:=public._pide_setting_int('pide_max_items_quote',6);
  v_max_cant:=public._pide_setting_int('pide_max_cant_item',12);
  if jsonb_array_length(p->'items')>v_max_items then
    return public._pide_error('ENTRADA_INVALIDA','Demasiados productos en una sola cotización.');
  end if;
  if p->'atribucion' is not null and jsonb_typeof(p->'atribucion')<>'null'
     and not public._pide_atribucion_valida(p->'atribucion') then
    return public._pide_error('ENTRADA_INVALIDA','La atribución no es válida.');
  end if;
  v_zona_in:=btrim(coalesce(p->>'zona',''));
  v_franja_in:=btrim(coalesce(p->>'franja',''));
  begin
    v_fecha:=(p->>'fecha_entrega')::date;
  exception when others then
    return public._pide_error('ENTRADA_INVALIDA','La fecha de entrega no es válida.');
  end;
  if v_zona_in='' or v_franja_in='' or v_fecha is null
     or v_fecha<current_date or v_fecha>current_date+30 then
    return public._pide_error('ENTRADA_INVALIDA','Zona, franja o fecha de entrega inválidas.');
  end if;

  -- ---- Validación por item (§5 pasos 1-4 y 9) — el orden importa. ---------
  for v_item in select * from jsonb_array_elements(p->'items') loop
    -- La entrada JAMÁS trae precios (§3.7).
    if v_item ? 'precio' or v_item ? 'precio_unit' or v_item ? 'total' then
      return public._pide_error('ENTRADA_INVALIDA','La solicitud no puede incluir precios.');
    end if;
    -- Adiciones: sin verdad canónica de precio no se venden en este canal.
    if v_item->'adiciones' is not null and jsonb_typeof(v_item->'adiciones')='array'
       and jsonb_array_length(v_item->'adiciones')>0 then
      return public._pide_error('ENTRADA_INVALIDA','Las adiciones aún no están disponibles en Pide.');
    end if;
    begin
      v_cantidad:=(v_item->>'cantidad')::integer;
    exception when others then
      return public._pide_error('ENTRADA_INVALIDA','Cantidad inválida.');
    end;
    if v_cantidad is null or v_cantidad<1 or v_cantidad>v_max_cant then
      return public._pide_error('ENTRADA_INVALIDA','Cantidad fuera de rango.');
    end if;

    select * into v_prod from public.products
      where id=coalesce(v_item->>'product_id','') and activo;
    if v_prod.id is null or v_prod.precio_pide is null then
      return public._pide_error('PRODUCTO_NO_DISPONIBLE','Un producto de la cotización no está disponible.');
    end if;
    v_disp:=public._pide_disponibilidad(v_prod.id);
    if v_disp='agotado' then
      return public._pide_error('PRODUCTO_NO_DISPONIBLE','Un producto de la cotización está agotado.');
    end if;
    if v_disp='pocas_unidades' then
      v_advertencias:=v_advertencias||jsonb_build_object(
        'tipo','pocas_unidades','product_id',v_prod.id);
    end if;

    -- Config del producto: replica la estructura REAL de crear_pedido
    -- (rpc-pedidos-v1.sql:594-647 combos con boxes/slots y salsa obligatoria;
    -- :690-693 línea simple con figura/sabor/salsa del item).
    if coalesce(v_prod.combo_size,0)>=1 then
      if jsonb_typeof(v_item->'boxes')<>'array'
         or jsonb_array_length(v_item->'boxes')<>v_cantidad then
        return public._pide_error('ENTRADA_INVALIDA','Cada combo necesita sus cajas completas.');
      end if;
      for v_box in select * from jsonb_array_elements(v_item->'boxes') loop
        if jsonb_typeof(v_box)<>'array'
           or jsonb_array_length(v_box)<>v_prod.combo_size then
          return public._pide_error('ENTRADA_INVALIDA','Cada caja lleva exactamente sus slots.');
        end if;
        for v_slot in select * from jsonb_array_elements(v_box) loop
          v_figura:=btrim(coalesce(v_slot->>'figura',''));
          v_sabor:=btrim(coalesce(v_slot->>'sabor',''));
          v_salsa:=btrim(coalesce(v_slot->>'salsa',''));
          if v_figura='' or v_sabor='' or v_salsa='' then
            return public._pide_error('ENTRADA_INVALIDA','Cada slot necesita figura, sabor y salsa.');
          end if;
          if not exists(select 1 from public.figuras f
              join public.combo_components cc
                on cc.combo_id=v_prod.id and cc.component_id=f.product_id
              where f.activo and f.nombre=v_figura) then
            return public._pide_error('ENTRADA_INVALIDA','Una figura no pertenece a este combo.');
          end if;
          if not exists(select 1 from public.catalog_values cv
              where cv.activo and cv.categoria like 'sabor_%' and cv.valor=v_sabor) then
            return public._pide_error('ENTRADA_INVALIDA','Un sabor no está en el catálogo vigente.');
          end if;
          if not exists(select 1 from public.catalog_values cv
              where cv.activo and cv.categoria='salsa' and cv.valor=v_salsa) then
            return public._pide_error('ENTRADA_INVALIDA','Una salsa no está en el catálogo vigente.');
          end if;
        end loop;
      end loop;
      v_detalle:=jsonb_build_object('boxes',v_item->'boxes');
    elsif v_prod.tipo='momo' then
      v_figura:=btrim(coalesce(v_item->>'figura',''));
      v_sabor:=btrim(coalesce(v_item->>'sabor',''));
      v_salsa:=btrim(coalesce(v_item->>'salsa',''));
      if v_figura='' or v_sabor='' or v_salsa='' then
        return public._pide_error('ENTRADA_INVALIDA','Una figura necesita figura, sabor y salsa.');
      end if;
      if not exists(select 1 from public.figuras f
          where f.activo and f.nombre=v_figura and f.product_id=v_prod.id) then
        return public._pide_error('ENTRADA_INVALIDA','La figura no corresponde al producto.');
      end if;
      if not exists(select 1 from public.catalog_values cv
          where cv.activo and cv.categoria like 'sabor_%' and cv.valor=v_sabor) then
        return public._pide_error('ENTRADA_INVALIDA','El sabor no está en el catálogo vigente.');
      end if;
      if not exists(select 1 from public.catalog_values cv
          where cv.activo and cv.categoria='salsa' and cv.valor=v_salsa) then
        return public._pide_error('ENTRADA_INVALIDA','La salsa no está en el catálogo vigente.');
      end if;
      v_detalle:=jsonb_build_object('figura',v_figura,'sabor',v_sabor,'salsa',v_salsa);
    else
      -- tipo 'pedido' (antojos, bebidas, cuchara): sabor/salsa opcionales.
      v_sabor:=btrim(coalesce(v_item->>'sabor',''));
      v_salsa:=btrim(coalesce(v_item->>'salsa',''));
      if v_sabor<>'' and not exists(select 1 from public.catalog_values cv
          where cv.activo and cv.categoria like 'sabor_%' and cv.valor=v_sabor) then
        return public._pide_error('ENTRADA_INVALIDA','El sabor no está en el catálogo vigente.');
      end if;
      if v_salsa<>'' and not exists(select 1 from public.catalog_values cv
          where cv.activo and cv.categoria='salsa' and cv.valor=v_salsa) then
        return public._pide_error('ENTRADA_INVALIDA','La salsa no está en el catálogo vigente.');
      end if;
      v_detalle:=jsonb_build_object('sabor',v_sabor,'salsa',v_salsa);
    end if;

    v_unidades:=v_unidades+v_cantidad;
    v_subtotal:=v_subtotal+(v_prod.precio_pide*v_cantidad);
    v_lineas:=v_lineas||jsonb_build_object(
      'tipo','producto','product_id',v_prod.id,'nombre',v_prod.nombre,
      'cantidad',v_cantidad,'precio_unit',v_prod.precio_pide,
      'total',v_prod.precio_pide*v_cantidad,'detalle',v_detalle);
  end loop;

  -- ---- Cobertura (§5.5): fuera → evento de demanda PII-free + error. ------
  select tarifa into v_tarifa from public.zonas where nombre=v_zona_in;
  if v_tarifa is null then
    insert into public.pide_demand_events(zona,franja,fecha,error,cantidad)
    values(v_zona_in,v_franja_in,v_fecha,'FUERA_DE_COBERTURA',
      least(24,greatest(1,v_unidades)));
    return public._pide_error('FUERA_DE_COBERTURA','Aún no llegamos a esa zona.');
  end if;

  -- ---- Capacidad (§5.6): cupo − pedidos activos de esa fecha+franja. ------
  select cupo into v_cupo from public.franjas
    where nombre=v_franja_in and coalesce(activo,true);
  if v_cupo is null then
    insert into public.pide_demand_events(zona,franja,fecha,error,cantidad)
    values(v_zona_in,v_franja_in,v_fecha,'SIN_CAPACIDAD_FRANJA',
      least(24,greatest(1,v_unidades)));
    return public._pide_error('SIN_CAPACIDAD_FRANJA','Esa franja no está disponible.');
  end if;
  select count(*) into v_activos from public.orders o
    where o.fecha=v_fecha and o.franja=v_franja_in and o.estado<>'Cancelado';
  -- Colchón también acá: el punto de quiebre no revela el cupo exacto (§8).
  if v_activos>=greatest(0,v_cupo-public._pide_setting_int('pide_stock_colchon',2)) then
    insert into public.pide_demand_events(zona,franja,fecha,error,cantidad)
    values(v_zona_in,v_franja_in,v_fecha,'SIN_CAPACIDAD_FRANJA',
      least(24,greatest(1,v_unidades)));
    return public._pide_error('SIN_CAPACIDAD_FRANJA','Esa franja ya está llena para esa fecha.');
  end if;

  -- ---- Mínimo (§5.7): global con override opcional (decisión ratificada). -
  v_minimo:=public._pide_setting_int('pide_pedido_minimo',
    public._pide_setting_int('pedido_minimo',25000));
  if v_subtotal<v_minimo then
    return public._pide_error('MINIMO_NO_ALCANZADO',
      'El pedido mínimo es de '||v_minimo::text||' COP sin domicilio.');
  end if;

  -- ---- Beneficio (§5.8 + §3.9): SOLO posesión probada = sesión propia. ----
  -- Para anon la respuesta es INDISTINGUIBLE exista o no beneficio: sin línea,
  -- sin error, mismo shape. El telefono de entrada JAMÁS activa beneficio.
  v_customer:=public.current_customer_id();
  if v_customer is not null then
    select * into v_benefit from public.benefits b
      where b.customer_id=v_customer and b.estado='Activo'
      order by b.id limit 1;
    if v_benefit.id is not null then
      if v_benefit.tipo_beneficio='descuento_porcentaje' then
        v_desc:=round(v_subtotal*coalesce(v_benefit.valor,0)/100.0);
      elsif v_benefit.tipo_beneficio='descuento_valor_fijo' then
        v_desc:=least(coalesce(v_benefit.valor,0),v_subtotal);
      else
        v_desc:=0; -- producto_gratis: línea informativa en 0
      end if;
      v_lineas:=v_lineas||jsonb_build_object(
        'tipo','beneficio','descripcion',v_benefit.beneficio,'total',-v_desc);
    end if;
  end if;

  -- ---- Domicilio + total + quote inmutable. -------------------------------
  v_lineas:=v_lineas||jsonb_build_object(
    'tipo','domicilio','zona',v_zona_in,'total',v_tarifa);
  v_total:=greatest(0,v_subtotal-v_desc)+v_tarifa;
  v_vence:=clock_timestamp()
    +make_interval(mins=>public._pide_setting_int('pide_quote_ttl_minutos',15));
  insert into public.quotes(
    canal,customer_id,telefono_hmac,lineas,total,moneda,zona,franja,
    fecha_entrega,benefit_id,atribucion,estado,vence_at)
  values('Pide',v_customer,null,v_lineas,v_total,'COP',v_zona_in,v_franja_in,
    v_fecha,case when v_benefit.id is not null then v_benefit.id end,
    nullif(p->'atribucion','null'::jsonb),'Vigente',v_vence)
  returning id into v_quote_id;

  return jsonb_build_object(
    'contract','momos.pide.quote.v1',
    'privacy',jsonb_build_object('contains_pii',false,'contains_secrets',false),
    'ok',true,'quote_id',v_quote_id,'quote_version',1,
    'vence_at',v_vence,'moneda','COP',
    'lineas',v_lineas,'total',v_total,'advertencias',v_advertencias);
exception when others then
  -- Jamás internals hacia la superficie pública; el detalle queda en el log
  -- del servidor (warning), la respuesta es genérica.
  raise warning 'cotizar_pedido_v1: %',sqlerrm;
  return public._pide_error('ENTRADA_INVALIDA','No pudimos procesar la solicitud.');
end $$;

-- ============================================================================
-- Perímetro y RBAC: la tabla de rate es deny-all; las DOS RPC públicas son la
-- única superficie con EXECUTE para anon/authenticated; helpers revocados.
-- ============================================================================
alter table public.pide_rate_counters enable row level security;
revoke all on table public.pide_rate_counters from public,anon,authenticated,service_role;

revoke all on function public._pide_rate_golpe(text,interval)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_setting_int(text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_disponibilidad(text)
  from public,anon,authenticated,service_role;
revoke all on function public._pide_error(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.catalogo_publico_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.cotizar_pedido_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.catalogo_publico_v1() to anon,authenticated;
grant execute on function public.cotizar_pedido_v1(jsonb) to anon,authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_p02_pide_cotizacion',
  'Cotizacion autoritativa Pide: precio_pide por canal (NULL=apagado), catalogo publico, cotizar con validacion canonica, capacidad con colchon, minimo global, beneficio solo con posesion probada, demanda PII-free, rate limit y remediacion de grants shop_mis_*')
on conflict(id) do nothing;

commit;
