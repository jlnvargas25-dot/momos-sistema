-- ============================================================================
-- MOMOS OPS — RPC de domicilios (v1)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas: schema-v5.sql.
-- Fuente de verdad de lógica: src/MomosOps.jsx, componente Domicilios
-- (~línea 3527-3622: tarjetas de domicilio + modal "Solicitar domicilio").
--
-- Alcance v1: SOLO create/edit del registro de domicilio (proveedor, zona,
-- costo real, observaciones). Las transiciones "En ruta"/"Entregado" NO
-- necesitan RPC nueva: set_order_status (rpc-pedidos-v1.sql, líneas 956-985)
-- YA sincroniza deliveries.estado/h_salida/h_entrega dentro de la misma
-- transacción — confirmado leyendo el cuerpo de esa función. El front debe
-- migrar esas dos ramas a la RPC existente set_order_status (ya expuesta como
-- setOrderStatusRemoto en src/lib/rpc.js desde el slice 3b), no crear nada acá.
--
-- Gap cerrado acá: "Solicitar domicilio" generaba id local con nextId(d,
-- "delivery", "D-") SIN padding — colisiona con next_id('delivery','D-',0)
-- que ya usa crear_pedido para el delivery automático de canal Rappi
-- (rpc-pedidos-v1.sql línea ~691). Dos generadores de id para la misma
-- secuencia = ids duplicados garantizados tarde o temprano. Server-side
-- next_id() es la única fuente.
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- crear_domicilio(p_order_id, p_proveedor, p_zona, p_costo_real, p_obs) returns text
-- Paridad con el modal "Solicitar domicilio" (~línea 3608-3618):
--   · pedido debe existir, no Entregado/Cancelado, y no ser canal Rappi (Rappi
--     ya trae su delivery automático desde crear_pedido — mismo filtro que la
--     UI: options={db.orders...filter(canal !== 'Rappi')})
--   · cobrado se copia de orders.dom_cobrado (igual que la maqueta: cobrado:
--     o ? o.domCobrado : 0)
--   · efecto colateral de la maqueta preservado: orders.dom_costo = costo_real
--     (o.domCosto = +form.costoReal || 0) — el gate "En ruta" de
--     set_order_status usa dom_costo como fallback si el delivery no tiene
--     costo_real propio, así que hay que mantenerlo en sync.
-- ---------------------------------------------------------------------------
create or replace function crear_domicilio(
  p_order_id text, p_proveedor text, p_zona text default null,
  p_costo_real numeric default 0, p_obs text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_delivery_id text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede solicitar domicilios';
  end if;

  select * into o from orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'El pedido % no existe', p_order_id;
  end if;
  if o.estado in ('Entregado','Cancelado') then
    raise exception 'El pedido % ya está "%": no se puede solicitar domicilio.', p_order_id, o.estado;
  end if;
  if o.canal = 'Rappi' then
    raise exception 'El pedido % es canal Rappi: el domicilio se crea automáticamente al crear el pedido.', p_order_id;
  end if;
  if not exists (select 1 from proveedores_domicilio where nombre = p_proveedor and activo) then
    raise exception 'Proveedor de domicilio inválido: %', coalesce(p_proveedor, '(vacío)');
  end if;
  if coalesce(p_costo_real,0) < 0 then
    raise exception 'El costo real del domicilio no puede ser negativo';
  end if;

  -- Idempotencia/consistencia: el gate "En ruta" de set_order_status asume UN
  -- domicilio activo por pedido (limit 1). Doble click del UI o re-solicitud
  -- con uno vigente crearían duplicados; re-solicitar solo vale si el anterior
  -- quedó 'Problema' o 'Cancelado'.
  if exists (
    select 1 from deliveries
    where order_id = p_order_id
      and estado in ('Por solicitar','Solicitado','Asignado','En ruta','Entregado')
  ) then
    raise exception 'El pedido % ya tiene un domicilio activo (cancelalo o marcalo "Problema" antes de solicitar otro).', p_order_id;
  end if;

  v_delivery_id := next_id('delivery', 'D-', 0);
  insert into deliveries (id, order_id, proveedor, costo_real, cobrado, zona, h_solicitud, estado, obs)
  values (v_delivery_id, p_order_id, p_proveedor, coalesce(p_costo_real,0), o.dom_cobrado,
          p_zona, (now() at time zone 'America/Bogota')::time, 'Solicitado', coalesce(p_obs,''));

  update orders set dom_costo = coalesce(p_costo_real,0) where id = p_order_id;

  perform _add_audit('Domicilio', v_delivery_id, 'Domicilio solicitado', '', p_proveedor);

  return v_delivery_id;
end $$;

revoke execute on function crear_domicilio(text, text, text, numeric, text) from public, anon;
grant execute on function crear_domicilio(text, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- actualizar_domicilio(p_delivery_id, p jsonb) returns void
-- Solo actualiza las claves PRESENTES en el payload (jsonb parcial):
--   · estado — SOLO los estados propios del domicilio ('Por solicitar',
--     'Solicitado','Asignado','Problema','Cancelado'), espejo del MiniSelect
--     de la tarjeta (~línea 3582-3586, audit 'Cambio de estado' de/a).
--     'En ruta'/'Entregado' se RECHAZAN acá: son dominio exclusivo de
--     set_order_status (sincroniza pedido+domicilio+sellos de tiempo en la
--     misma transacción) — pasarlos por acá rompería esa sincronización.
--   · proveedor, zona, costo_real, codigo, obs — ediciones del registro
--     (correcciones de costo, código de seguimiento del mensajero).
-- h_salida/h_entrega quedan FUERA a propósito: solo los escribe set_order_status.
-- ---------------------------------------------------------------------------
create or replace function actualizar_domicilio(p_delivery_id text, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  dl deliveries%rowtype;
  v_proveedor text;
  v_estado text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede editar domicilios';
  end if;

  select * into dl from deliveries where id = p_delivery_id for update;
  if dl.id is null then
    raise exception 'El domicilio % no existe', p_delivery_id;
  end if;
  if dl.estado in ('Entregado','Cancelado') then
    raise exception 'El domicilio % ya está "%": no se puede editar.', p_delivery_id, dl.estado;
  end if;

  -- Estado propio del domicilio (el pedido NO se entera de estos)
  if p ? 'estado' then
    v_estado := p->>'estado';
    if v_estado in ('En ruta','Entregado') then
      raise exception 'Para pasar el domicilio a "%" cambiá el estado del PEDIDO (set_order_status): esa transición sincroniza pedido, domicilio y sellos de tiempo.', v_estado;
    end if;
    if v_estado not in ('Por solicitar','Solicitado','Asignado','Problema','Cancelado') then
      raise exception 'Estado de domicilio inválido: %', coalesce(v_estado, '(vacío)');
    end if;
    if v_estado <> dl.estado then
      update deliveries set estado = v_estado where id = p_delivery_id;
      perform _add_audit('Domicilio', p_delivery_id, 'Cambio de estado', dl.estado, v_estado);
    end if;
  end if;

  -- Ediciones de campos del registro (solo si vienen en el payload)
  if p ?| array['proveedor','zona','costo_real','codigo','obs'] then
    v_proveedor := coalesce(nullif(p->>'proveedor',''), dl.proveedor);
    if not exists (select 1 from proveedores_domicilio where nombre = v_proveedor and activo) then
      raise exception 'Proveedor de domicilio inválido: %', v_proveedor;
    end if;
    if coalesce((p->>'costo_real')::numeric, 0) < 0 then
      raise exception 'El costo real del domicilio no puede ser negativo';
    end if;

    update deliveries set
      proveedor  = v_proveedor,
      zona       = coalesce(p->>'zona', zona),
      costo_real = coalesce((p->>'costo_real')::numeric, costo_real),
      codigo     = coalesce(p->>'codigo', codigo),
      obs        = coalesce(p->>'obs', obs)
    where id = p_delivery_id;

    -- Mismo efecto colateral que crear_domicilio: dom_costo del pedido sigue al
    -- costo_real vigente del domicilio activo (gate "En ruta" de set_order_status).
    if p ? 'costo_real' then
      update orders set dom_costo = (p->>'costo_real')::numeric where id = dl.order_id;
    end if;

    perform _add_audit('Domicilio', p_delivery_id, 'Domicilio editado', '', v_proveedor);
  end if;
end $$;

revoke execute on function actualizar_domicilio(text, jsonb) from public, anon;
grant execute on function actualizar_domicilio(text, jsonb) to authenticated;

-- Verificación esperada:
--   select proname, prosecdef from pg_proc where proname in ('crear_domicilio','actualizar_domicilio'); → 2 filas, prosecdef=t
--   (con anon) select crear_domicilio('P-1','Picap'); → permission denied
