"use client";

import { ContratoCard } from "@/components/contratos/ContratoCard";
import { AccesosAlumno } from "@/components/contratos/AccesosAlumno";
import { SesionesZoom } from "@/components/contratos/SesionesZoom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, Briefcase, Cake, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Contact, CreditCard, FileSignature, Flag, GraduationCap,
  Hash, HeartHandshake, Home, IdCard, KeyRound, Layers, Link2, Mail, MapPin, MessageSquareText, Phone, PhoneCall, PhoneMissed, Plus,
  Pencil, Repeat2, ShieldCheck, Signal, StickyNote, Timer, UserRound, Users, Video,
} from "lucide-react";
import { Badge, Button, Empty, Select } from "@/components/ui/ui";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { DatosExtra } from "@/components/ui/CamposExtra";
import { EditarAlumno, VentaDelAlumno } from "@/components/alumnos/Servicio";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { contenidoCliente, useEdicionCliente } from "@/components/cs/edicionCliente";
import { RespuestasDelReporte } from "@/components/cs/ReportesDelCliente";
import { EnlaceDeReporte } from "@/components/cs/EnlaceDeReporte";
import { useToast } from "@/components/ui/Toast";
import { ChatEquipo } from "./ChatEquipo";
import { BloqueServicio, FilaServicio } from "./FilaServicio";
import { FormSesionUnoAUno } from "./FormSesionUnoAUno";
import { PausasAlumno } from "./PausasAlumno";
import { BienvenidaAlumno } from "@/components/contratos/BienvenidaAlumno";
import { AvisoAlumnoRepetido } from "./AvisoAlumnoRepetido";
import { NotaDeCharla } from "./NotaDeCharla";
import { SimulacrosAlumno } from "@/components/simulacros/Simulacros";
import { ConsultasAlumno } from "@/components/consultas/Consultas";
import { textoDePausa } from "@/lib/pausas";
import { ventaPendienteDe } from "@/lib/alumnos";
import { resumenBonos } from "@/lib/bonos";
import { programaDeProducto, programasDe } from "@/lib/programas";
import { reservaSinCompletar, type EstadoReserva } from "@/lib/reservas";
import { FormTestimonioCs } from "@/components/cs/TestimoniosCs";
import { FormResell } from "@/components/cs/ResellsCs";
import { SOLAPAS_SERVICIO, useSolapaServicio, type SolapaServicio } from "./abrir";
import { HistorialPersona } from "./HistorialPersona";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { alumnoDeVenta, etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import {
  EDITOR_CLIENTE, estadosDeResell, filasClientes, filasResells, MOTOR_CLIENTES, POR_QUE_NO_CLIENTE, valorEditableCliente, type ClaveCliente,
  type FilaCliente,
} from "@/lib/clientes-cs";
import { configSeguimiento, diasEntre, formatoDia, hoyDelNegocio, sumarDias, terminoElServicio, textoDeAtraso } from "@/lib/seguimiento";
import { DIAS_PARA_RENOVAR, etapaDelFollowUp, ETAPAS_DEL_ALUMNO } from "@/lib/panel-servicio";
import { sinTildes } from "@/lib/crm";
import { INGRESOS_COMUNIDAD } from "@/lib/angelo";
import { SI } from "@/lib/tabla-cs";
import { fechaLarga, money } from "@/lib/format";
import type { Persona } from "@/lib/persona";
import type { Alumno, EstadoApp, IngresoComunidad, Resell, SeguimientoAlumno, SesionUnoAUno, Testimonio, Venta } from "@/lib/types";
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

type Solapa = SolapaServicio;

/* Los datos que cuentan para «Faltan N»: los que Lili tiene que tener de cada alumno. */
const CUENTAN: ClaveCliente[] = [
  "nombre", "email", "telefono", "pais", "edad", "dni", "domicilio", "programa", "inicio", "plan", "duracion", "acceso", "stack", "contrato", "followUp",
];

const ICONO: Partial<Record<ClaveCliente, React.ReactNode>> = {
  numero: <Hash size={15} />, nombre: <UserRound size={15} />, email: <Mail size={15} />, telefono: <Phone size={15} />, pais: <MapPin size={15} />,
  edad: <CalendarDays size={15} />, nacimiento: <Cake size={15} />, dni: <IdCard size={15} />, domicilio: <Home size={15} />, programa: <GraduationCap size={15} />,
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
/* Un texto largo (la situación previa, las notas): abajo del rótulo y entero, en vez de apretado a la derecha. */
function FilaTexto({ icono, rotulo, texto }: { icono?: React.ReactNode; rotulo: string; texto: string }) {
  if (!texto.trim()) return <Fila icono={icono} rotulo={rotulo}><span className="hs-guion">—</span></Fila>;
  return (
    <div className="hs-fila hs-fila--texto">
      <span className="hs-fila__rot"><span className="hs-fila__ico" aria-hidden>{icono}</span><span>{rotulo}</span></span>
      <div className="hs-fila__val">{texto.trim()}</div>
    </div>
  );
}

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

/* Con el chat en su columna (ficha ancha), no hay solapa «Chat». */
const SIN_SOLAPA_CHAT = SOLAPAS_SERVICIO.filter((s) => s !== "chat");

function HojaDeUnServicio({ e, p, f, venta, producto, conChat, reserva }: {
  e: EstadoApp; p: Persona; f: FilaCliente; venta?: Venta; producto: string; conChat: boolean;
  /* Si sólo pagó la reserva (lib/reservas): no corre el programa ni vence. */
  reserva?: EstadoReserva;
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
  const [solapa, setSolapa] = useSolapaServicio(conChat ? SIN_SOLAPA_CHAT : SOLAPAS_SERVICIO);
  const solapasRef = useSolapasQueSeDeslizan(solapa);
  const [editando, setEditando] = useState<ClaveCliente | "programa" | null>(null);
  const [nota, setNota] = useState(false);
  const [editarAlumno, setEditarAlumno] = useState<Alumno | null>(null);
  /* Testimonio y resell se cargan y corrigen acá mismo, con los formularios de sus pantallas (Alumnos → Testimonios / Resells). */
  const [formTestimonio, setFormTestimonio] = useState<{ t?: Testimonio } | null>(null);
  const [formResell, setFormResell] = useState<Resell | null>(null);
  const [formSesion, setFormSesion] = useState<{ s?: SesionUnoAUno; con?: string } | null>(null);
  const puedeTestimonio = puedeEditar(acceso, "testimonios");
  const puedeResell = puedeEditar(acceso, "resells");
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

  /* ---------- Por qué no le toca el seguimiento (Lili, 22/10: arriba decía «Próximo contacto: 9 nov» y abajo un guion) ----------
     Una sola explicación para la barra de arriba y la fila de Seguimiento. */
  const sinSeguimiento = f.situacion === "reserva"
    ? "Es una reserva: el seguimiento arranca cuando pague lo que falta."
    : f.situacion === "fuera"
      ? (alumno.estado !== "activo"
        ? `Está ${f.estadoAlumno.toLowerCase()}: no entra al seguimiento.`
        : `Su Follow Up dice «${f.followUp}»: terminó el programa y no entra en «A contactar hoy». Si seguís en contacto, cambiá el Follow Up.`)
      : null;
  /* «Contar desde» (Ajustes): lo de antes de que arrancara la app se cuenta desde ese día, no desde el último contacto. */
  const desdeLaApp = cfg.contarDesde && f.ultimoContacto && f.ultimoContacto < cfg.contarDesde && f.proximo === sumarDias(cfg.contarDesde, f.cadencia)
    ? `Contando desde el ${formatoDia(cfg.contarDesde, hoy)}, cuando arrancó la app: el último contacto (${formatoDia(f.ultimoContacto, hoy)}) es de antes.`
    : undefined;

  /* ---------- La cabecera del servicio ---------- */
  const faltan = CUENTAN.filter((c) => estaVacio(f, c)).length;
  const etapa = ETAPAS_DEL_ALUMNO.find((x) => x.id === etapaDelFollowUp(f.followUp));
  /* Desde que arrancó de verdad: con demora de inicio, desde el día en que termina la demora (lib/pausas.ts). */
  const dia = f.inicioReal ? diasEntre(f.inicioReal, hoy) + 1 : null;
  const quedan = f.egreso ? diasEntre(hoy, f.egreso) : null;
  const activo = alumno.estado === "activo";

  /* Testimonios, resells y la revisión del CV de este alumno. */
  const testimonios = (e.testimonios ?? []).filter((t) => t.alumnoId === alumno.id).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const resells = filasResells(e).filter((r) => r.alumno?.id === alumno.id).sort((a, b) => b.resell.fechaHora.localeCompare(a.resell.fechaHora));
  const cvs = (e.revisionesCv ?? []).filter((r) => r.alumnoId === alumno.id);

  /* ¿Renueva? (Juan Cruz, 21/10): desde «Se les termina el contrato» se llega acá. Se decide con lo mismo que mira el panel: si
     renovó, la nueva fecha de fin; si no, el Follow Up en OUTBOARDING (como en el Airtable). Al lado, lo que dejó el closer en
     la última llamada de resell. */
  const porRenovar = activo && quedan !== null && quedan <= DIAS_PARA_RENOVAR && !terminoElServicio(f.followUp);
  const ultimoResell = resells[0];
  const estadosUltimo = ultimoResell ? estadosDeResell(ultimoResell.resell.estado) : [];
  const closerDijoQueNo = estadosUltimo.some((x) => /no quiere renovar|outbo?a?rding/.test(sinTildes(x)));
  const closerDijoQueSi = estadosUltimo.some((x) => /upgrade|garantia extendida/.test(sinTildes(x)));
  const reportes = e.reportes.filter((r) => r.alumnoId === alumno.id).sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel));

  const solapas: { id: Solapa; texto: string; n?: number }[] = [
    { id: "programa", texto: "Programa" },
    { id: "contrato", texto: "Contrato" },
    { id: "accesos", texto: "Accesos" },
    /* Las clases de Zoom a las que entró (Yari, 22/10: «saber si vino o no a las clases»), en su propia solapa. */
    { id: "zoom", texto: "Sesiones Zoom" },
    { id: "datos", texto: "Datos" },
    { id: "seguimiento", texto: "Seguimiento" },
    /* Bonos (reunión del 21/10): las sesiones 1 a 1 del contrato con el mentor y las de Lili. */
    { id: "bonos", texto: "Bonos", n: (f.seg.sesionesUnoAUno ?? []).length },
    { id: "testimonio", texto: "Testimonio", n: testimonios.length + resells.length },
    { id: "cv", texto: "CV" },
    /* «Formularios» (reunión del 21/10): el formulario semanal del alumno, su link y todas sus respuestas. */
    { id: "reportes", texto: "Formularios", n: reportes.length },
    { id: "historial", texto: "Historial" },
    ...(conChat ? [] : [{ id: "chat" as Solapa, texto: "Chat", n: p.comentarios.length }]),
  ];
  const faltanEn = (claves: ClaveCliente[]) => claves.filter((c) => CUENTAN.includes(c) && estaVacio(f, c)).length;
  const DE_DATOS: ClaveCliente[] = ["nombre", "email", "telefono", "pais", "edad", "nacimiento", "dni", "domicilio"];
  const DE_PROGRAMA: ClaveCliente[] = ["programa", "inicio", "plan", "duracion", "stack"];

  return (
    <div className="hs">
      <AvisoAlumnoRepetido e={e} alumno={alumno} puede={puede} />
      <div className="hs-cabeza">
        <div className="hs-cabeza__que">
          <span className="hs-producto">{producto}{reserva ? " · Reserva" : ""}</span>
          {venta && <span className="hs-sub">Compra del {fechaLarga(venta.fecha)}</span>}
        </div>
        <div className="hs-chips">
          {etapa && <span className={`hs-chip hs-chip--${etapa.id}`} title={`Etapa del recorrido según su Follow Up: ${f.followUp || "sin cargar"}`}>{etapa.label}</span>}
          {reserva && (
            <span className="hs-chip hs-chip--ambar" title="Sólo pagó la reserva: el programa arranca cuando pague lo que falta">
              Reserva de {money(reserva.pagado, venta?.moneda)}{reserva.falta > 0 ? ` · faltan ${money(reserva.falta, venta?.moneda)}` : ""} · todavía no arrancó
            </span>
          )}
          {ventaPendienteDe(alumno) && (
            <span className="hs-chip hs-chip--ambar" title="Lo dieron de alta antes de que el closer cargara la venta: se une sola cuando la cargue">
              Falta que {ventaPendienteDe(alumno)?.closer || "el closer"} cargue la venta
            </span>
          )}
          {!reserva && f.pausa && (
            <span className="hs-chip hs-chip--ambar" title={f.pausa.motivo || undefined}>{textoDePausa(f.pausa, hoy, (d) => formatoDia(d, hoy))}</span>
          )}
          {!reserva && !f.pausa && dia !== null && (dia > 0
            ? <span className="hs-chip" title={`Empezó el ${formatoDia(f.inicioReal, hoy)}`}>Día {dia} · Semana {Math.floor((dia - 1) / 7) + 1}</span>
            : <span className="hs-chip">Empieza el {formatoDia(f.inicioReal, hoy)}</span>)}
          {!reserva && quedan !== null && (
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
            {sinSeguimiento ?? (f.situacion === "no-contesta" ? "Dejó de contestar" : <>Próximo contacto: <b>{formatoDia(f.proximo, hoy)}</b> · {textoDeAtraso(f.atraso).toLowerCase()}</>)}
            {!sinSeguimiento && <span className="t-subtle"> · cada {f.cadencia} días{f.ultimoContacto ? ` · último el ${formatoDia(f.ultimoContacto, hoy)}` : ""}</span>}
          </span>
          <span className="hs-hoy__acc">
            <Button sm variante="primary" icono={<PhoneCall size={14} />} onClick={() => gestos.contacte(f)}>Lo contacté</Button>
            <Button sm variante="secondary" icono={<PhoneMissed size={14} />} onClick={() => gestos.noContesto(f, cfg)}>No contestó</Button>
            <Button sm variante="ghost" icono={<MessageSquareText size={14} />} onClick={() => setNota(true)}
              title="Lo que hablaron (una queja, una sugerencia, un agradecimiento), con fotos o videos, y a quién del equipo avisarle">
              Anotar la charla
            </Button>
          </span>
        </div>
      )}
      {nota && (
        <NotaDeCharla e={e} contactoId={p.clave} nombre={alumno.nombre} puedeContactar={activo && puede}
          onContacte={() => gestos.contacte(f)} onCerrar={() => setNota(false)} />
      )}

      <div ref={solapasRef} className="hs-solapas" role="tablist" aria-label="Qué ver del servicio">
        {solapas.map((s) => {
          const n = s.id === "datos" ? faltanEn(DE_DATOS) : s.id === "programa" ? faltanEn(DE_PROGRAMA) : s.id === "seguimiento" ? faltanEn(["followUp"])
            : s.id === "contrato" ? faltanEn(["contrato"]) : s.id === "accesos" ? faltanEn(["acceso"]) : 0;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={solapa === s.id} className="hs-solapa" onClick={() => setSolapa(s.id)}>
              {s.texto}
              {n > 0 && <span className="hs-solapa__falta" title={`Faltan ${n}`}>{n}</span>}
              {n === 0 && s.n ? <span className="hs-solapa__n">{s.n}</span> : null}
            </button>
          );
        })}
      </div>

      {solapa === "programa" && porRenovar && (
        <BloqueServicio titulo="¿Renueva?" extra={<span className={`hs-chip ${quedan! < 0 ? "hs-chip--rojo" : "hs-chip--ambar"}`}>
          {quedan! < 0 ? `Terminó hace ${-quedan!} ${quedan === -1 ? "día" : "días"}` : quedan === 0 ? "Termina hoy" : `Termina en ${quedan} ${quedan === 1 ? "día" : "días"}`}
        </span>}>
          <FilaServicio icono={<CalendarClock size={15} />} rotulo="Fin del contrato" detalle={f.egresoSugerido ? "Calculado: inicio más duración" : undefined}>
            <span className="t-num">{formatoDia(f.egreso as string, hoy)}</span>
          </FilaServicio>
          <FilaServicio icono={<Repeat2 size={15} />} rotulo="Llamada de resell"
            detalle={ultimoResell ? `${formatoDia(ultimoResell.dia, hoy)}${ultimoResell.resell.closer ? ` · ${ultimoResell.resell.closer}` : ""}` : "Todavía no tuvo"}>
            {!ultimoResell ? <span className="hs-guion">—</span>
              : estadosUltimo.length ? estadosUltimo.map((x) => <Badge key={x} variante={/no quiere|outbo/i.test(x) ? "danger" : /upgrade|garant/i.test(x) ? "success" : "brand"}>{x}</Badge>)
              : <Badge variante="warning">{ultimoResell.resell.cancelada ? "Cancelada" : "Sin resultado: lo carga el closer"}</Badge>}
            {ultimoResell && puedeResell && (
              <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setFormResell(ultimoResell.resell)}>Cargar resultado</Button>
            )}
          </FilaServicio>
          {puede && (
            <FilaServicio icono={<Flag size={15} />} rotulo="Qué hacemos"
              detalle={closerDijoQueNo ? "El closer dejó que no renueva" : closerDijoQueSi ? "El closer dejó que renovó" : "Si renovó, la nueva fecha de fin; si no, pasa a outboarding"}>
              <Button sm variante={closerDijoQueSi ? "primary" : "secondary"} icono={<CalendarCheck size={14} />} onClick={() => setEditando("egreso")}>Renovó</Button>
              <Button sm variante={closerDijoQueNo ? "primary" : "secondary"} icono={<GraduationCap size={14} />} onClick={() => guardar(f, "followUp", "OUTBOARDING")}>No renueva</Button>
            </FilaServicio>
          )}
        </BloqueServicio>
      )}

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
            {dato("stack")}
          </Bloque>
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

      {/* El contrato de PandaDoc y los accesos (Wisboo, Telegram, Zoom), cada uno en su solapa y con las mismas filas
          (Juan Cruz, 21/10): lo que hizo la app y, donde todavía no hizo nada, lo marcado a mano en la ficha (con su
          editor de siempre). Los botones (mandar, dar accesos, quitar) aparecen cuando se prenden en Ajustes. */}
      {solapa === "contrato" && (
        <>
          <ContratoCard forma="hoja" venta={venta} alumnoId={alumno.id}
            manual={<>{dato("contrato")}{dato("estadoContrato", false)}</>} />
          <BienvenidaAlumno alumnoId={alumno.id} ventaId={venta?.id} />
        </>
      )}
      {solapa === "accesos" && (
        <>
          <AccesosAlumno forma="hoja" alumno={alumno} venta={venta}
            manual={{ wisboo: dato("wibo", false), zoom: dato("zoom", false), whatsapp: f.wpp ? dato("wpp", false) : undefined }} />
          <Bloque titulo="Marcado a mano">{dato("acceso")}</Bloque>
        </>
      )}
      {solapa === "zoom" && (
        <SesionesZoom email={alumno.email} desde={f.inicioReal} reuniones={programaDeProducto(programasDe(e.ajustes), venta?.productoId)?.zoom} />
      )}

      {solapa === "datos" && (
        <Bloque>
          {dato("nombre")}
          {dato("email")}
          {dato("telefono")}
          {dato("pais")}
          {dato("edad")}
          {/* La edad sale de acá (Juan Cruz, 24/10): la carga el closer en el contrato y pasa sola a la ficha. */}
          {dato("nacimiento")}
          {dato("dni")}
          {dato("domicilio")}
          {dato("numero", false)}
        </Bloque>
      )}

      {solapa === "seguimiento" && (
        <>
          {/* Hacer al menos un simulacro de entrevista es condición del contrato (Lili, 23/10). */}
          <SimulacrosAlumno alumnoId={alumno.id} />
          {/* Las consultas de los jueves de cuando no pudo ir a la clase (Lili, 24/10). */}
          <ConsultasAlumno alumnoId={alumno.id} />
          <Bloque>
            {dato("followUp")}
            {dato("estadoAlumno", false)}
            {dato("contactoInicial", false)}
            {dato("contactoSemana", false)}
            {dato("ultimoContacto", false)}
            <FilaServicio icono={ICONO.proximo} rotulo="Próximo contacto" detalle={sinSeguimiento ?? desdeLaApp}>
              {sinSeguimiento ? <span className="hs-guion">No le toca</span>
                : <span className="t-num">{formatoDia(f.proximo, hoy)}<span className="t-subtle"> · {textoDeAtraso(f.atraso).toLowerCase()}</span></span>}
            </FilaServicio>
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
          <PausasAlumno f={f} hoy={hoy} puede={puede} />
          <Bloque titulo="Reporte semanal">
            {dato("reporte", false)}
            {dato("semanasSin", false)}
          </Bloque>
          <Bloque titulo="Comentarios">
            {dato("comentarios", false)}
          </Bloque>
        </>
      )}

      {solapa === "bonos" && (() => {
        const b = resumenBonos(f.seg, f.inicioReal, hoy);
        const chip = b.incluidas === null ? { tono: "hs-chip--ambar", texto: "Sin cargar en el contrato" }
          : b.incluidas === 0 ? { tono: "", texto: "El contrato no incluye" }
          : b.vencidas ? { tono: "hs-chip--rojo", texto: `Vencieron ${b.quedan} sin tomar` }
          : { tono: b.quedan ? "hs-chip--ok" : "", texto: b.quedan ? `Le ${b.quedan === 1 ? "queda" : "quedan"} ${b.quedan} de ${b.incluidas}` : `Tomó las ${b.incluidas}` };
        const sesion = (s: SesionUnoAUno) => (
          <FilaServicio key={s.id} icono={<CalendarCheck size={15} />} rotulo={formatoDia(s.fecha, hoy)} detalle={s.notas || undefined}>
            {s.grabacion ? <a className="link t-sm" href={s.grabacion} target="_blank" rel="noopener noreferrer">Grabación</a> : <span className="hs-guion">Sin grabación</span>}
            {puede && <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setFormSesion({ s })} aria-label={`Corregir la sesión del ${formatoDia(s.fecha, hoy)}`}>Editar</Button>}
          </FilaServicio>
        );
        return (
          <>
            <BloqueServicio titulo="Sesiones 1 a 1 con el mentor" extra={<span className={`hs-chip ${chip.tono}`}>{chip.texto}</span>}>
              {dato("mentor", false)}
              <FilaServicio icono={<CalendarClock size={15} />} rotulo="Se toman hasta" detalle="Dentro de los primeros 3 meses del programa; después se pierden">
                {b.vencen ? <span className={`t-num${b.vencidas ? " hs-rojo" : ""}`}>{formatoDia(b.vencen, hoy)}</span> : <span className="hs-guion">Falta la fecha de inicio</span>}
              </FilaServicio>
              {b.conMentor.map(sesion)}
              {puede && (
                <div className="hs-pie-bloque">
                  <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => setFormSesion({ con: "Mentor" })}>Anotar sesión con el mentor</Button>
                </div>
              )}
            </BloqueServicio>
            <BloqueServicio titulo="Sesiones con Lili" extra={b.conOtros.length ? <span className="hs-chip">{b.conOtros.length} {b.conOtros.length === 1 ? "sesión" : "sesiones"}</span> : undefined}>
              {b.conOtros.length === 0 && <p className="hs-nada">Todavía no tuvo. Se anotan cuando hace falta un acompañamiento especial.</p>}
              {b.conOtros.map(sesion)}
              {puede && (
                <div className="hs-pie-bloque">
                  <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => setFormSesion({ con: "Lili" })}>Anotar sesión con Lili</Button>
                </div>
              )}
            </BloqueServicio>
          </>
        );
      })()}

      {solapa === "testimonio" && (
        <>
          {testimonios.length === 0 && (
            <BloqueServicio titulo="Testimonio" extra={puedeTestimonio ? (
              <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => setFormTestimonio({})}>Cargar el testimonio</Button>
            ) : undefined}>
              <p className="hs-nada">Todavía no tiene testimonio.</p>
            </BloqueServicio>
          )}
          {testimonios.map((t, i) => (
            <BloqueServicio key={t.id} titulo={testimonios.length > 1 ? `Testimonio ${testimonios.length - i} de ${testimonios.length}` : "Testimonio"} extra={puedeTestimonio ? (
              <span className="hs-acciones">
                <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setFormTestimonio({ t })}>Editar</Button>
                {i === 0 && <Button sm variante="ghost" icono={<Plus size={14} />} onClick={() => setFormTestimonio({})}>Otro</Button>}
              </span>
            ) : undefined}>
              <Fila icono={<Flag size={15} />} rotulo="Follow-up del testimonio">{t.followUp || <span className="hs-guion">—</span>}</Fila>
              <Fila icono={<CalendarDays size={15} />} rotulo="Fecha de grabación">{t.fechaGrabacion ? <span className="t-num">{formatoDia(String(t.fechaGrabacion), hoy)}</span> : "Todavía no"}</Fila>
              <Fila icono={<UserRound size={15} />} rotulo="Con quién grabó">{t.conQuien || <span className="hs-guion">—</span>}</Fila>
              <Fila icono={<Video size={15} />} rotulo="Estado del video">{t.estadoVideo || <span className="hs-guion">—</span>}</Fila>
              <Fila icono={<Link2 size={15} />} rotulo="Link del video" falta={Boolean(t.fechaGrabacion) && !t.link.trim()}>
                {t.link.trim() ? <a className="link" href={t.link} target="_blank" rel="noopener noreferrer">Ver el video</a> : "Sin link"}
              </Fila>
              <Fila icono={<Repeat2 size={15} />} rotulo="Resell después del testimonio">{t.resell || <span className="hs-guion">—</span>}</Fila>
              <Fila icono={<Layers size={15} />} rotulo="Tecnologías">{t.tecnologias || <span className="hs-guion">—</span>}</Fila>
              <FilaTexto icono={<Briefcase size={15} />} rotulo="Situación previa" texto={t.situacionPrevia} />
              <FilaTexto icono={<BadgeCheck size={15} />} rotulo="Situación actual" texto={t.situacionActual} />
              <FilaTexto icono={<StickyNote size={15} />} rotulo="Notas" texto={t.notas} />
            </BloqueServicio>
          ))}
          <BloqueServicio titulo="Llamadas de resell">
            {resells.length === 0 ? (
              <p className="hs-nada">No tuvo llamadas de resell.</p>
            ) : resells.map((r) => {
              const estados = estadosDeResell(r.resell.estado);
              return (
                <FilaServicio key={r.id} icono={<Repeat2 size={15} />}
                  rotulo={`${formatoDia(r.dia, hoy)}${r.resell.closer ? ` · ${r.resell.closer}` : ""}`}
                  detalle={[
                    r.resell.cashCollect ? `Cobró ${money(r.resell.cashCollect)}` : "",
                    r.resell.casoDeExito ? "Caso de éxito" : "",
                    r.resell.notas,
                  ].filter(Boolean).join(" · ") || undefined}>
                  {r.resell.cancelada ? <Badge variante="neutral">Cancelada</Badge>
                    : estados.length ? estados.map((x) => <Badge key={x} variante={/no quiere|outbo/i.test(x) ? "danger" : /upgrade|garant/i.test(x) ? "success" : "brand"}>{x}</Badge>)
                    : <Badge variante="warning">{r.dia < hoy ? "Sin resultado" : "Agendada"}</Badge>}
                  {r.grabacion && <a className="link t-sm" href={r.grabacion} target="_blank" rel="noopener noreferrer">Grabación</a>}
                  {puedeResell && <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setFormResell(r.resell)} aria-label={`Editar la llamada de resell del ${formatoDia(r.dia, hoy)}`}>Editar</Button>}
                </FilaServicio>
              );
            })}
          </BloqueServicio>
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
        <BloqueServicio titulo="Su link">
          <div className="hs-enlace">
            <EnlaceDeReporte alumnoId={alumno.id} email={alumno.email} />
          </div>
        </BloqueServicio>
      )}
      {solapa === "reportes" && (
        <Bloque titulo={`Formularios semanales que mandó (${reportes.length})`}>
          {reportes.length === 0 ? (
            <p className="hs-nada">Todavía no mandó ningún formulario. Pasale su link: es el mismo todas las semanas.</p>
          ) : reportes.map((r) => (
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

      {formTestimonio && <FormTestimonioCs testimonio={formTestimonio.t} alumnoId={alumno.id} onCerrar={() => setFormTestimonio(null)} />}
      {formResell && <FormResell resell={formResell} onCerrar={() => setFormResell(null)} />}
      {formSesion && <FormSesionUnoAUno alumnoId={alumno.id} nombre={alumno.nombre} sesion={formSesion.s} con={formSesion.con} onCerrar={() => setFormSesion(null)} />}
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
    /* Las ventas canceladas no son un servicio (una venta cargada dos veces y cancelada no tiene que aparecer como otra Mentoría). */
    const conVenta = p.ventas.filter((v) => v.estado !== "cancelada").map((v) => {
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
        <HojaDeUnServicio e={e} p={p} f={fila} venta={s.venta} producto={nombreDe(s)} conChat={conChat}
          reserva={s.venta ? reservaSinCompletar(e.cuotas.filter((c) => c.ventaId === s.venta?.id)) ?? undefined : undefined} />
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
