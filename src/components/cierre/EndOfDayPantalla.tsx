"use client";

import React, { useEffect, useState } from "react";
import { useAcceso } from "@/lib/acceso";
import { useChequeos } from "@/lib/chequeos-finanzas";
import { EndOfDay } from "./EndOfDay";
import "./cierre.css";

/* La pantalla propia del End of Day (antes era una pestaña de Finanzas): trae lo que tilda el equipo y el reloj. */
export function EndOfDayPantalla() {
  const { esDueno } = useAcceso();
  const { chequeos, marcar } = useChequeos();
  /* El reloj corre cada minuto: pasada la medianoche, «hoy» es otro día. */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);
  return (
    <div className="cm">
      <EndOfDay ahora={ahora} esDueno={esDueno} chequeos={chequeos} marcar={marcar} />
    </div>
  );
}
