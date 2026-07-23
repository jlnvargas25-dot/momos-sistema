import { MomosLogo, identity } from "@momos/brand";

/*
  Pide MOMOS — pantalla inicial (mobile-first).

  Slice visual: prueba que la biblioteca de marca (paleta, tipografía, logo)
  vive y respira en el app público. El catálogo y el checkout reales se
  conectan en el próximo paso contra la API pública de Pide (P01–P04).
  Los productos de acá abajo son muestra estática, NO vienen del backend.
*/

// Logo oficial (brand_media_assets id 104 · "LOGO PRINCIPAL"). PNG con fondo
// transparente derivado del JPEG gobernado (flood-fill desde los bordes +
// recorte del padding), para que sobre la crema quede SOLO el logo, sin recuadro.
const LOGO = "/brand/momos-logo.png";

const money = (cop) => "$" + cop.toLocaleString("es-CO");

const CATEGORIAS = ["Momos", "Crepas", "Malteadas", "Antojos", "Bebidas"];

const DESTACADOS = [
  { id: "PR10", nombre: "Crepa Momo Oreo", desc: "Crema de Oreo y galleta triturada.", precio: 14000, emoji: "🥞" },
  { id: "PR11", nombre: "Malteada Oreo", desc: "Cremosa, con crema batida.", precio: 13000, emoji: "🥤" },
  { id: "PR12", nombre: "Malteada Nutella", desc: "Nutella, crema y chocolate rallado.", precio: 13500, emoji: "🍫" },
];

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

function Hero() {
  return (
    <section className="px-4 pt-5">
      <div className="relative overflow-hidden rounded-momo-lg bg-surface p-6 shadow-momo">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-rosa"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-vainilla"
        />
        <div className="relative">
          <p className="text-sm font-bold text-cocoa">Hola 👋 bienvenido a</p>
          <h1 className="mt-1 font-display text-[2rem] font-bold leading-[1.1] text-choco">
            Antojáte algo tierno.
          </h1>
          <p className="mt-2 max-w-[22rem] text-sm text-cocoa">{identity.positioning}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              className="inline-flex h-11 items-center rounded-full bg-coral px-6 text-sm font-extrabold text-white shadow-soft transition-transform active:scale-95"
            >
              Ver el menú
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-extrabold text-choco transition-transform active:scale-95"
            >
              ¿Cómo pedir?
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Categorias() {
  return (
    <nav aria-label="Categorías" className="mt-6">
      <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIAS.map((cat, i) => (
          <button
            key={cat}
            type="button"
            aria-current={i === 0 ? "true" : undefined}
            className={
              "h-9 shrink-0 rounded-full px-4 text-sm font-bold transition-colors " +
              (i === 0
                ? "bg-choco text-crema"
                : "bg-surface text-cocoa shadow-soft")
            }
          >
            {cat}
          </button>
        ))}
      </div>
    </nav>
  );
}

function ProductCard({ item }) {
  return (
    <article className="flex items-center gap-3 rounded-momo bg-surface p-3 shadow-soft">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-coral-soft text-3xl">
        <span aria-hidden="true">{item.emoji}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-base font-semibold text-choco">{item.nombre}</h3>
        <p className="truncate text-xs text-cocoa">{item.desc}</p>
        <p className="mt-1 text-sm font-extrabold text-choco">{money(item.precio)}</p>
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

function Destacados() {
  return (
    <section className="mt-6 px-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold text-choco">Los más pedidos</h2>
        <span className="text-xs font-bold text-rosa-deep">Muestra visual</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {DESTACADOS.map((item) => (
          <ProductCard key={item.id} item={item} />
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
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <Header />
      <main className="flex-1 pb-2">
        <Hero />
        <Categorias />
        <Destacados />
        <Confianza />
        <p className="mt-6 px-6 text-center text-[11px] leading-relaxed text-cocoa">
          Vista inicial de <strong className="font-extrabold">{identity.businessName}</strong>. El catálogo real
          y el checkout se conectan en el próximo paso contra la API pública de Pide.
        </p>
      </main>
      <BottomBar />
    </div>
  );
}
