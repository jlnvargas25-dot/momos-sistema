import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { InlineNotice, SegmentedTabs } from "./components/ui/OperationalPrimitives.jsx";
import { supabase } from "./lib/supabase";
import { fetchAgencyCatalogosConFallback, fetchAgencySnapshotEventVersion, fetchCatalogos, fetchOperativo, fetchOperationalHistoryPage, fetchUserProfile } from "./lib/read-model";
import {
  compareAgencySnapshotVersions, createSyncCoordinator, normalizeAgencySnapshotVersion, normalizeSyncDomains,
  shouldQueueAgencySnapshotVersion, shouldQueueRealtimeDomain, syncDomainForTable, syncDomainsForView, SYNC_DOMAINS,
} from "./lib/sync-coordinator";
import {
  setOrderStatusRemoto, setReclamoEstado,
  editarReclamo, crearDomicilio, actualizarDomicilio, upsertCliente, guardarPreferenciasCliente, crearActivacionCliente,
  registrarContactoCliente, convertirActivacionCliente, activarBeneficioCliente,
  crearProducto, editarProducto, setProductoActivo,
  guardarRecetaProducto, sincronizarCostoProducto, crearUsuarioStaff, quitarRolUsuario, setUserActivo, guardarConfiguracionDemoras,
  crearCampana, editarCampana, crearCreativo, editarCreativo, crearPublicacion, setPublicacionEstado,
  registrarMetricasCreativo, guardarPreparacionDistribucion, aprobarDistribucion, cerrarDistribucionPublicacion, autorizarDespachoDistribucion, reintentarDespachoDistribucion
} from "./lib/rpc";
import { canReceiveKitchenDelayReminders, canReceiveKitchenOrderAlerts, kitchenDelayedOrderReminders, kitchenOrderAlert, kitchenOrderStateEvents, kitchenReadyOrderCommands, normalizeKitchenDelaySettings } from "./lib/kitchen-voice";
import { deliveryBlocksNewRequest, ORDER_ROLE_SUMMARY, ORDER_WORKFLOW_ROLES } from "./lib/order-workflow";
import { hasAnyRole, hasRole, normalizeRoles, primaryRole, rolesLabel } from "./lib/user-roles";
import { measureSyncLoad, runtimePerformance } from "./performance/runtime-telemetry";
import { canOperateStage } from "./lib/operational-control";
import { buildCustomerCrm, crmCompleteness } from "./lib/customer-crm";
import { DEFAULT_AGENCY_SETTINGS } from "./lib/agency-intelligence";
import { buildCommercialCalendar, buildPostDraftFromCreative, calendarTransitionGuard } from "./lib/commercial-calendar";
import { buildDistributionRoom, distributionChecklistFor, validateDistributionAction } from "./lib/commercial-distribution";
import { enrichDistributionWithDispatch } from "./lib/commercial-dispatch";
import { buildOperationalHistory, isActiveClaim, isActiveDelivery, partitionByActivity } from "./lib/operational-history";
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

/* ================================================================
   MOMOS OPS v3 — Operación + Agencia Interna de D'Momos Sweet Love
   Base limpia pre-Supabase · Cocina oculta · El Caney, Cali
   Arquitectura: tablas normalizadas + persistencia (window.storage)
   ================================================================ */

const DB_VERSION = 17;
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
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap');
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
const TZ = "America/Bogota";
// "en-CA" produce YYYY-MM-DD; NUNCA usar toISOString para la fecha operativa (daría el día de UTC, no el de Cali)
const fechaISOEnBogota = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
    // Catálogo de figuras: la figura es la FORMA (nombre + especie + gramaje).
    // El sabor es ortogonal: cualquier figura se ofrece en los 11 sabores. No se acoplan.
    figuras: [
      { nombre: "Lizi",  especie: "gato",  gramaje: "150 g" },
      { nombre: "Momo",  especie: "gato",  gramaje: "150 g" },
      { nombre: "Toby",  especie: "gato",  gramaje: "280 g" },
      { nombre: "Teo",   especie: "gato",  gramaje: "280 g" },
      { nombre: "Max",   especie: "perro", gramaje: "150 g" },
      { nombre: "Rocco", especie: "perro", gramaje: "150 g" },
      { nombre: "Danna", especie: "perro", gramaje: "150 g" },
    ],
    pagos: ["Nequi","Daviplata","Bancolombia","Rappi (app)"],
    proveedores: ["Picap","Pibox","Mensajeros Urbanos","Propio","Rappi"],
    pautaMensual: 350000,
    horasCongelacion: 10, // objetivo por defecto (rango operativo 8–12 h)
    demoraCocinaMin: 15,
    demoraCocinaUrgenteMin: 30,
    demoraEmpaqueMin: 10,
    demoraEmpaqueUrgenteMin: 20,
    demoraRepeticionMin: 5,
    politicas: "MOMOS no despacha ningún pedido sin pago confirmado: se requiere comprobante de transferencia (Nequi, Daviplata o Bancolombia) o el pago dentro de la app de Rappi. No se aceptan pagos en efectivo contra entrega. Reclamos por estado del producto: máximo 20 minutos después de recibido, salvo calidad o inocuidad. Un beneficio por pedido, no acumulable, no aplica sobre domicilio.",
  };

  // tipo: 'momo' = unidad con stock terminado · 'combo' = disponibilidad calculada · 'pedido' = se prepara al momento
  const products = [
    { id: "PR01", nombre: "Momo Gatito 150 g", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 18000, precioRappi: 23000, costo: 6800, stock: 8, prep: 20, frio: true, lejano: false, activo: true, desc: "Figura de mousse helado en forma de gatito, base crocante y salsa a elección.", atributos: ["sabor","salsa","figura"] },
    { id: "PR02", nombre: "Momo Perrito 150 g", cat: "Momos Signature", tipo: "momo", especie: "perro", precio: 18000, precioRappi: 23000, costo: 6800, stock: 6, prep: 20, frio: true, lejano: false, activo: true, desc: "Figura de mousse helado en forma de perrito, base crocante y salsa a elección.", atributos: ["sabor","salsa","figura"] },
    { id: "PR03", nombre: "Momo grande 190 g", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 23000, precioRappi: 29000, costo: 8900, stock: 4, prep: 25, frio: true, lejano: false, activo: true, desc: "Momo de 190 g con doble salsa y relleno a elección.", atributos: ["sabor","salsa","figura"] },
    { id: "PR04", nombre: "Momo premium 280 g", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 32000, precioRappi: 39000, costo: 12500, stock: 3, prep: 30, frio: true, lejano: false, activo: true, desc: "Momo premium 280 g con relleno doble, ideal para regalo.", atributos: ["sabor","salsa","figura"] },
    { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 3, componentProductIds: ["PR01","PR02"], empaqueItem: "I08", precio: 49000, precioRappi: 59000, costo: 22500, prep: 35, frio: true, lejano: false, activo: true, desc: "Caja regalo con 3 momos surtidos, sticker y lazo. Disponibilidad según momos y cajas.", atributos: ["sabor","salsa"] },
    { id: "PR06", nombre: "Caja x4 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 4, componentProductIds: ["PR01","PR02"], empaqueItem: "I13", precio: 63000, precioRappi: 75000, costo: 29500, prep: 40, frio: true, lejano: false, activo: true, desc: "Caja regalo con 4 momos surtidos.", atributos: ["sabor","salsa"] },
    { id: "PR07", nombre: "Caja x6 Momos", cat: "Cajas y Combos", tipo: "combo", comboSize: 6, componentProductIds: ["PR01","PR02"], empaqueItem: "I14", precio: 89000, precioRappi: 105000, costo: 43000, prep: 45, frio: true, lejano: false, activo: true, desc: "Caja premium con 6 momos surtidos para celebraciones.", atributos: ["sabor","salsa"] },
    { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo", especie: "gato", precio: 15000, precioRappi: 19000, costo: 5200, stock: 12, prep: 10, frio: true, lejano: true, activo: true, desc: "Cheesecake en vaso con figurita horizontal y salsa.", atributos: ["sabor","salsa","figura"] },
    { id: "PR09", nombre: "Crepa Momo Nutella", cat: "Momos Antojos", tipo: "pedido", precio: 14000, precioRappi: 18000, costo: 4800, prep: 12, frio: false, lejano: true, activo: true, desc: "Crepa con Nutella, banano y topping de momo mini. Se prepara al momento.", atributos: [] },
    { id: "PR10", nombre: "Crepa Momo Oreo", cat: "Momos Antojos", tipo: "pedido", precio: 14000, precioRappi: 18000, costo: 4600, prep: 12, frio: false, lejano: true, activo: true, desc: "Crepa con crema de Oreo y galleta triturada. Se prepara al momento.", atributos: [] },
    { id: "PR11", nombre: "Malteada Oreo Momo", cat: "Momos Bebidas", tipo: "pedido", precio: 13000, precioRappi: 16500, costo: 4200, prep: 8, frio: true, lejano: false, activo: true, desc: "Malteada cremosa de Oreo con crema batida.", atributos: [] },
    { id: "PR12", nombre: "Malteada Nutella Momo", cat: "Momos Bebidas", tipo: "pedido", precio: 13500, precioRappi: 17000, costo: 4500, prep: 8, frio: true, lejano: false, activo: true, desc: "Malteada de Nutella con crema y chocolate rallado.", atributos: [] },
    { id: "PR13", nombre: "Granizado de maracuyá", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado natural de maracuyá.", atributos: [] },
    { id: "PR14", nombre: "Granizado de mango biche", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado de mango biche con sal y limón opcional.", atributos: [] },
    { id: "PR15", nombre: "Granizado de durazno", cat: "Momos Bebidas", tipo: "pedido", precio: 9000, precioRappi: 12000, costo: 2600, prep: 6, frio: true, lejano: false, activo: true, desc: "Granizado dulce de durazno.", atributos: [] },
  ];

  const customers = [
    { id: "C01", nombre: "Valentina Ríos", telefono: "3104567890", instagram: "@valen.rios", barrio: "El Caney", direccion: "Cra 85C #48-30, torre 2 apto 402", canal: "Instagram", primera: dISO(-115), ultima: hoyISO(), total: 214000, pedidos: 6, cumple: cumpleEn(13), favoritos: "Maracuyá · Gatito", estado: "VIP", notas: "Siempre pide gatito de maracuyá. Sube historias con frecuencia." },
    { id: "C02", nombre: "Andrés Cabal", telefono: "3159876543", instagram: "@andrescabal", barrio: "El Ingenio", direccion: "Cra 83 #14-21", canal: "WhatsApp", primera: dISO(-64), ultima: dISO(-1), total: 96000, pedidos: 3, cumple: "11-02", favoritos: "Oreo · Perrito", estado: "Recurrente", notas: "" },
    { id: "C03", nombre: "Laura Sepúlveda", telefono: "3001234567", instagram: "@lau.sep", barrio: "Valle del Lili", direccion: "Cra 98 #42-05, casa 12", canal: "Rappi", primera: dISO(-7), ultima: dISO(-7), total: 39000, pedidos: 1, cumple: cumpleEn(4), favoritos: "Nutella", estado: "Nuevo", notas: "Llegó por Rappi, pedir Instagram en próxima entrega." },
    { id: "C04", nombre: "Camilo Torres", telefono: "3186543210", instagram: "", barrio: "El Limonar", direccion: "Calle 13A #66-40", canal: "WhatsApp", primera: dISO(-86), ultima: dISO(-46), total: 128000, pedidos: 4, cumple: "01-25", favoritos: "Milo · Perrito", estado: "Inactivo", notas: "No compra hace más de 30 días. Enviar beneficio de reactivación." },
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
    { id: "IT01", orderId: "P-1041", productId: "PR01", nombre: "Momo Gatito 150 g", sabor: "Maracuyá", salsa: "Frutos rojos", relleno: "Cheesecake con ganache", figura: "Gatito", cant: 2, precio: 18000 },
    { id: "IT02", orderId: "P-1041", productId: "PR11", nombre: "Malteada Oreo Momo", sabor: "Oreo", salsa: "", relleno: "", figura: "", cant: 1, precio: 13000 },
    { id: "IT03", orderId: "P-1042", productId: "PR05", nombre: "Caja x3 Momos", sabor: "Surtido frutal", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Gatito y perrito", cant: 1, precio: 49000 },
    { id: "IT04", orderId: "P-1043", productId: "PR08", nombre: "Cheesecake Momo cuchareable", sabor: "Durazno", salsa: "Frutos rojos", relleno: "Cheesecake con ganache", figura: "Gatito horizontal", cant: 2, precio: 19000 },
    { id: "IT05", orderId: "P-1044", productId: "PR02", nombre: "Momo Perrito 150 g", sabor: "Oreo", salsa: "Chocolate", relleno: "Cheesecake con ganache", figura: "Perrito", cant: 1, precio: 18000 },
    { id: "IT06", orderId: "P-1044", productId: "PR13", nombre: "Granizado de maracuyá", sabor: "Maracuyá", salsa: "", relleno: "", figura: "", cant: 2, precio: 9000 },
    { id: "IT07", orderId: "P-1040", productId: "PR03", nombre: "Momo grande 190 g", sabor: "Milo", salsa: "Arequipe", relleno: "Cheesecake con ganache", figura: "Osito", cant: 1, precio: 23000 },
    { id: "IT08", orderId: "P-1039", productId: "PR09", nombre: "Crepa Momo Nutella", sabor: "Nutella", salsa: "Chocolate", relleno: "", figura: "", cant: 2, precio: 14000 },
    { id: "IT09", orderId: "P-1045", productId: "PR04", nombre: "Momo premium 280 g", sabor: "Caramelo salado", salsa: "Lechera", relleno: "Cheesecake con ganache", figura: "Corazón", cant: 1, precio: 32000 },
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
    { id: "L-018", fecha: hoyISO(), producto: "Momo Gatito 150 g", figura: "Gatito", sabor: "Maracuyá", relleno: "Cheesecake con ganache", salsa: "Frutos rojos", gramaje: "150 g", prod: 12, perfectas: 10, imperfectas: 1, descartadas: 1, destino: "Insumo para malteadas", resp: "Karen", vence: "", desmoldadoEn: "", estado: "Congelando", stockContabilizado: false, horasCongelacion: 10, inicioCongelacion: selloHaceHoras(6), obs: "Molde nuevo, mejor definición de orejas." },
    { id: "L-017", fecha: dISO(-1), producto: "Momo Perrito 150 g", figura: "Perrito", sabor: "Oreo", relleno: "Cheesecake con ganache", salsa: "Chocolate", gramaje: "150 g", prod: 10, perfectas: 9, imperfectas: 1, descartadas: 0, destino: "Prueba interna", resp: "Karen", vence: dISO(2), desmoldadoEn: dISO(-1) + " 10:00:00", estado: "Listo", stockContabilizado: true, obs: "" },
    { id: "L-016", fecha: dISO(-2), producto: "Momo premium 280 g", figura: "Corazón", sabor: "Caramelo salado", relleno: "Cheesecake con ganache", salsa: "Lechera", gramaje: "280 g", prod: 6, perfectas: 5, imperfectas: 0, descartadas: 1, destino: "—", resp: "Julián", vence: dISO(1), desmoldadoEn: dISO(-2) + " 11:00:00", estado: "Listo", stockContabilizado: true, obs: "Una pieza se fracturó al desmoldar." },
    { id: "L-015", fecha: dISO(-3), producto: "Cheesecake Momo cuchareable", figura: "Gatito horizontal", sabor: "Durazno", relleno: "Cheesecake con ganache", salsa: "Frutos rojos", gramaje: "160 g", prod: 15, perfectas: 15, imperfectas: 0, descartadas: 0, destino: "—", resp: "Karen", vence: dISO(0), desmoldadoEn: dISO(-3) + " 09:00:00", estado: "Reservado", stockContabilizado: false, obs: "Reservado parcial para pedidos de Rappi." },
    { id: "L-014", fecha: dISO(-4), producto: "Momo grande 190 g", figura: "Osito", sabor: "Milo", relleno: "Cheesecake con ganache", salsa: "Arequipe", gramaje: "190 g", prod: 8, perfectas: 6, imperfectas: 2, descartadas: 0, destino: "Insumo para crepas", resp: "Julián", vence: dISO(-1), desmoldadoEn: dISO(-4) + " 09:30:00", estado: "Vendido", stockContabilizado: false, obs: "" },
  ];

  const inventory_items = [
    { id: "I01", nombre: "Crema de leche 1 L", cat: "Ingredientes", unidad: "L", stock: 8, min: 6, costo: 11500, proveedor: "Distribuidora La Vaquita", vence: dISO(9), ubicacion: "Nevera 1", compra: dISO(-4) },
    { id: "I02", nombre: "Base mousse maracuyá", cat: "Bases de mousse", unidad: "kg", stock: 2.5, min: 3, costo: 18000, proveedor: "Producción propia", vence: dISO(5), ubicacion: "Congelador A", compra: dISO(-2) },
    { id: "I03", nombre: "Salsa frutos rojos", cat: "Salsas", unidad: "L", stock: 1.2, min: 1, costo: 22000, proveedor: "Producción propia", vence: dISO(7), ubicacion: "Nevera 2", compra: dISO(-3) },
    { id: "I04", nombre: "Nutella 3 kg", cat: "Rellenos", unidad: "kg", stock: 1.8, min: 1, costo: 32000, proveedor: "Makro", vence: dISO(120), ubicacion: "Estante seco", compra: dISO(-10) },
    { id: "I05", nombre: "Ganache de chocolate", cat: "Ganache", unidad: "kg", stock: 0.8, min: 1, costo: 26000, proveedor: "Producción propia", vence: dISO(4), ubicacion: "Nevera 2", compra: dISO(-2) },
    { id: "I06", nombre: "Mezcla de crepa", cat: "Mezcla de crepa", unidad: "L", stock: 3, min: 2, costo: 9000, proveedor: "Producción propia", vence: dISO(3), ubicacion: "Nevera 1", compra: dISO(-1) },
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
    { id: "S-02", fecha: hoyISO(), producto: "Momo premium 280 g", cantidad: 4, motivo: "Stock por debajo de la demanda semanal", orderId: "", estado: "Pendiente", area: "Producción", itemId: "" },
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
    { id: "CMP-01", nombre: "Lanzamiento Gatitos MOMOS", canal: "Instagram", objetivo: "Lanzamiento", productoFoco: "Momo Gatito 150 g", oferta: "2x1 primer pedido", fechaInicio: dISO(-20), fechaFin: dISO(10), presupuesto: 250000, gastoReal: 180000, estado: "Activa", responsable: "Marketing", notas: "Campaña insignia de apertura de la cocina oculta." },
    { id: "CMP-02", nombre: "Caja regalo x3", canal: "Facebook", objetivo: "Ventas", productoFoco: "Caja x3 Momos", oferta: "Envío gratis zona 1", fechaInicio: dISO(-12), fechaFin: dISO(6), presupuesto: 150000, gastoReal: 95000, estado: "Activa", responsable: "Marketing", notas: "Enfocada en regalos y fechas especiales." },
    { id: "CMP-03", nombre: "Historia + etiqueta = malteada gratis", canal: "Instagram", objetivo: "Recompra", productoFoco: "Malteada Oreo Momo", oferta: "Malteada gratis por historia", fechaInicio: dISO(-8), fechaFin: dISO(14), presupuesto: 60000, gastoReal: 20000, estado: "Activa", responsable: "Marketing", notas: "Beneficio conectado al módulo de Beneficios." },
    { id: "CMP-04", nombre: "Reactivación clientes 30 días", canal: "WhatsApp", objetivo: "Recompra", productoFoco: "Momo Perrito 150 g", oferta: "30% descuento reactivación", fechaInicio: dISO(-5), fechaFin: dISO(20), presupuesto: 40000, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "Segmentar clientes inactivos del CRM." },
  ];

  // ---- Marketing: creativos ----
  const creatives = [
    { id: "CRE-01", campaignId: "CMP-01", titulo: "Adopta tu Momo favorito", canal: "Instagram", formato: "Reel", productoFoco: "Momo Gatito 150 g", figuraFoco: "Gatito", saborFoco: "Maracuyá", hook: "Da pesar comerlos… hasta la primera cucharada", copy: "Gatitos de mousse helado hechos a mano en Cali. Adopta el tuyo hoy 🐱", guion: "Plano 1: caja abriéndose. Plano 2: cuchara rompiendo el mousse. Plano 3: reacción.", estado: "Ganador", responsable: "Karen", fechaEntrega: dISO(-18), assetUrl: "", notas: "El reel con mejor retención." },
    { id: "CRE-02", campaignId: "CMP-02", titulo: "El regalo más tierno de Cali", canal: "Facebook", formato: "Carrusel", productoFoco: "Caja x3 Momos", figuraFoco: "Gatito y perrito", saborFoco: "Surtido", hook: "El regalo más tierno de Cali", copy: "Sorprende con una caja de 3 momos surtidos. Envolvemos con lazo y tarjeta 🎁", guion: "", estado: "Publicado", responsable: "Marketing", fechaEntrega: dISO(-10), assetUrl: "", notas: "" },
    { id: "CRE-03", campaignId: "CMP-01", titulo: "Gatitos de mousse helado para regalar", canal: "Instagram", formato: "Historia", productoFoco: "Momo Gatito 150 g", figuraFoco: "Gatito", saborFoco: "Coco", hook: "Gatitos de mousse helado para regalar", copy: "Desliza hacia arriba y pide el tuyo 👆", guion: "", estado: "Publicado", responsable: "Karen", fechaEntrega: dISO(-6), assetUrl: "", notas: "" },
    { id: "CRE-04", campaignId: "CMP-03", titulo: "Sube tu historia y gana", canal: "Instagram", formato: "Historia", productoFoco: "Malteada Oreo Momo", figuraFoco: "", saborFoco: "Oreo", hook: "Etiquétanos y tu malteada va por la casa", copy: "Sube una historia con tu momo, etiquétanos y reclama tu malteada gratis 🥤", guion: "", estado: "Aprobado", responsable: "Marketing", fechaEntrega: dISO(-2), assetUrl: "", notas: "Listo para publicar esta semana." },
    { id: "CRE-05", campaignId: "CMP-01", titulo: "UGC clienta Ciudad Jardín", canal: "TikTok", formato: "Video UGC", productoFoco: "Momo Gatito 150 g", figuraFoco: "Gatito", saborFoco: "Maracuyá", hook: "Me llegó el gatito más lindo de Cali", copy: "", guion: "Cliente real mostrando la entrega y la primera cucharada.", estado: "En revisión", responsable: "Karen", fechaEntrega: dISO(1), assetUrl: "", notas: "Esperando aprobación de la clienta." },
    { id: "CRE-06", campaignId: "CMP-02", titulo: "Foto producto caja premium", canal: "Instagram", formato: "Foto producto", productoFoco: "Caja x6 Momos", figuraFoco: "Surtido", saborFoco: "Surtido", hook: "", copy: "", guion: "", estado: "En diseño", responsable: "Marketing", fechaEntrega: dISO(3), assetUrl: "", notas: "" },
    { id: "CRE-07", campaignId: "CMP-04", titulo: "Copy reactivación WhatsApp", canal: "WhatsApp", formato: "Copy", productoFoco: "Momo Perrito 150 g", figuraFoco: "Perrito", saborFoco: "", hook: "Te extrañamos 💗", copy: "¡Hola! Hace un mes no te consentimos. Tienes 30% en tu próximo momo, solo por hoy.", guion: "", estado: "Idea", responsable: "Marketing", fechaEntrega: dISO(4), assetUrl: "", notas: "" },
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
    { id: "ID-01", titulo: "Da pesar comerlos… hasta la primera cucharada", cat: "Ideas tiernas", objetivo: "vender", productoSugerido: "Momo Gatito 150 g", copy: "Da pesar comerlos… hasta la primera cucharada 🥺🐱 Adopta el tuyo por WhatsApp.", guionCorto: "Muestra el gatito completo, luego la cuchara entrando al mousse.", canal: "Instagram", estado: "Ganadora" },
    { id: "ID-02", titulo: "Adopta tu Momo favorito", cat: "Ideas tiernas", objetivo: "vender", productoSugerido: "Momo Perrito 150 g", copy: "Adopta tu Momo favorito 🐶🐱 gatitos y perritos de mousse helado, hechos en Cali.", guionCorto: "Fila de momos surtidos, la mano elige uno.", canal: "TikTok", estado: "Repetir" },
    { id: "ID-03", titulo: "Caja x3 para regalar", cat: "Ideas de regalo", objetivo: "regalo", productoSugerido: "Caja x3 Momos", copy: "El regalo más tierno de Cali 🎁 Caja x3 MOMOS con lazo y tarjeta. Pide la tuya.", guionCorto: "Caja cerrada, se abre lento y aparecen los 3 momos.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-04", titulo: "Gatitos de mousse helado", cat: "Ideas para vender", objetivo: "seguidores", productoSugerido: "Momo Gatito 150 g", copy: "Gatitos de mousse helado 🐱💛 el antojo que te cambia el día.", guionCorto: "Primer plano de la carita del gatito.", canal: "TikTok", estado: "Usada" },
    { id: "ID-05", titulo: "Perritos MOMOS para cumpleaños", cat: "Ideas para cumpleaños", objetivo: "cumpleaños", productoSugerido: "Momo Perrito 150 g", copy: "¿Cumple de alguien especial? 🎂 Regálale un perrito MOMOS y sorpréndelo.", guionCorto: "Perrito con velita encima.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-06", titulo: "Historia + etiqueta = malteada gratis", cat: "Ideas para que etiqueten a MOMOS", objetivo: "historias etiquetadas", productoSugerido: "Malteada Oreo Momo", copy: "Sube una historia con tu MOMOS, etiquétanos y tu malteada va por la casa 🥤💛", guionCorto: "Cliente etiquetando la cuenta en su historia.", canal: "Instagram", estado: "Ganadora" },
    { id: "ID-07", titulo: "Así nacen los gatitos", cat: "Ideas para mostrar proceso", objetivo: "seguidores", productoSugerido: "Momo Gatito 150 g", copy: "Así nacen los gatitos MOMOS 🐱 todo hecho a mano, con amor y mousse helado.", guionCorto: "Timelapse del desmolde y decorado.", canal: "TikTok", estado: "Nueva" },
    { id: "ID-08", titulo: "Nuevo sabor: coco", cat: "Ideas para sabores", objetivo: "vender", productoSugerido: "Momo Gatito 150 g", copy: "¡Nuevo sabor! 🥥 Gatito de coco, cremoso y tropical. Solo esta semana.", guionCorto: "Cuchara mostrando el relleno de coco.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-09", titulo: "Te extrañamos, vuelve por tu MOMOS", cat: "Ideas para clientes que ya compraron", objetivo: "recompra", productoSugerido: "Momo Gatito 150 g", copy: "Hace rato no te consentimos 💛 vuelve por tu MOMOS favorito, te separamos uno.", guionCorto: "Momo con mensaje 'te extrañamos'.", canal: "WhatsApp", estado: "Nueva" },
    { id: "ID-10", titulo: "Especial de fin de semana", cat: "Ideas para fechas especiales", objetivo: "vender", productoSugerido: "Caja x3 Momos", copy: "Plan de finde: MOMOS a domicilio 🛵💛 pide antes de las 5 pm y disfruta.", guionCorto: "Caja llegando a la puerta.", canal: "Instagram", estado: "Nueva" },
    { id: "ID-11", titulo: "Nueva figura: osito", cat: "Ideas para productos nuevos", objetivo: "vender", productoSugerido: "Momo grande 190 g", copy: "¡Llegó el osito MOMOS! 🐻 nuevo integrante de la familia. Adóptalo ya.", guionCorto: "Presentación del osito girando.", canal: "TikTok", estado: "Nueva" },
    { id: "ID-12", titulo: "El regalo más tierno de Cali", cat: "Ideas de regalo", objetivo: "regalo", productoSugerido: "Caja x6 Momos", copy: "El regalo más tierno de Cali 🎁 sorprende con una caja x6 MOMOS.", guionCorto: "Persona recibiendo la caja emocionada.", canal: "Instagram", estado: "Repetir" },
  ];

  // ---- Crecimiento: guiones fáciles ----
  const marketing_guiones = [
    { id: "GU-01", titulo: "Da pesar comerlos… hasta la primera cucharada", duracion: "15 seg", productoFoco: "Momo Gatito 150 g", objetivo: "vender", dificultad: "Fácil", escena1: "Muestra el Momo gatito completo sobre la mano.", escena2: "Acercamiento a la carita del gatito.", escena3: "La cuchara entra lentamente al mousse.", escena4: "Muestra el relleno por dentro.", textoPantalla: "Pide el tuyo por WhatsApp 💛", audio: "Audio tierno o trend suave de moda" },
    { id: "GU-02", titulo: "Abre la caja x3", duracion: "20 seg", productoFoco: "Caja x3 Momos", objetivo: "regalo", dificultad: "Fácil", escena1: "Caja cerrada con el lazo.", escena2: "Manos abriendo la caja lentamente.", escena3: "Se ven los 3 momos surtidos.", escena4: "Primer plano de cada figura.", textoPantalla: "El regalo más tierno de Cali 🎁", audio: "Música alegre suave" },
    { id: "GU-03", titulo: "Así se hace un MOMOS", duracion: "30 seg", productoFoco: "Momo Gatito 150 g", objetivo: "seguidores", dificultad: "Medio", escena1: "Vertido del mousse en el molde.", escena2: "Al congelador (timelapse).", escena3: "Desmolde del gatito.", escena4: "Decorado de la carita y salsa.", textoPantalla: "Hecho a mano, con amor 💛", audio: "Audio satisfactorio / ASMR" },
    { id: "GU-04", titulo: "Reto historia + etiqueta", duracion: "10 seg", productoFoco: "Malteada Oreo Momo", objetivo: "historias etiquetadas", dificultad: "Fácil", escena1: "Muestra la malteada.", escena2: "Texto: sube tu historia y etiquétanos.", escena3: "Muestra el momo junto a la malteada.", escena4: "", textoPantalla: "Tu malteada va por la casa 🥤", audio: "Trend del momento" },
    { id: "GU-05", titulo: "Perrito para cumpleaños", duracion: "15 seg", productoFoco: "Momo Perrito 150 g", objetivo: "cumpleaños", dificultad: "Fácil", escena1: "Perrito con una velita encima.", escena2: "Se enciende la velita.", escena3: "Alguien pide un deseo.", escena4: "Primer plano del perrito.", textoPantalla: "Sorprende en su cumple 🎂", audio: "Cumpleaños suave / tierno" },
  ];

  // ---- Crecimiento: mensajes listos de WhatsApp ----
  const marketing_mensajes = [
    { id: "MSG-01", tipo: "Cliente nuevo", texto: "¡Hola! 💛 Bienvenido a D'Momos Sweet Love 🐱 Tenemos gatitos y perritos de mousse helado, cheesecakes y más. ¿Te muestro el menú de hoy?" },
    { id: "MSG-02", tipo: "Cliente que preguntó precio", texto: "¡Hola! 💛 El Momo gatito está en $18.000 y la caja x3 en $49.000. Todos hechos a mano. ¿Te separo uno para hoy?" },
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

  return { version: DB_VERSION, settings, products, customers, orders, order_items, production_batches, inventory_items, inventory_movements, deliveries, evidences, claims, benefits, audit_logs, production_suggestions, recipes, inventory_reservations: [], users: seedUsers(), campaigns, creatives, content_calendar, creative_results, agencySnapshotReady: false, agencySnapshotVersion: "", agencyBrandIdentity: null, content_distributions: [], distributionConnectorReady: false, distributionConnectorJobs: [], brandMediaReady: false, mundoAnimadoReady: false, officialLogoDeletionReady: false, mcpHumanApprovalReady: false, mcpHumanApprovals: [], brandMediaAssets: [], creativeGenerationJobs: [], brandMediaUsages: [], agencyIntegrationsReady: false, agencyIntegrations: [], creativeConnectorRuns: [], higgsfieldConnectorReady: false, klingConnectorReady: false, agencyMetaConnectorReady: false, agencyMetaConnectorDryRuns: [], agencyCollaborationReady: false, agencyCollaborationRooms: [], agencyCollaborationEntries: [], agencyCreativeContracts: [], agencySceneStudioReady: false, agencyStoryboards: [], agencyStoryboardShots: [], agencyMotionReady: false, agencyMotionPlans: [], agencyMotionRecipes: [], agencyMotionObservations: [], agencySceneRouterReady: false, agencySceneRoutingPlans: [], agencyQualityReady: false, agencySceneQualityReviews: [], agencyPostproductionPackages: [], agencyPostproductionExportReady: false, agencyPostproductionExports: [], agencyPostproductionWorkers: [], agencyPostproductionAudioReady: false, agencyPostproductionAudioBindings: [], agencyRetentionReady: false, agencyRetentionScripts: [], agencyRetentionHooks: [], agencyRetentionLoops: [], agencyRetentionExperiments: [], agencyRetentionMeasurements: [], agencyLoopLearningReady: false, agencyRetentionDiagnostics: [], agencyRetentionLearnings: [], agencyMetaReady: false, agencyMetaPolicies: [], agencyMetaSnapshots: [], agencyMetaDiagnostics: [], agencyMetaIncrementalityReady: false, agencyMetaLiftStudies: [], agencyMetaLiftMeasurements: [], agencyMetaInvestmentReady: false, agencyMetaInvestmentScenarios: [], agencyMetaAuthorizationReady: false, agencyMetaInvestmentAuthorizations: [], agencyMetaInvestmentExecutionJobs: [], agencyBrandGovernanceReady: false, agencyBrandProfile: null, agencyBrandGateBindings: [], agencyGrowthReady: false, agencyGrowthPolicies: [], agencyGrowthSnapshots: [], agencyGrowthSelections: [], agencyCreativeFlowReady: false, agencyMasterReleases: [], agencyMasterReleaseEvents: [], marketing_ideas, marketing_guiones, marketing_mensajes, brand_library, marketing_tasks };
}

/* ---- Atributos derivados del tipo (ÚNICA fuente de verdad) ----
   Los atributos que un producto pide al venderse dependen SOLO de su tipo.
   No hay override manual: un granizado (pedido) jamás puede pedir salsa/figura.
   momo → sabor+salsa+figura · combo → sabor+salsa · pedido → ninguno. */
function atributosDeTipo(tipo) {
  if (tipo === "pedido") return [];
  if (tipo === "combo") return ["sabor", "salsa"];
  return ["sabor", "salsa", "figura"]; // momo
}
const ATRIBUTO_LABEL = { sabor: "Sabor", salsa: "Salsa", figura: "Figura" };

/* ---- Migraciones entre versiones (no se pierden datos del usuario) ---- */
function normalizeDbShape(d) {
  const s = seedDb();
  const arrayTables = [
    "orders", "order_items", "customers", "products", "production_batches",
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
  d.agencySnapshotReady = d.agencySnapshotReady === true;
  d.agencySnapshotVersion = normalizeAgencySnapshotVersion(d.agencySnapshotVersion);
  if (!d.agencyBrandIdentity || typeof d.agencyBrandIdentity !== "object" || Array.isArray(d.agencyBrandIdentity)) d.agencyBrandIdentity = null;
  d.products.forEach((p) => { p.atributos = atributosDeTipo(p.tipo); }); // siempre derivado del tipo; sin override manual
  // Combos reales: cada momo tiene especie (gato/perro). El stock vive a nivel especie; backfill por nombre.
  d.products.forEach((p) => { if (p.tipo === "momo" && p.especie !== "perro" && p.especie !== "gato") p.especie = /perr/i.test(p.nombre || "") ? "perro" : "gato"; });
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
  d.settings.figuras = d.settings.figuras
    .map((f) =>
      typeof f === "string"
        ? { nombre: f, especie: /perr/i.test(f) ? "perro" : "gato", gramaje: "150 g" }
        : { nombre: (f.nombre || "").trim(), especie: f.especie === "perro" ? "perro" : "gato", gramaje: f.gramaje || "150 g" }
    )
    .filter((f) => f.nombre);
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

async function dbLoad(storageKey = DB_KEY) {
  try {
    const r = await storage.get(storageKey);
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

async function dbPersist(db, storageKey = DB_KEY) {
  try { await storage.set(storageKey, JSON.stringify(db)); return true; }
  catch (e) { console.error("No se pudo guardar:", e); return false; }
}

async function dbReset(storageKey = DB_KEY) {
  try { await storage.delete(storageKey); } catch (e) {}
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
const lineAdicionesTotal = (i) => lineAdiciones(i).reduce((a, ad) => a + (+ad.precio || 0) * (+ad.cant || 1) * (+i.cant || 1), 0);
// Suma de toppings de los sub-momos de una línea combo en NuevoPedido (aún no persistidos como hijas; cada slot = 1 momo).
const boxesAdicionesTotal = (l) => (l.boxes || []).reduce((s, box) => s + box.reduce((ss, sl) => ss + lineAdicionesTotal({ adiciones: sl.adiciones, cant: 1 }), 0), 0);
// Congela el costo del insumo de cada adición al crear el pedido: el COGS histórico no se mueve si cambia el
// precio del insumo, y sobrevive aunque el insumo se borre. Fallback al costo en vivo (en el read) para filas viejas.
const snapAdiciones = (d, adiciones) => (Array.isArray(adiciones) ? adiciones : []).map((ad) =>
  ad.insumoId ? { ...ad, insumoCosto: +((d.inventory_items.find((x) => x.id === ad.insumoId) || {}).costo) || 0 } : ad);
const orderSubtotal = (db, o) => itemsOf(db, o.id).reduce((s, i) => s + i.precio * i.cant + lineAdicionesTotal(i), 0);
const orderTotal = (db, o) => orderSubtotal(db, o) - (o.descuento || 0) + (o.domCobrado || 0);
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

const momoUnitStock = (db) => db.products.filter((p) => p.tipo === "momo" && p.cat === "Momos Signature").reduce((s, p) => s + (p.stock || 0), 0);

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

// Disponibilidad real: unidades con stock, combos calculados por momos + cajas, resto bajo pedido
// Stock de momos que sirven como componentes de un combo (solo los componentProductIds definidos)
function comboComponentStock(db, p) {
  const ids = p.componentProductIds || [];
  const comps = db.products.filter((x) => ids.includes(x.id));
  return comps.reduce((s, x) => s + (x.stock || 0), 0);
}

// --- Combos reales: la figura de cada slot mapea a una ESPECIE, y la especie al momo-componente ---
// El stock de momos vive a nivel especie (PR01 = pool gato, PR02 = pool perro), NO por figura.
function momoEspecie(p) {
  if (!p) return "gato";
  if (p.especie === "perro" || p.especie === "gato") return p.especie;
  return /perr/i.test(p.nombre || "") ? "perro" : "gato"; // retro-compat: deriva del nombre
}
function figuraEspecie(db, nombre) {
  const f = (db.settings.figuras || []).find((x) => x.nombre === nombre);
  return f ? f.especie : "gato";
}
// El momo-componente del combo cuya especie coincide con la figura del slot (descuento exacto).
function componentProductForFigura(db, combo, figuraNombre) {
  const esp = figuraEspecie(db, figuraNombre);
  const comps = (db.products || []).filter((p) => (combo.componentProductIds || []).includes(p.id));
  return comps.find((p) => momoEspecie(p) === esp) || comps[0] || null;
}
// Figuras ofrecibles en un combo: solo las de especies presentes entre sus componentes.
function figurasDeCombo(db, combo) {
  const ids = combo.componentProductIds || [];
  const especies = new Set((db.products || []).filter((p) => ids.includes(p.id)).map((p) => momoEspecie(p)));
  return (db.settings.figuras || []).filter((f) => especies.has(f.especie));
}
// Faltante por ESPECIE de un combo ya compuesto (boxes): demanda por momo-componente vs su stock.
// Necesario porque `availability` mira el POOL combinado, pero reserveInventory descuenta la especie
// EXACTA de cada figura → si el usuario concentra una especie agotada, el pool "alcanza" pero la
// especie no. Devuelve [] si todo alcanza; si no, [{nombre, falta}] por componente corto.
function comboFaltantesEspecie(db, combo, boxes) {
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
  if (p.tipo === "momo") return p.stock || 0;
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

// Stock disponible del producto foco de una campaña (por nombre)
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
        texto: `Estás promocionando "${c.productoFoco}" pero no tienes stock. Repón antes de seguir invirtiendo.`,
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
    if (p.tipo === "momo") {
      const toma = Math.min(p.stock, it.cant);
      p.stock -= toma;
      addReservation(db, order.id, "producto", p.id, p.nombre, toma);
      if (toma < it.cant) faltantes.push({ producto: p.nombre, cant: it.cant - toma, area: "Producción" });
    } else if (p.tipo === "combo") {
      // Combos reales: si la caja tiene sub-momos (hijas con parentItemId), cada hija se descuenta
      // sola por la rama "momo" de arriba (especie EXACTA del slot) → se salta el pull genérico.
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

function GlobalKitchenOrderAlerts({ db, perfil, serverDataReady, onOpenProduction, onOpenPacking }) {
  const operationalRoles = normalizeRoles(perfil);
  const operationalRolesKey = operationalRoles.join("|");
  const canSeeKitchenCommands = hasAnyRole(operationalRoles, ["Administrador", "Cocina"]);
  const canSeePackingCommands = hasAnyRole(operationalRoles, ["Administrador", "Empaque"]);
  const orderAlertsEnabled = canReceiveKitchenOrderAlerts(operationalRoles);
  const delayAlertsEnabled = canReceiveKitchenDelayReminders(operationalRoles);
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

function Dashboard({ db, go, user }) {
  const [tick, setTick] = useState(0);
  const [assistantCenterOpen, setAssistantCenterOpen] = useState(false);
  const [assistantCenterRuntime, setAssistantCenterRuntime] = useState(null);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let active = true;
    import("./lib/assistant-control-center.js").then((runtime) => {
      if (active) setAssistantCenterRuntime(runtime);
    }).catch(() => {
      if (active) setAssistantCenterRuntime({ error: true });
    });
    return () => { active = false; };
  }, []);
  const hoy = hoyISO();
  const assistantCenter = useMemo(() => assistantCenterRuntime?.buildAssistantControlCenter
    ? assistantCenterRuntime.buildAssistantControlCenter(db, {
      today: hoy,
      now: new Date().toISOString(),
      financeFrom: hoy,
      financeTo: hoy,
    })
    : {
      primary: { title: assistantCenterRuntime?.error ? "No se pudo preparar el centro de asistentes" : "Preparando prioridades operativas", detail: "El resto del Dashboard ya está disponible.", ownerRoles: ["MOMOS OPS"], nextAction: assistantCenterRuntime?.error ? "Recargar la aplicación." : "Esperar un instante." },
      assistants: [], tasks: [], policy: "Las acciones sensibles siempre requieren confirmación humana.",
      summary: { health: assistantCenterRuntime?.error ? "Atención" : "Preparando", tasks: 0, critical: 0, blocking: 0 },
    }, [assistantCenterRuntime, db, hoy, tick]);
  const deHoy = db.orders.filter((o) => o.fecha === hoy && o.estado !== "Cancelado");
  const ventasHoy = deHoy.filter(esPedidoCobrado).reduce((s, o) => s + orderTotal(db, o), 0);
  const activos = db.orders.filter((o) => !["Entregado","Cancelado"].includes(o.estado));
  const pendPago = db.orders.filter((o) => ["Nuevo","Confirmado","Pendiente de pago"].includes(o.estado) && !o.pagadoEn);
  const stockBajo = db.inventory_items.filter((i) => i.stock < i.min);
  const porVencer = db.inventory_items.filter((i) => i.vence && diasEntre(hoy, i.vence) <= 5 && diasEntre(hoy, i.vence) >= 0);
  const reclamosAbiertos = db.claims.filter((c) => ["Abierto","En revisión"].includes(c.estado));
  const sugerencias = db.production_suggestions.filter((s) => s.estado === "Pendiente" && s.area !== "Inventario");
  const lotesListos = db.production_batches.filter((l) => { const c = estadoCongelacion(l); return c && c.listo; });

  // Marketing en el dashboard
  const campActivasSinPedidos = (db.campaigns || []).filter((c) => c.estado === "Activa" && ordersDeCampaign(db, c.id).length === 0);
  const creativosPorAprobar = (db.creatives || []).filter((c) => c.estado === "En revisión");
  const pubsHoy = (db.content_calendar || []).filter((p) => p.fecha === hoy);
  const campConMetrics = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) }));
  const mejorCampana = [...campConMetrics].filter((x) => x.m.roas !== null).sort((a, b) => b.m.roas - a.m.roas)[0];
  const creativoGanador = (db.creatives || []).find((c) => c.estado === "Ganador");
  const benefsPorCampana = (db.benefits || []).filter((b) => b.estado === "Activo" && /historia|malteada|granizado/i.test(b.condicion + b.beneficio)).length;
  const trafficRecs = trafficRecomendaciones(db);

  // Asistente de marca MOMOS (lenguaje simple)
  const hoyStr = hoy;
  const asistente = (() => {
    const ideas = db.marketing_ideas || [];
    const ideaHoy = [...ideas].sort((a, b) => { const r = { Ganadora: 0, Repetir: 1, Nueva: 2, Usada: 3, Descartada: 4 }; return (r[a.estado] ?? 5) - (r[b.estado] ?? 5); })[0];
    // cliente por contactar: beneficio por vencer, luego inactivo
    let clienteContacto = null;
    const benVence = (db.benefits || []).filter((b) => b.estado === "Activo" && diasEntre(hoyStr, b.vence) <= 3 && b.vence >= hoyStr)[0];
    if (benVence) { const c = db.customers.find((x) => x.id === benVence.customerId); if (c) clienteContacto = { nombre: c.nombre, motivo: "tiene un beneficio por vencer" }; }
    if (!clienteContacto) {
      const inact = db.customers.filter((c) => c.ultima && diasEntre(c.ultima, hoyStr) >= 15).sort((a, b) => diasEntre(b.ultima, hoyStr) - diasEntre(a.ultima, hoyStr))[0];
      if (inact) clienteContacto = { nombre: inact.nombre, motivo: `no compra hace ${diasEntre(inact.ultima, hoyStr)} días` };
    }
    const campRevisar = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) })).filter((x) => x.c.estado === "Activa")[0];
    const contenidoRepetir = ideas.find((i) => i.estado === "Ganadora");
    const benefVence = (db.benefits || []).filter((b) => b.estado === "Activo" && b.vence >= hoyStr).sort((a, b) => diasEntre(hoyStr, a.vence) - diasEntre(hoyStr, b.vence))[0];
    const tareaFalta = (db.marketing_tasks || []).filter((t) => t.estado === "Pendiente" && t.fecha === hoyStr)[0];
    return { ideaHoy, clienteContacto, campRevisar, contenidoRepetir, benefVence, tareaFalta };
  })();
  const nuevos = db.customers.filter((c) => c.estado === "Nuevo").length;
  const recurrentes = db.customers.filter((c) => ["Recurrente","VIP"].includes(c.estado)).length;

  const porEstado = ORDER_STATES.map((e) => ({ label: e, value: db.orders.filter((o) => o.estado === e).length })).filter((d) => d.value > 0);
  const porCanal = CANALES.map((c) => ({
    label: c, color: CANAL_STYLE[c].fg,
    value: db.orders.filter((o) => o.canal === c && esPedidoCobrado(o)).reduce((s, o) => s + orderTotal(db, o), 0),
  }));
  const assistantSeverityStyle = {
    critical: { label: "Crítica", bg: "#F6D4CD", fg: "#8F3528" },
    high: { label: "Alta", bg: "#FFF1D6", fg: "#7A5510" },
    medium: { label: "Media", bg: "#DCE7F2", fg: "#3E5C7E" },
    info: { label: "Informativa", bg: "#DDEBD9", fg: "#356239" },
  };

  return (
    <div>
      <SectionTitle>Hoy en la cocina</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🧁" label="Ventas del día" value={fmt(ventasHoy)} sub={deHoy.length + " pedidos hoy · toca para ver"} tone={T.coral} onClick={() => go("Pedidos", { desde: hoy, hasta: hoy })} />
        <Stat icon="📦" label="Pedidos activos" value={activos.length} sub="en flujo operativo · toca para ver" onClick={() => go("Pedidos")} />
        <Stat icon="💳" label="Pendientes de pago" value={pendPago.length} sub={fmt(pendPago.reduce((s, o) => s + orderTotal(db, o), 0)) + " · toca para ver"} tone="#96690F" onClick={() => go("Pedidos", { pendientesPago: true })} />
        <Stat icon="⚠️" label="Reclamos abiertos" value={reclamosAbiertos.length} sub="requieren decisión · toca para ver" tone="#A03B2A" onClick={() => go("Reclamos", { claimId: reclamosAbiertos[0] ? reclamosAbiertos[0].id : "" })} />
      </div>

      <Card className="mt-3 overflow-hidden" onClick={() => setAssistantCenterOpen(true)}
        aria-label="Abrir Centro de asistentes MOMOS"
        style={{ background: "linear-gradient(135deg,#FFF8F0 0%,#FFFFFF 55%,#F5EDE4 100%)", borderColor: assistantCenter.summary.health === "Bloqueado" ? "#E6AAA0" : assistantCenter.summary.health === "Atención" ? "#E5C98E" : "#BFD8BA" }}>
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0" aria-hidden="true"
            style={{ background: assistantCenter.summary.health === "Bloqueado" ? "#F6D4CD" : assistantCenter.summary.health === "Atención" ? "#FFF1D6" : "#DDEBD9" }}>
            ✦
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[10px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>MOMOS OPS Intelligence</div>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                style={{ background: assistantCenter.summary.health === "Bloqueado" ? "#F6D4CD" : assistantCenter.summary.health === "Atención" ? "#FFF1D6" : "#DDEBD9", color: assistantCenter.summary.health === "Bloqueado" ? "#8F3528" : assistantCenter.summary.health === "Atención" ? "#7A5510" : "#356239" }}>
                {assistantCenter.summary.health}
              </span>
            </div>
            <div className="display text-xl font-semibold mt-1">Centro de asistentes MOMOS</div>
            {assistantCenter.primary ? <>
              <div className="text-sm font-extrabold mt-1.5">{assistantCenter.primary.title}</div>
              <div className="text-xs mt-1 leading-relaxed" style={{ color: T.choco2 }}>
                Responsable: {assistantCenter.primary.ownerRoles.join(" / ")} · {assistantCenter.primary.nextAction}
              </div>
            </> : <div className="text-sm font-semibold mt-1.5" style={{ color: "#3F6B42" }}>Los cinco asistentes están al día.</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0 text-center">
            {[["Asistentes", assistantCenter.assistants.length], ["Prioridades", assistantCenter.summary.tasks], ["Críticas", assistantCenter.summary.critical]].map(([label, value]) => (
              <div key={label} className="rounded-2xl px-3 py-2 min-w-[70px]" style={{ background: "rgba(255,255,255,.78)", border: `1px solid ${T.border}` }}>
                <div className="display text-lg font-semibold">{value}</div>
                <div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {sugerencias.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>
          👩‍🍳 Producción sugerida: {sugerencias.map((s) => `${s.cantidad}× ${s.producto}`).join(" · ")}.{" "}
          <button className="underline" onClick={() => go("Producción")}>Ver en Producción</button>
        </div>
      )}

      {lotesListos.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
          🧊✅ {lotesListos.length} lote(s) cumplieron su tiempo de congelación y esperan pasar a "Listo": {lotesListos.map((l) => `${l.id} (${[l.producto, l.gramaje, l.sabor].filter(Boolean).join(" · ")})`).join(", ")}.{" "}
          <button className="underline" onClick={() => go("Producción")}>Ir a Producción</button>
        </div>
      )}

      {pubsHoy.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>
          🗓️ Publicaciones de hoy ({pubsHoy.length}): {pubsHoy.map((p) => `${p.hora} ${p.canal}`).join(" · ")}.{" "}
          <button className="underline" onClick={() => go("Calendario")}>Ver calendario</button>
        </div>
      )}
      {creativosPorAprobar.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#E8E0F2", color: "#63518A" }}>
          🎨 {creativosPorAprobar.length} creativo(s) esperan aprobación: {creativosPorAprobar.map((c) => c.titulo).join(", ")}.{" "}
          <button className="underline" onClick={() => go("Creativos")}>Revisar</button>
        </div>
      )}
      {campActivasSinPedidos.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#FBE8C8", color: "#96690F" }}>
          📣 Campañas activas sin pedidos atribuidos: {campActivasSinPedidos.map((c) => c.nombre).join(", ")}.{" "}
          <button className="underline" onClick={() => go("Marketing")}>Ver Marketing</button>
        </div>
      )}
      {(mejorCampana || creativoGanador) && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
          🏆 {mejorCampana ? `Mejor campaña: ${mejorCampana.c.nombre} (ROAS ${mejorCampana.m.roas.toFixed(1)}x)` : ""}{mejorCampana && creativoGanador ? " · " : ""}{creativoGanador ? `Creativo ganador: ${creativoGanador.titulo}` : ""}{benefsPorCampana > 0 ? ` · ${benefsPorCampana} beneficio(s) por campaña activos` : ""}
        </div>
      )}

      {(user === "Administrador" || user === "Marketing/CRM") && (
        <>
          <SectionTitle>🌱 Asistente de marca MOMOS</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Card className="p-3.5" onClick={() => go("Crecimiento")}>
              <div className="text-xs font-bold mb-1" style={{ color: T.coral }}>📱 Qué publicar hoy</div>
              <div className="text-sm font-semibold leading-tight">{asistente.ideaHoy ? asistente.ideaHoy.titulo : "Sin ideas cargadas"}</div>
            </Card>
            <Card className="p-3.5" onClick={() => go("Crecimiento")}>
              <div className="text-xs font-bold mb-1" style={{ color: "#8E4B5A" }}>💬 Cliente para contactar</div>
              <div className="text-sm font-semibold leading-tight">{asistente.clienteContacto ? asistente.clienteContacto.nombre : "Nadie urgente hoy"}</div>
              {asistente.clienteContacto && <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{asistente.clienteContacto.motivo}</div>}
            </Card>
            <Card className="p-3.5" onClick={() => go("Crecimiento")}>
              <div className="text-xs font-bold mb-1" style={{ color: "#3E5C7E" }}>📣 Campaña para revisar</div>
              <div className="text-sm font-semibold leading-tight">{asistente.campRevisar ? asistente.campRevisar.c.nombre : "Sin campañas activas"}</div>
            </Card>
            <Card className="p-3.5" onClick={() => go("Crecimiento")}>
              <div className="text-xs font-bold mb-1" style={{ color: "#3F6B42" }}>🔁 Contenido para repetir</div>
              <div className="text-sm font-semibold leading-tight">{asistente.contenidoRepetir ? asistente.contenidoRepetir.titulo : "Aún sin ganadores"}</div>
            </Card>
            <Card className="p-3.5" onClick={() => go("Beneficios")}>
              <div className="text-xs font-bold mb-1" style={{ color: "#96690F" }}>⏳ Beneficio por vencer</div>
              <div className="text-sm font-semibold leading-tight">{asistente.benefVence ? asistente.benefVence.beneficio : "Ninguno próximo"}</div>
              {asistente.benefVence && <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>vence {asistente.benefVence.vence}</div>}
            </Card>
            <Card className="p-3.5" onClick={() => go("Crecimiento")}>
              <div className="text-xs font-bold mb-1" style={{ color: "#63518A" }}>✅ Tarea que falta</div>
              <div className="text-sm font-semibold leading-tight">{asistente.tareaFalta ? asistente.tareaFalta.tarea : "¡Todo al día! 🎉"}</div>
            </Card>
          </div>
          {trafficRecs.length > 0 && (
            <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: trafficRecs[0].bg, color: trafficRecs[0].color }}>
              {trafficRecs[0].icon} {trafficRecs[0].titulo}: {trafficRecs[0].texto}{" "}
              <button className="underline" onClick={() => go("Crecimiento")}>Ver recomendaciones</button>
            </div>
          )}
        </>
      )}

      <SectionTitle>Alertas</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>📉 Inventario bajo mínimo</div>
          {stockBajo.length === 0 ? <div className="text-sm">Todo el stock está por encima del mínimo.</div> :
            stockBajo.map((i) => (
              <button key={i.id} onClick={() => go("Inventario", { itemId: i.id })}
                className="w-full flex justify-between items-center text-sm py-1.5 border-b last:border-0 text-left hover:opacity-70"
                style={{ borderColor: T.border }}>
                <span className="font-semibold">{i.nombre}</span>
                <span className="flex items-center gap-1.5 font-bold" style={{ color: "#A03B2A" }}>{i.stock} / mín {i.min} {i.unidad} <span aria-hidden="true" style={{ color: T.choco2 }}>›</span></span>
              </button>
            ))}
          <div className="mt-3"><Btn small kind="soft" onClick={() => go("Inventario")}>Ir a inventario</Btn></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>🗓️ Vencimientos próximos (5 días)</div>
          {porVencer.length === 0 ? <div className="text-sm">Sin vencimientos cercanos.</div> :
            porVencer.map((i) => (
              <button key={i.id} onClick={() => go("Inventario", { itemId: i.id })}
                className="w-full flex justify-between items-center text-sm py-1.5 border-b last:border-0 text-left hover:opacity-70"
                style={{ borderColor: T.border }}>
                <span className="font-semibold">{i.nombre}</span>
                <span className="flex items-center gap-1.5 font-bold" style={{ color: "#96690F" }}>{i.vence} <span aria-hidden="true" style={{ color: T.choco2 }}>›</span></span>
              </button>
            ))}
          <div className="mt-3 flex gap-2 text-xs font-semibold" style={{ color: T.choco2 }}>
            <span>👤 Nuevos: <b style={{ color: T.choco }}>{nuevos}</b></span><span>·</span>
            <span>💖 Recurrentes/VIP: <b style={{ color: T.choco }}>{recurrentes}</b></span>
          </div>
        </Card>
      </div>

      <SectionTitle>Pedidos por estado</SectionTitle>
      <Card className="p-4"><Bars data={porEstado} /></Card>

      <SectionTitle>Ventas por canal</SectionTitle>
      <Card className="p-4"><Bars data={porCanal} money /></Card>

      <SectionTitle>Disponibilidad real de momos y cajas</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {db.products.filter((p) => p.activo && p.tipo !== "pedido").map((p) => {
          const disp = availability(db, p);
          return (
            <Card key={p.id} className="p-3" onClick={() => go("Producción")}>
              <div className="text-sm font-bold leading-tight">{p.nombre}</div>
              <div className="display text-xl mt-1" style={{ color: disp <= 2 ? "#A03B2A" : T.choco }}>
                {disp} <span className="text-xs font-sans font-semibold" style={{ color: T.choco2 }}>disp.</span>
              </div>
              {p.tipo === "combo" && <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>calculado por momos + cajas</div>}
              {disp <= 2 && <div className="text-xs font-bold mt-0.5" style={{ color: "#A03B2A" }}>Producir / comprar pronto</div>}
            </Card>
          );
        })}
      </div>

      {assistantCenterOpen && (
        <Modal title="Centro de asistentes MOMOS" onClose={() => setAssistantCenterOpen(false)} wide>
          <div className="rounded-3xl p-4 sm:p-5 mb-4" style={{ background: "linear-gradient(135deg,#F8EBDD,#FFFDF9)", border: `1px solid ${T.border}` }}>
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Una prioridad · un responsable · una fuente</div>
                <div className="display text-2xl font-semibold mt-1">{assistantCenter.primary ? assistantCenter.primary.title : "Operación protegida"}</div>
                <div className="text-sm font-semibold mt-2 leading-relaxed" style={{ color: T.choco2 }}>
                  {assistantCenter.primary ? assistantCenter.primary.detail : "No hay tareas pendientes entre Ventas, Cocina, Compras, Empaque, Logística y Finanzas."}
                </div>
              </div>
              <div className="rounded-2xl px-4 py-3 text-center shrink-0" style={{ background: "rgba(255,255,255,.82)" }}>
                <div className="display text-2xl font-semibold">{assistantCenter.summary.tasks}</div>
                <div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>prioridades abiertas</div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl px-3 py-2.5 text-xs font-bold" style={{ background: "rgba(255,255,255,.68)", color: T.choco2 }}>
              🛡️ {assistantCenter.policy}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5" aria-label="Estado de los asistentes">
            {assistantCenter.assistants.map((row) => (
              <button key={row.id} type="button" onClick={() => { setAssistantCenterOpen(false); go(row.module); }}
                className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                style={{ background: T.surface, borderColor: row.status === "Bloqueado" ? "#E6AAA0" : row.status === "Atención" ? "#E5C98E" : "#BFD8BA" }}>
                <div className="text-[10px] uppercase font-extrabold leading-tight" style={{ color: T.choco2 }}>{row.name}</div>
                <div className="display text-xl font-semibold mt-1">{row.count}</div>
                <div className="text-[10px] font-extrabold mt-0.5" style={{ color: row.status === "Bloqueado" ? "#8F3528" : row.status === "Atención" ? "#7A5510" : "#356239" }}>{row.status}</div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="display text-lg font-semibold">Qué necesita atención</div>
              <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>Ordenado por riesgo operativo, no por el área que lo reportó.</div>
            </div>
            {assistantCenter.summary.blocking > 0 && <span className="rounded-full px-3 py-1 text-[10px] font-extrabold" style={{ background: "#F6D4CD", color: "#8F3528" }}>{assistantCenter.summary.blocking} bloquean</span>}
          </div>

          {assistantCenter.tasks.length === 0 ? (
            <div className="rounded-3xl p-8 text-center" style={{ background: "#DDEBD9", color: "#356239" }}>
              <div className="text-3xl" aria-hidden="true">✓</div>
              <div className="display text-xl font-semibold mt-2">Operación protegida</div>
              <div className="text-sm font-semibold mt-1">Los cinco asistentes están al día y no detectan inconsistencias.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {assistantCenter.tasks.slice(0, 12).map((row) => {
                const tone = assistantSeverityStyle[row.severity] || assistantSeverityStyle.medium;
                return (
                  <div key={row.id} className="rounded-2xl border p-4" style={{ background: T.surface, borderColor: row.blocks ? "#E6AAA0" : T.border }}>
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
                          <span className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>{row.area}</span>
                          {row.entityId && <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>{row.entityType} {row.entityId}</span>}
                          <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>Confianza {row.confidence.toLowerCase()}</span>
                        </div>
                        <div className="text-sm font-extrabold">{row.title}</div>
                        <div className="text-xs mt-1 leading-relaxed" style={{ color: T.choco2 }}>{row.detail}</div>
                        <div className="mt-2 space-y-1">
                          {row.reasons.map((reason, index) => <div key={`${row.id}-reason-${index}`} className="text-[11px] font-semibold flex gap-2" style={{ color: T.choco2 }}><span aria-hidden="true">•</span><span>{reason}</span></div>)}
                        </div>
                        <div className="mt-3 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: T.vainilla }}>
                          Siguiente paso: {row.nextAction}
                        </div>
                      </div>
                      <div className="sm:w-44 shrink-0">
                        <div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Responsable</div>
                        <div className="text-xs font-extrabold mt-1">{row.ownerRoles.join(" / ")}</div>
                        {row.confirmationRequired && <div className="text-[10px] font-bold mt-2" style={{ color: "#96690F" }}>Confirmación humana obligatoria</div>}
                        <button type="button" onClick={() => { setAssistantCenterOpen(false); go(row.module); }} className="momo-btn w-full rounded-xl px-3 py-2 mt-3 text-xs font-extrabold" style={{ background: T.coral, color: "white" }}>Abrir {row.module}</button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {assistantCenter.tasks.length > 12 && <div className="rounded-2xl px-4 py-3 text-center text-xs font-bold" style={{ background: T.vainilla, color: T.choco2 }}>Se muestran las 12 prioridades más importantes de {assistantCenter.tasks.length}. Cada asistente conserva el detalle completo en su área.</div>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ================= PEDIDOS ================= */

function HistorialOperativo({ db }) {
  const [olderAudit, setOlderAudit] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(db.auditCursor || null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const mergedAudit = useMemo(() => {
    const byId = new Map([...(db.audit_logs || []), ...olderAudit].map((row) => [row.id, row]));
    return [...byId.values()];
  }, [db.audit_logs, olderAudit]);
  const entries = useMemo(() => buildOperationalHistory({ ...db, audit_logs: mergedAudit }), [db, mergedAudit]);
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [limit, setLimit] = useState(50);
  const areas = useMemo(() => [...new Set(entries.map((entry) => entry.area))].sort((a, b) => a.localeCompare(b, "es")), [entries]);
  const filtered = useMemo(() => {
    const query = q.trim().toLocaleLowerCase("es");
    return entries.filter((entry) => {
      const haystack = [entry.area, entry.entity, entry.entityId, entry.action, entry.actor, entry.from, entry.to].join(" ").toLocaleLowerCase("es");
      const day = entry.at.slice(0, 10);
      return (!query || haystack.includes(query))
        && (!area || entry.area === area)
        && (!desde || day >= desde)
        && (!hasta || day <= hasta);
    });
  }, [entries, q, area, desde, hasta]);
  useEffect(() => { setLimit(50); }, [q, area, desde, hasta]);
  const visible = filtered.slice(0, limit);
  const today = hoyISO();
  const todayCount = entries.filter((entry) => entry.at.startsWith(today)).length;
  const actorCount = new Set(entries.map((entry) => entry.actor).filter(Boolean)).size;
  const primerRegistro = entries.reduce((min, e) => (min == null || (e.at && e.at < min) ? e.at : min), null);

  function exportar() {
    downloadCSV("historial-operativo", ["Fecha", "Área", "Entidad", "ID", "Acción", "Antes", "Después", "Responsable"], filtered.map((entry) => [entry.at, entry.area, entry.entity, entry.entityId, entry.action, entry.from, entry.to, entry.actor]));
  }

  async function verMasHistorial() {
    if (visible.length < filtered.length) {
      setLimit((value) => value + 50);
      return;
    }
    if (!historyCursor || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const page = await fetchOperationalHistoryPage(historyCursor, 50);
      setOlderAudit((rows) => [...rows, ...page.rows]);
      setHistoryCursor(page.rows.length ? page.cursor : null);
      setLimit((value) => value + page.rows.length);
    } catch (error) {
      setHistoryError(error.message);
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div>
      <SectionTitle>Historial operativo</SectionTitle>
      <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
        Consultá qué pasó, en qué área, sobre qué registro y quién lo ejecutó. Nada se borra al salir de una bandeja de trabajo.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="◷" label="Movimientos" value={entries.length} sub="rastro disponible" tone={T.coral} />
        <Stat icon="●" label="Hoy" value={todayCount} sub="acciones registradas" tone="#3F6B42" />
        <Stat icon="▦" label="Áreas" value={areas.length} sub="fuentes conectadas" tone="#63518A" />
        <Stat icon="♙" label="Responsables" value={actorCount} sub="usuarios en el rastro" tone="#96690F" />
      </div>

      <div className="text-[11px] font-semibold mt-2 mb-3" style={{ color: T.choco2 }}>
        Rastro registrado desde <b style={{ color: T.coral }}>{primerRegistro ? primerRegistro.slice(0, 10) : "—"}</b> hasta hoy.
      </div>

      <SegmentedTabs
        ariaLabel="Áreas del historial"
        value={area}
        onChange={setArea}
        items={[["Todas", ""], ...areas.map((name) => [name, name])]}
        getCount={(value) => value ? entries.filter((entry) => entry.area === value).length : entries.length}
      />

      <Card className="p-3 mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_auto] gap-2 items-center">
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar pedido, lote, acción o responsable…" className="rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <input type="date" aria-label="Historial desde" value={desde} onChange={(event) => setDesde(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
          <input type="date" aria-label="Historial hasta" value={hasta} onChange={(event) => setHasta(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3 mb-3"><div><div className="display text-lg font-semibold">Bitácora consolidada</div><div className="text-xs font-semibold" style={{ color: T.choco2 }}>{filtered.length} movimiento{filtered.length === 1 ? "" : "s"} encontrado{filtered.length === 1 ? "" : "s"}</div></div>{(q || area || desde || hasta) && <button type="button" className="text-xs font-extrabold" style={{ color: T.coral }} onClick={() => { setQ(""); setArea(""); setDesde(""); setHasta(""); }}>Limpiar filtros</button>}</div>
      <Card className="overflow-hidden">
        <div className="divide-y" style={{ borderColor: T.border }}>
          {visible.map((entry) => (
            <div key={entry.id} className="p-3 sm:p-4 flex gap-3 items-start" style={{ borderColor: T.border }}>
              <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-sm font-black" style={{ background: entry.area === "Producción" ? "#DCE7F2" : entry.area === "Domicilios" ? "#DDEBD9" : entry.area === "Reclamos" ? "#F6D4CD" : T.vainilla, color: T.choco }}>↻</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{entry.area}</span><span className="text-[10px] font-bold" style={{ color: T.choco2 }}>{entry.entity}{entry.entityId ? ` · ${entry.entityId}` : ""}</span></div><div className="font-bold text-sm mt-0.5">{entry.action}</div>{(entry.from || entry.to) && <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{entry.from || "—"} <span aria-hidden="true">→</span> <b style={{ color: T.choco }}>{entry.to || "—"}</b></div>}</div>
              <div className="text-right shrink-0"><time className="text-[10px] font-bold block" style={{ color: T.choco2 }}>{entry.at || "Sin fecha"}</time><span className="text-[10px] font-extrabold block mt-1">{entry.actor}</span></div>
            </div>
          ))}
          {!visible.length && <div className="p-10 text-center"><div className="text-3xl mb-2">⌕</div><div className="font-bold">No hay movimientos con esos filtros</div></div>}
        </div>
      </Card>
      {(visible.length < filtered.length || historyCursor) && <div className="mt-3 text-center"><Btn kind="ghost" onClick={verMasHistorial} disabled={loadingHistory}>{loadingHistory ? "Cargando…" : "Ver 50 movimientos más"}</Btn></div>}
      {historyError && <div className="mt-2 text-center text-xs font-bold" style={{ color: T.red }}>{historyError}</div>}
    </div>
  );
}

/* ================= PRODUCCIÓN ================= */

/* ================= INVENTARIO TERMINADO ================= */

const CAT_EMOJI = { "Momos Signature": "🐱", "Cajas y Combos": "🎁", "Momos Cuchara": "🥄", "Momos Antojos": "🥞", "Momos Bebidas": "🥤" };

function nuevoProductoVacio() {
  return { nombre: "", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: "", precioRappi: "", costo: "", prep: "", frio: true, lejano: false, desc: "", comboSize: "", componentProductIds: [], empaqueItem: "", colchonProduccion: 0 };
}

function Productos({ db, user, refrescar, serverDataReady }) {
  const cats = ["Momos Signature","Cajas y Combos","Momos Cuchara","Momos Antojos","Momos Bebidas"];
  const [detalleProductoId, setDetalleProductoId] = useState(null);
  const [recetaDe, setRecetaDe] = useState(null); // productId con receta abierta
  const [linea, setLinea] = useState({ itemId: "", cantidad: "" });
  const [abrirForm, setAbrirForm] = useState(false);
  const [editandoProd, setEditandoProd] = useState(null);
  const [form, setForm] = useState(nuevoProductoVacio());
  const [errProd, setErrProd] = useState("");
  const [recetaDraft, setRecetaDraft] = useState([]);
  const [recetaSucia, setRecetaSucia] = useState(false);
  const [errReceta, setErrReceta] = useState("");
  const [guardandoReceta, setGuardandoReceta] = useState(false);
  const [fCatProd, setFCatProd] = useState("");

  const prodReceta = recetaDe ? db.products.find((p) => p.id === recetaDe) : null;
  const detalleProducto = detalleProductoId ? db.products.find((p) => p.id === detalleProductoId) : null;
  const puedeEditar = user === "Administrador" && serverDataReady && Boolean(db.productsServerReady);
  const costoRecetaDraft = recetaDraft.reduce((total, line) => {
    const item = db.inventory_items.find((candidate) => candidate.id === line.itemId);
    return total + Number(line.cantidad || 0) * Number(item?.costo || 0);
  }, 0);

  function abrirRecetaProducto(product) {
    setLinea({ itemId: "", cantidad: "" });
    setRecetaDraft(recipeLines(db, product.id).map((line) => ({ ...line })));
    setRecetaSucia(false);
    setErrReceta("");
    setRecetaDe(product.id);
  }

  function abrirEdicionProducto(product) {
    setEditandoProd(product);
    setForm({ nombre: product.nombre, cat: product.cat, tipo: product.tipo, especie: product.especie || "gato", precio: product.precio, precioRappi: product.precioRappi, costo: product.costo, prep: product.prep, frio: !!product.frio, lejano: !!product.lejano, desc: product.desc || "", comboSize: product.comboSize || "", componentProductIds: [...(product.componentProductIds || [])], empaqueItem: product.empaqueItem || "", colchonProduccion: product.colchonProduccion ?? 0 });
    setErrProd("");
    setAbrirForm(true);
  }

  async function cambiarProductoActivo(product) {
    try { await setProductoActivo(product.id, !product.activo); toast("ok", product.activo ? "Producto desactivado del menú." : "Producto activado en el menú."); }
    catch (error) { toast("error", error.message); return; }
    try { await refrescar(); }
    catch { toast("error", "Se actualizó, pero no se pudo refrescar la lista."); }
  }

  function payloadProducto() {
    return {
      nombre: form.nombre.trim(), cat: form.cat, tipo: form.tipo,
      especie: form.tipo === "momo" ? form.especie : null,
      precio: Number(form.precio), precio_rappi: Number(form.precioRappi) || null,
      costo: Number(form.costo), prep: Number(form.prep) || 0,
      frio: Boolean(form.frio), lejano: Boolean(form.lejano), descr: form.desc || "",
      combo_size: form.tipo === "combo" ? Number(form.comboSize) : null,
      component_product_ids: form.tipo === "combo" ? [...(form.componentProductIds || [])] : [],
      empaque_item_id: form.tipo === "combo" ? form.empaqueItem : null,
      colchon_produccion: form.tipo === "momo" ? Number(form.colchonProduccion) || 0 : 0,
    };
  }

  async function guardarNuevo() {
    const nombre = form.nombre.trim();
    if (!nombre) { setErrProd("Falta el nombre"); return; }
    if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
    if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
    if (form.tipo === "momo" && !["gato","perro"].includes(form.especie)) { setErrProd("Elegí la especie del momo."); return; }
    if (form.tipo === "combo") {
      if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
      if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
      if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
    }
    try {
      await crearProducto(payloadProducto());
      setAbrirForm(false);
      setErrProd("");
      toast("ok", "Producto creado.");
    } catch (error) { toast("error", error.message); return; }
    try { await refrescar(); }
    catch { toast("error", "Producto creado, pero no se pudo refrescar el catálogo."); }
  }

  async function guardarEdicion() {
    const nombre = form.nombre.trim();
    if (!nombre) { setErrProd("Falta el nombre"); return; }
    if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
    if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
    if (form.tipo === "momo" && !["gato","perro"].includes(form.especie)) { setErrProd("Elegí la especie del momo."); return; }
    if (form.tipo === "combo") {
      if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
      if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
      if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
    }
    try {
      await editarProducto(editandoProd.id, payloadProducto());
      setAbrirForm(false);
      setErrProd("");
      toast("ok", "Producto actualizado.");
    } catch (error) { toast("error", error.message); return; }
    try { await refrescar(); }
    catch { toast("error", "Producto actualizado, pero no se pudo refrescar el catálogo."); }
  }

  const totalProductos = db.products.length;
  const productosActivos = db.products.filter((p) => p.activo).length;
  const productosSinReceta = db.products.filter((p) => recipeLines(db, p.id).length === 0).length;

  return (
    <div>
      <SectionTitle>Catálogo de productos</SectionTitle>
      <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
        🧾 Cada producto puede tener una receta (insumos por unidad). Al registrar un lote o al pasar a "En producción" un producto que se prepara al momento, los insumos se descuentan solos del inventario.
      </div>
      {!puedeEditar && <div className="text-xs font-bold p-2.5 rounded-xl mb-2" style={{ background: T.vainilla, color: T.choco2 }}>{user === "Administrador" && !db.productsServerReady ? "Catálogo en modo consulta hasta aplicar la migración 13 de Productos." : "Catálogo en modo consulta. Solo Administrador puede modificar productos y recetas."}</div>}
      {!abrirForm && errProd && <div className="text-sm font-bold p-2.5 rounded-xl mb-2" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errProd}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🧾" label="Productos" value={totalProductos} sub="en catálogo" tone={T.coral} />
        <Stat icon="✅" label="Activos" value={productosActivos} sub="a la venta" tone="#3F6B42" />
        <Stat icon="⚠️" label="Sin receta" value={productosSinReceta} sub="no descuentan insumos" tone="#96690F" />
        <Stat icon="📈" label="Margen prom." value={totalProductos ? pct(db.products.reduce((s, p) => s + (p.precio - p.costo) / p.precio, 0) / totalProductos) : "—"} sub="precio vs. costo" />
      </div>
      <div className="text-[11px] font-semibold mt-2 mb-4" style={{ color: T.choco2 }}>
        <b style={{ color: T.coral }}>{productosActivos}</b> activos de {totalProductos} · {productosSinReceta} sin receta.
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {puedeEditar && <Btn small kind="rosa" onClick={() => { setForm(nuevoProductoVacio()); setEditandoProd(null); setErrProd(""); setAbrirForm(true); }}>＋ Nuevo producto</Btn>}
      </div>

      <SegmentedTabs
        ariaLabel="Categorías de productos"
        value={fCatProd}
        onChange={setFCatProd}
        items={[["Todas", ""], ...cats.map((category) => [`${CAT_EMOJI[category] || ""} ${category}`.trim(), category])]}
        getCount={(value) => value ? db.products.filter((product) => product.cat === value).length : totalProductos}
      />
      {cats.filter((cat) => !fCatProd || cat === fCatProd).map((cat) => (
        <div key={cat}>
          <SectionTitle>{CAT_EMOJI[cat]} {cat}</SectionTitle>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {db.products.filter((p) => p.cat === cat).map((p) => {
              const margen = (p.precio - p.costo) / p.precio;
              const disp = availability(db, p);
              const recipeCount = recipeLines(db, p.id).length;
              return (
                <Card key={p.id} className={`momo-queue-item p-4 ${!p.activo ? "opacity-60" : ""}`} onClick={() => setDetalleProductoId(p.id)} aria-label={`Abrir detalle de ${p.nombre}`}>
                  <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2.5 min-w-0"><span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: T.rosa }} aria-hidden="true">{CAT_EMOJI[cat]}</span><div className="min-w-0"><div className="font-bold text-sm leading-tight">{p.nombre}</div><div className="text-[10px] font-extrabold uppercase tracking-wider mt-1" style={{ color: p.activo ? "#3F6B42" : T.choco2 }}>{p.activo ? "Activo en el menú" : "Fuera del menú"}</div></div></div><div className="display text-lg shrink-0" style={{ color: T.coral }}>{fmt(p.precio)}</div></div>
                  <div className="flex items-end justify-between gap-3 mt-3"><div><div className="text-xs font-bold" style={{ color: margen > 0.6 ? "#3F6B42" : "#96690F" }}>Margen {pct(margen)}</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{recipeCount ? `Receta con ${recipeCount} insumo${recipeCount === 1 ? "" : "s"}` : "Sin receta registrada"}</div></div><div className="text-right text-xs font-extrabold" style={{ color: isFinite(disp) && disp <= 2 ? "#A03B2A" : T.choco2 }}>{isFinite(disp) ? `${disp} disp.` : "Bajo pedido"}</div></div>
                  <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t text-[11px] font-bold" style={{ borderColor: T.border, color: T.choco2 }}><span>{p.tipo === "combo" ? "Combo" : p.tipo === "momo" ? "Momo" : "Preparación al momento"}{p.frio ? " · requiere frío" : ""}</span><span style={{ color: T.coral }}>Abrir detalle ›</span></div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {detalleProducto && (() => {
        const lines = recipeLines(db, detalleProducto.id);
        const margen = detalleProducto.precio > 0 ? (detalleProducto.precio - detalleProducto.costo) / detalleProducto.precio : 0;
        const disp = availability(db, detalleProducto);
        const comboProducts = (detalleProducto.componentProductIds || []).map((id) => db.products.find((product) => product.id === id)?.nombre).filter(Boolean);
        const pack = db.inventory_items.find((item) => item.id === detalleProducto.empaqueItem);
        return (
          <Modal title={`Producto · ${detalleProducto.nombre}`} onClose={() => setDetalleProductoId(null)} wide>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{CAT_EMOJI[detalleProducto.cat]} {detalleProducto.cat}</div><div className="display text-2xl font-semibold mt-0.5">{detalleProducto.nombre}</div><div className="text-sm font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>{detalleProducto.desc || "Sin descripción comercial registrada."}</div></div>
              <Badge label={detalleProducto.activo ? "Activo" : "Inactivo"} map={{ Activo: { bg: "#DDEBD9", fg: "#3F6B42" }, Inactivo: { bg: "#EBE6E0", fg: "#7A6E63" } }} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Stat icon="$" label="Precio directo" value={fmt(detalleProducto.precio)} sub="precio de venta" tone={T.coral} />
              <Stat icon="R" label="Precio Rappi" value={fmt(detalleProducto.precioRappi)} sub="canal plataforma" tone="#63518A" />
              <Stat icon="◒" label="Costo" value={fmt(detalleProducto.costo)} sub="registrado" tone={T.choco} />
              <Stat icon="↗" label="Margen" value={pct(margen)} sub="precio vs. costo" tone={margen > 0.6 ? "#3F6B42" : "#96690F"} />
            </div>

            <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-3 mb-4">
              <Card className="p-4">
                <div className="text-xs font-extrabold mb-3" style={{ color: T.choco2 }}>OPERACIÓN Y VENTA</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div><div className="font-semibold" style={{ color: T.choco2 }}>Tipo</div><div className="font-bold mt-0.5">{detalleProducto.tipo === "momo" ? `Momo · ${detalleProducto.especie || "especie sin registrar"}` : detalleProducto.tipo === "combo" ? "Caja / combo" : "Preparación al momento"}</div></div>
                  <div><div className="font-semibold" style={{ color: T.choco2 }}>Disponibilidad</div><div className="font-bold mt-0.5" style={{ color: isFinite(disp) && disp <= 2 ? "#A03B2A" : "#3F6B42" }}>{isFinite(disp) ? `${disp} unidades` : "Bajo pedido"}</div></div>
                  <div><div className="font-semibold" style={{ color: T.choco2 }}>Preparación</div><div className="font-bold mt-0.5">{detalleProducto.prep || 0} min</div></div>
                  <div><div className="font-semibold" style={{ color: T.choco2 }}>Cadena de frío</div><div className="font-bold mt-0.5">{detalleProducto.frio ? "Requerida" : "No requerida"}</div></div>
                  <div><div className="font-semibold" style={{ color: T.choco2 }}>Domicilio lejano</div><div className="font-bold mt-0.5">{detalleProducto.lejano ? "Permitido" : "Solo zona cercana"}</div></div>
                  {detalleProducto.tipo === "momo" && <div><div className="font-semibold" style={{ color: T.choco2 }}>Colchón producción</div><div className="font-bold mt-0.5">{detalleProducto.colchonProduccion || 0} unidades</div></div>}
                </div>
                {detalleProducto.tipo === "combo" && <div className="mt-4 pt-3 border-t" style={{ borderColor: T.border }}><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Composición permitida</div><div className="text-xs font-bold mt-1">{detalleProducto.comboSize || 0} momos · caja {pack?.nombre || "sin configurar"}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{comboProducts.join(" · ") || "Sin productos componentes"}</div></div>}
              </Card>

              <Card className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-xs font-extrabold" style={{ color: T.choco2 }}>RECETA POR UNIDAD</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{lines.length ? `${lines.length} insumo${lines.length === 1 ? "" : "s"} vinculados` : "No descuenta inventario todavía"}</div></div><span className="display text-lg" style={{ color: T.coral }}>{fmt(recipeCost(db, detalleProducto.id))}</span></div>
                <div className="space-y-2">{lines.slice(0, 6).map((line) => { const item = db.inventory_items.find((candidate) => candidate.id === line.itemId); return <div key={line.id || line.itemId} className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ background: T.vainilla }}><span className="font-bold">{item?.nombre || "Insumo no encontrado"}</span><span className="font-extrabold shrink-0" style={{ color: T.choco2 }}>{line.cantidad} {item?.unidad || ""}</span></div>; })}{lines.length === 0 && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>Falta registrar la receta para tener costo y descuento de inventario trazables.</div>}{lines.length > 6 && <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>＋ {lines.length - 6} insumo(s) más en la receta completa.</div>}</div>
                {lines.length > 0 && <div className="text-[10px] font-bold mt-3" style={{ color: Math.abs(recipeCost(db, detalleProducto.id) - detalleProducto.costo) > detalleProducto.costo * 0.15 ? "#96690F" : "#3F6B42" }}>Costo receta {fmt(recipeCost(db, detalleProducto.id))} · registrado {fmt(detalleProducto.costo)}</div>}
              </Card>
            </div>

            <div className="flex flex-wrap gap-2 pt-4 border-t" style={{ borderColor: T.border }}>
              <Btn kind="rosa" onClick={() => abrirRecetaProducto(detalleProducto)}>🧾 Abrir receta completa</Btn>
              {puedeEditar && <Btn kind="ghost" onClick={() => abrirEdicionProducto(detalleProducto)}>✏️ Editar producto</Btn>}
              {puedeEditar && <BtnAsync kind={detalleProducto.activo ? "ghost" : "soft"} textoEnVuelo={detalleProducto.activo ? "Desactivando…" : "Activando…"} onClick={() => cambiarProductoActivo(detalleProducto)}>{detalleProducto.activo ? "Desactivar del menú" : "Activar en el menú"}</BtnAsync>}
            </div>
          </Modal>
        );
      })()}

      {abrirForm && (
        <Modal title={editandoProd ? "Editar producto" : "Nuevo producto"} onClose={() => setAbrirForm(false)}>
          <Field label="Nombre"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Field>
          <Field label="Categoría">
            <Select options={cats} value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} />
          </Field>
          <Field label="Tipo">
            {editandoProd
              ? <Select options={[form.tipo]} value={form.tipo} disabled onChange={() => {}} />
              : <Select options={["momo", "pedido", "combo"]} value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))} />}
          </Field>
          {form.tipo === "momo" && <Field label="Especie"><Select options={["gato","perro"]} value={form.especie} onChange={(e) => setForm({ ...form, especie: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Precio"><Input type="number" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} /></Field>
            <Field label="Precio Rappi"><Input type="number" min="0" value={form.precioRappi} onChange={(e) => setForm({ ...form, precioRappi: e.target.value })} /></Field>
            <Field label="Costo"><Input type="number" min="0" value={form.costo} onChange={(e) => setForm({ ...form, costo: e.target.value })} /></Field>
            <Field label="Prep (min)"><Input type="number" min="0" value={form.prep} onChange={(e) => setForm({ ...form, prep: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Requiere frío"><Select options={["Sí", "No"]} value={form.frio ? "Sí" : "No"} onChange={(e) => setForm({ ...form, frio: e.target.value === "Sí" })} /></Field>
            <Field label="Apto domicilio lejano"><Select options={["Sí", "No"]} value={form.lejano ? "Sí" : "No"} onChange={(e) => setForm({ ...form, lejano: e.target.value === "Sí" })} /></Field>
          </div>
          {editandoProd && form.tipo === "momo" && user === "Administrador" && (
            <Field label="🛡️ Colchón de producción (unidades extra por corrida — absorbe imperfectas y mostrador)">
              <Input type="number" min="0" step="1" value={form.colchonProduccion ?? 0} onChange={(e) => setForm({ ...form, colchonProduccion: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
            </Field>
          )}
          <Field label="Descripción"><Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} /></Field>
          {form.tipo === "combo" && (
            <div className="p-3 rounded-xl mb-3" style={{ background: T.vainilla }}>
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>🎁 CONFIGURACIÓN DEL COMBO</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Momos por caja"><Input type="number" min="1" value={form.comboSize} onChange={(e) => setForm({ ...form, comboSize: e.target.value })} /></Field>
                <Field label="Caja (empaque)">
                  <select value={form.empaqueItem} onChange={(e) => setForm({ ...form, empaqueItem: e.target.value })} className={inputCls} style={inputStyle}>
                    <option value="">Elegir caja…</option>
                    {db.inventory_items.filter((i) => i.cat === "Cajas").map((i) => <option key={i.id} value={i.id}>{i.nombre} · {i.stock} und</option>)}
                  </select>
                </Field>
              </div>
              <div className="text-[11px] font-bold mt-1 mb-1" style={{ color: T.choco2 }}>Momos que puede llevar (define las figuras disponibles al armar la caja):</div>
              <div className="flex flex-wrap gap-1.5">
                {db.products.filter((p) => p.tipo === "momo" && p.activo).map((p) => {
                  const on = (form.componentProductIds || []).includes(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => setForm((f) => {
                      const cur = f.componentProductIds || [];
                      return { ...f, componentProductIds: cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id] };
                    })} className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                      style={{ background: on ? T.coral : T.surface, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                      {p.nombre} {momoEspecie(p) === "perro" ? "🐶" : "🐱"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Field label="Atributos que pedirá al vender">
            <div className="flex gap-2 flex-wrap items-center">
              {atributosDeTipo(form.tipo).length === 0
                ? <span className="text-xs font-semibold" style={{ color: T.choco2 }}>Ninguno — se vende tal cual (sin sabor/salsa/figura).</span>
                : atributosDeTipo(form.tipo).map((key) => (
                    <span key={key} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>{ATRIBUTO_LABEL[key]}</span>
                  ))}
            </div>
            <div className="text-[11px] font-semibold mt-1.5" style={{ color: T.choco2 }}>
              Se derivan del tipo automáticamente. Un {form.tipo === "pedido" ? "granizado/crepa" : "momo"} no se puede configurar a mano.
            </div>
          </Field>
          {errProd && <div className="text-sm font-bold mb-3" style={{ color: T.coral }}>{errProd}</div>}
          <div className="flex justify-end">
            <BtnAsync kind="rosa" onClick={editandoProd ? guardarEdicion : guardarNuevo}>Guardar</BtnAsync>
          </div>
        </Modal>
      )}

      {prodReceta && (
        <Modal title={`Receta · ${prodReceta.nombre}`} onClose={() => setRecetaDe(null)} wide>
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
            Cantidades por <b>1 unidad</b> de producto. {prodReceta.tipo === "momo" ? "Se descuentan al registrar un lote de producción." : prodReceta.tipo === "pedido" ? "Se descuentan cuando el pedido pasa a \u201cEn producción\u201d." : "Los combos descuentan momos y cajas automáticamente; agrega aquí solo extras (lazo, tarjeta…)."}
          </div>

          {recetaDraft.length === 0 && (
            <div className="text-sm font-semibold mb-3 p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
              Este producto aún no tiene receta. Agrega el primer insumo abajo.
            </div>
          )}

          {recetaDraft.map((l) => {
            const it = db.inventory_items.find((i) => i.id === l.itemId);
            if (!it) return null;
            return (
              <Card key={l.id} className="p-3 mb-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{it.nombre}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{fmt(it.costo)}/{it.unidad} · stock {it.stock} {it.unidad}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input type="number" min="0" step="0.01" value={l.cantidad}
                    disabled={!puedeEditar}
                    onChange={(e) => { setRecetaDraft((lines) => lines.map((line) => line.itemId === l.itemId ? { ...line, cantidad: e.target.value } : line)); setRecetaSucia(true); }}
                    className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} aria-label={`Cantidad de ${it.nombre}`} />
                  <span className="text-xs font-bold" style={{ color: T.choco2 }}>{it.unidad}</span>
                  <span className="text-xs font-bold w-16 text-right">{fmt(it.costo * l.cantidad)}</span>
                  {puedeEditar && <button aria-label={`Quitar ${it.nombre}`} onClick={() => { setRecetaDraft((lines) => lines.filter((line) => line.itemId !== l.itemId)); setRecetaSucia(true); }} className="w-7 h-7 rounded-full font-bold text-xs" style={{ background: "#F6D4CD", color: "#A03B2A" }}>✕</button>}
                </div>
              </Card>
            );
          })}

          {puedeEditar && <Card className="p-3 mb-3">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>AGREGAR INSUMO A LA RECETA</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={linea.itemId} onChange={(e) => setLinea({ ...linea, itemId: e.target.value })} className="flex-1 min-w-[160px] rounded-xl px-2 py-2 text-sm border font-semibold" style={inputStyle}>
                <option value="">Elegir insumo…</option>
                {db.inventory_items.filter((i) => !recetaDraft.some((l) => l.itemId === i.id)).map((i) => (
                  <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
                ))}
              </select>
              <input type="number" min="0" step="0.01" value={linea.cantidad} onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })}
                placeholder="Cant." className="w-24 rounded-xl px-2 py-2 text-sm border text-right font-bold" style={inputStyle} aria-label="Cantidad por unidad" />
              <Btn small kind="rosa" onClick={() => {
                if (!linea.itemId || !parseFloat(linea.cantidad)) return;
                setRecetaDraft((lines) => [...lines,{ id: `draft-${linea.itemId}`, productId: prodReceta.id, itemId: linea.itemId, cantidad: parseFloat(linea.cantidad) }]);
                setRecetaSucia(true);
                setLinea({ itemId: "", cantidad: "" });
              }}>＋ Agregar</Btn>
            </div>
            <div className="text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>¿No está el insumo? Créalo primero en Inventario → ＋ Nuevo insumo.</div>
          </Card>}

          {errReceta && <div className="text-sm font-bold p-2.5 rounded-xl mb-3" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errReceta}</div>}
          {puedeEditar && <div className="flex justify-end mb-3">
            <BtnAsync kind="rosa" disabled={!recetaSucia || guardandoReceta} textoEnVuelo="Guardando receta…" onClick={async () => {
              if (recetaDraft.some((line) => !(Number(line.cantidad)>0))) { setErrReceta("Todas las cantidades deben ser mayores que cero."); return; }
              setGuardandoReceta(true); setErrReceta("");
              try {
                await guardarRecetaProducto(prodReceta.id, recetaDraft);
                setRecetaSucia(false);
                toast("ok", "Receta guardada.");
              } catch (error) { toast("error", error.message); setGuardandoReceta(false); return; }
              try { await refrescar(); }
              catch { toast("error", "Receta guardada, pero no se pudo refrescar."); }
              finally { setGuardandoReceta(false); }
            }}>{recetaSucia ? "Guardar receta" : "Receta guardada ✓"}</BtnAsync>
          </div>}

          <Card className="p-4">
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold">Costo estimado por receta (1 unidad)</span>
              <b className="display text-lg" style={{ color: T.coral }}>{fmt(costoRecetaDraft)}</b>
            </div>
            <div className="flex justify-between items-center text-xs mt-1" style={{ color: T.choco2 }}>
              <span>Costo registrado del producto</span><b>{fmt(prodReceta.costo)}</b>
            </div>
            {puedeEditar && recetaDraft.length > 0 && Math.round(costoRecetaDraft) !== prodReceta.costo && (
              <div className="mt-3">
                <BtnAsync small kind="soft" disabled={recetaSucia || guardandoReceta} textoEnVuelo="Actualizando costo…" onClick={async () => {
                  setGuardandoReceta(true); setErrReceta("");
                  try { await sincronizarCostoProducto(prodReceta.id); toast("ok", "Costo del producto actualizado."); }
                  catch (error) { toast("error", error.message); setGuardandoReceta(false); return; }
                  try { await refrescar(); }
                  catch { toast("error", "Costo actualizado, pero no se pudo refrescar."); }
                  finally { setGuardandoReceta(false); }
                }}>Actualizar costo del producto con la receta</BtnAsync>
              </div>
            )}
          </Card>
        </Modal>
      )}
    </div>
  );
}

/* ================= DOMICILIOS ================= */

const DOM_ESTADOS = ["Por solicitar","Solicitado","Asignado","En ruta","Entregado","Problema","Cancelado"];

function Domicilios({ db, update, user, refrescar }) {
  const [nuevo, setNuevo] = useState(false);
  const [avisoDom, setAvisoDom] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const s = db.settings;
  const [form, setForm] = useState({ orderId: "", proveedor: s.proveedores[0], costoReal: "", zona: s.zonas[0].nombre, obs: "" });
  const [scope, setScope] = useState("active");
  const deliveryBuckets = useMemo(() => partitionByActivity(db.deliveries, isActiveDelivery), [db.deliveries]);
  const listaDomicilios = scope === "active" ? deliveryBuckets.active : deliveryBuckets.history;

  const subsidio = db.deliveries.reduce((sm, d) => sm + Math.max(0, d.costoReal - d.cobrado), 0);
  const excedente = db.deliveries.reduce((sm, d) => sm + Math.max(0, d.cobrado - d.costoReal), 0);
  const pedidosSinDomicilio = db.orders
    .filter((o) => !["Entregado", "Cancelado"].includes(o.estado))
    .filter((o) => o.canal !== "Rappi")
    .filter((o) => !db.deliveries.some((delivery) => delivery.orderId === o.id && deliveryBlocksNewRequest(delivery)));
  const pendientes = pedidosSinDomicilio.filter((o) => ["Empacado","Listo para despacho"].includes(o.estado));

  function exportar() {
    downloadCSV("domicilios",
      ["ID","Pedido","Proveedor","Zona","Cobrado","Costo real","Diferencia","Solicitud","Salida","Entrega","Código","Estado"],
      listaDomicilios.map((d) => [d.id, d.orderId, d.proveedor, d.zona, d.cobrado, d.costoReal, d.cobrado - d.costoReal, d.hSolicitud, d.hSalida, d.hEntrega, d.codigo, d.estado]));
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="🛵" label="Domicilios activos" value={deliveryBuckets.active.length} onClick={() => { setScope("active"); setTimeout(() => { const el = document.getElementById("lista-domicilios"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); }} active={scope === "active"} />
        <Stat icon="🧾" label="Subsidio acumulado" value={fmt(subsidio)} sub="cobramos menos que el costo" tone="#A03B2A" />
        <Stat icon="💰" label="Excedente cobrado" value={fmt(excedente)} sub="cobramos más que el costo" tone="#3F6B42" />
        <Stat icon="📦" label="Listos sin domicilio" value={pendientes.length} sub="pedidos por solicitar" tone={pendientes.length ? "#96690F" : undefined} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Btn onClick={() => { setForm((actual) => ({ ...actual, orderId: "" })); setNuevo(true); }}>＋ Solicitar domicilio</Btn>
        <WorkScopeTabs value={scope} onChange={setScope} activeCount={deliveryBuckets.active.length} historyCount={deliveryBuckets.history.length} activeLabel="En seguimiento" />
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {pendientes.length > 0 && (
        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>
          ⏰ Pedidos listos esperando domicilio: {pendientes.map((o) => o.id).join(", ")}
        </div>
      )}

      <div id="lista-domicilios" />
      <SectionTitle>{scope === "active" ? "Entregas en seguimiento" : "Historial de domicilios"}</SectionTitle>
      <div className="grid lg:grid-cols-2 gap-3">
        {listaDomicilios.map((d) => {
          const dif = d.cobrado - d.costoReal;
          return (
            <Card key={d.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-bold">{d.id} · Pedido {d.orderId}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{d.proveedor} · {d.zona} · Código {d.codigo || "—"}</div>
                </div>
                <Badge label={d.estado} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[["Solicitud", d.hSolicitud || "—"], ["Salida", d.hSalida || "—"], ["Entrega", d.hEntrega || "—"]].map(([l, v]) => (
                  <div key={l} className="rounded-xl py-1.5" style={{ background: T.vainilla }}>
                    <div className="text-sm font-bold">{v}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2 mt-3">
                <div className="text-xs font-semibold" style={{ color: T.choco2 }}>
                  Cobrado {fmt(d.cobrado)} · Costo {fmt(d.costoReal)} ·{" "}
                  <b style={{ color: dif < 0 ? "#A03B2A" : "#3F6B42" }}>{dif < 0 ? `subsidio ${fmt(-dif)}` : dif > 0 ? `excedente ${fmt(dif)}` : "sin diferencia"}</b>
                </div>
                <MiniSelect options={DOM_ESTADOS} value={d.estado} disabled={enviando || scope === "history"} onChange={async (e) => {
                  const nuevo = e.target.value;
                  setEnviando(true);
                  // "En ruta"/"Entregado" son dominio del PEDIDO: set_order_status sincroniza pedido+domicilio+sellos server-side.
                  if (nuevo === "En ruta" || nuevo === "Entregado") {
                    try {
                      await setOrderStatusRemoto(d.orderId, nuevo);
                    } catch (err) {
                      setAvisoDom({ titulo: "No se puede despachar todavía", texto: err.message });
                      setEnviando(false);
                      return;
                    }
                    try {
                      await refrescar();
                    } catch (err) {
                      setAvisoDom({ titulo: "Acción aplicada, vista desactualizada", texto: "El domicilio se actualizó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                    }
                    setEnviando(false);
                    return;
                  }
                  try {
                    await actualizarDomicilio(d.id, { estado: nuevo });
                  } catch (err) {
                    setAvisoDom({ titulo: "No se pudo actualizar el domicilio", texto: err.message });
                    setEnviando(false);
                    return;
                  }
                  try {
                    await refrescar();
                  } catch (err) {
                    setAvisoDom({ titulo: "Acción aplicada, vista desactualizada", texto: "El domicilio se actualizó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                  }
                  setEnviando(false);
                }} />
              </div>
              {d.obs && <div className="text-xs mt-2" style={{ color: T.choco2 }}>📝 {d.obs}</div>}
            </Card>
          );
        })}
        {!listaDomicilios.length && <Empty icon={scope === "active" ? "🛵" : "◷"} text={scope === "active" ? "No hay domicilios activos." : "Todavía no hay domicilios entregados o cancelados."} />}
      </div>

      {nuevo && (
        <Modal title="Solicitar domicilio" onClose={() => setNuevo(false)}>
          <Field label="Pedido">
            <Select placeholder="Elegir pedido…" options={pedidosSinDomicilio.map((o) => o.id)} value={form.orderId} onChange={(e) => {
              const o = db.orders.find((x) => x.id === e.target.value);
              setForm({ ...form, orderId: e.target.value, zona: o ? o.zona : form.zona });
            }} />
          </Field>
          <Field label="Proveedor"><Select options={s.proveedores} value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></Field>
          <Field label="Zona"><Select options={s.zonas.map((z) => z.nombre)} value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} /></Field>
          <Field label="Costo real cotizado"><Input type="number" min="0" value={form.costoReal} onChange={(e) => setForm({ ...form, costoReal: e.target.value })} /></Field>
          <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2">
            <Btn disabled={enviando} onClick={async () => {
              if (!form.orderId) return;
              setEnviando(true);
              try {
                await crearDomicilio(form.orderId, form.proveedor, form.zona, Math.max(0, +form.costoReal || 0), form.obs);
              } catch (e) {
                setAvisoDom({ titulo: "No se pudo solicitar el domicilio", texto: e.message });
                setEnviando(false);
                return;
              }
              try {
                await refrescar();
              } catch (e) {
                setAvisoDom({ titulo: "Acción aplicada, vista desactualizada", texto: "El domicilio se solicitó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                setEnviando(false);
                setNuevo(false);
                return;
              }
              setEnviando(false);
              setNuevo(false);
            }}>Solicitar</Btn>
            <Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}

      {avisoDom && (
        <Modal title={avisoDom.titulo} onClose={() => setAvisoDom(null)}>
          <p className="text-sm m-0">{avisoDom.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAvisoDom(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= RECLAMOS ================= */

const RECLAMO_TIPOS = ["Producto faltante","Producto equivocado","Daño en entrega","Producto derretido","Error de sabor","Inconformidad de sabor","Retraso","Reclamo dudoso","Reclamo por calidad"];

function minutosEntre(a, b) {
  if (!a || !b || a === "—") return null;
  const [h1, m1] = a.split(":").map(Number); const [h2, m2] = b.split(":").map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

// Minutos reales entre entrega y reclamo. Usa entregadoEn/reclamoEn (con fecha y hora);
// si faltan, cae al cálculo por horas hEntrega/hReclamo.
function minutosReclamo(r) {
  const ent = selloAMs(r.entregadoEn);
  const rec = selloAMs(r.reclamoEn);
  if (ent && rec) return Math.round((rec - ent) / 60000);
  return minutosEntre(r.hEntrega, r.hReclamo);
}

function Reclamos({ db, update, user, focus, refrescar }) {
  const [sel, setSel] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const claimBuckets = useMemo(() => partitionByActivity(db.claims, isActiveClaim), [db.claims]);
  const [scope, setScope] = useState(() => {
    const highlighted = focus?.claimId && db.claims.find((claim) => claim.id === focus.claimId);
    return highlighted && !isActiveClaim(highlighted) ? "history" : "active";
  });
  const listaReclamos = scope === "active" ? claimBuckets.active : claimBuckets.history;
  const highlightId = focus && focus.claimId;
  const highlightRef = useRef(null);
  useEffect(() => {
    if (highlightRef.current) highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);
  return (
    <div>
      <div className="text-xs font-bold p-2.5 rounded-xl mb-4" style={{ background: T.vainilla, color: T.choco2 }}>
        📋 Política: reclamos por estado del producto se aceptan máximo 20 minutos después de recibido, salvo calidad o inocuidad.
      </div>
      <div className="mb-4"><WorkScopeTabs value={scope} onChange={setScope} activeCount={claimBuckets.active.length} historyCount={claimBuckets.history.length} activeLabel="Casos activos" /></div>
      <SectionTitle>{scope === "active" ? "Casos por resolver" : "Historial de reclamos"}</SectionTitle>
      <div className="grid lg:grid-cols-2 gap-3">
        {listaReclamos.map((r) => {
          const c = customerOf(db, r.customerId);
          const min = minutosReclamo(r);
          const previos = db.claims.filter((x) => x.customerId === r.customerId && x.id !== r.id).length;
          const fuera = min !== null && min > 20;
          const hl = highlightId === r.id;
          return (
            <div key={r.id} ref={hl ? highlightRef : null} className="rounded-2xl" style={hl ? { boxShadow: `0 0 0 3px ${T.coral}` } : undefined}>
            <Card className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-bold">{r.id} · {r.tipo}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>Pedido {r.orderId} · {c.nombre}</div>
                </div>
                <Badge label={r.estado} />
              </div>
              <div className="text-sm mt-2">{r.desc}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {min !== null && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: fuera ? "#F6D4CD" : "#DDEBD9", color: fuera ? "#A03B2A" : "#3F6B42" }}>
                    ⏱️ {min} min después de la entrega {fuera && "· fuera de ventana"}
                  </span>
                )}
                {previos > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>Cliente con {previos} reclamo(s) anterior(es)</span>}
                {r.evidencia && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>📷 {r.evidencia}</span>}
              </div>
              {r.decision && <div className="text-xs mt-2"><b>Decisión:</b> {r.decision}</div>}
              {r.solucion && <div className="text-xs mt-1"><b>Solución:</b> {r.solucion} {r.costo > 0 && `(costo ${fmt(r.costo)})`}</div>}
              <div className="flex gap-2 mt-3 items-center flex-wrap">
                <MiniSelect options={["Abierto","En revisión","Aprobado","Rechazado","Compensado","Cerrado"]} value={r.estado} disabled={enviando || scope === "history"} onChange={async (e) => {
                  const estado = e.target.value;
                  setEnviando(true);
                  try {
                    await setReclamoEstado(r.id, estado);
                  } catch (err) {
                    setAviso({ titulo: "Acción no permitida", texto: err.message });
                    setEnviando(false);
                    return;
                  }
                  try {
                    await refrescar();
                  } catch (err) {
                    setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El estado del caso se actualizó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                  }
                  setEnviando(false);
                }} />
                {scope === "active" ? <Btn small kind="ghost" onClick={() => setSel({ ...r })}>Editar caso</Btn> : <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>Caso cerrado · solo consulta</span>}
              </div>
            </Card>
            </div>
          );
        })}
        {listaReclamos.length === 0 && <Empty icon={scope === "active" ? "🎉" : "◷"} text={scope === "active" ? "Sin reclamos activos." : "Todavía no hay reclamos cerrados."} />}
      </div>

      {sel && (
        <Modal title={`Editar ${sel.id}`} onClose={() => setSel(null)}>
          <Field label="Tipo de reclamo"><Select options={RECLAMO_TIPOS} value={sel.tipo} onChange={(e) => setSel({ ...sel, tipo: e.target.value })} /></Field>
          <Field label="Descripción"><Input value={sel.desc} onChange={(e) => setSel({ ...sel, desc: e.target.value })} /></Field>
          <Field label="Hora de entrega (HH:MM)"><Input value={sel.hEntrega} onChange={(e) => setSel({ ...sel, hEntrega: e.target.value })} /></Field>
          <Field label="Responsable interno"><Input value={sel.resp} onChange={(e) => setSel({ ...sel, resp: e.target.value })} /></Field>
          <Field label="Decisión"><Input value={sel.decision} onChange={(e) => setSel({ ...sel, decision: e.target.value })} /></Field>
          <Field label="Solución dada"><Input value={sel.solucion} onChange={(e) => setSel({ ...sel, solucion: e.target.value })} /></Field>
          <Field label="Costo de la solución"><Input type="number" value={sel.costo} onChange={(e) => setSel({ ...sel, costo: +e.target.value })} /></Field>
          <div className="flex gap-2 mt-2">
            <Btn disabled={enviando} onClick={async () => {
              const hEntrega = sel.hEntrega && sel.hEntrega !== "—" ? sel.hEntrega : "";
              setEnviando(true);
              try {
                await editarReclamo(sel.id, { tipo: sel.tipo, descr: sel.desc, resp: sel.resp, decision: sel.decision, solucion: sel.solucion, costo: sel.costo, h_entrega: hEntrega });
              } catch (e) {
                setAviso({ titulo: "Acción no permitida", texto: e.message });
                setEnviando(false);
                return;
              }
              try {
                await refrescar();
              } catch (e) {
                setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El caso se guardó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                setEnviando(false);
                setSel(null);
                return;
              }
              setEnviando(false);
              setSel(null);
            }}>Guardar caso</Btn>
            <Btn kind="ghost" onClick={() => setSel(null)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
      {aviso && (
        <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
          <p className="text-sm m-0">{aviso.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= CLIENTES / CRM ================= */

const ESTADOS_CLIENTE = ["Nuevo", "Recurrente", "VIP", "Inactivo", "Riesgo por reclamos"];

function Clientes({ db, update, user, refrescar }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [detalleVista, setDetalleVista] = useState("resumen");
  const [form, setForm] = useState(null); // null = cerrado; objeto = alta/edición
  const [err, setErr] = useState("");
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [crmForm, setCrmForm] = useState(null);
  const hoy = hoyISO();

  function abrirNuevo() {
    setErr(""); setSel(null);
    setForm({ id: null, nombre: "", telefono: "", instagram: "", canal: "WhatsApp", barrio: "", direccion: "", cumple: "", favoritos: "", estado: "Nuevo", notas: "" });
  }
  function abrirEdicion(c) {
    setErr(""); setSel(null);
    setForm({ id: c.id, nombre: c.nombre || "", telefono: c.telefono || "", instagram: c.instagram || "", canal: c.canal || "WhatsApp", barrio: c.barrio || "", direccion: c.direccion || "", cumple: c.cumple || "", favoritos: c.favoritos || "", estado: c.estado || "Nuevo", notas: c.notas || "" });
  }
  async function guardarCliente() {
    const nombre = form.nombre.trim();
    const telefono = form.telefono.trim();
    if (!nombre || !telefono) { setErr("Nombre y teléfono son obligatorios."); return; }
    const campos = { nombre, telefono, instagram: form.instagram.trim(), canal: form.canal, barrio: form.barrio.trim(), direccion: form.direccion.trim(), cumple: form.cumple, favoritos: form.favoritos.trim(), estado: form.estado, notas: form.notas.trim() };
    setEnviando(true);
    try {
      await upsertCliente(form.id || null, campos);
    } catch (e) {
      setErr(e.message);
      setEnviando(false);
      return;
    }
    try {
      await refrescar();
    } catch (e) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El cliente se guardó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
      setEnviando(false);
      setForm(null);
      return;
    }
    setEnviando(false);
    setForm(null);
  }
  const lista = db.customers.filter((c) => (c.nombre + c.telefono + (c.barrio || "")).toLowerCase().includes(q.toLowerCase()));
  const crm = sel ? buildCustomerCrm(db, sel.id, hoy) : null;
  const clientesConCompra = db.customers.filter((cliente) => (cliente.pedidos || 0) > 0).length;
  const clientesRecurrentes = db.customers.filter((cliente) => (cliente.pedidos || 0) >= 2).length;
  const clientesPorReactivar = db.customers.filter((cliente) => cliente.ultima && diasEntre(cliente.ultima, hoy) >= 15).length;

  function abrirDetalleCliente(cliente) {
    setDetalleVista("resumen");
    setSel(cliente);
  }

  async function ejecutarCrm(action) {
    setEnviando(true); setErr("");
    try { await action(); await refrescar(); setCrmForm(null); }
    catch (e) { setErr(e.message); }
    finally { setEnviando(false); }
  }

  const alertas = [];
  db.customers.forEach((c) => {
    if (c.ultima) {
      const dias = diasEntre(c.ultima, hoy);
      if (dias >= 30) alertas.push([`🚨 ${c.nombre} no compra hace ${dias} días`, "#A03B2A", "#F6D4CD"]);
      else if (dias >= 15) alertas.push([`💤 ${c.nombre} no compra hace ${dias} días`, "#96690F", "#FBE8C8"]);
    }
    if (c.cumple) {
      const [mm, dd] = c.cumple.split("-").map(Number);
      const prox = new Date(); prox.setMonth(mm - 1, dd);
      if (prox < new Date()) prox.setFullYear(prox.getFullYear() + 1);
      const faltan = Math.round((prox - new Date()) / 86400000);
      if (faltan <= 15) alertas.push([`🎂 ${c.nombre} cumple años en ${faltan} día(s)`, "#8E4B5A", "#F3D7DC"]);
    }
  });
  db.benefits.filter((b) => b.estado === "Activo" && diasEntre(hoy, b.vence) <= 3).forEach((b) => {
    const c = customerOf(db, b.customerId);
    if (c.nombre) alertas.push([`⏳ Beneficio de ${c.nombre} (${b.beneficio}) vence el ${b.vence}`, "#63518A", "#E8E0F2"]);
  });

  function exportar() {
    downloadCSV("clientes",
      ["Nombre","Teléfono","Instagram","Barrio","Dirección","Canal","Primera compra","Última compra","Total","Pedidos","Ticket promedio","Cumpleaños","Favoritos","Estado"],
      db.customers.map((c) => [c.nombre, c.telefono, c.instagram, c.barrio, c.direccion, c.canal, c.primera, c.ultima, c.total, c.pedidos, Math.round(c.total / Math.max(c.pedidos, 1)), c.cumple, c.favoritos, c.estado]));
  }

  return (
    <div>
      <SectionTitle action={<div className="flex gap-2"><Btn small kind="rosa" onClick={abrirNuevo}>＋ Nuevo cliente</Btn><Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn></div>}>Alertas de CRM</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="💗" label="Clientes" value={db.customers.length} sub="fichas registradas" />
        <Stat icon="🛍️" label="Con compra" value={clientesConCompra} sub="historial comercial" tone="#3F6B42" />
        <Stat icon="🔁" label="Recurrentes" value={clientesRecurrentes} sub="dos compras o más" tone="#63518A" />
        <Stat icon="💬" label="Por reactivar" value={clientesPorReactivar} sub="15 días o más" tone={clientesPorReactivar ? "#96690F" : "#3F6B42"} />
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        {alertas.slice(0, 4).map(([t, fg, bg], i) => <div key={i} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: bg, color: fg }}>{t}</div>)}
        {alertas.length > 4 && <div className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>+ {alertas.length - 4} alertas adicionales disponibles dentro de las fichas CRM.</div>}
        {alertas.length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin alertas activas.</div>}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o barrio…"
        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none mb-3" style={inputStyle} />

      <SectionTitle>Directorio de clientes</SectionTitle>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lista.map((c) => (
          <Card key={c.id} aria-label={`Abrir ficha CRM de ${c.nombre}`} className="p-4" onClick={() => abrirDetalleCliente(c)}>
            <div className="flex justify-between items-start gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center display text-base shrink-0" style={{ background: T.rosa, color: "#8E4B5A" }}>
                  {c.nombre.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{c.nombre}</div>
                  <div className="text-xs truncate" style={{ color: T.choco2 }}>{c.telefono} · {c.barrio}</div>
                </div>
              </div>
              <Badge label={c.estado} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Compras</div><div className="display text-lg mt-0.5">{c.pedidos || 0}</div></div>
              <div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Valor cliente</div><div className="font-bold text-sm mt-1 truncate">{fmt(c.total || 0)}</div></div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-3"><div className="text-[11px] font-semibold truncate" style={{ color: T.choco2 }}>{c.ultima ? `Última compra ${c.ultima}` : "Lead sin compras"}</div><Badge label={c.canal || "WhatsApp"} map={CANAL_STYLE} /></div>
            <div className="text-[11px] font-extrabold mt-3" style={{ color: T.coral }}>Abrir ficha CRM ›</div>
          </Card>
        ))}
        {lista.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><Empty icon="💗" text="No encontramos clientes con esa búsqueda." /></div>}
      </div>

      {sel && (
        <Modal title={`Cliente · ${sel.nombre}`} onClose={() => setSel(null)} wide>
          {!db.crmServerReady && <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>CRM en modo consulta. Aplicá la migración 15 para registrar contactos, activaciones y preferencias.</div>}
          {/* Tira de identidad — plana, dentro de la paleta */}
          <div className="momo-trace-open flex items-center gap-3 rounded-2xl p-3 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}`, animationDelay: "20ms" }}>
            <div className="w-11 h-11 rounded-full flex items-center justify-center display text-lg shrink-0" style={{ background: T.vainilla, color: T.rosaDeep, boxShadow: "inset 0 0 0 1px rgba(196,128,142,.2)" }}>
              {(sel.nombre || "·").split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0">
              <div className="flex gap-1.5 flex-wrap"><Badge label={sel.estado} /><Badge label={sel.canal} map={CANAL_STYLE} /></div>
              {(sel.telefono || sel.barrio) && <div className="text-xs font-semibold mt-1 truncate" style={{ color: T.choco2, fontVariantNumeric: "tabular-nums" }}>{sel.telefono}{sel.telefono && sel.barrio ? " · " : ""}{sel.barrio}</div>}
            </div>
          </div>
          {/* Métricas — tiles planos vainilla con count-up */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[["Compras", <CountUp value={crm.purchases} />], ["Valor cliente", <CountUp value={crm.spend} format={fmt} />], ["Ticket", <CountUp value={crm.averageTicket} format={fmt} />], ["Ficha", <CountUp value={crmCompleteness(crm)} format={(v) => `${v}%`} />]].map(([label, node], i) => (
              <div key={label} className="momo-crm-tile momo-trace-open rounded-xl p-2 text-center" style={{ background: T.vainilla, animationDelay: `${70 + i * 55}ms` }}>
                <div className="display font-semibold text-base" style={{ fontVariantNumeric: "tabular-nums" }}>{node}</div>
                <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div role="tablist" aria-label="Secciones de la ficha CRM" className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl mb-3" style={{ background: T.vainilla }}>
            {[["resumen", "Resumen"], ["compras", `Pedidos ${crm.orders.length}`], ["seguimiento", `Relación ${crm.contacts.length + crm.activations.length + db.benefits.filter((benefit) => benefit.customerId === sel.id).length + db.claims.filter((claim) => claim.customerId === sel.id).length}`]].map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={detalleVista === value} onClick={() => setDetalleVista(value)} className="rounded-xl px-3 py-2 text-xs font-extrabold" style={{ background: detalleVista === value ? T.coral : "transparent", color: detalleVista === value ? "white" : T.choco2 }}>{label}</button>
            ))}
          </div>
          {detalleVista === "resumen" && <>
          {/* Siguiente mejor acción — colores originales, sin cambios */}
          <div className="momo-trace-open p-3 rounded-2xl mb-3" style={{ background: crm.nextAction.type === "blocked" ? "#F6D4CD" : "#E6F1E3", border: `1px solid ${crm.nextAction.type === "blocked" ? "#E8A697" : "#B8D2B2"}`, animationDelay: "290ms" }}>
            <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: crm.nextAction.type === "blocked" ? "#A03B2A" : "#3F6B42" }}>Siguiente mejor acción</div>
            <div className="font-bold text-sm mt-0.5">{crm.nextAction.label}</div><div className="text-xs mt-0.5">{crm.nextAction.detail}</div>
          </div>
          {/* Contacto — sin duplicar métricas (tel movido a la tira; total/ticket ya en métricas) */}
          <div className="momo-trace-open text-sm space-y-1.5 rounded-2xl p-3 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}`, animationDelay: "330ms" }}>
            <div>📍 {sel.direccion} ({sel.barrio})</div>
            <div style={{ fontVariantNumeric: "tabular-nums" }}>🗓️ {crm.firstPurchase ? <>Primera compra <b>{crm.firstPurchase}</b> · última <b>{crm.lastPurchase}</b></> : <span style={{ color: T.choco2 }}>Sin compras entregadas aún (lead)</span>}</div>
            {sel.instagram && <div>📸 {sel.instagram}</div>}
            {sel.cumple && <div>🎂 Cumpleaños: {sel.cumple}</div>}
            {sel.favoritos && <div>💗 {sel.favoritos}</div>}
          </div>
          <div className="momo-trace-open mt-3" style={{ animationDelay: "370ms" }}>
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>GUSTOS REALES SEGÚN COMPRAS</div>
            {crm.automaticFavorites.length ? <div className="flex flex-wrap gap-1.5">{crm.automaticFavorites.map((favorite) => <span key={favorite.label} className="text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: T.rosa, color: "#8E4B5A" }}>{favorite.label} <span style={{ background: "rgba(255,255,255,.6)", borderRadius: "999px", padding: "0 6px", fontVariantNumeric: "tabular-nums" }}>{favorite.quantity}</span></span>)}</div> : <div className="text-sm" style={{ color: T.choco2 }}>Aún no hay compras entregadas para aprender sus gustos.</div>}
          </div>
          {sel.notas && <div className="text-xs mt-3 p-2.5 rounded-xl" style={{ background: T.vainilla }}>📝 {sel.notas}</div>}
          </>}
          {detalleVista === "compras" && <>
          <div className="momo-trace-open mt-3" style={{ animationDelay: "410ms" }}>
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>HISTORIAL DE PEDIDOS</div>
            {crm.orders.map((order) => <div key={order.id} className="momo-crm-row flex justify-between gap-3 text-sm px-2 py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="min-w-0"><b>{order.id}</b> · <span style={{ fontVariantNumeric: "tabular-nums" }}>{order.fecha}</span><div className="text-xs" style={{ color: T.choco2 }}>{order.itemsCrm.map((item) => `${item.cant}× ${item.nombre}${item.figura ? ` ${item.figura}` : ""}${item.sabor ? ` de ${item.sabor}` : ""}`).join("; ") || "Sin líneas"}</div></div><div className="text-right shrink-0"><Badge label={order.estado} /><div className="text-xs font-bold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(order.totalCrm)}</div></div></div>)}
            {!crm.orders.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin pedidos todavía.</div>}
          </div>
          </>}
          {detalleVista === "seguimiento" && <>
          <div className="mt-3">
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>SEGUIMIENTO COMERCIAL</div>
            {crm.contacts.map((contact) => <div key={contact.id} className="text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="flex justify-between gap-2"><b>{contact.channel} · {contact.reason}</b><Badge label={contact.outcome} /></div><div className="text-xs" style={{ color: T.choco2 }}>{contact.createdAt}{contact.createdByName ? ` · ${contact.createdByName}` : ""}{contact.followUpOn ? ` · seguimiento ${contact.followUpOn}` : ""}</div></div>)}
            {!crm.contacts.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin contactos registrados.</div>}
          </div>
          <div className="mt-3">
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>ACTIVACIONES PUNTUALES</div>
            {crm.activations.map((activation) => <div key={activation.id} className="text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="flex justify-between gap-2"><div><b>{activation.title}</b><div className="text-xs" style={{ color: T.choco2 }}>{activation.type}{activation.expiresOn ? ` · vence ${activation.expiresOn}` : ""}{activation.convertedOrderId ? ` · pedido ${activation.convertedOrderId}` : ""}</div></div><div className="flex items-center gap-2"><Badge label={activation.status} />{!activation.convertedOrderId && <Btn small kind="ghost" onClick={() => { setErr(""); setCrmForm({ type: "conversion", activationId: activation.id, orderId: "" }); }}>Atribuir pedido</Btn>}</div></div></div>)}
            {!crm.activations.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin activaciones creadas.</div>}
          </div>
          <div className="mt-3">
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>BENEFICIOS</div>
            {db.benefits.filter((b) => b.customerId === sel.id).map((b) => (
              <div key={b.id} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                <span>🎁 {b.beneficio} <span className="text-xs" style={{ color: T.choco2 }}>· vence {b.vence}{b.pedidoUso && ` · usado en ${b.pedidoUso}`}</span></span><Badge label={b.estado} />
              </div>
            ))}
            {db.benefits.filter((b) => b.customerId === sel.id).length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin beneficios.</div>}
          </div>
          <div className="mt-3">
            <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>RECLAMOS</div>
            {db.claims.filter((r) => r.customerId === sel.id).map((r) => (
              <div key={r.id} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                <span>{r.id} · {r.tipo}</span><Badge label={r.estado} />
              </div>
            ))}
            {db.claims.filter((r) => r.customerId === sel.id).length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin reclamos. 💛</div>}
          </div>
          </>}
          <div className="mt-4 flex justify-end gap-2 flex-wrap">
            <Btn small kind="soft" disabled={!db.crmServerReady} onClick={() => { setErr(""); setCrmForm({ type: "preferences", contactAllowed: crm.profile.contactAllowed !== false, preferredChannel: crm.profile.preferredChannel || "WhatsApp", acquisitionSource: crm.profile.acquisitionSource || "", contactReason: crm.profile.contactReason || "" }); }}>Preferencias</Btn>
            <Btn small kind="soft" disabled={!db.crmServerReady || crm.profile.contactAllowed === false} onClick={() => { setErr(""); setCrmForm({ type: "contact", channel: crm.profile.preferredChannel === "No contactar" ? "WhatsApp" : (crm.profile.preferredChannel || "WhatsApp"), reason: crm.nextAction.label, outcome: "Enviado", notes: "", followUpOn: "" }); }}>Registrar contacto</Btn>
            <Btn small kind="soft" disabled={!db.crmServerReady || crm.profile.contactAllowed === false} onClick={() => { setErr(""); setCrmForm({ type: "activation", activationType: crm.nextAction.type === "reactivation" ? "Reactivación" : "Seguimiento", title: crm.nextAction.label, message: crm.nextAction.detail, expiresOn: dISO(7) }); }}>Nueva activación</Btn>
            <Btn small kind="rosa" onClick={() => abrirEdicion(sel)}>✏️ Editar cliente</Btn>
          </div>
        </Modal>
      )}

      {sel && crmForm?.type === "preferences" && (
        <Modal title="Preferencias de contacto" onClose={() => setCrmForm(null)}>
          <label className="flex items-center gap-2 text-sm font-bold mb-3"><input type="checkbox" checked={crmForm.contactAllowed} onChange={(e) => setCrmForm({ ...crmForm, contactAllowed: e.target.checked, preferredChannel: e.target.checked ? "WhatsApp" : "No contactar" })} /> Puede recibir mensajes comerciales</label>
          <Field label="Canal preferido"><Select options={["WhatsApp","Instagram","Llamada","No contactar"]} value={crmForm.preferredChannel} onChange={(e) => setCrmForm({ ...crmForm, preferredChannel: e.target.value, contactAllowed: e.target.value !== "No contactar" })} /></Field>
          <Field label="Cómo llegó"><Input value={crmForm.acquisitionSource} onChange={(e) => setCrmForm({ ...crmForm, acquisitionSource: e.target.value })} placeholder="Instagram, referido, Rappi…" /></Field>
          {!crmForm.contactAllowed && <Field label="Motivo de no contacto"><Input value={crmForm.contactReason} onChange={(e) => setCrmForm({ ...crmForm, contactReason: e.target.value })} /></Field>}
          {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
          <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando} onClick={() => ejecutarCrm(() => guardarPreferenciasCliente(sel.id, { contact_allowed: crmForm.contactAllowed, preferred_channel: crmForm.preferredChannel, acquisition_source: crmForm.acquisitionSource, contact_reason: crmForm.contactReason }))}>Guardar</Btn></div>
        </Modal>
      )}
      {sel && crmForm?.type === "contact" && (
        <Modal title="Registrar contacto" onClose={() => setCrmForm(null)}>
          <Field label="Canal"><Select options={["WhatsApp","Instagram","Llamada","Presencial","Otro"]} value={crmForm.channel} onChange={(e) => setCrmForm({ ...crmForm, channel: e.target.value })} /></Field>
          <Field label="Motivo"><Input value={crmForm.reason} onChange={(e) => setCrmForm({ ...crmForm, reason: e.target.value })} /></Field>
          <Field label="Resultado"><Select options={["Pendiente","Enviado","Respondió","Interesado","No interesado","No respondió","Venta"]} value={crmForm.outcome} onChange={(e) => setCrmForm({ ...crmForm, outcome: e.target.value })} /></Field>
          <Field label="Próximo seguimiento"><Input type="date" value={crmForm.followUpOn} onChange={(e) => setCrmForm({ ...crmForm, followUpOn: e.target.value })} /></Field>
          <Field label="Notas"><Input value={crmForm.notes} onChange={(e) => setCrmForm({ ...crmForm, notes: e.target.value })} /></Field>
          {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
          <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || crmForm.reason.trim().length < 3} onClick={() => ejecutarCrm(() => registrarContactoCliente({ customer_id: sel.id, channel: crmForm.channel, reason: crmForm.reason, outcome: crmForm.outcome, notes: crmForm.notes, follow_up_on: crmForm.followUpOn }))}>Registrar</Btn></div>
        </Modal>
      )}
      {sel && crmForm?.type === "activation" && (
        <Modal title="Nueva activación puntual" onClose={() => setCrmForm(null)}>
          <Field label="Tipo"><Select options={["Reactivación","Cumpleaños","Fidelización","Seguimiento","Recuperación","Otro"]} value={crmForm.activationType} onChange={(e) => setCrmForm({ ...crmForm, activationType: e.target.value })} /></Field>
          <Field label="Objetivo"><Input value={crmForm.title} onChange={(e) => setCrmForm({ ...crmForm, title: e.target.value })} /></Field>
          <Field label="Mensaje sugerido"><textarea value={crmForm.message} onChange={(e) => setCrmForm({ ...crmForm, message: e.target.value })} className={`${inputCls} min-h-24`} style={inputStyle} /></Field>
          <Field label="Vence"><Input type="date" value={crmForm.expiresOn} onChange={(e) => setCrmForm({ ...crmForm, expiresOn: e.target.value })} /></Field>
          {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
          <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || crmForm.title.trim().length < 3} onClick={() => ejecutarCrm(() => crearActivacionCliente({ customer_id: sel.id, type: crmForm.activationType, title: crmForm.title, message: crmForm.message, expires_on: crmForm.expiresOn }))}>Crear activación</Btn></div>
        </Modal>
      )}
      {sel && crmForm?.type === "conversion" && (
        <Modal title="Atribuir conversión" onClose={() => setCrmForm(null)}>
          <div className="text-xs font-semibold p-2.5 rounded-xl mb-3" style={{ background: T.vainilla, color: T.choco2 }}>Elegí un pedido real del mismo cliente. El servidor rechazará pedidos cancelados, ajenos o ya atribuidos.</div>
          <Field label="Pedido convertido">
            <select value={crmForm.orderId} onChange={(e) => setCrmForm({ ...crmForm, orderId: e.target.value })} className={inputCls} style={inputStyle}>
              <option value="">Elegir pedido…</option>
              {crm.orders.filter((order) => order.estado !== "Cancelado").map((order) => <option key={order.id} value={order.id}>{order.id} · {order.fecha} · {order.estado} · {fmt(order.totalCrm)}</option>)}
            </select>
          </Field>
          {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
          <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || !crmForm.orderId} onClick={() => ejecutarCrm(() => convertirActivacionCliente(crmForm.activationId, crmForm.orderId))}>Confirmar conversión</Btn></div>
        </Modal>
      )}

      {form && (
        <Modal title={form.id ? "Editar cliente" : "Nuevo cliente (lead)"} onClose={() => setForm(null)}>
          {!form.id && (
            <div className="text-xs font-semibold p-2.5 rounded-xl mb-3" style={{ background: T.vainilla, color: T.choco2 }}>
              Alta manual de un prospecto/lead antes de su primer pedido. Las métricas (pedidos, total) arrancan en 0 y se llenan solas cuando compre.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nombre *"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Field>
            <Field label="Teléfono *"><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Instagram"><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" /></Field>
            <Field label="Canal"><Select options={CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Barrio"><Input value={form.barrio} onChange={(e) => setForm({ ...form, barrio: e.target.value })} /></Field>
            <Field label="Dirección"><Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cumpleaños"><Input type="date" value={form.cumple ? "2000-" + form.cumple : ""} onChange={(e) => setForm({ ...form, cumple: e.target.value ? e.target.value.slice(5) : "" })} /></Field>
            <Field label="Estado"><Select options={ESTADOS_CLIENTE} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
          </div>
          <Field label="Favoritos"><Input value={form.favoritos} onChange={(e) => setForm({ ...form, favoritos: e.target.value })} placeholder="Ej: Maracuyá · Gatito" /></Field>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          {err && <div className="text-sm font-bold mb-3" style={{ color: T.coral }}>{err}</div>}
          <div className="flex justify-end gap-2">
            <Btn kind="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
            <Btn kind="rosa" disabled={enviando} onClick={guardarCliente}>Guardar</Btn>
          </div>
        </Modal>
      )}
      {aviso && (
        <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
          <p className="text-sm m-0">{aviso.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= BENEFICIOS ================= */

const TIPOS_BENEFICIO = [
  { tipo: "descuento_porcentaje", label: "Descuento %" },
  { tipo: "descuento_valor_fijo", label: "Descuento valor fijo ($)" },
  { tipo: "producto_gratis", label: "Producto gratis" },
];

function labelBeneficio(b, db) {
  if (b.tipoBeneficio === "descuento_porcentaje") return b.valor + "% descuento";
  if (b.tipoBeneficio === "descuento_valor_fijo") return fmt(b.valor) + " de descuento";
  const p = productOf(db, b.productoGratisId);
  return (p ? p.nombre : "Producto") + " gratis";
}

function Beneficios({ db, update, user, refrescar }) {
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ customerId: "", tipoBeneficio: "descuento_porcentaje", valor: 20, productoGratisId: "PR11", condicion: "Historia en Instagram", minimo: 30000, vence: dISO(15), obs: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  return (
    <div>
      <div className="text-xs font-bold p-2.5 rounded-xl mb-4" style={{ background: T.vainilla, color: T.choco2 }}>
        Ciclo del beneficio: <b>Activo</b> → <b>Reservado</b> (al crear el pedido) → <b>Usado</b> (al confirmar el pago). Si el pedido se cancela, vuelve a Activo. Un beneficio por pedido, no acumulable, no aplica sobre el domicilio.
      </div>
      <div className="mb-4"><Btn onClick={() => setNuevo(true)}>＋ Activar beneficio</Btn></div>
      <div className="grid sm:grid-cols-2 gap-3">
        {db.benefits.map((b) => {
          const c = customerOf(db, b.customerId);
          const vencido = b.estado === "Activo" && b.vence < hoyISO();
          return (
            <Card key={b.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-bold text-sm">🎁 {labelBeneficio(b, db)}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{c.nombre} · {b.condicion}</div>
                </div>
                <Badge label={vencido ? "Vencido" : b.estado} />
              </div>
              <div className="text-xs mt-2" style={{ color: T.choco2 }}>
                Mínimo {fmt(b.minimo)} · activado {b.activacion} · vence <b style={{ color: diasEntre(hoyISO(), b.vence) <= 3 && b.estado === "Activo" ? "#A03B2A" : T.choco2 }}>{b.vence}</b>
                {b.pedidoUso && <> · pedido <b>{b.pedidoUso}</b></>}
              </div>
              {b.estado === "Reservado" && <div className="text-xs font-bold mt-1.5" style={{ color: "#63518A" }}>⏳ Reservado: pasará a Usado cuando el pedido {b.pedidoUso} se marque pagado, o volverá a Activo si se cancela.</div>}
              {b.obs && <div className="text-xs mt-1.5">📝 {b.obs}</div>}
              {b.estado === "Activo" && (
                <div className="text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>Se reserva al crear el pedido y se marca usado al confirmar el pago; no requiere ajuste manual.</div>
              )}
            </Card>
          );
        })}
      </div>

      {nuevo && (
        <Modal title="Activar beneficio" onClose={() => setNuevo(false)}>
          <Field label="Cliente">
            <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className={inputCls} style={inputStyle}>
              <option value="">Elegir cliente…</option>
              {db.customers.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Tipo de beneficio">
            <select value={form.tipoBeneficio} onChange={(e) => setForm({ ...form, tipoBeneficio: e.target.value })} className={inputCls} style={inputStyle}>
              {TIPOS_BENEFICIO.map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
            </select>
          </Field>
          {form.tipoBeneficio === "descuento_porcentaje" && (
            <Field label="Porcentaje de descuento"><Input type="number" min="1" max="100" value={form.valor} onChange={(e) => setForm({ ...form, valor: +e.target.value })} /></Field>
          )}
          {form.tipoBeneficio === "descuento_valor_fijo" && (
            <Field label="Valor del descuento ($)"><Input type="number" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: +e.target.value })} /></Field>
          )}
          {form.tipoBeneficio === "producto_gratis" && (
            <Field label="Producto gratis">
              <select value={form.productoGratisId} onChange={(e) => setForm({ ...form, productoGratisId: e.target.value })} className={inputCls} style={inputStyle}>
                {db.products.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Field>
          )}
          <Field label="Condición"><Input value={form.condicion} onChange={(e) => setForm({ ...form, condicion: e.target.value })} placeholder="Historia, referido, cumpleaños, Club Sweet Love…" /></Field>
          <Field label="Compra mínima"><Input type="number" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: +e.target.value })} /></Field>
          <Field label="Vence"><Input type="date" value={form.vence} onChange={(e) => setForm({ ...form, vence: e.target.value })} /></Field>
          <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
          {!db.crmServerReady && <div className="text-xs font-bold mb-2" style={{ color: "#A03B2A" }}>Aplicá la migración 15 para activar beneficios de forma persistente y auditada.</div>}
          {error && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{error}</div>}
          <div className="flex gap-2 mt-2">
            <Btn disabled={!db.crmServerReady || enviando || !form.customerId} onClick={async () => {
              setError(""); setEnviando(true);
              try {
                await activarBeneficioCliente({ customer_id: form.customerId, tipo_beneficio: form.tipoBeneficio, valor: form.valor, producto_gratis_id: form.tipoBeneficio === "producto_gratis" ? form.productoGratisId : "", condicion: form.condicion, minimo: form.minimo, vence: form.vence, obs: form.obs });
                await refrescar(); setNuevo(false);
              } catch (e) { setError(e.message); }
              finally { setEnviando(false); }
            }}>Activar</Btn>
            <Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= FINANZAS ================= */

/* ================= REPORTES ================= */

function Reportes({ db }) {
  const [desde, setDesde] = useState(dISO(-14));
  const [hasta, setHasta] = useState(hoyISO());
  const validos = db.orders.filter((o) => esPedidoCobrado(o) && o.fecha >= desde && o.fecha <= hasta);

  const porDia = {};
  validos.forEach((o) => { porDia[o.fecha] = (porDia[o.fecha] || 0) + orderTotal(db, o); });
  const ventasDia = Object.entries(porDia).sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([label, value]) => ({ label: label.slice(5), value, color: label === hoyISO() ? T.coral : undefined }));

  const porProducto = {}, porSabor = {}, porFigura = {}, porBarrio = {}, porCategoria = {};
  validos.forEach((o) => {
    porBarrio[o.barrio] = (porBarrio[o.barrio] || 0) + orderTotal(db, o);
    itemsOf(db, o.id).forEach((i) => {
      porProducto[i.nombre] = (porProducto[i.nombre] || 0) + i.cant;
      if (i.sabor) porSabor[i.sabor] = (porSabor[i.sabor] || 0) + i.cant;
      if (i.figura) porFigura[i.figura.split(" ")[0]] = (porFigura[i.figura.split(" ")[0]] || 0) + i.cant;
      const p = productOf(db, i.productId);
      if (p) porCategoria[p.cat] = (porCategoria[p.cat] || 0) + i.precio * i.cant;
    });
  });
  const top = (obj, n = 6) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));

  const ticket = Math.round(validos.reduce((s, o) => s + orderTotal(db, o), 0) / Math.max(validos.length, 1));
  const idsValidos = new Set(validos.map((o) => o.id));
  const deliveriesValidos = db.deliveries.filter((d) => idsValidos.has(d.orderId));
  const subsidio = deliveriesValidos.reduce((s, d) => s + Math.max(0, d.costoReal - d.cobrado), 0);
  const costoDomTotal = deliveriesValidos.reduce((s, d) => s + d.costoReal, 0);
  const mermaProm = db.production_batches.reduce((s, l) => s + (l.imperfectas + l.descartadas) / Math.max(l.prod, 1), 0) / Math.max(db.production_batches.length, 1);
  const recuperadas = db.production_batches.filter((l) => String(l.destino).includes("Insumo") || String(l.destino).includes("Prueba")).reduce((s, l) => s + l.imperfectas, 0);
  const nuevos = db.customers.filter((c) => diasEntre(c.primera, hoyISO()) <= 10).length;
  const recurr = db.customers.filter((c) => c.pedidos >= 2).length;
  const recompra = recurr / Math.max(db.customers.length, 1);
  const benefUsados = db.benefits.filter((b) => b.estado === "Usado").length;

  const reclamosCanal = {};
  db.claims.forEach((r) => {
    if (!r.fecha || r.fecha < desde || r.fecha > hasta) return;
    const o = db.orders.find((x) => x.id === r.orderId);
    const canal = o ? o.canal : "Otro";
    reclamosCanal[canal] = (reclamosCanal[canal] || 0) + 1;
  });

  const margenes = db.products.filter((p) => p.activo).map((p) => ({ label: p.nombre, value: Math.round(((p.precio - p.costo) / p.precio) * 100) })).sort((a, b) => b.value - a.value).slice(0, 8);

  function exportar() {
    downloadCSV("reporte-resumen",
      ["Indicador","Valor"],
      [["Rango", desde + " a " + hasta], ["Pedidos", validos.length], ["Ticket promedio", ticket],
       ["Costo real domicilios", costoDomTotal], ["Subsidio domicilios", subsidio],
       ["Merma promedio %", Math.round(mermaProm * 100)], ["Piezas recuperadas", recuperadas],
       ["Clientes nuevos (10 días)", nuevos], ["Clientes recurrentes", recurr],
       ["Recompra %", Math.round(recompra * 100)], ["Beneficios usados", benefUsados],
       ...top(porProducto, 10).map((d) => ["Producto: " + d.label, d.value]),
       ...top(porSabor, 10).map((d) => ["Sabor: " + d.label, d.value])]);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-bold" style={{ color: T.choco2 }}>Rango:</span>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
        <Stat icon="🎯" label="Ticket promedio" value={fmt(ticket)} />
        <Stat icon="🛵" label="Costo real domicilios" value={fmt(costoDomTotal)} sub={`subsidio ${fmt(subsidio)}`} tone="#96690F" />
        <Stat icon="🔁" label="Recompra" value={pct(recompra)} sub={`${recurr} de ${db.customers.length} clientes`} tone="#3F6B42" />
        <Stat icon="♻️" label="Piezas recuperadas" value={recuperadas} sub={`merma promedio ${pct(mermaProm)}`} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🆕" label="Clientes nuevos (10 días)" value={nuevos} />
        <Stat icon="💖" label="Clientes recurrentes" value={recurr} />
        <Stat icon="🎁" label="Beneficios usados" value={benefUsados} sub={`${db.benefits.filter((b) => b.estado === "Activo").length} activos`} />
        <Stat icon="⚠️" label="Reclamos totales" value={db.claims.length} />
      </div>

      <SectionTitle>Ventas por día</SectionTitle>
      <Card className="p-4"><Bars data={ventasDia} money /></Card>

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CATEGORÍA</div><Bars data={top(porCategoria)} money /></Card>
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>PRODUCTOS MÁS VENDIDOS (unidades)</div><Bars data={top(porProducto)} /></Card>
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>SABORES MÁS VENDIDOS</div><Bars data={top(porSabor)} /></Card>
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>FIGURAS MÁS VENDIDAS</div><Bars data={top(porFigura)} /></Card>
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR BARRIO</div><Bars data={top(porBarrio)} money /></Card>
        <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>RECLAMOS POR CANAL</div><Bars data={Object.entries(reclamosCanal).map(([label, value]) => ({ label, value }))} /></Card>
      </div>

      <SectionTitle>Margen estimado por producto (%)</SectionTitle>
      <Card className="p-4"><Bars data={margenes} /></Card>

      <SectionTitle>Merma por lote (%)</SectionTitle>
      <Card className="p-4">
        <Bars data={db.production_batches.map((l) => ({ label: l.id + " " + l.sabor, value: Math.round(((l.imperfectas + l.descartadas) / Math.max(l.prod, 1)) * 100), color: T.rosaDeep }))} />
      </Card>

      {(() => {
        const campM = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) }));
        const creM = (db.creatives || []).map((cr) => ({ cr, pedidos: ordersDeCreative(db, cr.id).length, ventas: ventasDeCreative(db, cr.id) }));
        const ganadores = (db.creatives || []).filter((c) => c.estado === "Ganador");
        // conversión por canal de marketing desde resultados
        const canalConv = {};
        resultadosDePlataforma(db).forEach((r) => {
          const atrib = atribucionDeResultado(db, r);
          const cre = db.creatives.find((x) => x.id === r.creativeId);
          const canal = cre ? cre.canal : "Otro";
          if (!canalConv[canal]) canalConv[canal] = { msg: 0, ped: 0 };
          canalConv[canal].msg += r.mensajesWhatsApp;
          canalConv[canal].ped += atrib.pedidos;
        });
        const bajaRent = campM.filter((x) => x.m.roas !== null && x.m.roas < 1);
        return (
          <>
            <SectionTitle>📣 Marketing · ventas y pedidos por campaña</SectionTitle>
            <div className="grid lg:grid-cols-2 gap-3">
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.ventas > 0).map((x) => ({ label: x.c.nombre, value: x.m.ventas })).sort((a, b) => b.value - a.value)} money /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>PEDIDOS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.pedidos > 0).map((x) => ({ label: x.c.nombre, value: x.m.pedidos })).sort((a, b) => b.value - a.value)} /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>ROAS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.roas !== null).map((x) => ({ label: x.c.nombre, value: +x.m.roas.toFixed(2), color: x.m.roas >= 1 ? "#3F6B42" : "#A03B2A" })).sort((a, b) => b.value - a.value)} /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>CAC POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.cac !== null).map((x) => ({ label: x.c.nombre, value: Math.round(x.m.cac), color: "#96690F" })).sort((a, b) => a.value - b.value)} money /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>TICKET PROMEDIO POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.pedidos > 0).map((x) => ({ label: x.c.nombre, value: Math.round(x.m.ticket) })).sort((a, b) => b.value - a.value)} money /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>PEDIDOS POR CREATIVO</div><Bars data={creM.filter((x) => x.pedidos > 0).map((x) => ({ label: x.cr.titulo, value: x.pedidos, color: T.rosaDeep })).sort((a, b) => b.value - a.value)} /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CREATIVO</div><Bars data={creM.filter((x) => x.ventas > 0).map((x) => ({ label: x.cr.titulo, value: x.ventas })).sort((a, b) => b.value - a.value)} money /></Card>
              <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>CANALES CON MEJOR CONVERSIÓN WA→PEDIDO</div><Bars data={Object.entries(canalConv).filter(([, v]) => v.msg > 0).map(([k, v]) => ({ label: k, value: Math.round((v.ped / v.msg) * 100) }))} /></Card>
            </div>

            <SectionTitle>🏆 Creativos ganadores</SectionTitle>
            <Card className="p-4">
              {ganadores.length === 0 ? <div className="text-sm" style={{ color: T.choco2 }}>Aún no hay creativos marcados como ganadores.</div> :
                ganadores.map((c) => (
                  <div key={c.id} className="flex justify-between items-center py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                    <span className="text-sm font-semibold">🎨 {c.titulo}</span>
                    <span className="text-xs font-bold" style={{ color: "#3F6B42" }}>{ordersDeCreative(db, c.id).length} pedidos · {fmt(ventasDeCreative(db, c.id))}</span>
                  </div>
                ))}
            </Card>

            {bajaRent.length > 0 && (
              <>
                <SectionTitle>⚠️ Campañas con baja rentabilidad (ROAS &lt; 1)</SectionTitle>
                <Card className="p-4">
                  {bajaRent.map((x) => (
                    <div key={x.c.id} className="flex justify-between items-center py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                      <span className="text-sm font-semibold">{x.c.nombre}</span>
                      <span className="text-xs font-bold" style={{ color: "#A03B2A" }}>ROAS {x.m.roas.toFixed(2)}x · gasto {fmt(x.c.gastoReal)} · ventas {fmt(x.m.ventas)}</span>
                    </div>
                  ))}
                </Card>
              </>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* ================= CONFIGURACIÓN ================= */

function Configuracion({ db, update, user, resetear, restaurarBackup, refrescar }) {
  const [nuevoItem, setNuevoItem] = useState({});
  const [confirmar, setConfirmar] = useState(false);
  const [nuevoUser, setNuevoUser] = useState({ nombre: "", email: "", rol: "Cocina" });
  const [userMsg, setUserMsg] = useState("");
  const [enviandoUser, setEnviandoUser] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [nuevaFig, setNuevaFig] = useState({ nombre: "", especie: "gato", gramaje: "150 g" });
  const [nuevoTop, setNuevoTop] = useState({ nombre: "", precio: "", insumoId: "" });
  const s = db.settings;
  const [delayDraft, setDelayDraft] = useState(() => normalizeKitchenDelaySettings(s));
  const [delayMsg, setDelayMsg] = useState("");
  const [guardandoDemoras, setGuardandoDemoras] = useState(false);
  const listas = [
    ["saboresFrutales", "Sabores frutales"], ["saboresCremosos", "Sabores cremosos"],
    ["rellenos", "Rellenos"], ["salsas", "Salsas"],
    ["pagos", "Métodos de pago"], ["proveedores", "Proveedores de domicilio"],
  ];

  useEffect(() => {
    setDelayDraft(normalizeKitchenDelaySettings(s));
  }, [s.demoraCocinaMin, s.demoraCocinaUrgenteMin, s.demoraEmpaqueMin, s.demoraEmpaqueUrgenteMin, s.demoraRepeticionMin]);

  async function guardarTiemposDemora() {
    if (guardandoDemoras) return;
    const values = Object.fromEntries(Object.entries(delayDraft).map(([key, value]) => [key, Number(value)]));
    if (Object.values(values).some((value) => !Number.isInteger(value) || value < 1)) {
      setDelayMsg("⚠️ Todos los tiempos deben ser minutos enteros mayores que cero.");
      return;
    }
    if (values.demoraCocinaUrgenteMin < values.demoraCocinaMin || values.demoraEmpaqueUrgenteMin < values.demoraEmpaqueMin) {
      setDelayMsg("⚠️ El tiempo urgente no puede ser menor que el primer aviso de su área.");
      return;
    }
    const next = normalizeKitchenDelaySettings(values);
    setGuardandoDemoras(true);
    setDelayMsg("");
    try {
      await guardarConfiguracionDemoras(next);
      update((d) => {
        Object.assign(d.settings, next);
        addAudit(d, { user, entidad: "Configuración", entidadId: "demoras_pedidos", accion: "Tiempos actualizados", a: `Cocina ${next.demoraCocinaMin}/${next.demoraCocinaUrgenteMin} · Empaque ${next.demoraEmpaqueMin}/${next.demoraEmpaqueUrgenteMin} · cada ${next.demoraRepeticionMin} min` });
      });
      setDelayDraft(next);
      setDelayMsg("✓ Tiempos guardados para todos los equipos.");
      toast("ok", "Tiempos de pedidos demorados actualizados");
      try { await refrescar?.(); } catch { /* la copia local ya refleja el cambio guardado */ }
    } catch (error) {
      setDelayMsg("⚠️ No se pudieron guardar los tiempos: " + error.message);
    } finally {
      setGuardandoDemoras(false);
    }
  }

  function agregar(k) {
    const v = (nuevoItem[k] || "").trim();
    if (!v) return;
    // política MOMOS: no se permite "Efectivo" como método de pago
    if (k === "pagos" && v.toLowerCase() === "efectivo") {
      setNuevoItem((prev) => ({ ...prev, [k]: "" }));
      return;
    }
    update((d) => {
      if (d.settings[k].includes(v)) return;
      d.settings[k] = [...d.settings[k], v];
      addAudit(d, { user, entidad: "Configuración", entidadId: k, accion: "Ítem agregado", a: v });
    });
    setNuevoItem((prev) => ({ ...prev, [k]: "" }));
  }

  function agregarFigura() {
    const nombre = (nuevaFig.nombre || "").trim();
    if (!nombre) return;
    update((d) => {
      if (d.settings.figuras.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase())) return;
      d.settings.figuras = [...d.settings.figuras, {
        nombre,
        especie: nuevaFig.especie === "perro" ? "perro" : "gato",
        gramaje: (nuevaFig.gramaje || "150 g").trim(),
      }];
      addAudit(d, { user, entidad: "Configuración", entidadId: "figuras", accion: "Figura agregada", a: nombre });
    });
    setNuevaFig({ nombre: "", especie: "gato", gramaje: "150 g" });
  }

  function agregarTopping() {
    const nombre = (nuevoTop.nombre || "").trim();
    if (!nombre) return;
    update((d) => {
      if (d.settings.toppings.some((t) => t.nombre.toLowerCase() === nombre.toLowerCase())) return;
      d.settings.toppings = [...d.settings.toppings, {
        nombre,
        precio: +nuevoTop.precio || 0,
        insumoId: nuevoTop.insumoId || "",
        insumoCant: 1,
      }];
      addAudit(d, { user, entidad: "Configuración", entidadId: "toppings", accion: "Topping agregado", a: nombre });
    });
    setNuevoTop({ nombre: "", precio: "", insumoId: "" });
  }

  return (
    <div>
      <SectionTitle>Zonas y tarifas de domicilio</SectionTitle>
      <Card className="p-4">
        {s.zonas.map((z, i) => (
          <div key={z.nombre} className="flex items-center justify-between gap-3 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
            <span className="text-sm font-semibold">{z.nombre}</span>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
              <input type="number" value={z.tarifa} onChange={(e) => update((d) => { d.settings.zonas[i].tarifa = +e.target.value; })}
                className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t" style={{ borderColor: T.border }}>
          <span className="text-sm font-semibold">Pedido mínimo (sin domicilio)</span>
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
            <input type="number" value={s.pedidoMinimo} onChange={(e) => update((d) => { d.settings.pedidoMinimo = +e.target.value; })}
              className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t" style={{ borderColor: T.border }}>
          <span className="text-sm font-semibold">Horas de congelación objetivo (por defecto)</span>
          <div className="flex items-center gap-1">
            <input type="number" min="1" value={s.horasCongelacion || 10} onChange={(e) => update((d) => { d.settings.horasCongelacion = +e.target.value; })}
              className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
            <span className="text-xs font-bold" style={{ color: T.choco2 }}>h</span>
          </div>
        </div>
      </Card>

      <SectionTitle>⏱️ Tiempos de pedidos demorados</SectionTitle>
      <Card className="p-4" style={{ background: "linear-gradient(145deg, #fff, #FFF9F1)" }}>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shrink-0" style={{ background: T.coralSoft, color: T.coral }} aria-hidden="true">⏱</span>
          <div>
            <div className="text-sm font-bold">Ritmo operativo por área</div>
            <div className="text-xs font-semibold mt-0.5 leading-relaxed" style={{ color: T.choco2 }}>
              Define cuándo Momo Ops avisa, cuándo escala una orden a urgente y cada cuánto vuelve a recordarla. Los cambios se comparten con Cocina, Empaque y Administración.
            </div>
          </div>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr_.72fr] gap-3">
          <div className="rounded-2xl border p-3" style={{ background: T.soft, borderColor: T.border }}>
            <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: T.rosa }} aria-hidden="true">👩‍🍳</span><div><div className="text-sm font-bold">Cocina</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Preparación del pedido</div></div></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Primer aviso">
                <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraCocinaMin} onChange={(e) => setDelayDraft((current) => ({ ...current, demoraCocinaMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
              </Field>
              <Field label="Urgente desde">
                <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraCocinaUrgenteMin} onChange={(e) => setDelayDraft((current) => ({ ...current, demoraCocinaUrgenteMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
              </Field>
            </div>
            <div className="text-[10px] font-bold rounded-xl px-2.5 py-2" style={{ background: T.rosa, color: "#7C3F4B" }}>Aviso a los {delayDraft.demoraCocinaMin} min → urgente a los {delayDraft.demoraCocinaUrgenteMin} min</div>
          </div>
          <div className="rounded-2xl border p-3" style={{ background: T.soft, borderColor: T.border }}>
            <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "#DCE7F2" }} aria-hidden="true">📦</span><div><div className="text-sm font-bold">Empaque</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Alistamiento y sello</div></div></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Primer aviso">
                <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraEmpaqueMin} onChange={(e) => setDelayDraft((current) => ({ ...current, demoraEmpaqueMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
              </Field>
              <Field label="Urgente desde">
                <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraEmpaqueUrgenteMin} onChange={(e) => setDelayDraft((current) => ({ ...current, demoraEmpaqueUrgenteMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
              </Field>
            </div>
            <div className="text-[10px] font-bold rounded-xl px-2.5 py-2" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>Aviso a los {delayDraft.demoraEmpaqueMin} min → urgente a los {delayDraft.demoraEmpaqueUrgenteMin} min</div>
          </div>
          <div className="rounded-2xl border p-3 flex flex-col" style={{ background: T.vainilla, borderColor: T.border }}>
            <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "#fff" }} aria-hidden="true">🔔</span><div><div className="text-sm font-bold">Repetición</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Mientras siga detenido</div></div></div>
            <Field label="Recordar cada">
              <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraRepeticionMin} onChange={(e) => setDelayDraft((current) => ({ ...current, demoraRepeticionMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
            </Field>
            <div className="text-[10px] font-semibold mt-auto" style={{ color: T.choco2 }}>Evita que una orden urgente quede olvidada.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
          <Btn onClick={guardarTiemposDemora} disabled={guardandoDemoras}>{guardandoDemoras ? "Guardando…" : "Guardar tiempos"}</Btn>
          <div className="text-[10px] font-bold rounded-full px-3 py-1.5" style={{ background: "#E3EFE0", color: "#3F6B42" }}>✓ Se aplican en todos los equipos</div>
          {delayMsg && <span className="text-xs font-bold" role="status" style={{ color: delayMsg.startsWith("⚠️") ? "#A03B2A" : "#3F6B42" }}>{delayMsg}</span>}
        </div>
      </Card>

      <SectionTitle>Catálogos del negocio</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        {listas.map(([k, titulo]) => (
          <Card key={k} className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>{titulo.toUpperCase()}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {s[k].map((v) => (
                <span key={v} className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: T.rosa, color: "#8E4B5A" }}>
                  {v}
                  <button aria-label={`Quitar ${v}`} onClick={() => update((d) => { d.settings[k] = d.settings[k].filter((x) => x !== v); })} className="font-bold opacity-70">✕</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={nuevoItem[k] || ""} onChange={(e) => setNuevoItem((prev) => ({ ...prev, [k]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && agregar(k)} placeholder="Agregar…"
                className="flex-1 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
              <Btn small kind="rosa" onClick={() => agregar(k)}>＋</Btn>
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Figuras (catálogo)</SectionTitle>
      <Card className="p-4">
        <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
          La figura es la <b>forma</b> (nombre · especie · gramaje). El sabor es aparte: cualquier figura se ofrece en los 11 sabores.
        </div>
        {s.figuras.map((f, i) => (
          <div key={f.nombre} className="flex items-center justify-between gap-3 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold truncate">{f.nombre}</span>
              <Badge label={f.especie === "perro" ? "🐶 perro" : "🐱 gato"} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input value={f.gramaje} onChange={(e) => update((d) => { d.settings.figuras[i].gramaje = e.target.value; })}
                className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-semibold" style={inputStyle} />
              <button aria-label={`Quitar ${f.nombre}`} onClick={() => update((d) => {
                d.settings.figuras = d.settings.figuras.filter((x) => x.nombre !== f.nombre);
                addAudit(d, { user, entidad: "Configuración", entidadId: "figuras", accion: "Figura eliminada", a: f.nombre });
              })} className="font-bold opacity-60 text-sm">✕</button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-3 items-center">
          <input value={nuevaFig.nombre} onChange={(e) => setNuevaFig({ ...nuevaFig, nombre: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && agregarFigura()} placeholder="Nombre (ej. Lizi)"
            className="flex-1 min-w-[120px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <div className="w-28"><Select options={["gato", "perro"]} value={nuevaFig.especie} onChange={(e) => setNuevaFig({ ...nuevaFig, especie: e.target.value })} /></div>
          <input value={nuevaFig.gramaje} onChange={(e) => setNuevaFig({ ...nuevaFig, gramaje: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && agregarFigura()} placeholder="150 g"
            className="w-24 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <Btn small kind="rosa" onClick={agregarFigura}>＋ Figura</Btn>
        </div>
      </Card>

      <SectionTitle>Toppings / adiciones (catálogo)</SectionTitle>
      <Card className="p-4">
        <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
          Un topping se agrega a la línea del pedido y <b>suma al total</b>. Precio <b>$0 = gratis</b> (incluido); mayor a 0 = extra pago.
          Si lo ligás a un insumo, se <b>descuenta del inventario</b> al vender y <b>vuelve</b> si el pedido se cancela.
        </div>
        {s.toppings.map((t, i) => (
          <div key={t.nombre} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-sm font-bold truncate">{t.nombre}</span>
              {(+t.precio > 0)
                ? <Badge label={"+" + fmt(t.precio)} />
                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#DDEBD9", color: "#3F6B42" }}>gratis</span>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
              <input type="number" min="0" value={t.precio} onChange={(e) => update((d) => { d.settings.toppings[i].precio = +e.target.value || 0; })}
                className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-semibold" style={inputStyle} />
              <select value={t.insumoId || ""} onChange={(e) => update((d) => { d.settings.toppings[i].insumoId = e.target.value; })}
                className="rounded-xl px-2 py-1.5 text-xs border font-semibold max-w-[130px]" style={inputStyle}>
                <option value="">— sin insumo —</option>
                {db.inventory_items.map((it) => <option key={it.id} value={it.id}>{it.nombre}</option>)}
              </select>
              <button aria-label={`Quitar ${t.nombre}`} onClick={() => update((d) => {
                d.settings.toppings = d.settings.toppings.filter((x) => x.nombre !== t.nombre);
                addAudit(d, { user, entidad: "Configuración", entidadId: "toppings", accion: "Topping eliminado", a: t.nombre });
              })} className="font-bold opacity-60 text-sm">✕</button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-3 items-center">
          <input value={nuevoTop.nombre} onChange={(e) => setNuevoTop({ ...nuevoTop, nombre: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && agregarTopping()} placeholder="Nombre (ej. Chispas)"
            className="flex-1 min-w-[120px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
            <input type="number" min="0" value={nuevoTop.precio} onChange={(e) => setNuevoTop({ ...nuevoTop, precio: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && agregarTopping()} placeholder="0 = gratis"
              className="w-24 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          </div>
          <select value={nuevoTop.insumoId} onChange={(e) => setNuevoTop({ ...nuevoTop, insumoId: e.target.value })}
            className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
            <option value="">— sin insumo —</option>
            {db.inventory_items.map((it) => <option key={it.id} value={it.id}>{it.nombre}</option>)}
          </select>
          <Btn small kind="rosa" onClick={agregarTopping}>＋ Topping</Btn>
        </div>
      </Card>

      <SectionTitle>Usuarios (users · roles · permissions)</SectionTitle>
      <Card className="p-4">
        <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
          Cada persona conserva un rol principal y puede acumular otros. Momo Ops une sus permisos sin duplicar el correo ni la cuenta de acceso.
        </div>
        {!db.multipleRolesReady && <div className="rounded-2xl px-3 py-2.5 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#8A5D08", border: "1px solid #EDD4A8" }} role="status">
          Aplicá la migración 21 de roles múltiples para asignar más de un área a la misma persona. La administración actual sigue funcionando con un rol por usuario.
        </div>}
        {db.users.map((u) => {
          const userRoles = normalizeRoles(u);
          return <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b" style={{ borderColor: T.border, opacity: u.activo ? 1 : 0.55 }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold truncate">{u.nombre} <span className="text-xs font-semibold" style={{ color: T.choco2 }}>· {u.email}</span></div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {userRoles.map((role) => <span key={role} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: role === u.rol ? T.coralSoft : "#F4E8D3", color: role === u.rol ? "#923F2D" : T.choco2 }} title={PERMISOS_POR_ROL[role]}>
                  {role}{role === u.rol && <span className="opacity-70">· principal</span>}
                  {db.multipleRolesReady && userRoles.length > 1 && <button type="button" className="font-black opacity-70 hover:opacity-100" aria-label={`Quitar rol ${role} a ${u.nombre}`} onClick={async () => {
                    if (enviandoUser) return;
                    setEnviandoUser(true); setUserMsg("");
                    try {
                      const result = await quitarRolUsuario(u.id, role);
                      await refrescar();
                      setUserMsg(`Rol ${role} retirado de ${u.nombre}. Rol principal: ${result.rol}.`);
                    } catch (error) {
                      setUserMsg("⚠️ " + error.message);
                    } finally {
                      setEnviandoUser(false);
                    }
                  }}>×</button>}
                </span>)}
              </div>
              <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: T.choco2 }}>{userRoles.map((role) => PERMISOS_POR_ROL[role]).filter(Boolean).join(" · ")}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge label={u.activo ? "Activo" : "Inactivo"} />
              <Btn small kind="ghost" onClick={async () => {
                if (enviandoUser) return;
                setEnviandoUser(true); setUserMsg("");
                try {
                  await setUserActivo(u.id, !u.activo);
                  await refrescar();
                } catch (e) {
                  setUserMsg("⚠️ " + e.message);
                } finally {
                  setEnviandoUser(false);
                }
              }}>{u.activo ? "Desactivar" : "Activar"}</Btn>
            </div>
          </div>;
        })}
        <div className="flex flex-wrap gap-2 pt-3 items-center">
          <input value={nuevoUser.nombre} onChange={(e) => setNuevoUser({ ...nuevoUser, nombre: e.target.value })} placeholder="Nombre"
            className="flex-1 min-w-[110px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <input value={nuevoUser.email} onChange={(e) => setNuevoUser({ ...nuevoUser, email: e.target.value })} placeholder="Correo"
            className="flex-1 min-w-[130px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <MiniSelect options={ROLES} value={nuevoUser.rol} onChange={(e) => setNuevoUser({ ...nuevoUser, rol: e.target.value })} />
          <Btn small kind="rosa" onClick={async () => {
            if (!nuevoUser.nombre.trim() || !nuevoUser.email.trim() || enviandoUser) return;
            setEnviandoUser(true); setUserMsg("");
            let r;
            try {
              r = await crearUsuarioStaff(nuevoUser.nombre, nuevoUser.email, nuevoUser.rol);
            } catch (e) {
              setUserMsg("⚠️ " + e.message);
              setEnviandoUser(false);
              return;
            }
            setNuevoUser({ nombre: "", email: "", rol: "Cocina" });
            try {
              await refrescar();
              setUserMsg(r.creado === undefined
                ? `Usuario ${r.id} creado con el rol ${nuevoUser.rol}.`
                : r.creado
                  ? `Usuario ${r.id} creado con el rol ${nuevoUser.rol}. Falta vincular su cuenta de acceso.`
                  : r.agregado
                    ? `${nuevoUser.rol} agregado al usuario ${r.id}. Ya puede operar ambas áreas con la misma cuenta.`
                    : `${nuevoUser.rol} ya estaba asignado al usuario ${r.id}; no se duplicó nada.`);
            } catch {
              setUserMsg(`El cambio sobre ${r.id} se guardó, pero no se pudo actualizar la vista. Recargá la página.`);
            }
            setEnviandoUser(false);
          }}>＋ Crear o asignar rol</Btn>
        </div>
        {userMsg && <div className="text-xs font-bold mt-2" style={{ color: userMsg.startsWith("⚠️") ? "#A03B2A" : "#3F6B42" }}>{userMsg}</div>}
      </Card>

      <SectionTitle>Políticas comerciales</SectionTitle>
      <Card className="p-4">
        <textarea rows={3} value={s.politicas} onChange={(e) => update((d) => { d.settings.politicas = e.target.value; })}
          className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} />
      </Card>

      <SectionTitle>Registro de actividad (audit log)</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[620px]">
          <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
            {["Fecha","Usuario","Entidad","Acción","De → A"].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {db.audit_logs.slice(0, 30).map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: T.border }}>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{a.fecha}</td>
                <td className="px-3 py-2 text-xs font-bold">{a.user}</td>
                <td className="px-3 py-2 text-xs">{a.entidad} {a.entidadId}</td>
                <td className="px-3 py-2 text-xs font-semibold">{a.accion}</td>
                <td className="px-3 py-2 text-xs" style={{ color: T.choco2 }}>{a.de ? `${a.de} → ${a.a}` : a.a}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-2"><Btn small kind="ghost" onClick={() => downloadCSV("audit-log", ["Fecha","Usuario","Entidad","ID","Acción","De","A"], db.audit_logs.map((a) => [a.fecha, a.user, a.entidad, a.entidadId, a.accion, a.de, a.a]))}>⬇ Exportar audit log</Btn></div>

      <SectionTitle>Datos</SectionTitle>
      <Card className="p-4 mb-3">
        <div className="text-sm font-semibold mb-1">💾 Backup diario</div>
        <div className="text-xs mb-3" style={{ color: T.choco2 }}>
          Descarga las tablas principales en archivos CSV (pedidos, items, clientes, inventario, movimientos, domicilios, evidencias, reclamos, beneficios, producción, reservas y audit log) más un respaldo completo en JSON. Hazlo al cierre de cada día.
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn small onClick={() => {
            const tablas = [
              ["pedidos", ["Pedido","Fecha","Hora","Canal","ClienteId","Barrio","Zona","Subtotal","Descuento","Dom cobrado","Dom costo","Total","Pago","Pagado en","Estado","Beneficio"],
                db.orders.map((o) => [o.id, o.fecha, o.hora, o.canal, o.customerId, o.barrio, o.zona, orderSubtotal(db, o), o.descuento, o.domCobrado, o.domCosto, orderTotal(db, o), o.pago, o.pagadoEn || "", o.estado, o.benefitId])],
              ["items", ["Id","Pedido","Padre (caja)","Caja #","Producto","Sabor","Salsa","Relleno","Figura","Cant","Precio","Costo unitario histórico","Adiciones","Total adiciones","Costo insumo adiciones"],
                db.order_items.map((i) => [i.id, i.orderId, i.parentItemId || "", i.cajaNum || "", i.nombre, i.sabor, i.salsa, i.relleno, i.figura, i.cant, i.precio, i.costoUnitario ?? "",
                  lineAdiciones(i).map((ad) => `${ad.nombre}×${ad.cant || 1} (+${(+ad.precio || 0) * (+ad.cant || 1)})`).join(" · "),
                  lineAdicionesTotal(i), lineAdicionesCOGS(db, i)])],
              ["clientes", ["Id","Nombre","Teléfono","Instagram","Barrio","Dirección","Canal","Primera","Última","Total","Pedidos","Cumple","Estado"],
                db.customers.map((c) => [c.id, c.nombre, c.telefono, c.instagram, c.barrio, c.direccion, c.canal, c.primera, c.ultima, c.total, c.pedidos, c.cumple, c.estado])],
              ["inventario", ["Id","Nombre","Categoría","Unidad","Stock","Mínimo","Costo","Proveedor","Vence","Ubicación"],
                db.inventory_items.map((i) => [i.id, i.nombre, i.cat, i.unidad, i.stock, i.min, i.costo, i.proveedor, i.vence, i.ubicacion])],
              ["movimientos", ["Id","Fecha","Tipo","Ítem","Cantidad","Nota"],
                db.inventory_movements.map((m) => [m.id, m.fecha, m.tipo, m.item, m.cant, m.nota])],
              ["domicilios", ["Id","Pedido","Proveedor","Zona","Cobrado","Costo","Solicitud","Salida","Entrega","Código","Estado"],
                db.deliveries.map((d) => [d.id, d.orderId, d.proveedor, d.zona, d.cobrado, d.costoReal, d.hSolicitud, d.hSalida, d.hEntrega, d.codigo, d.estado])],
              ["evidencias", ["Id","Pedido","Tipo","Fecha","Hora","Usuario","Tiene foto"],
                db.evidences.map((e) => [e.id, e.orderId, e.tipo, e.fecha, e.hora, e.user, (e.storagePath || e.url) ? "Sí" : "No"])],
              ["reclamos", ["Id","Fecha","Pedido","ClienteId","Tipo","H entrega","H reclamo","Entregado en","Reclamo en","Decisión","Solución","Costo","Estado","Descripción","Evidencia"],
                db.claims.map((r) => [r.id, r.fecha || "", r.orderId, r.customerId, r.tipo, r.hEntrega, r.hReclamo, r.entregadoEn || "", r.reclamoEn || "", r.decision, r.solucion, r.costo, r.estado, r.desc || "", r.evidencia || ""])],
              ["beneficios", ["Id","ClienteId","Beneficio","Tipo","Valor","Producto gratis","Mínimo","Activación","Vence","Estado","Pedido"],
                db.benefits.map((b) => [b.id, b.customerId, b.beneficio, b.tipoBeneficio, b.valor, b.productoGratisId, b.minimo, b.activacion, b.vence, b.estado, b.pedidoUso])],
              ["produccion", ["Lote","Fecha","Producto","Figura","Sabor","Gramaje","Producidas","Perfectas","Imperfectas","Descartadas","Destino","Resp","Desmoldado","Vence","Estado","Horas congelación","Inicio congelación","Stock contabilizado"],
                db.production_batches.map((l) => [l.id, l.fecha, l.producto, l.figura, l.sabor, l.gramaje, l.prod, l.perfectas, l.imperfectas, l.descartadas, l.destino, l.resp, l.desmoldadoEn || "", l.vence, l.estado, l.horasCongelacion || "", l.inicioCongelacion || "", l.stockContabilizado ? "Sí" : "No"])],
              ["reservas", ["Id","Pedido","Tipo","Referencia","Cantidad","Fecha","Estado"],
                db.inventory_reservations.map((r) => [r.id, r.orderId, r.tipo, r.nombre, r.cantidad, r.fecha, r.estado])],
              ["campanas", ["Id","Nombre","Canal","Objetivo","Producto","Oferta","Inicio","Fin","Presupuesto","Gasto real","Estado","Responsable"],
                db.campaigns.map((c) => [c.id, c.nombre, c.canal, c.objetivo, c.productoFoco, c.oferta, c.fechaInicio, c.fechaFin, c.presupuesto, c.gastoReal, c.estado, c.responsable])],
              ["creativos", ["Id","Campaña","Título","Canal","Formato","Producto","Hook","Estado","Responsable","Entrega"],
                db.creatives.map((c) => [c.id, c.campaignId, c.titulo, c.canal, c.formato, c.productoFoco, c.hook, c.estado, c.responsable, c.fechaEntrega])],
              ["calendario", ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado"],
                db.content_calendar.map((p) => [p.id, p.fecha, p.hora, p.canal, p.campaignId, p.creativeId, p.titulo, p.estado])],
              ["resultados-creativos", ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","Mensajes WA","Pedidos","Ventas","Gasto"],
                db.creative_results.map((r) => { const a = atribucionDeResultado(db, r); return [r.id, r.creativeId, r.campaignId, r.fecha, r.impresiones, r.alcance, r.clicks, r.mensajesWhatsApp, a.contabilizar ? a.pedidos : "", a.contabilizar ? a.ventas : "", r.gasto]; })],
              ["ideas-marketing", ["Id","Título","Categoría","Objetivo","Producto","Copy","Guion","Canal","Estado"],
                (db.marketing_ideas || []).map((i) => [i.id, i.titulo, i.cat, i.objetivo, i.productoSugerido, i.copy, i.guionCorto, i.canal, i.estado])],
              ["guiones-marketing", ["Id","Título","Duración","Producto","Objetivo","Dificultad","Escena 1","Escena 2","Escena 3","Escena 4","Texto pantalla","Audio"],
                (db.marketing_guiones || []).map((g) => [g.id, g.titulo, g.duracion, g.productoFoco, g.objetivo, g.dificultad, g.escena1, g.escena2, g.escena3, g.escena4, g.textoPantalla, g.audio])],
              ["mensajes-whatsapp", ["Id","Tipo","Texto"],
                (db.marketing_mensajes || []).map((m) => [m.id, m.tipo, m.texto])],
              ["tareas-marketing", ["Id","Tarea","Fecha","Estado","Responsable"],
                (db.marketing_tasks || []).map((t) => [t.id, t.tarea, t.fecha, t.estado, t.responsable])],
              ["biblioteca-marca", ["Tipo","Valor"],
                [
                  ...((db.brand_library && db.brand_library.frases) || []).map((v) => ["Frase", v]),
                  ...((db.brand_library && db.brand_library.tono) || []).map((v) => ["Tono", v]),
                  ...((db.brand_library && db.brand_library.palabrasSi) || []).map((v) => ["Palabra sí", v]),
                  ...((db.brand_library && db.brand_library.palabrasNo) || []).map((v) => ["Palabra no", v]),
                ]],
              ["audit-log", ["Fecha","Usuario","Entidad","Id","Acción","De","A"],
                db.audit_logs.map((a) => [a.fecha, a.user, a.entidad, a.entidadId, a.accion, a.de, a.a])],
            ];
            tablas.forEach(([nombre, headers, rows], i) => setTimeout(() => downloadCSV("momos-" + nombre, headers, rows), i * 450));
            setBackupMsg(`Descargando ${tablas.length} archivos CSV… revisa tu carpeta de descargas.`);
          }}>⬇ Backup en CSV (todas las tablas)</Btn>
          <Btn small kind="ghost" onClick={() => {
            const blob = new Blob([JSON.stringify(db)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "momos-backup-completo-" + hoyISO() + ".json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            setBackupMsg("Respaldo JSON completo descargado (incluye fotos).");
          }}>⬇ Respaldo completo JSON</Btn>
        </div>
        <div className="mt-3 pt-3 border-t" style={{ borderColor: T.border }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: T.choco2 }}>♻️ Restaurar desde un respaldo JSON</div>
          <input type="file" accept="application/json" className="text-xs" onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const data = JSON.parse(reader.result);
                if (!data || typeof data !== "object") { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS."); return; }
                if (data.version && data.version > DB_VERSION) { setBackupMsg("❌ Este backup pertenece a una versión más nueva de MOMOS OPS."); return; }
                const arraysReq = ["orders","order_items","customers","products"];
                const faltanArray = arraysReq.filter((t) => !Array.isArray(data[t]));
                if (faltanArray.length) { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS (tablas dañadas: " + faltanArray.join(", ") + ")."); return; }
                if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS (falta la configuración)."); return; }
                await restaurarBackup(data);
                setBackupMsg("Backup restaurado correctamente.");
              } catch (err) {
                setBackupMsg("❌ No se pudo restaurar: " + (err && err.message ? err.message : "formato inválido") + ".");
              }
            };
            reader.readAsText(file);
            e.target.value = "";
          }} />
          <div className="text-[11px] mt-1" style={{ color: T.choco2 }}>Reemplaza todos los datos actuales por los del archivo. Descarga antes un respaldo por si acaso.</div>
        </div>
        {backupMsg && <div className="text-xs font-bold mt-2" style={{ color: "#3F6B42" }}>{backupMsg}</div>}
      </Card>

      <Card className="p-4 mb-3">
        <div className="text-sm font-semibold mb-1">📷 Almacenamiento de fotos</div>
        <div className="text-xs font-bold p-2.5 rounded-xl" style={{ background: "#FBE8C8", color: "#96690F" }}>
          Las evidencias fotográficas se guardan en el bucket privado de <b>Supabase Storage</b>.
          Cada archivo queda ligado al pedido y al paso operativo correspondiente; las vistas temporales usan enlaces firmados que vencen automáticamente.
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Reiniciar datos de ejemplo</div>
        <div className="text-xs mb-3" style={{ color: T.choco2 }}>Borra todos los datos guardados y vuelve a cargar los datos de ejemplo de El Caney. Esta acción no se puede deshacer.</div>
        {!confirmar ? <Btn small kind="danger" onClick={() => setConfirmar(true)}>Reiniciar datos…</Btn> : (
          <div className="flex gap-2">
            <Btn small kind="danger" onClick={resetear}>Sí, borrar y reiniciar</Btn>
            <Btn small kind="ghost" onClick={() => setConfirmar(false)}>Cancelar</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}


/* ================= MARKETING 📣 ================= */

function Marketing({ db, update, user, refrescar }) {
  const [nueva, setNueva] = useState(false);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({ nombre: "", canal: "Instagram", objetivo: "Ventas", productoFoco: "", oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(15), presupuesto: 0, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "" });

  const activas = db.campaigns.filter((c) => c.estado === "Activa");
  const totalPresup = db.campaigns.reduce((s, c) => s + (c.presupuesto || 0), 0);
  const totalGasto = db.campaigns.reduce((s, c) => s + (c.gastoReal || 0), 0);
  const conMetrics = db.campaigns.map((c) => ({ c, m: campaignMetrics(db, c) }));
  const mejores = [...conMetrics].filter((x) => x.m.roas !== null).sort((a, b) => b.m.roas - a.m.roas);
  const sinVentas = conMetrics.filter((x) => x.m.pedidos === 0 && x.c.estado !== "Planeada");

  function exportar() {
    downloadCSV("campanas",
      ["Id","Nombre","Canal","Objetivo","Producto foco","Oferta","Inicio","Fin","Presupuesto","Gasto real","Pedidos atrib.","Ventas atrib.","CAC","ROAS","Estado","Responsable"],
      conMetrics.map(({ c, m }) => [c.id, c.nombre, c.canal, c.objetivo, c.productoFoco, c.oferta, c.fechaInicio, c.fechaFin, c.presupuesto, c.gastoReal, m.pedidos, m.ventas, m.cac ? Math.round(m.cac) : "", m.roas ? m.roas.toFixed(2) : "", c.estado, c.responsable]));
  }

  // Fase 3 · Hito 2: la campaña nace en el SERVER (crear_campana). productoFoco (nombre) → id.
  async function guardar() {
    if (!form.nombre.trim()) { toast("error", "Falta el nombre de la campaña"); return; }
    const prodId = form.productoFoco ? (db.products.find((p) => p.nombre === form.productoFoco)?.id || null) : null;
    let res;
    try {
      res = await crearCampana({
        nombre: form.nombre, canal: form.canal, objetivo: form.objetivo,
        producto_foco_id: prodId, oferta: form.oferta,
        fecha_inicio: form.fechaInicio, fecha_fin: form.fechaFin,
        presupuesto: form.presupuesto, gasto_real: form.gastoReal,
        estado: form.estado, responsable: form.responsable, notas: form.notas,
      });
    } catch (e) { toast("error", e.message); return; }
    setNueva(false);
    setForm({ nombre: "", canal: "Instagram", objetivo: "Ventas", productoFoco: "", oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(15), presupuesto: 0, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "" });
    toast("ok", `Campaña ${res.id} creada`);
    try { await refrescar(); } catch { toast("error", "Campaña creada; recargá para verla"); }
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="📣" label="Campañas activas" value={activas.length} sub={db.campaigns.length + " en total"} tone={T.coral} />
        <Stat icon="💵" label="Presupuesto total" value={fmt(totalPresup)} sub={"gastado " + fmt(totalGasto)} />
        <Stat icon="🛒" label="Pedidos atribuidos" value={conMetrics.reduce((s, x) => s + x.m.pedidos, 0)} sub="con venta confirmada" tone="#3F6B42" />
        <Stat icon="📈" label="Ventas atribuidas" value={fmt(conMetrics.reduce((s, x) => s + x.m.ventas, 0))} sub="por campañas" tone="#3F6B42" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => setNueva(true)}>＋ Nueva campaña</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {sinVentas.length > 0 && (
        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>
          ⚠️ Campañas activas/finalizadas sin ventas atribuidas: {sinVentas.map((x) => x.c.nombre).join(", ")}
        </div>
      )}

      <SectionTitle>Campañas</SectionTitle>
      <div className="grid lg:grid-cols-2 gap-3">
        {conMetrics.map(({ c, m }) => {
          const usoPresup = c.presupuesto > 0 ? (c.gastoReal / c.presupuesto) : 0;
          return (
            <Card key={c.id} className="p-4" onClick={() => setSel(c)}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{c.nombre}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{c.objetivo} · {c.productoFoco || "sin producto foco"}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge label={c.estado} />
                  <Badge label={c.canal} map={MK_CANAL_STYLE} />
                </div>
              </div>
              {c.oferta && <div className="text-xs mt-2 p-1.5 rounded-lg" style={{ background: T.vainilla }}>🎁 {c.oferta}</div>}
              <div className="mt-2">
                <div className="flex justify-between text-[11px] font-bold mb-1" style={{ color: T.choco2 }}>
                  <span>Presupuesto {fmt(c.presupuesto)}</span><span>Gasto {fmt(c.gastoReal)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: T.vainilla }}>
                  <div className="h-full rounded-full" style={{ width: Math.max(0, Math.min(100, usoPresup * 100)) + "%", background: usoPresup > 1 ? "#A03B2A" : T.rosaDeep }} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[["Pedidos", m.pedidos, T.choco], ["Ventas", fmt(m.ventas), "#3F6B42"], ["CAC", m.cac !== null ? fmt(m.cac) : "—", "#96690F"], ["ROAS", m.roas !== null ? m.roas.toFixed(1) + "x" : "—", m.roas >= 1 ? "#3F6B42" : "#A03B2A"]].map(([lab, v, col]) => (
                  <div key={lab} className="rounded-xl py-2" style={{ background: T.vainilla }}>
                    <div className="text-sm font-bold truncate px-0.5" style={{ color: col }}>{v}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] mt-2" style={{ color: T.choco2 }}>{c.fechaInicio} → {c.fechaFin} · {c.responsable}</div>
            </Card>
          );
        })}
      </div>

      {mejores.length > 0 && (
        <>
          <SectionTitle>🏆 Mejores campañas por ROAS</SectionTitle>
          <Card className="p-4"><Bars data={mejores.slice(0, 5).map((x) => ({ label: x.c.nombre, value: +x.m.roas.toFixed(2), color: T.rosaDeep }))} /></Card>
        </>
      )}

      {nueva && (
        <Modal title="Nueva campaña" onClose={() => setNueva(false)} wide>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Nombre"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Lanzamiento Gatitos" /></Field>
            <Field label="Canal"><Select options={MK_CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
            <Field label="Objetivo"><Select options={MK_OBJETIVOS} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} /></Field>
            <Field label="Producto foco"><Select placeholder="Sin producto foco" options={db.products.map((p) => p.nombre)} value={form.productoFoco} onChange={(e) => setForm({ ...form, productoFoco: e.target.value })} /></Field>
            <Field label="Oferta"><Input value={form.oferta} onChange={(e) => setForm({ ...form, oferta: e.target.value })} placeholder="Ej: 2x1, envío gratis…" /></Field>
            <Field label="Responsable"><Input value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} /></Field>
            <Field label="Fecha inicio"><Input type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} /></Field>
            <Field label="Fecha fin"><Input type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} /></Field>
            <Field label="Presupuesto"><Input type="number" value={form.presupuesto} onChange={(e) => setForm({ ...form, presupuesto: +e.target.value })} /></Field>
            <Field label="Gasto real"><Input type="number" value={form.gastoReal} onChange={(e) => setForm({ ...form, gastoReal: +e.target.value })} /></Field>
            <Field label="Estado"><Select options={CAMP_ESTADOS} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear campaña</BtnAsync><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
        </Modal>
      )}

      {sel && (
        <Modal title={sel.nombre} onClose={() => setSel(null)} wide>
          <div className="flex flex-wrap gap-2 mb-3"><Badge label={sel.estado} /><Badge label={sel.canal} map={MK_CANAL_STYLE} /><span className="text-xs font-semibold" style={{ color: T.choco2 }}>{sel.objetivo}</span></div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Estado">
              <select value={sel.estado} onChange={(e) => setSel({ ...sel, estado: e.target.value })} className={inputCls} style={inputStyle}>{CAMP_ESTADOS.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            {/* String crudo (no +coerción): vaciar el input queda '' y el PATCH lo OMITE — no pisa a 0. */}
            <Field label="Gasto real"><Input type="number" value={sel.gastoReal} onChange={(e) => setSel({ ...sel, gastoReal: e.target.value })} /></Field>
            <Field label="Presupuesto"><Input type="number" value={sel.presupuesto} onChange={(e) => setSel({ ...sel, presupuesto: e.target.value })} /></Field>
            <Field label="Oferta"><Input value={sel.oferta} onChange={(e) => setSel({ ...sel, oferta: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input value={sel.notas} onChange={(e) => setSel({ ...sel, notas: e.target.value })} /></Field>
          <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
            Creativos de esta campaña: {db.creatives.filter((cr) => cr.campaignId === sel.id).length} · Pedidos atribuidos: {ordersDeCampaign(db, sel.id).length}
          </div>
          <div className="flex gap-2">
            <BtnAsync onClick={async () => {
              // PATCH por DIFF: solo las claves que cambiaron respecto del valor hidratado (el
              // resto — nombre, canal, foco, fechas — queda intacto server-side). Los numéricos
              // van solo si quedaron con un número válido: vaciar el input NO pisa el dato a 0.
              const orig = db.campaigns.find((x) => x.id === sel.id) || sel;
              const patch = {};
              if (sel.estado !== orig.estado) patch.estado = sel.estado;
              if (sel.oferta !== orig.oferta) patch.oferta = sel.oferta;
              if (sel.notas !== orig.notas) patch.notas = sel.notas;
              if (String(sel.presupuesto).trim() !== "" && !Number.isNaN(+sel.presupuesto) && +sel.presupuesto !== orig.presupuesto) patch.presupuesto = +sel.presupuesto;
              if (String(sel.gastoReal).trim() !== "" && !Number.isNaN(+sel.gastoReal) && +sel.gastoReal !== orig.gastoReal) patch.gasto_real = +sel.gastoReal;
              if (Object.keys(patch).length === 0) { setSel(null); toast("ok", "Sin cambios"); return; }
              let res;
              try {
                res = await editarCampana(sel.id, patch);
              } catch (e) { toast("error", e.message); return; }
              setSel(null);
              toast("ok", res.cambio_estado ? `Campaña → ${sel.estado}` : "Campaña actualizada");
              try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
            }}>Guardar</BtnAsync>
            <Btn kind="ghost" onClick={() => setSel(null)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= CREATIVOS 🎨 ================= */

function Creativos({ db, refrescar }) {
  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState(null);
  const [selBase, setSelBase] = useState(null);
  const [fEstado, setFEstado] = useState("");
  const vacio = { campaignId: "", titulo: "", canal: "Instagram", formato: "Reel", productoFoco: "", figuraFoco: "", saborFoco: "", hook: "", copy: "", guion: "", estado: "Idea", responsable: "Marketing", fechaEntrega: dISO(3), assetUrl: "", notas: "" };
  const [form, setForm] = useState(vacio);
  const sabores = [...db.settings.saboresFrutales, ...db.settings.saboresCremosos];

  const grupos = [["Idea","Ideas pendientes"],["En diseño","En diseño"],["En revisión","En revisión"],["Aprobado","Aprobados"],["Publicado","Publicados"],["Ganador","Ganadores"]];
  const lista = db.creatives.filter((c) => !fEstado || c.estado === fEstado);

  function exportar() {
    downloadCSV("creativos",
      ["Id","Campaña","Título","Canal","Formato","Producto","Figura","Sabor","Hook","Estado","Responsable","Entrega"],
      db.creatives.map((c) => { const camp = db.campaigns.find((x) => x.id === c.campaignId); return [c.id, camp ? camp.nombre : "", c.titulo, c.canal, c.formato, c.productoFoco, c.figuraFoco, c.saborFoco, c.hook, c.estado, c.responsable, c.fechaEntrega]; }));
  }

  function payloadCreativo(f) {
    const prodId = f.productoFoco ? (db.products.find((p) => p.nombre === f.productoFoco)?.id || null) : null;
    return {
      campaign_id: f.campaignId || null, titulo: f.titulo, canal: f.canal, formato: f.formato,
      producto_foco_id: prodId, figura: f.figuraFoco || null, sabor: f.saborFoco || null,
      hook: f.hook, copy: f.copy, guion: f.guion, estado: f.estado,
      responsable: f.responsable, fecha_entrega: f.fechaEntrega || null,
      asset_url: f.assetUrl, notas: f.notas,
    };
  }

  async function guardar() {
    if (!form.titulo.trim()) { toast("error", "Falta el título del creativo"); return; }
    let res;
    try { res = await crearCreativo(payloadCreativo(form)); }
    catch (e) { toast("error", e.message); return; }
    setNuevo(false); setForm(vacio);
    toast("ok", `Creativo ${res.id} creado`);
    try { await refrescar(); } catch { toast("error", "Creativo creado; recargá para verlo"); }
  }

  async function guardarEdicion() {
    // El baseline queda congelado al abrir el modal. Comparar contra el polling
    // más reciente podría reenviar valores viejos y pisar cambios de otro equipo.
    const orig = selBase || sel;
    const antes = payloadCreativo(orig);
    const despues = payloadCreativo(sel);
    const patch = {};
    Object.keys(despues).forEach((k) => { if (despues[k] !== antes[k]) patch[k] = despues[k]; });
    if (!Object.keys(patch).length) { setSel(null); setSelBase(null); toast("ok", "Sin cambios"); return; }
    let res;
    try { res = await editarCreativo(sel.id, patch); }
    catch (e) { toast("error", e.message); return; }
    setSel(null); setSelBase(null);
    toast("ok", res.cambio_estado ? `Creativo → ${sel.estado}` : "Creativo actualizado");
    try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
  }

  async function crearPostDesdeCreativo() {
    let res;
    try {
      res = await crearPublicacion({
        fecha: hoyISO(), hora: "12:00", canal: sel.canal,
        creative_id: sel.id, titulo: sel.titulo, copy_final: sel.copy || "",
        estado: "Programado", url_publicacion: "", notas: "Creado desde Creativos",
      });
    } catch (e) { toast("error", e.message); return; }
    setSel(null); setSelBase(null);
    toast("ok", `Publicación ${res.id} creada`);
    try { await refrescar(); } catch { toast("error", "Publicación creada; recargá para verla"); }
  }

  return (
    <div>
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {grupos.map(([est, lab]) => (
          <Card key={est} className="p-3 text-center" onClick={() => setFEstado(fEstado === est ? "" : est)}>
            <div className="display text-xl" style={{ color: est === "Ganador" ? "#8E4B5A" : est === "Publicado" ? "#2F6B60" : T.choco }}>{db.creatives.filter((c) => c.estado === est).length}</div>
            <div className="text-[10px] font-bold leading-tight" style={{ color: T.choco2 }}>{lab}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => setNuevo(true)}>＋ Nuevo creativo</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        {fEstado && <Btn small kind="ghost" onClick={() => setFEstado("")}>Ver todos ({db.creatives.length})</Btn>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lista.map((c) => {
          const camp = db.campaigns.find((x) => x.id === c.campaignId);
          const pedidos = ordersDeCreative(db, c.id).length;
          return (
            <Card key={c.id} className="p-4" onClick={() => { setSel({ ...c }); setSelBase({ ...c }); }}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight">{c.titulo}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{c.formato} · {camp ? camp.nombre : "sin campaña"}</div>
                </div>
                <Badge label={c.estado} />
              </div>
              {c.hook && <div className="text-xs mt-2 italic p-2 rounded-lg" style={{ background: T.vainilla, color: T.choco }}>“{c.hook}”</div>}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge label={c.canal} map={MK_CANAL_STYLE} />
                {c.productoFoco && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>{c.productoFoco}</span>}
              </div>
              <div className="flex justify-between items-center mt-2 text-[11px] font-semibold" style={{ color: T.choco2 }}>
                <span>{c.responsable} · entrega {c.fechaEntrega}</span>
                {pedidos > 0 && <span style={{ color: "#3F6B42" }}>{pedidos} pedido(s)</span>}
              </div>
            </Card>
          );
        })}
        {lista.length === 0 && <Empty icon="🎨" text="No hay creativos en este estado." />}
      </div>

      {(nuevo || sel) && (
        <Modal title={sel ? sel.titulo : "Nuevo creativo"} onClose={() => { setNuevo(false); setSel(null); setSelBase(null); }} wide>
          {(() => { const f = sel || form; const setF = sel ? setSel : setForm;
            return (
              <>
                {sel && selBase && sel.estado !== selBase.estado && (
                  <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "#FFF1D6", color: "#7A5510" }} role="status">
                    <span>Cambio listo para guardar</span>
                    <Badge label={selBase.estado} />
                    <span aria-hidden="true">→</span>
                    <Badge label={sel.estado} />
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-x-4">
                  <Field label="Título"><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Nombre interno del creativo" /></Field>
                  <Field label="Campaña">
                    <select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })} className={inputCls} style={inputStyle}>
                      <option value="">Sin campaña</option>
                      {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </Field>
                  <Field label="Canal"><Select options={MK_CANALES} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} /></Field>
                  <Field label="Formato"><Select options={MK_FORMATOS} value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value })} /></Field>
                  <Field label="Producto foco"><Select placeholder="—" options={db.products.map((p) => p.nombre)} value={f.productoFoco} onChange={(e) => setF({ ...f, productoFoco: e.target.value })} /></Field>
                  <Field label="Figura foco"><Select placeholder="—" options={db.settings.figuras.map((x) => x.nombre)} value={f.figuraFoco} onChange={(e) => setF({ ...f, figuraFoco: e.target.value })} /></Field>
                  <Field label="Sabor foco"><Select placeholder="—" options={sabores} value={f.saborFoco} onChange={(e) => setF({ ...f, saborFoco: e.target.value })} /></Field>
                  <Field label="Estado"><Select options={CREA_ESTADOS} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} /></Field>
                  <Field label="Responsable"><Input value={f.responsable} onChange={(e) => setF({ ...f, responsable: e.target.value })} /></Field>
                  <Field label="Fecha de entrega"><Input type="date" value={f.fechaEntrega} onChange={(e) => setF({ ...f, fechaEntrega: e.target.value })} /></Field>
                </div>
                <Field label="Hook (gancho)"><Input value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} placeholder="La frase que detiene el scroll" /></Field>
                <Field label="Copy">
                  <textarea rows={2} value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Texto de la publicación" />
                </Field>
                <Field label="Guion">
                  <textarea rows={2} value={f.guion} onChange={(e) => setF({ ...f, guion: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Escenas o pasos del video" />
                </Field>
                <Field label="URL del asset (opcional)"><Input value={f.assetUrl} onChange={(e) => setF({ ...f, assetUrl: e.target.value })} placeholder="Link a Drive, Canva…" /></Field>
                <Field label="Notas"><Input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Field>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {sel ? (
                    <BtnAsync onClick={guardarEdicion}>Guardar</BtnAsync>
                  ) : (
                    <BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear creativo</BtnAsync>
                  )}
                  {sel && ["Aprobado","Publicado","Ganador"].includes(sel.estado) && (
                    <BtnAsync kind="soft" onClick={crearPostDesdeCreativo} textoEnVuelo="Creando…">🗓️ Crear publicación</BtnAsync>
                  )}
                  <Btn kind="ghost" onClick={() => { setNuevo(false); setSel(null); setSelBase(null); }}>Cancelar</Btn>
                </div>
              </>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}

/* ================= CALENDARIO 🗓️ ================= */

function Calendario({ db, refrescar }) {
  const [nueva, setNueva] = useState(false);
  const [vista, setVista] = useState(() => {
    const requested = window.sessionStorage.getItem("momos:calendar-view");
    window.sessionStorage.removeItem("momos:calendar-view");
    return requested === "Distribución" ? requested : "Activas";
  });
  const [distributionDraft, setDistributionDraft] = useState(null);
  const vacio = { fecha: hoyISO(), hora: "12:00", canal: "Instagram", campaignId: "", creativeId: "", titulo: "", copyFinal: "", estado: "Pendiente", urlPublicacion: "", notas: "" };
  const [form, setForm] = useState(vacio);
  const cambiosRef = useRef(new Set());
  const [estadosPendientes, setEstadosPendientes] = useState({});
  const vivoRef = useRef(true);
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);

  const commercialCalendar = useMemo(() => buildCommercialCalendar(db, hoyISO()), [db]);
  const distributionRoom = useMemo(() => buildDistributionRoom(db, hoyISO(), new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })), [db]);
  const distributionQueue = useMemo(() => distributionRoom.queue.map((item) => enrichDistributionWithDispatch(item, db)), [distributionRoom, db]);
  const formScheduleGuard = useMemo(() => form.creativeId
    ? calendarTransitionGuard({ ...form, id: "CAL-DRAFT", estado: "Pendiente" }, "Programado", db, hoyISO())
    : null, [form, db]);
  const semana = commercialCalendar.weekDates;
  const pubs = vista === "Activas" ? commercialCalendar.active : commercialCalendar.history;
  const todos = [...db.content_calendar].sort((a, b) => `${a.fecha}${a.hora}${a.id}`.localeCompare(`${b.fecha}${b.hora}${b.id}`));

  function exportar() {
    downloadCSV("calendario",
      ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado","URL"],
      todos.map((p) => { const camp = db.campaigns.find((x) => x.id === p.campaignId); const cre = db.creatives.find((x) => x.id === p.creativeId); return [p.id, p.fecha, p.hora, p.canal, camp ? camp.nombre : "", cre ? cre.titulo : "", p.titulo, p.estado, p.urlPublicacion]; }));
  }

  function planificarCreativo(creative) {
    setForm({ ...vacio, ...buildPostDraftFromCreative(creative, db, hoyISO()) });
    setNueva(true);
  }

  function abrirPreparacion(item) {
    const checklist = {};
    distributionChecklistFor(item.post, db).forEach((step) => { checklist[step.key] = item.run?.checklist?.[step.key] === true; });
    setDistributionDraft({ mode: "prepare", item, checklist, notes: item.run?.notes || "", externalUrl: "", externalPostId: "", reason: "" });
  }

  function abrirCierre(item, mode = "publish") {
    setDistributionDraft({ mode, item, checklist: item.run?.checklist || {}, notes: "", externalUrl: item.dispatch?.job?.externalUrl || item.run?.externalUrl || "", externalPostId: item.dispatch?.job?.providerJobId || item.run?.externalPostId || "", reason: item.run?.failureReason || "" });
  }

  async function autorizarSalidaConector(item) {
    const eligibility = item.dispatch?.eligibility;
    if (!eligibility?.allowed) { toast("error", eligibility?.reasons?.[0] || "El conector todavía no está listo."); return; }
    try {
      const result = await autorizarDespachoDistribucion(item.post.id, eligibility.mode);
      toast("ok", result.duplicate ? `El despacho ya estaba ${result.status}` : `${eligibility.provider} autorizado · MOMO OPS lo enviará una sola vez`);
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function reintentarSalidaConector(item) {
    const job = item.dispatch?.job;
    if (!job) return;
    try { await reintentarDespachoDistribucion(job.id); toast("ok", "Nuevo intento autorizado con una clave idempotente nueva"); await refrescar(); }
    catch (error) { toast("error", error.message); }
  }

  async function guardarPreparacionComercial() {
    const draft = distributionDraft;
    if (!draft) return;
    if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para guardar la distribución trazable."); return; }
    const guard = validateDistributionAction("prepare", draft.item.post, db, draft.item.run, {}, hoyISO());
    if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
    try {
      const res = await guardarPreparacionDistribucion(draft.item.post.id, draft.checklist, draft.notes);
      toast("ok", res.status === "Lista" ? "Checklist completo · salida Lista para aprobación" : "Preparación guardada");
      setDistributionDraft(null); await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function aprobarSalidaComercial(item) {
    if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para aprobar distribuciones."); return; }
    const guard = validateDistributionAction("approve", item.post, db, item.run, {}, hoyISO());
    if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
    try { await aprobarDistribucion(item.post.id); toast("ok", "Salida aprobada · lista para publicar en su horario"); await refrescar(); }
    catch (error) { toast("error", error.message); }
  }

  async function cerrarSalidaComercial() {
    const draft = distributionDraft;
    if (!draft) return;
    if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para cerrar distribuciones."); return; }
    const action = draft.mode === "fail" ? "fail" : "publish";
    const payload = action === "fail" ? { reason: draft.reason } : { externalUrl: draft.externalUrl, externalPostId: draft.externalPostId };
    const guard = validateDistributionAction(action, draft.item.post, db, draft.item.run, payload, hoyISO(), new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" }));
    if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
    try {
      await cerrarDistribucionPublicacion(draft.item.post.id, action === "fail" ? "Fallida" : "Publicada", draft.externalUrl, draft.externalPostId, action === "fail" ? draft.reason : draft.notes);
      toast("ok", action === "fail" ? "Fallo registrado sin perder trazabilidad" : "Publicación cerrada con evidencia externa");
      setDistributionDraft(null); await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function guardar() {
    if (!form.titulo.trim()) { toast("error", "Falta el título de la publicación"); return; }
    if (form.estado === "Programado" && formScheduleGuard && !formScheduleGuard.allowed) { toast("error", formScheduleGuard.reasons[0]); return; }
    let res;
    try {
      res = await crearPublicacion({
        fecha: form.fecha, hora: form.hora, canal: form.canal,
        campaign_id: form.campaignId || null, creative_id: form.creativeId || null,
        titulo: form.titulo, copy_final: form.copyFinal, estado: form.estado,
        url_publicacion: form.urlPublicacion, notas: form.notas,
      });
    } catch (e) { toast("error", e.message); return; }
    setNueva(false); setForm(vacio);
    toast("ok", `Publicación ${res.id} creada`);
    try { await refrescar(); } catch { toast("error", "Publicación creada; recargá para verla"); }
  }

  async function cambiarEstado(p, estado) {
    if (cambiosRef.current.has(p.id) || estado === p.estado) return;
    if (db.distributionServerReady && estado === "Publicado") { toast("error", "Publicá y registrá la evidencia desde la pestaña Distribución."); return; }
    if (db.distributionServerReady && estado === "No publicado" && db.content_distributions.some((run) => run.postId === p.id)) { toast("error", "La salida preparada debe cerrarse como fallo desde Distribución."); return; }
    const guard = calendarTransitionGuard(p, estado, db, hoyISO());
    if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
    cambiosRef.current.add(p.id);
    setEstadosPendientes((actuales) => ({ ...actuales, [p.id]: estado }));
    try {
      let res;
      try { res = await setPublicacionEstado(p.id, estado); }
      catch (e) { toast("error", e.message); return; }
      toast("ok", res.cambio ? `Publicación → ${estado}` : "Sin cambios");
      try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
    } finally {
      cambiosRef.current.delete(p.id);
      if (vivoRef.current) setEstadosPendientes((actuales) => {
        const siguientes = { ...actuales };
        delete siguientes[p.id];
        return siguientes;
      });
    }
  }

  return (
    <div>
      <SectionTitle action={
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 shrink-0" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
          <span className="display font-semibold" style={{ color: T.coral, fontVariantNumeric: "tabular-nums" }}>{commercialCalendar.summary.readyToday}/{commercialCalendar.summary.today}</span>
          <span className="text-xs font-bold" style={{ color: T.choco2 }}>listas hoy</span>
        </div>
      }>Calendario inteligente MOMOS</SectionTitle>
      <div className="text-xs font-semibold mb-4 -mt-3" style={{ color: T.choco2 }}>Ordena la semana, valida marca y stock, y muestra exactamente qué debe ejecutar Marketing.</div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="🗓️" label="Activas esta semana" value={<CountUp value={commercialCalendar.summary.scheduledWeek} />} tone={T.coral} />
        <Stat icon="⛔" label="Bloqueadas" value={<CountUp value={commercialCalendar.summary.blocked} />} sub="requieren corrección" tone="#A03B2A" />
        <Stat icon="⏰" label="Vencidas" value={<CountUp value={commercialCalendar.summary.overdue} />} sub="sin cerrar" tone="#96690F" />
        <Stat icon="✦" label="Por programar" value={<CountUp value={commercialCalendar.summary.unscheduledApproved} />} sub="creativos aprobados" tone="#3F6B42" />
      </div>

      {commercialCalendar.summary.blocked > 0 && <InlineNotice icon="⚠" title={`${commercialCalendar.summary.blocked} publicación(es) no deberían programarse todavía`} tone="danger" role="alert">Revisá aprobación del creativo, copy, canal, campaña y disponibilidad antes de continuar.</InlineNotice>}

      {commercialCalendar.agenda.length > 0 && <>
        <SectionTitle>Agenda priorizada de Marketing</SectionTitle>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
          {commercialCalendar.agenda.slice(0, 6).map((item) => <div key={item.id} className="rounded-2xl border p-4" style={{ borderColor: item.post.preflight.ready ? T.border : "#E8B7AD", background: item.post.preflight.ready ? "#fff" : "#FFF6F3" }}>
            <div className="flex items-start justify-between gap-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: item.priority >= 90 ? "#A03B2A" : T.coral }}>{item.action}</div><Badge label={item.post.estado} /></div>
            <div className="font-bold text-sm mt-1">{item.post.titulo}</div>
            <div className="text-xs mt-1" style={{ color: T.choco2 }}>{item.post.fecha} · {item.post.hora} · {item.post.canal}</div>
            {!item.post.preflight.ready && <div className="text-[11px] font-bold mt-2" style={{ color: "#A03B2A" }}>⛔ {item.post.preflight.errors[0]?.message}</div>}
          </div>)}
        </div>
      </>}

      {commercialCalendar.planningQueue.length > 0 && <>
        <SectionTitle>Creativos aprobados esperando fecha</SectionTitle>
        <div className="flex gap-3 overflow-x-auto pb-3 mb-2">
          {commercialCalendar.planningQueue.slice(0, 8).map(({ creative, draft, preflight }) => <div key={creative.id} className="w-72 shrink-0 rounded-2xl border p-4" style={{ borderColor: preflight.ready ? T.border : "#E8B7AD", background: T.soft }}>
            <div className="flex justify-between gap-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{creative.formato} · {creative.canal}</div><Badge label={creative.estado} /></div>
            <div className="display font-semibold mt-1">{creative.titulo}</div>
            <div className="text-xs mt-1 mb-3" style={{ color: T.choco2 }}>Sugerencia: {draft.fecha} · {draft.hora}</div>
            <Btn small kind={preflight.ready ? "primary" : "ghost"} onClick={() => planificarCreativo(creative)}>{preflight.ready ? "Planificar" : "Revisar borrador"}</Btn>
          </div>)}
        </div>
      </>}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SegmentedTabs
          ariaLabel="Bandejas del calendario"
          value={vista}
          onChange={setVista}
          className="momo-segmented-tabs inline-flex gap-1 p-1.5 rounded-2xl"
          tabClassName="rounded-xl border-0 px-4 py-2 text-xs font-extrabold"
          countClassName="ml-1 opacity-75"
          plainCount
          items={["Activas", "Distribución", "Historial"]}
          getCount={(tab) => tab === "Activas" ? commercialCalendar.active.length : tab === "Distribución" ? distributionRoom.queue.length : commercialCalendar.history.length}
        />
        <div className="flex gap-2"><Btn onClick={() => { setForm(vacio); setNueva(true); }}>＋ Nueva publicación</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>
      </div>

      <SectionTitle>{vista === "Activas" ? "Bandeja activa por día" : vista === "Distribución" ? "Sala de distribución comercial" : "Historial de publicaciones"}</SectionTitle>
      {vista === "Activas" ? <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
        {semana.map((dia, i) => {
          const delDia = pubs.filter((p) => p.fecha === dia);
          const esHoy = dia === hoyISO();
          return (
            <div key={dia} className="momo-trace-open w-56 shrink-0" style={{ animationDelay: `${i * 55}ms` }}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-bold" style={{ color: esHoy ? T.coral : T.choco2 }}>{new Date(dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric" })}{esHoy && " · hoy"}</span>
                <span className="text-xs font-bold" style={{ color: T.choco2, fontVariantNumeric: "tabular-nums" }}>{delDia.length}</span>
              </div>
              <div className="flex flex-col gap-2 min-h-[60px] rounded-2xl p-2" style={{ background: esHoy ? T.vainilla : T.vainilla + "80", border: esHoy ? `1.5px solid ${T.coral}40` : "1.5px solid transparent" }}>
                {delDia.map((p) => {
                  const cre = db.creatives.find((x) => x.id === p.creativeId);
                  const estadoPendiente = estadosPendientes[p.id];
                  return (
                    <Card key={p.id} className="momo-cal-card p-2.5">
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-xs font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{p.hora}</span>
                        <Badge label={p.canal} map={MK_CANAL_STYLE} />
                      </div>
                      <div className="text-xs font-semibold mt-1 leading-tight">{p.titulo}</div>
                      {cre && <div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>🎨 {cre.titulo}</div>}
                      <div className="mt-2 rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background: p.preflight.ready ? "#E8F1E4" : "#F6D4CD", color: p.preflight.ready ? "#3F6B42" : "#A03B2A" }}>{p.preflight.ready ? "✓ Preflight completo" : `⛔ ${p.preflight.errors[0]?.message}`}</div>
                      <select value={estadoPendiente ?? p.estado} disabled={Boolean(estadoPendiente)} onChange={(e) => cambiarEstado(p, e.target.value)} className="mt-2 w-full rounded-lg px-1.5 py-1 text-[11px] border font-bold disabled:opacity-60" style={inputStyle}>
                        {(db.distributionServerReady ? CAL_ESTADOS.filter((state) => state !== "Publicado") : CAL_ESTADOS).map((s) => <option key={s}>{s}</option>)}
                      </select>
                      {estadoPendiente && (
                        <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] font-bold" style={{ color: "#96690F" }} role="status">
                          <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
                          Guardando → {estadoPendiente}
                        </div>
                      )}
                    </Card>
                  );
                })}
                {delDia.length === 0 && <div className="text-[11px] text-center py-3 font-semibold" style={{ color: T.choco2 }}>Sin publicaciones</div>}
              </div>
            </div>
          );
        })}
      </div> : vista === "Distribución" ? <div id="agency-distribution-room" className="scroll-mt-24">
        {!db.distributionServerReady && <InlineNotice icon="🛡️" title="Vista previa protegida">Aplicá la migración 19 para guardar checklist, aprobación humana y evidencia externa.</InlineNotice>}
        {db.distributionServerReady && !db.distributionConnectorReady && <InlineNotice icon="🔌" title="Distribución manual activa">La migración 29 habilita la cola protegida para Meta y borradores de TikTok; hasta entonces el registro manual sigue disponible.</InlineNotice>}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-4">
          <Stat icon="⏱️" label="Deben salir" value={<CountUp value={distributionRoom.summary.due} />} tone={T.coral} />
          <Stat icon="✓" label="Aprobadas" value={<CountUp value={distributionRoom.summary.ready} />} tone="#3F6B42" />
          <Stat icon="👀" label="Por aprobar" value={<CountUp value={distributionRoom.summary.awaitingApproval} />} tone="#3E5C7E" />
          <Stat icon="⛔" label="Bloqueadas" value={<CountUp value={distributionRoom.summary.blocked} />} tone="#A03B2A" />
          <Stat icon="📊" label="Sin métricas" value={<CountUp value={distributionRoom.summary.needsMetrics} />} tone="#96690F" />
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          {distributionQueue.map((item) => <div key={item.post.id} className="rounded-[22px] border p-4" style={{ borderColor: item.blocked ? "#E8B7AD" : T.border, background: item.blocked ? "#FFF8F5" : "#fff", boxShadow: "0 8px 24px rgba(91,58,43,.06)" }}>
            <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: item.due ? T.coral : T.choco2 }}>{item.post.fecha} · {item.post.hora} · {item.post.canal}</div><div className="display font-semibold text-lg mt-1">{item.post.titulo}</div><div className="mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: item.contentMode === "Pauta" ? "#FFF1D8" : "#E8F1E4", color: item.contentMode === "Pauta" ? "#7B5410" : "#3F6B42" }}>{item.contentMode === "Pauta" ? "📣 PAUTA · CONVERSIÓN" : "🌱 ORGÁNICO · COMUNIDAD"}</div></div><Badge label={item.run?.status || item.post.estado} /></div>
            <div className="mt-3 rounded-2xl p-3" style={{ background: T.soft }}>
              <div className="flex justify-between gap-2 text-xs font-bold"><span>Checklist operativo</span><span style={{ color: item.readiness.checklistComplete ? "#3F6B42" : T.coral }}>{item.readiness.checked}/{item.readiness.total}</span></div>
              <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: "#E9DCCB" }}><div className="h-full rounded-full" style={{ width: `${item.readiness.total ? (item.readiness.checked / item.readiness.total) * 100 : 0}%`, background: item.readiness.checklistComplete ? "#5F8A61" : T.coral }} /></div>
            </div>
            <div className="mt-3 text-sm font-extrabold" style={{ color: item.blocked ? "#A03B2A" : T.choco }}>→ {item.action}</div>
            {item.readiness.errors[0] && <div className="text-[11px] mt-1" style={{ color: "#A03B2A" }}>{item.readiness.errors[0]}</div>}
            {item.run?.failureReason && <div className="text-xs mt-2 rounded-xl px-3 py-2" style={{ background: "#F6D4CD", color: "#8D3427" }}>Último fallo: {item.run.failureReason}</div>}
            {item.dispatch?.presentation && <div className="mt-3 rounded-2xl px-3 py-2.5" style={{ background: item.dispatch.job.status === "Incierto" ? "#FFF1ED" : item.dispatch.job.status === "Publicado" ? "#E8F1E4" : "#E9F0F7", color: item.dispatch.job.status === "Incierto" ? "#A03B2A" : item.dispatch.job.status === "Publicado" ? "#3F6B42" : "#3E5C7E" }}><div className="text-xs font-extrabold">{item.dispatch.presentation.label}</div><div className="text-[10px] mt-0.5">{item.dispatch.presentation.help} · intento {item.dispatch.job.attempt}</div></div>}
            <div className="flex flex-wrap gap-2 mt-4">
              {["Preparar salida","Completar checklist","Marcar lista"].includes(item.action) && <Btn small onClick={() => abrirPreparacion(item)} disabled={!item.readiness.readyToPrepare || !db.distributionServerReady}>Abrir checklist</Btn>}
              {item.action === "Aprobar salida" && <BtnAsync small onClick={() => aprobarSalidaComercial(item)} disabled={!db.distributionServerReady} textoEnVuelo="Aprobando…">Aprobar salida</BtnAsync>}
              {["Autorizar envío por Meta","Autorizar borrador TikTok"].includes(item.action) && <BtnAsync small onClick={() => autorizarSalidaConector(item)} textoEnVuelo="Autorizando…">{item.action}</BtnAsync>}
              {item.action === "Publicar y registrar evidencia" && <Btn small onClick={() => abrirCierre(item, "publish")} disabled={!db.distributionServerReady}>Registrar publicación manual</Btn>}
              {item.dispatch?.job?.status === "Fallido" && <BtnAsync small onClick={() => reintentarSalidaConector(item)} textoEnVuelo="Autorizando…">Reintentar conector</BtnAsync>}
              {item.dispatch?.job?.status === "Fallido" && <Btn small kind="ghost" onClick={() => abrirCierre(item, "publish")}>Registrar manualmente</Btn>}
              {item.dispatch?.job?.status === "Borrador listo" && <Btn small onClick={() => abrirCierre(item, "publish")}>Registrar publicación final</Btn>}
              {item.action === "Esperar horario" && <span className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#E9F0F7", color: "#3E5C7E" }}>Programada · todavía no ejecutar</span>}
              {item.action === "Revisar fallo" && <span className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Volvé a Pendiente y reprogramá para reintentar</span>}
              {!item.dispatch?.job && item.run && !["Publicada","Cancelada","Fallida"].includes(item.run.status) && <Btn small kind="ghost" onClick={() => abrirCierre(item, "fail")} disabled={!db.distributionServerReady}>Registrar fallo</Btn>}
            </div>
            {!item.dispatch?.job && item.run?.status === "Aprobada" && item.dispatch?.eligibility?.provider && !item.dispatch.eligibility.allowed && <div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Conector no disponible: {item.dispatch.eligibility.reasons[0]} Podés registrar la publicación manualmente.</div>}
          </div>)}
          {distributionQueue.length === 0 && <Empty icon="🚀" text="No hay publicaciones pendientes de distribución." />}
        </div>
        {distributionRoom.needsMetrics.length > 0 && <div className="rounded-2xl px-4 py-3 mt-4" style={{ background: "#FFF5E4", color: "#7B5410" }}><b>{distributionRoom.needsMetrics.length} publicación(es)</b> ya salieron y esperan captura de métricas en Resultados.</div>}
      </div> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {pubs.map((p) => {
          const cre = db.creatives.find((creativeItem) => creativeItem.id === p.creativeId);
          return <div key={p.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
            <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{p.fecha} · {p.hora} · {p.canal}</div><div className="font-bold text-sm mt-1">{p.titulo}</div></div><Badge label={p.estado} /></div>
            {cre && <div className="text-xs mt-2" style={{ color: T.choco2 }}>🎨 {cre.titulo}</div>}
            {p.copyFinal && <div className="text-xs mt-2 line-clamp-2">{p.copyFinal}</div>}
            <div className="text-[10px] font-semibold mt-3" style={{ color: p.urlPublicacion || p.externalPostId ? "#3F6B42" : "#96690F" }}>{p.urlPublicacion || p.externalPostId ? "✓ Evidencia externa registrada" : "Sin enlace externo registrado"}</div>
          </div>;
        })}
        {pubs.length === 0 && <Empty icon="🗓️" text="Todavía no hay publicaciones cerradas en el historial." />}
      </div>}

      {nueva && (
        <Modal title="Nueva publicación" onClose={() => setNueva(false)} wide>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Título"><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej: Reel gatitos lunes" /></Field>
            <Field label="Canal"><Select options={MK_CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
            <Field label="Fecha"><Input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Field>
            <Field label="Hora"><Input value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} placeholder="HH:MM" /></Field>
            <Field label="Campaña">
              <select value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value, creativeId: "" })} className={inputCls} style={inputStyle}>
                <option value="">Sin campaña</option>
                {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
            <Field label="Creativo">
              <select value={form.creativeId} onChange={(e) => {
                const id = e.target.value;
                const cr = db.creatives.find((x) => x.id === id);
                const draft = cr ? buildPostDraftFromCreative(cr, db, hoyISO()) : null;
                setForm(draft ? { ...form, ...draft } : { ...form, creativeId: "" });
              }} className={inputCls} style={inputStyle}>
                <option value="">Sin creativo</option>
                {db.creatives.filter((c) => !form.campaignId || c.campaignId === form.campaignId).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
              </select>
            </Field>
            <Field label="Guardar como"><Select options={["Pendiente","Programado"]} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
          </div>
          {form.creativeId && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: formScheduleGuard?.allowed ? "#E8F1E4" : "#F6D4CD", color: formScheduleGuard?.allowed ? "#3F6B42" : "#A03B2A" }}>{formScheduleGuard?.allowed ? "✓ Creativo, copy, campaña, canal y disponibilidad listos para programar." : `⛔ ${formScheduleGuard?.reasons[0] || "Falta completar el preflight."}`}</div>}
          <Field label="Copy final">
            <textarea rows={2} value={form.copyFinal} onChange={(e) => setForm({ ...form, copyFinal: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} />
          </Field>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear publicación</BtnAsync><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
        </Modal>
      )}

      {distributionDraft && distributionDraft.mode === "prepare" && (
        <Modal title={`Preparar salida · ${distributionDraft.item.post.id}`} onClose={() => setDistributionDraft(null)} wide>
          <div className="rounded-2xl p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF4EE,#F7E8D5)", border: `1px solid ${T.border}` }}>
            <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{distributionDraft.item.post.canal} · {distributionDraft.item.post.fecha} {distributionDraft.item.post.hora}</div>
            <div className="display text-xl font-semibold mt-1">{distributionDraft.item.post.titulo}</div>
            <div className="text-xs mt-1" style={{ color: T.choco2 }}>Este checklist no publica nada: deja la salida lista para una aprobación humana separada.</div>
          </div>
          <div className="space-y-2 mb-4">
            {distributionChecklistFor(distributionDraft.item.post, db).map((step) => <label key={step.key} className="flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer" style={{ borderColor: distributionDraft.checklist[step.key] ? "#A8C7A4" : T.border, background: distributionDraft.checklist[step.key] ? "#EFF6EC" : "#fff" }}>
              <input type="checkbox" checked={distributionDraft.checklist[step.key] === true} onChange={(event) => setDistributionDraft({ ...distributionDraft, checklist: { ...distributionDraft.checklist, [step.key]: event.target.checked } })} className="mt-0.5 w-4 h-4" />
              <span className="text-sm font-bold">{step.label}</span>
            </label>)}
          </div>
          <Field label="Notas de preparación"><Input value={distributionDraft.notes} onChange={(event) => setDistributionDraft({ ...distributionDraft, notes: event.target.value })} placeholder="Decisiones, cambios o detalles para quien aprueba" /></Field>
          <div className="flex gap-2 mt-3"><BtnAsync onClick={guardarPreparacionComercial} textoEnVuelo="Guardando…">Guardar preparación</BtnAsync><Btn kind="ghost" onClick={() => setDistributionDraft(null)}>Cancelar</Btn></div>
        </Modal>
      )}

      {distributionDraft && ["publish","fail"].includes(distributionDraft.mode) && (
        <Modal title={distributionDraft.mode === "publish" ? `Registrar publicación · ${distributionDraft.item.post.id}` : `Registrar fallo · ${distributionDraft.item.post.id}`} onClose={() => setDistributionDraft(null)} wide>
          {distributionDraft.mode === "publish" ? <>
            <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#E8F1E4", color: "#3F6B42" }}>✓ Salida aprobada. Confirmá la evidencia después de publicarla en {distributionDraft.item.post.canal}.</div>
            <Field label="URL pública"><Input value={distributionDraft.externalUrl} onChange={(event) => setDistributionDraft({ ...distributionDraft, externalUrl: event.target.value })} placeholder="https://instagram.com/p/..." /></Field>
            <Field label="ID externo (si la plataforma lo muestra)"><Input value={distributionDraft.externalPostId} onChange={(event) => setDistributionDraft({ ...distributionDraft, externalPostId: event.target.value })} placeholder="Ej: IG-123456" /></Field>
            <Field label="Nota de ejecución"><Input value={distributionDraft.notes} onChange={(event) => setDistributionDraft({ ...distributionDraft, notes: event.target.value })} placeholder="Publicada sin cambios / ajuste realizado" /></Field>
          </> : <>
            <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: "#FFF1ED", color: "#A03B2A" }}><b>La publicación quedará “No publicada”.</b> El motivo se conserva para corregir y reprogramar sin ocultar el fallo.</div>
            <Field label="Motivo obligatorio"><textarea rows={3} value={distributionDraft.reason} onChange={(event) => setDistributionDraft({ ...distributionDraft, reason: event.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Ej: la plataforma rechazó el formato del archivo" /></Field>
          </>}
          <div className="flex gap-2 mt-3"><BtnAsync onClick={cerrarSalidaComercial} textoEnVuelo="Registrando…">{distributionDraft.mode === "publish" ? "Confirmar publicación" : "Guardar fallo"}</BtnAsync><Btn kind="ghost" onClick={() => setDistributionDraft(null)}>Cancelar</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= RESULTADOS CREATIVOS 📊 ================= */

function ResultadosCreativos({ db, refrescar }) {
  const [nuevo, setNuevo] = useState(false);
  const vacio = { creativeId: "", fecha: hoyISO(), impresiones: 0, alcance: 0, clicks: 0, mensajesWhatsApp: 0, gasto: 0, notas: "" };
  const [form, setForm] = useState(vacio);
  const existente = db.creative_results.find((r) => r.fuente === "manual" && r.creativeId === form.creativeId && r.fecha === form.fecha);
  const resultados = resultadosDePlataforma(db);
  const numeroPreview = (valor) => {
    if (String(valor).trim() === "") return null;
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? numero : null;
  };
  const previewImpresiones = numeroPreview(form.impresiones);
  const previewClicks = numeroPreview(form.clicks);
  const previewMensajes = numeroPreview(form.mensajesWhatsApp);
  const previewGasto = numeroPreview(form.gasto);
  const previewCtr = previewImpresiones > 0 && previewClicks !== null ? previewClicks / previewImpresiones : null;
  const previewCostoMsg = previewMensajes > 0 && previewGasto !== null ? previewGasto / previewMensajes : null;

  function cargarDia(creativeId, fecha) {
    const r = db.creative_results.find((x) => x.fuente === "manual" && x.creativeId === creativeId && x.fecha === fecha);
    setForm(r ? {
      creativeId, fecha, impresiones: r.impresiones, alcance: r.alcance, clicks: r.clicks,
      mensajesWhatsApp: r.mensajesWhatsApp, gasto: r.gasto, notas: r.notas || "",
    } : { ...vacio, creativeId, fecha });
  }

  const metric = (r) => {
    const atrib = atribucionDeResultado(db, r);
    return {
      ...atrib,
      ctr: r.impresiones > 0 ? r.clicks / r.impresiones : null,
      costoMsg: r.mensajesWhatsApp > 0 ? r.gasto / r.mensajesWhatsApp : null,
      cac: atrib.contabilizar && atrib.pedidos > 0 ? r.gasto / atrib.pedidos : null,
      roas: atrib.contabilizar && r.gasto > 0 ? atrib.ventas / r.gasto : null,
      conv: atrib.contabilizar && r.mensajesWhatsApp > 0 ? atrib.pedidos / r.mensajesWhatsApp : null,
    };
  };

  function exportar() {
    downloadCSV("resultados-creativos",
      ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","CTR","Mensajes WA","Costo/msg","Pedidos","CAC","Ventas","Gasto","ROAS","Conv WA→pedido"],
      resultados.map((r) => { const cre = db.creatives.find((x) => x.id === r.creativeId); const camp = db.campaigns.find((x) => x.id === r.campaignId); const m = metric(r); return [r.id, cre ? cre.titulo : "", camp ? camp.nombre : "", r.fecha, r.impresiones, r.alcance, r.clicks, m.ctr ? (m.ctr * 100).toFixed(2) + "%" : "", r.mensajesWhatsApp, m.costoMsg ? Math.round(m.costoMsg) : "", m.contabilizar ? m.pedidos : "", m.cac ? Math.round(m.cac) : "", m.contabilizar ? m.ventas : "", r.gasto, m.roas ? m.roas.toFixed(2) : "", m.conv ? (m.conv * 100).toFixed(1) + "%" : ""]; }));
  }

  async function guardar() {
    if (!form.creativeId) { toast("error", "Elegí un creativo"); return; }
    const campos = ["impresiones", "alcance", "clicks", "mensajesWhatsApp", "gasto"];
    if (campos.some((k) => String(form[k]).trim() === "")) {
      toast("error", "Completá todas las métricas; un campo vacío no se guarda como cero"); return;
    }
    if (campos.some((k) => !Number.isFinite(Number(form[k])) || Number(form[k]) < 0)) {
      toast("error", "Las métricas deben ser números iguales o mayores a cero"); return;
    }
    // Impresiones/alcance/clicks/mensajes son integer en la RPC: un decimal la haría
    // rechazar ('10.5'::integer). Se ataja acá con el mismo mensaje que devuelve el server.
    if (["impresiones", "alcance", "clicks", "mensajesWhatsApp"].some((k) => !Number.isInteger(Number(form[k])))) {
      toast("error", "Impresiones, alcance, clicks y mensajes deben ser números enteros"); return;
    }
    let res;
    try {
      res = await registrarMetricasCreativo({
        creative_id: form.creativeId, fecha: form.fecha,
        impresiones: Number(form.impresiones), alcance: Number(form.alcance), clicks: Number(form.clicks),
        mensajes_wa: Number(form.mensajesWhatsApp), gasto: Number(form.gasto), notas: form.notas,
      });
    } catch (e) { toast("error", e.message); return; }
    setNuevo(false); setForm(vacio);
    toast("ok", res.actualizado ? "Métricas del día actualizadas" : "Métricas registradas");
    try { await refrescar(); } catch { toast("error", "Métricas guardadas; recargá para verlas"); }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => { setForm(vacio); setNuevo(true); }}>＋ Registrar métricas</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>
        Pedidos y ventas se calculan desde los pedidos atribuidos del servidor. Acá solo registrás métricas de la plataforma.
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {resultados.map((r) => {
          const cre = db.creatives.find((x) => x.id === r.creativeId);
          const camp = db.campaigns.find((x) => x.id === r.campaignId);
          const m = metric(r);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{cre ? cre.titulo : (r.creativeId ? "Creativo eliminado" : "Métricas de campaña")}</div>
                  <div className="text-[11px]" style={{ color: T.choco2 }}>{camp ? camp.nombre : "—"} · {r.fecha} · {r.fuente || "manual"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="display text-lg" style={{ color: m.roas >= 1 ? "#3F6B42" : "#A03B2A" }}>{m.roas !== null ? m.roas.toFixed(1) + "x" : "—"}</div>
                  <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>ROAS</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[["CTR", m.ctr !== null ? (m.ctr * 100).toFixed(1) + "%" : "—"], ["Costo/msg", m.costoMsg !== null ? fmt(m.costoMsg) : "—"], ["CAC", m.contabilizar && m.cac !== null ? fmt(m.cac) : "—"], ["Mensajes", r.mensajesWhatsApp], ["Pedidos", m.contabilizar ? m.pedidos : "—"], ["Conv WA", m.contabilizar && m.conv !== null ? (m.conv * 100).toFixed(0) + "%" : "—"]].map(([lab, v]) => (
                  <div key={lab} className="rounded-xl py-1.5" style={{ background: T.vainilla }}>
                    <div className="text-xs font-bold truncate px-0.5">{v}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>
                <span>👁️ {milCO(r.impresiones)} impres. · {milCO(r.alcance)} alcance</span>
                <span>💵 {m.contabilizar ? fmt(m.ventas) : "atribución en otra fuente"} / gasto {fmt(r.gasto)}</span>
              </div>
              {r.notas && <div className="text-xs mt-1.5" style={{ color: T.choco2 }}>📝 {r.notas}</div>}
            </Card>
          );
        })}
        {resultados.length === 0 && <Empty icon="📊" text="Sin resultados registrados." />}
      </div>

      {nuevo && (
        <Modal title={existente ? "Actualizar métricas del día" : "Registrar métricas de creativo"} onClose={() => setNuevo(false)} wide>
          <Field label="Creativo">
            <select value={form.creativeId} onChange={(e) => cargarDia(e.target.value, form.fecha)} className={inputCls} style={inputStyle}>
              <option value="">Elegir creativo…</option>
              {db.creatives.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
          </Field>
          {existente && (
            <div className="text-xs font-bold px-3 py-2 rounded-xl mb-3" style={{ background: "#DCE7F2", color: "#3E5C7E" }} role="status">
              Ya existe una captura manual para este creativo y día. Al guardar se actualiza; no se duplica.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
            <Field label="Fecha"><Input type="date" value={form.fecha} onChange={(e) => cargarDia(form.creativeId, e.target.value)} /></Field>
            <Field label="Impresiones"><Input type="number" step="1" min="0" value={form.impresiones} onChange={(e) => setForm({ ...form, impresiones: e.target.value })} /></Field>
            <Field label="Alcance"><Input type="number" step="1" min="0" value={form.alcance} onChange={(e) => setForm({ ...form, alcance: e.target.value })} /></Field>
            <Field label="Clicks"><Input type="number" step="1" min="0" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} /></Field>
            <Field label="Mensajes WhatsApp"><Input type="number" step="1" min="0" value={form.mensajesWhatsApp} onChange={(e) => setForm({ ...form, mensajesWhatsApp: e.target.value })} /></Field>
            <Field label="Gasto"><Input type="number" step="any" min="0" value={form.gasto} onChange={(e) => setForm({ ...form, gasto: e.target.value })} /></Field>
          </div>
          <div className="rounded-2xl p-3 mb-3" style={{ background: T.vainilla, border: `1px solid ${T.border}` }} aria-live="polite">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold">Vista previa de plataforma</span>
              <span className="text-[10px] font-semibold" style={{ color: T.choco2 }}>se actualiza al escribir</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["CTR", previewCtr !== null ? `${(previewCtr * 100).toFixed(1)}%` : "—"],
                ["Costo/msg", previewCostoMsg !== null ? fmt(previewCostoMsg) : "—"],
                ["Gasto", previewGasto !== null ? fmt(previewGasto) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl px-1 py-2" style={{ background: T.surface }}>
                  <div className="text-sm font-bold truncate">{value}</div>
                  <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar}>{existente ? "Actualizar métricas" : "Guardar métricas"}</BtnAsync><Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn></div>
        </Modal>
      )}
    </div>
  );
}


function getOrdersPanelShared() {
  return {
    T, hoyISO, fmt, copiarTexto, toast, Badge, Btn, BtnAsync, Card, Empty, Field, Input, MiniSelect,
    Modal, SectionTitle, Select, Stat, WorkScopeTabs, CANALES, CANAL_STYLE,
    EV_TIPOS, ORDER_STATES, ORIGEN_SIMPLE, availability, boxesAdicionesTotal, comboFaltantesEspecie,
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
    pct, toast, vibrar,
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
const MODULOS_EN_MIGRACION = ["Beneficios", "Finanzas", "Configuración"];
const PERFORMANCE_FRESHNESS_TTL = Object.freeze({
  [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
  [SYNC_DOMAINS.OPERATIONS]: 30_000,
  [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
});
const LAZY_PERFORMANCE_VIEWS = new Set(["Pedidos", "Empaque", "Producción", "Inventario terminado", "Inventario", "Crecimiento", "Finanzas"]);

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
  const agencyRealtimeSeenVersionRef = useRef("");
  const sessionOwnerRef = useRef(null);
  const activeStorageKeyRef = useRef(DB_KEY);
  const visibleSyncDomainsRef = useRef(new Set(syncDomainsForView(vista)));
  visibleSyncDomainsRef.current = new Set(syncDomainsForView(vista));
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
  }, [db]);
  useEffect(() => {
    const nextUserId = session?.user?.id || null;
    const previousUserId = sessionOwnerRef.current;
    syncCoordinatorRef.current?.cancel();
    syncCoordinatorRef.current = null;
    agencySnapshotVersionRef.current = "";
    agencyRealtimeSeenVersionRef.current = "";
    hidratadoRef.current = false;
    setCatalogosDe(null);
    activeStorageKeyRef.current = nextUserId ? `${DB_KEY}:${nextUserId}` : DB_KEY;
    if (previousUserId !== nextUserId && (previousUserId || nextUserId)) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      saveTokenRef.current += 1;
      const clean = seedDb();
      dbRef.current = clean;
      setDb(clean);
      setSync(nextUserId ? "cargando" : "local");
    }
    sessionOwnerRef.current = nextUserId;
    return () => {
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
    let alive = true;
    const pendingDomains = new Set();
    const realtimeDomains = new Set(syncDomainsForView(vista));
    const operationsRealtime = realtimeDomains.has(SYNC_DOMAINS.OPERATIONS);
    const catalogsRealtime = realtimeDomains.has(SYNC_DOMAINS.CATALOGS);
    const agencyRealtime = realtimeDomains.has(SYNC_DOMAINS.AGENCY);
    const tables = [];
    if (operationsRealtime) tables.push(
      "orders", "order_items", "order_item_adiciones", "packing_verifications", "evidences", "deliveries",
      "customers", "benefits", "claims", "inventory_movements", "inventory_reservations", "production_suggestions",
      "production_batches", "lote_figuras", "subreceta_producciones", "audit_logs",
    );
    if (catalogsRealtime) tables.push(
      "products", "combo_components", "inventory_items", "inventory_lots", "recipes", "users", "toppings", "figuras",
      "catalog_values", "zonas", "proveedores_domicilio", "brand_library", "app_settings", "subrecetas", "subreceta_ingredientes", "figura_relleno",
    );
    if (operationsRealtime && db.operationalControlReady) tables.push("order_stage_assignments", "order_line_progress", "order_incidents", "order_dispatch_handoffs");
    if (operationsRealtime && db.crmServerReady) tables.push("customer_crm_profiles", "customer_contacts", "customer_activations");
    // H66 publica un único outbox autorizado. Suscribirse a las tablas crudas
    // duplicaba decenas de eventos y revelaba el esquema interno. El flag evita
    // tocar una tabla inexistente durante el rollout; pre-H66 conserva polling.
    if (agencyRealtime && db.agencySnapshotReady === true) tables.push("agency_snapshot_events");
    let channel = supabase.channel(`momos-operacion-${session.user.id}`);
    const refresh = (domain) => {
      pendingDomains.add(domain);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive || !hidratadoRef.current) return;
        const domains = [...pendingDomains];
        pendingDomains.clear();
        refetchFocoRef.current?.(domains, { reason: "realtime", afterActive: true }).catch(() => setRealtimeStatus("reconectando"));
      }, 350);
    };
    tables.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        const domain = syncDomainForTable(table);
        if (table === "agency_snapshot_events") {
          const incomingVersion = normalizeAgencySnapshotVersion(payload?.new?.version);
          if (shouldQueueAgencySnapshotVersion({
            incomingVersion,
            appliedVersion: agencySnapshotVersionRef.current,
            seenVersion: agencyRealtimeSeenVersionRef.current,
          })) {
            agencyRealtimeSeenVersionRef.current = incomingVersion;
            refresh(SYNC_DOMAINS.AGENCY);
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
    channel.subscribe((status) => {
      if (!alive) return;
      if (status === "SUBSCRIBED") {
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
              refresh(SYNC_DOMAINS.AGENCY);
            }
          }).catch(() => {
            if (alive) setRealtimeStatus("reconectando");
          });
        }
      }
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setRealtimeStatus("reconectando");
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, perfil?.id, vista, Boolean(db?.operationalControlReady), Boolean(db?.crmServerReady), Boolean(db?.agencySnapshotReady)]);

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

  // ── Fase 3: hidratar desde Supabase (una vez por carga; re-usable tras cada escritura remota) ──
  // Maestros/catálogos + operativo + campaigns/creatives/content_posts/metrics_daily.
  function aplicarDominiosServidor(payload) {
    const catalogs = payload?.[SYNC_DOMAINS.CATALOGS];
    const agency = payload?.[SYNC_DOMAINS.AGENCY];
    const op = payload?.[SYNC_DOMAINS.OPERATIONS];
    update((d) => {
      if (catalogs) {
      const cat = catalogs;
      d.products = cat.products;
      d.productsServerReady = Boolean(cat.productsServerReady);
      d.inventory_items = cat.inventory_items;
      d.inventory_lots = cat.inventory_lots || [];
      d.inventoryLotsReady = Boolean(cat.inventoryLotsReady);
      d.recipes = cat.recipes;
      d.users = cat.users;
      d.multipleRolesReady = Boolean(cat.multipleRolesReady);
      d.figuras = cat.figuras || []; // catálogo figuras con product_id/gramaje (Producción v2)
      d.subrecetas = cat.subrecetas || []; // Componentes+BOM: bases (mousses/cheesecake/ganache/salsas/crocante)
      d.subreceta_ingredientes = cat.subreceta_ingredientes || []; // receta maestra por 1000 g
      d.figura_relleno = cat.figura_relleno || []; // relleno configurable de figuras (20/15 g editables)
      Object.assign(d.settings, cat.settingsCatalogos);
      }
      if (agency) {
      const cat = agency;
      // Solo el contrato H66 puede habilitar el outbox Realtime. El fallback
      // legado carga datos, pero nunca intenta suscribirse a una tabla ausente.
      d.agencySnapshotReady = cat.agencySnapshotReady === true;
      d.agencySnapshotVersion = normalizeAgencySnapshotVersion(cat.agencySnapshotVersion);
      agencySnapshotVersionRef.current = d.agencySnapshotVersion;
      if (compareAgencySnapshotVersions(d.agencySnapshotVersion, agencyRealtimeSeenVersionRef.current) === 1
          || !agencyRealtimeSeenVersionRef.current) {
        agencyRealtimeSeenVersionRef.current = d.agencySnapshotVersion;
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
      if (op) Object.assign(d, op); // orders, order_items, customers, deliveries, evidences, benefits, claims, movements, reservations, suggestions, audit, production_batches
      normalizeDbShape(d); // re-deriva atributos/especie sobre lo hidratado
    }, { silencioso: true, persistir: false });
  }

  function hidratarDesdeServidor(dominios, context = {}) {
    if (!syncCoordinatorRef.current) {
      syncCoordinatorRef.current = createSyncCoordinator({
        loaders: {
          [SYNC_DOMAINS.CATALOGS]: () => measureSyncLoad(
            SYNC_DOMAINS.CATALOGS,
            () => fetchCatalogos({ includeAgency: false }),
          ),
          [SYNC_DOMAINS.OPERATIONS]: () => measureSyncLoad(SYNC_DOMAINS.OPERATIONS, fetchOperativo),
          [SYNC_DOMAINS.AGENCY]: () => measureSyncLoad(
            SYNC_DOMAINS.AGENCY,
            fetchAgencyCatalogosConFallback,
          ),
        },
        apply: aplicarDominiosServidor,
        onState: (state) => {
          if (["synced", "partial"].includes(state.status)) {
            (state.domains || []).forEach((domain) => {
              runtimePerformance.markDomainReady(domain, performanceRouteRef.current);
            });
          }
          if (import.meta.env.DEV && typeof window !== "undefined") {
            window.MOMOS_SYNC_METRICS = state;
            window.__MOMOS_SYNC_METRICS__ = state; // alias temporal para sesiones DEV anteriores
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
      const visibles = new Set(syncDomainsForView(vista));
      let vencidos = syncCoordinatorRef.current?.staleDomains({
        [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
        [SYNC_DOMAINS.OPERATIONS]: 60_000,
        [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
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
    if (!perfil || !db || hidratadoRef.current) return;
    hidratadoRef.current = true;
    (async () => {
      try {
        await hidratarDesdeServidor(syncDomainsForView(vista), { reason: "initial" });
        setCatalogosDe("servidor");
      } catch (e) {
        console.warn("Hidratación: no se pudo leer de Supabase; se usa la caché local.", e);
        setCatalogosDe("cache");
      }
    })();
  }, [perfil, db]);

  useEffect(() => {
    if (!hidratadoRef.current || !syncCoordinatorRef.current) return;
    const visibles = new Set(syncDomainsForView(vista));
    const vencidos = syncCoordinatorRef.current.staleDomains({
      [SYNC_DOMAINS.CATALOGS]: 15 * 60_000,
      [SYNC_DOMAINS.OPERATIONS]: 30_000,
      [SYNC_DOMAINS.AGENCY]: 5 * 60_000,
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
            const payload = JSON.stringify(dbRef.current);
            const storageKey = activeStorageKeyRef.current;
            storage.set(storageKey, payload); // best-effort al backend real (no se puede await en unload)
            if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, payload); // espejo
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
      const requiredDomains = syncDomainsForView(v);
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

  useEffect(() => {
    (async () => {
      const guardado = await dbLoad();
      if (sessionOwnerRef.current) return; // la sesión ya inicializó un estado aislado
      if (guardado && guardado._corruptStorage) {
        // base local dañada: NO cargar semilla ni sobrescribir
        setCorruptStorage(true);
        setSync("local");
        return;
      }
      if (guardado && guardado._readError) {
        // #9: falló la LECTURA (no es "vacío"): no resembrar encima de datos posiblemente reales
        setCorruptStorage(true);
        setSync("local");
        return;
      }
      if (guardado && guardado._incompatibleVersion) {
        // base guardada es de una versión más nueva que esta app: NO cargar semilla ni sobrescribir
        setIncompat(guardado.version);
        setSync("local");
        return;
      }
      if (guardado) {
        if (guardado._migrated) {
          delete guardado._migrated;
          setDb(guardado);
          const ok = await dbPersist(guardado, activeStorageKeyRef.current);
          setSync(ok ? "guardado" : "error");
        } else {
          setDb(guardado);
          setSync("guardado");
        }
      } else {
        const semilla = seedDb();
        setDb(semilla);
        const ok = await dbPersist(semilla, activeStorageKeyRef.current);
        setSync(ok ? "guardado" : "error");
      }
    })();
  }, []);

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

  async function resetear() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await dbReset(activeStorageKeyRef.current);
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
    return hidratarDesdeServidor(syncDomainsForView(activa), { reason: "action", ...context });
  }

  function render() {
    const p = { db, update, user, refrescar: refrescarVistaActual, perfil, serverDataReady: Boolean(catalogosDe), performanceRouteId: performanceRouteRef.current };
    switch (activa) {
      case "Dashboard": return <Dashboard db={db} go={go} user={user} />;
      case "Pedidos": return <OrdersPanel section="Pedidos" {...p} focus={focus} />;
      case "Producción": return <Produccion {...p} focus={focus} />;
      case "Empaque": return <OrdersPanel section="Empaque" {...p} />;
      case "Inventario terminado": return <InventarioTerminado {...p} go={go} />;
      case "Inventario": return <Inventario {...p} focus={focus} go={go} />;
      case "Productos": return <Productos {...p} />;
      case "Domicilios": return <Domicilios {...p} />;
      case "Reclamos": return <Reclamos {...p} focus={focus} />;
      case "Historial operativo": return <HistorialOperativo db={db} />;
      case "Clientes": return <Clientes {...p} />;
      case "Beneficios": return <Beneficios {...p} />;
      case "Crecimiento": return <Crecimiento {...p} go={go} />;
      case "Marketing": return <Marketing {...p} />;
      case "Creativos": return <Creativos {...p} />;
      case "Calendario": return <Calendario {...p} />;
      case "Resultados": return <ResultadosCreativos {...p} />;
      case "Finanzas": return <Finanzas {...p} />;
      case "Reportes": return <Reportes db={db} />;
      case "Configuración": return <Configuracion {...p} resetear={resetear} restaurarBackup={restaurarBackup} />;
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
