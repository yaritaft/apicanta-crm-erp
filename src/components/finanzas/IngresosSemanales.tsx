"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, IconButton, StatCard } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Drawer } from "@/components/ui/Drawer";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { ChequeoDeCobro } from "@/components/cobros/ControlCobro";
import { filasDeCobros, type FilaCobro } from "@/lib/control-cobros";
import { bajarExcel, excelCobros, filasExcelCobros } from "@/lib/excelCobros";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { cashCollected } from "@/lib/finanzas";
import { delta, fechaLarga, money, num, pct } from "@/lib/format";
import {
  cobrosDeCelda, diasDelRango, etiquetaDeRango, ingresosPorCuentaYServicio, moverDias, semanaDe, SIN_CUENTA, SIN_SERVICIO,
  type CeldaIngreso,
} from "@/lib/ingresos-semanales";
import { periodoAnterior, rangoDeFechas } from "@/lib/metricas";
import { useParamsURL } from "@/lib/useParamsURL";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Ingresos de la semana, por cuenta y por servicio (lib/ingresos-semanales.ts).

   Angelo (02/10): para supervisar cada semana —«no espero que pase todo el
   mes para conciliar»— los ingresos semanales por cuenta y por producto:
   dentro de Stripe entraron varios productos. La tabla es el Cash Collected
   del rango partido en cuenta × servicio, por fecha de COBRO, con los totales
   al pie y a la derecha: cierran con el Cash Collected del mismo rango. Cada
   celda abre los cobros que la forman.

   En el link: ?sdesde y ?shasta (sin ellos, la semana de hoy, de lunes a
   domingo). Las flechas mueven el rango de a su largo; el calendario deja
   elegir cualquier otro.
   ================================================================== */

const esDia = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Lo que se abre al tocar un número: de qué cuenta y de qué servicio (o de todo). */
interface Seleccion { cuentaId?: string; servicioId?: string; titulo: string }

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

  const cuentaTop = r.cuentas.find((c) => c.id !== SIN_CUENTA) ?? r.cuentas[0];
  const servicioTop = r.servicios.find((s) => s.id !== SIN_SERVICIO) ?? r.servicios[0];
  const cambio = anterior.cc > 0 ? ((r.total.monto - anterior.cc) / anterior.cc) * 100 : null;

  /* Una celda de la tabla: su monto, que al tocarlo abre los cobros que lo forman. */
  const boton = (celda: CeldaIngreso | undefined, sel: Seleccion, fuerte = false) =>
    celda && celda.cobros > 0 ? (
      <button
        type="button" className={`ingreso-celda${fuerte ? " ingreso-celda--fuerte" : ""}`} onClick={() => setAbierta(sel)}
        title={`${celda.cobros} ${celda.cobros === 1 ? "cobro" : "cobros"}: tocá para verlos`}
        aria-label={`${sel.titulo}: ${M(celda.monto)}, ${celda.cobros} ${celda.cobros === 1 ? "cobro" : "cobros"}. Ver los cobros`}
      >
        {M(celda.monto)}
      </button>
    ) : <span className="t-subtle">—</span>;

  const columnas: Columna<(typeof r.cuentas)[number]>[] = [
    {
      clave: "cuenta", titulo: "Cuenta", tipo: "primary",
      info: {
        ayuda: "Cada fila es una cuenta recaudadora (el medio por donde entró la plata) y cada columna, un servicio. Cada número es lo que se cobró en el rango de esa cuenta por ese servicio, por la fecha del cobro. Tocá un número para ver los cobros que lo forman.",
        formula: "Celda = suma de los cobros del rango de esa cuenta y de ese servicio (el servicio es el de la venta)\nTotal de la fila = suma de sus celdas\nTotal de la columna = suma de sus celdas\nTotal general = Cash Collected (CC) del rango",
      },
      celda: (c) => c.nombre,
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
        ayuda: "Lo que entró por esa cuenta en el rango, sumando todos los servicios. Abajo a la derecha, el total general: es el Cash Collected (CC) del mismo rango, el mismo número del Dashboard y del estado de resultados.",
        formula: "Total de la fila = suma de lo cobrado por esa cuenta\nTotal general = Cash Collected (CC) del rango",
        componentes: () => [
          ...r.cuentas.map((c, i) => ({ concepto: c.nombre, valor: M(c.total.monto), signo: (i === 0 ? undefined : "+") as "+" | undefined, nota: `${num(c.total.cobros)} ${c.total.cobros === 1 ? "cobro" : "cobros"}` })),
          { concepto: "Cash Collected (CC)", valor: M(r.total.monto), signo: "=" as const },
        ],
      },
      celda: (c) => boton(c.total, { cuentaId: c.id, titulo: c.nombre }, true),
      pie: boton(r.total, { titulo: "Todos los cobros" }, true),
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
  const centavosAbierta = cobros.reduce((a, f) => a + Math.round(f.pago.monto * 100), 0);

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
    { clave: "monto", titulo: "Monto", tipo: "num", celda: (f) => M(f.pago.monto), pie: <strong className="t-num">{M(centavosAbierta / 100)}</strong> },
    { clave: "chequeo", titulo: "Chequeo", celda: (f) => <span onClick={(ev) => ev.stopPropagation()}><ChequeoDeCobro pago={f.pago} /></span> },
  ];

  const hayCobros = r.pagos.length > 0;

  return (
    <section className="stack-4" aria-label="Ingresos de la semana">
      <Card>
        <CardHead
          titulo="Ingresos de la semana"
          sub="Lo que entró de verdad (Cash Collected), por cuenta y por servicio, según la fecha del cobro. Para supervisar cada semana sin esperar a fin de mes."
        />
        <div className="row-wrap ingresos-rango">
          <IconButton etiqueta="El rango anterior" onClick={() => ir(-1)}><ChevronLeft size={16} /></IconButton>
          <DateRangePicker
            value={{ preset: "custom", desde, hasta }} minDate={primerDia} maxDate={hoy} etiqueta={etiqueta}
            onApply={(x) => setUrl(x.desde === actual.desde && x.hasta === actual.hasta ? { sdesde: null, shasta: null } : { sdesde: x.desde, shasta: x.hasta })}
            footerNota="Por la fecha del cobro · zona horaria de Argentina"
          />
          <IconButton etiqueta="El rango siguiente" onClick={() => ir(1)} disabled={moverDias(desde, dias) > hoy}><ChevronRight size={16} /></IconButton>
          {!esActual && (
            <Button sm variante="ghost" icono={<CalendarDays size={15} />} onClick={() => setUrl({ sdesde: null, shasta: null })}>Esta semana</Button>
          )}
        </div>

        <div className="grid-stats ingresos-stats">
          <StatCard
            hero etiqueta="Cash Collected (CC)" valor={M(r.total.monto)}
            direccion={cambio === null ? "neutral" : cambio >= 0 ? "up" : "down"}
            delta={cambio === null ? undefined : delta(cambio)}
            contexto={`${num(r.total.cobros)} ${r.total.cobros === 1 ? "cobro" : "cobros"} · antes ${M(anterior.cc)}`}
            info={{
              ayuda: "Lo que entró de verdad en el rango, sumando todos los cobros por su fecha de cobro. Es el mismo número que el Cash Collected del Dashboard y del estado de resultados para esas fechas.",
              formula: "Cash Collected (CC) = suma de los cobros con fecha de cobro dentro del rango\nVariación = (CC del rango − CC del rango anterior del mismo largo) ÷ CC del rango anterior",
              periodo: etiqueta,
              componentes: () => [
                ...r.cuentas.map((c, i) => ({ concepto: c.nombre, valor: M(c.total.monto), signo: (i === 0 ? undefined : "+") as "+" | undefined })),
                { concepto: "Cash Collected (CC)", valor: M(r.total.monto), signo: "=" as const, nota: `${num(r.total.cobros)} cobros` },
                { concepto: `El rango anterior (${etiquetaDeRango(anterior.desde, anterior.hasta, hoy)})`, valor: M(anterior.cc) },
              ],
            }}
          />
          <StatCard
            etiqueta="La cuenta que más entró" valor={cuentaTop ? M(cuentaTop.total.monto) : "—"}
            contexto={cuentaTop ? `${cuentaTop.nombre} · ${pct((cuentaTop.total.centavos / Math.max(r.total.centavos, 1)) * 100, 0)} del total` : "Sin cobros en este rango"}
            info={{
              ayuda: "La cuenta recaudadora por la que entró más plata en el rango, y qué parte del total es.",
              formula: "Parte del total = lo cobrado por esa cuenta ÷ Cash Collected (CC) del rango",
            }}
          />
          <StatCard
            etiqueta="El servicio que más entró" valor={servicioTop ? M(servicioTop.total.monto) : "—"}
            contexto={servicioTop ? `${servicioTop.nombre} · ${pct((servicioTop.total.centavos / Math.max(r.total.centavos, 1)) * 100, 0)} del total` : "Sin cobros en este rango"}
            info={{
              ayuda: "El servicio (el de la venta de cada cobro) por el que entró más plata en el rango, y qué parte del total es.",
              formula: "Parte del total = lo cobrado de ese servicio ÷ Cash Collected (CC) del rango",
            }}
          />
        </div>
      </Card>

      <Card style={{ padding: 0 }} className="cobros-tabla ingresos-tabla">
        <div className="row-wrap" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <span className="t-sm t-muted">
            {hayCobros
              ? <>Del <strong>{etiqueta}</strong> · {num(r.total.cobros)} {r.total.cobros === 1 ? "cobro" : "cobros"} en {num(r.cuentas.length)} {r.cuentas.length === 1 ? "cuenta" : "cuentas"}</>
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
        titulo={abierta?.titulo ?? ""} sub={`${etiqueta} · ${num(cobros.length)} ${cobros.length === 1 ? "cobro" : "cobros"} · ${M(centavosAbierta / 100)}`}
      >
        <div className="stack-3 cobros-tabla">
          <p className="t-sm t-muted">
            Estos son los cobros que se suman en ese número. Un clic abre la ficha de la venta; el chequeo muestra si el director o finanzas ya miraron el comprobante.
          </p>
          <DataTable
            filas={cobros} columnas={columnasCobros}
            onFila={(f) => { if (f.venta) { setAbierta(null); abrirFicha(f.venta.id, "ventas", { venta: f.venta.id }); } }}
            etiquetaFila={(f) => `Abrir la ficha de ${f.venta?.contactoNombre ?? "este cliente"}`}
            vacio={<Empty icono={<Wallet size={22} />} titulo="Sin cobros" texto="No hay cobros en este número." />}
          />
          {cobros.some((f) => !f.venta) && <Badge variante="warning">Hay cobros sin venta: no se pueden abrir</Badge>}
        </div>
      </Drawer>
    </section>
  );
}
