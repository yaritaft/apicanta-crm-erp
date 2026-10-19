"use client";

import React from "react";
import { Link2, RotateCcw, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHead } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { abrirDevolucion } from "@/lib/devolucion-ui";
import { fechaLarga, money } from "@/lib/format";
import { puedeCargarDevolucion } from "@/lib/permisos";
import { nombrePasarela } from "@/lib/pasarelas";
import { candidatasDe, propuestasAtables, propuestasDescartadas, propuestasPendientes, quienDelReembolso, reembolsoDePropuesta } from "@/lib/reembolsos";
import type { RangoDeDias } from "@/lib/dia-negocio";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Lo que las pasarelas dicen que devolvieron y todavía nadie decidió.

   Stripe, Hotmart y Whop informan los reembolsos. Cada uno se ata a la
   devolución que ya cargó Finanzas (si calza con una sola) o espera acá como
   propuesta: no resta nada de Finanzas hasta que se confirma con su
   comprobante, se ata a una cargada o se dice que no es una devolución
   (lib/reembolsos.ts). Con dudas no se ata nada solo.
   ================================================================== */

export function ReembolsosPasarelas({ e, rango }: { e: EstadoApp; rango?: RangoDeDias | null }) {
  const { acceso } = useAcceso();
  const toast = useToast();
  const puede = puedeCargarDevolucion(acceso);
  const M = (n: number) => money(n, e.ajustes.monedaBase, 2);
  const pendientes = propuestasPendientes(e, rango ?? undefined);
  /* Lo que alguien marcó como «no es una devolución» queda a la vista con su botón para deshacer: un clic de más no puede perder un reembolso. */
  const descartadas = propuestasDescartadas(e, rango ?? undefined);
  if (pendientes.length === 0 && descartadas.length === 0) return null;
  const atables = propuestasAtables(e, rango ?? undefined);
  const total = pendientes.reduce((a, d) => a + d.monto, 0);

  return (
    <Card>
      <CardHead
        titulo={`Reembolsos de las pasarelas · ${pendientes.length}`}
        sub={pendientes.length
          ? "La pasarela informó plata devuelta a clientes. No resta de Finanzas hasta que la confirmes con su comprobante, la ates a la devolución que ya cargaste o digas que no es una devolución."
          : "No hay reembolsos esperando una decisión. Abajo están los que marcaste como «no es una devolución»: si alguno fue un error, deshacelo."}
        acciones={puede && atables.length > 0 ? (
          <Button sm variante="primary" icono={<Link2 size={14} />} onClick={() => {
            const n = acciones.atarReembolsos(atables);
            toast(n === 0 ? "No había nada para atar." : `${n === 1 ? "Se ató 1 reembolso" : `Se ataron ${n} reembolsos`} a su devolución cargada.`);
          }}>
            Atar las que calzan ({atables.length})
          </Button>
        ) : undefined}
      />
      {pendientes.length > 0 && <div className="row t-sm" style={{ gap: 6, marginBottom: 8 }}>
        <span className="t-subtle">Sin confirmar</span>
        <span className="t-num t-strong">{M(total)}</span>
        <InfoMetrica
          titulo="Reembolsos sin confirmar"
          ayuda="Lo que las pasarelas informaron como devuelto y todavía no es una devolución de Finanzas. No cuenta en el Cash Collected, la caja ni las comisiones hasta que se confirme."
          formula="Suma de las devoluciones en estado «propuesta» (las que informó una pasarela y nadie confirmó)"
          componentes={() => [
            ...pendientes.map((d) => ({ concepto: `${quienDelReembolso(e, d).nombre ?? "Sin identificar"} · ${fechaLarga(d.fecha)}`, valor: M(d.monto), signo: "+" as const })),
            { concepto: "Sin confirmar", valor: M(total), signo: "=" as const },
          ]}
        />
      </div>}
      <div className="stack-2">
        {pendientes.map((d) => {
          const venta = e.ventas.find((v) => v.id === d.ventaId);
          const crudo = reembolsoDePropuesta(d);
          const candidatas = crudo ? candidatasDe(e, crudo) : [];
          const { nombre: quien, cobro, cobroSinContar } = quienDelReembolso(e, d);
          const nombre = quien ?? "Sin identificar";
          return (
            <div className="devol-fila" key={d.id}>
              <Undo2 size={13} className="t-subtle" aria-hidden />
              <Badge variante="neutral">{d.proveedor ? nombrePasarela(d.proveedor) : "Pasarela"}</Badge>
              <span className="t-strong">{nombre}</span>
              <span className="t-subtle" title={d.extra?.fechaDelCobro === true ? "La pasarela no dice cuándo se devolvió: es la fecha del cobro. Al confirmarla se elige el día." : undefined}>
                {fechaLarga(d.fecha)}{d.extra?.fechaDelCobro === true ? " (del cobro)" : ""}
              </span>
              {d.motivo && <span className="t-subtle">{d.motivo}</span>}
              {!venta && !cobro && <span className="t-subtle">· no encontramos el cobro en la app</span>}
              {!venta && cobro && (
                <span className="t-subtle" title="El cobro que se devolvió, tal como figura en Conciliación.">
                  · cobro original: {fechaLarga(cobro.fecha)} · {M(cobro.monto)}{cobroSinContar ? " · nunca se concilió: no contó como cobrado" : ""}
                </span>
              )}
              <span className="spacer" />
              <span className="t-num t-strong">{M(d.monto)}</span>
              {puede && (
                <>
                  {candidatas.map((c) => (
                    <Button key={c.id} sm variante="secondary" icono={<Link2 size={13} />} onClick={() => {
                      if (acciones.atarReembolsos([{ propuestaId: d.id, devolucionId: c.id }])) toast("Reembolso atado a la devolución cargada.");
                    }}>
                      Es la del {fechaLarga(c.fecha)} ({M(c.monto)})
                    </Button>
                  ))}
                  <Button sm variante="primary" onClick={() => abrirDevolucion({ propuestaId: d.id, ventaId: d.ventaId })}>Confirmar</Button>
                  {cobroSinContar && cobro?.estado === "pendiente" && (
                    <Button sm variante="secondary"
                      title="El cobro que devolvió la pasarela nunca se concilió, o sea que nunca contó como cobrado: devolverlo no resta nada. Se descartan los dos y se puede deshacer."
                      onClick={() => {
                        if (acciones.descartarReembolsoConSuCobro(d.id)) toast(`Descartados el reembolso y su cobro: ${nombre}.`, "ok", { texto: "Deshacer", onClick: () => { if (acciones.volverAProponerDevolucion(d.id)) toast("Vuelven los dos."); } });
                      }}>
                      Descartar con su cobro
                    </Button>
                  )}
                  <Button sm variante="ghost" title="Descartarla: la pasarela la informó pero no es una devolución. Se puede deshacer más abajo."
                    onClick={() => {
                      if (acciones.ignorarDevolucion(d.id)) toast(`Marcada como «no es una devolución»: ${nombre}.`, "ok", { texto: "Deshacer", onClick: () => { if (acciones.volverAProponerDevolucion(d.id)) toast("Vuelve a la lista de reembolsos."); } });
                    }}>
                    No es una devolución
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {descartadas.length > 0 && (
        <div className="stack-2" style={{ marginTop: pendientes.length ? "var(--space-4)" : 0 }}>
          <span className="t-label">Marcados como «no es una devolución» · {descartadas.length}</span>
          {descartadas.map((d) => {
            const nombre = quienDelReembolso(e, d).nombre ?? "Sin identificar";
            const conSuCobro = typeof d.extra?.cobroDescartado === "string";
            return (
              <div className="devol-fila" key={d.id} style={{ opacity: 0.85 }}>
                <Undo2 size={13} className="t-subtle" aria-hidden />
                <Badge variante="neutral">{d.proveedor ? nombrePasarela(d.proveedor) : "Pasarela"}</Badge>
                <span className="t-strong">{nombre}</span>
                <span className="t-subtle">{fechaLarga(d.fecha)}</span>
                {conSuCobro && <span className="t-subtle">· se descartó junto con su cobro</span>}
                <span className="spacer" />
                <span className="t-num t-strong">{M(d.monto)}</span>
                {puede && (
                  <Button sm variante="secondary" icono={<RotateCcw size={13} />}
                    onClick={() => { if (acciones.volverAProponerDevolucion(d.id)) toast(`Deshecho: el reembolso de ${nombre} vuelve a la lista.`); }}>
                    Deshacer
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
