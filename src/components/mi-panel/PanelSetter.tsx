"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/ui";
import { Tile } from "./Tile";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaHora, money, num } from "@/lib/format";
import { sinTildes } from "@/lib/crm";
import { CANCELADA, CON_CIERRE, HECHA, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE } from "@/lib/estados";
import type { AgendaDeSetter, MiPanel as Datos } from "@/lib/mi-panel";
import { clic, pctTxt } from "./util";

/* ==================================================================
   El panel del setter (de Blue OS: «Mi día» y «Resultados»): las agendas
   que le cargaron, cuántas se presentaron y en cuántas terminó habiendo
   venta. Una agenda es suya si entró por su link (utm_campaign=setter_nombre).
   ================================================================== */

function resultadoDe(a: AgendaDeSetter, ahora: number): string {
  if (a.fila) return a.fila.resultado;
  const s = a.sesion;
  if (s.estado === "cancelada") return CANCELADA;
  if (s.estado === "no-show") return NO_SE_PRESENTO;
  if (s.estado === "hecha") return HECHA;
  return new Date(s.inicia).getTime() > ahora ? POR_VENIR : SIN_CARGAR;
}

const variante = (r: string) => r === CON_CIERRE ? "success" : r === NO_SE_PRESENTO ? "danger" : r === SIN_CARGAR ? "warning" : r === POR_VENIR ? "info" : "neutral";

export function PanelSetter({ datos, rangoTxt, ahora }: { datos: Datos; rangoTxt: string; ahora: number }) {
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useState("");
  const filas = useMemo(() => datos.agendasDeSetter.map((a) => ({ a, r: resultadoDe(a, ahora) })), [datos.agendasDeSetter, ahora]);
  const validas = filas.filter((x) => x.r !== CANCELADA && x.r !== REPROGRAMO);
  const porVenir = validas.filter((x) => x.r === POR_VENIR).length;
  const noShows = validas.filter((x) => x.r === NO_SE_PRESENTO).length;
  const seSentaron = validas.filter((x) => [CON_CIERRE, SIN_CIERRE, HECHA].includes(x.r)).length;
  const compraron = validas.filter((x) => x.a.venta || x.r === CON_CIERRE).length;
  const pasaron = validas.length - porVenir;
  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    return t ? filas.filter((x) => sinTildes(x.a.sesion.invitado).includes(t)) : filas;
  }, [filas, q]);

  return (
    <div className="mp">
      <section aria-labelledby="mp-set">
        <div className="mp-seccion"><h2 id="mp-set">Cómo te va</h2><span>{rangoTxt}</span></div>
        <div className="mp-tiles">
          <Tile rot="Agendas a tu nombre" valor={num(validas.length)} sub="las que entraron por tu link" />
          <Tile rot="Por venir" valor={num(porVenir)} sub="todavía no pasaron" />
          <Tile rot="Se presentaron" valor={num(seSentaron)} sub={`${pctTxt(pasaron > 0 ? Math.round((seSentaron / pasaron) * 1000) / 10 : null)} de las que pasaron${noShows ? ` · ${noShows} no vinieron` : ""}`} />
          <Tile rot="Terminaron comprando" valor={num(compraron)} sub={datos.ventasDeSetter ? `${num(datos.ventasDeSetter)} ventas con vos de setter` : "ventas con vos de setter"} />
          {datos.comisionSetter > 0 && <Tile rot="Tu comisión" valor={money(datos.comisionSetter, "USD", 2)} sub="sobre las ventas donde figurás como setter" verde />}
        </div>
      </section>
      <section className="mp-card mp-card--sin-relleno" aria-label="Mis agendas">
        <div className="mp-cabeza">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ display: "inline" }}>Mis agendas</h2> <span className="mp-cuenta">{validas.length}</span>
            <span className="mp-nota" style={{ marginTop: 4 }}>Si falta alguna, avisale al closer que la tomó para que te ponga como setter al cargar la venta.</span>
          </div>
          <div className="mp-cabeza__der">
            <input className="mp-buscar" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar nombre…" aria-label="Buscar una agenda por nombre" />
            <Link href="/agenda" className="link t-sm">Ver la agenda</Link>
          </div>
        </div>
        {visibles.length === 0 ? (
          <p className="mp-vacio mp-lista__vacio">
            {filas.length === 0 ? "Todavía no hay agendas a tu nombre en este rango. Entran solas cuando alguien agenda con tu link (utm_campaign=setter_tunombre)." : "Ninguna agenda coincide con la búsqueda."}
          </p>
        ) : (
          <div className="mp-lista">
            {visibles.slice(0, 60).map(({ a, r }) => {
              const id = a.sesion.contactoId ?? a.sesion.leadId;
              return (
                <div key={a.sesion.id} className={`mp-lista__fila${id ? " mp-lista__fila--clic" : ""}${r === CANCELADA ? " mp-lista__fila--tachada" : ""}`} style={{ gridTemplateColumns: "128px minmax(0, 1fr) 190px 170px" }} {...(id ? clic(() => abrirFicha(id, "llamadas")) : {})}>
                  <span className="mp-lista__hora">{fechaHora(a.sesion.inicia)}</span>
                  <span className="mp-lista__nombre">{a.sesion.invitado}</span>
                  <span className="t-sm t-subtle" style={{ whiteSpace: "nowrap" }}>{a.sesion.anfitrion ? `con ${a.sesion.anfitrion}` : "sin closer"}</span>
                  <Badge variante={a.venta ? "success" : variante(r)}>{a.venta ? "Compró" : a.fila?.estadoLlamada || a.fila?.aviso || r}</Badge>
                </div>
              );
            })}
          </div>
        )}
        {visibles.length > 60 && <div className="mp-lista__pie">Y {visibles.length - 60} más. Se muestran las 60 más recientes: afiná con la búsqueda o el rango.</div>}
      </section>
    </div>
  );
}
