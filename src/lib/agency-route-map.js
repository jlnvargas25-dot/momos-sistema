const ROUTES = Object.freeze({
  "agency-collaboration-desk": { kind: "advanced", area: "creative", detail: "creative-collaboration" },
  "agency-retention-lab": { kind: "advanced", area: "creative", detail: "creative-retention" },
  "agency-scene-studio": { kind: "advanced", area: "creative", detail: "creative-studio" },
  "agency-motion-experience": { kind: "advanced", area: "creative", detail: "creative-studio" },
  "agency-scene-router": { kind: "advanced", area: "creative", detail: "creative-studio" },
  "agency-quality-control": { kind: "advanced", area: "creative", detail: "creative-studio" },
  "agency-approval-center": { kind: "advanced", area: "identity", detail: "creative-library" },
  "agency-action-center": { kind: "advanced", area: "protection", detail: "protection-actions" },
  "agency-brand-identity": { kind: "advanced", area: "identity", detail: "identity-overview" },
  "agency-creative-flight": { kind: "advanced", area: "overview", detail: "overview-flight" },
  "agency-distribution-room": {
    kind: "module",
    module: "Calendario",
    sessionKey: "momos:calendar-view",
    sessionValue: "Distribución",
  },
});

export const AGENCY_TARGET_IDS = Object.freeze(Object.keys(ROUTES));

export function agencyTargetRoute(target = "") {
  return ROUTES[String(target || "").trim()] || null;
}

