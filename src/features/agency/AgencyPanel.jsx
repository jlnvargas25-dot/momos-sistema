import { useEffect, useMemo, useRef, useState } from "react";
import { hasRole } from "../../lib/user-roles";
import { fetchBrandAssetSignedUrl } from "../../lib/read-model";
import { agencyDecisionType, buildAgencyIntelligence, DEFAULT_AGENCY_SETTINGS, guardAgencyAction } from "../../lib/agency-intelligence";
import { buildOrchestratorInbox, orchestratorProposalPayload } from "../../lib/agency-orchestrator";
import { agencyActionDestination, buildAgencyActionQueue } from "../../lib/agency-action-queue";
import { AGENCY_EVIDENCE_KINDS, AGENCY_OBSERVED_RESULTS, AGENCY_OUTCOME_STATUSES, agencyOutcomeDefaults, agencyOutcomePayload, validateAgencyOutcome } from "../../lib/agency-action-outcome";
import { AGENCY_COLLABORATION_ENTRY_TYPES, AGENCY_CONTENT_MODES, AGENCY_CONTRACT_KPIS, AGENCY_MODE_METRICS, agencyContractConstraints, agencyContractDirection, agencyRoomPayload, buildAgencyCollaborationDesk } from "../../lib/agency-collaboration";
import { STORYBOARD_ASPECT_RATIOS, STORYBOARD_CHANNELS, STORYBOARD_FORMATS, buildAgencySceneStudio, shotPayload, storyboardPayload } from "../../lib/agency-scene-studio";
import { buildAgencyMotionCenter, buildMotionPlanDraft, motionPlanPayload } from "../../lib/agency-motion-experience";
import { SCENE_ROUTE_PROVIDERS, buildAgencySceneRouter, buildSceneRoutingDraft, sceneRoutingPayload } from "../../lib/agency-scene-router";
import { AGENCY_QUALITY_CRITERIA, AGENCY_QUALITY_FAILURE_TYPES, buildAgencyQualityCenter, evaluateSceneQuality, postproductionPackagePayload, sceneQualityReviewPayload } from "../../lib/agency-quality-control";
import { buildPostproductionExportCenter, evaluatePostproductionMaster, postproductionExportPayload } from "../../lib/agency-postproduction-export";
import { RETENTION_PLATFORMS, buildAgencyRetentionCenter, retentionScriptPayload } from "../../lib/agency-retention-engine";
import { buildAgencyLoopLearningCenter, loopDiagnosticPayload } from "../../lib/agency-loop-learning";
import { buildAgencyMetaCenter } from "../../lib/agency-meta-observatory";
import { buildMetaIncrementalityCenter, liftStudyPayload } from "../../lib/agency-meta-incrementality";
import { buildMetaInvestmentCenter, investmentScenarioPayload } from "../../lib/agency-meta-investment";
import { buildMetaAuthorizationCenter, metaAuthorizationPayload } from "../../lib/agency-meta-authorization";
import { buildMetaConnectorCenter } from "../../lib/agency-meta-connector";
import { buildCreativeFlightCenter, creativeCandidatesForFlight, creativeRelayStep, publicationCandidatesForFlight, publicationDraftForFlight } from "../../lib/agency-creative-flight";
import { FRIENDLY_AGENCY_GOALS, buildFriendlyAgencyGuide } from "../../lib/agency-friendly-guide";
import { buildGrowthMultimodeEngine, growthSnapshotPayload } from "../../lib/growth-multimode-engine";
import { brandIdentitySummary, buildBrandIdentityView } from "../../lib/brand-identity";
import { fetchBrandIdentity } from "../../lib/brand-identity-api";
import { buildCommercialLearning } from "../../lib/commercial-learning";
import { buildCreativePackage } from "../../lib/creative-package";
import { ANIMATION_ASSET_KINDS, ANIMATION_ASSET_ROLES, BRAND_ASSET_ROLES, BRAND_MEDIA_RIGHTS, BRAND_MEDIA_TYPES, BRAND_STUDIO_FORMATS, BRAND_STUDIO_OPERATIONS, brandAssetDeletionPolicy, brandAssetDeletionReadiness, buildBrandMediaLibrary, buildCreativeStudioDraft, isOfficialBrandLogo, searchBrandMediaAssets } from "../../lib/brand-studio";
import { PRODUCTION_COMPONENT_TYPES, PRODUCTION_CONSENT_STATUSES, PRODUCTION_HAND_ASSIGNMENTS, PRODUCTION_INTERACTIONS, PRODUCTION_PACK_ROLES, PRODUCTION_PHYSICAL_STATES, PRODUCTION_QA_STATUSES, PRODUCTION_SOURCE_QUALITIES, PRODUCTION_VIEW_ANGLES, buildProductionLibrary, defaultProductionProfile, productionProfilePayload } from "../../lib/production-library";
import { CREATIVE_PROVIDERS, buildCreativeProductionQueue, creativeAuthorizationGuard } from "../../lib/creative-production";
import { AGENCY_INTEGRATION_ENVIRONMENTS, agencyProviderExecutionGuard, buildAgencyIntegrationCenter } from "../../lib/agency-integrations";
import {
  registrarContactoCliente, crearCampana, editarCampana, setCampanaEstado, crearCreativo, crearPublicacion,
  guardarConfiguracionAgencia, crearBriefAgencia, registrarSnapshotMotorCrecimiento, seleccionarModoCrecimiento,
  setEstadoBriefAgencia, crearDecisionAgencia, resolverDecisionAgencia, registrarResultadoAccionAgencia,
  registrarRecomendacionOrquestador, resolverPropuestaOrquestador, abrirMesaAgencia, agregarAporteMesaAgencia,
  prepararContratoCreativo, aprobarContratoCreativo, crearStoryboardAgencia, guardarTomaStoryboard,
  enviarStoryboardRevision, resolverStoryboardAgencia, prepararPlanMotion, resolverPlanMotion,
  prepararEnrutamientoEscenas, resolverEnrutamientoEscenas, registrarRevisionCalidadEscena,
  resolverRevisionCalidadEscena, prepararPaquetePostproduccion, resolverPaquetePostproduccion,
  autorizarExportacionPostproduccion, resolverControlMasterPostproduccion, reintentarExportacionPostproduccion,
  prepararGuionRetencion, resolverGuionRetencion, crearExperimentoRetencion, cerrarExperimentoRetencion,
  prepararDiagnosticoRetencion, resolverDiagnosticoRetencion, crearVersionCreativaAgencia,
  revisarVersionCreativaAgencia, subirActivoMarca, declararLogoPrincipalMarca, archivarActivoMarca,
  actualizarMetadatosActivoMarca, eliminarActivoMarca, eliminarLogoOficialMarca, crearTrabajoCreativo,
  autorizarTrabajoCreativo, cancelarTrabajoCreativo, reintentarTrabajoCreativo, revisarSalidaCreativa,
  crearRevisionSalidaCreativa, guardarReferenciaIntegracionAgencia, pausarIntegracionAgencia,
  prepararDiagnosticoMeta, resolverDiagnosticoMeta, crearEstudioIncrementalMeta, resolverEstudioIncrementalMeta,
  resolverMedicionIncrementalMeta, crearEscenariosInversionMeta, resolverEscenariosInversionMeta,
  solicitarAutorizacionInversionMeta, resolverAutorizacionInversionMeta, revocarAutorizacionInversionMeta,
  prepararDryRunMeta, prepararRelevoMasterCreativo, vincularPublicacionMaster, clasificarActivoProduccion,
  crearPaqueteProduccion, crearTrabajoDesdePaqueteProduccion, resolverAprobacionHumanaMcp, revisarPaqueteProduccion
} from "../../lib/rpc";

export function createAgencyPanel(shared) {
  const {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty,
  } = shared;
  const statusTone = (status) => status === "Aprobado"
    ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisi?n"
      ? { bg: "#FFF2D8", fg: "#7A5410" }
      : { bg: "#E5EEF7", fg: "#315A7D" };

/* ================= CRECIMIENTO MOMOS 🌱 =================
   Asistente diario de marca en lenguaje simple.
   Traduce campañas, creativos y resultados a "qué hacer hoy". */

// Botón de copiar con feedback visual
function CopyBtn({ texto, label = "Copiar texto" }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn small kind="rosa" onClick={() => { if (copiarTexto(texto)) { setOk(true); setTimeout(() => setOk(false), 1500); } }}>
      {ok ? "¡Copiado! ✓" : "📋 " + label}
    </Btn>
  );
}

function LazyBrandMediaPreview({ asset, mediaIcon, eager = false, fit = "cover", controls = false }) {
  const hostRef = useRef(null);
  const [visible, setVisible] = useState(eager);
  const [url, setUrl] = useState(asset.url || "");

  useEffect(() => {
    setUrl(asset.url || "");
    setVisible(eager);
  }, [asset.id, asset.url, eager]);

  useEffect(() => {
    if (eager) { setVisible(true); return undefined; }
    const node = hostRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [asset.id, eager]);

  useEffect(() => {
    if (!visible || url || !asset.storagePath) return undefined;
    let alive = true;
    fetchBrandAssetSignedUrl(asset.storagePath)
      .then((signedUrl) => { if (alive) setUrl(signedUrl); })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible, url, asset.storagePath]);

  const isImage = asset.mediaType === "Foto" || asset.mediaType === "Logo"
    || (asset.mediaType === "Diseño" && asset.mimeType?.startsWith("image/"));
  return <div ref={hostRef} className="w-full h-full grid place-items-center overflow-hidden">
    {url && isImage
      ? <img src={url} alt={asset.name} className={`w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />
      : url && asset.mediaType === "Video"
        ? <video src={url} className={`w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`} preload="metadata" muted controls={controls} />
        : url && asset.mediaType === "Audio"
          ? <div className="px-4 w-full text-center"><div className="text-4xl mb-3">🎧</div><audio src={url} controls preload="none" className="w-full" /></div>
          : <div className="text-center"><div className="text-4xl">{mediaIcon[asset.mediaType] || "✦"}</div>{visible && asset.storagePath && <div className="text-[9px] mt-2" style={{ color: T.choco2 }}>Cargando vista segura…</div>}</div>}
  </div>;
}

function formatAssetSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "Sin tamaño verificable";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function AgencyBrandStudio({ db, user, refrescar, initialIntent = null, onIdentityChanged }) {
  const ready = Boolean(db.brandMediaReady);
  const animationReady = Boolean(db.mundoAnimadoReady);
  const officialLogoDeletionReady = Boolean(db.officialLogoDeletionReady);
  const productionAssetsReady = Boolean(db.brandProductionReady);
  const productionReady = Boolean(db.creativeProductionReady);
  const reviewReady = Boolean(db.creativeReviewReady);
  const iterationReady = Boolean(db.creativeIterationReady);
  const humanApprovalReady = Boolean(db.mcpHumanApprovalReady);
  const canWrite = hasRole(user, "Administrador") || hasRole(user, "Marketing/CRM");
  const isAdmin = hasRole(user, "Administrador");
  const library = useMemo(() => buildBrandMediaLibrary(db, hoyISO()), [db]);
  const productionLibrary = useMemo(() => buildProductionLibrary(db), [db]);
  const productionQueue = useMemo(() => buildCreativeProductionQueue(db), [db]);
  const integrationCenter = useMemo(() => buildAgencyIntegrationCenter(db, new Date()), [db]);
  const humanApprovals = useMemo(() => (db.mcpHumanApprovals || []).slice(0, 8), [db.mcpHumanApprovals]);
  const canConfigureIntegrations = hasRole(user, "Administrador");
  const [section, setSection] = useState("Biblioteca");
  const [query, setQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState("");
  const [libraryCollection, setLibraryCollection] = useState("Marca");
  const [showArchived, setShowArchived] = useState(false);
  const [productionComponentFilter, setProductionComponentFilter] = useState("");
  const [packOpen, setPackOpen] = useState(false);
  const [packForm, setPackForm] = useState({ name: "", purpose: "", productId: "", figure: "", channel: "Instagram", targetFormat: "Reel 9:16", description: "", requiredRoles: ["Producto"], members: [] });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteAsset, setDeleteAsset] = useState(null);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [detailAssetId, setDetailAssetId] = useState(null);
  const [assetEditForm, setAssetEditForm] = useState(null);
  const [file, setFile] = useState(null);
  const emptyAssetForm = {
    collection: "Marca", brandRole: "Referencia visual", name: "", mediaType: "Foto", source: "MOMOS",
    productId: "", figure: "", flavor: "", shotType: "Referencia visual", orientation: "Vertical",
    animationKind: "Personaje", animationCanon: false,
    containsPeople: false, rightsStatus: "Propio", rightsExpiresAt: "", aiUseAllowed: true, tags: "", notes: "",
    productionEnabled: false, ...defaultProductionProfile("Producto"),
  };
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [studio, setStudio] = useState({
    creativeId: "", briefId: "", operation: "Componer", provider: "Por conectar",
    targetChannel: "Instagram", targetFormat: "Reel 9:16", assetIds: [], instructions: "", productionPackId: "",
  });
  const [authorizationJob, setAuthorizationJob] = useState(null);
  const [authorizationCap, setAuthorizationCap] = useState("30000");
  const [reviewJob, setReviewJob] = useState(null);
  const [reviewDecision, setReviewDecision] = useState("Aprobada");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [integrationEdit, setIntegrationEdit] = useState(null);
  const visibleAssets = useMemo(() => searchBrandMediaAssets(library, query, {
    collection: libraryCollection, mediaType: mediaFilter, status: showArchived ? "" : "Activo",
  }), [library, query, libraryCollection, mediaFilter, showArchived]);
  const detailAsset = useMemo(() => library.assets.find((asset) => String(asset.id) === String(detailAssetId)) || null, [library, detailAssetId]);
  const visibleProductionAssets = useMemo(() => productionLibrary.active.filter((asset) => !productionComponentFilter || asset.productionProfile?.componentType === productionComponentFilter), [productionLibrary.active, productionComponentFilter]);
  const approvedProductionPacks = useMemo(() => productionLibrary.packs.filter((pack) => pack.status === "Aprobado" && pack.readiness.ready), [productionLibrary.packs]);
  const deletePolicy = useMemo(() => brandAssetDeletionPolicy(deleteAsset || {}, db, {
    isAdmin, officialLogoDeletionReady,
  }), [deleteAsset, db, isAdmin, officialLogoDeletionReady]);
  const studioDraft = useMemo(() => buildCreativeStudioDraft(studio, db, hoyISO()), [studio, db]);
  const animationEntities = useMemo(() => {
    const grouped = new Map();
    library.active.filter((asset) => asset.collection === "Animación").forEach((asset) => {
      const name = asset.figure?.trim() || "Elemento sin identificar";
      const current = grouped.get(name) || { name, count: 0, canonical: 0, roles: new Set(), kinds: new Set() };
      current.count += 1;
      current.canonical += asset.animationCanonical ? 1 : 0;
      if (asset.roleLabel) current.roles.add(asset.roleLabel);
      if (asset.animationKind) current.kinds.add(asset.animationKind);
      grouped.set(name, current);
    });
    return [...grouped.values()].map((item) => ({ ...item, roles: [...item.roles], kinds: [...item.kinds] }))
      .sort((a, b) => b.canonical - a.canonical || a.name.localeCompare(b.name, "es"));
  }, [library.active]);

  function openAssetUpload(collection = libraryCollection, brandRole = "", animationKind = "Personaje") {
    const isBrand = collection === "Marca";
    const isAnimation = collection === "Animación";
    if (isAnimation && !animationReady) {
      setLibraryCollection(collection);
      toast("alert", "Mundo animado quedará habilitado al aplicar la migración 59.");
      return;
    }
    const role = brandRole || (isBrand ? "Referencia visual" : isAnimation ? "Diseño base" : "Producto");
    const productionComponent = isBrand ? "Marca" : isAnimation ? "Personaje" : "Producto";
    setLibraryCollection(collection);
    setAssetForm({
      ...emptyAssetForm, collection, brandRole: isBrand ? role : "", shotType: role, animationKind,
      mediaType: /logo/i.test(role) ? "Logo" : isBrand || isAnimation ? "Foto" : "Video",
      productionEnabled: productionAssetsReady, ...defaultProductionProfile(productionComponent),
    });
    setFile(null);
    setUploadOpen(true);
  }

  useEffect(() => {
    if (!initialIntent?.key) return;
    const collection = initialIntent.collection || "Marca";
    setSection("Biblioteca");
    setLibraryCollection(collection);
    if (initialIntent.openUpload) openAssetUpload(collection, initialIntent.brandRole);
  }, [initialIntent?.key]);

  function chooseFile(selected) {
    setFile(selected || null);
    if (!selected) return;
    const detectedType = selected.type.startsWith("video/") ? "Video"
      : selected.type.startsWith("audio/") ? "Audio"
        : selected.type === "application/pdf" ? "Diseño" : "Foto";
    const mediaType = assetForm.collection === "Marca" && /logo/i.test(assetForm.brandRole) ? "Logo" : detectedType;
    const orientation = mediaType === "Audio" ? "Audio" : mediaType === "Diseño" ? "Documento" : "Vertical";
    setAssetForm((current) => ({
      ...current, mediaType, orientation,
      name: current.name || selected.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
    }));
  }

  async function saveAsset() {
    try {
      if (!ready) throw new Error("Aplicá primero la migración 20 de Biblioteca Creativa.");
      if (!canWrite) throw new Error("Solo Administración o Marketing/CRM pueden registrar originales de marca.");
      const isBrand = assetForm.collection === "Marca";
      const isAnimation = assetForm.collection === "Animación";
      if (isAnimation && !animationReady) throw new Error("Aplicá primero la migración 59 de Mundo animado.");
      if (isAnimation && assetForm.figure.trim().length < 2) throw new Error("Escribí el nombre del personaje o elemento del mundo animado.");
      if (isAnimation && assetForm.animationCanon && !hasRole(user, "Administrador")) throw new Error("Solo Administración puede declarar una referencia canónica del mundo animado.");
      const marker = isBrand ? "momos:marca" : isAnimation ? "momos:animacion" : "momos:producto";
      const userTags = assetForm.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag && !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(tag));
      const animationTags = isAnimation ? [`animacion:tipo:${assetForm.animationKind.toLocaleLowerCase("es")}`, ...(assetForm.animationCanon ? ["animacion:canon"] : [])] : [];
      const tags = [...new Set([marker, ...animationTags, ...userTags])];
      const result = await subirActivoMarca(file, {
        name: assetForm.name, media_type: assetForm.mediaType, source: assetForm.source,
        product_id: isBrand || isAnimation ? null : assetForm.productId || null,
        figure: isBrand ? "" : assetForm.figure, flavor: isBrand ? "" : assetForm.flavor,
        shot_type: isBrand ? assetForm.brandRole : assetForm.shotType, orientation: assetForm.orientation,
        contains_people: assetForm.containsPeople, rights_status: assetForm.rightsStatus,
        rights_expires_at: assetForm.rightsExpiresAt || null, ai_use_allowed: assetForm.aiUseAllowed,
        allowed_channels: [], tags, notes: assetForm.notes,
      });
      const isPrimaryLogo = isBrand && assetForm.brandRole === "Logo principal";
      if (isPrimaryLogo) {
        await declararLogoPrincipalMarca(result.asset_id);
        await onIdentityChanged?.();
      }
      let productionProfileError = "";
      if (assetForm.productionEnabled && productionAssetsReady) {
        try {
          await clasificarActivoProduccion(result.asset_id, productionProfilePayload(assetForm));
        } catch (error) {
          productionProfileError = error.message;
        }
      }
      setUploadOpen(false); setFile(null); setAssetForm(emptyAssetForm);
      toast(productionProfileError ? "alert" : "ok", productionProfileError
        ? `El original quedó protegido, pero falta completar su ficha de producción: ${productionProfileError}`
        : isPrimaryLogo ? "Logo principal guardado y declarado en la identidad oficial de MOMOS" : `Original guardado en ${assetForm.collection}`);
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function archiveAsset(asset) {
    const reason = window.prompt(`¿Por qué vas a archivar "${asset.name}"? El original no se borrará.`, "");
    if (!reason) return;
    try {
      await archivarActivoMarca(asset.id, reason);
      toast("ok", "Activo archivado; su historial y usos permanecen intactos");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  function openAssetDetail(asset) {
    setDetailAssetId(asset.id);
    setAssetEditForm(null);
  }

  function openDeleteConfirmation(asset) {
    setDeleteAsset(asset);
    setDeleteAcknowledged(false);
    setDeleteConfirmationText("");
  }

  function closeDeleteConfirmation() {
    setDeleteAsset(null);
    setDeleteAcknowledged(false);
    setDeleteConfirmationText("");
  }

  function beginAssetMetadataEdit(asset) {
    const dependency = brandAssetDeletionReadiness(asset, db);
    const officialLogo = asset.collection === "Marca" && asset.mediaType === "Logo" && /principal/i.test(asset.roleLabel || "");
    const defaultComponent = asset.collection === "Marca" ? "Marca" : asset.collection === "Animación" ? "Personaje" : "Producto";
    const productionProfile = asset.productionProfile || defaultProductionProfile(defaultComponent);
    setAssetEditForm({
      semanticLocked: !dependency.allowed || officialLogo,
      name: asset.name || "", collection: asset.collection || "Marca",
      productId: asset.productId || "", figure: asset.figure || "", flavor: asset.flavor || "",
      shotType: asset.shotType || "", orientation: asset.orientation || "Vertical",
      animationKind: asset.animationKind || "Personaje", animationCanon: Boolean(asset.animationCanonical),
      containsPeople: Boolean(asset.containsPeople), rightsStatus: asset.rightsStatus || "Por verificar",
      rightsExpiresAt: asset.rightsExpiresAt || "", aiUseAllowed: Boolean(asset.aiUseAllowed),
      tags: (asset.tags || []).filter((tag) => !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(String(tag))).join(", "),
      notes: asset.notes || "",
      productionEnabled: Boolean(asset.productionProfile), ...productionProfile,
    });
  }

  async function saveAssetMetadata() {
    if (!detailAsset || !assetEditForm) return;
    try {
      if (!canWrite) throw new Error("Solo Administración o Marketing/CRM pueden corregir la Biblioteca.");
      if (assetEditForm.collection === "Animación" && !animationReady) throw new Error("Aplicá primero la migración 59 de Mundo animado.");
      if (assetEditForm.name.trim().length < 3) throw new Error("Escribí un nombre descriptivo de al menos 3 caracteres.");
      if (assetEditForm.collection === "Productos" && !assetEditForm.productId) throw new Error("Elegí el producto relacionado.");
      if (assetEditForm.collection === "Animación" && assetEditForm.figure.trim().length < 2) throw new Error("Escribí el nombre del personaje o elemento del mundo animado.");
      if (assetEditForm.collection === "Animación" && assetEditForm.animationCanon && !hasRole(user, "Administrador")) throw new Error("Solo Administración puede declarar una referencia canónica.");
      const userTags = assetEditForm.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag && !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(tag));
      const animationTags = assetEditForm.collection === "Animación"
        ? [`animacion:tipo:${assetEditForm.animationKind.toLocaleLowerCase("es")}`, ...(assetEditForm.animationCanon ? ["animacion:canon"] : [])]
        : [];
      const result = await actualizarMetadatosActivoMarca(detailAsset.id, {
        name: assetEditForm.name.trim(), collection: assetEditForm.collection,
        product_id: assetEditForm.collection === "Productos" ? assetEditForm.productId : null,
        figure: ["Productos","Animación"].includes(assetEditForm.collection) ? assetEditForm.figure.trim() : "",
        flavor: ["Productos","Animación"].includes(assetEditForm.collection) ? assetEditForm.flavor.trim() : "",
        shot_type: assetEditForm.shotType.trim(), orientation: assetEditForm.orientation,
        contains_people: assetEditForm.containsPeople, rights_status: assetEditForm.rightsStatus,
        rights_expires_at: assetEditForm.rightsExpiresAt || null, ai_use_allowed: assetEditForm.aiUseAllowed,
        tags: [...animationTags, ...userTags],
        notes: assetEditForm.notes.trim(),
      });
      if (assetEditForm.productionEnabled) {
        if (!productionAssetsReady) throw new Error("La información general se guardó, pero falta aplicar la migración 61 para la ficha de producción.");
        await clasificarActivoProduccion(detailAsset.id, productionProfilePayload(assetEditForm));
      }
      setAssetEditForm(null);
      toast("ok", result.semantic_locked
        ? "Información descriptiva corregida; la clasificación histórica permaneció protegida"
        : `Información corregida y guardada como versión ${result.version}`);
      await refrescar();
      await onIdentityChanged?.();
    } catch (error) { toast("error", error.message); }
  }

  function toggleStudioAsset(assetId) {
    setStudio((current) => ({
      ...current,
      productionPackId: "",
      assetIds: current.assetIds.some((id) => String(id) === String(assetId))
        ? current.assetIds.filter((id) => String(id) !== String(assetId))
        : [...current.assetIds, assetId],
    }));
  }

  async function prepareJob() {
    try {
      if (!ready) throw new Error("Aplicá primero la migración 20 de Biblioteca Creativa.");
      const freshDraft = buildCreativeStudioDraft(studio, db, hoyISO());
      if (!freshDraft.audit.passed) throw new Error(freshDraft.audit.errors[0]);
      const prompt = [freshDraft.prompt, studio.instructions.trim()].filter(Boolean).join(" Instrucciones adicionales: ");
      const payload = {
        creative_id: studio.creativeId || null, brief_id: studio.briefId || null,
        operation: freshDraft.operation, provider: studio.provider,
        input_asset_ids: freshDraft.assets.map((asset) => asset.id),
        target_channel: freshDraft.channel, target_format: freshDraft.format,
        prompt, negative_prompt: freshDraft.negativePrompt,
        output_spec: { ...freshDraft.spec, output_mode: "new_asset", preserve_originals: true },
      };
      if (studio.productionPackId) await crearTrabajoDesdePaqueteProduccion(Number(studio.productionPackId), payload);
      else await crearTrabajoCreativo(payload);
      setStudio((current) => ({ ...current, assetIds: [], instructions: "", productionPackId: "" }));
      toast("ok", ["Higgsfield", "Kling"].includes(studio.provider)
        ? `Trabajo ${studio.provider} preparado y auditado; revisá y autorizá su tope antes de enviarlo`
        : "Trabajo creativo preparado con originales y marca congelados");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  function openPackCreator() {
    setPackForm({ name: "", purpose: "", productId: "", figure: "", channel: "Instagram", targetFormat: "Reel 9:16", description: "", requiredRoles: ["Producto"], members: [] });
    setPackOpen(true);
  }

  function suggestedPackRole(asset) {
    const component = asset.productionProfile?.componentType;
    if (asset.mediaType === "Logo") return "Logo";
    return ({ Producto: "Producto", Empaque: "Empaque", Manos: "Mano", "Presentador UGC": "Presentador", Locación: "Locación", Movimiento: "Movimiento", Marca: "Identidad", Audio: "Audio", Personaje: "Continuidad" })[component] || "Continuidad";
  }

  function togglePackAsset(asset) {
    setPackForm((current) => {
      const selected = current.members.some((member) => String(member.assetId) === String(asset.id));
      return { ...current, members: selected
        ? current.members.filter((member) => String(member.assetId) !== String(asset.id))
        : [...current.members, { assetId: asset.id, role: suggestedPackRole(asset), required: true }],
      };
    });
  }

  function setPackMemberRole(assetId, role) {
    setPackForm((current) => ({ ...current, members: current.members.map((member) => String(member.assetId) === String(assetId) ? { ...member, role } : member) }));
  }

  function togglePackRequiredRole(role) {
    setPackForm((current) => ({ ...current, requiredRoles: current.requiredRoles.includes(role)
      ? current.requiredRoles.filter((item) => item !== role)
      : [...current.requiredRoles, role],
    }));
  }

  function applyProductionPack(packId) {
    const pack = approvedProductionPacks.find((item) => String(item.id) === String(packId));
    if (!pack) {
      setStudio((current) => ({ ...current, productionPackId: "" }));
      return;
    }
    setStudio((current) => ({
      ...current, productionPackId: String(pack.id),
      assetIds: [...new Set(pack.readiness.members.map((member) => member.assetId))],
      targetChannel: pack.channel || current.targetChannel,
      targetFormat: pack.targetFormat || current.targetFormat,
    }));
  }

  async function saveProductionPack() {
    try {
      if (!productionAssetsReady) throw new Error("Aplicá primero la migración 61 de Biblioteca de producción.");
      if (packForm.name.trim().length < 3 || packForm.purpose.trim().length < 8) throw new Error("Escribí un nombre y un propósito claro para el paquete.");
      if (!packForm.members.length) throw new Error("Elegí al menos una referencia aprobada.");
      if (!packForm.requiredRoles.length) throw new Error("Elegí al menos un rol obligatorio.");
      const result = await crearPaqueteProduccion({
        name: packForm.name.trim(), purpose: packForm.purpose.trim(), product_id: packForm.productId || null,
        figure: packForm.figure.trim(), channel: packForm.channel, target_format: packForm.targetFormat,
        description: packForm.description.trim(), requirements: { required_roles: packForm.requiredRoles },
        members: packForm.members.map((member, index) => ({ asset_id: member.assetId, role: member.role, sequence: index + 1, required: member.required, notes: "" })),
      });
      setPackOpen(false);
      toast(result.readiness?.ready ? "ok" : "alert", result.readiness?.ready
        ? "Paquete creado y listo para revisión humana"
        : `Paquete guardado como borrador: ${result.readiness?.reasons?.[0] || "faltan referencias"}`);
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function reviewProductionPack(pack, decision) {
    const note = window.prompt(decision === "Aprobar" ? "¿Qué identidad, producto, permisos y continuidad verificaste?" : "Nota para la revisión del paquete:", decision === "Aprobar" ? "Identidad, producto, derechos, QA y continuidad verificados." : "Listo para revisión de Administración.");
    if (note === null) return;
    try {
      await revisarPaqueteProduccion(pack.id, decision, note);
      toast("ok", decision === "Aprobar" ? "Paquete aprobado; ya puede usarse como referencia controlada para Higgsfield" : "Paquete enviado a revisión sin ejecutar motores ni consumir créditos");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function deleteAssetPermanently() {
    if (!deleteAsset) return;
    try {
      if (!deletePolicy.allowed) throw new Error(deletePolicy.reasons[0] || "Este archivo no puede eliminarse.");
      if (deletePolicy.mode === "official-logo") {
        if (!deleteAcknowledged || deleteConfirmationText.trim() !== deletePolicy.confirmationPhrase) {
          throw new Error("Completá las dos confirmaciones antes de eliminar el logo oficial.");
        }
        await eliminarLogoOficialMarca(deleteAsset.id, deletePolicy.confirmationPhrase);
        await onIdentityChanged?.();
        toast("ok", "Logo oficial eliminado. La identidad queda protegida y requiere cargar un reemplazo.");
      } else {
        await eliminarActivoMarca(deleteAsset.id);
        toast("ok", `“${deleteAsset.name}” fue eliminado de la Biblioteca y del almacenamiento`);
      }
      closeDeleteConfirmation();
      if (String(detailAssetId) === String(deleteAsset.id)) {
        setDetailAssetId(null);
        setAssetEditForm(null);
      }
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function authorizeJob() {
    try {
      const guard = creativeAuthorizationGuard(authorizationJob, { maxCostCop: authorizationCap }, db, hoyISO());
      if (!guard.allowed) throw new Error(guard.reasons[0]);
      await autorizarTrabajoCreativo(authorizationJob.id, guard.maxCostCop);
      setAuthorizationJob(null);
      toast("ok", "Trabajo autorizado con tope protegido; queda listo para el conector del motor");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function resolveHumanApproval(approval, decision) {
    if (!isAdmin || approval.status !== "Pendiente") return;
    const action = decision === "Aprobar" ? "aprobar" : "rechazar";
    const note = window.prompt(`Nota humana para ${action} el preflight #${approval.id}`, decision === "Aprobar"
      ? "Modelo, referencias, cámara y costo verificados."
      : "Indicá qué debe corregirse antes de volver a solicitar aprobación.");
    if (note == null) return;
    if (note.trim().length < 3) { toast("alert", "La decisión necesita una nota de al menos 3 caracteres"); return; }
    if (decision === "Aprobar" && !window.confirm(`Aprobar este preflight autorizará el trabajo #${approval.jobId} con un tope de ${fmt(Number(approval.contract?.max_cost_cop || 0))}. ¿Continuar?`)) return;
    try {
      await resolverAprobacionHumanaMcp(approval.id, decision, note.trim(), approval.contractFingerprint);
      toast("ok", decision === "Aprobar"
        ? "Preflight aprobado por una persona; el trabajo quedó autorizado con el contrato exacto"
        : "Preflight rechazado sin consumir créditos");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function cancelJob(job) {
    const reason = window.prompt(`Motivo para cancelar el trabajo #${job.id}`, "");
    if (!reason) return;
    try {
      await cancelarTrabajoCreativo(job.id, reason);
      toast("ok", "Trabajo creativo cancelado sin borrar su trazabilidad");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function retryJob(job) {
    try {
      await reintentarTrabajoCreativo(job.id);
      toast("ok", "Trabajo devuelto a revisión antes de autorizar un nuevo intento");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  function openOutputReview(job) {
    setReviewJob(job);
    setReviewDecision("Aprobada");
    setReviewFeedback("");
  }

  async function saveOutputReview() {
    try {
      if (!reviewReady) throw new Error("Aplicá primero la migración 26 de Revisión Creativa.");
      if (!reviewJob?.outputAsset) throw new Error("La salida no tiene un archivo verificable.");
      if (["Cambios solicitados", "Descartada"].includes(reviewDecision) && reviewFeedback.trim().length < 5) {
        throw new Error("Explicá qué debe cambiar o por qué se descarta.");
      }
      await revisarSalidaCreativa(reviewJob.id, reviewDecision, reviewFeedback.trim());
      setReviewJob(null);
      setReviewFeedback("");
      toast("ok", reviewDecision === "Aprobada"
        ? "Archivo aprobado para uso humano; todavía no está publicado"
        : reviewDecision === "Descartada"
          ? "Salida descartada y archivada con trazabilidad"
          : "Cambios registrados; el archivo original permanece protegido");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function createCorrectedVersion(job) {
    try {
      if (!iterationReady) throw new Error("Aplicá primero la migración 27 de Versiones Creativas.");
      const result = await crearRevisionSalidaCreativa(job.id);
      toast("ok", `Versión ${result.revision_number} preparada; requiere un nuevo tope antes de generar`);
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function saveIntegrationReference() {
    try {
      if (!integrationCenter.ready) throw new Error("Aplicá primero la migración 23 de Integraciones de Agencia.");
      await guardarReferenciaIntegracionAgencia({
        provider: integrationEdit.provider, environment: integrationEdit.environment,
        account_label: integrationEdit.accountLabel, external_account_id: integrationEdit.externalAccountId,
      });
      setIntegrationEdit(null);
      toast("ok", "Referencia guardada. El secreto sigue protegido en el servidor.");
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  async function pauseIntegration(integration) {
    const reason = window.prompt(`¿Por qué vas a pausar ${integration.provider}? Los trabajos quedarán en espera.`, "Mantenimiento controlado");
    if (!reason) return;
    try {
      await pausarIntegracionAgencia(integration.provider, reason);
      toast("ok", `${integration.provider} quedó pausado sin perder su trazabilidad`);
      await refrescar();
    } catch (error) { toast("error", error.message); }
  }

  const mediaIcon = { Foto: "📷", Video: "🎬", Audio: "🎧", Logo: "✶", "Diseño": "🎨" };
  const summaryCards = libraryCollection === "Marca" ? [
    ["Archivos de marca", library.summary.brandAssets, "Separados de producto"],
    ["Logo principal", library.summary.primaryLogos, "En la Biblioteca"],
    ["Referencias", library.summary.brandReferences, "Estilo, empaque y cultura"],
    ["Listos para IA", library.active.filter((asset) => asset.collection === "Marca" && asset.readiness.ready && !asset.duplicate).length, "Derechos vigentes"],
  ] : libraryCollection === "Animación" ? [
    ["Archivos del mundo", library.summary.animationAssets, "Sin mezclar con producto"],
    ["Personajes", library.summary.animationCharacters, "Con identidad propia"],
    ["Canónicos", library.summary.animationCanonical, "Continuidad oficial"],
    ["Listos para IA", library.active.filter((asset) => asset.collection === "Animación" && asset.readiness.ready && !asset.duplicate).length, "Derechos vigentes"],
  ] : [
    ["Archivos de producto", library.summary.productAssets, "Fotos y videos"],
    ["Productos cubiertos", library.summary.productsCovered, "Con toma real"],
    ["Listos para IA", library.active.filter((asset) => asset.collection === "Productos" && asset.readiness.ready && !asset.duplicate).length, "Derechos vigentes"],
    ["Por revisar", library.active.filter((asset) => asset.collection === "Productos" && !asset.readiness.ready).length, "Permiso o datos"],
  ];

  return (
    <div className="mt-7 mb-6 rounded-[28px] overflow-hidden border shadow-sm" style={{ borderColor: "#D9C2AE", background: "linear-gradient(145deg,#FFF,#FFF9F2)" }}>
      <div className="px-4 sm:px-5 py-4 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3" style={{ borderColor: T.border, background: "linear-gradient(135deg,#FFF3EA,#F9E7DE)" }}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shadow-sm" style={{ background: T.surface, color: T.coral }}>✦</div>
          <div><div className="text-[9px] font-extrabold tracking-[.18em] uppercase" style={{ color: T.coral }}>MOMOS BRAND INTELLIGENCE</div><div className="display text-xl font-semibold">Biblioteca + Estudio Creativo</div><div className="text-xs" style={{ color: T.choco2 }}>Originales, producción e integraciones externas bajo una sola trazabilidad.</div></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["Biblioteca", "Activos de producción", "Estudio", "Producción", "Integraciones"].map((item) => <button key={item} type="button" onClick={() => setSection(item)} className="rounded-full border px-3 py-2 text-[11px] font-extrabold" style={{ borderColor: section === item ? T.coral : T.border, background: section === item ? T.coral : "#fff", color: section === item ? "#fff" : T.choco }}>{item}</button>)}
          <Btn small disabled={!ready || !canWrite || (libraryCollection === "Animación" && !animationReady)} onClick={() => openAssetUpload(libraryCollection)}>＋ Subir archivo</Btn>
        </div>
      </div>

      {!ready && <div className="m-4 rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ Vista protegida preparada. Aplicá <code>biblioteca-creativa-v1.sql</code> para habilitar archivos privados, derechos y trabajos trazables.</div>}

      {section === "Biblioteca" ? <div className="p-4 sm:p-5">
        <div className="grid md:grid-cols-3 gap-3 mb-4" role="tablist" aria-label="Colecciones de la Biblioteca MOMOS">
          {[{ id: "Marca", icon: "✦", title: "Identidad y marca", description: "Logo, estilo, empaque, equipo y cultura.", count: library.summary.brandAssets }, { id: "Productos", icon: "🍰", title: "Productos", description: "Tomas por producto, figura, sabor y plano.", count: library.summary.productAssets }, { id: "Animación", icon: "🎞️", title: "Mundo animado", description: "Personajes, escenarios, objetos y continuidad.", count: library.summary.animationAssets }].map((item) => { const active = libraryCollection === item.id; return <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => { setLibraryCollection(item.id); setQuery(""); setMediaFilter(""); }} className="rounded-2xl border p-4 text-left flex items-start gap-3 shadow-sm" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface }}><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: active ? T.coralSoft : T.vainilla }}>{item.icon}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-extrabold text-sm">{item.title}</span><span className="display text-xl font-semibold" style={{ color: active ? T.coral : T.choco }}>{item.count}</span></span><span className="block text-[10px] mt-1" style={{ color: T.choco2 }}>{item.description}</span></span></button>; })}
        </div>
        {libraryCollection === "Marca" && <div className="rounded-2xl border p-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: "#E7C078", background: "#FFF9EC" }}><div><div className="font-extrabold text-sm">Identidad visual de MOMOS</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>El logo principal se declara aquí. Las demás fotos sirven como referencias de estilo y no se mezclan con los productos.</div></div><div className="flex flex-wrap gap-2 shrink-0"><Btn small onClick={() => openAssetUpload("Marca", "Logo principal")}>Subir logo principal</Btn><Btn small kind="ghost" onClick={() => openAssetUpload("Marca", "Referencia visual")}>Agregar fotos de marca</Btn></div></div>}
        {libraryCollection === "Animación" && <div className="rounded-2xl border p-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: animationReady ? "#C8B3D9" : "#E7C078", background: animationReady ? "#F9F3FC" : "#FFF9EC" }}><div><div className="font-extrabold text-sm">Biblia visual del mundo MOMOS</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>{animationReady ? "Guardá diseños base, expresiones, poses, turnarounds, escenarios y objetos. Las referencias canónicas sostienen la continuidad de cortos y series." : "La colección está preparada. Aplicá la migración 59 para habilitar personajes, canon y continuidad protegida."}</div></div><div className="flex flex-wrap gap-2 shrink-0"><Btn small disabled={!animationReady} onClick={() => openAssetUpload("Animación", "Diseño base", "Personaje")}>Agregar personaje</Btn><Btn small disabled={!animationReady} kind="ghost" onClick={() => openAssetUpload("Animación", "Escenario maestro", "Escenario")}>Agregar escenario u objeto</Btn></div></div>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          {summaryCards.map(([label, value, sub]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{sub}</div></div>)}
        </div>
        <div className="flex flex-col md:flex-row gap-2 mb-4">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={libraryCollection === "Marca" ? "Buscar logo, ambiente, empaque, equipo o referencia…" : libraryCollection === "Animación" ? "Buscar personaje, variante, expresión, escenario u objeto…" : "Buscar producto, sabor, figura, toma o etiqueta…"} aria-label={`Buscar archivos de ${libraryCollection.toLowerCase()}`} />
          <select className={`${inputCls} md:max-w-[190px]`} style={inputStyle} value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value)} aria-label="Filtrar tipo de activo"><option value="">Todos los formatos</option>{BRAND_MEDIA_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
          <label className="shrink-0 rounded-xl border px-3 py-2.5 text-xs font-bold flex items-center gap-2" style={{ borderColor: T.border, background: "#fff" }}><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Ver archivados</label>
        </div>
        {visibleAssets.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleAssets.map((asset) => {
            const blocked = !asset.readiness.ready || asset.duplicate;
            const problem = asset.duplicate ? "Archivo duplicado" : asset.readiness.reasons[0];
            const deletion = brandAssetDeletionPolicy(asset, db, { isAdmin, officialLogoDeletionReady });
            const officialLogo = isOfficialBrandLogo(asset);
            return <article key={asset.id} className="rounded-3xl overflow-hidden border shadow-sm" style={{ borderColor: blocked ? "#E6B7AE" : T.border, background: "#fff" }}>
              <button type="button" onClick={() => openAssetDetail(asset)} className="relative w-full h-40 grid place-items-center overflow-hidden group border-0 p-0" style={{ background: "linear-gradient(135deg,#F9ECDD,#F3D7DC)" }} aria-label={`Ver ${asset.name} completo`}>
                <LazyBrandMediaPreview asset={asset} mediaIcon={mediaIcon} />
                <span className="absolute right-3 bottom-3 rounded-full px-2.5 py-1 text-[9px] font-extrabold opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity" style={{ background: "rgba(255,255,255,.92)", color: T.choco }}>⛶ Ver completo</span>
              </button>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{asset.collection} · {asset.mediaType} · {asset.source}</div><div className="font-extrabold leading-tight">{asset.name}</div></div><Badge label={asset.status} /></div>
                <div className="text-xs mt-2" style={{ color: T.choco2 }}>{asset.collection === "Marca" ? asset.roleLabel : asset.collection === "Animación" ? [asset.animationKind, asset.figure, asset.flavor, asset.roleLabel].filter(Boolean).join(" · ") : [asset.productName, asset.figure, asset.flavor, asset.roleLabel].filter(Boolean).join(" · ")}</div>
                <div className="flex flex-wrap gap-1.5 mt-3"><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: blocked ? "#F6D4CD" : "#DDEBD9", color: blocked ? "#A03B2A" : "#315B35" }}>{blocked ? `⚠ ${problem}` : "✓ Listo para IA"}</span><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{asset.rightsStatus}</span>{asset.animationCanonical && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#E9DDF2", color: "#65437D" }}>★ Canónico</span>}{asset.containsPeople && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.rosa }}>Con personas</span>}</div>
                <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderColor: T.border }}>
                  <button type="button" onClick={() => openAssetDetail(asset)} className="border-0 bg-transparent p-0 text-[10px] font-extrabold underline" style={{ color: T.coral }}>Ver detalle</button>
                  {canWrite && <>
                  {asset.status === "Activo" && !officialLogo && <button type="button" onClick={() => archiveAsset(asset)} className="border-0 bg-transparent p-0 text-[10px] font-bold underline" style={{ color: T.choco2 }}>Archivar</button>}
                  {deletion.allowed ? <button type="button" onClick={() => openDeleteConfirmation(asset)} className="border-0 bg-transparent p-0 text-[10px] font-extrabold underline" style={{ color: "#A03B2A" }}>{officialLogo ? "Eliminar logo" : "Eliminar definitivamente"}</button>
                    : <span className="text-[9px] font-bold" style={{ color: T.choco2 }} title={deletion.reasons.join(" ")}>🔒 {deletion.reasons[0] || "En uso · solo se puede archivar"}</span>}
                  </>}
                </div>
              </div>
            </article>;
          })}
        </div> : <Empty icon={libraryCollection === "Animación" ? "🎞️" : "🖼️"} text={ready ? (libraryCollection === "Marca" ? "Todavía no hay archivos de identidad en esta vista. Subí el logo o agregá referencias visuales de MOMOS." : libraryCollection === "Animación" ? (animationReady ? "Todavía no hay personajes ni elementos del mundo animado. Empezá por el diseño base de Momo." : "Mundo animado se habilitará al aplicar la migración 59.") : "Todavía no hay fotos o videos de producto que coincidan con la búsqueda.") : "La biblioteca aparecerá aquí cuando se aplique la migración 20."} />}
        {libraryCollection === "Animación" && animationEntities.length > 0 && <div className="mt-5"><div className="text-[9px] uppercase tracking-[.14em] font-extrabold mb-2" style={{ color: T.coral }}>Personajes y elementos del mundo</div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{animationEntities.map((entity) => <button key={entity.name} type="button" onClick={() => setQuery(entity.name)} className="rounded-2xl border p-3 text-left" style={{ borderColor: T.border, background: T.soft }}><span className="flex items-center justify-between gap-2"><span className="font-extrabold text-sm">{entity.name}</span><span className="display text-xl font-semibold" style={{ color: T.coral }}>{entity.count}</span></span><span className="block text-[9px] mt-1" style={{ color: T.choco2 }}>{entity.kinds.join(" · ")} · {entity.roles.slice(0,3).join(" · ") || "Sin material clasificado"}</span>{entity.canonical > 0 && <span className="inline-block rounded-full px-2 py-1 text-[8px] font-extrabold mt-2" style={{ background: "#E9DDF2", color: "#65437D" }}>★ {entity.canonical} referencia(s) canónica(s)</span>}</button>)}</div></div>}
      </div> : section === "Activos de producción" ? <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
          <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Fuente de verdad para video</div><div className="display text-2xl font-semibold">Biblioteca de producción</div><div className="text-sm max-w-3xl" style={{ color: T.choco2 }}>Componentes reutilizables con vista, estado físico, interacción, consentimiento y QA. Un paquete aprobado puede alimentar Higgsfield sin volver a buscar referencias.</div></div>
          <div className="flex flex-wrap gap-2"><Btn small kind="soft" disabled={!productionAssetsReady || !canWrite} onClick={() => openAssetUpload("Productos")}>＋ Subir componente</Btn><Btn small disabled={!productionAssetsReady || !canWrite || productionLibrary.approved.length === 0} onClick={openPackCreator}>Armar paquete</Btn></div>
        </div>
        {!productionAssetsReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ Aplicá <code>biblioteca-produccion-v1.sql</code> después del paso 60. La Biblioteca actual permanece intacta hasta entonces.</div>}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-5">
          {[["Clasificados",productionLibrary.summary.profiled],["QA aprobado",productionLibrary.summary.approved],["Manos / UGC",productionLibrary.summary.humanComponents],["Locaciones",productionLibrary.summary.locations],["Ángulos",productionLibrary.summary.multiviewAngles],["Packs aprobados",productionLibrary.summary.approvedPacks]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div></div>)}
        </div>
        <div className="mb-5"><div className="flex items-end justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Cobertura reutilizable</div><div className="font-extrabold">Qué puede pedir hoy un guion</div></div><button type="button" className="border-0 bg-transparent text-[10px] font-extrabold underline" style={{ color: T.coral }} onClick={() => setProductionComponentFilter("")}>Ver todos</button></div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">{productionLibrary.componentCoverage.map((item) => <button type="button" key={item.componentType} onClick={() => setProductionComponentFilter(item.componentType)} className="rounded-2xl border p-3 text-left" style={{ borderColor: productionComponentFilter === item.componentType ? T.coral : item.ready ? "#B8D3B2" : T.border, background: item.ready ? "#F4FAF2" : "#FFF9F2" }}><span className="flex justify-between gap-2"><span className="text-xs font-extrabold">{item.componentType}</span><span className="display text-lg font-semibold" style={{ color: item.ready ? "#315B35" : T.coral }}>{item.approved}</span></span><span className="block text-[9px] mt-1" style={{ color: item.ready ? "#315B35" : T.choco2 }}>{item.ready ? `${item.count} clasificado(s)` : "Falta capturar y aprobar"}</span></button>)}</div>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)] gap-4">
          <div><div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Activos preparados</div><div className="display text-xl font-semibold">{productionComponentFilter || "Todos los componentes"}</div></div><span className="rounded-full px-3 py-1.5 text-[10px] font-extrabold" style={{ background: T.vainilla }}>{visibleProductionAssets.length}</span></div>
            {visibleProductionAssets.length ? <div className="grid sm:grid-cols-2 gap-3">{visibleProductionAssets.map((asset) => { const profile = asset.productionProfile; const state = asset.productionReadiness; return <article key={asset.id} className="rounded-3xl border overflow-hidden" style={{ borderColor: state.ready ? "#B8D3B2" : "#E6B7AE", background: "#fff" }}><button type="button" onClick={() => openAssetDetail(asset)} className="w-full h-36 border-0 p-0 overflow-hidden grid place-items-center" style={{ background: "linear-gradient(135deg,#F9ECDD,#F3D7DC)" }}><LazyBrandMediaPreview asset={asset} mediaIcon={mediaIcon} /></button><div className="p-3"><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{profile.componentType} · {profile.viewAngle}</div><div className="font-extrabold text-sm">{asset.name}</div></div><span className="rounded-full px-2 py-1 h-fit text-[8px] font-extrabold" style={{ background: state.ready ? "#DDEBD9" : "#F6D4CD", color: state.ready ? "#315B35" : "#A03B2A" }}>{state.ready ? "APROBADO" : profile.qaStatus.toUpperCase()}</span></div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{[profile.physicalState,profile.interactionType,profile.locationName].filter((value) => value && !["No aplica","Ninguna"].includes(value)).join(" · ") || "Sin interacción adicional"}</div>{state.warnings[0] && <div className="rounded-xl px-2 py-1.5 mt-2 text-[9px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {state.warnings[0]}</div>}<button type="button" onClick={() => openAssetDetail(asset)} className="border-0 bg-transparent p-0 mt-2 text-[10px] font-extrabold underline" style={{ color: T.coral }}>Ver y editar ficha</button></div></article>; })}</div> : <Empty icon="🎬" text={productionAssetsReady ? "No hay componentes con este filtro. Clasificá un original desde su ficha en Biblioteca o subí una referencia nueva." : "La sección quedará disponible al aplicar la migración 61."} />}
          </div>
          <div><div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Referencias selladas</div><div className="display text-xl font-semibold">Paquetes de producción</div></div></div>
            {productionLibrary.packs.length ? <div className="space-y-2">{productionLibrary.packs.map((pack) => <article key={pack.id} className="rounded-2xl border p-3" style={{ borderColor: pack.status === "Aprobado" ? "#B8D3B2" : T.border, background: pack.status === "Aprobado" ? "#F4FAF2" : "#fff" }}><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>V{pack.version} · {pack.channel} · {pack.targetFormat}</div><div className="font-extrabold text-sm">{pack.name}</div></div><Badge label={pack.status} /></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{pack.purpose}</div><div className="flex flex-wrap gap-1">{pack.readiness.members.map((member) => <span key={`${member.assetId}-${member.role}`} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: T.vainilla }}>{member.role}</span>)}</div>{!pack.readiness.ready && <div className="rounded-xl px-2 py-1.5 mt-2 text-[9px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{pack.readiness.reasons[0]}</div>}<div className="flex flex-wrap gap-2 mt-3">{pack.status === "Borrador" && <Btn small kind="ghost" disabled={!canWrite} onClick={() => reviewProductionPack(pack,"Enviar a revisión")}>Enviar a revisión</Btn>}{pack.status === "En revisión" && <Btn small confirmar disabled={!isAdmin || !pack.readiness.ready} onClick={() => reviewProductionPack(pack,"Aprobar")}>Aprobar paquete</Btn>}</div></article>)}</div> : <div className="rounded-2xl border p-4 text-xs" style={{ borderColor: T.border, color: T.choco2 }}>Todavía no hay paquetes. El primero puede reunir producto, bolsa, manos, presentador y locación para la prueba UGC “Dulce Antojo”.</div>}
          </div>
        </div>
      </div> : section === "Estudio" ? <div className="p-4 sm:p-5">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(310px,.75fr)] gap-4">
          <div>
            <div className="rounded-3xl border p-4 mb-4" style={{ borderColor: T.border, background: T.soft }}>
              <div className="text-[10px] uppercase tracking-[.14em] font-extrabold mb-3" style={{ color: T.coral }}>01 · Encargo creativo trazable</div>
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Creativo base"><select className={inputCls} style={inputStyle} value={studio.creativeId} onChange={(event) => setStudio({ ...studio, creativeId: event.target.value })}><option value="">Sin creativo</option>{(db.creatives || []).map((creative) => <option key={creative.id} value={creative.id}>{creative.titulo}</option>)}</select></Field><Field label="Brief aprobado o en curso"><select className={inputCls} style={inputStyle} value={studio.briefId} onChange={(event) => setStudio({ ...studio, briefId: event.target.value })}><option value="">Sin brief</option>{(db.agencyBriefs || []).map((brief) => <option key={brief.id} value={brief.id}>#{brief.id} · {brief.title}</option>)}</select></Field></div>
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Operación"><Select options={BRAND_STUDIO_OPERATIONS} value={studio.operation} onChange={(event) => setStudio({ ...studio, operation: event.target.value })} /></Field><Field label="Motor"><Select options={CREATIVE_PROVIDERS} value={studio.provider} onChange={(event) => setStudio({ ...studio, provider: event.target.value })} /></Field></div>
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Canal"><Select options={["Instagram","TikTok","Facebook","WhatsApp","Multicanal"]} value={studio.targetChannel} onChange={(event) => setStudio({ ...studio, targetChannel: event.target.value, productionPackId: "" })} /></Field><Field label="Formato"><Select options={BRAND_STUDIO_FORMATS} value={studio.targetFormat} onChange={(event) => setStudio({ ...studio, targetFormat: event.target.value, productionPackId: "" })} /></Field></div>
              <Field label="Instrucciones adicionales (opcional)"><textarea className={inputCls} style={inputStyle} rows="3" value={studio.instructions} onChange={(event) => setStudio({ ...studio, instructions: event.target.value })} placeholder="Ej. conservar el close-up real, agregar fondo de cocina cálido y cerrar con logo…" /></Field>
            </div>

            <div className="rounded-3xl border p-4" style={{ borderColor: T.border }}>
              <div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>02 · Fuentes reales</div><div className="display text-lg font-semibold">Elegí qué material puede usar</div></div><span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: T.vainilla }}>{studio.assetIds.length} elegido(s)</span></div>
              {approvedProductionPacks.length > 0 && <div className="rounded-2xl border p-3 mb-3" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><Field label="Paquete de producción aprobado"><select className={inputCls} style={inputStyle} value={studio.productionPackId} onChange={(event) => applyProductionPack(event.target.value)}><option value="">Selección manual de originales</option>{approvedProductionPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.name} · V{pack.version} · {pack.readiness.members.length} referencias</option>)}</select></Field><div className="text-[9px]" style={{ color: T.choco2 }}>{studio.productionPackId ? "MOMO OPS sellará la versión y huella del paquete dentro del trabajo. Cambiar un activo vuelve a selección manual." : "Elegir un paquete carga únicamente sus referencias aprobadas."}</div></div>}
              {library.readyForAi.length ? <div className="grid sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">{library.readyForAi.map((asset) => {
                const selected = studio.assetIds.some((id) => String(id) === String(asset.id));
                return <button key={asset.id} type="button" onClick={() => toggleStudioAsset(asset.id)} className="rounded-2xl border p-2.5 text-left flex gap-3" style={{ borderColor: selected ? T.coral : T.border, background: selected ? T.coralSoft : "#fff" }}>
                  <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 grid place-items-center" style={{ background: T.vainilla }}>{asset.url && ["Foto","Logo"].includes(asset.mediaType) ? <img src={asset.url} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">{mediaIcon[asset.mediaType] || "✦"}</span>}</div>
                  <span className="min-w-0"><span className="block text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{selected ? "✓ SELECCIONADO" : asset.mediaType}</span><span className="block text-xs font-extrabold truncate">{asset.name}</span><span className="block text-[10px] truncate" style={{ color: T.choco2 }}>{asset.productName || "Recurso de marca"} {asset.flavor ? `· ${asset.flavor}` : ""}</span></span>
                </button>;
              })}</div> : <div className="rounded-2xl px-4 py-5 text-sm text-center" style={{ background: T.vainilla, color: T.choco2 }}>Primero registrá originales con derechos vigentes y permiso para IA.</div>}
            </div>
          </div>

          <div>
            <div className="rounded-3xl p-4 sticky top-24" style={{ background: "linear-gradient(145deg,#4A3028,#7C493A)", color: "#fff" }}>
              <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-70">03 · Control antes de generar</div>
              <div className="display text-xl font-semibold mt-1">{studioDraft.title}</div>
              <div className="text-xs opacity-75 mt-1">{studioDraft.operation} · {studioDraft.format} · salida siempre nueva</div>
              <div className="grid grid-cols-2 gap-2 my-4"><div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,.1)" }}><div className="text-[8px] uppercase font-extrabold opacity-65">Fuentes</div><div className="display text-xl">{studioDraft.assets.length}</div></div><div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,.1)" }}><div className="text-[8px] uppercase font-extrabold opacity-65">Salida</div><div className="text-sm font-extrabold">{studioDraft.spec.width}×{studioDraft.spec.height}</div></div></div>
              {studioDraft.audit.errors.length > 0 && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>⛔ {studioDraft.audit.errors.join(" · ")}</div>}
              {studioDraft.audit.warnings.length > 0 && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {studioDraft.audit.warnings.join(" · ")}</div>}
              {studioDraft.audit.passed && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Derechos, producto real, marca y formato validados.</div>}
              <div className="rounded-2xl p-3 mb-3 text-[11px] leading-relaxed" style={{ background: "rgba(255,255,255,.1)" }}>{studioDraft.prompt}</div>
              {["Higgsfield", "Kling"].includes(studio.provider) && <div className="text-[10px] mb-3 opacity-80">{studio.provider} queda seleccionado como proveedor. Preparar conserva las fuentes y el brief; nada se envía hasta la autorización humana y la validación del conector privado.</div>}
              <BtnAsync onClick={prepareJob} disabled={!ready || !canWrite || !studioDraft.audit.passed} textoEnVuelo="Protegiendo trabajo…">Preparar trabajo creativo</BtnAsync>
            </div>
          </div>
        </div>

        {(db.creativeGenerationJobs || []).length > 0 && <div className="mt-5"><SectionTitle>Trabajos recientes del estudio</SectionTitle><div className="grid md:grid-cols-2 gap-2">{db.creativeGenerationJobs.slice(0, 6).map((job) => <div key={job.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: T.border, background: "#fff" }}><div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: T.vainilla }}>✶</div><div className="flex-1 min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>TRABAJO #{job.id} · {job.provider}</div><div className="text-sm font-extrabold truncate">{job.operation} · {job.targetFormat}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{job.inputAssetIds.length} fuente(s) · {job.createdAt}</div></div><Badge label={job.status} /></div>)}</div></div>}
      </div> : section === "Producción" ? <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
          <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Cola protegida del estudio</div><div className="display text-2xl font-semibold">De la idea al archivo revisable</div><div className="text-sm" style={{ color: T.choco2 }}>Cada trabajo conserva fuentes, marca, motor, tope de costo y aprobación humana. Autorizar no publica nada.</div></div>
          <Btn small kind="soft" onClick={() => setSection("Estudio")}>＋ Preparar trabajo</Btn>
        </div>
        {!productionReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ La cola ya está diseñada, pero falta aplicar la migración 22 de Producción Creativa para autorizar costos y conectar motores sin exponer secretos.</div>}
        {!reviewReady && productionQueue.summary.completed > 0 && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>✦ Hay salidas privadas esperando decisión. Aplicá <code>revision-creativa-v1.sql</code> para aprobar, pedir cambios o descartar sin publicar automáticamente.</div>}
        {!iterationReady && productionQueue.summary.changesRequested > 0 && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>↻ Hay correcciones esperando nueva versión. Aplicá <code>versiones-creativas-v1.sql</code> para conservar el original y preparar otro intento sin heredar gasto.</div>}
        <section className="rounded-3xl border p-4 mb-5" style={{ borderColor: humanApprovalReady ? "#C8B3D9" : T.border, background: humanApprovalReady ? "#FBF7FD" : T.soft }}>
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: "#76508C" }}>MCP · decisión humana</div><div className="display text-xl font-semibold">Preflights exactos antes de gastar créditos</div><div className="text-xs max-w-3xl" style={{ color: T.choco2 }}>Codex puede solicitar y consultar. No puede aprobarse a sí mismo: solo Administración decide en MOMO OPS y cualquier cambio de prompt, referencias o trabajo invalida la solicitud.</div></div><span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: humanApprovals.some((item) => item.status === "Pendiente") ? "#FFF2D8" : "#DDEBD9", color: humanApprovals.some((item) => item.status === "Pendiente") ? "#7A5410" : "#315B35" }}>{humanApprovals.filter((item) => item.status === "Pendiente").length} pendiente(s)</span></div>
          {!humanApprovalReady && <div className="rounded-2xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>mcp-aprobacion-humana-v1.sql</code> después de la migración 61 para activar las tools y esta bandeja.</div>}
          {humanApprovalReady && !humanApprovals.length && <div className="rounded-2xl px-3 py-4 text-xs text-center" style={{ background: "#fff", color: T.choco2 }}>Todavía no hay solicitudes. La tool <code>momos_request_human_approval</code> creará aquí el primer preflight, sin consumir créditos.</div>}
          {humanApprovalReady && humanApprovals.length > 0 && <div className="grid xl:grid-cols-2 gap-3">{humanApprovals.map((approval) => {
            const contract = approval.contract || {};
            const referenceAssets = (contract.references || []).map((reference) => ({ ...reference, asset: library.assets.find((asset) => String(asset.id) === String(reference.asset_id)) }));
            const tone = approval.status === "Aprobada" ? { border: "#B8D3B2", bg: "#F4FAF2" } : approval.status === "Pendiente" ? { border: "#E1C37E", bg: "#FFFCF4" } : { border: "#E6B7AE", bg: "#FFF8F6" };
            return <article key={approval.id} className="rounded-3xl border p-4" style={{ borderColor: tone.border, background: tone.bg }}>
              <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#76508C" }}>APROBACIÓN #{approval.id} · TRABAJO #{approval.jobId}</div><div className="display text-lg font-semibold">{approval.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Solicitada {approval.requestedAt} · vence {approval.expiresAt}</div></div><Badge label={approval.status} /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3">
                {[["Modelo",contract.model || "—"],["Duración",`${contract.duration_seconds || 0} s`],["Formato",`${contract.target_format || "—"} · ${contract.aspect_ratio || "—"}`],["Costo",`${Number(contract.estimated_credits || 0)} créditos`]].map(([label,value]) => <div key={label} className="rounded-xl border px-2.5 py-2" style={{ borderColor: T.border, background: "rgba(255,255,255,.8)" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-[11px] font-extrabold break-words">{value}</div></div>)}
              </div>
              <div className="text-xs space-y-1.5"><div><b>Superficie / workflow:</b> {contract.surface || "—"}{contract.workflow ? ` · ${contract.workflow}` : ""}</div><div><b>Salida:</b> {contract.resolution || "—"} · {contract.outputs || 1} variante(s) · audio {contract.audio ? "sí" : "no"}</div><div><b>Lente:</b> {contract.lens || "—"}</div><div><b>Movimiento:</b> {contract.camera_movement || "—"}</div><div><b>Luz:</b> {contract.lighting || "—"}</div><div><b>Tope:</b> {fmt(Number(contract.max_cost_cop || 0))} · saldo declarado {Number(contract.balance_credits || 0)} créditos</div>{contract.production_pack_id && <div><b>Paquete:</b> #{contract.production_pack_id} · <code>{String(contract.production_pack_fingerprint || "").slice(0, 10)}…</code></div>}</div>
              <div className="mt-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Referencias aprobadas</div><div className="flex flex-wrap gap-1.5 mt-1">{referenceAssets.map((reference) => <span key={`${reference.asset_id}-${reference.role}`} className="rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{reference.role}: {reference.asset?.name || `Activo #${reference.asset_id}`} · {String(reference.asset_fingerprint || "").slice(0, 8)}</span>)}</div></div>
              <details className="mt-3 rounded-2xl border p-3" style={{ borderColor: T.border, background: "rgba(255,255,255,.8)" }}><summary className="text-xs font-extrabold">Ver prompt, riesgos y criterios</summary><div className="text-xs whitespace-pre-wrap mt-2">{contract.prompt}</div><div className="text-[9px] mt-2" style={{ color: T.choco2 }}>Versión {contract.prompt_version} · huella <code>{contract.prompt_fingerprint}</code></div>{(contract.risks || []).length > 0 && <div className="mt-2 text-[11px]"><b>Riesgos:</b> {(contract.risks || []).join(" · ")}</div>}<div className="mt-1 text-[11px]"><b>Aceptación:</b> {(contract.acceptance_criteria || []).join(" · ")}</div></details>
              {approval.decisionNote && <div className="rounded-2xl px-3 py-2 mt-3 text-xs" style={{ background: "#fff" }}><b>Decisión humana:</b> {approval.decisionNote}</div>}
              <div className="rounded-2xl px-3 py-2 mt-3 text-[10px] font-bold" style={{ background: "#E5EEF7", color: "#315A7D" }}>No se consumen créditos al solicitar o revisar. Aprobar autoriza el trabajo exacto; el MCP nunca recibe una tool para decidir.</div>
              {approval.status === "Pendiente" && <div className="flex flex-wrap gap-2 mt-3">{isAdmin ? <><BtnAsync small confirmar onClick={() => resolveHumanApproval(approval, "Aprobar")}>Aprobar preflight exacto</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveHumanApproval(approval, "Rechazar")}>Rechazar y corregir</BtnAsync></> : <span className="text-[10px] font-bold" style={{ color: "#7A5410" }}>Esperando a una persona con rol Administrador.</span>}</div>}
            </article>;
          })}</div>}
        </section>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-5">
          {[["Por autorizar",productionQueue.summary.prepared],["Autorizados",productionQueue.summary.authorized],["Generando",productionQueue.summary.running],["Con novedad",productionQueue.summary.failed],["Por revisar",productionQueue.summary.pendingReview],["Aprobados",productionQueue.summary.approved]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: label === "Aprobados" ? "#3F6B42" : T.coral }}>{value}</div></div>)}
        </div>
        {productionQueue.active.length ? <div className="grid lg:grid-cols-2 gap-3">{productionQueue.active.map((job) => {
          const creative = (db.creatives || []).find((item) => item.id === job.creativeId);
          const execution = agencyProviderExecutionGuard(job.provider, db, new Date());
          const jobApproval = (db.mcpHumanApprovals || []).find((item) => String(item.jobId) === String(job.id));
          return <article key={job.id} className="rounded-3xl border p-4" style={{ borderColor: job.status === "Fallido" ? "#E6B7AE" : T.border, background: "#fff" }}>
            <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>TRABAJO #{job.id} · {job.provider}{job.revisionNumber > 1 ? ` · V${job.revisionNumber}` : ""}</div><div className="display text-lg font-semibold">{creative?.titulo || job.operation}</div><div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{job.targetFormat} · {job.inputAssetIds.length} fuente(s){job.revisionOfJobId ? ` · corrige #${job.revisionOfJobId}` : ""}</div></div><Badge label={job.status} /></div>
            <div className="mt-3 pl-3 border-l-2 text-xs space-y-1" style={{ borderColor: T.rosa }}><div><b>Motor sugerido:</b> {job.recommendedProvider}</div><div><b>Tope protegido:</b> {job.maxCostCop ? fmt(job.maxCostCop) : "Sin autorizar"}</div>{job.outputSpec?.revision_feedback && <div><b>Cambio solicitado:</b> {job.outputSpec.revision_feedback}</div>}{job.errorMessage && <div style={{ color: "#A03B2A" }}><b>Novedad:</b> {job.errorMessage}</div>}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {job.status === "Preparado" && !jobApproval && <BtnAsync small disabled={!productionReady || !canWrite || job.provider === "Por conectar"} onClick={() => { setAuthorizationJob(job); setAuthorizationCap(String(job.maxCostCop || 30000)); }}>Autorizar con tope</BtnAsync>}
              {job.status === "Preparado" && jobApproval && <span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: jobApproval.status === "Pendiente" ? "#FFF2D8" : "#F6D4CD", color: jobApproval.status === "Pendiente" ? "#7A5410" : "#A03B2A" }}>MCP · {jobApproval.status === "Pendiente" ? "espera decisión humana" : `${jobApproval.status}; requiere preflight nuevo`}</span>}
              {job.status === "Fallido" && <BtnAsync small kind="soft" disabled={!productionReady || !canWrite} onClick={() => retryJob(job)}>Revisar y reintentar</BtnAsync>}
              {["Preparado","Autorizado","Fallido"].includes(job.status) && <BtnAsync small kind="ghost" disabled={!productionReady || !canWrite} onClick={() => cancelJob(job)}>Cancelar trabajo</BtnAsync>}
              {job.status === "Autorizado" && <span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: execution.allowed ? "#DDEBD9" : "#FFF2D8", color: execution.allowed ? "#315B35" : "#7A5410" }}>{execution.allowed ? "Conector activo · listo para ejecutar" : `En espera · ${execution.reasons[0] || "conector pendiente"}`}</span>}
              {job.status === "En generación" && <span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: T.vainilla, color: T.choco }}>Motor trabajando · intento {job.attemptCount || 1}</span>}
            </div>
          </article>;
        })}</div> : <Empty icon="✶" text="No hay trabajos creativos activos. Prepará uno desde Estudio con sus fuentes reales y formato." />}
        {productionQueue.history.length > 0 && <div className="mt-5">
          <div className="flex items-end justify-between gap-3 mb-3"><div><SectionTitle>Revisión e historial creativo</SectionTitle><div className="text-xs" style={{ color: T.choco2 }}>La aprobación habilita el uso del archivo, pero nunca lo publica ni autoriza reutilización con IA por sí sola.</div></div><span className="rounded-full px-3 py-1.5 text-[10px] font-extrabold" style={{ background: T.vainilla }}>{productionQueue.history.length} salida(s)</span></div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{productionQueue.history.slice(0, 12).map((job) => <article key={job.id} className="rounded-3xl border overflow-hidden shadow-sm" style={{ borderColor: job.reviewStatus === "Pendiente" ? "#E6B7AE" : T.border, background: "#fff" }}>
            {job.outputAsset?.url && <div className="h-44 overflow-hidden grid place-items-center" style={{ background: "linear-gradient(135deg,#F9ECDD,#F3D7DC)" }}>{job.outputAsset.mimeType?.startsWith("video/") ? <video src={job.outputAsset.url} controls muted preload="metadata" className="w-full h-full object-cover" /> : <img src={job.outputAsset.url} alt={job.outputAsset.name || `Salida ${job.id}`} className="w-full h-full object-cover" />}</div>}
            <div className="p-4"><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>TRABAJO #{job.id} · {job.provider}{job.revisionNumber > 1 ? ` · V${job.revisionNumber}` : ""}</div><div className="display text-lg font-semibold">{job.operation}</div>{job.revisionOfJobId && <div className="text-[10px]" style={{ color: T.choco2 }}>Corrección del trabajo #{job.revisionOfJobId}</div>}</div><Badge label={job.reviewStatus === "No aplica" ? job.status : job.reviewStatus} /></div>
              <div className="grid grid-cols-2 gap-2 my-3"><div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Costo real</div><div className="font-extrabold">{fmt(job.generationCost || 0)}</div></div><div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Formato</div><div className="font-extrabold text-xs">{job.targetFormat}</div></div></div>
              {job.outputReviewFeedback && <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ background: job.reviewStatus === "Aprobada" ? "#DDEBD9" : "#FFF2D8" }}><b>Decisión:</b> {job.outputReviewFeedback}</div>}
              <div className="flex flex-wrap gap-2">{job.outputAsset?.url && <a href={job.outputAsset.url} target="_blank" rel="noreferrer" className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: T.border, color: T.choco }}>Ver archivo</a>}{job.status === "Completado" && job.reviewStatus === "Pendiente" && <Btn small disabled={!reviewReady || !canWrite} onClick={() => openOutputReview(job)}>Revisar salida</Btn>}{job.reviewStatus === "Cambios solicitados" && !job.revisionJob && <BtnAsync small kind="soft" disabled={!iterationReady || !canWrite} onClick={() => createCorrectedVersion(job)}>Crear versión corregida</BtnAsync>}{job.revisionJob && <span className="rounded-xl px-3 py-2 text-[10px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>Versión {job.revisionJob.revisionNumber} · {job.revisionJob.status}</span>}</div>
            </div>
          </article>)}</div>
        </div>}
      </div> : <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
          <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Centro de integraciones</div><div className="display text-2xl font-semibold">Qué puede ejecutar Agencia MOMOS ahora</div><div className="text-sm max-w-2xl" style={{ color: T.choco2 }}>MOMO OPS muestra la cuenta, salud y último contacto de cada motor. Los tokens nunca llegan a esta pantalla ni se guardan en tablas públicas.</div></div>
          <span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: integrationCenter.summary.needsAttention ? "#F6D4CD" : "#DDEBD9", color: integrationCenter.summary.needsAttention ? "#A03B2A" : "#315B35" }}>{integrationCenter.summary.operational} de {integrationCenter.summary.total} operativas</span>
        </div>
        {!integrationCenter.ready && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ Aplicá <code>integraciones-agencia-v1.sql</code> después de la migración 22. Hasta entonces ningún proveedor externo se considera conectado.</div>}
        {integrationCenter.ready && !db.higgsfieldConnectorReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>✦ Higgsfield sigue en modo protegido. Aplicá <code>higgsfield-conector-v1.sql</code> para instalar el worker privado, el costo máximo y la conciliación de resultados.</div>}
        {integrationCenter.ready && !db.klingConnectorReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>◆ Kling está preparado pero cerrado. Aplicá <code>kling-conector-v1.sql</code> para habilitar API Key privada, costo protegido, idempotencia y conciliación.</div>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
          {[["Operativas",integrationCenter.summary.operational,"Heartbeat ≤ 30 min"],["Requieren atención",integrationCenter.summary.needsAttention,"Error o trabajo detenido"],["Trabajo esperando",integrationCenter.summary.waiting,"Autorizado, no ejecutado"],["Piezas generadas",integrationCenter.summary.completed,`${integrationCenter.summary.failed} intentos fallidos`]].map(([label,value,sub]) => <div key={label} className="momo-metric-card rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft, "--metric-tone": label === "Requieren atención" ? "#C4808E" : T.coral }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: label === "Piezas generadas" ? "#3F6B42" : T.coral }}>{value}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{sub}</div></div>)}
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          {integrationCenter.integrations.map((integration) => {
            const tone = integration.operational ? { border: "#B8D3B2", bg: "#F4FAF2", fg: "#315B35" }
              : integration.status === "Con error" || integration.needsAttention ? { border: "#E6B7AE", bg: "#FFF7F4", fg: "#A03B2A" }
                : { border: T.border, bg: "#fff", fg: "#7A5410" };
            return <article key={integration.provider} className="rounded-3xl border p-4 shadow-sm" style={{ borderColor: tone.border, background: tone.bg }}>
              <div className="flex items-start gap-3"><div className="w-11 h-11 shrink-0 rounded-2xl grid place-items-center text-xl" style={{ background: integration.operational ? "#DDEBD9" : T.vainilla, color: tone.fg }}>{integration.icon}</div><div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{integration.kind}</div><div className="display text-lg font-semibold">{integration.provider}</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: integration.operational ? "#DDEBD9" : integration.status === "Con error" ? "#F6D4CD" : "#FFF2D8", color: tone.fg }}>{integration.operational ? "● OPERATIVA" : integration.status.toUpperCase()}</span></div><p className="text-xs mt-1 mb-0" style={{ color: T.choco2 }}>{integration.purpose}</p></div></div>
              <div className="grid grid-cols-2 gap-2 my-3"><div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,.7)" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Cuenta</div><div className="text-xs font-extrabold truncate">{integration.accountLabel || "Sin referencia"}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{integration.environment}</div></div><div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,.7)" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Salud privada</div><div className="text-xs font-extrabold">{integration.heartbeatMinutes == null ? "Sin heartbeat" : `Hace ${integration.heartbeatMinutes} min`}</div><div className="text-[9px]" style={{ color: integration.secretConfigured ? "#315B35" : "#A03B2A" }}>{integration.secretConfigured ? (integration.provider === "Kling" ? "API Key confirmada" : "Autenticación confirmada") : "Autenticación pendiente"}</div></div></div>
              <div className="flex flex-wrap gap-1.5">{integration.capabilities.map((capability) => <span key={capability} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{capability}</span>)}{integration.waiting > 0 && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>{integration.waiting} esperando</span>}</div>
              {["Higgsfield", "Kling"].includes(integration.provider) && integration.bridgeInstalled && <div className="rounded-2xl px-3 py-2 mt-3 grid grid-cols-3 gap-2" style={{ background: "rgba(255,255,255,.72)" }}><div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Worker</div><div className="text-[10px] font-bold truncate">{integration.workerVersion || "Sin versión"}</div></div><div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Último intento</div><div className="text-[10px] font-bold">{integration.lastRun?.state || "Sin trabajos"}</div></div><div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Costo</div><div className="text-[10px] font-bold">{integration.lastRun ? fmt(integration.lastRun.actualCostCop || integration.lastRun.estimatedCostCop || 0) : "—"}</div></div></div>}
              {!integration.operational && <div className="rounded-2xl px-3 py-2 mt-3 text-[11px] font-bold" style={{ background: integration.needsAttention ? "#F6D4CD" : "#FFF2D8", color: tone.fg }}>Siguiente paso: {integration.reasons[0]}</div>}
              <div className="flex flex-wrap gap-2 mt-3"><Btn small kind="soft" disabled={!integrationCenter.ready || !canConfigureIntegrations} onClick={() => setIntegrationEdit({ provider: integration.provider, environment: integration.environment, accountLabel: integration.accountLabel, externalAccountId: integration.externalAccountId })}>{integration.accountLabel ? "Editar referencia" : "Configurar cuenta"}</Btn>{integration.status === "Activa" && <Btn small kind="ghost" disabled={!canConfigureIntegrations} onClick={() => pauseIntegration(integration)}>Pausar</Btn>}</div>
            </article>;
          })}
        </div>
        <div className="rounded-2xl px-4 py-3 mt-4 text-xs" style={{ background: "#E5EEF7", color: "#315A7D" }}><b>Activación segura:</b> Administración solo identifica aquí la cuenta. Kling usa una API Key y los demás proveedores su autenticación correspondiente, siempre en el runtime privado. MOMO OPS exige heartbeat reciente, tope de costo y revisión humana antes de publicar.</div>
      </div>}

      {packOpen && <Modal title="Nuevo paquete de producción" onClose={() => setPackOpen(false)} extraWide topLayer>
        <div className="rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{ background: "#E5EEF7", color: "#315A7D" }}><b>Un paquete no genera ni consume créditos.</b> Solo congela las referencias que después podrá recibir Higgsfield, junto con sus permisos y QA.</div>
        <div className="grid lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-4"><div><Field label="Nombre"><Input value={packForm.name} onChange={(event) => setPackForm({ ...packForm, name: event.target.value })} placeholder="Dulce Antojo · UGC bolsa y cucharada" /></Field><Field label="Propósito"><textarea className={inputCls} style={inputStyle} rows="3" value={packForm.purpose} onChange={(event) => setPackForm({ ...packForm, purpose: event.target.value })} placeholder="Mostrar la bolsa, sacar a Max, presentarlo a cámara y probarlo con cuchara." /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Producto"><select className={inputCls} style={inputStyle} value={packForm.productId} onChange={(event) => setPackForm({ ...packForm, productId: event.target.value })}><option value="">Sin producto único</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{product.nombre}</option>)}</select></Field><Field label="Figura / personaje"><Input value={packForm.figure} onChange={(event) => setPackForm({ ...packForm, figure: event.target.value })} placeholder="Max" /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="Canal"><Select options={["Instagram","TikTok","Facebook","WhatsApp","Multicanal"]} value={packForm.channel} onChange={(event) => setPackForm({ ...packForm, channel: event.target.value })} /></Field><Field label="Formato"><Select options={BRAND_STUDIO_FORMATS} value={packForm.targetFormat} onChange={(event) => setPackForm({ ...packForm, targetFormat: event.target.value })} /></Field></div><Field label="Notas de continuidad"><textarea className={inputCls} style={inputStyle} rows="2" value={packForm.description} onChange={(event) => setPackForm({ ...packForm, description: event.target.value })} placeholder="Bolsa idéntica, cuchara visible, luz de ventana izquierda…" /></Field><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Roles obligatorios</div><div className="flex flex-wrap gap-1.5 mb-4">{PRODUCTION_PACK_ROLES.map((role) => <label key={role} className="rounded-full border px-2 py-1 text-[9px] font-bold flex items-center gap-1" style={{ borderColor: packForm.requiredRoles.includes(role) ? T.coral : T.border, background: packForm.requiredRoles.includes(role) ? T.coralSoft : "#fff" }}><input type="checkbox" checked={packForm.requiredRoles.includes(role)} onChange={() => togglePackRequiredRole(role)} />{role}</label>)}</div></div>
          <div><div className="flex items-end justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Solo QA aprobado</div><div className="font-extrabold">Elegí las referencias</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{packForm.members.length} elegidas</span></div><div className="grid sm:grid-cols-2 gap-2 max-h-[520px] overflow-y-auto pr-1">{productionLibrary.approved.map((asset) => { const member = packForm.members.find((item) => String(item.assetId) === String(asset.id)); return <article key={asset.id} className="rounded-2xl border p-2.5" style={{ borderColor: member ? T.coral : T.border, background: member ? T.coralSoft : "#fff" }}><label className="flex gap-2 items-start cursor-pointer"><input type="checkbox" className="mt-1" checked={Boolean(member)} onChange={() => togglePackAsset(asset)} /><span className="min-w-0"><span className="block text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{asset.productionProfile.componentType} · {asset.productionProfile.viewAngle}</span><span className="block text-xs font-extrabold truncate">{asset.name}</span><span className="block text-[9px]" style={{ color: T.choco2 }}>{asset.productionProfile.physicalState} · {asset.productionProfile.sourceQuality}</span></span></label>{member && <select className={`${inputCls} mt-2`} style={inputStyle} value={member.role} onChange={(event) => setPackMemberRole(asset.id,event.target.value)}>{PRODUCTION_PACK_ROLES.map((role) => <option key={role}>{role}</option>)}</select>}</article>; })}</div>{!productionLibrary.approved.length && <div className="rounded-2xl px-3 py-4 text-xs" style={{ background: "#FFF2D8", color: "#7A5410" }}>Primero aprobá el QA de al menos un componente en su ficha.</div>}</div></div>
        <div className="flex flex-wrap gap-2 mt-4"><BtnAsync confirmar onClick={saveProductionPack} disabled={packForm.name.trim().length < 3 || packForm.purpose.trim().length < 8 || !packForm.members.length || !packForm.requiredRoles.length}>Guardar paquete borrador</BtnAsync><Btn kind="ghost" onClick={() => setPackOpen(false)}>Cancelar</Btn></div>
      </Modal>}

      {integrationEdit && <Modal title={`Configurar ${integrationEdit.provider}`} onClose={() => setIntegrationEdit(null)} topLayer>
        <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: "#E5EEF7", color: "#315A7D" }}><b>Acá no se pegan tokens, API Keys ni contraseñas.</b> Solo identificamos la cuenta que MOMO OPS debe usar. La credencial se configura después en el runtime privado del worker.</div>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Proveedor"><Input value={integrationEdit.provider} disabled /></Field><Field label="Entorno"><Select options={AGENCY_INTEGRATION_ENVIRONMENTS} value={integrationEdit.environment} onChange={(event) => setIntegrationEdit({ ...integrationEdit, environment: event.target.value })} /></Field></div>
        <Field label="Nombre visible de la cuenta"><Input value={integrationEdit.accountLabel} onChange={(event) => setIntegrationEdit({ ...integrationEdit, accountLabel: event.target.value })} placeholder="Ej. Instagram D'Momos Sweet Love" /></Field>
        <Field label="ID externo de cuenta (opcional)"><Input value={integrationEdit.externalAccountId} onChange={(event) => setIntegrationEdit({ ...integrationEdit, externalAccountId: event.target.value })} placeholder="ID entregado por el proveedor" /></Field>
        <div className="rounded-2xl px-3 py-2 mb-4 text-xs" style={{ background: T.vainilla }}><b>Guardar no activa el conector.</b> El estado cambiará a Activa únicamente cuando el servidor compruebe la credencial y logre contactar al proveedor.</div>
        <div className="flex flex-wrap gap-2"><BtnAsync onClick={saveIntegrationReference} disabled={integrationEdit.accountLabel.trim().length < 2} textoEnVuelo="Protegiendo referencia…">Guardar referencia</BtnAsync><Btn kind="ghost" onClick={() => setIntegrationEdit(null)}>Cancelar</Btn></div>
      </Modal>}

      {reviewJob && <Modal title={`Revisar salida #${reviewJob.id}`} onClose={() => setReviewJob(null)} wide topLayer>
        <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-4">
          <div className="rounded-3xl overflow-hidden border min-h-[280px] grid place-items-center" style={{ borderColor: T.border, background: "linear-gradient(135deg,#F9ECDD,#F3D7DC)" }}>{reviewJob.outputAsset?.mimeType?.startsWith("video/") ? <video src={reviewJob.outputAsset.url} controls autoPlay muted className="w-full max-h-[520px] object-contain" /> : reviewJob.outputAsset?.url ? <img src={reviewJob.outputAsset.url} alt="Salida a revisar" className="w-full max-h-[520px] object-contain" /> : <span>Archivo no disponible</span>}</div>
          <div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Decisión humana obligatoria</div><div className="display text-2xl font-semibold mt-1">¿Esta pieza representa a MOMOS?</div><p className="text-sm mt-2" style={{ color: T.choco2 }}>Revisá producto, colores, toppings, empaque, continuidad y cualquier texto visible. Esta decisión queda sellada con usuario y fecha.</p>
            <div className="rounded-2xl p-3 my-3 text-xs" style={{ background: T.vainilla }}><b>{reviewJob.provider}</b> · {reviewJob.targetFormat}<br />Costo real {fmt(reviewJob.generationCost || 0)} · tope {fmt(reviewJob.maxCostCop || 0)}</div>
            <Field label="Decisión"><Select options={["Aprobada","Cambios solicitados","Descartada"]} value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)} /></Field>
            <Field label={reviewDecision === "Aprobada" ? "Observación de aprobación (opcional)" : "Explicación obligatoria"}><textarea className={inputCls} style={inputStyle} rows="4" value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} placeholder={reviewDecision === "Cambios solicitados" ? "Ej. conservar la forma del Momo y reducir el movimiento de cámara…" : reviewDecision === "Descartada" ? "Explicá por qué esta salida no debe usarse…" : "Ej. Producto y colores verificados…"} /></Field>
            <div className="rounded-2xl px-3 py-2 mb-4 text-[11px] font-bold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Aprobar permite usar el archivo en el siguiente paso comercial. No lo publica, no crea pauta y no concede reutilización automática con IA.</div>
            <div className="flex flex-wrap gap-2"><BtnAsync confirmar onClick={saveOutputReview} disabled={["Cambios solicitados","Descartada"].includes(reviewDecision) && reviewFeedback.trim().length < 5}>Guardar decisión protegida</BtnAsync><Btn kind="ghost" onClick={() => setReviewJob(null)}>Volver</Btn></div>
          </div>
        </div>
      </Modal>}

      {authorizationJob && <Modal title={`Autorizar trabajo #${authorizationJob.id}`} onClose={() => setAuthorizationJob(null)} topLayer>
        <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: T.vainilla }}><b>Confirmación humana obligatoria.</b> El motor no podrá superar este tope. La salida quedará En revisión y nunca se publicará sola.</div>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Motor"><Input value={authorizationJob.provider} disabled /></Field><Field label="Tope máximo (COP)"><Input type="number" min="0" step="1000" value={authorizationCap} onChange={(event) => setAuthorizationCap(event.target.value)} /></Field></div>
        {(() => { const guard = creativeAuthorizationGuard(authorizationJob, { maxCostCop: authorizationCap }, db, hoyISO()); return !guard.allowed && <div className="rounded-2xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>⛔ {guard.reasons.join(" ")}</div>; })()}
        <div className="flex gap-2"><BtnAsync onClick={authorizeJob} confirmar disabled={!creativeAuthorizationGuard(authorizationJob, { maxCostCop: authorizationCap }, db, hoyISO()).allowed} textoEnVuelo="Autorizando…">Autorizar gasto protegido</BtnAsync><Btn kind="ghost" onClick={() => setAuthorizationJob(null)}>Volver</Btn></div>
      </Modal>}

      {detailAsset && (() => {
        const dependency = brandAssetDeletionReadiness(detailAsset, db);
        const detailDeletion = brandAssetDeletionPolicy(detailAsset, db, { isAdmin, officialLogoDeletionReady });
        const semanticLocked = assetEditForm?.semanticLocked ?? (!dependency.allowed || (detailAsset.mediaType === "Logo" && /principal/i.test(detailAsset.roleLabel || "")));
        const dimensions = detailAsset.width && detailAsset.height ? `${detailAsset.width} × ${detailAsset.height} px` : "Sin dimensiones registradas";
        const hashLabel = detailAsset.contentHash ? `${detailAsset.contentHash.slice(0, 12)}…${detailAsset.contentHash.slice(-8)}` : "Sin huella";
        return <Modal title={assetEditForm ? `Editar · ${detailAsset.name}` : detailAsset.name} onClose={() => { setDetailAssetId(null); setAssetEditForm(null); }} extraWide topLayer>
          <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)] gap-5">
            <div className="lg:sticky lg:top-20 self-start">
              <div className="rounded-3xl overflow-hidden border h-[48vh] min-h-[320px] max-h-[680px] grid place-items-center" style={{ borderColor: T.border, background: "linear-gradient(135deg,#F4E9DE,#E9DED5)" }}>
                <LazyBrandMediaPreview asset={detailAsset} mediaIcon={mediaIcon} eager fit="contain" controls />
              </div>
              <div className="rounded-2xl px-3 py-2.5 mt-3 text-[11px] flex gap-2 items-start" style={{ background: "#E8F1E4", color: "#315B35" }}><span>🔒</span><span><b>Original protegido.</b> Ver o corregir su ficha nunca sobrescribe el archivo, la huella SHA‑256 ni su procedencia.</span></div>
            </div>

            {!assetEditForm ? <div>
              <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{detailAsset.collection} · {detailAsset.mediaType} · {detailAsset.source}</div><div className="display text-2xl font-semibold mt-1">{detailAsset.name}</div><div className="text-sm mt-1" style={{ color: T.choco2 }}>{detailAsset.collection === "Marca" ? detailAsset.roleLabel : detailAsset.collection === "Animación" ? [detailAsset.animationKind, detailAsset.figure, detailAsset.flavor, detailAsset.roleLabel].filter(Boolean).join(" · ") : [detailAsset.productName, detailAsset.figure, detailAsset.flavor, detailAsset.roleLabel].filter(Boolean).join(" · ")}</div></div><Badge label={detailAsset.status} /></div>
              <div className="flex flex-wrap gap-1.5 mt-3"><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: detailAsset.readiness.ready ? "#DDEBD9" : "#F6D4CD", color: detailAsset.readiness.ready ? "#315B35" : "#A03B2A" }}>{detailAsset.readiness.ready ? "✓ Listo para IA" : `⚠ ${detailAsset.readiness.reasons[0]}`}</span><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{detailAsset.rightsStatus}</span>{detailAsset.animationCanonical && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: "#E9DDF2", color: "#65437D" }}>★ Referencia canónica</span>}{detailAsset.containsPeople && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: T.rosa }}>Muestra personas</span>}</div>
              <div className="grid sm:grid-cols-2 gap-2 my-4">
                {[["Formato real",`${detailAsset.mimeType || detailAsset.mediaType} · ${formatAssetSize(detailAsset.sizeBytes)}`],["Resolución",dimensions],["Orientación",detailAsset.orientation || "Sin definir"],["Fecha de ingreso",detailAsset.createdAt || "Sin fecha"],["Uso con IA",detailAsset.aiUseAllowed ? "Permitido" : "No permitido"],["Huella del original",hashLabel]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2.5" style={{ borderColor: T.border, background: T.soft }}><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-[11px] font-extrabold mt-0.5 break-words">{value}</div></div>)}
              </div>
              {detailAsset.productionProfile ? <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#65437D" }}>Ficha de producción</div><div className="font-extrabold text-sm">{detailAsset.productionProfile.componentType} · {detailAsset.productionProfile.viewAngle}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: detailAsset.productionProfile.qaStatus === "Aprobado" ? "#DDEBD9" : "#FFF2D8", color: detailAsset.productionProfile.qaStatus === "Aprobado" ? "#315B35" : "#7A5410" }}>QA {detailAsset.productionProfile.qaStatus}</span></div><div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]" style={{ color: T.choco2 }}><div><b>Estado:</b> {detailAsset.productionProfile.physicalState}</div><div><b>Interacción:</b> {detailAsset.productionProfile.interactionType}</div><div><b>Calidad:</b> {detailAsset.productionProfile.sourceQuality}</div><div><b>Consentimiento:</b> {detailAsset.productionProfile.consentStatus}</div>{detailAsset.productionProfile.locationName && <div className="col-span-2"><b>Locación:</b> {detailAsset.productionProfile.locationName}</div>}</div>{detailAsset.productionProfile.continuityNotes && <div className="text-[10px] mt-2"><b>Continuidad:</b> {detailAsset.productionProfile.continuityNotes}</div>}</div> : productionAssetsReady && <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: "#FFF2D8", color: "#7A5410" }}><b>Sin ficha de producción.</b> Editá la información para clasificar vista, estado, interacción, locación y QA.</div>}
              {detailAsset.tags?.filter((tag) => !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(String(tag))).length > 0 && <div className="mb-4"><div className="text-[9px] uppercase font-extrabold mb-1.5" style={{ color: T.choco2 }}>Etiquetas</div><div className="flex flex-wrap gap-1.5">{detailAsset.tags.filter((tag) => !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(String(tag))).map((tag) => <span key={tag} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{tag}</span>)}</div></div>}
              <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: T.border, background: "#fff" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Notas y alcance del permiso</div><div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: detailAsset.notes ? T.choco : T.choco2 }}>{detailAsset.notes || "No se registraron notas adicionales."}</div>{detailAsset.rightsExpiresAt && <div className="text-[10px] mt-2 font-bold" style={{ color: T.coral }}>Permiso vigente hasta {detailAsset.rightsExpiresAt}</div>}</div>
              {semanticLocked && <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: "#FFF2D8", color: "#7A5410" }}><b>Clasificación protegida:</b> este original ya fue usado o pertenece a la identidad oficial. Se pueden corregir nombre, etiquetas y notas, pero no cambiar qué representa.</div>}
              <div className="flex flex-wrap gap-2">{canWrite && <Btn onClick={() => beginAssetMetadataEdit(detailAsset)}>Editar información</Btn>}{detailDeletion.allowed && <Btn kind="ghost" onClick={() => openDeleteConfirmation(detailAsset)}>{isOfficialBrandLogo(detailAsset) ? "Eliminar logo" : "Eliminar definitivamente"}</Btn>}<Btn kind="ghost" onClick={() => { setDetailAssetId(null); setAssetEditForm(null); }}>Cerrar</Btn></div>
            </div> : <div>
              <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: semanticLocked ? "#FFF2D8" : "#E5EEF7", color: semanticLocked ? "#7A5410" : "#315A7D" }}>{semanticLocked ? <><b>Este archivo ya tiene historia.</b> Solo nombre, etiquetas y notas están habilitados; la clasificación y los permisos permanecen sellados.</> : <><b>Corrección versionada.</b> MOMO OPS guardará la ficha anterior y registrará quién hizo este cambio.</>}</div>
              <Field label="Nombre descriptivo"><Input value={assetEditForm.name} onChange={(event) => setAssetEditForm({ ...assetEditForm, name: event.target.value })} /></Field>
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Colección"><Select disabled={semanticLocked} options={["Marca","Productos","Animación"]} value={assetEditForm.collection} onChange={(event) => { const collection = event.target.value; setAssetEditForm({ ...assetEditForm, collection, shotType: collection === "Marca" ? "Referencia visual" : collection === "Animación" ? "Diseño base" : "Producto" }); }} /></Field><Field label="Tipo de archivo"><Input value={`${detailAsset.mediaType} · ${detailAsset.source}`} disabled /></Field></div>
              {assetEditForm.collection === "Marca" ? <div className="grid sm:grid-cols-2 gap-3"><Field label="Uso dentro de la marca"><Select disabled={semanticLocked} options={BRAND_ASSET_ROLES} value={assetEditForm.shotType || "Referencia visual"} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div>
                : assetEditForm.collection === "Animación" ? <><div className="grid sm:grid-cols-2 gap-3"><Field label="Tipo de elemento"><Select disabled={semanticLocked} options={ANIMATION_ASSET_KINDS} value={assetEditForm.animationKind} onChange={(event) => setAssetEditForm({ ...assetEditForm, animationKind: event.target.value })} /></Field><Field label="Material de referencia"><Select disabled={semanticLocked} options={ANIMATION_ASSET_ROLES} value={assetEditForm.shotType || "Diseño base"} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Personaje o elemento"><Input disabled={semanticLocked} value={assetEditForm.figure} onChange={(event) => setAssetEditForm({ ...assetEditForm, figure: event.target.value })} placeholder="Momo, Toby, Cocina MOMOS…" /></Field><Field label="Variante o vestuario"><Input disabled={semanticLocked} value={assetEditForm.flavor} onChange={(event) => setAssetEditForm({ ...assetEditForm, flavor: event.target.value })} placeholder="Base, chef, invierno…" /></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div><label className="flex gap-2 items-start rounded-2xl border px-3 py-2.5 mb-3 text-sm font-bold" style={{ borderColor: T.border }}><input disabled={semanticLocked || !hasRole(user,"Administrador")} type="checkbox" className="mt-1" checked={assetEditForm.animationCanon} onChange={(event) => setAssetEditForm({ ...assetEditForm, animationCanon: event.target.checked })} /><span>Referencia canónica<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Define la apariencia oficial para sostener la continuidad. Solo Administración puede declararla.</span></span></label></>
                  : <><div className="grid sm:grid-cols-2 gap-3"><Field label="Producto relacionado"><select disabled={semanticLocked} className={inputCls} style={inputStyle} value={assetEditForm.productId} onChange={(event) => setAssetEditForm({ ...assetEditForm, productId: event.target.value })}><option value="">Elegir producto…</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{product.nombre}</option>)}</select></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Audio","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Figura"><Input disabled={semanticLocked} value={assetEditForm.figure} onChange={(event) => setAssetEditForm({ ...assetEditForm, figure: event.target.value })} /></Field><Field label="Sabor"><Input disabled={semanticLocked} value={assetEditForm.flavor} onChange={(event) => setAssetEditForm({ ...assetEditForm, flavor: event.target.value })} /></Field><Field label="Tipo de toma"><Input disabled={semanticLocked} value={assetEditForm.shotType} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field></div></>}
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Derechos"><Select disabled={semanticLocked} options={BRAND_MEDIA_RIGHTS} value={assetEditForm.rightsStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, rightsStatus: event.target.value })} /></Field><Field label="Vencimiento del permiso"><Input disabled={semanticLocked} type="date" value={assetEditForm.rightsExpiresAt} onChange={(event) => setAssetEditForm({ ...assetEditForm, rightsExpiresAt: event.target.value })} /></Field></div>
              <div className="rounded-2xl border px-3 py-2 mb-3" style={{ borderColor: T.border }}><label className="flex gap-2 items-start text-sm font-bold"><input disabled={semanticLocked} type="checkbox" className="mt-1" checked={assetEditForm.containsPeople} onChange={(event) => setAssetEditForm({ ...assetEditForm, containsPeople: event.target.checked })} /><span>El archivo muestra personas</span></label><label className="flex gap-2 items-start text-sm font-bold mt-2"><input disabled={semanticLocked} type="checkbox" className="mt-1" checked={assetEditForm.aiUseAllowed} onChange={(event) => setAssetEditForm({ ...assetEditForm, aiUseAllowed: event.target.checked })} /><span>Permitir edición o generación con IA</span></label></div>
              <div className="rounded-3xl border p-3 mb-3" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><label className="flex gap-2 items-start text-sm font-extrabold"><input type="checkbox" disabled={!productionAssetsReady} className="mt-1" checked={assetEditForm.productionEnabled} onChange={(event) => setAssetEditForm({ ...assetEditForm, productionEnabled: event.target.checked })} /><span>Ficha de producción<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Clasifica este original para UGC, manos, multivistas, locaciones y paquetes.</span></span></label>{assetEditForm.productionEnabled && <div className="mt-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Componente"><Select options={PRODUCTION_COMPONENT_TYPES} value={assetEditForm.componentType} onChange={(event) => { const componentType = event.target.value; setAssetEditForm({ ...assetEditForm, ...defaultProductionProfile(componentType), componentType, productionEnabled: true, containsPeople: ["Manos","Presentador UGC"].includes(componentType) ? true : assetEditForm.containsPeople }); }} /></Field><Field label="Vista"><Select options={PRODUCTION_VIEW_ANGLES} value={assetEditForm.viewAngle} onChange={(event) => setAssetEditForm({ ...assetEditForm, viewAngle: event.target.value })} /></Field><Field label="Estado físico"><Select options={PRODUCTION_PHYSICAL_STATES} value={assetEditForm.physicalState} onChange={(event) => setAssetEditForm({ ...assetEditForm, physicalState: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-2"><Field label="Interacción"><Select options={PRODUCTION_INTERACTIONS} value={assetEditForm.interactionType} onChange={(event) => setAssetEditForm({ ...assetEditForm, interactionType: event.target.value })} /></Field><Field label="Mano asignada"><Select options={PRODUCTION_HAND_ASSIGNMENTS} value={assetEditForm.handAssignment} onChange={(event) => setAssetEditForm({ ...assetEditForm, handAssignment: event.target.value })} /></Field><Field label="Calidad fuente"><Select options={PRODUCTION_SOURCE_QUALITIES} value={assetEditForm.sourceQuality} onChange={(event) => setAssetEditForm({ ...assetEditForm, sourceQuality: event.target.value })} /></Field></div>{assetEditForm.componentType === "Locación" && <Field label="Locación"><Input value={assetEditForm.locationName} onChange={(event) => setAssetEditForm({ ...assetEditForm, locationName: event.target.value })} /></Field>}<div className="grid sm:grid-cols-2 gap-2"><Field label="Dirección de luz"><Input value={assetEditForm.lightDirection} onChange={(event) => setAssetEditForm({ ...assetEditForm, lightDirection: event.target.value })} /></Field><Field label="Referencia de escala"><Input value={assetEditForm.scaleReference} onChange={(event) => setAssetEditForm({ ...assetEditForm, scaleReference: event.target.value })} /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="QA visual"><Select options={PRODUCTION_QA_STATUSES} value={assetEditForm.qaStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, qaStatus: event.target.value })} /></Field><Field label="Consentimiento"><Select disabled={!['Manos','Presentador UGC'].includes(assetEditForm.componentType)} options={PRODUCTION_CONSENT_STATUSES} value={assetEditForm.consentStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, consentStatus: event.target.value })} /></Field></div><Field label="Continuidad"><textarea className={inputCls} style={inputStyle} rows="2" value={assetEditForm.continuityNotes} onChange={(event) => setAssetEditForm({ ...assetEditForm, continuityNotes: event.target.value })} /></Field></div>}</div>
              <Field label="Etiquetas separadas por coma"><Input value={assetEditForm.tags} onChange={(event) => setAssetEditForm({ ...assetEditForm, tags: event.target.value })} placeholder="oreo, close-up, cocina, fondo rosa" /></Field>
              <Field label="Notas y alcance del permiso"><textarea className={inputCls} style={inputStyle} rows="4" value={assetEditForm.notes} onChange={(event) => setAssetEditForm({ ...assetEditForm, notes: event.target.value })} /></Field>
              <div className="flex flex-wrap gap-2"><BtnAsync onClick={saveAssetMetadata} disabled={assetEditForm.name.trim().length < 3 || (assetEditForm.collection === "Productos" && !assetEditForm.productId) || (assetEditForm.collection === "Animación" && (!animationReady || assetEditForm.figure.trim().length < 2))} textoEnVuelo="Guardando versión…">Guardar corrección</BtnAsync><Btn kind="ghost" onClick={() => setAssetEditForm(null)}>Cancelar edición</Btn></div>
            </div>}
          </div>
        </Modal>;
      })()}

      {deleteAsset && <Modal title={deletePolicy.mode === "official-logo" ? "Eliminar logo oficial de MOMOS" : "Eliminar archivo de la Biblioteca"} onClose={closeDeleteConfirmation} topLayer>
        <div className="rounded-2xl p-4 mb-4 flex gap-3" style={{ background: "#FFF1ED", border: "1px solid #E9B1A5" }}>
          <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: "#F6D4CD", color: "#A03B2A" }}>🗑️</div>
          <div><div className="font-extrabold">{deleteAsset.name}</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>{deletePolicy.mode === "official-logo" ? "Se borrará el archivo real del logo. Su versión histórica y la auditoría permanecerán, pero la identidad quedará incompleta hasta subir un reemplazo." : "Se borrará el archivo real y ya no podrá recuperarse. MOMO OPS conservará únicamente una constancia mínima de auditoría."}</div></div>
        </div>
        {deletePolicy.mode === "official-logo" ? <>
          <div className="rounded-2xl px-3 py-3 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Los creativos y gates de marca quedarán bloqueados de forma segura hasta que Administración cargue y declare un nuevo logo principal.</div>
          <label className="rounded-2xl border px-3 py-3 mb-3 flex gap-2 items-start text-sm font-bold" style={{ borderColor: T.border, background: "#fff" }}><input type="checkbox" className="mt-1" checked={deleteAcknowledged} onChange={(event) => setDeleteAcknowledged(event.target.checked)} /><span>Entiendo que el logo no podrá recuperarse y que tendré que subir un reemplazo.</span></label>
          <Field label={`Escribí exactamente: ${deletePolicy.confirmationPhrase}`}><Input value={deleteConfirmationText} onChange={(event) => setDeleteConfirmationText(event.target.value)} autoComplete="off" /></Field>
        </> : <div className="rounded-2xl px-3 py-3 mb-4 text-xs font-bold" style={{ background: T.vainilla, color: T.choco }}>Esta opción solo aparece cuando la foto o el video nunca se ha usado en creativos, escenas, audio, exportaciones o publicaciones.</div>}
        <div className="flex flex-wrap gap-2"><BtnAsync onClick={deleteAssetPermanently} disabled={!deletePolicy.allowed || (deletePolicy.mode === "official-logo" && (!deleteAcknowledged || deleteConfirmationText.trim() !== deletePolicy.confirmationPhrase))} textoEnVuelo="Eliminando archivo…">{deletePolicy.mode === "official-logo" ? "Eliminar logo definitivamente" : "Sí, eliminar definitivamente"}</BtnAsync><Btn kind="ghost" onClick={closeDeleteConfirmation}>Conservar archivo</Btn></div>
      </Modal>}

      {uploadOpen && <Modal title={assetForm.collection === "Marca" ? (assetForm.brandRole === "Logo principal" ? "Subir logo principal de MOMOS" : "Nuevo archivo de identidad de marca") : assetForm.collection === "Animación" ? "Nuevo archivo del mundo animado" : "Nuevo archivo de producto"} onClose={() => { setUploadOpen(false); setFile(null); }} wide topLayer>
        <div className="grid sm:grid-cols-3 gap-2 mb-4" role="tablist" aria-label="Destino del archivo">
          {[{ id: "Marca", label: "Identidad y marca", detail: "Logo, estilo, empaque o cultura" }, { id: "Productos", label: "Producto", detail: "Producto, figura, sabor y toma" }, { id: "Animación", label: "Mundo animado", detail: "Personaje, escenario, objeto o continuidad" }].map((item) => { const active = assetForm.collection === item.id; const unavailable = item.id === "Animación" && !animationReady; return <button key={item.id} type="button" role="tab" aria-selected={active} disabled={unavailable} onClick={() => { const role = item.id === "Marca" ? "Referencia visual" : item.id === "Animación" ? "Diseño base" : "Producto"; setAssetForm({ ...emptyAssetForm, collection: item.id, brandRole: item.id === "Marca" ? role : "", shotType: role, mediaType: item.id === "Productos" ? "Video" : "Foto" }); setFile(null); }} className="rounded-2xl border px-3 py-2.5 text-left" style={{ borderColor: active ? T.coral : T.border, background: active ? "#FFF5F0" : T.surface, opacity: unavailable ? .5 : 1 }}><span className="block text-xs font-extrabold">{item.label}</span><span className="block text-[9px] mt-0.5" style={{ color: T.choco2 }}>{unavailable ? "Disponible después de la migración 59" : item.detail}</span></button>; })}
        </div>
        <div className="rounded-2xl p-3 mb-4 text-xs" style={{ background: T.vainilla }}><b>El original nunca se sobrescribe.</b> {assetForm.collection === "Marca" ? "Este archivo quedará en la colección de Marca, separado de las tomas de productos." : assetForm.collection === "Animación" ? "Este archivo quedará en el Mundo animado, separado de Marca y Productos, pero disponible para storyboards y continuidad." : "Este archivo quedará ligado a la colección de Productos para encontrarlo por producto, figura y sabor."}</div>
        <Field label="Archivo original (máximo 100 MB)"><input type="file" accept={assetForm.collection === "Marca" && /logo/i.test(assetForm.brandRole) ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,application/pdf"} onChange={(event) => chooseFile(event.target.files?.[0])} className="w-full rounded-2xl border p-3 text-sm" style={{ borderColor: T.border, background: "#fff" }} /></Field>
        {file && <div className="rounded-xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#E8F1E4", color: "#315B35" }}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB · se verificará con SHA-256</div>}
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Nombre descriptivo"><Input value={assetForm.name} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} placeholder={assetForm.collection === "Marca" ? "Ej. Logo principal coral · fondo transparente" : assetForm.collection === "Animación" ? "Ej. Momo · turnaround oficial" : "Ej. Max Oreo · close-up cuchara"} /></Field><Field label="Tipo de archivo"><Select options={assetForm.collection === "Marca" && /logo/i.test(assetForm.brandRole) ? ["Logo"] : assetForm.collection === "Animación" ? BRAND_MEDIA_TYPES.filter((type) => type !== "Logo") : BRAND_MEDIA_TYPES} value={assetForm.mediaType} onChange={(event) => setAssetForm({ ...assetForm, mediaType: event.target.value, brandRole: event.target.value === "Logo" && assetForm.collection === "Marca" ? "Logo principal" : assetForm.brandRole })} /></Field></div>
        {assetForm.collection === "Marca" ? <div className="grid sm:grid-cols-2 gap-3"><Field label="Uso dentro de la marca"><Select options={BRAND_ASSET_ROLES} value={assetForm.brandRole} onChange={(event) => { const role = event.target.value; setAssetForm({ ...assetForm, brandRole: role, shotType: role, mediaType: /logo/i.test(role) ? "Logo" : assetForm.mediaType === "Logo" ? "Foto" : assetForm.mediaType }); }} /></Field><Field label="Orientación"><Select options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetForm.orientation} onChange={(event) => setAssetForm({ ...assetForm, orientation: event.target.value })} /></Field></div>
          : assetForm.collection === "Animación" ? <><div className="grid sm:grid-cols-2 gap-3"><Field label="Tipo de elemento"><Select options={ANIMATION_ASSET_KINDS} value={assetForm.animationKind} onChange={(event) => setAssetForm({ ...assetForm, animationKind: event.target.value })} /></Field><Field label="Material de referencia"><Select options={ANIMATION_ASSET_ROLES} value={assetForm.shotType} onChange={(event) => setAssetForm({ ...assetForm, shotType: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Personaje o elemento"><Input value={assetForm.figure} onChange={(event) => setAssetForm({ ...assetForm, figure: event.target.value })} placeholder="Momo, Toby, Cocina MOMOS…" /></Field><Field label="Variante o vestuario"><Input value={assetForm.flavor} onChange={(event) => setAssetForm({ ...assetForm, flavor: event.target.value })} placeholder="Base, chef, invierno…" /></Field><Field label="Orientación"><Select options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetForm.orientation} onChange={(event) => setAssetForm({ ...assetForm, orientation: event.target.value })} /></Field></div><label className="flex gap-2 items-start rounded-2xl border px-3 py-2.5 mb-3 text-sm font-bold" style={{ borderColor: T.border }}><input disabled={!hasRole(user,"Administrador")} type="checkbox" className="mt-1" checked={assetForm.animationCanon} onChange={(event) => setAssetForm({ ...assetForm, animationCanon: event.target.checked })} /><span>Declarar como referencia canónica<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>La serie usará esta apariencia como fuente oficial. Solo Administración puede declararla.</span></span></label></>
            : <><div className="grid sm:grid-cols-2 gap-3"><Field label="Producto relacionado"><select className={inputCls} style={inputStyle} value={assetForm.productId} onChange={(event) => setAssetForm({ ...assetForm, productId: event.target.value })}><option value="">Elegir producto…</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{product.nombre}</option>)}</select></Field><Field label="Orientación"><Select options={["Vertical","Horizontal","Cuadrado","Audio","Documento"]} value={assetForm.orientation} onChange={(event) => setAssetForm({ ...assetForm, orientation: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Figura"><Input value={assetForm.figure} onChange={(event) => setAssetForm({ ...assetForm, figure: event.target.value })} placeholder="Max, Lizi…" /></Field><Field label="Sabor"><Input value={assetForm.flavor} onChange={(event) => setAssetForm({ ...assetForm, flavor: event.target.value })} placeholder="Oreo, Coco…" /></Field><Field label="Tipo de toma"><Input value={assetForm.shotType} onChange={(event) => setAssetForm({ ...assetForm, shotType: event.target.value })} placeholder="Close-up, cocina…" /></Field></div></>}
        {assetForm.collection === "Marca" && assetForm.brandRole === "Logo principal" && <div className="rounded-2xl px-3 py-3 mb-3 text-xs font-semibold" style={{ background: "#E8F1E4", color: "#315B35" }}>Al guardar, MOMO OPS creará una nueva versión de identidad, conservará la paleta actual y declarará este archivo como logo principal oficial. Debe ser PNG, JPG o WEBP.</div>}
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Derechos"><Select options={BRAND_MEDIA_RIGHTS} value={assetForm.rightsStatus} onChange={(event) => setAssetForm({ ...assetForm, rightsStatus: event.target.value })} /></Field><Field label="Vencimiento del permiso (opcional)"><Input type="date" value={assetForm.rightsExpiresAt} onChange={(event) => setAssetForm({ ...assetForm, rightsExpiresAt: event.target.value })} /></Field></div>
        <div className="rounded-2xl border px-3 py-2 mb-3" style={{ borderColor: T.border }}><label className="flex gap-2 items-start text-sm font-bold"><input type="checkbox" className="mt-1" checked={assetForm.containsPeople} onChange={(event) => setAssetForm({ ...assetForm, containsPeople: event.target.checked })} /><span>El archivo muestra personas<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Para usarlo con IA, los derechos deben quedar en Autorizado.</span></span></label><label className="flex gap-2 items-start text-sm font-bold mt-2"><input type="checkbox" className="mt-1" checked={assetForm.aiUseAllowed} onChange={(event) => setAssetForm({ ...assetForm, aiUseAllowed: event.target.checked })} /><span>Permitir edición o generación con IA<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>El original sigue privado y no se modifica.</span></span></label></div>
        {assetForm.containsPeople && assetForm.rightsStatus !== "Autorizado" && <div className="rounded-2xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ Se puede catalogar, pero el servidor bloqueará su uso con IA hasta registrar autorización explícita.</div>}
        <div className="rounded-3xl border p-3 mb-3" style={{ borderColor: productionAssetsReady ? "#C8B3D9" : T.border, background: productionAssetsReady ? "#FBF7FD" : T.soft }}>
          <label className="flex gap-2 items-start text-sm font-extrabold"><input type="checkbox" className="mt-1" disabled={!productionAssetsReady} checked={assetForm.productionEnabled} onChange={(event) => setAssetForm({ ...assetForm, productionEnabled: event.target.checked })} /><span>Crear ficha de producción<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Hace que este original pueda encontrarse como manos, UGC, vista, locación o componente de un paquete.</span></span></label>
          {assetForm.productionEnabled && <div className="mt-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Componente"><Select options={PRODUCTION_COMPONENT_TYPES} value={assetForm.componentType} onChange={(event) => { const componentType = event.target.value; setAssetForm({ ...assetForm, ...defaultProductionProfile(componentType), componentType, productionEnabled: true, containsPeople: ["Manos","Presentador UGC"].includes(componentType) ? true : assetForm.containsPeople }); }} /></Field><Field label="Vista"><Select options={PRODUCTION_VIEW_ANGLES} value={assetForm.viewAngle} onChange={(event) => setAssetForm({ ...assetForm, viewAngle: event.target.value })} /></Field><Field label="Estado físico"><Select options={PRODUCTION_PHYSICAL_STATES} value={assetForm.physicalState} onChange={(event) => setAssetForm({ ...assetForm, physicalState: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-2"><Field label="Interacción"><Select options={PRODUCTION_INTERACTIONS} value={assetForm.interactionType} onChange={(event) => setAssetForm({ ...assetForm, interactionType: event.target.value })} /></Field><Field label="Mano asignada"><Select options={PRODUCTION_HAND_ASSIGNMENTS} value={assetForm.handAssignment} onChange={(event) => setAssetForm({ ...assetForm, handAssignment: event.target.value })} /></Field><Field label="Calidad de fuente"><Select options={PRODUCTION_SOURCE_QUALITIES} value={assetForm.sourceQuality} onChange={(event) => setAssetForm({ ...assetForm, sourceQuality: event.target.value })} /></Field></div>{assetForm.componentType === "Locación" && <Field label="Nombre de la locación"><Input value={assetForm.locationName} onChange={(event) => setAssetForm({ ...assetForm, locationName: event.target.value })} placeholder="Cocina MOMOS, casa creadora, tienda…" /></Field>}<div className="grid sm:grid-cols-2 gap-2"><Field label="Dirección de luz"><Input value={assetForm.lightDirection} onChange={(event) => setAssetForm({ ...assetForm, lightDirection: event.target.value })} placeholder="Ventana izquierda, cálida frontal…" /></Field><Field label="Referencia de escala"><Input value={assetForm.scaleReference} onChange={(event) => setAssetForm({ ...assetForm, scaleReference: event.target.value })} placeholder="Cuchara, mano, regla, bolsa…" /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="QA visual"><Select options={PRODUCTION_QA_STATUSES} value={assetForm.qaStatus} onChange={(event) => setAssetForm({ ...assetForm, qaStatus: event.target.value })} /></Field><Field label="Consentimiento"><Select disabled={!['Manos','Presentador UGC'].includes(assetForm.componentType)} options={PRODUCTION_CONSENT_STATUSES} value={assetForm.consentStatus} onChange={(event) => setAssetForm({ ...assetForm, consentStatus: event.target.value })} /></Field></div><Field label="Continuidad y observaciones de QA"><textarea className={inputCls} style={inputStyle} rows="2" value={assetForm.continuityNotes} onChange={(event) => setAssetForm({ ...assetForm, continuityNotes: event.target.value })} placeholder="Qué debe mantenerse idéntico entre tomas; anotar escarcha, reflejos, fondo o deformaciones." /></Field></div>}
          {!productionAssetsReady && <div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Disponible al aplicar la migración 61.</div>}
        </div>
        <Field label="Etiquetas separadas por coma"><Input value={assetForm.tags} onChange={(event) => setAssetForm({ ...assetForm, tags: event.target.value })} placeholder={assetForm.collection === "Animación" ? "feliz, frontal, manos, escala, cocina" : "oreo, close-up, cuchara, fondo rosa"} /></Field>
        <Field label={assetForm.collection === "Animación" ? "Notas de diseño, uso y continuidad" : "Notas y alcance del permiso"}><textarea className={inputCls} style={inputStyle} rows="3" value={assetForm.notes} onChange={(event) => setAssetForm({ ...assetForm, notes: event.target.value })} /></Field>
        <div className="flex flex-wrap gap-2"><BtnAsync onClick={saveAsset} disabled={!file || assetForm.name.trim().length < 3 || (assetForm.collection === "Productos" && !assetForm.productId) || (assetForm.collection === "Animación" && (!animationReady || assetForm.figure.trim().length < 2))} textoEnVuelo="Protegiendo original…">{assetForm.collection === "Marca" && assetForm.brandRole === "Logo principal" ? "Guardar y declarar logo principal" : assetForm.collection === "Animación" ? "Guardar en Mundo animado" : `Guardar en ${assetForm.collection}`}</BtnAsync><Btn kind="ghost" onClick={() => { setUploadOpen(false); setFile(null); }}>Cancelar</Btn></div>
      </Modal>}
    </div>
  );
}

function AgencyCollaborationDesk({ db, refrescar }) {
  const desk = useMemo(() => buildAgencyCollaborationDesk(db), [db]);
  const [openForm, setOpenForm] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [sourceKey, setSourceKey] = useState("");
  const [objective, setObjective] = useState("");
  const [entryType, setEntryType] = useState("Aporte");
  const [entryBody, setEntryBody] = useState("");
  const [contractForm, setContractForm] = useState({
    concept: "", audience: "", channel: "Instagram", primaryKpi: "Beneficio incremental",
    contentMode: "Orgánico", contentGoal: "Construir deseo y conversación alrededor de MOMOS", modePrimaryMetric: "Retención",
    humanIntent: "", callToAction: "", mustInclude: "", mustAvoid: "",
  });
  const [approvalNote, setApprovalNote] = useState("");
  const [contractEditing, setContractEditing] = useState(false);
  const linkedDecisions = new Set((db.agencyCollaborationRooms || []).map((room) => String(room.decisionId || "")).filter(Boolean));
  const linkedBriefs = new Set((db.agencyCollaborationRooms || []).map((room) => String(room.briefId || "")).filter(Boolean));
  const sources = useMemo(() => [
    ...(db.agencyDecisions || []).filter((item) => item.status === "Aprobada" && !linkedDecisions.has(String(item.id))).map((item) => ({ ...item, kind: "decision", key: `decision-${item.id}`, label: `Decisión #${item.id} · ${item.title}` })),
    ...(db.agencyBriefs || []).filter((item) => ["Aprobado", "En producción"].includes(item.status) && !linkedBriefs.has(String(item.id))).map((item) => ({ ...item, kind: "brief", key: `brief-${item.id}`, label: `Brief #${item.id} · ${item.title}` })),
  ], [db.agencyDecisions, db.agencyBriefs, db.agencyCollaborationRooms]);
  const activeRoom = desk.rooms.find((room) => String(room.id) === String(activeRoomId)) || null;
  const activeEntries = activeRoom ? (db.agencyCollaborationEntries || []).filter((entry) => String(entry.roomId) === String(activeRoom.id)) : [];
  const activeContracts = activeRoom ? (db.agencyCreativeContracts || []).filter((contract) => String(contract.roomId) === String(activeRoom.id)).sort((a, b) => Number(b.version || 0) - Number(a.version || 0)) : [];
  const latestContract = activeContracts.find((contract) => contract.status !== "Sustituido") || null;

  function startRoom() {
    const first = sources[0];
    setSourceKey(first?.key || "");
    setObjective(first?.rationale || first?.insight || "Convertir esta oportunidad en una acción creativa rentable y fiel a MOMOS.");
    setOpenForm(true);
  }

  async function createRoom() {
    const source = sources.find((item) => item.key === sourceKey);
    if (!source) throw new Error("Elegí una decisión o brief aprobado.");
    const result = await abrirMesaAgencia(agencyRoomPayload(source, objective));
    setOpenForm(false);
    setActiveRoomId(result.room_id);
    toast("ok", result.duplicate ? "La mesa ya existía; abrimos su conversación." : "Mesa cooperativa abierta con contexto sellado.");
    await refrescar();
  }

  async function addHumanEntry() {
    if (!activeRoom || entryBody.trim().length < 3) throw new Error("Escribí el criterio que querés aportar.");
    await agregarAporteMesaAgencia(activeRoom.id, `human-${activeRoom.id}-${Date.now()}`, entryType, entryBody.trim(), { ui: "agency-collaboration-desk" });
    setEntryBody("");
    toast("ok", "Tu criterio quedó firmado en la mesa.");
    await refrescar();
  }

  async function prepareContract() {
    if (!activeRoom) return;
    const result = await prepararContratoCreativo(activeRoom.id, agencyContractDirection(contractForm, activeRoom), agencyContractConstraints(contractForm));
    setContractEditing(false);
    toast("ok", result.duplicate ? "Ese contrato ya estaba sellado." : "Contrato creativo preparado; falta aprobación humana.");
    await refrescar();
  }

  async function approveContract() {
    if (!latestContract) return;
    await aprobarContratoCreativo(latestContract.id, approvalNote || "Aprobación humana desde la Mesa de Agencia MOMOS");
    setApprovalNote("");
    toast("ok", "Contrato creativo aprobado. No generó, gastó ni publicó nada.");
    await refrescar();
  }

  const statusTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" } : status === "En revisión" ? { bg: "#FFF2D8", fg: "#7A5410" } : { bg: "#E5EEF7", fg: "#315A7D" };

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>✦</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Equipo MOMOS</div><div className="display text-xl font-semibold">Mesa de trabajo creativo</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>MOMOS reúne los datos y la propuesta; vos aportás el criterio de marca antes de crear una pieza.</div></div></div>
      <div className="flex items-center gap-2"><div className="grid grid-cols-2 gap-2">{[["Mesas",desk.summary.open],["Acuerdos",desk.summary.approved]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[72px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div><Btn small kind="soft" disabled={!db.agencyCollaborationReady || sources.length === 0} onClick={startRoom}>＋ Abrir mesa</Btn></div>
    </div>
    {!db.agencyCollaborationReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>mesa-agencia-v1.sql</code> después de la migración 29. Hasta entonces no se puede sellar la colaboración.</div> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border-b" style={{ borderColor: T.border, background: "#FFF8F1" }}>
        {[["Abiertas",desk.summary.open],["Falta humano",desk.summary.waitingForHuman],["Falta agente",desk.summary.waitingForAgent],["Por aprobar",desk.summary.pendingApproval]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2" style={{ borderColor: T.border, background: "#fff" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-xl font-semibold">{value}</div></div>)}
      </div>
      {desk.open.length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay mesas abiertas.</b> Elegí una decisión o brief aprobado para reunir la data, el criterio humano y la propuesta del agente.</div> : <div className="p-3 grid lg:grid-cols-2 gap-2">
        {desk.open.slice(0, 6).map((room) => <button type="button" key={room.id} onClick={() => setActiveRoomId(room.id)} className="text-left rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: room.readiness.readyForContract ? "#B8D3B2" : T.border, background: room.readiness.readyForContract ? "#F4FAF2" : "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Mesa #{room.id} · {room.status}</div><div className="font-extrabold text-sm">{room.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: room.readiness.readyForContract ? "#DDEBD9" : "#FFF2D8", color: room.readiness.readyForContract ? "#315B35" : "#7A5410" }}>{room.readiness.readyForContract ? "ACUERDO POSIBLE" : "EN CONVERSACIÓN"}</span></div>
          <p className="text-[11px] my-2 line-clamp-2" style={{ color: T.choco2 }}>{room.objective}</p><div className="flex gap-1.5"><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F3D7DC" }}>Humano {room.readiness.humanCount}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#E5EEF7" }}>Agente {room.readiness.agentCount}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>Contrato {room.readiness.hasApprovedContract ? "aprobado" : "pendiente"}</span></div>
        </button>)}
      </div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>La mesa no ejecuta herramientas. El contrato aprobado será la entrada gobernada de generación, revisión humana y distribución.</div>

    {openForm && <Modal title="Abrir Mesa cooperativa" onClose={() => setOpenForm(false)} topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: T.vainilla }}><b>El contexto comercial se captura ahora y queda inmutable.</b> Nuevos datos requerirán una nueva mesa o una versión posterior del contrato.</div>
      <Field label="Oportunidad aprobada"><select className={inputCls} style={inputStyle} value={sourceKey} onChange={(event) => { const next = sources.find((item) => item.key === event.target.value); setSourceKey(event.target.value); if (next) setObjective(next.rationale || next.insight || objective); }}><option value="">Elegí una fuente…</option>{sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></Field>
      <Field label="Objetivo de la mesa"><textarea className={inputCls} style={inputStyle} rows="4" value={objective} onChange={(event) => setObjective(event.target.value)} /></Field>
      <div className="flex gap-2"><BtnAsync onClick={createRoom} disabled={!sourceKey || objective.trim().length < 5}>Abrir con contexto sellado</BtnAsync><Btn kind="ghost" onClick={() => setOpenForm(false)}>Cancelar</Btn></div>
    </Modal>}

    {activeRoom && <Modal title={`Mesa #${activeRoom.id} · ${activeRoom.title}`} onClose={() => setActiveRoomId(null)} wide topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: "#F5E9D8" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Objetivo sellado</div><div className="text-sm font-bold">{activeRoom.objective}</div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>Huella {String(activeRoom.contextFingerprint || "").slice(0, 12)} · este contexto no se puede reemplazar.</div></div>
      <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-4">
        <div><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Conversación trazable</div><div className="rounded-3xl border p-3 min-h-[220px] max-h-[420px] overflow-y-auto space-y-2" style={{ borderColor: T.border, background: "#FFFAF5" }}>
          {activeEntries.length === 0 && <div className="text-sm p-3" style={{ color: T.choco2 }}>Empezá dejando el criterio humano de marca. El agente se incorpora mediante el Orquestador/MCP seguro.</div>}
          {activeEntries.map((entry) => <div key={entry.id} className={`flex ${entry.authorKind === "Humano" ? "justify-end" : "justify-start"}`}><div className="rounded-2xl px-3 py-2 max-w-[88%]" style={{ background: entry.authorKind === "Humano" ? "#F3D7DC" : entry.authorKind === "Agente" ? "#E5EEF7" : T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: entry.authorKind === "Humano" ? "#8E4B5A" : "#315A7D" }}>{entry.authorKind} · {entry.entryType}{entry.agentName ? ` · ${entry.agentName}` : ""}</div><div className="text-xs leading-relaxed">{entry.body}</div><div className="text-[8px] mt-1 opacity-60">{entry.createdAt} · {String(entry.fingerprint || "").slice(0, 8)}</div></div></div>)}
        </div>
          {!["Cerrada","Cancelada"].includes(activeRoom.status) && <div className="rounded-2xl border p-3 mt-3" style={{ borderColor: T.border }}><div className="grid sm:grid-cols-[160px_1fr] gap-2"><Select options={AGENCY_COLLABORATION_ENTRY_TYPES} value={entryType} onChange={(event) => setEntryType(event.target.value)} /><textarea className={inputCls} style={inputStyle} rows="3" value={entryBody} onChange={(event) => setEntryBody(event.target.value)} placeholder="Tu intención, objeción o decisión de marca…" /></div><BtnAsync small onClick={addHumanEntry} disabled={entryBody.trim().length < 3}>Firmar aporte humano</BtnAsync></div>}
        </div>
        <div><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Contrato creativo</div>
          {!activeRoom.readiness.readyForContract && <div className="rounded-2xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{activeRoom.readiness.reasons.join(" ")} El agente solo puede firmar su lado mediante el canal MCP protegido.</div>}
          {latestContract && !contractEditing ? <div className="rounded-3xl border p-4 mb-3" style={{ borderColor: statusTone(latestContract.status).fg, background: statusTone(latestContract.status).bg }}><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold">Versión {latestContract.version} · {latestContract.sealedPayload?.creative_direction?.content_mode || "Modo pendiente"}</div><div className="display text-lg font-semibold">{latestContract.sealedPayload?.creative_direction?.concept || "Contrato creativo MOMOS"}</div></div><span className="rounded-full bg-white/70 px-2 py-1 h-fit text-[9px] font-extrabold">{latestContract.status}</span></div><div className="text-xs mt-2"><b>Norte comercial:</b> {latestContract.sealedPayload?.primary_kpi}<br /><b>Métrica del contenido:</b> {latestContract.sealedPayload?.creative_direction?.mode_primary_metric || "Pendiente"}<br /><b>Canal:</b> {latestContract.sealedPayload?.creative_direction?.channel}<br /><b>Huella:</b> {String(latestContract.fingerprint || "").slice(0, 12)}</div>{latestContract.status === "En revisión" && <><Field label="Nota de aprobación"><Input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Qué validaste como dueño de marca" /></Field><div className="flex flex-wrap gap-2"><BtnAsync confirmar onClick={approveContract}>Aprobar contrato humano + agente</BtnAsync><Btn small kind="ghost" onClick={() => setContractEditing(true)}>Preparar nueva versión</Btn></div></>}</div> : <div className="space-y-2"><Field label="Concepto acordado"><Input value={contractForm.concept} onChange={(event) => setContractForm({ ...contractForm, concept: event.target.value })} placeholder="La idea central que debe recordar el cliente" /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Audiencia"><Input value={contractForm.audience} onChange={(event) => setContractForm({ ...contractForm, audience: event.target.value })} /></Field><Field label="Canal"><Input value={contractForm.channel} onChange={(event) => setContractForm({ ...contractForm, channel: event.target.value })} /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="Tipo de contenido"><Select options={AGENCY_CONTENT_MODES} value={contractForm.contentMode} onChange={(event) => { const contentMode = event.target.value; setContractForm({ ...contractForm, contentMode, modePrimaryMetric: AGENCY_MODE_METRICS[contentMode][0] }); }} /></Field><Field label="Métrica propia del contenido"><Select options={AGENCY_MODE_METRICS[contractForm.contentMode]} value={contractForm.modePrimaryMetric} onChange={(event) => setContractForm({ ...contractForm, modePrimaryMetric: event.target.value })} /></Field></div><div className="rounded-2xl px-3 py-2 text-[10px] font-semibold" style={{ background: contractForm.contentMode === "Pauta" ? "#FFF1D8" : "#E8F1E4", color: contractForm.contentMode === "Pauta" ? "#7B5410" : "#3F6B42" }}>{contractForm.contentMode === "Pauta" ? "Pauta: vender de forma medible con oferta, audiencia, stock, atribución y CTA claros." : "Orgánico: ganar atención, afinidad y conversación; la venta asistida se mide aparte y nunca se presume."}</div><Field label="Objetivo de esta pieza"><Input value={contractForm.contentGoal} onChange={(event) => setContractForm({ ...contractForm, contentGoal: event.target.value })} /></Field><Field label="Norte comercial de MOMOS"><Select options={AGENCY_CONTRACT_KPIS} value={contractForm.primaryKpi} onChange={(event) => setContractForm({ ...contractForm, primaryKpi: event.target.value })} /></Field><Field label="Intención humana de marca"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.humanIntent} onChange={(event) => setContractForm({ ...contractForm, humanIntent: event.target.value })} /></Field><Field label="Llamado a la acción"><Input value={contractForm.callToAction} onChange={(event) => setContractForm({ ...contractForm, callToAction: event.target.value })} /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Debe incluir"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.mustInclude} onChange={(event) => setContractForm({ ...contractForm, mustInclude: event.target.value })} /></Field><Field label="Debe evitar"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.mustAvoid} onChange={(event) => setContractForm({ ...contractForm, mustAvoid: event.target.value })} /></Field></div><div className="flex gap-2"><BtnAsync onClick={prepareContract} disabled={!activeRoom.readiness.readyForContract || contractForm.concept.trim().length < 3 || contractForm.audience.trim().length < 3 || contractForm.contentGoal.trim().length < 3 || contractForm.humanIntent.trim().length < 3}>Preparar contrato sellado</BtnAsync>{latestContract && <Btn kind="ghost" onClick={() => setContractEditing(false)}>Conservar versión {latestContract.version}</Btn>}</div></div>}
          <div className="rounded-2xl px-3 py-2 mt-3 text-[10px] font-semibold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Aprobar este contrato no llama a Kling, no crea pauta y no publica. Solo fija la intención compartida para los siguientes motores.</div>
        </div>
      </div>
    </Modal>}
  </div>;
}

function AgencyRetentionLab({ db, refrescar }) {
  const center = useMemo(() => buildAgencyRetentionCenter(db), [db]);
  const [contractId, setContractId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [form, setForm] = useState({ platform: "Instagram Reels", duration: 15, title: "", audience: "", promise: "", payoff: "", callToAction: "", controlHook: "", challengerHook: "", openingVisual: "", proof: "" });

  function openScript(contract) {
    const direction = contract.sealedPayload?.creative_direction || {};
    const concept = direction.concept || "Mostrar un Momo real de forma irresistible";
    setContractId(String(contract.id));
    setForm({
      platform: "Instagram Reels", duration: 15, title: `Guion de retención · ${concept}`,
      audience: direction.audience || "Personas que disfrutan postres premium en Cali",
      promise: `Vas a descubrir por qué ${concept.toLowerCase()}.`, payoff: "La demostración real cierra exactamente la promesa del inicio.",
      callToAction: direction.call_to_action || "Pedí tu Momo", controlHook: concept,
      challengerHook: `Esperá a ver el centro de este Momo.`, openingVisual: "Producto real y reconocible en el primer fotograma.",
      proof: "La cámara muestra el producto real y su textura; no se inventan beneficios.",
    });
    setFormOpen(true);
  }

  async function saveScript() {
    const contract = (db.agencyCreativeContracts || []).find((item) => String(item.id) === String(contractId));
    if (!contract) throw new Error("El contrato creativo ya no está disponible.");
    const duration = Math.max(5, Number(form.duration || 15));
    const hookEnd = Math.min(3, Math.max(1.5, duration * 0.2));
    const proofEnd = Math.max(hookEnd + 1, duration - Math.max(1, duration * 0.2));
    const scores = { clarity: 2, relevance: 2, specificity: 2, proof: 2, novelty: 1, payoff_fit: 2, brand_fit: 2, honesty: 2 };
    const payload = retentionScriptPayload({
      title: form.title, platform: form.platform, targetDurationSec: duration, audience: form.audience,
      objective: contract.sealedPayload?.creative_direction?.primary_kpi || "Beneficio incremental",
      promise: form.promise, payoff: form.payoff, callToAction: form.callToAction,
      evidencePlan: { product_real: true, approved_contract_fingerprint: contract.fingerprint, no_unapproved_claims: true },
      hooks: [
        { variantKey: "A", label: "Control", mechanism: "Resultado primero", hookText: form.controlHook, openingVisual: form.openingVisual, proof: form.proof, scores, selected: true },
        { variantKey: "B", label: "Retador", mechanism: "Pregunta", hookText: form.challengerHook, openingVisual: form.openingVisual, proof: form.proof, scores, selected: false },
      ],
      beatMap: [
        { label: "Hook y promesa", startSec: 0, endSec: hookEnd, visual: form.openingVisual, audio: form.controlHook, purpose: "Detener el scroll mostrando relevancia." },
        { label: "Prueba y desarrollo", startSec: hookEnd, endSec: proofEnd, visual: form.proof, audio: form.promise, purpose: "Demostrar sin esconder el producto." },
        { label: "Payoff y CTA", startSec: proofEnd, endSec: duration, visual: form.payoff, audio: `${form.payoff} ${form.callToAction}`, purpose: "Cerrar el loop antes de pedir la acción." },
      ],
      loops: [{ loopKey: "L1", question: form.promise, openSec: 0, closeSec: Math.max(hookEnd + 0.5, duration - 1), payoff: form.payoff }],
    }, contract);
    const result = await prepararGuionRetencion(payload);
    setFormOpen(false); toast("ok", `Guion V${result.version || 1} sellado para revisión humana; no generó ni publicó.`); await refrescar();
  }

  async function resolveScript(script, decision) {
    const note = String(reviewNotes[script.id] || "").trim();
    if (!note) { toast("alert", decision === "Aprobar" ? "Escribí qué verificaste antes de aprobar." : "Escribí qué debe corregirse antes de devolver."); return; }
    await resolverGuionRetencion(script.id, decision, note);
    setReviewNotes((current) => ({ ...current, [script.id]: "" }));
    toast("ok", decision === "Aprobar" ? "Guion aprobado. Generación, pauta y publicación siguen separadas." : "Guion devuelto con aprendizaje trazable.");
    await refrescar();
  }

  async function createExperiment(script) {
    const hooks = center.hooks.filter((hook) => String(hook.scriptId) === String(script.id));
    const control = hooks.find((hook) => hook.selected) || hooks[0]; const challenger = hooks.find((hook) => hook.id !== control?.id);
    if (!control || !challenger) throw new Error("El guion necesita control y retador.");
    const hypothesis = window.prompt("Hipótesis A/B — cambiaremos únicamente el hook:", `“${control.hookText}” retendrá mejor a los 3 segundos que “${challenger.hookText}”.`) || "";
    if (hypothesis.trim().length < 10) return;
    await crearExperimentoRetencion({
      experiment_key: `retention-${script.id}-${Date.now()}`, script_id: script.id, control_hook_id: control.id, challenger_hook_id: challenger.id,
      declared_variable: "Hook", hypothesis, primary_metric: "Retención 3 s",
      guardrails: { same_product: true, same_offer: true, same_cta: true, same_audience: true, human_winner_required: true },
    });
    toast("ok", "Experimento A/B planificado. No publicó ni autorizó pauta."); await refrescar();
  }

  async function closeExperiment(experiment, resolution, winnerHookId = null) {
    const note = window.prompt(resolution === "Ganador" ? "Documentá muestra, atribución y criterio del ganador:" : "¿Por qué el resultado permanece inconcluso?",
      resolution === "Ganador" ? "Ambos brazos superan la muestra mínima y la atribución corresponde a esta versión exacta." : "La muestra o la diferencia no permiten declarar ganador.") || "";
    if (!note) return;
    await cerrarExperimentoRetencion(experiment.id, resolution, winnerHookId, note);
    toast("ok", resolution === "Ganador" ? "Ganador sellado por decisión humana; no se escaló automáticamente." : "Ambigüedad conservada como aprendizaje válido.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#6C3F24,#A55A35)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Contrato → atención → aprendizaje económico</div><div className="display text-xl font-semibold">Laboratorio de retención MOMOS</div><div className="text-xs opacity-85 max-w-2xl">Versiona hooks, cierra cada loop y mide la publicación exacta. El cerebro propone; el humano aprueba; una muestra insuficiente nunca se convierte en “ganador”.</div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Borradores",center.summary.drafts],["Por revisar",center.summary.pending],["Aprobados",center.summary.approved],["A/B activos",center.summary.activeExperiments]].map(([label,value]) => <div key={label} className="rounded-2xl px-2.5 py-2 min-w-[64px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyRetentionReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>retencion-aprendizaje-v1.sql</code>. Hasta entonces los hooks y resultados no quedarán versionados.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Arquitectura antes de generar</div><div className="font-extrabold text-sm">Promesa, demostración, payoff y CTA</div></div></div>
        <div className="grid lg:grid-cols-2 gap-2">
          {center.eligibleContracts.map((contract) => <article key={contract.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Contrato #{contract.id} aprobado</div><div className="font-extrabold text-sm">{contract.sealedPayload?.creative_direction?.concept || contract.contractKey}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Todavía no tiene guion de retención activo.</div></div><Btn small onClick={() => openScript(contract)}>Diseñar guion</Btn></article>)}
          {center.pending.map((script) => <article key={script.id} className="rounded-2xl border p-3" style={{ borderColor: "#E8C98B", background: "#FFF7E8" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>V{script.version} · {script.platform} · {script.sourceKind}</div><div className="font-extrabold text-sm">{script.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#FBE8C8", color: "#8B5A08" }}>En revisión</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}><b>Promesa:</b> {script.promise}<br /><b>Payoff:</b> {script.payoff}</div>{!script.architecture.ready && <div className="rounded-xl px-2 py-1.5 text-[10px] mb-2" style={{ background: "#F6D4CD", color: "#A03B2A" }}>× {script.architecture.reasons[0]}</div>}<Input aria-label={`Nota de revisión del guion V${script.version}`} value={reviewNotes[script.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [script.id]: event.target.value }))} placeholder="Qué verificaste o qué debe corregirse" /><div className="flex gap-2 mt-2"><BtnAsync small confirmar disabled={!script.architecture.ready || !String(reviewNotes[script.id] || "").trim()} onClick={() => resolveScript(script, "Aprobar")}>Aprobar guion</BtnAsync><BtnAsync small kind="ghost" disabled={!String(reviewNotes[script.id] || "").trim()} onClick={() => resolveScript(script, "Devolver")}>Devolver</BtnAsync></div></article>)}
          {center.approved.map((script) => { const experiment = center.experiments.find((item) => String(item.scriptId) === String(script.id) && !["Cerrado","Inconcluso","Cancelado"].includes(item.status)); const contract = (db.agencyCreativeContracts || []).find((item) => String(item.id) === String(script.contractId)); return <article key={script.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Aprobado · V{script.version} · {script.targetDurationSec}s</div><div className="font-extrabold text-sm">{script.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>No publicado</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{script.promise} → {script.payoff}</div><div className="flex flex-wrap gap-2">{!experiment ? <BtnAsync small onClick={() => createExperiment(script)}>Planear A/B de hook</BtnAsync> : <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Experimento #{experiment.id} · {experiment.status} · variable única: {experiment.declaredVariable}</div>}{contract && !experiment && <Btn small kind="ghost" onClick={() => openScript(contract)}>Preparar nueva versión</Btn>}</div></article>; })}
        </div>
      </div>
      {center.experiments.length > 0 && <div className="p-4"><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Aprendizaje por versión exacta</div><div className="grid lg:grid-cols-2 gap-2">{center.experiments.slice(0, 8).map((experiment) => { const controlSample = center.measurements.filter((item) => String(item.experimentId) === String(experiment.id) && String(item.hookId) === String(experiment.controlHookId)).reduce((sum,item) => sum + item.sampleSize, 0); const challengerSample = center.measurements.filter((item) => String(item.experimentId) === String(experiment.id) && String(item.hookId) === String(experiment.challengerHookId)).reduce((sum,item) => sum + item.sampleSize, 0); const ready = Math.min(controlSample, challengerSample) >= 100; return <article key={experiment.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>A/B #{experiment.id} · {experiment.primaryMetric}</div><div className="font-extrabold text-sm">{experiment.hypothesis}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: ready ? "#DDEBD9" : "#FBE8C8", color: ready ? "#315B35" : "#8B5A08" }}>{experiment.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>Muestra A {controlSample} · B {challengerSample} · mínimo 100 por brazo</div>{["Planificado","Activo"].includes(experiment.status) && <div className="flex flex-wrap gap-2"><BtnAsync small disabled={!ready} onClick={() => closeExperiment(experiment, "Ganador", experiment.controlHookId)}>Gana A</BtnAsync><BtnAsync small disabled={!ready} onClick={() => closeExperiment(experiment, "Ganador", experiment.challengerHookId)}>Gana B</BtnAsync><BtnAsync small kind="ghost" onClick={() => closeExperiment(experiment, "Inconcluso")}>Inconcluso</BtnAsync></div>}</article>; })}</div></div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Preparar y aprobar cuesta $0: generación, pauta y publicación conservan sus gates separados. Las métricas entran por RPC/conector y no pueden reescribirse.</div>
    {formOpen && <Modal title="Arquitectura de retención" onClose={() => setFormOpen(false)} wide topLayer>
      <div className="rounded-2xl px-3 py-2 mb-3 text-xs" style={{ background: T.vainilla }}><b>Primero el guion.</b> Abrimos una pregunta, la demostramos y la cerramos antes del CTA. Se guardan control y retador; solo cambiaremos el hook.</div>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Canal"><Select options={RETENTION_PLATFORMS} value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} /></Field><Field label="Duración objetivo (s)"><Input type="number" min="5" max="180" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /></Field></div>
      <Field label="Título"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Audiencia"><Input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></Field>
      <Field label="Promesa que abre el loop"><textarea className={inputCls} style={inputStyle} rows="2" value={form.promise} onChange={(event) => setForm({ ...form, promise: event.target.value })} /></Field><Field label="Payoff real que lo cierra"><textarea className={inputCls} style={inputStyle} rows="2" value={form.payoff} onChange={(event) => setForm({ ...form, payoff: event.target.value })} /></Field>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Hook A · control"><textarea className={inputCls} style={inputStyle} rows="2" value={form.controlHook} onChange={(event) => setForm({ ...form, controlHook: event.target.value })} /></Field><Field label="Hook B · retador"><textarea className={inputCls} style={inputStyle} rows="2" value={form.challengerHook} onChange={(event) => setForm({ ...form, challengerHook: event.target.value })} /></Field></div>
      <Field label="Primer fotograma"><Input value={form.openingVisual} onChange={(event) => setForm({ ...form, openingVisual: event.target.value })} /></Field><Field label="Prueba visible"><Input value={form.proof} onChange={(event) => setForm({ ...form, proof: event.target.value })} /></Field><Field label="CTA"><Input value={form.callToAction} onChange={(event) => setForm({ ...form, callToAction: event.target.value })} /></Field>
      <div className="flex gap-2"><BtnAsync confirmar onClick={saveScript} disabled={[form.title,form.audience,form.promise,form.payoff,form.callToAction,form.controlHook,form.challengerHook,form.openingVisual,form.proof].some((value) => !String(value).trim())}>Sellar para revisión</BtnAsync><Btn kind="ghost" onClick={() => setFormOpen(false)}>Cancelar</Btn></div>
    </Modal>}
  </div>;
}

function AgencyLoopLearningDesk({ db, refrescar }) {
  const center = useMemo(() => buildAgencyLoopLearningCenter(db), [db]);

  async function prepare(candidate) {
    await prepararDiagnosticoRetencion(loopDiagnosticPayload(candidate));
    toast("ok", "Diagnóstico sellado para revisión humana. No generó, pautó ni publicó.");
    await refrescar();
  }

  async function resolve(diagnostic, decision) {
    const note = window.prompt(
      decision === "Aprobar" ? "¿Qué evidencia y alcance verificaste antes de convertirlo en aprendizaje?" : "¿Qué debe revisar el cerebro de Agencia?",
      decision === "Aprobar"
        ? "Validé la curva exacta, el beat señalado y que la hipótesis aplica solo a esta plataforma, audiencia y duración."
        : "Reformular la hipótesis sin presentar asociación temporal como causalidad.",
    ) || "";
    if (!note.trim()) return;
    await resolverDiagnosticoRetencion(diagnostic.id, decision, note);
    toast("ok", decision === "Aprobar" ? "Aprendizaje aprobado con alcance exacto; no se escaló automáticamente." : "Diagnóstico devuelto con una corrección trazable.");
    await refrescar();
  }

  const tone = (drop) => Number(drop) >= 15 ? { bg: "#F8DDD7", fg: "#A03B2A" }
    : Number(drop) >= 5 ? { bg: "#FFF0CE", fg: "#8B5A08" } : { bg: "#E3EFE0", fg: "#315B35" };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
      <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: "#F3D7DC" }}>↗</div><div>
        <div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Curva → beat → hipótesis → aprendizaje</div>
        <div className="display text-xl font-semibold">Sala de aprendizaje de loops</div>
        <div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Localiza dónde cae la atención, conserva cada loop y propone una sola variable. Una asociación temporal nunca se presenta como causa.</div>
      </div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Listos",center.summary.ready],["Por revisar",center.summary.pending],["Aprendizajes",center.summary.learnings]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[74px] text-center" style={{ borderColor: T.border, background: "#fff" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyLoopLearningReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>experiencia-loops-retencion-v1.sql</code> después del Hito 34. Los resultados existentes permanecen intactos.</div> : <div className="p-4 space-y-5">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Evidencia nueva</div><div className="font-extrabold text-sm">Mediciones exactas por diagnosticar</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Mínimo 100 observaciones</span></div>
        {center.candidates.length === 0 ? <div className="rounded-2xl border px-3 py-3 text-xs" style={{ borderColor: T.border, color: T.choco2 }}>No hay mediciones nuevas. Cuando una variante tenga curva completa, MOMO OPS la ubicará sobre el guion exacto.</div> : <div className="grid xl:grid-cols-2 gap-3">{center.candidates.slice(0, 6).map((candidate) => <article key={candidate.measurementId} className="rounded-2xl border p-3" style={{ borderColor: candidate.ready ? "#D7C5B2" : "#E8C98B", background: "#fff" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Medición #{candidate.measurementId} · muestra {candidate.sampleSize}</div><div className="font-extrabold text-sm">{candidate.testedVariable} · cobertura {candidate.confidence}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold shrink-0" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>NO CAUSAL</span></div>
          {candidate.ready ? <><div className="text-[10px] my-2 leading-relaxed" style={{ color: T.choco2 }}>{candidate.primarySignal}</div><div className="grid gap-1.5">{candidate.beats.map((beat) => { const beatTone = tone(beat.dropPp); return <div key={`${candidate.measurementId}-${beat.beat}`} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-xl px-2.5 py-2" style={{ background: "#FFF9F2" }}><div><div className="text-[10px] font-extrabold">{beat.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{beat.startSec}s → {beat.endSec}s</div></div><div className="text-[9px] font-bold">{Math.round(beat.startPct * 100)}% → {Math.round(beat.endPct * 100)}%</div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: beatTone.bg, color: beatTone.fg }}>{beat.dropPp} pp</span></div>; })}</div><div className="mt-3 flex items-center justify-between gap-3"><div className="text-[9px]" style={{ color: T.choco2 }}>Una sola variable · mismo producto, oferta, audiencia y duración</div><BtnAsync small onClick={() => prepare(candidate)}>Preparar diagnóstico</BtnAsync></div></> : <div className="rounded-xl px-2.5 py-2 text-[10px] mt-2" style={{ background: "#FFF2D8", color: "#7A5410" }}>{candidate.reasons[0]}</div>}
        </article>)}</div>}
      </div>

      {center.pending.length > 0 && <div><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Decisión cooperativa · revisión humana</div><div className="grid xl:grid-cols-2 gap-3">{center.pending.map((diagnostic) => <article key={diagnostic.id} className="rounded-2xl border p-3" style={{ borderColor: "#E8C98B", background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#8B5A08" }}>Diagnóstico #{diagnostic.id} · {diagnostic.sourceKind}</div><div className="font-extrabold text-sm">Probar: {diagnostic.testedVariable}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#FBE8C8", color: "#8B5A08" }}>En revisión</span></div><div className="text-[10px] mt-2" style={{ color: T.choco2 }}>{diagnostic.primarySignal}</div><div className="rounded-xl px-2.5 py-2 my-2 text-[10px]" style={{ background: "#fff" }}><b>Hipótesis:</b> {diagnostic.hypothesis}<br /><b>Siguiente prueba:</b> {diagnostic.recommendation}</div><div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolve(diagnostic,"Aprobar")}>Aprobar aprendizaje</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolve(diagnostic,"Devolver")}>Devolver</BtnAsync></div></article>)}</div></div>}

      {center.learnings.length > 0 && <div><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#315B35" }}>Memoria aprobada de MOMOS</div><div className="grid xl:grid-cols-2 gap-3">{center.learnings.slice(0, 8).map((learning) => <article key={learning.id} className="rounded-2xl border p-3" style={{ borderColor: "#B8D3B2", background: "#F5FAF3" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>{learning.platform} · {learning.targetDurationSec}s · {learning.testedVariable}</div><div className="text-xs font-semibold mt-1">{learning.statement}</div><div className="text-[9px] mt-2" style={{ color: T.choco2 }}>Alcance exacto: {learning.audience} · aprobado {learning.approvedAt}</div></article>)}</div></div>}
    </div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este aprendizaje alimentará futuros guiones; nunca cambia campañas, genera contenido o publica por sí solo.</div>
  </section>;
}

function AgencySceneStudio({ db, refrescar }) {
  const studio = useMemo(() => buildAgencySceneStudio(db), [db]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [contractId, setContractId] = useState("");
  const [boardForm, setBoardForm] = useState({
    title: "", channel: "Instagram", format: "Reel", aspectRatio: "9:16", targetDurationSec: 15,
    hook: "", payoff: "", callToAction: "Pedí el tuyo", visualThesis: "", estimatedCostCop: 0,
  });
  const emptyShot = (number = 1) => ({
    shotNumber: number, title: "", purpose: "", durationSec: 3, subject: "", action: "", physics: "",
    environment: "", camera: "", lighting: "", audio: "", onScreenText: "", continuityIn: "",
    continuityOut: "", avoid: "", assetIds: [], estimatedCostCop: 0,
  });
  const [shotForm, setShotForm] = useState(emptyShot());
  const [shotEditing, setShotEditing] = useState(false);
  const [storyboardReviewNote, setStoryboardReviewNote] = useState("");
  const selected = studio.storyboards.find((item) => String(item.id) === String(selectedId)) || null;
  const authorizedAssets = (db.brandMediaAssets || []).filter((asset) => asset.status === "Activo"
    && asset.rightsStatus === "Autorizado" && asset.aiUseAllowed);

  function startStoryboard() {
    const contract = studio.eligibleContracts[0];
    setContractId(contract ? String(contract.id) : "");
    setBoardForm({
      title: contract?.sealedPayload?.creative_direction?.concept || "", channel: "Instagram", format: "Reel",
      aspectRatio: "9:16", targetDurationSec: 15, hook: "", payoff: "",
      callToAction: contract?.sealedPayload?.creative_direction?.call_to_action || "Pedí el tuyo",
      visualThesis: "Producto real, iluminación cálida y lenguaje visual MOMOS.", estimatedCostCop: 0,
    });
    setCreateOpen(true);
  }

  async function createStoryboard() {
    const contract = studio.eligibleContracts.find((item) => String(item.id) === String(contractId));
    if (!contract) throw new Error("Elegí un contrato creativo aprobado.");
    const result = await crearStoryboardAgencia(storyboardPayload(boardForm, contract));
    setCreateOpen(false); setSelectedId(result.storyboard_id);
    toast("ok", result.duplicate ? "Ese storyboard ya estaba sellado." : "Storyboard abierto. Todavía no generó ni gastó nada.");
    await refrescar();
  }

  function newShot() {
    const next = (selected?.readiness?.activeShots?.length || 0) + 1;
    setShotForm(emptyShot(next)); setShotEditing(true);
  }

  function editShot(shot) {
    const payload = shot.payload || {};
    setShotForm({
      shotNumber: shot.shotNumber, title: shot.title, purpose: shot.purpose, durationSec: shot.durationSec,
      subject: payload.subject || "", action: payload.action || "", physics: payload.physics || "",
      environment: payload.environment || "", camera: payload.camera || "", lighting: payload.lighting || "",
      audio: payload.audio || "", onScreenText: payload.on_screen_text || "", continuityIn: payload.continuity_in || "",
      continuityOut: payload.continuity_out || "", avoid: payload.avoid || "", assetIds: shot.assetIds || [],
      estimatedCostCop: shot.estimatedCostCop || 0,
    });
    setShotEditing(true);
  }

  async function saveShot() {
    if (!selected) return;
    const result = await guardarTomaStoryboard(shotPayload(shotForm, selected));
    setShotEditing(false);
    toast("ok", result.duplicate ? "La toma ya estaba guardada." : `Toma ${shotForm.shotNumber} versionada y sellada.`);
    await refrescar();
  }

  async function submitStoryboard() {
    if (!selected) return;
    await enviarStoryboardRevision(selected.id);
    toast("ok", "Storyboard enviado a revisión humana. No inició generación.");
    await refrescar();
  }

  async function resolveStoryboard(decision) {
    if (!selected) return;
    const note = storyboardReviewNote.trim();
    if (!note) { toast("alert", decision === "Aprobar" ? "Escribí qué verificaste antes de aprobar la dirección." : "Escribí qué toma o continuidad debe corregirse."); return; }
    await resolverStoryboardAgencia(selected.id, decision, note);
    setStoryboardReviewNote("");
    toast("ok", decision === "Aprobar" ? "Storyboard aprobado. Aún no llamó a ningún proveedor." : "Storyboard devuelto a edición con trazabilidad.");
    await refrescar();
  }

  const statusTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisión" ? { bg: "#E5EEF7", fg: "#315A7D" } : { bg: "#FFF2D8", fg: "#7A5410" };
  const money = (value) => fmt(Math.round(Number(value || 0)));

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#315A57,#47766C)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.15)" }}>🎬</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Contrato aprobado → dirección por tomas</div><div className="display text-xl font-semibold">Estudio creativo MOMOS</div><div className="text-xs opacity-85 max-w-2xl">Guion visual, retención, física, continuidad, activos y costo quedan revisables antes de llamar a Kling, Higgsfield o cualquier motor.</div></div></div>
      <div className="flex items-center gap-2"><div className="grid grid-cols-3 gap-2">{[["Borrador",studio.summary.drafting],["Revisión",studio.summary.reviewing],["Tomas",studio.summary.shots]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[68px] text-center" style={{ background: "rgba(255,255,255,.13)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div><Btn small kind="soft" onClick={startStoryboard} disabled={!db.agencySceneStudioReady || studio.eligibleContracts.length === 0}>＋ Nuevo storyboard</Btn></div>
    </div>
    {!db.agencySceneStudioReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>estudio-escenas-v1.sql</code> después de la Mesa de Agencia. El Estudio permanecerá apagado hasta que el servidor confirme el contrato.</div>
      : studio.storyboards.length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay storyboards.</b> Aprobá primero un contrato en la Mesa cooperativa; luego convertí ese acuerdo en tomas verificables.</div>
        : <div className="p-3 grid lg:grid-cols-2 gap-2">{studio.storyboards.slice(0, 8).map((board) => { const tone = statusTone(board.status); return <button type="button" key={board.id} onClick={() => setSelectedId(board.id)} className="text-left rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: board.readiness.ready ? "#B8D3B2" : T.border, background: "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold tracking-wider" style={{ color: T.coral }}>Storyboard #{board.id} · V{board.version}</div><div className="font-extrabold text-sm">{board.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{board.status}</span></div>
          <div className="flex flex-wrap gap-1.5 my-2"><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#E5EEF7" }}>{board.channel} · {board.format}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{board.aspectRatio} · {board.targetDurationSec}s</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F3D7DC" }}>{board.readiness.activeShots.length} toma(s)</span></div>
          <div className="text-[10px]" style={{ color: T.choco2 }}>{board.readiness.ready ? `Listo para revisión · ${money(board.readiness.estimatedCostCop)} estimados` : board.readiness.reasons[0]}</div>
        </button>; })}</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Separación de responsabilidades: el Estudio diseña y aprueba; el siguiente hito autorizará qué motor puede ejecutar cada toma y con qué tope.</div>

    {createOpen && <Modal title="Abrir storyboard desde contrato aprobado" onClose={() => setCreateOpen(false)} wide topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: T.vainilla }}><b>Primero fijamos la película en papel.</b> Hook, payoff y CTA se sellan aquí; ninguna llamada externa ocurre al guardar.</div>
      <Field label="Contrato creativo"><select className={inputCls} style={inputStyle} value={contractId} onChange={(event) => setContractId(event.target.value)}><option value="">Elegí un contrato…</option>{studio.eligibleContracts.map((contract) => <option key={contract.id} value={contract.id}>Contrato #{contract.id} · {contract.sealedPayload?.creative_direction?.concept || `Versión ${contract.version}`}</option>)}</select></Field>
      <Field label="Nombre de la pieza"><Input value={boardForm.title} onChange={(event) => setBoardForm({ ...boardForm, title: event.target.value })} /></Field>
      <div className="grid sm:grid-cols-4 gap-2"><Field label="Canal"><Select options={STORYBOARD_CHANNELS} value={boardForm.channel} onChange={(event) => setBoardForm({ ...boardForm, channel: event.target.value })} /></Field><Field label="Formato"><Select options={STORYBOARD_FORMATS} value={boardForm.format} onChange={(event) => setBoardForm({ ...boardForm, format: event.target.value })} /></Field><Field label="Proporción"><Select options={STORYBOARD_ASPECT_RATIOS} value={boardForm.aspectRatio} onChange={(event) => setBoardForm({ ...boardForm, aspectRatio: event.target.value })} /></Field><Field label="Duración (s)"><Input type="number" min="1" max="600" value={boardForm.targetDurationSec} onChange={(event) => setBoardForm({ ...boardForm, targetDurationSec: event.target.value })} /></Field></div>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Hook · promesa abierta"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.hook} onChange={(event) => setBoardForm({ ...boardForm, hook: event.target.value })} /></Field><Field label="Payoff · respuesta"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.payoff} onChange={(event) => setBoardForm({ ...boardForm, payoff: event.target.value })} /></Field></div>
      <Field label="Llamado a la acción"><Input value={boardForm.callToAction} onChange={(event) => setBoardForm({ ...boardForm, callToAction: event.target.value })} /></Field>
      <Field label="Tesis visual"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.visualThesis} onChange={(event) => setBoardForm({ ...boardForm, visualThesis: event.target.value })} /></Field>
      <Field label="Costo total estimado (COP, informativo)"><Input type="number" min="0" value={boardForm.estimatedCostCop} onChange={(event) => setBoardForm({ ...boardForm, estimatedCostCop: event.target.value })} /></Field>
      <div className="flex gap-2"><BtnAsync onClick={createStoryboard} disabled={!contractId || boardForm.title.trim().length < 3 || boardForm.hook.trim().length < 2 || boardForm.payoff.trim().length < 2 || boardForm.callToAction.trim().length < 2}>Sellar storyboard</BtnAsync><Btn kind="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Btn></div>
    </Modal>}

    {selected && <Modal title={`Storyboard #${selected.id} · ${selected.title}`} onClose={() => { setSelectedId(null); setShotEditing(false); }} wide topLayer>
      <div className="grid lg:grid-cols-[1fr_300px] gap-4">
        <div><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{selected.channel} · {selected.format} · {selected.aspectRatio}</div><div className="display text-lg font-semibold">{selected.targetDurationSec}s de historia dirigida</div></div>{selected.status === "Borrador" && <Btn small onClick={newShot}>＋ Agregar toma</Btn>}</div>
          <div className="space-y-2">{selected.readiness.activeShots.length === 0 ? <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: T.border, color: T.choco2 }}>Empezá con la toma 1. Cada toma necesita sujeto, acción, cámara y una salida de continuidad para que la siguiente escena sepa dónde retomar.</div> : selected.readiness.activeShots.map((shot) => <button type="button" key={shot.id} onClick={() => selected.status === "Borrador" && editShot(shot)} className="w-full text-left rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot.shotNumber} · R{shot.revision} · {shot.durationSec}s</div><div className="font-extrabold text-sm">{shot.title}</div></div><span className="text-[10px] font-bold">{money(shot.estimatedCostCop)}</span></div><div className="text-[11px] mt-1" style={{ color: T.choco2 }}>{shot.purpose}</div><div className="rounded-xl px-2 py-1.5 mt-2 text-[10px]" style={{ background: "#E5EEF7", color: "#315A7D" }}>{shot.payload?.camera} → {shot.payload?.continuity_out}</div></button>)}</div>
        </div>
        <aside><div className="rounded-3xl p-4 border mb-3" style={{ borderColor: selected.readiness.ready ? "#B8D3B2" : "#E8C98B", background: selected.readiness.ready ? "#F4FAF2" : "#FFF8E8" }}><div className="text-[9px] uppercase font-extrabold">Control antes de generar</div><div className="display text-xl font-semibold">{selected.readiness.totalDurationSec.toFixed(1)} / {selected.targetDurationSec}s</div><div className="text-xs mb-2">{selected.readiness.activeShots.length} toma(s) · {money(selected.readiness.estimatedCostCop)}</div>{selected.readiness.reasons.map((reason) => <div key={reason} className="text-[10px] mb-1">• {reason}</div>)}</div>
          <div className="rounded-2xl px-3 py-2 mb-3 text-[10px]" style={{ background: T.vainilla }}><b>Hook:</b> {selected.creativeBrief?.hook}<br /><b>Payoff:</b> {selected.creativeBrief?.payoff}<br /><b>CTA:</b> {selected.creativeBrief?.call_to_action}</div>
          {selected.status === "Borrador" && <BtnAsync onClick={submitStoryboard} disabled={!selected.readiness.ready}>Enviar a revisión humana</BtnAsync>}
          {selected.status === "En revisión" && <div className="flex flex-col gap-2"><Input aria-label="Nota de revisión del storyboard" value={storyboardReviewNote} onChange={(event) => setStoryboardReviewNote(event.target.value)} placeholder="Qué verificaste o qué debe corregirse" /><BtnAsync confirmar disabled={!storyboardReviewNote.trim()} onClick={() => resolveStoryboard("Aprobar")}>Aprobar dirección</BtnAsync><BtnAsync kind="ghost" disabled={!storyboardReviewNote.trim()} onClick={() => resolveStoryboard("Devolver")}>Devolver a edición</BtnAsync></div>}
          {selected.status === "Aprobado" && <div className="rounded-2xl px-3 py-3 text-xs font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Dirección aprobada y sellada. No se ha generado ni publicado ninguna toma.</div>}
        </aside>
      </div>
      {shotEditing && selected.status === "Borrador" && <div className="rounded-3xl border p-4 mt-5" style={{ borderColor: "#D7C5B2", background: "#FFFAF5" }}><div className="flex items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Dirección verificable</div><div className="display text-lg font-semibold">Toma {shotForm.shotNumber}</div></div><Btn small kind="ghost" onClick={() => setShotEditing(false)}>Cerrar editor</Btn></div>
        <div className="grid sm:grid-cols-3 gap-2"><Field label="Número"><Input type="number" min="1" value={shotForm.shotNumber} onChange={(event) => setShotForm({ ...shotForm, shotNumber: event.target.value })} /></Field><Field label="Duración (s)"><Input type="number" min="0.1" step="0.1" value={shotForm.durationSec} onChange={(event) => setShotForm({ ...shotForm, durationSec: event.target.value })} /></Field><Field label="Costo estimado"><Input type="number" min="0" value={shotForm.estimatedCostCop} onChange={(event) => setShotForm({ ...shotForm, estimatedCostCop: event.target.value })} /></Field></div>
        <div className="grid sm:grid-cols-2 gap-2"><Field label="Título"><Input value={shotForm.title} onChange={(event) => setShotForm({ ...shotForm, title: event.target.value })} /></Field><Field label="Propósito"><Input value={shotForm.purpose} onChange={(event) => setShotForm({ ...shotForm, purpose: event.target.value })} /></Field><Field label="Sujeto"><Input value={shotForm.subject} onChange={(event) => setShotForm({ ...shotForm, subject: event.target.value })} /></Field><Field label="Acción"><Input value={shotForm.action} onChange={(event) => setShotForm({ ...shotForm, action: event.target.value })} /></Field><Field label="Física y movimiento"><Input value={shotForm.physics} onChange={(event) => setShotForm({ ...shotForm, physics: event.target.value })} /></Field><Field label="Entorno"><Input value={shotForm.environment} onChange={(event) => setShotForm({ ...shotForm, environment: event.target.value })} /></Field><Field label="Cámara"><Input value={shotForm.camera} onChange={(event) => setShotForm({ ...shotForm, camera: event.target.value })} /></Field><Field label="Iluminación"><Input value={shotForm.lighting} onChange={(event) => setShotForm({ ...shotForm, lighting: event.target.value })} /></Field><Field label="Audio"><Input value={shotForm.audio} onChange={(event) => setShotForm({ ...shotForm, audio: event.target.value })} /></Field><Field label="Texto en pantalla"><Input value={shotForm.onScreenText} onChange={(event) => setShotForm({ ...shotForm, onScreenText: event.target.value })} /></Field><Field label="Continuidad de entrada"><Input value={shotForm.continuityIn} onChange={(event) => setShotForm({ ...shotForm, continuityIn: event.target.value })} /></Field><Field label="Continuidad de salida"><Input value={shotForm.continuityOut} onChange={(event) => setShotForm({ ...shotForm, continuityOut: event.target.value })} /></Field></div>
        <Field label="Evitar"><Input value={shotForm.avoid} onChange={(event) => setShotForm({ ...shotForm, avoid: event.target.value })} placeholder="Deformaciones, texto ilegible, producto distinto…" /></Field>
        {authorizedAssets.length > 0 && <Field label="Referencias de marca autorizadas"><div className="flex flex-wrap gap-2">{authorizedAssets.slice(0, 20).map((asset) => { const checked = shotForm.assetIds.includes(Number(asset.id)); return <label key={asset.id} className="rounded-full px-3 py-2 text-[10px] font-bold cursor-pointer" style={{ background: checked ? "#DDEBD9" : T.vainilla }}><input type="checkbox" className="mr-1" checked={checked} onChange={() => setShotForm({ ...shotForm, assetIds: checked ? shotForm.assetIds.filter((id) => id !== Number(asset.id)) : [...shotForm.assetIds, Number(asset.id)] })} />{asset.name}</label>; })}</div></Field>}
        <BtnAsync onClick={saveShot} disabled={shotForm.title.trim().length < 2 || shotForm.purpose.trim().length < 2 || shotForm.subject.trim().length < 2 || shotForm.action.trim().length < 2 || shotForm.camera.trim().length < 2 || shotForm.continuityOut.trim().length < 2}>Guardar revisión de toma</BtnAsync>
      </div>}
    </Modal>}
  </div>;
}

function AgencyMotionExperience({ db, refrescar }) {
  const center = useMemo(() => buildAgencyMotionCenter(db), [db]);
  const [boardId, setBoardId] = useState("");
  const [selections, setSelections] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const board = center.eligibleStoryboards.find((item) => String(item.id) === String(boardId)) || null;
  const draft = useMemo(() => board
    ? buildMotionPlanDraft(board, db.agencyStoryboardShots || [], selections)
    : null, [board, db.agencyStoryboardShots, selections]);

  async function prepare() {
    if (!db.agencyMotionReady) throw new Error("Aplicá la migración 36 de Dirección de motion.");
    if (!draft?.ready) throw new Error(draft?.reasons?.[0] || "La dirección de motion todavía no está lista.");
    const result = await prepararPlanMotion(motionPlanPayload(draft, "MOMO OPS Motion Director"));
    setBoardId(""); setSelections({});
    toast("ok", result.duplicate
      ? "Esa dirección ya estaba sellada."
      : "Dirección de cámara y luz preparada para revisión. No generó, gastó ni publicó.");
    await refrescar();
  }

  async function resolve(plan, decision) {
    const note = String(reviewNotes[plan.id] || "").trim();
    if (!note) throw new Error(decision === "Aprobar"
      ? "Escribí qué verificaste antes de aprobar la dirección."
      : "Escribí qué debe corregirse por toma.");
    await resolverPlanMotion(plan.id, decision, note);
    setReviewNotes((current) => { const next = { ...current }; delete next[plan.id]; return next; });
    toast("ok", decision === "Aprobar"
      ? "Motion aprobado: el Enrutador ya puede asignar motores y topes. Aún no se generó nada."
      : "Plan devuelto con corrección trazable.");
    await refrescar();
  }

  const planTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisión" ? { bg: "#FFF0CE", fg: "#8B5A08" } : { bg: "#F3D7DC", fg: "#8E4B5A" };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#7C3F2D,#B86445)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.15)" }}>🎥</div><div>
        <div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Storyboard → cámara, luz, física y continuidad</div>
        <div className="display text-xl font-semibold">Dirección de motion MOMOS</div>
        <div className="text-xs opacity-85 max-w-2xl">Define por qué se mueve la cámara, cómo responde la materia y qué debe conservar el corte. El humano elige una propuesta por toma antes de permitir el Enrutador.</div>
      </div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Por dirigir",center.summary.eligible],["Revisión",center.summary.reviewing],["Aprobados",center.summary.approved],["Aprendizajes",center.summary.observations]].map(([label,value]) => <div key={label} className="rounded-2xl px-2.5 py-2 min-w-[64px] text-center" style={{ background: "rgba(255,255,255,.13)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMotionReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>experiencia-motion-v1.sql</code> después del Hito 35. Hasta entonces el Enrutador no recibirá recetas de cámara aprobadas.</div> : <>
      {center.eligibleStoryboards.length > 0 && <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-end gap-2 mb-3"><Field label="Storyboard aprobado sin motion"><select className={inputCls} style={{ ...inputStyle, minWidth: 300 }} value={boardId} onChange={(event) => { setBoardId(event.target.value); setSelections({}); }}><option value="">Elegí una pieza…</option>{center.eligibleStoryboards.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title} · {item.channel}</option>)}</select></Field>{draft && <div className="pb-3 text-[10px] font-bold" style={{ color: draft.ready ? "#315B35" : "#A03B2A" }}>{draft.ready ? `● ${draft.shotRecipes.length} tomas cubiertas · $0 comprometidos` : `× ${draft.reasons[0]}`}</div>}</div>
        {draft && <div className="space-y-3">{draft.shotRecipes.map(({ shot, proposals, selected }) => <article key={shot.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot.shotNumber} · {selected?.intent?.narrativeJob}</div><div className="font-extrabold text-sm">{shot.title}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>Una intención · un movimiento principal · una fuente de luz motivada.</div></div>
            <div className="flex flex-wrap gap-2">{proposals.map((proposal) => <button type="button" key={proposal.proposalKey} onClick={() => setSelections((current) => ({ ...current, [shot.id]: proposal.proposalKey }))} className="rounded-xl border px-3 py-2 text-left transition" style={{ borderColor: proposal.selected ? T.coral : T.border, background: proposal.selected ? "#F8E0D8" : "#fff" }}><div className="text-[10px] font-extrabold">{proposal.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{proposal.cameraPath.rigFeel} · {proposal.handheldProfile.mode}</div></button>)}</div>
          </div>
          {selected && <div className="grid md:grid-cols-4 gap-2 mt-3 text-[10px]"><div className="rounded-xl p-2.5" style={{ background: "#F5E8D2" }}><b>Cámara</b><br />{selected.cameraPath.primaryMove}<br /><span style={{ color: T.choco2 }}>Inercia {selected.cameraPath.acceleration}; {selected.cameraPath.settle}.</span></div><div className="rounded-xl p-2.5" style={{ background: "#F6E6D9" }}><b>Luz y sombra</b><br />{selected.lightingMap.motivatedSource}<br /><span style={{ color: T.choco2 }}>{selected.lightingMap.shadowBehavior}</span></div><div className="rounded-xl p-2.5" style={{ background: "#E7EFE5" }}><b>Física</b><br />{selected.physics.contact}<br /><span style={{ color: T.choco2 }}>{selected.physics.weightResistance}</span></div><div className="rounded-xl p-2.5" style={{ background: "#E7EDF2" }}><b>Siguiente corte</b><br />{selected.transitionToNext.type}<br /><span style={{ color: T.choco2 }}>{selected.transitionToNext.intentionalChange}</span></div></div>}
        </article>)}<div className="rounded-2xl px-3 py-3 flex flex-wrap items-center justify-between gap-3" style={{ background: T.vainilla }}><div className="text-xs"><b>{draft.grammarPrimary}</b>{draft.grammarSecondary !== draft.grammarPrimary ? ` + ${draft.grammarSecondary}` : ""}<div className="text-[9px]" style={{ color: T.choco2 }}>Costo preliminar informativo {fmt(draft.estimatedPreviewCostCop)} · preparar cuesta $0.</div></div><BtnAsync onClick={prepare} disabled={!draft.ready}>Sellar dirección para revisión</BtnAsync></div></div>}
      </div>}
      <div className="p-3 grid lg:grid-cols-2 gap-2">{center.plans.slice(0, 8).map((plan) => { const tone = planTone(plan.status); const note = reviewNotes[plan.id] || ""; return <article key={plan.id} className="rounded-2xl border p-3" style={{ borderColor: plan.status === "En revisión" ? "#E8C98B" : T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Motion #{plan.id} · V{plan.version}</div><div className="font-extrabold text-sm">{plan.storyboard?.title || `Storyboard #${plan.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{plan.status}</span></div><div className="flex flex-wrap gap-1.5 my-2">{plan.recipes.map((recipe) => <span key={recipe.id} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F5E8D2" }}>T{recipe.shotNumber} · {recipe.selectedRecipe?.intent?.narrative_job || recipe.selectedKey}</span>)}</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>{plan.grammarPrimary} · huella {plan.fingerprint?.slice(0, 8)} · {plan.recipes.length} receta(s)</div>{plan.status === "En revisión" && <div className="space-y-2"><textarea className={inputCls} style={{ ...inputStyle, minHeight: 72 }} value={note} onChange={(event) => setReviewNotes((current) => ({ ...current, [plan.id]: event.target.value }))} placeholder="Qué verificaste o qué debe corregirse por toma…" aria-label={`Nota de revisión motion ${plan.id}`} /><div className="flex gap-2"><BtnAsync small confirmar disabled={!note.trim()} onClick={() => resolve(plan,"Aprobar")}>Aprobar motion</BtnAsync><BtnAsync small kind="ghost" disabled={!note.trim()} onClick={() => resolve(plan,"Devolver")}>Devolver</BtnAsync></div></div>}{plan.status === "Aprobado" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Enrutador habilitado · generación y publicación siguen bloqueadas</div>}</article>; })}{center.plans.length === 0 && center.eligibleStoryboards.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Sin piezas pendientes.</b> Cuando el Estudio apruebe un storyboard aparecerá aquí.</div>}</div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Contrato seguro: aprobar motion cuesta $0 y no llama motores. El Enrutador consume únicamente la receta seleccionada y sellada de cada toma.</div>
  </section>;
}

function AgencySceneRouter({ db, refrescar }) {
  const center = useMemo(() => buildAgencySceneRouter(db), [db]);
  const [boardId, setBoardId] = useState("");
  const [overrides, setOverrides] = useState({});
  const board = center.eligibleStoryboards.find((item) => String(item.id) === String(boardId)) || null;
  const draft = useMemo(() => board
    ? buildSceneRoutingDraft(board, db.agencyStoryboardShots || [], db, overrides)
    : null, [board, db, overrides]);

  function patchRoute(shotId, values) {
    setOverrides((current) => ({ ...current, [shotId]: { ...(current[shotId] || {}), ...values } }));
  }

  async function prepareRoutes() {
    if (!db.agencySceneRouterReady) throw new Error("Aplicá la migración 32 del Enrutador de escenas.");
    if (!draft?.ready) throw new Error(draft?.reasons?.[0] || "El plan no está listo.");
    const result = await prepararEnrutamientoEscenas(sceneRoutingPayload(draft, "MOMO OPS Router"));
    setBoardId(""); setOverrides({});
    toast("ok", result.duplicate ? "Ese enrutamiento ya estaba sellado." : "Ruta preparada. Ningún motor fue llamado todavía.");
    await refrescar();
  }

  async function resolvePlan(plan, decision) {
    const note = decision === "Descartar"
      ? (window.prompt("¿Por qué descartamos este enrutamiento?", "Se ajustará la dirección o el costo") || "")
      : "Autorización humana de motores y topes por escena";
    if (!note) return;
    const result = await resolverEnrutamientoEscenas(plan.id, decision, note);
    toast("ok", decision === "Autorizar"
      ? `${result.job_ids?.length || 0} toma(s) autorizadas para la cola privada. Aún no se publicó nada.`
      : "Enrutamiento descartado con trazabilidad.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#243D37,#355E53)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Motion aprobado → motor controlado</div><div className="display text-xl font-semibold">Enrutador de escenas MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Consume la cámara y luz ya aprobadas, elige el motor por capacidad y sella costo y riesgo por toma. Los workers ejecutan después; publicar sigue siendo otro paso.</div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Por autorizar",center.summary.prepared],["Autorizados",center.summary.authorized],["Trabajos",center.summary.jobs]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[74px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencySceneRouterReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>enrutador-escenas-v1.sql</code>. Hasta entonces MOMO OPS no creará trabajos desde storyboards.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-end gap-2"><Field label="Storyboard + motion aprobados"><select className={inputCls} style={{ ...inputStyle, minWidth: 280 }} value={boardId} onChange={(event) => { setBoardId(event.target.value); setOverrides({}); }}><option value="">Elegí una pieza dirigida sin enrutar…</option>{center.eligibleStoryboards.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title} · {item.channel}</option>)}</select></Field>{draft && <div className="pb-3 text-[10px] font-bold" style={{ color: draft.operational ? "#315B35" : "#9A5B16" }}>{draft.operational ? "● Motores disponibles ahora" : `● Plan documentable; ${draft.operationalReasons[0] || "conector no disponible"}`}</div>}</div>
        {draft && <div className="space-y-2 mt-1">{draft.routes.map((route) => <article key={route.shotId} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
          <div className="grid lg:grid-cols-[1fr_160px_140px_140px] gap-2 items-end"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {route.shotNumber} · riesgo {route.riskLevel}</div><div className="font-extrabold text-sm">{route.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{route.capability} · {route.rationale}</div></div><Field label="Motor"><Select options={SCENE_ROUTE_PROVIDERS} value={route.provider} onChange={(event) => patchRoute(route.shotId, { provider: event.target.value })} /></Field><Field label="Estimado COP"><Input type="number" min="1" value={route.estimatedCostCop || ""} onChange={(event) => patchRoute(route.shotId, { estimatedCostCop: event.target.value })} /></Field><Field label="Tope COP"><Input type="number" min="1" value={route.maxCostCop || ""} onChange={(event) => patchRoute(route.shotId, { maxCostCop: event.target.value })} /></Field></div>
        </article>)}<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-3" style={{ background: T.vainilla }}><div className="text-xs"><b>{draft.routes.length} toma(s)</b> · estimado {fmt(draft.totalEstimatedCostCop)} · tope {fmt(draft.totalCostCapCop)}{draft.reasons.map((reason) => <div key={reason} className="text-red-700">× {reason}</div>)}</div><BtnAsync onClick={prepareRoutes} disabled={!draft.ready}>Sellar ruta multimotor</BtnAsync></div></div>}
      </div>
      <div className="p-3 grid lg:grid-cols-2 gap-2">{center.plans.slice(0, 8).map((plan) => { const routes = plan.snapshot?.routes || []; const tone = statusTone(plan.status); return <article key={plan.id} className="rounded-2xl border p-3" style={{ borderColor: plan.status === "Preparado" ? "#E8C98B" : T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Ruta #{plan.id} · V{plan.version}</div><div className="font-extrabold text-sm">{plan.storyboard?.title || `Storyboard #${plan.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{plan.status}</span></div><div className="flex flex-wrap gap-1 my-2">{routes.map((route) => <span key={route.shot_id} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: route.provider === "Kling" ? "#E5EEF7" : "#F3D7DC" }}>T{route.shot_number} · {route.provider}</span>)}</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>Estimado {fmt(plan.totalEstimatedCostCop)} · tope humano {fmt(plan.totalCostCapCop)} · huella {plan.fingerprint?.slice(0, 8)}</div>{plan.status === "Preparado" && <div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolvePlan(plan, "Autorizar")}>Autorizar {routes.length} toma(s)</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolvePlan(plan, "Descartar")}>Descartar</BtnAsync></div>}{plan.status === "Autorizado" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ {plan.jobIds.length} trabajo(s) en colas privadas · publicación: bloqueada</div>}</article>; })}{center.plans.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay rutas selladas.</b> Aprobá un storyboard y asigná su motor por toma.</div>}</div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Arquitectura segura: preparar no gasta; autorizar crea la cola atómicamente; el worker genera; Revisión Creativa decide; Distribución publica por separado.</div>
  </div>;
}

function AgencyQualityControl({ db, refrescar }) {
  const center = useMemo(() => buildAgencyQualityCenter(db), [db]);
  const exportCenter = useMemo(() => buildPostproductionExportCenter(db), [db]);
  const exportWorker = (db.agencyPostproductionWorkers || [])[0] || null;
  const [reviewJob, setReviewJob] = useState(null);
  const [scores, setScores] = useState(() => Object.fromEntries(AGENCY_QUALITY_CRITERIA.map(({ key }) => [key, 2])));
  const [failureType, setFailureType] = useState("Fallo técnico");
  const [note, setNote] = useState("");
  const [continuity, setContinuity] = useState("");
  const [audioByPackage, setAudioByPackage] = useState({});
  const today = new Date().toISOString().slice(0, 10);
  const audioAssets = useMemo(() => (db.brandMediaAssets || []).filter((asset) => asset.mediaType === "Audio" && asset.status === "Activo"
    && ["Propio", "Autorizado"].includes(asset.rightsStatus) && (!asset.rightsExpiresAt || asset.rightsExpiresAt >= today)
    && ["audio/mpeg", "audio/mp4", "audio/wav"].includes(asset.mimeType) && asset.storagePath && /^[0-9a-f]{64}$/i.test(asset.contentHash || "")
    && Number(asset.sizeBytes) > 0 && Number(asset.durationSeconds) > 0 && Number(asset.durationSeconds) <= 1800), [db.brandMediaAssets, today]);
  const outputAsset = reviewJob ? (db.brandMediaAssets || []).find((item) => String(item.id) === String(reviewJob.outputAssetId)) : null;
  const rightsValid = Boolean(outputAsset && outputAsset.status === "Activo" && outputAsset.rightsStatus === "Autorizado");
  const evaluation = useMemo(() => evaluateSceneQuality(scores, rightsValid), [scores, rightsValid]);

  function openReview(job) {
    const shot = (db.agencyStoryboardShots || []).find((item) => String(item.id) === String(job.outputSpec?.storyboard_shot_id));
    setReviewJob(job); setScores(Object.fromEntries(AGENCY_QUALITY_CRITERIA.map(({ key }) => [key, 2])));
    setFailureType("Fallo técnico"); setNote("");
    setContinuity(shot?.payload?.continuity_out ? `La salida conserva: ${shot.payload.continuity_out}` : "Entrada y salida comparadas contra el storyboard");
  }

  async function saveQualityReview() {
    const payload = sceneQualityReviewPayload(reviewJob, scores, {
      rightsValid, failureType, reviewNote: note || (evaluation.approved ? "Producto, marca, física y continuidad verificados" : "La toma requiere una nueva versión"),
      continuityObservation: continuity, findings: evaluation.reasons,
    });
    const result = await registrarRevisionCalidadEscena(payload);
    setReviewJob(null);
    toast(result.status === "Aprobada" ? "ok" : "alert", result.status === "Aprobada"
      ? `Toma aprobada para postproducción · ${result.score_total}/22.`
      : `Toma clasificada como ${result.failure_type}; no entrará al corte.`);
    await refrescar();
  }

  async function resolveAgentReview(review, decision) {
    const failure = decision === "Aprobar" ? "Pendiente" : "Fallo técnico";
    const resolution = window.prompt(decision === "Aprobar" ? "¿Qué verificaste antes de aprobar?" : "¿Qué debe corregirse?",
      decision === "Aprobar" ? "Producto, física, luz y continuidad verificados" : "Corregir la salida antes de regenerar") || "";
    if (!resolution) return;
    await resolverRevisionCalidadEscena(review.id, decision, failure, resolution);
    toast("ok", decision === "Aprobar" ? "Control del agente aprobado por humano." : "Hallazgo del agente clasificado y devuelto.");
    await refrescar();
  }

  const packageCandidates = useMemo(() => (db.agencySceneRoutingPlans || []).filter((plan) => plan.status === "Autorizado").map((plan) => {
    const storyboard = (db.agencyStoryboards || []).find((item) => String(item.id) === String(plan.storyboardId));
    const activeShots = (db.agencyStoryboardShots || []).filter((shot) => String(shot.storyboardId) === String(plan.storyboardId) && shot.status === "Vigente");
    const approved = center.approved.filter((review) => String(review.routingPlanId) === String(plan.id));
    const alreadyPackaged = center.packages.some((item) => String(item.routingPlanId) === String(plan.id) && !["Devuelto", "Anulado"].includes(item.status));
    return { plan, storyboard, activeShots, approved, ready: Boolean(storyboard) && activeShots.length > 0 && approved.length === activeShots.length && !alreadyPackaged };
  }).filter((item) => item.ready), [db.agencySceneRoutingPlans, db.agencyStoryboards, db.agencyStoryboardShots, center.approved, center.packages]);

  async function preparePackage(candidate) {
    const payload = postproductionPackagePayload(candidate.storyboard, candidate.plan, candidate.approved);
    const result = await prepararPaquetePostproduccion(payload);
    toast("ok", `${candidate.approved.length} toma(s) selladas para postproducción. Falta aprobación del corte.`);
    if (result.duplicate) toast("alert", "Ese paquete ya existía; no se duplicó.");
    await refrescar();
  }

  async function resolvePackage(item, decision) {
    const noteText = window.prompt(decision === "Aprobar" ? "¿Qué validaste en el corte final?" : "¿Qué debe corregir postproducción?",
      decision === "Aprobar" ? "Orden, audio, subtítulos, color y continuidad verificados" : "Ajustar el corte antes de aprobar") || "";
    if (!noteText) return;
    await resolverPaquetePostproduccion(item.id, decision, noteText);
    toast("ok", decision === "Aprobar" ? "Corte aprobado. Publicación y pauta siguen bloqueadas." : "Corte devuelto con instrucciones trazables.");
    await refrescar();
  }

  async function authorizeExport(pkg) {
    const selectedId = audioByPackage[String(pkg.id)] || "";
    const audioAsset = audioAssetsForPackage(pkg).find((asset) => String(asset.id) === String(selectedId)) || null;
    const payload = postproductionExportPayload(pkg, { audioAsset });
    const result = await autorizarExportacionPostproduccion(payload);
    toast("ok", result.duplicate
      ? "La exportación ya estaba autorizada; no se duplicó."
      : `Máster autorizado con audio ${audioAsset ? `de Biblioteca · ${audioAsset.name}` : "original de las tomas"}. Aún no existe archivo ni publicación.`);
    await refrescar();
  }

  function audioAssetsForPackage(pkg) {
    const channel = String(pkg.storyboard?.channel || pkg.snapshot?.export_spec?.channel || "").trim().toLowerCase();
    return audioAssets.filter((asset) => {
      const allowed = Array.isArray(asset.allowedChannels) ? asset.allowedChannels.map((item) => String(item).trim().toLowerCase()) : [];
      return allowed.length === 0 || allowed.includes(channel) || allowed.includes("todos") || allowed.includes("all");
    });
  }

  async function resolveMaster(item, decision) {
    const evaluation = evaluatePostproductionMaster(item, item.outputAsset);
    if (decision === "Aprobar" && !evaluation.approved) {
      toast("alert", evaluation.reasons[0] || "El máster no supera el control técnico.");
      return;
    }
    const suggested = decision === "Aprobar"
      ? "Resolución, FPS, audio, color, peso y continuidad verificados"
      : "Corregir el máster antes de enviarlo a Distribución";
    const noteText = window.prompt(decision === "Aprobar" ? "¿Qué verificaste en el máster?" : "¿Qué debe corregirse?", suggested) || "";
    if (noteText.trim().length < 5) return;
    await resolverControlMasterPostproduccion(item.id, decision, noteText.trim());
    toast("ok", decision === "Aprobar" ? "Máster aprobado. Distribución y publicación siguen siendo pasos separados." : "Máster rechazado con corrección trazable.");
    await refrescar();
  }

  async function retryExport(item) {
    const noteText = window.prompt("¿Por qué es seguro reintentar este fallo definitivo?", "FFmpeg no produjo archivo; reintentar con el mismo contrato sellado") || "";
    if (noteText.trim().length < 5) return;
    await reintentarExportacionPostproduccion(item.id, noteText.trim());
    toast("ok", "Reintento autorizado. Los resultados inciertos nunca se reenvían.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#5B2947,#7A3D5D)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Salida generada → corte verificable</div><div className="display text-xl font-semibold">Calidad y postproducción MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Protege producto, marca, física, cámara, luz y continuidad. Una falla crítica no se promedia y ningún corte autoriza publicación.</div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Por revisar",center.summary.waiting + center.summary.pending],["Aprobadas",center.summary.approved],["Cortes",center.summary.packagesApproved],["Másters",exportCenter.summary.approved]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[70px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyQualityReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>calidad-postproduccion-v1.sql</code>. La generación sigue disponible, pero ninguna salida se declarará lista para corte.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Control por toma</div>
        <div className="grid lg:grid-cols-2 gap-2">{center.eligibleJobs.map((job) => { const shot = (db.agencyStoryboardShots || []).find((item) => String(item.id) === String(job.outputSpec?.storyboard_shot_id)); return <article key={job.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#F3D7DC" }}>◉</div><div className="flex-1 min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot?.shotNumber || "?"} · {job.provider}</div><div className="font-extrabold text-sm truncate">{shot?.title || job.operation}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Salida #{job.outputAssetId} · revisión creativa aprobada</div></div><Btn small onClick={() => openReview(job)}>Evaluar toma</Btn></article>; })}
          {center.eligibleJobs.length === 0 && center.pending.length === 0 && <div className="text-sm p-2" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay salidas esperando control.</b> Aparecerán cuando el motor complete una toma y pase la revisión creativa humana.</div>}
        </div>
        {center.pending.length > 0 && <div className="mt-3 space-y-2">{center.pending.map((review) => <article key={review.id} className="rounded-2xl border p-3 flex flex-wrap items-center gap-2" style={{ borderColor: "#E8C98B", background: "#FFF7E8" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold">Propuesta del agente · toma {review.shot?.shotNumber}</div><div className="text-sm font-extrabold">{review.scoreTotal}/22 · requiere decisión humana</div></div><BtnAsync small confirmar onClick={() => resolveAgentReview(review, "Aprobar")}>Aprobar</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveAgentReview(review, "Rechazar")}>Clasificar falla</BtnAsync></article>)}</div>}
      </div>
      <div className="p-4 border-b" style={{ borderColor: T.border }}><div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Postproducción</div><div className="font-extrabold text-sm">Tomas, audio, subtítulos y decisiones de corte</div></div></div>
        <div className="grid lg:grid-cols-2 gap-2">{packageCandidates.map((candidate) => <article key={candidate.plan.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>{candidate.approved.length} toma(s) aprobadas</div><div className="font-extrabold text-sm">{candidate.storyboard.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Cobertura exacta · lista para preparar corte</div></div><BtnAsync small onClick={() => preparePackage(candidate)}>Preparar corte</BtnAsync></article>)}
          {center.packages.map((item) => { const tone = statusTone(item.status); return <article key={item.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Paquete #{item.id} · V{item.version}</div><div className="font-extrabold text-sm">{item.storyboard?.title || `Storyboard #${item.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{item.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{item.snapshot?.selections?.length || 0} tomas · publicación bloqueada · huella {item.fingerprint?.slice(0, 8)}</div>{item.status === "Preparado" && <div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolvePackage(item, "Aprobar")}>Aprobar corte final</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolvePackage(item, "Devolver")}>Devolver</BtnAsync></div>}</article>; })}
        </div>
      </div>
      <div className="p-4 border-b" style={{ borderColor: T.border, background: "#FBF7F1" }}>
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Exportación verificable</div><div className="font-extrabold text-sm">Del corte aprobado al archivo máster real</div><div className="text-[10px]" style={{ color: T.choco2 }}>MP4 · H.264 · AAC · BT.709 · hash y probe técnico · revisión humana final</div></div>
          {db.agencyPostproductionExportReady && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: exportWorker?.ffmpegAvailable ? "#DDEBD9" : "#FFF2D8", color: exportWorker?.ffmpegAvailable ? "#315B35" : "#7A5410" }}>{exportWorker?.ffmpegAvailable ? `Worker disponible · ${exportWorker.version}` : "Worker pendiente · no hay FFmpeg activo"}</span>}
        </div>
        {!db.agencyPostproductionExportReady ? <div className="rounded-2xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>postproduccion-exportacion-v1.sql</code>. Hasta entonces un corte aprobado no puede declararse archivo final.</div> : <div className="grid lg:grid-cols-2 gap-2">
          {exportCenter.candidates.map((pkg) => <article key={`candidate-${pkg.id}`} className="rounded-2xl border p-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex flex-col sm:flex-row sm:items-end gap-3"><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Corte #{pkg.id} · V{pkg.version} aprobado</div><div className="font-extrabold text-sm">Autorizar máster operativo</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>Elegí audio original o una pista vigente de la Biblioteca. La mezcla queda sellada y no publica.</div><label className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Audio del máster</label><select className={`${inputCls} mt-1`} style={inputStyle} value={audioByPackage[String(pkg.id)] || ""} onChange={(event) => setAudioByPackage((current) => ({ ...current, [String(pkg.id)]: event.target.value }))} disabled={!db.agencyPostproductionAudioReady}><option value="">Audio original de las tomas</option>{audioAssetsForPackage(pkg).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.rightsExpiresAt ? ` · vence ${asset.rightsExpiresAt}` : " · sin vencimiento"}</option>)}</select>{!db.agencyPostproductionAudioReady && <div className="text-[9px] mt-1 font-bold" style={{ color: "#A66A00" }}>Aplicá audio-postproduccion-v1.sql para sellar la pista.</div>}</div><BtnAsync small onClick={() => authorizeExport(pkg)} disabled={!db.agencyPostproductionAudioReady}>Autorizar exportación</BtnAsync></div></article>)}
          {exportCenter.exports.map((item) => { const tone = statusTone(item.status); const evaluation = item.status === "Exportada" ? evaluatePostproductionMaster(item, item.outputAsset) : null; const audioLabel = item.audioBinding?.mode === "Biblioteca" ? ((db.brandMediaAssets || []).find((asset) => String(asset.id) === String(item.audioBinding.assetId))?.name || `Pista #${item.audioBinding.assetId}`) : "Audio original"; return <article key={item.id} className="rounded-2xl border p-3" style={{ borderColor: ["Fallida", "Incierta", "Rechazada"].includes(item.status) ? "#E9AAA0" : T.border, background: "#FFFDFC" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Exportación #{item.id} · intento {item.attempts}</div><div className="font-extrabold text-sm">{item.package?.storyboard?.title || `Paquete #${item.packageId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{item.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{item.snapshot?.export_spec?.width}×{item.snapshot?.export_spec?.height} · {item.snapshot?.export_spec?.fps} FPS · {audioLabel} · huella {item.fingerprint?.slice(0, 8)}</div>{item.errorMessage && <div className="rounded-xl px-2.5 py-2 text-[10px] mb-2" style={{ background: "#F9D8D1", color: "#A03B2A" }}>{item.errorMessage}</div>}{item.status === "Autorizada" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: exportWorker?.ffmpegAvailable ? "#DDEBD9" : "#FFF2D8", color: exportWorker?.ffmpegAvailable ? "#315B35" : "#7A5410" }}>{exportWorker?.ffmpegAvailable ? "En cola privada · worker FFmpeg disponible." : "En cola privada · activá el worker FFmpeg para procesarla."}</div>}{item.status === "Exportada" && <><div className="rounded-xl px-2.5 py-2 text-[10px] mb-2" style={{ background: evaluation?.approved ? "#DDEBD9" : "#F9D8D1", color: evaluation?.approved ? "#315B35" : "#A03B2A" }}>{evaluation?.approved ? "✓ Archivo y probe coinciden; falta decisión humana." : `× ${evaluation?.reasons?.[0] || "No supera el QA técnico."}`}</div><div className="flex gap-2"><BtnAsync small confirmar disabled={!evaluation?.approved} onClick={() => resolveMaster(item, "Aprobar")}>Aprobar máster</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMaster(item, "Rechazar")}>Rechazar</BtnAsync></div></>}{item.status === "Fallida" && <BtnAsync small kind="ghost" onClick={() => retryExport(item)}>Reintentar fallo definitivo</BtnAsync>}{item.status === "Incierta" && <div className="text-[10px] font-extrabold" style={{ color: "#A03B2A" }}>Bloqueada: conciliar antes de cualquier reenvío.</div>}</article>; })}
          {exportCenter.candidates.length === 0 && exportCenter.exports.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay cortes listos para exportar.</b> Primero aprobá el paquete completo de postproducción.</div>}
        </div>}
      </div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>El corte aprobado sigue separado de Distribución Comercial: no publica, no pauta y no gasta.</div>
    {reviewJob && <Modal title="Control de calidad de la toma" onClose={() => setReviewJob(null)} wide topLayer>
      <div className="rounded-2xl p-3 mb-3 text-xs" style={{ background: T.vainilla }}><b>Trabajo #{reviewJob.id} · salida #{reviewJob.outputAssetId}</b><br />Puntaje {evaluation.total}/22 · {evaluation.approved ? "cumple el umbral" : evaluation.reasons[0]}</div>
      {outputAsset?.url && (outputAsset.mediaType === "Video" ? <video src={outputAsset.url} controls className="w-full max-h-72 rounded-2xl bg-black mb-3" /> : <img src={outputAsset.url} alt={outputAsset.name} className="w-full max-h-72 object-contain rounded-2xl mb-3" />)}
      <div className="grid sm:grid-cols-2 gap-2">{AGENCY_QUALITY_CRITERIA.map((criterion) => <Field key={criterion.key} label={`${criterion.label}${criterion.critical ? " · crítica" : ""}`}><Select options={["0 · falla", "1 · deriva menor", "2 · exacto"]} value={`${scores[criterion.key]} · ${scores[criterion.key] === 0 ? "falla" : scores[criterion.key] === 1 ? "deriva menor" : "exacto"}`} onChange={(event) => setScores({ ...scores, [criterion.key]: Number(event.target.value.slice(0, 1)) })} /></Field>)}</div>
      {!evaluation.approved && <Field label="Tipo de corrección"><Select options={AGENCY_QUALITY_FAILURE_TYPES.filter((item) => item !== "Aprobada")} value={failureType} onChange={(event) => setFailureType(event.target.value)} /></Field>}
      <Field label="Continuidad observada"><textarea className={inputCls} style={inputStyle} rows="2" value={continuity} onChange={(event) => setContinuity(event.target.value)} /></Field>
      <Field label={evaluation.approved ? "Nota de aprobación" : "Qué debe corregirse"}><textarea className={inputCls} style={inputStyle} rows="3" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="flex gap-2"><BtnAsync confirmar onClick={saveQualityReview} disabled={continuity.trim().length < 3 || (!evaluation.approved && note.trim().length < 5)}>{evaluation.approved ? "Aprobar para postproducción" : `Sellar ${failureType.toLowerCase()}`}</BtnAsync><Btn kind="ghost" onClick={() => setReviewJob(null)}>Cancelar</Btn></div>
    </Modal>}
  </div>;
}

function AgencyMetaObservatory({ db, refrescar }) {
  const activePolicy = (db.agencyMetaPolicies || []).find((item) => item.status === "Activa");
  const center = useMemo(() => buildAgencyMetaCenter(db, activePolicy), [db, activePolicy]);
  const [expanded, setExpanded] = useState(null);
  const money = (value) => fmt(Math.round(Number(value || 0)));
  const percent = (value) => value == null ? "—" : `${Number(value).toFixed(2)}%`;

  async function prepare(snapshot) {
    await prepararDiagnosticoMeta(snapshot.id, "Diagnóstico determinístico preparado desde el Observatorio Meta para revisión humana.");
    toast("ok", "Diagnóstico 3Q preparado. No se publicó ni cambió presupuesto.");
    await refrescar();
  }

  async function resolve(diagnostic, decision) {
    const defaultNote = decision === "Aprobar"
      ? "Revisé hechos, atribución, píxel y acciones; no autorizo cambios de pauta."
      : "Devolver para corregir evidencia, denominadores o alcance del diagnóstico.";
    const note = window.prompt(decision === "Aprobar" ? "Nota de aprobación humana" : "¿Qué debe corregirse?", defaultNote) || "";
    if (note.trim().length < 8) return;
    await resolverDiagnosticoMeta(diagnostic.id, decision, note.trim());
    toast("ok", decision === "Aprobar" ? "Diagnóstico aprobado como lectura, sin ejecutar pauta." : "Diagnóstico devuelto con trazabilidad.");
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Resultados de Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "#E8F1E4" }}>◎</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: "#3F6B42" }}>Resultados de Meta</div><div className="display text-xl font-semibold">Qué funcionó y qué revisar</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Cruza campañas, pedidos pagados y margen para convertir datos en decisiones comprensibles.</div></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
        {[["Lecturas",center.summary.snapshots],["Por revisar",center.summary.reviewing],["Alertas",center.summary.alerts],["Ingreso ligado",money(center.summary.linkedRevenue)]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[82px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
      </div>
    </div>
    {!db.agencyMetaReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>observatorio-meta-v1.sql</code> después del Hito 36. Hasta entonces Meta no aporta señales al cerebro de Agencia.</div> : <>
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: T.border, background: "#F4FAF1" }}>
        <div className="text-[11px]"><b>Política vigente:</b> {activePolicy ? `${activePolicy.sourceLabel} · V${activePolicy.version} · ${activePolicy.market} · ${activePolicy.currency}` : "sin política activa"}</div>
        <span className="rounded-full px-3 py-1 text-[9px] font-extrabold uppercase" style={{ background: "#DDEBD9", color: "#315B35" }}>Solo lectura · pauta protegida</span>
      </div>
      {center.snapshots.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay ventanas Meta.</b> El conector privado registrará snapshots inmutables; ninguna clave ni secreto vive en el navegador.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">
        {center.snapshots.slice(0, 8).map((snapshot) => {
          const preview = snapshot.preview || {}; const derived = preview.derived || {}; const diagnostic = snapshot.diagnostics?.[0];
          const open = expanded === snapshot.id; const catalogAlerts = (preview.catalogHypotheses || []).filter((item) => !item.eligible).length;
          const pixelAlerts = (preview.pixelHealth || []).filter((item) => item.alert).length;
          const tone = diagnostic?.status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" } : diagnostic?.status === "Devuelto" ? { bg: "#F6D4CD", fg: "#A03B2A" } : { bg: "#FFF2D8", fg: "#7A5410" };
          return <article key={snapshot.id} className="rounded-2xl border overflow-hidden momo-card-action" style={{ borderColor: open ? "#A8C5AD" : T.border, background: "#fff" }}>
            <button type="button" className="w-full text-left p-4 bg-transparent border-0" onClick={() => setExpanded(open ? null : snapshot.id)} aria-expanded={open}>
              <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#3F6B42" }}>{snapshot.entityType} · {snapshot.objective}</div><div className="display text-lg font-semibold">{snapshot.accountLabel || snapshot.accountExternalId}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{snapshot.windowStart} → {snapshot.windowEnd} · {snapshot.currency}</div></div><div className="text-right"><div className="display text-xl font-semibold" style={{ color: T.coral }}>{derived.roas == null ? "—" : `${derived.roas}×`}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>ROAS atribuido</div></div></div>
              <div className="grid grid-cols-4 gap-2 mt-3">{[["Gasto",money(derived.spend)],["CTR",percent(derived.ctrPct)],["Pedidos MOMOS",snapshot.localTruth?.paidOrders || 0],["Alertas",pixelAlerts + catalogAlerts]].map(([label,value]) => <div key={label} className="rounded-xl px-2 py-2" style={{ background: "#FAF4EC" }}><div className="font-extrabold text-xs">{value}</div><div className="text-[8px] uppercase font-bold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            </button>
            {open && <div className="px-4 pb-4 border-t" style={{ borderColor: T.border, background: "#FFFCF8" }}>
              <div className="grid sm:grid-cols-3 gap-2 my-3">{[["Meta atribuye",money(preview.whatHappened?.metaAttributedRevenue)],["MOMOS pagado",money(snapshot.localTruth?.paidRevenue)],["Brecha atribuida",money(preview.whatHappened?.attributionGap)]].map(([label,value]) => <div key={label} className="rounded-xl border p-2.5" style={{ borderColor: T.border }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="font-extrabold">{value}</div></div>)}</div>
              <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: "#E5EEF7", color: "#315A7D" }}><b>Atribución no es causalidad.</b> Meta aporta una lectura; pedidos pagados y margen vienen de MOMOS OPS.</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><div className="text-[9px] uppercase font-extrabold mb-1" style={{ color: T.coral }}>Por qué podría pasar</div>{(preview.whyHypotheses || []).length ? preview.whyHypotheses.slice(0, 3).map((item, index) => <div key={`${item.signal}-${index}`} className="text-[10px] mb-1">• <b>{item.signal}:</b> {item.interpretation}</div>) : <div className="text-[10px]" style={{ color: T.choco2 }}>Sin hipótesis concluyentes en esta ventana.</div>}</div>
                <div><div className="text-[9px] uppercase font-extrabold mb-1" style={{ color: T.coral }}>Qué revisaríamos</div>{(preview.recommendedActions || []).slice(0, 3).map((item, index) => <div key={`${item.action}-${index}`} className="text-[10px] mb-1">• {item.action}</div>)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">{diagnostic ? <><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{diagnostic.status} · confianza {diagnostic.confidence}</span>{diagnostic.status === "En revisión" && <><BtnAsync small confirmar onClick={() => resolve(diagnostic, "Aprobar")}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolve(diagnostic, "Devolver")}>Devolver</BtnAsync></>}</> : <BtnAsync small onClick={() => prepare(snapshot)}>Preparar diagnóstico 3Q</BtnAsync>}</div>
            </div>}
          </article>;
        })}
      </div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este panel no crea campañas, no cambia presupuesto, no pausa, no escala y no publica. Cada acción externa conserva contrato y aprobación específicos.</div>
  </section>;
}

function AgencyMetaIncrementality({ db, refrescar }) {
  const center = useMemo(() => buildMetaIncrementalityCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function createStudy(diagnostic) {
    const snapshot = (db.agencyMetaSnapshots || []).find((item) => String(item.id) === String(diagnostic.snapshotId));
    if (!snapshot?.localCampaignId) throw new Error("El diagnóstico debe provenir de una campaña local exacta.");
    const externalStudyId = window.prompt("ID del estudio Meta Conversion Lift", `META-LIFT-${snapshot.localCampaignId}`) || "";
    if (externalStudyId.trim().length < 3) return;
    const payload = liftStudyPayload({ studyKey: `meta-lift-${diagnostic.id}-${Date.now()}`, diagnosticId: diagnostic.id,
      design: "Meta Conversion Lift", lifecycleScope: "Todos", windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd,
      minimumPerArm: 100, randomized: true, externalStudyId: externalStudyId.trim(), assignmentMethod: "Meta Conversion Lift",
      hypothesis: "La campaña aumenta compradores pagados y beneficio frente al control aleatorio." });
    await crearEstudioIncrementalMeta(payload);
    toast("ok", "Diseño incremental preparado para revisión; no se modificó la pauta.");
    await refrescar();
  }

  async function resolveStudy(study, decision) {
    const note = window.prompt(decision === "Aprobar" ? "Nota de revisión del diseño" : "¿Qué debe corregirse?",
      decision === "Aprobar" ? "Revisé aleatorización, ventana, muestra y alcance del estudio." : "Corregir diseño, asignación o ventana antes de medir.") || "";
    if (note.trim().length < 8) return;
    await resolverEstudioIncrementalMeta(study.id, decision, note.trim());
    toast("ok", decision === "Aprobar" ? "Estudio diseñado; espera medición privada del conector." : "Estudio devuelto con trazabilidad.");
    await refrescar();
  }

  async function resolveMeasurement(measurement, decision) {
    const note = window.prompt("Nota de revisión humana", decision === "Aprobar"
      ? "Revisé muestra, aleatorización, ciclo de vida, margen y alcance causal."
      : decision === "Inconclusa" ? "La evidencia no permite una decisión causal todavía." : "Corregir la medición o su evidencia externa.") || "";
    if (note.trim().length < 8) return;
    await resolverMedicionIncrementalMeta(measurement.id, decision, note.trim());
    toast("ok", "Resultado revisado sin cambiar presupuesto, publicación ni pauta.");
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }} aria-label="Medición incremental Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#3D315B,#5B4779 62%,#80679B)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>⇄</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Control vs. expuesto · nuevos vs. recurrentes</div><div className="display text-xl font-semibold">Incrementalidad Meta</div>
          <div className="text-xs opacity-85 max-w-2xl">Mide compradores y beneficio que no habrían ocurrido sin la campaña. Exige aleatorización, muestra suficiente y revisión humana.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Estudios",center.summary.studies],["En revisión",center.summary.reviewing],["Causales",center.summary.causal],["Beneficio",money(center.summary.profit)]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[82px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaIncrementalityReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>incrementalidad-meta-v1.sql</code> después del Hito 37. El Observatorio seguirá funcionando mientras tanto.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#F7F2FB" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#5B4779" }}>Lecturas aprobadas listas para diseñar prueba</div><div className="grid lg:grid-cols-2 gap-2">{center.candidates.slice(0, 4).map((diagnostic) => {
        const snapshot = (db.agencyMetaSnapshots || []).find((item) => String(item.id) === String(diagnostic.snapshotId));
        return <article key={diagnostic.id} className="rounded-2xl border bg-white p-3 flex items-center gap-3" style={{ borderColor: "#D9CBE5" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#5B4779" }}>Diagnóstico #{diagnostic.id} · confianza {diagnostic.confidence}</div><div className="font-extrabold text-sm">{snapshot?.accountLabel || snapshot?.accountExternalId || "Ventana Meta"}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Campaña {snapshot?.localCampaignId || "sin vínculo"} · atribución todavía no causal</div></div><BtnAsync small onClick={() => createStudy(diagnostic)} disabled={!snapshot?.localCampaignId}>Diseñar lift</BtnAsync></article>;
      })}</div></div>}
      {center.studies.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Aún no hay estudios.</b> Primero aprobá una lectura del Observatorio ligada a una campaña exacta.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.studies.slice(0, 8).map((study) => <article key={study.id} className="rounded-2xl border p-4" style={{ borderColor: "#D9CBE5", background: "#FFFCFF" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#5B4779" }}>{study.design} · {study.lifecycleScope}</div><div className="display text-lg font-semibold">Campaña {study.campaignId}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{study.windowStart} → {study.windowEnd} · mínimo {study.minimumPerArm} por brazo</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: study.status === "Cerrado" ? "#DDEBD9" : study.status === "Devuelto" ? "#F6D4CD" : "#EEE5F4", color: study.status === "Devuelto" ? "#A03B2A" : "#5B4779" }}>{study.status}</span></div>
        <div className="rounded-xl px-3 py-2 text-[10px] my-3" style={{ background: "#F7F0E3" }}><b>Hipótesis:</b> {study.hypothesis}</div>
        {study.status === "En revisión" && <div className="flex gap-2 mb-3"><BtnAsync small confirmar onClick={() => resolveStudy(study, "Aprobar")}>Aprobar diseño</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveStudy(study, "Devolver")}>Devolver</BtnAsync></div>}
        {study.measurements.length === 0 ? <div className="text-[10px]" style={{ color: T.choco2 }}>{study.status === "Diseñado" ? "Esperando resultado agregado del conector privado de Meta." : "Todavía no existe una medición sellada."}</div> : study.measurements.slice(0, 2).map((measurement) => { const result = measurement.result || {}; return <div key={measurement.id} className="rounded-2xl border p-3 mt-2" style={{ borderColor: result.causalClaimAllowed ? "#A8C5AD" : "#E8C98B", background: result.causalClaimAllowed ? "#F4FAF1" : "#FFF8E9" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold">Resultado · {result.classification || "En revisión"}</div><div className="font-extrabold text-sm">{result.controlRatePct}% control → {result.exposedRatePct}% expuesto</div></div><div className="text-right"><div className="display text-lg font-semibold" style={{ color: Number(result.incrementalProfit) >= 0 ? "#315B35" : "#A03B2A" }}>{money(result.incrementalProfit)}</div><div className="text-[8px] uppercase font-extrabold">beneficio incremental</div></div></div>
          <div className="grid grid-cols-3 gap-2 my-2">{[["Lift",result.liftPct == null ? "—" : `${result.liftPct}%`],["Muestra",result.sampleSufficient ? "Suficiente" : "Insuficiente"],["Causal",result.causalClaimAllowed ? "Sí" : "No"]].map(([label,value]) => <div key={label} className="rounded-xl bg-white px-2 py-1.5"><div className="text-[10px] font-extrabold">{value}</div><div className="text-[8px] uppercase">{label}</div></div>)}</div>
          {measurement.status === "En revisión" && <div className="flex flex-wrap gap-2"><BtnAsync small confirmar onClick={() => resolveMeasurement(measurement, "Aprobar")} disabled={!result.sampleSufficient}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMeasurement(measurement, "Inconclusa")}>Marcar inconclusa</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMeasurement(measurement, "Devolver")}>Devolver</BtnAsync></div>}
        </div>; })}
      </article>)}</div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Una correlación o atribución nunca se presenta como causalidad. Este módulo no crea campañas, no cambia audiencias o presupuesto y no publica.</div>
  </section>;
}

function AgencyMetaInvestmentScenarios({ db, refrescar }) {
  const center = useMemo(() => buildMetaInvestmentCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function createScenario(measurement) {
    const payload = investmentScenarioPayload(measurement, 7);
    await crearEscenariosInversionMeta(payload);
    toast("ok", "Cuatro escenarios preparados con datos actuales; no se cambió la pauta.");
    await refrescar();
  }

  async function reviewScenario(scenario, decision) {
    const defaults = decision === "Aprobar"
      ? "Revisé beneficio incremental, inventario, capacidad, ciclo de vida y límites."
      : decision === "Devolver" ? "Actualizar evidencia operativa o supuestos antes de decidir."
        : "Descartado por decisión humana; no debe ejecutarse.";
    const note = window.prompt("Nota obligatoria de revisión humana", defaults) || "";
    if (note.trim().length < 8) return;
    await resolverEscenariosInversionMeta(scenario.id, decision, note.trim());
    toast("ok", `${decision}: la revisión quedó registrada sin ejecutar cambios.`);
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Opciones de inversión Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "#E5EEF7" }}>◫</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: "#315A7D" }}>Opciones para crecer</div><div className="display text-xl font-semibold">Comparar antes de invertir</div>
          <div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>MOMOS compara alternativas para que el equipo elija. Nunca cambia la pauta automáticamente.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Opciones",center.summary.scenarios],["Por revisar",center.summary.reviewing],["Aprobadas",center.summary.approved],["Con alertas",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[82px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaInvestmentReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>escenarios-inversion-meta-v1.sql</code> después del Hito 38. La medición incremental seguirá disponible.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#EEF5F7" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#245777" }}>Mediciones aprobadas listas para comparar</div><div className="grid lg:grid-cols-2 gap-2">{center.candidates.slice(0, 4).map((measurement) => <article key={measurement.id} className="rounded-2xl border bg-white p-3 flex items-center gap-3" style={{ borderColor: "#C9D9E2" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#245777" }}>Medición causal #{measurement.id}</div><div className="font-extrabold text-sm">Beneficio incremental {money(measurement.result?.incrementalProfit)}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Horizonte operativo sugerido: 7 días · revisión humana obligatoria</div></div><BtnAsync small onClick={() => createScenario(measurement)}>Comparar 4 opciones</BtnAsync></article>)}</div></div>}
      {center.scenarios.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Aún no hay escenarios.</b> Primero aprobá una medición incremental con muestra suficiente.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.scenarios.slice(0, 10).map((scenario) => {
        const evidence = scenario.evidence || {}; const operations = evidence.operations || {}; const product = evidence.product || {}; const campaign = evidence.campaign || {};
        return <article key={scenario.id} className="rounded-2xl border overflow-hidden" style={{ borderColor: scenario.status === "En revisión" ? "#9FBAC8" : T.border, background: "#FFFEFC" }}>
          <div className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold tracking-wider" style={{ color: "#245777" }}>Campaña {campaign.name || scenario.campaignId} · {scenario.horizonDays} días</div><div className="display text-lg font-semibold">{product.name || "Producto foco sin identificar"}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Recomendación del modelo: <b>{scenario.recommendedOption}</b> · evidencia sellada</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: scenario.status === "Aprobado" ? "#DDEBD9" : scenario.status === "En revisión" ? "#DDEAF0" : "#F3E6DD", color: scenario.status === "Aprobado" ? "#315B35" : "#245777" }}>{scenario.status}</span></div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 my-3">{[["Exacto",operations.exactAvailable],["En proceso",operations.inProcess],["Reservado",operations.reservations],["Vence pronto",operations.expiringSoon],["Cola cocina",operations.kitchenQueue],["Pendiente",operations.pendingProduction]].map(([label,value]) => <div key={label} className="rounded-xl px-2 py-2" style={{ background: "#F4F7F8" }}><div className="text-xs font-extrabold">{Number(value || 0)}</div><div className="text-[7px] uppercase font-bold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            {evidence.stockBlocked && <div className="rounded-xl px-3 py-2 mb-3 text-[10px] font-bold" style={{ background: "#F9D8D1", color: "#A03B2A" }}>Stock operativo bloqueado: no se recomienda ampliar exposición.</div>}
            <div className="grid sm:grid-cols-2 gap-2">{(scenario.options || []).map((option) => { const recommended = option.key === scenario.recommendedOption; const projection = option.projection || {}; return <div key={option.key} className="rounded-2xl border p-3" style={{ borderColor: recommended ? "#4B8798" : T.border, background: recommended ? "#EEF7F8" : "#fff" }}><div className="flex items-start justify-between gap-2"><div><div className="font-extrabold text-sm">{option.key}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{option.purpose}</div></div>{recommended && <span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#245777", color: "#fff" }}>SUGERIDA</span>}</div><div className="grid grid-cols-2 gap-2 my-2"><div><div className="font-extrabold text-sm">{money(option.proposedBudget)}</div><div className="text-[8px] uppercase">presupuesto simulado</div></div><div><div className="font-extrabold text-sm">{Number(option.deltaPct || 0)}%</div><div className="text-[8px] uppercase">variación</div></div></div><div className="text-[9px] rounded-lg px-2 py-1.5" style={{ background: "#FAF4EC" }}>Beneficio proyectado: {money(projection.low)} — <b>{money(projection.base)}</b> — {money(projection.high)}</div>{(option.blockers || []).slice(0, 2).map((blocker) => <div key={blocker} className="text-[9px] mt-1" style={{ color: "#A03B2A" }}>• {blocker}</div>)}</div>; })}</div>
            {scenario.status === "En revisión" && <div className="flex flex-wrap gap-2 mt-3"><BtnAsync small confirmar onClick={() => reviewScenario(scenario, "Aprobar")}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewScenario(scenario, "Devolver")}>Devolver</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewScenario(scenario, "Descartar")}>Descartar</BtnAsync></div>}
          </div>
        </article>;
      })}</div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Aprobar una lectura no ejecuta nada: no cambia presupuesto, audiencia, campaña o publicación. La ejecución requiere otro contrato y otra aprobación.</div>
  </section>;
}

function AgencyMetaAuthorizationPanel({ db, refrescar }) {
  const center = useMemo(() => buildMetaAuthorizationCenter(db), [db]);
  const connector = useMemo(() => buildMetaConnectorCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function requestAuthorization(scenario, optionKey) {
    const audienceExternalId = window.prompt("ID exacto de la audiencia Meta", "aud_momos_principal") || "";
    if (!audienceExternalId.trim()) return;
    const validMinutes = Number(window.prompt("Vigencia de esta autorización (10 a 120 minutos)", "60") || 0);
    const justification = window.prompt("Justificación humana obligatoria", `Autorizar ${optionKey} para la campaña exacta, con presupuesto y audiencia sellados.`) || "";
    const payload = metaAuthorizationPayload({ scenario, optionKey, audienceExternalId, validMinutes, justification,
      settings: { campaignBudgetLimit: db.agencySettings?.campaignBudgetLimit, paused: db.agencySettings?.paused } });
    await solicitarAutorizacionInversionMeta(payload);
    toast("ok", "Solicitud sellada para revisión. Todavía no cambió ninguna campaña.");
    await refrescar();
  }

  async function reviewAuthorization(authorization, decision) {
    const suggested = decision === "Autorizar"
      ? "Verifiqué campaña, audiencia, presupuesto, vigencia y evidencia operativa."
      : decision === "Devolver" ? "Corregir el alcance o la evidencia antes de autorizar." : "No corresponde ejecutar esta alternativa.";
    const note = window.prompt("Nota de revisión humana", suggested) || "";
    if (note.trim().length < 16) return;
    await resolverAutorizacionInversionMeta(authorization.id, decision, note.trim());
    toast("ok", decision === "Autorizar" ? "Autorización vigente creada para simulación privada; no se tocó Meta." : `${decision} registrada con trazabilidad.`);
    await refrescar();
  }

  async function revokeAuthorization(authorization) {
    const reason = window.prompt("Motivo de revocación", "La autorización ya no corresponde al momento comercial actual.") || "";
    if (reason.trim().length < 16) return;
    await revocarAutorizacionInversionMeta(authorization.id, reason.trim());
    toast("ok", "Autorización revocada; cualquier simulación pendiente quedó cerrada.");
    await refrescar();
  }

  async function prepareMetaVerification(authorization) {
    if (!db.agencyMetaConnectorReady) throw new Error("Aplicá primero meta-conector-dry-run-v1.sql.");
    const storedAccount = (db.agencyIntegrations || []).find((item) => item.provider === "Meta")?.externalAccountId || "act_";
    const accountId = window.prompt("Cuenta publicitaria exacta de Meta (act_...)", storedAccount) || "";
    if (!accountId.trim()) return;
    const apiVersion = window.prompt("Versión Graph API sellada para esta verificación", "v25.0") || "";
    if (!apiVersion.trim()) return;
    await prepararDryRunMeta(authorization.id, accountId.trim(), apiVersion.trim());
    toast("ok", "Verificación oficial preparada: el worker solo hará tres lecturas GET y no cambiará la campaña.");
    await refrescar();
  }

  const statusStyle = (status) => status === "Autorizada" ? { background: "#DDEBD9", color: "#315B35" }
    : status === "En revisión" ? { background: "#FBE8C8", color: "#8B5A08" }
      : status === "Incierta" ? { background: "#F6D4CD", color: "#A03B2A" }
        : { background: "#F1E7E0", color: T.choco2 };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D4B9C4", background: "#FFFDFC" }} aria-label="Autorización de inversión Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#4C2637,#74384D 58%,#A35569)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>✓</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Doble aprobación · alcance exacto · vigencia corta</div><div className="display text-xl font-semibold">Autorización de inversión Meta</div>
          <div className="text-xs opacity-85 max-w-2xl">H40 sella el permiso humano y H41 verifica cuenta, campaña y audiencia por Graph API. Es una comprobación oficial de solo lectura: nunca modifica pauta.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Solicitudes",center.summary.requests],["En revisión",center.summary.reviewing],["Autorizadas",center.summary.authorized],["Inciertas",center.summary.uncertain]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[82px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaAuthorizationReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>autorizacion-inversion-meta-v1.sql</code> después del Hito 39. Los escenarios seguirán disponibles sin permisos de ejecución.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#FBF1F4" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#74384D" }}>Escenarios aprobados que todavía no tienen autorización</div><div className="grid xl:grid-cols-2 gap-3">{center.candidates.slice(0, 6).map((scenario) => <article key={scenario.id} className="rounded-2xl border bg-white p-3" style={{ borderColor: "#E0CAD2" }}>
        <div className="flex items-start justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#74384D" }}>Escenario #{scenario.id} · campaña {scenario.campaignId}</div><div className="font-extrabold text-sm">Elegí exactamente qué alternativa solicitar</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>LECTURA APROBADA</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{(scenario.options || []).map((option) => { const blocked = (option.blockers || []).length > 0 || (scenario.evidence?.stockBlocked && option.key !== "Reducir"); return <button key={option.key} type="button" disabled={blocked} title={blocked ? (option.blockers || []).join(" ") || "Bloqueada por stock" : `Solicitar ${option.key}`} onClick={() => requestAuthorization(scenario, option.key)} className="rounded-xl border px-2 py-2 text-left disabled:opacity-40" style={{ borderColor: option.key === scenario.recommendedOption ? "#A35569" : T.border, background: option.key === scenario.recommendedOption ? "#FFF2F5" : "#fff" }}><div className="text-[10px] font-extrabold">{option.key}</div><div className="text-[9px]">{money(option.proposedBudget)}</div></button>; })}</div>
        {scenario.evidence?.stockBlocked && <div className="text-[9px] mt-2 font-bold" style={{ color: "#A03B2A" }}>Sin stock operativo, la guarda solo permite solicitar Reducir.</div>}
      </article>)}</div></div>}
      {center.authorizations.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay permisos solicitados.</b> La aprobación analítica del Hito 39 no autoriza inversión por sí sola.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.authorizations.slice(0, 12).map((authorization) => { const dryRun = connector.dryRuns.find((item) => String(item.authorizationId) === String(authorization.id)); return <article key={authorization.id} className="rounded-2xl border p-4" style={{ borderColor: authorization.status === "Incierta" || dryRun?.status === "Incierto" ? "#D88A7C" : "#E0CAD2", background: "#FFFCFD" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#74384D" }}>Campaña {authorization.campaignId} · audiencia {authorization.audienceExternalId}</div><div className="display text-lg font-semibold">{authorization.selectedOption} · {money(authorization.targetBudget)}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Contrato #{authorization.id} · {authorization.executionMode} · vence {authorization.validUntil || "sin fecha"}</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={statusStyle(authorization.status)}>{authorization.status}</span></div>
        <div className="rounded-xl px-3 py-2 text-[10px] my-3" style={{ background: "#F7F0E3" }}><b>Razón:</b> {authorization.justification}</div>
        {authorization.job && <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: authorization.job.status === "Incierto" ? "#F9D8D1" : "#EEF3F7" }}><b>Ensayo privado:</b> {authorization.job.status} · intento {authorization.job.attempt}{authorization.job.errorMessage ? ` · ${authorization.job.errorMessage}` : ""}</div>}
        {dryRun && <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: dryRun.status === "Conciliado" ? "#E5F1E1" : ["Divergente","Fallido","Incierto"].includes(dryRun.status) ? "#F9D8D1" : "#EEF3F7" }}><div className="font-extrabold">◎ Verificación oficial: {dryRun.status}</div><div>{dryRun.adAccountId} · {dryRun.apiVersion} · solo GET</div>{dryRun.status === "Conciliado" && <div>Cuenta, campaña y audiencia coinciden · cero mutaciones.</div>}{dryRun.errorMessage && <div>{dryRun.errorMessage}</div>}</div>}
        {authorization.status === "En revisión" && <div className="flex flex-wrap gap-2"><BtnAsync small confirmar onClick={() => reviewAuthorization(authorization, "Autorizar")}>Autorizar simulación</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewAuthorization(authorization, "Devolver")}>Devolver</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewAuthorization(authorization, "Rechazar")}>Rechazar</BtnAsync></div>}
        {authorization.status === "Autorizada" && <div className="flex flex-wrap gap-2">{!dryRun && db.agencyMetaConnectorReady && <BtnAsync small confirmar onClick={() => prepareMetaVerification(authorization)}>Verificar en Meta</BtnAsync>}<BtnAsync small kind="ghost" onClick={() => revokeAuthorization(authorization)}>Revocar permiso</BtnAsync></div>}
      </article>; })}</div>}
    </>}
    {db.agencyMetaAuthorizationReady && !db.agencyMetaConnectorReady && <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>El permiso humano ya está protegido. Aplicá <code>meta-conector-dry-run-v1.sql</code> para comprobar las identidades en Meta sin tocar campañas.</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Una autorización o lectura incierta no se reintenta. H41 solo usa ads_read + appsecret_proof; ads_management, publicaciones y cambios de presupuesto permanecen prohibidos.</div>
  </section>;
}

function AgencyActionCenter({ db, go, refrescar }) {
  const center = useMemo(() => buildAgencyActionQueue(db.agencyActionQueue, db.agencyDecisions || []), [db.agencyActionQueue, db.agencyDecisions]);
  const [selected, setSelected] = useState(null);
  const [outcomeForm, setOutcomeForm] = useState(() => agencyOutcomeDefaults(null));
  const tone = (item) => item.blocked
    ? { border: "#E6B7AE", bg: "#FFF4F1", chip: "#F6D4CD", fg: "#A03B2A" }
    : item.humanActionRequired
      ? { border: "#E6C891", bg: "#FFFBF3", chip: "#FFF0CE", fg: "#8B5A08" }
      : { border: "#C7D8E8", bg: "#F5F9FD", chip: "#E5EEF7", fg: "#315A7D" };

  function openAction(item) {
    setOutcomeForm(agencyOutcomeDefaults(item));
    setSelected(item);
  }

  function navigateAction(item) {
    const destination = agencyActionDestination(item);
    setSelected(null);
    if (destination.module !== "Crecimiento") { go(destination.module); return; }
    window.setTimeout(() => document.getElementById(destination.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function completeDecision() {
    if (!selected) return;
    const error = validateAgencyOutcome(outcomeForm, selected);
    if (error) throw new Error(error);
    await registrarResultadoAccionAgencia(agencyOutcomePayload(selected, outcomeForm));
    setSelected(null); toast("ok", `Resultado verificable de decisión #${selected.decisionId} registrado`); await refrescar();
  }

  return <section id="agency-action-center" className="rounded-[26px] border overflow-hidden mb-6 shadow-sm scroll-mt-24" style={{ borderColor: T.border, background: T.surface }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>🧭</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Decisiones del equipo</div><div className="display text-xl font-semibold">Qué necesita tu aprobación</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Una acción clara por decisión. MOMOS abre el lugar correcto y nunca publica, contacta o gasta por sí sola.</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Acciones",center.summary.total],["Para vos",center.summary.human],["Con alertas",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[70px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyActionQueueReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>centro-acciones-agencia-v1.sql</code> para mostrar los siguientes pasos protegidos dentro de MOMO OPS.</div>
      : !center.allowed ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}>Tu rol no opera Agencia MOMOS; la bandeja permanece privada.</div>
        : center.items.length === 0 ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Bandeja al día.</b> No hay decisiones aprobadas esperando un siguiente paso.</div>
          : <div className="p-3 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{center.items.slice(0, 9).map((item) => { const style = tone(item); return <article key={item.decisionId} className="rounded-2xl border p-4 flex flex-col" style={{ borderColor: style.border, background: style.bg }}>
            <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Decisión #{item.decisionId} · {item.decisionType}</div><div className="display text-base font-semibold mt-1">{item.title}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold uppercase shrink-0" style={{ background: style.chip, color: style.fg }}>{item.riskLevel}</span></div>
            {item.rationale && <p className="text-[11px] leading-relaxed my-2 line-clamp-2" style={{ color: T.choco2 }}>{item.rationale}</p>}
            <div className="rounded-xl px-3 py-2.5 my-2" style={{ background: "rgba(255,255,255,.72)", borderLeft: `3px solid ${style.fg}` }}><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: style.fg }}>{item.stage} · {item.area}</div><div className="text-[11px] font-extrabold mt-0.5">{item.actionLabel}</div></div>
            {item.blocked && <div className="text-[10px] font-bold mb-2" style={{ color: "#A03B2A" }}>Protegida: {item.blockerCode || "requiere resolver un bloqueo"}</div>}
            <div className="mt-auto"><Btn small kind={item.blocked ? "ghost" : "primary"} disabled={!item.humanActionRequired && !item.blocked} onClick={() => openAction(item)}>{item.humanActionRequired || item.blocked ? "Revisar acción" : "En seguimiento del sistema"}</Btn></div>
          </article>; })}</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>La tarjeta navega; no marca la decisión como ejecutada. El resultado solo se registra después de completar el trabajo real.</div>
    {selected && <Modal title={`Decisión #${selected.decisionId} · ${selected.decisionType}`} onClose={() => setSelected(null)} topLayer>
      <div className="rounded-2xl p-4 mb-3" style={{ background: "#FFF8F1", border: `1px solid ${T.border}` }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{selected.stage} · {selected.area}</div><div className="display text-lg font-semibold mt-1">{selected.title}</div>{selected.rationale && <p className="text-xs mt-2 mb-0" style={{ color: T.choco2 }}>{selected.rationale}</p>}</div>
      <div className="rounded-2xl px-3 py-3 mb-3 text-sm font-bold" style={{ background: selected.blocked ? "#F6D4CD" : "#E8F1E4", color: selected.blocked ? "#A03B2A" : "#315B35" }}>{selected.actionLabel}</div>
      {selected.blocked && <div className="rounded-xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Bloqueo protegido: {selected.blockerCode}. Esta pantalla no puede ejecutar cambios externos.</div>}
      <div className="flex flex-wrap gap-2 mb-4"><Btn onClick={() => navigateAction(selected)}>Abrir {selected.area}</Btn><Btn kind="ghost" onClick={() => setSelected(null)}>Cerrar</Btn></div>
      {!db.agencyActionOutcomesReady ? <div className="rounded-xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>resultados-verificables-agencia-v1.sql</code> para cerrar esta acción con evidencia.</div> : <div className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#FFFCF9" }}>
        <div className="text-[9px] uppercase tracking-wider font-extrabold mb-1" style={{ color: T.coral }}>Después de hacer el trabajo</div>
        <div className="display text-base font-semibold mb-3">Cerrar con evidencia verificable</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[10px] font-bold">Cómo terminó<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.completionStatus} onChange={(e) => setOutcomeForm((form) => ({ ...form, completionStatus: e.target.value }))}>{AGENCY_OUTCOME_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">Resultado observado<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.observedResult} onChange={(e) => setOutcomeForm((form) => ({ ...form, observedResult: e.target.value }))}>{AGENCY_OBSERVED_RESULTS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">Tipo de evidencia<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.evidenceKind} onChange={(e) => setOutcomeForm((form) => ({ ...form, evidenceKind: e.target.value, evidenceId: e.target.value === "Ninguna" ? "" : form.evidenceId }))}>{AGENCY_EVIDENCE_KINDS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">ID exacto de MOMO OPS<input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.evidenceId} disabled={outcomeForm.evidenceKind === "Ninguna"} placeholder="Ej. L-046, P-1060 o CRE-01" onChange={(e) => setOutcomeForm((form) => ({ ...form, evidenceId: e.target.value }))} /></label>
          <label className="text-[10px] font-bold">Costo real COP<input type="number" min="0" className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.actualCost} onChange={(e) => setOutcomeForm((form) => ({ ...form, actualCost: e.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Resumen del resultado<textarea maxLength={280} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white min-h-20" value={outcomeForm.summary} placeholder="Qué se hizo y qué quedó comprobado" onChange={(e) => setOutcomeForm((form) => ({ ...form, summary: e.target.value }))} /></label>
        </div>
        {validateAgencyOutcome(outcomeForm, selected) && <div className="text-[10px] font-bold mt-2" style={{ color: "#A03B2A" }}>{validateAgencyOutcome(outcomeForm, selected)}</div>}
        <div className="mt-3"><BtnAsync disabled={Boolean(validateAgencyOutcome(outcomeForm, selected))} onClick={completeDecision}>Registrar resultado verificable</BtnAsync></div>
      </div>}
    </Modal>}
  </section>;
}

function AgencyCreativeFlightCenter({ db, go, refrescar }) {
  const center = useMemo(() => buildCreativeFlightCenter(db), [db]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [relay, setRelay] = useState(null);
  const [relayForm, setRelayForm] = useState({ creativeId: "", postChoice: "__new__", fecha: hoyISO(), hora: "12:00", titulo: "", copyFinal: "" });
  const flights = showCompleted ? center.flights : center.active;

  function openNext(flight) {
    const step = creativeRelayStep(flight);
    if (["master", "publication"].includes(step)) {
      const creativeOptions = creativeCandidatesForFlight(flight, db);
      const postOptions = publicationCandidatesForFlight(flight, db);
      const draft = publicationDraftForFlight(flight, db, hoyISO());
      setRelay({ flight, step, creativeOptions, postOptions });
      setRelayForm({
        creativeId: creativeOptions[0]?.id || "",
        postChoice: postOptions[0]?.id || "__new__",
        fecha: draft.fecha, hora: draft.hora, titulo: draft.titulo, copyFinal: draft.copyFinal,
      });
      return;
    }
    if (["distribution", "observe"].includes(step) || flight.nextTarget === "agency-distribution-room") {
      window.sessionStorage.setItem("momos:calendar-view", "Distribución");
      go("Calendario");
      return;
    }
    document.getElementById(flight.nextTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function completeRelay() {
    if (!relay) return;
    try {
      if (relay.step === "master") {
        if (!relayForm.creativeId) throw new Error("Primero necesitás un creativo aprobado del producto, canal y modo exactos.");
        await prepararRelevoMasterCreativo(relay.flight.master.id, relayForm.creativeId);
        toast("ok", "Máster y creativo exactos enlazados. El archivo quedó sellado; todavía no se publicó.");
      } else {
        let postId = relayForm.postChoice;
        let created = false;
        if (postId === "__new__") {
          if (!relayForm.fecha || !relayForm.titulo.trim()) throw new Error("Completá fecha y título antes de programar.");
          const result = await crearPublicacion({
            fecha: relayForm.fecha, hora: relayForm.hora || "12:00",
            canal: relay.flight.release.lineageSnapshot?.channel || relay.flight.board?.channel,
            campaign_id: db.creatives.find((creative) => String(creative.id) === String(relay.flight.release.creativeId))?.campaignId || "",
            creative_id: relay.flight.release.creativeId, titulo: relayForm.titulo.trim(),
            copy_final: relayForm.copyFinal.trim(), estado: "Programado", url_publicacion: "",
            notas: "Preparada desde el relevo humano del vuelo creativo; sin publicación automática.",
          });
          postId = result.id;
          created = true;
        }
        try {
          await vincularPublicacionMaster(relay.flight.release.id, postId);
        } catch (error) {
          if (created) {
            toast("alert", `La publicación ${postId} quedó Programada, pero falta enlazarla. Reabrí el relevo para recuperarla sin duplicar.`);
            await refrescar();
            return;
          }
          throw error;
        }
        toast("ok", `${postId} quedó ligada al máster exacto y lista para revisión de Distribución.`);
      }
      setRelay(null);
      await refrescar();
    } catch (error) {
      toast("error", error.message || "No se pudo completar el relevo creativo.");
    }
  }

  function relayButtonLabel(flight) {
    const step = creativeRelayStep(flight);
    if (step === "master") return "Enlazar máster";
    if (step === "publication") return "Preparar publicación";
    if (step === "distribution") return "Abrir Distribución";
    if (step === "observe") return "Ver seguimiento";
    return flight.blocked ? "Revisar contrato" : "Abrir siguiente paso";
  }

  return <section id="agency-creative-flight" className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Contenido en curso">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>✦</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Contenido en curso</div><div className="display text-xl font-semibold">Del objetivo al resultado</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Seguí cada contenido desde la idea hasta su resultado, con Pauta y Orgánico siempre separados.</div></div>
      </div>
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[["Activos",center.active.length],["Pauta",center.summary.pauta],["Orgánico",center.summary.organic],["Por revisar",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[66px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
      </div>
    </div>
    {!db.agencyCreativeFlowReady && <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>flujo-creativo-e2e-v1.sql</code> para sellar el relevo Máster → Creativo → Publicación → Distribución → Medición.</div>}
    <div className="p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[.14em]" style={{ color: T.choco2 }}>{showCompleted ? "Todo el contenido" : "Contenido que necesita avanzar"}</div>
        {center.completed.length > 0 && <button type="button" className="rounded-full border px-3 py-1.5 text-[10px] font-extrabold" style={{ borderColor: T.border, color: T.choco2, background: T.vainilla }} onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? "Ocultar cerrados" : `Ver cerrados · ${center.completed.length}`}</button>}
      </div>
      {flights.length === 0 ? <div className="rounded-2xl px-4 py-4 text-sm" style={{ background: "#F8F0E7", color: T.choco2 }}><b style={{ color: T.choco }}>{center.flights.length ? "Todo el contenido completó su aprendizaje." : "Todavía no hay contenido aprobado para iniciar."}</b> El equipo conserva el control de cada paso.</div> : <div className="grid xl:grid-cols-2 gap-3">
        {flights.slice(0, 8).map((flight) => <article key={flight.contract.id} className="rounded-[22px] border p-4" style={{ borderColor: flight.blocked ? "#E8B7AD" : T.border, background: flight.blocked ? "#FFF6F3" : "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: flight.mode === "Pauta" ? "#F6D4CD" : "#DDEBD9", color: flight.mode === "Pauta" ? "#A03B2A" : "#315B35" }}>{flight.mode}</span><span className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Contrato {flight.contract.id}</span></div><div className="display text-lg font-semibold mt-1">{flight.goal}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Métrica primaria: {flight.metric}</div></div>
            <div className="text-right shrink-0"><div className="display text-2xl font-semibold" style={{ color: flight.blocked ? "#A03B2A" : T.coral }}>{flight.progress}%</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{flight.completed}/10 pasos</div></div>
          </div>
          <div className="grid grid-cols-10 gap-1 mt-3" aria-label={`Progreso ${flight.progress}%`}>{flight.stages.map((item) => <div key={item.label} title={`${item.label}: ${item.detail}`} className="h-2 rounded-full" style={{ background: item.state === "done" ? "#5F8B61" : item.state === "current" ? T.coral : "#EADFD2" }} />)}</div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t pt-3" style={{ borderColor: T.border }}>
            <div><div className="text-[9px] uppercase font-extrabold" style={{ color: flight.blocked ? "#A03B2A" : T.coral }}>{flight.blocked ? "Requiere corrección" : "Siguiente paso"}</div><div className="text-xs font-extrabold">{flight.currentStage}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{flight.stages.find((item) => item.label === flight.currentStage)?.detail}</div></div>
            <Btn small kind={flight.blocked ? "ghost" : "primary"} onClick={() => openNext(flight)}>{relayButtonLabel(flight)}</Btn>
          </div>
        </article>)}
      </div>}
    </div>
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este centro solo orienta y verifica la cadena. No genera, publica, pauta ni gasta automáticamente.</div>
    {relay && <Modal title={relay.step === "master" ? "Enlazar el máster aprobado" : "Preparar la publicación exacta"} onClose={() => setRelay(null)} topLayer>
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#F8F0E7", border: `1px solid ${T.border}` }}>
        <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{relay.flight.mode} · Contrato {relay.flight.contract.id}</div>
        <div className="display text-lg font-semibold mt-1">{relay.flight.goal}</div>
        <div className="text-xs mt-1" style={{ color: T.choco2 }}>Canal sellado: {relay.flight.board?.channel || relay.flight.release?.lineageSnapshot?.channel}. La acción conserva producto, marca y medición.</div>
      </div>
      {relay.step === "master" ? <>
        {relay.creativeOptions.length ? <label className="text-[10px] font-bold block">Creativo comercial aprobado
          <select className="w-full mt-1 rounded-xl border px-3 py-2.5 bg-white" value={relayForm.creativeId} onChange={(event) => setRelayForm((form) => ({ ...form, creativeId: event.target.value }))}>
            {relay.creativeOptions.map((creative) => <option key={creative.id} value={creative.id}>{creative.id} · {creative.titulo}</option>)}
          </select>
        </label> : <div className="rounded-xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>No hay un creativo aprobado que coincida con producto, canal y modo. Creá una versión nueva y aprobala antes de continuar.</div>}
        <div className="rounded-xl px-3 py-3 my-4 text-xs" style={{ background: "#E8F1E4", color: "#315B35" }}>MOMOS OPS enlazará el archivo aprobado al creativo elegido. No lo publicará ni ejecutará pauta.</div>
        <div className="flex flex-wrap gap-2"><BtnAsync disabled={!relay.creativeOptions.length} onClick={completeRelay}>Enlazar máster exacto</BtnAsync>{!relay.creativeOptions.length && <Btn kind="ghost" onClick={() => { setRelay(null); go("Creativos"); }}>Abrir Creativos</Btn>}</div>
      </> : <>
        {relay.postOptions.length > 0 && <label className="text-[10px] font-bold block mb-3">Reutilizar una publicación compatible
          <select className="w-full mt-1 rounded-xl border px-3 py-2.5 bg-white" value={relayForm.postChoice} onChange={(event) => setRelayForm((form) => ({ ...form, postChoice: event.target.value }))}>
            {relay.postOptions.map((post) => <option key={post.id} value={post.id}>{post.id} · {post.fecha} {post.hora} · {post.titulo}</option>)}
            <option value="__new__">Crear una nueva programación</option>
          </select>
        </label>}
        {(relay.postOptions.length === 0 || relayForm.postChoice === "__new__") && <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[10px] font-bold">Fecha<input type="date" min={hoyISO()} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.fecha} onChange={(event) => setRelayForm((form) => ({ ...form, fecha: event.target.value }))} /></label>
          <label className="text-[10px] font-bold">Hora<input type="time" className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.hora} onChange={(event) => setRelayForm((form) => ({ ...form, hora: event.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Título<input maxLength={180} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.titulo} onChange={(event) => setRelayForm((form) => ({ ...form, titulo: event.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Copy final<textarea maxLength={2000} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white min-h-24" value={relayForm.copyFinal} onChange={(event) => setRelayForm((form) => ({ ...form, copyFinal: event.target.value }))} /></label>
        </div>}
        <div className="rounded-xl px-3 py-3 my-4 text-xs" style={{ background: "#FFF2D8", color: "#7A5410" }}>Quedará en estado <b>Programado</b>. Distribución deberá revisar checklist, derechos y evidencia antes de cualquier salida externa.</div>
        <BtnAsync onClick={completeRelay}>Programar y enlazar</BtnAsync>
      </>}
    </Modal>}
  </section>;
}

function GrowthModeExplorer({ engine, selectedModeId, onSelectMode, onUseMode }) {
  const selected = engine.modes.find((mode) => mode.id === selectedModeId)
    || engine.modes.find((mode) => mode.id === engine.recommendedModeId)
    || engine.modes[0];
  const statusColors = selected.status.value === "Listo" || selected.status.value === "Plan listo"
    ? { bg: "#DDEBD9", fg: "#315B35", border: "#B8D3B2" }
    : selected.status.value === "Bloqueado"
      ? { bg: "#F6D4CD", fg: "#A03B2A", border: "#E6B7AE" }
      : { bg: "#FFF2D8", fg: "#7A5410", border: "#E8C98B" };
  return <section className="rounded-[26px] border shadow-sm overflow-hidden" style={{ borderColor: T.border, background: T.surface }} aria-label="Motor de crecimiento multimodo">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: "linear-gradient(135deg,#FFF9F2,#FFFDFC)" }}>
      <div className="flex items-start gap-3"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>🧭</span><div><div className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Motor de crecimiento MOMOS</div><div className="display text-xl font-semibold mt-0.5">Elegí cómo queremos crecer</div><div className="text-xs mt-1 max-w-2xl" style={{ color: T.choco2 }}>MOMOS compara inventario, demanda, Producción, marca y resultados. Recomienda un camino, pero la decisión sigue siendo humana.</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[[engine.facts.exactStockUnits,"Listas"],[engine.facts.productionUnits,"Por producir"],[engine.facts.paidOrders30d,"Pedidos 30 d"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[72px]" style={{ borderColor: T.border, background: T.surface }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    <div className="p-4 sm:p-5">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-4" role="tablist" aria-label="Modos de crecimiento">
        {engine.modes.map((mode) => { const active = mode.id === selected.id; const recommended = mode.id === engine.recommendedModeId; return <button key={mode.id} type="button" role="tab" aria-selected={active} onClick={() => onSelectMode(mode.id)} className="text-left rounded-2xl border p-3 transition min-h-[106px]" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface, boxShadow: active ? "0 4px 12px rgba(204,103,77,.10)" : "none" }}>
          <div className="flex items-start justify-between gap-2"><span className="w-8 h-8 rounded-xl grid place-items-center text-base" style={{ background: active ? T.coralSoft : T.vainilla }}>{mode.icon}</span>{recommended && <span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>Recomendado</span>}</div>
          <div className="font-extrabold text-xs mt-2">{mode.shortLabel}</div><div className="text-[9px] mt-1 leading-relaxed" style={{ color: T.choco2 }}>{mode.objective}</div>
        </button>; })}
      </div>

      <article className="rounded-[22px] border overflow-hidden" style={{ borderColor: statusColors.border, background: "#FFFDFC" }}>
        <div className="p-4 flex flex-col lg:flex-row lg:items-start justify-between gap-3" style={{ background: "#FFF9F2" }}>
          <div className="flex items-start gap-3"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.vainilla }}>{selected.icon}</span><div><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{selected.channel}</span><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: statusColors.bg, color: statusColors.fg }}>{selected.status.value}</span></div><div className="display text-lg font-semibold mt-1">{selected.label}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{selected.status.detail}</div></div></div>
          <BtnAsync small onClick={() => onUseMode(selected)}>Usar este camino</BtnAsync>
        </div>
        <div className="grid lg:grid-cols-[.9fr_1.1fr] border-t" style={{ borderColor: T.border }}>
          <div className="p-4 lg:border-r" style={{ borderColor: T.border }}>
            <div className="text-[9px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Por qué conviene</div>
            <div className="space-y-2 mb-4">{selected.why.map((item) => <div key={item} className="flex items-start gap-2 text-[10px] leading-relaxed"><span style={{ color: "#5F8B61" }}>✓</span><span>{item}</span></div>)}</div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Siguiente paso</div><div className="text-[11px] font-extrabold mt-1">{selected.nextStep}</div></div>
            <div className="mt-3"><div className="text-[8px] uppercase font-extrabold mb-1.5" style={{ color: T.choco2 }}>Antes de usarlo</div><div className="flex flex-wrap gap-1.5">{selected.safeguards.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: "#EDF5EA", color: "#315B35" }}>✓ {item}</span>)}</div></div>
            {selected.productionPlan && <div className="grid grid-cols-3 gap-2 mt-3">{[[selected.productionPlan.runs,"Corridas"],[selected.productionPlan.units,"Unidades"],[selected.productionPlan.preparations.length,"Preparaciones"]].map(([value,label]) => <div key={label} className="rounded-xl border px-2 py-2 text-center" style={{ borderColor: T.border }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>}
          </div>
          <div className="p-4">
            <div className="flex items-end justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Ángulos para probar</div><div className="text-[10px]" style={{ color: T.choco2 }}>No repetimos el mismo mensaje: cada idea persigue una razón distinta para elegir MOMOS.</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold shrink-0" style={{ background: T.vainilla }}>{selected.angles.length} ideas</span></div>
            <div className="grid sm:grid-cols-2 gap-2">{selected.angles.map((item, index) => <div key={item.id} className="rounded-xl border p-3" style={{ borderColor: T.border, background: T.surface }}><div className="flex items-center justify-between gap-2"><span className="text-[8px] uppercase font-extrabold" style={{ color: T.coral }}>Idea {index + 1}</span><span className="text-[8px] font-bold" style={{ color: T.choco2 }}>{item.format}</span></div><div className="font-extrabold text-[11px] mt-1">{item.title}</div><div className="text-[9px] mt-1 leading-relaxed" style={{ color: T.choco2 }}>{item.promise}</div></div>)}</div>
          </div>
        </div>
        <div className="px-4 py-2.5 border-t text-[9px] font-semibold" style={{ borderColor: T.border, background: "#F8F0E7", color: T.choco2 }}>{engine.policy.statement}</div>
      </article>
    </div>
  </section>;
}

function BrandIdentitySummaryCard({ identity, loading, error, onOpen }) {
  const summary = brandIdentitySummary(identity);
  const statusBg = identity.ready ? "#DDEBD9" : "#FFF2D8";
  const statusColor = identity.ready ? "#315B35" : "#7A5410";
  return <button type="button" onClick={onOpen} className="momo-card-action w-full rounded-2xl border p-4 text-left" style={{ borderColor: identity.ready ? "#BFD8BE" : "#E7C078", background: T.surface }} aria-label="Abrir identidad de marca MOMOS">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: T.coralSoft }}>✦</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Identidad de marca</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: statusBg, color: statusColor }}>{loading ? "Verificando" : error ? "Revisar conexión" : identity.statusLabel}</span></div><div className="display text-lg font-semibold mt-0.5">La guía visual y verbal de MOMOS</div><div className="text-[10px] mt-1 line-clamp-2" style={{ color: T.choco2 }}>{identity.positioning}</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[[summary.officialLogos,"Logos"],[summary.colors,"Colores"],[summary.rules,"Reglas"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[68px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    <div className="mt-3 pt-2.5 border-t flex items-center justify-between gap-3 text-[9px]" style={{ borderColor: T.border }}><span style={{ color: T.choco2 }}>{error || `${identity.sourceLabel} · Biblioteca guarda archivos; Identidad declara su uso oficial.`}</span><span className="font-extrabold shrink-0" style={{ color: T.coral }}>Ver identidad <span aria-hidden="true">›</span></span></div>
  </button>;
}

function BrandIdentityPanel({ identity, loading, error, onRetry, onOpenLibrary }) {
  const modeCard = (mode, icon, bg, border, color) => {
    const data = identity.contentModes?.[mode] || {};
    return <div className="rounded-2xl border p-4" style={{ borderColor: border, background: bg }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color }}>{icon} {mode}</div><div className="display text-lg font-semibold mt-1">{data.purpose || (mode === "Pauta" ? "Conversión rentable y medible" : "Atención, afinidad y comunidad")}</div><div className="text-[10px] leading-relaxed mt-2" style={{ color: T.choco2 }}>{mode === "Pauta" ? "Oferta, audiencia, capacidad, atribución y CTA deben estar verificados." : "Valor antes de pedir; la venta solo se atribuye cuando existe un vínculo exacto."}</div><div className="flex flex-wrap gap-1.5 mt-3">{(data.primary_metrics || []).map((metric) => <span key={metric} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: T.surface, color }}>{metric}</span>)}</div></div>;
  };
  return <div className="space-y-4">
    <div className="rounded-2xl border p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ borderColor: identity.ready ? "#BFD8BE" : "#E7C078", background: identity.ready ? "#F7FBF5" : "#FFF9EC" }}>
      <div><div className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: identity.ready ? "#315B35" : "#7A5410" }}>{identity.statusLabel}</div><div className="display text-xl font-semibold mt-1">{identity.name} · {identity.sourceLabel}</div><div className="text-xs mt-1 max-w-2xl" style={{ color: T.choco2 }}>{identity.positioning}</div></div>
      <div className="flex flex-wrap gap-2"><Btn small onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Logo principal", openUpload: true })}>Subir logo principal</Btn><Btn small kind="ghost" onClick={() => onOpenLibrary?.({ collection: "Marca" })}>Ver archivos de marca</Btn>{(error || !identity.serverAvailable) && <Btn small onClick={onRetry}>{loading ? "Verificando…" : "Verificar H55"}</Btn>}</div>
    </div>

    {!identity.ready && <div className="rounded-xl px-3.5 py-3 text-[11px] font-semibold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{error || identity.errors[0] || "La identidad verbal y visual base sigue disponible. Elegí un logo principal oficial para activar la protección completa."}</div>}

    <section><div className="flex items-end justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Firma oficial</div><h3 className="display text-lg font-semibold m-0">Logos aprobados</h3></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: T.vainilla }}>{identity.logos.length} vinculados</span></div>
      {identity.logos.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{identity.logos.map((logo) => <div key={`${logo.role}-${logo.assetId}`} className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border, background: T.surface }}><div className="h-40 grid place-items-center p-5" style={{ background: logo.background === "Oscuro" ? T.choco : T.bg }}>{logo.signedUrl ? <img src={logo.signedUrl} alt={`${identity.name} · ${logo.role}`} className="max-w-full max-h-full object-contain" /> : <div className="text-center"><div className="text-3xl">✦</div><div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Vista disponible al abrir desde el servidor</div></div>}</div><div className="p-3 border-t" style={{ borderColor: T.border }}><div className="font-extrabold text-sm capitalize">{logo.role.replaceAll("_", " ")}</div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>Mínimo {logo.minWidthPx} px · aire {logo.clearSpaceRatio}× · fondo {logo.background}</div></div></div>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: "#E7C078", background: "#FFF9EC" }}><div className="text-2xl">✦</div><div className="font-extrabold text-sm mt-2">Falta declarar el logo principal</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>Usá el botón “Subir logo principal”. MOMO OPS lo guardará y creará la nueva versión oficial sin mezclarlo con productos.</div><div className="mt-3"><Btn small onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Logo principal", openUpload: true })}>Subir logo principal</Btn></div></div>}
    </section>

    <section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Referencias visuales de marca</div><h3 className="display text-lg font-semibold m-0 mt-1">Fotos que enseñan cómo se siente MOMOS</h3><div className="text-[10px] mt-1 max-w-2xl" style={{ color: T.choco2 }}>Ambientes, empaque, equipo, cultura, texturas y estilo de vida viven en su propio panel. No se mezclan con fotos de postres.</div></div><Btn small kind="ghost" onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Referencia visual", openUpload: true })}>Agregar fotos de marca</Btn></div></section>

    <section><div className="mb-2"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Sistema visual</div><h3 className="display text-lg font-semibold m-0">Colores con una función clara</h3></div><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">{identity.colors.map((color) => <div key={color.token} className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border, background: T.surface }}><div className="h-16" style={{ background: color.colorHex }} /><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="font-extrabold text-[11px]">{color.label}</span><code className="text-[9px]">{color.colorHex}</code></div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>{color.usage}</div></div></div>)}</div></section>

    <div className="grid lg:grid-cols-2 gap-3"><section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Tipografía y estilo</div><div className="display text-2xl font-semibold mt-2">{identity.typography.display}</div><div className="text-sm font-bold">{identity.typography.body}</div><div className="flex flex-wrap gap-1.5 mt-3">{identity.visualStyle.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{item}</span>)}</div></section><section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Voz de MOMOS</div><div className="flex flex-wrap gap-1.5 mt-2">{identity.tone.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.rosa, color: "#8E4B5A" }}>{item}</span>)}</div><div className="mt-3 space-y-1">{identity.approvedPhrases.slice(0, 3).map((phrase) => <div key={phrase} className="text-xs italic">“{phrase}”</div>)}</div></section></div>
    <section><div className="mb-2"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Dos contratos distintos</div><h3 className="display text-lg font-semibold m-0">Pauta y Orgánico comparten marca, no objetivo</h3></div><div className="grid lg:grid-cols-2 gap-3">{modeCard("Pauta", "📣", "#FFF4E0", "#E7C078", "#7B5410")}{modeCard("Orgánico", "🌱", "#E8F1E4", "#BFD8BE", "#315B35")}</div></section>
  </div>;
}

function AgencyFriendlyHome({ guide, selectedGoal, onSelectGoal, onContinue, onAdvanced, growthEngine, selectedGrowthModeId, onSelectGrowthMode, onUseGrowthMode, brandIdentity, brandIdentityLoading, brandIdentityError, onOpenIdentity }) {
  const goal = FRIENDLY_AGENCY_GOALS.find((item) => item.id === selectedGoal) || FRIENDLY_AGENCY_GOALS[0];
  const recommendation = guide.recommendations[selectedGoal] || null;
  const activeContent = selectedGoal === "content" ? guide.activeFlight : null;
  const primaryLabel = selectedGoal === "content" && activeContent ? "Continuar contenido"
    : selectedGoal === "sales" ? "Preparar propuesta de venta"
      : selectedGoal === "customers" ? "Preparar activación"
        : selectedGoal === "results" ? "Ver análisis completo" : "Empezar contenido";

  return <div className="space-y-5">
    <BrandIdentitySummaryCard identity={brandIdentity} loading={brandIdentityLoading} error={brandIdentityError} onOpen={onOpenIdentity} />
    <section aria-label="Inicio guiado de Agencia MOMOS">
      <div className="mb-3"><h3 className="display text-lg font-semibold m-0">¿Qué quieres hacer hoy?</h3><p className="text-xs mt-0.5 mb-0" style={{ color: T.choco2 }}>Elegí un resultado. MOMOS organiza el trabajo y te pide solo las decisiones necesarias.</p></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" role="tablist" aria-label="Objetivos de Agencia MOMOS">
        {FRIENDLY_AGENCY_GOALS.map((item) => { const active = item.id === selectedGoal; return <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => onSelectGoal(item.id)} className="text-left rounded-2xl border p-3.5 transition min-h-[104px]" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface, boxShadow: "0 2px 5px rgba(84,56,43,.08)" }}>
          <div className="flex items-start gap-3"><span className="w-8 h-8 rounded-xl grid place-items-center text-base shrink-0" style={{ background: active ? T.coralSoft : T.vainilla }}>{item.icon}</span><span className="min-w-0"><span className="block font-extrabold text-sm mb-1">{item.label}</span><span className="block text-[10px] leading-relaxed" style={{ color: T.choco2 }}>{item.description}</span></span></div>
        </button>; })}
      </div>
    </section>

    {selectedGoal === "sales" ? <GrowthModeExplorer engine={growthEngine} selectedModeId={selectedGrowthModeId} onSelectMode={onSelectGrowthMode} onUseMode={onUseGrowthMode} /> : <section className="rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: activeContent ? "#E9A18F" : T.border, background: T.surface }} aria-label={`Recorrido ${goal.label}`}>
      <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>{goal.icon}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Agencia MOMOS</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: activeContent ? "#DDEBD9" : T.vainilla, color: activeContent ? "#315B35" : T.choco2 }}>{activeContent ? "En curso" : "Lista para empezar"}</span></div><div className="display text-xl font-semibold mt-0.5">{goal.label}</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>{activeContent ? `${activeContent.title} · ${activeContent.mode}` : recommendation?.title || goal.description}</div></div></div>
        <div className="grid grid-cols-3 gap-2 shrink-0">{[[activeContent ? `${activeContent.progress}%` : "—","Avance"],[activeContent ? activeContent.current.label : "1","Paso actual"],[activeContent ? activeContent.phases.length : "3","Pasos"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[72px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
      </div>

      {activeContent ? <div className="px-4 sm:px-5 pb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">{activeContent.phases.map((phase, index) => <div key={phase.id} className="rounded-xl border p-3" style={{ borderColor: phase.state === "current" ? "#E9A18F" : T.border, background: phase.state === "current" ? "#FFF5F0" : T.surface }}><div className="flex items-center gap-2 mb-1.5"><span className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-extrabold" style={{ background: phase.state === "done" ? "#DDEBD9" : phase.state === "current" ? T.coral : T.vainilla, color: phase.state === "current" ? "#fff" : T.choco }}>{phase.state === "done" ? "✓" : index + 1}</span><span className="font-extrabold text-[11px]">{phase.label}</span></div><div className="text-[9px] leading-relaxed" style={{ color: T.choco2 }}>{phase.description}</div></div>)}</div>
        <div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Lo siguiente</div><div className="font-extrabold text-sm">{activeContent.current.description}</div></div><Btn small onClick={onContinue}>{primaryLabel}</Btn></div>
      </div> : selectedGoal === "results" ? <div className="px-4 sm:px-5 pb-5"><div className="grid sm:grid-cols-3 gap-2 mb-3">{[["Publicaciones",guide.results.published],["Aprendizajes",guide.results.conclusive],["Ganadores",guide.results.winners]].map(([label,value]) => <div key={label} className="rounded-xl border px-3 py-2.5" style={{ borderColor: T.border, background: T.surface }}><div className="display text-xl font-semibold" style={{ color: T.coral }}>{value}</div><div className="text-[9px] font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div><div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="font-extrabold text-sm">Todavía no hay una conclusión suficiente.</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>Cuando exista muestra real, verás qué repetir y qué cambiar.</div></div><Btn small kind="ghost" onClick={onContinue}>{primaryLabel}</Btn></div></div>
        : <div className="px-4 sm:px-5 pb-5"><div className="grid md:grid-cols-3 gap-2 mb-3">{[["1","Contanos el objetivo","Elegís qué quieres lograr."],["2","MOMOS prepara","Cruza la información necesaria."],["3","Vos decidís","Revisás el resultado antes de usarlo."]].map(([number,title,description]) => <div key={number} className="rounded-xl border px-3 py-2.5 flex items-center gap-2.5" style={{ borderColor: T.border, background: T.surface }}><div className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-extrabold shrink-0" style={{ background: number === "1" ? T.coralSoft : T.vainilla }}>{number}</div><div><div className="font-extrabold text-[11px]">{title}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{description}</div></div></div>)}</div><div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: recommendation ? "#EDF5EA" : T.vainilla }}><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: recommendation ? "#315B35" : T.coral }}>{recommendation ? "Recomendación lista" : "Empecemos"}</div><div className="font-extrabold text-sm">{recommendation?.title || goal.description}</div>{recommendation?.rationale && <div className="text-[10px] mt-0.5 line-clamp-1" style={{ color: T.choco2 }}>{recommendation.rationale}</div>}</div><Btn small onClick={onContinue}>{primaryLabel}</Btn></div></div>}
    </section>}

    <div className="flex justify-end"><button type="button" onClick={onAdvanced} className="rounded-full border px-3 py-1.5 text-[9px] font-extrabold" style={{ borderColor: T.border, background: T.surface, color: T.choco2 }}>Ver controles avanzados</button></div>
  </div>;
}

function AgencyAdvancedModuleCard({ icon, eyebrow, title, description, metric, metricLabel, status = "Disponible", tone = "coral", onOpen }) {
  const tones = {
    coral: { accent: T.coral, soft: "#FFF1EA" },
    green: { accent: "#3F6B42", soft: "#E8F1E4" },
    blue: { accent: "#315A7D", soft: "#E5EEF7" },
    gold: { accent: "#96690F", soft: "#FFF2D8" },
    rose: { accent: "#8B4660", soft: "#F6E3E9" },
  };
  const palette = tones[tone] || tones.coral;
  return <button type="button" onClick={onOpen} className="group w-full min-h-[178px] rounded-2xl border p-4 text-left flex flex-col transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2" style={{ borderColor: T.border, background: T.surface, "--tw-ring-color": palette.accent }}>
    <div className="flex items-start justify-between gap-3">
      <span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: palette.soft }}>{icon}</span>
      <span className="rounded-full px-2 py-1 text-[8px] uppercase tracking-wider font-extrabold" style={{ background: palette.soft, color: palette.accent }}>{status}</span>
    </div>
    <div className="mt-3 text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: palette.accent }}>{eyebrow}</div>
    <div className="display text-lg font-semibold leading-tight mt-1">{title}</div>
    <div className="text-[11px] leading-relaxed mt-1 line-clamp-2" style={{ color: T.choco2 }}>{description}</div>
    <div className="mt-auto pt-3 flex items-end justify-between gap-3 border-t" style={{ borderColor: T.border }}>
      <div>{metric !== undefined && <><div className="display text-xl font-semibold" style={{ color: palette.accent }}>{metric}</div><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{metricLabel}</div></>}</div>
      <span className="text-[10px] font-extrabold" style={{ color: palette.accent }}>Ver detalle <span aria-hidden="true">›</span></span>
    </div>
  </button>;
}

function AgenciaControl({ db, user, refrescar, go }) {
  const serverReady = Boolean(db.agencyServerReady);
  const settings = db.agencySettings || DEFAULT_AGENCY_SETTINGS;
  const intelligence = useMemo(() => buildAgencyIntelligence(db, settings, hoyISO()), [db, settings]);
  const learning = useMemo(() => buildCommercialLearning(db, hoyISO()), [db]);
  const orchestrator = useMemo(() => buildOrchestratorInbox(db), [db]);
  const [briefSource, setBriefSource] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creativeOpen, setCreativeOpen] = useState(false);
  const [opportunityFilter, setOpportunityFilter] = useState("Todas");
  const [expandedOpportunity, setExpandedOpportunity] = useState(null);
  const [creativePackageBrief, setCreativePackageBrief] = useState(null);
  const [creativePackageVariant, setCreativePackageVariant] = useState(0);
  const [agencyView, setAgencyView] = useState("simple");
  const [selectedGoal, setSelectedGoal] = useState("content");
  const [advancedArea, setAdvancedArea] = useState("overview");
  const [advancedDetail, setAdvancedDetail] = useState(null);
  const [brandStudioIntent, setBrandStudioIntent] = useState(null);
  const [brandIdentityDto, setBrandIdentityDto] = useState(null);
  const [brandIdentityLoading, setBrandIdentityLoading] = useState(true);
  const [brandIdentityError, setBrandIdentityError] = useState("");
  const brandIdentityRequestRef = useRef(0);
  const [settingsForm, setSettingsForm] = useState(settings);
  const [briefForm, setBriefForm] = useState({ title: "", objective: "Ventas", channel: "Instagram", offer: "", crmSegment: "", proposedBudget: 0, notes: "" });
  const [creativeForm, setCreativeForm] = useState({ creativeId: "", briefId: "", prompt: "", negativePrompt: "", assetUrl: "" });
  const existingKeys = new Set((db.agencyBriefs || []).map((brief) => brief.decisionKey).filter(Boolean));
  const orchestratedKeys = new Set((db.agencyAgentProposals || []).map((proposal) => proposal.proposalKey));
  const opportunityPillars = ["Todas", ...new Set(intelligence.recommendations.map((item) => item.pillar))];
  const visibleRecommendations = opportunityFilter === "Todas"
    ? intelligence.recommendations
    : intelligence.recommendations.filter((item) => item.pillar === opportunityFilter);
  const creativePackageDraft = useMemo(() => creativePackageBrief
    ? buildCreativePackage(creativePackageBrief, db, creativePackageVariant)
    : null, [creativePackageBrief, creativePackageVariant, db]);
  const creativePackageSaved = creativePackageBrief
    ? (db.agencyCreativeVersions || []).some((version) => String(version.briefId) === String(creativePackageBrief.id))
    : false;
  const friendlyGuide = useMemo(() => buildFriendlyAgencyGuide(db, intelligence, learning), [db, intelligence, learning]);
  const growthEngine = useMemo(() => buildGrowthMultimodeEngine(db, { today: hoyISO() }), [db]);
  const [selectedGrowthModeId, setSelectedGrowthModeId] = useState("");
  const activeGrowthMode = growthEngine.modes.find((mode) => mode.id === selectedGrowthModeId)
    || growthEngine.modes.find((mode) => mode.id === growthEngine.recommendedModeId)
    || growthEngine.modes[0];
  const brandIdentity = useMemo(() => buildBrandIdentityView(brandIdentityDto, db.agencyBrandProfile), [brandIdentityDto, db.agencyBrandProfile]);

  async function loadBrandIdentity({ includeHistory = false, signAssets = false } = {}) {
    const requestId = ++brandIdentityRequestRef.current;
    setBrandIdentityLoading(true); setBrandIdentityError("");
    try {
      const identity = await fetchBrandIdentity({ includeHistory, signAssets });
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityDto(identity);
    }
    catch (error) {
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityError(error.message || "No se pudo verificar la identidad oficial.");
    }
    finally {
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityLoading(false);
    }
  }

  useEffect(() => {
    // H66 entrega los metadatos de Identidad dentro del bundle atómico. No se
    // abre otra RPC al entrar a Agencia; una solicitud aparte queda reservada
    // para firmar los logos cuando la persona abre el detalle.
    brandIdentityRequestRef.current += 1;
    setBrandIdentityDto(db.agencyBrandIdentity || null);
    setBrandIdentityError("");
    setBrandIdentityLoading(false);
  // La versión sellada es la dependencia estable. `db` se clona al aplicar
  // cualquier cambio operativo; depender del objeto volvería a ejecutar este
  // efecto y borraría las URLs firmadas mientras el modal sigue abierto.
  }, [db.agencySnapshotVersion]);

  function openBrandIdentity() {
    showAdvanced("agency-brand-identity");
    loadBrandIdentity({ signAssets: true });
  }

  function showAdvanced(target = "") {
    const creativeTargets = new Set(["agency-collaboration-desk", "agency-retention-lab", "agency-scene-studio", "agency-motion-experience", "agency-scene-router", "agency-quality-control", "agency-approval-center"]);
    const protectionTargets = new Set(["agency-action-center"]);
    const identityTargets = new Set(["agency-brand-identity"]);
    setAdvancedArea(identityTargets.has(target) ? "identity" : creativeTargets.has(target) ? "creative" : protectionTargets.has(target) ? "protection" : "overview");
    const targetDetails = {
      "agency-collaboration-desk": "creative-collaboration",
      "agency-retention-lab": "creative-retention",
      "agency-scene-studio": "creative-studio",
      "agency-motion-experience": "creative-studio",
      "agency-scene-router": "creative-studio",
      "agency-quality-control": "creative-studio",
      "agency-approval-center": "creative-library",
      "agency-action-center": "protection-actions",
      "agency-brand-identity": "identity-overview",
    };
    setAdvancedDetail(targetDetails[target] || null);
    setAgencyView("advanced");
  }

  function openBrandLibrary(intent = {}) {
    setBrandStudioIntent({ key: Date.now(), collection: "Marca", ...intent });
    setAdvancedArea("identity");
    setAdvancedDetail("creative-library");
    setAgencyView("advanced");
  }

  function manualGoalSource(goalId) {
    if (goalId === "sales") return { id: `manual-sales-${Date.now()}`, type: "Impulsar producto", risk: "Bajo", title: "Nueva propuesta para vender más", rationale: "Elegiremos producto, mensaje y canal usando ventas y stock vigentes.", evidence: {} };
    if (goalId === "customers") return { id: `manual-crm-${Date.now()}`, type: "Contactar segmento", risk: "Bajo", title: "Nueva activación de clientes", rationale: "Definiremos el segmento y solo incluiremos clientes con permiso de contacto.", evidence: {}, crmSegment: "Clientes con permiso" };
    return { id: `manual-content-${Date.now()}`, type: "Crear contenido", risk: "Bajo", title: "Nuevo contenido MOMOS", rationale: "Definiremos producto, objetivo y canal antes de preparar la pieza.", evidence: {}, channel: "Instagram" };
  }

  function continueFriendlyGoal() {
    if (selectedGoal === "content" && friendlyGuide.activeFlight) { showAdvanced(friendlyGuide.activeFlight.current.target); return; }
    if (selectedGoal === "results") { showAdvanced(); return; }
    if (selectedGoal === "sales" && activeGrowthMode) { openBrief(activeGrowthMode.recommendation); return; }
    openBrief(friendlyGuide.recommendations[selectedGoal] || manualGoalSource(selectedGoal));
  }

  async function useGrowthMode(mode) {
    if (db.agencyGrowthReady) {
      const snapshot = await registrarSnapshotMotorCrecimiento(growthSnapshotPayload(growthEngine));
      await seleccionarModoCrecimiento(snapshot.id, mode.id, mode.objective);
      toast("ok", `${mode.shortLabel} quedó elegido con los hechos actuales; todavía no se ejecutó nada.`);
      await refrescar();
    } else {
      toast("alert", "La estrategia puede prepararse, pero aplicá el Hito 53 para sellar la elección en el servidor.");
    }
    openBrief(mode.recommendation);
  }

  function openBrief(recommendation = null) {
    const source = recommendation || {
      id: `manual-${Date.now()}`, type: "Crear contenido", risk: "Bajo",
      title: "Nueva oportunidad comercial", rationale: "Brief iniciado manualmente por el equipo.", evidence: {},
    };
    setBriefSource(source);
    setBriefForm({
      title: source.title,
      objective: source.type === "Contactar segmento" ? "Recompra"
        : source.type === "Activar cumpleaños" ? "Cumpleaños"
          : ["Crear contenido", "Repetir creativo"].includes(source.type) ? "Contenido" : "Ventas",
      channel: source.channel || (source.type === "Contactar segmento" ? "WhatsApp" : "Instagram"),
      offer: source.suggestedOffer || "", crmSegment: source.crmSegment || "",
      proposedBudget: source.proposedBudget || 0, notes: source.rationale,
    });
  }

  async function saveBrief() {
    if (!serverReady) throw new Error("Aplicá primero la migración 16 de Agencia Comercial.");
    const created = await crearBriefAgencia({
      decision_key: briefSource.id, title: briefForm.title, objective: briefForm.objective,
      campaign_id: briefSource.campaignId || null, product_id: briefSource.productId || null,
      crm_segment: briefForm.crmSegment, offer: briefForm.offer, channel: briefForm.channel,
      deliverables: ["Crear contenido", "Repetir creativo", "Impulsar producto", "Mover inventario"].includes(briefSource.type)
        ? ["Pieza principal", "Adaptación para historias"] : [],
      insight: briefSource.rationale, evidence: briefSource.evidence || {}, proposed_budget: Number(briefForm.proposedBudget || 0), notes: briefForm.notes,
    });
    await crearDecisionAgencia({
      brief_id: created.brief_id, campaign_id: briefSource.campaignId || null, creative_id: briefSource.creativeId || null,
      type: agencyDecisionType(briefSource.type), title: briefSource.title, rationale: briefSource.rationale,
      evidence: briefSource.evidence || {}, risk_level: briefSource.risk, author: "reglas",
      proposed_action: {
        product_id: briefSource.productId || null, creative_id: briefSource.creativeId || null,
        proposed_budget: Number(briefForm.proposedBudget || 0), customer_ids: briefSource.customerIds || [],
      },
    });
    setBriefSource(null);
    toast("ok", "Brief y decisión guardados con trazabilidad");
    await refrescar();
  }

  async function saveSettings() {
    await guardarConfiguracionAgencia({
      autonomy_mode: settingsForm.autonomyMode, daily_budget_limit: Number(settingsForm.dailyBudgetLimit),
      campaign_budget_limit: Number(settingsForm.campaignBudgetLimit), scale_step_pct: Number(settingsForm.scaleStepPct),
      require_creative_approval: settingsForm.requireCreativeApproval, block_out_of_stock: settingsForm.blockOutOfStock,
      contact_only_authorized: settingsForm.contactOnlyAuthorized, paused: settingsForm.paused,
    });
    setSettingsOpen(false); toast("ok", "Guardas comerciales actualizadas"); await refrescar();
  }

  async function advanceBrief(brief) {
    const next = { "Borrador": "En revisión", "En revisión": "Aprobado", "Aprobado": "En producción", "En producción": "Completado" }[brief.status];
    if (!next) return;
    await setEstadoBriefAgencia(brief.id, next, `${next} desde Agencia MOMOS`);
    toast("ok", `Brief #${brief.id}: ${next}`); await refrescar();
  }

  async function advanceDecision(decision) {
    if (decision.status === "Propuesta") {
      await resolverDecisionAgencia(decision.id, "Aprobada", "Aprobación humana desde Agencia MOMOS");
      toast("ok", `Decisión #${decision.id} aprobada`); await refrescar(); return;
    }
    throw new Error("Las decisiones aprobadas se cierran con evidencia desde la Bandeja de acciones de Agencia.");
  }

  async function sendToOrchestrator(recommendation) {
    if (!db.agencyOrchestratorReady) throw new Error("Aplicá la migración 28 del Orquestador de Agencia.");
    await registrarRecomendacionOrquestador(orchestratorProposalPayload(recommendation));
    toast("ok", "Propuesta sellada en el Cerebro de Agencia; todavía no ejecutó ninguna acción.");
    await refrescar();
  }

  async function resolveOrchestratorProposal(proposal, decision) {
    let note = "Aprobación humana desde Agencia MOMOS";
    if (decision === "Descartar") {
      note = window.prompt("¿Por qué descartamos esta propuesta?", "No corresponde al momento comercial actual") || "";
      if (!note) return;
    }
    await resolverPropuestaOrquestador(proposal.id, decision, note);
    toast("ok", decision === "Aprobar" ? "Propuesta convertida en decisión aprobada; aún no se ejecutó." : "Propuesta descartada con trazabilidad.");
    await refrescar();
  }

  function openCreativeVersion() {
    const creative = (db.creatives || []).find((item) => !["Publicado","Ganador"].includes(item.estado)) || (db.creatives || [])[0];
    const tone = (db.brand_library?.tono || []).join(", ");
    setCreativeForm({
      creativeId: creative?.id || "", briefId: "",
      prompt: creative ? `Crear ${creative.formato} para ${creative.productoFoco || creative.titulo}. Hook: ${creative.hook || "momento MOMOS"}. Tono de marca: ${tone || "tierno, premium y cercano"}.` : "",
      negativePrompt: (db.brand_library?.palabrasNo || []).join(", "), assetUrl: creative?.assetUrl || "",
    });
    setCreativeOpen(true);
  }

  async function saveCreativeVersion() {
    if (!creativeForm.creativeId) throw new Error("Elegí el creativo que vas a versionar.");
    await crearVersionCreativaAgencia({
      creative_id: creativeForm.creativeId, brief_id: creativeForm.briefId || null,
      provider: "manual", prompt: creativeForm.prompt, negative_prompt: creativeForm.negativePrompt,
      asset_url: creativeForm.assetUrl, thumbnail_url: creativeForm.assetUrl, generation_cost: 0,
    });
    setCreativeOpen(false); toast("ok", "Versión creativa guardada con la marca usada como evidencia"); await refrescar();
  }

  function openCreativePackage(brief) {
    setCreativePackageVariant(0);
    setCreativePackageBrief(brief);
  }

  async function saveCreativePackage() {
    const brief = creativePackageBrief; const draft = creativePackageDraft;
    if (!brief || !draft) return;
    if (!["Aprobado", "En producción"].includes(brief.status)) {
      toast("alert", "El paquete puede revisarse, pero solo se guarda cuando el brief tenga aprobación humana."); return;
    }
    if (!draft.audit.passed) {
      toast("error", draft.audit.errors[0] || "El paquete no pasó el control de marca."); return;
    }
    const marker = `[AGENCY_BRIEF:${brief.id}]`;
    const existingVersion = (db.agencyCreativeVersions || []).find((version) => String(version.briefId) === String(brief.id));
    let creativeId = existingVersion?.creativeId || (db.creatives || []).find((creative) => String(creative.notas || "").includes(marker))?.id || "";
    try {
      if (!creativeId) {
        const created = await crearCreativo({
          campaign_id: draft.campaignId || null, titulo: draft.title, canal: draft.channel, formato: draft.format,
          producto_foco_id: draft.productId || null, figura: null, sabor: null, hook: draft.selectedHook,
          copy: draft.copy, guion: draft.script.join("\n"), estado: "Idea", responsable: "Marketing",
          fecha_entrega: dISO(3), asset_url: "", notas: `${marker} Borrador generado desde Agencia MOMOS; requiere revisión humana.`,
        });
        creativeId = created.id;
      }
      if (!existingVersion) {
        await crearVersionCreativaAgencia({
          creative_id: creativeId, brief_id: brief.id, provider: "momos-ops-rules",
          prompt: draft.prompt, negative_prompt: draft.negativePrompt, brand_snapshot: draft.brandSnapshot,
          asset_url: "", thumbnail_url: "", generation_cost: 0,
        });
      }
      setCreativePackageBrief(null);
      toast("ok", `Paquete guardado como creativo ${creativeId}; continúa en Idea hasta revisión humana.`);
      await refrescar();
    } catch (error) {
      toast("error", creativeId
        ? `El creativo ${creativeId} quedó guardado, pero falta completar su versión trazable. Reintentá: ${error.message}`
        : error.message);
      try { await refrescar(); } catch { /* conserva la recuperación por marcador al recargar */ }
    }
  }

  async function reviewCreativeVersion(version, status) {
    await revisarVersionCreativaAgencia(version.id, status, status === "Aprobada" ? "Aprobación humana en Agencia MOMOS" : "Lista para revisión humana");
    toast("ok", `Versión ${version.version}: ${status}`); await refrescar();
  }

  const money = (value) => fmt(Math.round(Number(value || 0)));
  const riskStyle = (risk) => risk === "Alto" ? { bg: "#F6D4CD", fg: "#A03B2A" } : risk === "Medio" ? { bg: "#FBE8C8", fg: "#96690F" } : { bg: "#DDEBD9", fg: "#3F6B42" };
  const learningStyle = (stage) => ({
    winner: { bg: "#DDEBD9", fg: "#315B35", border: "#B8D3B2" },
    funnel: { bg: "#FBE8C8", fg: "#8B5A08", border: "#EACB92" },
    spend: { bg: "#F6D4CD", fg: "#A03B2A", border: "#E6B7AE" },
    ambiguous: { bg: "#FFF2D8", fg: "#7A5410", border: "#E8C98B" },
    collecting: { bg: "#E5EEF7", fg: "#315A7D", border: "#C7D8E8" },
    promising: { bg: "#E9E4F4", fg: "#5C4C7D", border: "#D4C9E7" },
    missing: { bg: "#F5E9D8", fg: T.choco2, border: T.border },
    inconclusive: { bg: "#F3EEE8", fg: T.choco2, border: T.border },
  }[stage] || { bg: "#F3EEE8", fg: T.choco2, border: T.border });
  const pillarIcon = { Inventario: "📦", Pauta: "📣", CRM: "💗", Producto: "🍨", Contenido: "🎨", Marca: "✦", General: "◎" };
  const evidenceValue = (value) => {
    if (Array.isArray(value)) return `${value.length} registro(s)`;
    if (value && typeof value === "object") return JSON.stringify(value).slice(0, 120);
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
    return String(value ?? "—");
  };
  const pipelineSteps = [
    ["Oportunidades", intelligence.pipeline.opportunities, "Detectadas"],
    ["Briefs", intelligence.pipeline.briefs, "En curso"],
    ["Aprobaciones", intelligence.pipeline.approvals, "Humanas"],
    ["Creativo", intelligence.pipeline.creativeReview, "En revisión"],
    ["Programado", intelligence.pipeline.scheduled, "Próx. 7 días"],
    ["Aprendizaje", learning.summary.conclusive, "Lecturas concluyentes"],
  ];
  const advancedAreas = [
    { id: "overview", icon: "⌂", label: "Resumen", description: "Qué está avanzando", count: friendlyGuide.activeFlightCount },
    { id: "identity", icon: "✦", label: "Marca", description: "Cómo debe verse", count: brandIdentity.logos.length },
    { id: "strategy", icon: "✦", label: "Oportunidades", description: "Qué conviene hacer", count: intelligence.recommendations.length },
    { id: "creative", icon: "🎨", label: "Crear", description: "Del guion al archivo", count: intelligence.pipeline.briefs },
    { id: "results", icon: "📊", label: "Resultados", description: "Qué funcionó", count: learning.summary.conclusive },
    { id: "protection", icon: "✓", label: "Revisión", description: "Aprobar y proteger", count: intelligence.pipeline.approvals },
  ];
  const advancedAreaCopy = {
    overview: ["Estado general", "Revisá el trabajo en curso y abrí únicamente el siguiente paso."],
    identity: ["Identidad de MOMOS", "Logo, colores, tipografías, voz y estilo que deben respetar todas las piezas."],
    strategy: ["Decidir qué hacer", "MOMO OPS reúne oportunidades y alternativas para que el equipo elija."],
    creative: ["Construir contenido", "Guion, escenas, movimiento y calidad organizados como una sola ruta."],
    results: ["Aprender y mejorar", "Ventas, publicaciones y pauta convertidas en decisiones comprensibles."],
    protection: ["Aprobar con seguridad", "Acciones, permisos y límites que siempre requieren una persona."],
  };
  const activeAdvancedArea = advancedAreas.find((item) => item.id === advancedArea) || advancedAreas[0];
  const advancedModules = {
    overview: [
      { id: "overview-pipeline", icon: "🧭", eyebrow: "Estado general", title: "Recorrido de la agencia", description: "Mirá cuántas oportunidades, briefs, aprobaciones y piezas están avanzando.", metric: friendlyGuide.activeFlightCount, metricLabel: "trabajos activos", tone: "blue" },
      { id: "overview-flight", icon: "🎬", eyebrow: "Siguiente paso", title: "Producción creativa en curso", description: "Abrí únicamente el trabajo que necesita continuar ahora.", metric: intelligence.pipeline.creativeReview, metricLabel: "en revisión", tone: "coral" },
    ],
    identity: [
      { id: "identity-overview", icon: "✦", eyebrow: "Fuente oficial", title: "Identidad de marca MOMOS", description: "Logo, paleta, tipografía, voz y reglas de uso reunidas en una versión aprobada.", metric: brandIdentity.logos.length, metricLabel: "logos oficiales", tone: brandIdentity.ready ? "green" : "gold" },
      { id: "creative-library", icon: "🎨", eyebrow: "Archivos originales", title: "Biblioteca creativa", description: "Fotos, videos, logos y referencias con derechos y trazabilidad.", metric: (db.brandMediaAssets || []).length, metricLabel: "archivos", tone: "coral" },
    ],
    strategy: [
      { id: "strategy-opportunities", icon: "✦", eyebrow: "Radar comercial", title: "Oportunidades para crecer", description: "Recomendaciones explicadas con ventas, clientes, stock y contenido real.", metric: intelligence.recommendations.length, metricLabel: "oportunidades", tone: "coral" },
      { id: "strategy-scenarios", icon: "▣", eyebrow: "Antes de invertir", title: "Comparar alternativas", description: "Revisá escenarios y sus alertas sin cambiar campañas ni presupuesto.", metric: (db.agencyMetaInvestmentScenarios || []).length, metricLabel: "escenarios", tone: "gold" },
      { id: "strategy-brain", icon: "🧠", eyebrow: "Propuestas protegidas", title: "Cerebro de Agencia MOMOS", description: "Propuestas trazables que el equipo puede aprobar o descartar.", metric: orchestrator.summary.pending, metricLabel: "por revisar", tone: "rose" },
    ],
    creative: [
      { id: "creative-collaboration", icon: "🤝", eyebrow: "Trabajo en equipo", title: "Mesa creativa", description: "Hechos, decisiones y aportes humanos organizados alrededor de cada pieza.", metric: intelligence.pipeline.briefs, metricLabel: "briefs", tone: "blue" },
      { id: "creative-retention", icon: "🪝", eyebrow: "Guion y atención", title: "Hooks y retención", description: "Diseñá aperturas, loops y aprendizajes para sostener la atención.", metric: learning.summary.conclusive, metricLabel: "aprendizajes", tone: "gold" },
      { id: "creative-studio", icon: "🎥", eyebrow: "De idea a tomas", title: "Estudio de producción", description: "Storyboard, cámara, movimiento, motores y control de calidad en una sola ruta.", metric: intelligence.pipeline.creativeReview, metricLabel: "piezas activas", tone: "coral" },
      { id: "creative-library", icon: "🎨", eyebrow: "Marca y archivos", title: "Biblioteca creativa", description: "Briefs, versiones y reglas de marca con todo el detalle disponible al abrir.", metric: (db.agencyCreativeVersions || []).length, metricLabel: "versiones", tone: "green" },
    ],
    results: [
      { id: "results-learning", icon: "📈", eyebrow: "Aprendizaje comercial", title: "Qué funcionó", description: "Ventas, gasto y pedidos ligados a cada publicación sin inventar ganadores.", metric: learning.summary.conclusive, metricLabel: "conclusiones", tone: "green" },
      { id: "results-meta", icon: "◎", eyebrow: "Lectura de plataformas", title: "Resultados de Meta", description: "Snapshots y métricas verificables en modo de solo lectura.", metric: learning.summary.published, metricLabel: "publicadas", tone: "blue" },
      { id: "results-incrementality", icon: "⇄", eyebrow: "Impacto real", title: "Incrementalidad", description: "Separá correlación de ventas que realmente produjo la campaña.", metric: learning.summary.winners, metricLabel: "ganadoras", tone: "rose" },
    ],
    protection: [
      { id: "protection-actions", icon: "🎯", eyebrow: "Decisiones del equipo", title: "Acciones por aprobar", description: "Una acción clara por tarjeta, con responsable y siguiente paso.", metric: intelligence.pipeline.approvals, metricLabel: "por revisar", tone: "coral" },
      { id: "protection-meta", icon: "✓", eyebrow: "Inversión protegida", title: "Permisos de Meta", description: "Vigencia, alcance y doble aprobación antes de cualquier cambio externo.", metric: 0, metricLabel: "sin ejecutar", tone: "green" },
      { id: "protection-guards", icon: "🛡️", eyebrow: "Límites operativos", title: "Guardas de la agencia", description: "Presupuesto, stock, contactos y parada de emergencia en lenguaje sencillo.", metric: settings.paused ? 1 : 0, metricLabel: settings.paused ? "agencia pausada" : "alertas", tone: "gold" },
    ],
  };
  const activeAdvancedModules = advancedModules[advancedArea] || advancedModules.overview;
  const selectedAdvancedModule = Object.values(advancedModules).flat().find((item) => item.id === advancedDetail);

  return (
    <section className="mb-6" aria-label="Agencia Comercial MOMOS">
      <div className="rounded-2xl overflow-hidden border shadow-sm" style={{ borderColor: T.border, background: T.surface }}>
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface }}>
          <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: T.coralSoft }}>✦</span><div><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-extrabold tracking-[.18em] uppercase" style={{ color: T.coral }}>MOMO OPS Intelligence</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: settings.paused ? "#F6D4CD" : "#DDEBD9", color: settings.paused ? "#A03B2A" : "#315B35" }}>{settings.paused ? "Pausada" : "Protegida"}</span></div><h2 className="display text-xl font-semibold mt-0.5 mb-0">Tu agencia comercial</h2><p className="text-xs mt-1 mb-0 max-w-2xl" style={{ color: T.choco2 }}>Elegí qué quieres lograr. MOMOS prepara una propuesta y vos aprobás el resultado.</p></div></div>
          <div className="flex flex-col gap-2 shrink-0">
            <div className="grid grid-cols-3 gap-2">{[["✓","Marca"],["✓","Revisión"],["✓","Datos reales"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[72px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold" style={{ color: "#3F6B42" }}>{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            <button type="button" aria-label="Abrir Biblioteca de fotos, videos y marca" onClick={() => openBrandLibrary()} className="w-full rounded-xl border px-3 py-2.5 flex items-center gap-3 text-left transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1" style={{ borderColor: "#E9A18F", background: "#FFF5F0", "--tw-ring-color": T.coral }}>
              <span className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: T.coralSoft }} aria-hidden="true">🖼️</span>
              <span className="flex-1 min-w-0"><span className="block text-xs font-extrabold" style={{ color: T.choco }}>Abrir Biblioteca</span><span className="block text-[9px]" style={{ color: T.choco2 }}>Fotos, videos, logos y marca · {(db.brandMediaAssets || []).filter((asset) => asset.status === "Activo").length} activos</span></span>
              <span className="text-base font-bold" style={{ color: T.coral }} aria-hidden="true">›</span>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {!serverReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Vista inteligente activa · aplicá <code>agencia-comercial-v1.sql</code> para guardar briefs, aprobaciones y decisiones en el servidor.</div>}

          {agencyView === "simple" ? <AgencyFriendlyHome guide={friendlyGuide} selectedGoal={selectedGoal} onSelectGoal={setSelectedGoal} onContinue={continueFriendlyGoal} onAdvanced={() => showAdvanced()} growthEngine={growthEngine} selectedGrowthModeId={activeGrowthMode?.id} onSelectGrowthMode={setSelectedGrowthModeId} onUseGrowthMode={useGrowthMode} brandIdentity={brandIdentity} brandIdentityLoading={brandIdentityLoading} brandIdentityError={brandIdentityError} onOpenIdentity={openBrandIdentity} /> : <>
          <div className="sticky top-2 z-20 rounded-2xl border p-3 mb-4 shadow-sm" style={{ borderColor: T.border, background: "rgba(255,253,250,.97)", backdropFilter: "blur(10px)" }}>
            <div className="flex items-center justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Centro de Agencia MOMOS</div><div className="text-xs font-bold">Elegí el área que quieres revisar</div></div><Btn small kind="ghost" onClick={() => { setAgencyView("simple"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>← Inicio sencillo</Btn></div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" role="tablist" aria-label="Áreas del Centro de Agencia MOMOS">{advancedAreas.map((area) => { const active = area.id === advancedArea; return <button key={area.id} type="button" role="tab" aria-selected={active} onClick={() => setAdvancedArea(area.id)} className="rounded-xl border px-3 py-2.5 text-left transition" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface }}><div className="flex items-center justify-between gap-2"><span className="text-sm">{area.icon}</span><span className="rounded-full min-w-5 h-5 px-1 grid place-items-center text-[8px] font-extrabold" style={{ background: active ? T.coralSoft : T.vainilla }}>{area.count}</span></div><div className="text-[11px] font-extrabold mt-1">{area.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{area.description}</div></button>; })}</div>
          </div>

          <div className="rounded-2xl border px-4 py-3 mb-4 flex items-start gap-3" style={{ borderColor: T.border, background: T.vainilla }}><span className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: T.surface }}>{activeAdvancedArea.icon}</span><div><div className="display text-base font-semibold">{advancedAreaCopy[advancedArea][0]}</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>{advancedAreaCopy[advancedArea][1]}</div></div></div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-5" aria-label={`Herramientas de ${activeAdvancedArea.label}`}>
            {activeAdvancedModules.map((module) => <AgencyAdvancedModuleCard key={module.id} {...module} status={module.metric > 0 ? "Con información" : "Listo para usar"} onOpen={() => { if (module.id === "creative-library") setBrandStudioIntent({ key: Date.now(), collection: "Marca" }); setAdvancedDetail(module.id); }} />)}
          </div>
          <div className="rounded-2xl border px-4 py-3 text-[10px] flex items-start gap-2" style={{ borderColor: T.border, background: "#FFF9F1", color: T.choco2 }}><span aria-hidden="true">💡</span><span><b style={{ color: T.choco }}>Vista limpia:</b> cada tarjeta muestra solo lo necesario. Abrila para consultar datos, evidencia y controles completos.</span></div>

          {advancedDetail === "overview-pipeline" && <Modal title="Recorrido de la agencia" onClose={() => setAdvancedDetail(null)} extraWide><div className="rounded-2xl border p-4 mb-5" style={{ borderColor: T.border, background: T.surface }}>
            <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
              <div><div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Recorrido comercial</div><div className="display text-lg font-semibold">Cómo avanza el trabajo</div></div>
              <div className="text-[11px]" style={{ color: T.choco2 }}>Cada número abre una decisión del equipo.</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {pipelineSteps.map(([label, value, sub], index) => <div key={label} className="relative rounded-2xl border px-3 py-3" style={{ borderColor: T.border, background: index === 0 ? "#FFF" : "rgba(255,255,255,.64)" }}>
                <div className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color: T.choco2 }}>{String(index + 1).padStart(2, "0")} · {label}</div>
                <div className="display text-2xl font-semibold" style={{ color: index === 0 ? T.coral : T.choco }}>{value}</div>
                <div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{sub}</div>
              </div>)}
            </div>
          </div>

          </Modal>}
          {advancedDetail === "overview-flight" && <Modal title="Producción creativa en curso" onClose={() => setAdvancedDetail(null)} extraWide><AgencyCreativeFlightCenter db={db} go={go} refrescar={refrescar} /></Modal>}
          {advancedDetail === "identity-overview" && <Modal title="Identidad de marca MOMOS" onClose={() => setAdvancedDetail(null)} extraWide><BrandIdentityPanel identity={brandIdentity} loading={brandIdentityLoading} error={brandIdentityError} onRetry={() => loadBrandIdentity({ includeHistory: true, signAssets: true })} onOpenLibrary={openBrandLibrary} /></Modal>}
          {advancedDetail === "protection-actions" && <Modal title="Acciones por aprobar" onClose={() => setAdvancedDetail(null)} extraWide><AgencyActionCenter db={db} go={go} refrescar={refrescar} /></Modal>}
          {advancedDetail === "protection-meta" && <Modal title="Permisos de inversión Meta" onClose={() => setAdvancedDetail(null)} extraWide><AgencyMetaAuthorizationPanel db={db} refrescar={refrescar} /></Modal>}
          {advancedDetail === "protection-guards" && <Modal title="Guardas de la agencia" onClose={() => setAdvancedDetail(null)}><div className="rounded-2xl p-4 mb-4 text-sm" style={{ background: T.vainilla }}>Definí límites claros. Ningún cambio publica, contacta ni gasta por sí solo.</div><Btn onClick={() => { setAdvancedDetail(null); setSettingsForm(settings); setSettingsOpen(true); }}>Revisar guardas</Btn></Modal>}
          {advancedDetail === "results-meta" && <Modal title="Resultados de Meta" onClose={() => setAdvancedDetail(null)} extraWide><AgencyMetaObservatory db={db} refrescar={refrescar} /></Modal>}
          {advancedDetail === "results-incrementality" && <Modal title="Incrementalidad Meta" onClose={() => setAdvancedDetail(null)} extraWide><AgencyMetaIncrementality db={db} refrescar={refrescar} /></Modal>}
          {advancedDetail === "strategy-scenarios" && <Modal title="Comparar alternativas antes de invertir" onClose={() => setAdvancedDetail(null)} extraWide><AgencyMetaInvestmentScenarios db={db} refrescar={refrescar} /></Modal>}
          {advancedDetail === "creative-collaboration" && <Modal title="Mesa creativa MOMOS" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-collaboration-desk"><AgencyCollaborationDesk db={db} refrescar={refrescar} /></div></Modal>}
          {advancedDetail === "creative-retention" && <Modal title="Hooks, retención y aprendizaje" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-retention-lab"><AgencyRetentionLab db={db} refrescar={refrescar} /></div><AgencyLoopLearningDesk db={db} refrescar={refrescar} /></Modal>}
          {advancedDetail === "creative-studio" && <Modal title="Estudio de producción creativa" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-scene-studio"><AgencySceneStudio db={db} refrescar={refrescar} /></div><div id="agency-motion-experience"><AgencyMotionExperience db={db} refrescar={refrescar} /></div><div id="agency-scene-router"><AgencySceneRouter db={db} refrescar={refrescar} /></div><div id="agency-quality-control"><AgencyQualityControl db={db} refrescar={refrescar} /></div></Modal>}

          {["strategy-brain", "strategy-opportunities"].includes(advancedDetail) && <Modal title={selectedAdvancedModule?.title || "Estrategia comercial"} onClose={() => setAdvancedDetail(null)} extraWide><div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
            <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#4A3028,#704334)", color: "#fff" }}>
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>🧠</div>
                <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Orquestador protegido · MCP</div><div className="display text-xl font-semibold">Cerebro de Agencia MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Recibe señales y propuestas de agentes, declara qué herramientas necesita y sella evidencia, confianza y costo. Nunca publica ni gasta por sí solo.</div></div>
              </div>
              <div className="grid grid-cols-3 gap-2 shrink-0">
                {[["Pendientes",orchestrator.summary.pending],["Externas",orchestrator.summary.externalActions],["Costo máx.",money(orchestrator.summary.estimatedCost)]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[76px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}
              </div>
            </div>
            {!db.agencyOrchestratorReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>orquestador-agencia-v1.sql</code> para habilitar la bandeja gobernada y el contrato para MCP.</div> : orchestrator.pending.length === 0 ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Bandeja al día.</b> Enviá una oportunidad del radar o conectá un agente MCP para recibir propuestas trazables.</div> : <div className="p-3 grid lg:grid-cols-2 gap-2">
              {orchestrator.pending.slice(0, 4).map((proposal) => <article key={proposal.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
                <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{proposal.decisionType} · riesgo {proposal.riskLevel}</div><div className="font-extrabold text-sm">{proposal.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold shrink-0" style={{ background: "#E5EEF7", color: "#315A7D" }}>{Math.round(proposal.confidence * 100)}% confianza</span></div>
                <p className="text-[11px] leading-relaxed my-2" style={{ color: T.choco2 }}>{proposal.rationale}</p>
                <div className="flex flex-wrap gap-1 mb-2">{proposal.requiredTools.map((tool) => <span key={tool} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{tool}</span>)}</div>
                <div className="rounded-xl px-2.5 py-2 mb-2 text-[10px]" style={{ background: "#F5E9D8" }}><b>{proposal.executionMode}</b> · costo máximo {money(proposal.costCapCop)} · huella {proposal.fingerprint.slice(0, 8)}</div>
                <div className="flex flex-wrap gap-2"><BtnAsync small onClick={() => resolveOrchestratorProposal(proposal, "Aprobar")}>Aprobar propuesta</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveOrchestratorProposal(proposal, "Descartar")}>Descartar</BtnAsync></div>
              </article>)}
            </div>}
            <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Aprobar crea una decisión comercial aprobada, no una ejecución. Pauta, publicación, contacto y gasto conservan su confirmación y sus guardas.</div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div><div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Radar de oportunidades</div><div className="display text-xl font-semibold">Qué conviene hacer ahora</div><div className="text-sm" style={{ color: T.choco2 }}>Cruza pedidos pagados, stock, CRM, contenido y pauta; cada recomendación explica su evidencia.</div></div>
            <div className="flex gap-2"><Btn kind="soft" small onClick={() => openBrief()}>＋ Brief manual</Btn>{user === "Administrador" && <Btn kind="ghost" small onClick={() => { setSettingsForm(settings); setSettingsOpen(true); }}>⚙ Guardas</Btn>}</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Filtrar oportunidades por área">
            {opportunityPillars.map((pillar) => {
              const active = opportunityFilter === pillar;
              const count = pillar === "Todas" ? intelligence.recommendations.length : intelligence.recommendations.filter((item) => item.pillar === pillar).length;
              return <button key={pillar} type="button" role="tab" aria-selected={active} onClick={() => setOpportunityFilter(pillar)} className="shrink-0 rounded-full border px-3 py-2 text-[11px] font-extrabold transition"
                style={{ borderColor: active ? T.coral : T.border, background: active ? T.coral : "#fff", color: active ? "#fff" : T.choco }}>
                {pillar === "Todas" ? "◎" : pillarIcon[pillar] || "◎"} {pillar} <span className="ml-1 opacity-75">{count}</span>
              </button>;
            })}
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            {visibleRecommendations.slice(0, 8).map((item) => {
              const guard = item.guard; const risk = riskStyle(item.risk); const created = existingKeys.has(item.id);
              const expanded = expandedOpportunity === item.id;
              return <article key={item.id} className="rounded-3xl border p-4 sm:p-5 flex flex-col shadow-sm" style={{ borderColor: guard.allowed ? T.border : "#E6B7AE", background: guard.allowed ? "linear-gradient(145deg,#FFF,#FFF8F2)" : "#FFF5F2" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2"><span className="w-9 h-9 shrink-0 rounded-2xl grid place-items-center text-base" style={{ background: T.vainilla }}>{pillarIcon[item.pillar] || "◎"}</span><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.choco2 }}>{item.pillar}</div><div className="text-[11px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{item.type}</div></div></div>
                  <div className="flex flex-wrap justify-end gap-1"><span className="px-2 py-1 rounded-full text-[9px] font-extrabold" style={{ background: T.vainilla, color: T.choco }}>Prioridad {item.priority}</span><span className="px-2 py-1 rounded-full text-[9px] font-extrabold" style={{ background: risk.bg, color: risk.fg }}>Riesgo {item.risk}</span></div>
                </div>
                <h3 className="display text-lg font-semibold mt-3 mb-1">{item.title}</h3>
                <p className="text-xs leading-relaxed mb-3" style={{ color: T.choco2 }}>{item.rationale}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">{item.signals.map((itemSignal) => <span key={itemSignal} className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: "#F5E9D8", color: T.choco }}>{itemSignal}</span>)}</div>
                <div className="rounded-2xl px-3 py-2.5 mb-3" style={{ background: "#F8EFE4", borderLeft: `3px solid ${T.coral}` }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Siguiente paso</div><div className="text-[11px] leading-relaxed font-semibold" style={{ color: T.choco }}>{item.nextStep}</div></div>
                <button type="button" className="self-start border-0 bg-transparent p-0 mb-3 text-[11px] font-extrabold underline" style={{ color: T.choco2 }} onClick={() => setExpandedOpportunity(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "Ocultar evidencia" : "Ver evidencia y confianza"}</button>
                {expanded && <div className="rounded-2xl p-3 mb-3 text-[11px]" style={{ background: "#fff", border: `1px dashed ${T.border}` }}>
                  <div className="font-extrabold mb-2" style={{ color: T.choco }}>Confianza {item.confidence} · fuente interna de MOMO OPS</div>
                  <div className="grid sm:grid-cols-2 gap-1.5">{Object.entries(item.evidence || {}).map(([key, value]) => <div key={key} className="flex justify-between gap-2"><span style={{ color: T.choco2 }}>{key}</span><b className="text-right break-all">{evidenceValue(value)}</b></div>)}</div>
                </div>}
                <div className="mt-auto">
                  <div className="rounded-xl px-3 py-2 text-[11px] mb-3" style={{ background: guard.allowed ? "#E8F1E4" : "#F6D4CD", color: guard.allowed ? "#3F6B42" : "#A03B2A" }}>
                    {guard.allowed ? "✓ Pasa las guardas; requiere aprobación según el modo." : `⛔ ${guard.reasons[0]}`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <BtnAsync small disabled={orchestratedKeys.has(`momos:${item.id}`) || !db.agencyOrchestratorReady || !guard.allowed} onClick={() => sendToOrchestrator(item)}>{orchestratedKeys.has(`momos:${item.id}`) ? "En el cerebro ✓" : "Enviar al cerebro"}</BtnAsync>
                    <Btn small kind="ghost" disabled={created || !serverReady || !guard.allowed} onClick={() => openBrief(item)}>{created ? "Brief creado ✓" : guard.allowed ? "Crear brief directo" : "Bloqueada por guardas"}</Btn>
                  </div>
                </div>
              </article>;
            })}
          </div>
          {visibleRecommendations.length === 0 && <Empty icon="✦" text="No hay oportunidades en este frente hoy. El radar seguirá cruzando operación, clientes y campañas." />}
          </Modal>}

          {advancedDetail === "results-learning" && <Modal title="Qué funcionó y qué conviene repetir" onClose={() => setAdvancedDetail(null)} extraWide><div className="mt-2 mb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Sala de aprendizaje</div>
              <div className="display text-xl font-semibold">Qué aprendimos de lo publicado</div>
              <div className="text-sm max-w-3xl" style={{ color: T.choco2 }}>Cruza la publicación exacta, métricas de plataforma, gasto y pedidos pagados. Si la atribución es dudosa, MOMO OPS espera y no inventa un ganador.</div>
            </div>
            <span className="self-start sm:self-auto rounded-full px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider" style={{ background: T.vainilla, color: T.choco }}>Decisiones con evidencia</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
            {[
              ["Publicadas", learning.summary.published],
              ["Sin métricas", learning.summary.missingMetrics],
              ["Conclusiones", learning.summary.conclusive],
              ["Ganadoras", learning.summary.winners],
              ["Atribución pendiente", learning.summary.ambiguousAttribution],
            ].map(([label, value]) => <div key={label} className="rounded-2xl border px-3 py-3" style={{ borderColor: T.border, background: "#FFF9F1" }}>
              <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div>
              <div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div>
            </div>)}
          </div>
          {learning.items.length > 0 ? <div className="grid lg:grid-cols-2 gap-3 mb-6">
            {learning.items.slice(0, 6).map((item) => {
              const stageStyle = learningStyle(item.stage.key);
              const recommendation = item.recommendation;
              const guard = recommendation ? guardAgencyAction({ ...recommendation, today: hoyISO(), execute: false }, db, settings) : null;
              const created = recommendation ? existingKeys.has(recommendation.id) : false;
              return <article key={item.post.id} className="rounded-3xl border p-4 flex flex-col shadow-sm" style={{ borderColor: stageStyle.border, background: "linear-gradient(145deg,#FFF,#FFF9F2)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{item.post.canal || "Canal"} · {item.post.fecha} · {item.post.id}</div>
                    <h3 className="display text-lg font-semibold mt-1 mb-0">{item.creative?.titulo || item.post.titulo || "Publicación MOMOS"}</h3>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase" style={{ background: stageStyle.bg, color: stageStyle.fg }}>{item.stage.label}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3">
                  {[
                    ["Pedidos", item.metrics.orders],
                    ["Ventas", money(item.metrics.revenue)],
                    ["Gasto", money(item.metrics.spend)],
                    ["ROAS", item.metrics.roas == null ? "Orgánico / —" : `${item.metrics.roas.toFixed(1)}×`],
                  ].map(([label, value]) => <div key={label} className="rounded-xl px-2.5 py-2" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-xs font-extrabold">{value}</div></div>)}
                </div>
                <p className="text-xs leading-relaxed mb-2" style={{ color: T.choco2 }}>{item.stage.insight}</p>
                <div className="rounded-2xl px-3 py-2.5 mb-3" style={{ background: stageStyle.bg, color: stageStyle.fg }}><div className="text-[9px] uppercase tracking-wider font-extrabold">Siguiente paso</div><div className="text-[11px] leading-relaxed font-semibold">{item.stage.nextStep}</div></div>
                {item.attribution.ambiguous > 0 && <div className="text-[10px] font-bold mb-3" style={{ color: "#7A5410" }}>Hay {item.attribution.ambiguous} pedido(s) sin publicación exacta. No se usaron para decidir.</div>}
                {recommendation && <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-bold" style={{ color: guard?.allowed ? "#3F6B42" : "#A03B2A" }}>{guard?.allowed ? "✓ Aprendizaje listo para brief humano" : `Protegido: ${guard?.reasons?.[0] || "requiere revisión"}`}</div>
                  <Btn small kind={created ? "ghost" : "primary"} disabled={created || !serverReady || !guard?.allowed} onClick={() => openBrief(recommendation)}>{created ? "Brief creado ✓" : "Convertir aprendizaje en brief"}</Btn>
                </div>}
              </article>;
            })}
          </div> : <div className="mb-6"><Empty icon="◎" text="Cuando una publicación salga al aire, aparecerá aquí para medirla sin mezclar sus pedidos con otras piezas." /></div>}

          </Modal>}

          {advancedDetail === "creative-library" && <Modal title="Biblioteca creativa y marca" onClose={() => { setAdvancedDetail(null); setBrandStudioIntent(null); }} extraWide><AgencyBrandStudio db={db} user={user} refrescar={refrescar} initialIntent={brandStudioIntent} onIdentityChanged={() => loadBrandIdentity({ includeHistory: true, signAssets: false })} />

          {(db.agencyBriefs || []).length > 0 && <>
            <SectionTitle>Flujo de briefs</SectionTitle>
            <div className="grid md:grid-cols-2 gap-3">
              {(db.agencyBriefs || []).slice(0, 4).map((brief) => <div key={brief.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
                <div className="flex justify-between gap-2"><div><div className="text-[10px] font-extrabold uppercase" style={{ color: T.coral }}>BRIEF #{brief.id} · {brief.objective}</div><div className="display font-semibold">{brief.title}</div></div><Badge label={brief.status} /></div>
                <div className="text-xs mt-2" style={{ color: T.choco2 }}>{brief.channel} · presupuesto {money(brief.proposedBudget)}{brief.stockSnapshot !== null ? ` · stock foto ${brief.stockSnapshot}` : ""}</div>
                {["Borrador","En revisión","Aprobado","En producción"].includes(brief.status) && <div className="mt-3 flex flex-wrap gap-2">
                  <Btn kind="ghost" small onClick={() => openCreativePackage(brief)}>✦ Preparar paquete</Btn>
                  <BtnAsync small kind={brief.status === "En revisión" ? "primary" : "soft"} onClick={() => advanceBrief(brief)}>{({ "Borrador": "Enviar a revisión", "En revisión": "Aprobar brief", "Aprobado": "Iniciar producción", "En producción": "Marcar completado" })[brief.status]}</BtnAsync>
                </div>}
              </div>)}
            </div>
          </>}

          {(db.agencyDecisions || []).some((decision) => decision.status === "Propuesta") && <div id="agency-approval-center" className="scroll-mt-24">
            <SectionTitle>Decisiones por aprobar</SectionTitle>
            <div className="space-y-2">{(db.agencyDecisions || []).filter((decision) => decision.status === "Propuesta").slice(0, 5).map((decision) => <div key={decision.id} className="rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: T.border }}>
              <div className="flex-1"><div className="text-[10px] font-extrabold uppercase" style={{ color: T.coral }}>{decision.type} · riesgo {decision.riskLevel}</div><div className="font-bold text-sm">{decision.title}</div><div className="text-xs" style={{ color: T.choco2 }}>{decision.rationale}</div></div>
              <BtnAsync small onClick={() => advanceDecision(decision)}>Aprobar decisión</BtnAsync>
            </div>)}</div>
          </div>}

          {(db.creatives || []).length > 0 && <>
            <SectionTitle action={<Btn small kind="soft" disabled={!serverReady} onClick={openCreativeVersion}>＋ Nueva versión</Btn>}>Estudio creativo versionado</SectionTitle>
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border }}>
              <div className="px-4 py-3 text-xs" style={{ background: T.vainilla, color: T.choco2 }}><b style={{ color: T.choco }}>Marca congelada por versión.</b> Cada pieza conserva prompt, palabras prohibidas, archivo, costo y aprobación. El generador externo podrá conectarse después sin perder control.</div>
              {(db.agencyCreativeVersions || []).length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}>Todavía no hay versiones. Creá la primera sobre uno de los creativos existentes.</div> :
                (db.agencyCreativeVersions || []).slice(0, 5).map((version) => {
                  const creative = (db.creatives || []).find((item) => item.id === version.creativeId);
                  return <div key={version.id} className="p-4 border-t flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: T.border }}>
                    {version.thumbnailUrl ? <img src={version.thumbnailUrl} alt="" className="w-14 h-14 rounded-xl object-cover border" style={{ borderColor: T.border }} /> : <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl" style={{ background: T.rosa }}>✦</div>}
                    <div className="flex-1 min-w-0"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{creative?.titulo || version.creativeId} · V{version.version}</div><div className="text-sm font-bold truncate">{version.prompt || "Versión sin prompt"}</div><div className="text-xs" style={{ color: T.choco2 }}>{version.provider} · {version.status}</div></div>
                    {version.status === "Borrador" && <BtnAsync small kind="soft" onClick={() => reviewCreativeVersion(version, "En revisión")}>Enviar a revisión</BtnAsync>}
                    {version.status === "En revisión" && <BtnAsync small disabled={!version.assetUrl} onClick={() => reviewCreativeVersion(version, "Aprobada")}>Aprobar archivo</BtnAsync>}
                  </div>;
                })}
            </div>
          </>}
          </Modal>}
          </>}
        </div>
      </div>

      {briefSource && <Modal title="Nuevo brief comercial" onClose={() => setBriefSource(null)}>
        <div className="rounded-2xl p-3 mb-4 text-xs" style={{ background: T.vainilla }}><b>Por qué ahora:</b> {briefSource.rationale}</div>
        <Field label="Nombre del brief"><Input value={briefForm.title} onChange={(e) => setBriefForm({ ...briefForm, title: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Objetivo"><Select value={briefForm.objective} onChange={(e) => setBriefForm({ ...briefForm, objective: e.target.value })} options={["Ventas","Recompra","Lanzamiento","Cumpleaños","Tráfico WhatsApp","Branding","Contenido","Otro"]} /></Field><Field label="Canal"><Select value={briefForm.channel} onChange={(e) => setBriefForm({ ...briefForm, channel: e.target.value })} options={["Instagram","Facebook","TikTok","WhatsApp","Rappi","Referidos","Influencer","Orgánico","Multicanal"]} /></Field></div>
        <Field label="Segmento CRM"><Input value={briefForm.crmSegment} placeholder="Ej. clientes inactivos con permiso" onChange={(e) => setBriefForm({ ...briefForm, crmSegment: e.target.value })} /></Field>
        <Field label="Oferta o mensaje central"><Input value={briefForm.offer} placeholder="Qué queremos que entienda o haga la persona" onChange={(e) => setBriefForm({ ...briefForm, offer: e.target.value })} /></Field>
        <Field label="Presupuesto propuesto"><Input type="number" min="0" value={briefForm.proposedBudget} onChange={(e) => setBriefForm({ ...briefForm, proposedBudget: e.target.value })} /></Field>
        <Field label="Notas"><textarea className={inputCls} style={inputStyle} rows="3" value={briefForm.notes} onChange={(e) => setBriefForm({ ...briefForm, notes: e.target.value })} /></Field>
        <div className="flex gap-2"><BtnAsync onClick={saveBrief}>Guardar brief trazable</BtnAsync><Btn kind="ghost" onClick={() => setBriefSource(null)}>Cancelar</Btn></div>
      </Modal>}

      {creativePackageBrief && creativePackageDraft && <Modal title="Paquete creativo MOMOS" onClose={() => setCreativePackageBrief(null)} wide>
        <div className="rounded-3xl p-4 mb-4" style={{ background: "linear-gradient(135deg,#4A3028,#8C4E3B)", color: "#fff" }}>
          <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-70">Brief #{creativePackageBrief.id} · {creativePackageBrief.status}</div>
          <div className="display text-xl font-semibold mt-1">{creativePackageDraft.title}</div>
          <div className="text-xs opacity-80 mt-1">{creativePackageDraft.channel} · {creativePackageDraft.format} · {creativePackageDraft.objective}</div>
        </div>

        {!creativePackageDraft.audit.passed && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }} role="alert">⛔ {creativePackageDraft.audit.errors.join(" · ")}</div>}
        {creativePackageDraft.audit.warnings.length > 0 && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {creativePackageDraft.audit.warnings.join(" · ")}</div>}
        {!["Aprobado","En producción"].includes(creativePackageBrief.status) && <div className="rounded-2xl px-4 py-3 mb-4 text-xs font-bold" style={{ background: "#EAF0F7", color: "#3E5C7E" }}>Podés revisar y copiar este borrador. Para guardarlo en Creativos, primero el brief debe quedar Aprobado.</div>}

        <div className="grid md:grid-cols-3 gap-2 mb-4">
          {[["Producto",creativePackageDraft.productName],["Canal",creativePackageDraft.channel],["KPI principal",creativePackageDraft.measurement.primaryKpi]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-sm font-bold">{value}</div></div>)}
        </div>

        <Field label="Elegí el hook que detiene el scroll">
          <div className="grid gap-2">{creativePackageDraft.hooks.map((hook, index) => <button key={hook} type="button" onClick={() => setCreativePackageVariant(index)} className="text-left rounded-2xl border px-3 py-3 text-sm font-bold" style={{ borderColor: creativePackageDraft.hookIndex === index ? T.coral : T.border, background: creativePackageDraft.hookIndex === index ? T.coralSoft : "#fff", color: T.choco }}><span className="text-[9px] uppercase tracking-wider mr-2" style={{ color: T.coral }}>Opción {String.fromCharCode(65 + index)}</span>{hook}</button>)}</div>
        </Field>

        <div className="grid lg:grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl border p-4" style={{ borderColor: T.border }}>
            <div className="flex items-center justify-between gap-2 mb-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Copy listo para revisar</div><CopyBtn texto={creativePackageDraft.copy} label="Copiar copy" /></div>
            <div className="text-sm whitespace-pre-line leading-relaxed">{creativePackageDraft.copy}</div>
          </div>
          <div className="rounded-2xl border p-4" style={{ borderColor: T.border }}>
            <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Guion de producción</div>
            <ol className="m-0 pl-5 text-sm space-y-2">{creativePackageDraft.script.map((line) => <li key={line}>{line}</li>)}</ol>
          </div>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: T.vainilla }}>
          <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Dirección visual para generar o producir</div>
          <div className="text-xs leading-relaxed mb-2">{creativePackageDraft.prompt}</div>
          <div className="text-[11px]" style={{ color: T.choco2 }}><b>Evitar:</b> {creativePackageDraft.negativePrompt}</div>
        </div>

        <div className="rounded-2xl border p-4 mt-3 mb-4" style={{ borderColor: T.border }}>
          <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Cómo sabremos si funcionó</div>
          <div className="text-sm font-bold mt-1">{creativePackageDraft.measurement.primaryKpi}</div>
          <div className="text-xs mt-1" style={{ color: T.choco2 }}>{creativePackageDraft.measurement.secondaryKpi} · {creativePackageDraft.measurement.attribution}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <BtnAsync onClick={saveCreativePackage} disabled={creativePackageSaved || !creativePackageDraft.audit.passed || !["Aprobado","En producción"].includes(creativePackageBrief.status)} textoEnVuelo="Guardando paquete…">{creativePackageSaved ? "Paquete ya guardado ✓" : "Guardar como creativo en Idea"}</BtnAsync>
          <CopyBtn texto={[creativePackageDraft.selectedHook, creativePackageDraft.copy, ...creativePackageDraft.script, creativePackageDraft.prompt].join("\n\n")} label="Copiar paquete" />
          <Btn kind="ghost" onClick={() => setCreativePackageBrief(null)}>Cerrar</Btn>
        </div>
      </Modal>}

      {settingsOpen && <Modal title="Guardas de Agencia MOMOS" onClose={() => setSettingsOpen(false)}>
        <Field label="Modo de autonomía"><Select value={settingsForm.autonomyMode} onChange={(e) => setSettingsForm({ ...settingsForm, autonomyMode: e.target.value })} options={["Asesor","Copiloto","Autopiloto protegido"]} /></Field>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Límite diario"><Input type="number" min="0" value={settingsForm.dailyBudgetLimit} onChange={(e) => setSettingsForm({ ...settingsForm, dailyBudgetLimit: e.target.value })} /></Field><Field label="Límite por campaña"><Input type="number" min="0" value={settingsForm.campaignBudgetLimit} onChange={(e) => setSettingsForm({ ...settingsForm, campaignBudgetLimit: e.target.value })} /></Field></div>
        <Field label="Escalamiento máximo por paso (%)"><Input type="number" min="0" max="30" value={settingsForm.scaleStepPct} onChange={(e) => setSettingsForm({ ...settingsForm, scaleStepPct: e.target.value })} /></Field>
        {[["requireCreativeApproval","Exigir aprobación humana del creativo"],["blockOutOfStock","Bloquear pauta sin stock"],["contactOnlyAuthorized","Contactar solo clientes autorizados"],["paused","Parada de emergencia comercial"]].map(([key,label]) => <label key={key} className="flex items-center gap-2 py-2 text-sm font-bold"><input type="checkbox" checked={Boolean(settingsForm[key])} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.checked })} />{label}</label>)}
        <div className="flex gap-2 mt-4"><BtnAsync onClick={saveSettings}>Guardar guardas</BtnAsync><Btn kind="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Btn></div>
      </Modal>}

      {creativeOpen && <Modal title="Nueva versión creativa" onClose={() => setCreativeOpen(false)} wide>
        <div className="rounded-2xl px-4 py-3 mb-4 text-xs" style={{ background: T.vainilla }}><b>Control de marca:</b> esta versión guardará una fotografía del tono y vocabulario vigente. Crear la versión no la aprueba ni la publica.</div>
        <Field label="Creativo base"><select className={inputCls} style={inputStyle} value={creativeForm.creativeId} onChange={(e) => setCreativeForm({ ...creativeForm, creativeId: e.target.value })}><option value="">Elegir creativo…</option>{(db.creatives || []).map((creative) => <option key={creative.id} value={creative.id}>{creative.titulo} · {creative.formato}</option>)}</select></Field>
        <Field label="Brief relacionado (opcional)"><select className={inputCls} style={inputStyle} value={creativeForm.briefId} onChange={(e) => setCreativeForm({ ...creativeForm, briefId: e.target.value })}><option value="">Sin brief</option>{(db.agencyBriefs || []).filter((brief) => !["Descartado","Completado"].includes(brief.status)).map((brief) => <option key={brief.id} value={brief.id}>#{brief.id} · {brief.title}</option>)}</select></Field>
        <Field label="Prompt maestro"><textarea className={inputCls} style={inputStyle} rows="4" value={creativeForm.prompt} onChange={(e) => setCreativeForm({ ...creativeForm, prompt: e.target.value })} /></Field>
        <Field label="Evitar"><Input value={creativeForm.negativePrompt} onChange={(e) => setCreativeForm({ ...creativeForm, negativePrompt: e.target.value })} /></Field>
        <Field label="URL del archivo o borrador (opcional)"><Input value={creativeForm.assetUrl} placeholder="Se puede agregar cuando el archivo esté listo" onChange={(e) => setCreativeForm({ ...creativeForm, assetUrl: e.target.value })} /></Field>
        <div className="flex gap-2"><BtnAsync onClick={saveCreativeVersion}>Guardar versión</BtnAsync><Btn kind="ghost" onClick={() => setCreativeOpen(false)}>Cancelar</Btn></div>
      </Modal>}
    </section>
  );
}

  function AgencyPanel({ db, user, go, refrescar }) {
    return <AgenciaControl db={db} user={user} go={go} refrescar={refrescar} />;
  }

  return AgencyPanel;
}
