# H104 · Piloto comercial controlado en Configuración

H104 convierte el contrato seguro de H102 en una pantalla operable por personas dentro de MOMO OPS. El panel vive en **Configuración → Piloto comercial controlado** y conserva el mismo lenguaje visual del resto del sistema.

## Qué permite

- Preparar una muestra cerrada de 1 a 20 pedidos.
- Obtener las cuatro aprobaciones responsables: Producto, Operaciones, Finanzas y Seguridad/Privacidad.
- Iniciar la ventana autorizada con confirmación humana.
- Vincular únicamente identificadores de pedidos que el servidor confirma como pagados, operables y bajo el tope.
- Conciliar el resultado de cada pedido y cerrar el piloto con un acta JSON sin PII.
- Abortar sin revertir ni alterar los pedidos reales.

## Qué nunca hace

- No crea pedidos sintéticos ni reales.
- No cambia el estado de un pedido.
- No cobra, publica, invierte ni abre tráfico de Pide MOMOS.
- No expone teléfonos, direcciones, nombres, notas, secretos, actores ni códigos internos de evidencia.
- No activa automáticamente el piloto al preparar la muestra.

## Orden de despliegue

1. H102 · `piloto-comercial-controlado-v1.sql`.
2. H103 · `inteligencia-creativa-publicitaria-v1.sql`.
3. H104 · `piloto-comercial-ui-v1.sql`.
4. `tests/test-piloto-comercial-ui-v1.sql`.
5. Prueba ordenada canónica cuando H103 y H104 estén integrados en ella.

H104 falla cerrado si H102 o H103 no están aplicados. Mientras tanto, la interfaz muestra un aviso legible y la operación normal continúa intacta.

## Estado de la activación

H103 y H104 fueron aplicados y validados en staging el 22 de julio de 2026. La prueba adversarial H104 y la cadena 01–104 pasaron con rollback total. El recibo sanitario está en `H104-STAGING-COMMERCIAL-PILOT-UI-2026-07-22.json`.

Producción no fue modificada y no se inició una muestra. La activación del piloto real requiere una decisión humana posterior y separada.
