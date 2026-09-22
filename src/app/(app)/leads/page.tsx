"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download, Pencil, Plus, Search, Trash2, Upload, Users,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, Chip, Empty, Field, IconButton, Input, Persona, Select, Textarea,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { ModalForm, Confirmar, Modal } from "@/components/ui/Modal";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { AsistenteLead, ETIQUETA_INGLES, ORDEN_INGLES, type BorradorLead } from "@/components/leads/AsistenteLead";
import { fechaHora, fechaLarga, money, num, relativo } from "@/lib/format";
import { DateRangePicker, diaDeNegocio } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import type { Lead, Moneda } from "@/lib/types";

/* Las columnas que se pueden prender, como en el Administrador de anuncios.
   Cada uno elige las suyas (se guardan en su navegador). */
const COLUMNAS_LEADS: DefColumna[] = [
  { clave: "nombre", titulo: "Lead", fija: true },
  { clave: "etapa", titulo: "Etapa", grupo: "Pipeline" },
  { clave: "monto", titulo: "Valor", grupo: "Pipeline", ayuda: "Cuánto vale si cierra" },
  { clave: "responsable", titulo: "Responsable", grupo: "Pipeline" },
  { clave: "act", titulo: "Últ. cambio", grupo: "Pipeline" },
  { clave: "creado", titulo: "Entró", grupo: "Pipeline", ayuda: "Cuándo se cargó el lead" },
  { clave: "fuente", titulo: "Fuente", grupo: "Origen" },
  { clave: "campania", titulo: "Campaña", grupo: "Origen" },
  { clave: "canal", titulo: "Entró por", grupo: "Origen", ayuda: "Webinar, VSL o setter: el embudo con el que llegó" },
  { clave: "anuncio", titulo: "Anuncio", grupo: "Origen", ayuda: "El anuncio de Meta con el que se registró" },
  { clave: "utmSource", titulo: "utm_source", grupo: "Origen" },
  { clave: "utmCampaign", titulo: "utm_campaign", grupo: "Origen" },
  { clave: "webinar", titulo: "Webinar", grupo: "Origen" },
  { clave: "email", titulo: "Email", grupo: "Contacto" },
  { clave: "telefono", titulo: "Teléfono", grupo: "Contacto" },
  { clave: "pais", titulo: "País", grupo: "Contacto" },
  { clave: "ingles", titulo: "Inglés", grupo: "Perfil" },
  { clave: "exp", titulo: "Años exp.", grupo: "Perfil" },
  { clave: "tecnologias", titulo: "Lenguajes", grupo: "Perfil" },
  { clave: "formacion", titulo: "Formación", grupo: "Perfil" },
  { clave: "sueldo", titulo: "Gana por mes (USD)", grupo: "Perfil" },
  { clave: "llamadas", titulo: "Llamadas", grupo: "Actividad", ayuda: "Cuántas agendó, contando las canceladas" },
  { clave: "proxLlamada", titulo: "Próxima llamada", grupo: "Actividad" },
  { clave: "compras", titulo: "Compró", grupo: "Actividad", ayuda: "Lo facturado en sus ventas activas" },
];
const POR_DEFECTO_LEADS = ["nombre", "etapa", "fuente", "pais", "ingles", "exp", "monto", "act"];

const VACIO = (fuente: string, etapaId: string): Omit<Lead, "id"> => ({
  nombre: "", email: "", telefono: "", pais: "", fuente, campania: "",
  etapaId, monto: 2400, moneda: "USD" as Moneda, responsable: "", notas: "",
  etiquetas: [], creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString(), extra: {},
});


export default function Leads() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const abrirFicha = useAbrirFicha();
  const params = useSearchParams();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState<string>("todas");
  const [fuente, setFuente] = useState<string>("todas");
  const [ingles, setIngles] = useState<string>("todos");
  /* El rango va con el mismo componente que el resto de la app, no un
     selector de mes propio: Yari pidio ver los leads por mes, pero tambien
     comparar periodos, y un mes suelto no deja hacer eso. */
  const [rango, setRango] = useRangoURL("mes");
  const [form, setForm] = useState<(Omit<Lead, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Lead | null>(null);
  const [importar, setImportar] = useState(false);
  const cols = useColumnas("leads", COLUMNAS_LEADS, POR_DEFECTO_LEADS);

  const etapaInicial = useMemo(() => [...e.etapas].sort((a, b) => a.orden - b.orden)[0]?.id ?? "", [e.etapas]);

  useEffect(() => {
    if (url.nuevo) { setForm(VACIO(e.ajustes.fuentes[0] ?? "", etapaInicial)); url.limpiar(); }
    /* Los links viejos (?ver=<id>) abren la ficha de la persona, que es la
       misma desde cualquier pantalla. abrirFicha ya saca el ?ver. */
    else if (url.ver) abrirFicha(url.ver);
  }, [url, e.ajustes.fuentes, etapaInicial, abrirFicha]);

  /* La ficha manda a editar los datos de un lead con ?editar=<id>. */
  useEffect(() => {
    const id = params.get("editar");
    if (!id) return;
    const lead = e.leads.find((l) => l.id === id);
    if (lead) setForm({ ...lead });
    router.replace("/leads", { scroll: false });
  }, [params, e.leads, router]);

  /* Solo el rango. Los chips de etapa cuentan sobre esto: si contaran sobre
     `filtrados`, el chip de la etapa elegida mostraria su propio total y los
     demas cero. */
  const enRango = useMemo(() => e.leads.filter((l) => {
    /* Por el dia argentino, no el de UTC: un lead cargado a las 22 lleva la
       fecha de manana en el ISO y se caia del rango que termina hoy. */
    const dia = diaDeNegocio(l.creadoEn);
    return !dia || (dia >= rango.desde && dia <= rango.hasta);
  }), [e.leads, rango]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return enRango.filter((l) => {
      if (etapa !== "todas" && l.etapaId !== etapa) return false;
      if (fuente !== "todas" && l.fuente !== fuente) return false;
      if (ingles !== "todos" && (l.inglesNivel ?? "") !== ingles) return false;
      if (!t) return true;
      return [l.nombre, l.email, l.telefono, l.pais, l.campania].some((x) => x?.toLowerCase().includes(t));
    });
  }, [enRango, q, etapa, fuente, ingles]);

  const etapaDe = (id: string) => e.etapas.find((x) => x.id === id);

  function guardar(borrador: BorradorLead) {
    const form = borrador;
    if (!form.nombre.trim()) { toast("Poné al menos el nombre.", "err"); return; }
    const datos = { ...form, actualizadoEn: new Date().toISOString(), responsable: form.responsable || e.ajustes.responsable };
    /* Por las acciones de lead, no por `crear`/`actualizar` a secas: son las
       que mantienen el contacto al día. Un lead nuevo nace con su contacto, y
       editar el nombre acá no puede dejar al contacto con el nombre viejo. */
    if (form.id) {
      acciones.editarLead(form.id, datos, form.nombre);
      toast(`Se guardaron los cambios de ${form.nombre}.`);
    } else {
      acciones.altaDeLead(datos, form.nombre);
      toast(`${form.nombre} ya está en tus leads.`);
    }
    setForm(null);
  }

  /* Lo que cada fila necesita de otras tablas, indexado una vez: con
     cientos de leads, buscarlo celda por celda se nota. */
  const ind = useMemo(() => {
    const contacto = new Map(e.contactos.map((c) => [c.id, c]));
    const llamadas = new Map<string, typeof e.sesiones>();
    for (const s of e.sesiones) {
      for (const k of [s.leadId, s.contactoId]) {
        if (!k) continue;
        const ya = llamadas.get(k) ?? [];
        if (!ya.includes(s)) ya.push(s);
        llamadas.set(k, ya);
      }
    }
    const compras = new Map<string, number>();
    for (const v of e.ventas) if (v.contactoId && v.estado !== "cancelada") compras.set(v.contactoId, (compras.get(v.contactoId) ?? 0) + v.precioAcordado);
    const anuncio = new Map(e.ads.map((a) => [a.id, a.nombre]));
    const webinar = new Map(e.webinars.map((w) => [w.id, w.titulo]));
    return { contacto, llamadas, compras, anuncio, webinar };
  }, [e.contactos, e.sesiones, e.ventas, e.ads, e.webinars]);
  const contactoDe = (l: Lead) => ind.contacto.get(l.contactoId ?? l.id);
  const llamadasDe = (l: Lead) => {
    const xs = [...(ind.llamadas.get(l.id) ?? []), ...(ind.llamadas.get(l.contactoId ?? "") ?? [])];
    return [...new Set(xs)];
  };
  const ahoraIso = new Date().toISOString();

  const todasLasColumnas: Record<string, Columna<Lead>> = {
    nombre: {
      clave: "nombre", titulo: "Lead", tipo: "primary", orden: (l) => l.nombre,
      celda: (l) => <Persona nombre={l.nombre} sub={l.email} />,
    },
    etapa: {
      clave: "etapa", titulo: "Etapa", orden: (l) => etapaDe(l.etapaId)?.orden ?? 99,
      celda: (l) => {
        const et = etapaDe(l.etapaId);
        return et ? <Badge variante={et.variante}>{et.nombre}</Badge> : <span>—</span>;
      },
    },
    fuente: { clave: "fuente", titulo: "Fuente", tipo: "secondary", orden: (l) => l.fuente, celda: (l) => l.fuente || "—" },
    pais: { clave: "pais", titulo: "País", tipo: "secondary", orden: (l) => l.pais ?? "", celda: (l) => l.pais || "—" },
    ingles: {
      clave: "ingles", titulo: "Inglés", tipo: "secondary",
      orden: (l) => ORDEN_INGLES.indexOf(l.inglesNivel ?? "ninguno"),
      celda: (l) => (l.inglesNivel
        ? <Badge variante={l.inglesNivel === "conversacional" || l.inglesNivel === "nativo" ? "success" : "neutral"}>{ETIQUETA_INGLES[l.inglesNivel]}</Badge>
        : "—"),
    },
    exp: { clave: "exp", titulo: "Años exp.", tipo: "num", orden: (l) => l.aniosExperiencia ?? -1, celda: (l) => (l.aniosExperiencia == null ? "—" : num(l.aniosExperiencia)) },
    monto: { clave: "monto", titulo: "Valor", tipo: "num", orden: (l) => l.monto, celda: (l) => money(l.monto, l.moneda) },
    act: { clave: "act", titulo: "Últ. cambio", tipo: "secondary", orden: (l) => l.actualizadoEn, celda: (l) => relativo(l.actualizadoEn) },
    creado: { clave: "creado", titulo: "Entró", tipo: "secondary", orden: (l) => l.creadoEn, celda: (l) => fechaLarga(l.creadoEn) },
    responsable: { clave: "responsable", titulo: "Responsable", tipo: "secondary", orden: (l) => l.responsable, celda: (l) => l.responsable || "—" },
    email: { clave: "email", titulo: "Email", tipo: "secondary", orden: (l) => l.email, celda: (l) => l.email || "—" },
    telefono: { clave: "telefono", titulo: "Teléfono", tipo: "secondary", orden: (l) => l.telefono ?? "", celda: (l) => l.telefono || "—" },
    campania: { clave: "campania", titulo: "Campaña", tipo: "secondary", orden: (l) => l.campania ?? "", celda: (l) => l.campania || "—" },
    canal: {
      clave: "canal", titulo: "Entró por", tipo: "secondary",
      orden: (l) => contactoDe(l)?.origenCanal ?? "",
      celda: (l) => { const c = contactoDe(l)?.origenCanal; return c ? ETIQUETA_CANAL[c] : "—"; },
    },
    anuncio: {
      clave: "anuncio", titulo: "Anuncio", tipo: "secondary",
      orden: (l) => ind.anuncio.get(contactoDe(l)?.origenAdId ?? "") ?? "",
      celda: (l) => ind.anuncio.get(contactoDe(l)?.origenAdId ?? "") ?? "—",
    },
    utmSource: { clave: "utmSource", titulo: "utm_source", tipo: "secondary", orden: (l) => contactoDe(l)?.utm?.utm_source ?? "", celda: (l) => contactoDe(l)?.utm?.utm_source ?? "—" },
    utmCampaign: { clave: "utmCampaign", titulo: "utm_campaign", tipo: "secondary", orden: (l) => contactoDe(l)?.utm?.utm_campaign ?? "", celda: (l) => contactoDe(l)?.utm?.utm_campaign ?? "—" },
    webinar: { clave: "webinar", titulo: "Webinar", tipo: "secondary", orden: (l) => ind.webinar.get(l.webinarId ?? "") ?? "", celda: (l) => ind.webinar.get(l.webinarId ?? "") ?? "—" },
    tecnologias: { clave: "tecnologias", titulo: "Lenguajes", tipo: "secondary", orden: (l) => contactoDe(l)?.tecnologias ?? "", celda: (l) => contactoDe(l)?.tecnologias || "—" },
    formacion: { clave: "formacion", titulo: "Formación", tipo: "secondary", orden: (l) => contactoDe(l)?.formacion ?? "", celda: (l) => contactoDe(l)?.formacion || "—" },
    sueldo: { clave: "sueldo", titulo: "Gana por mes", tipo: "num", orden: (l) => Number(contactoDe(l)?.sueldoUsd) || -1, celda: (l) => contactoDe(l)?.sueldoUsd || "—" },
    llamadas: { clave: "llamadas", titulo: "Llamadas", tipo: "num", orden: (l) => llamadasDe(l).length, celda: (l) => num(llamadasDe(l).length) },
    proxLlamada: {
      clave: "proxLlamada", titulo: "Próxima llamada", tipo: "secondary",
      orden: (l) => llamadasDe(l).filter((x) => x.estado === "agendada" && x.inicia >= ahoraIso).map((x) => x.inicia).sort()[0] ?? "9999",
      celda: (l) => {
        const prox = llamadasDe(l).filter((x) => x.estado === "agendada" && x.inicia >= ahoraIso).map((x) => x.inicia).sort()[0];
        return prox ? fechaHora(prox) : "—";
      },
    },
    compras: {
      clave: "compras", titulo: "Compró", tipo: "num",
      orden: (l) => (ind.compras.get(l.id) ?? 0) + (ind.compras.get(l.contactoId ?? "") ?? 0),
      celda: (l) => { const t = (ind.compras.get(l.id) ?? 0) + (ind.compras.get(l.contactoId ?? "") ?? 0); return t ? money(t, l.moneda) : "—"; },
    },
  };
  const columnas = cols.visibles.map((k) => todasLasColumnas[k]).filter(Boolean);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Leads"
        sub={`${e.leads.length} personas en total. Cargá una, movela de etapa y cuando compre convertila en alumno.`}
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={null} onApply={setRango}
              footerNota="Por cuándo entró el lead · zona horaria de Argentina"
            />
            <Button variante="secondary" icono={<Upload size={16} />} onClick={() => setImportar(true)}>Importar CSV</Button>
            <Button variante="secondary" icono={<Download size={16} />} onClick={() => exportarCSV(e.leads, e.etapas)}>Exportar</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIO(e.ajustes.fuentes[0] ?? "", etapaInicial))}>Nuevo lead</Button>
          </>
        }
      />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
            <Input
              icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)}
              placeholder="Buscá por nombre, mail o país…" aria-label="Buscar leads"
            />
            <span className="spacer" />
            <div style={{ width: 175 }}>
              <Select
                value={ingles} onChange={(ev) => setIngles(ev.target.value)} aria-label="Filtrar por nivel de inglés"
                opciones={[
                  { valor: "todos", texto: "Cualquier inglés" },
                  ...ORDEN_INGLES.map((n) => ({ valor: n, texto: ETIQUETA_INGLES[n] })),
                ]}
              />
            </div>
            <div style={{ width: 190 }}>
              <Select
                value={fuente} onChange={(ev) => setFuente(ev.target.value)} aria-label="Filtrar por fuente"
                opciones={[{ valor: "todas", texto: "Todas las fuentes" }, ...e.ajustes.fuentes.map((f) => ({ valor: f, texto: f }))]}
              />
            </div>
            <ConfigColumnas
              todas={COLUMNAS_LEADS} visibles={cols.visibles}
              alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar}
            />
          </div>
          <div className="toolbar">
            {/* Los contadores salen de lo que el RANGO deja ver, no de la base
                entera: si el filtro dice "este mes", un chip que cuenta todo
                el historico le miente al que lo lee. */}
            <Chip activo={etapa === "todas"} onClick={() => setEtapa("todas")} count={enRango.length}>Todas</Chip>
            {[...e.etapas].sort((a, b) => a.orden - b.orden).map((et) => (
              <Chip key={et.id} activo={etapa === et.id} onClick={() => setEtapa(et.id)} count={enRango.filter((l) => l.etapaId === et.id).length}>
                {et.nombre}
              </Chip>
            ))}
          </div>
        </div>

        <DataTable
          alto={620}
          porPagina={50}
          filas={filtrados}
          columnas={columnas}
          ordenInicial={{ clave: "act", desc: true }}
          onFila={(l) => abrirFicha(l.id)}
          etiquetaFila={(l) => `Ver ${l.nombre}`}
          acciones={(l) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm({ ...l })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(l)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty
              icono={<Users size={22} />}
              titulo={q || etapa !== "todas" || fuente !== "todas" ? "Ningún lead coincide" : "Todavía no hay leads"}
              texto={q || etapa !== "todas" || fuente !== "todas" ? "Probá con otro texto o sacá los filtros." : "Cargá el primero a mano o importá un CSV que ya tengas."}
              accion={
                q || etapa !== "todas" || fuente !== "todas"
                  ? <Button variante="secondary" onClick={() => { setQ(""); setEtapa("todas"); setFuente("todas"); }}>Limpiar filtros</Button>
                  : <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIO(e.ajustes.fuentes[0] ?? "", etapaInicial))}>Cargar mi primer lead</Button>
              }
            />
          }
        />
      </Card>

      {/* ---------- Alta / edición ---------- */}
      {form && (
        <AsistenteLead
          inicial={form} onCerrar={() => setForm(null)}
          onGuardar={(datos) => guardar(datos)}
        />
      )}

      {importar && <ImportarModal onCerrar={() => setImportar(false)} etapaId={etapaInicial} />}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar a ${borrar?.nombre}?`}
        texto="Se borra el lead y su historial. Esto no se puede deshacer."
        onConfirmar={() => { if (borrar) { acciones.eliminar("leads", borrar.id, borrar.nombre); toast(`Se eliminó a ${borrar.nombre}.`); } }}
      />
    </div>
  );
}

/* ---------- Convertir en alumno ---------- */

function ImportarModal({ onCerrar, etapaId }: { onCerrar: () => void; etapaId: string }) {
  const e = useEstado();
  const toast = useToast();
  const [texto, setTexto] = useState("");

  const filas = useMemo(() => parsearCSV(texto), [texto]);

  return (
    <Modal
      abierto onCerrar={onCerrar} ancho titulo="Importar leads desde CSV"
      sub="Pegá el contenido de tu planilla. La primera fila tiene que tener los títulos de las columnas."
      pie={
        <>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button
            variante="primary" disabled={filas.length === 0}
            onClick={() => {
              const nuevos = filas.map((f) => ({
                ...VACIO(f.fuente || e.ajustes.fuentes[0] || "", etapaId),
                nombre: f.nombre, email: f.email, telefono: f.telefono, pais: f.pais,
                monto: Number(f.monto) || 2400, responsable: e.ajustes.responsable,
              }));
              const n = acciones.importarLeads(nuevos);
              toast(`Se importaron ${n} leads.`);
              onCerrar();
            }}
          >
            Importar {filas.length > 0 ? `${filas.length} leads` : ""}
          </Button>
        </>
      }
    >
      <Ayuda titulo="Cómo armar el CSV" icono={<Upload size={18} />}>
        Poné una columna por dato. Reconozco <strong>nombre</strong>, <strong>email</strong>, <strong>telefono</strong>,{" "}
        <strong>pais</strong>, <strong>fuente</strong> y <strong>monto</strong>. Lo que no reconozca lo ignoro, así que
        no pasa nada si tu planilla tiene columnas de más.
      </Ayuda>
      <Field label="Contenido del CSV">
        <Textarea
          rows={8} value={texto} onChange={(ev) => setTexto(ev.target.value)}
          placeholder={"nombre,email,telefono,pais,fuente,monto\nMartín Quiroga,martin@gmail.com,+5491155550000,Argentina,Meta Ads,2400"}
        />
      </Field>
      {texto.trim() && (
        <div className={`hk-help${filas.length === 0 ? " hk-help--error" : ""}`}>
          {filas.length === 0
            ? "No pude leer ninguna fila. Revisá que la primera línea tenga los títulos y que haya al menos una fila de datos."
            : `Listo: leí ${filas.length} ${filas.length === 1 ? "fila" : "filas"}. Primera: ${filas[0].nombre || "(sin nombre)"}.`}
        </div>
      )}
    </Modal>
  );
}

interface FilaCSV { nombre: string; email: string; telefono: string; pais: string; fuente: string; monto: string }

function parsearCSV(texto: string): FilaCSV[] {
  const lineas = texto.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return [];
  const sep = lineas[0].includes(";") ? ";" : ",";
  const cabeceras = lineas[0].split(sep).map((h) => h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const idx = (...nombres: string[]) => cabeceras.findIndex((h) => nombres.includes(h));
  const iN = idx("nombre", "name", "nombre y apellido", "full name");
  const iE = idx("email", "mail", "correo", "e-mail");
  const iT = idx("telefono", "phone", "celular", "whatsapp");
  const iP = idx("pais", "country");
  const iF = idx("fuente", "source", "origen");
  const iM = idx("monto", "valor", "amount", "value");

  return lineas.slice(1).map((l) => {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
    return {
      nombre: iN >= 0 ? c[iN] ?? "" : c[0] ?? "",
      email: iE >= 0 ? c[iE] ?? "" : "",
      telefono: iT >= 0 ? c[iT] ?? "" : "",
      pais: iP >= 0 ? c[iP] ?? "" : "",
      fuente: iF >= 0 ? c[iF] ?? "" : "",
      monto: iM >= 0 ? c[iM] ?? "" : "",
    };
  }).filter((f) => f.nombre);
}

function exportarCSV(leads: Lead[], etapas: { id: string; nombre: string }[]) {
  const cab = ["nombre", "email", "telefono", "pais", "fuente", "campania", "etapa", "monto", "moneda", "responsable", "creado"];
  const filas = leads.map((l) => [
    l.nombre, l.email, l.telefono ?? "", l.pais ?? "", l.fuente, l.campania ?? "",
    etapas.find((x) => x.id === l.etapaId)?.nombre ?? "", String(l.monto), l.moneda,
    l.responsable, l.creadoEn.slice(0, 10),
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[cab.join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
