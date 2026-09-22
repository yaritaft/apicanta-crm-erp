"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ExternalLink, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, Chip, Empty, Field, IconButton, Input, Select, StatCard, Tabs, Textarea } from "@/components/ui/ui";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { Origen } from "@/components/leads/Origen";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { AGENDAR_A_MANO } from "@/lib/funciones";
import { fechaHora, fechaLarga, hora, isoMinuto, pct, relativo } from "@/lib/format";
import { sesionesSemana, tasaShow } from "@/lib/metricas";
import type { EstadoSesion, Sesion } from "@/lib/types";

const ETIQUETA: Record<EstadoSesion, { texto: string; variante: "accent" | "success" | "danger" | "neutral" }> = {
  "agendada": { texto: "Agendada", variante: "accent" },
  "hecha": { texto: "Hecha", variante: "success" },
  "no-show": { texto: "No vino", variante: "danger" },
  "cancelada": { texto: "Cancelada", variante: "neutral" },
};

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const VACIA = (tipo: string): Omit<Sesion, "id"> => {
  const d = new Date(); d.setHours(d.getHours() + 24, 0, 0, 0);
  return {
    titulo: tipo, invitado: "", email: "", inicia: d.toISOString(), duracionMin: 45,
    estado: "agendada", tipo, enlace: "", origen: "manual", notas: "",
    creadoEn: new Date().toISOString(), extra: {},
  };
};

export default function Agenda() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [vista, setVista] = useState<"proximas" | "pasadas">("proximas");
  const [estado, setEstado] = useState<"todos" | EstadoSesion>("todos");
  const [form, setForm] = useState<(Omit<Sesion, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Sesion | null>(null);

  useEffect(() => {
    if (url.nuevo) { if (AGENDAR_A_MANO) setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión")); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url, e.ajustes.tiposSesion]);

  const ahora = Date.now();
  const deSemana = sesionesSemana(e);

  const lista = useMemo(() => {
    let xs = e.sesiones;
    if (vista === "proximas") xs = xs.filter((s) => new Date(s.inicia).getTime() >= ahora - 3600000);
    else xs = xs.filter((s) => new Date(s.inicia).getTime() < ahora);
    if (estado !== "todos") xs = xs.filter((s) => s.estado === estado);
    return [...xs].sort((a, b) =>
      vista === "pasadas" ? +new Date(b.inicia) - +new Date(a.inicia) : +new Date(a.inicia) - +new Date(b.inicia));
  }, [e.sesiones, vista, estado, ahora, deSemana]);

  const porDia = useMemo(() => {
    const m = new Map<string, Sesion[]>();
    for (const s of lista) {
      const k = new Date(s.inicia).toDateString();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()];
  }, [lista]);

  const sesionVista = e.sesiones.find((s) => s.id === ver) ?? null;
  const hoy = new Date().toDateString();

  function guardar() {
    if (!form) return;
    if (!form.invitado.trim()) { toast("Poné a nombre de quién es la sesión.", "err"); return; }
    if (form.id) {
      acciones.actualizar<Sesion>("sesiones", form.id, form, `${form.tipo} — ${form.invitado}`);
      toast("Sesión actualizada.");
    } else {
      acciones.crear<Sesion>("sesiones", form, `${form.tipo} — ${form.invitado}`);
      toast(`Sesión agendada con ${form.invitado}.`);
    }
    setForm(null);
  }

  function cambiarEstado(s: Sesion, nuevo: EstadoSesion) {
    acciones.actualizar<Sesion>("sesiones", s.id, { estado: nuevo }, `${s.tipo} — ${s.invitado}`, `${s.invitado}: la sesión pasó a «${ETIQUETA[nuevo].texto}».`);
    toast(`Marcada como ${ETIQUETA[nuevo].texto.toLowerCase()}.`);
  }

  return (
    <div className="stack-5">
      <PageHead
        titulo="Agenda"
        sub={AGENDAR_A_MANO
          ? "Todas las llamadas, de Calendly o cargadas a mano. Marcá si la persona vino o no para que el número de asistencia sea real."
          : "Las llamadas entran solas desde Calendly. Marcá si la persona vino o no para que el número de asistencia sea real."}
        acciones={AGENDAR_A_MANO ? <Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión"))}>Agendar sesión</Button> : undefined}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Esta semana" valor={String(deSemana.length)} contexto="sesiones en el calendario" />
        <StatCard etiqueta="Por venir" valor={String(e.sesiones.filter((s) => s.estado === "agendada" && new Date(s.inicia).getTime() >= ahora).length)} contexto="todavía sin hacer" />
        <StatCard etiqueta="Asistencia" valor={pct(tasaShow(e))} contexto="de las sesiones ya pasadas" ayuda="Cuántas de las sesiones que ya pasaron terminaron en reunión real." />
        <StatCard etiqueta="No-shows" valor={String(e.sesiones.filter((s) => s.estado === "no-show").length)} delta={e.sesiones.filter((s) => s.estado === "no-show").length > 0 ? "Revisar" : undefined} direccion="accent" contexto="gente que no vino" />
      </div>

      <Card>
        <div className="toolbar">
          <Tabs
            valor={vista} onChange={setVista}
            opciones={[
              { valor: "proximas", texto: "Próximas" },
              { valor: "pasadas", texto: "Pasadas" },
            ]}
          />
          <span className="spacer" />
          <div style={{ width: 200 }}>
            <Select
              value={estado} aria-label="Filtrar por estado"
              onChange={(ev) => setEstado(ev.target.value as "todos" | EstadoSesion)}
              opciones={[
                { valor: "todos", texto: "Todos los estados" },
                ...(Object.keys(ETIQUETA) as EstadoSesion[]).map((k) => ({
                  valor: k, texto: `${ETIQUETA[k].texto} (${e.sesiones.filter((s) => s.estado === k).length})`,
                })),
              ]}
            />
          </div>
        </div>

        {porDia.length === 0 ? (
          <Empty
            icono={<CalendarDays size={22} />}
            titulo={vista === "proximas" ? "No hay nada agendado" : "Nada para mostrar"}
            texto={vista === "proximas" ? "Cuando agendes una llamada va a aparecer acá, ordenada por día." : "Probá con otra vista o sacá el filtro de estado."}
            accion={AGENDAR_A_MANO ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión"))}>Agendar una sesión</Button> : undefined}
          />
        ) : (
          <div>
            {porDia.map(([dia, items]) => {
              const d = new Date(dia);
              return (
                <div key={dia} className={`agenda-day${dia === hoy ? " agenda-day--hoy" : ""}`}>
                  <div className="agenda-day__label">
                    <div className="agenda-day__dow">{dia === hoy ? "Hoy" : DOW[d.getDay()]}</div>
                    <div className="agenda-day__num">{d.getDate()}</div>
                    <div className="t-sm t-subtle">{fechaLarga(d.toISOString()).split(" ").slice(1).join(" ")}</div>
                  </div>
                  <div className="stack-2">
                    {items.map((s) => (
                      <div key={s.id} className="agenda-item" onClick={() => setVer(s.id)} role="button" tabIndex={0}
                        onKeyDown={(ev) => { if (ev.key === "Enter") setVer(s.id); }}>
                        <span className="agenda-item__hora">{hora(s.inicia)}</span>
                        <span className="agenda-item__quien">
                          <span className="truncate t-strong" style={{ display: "block", color: "var(--ink)" }}>{s.invitado}</span>
                          <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{s.tipo} · {s.duracionMin} min</span>
                        </span>
                        <span className="agenda-item__cola">
                          {s.origen === "calendly" && <Badge variante="info"><Link2 size={13} />Calendly</Badge>}
                          <Badge variante={ETIQUETA[s.estado].variante}>{ETIQUETA[s.estado].texto}</Badge>
                          <span onClick={(ev) => ev.stopPropagation()} style={{ display: "flex", gap: 2 }}>
                            {s.estado === "agendada" && (
                              <>
                                <IconButton etiqueta="Marcar como hecha" onClick={() => cambiarEstado(s, "hecha")}><Check size={15} /></IconButton>
                                <IconButton etiqueta="Marcar que no vino" onClick={() => cambiarEstado(s, "no-show")}><X size={15} /></IconButton>
                              </>
                            )}
                            <IconButton etiqueta="Editar" onClick={() => setForm({ ...s })}><Pencil size={15} /></IconButton>
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!e.sesiones.some((s) => s.calendlyInvitadoUri) && (
        <Ayuda titulo="Las llamadas de Calendly entran solas" icono={<Link2 size={18} />}>
          Cada vez que alguien agende, cancele o no se presente, aparece acá en segundos, con el canal, los UTMs y
          lo que contestó en el formulario. Todavía no llegó ninguna.
        </Ayuda>
      )}

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar sesión" : "Agendar sesión"}
          sub="Anotá con quién es, cuándo y de qué tipo."
          guardarTexto={form.id ? "Guardar cambios" : "Agendar"}
          puedeGuardar={form.invitado.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Con quién" ayuda="El nombre de la persona.">
              <Input value={form.invitado} onChange={(ev) => setForm({ ...form, invitado: ev.target.value })} placeholder="Martín Quiroga" autoFocus />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email ?? ""} onChange={(ev) => setForm({ ...form, email: ev.target.value })} placeholder="martin@gmail.com" />
            </Field>
            <Field label="Cuándo">
              <Input type="datetime-local" value={isoMinuto(form.inicia)} onChange={(ev) => setForm({ ...form, inicia: new Date(ev.target.value).toISOString() })} />
            </Field>
            <Field label="Duración" ayuda="En minutos.">
              <Input type="number" min={5} step={5} value={form.duracionMin} onChange={(ev) => setForm({ ...form, duracionMin: Number(ev.target.value) })} />
            </Field>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(ev) => setForm({ ...form, tipo: ev.target.value, titulo: ev.target.value })} opciones={e.ajustes.tiposSesion} />
            </Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoSesion })}
                opciones={(Object.keys(ETIQUETA) as EstadoSesion[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </Field>
            <Field label="Lead asociado" span2 ayuda="Opcional. Si la sesión es con un lead, vinculalos para ver todo junto en su ficha.">
              <Select
                value={form.leadId ?? ""} onChange={(ev) => setForm({ ...form, leadId: ev.target.value || undefined })}
                placeholder="Sin vincular"
                opciones={e.leads.map((l) => ({ valor: l.id, texto: `${l.nombre} — ${l.email}` }))}
              />
            </Field>
            <Field label="Enlace de la reunión" span2>
              <Input value={form.enlace ?? ""} onChange={(ev) => setForm({ ...form, enlace: ev.target.value })} placeholder="https://meet.google.com/…" />
            </Field>
            <Field label="Notas" span2>
              <Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} />
            </Field>
            <CamposExtra campos={e.campos} entidad="sesion" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      {sesionVista && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={sesionVista.invitado}
          sub={`${sesionVista.tipo} · ${fechaLarga(sesionVista.inicia)} a las ${hora(sesionVista.inicia)}`}
          pie={
            <>
              <Button variante="secondary" icono={<Pencil size={16} />} onClick={() => { setForm({ ...sesionVista }); setVer(null); }}>Editar</Button>
              <Button variante="danger" icono={<Trash2 size={16} />} onClick={() => { setBorrar(sesionVista); setVer(null); }}>Eliminar</Button>
            </>
          }
        >
          <div className="stack-5">
            <div className="row-wrap">
              <Badge variante={ETIQUETA[sesionVista.estado].variante}>{ETIQUETA[sesionVista.estado].texto}</Badge>
              {sesionVista.origen === "calendly" && <Badge variante="info"><Link2 size={13} />Calendly</Badge>}
            </div>

            {sesionVista.estado === "agendada" && (
              <div>
                <div className="t-label" style={{ marginBottom: 10 }}>¿Cómo salió?</div>
                <div className="row-wrap">
                  <Button sm variante="secondary" icono={<Check size={15} />} onClick={() => cambiarEstado(sesionVista, "hecha")}>Se hizo</Button>
                  <Button sm variante="secondary" icono={<X size={15} />} onClick={() => cambiarEstado(sesionVista, "no-show")}>No vino</Button>
                  <Button sm variante="ghost" onClick={() => cambiarEstado(sesionVista, "cancelada")}>Se canceló</Button>
                </div>
              </div>
            )}

            <dl className="dl">
              <Dato label="Email">{sesionVista.email || "—"}</Dato>
              <Dato label="Duración">{sesionVista.duracionMin} min</Dato>
              <Dato label="Origen">{sesionVista.origen === "calendly" ? "Calendly" : "Cargada a mano"}</Dato>
              {sesionVista.canal && <Dato label="Agendó por">{ETIQUETA_CANAL[sesionVista.canal]}</Dato>}
              {sesionVista.anfitrion && <Dato label="La atiende">{sesionVista.anfitrion}</Dato>}
              {/* Calendly avisa la reprogramación como una cancelación de la vieja
                  más una agenda nueva que la referencia: las dos quedan
                  enlazadas, así se sigue la cadena en cualquier dirección. */}
              {(() => {
                const antes = sesionVista.reprogramadaDe ? e.sesiones.find((x) => x.id === sesionVista.reprogramadaDe) : undefined;
                return sesionVista.reprogramadaDe ? (
                  <Dato label="Reprogramada">
                    {antes
                      ? <button type="button" className="link" onClick={() => setVer(antes.id)}>Antes era el {fechaHora(antes.inicia)}</button>
                      : "Sí, de una agenda anterior"}
                  </Dato>
                ) : null;
              })()}
              {(() => {
                const despues = e.sesiones.find((x) => x.reprogramadaDe === sesionVista.id);
                return despues ? (
                  <Dato label="Se reprogramó">
                    <button type="button" className="link" onClick={() => setVer(despues.id)}>Para el {fechaHora(despues.inicia)}</button>
                  </Dato>
                ) : null;
              })()}
              {sesionVista.motivoCancelacion && <Dato label="Por qué se canceló">{sesionVista.motivoCancelacion}</Dato>}
              <Dato label="Creada">{relativo(sesionVista.creadoEn)}</Dato>
              {sesionVista.leadId && <Dato label="Lead">{e.leads.find((l) => l.id === sesionVista.leadId)?.nombre ?? "—"}</Dato>}
              <DatosExtra campos={e.campos} entidad="sesion" valores={sesionVista.extra} />
            </dl>

            {(sesionVista.contactoId || sesionVista.utm) && (
              <Origen
                contacto={e.contactos.find((c) => c.id === sesionVista.contactoId)}
                utmAgenda={sesionVista.utm}
              />
            )}

            {sesionVista.respuestas && sesionVista.respuestas.length > 0 && (
              <div>
                <div className="t-label" style={{ marginBottom: 12 }}>Lo que contestó al agendar</div>
                {/* Pregunta arriba, respuesta abajo: las preguntas del formulario son
                    largas y en la columna de etiquetas se partían en cuatro renglones. */}
                <div className="stack-3">
                  {sesionVista.respuestas.map((q) => (
                    <div key={q.pregunta}>
                      <div className="t-sm t-subtle">{q.pregunta}</div>
                      <div className="t-body">{q.respuesta}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sesionVista.enlace && (
              <a href={sesionVista.enlace} target="_blank" rel="noreferrer">
                <Button variante="secondary" icono={<ExternalLink size={16} />}>Abrir la reunión</Button>
              </a>
            )}

            {sesionVista.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{sesionVista.notas}</p>
              </div>
            )}
          </div>
        </Drawer>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar esta sesión?"
        texto={`Se borra la sesión con ${borrar?.invitado}. Esto no se puede deshacer.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("sesiones", borrar.id, `${borrar.tipo} — ${borrar.invitado}`); toast("Sesión eliminada."); } }}
      />
    </div>
  );
}
