# Conector Kling 3.0 de Agencia MOMOS

Este worker conecta la cola protegida de MOMO OPS con Kling Open Platform.
Nunca corre dentro de Vite y la API Key nunca llega al navegador, a una tabla
pública, al repositorio ni al chat.

## Qué protege

- Solo reclama trabajos `Autorizado` con fuentes y derechos vigentes.
- Usa `external_task_id` determinista y guarda el despacho antes del POST.
- Si la respuesta se pierde, deja el intento `Incierto`, lo busca por ese ID y
  no genera un segundo cobro automático.
- Reserva el costo en COP con un factor de seguridad antes de generar y respeta
  el tope aprobado por una persona.
- Acepta únicamente el perfil aprobado: Kling 3.0, video de 3 a 15 segundos,
  resolución 720p/1080p/4K y audio apagado o nativo.
- Descarga solo desde hosts HTTPS aprobados, limita la salida a 100 MB, calcula
  SHA-256 y la guarda en el bucket privado `brand-assets`.
- La salida queda `Por verificar`, sin permiso de publicación automática.

## Activación ordenada

1. Aplicar `supabase/kling-conector-v1.sql` después del paso 24.
2. Ejecutar `supabase/tests/test-kling-conector-v1.sql`; siempre termina en
   `ROLLBACK` y no contacta a Kling.
3. Ejecutar `supabase/tests/test-migraciones-ordenadas.sql`.
4. En Agencia MOMOS → Integraciones, guardar solo el nombre o ID visible de la
   cuenta Kling. No pegar allí la API Key.
5. En el runtime privado del worker definir:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `KLING_API_KEY`
   - `KLING_API_BASE_URL=https://api-singapore.klingai.com` (opcional porque
     ya es el valor predeterminado; el worker rechaza cualquier otro origen)
   - antes de generar: `KLING_COP_PER_UNIT`, valoración interna de una unidad
     Kling en COP, y `KLING_COP_PER_USD`, tasa para conciliar cobros en USD.
     La comprobación `worker:kling:health` no exige ni inventa estas tarifas.
   - opcionales: `KLING_COST_SAFETY_FACTOR` (por defecto `1.25`),
     `KLING_RESOLUTION` (por defecto `720p`), `KLING_AUDIO` (por defecto `off`),
     `KLING_DURATION_SECONDS` (por defecto `5`) y `KLING_POLL_MS`.

6. Verificar cuenta y API Key sin generar ni consumir créditos:

   ```powershell
   npm run worker:kling:health
   ```

7. Crear un único trabajo de prueba, revisar sus fuentes y autorizar un tope.
   Solo entonces ejecutar un ciclo:

   ```powershell
   npm run worker:kling:once
   ```

8. Después de revisar la salida y su costo, ejecutar
   `npm run worker:kling` con un supervisor de procesos del servidor.

## Revisión humana de la salida

Después de instalar el conector, aplicar `supabase/revision-creativa-v1.sql`
y validar `supabase/tests/test-revision-creativa-v1.sql`. Cada salida completada
queda en `Pendiente` hasta que Administración o Marketing elija una sola decisión:

- **Aprobada:** habilita el archivo para el canal revisado, sin publicarlo y sin
  permitir que otra IA lo reutilice automáticamente.
- **Cambios solicitados:** conserva el original protegido y sella la explicación
  para el siguiente intento.
- **Descartada:** archiva la salida y conserva su costo, autor y trazabilidad.

La decisión no se puede reemplazar por otra posteriormente. Un nuevo intento debe
crear un nuevo trabajo creativo para que la historia no se reescriba.

## Perfil de costo inicial

MOMO OPS usa inicialmente 720p, 5 segundos y audio apagado. La reserva se calcula
con las unidades publicadas por Kling y el factor de seguridad configurado. La
conciliación final usa el bloque `billing` devuelto por el proveedor. Cambiar
resolución, duración o audio cambia el costo y siempre vuelve a compararse contra
el tope humano.

La cuenta de la aplicación creativa y el acceso a Open Platform pueden tener
planes o saldos distintos. El comando `worker:kling:health` confirma de forma
segura si la API Key de esa cuenta sirve para el conector antes de hacer una
generación real.
