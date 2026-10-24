"use client";

import React, { useState } from "react";
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
import { candidatasDe, propuestasAtables, propuestasDescartadas, propuestasEnDisputa, propuestasPendientes, quienDelReembolso, reembolsoDePropuesta, ventaDelReembolso } from "@/lib/reembolsos";
import { AVISO_EN_DISPUTA, AVISO_GANADA, borradorDeDisputaPerdida, disputaDe, MOTIVO_PERDIDA_CARGADA, retenidoDe } from "@/lib/disputas";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { MotivoDeDescarte } from "@/components/finanzas/MotivoDeDescarte";
import { MOTIVOS_DE_REEMBOLSO, motivoDeDescarte } from "@/lib/motivos";
import type { RangoDeDias } from "@/lib/dia-negocio";
import type { Devolucion, EstadoApp } from "@/lib/types";

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
  /* El reembolso que se está descartando: pide el motivo antes (ningún reembolso se deja de lado sin decir por qué). */
  const [descartando, setDescartando] = useState<{ id: string; nombre: string } | null>(null);
  /* Una disputa perdida se carga como gasto: el asistente de gastos arranca con lo que Stripe retiró, el día y la cuenta puestos. */
  const [cargandoGasto, setCargandoGasto] = useState<{ d: Devolucion; nombre: string } | null>(null);
  const pendientes = propuestasPendientes(e, rango ?? undefined);
  const enDisputa = propuestasEnDisputa(e, rango ?? undefined);
  /* Lo que alguien marcó como «no es una devolución» queda a la vista con su botón para deshacer: un clic de más no puede perder un reembolso. */
  const descartadas = propuestasDescartadas(e, rango ?? undefined);
  if (pendientes.length === 0 && descartadas.length === 0 && enDisputa.length === 0) return null;
  const atables = propuestasAtables(e, rango ?? undefined);
  const total = pendientes.reduce((a, d) => a + d.monto, 0);

  return (
    <Card>
      <CardHead
        titulo={`Reembolsos de las pasarelas · ${pendientes.length}`}
        sub={pendientes.length
          ? "La pasarela informó plata devuelta a clientes. No resta de Finanzas hasta que la confirmes con su comprobante, la ates a la devolución que ya cargaste o digas que no es una devolución."
          : enDisputa.length
            ? "No hay reembolsos esperando una decisión. Las disputas de Stripe se ven abajo, pero no se puede hacer nada hasta que se resuelvan."
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
      {enDisputa.length > 0 && (
        <div className="stack-2" style={{ marginBottom: pendientes.length ? "var(--space-4)" : 0 }}>
          <span className="t-label">En disputa · {enDisputa.length}</span>
          <p className="t-sm t-subtle" style={{ margin: 0 }}>{AVISO_EN_DISPUTA}</p>
          {enDisputa.map((d) => {
            const nombre = quienDelReembolso(e, d).nombre ?? "Sin identificar";
            return (
              <div className="devol-fila" key={d.id}>
                <Undo2 size={13} className="t-subtle" aria-hidden />
                <Badge variante="neutral">{d.proveedor ? nombrePasarela(d.proveedor) : "Pasarela"}</Badge>
                <Badge variante="warning">En disputa</Badge>
                <span className="t-strong">{nombre}</span>
                <span className="t-subtle">{fechaLarga(d.fecha)}</span>
                {d.motivo && <span className="t-subtle">{d.motivo}</span>}
                <span className="spacer" />
                <span className="t-num t-strong" title="Lo que Stripe retiró: el monto de la disputa más su comisión.">{M(retenidoDe(d))}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="stack-2">
        {pendientes.map((d) => {
          /* La venta guardada o, si el cobro que se devuelve se concilió después, la de ese cobro. */
          const venta = ventaDelReembolso(e, d);
          const crudo = reembolsoDePropuesta(d);
          const candidatas = crudo ? candidatasDe(e, crudo) : [];
          const { nombre: quien, cobro, cobroSinContar } = quienDelReembolso(e, d);
          const nombre = quien ?? "Sin identificar";
          const disputa = disputaDe(d);
          return (
            <div className="devol-fila" key={d.id}>
              <Undo2 size={13} className="t-subtle" aria-hidden />
              <Badge variante="neutral">{d.proveedor ? nombrePasarela(d.proveedor) : "Pasarela"}</Badge>
              {disputa === "perdida" && <Badge variante="danger">Disputa perdida</Badge>}
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
                  {disputa === "perdida" ? (
                    <>
                      <Button sm variante="primary" title="Stripe retiró la plata y la disputa se perdió: se carga como gasto (baja la caja y entra al P&L)."
                        onClick={() => setCargandoGasto({ d, nombre })}>
                        Cargar como gasto
                      </Button>
                      <Button sm variante="ghost" title="Si en cambio es plata que se le devolvió al cliente: resta del Cash Collected y revierte la comisión del closer."
                        onClick={() => abrirDevolucion({ propuestaId: d.id, ventaId: venta?.id ?? d.ventaId })}>
                        Confirmar como devolución
                      </Button>
                    </>
                  ) : (
                    <Button sm variante="primary" onClick={() => abrirDevolucion({ propuestaId: d.id, ventaId: venta?.id ?? d.ventaId })}>Confirmar</Button>
                  )}
                  {disputa !== "perdida" && cobroSinContar && cobro && (cobro.estado === "pendiente" || cobro.estado === "ignorado") && (
                    <Button sm variante="secondary"
                      title="El cobro que devolvió la pasarela nunca se concilió, o sea que nunca contó como cobrado: devolverlo no resta nada. Se descartan los dos y se puede deshacer."
                      onClick={() => {
                        if (acciones.descartarReembolsoConSuCobro(d.id)) toast(`Descartados el reembolso y su cobro: ${nombre}.`, "ok", { texto: "Deshacer", onClick: () => { if (acciones.volverAProponerDevolucion(d.id)) toast("Vuelven los dos."); } });
                      }}>
                      Descartar con su cobro
                    </Button>
                  )}
                  {disputa !== "perdida" && (
                    <Button sm variante="ghost" title="Descartarla: la pasarela la informó pero no es una devolución. Pide el motivo y se puede deshacer más abajo."
                      onClick={() => setDescartando({ id: d.id, nombre })}>
                      No es una devolución
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {descartadas.length > 0 && (
        <div className="stack-2" style={{ marginTop: pendientes.length || enDisputa.length ? "var(--space-4)" : 0 }}>
          <span className="t-label">Marcados como «no es una devolución» (y las disputas ganadas) · {descartadas.length}</span>
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
                <span className="t-subtle" style={{ flexBasis: "100%", order: 5 }} title="Por qué no es una devolución">
                  {disputaDe(d) === "ganada" ? AVISO_GANADA : motivoDeDescarte(d) ?? "Falta el motivo."}
                </span>
                <span className="spacer" />
                <span className="t-num t-strong">{M(d.monto)}</span>
                {puede && disputaDe(d) !== "ganada" && (
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
      {cargandoGasto && (
        <AsistenteGasto
          inicial={borradorDeDisputaPerdida(cargandoGasto.d, cargandoGasto.nombre, e.procesadores.find((p) => p.id === cargandoGasto.d.procesadorId)?.nombre ?? "Stripe")}
          onCerrar={() => setCargandoGasto(null)}
          onListo={(g) => {
            const { d, nombre } = cargandoGasto;
            setCargandoGasto(null);
            /* Ya está cargada: la propuesta se va (con su motivo) y no vuelve a esperar. */
            acciones.ignorarDevolucion(d.id, MOTIVO_PERDIDA_CARGADA);
            toast(`Gasto cargado: ${g.concepto}. Ya no espera decisión (${nombre}).`);
          }}
        />
      )}
      <MotivoDeDescarte
        abierto={descartando !== null} onCerrar={() => setDescartando(null)}
        titulo="¿Por qué no es una devolución?" sub={descartando ? `Reembolso de ${descartando.nombre}. Queda escrito: ningún reembolso se deja de lado sin decir por qué.` : undefined}
        opciones={MOTIVOS_DE_REEMBOLSO} guardarTexto="Dejarla sin devolución"
        onGuardar={(motivo) => {
          const d = descartando;
          setDescartando(null);
          if (d && acciones.ignorarDevolucion(d.id, motivo)) toast(`Marcada como «no es una devolución»: ${d.nombre}.`, "ok", { texto: "Deshacer", onClick: () => { if (acciones.volverAProponerDevolucion(d.id)) toast("Vuelve a la lista de reembolsos."); } });
        }}
      />
    </Card>
  );
}
