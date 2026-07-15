import test from "node:test";
import assert from "node:assert/strict";
import {
  canAutoStartMomobot,
  isCurrentMomobotAuthorization,
  momobotModeAfterExecution,
  momobotModeAfterReadOnly,
  MOMOBOT_READ_ONLY_TURN_LIMIT,
} from "./momobot-session.js";

test("el autoarranque solo ocurre con permiso y una sesión realmente libre", () => {
  assert.equal(canAutoStartMomobot({ permissionState: "granted" }), true);
  for (const permissionState of ["prompt", "denied", undefined]) {
    assert.equal(canAutoStartMomobot({ permissionState }), false, String(permissionState));
  }
  for (const busyState of [
    { sessionActive: true },
    { speechInProgress: true },
    { hasDraft: true },
    { authorizing: true },
  ]) {
    assert.equal(canAutoStartMomobot({ permissionState: "granted", ...busyState }), false, JSON.stringify(busyState));
  }
});

test("una consulta informativa vuelve al estado correcto sin perder la acción pendiente", () => {
  assert.equal(momobotModeAfterReadOnly({ handsFree: false }), "idle");
  assert.equal(momobotModeAfterReadOnly({ handsFree: true, readOnlyTurns: 1 }), "followup");
  assert.equal(momobotModeAfterReadOnly({ handsFree: true, readOnlyTurns: 1, hasPendingDraft: true, draftCanExecute: true }), "action");
  assert.equal(momobotModeAfterReadOnly({ handsFree: true, readOnlyTurns: 1, hasPendingDraft: true, draftCanExecute: false }), "followup");
  assert.equal(momobotModeAfterReadOnly({ handsFree: true, readOnlyTurns: MOMOBOT_READ_ONLY_TURN_LIMIT, hasPendingDraft: true, draftCanExecute: true }), "standby");
});

test("una autorización tardía nunca puede reabrir una sesión cancelada", () => {
  assert.equal(isCurrentMomobotAuthorization(4, 4), true);
  assert.equal(isCurrentMomobotAuthorization(4, 5), false);
  assert.equal(isCurrentMomobotAuthorization(undefined, undefined), false);
});

test("matriz adversarial: ninguna combinación ocupada permite autoarranque", () => {
  const fields = ["sessionActive", "speechInProgress", "hasDraft", "authorizing"];
  for (let mask = 0; mask < 2 ** fields.length; mask += 1) {
    const state = Object.fromEntries(fields.map((field, index) => [field, Boolean(mask & (1 << index))]));
    assert.equal(
      canAutoStartMomobot({ permissionState: "granted", ...state }),
      mask === 0,
      JSON.stringify(state),
    );
  }
});

test("matriz adversarial: toda consulta encadenada tiene un único destino seguro", () => {
  const draftStates = [
    { name: "sin borrador", hasPendingDraft: false, draftCanExecute: false },
    { name: "borrador incompleto", hasPendingDraft: true, draftCanExecute: false },
    { name: "borrador confirmable", hasPendingDraft: true, draftCanExecute: true },
  ];
  for (const handsFree of [false, true]) {
    for (let readOnlyTurns = 0; readOnlyTurns <= MOMOBOT_READ_ONLY_TURN_LIMIT + 1; readOnlyTurns += 1) {
      for (const draftState of draftStates) {
        const actual = momobotModeAfterReadOnly({ handsFree, readOnlyTurns, ...draftState });
        const expected = !handsFree
          ? "idle"
          : readOnlyTurns >= MOMOBOT_READ_ONLY_TURN_LIMIT
            ? "standby"
            : draftState.hasPendingDraft && draftState.draftCanExecute
              ? "action"
              : "followup";
        assert.equal(actual, expected, `${handsFree}/${readOnlyTurns}/${draftState.name}`);
      }
    }
  }
});

test("solo una acción exitosa y manos libres abre el siguiente turno", () => {
  for (const handsFree of [false, true]) {
    for (const voiceAvailable of [false, true]) {
      for (const succeeded of [false, true]) {
        assert.equal(
          momobotModeAfterExecution({ handsFree, voiceAvailable, succeeded }),
          handsFree && voiceAvailable && succeeded ? "dictation" : "standby",
          `${handsFree}/${voiceAvailable}/${succeeded}`,
        );
      }
    }
  }
});
