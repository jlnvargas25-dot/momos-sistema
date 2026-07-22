import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHumanizationCommunity } from "./humanization-community.js";

function envelope(overrides = {}) {
  return { fingerprint: "a".repeat(64), snapshot: {
    schema_version: "momos-humanization-community/v1", generated_at: "2026-07-22T12:00:00Z",
    series: [{ id: 1, series_key: "dulce-antojo-humano", version: 1, name: "Dulce antojo humano",
      purpose: "Mostrar rituales reales alrededor de MOMOS.", protagonist: "Equipo", emotional_territory: "Antojo",
      mode: "Orgánico", channel: "Instagram", status: "Aprobada", source_formula_id: null,
      editorial_contract: { audience: "Personas curiosas", hook: "La bolsa se abre", narrative_formula: "Ritual y payoff",
        ritual: "Primera cucharada", tone: "Cercano", format: "Reel 9:16", evidence: "Producto real",
        cta: "Contanos tu favorito", frequency: "Semanal", fixed_elements: ["Bolsa"],
        allowed_variables: ["Figura"], restrictions: ["Sin testimonios inventados"] },
      series_fingerprint: "b".repeat(64), source_kind: "Humano", prepared_at: "2026-07-22", reviewed_at: "2026-07-22" }],
    episodes: [{ id: 2, episode_key: "max-cucharada", series_id: 1, title: "Max sale de la bolsa",
      story_kind: "Momento de equipo", representation: "Persona real", status: "Aprobado", production_pack_id: 9,
      source_formula_id: null, source_brief_id: null, source_creative_id: "CRE-1",
      episode_contract: { angle: "Antojo inmediato", cta: "Cuál probarías", hook: "Mirá lo que saqué",
        privacy_note: "Sin datos personales", proof: "Bolsa y producto reales", single_variable: "Figura Max",
        story_arc: "Bolsa, descubrimiento, cucharada", synthetic_disclosure: "" }, episode_fingerprint: "c".repeat(64),
      source_kind: "Agente", prepared_at: "2026-07-22", reviewed_at: "2026-07-22", post_id: "CAL-1",
      linked_at: "2026-07-22", pack_readiness: { ready: true, reasons: [] } }],
    signals: [{ id: 3, signal_key: "sig-max-01", episode_id: 2, platform: "Meta", window_start: "2026-07-20",
      window_end: "2026-07-22", impressions: 1400, reach: 900, comments_total: 12, meaningful_comments: 5,
      questions: 2, shares: 3, saves: 4, mentions: 1, authorized_ugc: 0, recurring_conversations: 1,
      character_associations: 2, connection_signals: 16, themes: [{ theme: "Personaje", count: 6, sentiment: "Positivo" }],
      evidence_fingerprint: "d".repeat(64), source_kind: "Conector", recorded_at: "2026-07-22",
      outcome: "Prometedora", decided_at: "2026-07-22" }],
    summary: { series: 1, approved_series: 1, episodes: 1, approved_episodes: 1, signal_windows: 1 },
    metric_definitions: { reach: "alcance diario agregado", connection_signals: "señales agregadas",
      views_alone_can_win: false, attribution_is_causality: false },
    privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_raw_comments: false,
      contains_handles: false, contains_direct_messages: false, contains_secrets: false, contains_order_ids: false },
    capabilities: { can_propose: true, can_read_aggregates: true, can_approve: false, can_reply: false,
      can_contact: false, can_publish: false, can_reuse_ugc: false, can_change_budget: false },
    human_approval_required: true, external_execution_allowed: false, ...overrides,
  } };
}

test("normaliza series, episodios y señales sin duplicar métricas ni activos", () => {
  const result = normalizeHumanizationCommunity(envelope());
  assert.equal(result.series[0].protagonist, "Equipo");
  assert.equal(result.episodes[0].packReadiness.ready, true);
  assert.equal(result.signals[0].connectionSignals, 16);
  assert.equal(result.externalExecutionAllowed, false);
});

test("falla cerrado ante comentarios crudos, PII o capacidades externas", () => {
  assert.throws(() => normalizeHumanizationCommunity(envelope({ raw_comment: "Me encantó" })), /campo privado/);
  assert.throws(() => normalizeHumanizationCommunity(envelope({ profile_url: "https://social/user" })), /campo privado/);
  assert.throws(() => normalizeHumanizationCommunity(envelope({ audience_note: "Escribime a persona@example.com" })), /PII/);
  assert.throws(() => normalizeHumanizationCommunity(envelope({ capabilities: {
    ...envelope().snapshot.capabilities, can_reply: true,
  } })), /capacidades peligrosas/);
});

test("vistas solas nunca se convierten en conexión ganadora", () => {
  assert.throws(() => normalizeHumanizationCommunity(envelope({ metric_definitions: {
    ...envelope().snapshot.metric_definitions, views_alone_can_win: true,
  } })), /sin evidencia/);
});
