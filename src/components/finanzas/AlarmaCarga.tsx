"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { saludDeLaCarga } from "@/lib/salud-carga";
import { fechaLarga, money } from "@/lib/format";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   La alarma de la carga: salta sola en el Panel cuando hace días que nadie
   carga una venta o cuando hay cobros de pasarela esperando una venta.
   Que se note al tercer día y no a la semana. Las cuentas están en lib/salud-carga.ts.
   ================================================================== */

const dias = (n: number) => (n === 1 ? "1 día" : `${n} días`);

export function AlarmaCarga({ e }: { e: EstadoApp }) {
  const s = useMemo(() => saludDeLaCarga(e), [e]);
  if (s.nivel === "ok") return null;
  const mon = e.ajustes.monedaBase;
  const alarma = s.nivel === "alarma";
  return (
    <div className={`alarma${alarma ? "" : " alarma--atencion"}`} role={alarma ? "alert" : "status"}>
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">{alarma ? "La carga está frenada" : "Hay carga atrasada"}</div>
        <div className="alarma__texto">
          {s.pendientes.includes("cargar-ventas") && s.ultimaVenta && (
            <>La última venta cargada es del <strong>{fechaLarga(`${s.ultimaVenta.dia}T12:00:00`)}</strong> (hace <strong>{dias(s.ultimaVenta.dias)}</strong>). </>
          )}
          {s.sinAsignar && (
            <>
              <strong>{s.sinAsignar.n === 1 ? "1 cobro" : `${s.sinAsignar.n} cobros`}</strong>
              {s.sinAsignar.monto > 0 && <> por <strong className="t-num">{money(s.sinAsignar.monto, mon)}</strong></>} entraron a una pasarela y siguen sin asignar a una venta:
              no cuentan como cobrados. El más viejo espera hace <strong>{dias(s.sinAsignar.masViejoDias)}</strong>.
            </>
          )}
        </div>
      </div>
      {s.pendientes.includes("cargar-ventas") && <Link href="/cargar-venta" className="hk-btn hk-btn--secondary hk-btn--sm">Cargar una venta</Link>}
      {s.sinAsignar && <Link href="/conciliacion?estado=pendiente" className="hk-btn hk-btn--secondary hk-btn--sm">Asignar cobros</Link>}
    </div>
  );
}
