# Piloto comercial controlado de MOMO OPS

## Resultado que protege H102

H102 prepara una muestra cerrada de pedidos reales ya pagados para observar el
recorrido comercial de punta a punta y conciliar su resultado. No crea pedidos,
no cobra, no abre checkout, no publica contenido, no enciende pauta y no cambia
el estado operativo de un pedido. Los equipos continúan usando las RPC y paneles
canónicos de MOMO OPS.

El piloto real sigue pendiente hasta que el equipo decida una fecha, una muestra
y responsables. Aplicar la migración o ejecutar su prueba adversarial no inicia
ese piloto.

## Requisitos antes de preparar Producción

- release exacta desplegada y restaurable;
- Centro de Salud fuera de solo lectura;
- certificados vigentes de resiliencia y recuperación integral;
- cero incidentes abiertos o confirmados de severidad Alta o Crítica;
- ventana máxima de siete días, entre 1 y 20 pedidos y tope máximo por pedido;
- responsables presentes para Producto, Operaciones, Finanzas y Seguridad y
  Privacidad;
- soporte operativo disponible durante toda la ventana.

## Secuencia humana

1. Administración prepara el contrato con
   `preparar_piloto_comercial_v1`. En Producción debe escribir exactamente
   `PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO`.
2. Las cuatro áreas revisan alcance y firman con evidencia cerrada:
   `SCOPE_APPROVED`, `ROLES_TRAINED`, `CLOSE_READY` y `PRIVACY_REVIEWED`.
3. Administración inicia con versión vigente y la confirmación
   `INICIAR_PILOTO_CERRADO_PRODUCCION`. El servidor vuelve a comprobar salud,
   resiliencia, recuperación e incidentes.
4. Recepción vincula únicamente pedidos ya pagados mediante una UUID de
   idempotencia durable. H102 no modifica el pedido ni su pago.
5. Cada área ejecuta el pedido normalmente en MOMO OPS.
6. Al llegar a Entregado, Cancelado o Reclamo resuelto, Caja/Coordinación
   concilia evidencias, empaque, relevo, entrega, reclamos y margen canónico.
7. Administración cierra solo cuando la muestra exacta está completa y todos
   sus pedidos están conciliados. El servidor sella el resultado por SHA-256.

## Criterios de aborto

Se aborta ante solo lectura, pérdida de una certificación, incidente crítico,
descuadre de dinero/inventario/evidencia, indisponibilidad del responsable o una
desviación de la muestra. La confirmación es
`ABORTAR_PILOTO_SIN_REVERTIR_PEDIDOS`: abortar el estudio nunca cancela ni
revierte los pedidos de clientes.

## Privacidad y evidencia

Las tablas son privadas incluso para `authenticated` y `service_role`; el panel
consume únicamente el snapshot compacto. Las respuestas no incluyen nombre,
teléfono, dirección, correo, notas libres, rutas de Storage ni secretos. La
evidencia reproducible es la migración, su prueba adversarial con rollback, la
cadena 01–102, el recibo sanitario
`H102-STAGING-COMMERCIAL-PILOT-CONTROL-2026-07-22.json` y, cuando ocurra el
piloto real, el acta humana final.

## Lo que todavía no certifica

H102 no certifica checkout público, webhook de pago, antifraude, tráfico alto
sostenido ni conversión de Pide MOMOS. Es el control para ejecutar una muestra
real sin confundir código instalado con operación ya realizada.
