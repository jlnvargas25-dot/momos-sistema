import test from "node:test";
import assert from "node:assert/strict";
import { creativeFlightForContract } from "./agency-creative-flight.js";
import { AGENCY_TARGET_IDS, agencyTargetRoute } from "./agency-route-map.js";
import { AGENCY_ACTION_TARGET_IDS } from "./agency-action-queue.js";

test("cada etapa del recorrido creativo tiene un destino funcional declarado", () => {
  const flight = creativeFlightForContract({
    id: 1,
    status: "Aprobado",
    sealedPayload: { creative_direction: { content_mode: "Orgánico" } },
  }, {});

  for (const stage of flight.stages) {
    assert.ok(agencyTargetRoute(stage.target), `${stage.label} quedó sin ruta para ${stage.target}`);
  }
});

test("el mapa no contiene rutas vacías ni destinos avanzados incompletos", () => {
  assert.ok(AGENCY_TARGET_IDS.length >= 10);
  for (const target of AGENCY_TARGET_IDS) {
    const route = agencyTargetRoute(target);
    assert.ok(route);
    if (route.kind === "advanced") {
      assert.ok(route.area, `${target} no declara área`);
      assert.ok(route.detail, `${target} no declara detalle`);
    } else {
      assert.equal(route.kind, "module");
      assert.ok(route.module, `${target} no declara módulo`);
    }
  }
});

test("cada acción del centro humano llega a un módulo o panel visible", () => {
  for (const target of AGENCY_ACTION_TARGET_IDS) {
    assert.ok(agencyTargetRoute(target), `La acción ${target} no tiene continuidad visual`);
  }
});
