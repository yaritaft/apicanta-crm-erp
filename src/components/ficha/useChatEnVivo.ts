"use client";

import { useEffect, useRef } from "react";
import { claveDe } from "@/lib/chat-equipo";
import { acciones, estadoSync, useSync } from "@/lib/store";
import { nube } from "@/lib/supabase";
import type { ChatLectura, Comentario } from "@/lib/types";
import { useUsuarioActual } from "@/lib/usuario";

/* ==================================================================
   El chat del equipo EN VIVO, en toda la app (lo monta el Shell): lo
   que escribe otro en cualquier ficha, sus reacciones, lo que borra y
   hasta dónde leyó cada uno llegan solos, sin recargar (Realtime de
   `comentarios` y `chat_lecturas`, supabase/chat-adjuntos.sql).

   Y es lo que pone el doble tilde: cuando a esta app le llegan mensajes
   (al abrirla o en vivo), anota que le llegaron (lib/chat-equipo.ts →
   recibidosAlLlegar). Que los LEYÓ lo anota el chat de la ficha al
   abrirse (ChatEquipo).
   ================================================================== */

async function traerTodo<T>(tabla: string): Promise<T[] | null> {
  if (!nube) return null;
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await nube.from(tabla).select("*").range(desde, desde + 999);
    if (r.error) return null;
    filas.push(...((r.data ?? []) as T[]));
    if ((r.data?.length ?? 0) < 1000) return filas;
  }
}

export function useChatEnVivo(): void {
  const yo = useUsuarioActual();
  const { estado } = useSync();
  const quien = claveDe(yo.email, yo.nombre);
  const yoRef = useRef({ quien, nombre: yo.nombre });
  yoRef.current = { quien, nombre: yo.nombre };

  /* Al terminar de traer todo de la nube (y después de cada guardado), lo que me llegó queda anotado. */
  useEffect(() => {
    if (!nube || !yo.email || estado !== "listo") return;
    acciones.marcarRecibidos(quien, yo.nombre);
  }, [estado, quien, yo.email, yo.nombre]);

  useEffect(() => {
    if (!nube) return;
    const db = nube;
    let vivo = true;
    const anotarLlegada = () => { if (yoRef.current.quien.includes("@")) acciones.marcarRecibidos(yoRef.current.quien, yoRef.current.nombre); };

    /* Al conectarse (y al volver después de un corte) se trae el chat entero: lo que llegó mientras tanto entra acá. */
    const ponerseAlDia = async () => {
      if (estadoSync() === "cargando") return;
      const [cs, ls] = await Promise.all([traerTodo<Comentario>("comentarios"), traerTodo<ChatLectura>("chat_lecturas")]);
      if (!vivo || estadoSync() === "cargando") return;
      if (cs) acciones.recibirComentarios(cs, [], { completo: true });
      if (ls) acciones.recibirLecturas(ls);
      anotarLlegada();
    };

    type Aviso = { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
    const canal = db.channel(`chat-equipo:${Math.random().toString(36).slice(2, 8)}`);
    canal.on("postgres_changes" as never, { event: "*", schema: "public", table: "comentarios" }, async (p: Aviso) => {
      if (estadoSync() === "cargando") return;
      if (p.eventType === "DELETE") {
        if (p.old?.id) acciones.recibirComentarios([], [String(p.old.id)]);
        return;
      }
      const id = p.new?.id ? String(p.new.id) : "";
      if (!id) return;
      /* La fila se vuelve a pedir: en un UPDATE, Realtime puede no mandar las columnas grandes que no cambiaron. */
      const { data } = await db.from("comentarios").select("*").eq("id", id).maybeSingle();
      if (!vivo || !data) return;
      acciones.recibirComentarios([data as Comentario]);
      anotarLlegada();
    });
    canal.on("postgres_changes" as never, { event: "*", schema: "public", table: "chat_lecturas" }, (p: Aviso) => {
      if (estadoSync() === "cargando" || p.eventType === "DELETE" || !p.new?.id) return;
      acciones.recibirLecturas([p.new as unknown as ChatLectura]);
    });
    canal.subscribe((s) => { if (vivo && s === "SUBSCRIBED") void ponerseAlDia(); });
    return () => { vivo = false; void db.removeChannel(canal); };
  }, []);
}
