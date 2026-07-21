# Plantilla maestra de video MOMOS para Higgsfield

Versión: 1.2
Uso: UGC, producto, food content, anuncios verticales y secuencias cinematográficas.
Estado inicial obligatorio: `BORRADOR — NO GENERAR`.

Esta plantilla convierte una idea aprobada en un contrato de generación verificable. Conserva la arquitectura de los prompts de Higgsfield Academy —referencias con función, leyes visuales, acciones temporizadas y restricciones estrictas—, pero no fija una estética, lente o movimiento universal.

## Cómo usarla

1. Completar la ficha de producción y consultar en MOMO OPS la identidad y los activos aprobados.
2. Diseñar el hook, la acción, la cámara y la continuidad.
3. Consultar en Higgsfield el modelo disponible, sus límites y el costo actual.
4. Mostrar al aprobador el bloque **PRE-CREDIT GATE** completo.
5. Generar únicamente después de una aprobación humana explícita.
6. Revisar la salida con los criterios de aceptación antes de habilitarla para uso.

Convenciones:

- `[COMPLETAR]`: dato obligatorio.
- `[OPCIONAL]`: se elimina si no aplica.
- `DESCONOCIDO`: nunca se reemplaza con una invención.
- Las capacidades, duraciones y costos se consultan de nuevo en cada ejecución; no se presuponen por esta plantilla.

---

## 1. PRE-CREDIT GATE — aprobación antes de generar

> Este bloque se presenta al usuario antes de cualquier acción que consuma créditos.

| Campo | Valor aprobado |
|---|---|
| Proveedor | Higgsfield |
| Superficie de ejecución | `[MARKETING STUDIO / CINEMA STUDIO / MCP-CLI]` |
| Formato/preset de Marketing Studio | `[UGC / DIRECT-TO-CAMERA / UNBOXING / WILD CARD / OTRO / NO APLICA]` |
| Modelo exacto | `[MODELO + VERSIÓN]` |
| Modo/calidad | `[MODO]` |
| Duración | `[N] segundos` |
| Formato | `[9:16 / 16:9 / 1:1]` |
| Resolución | `[RESOLUCIÓN]` |
| Audio generado | `[SÍ / NO]` |
| Número de outputs | `[N]` |
| Referencias | `[LISTA DE ACTIVOS Y ROLES]` |
| Elements recurrentes | `[NOMBRE + TIPO + VERSIÓN / NINGUNO]` |
| Mecanismo de continuidad | `[ELEMENT / REFERENCIA / PROMPT]` por activo |
| Movimiento de cámara | `[RESUMEN EN UNA FRASE]` |
| Costo por output | `[N] créditos` |
| Costo total estimado | `[N] créditos / COP si hay tarifa vigente` |
| Saldo consultado | `[N] créditos` |
| Prompt/version | `[ID O FECHA]` |
| Estado | `ESPERANDO APROBACIÓN` |

Texto de aprobación esperado:

> Apruebo el modelo, duración, formato, referencias, movimiento de cámara y costo indicados para generar `[N]` prueba(s).

Sin esta aprobación no se suben referencias nuevas, no se despacha el job y no se consumen créditos.

### Elegir la superficie correcta

| Superficie | Usar cuando | Ventaja principal | Límite que debe vigilarse |
|---|---|---|---|
| `Marketing Studio` | Se quiere explorar rápidamente un formato publicitario conocido | Presets como UGC, directo a cámara, unboxing, ASMR, testimonial, tutorial e hipermovimiento | El preset puede simplificar referencias, control de cámara o continuidad de varios props |
| `Cinema Studio + Elements` | Deben persistir personaje, localización u objetos exactos entre tomas | Mayor control de identidad recurrente y dirección plano a plano | Requiere preparar Elements y continuidad explícita |
| `MCP/CLI` | El contrato ya está aprobado y se necesita ejecución repetible y trazable | Automatización, consulta de costo, registro del job y retorno a MOMO OPS | No reemplaza la decisión creativa ni la aprobación humana |

Marketing Studio puede ser la mesa de exploración; Cinema Studio o MCP pueden ejecutar la versión final controlada. No asumir que un preset conserva automáticamente todos los activos de marca.

#### Gate adicional para Marketing Studio

Registrar antes de generar:

```text
MARKETING STUDIO FORMAT: [FORMATO]
HOOK CONTROL: [SELECCIÓN]
SETTING CONTROL: [SELECCIÓN]
PRODUCT SLOT: [ACTIVO + ID]
AVATAR SLOT: [ACTIVO + ID / NO APLICA]
OTHER REQUIRED PROPS: [LISTA]
VISIBLE GENERATED PROMPT: [VERSIÓN GUARDADA]
VISIBLE CREDIT PRICE: [COSTO CONSULTADO EN LA INTERFAZ]
```

Si la acción exige dos o más objetos exactos —por ejemplo, bolsa + postre + cuchara— y el preset solo enlaza uno como `Product`, tratar los demás como referencias/Elements explícitos o migrar la ejecución a Cinema Studio/MCP. Nunca confiar únicamente en su descripción verbal para conservar geometría, marca y continuidad.

---

## 2. CREATIVE BRIEF

```text
PROJECT: [NOMBRE INTERNO]
VERSION: [V# / FECHA]
CHANNEL: [REELS / TIKTOK / SHORTS / ADS / OTRO]
AUDIENCE: [AUDIENCIA CONCRETA]
OBJECTIVE: [UNA CONDUCTA O RESULTADO]
SINGLE-MINDED PROMISE: [UNA PROMESA VERIFICABLE]
PRODUCT TRUTH: [QUÉ ES EXACTAMENTE]
MANDATORY MESSAGE: [MENSAJE QUE DEBE ENTENDERSE]
CTA: [ACCIÓN CONCRETA]
TONE: [3–5 ADJETIVOS COMPATIBLES]
TARGET DURATION: [N SEGUNDOS]
DELIVERABLE: [FORMATO, RESOLUCIÓN, AUDIO]
```

### Verdad comercial

- Producto/figura: `[DATO CONFIRMADO EN MOMO OPS]`
- Sabor: `[DATO CONFIRMADO / DESCONOCIDO]`
- Relleno: `[DATO CONFIRMADO / DESCONOCIDO]`
- Presentación y empaque: `[DATO CONFIRMADO]`
- Claims permitidos: `[LISTA]`
- Claims prohibidos o no comprobados: `[LISTA]`
- Precio/promoción/vigencia: `[FUENTE Y FECHA / NO APLICA]`

Regla: un dato desconocido se omite del guion y de la imagen. No se inventan ingredientes, rellenos, sabores, tamaños, beneficios, testimonios ni promociones.

---

## 3. HOOK Y RETENCIÓN

Antes de seleccionar el inicio, producir entre 5 y 8 hooks con mecanismos realmente distintos.

| Variante | Mecanismo | Primer frame | Primera frase/texto | Brecha de curiosidad | Prueba/payoff | Riesgo |
|---|---|---|---|---|---|---|
| A | `[PREGUNTA]` | `[VISUAL]` | `[LÍNEA]` | `[QUÉ QUIERE SABER]` | `[CUÁNDO SE RESUELVE]` | `[BAJO/MEDIO/ALTO]` |
| B | `[DEMOSTRACIÓN]` | `[VISUAL]` | `[LÍNEA]` | `[BRECHA]` | `[PAYOFF]` | `[RIESGO]` |
| C | `[CONTRASTE]` | `[VISUAL]` | `[LÍNEA]` | `[BRECHA]` | `[PAYOFF]` | `[RIESGO]` |
| D | `[CONFESIÓN/UGC]` | `[VISUAL]` | `[LÍNEA]` | `[BRECHA]` | `[PAYOFF]` | `[RIESGO]` |
| E | `[RESULTADO PRIMERO]` | `[VISUAL]` | `[LÍNEA]` | `[BRECHA]` | `[PAYOFF]` | `[RIESGO]` |

Puntuar cada variante de 0 a 2 en: claridad inmediata, relevancia, curiosidad honesta, prueba visual, brevedad y encaje de marca.

```text
SELECTED HOOK: [VARIANTE]
CONTROL HOOK: [VARIANTE MÁS SEGURA]
OPEN LOOP: [PREGUNTA IMPLÍCITA]
FIRST PAYOFF: [SEGUNDO]
REHOOK: [SEGUNDO + NUEVA INFORMACIÓN]
FINAL PAYOFF: [SEGUNDO]
CTA: [SEGUNDO]
```

---

## 4. ELEMENTS Y REFERENCES — identidad y función

Consultar MOMO OPS cada vez. Solo usar activos aprobados, vigentes, con derechos y permiso de IA compatibles.

### Element test

Higgsfield distingue tres niveles de control. Elegir el mecanismo más ligero que preserve lo que la siguiente generación necesita:

Referencia: [Higgsfield Academy — Why Elements exist](https://higgsfield.ai/academy/courses/cinema-studio-complete-tour/why-elements).

| Necesidad de continuidad | Mecanismo | Uso |
|---|---|---|
| El mismo personaje, lugar u objeto volverá en varias tomas, generaciones o campañas | `ELEMENT` | Guardar una identidad de producción reutilizable y llamarla por nombre |
| El activo solo guía una continuación inmediata | `REFERENCE` | Adjuntar la imagen al job actual sin convertirla en identidad recurrente |
| No se necesita una coincidencia exacta | `PROMPT` | Describirlo sin adjuntar ni guardar un activo |

Pregunta obligatoria antes de preparar el job:

> ¿Es un activo recurrente de producción que necesitaremos volver a llamar por nombre?

Si la respuesta es sí, crear o reutilizar un Element. Los tipos documentados por Higgsfield son `character`, `location` y `prop`. Elegir el tipo por la función visual del activo en la escena, no solo por su clasificación comercial en MOMO OPS.

Ejemplos para MOMOS:

- una persona o mascota recurrente: `character`;
- una cocina, tienda o mesa escenográfica que debe conservar su distribución: `location`;
- un postre, bolsa, caja o utensilio que debe conservar forma y marcas: `prop`;
- un logo final crítico se compone preferiblemente en postproducción con el archivo aprobado; no se confía su ortografía a una regeneración.

### Registro de Elements

| Element | Tipo | Activos fuente MOMO OPS | ID/fingerprint | Versión | Debe preservar | Puede cambiar | Estado |
|---|---|---|---|---|---|---|---|
| `[NOMBRE INVOCABLE]` | `[character/location/prop]` | `[ASSET IDS]` | `[ELEMENT ID + HASH]` | `[V#]` | `[IDENTIDAD RECURRENTE]` | `[POSE, ENCUADRE, LUZ, ETC.]` | `[BORRADOR/APROBADO/RETIRADO]` |

Reglas:

- un Element fija la identidad recurrente; no obliga a repetir la misma toma, pose, luz o composición;
- un Element se versiona cuando cambia deliberadamente vestuario, diseño, empaque o geometría aprobada;
- no sobrescribir silenciosamente un Element aprobado: crear una nueva versión y conservar trazabilidad;
- no mezclar en un mismo Element identidades incompatibles o activos con derechos distintos;
- antes de invocarlo, comprobar que su versión y sus fuentes siguen aprobadas en MOMO OPS.

| Ref | Activo aprobado | ID/fingerprint | Rol permitido | Debe preservar | No debe transferir |
|---|---|---|---|---|---|
| `REF_01` | `[PERSONA/PERSONAJE]` | `[ID + HASH]` | `character identity only` | `[ROSTRO, SILUETA, COLOR, DETALLES]` | `[FONDO, POSE, LUZ]` |
| `REF_02` | `[PRODUCTO]` | `[ID + HASH]` | `product geometry and appearance only` | `[FORMA, ESCALA, TEXTURA]` | `[MANOS, FONDO]` |
| `REF_03` | `[EMPAQUE]` | `[ID + HASH]` | `packaging only` | `[COLOR, FORMA, ASAS, IMPRESIÓN]` | `[ESCENA, ILUMINACIÓN]` |
| `REF_04` | `[LOGO]` | `[ID + HASH]` | `logo identity only` | `[TRAZO, ORTOGRAFÍA, PROPORCIÓN]` | `[COLOR GRADING, FONDO]` |
| `REF_05` | `[ENTORNO]` | `[ID + HASH]` | `environment only` | `[ARQUITECTURA, PALETA]` | `[PERSONAS, OBJETOS NO APROBADOS]` |

Bloque de prompt:

```text
ELEMENTS
- [ELEMENT_NAME] — [character/location/prop], approved version [V#]. Preserve [IDENTIDAD]. Direct only [ASPECTOS QUE PUEDEN CAMBIAR].

REFERENCES
- REF_01 — [NOMBRE]: character identity only. Preserve [RASGOS]. Do not copy [EXCLUSIONES].
- REF_02 — [NOMBRE]: product geometry and appearance only. Preserve [RASGOS]. Do not invent [EXCLUSIONES].
- REF_03 — [NOMBRE]: packaging only. Preserve [RASGOS]. Do not copy [EXCLUSIONES].
- REF_04 — [NOMBRE]: logo identity only. Preserve exact spelling, graphic proportions and colors. Do not reinterpret or regenerate lettering.
- REF_05 — [NOMBRE]: environment only. Use [ELEMENTOS]. Ignore [EXCLUSIONES].
```

### IMMUTABLE IDENTITY LAW

```text
The approved Elements and referenced character, product, packaging and logo identities are immutable across every frame.
No redesign, substitution, hybridization, recoloring, relabeling, mirrored lettering or detail drift.
Reference roles are isolated: never transfer pose, hands, background, lighting or unwanted objects from one reference into another subject.
Elements preserve recurring identity while pose, camera, performance and environment change only as explicitly directed.
```

---

## 5. STYLE Y LEYES VISUALES

### STYLE

```text
STYLE
[LIVE-ACTION UGC / CINEMATIC PRODUCT / FOOD MACRO / OTRO].
[REALISMO Y ACABADO]. [PALETA]. [TEXTURA]. [RITMO].
Avoid generic commercial gloss unless explicitly requested.
```

### LENS LAW

```text
LENS LAW
Use a [FOCAL EQUIVALENTE] lens look throughout [O DEFINE EL CAMBIO POR TOMA].
Camera height: [ALTURA]. Subject distance: [DISTANCIA APROXIMADA].
Perspective: [NATURAL / COMPRIMIDA / AMPLIA CONTROLADA].
Depth of field: [PROFUNDA / MODERADA / REDUCIDA] with focus priority on [SUJETO].
No fisheye, ultra-wide facial distortion, bent verticals, impossible perspective or unmotivated lens changes.
```

La focal se decide por la intención de la pieza. No copiar automáticamente `24 mm anamorphic` de un ejemplo de Academy.

### CAMERA LAW

```text
CAMERA LAW
Support: [HANDHELD APOYADO / TRÍPODE / GIMBAL / DOLLY / OTRO].
Base behavior: [ESTÁTICA / SEGUIMIENTO / REENCUADRE REACTIVO].
Movement: [TIPO, DIRECCIÓN, DISTANCIA Y MOTIVO].
Human micro-movement: [LEVE / NINGUNO], coherent with support and subject action.
Motion blur: natural, approximately 180-degree shutter behavior.
Focus behavior: [BLOQUEADO / PULL A OBJETO / PULL A ROSTRO], with no focus hunting.
Do not float, orbit randomly, drift, whip, zoom or shake without narrative motivation.
```

### LIGHTING AND COLOR LAW

```text
LIGHTING AND COLOR LAW
Key source: [TIPO, DIRECCIÓN, ALTURA, CALIDAD].
Fill/bounce: [TIPO Y DIRECCIÓN].
Practical sources: [LISTA / NINGUNA].
Color temperature: [K O DESCRIPCIÓN].
Exposure priority: [PIEL / PRODUCTO / AMBIENTE].
Preserve source direction, shadow logic, reflections, white balance and exposure across all shots.
No double shadows, pulsing exposure, flicker, clipped highlights, plastic skin or color drift.
```

### ACTING LAW

```text
ACTING LAW
Performance arc: [ESTADO INICIAL] → [DESCUBRIMIENTO] → [REACCIÓN] → [PAYOFF].
Eye-lines: [OBJETO] at [MOMENTO], then [CÁMARA/PERSONA] at [MOMENTO].
Hands: [MANO IZQUIERDA HACE X]; [MANO DERECHA HACE Y]. Never swap roles unless shown.
Breath and pauses: [MOMENTOS].
Expression: natural micro-reactions; no frozen smile, exaggerated surprise, lip drift or mannequin movement.
Object handling has believable weight, grip, inertia and contact.
```

---

## 6. MAPA ESPACIAL Y CONTINUIDAD

```text
SPATIAL MAP
- Camera position: [POSICIÓN Y ALTURA].
- Main subject: [POSICIÓN EN CUADRO].
- Product start position: [POSICIÓN].
- Packaging start position: [POSICIÓN].
- Key light: [LADO Y DIRECCIÓN].
- Screen direction: [IZQUIERDA→DERECHA / DERECHA→IZQUIERDA].
- 180-degree axis: [DESCRIPCIÓN].
- Protected negative space: [ÁREA PARA COPY / NO APLICA].
```

### Continuity ledger

| Elemento | Estado inicial | Cambio visible | Estado final | Invariante |
|---|---|---|---|---|
| Mano izquierda | `[ESTADO]` | `[ACCIÓN]` | `[ESTADO]` | `[REGLA]` |
| Mano derecha | `[ESTADO]` | `[ACCIÓN]` | `[ESTADO]` | `[REGLA]` |
| Producto | `[ESTADO/POSICIÓN]` | `[ACCIÓN]` | `[ESTADO]` | `[FORMA/ESCALA]` |
| Empaque | `[ESTADO/POSICIÓN]` | `[ACCIÓN]` | `[ESTADO]` | `[COLOR/LOGO]` |
| Cuchara/prop | `[ESTADO/POSICIÓN]` | `[ACCIÓN]` | `[ESTADO]` | `[FORMA]` |
| Mirada | `[DESTINO]` | `[CAMBIO]` | `[DESTINO]` | `[EYE-LINE]` |
| Luz/sombra | `[DIRECCIÓN]` | `[NINGUNO/CAMBIO]` | `[DIRECCIÓN]` | `[CONTINUIDAD]` |
| Audio | `[AMBIENTE]` | `[EVENTO]` | `[COLA]` | `[ROOM TONE]` |

---

## 7. TIMELINE — acciones observables

Elegir una modalidad y borrar la otra.

### Modalidad A — toma continua

```text
ONE CONTINUOUS TAKE — [00:00–00:SS]
No internal cuts, transitions, teleports or hidden scene resets.

BEAT 1 — [00:00–00:SS] — HOOK
Framing/lens: [PLANO + FOCAL].
Visible action: [UNA ACCIÓN OBSERVABLE].
Performance/eye-line: [REACCIÓN Y MIRADA].
Camera/focus: [MOVIMIENTO Y FOCO].
Light/audio: [COMPORTAMIENTO].
Continuity out: [ESTADO EXACTO DE MANOS, OBJETOS Y MIRADA].

BEAT 2 — [00:SS–00:SS] — REVEAL
Framing/lens: [PLANO + FOCAL].
Visible action: [UNA ACCIÓN OBSERVABLE].
Object physics: [AGARRE, PESO, CONTACTO].
Performance/eye-line: [REACCIÓN Y MIRADA].
Camera/focus: [REENCUADRE MOTIVADO].
Continuity in/out: [ESTADOS].

BEAT 3 — [00:SS–00:SS] — PROOF
[REPETIR CAMPOS].

BEAT 4 — [00:SS–00:SS] — PAYOFF / CTA
[REPETIR CAMPOS].
Hold the final readable product state for [N] frames/seconds.
```

### Modalidad B — secuencia con cortes

```text
SHOT 01 — [00:00–00:SS] — [FUNCIÓN]
Framing/lens: [PLANO + FOCAL].
Visible action: [ACCIÓN].
Camera/focus: [MOVIMIENTO].
Performance: [EMOCIÓN/MIRADA].
Light/audio: [ESTADO].
Continuity out: [GESTO, DIRECCIÓN, POSICIÓN Y SONIDO].

CUT CONTRACT 01→02
Edit type: [MATCH ON ACTION / HARD CUT / OCCLUSION / J-CUT / L-CUT / OTRO].
Anchor: [GESTO / FORMA / DIRECCIÓN / SONIDO].
Match frame: [DESCRIPCIÓN EXACTA].
Carry across: [MOVIMIENTO, ROOM TONE, EYE-LINE, LUZ].
Do not: [MORPH / DISOLVER / CRUZAR EJE / DUPLICAR ACCIÓN].

SHOT 02 — [00:SS–00:SS] — [FUNCIÓN]
[REPETIR CAMPOS].
```

Regla: cada bloque describe una sola acción dominante. Si una acción no puede verificarse en pantalla, se reescribe.

---

## 8. AUDIO LAW

```text
AUDIO LAW
Dialogue/VO: “[TEXTO EXACTO]”
Delivery: [NATURAL, CERCANA, RITMO, ACENTO SI ESTÁ APROBADO].
Diegetic sounds: [BOLSA, CUCHARA, MESA, RESPIRACIÓN, OTROS].
Room tone: [AMBIENTE].
Music: [NO GENERAR / DESCRIPCIÓN].
Dialogue remains intelligible and synchronized. No invented words, duplicated syllables, robotic cadence or unrelated background voices.
```

Si el modelo no genera audio confiable, usar `AUDIO: OFF` y documentar diálogo, música, foley, subtítulos y mezcla como postproducción.

---

## 9. POSTPRODUCCIÓN — fuera del generador

```text
POST ONLY
- Logo final: [ACTIVO APROBADO + POSICIÓN].
- Super/copy: “[TEXTO EXACTO]”.
- Subtítulos: [ESTILO Y SAFE AREA].
- CTA: “[TEXTO]”.
- Música/licencia: [FUENTE].
- Corrección de color: [INTENCIÓN].
- Sonido/foley: [LISTA].
```

Texto legible, precios, promociones, subtítulos y logos críticos se agregan preferiblemente en postproducción. No pedirle al modelo que regenere lettering exacto si puede componerse con el activo aprobado.

---

## 10. STRICT — invariantes y negativos

Adaptar la lista al proyecto. Eliminar instrucciones incompatibles entre sí.

```text
STRICT
- Preserve exact approved character, product, packaging and brand identities in every frame.
- Preserve product shape, scale, color, texture and material response.
- Preserve packaging geometry, handle count, color and construction.
- Preserve hand identity, finger count, grip logic and left/right hand assignments.
- Preserve scene geography, screen direction, eye-lines, light direction and shadow logic.
- Show every state change as a continuous physical action; no teleportation or unexplained swaps.
- Maintain plausible gravity, weight, contact, deformation and utensil interaction.
- Keep camera behavior consistent with the declared support, lens and movement.
- Keep the subject and required product action readable within the safe frame.

NEGATIVE CONSTRAINTS
- No morphing, melting identity, object fusion or cross-contamination between references.
- No extra, missing, fused or changing fingers, limbs, handles, utensils or product parts.
- No product substitution, duplicate product, invented filling, invented flavor or unapproved garnish.
- No mutated, mirrored, misspelled, floating or reinterpreted logo/text.
- No bag color change, label drift, texture drift or changing proportions.
- No random camera shake, floating camera, unmotivated orbit, crash zoom or focus hunting.
- No fisheye, extreme wide-angle distortion, warped room geometry or bent straight lines unless explicitly approved.
- No flicker, exposure pumping, color-temperature drift, double shadows or inconsistent reflections.
- No internal cuts when a continuous take is specified.
- No synthetic frozen smile, exaggerated reaction, broken eye-line or lip-sync drift.
- No unsafe, discriminatory, deceptive or unsupported commercial claim.
```

---

## 11. ATTACH ORDER

El orden escrito debe coincidir con el orden real de archivos enviados al modelo.

```text
ATTACH ORDER
1. REF_01 — [ARCHIVO / ASSET ID] — [ROL]
2. REF_02 — [ARCHIVO / ASSET ID] — [ROL]
3. REF_03 — [ARCHIVO / ASSET ID] — [ROL]
4. REF_04 — [ARCHIVO / ASSET ID] — [ROL]
5. REF_05 — [ARCHIVO / ASSET ID] — [ROL]
```

Antes de despachar:

- comprobar que el número de referencias no excede el límite actual del modelo;
- comprobar que cada activo recurrente usa el Element aprobado y su versión correcta;
- comprobar orientación, resolución, permisos, vigencia y fingerprint;
- comprobar que cada archivo corresponde al rol declarado;
- evitar referencias redundantes o contradictorias;
- registrar la lista exacta en el job.

---

## 12. PRUEBAS DE ACEPTACIÓN

Un cero en un criterio crítico rechaza la toma.

| Criterio | 0 — Rechazar | 1 — Corregir | 2 — Aprobar |
|---|---|---|---|
| Identidad del producto/personaje | Cambia o se fusiona | Drift menor | Consistente |
| Continuidad del Element | No coincide con el activo recurrente | Desviación menor | Identidad preservada |
| Empaque y marca | Incorrectos/ilegibles | Parcialmente fieles | Fieles |
| Manos y utensilios | Anatomía/agarre roto | Rareza menor | Naturales |
| Acción clave | No ocurre/no se entiende | Ambigua | Clara |
| Continuidad | Teleport/morph/salto crítico | Pequeño salto | Coherente |
| Cámara | Distorsión/movimiento aleatorio | Algo sintética | Motivada y natural |
| Luz y color | Flicker/doble sombra/drift | Variación menor | Continuos |
| Física del producto | Imposible | Dudosa | Creíble |
| Hook/payoff | Promesa incumplida | Débil | Claro y honesto |
| Claims/seguridad | Falso o riesgoso | Requiere revisión | Aprobado |

Criterios críticos: identidad, marca, manos, acción clave, claims y seguridad.
Umbral sugerido: ningún crítico en 0 y total mínimo `[DEFINIR]/22`.

---

## 13. PLAN DE EXPERIMENTO

```text
HYPOTHESIS: [SI CAMBIAMOS X, ESPERAMOS Y, PORQUE Z].
CONTROL: [VERSIÓN].
VARIANT: [VERSIÓN].
SINGLE VARIABLE CHANGED: [SOLO UNA].
PRIMARY METRIC: [RETENCIÓN 1S/3S, HOLD RATE, COMPLETION, CTR, CVR].
GUARDRAILS: [COMENTARIOS NEGATIVOS, OCULTAR, CLAIMS, CALIDAD].
MINIMUM SAMPLE / WINDOW: [REGLA].
DECISION RULE: [CUÁNDO GANA, PIERDE O SE REPITE].
```

No confundir una generación visual con un experimento válido: para comparar creatividad, mantener constantes oferta, audiencia, inversión, formato y duración cuando sea posible.

---

## 14. PROMPT FINAL — bloque limpio para Higgsfield

Copiar únicamente las decisiones aprobadas. No incluir tablas internas, puntajes de hooks, costos ni notas del equipo.

```text
PROJECT
[NOMBRE, DURACIÓN, FORMATO Y OBJETIVO VISUAL EN UNA FRASE]

ELEMENTS
[ELEMENTS APROBADOS, TIPO Y VERSIÓN; OMITIR SI NO APLICA]

REFERENCES
[BLOQUE DE REFERENCIAS CON ROLES AISLADOS]

IMMUTABLE IDENTITY LAW
[IDENTIDADES Y RASGOS QUE NO PUEDEN CAMBIAR]

STYLE
[ESTILO, REALISMO, PALETA, TEXTURA Y RITMO]

LENS LAW
[FOCAL, DISTANCIA, ALTURA, PERSPECTIVA, PROFUNDIDAD DE CAMPO]

CAMERA LAW
[SOPORTE, MOVIMIENTO MOTIVADO, MOTION BLUR Y FOCO]

LIGHTING AND COLOR LAW
[FUENTES, DIRECCIÓN, TEMPERATURA, EXPOSICIÓN Y CONTINUIDAD]

ACTING LAW
[ARCO EMOCIONAL, MIRADAS, MANOS, RESPIRACIÓN Y FÍSICA]

SPATIAL MAP
[CÁMARA, SUJETOS, OBJETOS, EJE, DIRECCIÓN DE PANTALLA Y LUZ]

TIMELINE
[BEATS DE TOMA CONTINUA O SHOTS + CUT CONTRACTS CON TIEMPOS EXACTOS]

AUDIO LAW
[AUDIO OFF O DIÁLOGO/VO/FOLEY/AMBIENTE EXACTOS]

STRICT
[INVARIANTES ESPECÍFICOS]

NEGATIVE CONSTRAINTS
[FALLOS ESPECÍFICOS A EVITAR]

ATTACH ORDER
[ORDEN EXACTO DE REFERENCIAS]
```

---

## 15. REGISTRO DE APROBACIÓN Y TRAZABILIDAD

```text
MOMO OPS PROJECT/JOB ID: [ID]
PROMPT VERSION: [VERSIÓN]
APPROVED ASSET IDS/FINGERPRINTS: [LISTA]
APPROVED ELEMENT IDS/VERSIONS: [LISTA / NINGUNO]
HIGGSFIELD MODEL SNAPSHOT: [MODELO + FECHA]
COST QUERY SNAPSHOT: [CRÉDITOS + FECHA]
APPROVED BY: [PERSONA]
APPROVED AT: [FECHA/HORA/ZONA]
GENERATION ID: [SE COMPLETA DESPUÉS]
OUTPUT ASSET ID/FINGERPRINT: [SE COMPLETA DESPUÉS]
REVIEW STATUS: [POR VERIFICAR / APROBADO / RECHAZADO]
NOTES: [OBSERVACIONES]
```

La aprobación creativa no equivale a aprobación de publicación. Toda salida generada vuelve a MOMO OPS como `Por verificar` hasta superar control humano de identidad, marca, derechos, claims y calidad.
