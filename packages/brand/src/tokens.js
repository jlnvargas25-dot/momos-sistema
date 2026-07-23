// Tokens de marca MOMOS en JS — espejo de theme.css para uso programático
// (estilos inline, lógica de canvas, generación de assets, etc.).
// Mantener sincronizado con ../theme.css. Fuente original: tema `T` de OPS.

export const colors = {
  crema: "#FAF4EC",
  surface: "#FFFFFF",
  soft: "#FFF9F1",
  line: "#EEDFCE",
  choco: "#54382B",
  cocoa: "#8A6C5B",
  rosa: "#F3D7DC",
  rosaDeep: "#C4808E",
  vainilla: "#F7ECD9",
  coral: "#E5714E",
  coralSoft: "#FBE3DA",
};

export const fonts = {
  display: '"Fraunces", Georgia, "Times New Roman", serif',
  body: '"Nunito Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const radius = {
  momo: "1.25rem",
  momoLg: "1.75rem",
};

export const shadow = {
  soft: "0 6px 18px rgba(84, 56, 43, 0.08)",
  momo: "0 10px 30px rgba(84, 56, 43, 0.10)",
};

export const easing = {
  spring: "cubic-bezier(0.16, 1, 0.3, 1)",
};

// Identidad verbal base (fallbacks de src/lib/brand-identity.js).
// El kit oficial gobernado en OPS puede sobreescribir estos valores.
export const identity = {
  name: "MOMOS",
  businessName: "D'Momos Sweet Love",
  positioning: "Postres premium, tiernos y antojables.",
};
