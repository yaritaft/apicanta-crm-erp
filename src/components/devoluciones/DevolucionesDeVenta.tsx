"use client";

import React, { useState } from "react";
import { Paperclip, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, IconButton } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { verComprobante } from "@/lib/comprobantes";
import { abrirDevolucion } from "@/lib/devolucion-ui";
import { devolvibleDeVenta } from "@/lib/devoluciones";
import { fechaLarga, money } from "@/lib/format";
import { puedeCargarDevolucion } from "@/lib/permisos";
import type { Devolucion, EstadoApp, Venta } from "@/lib/types";

/* ==================================================================
   Las devoluciones de una venta, en su ficha: lo devuelto, por dónde y
   cuándo, con su comprobante, y el botón para cargar otra. El closer las
   ve (las de sus ventas) pero no las carga ni las toca (decisión D6).
   ================================================================== */

export function DevolucionesDeVenta({ e, venta }: { e: EstadoApp; venta: Venta }) {
  const { acceso } = useAcceso();
  const toast = useToast();
  const puede = puedeCargarDevolucion(acceso);
  const [borrar, setBorrar] = useState<Devolucion | null>(null);
  const M = (n: number) => money(n, venta.moneda, 2);

  const lista = (e.devoluciones ?? [])
    .filter((d) => d.ventaId === venta.id && d.estado !== "ignorada")
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  const queda = devolvibleDeVenta(e, venta.id, new Date().toISOString()).queda;
  if (lista.length === 0 && (!puede || queda <= 0.01)) return null;

  return (
    <div className="stack-2" aria-label="Devoluciones de esta venta">
      <div className="row" style={{ gap: 8 }}>
        <span className="t-label">Devoluciones</span>
        <span className="spacer" />
        {puede && queda > 0.01 && (
          <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => abrirDevolucion({ ventaId: venta.id })}>
            Cargar una devolución
          </Button>
        )}
      </div>
      {lista.map((d) => (
        <div className="devol-fila" key={d.id}>
          <Undo2 size={13} className="t-subtle" aria-hidden />
          <span className="t-subtle">{fechaLarga(d.fecha)}</span>
          <span className="t-muted">{e.procesadores.find((p) => p.id === d.procesadorId)?.nombre ?? "Sin cuenta"}</span>
          {d.estado === "propuesta" && <Badge variante="warning">La informó {d.proveedor ?? "la pasarela"}: falta confirmarla</Badge>}
          {d.estado === "confirmada" && d.referencia && <Badge variante="neutral">Atada a {d.proveedor ?? "la pasarela"}</Badge>}
          {d.noDescontarAlCloser && <Badge variante="neutral">Sin descontar al closer</Badge>}
          {d.comprobante && (
            <button type="button" className="link t-sm" onClick={() => {
              verComprobante(d.comprobante!).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err"));
            }}>
              <Paperclip size={12} /> comprobante
            </button>
          )}
          {d.motivo && <span className="t-subtle truncate" style={{ maxWidth: 220 }} title={d.motivo}>{d.motivo}</span>}
          <span className="spacer" />
          <span className="t-num t-strong" style={{ color: d.estado === "confirmada" ? "var(--danger)" : undefined }}>
            {d.estado === "confirmada" ? "−" : ""}{M(d.monto)}
          </span>
          {puede && (
            <>
              {d.estado === "propuesta" ? (
                <Button sm variante="secondary" onClick={() => abrirDevolucion({ propuestaId: d.id, ventaId: venta.id })}>Confirmar</Button>
              ) : (
                <IconButton etiqueta="Corregir la devolución" onClick={() => abrirDevolucion({ devolucionId: d.id, ventaId: venta.id })}><Pencil size={14} /></IconButton>
              )}
              <IconButton etiqueta="Borrar la devolución" onClick={() => setBorrar(d)}><Trash2 size={14} /></IconButton>
            </>
          )}
        </div>
      ))}
      <Confirmar
        abierto={Boolean(borrar)} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar la devolución?"
        texto={`Vuelve a contar lo cobrado y lo comisionado de ${venta.contactoNombre}: Finanzas, la caja y la liquidación se rehacen sin esta devolución.`}
        confirmarTexto="Borrar"
        onConfirmar={() => { if (borrar && acciones.borrarDevolucion(borrar.id)) toast("Devolución borrada."); setBorrar(null); }}
      />
    </div>
  );
}
