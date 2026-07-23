import { colors, fonts } from "./tokens.js";

/*
  Logo oficial MOMOS.

  El logo REAL es un activo gobernado que vive en el bucket privado
  `brand-assets` de Supabase (ver src/lib/brand-studio.js · isOfficialBrandLogo).
  Un app público de invitado (Pide) NO puede leer ese signed-URL. Por eso este
  componente:

    • Si recibe `src` (una URL pública ya publicada del logo oficial) lo pinta.
    • Si no, cae a un monograma tipográfico en Fraunces, fiel a la paleta.

  Cuando publiquemos el logo oficial a un lugar público, se pasa por `src`
  y este fallback deja de verse. No hay que tocar nada más.
*/
export function MomosLogo({
  src = "",
  variant = "full", // "full" | "wordmark" | "mark"
  size = 40,
  tagline = true,
  className = "",
  title = "MOMOS · D'Momos Sweet Love",
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={title}
        className={className}
        style={{ height: size, width: "auto", display: "block" }}
      />
    );
  }

  const mark = (
    <span
      aria-hidden="true"
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: colors.coral,
        color: colors.crema,
        fontFamily: fonts.display,
        fontWeight: 700,
        fontSize: size * 0.56,
        lineHeight: 1,
        boxShadow: "0 4px 12px rgba(229,113,78,0.28)",
        flexShrink: 0,
      }}
    >
      m
    </span>
  );

  if (variant === "mark") {
    return (
      <span role="img" aria-label={title} className={className} style={{ display: "inline-flex" }}>
        {mark}
      </span>
    );
  }

  const words = (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: size * 0.62,
          letterSpacing: "0.01em",
          color: colors.choco,
        }}
      >
        MOMOS
      </span>
      {tagline && (
        <span
          style={{
            fontFamily: fonts.body,
            fontWeight: 700,
            fontSize: size * 0.24,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: colors.cocoa,
            marginTop: size * 0.1,
          }}
        >
          D'Momos · Sweet Love
        </span>
      )}
    </span>
  );

  return (
    <span
      role="img"
      aria-label={title}
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3 }}
    >
      {variant === "full" && mark}
      {words}
    </span>
  );
}

export default MomosLogo;
