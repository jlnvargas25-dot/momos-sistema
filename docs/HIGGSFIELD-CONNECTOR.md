# Conector Higgsfield de Agencia MOMOS

Este worker conecta la cola protegida de MOMO OPS con el CLI oficial de
Higgsfield. Nunca corre dentro de Vite ni recibe credenciales desde el navegador.

La auditoría de capacidades, prompts, Academia, activos MOMOS y brechas de la
integración está en
[`HIGGSFIELD-AUDIT-MOMOS.md`](./HIGGSFIELD-AUDIT-MOMOS.md). El criterio operativo
reutilizable vive en el skill personal `direct-higgsfield-momos` de Codex.

## Plantilla de dirección

Antes de estimar o despachar una generación, completar
[`HIGGSFIELD-FILM-PROMPT-TEMPLATE.md`](./HIGGSFIELD-FILM-PROMPT-TEMPLATE.md).
La plantilla separa el brief interno del prompt final y exige aprobación explícita
del modelo, duración, formato, referencias, cámara y costo antes de consumir créditos.

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
   npm install -g @higgsfield/cli@latest
   higgsfield auth login
   ```

3. Definir secretos del runtime, nunca en archivos versionados:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `HIGGSFIELD_COP_PER_CREDIT`
   - opcionales: `HIGGSFIELD_IMAGE_MODEL`, `HIGGSFIELD_VIDEO_MODEL`,
     `HIGGSFIELD_POLL_MS`, `HIGGSFIELD_WORKER_ID`
   - En Windows, si el CLI no se instaló con npm global, definir
     `HIGGSFIELD_CLI_ENTRY` con la ruta absoluta a `bin/higgsfield.js` o
     `HIGGSFIELD_BIN` con un ejecutable nativo. El worker nunca usa un shell.

4. Confirmar la sesión y el heartbeat sin reclamar trabajos ni consumir créditos:

   ```powershell
   npm run worker:higgsfield:health
   ```

   Esta comprobación no exige `HIGGSFIELD_COP_PER_CREDIT`; la tarifa sí es
   obligatoria para cualquier ciclo capaz de estimar o despachar trabajos.

5. Verificar un ciclo sin dejar un proceso permanente:

   ```powershell
   npm run worker:higgsfield:once
   ```

6. Cuando la prueba real haya sido revisada, ejecutar `npm run worker:higgsfield`
   con un supervisor de procesos del servidor.

Los fallbacks actuales del worker son `marketing_studio_image` para imagen y
`gemini_omni` para video de producto. No constituyen una recomendación creativa
universal: el preflight debe elegir el modelo o workflow desde el schema vigente
de Higgsfield. Los fallbacks se pueden cambiar por entorno sin modificar ni volver
a desplegar MOMO OPS.

## Aprobación humana desde el MCP

Después de `biblioteca-produccion-v1.sql`, aplicar
`supabase/mcp-aprobacion-humana-v1.sql`. El MCP publica dos tools cerradas:

- `momos_request_human_approval`: registra en MOMO OPS el preflight exacto de un
  trabajo Higgsfield `Preparado`. Exige modelo, workflow, duración, formato,
  resolución, audio, referencias y fingerprints, paquete, lente, movimiento,
  iluminación, prompt, créditos, saldo y tope COP. No genera ni consume créditos.
- `momos_get_human_approval`: consulta la decisión usando el id y fingerprint
  exactos. No puede aprobar, rechazar ni ejecutar el trabajo.

La decisión ocurre únicamente en **Agencia MOMOS → Producción**, con sesión humana
y rol `Administrador`. Aprobar cambia el trabajo a `Autorizado` usando el tope COP
sellado; rechazar lo conserva en `Preparado`. Si cambia el trabajo, una referencia,
el prompt o vence la solicitud, el contrato deja de ser aprobable. El botón legado
de autorización tampoco puede saltarse una solicitud MCP.

Después de aplicar la migración, reiniciar Codex Desktop o el servidor MCP para que
la lista `enabled_tools` de `.codex/config.toml` publique las dos tools nuevas.
