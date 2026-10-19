"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { enlaceWhatsapp, numeroParaCopiar } from "@/lib/contacto-telefono";

/* Copiar al portapapeles. `navigator.clipboard` no existe fuera de https (ni
   en algunos navegadores del celular): ahí se cae al textarea escondido. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
  } catch { /* sin permiso: se prueba el otro camino */ }
  try {
    const t = document.createElement("textarea");
    t.value = texto; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(t);
    return ok;
  } catch { return false; }
}

/* El mail de una persona, igual que el teléfono: tocarlo lo copia (para darle los accesos,
   escribirle desde otra herramienta). Sin ícono de chat: el mail ya es un solo dato. */
export function Correo({ valor, vacio, compacto }: { valor?: string | null; vacio?: string; compacto?: boolean }) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const reloj = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(reloj.current), []);
  const texto = String(valor ?? "").trim();
  if (!texto) return vacio ? <span className="t-sm t-subtle">{vacio}</span> : null;
  async function copiar(ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!(await copiarTexto(texto))) { toast("No se pudo copiar el mail.", "err"); return; }
    toast("Mail copiado.");
    setCopiado(true);
    window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => setCopiado(false), 1600);
  }
  return (
    <span className={`telefono${compacto ? " telefono--compacto" : ""}`} onMouseDown={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}>
      <button type="button" className="telefono__num" onClick={copiar} title="Tocá para copiar el mail" aria-label={`Copiar el mail ${texto}`}>
        <span className="truncate">{texto}</span>
        {!compacto && (copiado ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />)}
      </button>
    </span>
  );
}

/* El teléfono de una persona: tocar el número lo copia de una (con un aviso) y el ícono
   de al lado abre su chat de WhatsApp. El mismo en el cierre del día, la tabla de llamadas,
   la grilla y la ficha. `pais` es el de la persona y ayuda a completar el código si falta. */
export function Telefono({ valor, pais, vacio, compacto }: {
  valor?: string | null; pais?: string | null;
  /* Qué decir si no hay número (sin esto, no se muestra nada). */
  vacio?: string;
  /* En una celda de tabla: más chico y sin ícono de copiar, el número ya lo dice con el cursor. */
  compacto?: boolean;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const reloj = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(reloj.current), []);

  const texto = String(valor ?? "").trim();
  if (!texto) return vacio ? <span className="t-sm t-subtle">{vacio}</span> : null;
  const chat = enlaceWhatsapp(texto, pais);

  /* La tabla y la grilla abren la celda al tocar: acá el toque es del número. */
  const frenar = (ev: React.SyntheticEvent) => ev.stopPropagation();

  async function copiar(ev: React.MouseEvent) {
    ev.stopPropagation();
    const ok = await copiarTexto(numeroParaCopiar(texto, pais));
    if (!ok) { toast("No se pudo copiar el número.", "err"); return; }
    toast("Teléfono copiado.");
    setCopiado(true);
    window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => setCopiado(false), 1600);
  }

  return (
    <span className={`telefono${compacto ? " telefono--compacto" : ""}`} onMouseDown={frenar} onDoubleClick={frenar}>
      <button type="button" className="telefono__num t-num" onClick={copiar} title="Tocá para copiar el número" aria-label={`Copiar el teléfono ${texto}`}>
        <span className="truncate">{texto}</span>
        {!compacto && (copiado ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />)}
      </button>
      {chat && (
        <a className="telefono__wa" href={chat} target="_blank" rel="noopener noreferrer" onClick={frenar}
          title="Abrir el chat de WhatsApp" aria-label={`Abrir el chat de WhatsApp con ${texto}`}>
          <MessageCircle size={compacto ? 14 : 15} aria-hidden />{!compacto && "WhatsApp"}
        </a>
      )}
    </span>
  );
}
