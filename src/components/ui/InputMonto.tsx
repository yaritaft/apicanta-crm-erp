"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "./ui";
import { escribirEnCampo, mismoMonto, textoDeMonto } from "@/lib/monto";

/* ==================================================================
   Un campo de plata: los puntos de miles aparecen mientras se escribe
   («1.234.567,50»). La coma es el decimal (el punto del teclado numérico
   también) y se puede pegar un número de cualquier lado.

   Hace falta porque un input numérico del navegador no separa los miles y
   lee «145.000» como 145 (en pesos, un error de mil veces).

   Se usa como un Input: `value`, `onChange(ev => ev.target.value)`. Lo que
   cambia es lo que trae `ev.target.value`: el texto tal como se ve, con sus
   puntos («1.234,5»). Se lee con leerMonto (lib/monto), que entiende ese
   texto, el de otro teclado y el que se precarga con escribirMonto.

   `value` puede ser un número o un texto. Mientras se escribe se respeta lo
   que hay en el campo («12,» sigue siendo 12): sólo se repone el texto si el
   monto cambia desde afuera. Sin `value`, el campo se maneja solo
   (`defaultValue` + `onBlur`, como un input sin controlar).
   ================================================================== */

export type CambioMonto = { target: { value: string } };

export interface InputMontoProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step" | "inputMode"
> {
  value?: string | number | null;
  defaultValue?: string | number | null;
  onChange?: (ev: CambioMonto) => void;
  /** Cuántos decimales deja escribir: 2 para plata, 4 para un tipo de cambio. */
  decimales?: number;
  negativos?: boolean;
  icono?: React.ReactNode;
  error?: boolean;
  /** Un <input> pelado, para el monto grande de los asistentes. */
  crudo?: boolean;
}

export function InputMonto({
  value, defaultValue, onChange, onBlur, decimales = 2, negativos = false, icono, error, crudo, ...resto
}: InputMontoProps) {
  const opciones = { decimales, negativos };
  const [texto, setTexto] = useState(() => textoDeMonto(value !== undefined ? value : defaultValue, opciones));
  const ultimo = useRef(texto);
  ultimo.current = texto;

  /* Si el monto cambia desde afuera (y no es lo que se está escribiendo), se repone. */
  useEffect(() => {
    if (value === undefined) return;
    if (!mismoMonto(value, ultimo.current)) setTexto(textoDeMonto(value, opciones));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const cambiar = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const el = ev.target;
    const nativo = ev.nativeEvent as InputEvent;
    const tipo = nativo.inputType ?? "";
    const r = escribirEnCampo(el.value, el.selectionStart ?? el.value.length, {
      ...opciones,
      anterior: ultimo.current,
      tecla: tipo === "insertText" ? nativo.data : null,
      pegado: tipo === "insertFromPaste" || tipo === "insertFromDrop" || tipo === "insertReplacementText",
    });
    /* El cursor se acomoda en el mismo momento: si el texto no cambió (una
       tercera cifra decimal, por ejemplo) React no vuelve a dibujar y lo
       dejaría al final. */
    el.value = r.texto;
    try { el.setSelectionRange(r.cursor, r.cursor); } catch { /* algunos teclados no dejan */ }
    if (r.texto !== ultimo.current) {
      ultimo.current = r.texto;
      setTexto(r.texto);
      onChange?.({ target: { value: r.texto } });
    }
  };

  const alSalir = (ev: React.FocusEvent<HTMLInputElement>) => {
    /* Una coma sin decimales detrás sobra. */
    if (ultimo.current.endsWith(",")) {
      const limpio = ultimo.current.slice(0, -1);
      ultimo.current = limpio;
      setTexto(limpio);
      ev.target.value = limpio;
      onChange?.({ target: { value: limpio } });
    }
    onBlur?.(ev);
  };

  const comunes = {
    ...resto, type: "text" as const, inputMode: "decimal" as const, autoComplete: "off",
    value: texto, onChange: cambiar, onBlur: alSalir,
  };
  return crudo ? <input {...comunes} /> : <Input {...comunes} icono={icono} error={error} />;
}
