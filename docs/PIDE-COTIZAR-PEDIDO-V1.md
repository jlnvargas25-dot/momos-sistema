# Spec v2 — `cotizar_pedido_v1` (cotización autoritativa de Pide MOMOS)

Estado: **Diseñado v2** (2026-07-21), tras revisión adversarial de 4 revisores
independientes (concurrencia, seguridad anon, coherencia de dominio, privacidad).
Veredictos v1: 2 rechazadas + 2 aprobadas-con-cambios → 24 hallazgos incorporados.
No implementado, no desplegado. Premisas verificadas contra la base viva
(proyecto `momo`) el 2026-07-21.

## 1. Propósito

Única fuente de precio, disponibilidad y condiciones para el shop público.
El navegador arma la intención (caja, zona, franja); el servidor responde una
cotización inmutable, con precio congelado y vencimiento. Todas las olas
aprobadas (fidelización, drops, regalos programados, atribución, mapa de
demanda) pasan por aquí.

## 2. Posición en el circuito

```text
Meta/TikTok ── utm/campaign_id/creative_id ──► Pide MOMOS
  ► cotizar_pedido_v1 ► reservar_checkout_v1 ► pago (intent+webhook) ► crear_pedido_publico_v1
                                                                          │
                     MOMO OPS (verdad: stock, capacidad, producción, margen)
                                                                          │
Agencia MOMOS ◄── pedidos pagados + margen + recompra por creativo ◄──────┘
MCP Claude/Codex — lee agregados sin PII (k≥3); analiza y propone; humano aprueba.
```

## 3. Principios no negociables

1. El navegador nunca decide precio, promo, stock, cobertura ni capacidad.
2. La quote es inmutable; re-cotizar crea una quote nueva. El campo público es
   `quote_version` (revisión de la quote) — `contract` versiona el CONTRATO,
   como en todo el ecosistema.
3. Cotizar **no muta estado comercial** (stock, beneficios, pedidos). Único
   efecto colateral permitido: un evento de demanda insatisfecha PII-free
   (campos exactos en §6; jamás el payload crudo).
4. Ciclo REAL del beneficio (verificado en `rpc-pedidos-v1.sql:761,942`):
   `Activo → Reservado` (con `pedido_uso`, al CREAR el pedido) `→ Usado` (al
   pagar). En canal público el beneficio se **reserva en `reservar_checkout_v1`**
   (hold con `expira`); si al confirmar el pago el beneficio ya no está, el
   checkout **FALLA ANTES de capturar** — se prohíbe la rama de descarte
   silencioso de `crear_pedido` (línea 764) en este canal. Jamás un pedido cuyo
   total no coincida con lo cobrado.
5. Superficie `anon` mínima vía RPC cerrada; jamás expone costos, márgenes ni
   datos de otros clientes.
6. Errores tipificados sin internals; señales de disponibilidad **gruesas**
   (disponible / pocas unidades / agotado — nunca el número exacto).
7. La entrada JAMÁS contiene precios — ni en items ni en adiciones. Todo se
   reprecia server-side (el `adiciones.precio` del flujo staff queda prohibido
   en canal público).
8. Canal `pide`: se agrega **alterando los CHECK vivos** `orders_canal_check` y
   `customers_canal_check` (hoy WhatsApp/Instagram/Rappi/Directo), extendiendo
   `orders_pago_check` (hoy Nequi/Daviplata/Bancolombia/Rappi (app) — la
   pasarela no cabe) y el dominio de `orders_origen_detalle_check`, más el enum
   del front. Verificado vivo 2026-07-21.
9. Beneficios SOLO con posesión probada del teléfono: sesión `authenticated`
   (`customers.auth_id` + `current_customer_id()`) u OTP verificado. Para un
   `anon` sin verificar, la respuesta es **indistinguible** exista o no
   beneficio: sin línea de beneficio, sin `BENEFICIO_NO_VIGENTE`, mismo shape.
10. Identificadores públicos opacos: `quote_id` es token de alta entropía
    (UUID v4 o equivalente) — jamás `next_id()` secuencial (regla ya escrita en
    `schema-v5.sql:11-13`). El `benefit_id` interno no se expone a `anon`.

## 4. Contrato de entrada (`p jsonb`) — claves canónicas REALES

Las entidades del dominio se identifican por **nombre** (PKs reales:
`zonas.nombre`, `franjas.nombre`, `figuras.nombre`; sabor y salsa viven en
`catalog_values(categoria, valor)`). No existen `zona_id`/`figura_id`.

```jsonc
{
  "canal": "pide",
  "telefono": "3015550123",            // opcional; solo activa beneficio si hay posesión probada (§3.9)
  "items": [
    {
      "product_id": "PRD-0012",
      "cantidad": 1,                    // entero >= 1, techo comercial (MAX_CANT)
      "boxes": [                        // boxes.length == cantidad (estructura real de crear_pedido)
        [                               // cada caja: EXACTAMENTE combo_size slots
          { "figura": "Momo", "sabor": "Arequipe", "salsa": "Chocolate" },
          { "figura": "Lizi", "sabor": "Fresa",    "salsa": "Arequipe" }
          // … salsa es obligatoria: crear_pedido revienta sin ella (rpc-pedidos-v1.sql:619-623)
        ]
      ],
      "adiciones": [ { "nombre": "Topping X", "cant": 1 } ]   // SIN precio (§3.7)
    }
  ],
  "zona": "Chapinero",
  "franja": "Sábado AM",
  "fecha_entrega": "2026-07-25",
  "atribucion": {                       // whitelist de claves + longitud máxima por valor
    "utm_source": "meta", "utm_campaign": "…", "utm_content": "…",
    "campaign_id": "CMP-…", "creative_id": "CRE-…",
    "cupon": null,
    "referido": "REF-8F3K2Q",           // SIEMPRE código opaco emitido por el sistema;
                                        // se RECHAZA cualquier valor con formato de teléfono
    "landing": "/caja-x6", "qr": "QR-RAPPI-07"
  }
}
```

**Límites duros server-side, validados ANTES de tocar catálogo** (anti-DoS):
máximo de items por quote; `boxes.length == cantidad`; `combo_size` slots
exactos por caja; máximo de adiciones por item; whitelist + longitud máxima en
`atribucion`; tamaño total del payload acotado. Violación → `ENTRADA_INVALIDA`.

## 5. Validaciones (server-side, en orden)

| # | Validación | Verdad consultada | ¿Existe hoy? |
|---|------------|-------------------|--------------|
| 1 | Producto activo | `products.activo` | Sí |
| 2 | Habilitación y precio del canal `pide` | flag + precio por canal | **NUEVO** (hoy solo `precio`+`precio_rappi`; diseñar `product_channel` o columna) |
| 3 | Figura canónica del producto | `figuras`/`combo_components` (guardas existentes) | Sí |
| 4 | Sabor y salsa canónicos | `catalog_values` activo | **NUEVO** (las guardas `_momos_*` hoy solo exigen no-vacío) |
| 5 | Cobertura | `zonas` por nombre (tarifa) | Sí |
| 6 | Capacidad franja+fecha | `franjas.cupo` (gancho vivo) − pedidos activos de esa fecha+franja | **PARCIAL** (cupo existe; la ventana por fecha es la extensión) |
| 7 | Mínimo de pedido | `app_settings.pedido_minimo` (global; por-canal sería construcción nueva) | Sí |
| 8 | Beneficio vigente | `benefits` — SOLO con posesión probada (§3.9) | Sí (tabla); posesión **NUEVA** |
| 9 | Disponibilidad vendible | stock/variantes — respuesta gruesa (§3.6) | Sí (fuente); granularidad **NUEVA** |

## 6. Contrato de salida — sobre contract-first

```jsonc
{
  "contract": "momos.pide.quote.v1",
  "privacy": { "contains_pii": false, "contains_secrets": false },
  "ok": true,
  "quote_id": "b7e9…-uuid-v4",          // token opaco, NO secuencial
  "quote_version": 1,
  "vence_at": "2026-07-21T14:32:00-05:00",
  "moneda": "COP",
  "lineas": [
    { "tipo": "producto", "product_id": "PRD-0012", "cantidad": 1,
      "precio_unit": 48000, "total": 48000 },
    { "tipo": "beneficio", "descripcion": "Malteada de regalo", "total": 0 },
    { "tipo": "domicilio", "zona": "Chapinero", "total": 6000 }
  ],
  "total": 54000,
  "advertencias": []
}
```

- **No existe línea `empaque`**: el precio del combo YA incluye su caja
  (invariante `schema-v5.sql:482`; el empaque es consumo de inventario con
  costo, no precio de venta). Una línea cobrada que `crear_pedido` no puede
  reproducir haría la quote irreproducible.
- La línea `beneficio` solo aparece con posesión probada (§3.9), sin
  `benefit_id` interno.
- Errores tipificados: `ENTRADA_INVALIDA`, `PRODUCTO_NO_DISPONIBLE`,
  `FUERA_DE_COBERTURA`, `SIN_CAPACIDAD_FRANJA`, `MINIMO_NO_ALCANZADO`,
  `QUOTE_RATE_LIMIT`. **`BENEFICIO_NO_VIGENTE` no existe en modo anon** (sería
  un oráculo de membresía); solo puede emitirse en canal autenticado dueño del
  beneficio.

**Evento de demanda insatisfecha** (única mutación permitida, §3.3):
`FUERA_DE_COBERTURA` y `SIN_CAPACIDAD_FRANJA` emiten un evento con campos
EXACTOS: `{zona, franja, fecha, error, cantidad}`. Sin teléfono, sin atribución,
sin payload. La tabla cruda queda dentro del perímetro H89; los snapshots para
agentes MCP solo exponen celdas con conteo **k ≥ 3** (o agregan a granularidad
mayor hasta alcanzarlo) y jamás incluyen `qr`/`referido`/`utm` como dimensión.

## 7. Relación con el resto del flujo

- **Menú público sincronizado con productos activos de OPS**: el menú NO es una
  copia — `shop_catalogo` (verificada viva) proyecta `products WHERE activo`;
  `set_producto_activo` en OPS enciende/apaga sin sincronización manual.
  `catalogo_publico_v1` extiende: canal habilitado, disponibilidad real, precio
  por canal. El menú CDN puede quedar desfasado (TTL corto): aceptable porque la
  autoridad es la quote — un menú viejo jamás vende un producto apagado.

- **`reservar_checkout_v1`** (spec hermana; restricciones que ESTA spec le impone):
  1. **Semántica de contadores exacta**: el hold descuenta `products.stock` Y
     `lote_figuras.consumidas` en una transacción con locks en el orden canónico
     `products → lote_figuras`. Un hold que no descuenta no protege nada
     (sobreventa contra el flujo staff); uno que descuenta dos veces rompe
     Producción.
  2. **El gancho actual NO alcanza**: `inventory_reservations.order_id` es
     NOT NULL → `orders` (verificado vivo) y en este punto el pedido no existe.
     Decisión de schema explícita: tabla `checkout_holds` propia promovida a
     `inventory_reservations` al crear el pedido, o ALTER a nullable con
     `checkout_session_id`. Ninguna función viva procesa estado `Temporal` ni
     `expira` (`_release_reservations` solo itera `Reservada`) — todo es
     construcción nueva.
  3. **Reserva también el beneficio** (estado `Reservado` atado al hold, con la
     misma expiración) — cierra el doble canje concurrente.
  4. **Expiración con doble defensa**: fallback perezoso (toda lectura de
     disponibilidad descuenta solo holds con `expira > now()`; liberación
     oportunista de holds vencidos del mismo producto) + job de limpieza con
     `FOR UPDATE` y transición exactly-once (`Temporal→Confirmada` XOR
     `Temporal→Expirada`). El health-check del job es **precondición para
     habilitar el canal** (el scheduler del proyecto es `external-required`).

- **Jerarquía de relojes** (quote / hold / webhook): la vigencia de la quote se
  valida al **INICIAR el cobro** (creación del payment intent); desde ahí el
  hold se extiende hasta la resolución del intent (`vence_hold ≥ vence_quote +
  ventana de pasarela`); un webhook confirmado SIEMPRE produce pedido o entra a
  cola de conciliación con reembolso — **jamás** se rechaza por quote vencida
  DESPUÉS de capturar plata.

- **`crear_pedido_publico_v1`** (spec hermana): exige quote vigente al iniciar
  cobro; convierte los holds a `inventory_reservations` `'Reservada'` y setea
  `orders.inventario_reservado = true` **ANTES** del efecto `[Pagado]` — para
  que `_reserve_inventory` (que corre incondicional en ese efecto) no
  re-descuente. Llave `idempotency_key` UUID v4 validada por servidor. Deriva
  `campaign_id`/`creative_id`/`origen_detalle` (valor nuevo del dominio, p.ej.
  `'Pide MOMOS'`) desde la quote; el resto de la atribución (UTM, qr, cupon,
  referido, landing) **persiste en la tabla `quotes`** — no cabe en `orders`
  (CHECK de `origen_detalle` cerrado, verificado vivo).

- **Gates de pago por canal**: para `pide`, la evidencia de `Pagado` es el
  evento firmado e idempotente del webhook (`payment_events`) — los gates de
  `set_order_status` se extienden por canal, no se puentean.

## 8. Seguridad y gobernanza

- RPC `SECURITY DEFINER` de lista cerrada para `anon`; RLS estricta.
- **Anti-enumeración por diseño, no por rate limit**: nada de lo que responde la
  RPC varía según el teléfono de un tercero (§3.9). El rate limit (por IP y
  global) es defensa de costo/DoS y se documenta como tal; el contador por
  teléfono usa **hash del teléfono normalizado con TTL corto**, jamás el crudo.
- **Tabla `quotes` dentro del perímetro H89** (requisito, no pendiente):
  teléfono hasheado o referencia a `customer_id` (jamás crudo), entra a la lista
  de tablas cerradas y al guard `cierre_lecturas_pii_disponible()`, TTL/purga
  declarada (24–72 h), y prohibición explícita del teléfono en `audit_logs` y
  logs de error del camino de cotización.
- **Señal de capacidad gruesa** con tope de `cantidad` por quote y colchón en el
  umbral: el punto de quiebre no revela el número real de stock/cupo (hoy un
  `anon` podría binar-buscar la capacidad exacta franja por franja).
- **Prerequisito de despliegue** (promovido desde pendiente): revocar el grant
  `anon` sobrante de `shop_mis_pedidos`/`shop_mis_items` ANTES de abrir
  cualquier RPC pública nueva.
- Los agentes (MCP) ven demanda agregada k≥3; nunca quotes individuales.

## 9. Decisiones abiertas (explícitas, con dueño)

1. `checkout_holds` propia vs ALTER `inventory_reservations.order_id` nullable — spec de `reservar_checkout_v1`.
2. Modelo de precio/habilitación por canal (`product_channel` vs columnas) — spec de `catalogo_publico_v1`.
3. Valor canónico nuevo de `origen_detalle` para el canal (`'Pide MOMOS'`).
4. Mínimo de pedido por canal: ¿usar el global o introducir `pedido_minimo_pide`?
5. Medio de pago de pasarela a agregar en `orders_pago_check`.

## 10. Registro de la revisión adversarial (2026-07-21)

4 revisores independientes; veredictos v1: concurrencia **rechazada**, dominio
**rechazada**, seguridad y privacidad **aprobada-con-cambios**. 24 hallazgos
(5 críticos, 5 altos) incorporados en esta v2. Los críticos: semántica de
contadores del hold; doble canje de beneficio con descarte silencioso post-cobro;
IDs inexistentes en el contrato (zona/franja/figura/sabor son por nombre);
slots sin `salsa` ni estructura `boxes`; línea `empaque` cobrada sin mecanismo.
Evidencia completa en el journal del workflow `wf_e7799f23-efd`.
