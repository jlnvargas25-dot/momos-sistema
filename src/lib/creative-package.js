const APPROVED_BRIEF_STATES = new Set(["Aprobado", "En producción", "Completado"]);
const CHANNELS = new Set(["Instagram", "Facebook", "TikTok", "WhatsApp", "Rappi", "Referidos", "Influencer", "Orgánico"]);

const clean = (value) => String(value || "").trim();
const normalized = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function resolveProduct(db, productId) {
  if (!productId) return null;
  return (db.products || []).find((product) => product.id === productId) || null;
}

function brandLibrary(db) {
  const source = db.brand_library || {};
  return {
    phrases: Array.isArray(source.frases) ? source.frases.map(clean).filter(Boolean) : [],
    tone: Array.isArray(source.tono) ? source.tono.map(clean).filter(Boolean) : [],
    preferred: Array.isArray(source.palabrasSi) ? source.palabrasSi.map(clean).filter(Boolean) : [],
    forbidden: Array.isArray(source.palabrasNo) ? source.palabrasNo.map(clean).filter(Boolean) : [],
  };
}

function containsTerm(text, term) {
  const haystack = normalized(text);
  const needle = normalized(term);
  return needle.length > 0 && haystack.includes(needle);
}

function allowedPhrase(phrase, forbidden) {
  return !forbidden.some((term) => containsTerm(phrase, term));
}

function channelFor(brief) {
  const channel = clean(brief?.channel);
  return CHANNELS.has(channel) ? channel : "Instagram";
}

function formatFor(channel, objective) {
  if (channel === "WhatsApp" || channel === "Referidos") return "Copy";
  if (channel === "Rappi") return "Foto producto";
  if (channel === "TikTok" || channel === "Influencer") return "Video UGC";
  if (channel === "Facebook") return "Carrusel";
  if (normalized(objective).includes("branding")) return "Carrusel";
  return "Reel";
}

function ctaFor(channel) {
  if (channel === "WhatsApp") return "Escríbenos por WhatsApp y te ayudamos a elegir tu MOMOS.";
  if (channel === "Rappi") return "Encuéntralo en Rappi y confirma la disponibilidad antes de pedir.";
  if (channel === "Referidos") return "Compártelo con la persona con quien vivirías este momento MOMOS.";
  return "Escríbenos y confirma qué sabores y figuras están disponibles hoy.";
}

function objectiveFamily(objective) {
  const value = normalized(objective);
  if (value.includes("cumple")) return "birthday";
  if (value.includes("recompra") || value.includes("reactiva")) return "retention";
  if (value.includes("contenido") || value.includes("branding")) return "brand";
  if (value.includes("lanzamiento")) return "launch";
  return "sales";
}

function hooksFor({ productName, family, phrase }) {
  const product = productName || "MOMOS";
  const byFamily = {
    birthday: [
      "Hoy el regalo más tierno tiene tu nombre",
      `Un cumpleaños también puede sentirse como un momento ${product}`,
      "Una sorpresa dulce para celebrar a alguien especial",
    ],
    retention: [
      "Hay antojos que se sienten como volver a casa",
      `Tu próximo momento ${product} puede empezar hoy`,
      "La ternura que ya conoces tiene una nueva sorpresa",
    ],
    brand: [
      `Así se vive un momento ${product}`,
      `Lo que hace especial a ${product}, visto de cerca`,
      "Ternura por fuera, sorpresa por dentro",
    ],
    launch: [
      `${product} acaba de sumar una nueva sorpresa`,
      `Conoce la nueva forma de disfrutar ${product}`,
      `Un nuevo integrante llegó a la familia MOMOS`,
    ],
    sales: [
      `${product}: ternura por fuera, sorpresa por dentro`,
      `El antojo que te cambia el día llegó en forma de ${product}`,
      phrase || `Adopta tu ${product} favorito`,
    ],
  };
  return byFamily[family] || byFamily.sales;
}

function bodyFor({ family, productName, preferredWord }) {
  const product = productName || "un MOMOS hecho para sorprender";
  const word = preferredWord || "sorpresa";
  if (family === "birthday") return `Celebra con ${product}: una ${word} dulce, cercana y pensada para compartir.`;
  if (family === "retention") return `Vuelve a disfrutar ${product}. Te contamos las opciones disponibles para que elijas sin presión.`;
  if (family === "brand") return `Detrás de ${product} hay preparación, detalle y una experiencia diseñada para despertar ternura.`;
  if (family === "launch") return `Presentamos ${product}, una nueva opción de la familia MOMOS para descubrir y compartir.`;
  return `Descubre ${product} y elige entre las figuras y sabores disponibles en la cocina de MOMOS.`;
}

function scriptFor({ format, productName, selectedHook, cta }) {
  const product = productName || "MOMOS";
  if (format === "Copy") return [
    `Apertura: ${selectedHook}.`,
    `Contexto: presenta ${product} y la razón del contacto en una sola frase.`,
    `Cierre: ${cta}`,
  ];
  if (format === "Carrusel") return [
    `Lámina 1: ${selectedHook}.`,
    `Lámina 2: acercamiento al detalle más apetitoso de ${product}.`,
    "Lámina 3: explica la experiencia o beneficio sin promesas no verificadas.",
    `Lámina 4: ${cta}`,
  ];
  if (format === "Foto producto") return [
    `Imagen principal: ${product} completo, reconocible y bien iluminado.`,
    "Apoyo: mostrar empaque real y escala del producto.",
    `Texto: ${selectedHook}.`,
  ];
  return [
    `0–2 s · Hook visual y texto: ${selectedHook}.`,
    `3–6 s · Mostrar ${product} completo y luego un acercamiento a su textura.`,
    "7–10 s · Momento de consumo o reacción natural; manos limpias y entorno cuidado.",
    `11–15 s · Cierre en pantalla: ${cta}`,
  ];
}

function measurementFor(channel, objective) {
  const family = objectiveFamily(objective);
  if (channel === "WhatsApp") return { primaryKpi: "Conversaciones calificadas", secondaryKpi: "Pedidos pagados atribuidos", attribution: "Registrar campaña y creativo en cada pedido originado por el mensaje." };
  if (family === "brand") return { primaryKpi: "Retención o guardados", secondaryKpi: "Mensajes y visitas al perfil", attribution: "Relacionar la publicación con su creativo y registrar métricas de plataforma por fecha." };
  return { primaryKpi: "Pedidos pagados atribuidos", secondaryKpi: "Costo por conversación", attribution: "No usar pedidos digitados en métricas: la venta válida debe venir del pedido pagado enlazado." };
}

export function auditCreativePackage(pkg, brief = {}, db = {}) {
  const brand = brandLibrary(db);
  const errors = [];
  const warnings = [];
  const customerFacing = [pkg.selectedHook, pkg.copy, ...(pkg.script || [])].join(" ");
  const forbiddenHits = brand.forbidden.filter((term) => containsTerm(customerFacing, term));
  if (forbiddenHits.length) errors.push(`Usa vocabulario prohibido por la marca: ${forbiddenHits.join(", ")}.`);
  if (brief.productId) {
    const product = resolveProduct(db, brief.productId);
    if (!product) errors.push("El producto foco ya no existe.");
    else if (product.activo === false) errors.push("El producto foco está inactivo.");
  } else if (["sales", "launch"].includes(objectiveFamily(brief.objective))) {
    warnings.push("El brief no tiene producto foco; el paquete habla de MOMOS de forma general.");
  }
  if (clean(brief.offer) && !APPROVED_BRIEF_STATES.has(brief.status)) {
    warnings.push("La oferta se omitió porque el brief todavía no está aprobado.");
  }
  if (!CHANNELS.has(clean(brief.channel))) warnings.push("El canal se normalizó a Instagram porque el brief no tenía un canal ejecutable.");
  if (!clean(pkg.copy) || !clean(pkg.selectedHook) || !(pkg.script || []).length) errors.push("El paquete quedó incompleto.");
  return { passed: errors.length === 0, errors, warnings, forbiddenHits };
}

export function buildCreativePackage(brief = {}, db = {}, variant = 0) {
  const brand = brandLibrary(db);
  const product = resolveProduct(db, brief.productId);
  const productName = product?.nombre || "MOMOS";
  const channel = channelFor(brief);
  const format = formatFor(channel, brief.objective);
  const family = objectiveFamily(brief.objective);
  const safePhrase = brand.phrases.find((phrase) => allowedPhrase(phrase, brand.forbidden)) || "El antojo que te cambia el día.";
  const safePreferred = brand.preferred.find((word) => allowedPhrase(word, brand.forbidden)) || "sorpresa";
  const hooks = hooksFor({ productName, family, phrase: safePhrase }).filter((hook) => allowedPhrase(hook, brand.forbidden));
  const hookIndex = hooks.length ? Math.abs(Number(variant) || 0) % hooks.length : 0;
  const selectedHook = hooks[hookIndex] || `Un momento ${productName}`;
  const cta = ctaFor(channel);
  const approvedOffer = APPROVED_BRIEF_STATES.has(brief.status) ? clean(brief.offer) : "";
  const body = bodyFor({ family, productName, preferredWord: safePreferred });
  const copy = [selectedHook, body, approvedOffer, cta].filter(Boolean).join("\n\n");
  const script = scriptFor({ format, productName, selectedHook, cta });
  const shotList = format === "Copy" ? ["Sin producción audiovisual obligatoria"] : [
    `${productName} completo y fiel al producto real`,
    "Detalle de textura o relleno sin alterar su apariencia",
    "Empaque MOMOS limpio y marca legible",
    "Cierre con espacio seguro para CTA",
  ];
  const prompt = [
    `Crear una pieza ${format} para ${channel} de D'Momos Sweet Love.`,
    `Producto foco: ${productName}. Objetivo: ${brief.objective || "Ventas"}.`,
    `Concepto: ${selectedHook}. Tono: ${brand.tone.join(", ") || "tierno, premium y cercano"}.`,
    "Usar los colores, tipografía, empaque y proporciones reales de la marca; iluminación cálida, composición limpia y apetecible.",
    `Planos requeridos: ${shotList.join("; ")}. No agregar precios, descuentos ni afirmaciones que no estén en el brief aprobado.`,
  ].join(" ");
  const negativePrompt = [...brand.forbidden, "logos inventados", "productos deformes", "texto ilegible", "colores ajenos a la marca", "promesas no verificadas"].filter(Boolean).join(", ");
  const pkg = {
    briefId: brief.id || null,
    title: `${productName} · ${brief.objective || "Contenido"} · ${format}`,
    productId: product?.id || null,
    productName,
    campaignId: brief.campaignId || null,
    objective: brief.objective || "Ventas",
    channel,
    format,
    hooks,
    selectedHook,
    hookIndex,
    copy,
    cta,
    script,
    shotList,
    prompt,
    negativePrompt,
    measurement: measurementFor(channel, brief.objective),
    brandSnapshot: { phrases: brand.phrases, tone: brand.tone, preferred: brand.preferred, forbidden: brand.forbidden },
    source: { insight: clean(brief.insight), evidence: brief.evidence || {}, offerIncluded: Boolean(approvedOffer), briefStatus: brief.status || "Borrador" },
  };
  return { ...pkg, audit: auditCreativePackage(pkg, brief, db) };
}
