"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EtapasServicio } from "@/components/alumnos/EtapasServicio";
import {
  AlertTriangle, Check, Database, Download, GripVertical, Info, Layers, ListPlus,
  Moon, Plug, Plus, Settings2, Sun, Trash2, Upload, X,
} from "lucide-react";
import { CatalogosVenta } from "@/components/ajustes/CatalogosVenta";
import { ConfigUtms } from "@/components/ajustes/ConfigUtms";
import { FormulariosMeta } from "@/components/ajustes/FormulariosMeta";
import { YoutubeIntegracion } from "@/components/ajustes/YoutubeIntegracion";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input,
  Select, Switch, Tabs, Tag,
} from "@/components/ui/ui";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado, useTema } from "@/lib/store";
import { num, relativo } from "@/lib/format";
import type { Ajustes as TAjustes, CampoPersonalizado, EntidadNombre, Etapa, TipoCampo } from "@/lib/types";

type Seccion = "negocio" | "ventas" | "utms" | "pipeline" | "listas" | "campos" | "integraciones" | "datos";

const ENTIDADES: { valor: EntidadNombre; texto: string }[] = [
  { valor: "lead", texto: "Leads" },
  { valor: "alumno", texto: "Alumnos" },
  { valor: "sesion", texto: "Sesiones" },
  { valor: "webinar", texto: "Webinars" },
  { valor: "campania", texto: "Campañas" },
  { valor: "transaccion", texto: "Movimientos" },
];

const TIPOS: { valor: TipoCampo; texto: string }[] = [
  { valor: "texto", texto: "Texto corto" },
  { valor: "texto-largo", texto: "Texto largo" },
  { valor: "numero", texto: "Número" },
  { valor: "moneda", texto: "Monto" },
  { valor: "fecha", texto: "Fecha" },
  { valor: "seleccion", texto: "Lista de opciones" },
  { valor: "booleano", texto: "Sí / No" },
  { valor: "email", texto: "Email" },
  { valor: "telefono", texto: "Teléfono" },
  { valor: "url", texto: "Enlace" },
];

const VARIANTES: Etapa["variante"][] = ["info", "brand", "accent", "warning", "success", "danger", "neutral"];

const SECCIONES: Seccion[] = ["negocio", "ventas", "utms", "pipeline", "listas", "campos", "integraciones", "datos"];

export default function Ajustes() {
  /* Se puede entrar directo a una sección por link: el pipeline de alumnos
     lleva a /ajustes?seccion=pipeline&pipeline=servicio para editar sus etapas. */
  const params = useSearchParams();
  const [seccion, setSeccion] = useState<Seccion>(() => {
    const s = params.get("seccion") as Seccion | null;
    return s && SECCIONES.includes(s) ? s : "negocio";
  });
  const [tema, setTema] = useTema();

  return (
    <div className="stack-5">
      <PageHead
        titulo="Ajustes"
        sub="Acá cambiás cómo funciona Apicanta: las etapas, las listas, los campos de cada ficha y las conexiones. Nada está fijo."
      />

      <Tabs
        valor={seccion} onChange={setSeccion}
        opciones={[
          { valor: "negocio", texto: "Negocio" },
          { valor: "ventas", texto: "Ventas" },
          { valor: "utms", texto: "UTMs" },
          { valor: "pipeline", texto: "Etapas" },
          { valor: "listas", texto: "Listas" },
          { valor: "campos", texto: "Campos propios" },
          { valor: "integraciones", texto: "Integraciones" },
          { valor: "datos", texto: "Datos" },
        ]}
      />

      {seccion === "negocio" && <Negocio tema={tema} setTema={setTema} />}
      {seccion === "ventas" && <CatalogosVenta />}
      {seccion === "utms" && <ConfigUtms />}
      {seccion === "pipeline" && <EtapasDeLosPipelines />}
      {seccion === "listas" && <Listas />}
      {seccion === "campos" && <Campos />}
      {seccion === "integraciones" && <Integraciones />}
      {seccion === "datos" && <Datos />}

      {seccion === "negocio" && (
        <Ayuda titulo="Los cambios se guardan al instante" icono={<Info size={18} />}>
          No hay botón de «guardar todo»: cada cosa que tocás queda aplicada apenas salís del campo,
          y el cambio se registra en Actividad por si después querés saber qué pasó.
        </Ayuda>
      )}    </div>
  );
}

/* ---------------- Negocio ---------------- */

function Negocio({ tema, setTema }: { tema: "dark" | "light"; setTema: (t: "dark" | "light") => void }) {
  const e = useEstado();
  const toast = useToast();
  const [borrador, setBorrador] = useState<Partial<TAjustes>>({});
  const v = <K extends keyof TAjustes>(k: K): TAjustes[K] => (borrador[k] ?? e.ajustes[k]) as TAjustes[K];

  function aplicar<K extends keyof TAjustes>(k: K) {
    if (borrador[k] === undefined || borrador[k] === e.ajustes[k]) return;
    acciones.ajustes({ [k]: borrador[k] } as Partial<TAjustes>);
    toast("Guardado.");
    setBorrador((b) => { const n = { ...b }; delete n[k]; return n; });
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead titulo="Tu negocio" sub="Cómo se llama y quién lo maneja. Aparece en la barra lateral y en los registros de actividad." />
        <div className="form-grid">
          <Field label="Nombre del negocio">
            <Input value={v("negocio")} onChange={(ev) => setBorrador({ ...borrador, negocio: ev.target.value })} onBlur={() => aplicar("negocio")} placeholder="Hackear IT" />
          </Field>
          <Field label="Responsable" ayuda="Quién queda como autor de los cambios.">
            <Input value={v("responsable")} onChange={(ev) => setBorrador({ ...borrador, responsable: ev.target.value })} onBlur={() => aplicar("responsable")} placeholder="Yari Taft" />
          </Field>
          <Field label="Moneda base" ayuda="En la que se muestran todos los totales.">
            <Select value={v("monedaBase")} onChange={(ev) => { acciones.ajustes({ monedaBase: ev.target.value as "USD" | "ARS" }); toast("Moneda actualizada."); }} opciones={["USD", "ARS"]} />
          </Field>
          <Field label="Tipo de cambio" ayuda="Cuántos pesos vale un dólar.">
            <Input type="number" min={1} value={v("tipoCambio")} onChange={(ev) => setBorrador({ ...borrador, tipoCambio: Number(ev.target.value) })} onBlur={() => aplicar("tipoCambio")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHead titulo="Apariencia" sub="El oscuro es el tema de la marca. El claro va bien para sesiones largas o para imprimir." />
        <div className="row-wrap">
          <Button variante={tema === "dark" ? "brand" : "secondary"} icono={<Moon size={16} />} onClick={() => setTema("dark")}>Oscuro</Button>
          <Button variante={tema === "light" ? "brand" : "secondary"} icono={<Sun size={16} />} onClick={() => setTema("light")}>Claro</Button>
        </div>
      </Card>

      <Card>
        <CardHead titulo="Guía de bienvenida" sub="El recorrido de 5 pasos que se muestra la primera vez." />
        <div className="row-3">
          <Switch checked={!e.ajustes.tourVisto} onChange={(x) => { acciones.ajustesSilencioso({ tourVisto: !x }); toast(x ? "Se va a mostrar al recargar." : "Desactivada."); }} etiqueta="Mostrar la guía" />
          <span className="t-body t-muted">Volver a mostrar la guía la próxima vez que abra Apicanta</span>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Etapas ---------------- */

/* Hay dos tableros: el de ventas (leads, lo de siempre) y el de servicio
   (alumnos, desde que compran hasta que terminan). Cada uno con sus etapas. */
function EtapasDeLosPipelines() {
  const params = useSearchParams();
  const [cual, setCual] = useState<"ventas" | "servicio">(
    params.get("pipeline") === "servicio" ? "servicio" : "ventas",
  );
  return (
    <div className="stack-4">
      <Tabs
        valor={cual} onChange={setCual}
        opciones={[
          { valor: "ventas", texto: "Pipeline de ventas" },
          { valor: "servicio", texto: "Pipeline de servicio" },
        ]}
      />
      {cual === "ventas" ? <Etapas /> : <EtapasServicio />}
    </div>
  );
}

function Etapas() {
  const e = useEstado();
  const toast = useToast();
  const [form, setForm] = useState<(Omit<Etapa, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Etapa | null>(null);

  const ordenadas = [...e.etapas].sort((a, b) => a.orden - b.orden);

  function mover(et: Etapa, dir: -1 | 1) {
    const i = ordenadas.findIndex((x) => x.id === et.id);
    const j = i + dir;
    if (j < 0 || j >= ordenadas.length) return;
    const a = ordenadas[i], b = ordenadas[j];
    acciones.actualizarSilencioso<Etapa>("etapas", a.id, { orden: b.orden });
    acciones.actualizarSilencioso<Etapa>("etapas", b.id, { orden: a.orden });
  }

  function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) { toast("Ponele un nombre a la etapa.", "err"); return; }
    if (form.id) { acciones.actualizar<Etapa>("etapas", form.id, form, form.nombre); toast("Etapa actualizada."); }
    else { acciones.crear<Etapa>("etapas", { ...form, orden: e.etapas.length }, form.nombre); toast(`Etapa «${form.nombre}» creada.`); }
    setForm(null);
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="Etapas del pipeline"
          sub="Las columnas del tablero, en orden. La probabilidad se usa para calcular el pipeline ponderado."
          acciones={<Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({ nombre: "", variante: "brand", probabilidad: 50, orden: e.etapas.length })}>Nueva etapa</Button>}
        />
        <div className="stack-2">
          {ordenadas.map((et, i) => (
            <div key={et.id} className="agenda-item" style={{ cursor: "default" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <IconButton etiqueta="Subir" onClick={() => mover(et, -1)} disabled={i === 0} style={{ height: 18 }}>▲</IconButton>
                <IconButton etiqueta="Bajar" onClick={() => mover(et, 1)} disabled={i === ordenadas.length - 1} style={{ height: 18 }}>▼</IconButton>
              </span>
              <GripVertical size={16} color="var(--ink-subtle)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <Badge variante={et.variante}>{et.nombre}</Badge>
              </span>
              <span className="t-sm t-subtle t-num">{et.probabilidad}% de cierre</span>
              <span className="t-sm t-subtle">{e.leads.filter((l) => l.etapaId === et.id).length} leads</span>
              {et.esGanada && <Tag>Ganada</Tag>}
              {et.esPerdida && <Tag>Perdida</Tag>}
              <span style={{ display: "flex", gap: 2 }}>
                <IconButton etiqueta="Editar" onClick={() => setForm({ ...et })}><Settings2 size={15} /></IconButton>
                <IconButton etiqueta="Eliminar" onClick={() => setBorrar(et)}><Trash2 size={15} /></IconButton>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Ayuda titulo="Qué pasa si borrás una etapa" icono={<AlertTriangle size={18} />}>
        Los leads que estaban ahí no se borran, pero quedan sin etapa hasta que los muevas. Conviene mover los leads
        primero y borrar la etapa después. La etapa marcada como <strong>ganada</strong> es la que dispara el
        contador de inscriptos; la <strong>perdida</strong> queda fuera del pipeline abierto.
      </Ayuda>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar}
          titulo={form.id ? "Editar etapa" : "Nueva etapa"}
          sub="El nombre es el que se ve en la columna del tablero."
          guardarTexto={form.id ? "Guardar" : "Crear etapa"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <Field label="Nombre"><Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Propuesta enviada" autoFocus /></Field>
          <Field label="Color" ayuda="Cómo se ve el cartelito de estado.">
            <Select value={form.variante} onChange={(ev) => setForm({ ...form, variante: ev.target.value as Etapa["variante"] })}
              opciones={VARIANTES.map((x) => ({ valor: x, texto: { info: "Violeta claro", brand: "Violeta", accent: "Naranja", warning: "Amarillo", success: "Verde", danger: "Rojo", neutral: "Gris" }[x] }))} />
            <div style={{ marginTop: 8 }}><Badge variante={form.variante}>{form.nombre || "Vista previa"}</Badge></div>
          </Field>
          <Field label="Probabilidad de cierre" ayuda={`${form.probabilidad}% — se usa para el pipeline ponderado.`}>
            <Input type="range" min={0} max={100} step={5} value={form.probabilidad} onChange={(ev) => setForm({ ...form, probabilidad: Number(ev.target.value) })} />
          </Field>
          <div className="row-3">
            <Switch checked={Boolean(form.esGanada)} onChange={(x) => setForm({ ...form, esGanada: x, esPerdida: x ? false : form.esPerdida })} etiqueta="Es la etapa ganada" />
            <span className="t-body t-muted">Es la etapa de <strong>cerrado ganado</strong> (cuenta como inscripto)</span>
          </div>
          <div className="row-3">
            <Switch checked={Boolean(form.esPerdida)} onChange={(x) => setForm({ ...form, esPerdida: x, esGanada: x ? false : form.esGanada })} etiqueta="Es la etapa perdida" />
            <span className="t-body t-muted">Es la etapa de <strong>perdido</strong> (sale del pipeline abierto)</span>
          </div>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la etapa «${borrar?.nombre}»?`}
        texto={`${e.leads.filter((l) => l.etapaId === borrar?.id).length} leads están en esta etapa y van a quedar sin columna. Movelos primero si querés conservarlos ordenados.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("etapas", borrar.id, borrar.nombre); toast("Etapa eliminada."); } }}
      />
    </div>
  );
}

/* ---------------- Listas ---------------- */

const LISTAS: { clave: keyof TAjustes; titulo: string; sub: string }[] = [
  { clave: "fuentes", titulo: "Fuentes de leads", sub: "De dónde puede venir alguien." },
  { clave: "planes", titulo: "Planes", sub: "Los programas que vendés." },
  { clave: "tiposSesion", titulo: "Tipos de sesión", sub: "Las clases de llamada que hacés." },
  { clave: "categoriasIngreso", titulo: "Categorías de ingreso", sub: "Cómo clasificás la plata que entra." },
  { clave: "categoriasEgreso", titulo: "Categorías de egreso", sub: "Cómo clasificás la plata que sale." },
  { clave: "metodosPago", titulo: "Métodos de pago", sub: "Por dónde cobrás y pagás." },
];

function Listas() {
  return (
    <div className="grid-2">
      {LISTAS.map((l) => <ListaEditable key={String(l.clave)} clave={l.clave} titulo={l.titulo} sub={l.sub} />)}
    </div>
  );
}

function ListaEditable({ clave, titulo, sub }: { clave: keyof TAjustes; titulo: string; sub: string }) {
  const e = useEstado();
  const toast = useToast();
  const [nuevo, setNuevo] = useState("");
  const items = (e.ajustes[clave] as string[]) ?? [];

  function agregar() {
    const t = nuevo.trim();
    if (!t) return;
    if (items.includes(t)) { toast("Esa opción ya está en la lista.", "err"); return; }
    acciones.ajustes({ [clave]: [...items, t] } as Partial<TAjustes>, `Se agregó «${t}» a ${titulo.toLowerCase()}.`);
    setNuevo("");
    toast(`«${t}» agregado.`);
  }

  function quitar(x: string) {
    acciones.ajustes({ [clave]: items.filter((i) => i !== x) } as Partial<TAjustes>, `Se quitó «${x}» de ${titulo.toLowerCase()}.`);
    toast(`«${x}» quitado.`);
  }

  return (
    <Card>
      <CardHead titulo={titulo} sub={sub} />
      <div className="row-wrap" style={{ marginBottom: 14, minHeight: 32 }}>
        {items.length === 0 && <span className="t-sm t-subtle">La lista está vacía. Agregá la primera opción abajo.</span>}
        {items.map((x) => (
          <span key={x} className="chip" style={{ cursor: "default" }}>
            {x}
            <button
              type="button" aria-label={`Quitar ${x}`} onClick={() => quitar(x)}
              style={{ background: "none", border: 0, cursor: "pointer", display: "grid", placeItems: "center", padding: 0, marginLeft: 2, color: "var(--ink-subtle)" }}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={(ev) => { ev.preventDefault(); agregar(); }} className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} placeholder="Agregar una opción…" aria-label={`Agregar a ${titulo}`} />
        </div>
        <Button variante="secondary" type="submit" icono={<Plus size={16} />} disabled={!nuevo.trim()}>Agregar</Button>
      </form>
    </Card>
  );
}

/* ---------------- Campos propios ---------------- */

function Campos() {
  const e = useEstado();
  const toast = useToast();
  const [form, setForm] = useState<(Omit<CampoPersonalizado, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<CampoPersonalizado | null>(null);
  const [opciones, setOpciones] = useState("");

  function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) { toast("Ponele un nombre al campo.", "err"); return; }
    const clave = form.clave || form.nombre.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
    const datos = { ...form, clave, opciones: form.tipo === "seleccion" ? opciones.split(",").map((s) => s.trim()).filter(Boolean) : undefined };
    if (form.id) { acciones.actualizar<CampoPersonalizado>("campos", form.id, datos, form.nombre); toast("Campo actualizado."); }
    else { acciones.crear<CampoPersonalizado>("campos", datos, form.nombre); toast(`Campo «${form.nombre}» agregado a ${ENTIDADES.find((x) => x.valor === form.entidad)?.texto}.`); }
    setForm(null); setOpciones("");
  }

  return (
    <div className="stack-4">
      <Ayuda titulo="Agregá los datos que a vos te importan" icono={<ListPlus size={18} />}>
        Un campo propio aparece en el formulario y en la ficha de la entidad que elijas. Por ejemplo: «Nivel de inglés»
        en los leads, o «Empresa donde entró» en los alumnos. Los campos que crees se aplican a todos los registros
        nuevos y a los que ya existen.
      </Ayuda>

      <Card>
        <CardHead
          titulo="Campos personalizados"
          sub={`${e.campos.length} campos propios definidos.`}
          acciones={<Button sm variante="primary" icono={<Plus size={15} />} onClick={() => { setForm({ entidad: "lead", nombre: "", clave: "", tipo: "texto", requerido: false }); setOpciones(""); }}>Nuevo campo</Button>}
        />
        {e.campos.length === 0 ? (
          <Empty
            icono={<Layers size={22} />}
            titulo="Todavía no agregaste campos propios"
            texto="Las fichas ya traen lo básico. Si necesitás guardar algo más — nivel de inglés, empresa, seniority — agregalo acá y aparece en el formulario."
            accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => { setForm({ entidad: "lead", nombre: "", clave: "", tipo: "texto", requerido: false }); setOpciones(""); }}>Agregar un campo</Button>}
          />
        ) : (
          <div className="stack-2">
            {ENTIDADES.filter((en) => e.campos.some((c) => c.entidad === en.valor)).map((en) => (
              <div key={en.valor}>
                <div className="t-label" style={{ margin: "10px 0 8px" }}>{en.texto}</div>
                <div className="stack-2">
                  {e.campos.filter((c) => c.entidad === en.valor).map((c) => (
                    <div key={c.id} className="agenda-item" style={{ cursor: "default" }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="t-strong truncate" style={{ display: "block", color: "var(--ink)" }}>{c.nombre}</span>
                        <span className="t-sm t-subtle truncate" style={{ display: "block" }}>
                          {TIPOS.find((t) => t.valor === c.tipo)?.texto}
                          {c.opciones?.length ? ` · ${c.opciones.join(", ")}` : ""}
                        </span>
                      </span>
                      {c.requerido && <Badge variante="accent">Obligatorio</Badge>}
                      <span style={{ display: "flex", gap: 2 }}>
                        <IconButton etiqueta="Editar" onClick={() => { setForm({ ...c }); setOpciones((c.opciones ?? []).join(", ")); }}><Settings2 size={15} /></IconButton>
                        <IconButton etiqueta="Eliminar" onClick={() => setBorrar(c)}><Trash2 size={15} /></IconButton>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar}
          titulo={form.id ? "Editar campo" : "Nuevo campo"}
          sub="Elegí en qué ficha aparece y qué tipo de dato guarda."
          guardarTexto={form.id ? "Guardar" : "Agregar campo"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <Field label="¿En qué ficha aparece?">
            <Select value={form.entidad} onChange={(ev) => setForm({ ...form, entidad: ev.target.value as EntidadNombre })} opciones={ENTIDADES} />
          </Field>
          <Field label="Nombre del campo" ayuda="Así lo vas a ver en el formulario.">
            <Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Nivel de inglés" autoFocus />
          </Field>
          <Field label="Tipo de dato">
            <Select value={form.tipo} onChange={(ev) => setForm({ ...form, tipo: ev.target.value as TipoCampo })} opciones={TIPOS} />
          </Field>
          {form.tipo === "seleccion" && (
            <Field label="Opciones" ayuda="Separadas por coma.">
              <Input value={opciones} onChange={(ev) => setOpciones(ev.target.value)} placeholder="Básico, Intermedio, Avanzado" />
            </Field>
          )}
          <Field label="Texto de ayuda" ayuda="Opcional. Una línea abajo del campo para aclarar qué poner.">
            <Input value={form.ayuda ?? ""} onChange={(ev) => setForm({ ...form, ayuda: ev.target.value })} placeholder="Según el último test que hizo" />
          </Field>
          <div className="row-3">
            <Switch checked={form.requerido} onChange={(x) => setForm({ ...form, requerido: x })} etiqueta="Campo obligatorio" />
            <span className="t-body t-muted">Obligatorio para poder guardar</span>
          </div>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar el campo «${borrar?.nombre}»?`}
        texto="Deja de aparecer en los formularios. Los datos que ya cargaste en ese campo quedan guardados por si lo volvés a crear."
        onConfirmar={() => { if (borrar) { acciones.eliminar("campos", borrar.id, borrar.nombre); toast("Campo eliminado."); } }}
      />
    </div>
  );
}

/* ---------------- Integraciones ---------------- */

function Integraciones() {
  return (
    <div className="stack-4">
      <Ayuda titulo="Apicanta funciona sin conectar nada" icono={<Info size={18} />}>
        Todo lo que ves anda cargando los datos a mano. Estas conexiones son para ahorrarte ese trabajo: cuando estén
        puestas, la inversión de Meta, las sesiones de Calendly y los vivos de YouTube entran solos. Las claves viven
        en el servidor (en Vercel), nunca en esta pantalla.
      </Ayuda>

      <EstadoMeta />
      <FormulariosMeta />
      <EstadoCalendly />
      <YoutubeIntegracion />
    </div>
  );
}

/* Meta se conecta del lado del servidor: con el token del negocio
   (META_SYSTEM_TOKEN, en Vercel) o con el login de Meta desde Marketing.
   Acá se muestra si está andando preguntándole a la misma ruta que usa
   Marketing. Antes había dos campos para pegar la cuenta y el token a mano,
   pero nada los leía: decían "Sin configurar" con Meta conectado. */
function EstadoMeta() {
  const [estado, setEstado] = useState<
    { conectado: boolean; porSistema?: boolean; cuentas?: { id: string; nombre: string }[]; motivo?: string } | null
  >(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/meta/cuentas", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo) setEstado(j); })
      .catch(() => { if (vivo) setEstado({ conectado: false, motivo: "error" }); });
    return () => { vivo = false; };
  }, []);

  /* Meta frenó por límite: la conexión está bien, sólo hay que esperar. */
  const conectado = Boolean(estado?.conectado || estado?.motivo === "limite");
  const cuentas = estado?.cuentas ?? [];

  return (
    <Card>
      <CardHead
        titulo="Meta Ads"
        sub="La inversión, las campañas y los anuncios entran solos a Marketing."
        acciones={
          <Badge variante={conectado ? "success" : "neutral"} icono={conectado ? <Check size={13} /> : <Plug size={13} />}>
            {estado === null ? "Revisando…" : conectado ? "Conectado" : "Sin conectar"}
          </Badge>
        }
      />
      <p className="t-sm t-muted">
        {estado === null
          ? "Preguntándole a Meta…"
          : conectado
            ? estado.porSistema
              ? "Conectado con el token del negocio, configurado en el servidor: no depende de quién tenga la sesión abierta."
              : "Conectado con tu sesión de Meta, en este navegador."
            : estado.motivo === "sin-configurar"
              ? "Falta configurar en el servidor el token del negocio (META_SYSTEM_TOKEN) o la app de Meta."
              : estado.motivo === "error"
                ? "Meta no respondió bien. Probá de nuevo en un rato."
                : "Falta conectar tu cuenta de Meta: se hace con un clic desde Marketing."}
      </p>
      <p className="t-sm t-subtle" style={{ marginTop: 8 }}>
        {conectado && cuentas.length > 0
          ? `${num(cuentas.length)} ${cuentas.length === 1 ? "cuenta publicitaria" : "cuentas publicitarias"}: ${cuentas.map((c) => c.nombre).join(", ")}. `
          : ""}
        <Link href="/marketing" className="link">{conectado ? "Ver en Marketing" : "Ir a Marketing para conectar"}</Link>
      </p>
    </Card>
  );
}

/* Calendly se conecta del lado del servidor: el token vive en Vercel, no en
   esta pantalla (antes se guardaba en Ajustes, donde lo podía leer cualquiera
   que abriera la app). Acá sólo se muestra si está andando, preguntándole al
   propio webhook, y qué entró. */
function EstadoCalendly() {
  const e = useEstado();
  const [listo, setListo] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/calendly/webhook")
      .then((r) => r.json())
      .then((j: { listo?: boolean }) => { if (vivo) setListo(Boolean(j.listo)); })
      .catch(() => { if (vivo) setListo(false); });
    return () => { vivo = false; };
  }, []);
  /* Sólo las que trajo la integración: tienen el invitado de Calendly. Los
     datos de ejemplo también dicen origen "calendly" y harían creer que ya
     entraron llamadas que nunca existieron. */
  const deCalendly = e.sesiones.filter((s) => s.calendlyInvitadoUri);
  const ultima = deCalendly.reduce<string | null>((m, s) => (!m || s.creadoEn > m ? s.creadoEn : m), null);

  return (
    <Card>
      <CardHead
        titulo="Calendly"
        sub="Cada agenda, cancelación y no-show de la organización entra sola a la Agenda."
        acciones={
          <Badge variante={listo ? "success" : "neutral"} icono={listo ? <Check size={13} /> : <Plug size={13} />}>
            {listo === null ? "Revisando…" : listo ? "Conectado" : "Sin configurar"}
          </Badge>
        }
      />
      <p className="t-sm t-muted">
        {listo
          ? "Entra en segundos por webhook, y cada 30 minutos se repescan las que se hayan perdido. Trae el canal, los UTMs y lo que la persona contestó en el formulario."
          : "Falta configurar en el servidor el token de Calendly y la clave de firma del webhook."}
      </p>
      <p className="t-sm t-subtle" style={{ marginTop: 8 }}>
        {deCalendly.length
          ? `${num(deCalendly.length)} ${deCalendly.length === 1 ? "llamada entró" : "llamadas entraron"} por Calendly · la última, ${relativo(ultima ?? "")}.`
          : "Todavía no entró ninguna llamada por Calendly."}
      </p>
    </Card>
  );
}

/* ---------------- Datos ---------------- */

function Datos() {
  const e = useEstado();
  const toast = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [confirmar, setConfirmar] = useState<"demo" | "vaciar" | null>(null);

  function exportar() {
    const blob = new Blob([acciones.exportar()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apicanta-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Respaldo descargado.");
  }

  function importar(f: File) {
    const lector = new FileReader();
    lector.onload = () => {
      const ok = acciones.importar(String(lector.result));
      toast(ok ? "Datos restaurados." : "El archivo no tiene el formato correcto.", ok ? "ok" : "err");
    };
    lector.readAsText(f);
  }

  const conteos = [
    ["Leads", e.leads.length], ["Alumnos", e.alumnos.length], ["Sesiones", e.sesiones.length],
    ["Webinars", e.webinars.length], ["Campañas", e.campaigns.length],
    ["Ventas", e.ventas.length], ["Pagos", e.pagos.length], ["Gastos", e.gastos.length],
    ["Reportes", e.reportes.length], ["Metas", e.metas.length],
  ] as const;

  return (
    <div className="stack-4">
      <Card>
        <CardHead titulo="Qué hay cargado" sub="Todo esto vive en este navegador." />
        <div className="grid-stats" style={{ gap: 12 }}>
          {conteos.map(([k, n]) => (
            <div key={k} style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <div className="t-label" style={{ marginBottom: 4 }}>{k}</div>
              <div className="t-num" style={{ fontSize: 22, fontWeight: 600 }}>{n}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead titulo="Respaldo" sub="Bajate todo en un archivo, o restaurá uno que hayas guardado antes." />
        <div className="row-wrap">
          <Button variante="secondary" icono={<Download size={16} />} onClick={exportar}>Descargar respaldo</Button>
          <Button variante="secondary" icono={<Upload size={16} />} onClick={() => archivo.current?.click()}>Restaurar desde archivo</Button>
          <input
            ref={archivo} type="file" accept="application/json" style={{ display: "none" }}
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) importar(f); ev.target.value = ""; }}
          />
        </div>
      </Card>

      <Card>
        <CardHead titulo="Empezar de nuevo" sub="Cuando termines de probar y quieras cargar tus datos de verdad." />
        <div className="row-wrap">
          <Button variante="secondary" onClick={() => setConfirmar("demo")}>Volver a los datos de ejemplo</Button>
          <Button variante="danger" icono={<Trash2 size={16} />} onClick={() => setConfirmar("vaciar")}>Vaciar todo</Button>
        </div>
      </Card>

      <Ayuda titulo="Dónde vive tu información" icono={<Database size={18} />}>
        Por ahora Apicanta guarda todo en este navegador, así que es privado y funciona sin internet, pero no se
        comparte entre dispositivos. Bajate un respaldo de vez en cuando. Cuando conectemos la base de datos, los
        datos pasan a estar en la nube y se sincronizan solos — la app no cambia en nada.
      </Ayuda>

      <Confirmar
        abierto={confirmar === "demo"} onCerrar={() => setConfirmar(null)}
        titulo="¿Volver a los datos de ejemplo?"
        texto="Se reemplaza todo lo que tengas cargado por el juego de datos de demostración. Bajate un respaldo antes si hay algo que quieras conservar."
        confirmarTexto="Cargar ejemplo"
        onConfirmar={() => { acciones.reiniciarDemo(); toast("Datos de ejemplo recargados."); }}
      />
      <Confirmar
        abierto={confirmar === "vaciar"} onCerrar={() => setConfirmar(null)}
        titulo="¿Vaciar todo?"
        texto="Se borran todos los leads, alumnos, sesiones, webinars, campañas y movimientos. Las etapas y las listas quedan. Esto no se puede deshacer."
        confirmarTexto="Vaciar todo"
        onConfirmar={() => { acciones.vaciarTodo(); toast("Espacio de trabajo vacío. Ya podés cargar tus datos."); }}
      />
    </div>
  );
}
