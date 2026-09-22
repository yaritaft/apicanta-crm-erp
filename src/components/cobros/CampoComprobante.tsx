"use client";

import React, { useRef, useState } from "react";
import { Eye, FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { IconButton } from "@/components/ui/ui";
import {
  ACEPTA_COMPROBANTE, descartarComprobante, problemaDeArchivo, subirComprobante, tamanioLegible, verComprobante,
} from "@/lib/comprobantes";
import type { Comprobante } from "@/lib/types";

/* ==================================================================
   El comprobante de un cobro: se elige, se arrastra o se pega (Ctrl+V
   con el recuadro enfocado, como una captura de la transferencia).

   Obligatorio cuando el cobro no se concilió contra una pasarela: es la
   única prueba de que la plata entró. Con conciliación, es opcional.
   ================================================================== */

export function CampoComprobante({ valor, onCambio, obligatorio, onSubiendo, borrarAlQuitar = true }: {
  valor?: Comprobante;
  onCambio: (c?: Comprobante) => void;
  obligatorio: boolean;
  /* Para que el formulario no se guarde con una subida a medias */
  onSubiendo?: (subiendo: boolean) => void;
  /* Si el pago todavía no se guardó, sacar el archivo lo borra del bucket. */
  borrarAlQuitar?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const [abriendo, setAbriendo] = useState(false);

  async function subir(archivo: File | undefined | null) {
    if (!archivo) return;
    const problema = problemaDeArchivo(archivo);
    if (problema) { setError(problema); return; }
    setError(null);
    setSubiendo(true);
    onSubiendo?.(true);
    try {
      onCambio(await subirComprobante(archivo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el comprobante.");
    } finally {
      setSubiendo(false);
      onSubiendo?.(false);
    }
  }

  async function ver() {
    if (!valor) return;
    setAbriendo(true);
    try { await verComprobante(valor); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo abrir el comprobante."); }
    finally { setAbriendo(false); }
  }

  function quitar() {
    if (!valor) return;
    if (borrarAlQuitar) void descartarComprobante(valor);
    onCambio(undefined);
  }

  if (valor) {
    const Icono = valor.tipo === "application/pdf" ? FileText : ImageIcon;
    return (
      <div className="comprobante comprobante--listo">
        <Icono size={16} style={{ flexShrink: 0, color: "var(--success)" }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="truncate t-sm t-strong" style={{ display: "block" }}>{valor.nombre}</span>
          <span className="t-sm t-subtle">Comprobante · {tamanioLegible(valor.tamanio)}</span>
        </span>
        <IconButton etiqueta="Ver el comprobante" onClick={ver}>
          {abriendo ? <Loader2 size={15} className="gira" /> : <Eye size={15} />}
        </IconButton>
        <IconButton etiqueta="Sacar el comprobante" onClick={quitar}><X size={15} /></IconButton>
        {error && <span className="comprobante__error" role="alert">{error}</span>}
      </div>
    );
  }

  return (
    <div
      className="comprobante"
      data-obligatorio={obligatorio}
      data-encima={encima}
      onDragOver={(ev) => { ev.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(ev) => { ev.preventDefault(); setEncima(false); void subir(ev.dataTransfer.files?.[0]); }}
      onPaste={(ev) => {
        const archivo = [...ev.clipboardData.files][0];
        if (archivo) { ev.preventDefault(); void subir(archivo); }
      }}
    >
      <input
        ref={input} type="file" accept={ACEPTA_COMPROBANTE} hidden
        onChange={(ev) => { void subir(ev.target.files?.[0]); ev.target.value = ""; }}
      />
      <button type="button" className="comprobante__boton" onClick={() => input.current?.click()} disabled={subiendo}>
        {subiendo ? <Loader2 size={16} className="gira" /> : <Paperclip size={16} />}
        <span style={{ minWidth: 0 }}>
          <span className="t-strong" style={{ display: "block" }}>
            {subiendo ? "Subiendo…" : "Subir comprobante"}
          </span>
          <span className="t-sm t-subtle">
            {obligatorio ? "Obligatorio sin conciliar · " : "Opcional · "}elegilo, arrastralo o pegalo
          </span>
        </span>
      </button>
      {error && <span className="comprobante__error" role="alert">{error}</span>}
    </div>
  );
}
