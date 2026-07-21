# Auditoría de Higgsfield para Agencia MOMOS

Fecha: 18 de julio de 2026
Estado: auditoría técnica y creativa completada; cero generaciones ejecutadas; cero créditos de generación consumidos.

Actualización del 18 de julio de 2026: se completó la lectura de las 223 URL indexadas del blog oficial. El método, censo, jerarquía de vigencia y conclusiones adicionales están en [HIGGSFIELD-BLOG-AUDIT-MOMOS.md](./HIGGSFIELD-BLOG-AUDIT-MOMOS.md).

## Resumen ejecutivo

Higgsfield sirve a MOMOS si se opera como un ecosistema de producción, no como una caja de prompts. La cuenta auditada expone imagen, video, Marketing Studio, Cinema Studio, storyboards/Elements, audio, explainers, 3D y postproducción. La mayor ventaja no es un modelo aislado: es poder elegir una ruta por riesgo y conservar referencias entre etapas.

La recomendación principal es un sistema híbrido:

1. MOMO OPS mantiene verdad, identidad, activos, permisos, storyboards y aprobación.
2. Codex desarrolla concepto, guion, shot list, prompts, routing, costo y QA.
3. Higgsfield ejecuta únicamente después de un preflight aprobado.
4. Los resultados regresan a MOMO OPS como candidatos privados.

Para trabajos repetibles, MOMO OPS puede disparar directamente un paquete ya aprobado a un worker sin una intervención creativa nueva de Codex. Para conceptos nuevos, campañas, personajes, secuencias de producto o diagnóstico, la ruta dirigida por Codex dará mejores resultados.

Conclusiones clave:

- Mejor default de video serio: Seedance 2.0 cuando hay varias referencias, acción o multi-shot.
- Mejor ruta publicitaria rápida: Marketing Studio, pero sus hooks/settings preset deben filtrarse; muchos no son seguros ni coherentes con comida premium.
- Mejor ruta de dirección cinematográfica: Cinema Studio 3.5 para cámara, luz, estilo y cobertura.
- Mejor ruta de stills de producto: Product Photoshoot con assets reales y `--enhance-only` antes de generar.
- Mejor ruta de animación de personajes: character sheets/Elements primero; Seedance para pruebas cortas; 3D/Blender para persistencia de serie.
- Mejor ruta de texto/logo: Vibe Motion o editor, no video generativo.
- Mejor estrategia de créditos: still → 720p sin audio → 1080p/audio final. Una variable por prueba.
- Mayor brecha actual: la biblioteca aprobada contiene referencias individuales, pero no packs multivista, turnarounds, audio y video de movimiento suficientes para animación consistente.

## Alcance y método

La auditoría contrastó:

- MOMOS MCP: salud, identidad, políticas, integraciones, storyboards y activos;
- conexión local Codex↔Higgsfield: configuración, worker, connector, routing y pruebas de salud;
- Higgsfield CLI autenticada: versión, 69 modelos, 18 workflows y schemas relevantes;
- Marketing Studio: productos, avatars, hooks, settings, DTC Ads y formatos;
- Academia: curso básico y pipeline profesional;
- repositorios oficiales de CLI y skills;
- blog oficial reciente y páginas de producto;
- censo y lectura de las 223 URL de las cinco categorías del blog oficial;
- las guías creativas MOMOS de retención, continuidad, cámara y luz;
- la plantilla de prompts de film compartida por el usuario.

No se pulsó Generate, no se creó una generación, no se entrenó Soul ID y no se consumieron créditos.

## 1. Estado de la conexión

### MOMO OPS ↔ Codex

Estado: funcional.

- servidor: `momos-agency-mcp/1.1.0`;
- brand library: activa;
- proposals: habilitadas;
- herramientas disponibles para snapshot, contexto creativo, búsqueda de assets, referencias y propuestas;
- política observada: `external_execution_allowed: false`, que debe respetarse antes de cualquier ejecución externa.

### Codex ↔ Higgsfield

Estado: funcional por CLI/worker; no existe una tool Higgsfield MCP separada expuesta en esta sesión.

- CLI oficial instalada y autenticada: 1.1.18, build 2026-07-16;
- integración Higgsfield en MOMO OPS: activa, secreto configurado y heartbeat reciente;
- worker local: cola privada, referencias protegidas, cotización previa, límite de costo, lease/idempotencia, outputs privados, SHA-256 y revisión requerida.

Esto es coherente con la recomendación oficial: la página de [Higgsfield MCP](https://higgsfield.ai/mcp) indica que para Codex es preferible usar la CLI. Por tanto, la arquitectura correcta no exige un MCP Higgsfield adicional:

```text
MOMOS MCP = contexto, verdad, permisos y aprobación
Higgsfield CLI/worker = ejecución y schemas/costos
Codex = dirección y orquestación
```

### MOMO OPS ↔ Higgsfield sin Codex por run

Existe como modo operativo si el paquete está completo y aprobado: storyboard, prompt versionado, referencias/Elements, modelo/workflow, duración, resolución, audio, costo máximo y criterios de QA. Si falta alguno, el worker debe devolverlo a preproducción.

## 2. Identidad MOMOS consultada

Fuente: snapshot actual de MOMO OPS.

- marca: MOMOS / D’Momos Sweet Love;
- tono: tierno, premium y cercano;
- posicionamiento: postres premium, adorables y apetecibles con personajes;
- dirección visual: luz natural cálida, texturas reales, composición limpia y cercanía premium;
- paleta observada: `#FAF4EC`, `#FFFFFF`, `#54382B`, `#8A6C5B`, `#E5714E`, `#F3D7DC`, `#F7ECD9`;
- logo: no deformar, conservar aire, no inventar wordmark y usar asset aprobado;
- producto: no inventar rellenos, respetar empaque/variante/textura real y confirmar disponibilidad/oferta;
- cámara: natural y motivada, sin floating camera;
- luz: estable, sin flicker ni sombras dobles;
- retención: prueba visible antes de 2 s, loop cerrado y una variable por test;
- continuidad: manos/props, match action, dirección de pantalla e identidad del producto;
- negativos: morphing, manos extra, producto deformado, logo inventado, doble sombra, flicker y variant drift.

## 3. Activos aprobados observados

Snapshot del 18 de julio; verificar antes de cada run.

| Activo | MOMO OPS ID | Fingerprint | Observación |
|---|---:|---|---|
| Logo MOMOS | 104 | `55ea903e91f870bbdb7d9b11deddbb38` | asset oficial; terminar texto/logo en post cuando sea crítico |
| Bolsa | 105 | `1d1852e803a76215868205aaf254d809` | prop recurrente; crear Element |
| Caja | 106 | `d4944cc19cfe56f807c8f00afba8a363` | prop recurrente; crear Element |
| Max | 71 | `06a96f69c67b945c0467af64ee4347cf` | propio, vertical, IA permitida |
| Toby | 72 | `3253df0dc0a7302e9fca7b5592cdd3b9` | propio; requiere sheet para animación consistente |
| Momo | 73 | `34dbbf3d751a922366aab1b966ee7ff3` | propio; requiere sheet para animación consistente |
| Teo | 109 | consultar al ejecutar | personaje aprobado en biblioteca |
| Lizi | 110 | consultar al ejecutar | personaje aprobado en biblioteca |
| Rocco | 74 | consultar al ejecutar | personaje adicional |
| Danna | 75 | consultar al ejecutar | personaje adicional |
| Isla/tienda | 107/108 | consultar al ejecutar | preparar plates y mapa espacial/luz |

Brecha: los assets auditados son mayormente imágenes individuales. No se encontró una biblioteca aprobada equivalente de:

- frente/espalda/perfiles/3/4 por personaje;
- escala relativa entre personajes, empaque y persona;
- producto por variante con hero, macro, corte/cucharada y mano;
- turnarounds de bolsa/caja;
- movimientos de referencia aprobados;
- voz/foley/firma sonora aprobados.

Esta brecha es crítica para animación y debe resolverse antes de escalar.

## 4. Inventario Higgsfield auditado

La CLI devolvió 69 modelos:

| Tipo | Cantidad | Opciones relevantes para MOMOS |
|---|---:|---|
| Imagen | 29 | GPT Image 2, Nano Banana Pro/2/Lite, Seedream 5, Soul V2/Cast/Cinema/Location, Recraft, Flux, inpaint/outpaint/upscale |
| Video | 26 | Seedance 2.0/1.5, Cinema Studio, Kling 3/2.6, Veo 3.1/3, Gemini Omni, Wan, Grok, Minimax, Explainer, lipsync, upscale/deflicker/removal |
| Audio | 5 | Seed Audio, TTS V2, Sonilo Music, Mirelo, Inworld |
| 3D | 5 | text/image/multi-image-to-3D, SAM 3D y rigging |
| Data/análisis | 3 | transcripción, LUT/color y speech-to-text |
| Texto/análisis | 1 | Virality Predictor/brain activity |

También devolvió 18 workflows, entre ellos:

- Cinema Studio Image/2.5/3.0/3.5;
- Marketing Studio Image/Video;
- image decompose;
- draw-to-video;
- Kling motion control;
- reframe;
- dubbing;
- voice change;
- video gen heredados.

La CLI autenticada expone más workflows que algunas referencias del skill oficial. Para operación, el schema actual gana.

## 5. Mapa de herramientas para MOMOS

### 5.1 Marketing Studio

Qué resuelve:

- UGC;
- tutorial/how-to;
- unboxing;
- product showcase;
- product review;
- TV spot;
- virtual try-on;
- pruebas rápidas con producto/avatar/hook/setting;
- Click-to-Ad desde URL;
- DTC static ads y brand kits.

Uso MOMOS:

- “Dulce antojo”: una UGC enseña bolsa, saca a Max, lo mira, lo presenta y prueba una cucharada;
- tutorial de empaque o regalo;
- product showcase sin presentador;
- variaciones de hook y setting con el mismo producto.

Riesgos:

- hooks observados como Product Crash, Product Hit, Product Dodge, Epic Fail o stunts no son apropiados por defecto para comida premium;
- settings como Airplane Wing, Roofing, Volcano Rim, Car Roof o Train Surf pueden ser inseguros/absurdos;
- Product Review no autoriza a inventar una opinión;
- Click-to-Ad puede extraer datos incorrectos: revisar nombre, descripción, fotos, colores, logo y oferta antes de generar;
- hook+setting y ad reference son enfoques alternativos, no acumulables.

Conclusión: Marketing Studio es bueno para velocidad y testing, pero Codex debe conservar el control del hook, la verdad del producto y el filtro de marca.

### 5.2 Seedance 2.0

Qué resuelve:

- video multimodal;
- varias referencias de personajes, props, imágenes, video y audio;
- start/end frames;
- multi-shot corto;
- audio nativo opcional;
- hasta 4K según schema y modo.

Límites observados:

- hasta 9 imágenes, 3 videos y 3 audios; 12 referencias totales;
- la referencia de audio requiere referencia visual;
- fast limita resolución;
- relaciones `auto`, 16:9, 9:16, 4:3, 3:4, 1:1 y 21:9;
- duración y costos deben consultarse en cada schema/run.

Uso MOMOS:

- UGC compleja con bolsa + personaje + postre;
- crack/centro/cucharada y acciones de producto;
- personajes en locación con continuidad;
- mini-historias de 1–3 beats;
- referencia del clip anterior para continuar.

Recomendación oficial aplicable: declarar número de shots, duración y relación arriba; numerar cada shot; prototipar 720p y sin audio; añadir 1080p/audio después de validar. Ver la [guía de prompts de Seedance](https://higgsfield.ai/blog/seedance-prompting-guide) y el [tutorial de generación](https://higgsfield.ai/blog/generating-with-seedance-2-0).

### 5.3 Cinema Studio

Qué resuelve:

- cámara, lente, focal, apertura, luz y color;
- multi-shot;
- start/end frames;
- estilos de cámara;
- secuencias visualmente dirigidas.

El workflow 3.5 auditado ofrecía `classic_static`, `silent_machine`, `one_take`, `epic_scale`, `intimate_observer`, `impossible_camera`, `documentary_snap`, `raw_chaos` y `dreamy_flow`.

Uso MOMOS:

- `one_take`: UGC con bolsa y cucharada;
- `intimate_observer`: momento tierno/personaje;
- `documentary_snap`: handheld humano;
- `classic_static`: hero premium y empaque;
- `dreamy_flow`: campaña emocional puntual.

Evitar `raw_chaos` o `impossible_camera` salvo concepto justificado. La Academia recuerda que los controles aparecen por modelo: si falta el control que necesita la toma, cambiar de modelo, no fingirlo en el prompt.

### 5.4 Product Photoshoot

Modos actuales:

- product shot;
- lifestyle scene;
- close-up con persona/manos;
- Pinterest pin;
- hero banner;
- social carousel;
- ad creative pack;
- virtual model tryout;
- conceptual product;
- restyle.

Uso MOMOS:

- hero, macro, textura y empaque;
- carruseles coordinados;
- anuncios estáticos;
- producto en mano;
- banners web/email;
- bases aprobadas para animación.

La CLI ofrece `--enhance-only`, que permite revisar los prompts mejorados sin generar. Para producto real, subir una foto limpia o varios ángulos. Aunque la landing afirma fidelidad, MOMOS debe validar forma, etiqueta, color y textura en cada output. Ver [AI Product Photography](https://higgsfield.ai/ai-product-photography).

### 5.5 Popcorn, Elements y storyboards

Qué resuelven:

- storyboard consistente antes de movimiento;
- hasta 4 referencias y hasta 8 frames según la guía auditada;
- personaje, locación y prop recurrentes;
- handoffs entre escenas.

Regla Academia:

- activo recurrente → Element;
- continuación inmediata → reference;
- no necesita coincidencia → prompt.

Element no bloquea toda la toma; bloquea identidad mientras se dirige lo demás. Nombrar:

```text
@char_MOMOS_max_v01
@char_MOMOS_momo_v01
@char_MOMOS_toby_v01
@prop_MOMOS_bolsa_v01
@prop_MOMOS_caja_v01
@loc_MOMOS_isla_v01
```

### 5.6 Explainer

Herramienta separada para videos estructurados de 20 s a 10 min, con voz y presets. Útil para:

- historia de MOMOS;
- personajes y universo;
- cómo pedir o regalar;
- campañas educativas/familiares;
- contenido largo no fotorrealista.

Presets observados: Pixel Art, Claymotion, Mixed Media, 3D Papercraft, 2D Illustrator, Whiteboard Doodle, Low Poly, 3D Mix, Isometric Flat Vector y Fluffy Toy.

Claymotion, Fluffy Toy, 2D Illustrator y 3D Papercraft son especialmente compatibles con ternura y empaque. Ver la guía de [Higgsfield Explainer](https://higgsfield.ai/blog/ai-video-from-text-and-url).

### 5.7 Vibe Motion

Qué resuelve:

- tipografía cinética;
- logos;
- precios y métricas;
- gráficos;
- presentaciones y CTA;
- edición de fuente, color, layout y velocidad.

Es la ruta correcta para precisión de texto/branding y puede ser web-only o no aparecer en la CLI. Ver la [guía de Vibe Motion](https://higgsfield.ai/blog/Higgsfield-Vibe-Motion-Guide-AI-Motion-Design).

### 5.8 Audio, doblaje y lipsync

Opciones auditadas:

- Seed Audio: SFX, ambiente, foley, voz estilizada y música-like;
- Sonilo Music: música;
- TTS V2: múltiples motores;
- dubbing workflow con español;
- voice change;
- sync/lipsync.

Uso MOMOS:

- sonido de bolsa, caja, cuchara y tienda;
- ambiente doméstico o de isla;
- voz de campaña autorizada;
- doblaje/localización;
- lipsync de UGC.

Orden: aprobar montaje mudo → texto exacto → voz → foley/ambiente → mezcla → doblaje. No clonar voz o rostro sin consentimiento.

### 5.9 3D y animación persistente

La cuenta expone multi-image-to-3D, text/image-to-3D, rigging y cientos de acciones. Esto sirve para activos reales de serie, juegos, web o AR, pero exige:

- vistas múltiples coherentes;
- malla/topología;
- textura/PBR;
- rig;
- pruebas de idle/walk/pick-up/look/taste;
- escala y pivotes correctos.

Los assets actuales no alcanzan ese umbral. Antes de usar créditos 3D, crear turnarounds aprobados. Para la serie animada MOMOS, Blender puede ser la fuente maestra y Higgsfield servir para concepts, storyboards, fondos, pruebas y algunos shots.

### 5.10 Postproducción y análisis

Opciones:

- reframe;
- upscale;
- deflicker;
- background removal;
- LUT/color grading;
- draw-to-video;
- dubbing/voice change;
- Virality Predictor.

Regla Academia: elegir herramienta después de diagnosticar. Continuar desde first/last frame si el clip sirve; editar un defecto local; regenerar solo si movimiento/composición/identidad están fundamentalmente mal.

Virality Predictor puede puntuar hook/atención/retención como señal auxiliar. No afirmar que predice alcance, ventas o conversión.

## 6. Sistema de prompts recomendado

La Academia propone seis decisiones: sujeto, acción, setting, luz, cámara/motion y restricciones. Para MOMOS se amplía:

1. header: shot count, duración y relación;
2. refs por rol y orden;
3. identidad/Elements;
4. estilo y verdad del producto;
5. mapa espacial;
6. lens/camera/light law;
7. acting/physics law;
8. beats o shots cronometrados;
9. continuidad/transiciones;
10. audio/diálogo;
11. strict/avoid;
12. acceptance tests.

Principios:

- acciones concretas > adjetivos;
- describir física: contacto, peso, resistencia, trayectoria y reacción;
- una acción dominante por beat;
- no redescribir un still cuando se usa como start image; describir movimiento;
- no añadir referencias sin rol;
- no acumular movimientos de cámara incompatibles;
- mantener prompts concisos para una toma simple; usar bloques solo para complejidad real;
- reescribir el prompt completo cuando cambia una decisión;
- dejar texto/logo final en Vibe Motion/post;
- registrar prompt, schema, fingerprints y costo.

La plantilla operacional está en [HIGGSFIELD-FILM-PROMPT-TEMPLATE.md](./HIGGSFIELD-FILM-PROMPT-TEMPLATE.md).

## 7. Aplicación: “Dulce antojo”

Concepto propuesto por el usuario: una UGC muestra la bolsa, saca a Max, lo mira, lo enseña a cámara y lo prueba con una cucharada.

Ruta recomendada para primera prueba:

- opción A: Seedance 2.0 por referencias múltiples y física;
- opción B: Cinema Studio 3.5 `one_take` para dirección de cámara;
- Marketing Studio UGC como variante rápida después de aprobar el lenguaje y producto.

Duración recomendada: 10–12 s para prueba, 9:16, 720p, sin audio nativo en el primer run. Referencias: avatar autorizado, bolsa, Max y, si existe, plate de locación. Elements: bolsa y Max si volverán en campaña. Cámara: selfie/handheld humano con lean-in físico; sin orbit/floating zoom. Luz: ventana cálida lateral estable.

Beats:

1. 0–1.5 s: bolsa entra y crea prueba/curiosidad;
2. 1.5–4.0 s: apertura y extracción continua de Max;
3. 4.0–6.5 s: mirada y presentación a cámara;
4. 6.5–10.5 s: cucharada físicamente coherente y degustación;
5. 10.5–12.0 s: reacción pequeña y cierre/loop.

No se ha cotizado ni generado esta prueba en la auditoría. Antes del run deben recuperarse las referencias protegidas actuales, confirmar qué producto/variante es Max y calcular costo con los flags finales.

## 8. Problemas detectados en el software local

### Routing desactualizado

El scene router auditado divide en términos generales:

- diálogo/humano/física/cámara/producto → Kling;
- texto/logo/gráficos/composición → Higgsfield.

Esto no refleja el catálogo actual. Higgsfield ya incluye Seedance 2.0, Cinema Studio, Marketing Studio, motion control, audio, 3D y post. El router debe evolucionar de proveedor por categoría a modelo/workflow por riesgo y schema.

### Connector demasiado genérico

El conector auditado:

- usa `marketing_studio_image` y `gemini_omni` como defaults;
- solo llama `generate create`;
- limita duración localmente a 4/6/8/10;
- no representa bien roles múltiples de referencias;
- no cubre workflows, Product Photoshoot, DTC Ads, Elements, Soul, dubbing, reframe, audio o 3D.

### Storyboard incompleto

Un storyboard aprobado auditado tenía buena estructura de retención/cámara, pero costo 0 y arrays de assets vacíos. Además, mencionaba relleno/sabor no sustentado por la metadata del asset. Debe volver a verdad de producto antes de ejecutar.

## 9. Recomendaciones priorizadas

### P0 — antes de escalar producción

1. Crear character sheets oficiales de Momo, Max, Toby, Teo y Lizi.
2. Crear turnarounds de bolsa, caja y postres por variante.
3. Convertir activos recurrentes a Elements y mapear `fingerprint ↔ @name ↔ UUID`.
4. Hacer obligatorio el preflight con modelo, duración, formato, referencias, cámara y costo.
5. Bloquear ejecución si falta asset, costo, product truth o permiso.
6. Prototipar 720p sin audio; final 1080p/audio después de PASS.

### P1 — primeras líneas de contenido

1. UGC “Dulce antojo”.
2. Serie de textura/crack/cucharada de productos confirmados.
3. Product Photoshoot para hero, macro, empaque y carruseles.
4. Microhistorias 2D con Elements.
5. Explainer Claymotion/Fluffy Toy sobre personajes y cómo pedir.
6. Motion branding para logo/end cards/promos.

### P2 — plataforma y automatización

1. Router dinámico desde `model list`/`workflow list`.
2. Schema validation por modelo.
3. Media roles completos y límite por modelo.
4. Worker para workflows, Marketing Studio, Product Photoshoot, DTC Ads, audio y post.
5. Registro de jobs/costos/ajustes/QA en MOMO OPS.
6. Biblioteca de prompts y pruebas ganadoras versionada.

### P3 — animación persistente

1. DNA y turnarounds de personajes.
2. Decidir 2D Elements vs 3D Blender/rig.
3. Probar idle/walk/interacción con prop.
4. Crear lenguaje visual de serie y biblia de continuidad.
5. Escalar a episodios solo después de 3–5 shots consistentes.

## 10. Skill creado

Se creó el skill personal de Codex:

`C:\Users\Windows 11\.codex\skills\direct-higgsfield-momos`

Incluye:

- workflow obligatorio MOMO OPS → preflight → aprobación → Higgsfield → QA;
- router de capacidades;
- líneas de producción MOMOS;
- sistema de prompts;
- costo/aprobación/QA;
- arquitectura de integración y CLI;
- inventario de fuentes oficiales;
- script read-only para inspeccionar la CLI sin generar.

El skill convierte las conclusiones de la auditoría en comportamiento operativo y preserva la regla del usuario: no gastar créditos antes de mostrar modelo, duración, formato, referencias, movimiento de cámara y costo.

## Fuentes principales

- [Academia: Getting Started with Cinema Studio](https://higgsfield.ai/academy/courses/cinema-studio-complete-tour)
- [Academia: The AI Filmmaking Pipeline](https://higgsfield.ai/academy/courses/cinema-studio-pro)
- [Higgsfield MCP](https://higgsfield.ai/mcp)
- [Higgsfield CLI](https://higgsfield.ai/cli)
- [Repositorio oficial de skills](https://github.com/higgsfield-ai/skills)
- [Repositorio oficial de CLI](https://github.com/higgsfield-ai/cli)
- [Seedance 2.0 Prompting Guide](https://higgsfield.ai/blog/seedance-prompting-guide)
- [Generating With Seedance 2.0](https://higgsfield.ai/blog/generating-with-seedance-2-0)
- [Cinema Studio 3.0](https://higgsfield.ai/blog/cinema-studio-3.0)
- [Make 100 Creative Ads](https://higgsfield.ai/blog/make-100-creative-ads)
- [AI Product Photography](https://higgsfield.ai/ai-product-photography)
- [Script to Storyboard AI](https://higgsfield.ai/blog/script-to-storyboard-ai)
- [Realistic AI Human Movement](https://higgsfield.ai/blog/realistic-ai-human-movement)
- [Higgsfield Explainer](https://higgsfield.ai/blog/ai-video-from-text-and-url)
- [Vibe Motion](https://higgsfield.ai/blog/Higgsfield-Vibe-Motion-Guide-AI-Motion-Design)
- [Supercomputer Guide](https://higgsfield.ai/blog/higgsfield-supercomputer-guide)
