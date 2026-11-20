"use client";

import React, { useMemo, useState } from "react";
import { FileQuestion } from "lucide-react";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { usePendientesDelMes } from "@/components/conciliacion/usePendientes";
import { fecha, money } from "@/lib/format";
import { mesDeNegocio } from "@/lib/dia-negocio";
import { moverPeriodo, nombrePeriodo } from "@/lib/periodos";
import { ventasSinFormulario } from "@/lib/pendientes-conciliar";
import type { EstadoApp, MiembroEquipo } from "@/lib/types";

/* ==================================================================
   «Ventas sin formulario» en el Mi panel del closer (Aldana, 20/11: «necesitamos que los closers puedan ver las ventas que no están
   asignadas a formulario, el punto 4 que yo veo en Finanzas»). Son las ventas suyas de este mes y del anterior cuya persona no tiene el
   formulario de la landing atado ni está marcada como «vino por otro camino»: sin eso la venta no se atribuye a ningún anuncio.
   Es sólo para mirar; unirlas o marcarlas es de Finanzas y del director. Sin ventas así no ocupa lugar.
   ================================================================== */

const POR_DEFECTO = 6;

export function VentasSinFormulario({ e, miembro, ahora }: { e: EstadoApp; miembro: MiembroEquipo; ahora: number }) {
  const abrirFicha = useAbrirFicha();
  const [todas, setTodas] = useState(false);
  const actual = mesDeNegocio(ahora);
  const esteMes = usePendientesDelMes(actual, true, true);
  const anterior = usePendientesDelMes(moverPeriodo(actual, -1), true, true);

  const filas = useMemo(
    () => [anterior, esteMes]
      .filter((d) => d.carga === "listo")
      .flatMap((d) => ventasSinFormulario(d.pendientes, e.ventas, miembro.id).map((v) => ({ ...v, mes: d.mes })))
      .sort((a, b) => b.dia.localeCompare(a.dia) || a.nombre.localeCompare(b.nombre, "es")),
    [anterior, esteMes, e.ventas, miembro.id],
  );
  if (filas.length === 0) return null;

  const visibles = todas ? filas : filas.slice(0, POR_DEFECTO);
  const meses = [...new Set(filas.map((f) => f.mes))].sort().map(nombrePeriodo).join(" y ");
  return (
    <section className="mp-card" aria-label="Ventas sin formulario">
      <div className="mp-cap-fila">
        <span className="mp-cap"><FileQuestion size={14} aria-hidden /> Ventas sin formulario</span>
        <span className="mp-cuenta">{filas.length}</span>
      </div>
      <span className="mp-nota" style={{ marginTop: 2 }}>
        Ventas de {meses} cuya persona no llenó el formulario de la landing (o todavía no se unió). Sin eso no se sabe de qué anuncio vino.
        Si sabés cómo llegó, avisale a Finanzas: ellas lo resuelven.
      </span>
      <div className="mp-cobros">
        {visibles.map((f) => (
          <div key={f.ventaId} className="mp-cobros__fila">
            <span className="mp-cobros__fecha">{fecha(f.dia)}</span>
            <span className="mp-cobros__nombre">
              <button type="button" className="link" onClick={() => abrirFicha(f.ventaId, "ventas", { venta: f.ventaId })}>{f.nombre}</button>
            </span>
            {f.sinFicha && <span className="t-sm t-subtle">sin ficha de contacto</span>}
            {f.monto ? <span className="mp-cobros__monto">{money(f.monto, f.moneda ?? "USD", 0)}</span> : null}
          </div>
        ))}
      </div>
      {filas.length > POR_DEFECTO && (
        <button type="button" className="link t-sm" onClick={() => setTodas((x) => !x)}>
          {todas ? "Ver menos" : `Ver las ${filas.length} ventas`}
        </button>
      )}
    </section>
  );
}
