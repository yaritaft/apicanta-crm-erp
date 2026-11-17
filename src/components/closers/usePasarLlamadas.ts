"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { paseDeLlamadas } from "@/lib/permisos";
import { hayNube } from "@/lib/supabase";
import { miembroDeCloser } from "@/lib/crm";
import { useUsuarioActual } from "@/lib/usuario";
import { leadDeSesion } from "@/lib/etapas-auto";
import { closerDeLlamada, destinoDe, planDePase, responsableTrasPase, type DestinoDePase } from "@/lib/pasar-llamadas";
import type { Lead, Sesion } from "@/lib/types";

/* Quién puede pasar llamadas a cualquiera: quien edita las llamadas y no ve
   «sólo lo suyo» (un dueño, el director y los tipos que ven todo). El closer
   no reparte llamadas; la que atendió él sí la pone a su nombre
   (useTomarLlamada, más abajo). La regla está en lib/permisos.ts. */
export function usePuedePasarLlamadas(): boolean {
  const { acceso } = useAcceso();
  return paseDeLlamadas(acceso) === "pasar";
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

  return useCallback((llamadas: Sesion[], destino: DestinoDePase, opciones?: { /* La toma quien la atendió: el aviso le habla a él. */ mia?: boolean }): number => {
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
      opciones?.mia
        ? `Listo: la llamada con ${persona} quedó a tu nombre${de.length === 1 ? ` (figuraba ${de[0]})` : ""}.`
        : planes.length === 1
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

/** «La atendí yo»: el closer que ve las llamadas de todos pone a su nombre
 *  una que figura a nombre de otro (o de nadie). Sólo a su nombre: repartir
 *  llamadas sigue siendo del director. `puede` dice si a esa llamada le
 *  corresponde el botón; `tomar` la pasa (con «Deshacer», como cualquier pase). */
export function useTomarLlamada(): { yo?: DestinoDePase; puede: (s: Pick<Sesion, "estado" | "anfitrion">) => boolean; tomar: (s: Sesion) => void } {
  const e = useEstado();
  const { acceso } = useAcceso();
  const usuario = useUsuarioActual();
  const pasar = usePasarLlamadas();
  /* Quién soy en Equipo: por el correo de la sesión. Sin nube nadie inicia sesión: vale el nombre del «Responsable» de Ajustes. */
  const miembro = usuario.miembro ?? (hayNube ? undefined : miembroDeCloser(usuario.nombre, e.equipo));
  const yo = paseDeLlamadas(acceso) === "tomar" && miembro?.activo ? destinoDe(e, miembro.id) : undefined;
  return {
    yo,
    puede: (s) => Boolean(yo) && sePuedePasar(s) && closerDeLlamada(s, e.equipo).miembro?.id !== yo!.miembro.id,
    tomar: (s) => { if (yo) pasar([s], yo, { mia: true }); },
  };
}
