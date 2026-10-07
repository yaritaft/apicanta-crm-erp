"use client";

import { useRouter } from "next/navigation";
import { Eod } from "@/components/crm-tabla/Eod";
import { useAcceso } from "@/lib/acceso";
import { esCuentaDeCloser } from "@/lib/permisos";

/* Cerrar el día: entrada propia del closer (antes era un botón dentro del
   CRM). Abre el cierre del día de siempre; al terminar o cerrarlo, vuelve a
   «Mis llamadas» (quien no es closer, al CRM). */
export default function CerrarElDia() {
  const router = useRouter();
  const { acceso } = useAcceso();
  const volver = esCuentaDeCloser(acceso) ? "/mis-llamadas" : "/crm";
  return <Eod onCerrar={() => router.push(volver)} />;
}
