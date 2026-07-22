import { useMemo } from "react";
import {
  autorizarGeneracionDesdePreflight, medirFormulaCreativa, resolverMedicionFormulaCreativa, revisarFormulaCreativa,
  revisarPlanProduccionFormula,
} from "../../lib/rpc";

const OUTCOMES = ["Ganadora", "Prometedora", "Inconclusa", "Agotada", "Descartada"];

export function createAgencyFormulaLab(shared) {
  const { T, BtnAsync, Empty, fmt, hoyISO, toast } = shared;

  const money = (value) => `$${fmt(Math.round(Number(value || 0)))}`;
  const ratio = (value) => value == null ? "—" : `${Number(value).toFixed(2)}×`;

  function lastSevenDays() {
    const end = hoyISO();
    const startDate = new Date(`${end}T12:00:00`);
    startDate.setDate(startDate.getDate() - 6);
    return { start: startDate.toISOString().slice(0, 10), end };
  }

  return function AgencyFormulaLab({ db, refrescar }) {
    const intelligence = db.agencyCreativeIntelligence;
    const formulas = intelligence?.formulas || [];
    const measurements = intelligence?.measurements || [];
    const formulaById = useMemo(() => new Map(formulas.map((formula) => [formula.id, formula])), [formulas]);
    const summary = intelligence?.summary || {};
    const productionPreflight = db.agencyProductionPreflight;
    const productionPlans = productionPreflight?.plans || [];
    const generationAuthorizations = db.agencyGenerationAuthorizations?.authorizations || [];
    const generationByPlan = useMemo(() => new Map(
      generationAuthorizations.map((authorization) => [authorization.planId, authorization]),
    ), [generationAuthorizations]);

    async function review(formula, status) {
      const note = status === "En revisión"
        ? "La fórmula entra a revisión humana de identidad, evidencia y reutilización."
        : "Identidad, producto, estructura, evidencia y capacidad de reutilización fueron verificados.";
      await revisarFormulaCreativa(formula.id, status, note);
      toast("ok", status === "Aprobada" ? "Fórmula aprobada y lista para medir" : "Fórmula enviada a revisión");
      await refrescar();
    }

    async function measure(formula) {
      const window = lastSevenDays();
      const platform = formula.channel === "TikTok" ? "TikTok" : "Meta";
      await medirFormulaCreativa({
        measurement_key: `ui:${formula.id}:${platform.toLowerCase()}:${window.start}:${window.end}:${crypto.randomUUID()}`,
        formula_id: formula.id, platform, window_start: window.start, window_end: window.end,
      });
      toast("ok", `Medición ${platform} creada con verdad comercial de MOMO OPS`);
      await refrescar();
    }

    async function decide(measurement, outcome) {
      const defaultNote = outcome === "Ganadora"
        ? "Revisé muestra, atribución, ventas pagadas, ROAS interno y retorno sobre margen; apruebo este aprendizaje."
        : `Revisé muestra, atribución y retornos separados; clasifico la medición como ${outcome.toLowerCase()}.`;
      const note = window.prompt("Documentá el criterio humano de esta decisión:", defaultNote);
      if (note == null) return;
      await resolverMedicionFormulaCreativa(measurement.id, outcome, note);
      toast("ok", `Aprendizaje sellado como ${outcome}`);
      await refrescar();
    }

    async function reviewProductionPlan(plan, status) {
      const defaultNote = status === "En revisión"
        ? "El equipo revisará fórmula, activos, formato, derechos, motor y costo máximo antes de aprobar."
        : "Fórmula, activos, canal, formato, derechos y costo máximo fueron revisados por el equipo.";
      const note = window.prompt("Documentá el criterio humano de esta decisión:", defaultNote);
      if (note == null) return;
      await revisarPlanProduccionFormula(plan.id, status, note);
      toast("ok", status === "Aprobado" ? "Preflight aprobado sin consumir créditos" : "Preflight enviado a revisión");
      await refrescar();
    }

    async function authorizeGeneration(plan) {
      const confirmed = window.confirm(
        `Vas a autorizar una generación externa en ${plan.provider} con tope de ${money(plan.maxCostCop)}.\n\n`
        + "El worker podrá reclamar el trabajo y consumir créditos. La publicación seguirá bloqueada. ¿Continuar?",
      );
      if (!confirmed) return;
      const note = window.prompt(
        "Documentá por qué este preflight está listo para consumir créditos:",
        "Revisé fórmula, producto, referencias, marca, formato, motor y tope de costo; autorizo generar sin publicar.",
      );
      if (note == null) return;
      const result = await autorizarGeneracionDesdePreflight({
        authorization_key: `ui.h108.plan.${plan.id}`,
        plan_id: plan.id,
        decision_note: note,
        acknowledge_external_generation: true,
      });
      toast("ok", `Trabajo #${result.job_id} autorizado para ${plan.provider}; publicación bloqueada`);
      await refrescar();
    }

    if (!db.agencyCreativeIntelligenceReady) return <div className="rounded-2xl border p-5 text-sm font-bold" style={{ borderColor: T.border, background: "#FFF2D8", color: "#7A5410" }}>
      Aplicá <code>inteligencia-creativa-publicitaria-v1.sql</code> para activar fórmulas ganadoras y memoria para Codex.
    </div>;

    return <section aria-label="Laboratorio de fórmulas creativas">
      <div className="rounded-[26px] border overflow-hidden mb-4" style={{ borderColor: T.border, background: T.surface }}>
        <div className="p-4 sm:p-5" style={{ background: "linear-gradient(135deg,#4A3028,#704334)", color: "#fff" }}>
          <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-75">Memoria creativa · Codex + MOMO OPS</div>
          <div className="display text-xl font-semibold">Laboratorio de fórmulas ganadoras</div>
          <div className="text-xs opacity-85 max-w-3xl mt-1">Codex propone variaciones; el equipo aprueba; Meta y TikTok aportan señal; MOMO OPS conserva ventas y margen reales. Atribución nunca se presenta como causalidad.</div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 p-3">
          {[["Fórmulas",summary.formulas || 0],["Aprobadas",summary.approved || 0],["Por revisar",summary.pending_review || 0],["Mediciones",summary.measurements || 0],["Ganadoras",summary.winners || 0]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F1" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div></div>)}
        </div>
      </div>

      <div className="display text-lg font-semibold mb-2">Fórmulas versionadas</div>
      {formulas.length ? <div className="grid lg:grid-cols-2 gap-3 mb-5">{formulas.map((formula) => <article key={formula.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{formula.mode} · {formula.channel} · v{formula.version}</div><div className="display text-base font-semibold">{formula.name}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{formula.figure || "Multifigura"}{formula.flavor ? ` · ${formula.flavor}` : ""} · creativo {formula.sourceCreativeId}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: formula.status === "Aprobada" ? "#DDEBD9" : "#FFF2D8", color: formula.status === "Aprobada" ? "#315B35" : "#7A5410" }}>{formula.status}</span></div>
        <div className="grid sm:grid-cols-2 gap-2 my-3 text-[10px]">{[["Hook",formula.formula.hook],["Estructura",formula.formula.narrative_structure],["Humanización",formula.formula.humanization],["Prueba",formula.formula.proof]].map(([label,value]) => <div key={label} className="rounded-xl p-2.5" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="font-semibold mt-0.5">{value || "—"}</div></div>)}</div>
        <div className="flex flex-wrap gap-2">{formula.status === "Propuesta" && <BtnAsync small onClick={() => review(formula,"En revisión")}>Enviar a revisión</BtnAsync>}{formula.status === "En revisión" && <BtnAsync small onClick={() => review(formula,"Aprobada")}>Aprobar fórmula</BtnAsync>}{formula.status === "Aprobada" && <BtnAsync small onClick={() => measure(formula)}>Medir últimos 7 días</BtnAsync>}</div>
      </article>)}</div> : <div className="mb-5"><Empty icon="✦" text="Codex puede proponer la primera fórmula desde el MCP; aparecerá aquí como propuesta, nunca aprobada automáticamente." /></div>}

      {db.agencyProductionPreflightReady && <>
        <div className="flex items-end justify-between gap-3 mb-2"><div><div className="display text-lg font-semibold">Listos para producir</div><div className="text-[10px]" style={{ color: T.choco2 }}>Cada tarjeta une una fórmula aprobada con referencias visuales verificadas. Aprobar no genera, no consume créditos y no publica.</div></div><span className="rounded-full px-3 py-1 text-[9px] font-extrabold" style={{ background: "#F8EFE4", color: T.choco2 }}>{productionPlans.length} preflight</span></div>
        {productionPlans.length ? <div className="grid lg:grid-cols-2 gap-3 mb-5">{productionPlans.map((plan) => { const authorization = generationByPlan.get(plan.id); return <article key={plan.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
          <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{plan.provider} · {plan.operation} · v{plan.version}</div><div className="display text-base font-semibold">Fórmula #{plan.formulaId} + paquete #{plan.productionPackId}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{plan.channel} · {plan.targetFormat} · {plan.durationSeconds ? `${plan.durationSeconds} s` : "imagen"}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: plan.status === "Aprobado" ? "#DDEBD9" : "#FFF2D8", color: plan.status === "Aprobado" ? "#315B35" : "#7A5410" }}>{plan.status}</span></div>
          <div className="grid grid-cols-2 gap-2 my-3 text-[10px]"><div className="rounded-xl p-2.5" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Motor</div><div className="font-semibold">{plan.modelLabel}</div></div><div className="rounded-xl p-2.5" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Tope protegido</div><div className="font-semibold">{money(plan.maxCostCop)}</div></div></div>
          <div className="rounded-xl p-2.5 mb-3 text-[10px] font-bold" style={{ background: authorization ? "#FFF2D8" : "#E4F0E1", color: authorization ? "#7A5410" : "#315B35" }}>{authorization
            ? `Trabajo #${authorization.jobId} · ${authorization.jobStatus} · el worker puede generar · publicación bloqueada`
            : "✓ 0 créditos consumidos · 0 trabajos creados · publicación bloqueada"}</div>
          <div className="flex flex-wrap gap-2">{plan.status === "Preparado" && <BtnAsync small onClick={() => reviewProductionPlan(plan,"En revisión")}>Enviar a revisión</BtnAsync>}{plan.status === "En revisión" && <BtnAsync small onClick={() => reviewProductionPlan(plan,"Aprobado")}>Aprobar preflight</BtnAsync>}{plan.status === "Aprobado" && !authorization && db.agencyGenerationAuthorizationReady && <BtnAsync small onClick={() => authorizeGeneration(plan)}>Autorizar generación</BtnAsync>}</div>
        </article>; })}</div> : <div className="mb-5"><Empty icon="🎬" text="Cuando Codex una una fórmula aprobada con un paquete visual aprobado, el preflight aparecerá aquí para decisión humana." /></div>}
      </>}

      <div className="display text-lg font-semibold mb-2">Mediciones y decisión humana</div>
      {measurements.length ? <div className="space-y-3">{measurements.map((measurement) => { const formula = formulaById.get(measurement.formulaId); return <article key={measurement.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{measurement.platform} · {measurement.windowStart} → {measurement.windowEnd}</div><div className="font-extrabold">{formula?.name || `Fórmula #${measurement.formulaId}`}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{measurement.attributionStatus} · {measurement.internalPaidOrders} pedidos pagados</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: measurement.outcome === "Ganadora" ? "#DDEBD9" : "#E5EEF7", color: measurement.outcome === "Ganadora" ? "#315B35" : "#315A7D" }}>{measurement.outcome}</span></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 my-3">{[["Gasto",money(measurement.spend)],["ROAS plataforma",ratio(measurement.platformRoas)],["ROAS interno",ratio(measurement.internalRoas)],["Retorno margen",ratio(measurement.contributionReturn)]].map(([label,value]) => <div key={label} className="rounded-xl p-2.5" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="font-extrabold">{value}</div></div>)}</div>
        {measurement.platformRoas == null && <div className="text-[10px] font-bold mb-3" style={{ color: "#7A5410" }}>La plataforma todavía no entregó ingreso atribuido para esta ventana. MOMO OPS conserva el ROAS interno sin fabricar el dato faltante.</div>}
        {measurement.outcome === "En revisión" && <div className="flex flex-wrap gap-2">{OUTCOMES.map((outcome) => <BtnAsync key={outcome} small kind={outcome === "Ganadora" ? "primary" : "ghost"} onClick={() => decide(measurement,outcome)}>{outcome}</BtnAsync>)}</div>}
      </article>; })}</div> : <Empty icon="◎" text="Todavía no hay mediciones selladas para las fórmulas aprobadas." />}
    </section>;
  };
}
