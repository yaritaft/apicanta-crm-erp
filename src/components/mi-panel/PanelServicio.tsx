"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock, Check, ChevronRight, FileSignature, FileWarning, PhoneCall, Repeat2, Search, UserPlus, Video, X,
} from "lucide-react";
import { Telefono } from "@/components/ui/Telefono";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useParamsURL } from "@/lib/useParamsURL";
import { nivelDeRuta } from "@/lib/permisos";
import { sinTildes } from "@/lib/crm";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import {
  ETAPAS_DEL_ALUMNO, panelDeServicio, type EtapaAlumnoId, type FilaCartera, type ItemServicio, type SeccionServicio,
} from "@/lib/panel-servicio";
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
     · «Cartera»: todos los alumnos por etapa del recorrido (sale del Follow Up), como una
       tabla de Airtable: se filtra por etapa, se busca, se ordena por cualquier columna.
       Tocar un alumno abre su ficha en Servicio, donde se hace lo que haya que hacer.

   Las reglas y las cuentas están en lib/panel-servicio.ts; acá no se calcula nada.
   ================================================================== */

const POR_PAGINA = 50;

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

type Columna = "nombre" | "programa" | "etapa" | "inicio" | "egreso" | "ultimoContacto" | "proximo" | "detalle" | "cuando";

/* Una fila de la tabla: un alumno de la cartera o una tarea de «Para hoy» (con lo que pasa y cuándo). */
interface Renglon {
  clave: string;
  alumnoId?: string;
  nombre: string;
  programa: string;
  fila?: FilaCartera;
  item?: ItemServicio;
}

const texto = (r: Renglon, c: Columna): string | number => {
  const f = r.fila;
  switch (c) {
    case "nombre": return sinTildes(r.nombre);
    case "programa": return sinTildes(r.programa);
    case "etapa": return f ? ETAPAS_DEL_ALUMNO.findIndex((x) => x.id === f.etapa) * 1000 + (f.followUp ? 0 : 1) : 9999;
    case "inicio": return f?.inicio || "";
    case "egreso": return f?.egreso || "";
    case "ultimoContacto": return f?.ultimoContacto || "";
    case "proximo": return f?.proximo || "9999";
    case "detalle": return sinTildes(r.item?.detalle ?? "");
    case "cuando": return r.item?.dias ?? -1e9;
  }
};

function Cabecera({ c, titulo, orden, onOrden, ancho }: {
  c: Columna; titulo: string; orden: { col: Columna; desc: boolean } | null; onOrden: (c: Columna) => void; ancho?: number;
}) {
  const activa = orden?.col === c;
  return (
    <th style={ancho ? { width: ancho } : undefined} aria-sort={activa ? (orden?.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="ps-th" onClick={() => onOrden(c)} title="Ordenar por esta columna">
        {titulo}{activa && <span aria-hidden>{orden?.desc ? " ↓" : " ↑"}</span>}
      </button>
    </th>
  );
}

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
  const porId = useMemo(() => new Map(panel.cartera.map((f) => [f.id, f] as const)), [panel]);

  const lista = panel.secciones.find((s) => s.id === v.lista);
  const etapa = ETAPAS_DEL_ALUMNO.find((x) => x.id === v.etapa)?.id;
  const todos = v.base === "todos";
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState<{ col: Columna; desc: boolean } | null>(null);
  const [mostrar, setMostrar] = useState({ clave: "", n: POR_PAGINA });

  /* La base de la cartera (en servicio o todos) y lo que cuenta la tira de etapas: sobre la misma base que la tabla. */
  const base = useMemo(() => (todos ? panel.cartera : panel.cartera.filter((f) => f.enServicio)), [panel, todos]);
  const porEtapa = useMemo(() => {
    const n = Object.fromEntries(ETAPAS_DEL_ALUMNO.map((x) => [x.id, 0])) as Record<EtapaAlumnoId, number>;
    for (const f of base) n[f.etapa] += 1;
    return n;
  }, [base]);

  const renglones = useMemo((): Renglon[] => {
    const t = sinTildes(q.trim());
    const busca = (r: Renglon) => !t || sinTildes([r.nombre, r.programa, r.fila?.followUp, r.fila?.telefono, r.fila?.email, r.item?.detalle].filter(Boolean).join(" ")).includes(t);
    let xs: Renglon[];
    if (lista) {
      xs = lista.items.map((i) => {
        const fila = i.alumnoId ? porId.get(i.alumnoId) : undefined;
        return { clave: i.clave, alumnoId: i.alumnoId, nombre: i.nombre, programa: fila?.programa || i.programa || "", fila, item: i };
      });
    } else {
      xs = base.filter((f) => !etapa || f.etapa === etapa).map((f) => ({ clave: f.id, alumnoId: f.id, nombre: f.nombre, programa: f.programa, fila: f }));
    }
    xs = xs.filter(busca);
    if (orden) {
      const s = orden.desc ? -1 : 1;
      xs = [...xs].sort((a, b) => {
        const x = texto(a, orden.col), y = texto(b, orden.col);
        return (x < y ? -1 : x > y ? 1 : 0) * s || a.nombre.localeCompare(b.nombre, "es");
      });
    } else if (!lista) {
      /* Sin ordenar a mano, la cartera se lee de la mano de la tira de etapas. */
      xs = [...xs].sort((a, b) => (texto(a, "etapa") as number) - (texto(b, "etapa") as number) || a.nombre.localeCompare(b.nombre, "es"));
    }
    return xs;
  }, [lista, base, etapa, porId, q, orden]);

  const claveVista = `${v.lista}|${v.etapa}|${v.base}|${q}|${orden?.col}${orden?.desc}`;
  const n = mostrar.clave === claveVista ? mostrar.n : POR_PAGINA;
  const ordenarPor = (c: Columna) => setOrden((o) => (o?.col === c ? (o.desc ? null : { col: c, desc: true }) : { col: c, desc: false }));
  const irACartera = () => window.setTimeout(() => document.getElementById("ps-cartera")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

  const puedeEscribir = !viendoOtro && nivelDeRuta(acceso, "/alumnos") >= 2;
  const contacte = (id: string) => {
    const alumno = e.alumnos.find((a) => a.id === id);
    if (alumno) gestos.contacte({ id, alumno });
  };
  const abrir = (r: Renglon) => { if (r.alumnoId) abrirFicha(r.alumnoId, "servicio"); };

  const paraHoy = panel.secciones.filter((s) => s.total > 0);
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
            {paraHoy.length > 0 ? ` · ${plural(paraHoy.length, "tarea", "tareas")} para hoy` : " · todo al día"}
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
                    onClick={() => { cambiar({ lista: activa ? null : s.id, etapa: null }); setQ(""); setOrden(null); if (!activa) irACartera(); }}
                  >
                    <span className="ps-ico" style={{ "--tono": t.tono } as React.CSSProperties}>{t.icono}</span>
                    <span className="ps-tarea__txt">
                      <span className="ps-tarea__tit">{s.titulo} <span className="ps-tarea__pide">· {t.pide}</span></span>
                      <span className="ps-tarea__sub">{s.regla}</span>
                    </span>
                    <span className="ps-tarea__n">
                      <b className={s.rojos > 0 ? "ps-rojo" : undefined}>{s.total}</b>
                      {s.rojos > 0 && <small>{s.rojos === s.total ? "urgentes" : `${s.rojos} urgentes`}</small>}
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
                onClick={() => { cambiar({ etapa: on ? null : x.id, lista: null }); setOrden(null); }}
              >
                <span className={`ps-etapa__n${cuenta === 0 ? " ps-etapa__n--cero" : ""}`}>{cuenta}</span>
                <span className="ps-etapa__rot">{x.label}</span>
              </button>
            );
          })}
        </div>

        <div className="ps-barra">
          <div className="segmento" role="tablist" aria-label="Qué alumnos">
            <button type="button" role="tab" aria-selected={!todos} onClick={() => cambiar({ base: null })}>En servicio <span className="ps-seg-n">{panel.activos}</span></button>
            <button type="button" role="tab" aria-selected={todos} onClick={() => cambiar({ base: "todos" })}>Todos <span className="ps-seg-n">{panel.cartera.length}</span></button>
          </div>
          {(lista || etapa) && (
            <span className="ps-filtro">
              {lista ? lista.titulo : ETAPAS_DEL_ALUMNO.find((x) => x.id === etapa)?.label}
              <button type="button" aria-label="Quitar el filtro" onClick={() => cambiar({ lista: null, etapa: null })}><X size={13} /></button>
            </span>
          )}
          <label className="ps-buscar">
            <Search size={15} aria-hidden />
            <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar alumno, mail o teléfono…" aria-label="Buscar en la cartera" />
          </label>
        </div>
        {lista && <p className="ps-regla">{lista.regla}</p>}

        <div className="ps-tabla-caja">
          <table className="ps-tabla">
            <thead>
              <tr>
                <Cabecera c="nombre" titulo="Alumno" orden={orden} onOrden={ordenarPor} />
                <Cabecera c="programa" titulo="Programa" orden={orden} onOrden={ordenarPor} ancho={130} />
                {lista ? (
                  <>
                    <Cabecera c="detalle" titulo="Qué pasa" orden={orden} onOrden={ordenarPor} />
                    <Cabecera c="cuando" titulo="Cuándo" orden={orden} onOrden={ordenarPor} ancho={110} />
                  </>
                ) : (
                  <>
                    <Cabecera c="etapa" titulo="Follow up" orden={orden} onOrden={ordenarPor} ancho={160} />
                    <Cabecera c="inicio" titulo="Inicio" orden={orden} onOrden={ordenarPor} ancho={110} />
                    <Cabecera c="egreso" titulo="Vence" orden={orden} onOrden={ordenarPor} ancho={110} />
                    <Cabecera c="ultimoContacto" titulo="Último contacto" orden={orden} onOrden={ordenarPor} ancho={120} />
                    <Cabecera c="proximo" titulo="Próximo" orden={orden} onOrden={ordenarPor} ancho={100} />
                  </>
                )}
                <th style={{ width: 170 }}>Teléfono</th>
                {lista?.id === "contactar" && puedeEscribir && <th style={{ width: 120 }} aria-label="Acción" />}
              </tr>
            </thead>
            <tbody>
              {renglones.slice(0, n).map((r) => {
                const f = r.fila;
                const vencido = f && f.proximo && f.proximo < hoy;
                const vence = f?.egreso && f.enServicio && f.egreso < hoy;
                return (
                  <tr
                    key={r.clave} className={r.alumnoId ? "ps-tr--clic" : undefined} tabIndex={r.alumnoId ? 0 : undefined}
                    onClick={() => abrir(r)} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && ev.key === "Enter") abrir(r); }}
                    title={r.alumnoId ? `Abrir la ficha de ${r.nombre}` : "No es un alumno de la app"}
                  >
                    <td>
                      <span className="ps-alumno">
                        <span className={`ps-punto ps-punto--${r.item ? r.item.tono : f?.etapa === "riesgo" ? "rojo" : "neutro"}`} aria-hidden />
                        <span className="ps-alumno__nombre">{r.nombre}</span>
                      </span>
                    </td>
                    <td className="ps-sutil">{r.programa || "—"}</td>
                    {lista ? (
                      <>
                        <td className="ps-detalle-td" title={r.item?.detalle}>{r.item?.detalle}</td>
                        <td className={`ps-num ps-cuando--${r.item?.tono}`}>{r.item?.cuando}</td>
                      </>
                    ) : (
                      <>
                        <td><span className={`ps-follow ps-follow--${f?.etapa}`}>{f?.followUp || "Sin follow up"}</span></td>
                        <td className="ps-num ps-sutil">{f?.inicio ? formatoDia(f.inicio, hoy) : "—"}</td>
                        <td className={`ps-num${vence ? " ps-rojo" : " ps-sutil"}`}>{f?.egreso ? formatoDia(f.egreso, hoy) : "—"}</td>
                        <td className="ps-num ps-sutil">{f?.ultimoContacto ? formatoDia(f.ultimoContacto, hoy) : "Sin registro"}</td>
                        <td className={`ps-num${vencido ? " ps-rojo" : " ps-sutil"}`}>{f?.proximo ? formatoDia(f.proximo, hoy) : "—"}</td>
                      </>
                    )}
                    <td onClick={(ev) => ev.stopPropagation()}><Telefono valor={f?.telefono || r.item?.telefono} pais={f?.pais || r.item?.pais} compacto vacio="—" /></td>
                    {lista?.id === "contactar" && puedeEscribir && (
                      <td onClick={(ev) => ev.stopPropagation()}>
                        {r.alumnoId && (
                          <button type="button" className="ps-accion" onClick={() => contacte(r.alumnoId as string)} title="Lo contacté hoy: el próximo toca según su cadencia">
                            <Check size={14} aria-hidden />Lo contacté
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {renglones.length === 0 && (
            <p className="mp-vacio ps-tabla-vacia">{q ? "Nadie coincide con la búsqueda." : lista ? lista.vacio : "No hay alumnos en esta etapa."}</p>
          )}
        </div>

        <div className="ps-pie-tabla">
          <span>{renglones.length > 0 ? `${Math.min(n, renglones.length)} de ${renglones.length} · tocá un alumno para abrir su ficha` : ""}</span>
          {n < renglones.length && (
            <button type="button" className="ps-accion" onClick={() => setMostrar({ clave: claveVista, n: n + POR_PAGINA })}>
              Ver {Math.min(POR_PAGINA, renglones.length - n)} más
            </button>
          )}
        </div>
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
