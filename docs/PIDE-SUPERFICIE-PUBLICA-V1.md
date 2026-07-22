# Spec v2 — Superficie pública de Pide MOMOS

Estado: **Diseñado v2** (2026-07-21), tras segunda revisión adversarial (4
revisores: concurrencia RECHAZADA, seguridad RECHAZADA, dominio RECHAZADA,
privacidad aprobada-con-cambios; ~30 hallazgos incorporados). Complementa
`PIDE-COTIZAR-PEDIDO-V1.md` (v2). Nada implementado ni aplicado. Evidencia de la
revisión: journal del workflow `wf_1c2b2d9a-23c`.

Proceso (rigor OPS): spec → ataque → migración canónica (advisory lock +
preflight `momos_ops_migrations`, jamás renumerar) → test adversarial con
rollback → commit por hito. **Aplicar a la base viva requiere aprobación
explícita de Jorge.**

## 1. Fundaciones de schema (migración `pide-fundaciones-v1`)

1. **Canal**: los CHECK vivos se recrean (drop + add en la misma transacción,
   nombres verificados contra la base; `NOT VALID + VALIDATE` como plan B):
   `orders_canal_check` y `customers_canal_check` + `'Pide'`;
   `orders_origen_detalle_check` + `'Pide MOMOS'`; `orders_pago_check` +
   `'Pasarela (web)'`. Se retira el gancho muerto `'Temporal'`/`expira` de
   `inventory_reservations` (queda documentado que el hold vive en
   `checkout_holds`).
2. **`quotes`** (PII mínima): `id uuid` (gen_random_uuid), `quote_version`,
   `canal`, `customer_id` nullable, `telefono_hmac` (**HMAC-SHA256 con pepper
   que vive SOLO en runtime privado** — un hash simple de 10 dígitos se
   revierte por fuerza bruta), `lineas jsonb` congeladas, `total`, `zona`,
   `franja`, `fecha_entrega`, `benefit_id` nullable, `atribucion jsonb`
   (whitelist), `estado` (`Vigente|Usada|Vencida`), `vence_at`, `created_at`.
   **Purga en dos fases**: sin payment ni pedido → DELETE 24–72 h; con
   payment/pedido → al crear el pedido la atribución se copia a
   `order_attributions` (PII-free) y la fila se ANONIMIZA (`telefono_hmac=null,
   lineas=null`) conservando `id/estado/total` para el FK de `payments`
   (`ON DELETE RESTRICT`); jamás se borra antes de conciliación cerrada.
3. **`checkout_sessions`** (resuelve el crítico "el invitado no tiene camino de
   datos"): `quote_id` PK/FK, `nombre`, `telefono` crudo normalizado,
   `direccion`, `barrio`, `referencia`, `opt_in boolean` (separado, NO
   preseleccionado), `created_at`. Se escribe en `reservar_checkout_v1` /
   `iniciar_pago_v1`; `crear_pedido_publico_v1` la lee transaccionalmente para
   el `nuevo_cliente` de `crear_pedido` (dedupe por `_normalizar_telefono`).
   Misma purga en dos fases que `quotes`.
4. **`checkout_holds` + `checkout_hold_lotes`**: el hold descuenta
   `products.stock` Y `lote_figuras.consumidas` corriendo el MISMO FIFO del
   pago (locks `products → lote_figuras`); `checkout_hold_lotes(hold_id,
   batch_id, figura, cantidad)` registra el lote exacto — sin `batch_id` la
   devolución y la cancelación post-pago fugan disponibilidad para siempre.
   `UNIQUE(quote_id) WHERE estado='Temporal'` arbitra la idempotencia bajo
   carrera (patrón `customers_telefono_unique_idx`). Estados
   `Temporal|Confirmada|Expirada` con transición exactly-once (`FOR UPDATE` +
   guard de estado) en TODOS los caminos: job, promoción, liberación Y
   extensión. Purga de holds terminales junto con quotes.
5. **Anti-acaparamiento (el hold anon era un arma de congelamiento)**:
   máximo **UN checkout vivo por actor** (hmac-teléfono / dispositivo / IP —
   un hold nuevo del mismo actor invalida el anterior); **tope global de stock
   retenible por holds no pagados** (fracción configurable por producto); TTL
   corto (5–7 min) extendido UNA sola vez por el intent de pago; un intent
   `Rechazado`/vencido devuelve el hold a su `expira` original. Liberación
   perezosa de holds vencidos en AMBOS canales: `reservar_checkout_v1` la hace
   por producto, y `_reserve_inventory` (staff) libera holds vencidos del
   producto ANTES de su `least(stock, cant)` — sin esto, el job caído produce
   quiebre fantasma también para staff.
6. **`payments` + `payment_events`**: como v1, más: `UNIQUE(quote_id) WHERE
   estado='Iniciado'` (un solo intent vivo por quote — sin esto hay doble
   captura real con dos webhooks legítimos); webhook de
   rechazo/cancelación/expiración DEFINIDO (payments→`Rechazado`, holds a su
   expira original, beneficio liberado al vencer el hold); lista blanca de
   campos del proveedor que persisten (`external_id, monto, estado, tipo,
   timestamps` — JAMÁS datos del pagador).
7. **Tracking**: token `gen_random_uuid()` (v4 explícito — un default v1 sería
   predecible), emitido SOLO para pedidos del canal Pide (no default de
   columna); degrada post-`Entregado` (solo estado final, sin zona/franja);
   expira N días tras la entrega; re-emitible desde la cuenta (invalida el
   anterior). Invariante con assert en test: `tracking_token` jamás aparece en
   snapshots no-admin ni superficies de agente.
8. **`pide_demand_events`**: la `zona` NUNCA es texto crudo del usuario (el
   error `FUERA_DE_COBERTURA` ocurre justamente cuando la zona no es canónica
   — el texto libre podría ser una dirección o un teléfono): se normaliza
   contra catálogo o se registra `'OTRA_ZONA'`. Agregador con dueño:
   `pide_demand_snapshot_v1` (patrón H88, job periódico) materializa celdas
   k≥3 o re-agrega; el MCP lee SOLO el snapshot sellado (el cómputo en vivo
   permite ataque por diferencia de consultas).
9. **Perímetro H89 con mecanismo, no etiqueta**: `pide-fundaciones-v1` crea
   TODAS las tablas nuevas con RLS deny-all (acceso solo vía RPC definer /
   snapshot) y **reemplaza `cierre_lecturas_pii_disponible()`** sumando
   `quotes, checkout_sessions, checkout_holds, payments, payment_events,
   pide_demand_events` a la lista cerrada.
10. **Beneficio**: `benefits.hold_quote_id` nullable + semántica NUEVA y
    explícita de reserva-por-hold (`estado='Reservado'`, `pedido_uso IS NULL`,
    `hold_quote_id` set). Liberación al expirar el hold → vuelve a `'Activo'`
    (perezosa + job). Ningún RPC vivo procesa esa combinación hoy: es rama
    nueva, con test propio.

## 2. RPCs públicas — cambios v2 sobre la tabla v1

- **`reservar_checkout_v1`**: idempotente por el UNIQUE parcial (la rama
  perdedora devuelve el hold existente); aplica los techos de §1.5; escribe
  `checkout_sessions`.
- **`iniciar_pago_v1`**: idempotente por quote (si hay `payments` `Iniciado`
  vivo devuelve ESE intent); `FOR UPDATE` de los holds y guard
  `estado='Temporal' AND expira > now()` → si no, `HOLD_VENCIDO` ANTES de
  crear el intent; la extensión ocurre bajo ese lock, una sola vez; acota
  intents por actor.
- **Webhook**: firma sobre el **raw body** en tiempo constante; **ventana de
  frescura** del timestamp firmado (±5 min); **rotación de secreto** con dos
  secretos válidos y `key-id`; jamás loguea el body (en error: `external_event_id`
  + `payload_hash`); evento de rechazo con efecto definido (§1.6).
- **`crear_pedido_publico_v1`**: rol dedicado de mínimo privilegio
  (`pide_service`, patrón `claude_agent` — **JAMÁS `service_role`**), revoke
  explícito a public/anon/authenticated; **gate de datos**: verifica dentro de
  la transacción que existe `payment_events` con `firma_ok=true` para esa
  quote. `idempotency_key` **determinística** (uuid_v5 de `payment_id`) — un
  UUID fresco por invocación convierte la idempotencia de `orders` en
  decorativa ante re-notificaciones con `external_event_id` distinto. Guard
  transaccional: quote `FOR UPDATE`; si `Usada` por ESTE mismo pago → devuelve
  el pedido existente (no conciliación falsa). **Resuelve el beneficio él
  mismo** (`FOR UPDATE`, `Reservado` + `hold_quote_id = quote` → lo entrega ya
  resuelto al core; el descarte silencioso queda prohibido en esta rama).
  **Promoción de holds**: copia `batch_id`/`figura` desde
  `checkout_hold_lotes` a `inventory_reservations` SIN re-correr FIFO, y en la
  misma transacción ejecuta las patas que los holds NO cubren — **empaque,
  extras de receta e insumos de adiciones** (helper factorizado de
  `_reserve_inventory`; el flag `inventario_reservado=true` a secas las
  suprimiría TODAS y el inventario de empaques mentiría para siempre). Holds
  mixtos (uno expirado): intenta re-tomar stock en la misma transacción; si no
  alcanza → pedido con faltante EXPLÍCITO, jamás conciliación total por un
  hold.
- **Evolución de RPCs núcleo (nueva pieza del plan)**: `crear_pedido` y
  `set_order_status` exigen `is_staff()` — NULL en contexto service → la
  envoltura revienta en la primera llamada. `pide-pedido-v1` DEBE migrarlas:
  vía de entrada service sellada (parámetro interno solo invocable desde
  `crear_pedido_publico_v1`, o `_core` sin gate con las públicas conservando
  `is_staff()`), y gate `[Pagado]` por canal: para `'Pide'`, la evidencia es el
  `payment_event` firmado — no la foto de comprobante.
- **`tracking_publico_v1`**: mapping COMPLETO — incluye `Cancelado` →
  "Cancelado — reembolso en proceso" (según `payments`) y `Reclamo` → mantiene
  el último estado logístico público (coherente con `fix_retroceso_reclamo`).
  Rate limit de consulta; página sin recursos de terceros +
  `Referrer-Policy: no-referrer`.
- **`activar_cuenta_cliente_v1`**: la identidad del merge proviene
  **EXCLUSIVAMENTE del claim verificado del JWT** (`auth.jwt()->>'phone'` tras
  OTP de teléfono) — jamás del payload (posesión afirmada = toma de cuenta); el
  canal verificado y la llave de merge son el MISMO. **Consentimientos: en el
  merge SIEMPRE gana el más restrictivo** (`contact_allowed = A AND B`; un "No
  contactar" sobrevive al merge). Tablas hijas repuntadas enumeradas: `orders,
  benefits, claims, customer_contacts, customer_activations, referido_por,
  customer_crm_profiles` — con fila de auditoría SIN PII. **Anti-Sybil**: el
  beneficio de activación solo se emite si el cliente tiene ≥1 pedido PAGADO
  previo (coherente con "no regala margen en la 1ª compra"). **Reciclaje de
  números**: si la última actividad del cliente es anterior a un umbral (12
  meses) o hay historial sensible, el merge exige una segunda señal o va a cola
  manual con el historial OCULTO hasta validar.
- **Privacidad por RPC (la etiqueta única era falsa)**: catálogo/quote/hold/
  pago → `contains_pii:false` real; tracking → `{contains_pii:false,
  pseudonymous:true, scope:'single_order'}`; cuenta → `{own_data_only:true}`.
  Regla dura: la etiqueta describe el contenido REAL.
- **Auditoría**: la regla anti-PII cubre TODO el camino público (cotización,
  hold, pago, pedido, cuenta): `audit_logs` recibe solo IDs canónicos — el
  `_add_audit('Cliente creado', …nombre…)` del core se neutraliza en la rama
  pública.

## 3. Contingencias (v2)

| Contingencia | Resolución |
|--------------|-----------|
| Pago confirmado, pedido no creado | `En conciliación` + alerta; conciliación diaria |
| Re-notificación con `external_event_id` nuevo del MISMO pago | key determinística + guard "quote Usada por este pago → devolver pedido existente" |
| Doble intent / doble captura | UNIQUE parcial `payments(quote_id) WHERE Iniciado` + idempotencia de `iniciar_pago_v1` |
| Pago Rechazado | Holds a expira original; beneficio se libera al vencer el hold |
| Hold vencido con webhook tardío | Relojes (spec hermana §7) + re-toma en promoción; faltante explícito como último recurso |
| Job de expiración caído | Liberación perezosa en AMBOS canales (§1.5) + health-check precondición |
| Acaparamiento anon | Techos §1.5 (un checkout vivo por actor, tope global, TTL corto) |
| Refresh del checkout | `quote_id` + idempotencia end-to-end |

## 4. Orden de construcción (v2)

1. `pide-fundaciones-v1`: §1 completo (canal, quotes, checkout_sessions,
   holds+lotes, payments, tracking, demand+snapshot, guard H89, beneficio) + tests.
2. `pide-cotizacion-v1`: `cotizar_pedido_v1` + `catalogo_publico_v1` + tests.
3. `pide-checkout-v1`: `reservar_checkout_v1` + `iniciar_pago_v1` + techos +
   tests de concurrencia (última unidad, doble hold, expiración vs extensión).
4. `pide-pedido-v1`: **evolución de `crear_pedido`/`set_order_status`** (vía
   service + gate por canal) + `crear_pedido_publico_v1` + webhook +
   `tracking_publico_v1` + tests (replay, doble evento, beneficio, empaque
   descontado, batch_id devuelto).
5. `pide-cuenta-v1`: `activar_cuenta_cliente_v1` (JWT-only, merge con
   consentimiento restrictivo, anti-Sybil, reciclaje) + tests.
6. **Gate de aplicación**: revisión adversarial del SQL → aprobación de Jorge →
   aplicar verificando `momos_ops_migrations`.
7. `apps/shop`: scaffold separado contract-first (sin read-model interno),
   pantallas de la maqueta con Kit V3, compra E2E local.

## 5. Estados

Vara de CLAUDE.md por pieza: Diseñado → Implementado → Validado localmente →
Desplegado → Operativo. Hoy TODO en **Diseñado** (v2, dos rondas adversariales).
