# DISEÑO — Claude-traficker (Fase 1, marketing)

> Producto del "PRÓXIMO PASO" del HANDOFF (sesión 2026-07-09): revisión de los 4 módulos
> de marketing con la lente **modelo de datos → esquema Supabase** + diseño del lazo traficker.
> **Abierto:** ¿optimizar por VOLUMEN o por MARGEN? (define la métrica objetivo, ver §4).

## 1) Revisión de los 4 módulos — modelo de datos actual (verificado en código)

### `campaigns` (módulo Marketing, ~4648)
`{ id "CMP-xx", nombre, canal, objetivo, productoFoco, oferta, fechaInicio, fechaFin, presupuesto, gastoReal, estado, responsable, notas }`
- ⚠️ `productoFoco` es el **NOMBRE** del producto (string), no un id → se rompe al renombrar. En Supabase: FK `producto_foco_id`.
- ⚠️ `gastoReal` es **un solo acumulado tipeado a mano** → sin granularidad diaria; el ROAS/CAC solo existe "de por vida", no hay tendencia. Es EXACTAMENTE lo que el MCP de Meta/TikTok escribiría solo (gasto diario).
- ⚠️ No hay vínculo con la plataforma de pauta: falta `external_platform` + `external_id` (id de campaña en Meta/TikTok) para que el MCP haga join.

### `creatives` (módulo Creativos, ~4790)
`{ id "CRE-xx", campaignId, titulo, canal, formato, productoFoco, figuraFoco, saborFoco, hook, copy, guion, estado (Idea→En diseño→En revisión→Aprobado→Publicado→Ganador), responsable, fechaEntrega, assetUrl, notas }`
- Pipeline de estados sano (kanban por conteo). `productoFoco` otra vez por nombre.
- Falta `external_id` (id del ad / post) para traer métricas por creativo desde el MCP.
- `hook/copy/guion` son oro para Claude-creador-de-contenido: son el contexto de qué ya se probó.

### `content_calendar` (módulo Calendario, ~4919)
`{ id "CAL-xx", fecha, hora, canal, campaignId, creativeId, titulo, copyFinal, estado (Pendiente/Programado/Publicado), urlPublicacion, notas }`
- Vista semanal, cambio de estado inline, se crea desde Creativos (Aprobado/Publicado/Ganador → "🗓️ Crear publicación").
- `urlPublicacion` casi siempre vacía → falta `external_post_id` para métricas orgánicas vía MCP.

### `creative_results` (módulo Resultados, ~5035) — **la tabla 100% manual/demo**
`{ id "RES-xx", creativeId, campaignId, fecha, impresiones, alcance, clicks, mensajesWhatsApp, pedidos, ventas, gasto, notas }`
- Métricas derivadas en runtime: CTR, costo/msg, CAC, ROAS, conv WA→pedido.
- 🔴 **Doble fuente de verdad:** `pedidos`/`ventas` acá son TIPEADOS, pero la atribución real ya vive en `orders.campaignId/creativeId` (`campaignMetrics` ~1104 computa CAC/ROAS de verdad). En Supabase esto se parte en dos: métricas de plataforma (las escribe el MCP) y ventas/pedidos (SE DERIVAN de `orders`, nunca se tipean).

### `Crecimiento` (~5157) — biblioteca + asistente en lenguaje simple
- `marketing_ideas` `{ titulo, cat, objetivo, productoSugerido, copy, guionCorto, canal, estado (Ganadora/Repetir/Nueva/Usada/Descartada) }` — al programarse pasa Nueva→Usada.
- `marketing_guiones` `{ titulo, duracion, productoFoco, objetivo, dificultad, escena1..4, textoPantalla, audio }` — escena1..4 → `escenas jsonb` en Supabase.
- `marketing_mensajes` `{ tipo, texto }` — 12 plantillas WA; `AQuienEscribir` las cruza con CRM (cumples, beneficios por vencer, inactivos 7/15/30 días).
- `brand_library` `{ frases[], tono[], palabrasSi[], palabrasNo[] }` — **el system-prompt de marca para Claude** (tono, palabras prohibidas). Clave para que el traficker escriba copys "on-brand".
- `marketing_tasks` `{ tarea, fecha, estado, responsable }` — la lista diaria; hoy semilla estática. Es el canal natural para que Claude empuje tareas concretas.

### El proto-traficker: `trafficRecomendaciones` (~1123)
3 reglas de campaña (gastó >$60k sin pedidos → pausar · producto foco sin stock → reponer · ROAS ≥ 2 → subir presupuesto ~20%) + 1 de creativo (≥30 mensajes WA y ≤3 pedidos → revisar copy/precio/oferta).
- 🔴 **Efímeras:** se computan en cada render, no se persisten → no hay historial, no se sabe si el operador las aceptó o ignoró, no hay aprendizaje. Este es el MOLDE que en Fase 1 se convierte en la tabla `recommendations` que escribe Claude.

## 2) Esquema Supabase propuesto (lado marketing)

```sql
-- núcleo (ya migran del esquema v4): products, orders(+campaign_id, creative_id, origen_detalle), order_items, customers…

campaigns (
  id uuid pk, nombre text, canal text, objetivo text,
  producto_foco_id uuid references products,        -- FK, ya no nombre
  oferta text, fecha_inicio date, fecha_fin date,
  presupuesto numeric, estado text, responsable text, notas text,
  external_platform text, external_id text          -- join con Meta/TikTok vía MCP
)                                                    -- gastoReal DESAPARECE: se deriva de metrics_daily

creatives (
  id uuid pk, campaign_id uuid references campaigns,
  titulo text, canal text, formato text,
  producto_foco_id uuid references products, figura text, sabor text,
  hook text, copy text, guion text, estado text,
  responsable text, fecha_entrega date, asset_url text, notas text,
  external_id text                                   -- ad id / post id
)

content_posts (                                      -- ex content_calendar
  id uuid pk, fecha date, hora time, canal text,
  campaign_id uuid, creative_id uuid,
  titulo text, copy_final text, estado text,
  url_publicacion text, external_post_id text, notas text
)

metrics_daily (                                      -- ex creative_results, LA ESCRIBE EL MCP
  id uuid pk, fecha date, fuente text,               -- 'mcp-meta' | 'mcp-tiktok' | 'manual'
  campaign_id uuid, creative_id uuid, post_id uuid,  -- nivel según cuál esté seteado
  impresiones int, alcance int, clicks int, mensajes_wa int, gasto numeric,
  unique (fecha, fuente, campaign_id, creative_id, post_id)
)                                                    -- pedidos/ventas/margen NO van acá: se derivan de orders

recommendations (                                    -- LO QUE ESCRIBE CLAUDE, lo que muestra la app
  id uuid pk, created_at timestamptz, autor text,    -- 'claude' | 'reglas'
  tipo text,                                         -- pausar | subir | sinstock | copy | contenido | cliente…
  campaign_id uuid, creative_id uuid,
  titulo text, texto text,                           -- lenguaje simple (como el asistente actual)
  accion jsonb,                                      -- payload aplicable: {tipo:'subir', nuevoPresupuesto: 120000}
  prioridad int, expira date,
  estado text default 'nueva',                       -- nueva | vista | aplicada | descartada
  resultado text                                     -- qué pasó después (cierra el lazo de aprendizaje)
)

-- biblioteca (CRUD igual que hoy; Claude LEE brand_library para escribir on-brand y ESCRIBE ideas/tareas):
marketing_ideas    (id, titulo, cat, objetivo, producto_sugerido_id, copy, guion_corto, canal, estado, autor)
marketing_guiones  (id, titulo, duracion, producto_foco_id, objetivo, dificultad, escenas jsonb, texto_pantalla, audio, autor)
marketing_mensajes (id, tipo, texto)
brand_library      (id, frases jsonb, tono jsonb, palabras_si jsonb, palabras_no jsonb)   -- fila única
marketing_tasks    (id, tarea, fecha, estado, responsable, origen text, recommendation_id uuid)
```

Decisiones incorporadas: CAC/ROAS/ticket **nunca se guardan** (vistas SQL sobre `orders` × `metrics_daily`); el COGS congelado de Fase 0 hace computable el **margen atribuido** por campaña/creativo (era el faltante del lazo gasto→pedido→MARGEN).

## 3) El lazo traficker (diseño)

```
 [App/tablet] --pedidos+atribución+COGS--> [Supabase Postgres]
                                                ^        |
                escribe metrics_daily,          |        | lee ventas/margen/stock
                recommendations, ideas, tasks   |        v
 [Meta Ads MCP / TikTok MCP] <--lee pauta-- [Claude agente programado (cron diario)]
                                                |
 [App] <--muestra recomendaciones; operador acepta/descarta--> estado en recommendations
```

1. **La app escribe** pedidos (con `campaign_id`/`creative_id`/`origen_detalle` y COGS congelado) — ya existe desde Fase 0.
2. **Agente programado** (Claude Code cron / scheduled agent, p.ej. 7:00 am): vía MCP lee gasto/impresiones/clicks de Meta y TikTok por `external_id` → upsert en `metrics_daily`; lee de Postgres ventas/margen atribuidos y stock del producto foco; razona como traficker (las 4 reglas actuales son el piso, Claude agrega juicio) → inserta `recommendations` (+ `marketing_tasks` accionables + ideas/copys on-brand usando `brand_library`).
3. **La app muestra** las recomendaciones (el "Asistente de marca" del Dashboard y Crecimiento ya son el molde de UI). El operador **acepta** (aplica `accion`, p.ej. prefill de subir presupuesto) o **descarta** → `estado`.
4. **Aprendizaje:** la corrida siguiente lee qué se aceptó/ignoró y `resultado` → Claude calibra (y se puede auditar qué tan buen traficker es).

Seguridad/rol: Claude escribe SOLO en `metrics_daily`, `recommendations`, `marketing_ideas/guiones/tasks` (rol Postgres propio + RLS); **jamás toca pedidos/inventario**. Presupuesto en Meta lo cambia el humano (o una fase 2 con aprobación explícita).

## 4) Métrica objetivo — ✅ DECIDIDO 2026-07-09: HÍBRIDO

**Decisión del usuario:** el traficker optimiza por **MARGEN (POAS = margen atribuido ÷ gasto)** con un **piso de volumen mínimo** (no bajar de X pedidos/semana, para no perder ritmo de cocina y redes).

Implicaciones para el diseño:
- La vista SQL de métricas expone **ambas**: ROAS (ventas÷gasto) y POAS (margen÷gasto); el margen sale del COGS congelado de Fase 0.
- Las reglas/juicio del agente priorizan POAS; la regla "subir presupuesto" mira POAS ≥ umbral, no solo ROAS ≥ 2.
- **Guard de piso:** si los pedidos semanales caen bajo el piso, el agente relaja el criterio de margen y recomienda empujar volumen hasta recuperarlo.
- El **piso X es un parámetro configurable** (columna en settings o tabla de config del agente). Se calibra en Fase 1 con datos reales — default sugerido: el promedio semanal de pedidos de las últimas 4 semanas.

Opciones descartadas (referencia): VOLUMEN puro (ROAS, crece rotación con neto flaco) · MARGEN puro (POAS sin piso, puede frenar el ritmo).

## 5) Qué sigue

1. ~~Fusionar este esquema con el SQL v4 del usuario~~ ✅ **HECHO 2026-07-10: [`supabase/schema-v5.sql`](supabase/schema-v5.sql)** — esquema COMPLETO (núcleo + marketing + generación §6) derivado del shape real de `momos-db-v2` (DB_VERSION 16) vía diff sistemático del código; SUPERA al v4. Incluye: vistas `v_order_totals`/`v_campaign_metrics` (ROAS+POAS), esqueleto RLS por rol (incl. `claude_agent`), notas de migración (fechas Bogotá, `cant` string→numeric, refs por nombre→FK, adiciones→tabla, fotos→Storage, `auth_id` antes de RLS). **Afinado 2026-07-10 (sesión nueva):** PKs ✅ DECIDIDO texto-legible (uuid descartado; el link público de pedido usará token opaco aparte) · RLS ✅ CONCRETO (staff por rol + rol Postgres `claude_agent` con prohibición estructural de escribir operación + vistas `shop_*` para Pide MOMOS + `security_invoker` en vistas de métricas) · tabla `toppings` agregada (era `settings.toppings`). **Cruce con el v4: CERRADO N/A (2026-07-10)** — el usuario ya no tiene el archivo v4; schema-v5 se derivó del código real (fuente de verdad superior). **Siguiente paso: crear el proyecto Supabase y correr schema-v5.** **← el riesgo #1 queda mitigado.**
2. ~~Elegir el MCP de Meta Ads concreto (y equivalente TikTok)~~ ✅ **INVESTIGADO 2026-07-10** (3 agentes, fuentes primarias):
   - **Meta → MCP OFICIAL "Meta Ads AI Connectors"** (`mcp.facebook.com/ads`, lanzado 29-abr-2026, beta abierta, gratis, 29 tools incl. reporting, OAuth directo contra Meta SIN intermediario ni App Review para cuentas propias). **Plan B verificado: Pipeboard `meta-ads-mcp`** (tercero, 1.1k ⭐, `get_insights` con granularidad DIARIA confirmada, remoto gratis) — el riesgo es que intermedia tus credenciales de Meta. **A verificar al montar:** granularidad diaria en el oficial (beta) y su estado GA.
   - **TikTok → ecosistema inmaduro.** Oficial: "TikTok for Business MCP Server" (Agentic Hub, may-2026, disponibilidad real a verificar; sin repo público). Comunitarios: <50 ⭐, sin releases. **Recomendación: arrancar SOLO con Meta**; TikTok después vía MCP oficial o API directa con el SDK oficial (`tiktok/tiktok-business-api-sdk`). Datos: scopes NUMÉRICOS (no existe 'ads.read'); **⚠️ vigencia del token: A VERIFICAR** — el dato "24h + refresh 1 año" que circula probablemente sea del Login Kit de creadores, NO de la Marketing API (contaminación entre productos detectada por la verificación); la **aprobación de developer app tarda días-semanas y NO hay excepción documentada para uso propio** (a diferencia de Meta) → iniciar ese trámite temprano y verificar scope/token/review directamente logueado en `business-api.tiktok.com/portal`.
   - **Checklist Meta CONFIRMADO con doc oficial** (ruta plan B / API directa; el MCP oficial vía OAuth browser puede no necesitar nada de esto): App tipo **Business** en modo **Development** (sin App Review: "if your app is only managing your ad account, standard access to ads_read… is sufficient") · permiso **`ads_read`** (NO `ads_management`) · **System User** en Business Manager con token a 60 días o sin vencimiento · **Business Verification NO requerida** para cuentas propias.
   - **Falta la prueba real**: conectar el MCP oficial de Meta y leer una campaña viva (requiere cuenta de Meta Business del usuario).
3. ~~Definir el prompt/skill del agente cron~~ ✅ **HECHO 2026-07-10: [`traficker/AGENTE.md`](traficker/AGENTE.md)** — identidad, rutina diaria (ingesta→lectura→diagnóstico→escritura), guard del híbrido POAS/piso, aprendizaje sobre recomendaciones previas, prohibiciones duras y parámetros calibrables en `app_settings`.

### ⚠️ Riesgos al saltar a Fase 1 — checklist de arranque (verificados contra BACKLOG 2026-07-10)

Contexto: el núcleo operativo de Fase 0 SÍ está cerrado (15 bugs + auditoría 51 agentes 7/7 + revisión combos 3/3 + smoke-test 4/4, todo re-verificado en navegador; sección "Pendiente — Fase 0" del BACKLOG vacía). Los riesgos no se resuelven quedándose en la maqueta — se gestionan así:

1. **🔴 El SQL v4 está DESACTUALIZADO respecto a lo que Fase 0 construyó.** Es anterior a: `especie` en momos, catálogo de figuras como objetos `{nombre, especie, gramaje}`, `settings.toppings`, `adiciones` con `insumoCosto` congelado, `order_items` padre+hijas (`esCaja`/`parentItemId`/`cajaNum`/`esSubMomo`), `atributos` derivados del tipo, `precioRappi`. Migrar con el v4 tal cual = perder justo lo que se pulió.
   **Acción (PRIMERA tarea de Fase 1):** diff sistemático forma-actual-de-`localStorage` (`momos-db-v2`, `normalizeDbShape` como fuente de verdad del shape) → esquema nuevo, ANTES de correr nada en Supabase. Este doc cubre solo el lado marketing (§2); el diff debe cubrir el núcleo (products/orders/order_items/inventory/figuras/settings).
2. **🟡 Los 4 módulos de marketing nunca pasaron revisión adversarial** (las auditorías de Fase 0 solo cubrieron el núcleo operativo — advertido en HANDOFF). NO bloquea: Fase 1 les reemplaza el modelo de datos de todos modos (`gastoReal` desaparece, `creative_results` se parte, nombres → FKs). Auditar lógica de localStorage que está por morir es tirar plata. Solo auditar lo que migre tal cual.
3. **🟡 No hay suite de tests automatizada** — toda la verificación de Fase 0 fue manual en navegador. No importa para Fase 1 (esquema/RLS), pero SÍ para **Fase 2** (portar `reserveInventory`/`setOrderStatus`/`deductRecipe`/`releaseReservations` a RPCs): sin regresión automatizada se pueden reintroducir los 22 bugs ya pagados.
   **Acción (al arrancar Fase 2):** escribir los escenarios del smoke-test + los casos de las auditorías (stock fantasma al cancelar, WAC, transiciones, doble reserva, especie exacta, round-trip de adiciones) como tests de las RPCs — esa es la suite de aceptación del port.

## 6) Generación de creativos con IA — ✅ RUMBO ELEGIDO 2026-07-10: HeyGen + Higgsfield (las dos)

**Pedido del usuario:** la app debe ayudar a GENERAR el contenido, no solo planearlo. Decisión: enlazar **ambas** herramientas — se complementan por formato:
- **Higgsfield** (texto/imagen → video IA cinemático): clips de producto sin filmar — momos girando, cuchara entrando al mousse, caja abriéndose. Cubre la mayoría de las ideas de la biblioteca (los guiones GU-01..05 son exactamente ese tipo de escena).
- **HeyGen** (avatares IA que hablan a cámara): formato "alguien te cuenta" — presentadora virtual para promos, anuncios de sabor nuevo, respuestas frecuentes.

**Pipeline (extiende el lazo de §3, mismo patrón que Meta):**
1. Claude escribe el **brief on-brand** (ya diseñado: hook/copy/guion por escenas usando `brand_library` + `marketing_ideas` ganadoras + datos de qué funcionó) → fila en `creatives` estado "Idea".
2. Claude llama la **API de generación** (Higgsfield para clip de producto, HeyGen para avatar, según `formato`) con el guion como prompt → guarda el resultado.
3. El asset entra a `creatives` en estado **"En revisión"** — se reusa el pipeline existente (Idea→En diseño→En revisión→Aprobado→Publicado). **El humano SIEMPRE aprueba antes de publicar; la IA nunca publica sola.**
4. Aprobado → Calendario → publicación → `metrics_daily` cierra el lazo: Claude aprende qué briefs generados rinden y ajusta los siguientes.

**Cambio de esquema (mínimo):** `creatives` gana `generacion jsonb` — `{provider: 'higgsfield'|'heygen', job_id, prompt, costo, generado_en}`. El asset video va a **Supabase Storage** (o queda en el CDN del proveedor y se guarda la URL en `asset_url`, ya existente).

**Para Fase 1 (tareas concretas):** verificar API/pricing vigentes de ambos (HeyGen tiene API pública; Higgsfield confirmar plan API), estimar costo por video vs presupuesto de pauta, y decidir si la generación corre en el cron diario o on-demand desde la app ("✨ Generar video de esta idea").
