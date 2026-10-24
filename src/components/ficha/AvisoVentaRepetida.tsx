"use client";

import React, { useMemo } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { puedeDarDeBaja } from "@/lib/permisos";
import { acciones } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { cobradoDeVenta, gruposDeVentasRepetidas, ventaParaDejar } from "@/lib/ventas-repetidas";
import type { Persona } from "@/lib/persona";
import type { EstadoApp, Venta } from "@/lib/types";

/* «Esta compra parece estar cargada dos veces» arriba de las ventas de la ficha (Aldana, 24/10: Jorge David Llamas Olivero
   tenía Hackear AI US$ 3.000 dos veces, una con el pago chequeado a mano y otra con el que concilió la pasarela, y la
   lista decía «Pagó todo US$ 6.000»). Lo decide una persona: «Eliminar la repetida» abre la ventana de eliminar con la
   que se cargó después; «Son compras distintas» la deja marcada y no se vuelve a proponer. */

export function AvisoVentaRepetida({ e, p, onEliminar }: { e: EstadoApp; p: Persona; onEliminar: (venta: Venta) => void }) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = puedeDarDeBaja(acceso);
  const grupos = useMemo(
    () => gruposDeVentasRepetidas({ ventas: p.ventas, cuotas: e.cuotas, pagos: e.pagos, contactos: e.contactos, leads: e.leads }),
    [p.ventas, e.cuotas, e.pagos, e.contactos, e.leads],
  );
  if (grupos.length === 0) return null;

  const producto = (v: Venta) => e.productos.find((x) => x.id === v.productoId)?.nombre ?? "Venta";
  const estado = (v: Venta) => (v.estado === "activa" ? "activa" : v.estado === "cancelada" ? "cancelada" : "reembolsada");

  const sonDistintas = (grupo: Venta[]) => {
    for (const v of grupo) {
      const otros = grupo.filter((w) => w.id !== v.id).map((w) => w.id);
      const antes = Array.isArray(v.extra?.noEsRepetida) ? (v.extra.noEsRepetida as string[]) : [];
      acciones.actualizar<Venta>("ventas", v.id, { extra: { ...v.extra, noEsRepetida: [...new Set([...antes, ...otros])] } }, v.contactoNombre,
        "Se revisó: no es una compra cargada dos veces.");
    }
    toast("Listo: no se vuelve a proponer.");
  };

  return (
    <div className="aviso-duplicado" role="status">
      {grupos.map((grupo) => {
        const dejar = ventaParaDejar(e, grupo);
        /* La que se propone eliminar es la que se cargó después (o, si una está cancelada, la cancelada). */
        const sobra = [...grupo.filter((v) => v.id !== dejar.id)].sort((a, b) => Date.parse(b.creadoEn) - Date.parse(a.creadoEn))[0];
        const moneda = dejar.moneda;
        const cobrado = grupo.reduce((a, v) => a + cobradoDeVenta(e, v.id), 0);
        /* Si las fechas son la misma (lo normal: se cargó dos veces el mismo día), no se repite; se distinguen por su estado. */
        const conFecha = new Set(grupo.map((v) => v.fecha.slice(0, 10))).size > 1;
        const parte = (v: Venta) => `una ${estado(v)}${conFecha ? ` del ${fechaLarga(v.fecha)}` : ""} (${money(cobradoDeVenta(e, v.id), v.moneda)} cobrados)`;
        return (
          <div className="aviso-duplicado__fila" key={grupo.map((v) => v.id).join(":")}>
            <Copy size={16} aria-hidden />
            <span className="aviso-duplicado__texto">
              <strong>Esta compra parece estar cargada {grupo.length === 2 ? "dos veces" : `${grupo.length} veces`}: </strong>
              {producto(dejar)} · {money(dejar.precioAcordado, moneda)}
              <span className="t-subtle">
                {" "}· {conFecha ? "" : `${fechaLarga(dejar.fecha)}: `}{grupo.map(parte).join(" y ")}.
                {" "}Entre {grupo.length === 2 ? "las dos" : "todas"} suman {money(cobrado, moneda)} cobrados.
              </span>
            </span>
            <span className="aviso-duplicado__acciones">
              {puede ? (
                <>
                  <Button sm variante="primary" onClick={() => onEliminar(sobra)}>Eliminar la repetida</Button>
                  <Button sm variante="ghost" onClick={() => sonDistintas(grupo)}>Son compras distintas</Button>
                </>
              ) : (
                <span className="t-sm t-subtle">Pedile a Finanzas que elimine la repetida.</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
