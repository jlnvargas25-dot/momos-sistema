# PIDE MOMOS — blueprint del shop público (destilado 2026-07-10)

> Capa comercial pública sobre el MISMO backend que MOMOS OPS ("dos frontends, un backend",
> HANDOFF §Decisiones). **Pide MOMOS vende; OPS ejecuta y controla.**
> Se construye DESPUÉS de migrar OPS (Fase 1-2). Los ganchos de datos ya están en
> [`supabase/schema-v5.sql`](supabase/schema-v5.sql).

## Reglas no negociables

1. El inventario existe UNA vez. 2. El pedido se crea UNA vez. 3. El precio lo calcula el
BACKEND (el shop nunca decide stock/precio/promo/cobertura). 4. La reserva vence sola.
5. Pago confirmado activa la operación. 6. Todo cambio auditado. 7. El shop jamás ve
costos/márgenes/otros clientes. 8. OPS es la autoridad operativa.

## MVP (primera versión — nada más)

Catálogo · configurador de caja (slots figura+sabor, estructurado, NO texto libre) · carrito ·
datos del cliente · dirección/referencias · zona y domicilio (tarifa desde `zonas`, nunca
duplicada) · pago · confirmación · reserva automática · pedido creado en OPS · seguimiento básico.
**V2 (no arrancar con esto):** recompra 1-click, cupones, **referidos/embajadores (blueprint
propio: [`EMBAJADORES.md`](EMBAJADORES.md))**, puntos/VIP, recuperación
de carrito, notificaciones, recomendaciones, app móvil, suscripciones.

## Flujo del pedido

Carrito → Validación (backend: catálogo/inventario/mínimo/horario/zona/capacidad) → Cotización
(precio+empaque+domicilio+promo) → **Reserva TEMPORAL (10-15 min, vence sola)** → Pago →
Confirmación → Pedido en OPS → cocina/despacho/CRM/atribución/margen. Nada se re-escribe a mano.

## Decisiones técnicas clave

- **Reserva temporal**: nuevo estado `Temporal` + `expira` en `inventory_reservations` (ya en
  schema-v5). Paga → se confirma (`Reservada`); expira → se libera. Evita vender 2 veces la unidad.
- **Idempotencia**: `orders.idempotency_key` UNIQUE (ya en schema-v5) — doble click en "Pagar"
  o reintento de red jamás crea 2 pedidos/cobros/reservas.
- **Estados por dominio** (pedido/pago/inventario/entrega separados): la maqueta YA los separa
  (ORDER_STATES / inventory_reservations / DOM_ESTADOS). NUEVO: estados de PAGO propios
  (Pendiente → En validación → Confirmado / Rechazado / Reembolsado) — hoy `comprobante`+
  `pagadoEn` alcanzan; tabla `payments` recién cuando llegue pasarela.
- **Estados públicos simplificados** (vista/mapping, no esquema): Pedido recibido → Pago
  confirmado → Preparando → Listo para despacho → En camino → Entregado. OPS mantiene el detalle.
- **Eventos** (Fase 2, triggers/colas): `payment.confirmed` → confirmar reserva + cocina +
  mensaje al cliente + atribución + contribución preliminar. Ídem `order.ready`,
  `delivery.assigned`, `claim.created`, `customer.reordered`.
- **Catálogo público**: foto (Storage → `products.foto_path`), `alergenos`, descripción,
  disponibilidad por día, tiempo estimado. **Nunca muestra lo que OPS no puede vender**
  (availability server-side). Canal habilitado por producto y **precios por canal**
  (`precio_base`/`precio_por_canal`/`precio_promocional` con vigencias) = modelo futuro;
  hoy `precio`+`precio_rappi` alcanzan.
- **Atribución web**: conservar campaña/anuncio/creativo/UTM/landing/cupón/referido al crear
  el pedido (jsonb `atribucion_web` cuando se implemente el shop) — se suma al
  `campaign_id`/`creative_id`/`origen_detalle` existentes.
- **Resiliencia**: frontend separado, caché de catálogo, reintentos, colas de notificaciones —
  el shop sigue vivo aunque una pantalla de OPS falle.
- **Contingencias con política automática + alerta**: pago confirmado sin pedido creado ·
  pedido sin reserva · producto agotado post-pago · mensajero cancela · fuera de cobertura ·
  caída de WhatsApp/pasarela · refresh del checkout (lo cubre la idempotencia).

## Invitado primero (decisión del usuario, 2026-07-10)

- **Comprar como invitado por DEFAULT**: nombre + celular + dirección + referencia + pago
  (correo opcional; opt-in de novedades separado y NO preseleccionado). Sin contraseña, sin
  OTP obligatorio, sin "crear usuario" antes de pagar.
- **OPS crea el cliente igual** (clave: teléfono) → historial, atribución, ticket, sabores,
  recompra y valor acumulado desde el pedido #1. La cuenta NO crea al cliente; solo le da
  acceso a su historial y beneficios.
- **"Cuenta activada" NO es un estado del enum**: es `customers.auth_id IS NOT NULL` —
  ortogonal al valor del cliente (un invitado con 3 compras puede ser VIP sin contraseña).
  Invitado = `auth_id IS NULL`; invitado recurrente = derivado (`pedidos ≥ 2 AND auth_id IS NULL`).
- **Ofrecer la cuenta POST-ENTREGA** (entre horas y 24 h después — ya probó el producto), no
  post-pago. Beneficio elegido: **"Creá tu cuenta y recibí $5.000 para tu próxima caja desde
  $50.000"** (no regala margen en la 1ª compra, sube ticket, fomenta la 2ª).
- **Activación sin contraseña**: magic link por WhatsApp/correo u OTP de 6 dígitos (Supabase
  Auth los soporta). Consulta de pedido suelto: número de pedido + teléfono.
- **REGLA DURA de merge**: al activar cuenta, unir TODO el historial por teléfono/correo
  (validación manual si hay conflicto). Jamás dos clientes por invitado/activación/WhatsApp
  → RPC de merge + índice por teléfono.
- Auth de clientes y de equipo NUNCA se comparten (roles/RLS distintos; ya en schema-v5).

## Ganchos ya aplicados a schema-v5

`customers.auth_id` + RLS rol cliente (turno previo) · `orders.idempotency_key` ·
`inventory_reservations` estado `Temporal` + `expira` · `products.foto_path` + `alergenos` ·
`orders.comision_pago` · `zonas` con tarifa (fuente única del domicilio).

## Arquitectura de referencia (Fase 3+)

Monorepo `apps/ops + apps/shop`, packages compartidos, `ops.momossweetlove.com` /
`pedidos.momossweetlove.com` / API compartida. El primer desarrollo del shop = el flujo
completo de punta a punta: catálogo → carrito → pago → reserva → pedido en OPS → entrega.
