"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui";

export function Drawer({ abierto, onCerrar, titulo, sub, children, pie, cabecera }: {
  abierto: boolean; onCerrar: () => void; titulo: string; sub?: string;
  children: React.ReactNode; pie?: React.ReactNode; cabecera?: React.ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onCerrar} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="drawer__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            {cabecera ?? (
              <>
                <h2 className="t-h2 truncate">{titulo}</h2>
                {sub && <p className="t-sm t-subtle" style={{ marginTop: 2 }}>{sub}</p>}
              </>
            )}
          </div>
          <IconButton etiqueta="Cerrar" onClick={onCerrar}><X size={18} /></IconButton>
        </div>
        <div className="drawer__body">{children}</div>
        {pie && <div className="drawer__foot">{pie}</div>}
      </aside>
    </>
  );
}

export function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </>
  );
}
