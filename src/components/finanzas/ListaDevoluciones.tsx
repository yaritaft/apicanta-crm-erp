"use client";

import React, { useMemo, useState } from "react";
import { Info, Paperclip, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { Ayuda, Badge, Button, Card, CardHead, IconButton, StatCard } from "@/components/ui/ui";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ReembolsosPasarelas } from "@/components/devoluciones/ReembolsosPasarelas";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { verComprobante } from "@/lib/comprobantes";
import { abrirDevolucion } from "@/lib/devolucion-ui";
import { devolucionesDelMes, llamadasEnDevolucionSinCargar, reversasDelMes } from "@/lib/devoluciones";
import { fechaLarga, money } from "@/lib/format";
import type { RangoMes } from "@/lib/metricas";
import { puedeCargarDevolucion } from "@/lib/permisos";
import { propuestasPendientes } from "@/lib/reembolsos";
import { useTablaURL } from "@/lib/useParamsURL";
import type { Devolucion, EstadoApp } from "@/lib/types";

/* ==================================================================
   Finanzas → Devoluciones: la plata que se le devolvió a clientes.

   Cada una resta en el mes en que se devolvió la plata (Cash Collected,
   estado de resultados y caja), sin tocar el mes de la venta. Acá se ven las
   del período, las llamadas que quedaron en «Devolución» y todavía no se
   cargaron (Finanzas no las ve hasta entonces) y los reembolsos que informaron
   las pasarelas. Las cargan Finanzas o el director comercial.
   ================================================================== */

export function ListaDevoluciones({ e, mes }: { e: EstadoApp; mes: RangoMes }) {
  const { acceso } = useAcceso();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const puede = puedeCargarDevolucion(acceso);
  const M = (n: number, d = 2) => money(n, e.ajustes.monedaBase, d);
  const tabla = useTablaURL("devoluciones", { clave: "fecha", desc: true }, ["fecha", "persona", "medio", "monto"]);
  const [borrar, setBorrar] = useState<Devolucion | null>(null);

  const delMes = useMemo(() => devolucionesDelMes(e, mes), [e, mes]);
  const total = delMes.reduce((a, d) => a + d.monto, 0);
  const revertido = useMemo(
    () => reversasDelMes(e, mes).filter((r) => !r.sinDescuento).reduce((a, r) => a + r.partes.reduce((s, p) => s + p.reversa, 0), 0),
    [e, mes],
  );
  const sinCargar = useMemo(() => llamadasEnDevolucionSinCargar(e), [e]);
  const porConfirmar = propuestasPendientes(e).length;
  const personaDe = (d: Devolucion) => e.ventas.find((v) => v.id === d.ventaId)?.contactoNombre ?? "Sin venta";

  return (
    <div className="stack-4">
      <div className="grid-stats">
        <StatCard
          hero etiqueta={`Devuelto en ${mes.etiqueta}`} valor={M(total, 0)}
          contexto={`${delMes.length} ${delMes.length === 1 ? "devolución" : "devoluciones"}`}
          info={{
            ayuda: "La plata que se le devolvió a clientes en el período. Resta del Cash Collected, del estado de resultados y de la caja de la cuenta de la que salió, en el mes en que se devolvió: la venta sigue contando en su mes.",
            formula: "Suma de las devoluciones confirmadas con fecha en el período\nEl Cash Collected es lo cobrado menos esto",
            periodo: mes.etiqueta,
            componentes: () => [
              ...delMes.map((d) => ({ concepto: `${personaDe(d)} · ${fechaLarga(d.fecha)}`, valor: M(d.monto), signo: "+" as const })),
              { concepto: "Devuelto en el período", valor: M(total), signo: "=" as const },
            ],
          }}
        />
        <StatCard
          etiqueta="Comisión revertida" valor={M(revertido, 0)}
          contexto="Al closer y al director, en la liquidación del mes"
          info={{
            ayuda: "Lo que se les descuenta a quienes comisionaron las ventas devueltas: exactamente lo que se les comisionó por lo cobrado, en la parte que se devolvió. Sin las que se marcaron «no descontar al closer».",
            formula: "Comisionado por lo cobrado de la venta × lo devuelto ÷ lo cobrado que quedaba sin devolver",
            periodo: mes.etiqueta,
          }}
        />
        <StatCard
          etiqueta="Llamadas por cargar" valor={String(sinCargar.length)} direccion={sinCargar.length > 0 ? "down" : "neutral"}
          contexto="En «Devolución» sin devolución cargada"
          info={{
            ayuda: "Llamadas que el closer dejó en «Devolución» en el CRM y todavía no tienen su devolución cargada: Finanzas no las ve hasta que alguien las cargue.",
            formula: "Llamadas con Estado de Llamada «Devolución» cuya persona no tiene ninguna devolución cargada",
          }}
        />
        <StatCard
          etiqueta="Para confirmar" valor={String(porConfirmar)} direccion={porConfirmar > 0 ? "down" : "neutral"}
          contexto="Reembolsos que informó una pasarela"
          info={{
            ayuda: "Reembolsos que informaron Stripe, Hotmart o Whop y nadie confirmó. No restan de Finanzas hasta que se confirman.",
            formula: "Cantidad de devoluciones en estado «propuesta»",
          }}
        />
      </div>

      {sinCargar.length > 0 && (
        <Card>
          <CardHead
            titulo={`Llamadas en «Devolución» sin cargar · ${sinCargar.length}`}
            sub="El closer las dejó en «Devolución» en el CRM. Cargá la devolución para que Finanzas, la caja y la comisión lo reflejen."
          />
          <div className="stack-2">
            {sinCargar.map(({ sesion, ventas }) => (
              <div className="devol-fila" key={sesion.id}>
                <Undo2 size={13} className="t-subtle" aria-hidden />
                <span className="t-strong">{sesion.invitado}</span>
                <span className="t-subtle">llamada del {fechaLarga(sesion.inicia)}</span>
                {sesion.anfitrion && <span className="t-subtle">· {sesion.anfitrion}</span>}
                {ventas.length === 0 && <span className="t-subtle">· no tiene ninguna venta cargada</span>}
                <span className="spacer" />
                {ventas[0] && <Button sm variante="ghost" onClick={() => abrirFicha(ventas[0].id)}>Ver su ficha</Button>}
                {puede && ventas.length > 0 && (
                  <Button sm variante="primary" onClick={() => abrirDevolucion({ sesionId: sesion.id })}>Cargar la devolución</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <ReembolsosPasarelas e={e} />

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead
            titulo={`Devoluciones de ${mes.etiqueta}`}
            sub="Por el día que se devolvió la plata. Para cargar una nueva, entrá a la ficha de la persona (su venta) o a una llamada en «Devolución»."
            acciones={puede ? <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => abrirFicha(sinCargar[0]?.ventas[0]?.id ?? e.ventas[0]?.id ?? "")} disabled={e.ventas.length === 0}>Buscar una venta</Button> : undefined}
          />
        </div>
        <DataTable
          alto={420}
          filas={delMes}
          orden={tabla.orden} onOrden={tabla.onOrden}
          onFila={(d) => d.ventaId && abrirFicha(d.ventaId)} etiquetaFila={(d) => `Ver la ficha de ${personaDe(d)}`}
          columnas={[
            { clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (d) => d.fecha, celda: (d) => fechaLarga(d.fecha) },
            { clave: "persona", titulo: "Persona", tipo: "secondary", orden: (d) => personaDe(d), celda: (d) => personaDe(d) },
            { clave: "medio", titulo: "Salió por", tipo: "secondary", orden: (d) => e.procesadores.find((p) => p.id === d.procesadorId)?.nombre ?? "", celda: (d) => e.procesadores.find((p) => p.id === d.procesadorId)?.nombre ?? "—" },
            {
              clave: "closer", titulo: "Al closer", tipo: "secondary",
              celda: (d) => (d.noDescontarAlCloser ? <Badge variante="neutral">No se descuenta</Badge> : <span className="t-subtle">Se descuenta</span>),
            },
            {
              clave: "prueba", titulo: "Comprobante", tipo: "secondary",
              celda: (d) => d.comprobante
                ? <button type="button" className="link t-sm" onClick={(ev) => { ev.stopPropagation(); verComprobante(d.comprobante!).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err")); }}><Paperclip size={12} /> ver</button>
                : d.referencia ? <span className="t-subtle">de la pasarela</span> : <span className="t-subtle">—</span>,
            },
            { clave: "monto", titulo: "Monto", tipo: "num", orden: (d) => d.monto, celda: (d) => <span style={{ color: "var(--danger)" }}>−{M(d.monto)}</span>, pie: <span style={{ color: "var(--danger)" }}>−{M(total)}</span> },
          ]}
          acciones={puede ? (d) => (
            <>
              <IconButton etiqueta="Corregir la devolución" onClick={() => abrirDevolucion({ devolucionId: d.id, ventaId: d.ventaId })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Borrar la devolución" onClick={() => setBorrar(d)}><Trash2 size={15} /></IconButton>
            </>
          ) : undefined}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Sin devoluciones en {mes.etiqueta}.</p>}
        />
      </Card>

      <Ayuda titulo="Cómo se cuentan las devoluciones" icono={<Info size={18} />}>
        La venta sigue contando en el mes en que se hizo. La devolución resta en el mes en que se devuelve la plata: Cash Collected,
        estado de resultados y la caja de la cuenta de la que salió. La comisión de la pasarela no vuelve (Stripe se la queda).
        Al closer y al director se les revierte exactamente lo que se les comisionó por lo cobrado de esa venta, como una línea negativa
        «Devolución de …» en la liquidación del mes de la devolución; con «no descontar al closer», no se revierte nada. Si ese mes ya
        está cerrado, la liquidación cerrada no se reescribe: lo que se descuenta entra en la del mes que sigue.
      </Ayuda>

      <Confirmar
        abierto={Boolean(borrar)} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar la devolución?"
        texto="Vuelve a contar lo cobrado y lo comisionado: Finanzas, la caja y la liquidación se rehacen sin esta devolución."
        confirmarTexto="Borrar"
        onConfirmar={() => { if (borrar && acciones.borrarDevolucion(borrar.id)) toast("Devolución borrada."); setBorrar(null); }}
      />
    </div>
  );
}
