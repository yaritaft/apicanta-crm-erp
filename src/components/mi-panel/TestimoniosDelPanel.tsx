"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { Button, Input } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { Pastilla } from "@/components/cs/pastillas";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useEstado } from "@/lib/store";
import { formatoDia } from "@/lib/seguimiento";
import {
  ESTADOS_TESTIMONIO, filasDeTestimonios, listaDeTestimonios, resumenDeTestimonios, type EstadoTestimonio, type FiltroTestimonios,
} from "@/lib/testimonios-panel";

/* ==================================================================
   Todos los testimonios en Mi panel (Lili, 10/11: «un apartado de testimonios donde pueda ver absolutamente todos, tanto los que
   se grabaron como los que no»). La lista «Testimonios» de «Para hoy» sólo trae lo que pide acción; ésta trae todo, con el estado
   de cada uno y filtros para ir a lo que se busca. Mismo dato que Alumnos → Testimonios (lib/testimonios-panel.ts).
   ================================================================== */

const POR_TANDA = 12;

export function TestimoniosDelPanel({ hoy }: { hoy: string }) {
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const [filtro, setFiltro] = useState<FiltroTestimonios>("todos");
  const [q, setQ] = useState("");
  const [cuantos, setCuantos] = useState(POR_TANDA);

  const filas = useMemo(() => filasDeTestimonios(e.testimonios, e.alumnos, hoy), [e.testimonios, e.alumnos, hoy]);
  const resumen = useMemo(() => resumenDeTestimonios(filas), [filas]);
  const lista = useMemo(() => listaDeTestimonios(filas, filtro, q), [filas, filtro, q]);
  const visibles = lista.slice(0, cuantos);
  const elegir = (f: FiltroTestimonios) => { setFiltro((x) => (x === f ? "todos" : f)); setCuantos(POR_TANDA); };
  const grabados = resumen.porEstado["con-link"] + resumen.porEstado["sin-link"];

  return (
    <section className="mp-card ps-card ps-rs ps-tes" aria-label="Todos los testimonios">
      <div className="ps-rs__cab">
        <div>
          <h2 className="ps-tit">
            Testimonios{" "}
            <InfoMetrica
              titulo="Todos los testimonios"
              ayuda="Cada testimonio de la base, se haya grabado o no: con el link del video, a los que les falta el link, los agendados, los que faltan agendar y los que no quisieron. Tocá un estado para filtrar y un nombre para abrir su ficha. Lo que pide acción está también en «Para hoy»."
            />
          </h2>
        </div>
      </div>

      <div className="ps-rs__cuerpo">
        <div className="ps-rs__total">
          <span className="ps-rs__n">{resumen.total}</span>
          <span className="ps-kpi__ctx">
            {resumen.total === 1 ? "testimonio" : "testimonios"} · {grabados} {grabados === 1 ? "grabado" : "grabados"}
          </span>
        </div>
        <span className="ps-rs__fin">
          <Link href="/alumnos?seccion=testimonios" className="ps-tes__tabla" title="La tabla completa, con todas las columnas y filtros tipo Excel">Abrir la tabla completa</Link>
        </span>
      </div>

      <div className="ps-tes__filtros" role="group" aria-label="Filtrar por estado">
        <button type="button" className="ps-rs__chip ps-tes__chip" aria-pressed={filtro === "todos"} onClick={() => { setFiltro("todos"); setCuantos(POR_TANDA); }}>
          Todos <b>{resumen.total}</b>
        </button>
        {ESTADOS_TESTIMONIO.map((x) => (
          <button key={x.id} type="button" className="ps-rs__chip ps-tes__chip" aria-pressed={filtro === x.id} title={x.ayuda} onClick={() => elegir(x.id)}>
            {x.chip} <b>{resumen.porEstado[x.id]}</b>
          </button>
        ))}
        <span className="ps-tes__buscar">
          <Input
            icono={<Search size={14} aria-hidden />} value={q} aria-label="Buscar un testimonio por alumno" placeholder="Buscar alumno"
            onChange={(ev) => { setQ(ev.target.value); setCuantos(POR_TANDA); }}
          />
        </span>
      </div>

      {visibles.length === 0 ? (
        <p className="ps-tes__vacio t-sm t-subtle">
          {resumen.total === 0 ? "Todavía no hay testimonios cargados." : "Ningún testimonio coincide con lo que elegiste."}
        </p>
      ) : (
        <ul className="ps-rs__lista">
          {visibles.map((f) => {
            const est = ESTADOS_TESTIMONIO.find((x) => x.id === f.estado)!;
            const nombre = f.nombre || "Alumno borrado";
            const cuando = cuandoDe(f.estado, f.fecha, hoy);
            return (
              <li key={f.id} className="ps-rs__fila ps-tes__fila">
                {f.nombre
                  ? <button type="button" className="ps-rs__nombre truncate" onClick={() => abrirFicha(f.alumnoId, "servicio", { hoja: "testimonio" })} title={`Abrir el testimonio en la ficha de ${f.nombre}`}>{nombre}</button>
                  : <span className="ps-rs__nombre truncate t-subtle">{nombre}</span>}
                <span className="ps-rs__con truncate">{f.conQuien ? `con ${f.conQuien}` : "—"}</span>
                <span className="ps-rs__cuando ps-num">{cuando}</span>
                <span className="ps-rs__estado ps-tes__estado">
                  {f.link && (
                    <a href={f.link} target="_blank" rel="noreferrer noopener" className="ps-tes__abrir" title="Abrir el video">Video<ExternalLink size={12} aria-hidden /></a>
                  )}
                  <Pastilla texto={est.pastilla} tono={est.tono} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {lista.length > visibles.length && (
        <div className="ps-tes__mas">
          <Button variante="ghost" sm onClick={() => setCuantos((n) => n + POR_TANDA)}>
            Ver {Math.min(POR_TANDA, lista.length - visibles.length)} más <span className="t-subtle">({lista.length - visibles.length} sin mostrar)</span>
          </Button>
        </div>
      )}
    </section>
  );
}

/* Cuándo es cada uno, en palabras: la fecha de la grabación o lo que falta. */
function cuandoDe(estado: EstadoTestimonio, fecha: string | null, hoy: string): string {
  if (estado === "agendado") return fecha ? `agendado para el ${formatoDia(fecha, hoy)}` : "agendado, sin fecha";
  if (estado === "por-agendar") return "sin agendar";
  if (estado === "no-quiere") return "no quiso grabar";
  return fecha ? `grabó el ${formatoDia(fecha, hoy)}` : "grabado";
}
