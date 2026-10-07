"use client";

import React, { useMemo, useState } from "react";
import { FileSpreadsheet, Info, Receipt, ShieldCheck } from "lucide-react";
import { Ayuda, Button, Card, Chip, Empty } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { CopiarLink, SIN } from "@/components/ui/Filtros";
import { useToast } from "@/components/ui/Toast";
import { ModalChequeo, useNombreDeQuien } from "@/components/cobros/ControlCobro";
import { columnaCargo, columnaChequeo, columnaComprobante, columnaConciliado } from "@/components/cobros/columnasControl";
import { useAcceso } from "@/lib/acceso";
import {
  casilleroDe, filasDeCobros, FILTROS_CONTROL, pasaControl, TEXTO_DE_FILTRO, type FilaCobro, type FiltroControl,
} from "@/lib/control-cobros";
import { bajarExcel, excelCobros, filasExcelCobros } from "@/lib/excelCobros";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { fechaLarga, money, num } from "@/lib/format";
import { useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import type { EstadoApp, Venta } from "@/lib/types";

/* ==================================================================
   Ventas → Cobros: cada cobro, con su comprobante, si está conciliado,
   quién lo cargó y quién lo chequeó (control cruzado, lib/control-cobros).

   Es la lista del día de quien controla: el director comercial —que no ve
   Finanzas— chequea desde acá, con el comprobante al lado de lo que cargó
   el closer. Usa los mismos filtros, período y búsqueda que la lista de
   ventas (los resuelve la pantalla y llegan por props), y el Excel que baja
   lleva lo que se ve.

   En el link: ?mostrar (sin-chequear, rechazados, chequeados,
   sin-comprobante, sin-conciliar), ?orden-cobros y ?pag-cobros.
   ================================================================== */

export interface FiltrosDeCobros { vendedor: string; servicio: string; estrategia: string; proyecto: string; cuenta: string }
export const PARAMS_COBROS = ["mostrar"] as const;
export const PARAMS_TABLA_COBROS = ["orden-cobros", "pag-cobros"] as const;

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* Una venta pasa los filtros de la lista: vendedor, servicio, estrategia y proyecto. */
export function pasaFiltrosDeVenta(v: Venta | undefined, f: Omit<FiltrosDeCobros, "cuenta">): boolean {
  return (!f.vendedor || (v?.closerId || SIN) === f.vendedor)
    && (!f.servicio || (v?.productoId || SIN) === f.servicio)
    && (!f.estrategia || (v?.embudoId || SIN) === f.estrategia)
    && (!f.proyecto || (v?.proyecto?.trim() || SIN) === f.proyecto);
}

/** Los cobros del período con los filtros de la lista, antes de elegir qué control mostrar. */
export function cobrosDeLaLista(
  e: EstadoApp, desde: string, hasta: string, filtros: FiltrosDeCobros, busca: string,
): FilaCobro[] {
  const t = normal(busca.trim());
  return filasDeCobros(e, e.pagos).filter((f) => {
    const dia = diaDeNegocio(f.pago.fecha);
    if (!dia || dia < desde || dia > hasta) return false;
    if (!pasaFiltrosDeVenta(f.venta, filtros)) return false;
    if (filtros.cuenta && f.pago.procesadorId !== filtros.cuenta) return false;
    return !t || normal(f.venta?.contactoNombre ?? "").includes(t) || normal(f.pago.pagador ?? "").includes(t);
  });
}

/** Lo que suman los cobros, en centavos enteros (sin restos de punto flotante). */
export const sumarCobros = (filas: readonly FilaCobro[]): number =>
  filas.reduce((a, f) => a + Math.round(f.pago.monto * 100), 0) / 100;

export function ListaCobros({ e, desde, hasta, filtros, busca, hayFiltros, onLimpiar, cabecera }: {
  e: EstadoApp; desde: string; hasta: string; filtros: FiltrosDeCobros; busca: string;
  hayFiltros: boolean; onLimpiar: () => void;
  /* Los filtros de la pantalla (vendedor, servicio, búsqueda…), arriba de los chips. */
  cabecera?: React.ReactNode;
}) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const nombreDe = useNombreDeQuien();
  const puedeChequear = casilleroDe(acceso) !== null;
  /* Quien controla arranca en lo que le falta; el resto, en todo. */
  const [url, setUrl] = useParamsURL({ mostrar: puedeChequear ? "sin-chequear" : "todos" });
  const mostrar: FiltroControl = (FILTROS_CONTROL as readonly string[]).includes(url.mostrar) ? (url.mostrar as FiltroControl) : "todos";
  const [abierto, setAbierto] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  const enLaLista = useMemo(
    () => cobrosDeLaLista(e, desde, hasta, filtros, busca),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [e.pagos, e.cuotas, e.ventas, desde, hasta, filtros.vendedor, filtros.servicio, filtros.estrategia, filtros.proyecto, filtros.cuenta, busca],
  );
  const filas = useMemo(() => enLaLista.filter((f) => pasaControl(f.pago, e.procesadores, mostrar)), [enLaLista, e.procesadores, mostrar]);
  const cuenta = (m: FiltroControl) => enLaLista.filter((f) => pasaControl(f.pago, e.procesadores, m)).length;
  const total = sumarCobros(filas);

  const tabla = useTablaURL("cobros", { clave: "fecha", desc: true }, ["fecha", "cliente", "monto", "chequeo", "comprobante", "conciliado", "cuenta", "cargo"]);

  const columnas: Columna<FilaCobro>[] = [
    { clave: "fecha", titulo: "Fecha del cobro", tipo: "secondary", orden: (f) => f.pago.fecha, celda: (f) => fechaLarga(f.pago.fecha) },
    {
      clave: "cliente", titulo: "Cliente", tipo: "primary", orden: (f) => f.venta?.contactoNombre ?? "",
      celda: (f) => {
        const servicio = f.venta?.productoId ? e.productos.find((p) => p.id === f.venta?.productoId)?.nombre : undefined;
        const closer = f.venta?.closerId ? e.equipo.find((p) => p.id === f.venta?.closerId)?.nombre : undefined;
        const cuota = f.pago.caracteristica ?? (f.cuota ? (f.cuota.esReserva ? "Reserva" : `Cuota ${f.cuota.numero}`) : undefined);
        const resto = [servicio, cuota, closer].filter(Boolean).join(" · ");
        return (
          <span style={{ display: "block", minWidth: 0 }}>
            <span className="truncate" style={{ display: "block" }}>{f.venta?.contactoNombre ?? "Sin venta"}</span>
            {resto && <span className="t-sm t-subtle truncate" style={{ display: "block" }}>{resto}</span>}
          </span>
        );
      },
      pie: <strong>Total · {num(filas.length)} {filas.length === 1 ? "cobro" : "cobros"}</strong>,
    },
    {
      clave: "monto", titulo: "Monto USD", tipo: "num", orden: (f) => f.pago.monto, celda: (f) => money(f.pago.monto, "USD", 2),
      pie: <strong className="t-num">{money(total, "USD", 2)}</strong>,
      info: {
        ayuda: "Lo que entró en este cobro, en dólares. Abajo, la suma de todos los cobros de la vista (de todas las páginas): es el Cash Collected (CC) de lo que estás mirando.",
        formula: "Cash Collected (CC) de la vista = suma de «Monto USD» de los cobros que cumplen el período y los filtros",
        componentes: () => [
          { concepto: "Cobros en la vista", valor: num(filas.length) },
          { concepto: "Cash Collected (CC) de la vista", valor: money(total, "USD", 2), signo: "=" },
        ],
      },
    },
    /* Lo que se controla va primero: el chequeo y el comprobante se ven sin bajar por la tabla. */
    columnaChequeo(setAbierto),
    columnaComprobante(),
    columnaConciliado(e),
    {
      clave: "cuenta", titulo: "Cuenta", tipo: "secondary",
      orden: (f) => e.procesadores.find((p) => p.id === f.pago.procesadorId)?.nombre ?? "",
      celda: (f) => e.procesadores.find((p) => p.id === f.pago.procesadorId)?.nombre ?? "Sin cuenta",
    },
    columnaCargo(nombreDe),
  ];

  async function descargar() {
    if (filas.length === 0 || bajando) return;
    setBajando(true);
    try {
      const { nombre, datos, sinLink } = await excelCobros(filasExcelCobros(e, filas.map((f) => f.pago)), desde, hasta);
      bajarExcel(nombre, datos);
      toast(sinLink
        ? `Se bajó el Excel. ${sinLink === 1 ? "Un comprobante no se pudo firmar: va" : `${sinLink} comprobantes no se pudieron firmar: van`} con el nombre del archivo.`
        : `Se bajó el Excel con ${num(filas.length)} ${filas.length === 1 ? "cobro" : "cobros"}.`, sinLink ? "info" : "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo armar el Excel.", "err");
    } finally {
      setBajando(false);
    }
  }

  const todoAlDia = mostrar === "sin-chequear" && enLaLista.length > 0;

  return (
    <div className="stack-4">
      <Card className="cobros-tabla" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          {cabecera}
          <div className="toolbar">
            {FILTROS_CONTROL.map((k) => (
              <Chip key={k} activo={mostrar === k} onClick={() => setUrl({ mostrar: k }, { "pag-cobros": null })} count={cuenta(k)}>
                {TEXTO_DE_FILTRO[k]}
              </Chip>
            ))}
            <span className="spacer" />
            {hayFiltros && <Button sm variante="ghost" onClick={onLimpiar}>Limpiar filtros</Button>}
            <Button sm variante="secondary" icono={<FileSpreadsheet size={15} />} disabled={filas.length === 0 || bajando} onClick={descargar}>
              {bajando ? "Armando el Excel…" : "Descargar Excel"}
            </Button>
            <CopiarLink />
          </div>
        </div>
        <DataTable
          alto={620} porPagina={50}
          filas={filas} columnas={columnas}
          orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina}
          onFila={(f) => setAbierto(f.pago.id)} etiquetaFila={(f) => `Abrir el cobro de ${f.venta?.contactoNombre ?? "este cliente"}`}
          vacio={todoAlDia ? (
            <Empty icono={<ShieldCheck size={22} />} titulo="Todo chequeado" texto="No queda ningún cobro por chequear con estos filtros. Cuando un closer cargue uno, aparece acá." />
          ) : (
            <Empty
              icono={<Receipt size={22} />} titulo="Ningún cobro coincide"
              texto={hayFiltros || mostrar !== "todos" ? "Probá con otro período o sacá algún filtro." : "En este período no entró ningún cobro."}
              accion={hayFiltros ? <Button variante="secondary" onClick={onLimpiar}>Limpiar filtros</Button> : undefined}
            />
          )}
        />
      </Card>

      <Ayuda titulo="Cómo se chequea un cobro" icono={<Info size={18} />}>
        El closer carga el cobro y sube su comprobante; después <strong>otra persona</strong> lo mira: el director comercial o finanzas.
        Un clic en el cobro abre el comprobante <strong>al lado de lo que se cargó</strong> (nombre, mail, monto, medio y cuántos pagos);
        si coincide, «Chequeado» (se confirma dos veces) y queda anotado quién y cuándo. Con que uno de los dos lo chequee alcanza.
        Si el comprobante no sirve se rechaza con el motivo y el closer puede subir otro. Chequear no cambia ningún número.
      </Ayuda>

      {abierto && <ModalChequeo pagoId={abierto} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}
