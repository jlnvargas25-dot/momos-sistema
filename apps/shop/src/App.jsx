import { useEffect, useState } from "react";
import { MomosLogo, identity } from "@momos/brand";
import { fetchCatalog } from "./lib/catalog.js";

// Logo oficial (brand_media_assets id 104 · "LOGO PRINCIPAL"). PNG con fondo
// transparente derivado del JPEG gobernado (flood-fill desde los bordes +
// recorte del padding), para que sobre la crema quede SOLO el logo, sin recuadro.
const LOGO = "/brand/momos-logo.png";

const money = (cop) => "$" + Number(cop || 0).toLocaleString("es-CO");

function IconButton({ label, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="relative grid h-11 w-11 place-items-center rounded-full bg-surface text-choco shadow-soft transition-transform active:scale-95"
    >
      {children}
    </button>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-crema/85 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
        <MomosLogo src={LOGO} size={36} title="MOMOS · D'Momos Sweet Love" />
        <IconButton label="Ver mi pedido">
          <span aria-hidden="true" className="text-lg">🛍️</span>
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold text-white">
            0
          </span>
        </IconButton>
      </div>
    </header>
  );
}

function Hero({ pedidoMinimo }) {
  return (
    <section className="px-4 pt-5">
      <div className="relative overflow-hidden rounded-momo-lg bg-surface p-6 shadow-momo">
        <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-rosa" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-vainilla" />
        <div className="relative">
          <p className="text-sm font-bold text-cocoa">Hola 👋 bienvenido a</p>
          <h1 className="mt-1 font-display text-[2rem] font-bold leading-[1.1] text-choco">
            Antojáte algo tierno.
          </h1>
          <p className="mt-2 max-w-[22rem] text-sm text-cocoa">{identity.positioning}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button type="button" className="inline-flex h-11 items-center rounded-full bg-coral px-6 text-sm font-extrabold text-white shadow-soft transition-transform active:scale-95">
              Ver el menú
            </button>
            <button type="button" className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-extrabold text-choco transition-transform active:scale-95">
              ¿Cómo pedir?
            </button>
          </div>
          {pedidoMinimo > 0 && (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-soft px-3 py-1 text-xs font-bold text-cocoa">
              🧺 Pedido mínimo {money(pedidoMinimo)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <section className="mt-6 px-4" aria-hidden="true">
      <div className="mb-3 h-6 w-40 animate-pulse rounded-full bg-soft" />
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-momo bg-surface p-3 shadow-soft">
            <div className="h-16 w-16 shrink-0 animate-pulse rounded-2xl bg-coral-soft" />
            <div className="flex-1">
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-soft" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-soft" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Notice({ tone = "info", icon, title, children }) {
  const styles = tone === "error"
    ? { background: "#FFF1ED", border: "1px solid #F0C1B8", color: "#A03B2A" }
    : { background: "#FFF5E4", border: "1px solid #EDD4A8", color: "#7B5410" };
  return (
    <div className="flex items-start gap-3 rounded-momo px-4 py-3" style={styles} role="status">
      <span aria-hidden="true" className="text-lg">{icon}</span>
      <div>
        <div className="text-sm font-extrabold">{title}</div>
        <div className="mt-0.5 text-xs">{children}</div>
      </div>
    </div>
  );
}

function ProductCard({ item }) {
  const disp = item.disponibilidad && !/dispon/i.test(item.disponibilidad) ? item.disponibilidad : null;
  return (
    <article className="flex items-center gap-3 rounded-momo bg-surface p-3 shadow-soft">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-coral-soft text-3xl">
        <span aria-hidden="true">🍰</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-base font-semibold text-choco">{item.nombre}</h3>
        {item.descr && <p className="truncate text-xs text-cocoa">{item.descr}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-extrabold text-choco">{money(item.precio)}</span>
          {item.combo_size > 1 && <span className="text-[10px] font-bold text-rosa-deep">×{item.combo_size}</span>}
          {disp && <span className="text-[10px] font-bold text-cocoa">· {disp}</span>}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Agregar ${item.nombre}`}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral text-xl font-bold text-white transition-transform active:scale-90"
      >
        +
      </button>
    </article>
  );
}

function CategoryChips({ categorias, value, onChange }) {
  return (
    <nav aria-label="Categorías">
      <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categorias.map((c) => {
          const active = c === value;
          return (
            <button
              key={c}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onChange(c)}
              className={"h-9 shrink-0 rounded-full px-4 text-sm font-bold transition-colors " + (active ? "bg-choco text-crema" : "bg-surface text-cocoa shadow-soft")}
            >
              {c}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ChipStrip({ title, items }) {
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 font-display text-base font-bold text-choco">{title}</h2>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span key={s} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold text-cocoa">
            {s}
          </span>
        ))}
      </div>
    </section>
  );
}

function ZonasList({ zonas }) {
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 font-display text-base font-bold text-choco">Llegamos a</h2>
      <div className="overflow-hidden rounded-momo bg-surface shadow-soft">
        {zonas.map((z, i) => (
          <div key={z.zona} className={"flex items-center justify-between px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")}>
            <span className="min-w-0 flex-1 truncate pr-3 text-sm font-semibold text-choco">📍 {z.zona}</span>
            <span className="shrink-0 text-sm font-extrabold text-coral">{money(z.tarifa)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Confianza() {
  const items = [
    ["🎈", "Pedí como invitado"],
    ["🔒", "Pago seguro"],
    ["📍", "Seguí tu pedido"],
  ];
  return (
    <section className="mt-6 px-4">
      <div className="grid grid-cols-3 gap-2 rounded-momo bg-soft p-3">
        {items.map(([icon, label]) => (
          <div key={label} className="text-center">
            <div aria-hidden="true" className="text-lg">{icon}</div>
            <div className="mt-1 text-[11px] font-bold leading-tight text-cocoa">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BottomBar() {
  return (
    <div className="sticky bottom-0 z-20 mt-8 border-t border-line/70 bg-crema/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          className="flex h-12 w-full items-center justify-center rounded-full bg-coral text-sm font-extrabold text-white shadow-momo transition-transform active:scale-[0.98]"
        >
          Empezar mi pedido
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState({ status: "loading" });
  const [cat, setCat] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchCatalog()
      .then((res) => {
        if (!alive) return;
        if (!res.ok) { setState({ status: "error", error: res.error }); return; }
        setState({ status: "ready", data: res });
        setCat(res.categorias[0] || null);
      })
      .catch((e) => { if (alive) setState({ status: "error", error: String(e?.message || e) }); });
    return () => { alive = false; };
  }, []);

  const data = state.status === "ready" ? state.data : null;
  const grupo = data && cat ? data.grupos.find((g) => g.categoria === cat) : null;
  const items = grupo ? grupo.items : [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <Header />
      <main className="flex-1 pb-2">
        <Hero pedidoMinimo={data?.pedidoMinimo} />

        {state.status === "loading" && <Skeleton />}

        {state.status === "error" && (
          <section className="mt-6 px-4">
            <Notice tone="error" icon="⚠️" title="No pudimos cargar el menú">
              Reintentá en un momento.
            </Notice>
          </section>
        )}

        {state.status === "ready" && (
          <>
            {data.categorias.length > 0 ? (
              <>
                <div className="mt-6">
                  <CategoryChips categorias={data.categorias} value={cat} onChange={setCat} />
                </div>
                <section className="mt-4 px-4">
                  <h2 className="mb-3 font-display text-lg font-bold text-choco">{cat}</h2>
                  <div className="flex flex-col gap-2.5">
                    {items.map((it) => <ProductCard key={it.product_id} item={it} />)}
                  </div>
                </section>
              </>
            ) : (
              <section className="mt-6 px-4">
                <Notice tone="info" icon="🧁" title="Estamos terminando de publicar el menú">
                  Los sabores, las salsas y las zonas de entrega ya están listos. Los productos
                  con su precio aparecen apenas Operaciones los publique.
                </Notice>
              </section>
            )}

            {data.sabores.length > 0 && <ChipStrip title="Sabores para elegir" items={data.sabores} />}
            {data.salsas.length > 0 && <ChipStrip title="Salsas" items={data.salsas} />}
            {data.zonas.length > 0 && <ZonasList zonas={data.zonas} />}
          </>
        )}

        <Confianza />

        <p className="mt-6 px-6 text-center text-[11px] leading-relaxed text-cocoa">
          Datos en vivo desde <strong className="font-extrabold">{identity.businessName}</strong>. Los precios
          son autoritativos del servidor; el checkout llega en el próximo paso.
        </p>
      </main>
      <BottomBar />
    </div>
  );
}
