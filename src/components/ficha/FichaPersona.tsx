"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Copy, GraduationCap, Mail, MessageCircle, Pencil, Phone, Plus, ShoppingBag, X,
} from "lucide-react";
import {
  Avatar, Badge, Bar, Button, Chip, Empty, IconButton, Select, Tabs,
} from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { DatosExtra } from "@/components/ui/CamposExtra";
import { EditarAlumno, VentaDelAlumno } from "@/components/alumnos/Servicio";
import { ESTADO_ALUMNO, ESTADOS_ALUMNO, cuandoEmpezo } from "@/components/alumnos/comun";
import { alumnoDeVenta, etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { desdeVenta, FormularioVenta, type BorradorVenta } from "@/components/ventas/FormularioVenta";
import { RegistrarPago } from "@/components/cobros/RegistrarPago";
import { ChatEquipo } from "./ChatEquipo";
import { HistorialPersona } from "./HistorialPersona";
import { UtmsPersona } from "./UtmsPersona";
import { TarjetaVenta } from "./TarjetaVenta";
import { VistaLlamadas } from "./VistaLlamadas";
import { CabezaPlegable, usePlegado } from "./Plegable";
import type { VistaFicha } from "./abrir";
import { acciones, cuotasQueCancelaLaBaja, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn, type MiAcceso } from "@/lib/permisos";
import { filasDePersona, filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import { personaDe, type Persona } from "@/lib/persona";
import { saldoVenta } from "@/lib/finanzas";
import { fechaLarga, money, relativo } from "@/lib/format";
import type { Alumno, Cuota, EstadoAlumno, EstadoApp, EstadoVenta, IngresoComunidad, Venta } from "@/lib/types";
import { INGRESOS_COMUNIDAD } from "@/lib/angelo";

/* ==================================================================
   La ficha de una persona. La misma, se abra desde donde se abra.

   Arriba a la derecha, las vistas: LLAMADAS (cada llamada y cómo
   terminó), VENTAS (lo que compró y cómo lo va pagando) y SERVICIO (lo
   que se le está dando por cada compra). A la izquierda, siempre, la
   persona: cómo contactarla, su oportunidad y de dónde vino. Quién es
   va arriba de sus llamadas. Cada dato está en un solo lugar (02/10: «no quiero que sobre data ni
   cosas duplicadas»). El chat del equipo está en ventas y servicio: la
   conversación es sobre la persona, no sobre un área.

   Es como la ficha de Blue OS: una ventana grande en escritorio y
   pantalla completa en el celular.
   ================================================================== */

type SolapaVentas = "ventas" | "chat" | "historial" | "utms";
type SolapaServicio = "servicio" | "chat" | "historial";

export function FichaPersona({ id, vista, ventaResaltada, onCerrar, onVista }: {
  id: string; vista: VistaFicha; ventaResaltada?: string | null;
  onCerrar: () => void; onVista: (v: VistaFicha) => void;
}) {
  const e = useEstado();
  const p = useMemo(() => personaDe(e, id), [e, id]);
  /* Sus llamadas como filas del CRM, de la más nueva a la más vieja: de ahí
     salen su perfil (a la izquierda) y la vista Llamadas. */
  const filas = useMemo(() => (p && p.sesiones.length ? filasDePersona(filasTabla(e), p.sesiones.map((s) => s.id)) : []), [e, p]);
  /* Cada tipo de cuenta ve las vistas de sus áreas: el setter, sin ventas;
     el closer, sin el servicio. */
  const { acceso } = useAcceso();
  const vistas = vistasDe(acceso);
  const vistaReal = vistas.includes(vista) ? vista : vistas[0] ?? vista;

  /* Esc cierra, salvo que haya algo abierto encima (un pago, un desplegable,
     el asistente de venta): eso se cierra primero. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (document.querySelector(".modal-backdrop, [data-flotante-abierto], .asistente")) return;
      onCerrar();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onCerrar]);

  return (
    <div className="ficha-fondo" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onCerrar(); }}>
      <div className="ficha" role="dialog" aria-modal="true" aria-label={p ? `Ficha de ${p.nombre}` : "Ficha"}>
        {!p ? (
          <div style={{ padding: 32 }}>
            <Empty icono={<X size={22} />} titulo="No encontramos a esta persona"
              texto="Puede que la hayan borrado o que el link sea de otra base."
              accion={<Button variante="secondary" onClick={onCerrar}>Cerrar</Button>} />
          </div>
        ) : (
          <>
            <Cabecera e={e} p={p} vista={vistaReal} vistas={vistas} onVista={onVista} onCerrar={onCerrar} />
            <div className="ficha__cuerpo">
              <Lateral e={e} p={p} filas={filas} />
              <div className="ficha__principal">
                {vistas.length === 0
                  ? null
                  : vistaReal === "llamadas"
                    ? <VistaLlamadas p={p} filas={filas} />
                    : vistaReal === "ventas"
                      ? <VistaVentas e={e} p={p} ventaResaltada={ventaResaltada} />
                      : <VistaServicio e={e} p={p} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Cabecera ---------- */

/* Llamadas: CRM o Leads. Ventas: Ventas, Clientes o Finanzas. Servicio: Alumnos. */
function vistasDe(a: MiAcceso | null): VistaFicha[] {
  const xs: VistaFicha[] = [];
  if (nivelEn(a, "crm") >= 1 || nivelEn(a, "leads") >= 1) xs.push("llamadas");
  if (nivelEn(a, "ventas") >= 1 || nivelEn(a, "clientes") >= 1 || nivelEn(a, "finanzas") >= 1) xs.push("ventas");
  if (nivelEn(a, "alumnos") >= 1) xs.push("servicio");
  return xs;
}

function Cabecera({ e, p, vista, vistas, onVista, onCerrar }: {
  e: EstadoApp; p: Persona; vista: VistaFicha; vistas: VistaFicha[]; onVista: (v: VistaFicha) => void; onCerrar: () => void;
}) {
  /* La etapa y el país no van acá: están una vez, a la izquierda. Sin
     oportunidad ni compras, la etiqueta dice al menos que es un contacto. */
  const alumno = p.alumnos[0];
  return (
    <header className="ficha__head">
      <Avatar nombre={p.nombre} size={44} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t-label">Ficha del contacto</div>
        <h2 className="ficha__nombre truncate">{p.nombre}</h2>
        <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
          {p.ventas.length > 0 && <Badge variante="success"><ShoppingBag size={12} />{p.ventas.length === 1 ? "Cliente" : `Cliente · ${p.ventas.length} compras`}</Badge>}
          {alumno && <Badge variante="brand"><GraduationCap size={12} />Alumno {alumno.estado}</Badge>}
        </div>
      </div>
      <div className="ficha__acciones">
        <div className="segmento" role="tablist" aria-label="Qué mirar de la persona">
          {vistas.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => onVista(v)}>
              {v === "llamadas" ? "Llamadas" : v === "ventas" ? "Ventas" : "Servicio"}
            </button>
          ))}
        </div>
        <IconButton etiqueta="Cerrar la ficha" onClick={onCerrar}><X size={18} /></IconButton>
      </div>
    </header>
  );
}

/* ---------- Columna izquierda: la persona ----------
   Cómo contactarla, su oportunidad y de dónde vino, en todas las vistas.
   Cada dato una sola vez: quién es (lo que contestó al agendar) va
   arriba de sus llamadas (PerfilPersona), y a la derecha queda lo de cada
   vista: sus llamadas, sus ventas, su servicio. */

function Lateral({ e, p, filas }: { e: EstadoApp; p: Persona; filas: FilaTabla[] }) {
  const toast = useToast();
  const c = p.contacto;
  const lead = p.leads[0];
  const whatsapp = p.telefono ? p.telefono.replace(/[^\d]/g, "") : "";

  const copiar = (valor: string, que: string) => {
    navigator.clipboard?.writeText(valor).then(
      () => toast(`${que.charAt(0).toUpperCase() + que.slice(1)} copiado.`),
      () => toast("No se pudo copiar.", "err"),
    );
  };

  /* De dónde vino: por qué vía agendó cada vez y con qué anuncio. */
  const vias = [...new Set(filas.map((f) => f.via).filter(Boolean))];
  const ad = filas.map((f) => f.ad).find(Boolean) ?? "";
  const campania = filas.map((f) => f.campania).find(Boolean) ?? lead?.campania ?? "";
  const webinar = lead?.webinarId ? e.webinars.find((w) => w.id === lead.webinarId)?.titulo : undefined;
  /* La fuente del lead, si dice algo que las vías no dicen. */
  const fuente = lead?.fuente && !vias.some((v) => v.toLowerCase().includes(lead.fuente.toLowerCase())) ? lead.fuente : "";
  const entro = lead?.creadoEn ?? c?.creadoEn;

  return (
    <aside className="ficha__lado">
      <section>
        <div className="t-label" style={{ marginBottom: 8 }}>Contacto</div>
        <Fila onCopiar={copiar} icono={<Mail size={15} />} valor={p.email} vacio="Sin email" que="el email"
          accion={<a className="link t-sm" href={`mailto:${p.email}`}>Escribir</a>} />
        <Fila onCopiar={copiar} icono={<Phone size={15} />} valor={p.telefono} vacio="Sin teléfono" que="el teléfono"
          accion={whatsapp ? <a className="link t-sm" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> WhatsApp</a> : undefined} />
        {c?.instagram && <Fila onCopiar={copiar} icono={<span className="t-sm">@</span>} valor={c.instagram.replace(/^@/, "")} vacio="" que="el Instagram" />}
      </section>

      {lead && (
        <section className="stack-2">
          <div className="t-label">Oportunidad</div>
          <Select
            aria-label="Etapa del pipeline de ventas" value={lead.etapaId}
            onChange={(ev) => { acciones.moverLead(lead.id, ev.target.value); toast(`${lead.nombre} → ${e.etapas.find((x) => x.id === ev.target.value)?.nombre ?? ""}`); }}
            opciones={[...e.etapas].sort((a, b) => a.orden - b.orden).map((x) => ({ valor: x.id, texto: x.nombre }))}
          />
          <dl className="dl dl--compacta">
            <dt>Valor</dt><dd className="t-num">{money(lead.monto, lead.moneda)}</dd>
            <dt>Responsable</dt><dd>{lead.responsable || "—"}</dd>
            <DatosExtra campos={e.campos} entidad="lead" valores={lead.extra} />
          </dl>
          <a className="link t-sm" href={`/leads?editar=${lead.id}`}><Pencil size={13} /> Editar los datos</a>
        </section>
      )}

      {(vias.length > 0 || ad || campania || webinar || fuente || entro) && (
        <section>
          <div className="t-label" style={{ marginBottom: 8 }}>De dónde vino</div>
          <dl className="dl dl--compacta">
            {vias.length > 0 && <><dt>Vía</dt><dd>{vias.join(" · ")}</dd></>}
            {fuente && <><dt>Fuente</dt><dd>{fuente}</dd></>}
            {ad && <><dt>Ad</dt><dd className="truncate" title={ad}>{ad}</dd></>}
            {campania && <><dt>Campaña</dt><dd className="truncate" title={campania}>{campania}</dd></>}
            {webinar && <><dt>Webinar</dt><dd className="truncate" title={webinar}>{webinar}</dd></>}
            {entro && <><dt>Entró</dt><dd>{fechaLarga(entro)}</dd></>}
          </dl>
        </section>
      )}

      {(c?.notas || lead?.notas) && (
        <section>
          <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
          <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap" }}>{c?.notas || lead?.notas}</p>
        </section>
      )}
    </aside>
  );
}

/* Un dato de contacto con su botón de copiar: lo que se hace el 100% de
   las veces es llevárselo a otra herramienta (el celular, el mail). */
function Fila({ icono, valor, vacio, que, accion, onCopiar }: {
  icono: React.ReactNode; valor?: string; vacio: string; que: string; accion?: React.ReactNode;
  onCopiar: (valor: string, que: string) => void;
}) {
  return (
    <div className="dato-fila">
      <span className="t-subtle" style={{ display: "inline-flex" }}>{icono}</span>
      <span className={`truncate t-sm${valor ? "" : " t-subtle"}`} style={{ flex: 1, minWidth: 0 }}>{valor || vacio}</span>
      {valor && accion}
      {valor && (
        <IconButton etiqueta={`Copiar ${que}`} onClick={() => onCopiar(valor, que)}>
          <Copy size={14} />
        </IconButton>
      )}
    </div>
  );
}

/* ---------- Vista Ventas ---------- */

function VistaVentas({ e, p, ventaResaltada }: { e: EstadoApp; p: Persona; ventaResaltada?: string | null }) {
  const toast = useToast();
  const [solapa, setSolapa] = useState<SolapaVentas>("ventas");
  const [pagar, setPagar] = useState<Cuota | null>(null);
  const [editar, setEditar] = useState<BorradorVenta | null>(null);
  /* La venta que se da de baja o se reactiva, y a qué estado pasa. */
  const [baja, setBaja] = useState<{ venta: Venta; estado: EstadoVenta } | null>(null);
  const [nuevaVenta, setNuevaVenta] = useState(false);
  const plegado = usePlegado();

  /* Si se abrió desde una venta, esa venta a la vista. */
  const variasVentas = p.ventas.length > 1;
  useEffect(() => {
    /* Con una sola venta ya se ve de entrada: scrollear escondería las solapas. */
    if (!ventaResaltada || !variasVentas) return;
    const t = window.setTimeout(() => document.getElementById(`venta-${ventaResaltada}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
    return () => window.clearTimeout(t);
  }, [ventaResaltada, variasVentas]);

  /* Registrar un pago va embebido: la columna de la venta pasa a ser el
     paso a paso, y al terminar (o salir) vuelve a la lista con esa venta
     a la vista. */
  function terminarPago(mensaje?: string) {
    const ventaId = pagar?.ventaId;
    if (mensaje) toast(mensaje);
    setPagar(null);
    if (ventaId) {
      window.setTimeout(() => document.getElementById(`venta-${ventaId}`)?.scrollIntoView({ block: "nearest" }), 60);
    }
  }
  if (pagar) {
    return <RegistrarPago embebido cuota={pagar} onCerrar={() => terminarPago()} onGuardado={terminarPago} />;
  }

  return (
    <>
      <Tabs<SolapaVentas>
        valor={solapa} onChange={setSolapa}
        opciones={[
          { valor: "ventas", texto: `Ventas (${p.ventas.length})` },
          { valor: "chat", texto: `Chat (${p.comentarios.length})` },
          { valor: "historial", texto: "Historial" },
          { valor: "utms", texto: "UTMs" },
        ]}
      />

      {solapa === "ventas" && (
        <div className="stack-4">
          {p.ventas.length === 0 ? (
            <Empty
              icono={<ShoppingBag size={22} />} titulo="Todavía no compró"
              texto="Cuando cierre, registrá la venta desde acá: queda pegada a su historia."
              accion={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setNuevaVenta(true)}>Registrar venta</Button>}
            />
          ) : (
            <>
              {p.ventas.map((v) => {
                /* Abierto lo que está en curso: la única, la que se buscó o la
                   que tiene cuotas por cobrar. Lo saldado o cancelado, plegado. */
                const porDefecto = !variasVentas || v.id === ventaResaltada
                  || (v.estado === "activa" && saldoVenta(e, v.id).saldo > 0.01);
                return (
                  <TarjetaVenta
                    key={v.id} e={e} venta={v} resaltada={v.id === ventaResaltada}
                    abierta={plegado.abierta(v.id, porDefecto)}
                    onAlternar={() => plegado.alternar(v.id, porDefecto)}
                    onPagar={setPagar}
                    onEditar={() => setEditar(desdeVenta(e, v))}
                    onEstado={(estado) => setBaja({ venta: v, estado })}
                  />
                );
              })}
              <Button variante="primary" icono={<Plus size={16} />} onClick={() => setNuevaVenta(true)} style={{ alignSelf: "flex-start" }}>
                Nueva venta · upsell o renovación
              </Button>
            </>
          )}
        </div>
      )}
      {solapa === "chat" && <ChatEquipo contactoId={p.clave} comentarios={p.comentarios} />}
      {solapa === "historial" && <HistorialPersona e={e} p={p} />}
      {solapa === "utms" && <UtmsPersona e={e} p={p} />}

      {editar && (
        <FormularioVenta borrador={editar} onCerrar={() => setEditar(null)}
          onGuardado={(n) => { toast(`Venta de ${n} actualizada.`); setEditar(null); }} />
      )}
      {baja && <ConfirmarBaja e={e} venta={baja.venta} estado={baja.estado} onCerrar={() => setBaja(null)} />}
      {nuevaVenta && (
        <AsistenteVenta
          cliente={{ contactoId: p.leads[0]?.id ?? p.clave, nombre: p.nombre, email: p.email }}
          onCerrar={() => setNuevaVenta(false)}
          onListo={(_id, nombre) => { setNuevaVenta(false); toast(`Venta de ${nombre} registrada.`); }}
        />
      )}
    </>
  );
}

/* ---------- Dar de baja una venta, o reactivarla ----------
   Lo que pasa se dice antes de confirmar: cuántas cuotas se cancelan y
   cuánta plata deja de estar por cobrar (store.ts, efectoDeBaja). */

function ConfirmarBaja({ e, venta, estado, onCerrar }: {
  e: EstadoApp; venta: Venta; estado: EstadoVenta; onCerrar: () => void;
}) {
  const toast = useToast();
  const M = (n: number) => money(n, venta.moneda, 2);
  const nombre = venta.contactoNombre;
  const servicio = e.alumnos.some((a) => a.ventaId === venta.id);

  let titulo: string, texto: string, boton: string, detalle: string, aviso: string;
  if (estado === "activa") {
    const ids = new Set((venta.extra?.cuotasCanceladasConLaBaja as string[] | undefined) ?? []);
    const vuelven = e.cuotas.filter((c) => ids.has(c.id) && c.estado === "cancelada");
    const monto = vuelven.reduce((a, c) => a + c.monto, 0);
    titulo = `¿Reactivar la venta de ${nombre}?`;
    texto = (vuelven.length
      ? `Vuelve a estar activa y ${vuelven.length === 1 ? "la cuota que se canceló con la baja vuelve" : `las ${vuelven.length} cuotas que se cancelaron con la baja vuelven`} a estar pendientes (${M(monto)}).`
      : "Vuelve a estar activa. No había cuotas canceladas por la baja.")
      + (servicio ? " Su servicio vuelve al estado que tenía." : "");
    boton = "Reactivar la venta";
    detalle = `Se reactivó la venta de ${nombre}${vuelven.length ? `: ${vuelven.length === 1 ? "1 cuota vuelve" : `${vuelven.length} cuotas vuelven`} a estar pendientes` : ""}.`;
    aviso = "Venta reactivada.";
  } else {
    const cuotas = cuotasQueCancelaLaBaja(e, venta.id);
    const monto = cuotas.reduce((a, c) => a + c.monto, 0);
    const reembolso = estado === "reembolsada";
    titulo = reembolso ? `¿Marcar como reembolsada la venta de ${nombre}?` : `¿Cancelar la venta de ${nombre}?`;
    texto = (cuotas.length
      ? `${cuotas.length === 1 ? "La cuota que faltaba cobrar queda cancelada" : `Las ${cuotas.length} cuotas que faltaban cobrar quedan canceladas`} (${M(monto)}): no se borran, quedan escritas como canceladas y dejan de contar como por cobrar y como mora.`
      : "No le quedan cuotas por cobrar.")
      + (servicio ? " Su servicio pasa a baja." : "")
      + " Lo cobrado queda como historial."
      + (reembolso ? " La plata devuelta cargala como gasto en Reembolsos." : "")
      + " Se puede reactivar.";
    boton = reembolso ? "Marcar reembolsada" : "Cancelar la venta";
    detalle = `${reembolso ? "Se marcó como reembolsada" : "Se canceló"} la venta de ${nombre}${cuotas.length ? `: ${cuotas.length === 1 ? `1 cuota por ${M(monto)} queda cancelada` : `${cuotas.length} cuotas por ${M(monto)} quedan canceladas`}` : ""}.`;
    aviso = reembolso ? "Venta marcada como reembolsada." : "Venta cancelada. Las cuotas quedan como historial.";
  }

  return (
    <Confirmar
      abierto onCerrar={onCerrar} confirmarTexto={boton} titulo={titulo} texto={texto}
      onConfirmar={() => {
        acciones.actualizar<Venta>("ventas", venta.id, { estado }, nombre, detalle);
        toast(aviso);
      }}
    />
  );
}

/* ---------- Vista Servicio ---------- */

function VistaServicio({ e, p }: { e: EstadoApp; p: Persona }) {
  const toast = useToast();
  const [solapa, setSolapa] = useState<SolapaServicio>("servicio");
  const [editar, setEditar] = useState<Alumno | null>(null);
  const etapas = useMemo(() => etapasDeServicio(e), [e]);
  const plegado = usePlegado();

  /* Un servicio por compra: cada venta con su alumno, y los alumnos que no
     tienen venta (cargados a mano, de antes) también. */
  const conVenta = p.ventas.map((v) => {
    const enlazado = p.alumnos.find((a) => a.ventaId === v.id);
    /* Un alumno de antes, sin venta enlazada, que por lead o email es de esta
       compra: es el mismo servicio. Se muestra junto, con el botón para
       dejarlo enlazado. */
    const suelto = enlazado ? undefined : alumnoDeVenta(e, v);
    const alumno = enlazado ?? (suelto && !suelto.ventaId && p.alumnos.includes(suelto) ? suelto : undefined);
    return { venta: v as Venta | undefined, alumno, sinEnlazar: Boolean(alumno && !enlazado) };
  });
  const usados = new Set(conVenta.map((x) => x.alumno?.id).filter(Boolean));
  const sueltos = p.alumnos.filter((a) => !usados.has(a.id));
  const servicios = [...conVenta, ...sueltos.map((a) => ({ venta: undefined as Venta | undefined, alumno: a as Alumno | undefined, sinEnlazar: false }))];

  function guardarEdicion() {
    if (!editar) return;
    const nombre = editar.nombre.trim();
    if (!nombre) { toast("Poné al menos el nombre.", "err"); return; }
    const { id, ...cambios } = editar;
    const antes = e.alumnos.find((a) => a.id === id);
    acciones.actualizar<Alumno>("alumnos", id, { ...cambios, nombre }, nombre);
    /* El nombre y el mail son de la persona: se corrigen en todos lados. */
    acciones.corregirPersona(antes?.leadId ?? id, {
      nombre: nombre !== antes?.nombre ? nombre : undefined,
      email: cambios.email !== antes?.email ? cambios.email : undefined,
    });
    toast("Servicio actualizado.");
    setEditar(null);
  }

  return (
    <>
      <Tabs<SolapaServicio>
        valor={solapa} onChange={setSolapa}
        opciones={[
          { valor: "servicio", texto: `Servicio (${servicios.length})` },
          { valor: "chat", texto: `Chat (${p.comentarios.length})` },
          { valor: "historial", texto: "Historial" },
        ]}
      />

      {solapa === "servicio" && (
        <div className="stack-4">
          {servicios.length === 0 ? (
            <Empty icono={<GraduationCap size={22} />} titulo="Todavía no tiene servicio"
              texto="El servicio nace solo con cada compra. Cuando registres su venta, aparece acá." />
          ) : servicios.map(({ venta, alumno, sinEnlazar }, i) => {
            const producto = venta ? e.productos.find((x) => x.id === venta.productoId)?.nombre ?? "Venta" : alumno?.plan || "Servicio";
            const reportes = alumno ? e.reportes.filter((r) => r.alumnoId === alumno.id)
              .sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel)) : [];
            const etapa = alumno ? etapaDelAlumno(etapas, alumno) : undefined;
            const clave = alumno?.id ?? venta?.id ?? String(i);
            /* Abierto lo que está en curso; lo graduado o dado de baja, plegado. */
            const porDefecto = servicios.length === 1 || !alumno || alumno.estado === "activo" || alumno.estado === "pausado";
            const abierta = plegado.abierta(clave, porDefecto);
            return (
              <div className="venta-card" key={clave}>
                <CabezaPlegable
                  abierta={abierta} onAlternar={() => plegado.alternar(clave, porDefecto)} cuerpoId={`servicio-${clave}`}
                  accion={alumno && <IconButton etiqueta="Editar el servicio" onClick={() => setEditar({ ...alumno })}><Pencil size={15} /></IconButton>}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="row-wrap" style={{ gap: 8 }}>
                      <span className="t-strong" style={{ fontSize: 16 }}>{producto}</span>
                      {alumno && <Badge variante={ESTADO_ALUMNO[alumno.estado].variante}>{ESTADO_ALUMNO[alumno.estado].texto}</Badge>}
                    </span>
                    <span className="t-sm t-subtle" style={{ display: "block", marginTop: 2 }}>
                      {venta ? `Compra del ${fechaLarga(venta.fecha)}` : "Sin venta enlazada"}
                      {alumno?.cohorte ? ` · cohorte ${alumno.cohorte}` : ""}
                      {!abierta && etapa ? ` · ${etapa.nombre}` : ""}
                      {!abierta && alumno ? ` · progreso ${alumno.progreso}%` : ""}
                    </span>
                  </span>
                </CabezaPlegable>

                {abierta && (
                  <div className="venta-card__cuerpo" id={`servicio-${clave}`}>
                    {!alumno && venta ? (
                      <div className="row-wrap">
                        <span className="t-sm t-subtle">
                          {venta.estado === "activa" ? "Esta compra todavía no tiene su servicio." : "La venta está cancelada: no tiene servicio."}
                        </span>
                        {venta.estado === "activa" && (
                          <Button sm variante="primary" icono={<Plus size={14} />}
                            onClick={() => { if (acciones.crearServicioDeVenta(venta.id)) toast(`Servicio de ${producto} creado.`); }}>
                            Crear servicio
                          </Button>
                        )}
                      </div>
                    ) : alumno && (
                      <>
                        <div className="form-grid">
                          <div className="hk-field">
                            <span className="hk-label">Etapa del servicio</span>
                            <Select aria-label="Etapa del servicio" value={etapa?.id ?? ""}
                              onChange={(ev) => {
                                const et = etapas.find((x) => x.id === ev.target.value);
                                if (!et || et.id === etapa?.id) return;
                                acciones.moverAlumno(alumno.id, et.id);
                                toast(`${alumno.nombre} → ${et.nombre}`);
                              }}
                              opciones={etapas.map((et) => ({ valor: et.id, texto: et.nombre }))} />
                          </div>
                          <div className="hk-field">
                            <span className="hk-label">Estado</span>
                            <Select aria-label="Estado del servicio" value={alumno.estado}
                              onChange={(ev) => acciones.actualizar<Alumno>("alumnos", alumno.id, { estado: ev.target.value as EstadoAlumno }, alumno.nombre)}
                              opciones={ESTADOS_ALUMNO.map((k) => ({ valor: k, texto: ESTADO_ALUMNO[k].texto }))} />
                          </div>
                          {/* Si ya lo sumaron a la comunidad del programa. Es la columna
                              "Ingreso a la comunidad" de la planilla: vive en la venta
                              (sale en la exportación), pero se marca acá, cuando arranca. */}
                          {venta && (
                            <div className="hk-field">
                              <span className="hk-label">Ingreso a la comunidad</span>
                              <Select aria-label="Ingreso a la comunidad" value={venta.ingresoComunidad ?? ""} placeholder="Sin definir"
                                onChange={(ev) => {
                                  const v = ev.target.value as IngresoComunidad | "";
                                  acciones.actualizar<Venta>("ventas", venta.id, { ingresoComunidad: v || undefined }, venta.contactoNombre,
                                    `${venta.contactoNombre}: ingreso a la comunidad «${v || "sin definir"}».`);
                                  toast("Ingreso a la comunidad guardado.");
                                }}
                                opciones={INGRESOS_COMUNIDAD} />
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="row t-sm" style={{ marginBottom: 6 }}>
                            <span className="t-subtle">Progreso del programa</span>
                            <span className="spacer t-num t-strong">{alumno.progreso}%</span>
                          </div>
                          <Bar valor={alumno.progreso} tono={alumno.progreso >= 80 ? "success" : "brand"} />
                          <div className="row-wrap" style={{ marginTop: 10 }}>
                            {[0, 25, 50, 75, 100].map((v) => (
                              <Chip key={v} activo={alumno.progreso === v}
                                onClick={() => acciones.actualizar<Alumno>("alumnos", alumno.id, { progreso: v }, alumno.nombre, `${alumno.nombre}: progreso al ${v}%.`)}>
                                {v}%
                              </Chip>
                            ))}
                          </div>
                        </div>

                        <dl className="dl dl--compacta">
                          <dt>Plan</dt><dd>{alumno.plan || "—"}</dd>
                          <dt>Empezó</dt><dd>{fechaLarga(alumno.inicio)} · {cuandoEmpezo(relativo(alumno.inicio))}</dd>
                          <dt>Cuota</dt><dd className="t-num">{alumno.cuotaMensual > 0 ? `${money(alumno.cuotaMensual, alumno.moneda)} por mes` : "Sin cuota mensual"}</dd>
                          <DatosExtra campos={e.campos} entidad="alumno" valores={alumno.extra} />
                        </dl>

                        {!venta && <VentaDelAlumno alumno={alumno} />}
                        {venta && sinEnlazar && (
                          <div className="row-wrap">
                            <span className="t-sm t-subtle">Este servicio todavía no tiene la venta enlazada.</span>
                            <Button sm variante="secondary" onClick={() => {
                              acciones.actualizar<Alumno>("alumnos", alumno.id, { ventaId: venta.id }, alumno.nombre, `Se enlazó a ${alumno.nombre} la venta del ${fechaLarga(venta.fecha)}.`);
                              toast("Venta enlazada.");
                            }}>Enlazar la venta</Button>
                          </div>
                        )}

                        <div className="stack-2">
                          <div className="row">
                            <span className="t-label">Reportes semanales ({reportes.length})</span>
                            <a className="link t-sm spacer" href="/reportes?seccion=tabla" style={{ textAlign: "right" }}>Ver todos</a>
                          </div>
                          {reportes.length === 0 ? (
                            <p className="t-sm t-subtle">Todavía no mandó ningún reporte.</p>
                          ) : reportes.slice(0, 5).map((r) => (
                            <div key={r.id} className="row t-sm" style={{ gap: 8 }}>
                              <span>Semana del {fechaLarga(r.semanaDel)}</span>
                              {r.estado === "completado" && r.horasEstudio !== undefined && (
                                <span className="t-subtle t-num">{r.horasEstudio} h · {r.postulaciones ?? 0} post.</span>
                              )}
                              <span className="spacer" />
                              <Badge variante={r.estado === "completado" ? "success" : r.estado === "vencido" ? "danger" : r.estado === "pendiente" ? "accent" : "neutral"}>
                                {r.estado === "completado" ? "Completado" : r.estado === "vencido" ? "Vencido" : r.estado === "pendiente" ? "Pendiente" : "No enviado"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                        {alumno.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap" }}>{alumno.notas}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {solapa === "chat" && <ChatEquipo contactoId={p.clave} comentarios={p.comentarios} />}
      {solapa === "historial" && <HistorialPersona e={e} p={p} />}

      {editar && <EditarAlumno form={editar} setForm={setEditar} onGuardar={guardarEdicion} />}
    </>
  );
}
