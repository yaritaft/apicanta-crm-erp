"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Panel, usePosicion } from "@/components/ui/Campos";
import {
  TITULO_GRUPO_PROVEEDOR, esProveedorNuevo, filtrarProveedores, resolverProveedor, type OpcionProveedor,
} from "@/lib/carga-gasto";
import { normalizar } from "@/lib/gastos";

/* ==================================================================
   A quién se le pagó: un campo con lista.

   Se elige de la lista (las personas del equipo con su puesto y los
   proveedores que ya se usaron en otros gastos) o se escribe uno nuevo.
   Lo que está en el campo ES el proveedor: escribir y salir alcanza, y
   si coincide con alguien de la lista (aunque sea sin tildes o en
   minúsculas) queda escrito como figura en la lista.

   Va de dos maneras. En un paso que sólo pregunta esto, la lista está a
   la vista debajo del campo (`enLinea`); adentro de un formulario se
   despliega al tocar el campo y flota encima del resto.

   Teclado: flechas para moverse, Enter elige la fila marcada, Esc cierra
   la lista (sin sacar de la pantalla a quien está cargando).
   ================================================================== */

type Fila = { clave: string; opcion: OpcionProveedor } | { clave: string; nuevo: string };

const grupoDe = (f: Fila) => ("opcion" in f ? f.opcion.grupo : "nuevo");

export function CampoProveedor({
  id, value, onChange, opciones, error, placeholder = "Elegí de la lista o escribí uno",
  autoFocus, enLinea = false, onBlur, "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (valor: string) => void;
  opciones: readonly OpcionProveedor[];
  /* El casillero se pinta de error y el pedido va adentro, donde se escribe. */
  error?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  enLinea?: boolean;
  onBlur?: () => void;
  "aria-label"?: string;
}) {
  const [desplegada, setDesplegada] = useState(false);
  const abierto = enLinea || desplegada;
  /* Sin escribir se ve la lista entera (con el actual tildado); al
     escribir, sólo lo que calza. */
  const [escribio, setEscribio] = useState(false);
  const [activa, setActiva] = useState(-1);
  const via = useRef<"teclado" | "mouse">("mouse");

  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const actual = normalizar(value);

  const filas = useMemo<Fila[]>(() => {
    const vistas = escribio ? filtrarProveedores(opciones, value) : [...opciones];
    const xs: Fila[] = vistas.map((o) => ({ clave: `${o.grupo}:${o.equipoId ?? normalizar(o.nombre)}`, opcion: o }));
    if (escribio && esProveedorNuevo(opciones, value)) xs.push({ clave: "nuevo", nuevo: value.trim().replace(/\s+/g, " ") });
    return xs;
  }, [opciones, value, escribio]);

  const alto = Math.min(filas.length * 48 + 64, 340);
  const pos = usePosicion(caja, desplegada && !enLinea, alto, 300);

  const cerrar = useCallback(() => { setDesplegada(false); setEscribio(false); }, []);

  function abrir() {
    if (enLinea) return;
    setEscribio(false);
    setActiva(opciones.findIndex((o) => normalizar(o.nombre) === actual));
    setDesplegada(true);
  }

  function elegir(f: Fila) {
    onChange("opcion" in f ? f.opcion.nombre : f.nuevo);
    setEscribio(false);
    setActiva(-1);
    if (!enLinea) setDesplegada(false);
    entrada.current?.focus();
  }

  function escribir(texto: string) {
    onChange(texto);
    setEscribio(true);
    /* Lo que se escribe deja marcada la primera que calza: Enter la elige. */
    setActiva(texto.trim() ? 0 : -1);
    if (!enLinea) setDesplegada(true);
  }

  function tecla(ev: React.KeyboardEvent<HTMLInputElement>) {
    const fila = activa >= 0 ? filas[activa] : undefined;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      via.current = "teclado";
      if (!abierto) { abrir(); setActiva((i) => Math.max(i, 0)); }
      else setActiva((i) => Math.min(i + 1, filas.length - 1));
    } else if (ev.key === "ArrowUp") {
      if (!abierto) return;
      ev.preventDefault();
      via.current = "teclado";
      setActiva((i) => Math.max(i - 1, 0));
    } else if (ev.key === "Enter") {
      /* Con una fila marcada, Enter la elige y no avanza de paso: el
         siguiente Enter sí. Con la lista flotante abierta y nada marcado,
         sólo la cierra. En una lista a la vista, sin fila marcada, Enter
         es del asistente. */
      if (abierto && fila) { ev.preventDefault(); ev.stopPropagation(); elegir(fila); }
      else if (desplegada && !enLinea) { ev.preventDefault(); ev.stopPropagation(); cerrar(); }
    } else if (ev.key === "Escape" && desplegada && !enLinea) {
      ev.preventDefault(); ev.stopPropagation(); cerrar();
    }
  }

  function alSalir() {
    if (!enLinea) cerrar();
    /* Lo escrito se acomoda: espacios de más, y la forma de la lista si coincide. */
    const r = resolverProveedor(value, opciones);
    if (r.nombre !== value) onChange(r.nombre);
    onBlur?.();
  }

  /* La fila marcada con el teclado siempre a la vista. */
  useEffect(() => {
    if (!abierto || activa < 0 || via.current !== "teclado") return;
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${activa}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activa, abierto]);

  const lista = (
    /* El mousedown no le saca el foco al campo: así el clic en una fila llega. */
    <div
      ref={listaRef} id={idLista} role="listbox" aria-label={ariaLabel ?? "Proveedores"}
      className={`prov__lista${enLinea ? " prov__lista--en-linea" : ""}`}
      onMouseDown={(ev) => ev.preventDefault()}
    >
      {filas.length === 0 && (
        <div className="prov__vacio">
          {opciones.length === 0
            ? "Todavía no hay equipo ni proveedores cargados: escribí uno."
            : "Nada coincide: escribí el nombre completo."}
        </div>
      )}
      {filas.map((f, i) => {
        const g = grupoDe(f);
        /* Un título cada vez que cambia el grupo; la fila de «usar lo escrito» no lleva. */
        const titulo = g !== "nuevo" && (i === 0 || grupoDe(filas[i - 1]) !== g) ? TITULO_GRUPO_PROVEEDOR[g] : null;
        const o = "opcion" in f ? f.opcion : null;
        const nuevo = "nuevo" in f ? f.nuevo : null;
        const tildada = o ? normalizar(o.nombre) === actual : false;
        return (
          <React.Fragment key={f.clave}>
            {titulo && <div className="prov__grupo" role="presentation">{titulo}</div>}
            <div
              id={`${idLista}-${i}`} data-i={i} role="option" aria-selected={tildada}
              className={`prov__op${i === activa ? " prov__op--activa" : ""}${o?.inactivo ? " prov__op--inactivo" : ""}${nuevo !== null ? " prov__op--nuevo" : ""}`}
              onMouseMove={() => { if (i !== activa) { via.current = "mouse"; setActiva(i); } }}
              onClick={() => elegir(f)}
            >
              <span className="prov__texto">
                <span className="prov__nombre">{nuevo !== null ? `Usar «${nuevo}»` : o?.nombre}</span>
                <span className="prov__detalle">{nuevo !== null ? "Proveedor nuevo: queda en la lista para la próxima" : o?.detalle}</span>
              </span>
              {tildada && <Check size={15} className="prov__tilde" />}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div className="prov" ref={caja}>
      <div className={`hk-input prov__campo${error ? " hk-input--error" : ""}`}>
        <input
          ref={entrada} id={id} value={value} autoComplete="off" autoFocus={autoFocus}
          placeholder={error && !value.trim() ? "Falta: elegí o escribí un nombre" : placeholder}
          role="combobox" aria-expanded={abierto} aria-autocomplete="list" aria-controls={abierto ? idLista : undefined}
          aria-activedescendant={abierto && activa >= 0 ? `${idLista}-${activa}` : undefined}
          aria-invalid={error || undefined} aria-label={ariaLabel}
          onChange={(ev) => escribir(ev.target.value)}
          onKeyDown={tecla}
          onFocus={(ev) => {
            /* Quien lo enfoca por su cuenta (data-sin-lista) deja el cursor sin abrir la lista. */
            if (ev.currentTarget.dataset.sinLista) { delete ev.currentTarget.dataset.sinLista; return; }
            if (!desplegada) abrir();
          }}
          onClick={() => { if (!desplegada) abrir(); }}
          onBlur={alSalir}
        />
        {!enLinea && (
          <button
            type="button" tabIndex={-1} className="prov__flecha" aria-label={desplegada ? "Cerrar la lista" : "Ver la lista"}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => { if (desplegada) cerrar(); else { entrada.current?.focus(); abrir(); } }}
          >
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      {enLinea
        ? lista
        : desplegada && pos && <Panel pos={pos} panelRef={panel} className="prov__panel">{lista}</Panel>}
    </div>
  );
}
