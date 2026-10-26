"use client";

import { useEffect } from "react";
import { nube } from "@/lib/supabase";
import { useSesion } from "@/lib/auth";
import { acciones, escrituraPendiente, estadoSync, snapshotDeResells } from "@/lib/store";
import type { Resell } from "@/lib/types";

/* ==================================================================
   La agenda de resells al día sin recargar (Lili, 26/10: Daniel Arroyo agendó
   su resell con Mariano a las 17:27 y a las 17:34 no aparecía «ni en la ficha
   ni en la lista»: estaba en la base, pero la app abierta desde antes no se
   enteraba). Los resells los escribe el servidor cuando entra la agenda de
   Calendly; acá se escucha la tabla (Realtime, supabase/resells-en-vivo.sql)
   y cada fila nueva o cambiada entra a la memoria: la agenda de resells, la
   ficha del alumno, Mi panel y el panel de Lili la muestran al instante.
   Al conectarse (o volver a la pestaña) se trae todo, por lo que llegó con
   la pantalla dormida. La RLS deja ver sólo a quien ve resells.
   ================================================================== */

export function ResellsEnVivo() {
  const { email } = useSesion();
  useEffect(() => {
    if (!nube || !email) return;
    const db = nube;
    let vivo = true;
    const ponerseAlDia = async () => {
      if (estadoSync() === "cargando") return;
      const r = await db.from("resells").select("*");
      if (!vivo || r.error || estadoSync() === "cargando") return;
      const filas = ((r.data ?? []) as Resell[]).filter((x) => !escrituraPendiente("resells", x.id));
      const enLaBase = new Set((r.data ?? []).map((x) => String((x as { id: string }).id)));
      /* Lo que se borró en la base (una reprogramación que se unió a otra) también se va de acá. */
      const borradas = snapshotDeResells().filter((id) => !enLaBase.has(id) && !escrituraPendiente("resells", id));
      acciones.recibirDeLaNube("resells", filas, borradas);
    };
    const canal = db.channel(`resells:${Math.random().toString(36).slice(2, 8)}`);
    canal.on("postgres_changes" as never, { event: "*", schema: "public", table: "resells" },
      async (p: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        if (p.eventType === "DELETE") {
          if (p.old?.id && !escrituraPendiente("resells", String(p.old.id))) acciones.recibirDeLaNube("resells", [], [String(p.old.id)]);
          return;
        }
        const id = p.new?.id ? String(p.new.id) : "";
        if (!id || escrituraPendiente("resells", id) || estadoSync() === "cargando") return;
        const { data } = await db.from("resells").select("*").eq("id", id).maybeSingle();
        if (vivo && data) acciones.recibirDeLaNube("resells", [data as Resell]);
      });
    canal.subscribe((s) => { if (vivo && s === "SUBSCRIBED") void ponerseAlDia(); });
    const alVolver = () => { if (document.visibilityState === "visible") void ponerseAlDia(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      void db.removeChannel(canal);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [email]);
  return null;
}
