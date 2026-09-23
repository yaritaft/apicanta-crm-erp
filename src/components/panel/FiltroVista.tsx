"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Columns3 } from "lucide-react";

/* Cómo se abren las columnas de la tabla: por período, por mes, por
   embudo o por webinar. Mismo aspecto que el selector de fechas, que va
   al lado: son los dos filtros de la vista. */
export function FiltroVista<T extends string>({ valor, opciones, onCambiar }: {
  valor: T;
  opciones: { valor: T; texto: string; ayuda: string }[];
  onCambiar: (v: T) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /* Corrimiento para que el popover no se salga de la pantalla. */
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

  const actual = opciones.find((o) => o.valor === valor) ?? opciones[0];

  return (
    <div ref={raiz} style={{ position: "relative" }} data-flotante-abierto={abierto ? "" : undefined}>
      <button
        type="button" className={`dp-pill${abierto ? " dp-pill--open" : ""}`}
        aria-expanded={abierto} aria-haspopup="listbox" onClick={() => setAbierto((v) => !v)}
        aria-label={`Columnas: ${actual.texto}`} title="Cómo se abren las columnas de la tabla"
      >
        <Columns3 size={14} />
        {actual.texto}
        <span className="dp-caret">▾</span>
      </button>

      {abierto && (
        <div
          ref={pop} className="fw-pop kpis-vista-pop" role="listbox" aria-label="Columnas de la tabla"
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        >
          <div className="kpis-vista-titulo">Columnas</div>
          <div className="fw-lista">
            {opciones.map((o) => {
              const activo = o.valor === valor;
              return (
                <button
                  key={o.valor} type="button" role="option" aria-selected={activo}
                  className="fw-item" aria-pressed={activo}
                  onClick={() => { onCambiar(o.valor); setAbierto(false); }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="fw-titulo">{o.texto}</span>
                    <span className="fw-sub">{o.ayuda}</span>
                  </span>
                  <span className="kpis-vista-check">{activo && <Check size={16} />}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
