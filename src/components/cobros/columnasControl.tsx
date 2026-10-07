"use client";

import React from "react";
import { Link2, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/ui";
import type { Columna } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { PildoraDeChequeo } from "@/components/cobros/ControlCobro";
import { comprobanteDeCobro, conciliacionDe, controlDeCobro, type FilaCobro } from "@/lib/control-cobros";
import { verComprobante } from "@/lib/comprobantes";
import { fechaHora } from "@/lib/format";
import { nombrePasarela } from "@/lib/pasarelas";
import type { EstadoApp, Pago } from "@/lib/types";

/* ==================================================================
   Las columnas del control de los cobros, para las dos tablas que los
   muestran: la lista de Ventas → Cobros y Finanzas → Detalle → Procesadores.
   Comprobante (con o sin, y abrirlo), Conciliado, Cargó y Chequeo.
   ================================================================== */

/** El comprobante de un cobro: abrirlo si lo tiene, o decir que falta. */
function CeldaComprobante({ pago }: { pago: Pago }) {
  const toast = useToast();
  const p = comprobanteDeCobro(pago);
  const parar = (ev: React.SyntheticEvent) => ev.stopPropagation();
  if (p.tipo === "archivo") {
    return (
      <button
        type="button" className="link t-sm" title={`${p.comprobante.nombre}: abrir en otra pestaña`}
        onClick={(ev) => { parar(ev); verComprobante(p.comprobante).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err")); }}
      >
        <Paperclip size={13} /> Ver
      </button>
    );
  }
  if (p.tipo === "link") {
    return p.url
      ? <a className="link t-sm" href={p.url} target="_blank" rel="noreferrer" onClick={parar} title={p.texto}><Link2 size={13} /> Link</a>
      : <span className="t-sm t-subtle truncate" style={{ maxWidth: 140, display: "inline-block", verticalAlign: "bottom" }} title={`Comprobante de la planilla: ${p.texto}`}>{p.texto}</span>;
  }
  return pago.movimientoId
    ? <span className="t-sm t-subtle" title="Lo prueba el pago que llegó a la pasarela">Pasarela</span>
    : <Badge variante="warning">Falta</Badge>;
}

export function columnaComprobante(): Columna<FilaCobro> {
  return {
    clave: "comprobante", titulo: "Comprobante",
    info: {
      ayuda: "La prueba de que la plata entró: el archivo que subió el closer, o el link que traía la planilla. «Falta» es un cobro cargado a mano sin comprobante; un cobro conciliado con la pasarela se prueba con ella.",
    },
    orden: (f) => { const t = comprobanteDeCobro(f.pago).tipo; return t === "archivo" ? 2 : t === "link" ? 1 : f.pago.movimientoId ? 1 : 0; },
    celda: (f) => <CeldaComprobante pago={f.pago} />,
  };
}

export function columnaConciliado(e: Pick<EstadoApp, "procesadores">): Columna<FilaCobro> {
  return {
    clave: "conciliado", titulo: "Conciliado",
    info: {
      ayuda: "Si el cobro está atado al pago que llegó a la pasarela (Stripe, Hotmart, Whop…). «Sin conciliar»: la cuenta tiene pasarela y todavía no se ató. «A mano»: la cuenta no tiene pasarela (la Financiera, efectivo), se prueba con el comprobante.",
      formula: "Sí = el cobro tiene su pago de la pasarela\nSin conciliar = la cuenta tiene pasarela y el cobro no\nA mano = la cuenta no tiene pasarela",
    },
    orden: (f) => ["conciliado", "sin-conciliar", "a-mano"].indexOf(conciliacionDe(e.procesadores, f.pago)),
    celda: (f) => {
      const c = conciliacionDe(e.procesadores, f.pago);
      if (c === "conciliado") {
        const prov = e.procesadores.find((p) => p.id === f.pago.procesadorId)?.proveedor;
        return <Badge variante="success" icono={<Link2 size={13} />}>Sí{prov ? ` · ${nombrePasarela(prov)}` : ""}</Badge>;
      }
      return c === "sin-conciliar" ? <Badge variante="warning">Sin conciliar</Badge> : <Badge variante="neutral">A mano</Badge>;
    },
  };
}

export function columnaCargo(nombreDe: (por?: string) => string): Columna<FilaCobro> {
  return {
    clave: "cargo", titulo: "Cargó",
    info: { ayuda: "Quién cargó el cobro en la app (el correo con el que entró) y cuándo. Los cobros que vienen de la planilla de Angelo no tienen este dato." },
    orden: (f) => nombreDe(f.pago.cargadoPor),
    celda: (f) => (f.pago.cargadoPor
      ? <span title={fechaHora(f.pago.creadoEn)}>{nombreDe(f.pago.cargadoPor)}</span>
      : <span className="t-subtle" title="Este cobro se cargó antes de que la app anotara quién lo carga">—</span>),
  };
}

export function columnaChequeo(abrir: (pagoId: string) => void): Columna<FilaCobro> {
  return {
    clave: "chequeo", titulo: "Chequeo",
    info: {
      ayuda: "Control cruzado: después de que el closer carga el cobro, el director comercial o finanzas miran el comprobante y confirman que coincide con lo cargado. Con uno alcanza. Un clic abre el cobro, con el comprobante al lado de lo que se cargó.",
      formula: "Sin chequear = nadie lo miró todavía\nChequeado = el director o finanzas lo confirmaron (queda quién y cuándo)\nRechazado = alguien dijo que el comprobante no sirve, con el motivo\nChequeado · de antes = ya estaba marcado antes del control cruzado",
    },
    orden: (f) => ({ pendiente: 0, rechazado: 1, chequeado: 2 })[controlDeCobro(f.pago).estado],
    celda: (f) => <PildoraDeChequeo pago={f.pago} onAbrir={() => abrir(f.pago.id)} />,
  };
}

/** La celda «Control de cobros» de la lista de ventas: cuántos cobros de la venta
 *  faltan chequear o están rechazados. */
export function ControlDeVenta({ control }: { control?: { total: number; pendientes: number; rechazados: number } }) {
  if (!control || control.total === 0) return <span className="t-subtle" title="Esta venta no tiene cobros todavía">—</span>;
  if (control.rechazados > 0) {
    return <Badge variante="danger">{control.rechazados} {control.rechazados === 1 ? "rechazado" : "rechazados"}{control.pendientes ? ` · ${control.pendientes} sin chequear` : ""}</Badge>;
  }
  if (control.pendientes > 0) {
    return <Badge variante="warning">{control.pendientes} sin chequear</Badge>;
  }
  return <Badge variante="success">Todo chequeado</Badge>;
}
