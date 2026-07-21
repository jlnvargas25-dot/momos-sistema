# Modelo canónico de productos MOMOS

Este contrato evita que MOMO OPS confunda lo que se vende con lo que Cocina fabrica.

## Vocabulario único

| Concepto | Valores | Uso |
| --- | --- | --- |
| Figura física / postre | Lizi, Momo, Rocco, Teo, Toby, Danna, Max | Producción, inventario terminado, comanda y empaque |
| Sabor | Coco, Oreo, Limón, Milo, etc. | Variante de la figura; nunca reemplaza la figura |
| Familia o presentación comercial | Momo Gatito, Momo Perrito, Momo grande, Momo premium | Precio, disponibilidad agregada, menú y reserva |
| Caja / combo | Caja x3, x4, x6 | Contenedor comercial con hijas exactas |
| Preparación interna | Mousse, ganache, cheesecake y salsas | Elaboración de Cocina; no se compra ni se vende como figura |
| Producto al momento | Crepa, malteada, granizado, Cuchareable, Cake Momo y Cheesecake Momo | Línea vendible independiente; puede usar decoración auxiliar sin convertirla en variante |
| Figura auxiliar | Horizontal | Decoración de Cuchareable, Cake Momo o Cheesecake Momo; nunca se vende, reserva ni contabiliza como figura terminada |

`especie` (gato/perro) es únicamente metadato visual. Nunca decide inventario, reserva, composición de una caja ni una corrida.

## Relación canónica

Cada figura activa tiene un `productId` que apunta a su familia comercial. Esa relación es la única que puede:

- decidir si la figura está permitida en una caja;
- descontar o reservar la variante exacta;
- agrupar inventario terminado;
- crear una corrida de Producción;
- definir el sujeto exacto de un creativo o una campaña.

Si falta el vínculo, el sistema debe bloquear y pedir corrección. No puede adivinar por especie, nombre parecido ni posición en una lista.

### Mapa exacto vigente

| Familia comercial | Figuras físicas permitidas |
| --- | --- |
| Momo Gatito (`PR01`) | Lizi, Momo, Toby |
| Momo Perrito (`PR02`) | Max, Rocco, Danna |
| Momo premium (`PR04`) | Teo |
| Momo grande (`PR03`) | Sin figura canónica activa hasta que el negocio defina y migre una relación explícita |

Una figura con el nombre correcto pero enlazada a otra familia también es un dato inválido. Debe quedar fuera del stock prometible, de las cajas, de las corridas y de los creativos hasta su conciliación.

## Presentación por módulo

- **Pedidos, Cocina y Empaque:** figura + sabor primero; familia comercial como dato secundario.
- **Productos:** las tarjetas de “Momos Signature” son las siete figuras físicas. Al abrir una figura se muestra, como dato secundario, la familia comercial que define precio y reserva; las fichas y recetas se gestionan en Producción.
- **Producción:** corrida para el plan; lote para el registro físico. Todo lote muestra figura, sabor y familia.
- **Recetario de Cocina:** Horizontal aparece como decoración auxiliar solo mientras exista al menos un Cuchareable, Cake Momo o Cheesecake Momo activo. Al desactivar los tres, desaparece automáticamente.
- **Inventario terminado:** saldo exacto por figura y sabor; el agregado por familia nunca se presenta como variante disponible.
- **Domicilios y CRM:** describen la compra exacta sin duplicar el padre de una caja ni mezclar preferencia declarada con historial real.
- **Beneficios:** un regalo genérico no puede ser una familia que necesite figura y sabor.
- **Agencia MOMOS:** el foco debe decir si es postre, presentación comercial, combo o producto al momento; para una familia exige figura y sabor exactos antes de producir contenido.
- **Finanzas y Reportes:** ventas por presentación comercial; análisis de demanda por figura y sabor, sin doble contar cajas e hijas.

## Invariantes

1. Una caja padre no entra a Cocina como una figura.
2. Sus hijas sí entran, cada una con figura, sabor y familia compatible.
3. Teo no puede entrar en una caja que solo permite Momo Gatito aunque ambos sean gatos.
4. Un stock agregado de Momo Perrito no promete automáticamente Max de Oreo.
5. Una familia sin figura exacta se muestra como incompleta y no se registra silenciosamente.
6. Los nombres Gatito, Perrito, Osito o Corazón no son figuras operativas.
7. Las siete figuras canónicas son la fuente de verdad para voz, Cocina, inventario terminado, CRM y Agencia.
8. Horizontal nunca puede aparecer en Pedidos, cajas, corridas de figuras o inventario terminado; su visibilidad depende exclusivamente de preparaciones compatibles activas.

## Nota de implementación

La tabla histórica `products` todavía conserva algunas familias comerciales porque allí viven precio, costo, disponibilidad agregada y reglas de venta. Eso no convierte a “Momo Gatito” o “Momo Perrito” en figuras físicas. La interfaz y las RPC deben traducir siempre esa estructura heredada al vocabulario canónico anterior y fallar cerrado cuando falte `figuras.product_id`.
