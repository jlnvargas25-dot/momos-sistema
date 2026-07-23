// Governed bridge Agencia MOMOS -> Pide MOMOS.
//
// sourceAssetId and sourceSha256 identify the approved private master.
// url points only to the optimized public derivative, never to the original.
const APPROVED_VARIANT_MEDIA = Object.freeze([
  Object.freeze({
    productId: "PR01",
    figure: "Toby",
    flavor: null,
    role: "variant_thumbnail",
    sourceAssetId: 125,
    sourceSha256: "03a3fba95e652088f7b3ad7800575ff2d355bd2177c4a448d4b153397a3ab0d9",
    derivativeSha256: "88378fbc17317a841ab972c952dcea2bb3d001cfcfd0f06e544d7fbdd3d09679",
    width: 720,
    height: 960,
    url: "/catalog/pr01/toby-front.webp",
    alt: "Figura Toby de MOMOS, limpia y sin escarcha, vista frontal.",
  }),
]);

export function approvedMediaForProduct(productId, figures = []) {
  const id = String(productId || "").trim();
  const allowedFigures = new Set(
    figures
      .filter((figure) => String(figure?.product_id || "").trim() === id)
      .map((figure) => String(figure?.figura || "").trim()),
  );

  return APPROVED_VARIANT_MEDIA.filter(
    (media) => media.productId === id && allowedFigures.has(media.figure),
  );
}

export { APPROVED_VARIANT_MEDIA };
