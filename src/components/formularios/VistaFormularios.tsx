"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, FileSpreadsheet, MessageCircle, RefreshCw, Search, Users } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, Chip, Empty, Input, StatCard, Tabs, Tag, Textarea } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, type DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { CopiarLink, Filtro, type OpcionFiltro } from "@/components/ui/Filtros";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { diaCorto, diaYHora } from "@/components/webinars/fechas";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { useBusquedaURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import { num, pct } from "@/lib/format";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { digitosWhatsapp, normalizarTelefono, telefonoLegible } from "@/lib/telefonos";
import {
  contarRegistros, filtrarRegistros, isoDePais, UTMS_FORM, type FiltroMarca, type RegistroForm,
} from "@/lib/registros-webinar";
import { cambiarRegistro, cargarRegistros, cargarResumen, useRegistrosNube } from "@/lib/registros-nube";
import { ImportarFormularios } from "./ImportarFormularios";
import { CruceFormularios } from "./CruceFormularios";

/* ==================================================================
   Formularios: quién se anotó a cada webinar y qué pasó con cada uno.

   Es la hoja del Excel de Yari, pero en la app: una fila por persona y por
   webinar, con las tres marcas que el equipo llevaba a mano (unido al grupo
   de WhatsApp, no unido, contactado), el teléfono para copiar o abrir en
   WhatsApp de un clic, y los filtros que viajan en el link. Los registros
   nuevos entran solos desde la landing (/api/webinar/registro) y los viejos
   se traen con «Importar del Excel».
   ================================================================== */

const MARCAS: { valor: FiltroMarca; texto: string; ayuda: string }[] = [
  { valor: "", texto: "Todos", ayuda: "Todos los registros del webinar" },
  { valor: "unido", texto: "Unidos", ayuda: "Ya están en el grupo de WhatsApp" },
  { valor: "no-unido", texto: "No unidos", ayuda: "Se revisó y todavía no entraron al grupo" },
  { valor: "sin-revisar", texto: "Sin revisar", ayuda: "Todavía nadie miró si entraron al grupo" },
  { valor: "contactado", texto: "Contactados", ayuda: "Ya se les escribió" },
  { valor: "sin-contactar", texto: "Sin contactar", ayuda: "Todavía nadie les escribió" },
];

const COLUMNAS: DefColumna[] = [
  { clave: "nombre", titulo: "Persona", fija: true },
  { clave: "registro", titulo: "Se anotó", grupo: "Formulario", ayuda: "Cuándo completó el formulario." },
  { clave: "email", titulo: "Email", grupo: "Formulario" },
  { clave: "telefono", titulo: "Teléfono", grupo: "Formulario", ayuda: "Con botones para copiarlo y abrir WhatsApp." },
  { clave: "pais", titulo: "País", grupo: "Formulario" },
  { clave: "respuestas", titulo: "Respuestas", grupo: "Formulario", ayuda: "Lo que contestó en el formulario." },
  { clave: "grupo", titulo: "Grupo de WhatsApp", grupo: "Seguimiento", ayuda: "Unido o no unido: se marca con un clic." },
  { clave: "contactado", titulo: "Contactado", grupo: "Seguimiento", ayuda: "Si ya se le escribió, quién y cuándo." },
  { clave: "anuncio", titulo: "Anuncio", grupo: "Origen", ayuda: "El anuncio del que vino, según utm_content." },
  { clave: "utm", titulo: "UTMs", grupo: "Origen" },
  { clave: "agenda", titulo: "Agenda", grupo: "Origen", ayuda: "Si ya se unió con una persona que agendó en Calendly." },
  { clave: "origen", titulo: "Origen del dato", grupo: "Origen", ayuda: "La landing, o la hoja del Excel de la que se importó." },
];
const POR_DEFECTO = ["nombre", "registro", "telefono", "pais", "grupo", "contactado", "anuncio", "respuestas"];

const fechaLinda = (iso: string) => iso.split("-").reverse().join("/");

export function VistaFormularios() {
  const e = useEstado();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const { nombre: quien } = useUsuarioActual();
  const { acceso } = useAcceso();
  const puedeEditar = nivelEn(acceso, "webinars") === 2;
  const datos = useRegistrosNube();
  const [v, cambiar] = useParamsURL({ webinar: "", marca: "", seccion: "registros" });
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const cols = useColumnas("formularios", COLUMNAS, POR_DEFECTO);
  const [importando, setImportando] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);

  useEffect(() => { void cargarResumen(); }, []);

  /* Los webinars: los de la app (aunque todavía no tengan registros) y las
     fechas que sólo existen en los registros (hojas viejas del Excel). */
  const opciones = useMemo(() => {
    const m = new Map<string, { clave: string; texto: string; cuenta: number }>();
    for (const w of e.webinars) {
      const dia = diaArgentina(w.fecha);
      m.set(dia, { clave: dia, texto: `${fechaLinda(dia)} · ${w.titulo}`, cuenta: 0 });
    }
    for (const r of datos.resumen) {
      const k = r.fechaWebinar ?? "sin";
      const ya = m.get(k);
      if (ya) ya.cuenta = r.registros;
      else m.set(k, { clave: k, texto: k === "sin" ? "Sin fecha de webinar" : `${fechaLinda(k)} · sin webinar cargado`, cuenta: r.registros });
    }
    return [...m.values()].sort((a, b) => (a.clave === "sin" ? 1 : b.clave === "sin" ? -1 : b.clave.localeCompare(a.clave)));
  }, [e.webinars, datos.resumen]);

  /* Un link viejo con el id del webinar vale como su fecha. */
  const deLink = useMemo(() => {
    const w = e.webinars.find((x) => x.id === v.webinar);
    return w ? diaArgentina(w.fecha) : v.webinar;
  }, [e.webinars, v.webinar]);
  /* Sin elegir, el último webinar que ya tiene registros. */
  const ultimo = datos.resumen.find((r) => r.fechaWebinar)?.fechaWebinar ?? "";
  const sel = deLink || ultimo;
  useEffect(() => { if (!v.webinar && ultimo) cambiar({ webinar: ultimo }); }, [v.webinar, ultimo, cambiar]);
  useEffect(() => { if (sel) void cargarRegistros(sel); }, [sel]);

  const deEsteWebinar = useMemo(
    () => filtrarRegistros(datos.registros, { webinar: sel === "todos" ? "" : sel, marca: "", q: "" })
      .sort((a, b) => +new Date(b.registradoEn) - +new Date(a.registradoEn)),
    [datos.registros, sel],
  );
  const cuenta = useMemo(() => contarRegistros(deEsteWebinar), [deEsteWebinar]);
  const filas = useMemo(
    () => filtrarRegistros(deEsteWebinar, { webinar: "", marca: v.marca as FiltroMarca, q }),
    [deEsteWebinar, v.marca, q],
  );
  const cargandoEste = datos.estado === "cargando" && deEsteWebinar.length === 0;

  async function marcar(r: RegistroForm, cambios: Partial<RegistroForm>, quitar: (keyof RegistroForm)[] = []) {
    const res = await cambiarRegistro(r.id, cambios, quitar);
    if (!res.ok) toast(res.error ?? "No se pudo guardar.", "err");
  }
  const ponerGrupo = (r: RegistroForm, g: "unido" | "no-unido") =>
    r.grupo === g
      ? marcar(r, {}, ["grupo", "grupoPor", "grupoEn"])
      : marcar(r, { grupo: g, grupoPor: quien, grupoEn: new Date().toISOString() });
  const ponerContactado = (r: RegistroForm) =>
    r.contactado
      ? marcar(r, { contactado: false }, ["contactadoPor", "contactadoEn"])
      : marcar(r, { contactado: true, contactadoPor: quien, contactadoEn: new Date().toISOString() });

  async function copiar(r: RegistroForm) {
    const n = normalizarTelefono(r.telefono, isoDePais(r.pais));
    const texto = n.e164 ?? (r.telefono ?? "");
    try { await navigator.clipboard.writeText(texto); toast(`Teléfono copiado: ${texto}`); }
    catch { toast("No se pudo copiar. Seleccionalo y copialo a mano.", "err"); }
  }

  const anuncioDe = (r: RegistroForm) => e.ads.find((a) => a.id === r.adId)?.nombre ?? r.utm?.utm_content ?? "";
  const alto = (fn: () => void) => (ev: React.MouseEvent) => { ev.stopPropagation(); fn(); };

  const DEF: Record<string, Columna<RegistroForm>> = {
    nombre: {
      clave: "nombre", titulo: "Persona", tipo: "primary", orden: (r) => (r.nombre ?? r.email).toLowerCase(),
      celda: (r) => (
        <span className="fm-persona">
          <span className="t-strong">{r.nombre || r.email}</span>
          {r.nombre && <span className="t-sm t-subtle">{r.email}</span>}
        </span>
      ),
    },
    registro: { clave: "registro", titulo: "Se anotó", tipo: "secondary", orden: (r) => +new Date(r.registradoEn), celda: (r) => diaYHora(r.registradoEn) },
    email: { clave: "email", titulo: "Email", tipo: "secondary", orden: (r) => r.email, celda: (r) => r.email },
    telefono: {
      clave: "telefono", titulo: "Teléfono", orden: (r) => r.telefonoNorm ?? r.telefono ?? "",
      celda: (r) => {
        if (!r.telefono) return <span className="t-subtle">—</span>;
        const wa = digitosWhatsapp(r.telefono, isoDePais(r.pais));
        return (
          <span className="fm-tel">
            <span className="t-num">{telefonoLegible(r.telefono, isoDePais(r.pais))}</span>
            <button type="button" className="fm-icono" title="Copiar el teléfono" aria-label={`Copiar el teléfono de ${r.nombre || r.email}`} onClick={alto(() => void copiar(r))}><Copy size={14} /></button>
            {wa && (
              <a className="fm-icono fm-icono--wa" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp"
                aria-label={`Abrir WhatsApp con ${r.nombre || r.email}`} onClick={(ev) => ev.stopPropagation()}><MessageCircle size={14} /></a>
            )}
          </span>
        );
      },
    },
    pais: { clave: "pais", titulo: "País", tipo: "secondary", orden: (r) => r.pais ?? "", celda: (r) => r.pais || "—" },
    respuestas: {
      clave: "respuestas", titulo: "Respuestas", tipo: "secondary", orden: (r) => r.respuestas.length,
      celda: (r) => (r.respuestas.length ? <span title={r.respuestas.map((x) => `${x.pregunta}: ${x.respuesta}`).join("\n")}>{r.respuestas[0].respuesta}{r.respuestas.length > 1 ? ` +${r.respuestas.length - 1}` : ""}</span> : "—"),
    },
    grupo: {
      clave: "grupo", titulo: "Grupo de WhatsApp", orden: (r) => (r.grupo === "unido" ? 2 : r.grupo === "no-unido" ? 1 : 0),
      celda: (r) => (
        <span className="fm-marcas" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className={`fm-marca fm-marca--ok${r.grupo === "unido" ? " is-on" : ""}`} aria-pressed={r.grupo === "unido"} disabled={!puedeEditar}
            title={r.grupo === "unido" ? `Unido: lo marcó ${r.grupoPor ?? "alguien"}. Un clic y se desmarca.` : "Marcar como unido al grupo"} onClick={() => void ponerGrupo(r, "unido")}>
            {r.grupo === "unido" && <Check size={13} />}Unido
          </button>
          <button type="button" className={`fm-marca fm-marca--no${r.grupo === "no-unido" ? " is-on" : ""}`} aria-pressed={r.grupo === "no-unido"} disabled={!puedeEditar}
            title={r.grupo === "no-unido" ? `No unido: lo marcó ${r.grupoPor ?? "alguien"}. Un clic y se desmarca.` : "Marcar como no unido al grupo"} onClick={() => void ponerGrupo(r, "no-unido")}>
            No unido
          </button>
        </span>
      ),
    },
    contactado: {
      clave: "contactado", titulo: "Contactado", orden: (r) => (r.contactado ? +new Date(r.contactadoEn ?? 0) || 1 : 0),
      celda: (r) => (
        <span onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className={`fm-marca fm-marca--ok${r.contactado ? " is-on" : ""}`} aria-pressed={r.contactado} disabled={!puedeEditar}
            title={r.contactado ? "Un clic y se desmarca" : "Marcar como contactado"} onClick={() => void ponerContactado(r)}>
            {r.contactado
              ? <><Check size={13} />{[r.contactadoPor, r.contactadoEn ? diaCorto(r.contactadoEn) : ""].filter(Boolean).join(" · ") || "Contactado"}</>
              : "Sin contactar"}
          </button>
        </span>
      ),
    },
    anuncio: { clave: "anuncio", titulo: "Anuncio", tipo: "secondary", orden: (r) => anuncioDe(r), celda: (r) => anuncioDe(r) || "—" },
    utm: {
      clave: "utm", titulo: "UTMs", orden: (r) => Object.values(r.utm ?? {}).join(" "),
      celda: (r) => (r.utm && Object.keys(r.utm).length
        ? <span className="wb-utms">{UTMS_FORM.filter((u) => r.utm?.[u]).map((u) => <Tag key={u}>{u.replace(/^utm_/, "")}: {r.utm![u]}</Tag>)}</span>
        : <span className="t-subtle">—</span>),
    },
    agenda: { clave: "agenda", titulo: "Agenda", orden: (r) => (r.contactoId ? 1 : 0), celda: (r) => (r.contactoId ? <Badge variante="success">Con agenda</Badge> : <span className="t-subtle">—</span>) },
    origen: { clave: "origen", titulo: "Origen del dato", tipo: "secondary", orden: (r) => r.origen, celda: (r) => (r.origen === "landing" ? "Landing" : r.origenDetalle ? `Excel · ${r.origenDetalle}` : r.origen) },
  };
  const columnas = cols.visibles.map((k) => DEF[k]).filter(Boolean);
  const tabla = useTablaURL("", null, columnas.filter((c) => c.orden).map((c) => c.clave));

  const nombreDelWebinar = opciones.find((o) => o.clave === sel)?.texto ?? (sel === "todos" ? "todos los webinars" : "");
  const opcionesFiltro: OpcionFiltro[] = [
    ...opciones.map((o) => ({ valor: o.clave, texto: o.texto, cuenta: o.cuenta })),
    { valor: "todos", texto: "Todos los webinars (puede tardar)" },
  ];

  return (
    <>
      <PageHead
        titulo="Formularios"
        sub="Quién se anotó a cada webinar y qué pasó con cada uno: si entró al grupo de WhatsApp y a quién ya se le escribió."
        acciones={
          <>
            {puedeEditar && <Button icono={<FileSpreadsheet size={16} />} onClick={() => setImportando(true)}>Importar del Excel</Button>}
            <CopiarLink />
          </>
        }
      />

      {datos.estado === "sin-tabla" && (
        <Ayuda titulo="Falta crear la tabla de registros" icono={<Users size={18} />}>
          Para guardar los formularios en la app hay que correr una vez <code>supabase/registros-webinar.sql</code> en Supabase.
          Hasta entonces la landing sigue guardando a cada persona como pre-lead, como siempre, y esta pantalla queda vacía.
        </Ayuda>
      )}
      {datos.estado === "error" && <p className="t-sm" style={{ color: "var(--danger)" }}>{datos.error}</p>}

      <Tabs
        valor={v.seccion as "registros" | "cruce"} onChange={(s) => cambiar({ seccion: s })}
        opciones={[{ valor: "registros", texto: "Registros" }, { valor: "cruce", texto: "Cruce con la agenda" }]}
      />

      {v.seccion === "cruce" ? (
        <CruceFormularios webinar={sel === "todos" ? "" : sel} nombreDelWebinar={nombreDelWebinar} />
      ) : (
        <div className="stack-3">
          <div className="grid-stats">
            <StatCard
              etiqueta="Registrados" valor={num(cuenta.total)} contexto={sel === "todos" ? "en todos los webinars" : "a este webinar"}
              info={{
                ayuda: "Las personas que completaron el formulario de este webinar: una por persona, aunque se haya anotado dos veces.",
                formula: "Registros del webinar (uno por mail y por fecha del webinar)",
                componentes: () => [{ concepto: "Registros", valor: num(cuenta.total) }, { concepto: "Con teléfono", valor: num(cuenta.conTelefono) }],
              }}
            />
            <StatCard
              etiqueta="Unidos al grupo" valor={num(cuenta.unidos)} contexto={cuenta.total ? `${pct(cuenta.unidos / cuenta.total)} de los registrados` : undefined}
              info={{
                ayuda: "Los registrados que el equipo marcó como unidos al grupo de WhatsApp.",
                formula: "Registrados marcados «Unido» ÷ registrados",
                componentes: () => [
                  { concepto: "Unidos", valor: num(cuenta.unidos) }, { concepto: "No unidos", valor: num(cuenta.noUnidos), signo: "+" },
                  { concepto: "Sin revisar", valor: num(cuenta.sinRevisar), signo: "+", nota: "nadie miró todavía" }, { concepto: "Registrados", valor: num(cuenta.total), signo: "=" },
                ],
              }}
            />
            <StatCard
              etiqueta="No unidos" valor={num(cuenta.noUnidos)} contexto={`${num(cuenta.noUnidosContactados)} ya contactados`}
              info={{
                ayuda: "Los que se revisó y todavía no entraron al grupo. Los contactados son los que ya recibieron un mensaje para unirse.",
                formula: "Registrados marcados «No unido»",
              }}
            />
            <StatCard
              etiqueta="Sin revisar" valor={num(cuenta.sinRevisar)} contexto="nadie marcó si entraron al grupo"
              info={{
                ayuda: "Los registrados que no están marcados ni como unidos ni como no unidos: lo que falta revisar contra el grupo.",
                formula: "Registrados − unidos − no unidos",
              }}
            />
          </div>

          <Card style={{ padding: 0 }}>
            <div className="wb-personas__cabeza">
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <Filtro etiqueta="Webinar" todos="Elegí un webinar" valor={sel} opciones={opcionesFiltro} onCambiar={(x) => cambiar({ webinar: x || ultimo, marca: null }, { pag: null })} />
                <Input icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscá por nombre, mail, teléfono, UTM o respuesta…" aria-label="Buscar registros" />
                <span className="spacer" />
                <Button sm variante="ghost" icono={<RefreshCw size={15} />} onClick={() => { void cargarResumen(); if (sel) void cargarRegistros(sel, true); }} title="Volver a leer la tabla: entran registros nuevos de la landing todo el tiempo">Actualizar</Button>
                <ConfigColumnas todas={COLUMNAS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} />
              </div>
              <div className="row-wrap" style={{ marginTop: "var(--space-3)" }}>
                {MARCAS.map((m) => (
                  <Chip key={m.valor || "todos"} activo={v.marca === m.valor} title={m.ayuda}
                    onClick={() => cambiar({ marca: m.valor || null }, { pag: null })}
                    count={m.valor === "" ? cuenta.total : m.valor === "unido" ? cuenta.unidos : m.valor === "no-unido" ? cuenta.noUnidos : m.valor === "sin-revisar" ? cuenta.sinRevisar : m.valor === "contactado" ? cuenta.contactados : cuenta.total - cuenta.contactados}>
                    {m.texto}
                  </Chip>
                ))}
              </div>
            </div>
            <DataTable
              filas={filas} columnas={columnas} porPagina={50}
              orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina}
              onFila={(r) => setDetalle(r.id)} etiquetaFila={(r) => `Ver el detalle de ${r.nombre || r.email}`}
              vacio={
                cargandoEste ? <Empty icono={<RefreshCw size={22} />} titulo="Cargando los registros…" texto="Se leen de la base de a un webinar." />
                : deEsteWebinar.length === 0 ? (
                  <Empty
                    icono={<Users size={22} />} titulo={datos.estado === "sin-tabla" ? "La tabla todavía no está creada" : "Todavía no hay registros de este webinar"}
                    texto={datos.estado === "sin-tabla" ? "Corré supabase/registros-webinar.sql en Supabase." : "Entran solos desde la landing. Los de los webinars anteriores se traen con «Importar del Excel»."}
                    accion={puedeEditar && datos.estado !== "sin-tabla" ? <Button onClick={() => setImportando(true)} icono={<FileSpreadsheet size={16} />}>Importar del Excel</Button> : undefined}
                  />
                ) : (
                  <Empty icono={<Search size={22} />} titulo="Nadie coincide con los filtros" texto="Probá con otro estado o con otra búsqueda."
                    accion={<Button onClick={() => { setQ(""); cambiar({ marca: null }); }}>Limpiar los filtros</Button>} />
                )
              }
            />
          </Card>
          {sel === "todos" && <p className="t-sm t-subtle">Estás viendo todos los webinars juntos: con muchos registros tarda en cargar. Para el trabajo de todos los días, elegí uno.</p>}
        </div>
      )}

      {importando && <ImportarFormularios onCerrar={() => setImportando(false)} onListo={(m) => { setImportando(false); toast(m); }} />}
      {detalle && (() => {
        const r = datos.registros.find((x) => x.id === detalle);
        return r ? <DetalleRegistro r={r} anuncio={anuncioDe(r)} puedeEditar={puedeEditar} onCerrar={() => setDetalle(null)}
          onAbrirPersona={r.contactoId ? () => { setDetalle(null); abrirFicha(r.contactoId!); } : undefined} /> : null;
      })()}
    </>
  );
}

/* Todo lo de un registro: sus datos, lo que contestó, de dónde vino y una nota del equipo. */
function DetalleRegistro({ r, anuncio, puedeEditar, onCerrar, onAbrirPersona }: {
  r: RegistroForm; anuncio: string; puedeEditar: boolean; onCerrar: () => void; onAbrirPersona?: () => void;
}) {
  const toast = useToast();
  const [nota, setNota] = useState(r.notas ?? "");
  async function guardar() {
    const res = nota.trim() ? await cambiarRegistro(r.id, { notas: nota.trim() }) : await cambiarRegistro(r.id, {}, ["notas"]);
    if (res.ok) toast("Nota guardada."); else toast(res.error ?? "No se pudo guardar.", "err");
  }
  return (
    <Modal abierto onCerrar={onCerrar} titulo={r.nombre || r.email} sub={r.nombre ? r.email : undefined} ancho
      pie={puedeEditar ? <Button variante="brand" onClick={() => void guardar()} disabled={nota.trim() === (r.notas ?? "")}>Guardar nota</Button> : undefined}>
      <div className="stack-3">
        <dl className="dl">
          <dt>Se anotó</dt><dd>{diaYHora(r.registradoEn)}</dd>
          <dt>Webinar</dt><dd>{r.fechaWebinar ? r.fechaWebinar.split("-").reverse().join("/") : "Sin fecha"}</dd>
          <dt>Teléfono</dt><dd>{r.telefono ? telefonoLegible(r.telefono, isoDePais(r.pais)) : "—"}</dd>
          <dt>País</dt><dd>{r.pais || "—"}</dd>
          <dt>Grupo</dt><dd>{r.grupo === "unido" ? "Unido" : r.grupo === "no-unido" ? "No unido" : "Sin revisar"}{r.grupoPor ? ` · ${r.grupoPor}` : ""}</dd>
          <dt>Contactado</dt><dd>{r.contactado ? `Sí${r.contactadoPor ? ` · ${r.contactadoPor}` : ""}${r.contactadoEn ? ` · ${diaCorto(r.contactadoEn)}` : ""}` : "No"}</dd>
          <dt>Anuncio</dt><dd>{anuncio || "—"}</dd>
          <dt>UTMs</dt>
          <dd>{r.utm && Object.keys(r.utm).length ? <span className="wb-utms">{UTMS_FORM.filter((u) => r.utm?.[u]).map((u) => <Tag key={u}>{u.replace(/^utm_/, "")}: {r.utm![u]}</Tag>)}</span> : "—"}</dd>
          <dt>Origen del dato</dt><dd>{r.origen === "landing" ? "La landing" : `Excel${r.origenDetalle ? ` · ${r.origenDetalle}` : ""}`}{r.pagina ? <span className="t-subtle"> · {r.pagina}</span> : null}</dd>
          <dt>Agenda</dt>
          <dd>{r.contactoId
            ? <>Unido con una persona que agendó{r.cruce ? ` (por ${r.cruce === "mail" ? "mail" : r.cruce === "telefono" ? "teléfono" : r.cruce === "nombre" ? "nombre" : "decisión del equipo"})` : ""}{onAbrirPersona && <> · <button type="button" className="link" onClick={onAbrirPersona}>abrir la ficha</button></>}</>
            : "Todavía no se cruzó con ninguna agenda"}</dd>
        </dl>
        {r.respuestas.length > 0 && (
          <div className="stack-2">
            <span className="t-label">Lo que contestó</span>
            {r.respuestas.map((x, i) => <div key={i} className="t-sm"><span className="t-subtle">{x.pregunta}:</span> {x.respuesta}</div>)}
          </div>
        )}
        <div className="stack-2">
          <span className="t-label">Nota del equipo</span>
          <Textarea rows={3} value={nota} onChange={(ev) => setNota(ev.target.value)} disabled={!puedeEditar} placeholder="Algo que el resto del equipo tenga que saber…" />
        </div>
      </div>
    </Modal>
  );
}
