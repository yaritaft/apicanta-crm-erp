"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock, Check, ChevronRight, FileSignature, FileWarning, PhoneCall, Repeat2, UserPlus, Video, X,
} from "lucide-react";
import { Telefono } from "@/components/ui/Telefono";
import { NADA, Recorte, TablaCs } from "@/components/cs/TablaCs";
import { useAbrirFicha, type SolapaServicio } from "@/components/ficha/abrir";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useParamsURL } from "@/lib/useParamsURL";
import { nivelDeRuta } from "@/lib/permisos";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import {
  COLUMNAS_CARTERA, coincideCartera, ETAPAS_DEL_ALUMNO, MOTOR_CARTERA, ORDEN_CARTERA, ORDEN_ETAPAS_CARTERA, ORDEN_LISTA, panelDeServicio,
  renglonesCartera, VISIBLES_CARTERA, VISIBLES_LISTA, type ClaveCartera, type EtapaAlumnoId, type RenglonCartera, type SeccionServicio,
} from "@/lib/panel-servicio";
import type { ColumnaCs } from "@/lib/tabla-cs";
import type { MiembroEquipo } from "@/lib/types";
import { plural, saludoDe } from "./util";
import "./mi-panel.css";
import "./panel-servicio.css";

/* ==================================================================
   El «Mi panel» de Customer Success (Lili), con la estructura del Mi panel del
   account manager de Blue OS (components/servicio/MiPanelAm):

     · «Para hoy»: lo que hay que hacer hoy, una fila por tarea con su cuenta. Tocar una
       fila filtra la cartera de abajo a esos alumnos (y lleva hasta ahí).
     · «Tus números»: cuántos hay en servicio, cuántos se contactaron, casos de éxito…
     · «Cartera»: todos los alumnos por etapa del recorrido (sale del Follow Up), en la misma
       tabla que Clientes o Testimonios (TablaCs): cada título filtra como un Excel y ordena,
       corre adentro de su tarjeta con el encabezado fijo y va de a 50 por hoja. Tocar un
       alumno abre su ficha en Servicio, en la solapa que pide la lista elegida.

   Las reglas y las cuentas están en lib/panel-servicio.ts; acá no se calcula nada.
   ================================================================== */

/* La solapa de la ficha que abre cada lista de «Para hoy». */
const HOJA_DE_LISTA: Partial<Record<SeccionServicio["id"], SolapaServicio>> = {
  /* «Renovar» abre Programa, donde está «¿Renueva?» con la llamada de resell y los botones. */
  contactar: "seguimiento", nuevos: "seguimiento", renovar: "programa", resells: "testimonio", testimonios: "testimonio", reportes: "reportes", contratos: "contrato",
};

/* Cómo se ve cada tarea de «Para hoy»: su ícono, su color y lo que pide. */
const TAREA: Record<SeccionServicio["id"], { icono: React.ReactNode; tono: string; pide: string }> = {
  contactar: { icono: <PhoneCall size={16} />, tono: "var(--danger)", pide: "su seguimiento ya venció" },
  nuevos: { icono: <UserPlus size={16} />, tono: "var(--info)", pide: "falta el primer contacto" },
  renovar: { icono: <CalendarClock size={16} />, tono: "var(--warning)", pide: "renovar o dar de baja" },
  resells: { icono: <Repeat2 size={16} />, tono: "var(--brand)", pide: "el closer no dijo en qué quedó" },
  testimonios: { icono: <Video size={16} />, tono: "var(--success)", pide: "falta el link o agendar" },
  reportes: { icono: <FileWarning size={16} />, tono: "var(--warning)", pide: "tres semanas sin reportar" },
  contratos: { icono: <FileSignature size={16} />, tono: "var(--info)", pide: "falta la firma" },
};

/* Al cambiar de lista, la tabla arranca limpia: sin la búsqueda, los filtros, el orden ni la hoja de la otra. */
const TABLA_LIMPIA: Record<string, null> = Object.assign(
  { [MOTOR_CARTERA.paramBusqueda]: null, [MOTOR_CARTERA.paramOrden]: null, [MOTOR_CARTERA.paramPagina]: null },
  ...COLUMNAS_CARTERA.map((c) => MOTOR_CARTERA.filtroAURL(c.clave, null)),
);
const PRIMERA_HOJA = { [MOTOR_CARTERA.paramPagina]: null };

export function PanelServicio({ miembro, viendoOtro }: { miembro: MiembroEquipo; viendoOtro: boolean }) {
  const e = useEstado();
  const { acceso } = useAcceso();
  const gestos = useGestos();
  const abrirFicha = useAbrirFicha();
  const [v, cambiar] = useParamsURL({ lista: "", etapa: "", base: "" });
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  const hoy = hoyDelNegocio(new Date(ahora));
  const panel = useMemo(() => panelDeServicio(e, hoy, new Date(ahora)), [e, hoy, ahora]);
  const lista = panel.secciones.find((s) => s.id === v.lista);
  const etapa = ETAPAS_DEL_ALUMNO.find((x) => x.id === v.etapa)?.id;
  const todos = v.base === "todos";

  /* La base de la cartera (en servicio o todos) y lo que cuenta la tira de etapas: sobre la misma base que la tabla. */
  const base = useMemo(() => (todos ? panel.cartera : panel.cartera.filter((f) => f.enServicio)), [panel, todos]);
  const porEtapa = useMemo(() => {
    const n = Object.fromEntries(ETAPAS_DEL_ALUMNO.map((x) => [x.id, 0])) as Record<EtapaAlumnoId, number>;
    for (const f of base) n[f.etapa] += 1;
    return n;
  }, [base]);
  /* Una lista de «Para hoy» trae a los suyos (estén o no en servicio): sus datos se buscan en toda la cartera. */
  const renglones = useMemo(() => renglonesCartera(lista ? panel.cartera : base, lista, etapa), [panel, base, lista, etapa]);
  const irACartera = () => window.setTimeout(() => document.getElementById("ps-cartera")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

  const puedeEscribir = !viendoOtro && nivelDeRuta(acceso, "/alumnos") >= 2;
  const contacte = (id: string) => {
    const alumno = e.alumnos.find((a) => a.id === id);
    if (alumno) gestos.contacte({ id, alumno });
  };
  /* Desde una lista, la ficha abre en la parte que pide esa lista (el contacto en Seguimiento, el resell en Testimonio…). */
  const abrir = (r: RenglonCartera) => {
    if (!r.alumnoId) return;
    const hoja = lista ? HOJA_DE_LISTA[lista.id] : undefined;
    abrirFicha(r.alumnoId, "servicio", hoja ? { hoja } : undefined);
  };

  /* Cada celda, como se veía en la tabla de antes: el punto de color, el Follow Up teñido por etapa, lo vencido en rojo. */
  const celda = (col: ColumnaCs<RenglonCartera, ClaveCartera>, r: RenglonCartera): React.ReactNode => {
    const f = r.fila;
    const dia = (x: string | null | undefined, rojo = false, sin: React.ReactNode = NADA) =>
      x ? <span className={`t-num${rojo ? " ps-rojo" : ""}`}>{formatoDia(x, hoy)}</span> : sin;
    switch (col.clave) {
      case "nombre":
        return (
          <span className="ps-alumno">
            <span className={`ps-punto ps-punto--${r.item ? r.item.tono : f?.etapa === "riesgo" ? "rojo" : "neutro"}`} aria-hidden />
            <span className="truncate" title={r.nombre}>{r.nombre}</span>
          </span>
        );
      case "programa": return <Recorte texto={r.programa} />;
      case "detalle": return <Recorte texto={r.item?.detalle ?? ""} />;
      case "cuando": return r.item?.cuando ? <span className={`t-num ps-cuando--${r.item.tono}`}>{r.item.cuando}</span> : NADA;
      case "followUp": return f ? <span className={`ps-follow ps-follow--${f.etapa}`}>{f.followUp || "Sin follow up"}</span> : NADA;
      case "etapa": return <Recorte texto={ETAPAS_DEL_ALUMNO.find((x) => x.id === f?.etapa)?.label ?? ""} />;
      case "estado": return <Recorte texto={f?.estadoAlumno ?? ""} />;
      case "inicio": return dia(f?.inicio);
      case "egreso": return dia(f?.egreso, Boolean(f?.egreso && f.enServicio && f.egreso < hoy));
      case "ultimoContacto": return dia(f?.ultimoContacto, false, <span className="t-subtle">Sin registro</span>);
      case "proximo": return dia(f?.proximo, Boolean(f?.proximo && f.proximo < hoy));
      case "reporte": return <Recorte texto={f?.reporte ?? ""} />;
      case "email": return <Recorte texto={f?.email || r.item?.email || ""} />;
      case "telefono":
        return (
          <span onClick={(ev) => ev.stopPropagation()}>
            <Telefono valor={f?.telefono || r.item?.telefono} pais={f?.pais || r.item?.pais} compacto vacio="—" />
          </span>
        );
    }
  };
  const valorExcel = (col: ColumnaCs<RenglonCartera, ClaveCartera>, r: RenglonCartera): string | number | null => {
    const f = r.fila;
    switch (col.clave) {
      case "nombre": return r.nombre;
      case "programa": return r.programa;
      case "detalle": return r.item?.detalle ?? "";
      case "cuando": return r.item?.cuando ?? "";
      case "followUp": return f?.followUp ?? "";
      case "etapa": return ETAPAS_DEL_ALUMNO.find((x) => x.id === f?.etapa)?.label ?? "";
      case "estado": return f?.estadoAlumno ?? "";
      case "inicio": return f?.inicio || null;
      case "egreso": return f?.egreso || null;
      case "ultimoContacto": return f?.ultimoContacto || null;
      case "proximo": return f?.proximo || null;
      case "reporte": return f?.reporte ?? "";
      case "telefono": return f?.telefono || r.item?.telefono || "";
      case "email": return f?.email || r.item?.email || "";
    }
  };

  const paraHoy = panel.secciones.filter((s) => s.total > 0);
  /* Lo que suman las listas de hoy (una persona puede estar en dos: es lo que hay que hacer, no cuántas personas). */
  const pendientesHoy = paraHoy.reduce((a, s) => a + s.total, 0);
  const urgentesHoy = paraHoy.reduce((a, s) => a + s.rojos, 0);
  const primerNombre = miembro.nombre.split(" ")[0];
  const num = panel.numeros;
  const pct = (si: number, de: number) => (de ? `${Math.round((si / de) * 100)} %` : "—");
  const cvs = panel.cvs;

  return (
    <div className="ps">
      <header className="mp-cabecera">
        <div className="mp-cabecera__texto">
          <h1 className="mp-saludo">{viendoOtro ? `Panel de ${miembro.nombre}` : `${saludoDe(ahora)}, ${primerNombre}`}</h1>
          <p className="mp-resumen">
            {plural(panel.activos, "alumno en servicio", "alumnos en servicio")}
            {pendientesHoy > 0 ? <> · {plural(pendientesHoy, "pendiente", "pendientes")} hoy{urgentesHoy > 0 && <>, <span className="ps-rojo">{plural(urgentesHoy, "urgente", "urgentes")}</span></>}</> : " · todo al día"}
          </p>
        </div>
      </header>

      <div className="ps-cols">
        <section className="mp-card ps-card" aria-label="Para hoy">
          <h2 className="ps-tit">Para hoy</h2>
          <p className="ps-ayuda">Lo que pide el servicio hoy. Tocá una fila para ver a quiénes.</p>
          {paraHoy.length === 0 ? (
            <div className="ps-aldia"><span className="ps-ico" style={{ "--tono": "var(--success)" } as React.CSSProperties}><Check size={16} /></span>
              <div><b>Todo al día.</b><span>Nadie para contactar, renovar ni firmar. Hoy toca acompañar.</span></div></div>
          ) : (
            <div className="ps-tareas">
              {paraHoy.map((s) => {
                const t = TAREA[s.id];
                const activa = lista?.id === s.id;
                return (
                  <button
                    key={s.id} type="button" className={`ps-tarea${activa ? " ps-tarea--on" : ""}`} aria-pressed={activa}
                    onClick={() => { cambiar({ lista: activa ? null : s.id, etapa: null }, TABLA_LIMPIA); if (!activa) irACartera(); }}
                  >
                    <span className="ps-ico" style={{ "--tono": t.tono } as React.CSSProperties}>{t.icono}</span>
                    <span className="ps-tarea__txt">
                      <span className="ps-tarea__tit">{s.titulo} <span className="ps-tarea__pide">· {t.pide}</span></span>
                      <span className="ps-tarea__sub">{s.regla}</span>
                    </span>
                    <span className="ps-tarea__n">
                      <b className={s.rojos > 0 ? "ps-rojo" : undefined}>{s.total}</b>
                      {s.rojos > 0 && <small>{s.rojos === s.total ? (s.total === 1 ? "urgente" : "todos urgentes") : `${s.rojos} ${s.rojos === 1 ? "urgente" : "urgentes"}`}</small>}
                    </span>
                    <ChevronRight size={16} className="ps-tarea__ir" aria-hidden />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="mp-card ps-card" aria-label="Tus números">
          <h2 className="ps-tit">{viendoOtro ? "Sus números" : "Tus números"}</h2>
          <p className="ps-ayuda">Cómo va la cartera, con los datos que hay cargados.</p>
          <div className="ps-kpis">
            <button type="button" className="ps-kpi" onClick={() => { cambiar({ lista: null, etapa: null, base: null }); irACartera(); }}>
              <span className="ps-kpi__rot">En servicio</span><span className="ps-kpi__val">{num.enServicio}</span>
              <span className="ps-kpi__ctx">de {panel.cartera.length} alumnos en la app</span>
            </button>
            <div className="ps-kpi">
              <span className="ps-kpi__rot">Contactados</span><span className="ps-kpi__val">{pct(num.contactados30.si, num.contactados30.de)}</span>
              <span className="ps-kpi__ctx">{num.contactados30.si} con un contacto en los últimos 30 días</span>
            </div>
            <div className="ps-kpi">
              <span className="ps-kpi__rot">Reportando</span><span className="ps-kpi__val">{pct(num.reportando.si, num.reportando.de)}</span>
              <span className="ps-kpi__ctx">{num.reportando.si} de {num.reportando.de} con el dato del reporte</span>
            </div>
            <button type="button" className="ps-kpi" onClick={() => { cambiar({ lista: null, etapa: "exito", base: "todos" }); irACartera(); }}>
              <span className="ps-kpi__rot">Casos de éxito</span><span className="ps-kpi__val">{num.casosDeExito}</span>
              <span className="ps-kpi__ctx">con el Follow Up en caso de éxito</span>
            </button>
            <Link href="/alumnos?seccion=testimonios" className="ps-kpi">
              <span className="ps-kpi__rot">Testimonios</span><span className="ps-kpi__val">{num.testimoniosConVideo}</span>
              <span className="ps-kpi__ctx">con el video cargado</span>
            </Link>
            <Link href="/alumnos?seccion=resells" className="ps-kpi">
              <span className="ps-kpi__rot">Renovaciones</span><span className="ps-kpi__val">{num.renovacionesMes}</span>
              <span className="ps-kpi__ctx">resells que renovaron este mes</span>
            </Link>
          </div>
        </section>
      </div>

      <section className="mp-card ps-cartera" id="ps-cartera" aria-label="Cartera">
        <div className="ps-cartera__head">
          <h2 className="ps-tit">Cartera</h2>
          <p className="ps-ayuda">Cada alumno en su etapa del recorrido (sale de su Follow Up). Tocá una etapa para filtrar y un alumno para abrir su ficha.</p>
        </div>

        <div className="ps-pipe" aria-label="Etapas">
          {ETAPAS_DEL_ALUMNO.map((x) => {
            const on = !lista && etapa === x.id;
            const cuenta = porEtapa[x.id];
            return (
              <button
                key={x.id} type="button" className={`ps-etapa${on ? " ps-etapa--on" : ""}${x.riesgo ? " ps-etapa--riesgo" : ""}`} aria-pressed={on} title={x.ayuda}
                onClick={() => cambiar({ etapa: on ? null : x.id, lista: null }, lista ? TABLA_LIMPIA : PRIMERA_HOJA)}
              >
                <span className={`ps-etapa__n${cuenta === 0 ? " ps-etapa__n--cero" : ""}`}>{cuenta}</span>
                <span className="ps-etapa__rot">{x.label}</span>
              </button>
            );
          })}
        </div>

        {lista && <p className="ps-regla">{lista.regla}</p>}

        <TablaCs
          key={lista ? "lista" : "cartera"}
          motor={MOTOR_CARTERA} pantalla={lista ? "panel-servicio-lista" : "panel-servicio-cartera"} filas={renglones} coincide={coincideCartera}
          visiblesPorDefecto={lista ? VISIBLES_LISTA : VISIBLES_CARTERA} ordenPorDefecto={lista ? ORDEN_LISTA : ORDEN_CARTERA}
          fija="nombre" ordenValores={ORDEN_ETAPAS_CARTERA} celda={celda}
          singular="alumno" plural="alumnos" placeholder="Buscar alumno, mail o teléfono"
          atajos={(
            <>
              <div className="segmento" role="tablist" aria-label="Qué alumnos">
                <button type="button" role="tab" aria-selected={!todos} onClick={() => cambiar({ base: null }, PRIMERA_HOJA)}>En servicio <span className="ps-seg-n">{panel.activos}</span></button>
                <button type="button" role="tab" aria-selected={todos} onClick={() => cambiar({ base: "todos" }, PRIMERA_HOJA)}>Todos <span className="ps-seg-n">{panel.cartera.length}</span></button>
              </div>
              {(lista || etapa) && (
                <span className="ps-filtro">
                  {lista ? lista.titulo : ETAPAS_DEL_ALUMNO.find((x) => x.id === etapa)?.label}
                  <button type="button" aria-label="Quitar el filtro" onClick={() => cambiar({ lista: null, etapa: null }, lista ? TABLA_LIMPIA : PRIMERA_HOJA)}><X size={13} /></button>
                </span>
              )}
            </>
          )}
          excel={{ nombre: lista ? lista.titulo : "Cartera", hoy, valor: valorExcel }}
          vacio={lista
            ? { titulo: "Nadie en esta lista", texto: lista.vacio }
            : { titulo: etapa ? "Nadie en esta etapa" : "No hay alumnos", texto: todos ? "Probá con otra etapa." : "Probá con «Todos»: hay alumnos que ya no están en servicio.",
              accion: !todos ? <button type="button" className="ps-accion" onClick={() => cambiar({ base: "todos" }, PRIMERA_HOJA)}>Ver todos</button> : undefined }}
          onFila={abrir} etiquetaFila={(r) => (r.alumnoId ? `Abrir la ficha de ${r.nombre}` : `${r.nombre} no es un alumno de la app`)}
          filaAcciones={lista?.id === "contactar" && puedeEscribir ? (r) => (r.alumnoId ? (
            <button type="button" className="ps-accion" onClick={(ev) => { ev.stopPropagation(); contacte(r.alumnoId as string); }} title="Lo contacté hoy: el próximo toca según su cadencia">
              <Check size={14} aria-hidden />Lo contacté
            </button>
          ) : null) : undefined}
        />
      </section>

      <div className="ps-pie">
        <Link href="/alumnos?seccion=cvs" className="ps-dato" title={cvs.porEstado.map((x) => `${x.estado}: ${x.n}`).join(" · ") || "No hay revisiones en curso"}>
          <b>{cvs.enCurso}</b> CV y LinkedIn en curso (Aldana)
        </Link>
        {panel.enOutboarding > 0 && (
          <button type="button" className="ps-dato" onClick={() => { cambiar({ lista: null, etapa: "outboarding", base: "todos" }); irACartera(); }}
            title="Su Follow Up dice outboarding o caso de éxito: no entran a «Para hoy». Su estado de alumno no se tocó.">
            <b>{panel.enOutboarding}</b> figuran activos y ya cerraron el programa
          </button>
        )}
        {panel.desactualizados > 0 && (
          <span className="ps-dato" title="Figuran activos, su contrato terminó hace más de 45 días y su Follow Up no dice outboarding: no entran a «Para hoy». Actualizá su Follow Up, su egreso o su estado.">
            <b>{panel.desactualizados}</b> para revisar: contrato vencido y siguen activos
          </span>
        )}
        <span className="ps-dato ps-fecha">Datos al {formatoDia(hoy, hoy)}</span>
      </div>
    </div>
  );
}
