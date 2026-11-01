"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/ui";

/* Lo que se usa una vez por mes no compite con lo de todos los días: va adentro de «Más». */
export interface AccionMas { texto: string; icono: React.ReactNode; onClick: () => void; title?: string }

const ANCHO = 220;

export function MenuMas({ acciones }: { acciones: AccionMas[] }) {
  const boton = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cerrar = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const fuera = (ev: MouseEvent) => {
      const donde = ev.target as Node;
      if (!menu.current?.contains(donde) && !boton.current?.contains(donde)) cerrar();
    };
    document.addEventListener("mousedown", fuera);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [pos, cerrar]);

  if (acciones.length === 0) return null;

  function onTecla(ev: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (ev.key === "Escape" || ev.key === "Tab") { cerrar(); boton.current?.querySelector("button")?.focus(); }
  }

  return (
    <>
      <span ref={boton}>
        <Button
          sm variante="ghost" icono={<MoreHorizontal size={15} />} aria-haspopup="menu" aria-expanded={Boolean(pos)}
          onClick={() => {
            if (pos) { cerrar(); return; }
            const r = boton.current?.getBoundingClientRect();
            if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - ANCHO) });
          }}
        >
          Más
        </Button>
      </span>
      {pos && createPortal(
        <div ref={menu} role="menu" aria-label="Más acciones" className="alu-menu" data-flotante-abierto="" style={{ top: pos.top, left: pos.left, width: ANCHO }} onKeyDown={onTecla}>
          {acciones.map((a) => (
            <button key={a.texto} type="button" role="menuitem" className="alu-menu__item" title={a.title} onClick={() => { cerrar(); a.onClick(); }}>
              {a.icono}<span className="truncate" style={{ flex: 1, minWidth: 0 }}>{a.texto}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
