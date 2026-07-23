# Ingesta asistida de fotos en Agencia MOMOS

## Objetivo

Cuando el usuario entregue fotos a Codex para Agencia MOMOS, Codex hará la
clasificación y el registro mediante la interfaz autenticada de MOMO OPS. El MCP
se usa para consultar identidad, duplicados, cobertura y aptitud; no recibe una
ruta local ni escribe archivos directamente en Storage.

## Flujo

1. Inspeccionar cada original sin modificarlo y registrar defectos visibles:
   escarcha, desenfoque, compresión, recorte, reflejos, deformación o fondo.
2. Consultar por MCP la identidad vigente y la Biblioteca para evitar
   duplicados y conocer las vistas faltantes.
3. Presentar una ficha previa cuando falte información que no se puede inferir:
   propiedad, consentimiento de imagen, permiso de IA, canal, finalidad o
   vigencia.
4. Abrir Agencia MOMOS con una sesión humana autorizada y subir el original a
   Biblioteca. No se reemplazan originales existentes.
5. Completar, según corresponda:
   - nombre y tipo de activo;
   - producto, figura, sabor y presentación;
   - componente, vista, plano, set visual y variante;
   - locación, iluminación, estado físico e interacción;
   - origen, propiedad, derechos, vigencia y permiso de IA;
   - persona/identificabilidad, consentimiento, canales y finalidades;
   - observaciones de calidad y escarcha.
6. Ejecutar la revisión de calidad visual. Un activo con bloqueos queda
   registrado para corrección, pero no apto para generación.
7. Informar los IDs creados, cobertura alcanzada, faltantes y aptitud separada
   para contenido digital, imagen IA, video IA y Element.

## Guardas

- Nunca inventar derechos, consentimiento, figura, sabor o identidad.
- Con personas, rostros, voces o manos identificables, fallar cerrado si falta
  autorización específica.
- Conservar el original; una limpieza de escarcha o mejora es una versión nueva.
- No marcar un activo como canónico ni aprobar un paquete sin revisión humana.
- Subir mediante la UI/RPC gobernada, no mediante SQL ni acceso directo
  arbitrario a Storage.
- Higgsfield solo recibe referencias aprobadas después del preflight y de la
  autorización humana correspondiente.
