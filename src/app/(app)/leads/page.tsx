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
import { ModalForm, Confirmar, Modal } from "@/components/ui/Modal";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { money, num, relativo } from "@/lib/format";
import { DateRangePicker, diaDeNegocio } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import type { Lead, Moneda } from "@/lib/types";

const VACIO = (fuente: string, etapaId: string): Omit<Lead, "id"> => ({
  nombre: "", email: "", telefono: "", pais: "", fuente, campania: "",
  etapaId, monto: 2400, moneda: "USD" as Moneda, responsable: "", notas: "",
  etiquetas: [], creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString(), extra: {},
});

/* De menor a mayor: el orden importa para poder ordenar la columna, no
   alfabeticamente — "basico" antes que "nativo" no dice nada. */
const ORDEN_INGLES = ["ninguno", "basico", "intermedio", "conversacional", "nativo"] as const;

const ETIQUETA_INGLES: Record<string, string> = {
  ninguno: "Ninguno", basico: "Básico", intermedio: "Intermedio",
  conversacional: "Conversacional", nativo: "Nativo",
};

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

  function guardar() {
    if (!form) return;
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

  const columnas: Columna<Lead>[] = [
    {
      clave: "nombre", titulo: "Lead", tipo: "primary", orden: (l) => l.nombre,
      celda: (l) => <Persona nombre={l.nombre} sub={l.email} />,
    },
    {
      clave: "etapa", titulo: "Etapa", orden: (l) => etapaDe(l.etapaId)?.orden ?? 99,
      celda: (l) => {
        const et = etapaDe(l.etapaId);
        return et ? <Badge variante={et.variante}>{et.nombre}</Badge> : <span>—</span>;
      },
    },
    { clave: "fuente", titulo: "Fuente", tipo: "secondary", orden: (l) => l.fuente, celda: (l) => l.fuente || "—" },
    { clave: "pais", titulo: "País", tipo: "secondary", orden: (l) => l.pais ?? "", celda: (l) => l.pais || "—" },
    {
      clave: "ingles", titulo: "Inglés", tipo: "secondary",
      orden: (l) => ORDEN_INGLES.indexOf(l.inglesNivel ?? "ninguno"),
      celda: (l) => (l.inglesNivel
        ? <Badge variante={l.inglesNivel === "conversacional" || l.inglesNivel === "nativo" ? "success" : "neutral"}>{ETIQUETA_INGLES[l.inglesNivel]}</Badge>
        : "—"),
    },
    { clave: "exp", titulo: "Años exp.", tipo: "num", orden: (l) => l.aniosExperiencia ?? -1, celda: (l) => (l.aniosExperiencia == null ? "—" : num(l.aniosExperiencia)) },
    { clave: "monto", titulo: "Valor", tipo: "num", orden: (l) => l.monto, celda: (l) => money(l.monto, l.moneda) },
    { clave: "act", titulo: "Últ. cambio", tipo: "secondary", orden: (l) => l.actualizadoEn, celda: (l) => relativo(l.actualizadoEn) },
  ];

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
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar lead" : "Nuevo lead"}
          sub={form.id ? "Cambiá lo que necesites y guardá." : "Sólo el nombre es obligatorio. El resto lo completás cuando lo tengas."}
          guardarTexto={form.id ? "Guardar cambios" : "Crear lead"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Nombre y apellido" ayuda="Lo único obligatorio.">
              <Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Martín Quiroga" autoFocus />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(ev) => setForm({ ...form, email: ev.target.value })} placeholder="martin@gmail.com" />
            </Field>
            <Field label="Teléfono">
              <Input value={form.telefono ?? ""} onChange={(ev) => setForm({ ...form, telefono: ev.target.value })} placeholder="+54 9 11 5555-5555" />
            </Field>
            <Field label="País">
              <Input value={form.pais ?? ""} onChange={(ev) => setForm({ ...form, pais: ev.target.value })} placeholder="Argentina" />
            </Field>
            <Field label="Etapa" ayuda="Después la cambiás arrastrando en el Pipeline.">
              <Select value={form.etapaId} onChange={(ev) => setForm({ ...form, etapaId: ev.target.value })}
                opciones={[...e.etapas].sort((a, b) => a.orden - b.orden).map((x) => ({ valor: x.id, texto: x.nombre }))} />
            </Field>
            <Field label="Fuente" ayuda="De dónde vino.">
              <Select value={form.fuente} onChange={(ev) => setForm({ ...form, fuente: ev.target.value })} opciones={e.ajustes.fuentes} placeholder="Elegí una" />
            </Field>
            <Field label="Inglés" ayuda="Conversacional es el corte: abajo de eso no da una entrevista en USA.">
              <Select
                value={form.inglesNivel ?? ""}
                onChange={(ev) => setForm({ ...form, inglesNivel: (ev.target.value || undefined) as Lead["inglesNivel"] })}
                placeholder="Sin evaluar"
                opciones={ORDEN_INGLES.map((n) => ({ valor: n, texto: ETIQUETA_INGLES[n] }))}
              />
            </Field>
            <Field label="Años de experiencia" ayuda="Vacío es «no sabemos»; 0 es «sin experiencia».">
              <Input
                type="number" min={0} value={form.aniosExperiencia ?? ""}
                onChange={(ev) => setForm({ ...form, aniosExperiencia: ev.target.value === "" ? undefined : Number(ev.target.value) })}
              />
            </Field>
            <Field label="Valor" ayuda="Cuánto vale si cierra.">
              <Input type="number" min={0} value={form.monto} onChange={(ev) => setForm({ ...form, monto: Number(ev.target.value) })} />
            </Field>
            <Field label="Moneda">
              <Select value={form.moneda} onChange={(ev) => setForm({ ...form, moneda: ev.target.value as Moneda })} opciones={["USD", "ARS"]} />
            </Field>
            <Field label="Campaña" ayuda="Si vino de un anuncio, cuál.">
              <Input value={form.campania ?? ""} onChange={(ev) => setForm({ ...form, campania: ev.target.value })} placeholder="Remoto-USA-Frío" />
            </Field>
            <Field label="Responsable">
              <Input value={form.responsable} onChange={(ev) => setForm({ ...form, responsable: ev.target.value })} placeholder={e.ajustes.responsable} />
            </Field>
            <Field label="Notas" span2 ayuda="Lo que hablaron, qué necesita, cuándo volver a escribirle.">
              <Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} />
            </Field>
            <CamposExtra
              campos={e.campos} entidad="lead" valores={form.extra}
              onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })}
            />
          </div>
        </ModalForm>
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
