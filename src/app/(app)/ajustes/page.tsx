"use client";

import React, { useRef, useState } from "react";
import {
  AlertTriangle, Check, Database, Download, GripVertical, Info, Layers, ListPlus,
  Moon, Plug, Plus, Settings2, Sun, Trash2, Upload, X,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input,
  Select, Switch, Tabs, Tag,
} from "@/components/ui/ui";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado, useTema } from "@/lib/store";
import type { Ajustes as TAjustes, CampoPersonalizado, EntidadNombre, Etapa, TipoCampo } from "@/lib/types";

type Seccion = "negocio" | "pipeline" | "listas" | "campos" | "integraciones" | "datos";

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

export default function Ajustes() {
  const [seccion, setSeccion] = useState<Seccion>("negocio");
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
          { valor: "pipeline", texto: "Etapas" },
          { valor: "listas", texto: "Listas" },
          { valor: "campos", texto: "Campos propios" },
          { valor: "integraciones", texto: "Integraciones" },
          { valor: "datos", texto: "Datos" },
        ]}
      />

      {seccion === "negocio" && <Negocio tema={tema} setTema={setTema} />}
      {seccion === "pipeline" && <Etapas />}
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
  const e = useEstado();
  const toast = useToast();
  const [b, setB] = useState<Partial<TAjustes>>({});
  const v = <K extends keyof TAjustes>(k: K) => (b[k] ?? e.ajustes[k]) as string;
  const aplicar = <K extends keyof TAjustes>(k: K) => {
    if (b[k] === undefined || b[k] === e.ajustes[k]) return;
    acciones.ajustes({ [k]: b[k] } as Partial<TAjustes>, "Se actualizó una integración.");
    toast("Guardado.");
    setB((x) => { const n = { ...x }; delete n[k]; return n; });
  };

  return (
    <div className="stack-4">
      <Ayuda titulo="Apicanta funciona sin conectar nada" icono={<Info size={18} />}>
        Todo lo que ves anda cargando los datos a mano. Estas conexiones son para ahorrarte ese trabajo: cuando estén
        puestas, la inversión de Meta y las sesiones de Calendly entran solas. Las claves quedan guardadas en este
        navegador, nunca se comparten.
      </Ayuda>

      <Card>
        <CardHead
          titulo="Meta Ads"
          sub="Para traer la inversión, las impresiones y los leads de tus campañas."
          acciones={<Badge variante={e.ajustes.metaToken ? "success" : "neutral"} icono={e.ajustes.metaToken ? <Check size={13} /> : <Plug size={13} />}>{e.ajustes.metaToken ? "Configurado" : "Sin configurar"}</Badge>}
        />
        <div className="form-grid">
          <Field label="ID de la cuenta publicitaria" ayuda="El número que empieza con act_">
            <Input value={v("metaAccountId")} onChange={(ev) => setB({ ...b, metaAccountId: ev.target.value })} onBlur={() => aplicar("metaAccountId")} placeholder="act_1234567890" />
          </Field>
          <Field label="Token de acceso" ayuda="Se guarda sólo en este navegador.">
            <Input type="password" value={v("metaToken")} onChange={(ev) => setB({ ...b, metaToken: ev.target.value })} onBlur={() => aplicar("metaToken")} placeholder="EAAG…" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHead
          titulo="Calendly"
          sub="Para que las llamadas que agenden tus leads caigan directo en la Agenda."
          acciones={<Badge variante={e.ajustes.calendlyToken ? "success" : "neutral"} icono={e.ajustes.calendlyToken ? <Check size={13} /> : <Plug size={13} />}>{e.ajustes.calendlyToken ? "Configurado" : "Sin configurar"}</Badge>}
        />
        <div className="form-grid">
          <Field label="Usuario de Calendly" ayuda="Tu nombre de usuario en la URL.">
            <Input value={v("calendlyUser")} onChange={(ev) => setB({ ...b, calendlyUser: ev.target.value })} onBlur={() => aplicar("calendlyUser")} placeholder="hackearit" />
          </Field>
          <Field label="Token personal" ayuda="Se guarda sólo en este navegador.">
            <Input type="password" value={v("calendlyToken")} onChange={(ev) => setB({ ...b, calendlyToken: ev.target.value })} onBlur={() => aplicar("calendlyToken")} placeholder="eyJ…" />
          </Field>
        </div>
      </Card>
    </div>
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
    ["Webinars", e.webinars.length], ["Campañas", e.campanias.length],
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
