"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CreditCard, Pencil, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { fechaHora, fechaLarga, money, num } from "@/lib/format";
import { fechaDePago, infoGrupo, montoOriginal, tieneOtraFechaDePago } from "@/lib/gastos";
import { esIngreso } from "@/lib/carga-gasto";
import { nombrePeriodo, periodoDeFecha } from "@/lib/periodos";
import type { EstadoApp, Gasto } from "@/lib/types";
import { VARIANTE_GRUPO } from "./ListaGastos";
import { esParteDeUnPago, esPagoDeTarjeta } from "@/lib/reparto-tarjeta";
import { RepartirPagoDeTarjeta } from "./RepartirPagoDeTarjeta";

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
  const ingreso = esIngreso(gasto);
  const original = montoOriginal(gasto);
  const dosFechas = tieneOtraFechaDePago(gasto);
  const mesQueCorresponde = nombrePeriodo(periodoDeFecha(gasto.fecha) || periodoDeFecha(new Date().toISOString()));
  const webinar = gasto.webinarId ? e.webinars.find((w) => w.id === gasto.webinarId) : undefined;
  /* El pago de la tarjeta de crédito en un solo gasto: se reparte en sus compras (Aldana, 24/10). */
  const [repartiendo, setRepartiendo] = useState(false);
  const pagoDeTarjeta = esPagoDeTarjeta(gasto);
  const deUnPago = esParteDeUnPago(gasto);

  return (
    <Drawer
      abierto onCerrar={onCerrar}
      titulo={gasto.concepto || gasto.categoria}
      sub={`${gasto.categoria} · ${dosFechas ? `corresponde a ${mesQueCorresponde}` : fechaLarga(gasto.fecha)}`}
      pie={
        <>
          <Button variante="secondary" icono={<Pencil size={16} />} onClick={onEditar}>Editar</Button>
          <span className="spacer" />
          <Button variante="danger" icono={<Trash2 size={16} />} onClick={onBorrar}>Eliminar</Button>
        </>
      }
    >
      <div className="ficha-gasto__monto">
        <span className="t-num" style={ingreso ? { color: "var(--success)" } : undefined}>{ingreso ? "+" : ""}{money(Math.abs(gasto.monto), e.ajustes.monedaBase, 2)}</span>
        {ingreso && <Badge variante="success">Ingreso</Badge>}
        <Badge variante={VARIANTE_GRUPO[gasto.grupo] ?? "neutral"}>{grupo.titulo}</Badge>
      </div>
      <p className="t-sm t-subtle">
        {ingreso
          ? <>Es plata que volvió: descuenta del gasto de «{gasto.categoria}» en el estado de resultados y entra a la caja. {grupo.ayuda}</>
          : gasto.grupo === "retiro"
          ? <>No resta del estado de resultados: sale de la caja (Finanzas → Caja). {grupo.ayuda}</>
          : <>Resta en «{gasto.grupo === "directo" ? "Otros costos directos" : gasto.grupo === "dueno" ? "Honorarios del CEO" : "Gastos operativos"}»
            {" "}del estado de resultados, en las dos columnas. {grupo.ayuda}</>}
      </p>

      {pagoDeTarjeta && (
        <div className="help-card" role="note">
          <CreditCard size={18} aria-hidden />
          <div>
            <div className="help-card__title">Es lo que se pagó de la tarjeta de crédito</div>
            <div className="help-card__text">
              Son las compras de esos días, juntas: el banco no las detalla. Repartilo en sus compras para que cada una caiga en su categoría (la mayoría, honorarios del CEO)
              en vez de quedar todo en «{gasto.categoria}».
            </div>
            <Button sm variante="primary" style={{ marginTop: 8 }} onClick={() => setRepartiendo(true)}>Repartir en compras</Button>
          </div>
        </div>
      )}
      {deUnPago && (
        <p className="t-sm t-subtle">
          Es una de las compras en que se repartió el pago de la tarjeta de {money(Number(gasto.extra.repartidoMonto) || 0, e.ajustes.monedaBase, 2)}.
        </p>
      )}

      <dl className="dl">
        <Dato label="Categoría">{gasto.categoria}</Dato>
        {dosFechas ? (
          <>
            <Dato label="Corresponde a">{mesQueCorresponde} · resta del estado de resultados ahí</Dato>
            <Dato label="Se pagó">{fechaLarga(fechaDePago(gasto))} · sale de la caja ese día</Dato>
          </>
        ) : (
          <Dato label="Fecha">{fechaLarga(gasto.fecha)}</Dato>
        )}
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
      {repartiendo && <RepartirPagoDeTarjeta e={e} gasto={gasto} onCerrar={() => setRepartiendo(false)} onListo={() => { setRepartiendo(false); onCerrar(); }} />}
    </Drawer>
  );
}
