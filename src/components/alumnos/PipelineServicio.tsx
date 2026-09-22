"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Tag } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import { rachasAHoy } from "@/lib/reportes";
import { money, relativo } from "@/lib/format";
import type { Alumno } from "@/lib/types";
import { ESTADO_ALUMNO, MoverA, PuntoEtapa, cuandoEmpezo } from "./comun";

/* ==================================================================
   El pipeline de servicio: una columna por etapa, una tarjeta por alumno.

   Tres formas de mover a alguien, y las tres hacen lo mismo:
   - arrastrar la tarjeta a otra columna (con mouse);
   - el botón "Mover a…" de la tarjeta (teléfono, teclado, lector de
     pantalla), que abre la lista de etapas;
   - con el foco en el nombre, las flechas ← y → (a la etapa de al lado).
   ================================================================== */

export function PipelineServicio({ alumnos, onAbrir }: {
  /* Los que dejan ver los filtros de la pantalla, no todos. */
  alumnos: Alumno[];
  onAbrir: (id: string) => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  /* Al mover, la tarjeta se desmonta de una columna y nace en otra. Sin esto
     el foco se perdía y quien usa teclado tenía que volver a buscarla. */
  const [enfocar, setEnfocar] = useState<string | null>(null);

  const etapas = useMemo(() => etapasDeServicio(e), [e]);
  const rachas = useMemo(() => rachasAHoy(e), [e]);

  const porEtapa = useMemo(() => {
    const m: Record<string, Alumno[]> = {};
    for (const et of etapas) m[et.id] = [];
    for (const a of alumnos) {
      const et = etapaDelAlumno(etapas, a);
      if (et) m[et.id].push(a);
    }
    /* Los que entraron último, arriba: en «Venta nueva» son los que hay que
       atender primero. */
    for (const k of Object.keys(m)) m[k].sort((a, b) => +new Date(b.inicio) - +new Date(a.inicio));
    return m;
  }, [alumnos, etapas]);

  useEffect(() => {
    if (!enfocar) return;
    document.querySelector<HTMLElement>(`[data-alumno="${enfocar}"] .alu-card__nombre`)?.focus();
    setEnfocar(null);
  }, [enfocar, e.alumnos]);

  function mover(a: Alumno, etapaId: string, conFoco = false) {
    const actual = etapaDelAlumno(etapas, a);
    const destino = etapas.find((x) => x.id === etapaId);
    if (!destino || actual?.id === etapaId) return;
    acciones.moverAlumno(a.id, etapaId);
    toast(`${a.nombre} → ${destino.nombre}`);
    if (conFoco) setEnfocar(a.id);
  }

  function correr(a: Alumno, dir: -1 | 1) {
    const i = etapas.findIndex((x) => x.id === etapaDelAlumno(etapas, a)?.id);
    const destino = etapas[i + dir];
    if (destino) mover(a, destino.id, true);
  }

  function soltar(ev: React.DragEvent, etapaId: string) {
    ev.preventDefault();
    const id = arrastrando ?? ev.dataTransfer.getData("text/plain");
    const a = e.alumnos.find((x) => x.id === id);
    if (a) mover(a, etapaId);
    setArrastrando(null);
    setSobre(null);
  }

  return (
    <div className="hk-pipeline alu-pipeline">
      {etapas.map((et) => {
        const items = porEtapa[et.id] ?? [];
        return (
          <section
            key={et.id}
            aria-label={`${et.nombre}: ${items.length} ${items.length === 1 ? "alumno" : "alumnos"}`}
            className={`hk-column${sobre === et.id ? " hk-column--drop" : ""}`}
            onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; if (sobre !== et.id) setSobre(et.id); }}
            onDragLeave={(ev) => {
              /* dragleave salta también al pasar por encima de una tarjeta de
                 la misma columna: sólo cuenta si de verdad se fue. */
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setSobre((s) => (s === et.id ? null : s));
            }}
            onDrop={(ev) => soltar(ev, et.id)}
          >
            <div className="hk-column__head">
              <PuntoEtapa color={et.color} />
              <h2 className="hk-column__title">{et.nombre}</h2>
              <span className="hk-column__count">{items.length}</span>
            </div>

            <div className="hk-column__body">
              {items.length === 0 ? (
                <p className="column-empty">Nadie en esta etapa</p>
              ) : (
                items.map((a) => {
                  const sinReportar = a.estado === "activo" ? rachas.get(a.id) ?? 0 : 0;
                  return (
                    <article
                      key={a.id}
                      data-alumno={a.id}
                      className={`hk-deal alu-card${arrastrando === a.id ? " hk-deal--dragging" : ""}`}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData("text/plain", a.id);
                        ev.dataTransfer.effectAllowed = "move";
                        setArrastrando(a.id);
                      }}
                      onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                      onClick={() => onAbrir(a.id)}
                    >
                      <div className="alu-card__top">
                        <button
                          type="button" className="alu-card__nombre truncate"
                          aria-label={`${a.nombre}, en ${et.nombre}. Enter abre la ficha; las flechas izquierda y derecha lo pasan a la etapa de al lado.`}
                          onClick={(ev) => { ev.stopPropagation(); onAbrir(a.id); }}
                          onKeyDown={(ev) => {
                            if (ev.key === "ArrowRight") { ev.preventDefault(); correr(a, 1); }
                            else if (ev.key === "ArrowLeft") { ev.preventDefault(); correr(a, -1); }
                          }}
                        >
                          {a.nombre}
                        </button>
                        <MoverA
                          etapas={etapas} actual={et.id} nombre={a.nombre}
                          onElegir={(id) => mover(a, id, true)}
                        />
                      </div>
                      <span className="hk-deal__row">
                        <span className="truncate">{[a.plan || "Sin plan", a.cohorte].filter(Boolean).join(" · ")}</span>
                        {a.cuotaMensual > 0 && <span className="hk-deal__amount">{money(a.cuotaMensual, a.moneda)}/mes</span>}
                      </span>
                      <span className="hk-deal__row">
                        <span className="truncate">{cuandoEmpezo(relativo(a.inicio))}</span>
                      </span>
                      {(a.estado !== "activo" || sinReportar >= 2) && (
                        <span className="alu-card__marcas">
                          {a.estado !== "activo" && <Tag>{ESTADO_ALUMNO[a.estado].texto}</Tag>}
                          {sinReportar >= 2 && (
                            <span className={`alu-card__alerta${sinReportar >= 3 ? " alu-card__alerta--mal" : ""}`}>
                              {sinReportar} semanas sin reportar
                            </span>
                          )}
                        </span>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
