# Auditoría transversal del dominio de productos MOMOS

Fecha: 2026-07-20
Alcance: frontend, asistentes, modelos de lectura, reglas de negocio, RPC preparadas y pruebas de regresión.

## Decisión de negocio aplicada

- **Figura física / postre:** Lizi, Momo, Rocco, Teo, Toby, Danna, Max.
- **Sabor:** una dimensión independiente de la figura.
- **Familia o presentación comercial:** Momo Gatito, Momo Perrito, Momo grande, Momo premium. Define precio, reserva y reglas de venta; no es una figura.
- **Caja / combo:** contenedor comercial compuesto por líneas hijas exactas.
- **Elaboración interna:** mousse, ganache, cheesecake y salsas producidas por Cocina.
- **Producto preparado al momento:** crepas, malteadas, granizados, Cuchareable, Cake Momo y Cheesecake Momo; no recibe una figura vendible. Los tres últimos pueden usar Horizontal solo como decoración auxiliar.
- **Figura auxiliar:** Horizontal; visible en Recetario/Configuración únicamente si al menos una preparación compatible está activa. Nunca entra a Pedidos, cajas, lotes principales o inventario terminado.
- **Especie / silueta:** metadato visual; nunca decide inventario, caja, reserva, corrida o creativo.

## Resultado por módulo

| Módulo | Contrato revisado | Resultado |
| --- | --- | --- |
| Pedidos | La selección principal es figura + sabor; la familia aparece como dato comercial secundario. Las cajas validan cada hija por `productId`. | Corregido |
| Productos | “Momos Signature” muestra las siete figuras como tarjetas. El detalle explica familia, precio, costo y stock exacto sin convertirla en postre. | Corregido |
| Producción y Recetario | Corridas y lotes usan figura física, sabor, gramaje y familia exactos. Productos al momento y elaboraciones viven en flujos separados. | Corregido |
| Empaque | La comanda conserva figura y sabor exactos; la caja padre no duplica las hijas. | Corregido |
| Inventario terminado | La promesa vendible nace de figura + sabor + lote vigente. El agregado por familia es solo un resumen. | Corregido |
| Inventario de insumos | Insumos comprados y elaboraciones internas no se presentan como figuras ni como producto terminado. | Corregido |
| Dashboard y asistentes | Alertas y recomendaciones distinguen figura física, familia, preparación y producto al momento. | Corregido |
| CRM y Domicilios | El historial describe lo realmente comprado mediante la línea exacta; no usa la familia como preferencia de figura. | Corregido |
| Beneficios | Una familia que exige figura y sabor no puede regalarse como producto genérico incompleto. | Corregido |
| Agencia MOMOS | Un foco comercial aclara su clase. Para una familia se exige figura y sabor antes de crear un paquete visual o estimar capacidad. | Corregido |
| Finanzas y Reportes | Finanzas consolida líneas cobradas; Reportes separa presentación comercial, figura y sabor sin doble conteo. | Corregido |
| Configuración | Restaura las siete figuras protegidas y muestra Horizontal como auxiliar automática solo cuando corresponde; gato/perro queda como silueta. | Corregido |
| Momobot | El vocabulario y los gates reconocen únicamente las siete figuras; una familia no completa una respuesta de figura. | Corregido |
| Backend H90 | Guards, catálogo canónico y pruebas adversariales están preparados con bloqueo ante datos históricos incompatibles. | Preparado, no desplegado |

## Invariantes auditadas

1. Ninguna cadena libre cuenta como figura si no pertenece al catálogo exacto de siete nombres.
2. Ninguna caja se reserva por especie ni hereda una figura global.
3. Ningún producto al momento puede recibir una figura vendible, stock terminado o lote de desmolde. Horizontal es una decoración auxiliar y no cambia esta regla.
4. Una familia sin figura exacta queda incompleta y bloqueada; no se adivina.
5. El stock agregado de una familia nunca promete una figura o sabor específico.
6. La misma presentación puede respaldar varias figuras sin borrar sus gramajes, recetas o identidades.
7. Los datos históricos sin figura verificable se muestran como legado pendiente; no se reclasifican silenciosamente.
8. Una figura vendible heredada en una malteada, crepa, granizado o cuchareable se ignora en toda lectura operativa; Horizontal se reconoce aparte solo como auxiliar compatible.
9. Si la figura y la familia históricas son incompatibles, la interfaz muestra `Dato por corregir` y no presenta esa relación como exacta.
10. El catálogo operativo falla cerrado: una figura solo entra si su nombre, estado y `productId` coinciden con el mapa canónico de familias.
11. Stock, disponibilidad, reservas, lotes, sugerencias y planes de producción excluyen relaciones incompatibles y las reportan como integridad pendiente.
12. Agencia y Biblioteca no convierten una figura heredada de un producto al momento en sujeto creativo ni la usan para inferir capacidad.
13. Horizontal se activa y desactiva con los productos compatibles; no depende de una acción manual ni sobrevive si todos quedan fuera del menú.

## Cobertura de regresión

- Suite general: **696/696** pruebas aprobadas.
- Suite de rendimiento e integración: **138/138** pruebas aprobadas.
- Build de producción: aprobado.
- La auditoría incluye pedidos, productos, producción, empaque, inventario terminado, inventario de insumos, asistentes, CRM, domicilios, beneficios, Agencia MOMOS, Biblioteca, finanzas, reportes, configuración y Momobot.

## Límite del cierre actual

El frontend, los modelos de lectura y los cálculos operativos ya fallan cerrado. Esto evita mostrar, reservar, prometer o recomendar como válida una relación histórica incorrecta. La protección estructural de las mutaciones en la base se completa únicamente al desplegar H90 después de H89 y de conciliar los registros históricos detectados; por eso esta auditoría no declara todavía el esquema remoto como sellado.

## Estado de despliegue

La corrección de lenguaje y superficies del frontend queda disponible localmente. La migración H90 está deliberadamente fuera de la cadena ordenada hasta completar H89, que cierra las políticas de lectura amplia.

Además, el preflight remoto de H90 encontró un dato histórico que requiere una decisión humana: PR08 conserva 11 unidades agregadas. Horizontal ya no se trata como error por existir: H90 la conserva como auxiliar compartida, elimina cualquier vínculo comercial y deriva su visibilidad del estado activo de Cuchareable, Cake Momo y Cheesecake Momo. No se alteró el stock histórico. El orden seguro es:

1. completar y validar H89;
2. conciliar explícitamente el saldo histórico de PR08;
3. ejecutar H90;
4. ejecutar su prueba adversarial y después la cadena ordenada 01–90.

Hasta entonces, el frontend falla cerrado y muestra el dominio correcto, mientras la base conserva sus datos históricos sin una mutación silenciosa.
