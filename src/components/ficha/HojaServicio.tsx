"use client";

import { ContratoCard } from "@/components/contratos/ContratoCard";
import { AccesosAlumno } from "@/components/contratos/AccesosAlumno";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, Briefcase, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Contact, CreditCard, FileSignature, Flag, GraduationCap,
  Hash, HeartHandshake, Home, IdCard, KeyRound, Layers, Link2, Mail, MapPin, MessageSquareText, Phone, PhoneCall, PhoneMissed, Plus,
  Repeat2, ShieldCheck, Signal, Timer, UserRound, Users, Video,
} from "lucide-react";
import { Badge, Button, Empty, Select } from "@/components/ui/ui";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { DatosExtra } from "@/components/ui/CamposExtra";
import { EditarAlumno, VentaDelAlumno } from "@/components/alumnos/Servicio";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { contenidoCliente, useEdicionCliente } from "@/components/cs/edicionCliente";
import { RespuestasDelReporte } from "@/components/cs/ReportesDelCliente";
import { useToast } from "@/components/ui/Toast";
import { ChatEquipo } from "./ChatEquipo";
import { HistorialPersona } from "./HistorialPersona";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { alumnoDeVenta, etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import {
  EDITOR_CLIENTE, filasClientes, filasResells, MOTOR_CLIENTES, POR_QUE_NO_CLIENTE, valorEditableCliente, type ClaveCliente, type FilaCliente,
} from "@/lib/clientes-cs";
import { configSeguimiento, diasEntre, formatoDia, hoyDelNegocio, textoDeAtraso } from "@/lib/seguimiento";
import { etapaDelFollowUp, ETAPAS_DEL_ALUMNO } from "@/lib/panel-servicio";
import { INGRESOS_COMUNIDAD } from "@/lib/angelo";
import { SI } from "@/lib/tabla-cs";
import { fechaLarga, money } from "@/lib/format";
import type { Persona } from "@/lib/persona";
import type { Alumno, EstadoApp, IngresoComunidad, SeguimientoAlumno, Venta } from "@/lib/types";
import "@/components/cs/cs.css";
import "./hoja-servicio.css";

/* ==================================================================
   La vista SERVICIO de la ficha de la persona, rehecha como la ficha del
   cliente de Blue OS (components/servicio/FichaClienteV2):

     · arriba, el servicio en una línea: qué compró, su estado, su etapa del
       recorrido (sale del Follow Up), el día y la semana del programa, cuándo
       vence y cuántos datos le faltan;
     · lo que se hace todos los días a un clic: «Lo contacté», «No contestó»;
     · solapas en una sola fila, con los datos planos: el rótulo a la izquierda
       y el dato a la derecha. Lo vacío dice «Falta». Un clic en el dato lo
       corrige ahí mismo (Enter guarda y el aviso trae «Deshacer»): se guarda
       igual que en la grilla de Clientes del programa (cs/edicionCliente).

   Un servicio por compra: si compró más de una vez, se elige arriba cuál.
   ================================================================== */

type Solapa = "programa" | "datos" | "seguimiento" | "testimonio" | "cv" | "reportes" | "historial" | "chat";

/* Los datos que cuentan para «Faltan N»: los que Lili tiene que tener de cada alumno. */
const CUENTAN: ClaveCliente[] = [
  "nombre", "email", "telefono", "pais", "edad", "dni", "domicilio", "programa", "inicio", "plan", "duracion", "acceso", "stack", "contrato", "followUp",
];

const ICONO: Partial<Record<ClaveCliente, React.ReactNode>> = {
  numero: <Hash size={15} />, nombre: <UserRound size={15} />, email: <Mail size={15} />, telefono: <Phone size={15} />, pais: <MapPin size={15} />,
  edad: <CalendarDays size={15} />, dni: <IdCard size={15} />, domicilio: <Home size={15} />, programa: <GraduationCap size={15} />,
  inicio: <CalendarPlus size={15} />, egreso: <CalendarCheck size={15} />, duracion: <Timer size={15} />, plan: <CreditCard size={15} />,
  mentor: <Users size={15} />, garantia: <ShieldCheck size={15} />, acceso: <KeyRound size={15} />, closer: <Briefcase size={15} />,
  contrato: <FileSignature size={15} />, estadoContrato: <FileSignature size={15} />, stack: <Layers size={15} />,
  wpp: <MessageSquareText size={15} />, zoom: <Video size={15} />, wibo: <Link2 size={15} />, followUp: <Flag size={15} />,
  estadoAlumno: <Signal size={15} />, contactoInicial: <PhoneCall size={15} />, contactoSemana: <PhoneCall size={15} />,
  ultimoContacto: <PhoneCall size={15} />, proximo: <CalendarClock size={15} />, cadencia: <Repeat2 size={15} />, reporte: <BadgeCheck size={15} />,
  semanasSin: <Timer size={15} />, comentarios: <MessageSquareText size={15} />, cv: <Contact size={15} />, linkedin: <Contact size={15} />,
  responsableCv: <UserRound size={15} />,
};

function estaVacio(f: FilaCliente, clave: ClaveCliente): boolean {
  switch (clave) {
    case "programa": return f.programas.length === 0;
    case "egreso": return !f.egreso;
    case "plan": return !f.plan;
    case "edad": return f.edad === null;
    case "duracion": return f.duracion === null;
    case "mentor": return f.mentor === null;
    case "numero": return f.numero === null;
    default: return !valorEditableCliente(f, clave).trim();
  }
}

/* ---------- Una fila «rótulo · dato» ---------- */

function Fila({ icono, rotulo, falta, ayuda, children }: {
  icono?: React.ReactNode; rotulo: string; falta?: boolean; ayuda?: string; children: React.ReactNode;
}) {
  return (
    <div className={`hs-fila${falta ? " hs-fila--falta" : ""}`}>
      <span className="hs-fila__rot" title={ayuda}>
        <span className="hs-fila__ico" aria-hidden>{icono}</span>
        <span>{rotulo}</span>
        {falta && <span className="hs-falta">Falta</span>}
      </span>
      <div className="hs-fila__val">{children}</div>
    </div>
  );
}

/* Una sección de filas, con su título chico arriba. */
function Bloque({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <section className="hs-bloque">
      {titulo && <div className="hs-bloque__tit">{titulo}</div>}
      <div className="hs-filas">{children}</div>
    </section>
  );
}

/* ---------- La hoja de un servicio ---------- */

/* Las solapas, cuando no entran (la ficha angosta con el chat estirado, el celular), se deslizan de costado: un degradé avisa
   de qué lado hay más (data-mas, hoja-servicio.css) y la elegida siempre queda a la vista. */
function useSolapasQueSeDeslizan(elegida: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const izq = el.scrollLeft > 4, der = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      if (izq || der) el.dataset.mas = izq && der ? "ambos" : izq ? "izq" : "der";
      else delete el.dataset.mas;
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", medir); ro.disconnect(); };
  }, []);
  useEffect(() => {
    const el = ref.current, tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const izq = tab.offsetLeft - 24, der = tab.offsetLeft + tab.offsetWidth + 24 - el.clientWidth;
    if (el.scrollLeft > izq) el.scrollLeft = izq;
    else if (el.scrollLeft < der) el.scrollLeft = der;
  }, [elegida]);
  return ref;
}

function HojaDeUnServicio({ e, p, f, venta, producto, conChat }: {
  e: EstadoApp; p: Persona; f: FilaCliente; venta?: Venta; producto: string; conChat: boolean;
}) {
  const toast = useToast();
  const gestos = useGestos();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "seguimiento_alumnos");
  const puedeAlumno = puedeEditar(acceso, "alumnos");
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const filas = useMemo(() => filasClientes(e, hoy), [e, hoy]);
  const { listas, opcionesDe, sugerenciasDe, guardar } = useEdicionCliente(filas, hoy);
  const [solapa, setSolapa] = useState<Solapa>("programa");
  const solapasRef = useSolapasQueSeDeslizan(solapa);
  const [editando, setEditando] = useState<ClaveCliente | "programa" | null>(null);
  const [editarAlumno, setEditarAlumno] = useState<Alumno | null>(null);
  const alumno = f.alumno;
  const etapas = useMemo(() => etapasDeServicio(e), [e]);
  const etapaPipeline = etapaDelAlumno(etapas, alumno);

  /* ---------- Un dato de Customer Success: se ve y, si se puede, se corrige ahí ---------- */
  const dato = (clave: ClaveCliente, cuenta = CUENTAN.includes(clave)) => {
    const col = MOTOR_CLIENTES.columna[clave];
    const editor = EDITOR_CLIENTE[clave];
    const falta = cuenta && estaVacio(f, clave);
    let valor: React.ReactNode;
    if (!puede || !editor || editor === "ficha") {
      valor = clave === "programa" ? programa() : <span title={POR_QUE_NO_CLIENTE[clave]}>{contenidoCliente(clave, f, hoy)}</span>;
    } else if (editor === "si-no") {
      const es = valorEditableCliente(f, clave) === SI;
      valor = (
        <button type="button" className="cs-si-no" aria-pressed={es} onClick={() => guardar(f, clave, es ? "No" : SI)} title={`${col.titulo}: clic para cambiar`}>
          {contenidoCliente(clave, f, hoy)}
        </button>
      );
    } else {
      const abierta = editando === clave;
      valor = (
        <CeldaEditable
          editor={editor} valor={valorEditableCliente(f, clave)} titulo={col.titulo} abierta={abierta}
          onAbrir={() => setEditando(clave)} onCerrar={() => setEditando((x) => (x === clave ? null : x))}
          onGuardar={(v) => guardar(f, clave, v)} opciones={opcionesDe(clave)} sugerencias={abierta ? sugerenciasDe(clave) : undefined}
          vaciable={clave !== "estadoAlumno"} className="hs-editable"
        >
          {estaVacio(f, clave) ? (falta ? <span className="hs-vacio">Cargar</span> : <span className="hs-guion">—</span>) : contenidoCliente(clave, f, hoy)}
        </CeldaEditable>
      );
    }
    return <Fila key={clave} icono={ICONO[clave]} rotulo={col.titulo} falta={falta} ayuda={col.ayuda}>{valor}</Fila>;
  };

  /* El programa puede ser más de uno: se elige de la lista. Si no se cargó, se sugiere el de lo que compró. */
  function programa() {
    if (!puede) return contenidoCliente("programa", f, hoy);
    const abierta = editando === "programa";
    const lista = [...new Set([...listas.programas, ...f.programas])];
    return (
      <CeldaEditable
        editor="opciones" multiple valor={f.programas.join(", ")} titulo="Programa" abierta={abierta}
        onAbrir={() => setEditando("programa")} onCerrar={() => setEditando((x) => (x === "programa" ? null : x))}
        opciones={lista.map((nombre) => ({ nombre, color: "gris1" as const }))} className="hs-editable"
        onGuardar={(v) => {
          const programas = v.split(",").map((x) => x.trim()).filter(Boolean);
          const cuando = new Date().toISOString();
          acciones.guardarSeguimiento(f.id, (s, quien): SeguimientoAlumno => ({ ...s, programas, actualizadoEn: cuando, actualizadoPor: quien }),
            () => `Programa: ${programas.join(", ") || "vacío"}.`);
          toast(`Programa de ${f.nombre}: ${programas.join(", ") || "vacío"}.`);
        }}
      >
        {f.programas.length ? contenidoCliente("programa", f, hoy) : <span className="hs-vacio">Cargar</span>}
      </CeldaEditable>
    );
  }

  /* ---------- La cabecera del servicio ---------- */
  const faltan = CUENTAN.filter((c) => estaVacio(f, c)).length;
  const etapa = ETAPAS_DEL_ALUMNO.find((x) => x.id === etapaDelFollowUp(f.followUp));
  const dia = f.inicio ? diasEntre(f.inicio, hoy) + 1 : null;
  const quedan = f.egreso ? diasEntre(hoy, f.egreso) : null;
  const activo = alumno.estado === "activo";

  /* Testimonios, resells y la revisión del CV de este alumno. */
  const testimonios = (e.testimonios ?? []).filter((t) => t.alumnoId === alumno.id).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const resells = filasResells(e).filter((r) => r.alumno?.id === alumno.id).sort((a, b) => b.resell.fechaHora.localeCompare(a.resell.fechaHora));
  const cvs = (e.revisionesCv ?? []).filter((r) => r.alumnoId === alumno.id);
  const reportes = e.reportes.filter((r) => r.alumnoId === alumno.id).sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel));

  const solapas: { id: Solapa; texto: string; n?: number }[] = [
    { id: "programa", texto: "Programa" },
    { id: "datos", texto: "Datos" },
    { id: "seguimiento", texto: "Seguimiento" },
    { id: "testimonio", texto: "Testimonio", n: testimonios.length + resells.length },
    { id: "cv", texto: "CV" },
    { id: "reportes", texto: "Reportes", n: reportes.length },
    { id: "historial", texto: "Historial" },
    ...(conChat ? [] : [{ id: "chat" as Solapa, texto: "Chat", n: p.comentarios.length }]),
  ];
  const faltanEn = (claves: ClaveCliente[]) => claves.filter((c) => CUENTAN.includes(c) && estaVacio(f, c)).length;
  const DE_DATOS: ClaveCliente[] = ["nombre", "email", "telefono", "pais", "edad", "dni", "domicilio"];
  const DE_PROGRAMA: ClaveCliente[] = ["programa", "inicio", "plan", "duracion", "acceso", "stack", "contrato"];

  return (
    <div className="hs">
      <div className="hs-cabeza">
        <div className="hs-cabeza__que">
          <span className="hs-producto">{producto}</span>
          {venta && <span className="hs-sub">Compra del {fechaLarga(venta.fecha)}</span>}
        </div>
        <div className="hs-chips">
          {etapa && <span className={`hs-chip hs-chip--${etapa.id}`} title={`Etapa del recorrido según su Follow Up: ${f.followUp || "sin cargar"}`}>{etapa.label}</span>}
          {dia !== null && (dia > 0
            ? <span className="hs-chip" title={`Empezó el ${formatoDia(f.inicio, hoy)}`}>Día {dia} · Semana {Math.floor((dia - 1) / 7) + 1}</span>
            : <span className="hs-chip">Empieza el {formatoDia(f.inicio, hoy)}</span>)}
          {quedan !== null && (
            <span className={`hs-chip${quedan < 0 && activo ? " hs-chip--rojo" : quedan <= 30 && activo ? " hs-chip--ambar" : ""}`} title={f.egresoSugerido ? "Calculado: inicio más la duración" : undefined}>
              {quedan < 0 ? `Venció el ${formatoDia(f.egreso, hoy)}` : quedan === 0 ? "Vence hoy" : `Vence el ${formatoDia(f.egreso, hoy)}`}
            </span>
          )}
          <span className={`hs-chip ${faltan ? "hs-chip--ambar" : "hs-chip--ok"}`} title="Datos de Customer Success que todavía están vacíos">{faltan ? `Faltan ${faltan}` : "Completa"}</span>
        </div>
      </div>

      {activo && puede && (
        <div className="hs-hoy">
          <span className="hs-hoy__txt">
            {f.situacion === "no-contesta" ? "Dejó de contestar" : <>Próximo contacto: <b>{formatoDia(f.proximo, hoy)}</b> · {textoDeAtraso(f.atraso).toLowerCase()}</>}
            <span className="t-subtle"> · cada {f.cadencia} días{f.ultimoContacto ? ` · último el ${formatoDia(f.ultimoContacto, hoy)}` : ""}</span>
          </span>
          <span className="hs-hoy__acc">
            <Button sm variante="primary" icono={<PhoneCall size={14} />} onClick={() => gestos.contacte(f)}>Lo contacté</Button>
            <Button sm variante="secondary" icono={<PhoneMissed size={14} />} onClick={() => gestos.noContesto(f, cfg)}>No contestó</Button>
          </span>
        </div>
      )}

      <div ref={solapasRef} className="hs-solapas" role="tablist" aria-label="Qué ver del servicio">
        {solapas.map((s) => {
          const n = s.id === "datos" ? faltanEn(DE_DATOS) : s.id === "programa" ? faltanEn(DE_PROGRAMA) : s.id === "seguimiento" ? faltanEn(["followUp"]) : 0;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={solapa === s.id} className="hs-solapa" onClick={() => setSolapa(s.id)}>
              {s.texto}
              {n > 0 && <span className="hs-solapa__falta" title={`Faltan ${n}`}>{n}</span>}
              {n === 0 && s.n ? <span className="hs-solapa__n">{s.n}</span> : null}
            </button>
          );
        })}
      </div>

      {solapa === "programa" && (
        <>
          <Bloque>
            {dato("programa")}
            {dato("inicio")}
            {dato("duracion")}
            {dato("egreso", false)}
            {dato("plan")}
            {dato("mentor", false)}
            {dato("garantia", false)}
            {dato("closer", false)}
          </Bloque>
          <Bloque titulo="Accesos y contrato">
            {dato("acceso")}
            {dato("wpp", false)}
            {dato("zoom", false)}
            {dato("wibo", false)}
            {dato("contrato")}
            {dato("estadoContrato", false)}
            {dato("stack")}
          </Bloque>
          {/* El contrato de PandaDoc y los accesos (Wisboo, Telegram, Zoom) del circuito de onboarding: no se ven hasta prenderlos en Ajustes. */}
          {venta && venta.estado === "activa" && <ContratoCard venta={venta} alumnoId={alumno.id} />}
          <AccesosAlumno alumno={alumno} venta={venta} />
          <Bloque titulo="En la app">
            <Fila icono={<HeartHandshake size={15} />} rotulo="Etapa del servicio" ayuda="El pipeline de servicio (Alumnos → Pipeline)">
              {puedeAlumno ? (
                <Select aria-label="Etapa del servicio" value={etapaPipeline?.id ?? ""} className="hs-select"
                  onChange={(ev) => {
                    const et = etapas.find((x) => x.id === ev.target.value);
                    if (!et || et.id === etapaPipeline?.id) return;
                    acciones.moverAlumno(alumno.id, et.id);
                    toast(`${alumno.nombre} → ${et.nombre}`);
                  }}
                  opciones={etapas.map((et) => ({ valor: et.id, texto: et.nombre }))} />
              ) : (etapaPipeline?.nombre ?? "—")}
            </Fila>
            {venta && (
              <Fila icono={<Users size={15} />} rotulo="Ingreso a la comunidad">
                {puedeAlumno ? (
                  <Select aria-label="Ingreso a la comunidad" value={venta.ingresoComunidad ?? ""} placeholder="Sin definir" className="hs-select"
                    onChange={(ev) => {
                      const v = ev.target.value as IngresoComunidad | "";
                      acciones.actualizar<Venta>("ventas", venta.id, { ingresoComunidad: v || undefined }, venta.contactoNombre,
                        `${venta.contactoNombre}: ingreso a la comunidad «${v || "sin definir"}».`);
                      toast("Ingreso a la comunidad guardado.");
                    }}
                    opciones={INGRESOS_COMUNIDAD} />
                ) : (venta.ingresoComunidad ?? "—")}
              </Fila>
            )}
            <Fila icono={<Signal size={15} />} rotulo="Progreso del programa">
              <span className="hs-progreso">
                {[0, 25, 50, 75, 100].map((v) => (
                  <button key={v} type="button" className="hs-progreso__paso" aria-pressed={alumno.progreso === v} disabled={!puedeAlumno}
                    onClick={() => acciones.actualizar<Alumno>("alumnos", alumno.id, { progreso: v }, alumno.nombre, `${alumno.nombre}: progreso al ${v}%.`)}>
                    {v}%
                  </button>
                ))}
              </span>
            </Fila>
            {alumno.cuotaMensual > 0 && <Fila icono={<CreditCard size={15} />} rotulo="Cuota mensual"><span className="t-num">{money(alumno.cuotaMensual, alumno.moneda)}</span></Fila>}
          </Bloque>
          {(e.campos.some((c) => c.entidad === "alumno") || alumno.notas) && (
            <Bloque titulo="Otros datos">
              <div className="hs-otros">
                <dl className="dl dl--compacta"><DatosExtra campos={e.campos} entidad="alumno" valores={alumno.extra} /></dl>
                {alumno.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{alumno.notas}</p>}
                {puedeAlumno && <button type="button" className="link t-sm" onClick={() => setEditarAlumno({ ...alumno })}>Editar estos datos</button>}
              </div>
            </Bloque>
          )}
        </>
      )}

      {solapa === "datos" && (
        <Bloque>
          {dato("nombre")}
          {dato("email")}
          {dato("telefono")}
          {dato("pais")}
          {dato("edad")}
          {dato("dni")}
          {dato("domicilio")}
          {dato("numero", false)}
        </Bloque>
      )}

      {solapa === "seguimiento" && (
        <>
          <Bloque>
            {dato("followUp")}
            {dato("estadoAlumno", false)}
            {dato("contactoInicial", false)}
            {dato("contactoSemana", false)}
            {dato("ultimoContacto", false)}
            {dato("proximo", false)}
            <Fila icono={ICONO.cadencia} rotulo="Cadencia" ayuda="Cada cuántos días le toca el contacto">
              {puede ? (
                <span className="hs-progreso">
                  {cfg.cadencias.map((d) => (
                    <button key={d} type="button" className="hs-progreso__paso" aria-pressed={f.cadencia === d} onClick={() => gestos.cadencia(f, d, cfg)}>
                      Cada {d} días
                    </button>
                  ))}
                </span>
              ) : `Cada ${f.cadencia} días`}
            </Fila>
          </Bloque>
          <Bloque titulo="Reporte semanal">
            {dato("reporte", false)}
            {dato("semanasSin", false)}
          </Bloque>
          <Bloque titulo="Comentarios">
            {dato("comentarios", false)}
          </Bloque>
        </>
      )}

      {solapa === "testimonio" && (
        <>
          <Bloque titulo="Testimonio">
            {testimonios.length === 0 ? (
              <p className="hs-nada">Todavía no tiene testimonio. Se carga en <a className="link" href="/alumnos?seccion=testimonios">Testimonios</a>.</p>
            ) : testimonios.map((t) => (
              <React.Fragment key={t.id}>
                <Fila icono={<Flag size={15} />} rotulo="Follow-up del testimonio">{t.followUp || "—"}</Fila>
                <Fila icono={<CalendarDays size={15} />} rotulo="Grabó">{t.fechaGrabacion ? `${formatoDia(String(t.fechaGrabacion), hoy)}${t.conQuien ? ` con ${t.conQuien}` : ""}` : "Todavía no"}</Fila>
                <Fila icono={<Video size={15} />} rotulo="Video" falta={Boolean(t.fechaGrabacion) && !t.link.trim()}>
                  {t.link.trim() ? <a className="link" href={t.link} target="_blank" rel="noopener noreferrer">{t.estadoVideo || "Ver el video"}</a> : (t.estadoVideo || "Sin link")}
                </Fila>
                {t.resell && <Fila icono={<Repeat2 size={15} />} rotulo="Resell después del testimonio">{t.resell}</Fila>}
              </React.Fragment>
            ))}
          </Bloque>
          <Bloque titulo="Llamadas de resell">
            {resells.length === 0 ? (
              <p className="hs-nada">No tuvo llamadas de resell.</p>
            ) : resells.map((r) => (
              <Fila key={r.id} icono={<Repeat2 size={15} />} rotulo={`${formatoDia(r.dia, hoy)}${r.resell.closer ? ` · ${r.resell.closer}` : ""}`}>
                <Badge variante={r.resell.cancelada ? "neutral" : r.estado === "Agendada" ? "warning" : "brand"}>{r.estado}</Badge>
              </Fila>
            ))}
          </Bloque>
        </>
      )}

      {solapa === "cv" && (
        <>
          <Bloque>
            {dato("cv", false)}
            {dato("linkedin", false)}
            {dato("responsableCv", false)}
          </Bloque>
          <Bloque titulo="Revisión de Aldana">
            {cvs.length === 0 ? (
              <p className="hs-nada">No tiene una revisión cargada. Se cargan en <a className="link" href="/alumnos?seccion=cvs">CVs</a>.</p>
            ) : cvs.map((r) => (
              <React.Fragment key={r.id}>
                <Fila icono={<Flag size={15} />} rotulo="Estado">{r.estado || "Sin definir"}</Fila>
                {r.fechaInicio && <Fila icono={<CalendarDays size={15} />} rotulo="Empezó">{formatoDia(r.fechaInicio, hoy)}</Fila>}
                {[["CV", r.linkCv], ["LinkedIn", r.linkLinkedin], ["Corrección", r.linkCorreccion], ["Loom", r.linkLoom]].filter(([, l]) => l).map(([q, l]) => (
                  <Fila key={q} icono={<Link2 size={15} />} rotulo={q}><a className="link" href={l} target="_blank" rel="noopener noreferrer">Abrir</a></Fila>
                ))}
              </React.Fragment>
            ))}
          </Bloque>
        </>
      )}

      {solapa === "reportes" && (
        <Bloque titulo={`Reportes semanales (${reportes.length})`}>
          {reportes.length === 0 ? (
            <p className="hs-nada">Todavía no mandó ningún reporte.</p>
          ) : reportes.slice(0, 10).map((r) => (
            <div key={r.id} className="hs-reporte">
              <div className="row t-sm" style={{ gap: 8 }}>
                <span>Semana del {fechaLarga(r.semanaDel)}</span>
                {r.estado === "completado" && r.horasEstudio !== undefined && <span className="t-subtle t-num">{r.horasEstudio} h · {r.postulaciones ?? 0} post.</span>}
                <span className="spacer" />
                <Badge variante={r.estado === "completado" ? "success" : r.estado === "vencido" ? "danger" : r.estado === "pendiente" ? "accent" : "neutral"}>
                  {r.estado === "completado" ? "Completado" : r.estado === "vencido" ? "Vencido" : r.estado === "pendiente" ? "Pendiente" : "No enviado"}
                </Badge>
              </div>
              <RespuestasDelReporte reporte={r} />
            </div>
          ))}
        </Bloque>
      )}

      {solapa === "historial" && <HistorialPersona e={e} p={p} />}
      {solapa === "chat" && <ChatEquipo contactoId={p.clave} comentarios={p.comentarios} />}

      {editarAlumno && (
        <EditarAlumno form={editarAlumno} setForm={setEditarAlumno} onGuardar={() => {
          const { id, ...cambios } = editarAlumno;
          const nombre = editarAlumno.nombre.trim();
          if (!nombre) { toast("Poné al menos el nombre.", "err"); return; }
          acciones.actualizar<Alumno>("alumnos", id, { ...cambios, nombre }, nombre);
          toast("Servicio actualizado.");
          setEditarAlumno(null);
        }} />
      )}
    </div>
  );
}

/* ---------- La vista Servicio: un servicio por compra ---------- */

export function VistaServicio({ e, p, conChat }: { e: EstadoApp; p: Persona; conChat: boolean }) {
  const toast = useToast();
  const hoy = hoyDelNegocio();
  const filas = useMemo(() => new Map(filasClientes(e, hoy).map((f) => [f.id, f] as const)), [e, hoy]);

  /* Un servicio por compra: cada venta con su alumno, y los alumnos que no tienen venta (cargados a mano, de antes) también. */
  const servicios = useMemo(() => {
    const conVenta = p.ventas.map((v) => {
      const enlazado = p.alumnos.find((a) => a.ventaId === v.id);
      const suelto = enlazado ? undefined : alumnoDeVenta(e, v);
      const alumno = enlazado ?? (suelto && !suelto.ventaId && p.alumnos.includes(suelto) ? suelto : undefined);
      return { venta: v as Venta | undefined, alumno, sinEnlazar: Boolean(alumno && !enlazado) };
    });
    const usados = new Set(conVenta.map((x) => x.alumno?.id).filter(Boolean));
    const sueltos = p.alumnos.filter((a) => !usados.has(a.id));
    return [...conVenta, ...sueltos.map((a) => ({ venta: undefined as Venta | undefined, alumno: a as Alumno | undefined, sinEnlazar: false }))];
  }, [e, p]);

  /* El que está en curso, de entrada. */
  const enCurso = servicios.findIndex((s) => s.alumno && (s.alumno.estado === "activo" || s.alumno.estado === "pausado"));
  const [elegido, setElegido] = useState(Math.max(0, enCurso));
  const s = servicios[Math.min(elegido, servicios.length - 1)];

  if (servicios.length === 0 || !s) {
    return (
      <Empty icono={<GraduationCap size={22} />} titulo="Todavía no tiene servicio"
        texto="El servicio nace solo con cada compra. Cuando registres su venta, aparece acá." />
    );
  }
  const nombreDe = (x: (typeof servicios)[number]) =>
    x.venta ? e.productos.find((pr) => pr.id === x.venta?.productoId)?.nombre ?? "Venta" : x.alumno?.plan || "Servicio";
  const fila = s.alumno ? filas.get(s.alumno.id) : undefined;

  return (
    <div className="stack-4">
      {servicios.length > 1 && (
        <div className="segmento" role="tablist" aria-label="Qué servicio">
          {servicios.map((x, i) => (
            <button key={x.alumno?.id ?? x.venta?.id ?? i} type="button" role="tab" aria-selected={i === elegido} onClick={() => setElegido(i)}>
              {nombreDe(x)}{x.venta ? ` · ${formatoDia(x.venta.fecha.slice(0, 10), hoy)}` : ""}
            </button>
          ))}
        </div>
      )}

      {s.venta && s.sinEnlazar && s.alumno && (
        <div className="hs-aviso">
          <span>Este servicio todavía no tiene la venta enlazada.</span>
          <Button sm variante="secondary" onClick={() => {
            acciones.actualizar<Alumno>("alumnos", (s.alumno as Alumno).id, { ventaId: s.venta?.id }, (s.alumno as Alumno).nombre, `Se enlazó la venta del ${fechaLarga((s.venta as Venta).fecha)}.`);
            toast("Venta enlazada.");
          }}>Enlazar la venta</Button>
        </div>
      )}

      {fila ? (
        <HojaDeUnServicio e={e} p={p} f={fila} venta={s.venta} producto={nombreDe(s)} conChat={conChat} />
      ) : s.venta ? (
        <div className="hs-aviso">
          <span>{s.venta.estado === "activa" ? `La compra de ${nombreDe(s)} todavía no tiene su servicio.` : "La venta está cancelada: no tiene servicio."}</span>
          {s.venta.estado === "activa" && (
            <Button sm variante="primary" icono={<Plus size={14} />}
              onClick={() => { if (acciones.crearServicioDeVenta((s.venta as Venta).id)) toast(`Servicio de ${nombreDe(s)} creado.`); }}>
              Crear servicio
            </Button>
          )}
        </div>
      ) : null}

      {s.alumno && !s.venta && <VentaDelAlumno alumno={s.alumno} />}
    </div>
  );
}
