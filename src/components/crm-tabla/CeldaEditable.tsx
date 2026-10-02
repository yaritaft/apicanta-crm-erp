"use client";

import React, { useId, useRef, useState } from "react";
import { EditorTextoLargo, SelectorOpciones } from "@/components/crm/Editores";
import type { EditorColumna } from "@/lib/crm-tabla";
import type { OpcionCrm } from "@/lib/types";

/* ==================================================================
   Una celda que se corrige en el lugar, como en un Excel: un clic la
   abre, Enter o salir de la celda guarda y Esc deja lo que estaba.

   - texto, fecha, lista (varias, separadas por coma) y sugerencias (un
     texto libre con los valores que ya existen para elegir): un campo
     adentro de la celda.
   - opciones: la lista con buscador del CRM de antes, debajo de la celda.
   - largo (las notas): la caja grande que tapa la celda.

   La usan la tabla del CRM y el perfil de la ficha.
   ================================================================== */

export const VACIAR = "Vaciar";

export function CeldaEditable({
  editor, valor, titulo, abierta, onAbrir, onCerrar, onGuardar, opciones, sugerencias, vaciable, ayuda, className, children,
}: {
  editor: EditorColumna;
  /* Lo que hay, como texto para editar. */
  valor: string;
  titulo: string;
  abierta: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  onGuardar: (valor: string) => void;
  opciones?: OpcionCrm[];
  sugerencias?: string[];
  /* Con opciones: si se puede dejar vacía. */
  vaciable?: boolean;
  /* Lo que dice al pasar el mouse. */
  ayuda?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [ancla, setAncla] = useState<HTMLDivElement | null>(null);
  const idLista = useId();
  /* Enter y Esc cierran el campo, y al cerrarse pierde el foco: que el
     blur no vuelva a guardar (ni guarde lo que Esc descartó). */
  const hecho = useRef(false);
  const terminar = (v: string | null) => {
    if (hecho.current) return;
    hecho.current = true;
    if (v !== null) onGuardar(v);
    onCerrar();
  };

  if (abierta && editor !== "opciones" && editor !== "largo") {
    return (
      <div className={`crm-t__editable crm-t__editable--abierta${className ? ` ${className}` : ""}`}>
        <input
          className="crm-t__input" autoFocus type={editor === "fecha" ? "date" : "text"} defaultValue={valor} aria-label={titulo}
          list={sugerencias?.length ? idLista : undefined}
          placeholder={editor === "lista" ? "Separadas por coma" : undefined}
          onFocus={(ev) => { hecho.current = false; if (editor !== "fecha") ev.currentTarget.select(); }}
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); terminar(ev.currentTarget.value); }
            else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); terminar(null); }
          }}
          onBlur={(ev) => terminar(ev.currentTarget.value)}
        />
        {sugerencias?.length ? <datalist id={idLista}>{sugerencias.map((s) => <option key={s} value={s} />)}</datalist> : null}
      </div>
    );
  }

  const lista = opciones && vaciable && valor ? [...opciones, { nombre: VACIAR, color: "gris1" as const }] : opciones;
  return (
    <>
      <div
        ref={setAncla} role="button" tabIndex={0} title={ayuda ?? `Clic para corregir ${titulo.toLowerCase()}`}
        className={`crm-t__editable${abierta ? " crm-t__editable--abierta" : ""}${className ? ` ${className}` : ""}`}
        aria-label={`${titulo}: ${valor || "vacío"}. Corregir`}
        onClick={(ev) => { ev.stopPropagation(); if (!abierta) onAbrir(); }}
        onKeyDown={(ev) => {
          if (abierta || (ev.key !== "Enter" && ev.key !== "F2" && ev.key !== " ")) return;
          ev.preventDefault(); ev.stopPropagation(); onAbrir();
        }}
      >
        {children}
      </div>
      {abierta && editor === "opciones" && lista && (
        <SelectorOpciones
          ancla={ancla} opciones={lista} valor={valor} ancho={Math.max(220, ancla?.offsetWidth ?? 0)}
          onElegir={(n) => { onGuardar(n === VACIAR ? "" : n); onCerrar(); }} onCerrar={onCerrar}
        />
      )}
      {abierta && editor === "largo" && (
        <EditorTextoLargo ancla={ancla} valor={valor} titulo={titulo} onGuardar={onGuardar} onCerrar={onCerrar} />
      )}
    </>
  );
}
