"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Copy, GraduationCap, Mail, MessageCircle, Pencil, Phone, Plus, ShoppingBag, X,
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
import type { VistaFicha } from "./abrir";
import { acciones, useEstado } from "@/lib/store";
import { personaDe, type Persona } from "@/lib/persona";
import { fechaHora, fechaLarga, money, relativo } from "@/lib/format";
import type { Alumno, Cuota, EstadoAlumno, EstadoApp, Venta } from "@/lib/types";

/* ==================================================================
   La ficha de una persona. La misma, se abra desde donde se abra.

   Arriba a la derecha, dos pestañas: VENTAS (cómo llegó, sus llamadas,
   lo que compró y cómo lo va pagando) y SERVICIO (lo que se le está
   dando por cada compra). A la izquierda, siempre, cómo contactarla y
   su perfil. El chat del equipo está en las dos: la conversación es
   sobre la persona, no sobre un área.

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
            <Cabecera e={e} p={p} vista={vista} onVista={onVista} onCerrar={onCerrar} />
            <div className="ficha__cuerpo">
              <Lateral e={e} p={p} />
              <div className="ficha__principal">
                {vista === "ventas"
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

function Cabecera({ e, p, vista, onVista, onCerrar }: {
  e: EstadoApp; p: Persona; vista: VistaFicha; onVista: (v: VistaFicha) => void; onCerrar: () => void;
}) {
  const lead = p.leads[0];
  const etapa = lead ? e.etapas.find((x) => x.id === lead.etapaId) : undefined;
  const alumno = p.alumnos[0];
  return (
    <header className="ficha__head">
      <Avatar nombre={p.nombre} size={44} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t-label">Ficha del contacto</div>
        <h2 className="ficha__nombre truncate">{p.nombre}</h2>
        <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
          {etapa && <Badge variante={etapa.variante}>{etapa.nombre}</Badge>}
          {p.ventas.length > 0 && <Badge variante="success"><ShoppingBag size={12} />{p.ventas.length === 1 ? "Cliente" : `Cliente · ${p.ventas.length} compras`}</Badge>}
          {alumno && <Badge variante="brand"><GraduationCap size={12} />Alumno {alumno.estado}</Badge>}
          {p.pais && <Badge variante="neutral">{p.pais}</Badge>}
        </div>
      </div>
      <div className="ficha__acciones">
        <div className="segmento" role="tablist" aria-label="Qué mirar de la persona">
          {(["ventas", "servicio"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => onVista(v)}>
              {v === "ventas" ? "Ventas" : "Servicio"}
            </button>
          ))}
        </div>
        <IconButton etiqueta="Cerrar la ficha" onClick={onCerrar}><X size={18} /></IconButton>
      </div>
    </header>
  );
}

/* ---------- Columna izquierda: cómo contactarla y su perfil ---------- */

function Lateral({ e, p }: { e: EstadoApp; p: Persona }) {
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

  const perfil: [string, React.ReactNode][] = [
    ["Inglés", c?.inglesNivel ?? lead?.inglesNivel],
    ["Años programando", c?.aniosExperiencia ?? lead?.aniosExperiencia],
    ["Lenguajes", c?.tecnologias],
    ["Formación", c?.formacion],
    ["Gana por mes (USD)", c?.sueldoUsd],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, React.ReactNode][];

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
            <dt>Fuente</dt><dd>{lead.fuente || "—"}</dd>
            {lead.campania && <><dt>Campaña</dt><dd className="truncate">{lead.campania}</dd></>}
            <dt>Responsable</dt><dd>{lead.responsable || "—"}</dd>
            {lead.webinarId && <><dt>Webinar</dt><dd className="truncate">{e.webinars.find((w) => w.id === lead.webinarId)?.titulo ?? "—"}</dd></>}
            <dt>Entró</dt><dd>{fechaLarga(lead.creadoEn)}</dd>
            <DatosExtra campos={e.campos} entidad="lead" valores={lead.extra} />
          </dl>
          <a className="link t-sm" href={`/leads?editar=${lead.id}`}><Pencil size={13} /> Editar los datos</a>
        </section>
      )}

      {perfil.length > 0 && (
        <section>
          <div className="t-label" style={{ marginBottom: 8 }}>Perfil</div>
          <dl className="dl dl--compacta">
            {perfil.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>))}
          </dl>
        </section>
      )}

      <section className="stack-2">
        <div className="t-label">Llamadas ({p.sesiones.length})</div>
        {p.sesiones.length === 0 ? (
          <p className="t-sm t-subtle">Todavía no agendó. Cuando lo haga por Calendly, aparece acá.</p>
        ) : (
          p.sesiones.slice(0, 6).map((s) => (
            <a key={s.id} className="llamada-fila" href={`/agenda?ver=${s.id}`}>
              <CalendarDays size={14} className="t-subtle" />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="truncate t-sm t-strong" style={{ display: "block" }}>{fechaHora(s.inicia)}</span>
                <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{s.tipo || s.titulo}</span>
              </span>
              <Badge variante={s.estado === "hecha" ? "success" : s.estado === "no-show" || s.estado === "cancelada" ? "danger" : "info"}>
                {s.estado === "hecha" ? "Hecha" : s.estado === "no-show" ? "No vino" : s.estado === "cancelada" ? "Cancelada" : "Agendada"}
              </Badge>
            </a>
          ))
        )}
      </section>

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
  const [cancelar, setCancelar] = useState<Venta | null>(null);
  const [nuevaVenta, setNuevaVenta] = useState(false);

  /* Si se abrió desde una venta, esa venta a la vista. */
  const variasVentas = p.ventas.length > 1;
  useEffect(() => {
    /* Con una sola venta ya se ve de entrada: scrollear escondería las solapas. */
    if (!ventaResaltada || !variasVentas) return;
    const t = window.setTimeout(() => document.getElementById(`venta-${ventaResaltada}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
    return () => window.clearTimeout(t);
  }, [ventaResaltada, variasVentas]);

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
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setNuevaVenta(true)}>Registrar venta</Button>}
            />
          ) : (
            <>
              {p.ventas.map((v) => (
                <TarjetaVenta
                  key={v.id} e={e} venta={v} resaltada={v.id === ventaResaltada}
                  onPagar={setPagar}
                  onEditar={() => setEditar(desdeVenta(e, v))}
                  onCancelar={() => setCancelar(v)}
                />
              ))}
              <Button variante="brand" icono={<Plus size={16} />} onClick={() => setNuevaVenta(true)} style={{ alignSelf: "flex-start" }}>
                Nueva venta · upsell o renovación
              </Button>
            </>
          )}
        </div>
      )}
      {solapa === "chat" && <ChatEquipo contactoId={p.clave} comentarios={p.comentarios} />}
      {solapa === "historial" && <HistorialPersona e={e} p={p} />}
      {solapa === "utms" && <UtmsPersona e={e} p={p} />}

      {pagar && (
        <RegistrarPago cuota={pagar} onCerrar={() => setPagar(null)} onGuardado={(m) => { toast(m); setPagar(null); }} />
      )}
      {editar && (
        <FormularioVenta borrador={editar} onCerrar={() => setEditar(null)}
          onGuardado={(n) => { toast(`Venta de ${n} actualizada.`); setEditar(null); }} />
      )}
      <Confirmar
        abierto={cancelar !== null} onCerrar={() => setCancelar(null)} confirmarTexto="Cancelar la venta"
        titulo={`¿Cancelar la venta de ${cancelar?.contactoNombre ?? ""}?`}
        texto="Las cuotas y los pagos quedan como historial; la venta deja de contar como activa."
        onConfirmar={() => {
          if (!cancelar) return;
          acciones.actualizar<Venta>("ventas", cancelar.id, { estado: "cancelada" }, cancelar.contactoNombre,
            `Se canceló la venta de ${cancelar.contactoNombre}. Las cuotas quedan registradas.`);
          toast("Venta cancelada. Las cuotas quedan como historial.");
        }}
      />
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

/* ---------- Vista Servicio ---------- */

function VistaServicio({ e, p }: { e: EstadoApp; p: Persona }) {
  const toast = useToast();
  const [solapa, setSolapa] = useState<SolapaServicio>("servicio");
  const [editar, setEditar] = useState<Alumno | null>(null);
  const etapas = useMemo(() => etapasDeServicio(e), [e]);

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
    acciones.actualizar<Alumno>("alumnos", id, { ...cambios, nombre }, nombre);
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
            return (
              <div className="venta-card" key={alumno?.id ?? venta?.id ?? i}>
                <div className="venta-card__head">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="row-wrap" style={{ gap: 8 }}>
                      <span className="t-strong" style={{ fontSize: 16 }}>{producto}</span>
                      {alumno && <Badge variante={ESTADO_ALUMNO[alumno.estado].variante}>{ESTADO_ALUMNO[alumno.estado].texto}</Badge>}
                    </span>
                    <span className="t-sm t-subtle" style={{ display: "block", marginTop: 2 }}>
                      {venta ? `Compra del ${fechaLarga(venta.fecha)}` : "Sin venta enlazada"}
                      {alumno?.cohorte ? ` · cohorte ${alumno.cohorte}` : ""}
                    </span>
                  </span>
                  {alumno && <IconButton etiqueta="Editar el servicio" onClick={() => setEditar({ ...alumno })}><Pencil size={15} /></IconButton>}
                </div>

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
                        <a className="link t-sm spacer" href="/reportes?vista=tabla" style={{ textAlign: "right" }}>Ver todos</a>
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
