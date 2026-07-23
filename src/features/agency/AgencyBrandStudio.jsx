import { useEffect, useMemo, useRef, useState } from "react";
import { hasRole } from "../../lib/user-roles";
import { fetchBrandAssetSignedUrl } from "../../lib/read-model";
import { ANIMATION_ASSET_KINDS, ANIMATION_ASSET_ROLES, BRAND_ASSET_ROLES, BRAND_MEDIA_RIGHTS, BRAND_MEDIA_TYPES, BRAND_STUDIO_FORMATS, BRAND_STUDIO_OPERATIONS, brandAssetDeletionPolicy, brandAssetDeletionReadiness, buildBrandMediaLibrary, buildCreativeStudioDraft, isOfficialBrandLogo, searchBrandMediaAssets } from "../../lib/brand-studio";
import { PRODUCTION_COMPONENT_TYPES, PRODUCTION_CONSENT_CHANNELS, PRODUCTION_CONSENT_PURPOSES, PRODUCTION_CONSENT_STATUSES, PRODUCTION_HAND_ASSIGNMENTS, PRODUCTION_IDENTITY_VISIBILITIES, PRODUCTION_INTERACTIONS, PRODUCTION_PACK_ROLES, PRODUCTION_PHYSICAL_STATES, PRODUCTION_QA_STATUSES, PRODUCTION_SOURCE_QUALITIES, PRODUCTION_VIEW_ANGLES, VISUAL_QUALITY_CHECKS, VISUAL_QUALITY_ISSUES, buildProductionLibrary, defaultProductionProfile, productionProfilePayload, visualQualityReviewPayload } from "../../lib/production-library";
import { CREATIVE_PROVIDERS, buildCreativeProductionQueue, creativeAuthorizationGuard } from "../../lib/creative-production";
import { AGENCY_INTEGRATION_ENVIRONMENTS, agencyProviderExecutionGuard, buildAgencyIntegrationCenter } from "../../lib/agency-integrations";
import { activeFigureCatalog, commercialFamilyLabel, figureProductId, isCommercialFamilyProduct } from "../../lib/momos-domain-language";
import {
  subirActivoMarca, declararLogoPrincipalMarca, archivarActivoMarca, actualizarMetadatosActivoMarca,
  eliminarActivoMarca, eliminarLogoOficialMarca, crearTrabajoCreativo, autorizarTrabajoCreativo,
  cancelarTrabajoCreativo, reintentarTrabajoCreativo, revisarSalidaCreativa, crearRevisionSalidaCreativa,
  guardarReferenciaIntegracionAgencia, pausarIntegracionAgencia, clasificarActivoProduccion,
  crearPaqueteProduccion, crearTrabajoDesdePaqueteProduccion, resolverAprobacionHumanaMcp,
  revisarPaqueteProduccion, revisarCalidadActivoVisual,
} from "../../lib/rpc";

export function createAgencyBrandStudio(shared) {
  const {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty,
  } = shared;

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

function ProductionVisualScopeFields({ form, onChange, enabled }) {
  if (!enabled) return <div className="rounded-2xl px-3 py-2 text-[10px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>H106 habilitará sets multivista y consentimiento por canal/finalidad.</div>;
  const human = ["Manos", "Presentador UGC"].includes(form.componentType);
  const toggle = (field, value) => onChange({ ...form, [field]: form[field]?.includes(value)
    ? form[field].filter((item) => item !== value) : [...(form[field] || []), value] });
  return <div className="rounded-2xl border p-3 mt-3" style={{ borderColor: "#C8B3D9", background: "#fff" }}>
    <div className="text-[9px] uppercase tracking-wider font-extrabold mb-2" style={{ color: "#65437D" }}>Set visual y alcance</div>
    <div className="grid sm:grid-cols-2 gap-2"><Field label="Clave del set multivista"><Input value={form.visualSetKey || ""} onChange={(event) => onChange({ ...form, visualSetKey: event.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="momo-mango-biche" /></Field><Field label="Variante"><Input value={form.variantLabel || ""} onChange={(event) => onChange({ ...form, variantLabel: event.target.value })} placeholder="intacto, bolsa, cucharada…" /></Field></div>
    {human && <><div className="grid sm:grid-cols-2 gap-2"><Field label="Visibilidad de identidad"><Select options={PRODUCTION_IDENTITY_VISIBILITIES.filter((value) => value !== "No aplica")} value={form.identityVisibility} onChange={(event) => onChange({ ...form, identityVisibility: event.target.value })} /></Field><Field label="Vigencia del consentimiento"><Input type="date" value={form.consentExpiresAt || ""} onChange={(event) => onChange({ ...form, consentExpiresAt: event.target.value })} /></Field></div>
      <label className="flex gap-2 items-start text-xs font-extrabold mb-2"><input type="checkbox" className="mt-0.5" checked={Boolean(form.consentAiUse)} onChange={(event) => onChange({ ...form, consentAiUse: event.target.checked })} /><span>Consentimiento específico para uso creativo con IA</span></label>
      <div className="text-[9px] font-extrabold mb-1" style={{ color: T.choco2 }}>Canales autorizados</div><div className="flex flex-wrap gap-1.5 mb-2">{PRODUCTION_CONSENT_CHANNELS.map((value) => <label key={value} className="rounded-full border px-2 py-1 text-[9px] font-bold"><input type="checkbox" className="mr-1" checked={(form.consentChannels || []).includes(value)} onChange={() => toggle("consentChannels", value)} />{value}</label>)}</div>
      <div className="text-[9px] font-extrabold mb-1" style={{ color: T.choco2 }}>Finalidades autorizadas</div><div className="flex flex-wrap gap-1.5">{PRODUCTION_CONSENT_PURPOSES.map((value) => <label key={value} className="rounded-full border px-2 py-1 text-[9px] font-bold"><input type="checkbox" className="mr-1" checked={(form.consentPurposes || []).includes(value)} onChange={() => toggle("consentPurposes", value)} />{value}</label>)}</div></>}
  </div>;
}

function VisualQualityReviewFields({ form, onChange }) {
  const toggle = (field, value) => onChange({ ...form, [field]: (form[field] || []).includes(value)
    ? form[field].filter((item) => item !== value) : [...(form[field] || []), value] });
  return <div className="rounded-2xl border p-3 mt-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF2" }}>
    <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#315B35" }}>Revisión maestra para IA</div>
    <div className="text-[10px] mt-1 mb-3" style={{ color: T.choco2 }}>Revisá los seis puntos. Los hallazgos determinan si el archivo está listo o si necesita una nueva toma.</div>
    <div className="grid sm:grid-cols-2 gap-1.5 mb-3">{VISUAL_QUALITY_CHECKS.map((value) => <label key={value} className="rounded-xl border px-2 py-2 text-[10px] font-bold" style={{ borderColor: (form.qualityChecksCompleted || []).includes(value) ? "#7FAA77" : T.border, background: "#fff" }}><input type="checkbox" className="mr-1.5" checked={(form.qualityChecksCompleted || []).includes(value)} onChange={() => toggle("qualityChecksCompleted", value)} />{value}</label>)}</div>
    <div className="text-[9px] uppercase tracking-wider font-extrabold mb-1.5" style={{ color: "#A03B2A" }}>Defectos encontrados</div>
    <div className="flex flex-wrap gap-1.5 mb-3">{VISUAL_QUALITY_ISSUES.map((value) => <label key={value} className="rounded-full border px-2 py-1 text-[9px] font-bold" style={{ borderColor: (form.qualityIssues || []).includes(value) ? "#D18A79" : T.border, background: (form.qualityIssues || []).includes(value) ? "#FFF1ED" : "#fff" }}><input type="checkbox" className="mr-1" checked={(form.qualityIssues || []).includes(value)} onChange={() => toggle("qualityIssues", value)} />{value}</label>)}</div>
    <Field label="Conclusión de la revisión"><textarea className={inputCls} style={inputStyle} rows="3" value={form.qualityReviewNotes || ""} onChange={(event) => onChange({ ...form, qualityReviewNotes: event.target.value })} placeholder="Ej. Repetir con luz suave, textura visible y fondo limpio." /></Field>
  </div>;
}

function AgencyBrandStudio({ db, user, refrescar, initialIntent = null, onIdentityChanged }) {
  const ready = Boolean(db.brandMediaReady);
  const animationReady = Boolean(db.mundoAnimadoReady);
  const officialLogoDeletionReady = Boolean(db.officialLogoDeletionReady);
  const productionAssetsReady = Boolean(db.brandProductionReady);
  const visualLibraryReady = Boolean(db.visualLibraryReady);
  const visualQualityReady = Boolean(db.visualQualityReady);
  const productionReady = Boolean(db.creativeProductionReady);
  const reviewReady = Boolean(db.creativeReviewReady);
  const iterationReady = Boolean(db.creativeIterationReady);
  const humanApprovalReady = Boolean(db.mcpHumanApprovalReady);
  const canWrite = hasRole(user, "Administrador") || hasRole(user, "Marketing/CRM");
  const isAdmin = hasRole(user, "Administrador");
  const library = useMemo(() => buildBrandMediaLibrary(db, hoyISO()), [db]);
  const productionLibrary = useMemo(() => buildProductionLibrary(db), [db]);
  const productionAssetById = useMemo(() => new Map(productionLibrary.assets.map((asset) => [String(asset.id), asset])), [productionLibrary.assets]);
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
  const [productionWorkspace, setProductionWorkspace] = useState("Tomas por hacer");
  const [studioStep, setStudioStep] = useState("encargo");
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
    originalAssetId: null, productionEnabled: false, ...defaultProductionProfile("Producto"),
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
  const visibleProductionAssets = useMemo(() => productionLibrary.generationReady.filter((asset) => !productionComponentFilter || asset.productionProfile?.componentType === productionComponentFilter), [productionLibrary.generationReady, productionComponentFilter]);
  const pendingFigureCaptures = useMemo(() => productionLibrary.figureCapturePlan.rows.filter((capture) => !capture.ready), [productionLibrary.figureCapturePlan.rows]);
  const kitchenFigures = useMemo(
    () => activeFigureCatalog(db),
    [db.figuras, db.products, db.settings?.figuras],
  );
  const figuresForProduct = (productId) => {
    const product = (db.products || []).find((candidate) => candidate.id === productId);
    return isCommercialFamilyProduct(product)
      ? kitchenFigures.filter((figure) => figureProductId(figure) === productId).map((figure) => figure.nombre)
      : [];
  };
  const validateProductFigure = (productId, figure) => {
    const product = (db.products || []).find((candidate) => candidate.id === productId);
    if (!product) throw new Error("Elegí un producto o presentación comercial vigente.");
    if (!isCommercialFamilyProduct(product)) {
      if (figure) throw new Error(`${commercialFamilyLabel(product)} se prepara al momento y no admite una figura física.`);
      return;
    }
    const allowed = figuresForProduct(productId);
    if (!figure || !allowed.includes(figure)) throw new Error(`Elegí una figura física de ${commercialFamilyLabel(product)}: ${allowed.join(", ") || "falta configurarla en Producción"}.`);
  };
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

  function openAssetUpload(collection = libraryCollection, brandRole = "", animationKind = "Personaje", preset = {}) {
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
    const baseForm = {
      ...emptyAssetForm, collection, brandRole: isBrand ? role : "", shotType: role, animationKind,
      mediaType: /logo/i.test(role) ? "Logo" : isBrand || isAnimation ? "Foto" : "Video",
      productionEnabled: productionAssetsReady, ...defaultProductionProfile(productionComponent),
    };
    setAssetForm({ ...baseForm, ...preset });
    setFile(null);
    setUploadOpen(true);
  }

  function openFigureCapture(capture) {
    const nextView = capture.nextView || "Frontal";
    const slug = capture.figure.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    openAssetUpload("Productos", `${nextView} oficial`, "Personaje", {
      name: `${capture.figure} · ${nextView} oficial`,
      mediaType: "Foto",
      productId: capture.productId,
      figure: capture.figure,
      shotType: `${nextView} oficial`,
      orientation: nextView === "Detalle / macro" ? "Cuadrado" : "Vertical",
      productionEnabled: true,
      componentType: "Producto",
      viewAngle: nextView,
      physicalState: "Intacto",
      sourceQuality: "Original limpio",
      qaStatus: "Pendiente",
      visualSetKey: `figura-${slug}`,
      canonical: Boolean(isAdmin),
    });
  }

  function openImprovedAssetUpload(asset) {
    const profile = asset.productionProfile || defaultProductionProfile(
      asset.collection === "Animación" ? "Personaje" : asset.collection === "Marca" ? "Marca" : "Producto",
    );
    setLibraryCollection(asset.collection);
    setAssetForm({
      ...emptyAssetForm, collection: asset.collection,
      brandRole: asset.collection === "Marca" ? asset.roleLabel : "",
      name: `${asset.name} · versión mejorada`, mediaType: asset.mediaType, source: "MOMOS",
      productId: asset.productId || "", figure: asset.figure || "", flavor: asset.flavor || "",
      shotType: asset.shotType || asset.roleLabel || "Referencia visual", orientation: asset.orientation || "Vertical",
      animationKind: asset.animationKind || "Personaje", containsPeople: Boolean(asset.containsPeople),
      rightsStatus: asset.rightsStatus || "Propio", rightsExpiresAt: asset.rightsExpiresAt || "",
      aiUseAllowed: Boolean(asset.aiUseAllowed), originalAssetId: asset.id,
      productionEnabled: productionAssetsReady, ...profile, qaStatus: "Pendiente", canonical: false,
      qualityReviewEnabled: false, qualityIssues: [], qualityChecksCompleted: [], qualityReviewNotes: "",
      notes: `Versión derivada del activo #${asset.id}; el original se conserva intacto.`,
    });
    setFile(null);
    setUploadOpen(true);
  }

  useEffect(() => {
    if (!initialIntent?.key) return;
    const collection = initialIntent.collection || "Marca";
    setSection(initialIntent.section || "Biblioteca");
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
      if (!isBrand && !isAnimation) validateProductFigure(assetForm.productId, assetForm.figure.trim());
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
        original_asset_id: assetForm.originalAssetId || null,
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

  async function revalidateOfficialLogo(asset) {
    try {
      if (!canWrite) throw new Error("Solo Administración o Marketing/CRM pueden declarar el logo oficial.");
      if (!isOfficialBrandLogo(asset)) throw new Error("Este archivo no está clasificado como logo principal.");
      await declararLogoPrincipalMarca(asset.id);
      await onIdentityChanged?.();
      toast("ok", "Logo principal revalidado; MOMO OPS activó una nueva versión de identidad sin duplicar el archivo");
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
      qualityReviewEnabled: false, qualityIssues: [], qualityChecksCompleted: [], qualityReviewNotes: "",
    });
  }

  async function saveAssetMetadata() {
    if (!detailAsset || !assetEditForm) return;
    try {
      if (!canWrite) throw new Error("Solo Administración o Marketing/CRM pueden corregir la Biblioteca.");
      if (assetEditForm.collection === "Animación" && !animationReady) throw new Error("Aplicá primero la migración 59 de Mundo animado.");
      if (assetEditForm.name.trim().length < 3) throw new Error("Escribí un nombre descriptivo de al menos 3 caracteres.");
      if (assetEditForm.collection === "Productos" && !assetEditForm.productId) throw new Error("Elegí el producto relacionado.");
      if (assetEditForm.collection === "Productos") validateProductFigure(assetEditForm.productId, assetEditForm.figure.trim());
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
      if (assetEditForm.productionEnabled && !assetEditForm.semanticLocked) {
        if (!productionAssetsReady) throw new Error("La información general se guardó, pero falta aplicar la migración 61 para la ficha de producción.");
        await clasificarActivoProduccion(detailAsset.id, productionProfilePayload(assetEditForm));
      }
      if (assetEditForm.qualityReviewEnabled) {
        if (!visualQualityReady) throw new Error("La información general se guardó, pero falta H110 para revisar calidad de IA.");
        if (!assetEditForm.productionEnabled) throw new Error("Creá primero la ficha de producción antes de revisar calidad para IA.");
        await revisarCalidadActivoVisual(detailAsset.id, visualQualityReviewPayload(assetEditForm));
      }
      setAssetEditForm(null);
      toast("ok", assetEditForm.qualityReviewEnabled
        ? "Información y revisión maestra guardadas; el original permaneció intacto"
        : result.semantic_locked
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
      setStudioStep("encargo");
      setSection("Producción");
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
      if (packForm.productId) validateProductFigure(packForm.productId, packForm.figure.trim());
      else if (packForm.figure.trim()) throw new Error("Una figura protagonista necesita su presentación comercial exacta.");
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
    const note = decision === "Aprobar"
      ? "Identidad oficial, producto exacto, derechos, QA y continuidad verificados por Administración."
      : "Paquete completo enviado a revisión de Administración.";
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
  const studioHasOrigin = Boolean(studio.creativeId || studio.briefId);
  const studioHasSources = studio.assetIds.length > 0;

  return (
    <div className="mt-7 mb-6 rounded-[28px] overflow-hidden border shadow-sm" style={{ borderColor: "#D9C2AE", background: "linear-gradient(145deg,#FFF,#FFF9F2)" }}>
      <div className="px-4 sm:px-5 py-4 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3" style={{ borderColor: T.border, background: "linear-gradient(135deg,#FFF3EA,#F9E7DE)" }}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shadow-sm" style={{ background: T.surface, color: T.coral }}>✦</div>
          <div><div className="text-[9px] font-extrabold tracking-[.18em] uppercase" style={{ color: T.coral }}>MOMOS BRAND INTELLIGENCE</div><div className="display text-xl font-semibold">Centro creativo MOMOS</div><div className="text-xs" style={{ color: T.choco2 }}>Un solo recorrido: referencias → creación → revisión → conexión.</div></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 w-full lg:w-auto" role="tablist" aria-label="Recorrido del Centro creativo MOMOS">
          {[{ id: "Biblioteca", label: "Biblioteca", hint: "Originales" }, { id: "Activos de producción", label: "Preparar", hint: "Referencias" }, { id: "Estudio", label: "Crear", hint: "Pieza" }, { id: "Producción", label: "Revisar", hint: "Trabajos" }, { id: "Integraciones", label: "Conectar", hint: "Motores" }].map((item, index) => { const active = section === item.id; return <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => setSection(item.id)} className="rounded-xl border px-2.5 py-2 text-left transition" style={{ borderColor: active ? T.coral : T.border, background: active ? T.coral : "#fff", color: active ? "#fff" : T.choco }}><span className="block text-[7px] uppercase tracking-wider font-extrabold opacity-70">{String(index + 1).padStart(2, "0")} · {item.hint}</span><span className="block text-[10px] font-extrabold mt-0.5">{item.label}</span></button>; })}
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
                <div className="flex flex-wrap gap-1.5 mt-3"><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: blocked ? "#F6D4CD" : "#DDEBD9", color: blocked ? "#A03B2A" : "#315B35" }}>{blocked ? `⚠ ${problem}` : "✓ Derechos listos"}</span>{visualQualityReady && (() => { const quality = productionAssetById.get(String(asset.id))?.aiReadiness; const videoReady = Boolean(quality?.videoGeneration.ready); return <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: videoReady ? "#DDEBD9" : "#FFF2D8", color: videoReady ? "#315B35" : "#7A5410" }}>{videoReady ? "✓ Apto para video IA" : `⚠ ${quality?.recommendedAction || "Revisar calidad"}`}</span>; })()}<span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{asset.rightsStatus}</span>{asset.animationCanonical && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#E9DDF2", color: "#65437D" }}>★ Canónico</span>}{asset.containsPeople && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.rosa }}>Con personas</span>}</div>
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
          <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Material para crear contenido</div><div className="display text-2xl font-semibold">Prepará una referencia lista para IA</div><div className="text-sm max-w-3xl" style={{ color: T.choco2 }}>MOMO OPS te muestra primero lo que falta. Cuando las tomas estén listas, podés reunirlas en un paquete para Higgsfield.</div></div>
          {productionWorkspace === "Paquetes" ? <Btn small disabled={!productionAssetsReady || !canWrite || productionLibrary.generationReady.length === 0} onClick={openPackCreator}>＋ Armar paquete</Btn> : <Btn small disabled={!productionAssetsReady || !canWrite} onClick={() => openAssetUpload("Productos")}>＋ Subir nueva toma</Btn>}
        </div>
        {!productionAssetsReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ Aplicá <code>biblioteca-produccion-v1.sql</code> después del paso 60. La Biblioteca actual permanece intacta hasta entonces.</div>}

        <div className="grid sm:grid-cols-3 gap-2 mb-4">
          {[["Tomas por hacer",productionLibrary.figureCapturePlan.pendingViews,"La siguiente aparece primero"],["Activos listos",productionLibrary.generationReady.length,"Aprobados para crear"],["Paquetes listos",productionLibrary.summary.approvedPacks,"Referencias selladas"]].map(([label,value,sub]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: value ? (label === "Tomas por hacer" ? T.coral : "#3F6B42") : T.choco2 }}>{value}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{sub}</div></div>)}
        </div>
        <div className="inline-flex flex-wrap gap-1 rounded-2xl border p-1 mb-5" role="tablist" aria-label="Vistas de activos de producción" style={{ borderColor: T.border, background: T.vainilla }}>
          {[["Tomas por hacer",productionLibrary.figureCapturePlan.pendingViews],["Activos listos",productionLibrary.generationReady.length],["Paquetes",productionLibrary.packs.length]].map(([item,count]) => <button key={item} type="button" role="tab" aria-selected={productionWorkspace === item} onClick={() => setProductionWorkspace(item)} className="rounded-xl border-0 px-3 py-2 text-[11px] font-extrabold" style={{ background: productionWorkspace === item ? T.coral : "transparent", color: productionWorkspace === item ? "#fff" : T.choco }}>{item} <span className="ml-1 opacity-75">{count}</span></button>)}
        </div>

        {productionWorkspace === "Tomas por hacer" && (pendingFigureCaptures.length > 0 ? <div className="rounded-3xl border p-4 mb-5" style={{ borderColor: "#E7C078", background: "#FFFCF4" }}>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Siguiente trabajo</div><div className="display text-xl font-semibold">Completá las fotos de cada figura</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Entrá a una figura y MOMO OPS dejará preparada la toma exacta que falta.</div></div><div className="text-xs font-extrabold rounded-xl px-3 py-2" style={{ background: "#fff", color: productionLibrary.figureCapturePlan.pendingViews ? T.coral : "#3F6B42" }}>{productionLibrary.figureCapturePlan.pendingViews ? `${productionLibrary.figureCapturePlan.pendingViews} tomas pendientes` : "✓ Todo completo"}</div></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">{pendingFigureCaptures.map((capture) => <article key={capture.figure} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#fff" }}><div className="flex items-start justify-between gap-2"><div><div className="font-extrabold text-sm">{capture.figure}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{capture.gramajeG ? `${capture.gramajeG} g · ` : ""}{capture.status}</div></div><span className="display text-xl font-semibold" style={{ color: T.coral }}>{capture.coveragePercent}%</span></div><div className="h-1.5 rounded-full overflow-hidden my-2" style={{ background: T.vainilla }}><div className="h-full rounded-full" style={{ width: `${capture.coveragePercent}%`, background: T.coral }} /></div><div className="text-[10px] font-bold" style={{ color: "#7A5410" }}>Siguiente: {capture.nextView} · faltan {capture.missingViews.length}</div>{capture.nextView && canWrite && <div className="mt-3"><Btn small onClick={() => openFigureCapture(capture)}>Subir {capture.nextView.toLocaleLowerCase("es")}</Btn></div>}</article>)}</div>
        </div> : <Empty icon="✅" text="Todas las figuras activas tienen sus tomas principales. Ya podés revisar los activos listos o armar un paquete." />)}

        {productionWorkspace === "Activos listos" && <div><div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Listos para crear</div><div className="display text-xl font-semibold">{productionComponentFilter || "Todos los activos aprobados"}</div></div><span className="rounded-full px-3 py-1.5 text-[10px] font-extrabold" style={{ background: T.vainilla }}>{visibleProductionAssets.length}</span></div>
          {visibleProductionAssets.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{visibleProductionAssets.map((asset) => { const profile = asset.productionProfile; const state = asset.productionReadiness; return <article key={asset.id} className="rounded-3xl border overflow-hidden" style={{ borderColor: state.ready ? "#B8D3B2" : "#E6B7AE", background: "#fff" }}><button type="button" onClick={() => openAssetDetail(asset)} className="w-full h-36 border-0 p-0 overflow-hidden grid place-items-center" style={{ background: "linear-gradient(135deg,#F9ECDD,#F3D7DC)" }}><LazyBrandMediaPreview asset={asset} mediaIcon={mediaIcon} /></button><div className="p-3"><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{profile.componentType} · {profile.viewAngle}</div><div className="font-extrabold text-sm">{asset.name}</div></div><span className="rounded-full px-2 py-1 h-fit text-[8px] font-extrabold" style={{ background: state.ready ? "#DDEBD9" : "#F6D4CD", color: state.ready ? "#315B35" : "#A03B2A" }}>{state.ready ? "APROBADO" : profile.qaStatus.toUpperCase()}</span></div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{[profile.physicalState,profile.interactionType,profile.locationName].filter((value) => value && !["No aplica","Ninguna"].includes(value)).join(" · ") || "Sin interacción adicional"}</div>{state.warnings[0] && <div className="rounded-xl px-2 py-1.5 mt-2 text-[9px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {state.warnings[0]}</div>}<button type="button" onClick={() => openAssetDetail(asset)} className="border-0 bg-transparent p-0 mt-2 text-[10px] font-extrabold underline" style={{ color: T.coral }}>Ver y editar ficha</button></div></article>; })}</div> : <Empty icon="🎬" text={productionAssetsReady ? "Todavía no hay activos aprobados con este filtro. Subí una toma y completá su revisión." : "La sección quedará disponible al aplicar la migración 61."} />}
        </div>}

        {productionWorkspace === "Paquetes" && <div><div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Referencias selladas</div><div className="display text-xl font-semibold">Paquetes para generar contenido</div></div></div>
          {productionLibrary.packs.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{productionLibrary.packs.map((pack) => <article key={pack.id} className="rounded-2xl border p-3" style={{ borderColor: pack.status === "Aprobado" ? "#B8D3B2" : T.border, background: pack.status === "Aprobado" ? "#F4FAF2" : "#fff" }}><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>V{pack.version} · {pack.channel} · {pack.targetFormat}</div><div className="font-extrabold text-sm">{pack.name}</div></div><Badge label={pack.status} /></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{pack.purpose}</div><div className="flex flex-wrap gap-1">{pack.readiness.members.map((member) => <span key={`${member.assetId}-${member.role}`} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: T.vainilla }}>{member.role}</span>)}</div>{!pack.readiness.ready && <div className="rounded-xl px-2 py-1.5 mt-2 text-[9px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{pack.readiness.reasons[0]}</div>}<div className="flex flex-wrap gap-2 mt-3">{pack.status === "Borrador" && <Btn small kind="ghost" disabled={!canWrite} onClick={() => reviewProductionPack(pack,"Enviar a revisión")}>Enviar a revisión</Btn>}{pack.status === "En revisión" && <Btn small confirmar disabled={!isAdmin || !pack.readiness.ready} onClick={() => reviewProductionPack(pack,"Aprobar")}>Aprobar paquete</Btn>}</div></article>)}</div> : <div className="rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: T.border, background: T.soft }}><div><div className="font-extrabold">Todavía no hay paquetes</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>Reuní producto, empaque y ambiente una sola vez para reutilizarlos en nuevas piezas.</div></div><Btn small disabled={!productionAssetsReady || !canWrite || productionLibrary.generationReady.length === 0} onClick={openPackCreator}>Armar primer paquete</Btn></div>}
        </div>}

        <details className="rounded-2xl border mt-5" style={{ borderColor: T.border, background: "#fff" }}>
          <summary className="cursor-pointer list-none px-4 py-3 text-xs font-extrabold flex items-center justify-between gap-3"><span>Ver control técnico</span><span className="font-normal" style={{ color: T.choco2 }}>QA, cobertura, ángulos y sets</span></summary>
          <div className="border-t p-4" style={{ borderColor: T.border }}>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-5">{[["Clasificados",productionLibrary.summary.profiled],["QA aprobado",productionLibrary.summary.approved],["Imagen IA",productionLibrary.summary.imageReady],["Video IA",productionLibrary.summary.videoReady],["Elements",productionLibrary.summary.elementReady],["Nueva toma",productionLibrary.summary.needsNewCapture],["Manos / UGC",productionLibrary.summary.humanComponents],["Locaciones",productionLibrary.summary.locations],["Ángulos",productionLibrary.summary.multiviewAngles],["Sets visuales",productionLibrary.summary.visualSets],["Frente + atrás",productionLibrary.summary.frontBackSets],["Packs aprobados",productionLibrary.summary.approvedPacks]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div></div>)}</div>
            {visualLibraryReady && productionLibrary.visualSets.length > 0 && <div className="mb-5"><div className="text-[9px] uppercase tracking-[.14em] font-extrabold mb-2" style={{ color: T.coral }}>Sets multivista reutilizables</div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{productionLibrary.visualSets.map((set) => <div key={set.key} className="rounded-2xl border p-3" style={{ borderColor: set.hasFrontAndBack ? "#B8D3B2" : T.border, background: set.hasFrontAndBack ? "#F4FAF2" : "#FFF9F2" }}><div className="flex justify-between gap-2"><span className="font-extrabold text-xs">{set.key}</span><span className="text-[9px] font-extrabold">{set.assets.length} activos</span></div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>{set.views.join(" · ") || "Sin vistas"}</div><div className="text-[9px] font-bold mt-2" style={{ color: set.hasFrontAndBack ? "#315B35" : "#7A5410" }}>{set.hasFrontAndBack ? "✓ Frente y vista trasera cubiertos" : "Falta completar frente o vista trasera"}</div></div>)}</div></div>}
            <div><div className="flex items-end justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Cobertura reutilizable</div><div className="font-extrabold">Qué puede pedir hoy un guion</div></div><button type="button" className="border-0 bg-transparent text-[10px] font-extrabold underline" style={{ color: T.coral }} onClick={() => { setProductionComponentFilter(""); setProductionWorkspace("Activos listos"); }}>Ver todos</button></div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">{productionLibrary.componentCoverage.map((item) => <button type="button" key={item.componentType} onClick={() => { setProductionComponentFilter(item.componentType); setProductionWorkspace("Activos listos"); }} className="rounded-2xl border p-3 text-left" style={{ borderColor: productionComponentFilter === item.componentType ? T.coral : item.ready ? "#B8D3B2" : T.border, background: item.ready ? "#F4FAF2" : "#FFF9F2" }}><span className="flex justify-between gap-2"><span className="text-xs font-extrabold">{item.componentType}</span><span className="display text-lg font-semibold" style={{ color: item.ready ? "#315B35" : T.coral }}>{item.approved}</span></span><span className="block text-[9px] mt-1" style={{ color: item.ready ? "#315B35" : T.choco2 }}>{item.ready ? `${item.count} clasificado(s)` : "Falta capturar y aprobar"}</span></button>)}</div>
            </div>
          </div>
        </details>
      </div> : section === "Estudio" ? <div className="p-4 sm:p-5">
        <div className="mb-4"><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Creación guiada</div><div className="display text-2xl font-semibold">Prepará una pieza sin perderte</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>Completá un paso a la vez. Nada usa créditos hasta la autorización humana.</div></div>
        <div className="grid grid-cols-3 gap-2 mb-5" role="tablist" aria-label="Pasos para preparar un trabajo creativo">
          {[{ id: "encargo", label: "Encargo", hint: studioHasOrigin ? "Listo" : "Elegir origen" }, { id: "fuentes", label: "Referencias", hint: studioHasSources ? `${studio.assetIds.length} elegidas` : "Elegir material" }, { id: "revisar", label: "Revisar", hint: studioDraft.audit.passed ? "Listo" : "Falta completar" }].map((item, index) => { const active = studioStep === item.id; const enabled = index === 0 || (index === 1 && studioHasOrigin) || (index === 2 && studioHasOrigin && studioHasSources); return <button key={item.id} type="button" role="tab" aria-selected={active} disabled={!enabled} onClick={() => setStudioStep(item.id)} className="rounded-2xl border px-3 py-3 text-left disabled:opacity-45" style={{ borderColor: active ? T.coral : T.border, background: active ? "#FFF1EA" : T.surface }}><span className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: active ? T.coral : T.choco2 }}>0{index + 1}</span><span className="block text-xs font-extrabold mt-1">{item.label}</span><span className="block text-[8px] mt-0.5" style={{ color: T.choco2 }}>{item.hint}</span></button>; })}
        </div>

        {studioStep === "encargo" && <div className="rounded-3xl border p-4 sm:p-5 max-w-3xl" style={{ borderColor: T.border, background: T.soft }}>
          <div className="display text-lg font-semibold mb-3">¿Qué vamos a crear?</div>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Creativo base"><select className={inputCls} style={inputStyle} value={studio.creativeId} onChange={(event) => setStudio({ ...studio, creativeId: event.target.value })}><option value="">Sin creativo</option>{(db.creatives || []).map((creative) => <option key={creative.id} value={creative.id}>{creative.titulo}</option>)}</select></Field><Field label="Brief aprobado o en curso"><select className={inputCls} style={inputStyle} value={studio.briefId} onChange={(event) => setStudio({ ...studio, briefId: event.target.value })}><option value="">Sin brief</option>{(db.agencyBriefs || []).map((brief) => <option key={brief.id} value={brief.id}>#{brief.id} · {brief.title}</option>)}</select></Field></div>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Qué debe hacer MOMOS"><Select options={BRAND_STUDIO_OPERATIONS} value={studio.operation} onChange={(event) => setStudio({ ...studio, operation: event.target.value })} /></Field><Field label="Motor"><Select options={CREATIVE_PROVIDERS} value={studio.provider} onChange={(event) => setStudio({ ...studio, provider: event.target.value })} /></Field></div>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Canal"><Select options={["Instagram","TikTok","Facebook","WhatsApp","Multicanal"]} value={studio.targetChannel} onChange={(event) => setStudio({ ...studio, targetChannel: event.target.value, productionPackId: "" })} /></Field><Field label="Formato"><Select options={BRAND_STUDIO_FORMATS} value={studio.targetFormat} onChange={(event) => setStudio({ ...studio, targetFormat: event.target.value, productionPackId: "" })} /></Field></div>
          <Field label="Instrucciones adicionales (opcional)"><textarea className={inputCls} style={inputStyle} rows="3" value={studio.instructions} onChange={(event) => setStudio({ ...studio, instructions: event.target.value })} placeholder="Ej. conservar el close-up real, agregar fondo de cocina cálido y cerrar con logo…" /></Field>
          {!studioHasOrigin && <div className="rounded-xl px-3 py-2.5 mb-3 text-[10px] font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Elegí un creativo o un brief para conservar el objetivo y la trazabilidad.</div>}
          <Btn small disabled={!studioHasOrigin} onClick={() => setStudioStep("fuentes")}>Siguiente: elegir referencias</Btn>
        </div>}

        {studioStep === "fuentes" && <div className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: T.border, background: T.surface }}>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3"><div><div className="display text-lg font-semibold">Elegí el material real</div><div className="text-[10px]" style={{ color: T.choco2 }}>Solo aparecen originales con derechos vigentes y permiso para IA.</div></div><span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: T.vainilla }}>{studio.assetIds.length} elegido(s)</span></div>
          {approvedProductionPacks.length > 0 && <div className="rounded-2xl border p-3 mb-3" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><Field label="Paquete de producción aprobado"><select className={inputCls} style={inputStyle} value={studio.productionPackId} onChange={(event) => applyProductionPack(event.target.value)}><option value="">Selección manual de originales</option>{approvedProductionPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.name} · V{pack.version} · {pack.readiness.members.length} referencias</option>)}</select></Field><div className="text-[9px]" style={{ color: T.choco2 }}>{studio.productionPackId ? "MOMO OPS sellará la versión y huella del paquete dentro del trabajo." : "Elegir un paquete carga únicamente sus referencias aprobadas."}</div></div>}
          {library.readyForAi.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">{library.readyForAi.map((asset) => { const selected = studio.assetIds.some((id) => String(id) === String(asset.id)); return <button key={asset.id} type="button" onClick={() => toggleStudioAsset(asset.id)} className="rounded-2xl border p-2.5 text-left flex gap-3" style={{ borderColor: selected ? T.coral : T.border, background: selected ? T.coralSoft : "#fff" }}><div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 grid place-items-center" style={{ background: T.vainilla }}>{asset.url && ["Foto","Logo"].includes(asset.mediaType) ? <img src={asset.url} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">{mediaIcon[asset.mediaType] || "✦"}</span>}</div><span className="min-w-0"><span className="block text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{selected ? "✓ Seleccionado" : asset.mediaType}</span><span className="block text-xs font-extrabold truncate">{asset.name}</span><span className="block text-[10px] truncate" style={{ color: T.choco2 }}>{asset.productName || "Recurso de marca"} {asset.flavor ? `· ${asset.flavor}` : ""}</span></span></button>; })}</div> : <div className="rounded-2xl px-4 py-5 text-sm text-center" style={{ background: T.vainilla, color: T.choco2 }}>Primero registrá originales con derechos vigentes y permiso para IA.</div>}
          <div className="flex flex-wrap gap-2 mt-4"><Btn small kind="ghost" onClick={() => setStudioStep("encargo")}>Atrás</Btn><Btn small disabled={!studioHasSources} onClick={() => setStudioStep("revisar")}>Siguiente: revisar</Btn></div>
        </div>}

        {studioStep === "revisar" && <div className="rounded-3xl p-4 sm:p-5 max-w-3xl" style={{ background: "linear-gradient(145deg,#4A3028,#7C493A)", color: "#fff" }}>
          <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-70">Control antes de generar</div><div className="display text-2xl font-semibold mt-1">{studioDraft.title}</div><div className="text-xs opacity-75 mt-1">{studioDraft.operation} · {studioDraft.format} · salida siempre nueva</div>
          <div className="grid grid-cols-2 gap-2 my-4"><div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,.1)" }}><div className="text-[8px] uppercase font-extrabold opacity-65">Fuentes</div><div className="display text-xl">{studioDraft.assets.length}</div></div><div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,.1)" }}><div className="text-[8px] uppercase font-extrabold opacity-65">Salida</div><div className="text-sm font-extrabold">{studioDraft.spec.width}×{studioDraft.spec.height}</div></div></div>
          {studioDraft.audit.errors.length > 0 && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>⛔ {studioDraft.audit.errors.join(" · ")}</div>}{studioDraft.audit.warnings.length > 0 && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {studioDraft.audit.warnings.join(" · ")}</div>}{studioDraft.audit.passed && <div className="rounded-2xl p-3 mb-3 text-xs font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Derechos, producto real, marca y formato validados.</div>}
          <details className="rounded-2xl p-3 mb-3 text-[11px]" style={{ background: "rgba(255,255,255,.1)" }}><summary className="font-extrabold cursor-pointer">Ver instrucciones técnicas</summary><div className="mt-2 leading-relaxed">{studioDraft.prompt}</div></details>
          {["Higgsfield", "Kling"].includes(studio.provider) && <div className="text-[10px] mb-3 opacity-80">{studio.provider} queda seleccionado. Preparar no consume créditos: la autorización humana sigue siendo obligatoria.</div>}
          <div className="flex flex-wrap gap-2"><Btn small kind="ghost" onClick={() => setStudioStep("fuentes")}>Atrás</Btn><BtnAsync onClick={prepareJob} disabled={!ready || !canWrite || !studioDraft.audit.passed} textoEnVuelo="Protegiendo trabajo…">Preparar trabajo creativo</BtnAsync></div>
        </div>}

        {(db.creativeGenerationJobs || []).length > 0 && <div className="mt-5"><SectionTitle>Trabajos recientes del estudio</SectionTitle><div className="grid md:grid-cols-2 gap-2">{db.creativeGenerationJobs.slice(0, 6).map((job) => <div key={job.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: T.border, background: "#fff" }}><div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: T.vainilla }}>✶</div><div className="flex-1 min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>TRABAJO #{job.id} · {job.provider}</div><div className="text-sm font-extrabold truncate">{job.operation} · {job.targetFormat}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{job.inputAssetIds.length} fuente(s) · {job.createdAt}</div></div><Badge label={job.status} /></div>)}</div></div>}
      </div> : section === "Producción" ? <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
          <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Cola protegida del estudio</div><div className="display text-2xl font-semibold">De la idea al archivo revisable</div><div className="text-sm" style={{ color: T.choco2 }}>Cada trabajo conserva fuentes, marca, motor, tope de costo y aprobación humana. Autorizar no publica nada.</div></div>
          <Btn small kind="soft" onClick={() => setSection("Estudio")}>＋ Preparar trabajo</Btn>
        </div>
        {!productionReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>🛡️ La cola ya está diseñada, pero falta aplicar la migración 22 de Producción Creativa para autorizar costos y conectar motores sin exponer secretos.</div>}
        {!reviewReady && productionQueue.summary.completed > 0 && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>✦ Hay salidas privadas esperando decisión. Aplicá <code>revision-creativa-v1.sql</code> para aprobar, pedir cambios o descartar sin publicar automáticamente.</div>}
        {!iterationReady && productionQueue.summary.changesRequested > 0 && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>↻ Hay correcciones esperando nueva versión. Aplicá <code>versiones-creativas-v1.sql</code> para conservar el original y preparar otro intento sin heredar gasto.</div>}
        <details className="rounded-3xl border p-4 mb-5" open={humanApprovals.some((item) => item.status === "Pendiente")} style={{ borderColor: humanApprovalReady ? "#C8B3D9" : T.border, background: humanApprovalReady ? "#FBF7FD" : T.soft }}>
          <summary className="cursor-pointer list-none flex flex-col md:flex-row md:items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: "#76508C" }}>Decisión humana</div><div className="display text-xl font-semibold">Aprobaciones antes de generar</div><div className="text-xs max-w-3xl" style={{ color: T.choco2 }}>Abrí este bloque únicamente cuando exista una solicitud. Aprobar no publica y no permite que Codex se apruebe a sí mismo.</div></div><span className="rounded-full px-3 py-2 text-[10px] font-extrabold" style={{ background: humanApprovals.some((item) => item.status === "Pendiente") ? "#FFF2D8" : "#DDEBD9", color: humanApprovals.some((item) => item.status === "Pendiente") ? "#7A5410" : "#315B35" }}>{humanApprovals.filter((item) => item.status === "Pendiente").length} por decidir</span></summary>
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
        </details>
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
        <div className="grid lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-4"><div><Field label="Nombre"><Input value={packForm.name} onChange={(event) => setPackForm({ ...packForm, name: event.target.value })} placeholder="Dulce Antojo · UGC bolsa y cucharada" /></Field><Field label="Propósito"><textarea className={inputCls} style={inputStyle} rows="3" value={packForm.purpose} onChange={(event) => setPackForm({ ...packForm, purpose: event.target.value })} placeholder="Mostrar la bolsa, sacar a Max, presentarlo a cámara y probarlo con cuchara." /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Producto o presentación comercial"><select className={inputCls} style={inputStyle} value={packForm.productId} onChange={(event) => setPackForm({ ...packForm, productId: event.target.value, figure: "" })}><option value="">Sin producto único</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{commercialFamilyLabel(product)}</option>)}</select></Field><Field label="Postre / figura protagonista"><select className={inputCls} style={inputStyle} value={packForm.figure} onChange={(event) => setPackForm({ ...packForm, figure: event.target.value })}><option value="">Sin figura única</option>{figuresForProduct(packForm.productId, packForm.figure).map((figure) => <option key={figure} value={figure}>{figure}</option>)}</select></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="Canal"><Select options={["Instagram","TikTok","Facebook","WhatsApp","Multicanal"]} value={packForm.channel} onChange={(event) => setPackForm({ ...packForm, channel: event.target.value })} /></Field><Field label="Formato"><Select options={BRAND_STUDIO_FORMATS} value={packForm.targetFormat} onChange={(event) => setPackForm({ ...packForm, targetFormat: event.target.value })} /></Field></div><Field label="Notas de continuidad"><textarea className={inputCls} style={inputStyle} rows="2" value={packForm.description} onChange={(event) => setPackForm({ ...packForm, description: event.target.value })} placeholder="Bolsa idéntica, cuchara visible, luz de ventana izquierda…" /></Field><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Roles obligatorios</div><div className="flex flex-wrap gap-1.5 mb-4">{PRODUCTION_PACK_ROLES.map((role) => <label key={role} className="rounded-full border px-2 py-1 text-[9px] font-bold flex items-center gap-1" style={{ borderColor: packForm.requiredRoles.includes(role) ? T.coral : T.border, background: packForm.requiredRoles.includes(role) ? T.coralSoft : "#fff" }}><input type="checkbox" checked={packForm.requiredRoles.includes(role)} onChange={() => togglePackRequiredRole(role)} />{role}</label>)}</div></div>
          <div><div className="flex items-end justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>QA y calidad para video</div><div className="font-extrabold">Elegí las referencias</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{packForm.members.length} elegidas</span></div><div className="grid sm:grid-cols-2 gap-2 max-h-[520px] overflow-y-auto pr-1">{productionLibrary.generationReady.map((asset) => { const member = packForm.members.find((item) => String(item.assetId) === String(asset.id)); return <article key={asset.id} className="rounded-2xl border p-2.5" style={{ borderColor: member ? T.coral : T.border, background: member ? T.coralSoft : "#fff" }}><label className="flex gap-2 items-start cursor-pointer"><input type="checkbox" className="mt-1" checked={Boolean(member)} onChange={() => togglePackAsset(asset)} /><span className="min-w-0"><span className="block text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{asset.productionProfile.componentType} · {asset.productionProfile.viewAngle}</span><span className="block text-xs font-extrabold truncate">{asset.name}</span><span className="block text-[9px]" style={{ color: T.choco2 }}>{asset.productionProfile.physicalState} · {asset.productionProfile.sourceQuality}</span></span></label>{member && <select className={`${inputCls} mt-2`} style={inputStyle} value={member.role} onChange={(event) => setPackMemberRole(asset.id,event.target.value)}>{PRODUCTION_PACK_ROLES.map((role) => <option key={role}>{role}</option>)}</select>}</article>; })}</div>{!productionLibrary.generationReady.length && <div className="rounded-2xl px-3 py-4 text-xs" style={{ background: "#FFF2D8", color: "#7A5410" }}>Primero completá QA, dimensiones y revisión maestra de calidad en la ficha del activo.</div>}</div></div>
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
        const detailQuality = productionAssetById.get(String(detailAsset.id))?.aiReadiness;
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
              <div className="flex flex-wrap gap-1.5 mt-3"><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: detailAsset.readiness.ready ? "#DDEBD9" : "#F6D4CD", color: detailAsset.readiness.ready ? "#315B35" : "#A03B2A" }}>{detailAsset.readiness.ready ? "✓ Derechos listos" : `⚠ ${detailAsset.readiness.reasons[0]}`}</span>{visualQualityReady && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: detailQuality?.videoGeneration.ready ? "#DDEBD9" : "#FFF2D8", color: detailQuality?.videoGeneration.ready ? "#315B35" : "#7A5410" }}>{detailQuality?.videoGeneration.ready ? "✓ Apto para video IA" : `⚠ ${detailQuality?.recommendedAction || "Revisión pendiente"}`}</span>}<span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: T.vainilla }}>{detailAsset.rightsStatus}</span>{detailAsset.animationCanonical && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: "#E9DDF2", color: "#65437D" }}>★ Referencia canónica</span>}{detailAsset.containsPeople && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: T.rosa }}>Muestra personas</span>}</div>
              <div className="grid sm:grid-cols-2 gap-2 my-4">
                {[["Formato real",`${detailAsset.mimeType || detailAsset.mediaType} · ${formatAssetSize(detailAsset.sizeBytes)}`],["Resolución",dimensions],["Orientación",detailAsset.orientation || "Sin definir"],["Fecha de ingreso",detailAsset.createdAt || "Sin fecha"],["Uso con IA",detailAsset.aiUseAllowed ? "Permitido" : "No permitido"],["Huella del original",hashLabel]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2.5" style={{ borderColor: T.border, background: T.soft }}><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-[11px] font-extrabold mt-0.5 break-words">{value}</div></div>)}
              </div>
              {detailAsset.productionProfile ? <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#65437D" }}>Ficha de producción</div><div className="font-extrabold text-sm">{detailAsset.productionProfile.componentType} · {detailAsset.productionProfile.viewAngle}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: detailAsset.productionProfile.qaStatus === "Aprobado" ? "#DDEBD9" : "#FFF2D8", color: detailAsset.productionProfile.qaStatus === "Aprobado" ? "#315B35" : "#7A5410" }}>QA {detailAsset.productionProfile.qaStatus}</span></div><div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]" style={{ color: T.choco2 }}><div><b>Estado:</b> {detailAsset.productionProfile.physicalState}</div><div><b>Interacción:</b> {detailAsset.productionProfile.interactionType}</div><div><b>Calidad:</b> {detailAsset.productionProfile.sourceQuality}</div><div><b>Consentimiento:</b> {detailAsset.productionProfile.consentStatus}</div>{detailAsset.productionProfile.locationName && <div className="col-span-2"><b>Locación:</b> {detailAsset.productionProfile.locationName}</div>}</div>{detailAsset.productionProfile.continuityNotes && <div className="text-[10px] mt-2"><b>Continuidad:</b> {detailAsset.productionProfile.continuityNotes}</div>}</div> : productionAssetsReady && <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: "#FFF2D8", color: "#7A5410" }}><b>Sin ficha de producción.</b> Editá la información para clasificar vista, estado, interacción, locación y QA.</div>}
              {visualQualityReady && <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: detailQuality?.videoGeneration.ready ? "#B8D3B2" : "#E7C078", background: detailQuality?.videoGeneration.ready ? "#F4FAF2" : "#FFF9EC" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: detailQuality?.videoGeneration.ready ? "#315B35" : "#7A5410" }}>Calidad maestra para IA</div><div className="font-extrabold text-sm">{detailQuality?.status || "Pendiente de revisión"}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#fff" }}>{detailQuality?.recommendedAction || "Registrar dimensiones"}</span></div><div className="grid grid-cols-2 gap-1.5 mt-3">{[["Contenido",detailQuality?.digitalContent],["Imagen IA",detailQuality?.imageGeneration],["Video IA",detailQuality?.videoGeneration],["Element",detailQuality?.element]].map(([label,state]) => <div key={label} className="rounded-xl px-2 py-2 text-[9px] font-bold" style={{ background: state?.ready ? "#DDEBD9" : "#fff", color: state?.ready ? "#315B35" : "#7A5410" }}>{state?.ready ? "✓" : "⚠"} {label}<span className="block font-normal mt-0.5">{state?.ready ? "Apto" : state?.reasons?.[0] || "Sin certificación"}</span></div>)}</div>{detailQuality?.issues?.length > 0 && <div className="text-[10px] mt-2" style={{ color: "#A03B2A" }}><b>Hallazgos:</b> {detailQuality.issues.join(" · ")}</div>}</div>}
              {detailAsset.tags?.filter((tag) => !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(String(tag))).length > 0 && <div className="mb-4"><div className="text-[9px] uppercase font-extrabold mb-1.5" style={{ color: T.choco2 }}>Etiquetas</div><div className="flex flex-wrap gap-1.5">{detailAsset.tags.filter((tag) => !/^(momos:|animacion:tipo:|animacion:canon$)/i.test(String(tag))).map((tag) => <span key={tag} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{tag}</span>)}</div></div>}
              <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: T.border, background: "#fff" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Notas y alcance del permiso</div><div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: detailAsset.notes ? T.choco : T.choco2 }}>{detailAsset.notes || "No se registraron notas adicionales."}</div>{detailAsset.rightsExpiresAt && <div className="text-[10px] mt-2 font-bold" style={{ color: T.coral }}>Permiso vigente hasta {detailAsset.rightsExpiresAt}</div>}</div>
              {semanticLocked && <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: "#FFF2D8", color: "#7A5410" }}><b>Clasificación protegida:</b> este original ya fue usado o pertenece a la identidad oficial. Se pueden corregir nombre, etiquetas y notas, pero no cambiar qué representa.</div>}
              <div className="flex flex-wrap gap-2">{canWrite && <Btn onClick={() => beginAssetMetadataEdit(detailAsset)}>Editar y revisar</Btn>}{canWrite && isOfficialBrandLogo(detailAsset) && detailAsset.status === "Activo" && <BtnAsync kind="soft" onClick={() => revalidateOfficialLogo(detailAsset)} textoEnVuelo="Revalidando identidad…">Revalidar logo oficial</BtnAsync>}{canWrite && detailAsset.status === "Activo" && <Btn kind="soft" onClick={() => openImprovedAssetUpload(detailAsset)}>Subir versión mejorada</Btn>}{detailDeletion.allowed && <Btn kind="ghost" onClick={() => openDeleteConfirmation(detailAsset)}>{isOfficialBrandLogo(detailAsset) ? "Eliminar logo" : "Eliminar definitivamente"}</Btn>}<Btn kind="ghost" onClick={() => { setDetailAssetId(null); setAssetEditForm(null); }}>Cerrar</Btn></div>
            </div> : <div>
              <div className="rounded-2xl px-3 py-2.5 mb-4 text-[11px]" style={{ background: semanticLocked ? "#FFF2D8" : "#E5EEF7", color: semanticLocked ? "#7A5410" : "#315A7D" }}>{semanticLocked ? <><b>Este archivo ya tiene historia.</b> Solo nombre, etiquetas y notas están habilitados; la clasificación y los permisos permanecen sellados.</> : <><b>Corrección versionada.</b> MOMO OPS guardará la ficha anterior y registrará quién hizo este cambio.</>}</div>
              <Field label="Nombre descriptivo"><Input value={assetEditForm.name} onChange={(event) => setAssetEditForm({ ...assetEditForm, name: event.target.value })} /></Field>
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Colección"><Select disabled={semanticLocked} options={["Marca","Productos","Animación"]} value={assetEditForm.collection} onChange={(event) => { const collection = event.target.value; setAssetEditForm({ ...assetEditForm, collection, shotType: collection === "Marca" ? "Referencia visual" : collection === "Animación" ? "Diseño base" : "Producto" }); }} /></Field><Field label="Tipo de archivo"><Input value={`${detailAsset.mediaType} · ${detailAsset.source}`} disabled /></Field></div>
              {assetEditForm.collection === "Marca" ? <div className="grid sm:grid-cols-2 gap-3"><Field label="Uso dentro de la marca"><Select disabled={semanticLocked} options={BRAND_ASSET_ROLES} value={assetEditForm.shotType || "Referencia visual"} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div>
                : assetEditForm.collection === "Animación" ? <><div className="grid sm:grid-cols-2 gap-3"><Field label="Tipo de elemento"><Select disabled={semanticLocked} options={ANIMATION_ASSET_KINDS} value={assetEditForm.animationKind} onChange={(event) => setAssetEditForm({ ...assetEditForm, animationKind: event.target.value })} /></Field><Field label="Material de referencia"><Select disabled={semanticLocked} options={ANIMATION_ASSET_ROLES} value={assetEditForm.shotType || "Diseño base"} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Personaje o elemento"><Input disabled={semanticLocked} value={assetEditForm.figure} onChange={(event) => setAssetEditForm({ ...assetEditForm, figure: event.target.value })} placeholder="Momo, Toby, Cocina MOMOS…" /></Field><Field label="Variante o vestuario"><Input disabled={semanticLocked} value={assetEditForm.flavor} onChange={(event) => setAssetEditForm({ ...assetEditForm, flavor: event.target.value })} placeholder="Base, chef, invierno…" /></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div><label className="flex gap-2 items-start rounded-2xl border px-3 py-2.5 mb-3 text-sm font-bold" style={{ borderColor: T.border }}><input disabled={semanticLocked || !hasRole(user,"Administrador")} type="checkbox" className="mt-1" checked={assetEditForm.animationCanon} onChange={(event) => setAssetEditForm({ ...assetEditForm, animationCanon: event.target.checked })} /><span>Referencia canónica<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Define la apariencia oficial para sostener la continuidad. Solo Administración puede declararla.</span></span></label></>
                  : <><div className="grid sm:grid-cols-2 gap-3"><Field label="Producto o presentación comercial relacionada"><select disabled={semanticLocked} className={inputCls} style={inputStyle} value={assetEditForm.productId} onChange={(event) => setAssetEditForm({ ...assetEditForm, productId: event.target.value, figure: "" })}><option value="">Elegir producto…</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{commercialFamilyLabel(product)}</option>)}</select></Field><Field label="Orientación"><Select disabled={semanticLocked} options={["Vertical","Horizontal","Cuadrado","Audio","Documento"]} value={assetEditForm.orientation} onChange={(event) => setAssetEditForm({ ...assetEditForm, orientation: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Postre / figura protagonista"><select disabled={semanticLocked} className={inputCls} style={inputStyle} value={assetEditForm.figure} onChange={(event) => setAssetEditForm({ ...assetEditForm, figure: event.target.value })}><option value="">Sin figura</option>{figuresForProduct(assetEditForm.productId, assetEditForm.figure).map((figure) => <option key={figure} value={figure}>{figure}</option>)}</select></Field><Field label="Sabor"><Input disabled={semanticLocked} value={assetEditForm.flavor} onChange={(event) => setAssetEditForm({ ...assetEditForm, flavor: event.target.value })} /></Field><Field label="Tipo de toma"><Input disabled={semanticLocked} value={assetEditForm.shotType} onChange={(event) => setAssetEditForm({ ...assetEditForm, shotType: event.target.value })} /></Field></div></>}
              <div className="grid sm:grid-cols-2 gap-3"><Field label="Derechos"><Select disabled={semanticLocked} options={BRAND_MEDIA_RIGHTS} value={assetEditForm.rightsStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, rightsStatus: event.target.value })} /></Field><Field label="Vencimiento del permiso"><Input disabled={semanticLocked} type="date" value={assetEditForm.rightsExpiresAt} onChange={(event) => setAssetEditForm({ ...assetEditForm, rightsExpiresAt: event.target.value })} /></Field></div>
              <div className="rounded-2xl border px-3 py-2 mb-3" style={{ borderColor: T.border }}><label className="flex gap-2 items-start text-sm font-bold"><input disabled={semanticLocked} type="checkbox" className="mt-1" checked={assetEditForm.containsPeople} onChange={(event) => setAssetEditForm({ ...assetEditForm, containsPeople: event.target.checked })} /><span>El archivo muestra personas</span></label><label className="flex gap-2 items-start text-sm font-bold mt-2"><input disabled={semanticLocked} type="checkbox" className="mt-1" checked={assetEditForm.aiUseAllowed} onChange={(event) => setAssetEditForm({ ...assetEditForm, aiUseAllowed: event.target.checked })} /><span>Permitir edición o generación con IA</span></label></div>
              <div className="rounded-3xl border p-3 mb-3" style={{ borderColor: "#C8B3D9", background: "#FBF7FD" }}><label className="flex gap-2 items-start text-sm font-extrabold"><input type="checkbox" disabled={!productionAssetsReady} className="mt-1" checked={assetEditForm.productionEnabled} onChange={(event) => setAssetEditForm({ ...assetEditForm, productionEnabled: event.target.checked })} /><span>Ficha de producción<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Clasifica este original para UGC, manos, multivistas, locaciones y paquetes.</span></span></label>{assetEditForm.productionEnabled && <div className="mt-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Componente"><Select options={PRODUCTION_COMPONENT_TYPES} value={assetEditForm.componentType} onChange={(event) => { const componentType = event.target.value; setAssetEditForm({ ...assetEditForm, ...defaultProductionProfile(componentType), componentType, productionEnabled: true, containsPeople: ["Manos","Presentador UGC"].includes(componentType) ? true : assetEditForm.containsPeople }); }} /></Field><Field label="Vista"><Select options={PRODUCTION_VIEW_ANGLES} value={assetEditForm.viewAngle} onChange={(event) => setAssetEditForm({ ...assetEditForm, viewAngle: event.target.value })} /></Field><Field label="Estado físico"><Select options={PRODUCTION_PHYSICAL_STATES} value={assetEditForm.physicalState} onChange={(event) => setAssetEditForm({ ...assetEditForm, physicalState: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-2"><Field label="Interacción"><Select options={PRODUCTION_INTERACTIONS} value={assetEditForm.interactionType} onChange={(event) => setAssetEditForm({ ...assetEditForm, interactionType: event.target.value })} /></Field><Field label="Mano asignada"><Select options={PRODUCTION_HAND_ASSIGNMENTS} value={assetEditForm.handAssignment} onChange={(event) => setAssetEditForm({ ...assetEditForm, handAssignment: event.target.value })} /></Field><Field label="Calidad fuente"><Select options={PRODUCTION_SOURCE_QUALITIES} value={assetEditForm.sourceQuality} onChange={(event) => setAssetEditForm({ ...assetEditForm, sourceQuality: event.target.value })} /></Field></div>{assetEditForm.componentType === "Locación" && <Field label="Locación"><Input value={assetEditForm.locationName} onChange={(event) => setAssetEditForm({ ...assetEditForm, locationName: event.target.value })} /></Field>}<div className="grid sm:grid-cols-2 gap-2"><Field label="Dirección de luz"><Input value={assetEditForm.lightDirection} onChange={(event) => setAssetEditForm({ ...assetEditForm, lightDirection: event.target.value })} /></Field><Field label="Referencia de escala"><Input value={assetEditForm.scaleReference} onChange={(event) => setAssetEditForm({ ...assetEditForm, scaleReference: event.target.value })} /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="QA visual"><Select options={PRODUCTION_QA_STATUSES} value={assetEditForm.qaStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, qaStatus: event.target.value })} /></Field><Field label="Consentimiento"><Select disabled={!['Manos','Presentador UGC'].includes(assetEditForm.componentType)} options={PRODUCTION_CONSENT_STATUSES} value={assetEditForm.consentStatus} onChange={(event) => setAssetEditForm({ ...assetEditForm, consentStatus: event.target.value })} /></Field></div><Field label="Continuidad"><textarea className={inputCls} style={inputStyle} rows="2" value={assetEditForm.continuityNotes} onChange={(event) => setAssetEditForm({ ...assetEditForm, continuityNotes: event.target.value })} /></Field><ProductionVisualScopeFields form={assetEditForm} onChange={setAssetEditForm} enabled={visualLibraryReady} /></div>}</div>
              {visualQualityReady && assetEditForm.productionEnabled && <div className="rounded-3xl border p-3 mb-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF2" }}><label className="flex gap-2 items-start text-sm font-extrabold"><input type="checkbox" className="mt-1" checked={Boolean(assetEditForm.qualityReviewEnabled)} onChange={(event) => setAssetEditForm({ ...assetEditForm, qualityReviewEnabled: event.target.checked, qualityIssues: [], qualityChecksCompleted: [], qualityReviewNotes: "" })} /><span>Registrar revisión de calidad IA<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Crea evidencia versionada; no modifica ni reemplaza el original.</span></span></label>{assetEditForm.qualityReviewEnabled && <VisualQualityReviewFields form={assetEditForm} onChange={setAssetEditForm} />}</div>}
              <Field label="Etiquetas separadas por coma"><Input value={assetEditForm.tags} onChange={(event) => setAssetEditForm({ ...assetEditForm, tags: event.target.value })} placeholder="oreo, close-up, cocina, fondo rosa" /></Field>
              <Field label="Notas y alcance del permiso"><textarea className={inputCls} style={inputStyle} rows="4" value={assetEditForm.notes} onChange={(event) => setAssetEditForm({ ...assetEditForm, notes: event.target.value })} /></Field>
              <div className="flex flex-wrap gap-2"><BtnAsync onClick={saveAssetMetadata} disabled={assetEditForm.name.trim().length < 3 || (assetEditForm.collection === "Productos" && !assetEditForm.productId) || (assetEditForm.collection === "Animación" && (!animationReady || assetEditForm.figure.trim().length < 2)) || (assetEditForm.qualityReviewEnabled && ((assetEditForm.qualityChecksCompleted || []).length !== VISUAL_QUALITY_CHECKS.length || ((assetEditForm.qualityIssues || []).length > 0 && (assetEditForm.qualityReviewNotes || "").trim().length < 10)))} textoEnVuelo="Guardando versión…">Guardar corrección</BtnAsync><Btn kind="ghost" onClick={() => setAssetEditForm(null)}>Cancelar edición</Btn></div>
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
            : <><div className="grid sm:grid-cols-2 gap-3"><Field label="Producto o presentación comercial relacionada"><select className={inputCls} style={inputStyle} value={assetForm.productId} onChange={(event) => setAssetForm({ ...assetForm, productId: event.target.value, figure: "" })}><option value="">Elegir producto…</option>{(db.products || []).filter((product) => product.activo !== false).map((product) => <option key={product.id} value={product.id}>{commercialFamilyLabel(product)}</option>)}</select></Field><Field label="Orientación"><Select options={["Vertical","Horizontal","Cuadrado","Audio","Documento"]} value={assetForm.orientation} onChange={(event) => setAssetForm({ ...assetForm, orientation: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-3"><Field label="Postre / figura protagonista"><select className={inputCls} style={inputStyle} value={assetForm.figure} onChange={(event) => setAssetForm({ ...assetForm, figure: event.target.value })}><option value="">Sin figura</option>{figuresForProduct(assetForm.productId, assetForm.figure).map((figure) => <option key={figure} value={figure}>{figure}</option>)}</select></Field><Field label="Sabor"><Input value={assetForm.flavor} onChange={(event) => setAssetForm({ ...assetForm, flavor: event.target.value })} placeholder="Oreo, Coco…" /></Field><Field label="Tipo de toma"><Input value={assetForm.shotType} onChange={(event) => setAssetForm({ ...assetForm, shotType: event.target.value })} placeholder="Close-up, cocina…" /></Field></div></>}
        {assetForm.collection === "Marca" && assetForm.brandRole === "Logo principal" && <div className="rounded-2xl px-3 py-3 mb-3 text-xs font-semibold" style={{ background: "#E8F1E4", color: "#315B35" }}>Al guardar, MOMO OPS creará una nueva versión de identidad, conservará la paleta actual y declarará este archivo como logo principal oficial. Debe ser PNG, JPG o WEBP.</div>}
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Derechos"><Select options={BRAND_MEDIA_RIGHTS} value={assetForm.rightsStatus} onChange={(event) => setAssetForm({ ...assetForm, rightsStatus: event.target.value })} /></Field><Field label="Vencimiento del permiso (opcional)"><Input type="date" value={assetForm.rightsExpiresAt} onChange={(event) => setAssetForm({ ...assetForm, rightsExpiresAt: event.target.value })} /></Field></div>
        <div className="rounded-2xl border px-3 py-2 mb-3" style={{ borderColor: T.border }}><label className="flex gap-2 items-start text-sm font-bold"><input type="checkbox" className="mt-1" checked={assetForm.containsPeople} onChange={(event) => setAssetForm({ ...assetForm, containsPeople: event.target.checked })} /><span>El archivo muestra personas<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Para usarlo con IA, los derechos deben quedar en Autorizado.</span></span></label><label className="flex gap-2 items-start text-sm font-bold mt-2"><input type="checkbox" className="mt-1" checked={assetForm.aiUseAllowed} onChange={(event) => setAssetForm({ ...assetForm, aiUseAllowed: event.target.checked })} /><span>Permitir edición o generación con IA<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>El original sigue privado y no se modifica.</span></span></label></div>
        {assetForm.containsPeople && assetForm.rightsStatus !== "Autorizado" && <div className="rounded-2xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ Se puede catalogar, pero el servidor bloqueará su uso con IA hasta registrar autorización explícita.</div>}
        <div className="rounded-3xl border p-3 mb-3" style={{ borderColor: productionAssetsReady ? "#C8B3D9" : T.border, background: productionAssetsReady ? "#FBF7FD" : T.soft }}>
          <label className="flex gap-2 items-start text-sm font-extrabold"><input type="checkbox" className="mt-1" disabled={!productionAssetsReady} checked={assetForm.productionEnabled} onChange={(event) => setAssetForm({ ...assetForm, productionEnabled: event.target.checked })} /><span>Crear ficha de producción<span className="block text-[10px] font-normal" style={{ color: T.choco2 }}>Hace que este original pueda encontrarse como manos, UGC, vista, locación o componente de un paquete.</span></span></label>
          {assetForm.productionEnabled && <div className="mt-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Componente"><Select options={PRODUCTION_COMPONENT_TYPES} value={assetForm.componentType} onChange={(event) => { const componentType = event.target.value; setAssetForm({ ...assetForm, ...defaultProductionProfile(componentType), componentType, productionEnabled: true, containsPeople: ["Manos","Presentador UGC"].includes(componentType) ? true : assetForm.containsPeople }); }} /></Field><Field label="Vista"><Select options={PRODUCTION_VIEW_ANGLES} value={assetForm.viewAngle} onChange={(event) => setAssetForm({ ...assetForm, viewAngle: event.target.value })} /></Field><Field label="Estado físico"><Select options={PRODUCTION_PHYSICAL_STATES} value={assetForm.physicalState} onChange={(event) => setAssetForm({ ...assetForm, physicalState: event.target.value })} /></Field></div><div className="grid sm:grid-cols-3 gap-2"><Field label="Interacción"><Select options={PRODUCTION_INTERACTIONS} value={assetForm.interactionType} onChange={(event) => setAssetForm({ ...assetForm, interactionType: event.target.value })} /></Field><Field label="Mano asignada"><Select options={PRODUCTION_HAND_ASSIGNMENTS} value={assetForm.handAssignment} onChange={(event) => setAssetForm({ ...assetForm, handAssignment: event.target.value })} /></Field><Field label="Calidad de fuente"><Select options={PRODUCTION_SOURCE_QUALITIES} value={assetForm.sourceQuality} onChange={(event) => setAssetForm({ ...assetForm, sourceQuality: event.target.value })} /></Field></div>{assetForm.componentType === "Locación" && <Field label="Nombre de la locación"><Input value={assetForm.locationName} onChange={(event) => setAssetForm({ ...assetForm, locationName: event.target.value })} placeholder="Cocina MOMOS, casa creadora, tienda…" /></Field>}<div className="grid sm:grid-cols-2 gap-2"><Field label="Dirección de luz"><Input value={assetForm.lightDirection} onChange={(event) => setAssetForm({ ...assetForm, lightDirection: event.target.value })} placeholder="Ventana izquierda, cálida frontal…" /></Field><Field label="Referencia de escala"><Input value={assetForm.scaleReference} onChange={(event) => setAssetForm({ ...assetForm, scaleReference: event.target.value })} placeholder="Cuchara, mano, regla, bolsa…" /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="QA visual"><Select options={PRODUCTION_QA_STATUSES} value={assetForm.qaStatus} onChange={(event) => setAssetForm({ ...assetForm, qaStatus: event.target.value })} /></Field><Field label="Consentimiento"><Select disabled={!['Manos','Presentador UGC'].includes(assetForm.componentType)} options={PRODUCTION_CONSENT_STATUSES} value={assetForm.consentStatus} onChange={(event) => setAssetForm({ ...assetForm, consentStatus: event.target.value })} /></Field></div><Field label="Continuidad y observaciones de QA"><textarea className={inputCls} style={inputStyle} rows="2" value={assetForm.continuityNotes} onChange={(event) => setAssetForm({ ...assetForm, continuityNotes: event.target.value })} placeholder="Qué debe mantenerse idéntico entre tomas; anotar escarcha, reflejos, fondo o deformaciones." /></Field><ProductionVisualScopeFields form={assetForm} onChange={setAssetForm} enabled={visualLibraryReady} /></div>}
          {!productionAssetsReady && <div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Disponible al aplicar la migración 61.</div>}
        </div>
        <Field label="Etiquetas separadas por coma"><Input value={assetForm.tags} onChange={(event) => setAssetForm({ ...assetForm, tags: event.target.value })} placeholder={assetForm.collection === "Animación" ? "feliz, frontal, manos, escala, cocina" : "oreo, close-up, cuchara, fondo rosa"} /></Field>
        <Field label={assetForm.collection === "Animación" ? "Notas de diseño, uso y continuidad" : "Notas y alcance del permiso"}><textarea className={inputCls} style={inputStyle} rows="3" value={assetForm.notes} onChange={(event) => setAssetForm({ ...assetForm, notes: event.target.value })} /></Field>
        <div className="flex flex-wrap gap-2"><BtnAsync onClick={saveAsset} disabled={!file || assetForm.name.trim().length < 3 || (assetForm.collection === "Productos" && !assetForm.productId) || (assetForm.collection === "Animación" && (!animationReady || assetForm.figure.trim().length < 2))} textoEnVuelo="Protegiendo original…">{assetForm.collection === "Marca" && assetForm.brandRole === "Logo principal" ? "Guardar y declarar logo principal" : assetForm.collection === "Animación" ? "Guardar en Mundo animado" : `Guardar en ${assetForm.collection}`}</BtnAsync><Btn kind="ghost" onClick={() => { setUploadOpen(false); setFile(null); }}>Cancelar</Btn></div>
      </Modal>}
    </div>
  );
}

  return AgencyBrandStudio;
}
