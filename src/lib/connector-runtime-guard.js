const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Falta ${label} en el runtime privado del conector.`);
  return normalized;
}

export function supabaseProjectRef(value) {
  let endpoint;
  try { endpoint = new URL(String(value || "").trim()); }
  catch { throw new Error("SUPABASE_URL debe ser una URL completa del proyecto."); }
  if (endpoint.protocol !== "https:") throw new Error("Los conectores MOMOS exigen SUPABASE_URL con HTTPS.");
  const match = endpoint.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!match) throw new Error("SUPABASE_URL no pertenece a un proyecto Supabase remoto identificable.");
  return match[1];
}

export function assertConnectorRuntime({
  supabaseUrl,
  environment,
  projectRef,
  stagingConfirmation,
  productionConfirmation,
} = {}) {
  const actualProjectRef = supabaseProjectRef(supabaseUrl);
  const expectedProjectRef = required(projectRef, "MOMOS_CONNECTOR_PROJECT_REF").toLowerCase();
  const normalizedEnvironment = required(environment, "MOMOS_CONNECTOR_ENVIRONMENT");
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new Error("MOMOS_CONNECTOR_PROJECT_REF no tiene el formato esperado.");
  }
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error("SUPABASE_URL no coincide con MOMOS_CONNECTOR_PROJECT_REF; el worker queda cerrado.");
  }
  if (normalizedEnvironment === "Staging") {
    if (stagingConfirmation !== "CONTROLLED_NON_PRODUCTION") {
      throw new Error("Staging exige MOMOS_CONNECTOR_ALLOW_STAGING=CONTROLLED_NON_PRODUCTION.");
    }
  } else if (normalizedEnvironment === "Produccion") {
    if (productionConfirmation !== "EXPLICIT_PRODUCTION") {
      throw new Error("Produccion exige MOMOS_CONNECTOR_ALLOW_PRODUCTION=EXPLICIT_PRODUCTION.");
    }
  } else {
    throw new Error("MOMOS_CONNECTOR_ENVIRONMENT debe ser Staging o Produccion.");
  }
  return Object.freeze({ environment: normalizedEnvironment, projectRef: actualProjectRef });
}
