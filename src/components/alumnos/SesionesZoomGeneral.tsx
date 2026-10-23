"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Video } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Input } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { ESTADO_ALUMNO } from "@/components/alumnos/comun";
import { cabeceras } from "@/components/webinars/useYoutube";
import { useEstado } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { num } from "@/lib/format";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { programaDeProducto, programasDe } from "@/lib/programas";
import { resumenGeneralZoom, type AsistenciaZoom, type ClaseZoom, type FilaAlumnoZoom } from "@/lib/zoom-asistencia";
import type { EstadoAlumno } from "@/lib/types";

/* ==================================================================
   Alumnos → Sesiones Zoom (Juan Cruz, 23/10): lo general de las clases de
   Zoom. Arriba los números (cuántas clases hubo, cuánta gente entra, cuántos
   alumnos activos vienen y cuántos nunca entraron); abajo, cada alumno con
   a cuántas clases fue y cada clase con su asistencia. Un clic en un alumno
   abre su ficha, en su solapa «Sesiones Zoom».

   Lo trae lib/zoom-asistencia-servidor.ts cada hora (supabase/asistencias-zoom.sql).
   ================================================================== */

/* PostgREST corta en 1000 filas sin avisar: se pide por páginas. */
async function traerTodo<T>(tabla: string, orden: string): Promise<T[] | null> {
  if (!nube) return null;
  const filas: T[] = [];
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const r = await nube.from(tabla).select("*").order(orden, { ascending: false }).range(desde, desde + 999);
    if (r.error) return null;
    filas.push(...((r.data ?? []) as T[]));
    if ((r.data?.length ?? 0) < 1000) break;
  }
  return filas;
}

type Filtro = "todos" | "vienen" | "nunca";

function Kpi({ etiqueta, valor, sub, ayuda }: { etiqueta: string; valor: string; sub?: string; ayuda?: string }) {
  return (
    <div className="wb-kpi" title={ayuda}>
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num">{valor}</span>
      {sub && <span className="t-sm t-subtle">{sub}</span>}
    </div>
  );
}

export function SesionesZoomGeneral() {
  const e = useEstado();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const [datos, setDatos] = useState<{ clases: ClaseZoom[]; asistencias: AsistenciaZoom[] } | "sin-tablas" | null>(null);
  const [trayendo, setTrayendo] = useState(false);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const hoy = hoyDelNegocio();

  const leer = useCallback(async () => {
    const [clases, asistencias] = await Promise.all([
      traerTodo<ClaseZoom>("asistencias_zoom_clases", "inicio"), traerTodo<AsistenciaZoom>("asistencias_zoom", "inicio"),
    ]);
    setDatos(clases && asistencias ? { clases, asistencias } : "sin-tablas");
  }, []);
  useEffect(() => { void leer(); }, [leer]);

  async function traerAhora() {
    setTrayendo(true);
    try {
      const r = await fetch("/api/zoom/asistencia", { method: "POST", cache: "no-store", headers: await cabeceras() });
      const j = (await r.json().catch(() => ({}))) as { clases?: number; errores?: string[]; permiso?: string; error?: string };
      if (!r.ok) toast(j.error ?? `No se pudo traer (error ${r.status}).`, "err");
      else if (j.errores?.length) toast(j.permiso ?? j.errores[0], "err");
      else toast(j.clases ? `Listo: ${j.clases} ${j.clases === 1 ? "clase nueva" : "clases nuevas"}.` : "Está al día: no hay clases nuevas para traer.");
    } catch { toast("No se pudo hablar con el servidor.", "err"); }
    setTrayendo(false);
    await leer();
  }

  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const g = useMemo(() => {
    if (!datos || datos === "sin-tablas") return null;
    const productoDe = new Map(e.ventas.map((v) => [v.id, v.productoId] as const));
    return resumenGeneralZoom(datos.clases, datos.asistencias, e.alumnos.filter((a) => a.email).map((a) => ({
      id: a.id, nombre: a.nombre, email: a.email, estado: a.estado, inicio: a.inicio,
      reuniones: programaDeProducto(programas, a.ventaId ? productoDe.get(a.ventaId) : undefined)?.zoom,
    })));
  }, [datos, e.alumnos, e.ventas, programas]);

  const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filas = useMemo(() => {
    if (!g) return [];
    const buscado = normal(q.trim());
    return g.alumnos
      .filter((f) => (filtro === "todos" ? true : filtro === "vienen" ? f.activo : f.asistio === 0 && f.estado === "activo"))
      .filter((f) => !buscado || normal(f.nombre).includes(buscado))
      .map((f) => ({ ...f, id: f.alumnoId }));
  }, [g, q, filtro]);

  const boton = <Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={trayendo} onClick={() => void traerAhora()}>Traer ahora</Button>;

  if (datos === null) return <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />;
  if (datos === "sin-tablas" || !g) {
    return <Card><Empty icono={<Video size={22} />} titulo="Todavía no está activada la asistencia a Zoom" texto="Falta correr supabase/asistencias-zoom.sql en la base." /></Card>;
  }
  if (g.clasesTotal === 0) {
    return (
      <Card>
        <Empty icono={<Video size={22} />} titulo="Todavía no se trajo ninguna clase de Zoom" texto="Se traen solas cada hora. Si recién se dieron los permisos a la app de Zoom, tocá «Traer ahora»." accion={boton} />
      </Card>
    );
  }

  const columnasAlumnos: Columna<FilaAlumnoZoom & { id: string }>[] = [
    { clave: "nombre", titulo: "Alumno", tipo: "primary", celda: (f) => f.nombre, orden: (f) => f.nombre.toLowerCase() },
    { clave: "estado", titulo: "Estado", celda: (f) => { const s = ESTADO_ALUMNO[f.estado as EstadoAlumno]; return s ? <Badge variante={s.variante}>{s.texto}</Badge> : f.estado; }, orden: (f) => f.estado },
    { clave: "clases", titulo: "Clases", tipo: "num", celda: (f) => `${f.asistio} de ${f.deClases}`, orden: (f) => f.asistio },
    {
      clave: "pct", titulo: "Asistencia", tipo: "num", orden: (f) => f.pct,
      celda: (f) => <Badge variante={f.asistio === 0 ? "danger" : f.pct >= 70 ? "success" : "warning"}>{f.pct}%</Badge>,
    },
    { clave: "minutos", titulo: "Minutos", tipo: "num", celda: (f) => num(f.minutos), orden: (f) => f.minutos },
    { clave: "ultima", titulo: "Última vez", tipo: "secondary", celda: (f) => (f.ultima ? formatoDia(f.ultima, hoy) : "Nunca"), orden: (f) => f.ultima },
  ];
  const columnasClases: Columna<(typeof g.clases)[number]>[] = [
    { clave: "dia", titulo: "Día", tipo: "primary", celda: (c) => formatoDia(c.dia, hoy), orden: (c) => c.dia },
    { clave: "tema", titulo: "Clase", celda: (c) => c.tema || "Clase", orden: (c) => c.tema },
    { clave: "asistentes", titulo: "Alumnos y registrados", tipo: "num", celda: (c) => num(c.asistentes), orden: (c) => c.asistentes },
    { clave: "partes", titulo: "Veces que alguien entró", tipo: "num", celda: (c) => num(c.participantes), orden: (c) => c.participantes },
  ];
  const nuncaCuenta = g.activosNunca;

  return (
    <div className="stack-4">
      <div className="wb-vivo__kpis">
        <Kpi etiqueta="Clases · 30 días" valor={num(g.clases30)} sub={`${num(g.clasesTotal)} desde que se trae`} ayuda="Una clase es una reunión en un día. Las reuniones que Zoom parte en varias o donde estuvo sólo el anfitrión no cuentan." />
        <Kpi etiqueta="Personas · 30 días" valor={num(g.personas30)} sub="distintas, por mail" />
        <Kpi etiqueta="Por clase" valor={num(g.promedio30)} sub="asistentes en promedio, 30 días" />
        <Kpi etiqueta="Activos que vienen" valor={`${num(g.activosConAsistencia)} de ${num(g.activos)}`} sub="entraron en los últimos 14 días" ayuda="Alumnos activos que entraron a alguna clase en las últimas dos semanas." />
        <Kpi etiqueta="Activos que nunca entraron" valor={num(nuncaCuenta)} sub={g.activos ? `${Math.round((nuncaCuenta / g.activos) * 100)}% de los activos` : undefined} ayuda="Alumnos activos sin ninguna clase de Zoom registrada con su mail." />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <div className="toolbar">
            <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar alumno" aria-label="Buscar alumno" icono={<Search size={15} />} />
            <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos {num(g.alumnos.length)}</Chip>
            <Chip activo={filtro === "vienen"} onClick={() => setFiltro("vienen")}>Vienen {num(g.alumnos.filter((f) => f.activo).length)}</Chip>
            <Chip activo={filtro === "nunca"} onClick={() => setFiltro("nunca")}>Activos que nunca entraron {num(nuncaCuenta)}</Chip>
            <span style={{ marginLeft: "auto" }}>{boton}</span>
          </div>
        </div>
        <DataTable
          filas={filas} columnas={columnasAlumnos} alto={560} porPagina={50} ordenInicial={{ clave: "clases", desc: true }}
          onFila={(f) => abrirFicha(f.alumnoId, "servicio", { hoja: "zoom" })} etiquetaFila={(f) => `Ver las sesiones de Zoom de ${f.nombre}`}
          vacio={<Empty icono={<Video size={22} />} titulo="Nadie en esta lista" texto="Probá con otro filtro o búsqueda." />}
        />
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}><span className="t-label">Cada clase</span></div>
        <DataTable filas={g.clases} columnas={columnasClases} alto={420} porPagina={30} ordenInicial={{ clave: "dia", desc: true }} vacio={<Empty icono={<Video size={22} />} titulo="Sin clases" texto="Todavía no hay clases." />} />
      </Card>
    </div>
  );
}

