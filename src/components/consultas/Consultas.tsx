"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, Copy, MessageCircleQuestion, Plus } from "lucide-react";
import { Badge, Button, Empty } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { CopiarLinkPersonal } from "@/components/simulacros/Simulacros";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useParamsURL } from "@/lib/useParamsURL";
import { hoyDelNegocio } from "@/lib/seguimiento";
import { fechaLarga } from "@/lib/format";
import { diaDeClase } from "@/lib/simulacros";
import { enlaceDelAlumno } from "@/lib/links-alumno";
import { enLaClase, juevesDeLaConsulta, NOMBRE_ESTADO_CONSULTA, otroJueves, resumenDeConsultas, type ConsultaClase, type EstadoConsulta } from "@/lib/consultas";
import { CargarConsulta, CerrarClase } from "./CerrarClase";
import { claseSinCargar, useConsultas } from "./consultas-nube";
import "@/components/simulacros/simulacros.css";
import "./consultas.css";

/* ==================================================================
   Programa → Consultas (Lili, 24/10): las consultas de los jueves de los
   alumnos que no pueden ir a la clase, y qué pasó con cada una. Lo cargan
   Yari, Nahuel o Lili, tipo Typeform; queda en la ficha del alumno.
   ================================================================== */

const VARIANTE: Record<EstadoConsulta, "success" | "accent" | "danger" | "neutral"> = { recibida: "accent", respondida: "success", no_respondida: "danger", sin_registro: "neutral" };

/* La clase que se abre de entrada: la última que ya pasó y quedó sin cargar; si no hay, la próxima. null mientras se averigua. */
function useClaseDeEntrada(): string | null {
  const hoy = hoyDelNegocio();
  const [fecha, setFecha] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const proxima = juevesDeLaConsulta(new Date().toISOString());
    void claseSinCargar(hoy).then((f) => { if (vivo) setFecha(f ?? proxima); }).catch(() => { if (vivo) setFecha(proxima); });
    return () => { vivo = false; };
  }, [hoy]);
  return fecha;
}

/** El link general para dejar consultas (el que se manda los jueves en el grupo de novedades): cada uno entra con su código. */
export function CopiarLinkConsultas({ chico }: { chico?: boolean }) {
  const toast = useToast();
  return (
    <Button sm={chico} variante="secondary" icono={<Copy size={14} />}
      onClick={() => { void navigator.clipboard?.writeText(enlaceDelAlumno("consulta", window.location.origin)); toast("Link copiado: pegalo en el grupo de novedades. Cada uno entra con su código, el mismo del reporte."); }}>
      Copiar el link para consultas
    </Button>
  );
}

export function ConsultasPagina() {
  const e = useEstado();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "alumnos");
  const abrirFicha = useAbrirFicha();
  const hoy = hoyDelNegocio();
  const entrada = useClaseDeEntrada();
  const [v, cambiar] = useParamsURL({ fecha: "" });
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(v.fecha) ? v.fecha : entrada ?? "";
  const { lista, cargando, releer } = useConsultas({ fecha });
  const [cerrar, setCerrar] = useState<ConsultaClase[] | null>(null);
  const [nueva, setNueva] = useState(false);
  const deLaClase = lista.filter((c) => enLaClase(c, fecha) === "de-la-clase");
  const pasaron = lista.filter((c) => enLaClase(c, fecha) === "paso");
  const sinCargar = deLaClase.filter((c) => c.estado === "recibida");
  const r = resumenDeConsultas(deLaClase);
  const futura = fecha > hoy;

  if (!fecha) return <p className="t-sm t-subtle">Cargando…</p>;
  return (
    <div className="stack-4">
      <div className="sim-barra">
        <div className="sim-fecha" role="group" aria-label="Qué jueves">
          <button type="button" aria-label="Jueves anterior" onClick={() => cambiar({ fecha: otroJueves(fecha, -1) })}><ChevronLeft size={16} /></button>
          <span><b>Jueves {diaDeClase(fecha, fechaLarga)}</b>{fecha === juevesDeLaConsulta(new Date().toISOString()) && <span className="t-subtle"> · la próxima</span>}</span>
          <button type="button" aria-label="Jueves siguiente" onClick={() => cambiar({ fecha: otroJueves(fecha, 1) })}><ChevronRight size={16} /></button>
        </div>
        <span className="t-sm t-subtle">{cargando ? "Cargando…" : r.texto}</span>
        <span className="spacer" />
        <CopiarLinkConsultas />
        {puede && <Button variante="secondary" icono={<Plus size={16} />} onClick={() => setNueva(true)}>Cargar una consulta</Button>}
        {puede && !futura && sinCargar.length > 0 && (
          <Button variante="primary" icono={<ClipboardCheck size={16} />} onClick={() => setCerrar(sinCargar)}>Cargar cómo fue ({sinCargar.length})</Button>
        )}
      </div>

      {!cargando && deLaClase.length === 0 && pasaron.length === 0 ? (
        <Empty icono={<MessageCircleQuestion size={22} />} titulo={futura ? "Todavía no llegó ninguna consulta" : "No hubo consultas para este jueves"}
          texto="Los alumnos que no pueden venir dejan su consulta con el link y su código, el mismo del reporte (reemplaza al Google Form). Si alguien la mandó por WhatsApp, cargala con «Cargar una consulta»." />
      ) : (
        <div className="sim-lista">
          {[...deLaClase, ...pasaron].map((c) => {
            const alumno = c.alumnoId ? e.alumnos.find((a) => a.id === c.alumnoId) : undefined;
            const paso = enLaClase(c, fecha) === "paso";
            return (
              <article key={c.id} className={`sim-item cq-item${paso ? " cq-item--paso" : c.estado === "recibida" ? " sim-item--inscripto" : ""}`}>
                <div className="sim-item__cab">
                  <div className="sim-item__quien">
                    {alumno
                      ? <button type="button" className="link sim-item__nombre" onClick={() => abrirFicha(alumno.id, "servicio", { hoja: "seguimiento" })}>{alumno.nombre}</button>
                      : <span className="sim-item__nombre">{c.nombre || "Sin nombre"}</span>}
                    <span className="t-sm t-subtle">
                      {c.postergada > 0 && !paso ? `Viene de la clase del ${diaDeClase(c.primeraFecha, fechaLarga)} · ` : ""}
                      {c.origen === "panel" ? `Cargada por ${c.cargadoPor ?? "el equipo"}` : c.origen === "google_form" ? "Del Google Form" : "Por el formulario"}
                    </span>
                  </div>
                  {paso ? <Badge variante="neutral">Pasó al jueves {diaDeClase(c.fecha, fechaLarga)}</Badge> : <Badge variante={VARIANTE[c.estado]}>{NOMBRE_ESTADO_CONSULTA[c.estado]}</Badge>}
                  {puede && !futura && !paso && c.estado !== "recibida" && (
                    <Button sm variante="ghost" icono={<ClipboardCheck size={14} />} onClick={() => setCerrar([c])}>Editar</Button>
                  )}
                </div>
                <p className="cq-texto">{c.consulta}</p>
                {!paso && c.estado !== "recibida" && (c.responsable || c.comentario) && (
                  <p className="sim-item__det">{c.responsable ? <>Clase de <b>{c.responsable}</b></> : null}{c.comentario ? `${c.responsable ? " · " : ""}${c.comentario}` : ""}</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {cerrar && <CerrarClase e={e} consultas={cerrar} fecha={fecha} onCerrar={() => setCerrar(null)} onListo={() => { setCerrar(null); releer(); }} />}
      {nueva && <CargarConsulta e={e} fecha={fecha} onCerrar={() => setNueva(false)} onListo={() => { setNueva(false); releer(); }} />}
    </div>
  );
}

/* La tarjeta del panel de Lili, Yari y Nahuel: la clase que quedó sin cargar o, si no, la próxima con sus consultas. */
export function TarjetaConsultas() {
  const fecha = useClaseDeEntrada();
  const { lista, cargando } = useConsultas({ fecha: fecha ?? undefined });
  if (!fecha || cargando) return null;
  const deLaClase = lista.filter((c) => enLaClase(c, fecha) === "de-la-clase");
  const r = resumenDeConsultas(deLaClase);
  const pasoLaClase = fecha <= hoyDelNegocio();
  const cargar = pasoLaClase && r.sinCargar > 0;
  return (
    <section className="mp-card sim-tarjeta" aria-label="Consultas del jueves">
      <MessageCircleQuestion size={18} aria-hidden className="sim-tarjeta__icono" />
      <div className="sim-tarjeta__txt">
        <span className="t-strong">Consultas del jueves {diaDeClase(fecha, fechaLarga)}</span>
        <span className="t-sm t-subtle">{r.texto}{cargar ? ": cargá qué pasó con cada una" : ""}</span>
      </div>
      <span className="spacer" />
      <CopiarLinkConsultas chico />
      <Link href={`/consultas?fecha=${fecha}`} className={`hk-btn hk-btn--sm ${cargar ? "hk-btn--primary" : "hk-btn--secondary"}`}>
        {cargar ? "Cargar cómo fue" : "Ver las consultas"}
      </Link>
    </section>
  );
}

/* En la ficha (Seguimiento): sus consultas de los jueves y qué pasó con cada una. */
export function ConsultasAlumno({ alumnoId }: { alumnoId: string }) {
  const { acceso } = useAcceso();
  const { lista, cargando } = useConsultas({ alumnoId });
  if (cargando) return null;
  const sinResponder = lista.filter((c) => c.estado === "recibida").length;
  return (
    <div className="sim-ficha">
      <div className="sim-ficha__cab">
        <MessageCircleQuestion size={15} aria-hidden />
        <span className="t-strong">Consultas de los jueves</span>
        <span className={`hs-chip${sinResponder ? " hs-chip--ambar" : lista.length ? " hs-chip--ok" : ""}`}>
          {lista.length === 0 ? "Todavía no dejó ninguna" : `${lista.length} ${lista.length === 1 ? "consulta" : "consultas"}${sinResponder ? ` · ${sinResponder} sin responder` : ""}`}
        </span>
        <span className="spacer" />
        {puedeEditar(acceso, "alumnos") && <CopiarLinkPersonal alumnoId={alumnoId} para="consulta" />}
      </div>
      {lista.slice(0, 8).map((c) => (
        <p key={c.id} className="sim-ficha__fila">
          <span className="t-num">{diaDeClase(c.fecha, fechaLarga)}</span> · {NOMBRE_ESTADO_CONSULTA[c.estado]}
          {c.responsable && c.estado !== "recibida" ? ` · ${c.responsable}` : ""}
          <span className="t-subtle"> — {c.consulta.length > 140 ? `${c.consulta.slice(0, 140)}…` : c.consulta}</span>
        </p>
      ))}
      {lista.length > 8 && <p className="sim-ficha__fila t-subtle">Y {lista.length - 8} más (Programa → Consultas).</p>}
      {lista.length === 0 && <p className="sim-ficha__fila t-subtle">Si no puede venir el jueves, deja su consulta con su link (ya trae su código, el mismo del reporte).</p>}
    </div>
  );
}
