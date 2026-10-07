"use client";

import { CrmTabla } from "@/components/crm-tabla/CrmTabla";

/* Mis llamadas: el CRM, de hoy. Es lo primero que ve un closer (Yari, 02/10:
   «veo mis llamadas y veo cómo completar el estado de mis llamadas, punto»):
   arriba dice cuántas llamadas tiene hoy y cuántas faltan cargar, y el
   estado de cada una se cambia ahí mismo. */
export default function MisLlamadas() {
  return <CrmTabla misLlamadas />;
}
