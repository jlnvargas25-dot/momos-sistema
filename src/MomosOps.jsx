import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./lib/supabase";
import { fetchCatalogos, fetchOperativo } from "./lib/read-model";
import { crearPedido, setOrderStatusRemoto, subirEvidencia, crearReclamo, setReclamoEstado, editarReclamo, crearDomicilio, actualizarDomicilio, upsertCliente, crearLote, setLoteEstado, empezarCongelamiento, convertirImperfectas, crearInsumo, entradaInsumo, movimientoInsumo, setSugerenciaEstado, crearCorrida, desmoldarLote, producirSubreceta } from "./lib/rpc";

/* ================================================================
   MOMOS OPS v3 — Operación + Agencia Interna de D'Momos Sweet Love
   Base limpia pre-Supabase · Cocina oculta · El Caney, Cali
   Arquitectura: tablas normalizadas + persistencia (window.storage)
   ================================================================ */

const DB_VERSION = 16;
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
.momos { font-family: 'Nunito Sans', system-ui, sans-serif; color: ${T.choco}; }
.momos h1,.momos h2,.momos h3,.momos .display { font-family: 'Fraunces', Georgia, serif; }
.momos ::-webkit-scrollbar { height: 8px; width: 8px; }
.momos ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) { .momos * { transition: none !important; animation: none !important; } }
`;

/* ---------------- Fechas dinámicas (zona horaria America/Bogota) ---------------- */
const TZ = "America/Bogota";
// "en-CA" produce YYYY-MM-DD; NUNCA usar toISOString para la fecha operativa (daría el día de UTC, no el de Cali)
const fechaISOEnBogota = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const hoyISO = () => fechaISOEnBogota(new Date());
const ahoraHora = () => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const dISO = (nDias) => fechaISOEnBogota(new Date(Date.now() + nDias * 86400000));
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

const ORDER_STATES = ["Nuevo","Confirmado","Pendiente de pago","Pagado","En producción","Empacado","Listo para despacho","En ruta","Entregado","Cancelado","Reclamo"];
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
  "En producción": { bg: "#DCE7F2", fg: "#3E5C7E" }, "Empacado": { bg: "#E8E0F2", fg: "#63518A" },
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

const OBJETIVO_SIMPLE = ["vender","recompra","regalo","cumpleaños","seguidores","historias etiquetadas"];
const IDEA_ESTADOS = ["Nueva","Usada","Repetir","Ganadora","Descartada"];
const IDEA_CATS = ["Ideas para vender","Ideas tiernas","Ideas de regalo","Ideas para cumpleaños","Ideas para fechas especiales","Ideas para clientes que ya compraron","Ideas para que etiqueten a MOMOS","Ideas para productos nuevos","Ideas para mostrar proceso","Ideas para sabores"];
const TAREA_ESTADOS = ["Pendiente","Hecha","Saltada"];
const DIFICULTAD = ["Fácil","Medio","Avanzado"];

/* ================================================================
   SEED — datos de ejemplo realistas (El Caney, Cali)
   Cada colección representa una tabla lista para migrar a SQL:
   customers, products, orders, order_items, production_batches,
   inventory_items, inventory_movements, deliveries, evidences,
   claims, benefits, audit_logs, settings
   ================================================================ */

// users / roles / permissions: estructura lista para login real con backend
const PERMISOS_POR_ROL = {
  "Administrador": "todos los módulos",
  "Cocina": "Dashboard, Pedidos, Producción, Inventario",
  "Empaque": "Dashboard, Pedidos, Reclamos",
  "Logística": "Dashboard, Pedidos, Domicilios, Reclamos",
  "Marketing/CRM": "Dashboard, Productos, Reclamos, Clientes, Beneficios, Reportes",
};
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
      { nombre: "Toby",  especie: "gato",  gramaje: "150 g" },
      { nombre: "Teo",   especie: "gato",  gramaje: "280 g" },
      { nombre: "Max",   especie: "perro", gramaje: "150 g" },
      { nombre: "Rocco", especie: "perro", gramaje: "150 g" },
      { nombre: "Danna", especie: "perro", gramaje: "150 g" },
    ],
    pagos: ["Nequi","Daviplata","Bancolombia","Rappi (app)"],
    proveedores: ["Picap","Pibox","Mensajeros Urbanos","Propio","Rappi"],
    pautaMensual: 350000,
    horasCongelacion: 10, // objetivo por defecto (rango operativo 8–12 h)
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
    { id: "L-018", fecha: hoyISO(), producto: "Momo Gatito 150 g", figura: "Gatito", sabor: "Maracuyá", relleno: "Cheesecake con ganache", salsa: "Frutos rojos", gramaje: "150 g", prod: 12, perfectas: 10, imperfectas: 1, descartadas: 1, destino: "Insumo para malteadas", resp: "Karen", vence: dISO(14), estado: "Congelando", stockContabilizado: false, horasCongelacion: 10, inicioCongelacion: selloHaceHoras(6), obs: "Molde nuevo, mejor definición de orejas." },
    { id: "L-017", fecha: dISO(-1), producto: "Momo Perrito 150 g", figura: "Perrito", sabor: "Oreo", relleno: "Cheesecake con ganache", salsa: "Chocolate", gramaje: "150 g", prod: 10, perfectas: 9, imperfectas: 1, descartadas: 0, destino: "Prueba interna", resp: "Karen", vence: dISO(13), estado: "Listo", stockContabilizado: true, obs: "" },
    { id: "L-016", fecha: dISO(-2), producto: "Momo premium 280 g", figura: "Corazón", sabor: "Caramelo salado", relleno: "Cheesecake con ganache", salsa: "Lechera", gramaje: "280 g", prod: 6, perfectas: 5, imperfectas: 0, descartadas: 1, destino: "—", resp: "Julián", vence: dISO(12), estado: "Listo", stockContabilizado: true, obs: "Una pieza se fracturó al desmoldar." },
    { id: "L-015", fecha: dISO(-3), producto: "Cheesecake Momo cuchareable", figura: "Gatito horizontal", sabor: "Durazno", relleno: "Cheesecake con ganache", salsa: "Frutos rojos", gramaje: "160 g", prod: 15, perfectas: 15, imperfectas: 0, descartadas: 0, destino: "—", resp: "Karen", vence: dISO(7), estado: "Reservado", stockContabilizado: false, obs: "Reservado parcial para pedidos de Rappi." },
    { id: "L-014", fecha: dISO(-4), producto: "Momo grande 190 g", figura: "Osito", sabor: "Milo", relleno: "Cheesecake con ganache", salsa: "Arequipe", gramaje: "190 g", prod: 8, perfectas: 6, imperfectas: 2, descartadas: 0, destino: "Insumo para crepas", resp: "Julián", vence: dISO(10), estado: "Vendido", stockContabilizado: false, obs: "" },
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
    { id: "A03", fecha: hoyISO() + " 11:06", user: "Empaque", entidad: "Pedido", entidadId: "P-1042", accion: "Cambio de estado", de: "En producción", a: "Empacado" },
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

  return { version: DB_VERSION, settings, products, customers, orders, order_items, production_batches, inventory_items, inventory_movements, deliveries, evidences, claims, benefits, audit_logs, production_suggestions, recipes, inventory_reservations: [], users: seedUsers(), campaigns, creatives, content_calendar, creative_results, marketing_ideas, marketing_guiones, marketing_mensajes, brand_library, marketing_tasks };
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
    "inventory_items", "inventory_movements", "deliveries", "evidences", "claims",
    "benefits", "audit_logs", "production_suggestions", "recipes", "inventory_reservations",
    "users", "campaigns", "creatives", "content_calendar", "creative_results",
    "marketing_ideas", "marketing_guiones", "marketing_mensajes", "marketing_tasks",
  ];
  arrayTables.forEach((k) => {
    if (!Array.isArray(d[k])) d[k] = s[k] || [];
  });
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

async function dbLoad() {
  try {
    const r = await storage.get(DB_KEY);
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

async function dbPersist(db) {
  try { await storage.set(DB_KEY, JSON.stringify(db)); return true; }
  catch (e) { console.error("No se pudo guardar:", e); return false; }
}

async function dbReset() {
  try { await storage.delete(DB_KEY); } catch (e) {}
}

/* ================================================================
   REPOSITORY — única puerta de acceso a datos.
   Hoy: window.storage (todo el estado viaja en `db`).
   Migración a Supabase: reemplazar el CUERPO de cada función por
   llamadas a supabase.from('tabla')… / supabase.storage… sin tocar la UI.
   ================================================================ */
const repo = {
  load: dbLoad,
  persist: dbPersist,
  reset: dbReset,

  // Lecturas
  getOrders: (db, filtro = {}) => db.orders.filter((o) =>
    (!filtro.estado || o.estado === filtro.estado) && (!filtro.desde || o.fecha >= filtro.desde) && (!filtro.hasta || o.fecha <= filtro.hasta)),
  getCustomers: (db) => db.customers,
  getInventory: (db) => db.inventory_items,

  // Escrituras (mutan la copia de db dentro de update(); en Supabase serán insert/update)
  createOrder: (db, order, items) => {
    db.orders.unshift(order);
    items.forEach((it) => db.order_items.push(it));
    return order.id;
  },
  updateOrder: (db, orderId, patch) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (o) Object.assign(o, patch);
    return o;
  },
  updateCustomer: (db, customerId, patch) => {
    const c = db.customers.find((x) => x.id === customerId);
    if (c) Object.assign(c, patch);
    return c;
  },
  updateInventory: (db, itemId, patch) => {
    const i = db.inventory_items.find((x) => x.id === itemId);
    if (i) Object.assign(i, patch);
    return i;
  },
  // En Supabase: subir el archivo a Storage y guardar aquí solo la URL pública
  uploadEvidence: (db, evidence) => {
    db.evidences.push(evidence);
    return evidence.id;
  },
};

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
const tieneEvidencia = (db, orderId, tipo) => evidencesOf(db, orderId).some((e) => e.tipo === tipo && e.url);
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
  (db.creative_results || []).forEach((r) => {
    if (r.mensajesWhatsApp >= 30 && r.pedidos <= 3) {
      const cre = db.creatives.find((x) => x.id === r.creativeId);
      recs.push({ tipo: "copy", icon: "✏️", titulo: cre ? cre.titulo : "Contenido",
        texto: `Recibió muchos mensajes (${r.mensajesWhatsApp}) pero pocos pedidos (${r.pedidos}). Revisa el precio, la oferta o el mensaje: la gente pregunta pero no compra.`,
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
  "En producción": ["Empacado", "Pagado"],
  "Empacado": ["Listo para despacho", "En ruta", "En producción"],
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
  if (["En producción","Empacado","Listo para despacho","En ruta","Entregado"].includes(estado) && !o.pagadoEn) {
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
      const tieneComprobante = evidencesOf(db, orderId).some((e) => e.tipo === "Comprobante de pago" && e.url);
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
  if (["En producción","Empacado","Listo para despacho","En ruta","Entregado"].includes(estado) && o.pagadoEn && !o.inventarioReservado) {
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
      const antesDeProduccion = !["En producción","Empacado","Listo para despacho","En ruta","Entregado"].includes(prev);
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
  return <span style={{ background: s.bg, color: s.fg }} className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap">{label}</span>;
}

function Card({ children, className = "", onClick }) {
  return (
    <div onClick={onClick} style={{ background: T.surface, borderColor: T.border }}
      className={`rounded-2xl border shadow-sm ${onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""} ${className}`}>
      {children}
    </div>
  );
}

function Stat({ icon, label, value, sub, tone, onClick }) {
  return (
    <Card className="p-4 flex flex-col gap-1 min-w-0" onClick={onClick}>
      <div className="flex items-center gap-2 text-xs font-bold" style={{ color: T.choco2 }}>
        <span aria-hidden="true">{icon}</span><span className="truncate">{label}</span>
      </div>
      <div className="display text-2xl font-semibold" style={{ color: tone || T.choco }}>{value}</div>
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

function Btn({ children, onClick, kind = "primary", small, disabled, type = "button" }) {
  const styles = {
    primary: { background: T.coral, color: "#fff", border: "1px solid " + T.coral },
    soft: { background: T.coralSoft, color: "#A34A2A", border: "1px solid #F3CDBE" },
    ghost: { background: "transparent", color: T.choco, border: "1px solid " + T.border },
    rosa: { background: T.rosa, color: "#8E4B5A", border: "1px solid #E9BFC7" },
    danger: { background: "#F6D4CD", color: "#A03B2A", border: "1px solid #ECBBB1" },
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...styles, opacity: disabled ? 0.5 : 1 }}
      className={`rounded-xl font-bold ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"} active:scale-[.98] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(60,40,30,.45)" }} onClick={onClose} />
      <div style={{ background: T.bg }} className={`relative w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b" style={{ background: T.bg, borderColor: T.border }}>
          <h3 className="display text-lg font-semibold m-0">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full font-bold" style={{ background: T.surface, border: "1px solid " + T.border, color: T.choco }}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
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
            <div className="h-full rounded-full" style={{ width: Math.max((d.value / max) * 100, 3) + "%", background: d.color || T.rosaDeep }} />
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
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  const hoy = hoyISO();
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

  return (
    <div>
      <SectionTitle>Hoy en la cocina</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🧁" label="Ventas del día" value={fmt(ventasHoy)} sub={deHoy.length + " pedidos hoy · toca para ver"} tone={T.coral} onClick={() => go("Pedidos", { desde: hoy, hasta: hoy })} />
        <Stat icon="📦" label="Pedidos activos" value={activos.length} sub="en flujo operativo · toca para ver" onClick={() => go("Pedidos")} />
        <Stat icon="💳" label="Pendientes de pago" value={pendPago.length} sub={fmt(pendPago.reduce((s, o) => s + orderTotal(db, o), 0)) + " · toca para ver"} tone="#96690F" onClick={() => go("Pedidos", { pendientesPago: true })} />
        <Stat icon="⚠️" label="Reclamos abiertos" value={reclamosAbiertos.length} sub="requieren decisión · toca para ver" tone="#A03B2A" onClick={() => go("Reclamos", { claimId: reclamosAbiertos[0] ? reclamosAbiertos[0].id : "" })} />
      </div>

      {sugerencias.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>
          👩‍🍳 Producción sugerida: {sugerencias.map((s) => `${s.cantidad}× ${s.producto}`).join(" · ")}.{" "}
          <button className="underline" onClick={() => go("Producción")}>Ver en Producción</button>
        </div>
      )}

      {lotesListos.length > 0 && (
        <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
          🧊✅ {lotesListos.length} lote(s) cumplieron su tiempo de congelación y esperan pasar a "Listo": {lotesListos.map((l) => `${l.id} (${l.sabor})`).join(", ")}.{" "}
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
    </div>
  );
}

/* ================= PEDIDOS ================= */

const KANBAN_COLS = ["Nuevo","Confirmado","Pendiente de pago","Pagado","En producción","Empacado","Listo para despacho","En ruta","Entregado"];

function Pedidos({ db, update, user, focus, refrescar, perfil }) {
  const [modo, setModo] = useState("kanban");
  const [selId, setSelId] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [verFiltros, setVerFiltros] = useState(!!(focus && (focus.estado || focus.desde || focus.pendientesPago)));
  const [pendPago, setPendPago] = useState(!!(focus && focus.pendientesPago));
  const [f, setF] = useState({ q: "", canal: "", estado: (focus && focus.estado) || "", barrio: "", producto: "", cliente: "", desde: (focus && focus.desde) || "", hasta: (focus && focus.hasta) || "" });

  const barrios = [...new Set(db.orders.map((o) => o.barrio))];

  const filtrados = db.orders.filter((o) => {
    const c = customerOf(db, o.customerId);
    const items = itemsOf(db, o.id);
    const texto = (o.id + " " + (c.nombre || "") + " " + (c.telefono || "")).toLowerCase();
    const cumplePendPago = !pendPago || (["Nuevo","Confirmado","Pendiente de pago"].includes(o.estado) && !o.pagadoEn);
    return cumplePendPago
      && (!f.q || texto.includes(f.q.toLowerCase()))
      && (!f.canal || o.canal === f.canal)
      && (!f.estado || o.estado === f.estado)
      && (!f.barrio || o.barrio === f.barrio)
      && (!f.cliente || o.customerId === f.cliente)
      && (!f.producto || items.some((i) => i.productId === f.producto))
      && (!f.desde || o.fecha >= f.desde)
      && (!f.hasta || o.fecha <= f.hasta);
  });

  // Fase 3: la transición vive en el SERVER (set_order_status con todas las gates). Luego re-fetch.
  async function cambiar(orderId, estado, opts) {
    let res;
    try {
      res = await setOrderStatusRemoto(orderId, estado, !!(opts && opts.ventaRapida));
    } catch (e) {
      setAviso({ titulo: "Acción no permitida", texto: e.message });
      return;
    }
    const faltantes = (res && res.faltantes) || [];
    try {
      await refrescar();
    } catch (e) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El cambio se aplicó correctamente, pero no se pudo actualizar la vista. Recargá la página para ver el estado actual." + (faltantes.length ? " Ojo: había alertas de inventario, revisá Producción." : "") });
      return;
    }
    if (faltantes.length) {
      const prod = faltantes.filter((x) => x.area !== "Inventario");
      const ins = faltantes.filter((x) => x.area === "Inventario");
      const partes = [];
      if (prod.length) partes.push(`falta producir: ${prod.map((x) => x.cant + "× " + x.producto).join(", ")}`);
      if (ins.length) partes.push(`el inventario no alcanzó para: ${ins.map((x) => x.cant + "× " + x.producto).join(", ")}`);
      setAviso({ titulo: "Inventario insuficiente", texto: `Se reservó lo disponible, pero ${partes.join(" y ")}. Ya quedó la sugerencia en Producción.` });
    }
  }

  function exportar() {
    downloadCSV("pedidos",
      ["Pedido","Fecha","Hora","Canal","Cliente","Teléfono","Barrio","Zona","Productos","Subtotal","Descuento","Domicilio cobrado","Costo domicilio","Total","Pago","Estado","Campaña","Creativo","Origen"],
      filtrados.map((o) => {
        const c = customerOf(db, o.customerId);
        const camp = db.campaigns.find((x) => x.id === o.campaignId);
        const cre = db.creatives.find((x) => x.id === o.creativeId);
        return [o.id, o.fecha, o.hora, o.canal, c.nombre, c.telefono, o.barrio, o.zona,
          itemsOf(db, o.id).map((i) => i.cant + "x " + i.nombre + (i.sabor ? " (" + i.sabor + ")" : "") + (i.costoUnitario !== undefined ? " · costo hist. " + fmt(i.costoUnitario) : "")).join(" | "),
          orderSubtotal(db, o), o.descuento, o.domCobrado, o.domCosto, orderTotal(db, o), o.pago, o.estado,
          camp ? camp.nombre : "", cre ? cre.titulo : "", o.origenDetalle || ""];
      }));
  }

  const sel = selId ? db.orders.find((o) => o.id === selId) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Btn onClick={() => setNuevo(true)}>＋ Nuevo pedido</Btn>
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: T.border }}>
          {["kanban","tabla"].map((m) => (
            <button key={m} onClick={() => setModo(m)} className="px-3 py-2 text-xs font-bold capitalize"
              style={{ background: modo === m ? T.rosa : T.surface, color: modo === m ? "#8E4B5A" : T.choco2 }}>{m}</button>
          ))}
        </div>
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Buscar pedido, cliente o teléfono…"
          className="flex-1 min-w-[170px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
        <Btn small kind="ghost" onClick={() => setVerFiltros(!verFiltros)}>Filtros {(pendPago || Object.values(f).filter((v, i) => i > 0 && v).length > 0) && "●"}</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {verFiltros && (
        <Card className="p-3 mb-4">
          {pendPago && (
            <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-xl" style={{ background: "#FBE8C8" }}>
              <span className="text-xs font-bold" style={{ color: "#96690F" }}>💳 Solo pendientes de pago (Nuevo, Confirmado o Pendiente de pago, sin pago registrado)</span>
              <button onClick={() => setPendPago(false)} className="text-xs font-bold" style={{ color: "#96690F" }}>Quitar ✕</button>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniSelect placeholder="Canal: todos" options={CANALES} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} />
          <MiniSelect placeholder="Estado: todos" options={ORDER_STATES} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} />
          <MiniSelect placeholder="Barrio: todos" options={barrios} value={f.barrio} onChange={(e) => setF({ ...f, barrio: e.target.value })} />
          <select value={f.producto} onChange={(e) => setF({ ...f, producto: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
            <option value="">Producto: todos</option>
            {db.products.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
            <option value="">Cliente: todos</option>
            {db.customers.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
          <input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
          <Btn small kind="ghost" onClick={() => { setF({ q: f.q, canal: "", estado: "", barrio: "", producto: "", cliente: "", desde: "", hasta: "" }); setPendPago(false); }}>Limpiar</Btn>
          </div>
        </Card>
      )}

      {modo === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
          {KANBAN_COLS.map((col) => {
            const enCol = filtrados.filter((o) => o.estado === col);
            return (
              <div key={col} className="w-64 shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <Badge label={col} /><span className="text-xs font-bold" style={{ color: T.choco2 }}>{enCol.length}</span>
                </div>
                <div className="flex flex-col gap-2 min-h-[60px] rounded-2xl p-2" style={{ background: T.vainilla + "80" }}>
                  {enCol.map((o) => {
                    const c = customerOf(db, o.customerId);
                    return (
                      <Card key={o.id} className="p-3" onClick={() => setSelId(o.id)}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="font-bold text-sm">{o.id}</div>
                          <Badge label={o.canal} map={CANAL_STYLE} />
                        </div>
                        <div className="text-sm font-semibold mt-1 truncate">{c.nombre}</div>
                        <div className="text-xs truncate" style={{ color: T.choco2 }}>{o.barrio} · {o.hora}</div>
                        <div className="text-xs mt-1 truncate" style={{ color: T.choco2 }}>
                          {itemsOf(db, o.id).map((i) => `${i.cant}× ${i.nombre.split(" ").slice(0, 2).join(" ")}`).join(", ")}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="display font-semibold">{fmt(orderTotal(db, o))}</span>
                          {tieneSelloEmpaque(db, o.id) && <span title="Con sello de empaque" className="text-xs">📸</span>}
                        </div>
                      </Card>
                    );
                  })}
                  {enCol.length === 0 && <div className="text-xs text-center py-4 font-semibold" style={{ color: T.choco2 }}>Sin pedidos</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
              {["Pedido","Cliente","Canal","Barrio","Total","Pago","Estado",""].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {filtrados.map((o) => {
                const c = customerOf(db, o.customerId);
                return (
                  <tr key={o.id} className="border-t" style={{ borderColor: T.border }}>
                    <td className="px-3 py-2.5 font-bold">{o.id}<div className="text-xs font-normal" style={{ color: T.choco2 }}>{o.fecha} {o.hora}</div></td>
                    <td className="px-3 py-2.5">{c.nombre}<div className="text-xs" style={{ color: T.choco2 }}>{c.telefono}</div></td>
                    <td className="px-3 py-2.5"><Badge label={o.canal} map={CANAL_STYLE} /></td>
                    <td className="px-3 py-2.5">{o.barrio}</td>
                    <td className="px-3 py-2.5 font-bold">{fmt(orderTotal(db, o))}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold">{o.pago}{o.comprobante ? " ✓" : ""}</td>
                    <td className="px-3 py-2.5"><Badge label={o.estado} /></td>
                    <td className="px-3 py-2.5"><Btn small kind="ghost" onClick={() => setSelId(o.id)}>Abrir</Btn></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {sel && <DetallePedido db={db} o={sel} update={update} user={user} onClose={() => setSelId(null)} cambiar={cambiar} setAviso={setAviso} refrescar={refrescar} perfil={perfil} />}
      {nuevo && <NuevoPedido db={db} update={update} user={user} onClose={() => setNuevo(false)} setAviso={setAviso} refrescar={refrescar} />}
      {aviso && (
        <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
          <p className="text-sm m-0">{aviso.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

function DetallePedido({ db, o, update, user, onClose, cambiar, setAviso, refrescar, perfil }) {
  const fileRef = useRef(null);
  const tipoSubidaRef = useRef("Comprobante de pago"); // tipo fijo de la subida en curso
  const [tipoEv, setTipoEv] = useState(o.pagadoEn ? "Entrega" : "Comprobante de pago"); // solo para el modo libre (＋ otra foto)
  const [libre, setLibre] = useState(false); // muestra el picker manual para documentales
  const [subiendo, setSubiendo] = useState(false);
  const [foto, setFoto] = useState(null);
  const [enviando, setEnviando] = useState(false); // guarda local: cambiar() y crearReclamo() son async vía props
  const c = customerOf(db, o.customerId);
  const evs = evidencesOf(db, o.id);
  const flujo = { "Nuevo": "Confirmado", "Confirmado": "Pendiente de pago", "Pendiente de pago": "Pagado", "Pagado": "En producción", "En producción": "Empacado", "Empacado": "Listo para despacho", "Listo para despacho": "En ruta", "En ruta": "Entregado" };
  const siguiente = flujo[o.estado];

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSubiendo(true);
    try {
      const url = await compressImage(file);
      const tipo = tipoSubidaRef.current;
      // Fase 3: la foto va al bucket privado + RPC crear_evidencia (id/user/audit server-side)
      await subirEvidencia({ orderId: o.id, tipo, dataUrl: url });
    } catch (err) {
      setAviso({ titulo: "Error al subir", texto: err.message || "No se pudo procesar la imagen. Intenta con otra foto." });
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      await refrescar();
    } catch (err) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "La evidencia se guardó correctamente, pero no se pudo actualizar la vista. Recargá la página para verla." });
    }
    setSubiendo(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Dispara la cámara/galería para una foto con su tipo YA FIJO (evidencias guiadas por paso).
  function abrirCamara(tipo) {
    tipoSubidaRef.current = tipo;
    if (fileRef.current) fileRef.current.click();
  }

  return (
    <Modal title={`Pedido ${o.id}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge label={o.estado} /><Badge label={o.canal} map={CANAL_STYLE} />
        <span className="text-xs font-semibold" style={{ color: T.choco2 }}>{o.fecha} · {o.hora}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>CLIENTE Y ENTREGA</div>
          <div className="text-sm font-bold">{c.nombre}</div>
          <div className="text-sm">{c.telefono} {c.instagram && `· ${c.instagram}`}</div>
          <div className="text-sm mt-1">{o.direccion}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{o.barrio} · {o.zona}</div>
          {o.obs && <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: T.vainilla }}>📝 {o.obs}</div>}
          {(o.campaignId || o.creativeId || o.origenDetalle) && (() => {
            const camp = db.campaigns.find((c) => c.id === o.campaignId);
            const cre = db.creatives.find((c) => c.id === o.creativeId);
            return (
              <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: "#F3D7DC55" }}>
                📣 {[camp && "Campaña: " + camp.nombre, cre && "Creativo: " + cre.titulo, o.origenDetalle && "Origen: " + o.origenDetalle].filter(Boolean).join(" · ")}
              </div>
            );
          })()}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PAGO</div>
          <div className="flex justify-between text-sm py-1"><span>Subtotal productos</span><b>{fmt(orderSubtotal(db, o))}</b></div>
          {o.descuento > 0 && <div className="flex justify-between text-sm py-1" style={{ color: "#3F6B42" }}><span>Beneficio {o.benefitId && `(${o.benefitId})`}</span><b>−{fmt(o.descuento)}</b></div>}
          <div className="flex justify-between text-sm py-1"><span>Domicilio cobrado</span><b>{fmt(o.domCobrado)}</b></div>
          <div className="flex justify-between text-sm py-1 items-center" style={{ color: T.choco2 }}>
            <span>Costo real domicilio</span>
            {o.canal === "Rappi" ? (
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$0 · Rappi app</span>
            ) : (
              <input type="number" value={o.domCosto || ""} placeholder="registrar"
                onChange={(e) => update((d) => { const x = d.orders.find((y) => y.id === o.id); x.domCosto = +e.target.value || 0; })}
                className="w-24 rounded-lg px-2 py-1 text-xs border text-right font-bold" style={inputStyle} />
            )}
          </div>
          <div className="flex justify-between py-2 mt-1 border-t display text-lg" style={{ borderColor: T.border }}><span>Total</span><b style={{ color: T.coral }}>{fmt(orderTotal(db, o))}</b></div>
          <div className="text-xs font-semibold">{o.pago} {o.comprobante ? "· comprobante recibido ✓" : "· sin comprobante"}</div>
        </Card>
      </div>

      <div className="mt-4">
        <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PRODUCTOS</div>
        {itemsOf(db, o.id).filter((i) => !i.parentItemId).map((i) => {
          const p = productOf(db, i.productId);
          const disp = p ? availability(db, p) : Infinity;
          const sinStock = p && !["Pagado","En producción","Empacado","Listo para despacho","En ruta","Entregado"].includes(o.estado) && disp < i.cant;
          const hijas = itemsOf(db, o.id).filter((h) => h.parentItemId === i.id);
          return (
            <Card key={i.id} className="p-3 mb-2">
              <div className="flex justify-between gap-2">
                <div className="text-sm font-bold">{i.cant}× {i.nombre}</div>
                <div className="text-sm font-bold">{fmt(i.precio * i.cant + lineAdicionesTotal(i) + hijas.reduce((s, h) => s + lineAdicionesTotal(h), 0))}</div>
              </div>
              <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>
                {[i.sabor && `Sabor: ${i.sabor}`, i.figura && `Figura: ${i.figura}`, i.salsa && `Salsa: ${i.salsa}`, i.relleno && `Relleno: ${i.relleno}`].filter(Boolean).join(" · ")}
              </div>
              {lineAdiciones(i).length > 0 && (
                <div className="text-xs font-bold mt-1" style={{ color: T.coral }}>
                  🍫 {lineAdiciones(i).map((ad) => ad.nombre + ((ad.cant || 1) > 1 ? ` ×${ad.cant}` : "") + (+ad.precio > 0 ? " (+" + fmt(ad.precio * (ad.cant || 1)) + ")" : " · gratis")).join("  ·  ")}
                </div>
              )}
              {hijas.length > 0 && (() => {
                const cajas = {};
                hijas.forEach((h) => { const n = h.cajaNum || 1; (cajas[n] = cajas[n] || []).push(h); });
                const nums = Object.keys(cajas).map(Number).sort((a, b) => a - b);
                const multi = nums.length > 1;
                return (
                  <div className="mt-2 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.choco2 }}>COMPOSICIÓN {multi ? `(${nums.length} cajas) ` : "DE LA CAJA "}(para la cocina)</div>
                    {nums.map((n) => (
                      <div key={n} className={multi ? "mb-1" : ""}>
                        {multi && <div className="text-[10px] font-bold" style={{ color: T.coral }}>Caja {n}</div>}
                        {cajas[n].map((h) => (
                          <div key={h.id} className="text-xs mb-0.5" style={{ color: T.choco2 }}>
                            <span className="font-bold">🐾 {h.figura}</span>{[h.sabor && ` · ${h.sabor}`, h.salsa && ` · ${h.salsa}`, h.cant > 1 && ` · ×${h.cant}`].filter(Boolean).join("")}
                            {lineAdiciones(h).length > 0 && <span className="font-bold" style={{ color: T.coral }}>  ·  🍫 {lineAdiciones(h).map((ad) => ad.nombre + (+ad.precio > 0 ? " (+" + fmt(ad.precio) + ")" : "")).join(", ")}</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {sinStock && <div className="text-xs font-bold mt-1" style={{ color: "#A03B2A" }}>⚠️ Disponibilidad actual: {disp}. Al pagar se reservará lo posible y se sugerirá producción del resto.</div>}
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>EVIDENCIAS ({evs.length})</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
          {evs.map((e) => (
            <button key={e.id} onClick={() => e.url && setFoto(e)} className="rounded-xl overflow-hidden border text-left" style={{ borderColor: T.border, background: T.vainilla }}>
              {e.url ? <img src={e.url} alt={e.tipo} className="w-full h-20 object-cover" /> :
                <div className="w-full h-20 flex items-center justify-center text-2xl" aria-hidden="true">📷</div>}
              <div className="px-2 py-1">
                <div className="text-[10px] font-bold leading-tight">{e.tipo}</div>
                <div className="text-[9px]" style={{ color: T.choco2 }}>{e.hora} · {e.user}</div>
              </div>
            </button>
          ))}
        </div>
        {/* Evidencias guiadas por paso: cada objetivo alcanzable pide su(s) foto(s) con tipo YA FIJO */}
        {(() => {
          const objetivos = [];
          if (siguiente) objetivos.push(siguiente);
          const puedePagar = !o.comprobante && !["Pagado","Entregado","Cancelado","Reclamo"].includes(o.estado);
          if (puedePagar && !objetivos.includes("Pagado")) objetivos.push("Pagado");
          const reqs = objetivos.flatMap((est) => reqFotosPaso(o, est));
          if (!reqs.length) return null;
          return (
            <div className="rounded-xl p-3 mb-3" style={{ background: T.vainilla, border: `1px solid ${T.border}` }}>
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>📸 Fotos requeridas para avanzar (obligatorias)</div>
              {reqs.map((req) => {
                const hecho = req.tipos.some((t) => tieneEvidencia(db, o.id, t));
                return (
                  <div key={req.label} className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: hecho ? "#3F6B42" : "#A03B2A" }}>
                      {hecho ? "✓" : "○"} {req.label}
                    </span>
                    {!hecho && req.tipos.map((t) => (
                      <Btn key={t} small kind="rosa" disabled={subiendo} onClick={() => abrirCamara(t)}>
                        {subiendo ? "Procesando…" : `📷 ${req.tipos.length > 1 ? t : "Tomar foto"}`}
                      </Btn>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {siguiente === "En ruta" &&
          <div className="text-xs font-bold mb-2" style={{ color: "#A03B2A" }}>Para pasar a “En ruta” además: pago confirmado, domicilio asignado y costo real registrado (salvo Rappi). El sello ya se capturó en Empacado.</div>}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        <button type="button" onClick={() => setLibre((v) => !v)} className="text-xs font-bold underline" style={{ color: T.choco2 }}>
          {libre ? "− ocultar" : "＋ otra foto (opcional)"}
        </button>
        {libre && (
          <div className="flex flex-wrap gap-2 items-center mt-2">
            <MiniSelect options={EV_TIPOS} value={tipoEv} onChange={(e) => setTipoEv(e.target.value)} />
            <Btn small kind="rosa" disabled={subiendo} onClick={() => abrirCamara(tipoEv)}>
              {subiendo ? "Procesando…" : "📷 Subir foto"}
            </Btn>
          </div>
        )}
        <div className="text-[11px] font-semibold mt-2" style={{ color: "#96690F" }}>
          ⚠️ Las fotos se guardan en el almacenamiento local de esta app (espacio limitado). Para operación real, migra las evidencias a Supabase Storage.
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 sticky bottom-0 py-3" style={{ background: T.bg }}>
        {siguiente && <Btn disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, siguiente); setEnviando(false); }}>Pasar a “{siguiente}”</Btn>}
        {!o.comprobante && !["Pagado","Entregado","Cancelado","Reclamo"].includes(o.estado) && <Btn kind="soft" disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, "Pagado"); setEnviando(false); }}>Marcar pagado</Btn>}
        {o.pagadoEn && ["Pagado","En producción","Empacado","Listo para despacho"].includes(o.estado) && <Btn kind="soft" disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, "Entregado", { ventaRapida: true }); setEnviando(false); }}>⚡ Entrega inmediata</Btn>}
        {!["Reclamo","Cancelado"].includes(o.estado) && (
          <Btn kind="danger" disabled={enviando} onClick={async () => {
            setEnviando(true);
            // Fase 3: crear_reclamo ya transiciona el pedido a 'Reclamo' y audita server-side (no llamar setOrderStatusRemoto aparte).
            try {
              await crearReclamo(o.id, "Reclamo por calidad", "Reclamo creado desde el pedido. Completar detalle.");
            } catch (e) {
              setAviso({ titulo: "Acción no permitida", texto: e.message });
              setEnviando(false);
              return;
            }
            try {
              await refrescar();
            } catch (e) {
              setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El reclamo se creó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
              setEnviando(false);
              return;
            }
            setAviso({ titulo: "Reclamo creado", texto: `Se abrió un caso conectado al pedido ${o.id}. Complétalo en el módulo Reclamos.` });
            setEnviando(false);
          }}>Crear reclamo</Btn>
        )}
        {!["Entregado","Cancelado","Reclamo"].includes(o.estado) && <Btn kind="ghost" disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, "Cancelado"); setEnviando(false); }}>Cancelar pedido</Btn>}
      </div>

      {foto && (
        <Modal title={foto.tipo} onClose={() => setFoto(null)}>
          <img src={foto.url} alt={foto.tipo} className="w-full rounded-2xl" />
          <div className="text-xs font-semibold mt-2" style={{ color: T.choco2 }}>{foto.fecha} {foto.hora} · subida por {foto.user}</div>
        </Modal>
      )}
    </Modal>
  );
}

function NuevoPedido({ db, update, user, onClose, setAviso, refrescar }) {
  const s = db.settings;
  const idemKeyRef = useRef("ui-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36)); // 1 por apertura del form: tolera retries de red
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false); // espejo de enviandoRef solo para feedback visual (disabled); el ref sigue siendo el guard real
  const [customerId, setCustomerId] = useState("");
  const [nc, setNc] = useState({ nombre: "", telefono: "", barrio: "" });
  const [canal, setCanal] = useState("WhatsApp");
  const [zona, setZona] = useState(s.zonas[0].nombre);
  const [direccion, setDireccion] = useState("");
  const [pago, setPago] = useState("Nequi");
  const [obs, setObs] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [creativeId, setCreativeId] = useState("");
  const [origenDetalle, setOrigenDetalle] = useState("");
  const [origenSimple, setOrigenSimple] = useState("");
  const [verAvanzado, setVerAvanzado] = useState(false);
  const [items, setItems] = useState([{ productId: "", sabor: "", salsa: "", relleno: "", figura: "", cant: 1, adiciones: [], boxes: [] }]);
  const [error, setError] = useState("");

  const pagosDisponibles = canal === "Rappi" ? ["Rappi (app)"] : s.pagos.filter((p) => p !== "Rappi (app)");
  const sabores = [...s.saboresFrutales, ...s.saboresCremosos];
  const c = db.customers.find((x) => x.id === customerId);
  const benef = c && db.benefits.find((b) => b.customerId === c.id && b.estado === "Activo" && b.vence >= hoyISO());
  const tarifaZona = (s.zonas.find((z) => z.nombre === zona) || {}).tarifa || 0;
  const tarifa = canal === "Rappi" ? 0 : tarifaZona;

  const lineas = items.map((it) => {
    const p = productOf(db, it.productId);
    // Combos: faltante por ESPECIE según la composición real (boxes), coherente con reserveInventory.
    const faltaEsp = p && p.tipo === "combo" ? comboFaltantesEspecie(db, p, it.boxes) : [];
    return { ...it, nombre: p ? p.nombre : "", precio: p ? (canal === "Rappi" ? p.precioRappi : p.precio) : 0, disp: p ? availability(db, p) : Infinity, tipo: p ? p.tipo : "", faltaEsp };
  });
  const subtotal = lineas.reduce((sm, l) => sm + l.precio * l.cant + lineAdicionesTotal(l) + boxesAdicionesTotal(l), 0);

  // Aplicación del beneficio según su tipo (solo si cumple compra mínima)
  const benefAplica = benef && subtotal >= benef.minimo;
  let descuento = 0;
  let productoGratis = null;
  if (benefAplica) {
    if (benef.tipoBeneficio === "descuento_porcentaje") descuento = Math.round(subtotal * (benef.valor / 100));
    else if (benef.tipoBeneficio === "descuento_valor_fijo") descuento = Math.min(benef.valor, subtotal);
    else if (benef.tipoBeneficio === "producto_gratis") productoGratis = productOf(db, benef.productoGratisId);
  }
  const total = subtotal - descuento + tarifa;
  const faltaStock = lineas.filter((l) => l.productId && (l.disp < l.cant || (l.faltaEsp && l.faltaEsp.length > 0)));

  const setItem = (i, campo, valor) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, [campo]: valor } : x));
  // Combos con composición POR CAJA: boxes = Array(cant) de Array(comboSize) de {figura,sabor,salsa}.
  const setSlot = (i, boxIdx, slotIdx, campo, valor) => setItems((prev) => prev.map((x, idx) =>
    idx === i ? { ...x, boxes: (x.boxes || []).map((box, bi) => bi === boxIdx ? box.map((sl, si) => si === slotIdx ? { ...sl, [campo]: valor } : sl) : box) } : x));
  // "= mismos momos": copia el slot 0 al resto de esa caja.
  const mismosMomos = (i, boxIdx) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    return { ...x, boxes: (x.boxes || []).map((box, bi) => bi === boxIdx && box.length ? box.map(() => ({ ...box[0], adiciones: [...(box[0].adiciones || [])] })) : box) };
  }));
  // "Caja 1 → todas": replica la composición de la caja 1 a todas las cajas de la línea.
  const copiarCaja1ATodas = (i) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i || !(x.boxes || []).length) return x;
    const first = x.boxes[0];
    return { ...x, boxes: x.boxes.map(() => first.map((sl) => ({ ...sl, adiciones: [...(sl.adiciones || [])] }))) };
  }));
  // Cambiar la cantidad de una línea. Para combos, redimensiona `boxes` conservando lo ya compuesto.
  const setCant = (i, prod, nc) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    const n = Math.max(1, Math.floor(nc) || 1); // cajas/unidades enteras: mantiene boxes.length === cant
    if (prod && prod.tipo === "combo") {
      const size = prod.comboSize || 0;
      const cur = x.boxes || [];
      const boxes = Array.from({ length: n }, (_, b) => cur[b] || Array.from({ length: size }, () => ({ figura: "", sabor: "", salsa: "", adiciones: [] })));
      return { ...x, cant: n, boxes };
    }
    return { ...x, cant: n };
  }));
  const toggleAdicion = (i, top) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    const cur = Array.isArray(x.adiciones) ? x.adiciones : [];
    const has = cur.some((a) => a.nombre === top.nombre);
    return { ...x, adiciones: has
      ? cur.filter((a) => a.nombre !== top.nombre)
      : [...cur, { nombre: top.nombre, precio: +top.precio || 0, cant: 1, insumoId: top.insumoId || "", insumoCant: +top.insumoCant || 1 }] };
  }));
  // Toppings POR SUB-MOMO: cada slot de la caja lleva sus propias adiciones (mismo shape que la línea).
  const toggleSlotAdicion = (i, boxIdx, slotIdx, top) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    return { ...x, boxes: (x.boxes || []).map((box, bi) => bi !== boxIdx ? box : box.map((sl, si) => {
      if (si !== slotIdx) return sl;
      const cur = Array.isArray(sl.adiciones) ? sl.adiciones : [];
      const has = cur.some((a) => a.nombre === top.nombre);
      return { ...sl, adiciones: has
        ? cur.filter((a) => a.nombre !== top.nombre)
        : [...cur, { nombre: top.nombre, precio: +top.precio || 0, cant: 1, insumoId: top.insumoId || "", insumoCant: +top.insumoCant || 1 }] };
    })) };
  }));

  async function guardar() {
    if (!customerId && (!nc.nombre || !nc.telefono)) { setError("Selecciona un cliente o registra nombre y teléfono."); return; }
    if (!lineas.some((l) => l.productId)) { setError("Agrega al menos un producto."); return; }
    if (subtotal < s.pedidoMinimo) { setError(`El pedido mínimo es ${fmt(s.pedidoMinimo)} (sin domicilio).`); return; }
    const combosIncompletos = lineas.filter((l) => l.productId && l.tipo === "combo")
      .filter((l) => !(l.boxes || []).length || (l.boxes || []).some((box) => !box.length || box.some((sl) => !sl.figura || !sl.sabor || !sl.salsa)));
    if (combosIncompletos.length) { setError("Completá figura, sabor y salsa en cada momo de cada caja."); return; }
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError("");
    // Fase 3: el pedido nace en el SERVER. crear_pedido calcula precios, snapshotea costos,
    // crea el cliente nuevo, arma padre+hijas de combos, reserva el beneficio y el delivery Rappi.
    const mapAdic = (ads) => (ads || []).map((a) => ({ nombre: a.nombre, precio: +a.precio || 0, cant: +a.cant || 1, insumo_id: a.insumoId || null, insumo_cant: +a.insumoCant || 0 }));
    const payload = {
      customer_id: customerId || null,
      nuevo_cliente: customerId ? null : { nombre: nc.nombre.trim(), telefono: nc.telefono.trim(), barrio: nc.barrio || "", direccion, canal },
      canal, zona: zona || null, barrio: (c && c.barrio) || nc.barrio || "", direccion, pago,
      obs, benefit_id: benefAplica && benef ? benef.id : null,
      campaign_id: campaignId || null, creative_id: creativeId || null, origen_detalle: origenDetalle || "",
      idempotency_key: idemKeyRef.current,
      lineas: items.filter((l) => l.productId).map((l) => {
        const p = productOf(db, l.productId);
        const base = { product_id: l.productId, cant: l.cant, sabor: l.sabor || "", salsa: l.salsa || "", figura: l.figura || "", adiciones: mapAdic(l.adiciones) };
        if (p && p.tipo === "combo") base.boxes = (l.boxes || []).map((box) => box.map((sl) => ({ figura: sl.figura, sabor: sl.sabor, salsa: sl.salsa, adiciones: mapAdic(sl.adiciones) })));
        return base;
      }),
    };
    let res;
    try {
      res = await crearPedido(payload);
    } catch (e) {
      setError(e.message);
      enviandoRef.current = false;
      setEnviando(false);
      return;
    }
    onClose();
    try {
      await refrescar();
      if (faltaStock.length) setAviso({ titulo: "Pedido creado con alerta", texto: `${res.order_id} creado. Ojo: disponibilidad insuficiente en ${faltaStock.map((l) => l.nombre).join(", ")}. Al marcar pagado se creará la sugerencia de producción.` });
    } catch (e) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: `${res.order_id} se creó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo.` });
    }
    enviandoRef.current = false;
    setEnviando(false);
  }

  return (
    <Modal title="Nuevo pedido" onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Cliente existente">
          <select value={customerId} onChange={(e) => {
            const id = e.target.value;
            setCustomerId(id);
            const cli = db.customers.find((x) => x.id === id);
            if (cli) {
              if (cli.direccion) setDireccion(cli.direccion);
              const z = sugerirZona(s.zonas, cli.barrio);
              if (z) setZona(z);
            } else {
              // volvió a "Cliente nuevo": limpiar datos, mantener canal y pago
              setDireccion("");
              setNc({ nombre: "", telefono: "", barrio: "" });
              setZona(s.zonas[0].nombre);
            }
          }} className={inputCls} style={inputStyle}>
            <option value="">— Cliente nuevo —</option>
            {db.customers.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {x.telefono}</option>)}
          </select>
        </Field>
        <Field label="Canal"><Select options={CANALES} value={canal} onChange={(e) => {
          const nuevoCanal = e.target.value;
          setCanal(nuevoCanal);
          setPago(nuevoCanal === "Rappi" ? "Rappi (app)" : "Nequi");
        }} /></Field>
        {!customerId && (<>
          <Field label="Nombre del cliente"><Input value={nc.nombre} onChange={(e) => setNc({ ...nc, nombre: e.target.value })} placeholder="Nombre y apellido" /></Field>
          <Field label="Teléfono / WhatsApp"><Input value={nc.telefono} onChange={(e) => setNc({ ...nc, telefono: e.target.value })} placeholder="3XX XXX XXXX" /></Field>
          <Field label="Barrio"><Input value={nc.barrio} onChange={(e) => setNc({ ...nc, barrio: e.target.value })} placeholder="El Caney, El Ingenio…" /></Field>
        </>)}
        <Field label="Dirección de entrega"><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección completa" /></Field>
        <Field label="Zona de domicilio"><Select options={s.zonas.map((z) => z.nombre)} value={zona} onChange={(e) => setZona(e.target.value)} /></Field>
        <Field label="Forma de pago"><Select options={pagosDisponibles} value={pago} onChange={(e) => setPago(e.target.value)} /></Field>
      </div>

      {benef && (
        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
          🎁 {c.nombre} tiene beneficio activo: {benef.beneficio} ({benef.condicion}). Mínimo {fmt(benef.minimo)}.
          {benefAplica
            ? (productoGratis ? ` Se agregará 1 ${productoGratis.nombre} gratis y el beneficio quedará Reservado hasta confirmar el pago.` : " Se aplicará el descuento y el beneficio quedará Reservado hasta confirmar el pago.")
            : " Aún no cumple la compra mínima."}
        </div>
      )}

      {canal === "Rappi" && (
        <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.coralSoft, color: "#A34A2A" }}>
          🛵 Rappi gestiona el domicilio y el pago dentro de su app. MOMOS no cobra domicilio adicional en este pedido.
        </div>
      )}

      <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PRODUCTOS DEL PEDIDO</div>
      {items.map((it, i) => {
        const l = lineas[i];
        const pSel = productOf(db, it.productId);
        const attrs = pSel && Array.isArray(pSel.atributos) ? pSel.atributos : ["sabor", "salsa", "relleno", "figura"];
        return (
          <Card key={i} className="p-3 mb-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="col-span-2 sm:col-span-3">
                <select value={it.productId} onChange={(e) => {
                  const pid = e.target.value;
                  const prod = productOf(db, pid);
                  setItems((prev) => prev.map((x, idx) => {
                    if (idx !== i) return x;
                    const boxes = prod && prod.tipo === "combo"
                      ? Array.from({ length: Math.max(1, x.cant || 1) }, () => Array.from({ length: prod.comboSize || 0 }, () => ({ figura: "", sabor: "", salsa: "", adiciones: [] })))
                      : [];
                    return { ...x, productId: pid, boxes };
                  }));
                }} className={inputCls} style={inputStyle}>
                  <option value="">Elegir producto…</option>
                  {db.products.filter((p) => p.activo).map((p) => {
                    const disp = availability(db, p);
                    return <option key={p.id} value={p.id}>{p.nombre} · {fmt(canal === "Rappi" ? p.precioRappi : p.precio)}{isFinite(disp) ? ` · ${disp} disp.` : ""}</option>;
                  })}
                </select>
              </div>
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("sabor") && <Select placeholder="Sabor" options={sabores} value={it.sabor} onChange={(e) => setItem(i, "sabor", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("salsa") && <Select placeholder="Salsa" options={s.salsas} value={it.salsa} onChange={(e) => setItem(i, "salsa", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("relleno") && <Select placeholder="Relleno" options={s.rellenos} value={it.relleno} onChange={(e) => setItem(i, "relleno", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("figura") && <Select placeholder="Figura" options={s.figuras.map((f) => f.nombre)} value={it.figura} onChange={(e) => setItem(i, "figura", e.target.value)} />}
              <Input type="number" min="1" value={it.cant} onChange={(e) => setCant(i, pSel, Math.max(1, +e.target.value))} />
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-bold">{fmt(l.precio * l.cant + lineAdicionesTotal(l) + boxesAdicionesTotal(l))}</span>
                {items.length > 1 && <button onClick={() => setItems(items.filter((_, x) => x !== i))} className="text-xs font-bold" style={{ color: "#A03B2A" }}>Quitar</button>}
              </div>
            </div>
            {it.productId && pSel && pSel.tipo === "combo" && (() => {
              const boxes = it.boxes || [];
              const multi = boxes.length > 1;
              const figOpts = figurasDeCombo(db, pSel).map((f) => f.nombre);
              return (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: T.border }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] font-bold" style={{ color: T.choco2 }}>🎁 ARMÁ {multi ? `LAS ${boxes.length} CAJAS` : "LA CAJA"} · {pSel.comboSize} momos c/u</div>
                    {multi && <button type="button" onClick={() => copiarCaja1ATodas(i)} className="text-[11px] font-bold" style={{ color: T.coral }}>Caja 1 → todas</button>}
                  </div>
                  {boxes.map((box, b) => (
                    <div key={b} className={multi ? "mb-2 p-2 rounded-lg" : ""} style={multi ? { background: T.vainilla } : {}}>
                      <div className="flex items-center justify-between mb-1">
                        {multi ? <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>CAJA {b + 1}</div> : <span />}
                        {box.length > 1 && <button type="button" onClick={() => mismosMomos(i, b)} className="text-[10px] font-bold" style={{ color: T.coral }}>= mismos momos</button>}
                      </div>
                      {box.map((sl, si) => (
                        <div key={si} className="mb-1.5">
                          <div className="grid grid-cols-3 gap-1.5">
                            <Select placeholder="Figura" options={figOpts} value={sl.figura} onChange={(e) => setSlot(i, b, si, "figura", e.target.value)} />
                            <Select placeholder="Sabor" options={sabores} value={sl.sabor} onChange={(e) => setSlot(i, b, si, "sabor", e.target.value)} />
                            <Select placeholder="Salsa" options={s.salsas} value={sl.salsa} onChange={(e) => setSlot(i, b, si, "salsa", e.target.value)} />
                          </div>
                          {Array.isArray(s.toppings) && s.toppings.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {s.toppings.map((top) => {
                                const on = (sl.adiciones || []).some((a) => a.nombre === top.nombre);
                                return (
                                  <button key={top.nombre} type="button" onClick={() => toggleSlotAdicion(i, b, si, top)}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: on ? T.coral : T.vainilla, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                                    🍫 {top.nombre}{(+top.precio > 0) ? " +" + fmt(top.precio) : ""}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
            {it.productId && pSel && pSel.tipo !== "combo" && Array.isArray(s.toppings) && s.toppings.length > 0 && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: T.border }}>
                <div className="text-[11px] font-bold mb-1" style={{ color: T.choco2 }}>🍫 TOPPINGS (opcional)</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.toppings.map((top) => {
                    const on = (it.adiciones || []).some((a) => a.nombre === top.nombre);
                    return (
                      <button key={top.nombre} type="button" onClick={() => toggleAdicion(i, top)}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                        style={{ background: on ? T.coral : T.vainilla, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                        {top.nombre}{(+top.precio > 0) ? " +" + fmt(top.precio) : " · gratis"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {l.productId && (l.faltaEsp && l.faltaEsp.length > 0) && (
              <div className="text-xs font-bold mt-2" style={{ color: "#A03B2A" }}>⚠️ Faltan momos para esta caja: {l.faltaEsp.map((f) => f.falta + " " + f.nombre).join(", ")}. Se reservará lo posible y se sugerirá producción del resto.</div>
            )}
            {l.productId && l.disp < l.cant && !(l.faltaEsp && l.faltaEsp.length > 0) && (
              <div className="text-xs font-bold mt-2" style={{ color: "#A03B2A" }}>⚠️ Disponibilidad: {l.disp}{l.tipo === "combo" ? " (según momos y cajas)" : ""}. Se sugerirá producción del faltante.</div>
            )}
          </Card>
        );
      })}
      <Btn small kind="rosa" onClick={() => setItems([...items, { productId: "", sabor: "", salsa: "", relleno: "", figura: "", cant: 1, adiciones: [], boxes: [] }])}>＋ Agregar otro producto</Btn>

      <Field label="Observaciones"><Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Hora deseada, dedicatoria…" /></Field>

      <div className="text-sm font-bold mb-2 mt-1">¿De dónde llegó este pedido?</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {ORIGEN_SIMPLE.map((op) => {
          const activo = origenSimple === op.label;
          return (
            <button key={op.label} type="button" onClick={() => {
              setOrigenSimple(op.label);
              setOrigenDetalle(op.detalle);
            }} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: activo ? T.coral : T.vainilla, color: activo ? "#fff" : T.choco2, border: "1px solid " + (activo ? T.coral : T.border) }}>
              {op.label}
            </button>
          );
        })}
      </div>

      <button type="button" onClick={() => setVerAvanzado(!verAvanzado)} className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>
        {verAvanzado ? "▾" : "▸"} Vincular a campaña o publicación (opcional)
      </button>
      {verAvanzado && (
        <div className="grid sm:grid-cols-2 gap-x-4 mb-2">
          <Field label="Campaña">
            <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setCreativeId(""); }} className={inputCls} style={inputStyle}>
              <option value="">Sin campaña</option>
              {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Publicación / creativo">
            <select value={creativeId} onChange={(e) => {
              const id = e.target.value;
              setCreativeId(id);
              const cr = db.creatives.find((x) => x.id === id);
              if (cr && cr.campaignId) setCampaignId(cr.campaignId);
            }} className={inputCls} style={inputStyle}>
              <option value="">Sin publicación</option>
              {db.creatives.filter((c) => !campaignId || c.campaignId === campaignId).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
          </Field>
        </div>
      )}

      <Card className="p-4 mt-2">
        <div className="flex justify-between text-sm py-0.5"><span>Subtotal</span><b>{fmt(subtotal)}</b></div>
        {descuento > 0 && <div className="flex justify-between text-sm py-0.5" style={{ color: "#3F6B42" }}><span>Beneficio aplicado</span><b>−{fmt(descuento)}</b></div>}
        {productoGratis && <div className="flex justify-between text-sm py-0.5" style={{ color: "#3F6B42" }}><span>🎁 {productoGratis.nombre} (gratis)</span><b>$0</b></div>}
        <div className="flex justify-between text-sm py-0.5"><span>Domicilio ({zona.split("·")[0].trim()})</span><b>{fmt(tarifa)}</b></div>
        <div className="flex justify-between display text-lg pt-2 mt-1 border-t" style={{ borderColor: T.border }}><span>Total</span><b style={{ color: T.coral }}>{fmt(total)}</b></div>
      </Card>

      {error && <div className="text-sm font-bold mt-3 p-2.5 rounded-xl" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn disabled={enviando} onClick={guardar}>Crear pedido</Btn>
        <Btn kind="ghost" onClick={onClose}>Cancelar</Btn>
      </div>
    </Modal>
  );
}

/* ================= PRODUCCIÓN ================= */

const LOTE_ESTADOS = ["En preparación","Congelando","Listo","Reservado","Vendido","Imperfecto","Descartado"];

// Componentes + BOM: agrupación del select de bases por tipo de subreceta.
const PREP_TIPOS = [
  ["mousse_frutal", "Mousses frutales"], ["mousse_cremosa", "Mousses cremosas"],
  ["cheesecake", "Cheesecake"], ["ganache", "Ganache"], ["salsa", "Salsas"], ["crocante", "Crocante"],
];

function Produccion({ db, update, user, refrescar }) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  const [nuevo, setNuevo] = useState(false);
  const [pre, setPre] = useState(null); // sugerencia que origina la corrida
  const corridaIdemKeyRef = useRef(null); // 1 por apertura del form: tolera retries de red sin duplicar la corrida
  const s = db.settings;
  const sabores = [...s.saboresFrutales, ...s.saboresCremosos];
  // Producción v2: solo figuras activas CON product_id se pueden producir (contrato de RPC punto 4).
  const figurasProducibles = useMemo(() => (db.figuras || []).filter((f) => f.activo && f.productId), [db.figuras]);
  const productoDeFigura = useMemo(() => {
    const map = {};
    figurasProducibles.forEach((f) => { map[f.nombre] = db.products.find((p) => p.id === f.productId); });
    return map;
  }, [figurasProducibles, db.products]);
  const formInicial = () => ({
    sabor: sabores[0], relleno: s.rellenos[0], // salsa NO: se aplica al despacho, a gusto del cliente
    figuras: Object.fromEntries(figurasProducibles.map((f) => [f.nombre, 0])), // nombreFigura → cantidad
    resp: "", vence: dISO(14), horasCongelacion: s.horasCongelacion || 10, obs: "",
  });
  const [form, setForm] = useState(formInicial);
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviandoBatchId, setEnviandoBatchId] = useState(null); // deshabilita solo la card del lote en vuelo
  const [desmolde, setDesmolde] = useState(null); // {batchId, prod, perfectas, imperfectas, descartadas} — mini-modal de conteos
  const [enviandoDesmolde, setEnviandoDesmolde] = useState(false);

  // ── Componentes + BOM (hito 2): preparar bases/subrecetas ──
  const [prepBase, setPrepBase] = useState(false);
  const prepIdemKeyRef = useRef(null); // 1 por apertura del form (mismo patrón que corridaIdemKeyRef)
  const [prepForm, setPrepForm] = useState({ subrecetaId: "", nominal: 1000, obtenidos: "", obtenidosTocado: false, resp: "", obs: "" });
  const [enviandoPrep, setEnviandoPrep] = useState(false);
  const subrecetasActivas = useMemo(() => (db.subrecetas || []).filter((sr) => sr.activo), [db.subrecetas]);
  const itemDe = useMemo(() => { const m = {}; db.inventory_items.forEach((i) => { m[i.id] = i; }); return m; }, [db.inventory_items]);
  const prepSel = subrecetasActivas.find((sr) => sr.id === prepForm.subrecetaId) || null;
  // Derivado en vivo: consumo escalado (cantidad × nominal/1000) + costo estimado del batch.
  const prepIngredientes = useMemo(() => {
    if (!prepSel) return [];
    const factor = (+prepForm.nominal || 0) / 1000;
    return (db.subreceta_ingredientes || []).filter((r) => r.subrecetaId === prepSel.id).map((r) => {
      const it = itemDe[r.itemId];
      const req = Math.round(r.cantidad * factor * 10000) / 10000;
      // Texto para cocina: kg/L chicos se leen en g/ml (el descuento real sigue en la unidad del insumo)
      const unidad = it ? it.unidad : "";
      const reqTxt = unidad === "kg" && req < 1 ? `${Math.round(req * 10000) / 10} g`
        : unidad === "L" && req < 1 ? `${Math.round(req * 10000) / 10} ml`
        : `${req} ${unidad}`;
      return { itemId: r.itemId, nombre: it ? it.nombre : r.itemId, unidad, req, reqTxt, alcanza: it ? it.stock >= req : false, costo: it ? req * it.costo : 0 };
    });
  }, [prepSel, prepForm.nominal, db.subreceta_ingredientes, itemDe]);
  const prepCosto = prepIngredientes.reduce((a, x) => a + x.costo, 0);
  const prepObtenidosDefault = prepSel ? Math.round((+prepForm.nominal || 0) * (1 - prepSel.mermaPct / 100) * 10) / 10 : 0;
  const prepObtenidos = prepForm.obtenidosTocado && prepForm.obtenidos !== "" ? prepForm.obtenidos : prepObtenidosDefault;
  const ultimaPrepDe = useMemo(() => {
    const m = {};
    (db.subreceta_producciones || []).forEach((sp) => { if (!m[sp.subrecetaId]) m[sp.subrecetaId] = sp; }); // vienen desc por created_at
    return m;
  }, [db.subreceta_producciones]);

  // Resuelve el nombre libre del form al id del staff activo (RPC exige FK real,
  // no nombre suelto). Sin match → null (resp_user_id es opcional server-side).
  function respUserId(nombre) {
    const n = String(nombre || "").trim().toLowerCase();
    if (!n) return null;
    const u = db.users.find((x) => x.activo && String(x.nombre || "").trim().toLowerCase() === n);
    return u ? u.id : null;
  }

  async function refrescarSilencioso(onFail) {
    try {
      await refrescar();
    } catch (e) {
      onFail();
    }
  }

  const sugerencias = db.production_suggestions.filter((s) => s.estado === "Pendiente" && s.area !== "Inventario");

  // Stock operativo: fuente oficial usada por ventas y reservas (products.stock de tipo momo)
  const stockOperativo = useMemo(() =>
    db.products.filter((p) => p.tipo === "momo").map((p) => [p.nombre, p.stock, p.id]),
  [db.products]);

  // v2: con desmolde diferido, "perfectas" vale 0 mientras el lote está en proceso —
  // acá lo que importa es lo PRODUCIDO pendiente/en curso (prod). Se agrupa por
  // producto·sabor·gramaje (sin figura en la key: una corrida puede mezclar figuras
  // que caen en el mismo producto); la figura mostrada se deriva de la composición
  // y si el grupo junta figuras distintas se muestra "varias".
  const enProceso = useMemo(() => {
    const map = {};
    db.production_batches.filter((l) => ["En preparación","Congelando","Reservado"].includes(l.estado)).forEach((l) => {
      const k = `${l.producto} · ${l.sabor} · ${l.gramaje}`;
      const figuraLote = Array.isArray(l.figuras) && l.figuras.length ? l.figuras.map((f) => f.figura).join("+") : l.figura;
      if (!map[k]) map[k] = { label: k, producto: l.producto, sabor: l.sabor, gramaje: l.gramaje, figura: figuraLote, cant: 0 };
      else if (map[k].figura !== figuraLote) map[k].figura = "varias";
      map[k].cant += l.prod;
    });
    return Object.values(map).map((e) => ({ ...e, label: `${e.producto} · ${e.sabor} · ${e.figura || "—"} · ${e.gramaje}` }));
  }, [db.production_batches]);

  // Foco de las cards → filtra la lista "Lotes" de abajo (panel accionable, no solo informativo).
  const [foco, setFoco] = useState(null); // {producto} (stock) | {combo:true, producto,sabor,figura,gramaje} (en proceso)
  const lotesFiltrados = useMemo(() => {
    if (!foco) return db.production_batches;
    // foco.combo ya no incluye figura en la key (ver enProceso): agrupa por producto·sabor·gramaje.
    return db.production_batches.filter((l) => foco.combo
      ? l.producto === foco.producto && l.sabor === foco.sabor && l.gramaje === foco.gramaje
      : l.producto === foco.producto);
  }, [db.production_batches, foco]);
  const focoLabel = foco ? (foco.combo ? `${foco.producto} · ${foco.sabor} · ${foco.figura} · ${foco.gramaje}` : foco.producto) : "";
  function enfocarLotes(next) { setFoco(next); setTimeout(() => { const el = document.getElementById("lotes-produccion"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); }

  // Genera una idempotency_key nueva cada vez que el form se abre; los reintentos
  // dentro de la misma apertura reusan la misma key (útil para timeouts de red).
  function abrirNuevaCorrida() {
    corridaIdemKeyRef.current = "corrida-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
    setForm(formInicial());
    setNuevo(true);
  }

  function abrirDesdeSugerencia(sg) {
    // las sugerencias de Inventario no abren corrida (van a Compras sugeridas en Inventario)
    if (sg.area === "Inventario") {
      setMsg("Esta es una sugerencia de compra de empaque o insumo. Atiéndela en el módulo Inventario, no en Producción.");
      return;
    }
    // v2: la sugerencia solo referencia un producto/cantidad — el operador elige
    // sabor y cantidades por figura en el form; no se mapea producto→figura acá.
    setPre(sg); abrirNuevaCorrida();
  }

  async function registrarCorrida() {
    const figurasElegidas = Object.entries(form.figuras).filter(([, cant]) => +cant > 0).map(([figura, cant]) => ({ figura, cant: +cant }));
    if (!figurasElegidas.length) { setMsg("Elegí al menos una figura con cantidad mayor a 0."); return; }
    const payload = {
      sabor: form.sabor, relleno: form.relleno, figuras: figurasElegidas,
      resp_user_id: respUserId(form.resp), vence: form.vence, horas_congelacion: +form.horasCongelacion || 10,
      obs: form.obs, sugerencia_id: pre ? pre.id : undefined,
      idempotency_key: corridaIdemKeyRef.current,
    };
    setEnviando(true);
    let resultado;
    try {
      resultado = await crearCorrida(payload);
    } catch (e) {
      setMsg("No se pudo registrar la producción: " + e.message);
      setEnviando(false);
      return;
    }
    setEnviando(false);
    setNuevo(false); setPre(null);
    corridaIdemKeyRef.current = null; // fuerza una key nueva en la próxima apertura (abrirNuevaCorrida)
    await refrescarSilencioso(() => setMsg("La producción se registró correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
    const faltantes = resultado && resultado.faltantes;
    if (Array.isArray(faltantes) && faltantes.length) {
      setMsg(`Producción registrada, pero el inventario de insumos no alcanzó para: ${faltantes.map((f) => `${f.insumo} (faltan ${f.faltan} ${f.unidad})`).join(", ")}. Registra la compra en Inventario.`);
    }
  }

  function abrirPrepararBase() {
    prepIdemKeyRef.current = "subprod-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
    setPrepForm({ subrecetaId: subrecetasActivas[0] ? subrecetasActivas[0].id : "", nominal: 1000, obtenidos: "", obtenidosTocado: false, resp: "", obs: "" });
    setPrepBase(true);
  }

  async function registrarPreparacion() {
    if (!prepSel) { setMsg("Elegí la base a preparar."); return; }
    if (!(+prepForm.nominal > 0)) { setMsg("Los gramos preparados deben ser mayores a 0."); return; }
    const payload = {
      subreceta_id: prepSel.id,
      gramos_nominales: +prepForm.nominal,
      gramos_obtenidos: +prepObtenidos,
      resp_user_id: respUserId(prepForm.resp),
      obs: prepForm.obs,
      idempotency_key: prepIdemKeyRef.current,
    };
    setEnviandoPrep(true);
    let resultado;
    try {
      resultado = await producirSubreceta(payload);
    } catch (e) {
      setMsg("No se pudo registrar la preparación: " + e.message);
      setEnviandoPrep(false);
      return;
    }
    setEnviandoPrep(false);
    setPrepBase(false);
    prepIdemKeyRef.current = null; // fuerza key nueva en la próxima apertura
    await refrescarSilencioso(() => setMsg("La base se preparó correctamente, pero no se pudo actualizar la vista. Recargá la página para verla."));
    const faltantesPrep = resultado && resultado.faltantes;
    if (Array.isArray(faltantesPrep) && faltantesPrep.length) {
      setMsg(`Base preparada, pero el inventario no alcanzó para: ${faltantesPrep.map((f) => `${f.insumo} (faltan ${f.faltan} ${f.unidad})`).join(", ")}. Registra la compra en Inventario.`);
    }
  }

  // Desmolde diferido: el paso directo a 'Listo' ahora falla en el server sin conteos.
  function abrirDesmolde(l) {
    const cargados = (l.perfectas || 0) + (l.imperfectas || 0) + (l.descartadas || 0);
    setDesmolde(cargados > 0
      ? { batchId: l.id, prod: l.prod, perfectas: l.perfectas, imperfectas: l.imperfectas, descartadas: l.descartadas }
      : { batchId: l.id, prod: l.prod, perfectas: l.prod, imperfectas: 0, descartadas: 0 });
  }

  // Transición a 'Listo': si perfectas+imperfectas+descartadas ya cuadra con prod
  // (lotes viejos ya cuadrados, o re-transiciones post-reversa), el server acepta
  // set_lote_estado directo. Si no cuadra, recién ahí hace falta el modal de desmolde.
  async function marcarListo(l) {
    const cuadra = (l.perfectas || 0) + (l.imperfectas || 0) + (l.descartadas || 0) === l.prod;
    if (!cuadra) { abrirDesmolde(l); return; }
    setEnviandoBatchId(l.id);
    try {
      await setLoteEstado(l.id, "Listo");
    } catch (e) {
      setMsg("No se pudo cambiar el estado del lote: " + e.message);
      setEnviandoBatchId(null);
      return;
    }
    await refrescarSilencioso(() => setMsg("El estado del lote cambió, pero no se pudo actualizar la vista. Recargá la página para verlo."));
    setEnviandoBatchId(null);
  }

  async function confirmarDesmolde() {
    const { batchId, perfectas, imperfectas, descartadas } = desmolde;
    setEnviandoDesmolde(true);
    try {
      await desmoldarLote(batchId, +perfectas || 0, +imperfectas || 0, +descartadas || 0);
    } catch (e) {
      setMsg("No se pudo registrar el desmolde: " + e.message);
      setEnviandoDesmolde(false);
      return;
    }
    setEnviandoDesmolde(false);
    setDesmolde(null);
    await refrescarSilencioso(() => setMsg("El lote se desmoldó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
  }

  return (
    <div>
      <div className="mb-4 flex gap-2 flex-wrap"><Btn onClick={abrirNuevaCorrida}>＋ Nueva producción</Btn>{subrecetasActivas.length > 0 && <Btn kind="soft" onClick={abrirPrepararBase}>🥣 Preparar base</Btn>}</div>

      {sugerencias.length > 0 && (
        <>
          <SectionTitle>Sugerencias de producción</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            {sugerencias.map((sg) => (
              <Card key={sg.id} className="p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">{sg.cantidad}× {sg.producto}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{sg.motivo}{sg.orderId && ` · pedido ${sg.orderId}`} · {sg.fecha}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge label={sg.estado} />
                  {sg.estado === "Pendiente" && <Btn small kind="soft" onClick={() => abrirDesdeSugerencia(sg)}>Crear lote</Btn>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>✅ Stock operativo disponible</SectionTitle>
      <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Fuente oficial usada por ventas y reservas (products.stock). Un lote suma aquí al pasar a "Listo".</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
        {stockOperativo.map(([nombre, v, id]) => (
          <Card key={id} className="p-3 flex items-center justify-between gap-2" onClick={() => enfocarLotes({ producto: nombre })}>
            <div className="text-xs font-semibold leading-snug">{nombre}</div>
            <div className="display text-xl shrink-0" style={{ color: v <= 2 ? "#A03B2A" : "#3F6B42" }}>{v}</div>
          </Card>
        ))}
        {stockOperativo.length === 0 && <Empty icon="🍮" text="No hay productos con stock operativo." />}
      </div>

      {subrecetasActivas.length > 0 && (
        <>
          <SectionTitle>🥣 Bases preparadas (subrecetas)</SectionTitle>
          <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Mousses, rellenos y salsas producidos en cocina. Las corridas de figuras descuentan de acá; el costo lo pone el WAC al preparar.</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
            {subrecetasActivas.map((sr) => {
              const it = itemDe[sr.itemId];
              const ult = ultimaPrepDe[sr.id];
              return (
                <Card key={sr.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold leading-snug">{sr.nombre}</div>
                    <div className="display text-xl shrink-0" style={{ color: it && it.stock > 0 ? "#3F6B42" : "#A03B2A" }}>{it ? it.stock : "—"}</div>
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>
                    {it ? `${it.unidad} · ${fmt(it.costo)}/${it.unidad}` : "sin item de inventario"}{ult ? ` · última: ${ult.creado || ult.fecha}` : ""}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle>🧊 Lotes en proceso (aún no disponibles)</SectionTitle>
      <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Congelando, en preparación o reservados. No suman al stock operativo hasta pasar a "Listo".</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
        {enProceso.map((e) => (
          <Card key={e.label} className="p-3 flex items-center justify-between gap-2" onClick={() => enfocarLotes({ combo: true, producto: e.producto, sabor: e.sabor, figura: e.figura, gramaje: e.gramaje })}>
            <div className="text-xs font-semibold leading-snug">{e.label}</div>
            <div className="display text-xl shrink-0" style={{ color: "#63518A" }}>{e.cant}</div>
          </Card>
        ))}
        {enProceso.length === 0 && <Empty icon="🧊" text="No hay lotes en proceso." />}
      </div>

      <div id="lotes-produccion" />
      <SectionTitle action={foco ? <button type="button" onClick={() => setFoco(null)} className="text-xs font-bold" style={{ color: T.coral }}>✕ Quitar filtro</button> : undefined}>Lotes</SectionTitle>
      {foco && <div className="text-xs font-bold mb-3 p-2 rounded-lg" style={{ background: T.vainilla, color: T.choco2 }}>Mostrando lotes de: {focoLabel} ({lotesFiltrados.length})</div>}
      <div className="grid lg:grid-cols-2 gap-3">
        {lotesFiltrados.map((l) => {
          const merma = l.prod > 0 ? (l.imperfectas + l.descartadas) / l.prod : 0;
          return (
            <Card key={l.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-bold flex items-center gap-1.5 flex-wrap">
                    <span>{l.id} · {l.producto}</span>
                    {l.corridaId && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.vainilla, color: "#63518A" }}>Corrida {l.corridaId}</span>}
                  </div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{l.fecha} · Resp: {l.resp || "—"} · Vence {l.vence}</div>
                </div>
                <Badge label={l.estado} />
              </div>
              <div className="text-xs mt-2" style={{ color: T.choco2 }}>
                {Array.isArray(l.figuras) && l.figuras.length ? l.figuras.map((f) => `${f.cant}× ${f.figura}`).join(" · ") : l.figura} · {l.sabor} · Relleno {l.relleno}{l.salsa ? ` · Salsa ${l.salsa}` : ""} · {l.gramaje}
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[["Producidas", l.prod, T.choco], ["Perfectas", l.perfectas, "#3F6B42"], ["Imperfectas", l.imperfectas, "#96690F"], ["Descartadas", l.descartadas, "#A03B2A"]].map(([lab, v, col]) => (
                  <div key={lab} className="rounded-xl py-2" style={{ background: T.vainilla }}>
                    <div className="display text-lg" style={{ color: col }}>{v}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                  </div>
                ))}
              </div>
              {(() => {
                const cong = estadoCongelacion(l);
                if (!cong) return null;
                const progreso = Math.max(0, Math.min(100, (cong.horas / cong.objetivo) * 100));
                return (
                  <div className="mt-3 p-2.5 rounded-xl" style={{ background: cong.listo ? "#DDEBD9" : "#DCE7F2" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold" style={{ color: cong.listo ? "#3F6B42" : "#3E5C7E" }}>
                        {cong.listo ? "✅ Congelación cumplida" : "🧊 Congelando"}
                      </span>
                      <span className="text-xs font-bold" style={{ color: cong.listo ? "#3F6B42" : "#3E5C7E" }}>
                        {cong.listo ? `lleva ${fmtHoras(cong.horas)}` : `${fmtHoras(cong.horas)} · listo en ~${fmtHoras(cong.restan)}`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "#ffffff99" }}>
                      <div className="h-full rounded-full" style={{ width: progreso + "%", background: cong.listo ? "#3F6B42" : "#3E5C7E" }} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Objetivo {cong.objetivo} h · inició {l.inicioCongelacion.slice(11, 16)}</span>
                      {cong.listo && (
                        // v2: si los conteos ya cuadran con prod, marcarListo pasa directo a 'Listo';
                        // si no cuadran, abre el modal de desmolde para cargarlos.
                        <button disabled={enviandoBatchId === l.id} onClick={() => marcarListo(l)} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "#3F6B42", color: "#fff", opacity: enviandoBatchId === l.id ? 0.5 : 1 }}>Marcar Listo</button>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="text-xs font-bold" style={{ color: merma > 0.15 ? "#A03B2A" : T.choco2 }}>
                  Merma: {pct(merma)} {merma > 0.15 && "· revisar proceso"}
                </div>
                <div className="flex gap-2">
                  {l.estado === "En preparación" && (
                    <Btn small disabled={enviandoBatchId === l.id} onClick={async () => {
                      setEnviandoBatchId(l.id);
                      try {
                        await empezarCongelamiento(l.id);
                      } catch (e) {
                        setMsg("No se pudo empezar el congelamiento: " + e.message);
                        setEnviandoBatchId(null);
                        return;
                      }
                      await refrescarSilencioso(() => setMsg("El lote empezó a congelar, pero no se pudo actualizar la vista. Recargá la página para verlo."));
                      setEnviandoBatchId(null);
                    }}>❄️ Empezar congelamiento</Btn>
                  )}
                  {l.imperfectas > 0 && !String(l.destino).includes("Insumo") && (
                    <Btn small kind="soft" disabled={enviandoBatchId === l.id} onClick={async () => {
                      setEnviandoBatchId(l.id);
                      try {
                        await convertirImperfectas(l.id);
                      } catch (e) {
                        setMsg("No se pudieron convertir las imperfectas: " + e.message);
                        setEnviandoBatchId(null);
                        return;
                      }
                      let refetchOk = true;
                      await refrescarSilencioso(() => { refetchOk = false; setMsg("Las imperfectas se convirtieron, pero no se pudo actualizar la vista. Recargá la página para verlo."); });
                      setEnviandoBatchId(null);
                      if (refetchOk) setMsg(`Las ${l.imperfectas} piezas imperfectas del lote ${l.id} quedaron como insumo para malteadas, crepas o pruebas internas.`);
                    }}>♻️ Convertir imperfectas</Btn>
                  )}
                  <MiniSelect options={LOTE_ESTADOS} value={l.estado} disabled={enviandoBatchId === l.id} onChange={async (e) => {
                    const nuevoEstado = e.target.value;
                    // v2: pasar a 'Listo' desde acá reusa marcarListo — si los conteos ya
                    // cuadran con prod pasa directo (lotes viejos, re-transiciones post-reversa);
                    // si no cuadran, recién ahí abre el modal de desmolde.
                    if (nuevoEstado === "Listo") { await marcarListo(l); return; }
                    setEnviandoBatchId(l.id);
                    try {
                      await setLoteEstado(l.id, nuevoEstado);
                    } catch (err) {
                      setMsg("No se pudo cambiar el estado del lote: " + err.message);
                      setEnviandoBatchId(null);
                      return;
                    }
                    await refrescarSilencioso(() => setMsg("El estado del lote cambió, pero no se pudo actualizar la vista. Recargá la página para verlo."));
                    setEnviandoBatchId(null);
                  }} />
                </div>
              </div>
              {l.destino !== "—" && <div className="text-xs mt-2 font-semibold" style={{ color: "#63518A" }}>Destino de imperfectas: {l.destino}</div>}
              {l.obs && <div className="text-xs mt-1" style={{ color: T.choco2 }}>📝 {l.obs}</div>}
            </Card>
          );
        })}
        {lotesFiltrados.length === 0 && <div className="text-sm font-semibold p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>No hay lotes para este filtro.</div>}
      </div>

      {nuevo && (() => {
        const totalUnidades = Object.values(form.figuras).reduce((s, c) => s + (+c || 0), 0);
        // Espejo del server: crear_corrida agrupa lotes por (producto, gramaje_g)
        const porLote = {};
        Object.entries(form.figuras).forEach(([figura, cant]) => {
          if (!(+cant > 0)) return;
          const p = productoDeFigura[figura];
          const f = figurasProducibles.find((x) => x.nombre === figura);
          const etiqueta = (p ? p.nombre : figura) + (f?.gramajeG != null ? ` (${f.gramajeG} g)` : "");
          porLote[etiqueta] = (porLote[etiqueta] || 0) + (+cant);
        });
        return (
          <Modal title={pre ? `Producción desde sugerencia ${pre.id}` : "Registrar producción"} onClose={() => { setNuevo(false); setPre(null); }} wide>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Sabor"><Select options={sabores} value={form.sabor} onChange={(e) => setForm({ ...form, sabor: e.target.value })} /></Field>
              <Field label="Relleno"><Select options={s.rellenos} value={form.relleno} onChange={(e) => setForm({ ...form, relleno: e.target.value })} /></Field>
              {/* Salsa NO va acá: se aplica al despacho y la elige el cliente (NuevoPedido) */}
            </div>

            <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>Cantidad por figura</div>
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              {figurasProducibles.map((f) => (
                <div key={f.nombre} className="flex items-center justify-between gap-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>
                  <div className="text-xs font-semibold leading-snug">
                    {f.especie === "perro" ? "🐶" : "🐱"} {f.nombre}
                    <div className="text-[10px] font-normal" style={{ color: T.choco2 }}>{f.gramajeG != null ? `${f.gramajeG} g` : ""}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, (+form.figuras[f.nombre] || 0) - 1) } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>−</button>
                    <input type="number" min="0" step="1" value={form.figuras[f.nombre] ?? 0} onChange={(e) => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, parseInt(e.target.value, 10) || 0) } })} className="w-12 text-center rounded-lg px-1 py-1 text-sm border" style={inputStyle} />
                    <button type="button" onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: (+form.figuras[f.nombre] || 0) + 1 } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>+</button>
                  </div>
                </div>
              ))}
              {figurasProducibles.length === 0 && <Empty icon="🧊" text="No hay figuras activas con producto asignado." />}
            </div>

            <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
              Total: <b>{totalUnidades}</b> unidades{Object.keys(porLote).length > 0 && (" · " + Object.entries(porLote).map(([etiqueta, cant]) => `${cant}× ${etiqueta}`).join(" · "))}
              <div className="mt-0.5 text-[10px]">Solo informativo — el server calcula los lotes reales al registrar.</div>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Responsable"><Select options={db.users.filter((u) => u.activo).map((u) => u.nombre)} value={form.resp} onChange={(e) => setForm({ ...form, resp: e.target.value })} placeholder="Sin responsable" /></Field>
              <Field label="Vencimiento interno"><Input type="date" value={form.vence} onChange={(e) => setForm({ ...form, vence: e.target.value })} /></Field>
              <Field label="Horas de congelación objetivo"><Input type="number" min="1" step="1" value={form.horasCongelacion} onChange={(e) => setForm({ ...form, horasCongelacion: +e.target.value })} /></Field>
            </div>
            <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan los insumos de la receta (por la cantidad producida) y se crea un lote por cada figura elegida. Las piezas perfectas se suman al stock cuando cada lote pase a "Listo" (con desmolde).</div>
            <div className="flex gap-2">
              <Btn disabled={enviando || totalUnidades === 0} onClick={registrarCorrida}>Registrar producción</Btn>
              <Btn kind="ghost" disabled={enviando} onClick={() => { setNuevo(false); setPre(null); }}>Cancelar</Btn>
            </div>
          </Modal>
        );
      })()}

      {prepBase && (
        <Modal title="🥣 Preparar base (subreceta)" onClose={() => setPrepBase(false)} wide>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Base a preparar">
              <select value={prepForm.subrecetaId} onChange={(e) => setPrepForm({ ...prepForm, subrecetaId: e.target.value, obtenidos: "", obtenidosTocado: false })} className="w-full rounded-lg px-2 py-2 text-sm border" style={inputStyle}>
                {PREP_TIPOS.map(([tipo, label]) => {
                  const grupo = subrecetasActivas.filter((sr) => sr.tipo === tipo);
                  return grupo.length ? (
                    <optgroup key={tipo} label={label}>
                      {grupo.map((sr) => <option key={sr.id} value={sr.id}>{sr.nombre}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </Field>
            <Field label="Responsable"><Select options={db.users.filter((u) => u.activo).map((u) => u.nombre)} value={prepForm.resp} onChange={(e) => setPrepForm({ ...prepForm, resp: e.target.value })} placeholder="Sin responsable" /></Field>
            <Field label="Gramos preparados (nominal)"><Input type="number" min="1" step="50" value={prepForm.nominal} onChange={(e) => setPrepForm({ ...prepForm, nominal: Math.max(0, +e.target.value || 0), obtenidos: "", obtenidosTocado: false })} /></Field>
            <Field label={`Gramos obtenidos (sugerido ${prepObtenidosDefault} · merma ${prepSel ? prepSel.mermaPct : 0}%)`}><Input type="number" min="0" value={prepObtenidos} onChange={(e) => setPrepForm({ ...prepForm, obtenidos: e.target.value, obtenidosTocado: true })} /></Field>
          </div>
          <Field label="Observaciones"><Input value={prepForm.obs} onChange={(e) => setPrepForm({ ...prepForm, obs: e.target.value })} /></Field>
          {prepSel && (
            <>
              <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>Ingredientes a consumir ({+prepForm.nominal || 0} g de {prepSel.nombre})</div>
              <div className="mb-3 rounded-xl p-2.5 text-xs" style={{ background: T.vainilla }}>
                {prepIngredientes.map((x) => (
                  <div key={x.itemId} className="flex justify-between gap-2 py-0.5">
                    <span>{x.nombre}</span>
                    <span className="font-semibold" style={{ color: x.alcanza ? T.choco : "#A03B2A" }}>{x.reqTxt}{x.alcanza ? "" : " · ⚠ falta stock"}</span>
                  </div>
                ))}
                {prepIngredientes.length === 0 && <div>Esta base no tiene receta cargada.</div>}
                <div className="flex justify-between gap-2 pt-1.5 mt-1.5 font-bold" style={{ borderTop: "1px solid " + T.border }}>
                  <span>Costo estimado del batch</span><span>{fmt(Math.round(prepCosto))}</span>
                </div>
              </div>
            </>
          )}
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan los ingredientes por los gramos nominales, y los gramos obtenidos suman al stock de la base con su costo real (WAC). Los faltantes no bloquean: quedan avisados.</div>
          <div className="flex gap-2">
            <Btn disabled={enviandoPrep || !prepSel || !(+prepForm.nominal > 0)} onClick={registrarPreparacion}>Registrar preparación</Btn>
            <Btn kind="ghost" disabled={enviandoPrep} onClick={() => setPrepBase(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}

      {desmolde && (() => {
        const suma = (+desmolde.perfectas || 0) + (+desmolde.imperfectas || 0) + (+desmolde.descartadas || 0);
        const cuadra = suma === desmolde.prod;
        return (
          <Modal title={`Desmolde ${desmolde.batchId}`} onClose={() => setDesmolde(null)}>
            <div className="text-sm font-semibold mb-3" style={{ color: T.choco2 }}>Producidas: {desmolde.prod}</div>
            <div className="grid sm:grid-cols-3 gap-x-3">
              <Field label="Perfectas"><Input type="number" min="0" value={desmolde.perfectas} onChange={(e) => setDesmolde({ ...desmolde, perfectas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
              <Field label="Imperfectas"><Input type="number" min="0" value={desmolde.imperfectas} onChange={(e) => setDesmolde({ ...desmolde, imperfectas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
              <Field label="Descartadas"><Input type="number" min="0" value={desmolde.descartadas} onChange={(e) => setDesmolde({ ...desmolde, descartadas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
            </div>
            {!cuadra && <div className="text-xs font-bold mb-3" style={{ color: "#A03B2A" }}>La suma ({suma}) debe ser igual a las producidas ({desmolde.prod}).</div>}
            <div className="flex gap-2">
              <Btn disabled={enviandoDesmolde || !cuadra} onClick={confirmarDesmolde}>Confirmar</Btn>
              <Btn kind="ghost" disabled={enviandoDesmolde} onClick={() => setDesmolde(null)}>Cancelar</Btn>
            </div>
          </Modal>
        );
      })()}

      {msg && <Modal title="Aviso de producción" onClose={() => setMsg("")}><p className="text-sm m-0">{msg}</p><div className="mt-4"><Btn onClick={() => setMsg("")}>Listo</Btn></div></Modal>}
    </div>
  );
}

/* ================= INVENTARIO ================= */

function Inventario({ db, update, user, focus, refrescar }) {
  const [mov, setMov] = useState(false);
  const [nuevoIns, setNuevoIns] = useState(false);
  const [fi, setFi] = useState({ nombre: "", cat: "", unidad: "und", stock: "", min: "", costoTotal: "", proveedor: "", vence: "", ubicacion: "" });
  const [errIns, setErrIns] = useState("");
  const [form, setForm] = useState({ tipo: "Entrada", item: "", cant: "", precio: "", nota: "" });
  const [fCat, setFCat] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [avisoInv, setAvisoInv] = useState(null);
  const [enviandoSugId, setEnviandoSugId] = useState(null);
  const highlightId = focus && focus.itemId;
  const highlightRef = useRef(null);
  useEffect(() => {
    if (highlightRef.current) highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);
  const cats = [...new Set(db.inventory_items.map((i) => i.cat))];
  const lista = db.inventory_items.filter((i) => !fCat || i.cat === fCat);
  const selMovIt = db.inventory_items.find((i) => i.nombre === form.item);

  async function refrescarSilencioso(onFail) {
    try {
      await refrescar();
    } catch (e) {
      onFail();
    }
  }

  function exportar() {
    downloadCSV("inventario",
      ["Nombre","Categoría","Unidad","Stock","Mínimo","Costo unitario","Proveedor","Vence","Ubicación"],
      db.inventory_items.map((i) => [i.nombre, i.cat, i.unidad, i.stock, i.min, i.costo, i.proveedor, i.vence, i.ubicacion]));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn onClick={() => { setFi({ nombre: "", cat: "", unidad: "und", stock: "", min: "", costoTotal: "", proveedor: "", vence: "", ubicacion: "" }); setErrIns(""); setNuevoIns(true); }}>＋ Nuevo insumo</Btn>
        <Btn kind="soft" onClick={() => setMov(true)}>＋ Registrar movimiento</Btn>
        <MiniSelect placeholder="Categoría: todas" options={cats} value={fCat} onChange={(e) => setFCat(e.target.value)} />
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {(() => {
        const compras = db.production_suggestions.filter((s) => s.area === "Inventario" && s.estado === "Pendiente");
        if (compras.length === 0) return null;
        return (
          <div className="mb-4">
            <SectionTitle>🛒 Compras sugeridas</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-2">
              {compras.map((sg) => (
                <Card key={sg.id} className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{sg.cantidad}× {sg.producto}</div>
                    <div className="text-xs" style={{ color: T.choco2 }}>Falta para {sg.orderId ? "pedido " + sg.orderId : "reponer stock"} · {sg.fecha}</div>
                  </div>
                  <Btn small kind="soft" disabled={enviandoSugId === sg.id} onClick={async () => {
                    setEnviandoSugId(sg.id);
                    try {
                      await setSugerenciaEstado(sg.id, "Atendida");
                    } catch (e) {
                      setAvisoInv({ titulo: "No se pudo marcar la sugerencia", texto: e.message });
                      setEnviandoSugId(null);
                      return;
                    }
                    setEnviandoSugId(null);
                    await refrescarSilencioso(() => setAvisoInv({ titulo: "Acción aplicada, vista desactualizada", texto: "La sugerencia se marcó como atendida, pero no se pudo actualizar la vista. Recargá la página para verlo." }));
                  }}>Marcar atendida</Btn>
                </Card>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lista.map((i) => {
          const bajo = i.stock < i.min;
          const vencePronto = i.vence && diasEntre(hoyISO(), i.vence) <= 5;
          const hl = highlightId === i.id;
          return (
            <div key={i.id} ref={hl ? highlightRef : null} className="rounded-2xl" style={hl ? { boxShadow: `0 0 0 3px ${T.coral}` } : undefined}>
            <Card className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold text-sm leading-tight">{i.nombre}</div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: T.vainilla, color: T.choco2 }}>{i.cat}</span>
              </div>
              <div className="flex items-end gap-1 mt-2">
                <span className="display text-2xl" style={{ color: bajo ? "#A03B2A" : T.choco }}>{i.stock}</span>
                <span className="text-xs font-semibold mb-1" style={{ color: T.choco2 }}>{i.unidad} · mín {i.min}</span>
              </div>
              <div className="text-xs mt-1" style={{ color: T.choco2 }}>
                {fmt(i.costo)}/{i.unidad} · {i.proveedor}<br />{i.ubicacion}{i.vence && ` · vence ${i.vence}`}
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {bajo && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Stock bajo</span>}
                {vencePronto && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>Vence pronto</span>}
                {i.costoEstimado && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>≈ costo estimado</span>}
              </div>
            </Card>
            </div>
          );
        })}
      </div>

      <SectionTitle>Reservas de inventario por pedidos</SectionTitle>
      {db.inventory_reservations.length === 0 ? (
        <Card className="p-4">
          <span className="text-sm font-semibold" style={{ color: T.choco2 }}>Sin reservas aún. Al marcar un pedido como Pagado, el stock reservado aparecerá aquí; si el pedido se cancela, la reserva se libera y el stock vuelve solo.</span>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
              {["Reserva","Pedido","Ítem","Cantidad","Fecha","Estado"].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {db.inventory_reservations.slice(0, 20).map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: T.border }}>
                  <td className="px-3 py-2 text-xs font-bold">{r.id}</td>
                  <td className="px-3 py-2 text-xs">{r.orderId}</td>
                  <td className="px-3 py-2 font-semibold">{r.nombre}</td>
                  <td className="px-3 py-2 font-bold">{r.cantidad}</td>
                  <td className="px-3 py-2 text-xs">{r.fecha}</td>
                  <td className="px-3 py-2"><Badge label={r.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <SectionTitle>Movimientos recientes</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
            {["Fecha","Tipo","Ítem","Cantidad","Nota"].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {db.inventory_movements.slice(0, 25).map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: T.border }}>
                <td className="px-3 py-2 text-xs">{m.fecha}</td>
                <td className="px-3 py-2"><Badge label={m.tipo} map={{ "Entrada": { bg: "#DDEBD9", fg: "#3F6B42" }, "Salida": { bg: "#DCE7F2", fg: "#3E5C7E" }, "Ajuste": { bg: "#EBE6E0", fg: "#7A6E63" }, "Merma": { bg: "#F6D4CD", fg: "#A03B2A" }, "Uso en producción": { bg: "#E8E0F2", fg: "#63518A" } }} /></td>
                <td className="px-3 py-2 font-semibold">{m.item}</td>
                <td className="px-3 py-2 font-bold">{m.cant}</td>
                <td className="px-3 py-2 text-xs" style={{ color: T.choco2 }}>{m.nota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {nuevoIns && (
        <Modal title="Nuevo insumo" onClose={() => setNuevoIns(false)} wide>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Nombre del insumo"><Input value={fi.nombre} onChange={(e) => setFi({ ...fi, nombre: e.target.value })} placeholder="Ej: Pulpa de coco 1 kg" /></Field>
            <Field label="Categoría">
              <Input list="cats-insumo" value={fi.cat} onChange={(e) => setFi({ ...fi, cat: e.target.value })} placeholder="Elegir o escribir nueva…" />
              <datalist id="cats-insumo">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Unidad de medida"><Select options={["und","kg","g","L","ml","paquete","docena"]} value={fi.unidad} onChange={(e) => setFi({ ...fi, unidad: e.target.value })} /></Field>
            <Field label="Stock inicial"><Input type="number" min="0" step="0.01" value={fi.stock} onChange={(e) => setFi({ ...fi, stock: e.target.value })} placeholder="Cantidad que entra hoy" /></Field>
            <Field label="Stock mínimo (para alertas)"><Input type="number" min="0" step="0.01" value={fi.min} onChange={(e) => setFi({ ...fi, min: e.target.value })} /></Field>
            <Field label="Costo total de la compra"><Input type="number" min="0" value={fi.costoTotal} onChange={(e) => setFi({ ...fi, costoTotal: e.target.value })} placeholder="Lo que pagaste en total (factura)" /></Field>
            <Field label="Proveedor"><Input value={fi.proveedor} onChange={(e) => setFi({ ...fi, proveedor: e.target.value })} placeholder="Ej: Makro, Galería Alameda" /></Field>
            <Field label="Fecha de vencimiento (opcional)"><Input type="date" value={fi.vence} onChange={(e) => setFi({ ...fi, vence: e.target.value })} /></Field>
            <Field label="Ubicación"><Input value={fi.ubicacion} onChange={(e) => setFi({ ...fi, ubicacion: e.target.value })} placeholder="Nevera 1, Congelador A, Estante seco…" /></Field>
          </div>
          {(+fi.costoTotal > 0 && +fi.stock > 0) && (
            <div className="text-xs font-bold mb-3 p-2.5 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>Costo unitario calculado: {fmt(+fi.costoTotal / +fi.stock)} / {fi.unidad}  ·  (costo total ÷ stock inicial)</div>
          )}
          {(+fi.costoTotal > 0 && !(+fi.stock > 0)) && (
            <div className="text-xs font-semibold mb-3" style={{ color: "#A03B2A" }}>Poné el stock inicial (cantidad comprada) para calcular el costo unitario.</div>
          )}
          {errIns && <div className="text-sm font-bold p-2.5 rounded-xl mb-3" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errIns}</div>}
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>El stock inicial quedará registrado como un movimiento de entrada (fecha de compra: hoy).</div>
          <div className="flex gap-2">
            <Btn disabled={enviando} onClick={async () => {
              if (!fi.nombre.trim()) { setErrIns("Escribe el nombre del insumo."); return; }
              if (db.inventory_items.some((i) => i.nombre.toLowerCase() === fi.nombre.trim().toLowerCase())) { setErrIns("Ya existe un insumo con ese nombre. Usa “Registrar movimiento” para sumarle stock."); return; }
              if (!fi.cat.trim()) { setErrIns("Indica la categoría."); return; }
              setErrIns("");
              setEnviando(true);
              try {
                await crearInsumo({
                  nombre: fi.nombre.trim(), cat: fi.cat.trim(), unidad: fi.unidad,
                  stock: parseFloat(fi.stock) || 0, minimo: parseFloat(fi.min) || 0,
                  costo_total: +fi.costoTotal || 0, proveedor: fi.proveedor.trim(),
                  vence: fi.vence || null, ubicacion: fi.ubicacion.trim(),
                });
              } catch (e) {
                setErrIns(e.message);
                setEnviando(false);
                return;
              }
              setEnviando(false);
              setNuevoIns(false);
              await refrescarSilencioso(() => setAvisoInv({ titulo: "Acción aplicada, vista desactualizada", texto: "El insumo se creó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." }));
            }}>Crear insumo</Btn>
            <Btn kind="ghost" disabled={enviando} onClick={() => setNuevoIns(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}

      {mov && (
        <Modal title="Registrar movimiento de inventario" onClose={() => setMov(false)}>
          <Field label="Tipo"><Select options={["Entrada","Salida","Ajuste","Merma","Uso en producción"]} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} /></Field>
          <Field label="Ítem"><Select placeholder="Elegir ítem…" options={db.inventory_items.map((i) => i.nombre)} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} /></Field>
          {form.tipo === "Entrada" ? (
            <>
              <Field label={"Cantidad comprada" + (selMovIt ? " (en " + selMovIt.unidad + ")" : "")}>
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" step="0.01" value={form.cant} onChange={(e) => setForm({ ...form, cant: e.target.value })} placeholder="Ej: 3" />
                  <span className="text-sm font-bold px-2.5 py-2 rounded-lg whitespace-nowrap" style={{ background: "#EBE6E0", color: T.choco2 }}>{selMovIt ? selMovIt.unidad : "unidad"}</span>
                </div>
              </Field>
              <Field label="Costo total de la compra"><Input type="number" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} placeholder="Lo que pagaste en total (factura)" /></Field>
            </>
          ) : (
            <Field label="Cantidad (ej: +5, -0.5)"><Input value={form.cant} onChange={(e) => setForm({ ...form, cant: e.target.value })} /></Field>
          )}
          <Field label="Nota"><Input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Pedido, lote o motivo" /></Field>
          {form.tipo === "Entrada" && (
            (selMovIt && +form.cant > 0 && form.precio !== "" && +form.precio >= 0) ? (
              <div className="text-xs font-bold mt-1 p-2.5 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
                {(() => {
                  const cant = +form.cant, total = +form.precio || 0;
                  if (!(total > 0)) return "Entrada sin costo: solo suma stock, el costo unitario NO cambia (" + fmt(selMovIt.costo || 0) + "/" + selMovIt.unidad + ").";
                  const cc = total / cant;
                  const sn = (selMovIt.stock || 0) + cant;
                  const wac = sn > 0 ? ((selMovIt.stock || 0) * (selMovIt.costo || 0) + cant * cc) / sn : (selMovIt.costo || 0);
                  return "Costo de esta compra: " + fmt(cc) + "/" + selMovIt.unidad + "  ·  Nuevo costo promedio: " + fmt(wac) + "/" + selMovIt.unidad + " (antes " + fmt(selMovIt.costo || 0) + ")";
                })()}
              </div>
            ) : (
              <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Cargá cantidad comprada y costo total; el costo unitario se recalcula solo (promedio ponderado).</div>
            )
          )}
          <div className="flex gap-2 mt-2">
            <Btn disabled={enviando} onClick={async () => {
              if (!form.item || !form.cant) return;
              if (form.tipo === "Entrada" && (!(+form.cant > 0) || form.precio === "" || +form.precio < 0)) return;
              const it = db.inventory_items.find((i) => i.nombre === form.item);
              if (!it) return;
              setEnviando(true);
              try {
                if (form.tipo === "Entrada") {
                  await entradaInsumo(it.id, +form.cant, +form.precio || 0, form.nota);
                } else {
                  await movimientoInsumo(it.id, form.tipo, parseFloat(form.cant), form.nota);
                }
              } catch (e) {
                setAvisoInv({ titulo: "No se pudo registrar el movimiento", texto: e.message });
                setEnviando(false);
                return;
              }
              setEnviando(false);
              setMov(false); setForm({ tipo: "Entrada", item: "", cant: "", precio: "", nota: "" });
              await refrescarSilencioso(() => setAvisoInv({ titulo: "Acción aplicada, vista desactualizada", texto: "El movimiento se registró correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." }));
            }}>Guardar</Btn>
            <Btn kind="ghost" disabled={enviando} onClick={() => setMov(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}

      {avisoInv && (
        <Modal title={avisoInv.titulo} onClose={() => setAvisoInv(null)}>
          <p className="text-sm m-0">{avisoInv.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAvisoInv(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= PRODUCTOS Y MENÚ ================= */

const CAT_EMOJI = { "Momos Signature": "🐱", "Cajas y Combos": "🎁", "Momos Cuchara": "🥄", "Momos Antojos": "🥞", "Momos Bebidas": "🥤" };

function nuevoProductoVacio() {
  return { nombre: "", cat: "Momos Signature", tipo: "momo", precio: "", precioRappi: "", costo: "", prep: "", frio: true, lejano: false, desc: "", comboSize: "", componentProductIds: [], empaqueItem: "" };
}

function Productos({ db, update, user }) {
  const cats = ["Momos Signature","Cajas y Combos","Momos Cuchara","Momos Antojos","Momos Bebidas"];
  const [recetaDe, setRecetaDe] = useState(null); // productId con receta abierta
  const [linea, setLinea] = useState({ itemId: "", cantidad: "" });
  const [abrirForm, setAbrirForm] = useState(false);
  const [editandoProd, setEditandoProd] = useState(null);
  const [form, setForm] = useState(nuevoProductoVacio());
  const [errProd, setErrProd] = useState("");

  const prodReceta = recetaDe ? db.products.find((p) => p.id === recetaDe) : null;

  function guardarNuevo() {
    const nombre = form.nombre.trim();
    if (!nombre) { setErrProd("Falta el nombre"); return; }
    if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
    if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
    if (form.tipo === "combo") {
      if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
      if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
      if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
    }
    const precioRappi = +form.precioRappi > 0 ? +form.precioRappi : Math.round(+form.precio * 1.25);
    update((d) => {
      const id = nextId(d, "product", "PR", 2);
      const rec = { id, nombre, cat: form.cat, tipo: form.tipo, precio: +form.precio, precioRappi, costo: +form.costo, prep: +form.prep || 10, frio: !!form.frio, lejano: !!form.lejano, activo: true, desc: form.desc || "", atributos: atributosDeTipo(form.tipo) };
      if (form.tipo === "momo") rec.stock = 0;
      if (form.tipo === "combo") { rec.comboSize = +form.comboSize; rec.componentProductIds = [...(form.componentProductIds || [])]; rec.empaqueItem = form.empaqueItem; }
      d.products.push(rec);
      addAudit(d, { user, entidad: "Producto", entidadId: id, accion: "Producto creado", a: rec.nombre });
    });
    setAbrirForm(false);
    setErrProd("");
  }

  function guardarEdicion() {
    const nombre = form.nombre.trim();
    if (!nombre) { setErrProd("Falta el nombre"); return; }
    if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
    if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
    if (form.tipo === "combo") {
      if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
      if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
      if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
    }
    const precioRappi = +form.precioRappi > 0 ? +form.precioRappi : Math.round(+form.precio * 1.25);
    update((d) => {
      const x = d.products.find((y) => y.id === editandoProd.id);
      if (!x) return;
      const dePrecio = x.precio, deCosto = x.costo;
      x.nombre = nombre;
      x.cat = form.cat;
      x.precio = +form.precio;
      x.precioRappi = precioRappi;
      x.costo = +form.costo;
      x.prep = +form.prep || x.prep;
      x.frio = !!form.frio;
      x.lejano = !!form.lejano;
      x.desc = form.desc || "";
      x.atributos = atributosDeTipo(x.tipo); // siempre derivado del tipo (inmutable en edición)
      if (x.tipo === "combo") { x.comboSize = +form.comboSize; x.componentProductIds = [...(form.componentProductIds || [])]; x.empaqueItem = form.empaqueItem; }
      addAudit(d, { user, entidad: "Producto", entidadId: x.id, accion: "Producto editado", de: "$" + dePrecio + "/" + deCosto, a: "$" + x.precio + "/" + x.costo });
    });
    setAbrirForm(false);
  }

  return (
    <div>
      <div className="text-xs font-bold p-2.5 rounded-xl mb-2" style={{ background: T.vainilla, color: T.choco2 }}>
        🧾 Cada producto puede tener una receta (insumos por unidad). Al registrar un lote o al pasar a "En producción" un producto que se prepara al momento, los insumos se descuentan solos del inventario.
      </div>
      <div className="flex justify-end mb-3">
        <Btn small kind="rosa" onClick={() => { setForm(nuevoProductoVacio()); setEditandoProd(null); setErrProd(""); setAbrirForm(true); }}>＋ Nuevo producto</Btn>
      </div>
      {cats.map((cat) => (
        <div key={cat}>
          <SectionTitle>{CAT_EMOJI[cat]} {cat}</SectionTitle>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {db.products.filter((p) => p.cat === cat).map((p) => {
              const margen = (p.precio - p.costo) / p.precio;
              const disp = availability(db, p);
              return (
                <Card key={p.id} className={`p-4 ${!p.activo ? "opacity-60" : ""}`}>
                  <div className="h-20 rounded-xl mb-3 flex items-center justify-center text-4xl" style={{ background: `linear-gradient(135deg, ${T.vainilla}, ${T.rosa})` }} aria-hidden="true">{CAT_EMOJI[cat]}</div>
                  <div className="font-bold text-sm">{p.nombre}</div>
                  <div className="text-xs mt-1 leading-snug" style={{ color: T.choco2 }}>{p.desc}</div>
                  <div className="flex justify-between items-end mt-3">
                    <div>
                      <div className="display text-lg" style={{ color: T.coral }}>{fmt(p.precio)}</div>
                      <div className="text-[11px] font-semibold" style={{ color: T.choco2 }}>Rappi {fmt(p.precioRappi)} · costo {fmt(p.costo)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold" style={{ color: margen > 0.6 ? "#3F6B42" : "#96690F" }}>margen {pct(margen)}</div>
                      <div className="text-[11px] font-bold" style={{ color: isFinite(disp) && disp <= 2 ? "#A03B2A" : T.choco2 }}>
                        {isFinite(disp) ? `${disp} disponibles` : "bajo pedido"}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {p.tipo === "combo" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#E8E0F2", color: "#63518A" }}>Disponibilidad calculada</span>}
                    {p.frio && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>❄️ Requiere frío</span>}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: p.lejano ? "#DDEBD9" : "#FBE8C8", color: p.lejano ? "#3F6B42" : "#96690F" }}>
                      {p.lejano ? "Apto domicilio lejano" : "Solo domicilio cercano"}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2 flex-wrap items-center">
                    <Btn small kind="rosa" onClick={() => { setLinea({ itemId: "", cantidad: "" }); setRecetaDe(p.id); }}>
                      🧾 Receta {recipeLines(db, p.id).length > 0 && `(${recipeLines(db, p.id).length})`}
                    </Btn>
                    <Btn small kind="ghost" onClick={() => { setEditandoProd(p); setForm({ nombre: p.nombre, cat: p.cat, tipo: p.tipo, precio: p.precio, precioRappi: p.precioRappi, costo: p.costo, prep: p.prep, frio: !!p.frio, lejano: !!p.lejano, desc: p.desc || "", comboSize: p.comboSize || "", componentProductIds: [...(p.componentProductIds || [])], empaqueItem: p.empaqueItem || "" }); setErrProd(""); setAbrirForm(true); }}>✏️ Editar</Btn>
                    <Btn small kind={p.activo ? "ghost" : "soft"} onClick={() => update((d) => {
                      const x = d.products.find((y) => y.id === p.id);
                      x.activo = !x.activo;
                      addAudit(d, { user, entidad: "Producto", entidadId: p.id, accion: x.activo ? "Activado en menú" : "Desactivado del menú", a: p.nombre });
                    })}>
                      {p.activo ? "Desactivar del menú" : "Activar en el menú"}
                    </Btn>
                  </div>
                  {recipeLines(db, p.id).length > 0 && (
                    <div className="text-[11px] font-bold mt-2" style={{ color: T.choco2 }}>
                      Costo por receta: <span style={{ color: Math.abs(recipeCost(db, p.id) - p.costo) > p.costo * 0.15 ? "#96690F" : "#3F6B42" }}>{fmt(recipeCost(db, p.id))}</span> · costo registrado: {fmt(p.costo)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}

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
                      style={{ background: on ? T.coral : "#fff", color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
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
            <Btn kind="rosa" onClick={editandoProd ? guardarEdicion : guardarNuevo}>Guardar</Btn>
          </div>
        </Modal>
      )}

      {prodReceta && (
        <Modal title={`Receta · ${prodReceta.nombre}`} onClose={() => setRecetaDe(null)} wide>
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
            Cantidades por <b>1 unidad</b> de producto. {prodReceta.tipo === "momo" ? "Se descuentan al registrar un lote de producción." : prodReceta.tipo === "pedido" ? "Se descuentan cuando el pedido pasa a \u201cEn producción\u201d." : "Los combos descuentan momos y cajas automáticamente; agrega aquí solo extras (lazo, tarjeta…)."}
          </div>

          {recipeLines(db, prodReceta.id).length === 0 && (
            <div className="text-sm font-semibold mb-3 p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
              Este producto aún no tiene receta. Agrega el primer insumo abajo.
            </div>
          )}

          {recipeLines(db, prodReceta.id).map((l) => {
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
                    onChange={(e) => update((d) => { const x = d.recipes.find((y) => y.id === l.id); x.cantidad = parseFloat(e.target.value) || 0; })}
                    className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} aria-label={`Cantidad de ${it.nombre}`} />
                  <span className="text-xs font-bold" style={{ color: T.choco2 }}>{it.unidad}</span>
                  <span className="text-xs font-bold w-16 text-right">{fmt(it.costo * l.cantidad)}</span>
                  <button aria-label={`Quitar ${it.nombre}`} onClick={() => update((d) => {
                    d.recipes = d.recipes.filter((y) => y.id !== l.id);
                    addAudit(d, { user, entidad: "Receta", entidadId: prodReceta.id, accion: "Insumo quitado de receta", a: it.nombre });
                  })} className="w-7 h-7 rounded-full font-bold text-xs" style={{ background: "#F6D4CD", color: "#A03B2A" }}>✕</button>
                </div>
              </Card>
            );
          })}

          <Card className="p-3 mb-3">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>AGREGAR INSUMO A LA RECETA</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={linea.itemId} onChange={(e) => setLinea({ ...linea, itemId: e.target.value })} className="flex-1 min-w-[160px] rounded-xl px-2 py-2 text-sm border font-semibold" style={inputStyle}>
                <option value="">Elegir insumo…</option>
                {db.inventory_items.filter((i) => !recipeLines(db, prodReceta.id).some((l) => l.itemId === i.id)).map((i) => (
                  <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
                ))}
              </select>
              <input type="number" min="0" step="0.01" value={linea.cantidad} onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })}
                placeholder="Cant." className="w-24 rounded-xl px-2 py-2 text-sm border text-right font-bold" style={inputStyle} aria-label="Cantidad por unidad" />
              <Btn small kind="rosa" onClick={() => {
                if (!linea.itemId || !parseFloat(linea.cantidad)) return;
                update((d) => {
                  d.recipes.push({ id: nextId(d, "recipe", "RC"), productId: prodReceta.id, itemId: linea.itemId, cantidad: parseFloat(linea.cantidad) });
                  const it = d.inventory_items.find((i) => i.id === linea.itemId);
                  addAudit(d, { user, entidad: "Receta", entidadId: prodReceta.id, accion: "Insumo agregado a receta", a: (it ? it.nombre : linea.itemId) + " × " + linea.cantidad });
                });
                setLinea({ itemId: "", cantidad: "" });
              }}>＋ Agregar</Btn>
            </div>
            <div className="text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>¿No está el insumo? Créalo primero en Inventario → ＋ Nuevo insumo.</div>
          </Card>

          <Card className="p-4">
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold">Costo estimado por receta (1 unidad)</span>
              <b className="display text-lg" style={{ color: T.coral }}>{fmt(recipeCost(db, prodReceta.id))}</b>
            </div>
            <div className="flex justify-between items-center text-xs mt-1" style={{ color: T.choco2 }}>
              <span>Costo registrado del producto</span><b>{fmt(prodReceta.costo)}</b>
            </div>
            {recipeLines(db, prodReceta.id).length > 0 && Math.round(recipeCost(db, prodReceta.id)) !== prodReceta.costo && (
              <div className="mt-3">
                <Btn small kind="soft" onClick={() => update((d) => {
                  const x = d.products.find((y) => y.id === prodReceta.id);
                  const nuevo = Math.round(recipeCost(d, x.id));
                  addAudit(d, { user, entidad: "Producto", entidadId: x.id, accion: "Costo actualizado desde receta", de: fmt(x.costo), a: fmt(nuevo) });
                  x.costo = nuevo;
                })}>Actualizar costo del producto con la receta</Btn>
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
  const [soloActivos, setSoloActivos] = useState(false); // click en "Domicilios activos" → filtra la lista

  const subsidio = db.deliveries.reduce((sm, d) => sm + Math.max(0, d.costoReal - d.cobrado), 0);
  const excedente = db.deliveries.reduce((sm, d) => sm + Math.max(0, d.cobrado - d.costoReal), 0);
  const pendientes = db.orders.filter((o) => ["Empacado","Listo para despacho"].includes(o.estado) && !db.deliveries.some((d) => d.orderId === o.id));

  function exportar() {
    downloadCSV("domicilios",
      ["ID","Pedido","Proveedor","Zona","Cobrado","Costo real","Diferencia","Solicitud","Salida","Entrega","Código","Estado"],
      db.deliveries.map((d) => [d.id, d.orderId, d.proveedor, d.zona, d.cobrado, d.costoReal, d.cobrado - d.costoReal, d.hSolicitud, d.hSalida, d.hEntrega, d.codigo, d.estado]));
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="🛵" label="Domicilios activos" value={db.deliveries.filter((d) => !["Entregado","Cancelado"].includes(d.estado)).length} onClick={() => { setSoloActivos((v) => !v); setTimeout(() => { const el = document.getElementById("lista-domicilios"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); }} />
        <Stat icon="🧾" label="Subsidio acumulado" value={fmt(subsidio)} sub="cobramos menos que el costo" tone="#A03B2A" />
        <Stat icon="💰" label="Excedente cobrado" value={fmt(excedente)} sub="cobramos más que el costo" tone="#3F6B42" />
        <Stat icon="📦" label="Listos sin domicilio" value={pendientes.length} sub="pedidos por solicitar" tone={pendientes.length ? "#96690F" : undefined} />
      </div>

      <div className="mb-4 flex gap-2">
        <Btn onClick={() => setNuevo(true)}>＋ Solicitar domicilio</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {pendientes.length > 0 && (
        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>
          ⏰ Pedidos listos esperando domicilio: {pendientes.map((o) => o.id).join(", ")}
        </div>
      )}

      <div id="lista-domicilios" />
      {soloActivos && <div className="text-xs font-bold mb-3 p-2 rounded-lg flex items-center justify-between" style={{ background: T.vainilla, color: T.choco2 }}><span>Mostrando solo domicilios activos</span><button type="button" onClick={() => setSoloActivos(false)} className="font-bold" style={{ color: T.coral }}>✕ ver todos</button></div>}
      <div className="grid lg:grid-cols-2 gap-3">
        {(soloActivos ? db.deliveries.filter((d) => !["Entregado","Cancelado"].includes(d.estado)) : db.deliveries).map((d) => {
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
                <MiniSelect options={DOM_ESTADOS} value={d.estado} disabled={enviando} onChange={async (e) => {
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
      </div>

      {nuevo && (
        <Modal title="Solicitar domicilio" onClose={() => setNuevo(false)}>
          <Field label="Pedido">
            <Select placeholder="Elegir pedido…" options={db.orders.filter((o) => !["Entregado","Cancelado"].includes(o.estado)).filter((o) => o.canal !== "Rappi").map((o) => o.id)} value={form.orderId} onChange={(e) => {
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
      <div className="grid lg:grid-cols-2 gap-3">
        {db.claims.map((r) => {
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
                <MiniSelect options={["Abierto","En revisión","Aprobado","Rechazado","Compensado","Cerrado"]} value={r.estado} disabled={enviando} onChange={async (e) => {
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
                <Btn small kind="ghost" onClick={() => setSel({ ...r })}>Editar caso</Btn>
              </div>
            </Card>
            </div>
          );
        })}
        {db.claims.length === 0 && <Empty icon="🎉" text="Sin reclamos registrados." />}
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
  const [form, setForm] = useState(null); // null = cerrado; objeto = alta/edición
  const [err, setErr] = useState("");
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
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
      <div className="flex flex-col gap-1.5 mb-4">
        {alertas.map(([t, fg, bg], i) => <div key={i} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: bg, color: fg }}>{t}</div>)}
        {alertas.length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin alertas activas.</div>}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o barrio…"
        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none mb-3" style={inputStyle} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lista.map((c) => (
          <Card key={c.id} className="p-4" onClick={() => setSel(c)}>
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
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              {[["Pedidos", c.pedidos], ["Total", fmt(c.total)], ["Ticket", fmt(Math.round(c.total / Math.max(c.pedidos, 1)))]].map(([l, v]) => (
                <div key={l} className="rounded-xl py-1.5" style={{ background: T.vainilla }}>
                  <div className="text-xs font-bold truncate px-1">{v}</div>
                  <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="text-xs mt-2 truncate" style={{ color: T.choco2 }}>💗 {c.favoritos || "Sin favoritos aún"}</div>
          </Card>
        ))}
      </div>

      {sel && (
        <Modal title={sel.nombre} onClose={() => setSel(null)}>
          <div className="flex gap-2 mb-3 flex-wrap"><Badge label={sel.estado} /><Badge label={sel.canal} map={CANAL_STYLE} /></div>
          <div className="text-sm space-y-1.5">
            <div>📞 {sel.telefono} {sel.instagram && <span>· {sel.instagram}</span>}</div>
            <div>📍 {sel.direccion} ({sel.barrio})</div>
            <div>🗓️ {sel.primera ? <>Primera compra {sel.primera} · última {sel.ultima}</> : <span style={{ color: T.choco2 }}>Sin compras aún (lead cargado a mano)</span>}</div>
            {sel.cumple && <div>🎂 Cumpleaños: {sel.cumple}</div>}
            <div>💗 Favoritos: {sel.favoritos || "—"}</div>
            <div>💰 Total: <b>{fmt(sel.total)}</b> en {sel.pedidos} pedidos (ticket {fmt(Math.round(sel.total / Math.max(sel.pedidos, 1)))})</div>
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
          {sel.notas && <div className="text-xs mt-3 p-2.5 rounded-xl" style={{ background: T.vainilla }}>📝 {sel.notas}</div>}
          <div className="mt-4 flex justify-end">
            <Btn small kind="rosa" onClick={() => abrirEdicion(sel)}>✏️ Editar cliente</Btn>
          </div>
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

function Beneficios({ db, update, user }) {
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ customerId: "", tipoBeneficio: "descuento_porcentaje", valor: 20, productoGratisId: "PR11", condicion: "Historia en Instagram", minimo: 30000, vence: dISO(15), obs: "" });

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
                <div className="mt-3"><Btn small kind="soft" onClick={() => update((d) => {
                  const x = d.benefits.find((y) => y.id === b.id);
                  x.estado = "Usado"; x.pedidoUso = x.pedidoUso || "manual";
                  addAudit(d, { user, entidad: "Beneficio", entidadId: b.id, accion: "Marcado como usado manualmente" });
                })}>Marcar como usado</Btn></div>
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
          <div className="flex gap-2 mt-2">
            <Btn onClick={() => {
              if (!form.customerId) return;
              update((d) => {
                const id = nextId(d, "benefit", "B-");
                const beneficio = labelBeneficio(form, d);
                d.benefits.unshift({ id, ...form, beneficio, activacion: hoyISO(), estado: "Activo", pedidoUso: "" });
                addAudit(d, { user, entidad: "Beneficio", entidadId: id, accion: "Beneficio activado", a: beneficio });
              });
              setNuevo(false);
            }}>Activar</Btn>
            <Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= FINANZAS ================= */

function Finanzas({ db, update, user }) {
  const [desde, setDesde] = useState(dISO(-30));
  const [hasta, setHasta] = useState(hoyISO());

  const enRango = db.orders.filter((o) => o.fecha >= desde && o.fecha <= hasta);
  const vendidos = enRango.filter(esPedidoCobrado);

  const ventasProductos = vendidos.reduce((s, o) => s + orderSubtotal(db, o) - (o.descuento || 0), 0);
  const cogs = vendidos.reduce((s, o) => s + orderCOGS(db, o), 0);
  const margenBruto = ventasProductos - cogs;
  const domCobrado = vendidos.reduce((s, o) => s + (o.domCobrado || 0), 0);
  const domCosto = vendidos.reduce((s, o) => s + (o.domCosto || 0), 0);
  const subsidio = vendidos.reduce((s, o) => s + Math.max(0, (o.domCosto || 0) - (o.domCobrado || 0)), 0);
  const costoReclamos = db.claims.filter((r) => {
    if (!["Aprobado","Compensado"].includes(r.estado)) return false;
    const o = db.orders.find((x) => x.id === r.orderId);
    const f = r.fecha || (o ? o.fecha : null);
    return f && f >= desde && f <= hasta;
  }).reduce((s, r) => s + (r.costo || 0), 0);
  const pautaMensual = db.settings.pautaMensual || 0;
  const diasRango = Math.max(1, diasEntre(desde, hasta) + 1);
  const pauta = Math.round(pautaMensual / 30 * diasRango);
  const utilidad = margenBruto + (domCobrado - domCosto) - pauta - costoReclamos;

  function exportar() {
    downloadCSV("finanzas",
      ["Concepto","Valor"],
      [["Rango", desde + " a " + hasta],
       ["Ventas de producto (con descuentos)", ventasProductos],
       ["Costo estimado de producto (COGS)", cogs],
       ["Margen bruto", margenBruto],
       ["Domicilio cobrado", domCobrado],
       ["Costo real de domicilios", domCosto],
       ["Subsidio de domicilios", subsidio],
       ["Costo de reclamos compensados", costoReclamos],
       ["Pauta prorrateada del rango (" + diasRango + " días)", pauta],
       ["Utilidad estimada", utilidad]]);
  }

  const linea = (label, valor, opts = {}) => (
    <div className="flex justify-between items-center text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}>
      <span className={opts.strong ? "font-bold" : "font-semibold"} style={{ color: opts.muted ? T.choco2 : T.choco }}>{label}</span>
      <b style={{ color: opts.color || T.choco }}>{opts.raw ? valor : fmt(valor)}</b>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-bold" style={{ color: T.choco2 }}>Rango:</span>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="💵" label="Ventas de producto" value={fmt(ventasProductos)} sub={vendidos.length + " pedidos cobrados"} tone={T.coral} />
        <Stat icon="🧾" label="Costo de producto" value={fmt(cogs)} sub="estimado por receta" />
        <Stat icon="📈" label="Margen bruto" value={fmt(margenBruto)} sub={ventasProductos ? pct(margenBruto / ventasProductos) + " de las ventas" : "—"} tone="#3F6B42" />
        <Stat icon="✨" label="Utilidad estimada" value={fmt(utilidad)} sub="tras domicilios, pauta y reclamos" tone={utilidad >= 0 ? "#3F6B42" : "#A03B2A"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>ESTADO DE RESULTADOS SIMPLE</div>
          {linea("Ventas de producto (con descuentos aplicados)", ventasProductos)}
          {linea("− Costo estimado de producto", cogs, { color: "#A03B2A" })}
          {linea("= Margen bruto", margenBruto, { strong: true, color: "#3F6B42" })}
          {linea("+ Domicilio cobrado a clientes", domCobrado)}
          {linea("− Costo real de domicilios", domCosto, { color: "#A03B2A" })}
          {linea("− Costo de reclamos compensados", costoReclamos, { color: "#A03B2A" })}
          {linea(`− Pauta prorrateada del rango (${diasRango} días)`, pauta, { color: "#A03B2A" })}
          {linea("= Utilidad estimada del periodo", utilidad, { strong: true, color: utilidad >= 0 ? "#3F6B42" : "#A03B2A" })}
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>DOMICILIOS EN EL RANGO</div>
            {linea("Cobrado a clientes", domCobrado)}
            {linea("Costo real pagado", domCosto)}
            {linea("Subsidio (pedidos donde costó más de lo cobrado)", subsidio, { color: "#A03B2A" })}
          </Card>
          <Card className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PAUTA PUBLICITARIA (asignación manual mensual)</div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
              <input type="number" value={pautaMensual} onChange={(e) => update((d) => {
                d.settings.pautaMensual = +e.target.value || 0;
                addAudit(d, { user, entidad: "Configuración", entidadId: "pauta", accion: "Pauta actualizada", a: fmt(+e.target.value || 0) });
              })} className="flex-1 rounded-xl px-3 py-2 text-sm border font-bold" style={inputStyle} />
            </div>
            <div className="text-xs mt-2" style={{ color: T.choco2 }}>Valor mensual. En la utilidad se descuenta solo la parte proporcional a los {diasRango} días del rango ({fmt(pauta)}). Registra aquí lo invertido en Meta Ads, influencers o volantes.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

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
        (db.creative_results || []).forEach((r) => {
          const cre = db.creatives.find((x) => x.id === r.creativeId);
          const canal = cre ? cre.canal : "Otro";
          if (!canalConv[canal]) canalConv[canal] = { msg: 0, ped: 0 };
          canalConv[canal].msg += r.mensajesWhatsApp; canalConv[canal].ped += r.pedidos;
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

function Configuracion({ db, update, user, resetear, restaurarBackup }) {
  const [nuevoItem, setNuevoItem] = useState({});
  const [confirmar, setConfirmar] = useState(false);
  const [nuevoUser, setNuevoUser] = useState({ nombre: "", email: "", rol: "Cocina" });
  const [backupMsg, setBackupMsg] = useState("");
  const [nuevaFig, setNuevaFig] = useState({ nombre: "", especie: "gato", gramaje: "150 g" });
  const [nuevoTop, setNuevoTop] = useState({ nombre: "", precio: "", insumoId: "" });
  const s = db.settings;
  const listas = [
    ["saboresFrutales", "Sabores frutales"], ["saboresCremosos", "Sabores cremosos"],
    ["rellenos", "Rellenos"], ["salsas", "Salsas"],
    ["pagos", "Métodos de pago"], ["proveedores", "Proveedores de domicilio"],
  ];

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
          Estructura lista para login real con backend. Mientras tanto, el selector del encabezado simula la sesión de cada rol.
        </div>
        {db.users.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 py-2 border-b" style={{ borderColor: T.border, opacity: u.activo ? 1 : 0.5 }}>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">{u.nombre} <span className="text-xs font-semibold" style={{ color: T.choco2 }}>· {u.email}</span></div>
              <div className="text-xs" style={{ color: T.choco2 }}>{u.rol} → {PERMISOS_POR_ROL[u.rol]}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge label={u.activo ? "Activo" : "Inactivo"} />
              <Btn small kind="ghost" onClick={() => update((d) => {
                const x = d.users.find((y) => y.id === u.id);
                x.activo = !x.activo;
                addAudit(d, { user, entidad: "Usuario", entidadId: u.id, accion: x.activo ? "Usuario activado" : "Usuario desactivado", a: u.nombre });
              })}>{u.activo ? "Desactivar" : "Activar"}</Btn>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-3 items-center">
          <input value={nuevoUser.nombre} onChange={(e) => setNuevoUser({ ...nuevoUser, nombre: e.target.value })} placeholder="Nombre"
            className="flex-1 min-w-[110px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <input value={nuevoUser.email} onChange={(e) => setNuevoUser({ ...nuevoUser, email: e.target.value })} placeholder="Correo"
            className="flex-1 min-w-[130px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
          <MiniSelect options={["Administrador","Cocina","Empaque","Logística","Marketing/CRM"]} value={nuevoUser.rol} onChange={(e) => setNuevoUser({ ...nuevoUser, rol: e.target.value })} />
          <Btn small kind="rosa" onClick={() => {
            if (!nuevoUser.nombre.trim()) return;
            update((d) => {
              const id = nextId(d, "user", "U", 2);
              d.users.push({ id, nombre: nuevoUser.nombre.trim(), email: nuevoUser.email.trim(), rol: nuevoUser.rol, activo: true });
              addAudit(d, { user, entidad: "Usuario", entidadId: id, accion: "Usuario creado", a: nuevoUser.nombre + " (" + nuevoUser.rol + ")" });
            });
            setNuevoUser({ nombre: "", email: "", rol: "Cocina" });
          }}>＋ Agregar</Btn>
        </div>
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
                db.evidences.map((e) => [e.id, e.orderId, e.tipo, e.fecha, e.hora, e.user, e.url ? "Sí" : "No"])],
              ["reclamos", ["Id","Fecha","Pedido","ClienteId","Tipo","H entrega","H reclamo","Entregado en","Reclamo en","Decisión","Solución","Costo","Estado","Descripción","Evidencia"],
                db.claims.map((r) => [r.id, r.fecha || "", r.orderId, r.customerId, r.tipo, r.hEntrega, r.hReclamo, r.entregadoEn || "", r.reclamoEn || "", r.decision, r.solucion, r.costo, r.estado, r.desc || "", r.evidencia || ""])],
              ["beneficios", ["Id","ClienteId","Beneficio","Tipo","Valor","Producto gratis","Mínimo","Activación","Vence","Estado","Pedido"],
                db.benefits.map((b) => [b.id, b.customerId, b.beneficio, b.tipoBeneficio, b.valor, b.productoGratisId, b.minimo, b.activacion, b.vence, b.estado, b.pedidoUso])],
              ["produccion", ["Lote","Fecha","Producto","Figura","Sabor","Gramaje","Producidas","Perfectas","Imperfectas","Descartadas","Destino","Resp","Vence","Estado","Horas congelación","Inicio congelación","Stock contabilizado"],
                db.production_batches.map((l) => [l.id, l.fecha, l.producto, l.figura, l.sabor, l.gramaje, l.prod, l.perfectas, l.imperfectas, l.descartadas, l.destino, l.resp, l.vence, l.estado, l.horasCongelacion || "", l.inicioCongelacion || "", l.stockContabilizado ? "Sí" : "No"])],
              ["reservas", ["Id","Pedido","Tipo","Referencia","Cantidad","Fecha","Estado"],
                db.inventory_reservations.map((r) => [r.id, r.orderId, r.tipo, r.nombre, r.cantidad, r.fecha, r.estado])],
              ["campanas", ["Id","Nombre","Canal","Objetivo","Producto","Oferta","Inicio","Fin","Presupuesto","Gasto real","Estado","Responsable"],
                db.campaigns.map((c) => [c.id, c.nombre, c.canal, c.objetivo, c.productoFoco, c.oferta, c.fechaInicio, c.fechaFin, c.presupuesto, c.gastoReal, c.estado, c.responsable])],
              ["creativos", ["Id","Campaña","Título","Canal","Formato","Producto","Hook","Estado","Responsable","Entrega"],
                db.creatives.map((c) => [c.id, c.campaignId, c.titulo, c.canal, c.formato, c.productoFoco, c.hook, c.estado, c.responsable, c.fechaEntrega])],
              ["calendario", ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado"],
                db.content_calendar.map((p) => [p.id, p.fecha, p.hora, p.canal, p.campaignId, p.creativeId, p.titulo, p.estado])],
              ["resultados-creativos", ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","Mensajes WA","Pedidos","Ventas","Gasto"],
                db.creative_results.map((r) => [r.id, r.creativeId, r.campaignId, r.fecha, r.impresiones, r.alcance, r.clicks, r.mensajesWhatsApp, r.pedidos, r.ventas, r.gasto])],
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
          Las evidencias fotográficas se guardan hoy en el almacenamiento local de la app, con espacio limitado (~5 MB en total, unas 30–50 fotos comprimidas).
          Tamaño actual de los datos: <b>{(JSON.stringify(db).length / 1024 / 1024).toFixed(2)} MB</b>.
          Para operación real, migra las evidencias a <b>Supabase Storage</b>: la app ya tiene la función repo.uploadEvidence lista para ese cambio.
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

function Marketing({ db, update, user }) {
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

  function guardar() {
    if (!form.nombre.trim()) return;
    update((d) => {
      const id = nextId(d, "campaign", "CMP-", 2);
      d.campaigns.unshift({ id, ...form });
      addAudit(d, { user, entidad: "Campaña", entidadId: id, accion: "Campaña creada", a: form.nombre });
    });
    setNueva(false);
    setForm({ nombre: "", canal: "Instagram", objetivo: "Ventas", productoFoco: "", oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(15), presupuesto: 0, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "" });
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
          <div className="flex gap-2 mt-2"><Btn onClick={guardar}>Crear campaña</Btn><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
        </Modal>
      )}

      {sel && (
        <Modal title={sel.nombre} onClose={() => setSel(null)} wide>
          <div className="flex flex-wrap gap-2 mb-3"><Badge label={sel.estado} /><Badge label={sel.canal} map={MK_CANAL_STYLE} /><span className="text-xs font-semibold" style={{ color: T.choco2 }}>{sel.objetivo}</span></div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Estado">
              <select value={sel.estado} onChange={(e) => setSel({ ...sel, estado: e.target.value })} className={inputCls} style={inputStyle}>{CAMP_ESTADOS.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Gasto real"><Input type="number" value={sel.gastoReal} onChange={(e) => setSel({ ...sel, gastoReal: +e.target.value })} /></Field>
            <Field label="Presupuesto"><Input type="number" value={sel.presupuesto} onChange={(e) => setSel({ ...sel, presupuesto: +e.target.value })} /></Field>
            <Field label="Oferta"><Input value={sel.oferta} onChange={(e) => setSel({ ...sel, oferta: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input value={sel.notas} onChange={(e) => setSel({ ...sel, notas: e.target.value })} /></Field>
          <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
            Creativos de esta campaña: {db.creatives.filter((cr) => cr.campaignId === sel.id).length} · Pedidos atribuidos: {ordersDeCampaign(db, sel.id).length}
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => { update((d) => { const i = d.campaigns.findIndex((x) => x.id === sel.id); const prev = d.campaigns[i].estado; d.campaigns[i] = sel; addAudit(d, { user, entidad: "Campaña", entidadId: sel.id, accion: prev !== sel.estado ? "Cambio de estado" : "Campaña editada", de: prev !== sel.estado ? prev : "", a: prev !== sel.estado ? sel.estado : "" }); }); setSel(null); }}>Guardar</Btn>
            <Btn kind="ghost" onClick={() => setSel(null)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= CREATIVOS 🎨 ================= */

function Creativos({ db, update, user }) {
  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState(null);
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

  function guardar() {
    if (!form.titulo.trim()) return;
    update((d) => {
      const id = nextId(d, "creative", "CRE-", 2);
      d.creatives.unshift({ id, ...form });
      addAudit(d, { user, entidad: "Creativo", entidadId: id, accion: "Creativo creado", a: form.titulo });
    });
    setNuevo(false); setForm(vacio);
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
            <Card key={c.id} className="p-4" onClick={() => setSel({ ...c })}>
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
        <Modal title={sel ? sel.titulo : "Nuevo creativo"} onClose={() => { setNuevo(false); setSel(null); }} wide>
          {(() => { const f = sel || form; const setF = sel ? setSel : setForm;
            return (
              <>
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
                    <Btn onClick={() => { update((d) => { const i = d.creatives.findIndex((x) => x.id === sel.id); const prev = d.creatives[i].estado; d.creatives[i] = sel; addAudit(d, { user, entidad: "Creativo", entidadId: sel.id, accion: prev !== sel.estado ? "Cambio de estado" : "Creativo editado", de: prev !== sel.estado ? prev : "", a: prev !== sel.estado ? sel.estado : "" }); }); setSel(null); }}>Guardar</Btn>
                  ) : (
                    <Btn onClick={guardar}>Crear creativo</Btn>
                  )}
                  {sel && ["Aprobado","Publicado","Ganador"].includes(sel.estado) && (
                    <Btn kind="soft" onClick={() => { update((d) => {
                      const id = nextId(d, "calendar", "CAL-", 2);
                      d.content_calendar.push({ id, fecha: hoyISO(), hora: "12:00", canal: sel.canal, campaignId: sel.campaignId || "", creativeId: sel.id, titulo: sel.titulo, copyFinal: sel.copy || "", estado: "Programado", urlPublicacion: "", notas: "Creado desde Creativos" });
                      addAudit(d, { user, entidad: "Publicación", entidadId: id, accion: "Publicación creada desde creativo", a: sel.titulo });
                    }); setSel(null); }}>🗓️ Crear publicación</Btn>
                  )}
                  <Btn kind="ghost" onClick={() => { setNuevo(false); setSel(null); }}>Cancelar</Btn>
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

function Calendario({ db, update, user }) {
  const [nueva, setNueva] = useState(false);
  const vacio = { fecha: hoyISO(), hora: "12:00", canal: "Instagram", campaignId: "", creativeId: "", titulo: "", copyFinal: "", estado: "Pendiente", urlPublicacion: "", notas: "" };
  const [form, setForm] = useState(vacio);

  const semana = [...Array(7)].map((_, i) => dISO(i - new Date().getDay() + 1));
  const pubs = [...db.content_calendar].sort((a, b) => (a.fecha + a.hora) < (b.fecha + b.hora) ? -1 : 1);
  const pendientes = pubs.filter((p) => p.estado === "Pendiente" || p.estado === "Programado");
  const publicadas = pubs.filter((p) => p.estado === "Publicado").length;

  function exportar() {
    downloadCSV("calendario",
      ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado","URL"],
      pubs.map((p) => { const camp = db.campaigns.find((x) => x.id === p.campaignId); const cre = db.creatives.find((x) => x.id === p.creativeId); return [p.id, p.fecha, p.hora, p.canal, camp ? camp.nombre : "", cre ? cre.titulo : "", p.titulo, p.estado, p.urlPublicacion]; }));
  }

  function guardar() {
    if (!form.titulo.trim()) return;
    update((d) => {
      const id = nextId(d, "calendar", "CAL-", 2);
      d.content_calendar.push({ id, ...form });
      addAudit(d, { user, entidad: "Publicación", entidadId: id, accion: "Publicación creada", a: form.titulo });
    });
    setNueva(false); setForm(vacio);
  }

  function cambiarEstado(p, estado) {
    update((d) => { const x = d.content_calendar.find((y) => y.id === p.id); addAudit(d, { user, entidad: "Publicación", entidadId: p.id, accion: "Cambio de estado", de: x.estado, a: estado }); x.estado = estado; });
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="🗓️" label="Publicaciones hoy" value={pubs.filter((p) => p.fecha === hoyISO()).length} tone={T.coral} />
        <Stat icon="⏳" label="Pendientes / programadas" value={pendientes.length} tone="#96690F" />
        <Stat icon="✅" label="Publicadas" value={publicadas} tone="#3F6B42" />
        <Stat icon="📅" label="Esta semana" value={pubs.filter((p) => semana.includes(p.fecha)).length} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => setNueva(true)}>＋ Nueva publicación</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      <SectionTitle>Vista por día (esta semana)</SectionTitle>
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
        {semana.map((dia) => {
          const delDia = pubs.filter((p) => p.fecha === dia);
          const esHoy = dia === hoyISO();
          return (
            <div key={dia} className="w-56 shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-bold" style={{ color: esHoy ? T.coral : T.choco2 }}>{new Date(dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric" })}{esHoy && " · hoy"}</span>
                <span className="text-xs font-bold" style={{ color: T.choco2 }}>{delDia.length}</span>
              </div>
              <div className="flex flex-col gap-2 min-h-[60px] rounded-2xl p-2" style={{ background: T.vainilla + "80" }}>
                {delDia.map((p) => {
                  const cre = db.creatives.find((x) => x.id === p.creativeId);
                  return (
                    <Card key={p.id} className="p-2.5">
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-xs font-bold">{p.hora}</span>
                        <Badge label={p.canal} map={MK_CANAL_STYLE} />
                      </div>
                      <div className="text-xs font-semibold mt-1 leading-tight">{p.titulo}</div>
                      {cre && <div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>🎨 {cre.titulo}</div>}
                      <select value={p.estado} onChange={(e) => cambiarEstado(p, e.target.value)} className="mt-2 w-full rounded-lg px-1.5 py-1 text-[11px] border font-bold" style={inputStyle}>
                        {CAL_ESTADOS.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </Card>
                  );
                })}
                {delDia.length === 0 && <div className="text-[11px] text-center py-3 font-semibold" style={{ color: T.choco2 }}>Sin publicaciones</div>}
              </div>
            </div>
          );
        })}
      </div>

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
                setForm({ ...form, creativeId: id, campaignId: (cr && cr.campaignId) ? cr.campaignId : form.campaignId });
              }} className={inputCls} style={inputStyle}>
                <option value="">Sin creativo</option>
                {db.creatives.filter((c) => !form.campaignId || c.campaignId === form.campaignId).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Copy final">
            <textarea rows={2} value={form.copyFinal} onChange={(e) => setForm({ ...form, copyFinal: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} />
          </Field>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2"><Btn onClick={guardar}>Crear publicación</Btn><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ================= RESULTADOS CREATIVOS 📊 ================= */

function ResultadosCreativos({ db, update, user }) {
  const [nuevo, setNuevo] = useState(false);
  const vacio = { creativeId: "", campaignId: "", fecha: hoyISO(), impresiones: 0, alcance: 0, clicks: 0, mensajesWhatsApp: 0, pedidos: 0, ventas: 0, gasto: 0, notas: "" };
  const [form, setForm] = useState(vacio);

  const metric = (r) => ({
    ctr: r.impresiones > 0 ? r.clicks / r.impresiones : null,
    costoMsg: r.mensajesWhatsApp > 0 ? r.gasto / r.mensajesWhatsApp : null,
    cac: r.pedidos > 0 ? r.gasto / r.pedidos : null,
    roas: r.gasto > 0 ? r.ventas / r.gasto : null,
    conv: r.mensajesWhatsApp > 0 ? r.pedidos / r.mensajesWhatsApp : null,
  });

  function exportar() {
    downloadCSV("resultados-creativos",
      ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","CTR","Mensajes WA","Costo/msg","Pedidos","CAC","Ventas","Gasto","ROAS","Conv WA→pedido"],
      db.creative_results.map((r) => { const cre = db.creatives.find((x) => x.id === r.creativeId); const camp = db.campaigns.find((x) => x.id === r.campaignId); const m = metric(r); return [r.id, cre ? cre.titulo : "", camp ? camp.nombre : "", r.fecha, r.impresiones, r.alcance, r.clicks, m.ctr ? (m.ctr * 100).toFixed(2) + "%" : "", r.mensajesWhatsApp, m.costoMsg ? Math.round(m.costoMsg) : "", r.pedidos, m.cac ? Math.round(m.cac) : "", r.ventas, r.gasto, m.roas ? m.roas.toFixed(2) : "", m.conv ? (m.conv * 100).toFixed(1) + "%" : ""]; }));
  }

  function guardar() {
    if (!form.creativeId) return;
    update((d) => {
      const cre = d.creatives.find((x) => x.id === form.creativeId);
      const id = nextId(d, "result", "RES-", 2);
      d.creative_results.unshift({ id, ...form, campaignId: cre ? cre.campaignId : form.campaignId });
      addAudit(d, { user, entidad: "Resultado", entidadId: id, accion: "Resultado registrado", a: cre ? cre.titulo : "" });
    });
    setNuevo(false); setForm(vacio);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => setNuevo(true)}>＋ Registrar resultado</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {db.creative_results.map((r) => {
          const cre = db.creatives.find((x) => x.id === r.creativeId);
          const camp = db.campaigns.find((x) => x.id === r.campaignId);
          const m = metric(r);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{cre ? cre.titulo : "Creativo eliminado"}</div>
                  <div className="text-[11px]" style={{ color: T.choco2 }}>{camp ? camp.nombre : "—"} · {r.fecha}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="display text-lg" style={{ color: m.roas >= 1 ? "#3F6B42" : "#A03B2A" }}>{m.roas !== null ? m.roas.toFixed(1) + "x" : "—"}</div>
                  <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>ROAS</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[["CTR", m.ctr !== null ? (m.ctr * 100).toFixed(1) + "%" : "—"], ["Costo/msg", m.costoMsg !== null ? fmt(m.costoMsg) : "—"], ["CAC", m.cac !== null ? fmt(m.cac) : "—"], ["Mensajes", r.mensajesWhatsApp], ["Pedidos", r.pedidos], ["Conv WA", m.conv !== null ? (m.conv * 100).toFixed(0) + "%" : "—"]].map(([lab, v]) => (
                  <div key={lab} className="rounded-xl py-1.5" style={{ background: T.vainilla }}>
                    <div className="text-xs font-bold truncate px-0.5">{v}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>
                <span>👁️ {milCO(r.impresiones)} impres. · {milCO(r.alcance)} alcance</span>
                <span>💵 {fmt(r.ventas)} / gasto {fmt(r.gasto)}</span>
              </div>
              {r.notas && <div className="text-xs mt-1.5" style={{ color: T.choco2 }}>📝 {r.notas}</div>}
            </Card>
          );
        })}
        {db.creative_results.length === 0 && <Empty icon="📊" text="Sin resultados registrados." />}
      </div>

      {nuevo && (
        <Modal title="Registrar resultado de creativo" onClose={() => setNuevo(false)} wide>
          <Field label="Creativo">
            <select value={form.creativeId} onChange={(e) => setForm({ ...form, creativeId: e.target.value })} className={inputCls} style={inputStyle}>
              <option value="">Elegir creativo…</option>
              {db.creatives.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
            <Field label="Fecha"><Input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Field>
            <Field label="Impresiones"><Input type="number" value={form.impresiones} onChange={(e) => setForm({ ...form, impresiones: +e.target.value })} /></Field>
            <Field label="Alcance"><Input type="number" value={form.alcance} onChange={(e) => setForm({ ...form, alcance: +e.target.value })} /></Field>
            <Field label="Clicks"><Input type="number" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: +e.target.value })} /></Field>
            <Field label="Mensajes WhatsApp"><Input type="number" value={form.mensajesWhatsApp} onChange={(e) => setForm({ ...form, mensajesWhatsApp: +e.target.value })} /></Field>
            <Field label="Pedidos"><Input type="number" value={form.pedidos} onChange={(e) => setForm({ ...form, pedidos: +e.target.value })} /></Field>
            <Field label="Ventas"><Input type="number" value={form.ventas} onChange={(e) => setForm({ ...form, ventas: +e.target.value })} /></Field>
            <Field label="Gasto"><Input type="number" value={form.gasto} onChange={(e) => setForm({ ...form, gasto: +e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
          <div className="flex gap-2 mt-2"><Btn onClick={guardar}>Guardar resultado</Btn><Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn></div>
        </Modal>
      )}
    </div>
  );
}


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

// Traduce resultados técnicos a lenguaje simple
function resultadoSimple(m) {
  if (m.pedidos === 0) return { texto: "Todavía no ha generado pedidos. Dale unos días o prueba otro contenido.", tono: "#96690F", bg: "#FBE8C8" };
  if (m.roas !== null && m.roas >= 2) return { texto: `Funcionó muy bien: generó ${m.pedidos} pedido(s) y rindió el dinero invertido.`, tono: "#3F6B42", bg: "#DDEBD9" };
  if (m.roas !== null && m.roas >= 1) return { texto: `Funcionó bien: generó ${m.pedidos} pedido(s).`, tono: "#3F6B42", bg: "#DDEBD9" };
  return { texto: `Funcionó regular: gastó más de lo que vendió. Revisa el precio o el mensaje, o prueba otro creativo.`, tono: "#A03B2A", bg: "#F6D4CD" };
}

function Crecimiento({ db, update, user, go }) {
  const [seccion, setSeccion] = useState("inicio");

  const TARJETAS = [
    { id: "publicar", icon: "📱", titulo: "Qué publicar hoy", desc: "Contenido listo para subir ahora" },
    { id: "grabar", icon: "🎬", titulo: "Qué grabar hoy", desc: "Guiones paso a paso para Reels" },
    { id: "escribir", icon: "💬", titulo: "A qué clientes escribirles", desc: "Con el mensaje ya escrito" },
    { id: "promo", icon: "🎁", titulo: "Qué promoción activar", desc: "Beneficios y campañas" },
    { id: "funciono", icon: "🏆", titulo: "Qué contenido funcionó mejor", desc: "Lo que más vendió" },
    { id: "pausar", icon: "⏸️", titulo: "Qué campaña pausar", desc: "Lo que no está rindiendo" },
    { id: "repetir", icon: "🔁", titulo: "Qué idea repetir", desc: "Ideas ganadoras para reusar" },
    { id: "tareas", icon: "✅", titulo: "Tareas pendientes de redes", desc: "Tu lista del día" },
  ];

  // secciones adicionales de biblioteca
  const EXTRA = [
    { id: "ideas", icon: "💡", titulo: "Ideas listas", desc: "Biblioteca de ideas aprobadas" },
    { id: "guiones", icon: "🎬", titulo: "Guiones fáciles", desc: "Paso a paso para grabar" },
    { id: "mensajes", icon: "💬", titulo: "Mensajes de WhatsApp", desc: "Plantillas listas" },
    { id: "campanas", icon: "🎯", titulo: "Campañas simples", desc: "Objetivos claros" },
    { id: "marca", icon: "🎨", titulo: "Biblioteca de marca", desc: "Frases, tono y palabras" },
    { id: "resultados", icon: "📊", titulo: "Resultados fáciles", desc: "Explicados en simple" },
  ];

  if (seccion !== "inicio") {
    return (
      <div>
        <button onClick={() => setSeccion("inicio")} className="text-sm font-bold mb-4 flex items-center gap-1" style={{ color: T.coral }}>← Volver a Crecimiento MOMOS</button>
        {seccion === "publicar" && <QuePublicar db={db} update={update} user={user} />}
        {seccion === "grabar" && <Guiones db={db} />}
        {seccion === "guiones" && <Guiones db={db} />}
        {seccion === "escribir" && <AQuienEscribir db={db} go={go} />}
        {seccion === "mensajes" && <MensajesWhatsApp db={db} customer={null} />}
        {seccion === "promo" && <QuePromo db={db} go={go} />}
        {seccion === "campanas" && <CampanasSimples db={db} update={update} user={user} />}
        {seccion === "funciono" && <QueFunciono db={db} />}
        {seccion === "pausar" && <QuePausar db={db} update={update} user={user} />}
        {seccion === "repetir" && <IdeasListas db={db} update={update} user={user} soloRepetir />}
        {seccion === "ideas" && <IdeasListas db={db} update={update} user={user} />}
        {seccion === "marca" && <BibliotecaMarca db={db} />}
        {seccion === "resultados" && <ResultadosFaciles db={db} update={update} user={user} />}
        {seccion === "tareas" && <TareasRedes db={db} update={update} user={user} />}
      </div>
    );
  }

  const tareasPend = (db.marketing_tasks || []).filter((t) => t.estado === "Pendiente" && t.fecha === hoyISO()).length;
  const pubHoy = (db.content_calendar || []).filter((p) => p.fecha === hoyISO());

  return (
    <div>
      <Card className="p-4 mb-4" >
        <div className="display text-lg font-semibold mb-1">¡Hola! 💛 Esto es lo importante hoy</div>
        <div className="text-sm" style={{ color: T.choco2 }}>
          Tienes <b style={{ color: T.coral }}>{tareasPend}</b> tarea(s) de redes pendientes y <b style={{ color: T.coral }}>{pubHoy.length}</b> publicación(es) para hoy. Toca una tarjeta para saber qué hacer.
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {TARJETAS.map((t) => (
          <Card key={t.id} className="p-4" onClick={() => setSeccion(t.id)}>
            <div className="text-2xl mb-1" aria-hidden="true">{t.icon}</div>
            <div className="font-bold text-sm leading-tight">{t.titulo}</div>
            <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{t.desc}</div>
          </Card>
        ))}
      </div>

      <SectionTitle>Biblioteca MOMOS</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {EXTRA.map((t) => (
          <Card key={t.id} className="p-3" onClick={() => setSeccion(t.id)}>
            <div className="text-xl mb-1" aria-hidden="true">{t.icon}</div>
            <div className="font-bold text-xs leading-tight">{t.titulo}</div>
            <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{t.desc}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* --- Qué publicar hoy: recomendación del día --- */
function QuePublicar({ db, update, user }) {
  const hoy = hoyISO();
  const pubHoy = (db.content_calendar || []).filter((p) => p.fecha === hoy);
  // recomendación: ideas ganadoras/repetir primero, luego nuevas
  const recomendadas = [...(db.marketing_ideas || [])].sort((a, b) => {
    const rank = { "Ganadora": 0, "Repetir": 1, "Nueva": 2, "Usada": 3, "Descartada": 4 };
    return (rank[a.estado] ?? 5) - (rank[b.estado] ?? 5);
  }).slice(0, 3);

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">📱 Qué publicar hoy</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Esto es lo que te recomendamos subir hoy. Ya viene con el texto listo: solo copia y pega.</p>

      {pubHoy.length > 0 && (
        <>
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>YA PROGRAMADO PARA HOY</div>
          {pubHoy.map((p) => (
            <Card key={p.id} className="p-4 mb-2">
              <div className="flex justify-between items-start gap-2">
                <div><div className="font-bold text-sm">{p.titulo}</div><div className="text-xs" style={{ color: T.choco2 }}>{p.hora} · {p.canal}</div></div>
                <Badge label={p.estado} />
              </div>
              {p.copyFinal && <div className="text-sm mt-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>{p.copyFinal}</div>}
              {p.copyFinal && <div className="mt-2"><CopyBtn texto={p.copyFinal} /></div>}
            </Card>
          ))}
        </>
      )}

      <div className="text-xs font-bold mb-2 mt-4" style={{ color: T.choco2 }}>IDEAS RECOMENDADAS PARA HOY</div>
      {recomendadas.map((idea) => (
        <Card key={idea.id} className="p-4 mb-2">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-bold text-sm">{idea.titulo}</div>
              <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{idea.cat} · {idea.canal} · para {idea.objetivo}</div>
            </div>
            <Badge label={idea.estado} />
          </div>
          <div className="text-sm mt-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>{idea.copy}</div>
          {idea.guionCorto && <div className="text-xs mt-2" style={{ color: T.choco2 }}>🎬 Cómo grabarlo: {idea.guionCorto}</div>}
          <div className="flex gap-2 mt-3 flex-wrap">
            <CopyBtn texto={idea.copy} />
            <Btn small kind="soft" onClick={() => update((d) => {
              const id = nextId(d, "calendar", "CAL-", 2);
              d.content_calendar.push({ id, fecha: hoy, hora: "12:00", canal: idea.canal, campaignId: "", creativeId: "", titulo: idea.titulo, copyFinal: idea.copy, estado: "Programado", urlPublicacion: "", notas: "Desde Crecimiento MOMOS" });
              const x = d.marketing_ideas.find((y) => y.id === idea.id); if (x && x.estado === "Nueva") x.estado = "Usada";
              addAudit(d, { user, entidad: "Publicación", entidadId: id, accion: "Programada desde Crecimiento", a: idea.titulo });
            })}>📅 Programar para hoy</Btn>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* --- Guiones fáciles --- */
function Guiones({ db }) {
  const [sel, setSel] = useState(null);
  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">🎬 Qué grabar hoy</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Guiones paso a paso. Sigue las escenas en orden y ya tienes tu Reel.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {(db.marketing_guiones || []).map((g) => (
          <Card key={g.id} className="p-4" onClick={() => setSel(g)}>
            <div className="flex justify-between items-start gap-2">
              <div className="font-bold text-sm">{g.titulo}</div>
              <Badge label={g.dificultad} />
            </div>
            <div className="text-xs mt-1" style={{ color: T.choco2 }}>{g.duracion} · {g.productoFoco} · para {g.objetivo}</div>
            <div className="text-xs mt-2 font-semibold" style={{ color: T.coral }}>Ver guion paso a paso →</div>
          </Card>
        ))}
      </div>

      {sel && (
        <Modal title={sel.titulo} onClose={() => setSel(null)}>
          <div className="flex flex-wrap gap-2 mb-3"><Badge label={sel.dificultad} /><span className="text-xs font-semibold" style={{ color: T.choco2 }}>{sel.duracion} · {sel.productoFoco}</span></div>
          {[sel.escena1, sel.escena2, sel.escena3, sel.escena4].filter(Boolean).map((esc, i) => (
            <div key={i} className="flex gap-3 items-start mb-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center display text-sm shrink-0" style={{ background: T.rosa, color: "#8E4B5A" }}>{i + 1}</div>
              <div className="text-sm pt-0.5">{esc}</div>
            </div>
          ))}
          <div className="mt-3 p-2.5 rounded-xl" style={{ background: T.vainilla }}>
            <div className="text-xs font-bold" style={{ color: T.choco2 }}>TEXTO EN PANTALLA</div>
            <div className="text-sm">{sel.textoPantalla}</div>
            <div className="text-xs font-bold mt-2" style={{ color: T.choco2 }}>AUDIO SUGERIDO</div>
            <div className="text-sm">🎵 {sel.audio}</div>
          </div>
          <div className="mt-3"><CopyBtn texto={sel.textoPantalla} label="Copiar texto de pantalla" /></div>
        </Modal>
      )}
    </div>
  );
}

/* --- A quién escribirle hoy (CRM en simple) --- */
function pickMensaje(db, tipo) {
  const m = (db.marketing_mensajes || []).find((x) => x.tipo === tipo);
  return m ? m.texto : "";
}
function personalizar(texto, nombre) {
  return texto.replace("¡Hola!", "¡Hola, " + (nombre ? nombre.split(" ")[0] : "") + "!").replace("¡Hola de nuevo!", "¡Hola de nuevo, " + (nombre ? nombre.split(" ")[0] : "") + "!");
}

function AQuienEscribir({ db, go }) {
  const hoy = hoyISO();
  const grupos = [];
  // cumpleaños próximos
  db.customers.forEach((c) => {
    if (!c.cumple) return;
    const [mm, dd] = c.cumple.split("-").map(Number);
    const prox = new Date(); prox.setMonth(mm - 1, dd);
    if (prox < new Date()) prox.setFullYear(prox.getFullYear() + 1);
    const faltan = Math.round((prox - new Date()) / 86400000);
    if (faltan <= 7) grupos.push({ c, motivo: `Cumple en ${faltan} día(s) 🎂`, tipo: "Cliente que cumple años", color: "#8E4B5A", bg: "#F3D7DC" });
  });
  // beneficios por vencer
  db.benefits.filter((b) => b.estado === "Activo" && diasEntre(hoy, b.vence) <= 3 && b.vence >= hoy).forEach((b) => {
    const c = db.customers.find((x) => x.id === b.customerId);
    if (c) grupos.push({ c, motivo: `Beneficio "${b.beneficio}" vence el ${b.vence} ⏳`, tipo: "Cliente con beneficio activo", color: "#63518A", bg: "#E8E0F2" });
  });
  // inactivos
  db.customers.forEach((c) => {
    if (!c.ultima) return;
    const dias = diasEntre(c.ultima, hoy);
    if (dias >= 30) grupos.push({ c, motivo: `No compra hace ${dias} días 💤`, tipo: "Cliente que compró hace 30 días", color: "#A03B2A", bg: "#F6D4CD" });
    else if (dias >= 15) grupos.push({ c, motivo: `No compra hace ${dias} días`, tipo: "Cliente que compró hace 15 días", color: "#96690F", bg: "#FBE8C8" });
    else if (dias >= 7) grupos.push({ c, motivo: `Compró hace ${dias} días`, tipo: "Cliente que compró hace 7 días", color: "#3E5C7E", bg: "#DCE7F2" });
  });

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">💬 A qué clientes escribirles hoy</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Estos clientes vale la pena contactarlos hoy. El mensaje ya está escrito: cópialo y pégalo en WhatsApp.</p>
      {grupos.length === 0 ? <Empty icon="💛" text="Hoy no hay clientes urgentes por contactar." /> :
        grupos.map(({ c, motivo, tipo, color, bg }, i) => {
          const texto = personalizar(pickMensaje(db, tipo), c.nombre);
          return (
            <Card key={c.id + i} className="p-4 mb-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm">{c.nombre}</div>
                  <div className="text-xs" style={{ color: T.choco2 }}>{c.telefono} · {c.barrio}</div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: bg, color }}>{motivo}</span>
              </div>
              <div className="text-sm mt-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>{texto}</div>
              <div className="flex gap-2 mt-3 flex-wrap">
                <CopyBtn texto={texto} label="Copiar mensaje" />
                <Btn small kind="soft" onClick={() => {
                  const tel = (c.telefono || "").replace(/\D/g, "");
                  const url = "https://wa.me/57" + tel + "?text=" + encodeURIComponent(texto);
                  try { window.open(url, "_blank"); } catch (e) {}
                }}>💚 Abrir WhatsApp</Btn>
              </div>
            </Card>
          );
        })}
    </div>
  );
}

/* --- Mensajes de WhatsApp (biblioteca) --- */
function MensajesWhatsApp({ db, customer }) {
  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">💬 Mensajes de WhatsApp listos</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Plantillas para cada situación. Copia, ajusta el nombre si quieres, y envía.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {(db.marketing_mensajes || []).map((m) => (
          <Card key={m.id} className="p-4">
            <div className="text-xs font-bold mb-1" style={{ color: T.coral }}>{m.tipo}</div>
            <div className="text-sm p-2.5 rounded-xl" style={{ background: T.vainilla }}>{m.texto}</div>
            <div className="mt-2"><CopyBtn texto={m.texto} /></div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* --- Qué promoción activar --- */
function QuePromo({ db, go }) {
  const activos = db.benefits.filter((b) => b.estado === "Activo");
  const campActivas = db.campaigns.filter((c) => c.estado === "Activa");
  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">🎁 Qué promoción activar</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Beneficios y campañas que puedes impulsar hoy. Para crear una nueva, entra a Beneficios o Campañas simples.</p>

      <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>BENEFICIOS ACTIVOS ({activos.length})</div>
      {activos.length === 0 ? <Card className="p-4"><span className="text-sm" style={{ color: T.choco2 }}>No hay beneficios activos. Crea uno en el módulo Beneficios.</span></Card> :
        activos.map((b) => {
          const c = db.customers.find((x) => x.id === b.customerId);
          return (
            <Card key={b.id} className="p-4 mb-2">
              <div className="flex justify-between items-center gap-2">
                <div><div className="font-bold text-sm">🎁 {b.beneficio}</div><div className="text-xs" style={{ color: T.choco2 }}>{c ? c.nombre : "—"} · {b.condicion}</div></div>
                <span className="text-xs font-bold" style={{ color: diasEntre(hoyISO(), b.vence) <= 3 ? "#A03B2A" : T.choco2 }}>vence {b.vence}</span>
              </div>
            </Card>
          );
        })}

      <div className="text-xs font-bold mb-2 mt-4" style={{ color: T.choco2 }}>CAMPAÑAS ACTIVAS ({campActivas.length})</div>
      {campActivas.map((c) => (
        <Card key={c.id} className="p-4 mb-2">
          <div className="font-bold text-sm">📣 {c.nombre}</div>
          <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{c.oferta || "sin oferta"} · para {c.objetivo}</div>
        </Card>
      ))}
      <div className="mt-3 flex gap-2">
        <Btn small kind="soft" onClick={() => go("Beneficios")}>Ir a Beneficios</Btn>
      </div>
    </div>
  );
}

/* --- Campañas simples (crear con objetivo claro) --- */
function CampanasSimples({ db, update, user }) {
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState({ objetivo: "vender", producto: "", dias: 7, canal: "Instagram" });

  const MAP_OBJ = { vender: "Ventas", recompra: "Recompra", regalo: "Ventas", "cumpleaños": "Cumpleaños", seguidores: "Branding", "historias etiquetadas": "Recompra" };

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">🎯 Campañas simples</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Crea una campaña eligiendo qué quieres lograr. Nosotros armamos el resto.</p>
      <Btn onClick={() => setNueva(true)}>＋ Nueva campaña simple</Btn>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {db.campaigns.filter((c) => c.estado === "Activa" || c.estado === "Planeada").map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex justify-between items-start gap-2"><div className="font-bold text-sm">{c.nombre}</div><Badge label={c.estado} /></div>
            <div className="text-xs mt-1" style={{ color: T.choco2 }}>Para {c.objetivo} · {c.canal} · {c.fechaInicio} a {c.fechaFin}</div>
          </Card>
        ))}
      </div>

      {nueva && (
        <Modal title="Nueva campaña simple" onClose={() => setNueva(false)}>
          <Field label="¿Qué quieres lograr?"><Select options={OBJETIVO_SIMPLE} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} /></Field>
          <Field label="¿Qué producto quieres impulsar?"><Select placeholder="Cualquiera" options={db.products.map((p) => p.nombre)} value={form.producto} onChange={(e) => setForm({ ...form, producto: e.target.value })} /></Field>
          <Field label="¿En qué red?"><Select options={MK_CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
          <Field label="¿Por cuántos días?"><Select options={["3","7","14","30"]} value={String(form.dias)} onChange={(e) => setForm({ ...form, dias: +e.target.value })} /></Field>
          <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
            Crearemos una campaña "{form.objetivo}" para {form.producto || "tus productos"} en {form.canal}, por {form.dias} días.
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => {
              update((d) => {
                const id = nextId(d, "campaign", "CMP-", 2);
                const nombre = "Campaña " + form.objetivo + (form.producto ? " · " + form.producto : "");
                d.campaigns.unshift({ id, nombre, canal: form.canal, objetivo: MAP_OBJ[form.objetivo] || "Ventas", productoFoco: form.producto, oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(form.dias), presupuesto: 0, gastoReal: 0, estado: "Activa", responsable: "Marketing", notas: "Creada desde Crecimiento MOMOS" });
                addAudit(d, { user, entidad: "Campaña", entidadId: id, accion: "Campaña simple creada", a: nombre });
              });
              setNueva(false);
            }}>Crear campaña</Btn>
            <Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* --- Qué funcionó mejor --- */
function QueFunciono({ db }) {
  const creM = (db.creatives || []).map((cr) => ({ cr, pedidos: ordersDeCreative(db, cr.id).length, ventas: ventasDeCreative(db, cr.id) })).filter((x) => x.pedidos > 0).sort((a, b) => b.ventas - a.ventas);
  const campM = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) })).filter((x) => x.m.pedidos > 0).sort((a, b) => b.m.ventas - a.m.ventas);

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">🏆 Qué funcionó mejor</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Esto es lo que más vendió. Repite lo que funciona.</p>

      <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>CONTENIDO QUE MÁS VENDIÓ</div>
      {creM.length === 0 ? <Card className="p-4"><span className="text-sm" style={{ color: T.choco2 }}>Todavía no hay pedidos atribuidos a contenido. Cuando registres el origen de los pedidos, aparecerá aquí.</span></Card> :
        creM.slice(0, 5).map((x, i) => (
          <Card key={x.cr.id} className="p-4 mb-2">
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {i === 0 && <span className="text-lg">🥇</span>}
                <div className="min-w-0"><div className="font-bold text-sm truncate">{x.cr.titulo}</div><div className="text-xs" style={{ color: T.choco2 }}>{x.cr.formato} · {x.cr.canal}</div></div>
              </div>
              <div className="text-right shrink-0"><div className="display text-base" style={{ color: "#3F6B42" }}>{fmt(x.ventas)}</div><div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{x.pedidos} pedido(s)</div></div>
            </div>
          </Card>
        ))}

      <div className="text-xs font-bold mb-2 mt-4" style={{ color: T.choco2 }}>CAMPAÑAS QUE MÁS VENDIERON</div>
      {campM.slice(0, 3).map((x) => {
        const r = resultadoSimple(x.m);
        return (
          <Card key={x.c.id} className="p-4 mb-2">
            <div className="flex justify-between items-center gap-2">
              <div className="font-bold text-sm">{x.c.nombre}</div>
              <div className="display text-base" style={{ color: "#3F6B42" }}>{fmt(x.m.ventas)}</div>
            </div>
            <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: r.bg, color: r.tono }}>{r.texto}</div>
          </Card>
        );
      })}
    </div>
  );
}

/* --- Qué pausar --- */
function QuePausar({ db, update, user }) {
  const malas = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) })).filter((x) => x.c.estado === "Activa" && ((x.m.roas !== null && x.m.roas < 1) || (x.c.gastoReal > 0 && x.m.pedidos === 0)));

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">⏸️ Qué campaña pausar</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Estas campañas están gastando más de lo que venden. Considera pausarlas o cambiar el contenido.</p>
      {malas.length === 0 ? <Empty icon="🎉" text="¡Todas tus campañas activas están rindiendo bien!" /> :
        malas.map((x) => {
          const r = resultadoSimple(x.m);
          return (
            <Card key={x.c.id} className="p-4 mb-2">
              <div className="flex justify-between items-start gap-2"><div className="font-bold text-sm">{x.c.nombre}</div><Badge label={x.c.estado} /></div>
              <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: r.bg, color: r.tono }}>{r.texto}</div>
              <div className="text-xs mt-2" style={{ color: T.choco2 }}>Gastó {fmt(x.c.gastoReal)} · vendió {fmt(x.m.ventas)}</div>
              <div className="mt-3"><Btn small kind="danger" onClick={() => update((d) => {
                const c = d.campaigns.find((y) => y.id === x.c.id); c.estado = "Pausada";
                addAudit(d, { user, entidad: "Campaña", entidadId: c.id, accion: "Cambio de estado", de: "Activa", a: "Pausada" });
              })}>⏸️ Pausar campaña</Btn></div>
            </Card>
          );
        })}
    </div>
  );
}

/* --- Ideas listas (biblioteca con categorías y estados) --- */
function IdeasListas({ db, update, user, soloRepetir }) {
  const [cat, setCat] = useState("");
  const base = soloRepetir ? (db.marketing_ideas || []).filter((i) => ["Ganadora","Repetir"].includes(i.estado)) : (db.marketing_ideas || []);
  const lista = base.filter((i) => !cat || i.cat === cat);

  function setEstado(idea, estado) {
    update((d) => { const x = d.marketing_ideas.find((y) => y.id === idea.id); addAudit(d, { user, entidad: "Idea", entidadId: idea.id, accion: "Cambio de estado", de: x.estado, a: estado }); x.estado = estado; });
  }

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">{soloRepetir ? "🔁 Ideas para repetir" : "💡 Ideas listas"}</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>{soloRepetir ? "Estas ideas ya funcionaron o vale la pena repetir. Úsalas de nuevo." : "Biblioteca de ideas aprobadas de MOMOS. Filtra por tipo y usa la que quieras."}</p>

      {!soloRepetir && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
          <button onClick={() => setCat("")} className="text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap" style={{ background: !cat ? T.coral : T.vainilla, color: !cat ? "#fff" : T.choco2 }}>Todas</button>
          {IDEA_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} className="text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap" style={{ background: cat === c ? T.coral : T.vainilla, color: cat === c ? "#fff" : T.choco2 }}>{c.replace("Ideas ", "")}</button>
          ))}
        </div>
      )}

      {lista.length === 0 ? <Empty icon="💡" text="No hay ideas en esta categoría." /> :
        lista.map((idea) => (
          <Card key={idea.id} className="p-4 mb-2">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0"><div className="font-bold text-sm">{idea.titulo}</div><div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{idea.cat} · {idea.canal} · para {idea.objetivo} · {idea.productoSugerido}</div></div>
              <Badge label={idea.estado} />
            </div>
            <div className="text-sm mt-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>{idea.copy}</div>
            {idea.guionCorto && <div className="text-xs mt-2" style={{ color: T.choco2 }}>🎬 {idea.guionCorto}</div>}
            <div className="flex gap-2 mt-3 flex-wrap">
              <CopyBtn texto={idea.copy} />
              <Btn small kind="soft" onClick={() => setEstado(idea, "Repetir")}>🔁 Repetir</Btn>
              <Btn small kind="soft" onClick={() => setEstado(idea, "Ganadora")}>🏆 Ganadora</Btn>
              <Btn small kind="ghost" onClick={() => setEstado(idea, "Usada")}>Marcar usada</Btn>
            </div>
          </Card>
        ))}
    </div>
  );
}

/* --- Biblioteca de marca --- */
function BibliotecaMarca({ db }) {
  const bl = db.brand_library || { frases: [], tono: [], palabrasSi: [], palabrasNo: [] };
  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">🎨 Biblioteca de marca</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>La voz de MOMOS. Usa estas frases y palabras para que todo suene igual de tierno.</p>

      <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>FRASES APROBADAS</div>
      {bl.frases.map((f, i) => (
        <Card key={i} className="p-3 mb-2 flex items-center justify-between gap-2">
          <span className="text-sm italic">“{f}”</span>
          <CopyBtn texto={f} label="Copiar" />
        </Card>
      ))}

      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.coral }}>TONO DE MARCA</div>
          <div className="flex flex-wrap gap-1.5">{bl.tono.map((t) => <span key={t} className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: T.rosa, color: "#8E4B5A" }}>{t}</span>)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: "#3F6B42" }}>✅ PALABRAS QUE SÍ</div>
          <div className="flex flex-wrap gap-1.5">{bl.palabrasSi.map((t) => <span key={t} className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: "#DDEBD9", color: "#3F6B42" }}>{t}</span>)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: "#A03B2A" }}>🚫 PALABRAS QUE NO</div>
          <div className="flex flex-wrap gap-1.5">{bl.palabrasNo.map((t) => <span key={t} className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{t}</span>)}</div>
        </Card>
      </div>
    </div>
  );
}

/* --- Resultados fáciles: métricas traducidas a recomendaciones --- */
function ResultadosFaciles({ db, update, user }) {
  const traffic = trafficRecomendaciones(db);
  const recomendaciones = [];
  const creM = (db.creatives || []).map((cr) => ({ cr, pedidos: ordersDeCreative(db, cr.id).length, ventas: ventasDeCreative(db, cr.id) }));
  const ganador = [...creM].filter((x) => x.pedidos > 0).sort((a, b) => b.ventas - a.ventas)[0];
  if (ganador) recomendaciones.push({ icon: "🏆", texto: `"${ganador.cr.titulo}" fue tu contenido ganador. Repite la idea esta semana.`, bg: "#DDEBD9", color: "#3F6B42" });

  // producto que más pedidos generó
  const prodCount = {};
  db.orders.filter((o) => esPedidoCobrado(o)).forEach((o) => itemsOf(db, o.id).forEach((it) => { prodCount[it.nombre] = (prodCount[it.nombre] || 0) + it.cant; }));
  const topProd = Object.entries(prodCount).sort((a, b) => b[1] - a[1])[0];
  if (topProd) recomendaciones.push({ icon: "⭐", texto: `${topProd[0]} es el que más pedidos generó. Ponlo como protagonista mañana.`, bg: "#F7ECD9", color: "#8A6520" });

  // campañas con muchos mensajes pocas ventas
  (db.creative_results || []).forEach((r) => {
    if (r.mensajesWhatsApp >= 30 && r.pedidos <= 3) {
      const cre = db.creatives.find((x) => x.id === r.creativeId);
      recomendaciones.push({ icon: "⚠️", texto: `"${cre ? cre.titulo : "Un contenido"}" tuvo muchos mensajes pero pocas ventas. Revisa el precio o el mensaje.`, bg: "#FBE8C8", color: "#96690F" });
    }
  });

  // canal con más pedidos
  const canalCount = {};
  db.orders.filter((o) => esPedidoCobrado(o) && o.canal).forEach((o) => { canalCount[o.canal] = (canalCount[o.canal] || 0) + 1; });
  const canales = Object.entries(canalCount).sort((a, b) => b[1] - a[1]);
  if (canales.length >= 2) recomendaciones.push({ icon: "📊", texto: `${canales[0][0]} está trayendo más pedidos que ${canales[1][0]} esta semana. Publica más ahí.`, bg: "#DCE7F2", color: "#3E5C7E" });

  // caja regalo vs individual
  const cajas = Object.entries(prodCount).filter(([k]) => /caja/i.test(k)).reduce((s, [, v]) => s + v, 0);
  const indiv = Object.entries(prodCount).filter(([k]) => /momo|gatito|perrito/i.test(k) && !/caja/i.test(k)).reduce((s, [, v]) => s + v, 0);
  if (cajas > indiv && cajas > 0) recomendaciones.push({ icon: "🎁", texto: "Los clientes están respondiendo mejor a cajas regalo que a productos individuales. Impúlsalas.", bg: "#F3D7DC", color: "#8E4B5A" });

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">📊 Resultados fáciles</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Sin números complicados. Esto es lo que los datos te recomiendan hacer.</p>

      {traffic.length > 0 && (
        <>
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>🎯 RECOMENDACIONES PARA TUS CAMPAÑAS</div>
          {traffic.map((r, i) => (
            <Card key={"t" + i} className="p-4 mb-2">
              <div className="flex gap-3 items-start">
                <div className="text-2xl shrink-0">{r.icon}</div>
                <div className="flex-1">
                  <div className="font-bold text-sm mb-1">{r.titulo}</div>
                  <div className="text-sm p-2 rounded-lg" style={{ background: r.bg, color: r.color }}>{r.texto}</div>
                  {r.accion === "pausar" && (
                    <div className="mt-2"><Btn small kind="danger" onClick={() => update((d) => {
                      const c = d.campaigns.find((y) => y.id === r.campaignId); if (c) { c.estado = "Pausada"; addAudit(d, { user, entidad: "Campaña", entidadId: c.id, accion: "Cambio de estado", de: "Activa", a: "Pausada" }); }
                    })}>⏸️ Pausar campaña</Btn></div>
                  )}
                  {r.accion === "subir" && (
                    <div className="mt-2"><Btn small kind="rosa" onClick={() => update((d) => {
                      const c = d.campaigns.find((y) => y.id === r.campaignId); if (c) { const antes = c.presupuesto; c.presupuesto = r.nuevoPresupuesto; addAudit(d, { user, entidad: "Campaña", entidadId: c.id, accion: "Presupuesto ajustado", de: fmt(antes), a: fmt(r.nuevoPresupuesto) }); }
                    })}>🚀 Subir presupuesto 20%</Btn></div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </>
      )}

      {recomendaciones.length > 0 && <div className="text-xs font-bold mb-2 mt-4" style={{ color: T.choco2 }}>💡 LO QUE ESTÁN DICIENDO TUS VENTAS</div>}
      {recomendaciones.length === 0 && traffic.length === 0 ? <Empty icon="📊" text="Aún no hay suficientes datos. Registra el origen de tus pedidos y los resultados de tu contenido." /> :
        recomendaciones.map((r, i) => (
          <Card key={i} className="p-4 mb-2">
            <div className="flex gap-3 items-start">
              <div className="text-2xl shrink-0">{r.icon}</div>
              <div className="text-sm pt-1 p-2 rounded-lg flex-1" style={{ background: r.bg, color: r.color }}>{r.texto}</div>
            </div>
          </Card>
        ))}
    </div>
  );
}

/* --- Tareas de redes --- */
function TareasRedes({ db, update, user }) {
  const hoy = hoyISO();
  const tareas = (db.marketing_tasks || []).filter((t) => t.fecha === hoy);
  const pend = tareas.filter((t) => t.estado === "Pendiente");

  function marcar(t, estado) {
    update((d) => { const x = d.marketing_tasks.find((y) => y.id === t.id); addAudit(d, { user, entidad: "Tarea redes", entidadId: t.id, accion: "Cambio de estado", de: x.estado, a: estado }); x.estado = estado; });
  }
  function generarHoy() {
    update((d) => {
      const base = ["Publicar la historia del producto del día","Subir el Reel recomendado","Revisar etiquetas en Instagram y activar beneficios","Responder comentarios y mensajes","Escribir a clientes con beneficio por vencer","Escribir a clientes que no compran hace 15 días","Revisar cómo va la campaña activa","Registrar los resultados del contenido publicado ayer"];
      base.forEach((tarea) => {
        if (!d.marketing_tasks.some((t) => t.tarea === tarea && t.fecha === hoy)) {
          const id = nextId(d, "tarea", "TAR-", 2);
          d.marketing_tasks.push({ id, tarea, fecha: hoy, estado: "Pendiente", responsable: "Marketing" });
        }
      });
      addAudit(d, { user, entidad: "Tarea redes", entidadId: "—", accion: "Tareas del día generadas", a: hoy });
    });
  }

  return (
    <div>
      <h2 className="display text-lg font-semibold mb-1">✅ Tareas de redes de hoy</h2>
      <p className="text-sm mb-4" style={{ color: T.choco2 }}>Tu lista del día. Complétalas una por una. Quedan {pend.length} pendiente(s).</p>
      {tareas.length === 0 && <div className="mb-3"><Btn onClick={generarHoy}>✨ Generar tareas de hoy</Btn></div>}
      {tareas.map((t) => (
        <Card key={t.id} className="p-3.5 mb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg">{t.estado === "Hecha" ? "✅" : t.estado === "Saltada" ? "⏭️" : "⭕"}</span>
              <span className="text-sm font-semibold" style={{ textDecoration: t.estado === "Hecha" ? "line-through" : "none", color: t.estado === "Hecha" ? T.choco2 : "inherit" }}>{t.tarea}</span>
            </div>
            <Badge label={t.estado} />
          </div>
          {t.estado === "Pendiente" && (
            <div className="flex gap-2 mt-2">
              <Btn small kind="rosa" onClick={() => marcar(t, "Hecha")}>✓ Completar</Btn>
              <Btn small kind="ghost" onClick={() => marcar(t, "Saltada")}>Saltar</Btn>
            </div>
          )}
        </Card>
      ))}
      {tareas.length > 0 && <div className="mt-2"><Btn small kind="ghost" onClick={generarHoy}>Volver a generar faltantes</Btn></div>}
    </div>
  );
}

/* ================= APP SHELL ================= */

// Módulos que TODAVÍA escriben en el estado local (pendientes de migrar a RPCs):
// sus cambios no llegan al servidor y la próxima hidratación los pisa.
const MODULOS_EN_MIGRACION = ["Productos", "Beneficios", "Crecimiento", "Marketing", "Creativos", "Calendario", "Resultados", "Finanzas", "Configuración"];

function BannerMigracion() {
  return (
    <div className="rounded-2xl border px-4 py-3 mb-4 text-sm font-bold" role="alert"
      style={{ background: "#FFF4E0", borderColor: "#E7C078", color: "#96690F" }}>
      🚧 Módulo en migración: los cambios hechos acá todavía NO se guardan en el servidor —
      se pierden al recargar o cuando la app se actualiza desde el server. Usalo para consultar.
    </div>
  );
}

const MODULOS = [
  { id: "Dashboard", icon: "🏠", roles: ["Administrador","Cocina","Empaque","Logística","Marketing/CRM"] },
  { id: "Pedidos", icon: "🧾", roles: ["Administrador","Cocina","Empaque","Logística"] },
  { id: "Producción", icon: "👩‍🍳", roles: ["Administrador","Cocina"] },
  { id: "Inventario", icon: "📦", roles: ["Administrador","Cocina"] },
  { id: "Productos", icon: "🍰", roles: ["Administrador","Marketing/CRM"] },
  { id: "Domicilios", icon: "🛵", roles: ["Administrador","Logística"] },
  { id: "Reclamos", icon: "⚠️", roles: ["Administrador","Empaque","Logística","Marketing/CRM"] },
  { id: "Clientes", icon: "💗", roles: ["Administrador","Marketing/CRM"] },
  { id: "Beneficios", icon: "🎁", roles: ["Administrador","Marketing/CRM"] },
  { id: "Crecimiento", icon: "🌱", roles: ["Administrador","Marketing/CRM"] },
  { id: "Marketing", icon: "📣", roles: ["Administrador","Marketing/CRM"] },
  { id: "Creativos", icon: "🎨", roles: ["Administrador","Marketing/CRM"] },
  { id: "Calendario", icon: "🗓️", roles: ["Administrador","Marketing/CRM"] },
  { id: "Resultados", icon: "📊", roles: ["Administrador","Marketing/CRM"] },
  { id: "Finanzas", icon: "💰", roles: ["Administrador"] },
  { id: "Reportes", icon: "📊", roles: ["Administrador","Marketing/CRM"] },
  { id: "Configuración", icon: "⚙️", roles: ["Administrador"] },
];

const ROLES = ["Administrador","Cocina","Empaque","Logística","Marketing/CRM"];

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
  const saveTimer = useRef(null);
  const saveTokenRef = useRef(0);
  const syncRef = useRef("cargando");
  const dbRef = useRef(null);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  useEffect(() => { dbRef.current = db; }, [db]);

  // ── Fase 3 · slice 1: sesión Supabase = fuente de verdad de la identidad ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Con sesión: cargar el perfil real (public.users) por auth_id — define nombre y rol
  const authUserId = session?.user?.id;
  useEffect(() => {
    if (!authUserId) { setPerfil(null); setPerfilError(null); return; }
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id,nombre,rol,activo")
        .eq("auth_id", authUserId)
        .maybeSingle();
      if (!vivo) return;
      if (error) setPerfilError("No se pudo cargar tu perfil: " + error.message);
      else if (!data) setPerfilError("Tu usuario no está vinculado al equipo. Avisale al administrador.");
      else if (!data.activo) setPerfilError("Tu usuario está desactivado. Avisale al administrador.");
      else { setPerfil(data); setPerfilError(null); }
    })();
    return () => { vivo = false; };
  }, [authUserId]);

  // ── Fase 3: hidratar desde Supabase (una vez por carga; re-usable tras cada escritura remota) ──
  // Maestros/catálogos + operativo (ciclo de pedido + producción). Marketing sigue local.
  async function hidratarDesdeServidor() {
    const [cat, op] = await Promise.all([fetchCatalogos(), fetchOperativo()]);
    update((d) => {
      d.products = cat.products;
      d.inventory_items = cat.inventory_items;
      d.recipes = cat.recipes;
      d.users = cat.users;
      d.figuras = cat.figuras || []; // catálogo figuras con product_id/gramaje (Producción v2)
      d.subrecetas = cat.subrecetas || []; // Componentes+BOM: bases (mousses/cheesecake/ganache/salsas/crocante)
      d.subreceta_ingredientes = cat.subreceta_ingredientes || []; // receta maestra por 1000 g
      d.figura_relleno = cat.figura_relleno || []; // relleno configurable de figuras (20/15 g editables)
      if (cat.brand_library) d.brand_library = cat.brand_library;
      Object.assign(d.settings, cat.settingsCatalogos);
      Object.assign(d, op); // orders, order_items, customers, deliveries, evidences, benefits, claims, movements, reservations, suggestions, audit, production_batches
      normalizeDbShape(d); // re-deriva atributos/especie sobre lo hidratado
    }, { silencioso: true });
  }

  // Frescura multi-dispositivo: re-leer del servidor al volver a la pestaña/ventana
  // (throttle 60 s). Via ref para no cerrar sobre una versión vieja de la función.
  const refetchFocoRef = useRef(null);
  refetchFocoRef.current = hidratarDesdeServidor;
  const ultimoRefetchFocoRef = useRef(0);
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState !== "visible") return;
      if (!hidratadoRef.current) return; // recién tras la hidratación inicial
      const ahora = Date.now();
      if (ahora - ultimoRefetchFocoRef.current < 60000) return;
      ultimoRefetchFocoRef.current = ahora;
      refetchFocoRef.current?.().catch(() => {}); // silencioso: si falla, sigue la caché
    }
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  useEffect(() => {
    if (!perfil || !db || hidratadoRef.current) return;
    hidratadoRef.current = true;
    (async () => {
      try {
        await hidratarDesdeServidor();
        setCatalogosDe("servidor");
      } catch (e) {
        console.warn("Hidratación: no se pudo leer de Supabase; se usa la caché local.", e);
        setCatalogosDe("cache");
      }
    })();
  }, [perfil, db]);

  // Advertencia al cerrar la página si hay cambios pendientes + intento de guardado síncrono
  useEffect(() => {
    const handler = (e) => {
      if (["guardando", "local", "error"].includes(syncRef.current)) {
        // #2/#8: escribir al MISMO backend que dbLoad lee (window.storage), no sólo a localStorage
        try {
          if (dbRef.current) {
            const payload = JSON.stringify(dbRef.current);
            storage.set(DB_KEY, payload); // best-effort al backend real (no se puede await en unload)
            if (typeof localStorage !== "undefined") localStorage.setItem(DB_KEY, payload); // espejo
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

  function go(v, payload) { setFocus(payload || null); setVista(v); }

  useEffect(() => {
    (async () => {
      const guardado = await dbLoad();
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
          const ok = await dbPersist(guardado);
          setSync(ok ? "guardado" : "error");
        } else {
          setDb(guardado);
          setSync("guardado");
        }
      } else {
        const semilla = seedDb();
        setDb(semilla);
        const ok = await dbPersist(semilla);
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const token = ++saveTokenRef.current;
    saveTimer.current = setTimeout(async () => {
      const ok = await dbPersist(next);
      // #13: sólo el guardado MÁS reciente puede tocar el indicador de sync (evita "guardado" falso)
      if (token === saveTokenRef.current) setSync(ok ? "guardado" : "error");
    }, 600);
    setDb(next);
    return result;
  }

  async function resetear() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await dbReset();
    const semilla = seedDb();
    dbRef.current = semilla;
    setDb(semilla);
    hidratadoRef.current = false; // la semilla pisó los catálogos: re-hidratar del servidor
    setCatalogosDe(null);
    const ok = await dbPersist(semilla);
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
    const ok = await dbPersist(next);
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
    return (
      <div className="momos min-h-screen flex items-center justify-center p-6" style={{ background: T.bg }}>
        <style>{FONTS}</style>
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
          <div className="display text-lg font-semibold mb-2">Datos de una versión más nueva</div>
          <div className="text-sm" style={{ color: T.choco2 }}>
            Los datos guardados en este dispositivo son de MOMOS OPS versión {incompat}, más nueva que esta app (versión {DB_VERSION}). Para no dañar tu información, no se cargó nada.
          </div>
          <div className="text-sm mt-3" style={{ color: T.choco2 }}>
            Abre la versión más reciente de la app, o restaura un respaldo compatible. Si necesitas ayuda, contacta a soporte antes de continuar.
          </div>
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

  const rol = perfil.rol; // el rol ya no se simula: viene del perfil real
  const visibles = MODULOS.filter((m) => m.roles.includes(rol));
  const activa = visibles.some((m) => m.id === vista) ? vista : visibles[0].id;
  const navPrincipal = visibles.slice(0, 4);
  const navExtra = visibles.slice(4);
  const user = rol;

  function render() {
    const p = { db, update, user, refrescar: hidratarDesdeServidor, perfil };
    switch (activa) {
      case "Dashboard": return <Dashboard db={db} go={go} user={user} />;
      case "Pedidos": return <Pedidos {...p} focus={focus} />;
      case "Producción": return <Produccion {...p} />;
      case "Inventario": return <Inventario {...p} focus={focus} />;
      case "Productos": return <Productos {...p} />;
      case "Domicilios": return <Domicilios {...p} />;
      case "Reclamos": return <Reclamos {...p} focus={focus} />;
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

      <header className="sticky top-0 z-40 border-b" style={{ background: "rgba(250,244,236,.92)", backdropFilter: "blur(8px)", borderColor: T.border }}>
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: `linear-gradient(135deg, ${T.rosa}, ${T.coralSoft})` }} aria-hidden="true">🐱</div>
          <div className="min-w-0">
            <div className="display font-bold leading-none" style={{ fontSize: 18 }}>MOMOS <span style={{ color: T.coral }}>OPS</span></div>
            <div className="text-[11px] font-semibold truncate" style={{ color: T.choco2 }}>D'Momos Sweet Love · El Caney, Cali · <span style={{ color: syncColor }}>{syncLabel}</span>{catalogosDe && <span style={{ color: catalogosDe === "servidor" ? "#3F6B42" : "#96690F" }}> · catálogos: {catalogosDe === "servidor" ? "servidor ✓" : "caché"}</span>}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold leading-tight">{perfil.nombre}</div>
              <div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{perfil.rol}</div>
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
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-left transition-colors"
              style={{ background: activa === m.id ? T.rosa : "transparent", color: activa === m.id ? "#8E4B5A" : T.choco }}>
              <span aria-hidden="true">{m.icon}</span>{m.id}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 p-4 pb-28 md:pb-8">
          <h1 className="display text-2xl font-semibold mt-1 mb-4">{activa}</h1>
          {MODULOS_EN_MIGRACION.includes(activa) && <BannerMigracion />}
          {render()}
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t flex" style={{ background: T.surface, borderColor: T.border }} aria-label="Módulos">
        {navPrincipal.map((m) => (
          <button key={m.id} onClick={() => { go(m.id); setMasAbierto(false); }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold"
            style={{ color: activa === m.id ? T.coral : T.choco2 }}>
            <span className="text-lg" aria-hidden="true">{m.icon}</span>{m.id}
          </button>
        ))}
        {navExtra.length > 0 && (
          <button onClick={() => setMasAbierto(!masAbierto)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold"
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
                <span className="text-xl" aria-hidden="true">{m.icon}</span>{m.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
