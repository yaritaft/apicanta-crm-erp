"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";

/* ==================================================================
   Un número que se edita donde está, como una celda de Excel.

   Click, Enter o empezar a escribir: se abre. Enter guarda y baja,
   Tab guarda y pasa a la de al lado, Esc deja todo como estaba. Salir
   de la celda también guarda: no hay botón Guardar, porque estos
   números se actualizan todos los días y cada click de más cansa.

   La usan la planilla de webinars y la ficha de cada uno. La grilla
   (flechas, a qué celda ir) es de quien la usa: acá sólo se avisa
   hacia dónde moverse con `onMover`.
   ================================================================== */

export type Direccion = "arriba" | "abajo" | "izquierda" | "derecha";

/**
 * Lee un número como lo escribe alguien de acá: "1.500" es mil quinientos,
 * "1.500,50" y "1500,5" llevan decimales, "US$ 2.000" también vale.
 * Lo que no se puede leer es null: mejor avisar que guardar cualquier cosa.
 */
export function leerNumero(texto: string): number | null {
  let s = texto.trim().replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return null;
  const negativo = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (s.includes(",")) {
    /* Con coma, la coma es el decimal y los puntos son de miles. */
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const puntos = (s.match(/\./g) ?? []).length;
    /* "1.000.000" o "2.500": puntos de miles. "2.5": decimal. */
    if (puntos > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/* Para editar se muestra el número pelado, con coma decimal: "1500,5".
   Con separador de miles, borrar un dígito dejaría puntos sueltos. */
function aTexto(n: number, decimales: number): string {
  if (!Number.isFinite(n)) return "";
  const f = 10 ** decimales;
  return String(Math.round(n * f) / f).replace(".", ",");
}

export function CeldaEditable({
  valor, onGuardar, formato = (n) => String(n), etiqueta, decimales = 0, min = 0,
  onMover, onError, tabIndex = 0, celda, grande, ayuda,
}: {
  valor: number;
  onGuardar: (n: number) => void;
  formato?: (n: number) => string;
  /* Para lectores de pantalla y para el aviso de error: "Pauta de «Webinar»". */
  etiqueta: string;
  decimales?: number;
  min?: number;
  /* A dónde ir después de guardar con Enter o Tab. Sin esto Enter se queda
     en la celda y Tab sigue el orden normal de la página. */
  onMover?: (hacia: Direccion) => void;
  onError?: (mensaje: string) => void;
  /* La planilla deja una sola celda en el orden del Tab (tab roving). */
  tabIndex?: number;
  /* Posición en la grilla ("fila:columna"), para que la grilla la encuentre. */
  celda?: string;
  /* La versión de la ficha: número más grande y lápiz a la vista. */
  grande?: boolean;
  ayuda?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [senal, setSenal] = useState<"ok" | "error" | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const cerrada = useRef(true);
  const seleccionarTodo = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const celdaRef = useRef<HTMLDivElement>(null);

  /* La señal de guardado dura un momento y se va sola. */
  useEffect(() => {
    if (!senal) return;
    const t = window.setTimeout(() => setSenal(null), 1600);
    return () => window.clearTimeout(t);
  }, [senal, vuelta]);

  /* Layout y no useEffect: el foco tiene que estar en el input antes de que
     llegue la próxima tecla, o alguien que escribe rápido pierde dígitos. */
  useLayoutEffect(() => {
    if (!editando) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    /* Con Enter o click se reemplaza todo; si se empezó escribiendo, se sigue
       desde esa tecla, como en una planilla. */
    if (seleccionarTodo.current) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editando]);

  function empezar(inicial?: string) {
    cerrada.current = false;
    seleccionarTodo.current = inicial === undefined;
    setTexto(inicial ?? aTexto(valor, decimales));
    setEditando(true);
  }

  /* Se cierra una sola vez: Enter y Tab guardan, y el blur que llega detrás
     no puede guardar de nuevo. */
  function cerrar(guardar: boolean, despues?: Direccion | "quedarse") {
    if (cerrada.current) return;
    cerrada.current = true;
    if (guardar) {
      const limpio = texto.trim();
      /* Vaciar la celda es poner cero, como en una planilla. */
      const n = limpio === "" ? 0 : leerNumero(limpio);
      if (n === null || n < min) {
        setSenal("error");
        setVuelta((v) => v + 1);
        onError?.(n === null
          ? `«${limpio}» no es un número: ${etiqueta} quedó como estaba.`
          : `${etiqueta} no puede ser negativo.`);
      } else {
        const f = 10 ** decimales;
        const redondo = Math.round(n * f) / f;
        if (redondo !== valor) {
          onGuardar(redondo);
          setSenal("ok");
          setVuelta((v) => v + 1);
        }
      }
    }
    setEditando(false);
    if (!despues) return;
    /* Después de dibujar: recién ahí la celda vuelve a existir y se puede
       enfocar la de al lado (o ésta). */
    requestAnimationFrame(() => {
      if (despues !== "quedarse" && onMover) onMover(despues);
      else celdaRef.current?.focus();
    });
  }

  if (editando) {
    return (
      <input
        ref={inputRef}
        className={`celda-ed__input${grande ? " celda-ed__input--grande" : ""}`}
        data-celda={celda}
        value={texto}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={etiqueta}
        onChange={(ev) => setTexto(ev.target.value)}
        onBlur={() => cerrar(true)}
        onKeyDown={(ev) => {
          /* Mientras un teclado japonés o chino compone, Enter confirma la
             palabra, no la celda. */
          if (ev.nativeEvent.isComposing) return;
          if (ev.key === "Enter") {
            ev.preventDefault();
            cerrar(true, ev.shiftKey ? "arriba" : "abajo");
          } else if (ev.key === "Escape") {
            /* Que no cierre además el popover o el panel que la contiene. */
            ev.preventDefault();
            ev.stopPropagation();
            cerrar(false, "quedarse");
          } else if (ev.key === "Tab" && onMover) {
            ev.preventDefault();
            cerrar(true, ev.shiftKey ? "izquierda" : "derecha");
          }
        }}
      />
    );
  }

  const clases = [
    "celda-ed",
    grande ? "celda-ed--grande" : "",
    valor === 0 ? "celda-ed--cero" : "",
    senal ? `celda-ed--${senal}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={celdaRef}
      role="button"
      tabIndex={tabIndex}
      data-celda={celda}
      className={clases}
      aria-label={`${etiqueta}: ${formato(valor)}`}
      title={ayuda ?? "Click o Enter para cambiarlo"}
      onClick={() => empezar()}
      onKeyDown={(ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
        if (ev.key === "Enter" || ev.key === "F2" || ev.key === " ") {
          ev.preventDefault();
          empezar();
        } else if (ev.key === "Backspace" || ev.key === "Delete") {
          ev.preventDefault();
          empezar("");
        } else if (ev.key.length === 1 && /[\d.,-]/.test(ev.key)) {
          /* Escribir un número sobre la celda la abre con ese número. */
          ev.preventDefault();
          empezar(ev.key);
        }
      }}
    >
      {senal === "ok" && <Check size={13} className="celda-ed__marca" aria-hidden />}
      <span className="celda-ed__valor">{formato(valor)}</span>
      {grande && <Pencil size={13} className="celda-ed__lapiz" aria-hidden />}
      <span className="celda-ed__aviso" aria-live="polite">
        {senal === "ok" ? "Guardado" : senal === "error" ? "No se guardó" : ""}
      </span>
    </div>
  );
}
