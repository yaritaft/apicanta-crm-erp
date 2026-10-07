"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useUsuarioActual } from "@/lib/usuario";
import { leadDeSesion } from "@/lib/etapas-auto";
import { closerDeLlamada, planDePase, responsableTrasPase, type DestinoDePase } from "@/lib/pasar-llamadas";
import type { Lead, Sesion } from "@/lib/types";

/* Quién puede pasar llamadas: quien edita las llamadas y no ve «sólo lo
   suyo». A un closer la base le rechaza cambiarlas de dueño (la llamada
   deja de ser suya: el cambio no pasa el filtro de lo suyo), así que ni se
   le ofrece. Un dueño, el director y los tipos que ven todo, sí. */
export function usePuedePasarLlamadas(): boolean {
  const { acceso } = useAcceso();
  return puedeEditar(acceso, "sesiones") && !acceso?.soloLoSuyo;
}

/* Se puede pasar una llamada que no se canceló. */
export const sePuedePasar = (s: Pick<Sesion, "estado">) => s.estado !== "cancelada";

const frase = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

/** Pasa las llamadas a otro closer, avisa y deja «Deshacer». Devuelve cuántas
 *  cambiaron de closer (las que ya eran de ese closer no cuentan). Cada
 *  llamada queda con la marca de que se eligió a mano: Calendly no la vuelve
 *  a pisar. Si el responsable de la oportunidad era quien la atendía, se va
 *  con la llamada. */
export function usePasarLlamadas() {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();

  return useCallback((llamadas: Sesion[], destino: DestinoDePase): number => {
    const cuando = new Date().toISOString();
    const planes = llamadas
      .map((s) => planDePase(s, destino, { equipo: e.equipo, por: yo.nombre, cuando }))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (planes.length === 0) return 0;

    acciones.editarLlamadas(planes.map((p) => ({ id: p.id, cambios: p.cambios, detalle: p.detalle })));

    /* La oportunidad de cada persona, una sola vez aunque pase varias llamadas suyas. */
    const leads = new Map<string, { lead: Lead; nuevo: string }>();
    for (const p of planes) {
      const s = llamadas.find((x) => x.id === p.id);
      const lead = s ? leadDeSesion(e.leads, s) : undefined;
      const nuevo = lead ? responsableTrasPase(lead, p.de, destino, e.equipo) : null;
      if (lead && nuevo && !leads.has(lead.id)) leads.set(lead.id, { lead, nuevo });
    }
    for (const { lead, nuevo } of leads.values()) {
      acciones.actualizarParcial<Lead>("leads", lead.id, { responsable: nuevo }, lead.nombre,
        `${lead.nombre}: ahora su responsable es ${destino.miembro.nombre} (le pasaron su llamada).`);
    }

    /* A quién se la sacaron: si fue a uno solo, su nombre. */
    const de = [...new Set(planes.map((p) => closerDeLlamada({ anfitrion: p.de }, e.equipo).nombre).filter(Boolean))];
    const quien = destino.miembro.nombre;
    const persona = llamadas.find((s) => s.id === planes[0].id)?.invitado?.trim() || "la persona";
    toast(
      planes.length === 1
        ? `La llamada con ${persona} ahora la atiende ${quien}.${de.length === 1 ? ` ${de[0]} ya no la ve.` : ""}`
        : `Pasaste ${frase(planes.length, "llamada", "llamadas")}${de.length === 1 ? ` de ${de[0]}` : ""} a ${quien}.`,
      "ok",
      {
        texto: "Deshacer",
        onClick: () => {
          acciones.editarLlamadas(planes.map((p) => ({ id: p.id, cambios: p.antes, detalle: `Se deshizo el pase: ${closerDeLlamada({ anfitrion: p.de }, e.equipo).nombre ? `vuelve a ${closerDeLlamada({ anfitrion: p.de }, e.equipo).nombre}` : "vuelve a quedar sin closer"}.` })));
          for (const { lead } of leads.values()) {
            acciones.actualizarParcial<Lead>("leads", lead.id, { responsable: lead.responsable }, lead.nombre, `${lead.nombre}: vuelve su responsable a ${lead.responsable || "nadie"}.`);
          }
        },
      },
    );
    return planes.length;
  }, [e.equipo, e.leads, toast, yo.nombre]);
}
