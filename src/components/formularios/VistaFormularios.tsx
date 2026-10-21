"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Copy, Download, FileSpreadsheet, MessageCircle, RefreshCw, Search, Users, X } from "lucide-react";
import { Ayuda, Badge, Button, Card, Chip, Empty, Input, Tabs, Tag, Textarea } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, type DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { VistasGuardadas } from "@/components/ui/VistasGuardadas";
import { CopiarLink, Filtro, type OpcionFiltro } from "@/components/ui/Filtros";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { diaCorto, diaYHora } from "@/components/webinars/fechas";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { paginaDeURL, useBusquedaURL, useEscribirURL, useParamsURL } from "@/lib/useParamsURL";
import { aLista } from "@/lib/compartirLink";
import { bajarCsv } from "@/lib/csv";
import { csvParaManyChat } from "@/lib/grupos-whatsapp";
import { PARAM_VISTA } from "@/lib/vistas-guardadas";
import { textoDeFiltro } from "@/lib/crm-tabla";
import { filtroAURL, filtrosDeURL, opcionesDeColumna, ordenarFilas, ordenesAURL, ordenesDeURL, pasaFiltros, MAX_ORDENES } from "@/lib/tabla-filtros";
import { calculosAURL, calculosDeURL, calculoValido, columnasDeFormularios, columnasPorClave, ORDEN_FORM_POR_DEFECTO } from "@/lib/formularios-tabla";
import { num, pct } from "@/lib/format";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { normalizarTelefono, telefonoLegible } from "@/lib/telefonos";
import { enlaceWhatsapp } from "@/lib/contacto-telefono";
import {
  contarRegistros, filtrarRegistros, isoDePais, UTMS_FORM, type FiltroMarca, type RegistroForm,
} from "@/lib/registros-webinar";
import { cambiarRegistro, cambiarRegistros, cargarRegistros, cargarResumen, useRegistrosNube } from "@/lib/registros-nube";
import { AvisoLectorWhatsapp } from "@/components/webinars/AvisoLectorWhatsapp";
import { ImportarFormularios } from "./ImportarFormularios";
import { CruceFormularios } from "./CruceFormularios";
import { BarraDelLector, FILTROS_LECTOR, useLectorDeFormularios, type FiltroLector } from "./LectorFormularios";
import { PieCalculo } from "./PieCalculo";
import { FiltroColumna, textoFecha } from "@/components/crm-tabla/FiltroColumna";
import "./formularios.css";

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
  const [v, cambiar] = useParamsURL({ webinar: "", marca: "", seccion: "registros", lector: "", pag: "1" });
  const params = useSearchParams();
  const escribir = useEscribirURL();
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

  /* Lo que dice el lector de WhatsApp (si el webinar tiene un grupo atado): quién está adentro. */
  const lector = useLectorDeFormularios(sel === "todos" ? "" : sel, deEsteWebinar);
  const filtroLector = (FILTROS_LECTOR as string[]).includes(v.lector) ? (v.lector as FiltroLector) : "";
  const filasVisibles = useMemo(() => lector.filtrar(filas, filtroLector), [filas, filtroLector, lector.uniones, lector.hayGrupo]); // eslint-disable-line react-hooks/exhaustive-deps -- `filtrar` cambia en cada dibujo; lo que lo hace distinto es `uniones`

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

  async function marcarUnidos(ids: string[]) {
    const res = await cambiarRegistros(ids, { grupo: "unido", grupoPor: "Lector de WhatsApp", grupoEn: new Date().toISOString() });
    if (res.ok) toast(`Listo: ${num(res.escritos)} ${res.escritos === 1 ? "quedó marcado" : "quedaron marcados"} como ${res.escritos === 1 ? "unido" : "unidos"}.`);
    else toast(res.error ?? "No se pudo guardar.", "err");
  }
  /* Los que se ven (con los filtros puestos), listos para importar en ManyChat y escribirles desde ahí. */
  function bajarParaManyChat() {
    const { texto, sinTelefono } = csvParaManyChat(filasOrdenadas);
    bajarCsv(`manychat-formularios-${sel === "todos" ? "todos" : sel}`, texto);
    toast(`Se bajó el CSV con ${num(filasOrdenadas.length)} ${filasOrdenadas.length === 1 ? "contacto" : "contactos"}${sinTelefono ? `; ${num(sinTelefono)} sin teléfono que se entienda (van con el mail)` : ""}.`);
  }
  async function copiarTexto(texto: string, aviso: string) {
    try { await navigator.clipboard.writeText(texto); toast(aviso); }
    catch { toast("No se pudo copiar. Probá de nuevo.", "err"); }
  }

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
        const wa = enlaceWhatsapp(r.telefono, isoDePais(r.pais));
        return (
          <span className="fm-tel">
            <span className="t-num">{telefonoLegible(r.telefono, isoDePais(r.pais))}</span>
            <button type="button" className="fm-icono" title="Copiar el teléfono" aria-label={`Copiar el teléfono de ${r.nombre || r.email}`} onClick={alto(() => void copiar(r))}><Copy size={14} /></button>
            {wa && (
              <a className="fm-icono fm-icono--wa" href={wa} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp"
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
          {lector.insignia(r)}
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
  /* ---------- Las columnas, con sus filtros «como en Excel» y sus cálculos al pie ---------- */
  const defsTabla = useMemo(() => columnasDeFormularios({ anuncioDe }), [e.ads]); // eslint-disable-line react-hooks/exhaustive-deps -- `anuncioDe` sólo mira los anuncios
  const porClave = useMemo(() => columnasPorClave(defsTabla), [defsTabla]);
  const textoParams = params.toString();
  const filtros = useMemo(() => filtrosDeURL(porClave, new URLSearchParams(textoParams)), [porClave, textoParams]);
  const ordenes = useMemo(() => ordenesDeURL(porClave, params.get("orden"), ORDEN_FORM_POR_DEFECTO), [porClave, params]);
  const calculos = useMemo(() => calculosDeURL(defsTabla, params.get("calc")), [defsTabla, params]);
  const filtradas = useMemo(() => filasVisibles.filter((r) => pasaFiltros(porClave, r, filtros)), [filasVisibles, porClave, filtros]);
  const filasOrdenadas = useMemo(() => ordenarFilas(porClave, filtradas, ordenes), [porClave, filtradas, ordenes]);
  const conFiltro = Object.keys(filtros);
  const ordenDeSiempre = ordenesAURL(ordenes, ORDEN_FORM_POR_DEFECTO) === null;
  const hayAlgo = conFiltro.length > 0 || Boolean(q) || Boolean(v.marca) || Boolean(filtroLector);

  const cambiarFiltro = (clave: string, fc: Parameters<typeof filtroAURL>[1]) => escribir({ ...filtroAURL(clave, fc), pag: null });
  const ordenar = (os: { clave: string; desc: boolean }[]) => escribir({ orden: ordenesAURL(os, ORDEN_FORM_POR_DEFECTO), pag: null });
  const elegirCalculo = (clave: string, id: string) => escribir({ calc: calculosAURL(defsTabla, { ...calculos, [clave]: id }) });
  const limpiar = () => escribir({
    ...Object.assign({}, ...Object.keys(porClave).map((k) => filtroAURL(k, null))),
    q: null, marca: null, lector: null, pag: null, [PARAM_VISTA]: null,
  });

  const columnas: Columna<RegistroForm>[] = cols.visibles.map((k) => {
    const def = porClave[k];
    const puesto = ordenes.findIndex((o) => o.clave === k);
    return {
      ...DEF[k], orden: undefined,
      encabezado: (
        <FiltroColumna
          titulo={def.titulo}
          opciones={() => opcionesDeColumna(porClave, filasVisibles, filtros, k)}
          filtro={filtros[k]} onFiltro={(fc) => cambiarFiltro(k, fc)}
          orden={puesto >= 0 ? { desc: ordenes[puesto].desc, puesto: puesto + 1, de: ordenes.length } : undefined}
          onOrdenar={(desc) => ordenar([{ clave: k, desc }])}
          /* Como criterio siguiente; si ya ordena, le cambia el sentido. */
          onSumarOrden={(desc) => ordenar(puesto >= 0
            ? ordenes.map((o) => (o.clave === k ? { ...o, desc } : o))
            : [...ordenes.slice(0, MAX_ORDENES - 1), { clave: k, desc }])}
          onQuitarOrden={() => ordenar(ordenes.filter((o) => o.clave !== k))}
          ordenaPrimero={ordenes[0].clave !== k ? porClave[ordenes[0].clave]?.titulo : undefined}
          fecha={def.fecha}
        />
      ),
      pie: <PieCalculo col={def} filas={filasOrdenadas} calculo={calculoValido(def, calculos[k])} onCambiar={(id) => elegirCalculo(k, id)} />,
    };
  });

  const nombreDelWebinar = opciones.find((o) => o.clave === sel)?.texto ?? (sel === "todos" ? "todos los webinars" : "");
  const opcionesFiltro: OpcionFiltro[] = [
    ...opciones.map((o) => ({ valor: o.clave, texto: o.texto, cuenta: o.cuenta })),
    { valor: "todos", texto: "Todos los webinars (puede tardar)" },
  ];

  const enCruce = v.seccion === "cruce";

  return (
    <div className="stack-4 fm-pagina">
      {datos.estado === "sin-tabla" && (
        <Ayuda titulo="Falta crear la tabla de registros" icono={<Users size={18} />}>
          Para guardar los formularios en la app hay que correr una vez <code>supabase/registros-webinar.sql</code> en Supabase.
          Hasta entonces la landing sigue guardando a cada persona como pre-lead, como siempre, y esta pantalla queda vacía.
        </Ayuda>
      )}
      {datos.estado === "error" && <p className="t-sm" style={{ color: "var(--danger)" }}>{datos.error}</p>}

      {/* Con el grupo atado, el panel ya dice si WhatsApp está conectado; el aviso rojo de la app sólo sale cuando no hay panel. */}
      {!lector.hayGrupo && <AvisoLectorWhatsapp />}

      {/* Con el grupo de WhatsApp atado, quién entró y a quién escribirle; sin grupo, una línea con «Atarlo». */}
      {!enCruce && (
        <BarraDelLector
          lector={lector} registros={deEsteWebinar} visibles={filasVisibles}
          filtro={filtroLector} onFiltro={(f) => cambiar({ lector: f || null }, { pag: null })}
          puedeEditar={puedeEditar} onMarcarUnidos={marcarUnidos} onCopiar={copiarTexto}
        />
      )}

      <div className="crm-t fm-t">
        <Card className="crm-t__card">
          {/* Todo en una barra, como el CRM: el título ya está arriba, en la barra de la app. */}
          <div className="crm-t__barra">
            <VistasGuardadas pantalla="formularios" todas="Todos los registros" extra={{ "cols-formularios": aLista(cols.visibles.filter((k) => k !== "nombre")) }} />
            <Filtro etiqueta="Webinar" todos="Elegí un webinar" valor={sel} opciones={opcionesFiltro} onCambiar={(x) => cambiar({ webinar: x || ultimo, marca: null }, { pag: null })} />
            {!enCruce && (
              <>
                <div className="crm-t__buscar">
                  <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por nombre, mail, teléfono, UTM o respuesta" aria-label="Buscar registros" />
                </div>
              </>
            )}
            <div className="crm-t__acciones">
              <Tabs
                valor={v.seccion as "registros" | "cruce"} onChange={(x) => cambiar({ seccion: x === "registros" ? null : x })}
                opciones={[{ valor: "registros", texto: "Registros" }, { valor: "cruce", texto: "Cruce con la agenda" }]}
              />
              {!enCruce && <ConfigColumnas todas={COLUMNAS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} compacto />}
              <Button sm variante="ghost" icono={<RefreshCw size={15} />} aria-label="Actualizar" onClick={() => { void cargarResumen(); if (sel) void cargarRegistros(sel, true); }} title="Volver a leer la tabla: entran registros nuevos solos desde la landing" />
              <CopiarLink />
              <Button sm variante="secondary" icono={<Download size={15} />} disabled={filasOrdenadas.length === 0} onClick={bajarParaManyChat}
                title="Baja un CSV con los registros que se ven (con los filtros puestos): nombre, teléfono y mail, listos para importar en ManyChat">{lector.hayGrupo ? "Descargar CSV" : "CSV para ManyChat"}</Button>
              {puedeEditar && <Button sm variante="secondary" icono={<FileSpreadsheet size={15} />} title="Traer las hojas del Excel de Yari" onClick={() => setImportando(true)}>Importar</Button>}
            </div>
          </div>

          {enCruce ? (
            <CruceFormularios webinar={sel === "todos" ? "" : sel} nombreDelWebinar={nombreDelWebinar} />
          ) : (
            <>
              <div className="crm-t__filtros">
                <span className="t-label fm-etiqueta" title="Lo que el equipo marcó a mano en las columnas «Grupo de WhatsApp» y «Contactado» de la tabla. No es lo que ve WhatsApp: eso está arriba, en «Grupo de WhatsApp». Pueden no coincidir (por ejemplo, 150 «No unidos» a mano y 372 que no se ven en el grupo) hasta que se ponen al día con «Marcar como Unido».">Marcado a mano en la tabla</span>
                {MARCAS.filter((m) => m.valor).map((m) => (
                  <Chip key={m.valor} activo={v.marca === m.valor} title={m.ayuda}
                    onClick={() => cambiar({ marca: v.marca === m.valor ? null : m.valor }, { pag: null })}
                    count={m.valor === "unido" ? cuenta.unidos : m.valor === "no-unido" ? cuenta.noUnidos : m.valor === "sin-revisar" ? cuenta.sinRevisar : m.valor === "contactado" ? cuenta.contactados : cuenta.total - cuenta.contactados}>
                    {m.texto}
                  </Chip>
                ))}
                <span className="t-sm t-subtle t-num crm-t__cuenta">
                  {num(filasOrdenadas.length)}
                  {filasOrdenadas.length !== deEsteWebinar.length ? ` de ${num(deEsteWebinar.length)}` : ""}
                  {" "}{deEsteWebinar.length === 1 ? "registro" : "registros"}
                </span>
                {filtroLector && (
                  <span className="crm-t__pastilla">
                    <span className="t-subtle">WhatsApp:</span>
                    <span className="truncate">{filtroLector === "dentro" ? "ya están en el grupo" : filtroLector === "fuera" ? "todavía no entraron" : "sin teléfono"}</span>
                    <button type="button" onClick={() => cambiar({ lector: null }, { pag: null })} aria-label="Quitar el filtro del lector"><X size={13} /></button>
                  </span>
                )}
                {conFiltro.map((k) => (
                  <span key={k} className="crm-t__pastilla">
                    <span className="t-subtle">{porClave[k].titulo}:</span>
                    <span className="truncate">{textoDeFiltro(filtros[k], (x) => (porClave[k].fecha ? textoFecha(x) : x))}</span>
                    <button type="button" onClick={() => cambiarFiltro(k, null)} aria-label={`Quitar el filtro de ${porClave[k].titulo}`}><X size={13} /></button>
                  </span>
                ))}
                {!ordenDeSiempre && (
                  <span className="crm-t__pastilla">
                    <span className="t-subtle">Orden:</span>
                    <span className="truncate crm-t__orden">
                      {ordenes.map((o) => (
                        <span key={o.clave}>{porClave[o.clave]?.titulo}{o.desc ? <ArrowDown size={12} aria-label="de mayor a menor" /> : <ArrowUp size={12} aria-label="de menor a mayor" />}</span>
                      ))}
                    </span>
                    <button type="button" onClick={() => ordenar(ORDEN_FORM_POR_DEFECTO)} aria-label="Volver al orden de siempre"><X size={13} /></button>
                  </span>
                )}
                {hayAlgo && <button type="button" className="link t-sm" onClick={limpiar}>Limpiar todo</button>}
              </div>

              <DataTable
                filas={filasOrdenadas} columnas={columnas} porPagina={50}
                alto={720} pagina={paginaDeURL(v.pag) - 1} onPagina={(p) => cambiar({ pag: String(p + 1) })}
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
                    <Empty icono={<Search size={22} />} titulo="Nadie coincide con los filtros" texto="Probá sacando algún filtro."
                      accion={<Button onClick={limpiar}>Limpiar todo</Button>} />
                  )
                }
              />
            </>
          )}
        </Card>
        {sel === "todos" && !enCruce && <p className="t-sm t-subtle">Estás viendo todos los webinars juntos: con muchos registros tarda en cargar. Para el trabajo de todos los días, elegí uno.</p>}
      </div>

      {importando && <ImportarFormularios onCerrar={() => setImportando(false)} onListo={(m) => { setImportando(false); toast(m); }} />}
      {detalle && (() => {
        const r = datos.registros.find((x) => x.id === detalle);
        return r ? <DetalleRegistro r={r} anuncio={anuncioDe(r)} puedeEditar={puedeEditar} onCerrar={() => setDetalle(null)}
          onAbrirPersona={r.contactoId ? () => { setDetalle(null); abrirFicha(r.contactoId!); } : undefined} /> : null;
      })()}
    </div>
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
