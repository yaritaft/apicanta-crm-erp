"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Copy, GraduationCap, Mail, MessageCircle, Pencil, Phone, Plus, ShoppingBag, X,
} from "lucide-react";
import {
  Avatar, Badge, Button, Empty, IconButton, Select, Tabs,
} from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { DatosExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { enlaceWhatsapp, numeroParaCopiar } from "@/lib/contacto-telefono";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { desdeVenta, FormularioVenta, type BorradorVenta } from "@/components/ventas/FormularioVenta";
import { RegistrarPago } from "@/components/cobros/RegistrarPago";
import { ChatEquipo } from "./ChatEquipo";
import { VistaServicio } from "./HojaServicio";
import { Divisor, useAnchoPanel } from "@/components/ui/Divisor";
import { HistorialPersona } from "./HistorialPersona";
import { UtmsPersona } from "./UtmsPersona";
import { TarjetaVenta } from "./TarjetaVenta";
import { VistaLlamadas } from "./VistaLlamadas";
import { usePlegado } from "./Plegable";
import type { VistaFicha } from "./abrir";
import { acciones, cuotasQueCancelaLaBaja, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn, type MiAcceso } from "@/lib/permisos";
import { filasDePersona, filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import { personaDe, type Persona } from "@/lib/persona";
import { saldoVenta } from "@/lib/finanzas";
import { fechaLarga, money } from "@/lib/format";
import type { Alumno, Cuota, EstadoApp, EstadoVenta, Pago, Venta } from "@/lib/types";

/* ==================================================================
   La ficha de una persona. La misma, se abra desde donde se abra.

   Arriba a la derecha, las vistas: LLAMADAS (cada llamada y cómo
   terminó), VENTAS (lo que compró y cómo lo va pagando) y SERVICIO (lo
   que se le está dando por cada compra). A la izquierda, siempre, la
   persona: cómo contactarla, su oportunidad y de dónde vino. Quién es
   va arriba de sus llamadas. Cada dato está en un solo lugar (02/10: «no quiero que sobre data ni
   cosas duplicadas»). El chat del equipo está en ventas y servicio: la
   conversación es sobre la persona, no sobre un área.

   Es como la ficha de Blue OS: ocupa la pantalla entera, con la persona a
   la izquierda, lo de la vista en el medio y, en una pantalla ancha, el chat
   del equipo siempre a la derecha (20/10).
   ================================================================== */

type SolapaVentas = "ventas" | "chat" | "historial" | "utms";

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
  /* En una pantalla ancha el chat va en su propia columna, siempre a la vista; en una angosta, como una solapa más. */
  const conChat = useAnchoMinimo(1200);
  /* La línea entre la ficha y el chat se arrastra (como en Blue OS); el ancho del chat queda guardado en este navegador. */
  const anchoChat = useAnchoPanel({ variable: "--chat-w", clave: "apicanta:ficha:ancho-chat", min: 280, minResto: 320 + 480 });

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
            <div ref={anchoChat.contRef} className={`ficha__cuerpo${conChat ? " ficha__cuerpo--chat" : ""}`}>
              <Lateral e={e} p={p} filas={filas} />
              <div className="ficha__principal">
                {vistas.length === 0
                  ? null
                  : vistaReal === "llamadas"
                    ? <VistaLlamadas p={p} filas={filas} />
                    : vistaReal === "ventas"
                      ? <VistaVentas e={e} p={p} ventaResaltada={ventaResaltada} conChat={conChat} />
                      : <VistaServicio e={e} p={p} conChat={conChat} />}
              </div>
              {conChat && (
                <aside ref={anchoChat.panelRef} className="ficha__chat" aria-label="Chat del equipo">
                  <Divisor {...anchoChat} etiqueta="Cambiar el ancho del chat" />
                  <ChatEquipo contactoId={p.clave} comentarios={p.comentarios} />
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* true si la ventana mide al menos `px` de ancho (y se actualiza al cambiarla). */
function useAnchoMinimo(px: number): boolean {
  const consulta = `(min-width: ${px}px)`;
  return React.useSyncExternalStore(
    (avisar) => { const mq = window.matchMedia(consulta); mq.addEventListener("change", avisar); return () => mq.removeEventListener("change", avisar); },
    () => window.matchMedia(consulta).matches,
    () => true,
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
  const whatsapp = enlaceWhatsapp(p.telefono, p.contacto?.pais || p.leads[0]?.pais);

  const copiar = (valor: string, que: string) => {
    void copiarTexto(que === "el teléfono" ? numeroParaCopiar(valor, c?.pais || lead?.pais) : valor).then((ok) =>
      toast(ok ? `${que.charAt(0).toUpperCase() + que.slice(1)} copiado.` : "No se pudo copiar.", ok ? "ok" : "err"));
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
          accion={whatsapp ? <a className="link t-sm" href={whatsapp} target="_blank" rel="noopener noreferrer" title="Abrir el chat de WhatsApp" aria-label="Abrir el chat de WhatsApp"><MessageCircle size={15} /></a> : undefined} />
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
      {valor ? (
        <button type="button" className="telefono__num t-sm" style={{ flex: 1, minWidth: 0, border: 0, background: "none", padding: 0, textAlign: "left", overflowWrap: "anywhere", cursor: "copy" }}
          title={`Tocá para copiar ${que}`} onClick={() => onCopiar(valor, que)}>{valor}</button>
      ) : (
        <span className="truncate t-sm t-subtle" style={{ flex: 1, minWidth: 0 }}>{vacio}</span>
      )}
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

function VistaVentas({ e, p, ventaResaltada, conChat }: { e: EstadoApp; p: Persona; ventaResaltada?: string | null; conChat: boolean }) {
  const toast = useToast();
  const [solapa, setSolapa] = useState<SolapaVentas>("ventas");
  const [pagar, setPagar] = useState<Cuota | null>(null);
  /* Un cobro ya cargado que se corrige con el mismo asistente. */
  const [corregir, setCorregir] = useState<Pago | null>(null);
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
    const ventaId = pagar?.ventaId ?? e.cuotas.find((c) => c.id === corregir?.cuotaId)?.ventaId;
    if (mensaje) toast(mensaje);
    setPagar(null);
    setCorregir(null);
    if (ventaId) {
      window.setTimeout(() => document.getElementById(`venta-${ventaId}`)?.scrollIntoView({ block: "nearest" }), 60);
    }
  }
  if (pagar) {
    return <RegistrarPago embebido cuota={pagar} onCerrar={() => terminarPago()} onGuardado={terminarPago} />;
  }
  const cuotaDelCobro = corregir ? e.cuotas.find((c) => c.id === corregir.cuotaId) : undefined;
  if (corregir && cuotaDelCobro) {
    return <RegistrarPago embebido cuota={cuotaDelCobro} pagoAEditar={corregir} onCerrar={() => terminarPago()} onGuardado={terminarPago} />;
  }

  return (
    <>
      <Tabs<SolapaVentas>
        valor={solapa} onChange={setSolapa}
        opciones={[
          { valor: "ventas", texto: `Ventas (${p.ventas.length})` },
          ...(conChat ? [] : [{ valor: "chat" as SolapaVentas, texto: `Chat (${p.comentarios.length})` }]),
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
                    onEditarPago={setCorregir}
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
