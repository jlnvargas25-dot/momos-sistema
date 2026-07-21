# Spec — Superficie pública de Pide MOMOS (v1)

Estado: **Diseñado** (2026-07-21). Complementa `PIDE-COTIZAR-PEDIDO-V1.md` (v2,
post-revisión adversarial). Pendiente: revisión adversarial de ESTE doc antes de
escribir SQL. Nada de esto está implementado ni aplicado.

Regla de proceso (rigor OPS): cada pieza = spec → ataque adversarial → migración
en `supabase/migraciones-ordenadas/` (transacción + advisory lock + preflight
contra `momos_ops_migrations`, jamás renumerar) → test adversarial con rollback
→ commit por hito. **Aplicar a la base viva requiere aprobación explícita de
Jorge** — el SQL se escribe y prueba primero.

## 1. Fundaciones de schema (migración `pide-fundaciones-v1`)

1. **Canal**: ALTER de `orders_canal_check` y `customers_canal_check` para
   agregar `'Pide'`; nuevo valor `'Pide MOMOS'` en `orders_origen_detalle_check`;
   nuevo medio en `orders_pago_check` (`'Pasarela (web)'` — proveedor concreto
   en config). Todos son CHECKs vivos verificados 2026-07-21.
2. **`quotes`** (perímetro H89 desde el día 1): `id uuid` PK (token opaco),
   `quote_version int`, `canal`, `customer_id` nullable FK, `telefono_hash text`
   (jamás crudo), `lineas jsonb` (congeladas, repreciadas server-side),
   `total numeric`, `zona`, `franja`, `fecha_entrega`, `benefit_id` nullable,
   `atribucion jsonb` (whitelist), `estado` CHECK (`Vigente|Usada|Vencida`),
   `vence_at timestamptz`, `created_at`. Purga programada 24–72 h. Se agrega a
   la lista cerrada H89 y al guard `cierre_lecturas_pii_disponible()`.
3. **`checkout_holds`**: `id uuid`, `quote_id` FK, `product_id`, `figura`,
   `sabor`, `cantidad`, `estado` CHECK (`Temporal|Confirmada|Expirada`),
   `expira timestamptz`, `created_at`. Decisión (spec v2 §9.1) resuelta aquí:
   **tabla propia** — no se altera `inventory_reservations.order_id NOT NULL`;
   la promoción a `inventory_reservations('Reservada')` ocurre al crear el
   pedido. Crear un hold descuenta `products.stock` y `lote_figuras.consumidas`
   con locks `products → lote_figuras`; expirar/liberar los devuelve. Ninguna
   lectura de disponibilidad cuenta holds con `expira <= now()` (fallback
   perezoso) y `reservar_checkout_v1` libera oportunísticamente vencidos.
4. **`payments` + `payment_events`**: `payments(id uuid, quote_id FK, order_id
   nullable FK, proveedor, external_id, monto, estado CHECK
   (Iniciado|Confirmado|Rechazado|Reembolsado|En conciliación), created_at)`;
   `payment_events(id, payment_id FK, external_event_id UNIQUE, tipo, firma_ok
   boolean, payload_hash, recibido_en)` — idempotencia por `external_event_id`
   UNIQUE: el retry del proveedor no duplica efectos. Perímetro H89.
5. **Tracking**: `orders.tracking_token uuid` UNIQUE default aleatorio —
   cumple la regla del schema ("token opaco, jamás la PK").
6. **Demanda insatisfecha**: `pide_demand_events(zona, franja, fecha, error,
   cantidad, created_at)` — sin teléfono, sin atribución. Perímetro H89; el
   agregado para MCP exige k≥3.
7. **Beneficio**: `benefits.hold_quote_id` nullable + estado de reserva por
   hold, para el canje único concurrente (spec v2 §3.4/§7).

## 2. RPCs públicas (todas SECURITY DEFINER, lista cerrada, límites de payload)

| RPC | Rol | Contrato | Esencia |
|-----|-----|----------|---------|
| `catalogo_publico_v1()` | anon | `momos.pide.catalogo.v1` | Productos activos + habilitados canal Pide, figuras/sabores/salsas canónicos (de `figuras`/`catalog_values`), zonas con tarifa, franjas SIN cupo numérico, disponibilidad gruesa. Base: proyección de `products` (menú sincronizado por construcción). |
| `cotizar_pedido_v1(p)` | anon | `momos.pide.quote.v1` | Spec v2 completa (doc hermano). |
| `reservar_checkout_v1(p{quote_id})` | anon | `momos.pide.hold.v1` | Valida quote `Vigente`; crea `checkout_holds` (descuenta contadores, locks canónicos); reserva el beneficio de la quote; devuelve `vence_at` del hold. Idempotente por `quote_id` (re-llamar devuelve el hold vivo). |
| `iniciar_pago_v1(p{quote_id})` | anon | `momos.pide.pago.v1` | AQUÍ se valida la vigencia de la quote (jerarquía de relojes, spec v2 §7); crea `payments(Iniciado)` + intent del proveedor; **extiende los holds** hasta `vence_quote + ventana de pasarela`. |
| webhook `payment.confirmed` | edge function (secreto en runtime privado) | — | Verifica firma; inserta `payment_events` (UNIQUE = idempotente); si confirma → llama `crear_pedido_publico_v1`; si el pedido no puede crearse → `payments = 'En conciliación'` + alerta. **Jamás rechaza post-captura por quote vencida.** |
| `crear_pedido_publico_v1(p)` | solo desde el camino de pago (service) | `momos.pide.pedido.v1` | Transaccional: promueve holds → `inventory_reservations('Reservada')`, marca `orders.inventario_reservado = true` ANTES del efecto `[Pagado]` (evita el re-descuento de `_reserve_inventory`); envuelve `crear_pedido` con `boxes[][]{figura,sabor,salsa}`; beneficio de la quote o FALLA (nunca descarte silencioso); sella `campaign_id`/`creative_id`/`origen_detalle='Pide MOMOS'`; quote → `Usada`; genera `tracking_token`; `idempotency_key` UUID v4. |
| `tracking_publico_v1(p{token})` | anon | `momos.pide.tracking.v1` | Por `tracking_token`: estados públicos simplificados (mapping cerrado: Nuevo/Confirmado/Pendiente de pago → "Pedido recibido"; Pagado → "Pago confirmado"; En producción/Listo para empaque/Empacado → "Preparando"; Listo para despacho → "Listo para despacho"; En ruta → "En camino"; Entregado → "Entregado"), franja, zona (sin dirección completa), líneas sin precios internos. Jamás datos de otro pedido. |
| `activar_cuenta_cliente_v1(p)` | authenticated | `momos.pide.cuenta.v1` | Transaccional: verifica posesión (el auth flow ya validó el teléfono vía OTP/magic link), setea `customers.auth_id`, **merge por teléfono normalizado** (regla dura: jamás dos clientes; conflicto → cola de validación manual), emite el beneficio de activación (producto de regalo, fidelización decidida) con `minimo` y `vence`. Idempotente: re-llamar no duplica beneficio. |

Reglas transversales: errores tipificados en español sin internals; sobres con
`contract` + `privacy{contains_pii:false}`; rate limit por IP/global (DoS) +
contadores por hash de teléfono con TTL; límites duros de payload antes de tocar
catálogo; ningún RPC público escribe PII del camino de cotización en `audit_logs`.

## 3. Contingencias (del blueprint, ahora con dueño)

| Contingencia | Resolución |
|--------------|-----------|
| Pago confirmado, pedido no creado | `payments='En conciliación'` + alerta operativa; conciliación diaria obligatoria |
| Producto agotado post-pago | No debe ocurrir con holds; si ocurre (bug), pedido nace con faltante EXPLÍCITO a Producción + alerta — jamás silencioso |
| Hold vencido con webhook tardío | Jerarquía de relojes: holds extendidos por `iniciar_pago_v1`; si aún así venció → conciliación con reembolso |
| Doble webhook / retry proveedor | `payment_events.external_event_id` UNIQUE — replay inocuo |
| Job de expiración caído | Fallback perezoso en lecturas + health-check del job como precondición del canal (`external-required`) |
| Refresh del checkout | `quote_id` + idempotencia end-to-end |

## 4. Orden de construcción (SQL primero, front después)

1. `pide-fundaciones-v1` (schema §1) + test adversarial.
2. `pide-cotizacion-v1` (`cotizar_pedido_v1` + `catalogo_publico_v1`) + tests
   (incluye: anti-oráculo de beneficio, límites de payload, señal gruesa).
3. `pide-checkout-v1` (`reservar_checkout_v1` + `iniciar_pago_v1` + holds) +
   tests de concurrencia (última unidad, doble hold, expiración vs confirmación).
4. `pide-pedido-v1` (`crear_pedido_publico_v1` + webhook + `tracking_publico_v1`)
   + tests (replay de webhook, quote usada, beneficio no elegible → falla).
5. `pide-cuenta-v1` (`activar_cuenta_cliente_v1` + merge + beneficio) + tests.
6. **Gate de aplicación**: revisión adversarial del SQL completo → aprobación de
   Jorge → aplicar a la base viva en orden, verificando `momos_ops_migrations`.
7. `apps/shop`: scaffold Vite separado (bundle propio, jamás importa el
   read-model interno), cliente contract-first con adapter real + mock, pantallas
   de la maqueta aprobada con Kit V3, compra E2E local contra la base aplicada.

## 5. Definición de terminado por pieza

Cada pieza declara su estado con la vara de CLAUDE.md: Diseñado → Implementado
(SQL/código en repo con tests pasando) → Validado localmente (suite + flujo E2E
local) → Desplegado (aplicado a la base viva / shop hosteado) → Operativo
(piloto real con conciliación diaria limpia). Hoy TODO está en Diseñado.
