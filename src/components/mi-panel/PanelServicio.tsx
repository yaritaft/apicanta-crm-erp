"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHead } from "@/components/shell/PageHead";
import { Badge } from "@/components/ui/ui";
import { FichaClienteCs } from "@/components/cs/FichaClienteCs";
import { useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { filasClientes } from "@/lib/clientes-cs";
import { hoyDelNegocio } from "@/lib/seguimiento";
import { DIAS_DE_GRACIA, panelDeServicio, type ItemServicio, type SeccionServicio, type TonoServicio } from "@/lib/panel-servicio";
import { Tile } from "./Tile";
import { clic, plural, saludoDe } from "./util";
import "./mi-panel.css";
import "./panel-servicio.css";

/* ==================================================================
   «Mi panel» de Customer Success (reunión del 19/10 con Lili, Aldana y Yari).

   Lo que hoy le toca hacer a quien lleva el servicio, en una pantalla y con la
   regla de cada lista a la vista (lib/panel-servicio.ts):
     · arriba, una tarjeta por tema, con cuántos hay: tocar una baja a su lista;
     · abajo, cada lista con lo más urgente primero. Tocar un nombre abre su
       ficha de Customer Success, para dejar anotado lo que se hizo sin salir de acá.
   No guarda nada por su cuenta: lo que se hace se hace en la ficha.
   ================================================================== */

const variante = (t: TonoServicio) => (t === "rojo" ? "danger" : t === "ambar" ? "warning" : "neutral");
const etiqueta = (t: TonoServicio) => (t === "rojo" ? "Urgente" : t === "ambar" ? "Pendiente" : "Para ver");

/* La línea chica de cada tarjeta de arriba: cuántos de esa lista están en rojo. */
const subDe = (s: SeccionServicio): string =>
  s.total === 0 ? "Nada pendiente" : s.rojos > 0 ? `${s.rojos} ${s.rojos === 1 ? "urgente" : "urgentes"}` : "Ninguno urgente";

function Fila({ item, onAbrir }: { item: ItemServicio; onAbrir?: (id: string) => void }) {
  const cuerpo = (
    <>
      <span className="ps-fila__nombre">{item.nombre}</span>
      <span className="ps-fila__detalle" title={item.detalle}>{item.detalle}</span>
      <Badge variante={variante(item.tono)}>{etiqueta(item.tono)}</Badge>
    </>
  );
  return item.alumnoId && onAbrir
    ? <div className="ps-fila ps-fila--clic" {...clic(() => onAbrir(item.alumnoId as string))} aria-label={`Abrir la ficha de ${item.nombre}`}>{cuerpo}</div>
    : <div className="ps-fila">{cuerpo}</div>;
}

function Seccion({ s, onAbrir }: { s: SeccionServicio; onAbrir: (id: string) => void }) {
  return (
    <section className="mp-card mp-card--sin-relleno" id={`ps-${s.id}`} aria-label={s.titulo}>
      <div className="mp-cabeza">
        <h2>{s.titulo}</h2><span className="mp-cuenta">{s.total}</span>
        {s.verTodos && <div className="mp-cabeza__der"><Link href={s.verTodos.href} className="link t-sm">{s.verTodos.texto}</Link></div>}
      </div>
      <p className="ps-regla">{s.regla}</p>
      {s.items.length === 0 ? (
        <p className="mp-vacio mp-lista__vacio">Nada pendiente por acá.</p>
      ) : (
        <div className="mp-lista">
          {s.items.map((i) => <Fila key={i.clave} item={i} onAbrir={onAbrir} />)}
          {s.total > s.items.length && <div className="mp-lista__pie" style={{ padding: "10px 12px 0" }}>Y {s.total - s.items.length} más. Se muestran los más urgentes: el resto está en la lista completa.</div>}
        </div>
      )}
    </section>
  );
}

export function PanelServicio() {
  const e = useEstado();
  const yo = useUsuarioActual();
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  const hoy = hoyDelNegocio(new Date(ahora));
  const panel = useMemo(() => panelDeServicio(e, hoy, new Date(ahora)), [e, hoy, ahora]);
  const [ficha, setFicha] = useState<string | null>(null);
  const fichaDe = useMemo(() => (ficha ? filasClientes(e, hoy).find((f) => f.id === ficha) : undefined), [ficha, e, hoy]);

  const primerNombre = (yo.miembro?.nombre ?? yo.nombre).split(" ")[0];
  const irA = (id: string) => document.getElementById(`ps-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="mp">
      <PageHead titulo="Panel de servicio" sub="Lo que hoy le toca a Customer Success: a quién escribirle, a quién renovar y lo que falta de otros." />
      <header className="mp-cabecera">
        <div className="mp-cabecera__texto">
          <h1 className="mp-saludo">{saludoDe(ahora)}, {primerNombre}</h1>
          <p className="mp-resumen">
            {plural(panel.activos, "alumno en servicio", "alumnos en servicio")}
            {panel.urgentes > 0 ? ` · ${plural(panel.urgentes, "cosa urgente", "cosas urgentes")} en rojo` : " · nada urgente"}
          </p>
        </div>
      </header>

      <div className="mp-tiles" style={{ marginTop: 20 }}>
        {panel.secciones.map((s) => (
          <Tile key={s.id} rot={s.corto} valor={String(s.total)} sub={subDe(s)} verde={s.total === 0} onAbrir={() => irA(s.id)} />
        ))}
      </div>

      <div className="mp-abajo" style={{ marginTop: 20 }}>
        {panel.secciones.map((s) => <Seccion key={s.id} s={s} onAbrir={setFicha} />)}

        <section className="mp-card" aria-label="Revisión de CV y LinkedIn">
          <div className="mp-cap-fila"><span className="mp-cap">CV y LinkedIn (Aldana)</span><span className="mp-cuenta">{panel.cvs.enCurso}</span></div>
          <span className="mp-nota">Revisiones en curso, para saber en qué anda sin preguntarle.</span>
          {panel.cvs.porEstado.length === 0 ? (
            <p className="mp-vacio" style={{ marginTop: 10 }}>No hay revisiones en curso.</p>
          ) : (
            <p className="ps-cv">{panel.cvs.porEstado.map((x) => `${x.estado}: ${x.n}`).join(" · ")}</p>
          )}
          <Link href="/alumnos?seccion=cvs" className="link t-sm">Ver las revisiones</Link>
        </section>

        {panel.desactualizados > 0 && (
          <section className="mp-card" aria-label="Alumnos desactualizados">
            <div className="mp-cap-fila"><span className="mp-cap">Alumnos que figuran activos y ya terminaron</span><span className="mp-cuenta">{panel.desactualizados}</span></div>
            <span className="mp-nota">
              Su contrato terminó hace más de {DIAS_DE_GRACIA} días y siguen como «activos», así que no entran a las listas de arriba. Conviene pasarlos a egresados o a baja
              para que «A contactar hoy» y este panel muestren solo a quien está en servicio.
            </span>
            <Link href="/alumnos?seccion=clientes" className="link t-sm">Revisarlos en Clientes del programa</Link>
          </section>
        )}
      </div>

      {fichaDe && <FichaClienteCs fila={fichaDe} onCerrar={() => setFicha(null)} />}
    </div>
  );
}
