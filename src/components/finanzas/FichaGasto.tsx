"use client";

import React from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { fechaHora, fechaLarga, money, num } from "@/lib/format";
import { infoGrupo, montoOriginal } from "@/lib/gastos";
import type { EstadoApp, Gasto } from "@/lib/types";
import { VARIANTE_GRUPO } from "./ListaGastos";

/* La ficha de un gasto: a donde lleva cada gasto del estado de resultados.
   Se ve todo lo que se cargó, y de acá se edita o se borra. */
export function FichaGasto({ gasto, e, onCerrar, onEditar, onBorrar }: {
  gasto: Gasto;
  e: EstadoApp;
  onCerrar: () => void;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  const grupo = infoGrupo(gasto.grupo);
  const original = montoOriginal(gasto);
  const webinar = gasto.webinarId ? e.webinars.find((w) => w.id === gasto.webinarId) : undefined;

  return (
    <Drawer
      abierto onCerrar={onCerrar}
      titulo={gasto.concepto || gasto.categoria}
      sub={`${gasto.categoria} · ${fechaLarga(gasto.fecha)}`}
      pie={
        <>
          <Button variante="secondary" icono={<Pencil size={16} />} onClick={onEditar}>Editar</Button>
          <span className="spacer" />
          <Button variante="danger" icono={<Trash2 size={16} />} onClick={onBorrar}>Eliminar</Button>
        </>
      }
    >
      <div className="ficha-gasto__monto">
        <span className="t-num">{money(gasto.monto, e.ajustes.monedaBase, 2)}</span>
        <Badge variante={VARIANTE_GRUPO[gasto.grupo] ?? "neutral"}>{grupo.titulo}</Badge>
      </div>
      <p className="t-sm t-subtle">
        Resta en «{gasto.grupo === "directo" ? "Otros costos directos" : gasto.grupo === "dueno" ? "Honorarios del CEO" : "Gastos operativos"}»
        del estado de resultados, en las dos columnas. {grupo.ayuda}
      </p>

      <dl className="dl">
        <Dato label="Categoría">{gasto.categoria}</Dato>
        <Dato label="Fecha">{fechaLarga(gasto.fecha)}</Dato>
        <Dato label="Tipo">{gasto.recurrente ? "Fijo: se paga todos los meses" : "Variable"}</Dato>
        {original && (
          <Dato label="Pagado en">
            <span className="t-num">{money(original.monto, original.moneda, 2)} a {num(original.tipoCambio, 2)}</span>
          </Dato>
        )}
        <Dato label="Proveedor">{gasto.proveedor || "—"}</Dato>
        <Dato label="Webinar">
          {webinar ? <Link className="link" href={`/webinars?ver=${webinar.id}`}>{webinar.titulo}</Link> : "—"}
        </Dato>
        <Dato label="Notas">{gasto.notas || "—"}</Dato>
        <Dato label="Cargado">{gasto.creadoEn ? fechaHora(gasto.creadoEn) : "—"}</Dato>
      </dl>
    </Drawer>
  );
}
