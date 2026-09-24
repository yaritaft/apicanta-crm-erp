"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ExternalLink, Link2, Pencil, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, Empty, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { DateRangePicker, diaDeNegocio } from "@/components/ui/DateRangePicker";
import { CopiarLink, Filtro, opcionesDe, SIN, type OpcionFiltro } from "@/components/ui/Filtros";
import { Origen } from "@/components/leads/Origen";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { embudoDe } from "@/lib/agendas-webinar";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { useRangoURL } from "@/lib/useRango";
import { paginaDeURL, useBusquedaURL, useParamsURL } from "@/lib/useParamsURL";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { AGENDAR_A_MANO } from "@/lib/funciones";
import { fechaHora, fechaLarga, hora, isoMinuto, num, relativo } from "@/lib/format";
import type { CanalOrigen, EstadoSesion, Sesion } from "@/lib/types";

const ETIQUETA: Record<EstadoSesion, { texto: string; variante: "accent" | "success" | "danger" | "neutral" }> = {
  "agendada": { texto: "Agendada", variante: "accent" },
  "hecha": { texto: "Hecha", variante: "success" },
  "no-show": { texto: "No vino", variante: "danger" },
  "cancelada": { texto: "Cancelada", variante: "neutral" },
};

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/* La Agenda se arma desde la URL (ver lib/useParamsURL.ts), igual que
   Ventas: el período va en ?periodo — arranca en "Todo lo próximo", que es
   lo que antes era la pestaña Próximas — y el resto acá. Vacío es "todos".
   - estado: agendada · hecha · no-show · cancelada
   - tipo: el tipo de sesión tal cual, o "sin"
   - anfitrion: quien la atiende (el closer en Calendly), o "sin"
   - canal: webinar · vsl · setter · otro · sin (Calendly sin canal) · manual
   - pag: la página, desde 1 */
const VISTA_AGENDA = { estado: "", tipo: "", anfitrion: "", canal: "", pag: "1" };

/* Llamadas por página. Se corta entre un día y otro, nunca en el medio de
   uno: ver `paginas` más abajo. */
const POR_PAGINA = 30;

type Faceta = "estado" | "tipo" | "anfitrion" | "canal";
const FACETAS: Faceta[] = ["estado", "tipo", "anfitrion", "canal"];

/* De dónde vino: el canal de Calendly o, si se cargó a mano, eso. Son
   excluyentes, así que van en un solo desplegable. */
const canalDe = (s: Sesion) => (s.origen === "manual" ? "manual" : s.canal ?? SIN);
const CANALES: OpcionFiltro[] = [
  ...(Object.keys(ETIQUETA_CANAL) as CanalOrigen[]).map((k) => ({ valor: k, texto: ETIQUETA_CANAL[k] })),
  { valor: SIN, texto: "Calendly, sin canal" },
  { valor: "manual", texto: "Cargada a mano" },
];

const valorDe: Record<Faceta, (s: Sesion) => string> = {
  estado: (s) => s.estado,
  tipo: (s) => s.tipo?.trim() || SIN,
  anfitrion: (s) => s.anfitrion?.trim() || SIN,
  canal: canalDe,
};

/* El día de la llamada es el del negocio (Argentina), el mismo con el que se
   arman los períodos: si no, una llamada de las 22 caería en "mañana". */
const diaDe = (s: Sesion) => diaDeNegocio(s.inicia);

/* Sin mayúsculas ni tildes: "benitez" encuentra a "Benítez". */
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
  const abrirFicha = useAbrirFicha();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [form, setForm] = useState<(Omit<Sesion, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Sesion | null>(null);
  const lista = useRef<HTMLDivElement>(null);

  const [vista, setVista] = useParamsURL(VISTA_AGENDA);
  const [busca, setBusca] = useBusquedaURL("q", ["pag"]);

  useEffect(() => {
    if (url.nuevo) { if (AGENDAR_A_MANO) setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión")); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url, e.ajustes.tiposSesion]);

  /* ---------- Período ----------
     "Todo lo próximo" llega hasta la última llamada agendada y "Todo lo
     pasado" arranca en la primera: los límites salen de los datos, así una
     llamada nueva nunca queda afuera de un link guardado. */
  const hoy = diaDeNegocio(new Date().toISOString());
  const limites = useMemo(() => {
    const dias = e.sesiones.map(diaDe).filter(Boolean).sort();
    const ultimo = dias[dias.length - 1];
    return { min: dias[0] ?? null, max: ultimo && ultimo > hoy ? ultimo : hoy };
  }, [e.sesiones, hoy]);
  const [rango, setRango] = useRangoURL("proximo", { futuro: true, limites });

  /* Las dos que eran pestañas se cortan también por la HORA, como antes:
     "Todo lo próximo" es desde una hora atrás (la llamada que está empezando
     no desaparece) y "Todo lo pasado", lo que ya empezó. Los demás períodos
     son días enteros: "Hoy" muestra el día completo. `ahora` va al minuto
     para no recalcular la lista en cada render. */
  const ahora = Math.floor(Date.now() / 60000) * 60000;
  const enPeriodo = useMemo(() => e.sesiones.filter((s) => {
    const dia = diaDe(s);
    if (!dia || dia < rango.desde || dia > rango.hasta) return false;
    if (rango.preset === "proximo") return new Date(s.inicia).getTime() >= ahora - 3600000;
    if (rango.preset === "pasado") return new Date(s.inicia).getTime() < ahora;
    return true;
  }), [e.sesiones, rango, ahora]);

  /* Lo que ya pasó se lee de lo último para atrás; lo que viene, en orden. */
  const alReves = rango.preset === "pasado" || rango.hasta < hoy;

  /* Cada desplegable ofrece lo que existe en las llamadas; el estado, los
     cuatro de siempre. */
  const opciones = useMemo<Record<Faceta, OpcionFiltro[]>>(() => ({
    estado: (Object.keys(ETIQUETA) as EstadoSesion[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto })),
    tipo: opcionesDe(e.sesiones.map(valorDe.tipo), (t) => t, "Sin tipo"),
    anfitrion: opcionesDe(e.sesiones.map(valorDe.anfitrion), (a) => a, "Sin anfitrión"),
    canal: CANALES.filter((c) => e.sesiones.some((s) => canalDe(s) === c.valor)),
  }), [e.sesiones]);

  /* Un filtro de la URL que ya no existe (un anfitrión que se fue, un link
     viejo) se ignora en vez de dejar la agenda vacía sin explicación. */
  const f = useMemo(() => Object.fromEntries(FACETAS.map((k) => [
    k, opciones[k].some((o) => o.valor === vista[k]) ? vista[k] : "",
  ])) as Record<Faceta, string>, [vista, opciones]);

  /* Las llamadas que quedan, y cuántas hay de cada opción. Cada desplegable
     cuenta sobre lo que dejan pasar los DEMÁS filtros, el período y la
     búsqueda: el número dice cuántas vas a ver si lo elegís. */
  const { visibles, cuentas } = useMemo(() => {
    const t = normal(busca.trim());
    const base = t ? enPeriodo.filter((s) => normal(`${s.invitado} ${s.email ?? ""}`).includes(t)) : enPeriodo;
    const pasa = (s: Sesion, salvo?: Faceta) => FACETAS.every((k) => k === salvo || !f[k] || valorDe[k](s) === f[k]);
    const cuentas = Object.fromEntries(FACETAS.map((k) => {
      const m = new Map<string, number>();
      for (const s of base) if (pasa(s, k)) m.set(valorDe[k](s), (m.get(valorDe[k](s)) ?? 0) + 1);
      return [k, m];
    })) as Record<Faceta, Map<string, number>>;
    const visibles = base.filter((s) => pasa(s)).sort((a, b) => (alReves ? -1 : 1) * (+new Date(a.inicia) - +new Date(b.inicia)));
    return { visibles, cuentas };
  }, [enPeriodo, busca, f, alReves]);

  const porDia = useMemo(() => {
    const m = new Map<string, Sesion[]>();
    for (const s of visibles) {
      const k = diaDe(s);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()];
  }, [visibles]);

  /* Páginas de días enteros. Una página junta días hasta POR_PAGINA
     llamadas; un día que solo ya pasa ese número va entero en la suya.
     Partir un día entre dos páginas haría creer que ese día hubo menos. */
  const paginas = useMemo(() => {
    const out: [string, Sesion[]][][] = [];
    let actual: [string, Sesion[]][] = [];
    let n = 0;
    for (const dia of porDia) {
      if (actual.length > 0 && n + dia[1].length > POR_PAGINA) { out.push(actual); actual = []; n = 0; }
      actual.push(dia);
      n += dia[1].length;
    }
    if (actual.length > 0) out.push(actual);
    return out;
  }, [porDia]);
  const pagina = Math.min(paginaDeURL(vista.pag), Math.max(1, paginas.length)) - 1;
  const enPagina = paginas[pagina] ?? [];
  const cuantas = (dias: [string, Sesion[]][]) => dias.reduce((a, [, xs]) => a + xs.length, 0);
  const antes = paginas.slice(0, pagina).reduce((a, p) => a + cuantas(p), 0);

  function irAPagina(p: number) {
    setVista({ pag: String(p + 1) });
    /* Con el paginador de abajo, la página nueva se empieza a leer por su
       primer día y no desde donde había quedado el scroll. */
    const arriba = lista.current?.getBoundingClientRect().top;
    if (arriba !== undefined && arriba < 0) window.scrollTo({ top: window.scrollY + arriba - 96 });
  }

  /* Cambiar un filtro vuelve a la primera página. */
  const filtrar = (faceta: Faceta, valor: string) => setVista({ [faceta]: valor || null, pag: null });
  const conCuenta = (xs: OpcionFiltro[], m: Map<string, number>) => xs.map((o) => ({ ...o, cuenta: m.get(o.valor) ?? 0 }));

  /* Limpia lo que recorta la lista; el período queda, que se elige arriba. */
  const hayFiltros = FACETAS.some((k) => f[k]) || busca.trim() !== "";
  function limpiarFiltros() {
    setBusca("");
    setVista({ estado: null, tipo: null, anfitrion: null, canal: null, pag: null }, { q: null });
  }

  const sesionVista = e.sesiones.find((s) => s.id === ver) ?? null;

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
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max} futuro
              onApply={(r) => setRango(r, { pag: null })}
              footerNota="Por el día de la llamada · hora de Argentina"
            />
            {AGENDAR_A_MANO && <Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión"))}>Agendar sesión</Button>}
          </>
        }
      />

      <Card>
        {/* Un desplegable de una sola opción no recorta nada: no se muestra. */}
        <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
          <Filtro etiqueta="Filtrar por estado" todos="Todos los estados" valor={f.estado}
            opciones={conCuenta(opciones.estado, cuentas.estado)} onCambiar={(v) => filtrar("estado", v)} />
          {opciones.tipo.length > 1 && (
            <Filtro etiqueta="Filtrar por tipo de sesión" todos="Todos los tipos" valor={f.tipo}
              opciones={conCuenta(opciones.tipo, cuentas.tipo)} onCambiar={(v) => filtrar("tipo", v)} />
          )}
          {opciones.anfitrion.length > 1 && (
            <Filtro etiqueta="Filtrar por anfitrión" todos="Todos los anfitriones" valor={f.anfitrion}
              opciones={conCuenta(opciones.anfitrion, cuentas.anfitrion)} onCambiar={(v) => filtrar("anfitrion", v)} />
          )}
          {opciones.canal.length > 1 && (
            <Filtro etiqueta="Filtrar por canal" todos="Todos los canales" valor={f.canal}
              opciones={conCuenta(opciones.canal, cuentas.canal)} onCambiar={(v) => filtrar("canal", v)} />
          )}
          <div className="buscador">
            <Input
              icono={<Search size={18} />} value={busca} onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Buscá por nombre o email…" aria-label="Buscar llamadas por invitado o email"
            />
          </div>
        </div>
        <div className="toolbar">
          <span className="t-sm t-subtle t-num">
            {num(visibles.length)} {visibles.length === 1 ? "llamada" : "llamadas"}
            {visibles.length > 1 && (alReves ? " · de la última a la primera" : " · de la primera a la última")}
          </span>
          <span className="spacer" />
          {hayFiltros && <Button sm variante="ghost" onClick={limpiarFiltros}>Limpiar filtros</Button>}
          <CopiarLink />
        </div>

        {visibles.length === 0 ? (
          <Empty
            icono={<CalendarDays size={22} />}
            titulo={hayFiltros ? "Ninguna llamada coincide" : rango.preset === "proximo" ? "No hay nada agendado" : "Nada para mostrar"}
            texto={hayFiltros
              ? "Probá con otro período o sacá algún filtro."
              : rango.preset === "proximo"
                ? "Cuando agendes una llamada va a aparecer acá, ordenada por día."
                : "No hay llamadas en este período. Probá con otro."}
            accion={hayFiltros
              ? <Button variante="secondary" onClick={limpiarFiltros}>Limpiar filtros</Button>
              : AGENDAR_A_MANO ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIA(e.ajustes.tiposSesion[0] ?? "Sesión"))}>Agendar una sesión</Button> : undefined}
          />
        ) : (
          <div ref={lista}>
            {enPagina.map(([dia, items]) => {
              const [a, m, n] = dia.split("-").map(Number);
              const d = new Date(a, m - 1, n);
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
                          <BadgeEmbudo s={s} />
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

        {/* El mismo paginador de las tablas: pegado abajo mientras se recorren
            los días, para no tener que bajar hasta el final a cambiar de
            página. */}
        {paginas.length > 1 && (
          <div className="hk-paginador agenda-paginador">
            <span className="t-sm t-subtle t-num">
              {num(antes + 1)}–{num(antes + cuantas(enPagina))} de {num(visibles.length)}
            </span>
            <span className="spacer" />
            <button
              type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
              disabled={pagina === 0} onClick={() => irAPagina(pagina - 1)}
            >
              <ArrowLeft size={15} />Anterior
            </button>
            <span className="t-sm t-muted">{pagina + 1} / {paginas.length}</span>
            <button
              type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
              disabled={pagina >= paginas.length - 1} onClick={() => irAPagina(pagina + 1)}
            >
              Siguiente<ArrowRight size={15} />
            </button>
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
              {(sesionVista.contactoId || sesionVista.leadId) && (
                <Button variante="primary" icono={<UserRound size={16} />}
                  onClick={() => { const id = sesionVista.contactoId ?? sesionVista.leadId!; setVer(null); abrirFicha(id); }}>
                  Ver la ficha
                </Button>
              )}
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
              {(sesionVista.canal || sesionVista.utm) && <Dato label="Embudo"><BadgeEmbudo s={sesionVista} /></Dato>}
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

/* De qué embudo vino la llamada, por los UTMs de la agenda: "Webinar 23-09 ·
   EnVivo", "Webinar 23-09 · PostWebinar", "VSL · Landing-Organic"… Un link
   viejo del webinar (sin EnVivo ni PostWebinar) va en amarillo. Sin canal
   ni UTMs (una llamada cargada a mano) no muestra nada. */
function BadgeEmbudo({ s }: { s: Sesion }) {
  if (!s.canal && !s.utm) return null;
  const e = embudoDe({ canal: s.canal, utm: s.utm });
  const variante = e.link === "viejo" ? "warning" : e.link ? "accent" : "neutral";
  return (
    <span title={e.utm || "Sin UTMs"}>
      <Badge variante={variante}>{e.texto}{e.link ? ` · ${e.link === "viejo" ? "link viejo" : e.link}` : ""}</Badge>
    </span>
  );
}
