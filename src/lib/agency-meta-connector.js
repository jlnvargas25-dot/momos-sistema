const text = (value) => String(value ?? "").trim();
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export const META_GRAPH_ORIGIN = "https://graph.facebook.com";
export const META_DRY_RUN_STATUSES = Object.freeze(["Preparado", "Arrendado", "Leyendo", "Conciliado", "Divergente", "Fallido", "Incierto", "Cancelado"]);

export function normalizeMetaAccountId(value) {
  const raw = text(value);
  if (!/^(?:act_)?[0-9]{3,40}$/.test(raw)) throw new Error("META_AD_ACCOUNT_ID debe ser una cuenta numérica de Ads Manager.");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export function validateMetaConnectorConfig({ accessToken, appSecret, apiVersion, adAccountId, baseUrl = META_GRAPH_ORIGIN } = {}) {
  const reasons = [];
  if (text(accessToken).length < 40) reasons.push("Falta META_ACCESS_TOKEN privado.");
  if (text(appSecret).length < 16) reasons.push("Falta META_APP_SECRET privado para appsecret_proof.");
  if (!/^v[0-9]{1,2}\.[0-9]+$/.test(text(apiVersion))) reasons.push("META_GRAPH_API_VERSION debe verse como v25.0.");
  try { normalizeMetaAccountId(adAccountId); } catch (error) { reasons.push(error.message); }
  try { if (new URL(baseUrl).origin !== META_GRAPH_ORIGIN) reasons.push("El destino no es Graph API oficial."); }
  catch { reasons.push("META_GRAPH_BASE_URL no es una URL válida."); }
  return { allowed: reasons.length === 0, reasons };
}

export function metaReadRequest(pathId, fields, { apiVersion, appSecretProof, baseUrl = META_GRAPH_ORIGIN } = {}) {
  const id = text(pathId);
  const fieldList = Array.isArray(fields) ? fields.map(text).filter(Boolean) : [];
  if (!/^(?:act_)?[A-Za-z0-9._:-]{3,180}$/.test(id) || fieldList.length === 0 || fieldList.some((field) => !/^[a-z0-9_]+$/i.test(field))) {
    throw new Error("La lectura Meta contiene una identidad o campos inválidos.");
  }
  if (!/^v[0-9]{1,2}\.[0-9]+$/.test(text(apiVersion)) || !/^[0-9a-f]{64}$/.test(text(appSecretProof))) {
    throw new Error("Falta versión o appsecret_proof válido.");
  }
  const url = new URL(`${text(apiVersion)}/${id}`, `${baseUrl}/`);
  if (url.origin !== META_GRAPH_ORIGIN) throw new Error("Destino Meta no permitido.");
  url.searchParams.set("fields", fieldList.join(","));
  url.searchParams.set("appsecret_proof", text(appSecretProof));
  return { method: "GET", url, redirect: "error" };
}

function accountId(value) {
  const raw = typeof value === "object" ? value?.id : value;
  return text(raw).replace(/^act_/, "");
}

function rawCampaignBudget(campaign) {
  if (text(campaign.daily_budget)) return { owner: "campaign", period: "daily", raw: text(campaign.daily_budget) };
  if (text(campaign.lifetime_budget)) return { owner: "campaign", period: "lifetime", raw: text(campaign.lifetime_budget) };
  return { owner: "adset_or_unavailable", period: "unknown", raw: "" };
}

export function reconcileMetaDryRun(snapshotInput, responseInput, { budgetMinorFactor = null } = {}) {
  const snapshot = object(snapshotInput); const responses = object(responseInput);
  const expected = object(snapshot.expected); const account = object(responses.account);
  const campaign = object(responses.campaign); const audience = object(responses.audience);
  const expectedAccount = accountId(expected.ad_account_id);
  const budget = rawCampaignBudget(campaign);
  const factor = number(budgetMinorFactor);
  const normalizedBudget = budget.raw && factor && factor > 0 ? Number(budget.raw) / factor : null;
  const matches = {
    account: accountId(account.id) === expectedAccount,
    campaign: text(campaign.id) === text(expected.campaign_external_id) && accountId(campaign.account_id) === expectedAccount,
    audience: text(audience.id) === text(expected.audience_external_id) && accountId(audience.account_id) === expectedAccount,
    authorization: Number(expected.authorization_id) === Number(snapshot.authorization_id),
    campaignBudgetVisible: budget.owner === "campaign",
  };
  const reconciled = Object.values(matches).every(Boolean);
  return { reconciled, matches, budget: { ...budget, normalized: normalizedBudget, currency: text(account.currency),
      targetBudgetCop: Number(expected.target_budget || 0), comparable: normalizedBudget != null && text(account.currency) === "COP" },
    account: { id: text(account.id), name: text(account.name), currency: text(account.currency), timezoneName: text(account.timezone_name), status: text(account.account_status) },
    campaign: { id: text(campaign.id), name: text(campaign.name), accountId: accountId(campaign.account_id), status: text(campaign.status),
      effectiveStatus: text(campaign.effective_status), objective: text(campaign.objective), buyingType: text(campaign.buying_type) },
    audience: { id: text(audience.id), name: text(audience.name), accountId: accountId(audience.account_id) },
    externalMutation: false };
}

export function metaDryRunReceipt(snapshot, responses, options = {}) {
  const result = reconcileMetaDryRun(snapshot, responses, options);
  return { schema_version: 1, api_version: text(snapshot?.api_version), mode: "Read-only", external_mutation: false,
    requests: ["account", "campaign", "audience"].map((resource) => ({ resource, method: "GET", host: "graph.facebook.com" })),
    ...result };
}

export function buildMetaConnectorCenter(db = {}) {
  const rows = Array.isArray(db.agencyMetaConnectorDryRuns) ? db.agencyMetaConnectorDryRuns : [];
  const byAuthorization = new Map(rows.map((row) => [String(row.authorizationId), row]));
  const authorizations = Array.isArray(db.agencyMetaInvestmentAuthorizations) ? db.agencyMetaInvestmentAuthorizations : [];
  return { dryRuns: rows, candidates: authorizations.filter((authorization) => authorization.status === "Autorizada" && !byAuthorization.has(String(authorization.id))),
    summary: { total: rows.length, prepared: rows.filter((row) => ["Preparado", "Arrendado", "Leyendo"].includes(row.status)).length,
      reconciled: rows.filter((row) => row.status === "Conciliado").length, divergent: rows.filter((row) => row.status === "Divergente").length,
      uncertain: rows.filter((row) => row.status === "Incierto").length } };
}
