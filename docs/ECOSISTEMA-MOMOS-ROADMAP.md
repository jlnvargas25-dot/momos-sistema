# Roadmap Maestro — Ecosistema MOMOS v1 comercial

> Autoridad transversal para decidir si Pide MOMOS, MOMO OPS, Agencia MOMOS, Codex y los conectores están listos para operar con clientes reales. Este documento valida producto; no reemplaza la cadena técnica de migraciones ni reserva IDs.

**Corte inicial:** 2026-07-19
**Estado global:** En desarrollo avanzado · No listo todavía para lanzamiento comercial público
**Decisión final:** humana, basada en evidencia de todos los gates

## 1. Visión y promesa operativa

El Ecosistema MOMOS v1 estará comercialmente terminado cuando una persona pueda:

1. descubrir un producto realmente disponible;
2. configurarlo y recibir un precio autoritativo;
3. reservarlo, pagarlo una sola vez y obtener confirmación;
4. seguir el pedido sin exponer datos privados;
5. recibirlo, solicitar ayuda o reembolso y volver a comprar;
6. llegar desde una campaña o contenido cuya contribución pueda medirse.

Al mismo tiempo, el equipo MOMOS debe poder:

1. producir, empacar y entregar sin sobreventa ni ambigüedad;
2. conciliar dinero, inventario, pedidos y conectores;
3. resolver fallos sin editar filas manualmente;
4. conocer costo, ingreso, margen y aprendizaje;
5. recuperar el sistema sin pérdida silenciosa;
6. operar mediante permisos, procedimientos y responsables claros.

## 2. Documentos subordinados

- [PIDE-MOMOS.md](../PIDE-MOMOS.md): blueprint funcional del shop público.
- [AGENCIA-MOMOS-ROADMAP.md](AGENCIA-MOMOS-ROADMAP.md): evolución creativa, comunidad, conectores y aprendizaje.
- [AGENCIA-CREATIVE-PLAYBOOK.md](AGENCIA-CREATIVE-PLAYBOOK.md): estándar creativo MOMOS.
- [H64-RENDIMIENTO-E2E.md](H64-RENDIMIENTO-E2E.md): rendimiento, snapshots, carga diferida y telemetría.
- [HANDOFF.md](../HANDOFF.md): estado técnico detallado y decisiones históricas.

En caso de conflicto:

1. la base y migraciones aplicadas deciden hechos técnicos;
2. MOMO OPS decide producto, operación, permisos, costos y resultados;
3. este roadmap decide si el conjunto satisface el cierre comercial;
4. ningún chat, mockup o documento aislado prueba que una capacidad está operativa.

## 3. Estados canónicos

| Estado | Significado | Evidencia mínima |
|---|---|---|
| Backlog | Necesidad reconocida | Alcance y responsable por asignar |
| Diseñado | Contrato y riesgos definidos | Documento y criterios de aceptación |
| Implementado | Código/esquema disponible | Diff y migración versionada si aplica |
| Validado local | Funciona en entorno de desarrollo | Tests, build y evidencia reproducible |
| Validado en staging | Integración completa en ambiente equivalente | E2E, seguridad y observabilidad |
| Piloto real | Usado con alcance controlado | Operaciones conciliadas e incidentes cerrados |
| Operativo | Proceso estable con responsables | SLO, alertas, manual y soporte |
| Certificado para escala | Carga objetivo demostrada | p95/p99, errores, saturación y recuperación |

Una capacidad solo avanza de estado con evidencia enlazada. “Existe la tabla”, “se ve la pantalla”, “el proveedor respondió” o “una prueba salió bien” no equivalen por sí solos a `Operativo`.

## 4. Línea base auditada

| Componente | Estado al corte | Evidencia y brecha principal |
|---|---|---|
| MOMO OPS | En desarrollo avanzado | Operación, trazabilidad, snapshots, Realtime y RBAC construidos; falta consolidación de release y certificación bajo carga |
| Pide MOMOS | Diseñado | Blueprint completo; no existe todavía la aplicación pública E2E |
| Pagos | Diseñado parcialmente | Sellos y campos base; faltan pasarela, tabla/eventos, webhooks, conciliación, reembolsos y contracargos |
| Agencia MOMOS | En desarrollo avanzado | Identidad, briefs, producción, aprobación, QA y aprendizaje; falta simplificar experiencia y cerrar distribución/medición real |
| Codex + MCP | Conectado con guardas | Lectura y propuestas gobernadas; no debe aprobarse a sí mismo ni ejecutar acciones externas por omisión |
| Higgsfield | Conectado parcialmente | Autenticación y generación disponibles; el recorrido aprobado completo debe cerrarse y conciliarse |
| Meta | Por conectar | Modelo, observatorio y dry-run de lectura; faltan credenciales, snapshots vivos y publicación autorizada |
| TikTok | Por conectar | Modelo de distribución; faltan autenticación, worker, publicación/borrador y métricas |
| Rendimiento frontend | Línea base parcial | 23/23 pruebas de rendimiento y build PASS; JS inicial excede levemente el presupuesto y Agencia se acerca a su límite de chunk |
| Seguridad pública | Planificada | Buenas guardas internas; falta superficie pública, revisión independiente y pruebas adversariales del checkout |
| Release engineering | Parcial | Existen suites y migraciones; falta convertir el árbol actual en una versión limpia, reproducible, etiquetada y desplegable |

Esta tabla debe actualizarse después de cada gate; nunca por percepción.

## 5. Gates obligatorios

### Gate 0 — Alcance, autoridad y economía

**Objetivo:** saber exactamente qué vende MOMOS, a quién, dónde, cuándo y bajo qué reglas.

- [ ] Catálogo, variantes, empaques, precios, costos y canales tienen una sola fuente de verdad.
- [ ] Zonas, tarifas, horarios, mínimos, franjas y capacidad están versionados.
- [ ] Margen mínimo, descuentos, promociones y excepciones tienen dueño y límites.
- [ ] Políticas de cancelación, reembolso, reclamo, entrega fallida y sustitución están aprobadas.
- [ ] Roles de precio, inventario, pago, publicación, soporte y devolución están separados.
- [ ] Objetivos comerciales, SLO y pico inicial esperado están declarados antes de las pruebas.
- [ ] V1 y post-V1 están separados para impedir crecimiento infinito del alcance.

**Evidencia de cierre:** contrato comercial aprobado, catálogo gobernado y matriz RACI/roles.

### Gate 1 — Integridad técnica y release reproducible

**Objetivo:** desplegar la misma versión de forma segura y repetible.

- [ ] Worktree de release limpio y cambios ajenos preservados/consolidados.
- [ ] Cadena de migraciones canónica, ordenada, idempotente y validada.
- [ ] Desarrollo, staging y producción usan proyectos, dominios y secretos separados.
- [ ] CI ejecuta tests, build, lint/format aplicable, chequeo SQL, seguridad y presupuesto de rendimiento.
- [ ] Versiones, tags, changelog, feature flags y rollback están definidos.
- [ ] Configuración y secretos no dependen de una máquina personal.
- [ ] Datos semilla y fixtures no pueden confundirse con datos reales.
- [ ] Dependencias críticas tienen política de actualización y rollback.

**Evidencia de cierre:** release candidate desplegado desde cero en staging y rollback probado.

### Gate 2 — Pide MOMOS y compra E2E

**Objetivo:** cerrar el recorrido público sin confiar en el navegador.

- [ ] Aplicación separada `shop`, optimizada para móvil, CDN y caché pública.
- [ ] Catálogo, detalle, configurador, carrito, zona, dirección y franja.
- [ ] Cotización autoritativa y versionada en servidor.
- [ ] Reserva temporal con expiración efectiva y cuota antiacaparamiento.
- [ ] Checkout como invitado; cuenta opcional después de la experiencia definida.
- [ ] Pedido único mediante idempotencia aun con doble clic o reintento.
- [ ] Estado público simplificado y tracking con token opaco/OTP.
- [ ] Recuperación segura de checkout interrumpido.
- [ ] Accesibilidad, teclado, lector de pantalla, contraste y conectividad lenta validados.
- [ ] SEO, metadatos, imágenes responsivas y enlaces compartibles donde corresponda.

**Evidencia de cierre:** E2E automatizado y compra piloto desde dispositivo real hasta pedido visible en OPS.

### Gate 3 — Pagos, dinero y conciliación

**Objetivo:** que cada peso pueda explicarse y ningún retry duplique efectos.

- [ ] Pasarela elegida mediante criterios de cobertura, costo, soporte y conciliación.
- [ ] Checkout alojado o tokenizado; MOMOS no almacena datos de tarjeta.
- [ ] `payments` y `payment_events` separan intención, intento, confirmación, rechazo, reverso y reembolso.
- [ ] Webhooks verifican firma, timestamp, ambiente, cuenta, moneda, monto y replay.
- [ ] Identificador externo único e idempotencia por evento del proveedor.
- [ ] Pago confirmado activa reserva/pedido de forma transaccional o conciliable.
- [ ] Comisiones, descuentos, domicilio, ingresos y margen usan snapshots.
- [ ] Reembolsos, reversos y contracargos tienen flujo, permisos y evidencia.
- [ ] Cierre diario compara pasarela, pagos, pedidos e ingresos.
- [ ] Excepciones `pago sin pedido`, `pedido sin pago` y `monto divergente` generan alerta y bandeja.

**Evidencia de cierre:** conciliación exacta de todos los escenarios sandbox y piloto real controlado.

### Gate 4 — Operación, entrega y postventa

**Objetivo:** cumplir la promesa después del pago.

- [ ] Inventario por variante/lote, reserva, consumo, liberación y vencimiento coherentes.
- [ ] Capacidad de producción, empaque, entrega y franja limita la venta.
- [ ] Cocina recibe solo pedidos autorizados para preparar.
- [ ] Empaque y handoff logístico conservan evidencia y responsables.
- [ ] Entrega, demora, mensajero cancelado y dirección problemática tienen contingencia.
- [ ] Reclamos, compensaciones, cancelaciones y reembolsos están vinculados al pedido.
- [ ] MomoBot puede ayudar sin escribir por ambigüedad y siempre escala a una persona.
- [ ] Operadores resuelven incidentes mediante UI/RPC, nunca editando SQL.
- [ ] Apertura, cierre, cambio de turno y caída de proveedor tienen procedimientos.

**Evidencia de cierre:** simulacro completo y piloto real conciliado hasta entrega/postventa.

### Gate 5 — Agencia, distribución y aprendizaje comercial

**Objetivo:** convertir operación y creatividad en crecimiento medible.

- [ ] Inicio Ejecutivo y flujos guiados simplifican creación, aprobación, publicación y análisis.
- [ ] Biblioteca conserva producto, empaque, personajes, UGC, manos, locaciones, audio, derechos y consentimiento.
- [ ] Codex formula hipótesis, ángulos y variantes; MOMO OPS sigue siendo fuente de verdad.
- [ ] Higgsfield recibe únicamente paquetes y preflights aprobados; costo y resultado regresan al ledger.
- [ ] Máster, QA, publicación y pauta tienen aprobaciones separadas.
- [ ] Meta y TikTok cuentan con autenticación, health, idempotencia y conciliación.
- [ ] Cada publicación conserva IDs externos y vínculo con campaña/creativo.
- [ ] Métricas regresan automáticamente sin PII y se vinculan con pedidos pagados, margen y recompra.
- [ ] Experimentos cambian una sola variable y requieren muestra/decisión humana.
- [ ] Fórmulas ganadoras guardan elementos fijos, variables, restricciones, evidencia y vigencia.
- [ ] Humanización y comunidad distinguen personas reales, actores, personajes y contenido sintético.

**Evidencia de cierre:** campaña piloto completa desde brief hasta aprendizaje económico aprobado.

### Gate 6 — Seguridad, privacidad y abuso

**Objetivo:** abrir una superficie pública sin comprometer clientes, dinero ni operación.

- [ ] Shop y OPS tienen roles, sesiones, RLS, dominios y permisos independientes.
- [ ] El público no escribe tablas core; usa funciones/RPC de lista cerrada.
- [ ] Precio, inventario, promoción, zona y capacidad se recalculan en servidor.
- [ ] Funciones privilegiadas usan mínimo privilegio, `search_path` cerrado y grants explícitos.
- [ ] Secretos no aparecen en `VITE_*`, bundles, Storage público, logs, errores o MCP.
- [ ] Rate limiting y protección de bots cubren catálogo costoso, cotización, reserva, pago, tracking y OTP.
- [ ] CSP, HSTS, CORS allowlist, protección de framing, validación de origen y CSRF aplicable.
- [ ] Entradas y contenido de terceros usan esquemas, límites y escape seguro.
- [ ] Tracking impide enumerar pedidos o confirmar existencia de clientes.
- [ ] Archivos privados usan URLs firmadas y validación real de MIME/tamaño/hash.
- [ ] PII se minimiza, redacta en observabilidad y conserva según finalidad/retención aprobada.
- [ ] Consentimiento comercial, creativo y de IA permanece separado y revocable.
- [ ] Escaneo de dependencias, secretos y vulnerabilidades bloquea hallazgos críticos.
- [ ] Alertas cubren replay, fraude, exceso de reservas, elevación de privilegios y divergencias.
- [ ] Revisión independiente y procedimiento de respuesta a incidentes completados.
- [ ] Revisión profesional de privacidad, comercio y pagos antes de producción.

**Evidencia de cierre:** threat model, suite adversarial, hallazgos críticos cerrados y aprobación independiente.

### Gate 7 — Rendimiento, resiliencia y observabilidad

**Objetivo:** demostrar capacidad y recuperación, no inferirlas del diseño.

- [ ] Pide usa CDN/edge, caché versionada y endpoints públicos pequeños.
- [ ] Consultas transaccionales tienen índices justificados con `EXPLAIN (ANALYZE, BUFFERS)`.
- [ ] Connection pooling, timeouts, circuit breakers y backpressure están configurados.
- [ ] Webhooks, notificaciones, expiraciones y conectores usan colas, leases, backoff y dead-letter.
- [ ] Frontends cumplen presupuestos de bundle, imágenes, interacción y solicitudes iniciales.
- [ ] Métricas p50/p95/p99, error, saturación, concurrencia y colas usan `trace_id` sin PII.
- [ ] Dashboard diferencia frontend, función, base, Storage, pago, logística y conector.
- [ ] SLO y presupuesto de error existen para catálogo, cotización, reserva, pago, pedido y tracking.
- [ ] Backups, restauración, RPO, RTO y contingencias están documentados y probados.
- [ ] Carga sostenida, ráfaga y carrera por última unidad pasan con volumen representativo.
- [ ] Caídas parciales se concilian sin doble cobro, pedido duplicado, sobreventa o pérdida silenciosa.

**Evidencia de cierre:** informe de carga firmado, SLO cumplidos y restauración/caos controlado aprobado.

### Gate 8 — Preparación comercial y lanzamiento

**Objetivo:** convertir software validado en una operación comercial sostenible.

- [ ] Manuales por rol, entrenamiento y simulacros completados.
- [ ] Horarios, zonas, canales de soporte y tiempos de respuesta publicados.
- [ ] FAQ, mensajes transaccionales, errores y comunicaciones de contingencia aprobados.
- [ ] Términos, privacidad, cancelaciones, devoluciones y tratamiento de datos revisados profesionalmente.
- [ ] Analítica de producto mide embudo, abandono, pago, entrega, soporte y recompra.
- [ ] Finanzas puede cerrar ventas, comisiones, devoluciones, costos y margen.
- [ ] Propietarios y suplentes definidos para operación, tecnología, pagos, seguridad y marketing.
- [ ] Piloto cerrado completa la muestra y ventana acordadas antes de abrir tráfico.
- [ ] Incidentes del piloto están corregidos o aceptados explícitamente con mitigación.
- [ ] Checklist final firmado por Producto, Operaciones, Finanzas y Seguridad/Privacidad.

**Evidencia de cierre:** acta humana de lanzamiento y release estable desplegado.

## 6. Trazabilidad canónica

La cadena objetivo es:

```text
visit/session
  → attribution touchpoint
  → checkout session
  → quote version
  → inventory/capacity reservation
  → payment intent
  → signed provider event
  → order
  → production and lot consumption
  → packing verification
  → delivery handoff
  → delivered/claim/refund
  → campaign/creative/post measurement
  → margin and repurchase
```

Cada transición conserva como mínimo:

- `trace_id`, `correlation_id`, `causation_id`;
- identificador interno y, cuando exista, externo;
- tipo de evento, versión y fecha del origen;
- actor/sistema y ambiente;
- clave idempotente;
- snapshot o hash de la verdad usada;
- resultado, error tipificado y estado de conciliación;
- enlace a evidencia sin incluir secretos ni PII innecesaria.

## 7. Pruebas obligatorias de aceptación

### Transacción y concurrencia

- doble clic y retry de red;
- dos webhooks iguales y eventos fuera de orden;
- muchas sesiones intentando la última unidad;
- reserva expirada durante pago;
- pago confirmado después de expiración;
- timeout antes y después de una posible escritura;
- precio/promoción/stock alterados desde el navegador;
- caída entre pago y creación del pedido.

### Seguridad y privacidad

- bypass de RLS/RBAC y funciones privilegiadas;
- enumeración de pedido, cliente, token y OTP;
- replay y firma inválida de webhook;
- abuso de reserva, login, tracking y archivos;
- XSS, CSRF aplicable, CORS, framing y exposición de secretos;
- PII en logs, telemetría, MCP, errores y analítica;
- acceso después de revocación o vencimiento de consentimiento.

### Operación y recuperación

- mensajero cancela, zona inválida y franja saturada;
- producto agotado o vencido después de cotizar;
- reembolso parcial/total y contracargo;
- caída de pasarela, función, cola, worker, Storage y Realtime;
- restauración desde backup y conciliación de eventos posteriores;
- cierre de turno con excepciones pendientes.

### Rendimiento

- catálogo cacheado y no cacheado;
- cotización, reserva, pago, pedido y tracking;
- apertura de paneles internos durante tráfico público;
- ráfaga, carga sostenida y recuperación;
- volumen histórico representativo en pedidos, eventos, auditoría y métricas.

Los objetivos numéricos se aprueban antes de ejecutar las pruebas. No se cambian después para hacer pasar el resultado.

## 8. Bloqueadores absolutos de lanzamiento

El ecosistema no puede declararse terminado si ocurre cualquiera de estos casos:

- Pide MOMOS sigue siendo blueprint o mockup.
- Un flujo principal requiere SQL manual.
- Pago, pedido, reserva o inventario pueden divergir sin alerta/conciliación.
- Existe riesgo conocido de doble cobro, doble pedido o sobreventa.
- El tracking permite enumerar pedidos o exponer PII.
- Hay secretos en cliente, repositorio, logs o MCP.
- Meta/TikTok/Higgsfield se consideran cerrados solo porque autenticaron.
- No existe staging equivalente o rollback probado.
- No existe soporte para reclamos, reembolsos y fallos parciales.
- No se ha ejecutado piloto real controlado.
- No se han probado carga, seguridad y restauración.
- Hay hallazgos críticos abiertos o responsables sin asignar.
- La evidencia vive únicamente en conversaciones o memoria del equipo.

## 9. Fuera del bloqueo de V1

Estas capacidades pueden llegar después del lanzamiento si no comprometen el recorrido principal:

- puntos/VIP y gamificación;
- suscripciones;
- recuperación avanzada de carrito;
- recomendaciones personalizadas complejas;
- app móvil nativa;
- marketplace o múltiples marcas;
- publicación o inversión autónoma;
- voz/avatar avanzado para todos los flujos;
- expansión geográfica y múltiples sedes, salvo que ya formen parte del lanzamiento.

Cada capacidad post-V1 conserva seguridad, trazabilidad y gates propios.

## 10. Secuencia de ejecución recomendada

1. **Consolidar la base:** release reproducible, migraciones, ambientes y observabilidad mínima.
2. **Construir la transacción:** Pide, cotización, reserva, pago, webhook, pedido y tracking.
3. **Cerrar el cumplimiento:** capacidad, producción, empaque, entrega, soporte y reembolsos.
4. **Cerrar crecimiento:** Higgsfield, Meta/TikTok, publicación, métricas, atribución y aprendizaje.
5. **Endurecer:** seguridad, privacidad, abuso, carga, recuperación y revisión independiente.
6. **Pilotar:** usuarios/pedidos reales con alcance controlado, soporte presente y conciliación diaria.
7. **Lanzar:** aprobación humana y despliegue gradual con feature flags y límites.
8. **Certificar escala:** aumentar tráfico únicamente después de observar SLO y capacidad real.

## 11. Definición de terminado

### Ecosistema MOMOS v1 comercialmente terminado

Se declara únicamente cuando:

- todos los Gates 0–8 están `Operativo` o cuentan con excepción humana documentada que no compromete seguridad, dinero, inventario, privacidad ni recorrido principal;
- no existen bloqueadores absolutos;
- el piloto real fue conciliado de punta a punta;
- Producto, Operaciones, Finanzas y Seguridad/Privacidad firman el lanzamiento;
- existe una release estable, restaurable y monitoreada;
- el cliente puede completar el recorrido sin intervención técnica.

### Certificado para tráfico alto

Es una decisión posterior y separada. Requiere pico real esperado, volumen histórico, prueba al múltiplo acordado, p95/p99, error, saturación, capacidad operativa y recuperación demostrados. Nunca se deduce solo porque el sistema funciona con pocos usuarios.

## 12. Mantenimiento del roadmap

- Actualizar el corte y la tabla de línea base después de cada gate.
- Enlazar evidencia reproducible: tests, reportes, dashboards, decisiones y runbooks.
- No marcar una casilla por código sin despliegue o por despliegue sin operación.
- No renumerar migraciones aplicadas ni reservar IDs desde este documento.
- Toda excepción indica propietario, riesgo, mitigación, vencimiento y criterio de cierre.
- Toda decisión de lanzamiento o escala queda firmada y fechada por una persona.
