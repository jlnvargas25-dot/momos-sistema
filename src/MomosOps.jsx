import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { InlineNotice, SegmentedTabs } from "./components/ui/OperationalPrimitives.jsx";
import { supabase } from "./lib/supabase";
import {
  fetchAgencyCatalogosConFallback, fetchAgencySnapshotEventVersion, fetchCatalogos, fetchConfigurationSnapshot, fetchConfigurationSyncVersion, fetchDashboardSnapshot, fetchDashboardSyncVersion,
  fetchCustomerCrmDeltas, fetchDeliverySnapshot, fetchFinanceSnapshot, fetchFinanceSyncVersion, fetchFinishedInventoryDeltas, fetchInventoryDeltas, fetchInventoryDeltasSince, fetchOperativo, fetchOperationalHistoryPage, fetchOrderDeltas, fetchProductCatalogDeltas, fetchProductionActivityDelta, fetchUserProfile,
} from "./lib/read-model";
import {
  compareAgencySnapshotVersions, createSyncCoordinator, normalizeAgencySnapshotVersion, normalizeSyncDomains,
  shouldFlushAgencyRealtimeRefresh, shouldQueueAgencySnapshotVersion, shouldQueueRealtimeDomain,
  syncDomainForTable, syncDomainsForView, SYNC_DOMAINS,
} from "./lib/sync-coordinator";
import {
  setOrderStatusRemoto, setReclamoEstado,
  editarReclamo, crearDomicilio, actualizarDomicilio, mutarDomicilioDelta, upsertCliente, guardarPreferenciasCliente, crearActivacionCliente,
  registrarContactoCliente, convertirActivacionCliente, activarBeneficioCliente,
  crearProducto, editarProducto, setProductoActivo,
  guardarRecetaProducto, sincronizarCostoProducto, mutarCatalogoCrmDelta, createInventoryIdempotencyKey, crearUsuarioStaff, quitarRolUsuario, setUserActivo, guardarConfiguracionServidor, fetchOperationalHealthSnapshot, fetchOperationalSloSnapshot, fetchContinuitySnapshot, runOperationalHealthReview, reportClientSloTelemetry, evaluateOperationalSloAlerts,
  crearCampana, editarCampana, crearCreativo, editarCreativo, crearPublicacion, setPublicacionEstado,
  registrarMetricasCreativo, guardarPreparacionDistribucion, aprobarDistribucion, cerrarDistribucionPublicacion, autorizarDespachoDistribucion, reintentarDespachoDistribucion
} from "./lib/rpc";
import { buildConfigurationSavePayload, normalizeConfigurationSnapshot } from "./lib/configuration-sync";
import { canReceiveKitchenDelayReminders, canReceiveKitchenOrderAlerts, kitchenDelayedOrderReminders, kitchenOrderAlert, kitchenOrderStateEvents, kitchenReadyOrderCommands, normalizeKitchenDelaySettings } from "./lib/kitchen-voice";
import { deliveryBlocksNewRequest, ORDER_ROLE_SUMMARY, ORDER_WORKFLOW_ROLES } from "./lib/order-workflow";
import { hasAnyRole, hasRole, normalizeRoles, primaryRole, rolesLabel } from "./lib/user-roles";
import { agencyOperationalFactsReady as hasAgencyOperationalFacts } from "./lib/agency-operational-facts";
import { measureSyncLoad, runtimePerformance } from "./performance/runtime-telemetry";
import { createRuntimeSloReporter } from "./performance/runtime-slo-reporter";
import {
  applyInventoryMutationEnvelope, mergeInventoryAuditSnapshot, normalizeInventoryDeltaBatch, normalizeInventoryEventsEnvelope,
} from "./lib/mutation-envelope";
import {
  acknowledgeInventoryRealtimePending, enqueueInventoryRealtimeItem,
  inventoryDeltaCanApply, inventoryProtectedCatalogCanApply,
} from "./lib/inventory-sync-policy";
import { compareInventoryCursorTokens, normalizeInventoryCursorToken } from "./lib/inventory-cursor";
import { applyOrderDeltaBatch, compareOrderDeltaVersions } from "./lib/order-delta";
import { applyFinishedInventoryDeltaBatch, compareFinishedInventoryDeltaVersions } from "./lib/finished-inventory-delta";
import {
  applyProductionActivityDelta, compareProductionDeltaVersions,
  normalizeProductionMutationEnvelope,
} from "./lib/production-delta";
import { compareCatalogCrmVersions } from "./lib/catalog-crm-version";
import { canOperateStage } from "./lib/operational-control";
import { DEFAULT_AGENCY_SETTINGS } from "./lib/agency-settings";
import { legacyCacheKeys, sessionCacheKey, sessionCacheStorage } from "./lib/session-cache";
import {
  activeConfigurationFigureCatalog, activeFigureCatalog, expectedFigureProductId, figureProductId, figuresForCommercialProducts, KITCHEN_FIGURE_DEFAULTS,
  isAuxiliaryFigureName, isCommercialFamilyProduct, isKitchenFigureName, orderAttributesForProduct, orderLinePresentation, productTypeForCategory,
} from "./lib/momos-domain-language";
import { calculateOrderMoney, orderLineAdditionsTotal as canonicalLineAdditionsTotal } from "./lib/order-money.js";
import { businessDateISO, MOMOS_BUSINESS_TIME_ZONE } from "./lib/business-date.js";
const LazyAgencyPanel = lazy(() => import("./features/agency/AgencyPanel.jsx").then((module) => ({
  default: module.createAgencyPanel(getAgencyPanelShared()),
})));
const LazyOrdersPanel = lazy(() => import("./features/orders/OrdersPanel.jsx").then((module) => ({
  default: module.createOrdersPanel(getOrdersPanelShared()),
})));
const LazyProductionPanel = lazy(() => import("./features/production/ProductionPanel.jsx").then((module) => ({
  default: module.createProductionPanel(getProductionPanelShared()),
})));
const LazyInventoryPanels = lazy(() => import("./features/inventory/InventoryPanels.jsx").then((module) => ({
  default: module.createInventoryPanels(getInventoryPanelsShared()),
})));
const LazyFinancePanel = lazy(() => import("./features/finance/FinancePanel.jsx").then((module) => ({
  default: module.createFinancePanel(getFinancePanelShared()),
})));
const LazyBusinessPanels = lazy(() => import("./features/backoffice/BusinessPanels.jsx").then((module) => ({
  default: module.createBusinessPanels(getBusinessPanelsShared()),
})));

/* ================================================================
   MOMOS OPS v3 — Operación + Agencia Interna de D'Momos Sweet Love
   Base limpia pre-Supabase · Cocina oculta · El Caney, Cali
   Arquitectura: tablas normalizadas + persistencia (window.storage)
   ================================================================ */

const DB_VERSION = 18;
const DB_KEY = "momos-db-v2"; // clave estable; la versión interna migra los datos

// Clonado seguro con fallback para navegadores sin structuredClone
function cloneDb(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

const T = {
  bg: "#FAF4EC", surface: "#FFFFFF", soft: "#FFF9F1", border: "#EEDFCE",
  choco: "#54382B", choco2: "#8A6C5B", rosa: "#F3D7DC", rosaDeep: "#C4808E",
  coral: "#E5714E", coralSoft: "#FBE3DA", vainilla: "#F7ECD9",
};

const FONTS = `
* { box-sizing: border-box; } body { margin: 0; }
.momos {
  --momo-ease: cubic-bezier(.2,.8,.2,1);
  --momo-spring: cubic-bezier(.16,1,.3,1);
  font-family: 'Nunito Sans', system-ui, sans-serif;
  color: ${T.choco};
}
.momos h1,.momos h2,.momos h3,.momos .display { font-family: 'Fraunces', Georgia, serif; }
.momos ::-webkit-scrollbar { height: 8px; width: 8px; }
.momos ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 8px; }
.momos button, .momos [role="button"], .momos input, .momos select, .momos textarea { -webkit-tap-highlight-color: transparent; }
.momos button:not(:disabled), .momos [role="button"] { cursor: pointer; }
.momos button { touch-action: manipulation; }
.momos button:focus-visible, .momos [role="button"]:focus-visible { outline: 3px solid rgba(229,113,78,.28); outline-offset: 3px; }
.momos button:not(:disabled):active, .momos [role="button"]:active { transform: translateY(1px) scale(.975); }
.momo-btn {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  box-shadow: 0 1px 0 rgba(84,56,43,.08), 0 5px 14px rgba(84,56,43,.08);
  transition: transform 150ms var(--momo-ease), box-shadow 180ms var(--momo-ease), filter 180ms var(--momo-ease), opacity 180ms ease;
}
.momo-btn::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,.3) 46%, transparent 72%);
  transform: translateX(-130%);
  transition: transform 480ms var(--momo-ease);
}
.momo-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 2px 0 rgba(84,56,43,.08), 0 9px 20px rgba(84,56,43,.12); filter: saturate(1.04); }
.momo-btn:not(:disabled):hover::after { transform: translateX(130%); }
.momo-btn:disabled { cursor: not-allowed; box-shadow: none; }
.momo-btn[aria-busy="true"] { cursor: progress; }
.momo-btn[data-confirming="true"] { animation: momo-confirm 900ms ease-in-out infinite alternate; }
.momo-card-action {
  position: relative;
  transition: transform 180ms var(--momo-ease), box-shadow 220ms var(--momo-ease), border-color 180ms ease;
}
.momo-card-action:hover { transform: translateY(-2px); border-color: #E3C5B1 !important; box-shadow: 0 12px 26px rgba(84,56,43,.1); }
.momo-card-action:focus-visible { outline: 3px solid rgba(229,113,78,.28); outline-offset: 3px; }
.momo-nav-item { position: relative; transition: color 160ms ease, background 180ms ease, transform 160ms var(--momo-ease); }
.momo-nav-item::before { content: ""; position: absolute; left: 0; top: 25%; bottom: 25%; width: 3px; border-radius: 0 4px 4px 0; background: ${T.coral}; transform: scaleY(0); transition: transform 220ms var(--momo-spring); }
.momo-nav-item[data-active="true"]::before { transform: scaleY(1); }
@media print {
  body * { visibility: hidden !important; }
  .momo-shipping-label, .momo-shipping-label * { visibility: visible !important; }
  .momo-shipping-label {
    position: fixed !important; inset: 0 auto auto 0 !important;
    width: 100mm !important; min-height: 70mm !important; margin: 0 !important;
    padding: 8mm !important; color: #2F211B !important; background: #fff !important;
    border: 1.5px solid #2F211B !important; border-radius: 0 !important;
    box-shadow: none !important; font-family: Arial, sans-serif !important;
  }
  .momo-no-print { display: none !important; }
}
.momo-nav-item:not([data-active="true"]):hover { background: rgba(243,215,220,.42) !important; transform: translateX(2px); }
.momo-mobile-nav { transition: color 160ms ease, background 160ms ease, transform 160ms var(--momo-ease); }
.momo-mobile-nav[data-active="true"] { background: linear-gradient(180deg, rgba(243,215,220,.22), rgba(243,215,220,0)); }
.momo-mobile-nav[data-active="true"] > span { animation: momo-icon-pop 380ms var(--momo-spring); }
.momo-page-enter { animation: momo-page-in 360ms var(--momo-spring); }
.momo-trace-open { animation: momo-page-in 320ms var(--momo-spring) both; }
.momo-trace-card { transition: transform 200ms var(--momo-spring), box-shadow 200ms ease, border-color 200ms ease; }
.momo-trace-card:not([data-open="true"]):hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(84,56,43,.1); border-color: #E9A18C; }
.momo-trace-chevron { transition: transform 220ms var(--momo-spring); }
.momo-trace-chevron[data-open="true"] { transform: rotate(90deg); }
.momo-trace-card:not([data-open="true"]):hover .momo-trace-chevron { transform: translateX(3px); }
.momo-module-icon { box-shadow: inset 0 0 0 1px rgba(196,128,142,.18), 0 8px 20px rgba(196,128,142,.12); animation: momo-icon-pop 420ms var(--momo-spring) both; }
.momo-field { transition: color 160ms ease; }
.momo-field:focus-within > span { color: ${T.coral} !important; }
.momos input, .momos select, .momos textarea { transition: border-color 160ms ease, box-shadow 180ms ease, background 160ms ease; }
.momos input:focus, .momos select:focus, .momos textarea:focus { border-color: ${T.coral} !important; box-shadow: 0 0 0 4px rgba(229,113,78,.13); background: #FFFEFC !important; }
.momos input:invalid:not(:placeholder-shown) { border-color: #D99A8E; }
.momo-modal-backdrop { animation: momo-fade-in 180ms ease-out both; backdrop-filter: blur(2px); }
.momo-modal-sheet { animation: momo-sheet-in 340ms var(--momo-spring) both; }
.momo-toast { position: relative; overflow: hidden; animation: momo-toast-in 420ms var(--momo-spring) both; box-shadow: 0 14px 36px rgba(84,56,43,.16); }
.momo-toast-icon { animation: momo-icon-pop 460ms 90ms var(--momo-spring) both; }
.momo-toast-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; transform-origin: left; animation: momo-toast-life var(--toast-life, 3500ms) linear both; background: currentColor; opacity: .3; }
.momo-sync { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.momo-sync-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.momo-sync[data-state="guardando"] .momo-sync-dot, .momo-sync[data-state="cargando"] .momo-sync-dot { animation: momo-breathe 720ms ease-in-out infinite alternate; }
.momo-sync[data-state="guardado"] .momo-sync-dot { animation: momo-icon-pop 360ms var(--momo-spring); }
.momo-bar { transition: width 620ms var(--momo-spring), background 180ms ease; }
.momo-busy-spinner { animation: momo-spin 650ms linear infinite; }
.momo-kitchen-alert-fab { position: fixed; right: max(1rem, env(safe-area-inset-right)); bottom: max(5rem, calc(env(safe-area-inset-bottom) + 1rem)); z-index: 45; }
.momo-momobot-fab { position: fixed; right: max(1rem, env(safe-area-inset-right)); bottom: max(9rem, calc(env(safe-area-inset-bottom) + 5rem)); z-index: 46; }
.momo-kitchen-plan-fab { position: fixed; right: max(1rem, env(safe-area-inset-right)); bottom: max(13.5rem, calc(env(safe-area-inset-bottom) + 9.5rem)); z-index: 47; }
.momo-momobot-fab, .momo-kitchen-plan-fab { transition: opacity 160ms ease, transform 180ms var(--momo-spring); }
body:has(.momo-momobot-fab[data-open="true"]) .momo-kitchen-plan-fab,
body:has(.momo-kitchen-plan-fab[data-open="true"]) .momo-momobot-fab { opacity: 0; pointer-events: none; transform: translateY(8px); }
.momo-kitchen-plan-fab[data-open="true"] { bottom: max(1rem, env(safe-area-inset-bottom)); }
.momo-kitchen-plan-orb { position: relative; box-shadow: 0 10px 24px rgba(63,107,66,.24), 0 0 0 6px rgba(221,235,217,.82), 0 0 0 7px rgba(63,107,66,.12); transition: transform 180ms var(--momo-spring), box-shadow 180ms ease; }
.momo-kitchen-plan-orb:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 14px 30px rgba(63,107,66,.3), 0 0 0 7px rgba(221,235,217,.86); }
.momo-kitchen-plan-panel { container-type: inline-size; }
.momo-momobot-panel { container-type: inline-size; }
.momo-momobot-layout { display: flex; flex-direction: column; align-items: stretch; gap: 1rem; }
.momo-momobot-rail { display: flex; align-items: center; gap: .75rem; flex-shrink: 0; }
.momo-momobot-status { text-align: left; line-height: 1.25; }
.momo-momobot-title { font-size: 1.25rem; line-height: 1.75rem; }
.momo-momobot-voice-orb { width: 4rem; height: 4rem; font-size: 1.25rem; flex-shrink: 0; }
@container (min-width: 620px) {
  .momo-momobot-layout { flex-direction: row; align-items: flex-start; gap: 1.25rem; }
  .momo-momobot-rail { width: 7rem; flex-direction: column; gap: .5rem; }
  .momo-momobot-status { text-align: center; }
  .momo-momobot-title { font-size: 1.5rem; line-height: 2rem; }
  .momo-momobot-voice-orb { width: 5rem; height: 5rem; font-size: 1.5rem; }
}
.momo-voice-orb { position: relative; box-shadow: 0 10px 24px rgba(229,113,78,.24), 0 0 0 6px rgba(251,227,218,.82), 0 0 0 7px rgba(229,113,78,.12); transition: transform 180ms var(--momo-spring), box-shadow 180ms ease; }
.momo-voice-orb[data-listening="true"] { animation: momo-listening 900ms ease-in-out infinite alternate; background: #A03B2A !important; box-shadow: 0 0 0 7px rgba(229,113,78,.14), 0 12px 30px rgba(160,59,42,.28); }
.momo-voice-wave { display: inline-flex; align-items: center; gap: 2px; height: 16px; }
.momo-voice-wave > i { display: block; width: 2px; height: 35%; border-radius: 3px; background: currentColor; animation: momo-wave 650ms ease-in-out infinite alternate; }
.momo-voice-wave > i:nth-child(2) { animation-delay: -420ms; height: 75%; }
.momo-voice-wave > i:nth-child(3) { animation-delay: -210ms; height: 100%; }
.momo-voice-wave > i:nth-child(4) { animation-delay: -520ms; height: 60%; }
.momo-operational-hero { position: relative; isolation: isolate; overflow: hidden; }
.momo-operational-hero::after { content: ""; position: absolute; z-index: -1; width: 210px; height: 210px; right: -70px; top: -105px; border-radius: 999px; background: rgba(243,215,220,.7); }
.momo-queue-item { transition: transform 180ms var(--momo-spring), box-shadow 180ms ease, border-color 180ms ease; }
.momo-queue-item:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(84,56,43,.07); }
.momo-command-ticket { position: relative; overflow: hidden; }
.momo-command-ticket::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: linear-gradient(180deg, #E5714E, #C4808E); }
.momo-command-ticket::before { content: ""; position: absolute; width: 84px; height: 84px; right: -38px; top: -44px; border-radius: 999px; background: rgba(243,215,220,.35); pointer-events: none; }
.momo-metric-card { position: relative; overflow: hidden; }
.momo-metric-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: var(--metric-tone, #E5714E); }
.momo-metric-card::after { content: ""; position: absolute; width: 88px; height: 88px; right: -38px; bottom: -46px; border-radius: 999px; background: var(--metric-wash, rgba(229,113,78,.1)); pointer-events: none; }
.momo-segmented-tabs { background: rgba(247,236,217,.72); border: 1px solid #EEDFCE; box-shadow: inset 0 1px 0 rgba(255,255,255,.8); }
.momo-segmented-tab { transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms var(--momo-spring); }
.momo-segmented-tab[aria-selected="true"] { box-shadow: 0 5px 12px rgba(229,113,78,.2); transform: translateY(-1px); }
.momo-copilot-card { position: relative; isolation: isolate; box-shadow: 0 12px 34px rgba(84,56,43,.08); }
.momo-copilot-card::before { content: ""; position: absolute; z-index: -1; width: 170px; height: 170px; left: -82px; top: -86px; border-radius: 999px; background: rgba(251,227,218,.72); }
.momo-copilot-card::after { content: ""; position: absolute; z-index: -1; width: 150px; height: 150px; right: -70px; bottom: -88px; border-radius: 999px; background: rgba(243,215,220,.45); }
.momo-copilot-ribbon { margin: -1rem -1rem 1rem; background: linear-gradient(90deg, #5B3529, #744333 64%, #A54830); color: #fff; box-shadow: inset 0 -1px 0 rgba(255,255,255,.12); }
.momo-delay-ticket { position: relative; overflow: hidden; box-shadow: 0 8px 24px rgba(84,56,43,.06); }
.momo-delay-ticket::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--delay-tone, #E7C078); }
.momo-stock-meter { height: 7px; overflow: hidden; border-radius: 999px; background: #F2E8DB; }
.momo-stock-meter > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #6A9B69, #E5714E); transition: width 520ms var(--momo-spring); }
.momo-crm-tile { transition: transform 180ms var(--momo-spring), box-shadow 180ms ease; }
.momo-crm-tile:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(84,56,43,.08); }
.momo-crm-row { transition: background 160ms ease; border-radius: 10px; }
.momo-crm-row:hover { background: rgba(247,236,217,.6); }
.momo-cal-card { transition: transform 180ms var(--momo-spring), box-shadow 180ms ease; }
.momo-cal-card:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(84,56,43,.08); }
@keyframes momo-page-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes momo-sheet-in { from { opacity: 0; transform: translateY(28px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes momo-toast-in { 0% { opacity: 0; transform: translateY(18px) scale(.94); } 65% { transform: translateY(-2px) scale(1.01); } 100% { opacity: 1; transform: none; } }
@keyframes momo-toast-life { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes momo-icon-pop { 0% { opacity: 0; transform: scale(.65) rotate(-8deg); } 70% { transform: scale(1.1) rotate(2deg); } 100% { opacity: 1; transform: none; } }
@keyframes momo-confirm { from { box-shadow: 0 0 0 0 rgba(160,59,42,.08); } to { box-shadow: 0 0 0 5px rgba(160,59,42,.16); } }
@keyframes momo-breathe { from { opacity: .35; transform: scale(.7); } to { opacity: 1; transform: scale(1.25); } }
@keyframes momo-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes momo-spin { to { transform: rotate(360deg); } }
@keyframes momo-listening { from { transform: scale(.98); } to { transform: scale(1.035); } }
@keyframes momo-wave { from { transform: scaleY(.45); } to { transform: scaleY(1); } }
@media (min-width: 768px) { .momo-kitchen-alert-fab { bottom: max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem)); } .momo-momobot-fab { bottom: max(5.5rem, calc(env(safe-area-inset-bottom) + 5rem)); } .momo-kitchen-plan-fab { bottom: max(10rem, calc(env(safe-area-inset-bottom) + 9.5rem)); } .momo-kitchen-plan-fab[data-open="true"] { bottom: max(1rem, env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .momos * { transition: none !important; animation: none !important; } }
`;

/* ---------------- Fechas dinámicas (zona horaria America/Bogota) ---------------- */
const TZ = MOMOS_BUSINESS_TIME_ZONE;
// "en-CA" produce YYYY-MM-DD; NUNCA usar toISOString para la fecha operativa (daría el día de UTC, no el de Cali)
const fechaISOEnBogota = (date) => businessDateISO(date);
const hoyISO = () => fechaISOEnBogota(new Date());
const ahoraHora = () => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const dISO = (nDias) => fechaISOEnBogota(new Date(Date.now() + nDias * 86400000));
const sumarDiasISO = (fecha, nDias) => {
  const match = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3] + nDias, 12));
  return date.toISOString().slice(0, 10);
};
const cumpleEn = (nDias) => dISO(nDias).slice(5); // MM-DD
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);

// Marca de tiempo completa (fecha y hora locales de Bogotá) para cronometrar la congelación
const ahoraSello = () => hoyISO() + " " + new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
// Marca de tiempo real de hace `h` horas, en zona America/Bogota (formato "YYYY-MM-DD HH:MM:SS")
const selloHaceHoras = (h) => {
  const d = new Date(Date.now() - h * 3600000);
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  return fecha + " " + hora;
};
// Interpreta "YYYY-MM-DD HH:MM(:SS)" de Bogotá como instante real (Bogotá = UTC-5, sin horario de verano)
const selloAMs = (sello) => sello ? new Date(sello.replace(" ", "T") + "-05:00").getTime() : null;
const horasDesde = (sello) => { const ms = selloAMs(sello); return ms ? (Date.now() - ms) / 3600000 : null; };

const milCO = (n) => {
  const neg = (n || 0) < 0;
  const s = Math.round(Math.abs(n || 0)).toLocaleString("es-CO");
  const parts = s.split(".");
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) out += ((parts.length - i) % 2 === 0 ? "'" : ".") + parts[i];
  return (neg ? "-" : "") + out;
};
const fmt = (n) => "$" + milCO(n);
const pct = (n) => (isFinite(n) ? Math.round(n * 100) + "%" : "—");

/* ---------------- Catálogos oficiales MOMOS ---------------- */
const SABORES_FRUTALES = ["Mango biche","Coco","Maracuyá","Limón","Banano","Durazno"];
const SABORES_CREMOSOS = ["M&M","Oreo","Caramelo salado","Nutella","Milo"];
const SABORES = [...SABORES_FRUTALES, ...SABORES_CREMOSOS];
// Relleno fijo: siempre cheesecake con ganache (no es una elección del operador, es constante).
const RELLENOS = ["Cheesecake con ganache"];
// Catálogo de toppings/adiciones. precio 0 = gratis (incluido); >0 = extra pago.
// insumoId (opcional) liga a un insumo del inventario para descontarlo al vender;
// insumoCant = cuánto de ese insumo consume UNA aplicación del topping. Todo editable en la app.
const TOPPINGS = [
  { nombre: "Oreo", precio: 0, insumoId: "", insumoCant: 1 },
  { nombre: "M&M", precio: 0, insumoId: "", insumoCant: 1 },
  { nombre: "Milo triturado", precio: 0, insumoId: "", insumoCant: 1 },
  { nombre: "Chips de chocolate", precio: 0, insumoId: "", insumoCant: 1 },
  { nombre: "Maní dulce", precio: 0, insumoId: "", insumoCant: 1 },
  { nombre: "Almendras", precio: 0, insumoId: "", insumoCant: 1 },
];
const CANALES = ["WhatsApp","Instagram","Rappi","Directo"];
const CANAL_STYLE = {
  WhatsApp: { bg: "#DDEBD9", fg: "#3F6B42" }, Instagram: { bg: "#F3D7DC", fg: "#8E4B5A" },
  Rappi: { bg: "#FBE3DA", fg: "#B0522F" }, Directo: { bg: "#F7ECD9", fg: "#8A6520" },
};

const ORDER_STATES = ["Nuevo","Confirmado","Pendiente de pago","Pagado","En producción","Listo para empaque","Empacado","Listo para despacho","En ruta","Entregado","Cancelado","Reclamo"];
const EV_SELLO = ["Caja cerrada con sello","Bolsa sellada"];
const EV_TIPOS = ["Pedido armado","Caja abierta","Caja cerrada con sello","Bolsa sellada","Comprobante de pago","Entrega"];

// Evidencias guiadas por paso: cada transición pide su(s) foto(s) con el tipo YA FIJO.
// `tipos` con más de un valor = variantes válidas (el operador elige, ninguna es la equivocada).
const FOTOS_PASO = {
  "Pagado":    [{ label: "Comprobante de pago", tipos: ["Comprobante de pago"] }],
  "Empacado":  [
    { label: "Caja abierta (contenido)", tipos: ["Caja abierta"] },
    { label: "Sello", tipos: ["Caja cerrada con sello", "Bolsa sellada"] },
  ],
  "Entregado": [{ label: "Foto de entrega", tipos: ["Entrega"] }],
};
// Requisitos de foto aplicables a este pedido para pasar a `estado` (Rappi paga en su app → sin comprobante).
function reqFotosPaso(o, estado) {
  const reqs = FOTOS_PASO[estado] || [];
  if (estado === "Pagado" && o.canal === "Rappi") return [];
  return reqs;
}

const STATE_STYLE = {
  "Nuevo": { bg: "#F3D7DC", fg: "#8E4B5A" }, "Confirmado": { bg: "#F7ECD9", fg: "#8A6520" },
  "Pendiente de pago": { bg: "#FBE8C8", fg: "#96690F" }, "Pagado": { bg: "#DDEBD9", fg: "#3F6B42" },
  "En producción": { bg: "#DCE7F2", fg: "#3E5C7E" }, "Listo para empaque": { bg: "#FBE3DA", fg: "#A54830" }, "Empacado": { bg: "#E8E0F2", fg: "#63518A" },
  "Listo para despacho": { bg: "#D8ECE8", fg: "#2F6B60" }, "En ruta": { bg: "#FBE3DA", fg: "#B0522F" },
  "Entregado": { bg: "#CFE6CB", fg: "#2E5A31" }, "Cancelado": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Reclamo": { bg: "#F6D4CD", fg: "#A03B2A" },
  "En preparación": { bg: "#F7ECD9", fg: "#8A6520" }, "Congelando": { bg: "#DCE7F2", fg: "#3E5C7E" },
  "Listo": { bg: "#DDEBD9", fg: "#3F6B42" }, "Reservado": { bg: "#E8E0F2", fg: "#63518A" },
  "Vendido": { bg: "#CFE6CB", fg: "#2E5A31" }, "Imperfecto": { bg: "#FBE8C8", fg: "#96690F" },
  "Descartado": { bg: "#F6D4CD", fg: "#A03B2A" },
  "Por solicitar": { bg: "#F7ECD9", fg: "#8A6520" }, "Solicitado": { bg: "#F3D7DC", fg: "#8E4B5A" },
  "Asignado": { bg: "#DCE7F2", fg: "#3E5C7E" }, "Problema": { bg: "#F6D4CD", fg: "#A03B2A" },
  "Abierto": { bg: "#F6D4CD", fg: "#A03B2A" }, "En revisión": { bg: "#FBE8C8", fg: "#96690F" },
  "Aprobado": { bg: "#DDEBD9", fg: "#3F6B42" }, "Rechazado": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Compensado": { bg: "#E8E0F2", fg: "#63518A" }, "Cerrado": { bg: "#CFE6CB", fg: "#2E5A31" },
  "Recurrente": { bg: "#DDEBD9", fg: "#3F6B42" }, "VIP": { bg: "#F3D7DC", fg: "#8E4B5A" },
  "Riesgo por reclamos": { bg: "#F6D4CD", fg: "#A03B2A" }, "Inactivo": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Activo": { bg: "#DDEBD9", fg: "#3F6B42" }, "Usado": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Vencido": { bg: "#F6D4CD", fg: "#A03B2A" }, "Pendiente": { bg: "#FBE8C8", fg: "#96690F" },
  "Atendida": { bg: "#CFE6CB", fg: "#2E5A31" },
  "Reservada": { bg: "#E8E0F2", fg: "#63518A" }, "Liberada": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Consumida": { bg: "#CFE6CB", fg: "#2E5A31" },
  // marketing · campañas
  "Planeada": { bg: "#F7ECD9", fg: "#8A6520" }, "Activa": { bg: "#DDEBD9", fg: "#3F6B42" },
  "Pausada": { bg: "#FBE8C8", fg: "#96690F" }, "Finalizada": { bg: "#EBE6E0", fg: "#7A6E63" },
  // marketing · creativos
  "Idea": { bg: "#F7ECD9", fg: "#8A6520" },
  "En diseño": { bg: "#DCE7F2", fg: "#3E5C7E" },
  "Publicado": { bg: "#D8ECE8", fg: "#2F6B60" },
  "Ganador": { bg: "#F3D7DC", fg: "#8E4B5A" },
  // marketing · calendario
  "Programado": { bg: "#DCE7F2", fg: "#3E5C7E" }, "No publicado": { bg: "#F6D4CD", fg: "#A03B2A" },
  // crecimiento · ideas y tareas
  "Nueva": { bg: "#F7ECD9", fg: "#8A6520" }, "Usada": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Repetir": { bg: "#DCE7F2", fg: "#3E5C7E" }, "Ganadora": { bg: "#F3D7DC", fg: "#8E4B5A" },
  "Descartada": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Hecha": { bg: "#CFE6CB", fg: "#2E5A31" },
  "Saltada": { bg: "#EBE6E0", fg: "#7A6E63" },
  "Fácil": { bg: "#DDEBD9", fg: "#3F6B42" }, "Medio": { bg: "#FBE8C8", fg: "#96690F" },
  "Avanzado": { bg: "#F6D4CD", fg: "#A03B2A" },
};

// Canales de marketing (más amplios que los canales de venta)
const MK_CANALES = ["Instagram","Facebook","TikTok","WhatsApp","Rappi","Referidos","Influencer","Orgánico"];
const MK_CANAL_STYLE = {
  Instagram: { bg: "#F3D7DC", fg: "#8E4B5A" }, Facebook: { bg: "#DCE7F2", fg: "#3E5C7E" },
  TikTok: { bg: "#E8E0F2", fg: "#63518A" }, WhatsApp: { bg: "#DDEBD9", fg: "#3F6B42" },
  Rappi: { bg: "#FBE3DA", fg: "#B0522F" }, Referidos: { bg: "#F7ECD9", fg: "#8A6520" },
  Influencer: { bg: "#F3D7DC", fg: "#8E4B5A" }, "Orgánico": { bg: "#D8ECE8", fg: "#2F6B60" },
};
const MK_OBJETIVOS = ["Ventas","Recompra","Lanzamiento","Cumpleaños","Tráfico WhatsApp","Branding"];
const MK_FORMATOS = ["Reel","Historia","Carrusel","Foto producto","Video UGC","Anuncio","Guion","Copy","Diseño empaque"];
const CAMP_ESTADOS = ["Planeada","Activa","Pausada","Finalizada"];
const CREA_ESTADOS = ["Idea","En diseño","En revisión","Aprobado","Publicado","Ganador","Descartado"];
const CAL_ESTADOS = ["Pendiente","Programado","Publicado","No publicado"];
const ORIGENES = ["Historia de Instagram","Anuncio Meta","TikTok orgánico","Reel de Instagram","Referido","Rappi","WhatsApp directo","Influencer","Otro"];

// "¿De dónde llegó este pedido?" — opciones simples que se traducen a atribución técnica
const ORIGEN_SIMPLE = [
  { label: "Instagram historia", canal: "Instagram", detalle: "Historia de Instagram" },
  { label: "Instagram reel", canal: "Instagram", detalle: "Reel de Instagram" },
  { label: "TikTok", canal: "TikTok", detalle: "TikTok orgánico" },
  { label: "WhatsApp", canal: "WhatsApp", detalle: "WhatsApp directo" },
  { label: "Referido", canal: "Referidos", detalle: "Referido" },
  { label: "Rappi", canal: "Rappi", detalle: "Rappi" },
  { label: "Cliente repetido", canal: "WhatsApp", detalle: "Cliente repetido" },
  { label: "No sé", canal: "", detalle: "" },
];

/* ================================================================
   SEED — datos de ejemplo realistas (El Caney, Cali)
   Cada colección representa una tabla lista para migrar a SQL:
   customers, products, orders, order_items, production_batches,
   inventory_items, inventory_movements, deliveries, evidences,
   claims, benefits, audit_logs, settings
   ================================================================ */

// users / roles / permissions: estructura lista para login real con backend
const PERMISOS_POR_ROL = ORDER_ROLE_SUMMARY;
function seedUsers() {
  return [
    { id: "U01", nombre: "Dueña / Admin", email: "admin@dmomos.co", rol: "Administrador", activo: true },
    { id: "U02", nombre: "Karen", email: "karen@dmomos.co", rol: "Cocina", activo: true },
    { id: "U03", nombre: "Julián", email: "julian@dmomos.co", rol: "Logística", activo: true },
  ];
}

function seedDb() {
  const settings = {
    counters: { order: 1045, customer: 8, batch: 18, claim: 32, benefit: 13, delivery: 224, movement: 7, evidence: 10, audit: 5, suggestion: 2, item: 9, recipe: 13, invitem: 14, reservation: 0, user: 3, campaign: 4, creative: 8, calendar: 6, result: 5, idea: 12, guion: 5, mensaje: 12, tarea: 8, frase: 6, product: 15 },
    zonas: [
      { nombre: "Zona 1 · El Caney / Ingenio / Limonar", tarifa: 5000 },
      { nombre: "Zona 2 · Ciudad Jardín / Valle del Lili", tarifa: 7000 },
      { nombre: "Zona 3 · Sur amplio / Ciudad 2000 / Capri", tarifa: 9000 },
      { nombre: "Zona 4 · Norte / Oeste / Pance alto", tarifa: 14000 },
    ],
    pedidoMinimo: 25000,
    saboresFrutales: SABORES_FRUTALES, saboresCremosos: SABORES_CREMOSOS,
    salsas: ["Frutos rojos","Chocolate","Arequipe","Maracuyá","Lechera"],
    rellenos: RELLENOS,
    toppings: TOPPINGS,
    // Catálogo de figuras: la figura es el POSTRE físico (nombre + gramaje).
    // productId señala la familia comercial que lo vende/reserva; especie es solo descriptiva.
    // El sabor es ortogonal: cualquier figura se ofrece en los 11 sabores. No se acoplan.
    figuras: [
      { nombre: "Lizi",  especie: "gato",  gramaje: "150 g", productId: "PR01" },
      { nombre: "Momo",  especie: "gato",  gramaje: "180 g", productId: "PR01" },
      { nombre: "Toby",  especie: "gato",  gramaje: "280 g", productId: "PR01" },
      { nombre: "Teo",   especie: "gato",  gramaje: "250 g", productId: "PR04" },
      { nombre: "Max",   especie: "perro", gramaje: "180 g", productId: "PR02" },
      { nombre: "Rocco", especie: "perro", gramaje: "180 g", productId: "PR02" },
      { nombre: "Danna", especie: "perro", gramaje: "180 g", productId: "PR02" },
    ],
    pagos: ["Nequi","Daviplata","Bancolombia","Rappi (app)"],
    proveedores: ["Picap","Pibox","Mensajeros Urbanos","Propio","Rappi"],
    pautaMensual: 350000,
    horasCongelacion: 10, // objetivo por defecto (rango operativo 8–12 h)
    vidaUtilConfigurable: true,
    vidaUtilProductoTerminadoDias: 6,
    vidaUtilMezclasDias: 5,
    demoraCocinaMin: 15,
    demoraCocinaUrgenteMin: 30,
    demoraEmpaqueMin: 10,
    demoraEmpaqueUrgenteMin: 20,
    demoraRepeticionMin: 5,
    politicas: "MOMOS no despacha ningún pedido sin pago confirmado: se requiere comprobante de transferencia (Nequi, Daviplata o Bancolombia) o el pago dentro de la app de Rappi. No se aceptan pagos en efectivo contra entrega. Reclamos por estado del producto: máximo 20 minutos después de recibido, salvo calidad o inocuidad. Un beneficio por pedido, no acumulable, no aplica sobre domicilio.",
  };

  // `tipo` conserva el modo técnico de stock. En UI, PR01–PR04 son familias/presentaciones
  // comerciales; Lizi, Momo, Toby, Teo, Max, Rocco y Danna son los productos físicos de Cocina.
  const products = [
    { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 18000, precioRappi: 23000, costo: 6800, stock: 8, prep: 20, frio: true, lejano: false, activo: true, desc: "Familia comercial para Lizi, Momo y Toby; la figura define forma y gramaje.", atributos: ["sabor","salsa","figura"] },
    { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", especie: "perro", precio: 18000, precioRappi: 23000, costo: 6800, stock: 6, prep: 20, frio: true, lejano: false, activo: true, desc: "Familia comercial para Max, Rocco y Danna; la figura define la forma física.", atributos: ["sabor","salsa","figura"] },
    { id: "PR03", nombre: "Momo grande", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 23000, precioRappi: 29000, costo: 8900, stock: 0, prep: 25, frio: true, lejano: false, activo: false, desc: "Presentación comercial en definición; no se ofrece hasta vincular una figura física canónica.", atributos: ["sabor","salsa","figura"] },
    { id: "PR04", nombre: "Momo premium", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 32000, precioRappi: 39000, costo: 12500, stock: 3, prep: 30, frio: true, lejano: false, activo: true, desc: "Presentación comercial premium vinculada a Teo y su ficha de Cocina.", atributos: ["sabor","salsa","figura"] },
    { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 3, componentProductIds: ["PR01","PR02"], empaqueItem: "I08", precio: 49000, precioRappi: 59000, costo: 22500, prep: 35, frio: true, lejano: false, activo: true, desc: "Caja regalo con 3 momos surtidos, sticker y lazo. Disponibilidad según momos y cajas.", atributos: ["sabor","salsa"] },
    { id: "PR06", nombre: "Caja x4 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 4, componentProductIds: ["PR01","PR02"], empaqueItem: "I13", precio: 63000, precioRappi: 75000, costo: 29500, prep: 40, frio: true, lejano: false, activo: true, desc: "Caja regalo con 4 momos surtidos.", atributos: ["sabor","salsa"] },
    { id: "PR07", nombre: "Caja x6 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 6, componentProductIds: ["PR01","PR02"], empaqueItem: "I14", precio: 89000, precioRappi: 105000, costo: 43000, prep: 45, frio: true, lejano: false, activo: true, desc: "Caja premium con 6 momos surtidos para celebraciones.", atributos: ["sabor","salsa"] },
    { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido", precio: 15000, precioRappi: 19000, costo: 5200, prep: 10, frio: true, lejano: true, activo: true, desc: "Cheesecake en vaso preparado al momento, con sabor y salsa a elecciÃ³n.", atributos: ["sabor","salsa"] },
    { id: "PR09", nombre: "Crepa Momo Nutella", cat: "Momos Antojos", tipo: "pedido", precio: 14000, precioRappi: 18000, costo: 4800, prep: 12, frio: false, lejano: true, activo: true, desc: "Crepa con Nutella, banano y topping de momo mini. Se prepara al momento.", atributos: [] },
    { id: "PR10", nombre: "Crepa Momo Oreo", cat: "Momos Antojos", tipo: "pedido", precio: 14000, precioRappi: 18000, costo: 4600, prep: 12, frio: false, lejano: true, activo: true, desc: "Crepa con crema de Oreo y galleta triturada. Se prepara al momento.", atributos: [] },
    { id: "PR11", nombre: "Malteada Oreo Momo", cat: "Momos Bebidas", tipo: "pedido", precio: 13000, precioRappi: 16500, costo: 4200, prep: 8, frio: true, lejano: false, activo: true, desc: "Malteada cremosa de Oreo con crema batida.", atributos: [] },
    { id: "PR12", nombre: "Malteada Nutella Momo", cat: "Momos Bebidas", tipo: "pedido", precio: 13500, precioRappi: 17000, costo: 4500, prep: 8, frio: true, lejano: false, activo: true, desc: "Malteada de Nutella con crema y chocolate rallado.", atributos: [] },
    { id: "PR13", nombre: "Granizado de maracuyá", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado natural de maracuyá.", atributos: [] },
    { id: "PR14", nombre: "Granizado de mango biche", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado de mango biche con sal y limón opcional.", atributos: [] },
    { id: "PR15", nombre: "Granizado de durazno", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado dulce de durazno.", atributos: [] },
  ];

  const customers = [
    { id: "C01", nombre: "Valentina Ríos", telefono: "3104567890", instagram: "@valen.rios", barrio: "El Caney", direccion: "Cra 85C #48-30, torre 2 apto 402", canal: "Instagram", primera: dISO(-115), ultima: hoyISO(), total: 214000, pedidos: 6, cumple: cumpleEn(13), favoritos: "Lizi de Maracuyá", estado: "VIP", notas: "Prefiere Lizi de Maracuyá. Sube historias con frecuencia." },
    { id: "C02", nombre: "Andrés Cabal", telefono: "3159876543", instagram: "@andrescabal", barrio: "El Ingenio", direccion: "Cra 83 #14-21", canal: "WhatsApp", primera: dISO(-64), ultima: dISO(-1), total: 96000, pedidos: 3, cumple: "11-02", favoritos: "Max de Oreo", estado: "Recurrente", notas: "" },
    { id: "C03", nombre: "Laura Sepúlveda", telefono: "3001234567", instagram: "@lau.sep", barrio: "Valle del Lili", direccion: "Cra 98 #42-05, casa 12", canal: "Rappi", primera: dISO(-7), ultima: dISO(-7), total: 39000, pedidos: 1, cumple: cumpleEn(4), favoritos: "Nutella", estado: "Nuevo", notas: "Llegó por Rappi, pedir Instagram en próxima entrega." },
    { id: "C04", nombre: "Camilo Torres", telefono: "3186543210", instagram: "", barrio: "El Limonar", direccion: "Calle 13A #66-40", canal: "WhatsApp", primera: dISO(-86), ultima: dISO(-46), total: 128000, pedidos: 4, cumple: "01-25", favoritos: "Rocco de Milo", estado: "Inactivo", notas: "No compra hace más de 30 días. Enviar beneficio de reactivación." },
    { id: "C05", nombre: "María José Lenis", telefono: "3178889911", instagram: "@majolenis", barrio: "Ciudad Jardín", direccion: "Cra 105 #15-80, casa 14", canal: "Instagram", primera: dISO(-34), ultima: hoyISO(), total: 152000, pedidos: 3, cumple: "12-15", favoritos: "Coco · Caja x3", estado: "Recurrente", notas: "Subió historia hace 2 días → beneficio activo." },
    { id: "C06", nombre: "Sebastián Perea", telefono: "3123334455", instagram: "@sebasperea", barrio: "Ciudad 2000", direccion: "Cra 44 #13B-11", canal: "Directo", primera: dISO(-20), ultima: dISO(-15), total: 41000, pedidos: 2, cumple: "08-30", favoritos: "Mango biche", estado: "Riesgo por reclamos", notas: "2 reclamos, uno rechazado por llegar 3 horas después de la entrega." },
    { id: "C07", nombre: "Daniela Quintero", telefono: "3167771122", instagram: "@dani.qh", barrio: "Capri", direccion: "Calle 14 #50-26", canal: "WhatsApp", primera: dISO(-17), ultima: dISO(-17), total: 36000, pedidos: 1, cumple: cumpleEn(40), favoritos: "Caramelo salado", estado: "Nuevo", notas: "" },
    { id: "C08", nombre: "Jorge Meneses", telefono: "3013456789", instagram: "", barrio: "El Caney", direccion: "Cra 86 #46-15", canal: "Directo", primera: dISO(-2), ultima: dISO(-2), total: 32000, pedidos: 1, cumple: "", favoritos: "Limón", estado: "Nuevo", notas: "Vecino del sector, recoge en punto." },
  ];

  const orders = [
    { id: "P-1041", fecha: hoyISO(), hora: "10:12", canal: "WhatsApp", customerId: "C01", barrio: "El Caney", direccion: "Cra 85C #48-30, torre 2 apto 402", zona: settings.zonas[0].nombre, domCobrado: 5000, domCosto: 6000, descuento: 0, benefitId: "", pago: "Nequi", comprobante: true, estado: "En producción", obs: "Entregar antes de la 1 pm, es para un cumpleaños." },
    { id: "P-1042", fecha: hoyISO(), hora: "09:40", canal: "Instagram", customerId: "C05", barrio: "Ciudad Jardín", direccion: "Cra 105 #15-80, casa 14", zona: settings.zonas[1].nombre, domCobrado: 7000, domCosto: 9000, descuento: 9800, benefitId: "B-11", pago: "Bancolombia", comprobante: true, estado: "Empacado", obs: "Cliente usa beneficio 20% por historia." },
    { id: "P-1043", fecha: hoyISO(), hora: "09:05", canal: "Rappi", customerId: "C03", barrio: "Valle del Lili", direccion: "Cra 98 #42-05, casa 12", zona: settings.zonas[1].nombre, domCobrado: 0, domCosto: 0, descuento: 0, benefitId: "", pago: "Rappi (app)", comprobante: true, estado: "En ruta", obs: "Domicilio lo gestiona Rappi." },
    { id: "P-1044", fecha: hoyISO(), hora: "08:30", canal: "WhatsApp", customerId: "C02", barrio: "El Ingenio", direccion: "Cra 83 #14-21", zona: settings.zonas[0].nombre, domCobrado: 5000, domCosto: 5000, descuento: 0, benefitId: "", pago: "Nequi", comprobante: false, estado: "Pendiente de pago", obs: "Enviar link o número de pago. No se despacha sin comprobante confirmado." },
    { id: "P-1040", fecha: dISO(-1), hora: "17:20", canal: "Instagram", customerId: "C06", barrio: "Ciudad 2000", direccion: "Cra 44 #13B-11", zona: settings.zonas[2].nombre, domCobrado: 9000, domCosto: 10000, descuento: 0, benefitId: "", pago: "Daviplata", comprobante: true, estado: "Reclamo", obs: "" },
    { id: "P-1039", fecha: dISO(-1), hora: "15:00", canal: "Directo", customerId: "C08", barrio: "El Caney", direccion: "Cra 86 #46-15", zona: settings.zonas[0].nombre, domCobrado: 5000, domCosto: 4500, descuento: 0, benefitId: "", pago: "Nequi", comprobante: true, estado: "Entregado", obs: "" },
    { id: "P-1045", fecha: hoyISO(), hora: "11:05", canal: "Instagram", customerId: "C07", barrio: "Capri", direccion: "Calle 14 #50-26", zona: settings.zonas[2].nombre, domCobrado: 9000, domCosto: 0, descuento: 0, benefitId: "", pago: "Bancolombia", comprobante: false, estado: "Nuevo", obs: "Pregunta si puede llegar a las 4 pm." },
  ];

  const order_items = [
    { id: "IT01", orderId: "P-1041", productId: "PR01", nombre: "Momo Gatito", sabor: "Maracuyá", salsa: "Frutos rojos", relleno: "Cheesecake con ganache", figura: "Lizi", cant: 2, precio: 18000 },
    { id: "IT02", orderId: "P-1041", productId: "PR11", nombre: "Malteada Oreo Momo", sabor: "Oreo", salsa: "", relleno: "", figura: "", cant: 1, precio: 13000 },
    { id: "IT03", orderId: "P-1042", productId: "PR05", nombre: "Caja x3 Momos", sabor: "", salsa: "", relleno: "", figura: "", cant: 1, precio: 49000, esCaja: true },
    { id: "IT03-1", orderId: "P-1042", parentItemId: "IT03", productId: "PR01", nombre: "Momo Gatito", sabor: "Coco", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Lizi", cant: 1, precio: 0, esSubMomo: true },
    { id: "IT03-2", orderId: "P-1042", parentItemId: "IT03", productId: "PR01", nombre: "Momo Gatito", sabor: "Maracuyá", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Momo", cant: 1, precio: 0, esSubMomo: true },
    { id: "IT03-3", orderId: "P-1042", parentItemId: "IT03", productId: "PR02", nombre: "Momo Perrito", sabor: "Oreo", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Max", cant: 1, precio: 0, esSubMomo: true },
    { id: "IT04", orderId: "P-1043", productId: "PR08", nombre: "Cheesecake Momo cuchareable", sabor: "Durazno", salsa: "Frutos rojos", relleno: "Cheesecake con ganache", figura: "", cant: 2, precio: 19000 },
    { id: "IT05", orderId: "P-1044", productId: "PR02", nombre: "Momo Perrito", sabor: "Oreo", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Max", cant: 1, precio: 18000 },
    { id: "IT06", orderId: "P-1044", productId: "PR13", nombre: "Granizado de maracuyá", sabor: "Maracuyá", salsa: "", relleno: "", figura: "", cant: 2, precio: 9000 },
    { id: "IT07", orderId: "P-1040", productId: "PR02", nombre: "Momo Perrito", sabor: "Milo", salsa: "Arequipe", relleno: "Cheesecake con ganache", figura: "Rocco", cant: 1, precio: 18000 },
    { id: "IT08", orderId: "P-1039", productId: "PR09", nombre: "Crepa Momo Nutella", sabor: "Nutella", salsa: "Chocolate", relleno: "", figura: "", cant: 2, precio: 14000 },
    { id: "IT09", orderId: "P-1045", productId: "PR04", nombre: "Momo premium", sabor: "Caramelo salado", salsa: "Lechera", relleno: "Cheesecake con ganache", figura: "Teo", cant: 1, precio: 32000 },
  ];

  const evidences = [
    { id: "E01", orderId: "P-1042", tipo: "Caja abierta", url: "", fecha: hoyISO(), hora: "11:02", user: "Empaque" },
    { id: "E02", orderId: "P-1042", tipo: "Caja cerrada con sello", url: "", fecha: hoyISO(), hora: "11:05", user: "Empaque" },
    { id: "E03", orderId: "P-1043", tipo: "Bolsa sellada", url: "", fecha: hoyISO(), hora: "09:38", user: "Empaque" },
    { id: "E04", orderId: "P-1043", tipo: "Comprobante de pago", url: "", fecha: hoyISO(), hora: "09:06", user: "Administrador" },
    { id: "E05", orderId: "P-1040", tipo: "Pedido armado", url: "", fecha: dISO(-1), hora: "17:55", user: "Empaque" },
    { id: "E06", orderId: "P-1040", tipo: "Caja cerrada con sello", url: "", fecha: dISO(-1), hora: "18:01", user: "Empaque" },
    { id: "E07", orderId: "P-1040", tipo: "Entrega", url: "", fecha: dISO(-1), hora: "18:40", user: "Logística" },
    { id: "E08", orderId: "P-1039", tipo: "Bolsa sellada", url: "", fecha: dISO(-1), hora: "15:30", user: "Empaque" },
    { id: "E09", orderId: "P-1039", tipo: "Entrega", url: "", fecha: dISO(-1), hora: "16:05", user: "Logística" },
    { id: "E10", orderId: "P-1041", tipo: "Comprobante de pago", url: "", fecha: hoyISO(), hora: "10:14", user: "Administrador" },
  ];

  const production_batches = [
    { id: "L-018", fecha: hoyISO(), productId: "PR01", producto: "Momo Gatito", figura: "Lizi", sabor: "Maracuyá", relleno: "Cheesecake con ganache", salsa: "Frutos rojos", gramaje: "150 g", prod: 12, perfectas: 10, imperfectas: 1, descartadas: 1, destino: "Insumo para malteadas", resp: "Karen", vence: "", desmoldadoEn: "", estado: "Congelando", stockContabilizado: false, horasCongelacion: 10, inicioCongelacion: selloHaceHoras(6), obs: "Molde nuevo, mejor definición de orejas." },
    { id: "L-017", fecha: dISO(-1), productId: "PR02", producto: "Momo Perrito", figura: "Max", sabor: "Oreo", relleno: "Cheesecake con ganache", salsa: "Chocolate", gramaje: "180 g", prod: 10, perfectas: 9, imperfectas: 1, descartadas: 0, destino: "Prueba interna", resp: "Karen", vence: dISO(2), desmoldadoEn: dISO(-1) + " 10:00:00", estado: "Listo", stockContabilizado: true, obs: "" },
    { id: "L-016", fecha: dISO(-2), productId: "PR04", producto: "Momo premium", figura: "Teo", sabor: "Caramelo salado", relleno: "Cheesecake con ganache", salsa: "Lechera", gramaje: "250 g", prod: 6, perfectas: 5, imperfectas: 0, descartadas: 1, destino: "—", resp: "Julián", vence: dISO(1), desmoldadoEn: dISO(-2) + " 11:00:00", estado: "Listo", stockContabilizado: true, obs: "Una pieza se fracturó al desmoldar." },
    { id: "L-014", fecha: dISO(-4), productId: "PR02", producto: "Momo Perrito", figura: "Rocco", sabor: "Milo", relleno: "Cheesecake con ganache", salsa: "Arequipe", gramaje: "180 g", prod: 8, perfectas: 6, imperfectas: 2, descartadas: 0, destino: "Insumo para crepas", resp: "Julián", vence: dISO(-1), desmoldadoEn: dISO(-4) + " 09:30:00", estado: "Vendido", stockContabilizado: false, obs: "" },
  ];

  const inventory_items = [
    { id: "I01", nombre: "Crema de leche 1 L", cat: "Ingredientes", unidad: "L", stock: 8, min: 6, costo: 11500, proveedor: "Distribuidora La Vaquita", vence: dISO(9), ubicacion: "Nevera 1", compra: dISO(-4) },
    { id: "I02", nombre: "Base mousse maracuyá", cat: "Bases de mousse", unidad: "kg", stock: 2.5, min: 3, costo: 18000, proveedor: "Producción propia", vence: dISO(5), ubicacion: "Congelador A", compra: dISO(-2) },
    { id: "I03", nombre: "Salsa frutos rojos", cat: "Salsas", unidad: "L", stock: 1.2, min: 1, costo: 22000, proveedor: "Producción propia", vence: dISO(7), ubicacion: "Nevera 2", compra: dISO(-3) },
    { id: "I04", nombre: "Nutella 3 kg", cat: "Rellenos", unidad: "kg", stock: 1.8, min: 1, costo: 32000, proveedor: "Makro", vence: dISO(120), ubicacion: "Estante seco", compra: dISO(-10) },
    { id: "I05", nombre: "Ganache de chocolate", cat: "Ganache", unidad: "kg", stock: 0.8, min: 1, costo: 26000, proveedor: "Producción propia", vence: dISO(4), ubicacion: "Nevera 2", compra: dISO(-2) },
    { id: "I06", nombre: "Mezcla de crepa", cat: "Mezcla de crepa", unidad: "L", stock: 3, min: 2, costo: 9000, proveedor: "Producción propia", vence: dISO(5), ubicacion: "Nevera 1", compra: dISO(-1) },
    { id: "I07", nombre: "Pulpa mango biche", cat: "Granizados", unidad: "kg", stock: 4, min: 2, costo: 8500, proveedor: "Galería Alameda", vence: dISO(20), ubicacion: "Congelador B", compra: dISO(-5) },
    { id: "I08", nombre: "Caja regalo x3", cat: "Cajas", unidad: "und", stock: 9, min: 8, costo: 3200, proveedor: "Empaques del Valle", vence: "", ubicacion: "Estante empaques", compra: dISO(-15) },
    { id: "I13", nombre: "Caja regalo x4", cat: "Cajas", unidad: "und", stock: 5, min: 6, costo: 3800, proveedor: "Empaques del Valle", vence: "", ubicacion: "Estante empaques", compra: dISO(-15) },
    { id: "I14", nombre: "Caja premium x6", cat: "Cajas", unidad: "und", stock: 2, min: 4, costo: 5200, proveedor: "Empaques del Valle", vence: "", ubicacion: "Estante empaques", compra: dISO(-15) },
    { id: "I09", nombre: "Vaso cuchareable 9 oz", cat: "Vasos", unidad: "und", stock: 38, min: 40, costo: 650, proveedor: "Empaques del Valle", vence: "", ubicacion: "Estante empaques", compra: dISO(-15) },
    { id: "I10", nombre: "Sticker logo Sweet Love", cat: "Stickers", unidad: "und", stock: 120, min: 50, costo: 180, proveedor: "Litografía Sol", vence: "", ubicacion: "Cajón 2", compra: dISO(-25) },
    { id: "I11", nombre: "Bolsa térmica mediana", cat: "Empaques térmicos", unidad: "und", stock: 6, min: 8, costo: 2800, proveedor: "Empaques del Valle", vence: "", ubicacion: "Estante empaques", compra: dISO(-15) },
    { id: "I12", nombre: "Cucharas de bambú", cat: "Cucharas", unidad: "und", stock: 90, min: 40, costo: 220, proveedor: "EcoPack", vence: "", ubicacion: "Cajón 2", compra: dISO(-20) },
  ];

  const inventory_movements = [
    { id: "M07", fecha: hoyISO() + " 09:50", tipo: "Uso en producción", item: "Base mousse maracuyá", cant: "-1.5 kg", nota: "Lote L-018" },
    { id: "M06", fecha: hoyISO() + " 09:50", tipo: "Uso en producción", item: "Salsa frutos rojos", cant: "-0.4 L", nota: "Lote L-018" },
    { id: "M05", fecha: dISO(-1) + " 16:10", tipo: "Salida", item: "Caja regalo x3", cant: "-1 und", nota: "Pedido P-1042" },
    { id: "M04", fecha: dISO(-2) + " 08:20", tipo: "Entrada", item: "Crema de leche 1 L", cant: "+12 L", nota: "Compra semanal" },
    { id: "M03", fecha: dISO(-3) + " 18:00", tipo: "Merma", item: "Ganache de chocolate", cant: "-0.2 kg", nota: "Se quemó al templar" },
    { id: "M02", fecha: dISO(-4) + " 10:00", tipo: "Ajuste", item: "Vaso cuchareable 9 oz", cant: "-2 und", nota: "Conteo físico" },
  ];

  const deliveries = [
    { id: "D-223", orderId: "P-1043", proveedor: "Rappi", costoReal: 0, cobrado: 0, zona: settings.zonas[1].nombre, hSolicitud: "09:30", hSalida: "09:42", hEntrega: "", codigo: "RP-88231", estado: "En ruta", obs: "Gestionado por la app de Rappi." },
    { id: "D-224", orderId: "P-1042", proveedor: "Picap", costoReal: 9000, cobrado: 7000, zona: settings.zonas[1].nombre, hSolicitud: "11:10", hSalida: "", hEntrega: "", codigo: "PC-5521", estado: "Asignado", obs: "Llevar en bolsa térmica." },
    { id: "D-222", orderId: "P-1040", proveedor: "Pibox", costoReal: 10000, cobrado: 9000, zona: settings.zonas[2].nombre, hSolicitud: "18:05", hSalida: "18:15", hEntrega: "18:40", codigo: "PB-1190", estado: "Entregado", obs: "" },
    { id: "D-221", orderId: "P-1039", proveedor: "Mensajeros Urbanos", costoReal: 4500, cobrado: 5000, zona: settings.zonas[0].nombre, hSolicitud: "15:20", hSalida: "15:35", hEntrega: "16:05", codigo: "MU-7743", estado: "Entregado", obs: "" },
  ];

  const claims = [
    { id: "R-032", orderId: "P-1040", customerId: "C06", fecha: hoyISO(), tipo: "Producto derretido", hEntrega: "18:40", hReclamo: "19:02", entregadoEn: hoyISO() + " 18:40", reclamoEn: hoyISO() + " 19:02", desc: "Cliente reporta que el momo llegó blando por un lado.", resp: "Karen", decision: "En análisis: revisar bolsa térmica usada en la ruta.", solucion: "", costo: 0, estado: "En revisión", evidencia: "2 fotos enviadas por WhatsApp" },
    { id: "R-031", orderId: "P-1031", customerId: "C06", fecha: dISO(-2), tipo: "Reclamo dudoso", hEntrega: "17:10", hReclamo: "20:25", entregadoEn: dISO(-2) + " 17:10", reclamoEn: dISO(-2) + " 20:25", desc: "Reclamo por sabor 3 horas después de la entrega, fuera de ventana de 20 minutos.", resp: "Julián", decision: "Rechazado por política de tiempos.", solucion: "Se explicó política y se ofreció 10% en próxima compra como gesto.", costo: 0, estado: "Rechazado", evidencia: "Sin evidencia del cliente" },
  ];

  const benefits = [
    { id: "B-11", customerId: "C05", beneficio: "20% descuento", tipoBeneficio: "descuento_porcentaje", valor: 20, productoGratisId: "", condicion: "Historia en Instagram", minimo: 40000, activacion: dISO(-2), vence: dISO(13), estado: "Usado", pedidoUso: "P-1042", obs: "Historia etiquetando la cuenta, 1.2k vistas." },
    { id: "B-12", customerId: "C01", beneficio: "Malteada gratis", tipoBeneficio: "producto_gratis", valor: 0, productoGratisId: "PR11", condicion: "Cliente VIP · 6ª compra", minimo: 30000, activacion: dISO(-4), vence: dISO(11), estado: "Activo", pedidoUso: "", obs: "" },
    { id: "B-13", customerId: "C03", beneficio: "Granizado gratis", tipoBeneficio: "producto_gratis", valor: 0, productoGratisId: "PR13", condicion: "Cumpleaños", minimo: 25000, activacion: dISO(-3), vence: dISO(11), estado: "Activo", pedidoUso: "", obs: "Felicitar en la entrega." },
    { id: "B-10", customerId: "C04", beneficio: "30% descuento especial", tipoBeneficio: "descuento_porcentaje", valor: 30, productoGratisId: "", condicion: "Reactivación · 30 días sin comprar", minimo: 35000, activacion: dISO(-15), vence: dISO(0), estado: "Activo", pedidoUso: "", obs: "Vence hoy. Enviar recordatorio por WhatsApp." },
  ];

  const audit_logs = [
    { id: "A05", fecha: hoyISO() + " 10:20", user: "Cocina", entidad: "Pedido", entidadId: "P-1041", accion: "Cambio de estado", de: "Pagado", a: "En producción" },
    { id: "A04", fecha: hoyISO() + " 09:42", user: "Logística", entidad: "Pedido", entidadId: "P-1043", accion: "Cambio de estado", de: "Listo para despacho", a: "En ruta" },
    { id: "A03B", fecha: hoyISO() + " 11:04", user: "Cocina", entidad: "Pedido", entidadId: "P-1042", accion: "Cambio de estado", de: "En producción", a: "Listo para empaque" },
    { id: "A03", fecha: hoyISO() + " 11:06", user: "Empaque", entidad: "Pedido", entidadId: "P-1042", accion: "Cambio de estado", de: "Listo para empaque", a: "Empacado" },
    { id: "A02", fecha: dISO(-1) + " 16:06", user: "Logística", entidad: "Pedido", entidadId: "P-1039", accion: "Cambio de estado", de: "En ruta", a: "Entregado" },
    { id: "A01", fecha: dISO(-1) + " 19:05", user: "Administrador", entidad: "Reclamo", entidadId: "R-032", accion: "Caso creado", de: "", a: "Abierto" },
  ];

  const production_suggestions = [
    { id: "S-02", fecha: hoyISO(), producto: "Momo premium", figura: "Teo", sabor: "Durazno", cantidad: 4, motivo: "Stock exacto por figura y sabor debajo de la demanda semanal", orderId: "", estado: "Pendiente", area: "Producción", itemId: "" },
  ];

  // recetas: consumo de insumos por 1 unidad de producto (tabla recipes, una fila por línea)
  const recipes = [
    { id: "RC01", productId: "PR01", itemId: "I01", cantidad: 0.12 },
    { id: "RC02", productId: "PR01", itemId: "I02", cantidad: 0.09 },
    { id: "RC03", productId: "PR01", itemId: "I03", cantidad: 0.03 },
    { id: "RC04", productId: "PR01", itemId: "I10", cantidad: 1 },
    { id: "RC05", productId: "PR08", itemId: "I01", cantidad: 0.08 },
    { id: "RC06", productId: "PR08", itemId: "I09", cantidad: 1 },
    { id: "RC07", productId: "PR08", itemId: "I12", cantidad: 1 },
    { id: "RC08", productId: "PR09", itemId: "I06", cantidad: 0.15 },
    { id: "RC09", productId: "PR09", itemId: "I04", cantidad: 0.05 },
    { id: "RC10", productId: "PR11", itemId: "I01", cantidad: 0.15 },
    { id: "RC11", productId: "PR11", itemId: "I09", cantidad: 1 },
    { id: "RC12", productId: "PR14", itemId: "I07", cantidad: 0.2 },
    { id: "RC13", productId: "PR14", itemId: "I09", cantidad: 1 },
  ];

  // normalización: pedidos que ya pasaron por Pagado llevan marca de pago
  orders.forEach((o) => {
    if (o.comprobante && !["Nuevo","Confirmado","Pendiente de pago"].includes(o.estado)) o.pagadoEn = o.fecha + " " + o.hora;
    o.metricasClienteActualizadas = o.estado === "Entregado";
  });
  // costo histórico por línea (congela el COGS aunque cambie el costo del producto)
  order_items.forEach((i) => {
    if (i.costoUnitario === undefined) {
      const p = products.find((x) => x.id === i.productId);
      i.costoUnitario = p ? p.costo : 0;
    }
  });

  // ---- Marketing: campañas ----
  const campaigns = [
    { id: "CMP-01", nombre: "Lanzamiento Lizi MOMOS", canal: "Instagram", objetivo: "Lanzamiento", productoFoco: "Momo Gatito", oferta: "2x1 primer pedido", fechaInicio: dISO(-20), fechaFin: dISO(10), presupuesto: 250000, gastoReal: 180000, estado: "Activa", responsable: "Marketing", notas: "Campaña insignia de Lizi; la familia comercial es Momo Gatito." },
    { id: "CMP-02", nombre: "Caja regalo x3", canal: "Facebook", objetivo: "Ventas", productoFoco: "Caja x3 Momos", oferta: "Envío gratis zona 1", fechaInicio: dISO(-12), fechaFin: dISO(6), presupuesto: 150000, gastoReal: 95000, estado: "Activa", responsable: "Marketing", notas: "Enfocada en regalos y fechas especiales." },
    { id: "CMP-03", nombre: "Historia + etiqueta = malteada gratis", canal: "Instagram", objetivo: "Recompra", productoFoco: "Malteada Oreo Momo", oferta: "Malteada gratis por historia", fechaInicio: dISO(-8), fechaFin: dISO(14), presupuesto: 60000, gastoReal: 20000, estado: "Activa", responsable: "Marketing", notas: "Beneficio conectado al módulo de Beneficios." },
    { id: "CMP-04", nombre: "Reactivación clientes 30 días", canal: "WhatsApp", objetivo: "Recompra", productoFoco: "Momo Perrito", oferta: "30% descuento reactivación", fechaInicio: dISO(-5), fechaFin: dISO(20), presupuesto: 40000, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "Segmentar clientes inactivos del CRM." },
  ];

  // ---- Marketing: creativos ----
  const creatives = [
    { id: "CRE-01", campaignId: "CMP-01", titulo: "Adopta a Lizi", canal: "Instagram", formato: "Reel", productoFoco: "Momo Gatito", figuraFoco: "Lizi", saborFoco: "Maracuyá", hook: "Da pesar comerla… hasta la primera cucharada", copy: "Lizi de mousse helado hecha a mano en Cali. Pide la tuya hoy 🐱", guion: "Plano 1: caja abriéndose. Plano 2: Lizi completa. Plano 3: cuchara rompiendo el mousse.", estado: "Ganador", responsable: "Karen", fechaEntrega: dISO(-18), assetUrl: "", notas: "El reel con mejor retención." },
    { id: "CRE-02", campaignId: "CMP-02", titulo: "El regalo más tierno de Cali", canal: "Facebook", formato: "Carrusel", productoFoco: "Caja x3 Momos", figuraFoco: "", saborFoco: "Surtido", hook: "El regalo más tierno de Cali", copy: "Sorprende con una caja de 3 momos surtidos. Envolvemos con lazo y tarjeta 🎁", guion: "", estado: "Publicado", responsable: "Marketing", fechaEntrega: dISO(-10), assetUrl: "", notas: "El combo no inventa una figura global; cada componente conserva su figura y sabor exactos." },
    { id: "CRE-03", campaignId: "CMP-01", titulo: "Lizi de mousse helado para regalar", canal: "Instagram", formato: "Historia", productoFoco: "Momo Gatito", figuraFoco: "Lizi", saborFoco: "Coco", hook: "Una Lizi de mousse helado para regalar", copy: "Desliza hacia arriba y pide la tuya 👆", guion: "", estado: "Publicado", responsable: "Karen", fechaEntrega: dISO(-6), assetUrl: "", notas: "" },
    { id: "CRE-04", campaignId: "CMP-03", titulo: "Sube tu historia y gana", canal: "Instagram", formato: "Historia", productoFoco: "Malteada Oreo Momo", figuraFoco: "", saborFoco: "Oreo", hook: "Etiquétanos y tu malteada va por la casa", copy: "Sube una historia con tu momo, etiquétanos y reclama tu malteada gratis 🥤", guion: "", estado: "Aprobado", responsable: "Marketing", fechaEntrega: dISO(-2), assetUrl: "", notas: "Listo para publicar esta semana." },
    { id: "CRE-05", campaignId: "CMP-01", titulo: "UGC clienta Ciudad Jardín", canal: "TikTok", formato: "Video UGC", productoFoco: "Momo Gatito", figuraFoco: "Momo", saborFoco: "Maracuyá", hook: "Me llegó Momo, el postre más lindo de Cali", copy: "", guion: "Cliente real mostrando la entrega y la primera cucharada.", estado: "En revisión", responsable: "Karen", fechaEntrega: dISO(1), assetUrl: "", notas: "Esperando aprobación de la clienta." },
    { id: "CRE-06", campaignId: "CMP-02", titulo: "Foto producto caja premium", canal: "Instagram", formato: "Foto producto", productoFoco: "Caja x6 Momos", figuraFoco: "Surtido", saborFoco: "Surtido", hook: "", copy: "", guion: "", estado: "En diseño", responsable: "Marketing", fechaEntrega: dISO(3), assetUrl: "", notas: "" },
    { id: "CRE-07", campaignId: "CMP-04", titulo: "Copy reactivación WhatsApp", canal: "WhatsApp", formato: "Copy", productoFoco: "Momo Perrito", figuraFoco: "Max", saborFoco: "Oreo", hook: "Te extrañamos 💗", copy: "¡Hola! Hace un mes no te consentimos. Tienes 30% en tu próximo Max de Oreo, solo por hoy.", guion: "", estado: "Idea", responsable: "Marketing", fechaEntrega: dISO(4), assetUrl: "", notas: "" },
  ];

  // ---- Marketing: calendario de contenido ----
  const content_calendar = [
    { id: "CAL-01", fecha: hoyISO(), hora: "12:00", canal: "Instagram", campaignId: "CMP-01", creativeId: "CRE-03", titulo: "Historia gatitos para regalar", copyFinal: "Desliza y pide el tuyo 👆", estado: "Publicado", urlPublicacion: "", notas: "" },
    { id: "CAL-02", fecha: hoyISO(), hora: "19:00", canal: "TikTok", campaignId: "CMP-01", creativeId: "CRE-05", titulo: "UGC clienta Ciudad Jardín", copyFinal: "", estado: "Programado", urlPublicacion: "", notas: "Sale a las 7 pm." },
    { id: "CAL-03", fecha: dISO(1), hora: "13:00", canal: "Instagram", campaignId: "CMP-03", creativeId: "CRE-04", titulo: "Reto historia + etiqueta", copyFinal: "Etiquétanos y gana tu malteada 🥤", estado: "Programado", urlPublicacion: "", notas: "" },
    { id: "CAL-04", fecha: dISO(2), hora: "18:00", canal: "Facebook", campaignId: "CMP-02", creativeId: "CRE-02", titulo: "Carrusel caja regalo", copyFinal: "El regalo más tierno de Cali", estado: "Pendiente", urlPublicacion: "", notas: "" },
    { id: "CAL-05", fecha: dISO(-1), hora: "20:00", canal: "Instagram", campaignId: "CMP-01", creativeId: "CRE-01", titulo: "Reel Adopta tu Momo", copyFinal: "Adopta el tuyo hoy 🐱", estado: "Publicado", urlPublicacion: "", notas: "Reel ganador." },
  ];

  // ---- Marketing: resultados manuales ----
  const creative_results = [
    { id: "RES-01", creativeId: "CRE-01", campaignId: "CMP-01", fecha: dISO(-1), impresiones: 18400, alcance: 12300, clicks: 640, mensajesWhatsApp: 85, pedidos: 14, ventas: 268000, gasto: 90000, notas: "Reel ganador, mejor ROAS." },
    { id: "RES-02", creativeId: "CRE-02", campaignId: "CMP-02", fecha: dISO(-2), impresiones: 9800, alcance: 7100, clicks: 210, mensajesWhatsApp: 32, pedidos: 5, ventas: 245000, gasto: 60000, notas: "" },
    { id: "RES-03", creativeId: "CRE-03", campaignId: "CMP-01", fecha: dISO(-3), impresiones: 6200, alcance: 5000, clicks: 180, mensajesWhatsApp: 40, pedidos: 6, ventas: 108000, gasto: 45000, notas: "" },
    { id: "RES-04", creativeId: "CRE-05", campaignId: "CMP-01", fecha: dISO(-1), impresiones: 4300, alcance: 3900, clicks: 95, mensajesWhatsApp: 22, pedidos: 3, ventas: 54000, gasto: 30000, notas: "UGC recién publicado." },
  ];

  // atribuir algunos pedidos semilla a campañas/creativos
  const attr = {
    "P-1041": { campaignId: "CMP-01", creativeId: "CRE-01", origenDetalle: "Reel de Instagram" },
    "P-1042": { campaignId: "CMP-03", creativeId: "CRE-04", origenDetalle: "Historia de Instagram" },
    "P-1043": { campaignId: "", creativeId: "", origenDetalle: "Rappi" },
    "P-1045": { campaignId: "CMP-01", creativeId: "CRE-03", origenDetalle: "Historia de Instagram" },
    "P-1039": { campaignId: "CMP-02", creativeId: "CRE-02", origenDetalle: "Anuncio Meta" },
  };
  orders.forEach((o) => {
    const a = attr[o.id] || {};
    o.campaignId = a.campaignId || "";
    o.creativeId = a.creativeId || "";
    o.origenDetalle = a.origenDetalle || "";
  });

  // ---- Crecimiento: ideas listas (biblioteca aprobada) ----
  const marketing_ideas = [
    { id: "ID-01", titulo: "Da pesar comerlos… hasta la primera cucharada", cat: "Ideas tiernas", objetivo: "vender", productoSugerido: "Lizi · Momo Gatito", copy: "Da pesar comer a Lizi… hasta la primera cucharada 🥺🐱 Pide la tuya por WhatsApp.", guionCorto: "Muestra a Lizi completa, luego la cuchara entrando al mousse.", canal: "Instagram", estado: "Ganadora" },
    { id: "ID-02", titulo: "Elige tu figura MOMOS favorita", cat: "Ideas tiernas", objetivo: "vender", productoSugerido: "Max · Momo Perrito", copy: "Elige tu figura MOMOS favorita 🐶🐱 postres de mousse helado, hechos en Cali.", guionCorto: "Fila de figuras surtidas; la mano elige a Max.", canal: "TikTok", estado: "Repetir" },
    { id: "ID-03", titulo: "Caja x3 para regalar", cat: "Ideas de regalo", objetivo: "regalo", productoSugerido: "Caja x3 Momos", copy: "El regalo más tierno de Cali 🎁 Caja x3 MOMOS con lazo y tarjeta. Pide la tuya.", guionCorto: "Caja cerrada, se abre lento y aparecen los 3 momos.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-04", titulo: "Toby de mousse helado", cat: "Ideas para vender", objetivo: "seguidores", productoSugerido: "Toby · Momo Gatito", copy: "Toby de mousse helado 🐱💛 el antojo que te cambia el día.", guionCorto: "Primer plano de la figura Toby.", canal: "TikTok", estado: "Usada" },
    { id: "ID-05", titulo: "Max para cumpleaños", cat: "Ideas para cumpleaños", objetivo: "cumpleaños", productoSugerido: "Max · Momo Perrito", copy: "¿Cumple de alguien especial? 🎂 Regálale un Max MOMOS y sorpréndelo.", guionCorto: "Max con una velita encima.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-06", titulo: "Historia + etiqueta = malteada gratis", cat: "Ideas para que etiqueten a MOMOS", objetivo: "historias etiquetadas", productoSugerido: "Malteada Oreo Momo", copy: "Sube una historia con tu MOMOS, etiquétanos y tu malteada va por la casa 🥤💛", guionCorto: "Cliente etiquetando la cuenta en su historia.", canal: "Instagram", estado: "Ganadora" },
    { id: "ID-07", titulo: "Así nace Lizi", cat: "Ideas para mostrar proceso", objetivo: "seguidores", productoSugerido: "Lizi · Momo Gatito", copy: "Así nace Lizi MOMOS 🐱 todo hecho a mano, con amor y mousse helado.", guionCorto: "Timelapse del desmolde de Lizi y su decorado.", canal: "TikTok", estado: "Nueva" },
    { id: "ID-08", titulo: "Lizi, nuevo sabor: coco", cat: "Ideas para sabores", objetivo: "vender", productoSugerido: "Lizi de Coco · Momo Gatito", copy: "¡Nuevo sabor! 🥥 Lizi de coco, cremosa y tropical. Solo esta semana.", guionCorto: "Cuchara mostrando el relleno de Lizi de coco.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-09", titulo: "Te extrañamos, vuelve por tu MOMOS", cat: "Ideas para clientes que ya compraron", objetivo: "recompra", productoSugerido: "Momo · Momo Gatito", copy: "Hace rato no te consentimos 💛 vuelve por tu figura MOMOS favorita.", guionCorto: "La figura Momo con mensaje 'te extrañamos'.", canal: "WhatsApp", estado: "Nueva" },
    { id: "ID-10", titulo: "Especial de fin de semana", cat: "Ideas para fechas especiales", objetivo: "vender", productoSugerido: "Caja x3 Momos", copy: "Plan de finde: MOMOS a domicilio 🛵💛 pide antes de las 5 pm y disfruta.", guionCorto: "Caja llegando a la puerta.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-11", titulo: "Teo entra en escena", cat: "Ideas para productos nuevos", objetivo: "vender", productoSugerido: "Teo · Momo premium", copy: "¡Teo MOMOS entra en escena! 🐱 una figura premium para un antojo especial.", guionCorto: "Presentación de Teo girando con su sabor visible.", canal: "TikTok", estado: "Nueva" },
    { id: "ID-12", titulo: "El regalo más tierno de Cali", cat: "Ideas de regalo", objetivo: "regalo", productoSugerido: "Caja x6 Momos", copy: "El regalo más tierno de Cali 🎁 sorprende con una caja x6 MOMOS.", guionCorto: "Persona recibiendo la caja emocionada.", canal: "Instagram", estado: "Repetir" },
  ];

  // ---- Crecimiento: guiones fáciles ----
  const marketing_guiones = [
    { id: "GU-01", titulo: "Da pesar comerla… hasta la primera cucharada", duracion: "15 seg", productoFoco: "Lizi · Momo Gatito", objetivo: "vender", dificultad: "Fácil", escena1: "Muestra a Lizi completa sobre la mano.", escena2: "Acercamiento a la figura de Lizi.", escena3: "La cuchara entra lentamente al mousse.", escena4: "Muestra el relleno por dentro.", textoPantalla: "Pide tu Lizi por WhatsApp 💛", audio: "Audio tierno o trend suave de moda" },
    { id: "GU-02", titulo: "Abre la caja x3", duracion: "20 seg", productoFoco: "Caja x3 Momos", objetivo: "regalo", dificultad: "Fácil", escena1: "Caja cerrada con el lazo.", escena2: "Manos abriendo la caja lentamente.", escena3: "Se ven los 3 momos surtidos.", escena4: "Primer plano de cada figura.", textoPantalla: "El regalo más tierno de Cali 🎁", audio: "Música alegre suave" },
    { id: "GU-03", titulo: "Así se hace Lizi", duracion: "30 seg", productoFoco: "Lizi · Momo Gatito", objetivo: "seguidores", dificultad: "Medio", escena1: "Vertido del mousse en el molde de Lizi.", escena2: "Al congelador (timelapse).", escena3: "Desmolde de Lizi.", escena4: "Decorado de la figura y salsa.", textoPantalla: "Hecho a mano, con amor 💛", audio: "Audio satisfactorio / ASMR" },
    { id: "GU-04", titulo: "Reto historia + etiqueta", duracion: "10 seg", productoFoco: "Malteada Oreo Momo", objetivo: "historias etiquetadas", dificultad: "Fácil", escena1: "Muestra la malteada.", escena2: "Texto: sube tu historia y etiquétanos.", escena3: "Muestra el momo junto a la malteada.", escena4: "", textoPantalla: "Tu malteada va por la casa 🥤", audio: "Trend del momento" },
    { id: "GU-05", titulo: "Max para cumpleaños", duracion: "15 seg", productoFoco: "Max · Momo Perrito", objetivo: "cumpleaños", dificultad: "Fácil", escena1: "Max con una velita encima.", escena2: "Se enciende la velita.", escena3: "Alguien pide un deseo.", escena4: "Primer plano de Max.", textoPantalla: "Sorprende en su cumple 🎂", audio: "Cumpleaños suave / tierno" },
  ];

  // ---- Crecimiento: mensajes listos de WhatsApp ----
  const marketing_mensajes = [
    { id: "MSG-01", tipo: "Cliente nuevo", texto: "¡Hola! 💛 Bienvenido a D'Momos Sweet Love 🐱 Tenemos gatitos y perritos de mousse helado, cheesecakes y más. ¿Te muestro el menú de hoy?" },
    { id: "MSG-02", tipo: "Cliente que preguntó precio", texto: "¡Hola! 💛 Las figuras de la familia Momo Gatito están desde $18.000 y la caja x3 en $49.000. ¿Cuál figura y sabor te provoca para hoy?" },
    { id: "MSG-03", tipo: "Cliente que no respondió", texto: "¡Hola de nuevo! 🐱 Todavía tenemos MOMOS fresquitos para hoy. ¿Te animas a adoptar uno? Te lo llevamos a domicilio 🛵" },
    { id: "MSG-04", tipo: "Cliente que compró hace 7 días", texto: "¡Hola! 💛 ¿Qué tal estuvo tu MOMOS? Esta semana tenemos sabores nuevos. ¿Quieres que te cuente cuáles?" },
    { id: "MSG-05", tipo: "Cliente que compró hace 15 días", texto: "¡Te extrañamos! 💛 Hace rato no te consentimos con un MOMOS. ¿Te separo tu favorito para hoy?" },
    { id: "MSG-06", tipo: "Cliente que cumple años", texto: "¡Feliz cumpleaños! 🎂💛 En MOMOS queremos celebrarte. Ven por tu regalito de cumpleaños, te tenemos una sorpresa dulce 🐱" },
    { id: "MSG-07", tipo: "Cliente que subió historia", texto: "¡Mil gracias por la historia! 💛 Como prometimos, tu malteada va por la casa 🥤 ¿Cuándo pasas por tu pedido?" },
    { id: "MSG-08", tipo: "Cliente con beneficio activo", texto: "¡Hola! 🎁 Tienes un beneficio activo con nosotros. No dejes que se venza 💛 ¿Aprovechamos hoy con un MOMOS?" },
    { id: "MSG-09", tipo: "Cliente con reclamo", texto: "¡Hola! 💛 Lamentamos mucho lo sucedido con tu pedido. Queremos solucionarlo enseguida. ¿Nos cuentas qué pasó y te compensamos? 🙏" },
    { id: "MSG-10", tipo: "Cliente VIP", texto: "¡Hola, cliente consentido! 💛👑 Como siempre nos apoyas, hoy tenemos MOMOS listos: gatitos de maracuyá, Oreo y Nutella. ¿Te separo una cajita para hoy?" },
    { id: "MSG-11", tipo: "Cliente que compró hace 30 días", texto: "¡Hola! 💛 Hace un mes disfrutaste tu MOMOS. Te tenemos un 30% especial de reactivación, solo por hoy 🐱 ¿Lo aprovechamos?" },
    { id: "MSG-12", tipo: "Recordatorio de pago", texto: "¡Hola! 💛 Recuerda que separamos tu MOMOS. Para despacharlo necesitamos confirmar tu pago por Nequi o Bancolombia 🙏 ¿Te paso los datos?" },
  ];

  // ---- Crecimiento: biblioteca de marca ----
  const brand_library = {
    frases: [
      "Da pesar comerlos… hasta la primera cucharada.",
      "El regalo más tierno de Cali.",
      "Adopta tu Momo favorito.",
      "Gatitos de mousse helado.",
      "El antojo que te cambia el día.",
    ],
    tono: ["Tierno","Premium","Cercano","Dulce","Familiar","No vulgar","No agresivo","No demasiado infantil"],
    palabrasSi: ["adoptar","ternura","regalo","antojo","mousse helado","cajita","sorpresa","Sweet Love"],
    palabrasNo: ["barato","remate","producto dañado","copia","descuento desesperado","último chance agresivo"],
  };

  // ---- Crecimiento: tareas diarias sugeridas ----
  const marketing_tasks = [
    { id: "TAR-01", tarea: "Publicar la historia del producto del día", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-02", tarea: "Subir el Reel recomendado", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-03", tarea: "Revisar etiquetas en Instagram y activar beneficios", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-04", tarea: "Responder comentarios y mensajes", fecha: hoyISO(), estado: "Hecha", responsable: "Marketing" },
    { id: "TAR-05", tarea: "Escribir a clientes con beneficio por vencer", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-06", tarea: "Escribir a clientes que no compran hace 15 días", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-07", tarea: "Revisar cómo va la campaña activa", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
    { id: "TAR-08", tarea: "Registrar los resultados del contenido publicado ayer", fecha: hoyISO(), estado: "Pendiente", responsable: "Marketing" },
  ];

  return { version: DB_VERSION, settings, products, customers, orders, order_items, production_batches, variantes: [], variantesCuarentena: [], inventory_items, inventory_movements, deliveries, evidences, claims, benefits, audit_logs, production_suggestions, recipes, inventory_reservations: [], users: seedUsers(), campaigns, creatives, content_calendar, creative_results, inventoryMutationDeltaReady: false, inventoryMutationEventVersion: "", inventoryMutationFullSnapshotRequired: true, orderDeltaReady: false, orderDeltaVersions: {}, deliveryMutationDeltaReady: false, finishedInventoryDeltaReady: false, finishedInventoryDeltaVersions: {}, productionMutationDeltaReady: false, productionActivityDeltaVersion: "", catalogCrmDeltaReady: false, productCatalogDeltaVersions: {}, customerCrmDeltaVersions: {}, financeSnapshotReady: false, financeSnapshot: null, financeSnapshotKey: "", financeSnapshotVersion: "", configurationSnapshotReady: false, configurationSnapshotVersion: "", configurationInventoryChoices: [], configurationFigureProductChoices: [], agencySnapshotReady: false, agencySnapshotVersion: "", agencyOperationalFactsReady: false, agencyOperationalFacts: null, agencyBrandIdentity: null, content_distributions: [], distributionConnectorReady: false, distributionConnectorJobs: [], brandMediaReady: false, mundoAnimadoReady: false, officialLogoDeletionReady: false, mcpHumanApprovalReady: false, mcpHumanApprovals: [], brandMediaAssets: [], creativeGenerationJobs: [], brandMediaUsages: [], agencyIntegrationsReady: false, agencyIntegrations: [], creativeConnectorRuns: [], higgsfieldConnectorReady: false, klingConnectorReady: false, agencyMetaConnectorReady: false, agencyMetaConnectorDryRuns: [], agencyCollaborationReady: false, agencyCollaborationRooms: [], agencyCollaborationEntries: [], agencyCreativeContracts: [], agencySceneStudioReady: false, agencyStoryboards: [], agencyStoryboardShots: [], agencyMotionReady: false, agencyMotionPlans: [], agencyMotionRecipes: [], agencyMotionObservations: [], agencySceneRouterReady: false, agencySceneRoutingPlans: [], agencyQualityReady: false, agencySceneQualityReviews: [], agencyPostproductionPackages: [], agencyPostproductionExportReady: false, agencyPostproductionExports: [], agencyPostproductionWorkers: [], agencyPostproductionAudioReady: false, agencyPostproductionAudioBindings: [], agencyRetentionReady: false, agencyRetentionScripts: [], agencyRetentionHooks: [], agencyRetentionLoops: [], agencyRetentionExperiments: [], agencyRetentionMeasurements: [], agencyLoopLearningReady: false, agencyRetentionDiagnostics: [], agencyRetentionLearnings: [], agencyMetaReady: false, agencyMetaPolicies: [], agencyMetaSnapshots: [], agencyMetaDiagnostics: [], agencyMetaIncrementalityReady: false, agencyMetaLiftStudies: [], agencyMetaLiftMeasurements: [], agencyMetaInvestmentReady: false, agencyMetaInvestmentScenarios: [], agencyMetaAuthorizationReady: false, agencyMetaInvestmentAuthorizations: [], agencyMetaInvestmentExecutionJobs: [], agencyBrandGovernanceReady: false, agencyBrandProfile: null, agencyBrandGateBindings: [], agencyGrowthReady: false, agencyGrowthPolicies: [], agencyGrowthSnapshots: [], agencyGrowthSelections: [], agencyCreativeFlowReady: false, agencyMasterReleases: [], agencyMasterReleaseEvents: [], marketing_ideas, marketing_guiones, marketing_mensajes, brand_library, marketing_tasks };
}

/* ---- Atributos derivados del dominio comercial (ÚNICA fuente de verdad) ----
   La categoría distingue familias con figura, cajas y productos al momento.
   Un cuchareable pide sabor y salsa, pero nunca una figura física. */
function atributosDeTipo(productOrType, category = "", name = "") {
  const product = productOrType && typeof productOrType === "object"
    ? productOrType
    : { tipo: productOrType, cat: category, nombre: name };
  return orderAttributesForProduct(product);
}
const ATRIBUTO_LABEL = { sabor: "Sabor", salsa: "Salsa", figura: "Figura" };

/* ---- Migraciones entre versiones (no se pierden datos del usuario) ---- */
function normalizeDbShape(d) {
  const s = seedDb();
  const arrayTables = [
    "orders", "order_items", "customers", "products", "production_batches", "subreceta_producciones", "variantes", "variantesCuarentena",
    "deliveryOrders", "deliveryOrderItems", "deliveryCustomers", "deliveryDeliveries",
    "inventory_items", "inventory_lots", "inventory_movements", "deliveries", "evidences", "claims",
    "benefits", "audit_logs", "production_suggestions", "recipes", "inventory_reservations",
    "users", "campaigns", "creatives", "content_calendar", "creative_results", "content_distributions", "distributionConnectorJobs",
    "brandMediaAssets", "brandProductionPacks", "brandProductionPackAssets", "creativeGenerationJobs", "brandMediaUsages", "agencyIntegrations", "creativeConnectorRuns", "agencyMetaConnectorDryRuns",
    "agencyMotionPlans", "agencyMotionRecipes", "agencyMotionObservations", "agencySceneQualityReviews", "agencyPostproductionPackages", "agencyPostproductionExports", "agencyPostproductionWorkers", "agencyPostproductionAudioBindings",
    "agencyBrandGateBindings", "agencyMasterReleases", "agencyMasterReleaseEvents",
    "marketing_ideas", "marketing_guiones", "marketing_mensajes", "marketing_tasks",
  ];
  arrayTables.forEach((k) => {
    if (!Array.isArray(d[k])) d[k] = s[k] || [];
  });
  d.inventoryMutationDeltaReady = d.inventoryMutationDeltaReady === true;
  const inventoryCursor = normalizeInventoryCursorToken(d.inventoryMutationEventVersion);
  d.inventoryMutationFullSnapshotRequired = d.inventoryMutationFullSnapshotRequired !== false
    || !inventoryCursor;
  d.inventoryMutationEventVersion = d.inventoryMutationFullSnapshotRequired ? "" : inventoryCursor;
  d.orderDeltaReady = d.orderDeltaReady === true;
  d.deliveryMutationDeltaReady = d.deliveryMutationDeltaReady === true;
  if (!d.orderDeltaVersions || typeof d.orderDeltaVersions !== "object" || Array.isArray(d.orderDeltaVersions)) {
    d.orderDeltaVersions = {};
  }
  d.deliverySnapshotReady = d.deliverySnapshotReady === true;
  d.deliverySnapshotVersion = normalizeAgencySnapshotVersion(d.deliverySnapshotVersion);
  if (!d.deliverySnapshotSummary || typeof d.deliverySnapshotSummary !== "object"
      || Array.isArray(d.deliverySnapshotSummary)) d.deliverySnapshotSummary = null;
  d.finishedInventoryDeltaReady = d.finishedInventoryDeltaReady === true;
  if (!d.finishedInventoryDeltaVersions || typeof d.finishedInventoryDeltaVersions !== "object"
      || Array.isArray(d.finishedInventoryDeltaVersions)) d.finishedInventoryDeltaVersions = {};
  d.productionMutationDeltaReady = d.productionMutationDeltaReady === true;
  d.finishedProductDisposalReady = d.finishedProductDisposalReady === true;
  d.productionActivityDeltaVersion = /^\d+$/.test(String(d.productionActivityDeltaVersion || ""))
    ? String(d.productionActivityDeltaVersion) : "";
  d.catalogCrmDeltaReady = d.catalogCrmDeltaReady === true;
  if (!d.productCatalogDeltaVersions || typeof d.productCatalogDeltaVersions !== "object"
      || Array.isArray(d.productCatalogDeltaVersions)) d.productCatalogDeltaVersions = {};
  if (!d.customerCrmDeltaVersions || typeof d.customerCrmDeltaVersions !== "object"
      || Array.isArray(d.customerCrmDeltaVersions)) d.customerCrmDeltaVersions = {};
  d.financeSnapshotReady = d.financeSnapshotReady === true;
  if (!d.financeSnapshot || typeof d.financeSnapshot !== "object" || Array.isArray(d.financeSnapshot)) d.financeSnapshot = null;
  d.financeSnapshotKey = typeof d.financeSnapshotKey === "string" ? d.financeSnapshotKey : "";
  d.financeSnapshotVersion = normalizeAgencySnapshotVersion(d.financeSnapshotVersion);
  d.configurationSnapshotReady = d.configurationSnapshotReady === true;
  d.configurationSnapshotVersion = normalizeAgencySnapshotVersion(d.configurationSnapshotVersion);
  if (!Array.isArray(d.configurationInventoryChoices)) d.configurationInventoryChoices = [];
  if (!Array.isArray(d.configurationFigureProductChoices)) d.configurationFigureProductChoices = [];
  d.dashboardSnapshotReady = d.dashboardSnapshotReady === true;
  d.dashboardSnapshotVersion = normalizeAgencySnapshotVersion(d.dashboardSnapshotVersion);
  if (!d.dashboardSnapshot || typeof d.dashboardSnapshot !== "object" || Array.isArray(d.dashboardSnapshot)) d.dashboardSnapshot = null;
  d.agencySnapshotReady = d.agencySnapshotReady === true;
  d.agencySnapshotVersion = normalizeAgencySnapshotVersion(d.agencySnapshotVersion);
  d.agencyOperationalFactsReady = d.agencyOperationalFactsReady === true
    && hasAgencyOperationalFacts(d.agencyOperationalFacts);
  if (!d.agencyOperationalFactsReady) d.agencyOperationalFacts = null;
  if (!d.agencyBrandIdentity || typeof d.agencyBrandIdentity !== "object" || Array.isArray(d.agencyBrandIdentity)) d.agencyBrandIdentity = null;
  d.products.forEach((p) => {
    p.tipo = productTypeForCategory(p.cat);
    p.atributos = atributosDeTipo(p);
    if (!isCommercialFamilyProduct(p)) delete p.especie;
    else if (p.especie !== "perro" && p.especie !== "gato") p.especie = "";
  });
  d.order_items.forEach((i) => { if (!Array.isArray(i.adiciones)) i.adiciones = []; }); // toppings por línea (retro-compat)
  if (!d.brand_library || typeof d.brand_library !== "object" || Array.isArray(d.brand_library)) {
    d.brand_library = cloneDb(s.brand_library);
  } else {
    d.brand_library = { ...cloneDb(s.brand_library), ...d.brand_library };
    ["frases", "tono", "palabrasSi", "palabrasNo"].forEach((k) => {
      if (!Array.isArray(d.brand_library[k])) d.brand_library[k] = cloneDb(s.brand_library[k] || []);
    });
  }
  if (!d.settings || typeof d.settings !== "object" || Array.isArray(d.settings)) {
    d.settings = cloneDb(s.settings);
  } else {
    d.settings = {
      ...cloneDb(s.settings),
      ...d.settings,
      counters: {
        ...cloneDb(s.settings.counters),
        ...(d.settings.counters && typeof d.settings.counters === "object" && !Array.isArray(d.settings.counters)
          ? d.settings.counters
          : {}),
      },
    };
  }
  ["zonas", "saboresFrutales", "saboresCremosos", "salsas", "rellenos", "figuras", "pagos", "proveedores"].forEach((k) => {
    if (!Array.isArray(d.settings[k])) d.settings[k] = cloneDb(s.settings[k]);
  });
  // figuras evolucionó de string[] a objetos {nombre, especie, gramaje}.
  // Normaliza entradas viejas (localStorage previo) para que .nombre no rompa.
  d.settings.figuras = activeConfigurationFigureCatalog({
    products: d.products,
    figuras: d.settings.figuras
    .map((f) => {
      const nombre = String(typeof f === "string" ? f : f?.nombre || "").trim();
      const canonical = KITCHEN_FIGURE_DEFAULTS[nombre];
      if (typeof f === "string") {
        return {
          nombre,
          especie: canonical?.species || "",
          gramaje: canonical ? `${canonical.grams} g` : "",
          productId: expectedFigureProductId(nombre),
          activo: true,
        };
      }
      return {
        nombre,
        especie: ["gato", "perro"].includes(f?.especie) ? f.especie : (canonical?.species || ""),
        gramaje: f?.gramaje || (f?.gramajeG ? `${f.gramajeG} g` : (canonical ? `${canonical.grams} g` : "")),
        productId: String(f?.productId || f?.product_id || expectedFigureProductId(nombre)).trim(),
        activo: f?.activo !== false,
      };
    })
    .filter((f) => isKitchenFigureName(f.nombre) || isAuxiliaryFigureName(f.nombre)),
  });
  // relleno pasó a valor único fijo ("Cheesecake con ganache"). Migra el default viejo
  // de 2 ítems al canónico, sin pisar personalizaciones del usuario.
  if (Array.isArray(d.settings.rellenos) && d.settings.rellenos.length === 2 &&
      d.settings.rellenos.includes("Cheesecake") && d.settings.rellenos.includes("Ganache")) {
    d.settings.rellenos = ["Cheesecake con ganache"];
  }
  // toppings/adiciones: catálogo de objetos {nombre, precio, insumoId, insumoCant}. Seed si falta; normaliza shape.
  if (!Array.isArray(d.settings.toppings)) d.settings.toppings = cloneDb(s.settings.toppings);
  d.settings.toppings = d.settings.toppings
    .map((t) => typeof t === "string"
      ? { nombre: t, precio: 0, insumoId: "", insumoCant: 1 }
      : { nombre: (t.nombre || "").trim(), precio: +t.precio || 0, insumoId: t.insumoId || "", insumoCant: +t.insumoCant || 1 })
    .filter((t) => t.nombre);
  if (typeof d.settings.pedidoMinimo !== "number") d.settings.pedidoMinimo = s.settings.pedidoMinimo;
  if (typeof d.settings.pautaMensual !== "number") d.settings.pautaMensual = s.settings.pautaMensual;
  if (typeof d.settings.horasCongelacion !== "number") d.settings.horasCongelacion = s.settings.horasCongelacion;
  if (typeof d.settings.vidaUtilConfigurable !== "boolean") d.settings.vidaUtilConfigurable = s.settings.vidaUtilConfigurable;
  if (!Number.isInteger(d.settings.vidaUtilProductoTerminadoDias) || d.settings.vidaUtilProductoTerminadoDias < 1 || d.settings.vidaUtilProductoTerminadoDias > 30) d.settings.vidaUtilProductoTerminadoDias = s.settings.vidaUtilProductoTerminadoDias;
  if (!Number.isInteger(d.settings.vidaUtilMezclasDias) || d.settings.vidaUtilMezclasDias < 1 || d.settings.vidaUtilMezclasDias > 30) d.settings.vidaUtilMezclasDias = s.settings.vidaUtilMezclasDias;
  Object.assign(d.settings, normalizeKitchenDelaySettings(d.settings));
  if (typeof d.settings.politicas !== "string") d.settings.politicas = s.settings.politicas;
  return d;
}

function migrate(d) {
  if (d.version === 1) {
    // #20: v1 se migra en lugar de descartarse; normalizeDbShape (llamado antes) ya completó settings/counters
    d.version = 2;
  }
  if (d.version === 2) {
    const s = seedDb();
    d.recipes = s.recipes;
    d.settings.counters.recipe = 13;
    d.settings.counters.invitem = d.settings.counters.invitem || 14;
    d.version = 3;
  }
  if (d.version === 3) {
    d.inventory_reservations = [];
    d.users = d.users || seedUsers();
    d.settings.counters.reservation = d.settings.counters.reservation || 0;
    d.settings.counters.user = d.settings.counters.user || 3;
    (d.benefits || []).forEach((b) => {
      if (b.tipoBeneficio) return;
      if (/%/.test(b.beneficio)) { b.tipoBeneficio = "descuento_porcentaje"; b.valor = parseInt(b.beneficio) || 0; b.productoGratisId = ""; }
      else if (/gratis/i.test(b.beneficio)) { b.tipoBeneficio = "producto_gratis"; b.valor = 0; b.productoGratisId = /malteada/i.test(b.beneficio) ? "PR11" : /granizado/i.test(b.beneficio) ? "PR13" : ""; }
      else { b.tipoBeneficio = "descuento_valor_fijo"; b.valor = b.valor || 0; b.productoGratisId = ""; }
    });
    (d.orders || []).forEach((o) => {
      if (o.comprobante && !o.pagadoEn && !["Nuevo","Confirmado","Pendiente de pago"].includes(o.estado)) o.pagadoEn = o.fecha + " " + (o.hora || "");
    });
    d.version = 4;
  }
  if (d.version === 4) {
    (d.production_batches || []).forEach((l) => {
      if (l.stockContabilizado === undefined) l.stockContabilizado = l.estado === "Listo";
    });
    d.version = 5;
  }
  if (d.version === 5) {
    if (d.settings.horasCongelacion === undefined) d.settings.horasCongelacion = 10;
    (d.production_batches || []).forEach((l) => {
      if (l.horasCongelacion === undefined) l.horasCongelacion = d.settings.horasCongelacion;
      if (l.inicioCongelacion === undefined) l.inicioCongelacion = l.estado === "Congelando" ? (l.fecha + " 00:00:00") : "";
    });
    d.version = 6;
  }
  if (d.version === 6) {
    // eliminar Efectivo del catálogo de pagos
    d.settings.pagos = (d.settings.pagos || []).filter((p) => p !== "Efectivo");
    // política de no efectivo / no despacho sin pago
    d.settings.politicas = "MOMOS no despacha ningún pedido sin pago confirmado: se requiere comprobante de transferencia (Nequi, Daviplata o Bancolombia) o el pago dentro de la app de Rappi. No se aceptan pagos en efectivo contra entrega. Reclamos por estado del producto: máximo 20 minutos después de recibido, salvo calidad o inocuidad. Un beneficio por pedido, no acumulable, no aplica sobre domicilio.";
    // migrar pedidos antiguos con pago en efectivo
    (d.orders || []).forEach((o) => {
      if (o.pago === "Efectivo") {
        o.pago = o.canal === "Rappi" ? "Rappi (app)" : "Nequi";
        o.comprobante = false;
        if (!o.pagadoEn && !["En ruta","Entregado"].includes(o.estado)) o.estado = "Pendiente de pago";
        o.obs = (o.obs ? o.obs + " · " : "") + "El pago en efectivo fue eliminado por política MOMOS; confirmar pago digital.";
      }
    });
    d.version = 7;
  }
  if (d.version === 7) {
    const s = seedDb();
    d.campaigns = d.campaigns || s.campaigns;
    d.creatives = d.creatives || s.creatives;
    d.content_calendar = d.content_calendar || s.content_calendar;
    d.creative_results = d.creative_results || s.creative_results;
    d.settings.counters.campaign = d.settings.counters.campaign || 4;
    d.settings.counters.creative = d.settings.counters.creative || 8;
    d.settings.counters.calendar = d.settings.counters.calendar || 6;
    d.settings.counters.result = d.settings.counters.result || 5;
    (d.orders || []).forEach((o) => {
      if (o.campaignId === undefined) o.campaignId = "";
      if (o.creativeId === undefined) o.creativeId = "";
      if (o.origenDetalle === undefined) o.origenDetalle = "";
    });
    d.version = 8;
  }
  if (d.version === 8) {
    const s = seedDb();
    d.marketing_ideas = d.marketing_ideas || s.marketing_ideas;
    d.marketing_guiones = d.marketing_guiones || s.marketing_guiones;
    d.marketing_mensajes = d.marketing_mensajes || s.marketing_mensajes;
    d.brand_library = d.brand_library || s.brand_library;
    d.marketing_tasks = d.marketing_tasks || s.marketing_tasks;
    d.settings.counters.idea = d.settings.counters.idea || 12;
    d.settings.counters.guion = d.settings.counters.guion || 5;
    d.settings.counters.mensaje = d.settings.counters.mensaje || 12;
    d.settings.counters.tarea = d.settings.counters.tarea || 8;
    d.settings.counters.frase = d.settings.counters.frase || 6;
    (d.claims || []).forEach((r) => {
      if (r.fecha === undefined) {
        const o = (d.orders || []).find((x) => x.id === r.orderId);
        r.fecha = o ? o.fecha : hoyISO();
      }
      // preparar campos nuevos sin romper datos antiguos (fallback a hEntrega/hReclamo)
      if (r.reclamoEn === undefined) r.reclamoEn = (r.fecha && r.hReclamo && r.hReclamo !== "—") ? (r.fecha + " " + r.hReclamo) : "";
      if (r.entregadoEn === undefined) r.entregadoEn = (r.fecha && r.hEntrega && r.hEntrega !== "—") ? (r.fecha + " " + r.hEntrega) : "";
    });
    (d.production_suggestions || []).forEach((sg) => {
      if (sg.area === undefined) {
        const emp = (d.inventory_items || []).find((i) => i.nombre === sg.producto);
        const esEmpaque = emp || /empaque|caja|bolsa|sticker|vaso|cuchara|lazo|tarjeta/i.test(sg.producto);
        sg.area = esEmpaque ? "Inventario" : "Producción";
        sg.itemId = emp ? emp.id : "";
      }
    });
    d.version = 9;
  }
  if (d.version === 9) {
    // asegurar componentProductIds en las cajas
    ["PR05","PR06","PR07"].forEach((pid) => {
      const p = (d.products || []).find((x) => x.id === pid);
      if (p) p.componentProductIds = ["PR01","PR02"];
    });
    // marca de métricas de cliente en pedidos antiguos
    (d.orders || []).forEach((o) => {
      if (o.metricasClienteActualizadas === undefined) o.metricasClienteActualizadas = o.estado === "Entregado";
    });
    d.version = 10;
  }
  if (d.version === 10) {
    const s = seedDb();
    // A. tablas de crecimiento/marketing
    d.marketing_ideas = d.marketing_ideas || s.marketing_ideas;
    d.marketing_guiones = d.marketing_guiones || s.marketing_guiones;
    d.marketing_mensajes = d.marketing_mensajes || s.marketing_mensajes;
    d.brand_library = d.brand_library || s.brand_library;
    d.marketing_tasks = d.marketing_tasks || s.marketing_tasks;
    // B. counters
    const cnt = d.settings.counters;
    cnt.idea = cnt.idea || 12; cnt.guion = cnt.guion || 5; cnt.mensaje = cnt.mensaje || 12;
    cnt.tarea = cnt.tarea || 8; cnt.frase = cnt.frase || 6;
    // C. eliminar Efectivo del catálogo
    d.settings.pagos = (d.settings.pagos || []).filter((p) => p !== "Efectivo");
    // D. limpiar pedidos
    (d.orders || []).forEach((o) => {
      if (o.metricasClienteActualizadas === undefined) o.metricasClienteActualizadas = o.estado === "Entregado";
      if (o.pago === "Efectivo") {
        o.pago = o.canal === "Rappi" ? "Rappi (app)" : "Nequi";
        o.comprobante = false;
        if (!o.pagadoEn && !["En ruta","Entregado"].includes(o.estado)) o.estado = "Pendiente de pago";
        o.obs = (o.obs ? o.obs + " · " : "") + "Pago en efectivo eliminado por política MOMOS.";
      }
      if (o.canal === "Rappi") { o.pago = "Rappi (app)"; o.domCobrado = 0; o.domCosto = 0; }
      if (o.creativeId && !o.campaignId) {
        const cr = (d.creatives || []).find((x) => x.id === o.creativeId);
        if (cr && cr.campaignId) o.campaignId = cr.campaignId;
      }
      if (o.origenDetalle === undefined) o.origenDetalle = "";
    });
    // E. limpiar domicilios de Rappi
    (d.deliveries || []).forEach((dl) => {
      const o = (d.orders || []).find((x) => x.id === dl.orderId);
      if ((o && o.canal === "Rappi") || dl.proveedor === "Rappi") {
        dl.proveedor = "Rappi"; dl.costoReal = 0; dl.cobrado = 0;
        dl.obs = dl.obs || "Gestionado por la app de Rappi.";
      }
    });
    // F. limpiar calendario
    (d.content_calendar || []).forEach((p) => {
      if (p.creativeId && !p.campaignId) {
        const cr = (d.creatives || []).find((x) => x.id === p.creativeId);
        if (cr && cr.campaignId) p.campaignId = cr.campaignId;
      }
    });
    // G. limpiar reclamos
    (d.claims || []).forEach((r) => {
      if (!r.fecha) {
        const o = (d.orders || []).find((x) => x.id === r.orderId);
        r.fecha = o ? o.fecha : hoyISO();
      }
      if (r.reclamoEn === undefined) r.reclamoEn = (r.fecha && r.hReclamo && r.hReclamo !== "—") ? (r.fecha + " " + r.hReclamo) : "";
      if (r.entregadoEn === undefined) r.entregadoEn = (r.fecha && r.hEntrega && r.hEntrega !== "—") ? (r.fecha + " " + r.hEntrega) : "";
    });
    d.version = 11;
  }
  if (d.version === 11) {
    // Asegurar que todas las campañas tengan estado válido y montos numéricos
    (d.campaigns || []).forEach((c) => {
      if (!c.estado || !CAMP_ESTADOS.includes(c.estado)) c.estado = "Planeada";
      c.gastoReal = Number(c.gastoReal || 0);
      c.presupuesto = Number(c.presupuesto || 0);
    });
    // Blindaje Rappi en pedidos existentes
    (d.orders || []).forEach((o) => {
      if (o.canal === "Rappi") {
        o.pago = "Rappi (app)";
        o.domCobrado = 0;
        o.domCosto = 0;
      }
      if (o.pago === "Efectivo") {
        o.pago = o.canal === "Rappi" ? "Rappi (app)" : "Nequi";
        o.comprobante = false;
        if (!o.pagadoEn && !["En ruta", "Entregado"].includes(o.estado)) {
          o.estado = "Pendiente de pago";
        }
        o.obs = (o.obs ? o.obs + " · " : "") + "Pago en efectivo eliminado por política MOMOS.";
      }
    });
    // Blindaje Rappi en domicilios existentes
    (d.deliveries || []).forEach((dl) => {
      const o = (d.orders || []).find((x) => x.id === dl.orderId);
      if ((o && o.canal === "Rappi") || dl.proveedor === "Rappi") {
        dl.proveedor = "Rappi";
        dl.costoReal = 0;
        dl.cobrado = 0;
        dl.obs = dl.obs || "Gestionado por la app de Rappi.";
      }
    });
    d.version = 12;
  }
  if (d.version === 12) {
    (d.order_items || []).forEach((i) => {
      if (i.costoUnitario === undefined) {
        const p = (d.products || []).find((x) => x.id === i.productId);
        i.costoUnitario = p ? p.costo : 0;
      }
    });
    d.version = 13;
  }
  if (d.version === 13) {
    // Parche v3.1.1: idempotente. Asegura costoUnitario en items (por si vinieran de un backup viejo)
    (d.order_items || []).forEach((i) => {
      if (i.costoUnitario === undefined) {
        const p = (d.products || []).find((x) => x.id === i.productId);
        i.costoUnitario = p ? p.costo : 0;
      }
    });
    d.version = 14;
  }
  if (d.version === 14) {
    // migración idempotente v3.1.2 (sin cambios de datos; solo sella la versión)
    d.version = 15;
  }
  if (d.version === 15) {
    // migración idempotente v3.1.3 (solo sella la versión)
    d.version = 16;
  }
  if (d.version === 16) {
    // Producto terminado: la vida útil empieza al desmoldar y dura 3 días.
    (d.production_batches || []).forEach((l) => {
      const terminado = l.stockContabilizado || ["Listo", "Reservado", "Vendido", "Imperfecto", "Descartado"].includes(l.estado);
      if (!terminado) {
        l.desmoldadoEn = "";
        l.vence = "";
        return;
      }
      const audit = (d.audit_logs || []).find((a) => a.entidad === "Lote" && a.entidadId === l.id && /desmoldado/i.test(a.accion || ""));
      l.desmoldadoEn = l.desmoldadoEn || (audit && audit.fecha) || `${l.fecha} 00:00:00`;
      l.vence = sumarDiasISO(l.desmoldadoEn, 3);
    });
    d.version = 17;
  }
  if (d.version === 17) {
    d.settings.vidaUtilConfigurable = true;
    d.settings.vidaUtilProductoTerminadoDias = 6;
    d.settings.vidaUtilMezclasDias = 5;
    (d.production_batches || []).forEach((l) => {
      if (l.desmoldadoEn) l.vence = sumarDiasISO(l.desmoldadoEn, 6);
    });
    d.version = 18;
  }
  return d;
}

/* ================================================================
   CAPA DE DATOS — repositorio sobre window.storage
   (misma interfaz que tendría un backend real)
   ================================================================ */

/* Adaptador de almacenamiento: usa window.storage si existe (entorno Claude/artifact),
   y cae a localStorage en un deploy React/Vite normal donde window.storage no está. */
const storage = {
  async get(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.get) return await window.storage.get(key);
    const value = (typeof localStorage !== "undefined") ? localStorage.getItem(key) : null;
    return value ? { value } : null;
  },
  async set(key, value) {
    if (typeof window !== "undefined" && window.storage && window.storage.set) return await window.storage.set(key, value);
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    return true;
  },
  async delete(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.delete) return await window.storage.delete(key);
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    return true;
  },
};

async function dbLoad(storageKey) {
  try {
    if (!storageKey) return null;
    const r = await sessionCacheStorage.get(storageKey);
    if (r && typeof r.value === "string" && r.value.trim().length > 0) {
      const d = JSON.parse(r.value);
      if (!d || typeof d !== "object" || Array.isArray(d) || typeof d.version !== "number") {
        return { _corruptStorage: true };
      }
      if (d.version > DB_VERSION) return { _incompatibleVersion: true, version: d.version };
      if (d.version === DB_VERSION) {
        const before = JSON.stringify(d);
        normalizeDbShape(d);
        if (JSON.stringify(d) !== before) d._migrated = true; // #5: si la normalización cambió el shape, persistir (no dejarlo solo en memoria y decir "guardado")
        return d;
      }
      if (d.version >= 1 && d.version < DB_VERSION) {
        normalizeDbShape(d);        // #15: garantizar settings/counters ANTES de migrar (migrate los asume)
        const m = migrate(d);
        normalizeDbShape(m);
        m._migrated = true;
        return m;
      }
      // versión numérica pero fuera de rango conocido: se trata como corrupto
      return { _corruptStorage: true };
    }
    return null; // lectura OK y sin datos: carga normal de semilla
  } catch (e) {
    // #9: un ERROR de lectura NO es "vacío": nunca devolver null (eso resembraría encima de datos reales)
    console.error("Base local ilegible:", e);
    return { _readError: true };
  }
}

async function dbPersist(db, storageKey) {
  if (!storageKey) return false;
  try { return await sessionCacheStorage.set(storageKey, JSON.stringify(db)); }
  catch (e) { console.error("No se pudo guardar:", e); return false; }
}

async function dbReset(storageKey) {
  try { await sessionCacheStorage.delete(storageKey); } catch (e) {}
}

async function purgeLegacyPersistentCache(userId) {
  const keys = legacyCacheKeys(DB_KEY, userId);
  await Promise.all(keys.map(async (key) => {
    try { await storage.delete(key); } catch (e) { /* best effort */ }
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(key); } catch (e) { /* blocked storage */ }
  }));
}

/* ---- Helpers de dominio (operan sobre una copia mutable de db) ---- */

function nextId(db, key, prefix, pad = 0) {
  db.settings.counters[key] = (db.settings.counters[key] || 0) + 1;
  const n = db.settings.counters[key];
  return prefix + (pad ? String(n).padStart(pad, "0") : n);
}

function addAudit(db, { user, entidad, entidadId, accion, de = "", a = "" }) {
  db.audit_logs.unshift({ id: nextId(db, "audit", "A"), fecha: hoyISO() + " " + ahoraHora(), user, entidad, entidadId, accion, de, a });
}

const itemsOf = (db, orderId) => db.order_items.filter((i) => i.orderId === orderId);
const evidencesOf = (db, orderId) => db.evidences.filter((e) => e.orderId === orderId);
const tieneEvidencia = (db, orderId, tipo) => evidencesOf(db, orderId).some((e) => e.tipo === tipo && (e.storagePath || e.url));
// Labels de foto que faltan (con url) para pasar a `estado`; [] = nada pendiente.
function faltanFotosPaso(db, o, estado) {
  return reqFotosPaso(o, estado)
    .filter((req) => !req.tipos.some((t) => tieneEvidencia(db, o.id, t)))
    .map((req) => req.label);
}
const customerOf = (db, id) => db.customers.find((c) => c.id === id) || {};
const productOf = (db, id) => db.products.find((p) => p.id === id);

// Suma de adiciones/toppings de una línea (precio × cantidad de cada adición)
const lineAdiciones = (i) => (Array.isArray(i.adiciones) ? i.adiciones : []);
const lineAdicionesTotal = (i) => canonicalLineAdditionsTotal(i);
// Suma de toppings de los sub-momos de una línea combo en NuevoPedido (aún no persistidos como hijas; cada slot = 1 momo).
const boxesAdicionesTotal = (l) => (l.boxes || []).reduce((s, box) => s + box.reduce((ss, sl) => ss + lineAdicionesTotal({ adiciones: sl.adiciones, cant: 1 }), 0), 0);
// Congela el costo del insumo de cada adición al crear el pedido: el COGS histórico no se mueve si cambia el
// precio del insumo, y sobrevive aunque el insumo se borre. Fallback al costo en vivo (en el read) para filas viejas.
const snapAdiciones = (d, adiciones) => (Array.isArray(adiciones) ? adiciones : []).map((ad) =>
  ad.insumoId ? { ...ad, insumoCosto: +((d.inventory_items.find((x) => x.id === ad.insumoId) || {}).costo) || 0 } : ad);
const orderSubtotal = (db, o) => calculateOrderMoney(db, o).subtotalBeforeDiscount;
const orderTotal = (db, o) => calculateOrderMoney(db, o).totalCharged;
// Costo de insumo de las adiciones de una línea (solo las que consumen inventario).
// Topping POR MOMO: escala por la cantidad de la línea (i.cant), igual que reserveInventory →
// el COGS refleja el inventario real gastado. (Costo de insumo en vivo; congelarlo queda para Supabase.)
const lineAdicionesCOGS = (db, i) => lineAdiciones(i).reduce((s, ad) => {
  if (!ad.insumoId) return s;
  const ins = db.inventory_items.find((x) => x.id === ad.insumoId);
  if (!ins) return s;
  return s + (+ad.insumoCant || 0) * (+ad.cant || 1) * (+i.cant || 1) * (+ins.costo || 0);
}, 0);
const orderCOGS = (db, o) => itemsOf(db, o.id).reduce((s, i) => {
  const p = productOf(db, i.productId);
  const costo = i.costoUnitario !== undefined ? i.costoUnitario : (p ? p.costo : 0);
  return s + costo * i.cant + lineAdicionesCOGS(db, i);
}, 0);

// Un pedido cuenta como venta SOLO si tiene pago confirmado y no está en estados previos ni cancelado
const esPedidoCobrado = (o) => !!o.pagadoEn && !["Nuevo","Confirmado","Pendiente de pago","Cancelado"].includes(o.estado);

const momoUnitStock = (db) => db.products.filter(isCommercialFamilyProduct).reduce((s, p) => s + (p.stock || 0), 0);

// Sugiere la zona de domicilio a partir del barrio del cliente (busca el barrio en el nombre de la zona)
function sugerirZona(zonas, barrio) {
  if (!barrio) return null;
  const b = barrio.toLowerCase().trim();
  const z = zonas.find((zn) => zn.nombre.toLowerCase().split(/[·\/]/).some((parte) => {
    const p = parte.trim();
    return p && (p.includes(b) || b.includes(p));
  }));
  return z ? z.nombre : null;
}

// Disponibilidad real: unidades con stock, combos por familias comerciales permitidas + cajas.
function comboComponentStock(db, p) {
  const ids = p.componentProductIds || [];
  const comps = db.products.filter((x) => ids.includes(x.id));
  return comps.reduce((s, x) => s + (x.stock || 0), 0);
}

// --- Compatibilidad legado: `especie` ya no decide producto, inventario ni reserva. ---
// Familia comercial exacta de la figura. `figuras.product_id` es la única relación canónica.
function componentProductForFigura(db, combo, figuraNombre) {
  const comps = (db.products || []).filter((p) => (combo.componentProductIds || []).includes(p.id));
  const figure = activeFigureCatalog(db).find((candidate) => candidate.nombre === figuraNombre);
  const exactProductId = figureProductId(figure);
  return exactProductId ? (comps.find((product) => product.id === exactProductId) || null) : null;
}
// Figuras ofrecibles en un combo: únicamente las enlazadas a sus familias comerciales.
function figurasDeCombo(db, combo) {
  return figuresForCommercialProducts(db, combo.componentProductIds || []);
}
// Faltante por FAMILIA COMERCIAL exacta de un combo ya compuesto.
// Necesario porque `availability` mira el POOL combinado, pero reserveInventory descuenta la
// FAMILIA COMERCIAL exacta vinculada a cada figura. Si el usuario concentra una familia agotada,
// el pool "alcanza" pero esa presentación no. Devuelve el faltante por componente.
function comboFaltantesFamilia(db, combo, boxes) {
  const demanda = {};
  (boxes || []).forEach((box) => (box || []).forEach((sl) => {
    if (!sl || !sl.figura) return;
    const comp = componentProductForFigura(db, combo, sl.figura);
    if (comp) demanda[comp.id] = (demanda[comp.id] || 0) + 1;
  }));
  const faltas = [];
  Object.keys(demanda).forEach((pid) => {
    const comp = (db.products || []).find((x) => x.id === pid);
    if (comp && demanda[pid] > (comp.stock || 0)) faltas.push({ nombre: comp.nombre, falta: demanda[pid] - (comp.stock || 0) });
  });
  return faltas;
}

function availability(db, p) {
  if (isCommercialFamilyProduct(p)) return p.stock || 0;
  if (p.tipo === "combo") {
    const momos = comboComponentStock(db, p);
    const emp = db.inventory_items.find((i) => i.id === p.empaqueItem);
    return Math.min(Math.floor(momos / p.comboSize), emp ? Math.floor(emp.stock) : 0);
  }
  return Infinity; // se prepara al momento
}

function addMovement(db, { tipo, item, cant, nota }) {
  db.inventory_movements.unshift({ id: nextId(db, "movement", "M"), fecha: hoyISO() + " " + ahoraHora(), tipo, item, cant, nota });
}

/* ---- Estado de congelación de un lote ---- */
function estadoCongelacion(l) {
  if (!l || l.estado !== "Congelando" || !l.inicioCongelacion) return null;
  const h = horasDesde(l.inicioCongelacion);
  if (h === null) return null;
  const objetivo = l.horasCongelacion || 10;
  const restan = objetivo - h;
  return { horas: h, objetivo, restan, listo: restan <= 0 };
}
const fmtHoras = (h) => { const total = Math.round(Math.max(0, h) * 60); const hh = Math.floor(total / 60); const mm = total % 60; return hh + " h" + (mm ? " " + mm + " min" : ""); };

/* ---- Marketing: atribución y métricas ---- */
const ordersDeCampaign = (db, campId) => db.orders.filter((o) => o.campaignId === campId && esPedidoCobrado(o));
const ordersDeCreative = (db, creaId) => db.orders.filter((o) => o.creativeId === creaId && esPedidoCobrado(o));
const ventasDeCampaign = (db, campId) => ordersDeCampaign(db, campId).reduce((s, o) => s + orderTotal(db, o), 0);
const ventasDeCreative = (db, creaId) => ordersDeCreative(db, creaId).reduce((s, o) => s + orderTotal(db, o), 0);
const claveDimensionResultado = (r) => `${r.fecha}|${r.creativeId ? `creative:${r.creativeId}` : `campaign:${r.campaignId || ""}`}`;
const ordenFuenteResultado = (a, b) => (a.fuente === "manual" ? 1 : 0) - (b.fuente === "manual" ? 1 : 0)
  || String(a.fuente || "").localeCompare(String(b.fuente || "")) || String(a.id).localeCompare(String(b.id));
// Resultados guarda métricas de plataforma por día. Pedidos/ventas salen SIEMPRE
// de orders (misma fecha + creativo/campaña), nunca de campos tipeados a mano.
function atribucionDeResultado(db, r) {
  // Un pedido conoce el creativo/campaña, pero no la fuente de métricas. Si
  // conviven manual + MCP para el mismo día, se atribuye solo a una fila para
  // no duplicar pedidos/ventas en tarjetas, CSV, reportes ni recomendaciones.
  const clave = claveDimensionResultado(r);
  const canonico = (db.creative_results || []).filter((x) => claveDimensionResultado(x) === clave).sort(ordenFuenteResultado)[0];
  if (canonico && canonico.id !== r.id) return { pedidos: 0, ventas: 0, contabilizar: false };
  const pedidos = db.orders.filter((o) => {
    if (!esPedidoCobrado(o) || (r.fecha && o.fecha !== r.fecha)) return false;
    if (r.creativeId) return o.creativeId === r.creativeId;
    if (!r.campaignId || o.campaignId !== r.campaignId) return false;
    // Si el pedido tiene creativo y ese creativo posee métricas ese día, su
    // atribución vive en esa dimensión; la fila de campaña solo cubre el resto.
    return !o.creativeId || !(db.creative_results || []).some((x) => x.fecha === r.fecha && x.creativeId === o.creativeId);
  });
  return { pedidos: pedidos.length, ventas: pedidos.reduce((s, o) => s + orderTotal(db, o), 0), contabilizar: true };
}

// Para analítica, fuentes MCP distintas se suman. La captura manual funciona
// como fallback: si ya existe cualquier fuente automática en esa dimensión/día,
// se omite para no duplicar la misma lectura digitada y sincronizada.
function resultadosDePlataforma(db) {
  const raw = db.creative_results || [];
  const elegibles = raw.filter((r) => r.fuente !== "manual"
    || !raw.some((x) => x.fuente !== "manual" && claveDimensionResultado(x) === claveDimensionResultado(r)));
  const grupos = new Map();
  elegibles.forEach((r) => {
    const clave = claveDimensionResultado(r);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  });
  return [...grupos.values()].map((filas) => {
    const ordenadas = [...filas].sort(ordenFuenteResultado);
    const base = ordenadas[0];
    const suma = (campo) => filas.reduce((s, x) => s + Number(x[campo] || 0), 0);
    return {
      ...base,
      fuente: [...new Set(filas.map((x) => x.fuente || "manual"))].sort().join(" + "),
      impresiones: suma("impresiones"), alcance: suma("alcance"), clicks: suma("clicks"),
      mensajesWhatsApp: suma("mensajesWhatsApp"), gasto: suma("gasto"),
      notas: filas.map((x) => x.notas).filter(Boolean).join(" · "),
    };
  });
}
function campaignMetrics(db, c) {
  const pedidos = ordersDeCampaign(db, c.id).length;
  const ventas = ventasDeCampaign(db, c.id);
  const gasto = Number(c.gastoReal || 0);
  const cac = pedidos > 0 ? gasto / pedidos : null;
  const roas = gasto > 0 ? ventas / gasto : null;
  const ticket = pedidos > 0 ? ventas / pedidos : 0;
  return { pedidos, ventas, cac, roas, ticket };
}

// Stock de la entrada comercial foco de una campaña (por nombre).
function stockProductoFoco(db, nombre) {
  if (!nombre) return null;
  const p = db.products.find((x) => x.nombre === nombre);
  if (!p) return null;
  return availability(db, p);
}

// Reglas simples estilo trafficker: recomendaciones en lenguaje claro.
function trafficRecomendaciones(db) {
  const recs = [];
  (db.campaigns || []).forEach((c) => {
    if (c.estado !== "Activa") return;
    const m = campaignMetrics(db, c);
    const stockFoco = stockProductoFoco(db, c.productoFoco);
    if (c.gastoReal > 60000 && m.pedidos === 0) {
      recs.push({ tipo: "pausar", campaignId: c.id, icon: "⏸️", titulo: c.nombre,
        texto: `Gastó ${fmt(c.gastoReal)} y no ha traído pedidos. Te recomendamos pausarla y probar otro contenido.`,
        accion: "pausar", bg: "#F6D4CD", color: "#A03B2A" });
    } else if (c.productoFoco && stockFoco !== null && stockFoco <= 0) {
      recs.push({ tipo: "sinstock", campaignId: c.id, icon: "📦", titulo: c.nombre,
        texto: `Estás promocionando "${c.productoFoco}", pero esa entrada comercial no tiene stock. Reponé la figura y el sabor exactos —o la preparación al momento— antes de seguir invirtiendo.`,
        bg: "#FBE8C8", color: "#96690F" });
    } else if (m.roas !== null && m.roas >= 2 && (stockFoco === null || stockFoco > 0)) {
      const nuevo = Math.round((c.presupuesto || c.gastoReal) * 1.2);
      recs.push({ tipo: "subir", campaignId: c.id, icon: "🚀", titulo: c.nombre,
        texto: `Está rindiendo muy bien (cada peso invertido volvió multiplicado). Sube el presupuesto ~20% (a ${fmt(nuevo)}) para vender más.`,
        accion: "subir", nuevoPresupuesto: nuevo, bg: "#DDEBD9", color: "#3F6B42" });
    }
  });
  resultadosDePlataforma(db).forEach((r) => {
    const atrib = atribucionDeResultado(db, r);
    if (r.mensajesWhatsApp >= 30 && atrib.pedidos <= 3) {
      const cre = db.creatives.find((x) => x.id === r.creativeId);
      recs.push({ tipo: "copy", icon: "✏️", titulo: cre ? cre.titulo : "Contenido",
        texto: `Recibió muchos mensajes (${r.mensajesWhatsApp}) pero pocos pedidos (${atrib.pedidos}). Revisa el precio, la oferta o el mensaje: la gente pregunta pero no compra.`,
        bg: "#FBE8C8", color: "#96690F" });
    }
  });
  return recs;
}

/* ---- Recetas: consumo de insumos por unidad de producto ---- */
const recipeLines = (db, productId) => (db.recipes || []).filter((r) => r.productId === productId);

function recipeCost(db, productId) {
  return recipeLines(db, productId).reduce((s, l) => {
    const it = db.inventory_items.find((i) => i.id === l.itemId);
    return s + (it ? it.costo * l.cantidad : 0);
  }, 0);
}

// Descuenta la receta de `unidades` del inventario. Devuelve lista de faltantes.
function deductRecipe(db, product, unidades, nota, orderId) {
  const faltantes = [];
  recipeLines(db, product.id).forEach((l) => {
    const it = db.inventory_items.find((i) => i.id === l.itemId);
    if (!it) return;
    const req = +(l.cantidad * unidades).toFixed(3);
    const toma = Math.min(it.stock, req);
    it.stock = +(it.stock - toma).toFixed(3);
    if (toma > 0) {
      addMovement(db, { tipo: "Uso en producción", item: it.nombre, cant: "-" + +toma.toFixed(3) + " " + it.unidad, nota });
      // Registrar el consumo REAL como reserva liberable (solo si hay pedido). Así la
      // cancelación devuelve exactamente lo que se sacó, no la cantidad teórica de la receta.
      if (orderId) addReservation(db, orderId, "insumo", it.id, it.nombre, toma);
    }
    if (toma < req) faltantes.push(`${it.nombre} (faltan ${+(req - toma).toFixed(2)} ${it.unidad})`);
  });
  return faltantes;
}

// Reserva de inventario al marcar Pagado: descuenta stock Y registra cada reserva
// en inventory_reservations para poder liberarla si el pedido se cancela.
function addReservation(db, orderId, tipo, refId, nombre, cantidad) {
  if (cantidad <= 0) return;
  db.inventory_reservations.push({ id: nextId(db, "reservation", "RES-"), orderId, tipo, refId, nombre, cantidad, fecha: hoyISO() + " " + ahoraHora(), estado: "Reservada" });
}

function reserveInventory(db, order, user) {
  const faltantes = [];
  itemsOf(db, order.id).forEach((it) => {
    const p = productOf(db, it.productId);
    if (!p) return;
    if (isCommercialFamilyProduct(p)) {
      const presentation = orderLinePresentation(it, p);
      const toma = Math.min(p.stock, it.cant);
      p.stock -= toma;
      addReservation(db, order.id, "producto", p.id, presentation.primary, toma);
      if (toma < it.cant) faltantes.push({ producto: presentation.primary, cant: it.cant - toma, area: "Producción" });
    } else if (p.tipo === "combo") {
      // Combos reales: si la caja tiene hijas con parentItemId, cada una descuenta la familia
      // comercial exacta asignada por figuras.productId; nunca se decide por especie.
      // Combo legacy de semilla (sin hijas) → pull genérico del pool de componentes (retrocompat).
      const tieneHijas = itemsOf(db, order.id).some((x) => x.parentItemId === it.id);
      if (!tieneHijas) {
        let necesita = p.comboSize * it.cant;
        const ids = p.componentProductIds || [];
        const comps = db.products.filter((x) => ids.includes(x.id));
        comps.forEach((x) => {
          const toma = Math.min(x.stock, necesita);
          x.stock -= toma; necesita -= toma;
          if (toma > 0) addReservation(db, order.id, "producto", x.id, x.nombre + " (para " + p.nombre + ")", toma);
        });
        if (necesita > 0) faltantes.push({ producto: "Momos para " + p.nombre, cant: necesita, area: "Producción" });
      }
      const emp = db.inventory_items.find((i) => i.id === p.empaqueItem);
      if (emp) {
        const tomaEmp = Math.min(emp.stock, it.cant);
        emp.stock = +(emp.stock - tomaEmp).toFixed(2);
        if (tomaEmp > 0) {
          addReservation(db, order.id, "empaque", emp.id, emp.nombre, tomaEmp);
          addMovement(db, { tipo: "Salida", item: emp.nombre, cant: "-" + tomaEmp + " und", nota: "Reserva pedido " + order.id });
        }
        if (tomaEmp < it.cant) faltantes.push({ producto: emp.nombre, cant: it.cant - tomaEmp, area: "Inventario", itemId: emp.id });
      }
      // #4: extras de receta del combo (tarjeta, etc.) se consumen físicamente Y
      // se REGISTRAN como reserva liberable, para que vuelvan al cancelar (igual que
      // momos y caja). Sin esto, un extra descontado al reservar quedaba perdido.
      recipeLines(db, p.id).forEach((l) => {
        const ex = db.inventory_items.find((i) => i.id === l.itemId);
        if (!ex) return;
        const req = +(l.cantidad * it.cant).toFixed(3);
        const toma = Math.min(ex.stock, req);
        ex.stock = +(ex.stock - toma).toFixed(3);
        if (toma > 0) {
          addReservation(db, order.id, "insumo", ex.id, ex.nombre, toma);
          addMovement(db, { tipo: "Salida", item: ex.nombre, cant: "-" + +toma.toFixed(3) + " " + ex.unidad, nota: "Combo " + order.id });
        }
        if (toma < req) faltantes.push({ producto: ex.nombre, cant: +(req - toma).toFixed(2), area: "Inventario", itemId: ex.id });
      });
    }
  });
  // Adiciones/toppings con insumo ligado: descontar y RESERVAR (liberable al cancelar,
  // igual que los extras de receta). Sin insumoId, la adición solo suma al precio.
  itemsOf(db, order.id).forEach((it) => {
    lineAdiciones(it).forEach((ad) => {
      if (!ad.insumoId) return;
      const ins = db.inventory_items.find((i) => i.id === ad.insumoId);
      if (!ins) return;
      // Topping POR MOMO: consume el insumo por cada unidad de la línea (× it.cant).
      const req = +((+ad.insumoCant || 1) * (+ad.cant || 1) * (+it.cant || 1)).toFixed(3);
      const toma = Math.min(ins.stock, req);
      ins.stock = +(ins.stock - toma).toFixed(3);
      if (toma > 0) {
        addReservation(db, order.id, "insumo", ins.id, ins.nombre + " (adición " + ad.nombre + ")", toma);
        addMovement(db, { tipo: "Salida", item: ins.nombre, cant: "-" + +toma.toFixed(3) + " " + ins.unidad, nota: "Adición " + ad.nombre + " · " + order.id });
      }
      if (toma < req) faltantes.push({ producto: ins.nombre + " (adición " + ad.nombre + ")", cant: +(req - toma).toFixed(2), area: "Inventario", itemId: ins.id });
    });
  });
  faltantes.forEach((f) => {
    db.production_suggestions.unshift({ id: nextId(db, "suggestion", "S-", 2), fecha: hoyISO(), producto: f.producto, cantidad: f.cant, motivo: "Stock insuficiente al reservar", orderId: order.id, estado: "Pendiente", area: f.area || "Producción", itemId: f.itemId || "" });
  });
  const prod = faltantes.filter((f) => f.area !== "Inventario");
  const inv = faltantes.filter((f) => f.area === "Inventario");
  if (prod.length) addAudit(db, { user, entidad: "Producción", entidadId: order.id, accion: "Sugerencia de producción creada", a: prod.map((f) => f.cant + "× " + f.producto).join(", ") });
  if (inv.length) addAudit(db, { user, entidad: "Inventario", entidadId: order.id, accion: "Compra sugerida creada", a: inv.map((f) => f.cant + "× " + f.producto).join(", ") });
  return faltantes;
}

// Liberar reservas de un pedido cancelado: devuelve stock y marca las filas como Liberadas
function releaseReservations(db, orderId, user) {
  let liberadas = 0;
  db.inventory_reservations.filter((r) => r.orderId === orderId && r.estado === "Reservada").forEach((r) => {
    if (r.tipo === "producto") {
      const p = db.products.find((x) => x.id === r.refId);
      if (p) p.stock += r.cantidad;
    } else if (r.tipo === "empaque") {
      const it = db.inventory_items.find((x) => x.id === r.refId);
      if (it) {
        it.stock = +(it.stock + r.cantidad).toFixed(2);
        addMovement(db, { tipo: "Entrada", item: it.nombre, cant: "+" + r.cantidad + " und", nota: "Liberación por cancelación de " + orderId });
      }
    } else if (r.tipo === "insumo") {
      // extras de receta (combo) y, a futuro, adiciones/toppings: vuelven al inventario
      const it = db.inventory_items.find((x) => x.id === r.refId);
      if (it) {
        it.stock = +(it.stock + r.cantidad).toFixed(3);
        addMovement(db, { tipo: "Entrada", item: it.nombre, cant: "+" + r.cantidad + " " + it.unidad, nota: "Liberación por cancelación de " + orderId });
      }
    }
    r.estado = "Liberada";
    r.liberadaEn = hoyISO() + " " + ahoraHora();
    liberadas++;
  });
  if (liberadas) addAudit(db, { user, entidad: "Inventario", entidadId: orderId, accion: "Reservas liberadas", a: liberadas + " reserva(s) devueltas al stock" });
  return liberadas;
}

function consumeReservations(db, orderId) {
  db.inventory_reservations.filter((r) => r.orderId === orderId && r.estado === "Reservada").forEach((r) => { r.estado = "Consumida"; });
}

// Al entregar: actualizar métricas y estado del cliente automáticamente
function updateCustomerAfterDelivery(db, order) {
  const c = db.customers.find((x) => x.id === order.customerId);
  if (!c) return;
  c.ultima = hoyISO();
  c.pedidos += 1;
  c.total += orderTotal(db, order);
  const reclamosCliente = db.claims.filter((r) => r.customerId === c.id).length;
  if (reclamosCliente >= 2) c.estado = "Riesgo por reclamos";
  else if (c.pedidos >= 5 || c.total >= 200000) c.estado = "VIP";
  else if (c.pedidos >= 2) c.estado = "Recurrente";
  else c.estado = "Nuevo";
}

function tieneSelloEmpaque(db, orderId) {
  return evidencesOf(db, orderId).some((e) => EV_SELLO.includes(e.tipo));
}

// Transiciones legales de estado (grafo estricto). Bloquea saltos sin sentido; permite
// avances de a un paso y retrocesos razonables. Cancelado y Reclamo son excepciones
// alcanzables desde cualquier estado. La venta rápida (opts.ventaRapida) es el ÚNICO
// camino que puede saltarse pasos hacia Entregado (entrega en mano).
const TRANSICIONES = {
  "Nuevo": ["Confirmado", "Pendiente de pago", "Pagado"],
  "Confirmado": ["Pendiente de pago", "Pagado", "Nuevo"],
  "Pendiente de pago": ["Pagado", "Confirmado"],
  "Pagado": ["En producción", "Pendiente de pago"],
  "En producción": ["Listo para empaque", "Pagado"],
  "Listo para empaque": ["Empacado", "En producción"],
  "Empacado": ["Listo para despacho", "En ruta", "Listo para empaque"],
  "Listo para despacho": ["En ruta", "Empacado"],
  "En ruta": ["Entregado", "Listo para despacho"],
  "Entregado": [],
  "Reclamo": ["Entregado"],
  "Cancelado": [],
};

// Cambio central de estado: validaciones + audit log + efectos secundarios
function setOrderStatus(db, orderId, estado, user, opts = {}) {
  const o = db.orders.find((x) => x.id === orderId);
  if (!o || o.estado === estado) return { ok: true };

  // Grafo estricto de transiciones: rechazar saltos ilegales. Excepciones: Cancelado y
  // Reclamo (desde cualquier estado) y la venta rápida hacia Entregado (entrega en mano).
  const ventaRapida = !!opts.ventaRapida;
  const legal = (TRANSICIONES[o.estado] || []).includes(estado)
    || estado === "Cancelado" || estado === "Reclamo"
    || (ventaRapida && estado === "Entregado");
  if (!legal) {
    return { ok: false, error: `Transición no permitida: de "${o.estado}" no se puede pasar a "${estado}". Avanzá paso a paso, o usá "Entrega inmediata" si es una venta en mano.` };
  }

  // Ningún estado operativo sin pago confirmado
  if (["En producción","Listo para empaque","Empacado","Listo para despacho","En ruta","Entregado"].includes(estado) && !o.pagadoEn) {
    return { ok: false, error: "MOMOS no produce ni despacha pedidos sin pago confirmado." };
  }

  // Evidencias guiadas por paso: Empacado exige caja abierta + sello (foto con tipo fijo, no dropdown)
  if (estado === "Empacado") {
    const faltan = faltanFotosPaso(db, o, "Empacado");
    if (faltan.length) return { ok: false, error: `El pedido ${orderId} no puede pasar a "Empacado": falta la foto de ${faltan.join(" y ")}.` };
  }

  // Validaciones para despachar: sello + pago + domicilio asignado + costo real (salvo Rappi)
  if (estado === "En ruta") {
    const fallas = [];
    if (!tieneSelloEmpaque(db, orderId)) fallas.push("falta foto de caja cerrada con sello o bolsa sellada");
    if (!o.pagadoEn) fallas.push("el pedido no tiene pago confirmado");
    const dom = db.deliveries.find((x) => x.orderId === orderId && x.estado !== "Cancelado");
    if (!dom) fallas.push("no tiene domicilio asignado (solicítalo en Domicilios)");
    if (o.canal !== "Rappi") {
      const costo = (dom && dom.costoReal > 0) || o.domCosto > 0;
      if (!costo) fallas.push("falta registrar el costo real del domicilio");
    }
    if (fallas.length) return { ok: false, error: `El pedido ${orderId} no puede pasar a "En ruta": ${fallas.join("; ")}.` };
  }

  // Validaciones para marcar Entregado: pagado + sello (salvo Rappi con evidencia de app) + foto de entrega
  if (estado === "Entregado") {
    const fallas = [];
    if (!o.pagadoEn) fallas.push("el pedido no tiene pago confirmado");
    if (o.canal === "Rappi") {
      const tieneApp = evidencesOf(db, orderId).some((e) => e.tipo === "Comprobante de pago" || e.tipo === "Bolsa sellada");
      if (!tieneApp) fallas.push("falta evidencia de la app o de empaque");
    } else if (!ventaRapida && !tieneSelloEmpaque(db, orderId)) {
      fallas.push("falta foto de caja cerrada con sello o bolsa sellada");
    }
    if (!tieneEvidencia(db, orderId, "Entrega")) fallas.push("falta la foto de entrega");
    if (fallas.length) return { ok: false, error: `El pedido ${orderId} no puede marcarse "Entregado": ${fallas.join("; ")}.` };
  }

  // Validaciones para confirmar Pagado: comprobante digital (salvo Rappi, que se paga en su app)
  if (estado === "Pagado") {
    if (o.pago === "Efectivo") return { ok: false, error: `El pedido ${orderId} no puede marcarse "Pagado": MOMOS no acepta efectivo. Cambia la forma de pago a una digital.` };
    if (o.canal !== "Rappi" && o.pago === "Rappi (app)") return { ok: false, error: `El pedido ${orderId} no es de Rappi, así que no puede pagarse con "Rappi (app)". Elige Nequi, Daviplata o Bancolombia.` };
    if (o.canal === "Rappi") {
      if (o.pago !== "Rappi (app)") return { ok: false, error: `El pedido ${orderId} es de Rappi: el pago debe ser "Rappi (app)".` };
    } else {
      const tieneComprobante = evidencesOf(db, orderId).some((e) => e.tipo === "Comprobante de pago" && (e.storagePath || e.url));
      if (!tieneComprobante) return { ok: false, error: `El pedido ${orderId} no puede marcarse "Pagado" sin subir la foto del comprobante de pago. MOMOS no acepta efectivo ni despacha sin pago confirmado.` };
    }
  }

  const prev = o.estado;
  o.estado = estado;
  addAudit(db, { user, entidad: "Pedido", entidadId: o.id, accion: "Cambio de estado", de: prev, a: estado });

  let faltantes = [];
  let faltInsumos = [];

  if (estado === "Pagado") {
    o.comprobante = true;
    o.pagadoEn = hoyISO() + " " + ahoraHora();
    if (!o.inventarioReservado) { faltantes = reserveInventory(db, o, user); o.inventarioReservado = true; }
    // beneficio Reservado → Usado al confirmar el pago
    if (o.benefitId) {
      const b = db.benefits.find((x) => x.id === o.benefitId);
      if (b && b.estado === "Reservado") {
        b.estado = "Usado";
        addAudit(db, { user, entidad: "Beneficio", entidadId: b.id, accion: "Beneficio usado", a: "Pedido " + o.id });
      }
    }
  }

  // #7: reservar inventario UNA sola vez si el pedido entra a producción/despacho con pago pero sin reserva previa
  // (cubre pedidos que obtuvieron pagadoEn sin pasar por el handler de "Pagado": semilla, migración, retroceso de estado)
  if (["En producción","Listo para empaque","Empacado","Listo para despacho","En ruta","Entregado"].includes(estado) && o.pagadoEn && !o.inventarioReservado) {
    faltantes = reserveInventory(db, o, user);
    o.inventarioReservado = true;
  }

  if (estado === "En producción" && !o.insumosDescontados) {
    itemsOf(db, o.id).forEach((it) => {
      const p = productOf(db, it.productId);
      if (p && p.tipo === "pedido") faltInsumos.push(...deductRecipe(db, p, it.cant, "Pedido " + o.id, o.id));
    });
    o.insumosDescontados = true;
    if (faltInsumos.length) addAudit(db, { user, entidad: "Inventario", entidadId: o.id, accion: "Insumos insuficientes al producir", a: faltInsumos.join(", ") });
  }

  // #4 Red de seguridad de receta: si el pedido llega a "En ruta"/"Entregado" sin haber pasado
  // por "En producción" (venta rápida o un salto), descontar la receta ACÁ para no dejar insumos
  // sin descontar. Con orderId → queda como reserva liberable (reversible al cancelar, fix #1).
  if (["En ruta","Entregado"].includes(estado) && !o.insumosDescontados) {
    itemsOf(db, o.id).forEach((it) => {
      const p = productOf(db, it.productId);
      if (p && p.tipo === "pedido") faltInsumos.push(...deductRecipe(db, p, it.cant, "Pedido " + o.id + " (entrega directa)", o.id));
    });
    o.insumosDescontados = true;
    if (faltInsumos.length) addAudit(db, { user, entidad: "Inventario", entidadId: o.id, accion: "Insumos descontados en entrega directa", a: faltInsumos.join(", ") });
  }

  if (estado === "Cancelado") {
    // liberar reservas de inventario (si aún no se despachó)
    if (!["En ruta","Entregado"].includes(prev)) releaseReservations(db, o.id, user);
    // #3 (fix stock fantasma): los insumos de receta consumidos en "En producción" ahora se
    // registran como reserva tipo:"insumo" (el TOMA REAL) dentro de deductRecipe, así
    // releaseReservations (arriba) ya devolvió EXACTAMENTE lo consumido. Antes acá se
    // recalculaba dev = l.cantidad * it.cant (la receta teórica), inyectando stock que
    // nunca existió cuando el insumo no alcanzaba al producir. Solo reseteamos el flag.
    if (o.insumosDescontados && !["En ruta","Entregado"].includes(prev)) {
      o.insumosDescontados = false;
    }
    // #17: si se cancela un pedido YA entregado, revertir las métricas del cliente (no dejar ventas fantasma)
    if (prev === "Entregado" && o.metricasClienteActualizadas) {
      const c = db.customers.find((x) => x.id === o.customerId);
      if (c) { c.pedidos = Math.max(0, c.pedidos - 1); c.total = Math.max(0, c.total - orderTotal(db, o)); }
      o.metricasClienteActualizadas = false;
    }
    // beneficio: si se cancela antes de En producción, devolverlo a Activo aunque ya estuviera Usado por el pago
    if (o.benefitId) {
      const b = db.benefits.find((x) => x.id === o.benefitId);
      const antesDeProduccion = !["En producción","Listo para empaque","Empacado","Listo para despacho","En ruta","Entregado"].includes(prev);
      if (b && (b.estado === "Reservado" || (b.estado === "Usado" && antesDeProduccion))) {
        const antes = b.estado;
        b.estado = "Activo"; b.pedidoUso = "";
        addAudit(db, { user, entidad: "Beneficio", entidadId: b.id, accion: "Beneficio devuelto al cliente", de: antes, a: "Activo" });
      }
    }
    const dom = db.deliveries.find((x) => x.orderId === o.id && !["Entregado","Cancelado"].includes(x.estado));
    if (dom) dom.estado = "Cancelado";
  }

  if (estado === "En ruta") {
    // 3. sincronizar el domicilio asociado
    const dom = db.deliveries.find((x) => x.orderId === o.id && !["Entregado","Cancelado"].includes(x.estado));
    if (dom && dom.estado !== "En ruta") { dom.estado = "En ruta"; if (!dom.hSalida) dom.hSalida = ahoraHora(); }
  }

  if (estado === "Entregado") {
    consumeReservations(db, o.id);
    if (o.metricasClienteActualizadas !== true) {
      updateCustomerAfterDelivery(db, o);
      o.metricasClienteActualizadas = true;
    }
    const d = db.deliveries.find((x) => x.orderId === o.id && !["Entregado","Cancelado"].includes(x.estado));
    if (d) { d.estado = "Entregado"; d.hEntrega = ahoraHora(); }
  }

  // #14: si el pedido RETROCEDE desde "En ruta" a un estado previo, el domicilio no debe quedar pegado en ruta
  if (prev === "En ruta" && !["En ruta","Entregado","Cancelado"].includes(estado)) {
    const dom = db.deliveries.find((x) => x.orderId === o.id && x.estado === "En ruta");
    if (dom) { dom.estado = "Asignado"; dom.hSalida = ""; }
  }

  return { ok: true, faltantes, faltInsumos };
}

/* ---------------- Exportación CSV ---------------- */

function copiarTexto(texto) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto); return true; }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    return true;
  } catch (e) { return false; }
}

function downloadCSV(nombre, headers, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre + "-" + hoyISO() + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- Compresión de imágenes de evidencia ---------------- */

function compressImage(file, maxW = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ================= UI compartida ================= */

function Badge({ label, map }) {
  const s = (map || STATE_STYLE)[label] || { bg: "#EBE6E0", fg: "#7A6E63" };
  return <span style={{ background: s.bg, color: s.fg }} className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors">{label}</span>;
}

function Card({ children, className = "", onClick, style, ...props }) {
  function keyDown(e) {
    if (!onClick || !["Enter", " "].includes(e.key)) return;
    e.preventDefault();
    vibrar("tap");
    onClick(e);
  }
  return (
    <div {...props} onClick={onClick} onKeyDown={keyDown} role={onClick ? "button" : props.role} tabIndex={onClick ? 0 : props.tabIndex}
      style={{ background: T.surface, borderColor: T.border, ...style }}
      className={`rounded-2xl border shadow-sm ${onClick ? "momo-card-action" : ""} ${className}`}>
      {children}
    </div>
  );
}

function CountUp({ value, format }) {
  const target = Number(value) || 0;
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduce ? target : 0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(target); return; }
    const t0 = performance.now();
    const dur = 640;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setShown(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    setShown(0);
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const n = Math.round(shown);
  return <>{format ? format(n) : n}</>;
}

function Stat({ icon, label, value, sub, tone, onClick, active }) {
  return (
    <Card className="p-4 flex flex-col gap-1 min-w-0 transition" onClick={onClick}
      aria-pressed={active === undefined ? undefined : !!active}
      style={active ? { borderColor: tone || T.coral, background: "#FFFBF7", boxShadow: `0 0 0 2px ${tone || T.coral}33, 0 10px 22px rgba(84,56,43,.08)` } : undefined}>
      <div className="flex items-center gap-2 text-xs font-bold" style={{ color: T.choco2 }}>
        <span aria-hidden="true">{icon}</span><span className="truncate">{label}</span>
      </div>
      <div className="display text-2xl font-semibold" style={{ color: tone || T.choco, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: T.choco2 }}>{sub}</div>}
    </Card>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3 mt-6 first:mt-0">
      <h2 className="display text-lg font-semibold m-0">{children}</h2>
      {action}
    </div>
  );
}

function WorkScopeTabs({ value, onChange, activeCount, historyCount, activeLabel = "En curso", secondaryLabel = "Historial", activeIcon = "●", secondaryIcon = "◷", ariaLabel = "Vista de trabajo e historial" }) {
  const options = [
    { id: "active", label: activeLabel, count: activeCount, icon: activeIcon },
    { id: "history", label: secondaryLabel, count: historyCount, icon: secondaryIcon },
  ];
  return (
    <div className="inline-flex rounded-2xl border p-1" style={{ borderColor: T.border, background: T.vainilla }} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button key={option.id} type="button" role="tab" aria-selected={selected} onClick={() => onChange(option.id)}
            className="rounded-xl px-3 py-2 text-xs font-extrabold transition flex items-center gap-2"
            style={{ background: selected ? T.surface : "transparent", color: selected ? T.choco : T.choco2, boxShadow: selected ? "0 3px 10px rgba(84,56,43,.10)" : "none" }}>
            <span aria-hidden="true" style={{ color: selected ? T.coral : T.choco2 }}>{option.icon}</span>
            <span>{option.label}</span>
            <span className="min-w-5 h-5 px-1 rounded-full inline-flex items-center justify-center text-[10px]" style={{ background: selected ? T.coralSoft : "rgba(255,255,255,.72)", color: selected ? "#A94D34" : T.choco2 }}>{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function textoOperacion(children) {
  if (typeof children !== "string") return "Procesando…";
  const t = children.trim().toLowerCase();
  if (t.includes("foto") || t.includes("evidencia")) return "Procesando foto…";
  if (t.startsWith("crear")) return "Creando…";
  if (t.startsWith("guardar")) return "Guardando…";
  if (t.startsWith("registr")) return "Registrando…";
  if (t.startsWith("actualiz")) return "Actualizando…";
  if (t.startsWith("marcar pagado")) return "Confirmando pago…";
  if (t.startsWith("marcar")) return "Confirmando…";
  if (t.startsWith("pasar a")) return "Cambiando estado…";
  if (t.includes("congelamiento")) return "Iniciando frío…";
  if (t.includes("entrega")) return "Confirmando entrega…";
  if (t.includes("convertir")) return "Convirtiendo…";
  if (t.includes("pausar")) return "Pausando…";
  if (t.includes("programar")) return "Programando…";
  return "Procesando…";
}

function Btn({ children, onClick, kind = "primary", small, disabled, type = "button", managed = false, busy = false, busyText, confirming = false }) {
  const [autoBusy, setAutoBusy] = useState(false);
  const vivoRef = useRef(true);
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);
  const styles = {
    primary: { background: T.coral, color: "#fff", border: "1px solid " + T.coral },
    soft: { background: T.coralSoft, color: "#A34A2A", border: "1px solid #F3CDBE" },
    ghost: { background: "transparent", color: T.choco, border: "1px solid " + T.border },
    rosa: { background: T.rosa, color: "#8E4B5A", border: "1px solid #E9BFC7" },
    danger: { background: "#F6D4CD", color: "#A03B2A", border: "1px solid #ECBBB1" },
  }[kind];
  const enVuelo = busy || autoBusy;
  const bloqueado = disabled || enVuelo;
  function click(e) {
    if (!onClick || bloqueado) return;
    let result;
    try { result = onClick(e); }
    catch (err) { toast("error", err?.message || "No se pudo completar la acción"); return; }
    if (!managed && result && typeof result.then === "function") {
      setAutoBusy(true);
      Promise.resolve(result)
        .catch((err) => toast("error", err?.message || "No se pudo completar la acción"))
        .finally(() => { if (vivoRef.current) setAutoBusy(false); });
    }
  }
  return (
    <button type={type} onClick={click} disabled={bloqueado} aria-busy={enVuelo || undefined} data-confirming={confirming || undefined}
      style={{ ...styles, opacity: bloqueado ? 0.62 : 1 }}
      className={`momo-btn rounded-xl font-bold ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}>
      {autoBusy
        ? <span className="inline-flex items-center gap-1.5" aria-live="polite"><span className="momo-busy-spinner inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />{busyText || textoOperacion(children)}</span>
        : children}
    </button>
  );
}

/* ── Juice v1: feedback táctil de acciones (spec engram momos/juice-v1-spec) ── */
// Vibración háptica: solo Android/Chrome — iOS Safari no soporta la Vibration API,
// ahí el juice queda visual (degradación silenciosa, jamás rompe).
function vibrar(tipo) {
  try {
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(tipo === "ok" ? [30, 60, 30] : tipo === "alert" ? [45, 70, 45] : tipo === "error" ? 120 : 30);
  } catch { /* nunca romper por vibrar */ }
}

// Bus a nivel módulo: toast() se puede llamar desde cualquier componente sin
// enhebrar props por el monolito; <Toasts/> (montado una vez en el shell) se registra.
let _pushToast = null;
function toast(tipo, texto) {
  vibrar(tipo);
  if (_pushToast) _pushToast({ tipo, texto });
}

function Toasts() {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  useEffect(() => {
    _pushToast = (t) => {
      const id = ++idRef.current;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tipo === "error" || t.tipo === "alert" ? 6000 : 3500);
    };
    return () => { _pushToast = null; };
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-[60] flex flex-col gap-2 items-center w-[calc(100%-2rem)] max-w-md pointer-events-none" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className="momo-toast w-full rounded-2xl px-4 py-3 border flex items-center gap-3" role={t.tipo === "error" ? "alert" : "status"}
          style={{ "--toast-life": t.tipo === "error" || t.tipo === "alert" ? "6000ms" : "3500ms", ...(t.tipo === "error"
            ? { background: "#F6D4CD", color: "#A03B2A", borderColor: "#ECBBB1" }
            : t.tipo === "alert"
              ? { background: "#FFF4E0", color: "#7A5410", borderColor: "#E7C078" }
            : { background: "#E3EFE0", color: "#3F6B42", borderColor: "#BFD8BE" }) }}>
          <span className="momo-toast-icon w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base font-black"
            style={{ background: t.tipo === "error" ? "#fff7f5" : "#fff" }} aria-hidden="true">{t.tipo === "error" ? "!" : t.tipo === "alert" ? "🔔" : "✓"}</span>
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-[.12em] font-extrabold opacity-70">{t.tipo === "error" ? "Revisá esto" : t.tipo === "alert" ? "Aviso de cocina" : "Acción completada"}</span>
            <span className="block text-sm font-bold leading-snug">{t.texto}</span>
          </span>
          <span className="momo-toast-progress" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

// Botón que escribe: estado en vuelo (spinner + disabled) + vibración al tocar.
// `confirmar` (irreversibles): primer toque arma la confirmación 4 s, segundo ejecuta.
// El guard real es el ref (el estado es solo feedback visual) — patrón de la casa.
function BtnAsync({ children, onClick, kind, small, disabled, confirmar, textoEnVuelo = "Guardando…" }) {
  const [enVuelo, setEnVuelo] = useState(false);
  const [pideConfirmar, setPideConfirmar] = useState(false);
  const vueloRef = useRef(false);
  const vivoRef = useRef(true);
  // vivo se re-arma en el CUERPO del efecto: bajo StrictMode el ciclo
  // mount→cleanup→remount reusa el ref y un cleanup solo lo dejaría en false.
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);
  useEffect(() => {
    if (!pideConfirmar) return;
    const t = setTimeout(() => { if (vivoRef.current) setPideConfirmar(false); }, 4000);
    return () => clearTimeout(t);
  }, [pideConfirmar]);
  async function click() {
    if (vueloRef.current) return;
    if (confirmar && !pideConfirmar) { vibrar("tap"); setPideConfirmar(true); return; }
    setPideConfirmar(false);
    vibrar("tap");
    vueloRef.current = true;
    setEnVuelo(true);
    try {
      await onClick();
    } catch (err) {
      toast("error", err?.message || "No se pudo completar la acción");
    } finally {
      vueloRef.current = false;
      if (vivoRef.current) setEnVuelo(false);
    }
  }
  return (
    <Btn managed busy={enVuelo} confirming={pideConfirmar} kind={pideConfirmar ? "danger" : kind} small={small} disabled={disabled} onClick={click}>
      {enVuelo
        ? <span className="inline-flex items-center gap-1.5" aria-live="polite"><span className="momo-busy-spinner inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />{textoEnVuelo}</span>
        : pideConfirmar ? (typeof confirmar === "string" ? confirmar : "¿Seguro? Tocá de nuevo") : children}
    </Btn>
  );
}

const modalStack = [];

function Modal({ title, onClose, children, wide, extraWide = false, topLayer = false }) {
  const modalIdRef = useRef(Symbol("momo-modal"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    function cerrarConEscape(e) {
      if (e.key === "Escape" && modalStack[modalStack.length - 1] === modalId) onCloseRef.current();
    }
    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      window.removeEventListener("keydown", cerrarConEscape);
      const index = modalStack.lastIndexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);
  return (
    <div className={`fixed inset-0 ${topLayer ? "z-[70]" : "z-50"} flex items-end sm:items-center justify-center p-0 sm:p-6`} role="dialog" aria-modal="true">
      <div className="momo-modal-backdrop absolute inset-0" style={{ background: "rgba(60,40,30,.45)" }} onClick={onClose} />
      <div style={{ background: T.bg }} className={`momo-modal-sheet relative w-full ${extraWide ? "sm:max-w-6xl" : wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b" style={{ background: T.bg, borderColor: T.border }}>
          <h3 className="display text-lg font-semibold m-0">{title}</h3>
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Cerrar" className="momo-btn w-9 h-9 rounded-full font-bold" style={{ background: T.surface, border: "1px solid " + T.border, color: T.choco }}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function GlobalKitchenOrderAlerts({ db, perfil, activeView, serverDataReady, onOpenProduction, onOpenPacking }) {
  const operationalRoles = normalizeRoles(perfil);
  const operationalRolesKey = operationalRoles.join("|");
  const canSeeKitchenCommands = hasAnyRole(operationalRoles, ["Administrador", "Cocina"]);
  const canSeePackingCommands = hasAnyRole(operationalRoles, ["Administrador", "Empaque"]);
  const orderAlertsEnabled = canReceiveKitchenOrderAlerts(operationalRoles);
  // Recepción necesita una superficie continua para tomar y cobrar pedidos.
  // Las demoras pertenecen a supervisión, Producción y Empaque; no interrumpen
  // la vista Pedidos. Los eventos propios del pedido siguen funcionando.
  const delayAlertsEnabled = activeView !== "Pedidos" && canReceiveKitchenDelayReminders(operationalRoles);
  const incidentAlertsEnabled = Boolean(db?.operationalControlReady);
  const enabled = orderAlertsEnabled || delayAlertsEnabled || incidentAlertsEnabled;
  const [dialogMode, setDialogMode] = useState(null);
  const [incomingAlerts, setIncomingAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [delayClock, setDelayClock] = useState(() => Date.now());
  const knownOrderStatesRef = useRef(new Map());
  const alertsReadyRef = useRef(false);
  const delayReminderKeysRef = useRef(new Set());

  const catalogs = useMemo(() => ({
    customers: db?.customers || [],
    products: db?.products || [],
    orders: db?.orders || [],
    orderItems: db?.order_items || [],
    auditLogs: db?.audit_logs || [],
  }), [db?.customers, db?.products, db?.orders, db?.order_items, db?.audit_logs]);
  const delayTiming = useMemo(() => normalizeKitchenDelaySettings(db?.settings), [db?.settings]);
  const readyCommands = useMemo(() => canSeeKitchenCommands ? kitchenReadyOrderCommands(catalogs) : [], [canSeeKitchenCommands, catalogs]);
  const packingCommands = useMemo(() => canSeePackingCommands ? (db?.orders || [])
    .filter((order) => order?.id && order.estado === "Listo para empaque")
    .map((order) => ({ ...kitchenOrderAlert(order, catalogs, { eventType: "ready_for_packing" }), date: order.fecha || "", time: order.hora || "" })) : [], [canSeePackingCommands, catalogs, db?.orders]);
  const operationalCommands = useMemo(() => [...readyCommands, ...packingCommands], [readyCommands, packingCommands]);
  const delayReminders = useMemo(() => delayAlertsEnabled ? kitchenDelayedOrderReminders(catalogs, delayClock, delayTiming) : [], [delayAlertsEnabled, catalogs, delayClock, delayTiming]);
  const operationalIncidents = useMemo(() => incidentAlertsEnabled ? (db?.order_incidents || []).filter((incident) => {
    if (incident.status !== "Abierto") return false;
    if (hasAnyRole(operationalRoles, ["Administrador", "Coordinador de pedidos"])) return true;
    if (incident.area === "Recepción") return hasRole(operationalRoles, "Cajero");
    return canOperateStage(operationalRoles, incident.area);
  }) : [], [incidentAlertsEnabled, db?.order_incidents, operationalRolesKey]);

  useEffect(() => {
    if (activeView !== "Pedidos" || dialogMode !== "delays") return;
    setDialogMode(null);
    setUnreadCount(0);
  }, [activeView, dialogMode]);

  useEffect(() => {
    const orders = db?.orders || [];
    if (!orderAlertsEnabled || !serverDataReady || !alertsReadyRef.current) {
      knownOrderStatesRef.current = new Map(orders.filter((order) => order?.id).map((order) => [order.id, order.estado || ""]));
      alertsReadyRef.current = Boolean(orderAlertsEnabled && serverDataReady);
      return;
    }

    const detected = kitchenOrderStateEvents(orders, knownOrderStatesRef.current);
    knownOrderStatesRef.current = detected.nextStates;
    const alerts = detected.events.slice().reverse().filter(({ type }) => type === "ready_for_packing"
      ? canSeePackingCommands
      : canSeeKitchenCommands).map(({ order, type }) => {
      const alert = kitchenOrderAlert(order, catalogs, { eventType: type });
      return alert ? {
        ...alert,
        detectedAt: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
      } : null;
    }).filter(Boolean);
    if (!alerts.length) return;

    setIncomingAlerts((current) => [...current, ...alerts]);
    setUnreadCount((current) => current + alerts.length);
    setDialogMode("events");
    const actionable = alerts.filter((alert) => alert.canPrepare || alert.canPack).length;
    toast("alert", alerts.length === 1
      ? alerts[0].canPack ? `Pedido ${alerts[0].orderId} · listo para Empaque` : actionable ? `Pedido ${alerts[0].orderId} pagado · listo para cocina` : `Entró el pedido ${alerts[0].orderId} · revisá la comanda`
      : `Entraron ${alerts.length} avisos operativos · ${actionable} requieren acción`);
  }, [orderAlertsEnabled, canSeeKitchenCommands, canSeePackingCommands, serverDataReady, db?.orders, db?.order_items, db?.customers, db?.products]);

  useEffect(() => {
    if (!delayAlertsEnabled || !serverDataReady) return undefined;
    const timer = setInterval(() => setDelayClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [delayAlertsEnabled, serverDataReady]);

  useEffect(() => {
    if (!delayAlertsEnabled || !serverDataReady || !delayReminders.length) return;
    const fresh = delayReminders.filter((reminder) => {
      const key = `${reminder.orderId}:${reminder.state}:${reminder.since}:${reminder.thresholdMinutes}:${reminder.urgentMinutes}:${reminder.repeatMinutes}:${reminder.repeatBucket}`;
      if (delayReminderKeysRef.current.has(key)) return false;
      delayReminderKeysRef.current.add(key);
      return true;
    });
    if (!fresh.length) return;
    setUnreadCount((current) => current + fresh.length);
    setDialogMode("delays");
    const urgent = fresh.filter((reminder) => reminder.urgent);
    const lead = urgent[0] || fresh[0];
    toast(urgent.length ? "error" : "alert", fresh.length === 1
      ? `${lead.orderId} lleva ${lead.elapsedMinutes} min en ${lead.area} · revisalo ahora`
      : `${fresh.length} pedidos demorados · ${urgent.length} urgentes`);
  }, [delayAlertsEnabled, serverDataReady, delayReminders]);

  if (!enabled) return null;

  function closeDialog() {
    setDialogMode(null);
    if (dialogMode === "events") setIncomingAlerts([]);
    setUnreadCount(0);
  }

  function openAlertCenter() {
    setDialogMode(operationalIncidents.length ? "incidents" : delayReminders.length ? "delays" : incomingAlerts.length ? "events" : "commands");
    setUnreadCount(0);
  }

  function goToProduction() {
    closeDialog();
    onOpenProduction?.();
  }

  function goToPacking() {
    closeDialog();
    onOpenPacking?.();
  }

  const showsEvents = dialogMode === "events";
  const showsDelays = dialogMode === "delays";
  const showsIncidents = dialogMode === "incidents";
  const urgentDelayCount = delayReminders.filter((reminder) => reminder.urgent).length;
  const delayedKitchenCount = delayReminders.filter((reminder) => reminder.area === "Cocina").length;
  const delayedPackingCount = delayReminders.filter((reminder) => reminder.area === "Empaque").length;
  const visibleCount = unreadCount || operationalCommands.length + delayReminders.length + operationalIncidents.length;
  const buttonTone = operationalIncidents.length || urgentDelayCount
    ? { background: "#A03B2A", borderColor: "#A03B2A", color: "#fff" }
    : delayReminders.length
      ? { background: "#96690F", borderColor: "#96690F", color: "#fff" }
      : operationalCommands.length || unreadCount
        ? { background: T.coral, borderColor: T.coral, color: "#fff" }
        : { background: "#fff", borderColor: T.border, color: T.choco };
  return (
    <>
      <button type="button" onClick={openAlertCenter}
        className="momo-btn momo-kitchen-alert-fab rounded-2xl px-3 py-2.5 border flex items-center gap-2 shadow-lg"
        aria-label={`Abrir seguimiento operativo. ${operationalCommands.length} ${operationalCommands.length === 1 ? "comanda" : "comandas"} requieren acción, ${delayReminders.length} ${delayReminders.length === 1 ? "pedido demorado" : "pedidos demorados"} y ${operationalIncidents.length} ${operationalIncidents.length === 1 ? "novedad abierta" : "novedades abiertas"}${unreadCount ? `; ${unreadCount} ${unreadCount === 1 ? "aviso nuevo" : "avisos nuevos"}` : ""}`}
        style={buttonTone}>
        <span className="text-xl" aria-hidden="true">🔔</span>
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-[9px] uppercase tracking-[.12em] font-extrabold opacity-75">Seguimiento operativo</span>
          <span className="block text-xs font-extrabold">{operationalIncidents.length ? `${operationalIncidents.length} novedad${operationalIncidents.length === 1 ? "" : "es"}` : urgentDelayCount ? `${urgentDelayCount} urgente${urgentDelayCount === 1 ? "" : "s"}` : delayReminders.length ? `${delayReminders.length} con demora` : operationalCommands.length ? `${operationalCommands.length} por atender` : "Todo al día"}</span>
        </span>
        <span className="min-w-7 h-7 px-2 rounded-full flex items-center justify-center text-xs font-black"
          style={{ background: visibleCount ? "#fff" : T.vainilla, color: urgentDelayCount ? "#A03B2A" : delayReminders.length ? "#96690F" : visibleCount ? T.coral : T.choco2 }}>
          {visibleCount}
        </span>
      </button>

      {dialogMode && (
        <Modal title={showsIncidents ? "⚠️ Novedades que bloquean pedidos" : showsDelays ? "⏱️ Pedidos demorados" : showsEvents ? "🔔 Nuevo aviso operativo" : "🧾 Comandas por atender"} wide topLayer onClose={closeDialog}>
          <div className="rounded-xl p-3 mb-4 border" role="status" aria-live="assertive"
            style={{ background: T.soft, borderColor: T.border, color: T.choco }}>
            <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.choco2 }}>{showsIncidents ? "Centro de excepciones" : showsDelays ? "Seguimiento vivo de la operación" : "Relevo entre áreas"}</div>
            <div className="font-bold mt-0.5">{showsIncidents ? "Estas novedades detienen el avance hasta que el área responsable las resuelva." : showsDelays ? "MOMO OPS recuerda las órdenes que no han avanzado a tiempo." : "MOMO OPS conecta Caja, Cocina y Empaque sin perder la comanda."}</div>
            <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{showsDelays
              ? `Cocina cuenta desde el pago confirmado: avisa a los ${delayTiming.demoraCocinaMin} min y es urgente a los ${delayTiming.demoraCocinaUrgenteMin}; Empaque avisa desde ${delayTiming.demoraEmpaqueMin} min y es urgente desde ${delayTiming.demoraEmpaqueUrgenteMin}. Repite cada ${delayTiming.demoraRepeticionMin} min.`
              : "El aviso no depende de Momobot: Cocina recibe pagos confirmados y Empaque recibe pedidos terminados por Cocina."}</div>
            {showsDelays && <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>Cocina · {delayedKitchenCount}</span>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: "#E8E0F2", color: "#63518A" }}>Empaque · {delayedPackingCount}</span>
              {urgentDelayCount > 0 && <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Urgentes · {urgentDelayCount}</span>}
            </div>}
          </div>

          {showsIncidents ? (
            <div className="space-y-3">
              {operationalIncidents.map((incident) => (
                <Card key={incident.id} className="p-4" style={{ borderColor: "#E3A292" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#A03B2A" }}>{incident.area} · {incident.type}</div><div className="display text-lg font-semibold">Pedido {incident.orderId}</div></div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: "#F8D6CF", color: "#A03B2A" }}>Bloqueado</span>
                  </div>
                  <div className="text-sm font-semibold mt-2">{incident.description}</div>
                  <div className="text-[10px] font-bold mt-1" style={{ color: T.choco2 }}>{incident.createdByName || "Equipo"} · {incident.createdAt}</div>
                  {incident.area === "Cocina" && <div className="mt-3"><Btn small onClick={goToProduction}>Abrir Producción</Btn></div>}
                  {incident.area === "Empaque" && <div className="mt-3"><Btn small onClick={goToPacking}>Abrir Empaque</Btn></div>}
                </Card>
              ))}
            </div>
          ) : showsDelays ? (
            <div className="space-y-3">
              {delayReminders.map((reminder) => (
                <Card key={`${reminder.orderId}-${reminder.state}`} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: reminder.urgent ? "#A03B2A" : T.choco2 }}>{reminder.urgent ? "Urgente · actuar ahora" : "Recordatorio · revisar"}</div>
                      <div className="display text-lg font-semibold">Pedido {reminder.orderId}</div>
                      {reminder.customerName && <div className="text-xs font-bold mt-0.5" style={{ color: T.choco2 }}>Cliente: {reminder.customerName}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="display text-xl font-bold leading-none" style={{ color: reminder.urgent ? "#A03B2A" : T.choco }}>{reminder.elapsedMinutes} min</div>
                      <div className="text-[9px] uppercase tracking-wider font-extrabold max-w-28" style={{ color: T.choco2 }}>{reminder.phase || `en ${reminder.area}`}</div>
                    </div>
                  </div>
                  <div className="mt-2 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.choco2 }}>COMANDA</div>
                    <div className="text-sm" style={{ color: T.choco }}>{reminder.content}</div>
                  </div>
                  <div className="text-xs font-extrabold mt-2" style={{ color: reminder.urgent ? "#A03B2A" : T.choco2 }}>{reminder.nextAction}</div>
                </Card>
              ))}
            </div>
          ) : showsEvents ? (
            <div className="space-y-3">
              {incomingAlerts.map((alert, index) => (
                <Card key={`${alert.orderId}-${alert.eventType}-${index}`} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[.12em] font-extrabold"
                        style={{ color: alert.canPrepare ? "#3F6B42" : alert.canPack ? "#A54830" : T.choco2 }}>
                        {alert.eventType === "ready_for_packing" ? "Cocina terminó" : alert.eventType === "paid" ? "Pago confirmado" : "Pedido nuevo"} · {alert.detectedAt}
                      </div>
                      <div className="display text-lg font-semibold mt-0.5">Pedido {alert.orderId}</div>
                      {alert.customerName && <div className="text-xs font-bold mt-0.5" style={{ color: T.choco2 }}>Cliente: {alert.customerName}</div>}
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-extrabold shrink-0"
                      style={{ background: alert.canPrepare ? "#DDEBD9" : alert.canPack ? "#FBE3DA" : "#FBE8C8", color: alert.canPrepare ? "#3F6B42" : alert.canPack ? "#A54830" : "#96690F" }}>
                      {alert.canPrepare ? "✓ Pagado" : alert.canPack ? "→ Empaque" : alert.state || "Pendiente"}
                    </span>
                  </div>
                  <div className="mt-2 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.choco2 }}>COMANDA</div>
                    <div className="text-sm" style={{ color: T.choco }}>{alert.content}</div>
                  </div>
                  <div className="text-xs font-extrabold mt-2" style={{ color: alert.canPrepare ? "#3F6B42" : alert.canPack ? "#A54830" : "#A03B2A" }}>
                    {alert.canPrepare ? "✓ Cocina o Administración pueden iniciar esta comanda." : alert.canPack ? "✓ Empaque o Administración pueden tomarla y confirmar Empacado." : "⏳ Pedido recibido: todavía no preparar hasta confirmar el pago."}
                  </div>
                </Card>
              ))}
            </div>
          ) : operationalCommands.length ? (
            <div className="space-y-3">
              <div className="text-xs font-bold" style={{ color: T.choco2 }}>Ordenadas de la más antigua a la más reciente.</div>
              {operationalCommands.map((command, index) => (
                <Card key={command.orderId} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: command.canPack ? "#A54830" : "#3F6B42" }}>Comanda {index + 1} · {command.canPack ? "lista para Empaque" : "lista para Cocina"}</div>
                      <div className="display text-lg font-semibold mt-0.5">Pedido {command.orderId}</div>
                      {command.customerName && <div className="text-xs font-bold mt-0.5" style={{ color: T.choco2 }}>Cliente: {command.customerName}</div>}
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-extrabold shrink-0" style={{ background: command.canPack ? "#FBE3DA" : "#DDEBD9", color: command.canPack ? "#A54830" : "#3F6B42" }}>{command.canPack ? "→ Empaque" : "✓ Pagado"}</span>
                  </div>
                  <div className="mt-2 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.choco2 }}>COMANDA</div>
                    <div className="text-sm" style={{ color: T.choco }}>{command.content}</div>
                  </div>
                  {(command.date || command.time) && <div className="text-[10px] font-bold mt-2" style={{ color: T.choco2 }}>Recibido: {[command.date, command.time].filter(Boolean).join(" · ")}</div>}
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl p-7 text-center border" style={{ background: T.soft, borderColor: T.border }}>
              <div className="text-3xl mb-2" aria-hidden="true">✅</div>
              <div className="font-extrabold">No hay comandas pagadas esperando iniciar.</div>
              <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>MOMO OPS abrirá esta ventana apenas entre un pedido nuevo o se confirme su pago.</div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Btn kind="ghost" onClick={closeDialog}>Entendido</Btn>
            {(readyCommands.length > 0 || delayedKitchenCount > 0) && <Btn onClick={goToProduction}>Ir a Producción</Btn>}
            {(packingCommands.length > 0 || delayedPackingCount > 0) && <Btn onClick={goToPacking}>Ir a Empaque</Btn>}
          </div>
        </Modal>
      )}
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="momo-field block mb-3">
      <span className="block text-xs font-bold mb-1" style={{ color: T.choco2 }}>{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-xl px-3 py-2.5 text-sm border outline-none focus:ring-2";
const inputStyle = { background: "#fff", borderColor: T.border, color: T.choco };
function Input(props) { return <input {...props} className={inputCls} style={inputStyle} />; }
function Select({ options, ...props }) {
  return (
    <select {...props} className={inputCls} style={inputStyle}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function MiniSelect({ value, onChange, options, placeholder, disabled }) {
  return (
    <select value={value} onChange={onChange} disabled={disabled} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Empty({ icon, text }) {
  return (
    <Card className="p-8 text-center">
      <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>
      <div className="text-sm font-semibold" style={{ color: T.choco2 }}>{text}</div>
    </Card>
  );
}

function Bars({ data, money }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex flex-col gap-2">
      {data.map((d, i) => (
        <div key={d.label + i} className="flex items-center gap-2">
          <div className="w-28 sm:w-36 text-xs font-semibold truncate" style={{ color: T.choco2 }}>{d.label}</div>
          <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: T.vainilla }}>
            <div className="momo-bar h-full rounded-full" style={{ width: Math.max((d.value / max) * 100, 3) + "%", background: d.color || T.rosaDeep }} />
          </div>
          <div className="w-20 text-right text-xs font-bold">{money ? fmt(d.value) : d.value}</div>
        </div>
      ))}
      {data.length === 0 && <div className="text-xs font-semibold" style={{ color: T.choco2 }}>Sin datos en el rango.</div>}
    </div>
  );
}

/* ================= DASHBOARD ================= */

function getBusinessPanelsShared() {
  return { supabase, T, CANAL_STYLE, CANALES, CAL_ESTADOS, CAMP_ESTADOS, CREA_ESTADOS, MK_CANAL_STYLE, MK_CANALES, MK_FORMATOS, MK_OBJETIVOS, PERMISOS_POR_ROL, ROLES, SABORES, ATRIBUTO_LABEL, atributosDeTipo, hoyISO, dISO, diasEntre, selloAMs, milCO, fmt, pct, itemsOf, customerOf, productOf, orderSubtotal, orderTotal, lineAdiciones, lineAdicionesTotal, lineAdicionesCOGS, esPedidoCobrado, availability, ordersDeCampaign, ordersDeCreative, ventasDeCreative, atribucionDeResultado, resultadosDePlataforma, campaignMetrics, recipeLines, recipeCost, downloadCSV, Badge, Card, CountUp, Stat, SectionTitle, WorkScopeTabs, Btn, BtnAsync, toast, Modal, Field, Input, Select, MiniSelect, Empty, Bars, inputCls, inputStyle, InlineNotice, SegmentedTabs, deliveryBlocksNewRequest, normalizeRoles, normalizeKitchenDelaySettings, buildConfigurationSavePayload, normalizeConfigurationSnapshot, fetchOperationalHistoryPage, setOrderStatusRemoto, crearDomicilio, actualizarDomicilio, mutarDomicilioDelta, setReclamoEstado, editarReclamo, upsertCliente, guardarPreferenciasCliente, crearActivacionCliente, registrarContactoCliente, convertirActivacionCliente, activarBeneficioCliente, crearProducto, editarProducto, setProductoActivo, guardarRecetaProducto, sincronizarCostoProducto, mutarCatalogoCrmDelta, createInventoryIdempotencyKey, crearUsuarioStaff, quitarRolUsuario, setUserActivo, guardarConfiguracionServidor, fetchOperationalHealthSnapshot, fetchOperationalSloSnapshot, fetchContinuitySnapshot, runOperationalHealthReview, evaluateOperationalSloAlerts, crearCampana, editarCampana, crearCreativo, editarCreativo, crearPublicacion, setPublicacionEstado, registrarMetricasCreativo, guardarPreparacionDistribucion, aprobarDistribucion, cerrarDistribucionPublicacion, autorizarDespachoDistribucion, reintentarDespachoDistribucion, DB_VERSION };
}

function BusinessPanelFallback() {
  return <OperationalPanelFallback title="Preparando el módulo" detail="Cargando únicamente el panel que vas a usar." />;
}

function BusinessPanel({ panel, performanceRouteId, ...props }) {
  return <Suspense fallback={<BusinessPanelFallback />}>
    <LazyBusinessPanels panel={panel} {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function getOrdersPanelShared() {
  return {
    T, hoyISO, fmt, copiarTexto, toast, Badge, Btn, BtnAsync, Card, Empty, Field, Input, MiniSelect,
    Modal, SectionTitle, Select, Stat, WorkScopeTabs, CANALES, CANAL_STYLE,
    EV_TIPOS, ORDER_STATES, ORIGEN_SIMPLE, availability, boxesAdicionesTotal, comboFaltantesFamilia,
    compressImage, customerOf, downloadCSV, evidencesOf, figurasDeCombo, inputCls, inputStyle, itemsOf,
    lineAdiciones, lineAdicionesTotal, orderSubtotal, orderTotal, productOf, reqFotosPaso, sugerirZona,
    tieneEvidencia, tieneSelloEmpaque,
  };
}

function OrdersPanelFallback() {
  return <Card className="p-6" aria-live="polite">
    <div className="flex items-center gap-3">
      <span className="momo-busy-spinner text-xl" aria-hidden="true">⏳</span>
      <div>
        <div className="display font-semibold">Preparando pedidos y empaque</div>
        <div className="text-xs mt-1" style={{ color: T.choco2 }}>Cargando solo el flujo que vas a operar.</div>
      </div>
    </div>
  </Card>;
}

function PanelReadySignal({ routeId }) {
  useEffect(() => {
    if (!routeId) return undefined;
    const frame = requestAnimationFrame(() => runtimePerformance.markUiCommitted(routeId));
    return () => cancelAnimationFrame(frame);
  }, [routeId]);
  return null;
}

function OrdersPanel({ performanceRouteId, ...props }) {
  return <Suspense fallback={<OrdersPanelFallback />}>
    <LazyOrdersPanel {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function getProductionPanelShared() {
  return {
    T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, MiniSelect, Modal, SectionTitle, Select,
    WorkScopeTabs, customerOf, dISO, estadoCongelacion, fmt, fmtHoras, hoyISO, inputCls, inputStyle,
    pct, recipeCost, recipeLines, toast, vibrar,
  };
}

function OperationalPanelFallback({ title, detail }) {
  return <Card className="p-6" aria-live="polite">
    <div className="flex items-center gap-3">
      <span className="momo-busy-spinner text-xl" aria-hidden="true">⏳</span>
      <div>
        <div className="display font-semibold">{title}</div>
        <div className="text-xs mt-1" style={{ color: T.choco2 }}>{detail}</div>
      </div>
    </div>
  </Card>;
}

function Produccion({ performanceRouteId, ...props }) {
  return <Suspense fallback={<OperationalPanelFallback title="Preparando Producción" detail="Cargando comandas, lotes y cronómetros de Cocina." />}>
    <LazyProductionPanel {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function getInventoryPanelsShared() {
  return {
    T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, Modal, SectionTitle, Select, Stat, diasEntre,
    downloadCSV, fmt, hoyISO, inputStyle, toast,
  };
}

function InventarioTerminado({ performanceRouteId, ...props }) {
  return <Suspense fallback={<OperationalPanelFallback title="Preparando inventario terminado" detail="Cargando figuras, sabores, reservas y vencimientos." />}>
    <LazyInventoryPanels kind="finished" {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function Inventario({ performanceRouteId, ...props }) {
  return <Suspense fallback={<OperationalPanelFallback title="Preparando inventario" detail="Cargando insumos, lotes, reservas y movimientos." />}>
    <LazyInventoryPanels kind="ingredients" {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function getFinancePanelShared() {
  return {
    T, addAudit, Btn, Card, dISO, downloadCSV, fmt, hoyISO, inputStyle, Modal, pct, SectionTitle, Stat,
  };
}

function FinancePanelFallback() {
  return <div>
    <SectionTitle>Finanzas operativas</SectionTitle>
    <InlineNotice icon="⏳" title="Preparando Finanzas" tone="warning">
      Cargando el asistente y los controles del periodo solo para esta vista.
    </InlineNotice>
  </div>;
}

function Finanzas({ performanceRouteId, ...props }) {
  return <Suspense fallback={<FinancePanelFallback />}>
    <LazyFinancePanel {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

function getAgencyPanelShared() {
  return {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty,
  };
}

function AgencyPanelFallback() {
  return <Card className="p-6" aria-live="polite">
    <div className="flex items-center gap-3">
      <span className="momo-busy-spinner text-xl" aria-hidden="true">⏳</span>
      <div>
        <div className="display font-semibold">Preparando Agencia MOMOS</div>
        <div className="text-xs mt-1" style={{ color: T.choco2 }}>Cargando solo las herramientas que vas a usar…</div>
      </div>
    </div>
  </Card>;
}

function Crecimiento({ performanceRouteId, ...props }) {
  return <Suspense fallback={<AgencyPanelFallback />}>
    <LazyAgencyPanel {...props} />
    <PanelReadySignal routeId={performanceRouteId} />
  </Suspense>;
}

/* ================= APP SHELL ================= */

// Módulos que TODAVÍA escriben en el estado local (pendientes de migrar a RPCs):
// sus cambios no llegan al servidor y la próxima hidratación los pisa.
const MODULOS_EN_MIGRACION = [];
const PERFORMANCE_FRESHNESS_TTL = Object.freeze({
  [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
  [SYNC_DOMAINS.OPERATIONS]: 30_000,
  [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
  [SYNC_DOMAINS.FINANCE]: 60_000,
  [SYNC_DOMAINS.CONFIGURATION]: 5 * 60_000,
  [SYNC_DOMAINS.DASHBOARD]: 30_000,
  [SYNC_DOMAINS.LOGISTICS]: 30_000,
});
const LAZY_PERFORMANCE_VIEWS = new Set(["Dashboard", "Pedidos", "Empaque", "Producción", "Inventario terminado", "Inventario", "Productos", "Domicilios", "Reclamos", "Historial operativo", "Clientes", "Beneficios", "Crecimiento", "Marketing", "Creativos", "Calendario", "Resultados", "Finanzas", "Reportes", "Configuración"]);

function syncDomainsForDbView(view, data) {
  return syncDomainsForView(view, {
    agencyOperationalFactsReady: data?.agencyOperationalFactsReady === true,
  });
}

function waitForUiCommitFrame() {
  if (typeof window === "undefined") return Promise.resolve();
  if (document.visibilityState === "visible" && typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function BannerMigracion({ modulo }) {
  const configuracion = modulo === "Configuración";
  return (
    <div className="rounded-2xl border px-4 py-3 mb-4 text-sm font-bold" role="alert"
      style={{ background: "#FFF4E0", borderColor: "#E7C078", color: "#96690F" }}>
      {configuracion
        ? "🚧 Configuración en migración: los tiempos de pedidos demorados y la gestión de usuarios sí se guardan en el servidor. Los demás ajustes todavía pueden ser solo locales."
        : "🚧 Módulo en migración: los cambios hechos acá todavía NO se guardan en el servidor — se pierden al recargar o cuando la app se actualiza desde el server. Usalo para consultar."}
    </div>
  );
}

const MODULOS = [
  { id: "Dashboard", icon: "🏠", hint: "Lo urgente de hoy, en el orden correcto.", roles: ["Administrador","Cajero","Coordinador de pedidos","Cocina","Empaque","Logística","Marketing/CRM","Mensajero"] },
  { id: "Pedidos", icon: "🧾", hint: "Cada área confirma únicamente el paso que realmente ejecutó.", roles: ["Administrador","Cajero","Coordinador de pedidos","Cocina","Empaque","Logística","Mensajero"] },
  { id: "Producción", icon: "👩‍🍳", hint: "Prepará, congelá y desmoldá cada lote con trazabilidad.", roles: ["Administrador","Cocina"] },
  { id: "Empaque", icon: "🎁", hint: "Compará la comanda, documentá el empaque y entregá a Logística.", roles: ["Administrador","Empaque"] },
  { id: "Inventario terminado", icon: "🍮", hint: "Consultá disponibles, reservas, lotes en proceso e imperfectas.", roles: ["Administrador","Cajero","Coordinador de pedidos","Cocina","Empaque","Logística"] },
  { id: "Inventario", icon: "📦", hint: "Registrá lo que entra, se usa, se ajusta o se acaba.", roles: ["Administrador","Cocina"] },
  { id: "Productos", icon: "🍰", hint: "Definí qué vendemos, cuánto cuesta y cómo se prepara.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Domicilios", icon: "🛵", hint: "Asigná, despachá y seguí cada entrega hasta cerrar.", roles: ["Administrador","Logística","Mensajero"] },
  { id: "Reclamos", icon: "⚠️", hint: "Investigá, decidí y resolvé cada caso con evidencia.", roles: ["Administrador","Coordinador de pedidos","Empaque","Logística","Marketing/CRM"] },
  { id: "Historial operativo", label: "Historial", icon: "◷", hint: "Auditá en un solo lugar qué pasó, cuándo, dónde y quién lo hizo.", roles: ["Administrador","Coordinador de pedidos"] },
  { id: "Clientes", icon: "💗", hint: "Reconocé a cada persona y prepará el siguiente contacto.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Beneficios", icon: "🎁", hint: "Creá motivos claros para volver, regalar y recomendar.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Crecimiento", label: "Agencia MOMOS", title: "Agencia Comercial MOMOS", icon: "✦", hint: "Convertí datos reales en decisiones, creativos y crecimiento protegido.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Marketing", icon: "📣", hint: "Planeá campañas con objetivo, presupuesto y responsable.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Creativos", icon: "🎨", hint: "Llevá cada idea de borrador a pieza ganadora.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Calendario", icon: "🗓️", hint: "Programá qué sale, dónde, cuándo y con qué intención.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Resultados", icon: "📊", hint: "Registrá señales reales y decidí qué repetir o pausar.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Finanzas", icon: "💰", hint: "Entendé ingresos, costos y caja antes de decidir.", roles: ["Administrador"] },
  { id: "Reportes", icon: "📊", hint: "Leé el negocio por periodo, canal y resultado.", roles: ["Administrador","Marketing/CRM"] },
  { id: "Configuración", icon: "⚙️", hint: "Ajustá reglas, accesos y respaldos de la operación.", roles: ["Administrador"] },
];

const ROLES = ORDER_WORKFLOW_ROLES;

/* ── Fase 3 · slice 1: login real contra Supabase Auth ── */
function PantallaLogin() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  async function entrar(e) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
    if (err) {
      setError(err.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : "No se pudo iniciar sesión: " + err.message);
      setEnviando(false);
    }
    // Con éxito no hay que hacer nada: onAuthStateChange cambia la pantalla solo.
  }
  return (
    <div className="momos min-h-screen flex items-center justify-center p-4" style={{ background: T.bg }}>
      <style>{FONTS}</style>
      <form onSubmit={entrar} className="w-full max-w-sm rounded-3xl border p-6 shadow-sm" style={{ background: T.surface, borderColor: T.border }}>
        <div className="text-center mb-5">
          <div className="text-4xl mb-2" aria-hidden="true">🐱</div>
          <div className="display text-xl font-semibold">MOMOS <span style={{ color: T.coral }}>OPS</span></div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>D'Momos Sweet Love · El Caney, Cali</div>
        </div>
        <label className="block text-xs font-bold mb-1" style={{ color: T.choco2 }}>Correo</label>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none mb-3" style={inputStyle} />
        <label className="block text-xs font-bold mb-1" style={{ color: T.choco2 }}>Contraseña</label>
        <input type="password" autoComplete="current-password" required value={pass} onChange={(e) => setPass(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none mb-4" style={inputStyle} />
        {error && <div className="text-xs font-bold mb-3" style={{ color: "#A03B2A" }}>{error}</div>}
        <button type="submit" disabled={enviando} className="w-full rounded-xl px-3 py-2.5 text-sm font-bold" style={{ background: T.coral, color: "#fff", opacity: enviando ? 0.6 : 1 }}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

function PantallaSinPerfil({ mensaje }) {
  return (
    <div className="momos min-h-screen flex items-center justify-center p-4" style={{ background: T.bg }}>
      <style>{FONTS}</style>
      <div className="w-full max-w-sm rounded-3xl border p-6 text-center" style={{ background: T.surface, borderColor: T.border }}>
        <div className="text-4xl mb-2" aria-hidden="true">🚫</div>
        <div className="display text-lg font-semibold mb-2">Sin acceso</div>
        <div className="text-sm font-semibold mb-4" style={{ color: T.choco2 }}>{mensaje}</div>
        <button onClick={() => supabase.auth.signOut()} className="rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: T.coral, color: "#fff" }}>Salir</button>
      </div>
    </div>
  );
}

export default function MomosOps() {
  const [db, setDb] = useState(null);
  const [incompat, setIncompat] = useState(null); // versión guardada más nueva que la app
  const [corruptStorage, setCorruptStorage] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");
  const [vista, setVista] = useState("Dashboard");
  const [focus, setFocus] = useState(null); // contexto de navegación: {estado} | {itemId} | {claimId} | {desde,hasta}
  const [session, setSession] = useState(undefined); // undefined = verificando sesión · null = sin sesión
  const [sessionCacheReady, setSessionCacheReady] = useState(false);
  const [perfil, setPerfil] = useState(null); // fila de public.users del usuario logueado (id, nombre, rol, activo)
  const [perfilError, setPerfilError] = useState(null);
  const [catalogosDe, setCatalogosDe] = useState(null); // null=sin intentar | "servidor" | "cache"
  const hidratadoRef = useRef(false);
  const [masAbierto, setMasAbierto] = useState(false);
  const [sync, setSync] = useState("cargando"); // cargando | guardado | guardando | local
  const [realtimeStatus, setRealtimeStatus] = useState("conectando"); // conectando | activo | reconectando
  const saveTimer = useRef(null);
  const saveTokenRef = useRef(0);
  const syncRef = useRef("cargando");
  const realtimeStatusRef = useRef("conectando");
  const syncCoordinatorRef = useRef(null);
  const performanceRouteRef = useRef(0);
  const dbRef = useRef(null);
  const agencySnapshotVersionRef = useRef("");
  const financeSnapshotVersionRef = useRef("");
  const configurationSnapshotVersionRef = useRef("");
  const dashboardSnapshotVersionRef = useRef("");
  const agencyRealtimeSeenVersionRef = useRef("");
  // Persiste fuera del efecto de suscripción: un cambio de vista/flag durante
  // los 350 ms de debounce no puede borrar una versión Realtime ya observada.
  const agencyRealtimePendingVersionRef = useRef("");
  const inventoryMutationVersionsRef = useRef({});
  const inventoryMutationLatestEventRef = useRef("");
  const inventoryRealtimePendingRef = useRef(new Map());
  // H70: toda lectura asíncrona de Inventario captura esta generación antes
  // de salir a red. Cada snapshot o delta aceptado la incrementa. Así una
  // respuesta anterior nunca puede reemplazar un estado aplicado después.
  const inventorySyncGenerationRef = useRef(0);
  // Revisión exclusiva de snapshots CATALOGS aceptados. Permite saber si un
  // fallback realmente reconcilió el inventario, sin confundirlo con un delta
  // concurrente que también incrementa la generación general.
  const inventorySnapshotRevisionRef = useRef(0);
  // Un reset de base o una hidratacion inicial incompleta exige el bloque core
  // atomico de Catalogos. El flag vive fuera del efecto Realtime para que
  // cambiar de vista o reconstruir el canal no lo borre.
  const inventoryFullSnapshotRequiredRef = useRef(true);
  const inventoryReconcileRequestRef = useRef(null);
  const orderSyncGenerationRef = useRef(0);
  const orderRealtimePendingRef = useRef(new Set());
  const orderReconcileRequestRef = useRef(null);
  const finishedInventorySyncGenerationRef = useRef(0);
  const finishedInventoryRealtimePendingRef = useRef(new Set());
  const finishedInventoryReconcileRequestRef = useRef(null);
  const productCatalogSyncGenerationRef = useRef(0);
  const productCatalogRealtimePendingRef = useRef(new Set());
  const productCatalogReconcileRequestRef = useRef(null);
  const customerCrmSyncGenerationRef = useRef(0);
  const customerCrmRealtimePendingRef = useRef(new Set());
  const customerCrmReconcileRequestRef = useRef(null);
  const sessionOwnerRef = useRef(null);
  const activeStorageKeyRef = useRef(null);
  const visibleSyncDomainsRef = useRef(new Set(syncDomainsForDbView(vista, db)));
  visibleSyncDomainsRef.current = new Set(syncDomainsForDbView(vista, db));
  useEffect(() => { syncRef.current = sync; }, [sync]);
  useEffect(() => { realtimeStatusRef.current = realtimeStatus; }, [realtimeStatus]);
  useEffect(() => {
    dbRef.current = db;
    const version = normalizeAgencySnapshotVersion(db?.agencySnapshotVersion);
    agencySnapshotVersionRef.current = version;
    if (compareAgencySnapshotVersions(version, agencyRealtimeSeenVersionRef.current) === 1
        || !agencyRealtimeSeenVersionRef.current) {
      agencyRealtimeSeenVersionRef.current = version;
    }
    if (agencyRealtimePendingVersionRef.current
        && !shouldFlushAgencyRealtimeRefresh({
          queuedVersion: agencyRealtimePendingVersionRef.current,
          appliedVersion: version,
        })) {
      agencyRealtimePendingVersionRef.current = "";
    }
    financeSnapshotVersionRef.current = normalizeAgencySnapshotVersion(db?.financeSnapshotVersion);
    configurationSnapshotVersionRef.current = normalizeAgencySnapshotVersion(db?.configurationSnapshotVersion);
    dashboardSnapshotVersionRef.current = normalizeAgencySnapshotVersion(db?.dashboardSnapshotVersion);
    const inventoryVersion = normalizeInventoryCursorToken(db?.inventoryMutationEventVersion);
    if (inventoryVersion && (compareInventoryCursorTokens(
      inventoryVersion,
      inventoryMutationLatestEventRef.current,
    ) === 1 || !inventoryMutationLatestEventRef.current)) {
      inventoryMutationLatestEventRef.current = inventoryVersion;
    }
  }, [db]);
  useEffect(() => {
    const nextUserId = session?.user?.id || null;
    const previousUserId = sessionOwnerRef.current;
    let cancelled = false;
    syncCoordinatorRef.current?.cancel();
    syncCoordinatorRef.current = null;
    agencySnapshotVersionRef.current = "";
    agencyRealtimeSeenVersionRef.current = "";
    agencyRealtimePendingVersionRef.current = "";
    financeSnapshotVersionRef.current = "";
    configurationSnapshotVersionRef.current = "";
    dashboardSnapshotVersionRef.current = "";
    inventoryMutationVersionsRef.current = {};
    inventoryMutationLatestEventRef.current = "";
    inventoryRealtimePendingRef.current.clear();
    // No volver a cero: una respuesta pendiente de la sesión anterior podría
    // haber capturado precisamente cero. Incrementar invalida todos los reads.
    inventorySyncGenerationRef.current += 1;
    inventoryFullSnapshotRequiredRef.current = true;
    inventoryReconcileRequestRef.current = null;
    orderSyncGenerationRef.current += 1;
    orderRealtimePendingRef.current.clear();
    orderReconcileRequestRef.current = null;
    finishedInventorySyncGenerationRef.current += 1;
    finishedInventoryRealtimePendingRef.current.clear();
    finishedInventoryReconcileRequestRef.current = null;
    productCatalogSyncGenerationRef.current += 1;
    productCatalogRealtimePendingRef.current.clear();
    productCatalogReconcileRequestRef.current = null;
    customerCrmSyncGenerationRef.current += 1;
    customerCrmRealtimePendingRef.current.clear();
    customerCrmReconcileRequestRef.current = null;
    hidratadoRef.current = false;
    setCatalogosDe(null);
    setSessionCacheReady(false);
    setCorruptStorage(false);
    setIncompat(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    saveTokenRef.current += 1;
    activeStorageKeyRef.current = sessionCacheKey(DB_KEY, nextUserId);
    sessionOwnerRef.current = nextUserId;
    if (previousUserId && previousUserId !== nextUserId) {
      dbReset(sessionCacheKey(DB_KEY, previousUserId)).catch(() => {});
    }
    purgeLegacyPersistentCache(nextUserId || previousUserId).catch(() => {});

    if (!nextUserId) {
      dbRef.current = null;
      setDb(null);
      setSync("cargando");
      setSessionCacheReady(true);
    } else {
      const storageKey = activeStorageKeyRef.current;
      const clean = seedDb();
      dbRef.current = clean;
      setDb(clean);
      setSync("cargando");
      (async () => {
        const guardado = await dbLoad(storageKey);
        if (cancelled || sessionOwnerRef.current !== nextUserId) return;
        if (guardado?._corruptStorage || guardado?._readError) {
          setCorruptStorage(true);
          setSync("local");
        } else if (guardado?._incompatibleVersion) {
          setIncompat(guardado.version);
          setSync("local");
        } else if (guardado) {
          if (guardado._migrated) delete guardado._migrated;
          dbRef.current = guardado;
          setDb(guardado);
          setSync("guardado");
          await dbPersist(guardado, storageKey);
        } else {
          await dbPersist(clean, storageKey);
        }
        if (!cancelled && sessionOwnerRef.current === nextUserId) setSessionCacheReady(true);
      })();
    }
    return () => {
      cancelled = true;
      syncCoordinatorRef.current?.cancel();
      syncCoordinatorRef.current = null;
    };
  }, [session?.user?.id]);
  // Durante desarrollo, React Refresh conserva el estado del componente. Si
  // una versión nueva del frontend ya alcanzó la versión de los datos que
  // había activado el bloqueo, recargamos una sola vez para rehidratar sin
  // borrar ni restaurar nada. En una carga normal `incompat` permanece null.
  useEffect(() => {
    if (incompat && incompat <= DB_VERSION) window.location.reload();
  }, [incompat]);

  // ── Fase 3 · slice 1: sesión Supabase = fuente de verdad de la identidad ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Eventos de operación entre caja, Cocina, Empaque y Logística. Se agrupan
  // durante 350 ms para que una RPC que modifica varias tablas produzca un solo
  // refresco coherente y no una sucesión de estados parciales en pantalla.
  useEffect(() => {
    if (!session || !perfil || !db) return undefined;
    let timer = null;
    let inventoryTimer = null;
    let orderTimer = null;
    let finishedInventoryTimer = null;
    let productionActivityTimer = null;
    let productCatalogTimer = null;
    let customerCrmTimer = null;
    let alive = true;
    const pendingDomains = new Set();
    let pendingAgencyVersion = "";
    const realtimeDomains = new Set(syncDomainsForDbView(vista, db));
    const operationsRealtime = realtimeDomains.has(SYNC_DOMAINS.OPERATIONS);
    const catalogsRealtime = realtimeDomains.has(SYNC_DOMAINS.CATALOGS);
    const agencyRealtime = realtimeDomains.has(SYNC_DOMAINS.AGENCY);
    const financeRealtime = realtimeDomains.has(SYNC_DOMAINS.FINANCE)
      && db.financeSnapshot?.sourceKind === "server-finance-snapshot-v1";
    const configurationRealtime = realtimeDomains.has(SYNC_DOMAINS.CONFIGURATION)
      && db.configurationSnapshotReady === true;
    const dashboardRealtime = realtimeDomains.has(SYNC_DOMAINS.DASHBOARD)
      && db.dashboardSnapshotReady === true;
    const logisticsRealtime = realtimeDomains.has(SYNC_DOMAINS.LOGISTICS)
      && db.deliverySnapshotReady === true;
    // H69 se activa primero en la pantalla de Inventario. Allí el outbox
    // versionado sustituye cuatro tablas crudas que antes disparaban dos
    // snapshots completos por una sola compra o ajuste.
    const productionMutationRealtime = vista === "Producción"
      && db.productionMutationDeltaReady === true;
    const inventoryDeltaRealtime = (vista === "Inventario" || productionMutationRealtime)
      && db.inventoryMutationDeltaReady === true
      && db.inventoryMutationFullSnapshotRequired === false
      && inventoryFullSnapshotRequiredRef.current === false
      && (operationsRealtime || catalogsRealtime);
    const orderDeltaRealtime = ["Pedidos", "Empaque", "Inventario terminado", "Producción", "Domicilios"].includes(vista)
      && db.orderDeltaReady === true
      && (operationsRealtime || logisticsRealtime);
    const finishedInventoryDeltaRealtime = (vista === "Inventario terminado" || productionMutationRealtime)
      && db.finishedInventoryDeltaReady === true
      && operationsRealtime;
    const productionActivityDeltaRealtime = productionMutationRealtime && operationsRealtime;
    const productCatalogDeltaRealtime = vista === "Productos"
      && db.catalogCrmDeltaReady === true
      && catalogsRealtime;
    const customerCrmDeltaRealtime = ["Clientes", "Beneficios"].includes(vista)
      && db.catalogCrmDeltaReady === true
      && operationsRealtime;
    const kitchenProcedureRealtime = vista === "Producción"
      && db.kitchenProcedureManagementReady === true
      && catalogsRealtime;
    const tables = [];
    if (operationsRealtime) {
      if (!orderDeltaRealtime) tables.push(
        "orders", "order_items", "order_item_adiciones", "packing_verifications", "evidences", "deliveries",
        ...(customerCrmDeltaRealtime ? [] : ["customers", "benefits"]), "claims", "inventory_reservations",
        ...(productionActivityDeltaRealtime ? [] : ["production_suggestions"]),
      );
      tables.push(
        ...(inventoryDeltaRealtime ? [] : ["inventory_movements"]),
        ...(finishedInventoryDeltaRealtime ? [] : ["production_batches", "lote_figuras"]),
        ...(productionActivityDeltaRealtime ? [] : ["subreceta_producciones"]),
        ...(inventoryDeltaRealtime || orderDeltaRealtime || finishedInventoryDeltaRealtime ? [] : ["audit_logs"]),
      );
    }
    if (catalogsRealtime) tables.push(
      ...(finishedInventoryDeltaRealtime || productCatalogDeltaRealtime ? [] : ["products"]),
      ...(productCatalogDeltaRealtime ? [] : ["combo_components", "recipes"]),
      ...(inventoryDeltaRealtime ? [] : ["inventory_items", "inventory_lots"]),
      "users", "toppings", "figuras",
      "catalog_values", "zonas", "proveedores_domicilio", "brand_library", "app_settings", "subrecetas", "subreceta_ingredientes", "figura_relleno",
    );
    if (operationsRealtime && db.operationalControlReady && !orderDeltaRealtime) tables.push("order_stage_assignments", "order_line_progress", "order_incidents", "order_dispatch_handoffs");
    if (operationsRealtime && db.crmServerReady && !customerCrmDeltaRealtime) tables.push("customer_crm_profiles", "customer_contacts", "customer_activations");
    // H66 publica un único outbox autorizado. Suscribirse a las tablas crudas
    // duplicaba decenas de eventos y revelaba el esquema interno. El flag evita
    // tocar una tabla inexistente durante el rollout; pre-H66 conserva polling.
    if (agencyRealtime && db.agencySnapshotReady === true) tables.push("agency_snapshot_events");
    if (inventoryDeltaRealtime) tables.push("inventory_sync_events");
    if (orderDeltaRealtime) tables.push("order_sync_versions");
    if (finishedInventoryDeltaRealtime) tables.push("finished_inventory_sync_versions");
    if (productionActivityDeltaRealtime) tables.push("production_activity_sync_versions");
    if (productCatalogDeltaRealtime) tables.push("product_catalog_sync_versions");
    if (customerCrmDeltaRealtime) tables.push("customer_crm_sync_versions");
    if (kitchenProcedureRealtime) tables.push("kitchen_procedure_sync_state");
    if (financeRealtime) tables.push("finance_sync_state");
    if (configurationRealtime) tables.push("configuration_sync_state");
    if (dashboardRealtime) tables.push("dashboard_sync_state");
    let channel = supabase.channel(`momos-operacion-${session.user.id}`);
    const refresh = (domain, agencyVersion = "") => {
      pendingDomains.add(domain);
      if (domain === SYNC_DOMAINS.AGENCY) {
        const incoming = normalizeAgencySnapshotVersion(agencyVersion);
        if (incoming && (compareAgencySnapshotVersions(incoming, pendingAgencyVersion) === 1 || !pendingAgencyVersion)) {
          pendingAgencyVersion = incoming;
        }
        if (incoming && (compareAgencySnapshotVersions(incoming, agencyRealtimePendingVersionRef.current) === 1
            || !agencyRealtimePendingVersionRef.current)) {
          agencyRealtimePendingVersionRef.current = incoming;
        }
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive || !hidratadoRef.current) return;
        const carriedAgencyVersion = agencyRealtimePendingVersionRef.current;
        const queuedAgencyVersion = compareAgencySnapshotVersions(carriedAgencyVersion, pendingAgencyVersion) === 1
          ? carriedAgencyVersion
          : pendingAgencyVersion || carriedAgencyVersion;
        pendingAgencyVersion = "";
        const domains = [...pendingDomains].filter((domain) => domain !== SYNC_DOMAINS.AGENCY
          || shouldFlushAgencyRealtimeRefresh({
            queuedVersion: queuedAgencyVersion,
            appliedVersion: agencySnapshotVersionRef.current,
          }));
        pendingDomains.clear();
        if (!domains.length) return;
        refetchFocoRef.current?.(domains, {
          reason: "realtime",
          afterActive: true,
          // Se evalúa después del apply del snapshot que esté en vuelo. Si ese
          // snapshot ya trae la versión observada, no se dispara otra RPC.
          shouldRunAfterActive: (domain) => domain !== SYNC_DOMAINS.AGENCY
            || shouldFlushAgencyRealtimeRefresh({
              queuedVersion: queuedAgencyVersion,
              appliedVersion: agencySnapshotVersionRef.current,
            }),
        }).catch(() => setRealtimeStatus("reconectando"));
      }, 350);
    };
    // Si el efecto anterior se limpió durante el debounce, retomamos su versión
    // sin depender de un segundo evento del servidor. El ref solo se vacía al
    // comprobar que un snapshot aplicado ya la contiene.
    if (agencyRealtime && agencyRealtimePendingVersionRef.current && shouldFlushAgencyRealtimeRefresh({
      queuedVersion: agencyRealtimePendingVersionRef.current,
      appliedVersion: agencySnapshotVersionRef.current,
    })) {
      refresh(SYNC_DOMAINS.AGENCY, agencyRealtimePendingVersionRef.current);
    }

    const fallbackInventorySnapshots = async () => {
      const refetch = refetchFocoRef.current;
      if (typeof refetch !== "function") return false;
      const snapshotRevision = inventorySnapshotRevisionRef.current;
      try {
        await refetch(
          [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS],
          { reason: "inventory-delta-fallback", afterActive: true },
        );
        return inventorySnapshotRevisionRef.current > snapshotRevision;
      } catch {
        if (alive) setRealtimeStatus("reconectando");
        return false;
      }
    };

    const fetchAndApplyInventoryItems = async (itemIds) => {
      for (let offset = 0; offset < itemIds.length; offset += 50) {
        const readGeneration = capturarGeneracionInventario();
        const envelope = await fetchInventoryDeltas(itemIds.slice(offset, offset + 50));
        if (!alive) return { ok: false, generation: capturarGeneracionInventario() };
        const result = aplicarBatchInventario(envelope, readGeneration);
        if (result?.status === "discarded") {
          requestInventoryReconciliation();
          return { ok: false, generation: capturarGeneracionInventario() };
        }
      }
      return { ok: true, generation: capturarGeneracionInventario() };
    };

    const flushInventoryDeltas = () => {
      if (inventoryTimer) clearTimeout(inventoryTimer);
      inventoryTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        const queued = [...inventoryRealtimePendingRef.current.entries()];
        const itemIds = queued.map(([itemId]) => itemId);
        if (!itemIds.length) return;
        try {
          const applied = await fetchAndApplyInventoryItems(itemIds);
          if (!alive) return;
          const reconciled = applied.ok || await fallbackInventorySnapshots();
          if (reconciled) {
            acknowledgeInventoryRealtimePending(inventoryRealtimePendingRef.current, queued);
          }
        } catch {
          if (alive && await fallbackInventorySnapshots()) {
            acknowledgeInventoryRealtimePending(inventoryRealtimePendingRef.current, queued);
          }
        }
      }, 180);
    };

    const queueInventoryDelta = (payload) => {
      const itemId = String(payload?.new?.item_id || "").trim();
      if (!itemId) return;
      // El event_id del outbox solo despierta la lectura dirigida. No es el
      // cursor global H70 ni se compara con source_version del item.
      enqueueInventoryRealtimeItem(inventoryRealtimePendingRef.current, itemId);
      flushInventoryDeltas();
    };

    const reconcileInventoryGap = async () => {
      if (inventoryFullSnapshotRequiredRef.current) {
        const refreshed = await fallbackInventorySnapshots();
        return refreshed && !inventoryFullSnapshotRequiredRef.current;
      }
      let cursor = inventoryMutationLatestEventRef.current || "";
      for (let page = 0; page < 5 && alive; page += 1) {
        const eventsReadGeneration = capturarGeneracionInventario();
        const rawEvents = await fetchInventoryDeltasSince(cursor, 100);
        if (!alive) return false;
        if (eventsReadGeneration !== capturarGeneracionInventario()) {
          requestInventoryReconciliation();
          return false;
        }
        const events = normalizeInventoryEventsEnvelope(rawEvents);
        if (events.resetRequired) {
          exigirSnapshotCompletoInventario("inventory_cursor_reset");
          throw new Error("El cursor local de Inventario requiere un snapshot nuevo.");
        }
        let applied = { ok: true, generation: capturarGeneracionInventario() };
        if (events.itemIds.length) {
          applied = await fetchAndApplyInventoryItems(events.itemIds);
          if (!applied.ok) return false;
        }
        // Entre la última lectura dirigida y este commit del cursor no puede
        // haberse aplicado otro snapshot/delta. Si ocurrió, repetimos el
        // handshake y nunca declaramos como contigua una página dudosa.
        if (applied.generation !== capturarGeneracionInventario()) {
          requestInventoryReconciliation();
          return false;
        }
        avanzarCursorInventario(events.nextEventId || events.latestEventId);
        if (!events.overflow) {
          avanzarCursorInventario(events.latestEventId);
          return true;
        }
        if (!events.nextEventId || events.nextEventId === cursor) break;
        cursor = events.nextEventId;
      }
      throw new Error("La brecha de Inventario excede el límite de conciliación dirigida.");
    };

    // Dedupe de reconciliación: una respuesta descartada solo programa otra
    // lectura; jamás repite la RPC de escritura. Si se descarta algo durante
    // el propio handshake, requested queda activo y el bucle vuelve a cerrar
    // la brecha desde el cursor todavía confirmado.
    const reconciliationState = { requested: false, active: null };
    const requestInventoryReconciliation = () => {
      reconciliationState.requested = true;
      if (!reconciliationState.active) {
        reconciliationState.active = (async () => {
          while (alive && reconciliationState.requested) {
            reconciliationState.requested = false;
            try {
              await reconcileInventoryGap();
            } catch {
              if (alive) await fallbackInventorySnapshots();
            }
          }
        })().finally(() => {
          reconciliationState.active = null;
          if (alive && reconciliationState.requested) requestInventoryReconciliation();
        });
      }
      return reconciliationState.active;
    };
    inventoryReconcileRequestRef.current = requestInventoryReconciliation;

    // Los pendientes sobreviven al teardown del canal. En Inventario vuelven
    // al batch dirigido; al salir de la vista se cierran con un snapshot
    // completo porque el nuevo canal de tablas crudas no puede reemitir el
    // commit que ya ocurrio.
    if (inventoryDeltaRealtime && inventoryRealtimePendingRef.current.size) {
      flushInventoryDeltas();
    } else if (dbRef.current?.inventoryMutationDeltaReady === true
        && (inventoryFullSnapshotRequiredRef.current || inventoryRealtimePendingRef.current.size)) {
      const carried = [...inventoryRealtimePendingRef.current.entries()];
      fallbackInventorySnapshots().then((refreshed) => {
        if (!alive || !refreshed) return;
        acknowledgeInventoryRealtimePending(inventoryRealtimePendingRef.current, carried);
      });
    }

    const orderReconciliationState = { active: null };
    const fallbackOrderSnapshot = () => {
      if (!orderReconciliationState.active) {
        orderReconciliationState.active = (refetchFocoRef.current?.(
          [logisticsRealtime ? SYNC_DOMAINS.LOGISTICS : SYNC_DOMAINS.OPERATIONS],
          { reason: "order-delta-fallback", afterActive: true },
        ) || Promise.resolve()).then(() => true).catch(() => {
          if (alive) setRealtimeStatus("reconectando");
          return false;
        }).finally(() => { orderReconciliationState.active = null; });
      }
      return orderReconciliationState.active;
    };
    orderReconcileRequestRef.current = fallbackOrderSnapshot;

    const flushOrderDeltas = () => {
      if (orderTimer) clearTimeout(orderTimer);
      orderTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        const orderIds = [...orderRealtimePendingRef.current].slice(0, 50);
        if (!orderIds.length) return;
        const readGeneration = orderSyncGenerationRef.current;
        try {
          const envelope = await fetchOrderDeltas(orderIds);
          if (!alive) return;
          const result = await aplicarDeltaPedido(envelope, readGeneration);
          if (result?.status === "discarded") {
            const reconciled = await fallbackOrderSnapshot();
            if (reconciled) orderIds.forEach((orderId) => orderRealtimePendingRef.current.delete(orderId));
          } else {
            orderIds.forEach((orderId) => orderRealtimePendingRef.current.delete(orderId));
          }
        } catch {
          if (alive) {
            const reconciled = await fallbackOrderSnapshot();
            if (reconciled) orderIds.forEach((orderId) => orderRealtimePendingRef.current.delete(orderId));
          }
        }
        if (alive && orderRealtimePendingRef.current.size) flushOrderDeltas();
      }, 180);
    };

    const queueOrderDelta = (payload) => {
      const orderId = String(payload?.new?.order_id || payload?.old?.order_id || "").trim();
      if (!orderId) return;
      const incomingVersion = payload?.new?.version;
      const currentVersion = dbRef.current?.orderDeltaVersions?.[orderId];
      if (currentVersion && compareOrderDeltaVersions(incomingVersion, currentVersion) !== 1) return;
      orderRealtimePendingRef.current.add(orderId);
      flushOrderDeltas();
    };

    if (orderDeltaRealtime && orderRealtimePendingRef.current.size) flushOrderDeltas();

    const finishedInventoryReconciliationState = { active: null };
    const fallbackFinishedInventorySnapshot = () => {
      if (!finishedInventoryReconciliationState.active) {
        finishedInventoryReconciliationState.active = (refetchFocoRef.current?.(
          [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS],
          { reason: "finished-inventory-delta-fallback", afterActive: true },
        ) || Promise.resolve()).then(() => true).catch(() => {
          if (alive) setRealtimeStatus("reconectando");
          return false;
        }).finally(() => { finishedInventoryReconciliationState.active = null; });
      }
      return finishedInventoryReconciliationState.active;
    };
    finishedInventoryReconcileRequestRef.current = fallbackFinishedInventorySnapshot;

    const flushFinishedInventoryDeltas = () => {
      if (finishedInventoryTimer) clearTimeout(finishedInventoryTimer);
      finishedInventoryTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        const productIds = [...finishedInventoryRealtimePendingRef.current].slice(0, 20);
        if (!productIds.length) return;
        const readGeneration = finishedInventorySyncGenerationRef.current;
        try {
          const envelope = await fetchFinishedInventoryDeltas(productIds);
          if (!alive) return;
          const result = aplicarDeltaProductoTerminado(envelope, readGeneration);
          if (result?.status === "discarded") {
            const reconciled = await fallbackFinishedInventorySnapshot();
            if (reconciled) productIds.forEach((productId) => finishedInventoryRealtimePendingRef.current.delete(productId));
          } else {
            productIds.forEach((productId) => finishedInventoryRealtimePendingRef.current.delete(productId));
          }
        } catch {
          if (alive) {
            const reconciled = await fallbackFinishedInventorySnapshot();
            if (reconciled) productIds.forEach((productId) => finishedInventoryRealtimePendingRef.current.delete(productId));
          }
        }
        if (alive && finishedInventoryRealtimePendingRef.current.size) flushFinishedInventoryDeltas();
      }, 180);
    };

    const queueFinishedInventoryDelta = (payload) => {
      const productId = String(payload?.new?.product_id || payload?.old?.product_id || "").trim();
      if (!productId) return;
      const incomingVersion = payload?.new?.version;
      const currentVersion = dbRef.current?.finishedInventoryDeltaVersions?.[productId];
      if (currentVersion && compareFinishedInventoryDeltaVersions(incomingVersion, currentVersion) !== 1) return;
      finishedInventoryRealtimePendingRef.current.add(productId);
      flushFinishedInventoryDeltas();
    };

    if (finishedInventoryDeltaRealtime && finishedInventoryRealtimePendingRef.current.size) flushFinishedInventoryDeltas();

    const productCatalogReconciliationState = { active: null };
    const fallbackProductCatalogSnapshot = () => {
      if (!productCatalogReconciliationState.active) {
        productCatalogReconciliationState.active = (refetchFocoRef.current?.(
          [SYNC_DOMAINS.CATALOGS],
          { reason: "product-catalog-delta-fallback", afterActive: true },
        ) || Promise.resolve()).then(() => true).catch(() => {
          if (alive) setRealtimeStatus("reconectando");
          return false;
        }).finally(() => { productCatalogReconciliationState.active = null; });
      }
      return productCatalogReconciliationState.active;
    };
    productCatalogReconcileRequestRef.current = fallbackProductCatalogSnapshot;

    const flushProductCatalogDeltas = () => {
      if (productCatalogTimer) clearTimeout(productCatalogTimer);
      productCatalogTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        const productIds = [...productCatalogRealtimePendingRef.current].slice(0, 20);
        if (!productIds.length) return;
        const readGeneration = productCatalogSyncGenerationRef.current;
        const finishedInventoryGeneration = finishedInventorySyncGenerationRef.current;
        try {
          const envelope = await fetchProductCatalogDeltas(productIds);
          if (!alive) return;
          const result = await aplicarDeltaCatalogoProductos(envelope, readGeneration, finishedInventoryGeneration);
          if (result?.status === "discarded") {
            const reconciled = await fallbackProductCatalogSnapshot();
            if (reconciled) productIds.forEach((productId) => productCatalogRealtimePendingRef.current.delete(productId));
          } else {
            productIds.forEach((productId) => productCatalogRealtimePendingRef.current.delete(productId));
          }
        } catch {
          if (alive) {
            const reconciled = await fallbackProductCatalogSnapshot();
            if (reconciled) productIds.forEach((productId) => productCatalogRealtimePendingRef.current.delete(productId));
          }
        }
        if (alive && productCatalogRealtimePendingRef.current.size) flushProductCatalogDeltas();
      }, 180);
    };

    const queueProductCatalogDelta = (payload) => {
      const productId = String(payload?.new?.product_id || payload?.old?.product_id || "").trim();
      if (!productId) return;
      const incomingVersion = payload?.new?.version;
      const currentVersion = dbRef.current?.productCatalogDeltaVersions?.[productId];
      if (currentVersion && compareCatalogCrmVersions(incomingVersion, currentVersion) !== 1) return;
      productCatalogRealtimePendingRef.current.add(productId);
      flushProductCatalogDeltas();
    };

    if (productCatalogDeltaRealtime && productCatalogRealtimePendingRef.current.size) flushProductCatalogDeltas();

    const customerCrmReconciliationState = { active: null };
    const fallbackCustomerCrmSnapshot = () => {
      if (!customerCrmReconciliationState.active) {
        customerCrmReconciliationState.active = (refetchFocoRef.current?.(
          [SYNC_DOMAINS.OPERATIONS],
          { reason: "customer-crm-delta-fallback", afterActive: true },
        ) || Promise.resolve()).then(() => true).catch(() => {
          if (alive) setRealtimeStatus("reconectando");
          return false;
        }).finally(() => { customerCrmReconciliationState.active = null; });
      }
      return customerCrmReconciliationState.active;
    };
    customerCrmReconcileRequestRef.current = fallbackCustomerCrmSnapshot;

    const flushCustomerCrmDeltas = () => {
      if (customerCrmTimer) clearTimeout(customerCrmTimer);
      customerCrmTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        const customerIds = [...customerCrmRealtimePendingRef.current].slice(0, 20);
        if (!customerIds.length) return;
        const readGeneration = customerCrmSyncGenerationRef.current;
        const orderGeneration = orderSyncGenerationRef.current;
        try {
          const envelope = await fetchCustomerCrmDeltas(customerIds);
          if (!alive) return;
          const result = await aplicarDeltaClienteCrm(envelope, readGeneration, orderGeneration);
          if (result?.status === "discarded") {
            const reconciled = await fallbackCustomerCrmSnapshot();
            if (reconciled) customerIds.forEach((customerId) => customerCrmRealtimePendingRef.current.delete(customerId));
          } else {
            customerIds.forEach((customerId) => customerCrmRealtimePendingRef.current.delete(customerId));
          }
        } catch {
          if (alive) {
            const reconciled = await fallbackCustomerCrmSnapshot();
            if (reconciled) customerIds.forEach((customerId) => customerCrmRealtimePendingRef.current.delete(customerId));
          }
        }
        if (alive && customerCrmRealtimePendingRef.current.size) flushCustomerCrmDeltas();
      }, 180);
    };

    const queueCustomerCrmDelta = (payload) => {
      const customerId = String(payload?.new?.customer_id || payload?.old?.customer_id || "").trim();
      if (!customerId) return;
      const incomingVersion = payload?.new?.version;
      const currentVersion = dbRef.current?.customerCrmDeltaVersions?.[customerId];
      if (currentVersion && compareCatalogCrmVersions(incomingVersion, currentVersion) !== 1) return;
      customerCrmRealtimePendingRef.current.add(customerId);
      flushCustomerCrmDeltas();
    };

    if (customerCrmDeltaRealtime && customerCrmRealtimePendingRef.current.size) flushCustomerCrmDeltas();

    const fallbackProductionActivitySnapshot = () => refetchFocoRef.current?.(
      [SYNC_DOMAINS.OPERATIONS],
      { reason: "production-activity-delta-fallback", afterActive: true },
    ) || Promise.resolve();

    const flushProductionActivityDelta = (delay = 160) => {
      if (productionActivityTimer) clearTimeout(productionActivityTimer);
      productionActivityTimer = setTimeout(async () => {
        if (!alive || !hidratadoRef.current) return;
        try {
          const envelope = await fetchProductionActivityDelta();
          if (!alive) return;
          aplicarActividadProduccion(envelope);
        } catch {
          if (!alive) return;
          try { await fallbackProductionActivitySnapshot(); }
          catch { if (alive) setRealtimeStatus("reconectando"); }
        }
      }, delay);
    };

    const queueProductionActivityDelta = (payload) => {
      const incomingVersion = String(payload?.new?.version || "").trim();
      const currentVersion = String(dbRef.current?.productionActivityDeltaVersion || "").trim();
      if (currentVersion && incomingVersion) {
        try {
          if (compareProductionDeltaVersions(incomingVersion, currentVersion) !== 1) return;
        } catch {
          // Una versiÃ³n malformada nunca se aplica; el fetch cerrado decidirÃ¡.
        }
      }
      flushProductionActivityDelta();
    };

    tables.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        if (table === "inventory_sync_events") {
          queueInventoryDelta(payload);
          return;
        }
        if (table === "order_sync_versions") {
          queueOrderDelta(payload);
          return;
        }
        if (table === "finished_inventory_sync_versions") {
          queueFinishedInventoryDelta(payload);
          return;
        }
        if (table === "production_activity_sync_versions") {
          queueProductionActivityDelta(payload);
          return;
        }
        if (table === "product_catalog_sync_versions") {
          queueProductCatalogDelta(payload);
          return;
        }
        if (table === "customer_crm_sync_versions") {
          queueCustomerCrmDelta(payload);
          return;
        }
        if (table === "kitchen_procedure_sync_state") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          const currentVersion = normalizeAgencySnapshotVersion(dbRef.current?.kitchenProcedureSyncVersion);
          if (!currentVersion || compareAgencySnapshotVersions(incomingVersion, currentVersion) === 1) {
            refresh(SYNC_DOMAINS.CATALOGS);
          }
          return;
        }
        if (table === "finance_sync_state") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          if (!financeSnapshotVersionRef.current
              || compareAgencySnapshotVersions(incomingVersion, financeSnapshotVersionRef.current) === 1) {
            refresh(SYNC_DOMAINS.FINANCE);
          }
          return;
        }
        if (table === "configuration_sync_state") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          if (!configurationSnapshotVersionRef.current
              || compareAgencySnapshotVersions(incomingVersion, configurationSnapshotVersionRef.current) === 1) {
            refresh(SYNC_DOMAINS.CONFIGURATION);
          }
          return;
        }
        if (table === "dashboard_sync_state") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          if (!dashboardSnapshotVersionRef.current
              || compareAgencySnapshotVersions(incomingVersion, dashboardSnapshotVersionRef.current) === 1) {
            refresh(SYNC_DOMAINS.DASHBOARD);
          }
          return;
        }
        const domain = syncDomainForTable(table);
        if (table === "agency_snapshot_events") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          if (shouldQueueAgencySnapshotVersion({
            incomingVersion,
            appliedVersion: agencySnapshotVersionRef.current,
            seenVersion: agencyRealtimeSeenVersionRef.current,
          })) {
            agencyRealtimeSeenVersionRef.current = incomingVersion;
            refresh(SYNC_DOMAINS.AGENCY, incomingVersion);
          }
          return;
        }
        const snapshot = syncCoordinatorRef.current?.snapshot() || {};
        if (shouldQueueRealtimeDomain({
          domain,
          visibleDomains: visibleSyncDomainsRef.current,
          activeDomains: new Set(snapshot.activeDomains || []),
          lastServerAt: snapshot.lastServerAt?.[domain] || "",
          commitTimestamp: payload?.commit_timestamp,
        })) refresh(domain);
      });
    });
    const realtimeStartedAt = globalThis.performance?.now?.() ?? Date.now();
    channel.subscribe((status) => {
      if (!alive) return;
      if (status === "SUBSCRIBED") {
        runtimePerformance.recordRealtime({
          ok: true,
          durationMs: Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - realtimeStartedAt),
        });
        setRealtimeStatus("activo");
        // Handshake sin PII: después de activar el canal comparamos solo la
        // versión singleton. Si hubo un cambio entre snapshot y suscripción,
        // encolamos una reconciliación; si ya fue incluido, no hacemos nada.
        if (agencyRealtime && dbRef.current?.agencySnapshotReady === true) {
          fetchAgencySnapshotEventVersion().then((incomingVersion) => {
            if (!alive) return;
            if (shouldQueueAgencySnapshotVersion({
              incomingVersion,
              appliedVersion: agencySnapshotVersionRef.current,
              seenVersion: agencyRealtimeSeenVersionRef.current,
            })) {
              agencyRealtimeSeenVersionRef.current = incomingVersion;
              refresh(SYNC_DOMAINS.AGENCY, incomingVersion);
            }
          }).catch(() => {
            if (alive) setRealtimeStatus("reconectando");
          });
        }
        if (financeRealtime) {
          fetchFinanceSyncVersion().then((incomingVersion) => {
            if (!alive) return;
            if (incomingVersion && (!financeSnapshotVersionRef.current
                || compareAgencySnapshotVersions(incomingVersion, financeSnapshotVersionRef.current) === 1)) {
              refresh(SYNC_DOMAINS.FINANCE);
            }
          }).catch(() => {
            if (alive) setRealtimeStatus("reconectando");
          });
        }
        if (configurationRealtime) {
          fetchConfigurationSyncVersion().then((incomingVersion) => {
            if (!alive) return;
            if (incomingVersion && (!configurationSnapshotVersionRef.current
                || compareAgencySnapshotVersions(incomingVersion, configurationSnapshotVersionRef.current) === 1)) {
              refresh(SYNC_DOMAINS.CONFIGURATION);
            }
          }).catch(() => {
            if (alive) setRealtimeStatus("reconectando");
          });
        }
        if (dashboardRealtime) {
          fetchDashboardSyncVersion().then((incomingVersion) => {
            if (!alive) return;
            if (incomingVersion && (!dashboardSnapshotVersionRef.current
                || compareAgencySnapshotVersions(incomingVersion, dashboardSnapshotVersionRef.current) === 1)) {
              refresh(SYNC_DOMAINS.DASHBOARD);
            }
          }).catch(() => {
            if (alive) setRealtimeStatus("reconectando");
          });
        }
        if (inventoryDeltaRealtime && dbRef.current?.inventoryMutationDeltaReady === true) {
          requestInventoryReconciliation();
        }
        if (productionActivityDeltaRealtime && dbRef.current?.productionMutationDeltaReady === true) {
          flushProductionActivityDelta(0);
        }
      }
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        runtimePerformance.recordRealtime({
          ok: false,
          durationMs: Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - realtimeStartedAt),
        });
        setRealtimeStatus("reconectando");
      }
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (inventoryTimer) clearTimeout(inventoryTimer);
      if (orderTimer) clearTimeout(orderTimer);
      if (finishedInventoryTimer) clearTimeout(finishedInventoryTimer);
      if (productionActivityTimer) clearTimeout(productionActivityTimer);
      if (productCatalogTimer) clearTimeout(productCatalogTimer);
      if (customerCrmTimer) clearTimeout(customerCrmTimer);
      reconciliationState.requested = false;
      if (inventoryReconcileRequestRef.current === requestInventoryReconciliation) {
        inventoryReconcileRequestRef.current = null;
      }
      if (orderReconcileRequestRef.current === fallbackOrderSnapshot) orderReconcileRequestRef.current = null;
      if (finishedInventoryReconcileRequestRef.current === fallbackFinishedInventorySnapshot) finishedInventoryReconcileRequestRef.current = null;
      if (productCatalogReconcileRequestRef.current === fallbackProductCatalogSnapshot) productCatalogReconcileRequestRef.current = null;
      if (customerCrmReconcileRequestRef.current === fallbackCustomerCrmSnapshot) customerCrmReconcileRequestRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, perfil?.id, vista, Boolean(db?.operationalControlReady), Boolean(db?.crmServerReady), Boolean(db?.agencySnapshotReady), Boolean(db?.agencyOperationalFactsReady), Boolean(db?.financeSnapshotReady), Boolean(db?.configurationSnapshotReady), Boolean(db?.dashboardSnapshotReady), Boolean(db?.deliverySnapshotReady), Boolean(db?.inventoryMutationDeltaReady), Boolean(db?.inventoryMutationFullSnapshotRequired), Boolean(db?.orderDeltaReady), Boolean(db?.finishedInventoryDeltaReady), Boolean(db?.productionMutationDeltaReady), Boolean(db?.catalogCrmDeltaReady)]);

  // Con sesión: cargar el perfil real (public.users) por auth_id — define nombre y rol
  const authUserId = session?.user?.id;
  useEffect(() => {
    if (!authUserId) { setPerfil(null); setPerfilError(null); return; }
    setPerfil(null);
    setPerfilError(null);
    let vivo = true;
    (async () => {
      try {
        const data = await fetchUserProfile(authUserId);
        if (!vivo) return;
        if (!data) setPerfilError("Tu usuario no está vinculado al equipo. Avisale al administrador.");
        else if (!data.activo) setPerfilError("Tu usuario está desactivado. Avisale al administrador.");
        else { setPerfil(data); setPerfilError(null); }
      } catch (error) {
        if (vivo) setPerfilError("No se pudo cargar tu perfil: " + error.message);
      }
    })();
    return () => { vivo = false; };
  }, [authUserId]);

  // H96 envía, como máximo una vez por minuto, histogramas y contadores
  // cerrados. No incluye URL, RPC, vista, usuario, pedido, payload ni texto.
  useEffect(() => {
    if (!authUserId || !perfil?.id || perfil?.activo === false) return undefined;
    const reporter = createRuntimeSloReporter({
      telemetry: runtimePerformance,
      report: reportClientSloTelemetry,
    });
    return () => reporter.stop();
  }, [authUserId, perfil?.id, perfil?.activo]);

  // ── Fase 3: hidratar desde Supabase (una vez por carga; re-usable tras cada escritura remota) ──
  // Maestros/catálogos + operativo + campaigns/creatives/content_posts/metrics_daily.
  async function aplicarDominiosServidor(payload, context = {}) {
    const catalogs = payload?.[SYNC_DOMAINS.CATALOGS];
    const agency = payload?.[SYNC_DOMAINS.AGENCY];
    const op = payload?.[SYNC_DOMAINS.OPERATIONS];
    const finance = payload?.[SYNC_DOMAINS.FINANCE];
    const configuration = payload?.[SYNC_DOMAINS.CONFIGURATION];
    const dashboard = payload?.[SYNC_DOMAINS.DASHBOARD];
    const logistics = payload?.[SYNC_DOMAINS.LOGISTICS];
    const generationBeforeApply = capturarGeneracionInventario();
    let inventorySnapshotApplied = false;
    let inventorySnapshotDiscarded = false;
    let inventorySnapshotNeedsHandshake = false;
    let orderSnapshotApplied = false;
    let orderSnapshotDiscarded = false;
    let finishedInventorySnapshotApplied = false;
    let finishedInventorySnapshotDiscarded = false;
    let productCatalogSnapshotApplied = false;
    let productCatalogSnapshotDiscarded = false;
    let customerCrmSnapshotApplied = false;
    let customerCrmSnapshotDiscarded = false;
    let logisticsSnapshotApplied = false;
    update((d) => {
      if (catalogs) {
      const cat = catalogs;
      const capturedFinishedInventoryGeneration = Number(cat.__finishedInventoryReadGeneration);
      const finishedInventoryCatalogIsCurrent = !Number.isFinite(capturedFinishedInventoryGeneration)
        || capturedFinishedInventoryGeneration === finishedInventorySyncGenerationRef.current;
      const capturedProductCatalogGeneration = Number(cat.__productCatalogReadGeneration);
      const productCatalogIsCurrent = !Number.isFinite(capturedProductCatalogGeneration)
        || capturedProductCatalogGeneration === productCatalogSyncGenerationRef.current;
      if (finishedInventoryCatalogIsCurrent && productCatalogIsCurrent) {
        d.products = cat.products;
        d.recipes = cat.recipes;
        d.productsServerReady = Boolean(cat.productsServerReady);
        d.catalogCrmDeltaReady = Boolean(cat.catalogCrmDeltaReady);
        d.productCatalogDeltaVersions = {};
        finishedInventorySnapshotApplied = true;
        productCatalogSnapshotApplied = true;
      } else {
        if (!finishedInventoryCatalogIsCurrent) finishedInventorySnapshotDiscarded = true;
        if (!productCatalogIsCurrent) productCatalogSnapshotDiscarded = true;
      }
      const capturedGeneration = Number(cat.__inventoryReadGeneration);
      const currentGeneration = generationBeforeApply;
      // H70 solo habilita el camino incremental si CATALOGS trae el boundary
      // MVCC y la generación capturada al iniciar la lectura sigue vigente.
      const protectedInventorySnapshot = cat.inventoryMutationDeltaReady === true;
      const protectedSnapshotCursor = normalizeInventoryCursorToken(cat.inventoryMutationEventVersion);
      const snapshotIsCurrent = !protectedInventorySnapshot
        || inventoryProtectedCatalogCanApply(cat, currentGeneration);
      if (snapshotIsCurrent) {
        d.inventory_items = cat.inventory_items;
        d.inventory_lots = cat.inventory_lots || [];
        d.inventoryLotsReady = Boolean(cat.inventoryLotsReady);
        d.inventoryMutationDeltaReady = Boolean(cat.inventoryMutationDeltaReady);
        // Items, lotes, historial y boundary pertenecen al mismo
        // momos_core_snapshot_v1.
        // El snapshot aceptado reinicia exactamente cursor y versiones por
        // ítem; el handshake continuará desde ese límite atómico.
        if (protectedInventorySnapshot) {
          d.inventory_movements = cat.inventorySnapshotMovements;
          d.audit_logs = mergeInventoryAuditSnapshot(d.audit_logs, cat.inventorySnapshotAudits);
          d.inventoryMutationEventVersion = protectedSnapshotCursor;
          d.inventoryMutationFullSnapshotRequired = false;
          inventoryMutationVersionsRef.current = {};
          inventoryMutationLatestEventRef.current = protectedSnapshotCursor;
          inventoryFullSnapshotRequiredRef.current = false;
          inventorySnapshotNeedsHandshake = true;
        } else {
          // Rollout/rollback legacy: se puede usar la lectura completa cruda,
          // pero nunca conservar un boundary H70 asociado a otro bloque. Si el
          // core ya trae histories sanitizados, se aprovechan sin habilitar el
          // camino incremental.
          if (cat.inventoryCoreSnapshotReady === true) {
            d.inventory_movements = cat.inventorySnapshotMovements;
            d.audit_logs = mergeInventoryAuditSnapshot(d.audit_logs, cat.inventorySnapshotAudits);
          }
          d.inventoryMutationEventVersion = "";
          d.inventoryMutationFullSnapshotRequired = true;
          inventoryMutationVersionsRef.current = {};
          inventoryMutationLatestEventRef.current = "";
          inventoryFullSnapshotRequiredRef.current = true;
        }
        inventorySnapshotApplied = true;
      } else {
        inventorySnapshotDiscarded = true;
      }
      d.users = cat.users;
      d.multipleRolesReady = Boolean(cat.multipleRolesReady);
      d.figuras = activeFigureCatalog({ figuras: cat.figuras || [], products: d.products || [] });
      d.subrecetas = cat.subrecetas || []; // Componentes+BOM: bases (mousses/cheesecake/ganache/salsas/crocante)
      d.subreceta_ingredientes = cat.subreceta_ingredientes || []; // receta maestra por 1000 g
      d.figura_relleno = cat.figura_relleno || []; // relleno configurable de figuras (20/15 g editables)
      d.kitchen_procedures = cat.kitchen_procedures || [];
      d.kitchenProceduresReady = Boolean(cat.kitchenProceduresReady);
      d.kitchenProcedureManagementReady = Boolean(cat.kitchenProcedureManagementReady);
      d.internalPreparationFormulaReady = Boolean(cat.internalPreparationFormulaReady);
      d.kitchenProcedureSyncVersion = cat.kitchenProcedureSyncVersion || "";
      Object.assign(d.settings, cat.settingsCatalogos);
      }
      if (agency) {
      const cat = agency;
      // Solo el contrato H66 puede habilitar el outbox Realtime. El fallback
      // legado carga datos, pero nunca intenta suscribirse a una tabla ausente.
      d.agencySnapshotReady = cat.agencySnapshotReady === true;
      d.agencySnapshotVersion = normalizeAgencySnapshotVersion(cat.agencySnapshotVersion);
      d.agencyOperationalFactsReady = cat.agencyOperationalFactsReady === true;
      d.agencyOperationalFacts = d.agencyOperationalFactsReady ? cat.agencyOperationalFacts : null;
      agencySnapshotVersionRef.current = d.agencySnapshotVersion;
      if (compareAgencySnapshotVersions(d.agencySnapshotVersion, agencyRealtimeSeenVersionRef.current) === 1
          || !agencyRealtimeSeenVersionRef.current) {
        agencyRealtimeSeenVersionRef.current = d.agencySnapshotVersion;
      }
      if (agencyRealtimePendingVersionRef.current
          && !shouldFlushAgencyRealtimeRefresh({
            queuedVersion: agencyRealtimePendingVersionRef.current,
            appliedVersion: d.agencySnapshotVersion,
          })) {
        agencyRealtimePendingVersionRef.current = "";
      }
      d.campaigns = cat.campaigns || []; // Marketing Hito 2: campañas server-side (las demo locales se van al hidratar, decisión aprobada)
      d.creatives = cat.creatives || []; // Marketing contenido v1: Creativos server-side
      d.content_calendar = cat.content_calendar || []; // Calendario → content_posts
      d.creative_results = cat.creative_results || []; // Resultados → metrics_daily (sin pedidos/ventas manuales)
      d.distributionServerReady = Boolean(cat.distributionServerReady);
      d.content_distributions = cat.content_distributions || [];
      d.distributionConnectorReady = Boolean(cat.distributionConnectorReady);
      d.distributionConnectorJobs = cat.distributionConnectorJobs || [];
      d.brandMediaReady = Boolean(cat.brandMediaReady);
      d.mundoAnimadoReady = Boolean(cat.mundoAnimadoReady);
      d.officialLogoDeletionReady = Boolean(cat.officialLogoDeletionReady);
      d.brandProductionReady = Boolean(cat.brandProductionReady);
      d.brandProductionPacks = cat.brandProductionPacks || [];
      d.brandProductionPackAssets = cat.brandProductionPackAssets || [];
      d.creativeProductionReady = Boolean(cat.creativeProductionReady);
      d.creativeReviewReady = Boolean(cat.creativeReviewReady);
      d.creativeIterationReady = Boolean(cat.creativeIterationReady);
      d.mcpHumanApprovalReady = Boolean(cat.mcpHumanApprovalReady);
      d.mcpHumanApprovals = cat.mcpHumanApprovals || [];
      d.brandMediaAssets = cat.brandMediaAssets || [];
      d.creativeGenerationJobs = cat.creativeGenerationJobs || [];
      d.brandMediaUsages = cat.brandMediaUsages || [];
      d.agencyIntegrationsReady = Boolean(cat.agencyIntegrationsReady);
      d.agencyIntegrations = cat.agencyIntegrations || [];
      d.higgsfieldConnectorReady = Boolean(cat.higgsfieldConnectorReady);
      d.klingConnectorReady = Boolean(cat.klingConnectorReady);
      d.creativeConnectorRuns = cat.creativeConnectorRuns || [];
      d.agencyServerReady = Boolean(cat.agencyServerReady);
      d.agencySettings = cat.agencySettings || d.agencySettings || DEFAULT_AGENCY_SETTINGS;
      d.agencyBriefs = cat.agencyBriefs || [];
      d.agencyDecisions = cat.agencyDecisions || [];
      d.agencyCreativeVersions = cat.agencyCreativeVersions || [];
      d.agencyOrchestratorReady = Boolean(cat.agencyOrchestratorReady);
      d.agencyAgentRuns = cat.agencyAgentRuns || [];
      d.agencyAgentProposals = cat.agencyAgentProposals || [];
      d.agencyActionQueueReady = Boolean(cat.agencyActionQueueReady);
      d.agencyActionQueue = cat.agencyActionQueue || null;
      d.agencyActionOutcomesReady = Boolean(cat.agencyActionOutcomesReady);
      d.agencyActionOutcomes = cat.agencyActionOutcomes || [];
      d.agencyCollaborationReady = Boolean(cat.agencyCollaborationReady);
      d.agencyCollaborationRooms = cat.agencyCollaborationRooms || [];
      d.agencyCollaborationEntries = cat.agencyCollaborationEntries || [];
      d.agencyCreativeContracts = cat.agencyCreativeContracts || [];
      d.agencySceneStudioReady = Boolean(cat.agencySceneStudioReady);
      d.agencyStoryboards = cat.agencyStoryboards || [];
      d.agencyStoryboardShots = cat.agencyStoryboardShots || [];
      d.agencyMotionReady = Boolean(cat.agencyMotionReady);
      d.agencyMotionPlans = cat.agencyMotionPlans || [];
      d.agencyMotionRecipes = cat.agencyMotionRecipes || [];
      d.agencyMotionObservations = cat.agencyMotionObservations || [];
      d.agencySceneRouterReady = Boolean(cat.agencySceneRouterReady);
      d.agencySceneRoutingPlans = cat.agencySceneRoutingPlans || [];
      d.agencyQualityReady = Boolean(cat.agencyQualityReady);
      d.agencySceneQualityReviews = cat.agencySceneQualityReviews || [];
      d.agencyPostproductionPackages = cat.agencyPostproductionPackages || [];
      d.agencyPostproductionExportReady = Boolean(cat.agencyPostproductionExportReady);
      d.agencyPostproductionExports = cat.agencyPostproductionExports || [];
      d.agencyPostproductionWorkers = cat.agencyPostproductionWorkers || [];
      d.agencyPostproductionAudioReady = Boolean(cat.agencyPostproductionAudioReady);
      d.agencyPostproductionAudioBindings = cat.agencyPostproductionAudioBindings || [];
      d.agencyRetentionReady = Boolean(cat.agencyRetentionReady);
      d.agencyRetentionScripts = cat.agencyRetentionScripts || [];
      d.agencyRetentionHooks = cat.agencyRetentionHooks || [];
      d.agencyRetentionLoops = cat.agencyRetentionLoops || [];
      d.agencyRetentionExperiments = cat.agencyRetentionExperiments || [];
      d.agencyRetentionMeasurements = cat.agencyRetentionMeasurements || [];
      d.agencyLoopLearningReady = Boolean(cat.agencyLoopLearningReady);
      d.agencyRetentionDiagnostics = cat.agencyRetentionDiagnostics || [];
      d.agencyRetentionLearnings = cat.agencyRetentionLearnings || [];
      d.agencyMetaReady = Boolean(cat.agencyMetaReady);
      d.agencyMetaPolicies = cat.agencyMetaPolicies || [];
      d.agencyMetaSnapshots = cat.agencyMetaSnapshots || [];
      d.agencyMetaDiagnostics = cat.agencyMetaDiagnostics || [];
      d.agencyMetaIncrementalityReady = Boolean(cat.agencyMetaIncrementalityReady);
      d.agencyMetaLiftStudies = cat.agencyMetaLiftStudies || [];
      d.agencyMetaLiftMeasurements = cat.agencyMetaLiftMeasurements || [];
      d.agencyMetaInvestmentReady = Boolean(cat.agencyMetaInvestmentReady);
      d.agencyMetaInvestmentScenarios = cat.agencyMetaInvestmentScenarios || [];
      d.agencyMetaAuthorizationReady = Boolean(cat.agencyMetaAuthorizationReady);
      d.agencyMetaInvestmentAuthorizations = cat.agencyMetaInvestmentAuthorizations || [];
      d.agencyMetaInvestmentExecutionJobs = cat.agencyMetaInvestmentExecutionJobs || [];
      d.agencyMetaConnectorReady = Boolean(cat.agencyMetaConnectorReady);
      d.agencyMetaConnectorDryRuns = cat.agencyMetaConnectorDryRuns || [];
      d.agencyBrandGovernanceReady = Boolean(cat.agencyBrandGovernanceReady);
      d.agencyBrandIdentity = cat.agencyBrandIdentity || null;
      d.agencyBrandProfile = cat.agencyBrandProfile || null;
      d.agencyBrandGateBindings = cat.agencyBrandGateBindings || [];
      d.agencyGrowthReady = Boolean(cat.agencyGrowthReady);
      d.agencyGrowthPolicies = cat.agencyGrowthPolicies || [];
      d.agencyGrowthSnapshots = cat.agencyGrowthSnapshots || [];
      d.agencyGrowthSelections = cat.agencyGrowthSelections || [];
      d.agencyCreativeFlowReady = Boolean(cat.agencyCreativeFlowReady);
      d.agencyMasterReleases = cat.agencyMasterReleases || [];
      d.agencyMasterReleaseEvents = cat.agencyMasterReleaseEvents || [];
      if (cat.marketingIdeas) d.marketing_ideas = cat.marketingIdeas;
      if (cat.marketingGuiones) d.marketing_guiones = cat.marketingGuiones;
      if (cat.marketingMensajes) d.marketing_mensajes = cat.marketingMensajes;
      if (cat.marketingTasks) d.marketing_tasks = cat.marketingTasks;
      if (cat.brand_library) d.brand_library = cat.brand_library;
      }
      if (op) {
        const { __orderReadGeneration, __finishedInventoryReadGeneration, __customerCrmReadGeneration, ...operationData } = op;
        const capturedOrderGeneration = Number(__orderReadGeneration);
        const orderSnapshotIsCurrent = !Number.isFinite(capturedOrderGeneration)
          || capturedOrderGeneration === orderSyncGenerationRef.current;
        const capturedFinishedInventoryGeneration = Number(__finishedInventoryReadGeneration);
        const finishedInventoryOperationsAreCurrent = !Number.isFinite(capturedFinishedInventoryGeneration)
          || capturedFinishedInventoryGeneration === finishedInventorySyncGenerationRef.current;
        const capturedCustomerCrmGeneration = Number(__customerCrmReadGeneration);
        const customerCrmOperationsAreCurrent = !Number.isFinite(capturedCustomerCrmGeneration)
          || capturedCustomerCrmGeneration === customerCrmSyncGenerationRef.current;
        if (orderSnapshotIsCurrent) {
          const currentProductionBatches = d.production_batches;
          const currentVariants = d.variantes;
          const currentQuarantinedVariants = d.variantesCuarentena;
          const currentFinishedInventoryReady = d.finishedInventoryDeltaReady;
          const currentFinishedInventoryVersions = d.finishedInventoryDeltaVersions;
          const currentCustomers = d.customers;
          const currentBenefits = d.benefits;
          const currentCrmProfiles = d.customer_crm_profiles;
          const currentCrmContacts = d.customer_contacts;
          const currentCrmActivations = d.customer_activations;
          const currentCustomerCrmReady = d.catalogCrmDeltaReady;
          const currentCustomerCrmVersions = d.customerCrmDeltaVersions;
          const protectedOperations = d.inventoryMutationDeltaReady === true;
          if (protectedOperations) {
            // Con H70, OPERATIONS nunca es dueño del historial de Inventario:
            // puede llegar solo o después de un delta y no tiene el safe-xmin
            // atómico del core. Conserva su auditoría no-Inventario y omite
            // exactamente las dos colecciones protegidas.
            const { inventory_movements, audit_logs, ...safeOperations } = operationData;
            const currentInventoryAudits = (d.audit_logs || [])
              .filter((row) => row?.entidad === "Inventario");
            Object.assign(d, safeOperations);
            d.audit_logs = mergeInventoryAuditSnapshot(audit_logs, currentInventoryAudits);
          } else {
            Object.assign(d, operationData);
          }
          if (finishedInventoryOperationsAreCurrent) {
            d.finishedInventoryDeltaReady = operationData.finishedInventoryDeltaReady === true;
            d.finishedInventoryDeltaVersions = {};
            finishedInventorySnapshotApplied = true;
          } else {
            d.production_batches = currentProductionBatches;
            d.variantes = currentVariants;
            d.variantesCuarentena = currentQuarantinedVariants;
            d.finishedInventoryDeltaReady = currentFinishedInventoryReady;
            d.finishedInventoryDeltaVersions = currentFinishedInventoryVersions;
            finishedInventorySnapshotDiscarded = true;
          }
          if (customerCrmOperationsAreCurrent) {
            d.catalogCrmDeltaReady = operationData.catalogCrmDeltaReady === true;
            d.customerCrmDeltaVersions = {};
            customerCrmSnapshotApplied = true;
          } else {
            d.customers = currentCustomers;
            d.benefits = currentBenefits;
            d.customer_crm_profiles = currentCrmProfiles;
            d.customer_contacts = currentCrmContacts;
            d.customer_activations = currentCrmActivations;
            d.catalogCrmDeltaReady = currentCustomerCrmReady;
            d.customerCrmDeltaVersions = currentCustomerCrmVersions;
            customerCrmSnapshotDiscarded = true;
          }
          d.orderDeltaVersions = {};
          orderSnapshotApplied = true;
        } else {
          orderSnapshotDiscarded = true;
        }
      } // orders, order_items, customers, deliveries, evidences, benefits, claims, movements, reservations, suggestions, audit, production_batches
      if (logistics) {
        d.deliverySnapshotReady = true;
        d.deliveryMutationDeltaReady = logistics.mutationDeltaReady === true;
        d.deliverySnapshotVersion = normalizeAgencySnapshotVersion(logistics.version);
        d.deliverySnapshotSummary = logistics.summary;
        d.deliveryOrders = logistics.orders;
        d.deliveryOrderItems = logistics.orderItems;
        d.deliveryCustomers = logistics.customers;
        d.deliveryDeliveries = logistics.deliveries;
        // H81 depende de H71: las versiones exactas del snapshot son el punto
        // de partida para los cambios dirigidos posteriores.
        d.orderDeltaReady = true;
        d.orderDeltaVersions = { ...d.orderDeltaVersions, ...logistics.orderVersions };
        logisticsSnapshotApplied = true;
      }
      if (finance) {
        d.financeSnapshotReady = true;
        d.financeSnapshot = finance;
        d.financeSnapshotKey = String(finance.key || "");
        d.financeSnapshotVersion = normalizeAgencySnapshotVersion(finance?.payload?.snapshotVersion);
        const compactBudget = Number(finance?.payload?.summary?.configuredMonthlyAdBudget);
        const legacyBudget = Number(finance?.payload?.configured_ad?.monthly_budget);
        const budget = Number.isFinite(compactBudget) ? compactBudget : legacyBudget;
        if (Number.isFinite(budget) && budget >= 0) d.settings.pautaMensual = budget;
      }
      if (configuration) {
        const normalizedConfiguration = normalizeConfigurationSnapshot(configuration.payload);
        d.configurationSnapshotReady = true;
        d.configurationSnapshotVersion = normalizedConfiguration.snapshotVersion;
        configurationSnapshotVersionRef.current = normalizedConfiguration.snapshotVersion;
        d.configurationInventoryChoices = normalizedConfiguration.inventoryChoices;
        d.configurationFigureProductChoices = normalizedConfiguration.figureProductChoices;
        d.users = normalizedConfiguration.users;
        d.multipleRolesReady = true;
        d.figuras = normalizedConfiguration.figures.filter((figure) => isKitchenFigureName(figure?.nombre)).map((figure) => ({
          nombre: figure.nombre, especie: figure.especie,
          gramajeG: Number.parseInt(figure.gramaje, 10), productId: figure.productId, activo: figure.activo,
        }));
        Object.assign(d.settings, normalizedConfiguration.settingsCatalogos);
        const byId = new Map((d.audit_logs || []).map((row) => [String(row.id), row]));
        normalizedConfiguration.auditLogs.forEach((row) => byId.set(String(row.id), row));
        d.audit_logs = [...byId.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 100);
      }
      if (dashboard) {
        d.dashboardSnapshotReady = true;
        d.dashboardSnapshot = dashboard.payload;
        d.dashboardSnapshotVersion = normalizeAgencySnapshotVersion(dashboard.payload?.snapshotVersion);
        dashboardSnapshotVersionRef.current = d.dashboardSnapshotVersion;
      }
      normalizeDbShape(d); // re-deriva atributos/especie sobre lo hidratado
    }, { silencioso: true, persistir: false });
    if (inventorySnapshotApplied) {
      inventorySyncGenerationRef.current += 1;
      inventorySnapshotRevisionRef.current += 1;
    }
    if (orderSnapshotApplied) orderSyncGenerationRef.current += 1;
    if (logisticsSnapshotApplied) orderSyncGenerationRef.current += 1;
    if (finishedInventorySnapshotApplied) finishedInventorySyncGenerationRef.current += 1;
    if (productCatalogSnapshotApplied) productCatalogSyncGenerationRef.current += 1;
    if (customerCrmSnapshotApplied) customerCrmSyncGenerationRef.current += 1;
    if (inventorySnapshotDiscarded) {
      solicitarConciliacionInventario();
    } else if (inventorySnapshotNeedsHandshake && typeof inventoryReconcileRequestRef.current === "function") {
      inventoryReconcileRequestRef.current();
    }
    if (orderSnapshotDiscarded && typeof orderReconcileRequestRef.current === "function") {
      orderReconcileRequestRef.current();
    }
    if (finishedInventorySnapshotDiscarded && typeof finishedInventoryReconcileRequestRef.current === "function") {
      finishedInventoryReconcileRequestRef.current();
    }
    if (productCatalogSnapshotDiscarded && typeof productCatalogReconcileRequestRef.current === "function") {
      productCatalogReconcileRequestRef.current();
    }
    if (customerCrmSnapshotDiscarded && typeof customerCrmReconcileRequestRef.current === "function") {
      customerCrmReconcileRequestRef.current();
    }
    // La telemetría de ruta debe cerrar cuando React ya tuvo oportunidad de
    // pintar la versión aplicada, no apenas cuando terminó la respuesta HTTP.
    await waitForUiCommitFrame();
  }

  function hidratarDesdeServidor(dominios, context = {}) {
    if (!syncCoordinatorRef.current) {
      syncCoordinatorRef.current = createSyncCoordinator({
        loaders: {
          [SYNC_DOMAINS.CATALOGS]: async () => {
            const inventoryReadGeneration = capturarGeneracionInventario();
            const finishedInventoryReadGeneration = finishedInventorySyncGenerationRef.current;
            const productCatalogReadGeneration = productCatalogSyncGenerationRef.current;
            const catalogs = await measureSyncLoad(
              SYNC_DOMAINS.CATALOGS,
              () => fetchCatalogos({ includeAgency: false }),
            );
            // Metadato solo de coordinación local; nunca se persiste ni sale
            // del navegador. Permite descartar un snapshot que empezó antes
            // de un delta ya visible.
            return { ...catalogs, __inventoryReadGeneration: inventoryReadGeneration, __finishedInventoryReadGeneration: finishedInventoryReadGeneration, __productCatalogReadGeneration: productCatalogReadGeneration };
          },
          [SYNC_DOMAINS.OPERATIONS]: async () => {
            const orderReadGeneration = orderSyncGenerationRef.current;
            const finishedInventoryReadGeneration = finishedInventorySyncGenerationRef.current;
            const customerCrmReadGeneration = customerCrmSyncGenerationRef.current;
            const operations = await measureSyncLoad(SYNC_DOMAINS.OPERATIONS, fetchOperativo);
            return { ...operations, __orderReadGeneration: orderReadGeneration, __finishedInventoryReadGeneration: finishedInventoryReadGeneration, __customerCrmReadGeneration: customerCrmReadGeneration };
          },
          [SYNC_DOMAINS.AGENCY]: () => measureSyncLoad(
            SYNC_DOMAINS.AGENCY,
            fetchAgencyCatalogosConFallback,
          ),
          [SYNC_DOMAINS.FINANCE]: () => measureSyncLoad(
            SYNC_DOMAINS.FINANCE,
            () => fetchFinanceSnapshot(dISO(-30), hoyISO()),
          ),
          [SYNC_DOMAINS.CONFIGURATION]: () => measureSyncLoad(
            SYNC_DOMAINS.CONFIGURATION,
            fetchConfigurationSnapshot,
          ),
          [SYNC_DOMAINS.DASHBOARD]: () => measureSyncLoad(
            SYNC_DOMAINS.DASHBOARD,
            fetchDashboardSnapshot,
          ),
          [SYNC_DOMAINS.LOGISTICS]: () => measureSyncLoad(
            SYNC_DOMAINS.LOGISTICS,
            () => fetchDeliverySnapshot(50),
          ),
        },
        apply: aplicarDominiosServidor,
        onState: (state) => {
          if (["synced", "partial"].includes(state.status)) {
            (state.domains || []).forEach((domain) => {
              runtimePerformance.markDomainReady(domain, performanceRouteRef.current);
            });
          }
          if ((import.meta.env.DEV || runtimePerformance.isEnabled()) && typeof window !== "undefined") {
            window.MOMOS_SYNC_METRICS = state;
            window.__MOMOS_SYNC_METRICS__ = state; // alias temporal para sesiones DEV anteriores
            document.documentElement?.setAttribute("data-momos-sync", JSON.stringify({
              status: state.status,
              domains: state.domains || [],
              source: state.source || "",
            }));
          }
        },
      });
    }
    return syncCoordinatorRef.current.request(normalizeSyncDomains(dominios), context);
  }

  // Frescura multi-dispositivo: re-leer del servidor al volver a la pestaña/ventana
  // (throttle 60 s) + polling suave cada 90 s mientras la pestaña siga visible
  // (una tablet fija en Producción nunca dispara focus/visibilitychange).
  // Via ref para no cerrar sobre una versión vieja de la función.
  const refetchFocoRef = useRef(null);
  refetchFocoRef.current = hidratarDesdeServidor;
  const ultimoRefetchFocoRef = useRef(0);
  useEffect(() => {
    function alVolver({ agencyFallbackOnly = false } = {}) {
      if (document.visibilityState !== "visible") return;
      if (!hidratadoRef.current) return; // recién tras la hidratación inicial
      const ahora = Date.now();
      if (ahora - ultimoRefetchFocoRef.current < 60000) return;
      ultimoRefetchFocoRef.current = ahora;
      const visibles = new Set(syncDomainsForDbView(vista, dbRef.current));
      let vencidos = syncCoordinatorRef.current?.staleDomains({
        [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
        [SYNC_DOMAINS.OPERATIONS]: 60_000,
        [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
        [SYNC_DOMAINS.FINANCE]: 60_000,
        [SYNC_DOMAINS.CONFIGURATION]: 5 * 60_000,
        [SYNC_DOMAINS.DASHBOARD]: 30_000,
        [SYNC_DOMAINS.LOGISTICS]: 30_000,
      }).filter((domain) => visibles.has(domain)) || [];
      if (agencyFallbackOnly) vencidos = vencidos.filter((domain) => domain === SYNC_DOMAINS.AGENCY);
      if (vencidos.length) refetchFocoRef.current?.(vencidos, { reason: "focus" }).catch(() => {}); // si falla, sigue la caché
    }
    function sondeoRespaldo() {
      const agencyFallback = visibleSyncDomainsRef.current.has(SYNC_DOMAINS.AGENCY)
        && dbRef.current?.agencySnapshotReady !== true;
      if (realtimeStatusRef.current === "activo" && !agencyFallback) return;
      alVolver({ agencyFallbackOnly: realtimeStatusRef.current === "activo" && agencyFallback });
    }
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    const poll = setInterval(sondeoRespaldo, 90000); // solo respalda una caída de Realtime
    return () => {
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(poll);
    };
  }, [vista]);

  useEffect(() => {
    if (!perfil || !db || !sessionCacheReady || hidratadoRef.current) return;
    hidratadoRef.current = true;
    (async () => {
      try {
        await hidratarDesdeServidor(syncDomainsForDbView(vista, dbRef.current), { reason: "initial" });
        setCatalogosDe("servidor");
        if (syncRef.current === "cargando") setSync("guardado");
      } catch (e) {
        console.warn("Hidratación: no se pudo leer de Supabase; se usa la caché local.", e);
        setCatalogosDe("cache");
        if (syncRef.current === "cargando") setSync("local");
      }
    })();
  }, [perfil, db, sessionCacheReady]);

  useEffect(() => {
    if (!hidratadoRef.current || !syncCoordinatorRef.current) return;
    const visibles = new Set(syncDomainsForDbView(vista, dbRef.current));
    const vencidos = syncCoordinatorRef.current.staleDomains({
      [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
      [SYNC_DOMAINS.OPERATIONS]: 30_000,
      [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
      [SYNC_DOMAINS.FINANCE]: 60_000,
      [SYNC_DOMAINS.CONFIGURATION]: 5 * 60_000,
      [SYNC_DOMAINS.DASHBOARD]: 30_000,
      [SYNC_DOMAINS.LOGISTICS]: 30_000,
    }).filter((domain) => visibles.has(domain));
    if (vencidos.length) hidratarDesdeServidor(vencidos, { reason: "view-enter" }).catch(() => {});
  }, [vista, catalogosDe]);

  // Advertencia al cerrar la página si hay cambios pendientes + intento de guardado síncrono
  useEffect(() => {
    const handler = (e) => {
      if (["guardando", "local", "error"].includes(syncRef.current)) {
        // #2/#8: escribir al MISMO backend que dbLoad lee (window.storage), no sólo a localStorage
        try {
          if (dbRef.current) {
            const storageKey = activeStorageKeyRef.current;
            if (storageKey) {
              const payload = JSON.stringify(dbRef.current);
              sessionCacheStorage.set(storageKey, payload); // nunca persiste entre sesiones
            }
          }
        } catch (err) { /* sin espacio o storage bloqueado */ }
        e.preventDefault();
        e.returnValue = "Hay cambios sin guardar en MOMOS OPS.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  function go(v, payload) {
    const cambiaVista = v !== vista;
    if (cambiaVista) {
      vibrar("tap");
      const requiredDomains = syncDomainsForDbView(v, dbRef.current);
      const staleDomains = new Set(
        syncCoordinatorRef.current?.staleDomains(PERFORMANCE_FRESHNESS_TTL)
          || requiredDomains,
      );
      performanceRouteRef.current = runtimePerformance.startRoute(v, {
        requiredDomains,
        freshDomains: requiredDomains.filter((domain) => !staleDomains.has(domain)),
      });
    }
    setFocus(payload || null);
    setVista(v);
    const reducirMovimiento = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: reducirMovimiento ? "auto" : "smooth" }));
  }

  useEffect(() => {
    if (LAZY_PERFORMANCE_VIEWS.has(vista)) return undefined;
    const routeId = performanceRouteRef.current;
    if (!routeId) return undefined;
    const frame = requestAnimationFrame(() => runtimePerformance.markUiCommitted(routeId));
    return () => cancelAnimationFrame(frame);
  }, [vista]);

  // update(fn): fn muta una copia del db y PUEDE devolver un resultado leído de forma SÍNCRONA.
  // Se calcula fuera del updater de setState para no depender del timing eager-state de React 18
  // (esto arregla que cambiar/guardar/registrarLote/domicilio lean su resultado de forma confiable).
  function update(fn, opts) {
    const next = cloneDb(dbRef.current);
    const result = fn(next);
    dbRef.current = next; // referencia siempre al día (flush al cerrar + updates encadenados en el mismo tick)
    // silencioso: la hidratación de catálogos no marca "guardando" — perderla al cerrar no es pérdida (se re-hidrata)
    if (!(opts && opts.silencioso)) setSync("guardando");
    if (!(opts && opts.persistir === false)) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const token = ++saveTokenRef.current;
      saveTimer.current = setTimeout(async () => {
        const ok = await dbPersist(next, activeStorageKeyRef.current);
        // #13: sólo el guardado MÁS reciente puede tocar el indicador de sync (evita "guardado" falso)
        if (token === saveTokenRef.current) setSync(ok ? "guardado" : "error");
      }, 600);
    }
    setDb(next);
    return result;
  }

  // H88: los deltas del servidor ya llegan validados y construyen sus propias
  // colecciones inmutables. Publicarlos no debe clonar ni normalizar el Ã¡rbol
  // completo: eso reconstruÃ­a semillas, settings y decenas de dominios ajenos
  // por cada evento Realtime.
  function publicarDeltaServidor(next) {
    if (!next || typeof next !== "object" || next === dbRef.current) return false;
    dbRef.current = next;
    setDb(next);
    return true;
  }

  function capturarGeneracionInventario() {
    return inventorySyncGenerationRef.current;
  }

  function capturarGeneracionPedidos() {
    return orderSyncGenerationRef.current;
  }

  function capturarContextoMutacionCatalogoCrm() {
    return {
      productCatalogGeneration: productCatalogSyncGenerationRef.current,
      customerCrmGeneration: customerCrmSyncGenerationRef.current,
      finishedInventoryGeneration: finishedInventorySyncGenerationRef.current,
      orderGeneration: orderSyncGenerationRef.current,
    };
  }

  async function aplicarDeltaCatalogoProductos(envelope, readGeneration, finishedInventoryGeneration = finishedInventorySyncGenerationRef.current) {
    if (Number(readGeneration) !== productCatalogSyncGenerationRef.current
        || Number(finishedInventoryGeneration) !== finishedInventorySyncGenerationRef.current) {
      return { status: "discarded", reason: "product_catalog_generation_changed", applied: [], stale: [] };
    }
    const { applyProductCatalogDeltaBatchToDb } = await import("./lib/catalog-crm-delta");
    const applied = applyProductCatalogDeltaBatchToDb(dbRef.current, envelope);
    const { db: nextDb, ...result } = applied;
    if (result?.applied?.length) publicarDeltaServidor(nextDb);
    if (result?.applied?.length) productCatalogSyncGenerationRef.current += 1;
    return result;
  }

  async function aplicarDeltaClienteCrm(envelope, readGeneration, orderGeneration = orderSyncGenerationRef.current) {
    if (Number(readGeneration) !== customerCrmSyncGenerationRef.current
        || Number(orderGeneration) !== orderSyncGenerationRef.current) {
      return { status: "discarded", reason: "customer_crm_generation_changed", applied: [], stale: [] };
    }
    const { applyCustomerCrmDeltaBatchToDb } = await import("./lib/catalog-crm-delta");
    const applied = applyCustomerCrmDeltaBatchToDb(dbRef.current, envelope);
    const { db: nextDb, ...result } = applied;
    if (result?.applied?.length) publicarDeltaServidor(nextDb);
    if (result?.applied?.length) customerCrmSyncGenerationRef.current += 1;
    return result;
  }

  async function aplicarMutacionCatalogoCrm(envelope, expectedOperation, context = {}) {
    const { normalizeCatalogCrmMutationEnvelope } = await import("./lib/catalog-crm-delta");
    const normalized = normalizeCatalogCrmMutationEnvelope(envelope, expectedOperation);
    if (dbRef.current?.catalogCrmDeltaReady !== true) {
      return { status: "discarded", reason: "catalog_crm_delta_not_ready", result: normalized.result };
    }
    if (normalized.catalog) {
      const applied = await aplicarDeltaCatalogoProductos(
        normalized.catalog,
        Number(context.productCatalogGeneration),
        Number(context.finishedInventoryGeneration),
      );
      return { ...applied, duplicate: normalized.duplicate, result: normalized.result };
    }
    const applied = await aplicarDeltaClienteCrm(
      normalized.crm,
      Number(context.customerCrmGeneration),
      Number(context.orderGeneration),
    );
    return { ...applied, duplicate: normalized.duplicate, result: normalized.result };
  }

  async function aplicarDeltaPedido(envelope, readGeneration) {
    if (Number(readGeneration) !== orderSyncGenerationRef.current) {
      return { status: "discarded", applied: [], stale: [] };
    }
    const applied = applyOrderDeltaBatch(dbRef.current, envelope);
    const { db: nextDb, ...result } = applied;
    if (result?.applied?.length) {
      const { syncDeliverySnapshotOrders } = await import("./lib/delivery-sync");
      syncDeliverySnapshotOrders(nextDb, result.applied, 50);
      publicarDeltaServidor(nextDb);
    }
    if (result?.applied?.length) orderSyncGenerationRef.current += 1;
    return result;
  }

  async function aplicarMutacionDomicilio(envelope, expectedOperation, readGeneration) {
    const { normalizeDeliveryMutationEnvelope } = await import("./lib/delivery-mutation");
    const normalized = normalizeDeliveryMutationEnvelope(envelope, expectedOperation);
    const applied = await aplicarDeltaPedido(normalized.orderDelta, readGeneration);
    return { ...applied, duplicate: normalized.duplicate, orderId: normalized.orderId, deliveryId: normalized.deliveryId };
  }

  function solicitarConciliacionPedidos() {
    const request = orderReconcileRequestRef.current;
    if (typeof request === "function") return request();
    return refetchFocoRef.current?.(
      [vista === "Domicilios" ? SYNC_DOMAINS.LOGISTICS : SYNC_DOMAINS.OPERATIONS],
      { reason: "order-delta-fallback", afterActive: true },
    ) || Promise.resolve();
  }

  async function sincronizarPedidos(orderIds) {
    const ids = [...new Set((Array.isArray(orderIds) ? orderIds : [orderIds])
      .map((value) => String(value || "").trim()).filter(Boolean))];
    if (!ids.length) return { status: "empty", applied: [] };
    if (dbRef.current?.orderDeltaReady !== true) {
      await solicitarConciliacionPedidos();
      return { status: "snapshot", applied: [] };
    }
    const generation = capturarGeneracionPedidos();
    try {
      const envelope = await fetchOrderDeltas(ids);
      const result = await aplicarDeltaPedido(envelope, generation);
      if (result?.status === "discarded") await solicitarConciliacionPedidos();
      return result;
    } catch (error) {
      try {
        await solicitarConciliacionPedidos();
        return { status: "snapshot", applied: [], recoveredFrom: error?.code || "order_delta_failed" };
      } catch {
        throw error;
      }
    }
  }

  function capturarGeneracionProductoTerminado() {
    return finishedInventorySyncGenerationRef.current;
  }

  function aplicarDeltaProductoTerminado(envelope, readGeneration) {
    if (Number(readGeneration) !== finishedInventorySyncGenerationRef.current) {
      return { status: "discarded", applied: [], stale: [] };
    }
    const applied = applyFinishedInventoryDeltaBatch(dbRef.current, envelope);
    const { db: nextDb, ...result } = applied;
    if (result?.applied?.length) publicarDeltaServidor(nextDb);
    if (result?.applied?.length) finishedInventorySyncGenerationRef.current += 1;
    return result;
  }

  function solicitarConciliacionProductoTerminado() {
    const request = finishedInventoryReconcileRequestRef.current;
    if (typeof request === "function") return request();
    return refetchFocoRef.current?.(
      [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS],
      { reason: "finished-inventory-delta-fallback", afterActive: true },
    ) || Promise.resolve();
  }

  async function sincronizarProductoTerminado(productIds) {
    const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
      .map((value) => String(value || "").trim()).filter(Boolean))];
    if (!ids.length || dbRef.current?.finishedInventoryDeltaReady !== true) {
      await solicitarConciliacionProductoTerminado();
      return { status: "snapshot" };
    }
    const generation = capturarGeneracionProductoTerminado();
    try {
      const envelope = await fetchFinishedInventoryDeltas(ids);
      const result = aplicarDeltaProductoTerminado(envelope, generation);
      if (result?.status === "discarded") await solicitarConciliacionProductoTerminado();
      return result;
    } catch (error) {
      await solicitarConciliacionProductoTerminado();
      throw error;
    }
  }

  function aplicarActividadProduccion(envelope) {
    const applied = applyProductionActivityDelta(dbRef.current, envelope);
    const { db: nextDb, ...result } = applied;
    if (result?.status === "applied") publicarDeltaServidor(nextDb);
    return result;
  }

  function capturarContextoMutacionProduccion() {
    return {
      inventoryGeneration: capturarGeneracionInventario(),
      finishedInventoryGeneration: capturarGeneracionProductoTerminado(),
    };
  }

  function aplicarMutacionProduccion(envelope, context = {}) {
    const normalized = normalizeProductionMutationEnvelope(envelope);
    if (dbRef.current?.productionMutationDeltaReady !== true) {
      return { status: "discarded", reason: "production_delta_not_ready", result: normalized.result };
    }
    if (normalized.inventory && !inventoryDeltaCanApply({
      fullSnapshotRequired: inventoryFullSnapshotRequiredRef.current,
      expectedGeneration: Number(context.inventoryGeneration),
      currentGeneration: capturarGeneracionInventario(),
    })) {
      return { status: "discarded", reason: "inventory_generation_changed", result: normalized.result };
    }
    if (normalized.finishedInventory
        && Number(context.finishedInventoryGeneration) !== capturarGeneracionProductoTerminado()) {
      return { status: "discarded", reason: "finished_inventory_generation_changed", result: normalized.result };
    }
    const applied = {};
    if (normalized.inventory) {
      applied.inventory = aplicarBatchInventario(
        normalized.inventory,
        Number(context.inventoryGeneration),
      );
    }
    if (normalized.finishedInventory) {
      applied.finishedInventory = aplicarDeltaProductoTerminado(
        normalized.finishedInventory,
        Number(context.finishedInventoryGeneration),
      );
    }
    if (normalized.activity) applied.activity = aplicarActividadProduccion(normalized.activity);
    return { status: "applied", duplicate: normalized.duplicate, result: normalized.result, applied };
  }

  function solicitarConciliacionInventario() {
    const request = inventoryReconcileRequestRef.current;
    if (typeof request === "function") return request();
    // Durante el breve relevo de una suscripción, degradamos a lecturas y no a
    // otra escritura. El snapshot trae boundary atómico y luego Realtime hará
    // su handshake normal.
    return refetchFocoRef.current?.(
      [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS],
      { reason: "inventory-generation-discard", afterActive: true },
    ) || Promise.resolve();
  }

  function mayorCursorInventario(left, right) {
    const a = normalizeInventoryCursorToken(left);
    const b = normalizeInventoryCursorToken(right);
    if (!a) return b;
    if (!b) return a;
    return compareInventoryCursorTokens(a, b) === 1 ? a : b;
  }

  function aplicarSobresInventario(
    envelopes,
    expectedGeneration = capturarGeneracionInventario(),
    options = {},
  ) {
    const currentGeneration = capturarGeneracionInventario();
    if (!inventoryDeltaCanApply({
      fullSnapshotRequired: inventoryFullSnapshotRequiredRef.current,
      expectedGeneration,
      currentGeneration,
    })) {
      solicitarConciliacionInventario();
      return {
        status: "discarded",
        reason: inventoryFullSnapshotRequiredRef.current
          ? "inventory_full_snapshot_required"
          : "inventory_generation_changed",
        generation: currentGeneration,
      };
    }
    let nextDb = dbRef.current;
    let nextVersions = inventoryMutationVersionsRef.current;
    let changed = false;
    let lastResult = null;
    // La validación y la aplicación ocurren primero sobre variables locales.
    // Si un sobre está corrupto, no se publica ni una actualización parcial.
    for (const envelope of envelopes) {
      const result = applyInventoryMutationEnvelope(nextDb, envelope, nextVersions, options);
      if (result.status === "applied") {
        nextDb = result.db;
        nextVersions = result.versions;
        changed = true;
      }
      lastResult = result;
    }
    inventoryMutationVersionsRef.current = nextVersions;
    if (changed) {
      dbRef.current = nextDb;
      setDb(nextDb);
      inventorySyncGenerationRef.current += 1;
    }
    return lastResult;
  }

  function aplicarDeltaInventario(envelope, expectedGeneration = capturarGeneracionInventario()) {
    return aplicarSobresInventario([envelope], expectedGeneration);
  }

  function aplicarBatchInventario(envelope, expectedGeneration = capturarGeneracionInventario()) {
    normalizeInventoryDeltaBatch(envelope);
    // Un batch por IDs no demuestra que los eventos intermedios de otros
    // insumos hayan sido aplicados. Por eso nunca adelanta el cursor global:
    // solo actualiza las versiones monotónicas de los ítems que realmente
    // contiene. El handshake paginado avanza el cursor con next_event_id una
    // vez que ya recorrió la página completa del outbox.
    // La lectura dirigida es un snapshot autoritativo actual del item. Si dos
    // commits del mismo item cierran fuera de orden, el estado combinado puede
    // conservar el mismo sourceVersion maximo ya visto; en igualdad debe
    // reemplazar el item/lotes y fusionar historial. Una version menor no pasa.
    return aplicarSobresInventario(envelope.items, expectedGeneration, {
      authoritativeOnEqual: true,
    });
  }

  function avanzarCursorInventario(version) {
    if (inventoryFullSnapshotRequiredRef.current) return inventoryMutationLatestEventRef.current;
    const latest = mayorCursorInventario(inventoryMutationLatestEventRef.current, version);
    if (!latest || latest === inventoryMutationLatestEventRef.current) return latest;
    inventoryMutationLatestEventRef.current = latest;
    const current = dbRef.current;
    if (current && normalizeInventoryCursorToken(current.inventoryMutationEventVersion) !== latest) {
      const next = { ...current, inventoryMutationEventVersion: latest };
      dbRef.current = next;
      setDb(next);
    }
    return latest;
  }

  function exigirSnapshotCompletoInventario(reason = "inventory_full_snapshot_required") {
    inventoryFullSnapshotRequiredRef.current = true;
    inventoryMutationVersionsRef.current = {};
    inventoryMutationLatestEventRef.current = "";
    inventorySyncGenerationRef.current += 1;
    const current = dbRef.current;
    if (current && (current.inventoryMutationEventVersion
        || current.inventoryMutationFullSnapshotRequired !== true)) {
      const next = {
        ...current,
        inventoryMutationEventVersion: "",
        inventoryMutationFullSnapshotRequired: true,
      };
      dbRef.current = next;
      setDb(next);
    }
    return reason;
  }

  async function resetear() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    exigirSnapshotCompletoInventario("inventory_local_reset");
    inventoryRealtimePendingRef.current.clear();
    await dbReset(activeStorageKeyRef.current);
    // dbReset cede el control: reafirmar el bloqueo por si un snapshot que ya
    // estaba en vuelo alcanzo a cerrar durante ese intervalo.
    exigirSnapshotCompletoInventario("inventory_local_reset");
    const semilla = seedDb();
    dbRef.current = semilla;
    setDb(semilla);
    hidratadoRef.current = false; // la semilla pisó los catálogos: re-hidratar del servidor
    setCatalogosDe(null);
    const ok = await dbPersist(semilla, activeStorageKeyRef.current);
    setSync(ok ? "guardado" : "error");
    setVista("Dashboard");
  }

  async function restaurarBackup(data) {
    let next = cloneDb(data);
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new Error("El archivo no es un respaldo válido de MOMOS.");
    }
    if (typeof next.version !== "number") {
      throw new Error("El backup no tiene una versión válida de MOMOS OPS.");
    }
    if (next.version > DB_VERSION) {
      throw new Error("Este backup pertenece a una versión más nueva de MOMOS OPS.");
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (next.version < DB_VERSION) next = migrate(next);
    if (next._migrated) delete next._migrated;
    next = normalizeDbShape(next);
    exigirSnapshotCompletoInventario("inventory_backup_restore");
    inventoryRealtimePendingRef.current.clear();
    next.inventoryMutationEventVersion = "";
    next.inventoryMutationFullSnapshotRequired = true;
    dbRef.current = next;
    setDb(next);
    hidratadoRef.current = false; // el backup pisó los catálogos: re-hidratar del servidor
    setCatalogosDe(null);
    const ok = await dbPersist(next, activeStorageKeyRef.current);
    setSync(ok ? "guardado" : "error");
    if (!ok) throw new Error("No se pudo guardar el backup restaurado.");
  }

  async function handleRestoreFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        setRestoreMsg("❌ El archivo no es un respaldo válido de MOMOS."); return;
      }
      if (typeof data.version !== "number") {
        setRestoreMsg("❌ El backup no tiene una versión válida de MOMOS OPS."); return;
      }
      if (data.version > DB_VERSION) {
        setRestoreMsg("❌ Este backup pertenece a una versión más nueva de MOMOS OPS."); return;
      }
      const arraysReq = ["orders", "order_items", "customers", "products"];
      const faltanArray = arraysReq.filter((t) => !Array.isArray(data[t]));
      if (faltanArray.length) {
        setRestoreMsg("❌ El archivo no es un respaldo válido de MOMOS (tablas dañadas: " + faltanArray.join(", ") + ")."); return;
      }
      if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
        setRestoreMsg("❌ El archivo no es un respaldo válido de MOMOS (falta la configuración)."); return;
      }
      await restaurarBackup(data);
      setCorruptStorage(false);
      setIncompat(null);
      setVista("Dashboard");
      setRestoreMsg("Backup restaurado correctamente.");
    } catch (err) {
      setRestoreMsg("❌ No se pudo restaurar: " + (err && err.message ? err.message : "formato inválido") + ".");
    }
  }

  if (corruptStorage) {
    return (
      <div className="momos min-h-screen flex items-center justify-center p-6" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-2" aria-hidden="true">🛑</div>
          <div className="display text-lg font-semibold mb-2">No se pudieron leer los datos guardados</div>
          <div className="text-sm" style={{ color: T.choco2 }}>
            La base local de MOMOS OPS parece estar dañada o incompleta. Para proteger tu información, no se cargó la semilla ni se sobrescribieron los datos.
          </div>
          <div className="text-sm mt-3" style={{ color: T.choco2 }}>
            Restaura un respaldo JSON válido o revisa el almacenamiento del navegador antes de continuar.
          </div>
          <div className="mt-4 p-3 rounded-2xl" style={{ background: "#fff", border: "1px solid " + T.border }}>
            <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>♻️ Restaurar respaldo JSON</div>
            <input type="file" accept="application/json" className="text-xs" onChange={(e) => { const f = e.target.files && e.target.files[0]; handleRestoreFile(f); e.target.value = ""; }} />
            {restoreMsg && <div className="text-xs font-bold mt-2" style={{ color: restoreMsg.startsWith("❌") ? "#A03B2A" : "#3F6B42" }}>{restoreMsg}</div>}
          </div>
          <div className="mt-4 text-[11px]" style={{ color: T.choco2 }}>
            Si no tienes respaldo, no borres el almacenamiento todavía. Primero intenta recuperar el JSON guardado desde las herramientas del navegador o pide soporte técnico.
          </div>
        </div>
      </div>
    );
  }

  if (incompat) {
    const actualizacionLista = incompat <= DB_VERSION;
    return (
      <div className="momos min-h-screen flex items-center justify-center p-6" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
          <div className="display text-lg font-semibold mb-2">{actualizacionLista ? "Actualización lista" : "Datos de una versión más nueva"}</div>
          <div className="text-sm" style={{ color: T.choco2 }}>
            {actualizacionLista
              ? `Los datos y esta app ya son compatibles con MOMOS OPS versión ${DB_VERSION}. Recarga para continuar sin modificar tu información.`
              : `Los datos guardados en este dispositivo son de MOMOS OPS versión ${incompat}, más nueva que esta app (versión ${DB_VERSION}). Para no dañar tu información, no se cargó nada.`}
          </div>
          <div className="text-sm mt-3" style={{ color: T.choco2 }}>
            {actualizacionLista
              ? "No necesitas restaurar un respaldo ni borrar los datos del navegador."
              : "Recarga para buscar la versión más reciente de la app. Restaura un respaldo compatible solo si el problema continúa."}
          </div>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl px-4 py-2.5 text-sm font-bold" style={{ background: T.coral, color: "#fff" }}>Recargar MOMOS OPS</button>
          <div className="mt-4 p-3 rounded-2xl" style={{ background: "#fff", border: "1px solid " + T.border }}>
            <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>♻️ Restaurar respaldo JSON compatible</div>
            <input type="file" accept="application/json" className="text-xs" onChange={(e) => { const f = e.target.files && e.target.files[0]; handleRestoreFile(f); e.target.value = ""; }} />
            {restoreMsg && <div className="text-xs font-bold mt-2" style={{ color: restoreMsg.startsWith("❌") ? "#A03B2A" : "#3F6B42" }}>{restoreMsg}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ── Gates de sesión (Fase 3: login real) — van antes del gate de datos ──
  if (session === undefined) {
    return (
      <div className="momos min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">🐱</div>
          <div className="display text-lg font-semibold">MOMOS OPS</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Verificando sesión…</div>
        </div>
      </div>
    );
  }
  if (!session) return <PantallaLogin />;
  if (perfilError) return <PantallaSinPerfil mensaje={perfilError} />;
  if (!perfil) {
    return (
      <div className="momos min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">🐱</div>
          <div className="display text-lg font-semibold">MOMOS OPS</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Cargando tu perfil…</div>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="momos min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">🐱</div>
          <div className="display text-lg font-semibold">MOMOS OPS</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Cargando datos…</div>
        </div>
      </div>
    );
  }

  const roles = normalizeRoles(perfil); // roles reales acumulables del perfil autenticado
  const rol = primaryRole(perfil); // compatibilidad: auditorías y textos conservan un rol principal
  const visibles = MODULOS.filter((m) => hasAnyRole(roles, m.roles));
  const activa = visibles.some((m) => m.id === vista) ? vista : visibles[0].id;
  const navPrincipal = visibles.slice(0, 4);
  const navExtra = visibles.slice(4);
  const user = rol;
  const moduloActivo = visibles.find((m) => m.id === activa) || visibles[0];

  function refrescarVistaActual(context = {}) {
    return hidratarDesdeServidor(syncDomainsForDbView(activa, dbRef.current), { reason: "action", ...context });
  }

  function render() {
    const p = {
      db, update, user, refrescar: refrescarVistaActual, aplicarDeltaInventario,
      capturarGeneracionInventario, solicitarConciliacionInventario,
      aplicarDeltaPedido, aplicarMutacionDomicilio, capturarGeneracionPedidos, solicitarConciliacionPedidos, sincronizarPedidos,
      aplicarDeltaProductoTerminado, capturarGeneracionProductoTerminado, solicitarConciliacionProductoTerminado,
      sincronizarProductoTerminado, aplicarMutacionProduccion, capturarContextoMutacionProduccion,
      aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm,
      perfil, serverDataReady: Boolean(catalogosDe), performanceRouteId: performanceRouteRef.current,
    };
    switch (activa) {
      case "Dashboard": return <BusinessPanel panel="Dashboard" {...p} go={go} />;
      case "Pedidos": return <OrdersPanel section="Pedidos" {...p} focus={focus} />;
      case "Producción": return <Produccion {...p} focus={focus} />;
      case "Empaque": return <OrdersPanel section="Empaque" {...p} />;
      case "Inventario terminado": return <InventarioTerminado {...p} go={go} />;
      case "Inventario": return <Inventario {...p} focus={focus} go={go} />;
      case "Productos": return <BusinessPanel panel="Productos" {...p} go={go} />;
      case "Domicilios": return <BusinessPanel panel="Domicilios" {...p} />;
      case "Reclamos": return <BusinessPanel panel="Reclamos" {...p} focus={focus} />;
      case "Historial operativo": return <BusinessPanel panel="HistorialOperativo" {...p} />;
      case "Clientes": return <BusinessPanel panel="Clientes" {...p} />;
      case "Beneficios": return <BusinessPanel panel="Beneficios" {...p} />;
      case "Crecimiento": return <Crecimiento {...p} go={go} />;
      case "Marketing": return <BusinessPanel panel="Marketing" {...p} />;
      case "Creativos": return <BusinessPanel panel="Creativos" {...p} />;
      case "Calendario": return <BusinessPanel panel="Calendario" {...p} />;
      case "Resultados": return <BusinessPanel panel="ResultadosCreativos" {...p} />;
      case "Finanzas": return <Finanzas {...p} />;
      case "Reportes": return <BusinessPanel panel="Reportes" {...p} />;
      case "Configuración": return <BusinessPanel panel="Configuracion" {...p} resetear={resetear} restaurarBackup={restaurarBackup} />;
      default: return null;
    }
  }

  const syncLabel = { cargando: "Cargando…", guardando: "Guardando…", guardado: "Guardado ✓", local: "Solo en memoria", error: "⚠ No se pudo guardar" }[sync];
  const syncColor = { cargando: T.choco2, guardando: "#96690F", guardado: "#3F6B42", local: "#A03B2A", error: "#A03B2A" }[sync];

  return (
    <div className="momos min-h-screen" style={{ background: T.bg }}>
      <style>{FONTS}</style>
      <Toasts />
      <GlobalKitchenOrderAlerts
        db={db}
        perfil={perfil}
        activeView={vista}
        serverDataReady={Boolean(catalogosDe)}
        onOpenProduction={() => go("Producción")}
        onOpenPacking={() => go("Empaque")}
      />

      <header className="sticky top-0 z-40 border-b" style={{ background: "rgba(250,244,236,.92)", backdropFilter: "blur(8px)", borderColor: T.border }}>
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: `linear-gradient(135deg, ${T.rosa}, ${T.coralSoft})` }} aria-hidden="true">🐱</div>
          <div className="min-w-0">
            <div className="display font-bold leading-none" style={{ fontSize: 18 }}>MOMOS <span style={{ color: T.coral }}>OPS</span></div>
            <div className="text-[11px] font-semibold truncate flex items-center gap-1" style={{ color: T.choco2 }}>
              <span className="hidden sm:inline">D'Momos Sweet Love · El Caney, Cali ·</span>
              <span className="momo-sync" data-state={sync} style={{ color: syncColor }} aria-live="polite">
                <span className="momo-sync-dot" aria-hidden="true" />{syncLabel}
              </span>
              {catalogosDe && <span style={{ color: catalogosDe === "servidor" ? "#3F6B42" : "#96690F" }}> · {catalogosDe === "servidor" ? "servidor ✓" : "caché"}</span>}
              {catalogosDe === "servidor" && <span style={{ color: realtimeStatus === "activo" ? "#3F6B42" : "#96690F" }}> · {realtimeStatus === "activo" ? "tiempo real ✓" : "reconectando"}</span>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold leading-tight">{perfil.nombre}</div>
              <div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{rolesLabel(perfil)}</div>
            </div>
            <button onClick={() => supabase.auth.signOut()}
              className="rounded-xl px-2.5 py-2 text-xs border font-bold" style={inputStyle} aria-label="Cerrar sesión">Salir</button>
          </div>
        </div>
      </header>

      {sync === "error" && (
        <div className="px-4 py-2.5 text-sm font-bold text-center" style={{ background: "#A03B2A", color: "#fff" }}>
          ⚠️ No se pudo guardar: el almacenamiento local está lleno (las fotos ocupan mucho). Exportá un backup y liberá espacio, o perderás los cambios al recargar.
        </div>
      )}

      <div className="max-w-6xl mx-auto flex">
        <nav className="hidden md:flex flex-col gap-1 w-52 shrink-0 p-3 sticky top-[65px] self-start" aria-label="Módulos">
          {visibles.map((m) => (
            <button key={m.id} onClick={() => go(m.id)}
              className="momo-nav-item flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-left"
              data-active={activa === m.id}
              aria-current={activa === m.id ? "page" : undefined}
              style={{ background: activa === m.id ? T.rosa : "transparent", color: activa === m.id ? "#8E4B5A" : T.choco }}>
              <span aria-hidden="true">{m.icon}</span>{m.label || m.id}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 p-4 pb-28 md:pb-8">
          <div key={activa} className="momo-page-enter">
            <div className="flex items-center gap-3 mt-1 mb-5">
              <div className="momo-module-icon w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0"
                style={{ background: `linear-gradient(135deg, ${T.rosa}, ${T.coralSoft})` }} aria-hidden="true">{moduloActivo.icon}</div>
              <div className="min-w-0">
                <h1 className="display text-2xl font-semibold m-0 leading-tight">{moduloActivo.title || moduloActivo.label || activa}</h1>
                <p className="text-xs sm:text-sm font-semibold m-0 mt-0.5" style={{ color: T.choco2 }}>{moduloActivo.hint}</p>
              </div>
            </div>
            {MODULOS_EN_MIGRACION.includes(activa) && <BannerMigracion modulo={activa} />}
            {render()}
          </div>
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t flex" style={{ background: T.surface, borderColor: T.border }} aria-label="Módulos">
        {navPrincipal.map((m) => (
          <button key={m.id} onClick={() => { go(m.id); setMasAbierto(false); }}
            className="momo-mobile-nav flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold"
            data-active={activa === m.id}
            aria-current={activa === m.id ? "page" : undefined}
            style={{ color: activa === m.id ? T.coral : T.choco2 }}>
            <span className="text-lg" aria-hidden="true">{m.icon}</span>{m.label || m.id}
          </button>
        ))}
        {navExtra.length > 0 && (
          <button onClick={() => setMasAbierto(!masAbierto)}
            className="momo-mobile-nav flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold"
            data-active={navExtra.some((m) => m.id === activa)}
            aria-expanded={masAbierto}
            style={{ color: navExtra.some((m) => m.id === activa) ? T.coral : T.choco2 }}>
            <span className="text-lg" aria-hidden="true">➕</span>Más
          </button>
        )}
      </nav>

      {masAbierto && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMasAbierto(false)}>
          <div className="absolute inset-0" style={{ background: "rgba(60,40,30,.35)" }} />
          <div className="absolute bottom-16 left-3 right-3 rounded-3xl p-3 grid grid-cols-3 gap-2 shadow-xl" style={{ background: T.surface }} onClick={(e) => e.stopPropagation()}>
            {navExtra.map((m) => (
              <button key={m.id} onClick={() => { go(m.id); setMasAbierto(false); }}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl text-[11px] font-bold"
                style={{ background: activa === m.id ? T.rosa : T.vainilla, color: activa === m.id ? "#8E4B5A" : T.choco }}>
                <span className="text-xl" aria-hidden="true">{m.icon}</span>{m.label || m.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
