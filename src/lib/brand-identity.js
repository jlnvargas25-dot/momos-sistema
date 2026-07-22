const DEFAULT_COLORS = [
  ["background", "Crema MOMOS", "#FAF4EC", "Fondo general cálido"],
  ["surface", "Blanco cálido", "#FFFFFF", "Tarjetas y superficies"],
  ["text", "Chocolate", "#54382B", "Texto y títulos"],
  ["muted", "Cacao suave", "#8A6C5B", "Texto secundario"],
  ["primary", "Coral MOMOS", "#E5714E", "Acciones principales"],
  ["rose", "Rosa tierno", "#F3D7DC", "Acentos emocionales"],
  ["accent", "Vainilla", "#F7ECD9", "Fondos de apoyo"],
];

const safeArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];

function fallbackColors(profile) {
  const palette = safeArray(profile?.visual?.palette);
  return DEFAULT_COLORS.map(([token, label, fallback, usage], index) => ({
    token, label, colorHex: palette[index] || fallback, contrastHex: token === "surface" || token === "background" || token === "rose" || token === "accent" ? "#54382B" : "#FFFFFF", usage,
  }));
}

export function buildBrandIdentityView(identity, governedProfile = null) {
  const fallback = governedProfile?.profile || {};
  const dto = identity && typeof identity === "object" ? identity : {};
  const profile = dto.profile?.profile || fallback;
  const rawColors = Array.isArray(dto.colors) && dto.colors.length ? dto.colors : fallbackColors(profile);
  const colors = rawColors.map((color) => ({
    token: color.token || "accent",
    label: color.label || color.token || "Color MOMOS",
    colorHex: color.color_hex || color.colorHex || "#FAF4EC",
    contrastHex: color.contrast_hex || color.contrastHex || "#54382B",
    usage: color.usage || "Uso definido por la identidad de marca",
  }));
  const logos = (Array.isArray(dto.assets) ? dto.assets : []).map((binding) => ({
    bindingId: binding.binding_id,
    role: binding.role || "principal",
    background: binding.background || "Cualquiera",
    channels: safeArray(binding.channels),
    minWidthPx: Number(binding.min_width_px || 48),
    clearSpaceRatio: Number(binding.clear_space_ratio || 0.25),
    assetId: binding.asset?.id,
    name: binding.asset?.name || "Logo MOMOS",
    mimeType: binding.asset?.mime_type || "",
    width: binding.asset?.width || null,
    height: binding.asset?.height || null,
    signedUrl: binding.asset?.signed_url || binding.asset?.signedUrl || "",
  }));
  const errors = safeArray(dto.errors);
  const serverAvailable = dto.available === true;
  const ready = dto.ready === true;
  return {
    serverAvailable,
    ready,
    enforcementEnabled: dto.enforcement_enabled === true,
    version: Number(dto.kit?.version || governedProfile?.version || 1),
    fingerprint: dto.kit?.fingerprint || governedProfile?.fingerprint || "",
    name: profile?.identity?.brand_name || "MOMOS",
    businessName: profile?.identity?.business_name || "D'Momos Sweet Love",
    positioning: profile?.identity?.positioning || "Postres premium, tiernos y antojables.",
    personality: safeArray(profile?.identity?.personality),
    tone: safeArray(profile?.verbal?.tone),
    approvedPhrases: safeArray(profile?.verbal?.approved_phrases),
    allowedWords: safeArray(profile?.verbal?.allowed_words),
    bannedWords: safeArray(profile?.verbal?.banned_words),
    colors,
    typography: {
      display: profile?.visual?.typography?.display || "Fraunces",
      body: profile?.visual?.typography?.body || "Nunito Sans",
    },
    logoRules: profile?.visual?.logo_rules || {},
    visualStyle: safeArray(profile?.visual?.style),
    production: profile?.production || {},
    contentModes: profile?.content_modes || {},
    logos,
    errors,
    statusLabel: ready ? "Identidad oficial lista" : serverAvailable ? "Falta completar la identidad" : "Identidad base disponible",
    sourceLabel: serverAvailable ? `Kit oficial V${Number(dto.kit?.version || 1)}` : `Perfil de marca V${Number(governedProfile?.version || 1)}`,
  };
}

export function brandIdentitySummary(identity) {
  return {
    officialLogos: identity.logos.length,
    colors: identity.colors.length,
    rules: [identity.typography.display, identity.typography.body, ...identity.visualStyle].filter(Boolean).length,
    needsAttention: !identity.ready,
  };
}

