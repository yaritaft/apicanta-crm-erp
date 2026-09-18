"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "./ui";

export function Modal({ abierto, onCerrar, titulo, sub, children, pie, ancho }: {
  abierto: boolean; onCerrar: () => void; titulo: string; sub?: string;
  children: React.ReactNode; pie?: React.ReactNode; ancho?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      const foco = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
      foco?.focus();
    }, 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`modal${ancho ? " modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <div className="modal__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="modal__title">{titulo}</h3>
            {sub && <p className="modal__sub">{sub}</p>}
          </div>
          <IconButton etiqueta="Cerrar" onClick={onCerrar}><X size={18} /></IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {pie && <div className="modal__foot">{pie}</div>}
      </div>
    </div>
  );
}

/* Formulario dentro de un modal: Enter guarda, Esc cierra. */
export function ModalForm({ abierto, onCerrar, onGuardar, titulo, sub, children, guardarTexto = "Guardar", ancho, puedeGuardar = true }: {
  abierto: boolean; onCerrar: () => void; onGuardar: () => void;
  titulo: string; sub?: string; children: React.ReactNode;
  guardarTexto?: string; ancho?: boolean; puedeGuardar?: boolean;
}) {
  const submit = useCallback((e: React.FormEvent) => { e.preventDefault(); if (puedeGuardar) onGuardar(); }, [onGuardar, puedeGuardar]);
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={titulo} sub={sub} ancho={ancho}>
      <form onSubmit={submit} style={{ display: "contents" }}>
        {children}
        <div className="modal__foot" style={{ margin: "calc(var(--space-5) * -1)", marginTop: 4 }}>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button variante="primary" type="submit" disabled={!puedeGuardar}>{guardarTexto}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Confirmar({ abierto, onCerrar, onConfirmar, titulo, texto, confirmarTexto = "Eliminar" }: {
  abierto: boolean; onCerrar: () => void; onConfirmar: () => void;
  titulo: string; texto: string; confirmarTexto?: string;
}) {
  return (
    <Modal
      abierto={abierto} onCerrar={onCerrar} titulo={titulo}
      pie={
        <>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button variante="danger" onClick={() => { onConfirmar(); onCerrar(); }}>{confirmarTexto}</Button>
        </>
      }
    >
      <p className="t-body t-muted">{texto}</p>
    </Modal>
  );
}
