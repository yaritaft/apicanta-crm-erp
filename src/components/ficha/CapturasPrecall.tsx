"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, ExternalLink, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/ui";
import { Confirmar, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import {
  ACEPTA_CAPTURA, borrarCaptura, capturasDe, problemaDeCaptura, subirCaptura, tamanioLegible, urlsDeCapturas, type CapturaPrecall,
} from "@/lib/precall";
import { fechaHora } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import "./capturas-precall.css";

/* ==================================================================
   Las capturas de la pre-call de una llamada (lib/precall): el chat que
   le escribió el setter o el closer antes de la llamada. Sirve para asignar
   la comisión del setter y, cuando la llamada se cancela, como prueba de
   que el closer le escribió (Santi, 26/10).

   Se suben eligiendo, arrastrando o pegando (Ctrl+V con el recuadro
   enfocado, o con «Pegar»), se ven grandes con un clic y se borran con
   confirmación. Lo que cada cuenta puede hacer lo decide la base: acá se
   esconde lo que seguro no puede.
   ================================================================== */

export function CapturasPrecall({ sesionId }: { sesionId: string }) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const { acceso } = useAcceso();
  /* El closer y el director editan las llamadas; el setter sube a las que marcó suyas (o sin marcar). */
  const puede = puedeEditar(acceso, "sesiones") || acceso?.tipo === "setter";
  const [capturas, setCapturas] = useState<CapturaPrecall[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const [grande, setGrande] = useState<CapturaPrecall | null>(null);
  const [aBorrar, setABorrar] = useState<CapturaPrecall | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const cs = await capturasDe(sesionId);
      setCapturas(cs);
      setUrls(cs.length ? await urlsDeCapturas(cs).catch(() => new Map<string, string>()) : new Map());
      setError(null);
    } catch (err) {
      setCapturas([]);
      setError(err instanceof Error ? err.message : "No se pudieron traer las capturas.");
    }
  }, [sesionId]);
  useEffect(() => { setCapturas(null); void cargar(); }, [cargar]);

  async function subir(archivos: File[]) {
    const imagenes = archivos.filter((a) => a.type.startsWith("image/") || /\.hei[cf]$/i.test(a.name));
    if (imagenes.length === 0) { setError("Tiene que ser una imagen (captura en PNG, JPG, WEBP o HEIC)."); return; }
    setError(null);
    setSubiendo((n) => n + imagenes.length);
    let subidas = 0;
    for (const a of imagenes) {
      const problema = problemaDeCaptura(a);
      try {
        if (problema) throw new Error(problema);
        await subirCaptura(sesionId, a, { nombre: yo.nombre, email: yo.email });
        subidas++;
      } catch (err) { setError(err instanceof Error ? err.message : "No se pudo subir la captura."); }
      setSubiendo((n) => n - 1);
    }
    if (subidas > 0) { toast(subidas === 1 ? "Captura subida." : `${subidas} capturas subidas.`); await cargar(); }
  }

  /* «Pegar»: lee el portapapeles (el navegador pide permiso la primera vez). */
  async function pegar() {
    try {
      const items = await navigator.clipboard.read();
      const archivos: File[] = [];
      for (const it of items) {
        const tipo = it.types.find((t) => t.startsWith("image/"));
        if (tipo) archivos.push(new File([await it.getType(tipo)], "image." + (tipo.split("/")[1] ?? "png"), { type: tipo }));
      }
      if (archivos.length === 0) { setError("No hay ninguna imagen copiada. Sacá la captura (Cmd+Ctrl+Shift+4 en Mac) y volvé a tocar «Pegar»."); return; }
      await subir(archivos);
    } catch {
      setError("El navegador no dejó leer lo copiado: hacé clic en el recuadro y pegá con Ctrl+V (Cmd+V en Mac).");
    }
  }

  async function borrar() {
    const c = aBorrar;
    if (!c) return;
    try { await borrarCaptura(c); toast("Captura borrada."); setGrande(null); await cargar(); }
    catch (err) { toast(err instanceof Error ? err.message : "No se pudo borrar.", "err"); }
  }

  const n = capturas?.length ?? 0;
  if (capturas !== null && n === 0 && !puede && !error) return null;

  return (
    <section className="precall" aria-label="Capturas de la pre-call">
      <header className="precall__cabeza">
        <span className="t-label">Capturas de la pre-call{n > 0 ? ` (${n})` : ""}</span>
        {puede && (
          <span className="precall__botones">
            <input ref={input} type="file" accept={ACEPTA_CAPTURA} multiple hidden
              onChange={(ev) => { void subir([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
            <Button sm variante="ghost" icono={<ImagePlus size={14} />} onClick={() => input.current?.click()} disabled={subiendo > 0}>Subir</Button>
            <Button sm variante="ghost" icono={<ClipboardPaste size={14} />} onClick={() => void pegar()} disabled={subiendo > 0}>Pegar</Button>
          </span>
        )}
      </header>

      {puede && (
        <div className="precall__zona" tabIndex={0} data-encima={encima} role="group"
          aria-label="Soltá o pegá una captura acá"
          onDragOver={(ev) => { ev.preventDefault(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={(ev) => { ev.preventDefault(); setEncima(false); void subir([...ev.dataTransfer.files]); }}
          onPaste={(ev) => {
            const archivos = [...ev.clipboardData.files];
            if (archivos.length > 0) { ev.preventDefault(); void subir(archivos); }
          }}>
          {subiendo > 0
            ? <span className="precall__subiendo"><Loader2 size={15} className="gira" /> Subiendo {subiendo === 1 ? "la captura" : `${subiendo} capturas`}…</span>
            : <span className="t-sm t-subtle">{n === 0
              ? "El chat con la persona antes de la llamada: sirve para la comisión del setter y como prueba si cancela. Arrastrá, pegá (Ctrl+V) o elegí las capturas."
              : "Arrastrá, pegá (Ctrl+V) o elegí más capturas."}</span>}
        </div>
      )}
      {error && <p className="precall__error" role="alert">{error}</p>}

      {capturas === null && <div className="skeleton" style={{ height: 64 }} aria-busy="true" aria-label="Trayendo las capturas" />}
      {n > 0 && (
        <ul className="precall__grilla">
          {capturas!.map((c) => (
            <li key={c.id} className="precall__item">
              <button type="button" className="precall__miniatura" onClick={() => setGrande(c)} aria-label={`Ver la captura ${c.nombre}`}>
                {urls.get(c.id)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={urls.get(c.id)} alt={`Captura de la pre-call: ${c.nombre}`} />
                  : <span className="t-sm t-subtle">{c.tipo === "image/heic" || c.tipo === "image/heif" ? "HEIC" : "…"}</span>}
              </button>
              <span className="precall__pie t-sm t-subtle truncate">{c.subidoPor ? `${c.subidoPor.split(" ")[0]} · ` : ""}{fechaHora(c.subidoEn)}</span>
            </li>
          ))}
        </ul>
      )}

      <Modal abierto={grande !== null} onCerrar={() => setGrande(null)} xl
        titulo="Captura de la pre-call"
        sub={grande ? [grande.subidoPor ? `Subió ${grande.subidoPor}` : "", fechaHora(grande.subidoEn), tamanioLegible(grande.tamanio)].filter(Boolean).join(" · ") : undefined}
        pie={grande && (
          <>
            <IconButton etiqueta="Borrar la captura" onClick={() => setABorrar(grande)}><Trash2 size={16} /></IconButton>
            <span className="spacer" />
            {urls.get(grande.id) && (
              <a className="link t-sm" href={urls.get(grande.id)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Abrir en otra pestaña</a>
            )}
            <Button variante="ghost" icono={<X size={14} />} onClick={() => setGrande(null)}>Cerrar</Button>
          </>
        )}>
        {grande && urls.get(grande.id) && (
          <div className="precall__grande">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls.get(grande.id)} alt={`Captura de la pre-call: ${grande.nombre}`} />
          </div>
        )}
      </Modal>
      <Confirmar abierto={aBorrar !== null} onCerrar={() => setABorrar(null)} titulo="¿Borrar esta captura?"
        texto="Se saca de la llamada y no se puede recuperar. Sólo la puede borrar quien la subió, un dueño o el director."
        confirmarTexto="Borrar" onConfirmar={() => { void borrar(); setABorrar(null); }} />
    </section>
  );
}
