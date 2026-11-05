"use client";

import React, { useEffect, useRef, useState } from "react";
import { EtapasServicio } from "@/components/alumnos/EtapasServicio";
import {
  Ban, ChevronDown, ChevronUp, Columns3, Database, Download, FileSignature, GraduationCap, GripVertical, Layers, Link2,
  ListPlus, MessageCircle, Moon, Package, PhoneCall, Plug, Plus, RefreshCw, Settings2, ShieldAlert, Sun, Trash2, Trophy, Upload, X,
} from "lucide-react";
import { CatalogosVenta } from "@/components/ajustes/CatalogosVenta";
import { CierreDelDiaAjustes } from "@/components/ajustes/CierreDelDiaAjustes";
import { ConfigUtms } from "@/components/ajustes/ConfigUtms";
import { EstadosDeLlamada } from "@/components/ajustes/EstadosDeLlamada";
import { WhatsappLector } from "@/components/ajustes/WhatsappLector";
import { Integraciones } from "@/components/ajustes/Integraciones";
import { ContratosYAccesos } from "@/components/ajustes/AccesosAlumnosIntegracion";
import {
  Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, Switch,
} from "@/components/ui/ui";
import { Plegable, Segmentado } from "@/components/finanzas/visual/visual";
import { InputMonto } from "@/components/ui/InputMonto";
import { montoDe } from "@/lib/monto";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado, useTema } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { num, relativo } from "@/lib/format";
import type { Ajustes as TAjustes, CampoPersonalizado, EntidadNombre, Etapa, TipoCampo } from "@/lib/types";
import { objecionesDe } from "@/lib/eod";
import { marcarRecargaPropia } from "@/components/shell/AvisoVersion";
import { hayNube } from "@/lib/supabase";
import { useParamsURL } from "@/lib/useParamsURL";
import { Fila } from "@/components/ajustes/Fila";
import "@/components/ajustes/ajustes.css";

/* ==================================================================
   Ajustes: cómo funciona Apicanta.

   Antes eran diez pestañas iguales, en una fila, con la URL fija en la
   primera y un párrafo de ayuda en casi todas (05/11, revisión de UX).
   Ahora es un menú a la izquierda, agrupado por para qué sirve cada cosa
   —como los ajustes de un teléfono—, y la sección elegida vive en la URL
   (?seccion=), así un link abre exactamente esa sección.

   Los links viejos siguen andando: ?seccion=listas abre CRM (las dos
   listas que se usan quedaron ahí) y ?seccion=pipeline&pipeline=servicio
   abre las etapas del servicio.
   ================================================================== */

type Seccion =
  | "negocio" | "ventas" | "utms" | "pipeline" | "crm" | "servicio" | "contratos"
  | "integraciones" | "whatsapp" | "campos" | "datos";

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

interface ItemMenu { valor: Seccion; texto: string; icono: React.ReactNode; sub: string; soloDuenos?: boolean }

const MENU: { grupo?: string; items: ItemMenu[] }[] = [
  { items: [{ valor: "negocio", texto: "General", icono: <Settings2 size={16} />, sub: "El nombre, la moneda y el tipo de cambio." }] },
  {
    grupo: "Ventas",
    items: [
      { valor: "ventas", texto: "Catálogo", icono: <Package size={16} />, sub: "Lo que se elige al cargar una venta: servicios, cuentas, estrategias y proyectos." },
      { valor: "utms", texto: "UTMs", icono: <Link2 size={16} />, sub: "Los links de cada vía y de qué estrategia es cada agenda." },
      { valor: "pipeline", texto: "Pipeline", icono: <Columns3 size={16} />, sub: "Las columnas del tablero de leads, en orden." },
      { valor: "crm", texto: "CRM y cierre del día", icono: <PhoneCall size={16} />, sub: "Los estados de cada llamada, los strikes y las listas que eligen los closers." },
    ],
  },
  {
    grupo: "Programa",
    items: [
      { valor: "servicio", texto: "Etapas del servicio", icono: <GraduationCap size={16} />, sub: "Las columnas del tablero de alumnos, desde que compran hasta que terminan." },
      { valor: "contratos", texto: "Contratos y accesos", icono: <FileSignature size={16} />, sub: "El contrato que sale con cada venta y lo que se le da al alumno cuando firma.", soloDuenos: true },
    ],
  },
  {
    grupo: "Conexiones",
    items: [
      { valor: "integraciones", texto: "Integraciones", icono: <Plug size={16} />, sub: "Lo que entra solo: Meta, Calendly, Fathom, YouTube y el banco." },
      { valor: "whatsapp", texto: "Lector de WhatsApp", icono: <MessageCircle size={16} />, sub: "El número que lee los grupos de los talleres y a qué webinar va cada grupo." },
    ],
  },
  {
    grupo: "Avanzado",
    items: [
      { valor: "campos", texto: "Campos propios", icono: <ListPlus size={16} />, sub: "Datos de más en las fichas." },
      { valor: "datos", texto: "Datos", icono: <Database size={16} />, sub: "Qué hay cargado y el respaldo.", soloDuenos: true },
    ],
  },
];

const TODAS = MENU.flatMap((g) => g.items);

export default function Ajustes() {
  const [url, cambiar] = useParamsURL({ seccion: "negocio", pipeline: "" });
  const { esDueno } = useAcceso();
  /* Los links viejos: la pestaña Listas y las dos del pipeline. */
  const pedida: string = url.seccion === "listas" ? "crm" : url.seccion === "pipeline" && url.pipeline === "servicio" ? "servicio" : url.seccion;
  const item = TODAS.find((i) => i.valor === pedida && (!i.soloDuenos || esDueno)) ?? TODAS[0];
  const seccion = item.valor;
  const ir = (s: Seccion) => cambiar({ seccion: s, pipeline: null }, { webinar: null });
  /* En el teléfono el menú es una tira que se corre de costado: la sección elegida queda a la vista. */
  const menu = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = menu.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return;
    const dx = el.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft += dx - (nav.clientWidth - el.offsetWidth) / 2;
  }, [seccion]);

  return (
    <div className="aj">
      <nav className="aj-menu" aria-label="Secciones de Ajustes" ref={menu}>
        {MENU.map((g, i) => {
          const items = g.items.filter((x) => !x.soloDuenos || esDueno);
          if (!items.length) return null;
          return (
            <div className="aj-menu__grupo" key={g.grupo ?? i}>
              {g.grupo && <span className="aj-menu__titulo">{g.grupo}</span>}
              {items.map((x) => (
                <button
                  key={x.valor} type="button" className="aj-menu__item" aria-current={x.valor === seccion ? "page" : undefined}
                  onClick={() => ir(x.valor)}
                >
                  {x.icono}<span>{x.texto}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="aj-cuerpo">
        <header className="aj-cab">
          <h1 className="aj-cab__titulo">{item.texto}</h1>
          <p className="aj-cab__sub">{item.sub}</p>
        </header>
        {seccion === "negocio" && <Negocio />}
        {seccion === "ventas" && <CatalogosVenta />}
        {seccion === "utms" && <ConfigUtms />}
        {seccion === "pipeline" && <Etapas />}
        {seccion === "crm" && <CrmAjustes />}
        {seccion === "servicio" && <EtapasServicio />}
        {seccion === "contratos" && <ContratosYAccesos />}
        {seccion === "integraciones" && <Integraciones />}
        {seccion === "whatsapp" && <WhatsappLector />}
        {seccion === "campos" && <Campos />}
        {seccion === "datos" && <Datos />}
      </div>
    </div>
  );
}

/* ---------------- General ---------------- */

function Negocio() {
  const e = useEstado();
  const toast = useToast();
  const { esDueno } = useAcceso();
  const [tema, setTema] = useTema();
  const [borrador, setBorrador] = useState<Partial<TAjustes>>({});
  const v = <K extends keyof TAjustes>(k: K): TAjustes[K] => (borrador[k] ?? e.ajustes[k]) as TAjustes[K];

  /* Cada campo se guarda al salir de él: no hay «guardar todo». */
  function aplicar<K extends keyof TAjustes>(k: K) {
    if (borrador[k] === undefined || borrador[k] === e.ajustes[k]) return;
    acciones.ajustes({ [k]: borrador[k] } as Partial<TAjustes>);
    toast("Guardado.");
    setBorrador((b) => { const n = { ...b }; delete n[k]; return n; });
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead titulo="Tu negocio" sub="Cada campo se guarda al salir de él." />
        <div className="form-grid">
          <Field label="Nombre del negocio" ayuda="Aparece en la barra lateral.">
            <Input value={v("negocio")} onChange={(ev) => setBorrador({ ...borrador, negocio: ev.target.value })} onBlur={() => aplicar("negocio")} placeholder="Hackear IT" />
          </Field>
          <Field label="Responsable" ayuda="Queda como autor de los cambios.">
            <Input value={v("responsable")} onChange={(ev) => setBorrador({ ...borrador, responsable: ev.target.value })} onBlur={() => aplicar("responsable")} placeholder="Yari Taft" />
          </Field>
          <Field label="Moneda base" ayuda="La de todos los totales.">
            <Select value={v("monedaBase")} onChange={(ev) => { acciones.ajustes({ monedaBase: ev.target.value as "USD" | "ARS" }); toast("Moneda actualizada."); }} opciones={["USD", "ARS"]} />
          </Field>
          <Field label="Tipo de cambio" ayuda="Pesos por dólar.">
            <InputMonto decimales={4} value={v("tipoCambio")} onChange={(ev) => setBorrador({ ...borrador, tipoCambio: montoDe(ev.target.value) })} onBlur={() => aplicar("tipoCambio")} />
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 0 }}>
        <div className="aj-filas">
          <Fila titulo="Apariencia" sub="Sólo en este navegador. El oscuro es el de la marca.">
            <Segmentado
              etiqueta="Apariencia" valor={tema} onCambiar={setTema}
              opciones={[
                { valor: "dark", texto: <><Moon size={14} aria-hidden /> Oscuro</> },
                { valor: "light", texto: <><Sun size={14} aria-hidden /> Claro</> },
              ]}
            />
          </Fila>
          <Fila titulo="Guía de bienvenida" sub="El recorrido de 5 pasos, otra vez al abrir la app.">
            <Switch
              checked={!e.ajustes.tourVisto} etiqueta="Volver a mostrar la guía de bienvenida"
              onChange={(x) => { acciones.ajustesSilencioso({ tourVisto: !x }); toast(x ? "Se va a mostrar al recargar." : "Desactivada."); }}
            />
          </Fila>
          {esDueno && hayNube && <PedirActualizar />}
        </div>
      </Card>
    </div>
  );
}

/* Cada versión publicada ya pide actualizar sola (components/shell/AvisoVersion). Esto es para cuando un dueño cambia algo
   de Ajustes que el equipo tiene que ver ya: a todos les aparece el cartel y a los 2 minutos la app se bloquea hasta actualizar. */
function PedirActualizar() {
  const e = useEstado();
  const toast = useToast();
  return (
    <Fila
      titulo="Actualizar la app de todo el equipo"
      sub={e.ajustes.recargaPedida ? `Para que vean ya un cambio de Ajustes. Último pedido: ${relativo(e.ajustes.recargaPedida)}.` : "Para que vean ya un cambio de Ajustes."}
    >
      <Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={() => {
        const recargaPedida = new Date().toISOString();
        marcarRecargaPropia(recargaPedida);
        acciones.ajustes({ recargaPedida }, "Se pidió a todo el equipo que actualice la app.");
        toast("Listo: en menos de dos minutos a todos les aparece el cartel para actualizar.");
      }}>Pedir que actualicen</Button>
    </Fila>
  );
}

/* ---------------- Pipeline (las etapas de los leads) ---------------- */

function Etapas() {
  const e = useEstado();
  const toast = useToast();
  const [form, setForm] = useState<(Omit<Etapa, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Etapa | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const ordenadas = [...e.etapas].sort((a, b) => a.orden - b.orden);
  const leads = (id: string) => e.leads.filter((l) => l.etapaId === id).length;
  const max = Math.max(1, ...ordenadas.map((et) => leads(et.id)));

  /* El orden nuevo, escrito sólo en las etapas que cambiaron de lugar. */
  function ordenar(ids: string[]) {
    ids.forEach((id, i) => {
      const et = ordenadas.find((x) => x.id === id);
      if (et && et.orden !== i) acciones.actualizarSilencioso<Etapa>("etapas", id, { orden: i });
    });
  }
  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ordenadas.length) return;
    const ids = ordenadas.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    ordenar(ids);
  }
  function soltar(sobreId: string) {
    const origen = arrastrando;
    setArrastrando(null);
    setSobre(null);
    if (!origen || origen === sobreId) return;
    const desde = ordenadas.findIndex((x) => x.id === origen);
    const hasta = ordenadas.findIndex((x) => x.id === sobreId);
    const ids = ordenadas.map((x) => x.id).filter((x) => x !== origen);
    const i = ids.indexOf(sobreId);
    ids.splice(desde < hasta ? i + 1 : i, 0, origen);
    ordenar(ids);
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
          titulo={`${num(ordenadas.length)} etapas`}
          sub="Arrastrá para cambiar el orden. La de ganado cuenta los inscriptos; la de perdido sale del pipeline abierto."
          acciones={<Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({ nombre: "", variante: "brand", probabilidad: 50, orden: e.etapas.length })}>Nueva etapa</Button>}
        />
        <div className="aj-etapas" role="list">
          <div className="aj-etapa aj-etapa--cabeza" aria-hidden>
            <span /><span>Etapa</span><span>Leads</span><span className="aj-num">Cierre</span><span />
          </div>
          {ordenadas.map((et, i) => {
            const n = leads(et.id);
            return (
              <div
                key={et.id} role="listitem"
                className={`aj-etapa${sobre === et.id ? " aj-etapa--sobre" : ""}${arrastrando === et.id ? " aj-etapa--arrastrando" : ""}`}
                onDragOver={(ev) => { if (!arrastrando) return; ev.preventDefault(); if (sobre !== et.id) setSobre(et.id); }}
                onDrop={(ev) => { ev.preventDefault(); soltar(et.id); }}
              >
                <span className="aj-etapa__mover">
                  <span
                    className="aj-etapa__asa" draggable title="Arrastrá para cambiar el orden"
                    onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", et.id); ev.dataTransfer.effectAllowed = "move"; setArrastrando(et.id); }}
                    onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                  >
                    <GripVertical size={16} />
                  </span>
                  <span className="aj-etapa__flechas">
                    <IconButton etiqueta={`Subir «${et.nombre}»`} onClick={() => mover(i, -1)} disabled={i === 0} style={{ width: 24, height: 18 }}><ChevronUp size={14} /></IconButton>
                    <IconButton etiqueta={`Bajar «${et.nombre}»`} onClick={() => mover(i, 1)} disabled={i === ordenadas.length - 1} style={{ width: 24, height: 18 }}><ChevronDown size={14} /></IconButton>
                  </span>
                </span>
                <span className="aj-etapa__nombre">
                  <Badge variante={et.variante}>{et.nombre}</Badge>
                  {et.esGanada && <span className="aj-etapa__marca" title="Es la de ganado: cuenta los inscriptos"><Trophy size={14} aria-label="Ganado" /></span>}
                  {et.esPerdida && <span className="aj-etapa__marca" title="Es la de perdido: sale del pipeline abierto"><Ban size={14} aria-label="Perdido" /></span>}
                </span>
                <span className="aj-etapa__cuantos">
                  <span className="aj-barra" aria-hidden><span style={{ width: `${(n / max) * 100}%` }} /></span>
                  <span className="t-num">{num(n)}</span>
                </span>
                <span className="aj-num t-num" title="Probabilidad de cierre: se usa para el pipeline ponderado">{et.probabilidad}%</span>
                <span className="aj-etapa__acciones">
                  <IconButton etiqueta={`Editar «${et.nombre}»`} onClick={() => setForm({ ...et })}><Settings2 size={15} /></IconButton>
                  <IconButton etiqueta={`Eliminar «${et.nombre}»`} onClick={() => setBorrar(et)}><Trash2 size={15} /></IconButton>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

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
            <span className="t-body t-muted">Es la de <strong>ganado</strong>: cuenta como inscripto</span>
          </div>
          <div className="row-3">
            <Switch checked={Boolean(form.esPerdida)} onChange={(x) => setForm({ ...form, esPerdida: x, esGanada: x ? false : form.esGanada })} etiqueta="Es la etapa perdida" />
            <span className="t-body t-muted">Es la de <strong>perdido</strong>: sale del pipeline abierto</span>
          </div>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la etapa «${borrar?.nombre}»?`}
        texto={`${num(borrar ? leads(borrar.id) : 0)} leads están en esta etapa y van a quedar sin columna (no se borran). Movelos primero si querés conservarlos ordenados.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("etapas", borrar.id, borrar.nombre); toast("Etapa eliminada."); } }}
      />
    </div>
  );
}

/* ---------------- CRM ---------------- */

/* El cierre del día (strikes y descuento), los estados de llamada y las dos listas que se usan: de dónde viene un
   lead y por qué no cerró. Las otras listas viejas (planes, tipos de sesión, categorías y métodos de pago) no las leía
   ninguna pantalla —Finanzas tiene sus propias categorías—, así que no se ofrecen: el dato queda en los ajustes. */
function CrmAjustes() {
  const e = useEstado();
  return (
    <div className="stack-5">
      <CierreDelDiaAjustes />
      <EstadosDeLlamada />
      <div className="grid-2">
        <ListaEditable clave="fuentes" titulo="Fuentes de leads" sub="De dónde puede venir alguien, al cargar un lead a mano." />
        <ListaEditable
          titulo="Objeciones del cierre del día" sub="Por qué no cerró: lo que elige el closer en su EOD."
          items={objecionesDe(e.ajustes)}
          onGuardar={(objeciones, detalle) => acciones.ajustes({ crm: { ...(e.ajustes.crm ?? {}), objeciones } }, detalle)}
        />
      </div>
    </div>
  );
}

function ListaEditable({ clave, titulo, sub, items: propios, onGuardar }: {
  titulo: string; sub: string;
  /* Una lista de ajustes por su clave, o una propia con cómo se guarda. */
  clave?: keyof TAjustes; items?: string[]; onGuardar?: (items: string[], detalle: string) => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const [nuevo, setNuevo] = useState("");
  const items = propios ?? (clave ? (e.ajustes[clave] as string[]) : undefined) ?? [];
  const guardar = (xs: string[], detalle: string) => {
    if (onGuardar) onGuardar(xs, detalle);
    else if (clave) acciones.ajustes({ [clave]: xs } as Partial<TAjustes>, detalle);
  };

  function agregar() {
    const t = nuevo.trim();
    if (!t) return;
    if (items.includes(t)) { toast("Esa opción ya está en la lista.", "err"); return; }
    guardar([...items, t], `Se agregó «${t}» a ${titulo.toLowerCase()}.`);
    setNuevo("");
    toast(`«${t}» agregado.`);
  }

  function quitar(x: string) {
    guardar(items.filter((i) => i !== x), `Se quitó «${x}» de ${titulo.toLowerCase()}.`);
    toast(`«${x}» quitado.`);
  }

  return (
    <Card>
      <CardHead titulo={titulo} sub={sub} />
      <div className="aj-chips">
        {items.length === 0 && <span className="t-sm t-subtle">Vacía.</span>}
        {items.map((x) => (
          <span key={x} className="chip aj-chip">
            {x}
            <button type="button" className="aj-chip__quitar" aria-label={`Quitar ${x}`} onClick={() => quitar(x)}><X size={13} /></button>
          </span>
        ))}
        <form onSubmit={(ev) => { ev.preventDefault(); agregar(); }} className="aj-chip-nuevo">
          <Plus size={13} aria-hidden />
          <input value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} placeholder="Agregar" aria-label={`Agregar a ${titulo}`} />
        </form>
      </div>
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
  const nuevo = () => { setForm({ entidad: "lead", nombre: "", clave: "", tipo: "texto", requerido: false }); setOpciones(""); };

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
      {e.campos.length === 0 ? (
        <Card>
          <Empty
            icono={<Layers size={22} />}
            titulo="Todavía no hay campos propios"
            texto="Las fichas ya traen lo básico. Si querés guardar algo más —nivel de inglés en los leads, la empresa donde entró en los alumnos— agregalo y aparece en su formulario y en su ficha."
            accion={<Button variante="primary" icono={<Plus size={16} />} onClick={nuevo}>Agregar un campo</Button>}
          />
        </Card>
      ) : (
        <Card>
          <CardHead
            titulo={`${num(e.campos.length)} ${e.campos.length === 1 ? "campo propio" : "campos propios"}`}
            sub="Aparecen en el formulario y en la ficha de lo que elegiste, en los registros nuevos y en los que ya estaban."
            acciones={<Button sm variante="primary" icono={<Plus size={15} />} onClick={nuevo}>Nuevo campo</Button>}
          />
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
        </Card>
      )}

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar}
          titulo={form.id ? "Editar campo" : "Nuevo campo"}
          sub={form.entidad === "sesion" ? "Elegí en qué ficha aparece y qué tipo de dato guarda. En Sesiones, además, es una columna del CRM." : "Elegí en qué ficha aparece y qué tipo de dato guarda."}
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

/* ---------------- Datos ---------------- */

/* Con la app en la nube, «Volver a los datos de ejemplo», «Vaciar todo» y «Restaurar» vacían la base de producción
   (store: vaciarNube) y no se pueden deshacer. Antes estaban a dos clics, con un texto que decía que todo vivía en
   este navegador (05/11). Ahora, en la nube, sólo queda bajar el respaldo; restaurar uno va escondido y pregunta
   con el archivo ya elegido. Ejemplo y vaciar quedan para la app de prueba, sin base. */
function Datos() {
  const e = useEstado();
  const toast = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [confirmar, setConfirmar] = useState<"demo" | "vaciar" | null>(null);
  const [aRestaurar, setARestaurar] = useState<{ nombre: string; texto: string } | null>(null);

  function exportar() {
    const blob = new Blob([acciones.exportar()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apicanta-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Respaldo descargado.");
  }

  function elegir(f: File) {
    const lector = new FileReader();
    lector.onload = () => setARestaurar({ nombre: f.name, texto: String(lector.result) });
    lector.readAsText(f);
  }

  const conteos = [
    ["Leads", e.leads.length], ["Alumnos", e.alumnos.length], ["Llamadas", e.sesiones.length],
    ["Webinars", e.webinars.length], ["Ventas", e.ventas.length], ["Cobros", e.pagos.length],
    ["Gastos", e.gastos.length], ["Reportes", e.reportes.length],
  ] as const;

  return (
    <div className="stack-4">
      <Card style={{ padding: 0 }}>
        <div className="aj-conteos">
          {conteos.map(([k, n]) => (
            <div key={k} className="aj-conteo">
              <span className="aj-conteo__n t-num">{num(n)}</span>
              <span className="aj-conteo__k">{k}</span>
            </div>
          ))}
        </div>
        <div className="aj-filas aj-filas--borde">
          <Fila titulo="Respaldo" sub={hayNube ? "Todo vive en la nube y se guarda solo. Esto baja una copia en un archivo, para guardar aparte." : "Todo vive en este navegador: bajate una copia de vez en cuando."}>
            <Button sm variante="secondary" icono={<Download size={15} />} onClick={exportar}>Descargar respaldo</Button>
          </Fila>
        </div>
      </Card>

      <Plegable titulo={<span className="aj-riesgo"><ShieldAlert size={15} aria-hidden /> Zona de riesgo</span>} resumen={hayNube ? "Restaurar un respaldo" : "Restaurar, ejemplo y vaciar"}>
        <div className="aj-filas">
          <Fila titulo="Restaurar desde un archivo" sub={hayNube ? "Reemplaza todo lo que hay en la nube, para todo el equipo, por lo del archivo." : "Reemplaza lo de este navegador por lo del archivo."}>
            <Button sm variante="danger" icono={<Upload size={15} />} onClick={() => archivo.current?.click()}>Elegir archivo</Button>
            <input
              ref={archivo} type="file" accept="application/json" style={{ display: "none" }}
              onChange={(ev) => { const f = ev.target.files?.[0]; if (f) elegir(f); ev.target.value = ""; }}
            />
          </Fila>
          {!hayNube && (
            <>
              <Fila titulo="Volver a los datos de ejemplo" sub="Reemplaza todo por la demostración.">
                <Button sm variante="secondary" onClick={() => setConfirmar("demo")}>Cargar ejemplo</Button>
              </Fila>
              <Fila titulo="Vaciar todo" sub="Borra leads, alumnos, llamadas, webinars y movimientos. Las etapas y las listas quedan.">
                <Button sm variante="danger" icono={<Trash2 size={15} />} onClick={() => setConfirmar("vaciar")}>Vaciar todo</Button>
              </Fila>
            </>
          )}
        </div>
      </Plegable>

      <Confirmar
        abierto={aRestaurar !== null} onCerrar={() => setARestaurar(null)}
        titulo={`¿Restaurar «${aRestaurar?.nombre ?? ""}»?`}
        texto={hayNube
          ? "Se borra todo lo que hay en la nube —leads, ventas, cobros, gastos, todo— y se carga lo del archivo, para todo el equipo. No se puede deshacer: bajate un respaldo de hoy antes."
          : "Se reemplaza todo lo que hay en este navegador por lo del archivo."}
        confirmarTexto="Restaurar y reemplazar todo"
        onConfirmar={() => {
          if (!aRestaurar) return;
          const ok = acciones.importar(aRestaurar.texto);
          toast(ok ? "Datos restaurados." : "El archivo no tiene el formato correcto.", ok ? "ok" : "err");
        }}
      />
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
