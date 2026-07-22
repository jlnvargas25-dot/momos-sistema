import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaConnectorCenter, metaDryRunReceipt, metaReadRequest, normalizeMetaAccountId, reconcileMetaDryRun, validateMetaConnectorConfig } from "./agency-meta-connector.js";

const snapshot = { authorization_id: 40, api_version: "v25.0", expected: { authorization_id: 40, ad_account_id: "act_123456",
  campaign_external_id: "987654", audience_external_id: "456789", target_budget: 340000 } };
const responses = { account: { id: "act_123456", name: "MOMOS", currency: "COP", timezone_name: "America/Bogota", account_status: 1 },
  campaign: { id: "987654", account_id: "123456", name: "Ventas MOMOS", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "400000" },
  audience: { id: "456789", account_id: "123456", name: "Clientes MOMOS" } };

test("normaliza la cuenta publicitaria sin admitir rutas", () => {
  assert.equal(normalizeMetaAccountId("123456"), "act_123456");
  assert.equal(normalizeMetaAccountId("act_123456"), "act_123456");
  assert.throws(() => normalizeMetaAccountId("../me"), /cuenta numérica/i);
});

test("la configuración exige secretos privados, versión y origen oficial", () => {
  const valid = validateMetaConnectorConfig({ accessToken: "t".repeat(80), appSecret: "s".repeat(32), apiVersion: "v25.0", adAccountId: "123456" });
  assert.equal(valid.allowed, true);
  const invalid = validateMetaConnectorConfig({ accessToken: "x", appSecret: "", apiVersion: "latest", adAccountId: "../me", baseUrl: "https://evil.example" });
  assert.equal(invalid.allowed, false);
  assert.equal(invalid.reasons.length, 5);
});

test("cada solicitud es GET al Graph oficial y con campos permitidos", () => {
  const request = metaReadRequest("act_123456", ["id", "name", "currency"], { apiVersion: "v25.0", appSecretProof: "a".repeat(64) });
  assert.equal(request.method, "GET");
  assert.equal(request.url.origin, "https://graph.facebook.com");
  assert.equal(request.url.searchParams.get("fields"), "id,name,currency");
  assert.throws(() => metaReadRequest("123456", ["id{name}"], { apiVersion: "v25.0", appSecretProof: "a".repeat(64) }), /campos inválidos/i);
});

test("concilia cuenta, campaña, audiencia y presupuesto visible sin mutar", () => {
  const result = reconcileMetaDryRun(snapshot, responses, { budgetMinorFactor: 1 });
  assert.equal(result.reconciled, true);
  assert.equal(result.externalMutation, false);
  assert.equal(result.budget.normalized, 400000);
  assert.equal(result.budget.targetBudgetCop, 340000);
});

test("una audiencia de otra cuenta deja el dry-run divergente", () => {
  const result = reconcileMetaDryRun(snapshot, { ...responses, audience: { ...responses.audience, account_id: "999" } });
  assert.equal(result.reconciled, false);
  assert.equal(result.matches.audience, false);
});

test("el recibo demuestra tres GET y ninguna mutación", () => {
  const receipt = metaDryRunReceipt(snapshot, responses, { budgetMinorFactor: 1 });
  assert.equal(receipt.requests.length, 3);
  assert.equal(receipt.requests.every((request) => request.method === "GET" && request.host === "graph.facebook.com"), true);
  assert.equal(receipt.external_mutation, false);
  assert.equal("access_token" in receipt, false);
});

test("el centro separa candidatos de verificaciones ya preparadas", () => {
  const center = buildMetaConnectorCenter({ agencyMetaInvestmentAuthorizations: [{ id: 1, status: "Autorizada" }, { id: 2, status: "Autorizada" }],
    agencyMetaConnectorDryRuns: [{ id: 8, authorizationId: 1, status: "Conciliado" }, { id: 9, authorizationId: 3, status: "Incierto" }] });
  assert.deepEqual(center.candidates.map((item) => item.id), [2]);
  assert.equal(center.summary.reconciled, 1);
  assert.equal(center.summary.uncertain, 1);
});
