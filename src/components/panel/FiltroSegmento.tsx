"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Filter, Search } from "lucide-react";
import { Input } from "@/components/ui/ui";
import { truncar } from "@/components/charts/charts";
import { diaCorto } from "@/components/webinars/fechas";
import type { Embudo, Webinar } from "@/lib/types";
import type { FiltroKpi } from "@/lib/kpis";

/* Qué parte del negocio mira el Dashboard: todo, un embudo o un webinar.
   Es aparte de las columnas (por día o por mes): así se puede ver un
   webinar día por día. Elegir un webinar ya dice el embudo, así que los
   dos no se combinan: se elige uno u otro. */
export function FiltroSegmento({ filtro, embudos, webinars, onCambiar }: {
  filtro: FiltroKpi;
  embudos: Embudo[];
  webinars: Webinar[];
  onCambiar: (f: FiltroKpi) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);

  useLayoutEffect(() => {
    if (!abierto) { setDx(0); return; }
    const r = pop.current?.getBoundingClientRect();
    if (!r) return;
    if (r.right > window.innerWidth - 8) setDx(window.innerWidth - 8 - r.right);
    else if (r.left < 8) setDx(8 - r.left);
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const clicAfuera = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAbierto(false);
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", clicAfuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", clicAfuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? webinars.filter((w) => (w.titulo ?? "").toLowerCase().includes(t) || diaCorto(w.fecha).includes(t)) : webinars;
  }, [webinars, q]);

  const webinar = filtro.webinarId ? webinars.find((w) => w.id === filtro.webinarId) : undefined;
  const embudo = filtro.embudoId ? embudos.find((x) => x.id === filtro.embudoId) : undefined;
  const texto = webinar
    ? truncar(webinar.titulo || "Webinar", 16)
    : embudo ? embudo.nombre : "Todo el negocio";
  const elegir = (f: FiltroKpi) => { onCambiar(f); setAbierto(false); setQ(""); };

  const Opcion = ({ activo, titulo, sub, onClick }: { activo: boolean; titulo: string; sub?: string; onClick: () => void }) => (
    <button type="button" role="option" aria-selected={activo} aria-pressed={activo} className="fw-item" onClick={onClick}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="fw-titulo">{titulo}</span>
        {sub && <span className="fw-sub">{sub}</span>}
      </span>
      <span className="kpis-vista-check">{activo && <Check size={16} />}</span>
    </button>
  );

  return (
    <div ref={raiz} style={{ position: "relative" }} data-flotante-abierto={abierto ? "" : undefined}>
      <button
        type="button" className={`dp-pill${abierto ? " dp-pill--open" : ""}${webinar || embudo ? " kpis-comparar--on" : ""}`}
        aria-expanded={abierto} aria-haspopup="listbox" onClick={() => setAbierto((v) => !v)}
        title={webinar ? webinar.titulo : "Qué parte del negocio se mira: todo, un embudo o un webinar"}
      >
        <Filter size={14} />
        {texto}
        <span className="dp-caret">▾</span>
      </button>

      {abierto && (
        <div
          ref={pop} className="fw-pop kpis-vista-pop kpis-segmento-pop" role="listbox" aria-label="Qué parte del negocio"
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        >
          <div className="fw-lista kpis-segmento-lista">
            <Opcion activo={!webinar && !embudo} titulo="Todo el negocio" sub="Sin filtro: todas las ventas, gastos y agendas" onClick={() => elegir({})} />

            <div className="kpis-vista-titulo">Embudo</div>
            {embudos.map((x) => (
              <Opcion key={x.id} activo={filtro.embudoId === x.id} titulo={x.nombre} onClick={() => elegir({ embudoId: x.id })} />
            ))}

            <div className="kpis-vista-titulo">Webinar</div>
            {webinars.length > 6 && (
              <div className="kpis-segmento-busca">
                <Input
                  icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)}
                  placeholder="Buscá por título o fecha" aria-label="Buscar webinar"
                />
              </div>
            )}
            {visibles.length === 0 && <p className="t-sm t-subtle" style={{ padding: "8px" }}>Ningún webinar se llama así.</p>}
            {visibles.map((w) => (
              <Opcion
                key={w.id} activo={filtro.webinarId === w.id} titulo={w.titulo || "Sin título"} sub={diaCorto(w.fecha)}
                onClick={() => elegir({ webinarId: w.id })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
