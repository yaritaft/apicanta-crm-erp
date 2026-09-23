"use client";

import React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { tonoRoas } from "@/components/webinars/estado";
import { money, num, pct } from "@/lib/format";
import { SECCIONES, type Corte, type DefKpi, type FormatoKpi, type SeccionKpi } from "@/lib/kpis";
import type { Moneda } from "@/lib/types";

/* ==================================================================
   La tabla maestra: métricas en filas, cortes en columnas.

   Usa la grilla de la planilla de Webinars (primera columna fija,
   encabezado pegado arriba) para que se lea igual que la hoja que Yari
   ya conoce. Las filas se agrupan por área y, adentro, por tema.
   ================================================================== */

export interface FilaKpi {
  def: DefKpi;
  valores: (number | null)[];
  /* Lo mismo en el corte con el que se compara cada columna. */
  previos: (number | null)[];
}

export function TablaKpis({
  filas, cortes, comparar, moneda, conSecciones, onAbrir, porDia,
}: {
  filas: FilaKpi[];
  cortes: Corte[];
  /* Debajo de cada número, la variación contra su corte previo. */
  comparar: boolean;
  moneda: Moneda;
  /* Con todas las áreas a la vista, cada una lleva su encabezado. */
  conSecciones: boolean;
  onAbrir?: (def: DefKpi, corte: Corte) => void;
  /* Muchas columnas angostas: una por día. */
  porDia?: boolean;
}) {
  const columnas = cortes.length + 1;

  /* Área → tema → filas, en el orden en que llegan. El tema abre un
     encabezado cada vez que cambia: si alguien mueve una métrica a otro
     lugar, lleva su tema con ella en vez de quedar bajo uno ajeno. */
  const bloques: { seccion: SeccionKpi; grupos: { grupo: string; filas: FilaKpi[] }[] }[] = [];
  for (const f of filas) {
    let b = bloques[bloques.length - 1];
    if (!b || b.seccion !== f.def.seccion) { b = { seccion: f.def.seccion, grupos: [] }; bloques.push(b); }
    let gr = b.grupos[b.grupos.length - 1];
    if (!gr || gr.grupo !== f.def.grupo) { gr = { grupo: f.def.grupo, filas: [] }; b.grupos.push(gr); }
    gr.filas.push(f);
  }

  return (
    <div className="planilla-caja kpis-caja">
      <table className={`planilla kpis${comparar ? " kpis--comparar" : ""}${porDia ? " kpis--dias" : ""}`} aria-label="Métricas del negocio">
        <thead>
          <tr>
            <th scope="col" className="planilla__fija">Métrica</th>
            {cortes.map((c) => (
              <th key={c.clave} scope="col" className={`planilla__num${c.destacado ? " kpis__col--destacada" : ""}${c.total ? " kpis__col--total" : ""}`}>
                <span className="kpis__th">
                  <span className="kpis__th-titulo" title={c.titulo}>{c.titulo}</span>
                  {c.sub && <span className="kpis__th-sub">{c.sub}</span>}
                  {comparar && c.previo && (
                    <span className="kpis__th-sub kpis__th-vs" title={`Se compara con ${c.previo.titulo}${c.previo.sub ? ` (${c.previo.sub})` : ""}`}>
                      vs. {c.previo.sub ?? c.previo.titulo}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloques.map((b) => {
            const s = SECCIONES.find((x) => x.id === b.seccion)!;
            return (
              <React.Fragment key={`${b.seccion}-${bloques.indexOf(b)}`}>
                {conSecciones && (
                  <tr className="kpis__seccion">
                    <th scope="colgroup" colSpan={columnas}>
                      <span className="kpis__seccion-texto">
                        <span className="kpis__seccion-titulo">{s.titulo}</span>
                        <span className="kpis__etapa">{s.etapa}</span>
                        <span className="kpis__seccion-sub">{s.sub}</span>
                      </span>
                    </th>
                  </tr>
                )}
                {b.grupos.map((gr, gi) => (
                  <React.Fragment key={`${gr.grupo}-${gi}`}>
                    <tr className="kpis__grupo">
                      <th scope="colgroup" colSpan={columnas}><span className="kpis__grupo-texto">{gr.grupo}</span></th>
                    </tr>
                    {gr.filas.map((f) => (
                      <tr key={f.def.id}>
                        <th scope="row" className="planilla__fija">
                          <Etiqueta def={f.def} />
                        </th>
                        {f.valores.map((v, i) => {
                          const corte = cortes[i];
                          const abrible = onAbrir && f.def.desglose && v !== null && !corte.filtro;
                          const valor = <Valor v={v} formato={f.def.formato} moneda={moneda} />;
                          const contenido = comparar
                            ? (
                              <span className="kpis__par">
                                {valor}
                                <Delta def={f.def} actual={v} previo={f.previos[i]} corte={corte} moneda={moneda} />
                              </span>
                            )
                            : valor;
                          return (
                            <td key={corte.clave} className={`planilla__num${corte.destacado ? " kpis__col--destacada" : ""}${corte.total ? " kpis__col--total" : ""}`}>
                              {abrible ? (
                                <button
                                  type="button" className="planilla__ro kpis__abrir"
                                  onClick={() => onAbrir!(f.def, corte)}
                                  aria-label={`${f.def.etiqueta}, ${corte.titulo}: ver qué lo forma`}
                                  title="Ver qué forma este número"
                                >
                                  {contenido}
                                </button>
                              ) : (
                                <span className="planilla__ro">{contenido}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Etiqueta({ def }: { def: DefKpi }) {
  const texto = (
    <>
      <span className="truncate">{def.etiqueta}</span>
      {def.foto && <span className="kpis__hoy" title="Es una foto de hoy, no depende del período">hoy</span>}
    </>
  );
  return def.href
    ? <Link href={def.href} className="planilla__enlace kpis__etiqueta" title={def.ayuda}>{texto}</Link>
    : <span className="planilla__enlace kpis__etiqueta" title={def.ayuda}>{texto}</span>;
}

export function formatear(v: number, formato: FormatoKpi, moneda: Moneda): string {
  switch (formato) {
    /* Los costos unitarios chicos (CPC, costo por formulario) con
       centavos; el resto, redondo. */
    case "moneda":
    case "resultado": return money(v, moneda, v !== 0 && Math.abs(v) < 10 ? 2 : 0);
    case "cantidad": return num(v);
    case "pct": return pct(v, 1);
    case "x": return `${num(v, 2)}x`;
    case "dias": return `${num(v)} ${v === 1 ? "día" : "días"}`;
  }
}

function Valor({ v, formato, moneda }: { v: number | null; formato: FormatoKpi; moneda: Moneda }) {
  if (v === null) return <span className="t-subtle" aria-label="sin dato">—</span>;
  const texto = formatear(v, formato, moneda);
  /* Los mismos colores que la planilla de Webinars: el ROAS con el
     semáforo de Yari, el profit en verde o rojo. */
  if (formato === "x" && v > 0) return <span style={{ color: tonoRoas(v), fontWeight: 600 }}>{texto}</span>;
  if (formato === "resultado") return <span style={{ color: v >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{texto}</span>;
  return <>{texto}</>;
}

/* Para las tasas, la diferencia en puntos: pasar de 10% a 12% es +2 pp,
   no +20%. Para el resto, la variación porcentual. */
export function variacionKpi(def: DefKpi, actual: number | null, previo: number | null): { texto: string; tono: "up" | "down" | "neutral" } | null {
  if (actual === null || previo === null) return null;
  let cambio: number, texto: string;
  if (def.formato === "pct") {
    cambio = actual - previo;
    if (Math.abs(cambio) < 0.05) return { texto: "=", tono: "neutral" };
    texto = `${cambio > 0 ? "+" : "−"}${num(Math.abs(cambio), 1)} pp`;
  } else {
    if (previo === 0) return actual === 0 ? { texto: "=", tono: "neutral" } : null;
    cambio = ((actual - previo) / Math.abs(previo)) * 100;
    if (Math.abs(cambio) < 0.05) return { texto: "=", tono: "neutral" };
    texto = `${cambio > 0 ? "+" : "−"}${num(Math.abs(cambio), Math.abs(cambio) < 10 ? 1 : 0)}%`;
  }
  const bueno = def.mejor === "sube" ? cambio > 0 : def.mejor === "baja" ? cambio < 0 : null;
  return { texto, tono: bueno === null ? "neutral" : bueno ? "up" : "down" };
}

/* La variación contra el corte previo: verde si mejoró, rojo si empeoró,
   gris si la métrica no tiene un "mejor" (una inversión no es buena ni
   mala por subir). Sin dato previo no se muestra nada. */
function Delta({ def, actual, previo, corte, moneda }: {
  def: DefKpi; actual: number | null; previo: number | null; corte: Corte; moneda: Moneda;
}) {
  const v = variacionKpi(def, actual, previo);
  if (!v || previo === null) return null;
  const Flecha = v.texto.startsWith("+") ? ArrowUpRight : v.texto.startsWith("−") ? ArrowDownRight : null;
  const antes = corte.previo ? `${corte.previo.sub ?? corte.previo.titulo}` : "el período anterior";
  return (
    <span
      className={`kpis__delta${v.tono !== "neutral" ? ` kpis__delta--${v.tono}` : ""}`}
      title={`Antes: ${formatear(previo, def.formato, moneda)} (${antes})`}
    >
      {Flecha && <Flecha size={12} aria-hidden />}
      {v.texto}
    </span>
  );
}
