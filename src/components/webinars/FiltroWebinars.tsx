"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Video } from "lucide-react";
import { Input } from "@/components/ui/ui";
import { truncar } from "@/components/charts/charts";
import { diaCorto } from "./fechas";
import type { Webinar } from "@/lib/types";

/* Elegir uno o varios webinars, con buscador: "el de la semana pasada y
   el anterior", para compararlos sin ver el resto. Mismo aspecto que el
   selector de fechas y el de columnas, que están al lado. */
export function FiltroWebinars({ webinars, elegidos, onCambiar, fuera }: {
  webinars: Webinar[];
  elegidos: string[];
  onCambiar: (ids: string[]) => void;
  /* Los que el período elegido deja afuera: se pueden elegir igual, pero se
     avisa, porque si no la tabla quedaría vacía sin explicación. */
  fuera: Set<string>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /* Corrimiento para que el popover no se salga de la pantalla: en el
     celular el botón puede quedar en cualquier lado de la fila. */
  const [dx, setDx] = useState(0);

  useLayoutEffect(() => {
    if (!abierto) { setDx(0); return; }
    const r = pop.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = window.innerWidth;
    if (r.left < 8) setDx(8 - r.left);
    else if (r.right > ancho - 8) setDx(ancho - 8 - r.right);
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

  const ordenados = useMemo(
    () => [...webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)),
    [webinars],
  );
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? ordenados.filter((w) => (w.titulo ?? "").toLowerCase().includes(t) || diaCorto(w.fecha).includes(t)) : ordenados;
  }, [ordenados, q]);

  const texto = elegidos.length === 0
    ? "Todos los webinars"
    : elegidos.length === 1
      ? truncar(webinars.find((w) => w.id === elegidos[0])?.titulo ?? "1 webinar", 30)
      : `${elegidos.length} webinars`;

  function alternar(id: string) {
    onCambiar(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
  }

  return (
    <div ref={raiz} style={{ position: "relative" }} data-flotante-abierto={abierto ? "" : undefined}>
      <button
        type="button" className={`dp-pill${abierto ? " dp-pill--open" : ""}`}
        aria-expanded={abierto} aria-haspopup="dialog" onClick={() => setAbierto((v) => !v)}
      >
        <Video size={14} />
        {texto}
        <span className="dp-caret">▾</span>
      </button>

      {abierto && (
        <div
          ref={pop} className="fw-pop" role="dialog" aria-label="Elegir webinars"
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        >
          <div className="fw-busca">
            <Input
              icono={<Search size={16} />} value={q} autoFocus
              onChange={(ev) => setQ(ev.target.value)} placeholder="Buscá por título o fecha"
              aria-label="Buscar webinar"
            />
          </div>
          <div className="fw-lista">
            {visibles.length === 0 && <p className="t-sm t-subtle" style={{ padding: "12px 8px" }}>Ningún webinar se llama así.</p>}
            {visibles.map((w) => {
              const activo = elegidos.includes(w.id);
              return (
                <button
                  key={w.id} type="button" className="fw-item" aria-pressed={activo}
                  onClick={() => alternar(w.id)}
                >
                  <span className="fw-check">{activo && <Check size={12} />}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="fw-titulo">{w.titulo || "Sin título"}</span>
                    <span className="fw-sub">
                      {diaCorto(w.fecha)}{fuera.has(w.id) ? " · fuera del período elegido" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="fw-pie">
            <span className="t-sm t-subtle">
              {elegidos.length === 0 ? "Se ven todos" : `${elegidos.length} elegido${elegidos.length === 1 ? "" : "s"}`}
            </span>
            <span className="spacer" />
            {elegidos.length > 0 && (
              <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => onCambiar([])}>Ver todos</button>
            )}
            <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" onClick={() => setAbierto(false)}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}
