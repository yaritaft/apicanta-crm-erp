"use client";

import React, { useMemo } from "react";
import {
  ArrowRightLeft, CalendarCheck, CalendarX, GraduationCap, HandCoins, PhoneCall, ShoppingBag, UserPlus,
} from "lucide-react";
import { Empty } from "@/components/ui/ui";
import { fechaHora, money } from "@/lib/format";
import { actividadDe, type Persona } from "@/lib/persona";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Todo lo que pasó con la persona, del más nuevo al más viejo: cuándo
   entró, las llamadas (y si vino), los cambios de etapa, las compras y
   cada pago. Se arma con los datos mismos, no con un registro aparte:
   así nunca dice algo distinto de lo que muestran las otras pantallas.
   ================================================================== */

interface Evento {
  fecha: string;
  icono: React.ReactNode;
  titulo: string;
  detalle?: string;
  tono?: "success" | "danger" | "accent" | "brand";
}

export function HistorialPersona({ e, p }: { e: EstadoApp; p: Persona }) {
  const eventos = useMemo(() => {
    const out: Evento[] = [];
    const mon = e.ajustes.monedaBase;

    for (const l of p.leads) {
      out.push({
        fecha: l.creadoEn, icono: <UserPlus size={15} />, titulo: "Entró como lead",
        detalle: [l.fuente, l.campania].filter(Boolean).join(" · ") || undefined,
      });
    }

    /* Los cambios de etapa y lo que se anotó a mano quedan en la actividad;
       ventas y pagos se cuentan abajo con su propio renglón. */
    for (const a of actividadDe(e, p)) {
      if (a.entidad === "transaccion") continue;
      if (a.accion === "creo" && a.entidad === "lead") continue;
      out.push({
        fecha: a.fecha,
        icono: a.accion === "movio" ? <ArrowRightLeft size={15} /> : a.entidad === "alumno" ? <GraduationCap size={15} /> : <ArrowRightLeft size={15} />,
        titulo: a.detalle, detalle: a.actor ? `por ${a.actor}` : undefined,
      });
    }

    for (const s of p.sesiones) {
      out.push({
        fecha: s.creadoEn, icono: <PhoneCall size={15} />, titulo: `Agendó: ${s.tipo || s.titulo}`,
        detalle: `para el ${fechaHora(s.inicia)}${s.origen === "calendly" ? " · por Calendly" : ""}`,
      });
      if (s.estado === "hecha") out.push({ fecha: s.inicia, icono: <CalendarCheck size={15} />, titulo: "Tuvo la llamada", detalle: s.anfitrion ? `con ${s.anfitrion}` : undefined, tono: "success" });
      if (s.estado === "no-show") out.push({ fecha: s.inicia, icono: <CalendarX size={15} />, titulo: "No vino a la llamada", tono: "danger" });
      if (s.estado === "cancelada") {
        out.push({
          fecha: s.canceladaEn ?? s.inicia, icono: <CalendarX size={15} />, titulo: "Canceló la llamada",
          detalle: s.motivoCancelacion || undefined, tono: "danger",
        });
      }
    }

    for (const v of p.ventas) {
      const producto = e.productos.find((x) => x.id === v.productoId)?.nombre ?? "una venta";
      const closer = e.equipo.find((x) => x.id === v.closerId)?.nombre;
      out.push({
        fecha: v.fecha, icono: <ShoppingBag size={15} />, titulo: `Compró ${producto}`,
        detalle: [money(v.precioAcordado, v.moneda), closer ? `cerró ${closer}` : ""].filter(Boolean).join(" · "),
        tono: "accent",
      });
      const cuotas = e.cuotas.filter((c) => c.ventaId === v.id);
      for (const pago of e.pagos.filter((x) => cuotas.some((c) => c.id === x.cuotaId))) {
        const cuota = cuotas.find((c) => c.id === pago.cuotaId);
        const medio = e.procesadores.find((x) => x.id === pago.procesadorId)?.nombre;
        out.push({
          fecha: pago.fecha, icono: <HandCoins size={15} />,
          titulo: `Pagó ${money(pago.monto, pago.moneda ?? mon, 2)}${medio ? ` con ${medio}` : ""}`,
          detalle: `${cuota?.esReserva ? "Reserva" : `Cuota ${cuota?.numero ?? "—"}`} de ${producto}${pago.movimientoId ? " · conciliado" : ""}`,
          tono: "success",
        });
      }
    }

    return out.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
  }, [e, p]);

  if (eventos.length === 0) {
    return <Empty icono={<ArrowRightLeft size={22} />} titulo="Sin historia todavía" texto="Cuando agende, compre o pague, va a aparecer acá." />;
  }

  /* Con scroll propio: con cada llamada y cada pago la historia crece, y
     las solapas de arriba tienen que seguir a la vista. */
  return (
    <ol className="linea-tiempo lista-scroll">
      {eventos.map((ev, i) => (
        <li key={i} className="linea-tiempo__item" data-tono={ev.tono}>
          <span className="linea-tiempo__icono">{ev.icono}</span>
          <div style={{ minWidth: 0 }}>
            <div className="t-sm t-strong">{ev.titulo}</div>
            <div className="t-sm t-subtle">{fechaHora(ev.fecha)}{ev.detalle ? ` · ${ev.detalle}` : ""}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
