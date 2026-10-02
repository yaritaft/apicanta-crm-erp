"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Check, Trash2, User, Users } from "lucide-react";
import { useToast } from "./Toast";
import { useAcceso } from "@/lib/acceso";
import { useEscribirURL } from "@/lib/useParamsURL";
import { useVistasGuardadas } from "@/lib/useVistasGuardadas";
import { consultaDeVista, destinoDeVista, nombreDeVista, NOMBRE_MAXIMO, PARAM_VISTA, type VistaGuardada } from "@/lib/vistas-guardadas";

/* ==================================================================
   Las vistas guardadas de una pantalla, como en Notion: lo que se está
   viendo (filtros, orden, período, búsqueda y columnas) se guarda con un
   nombre, sólo para uno o para todo el equipo, y después se abre con un
   clic. Una vista es el mismo link que copia «Copiar link»
   (lib/vistas-guardadas.ts).

   El botón dice qué vista está abierta y, si se tocó algo desde que se
   abrió, lo marca: se puede guardar el cambio en la vista o dejarla como
   estaba.
   ================================================================== */

export function VistasGuardadas({ pantalla, extra, todas = "Todo, sin filtros" }: {
  /* De qué pantalla son: "crm". */
  pantalla: string;
  /* Lo que la pantalla suma al link además de la URL: sus columnas. */
  extra?: Record<string, string>;
  /* Cómo se llama la pantalla sin nada puesto. */
  todas?: string;
}) {
  const ruta = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const escribir = useEscribirURL();
  const toast = useToast();
  const { acceso } = useAcceso();
  const vistas = useVistasGuardadas(pantalla);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [deEquipo, setDeEquipo] = useState(false);
  const [porBorrar, setPorBorrar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => { if (raiz.current && !raiz.current.contains(ev.target as Node)) setAbierto(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);
  /* Cada vez arranca en «Sólo para mí»: guardar para todos se elige a propósito. */
  useEffect(() => { if (!abierto) { setPorBorrar(null); setNombre(""); setDeEquipo(false); } }, [abierto]);

  /* Las del equipo las guarda quien ve todo: el closer, las suyas. */
  const puedeEquipo = vistas.conEquipo && Boolean(acceso) && !acceso?.soloLoSuyo;
  const todasLasVistas = [...vistas.propias, ...vistas.equipo];
  const actual = consultaDeVista(params.toString(), extra);
  const elegida = params.get(PARAM_VISTA);
  const activa = elegida ? todasLasVistas.find((v) => v.id === elegida) : undefined;
  const modificada = Boolean(activa && activa.consulta !== actual);
  const puedeCambiar = (v: VistaGuardada) => !v.deEquipo || puedeEquipo;
  /* Sin el período ni las columnas, ¿hay algo puesto? Si no, es la pantalla de siempre. */
  const pelada = [...params.keys()].every((k) => k === PARAM_VISTA);

  const abrir = (v: VistaGuardada) => { setAbierto(false); router.replace(destinoDeVista(ruta, v), { scroll: false }); };
  const limpiar = () => { setAbierto(false); router.replace(ruta, { scroll: false }); };

  async function guardarNueva() {
    const n = nombreDeVista(nombre, todasLasVistas, deEquipo);
    if ("error" in n) { toast(n.error, "err"); return; }
    setOcupado(true);
    const r = await vistas.guardar({ nombre: n.nombre, consulta: actual, deEquipo });
    setOcupado(false);
    if (r.error || !r.id) { toast(r.error ?? "No se pudo guardar la vista.", "err"); return; }
    escribir({ [PARAM_VISTA]: r.id });
    setNombre("");
    setAbierto(false);
    toast(deEquipo ? `Vista «${n.nombre}» guardada para todo el equipo.` : `Vista «${n.nombre}» guardada, sólo para vos.`);
  }

  async function guardarCambios() {
    if (!activa) return;
    setOcupado(true);
    const r = await vistas.actualizar(activa, { consulta: actual });
    setOcupado(false);
    if (r.error) { toast(r.error, "err"); return; }
    toast(`«${activa.nombre}» quedó como la estás viendo${activa.deEquipo ? ", para todo el equipo" : ""}.`);
  }

  async function borrar(v: VistaGuardada) {
    setOcupado(true);
    const r = await vistas.borrar(v);
    setOcupado(false);
    setPorBorrar(null);
    if (r.error) { toast(r.error, "err"); return; }
    if (elegida === v.id) escribir({ [PARAM_VISTA]: null });
    toast(`Se borró la vista «${v.nombre}».`);
  }

  const seccion = (titulo: string, icono: React.ReactNode, lista: VistaGuardada[], vacio: string) => (
    <div className="vg-seccion">
      <div className="vg-titulo">{icono}{titulo}</div>
      {lista.length === 0 && <p className="vg-vacio">{vacio}</p>}
      {lista.map((v) => (
        <div key={v.id} className="vg-fila" data-activa={activa?.id === v.id || undefined}>
          <button type="button" className="vg-abrir" onClick={() => abrir(v)} title={`Abrir «${v.nombre}»`}>
            <span className="truncate">{v.nombre}</span>
            {activa?.id === v.id && <Check size={14} aria-label="Abierta" />}
          </button>
          {puedeCambiar(v) && (porBorrar === v.id ? (
            <span className="vg-confirmar">
              <button type="button" className="hk-btn hk-btn--danger hk-btn--sm" disabled={ocupado} onClick={() => void borrar(v)}>Borrar</button>
              <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => setPorBorrar(null)}>No</button>
            </span>
          ) : (
            <button type="button" className="vg-borrar" onClick={() => setPorBorrar(v.id)} aria-label={`Borrar la vista ${v.nombre}`} title="Borrar la vista"><Trash2 size={14} /></button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={raiz} className="vg" style={{ position: "relative" }}>
      <button type="button" className={`dp-pill vg-boton${abierto ? " dp-pill--open" : ""}`} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)} title="Vistas guardadas: abrí una o guardá lo que estás viendo">
        <Bookmark size={14} fill={activa ? "currentColor" : "none"} />
        <span className="truncate">{activa ? activa.nombre : "Vistas"}</span>
        {modificada && <span className="vg-punto" aria-label="Con cambios sin guardar" title="Cambiaste algo desde que abriste la vista" />}
        <span className="dp-caret">▾</span>
      </button>

      {abierto && (
        <div className="vg-pop" role="dialog" aria-label="Vistas guardadas">
          <div className="vg-fila" data-activa={(!activa && pelada) || undefined}>
            <button type="button" className="vg-abrir" onClick={limpiar}>
              <span className="truncate">{todas}</span>
              {!activa && pelada && <Check size={14} aria-label="Abierta" />}
            </button>
          </div>
          {seccion("Mías", <User size={13} />, vistas.propias, "Todavía no guardaste ninguna.")}
          {vistas.conEquipo && seccion("Del equipo", <Users size={13} />, vistas.equipo, "Todavía no hay vistas del equipo.")}

          {activa && modificada && (
            <div className="vg-cambios">
              <span className="t-sm">Cambiaste algo en «{activa.nombre}».</span>
              <span className="vg-cambios__botones">
                {puedeCambiar(activa) && (
                  <button type="button" className="hk-btn hk-btn--primary hk-btn--sm" disabled={ocupado} onClick={() => void guardarCambios()}>Guardar los cambios</button>
                )}
                <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => abrir(activa)}>Volver a como estaba</button>
              </span>
            </div>
          )}

          <form className="vg-nueva" onSubmit={(ev) => { ev.preventDefault(); void guardarNueva(); }}>
            <div className="vg-titulo">Guardar lo que estás viendo</div>
            <input
              className="vg-nombre" value={nombre} maxLength={NOMBRE_MAXIMO} placeholder="Nombre de la vista" aria-label="Nombre de la vista"
              onChange={(ev) => setNombre(ev.target.value)}
            />
            <div className="segmento vg-para" role="radiogroup" aria-label="Para quién es">
              <button type="button" role="radio" aria-checked={!deEquipo} aria-selected={!deEquipo} onClick={() => setDeEquipo(false)}><User size={13} />Sólo para mí</button>
              <button type="button" role="radio" aria-checked={deEquipo} aria-selected={deEquipo} disabled={!puedeEquipo} onClick={() => setDeEquipo(true)}
                title={puedeEquipo ? "La ve todo el equipo" : vistas.conEquipo ? "Tu tipo de cuenta guarda vistas sólo para vos" : "Todavía no está activado"}>
                <Users size={13} />Para todo el equipo
              </button>
            </div>
            <button type="submit" className="hk-btn hk-btn--secondary hk-btn--sm" disabled={ocupado || !nombre.trim()}>Guardar vista</button>
          </form>
        </div>
      )}
    </div>
  );
}
