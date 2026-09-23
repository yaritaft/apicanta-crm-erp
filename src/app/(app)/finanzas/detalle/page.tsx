"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Check, Info, Plus, Wallet,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Empty, IconButton, Tabs,
} from "@/components/ui/ui";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ListaGastos } from "@/components/finanzas/ListaGastos";
import { FichaGasto } from "@/components/finanzas/FichaGasto";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { rangoDeFechas } from "@/lib/metricas";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { calcularPyL, comisionesDelMes, cuotasVencidas } from "@/lib/finanzas";
import type { Cuota, Gasto } from "@/lib/types";

type Vista = "cobros" | "gastos" | "comisiones";
const VISTAS: Vista[] = ["cobros", "gastos", "comisiones"];

export default function FinanzasDetalle() {
  const e = useEstado();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [vista, setVista] = useState<Vista>("cobros");
  /* El asistente abierto: con un gasto edita, con null carga uno nuevo. */
  const [asistente, setAsistente] = useState<{ gasto: Gasto | null } | null>(null);
  const [verId, setVerId] = useState<string | null>(null);
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

  /* ?vista=gastos&ver=<id> abre la ficha de un gasto (así llega el estado de
     resultados) y ?nuevo=1 abre el asistente. Se limpian sólo esos: el
     período tiene que seguir en la URL, y useAbrirDesdeURL borraría todo. */
  useEffect(() => {
    const v = params.get("vista");
    const ver = params.get("ver");
    const nuevo = params.get("nuevo") === "1";
    if (!v && !ver && !nuevo) return;
    if (v && (VISTAS as string[]).includes(v)) setVista(v as Vista);
    if (ver) { setVista("gastos"); setVerId(ver); }
    if (nuevo) { setVista("gastos"); setAsistente({ gasto: null }); }
    const q = new URLSearchParams(params.toString());
    q.delete("vista"); q.delete("ver"); q.delete("nuevo");
    const resto = q.toString();
    router.replace(resto ? `${pathname}?${resto}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const gVista = verId ? e.gastos.find((g) => g.id === verId) ?? null : null;

  const p = useMemo(() => calcularPyL(e, mes), [e, mes]);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const vencidas = useMemo(() => cuotasVencidas(e), [e]);
  const comisiones = useMemo(() => comisionesDelMes(e, mes), [e, mes]);

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
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => { setVista("gastos"); setAsistente({ gasto: null }); }}>Cargar gasto</Button>
          </>
        }
      />

      <Tabs valor={vista} onChange={setVista} opciones={[
        { valor: "cobros", texto: `Cobros${vencidas.length ? ` · ${vencidas.length}` : ""}` },
        { valor: "gastos", texto: "Gastos" },
        { valor: "comisiones", texto: "Comisiones" },
      ]} />

      {/* ---------------- P&L ---------------- */}
      {vista === "cobros" && (
        <div className="stack-4">
          {vencidas.length > 0 && (
            <Ayuda titulo={`Hay ${vencidas.length} cuotas vencidas sin cobrar`} icono={<AlertTriangle size={18} />}>
              Suman <strong>{M(vencidas.reduce((a, c) => a + c.saldo, 0))}</strong>. La más vieja lleva{" "}
              <strong>{vencidas[0].diasAtraso} días</strong> y es de {vencidas[0].contacto}. Marcá el pago cuando entre
              y desaparece de esta lista.
            </Ayuda>
          )}

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={vencidas.map((v) => ({ ...v, id: v.cuotaId }))}
              ordenInicial={{ clave: "dias", desc: true }}
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

      {/* ---------------- Comisiones ---------------- */}
      {vista === "comisiones" && (
        <div className="stack-4">
          <Ayuda titulo="Cómo se calcula" icono={<Info size={18} />}>
            El closer cobra sobre el <strong>cash collected neto de procesador</strong>, no sobre el profit:
            si entraron US$ 1.000 por Stripe, la base es 1.000 − 2,9% y sobre eso va su porcentaje.
            El director cobra 5% con la misma base. Si la venta figura a nombre de <strong>Yari</strong>,
            no comisiona nadie.
          </Ayuda>

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={comisiones.map((c) => ({ ...c, id: c.ventaId }))}
              ordenInicial={{ clave: "cobrado", desc: true }}
              columnas={[
                {
                  clave: "closer", titulo: "Venta", tipo: "primary", orden: (c) => c.closerNombre,
                  celda: (c) => {
                    const v = e.ventas.find((x) => x.id === c.ventaId);
                    return <span>{v?.contactoNombre ?? "—"} <span className="t-subtle">· {c.closerNombre}</span></span>;
                  },
                },
                { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (c) => c.cobradoEnMes, celda: (c) => M(c.cobradoEnMes) },
                { clave: "neto", titulo: "Neto", tipo: "num", orden: (c) => c.netoProcesador, celda: (c) => M(c.netoProcesador) },
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
