"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Correo, Telefono } from "@/components/ui/Telefono";
import { FichaClienteCs } from "@/components/cs/FichaClienteCs";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useParamsURL } from "@/lib/useParamsURL";
import { nivelDeRuta } from "@/lib/permisos";
import { filasClientes } from "@/lib/clientes-cs";
import { sinTildes } from "@/lib/crm";
import { hoyDelNegocio } from "@/lib/seguimiento";
import { panelDeServicio, type ItemServicio } from "@/lib/panel-servicio";
import type { MiembroEquipo } from "@/lib/types";
import { plural, saludoDe } from "./util";
import "./mi-panel.css";
import "./panel-servicio.css";

/* ==================================================================
   El «Mi panel» de Customer Success (Lili), reunión del 19/10 y rehecho el 20/10.

   Una sola pantalla, minimalista y con la data a mano:
     · arriba, las listas como solapas con su cuenta;
     · una lista a la vez, con su regla en una línea, un buscador y cada alumno en dos renglones:
       quién es y cuándo, y lo que pasa con él con su teléfono y mail para copiar de un toque;
     · «Lo contacté» ahí mismo en la lista de a quién contactar;
     · abajo, lo que no es de hoy (CV de Aldana, los que ya cerraron y los que hay que revisar).
   Tocar un alumno abre su ficha de Customer Success. Un dueño lo mira «como» Lili y es sólo para mirar.
   Las reglas y las cuentas están en lib/panel-servicio.ts.
   ================================================================== */

const POR_PAGINA = 25;

function Fila({ item, contactar, onAbrir, onContacte }: {
  item: ItemServicio; contactar: boolean; onAbrir: (id: string) => void; onContacte: (id: string) => void;
}) {
  const id = item.alumnoId;
  const cuerpo = (
    <>
      <span className={`ps-punto ps-punto--${item.tono}`} aria-hidden />
      <span className="ps-nombre">
        <span className="ps-nombre__texto">{item.nombre}</span>
        {item.programa && <span className="ps-nombre__sub">{item.programa}</span>}
      </span>
      <span className={`ps-cuando ps-cuando--${item.tono}`}>{item.cuando}</span>
      <span className="ps-detalle" title={item.detalle}>{item.detalle}</span>
      <span className="ps-acciones">
        <Telefono valor={item.telefono} pais={item.pais} compacto />
        <span className="ps-acciones__mail"><Correo valor={item.email} compacto /></span>
        {contactar && id && (
          <Button sm variante="ghost" icono={<Check size={14} />} onClick={(ev) => { ev.stopPropagation(); onContacte(id); }} title="Lo contacté hoy: el próximo toca según su cadencia">
            Lo contacté
          </Button>
        )}
      </span>
    </>
  );
  if (!id) return <div className="ps-fila">{cuerpo}</div>;
  return (
    <div
      className="ps-fila ps-fila--clic" role="button" tabIndex={0} aria-label={`Abrir la ficha de ${item.nombre}`}
      onClick={() => onAbrir(id)}
      onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onAbrir(id); } }}
    >
      {cuerpo}
    </div>
  );
}

export function PanelServicio({ miembro, viendoOtro }: { miembro: MiembroEquipo; viendoOtro: boolean }) {
  const e = useEstado();
  const { acceso } = useAcceso();
  const gestos = useGestos();
  const [v, cambiar] = useParamsURL({ lista: "" });
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  const hoy = hoyDelNegocio(new Date(ahora));
  const panel = useMemo(() => panelDeServicio(e, hoy, new Date(ahora)), [e, hoy, ahora]);

  /* La lista que se mira: la del link o, sin elegir, la primera que tiene algo urgente (y si no, la primera con alguien). */
  const lista = panel.secciones.find((s) => s.id === v.lista)
    ?? panel.secciones.find((s) => s.rojos > 0) ?? panel.secciones.find((s) => s.total > 0) ?? panel.secciones[0];

  const [q, setQ] = useState("");
  const clave = `${lista.id}|${q}`;
  const [pagina, setPagina] = useState({ clave: "", n: POR_PAGINA });
  const mostrar = pagina.clave === clave ? pagina.n : POR_PAGINA;

  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    if (!t) return lista.items;
    return lista.items.filter((i) => sinTildes([i.nombre, i.programa, i.detalle, i.telefono, i.email].filter(Boolean).join(" ")).includes(t));
  }, [lista, q]);

  const [ficha, setFicha] = useState<string | null>(null);
  const fichaDe = useMemo(() => (ficha ? filasClientes(e, hoy).find((f) => f.id === ficha) : undefined), [ficha, e, hoy]);

  const puedeEscribir = !viendoOtro && nivelDeRuta(acceso, "/alumnos") >= 2;
  const contacte = (id: string) => {
    const alumno = e.alumnos.find((a) => a.id === id);
    if (alumno) gestos.contacte({ id, alumno });
  };
  const primerNombre = miembro.nombre.split(" ")[0];
  const cvs = panel.cvs;

  return (
    <div className="ps">
      <header className="mp-cabecera">
        <div className="mp-cabecera__texto">
          <h1 className="mp-saludo">{viendoOtro ? `Panel de ${miembro.nombre}` : `${saludoDe(ahora)}, ${primerNombre}`}</h1>
          <p className="mp-resumen">{plural(panel.activos, "alumno en servicio", "alumnos en servicio")}</p>
        </div>
      </header>

      <div className="ps-tabs" role="tablist" aria-label="Qué mirar">
        {panel.secciones.map((s) => (
          <button
            key={s.id} type="button" role="tab" id={`ps-tab-${s.id}`} aria-selected={s.id === lista.id} aria-controls="ps-lista"
            className="ps-tab" onClick={() => { setQ(""); cambiar({ lista: s.id }); }}
            title={s.rojos > 0 ? `${s.titulo}: ${s.total} (${s.rojos} urgentes)` : `${s.titulo}: ${s.total}`}
          >
            <span>{s.corto}</span>
            <span className="ps-tab__n">{s.total}</span>
          </button>
        ))}
      </div>

      <section className="mp-card mp-card--sin-relleno" id="ps-lista" role="tabpanel" aria-labelledby={`ps-tab-${lista.id}`}>
        <div className="ps-barra">
          <p className="ps-regla">{lista.regla}</p>
          {lista.total > 6 && (
            <input
              className="mp-buscar" value={q} onChange={(ev) => setQ(ev.target.value)}
              placeholder="Buscar nombre, mail o teléfono…" aria-label={`Buscar en ${lista.titulo}`}
            />
          )}
          {lista.verTodos && <Link href={lista.verTodos.href} className="link t-sm">{lista.verTodos.texto}</Link>}
        </div>

        {visibles.length === 0 ? (
          <p className="mp-vacio mp-lista__vacio">{lista.total === 0 ? lista.vacio : "Nadie coincide con la búsqueda."}</p>
        ) : (
          <div className="ps-filas">
            {visibles.slice(0, mostrar).map((i) => (
              <Fila key={i.clave} item={i} contactar={puedeEscribir && lista.id === "contactar"} onAbrir={setFicha} onContacte={contacte} />
            ))}
          </div>
        )}

        {visibles.length > POR_PAGINA && (
          <div className="ps-mas">
            <span>Mostrando {Math.min(mostrar, visibles.length)} de {visibles.length}</span>
            {mostrar < visibles.length && (
              <Button sm variante="ghost" onClick={() => setPagina({ clave, n: mostrar + POR_PAGINA })}>Ver {Math.min(POR_PAGINA, visibles.length - mostrar)} más</Button>
            )}
          </div>
        )}
      </section>

      <div className="ps-pie">
        <Link href="/alumnos?seccion=cvs" className="ps-dato" title={cvs.porEstado.map((x) => `${x.estado}: ${x.n}`).join(" · ") || "No hay revisiones en curso"}>
          <b>{cvs.enCurso}</b> CV y LinkedIn en curso (Aldana)
        </Link>
        {panel.enOutboarding > 0 && (
          <Link href="/alumnos?seccion=clientes" className="ps-dato" title="Su Follow Up dice outboarding o caso de éxito: no entran a las listas. Su estado de alumno no se tocó.">
            <b>{panel.enOutboarding}</b> ya cerraron el programa
          </Link>
        )}
        {panel.desactualizados > 0 && (
          <Link href="/alumnos?seccion=clientes" className="ps-dato" title="Figuran activos, su contrato terminó hace más de 45 días y su Follow Up no dice outboarding: no entran a las listas. Actualizá su Follow Up, su egreso o su estado.">
            <b>{panel.desactualizados}</b> para revisar: contrato vencido y siguen activos
          </Link>
        )}
      </div>

      {fichaDe && <FichaClienteCs fila={fichaDe} onCerrar={() => setFicha(null)} />}
    </div>
  );
}
