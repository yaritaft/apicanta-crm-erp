"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { fotoCuadrada } from "@/lib/fotos-perfil";
import { acciones } from "@/lib/store";
import "./foto-perfil.css";

/* ==================================================================
   La foto de perfil. Al entrar a la app sin foto aparece (pedido de
   Juan Cruz, 20/10) y no se cierra tocando afuera: o se elige una o se
   toca «Cargarla después» (o Esc), que deja seguir usando la app y la
   vuelve a pedir al otro día (21/10: así no frena a nadie que no tiene la
   foto a mano). Después se cambia tocando la foto de abajo a la izquierda
   (ahí sí se cierra como cualquier ventana).

   La foto se recorta al cuadrado del medio y se achica en el navegador
   (lib/fotos-perfil.ts): se ve cómo queda antes de guardarla.
   ================================================================== */

export function FotoDePerfil({ quien, nombre, obligatoria, actual, onCerrar, onDespues }: {
  /* Su mail (o, sin nube, su nombre): la fila de `fotos_perfil`. */
  quien: string;
  nombre: string;
  obligatoria: boolean;
  actual?: string;
  onCerrar: () => void;
  /* Sólo en la obligatoria: «Cargarla después». */
  onDespues?: () => void;
}) {
  const toast = useToast();
  const elegir = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [encima, setEncima] = useState(false);
  const primerNombre = nombre.split(" ")[0];

  /* Esc cierra (o pospone, si es la obligatoria); y nada de atrás (una ficha, un hilo) se entera. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (!obligatoria) onCerrar();
      else onDespues?.();
    };
    window.addEventListener("keydown", onKey, true);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey, true); document.body.style.overflow = antes; };
  }, [obligatoria, onCerrar, onDespues]);

  async function preparar(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setTrabajando(true);
    try { setVista(await fotoCuadrada(archivo)); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo leer la foto."); }
    finally { setTrabajando(false); }
  }

  function guardar() {
    if (!vista) return;
    acciones.ponerFoto(quien, nombre, vista);
    toast(obligatoria ? `¡Listo, ${primerNombre}! Ya se ve tu foto.` : "Foto actualizada.");
    onCerrar();
  }

  const mostrar = vista ?? actual;
  return createPortal(
    <div className="fp-fondo" role="dialog" aria-modal="true" aria-labelledby="fp-tit" data-flotante-abierto
      onMouseDown={(ev) => { if (!obligatoria && ev.target === ev.currentTarget) onCerrar(); }}>
      <div className="fp-caja">
        {!obligatoria && <button type="button" className="fp-x" onClick={onCerrar} aria-label="Cerrar" title="Cerrar (Esc)"><X size={18} /></button>}
        <button
          type="button" className={`fp-foto${encima ? " fp-foto--encima" : ""}`} onClick={() => elegir.current?.click()} disabled={trabajando}
          aria-label={mostrar ? "Elegir otra foto" : "Elegir una foto"}
          onDragOver={(ev) => { ev.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
          onDrop={(ev) => { ev.preventDefault(); setEncima(false); void preparar(ev.dataTransfer.files[0]); }}
        >
          {trabajando ? <Loader2 size={28} className="chatx-gira" aria-hidden />
            : mostrar ? <img src={mostrar} alt="" /> /* eslint-disable-line @next/next/no-img-element -- data URL chica */
            : <span className="fp-foto__vacia"><Camera size={30} aria-hidden /><span>Elegí una foto</span></span>}
          {mostrar && !trabajando && <span className="fp-foto__cambiar"><Camera size={16} aria-hidden /></span>}
        </button>

        <h2 id="fp-tit" className="fp-tit">{obligatoria ? `${primerNombre}, poné tu foto de perfil` : "Tu foto de perfil"}</h2>
        <p className="fp-texto">
          {obligatoria
            ? "Así el equipo te reconoce en el chat y en cada ficha. Una foto tuya, de frente y con buena luz."
            : "Es la que ve el equipo en el chat y en cada ficha."}
        </p>
        {error && <p className="fp-error" role="alert">{error}</p>}

        <div className="fp-acc">
          {vista ? (
            <>
              <Button variante="primary" icono={<Check size={16} />} onClick={guardar}>Usar esta foto</Button>
              <Button variante="secondary" onClick={() => elegir.current?.click()}>Elegir otra</Button>
            </>
          ) : (
            <Button variante="primary" icono={<Upload size={16} />} onClick={() => elegir.current?.click()} disabled={trabajando}>
              {actual ? "Elegir otra foto" : "Elegir foto"}
            </Button>
          )}
          {obligatoria && onDespues && <Button variante="ghost" onClick={onDespues}>Cargarla después</Button>}
        </div>
        <p className="fp-ayuda">JPG o PNG. Se recorta en cuadrado, centrada. También podés arrastrarla al círculo.</p>
        <input ref={elegir} type="file" accept="image/*" hidden onChange={(ev) => { void preparar(ev.target.files?.[0]); ev.target.value = ""; }} />
      </div>
    </div>,
    document.body,
  );
}
