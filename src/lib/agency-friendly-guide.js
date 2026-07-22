import { buildCreativeFlightCenter } from "./agency-creative-flight.js";

const list = (value) => Array.isArray(value) ? value : [];

export const FRIENDLY_AGENCY_GOALS = Object.freeze([
  { id: "content", icon: "🎬", label: "Crear contenido", description: "Un video, imagen o publicación con la esencia de MOMOS." },
  { id: "sales", icon: "🍨", label: "Vender más", description: "Elegir qué producto impulsar con ventas y stock reales." },
  { id: "customers", icon: "💗", label: "Traer clientes de vuelta", description: "Preparar una activación para clientes que sí podemos contactar." },
  { id: "results", icon: "📈", label: "Ver qué funcionó", description: "Entender resultados y decidir qué conviene repetir." },
]);

const FRIENDLY_PHASES = Object.freeze([
  { id: "idea", label: "Idea", description: "Definimos qué queremos lograr.", technical: ["Contrato", "Guion"] },
  { id: "design", label: "Diseño", description: "Aterrizamos cómo se verá y contará.", technical: ["Storyboard", "Motion"] },
  { id: "create", label: "Creación", description: "Creamos los archivos finales.", technical: ["Enrutamiento", "Generación"] },
  { id: "review", label: "Revisión", description: "Comprobamos calidad y marca.", technical: ["QA", "Máster"] },
  { id: "publish", label: "Publicación", description: "Elegimos cuándo y dónde sale.", technical: ["Distribución"] },
  { id: "learn", label: "Resultados", description: "Medimos ventas y aprendizaje.", technical: ["Medición"] },
]);

function friendlyFlight(flight) {
  if (!flight) return null;
  let currentFound = false;
  const phases = FRIENDLY_PHASES.map((phase) => {
    const technicalStages = phase.technical.map((label) => flight.stages.find((stage) => stage.label === label)).filter(Boolean);
    const done = technicalStages.length === phase.technical.length && technicalStages.every((stage) => stage.state === "done");
    const state = done ? "done" : !currentFound ? "current" : "pending";
    if (!done) currentFound = true;
    const firstOpen = technicalStages.find((stage) => stage.state !== "done") || technicalStages[technicalStages.length - 1];
    return { ...phase, state, target: firstOpen?.target || "", detail: firstOpen?.detail || phase.description };
  });
  const current = phases.find((phase) => phase.state === "current") || phases[phases.length - 1];
  return {
    id: flight.contract?.id,
    title: flight.board?.title || flight.script?.title || flight.goal || "Contenido MOMOS",
    mode: flight.mode,
    phases,
    current,
    completed: phases.filter((phase) => phase.state === "done").length,
    progress: Math.round((phases.filter((phase) => phase.state === "done").length / phases.length) * 100),
  };
}

export function buildFriendlyAgencyGuide(db = {}, intelligence = {}, learning = {}) {
  const flightCenter = buildCreativeFlightCenter(db);
  const recommendations = list(intelligence.recommendations);
  const contentRecommendation = recommendations.find((item) => item.pillar === "Contenido" || ["Crear contenido", "Repetir creativo"].includes(item.type)) || null;
  const salesRecommendation = recommendations.find((item) => item.pillar === "Producto" || ["Impulsar producto", "Mover inventario"].includes(item.type)) || null;
  const customerRecommendation = recommendations.find((item) => item.pillar === "CRM" || ["Contactar segmento", "Activar cumpleaños"].includes(item.type)) || null;
  return {
    activeFlight: friendlyFlight(flightCenter.active[0] || null),
    activeFlightCount: flightCenter.active.length,
    recommendations: { content: contentRecommendation, sales: salesRecommendation, customers: customerRecommendation },
    results: {
      published: Number(learning.summary?.published || 0),
      conclusive: Number(learning.summary?.conclusive || 0),
      winners: Number(learning.summary?.winners || 0),
    },
  };
}
