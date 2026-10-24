"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, Copy, Mic, Plus } from "lucide-react";
import { Badge, Button, Empty } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { cabeceras } from "@/components/webinars/useYoutube";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useParamsURL } from "@/lib/useParamsURL";
import { hoyDelNegocio } from "@/lib/seguimiento";
import { fechaLarga } from "@/lib/format";
import {
  claseDeEntrada, diaDeClase, NOMBRE_ESTADO, otroMartes, resumenDeClase, resumenDeSimulacros, type EstadoSimulacro, type Simulacro,
} from "@/lib/simulacros";
import { CerrarSimulacro } from "./CerrarSimulacro";
import { useSimulacros } from "./simulacros-nube";
import "./simulacros.css";

/* ==================================================================
   Programa → Simulacros (Lili, 23/10): la clase de cada martes con los
   alumnos que se anotaron (/simulacro) y cómo fue cada uno. Lo cargan
   Yari, Nahuel o Lili, paso a paso; queda en la ficha del alumno.
   ================================================================== */

const VARIANTE: Record<EstadoSimulacro, "success" | "accent" | "danger" | "neutral"> = {
  inscripto: "accent", hecho: "success", no_se_presento: "danger", no_se_preparo: "danger", otro: "neutral",
};

/** El link general para anotarse (el que se manda los martes en el grupo de novedades): cada uno entra con su código. */
export const linkDeInscripcion = () => (typeof window !== "undefined" ? `${window.location.origin}/simulacro` : "/simulacro");

export function CopiarLinkInscripcion({ chico }: { chico?: boolean }) {
  const toast = useToast();
  return (
    <Button sm={chico} variante="secondary" icono={<Copy size={14} />}
      onClick={() => { void navigator.clipboard?.writeText(linkDeInscripcion()); toast("Link copiado: pegalo en el grupo de novedades. Cada uno entra con su código, el mismo del reporte."); }}>
      Copiar el link para anotarse
    </Button>
  );
}

/* El link personal de un alumno (ya trae su código: entra sin escribir nada), en un mensaje listo para su WhatsApp. Sirve para
   el simulacro y para la consulta de los jueves (lib/links-alumno.ts). */
export function CopiarLinkPersonal({ alumnoId, para = "simulacro" }: { alumnoId: string; para?: "simulacro" | "consulta" }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const copiar = async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/reportes/enlace", {
        method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" },
        body: JSON.stringify({ alumnoId, para }),
      });
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string; error?: string };
      if (!r.ok || !j.mensaje) { toast(j.error ?? "No se pudo armar su link.", "err"); return; }
      const ok = await copiarTexto(j.mensaje);
      toast(ok ? "Copiado: pegalo en su WhatsApp. El link ya trae su código." : "No se pudo copiar.", ok ? "ok" : "err");
    } catch {
      toast("No se pudo armar su link. Probá de nuevo.", "err");
    } finally { setOcupado(false); }
  };
  return (
    <Button sm variante="ghost" icono={<Copy size={14} />} cargando={ocupado} onClick={() => void copiar()}
      title={`Su link para ${para === "consulta" ? "dejar consultas para los jueves" : "anotarse a los simulacros"}, con su código (el mismo del reporte)`}>Copiar su link</Button>
  );
}

export function SimulacrosPagina() {
  const e = useEstado();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "alumnos");
  const abrirFicha = useAbrirFicha();
  const hoy = hoyDelNegocio();
  const [v, cambiar] = useParamsURL({ fecha: "" });
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(v.fecha) ? v.fecha : claseDeEntrada(hoy);
  const { lista, cargando, releer } = useSimulacros({ fecha });
  const [cargar, setCargar] = useState<{ s: Simulacro | null } | null>(null);
  const r = resumenDeClase(lista);
  const futuro = fecha > hoy;

  return (
    <div className="stack-4">
      <div className="sim-barra">
        <div className="sim-fecha" role="group" aria-label="Qué martes">
          <button type="button" aria-label="Martes anterior" onClick={() => cambiar({ fecha: otroMartes(fecha, -1) })}><ChevronLeft size={16} /></button>
          <span><b>Martes {diaDeClase(fecha, fechaLarga)}</b>{fecha === claseDeEntrada(hoy) && <span className="t-subtle"> · esta semana</span>}</span>
          <button type="button" aria-label="Martes siguiente" onClick={() => cambiar({ fecha: otroMartes(fecha, 1) })}><ChevronRight size={16} /></button>
        </div>
        <span className="t-sm t-subtle">{cargando ? "Cargando…" : r.texto}</span>
        <span className="spacer" />
        <CopiarLinkInscripcion />
        {puede && !futuro && <Button variante="primary" icono={<Plus size={16} />} onClick={() => setCargar({ s: null })}>Cargar otro alumno</Button>}
      </div>

      {!cargando && lista.length === 0 ? (
        <Empty icono={<Mic size={22} />} titulo={futuro ? "Todavía no se anotó nadie" : "Nadie se anotó para este martes"}
          texto="Los alumnos se anotan con el link y su código, el mismo del reporte (reemplaza al Google Form). Si se le tomó a alguien que no se anotó, cargalo con «Cargar otro alumno»." />
      ) : (
        <div className="sim-lista">
          {lista.map((s) => {
            const alumno = s.alumnoId ? e.alumnos.find((a) => a.id === s.alumnoId) : undefined;
            return (
              <article key={s.id} className={`sim-item sim-item--${s.estado}`}>
                <div className="sim-item__cab">
                  <div className="sim-item__quien">
                    {alumno
                      ? <button type="button" className="link sim-item__nombre" onClick={() => abrirFicha(alumno.id, "servicio", { hoja: "seguimiento" })}>{alumno.nombre}</button>
                      : <span className="sim-item__nombre">{s.nombre}</span>}
                    <span className="t-sm t-subtle">
                      {[s.telefono, s.stack, s.tipoPedido && `pidió ${s.tipoPedido}`].filter(Boolean).join(" · ") || "Cargado desde el panel"}
                      {!alumno && s.estado !== "inscripto" ? "" : !alumno ? " · sin atar a un alumno" : ""}
                    </span>
                  </div>
                  <Badge variante={VARIANTE[s.estado]}>{NOMBRE_ESTADO[s.estado]}</Badge>
                  {puede && !futuro && (
                    <Button sm variante={s.estado === "inscripto" ? "primary" : "ghost"} icono={<ClipboardCheck size={14} />} onClick={() => setCargar({ s })}>
                      {s.estado === "inscripto" ? "Cargar cómo fue" : "Editar"}
                    </Button>
                  )}
                </div>
                {s.estado === "hecho" && (
                  <p className="sim-item__det">
                    <b>{s.tipoTomado}</b>{s.tecnologias ? ` · ${s.tecnologias}` : ""}{s.responsable ? ` · la tomó ${s.responsable}` : ""}
                    {s.comentario && <span className="sim-item__com">{s.comentario}</span>}
                  </p>
                )}
                {s.estado === "otro" && s.motivo && <p className="sim-item__det">{s.motivo}</p>}
              </article>
            );
          })}
        </div>
      )}

      {cargar && (
        <CerrarSimulacro e={e} simulacro={cargar.s} fecha={fecha} onCerrar={() => setCargar(null)} onListo={() => { setCargar(null); releer(); }} />
      )}
    </div>
  );
}

/* La tarjeta del panel de Lili, Yari y Nahuel: la clase de esta semana y lo que falta cargar. */
export function TarjetaSimulacro() {
  const hoy = hoyDelNegocio();
  const fecha = claseDeEntrada(hoy);
  const { lista, cargando } = useSimulacros({ fecha });
  if (cargando) return null;
  const r = resumenDeClase(lista);
  const pasoLaClase = fecha <= hoy;
  return (
    <section className="mp-card sim-tarjeta" aria-label="Simulacro del martes">
      <Mic size={18} aria-hidden className="sim-tarjeta__icono" />
      <div className="sim-tarjeta__txt">
        <span className="t-strong">Simulacro del martes {diaDeClase(fecha, fechaLarga)}</span>
        <span className="t-sm t-subtle">{r.texto}{pasoLaClase && r.sinCargar ? ": cargá cómo fue" : ""}</span>
      </div>
      <span className="spacer" />
      <CopiarLinkInscripcion chico />
      <Link href={`/simulacros?fecha=${fecha}`} className={`hk-btn hk-btn--sm ${pasoLaClase && r.sinCargar ? "hk-btn--primary" : "hk-btn--secondary"}`}>
        {pasoLaClase && r.sinCargar ? "Cargar cómo fue" : "Ver la clase"}
      </Link>
    </section>
  );
}

/* En la ficha (Seguimiento): sus simulacros y si cumple la condición del contrato (al menos uno hecho). */
export function SimulacrosAlumno({ alumnoId }: { alumnoId: string }) {
  const { acceso } = useAcceso();
  const { lista, cargando } = useSimulacros({ alumnoId });
  if (cargando) return null;
  const r = resumenDeSimulacros(lista);
  return (
    <div className="sim-ficha">
      <div className="sim-ficha__cab">
        <Mic size={15} aria-hidden />
        <span className="t-strong">Simulacros de entrevista</span>
        <span className={`hs-chip ${r.cumple ? "hs-chip--ok" : "hs-chip--ambar"}`} title="Hacer al menos un simulacro es condición del contrato">
          {r.cumple ? `${r.texto} ✓` : r.texto}
        </span>
        <span className="spacer" />
        {puedeEditar(acceso, "alumnos") && <CopiarLinkPersonal alumnoId={alumnoId} />}
      </div>
      {lista.map((s) => (
        <p key={s.id} className="sim-ficha__fila">
          <span className="t-num">{diaDeClase(s.fecha, fechaLarga)}</span> · {NOMBRE_ESTADO[s.estado]}
          {s.estado === "hecho" && ` · ${s.tipoTomado ?? ""}${s.tecnologias ? ` (${s.tecnologias})` : ""}${s.responsable ? ` · ${s.responsable}` : ""}`}
          {s.comentario && <span className="t-subtle"> — {s.comentario}</span>}
          {s.estado === "otro" && s.motivo && <span className="t-subtle"> — {s.motivo}</span>}
        </p>
      ))}
      {lista.length === 0 && <p className="sim-ficha__fila t-subtle">Se anota con su link (ya trae su código, el mismo del reporte) o con el de los martes.</p>}
    </div>
  );
}
