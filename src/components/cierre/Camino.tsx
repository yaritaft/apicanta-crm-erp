"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaHora, money } from "@/lib/format";
import { AREAS_DEL_CIERRE, type Cadencia, type Destino, type Herramienta, type PasoCierre } from "@/lib/cierre-mes";
import { HerramientaDelPaso } from "./Herramientas";
import { Cuenta, Nodo, TEXTO_ESTADO } from "./Nodo";

/* ==================================================================
   El camino de pasos, uno abajo del otro (la Bandeja de Blue OS). Cada paso
   dice cómo está y qué falta; el botón de la derecha lo abre en el lugar, con
   lo que falta y la herramienta para resolverlo. Los que pasan fuera de la
   app se tildan (queda quién y cuándo).
   ================================================================== */

/* Cuando un paso abre dos pantallas, cada una dice de qué es. */
const TITULO_HERRAMIENTA: Partial<Record<Herramienta["tipo"], string>> = {
  conciliacion: "Cobros de las pasarelas",
  devoluciones: "Reembolsos de las pasarelas",
  fijos: "Gastos fijos",
  gastos: "Gastos del período",
};

export function Camino({ pasos, cadencia, periodo, ahora, abierto, onAbrir, agrupar, esDueno, marcar, desmarcar }: {
  pasos: PasoCierre[]; cadencia: Cadencia; periodo: string; ahora: number;
  abierto: string | null; onAbrir: (id: string | null) => void;
  /* Con bandas por área (el mes) o en la lista corrida de Aldana (hoy y la semana). */
  agrupar: boolean; esDueno: boolean;
  marcar: (paso: PasoCierre) => void; desmarcar: (paso: PasoCierre) => void;
}) {
  const abrirFicha = useAbrirFicha();
  const abrirDestino = (d: Destino | undefined) => { if (d && "ficha" in d) abrirFicha(d.ficha, "ventas", { venta: d.ficha }); };

  return (
    <ol className="cm-path" aria-label="El camino">
      {pasos.map((p, i) => {
        const nuevaArea = agrupar && (i === 0 || pasos[i - 1].area !== p.area);
        const estaAbierto = abierto === p.id;
        const sinAcceso = p.soloDuenos && !esDueno;
        const manual = p.tipo === "manual";
        const rapido = manual && p.estado === "pendiente";            // se tilda con un clic, sin abrirlo
        return (
          <React.Fragment key={p.id}>
            {nuevaArea && <li className="cm-banda-fila" aria-hidden>{AREAS_DEL_CIERRE.find((a) => a.id === p.area)?.nombre}</li>}
            <li className={`cm-step cm-step--${p.estado}${estaAbierto ? " cm-step--abierto" : ""}${p.siguiente ? " cm-step--sigue" : ""}`}>
              <Nodo estado={p.estado} n={i + 1} />
              <div className="cm-step__tarjeta">
                <button type="button" className="cm-step__cab" aria-expanded={estaAbierto} onClick={() => onAbrir(estaAbierto ? null : p.id)}>
                  <h3 className="cm-step__titulo">
                    {p.titulo}
                    {p.siguiente && <span className="cm-step__sigue">Siguiente</span>}
                    {p.tipo === "manual" && p.estado !== "listo" && <span className="cm-step__tipo">Se tilda</span>}
                    {p.tipo === "revisable" && p.estado !== "listo" && <span className="cm-step__tipo">Se revisa</span>}
                    <span className="sr-only"> ({TEXTO_ESTADO[p.estado].toLowerCase()})</span>
                  </h3>
                  <p className="cm-step__det">{p.detalle}</p>
                  {p.chequeo && <p className="cm-step__hecho">Hecho por {p.chequeo.por ?? "alguien"} · {fechaHora(p.chequeo.en)}</p>}
                  {p.progreso && p.progreso.total > 0 && p.estado !== "listo" && (
                    <div className="cm-pmini">
                      <div className="cm-pbar"><i style={{ width: `${Math.round((p.progreso.hecho / p.progreso.total) * 100)}%` }} /></div>
                      <span>{p.progreso.hecho} de {p.progreso.total}</span>
                    </div>
                  )}
                </button>
                <div className="cm-step__acc">
                  <Cuenta p={p} />
                  {rapido ? (
                    <Button sm variante={p.siguiente ? "primary" : "secondary"} icono={<Check size={15} />} onClick={() => marcar(p)}>Hecho</Button>
                  ) : !sinAcceso && (
                    <Button sm variante={p.siguiente ? "primary" : "secondary"} icono={estaAbierto ? undefined : <ChevronRight size={15} />} onClick={() => onAbrir(estaAbierto ? null : p.id)}>
                      {estaAbierto ? "Cerrar" : p.siguiente ? "Resolver" : "Ver"}
                    </Button>
                  )}
                </div>
              </div>

              {estaAbierto && !sinAcceso && (
                <div className="cm-abierto">
                  {(p.tipo === "manual" || p.tipo === "revisable") && (
                    <div className="cm-caja">
                      <div className="cm-tilde">
                        <span className="cm-tilde__quien">
                          {p.chequeo ? <>Lo hizo <b>{p.chequeo.por ?? "alguien"}</b> el {fechaHora(p.chequeo.en)}.</> : manual ? "Todavía nadie lo hizo." : "Cuando lo hayas revisado, tildalo."}
                        </span>
                        {p.chequeo
                          ? <Button sm variante="ghost" onClick={() => desmarcar(p)}>Deshacer</Button>
                          : <Button sm variante="secondary" icono={<Check size={15} />} onClick={() => marcar(p)}>{manual ? "Marcar como hecho" : "Ya lo revisé"}</Button>}
                      </div>
                    </div>
                  )}

                  {/* Con herramienta, el trabajo se hace en ella: la lista de lo que falta sería lo mismo dos veces. */}
                  {p.items.length > 0 && !p.herramienta ? (
                    <div className="cm-caja">
                      <h4 className="cm-caja__tit">Lo que falta <span className="cm-cuenta">{p.faltan}</span></h4>
                      {p.items.slice(0, 12).map((it) => {
                        const cuerpo = (
                          <>
                            <span className="cm-fila__texto">
                              <span className="cm-fila__titulo">{it.titulo}</span>
                              {it.sub && <span className="cm-fila__sub">{it.sub}</span>}
                            </span>
                            {it.monto !== undefined && <span className="cm-fila__monto">{money(it.monto, it.moneda ?? "USD", 0)}</span>}
                            {it.destino && <ChevronRight size={16} className="cm-ir" aria-hidden />}
                          </>
                        );
                        if (it.destino && "href" in it.destino) return <Link key={it.clave} href={it.destino.href} className="cm-fila">{cuerpo}</Link>;
                        if (it.destino) return <button key={it.clave} type="button" className="cm-fila" onClick={() => abrirDestino(it.destino)}>{cuerpo}</button>;
                        return <div key={it.clave} className="cm-fila">{cuerpo}</div>;
                      })}
                      {p.faltan > Math.min(12, p.items.length) && <p className="cm-mas">Y {p.faltan - Math.min(12, p.items.length)} más: están en la pantalla del paso.</p>}
                    </div>
                  ) : p.tipo === "auto" && !p.herramienta && (p.estado === "listo" || p.estado === "en-curso") ? (
                    <div className="cm-vacio"><Check size={18} aria-hidden />{p.estado === "listo" ? "Nada pendiente en este paso." : "Nada pendiente por ahora: el mes sigue y pueden entrar cosas."}</div>
                  ) : null}

                  {p.herramienta ? (
                    <>
                      {[p.herramienta, ...(p.tambien ?? [])].map((h, k, todas) => (
                        <div key={h.tipo} className="cm-herramienta">
                          <h4 className="cm-herramienta__tit">{todas.length > 1 ? TITULO_HERRAMIENTA[h.tipo] ?? "Para resolverlo" : "Para resolverlo"}</h4>
                          <HerramientaDelPaso h={h} cadencia={cadencia} periodo={periodo} ahora={ahora} />
                        </div>
                      ))}
                    </>
                  ) : p.ir ? (
                    <div className="cm-tilde">
                      <Link href={p.ir.href} className="hk-btn hk-btn--secondary">{p.ir.texto}<ArrowRight size={16} aria-hidden /></Link>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
