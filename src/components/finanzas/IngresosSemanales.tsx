"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, IconButton, StatCard } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { ChequeoDeCobro } from "@/components/cobros/ControlCobro";
import { filasDeCobros, type FilaCobro } from "@/lib/control-cobros";
import { bajarExcel, excelCobros, filasExcelCobros } from "@/lib/excelCobros";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { cashCollected } from "@/lib/finanzas";
import { delta, fechaLarga, money, num, pct } from "@/lib/format";
import {
  cobrosDeCelda, devolucionesDeCelda, DEVOLUCIONES, diasDelRango, etiquetaDeRango, ingresosPorCuentaYServicio, moverDias, semanaDe,
  SIN_CUENTA, SIN_SERVICIO, type CeldaIngreso,
} from "@/lib/ingresos-semanales";
import { periodoAnterior, rangoDeFechas } from "@/lib/metricas";
import { useParamsURL } from "@/lib/useParamsURL";
import type { Devolucion, EstadoApp, Venta } from "@/lib/types";

/* ==================================================================
   Ingresos de la semana, por cuenta y por servicio (lib/ingresos-semanales.ts).

   Angelo (02/10): para supervisar cada semana —«no espero que pase todo el
   mes para conciliar»— los ingresos semanales por cuenta y por producto:
   dentro de Stripe entraron varios productos. La tabla es el Cash Collected
   del rango partido en cuenta × servicio, por fecha de COBRO, con los totales
   al pie y a la derecha: cierran con el Cash Collected del mismo rango. Cada
   celda abre los cobros que la forman.

   El Cash Collected es lo cobrado MENOS lo devuelto (lib/devoluciones.ts), así
   que lo devuelto en el rango va en su propia fila, «Devoluciones», en negativo
   y en la columna del servicio de la venta devuelta: los totales de abajo y de
   la derecha ya la incluyen y dan el mismo número que el Dashboard y el estado
   de resultados. Sus celdas abren las devoluciones; las demás, los cobros. El
   Excel sigue siendo de los cobros.

   En el link: ?sdesde y ?shasta (sin ellos, la semana de hoy, de lunes a
   domingo). Las flechas mueven el rango de a su largo; el calendario deja
   elegir cualquier otro.
   ================================================================== */

const esDia = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Lo que se abre al tocar un número: de qué cuenta y de qué servicio (o de todo). */
interface Seleccion { cuentaId?: string; servicioId?: string; titulo: string }

/* Una devolución en la lista que se abre, con la venta de la que es. */
interface FilaDevolucion { id: string; devolucion: Devolucion; venta?: Venta }

/* «7 cobros», «7 cobros y 1 devolución», «2 devoluciones»: lo que suma (o resta) un número. */
function cuantos(cobros: number, devoluciones: number): string {
  const partes: string[] = [];
  if (cobros > 0 || devoluciones === 0) partes.push(`${num(cobros)} ${cobros === 1 ? "cobro" : "cobros"}`);
  if (devoluciones > 0) partes.push(`${num(devoluciones)} ${devoluciones === 1 ? "devolución" : "devoluciones"}`);
  return partes.join(" y ");
}

export function IngresosSemanales({ e }: { e: EstadoApp }) {
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon, 2);
  const [url, setUrl] = useParamsURL({ sdesde: "", shasta: "" });
  const [abierta, setAbierta] = useState<Seleccion | null>(null);
  const [bajando, setBajando] = useState(false);

  const hoy = diaDeNegocio(new Date().toISOString());
  const actual = semanaDe(hoy);
  const { desde, hasta } = esDia(url.sdesde) && esDia(url.shasta) && url.sdesde <= url.shasta
    ? { desde: url.sdesde, hasta: url.shasta }
    : actual;
  const dias = diasDelRango(desde, hasta);
  const esActual = desde === actual.desde && hasta === actual.hasta;
  const etiqueta = etiquetaDeRango(desde, hasta, hoy);
  const ir = (n: number) => {
    const d = moverDias(desde, n * dias), h = moverDias(hasta, n * dias);
    setUrl(d === actual.desde && h === actual.hasta ? { sdesde: null, shasta: null } : { sdesde: d, shasta: h });
  };

  const rango = useMemo(() => rangoDeFechas(desde, hasta, etiqueta), [desde, hasta, etiqueta]);
  const r = useMemo(() => ingresosPorCuentaYServicio(e, rango), [e, rango]);
  const anterior = useMemo(() => {
    const a = periodoAnterior(desde, hasta);
    return { ...a, cc: cashCollected(e, rangoDeFechas(a.desde, a.hasta, "anterior")) };
  }, [e, desde, hasta]);
  const primerDia = useMemo(() => e.pagos.map((p) => diaDeNegocio(p.fecha)).filter(Boolean).sort()[0] ?? null, [e.pagos]);

  /* Las cuentas son de cobros; lo devuelto es la última fila. Los tops miran lo COBRADO (lo que
     entró antes de las devoluciones): su parte es "de lo cobrado", no del Cash Collected. */
  const cuentasDeCobros = r.cuentas.filter((c) => c.id !== DEVOLUCIONES);
  const cuentaTop = cuentasDeCobros.find((c) => c.id !== SIN_CUENTA) ?? cuentasDeCobros[0];
  const servicioTop = r.servicios.find((s) => s.id !== SIN_SERVICIO && s.cobrado.cobros > 0) ?? r.servicios.find((s) => s.cobrado.cobros > 0);
  const hayDevoluciones = r.devuelto.devoluciones > 0;
  /* Neto contra neto, en centavos enteros: dos semanas iguales dan 0 %, sin restos de punto flotante. */
  const ccAnterior = Math.round(anterior.cc * 100);
  const cambio = ccAnterior > 0 ? ((r.total.centavos - ccAnterior) / ccAnterior) * 100 : null;

  /* Una celda de la tabla: su monto, que al tocarlo abre los cobros (y las devoluciones) que lo forman. */
  const boton = (celda: CeldaIngreso | undefined, sel: Seleccion, fuerte = false) =>
    celda && celda.cobros + celda.devoluciones > 0 ? (
      <button
        type="button" className={`ingreso-celda${fuerte ? " ingreso-celda--fuerte" : ""}`} onClick={() => setAbierta(sel)}
        title={`${cuantos(celda.cobros, celda.devoluciones)}: tocá para ${celda.devoluciones === 0 ? "verlos" : "ver el detalle"}`}
        aria-label={`${sel.titulo}: ${M(celda.monto)}, ${cuantos(celda.cobros, celda.devoluciones)}. ${celda.devoluciones === 0 ? "Ver los cobros" : "Ver el detalle"}`}
      >
        {M(celda.monto)}
      </button>
    ) : <span className="t-subtle">—</span>;

  const columnas: Columna<(typeof r.cuentas)[number]>[] = [
    {
      clave: "cuenta", titulo: "Cuenta", tipo: "primary",
      info: {
        ayuda: "Cada fila es una cuenta recaudadora (el medio por donde entró la plata) y cada columna, un servicio. Cada número es lo que se cobró en el rango de esa cuenta por ese servicio, por la fecha del cobro. La fila «Devoluciones» (si hubo) resta lo que se devolvió en el rango, por el día que salió la plata y en el servicio de la venta devuelta. Tocá un número para ver los cobros y devoluciones que lo forman.",
        formula: "Celda = suma de los cobros del rango de esa cuenta y de ese servicio (el servicio es el de la venta)\nFila «Devoluciones» = lo devuelto en el rango (devoluciones confirmadas), en negativo, por el servicio de cada venta\nTotal de la fila = suma de sus celdas\nTotal de la columna = lo cobrado de ese servicio menos lo devuelto\nTotal general = Cash Collected (CC) del rango = cobrado − devuelto",
      },
      celda: (c) => (c.id === DEVOLUCIONES ? <span className="t-muted">{c.nombre}</span> : c.nombre),
      pie: <strong>Total</strong>,
    },
    ...r.servicios.map((s): Columna<(typeof r.cuentas)[number]> => ({
      clave: `s-${s.id}`, titulo: s.nombre, tipo: "num",
      celda: (c) => boton(c.porServicio[s.id], { cuentaId: c.id, servicioId: s.id, titulo: `${c.nombre} · ${s.nombre}` }),
      pie: boton(s.total, { servicioId: s.id, titulo: s.nombre }, true),
    })),
    {
      clave: "total", titulo: "Total", tipo: "num",
      info: {
        ayuda: "Lo que entró por esa cuenta en el rango, sumando todos los servicios; en la fila «Devoluciones», lo que se devolvió. Abajo a la derecha, el total general: es el Cash Collected (CC) del mismo rango (lo cobrado menos lo devuelto), el mismo número del Dashboard y del estado de resultados.",
        formula: "Total de la fila = suma de lo cobrado por esa cuenta (en «Devoluciones», lo devuelto, en negativo)\nTotal general = Cash Collected (CC) del rango = cobrado − devuelto",
        componentes: () => [
          ...cuentasDeCobros.map((c, i) => ({ concepto: c.nombre, valor: M(c.total.monto), signo: (i === 0 ? undefined : "+") as "+" | undefined, nota: cuantos(c.total.cobros, 0) })),
          ...(hayDevoluciones ? [{ concepto: "Devoluciones", valor: M(-r.devuelto.monto), signo: "−" as const, nota: cuantos(0, r.devuelto.devoluciones) }] : []),
          { concepto: "Cash Collected (CC)", valor: M(r.total.monto), signo: "=" as const },
        ],
      },
      celda: (c) => boton(c.total, { cuentaId: c.id, titulo: c.nombre }, true),
      pie: boton(r.total, { titulo: hayDevoluciones ? "Todos los cobros y devoluciones" : "Todos los cobros" }, true),
    },
  ];

  async function descargar() {
    if (r.pagos.length === 0 || bajando) return;
    setBajando(true);
    try {
      const { nombre, datos, sinLink } = await excelCobros(filasExcelCobros(e, r.pagos), desde, hasta);
      bajarExcel(nombre, datos);
      toast(sinLink
        ? `Se bajó el Excel. ${sinLink === 1 ? "Un comprobante no se pudo firmar: va" : `${sinLink} comprobantes no se pudieron firmar: van`} con el nombre del archivo.`
        : `Se bajó el Excel con los ${num(r.pagos.length)} ${r.pagos.length === 1 ? "cobro" : "cobros"} de la semana.`, sinLink ? "info" : "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo armar el Excel.", "err");
    } finally {
      setBajando(false);
    }
  }

  const cobros = useMemo(
    () => (abierta ? filasDeCobros(e, cobrosDeCelda(e, r, abierta.cuentaId, abierta.servicioId)).sort((a, b) => b.pago.fecha.localeCompare(a.pago.fecha)) : []),
    [abierta, e, r],
  );
  const devueltas = useMemo((): FilaDevolucion[] => {
    if (!abierta) return [];
    const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
    return devolucionesDeCelda(e, r, abierta.cuentaId, abierta.servicioId)
      .map((d) => ({ id: d.id, devolucion: d, venta: d.ventaId ? ventaDe.get(d.ventaId) : undefined }))
      .sort((a, b) => b.devolucion.fecha.localeCompare(a.devolucion.fecha));
  }, [abierta, e, r]);
  const centavosCobros = cobros.reduce((a, f) => a + Math.round(f.pago.monto * 100), 0);
  const centavosDevueltos = devueltas.reduce((a, f) => a + Math.round(f.devolucion.monto * 100), 0);
  /* Lo que vale el número que se tocó: lo cobrado menos lo devuelto. */
  const centavosAbierta = centavosCobros - centavosDevueltos;

  const columnasCobros: Columna<FilaCobro>[] = [
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", celda: (f) => fechaLarga(f.pago.fecha) },
    {
      clave: "cliente", titulo: "Cliente", tipo: "primary",
      celda: (f) => (
        <span style={{ display: "block", minWidth: 0 }}>
          <span className="truncate" style={{ display: "block" }}>{f.venta?.contactoNombre ?? "Sin venta"}</span>
          <span className="t-sm t-subtle truncate" style={{ display: "block" }}>
            {f.pago.caracteristica ?? (f.cuota ? (f.cuota.esReserva ? "Reserva" : `Cuota ${f.cuota.numero}`) : "Cobro")}
          </span>
        </span>
      ),
      pie: <strong>Total · {num(cobros.length)}</strong>,
    },
    { clave: "monto", titulo: "Monto", tipo: "num", celda: (f) => M(f.pago.monto), pie: <strong className="t-num">{M(centavosCobros / 100)}</strong> },
    { clave: "chequeo", titulo: "Chequeo", celda: (f) => <span onClick={(ev) => ev.stopPropagation()}><ChequeoDeCobro pago={f.pago} /></span> },
  ];

  const columnasDevueltas: Columna<FilaDevolucion>[] = [
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", celda: (f) => fechaLarga(f.devolucion.fecha) },
    {
      clave: "cliente", titulo: "Devolución de", tipo: "primary",
      celda: (f) => (
        <span style={{ display: "block", minWidth: 0 }}>
          <span className="truncate" style={{ display: "block" }}>{f.venta?.contactoNombre ?? "Sin venta"}</span>
          <span className="t-sm t-subtle truncate" style={{ display: "block" }}>
            {["Devolución", e.procesadores.find((x) => x.id === f.devolucion.procesadorId)?.nombre].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
      pie: <strong>Total · {num(devueltas.length)}</strong>,
    },
    { clave: "monto", titulo: "Monto", tipo: "num", celda: (f) => M(-f.devolucion.monto), pie: <strong className="t-num">{M(-centavosDevueltos / 100)}</strong> },
  ];

  const hayCobros = r.pagos.length > 0;

  return (
    <section className="stack-4" aria-label="Ingresos de la semana">
      <Card>
        <CardHead
          titulo="Ingresos de la semana"
          sub="Lo que entró de verdad (Cash Collected: lo cobrado menos lo devuelto), por cuenta y por servicio, según la fecha del cobro. Para supervisar cada semana sin esperar a fin de mes."
        />
        <div className="row-wrap ingresos-rango">
          <IconButton etiqueta={dias === 7 ? "La semana anterior" : `Los ${dias} días anteriores`} onClick={() => ir(-1)}><ChevronLeft size={16} /></IconButton>
          <DateRangePicker
            value={{ preset: "custom", desde, hasta }} minDate={primerDia} maxDate={hoy} etiqueta={etiqueta}
            onApply={(x) => setUrl(x.desde === actual.desde && x.hasta === actual.hasta ? { sdesde: null, shasta: null } : { sdesde: x.desde, shasta: x.hasta })}
            footerNota="Por la fecha del cobro (y de la devolución) · zona horaria de Argentina"
          />
          <IconButton etiqueta={dias === 7 ? "La semana siguiente" : `Los ${dias} días siguientes`} onClick={() => ir(1)} disabled={moverDias(desde, dias) > hoy}><ChevronRight size={16} /></IconButton>
          {!esActual && (
            <Button sm variante="ghost" icono={<CalendarDays size={15} />} onClick={() => setUrl({ sdesde: null, shasta: null })}>Esta semana</Button>
          )}
        </div>

        <div className="grid-stats ingresos-stats">
          <StatCard
            hero etiqueta="Cash Collected (CC)" valor={M(r.total.monto)}
            direccion={cambio === null ? "neutral" : cambio >= 0 ? "up" : "down"}
            delta={cambio === null ? undefined : delta(cambio)}
            contexto={`${cuantos(r.total.cobros, r.total.devoluciones)} · antes ${M(anterior.cc)}`}
            info={{
              ayuda: "Lo que entró de verdad en el rango: todos los cobros por su fecha de cobro, menos lo que se devolvió, por el día que salió la plata. Es el mismo número que el Cash Collected del Dashboard y del estado de resultados para esas fechas, y se compara con el del rango anterior, que se calcula igual.",
              formula: "Cash Collected (CC) = suma de los cobros con fecha de cobro dentro del rango − suma de las devoluciones confirmadas con fecha dentro del rango\nVariación = (CC del rango − CC del rango anterior del mismo largo) ÷ CC del rango anterior",
              periodo: etiqueta,
              componentes: () => [
                ...cuentasDeCobros.map((c, i) => ({ concepto: c.nombre, valor: M(c.total.monto), signo: (i === 0 ? undefined : "+") as "+" | undefined })),
                ...(hayDevoluciones ? [{ concepto: "Devoluciones", valor: M(-r.devuelto.monto), signo: "−" as const, nota: cuantos(0, r.devuelto.devoluciones) }] : []),
                { concepto: "Cash Collected (CC)", valor: M(r.total.monto), signo: "=" as const, nota: cuantos(r.total.cobros, 0) },
                { concepto: `El rango anterior (${etiquetaDeRango(anterior.desde, anterior.hasta, hoy)})`, valor: M(anterior.cc) },
              ],
            }}
          />
          <StatCard
            etiqueta="La cuenta que más entró" valor={cuentaTop ? M(cuentaTop.total.monto) : "—"}
            contexto={cuentaTop ? `${cuentaTop.nombre} · ${pct((cuentaTop.total.centavos / Math.max(r.cobrado.centavos, 1)) * 100, 0)} ${hayDevoluciones ? "de lo cobrado" : "del total"}` : "Sin cobros en este rango"}
            info={{
              ayuda: "La cuenta recaudadora por la que entró más plata en el rango, y qué parte de lo cobrado es (antes de restar las devoluciones, que no son de una cuenta sino de la venta).",
              formula: "Parte de lo cobrado = lo cobrado por esa cuenta ÷ lo cobrado en el rango\nSin devoluciones en el rango, lo cobrado es el Cash Collected (CC)",
            }}
          />
          <StatCard
            etiqueta="El servicio que más entró" valor={servicioTop ? M(servicioTop.cobrado.monto) : "—"}
            contexto={servicioTop ? `${servicioTop.nombre} · ${pct((servicioTop.cobrado.centavos / Math.max(r.cobrado.centavos, 1)) * 100, 0)} ${hayDevoluciones ? "de lo cobrado" : "del total"}` : "Sin cobros en este rango"}
            info={{
              ayuda: "El servicio (el de la venta de cada cobro) por el que entró más plata en el rango, y qué parte de lo cobrado es (antes de restar lo que se devolvió de ese servicio, que muestra la fila «Devoluciones»).",
              formula: "Parte de lo cobrado = lo cobrado de ese servicio ÷ lo cobrado en el rango\nSin devoluciones en el rango, lo cobrado es el Cash Collected (CC)",
            }}
          />
        </div>
      </Card>

      <Card style={{ padding: 0 }} className="cobros-tabla ingresos-tabla">
        <div className="row-wrap" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <span className="t-sm t-muted">
            {hayCobros
              ? <>Del <strong>{etiqueta}</strong> · {num(r.total.cobros)} {r.total.cobros === 1 ? "cobro" : "cobros"} en {num(cuentasDeCobros.length)} {cuentasDeCobros.length === 1 ? "cuenta" : "cuentas"}{hayDevoluciones && <> · {cuantos(0, r.total.devoluciones)}</>}</>
              : hayDevoluciones
                ? <>Del <strong>{etiqueta}</strong> · {cuantos(0, r.total.devoluciones)}</>
                : <>Del <strong>{etiqueta}</strong></>}
          </span>
          <span className="spacer" />
          <Button sm variante="secondary" icono={<FileSpreadsheet size={15} />} disabled={!hayCobros || bajando} onClick={descargar}>
            {bajando ? "Armando el Excel…" : "Descargar Excel de los cobros"}
          </Button>
        </div>
        <DataTable
          filas={r.cuentas} columnas={columnas}
          vacio={
            <Empty
              icono={<Wallet size={22} />} titulo={`Sin cobros del ${etiqueta}`}
              texto="No entró ningún cobro en estas fechas. Cuando entre uno, aparece acá con su cuenta y su servicio."
              accion={!esActual ? <Button variante="secondary" onClick={() => setUrl({ sdesde: null, shasta: null })}>Volver a esta semana</Button> : undefined}
            />
          }
        />
      </Card>

      <Drawer
        abierto={abierta !== null} onCerrar={() => setAbierta(null)}
        titulo={abierta?.titulo ?? ""} sub={`${etiqueta} · ${cuantos(cobros.length, devueltas.length)} · ${M(centavosAbierta / 100)}`}
      >
        <div className="stack-3 cobros-tabla">
          <p className="t-sm t-muted">
            {devueltas.length > 0 ? "Estos son los cobros que se suman en ese número y las devoluciones que se restan." : "Estos son los cobros que se suman en ese número."}
            {" "}Un clic abre la ficha de la venta; el chequeo muestra si el director o finanzas ya miraron el comprobante.
          </p>
          {(cobros.length > 0 || devueltas.length === 0) && (
            <DataTable
              filas={cobros} columnas={columnasCobros}
              onFila={(f) => { if (f.venta) { setAbierta(null); abrirFicha(f.venta.id, "ventas", { venta: f.venta.id }); } }}
              etiquetaFila={(f) => `Abrir la ficha de ${f.venta?.contactoNombre ?? "este cliente"}`}
              vacio={<Empty icono={<Wallet size={22} />} titulo="Sin cobros" texto="No hay cobros en este número." />}
            />
          )}
          {devueltas.length > 0 && (
            <DataTable
              filas={devueltas} columnas={columnasDevueltas}
              onFila={(f) => { if (f.venta) { setAbierta(null); abrirFicha(f.venta.id, "ventas", { venta: f.venta.id }); } }}
              etiquetaFila={(f) => `Abrir la ficha de ${f.venta?.contactoNombre ?? "este cliente"}`}
              vacio={null}
            />
          )}
          {cobros.some((f) => !f.venta) && <Badge variante="warning">Hay cobros sin venta: no se pueden abrir</Badge>}
          {devueltas.some((f) => !f.venta) && <Badge variante="warning">Hay devoluciones sin venta: no se pueden abrir</Badge>}
        </div>
      </Drawer>
    </section>
  );
}
