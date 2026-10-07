"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Check, Info, Plus, Wallet,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Chip, Empty, IconButton, Tabs,
} from "@/components/ui/ui";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ListaGastos, PARAMS_GASTOS } from "@/components/finanzas/ListaGastos";
import { FichaGasto } from "@/components/finanzas/FichaGasto";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { GastosFijos } from "@/components/finanzas/GastosFijos";
import { cuantosFaltan } from "@/lib/gastos-recurrentes";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money, tasaTexto } from "@/lib/format";
import { rangoDeFechas } from "@/lib/metricas";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { CopiarLink } from "@/components/ui/Filtros";
import { useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import { calcularPyL, comisionesDelMes, comisionesSetterYReferidor, cuotasVencidas, UMBRALES_ATRASO } from "@/lib/finanzas";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { CobrosProcesador, PARAMS_PROCESADORES } from "@/components/finanzas/CobrosProcesador";
import { CuadroComisiones } from "@/components/finanzas/CuadroComisiones";
import { useNivelAcceso } from "@/lib/acceso";
import type { Cuota, Gasto } from "@/lib/types";

type Vista = "cobros" | "procesadores" | "gastos" | "fijos" | "comisiones";
const VISTAS: Vista[] = ["cobros", "procesadores", "gastos", "fijos", "comisiones"];

/* Lo que se está mirando vive en la URL (lib/useParamsURL), con el período
   aparte en ?periodo:
   - seccion: cobros (por defecto), procesadores, gastos, fijos (los gastos fijos
     por aprobar) o comisiones
   - atraso: en Cobros, sólo las cuotas con al menos esos días (7, 15 o 20)
   La pestaña no va en ?vista, que es de la ficha de una persona: abrir una
   desde una cuota vencida la pisaba. Un link viejo con ?vista=gastos se
   sigue entendiendo. */
const VISTA_DETALLE = { seccion: "cobros", atraso: "" };

export default function FinanzasDetalle() {
  const e = useEstado();
  const toast = useToast();
  const params = useSearchParams();
  const [enURL, setEnURL] = useParamsURL(VISTA_DETALLE);
  const vista: Vista = (VISTAS as string[]).includes(enURL.seccion) ? (enURL.seccion as Vista) : "cobros";
  /* Los filtros y el orden son de cada pestaña: al pasar a otra se sacan,
     así el link no arrastra un filtro que no se ve. */
  const setVista = (v: Vista) => {
    if (v === vista) return;
    const deLaPestana = new Set<string>([...PARAMS_GASTOS, ...PARAMS_PROCESADORES, "atraso"]);
    setEnURL({ seccion: v }, Object.fromEntries([...deLaPestana].map((k) => [k, null])));
  };
  /* El asistente abierto: con un gasto edita, con null carga uno nuevo. */
  const [asistente, setAsistente] = useState<{ gasto: Gasto | null } | null>(null);
  const [verId, setVerId] = useState<string | null>(null);
  /* Los gastos fijos que ya le tocaba pagar y nadie aprobó (lib/gastos-recurrentes). */
  const fijosPorAprobar = useMemo(() => cuantosFaltan(e, new Date().toISOString()), [e.gastos, e.gastosRecurrentes]); // eslint-disable-line react-hooks/exhaustive-deps
  const [borrar, setBorrar] = useState<Gasto | null>(null);

  /* El rango vive en la URL: navegar entre el resumen y el detalle lo
     conserva, y se puede mandar un link a un periodo concreto. Arranca en
     "Este mes", que es lo que pidio Yari: entrar y ver el mes en curso. */
  const [rango, setRango] = useRangoURL("mes");

  /* "Maximo" tiene que decir la verdad por los dos lados: arranca en el primer
     dato que existe, y termina en la ultima cuota PROGRAMADA — si terminara
     hoy, las cuotas que vencen el mes que viene quedarian fuera de pantalla. */
  const limites = useMemo(() => {
    const fechas = [...e.ventas.map((v) => v.fecha), ...e.pagos.map((x) => x.fecha), ...e.gastos.map((g) => g.fecha)]
      .filter(Boolean).map((f) => f.slice(0, 10)).sort();
    const vence = e.cuotas.map((c) => c.vence).filter(Boolean).map((f) => f!.slice(0, 10)).sort();
    return { min: fechas[0] ?? null, max: vence[vence.length - 1] ?? null };
  }, [e.ventas, e.pagos, e.gastos, e.cuotas]);

  const mes = useMemo(() => rangoDeFechas(rango.desde, rango.hasta, rangoSub(rango)), [rango]);

  /* Volver al resumen sin perder el periodo que estabas mirando. */
  const qs = new URLSearchParams({ periodo: rango.preset, desde: rango.desde, hasta: rango.hasta }).toString();

  /* ?ver=<id> abre la ficha de un gasto (así llega el estado de resultados)
     y ?nuevo=1 abre el asistente; los dos llevan a Gastos. Se sacan sólo
     esos, que son de un solo uso: el período y la pestaña quedan. */
  useEffect(() => {
    /* Con una ficha abierta (desde una cuota vencida), `vista` es la de la
       ficha (ventas o servicio): no es de esta pantalla. */
    if (params.get("ficha")) return;
    const v = params.get("vista");
    const ver = params.get("ver");
    const nuevo = params.get("nuevo") === "1";
    if (!v && !ver && !nuevo) return;
    let seccion: Vista | null = v && (VISTAS as string[]).includes(v) ? (v as Vista) : null;
    if (ver) { seccion = "gastos"; setVerId(ver); }
    if (nuevo) { seccion = "gastos"; setAsistente({ gasto: null }); }
    setEnURL(seccion ? { seccion } : {}, { vista: null, ver: null, nuevo: null });
  }, [params, setEnURL]);

  const gVista = verId ? e.gastos.find((g) => g.id === verId) ?? null : null;

  const p = useMemo(() => calcularPyL(e, mes), [e, mes]);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const vencidas = useMemo(() => cuotasVencidas(e), [e]);
  /* ?atraso=7 (lo manda la alarma): sólo las cuotas con al menos esos días. */
  const atraso = Number(enURL.atraso) || 0;
  const setAtraso = (n: number) => setEnURL({ atraso: n ? String(n) : null });
  const vencidasVista = atraso ? vencidas.filter((c) => c.diasAtraso >= atraso) : vencidas;
  const abrirFicha = useAbrirFicha();
  const comisiones = useMemo(() => comisionesDelMes(e, mes), [e, mes]);
  /* El orden de cada tabla va en el link (?orden): una pestaña a la vez. */
  const tablaCobros = useTablaURL("", { clave: "dias", desc: true }, ["contacto", "cuota", "vence", "dias", "saldo"]);
  const tablaComisiones = useTablaURL("", { clave: "cobrado", desc: true }, ["closer", "servicio", "cobrado", "neto", "tasa", "comiCloser", "comiDir"]);
  const { esDueno } = useNivelAcceso();
  const setRef = useMemo(() => comisionesSetterYReferidor(e, mes), [e, mes]);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Detalle de finanzas"
        sub="Fila por fila: qué se debe, en qué se fue la plata y cuánto comisiona cada uno."
        acciones={
          <>
            <Link href={`/finanzas?${qs}`}>
              <Button variante="secondary" icono={<ArrowLeft size={16} />}>Volver al resumen</Button>
            </Link>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max}
              onApply={setRango} footerNota="Días calendario · zona horaria de Argentina"
            />
            <CopiarLink sm={false} />
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => { setVista("gastos"); setAsistente({ gasto: null }); }}>Cargar gasto</Button>
          </>
        }
      />

      <Tabs valor={vista} onChange={setVista} opciones={[
        { valor: "cobros", texto: `Cobros${vencidas.length ? ` · ${vencidas.length}` : ""}` },
        { valor: "procesadores", texto: "Procesadores" },
        { valor: "gastos", texto: "Gastos" },
        { valor: "fijos", texto: `Gastos fijos${fijosPorAprobar ? ` · ${fijosPorAprobar}` : ""}` },
        { valor: "comisiones", texto: "Comisiones" },
      ]} />

      {/* ---------------- P&L ---------------- */}
      {vista === "cobros" && (
        <div className="stack-4">
          {vencidas.length > 0 && (
            <Ayuda titulo={vencidas.length === 1 ? "Hay 1 cuota vencida sin cobrar" : `Hay ${vencidas.length} cuotas vencidas sin cobrar`} icono={<AlertTriangle size={18} />}>
              {vencidas.length === 1 ? "Es de" : "Suman"} <strong>{M(vencidas.reduce((a, c) => a + c.saldo, 0))}</strong>.{" "}
              {vencidas.length === 1 ? "Lleva" : "La más vieja lleva"}{" "}
              <strong>{vencidas[0].diasAtraso} {vencidas[0].diasAtraso === 1 ? "día" : "días"}</strong> y es de {vencidas[0].contacto}.
              Marcá el pago cuando entre y desaparece de esta lista.
            </Ayuda>
          )}

          <div className="row-wrap">
            <Chip activo={atraso === 0} onClick={() => setAtraso(0)} count={vencidas.length}>Todas las vencidas</Chip>
            {UMBRALES_ATRASO.map((d) => (
              <Chip key={d} activo={atraso === d} onClick={() => setAtraso(d)} count={vencidas.filter((c) => c.diasAtraso >= d).length}>
                {d} días o más
              </Chip>
            ))}
          </div>

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={vencidasVista.map((v) => ({ ...v, id: v.cuotaId }))}
              onFila={(c) => abrirFicha(c.ventaId)}
              etiquetaFila={(c) => `Abrir la ficha de ${c.contacto}`}
              orden={tablaCobros.orden} onOrden={tablaCobros.onOrden}
              columnas={[
                { clave: "contacto", titulo: "Cliente", tipo: "primary", orden: (c) => c.contacto, celda: (c) => c.contacto },
                { clave: "cuota", titulo: "Cuota", tipo: "secondary", orden: (c) => c.numero, celda: (c) => c.numero === 0 ? "Reserva" : `Cuota ${c.numero}` },
                { clave: "vence", titulo: "Vencía", tipo: "secondary", orden: (c) => c.vence, celda: (c) => fechaLarga(c.vence) },
                {
                  clave: "dias", titulo: "Atraso", orden: (c) => c.diasAtraso,
                  celda: (c) => (
                    <Badge variante={c.diasAtraso >= 30 ? "danger" : c.diasAtraso >= 14 ? "warning" : "accent"}>
                      {c.diasAtraso} días
                    </Badge>
                  ),
                },
                { clave: "saldo", titulo: "Saldo", tipo: "num", orden: (c) => c.saldo, celda: (c) => M(c.saldo) },
              ]}
              acciones={(c) => (
                <IconButton etiqueta="Marcar como cobrada" onClick={() => {
                  acciones.actualizar<Cuota>("cuotas", c.cuotaId, { estado: "pagada" }, `Cuota de ${c.contacto}`, `Se cobró la cuota ${c.numero} de ${c.contacto}.`);
                  toast("Cuota marcada como cobrada.");
                }}><Check size={15} /></IconButton>
              )}
              vacio={<Empty icono={<Check size={22} />} titulo="Nadie atrasado" texto="Todas las cuotas exigibles están cobradas. Si aparece una vencida, la vas a ver acá con los días de atraso." />}
            />
          </Card>
        </div>
      )}

      {/* ---------------- Comisión del procesador, cobro por cobro ---------------- */}
      {vista === "procesadores" && <CobrosProcesador e={e} mes={mes} />}

      {/* ---------------- Gastos ---------------- */}
      {vista === "gastos" && (
        <ListaGastos
          e={e} mes={mes}
          onNuevo={() => setAsistente({ gasto: null })}
          onVer={(g) => setVerId(g.id)}
          onEditar={(g) => setAsistente({ gasto: g })}
          onBorrar={(g) => setBorrar(g)}
        />
      )}

      {/* ---------------- Gastos fijos: la propuesta de cada mes, para aprobar ---------------- */}
      {vista === "fijos" && <GastosFijos e={e} />}

      {/* ---------------- Comisiones ---------------- */}
      {vista === "comisiones" && (
        <div className="stack-4">
          <Card>
            <CardHead
              titulo="Cómo comisiona cada uno"
              sub={`El % que cobra cada persona de lo que entra de sus ventas, neto de procesador. Puede ser distinto según el servicio.${esDueno ? "" : " Los % los cambian los dueños, en Equipo y honorarios."}`}
              acciones={esDueno ? <Link href="/equipo?seccion=comisiones" className="hk-btn hk-btn--secondary hk-btn--sm">Cambiar los %</Link> : undefined}
            />
            <CuadroComisiones e={e} />
          </Card>

          <Ayuda titulo="Cómo se calcula" icono={<Info size={18} />}>
            Cada uno cobra sobre el <strong>cash collected neto de procesador</strong>, no sobre el profit:
            si entraron US$ 1.000 por Stripe, la base es 1.000 − 2,9% y sobre eso va su porcentaje, que es
            el del cuadro: el del servicio vendido si tiene uno propio, o el general. El director cobra con
            la misma base. Si la venta figura a nombre de <strong>Yari</strong>, no comisiona nadie. Desde
            el día en que alguien dejó el equipo no cobra más, y si sus cuotas pasaron a otro closer (en
            Equipo, en su ficha), lo que se cobre de ellas es del que las heredó.
          </Ayuda>

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={comisiones}
              orden={tablaComisiones.orden} onOrden={tablaComisiones.onOrden}
              columnas={[
                {
                  clave: "closer", titulo: "Venta", tipo: "primary", orden: (c) => c.closerNombre,
                  celda: (c) => {
                    const v = e.ventas.find((x) => x.id === c.ventaId);
                    return <span>{v?.contactoNombre ?? "—"} <span className="t-subtle">· {c.closerNombre}{c.heredadaDe ? ` (cuotas heredadas de ${c.heredadaDe})` : ""}</span></span>;
                  },
                },
                {
                  clave: "servicio", titulo: "Servicio", tipo: "secondary", orden: (c) => e.productos.find((x) => x.id === c.productoId)?.nombre ?? "",
                  celda: (c) => e.productos.find((x) => x.id === c.productoId)?.nombre ?? "—",
                },
                { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (c) => c.cobradoEnMes, celda: (c) => M(c.cobradoEnMes) },
                { clave: "neto", titulo: "Neto", tipo: "num", orden: (c) => c.netoProcesador, celda: (c) => M(c.netoProcesador) },
                {
                  clave: "tasa", titulo: "% closer", tipo: "num", orden: (c) => c.tasaCloser,
                  celda: (c) => c.sinComision || !c.closerId ? "—" : <span title="El % del closer en este servicio">{tasaTexto(c.tasaCloser)}</span>,
                },
                { clave: "comiCloser", titulo: "Closer", tipo: "num", orden: (c) => c.comisionCloser, celda: (c) => c.sinComision ? <span className="t-subtle">Sin comisión</span> : M(c.comisionCloser, 2) },
                { clave: "comiDir", titulo: "Director", tipo: "num", orden: (c) => c.comisionDirector, celda: (c) => c.sinComision ? "—" : M(c.comisionDirector, 2) },
              ]}
              vacio={<Empty icono={<Wallet size={22} />} titulo={`Sin cobros en ${mes.etiqueta}`} texto="Cuando entre un pago, la comisión de quien cerró esa venta aparece acá calculada." />}
            />
          </Card>

          <div className="grid-2">
            <Card>
              <CardHead titulo="Reparto del profit" sub="Growth partner y socio cobran sobre el resultado operativo." />
              <dl className="dl">
                <dt>Resultado operativo</dt><dd className="t-num">{M(p.operativoCC)}</dd>
                <dt>Growth partner</dt><dd className="t-num">{M(p.growth)}</dd>
                <dt>Socio</dt><dd className="t-num">{M(p.socio)}</dd>
                <dt>Queda</dt><dd className="t-num t-strong">{M(p.operativoCC - p.growth - p.socio)}</dd>
              </dl>
              <Ayuda titulo="Ojo con esto" icono={<Info size={18} />}>
                El growth partner no comisiona las ventas marcadas como <strong>excluidas de marketing</strong>
                (eventos y conocidos), así que su número ya sale prorrateado. Lo del socio, que cobra distinto
                según el producto, todavía está como un 10% parejo — falta definirlo.
              </Ayuda>
            </Card>
            <Card>
              <CardHead titulo="Setters y referidores" sub="Un porcentaje de lo que entró post pasarelas, como todas las comisiones." />
              {setRef.porPersona.length === 0 ? (
                <p className="t-sm t-subtle">Ninguna venta con setter o referidor cobró en {mes.etiqueta}.</p>
              ) : (
                <dl className="dl">
                  {setRef.porPersona.map((x) => (
                    <React.Fragment key={x.nombre}><dt>{x.nombre}</dt><dd className="t-num">{M(x.total, 2)}</dd></React.Fragment>
                  ))}
                  <dt>Total</dt><dd className="t-num t-strong">{M(setRef.setter + setRef.referidor, 2)}</dd>
                </dl>
              )}
              <Ayuda titulo="No se resta dos veces" icono={<Info size={18} />}>
                Es lo que les toca por lo que entró. Lo que se les paga entra al estado de resultados como gasto
                (Setters, Referidores), igual que en la planilla.
              </Ayuda>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- Ficha, alta y edición de gastos ---------------- */}
      {gVista && !asistente && (
        <FichaGasto
          gasto={gVista} e={e}
          onCerrar={() => setVerId(null)}
          onEditar={() => setAsistente({ gasto: gVista })}
          onBorrar={() => setBorrar(gVista)}
        />
      )}

      {asistente && (
        <AsistenteGasto
          gasto={asistente.gasto}
          onCerrar={() => setAsistente(null)}
          onListo={(g, editado) => {
            setAsistente(null);
            const t = new Date(g.fecha).getTime();
            if (t < mes.desde.getTime() || t > mes.hasta.getTime()) {
              toast(`${editado ? "Gasto guardado" : "Gasto cargado"}. Es del ${fechaLarga(g.fecha)}: no entra en el período que estás mirando.`, "info");
            } else {
              toast(editado ? "Gasto actualizado." : `Gasto cargado: ${g.concepto}.`);
            }
          }}
        />
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar este gasto?"
        texto={`Se borra «${borrar?.concepto}» y el estado de resultados se recalcula.`}
        onConfirmar={() => {
          if (!borrar) return;
          acciones.eliminar("gastos", borrar.id, borrar.concepto);
          if (verId === borrar.id) setVerId(null);
          toast("Gasto eliminado.");
        }}
      />
    </div>
  );
}
