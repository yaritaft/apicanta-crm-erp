"use client";

import React, { useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, Check, Receipt } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { Avance } from "@/components/finanzas/visual/visual";
import { saldoVenta } from "@/lib/finanzas";
import { cobroDeCuota, type CobroDeCuota } from "@/lib/estado-cuota";
import { motivoIncobrable } from "@/lib/cuota-incobrable";
import { fechaLarga, money } from "@/lib/format";
import type { Alumno, EstadoApp, Venta } from "@/lib/types";
import { marcaDeBaja } from "@/lib/baja-a-downsell";
import { esProgramaDownsell, programaDeProducto, programasDe } from "@/lib/programas";
import { AccionesServicio, BloqueServicio, FilaServicio } from "./FilaServicio";
import { PasarADownsell } from "./PasarADownsell";
import { useVerVentaEnFicha } from "./abrir";

/* ==================================================================
   La solapa Pagos del Servicio (Mariano, 04/11: «en esta pantalla dónde
   podemos ver el tema de los pagos de este cliente… sería bueno tener un
   link directo desde acá, o verlo incluso desde acá»). Cuánto lleva
   pagado del programa y cómo viene cada cuota, con lo mismo que dice la
   tarjeta de la venta en Ventas (lib/estado-cuota.ts). Registrar un pago,
   cambiar una fecha o dar una cuota por saldada se hace en Ventas: el
   botón lleva directo a esa venta, abierta.
   ================================================================== */

const TEXTO: Record<CobroDeCuota["estado"], string> = {
  cobrada: "Cobrada", vencida: "Vencida", "en-parte": "Cobrada en parte", pendiente: "Pendiente",
  incobrable: "Incobrable", cancelada: "Cancelada",
};

/** Las cuotas que vencieron sin pagarse: el número rojo de la solapa. */
export function cuotasVencidas(e: EstadoApp, venta: Venta | undefined): number {
  if (!venta || venta.estado !== "activa") return 0;
  return e.cuotas.filter((c) => c.ventaId === venta.id && cobroDeCuota(c, e.pagos).estado === "vencida").length;
}

/** ¿Se le ofrece «Pasar a Downsell»? Venta activa de un programa completo que todavía no pagó entero (lib/baja-a-downsell.ts decide el resto). */
export function puedePasarADownsell(e: EstadoApp, venta: Venta): boolean {
  if (venta.estado !== "activa" || marcaDeBaja(venta)) return false;
  const programa = programaDeProducto(programasDe(e.ajustes), venta.productoId);
  if (!programa || esProgramaDownsell(programa.id)) return false;
  const { cobrado } = saldoVenta(e, venta.id);
  return cobrado > 0.009 && cobrado < venta.precioAcordado - 0.009;
}

export function PagosServicio({ e, venta, alumno, puedeEditar = false }: { e: EstadoApp; venta: Venta; alumno?: Alumno; puedeEditar?: boolean }) {
  const verEnVentas = useVerVentaEnFicha();
  const [bajando, setBajando] = useState(false);
  const baja = marcaDeBaja(venta);
  const fecha = (d: string) => fechaLarga(`${d.slice(0, 10)}T15:00:00.000Z`);
  const M = (n: number, d = 0) => money(n, venta.moneda, d);
  const saldo = saldoVenta(e, venta.id);
  const filas = saldo.cuotas.map((c) => ({ c, ...cobroDeCuota(c, e.pagos) }));
  const vencidas = venta.estado === "activa" ? filas.filter((f) => f.estado === "vencida") : [];
  const pagada = saldo.total > 0 && saldo.saldo <= 0.01;
  const resumen = venta.estado !== "activa" ? <span className="hs-chip">{venta.estado === "reembolsada" ? "Reembolsada" : "Cancelada"}</span>
    : pagada ? <span className="hs-chip hs-chip--ok">Pagó todo</span>
      : vencidas.length ? <span className="hs-chip hs-chip--rojo">Debe {M(vencidas.reduce((a, f) => a + f.resta, 0))} vencido</span>
        : <span className="hs-chip hs-chip--ambar">Faltan {M(saldo.saldo)}</span>;

  return (
    <>
      <AccionesServicio>
        <Button sm variante="secondary" icono={<ArrowRight size={14} />} onClick={() => verEnVentas(venta.id)}
          title="Abre esta venta en la vista Ventas: ahí se registra un pago, se cambia una fecha o se da una cuota por saldada">
          Ver y registrar pagos
        </Button>
        {/* Lili, 20/11: no puede seguir pagando → se queda con el downsell con lo que pagó, sin correr el plazo. */}
        {alumno && puedeEditar && puedePasarADownsell(e, venta) && (
          <Button sm variante="ghost" icono={<ArrowDownRight size={14} />} onClick={() => setBajando(true)}
            title="Pasa la venta al downsell con lo que ya pagó, le saca la mentoría y deja el contenido hasta el fin de su programa">
            Pasar a Downsell · no puede pagar
          </Button>
        )}
      </AccionesServicio>
      {bajando && alumno && (
        <PasarADownsell alumnoId={alumno.id} ventaId={venta.id} nombre={alumno.nombre} onCerrar={() => setBajando(false)} />
      )}
      {baja && (
        <BloqueServicio titulo="Pasó a Downsell por falta de pago" extra={<span className="hs-chip hs-chip--ambar">{baja.programa}</span>}>
          <FilaServicio icono={<ArrowDownRight size={15} />} rotulo={`El ${fecha(baja.dia)}`}
            detalle={`Era ${baja.desdePrograma} de ${M(baja.precioAnterior)}${baja.motivo ? ` · ${baja.motivo}` : ""}`}>
            <span className="t-sm t-subtle">{e.equipo.find((x) => x.email && x.email.trim().toLowerCase() === baja.quien.trim().toLowerCase())?.nombre ?? baja.quien}</span>
          </FilaServicio>
          <FilaServicio icono={<Check size={15} />} rotulo={`Sigue hasta el ${fecha(baja.fin)}`}
            detalle="El inicio no cambió: ese día se le corta lo que conserva" />
        </BloqueServicio>
      )}
      <BloqueServicio titulo="Lo que lleva pagado" extra={resumen}>
        <div className="hs-fila">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Avance tono={vencidas.length ? "alerta" : pagada ? "bien" : "brand"} hecho={saldo.cobrado} total={saldo.total}
              izquierda={<span className="t-num">Pagó {M(saldo.cobrado, 2)} de {M(saldo.total, 2)}</span>}
              derecha={<span className="t-num">Valor de la venta {M(venta.precioAcordado, 2)}</span>} />
          </div>
        </div>
      </BloqueServicio>
      <BloqueServicio titulo="Cuotas">
        {filas.length === 0 && <FilaServicio rotulo="Todavía no tiene cuotas cargadas"><span className="hs-guion">—</span></FilaServicio>}
        {filas.map(({ c, pagos, pagado, resta, estado }) => (
          <FilaServicio key={c.id} icono={<Receipt size={15} />}
            rotulo={c.esReserva ? "Reserva" : `Cuota ${c.numero}`}
            detalle={[
              c.vence ? `vence el ${fechaLarga(c.vence)}` : "",
              pagos.length ? `pagó el ${fechaLarga(pagos[pagos.length - 1].fecha)}` : "",
              estado === "en-parte" || (estado === "vencida" && pagado > 0) ? `faltan ${M(resta, 2)}` : "",
              estado === "incobrable" ? motivoIncobrable(c) ?? "" : "",
            ].filter(Boolean).join(" · ") || undefined}>
            <span className="t-num">{M(c.monto, 2)}</span>
            {estado === "cobrada" ? <Badge variante="success"><Check size={13} />{TEXTO[estado]}</Badge>
              : estado === "vencida" ? <Badge variante="danger"><AlertTriangle size={13} />{TEXTO[estado]}</Badge>
                : <Badge variante={estado === "en-parte" ? "accent" : "neutral"}>{TEXTO[estado]}</Badge>}
          </FilaServicio>
        ))}
      </BloqueServicio>
    </>
  );
}
