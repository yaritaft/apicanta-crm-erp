"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { calcular, opcionesDeCalculo, SIN_CALCULO, type ColumnaForm } from "@/lib/formularios-tabla";
import type { RegistroForm } from "@/lib/registros-webinar";
import "./formularios.css";

/* ==================================================================
   El pie de una columna, como el «Calcular» de Notion: debajo de cada
   columna se lee un número sobre las filas que se ven con los filtros
   puestos (cuántas tienen teléfono, cuántas están unidas…), y con un clic
   se cambia por otro cálculo. Cada columna arranca con el suyo; lo elegido
   viaja en el link (lib/formularios-tabla: calculosAURL).
   ================================================================== */

export function PieCalculo({ col, filas, calculo, onCambiar }: {
  col: ColumnaForm; filas: readonly RegistroForm[]; calculo: string; onCambiar: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const r = useMemo(() => calcular(col, filas, calculo), [col, filas, calculo]);
  return (
    <>
      <button
        ref={boton} type="button" className="fm-pie" data-vacio={!r || undefined} aria-haspopup="menu" aria-expanded={abierto}
        title={`Qué calcular debajo de «${col.titulo}»`} onClick={(ev) => { ev.stopPropagation(); setAbierto((v) => !v); }}
      >
        {r ? (
          <>
            <span className="fm-pie__etq">{r.etiqueta}</span>
            <span className="fm-pie__valor t-num">{r.valor}</span>
            {r.sub && <span className="fm-pie__sub t-num">{r.sub}</span>}
          </>
        ) : <span className="fm-pie__etq">Calcular</span>}
        <ChevronDown size={12} className="fm-pie__flecha" aria-hidden />
      </button>
      {abierto && boton.current && (
        <MenuCalculo ancla={boton.current} col={col} actual={calculo} onElegir={(id) => { onCambiar(id); setAbierto(false); }} onCerrar={() => setAbierto(false)} />
      )}
    </>
  );
}

function MenuCalculo({ ancla, col, actual, onElegir, onCerrar }: {
  ancla: HTMLElement; col: ColumnaForm; actual: string; onElegir: (id: string) => void; onCerrar: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  const opciones = useMemo(() => opcionesDeCalculo(col), [col]);

  /* Arriba del pie (está pegado al borde de abajo), sin salirse de la pantalla; si la tabla se mueve, lo sigue. */
  const ubicar = useCallback(() => {
    const r = ancla.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { onCerrar(); return; }
    const ancho = 230;
    setPos({ bottom: window.innerHeight - r.top + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) });
  }, [ancla, onCerrar]);
  useLayoutEffect(() => { ubicar(); }, [ubicar]);

  useEffect(() => {
    const fuera = (ev: MouseEvent) => { const t = ev.target as Node; if (!menu.current?.contains(t) && !ancla.contains(t)) onCerrar(); };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); onCerrar(); ancla.focus(); } };
    const mover = (ev: Event) => { if (!menu.current?.contains(ev.target as Node)) ubicar(); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla, true);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla, true);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [ancla, onCerrar, ubicar]);

  if (!pos) return null;
  return createPortal(
    <div ref={menu} className="fm-pie-menu" role="menu" aria-label={`Calcular debajo de ${col.titulo}`} style={{ bottom: pos.bottom, left: pos.left }}>
      <div className="fm-pie-menu__titulo t-label">Calcular · {col.titulo}</div>
      {opciones.map((o, i) => (
        <React.Fragment key={o.id}>
          {/* Los valores que tiene la columna (Unido, No unido…) van aparte de los cálculos generales. */}
          {o.id.startsWith("valor:") && !opciones[i - 1]?.id.startsWith("valor:") && <div className="fm-pie-menu__sep" role="separator" />}
          <button type="button" role="menuitemradio" aria-checked={o.id === actual} className="fm-pie-menu__item" data-activo={o.id === actual || undefined} onClick={() => onElegir(o.id)}>
            <span className="fm-pie-menu__check">{o.id === actual && <Check size={14} aria-hidden />}</span>
            <span>{o.id.startsWith("valor:") ? `Contar «${o.texto}»` : o.texto}</span>
          </button>
        </React.Fragment>
      ))}
      {actual === SIN_CALCULO && <p className="fm-pie-menu__nota t-sm t-subtle">Esta columna no calcula nada.</p>}
    </div>,
    document.body,
  );
}
