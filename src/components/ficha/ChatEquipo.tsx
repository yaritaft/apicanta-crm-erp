"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { Avatar, Button, Empty } from "@/components/ui/ui";
import { acciones } from "@/lib/store";
import { fechaHora, relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import type { Comentario } from "@/lib/types";

/* ==================================================================
   El chat del equipo sobre una persona: lo que habló el closer, lo que
   pidió en la llamada, por qué se atrasó con la cuota. Vive en la ficha,
   así lo ve cualquiera que la abra, desde Ventas o desde Servicio.
   Enter manda, Shift+Enter baja de renglón.
   ================================================================== */

export function ChatEquipo({ contactoId, comentarios }: { contactoId: string; comentarios: Comentario[] }) {
  const yo = useUsuarioActual();
  const [texto, setTexto] = useState("");
  const fin = useRef<HTMLDivElement>(null);
  const cuantos = comentarios.length;

  /* Al abrir y con cada mensaje nuevo, lo último a la vista. */
  useEffect(() => { fin.current?.scrollIntoView({ block: "nearest" }); }, [cuantos]);

  function mandar() {
    if (!texto.trim()) return;
    acciones.comentar(contactoId, texto, yo.nombre, yo.email ?? undefined);
    setTexto("");
  }

  const esMio = (c: Comentario) => (yo.email ? c.autorEmail === yo.email : c.autor === yo.nombre);

  return (
    <div className="chat">
      {/* Los mensajes scrollean adentro, como en cualquier chat: la ficha no
          se estira con la charla y la caja para escribir queda abajo. */}
      <div className="chat__lista lista-scroll" role="log" aria-label="Mensajes del equipo">
        {cuantos === 0 ? (
          <Empty
            icono={<MessageSquare size={22} />}
            titulo="Todavía nadie escribió"
            texto="Lo que el equipo anote acá lo ve cualquiera que abra esta ficha: cómo fue la llamada, qué pidió, por qué se atrasó."
          />
        ) : (
          comentarios.map((c) => (
            <div className="chat__msj" key={c.id}>
              <Avatar nombre={c.autor} size={30} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="t-sm t-strong">{c.autor}</span>
                  <span className="t-sm t-subtle" title={fechaHora(c.creadoEn)}>{relativo(c.creadoEn)}</span>
                  {esMio(c) && (
                    <button type="button" className="chat__borrar" aria-label="Borrar mi mensaje"
                      onClick={() => acciones.borrarComentario(c.id)}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <p className="chat__texto">{c.texto}</p>
              </div>
            </div>
          ))
        )}
        <div ref={fin} />
      </div>

      <div className="chat__caja">
        <textarea
          value={texto} rows={2} placeholder={`Escribí algo para el equipo, ${yo.nombre.split(" ")[0]}…`}
          aria-label="Mensaje para el equipo"
          onChange={(ev) => setTexto(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); mandar(); }
          }}
        />
        <Button variante="primary" sm icono={<Send size={14} />} onClick={mandar} disabled={!texto.trim()}>Enviar</Button>
      </div>
    </div>
  );
}
