# Conector Higgsfield de Agencia MOMOS

Este worker conecta la cola protegida de MOMO OPS con el CLI oficial de
Higgsfield. Nunca corre dentro de Vite ni recibe credenciales desde el navegador.

## Garantías

- Solo reclama trabajos `Autorizado` y con fuentes cuyos derechos siguen vigentes.
- Usa un lease único y persiste `Despachando` antes del request externo. Una
  caída incierta se concilia manualmente y nunca se reenvía sola.
- Estima créditos y los convierte a COP antes de generar; si supera el tope humano,
  no envía el trabajo.
- Guarda la salida en el bucket privado `brand-assets`, con SHA-256 y vínculo al job.
- La salida queda `Por verificar`, con uso de IA desactivado y revisión humana
  obligatoria. No se publica automáticamente.
- La service role y la sesión OAuth de Higgsfield viven únicamente en el entorno
  privado del worker.

## Instalación

1. Aplicar `supabase/higgsfield-conector-v1.sql` después del paso 23.
2. Instalar el CLI oficial en la máquina o runtime privado:

   ```powershell
   npm install -g @higgsfield/cli@1.1.13
   higgsfield auth login
   ```

3. Definir secretos del runtime, nunca en archivos versionados:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `HIGGSFIELD_COP_PER_CREDIT`
   - opcionales: `HIGGSFIELD_IMAGE_MODEL`, `HIGGSFIELD_VIDEO_MODEL`,
     `HIGGSFIELD_POLL_MS`, `HIGGSFIELD_WORKER_ID`

4. Verificar un ciclo sin dejar un proceso permanente:

   ```powershell
   npm run worker:higgsfield:once
   ```

5. Cuando la prueba real haya sido revisada, ejecutar `npm run worker:higgsfield`
   con un supervisor de procesos del servidor.

Los modelos predeterminados son `marketing_studio_image` para imagen y
`gemini_omni` para video de producto. Se pueden cambiar por entorno sin modificar
ni volver a desplegar MOMO OPS.
