# Roadmap — Agencia Digital MOMOS

> Visión: MOMO OPS conserva hechos, permisos, costos y resultados; Codex dirige la estrategia y la creación; el dueño de marca decide junto al agente; los motores externos ejecutan únicamente contratos aprobados.

> La preparación comercial del ecosistema completo se gobierna en [`ECOSISTEMA-MOMOS-ROADMAP.md`](ECOSISTEMA-MOMOS-ROADMAP.md). Este documento conserva el alcance específico de Agencia.

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

> Estado de la cadena técnica al 2026-07-17: los pasos 01–56 están aplicados y validados. H54 corresponde a Biblioteca Creativa vía MCP, H55 a Identidad de Marca operable y H56 a Data Sync y rendimiento. Las etiquetas históricas H48B y “H49 Mutación Meta” describen frentes de producto y no cambian esta secuencia técnica.

### Evolución aprobada — Agencia como memoria determinística del ciclo

- **H103 · inteligencia creativa publicitaria:** integrado en la cadena canónica.
  Fórmulas versionadas enlazadas a creativos existentes, medición común
  Meta/TikTok, ROAS de plataforma, ROAS interno y retorno sobre margen
  separados, decisión humana y consulta segura desde Codex.
- **H104 · piloto comercial UI:** integrado después de H103; permanece en el
  carril operativo/comercial y consume la memoria creativa sin redefinirla.
- **H105 · Humanización y Comunidad:** integrado después de H104. Convierte
  equipo, comunidad, personajes y producto real en series y episodios
  trazables; reutiliza consentimiento y derechos de Biblioteca, distingue
  persona/actor/personaje/sintético y recibe solo señales agregadas.
- **H106 · Biblioteca visual ampliada:** integrada después de H105. Agrupa
  manos, presentadores UGC, vistas traseras, locaciones, empaque, producto,
  personajes y audio en sets/variantes; cada persona queda limitada por nivel
  de identificación, canal, finalidad, vigencia y permiso específico de IA.
- **H107–H109 · Orquestación y conectores:** preflight, autorización humana y
  aislamiento de staging integrados. Ninguna preparación consume créditos ni
  publica; el worker necesita autorización y entorno verificado.
- **H110 · Calidad maestra para IA:** implementada y certificada en staging.
  Separa derechos de aptitud técnica, conserva el
  original, versiona revisiones y bloquea imagen, video o Elements deficientes
  en preflight, autorización y reclamo del worker.
- **Fase de experimentación cerrada:** Codex propondrá una sola variable; Agencia
  sellará control, retador, ventana y evidencia; Meta/TikTok aportarán señal y
  MOMO OPS conservará pedidos, ventas y margen.
- **Fase de memoria y fatiga:** cada ganador conservará contexto de validez,
  elementos fijos, variables admitidas, fecha de revisión y señales de fatiga.
  Replicar significará crear una versión, no duplicar ciegamente una pieza.
- **Fase de interfaz simple:** cuatro recorridos visibles —Decidir, Crear, Medir
  y Aprender— con las herramientas avanzadas cargadas bajo demanda.

El orden aprobado es: fórmulas ganadoras → humanización → biblioteca visual →
orquestación/experimentación → memoria de fatiga → simplificación final. Codex
razona y propone; MOMO OPS y Agencia conservan la verdad; los motores ejecutan;
las personas aprueban.

### Hito 55 — Identidad de marca operable (implementado y validado)

- Kit oficial versionado para logos reales de Biblioteca, colores semánticos, tipografías, dirección visual, voz y reglas separadas para Pauta y Orgánico.
- `agency_brand_color_tokens` y los activos oficiales se vinculan mediante `kit_id`. La implementación paralela incompatible no forma parte de la cadena canónica.
- Migración `20260717_55_identidad_marca`, adversarial específico y aceptación ordenada aplicados y validados con rollback total.

### Hito 56 — Data Sync y rendimiento (implementado y validado)

- Manifiesto y snapshots acotados para catálogos y operación, historial paginado y carga diferida de archivos privados.
- Una sola coordinación Realtime deduplica lecturas, conserva eventos recibidos durante una lectura y carga Agencia únicamente al entrar en sus vistas.
- Migración `20260717_56_data_sync_rendimiento`, adversarial específico y aceptación ordenada 01–56 aplicados y validados con rollback total.
- Los SQL H55/H56 se conservan como historial reproducible; no se vuelven a ejecutar cuando sus IDs ya existen en `public.momos_ops_migrations`.

### Hito 31 — Estudio creativo por escenas (implementado y validado)

- Implementado el contrato de toma definido en [`AGENCIA-CREATIVE-PLAYBOOK.md`](AGENCIA-CREATIVE-PLAYBOOK.md): propósito, duración, sujeto, acción, física, entorno, cámara, luz, audio, texto, continuidad, restricciones, referencias autorizadas y costo.
- El contrato creativo aprobado se transforma en storyboard con hook, payoff, CTA, formato, duración y loop de retención explícito.
- Cada corrección crea una revisión nueva: la anterior queda `Sustituida`; no se reescribe ni se elimina el historial.
- El servidor exige tomas consecutivas, duración coherente, continuidad mínima y derechos vigentes sobre los activos de marca.
- El gate humano `Borrador → En revisión → Aprobado` no genera, no gasta y no publica. La ejecución por motores continúa en el Hito 32.
- Migración `20260716_31_estudio_escenas` aplicada. La prueba adversarial de storyboard/tomas/continuidad/derechos/costo/aprobación/RBAC y la cadena ordenada 01–31 pasaron con rollback total.

### Hito 32 — MCP creativo y enrutador multimotor (implementado y validado)

- La migración `20260716_32_enrutador_escenas` sella exactamente una ruta por toma vigente de un storyboard aprobado.
- MOMO OPS recomienda Higgsfield o Kling por capacidad, pero el humano puede revisar motor, estimado y tope antes de autorizar. Runway no se declara operativo hasta contar con adaptador privado real.
- Preparar una ruta no gasta ni crea trabajos. Una autorización humana crea atómicamente un trabajo `Autorizado` por toma en las colas existentes; si un motor falla, está pausado o tiene heartbeat vencido, no queda una ejecución parcial.
- La huella del storyboard, la huella de cada toma, sus activos, prompts, riesgos, costos y topes quedan sellados e idempotentes.
- El contrato privado MCP expone contexto seguro sin secretos y permite proponer; el navegador no puede suplantar al agente ni escribir tablas directamente.
- Generación, revisión creativa y distribución siguen separadas. El Enrutador nunca publica.
- Migración `20260716_32_enrutador_escenas` aplicada. La prueba adversarial de multimotor/costo/idempotencia/atomicidad/no publicación/RBAC y la cadena ordenada 01–32 pasaron con rollback total.

### Hito 33 — Calidad, continuidad y postproducción (implementado y validado)

- `agency_scene_quality_reviews` sella una revisión por trabajo/salida/toma y verifica producto, figura, sabor, marca, logo/textos, anatomía, contacto, gravedad/viscosidad, cámara/foco, luz, sombras/reflejos, estabilidad temporal, derechos y continuidad.
- Los once criterios se puntúan 0–2. Una falla crítica no se promedia; para aprobar se exigen identidad y continuidad exactas, ningún cero y al menos 18/22.
- Los rechazos se separan en `Fallo técnico`, `Fallo de marca` o `Cambio creativo`, conservando hallazgos y huellas para que la siguiente versión corrija la causa real.
- El cerebro MCP puede proponer QA desde el runtime privado, pero no resolverlo; el navegador no puede suplantarlo. El humano puede revisar directamente o resolver la propuesta del agente.
- `agency_postproduction_packages` exige cobertura exacta de todas las tomas vigentes y solo acepta controles aprobados con archivo/derechos/huellas intactos. Sella orden, audio, subtítulos, decisiones y especificación de exportación.
- El corte final conserva aprobación humana independiente y nunca autoriza publicación, pauta ni distribución.
- UI integrada después del Enrutador: cola de tomas, visor del archivo, control de calidad, causa de rechazo y paquetes listos para corte.
- Archivos: `supabase/calidad-postproduccion-v1.sql`, `supabase/tests/test-calidad-postproduccion-v1.sql`, `src/lib/agency-quality-control.js` y su prueba. Prueba adversarial y cadena ordenada 01–33: PASS con rollback total.

### Hito 34 — Retención y aprendizaje económico (implementado y validado)

- `agency_retention_scripts` convierte únicamente contratos creativos aprobados en guiones versionados con plataforma, duración, audiencia, promesa, payoff, CTA, evidencia y mapa temporal por bloques.
- Cada versión exige al menos control y retador, exactamente un hook seleccionado y ocho puntajes 0–2. Prueba, honestidad y correspondencia con el payoff deben ser exactas; además, el hook necesita 12/16.
- `agency_retention_loops` registra pregunta, apertura, payoff parcial opcional, cierre y respuesta real. El cierre debe ocurrir dentro de la pieza y el CTA nunca sustituye el payoff.
- El agente privado puede proponer, pero no aprobar. El humano conserva `En revisión → Aprobado/Devuelto`; aprobar cuesta $0, no genera, no pauta y no publica.
- `agency_retention_experiments` fija una sola variable entre Hook, primer fotograma, CTA u oferta, dos brazos exactos, hipótesis, métrica primaria y guardas compartidas.
- `agency_retention_measurements` conserva snapshots inmutables por publicación y variante: primer/tercer segundo, 25/50/75/100 %, watch time, clics, pedidos pagados, ingresos, margen y beneficio incremental.
- No se declara ganador con menos de 100 observaciones por brazo. La atribución y el ganador requieren resolución humana; un resultado ambiguo queda `Inconcluso` y nunca escala automáticamente.
- Panel integrado entre Mesa cooperativa y Estudio: contratos sin guion, arquitectura de retención, revisión humana, planificación A/B y lectura de muestra exacta.
- Archivos: `supabase/retencion-aprendizaje-v1.sql`, `supabase/tests/test-retencion-aprendizaje-v1.sql`, `src/lib/agency-retention-engine.js` y su prueba. Regresión local: 348/348 PASS; build Vite PASS. Prueba adversarial de retención y cadena ordenada 01–34: PASS con rollback total.

### Hito 35 — Experiencia de loops de retención (implementado y validado)

- `agency_retention_diagnostics` cruza una medición inmutable del Hito 34 con el mapa temporal y los loops exactos del guion. Exige muestra mínima de 100, curva ordenada desde el segundo cero y cobertura de toda la duración.
- El servidor interpola la retención al inicio y final de cada beat y loop, conserva las caídas en puntos porcentuales y señala la mayor caída observada. La redacción impide confundir asociación temporal con causalidad.
- Cada diagnóstico cambia una sola variable: hook, primer fotograma, prueba temprana, orden de beats, payoff, CTA u oferta. Producto, audiencia, oferta y duración se mantienen constantes.
- `agency_retention_learnings` solo nace de aprobación humana, queda inmutable y conserva plataforma, audiencia, duración, embudo, curva, huellas y evidencia por beat/loop. Una nueva evidencia crea otro aprendizaje; nunca reescribe el anterior.
- El cerebro MCP/service role puede leer contexto seguro y proponer. El navegador no puede suplantarlo ni escribir tablas directamente. Aprobar no genera, no pauta, no escala y no publica.
- La **Sala de aprendizaje de loops** aparece entre Laboratorio de retención y Estudio creativo, con candidatos, revisión humana y aprendizajes acotados.
- Archivos: `supabase/experiencia-loops-retencion-v1.sql`, `supabase/tests/test-experiencia-loops-retencion-v1.sql`, `src/lib/agency-loop-learning.js` y su prueba. Regresión local: 354/354 PASS; build Vite PASS; UI verificada sin errores. Prueba adversarial de loops y cadena ordenada 01–35: PASS con rollback total.

#### Skill final planificada: `design-momos-retention-loops`

La skill se crea al final de la construcción de Agencia, cuando exista experiencia real suficiente.

**Activadores:** escribir o revisar guiones, hooks, storyboards, anuncios UGC, Reels, TikToks, Shorts o videos largos para MOMOS.

**Entradas:** contrato creativo sellado, formato/duración, identidad de marca, producto real, audiencia, activos autorizados, aprendizajes de retención y objetivo económico.

**Salidas:** mapa de loops, guion por bloques, storyboard, ledger abrir/cerrar, variantes de hook, control de promesas y plan de medición.

**Guardas:** no inventar beneficios ni hechos; no ocultar el producto; no dejar loops abiertos; no usar manipulación engañosa; no gastar ni generar antes del gate humano; optimizar beneficio y recuerdo de marca, no retención aislada.

**Validación futura:** probar la skill con comerciales cortos, UGC, contenido educativo y piezas largas; contrastar sus predicciones con curvas reales de retención y ventas antes de declararla estable.

### Hito 36 — Experiencia de dirección de motion (implementado y validado)

El contrato, la interfaz y la telemetría que alimentarán la futura skill `direct-momos-motion` ya existen y quedaron validados. No copia una skill promocional del proveedor: adapta sus principios al producto real, la identidad y los resultados económicos de MOMOS.

Fundación práctica ya creada: skill personal `$direct-natural-camera-lighting`, validada localmente. Dirige ángulos naturales, trayectoria con inercia, microvibración motivada, blur/foco, luz, sombras y continuidad física. Es neutral al proveedor; la futura `direct-momos-motion` incorporará además la identidad y los aprendizajes económicos propios de MOMOS.

#### Modelo operativo

- Cada toma aprobada recibe una receta neutral: intención, encuadre/lente, cámara, perfil handheld, blur/foco, mapa de luz, física, continuidad, transición, prompt, negativos y aceptación.
- Se comparan dos propuestas determinísticas por toma —precisa y orgánica— y el servidor exige exactamente una seleccionada entre una y tres permitidas.
- Los cuatro gates quedaron separados: storyboard aprobado, motion aprobado, generación autorizada y pieza final aprobada.
- El Enrutador queda bloqueado sin cobertura motion exacta; al crear el trabajo, el servidor sustituye cualquier prompt del navegador por la receta aprobada e inmutable.
- `agency_motion_observations` conserva después parámetros efectivos, costo, runtime, intentos, errores, correcciones, QA y atención para convertir experiencia real en criterio de MOMOS.
- Usar previews baratos para validar ritmo y continuidad; la generación final solo ejecuta la receta seleccionada.
- Traducir la receta a Higgsfield, Kling, Runway u otro motor mediante adaptadores; nunca guardar un preset como verdad de negocio.
- Mantener edición y postproducción humana para el corte final.
- Migración `20260716_36_experiencia_motion` aplicada. La prueba adversarial de cámara/luz/física/continuidad/selección/gates/telemetría/RBAC y la cadena ordenada 01–36 pasaron con rollback total.

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

### Hito 37 — Observatorio de adquisición Meta (implementado y validado)

La capa determinística ya está construida. La migración `supabase/observatorio-meta-v1.sql` crea políticas versionadas, snapshots inmutables, conciliación contra pedidos pagados de la misma ventana y diagnósticos 3Q con revisión humana. La prueba adversarial está en `supabase/tests/test-observatorio-meta-v1.sql`; la cadena ordenada ya exige 01–37.

El panel **Observatorio Meta** quedó integrado al inicio de Agencia MOMOS, antes de la Mesa cooperativa. Resume ventanas, alertas de píxel, ingreso ligado y diagnósticos; al abrir una ventana separa “Meta atribuye” de “MOMOS pagado”, muestra hipótesis no causales y permite preparar/aprobar/devolver una lectura. No existe desde este hito ningún camino para crear campañas, publicar, pausar, escalar o cambiar presupuesto.

Validación cerrada: módulo determinístico 7/7 PASS, suite completa 367/367 PASS, build Vite PASS, prueba adversarial del Observatorio PASS y cadena ordenada 01–37 PASS, ambas SQL con rollback total.

El documento aportado por el usuario, **“Claude Skills para Meta Ads”**, confirma el siguiente paso: Meta debe entrar a Agencia MOMOS como fuente verificable de señales, no como un piloto automático que cambie presupuesto o publique por su cuenta.

#### Señales que debe incorporar

- Campaña, conjunto, anuncio y creativo con objetivo, ventana, moneda, zona horaria, gasto, impresiones, alcance, frecuencia, CPM, clics, CTR y resultados.
- Embudo de Meta: reproducción inicial, visita, contenido, carrito, checkout, compra, conversaciones o leads según el objetivo real de la campaña.
- Salud del dataset/píxel: último evento, volumen por evento, EMQ actual y cobertura de identificadores; comparación de siete días contra los siete anteriores con piso de ruido configurable.
- Catálogo: gasto por producto y producto sin identificar, cruzado con el catálogo, stock terminado, reservas, ventas, margen y vencimiento reales de MOMOS.
- Huella exacta de publicación/creativo para enlazar cada métrica con contrato, guion, hook, storyboard, tomas, motion y salida aprobada.

#### Adaptación propia de MOMOS

- La estructura 3Q —qué pasó, por qué pasó y qué haremos— se conserva como explicación, pero cada conclusión debe citar hechos y denominadores completos.
- Los benchmarks externos no son verdad universal: se guardan con fuente, versión, mercado y vigencia; el umbral operativo de MOMOS es configurable y se contrasta con su margen, ticket, recompra y datos históricos.
- La revisión de creativos se convierte en una rúbrica observable de hook, jerarquía, producto, marca, prueba, oferta, CTA y coherencia con la landing/pedido. No se fuerza una lista extensa cuando una dimensión no aplica.
- Las hipótesis de catálogo no confunden gasto con ventas. MOMOS puede mejorarlas porque sí conoce pedido pagado, variante exacta, beneficio, inventario disponible y demanda no satisfecha.
- Una caída de eventos o un EMQ bajo crea una alerta de medición; nunca se interpreta automáticamente como caída de demanda.
- La estrategia y distribución de presupuesto se generan como escenarios comparables con costo, beneficio esperado y riesgo. No se replica una plantilla rígida de porcentajes.

#### Guardas

- Ingesta de solo lectura mediante conector/MCP privado; secretos fuera del navegador y de las tablas públicas.
- Snapshots inmutables, idempotentes y conciliables por cuenta, zona horaria, moneda, ventana y fuente.
- Atribución separada de causalidad: Meta reporta una atribución; MOMO OPS conserva además pedido, margen y beneficio observados.
- El agente puede diagnosticar y proponer. Crear campaña, cambiar presupuesto, pausar, escalar o publicar exige contrato y aprobación humana específicos.
- Ninguna recomendación se declara ganadora con muestra insuficiente ni altera pauta por una señal aislada.

#### Paquetes externos revisados

- **3Qs:** útil para ordenar el diagnóstico del embudo; sus semáforos se convierten en políticas versionadas y configurables.
- **Analizador de creativos estáticos:** útil como banco de dimensiones; se reduce a evidencia relevante para MOMOS y se conecta con QA, retención y beneficio.
- **Excel de estrategia:** útil como generador de escenarios; sus porcentajes, públicos y estructuras no se copian como reglas fijas.
- **Monitor del píxel:** buen patrón de cálculo determinístico, ventana 7d vs 7d y piso de volumen; requiere adaptación a telemetría y alertas propias.
- **Sugeridor de productos:** buen patrón de hipótesis de solo lectura; MOMOS lo robustece cruzando gasto con ventas, margen, stock y vencimiento.
- **Gem de video:** queda como referencia externa. La lógica útil debe quedar documentada y auditable dentro de MOMOS, sin depender de un prompt privado de otra plataforma.

### Hito 38 — Incrementalidad y ciclo de vida Meta (implementado y validado)

- `agency_meta_lift_studies` nace únicamente de un diagnóstico aprobado del Hito 37 y exige vínculo exacto con una campaña local. Admite Meta Conversion Lift, holdout aleatorio MOMOS y lectura observacional.
- Todo lenguaje causal exige diseño no observacional, asignación aleatoria declarada, al menos 100 observaciones por brazo y diferencia estadística suficiente. Una correlación significativa sigue llamándose asociación si el diseño fue observacional.
- `agency_meta_lift_measurements` conserva snapshots inmutables e idempotentes de control/expuesto: población, compradores, pedidos, ingresos, margen, gasto incremental, resultado agregado de plataforma y huella exacta.
- El servidor recalcula en paralelo la composición de compradores nuevos y recurrentes desde pedidos pagados de MOMOS OPS. El conector no puede falsificar este snapshot local ni convertir atribución en causalidad.
- El resultado deriva tasas, diferencia, lift, compradores, margen y beneficio incremental. Muestra insuficiente queda inconclusa; una revisión humana separada aprueba, devuelve o declara inconclusa la lectura.
- La capa no crea estudios dentro de Meta, no cambia audiencias, presupuesto o estado de campañas y no publica. El agente privado puede proponer diseños; nunca aprobarlos ni ejecutar pauta.
- UI integrada inmediatamente después del Observatorio con candidatos, diseños, mediciones, estado causal y beneficio incremental.
- Archivos: `supabase/incrementalidad-meta-v1.sql`, `supabase/tests/test-incrementalidad-meta-v1.sql`, `src/lib/agency-meta-incrementality.js` y su prueba. Regresión local 376/376 PASS y build Vite PASS; prueba adversarial de Incrementalidad Meta PASS y cadena ordenada 01–38 PASS, ambas con rollback total.

### Hito 39 — Escenarios de inversión Meta (implementado y validado)

- `agency_meta_investment_scenarios` nace únicamente de una medición incremental aprobada. La evidencia y las alternativas quedan selladas, son idempotentes y no admiten reescritura o eliminación.
- El servidor genera exactamente cuatro alternativas comparables: conservar, reducir, redistribuir o experimentar. Cada una declara presupuesto simulado, variación, rango de beneficio, propósito, supuestos y bloqueos; el navegador no puede inventar sus cifras.
- El snapshot cruza campaña y producto exactos con beneficio incremental, ciclo de vida, stock oficial/exacto, vencimiento, reservas, lotes en proceso, sugerencias pendientes, cola de Cocina, congelación, capacidad y límites configurados.
- Stock bloqueado prevalece sobre lift rentable; resultado causal negativo recomienda reducir; una asociación observacional solo puede recomendar comprar evidencia mediante un experimento pequeño.
- Aprobar un escenario significa aprobar su lectura, no ejecutarlo. Las guardas prohíben cambiar presupuesto, audiencia, campaña o publicación; una eventual ejecución tendrá autorización, secreto, lease e idempotencia independientes.
- UI integrada inmediatamente después de Incrementalidad Meta. Archivos: `supabase/escenarios-inversion-meta-v1.sql`, `supabase/tests/test-escenarios-inversion-meta-v1.sql`, `src/lib/agency-meta-investment.js` y su prueba.
- Validación cerrada: prueba específica 7/7 PASS, suite completa 383/383 PASS, build Vite PASS y SQL balanceado. La prueba adversarial H39 y la cadena ordenada 01–39 pasaron en Supabase, ambas con rollback total.

### Hito 40 — Autorización de inversión desacoplada (implementado y validado)

- `agency_meta_investment_authorizations` convierte un escenario H39 aprobado en una solicitud distinta. Sella campaña, audiencia, alternativa, presupuesto objetivo, vigencia de 10–120 minutos, actor, justificación, evidencia y huella; no reutiliza la aprobación analítica como permiso.
- Solo Administrador o Marketing/CRM pueden solicitar; solo Administrador autoriza, rechaza o revoca. El navegador no inserta autorizaciones ni modifica la outbox directamente.
- `agency_meta_investment_execution_jobs` aporta idempotencia, intento, lease, despacho y recibo privados. Lease perdido o resultado incierto bloquean el reenvío automático; un H39 nuevo sustituye permisos anteriores aún no despachados.
- La guarda vuelve a comprobar pausa global, límite de campaña, presupuesto exacto y stock. Con stock bloqueado solo se admite Reducir. Autorizar una solicitud crea un ensayo, pero conserva `execution_mode = Simulación`.
- El recibo de H40 debe declarar `external_mutation=false` y `campaign_budget_unchanged=true`. Cualquier resultado que afirme un cambio real se rechaza: este hito no llama a Meta, no gasta, no pausa, no escala y no publica.
- Panel integrado inmediatamente después de H39 con alternativas exactas, segunda aprobación humana, vencimiento, estado del ensayo y revocación. Archivos: `supabase/autorizacion-inversion-meta-v1.sql`, su prueba adversarial y `src/lib/agency-meta-authorization.js`.
- Validación cerrada: módulo local 8/8 PASS, suite 391/391 PASS, build Vite PASS y SQL balanceado. La prueba adversarial H40 y la cadena ordenada 01–40 pasaron en Supabase, ambas con rollback total.

### Hito 41 — Conector oficial Meta con ensayo conciliado (validado)

- `agency_meta_connector_dry_runs` convierte únicamente una autorización H40 vigente en un contrato de verificación sellado por cuenta `act_`, campaña, audiencia y versión Graph. Cancela el ensayo local H40 que aún no empezó; no lo mezcla con el conector oficial.
- El worker privado usa token de sistema y App Secret exclusivamente en variables del servidor. Cada llamada incluye `appsecret_proof`, destino fijo `graph.facebook.com`, `redirect: error` y método `GET` para cuenta, campaña y audiencia.
- La capacidad publicada es `ads_read`. `ads_management`, creación, publicación, pausa y cambio de presupuesto continúan prohibidos. La guarda de ejecución distingue salud de lectura de permiso de escritura para evitar que un heartbeat habilite distribución por accidente.
- El recibo exige exactamente tres GET, identidades exactas, `external_mutation=false` y correspondencia entre `Conciliado`/`Divergente`. Contrato y evidencia son inmutables; secretos y recibos incompletos se rechazan.
- Lease perdido antes de leer queda `Fallido`; interrupción durante la lectura queda `Incierto` y no se reintenta automáticamente. Una pausa humana no puede ser deshecha por el heartbeat del worker.
- UI integrada dentro de Autorización Meta con `Verificar en Meta`, estado de la lectura y explicación visible de cero mutaciones. Archivos: `supabase/meta-conector-dry-run-v1.sql`, `scripts/meta-worker.mjs`, `src/lib/agency-meta-connector.js` y pruebas.
- Validación cerrada: módulos específicos 8/8 PASS, suite completa 400/400 PASS, build Vite PASS, worker con sintaxis válida y `git diff --check` sin errores. La prueba adversarial H41 y la cadena ordenada 01–41 pasaron en Supabase, ambas con rollback total.

### Hito 42 — Gateway MCP semántico real (implementado, validado y activo en Codex)

- El contrato protegido que ya existía en H28 ahora tiene un servidor MCP local real por `stdio`, construido con el SDK oficial v1. Expone únicamente cinco herramientas con nombre fijo: salud, snapshot agregado, observatorio Meta, contexto creativo gobernado y envío de propuestas a revisión humana.
- `obtener_contexto_director_agencia()` cruza pedidos, operación, inventario terminado, CRM consentido, Agencia e integraciones. Devuelve cantidades agregadas y señales priorizadas; excluye nombres, teléfonos, direcciones, Instagram y cualquier otro dato personal.
- No existe herramienta de SQL, shell, pago, contacto, publicación, presupuesto o mutación de campañas. El snapshot declara `external_execution_allowed=false` y todas las capacidades prohibidas quedan explícitas en el contrato.
- Registrar propuestas está desactivado por defecto. Cuando el administrador habilite `MOMOS_MCP_PROPOSALS_ENABLED=true`, el servidor todavía solo llama la RPC sellada del H28: registra una propuesta, exige revisión humana y jamás ejecuta la acción sugerida.
- Cada lectura o propuesta queda en `agency_mcp_access_log` con clave idempotente, herramienta, modo, huellas, worker y resultado. La bitácora es inmutable, no admite secretos y solo Administración puede leerla desde MOMO OPS.
- Archivos: `supabase/mcp-agency-gateway-v1.sql`, `scripts/momos-agency-mcp.mjs`, `src/lib/momos-agency-mcp.js` y pruebas adversariales. H42 adversarial y migraciones 01–42 pasaron en Supabase; la suite local quedó 406/406 PASS y el cliente MCP negoció las cinco herramientas exactas.
- La configuración de proyecto `.codex/config.toml` reenvía las dos variables privadas desde el entorno. La activación real en Codex Desktop quedó verificada: salud `ok=true`, snapshot agregado sin PII y las cuatro herramientas de lectura disponibles. Después de esa comprobación se habilitó la quinta herramienta, `momos_submit_proposals`, exclusivamente para registrar borradores sellados en la bandeja humana del H28; no existe aprobación ni ejecución externa desde MCP.
- Primer uso cooperativo verificado: Codex registró la corrida `run_id=5` con tres recomendaciones internas a costo cero. El servidor devolvió `executed=false`, `requires_human_approval=true` y `external_execution=false`; una segunda lectura confirmó las tres propuestas pendientes de decisión humana.

### Hito 43 — Retorno cooperativo del Cerebro MCP (implementado y validado)

- El snapshot de Agencia incorpora `human_feedback`: totales resueltos y las últimas doce decisiones humanas sobre propuestas del agente.
- Solo regresan campos estructurados: resultado Convertida/Descartada, vínculo a decisión, fecha, tipo, riesgo, modo y huella del snapshot que originó la recomendación.
- Las notas libres y la identidad de quien resolvió no atraviesan el MCP. El contrato declara `contains_pii=false` y `resolution_notes_exposed=false`.
- No se añade otra herramienta, no requiere reiniciar Codex y conserva `external_execution_allowed=false`.
- Archivos: `supabase/ciclo-cooperativo-mcp-v1.sql` y `supabase/tests/test-ciclo-cooperativo-mcp-v1.sql`; la cadena ordenada ya exige el paso 43.
- Aplicación real verificada por MCP: tres propuestas convertidas, cero descartadas, decisiones 12–14 y ninguna nota libre expuesta. La primera prueba tuvo un falso positivo al confundir la bandera segura `resolution_notes_exposed` con la clave prohibida `resolution_note`; la expresión se restringió a claves exactas. Prueba adversarial H43 y cadena ordenada 01–43 en PASS, ambas con rollback total.

### Hito 44 — Bandeja semántica del Cerebro MCP (implementado, validado y activo)

- Cada decisión humana `Aprobada` se traduce en un solo siguiente paso determinístico. La respuesta incluye únicamente identificadores internos, tipo/riesgo, código y etiqueta de acción, etapa, área, ruta, bloqueo y si espera intervención humana.
- Producción, consentimiento CRM, revisión de oferta, inversión y triaje usan rutas explícitas. Las decisiones creativas recorren los gates ya construidos: Mesa, contrato, storyboard, motion, enrutamiento, generación, revisión de salida, QA por escena, postproducción y distribución.
- Una campaña nunca se ejecuta desde esta bandeja: devuelve `REVIEW_CAMPAIGN_SCENARIO`, `blocked=true` y `EXTERNAL_CONNECTOR_DISABLED`. Toda acción conserva `external_execution=false`.
- La cola se incorpora como `agency.action_queue` al snapshot H43; no crea otra herramienta MCP ni requiere reinicio. Se limita a veinte elementos y no expone títulos, razones, evidencia, notas, actores, PII o secretos.
- Archivos: `supabase/bandeja-semantica-agencia-v1.sql` y `supabase/tests/test-bandeja-semantica-agencia-v1.sql`. Prueba adversarial H44 y cadena ordenada 01–44 en PASS, ambas con rollback total.
- Comprobación real por MCP: tres decisiones aprobadas produjeron exactamente tres acciones —revisión comercial, plan de producción y triaje humano— sin texto libre, PII o ejecución externa. Meta continúa `Por conectar`.

### Hito 45 — Centro humano de acciones de Agencia (implementado y validado)

- La bandeja semántica H44 llega a MOMO OPS como un panel privado de trabajo: una sola tarjeta y una sola acción principal por decisión aprobada.
- Cada tarjeta abre Producción, Clientes o el gate creativo exacto. Navegar no marca la decisión como ejecutada; el resultado real se registra de forma humana y separada.
- Los roles ajenos a Agencia reciben una respuesta vacía segura. La UI no recibe PII, secretos ni notas libres desde la cola MCP y conserva `external_execution_allowed=false`.
- Una acción desconocida falla cerrada; cualquier escenario de campaña permanece bloqueado con `EXTERNAL_CONNECTOR_DISABLED`.
- Archivos: `supabase/centro-acciones-agencia-v1.sql`, `src/lib/agency-action-queue.js` y sus pruebas. Meta sigue apagado.
- Prueba adversarial H45 **PASS** y cadena ordenada 01–45 **PASS**, ambas con rollback total. Suite local **410/410 PASS**, build Vite **PASS** y verificación visual sin errores de consola ni desbordamiento.

### Hito 46 — Resultados verificables de Agencia (implementado y validado)

- Una decisión aprobada ya no puede cerrarse con una nota libre. El servidor exige resultado tipificado, costo real y evidencia interna existente en MOMO OPS.
- Un ledger inmutable sella decisión, código de acción, resultado observado, evidencia, costo, actor, fecha y huella idempotente. El navegador no puede insertar ni reescribir filas directamente.
- Un trigger bloquea el bypass por la RPC histórica: `Ejecutada` o `Fallida` requiere primero un outcome estructurado de la misma decisión.
- El Centro humano conserva una sola entrada por tarjeta: abre el área de trabajo y, al regresar, permite cerrar con evidencia exacta. Meta y toda ejecución externa siguen apagados.
- Archivos: `supabase/resultados-verificables-agencia-v1.sql`, `src/lib/agency-action-outcome.js` y sus pruebas.
- Prueba adversarial H46 **PASS** y cadena ordenada 01–46 **PASS**, ambas con rollback total. Suite local **414/414 PASS** y build Vite **PASS**.

### Hito 47 — Postproducción y exportación verificable (implementado y validado)

- Un corte aprobado ya puede convertirse en una autorización de exportación con especificación cerrada: MP4, H.264, AAC, BT.709, resolución, FPS, sonoridad y peso máximo.
- La autorización solo crea una cola privada. No inventa un archivo, no publica y no distribuye. El worker debe tomar un lease, exportar fuera del navegador, subir un archivo real a Storage y registrar SHA-256 más probe técnico.
- Un resultado incierto queda bloqueado y nunca se reenvía. Solo un fallo definitivo puede reintentarse con decisión humana y máximo de intentos.
- El máster exportado exige una segunda revisión humana de archivo, resolución, FPS, audio, color y peso antes de quedar `Aprobada`. Distribución Comercial continúa siendo un paso separado.
- La interfaz muestra con honestidad que esta máquina todavía no dispone de FFmpeg; por eso no habrá falsos “másters listos” hasta instalar y activar el worker privado.
- Archivos: `supabase/postproduccion-exportacion-v1.sql`, `supabase/tests/test-postproduccion-exportacion-v1.sql`, `src/lib/agency-postproduction-export.js` y su prueba.
- Prueba adversarial H47 **PASS** y cadena ordenada 01–47 **PASS**, ambas con rollback total. Suite local **420/420 PASS**, build Vite **PASS** y los SQL pasan parser PostgreSQL.

### Hito 48 — Worker local FFmpeg de postproducción (implementado y validado localmente)

- FFmpeg y ffprobe quedaron versionados en el proyecto mediante dependencias bloqueadas; no dependen de una instalación global ni llegan al navegador.
- `scripts/postproduction-worker.mjs` consume la cola H47 con lease, URLs firmadas de 15 minutos, verificación SHA-256 de cada fuente, límites de bytes/duración y temporales aislados que se eliminan incluso ante fallo.
- Cada toma se normaliza al perfil sellado y el máster completo queda MP4/H.264/AAC/BT.709 con resolución, FPS y sonoridad objetivo. Una toma sin audio recibe un tramo silencioso para conservar continuidad; si ninguna fuente contiene audio original, el worker falla cerrado hasta disponer de una pista licenciada sellada.
- Los subtítulos solo pueden quemarse cuando el contrato trae cues temporizados sellados. Sin cues no inventa textos: la opción queda apagada por defecto.
- Antes de Storage verifica probe, LUFS, peso y duración; después registra ruta `exports/{id}/{sha256}.mp4`. Si el upload pudo ocurrir pero la confirmación resulta incierta, concilia el estado y bloquea cualquier reenvío inseguro.
- Comandos privados: `npm run worker:postproduction:health`, `npm run worker:postproduction:once` y `npm run worker:postproduction`. El health real contra Supabase y un ciclo vacío pasaron; Meta permanece apagado.
- Validación local: suite completa **425/425 PASS**, build Vite **PASS**, health FFmpeg/ffprobe **PASS** y cola vacía **PASS**. La primera exportación real continuará requiriendo una autorización H47 y control humano posterior.

### Hito 49 — Mutación Meta mínima y reversible (aplazado; cerrado hasta autorización explícita)

- No se habilitará con las credenciales de lectura. Requerirá permiso `ads_management` independiente, lista blanca exacta, nueva autorización humana vigente y un único tipo de cambio reversible.
- Antes de cualquier escritura se leerá y sellará el estado previo; después se conciliará el estado real. Una respuesta incierta bloquea el reenvío y exige intervención humana.
- El primer alcance recomendado es un cambio controlado de presupuesto o estado sobre una campaña piloto, nunca publicación y presupuesto simultáneos. Debe incluir tope, ventana, pausa de emergencia y procedimiento de reversión probado.

### Hito 48B — Audio trazable del máster (implementado y validado)

- Cada exportación sella una decisión explícita: audio original de las tomas o una pista exacta de la Biblioteca MOMOS. El navegador solo envía el identificador; el servidor vuelve a comprobar archivo real, SHA-256, tipo, duración, estado, derechos, vencimiento y cobertura del canal.
- La selección queda en `agency_postproduction_export_audio`, es inmutable y se revalida tanto al entregar el trabajo al worker como al registrar el máster. Cambiar pista exige una exportación nueva.
- El worker privado descarga y verifica la pista sellada, conserva el audio original, mezcla la música a -14 dB, normaliza el máster a -14 LUFS y exporta AAC 192 kb/s, 48 kHz estéreo. Si no existe audio original ni pista autorizada, falla cerrado.
- La UI solo muestra pistas operables y compatibles con el canal. Autorizar continúa sin publicar ni distribuir; el control técnico y la aprobación humana del máster siguen siendo obligatorios.
- Archivos: `supabase/audio-postproduccion-v1.sql`, `supabase/tests/test-audio-postproduccion-v1.sql`, worker `momos-postproduction-worker/1.1.0` y contratos en `src/lib/postproduction-worker.js`.
- Validación cerrada: suite local **428/428 PASS**, build Vite PASS y smoke FFmpeg real PASS con H.264 + AAC, 48 kHz estéreo y -13.96 LUFS medidos. La prueba adversarial H48 y la cadena ordenada 01–48 pasaron en Supabase con rollback total; health y ciclo vacío del worker 1.1.0 PASS. Falta únicamente autorizar y aprobar humanamente el primer máster real cuando exista un corte candidato.

### Hito 53 — Motor de crecimiento multimodo (implementado y validado)

- `20260717_53_motor_crecimiento_multimodo` compara cuatro estrategias compatibles con la operación: venta inmediata, conquistar demanda, marca/comunidad y pauta/aprendizaje.
- Cada snapshot conserva hechos, políticas y una recomendación; la selección final es humana. Pauta y Orgánico permanecen separados y ninguna selección publica, pauta, gasta o reserva stock.
- La prueba adversarial específica y la cadena ordenada 01–53 fueron reportadas en PASS, ambas con rollback total.

### Hito 54 — Biblioteca Creativa vía MCP (implementado, aplicado y validado)

- El Cerebro de Agencia buscará originales mediante una herramienta semántica interna de lista cerrada. MOMOS OPS filtrará en servidor por archivo real, estado activo, derechos `Propio/Autorizado`, permiso de IA, vigencia, personas, canal, producto, figura, sabor, formato y etiquetas.
- La búsqueda devolverá únicamente un descriptor seguro y un identificador opaco. No cruzarán el MCP notas libres, actores, PII, `storage_path`, URLs firmadas, tokens, credenciales ni secretos.
- Una segunda herramienta concederá un recurso MCP opaco, temporal y verificado del activo exacto. El runtime privado volverá a comprobar MIME, tamaño, SHA-256, derechos, canal y vigencia antes de cada lectura; nunca expondrá la ruta local del host y el recurso jamás se presentará como permiso de publicación. La vía interactiva admite hasta **25 MB**; archivos mayores se derivarán a workers privados para evitar copias Base64 sobredimensionadas.
- Búsqueda y concesión tendrán nombres exactos en `agency_mcp_access_log`, huellas de entrada/salida e idempotencia. Una referencia vigente bloqueará el borrado concurrente y la confirmación de H51 revalidará todas las dependencias.
- Toda pieza creada con un original de Biblioteca seguirá pasando por revisión humana, QA, máster y Distribución Comercial. H54 conserva `external_execution_allowed=false`: no publica, pauta, contacta, distribuye ni modifica presupuesto.
- Archivos previstos: `supabase/mcp-biblioteca-creativa-v1.sql`, `supabase/tests/test-mcp-biblioteca-creativa-v1.sql`, `scripts/momos-agency-mcp.mjs`, contratos/pruebas locales y actualización de la cadena ordenada.
- **Validación cerrada:** SQL H54 aplicado; adversarial específico y aceptación ordenada 01–54 PASS con rollback total; suite **453/453 PASS**, build Vite PASS y gateway JS sin errores de sintaxis. Una sesión MCP previa debe reiniciarse antes de probar la nueva herramienta con un original real.

### Hito 105 — Humanización y Comunidad MOMOS (implementación técnica validada)

**Objetivo:** convertir la cercanía de MOMOS en una capacidad editorial, comunitaria y medible dentro de Agencia, sin confundir humanización con testimonios fabricados, exposición de datos personales o publicación automática.

- El Inicio Ejecutivo incorporará un espacio guiado **Humanización y Comunidad**; no será otro silo. Reunirá las acciones pendientes, series activas, señales de conversación, permisos, episodios por producir y aprendizajes humanos aprobados.
- La estrategia distinguirá cuatro protagonistas complementarios: **equipo**, **comunidad**, **personajes MOMOS** y **producto real**. Cada pieza declarará protagonista, territorio emocional, objetivo, audiencia, canal, serie y evidencia que entregará el payoff.
- Se formalizarán territorios emocionales versionados —antojo, ternura, celebración, compañía, humor y pertenencia— vinculados al perfil de marca vigente. Ningún territorio podrá sustituir la verdad de producto, inventar claims o forzar una venta en contenido orgánico.
- Las **series editoriales reutilizables** conservarán nombre, propósito, fórmula narrativa, frecuencia, protagonistas permitidos, hook, rituales, tono, formato, referencias obligatorias, variantes admitidas, CTA, estado y vigencia. Cada episodio mantendrá vínculo exacto con brief, contrato, storyboard, activos, publicación y resultados.
- La Biblioteca de producción aportará manos, presentadores UGC, locaciones, producto, empaque, personajes y audio. Rostro, voz, manos identificables, historias de clientes y UGC exigirán derechos, consentimiento específico, canal, finalidad y vigencia antes de entrar en un paquete de producción.
- El sistema distinguirá explícitamente **persona real**, **personaje ficticio**, **recreación/actor** y **contenido sintético**. Nunca presentará un avatar, actor o testimonio generado como cliente real; la IA servirá para ampliar narrativa y producción, no para fabricar confianza.
- La primera **Bandeja de Comunidad** recibe de Meta/TikTok únicamente conteos y temas de lista cerrada: nunca comentarios, perfiles o mensajes crudos. Codex puede consultar y proponer; no puede responder, contactar, publicar ni reutilizar material.
- Pide MOMOS y MOMO OPS aportarán únicamente hechos permitidos: ocasiones, productos, recompra, franjas, zonas agregadas, pedidos pagados y margen. Los datos personales no cruzarán al MCP; una historia individual requerirá consentimiento y selección humana independiente.
- Codex funcionará como laboratorio: propondrá ángulos, hooks, formatos y variaciones de una sola variable. Agencia conservará el experimento; Higgsfield u otro motor producirá solo después del preflight; MOMO OPS sellará costo, publicación, métricas, pedidos y margen; una persona decidirá si el resultado se convierte en fórmula reutilizable.
- Las métricas de vínculo incluirán comentarios significativos, respuestas, compartidos, guardados, menciones, UGC autorizado, conversación recurrente, asociación con personajes, visitas, recompra y pedidos pagados. Vistas o estética por sí solas no podrán declarar una fórmula ganadora.
- El aprendizaje se apoyará en los contratos existentes de retención y experimentación: hipótesis previa, control, una variable, muestra mínima, evidencia por beat y cierre humano. Las fórmulas distinguirán **elementos fijos**, **variables permitidas**, **restricciones**, contexto de validez y fecha de revisión para evitar replicación ciega o fatiga creativa.
- La UI ofrecerá cuatro recorridos simples: **Crear una serie**, **Preparar un episodio**, **Escuchar a la comunidad** y **Revisar conexión y resultados**. La implementación deberá cargarse bajo demanda y reutilizar Biblioteca, Calendario, Estudio, Producción, Distribución y Aprendizajes existentes.
- Dependencias: perfil de marca activo, Biblioteca/activos de producción, consentimiento y derechos, contratos de retención, motor `marca-comunidad`, Pide MOMOS para señales de cliente y conectores Meta/TikTok para conversación y medición reales.
- Guardas permanentes: `external_execution=false` por defecto; consentimiento verificable; separación Orgánico/Pauta; sin PII en MCP; sin contacto, respuesta, publicación, inversión o reutilización automática; aprobación humana separada para historia, activo, pieza, publicación y aprendizaje.

**Criterio de cierre operativo:** la implementación técnica H105 ya exige dos episodios aprobados y publicados antes de declarar una conexión ganadora. El programa se cerrará operacionalmente cuando una serie real cumpla ese recorrido con señales de un conector activo y decisión humana, sin exponer PII ni ejecutar acciones externas por omisión.

> Contratos técnicos: `20260722_105_humanizacion_comunidad` y `20260722_106_biblioteca_visual_ampliada`. La cadena canónica aplica H103 → H104 → H105 → H106.

### Hito 107 — Orquestación de producción desde fórmulas (implementado)

- Una fórmula H103 aprobada y un paquete visual H61/H106 aprobado se unen en un
  preflight versionado e inmutable con canal, formato, motor, modelo, duración,
  cantidad de salidas, costo estimado y tope máximo.
- El servidor revalida producto, figura, canal, huellas, derechos y preparación
  del paquete tanto al crear como al aprobar el preflight.
- Codex dispone de lectura y propuesta MCP de lista cerrada. La propuesta queda
  visible en el Laboratorio de fórmulas para revisión humana.
- Guardas permanentes: cero créditos, cero trabajos creados, cero ejecución
  externa y cero publicación durante preparación y aprobación del preflight.

### Hito 108 — Autorización humana de generación (implementado)

- Solo Administración puede convertir un preflight H107 aprobado y vigente en
  un trabajo creativo `Autorizado`, mediante confirmación explícita y criterio
  humano documentado.
- La operación es atómica e idempotente: revalida fórmula, paquete visual,
  identidad, kit oficial, conector saludable y tope de costo antes de crear un
  único trabajo dentro de la cola Kling/Higgsfield existente.
- Autorizar habilita al worker para reclamar el trabajo; la propia autorización
  no consume créditos, no llama el motor y no permite publicación.
- MCP expone solamente el estado compacto y auditado de las autorizaciones. No
  puede autorizar, reclamar un worker, ejecutar un motor ni publicar.
- La publicación conserva su revisión creativa, derechos y aprobación de
  Distribución como un gate posterior independiente.

Siguiente fase operativa: ejecutar un piloto real controlado con un único trabajo
autorizado, capturar recibo/costo/salida del worker existente y revisar el activo
antes de cualquier distribución. No requiere ampliar permisos ni activar una
publicación automática.

### Hito 109 — Aislamiento del piloto de conectores (implementado)

- El runtime de Higgsfield/Kling queda sellado por entorno y project ref.
- Reanudar exige decisión humana inmutable y heartbeat v2 del mismo staging.
- Salud y preparación no crean trabajos, no consumen créditos y no publican.

### Hito 110 — Calidad maestra de Biblioteca para IA (implementado y certificado en staging)

- Derechos y consentimiento siguen siendo obligatorios, pero ya no se muestran
  como si probaran resolución, enfoque, geometría o limpieza visual.
- Cada original recibe una revisión humana versionada con seis controles y una
  aptitud separada para contenido, imagen, video y Element. Cambiar el archivo o
  su ficha invalida la certificación anterior.
- Una mejora se carga como activo derivado enlazado mediante
  `original_asset_id`; el original no se reemplaza ni se borra.
- Producto, empaque y personajes requieren para video una frontal, otra vista y
  escala; un Element maestro exige además trasera y detalle macro aptos.
- El mismo estado se revalida al aprobar H107, al autorizar H108 y cuando el
  worker intenta iniciar. Ninguno de esos controles genera contenido o consume
  créditos por sí mismo.
- La corrida aislada
  [#11](https://github.com/jlnvargas25-dot/momos-sistema/actions/runs/29957000901)
  certificó la cadena 01–110, los contratos adversariales H107–H110 y los gates
  de recuperación, observabilidad, telemetría y concurrencia sin tocar
  producción ni consumir créditos creativos.

### Programa transversal futuro — Pide MOMOS: trazabilidad, seguridad y escala

**Objetivo:** lanzar Pide MOMOS como una interfaz pública rápida y resiliente sobre la misma verdad operativa de MOMO OPS, con trazabilidad auditable desde la primera visita hasta pago, producción, entrega, atribución y recompra. Este programa no se considerará listo por tener pantallas: exige contratos transaccionales, seguridad, observabilidad y carga verificadas.

#### Trazabilidad comercial de punta a punta

- Un `trace_id` de alta entropía acompañará sesión, cotización, reserva, intento de pago, evento de pasarela, pedido, producción, empaque, entrega, reclamo y atribución. `correlation_id` agrupará el viaje y `causation_id` explicará qué evento produjo cada transición.
- Se formalizarán `checkout_sessions`, cotizaciones versionadas, `payments`, `payment_events`, touchpoints de atribución y un ledger comercial append-only. El pedido conservará snapshots de precio, costo, comisión, domicilio, producto y promoción válidos al momento de comprar.
- Toda mutación pública exigirá clave idempotente con alcance y expiración definidos. Cada evento externo tendrá además identificador único del proveedor, fecha original, hash del payload validado y estado de conciliación.
- Un pago confirmado sin pedido, pedido sin reserva, reserva sin pago, entrega sin pedido o webhook incierto abrirá una excepción operativa visible. Un timeout posterior a una posible escritura nunca se reintentará a ciegas.
- La atribución conservará UTM, landing, campaña, anuncio, creativo, publicación, cupón o referido sin reemplazar la fuente de verdad pagada de MOMO OPS. La cadena deberá poder llegar de `post_id/creative_id` a pedido pagado, ingreso, margen y recompra sin exponer PII a Agencia o MCP.

#### Seguridad de Pide MOMOS — gate obligatorio de lanzamiento

- Pide MOMOS y MOMO OPS serán frontends separados con el backend compartido, roles y superficies distintas. El cliente público no recibirá permisos directos de escritura sobre pedidos, precios, inventario, beneficios, pagos, auditoría ni datos de otros clientes.
- Catálogo, cotización, reserva, creación de pedido, confirmación de pago y tracking usarán RPC/funciones de servidor de lista cerrada. El servidor recalculará producto, variante, cantidad, precio, promoción, horario, zona, domicilio, inventario y capacidad; nunca confiará en totales enviados por el navegador.
- Las funciones privilegiadas usarán mínimo privilegio, `search_path` cerrado, grants explícitos, RLS y pruebas adversariales de bypass. Ningún secreto de pasarela, Supabase `service_role`, Meta, TikTok, Higgsfield o mensajería entrará en variables `VITE_*`, bundles, logs o respuestas públicas.
- El pago utilizará checkout alojado o tokenización del proveedor para evitar almacenar datos de tarjeta. Cada webhook verificará firma, timestamp, tolerancia de reloj, ambiente, cuenta receptora, moneda, monto, pedido esperado y protección contra replay antes de producir un evento idempotente.
- La consulta de pedido no dependerá únicamente de un número secuencial y un teléfono. Usará un token público opaco de alta entropía o verificación OTP; responderá de forma uniforme para evitar enumeración de pedidos o clientes.
- Cotización, reserva, pago, tracking, login/OTP, recuperación y formularios tendrán rate limiting por IP, dispositivo, sesión y sujeto cuando corresponda, más límites globales y protección contra bots. Las reservas temporales tendrán cuota, expiración efectiva y defensa contra acaparamiento de inventario.
- La interfaz aplicará CSP estricta, HTTPS/HSTS, CORS por allowlist, headers de aislamiento y protección contra framing, validación de origen y defensa CSRF cuando se usen cookies. Entradas, notas, direcciones y contenido de terceros se validarán por esquema y se escaparán al renderizar.
- Storage mantendrá buckets privados cuando exista información de personas o pedidos; las URLs serán firmadas, breves y de un solo propósito. Subidas validarán MIME real, extensión, tamaño, dimensiones, hash, derechos y análisis de archivos antes de quedar operables.
- La privacidad seguirá minimización, finalidad, consentimiento separado, retención y borrado gobernado. Logs, telemetría, analítica, MCP y trazas no conservarán teléfonos, direcciones, tokens, payloads completos de pago ni secretos. Los requisitos legales y de tratamiento de datos requerirán revisión especializada antes del lanzamiento público.
- Secretos y llaves tendrán inventario, propietario, ambiente, rotación y procedimiento de revocación. Dependencias, contenedores y repositorio pasarán análisis de vulnerabilidades, secretos y actualizaciones; los hallazgos críticos bloquearán despliegue.
- Se mantendrá auditoría inmutable para cambios sensibles, alertas por autenticación anómala, replay, duplicados, exceso de reservas, divergencias de monto, errores de firma y elevación de privilegios. El equipo tendrá un procedimiento probado de respuesta y contención.

#### Rendimiento y escalabilidad

- El shop público se desplegará como aplicación independiente en CDN/edge. Catálogo, imágenes y configuración no sensible usarán caché versionada, compresión y revalidación; disponibilidad, precio final, capacidad y reserva permanecerán dinámicos y autoritativos en servidor.
- Las consultas públicas serán pequeñas, paginadas y específicas; Pide no consumirá los snapshots amplios de MOMO OPS ni se suscribirá a tablas operativas crudas por Realtime. El tracking recibirá únicamente el estado público simplificado del pedido exacto.
- La base tendrá índices medidos para los caminos reales: pedido por idempotencia/cliente/fecha/estado, items por pedido, reserva por pedido/estado/expiración, evento de pago por proveedor/id externo, tracking por token y auditoría por cursor. Cada índice deberá justificarse con `EXPLAIN (ANALYZE, BUFFERS)` sobre volumen representativo.
- Webhooks, notificaciones, sincronizaciones, liberación de reservas y tareas no interactivas usarán colas con lease, reintentos acotados, backoff, dead-letter y conciliación. El checkout no esperará procesos secundarios para confirmar una transacción ya segura.
- Se definirán límites de conexión, pooling, timeouts, circuit breakers y backpressure. La venta también respetará capacidad de producción, empaque, entrega y franjas; inventario disponible por sí solo no autoriza demanda ilimitada.
- El frontend conservará presupuestos de bundle, carga diferida, imágenes responsivas y telemetría de interacción. El exceso actual del presupuesto inicial de JavaScript y el tamaño de Agencia deberán corregirse, aunque Pide tenga su bundle separado.

#### Observabilidad, continuidad y calidad

- Se medirán latencia p50/p95/p99, tasa de error, saturación, concurrencia, colas, reservas activas, expiraciones, webhooks pendientes, conciliaciones, pagos sin pedido, pedidos sin pago y discrepancias de inventario. Todas las señales operativas usarán `trace_id` sin PII.
- Se definirán SLO y presupuesto de error para catálogo, cotización, reserva, pago, creación de pedido y tracking. Un dashboard deberá diferenciar caída del frontend, función, base, pasarela, Storage, mensajería y proveedor externo.
- Backups, recuperación puntual cuando esté disponible, restauración, retención de eventos y procedimientos de contingencia tendrán responsables y pruebas periódicas. Se declararán RPO y RTO antes de abrir tráfico público.
- La accesibilidad, navegación móvil, conectividad lenta, reintentos, mensajes de error, estados vacíos y recuperación de checkout se validarán con personas reales; una página rápida pero confusa también pierde pedidos y aumenta soporte.
- Reembolsos, reversos, contracargos, cancelaciones, pago confirmado sin stock y fallos parciales tendrán estados y conciliación propios. Ningún operador corregirá dinero o inventario editando filas manualmente.

#### Gates de validación antes del lanzamiento

- Suite de unidad, integración y E2E sobre catálogo → cotización → reserva → pago simulado/webhook → pedido → producción → entrega → atribución.
- Pruebas adversariales de autorización, RLS, enumeración, manipulación de precio, replay de webhook, doble clic, carrera por la última unidad, expiración, abuso de reservas, archivos maliciosos y exposición de secretos/PII.
- Prueba de carga en staging con volumen de datos representativo, tráfico sostenido, ráfagas y al menos diez veces el pico inicial esperado. Los objetivos numéricos se fijarán antes de probar; no se declarará capacidad “media” o “alta” sin p95/p99, error y saturación observados.
- Prueba de recuperación: caída de pasarela, función, cola, worker, Realtime y base; conciliación posterior sin doble cobro, doble pedido, sobreventa ni pérdida silenciosa.
- Revisión de seguridad independiente antes de manejar pagos reales y una nueva revisión cuando cambien autenticación, pasarela, tracking público o permisos.

**Criterio de cierre:** el programa estará listo para lanzamiento controlado cuando exista una compra E2E trazable y reconciliable, cero duplicados y cero sobreventa bajo las pruebas de concurrencia acordadas, todos los gates de seguridad pasen, los SLO se cumplan bajo carga objetivo y una restauración/contingencia pueda ejecutarse sin pérdida silenciosa. Tráfico alto requerirá una certificación posterior con el pico real observado; no se inferirá únicamente del diseño.

> Este programa tampoco reserva un número de migración. Pide MOMOS se implementará como aplicación separada y sus cambios de backend se numerarán después del último paso técnico aplicado, preservando la cadena canónica.

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
- Documento aportado por el usuario, **Claude Skills para Meta Ads**: <https://docs.google.com/document/d/1a6CZP0ddVm4nt73rUuk1e4U7vtEON0j7OK1mpMpc6c8/edit?tab=t.0>. Sus paquetes se revisaron como fuentes de metodología; no se instalaron ni ejecutaron porque deben adaptarse a los hechos, permisos y gates de MOMOS OPS.
