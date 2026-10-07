"use client";

import React, { useState } from "react";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { hayNube } from "@/lib/store";
import { extensionDe, nombreDeArchivo } from "@/lib/meta-descarga";
import type { MedioAnuncio } from "@/lib/meta-creativo";
import "./descargar.css";

/* ==================================================================
   El botón «Descargar» de cada video o imagen del anuncio (reunión del
   02/10: «podés descargar también el anuncio»).

   Los links de Meta son de otro origen y vencen: un clic en el link no
   baja nada. Se le pide el archivo a nuestro servidor (api/meta/descargar),
   que se lo pide a Meta con el anuncio recién leído y se lo pasa al
   navegador; acá se guarda con su nombre. Si Meta no entrega el archivo se
   dice por qué y qué hacer, no se baja uno roto. Sin conexión con Meta (la
   app local) sólo anda con un material de prueba (apicanta.previa-de-prueba),
   que se baja directo.
   ================================================================== */

type Resultado = { ok: true; archivo: string } | { ok: false; error: string };

export async function bajarMedio(o: {
  metaId: string; nombre: string; medio: MedioAnuncio; indice: number; total: number;
}): Promise<Resultado> {
  const { medio: m } = o;
  let respuesta: Response;
  try {
    respuesta = hayNube
      ? await fetch(
        `/api/meta/descargar?${new URLSearchParams({
          ad: o.metaId, medio: String(o.indice), tipo: m.tipo, de: String(o.total), nombre: o.nombre,
          ...(m.sinArchivo ? { portada: "1" } : {}),
        })}`,
        { cache: "no-store", headers: await cabeceras() },
      )
      : await fetch(m.src);
  } catch {
    return { ok: false, error: "No hay conexión: no se pudo bajar el archivo. Probá de nuevo." };
  }

  if (!respuesta.ok) {
    if (respuesta.status === 401 && hayNube) return { ok: false, error: "Tu sesión venció. Volvé a entrar y probá de nuevo." };
    const j = (await respuesta.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: j?.error ?? "Meta no entregó el archivo. Probá de nuevo en un rato." };
  }

  let blob: Blob;
  try {
    blob = await respuesta.blob();
  } catch {
    return { ok: false, error: "Se cortó la descarga del archivo. Probá de nuevo." };
  }
  if (blob.size === 0) return { ok: false, error: "Meta mandó un archivo vacío. Probá de nuevo en un rato." };

  const archivo = nombreDeArchivo(o.nombre, {
    extension: extensionDe(blob.type || respuesta.headers.get("content-type"), m.tipo),
    indice: o.indice, total: o.total, etiqueta: m.etiqueta, portada: m.sinArchivo,
  });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true, archivo };
}

export function BotonDescargar({ metaId, nombre, medio, indice, total }: {
  metaId: string; nombre: string; medio: MedioAnuncio; indice: number; total: number;
}) {
  const toast = useToast();
  const [bajando, setBajando] = useState(false);
  const portada = Boolean(medio.sinArchivo);
  const que = portada ? "la portada" : medio.tipo === "video" ? "el video" : "la imagen";

  async function bajar(ev: React.MouseEvent) {
    ev.stopPropagation();
    if (bajando) return;
    setBajando(true);
    const r = await bajarMedio({ metaId, nombre, medio, indice, total });
    setBajando(false);
    if (r.ok) toast(`Se bajó «${r.archivo}».`);
    else toast(r.error, "err");
  }

  return (
    <button
      type="button" className="mk-medio__bajar" onClick={bajar} disabled={bajando} aria-busy={bajando}
      aria-label={`Descargar ${que} del anuncio ${nombre}${total > 1 ? ` (${indice + 1} de ${total})` : ""}`}
      title={portada ? "Meta no entregó el video de este anuncio: esto baja sólo su portada." : `Descargar ${que}`}
    >
      {bajando ? <span className="mk-medio__bajar-giro" aria-hidden /> : <Download size={14} aria-hidden />}
      {bajando ? "Descargando…" : portada ? "Descargar portada" : "Descargar"}
    </button>
  );
}
