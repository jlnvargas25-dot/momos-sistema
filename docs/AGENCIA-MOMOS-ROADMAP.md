# Roadmap — Agencia Digital MOMOS

> Visión: MOMO OPS conserva hechos, permisos, costos y resultados; Codex dirige la estrategia y la creación; el dueño de marca decide junto al agente; los motores externos ejecutan únicamente contratos aprobados.

## Cimientos construidos

- Hitos 16–20: briefs, decisiones, biblioteca de originales, derechos y distribución aprobada.
- Hitos 22–25: integraciones privadas y ejecución protegida con Kling/Higgsfield.
- Hitos 26–29: revisión, versiones, orquestador MCP y distribución por conectores.
- Hito 30: Mesa cooperativa humano–agente y contrato creativo sellado.

## Base de conocimiento creativo

- [`AGENCIA-CREATIVE-PLAYBOOK.md`](AGENCIA-CREATIVE-PLAYBOOK.md) convierte las guías aportadas por el usuario en un estándar propio de MOMOS: estrategia, retención, activos maestros, storyboard, dirección por tomas, movimiento físico, voz/lip-sync, VFX, enrutamiento multimotor, QA y aprendizaje económico.
- Es prerrequisito de los hitos 31–36 y de las skills finales. Conserva principios duraderos; capacidades, precios y nombres de modelos se consultan en vivo.
- No reemplaza la experiencia real: MOMO OPS debe contrastar cada hipótesis con retención, pedidos pagados, margen y beneficio.

## Próximos hitos

### Hito 31 — Estudio creativo por escenas (implementado y validado)

- Implementado el contrato de toma definido en [`AGENCIA-CREATIVE-PLAYBOOK.md`](AGENCIA-CREATIVE-PLAYBOOK.md): propósito, duración, sujeto, acción, física, entorno, cámara, luz, audio, texto, continuidad, restricciones, referencias autorizadas y costo.
- El contrato creativo aprobado se transforma en storyboard con hook, payoff, CTA, formato, duración y loop de retención explícito.
- Cada corrección crea una revisión nueva: la anterior queda `Sustituida`; no se reescribe ni se elimina el historial.
- El servidor exige tomas consecutivas, duración coherente, continuidad mínima y derechos vigentes sobre los activos de marca.
- El gate humano `Borrador → En revisión → Aprobado` no genera, no gasta y no publica. La ejecución por motores continúa en el Hito 32.
- Migración `20260716_31_estudio_escenas` aplicada. La prueba adversarial de storyboard/tomas/continuidad/derechos/costo/aprobación/RBAC y la cadena ordenada 01–31 pasaron con rollback total.

### Hito 32 — MCP creativo y enrutador multimotor

- Exponer herramientas MOMOS de solo lectura para contexto, marca, activos y contrato.
- Elegir Higgsfield, Kling o Runway según la toma, no por preferencia fija.
- Estimar costo, revisar saldo, aplicar lease/idempotencia y conciliar cada resultado.
- Prohibir secretos en navegador, prompts y tablas públicas.

### Hito 33 — Calidad, continuidad y postproducción

- Verificar producto, figura, sabor, logo, textos, anatomía, derechos y continuidad entre escenas.
- Separar fallo técnico, fallo de marca y cambio creativo.
- Preparar un paquete de postproducción con tomas, audio, subtítulos y decisiones; el corte final conserva aprobación humana.

### Hito 34 — Experimentos y aprendizaje económico

- Versionar hooks, primeros fotogramas, CTA y ofertas sin cambiar varias variables a la vez.
- Cruzar publicación exacta con retención, clics, pedidos pagados, margen y beneficio incremental.
- Declarar ganador solo con muestra y atribución suficientes; la ambigüedad permanece como ambigüedad.

### Hito 35 — Experiencia de loops de retención

Construir primero la experiencia y los datos que alimentarán la futura skill `design-momos-retention-loops`.

#### Modelo operativo

- Registrar cada loop con `loop_id`, hipótesis de curiosidad, instante de apertura, payoff prometido, instante de cierre y escena responsable.
- Exigir que todo loop se cierre; un CTA no cuenta como payoff.
- Adaptar la densidad al formato: comercial corto, UGC, Reel/TikTok, pieza educativa o video largo.
- Usar como punto de partida —no como verdad permanente—: cold open sobre el payoff, una idea por bloque, cambio visual con propósito y transiciones que abren la siguiente pregunta.
- Someter el guion a aprobación humana antes de generar o gastar.

#### Telemetría necesaria

- Retención al primer y tercer segundo.
- Reproducción al 25 %, 50 %, 75 % y 100 %.
- Duración media, repeticiones, abandonos por escena y clic en CTA.
- Pedido pagado, margen y beneficio atribuible al creativo.
- Comparación de la hipótesis del loop contra su curva real; el aprendizaje queda en MOMO OPS, no en memoria informal de la skill.

#### Skill final planificada: `design-momos-retention-loops`

La skill se crea al final de la construcción de Agencia, cuando exista experiencia real suficiente.

**Activadores:** escribir o revisar guiones, hooks, storyboards, anuncios UGC, Reels, TikToks, Shorts o videos largos para MOMOS.

**Entradas:** contrato creativo sellado, formato/duración, identidad de marca, producto real, audiencia, activos autorizados, aprendizajes de retención y objetivo económico.

**Salidas:** mapa de loops, guion por bloques, storyboard, ledger abrir/cerrar, variantes de hook, control de promesas y plan de medición.

**Guardas:** no inventar beneficios ni hechos; no ocultar el producto; no dejar loops abiertos; no usar manipulación engañosa; no gastar ni generar antes del gate humano; optimizar beneficio y recuerdo de marca, no retención aislada.

**Validación futura:** probar la skill con comerciales cortos, UGC, contenido educativo y piezas largas; contrastar sus predicciones con curvas reales de retención y ventas antes de declararla estable.

### Hito 36 — Experiencia de dirección de motion

Construir primero el contrato, la interfaz y la telemetría que alimentarán la futura skill `direct-momos-motion`. No copiar la skill promocional del proveedor: adaptar sus principios al producto real, la identidad y los resultados económicos de MOMOS.

#### Modelo operativo

- Extender cada toma aprobada con una receta neutral: intención, movimiento del sujeto, cámara, movimiento secundario, timing, easing, start/end frames, invariantes y fallos prohibidos.
- Permitir comparar una a tres propuestas de motion antes de gastar.
- Separar cuatro gates: storyboard aprobado, motion aprobado, generación autorizada y pieza final aprobada.
- Usar previews baratos para validar ritmo y continuidad; la generación final solo ejecuta la receta seleccionada.
- Traducir la receta a Higgsfield, Kling, Runway u otro motor mediante adaptadores; nunca guardar un preset como verdad de negocio.
- Mantener edición y postproducción humana para el corte final.

#### Telemetría necesaria

- `motion_recipe_id`, versión, toma y objetivo narrativo.
- Activos y frames de entrada/salida, motor, modelo, versión, preset y parámetros efectivos.
- Costo estimado/real, tiempo de ejecución, intentos, errores, regeneraciones y correcciones manuales.
- Veredicto por producto, marca, física, cámara, continuidad, legibilidad y derechos.
- Abandono por toma, retención y resultado comercial de la versión exacta.

#### Skill final planificada: `direct-momos-motion`

La skill se crea al final de Agencia, cuando H31–H36 hayan producido suficiente experiencia real de MOMOS.

**Activadores:** diseñar o revisar movimiento para anuncios, producto, UGC, identidad animada, infografías, transiciones o piezas cinematográficas de MOMOS.

**Entradas:** contrato creativo, storyboard aprobado, producto y activos maestros, formato, objetivo por toma, continuidad vecina, límites de marca, presupuesto y aprendizajes previos.

**Salidas:** recetas de motion comparables, beats, cámara, timing/easing, start/end frames, invariantes, criterios de aceptación, plan de preview y paquete neutral para el enrutador MCP.

**Guardas:** no deformar producto o logo; no ocultar información; no inventar claims; no confundir motion con retención vacía; no elegir motor por moda; no generar, gastar ni publicar sin el gate correspondiente.

**Validación futura:** contrastar la predicción de cada receta con QA humano, continuidad real, costo por toma, abandono por escena y beneficio de la pieza antes de estabilizar la skill.

## Skills finales de Agencia

1. `momos-brand-director`: identidad, lenguaje, producto y decisiones de marca.
2. `design-momos-retention-loops`: guion y continuidad de atención basada en datos reales.
3. `direct-momos-motion`: movimiento, cámara, timing, continuidad y QA basados en experiencia real.
4. La mecánica de proveedores permanece en conectores/MCP; no se duplican manuales volátiles de modelos dentro de las skills.

## Referencias de aprendizaje

- Paquete aportado por el usuario: `C:\Users\Windows 11\Downloads\higgsfield-explainer.skill`. Se usa como referencia de diseño; no se instala ni se copia sin adaptación porque está orientado a canales faceless largos y a otro entorno de ejecución.
- Higgsfield, flujo faceless aportado por el usuario: <https://higgsfield.ai/blog/faceless-channel-one-prompt>.
- Higgsfield MCP aportado por el usuario: <https://higgsfield.ai/mcp>.
- Higgsfield, flujo Motion Design Skill + MCP aportado por el usuario: <https://higgsfield.ai/blog/MCP-For-Motion-Designers>.
- Higgsfield, motion estructurado y editable: <https://higgsfield.ai/blog/Higgsfield-Vibe-Motion-Guide-AI-Motion-Design>.
- Principios rescatados: script gate antes del gasto, loops explícitos, bloques visuales, consistencia de estilo, ledger de costo/fallos y postproducción humana.
- Playbook consolidado de creatividad, video, imagen, storyboard, retención, lip-sync y VFX: [`AGENCIA-CREATIVE-PLAYBOOK.md`](AGENCIA-CREATIVE-PLAYBOOK.md).
