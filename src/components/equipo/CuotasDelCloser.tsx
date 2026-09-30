"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, Undo2 } from "lucide-react";
import { Button, Select } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { cuotasPorCobrarDe, heredadasPor } from "@/lib/cuotas-closer";
import type { MiembroEquipo } from "@/lib/types";

/* ==================================================================
   En la ficha de un closer: sus cuotas por cobrar y las que heredó.

   Cuando se va, sus cuotas se pasan a otro closer (Yari 29/09): desde ahí
   lo que se cobre de ellas comisiona para el que las heredó, en Finanzas
   y en la liquidación. Lo que ya se cobró sigue siendo de quien cerró la
   venta. Lo heredado se puede devolver.
   ================================================================== */

export function CuotasDelCloser({ m }: { m: MiembroEquipo }) {
  const e = useEstado();
  const toast = useToast();
  const M = (n: number) => money(n, e.ajustes.monedaBase);
  const pendientes = useMemo(() => cuotasPorCobrarDe(e, m.id), [e, m.id]);
  const heredadas = useMemo(() => heredadasPor(e, m.id), [e, m.id]);
  const otros = e.equipo.filter((x) => x.rol === "closer" && x.activo && x.id !== m.id);
  const [destino, setDestino] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [ver, setVer] = useState(false);

  const total = pendientes.reduce((a, x) => a + x.falta, 0);
  const ventas = new Set(pendientes.map((x) => x.venta.id)).size;
  const nombreDe = (id?: string) => e.equipo.find((x) => x.id === id)?.nombre ?? "el closer de la venta";
  const aQuien = e.equipo.find((x) => x.id === destino);
  /* Sólo las que todavía son suyas por la venta (las heredadas se devuelven aparte). */
  const propias = pendientes.filter((x) => x.venta.closerId === m.id && !x.cuota.closerId);

  if (pendientes.length === 0 && heredadas.length === 0) {
    return (
      <section className="stack-2">
        <h3 className="t-label">Sus cuotas por cobrar</h3>
        <p className="t-sm t-subtle">No le queda ninguna cuota por cobrar.</p>
      </section>
    );
  }

  return (
    <section className="stack-3">
      <h3 className="t-label">Sus cuotas por cobrar</h3>
      {pendientes.length > 0 && (
        <p className="t-sm">
          <strong className="t-num">{num(pendientes.length)} {pendientes.length === 1 ? "cuota" : "cuotas"}</strong> por{" "}
          <strong className="t-num">{M(total)}</strong> de {num(ventas)} {ventas === 1 ? "venta" : "ventas"}: lo que se cobre de ellas comisiona para {m.nombre.split(" ")[0]}.
        </p>
      )}

      {/* Pasarlas a otro: lo que se hace cuando un closer se va. */}
      {!m.activo && propias.length > 0 && (
        <div className="cuotas-closer__pasar">
          <p className="t-sm" style={{ color: "var(--warning)" }}>
            Ya no está en el equipo: pasale sus cuotas a otro closer y lo que se cobre de ellas comisiona para ese.
          </p>
          <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className="t-sm">Pasar {propias.length === pendientes.length ? "sus" : `las ${num(propias.length)}`} cuotas a</span>
            <div style={{ width: 220 }}>
              <Select value={destino} placeholder={otros.length ? "Elegí el closer" : "No hay otro closer activo"} aria-label="Closer que las hereda"
                onChange={(ev) => setDestino(ev.target.value)} opciones={otros.map((x) => ({ valor: x.id, texto: x.nombre }))} />
            </div>
            <Button sm variante="primary" icono={<ArrowRightLeft size={14} />} disabled={!destino} onClick={() => setConfirmar(true)}>Pasar</Button>
          </div>
        </div>
      )}

      {heredadas.map((h) => (
        <div key={h.de ?? "sin"} className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="t-sm">Heredó {num(h.ids.length)} {h.ids.length === 1 ? "cuota" : "cuotas"} de {nombreDe(h.de)}.</span>
          <Button sm variante="ghost" icono={<Undo2 size={14} />}
            onClick={() => {
              acciones.reasignarCuotas(h.ids, null, `${m.nombre} devolvió ${h.ids.length} ${h.ids.length === 1 ? "cuota" : "cuotas"} a ${nombreDe(h.de)}.`);
              toast(`Listo: volvieron a ${nombreDe(h.de)}.`);
            }}>Devolverlas</Button>
        </div>
      ))}

      {pendientes.length > 0 && (
        <div>
          <button type="button" className="link t-sm" onClick={() => setVer((v) => !v)}>{ver ? "Ocultar el detalle" : "Ver cuota por cuota"}</button>
          {ver && (
            <ul className="cuotas-closer__lista">
              {pendientes.map(({ cuota, venta, falta }) => (
                <li key={cuota.id}>
                  <span className="truncate">{venta.contactoNombre}</span>
                  <span className="t-sm t-subtle">{cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`}{cuota.vence ? ` · vence ${fechaLarga(cuota.vence)}` : ""}{cuota.closerId ? ` · heredada de ${nombreDe(venta.closerId)}` : ""}</span>
                  <span className="t-num t-strong">{M(falta)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Confirmar
        abierto={confirmar} onCerrar={() => setConfirmar(false)}
        titulo={`¿Pasar las cuotas de ${m.nombre} a ${aQuien?.nombre ?? ""}?`}
        texto={`Son ${propias.length} ${propias.length === 1 ? "cuota" : "cuotas"} por ${M(propias.reduce((a, x) => a + x.falta, 0))}. Desde ahora lo que se cobre de ellas comisiona para ${aQuien?.nombre ?? "el otro closer"}, en Finanzas y en la liquidación. Lo que ya se cobró sigue siendo de ${m.nombre}. Se puede devolver desde la ficha de ${aQuien?.nombre ?? "quien las hereda"}.`}
        confirmarTexto="Pasar las cuotas" variante="primary"
        onConfirmar={() => {
          acciones.reasignarCuotas(propias.map((x) => x.cuota.id), destino,
            `Las ${propias.length} cuotas por cobrar de ${m.nombre} pasaron a ${aQuien?.nombre ?? "otro closer"}.`);
          toast(`Listo: ${propias.length} cuotas pasaron a ${aQuien?.nombre ?? "otro closer"}.`);
          setConfirmar(false);
          setDestino("");
        }}
      />
    </section>
  );
}
