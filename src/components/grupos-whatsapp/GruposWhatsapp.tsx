"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Download, MessageCircle, RefreshCw, Search } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Input, Tabs } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { ConfigColumnas, useColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { CopiarLink } from "@/components/ui/Filtros";
import { EncabezadoExcel, PastillasExcel, useFiltrosExcel } from "@/components/ui/FiltrosExcel";
import { VistasGuardadas } from "@/components/ui/VistasGuardadas";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { aLista } from "@/lib/compartirLink";
import { bajarCsv } from "@/lib/csv";
import { fecha, num, pct, relativo } from "@/lib/format";
import {
  COLUMNAS_GRUPOS, COLUMNAS_INTEGRANTES, csvDeGrupos, csvDeIntegrantes, filasDeGrupos, filasDeIntegrantes, ORDEN_GRUPOS_POR_DEFECTO,
  ORDEN_INTEGRANTES_POR_DEFECTO, personasPorTelefono, SIN_WEBINAR, telefonoDeClave, totalesDeGrupos, totalesDeIntegrantes,
  type FilaGrupo, type FilaIntegrante,
} from "@/lib/grupos-whatsapp";
import { cargarRegistros, useRegistrosNube } from "@/lib/registros-nube";
import { filtroAURL, filtrosDeURL } from "@/lib/tabla-filtros";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { useEstado } from "@/lib/store";
import { paginaDeURL, useBusquedaURL, useEscribirURL, useParamsURL } from "@/lib/useParamsURL";
import { puedeVerWhatsapp } from "@/lib/whatsapp";
import { useIntegrantes } from "@/lib/whatsapp-cliente";
import { useSearchParams } from "next/navigation";
import "@/components/formularios/formularios.css";

/* ==================================================================
   Crecimiento → Grupos de WhatsApp.

   Cada grupo que detectó el lector con cuántos hay, cuántos entraron, cuántos
   salieron y la retención, y todos los integrantes con su estado. Una tabla
   como la del CRM y la de Formularios: filtros por columna (como en Excel), las
   columnas a gusto, vistas guardadas, y el CSV de lo que se ve. Los totales van
   al pie de cada columna. Un clic en un grupo abre sus integrantes.
   ================================================================== */

type Seccion = "grupos" | "integrantes";

const DEFS_GRUPOS: DefColumna[] = Object.values(COLUMNAS_GRUPOS).map((c) => ({ clave: c.clave, titulo: c.titulo, fija: c.clave === "nombre" }));
const DEFS_INTEGRANTES: DefColumna[] = Object.values(COLUMNAS_INTEGRANTES).map((c) => ({ clave: c.clave, titulo: c.titulo, fija: c.clave === "telefono" }));
const TODAS_GRUPOS = Object.keys(COLUMNAS_GRUPOS);
const TODAS_INTEGRANTES = Object.keys(COLUMNAS_INTEGRANTES);

/** Un total al pie de una columna: la etiqueta en chico y el número en grande, como el pie de Formularios. */
function Pie({ etiqueta, valor, sub }: { etiqueta: string; valor?: string; sub?: string }) {
  return (
    <span className="fm-pie fm-pie--fijo">
      <span className="fm-pie__etq">{etiqueta}</span>
      {valor !== undefined && <span className="fm-pie__valor t-num">{valor}</span>}
      {sub && <span className="fm-pie__sub t-num">{sub}</span>}
    </span>
  );
}

const colorRetencion = (r: number) => (r >= 80 ? "success" : r >= 50 ? "warning" : "danger") as "success" | "warning" | "danger";

export function GruposWhatsapp() {
  const { acceso } = useAcceso();
  const ve = puedeVerWhatsapp(acceso);
  const datos = useIntegrantes(ve);
  const [v, cambiar] = useParamsURL({ seccion: "grupos", pag: "1", orden: "" });
  const seccion: Seccion = v.seccion === "integrantes" ? "integrantes" : "grupos";

  if (!ve || datos.sinAcceso) {
    return <Card><Empty icono={<MessageCircle size={22} />} titulo="Tu tipo de cuenta no ve los grupos de WhatsApp" texto="Lo ven quienes ven los Webinars." /></Card>;
  }
  if (datos.error && !datos.datos) {
    return <Card><Empty icono={<MessageCircle size={22} />} titulo="No pude traer los grupos" texto={datos.error} accion={<Button onClick={() => void datos.recargar()}>Reintentar</Button>} /></Card>;
  }
  /* Todavía no llegó nada (la primera vez que se abre, o mientras se sabe qué ve esta cuenta). */
  if (!datos.datos) return <Card><p className="t-sm t-subtle" style={{ padding: "var(--space-5)" }}>Leyendo los grupos y sus integrantes…</p></Card>;
  if (!datos.datos.tablas) {
    return <Card><Empty icono={<MessageCircle size={22} />} titulo="Faltan las tablas de WhatsApp" texto="Hay que correr una vez supabase/whatsapp-lector.sql en Supabase." /></Card>;
  }
  if (datos.datos.grupos.length === 0) {
    return (
      <Card>
        <Empty
          icono={<MessageCircle size={22} />} titulo="El lector todavía no detectó ningún grupo"
          texto={datos.datos.lector ? "Cuando el número del lector esté en un grupo de WhatsApp, aparece acá con sus integrantes." : "El lector de WhatsApp no está conectado: se vincula en Ajustes → WhatsApp."}
        />
      </Card>
    );
  }
  const cifras = datos.datos;

  const tabs = (
    <Tabs<Seccion>
      valor={seccion} onChange={(s) => cambiar({ seccion: s === "grupos" ? null : s, orden: null, pag: null })}
      opciones={[{ valor: "grupos", texto: "Grupos" }, { valor: "integrantes", texto: "Integrantes" }]}
    />
  );
  return (
    <div className="crm-t gw-t">
      <Card className="crm-t__card">
        {seccion === "grupos"
          ? <TablaGrupos datos={cifras} cargando={datos.cargando} onRecargar={datos.recargar} tabs={tabs} pagina={v.pag} onPagina={(p) => cambiar({ pag: String(p + 1) })} />
          : <TablaIntegrantes datos={cifras} cargando={datos.cargando} onRecargar={datos.recargar} tabs={tabs} pagina={v.pag} onPagina={(p) => cambiar({ pag: String(p + 1) })} />}
      </Card>
    </div>
  );
}

/* ---------- Los grupos ---------- */

interface PropsTabla {
  datos: NonNullable<ReturnType<typeof useIntegrantes>["datos"]>;
  cargando: boolean; onRecargar: () => Promise<void>; tabs: React.ReactNode; pagina: string; onPagina: (p: number) => void;
}

function TablaGrupos({ datos, cargando, onRecargar, tabs, pagina, onPagina }: PropsTabla) {
  const e = useEstado();
  const toast = useToast();
  const escribir = useEscribirURL();
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const cols = useColumnas("grupos-wpp", DEFS_GRUPOS, TODAS_GRUPOS);
  const webinars = useMemo(() => e.webinars.map((w) => ({ id: w.id, titulo: w.titulo, fecha: w.fecha })), [e.webinars]);
  const todas = useMemo(() => filasDeGrupos(datos.grupos, datos.miembros, webinars), [datos, webinars]);
  const buscadas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? todas.filter((f) => f.nombre.toLowerCase().includes(t) || f.webinar.toLowerCase().includes(t)) : todas;
  }, [todas, q]);
  const x = useFiltrosExcel(COLUMNAS_GRUPOS, buscadas, ORDEN_GRUPOS_POR_DEFECTO);
  const tot = useMemo(() => totalesDeGrupos(x.ordenadas), [x.ordenadas]);
  const sinWebinar = x.filtros.webinar?.modo === "solo" && x.filtros.webinar.valores.length === 1 && x.filtros.webinar.valores[0] === SIN_WEBINAR;
  const conWebinar = x.filtros.webinar?.modo === "sin" && x.filtros.webinar.valores.length === 1 && x.filtros.webinar.valores[0] === SIN_WEBINAR;
  const hayAlgo = x.conFiltro.length > 0 || Boolean(q);

  const celdas: Record<string, { celda: (f: FilaGrupo) => React.ReactNode; tipo?: Columna<FilaGrupo>["tipo"]; pie: React.ReactNode }> = {
    nombre: { celda: (f) => <span className="t-strong truncate gw-celda" title={f.nombre}>{f.nombre}</span>, tipo: "primary", pie: <Pie etiqueta="Grupos" valor={num(tot.grupos)} /> },
    webinar: {
      celda: (f) => (f.webinarId ? <span className="truncate gw-celda" title={f.webinar}>{f.webinar}</span> : <Badge variante="warning">{SIN_WEBINAR}</Badge>),
      pie: <Pie etiqueta="Webinars" valor={num(tot.webinars)} sub={tot.sinWebinar ? `${num(tot.sinWebinar)} grupos sin webinar` : undefined} />,
    },
    dentro: { celda: (f) => num(f.dentro), tipo: "num", pie: <Pie etiqueta="Hay" valor={num(tot.dentro)} /> },
    entraron: { celda: (f) => num(f.entraron), tipo: "num", pie: <Pie etiqueta="Entraron" valor={num(tot.entraron)} /> },
    salieron: { celda: (f) => num(f.salieron), tipo: "num", pie: <Pie etiqueta="Salieron" valor={num(tot.salieron)} /> },
    retencion: {
      celda: (f) => (f.retencion === null ? <span className="t-subtle">—</span> : <Badge variante={colorRetencion(f.retencion)}>{pct(f.retencion, 0)}</Badge>),
      tipo: "num", pie: <Pie etiqueta="Retención" valor={tot.retencion === null ? "—" : pct(tot.retencion, 0)} />,
    },
    sinTelefono: { celda: (f) => num(f.sinTelefono), tipo: "num", pie: <Pie etiqueta="Ocultos" valor={num(tot.sinTelefono)} /> },
    ultima: { celda: (f) => (f.ultimaFoto ? relativo(f.ultimaFoto) : "—"), pie: <span /> },
  };
  const columnas: Columna<FilaGrupo>[] = cols.visibles.map((k) => ({
    clave: k, titulo: COLUMNAS_GRUPOS[k].titulo, tipo: celdas[k].tipo, celda: celdas[k].celda, pie: celdas[k].pie,
    encabezado: <EncabezadoExcel defs={COLUMNAS_GRUPOS} clave={k} base={buscadas} filtros={x.filtros} ordenes={x.ordenes} onFiltro={x.cambiarFiltro} onOrdenar={x.ordenar} />,
  }));

  function bajar() {
    bajarCsv(`grupos-whatsapp-${new Date().toISOString().slice(0, 10)}`, csvDeGrupos(x.ordenadas));
    toast(`Se bajó el CSV con ${num(x.ordenadas.length)} ${x.ordenadas.length === 1 ? "grupo" : "grupos"}.`);
  }
  const verIntegrantes = (f: FilaGrupo) => escribir({ seccion: "integrantes", ...filtroAURL("grupo", { modo: "solo", valores: [f.nombre] }), orden: null, pag: null });

  return (
    <>
      <div className="crm-t__barra">
        <VistasGuardadas pantalla="grupos-wpp" todas="Todos los grupos" extra={{ "cols-grupos-wpp": aLista(cols.visibles.filter((k) => k !== "nombre")) }} />
        <div className="crm-t__buscar">
          <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar un grupo o un webinar" aria-label="Buscar grupos" />
        </div>
        <div className="crm-t__acciones">
          {tabs}
          <ConfigColumnas todas={DEFS_GRUPOS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} compacto />
          <Button sm variante="ghost" icono={<RefreshCw size={15} />} aria-label="Actualizar" cargando={cargando} onClick={() => void onRecargar()} title="Volver a leer los grupos" />
          <CopiarLink />
          <Button sm variante="secondary" icono={<Download size={15} />} onClick={bajar} disabled={x.ordenadas.length === 0} title="Baja un CSV con los grupos que se ven">Descargar CSV</Button>
        </div>
      </div>
      <PastillasExcel
        defs={COLUMNAS_GRUPOS} filtros={x.filtros} conFiltro={x.conFiltro} ordenes={x.ordenes} ordenDeSiempre={x.ordenDeSiempre} ordenPorDefecto={ORDEN_GRUPOS_POR_DEFECTO}
        onFiltro={x.cambiarFiltro} onOrdenar={x.ordenar} hayAlgo={hayAlgo} onLimpiar={() => { setQ(""); x.limpiarFiltros(); }}
      >
        <Chip activo={conWebinar} count={todas.filter((f) => f.webinarId).length} onClick={() => x.cambiarFiltro("webinar", conWebinar ? null : { modo: "sin", valores: [SIN_WEBINAR] })}>Con webinar</Chip>
        <Chip activo={sinWebinar} count={todas.filter((f) => !f.webinarId).length} onClick={() => x.cambiarFiltro("webinar", sinWebinar ? null : { modo: "solo", valores: [SIN_WEBINAR] })}>Sin webinar</Chip>
        <span className="t-sm t-subtle t-num crm-t__cuenta">
          {num(x.ordenadas.length)}{x.ordenadas.length !== todas.length ? ` de ${num(todas.length)}` : ""} {todas.length === 1 ? "grupo" : "grupos"}
        </span>
      </PastillasExcel>
      <DataTable
        filas={x.ordenadas} columnas={columnas} porPagina={50} alto={720}
        pagina={paginaDeURL(pagina) - 1} onPagina={onPagina}
        onFila={verIntegrantes} etiquetaFila={(f) => `Ver los integrantes de ${f.nombre}`}
        vacio={<Empty icono={<Search size={22} />} titulo="Ningún grupo coincide" texto="Probá sacando algún filtro." accion={<Button onClick={() => { setQ(""); x.limpiarFiltros(); }}>Limpiar todo</Button>} />}
      />
      <p className="t-sm t-subtle gw-nota">
        <strong>Integrantes</strong>: los que están hoy. <strong>Entraron</strong>: los que están más los que salieron. <strong>Retención</strong>: los que siguen adentro sobre los que entraron.
        Sólo cuenta desde que el lector mira cada grupo, y <strong>Sin teléfono</strong> son integrantes que WhatsApp muestra sin número: no se pueden listar.
      </p>
    </>
  );
}

/* ---------- Los integrantes ---------- */

function TablaIntegrantes({ datos, cargando, onRecargar, tabs, pagina, onPagina }: PropsTabla) {
  const e = useEstado();
  const toast = useToast();
  const params = useSearchParams();
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const cols = useColumnas("grupos-wpp-integrantes", DEFS_INTEGRANTES, TODAS_INTEGRANTES);
  const webinars = useMemo(() => e.webinars.map((w) => ({ id: w.id, titulo: w.titulo, fecha: w.fecha })), [e.webinars]);

  /* El nombre de cada persona sale de los registros de Formularios del webinar del grupo: se piden cuando se mira un solo grupo. */
  const grupoElegido = useMemo(() => {
    const f = filtrosDeURL(COLUMNAS_INTEGRANTES, new URLSearchParams(params.toString())).grupo;
    return f?.modo === "solo" && f.valores.length === 1 ? f.valores[0] : null;
  }, [params]);
  const diaDelGrupo = useMemo(() => {
    const ids = new Set(datos.grupos.filter((g) => g.nombre === grupoElegido && g.webinarId).map((g) => g.webinarId));
    if (ids.size !== 1) return null;
    const w = e.webinars.find((x) => x.id === [...ids][0]);
    return w ? diaArgentina(w.fecha) : null;
  }, [grupoElegido, datos.grupos, e.webinars]);
  useEffect(() => { if (diaDelGrupo) void cargarRegistros(diaDelGrupo); }, [diaDelGrupo]);
  const registros = useRegistrosNube().registros;
  const personas = useMemo(
    () => (diaDelGrupo ? personasPorTelefono(registros.filter((r) => r.fechaWebinar === diaDelGrupo)) : new Map<string, string>()),
    [registros, diaDelGrupo],
  );

  const todas = useMemo(() => filasDeIntegrantes(datos.miembros, datos.grupos, webinars, personas), [datos, webinars, personas]);
  const buscadas = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^\+/, "");
    return t ? todas.filter((f) => f.telefono.includes(t.replace(/\D/g, "") || "\u0000") || f.persona.toLowerCase().includes(t) || f.grupo.toLowerCase().includes(t)) : todas;
  }, [todas, q]);
  const x = useFiltrosExcel(COLUMNAS_INTEGRANTES, buscadas, ORDEN_INTEGRANTES_POR_DEFECTO);
  const tot = useMemo(() => totalesDeIntegrantes(x.ordenadas), [x.ordenadas]);
  const dentro = x.filtros.estado?.modo === "solo" && x.filtros.estado.valores.length === 1 && x.filtros.estado.valores[0] === "Dentro";
  const salieron = x.filtros.estado?.modo === "solo" && x.filtros.estado.valores.length === 1 && x.filtros.estado.valores[0] === "Salió";
  const hayAlgo = x.conFiltro.length > 0 || Boolean(q);

  const celdas: Record<string, { celda: (f: FilaIntegrante) => React.ReactNode; tipo?: Columna<FilaIntegrante>["tipo"]; pie: React.ReactNode }> = {
    telefono: { celda: (f) => <span className="t-num">{telefonoDeClave(f.telefono)}</span>, tipo: "primary", pie: <Pie etiqueta="Integrantes" valor={num(tot.total)} /> },
    persona: { celda: (f) => (f.persona ? f.persona : <span className="t-subtle">—</span>), pie: <Pie etiqueta="Con nombre" valor={num(tot.conNombre)} /> },
    grupo: { celda: (f) => <span className="truncate gw-celda" title={f.grupo}>{f.grupo}</span>, pie: <Pie etiqueta="Grupos" valor={num(tot.grupos)} /> },
    webinar: { celda: (f) => (f.webinar === SIN_WEBINAR ? <span className="t-subtle">{SIN_WEBINAR}</span> : <span className="truncate gw-celda" title={f.webinar}>{f.webinar}</span>), pie: <span /> },
    estado: {
      celda: (f) => <Badge variante={f.estado === "Dentro" ? "success" : "neutral"}>{f.estado}</Badge>,
      pie: <Pie etiqueta="Dentro" valor={num(tot.dentro)} sub={`${num(tot.salieron)} salieron`} />,
    },
    entro: { celda: (f) => (f.entro ? fecha(f.entro) : <span className="t-subtle">{f.estado === "Dentro" ? "Ya estaba" : "—"}</span>), pie: <span /> },
    salio: { celda: (f) => (f.salio ? fecha(f.salio) : <span className="t-subtle">—</span>), pie: <span /> },
  };
  const columnas: Columna<FilaIntegrante>[] = cols.visibles.map((k) => ({
    clave: k, titulo: COLUMNAS_INTEGRANTES[k].titulo, tipo: celdas[k].tipo, celda: celdas[k].celda, pie: celdas[k].pie,
    encabezado: <EncabezadoExcel defs={COLUMNAS_INTEGRANTES} clave={k} base={buscadas} filtros={x.filtros} ordenes={x.ordenes} onFiltro={x.cambiarFiltro} onOrdenar={x.ordenar} />,
  }));

  function bajar() {
    bajarCsv(`integrantes-whatsapp-${new Date().toISOString().slice(0, 10)}`, csvDeIntegrantes(x.ordenadas));
    toast(`Se bajó el CSV con ${num(x.ordenadas.length)} ${x.ordenadas.length === 1 ? "integrante" : "integrantes"}.`);
  }

  return (
    <>
      <div className="crm-t__barra">
        <VistasGuardadas pantalla="grupos-wpp" todas="Todos los grupos" extra={{ "cols-grupos-wpp-integrantes": aLista(cols.visibles.filter((k) => k !== "telefono")) }} />
        <div className="crm-t__buscar">
          <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por teléfono, nombre o grupo" aria-label="Buscar integrantes" />
        </div>
        <div className="crm-t__acciones">
          {tabs}
          <ConfigColumnas todas={DEFS_INTEGRANTES} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} compacto />
          <Button sm variante="ghost" icono={<RefreshCw size={15} />} aria-label="Actualizar" cargando={cargando} onClick={() => void onRecargar()} title="Volver a leer los grupos" />
          <CopiarLink />
          <Button sm variante="secondary" icono={<Download size={15} />} onClick={bajar} disabled={x.ordenadas.length === 0} title="Baja un CSV con los integrantes que se ven">Descargar CSV</Button>
        </div>
      </div>
      <PastillasExcel
        defs={COLUMNAS_INTEGRANTES} filtros={x.filtros} conFiltro={x.conFiltro} ordenes={x.ordenes} ordenDeSiempre={x.ordenDeSiempre} ordenPorDefecto={ORDEN_INTEGRANTES_POR_DEFECTO}
        onFiltro={x.cambiarFiltro} onOrdenar={x.ordenar} hayAlgo={hayAlgo} onLimpiar={() => { setQ(""); x.limpiarFiltros(); }}
      >
        <Chip activo={dentro} count={todas.filter((f) => f.estado === "Dentro").length} onClick={() => x.cambiarFiltro("estado", dentro ? null : { modo: "solo", valores: ["Dentro"] })}>Dentro</Chip>
        <Chip activo={salieron} count={todas.filter((f) => f.estado === "Salió").length} onClick={() => x.cambiarFiltro("estado", salieron ? null : { modo: "solo", valores: ["Salió"] })}>Salieron</Chip>
        <span className="t-sm t-subtle t-num crm-t__cuenta">
          {num(x.ordenadas.length)}{x.ordenadas.length !== todas.length ? ` de ${num(todas.length)}` : ""} {todas.length === 1 ? "integrante" : "integrantes"}
          {!grupoElegido ? " · elegí un grupo para ver el nombre de cada persona" : !diaDelGrupo ? " · este grupo no tiene webinar atado: sin nombres" : ""}
        </span>
      </PastillasExcel>
      <DataTable
        filas={x.ordenadas} columnas={columnas} porPagina={50} alto={720}
        pagina={paginaDeURL(pagina) - 1} onPagina={onPagina}
        vacio={<Empty icono={<Search size={22} />} titulo="Nadie coincide" texto="Probá sacando algún filtro." accion={<Button onClick={() => { setQ(""); x.limpiarFiltros(); }}>Limpiar todo</Button>} />}
      />
    </>
  );
}
