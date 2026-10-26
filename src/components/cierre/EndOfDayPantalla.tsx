"use client";

import React, { useEffect, useState } from "react";
import { useAcceso } from "@/lib/acceso";
import { nivelDeRuta, veLaLiquidacion } from "@/lib/permisos";
import { useToast } from "@/components/ui/Toast";
import { useChequeos } from "@/lib/chequeos-finanzas";
import { EndOfDay } from "./EndOfDay";
import "./cierre.css";

/* La pantalla propia del End of Day (antes era una pestaña de Finanzas): trae lo que tilda el equipo y el reloj. */
export function EndOfDayPantalla() {
  const { acceso } = useAcceso();
  const esDueno = veLaLiquidacion(acceso);
  const { chequeos, marcar, cargando, error, limpiarError } = useChequeos();
  const toast = useToast();
  /* Si la base rechazó lo último que se guardó, se avisa (y no queda como hecho). */
  useEffect(() => { if (error) { toast(error); limpiarError(); } }, [error, limpiarError, toast]);
  /* El reloj corre cada minuto: pasada la medianoche, «hoy» es otro día. */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);
  if (cargando && Object.keys(chequeos).length === 0) return <div className="cm"><p className="cm-eod__sub">Cargando los cierres…</p></div>;
  return (
    <div className="cm">
      <EndOfDay ahora={ahora} esDueno={esDueno} chequeos={chequeos} marcar={marcar} soloMirar={nivelDeRuta(acceso, "/finanzas") < 2} />
    </div>
  );
}
