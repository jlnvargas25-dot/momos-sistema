import {
  proponerEpisodioHumanizacion, proponerSerieHumanizacion, resolverSenalComunidad,
  revisarEpisodioHumanizacion, revisarSerieHumanizacion, vincularEpisodioHumanizacionPublicacion,
} from "../../lib/rpc";

const OUTCOMES = ["Conexión ganadora", "Prometedora", "Inconclusa", "Agotada", "Descartada"];

export function createAgencyHumanizationHub(shared) {
  const { T, Btn, BtnAsync, Empty, fmt, toast } = shared;
  const chip = (status) => ({
    background: status === "Aprobada" || status === "Aprobado" || status === "Conexión ganadora" ? "#DDEBD9" : "#FFF2D8",
    color: status === "Aprobada" || status === "Aprobado" || status === "Conexión ganadora" ? "#315B35" : "#7A5410",
  });

  return function AgencyHumanizationHub({ db, refrescar }) {
    const memory = db.agencyHumanization;
    const series = memory?.series || [];
    const episodes = memory?.episodes || [];
    const signals = memory?.signals || [];
    const summary = memory?.summary || {};
    const approvedSeries = series.filter((item) => item.status === "Aprobada");
    const seriesById = new Map(series.map((item) => [item.id, item]));
    const episodeById = new Map(episodes.map((item) => [item.id, item]));

    async function createSeries() {
      const name = window.prompt("Nombre de la serie:", "Dulce antojo MOMOS");
      if (!name) return;
      const purpose = window.prompt("Propósito humano y verificable:", "Mostrar rituales reales de antojo y cercanía alrededor de MOMOS.");
      if (!purpose) return;
      const key = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "serie-momos";
      await proponerSerieHumanizacion({
        proposal_key: `ui.series.${crypto.randomUUID()}`, series_key: key, name, purpose,
        protagonist: "Equipo", emotional_territory: "Antojo", mode: "Orgánico", channel: "Instagram",
        source_formula_id: null, editorial_contract: {
          audience: "Personas que buscan un antojo cercano y real", hook: "Un momento cotidiano abre el antojo",
          narrative_formula: "Ritual real, descubrimiento del producto y payoff honesto", ritual: "Abrir, mostrar y probar",
          tone: "Cercano, tierno y espontáneo", format: "Reel vertical 9:16", evidence: "Producto, empaque y reacción reales",
          cta: "Invitar a compartir su figura o sabor favorito", frequency: "Una vez por semana",
          fixed_elements: ["Identidad MOMOS", "Producto real", "Payoff honesto"],
          allowed_variables: ["Figura", "Sabor", "Protagonista", "Locación"],
          restrictions: ["Sin testimonios inventados", "Sin datos personales", "Sin venta forzada"],
        },
      });
      toast("ok", "Serie creada como propuesta; necesita revisión humana"); await refrescar();
    }

    async function reviewSeries(item, status) {
      const note = status === "En revisión"
        ? "La serie entra a revisión de identidad, propósito, evidencia, límites y consentimiento."
        : "Identidad, propósito, tono, evidencia, variables y restricciones fueron revisados por una persona.";
      await revisarSerieHumanizacion(item.id, status, note); toast("ok", `Serie ${status.toLowerCase()}`); await refrescar();
    }

    async function createEpisode(item) {
      const title = window.prompt("Título del episodio:", `${item.name} · episodio ${episodes.filter((episode) => episode.seriesId === item.id).length + 1}`);
      if (!title) return;
      const packText = window.prompt("ID del paquete de producción aprobado con consentimiento (obligatorio para personas):", "");
      const packId = packText ? Number(packText) : null;
      await proponerEpisodioHumanizacion({
        proposal_key: `ui.episode.${crypto.randomUUID()}`, episode_key: `episode-${crypto.randomUUID()}`,
        series_id: item.id, title, story_kind: "Momento de equipo", representation: "Persona real",
        production_pack_id: Number.isInteger(packId) && packId > 0 ? packId : null,
        source_formula_id: item.sourceFormulaId, source_brief_id: null, source_creative_id: null,
        episode_contract: { angle: "Antojo cotidiano y cercano", hook: "Mirá lo que apareció en la bolsa",
          story_arc: "Bolsa, descubrimiento, muestra a cámara y cucharada", proof: "Producto y reacción reales",
          single_variable: "Figura o sabor del episodio", cta: "Preguntar cuál probaría la comunidad",
          synthetic_disclosure: "", privacy_note: "No registrar nombres, rostros o historias sin consentimiento vigente" },
      });
      toast("ok", "Episodio preparado; todavía no puede publicarse"); await refrescar();
    }

    async function reviewEpisode(item, status) {
      const note = status === "En revisión"
        ? "Revisar representación, derechos, consentimiento, paquete, prueba y privacidad del episodio."
        : "Representación, derechos, consentimiento, referencias, prueba y privacidad fueron verificados por una persona.";
      await revisarEpisodioHumanizacion(item.id, status, note); toast("ok", `Episodio ${status.toLowerCase()}`); await refrescar();
    }

    async function linkPost(item) {
      const postId = window.prompt("ID exacto de la publicación ya marcada como Publicada:", "");
      if (!postId) return;
      await vincularEpisodioHumanizacionPublicacion(item.id, postId, "Vínculo humano verificado entre episodio y publicación exacta.");
      toast("ok", "Publicación vinculada; los conectores ya pueden agregar señales"); await refrescar();
    }

    async function decideSignal(item, outcome) {
      const note = window.prompt("Criterio humano de esta conclusión:",
        `Revisé alcance, comentarios significativos, compartidos, guardados, recurrencia y evidencia de dos episodios; clasifico como ${outcome.toLowerCase()}.`);
      if (!note) return;
      await resolverSenalComunidad(item.id, outcome, note); toast("ok", `Señal resuelta como ${outcome}`); await refrescar();
    }

    if (!db.agencyHumanizationReady) return <div className="rounded-2xl border p-5 text-sm font-bold" style={{ borderColor: T.border, background: "#FFF2D8", color: "#7A5410" }}>
      Aplicá <code>humanizacion-comunidad-v1.sql</code> para activar series, episodios y señales comunitarias agregadas.
    </div>;

    return <section aria-label="Humanización y Comunidad MOMOS">
      <div className="rounded-[26px] border overflow-hidden mb-4" style={{ borderColor: T.border, background: "#fff" }}>
        <div className="p-5" style={{ background: "linear-gradient(135deg,#754456,#A85F73)", color: "#fff" }}>
          <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-80">Cercanía verificable · no confianza fabricada</div>
          <div className="display text-xl font-semibold">Humanización y Comunidad</div>
          <div className="text-xs opacity-90 max-w-3xl mt-1">Equipo, comunidad, personajes y producto real se convierten en series repetibles. Codex propone; Biblioteca protege derechos; Meta y TikTok entregan solo señales agregadas; las personas aprueban.</div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 p-3">
          {[["Series", summary.series || 0], ["Activas", summary.approved_series || 0], ["Episodios", summary.episodes || 0], ["Publicados", summary.published_episodes || 0], ["Conexiones", summary.winning_connections || 0]].map(([label, value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF8F5" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: "#A85F73" }}>{fmt(value)}</div></div>)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-2"><div><div className="display text-lg font-semibold">1 · Crear una serie</div><div className="text-[10px]" style={{ color: T.choco2 }}>Territorio, ritual, prueba, variables y límites versionados.</div></div><Btn small onClick={createSeries}>Nueva serie</Btn></div>
      {series.length ? <div className="grid lg:grid-cols-2 gap-3 mb-5">{series.map((item) => <article key={item.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
        <div className="flex justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#A85F73" }}>{item.protagonist} · {item.emotionalTerritory} · v{item.version}</div><div className="font-extrabold">{item.name}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{item.purpose}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold h-fit" style={chip(item.status)}>{item.status}</span></div>
        <div className="flex flex-wrap gap-2 mt-3">{item.status === "Propuesta" && <BtnAsync small onClick={() => reviewSeries(item, "En revisión")}>Revisar</BtnAsync>}{item.status === "En revisión" && <BtnAsync small onClick={() => reviewSeries(item, "Aprobada")}>Aprobar serie</BtnAsync>}{item.status === "Aprobada" && <Btn small kind="ghost" onClick={() => createEpisode(item)}>Preparar episodio</Btn>}</div>
      </article>)}</div> : <div className="mb-5"><Empty icon="♡" text="Creá la primera serie o pedile a Codex que proponga una desde el MCP." /></div>}

      <div className="display text-lg font-semibold mb-2">2 · Preparar episodios y consentimiento</div>
      {episodes.length ? <div className="space-y-3 mb-5">{episodes.map((item) => <article key={item.id} className="rounded-2xl border p-4" style={{ borderColor: item.packReadiness.ready ? T.border : "#E6B7AE", background: "#fff" }}>
        <div className="flex justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{seriesById.get(item.seriesId)?.name || `Serie ${item.seriesId}`} · {item.representation}</div><div className="font-extrabold">{item.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{item.storyKind} · {item.episodeContract.single_variable}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold h-fit" style={chip(item.status)}>{item.status}</span></div>
        {!item.packReadiness.ready && <div className="rounded-xl px-3 py-2 text-[10px] font-bold mt-3" style={{ background: "#FFF2D8", color: "#7A5410" }}>{item.packReadiness.reasons[0]}</div>}
        <div className="flex flex-wrap gap-2 mt-3">{item.status === "Propuesta" && <BtnAsync small onClick={() => reviewEpisode(item, "En revisión")}>Revisar episodio</BtnAsync>}{item.status === "En revisión" && <BtnAsync small disabled={!item.packReadiness.ready} onClick={() => reviewEpisode(item, "Aprobado")}>Aprobar episodio</BtnAsync>}{item.status === "Aprobado" && !item.postId && <Btn small kind="ghost" onClick={() => linkPost(item)}>Vincular publicación</Btn>}{item.postId && <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Publicación {item.postId}</span>}</div>
      </article>)}</div> : <div className="mb-5"><Empty icon="◌" text={approvedSeries.length ? "Prepará el primer episodio desde una serie aprobada." : "Primero aprobá una serie editorial."} /></div>}

      <div className="display text-lg font-semibold mb-2">3 · Escuchar a la comunidad y aprender</div>
      {signals.length ? <div className="space-y-3">{signals.map((item) => <article key={item.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
        <div className="flex justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#A85F73" }}>{item.platform} · {item.windowStart} → {item.windowEnd}</div><div className="font-extrabold">{episodeById.get(item.episodeId)?.title || `Episodio ${item.episodeId}`}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Solo agregados; ningún comentario, perfil o mensaje cruza a Agencia.</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold h-fit" style={chip(item.outcome)}>{item.outcome}</span></div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 my-3">{[["Alcance", item.reach], ["Significativos", item.meaningfulComments], ["Compartidos", item.shares], ["Guardados", item.saves], ["Señales", item.connectionSignals]].map(([label, value]) => <div key={label} className="rounded-xl p-2.5" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="font-extrabold">{fmt(value)}</div></div>)}</div>
        {item.outcome === "En revisión" && <div className="flex flex-wrap gap-2">{OUTCOMES.map((outcome) => <BtnAsync key={outcome} small kind={outcome === "Conexión ganadora" ? "primary" : "ghost"} onClick={() => decideSignal(item, outcome)}>{outcome}</BtnAsync>)}</div>}
      </article>)}</div> : <Empty icon="◎" text="Cuando un episodio aprobado se publique, Meta o TikTok podrán enviar conteos y temas agregados; nunca texto crudo." />}
    </section>;
  };
}
