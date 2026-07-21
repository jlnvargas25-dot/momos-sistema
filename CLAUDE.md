# Contexto maestro para Claude — Ecosistema MOMOS

Fecha de consolidación: 2026-07-21.

Este archivo explica la intención de producto y la arquitectura que gobiernan el
repositorio. No reemplaza la evidencia técnica. Antes de afirmar que algo está
operativo, Claude debe comprobar código, migraciones aplicadas, pruebas, estado de
los workers y datos reales. Los documentos principales son:

- `docs/ECOSISTEMA-MOMOS-ROADMAP.md`: gate maestro del producto comercial.
- `PIDE-MOMOS.md`: blueprint funcional del shop público.
- `docs/AGENCIA-MOMOS-ROADMAP.md`: evolución de Agencia y conectores.
- `docs/AGENCIA-CREATIVE-PLAYBOOK.md`: sistema creativo y de aprendizaje.
- `docs/HIGGSFIELD-AUDIT-MOMOS.md`: uso de Higgsfield enfocado en MOMOS.
- `docs/HIGGSFIELD-CONNECTOR.md`: contrato técnico del worker.
- `supabase/migraciones-ordenadas/README.md`: cadena técnica canónica.
- `HANDOFF.md`: historia técnica; cuando difiera del código o la base viva, ganan
  el código, las migraciones aplicadas y las pruebas reproducibles más recientes.

## 1. Idea central

MOMOS está construyendo un sistema operativo comercial completo, no solo una
tienda ni un panel administrativo.

- **Pide MOMOS** captura demanda y vende.
- **MOMO OPS** conserva la verdad y ejecuta la operación.
- **Agencia MOMOS** convierte conocimiento operativo y creativo en crecimiento.
- **Codex o Claude** investigan, razonan, proponen y ayudan a diseñar; no son la
  autoridad sobre dinero, inventario, publicación, clientes ni aprobaciones.
- **Higgsfield/Kling y otros motores** producen activos bajo contratos aprobados.
- **Meta y TikTok** distribuyen contenido y devuelven señales medibles.
- **Supabase** es el punto de encuentro y la fuente de verdad compartida.

El circuito deseado es:

```text
señal operativa y comercial
  -> hipótesis/estrategia
  -> brief, hook, guion y storyboard
  -> referencias aprobadas de Biblioteca MOMOS
  -> preflight y aprobación humana
  -> generación externa
  -> revisión, QA y máster
  -> aprobación de distribución
  -> Meta/TikTok
  -> visita atribuida en Pide MOMOS
  -> cotización, reserva, pago y pedido
  -> producción, lote, empaque y entrega en MOMO OPS
  -> reclamo/reembolso/recompra
  -> ingreso, costo, margen, retención y aprendizaje
  -> fórmula ganadora versionada y nuevas variaciones
```

El resultado no se mide únicamente con vistas o estética. Una fórmula gana cuando
su evidencia combina respuesta creativa, pedidos pagados, margen, recompra,
capacidad real de producción y vigencia del contexto.

## 2. Arquitectura por capas

### Pide MOMOS — experiencia pública

Aplicación independiente, móvil primero, rápida y servida por CDN/edge. Comparte
backend con OPS, pero nunca sus permisos ni sus snapshots internos.

Responsabilidades:

- catálogo público realmente vendible;
- configuración estructurada de figura, sabor, caja y adiciones;
- carrito, zona, tarifa, franja, dirección y disponibilidad;
- cotización autoritativa del servidor;
- reserva temporal con expiración y defensa contra acaparamiento;
- checkout como invitado por defecto;
- pago, confirmación idempotente y recuperación del checkout;
- tracking público mediante token opaco u OTP;
- soporte, cancelación, reclamo y recompra;
- captura de UTM, campaña, anuncio, creativo, post, cupón o referido.

Reglas duras:

1. El navegador nunca decide precio, promoción, stock, cobertura o capacidad.
2. Inventario, pedido y pago existen una sola vez.
3. Doble clic, retry o webhook repetido no duplican efectos.
4. Pide no ve costos, márgenes, otros clientes ni datos operativos privados.
5. La compra solo se considera cerrada cuando reserva, pago y pedido son
   transaccionales o explícitamente conciliables.

Arquitectura objetivo: `apps/shop` y `apps/ops`, paquetes compartidos y un backend
común. Pide no debe convertirse en una copia pública de MOMO OPS.

### MOMO OPS — sistema de registro y ejecución

Es la autoridad para:

- catálogo canónico, productos, presentaciones, figuras y sabores;
- recetas, elaboraciones internas, insumos, costos y rendimiento;
- stock exacto por variante y lote, reservas, vencimientos y descartes;
- pedidos, pagos conocidos, producción, cocina, empaque y logística;
- clientes, beneficios, consentimientos, reclamos y postventa;
- costos congelados, ingresos, margen y conciliación;
- identidad de marca, activos, derechos, aprobaciones y resultados de Agencia;
- roles, auditoría, recibos idempotentes y configuración.

Las mutaciones críticas deben ser RPC/funciones de servidor cerradas. Cada acción
operativa debe aspirar a una sola transacción: validar, bloquear, mutar, crear
recibo idempotente, auditar y responder. Ningún proceso comercial normal debe
requerir editar SQL manualmente.

### Agencia MOMOS — sistema de crecimiento

No es un generador de posts aislado. Es una agencia interna que une:

- verdad de producto y capacidad operativa;
- identidad, tono, claims permitidos y restricciones;
- estrategia, campañas, briefs, hooks, guiones y storyboards;
- biblioteca de producto, empaque, personajes, UGC, manos, locaciones y audio;
- derechos, consentimiento, vigencia y permiso de IA por activo;
- selección de modelo/workflow por toma;
- estimación de costo y autorización humana;
- revisión creativa, continuidad, QA, postproducción y máster;
- calendario, distribución, métricas y atribución;
- experimentos de una variable y fórmulas ganadoras versionadas;
- humanización y comunidad sin testimonios falsos ni exposición de PII.

Codex/Claude funciona como laboratorio creativo y analítico. MOMO OPS conserva el
contrato, la aprobación, el costo, el resultado y la evidencia.

### Capa de agentes — Codex y Claude

Los agentes pueden:

- leer snapshots agregados y contexto creativo gobernado;
- consultar activos aprobados mediante identificadores opacos;
- diagnosticar demanda, stock, margen y rendimiento creativo;
- proponer hipótesis, guiones, variantes, pruebas y siguientes pasos;
- registrar propuestas selladas para revisión humana;
- ayudar a preparar contratos y verificar evidencia.

No pueden por omisión:

- confirmar pagos o reembolsos;
- modificar inventario, pedidos o clientes por texto ambiguo;
- aprobar sus propias propuestas;
- contactar clientes o publicar;
- cambiar presupuesto o campañas;
- recibir SQL libre, `service_role`, secretos o PII innecesaria.

El MCP de Agencia es una superficie semántica de lista cerrada, no acceso general a
la base. Toda ampliación debe mantener mínimo privilegio, idempotencia, auditoría,
redacción de PII y aprobación humana separada.

## 3. Conectores externos

### Higgsfield

La arquitectura correcta no depende de exponer una tool MCP directa de
Higgsfield. MOMO OPS/MCP conserva verdad y aprobación; el CLI/worker privado de
Higgsfield consulta schemas, estima y ejecuta.

Antes de consumir créditos se debe mostrar y sellar:

- modelo y workflow;
- duración, resolución y formato;
- audio;
- referencias exactas y fingerprints;
- prompt final y negativos;
- lente, encuadre, movimiento de cámara e iluminación;
- créditos estimados, conversión a COP, saldo y tope aprobado.

Flujo:

```text
MOMO OPS/Codex prepara -> humano aprueba -> worker toma lease -> Higgsfield genera
-> salida privada con hash -> revisión humana -> QA -> máster -> distribución
```

Una respuesta incierta nunca se reenvía automáticamente. El resultado vuelve como
candidato privado `Por verificar`; no hereda permiso de IA ni de publicación.

Existen dos modos de trabajo:

1. **Concepto nuevo:** Codex/Claude dirige investigación, guion, tomas, referencias,
   modelo y QA. Es el modo para campañas, UGC, personajes y pruebas complejas.
2. **Fórmula aprobada y repetible:** MOMO OPS puede despachar una variación desde un
   contrato versionado sin rediseño creativo completo, pero conserva preflight,
   tope de costo, aprobación y QA.

### Meta

Meta entra primero como fuente privada de lectura y medición:

- cuenta, campaña, conjunto/anuncio y métricas externas;
- gasto, impresiones, alcance, clics y resultados atribuidos por Meta;
- cruce separado con pedidos pagados, margen y recompra de MOMOS;
- snapshots inmutables y diagnósticos no causales;
- experimentos de incrementalidad cuando la muestra lo permita.

Autenticación o heartbeat no autorizan escritura. `ads_read` y
`ads_management` son capacidades distintas. La primera mutación futura debe ser
mínima, reversible, sobre lista blanca, con estado previo sellado, tope, vigencia,
segunda aprobación humana y conciliación posterior. Nunca habilitar publicación,
pausa y presupuesto a la vez.

### TikTok

Debe adoptar el mismo contrato de seguridad:

1. autenticación y health;
2. lectura y conciliación de métricas;
3. creación de borrador o publicación con aprobación explícita;
4. comentarios/comunidad inicialmente en solo lectura;
5. ids externos, idempotencia, lease, respuesta incierta y conciliación;
6. aprendizaje cruzado con pedidos y margen.

No declarar TikTok conectado porque exista un modelo de datos o un token. Hace
falta worker real, health, prueba de lectura, publicación piloto aprobada y retorno
de métricas.

### Otros conectores

- Kling puede operar como motor alternativo por toma.
- El worker FFmpeg normaliza tomas, audio y máster antes de distribuir.
- Pasarela de pago, mensajería y logística deben usar el mismo patrón: secretos en
  runtime privado, contrato sellado, idempotencia, lease, recibo, conciliación y
  tratamiento explícito de incertidumbre.

## 4. Modelo de datos y trazabilidad

La cadena comercial objetivo es:

```text
visit/session
  -> attribution_touchpoint
  -> checkout_session
  -> quote_version
  -> inventory/capacity_reservation
  -> payment_intent
  -> signed_provider_event
  -> order
  -> production/batch/lot consumption
  -> packing verification
  -> delivery handoff
  -> delivered/claim/refund
  -> campaign/creative/post measurement
  -> revenue, margin, retention and repurchase
```

Cada transición debe conservar, según corresponda:

- `trace_id`, `correlation_id` y `causation_id`;
- identificador interno y externo;
- ambiente, versión, actor y fecha del origen;
- clave idempotente;
- snapshot o hash de la verdad utilizada;
- resultado, error tipificado y estado de conciliación;
- evidencia segura sin secretos ni PII innecesaria.

Meta/TikTok reportan atribución de plataforma. MOMO OPS reporta pedido pagado,
ingreso y margen. Las dos lecturas se comparan; no se reemplazan entre sí.

## 5. Roadmap de cierre

### Fase A — Consolidar MOMO OPS

- certificar en la base remota la cadena de migraciones vigente;
- reconciliar datos históricos antes de cambios canónicos destructivos;
- cerrar mutaciones operativas partidas mediante transacciones atómicas;
- centralizar observabilidad, incidentes, SLO y alertas;
- habilitar backups/PITR, RPO/RTO y simulacros de restauración;
- probar concurrencia, última unidad, retries, caídas y carga;
- producir una release limpia, versionada, desplegable y reversible.

### Fase B — Construir la transacción de Pide MOMOS

- contrato comercial y catálogo gobernado;
- endpoints públicos mínimos;
- cotización versionada;
- reserva temporal y capacidad;
- `payments` y `payment_events`;
- webhook firmado e idempotente;
- pedido y confirmación conciliables;
- tracking opaco y recuperación de checkout.

### Fase C — Construir el frontend público

- aplicación separada, móvil primero y accesible;
- caché pública, imágenes responsivas y carga pequeña;
- configurador, carrito, dirección, zona, franja y pago;
- estados de error y conectividad lenta;
- compra E2E desde dispositivo real hasta MOMO OPS.

### Fase D — Cerrar cumplimiento y postventa

- producción limitada por capacidad y disponibilidad real;
- cocina, empaque y logística con relevo y evidencia;
- notificaciones transaccionales;
- entrega fallida, sustitución, cancelación, reclamo, reembolso y contracargo;
- conciliación diaria de pago, pedido, reserva, stock, entrega y contabilidad.

### Fase E — Cerrar crecimiento

- Higgsfield/Kling desde brief hasta máster aprobado;
- Meta y TikTok con lectura real y publicación gobernada;
- `creative_id`, `post_id`, `campaign_id` y UTM de punta a punta;
- retorno automático de métricas sin PII;
- experimento de una variable;
- pedidos, margen y recompra como verdad económica;
- fórmula ganadora versionada y reutilizable.

### Fase F — Humanización y comunidad

- series editoriales con equipo, comunidad, personajes y producto;
- derechos/consentimiento para rostro, voz, manos e historias;
- lectura de comentarios, preguntas, menciones y UGC;
- propuestas de respuesta y briefs, sin respuesta automática;
- medición de conversación significativa, guardados, compartidos, UGC,
  asociación con personajes, visitas, pedidos y recompra.

### Fase G — Certificación comercial

- staging equivalente y rollback probado;
- seguridad y privacidad revisadas independientemente;
- carga sostenida, ráfaga y caos con objetivos fijados antes de probar;
- restauración y conciliación posterior demostradas;
- piloto real controlado y cierre diario sin divergencias;
- manuales, responsables, suplentes y soporte;
- aprobación humana de Producto, Operaciones, Finanzas y Seguridad/Privacidad.

El tráfico alto se certifica después y con datos del pico real. No se deduce porque
el piloto funcione.

## 6. Estado que Claude debe comunicar con precisión

- **MOMO OPS:** desarrollo avanzado y bien probado localmente; no declarar
  comercialmente terminado hasta cerrar despliegue remoto, atomicidad restante,
  observabilidad, recuperación, carga y piloto.
- **Pide MOMOS:** blueprint y contratos preparados; la aplicación pública E2E aún
  debe construirse y certificarse.
- **Agencia MOMOS:** desarrollo avanzado con identidad, biblioteca, briefs,
  aprobación, producción, QA, postproducción y aprendizaje; falta cerrar
  distribución y medición externas reales y simplificar recorridos.
- **MCP MOMOS:** gateway gobernado de lectura/propuestas y aprobación humana; no es
  un administrador universal ni debe autoaprobar.
- **Higgsfield:** worker/CLI y contrato de aprobación preparados; confirmar health,
  modelo, precio y estado real antes de cada ejecución.
- **Meta:** observatorio y conector de lectura/dry-run construidos; verificar
  credenciales, cuenta y lectura viva antes de decir `Conectado`. Escritura sigue
  cerrada salvo autorización futura explícita.
- **TikTok:** planificado; no declarar operativo hasta existir conexión viva,
  worker, conciliación y prueba controlada.

## 7. Principios para futuras implementaciones

1. No duplicar fuentes de verdad entre Pide, OPS, Agencia o plataformas.
2. No usar nombres libres cuando exista una identidad canónica por ID.
3. No confiar en datos sensibles calculados por el cliente.
4. No mezclar aprobación, ejecución, QA y publicación en una sola acción.
5. No reintentar a ciegas una escritura externa incierta.
6. No mover PII a Agencia, MCP, prompts, logs o métricas si no es indispensable.
7. No consumir créditos ni presupuesto sin preflight y aprobación exactos.
8. No declarar causalidad a partir de atribución de plataforma.
9. No declarar una función operativa solo porque existe UI o SQL local.
10. No renumerar migraciones aplicadas; comprobar siempre el último ID real.
11. Preservar cambios existentes del usuario y evitar reescrituras amplias sin
    necesidad.
12. Cada entrega debe indicar qué quedó diseñado, implementado, desplegado,
    validado localmente, validado en staging u operativo.

## 8. Definición breve de éxito

El ecosistema está cerrado cuando una persona descubre un producto disponible,
compra una sola vez, recibe su pedido y puede volver o reclamar; MOMOS produce,
entrega y concilia sin sobreventa ni edición manual; y cada contenido puede
recorrerse desde hipótesis y activo aprobado hasta publicación, pedido pagado,
margen, recompra y aprendizaje, con seguridad, recuperación y aprobación humana.
