"use client";

import React, { useMemo, useState } from "react";
import { CheckCheck, Clock, PhoneCall, PhoneMissed, Quote, Search, Settings2, UserX } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Field, Input, Select, Switch, Tag } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm } from "@/components/ui/Modal";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { CopiarLink } from "@/components/ui/Filtros";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { FormTestimonio, TONO_TESTIMONIO } from "@/components/alumnos/Testimonios";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn, puedeEditar } from "@/lib/permisos";
import { ordenAURL, paginaDeURL, useBusquedaURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import {
  aContactarHoy, aplicarCadencia, aplicarContacto, aplicarCorreccion, aplicarDejoDeContestar, aplicarNoContesto,
  configSeguimiento, ESTADOS_TESTIMONIO, filasDeSeguimiento, filtrarSeguimiento, formatoDia, hoyDelNegocio,
  paisesDeSeguimiento, resumenDeSeguimiento, TEXTO_TESTIMONIO, textoDeAtraso,
  type FilaSeguimiento, type FiltrosSeguimiento, type SiNo, type SituacionSeguimiento,
} from "@/lib/seguimiento";
import type { ConfigSeguimiento, EstadoTestimonio, SeguimientoAlumno } from "@/lib/types";

/* ==================================================================
   Customer Success: el seguimiento de los alumnos (F2-09).

   Dos vistas de la misma cuenta (lib/seguimiento.ts):
   - Seguimiento: la lista general, con país, experiencia, tecnologías,
     cadencia, último y próximo contacto, «dejó de contestar», CV y LinkedIn
     corregidos y testimonio, con filtros que viajan en el link.
   - A contactar hoy: sólo a quienes ya les toca, lo más vencido arriba, con
     «Lo contacté» y «No contestó» a un clic (y «Deshacer» por si fue sin querer).
   ================================================================== */

/* ---------- los gestos, para las dos vistas ---------- */

function useGestos() {
  const toast = useToast();
  const hoy = hoyDelNegocio();

  /* Una acción que cambia el seguimiento y ofrece deshacerla. */
  function hacer(f: FilaSeguimiento, cambio: (s: SeguimientoAlumno, quien: string) => SeguimientoAlumno,
    detalle: (s: SeguimientoAlumno) => string, aviso: (s: SeguimientoAlumno) => string) {
    let despues: SeguimientoAlumno | null = null;
    const antes = acciones.guardarSeguimiento(f.id, (s, quien) => (despues = cambio(s, quien)), (s) => detalle(s));
    if (!antes || !despues) return;
    toast(aviso(despues), "ok", {
      texto: "Deshacer",
      onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el último cambio del seguimiento de ${f.alumno.nombre}.`),
    });
  }

  return {
    contacte: (f: FilaSeguimiento) => hacer(
      f, (s, q) => aplicarContacto(s, hoy, q),
      (s) => `Se lo contactó. Próximo contacto: ${formatoDia(s.proximoContacto)} (cada ${s.cadenciaDias} días).`,
      (s) => `Listo: contactaste a ${f.alumno.nombre}. Le toca de nuevo el ${formatoDia(s.proximoContacto)}.`,
    ),
    noContesto: (f: FilaSeguimiento, cfg: ConfigSeguimiento) => hacer(
      f, (s, q) => aplicarNoContesto(s, hoy, cfg, q),
      (s) => `No contestó (intento ${s.intentosSinRespuesta}). Se vuelve a probar el ${formatoDia(s.proximoContacto)}.`,
      (s) => `${f.alumno.nombre} no contestó. Se vuelve a probar el ${formatoDia(s.proximoContacto)}.`,
    ),
    dejoDeContestar: (f: FilaSeguimiento, dejo: boolean) => hacer(
      f, (s, q) => aplicarDejoDeContestar(s, dejo, q),
      () => (dejo ? "Se lo marcó como «dejó de contestar»." : "Se lo sacó de «dejó de contestar»."),
      () => (dejo ? `${f.alumno.nombre} sale de la lista de hoy: dejó de contestar.` : `${f.alumno.nombre} vuelve al seguimiento.`),
    ),
    cadencia: (f: FilaSeguimiento, dias: number) => hacer(
      f, (s, q) => aplicarCadencia(s, dias, f.alumno, q),
      (s) => `Cadencia: cada ${dias} días. Próximo contacto: ${formatoDia(s.proximoContacto)}.`,
      (s) => `${f.alumno.nombre}: cada ${dias} días. Le toca el ${formatoDia(s.proximoContacto)}.`,
    ),
    correccion: (f: FilaSeguimiento, que: "cv" | "linkedin", corregido: boolean) => hacer(
      f, (s, q) => aplicarCorreccion(s, que, corregido, hoy, q),
      () => `${que === "cv" ? "CV" : "LinkedIn"} ${corregido ? "corregido" : "marcado como pendiente"}.`,
      () => `${f.alumno.nombre}: ${que === "cv" ? "CV" : "LinkedIn"} ${corregido ? "corregido" : "pendiente"}.`,
    ),
  };
}

/* Un control adentro de una fila que se abre con un clic: que usarlo no abra la ficha. */
function Quieto({ children }: { children: React.ReactNode }) {
  return (
    <span className="cs-quieto" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
      {children}
    </span>
  );
}

const SITUACION: Record<SituacionSeguimiento, { texto: string; ayuda: string }> = {
  vencido: { texto: "Vencidos", ayuda: "Ya pasó el día en que les tocaba el contacto" },
  hoy: { texto: "Hoy", ayuda: "Les toca el contacto hoy" },
  "al-dia": { texto: "Al día", ayuda: "Todavía no les toca" },
  "no-contesta": { texto: "Dejaron de contestar", ayuda: "Los marcaste como «dejó de contestar»: no entran en la lista de hoy" },
  fuera: { texto: "Fuera del programa", ayuda: "Pausados, egresados o dados de baja" },
};

/* Cómo se calcula el próximo contacto: lo muestra el ícono de la columna. */
const INFO_PROXIMO = {
  ayuda: "El día en que le toca el próximo contacto. Después de cada «Lo contacté», es hoy más la cadencia del alumno (7, 15 o 20 días). Si «no contestó», se vuelve a probar a los pocos días. Si nunca se lo contactó, se cuenta desde que entró al programa.",
  formula: "Último contacto (o día de ingreso) + cadencia en días",
  ejemplo: "Lo contactaste el 1 de octubre y su cadencia es de 15 días: le toca el 16 de octubre.",
};

function BadgeToca({ f }: { f: FilaSeguimiento }) {
  if (f.situacion === "fuera") return <span className="t-sm t-subtle">—</span>;
  if (f.situacion === "no-contesta") return <Badge variante="neutral" icono={<UserX size={13} />}>Dejó de contestar</Badge>;
  const variante = f.situacion === "vencido" ? (f.atraso >= 7 ? "danger" : "warning") : f.situacion === "hoy" ? "info" : "success";
  return <Badge variante={variante} icono={<Clock size={13} />}>{textoDeAtraso(f.atraso)}</Badge>;
}

/* ---------- A contactar hoy ---------- */

export function ContactarHoy() {
  const e = useEstado();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const gestos = useGestos();
  const puede = puedeEditar(acceso, "seguimiento_alumnos");
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const filas = useMemo(() => filasDeSeguimiento(e, hoy), [e, hoy]);
  const lista = useMemo(() => aContactarHoy(filas), [filas]);
  const vencidos = lista.filter((f) => f.situacion === "vencido").length;
  const tabla = useTablaURL("hoy", null, ["alumno", "toca", "ultimo"]);

  const columnas: Columna<FilaSeguimiento>[] = [
    {
      clave: "alumno", titulo: "Alumno", tipo: "primary", orden: (f) => f.alumno.nombre,
      celda: (f) => (
        <span className="stack-1">
          <span className="t-strong">{f.alumno.nombre}</span>
          <span className="t-sm t-subtle">{[f.pais, f.tecnologias].filter(Boolean).join(" · ") || f.alumno.email || "Sin datos de la persona"}</span>
        </span>
      ),
    },
    {
      clave: "toca", titulo: "Le tocaba", orden: (f) => -f.atraso, info: INFO_PROXIMO,
      celda: (f) => (
        <span className="stack-1">
          <BadgeToca f={f} />
          <span className="t-sm t-subtle">{formatoDia(f.proximoContacto)}</span>
        </span>
      ),
    },
    {
      clave: "ultimo", titulo: "Último contacto", orden: (f) => f.ultimoContacto ?? "",
      celda: (f) => (
        <span className="stack-1">
          <span>{f.ultimoContacto ? formatoDia(f.ultimoContacto) : "Nunca"}</span>
          <span className="t-sm t-subtle">Cada {f.cadenciaDias} días</span>
        </span>
      ),
    },
    {
      clave: "intentos", titulo: "Sin respuesta",
      celda: (f) => f.intentosSinRespuesta === 0
        ? <span className="t-subtle">—</span>
        : <Badge variante={f.sugerirDejoDeContestar ? "danger" : "warning"}>{f.intentosSinRespuesta} {f.intentosSinRespuesta === 1 ? "intento" : "intentos"}</Badge>,
      info: {
        ayuda: "Cuántas veces seguidas intentaste contactarlo y no contestó. Se pone en cero cuando lo contactás. Con el máximo de intentos (se ajusta) se sugiere marcarlo como «dejó de contestar».",
        formula: `Intentos sin respuesta desde el último contacto logrado (se sugiere con ${cfg.intentosHastaDejar})`,
      },
    },
  ];

  return (
    <div className="stack-4">
      <Card>
        <div className="row-wrap" style={{ gap: "var(--space-3)", alignItems: "center" }}>
          <PhoneCall size={20} aria-hidden />
          <div className="stack-1" style={{ flex: 1, minWidth: 220 }}>
            <span className="t-strong">
              {lista.length === 0 ? "Hoy no hay a quién contactar" : `${lista.length} ${lista.length === 1 ? "alumno" : "alumnos"} para contactar`}
              <InfoMetrica
                className="info-inline"
                titulo="A quién contactar hoy"
                ayuda="Los alumnos activos a los que ya les toca el contacto de seguimiento, según su cadencia. Los que dejaron de contestar no aparecen. Lo más vencido va arriba."
                formula="Alumnos activos cuyo próximo contacto es hoy o ya pasó"
                componentes={() => [
                  { concepto: "Vencidos", valor: String(vencidos), signo: "+", nota: "ya pasó su día" },
                  { concepto: "Les toca hoy", valor: String(lista.length - vencidos), signo: "+" },
                  { concepto: "Para contactar", valor: String(lista.length), signo: "=" },
                ]}
              />
            </span>
            <span className="t-sm t-subtle">
              {lista.length === 0
                ? "Todos están al día con su cadencia."
                : `${vencidos} ya vencidos y ${lista.length - vencidos} que tocan hoy. Cuando lo contactás, el próximo toca según su cadencia.`}
            </span>
          </div>
          <CopiarLink />
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <DataTable
          filas={lista} columnas={columnas} alto={640} porPagina={50}
          orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina}
          onFila={(f) => abrirFicha(f.id, "servicio")} etiquetaFila={(f) => `Ver la ficha de ${f.alumno.nombre}`}
          acciones={puede ? (f) => (
            <span className="row" style={{ gap: 6 }}>
              <Button sm variante="primary" icono={<PhoneCall size={14} />} onClick={() => gestos.contacte(f)} title="Lo contacté hoy: el próximo toca según su cadencia">
                Lo contacté
              </Button>
              <Button sm variante="secondary" icono={<PhoneMissed size={14} />} onClick={() => gestos.noContesto(f, cfg)} title="Lo intenté y no contestó: se vuelve a probar en unos días">
                No contestó
              </Button>
              {f.sugerirDejoDeContestar && (
                <Button sm variante="ghost" icono={<UserX size={14} />} onClick={() => gestos.dejoDeContestar(f, true)} title={`Ya van ${f.intentosSinRespuesta} intentos sin respuesta`}>
                  Dejó de contestar
                </Button>
              )}
            </span>
          ) : undefined}
          vacio={(
            <Empty
              icono={<CheckCheck size={22} />} titulo="Al día"
              texto="Hoy no hay alumnos para contactar. Mirá el seguimiento para ver cuándo le toca a cada uno."
            />
          )}
        />
      </Card>
    </div>
  );
}

/* ---------- Seguimiento: la lista general ---------- */

/* Lo que se está mirando vive en la URL (lib/useParamsURL), y se comparte
   con «Copiar link»:
   - sit: vencido, hoy, al-dia o no-contesta (sin valor: los activos y los demás)
   - cv, li: si (corregido) o no (pendiente)
   - cad: 7, 15 o 20 (las cadencias que haya)
   - pais, tes: pedido, grabado, publicado o sin (nunca se le pidió)
   - sq: búsqueda por nombre, mail, país o tecnología
   - orden-seg y pag-seg: el orden y la página */
const VISTA_SEG = { sit: "", cv: "", li: "", cad: "", pais: "", tes: "" };
const COLUMNAS_SEG = ["alumno", "pais", "anios", "cadencia", "ultimo", "proximo", "cv", "linkedin", "testimonio"];

const SITUACIONES: SituacionSeguimiento[] = ["vencido", "hoy", "al-dia", "no-contesta"];
const siNo = (v: string): SiNo => (v === "si" || v === "no" ? v : "");

export function SeguimientoLista() {
  const e = useEstado();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const gestos = useGestos();
  const puede = puedeEditar(acceso, "seguimiento_alumnos");
  const puedeAjustar = nivelEn(acceso, "ajustes") === 2;
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const [v, setV] = useParamsURL(VISTA_SEG);
  const [q, setQ] = useBusquedaURL("sq", ["pag-seg"]);
  const tabla = useTablaURL("seg", { clave: "proximo", desc: false }, COLUMNAS_SEG);
  const [ajustando, setAjustando] = useState(false);
  const [testimonioDe, setTestimonioDe] = useState<string | null>(null);

  const todas = useMemo(() => filasDeSeguimiento(e, hoy), [e, hoy]);
  const resumen = useMemo(() => resumenDeSeguimiento(todas), [todas]);
  const paises = useMemo(() => paisesDeSeguimiento(todas), [todas]);

  const situacion: SituacionSeguimiento | "" = SITUACIONES.includes(v.sit as SituacionSeguimiento) ? (v.sit as SituacionSeguimiento) : "";
  const testimonio = (["sin", ...ESTADOS_TESTIMONIO] as string[]).includes(v.tes) ? (v.tes as FiltrosSeguimiento["testimonio"]) : "";
  const cadencia = cfg.cadencias.includes(Number(v.cad)) ? Number(v.cad) : 0;
  const filtros: FiltrosSeguimiento = { q, situacion, cv: siNo(v.cv), linkedin: siNo(v.li), cadencia, pais: paises.includes(v.pais) ? v.pais : "", testimonio };

  /* Sin elegir una situación, la lista es la de los alumnos que están cursando: los
     pausados, egresados o dados de baja quedan afuera (se los ve con «Todos»). */
  const base = useMemo(() => (situacion ? todas : todas.filter((f) => f.situacion !== "fuera")), [todas, situacion]);
  const filas = useMemo(() => filtrarSeguimiento(base, filtros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, q, situacion, v.cv, v.li, cadencia, filtros.pais, testimonio]);
  const hayFiltros = Boolean(q.trim() || situacion || v.cv || v.li || cadencia || v.pais || testimonio);
  const limpiar = () => { setQ(""); setV({ sit: null, cv: null, li: null, cad: null, pais: null, tes: null }, { sq: null, "pag-seg": null }); };
  const cuentaSit = (s: SituacionSeguimiento) => todas.filter((f) => f.situacion === s).length;

  const columnas: Columna<FilaSeguimiento>[] = [
    {
      clave: "alumno", titulo: "Alumno", tipo: "primary", orden: (f) => f.alumno.nombre,
      celda: (f) => (
        <span className="stack-1">
          <span className="t-strong">{f.alumno.nombre}</span>
          <span className="t-sm t-subtle">{f.alumno.email || "Sin mail"}{f.alumno.estado !== "activo" && <> · <Tag>{f.alumno.estado}</Tag></>}</span>
        </span>
      ),
    },
    {
      clave: "pais", titulo: "País", orden: (f) => f.pais,
      celda: (f) => f.pais || <span className="t-subtle">—</span>,
    },
    {
      clave: "anios", titulo: "Experiencia", tipo: "num", orden: (f) => f.aniosExperiencia ?? -1,
      celda: (f) => (f.aniosExperiencia === undefined ? <span className="t-subtle">—</span> : `${f.aniosExperiencia} ${f.aniosExperiencia === 1 ? "año" : "años"}`),
      info: {
        ayuda: "Los años de experiencia que la persona declaró en el formulario de la llamada de venta. Se lee del contacto: no se carga acá. Si está vacío, nunca lo contestó.",
        formula: "Años de experiencia del contacto (formulario de Calendly)",
      },
    },
    {
      clave: "tecnologias", titulo: "Tecnologías", tipo: "secondary",
      celda: (f) => (f.tecnologias ? <span title={f.tecnologias} className="cs-recorte">{f.tecnologias}</span> : <span className="t-subtle">—</span>),
    },
    {
      clave: "cadencia", titulo: "Cadencia", orden: (f) => f.cadenciaDias,
      celda: (f) => puede && f.alumno.estado === "activo" ? (
        <Quieto><span style={{ minWidth: 120, display: "inline-block" }}>
          <Select
            value={String(f.cadenciaDias)} aria-label={`Cadencia de ${f.alumno.nombre}`}
            opciones={[...new Set([...cfg.cadencias, f.cadenciaDias])].sort((a, b) => a - b).map((d) => ({ valor: String(d), texto: `Cada ${d} días` }))}
            onChange={(ev) => gestos.cadencia(f, Number(ev.target.value))}
          />
        </span></Quieto>
      ) : <span>Cada {f.cadenciaDias} días</span>,
      info: {
        ayuda: "Cada cuántos días hay que contactar a este alumno. Se elige por alumno entre las cadencias que se ajustaron (7, 15 o 20 de entrada). Al cambiarla se recalcula el próximo contacto.",
        formula: "Se elige por alumno; el próximo contacto = último contacto + cadencia",
      },
    },
    {
      clave: "ultimo", titulo: "Último contacto", orden: (f) => f.ultimoContacto ?? "",
      celda: (f) => (f.ultimoContacto ? formatoDia(f.ultimoContacto) : <span className="t-subtle">Nunca</span>),
    },
    {
      clave: "proximo", titulo: "Próximo contacto", orden: (f) => (f.situacion === "fuera" ? "9999" : f.proximoContacto), info: INFO_PROXIMO,
      celda: (f) => (
        <span className="stack-1">
          <BadgeToca f={f} />
          {f.situacion !== "fuera" && <span className="t-sm t-subtle">{formatoDia(f.proximoContacto)}</span>}
          {f.intentosSinRespuesta > 0 && f.situacion !== "no-contesta" && (
            <span className="t-sm t-subtle">{f.intentosSinRespuesta} {f.intentosSinRespuesta === 1 ? "intento" : "intentos"} sin respuesta</span>
          )}
        </span>
      ),
    },
    {
      clave: "cv", titulo: "CV corregido", orden: (f) => Number(f.cvCorregido),
      celda: (f) => (puede
        ? <Quieto><Switch checked={f.cvCorregido} etiqueta={`CV de ${f.alumno.nombre} corregido`} onChange={(c) => gestos.correccion(f, "cv", c)} /></Quieto>
        : <Badge variante={f.cvCorregido ? "success" : "neutral"}>{f.cvCorregido ? "Sí" : "No"}</Badge>),
    },
    {
      clave: "linkedin", titulo: "LinkedIn corregido", orden: (f) => Number(f.linkedinCorregido),
      celda: (f) => (puede
        ? <Quieto><Switch checked={f.linkedinCorregido} etiqueta={`LinkedIn de ${f.alumno.nombre} corregido`} onChange={(c) => gestos.correccion(f, "linkedin", c)} /></Quieto>
        : <Badge variante={f.linkedinCorregido ? "success" : "neutral"}>{f.linkedinCorregido ? "Sí" : "No"}</Badge>),
    },
    {
      clave: "testimonio", titulo: "Testimonio", orden: (f) => (f.testimonio ? ESTADOS_TESTIMONIO.indexOf(f.testimonio.estado) + 1 : 0),
      celda: (f) => f.testimonio
        ? <Badge variante={TONO_TESTIMONIO[f.testimonio.estado]}>{TEXTO_TESTIMONIO[f.testimonio.estado]}</Badge>
        : puede
          ? <Quieto><Button sm variante="ghost" icono={<Quote size={13} />} onClick={() => setTestimonioDe(f.id)}>Pedir</Button></Quieto>
          : <span className="t-subtle">—</span>,
    },
  ];

  return (
    <div className="stack-4">
      <div className="cs-resumen">
        <ResumenCuenta etiqueta="Alumnos en seguimiento" valor={resumen.activos} ayuda="Los alumnos activos (no pausados, egresados ni dados de baja)." formula="Alumnos con estado «activo»" />
        <ResumenCuenta etiqueta="Vencidos" valor={resumen.vencidos} tono={resumen.vencidos > 0 ? "danger" : undefined} ayuda="Activos a los que ya se les pasó el día del próximo contacto." formula="Activos con próximo contacto anterior a hoy" onClick={() => setV({ sit: "vencido" })} />
        <ResumenCuenta etiqueta="CV sin corregir" valor={resumen.sinCv} ayuda="Alumnos activos a los que todavía no se les marcó el CV como corregido." formula="Activos con «CV corregido» en No" onClick={() => setV({ cv: "no", sit: null })} />
        <ResumenCuenta etiqueta="LinkedIn sin corregir" valor={resumen.sinLinkedin} ayuda="Alumnos activos a los que todavía no se les marcó el LinkedIn como corregido." formula="Activos con «LinkedIn corregido» en No" onClick={() => setV({ li: "no", sit: null })} />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }} className="stack-3">
          <div className="toolbar">
            <Input
              icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)}
              placeholder="Buscá por nombre, país o tecnología…" aria-label="Buscar en el seguimiento"
            />
            <Chip activo={situacion === ""} onClick={() => setV({ sit: null })} count={resumen.activos}>Activos</Chip>
            {SITUACIONES.map((s) => (
              <Chip key={s} activo={situacion === s} onClick={() => setV({ sit: s })} count={cuentaSit(s)} title={SITUACION[s].ayuda}>{SITUACION[s].texto}</Chip>
            ))}
            <span className="spacer" />
            <CopiarLink />
            {puedeAjustar && <Button variante="secondary" icono={<Settings2 size={16} />} onClick={() => setAjustando(true)}>Ajustar</Button>}
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <FiltroSelect etiqueta="CV" valor={v.cv} onChange={(x) => setV({ cv: x })} opciones={[{ valor: "si", texto: "Corregido" }, { valor: "no", texto: "Sin corregir" }]} />
            <FiltroSelect etiqueta="LinkedIn" valor={v.li} onChange={(x) => setV({ li: x })} opciones={[{ valor: "si", texto: "Corregido" }, { valor: "no", texto: "Sin corregir" }]} />
            <FiltroSelect etiqueta="Cadencia" valor={cadencia ? String(cadencia) : ""} onChange={(x) => setV({ cad: x })} opciones={cfg.cadencias.map((d) => ({ valor: String(d), texto: `Cada ${d} días` }))} />
            <FiltroSelect etiqueta="País" valor={filtros.pais} onChange={(x) => setV({ pais: x })} opciones={paises.map((p) => ({ valor: p, texto: p }))} />
            <FiltroSelect
              etiqueta="Testimonio" valor={testimonio} onChange={(x) => setV({ tes: x })}
              opciones={[{ valor: "sin", texto: "Sin pedir" }, ...ESTADOS_TESTIMONIO.map((k) => ({ valor: k, texto: TEXTO_TESTIMONIO[k] }))]}
            />
            {hayFiltros && <Button sm variante="ghost" onClick={limpiar}>Limpiar filtros</Button>}
          </div>
        </div>
        <DataTable
          filas={filas} columnas={columnas} alto={620} porPagina={50}
          orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina}
          onFila={(f) => abrirFicha(f.id, "servicio")} etiquetaFila={(f) => `Ver la ficha de ${f.alumno.nombre}`}
          acciones={puede ? (f) => (f.alumno.estado === "activo" ? <AccionesFila f={f} cfg={cfg} gestos={gestos} /> : undefined) : undefined}
          vacio={(
            <Empty
              icono={<CheckCheck size={22} />}
              titulo={hayFiltros ? "Ningún alumno coincide" : "Todavía no hay alumnos en seguimiento"}
              texto={hayFiltros ? "Probá con otros filtros o sacalos." : "Cada venta crea su alumno sola. Cuando haya alumnos activos, acá se ve cuándo le toca el contacto a cada uno."}
              accion={hayFiltros ? <Button variante="secondary" onClick={limpiar}>Limpiar filtros</Button> : undefined}
            />
          )}
        />
      </Card>

      {ajustando && <AjustarSeguimiento cfg={cfg} onCerrar={() => setAjustando(false)} />}
      {testimonioDe && <FormTestimonio alumnoId={testimonioDe} onCerrar={() => setTestimonioDe(null)} />}
    </div>
  );
}

function AccionesFila({ f, cfg, gestos }: { f: FilaSeguimiento; cfg: ConfigSeguimiento; gestos: ReturnType<typeof useGestos> }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <Button sm variante="secondary" icono={<PhoneCall size={14} />} onClick={() => gestos.contacte(f)} title="Lo contacté hoy: el próximo toca según su cadencia">Lo contacté</Button>
      <Button sm variante="ghost" icono={<PhoneMissed size={14} />} onClick={() => gestos.noContesto(f, cfg)} title="No contestó: se vuelve a probar en unos días">No contestó</Button>
      <Button
        sm variante="ghost" icono={<UserX size={14} />} onClick={() => gestos.dejoDeContestar(f, !f.dejoDeContestar)}
        title={f.dejoDeContestar ? "Vuelve al seguimiento y a la lista de hoy" : "Sale de la lista de hoy"}
      >
        {f.dejoDeContestar ? "Volver al seguimiento" : "Dejó de contestar"}
      </Button>
    </span>
  );
}

function FiltroSelect({ etiqueta, valor, onChange, opciones }: {
  etiqueta: string; valor: string; onChange: (v: string | null) => void; opciones: { valor: string; texto: string }[];
}) {
  return (
    <span style={{ minWidth: 150 }}>
      <Select
        value={valor} aria-label={`Filtrar por ${etiqueta}`} placeholder={etiqueta}
        opciones={[{ valor: "", texto: `${etiqueta}: todos` }, ...opciones]}
        onChange={(ev) => onChange(ev.target.value || null)}
      />
    </span>
  );
}

function ResumenCuenta({ etiqueta, valor, tono, ayuda, formula, onClick }: {
  etiqueta: string; valor: number; tono?: "danger"; ayuda: string; formula: string; onClick?: () => void;
}) {
  return (
    <Card
      className="cs-resumen__tarjeta stack-1"
      {...(onClick ? {
        role: "button", tabIndex: 0, onClick,
        onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onClick(); } },
      } : {})}
    >
      <span className="t-sm t-subtle">{etiqueta}<Quieto><InfoMetrica titulo={etiqueta} ayuda={ayuda} formula={formula} /></Quieto></span>
      <span className={`cs-resumen__valor${tono === "danger" && valor > 0 ? " cs-resumen__valor--alerta" : ""}`}>{valor}</span>
    </Card>
  );
}

/* Las cadencias que se pueden elegir, los días de reintento y los intentos hasta «dejó de contestar». */
function AjustarSeguimiento({ cfg, onCerrar }: { cfg: ConfigSeguimiento; onCerrar: () => void }) {
  const toast = useToast();
  const [cadencias, setCadencias] = useState(cfg.cadencias.join(", "));
  const [porDefecto, setPorDefecto] = useState(String(cfg.cadenciaPorDefecto));
  const [reintento, setReintento] = useState(String(cfg.reintentoDias));
  const [intentos, setIntentos] = useState(String(cfg.intentosHastaDejar));
  const nueva = configSeguimiento({
    cadencias: cadencias.split(/[,\s]+/).filter(Boolean).map(Number),
    cadenciaPorDefecto: Number(porDefecto), reintentoDias: Number(reintento), intentosHastaDejar: Number(intentos),
  });
  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo="Ajustar el seguimiento"
      sub="Las cadencias que se pueden elegir por alumno y qué hacer cuando no contesta. Cambia lo que viene: no mueve lo ya cargado."
      onGuardar={() => { acciones.configurarSeguimiento(nueva); toast("Seguimiento ajustado."); onCerrar(); }}
    >
      <div className="form-grid">
        <Field label="Cadencias (en días)" ayuda="Separadas por coma. De entrada: 7, 15 y 20." span2>
          <Input value={cadencias} onChange={(ev) => setCadencias(ev.target.value)} placeholder="7, 15, 20" />
        </Field>
        <Field label="Cadencia de arranque" ayuda="La que tiene un alumno al que todavía no se le eligió una.">
          <Input type="number" min={1} value={porDefecto} onChange={(ev) => setPorDefecto(ev.target.value)} />
        </Field>
        <Field label="Si no contestó, probar de nuevo en (días)">
          <Input type="number" min={1} value={reintento} onChange={(ev) => setReintento(ev.target.value)} />
        </Field>
        <Field label="Intentos sin respuesta para sugerir «dejó de contestar»" span2>
          <Input type="number" min={1} value={intentos} onChange={(ev) => setIntentos(ev.target.value)} />
        </Field>
      </div>
      <p className="t-sm t-subtle" style={{ margin: 0 }}>
        Quedan así: cadencias {nueva.cadencias.join(", ")} · arranque cada {nueva.cadenciaPorDefecto} · reintento a los {nueva.reintentoDias} días · sugerir con {nueva.intentosHastaDejar} intentos.
      </p>
    </ModalForm>
  );
}
