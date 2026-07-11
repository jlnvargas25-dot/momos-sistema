# EMBAJADORES — blueprint del programa de referidos (destilado 2026-07-10)

> Capa de CRECIMIENTO sobre Pide MOMOS. **Se construye con/después del shop** (ya estaba
> listado como "referidos" en la V2 de [`PIDE-MOMOS.md`](PIDE-MOMOS.md)) — no puede existir
> antes: el enlace `pide.momos.com/r/CODIGO` necesita que el shop exista.
> **La secuencia NO cambia: OPS primero (Fase 1-2), shop MVP, luego esto.**
>
> **Pide MOMOS capta, registra y convierte. MOMOS OPS atribuye, valida, calcula, paga y mide.**

## Reglas no negociables

1. **Comisión (20% inicial) SOLO por cliente NUEVO** llegado por enlace/código dentro de la
   ventana de atribución (7 días inicial). Parametrizable en `commission_rules`, no hardcodear.
2. **Base comisionable = productos netos**: items + adiciones − descuento, SIN domicilio.
   Ya computable: `v_order_totals.ventas − orders.descuento` (el domicilio nunca entra en ventas).
3. La comisión **se aprueba solo tras Entregado sin incidente grave** (reclamo abierto la frena).
4. **La segunda compra (directa, con cuenta) NO vuelve a pagar comisión** — convertir el
   referido en cliente propio ES el corazón del sistema.
5. **El canal de adquisición original del cliente jamás se borra** (primer canal ≠ último canal;
   se guardan ambos).
6. El embajador **jamás ve datos sensibles del cliente** — solo agregados comerciales
   (clics, ventas, comisión, metas).
7. Todo pago sale de una **billetera con estados** (pendiente → validando → aprobada →
   disponible → pagada / anulada), mínimo de retiro ($50.000) y ciclo **quincenal** inicial.

## Qué YA existe (no rehacer — verificado 2026-07-10)

- **`benefits` cubre el reward completo**: `producto_gratis` + `minimo` (50.000) + activación/
  vence + `pedido_uso` + flujo Activo→Reservado→Usado→(Activo al cancelar) ya blindado.
- **Atribución base**: `orders.campaign_id`/`creative_id`/`origen_detalle` ('Referido',
  'Influencer') + `atribucion_web` jsonb (UTM/cupón/landing/referido — PIDE-MOMOS.md) +
  `customers.referido_por` (cohorte cliente-refiere-cliente).
- **Rentabilidad/LTV por embajador es una VISTA**, no dominio nuevo: el COGS congelado por
  pedido + reclamos + recompra ya existen — misma mecánica que `v_campaign_metrics` (POAS).
- **Antifraude base**: la REGLA DURA de merge por teléfono/correo (PIDE-MOMOS.md) + índice por
  teléfono + validación de cliente nuevo contra el historial de `customers`.
- **Invitado primero + oferta de cuenta post-entrega** (PIDE-MOMOS.md) = pasos 2-4 del flujo
  de conversión del referido.

## Lo NUEVO (módulo propio — tablas mínimas)

`ambassadors` (ficha + documento + datos de pago + % comisión + nivel + código; estados:
candidato/activo/pausado/bloqueado/retirado) · `ambassador_links` + `referral_clicks`
(`/r/CODIGO`: fecha primer clic, campaña, contenido origen, dispositivo) ·
`referral_attributions` (primer/último canal, embajador atribuido, ventana, pedido causante,
motivo aprobación/rechazo) · `commission_rules` · `commissions` (estados de la regla 7) ·
`ambassador_wallets` + `ambassador_payouts` (listado a pagar, cuenta destino, comprobante,
responsable) · `ambassador_content` (enlace, alcance, ventas atribuidas, permiso de reúso) ·
`fraud_flags`. **`rewards`/`reward_redemptions`: evaluar REUSAR `benefits` antes de crear
tablas nuevas** (ya modela emisión, vencimiento, mínimo y uso).

## Validación de cliente nuevo (antes de pagar el 20%)

Cruzar teléfono / correo / dirección / medio de pago / pedidos previos / cuentas vinculadas →
bloquea: clientes existentes, autorreferidos, familiares con la misma info, duplicados,
pedidos falsos. `fraud_flags` registra el motivo; el rechazo queda auditado en la atribución.

## Prioridad (fases RELATIVAS al shop, no a las de OPS)

- **F1 del programa**: enlace único + atribución + validación cliente nuevo + comisión 20% +
  saldo + pago manual + registro posterior con beneficio.
- **F2**: panel del embajador (dentro de Pide MOMOS), niveles (Embajador 1-19 / Plus 20-49 /
  Pro 50+, bonos por meta sin subir el % permanente), contenido, antifraude avanzado, LTV.
- **F3**: páginas personalizadas (`pide.momos.com/laura`), pagos automáticos, campañas por
  embajador, ranking, selección automática de mejores creadores.

## Abierto (decidir cuando llegue el shop)

- **Beneficio de activación de cuenta**: la decisión previa decía "$5.000 para tu próxima caja
  desde $50.000"; este análisis propone "malteada gratis desde $50.000". `benefits` soporta
  ambos (`descuento_valor_fijo` vs `producto_gratis`) — elegir al construir el shop.
- % de comisión por nivel y ventana de atribución exacta → viven en `commission_rules`.
- Beneficio del referido NUEVO (además del que recibe el embajador): no regalar descuento
  fuerte en la 1ª compra si además se paga 20% de comisión (doble costo de adquisición).

## Flujo completo

Embajador comparte enlace → cliente entra a Pide MOMOS → se guarda atribución → compra →
OPS valida que sea nuevo → pedido entregado → comisión aprobada → cliente crea cuenta →
recibe beneficio → recompra DIRECTA (sin comisión) → MOMOS retiene al cliente.

---

# Ampliación v2 (2026-07-10, mismo día) — fijos, niveles y ciclo de vida completo

## Ciclo de vida del embajador (nunca activo automático)

Solicitud → Revisión → Aprobado → Activo. Estados completos: **Candidato / En revisión /
Aprobado / Activo / Observación / Suspendido / Bloqueado / Retirado** (supera a los 5 de la v1).
Alta vía página pública **"Sé Embajador MOMOS"** en el shop: cómo funciona, 20%, niveles,
simulador de ingresos, requisitos, condiciones del fijo, FAQ, términos + formulario (datos,
documento, redes, seguidores, tipo de contenido, enlaces, cuenta de pago, aceptación).

## Fijo mensual por TRAMOS de $500.000 — la novedad grande

- **Desbloqueo**: 75 clientes nuevos/mes durante 3 meses consecutivos → tramo 1.
- **Mantenimiento**: ≥ 50 clientes nuevos/mes.
- **Suspensión**: < 50 por 2 meses seguidos → pierde UN tramo · < 30 en un mes → pierde
  un tramo INMEDIATO.
- **Recuperación**: 75/mes durante 2 meses → recupera un tramo.
- **Tramos independientes**: el fijo es la SUMA de tramos ($500k c/u) — se quita de a uno,
  nunca todo de golpe (`fixed_benefit_tranches`).
- **Escalera ANUAL**: el fijo del año siguiente sale del desempeño sostenido
  ($500k → $1M → $1.5M → revisión especial). **Jamás por antigüedad — por valor sostenido.**

## ⚙️ REGLA TÉCNICA CLAVE (no negociable)

**Las reglas NO se escriben en el código.** Umbrales (75/50/30), porcentajes, fijos, ventanas
de atribución y montos viven en un **motor configurable** (`commission_rules`,
`ambassador_levels`, tramos) editable desde OPS sin reconstruir la app. Misma filosofía que
los parámetros calibrables del traficker en `app_settings`.

## Tablas adicionales (sobre las de la v1)

`ambassador_applications` · `ambassador_levels` · `ambassador_campaigns` (enlaces
diferenciados por campaña/contenido) · `fixed_benefit_tranches` ·
`ambassador_monthly_performance` · `ambassador_annual_reviews` ·
`customer_identity_matches` (identidad única del cliente — el corazón del antifraude).

## Rentabilidad por embajador — fórmula completa

Ventas netas − COGS − empaque − comisión − **fijo** − producto para contenido − descuentos −
pasarela − reclamos = **contribución del embajador**. Más: clientes nuevos, recompra, ticket,
LTV, CAC efectivo, % activación de cuenta, % redención del beneficio, tiempo hasta recompra.
(El fijo cambia la ecuación: un embajador con fijo debe justificarlo con margen, no con ventas.)

## Alertas automáticas (candidato natural: el agente escribe en `recommendations`)

A 7 ventas de desbloquear fijo · bajo 50 primer mes · bajo 30 (suspensión inmediata) ·
comisión anómala · posible autorreferido · margen bajo el mínimo · elegible para aumento anual.

## Antifraude ampliado

Teléfono / correo / dirección repetida / tarjeta / dispositivo / múltiples cuentas / uso
coordinado de códigos / clientes viejos posando de nuevos. **No todo se bloquea automático:
los casos dudosos van a REVISIÓN humana** (`customer_identity_matches` + `fraud_flags`).

## Panel del embajador (v2)

Progreso hacia el fijo ("Clientes nuevos: 68 · Meta Pro: 75 · Te faltan: 7 · Fijo: $500.000"),
advertencias de pérdida de fijo, saldo/pagos, panel de CONTENIDO (recursos de marca, mensajes
sugeridos, promos activas) + entrega de publicaciones con autorización de reúso y métricas.

## Fases (ajuste v2)

- **F1**: + solicitudes y aprobación manual (lo demás igual a la v1).
- **F2**: niveles y FIJOS — métricas mensuales, regla 75×3, tramos, suspensiones,
  recuperación, alertas.
- **F3**: escalera anual, contratos Pro, contenido obligatorio, rentabilidad/LTV completos.
