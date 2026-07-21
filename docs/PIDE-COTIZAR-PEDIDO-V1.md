# Spec — `cotizar_pedido_v1` (cotización autoritativa de Pide MOMOS)

Estado: **Diseñado** (2026-07-21). No implementado, no desplegado.
Base verificada: firmas vivas en el proyecto `momo` (Supabase) el 2026-07-21;
maqueta v1/v2 y cruce de contratos en el artifact "Maqueta Pide MOMOS".

## 1. Propósito

Única fuente de precio, disponibilidad y condiciones para el shop público.
El navegador arma la intención (caja, zona, franja); el servidor responde una
cotización versionada, con precio congelado y vencimiento. Sin esta pieza no hay
checkout, fidelización, drops, regalos programados ni atribución confiable:
**todas las olas aprobadas pasan por aquí**.

## 2. Posición en el circuito

```text
Meta/TikTok (pauta y orgánico)
      │ utm / campaign_id / creative_id
      ▼
Pide MOMOS ──► cotizar_pedido_v1 ──► reservar_checkout_v1 ──► pago ──► crear_pedido
      │                (esta spec)                                        │
      │                                                                   ▼
      │                                              MOMO OPS (verdad: stock, capacidad,
      │                                              producción, entrega, margen)
      ▼                                                                   │
Agencia MOMOS ◄── pedidos pagados + margen + recompra por creativo ◄──────┘
      │
      ▼
MCP Claude/Codex — lee snapshots AGREGADOS (sin PII), analiza, propone;
el humano aprueba. La demanda de Pide entra a esos snapshots.
```

## 3. Principios no negociables

1. El navegador nunca decide precio, promo, stock, cobertura ni capacidad.
2. La cotización es inmutable y versionada; re-cotizar crea una versión nueva.
3. Cotizar **no muta nada**: no reserva stock, no marca beneficios, no crea pedido.
4. El beneficio se aplica en la cotización pero se consume (`benefits.pedido_uso`)
   solo cuando el pago confirma el pedido.
5. Superficie pública mínima: rol `anon` vía RPC cerrada; jamás expone costos,
   márgenes ni datos de otros clientes.
6. Errores tipificados; ningún error filtra internals.
7. **La entrada JAMÁS contiene precios** — ni en items ni en adiciones/toppings.
   Todo se reprecia server-side desde el catálogo. (Hoy `crear_pedido` staff
   acepta `adiciones.precio` del cliente — tolerable para staff, vector de
   manipulación en canal público. La versión pública lo prohíbe.)
8. `pide` es un **canal canónico nuevo**: se agrega al dominio de canales con
   CHECK server-side (hoy `canal` es texto libre y el enum del front —
   WhatsApp/Instagram/Rappi/Directo — no lo incluye). Nada de colarlo como
   string silencioso.

## 4. Contrato de entrada (`p jsonb`)

```jsonc
{
  "canal": "pide",                     // canal directo; habilita precio por canal
  "telefono": "3015550123",            // opcional; se normaliza server-side
  "items": [
    {
      "product_id": "PRD-0012",        // caja x6
      "cantidad": 1,
      "slots": [                        // configurador: SIN texto libre
        { "figura_id": "FIG-GATO", "sabor_id": "SAB-AREQ" },
        { "figura_id": "FIG-OSO",  "sabor_id": "SAB-CHOC" }
        // … exactamente los slots que el producto exige
      ]
    }
  ],
  "zona_id": "ZONA-CHAPINERO",
  "franja_id": "FRJ-SAB-AM",
  "fecha_entrega": "2026-07-25",       // ola 3: regalos programados / drops
  "beneficio": { "auto": true },        // busca beneficio vigente por teléfono
  "atribucion": {                       // ola 1: se sella en la quote y viaja al pedido
    "utm_source": "meta", "utm_campaign": "...", "utm_content": "...",
    "campaign_id": "CMP-...", "creative_id": "CRE-...",
    "cupon": null, "referido": null, "landing": "/caja-x6", "qr": "QR-RAPPI-07"
  }
}
```

## 5. Validaciones (todas server-side, en orden)

| # | Validación | Verdad consultada |
|---|------------|-------------------|
| 1 | Producto activo y habilitado para el canal | catálogo canónico (`products`, precio por canal) |
| 2 | Slots completos y canónicos (figura+sabor válidos para el producto) | dominio canónico (guardas `_momos_*` existentes) |
| 3 | Cobertura: zona existe y activa | tabla `zonas` (fuente única de tarifa) |
| 4 | Franja/fecha con capacidad disponible | capacidad operativa (colchón/sugerencias de producción) |
| 5 | Mínimo de pedido del canal | configuración |
| 6 | Beneficio: vigente, no usado, mínimo cumplido | `benefits` (`estado`, `vence`, `minimo`, `pedido_uso IS NULL`) |
| 7 | Disponibilidad/stock vendible del día | inventario terminado + capacidad |

## 6. Contrato de salida

```jsonc
{
  "ok": true,
  "quote_id": "QTE-2026-000123",
  "version": 1,
  "vence_at": "2026-07-21T14:32:00-05:00",   // 10–15 min
  "moneda": "COP",
  "lineas": [
    { "tipo": "producto",  "product_id": "PRD-0012", "detalle_slots": [],
      "cantidad": 1, "precio_unit": 48000, "total": 48000 },
    { "tipo": "beneficio", "benefit_id": "BEN-SINT-01", "producto_gratis_id": "PRD-MALT-AREQ",
      "descripcion": "Malteada de regalo", "total": 0 },
    { "tipo": "empaque",   "total": 3000 },
    { "tipo": "domicilio", "zona_id": "ZONA-CHAPINERO", "total": 6000 }
  ],
  "total": 57000,
  "advertencias": []                            // p. ej. CAPACIDAD_AJUSTADA
}
```

Errores tipificados (`ok:false`, `error`): `PRODUCTO_NO_DISPONIBLE`,
`SLOTS_INVALIDOS`, `FUERA_DE_COBERTURA`, `SIN_CAPACIDAD_FRANJA`,
`MINIMO_NO_ALCANZADO`, `BENEFICIO_NO_VIGENTE`, `QUOTE_RATE_LIMIT`.

**Demanda insatisfecha (ola 5):** `FUERA_DE_COBERTURA` y `SIN_CAPACIDAD_FRANJA`
se registran agregados (zona/franja/fecha, sin PII) — el mapa de expansión se
decide con estos datos.

## 7. Relación con el resto del flujo

- **Menú público sincronizado con productos activos de OPS (requisito de Jorge,
  2026-07-21)**: el menú de Pide NO es una copia — es una proyección de la misma
  tabla `products`. Verificado vivo: `shop_catalogo` = `SELECT id, nombre, cat,
  tipo, especie, precio, descr, foto_path, alergenos, combo_size FROM products
  WHERE activo` (sin costos ni márgenes; `set_producto_activo` en OPS lo
  enciende/apaga sin sincronización manual). Extensiones para `catalogo_publico_v1`:
  filtrar además por canal `pide` habilitado y por disponibilidad real ("lo que
  OPS no puede vender, no se muestra") y exponer precio por canal. El menú
  cacheado en CDN puede quedar desfasado segundos/minutos (TTL corto o
  invalidación por evento de catálogo) y eso es ACEPTABLE porque la autoridad es
  la cotización: un menú viejo jamás vende un producto apagado — la validación
  #1 responde `PRODUCTO_NO_DISPONIBLE`.

- `reservar_checkout_v1` (spec aparte): toma una quote vigente y crea la reserva
  `Temporal` con `expira` (ganchos ya en schema; el propio `rpc-pedidos-v1.sql`
  declara el hold "fuera de v1" — es construcción nueva, no reuso). **Restricción
  dura**: el hold pre-pago debe tomar locks en el MISMO orden canónico del FIFO
  (`products` → `lote_figuras`) y convivir con `_asignar_variante_fifo`, que hoy
  asigna variante exacta al PAGAR — de lo contrario, interbloqueo o sobreventa
  en concurrencia. Al pagar se confirma, al vencer se libera sola (job/cron).
- `crear_pedido_publico_v1` (spec aparte): exige `quote_id` vigente, re-valida,
  y envuelve el `crear_pedido(p jsonb)` existente (transaccional, con
  `orders.idempotency_key` UNIQUE — pero con llave **UUID v4 validada por
  servidor**, como las mutaciones delta; el `'ui-'+random` del staff no alcanza
  para un canal público). Sella la atribución de la quote en el pedido y marca
  `benefits.pedido_uso`.
- **Gates de pago por canal**: hoy la transición a `Pagado` exige evidencia
  fotográfica de comprobante para canal ≠ Rappi. Para el canal `pide` con
  pasarela, la evidencia ES el evento firmado e idempotente del webhook
  (`payment_events`) — los gates de `set_order_status` se extienden por canal,
  no se puentean.
- Fidelización (decidido 2026-07-21): beneficio = producto de regalo por activar
  cuenta post-entrega; el QR de marketplace entra por `atribucion.qr`.

## 8. Seguridad y gobernanza

- RPC `SECURITY DEFINER` de lista cerrada para rol `anon`; RLS estricta.
- Rate limit por IP/teléfono contra scraping de precios y enumeración.
- La quote no contiene costos internos, márgenes ni identificadores de otros
  clientes. El teléfono solo se usa para buscar beneficio propio.
- Los agentes (MCP Claude/Codex) ven demanda AGREGADA vía snapshots; nunca
  cotizaciones individuales con teléfono.

## 9. Pendientes de diseño (no bloquean esta spec)

- Modelo de capacidad por franja (hoy: colchón por producto; falta ventana por fecha).
- Persistencia de quotes: tabla `quotes` nueva (retención corta) vs jsonb efímero firmado.
- Pasarela de pago (webhook firmado idempotente) — spec propia en Fase B.
- Disparador de emisión del beneficio al activar cuenta (hoy `activar_beneficio_cliente`
  es staff-only; falta el gatillo automático post-activación) — spec de fidelización.
- Revisión de seguridad: `shop_mis_pedidos`/`shop_mis_items` tienen grant a `anon`
  en la base viva cuando el diseño dice solo `authenticated` (el filtro por
  `current_customer_id()` protege las filas, pero el grant sobra).
